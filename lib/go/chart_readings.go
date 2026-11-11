package gencmu

import "strings"

// The static properties belong to the active lowered grammar and its sites.
type chartReading struct {
	symbol                  symbol
	test                    *symTest
	qualified, settlesEntry bool
}

func (g *lowered) prepareChartReadings() {
	local := false
	for _, entry := range g.stage.checks {
		for _, condition := range entry.definition.Conditions {
			walkClause(clausePart{c: condition}, func(part clausePart) bool {
				local = local || part.t != nil && part.t.Str == "local-readings"
				return true
			})
		}
	}
	if !local {
		return
	}
	type properties struct{ outside, entry, boundary bool }
	props := make([]properties, len(g.rules))
	parents := make([]map[int32]bool, len(g.rules))
	for rule, r := range g.rules {
		props[rule].entry = r.name == "text"
		parents[rule] = map[int32]bool{}
	}
	for _, p := range g.prods {
		calls := map[int32]bool{}
		for _, symbol := range p.rhs {
			if !symbol.term {
				calls[symbol.id] = true
			}
		}
		visit := func(part clausePart) bool {
			if part.t != nil && part.t.Kind == tmCall && (part.t.Str == "preceding-tokens" || part.t.Str == "starts-input") || part.c != nil && part.c.Kind == cdInitial {
				props[p.lhs].outside = true
			}
			if part.c != nil && part.c.Kind == cdBoundary {
				props[p.lhs].boundary = true
			}
			_, targets := queryParts(part, g)
			for _, target := range targets {
				if id, ok := g.byName[target]; ok {
					calls[id] = true
				}
			}
			return true
		}
		for _, c := range p.predictConds {
			walkClause(clausePart{c: c}, visit)
		}
		for _, c := range p.conds {
			walkClause(clausePart{c: c.cond}, visit)
		}
		for _, conditions := range [][]*domCond{p.itemConds, p.rankedConditions} {
			for _, c := range conditions {
				walkClause(clausePart{c: c}, visit)
			}
		}
		for _, term := range []*domTerm{p.tags, p.parentTags} {
			walkClause(clausePart{t: term}, visit)
		}
		for child := range calls {
			parents[child][p.lhs] = true
		}
	}
	pending, queued := []int32{}, make([]bool, len(g.rules))
	for rule := range g.rules {
		pending = append(pending, int32(rule))
		queued[rule] = true
	}
	for len(pending) > 0 {
		child := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		queued[child] = false
		for parent := range parents[child] {
			a, b := props[parent], props[child]
			merged := properties{a.outside || b.outside, a.entry || b.entry, a.boundary || b.boundary}
			if merged != a {
				props[parent] = merged
				if !queued[parent] {
					pending = append(pending, parent)
					queued[parent] = true
				}
			}
		}
	}
	g.chartRules = make([]chartReading, len(g.rules))
	for id, rule := range g.rules {
		safe := len(rule.prods) > 0
		for _, p := range rule.prods {
			if !p.helper || p.spliceTarget != nil {
				continue
			}
			capture := false
			walkQueryBody(p.helperExpression, func(e *domExpr) bool { capture = capture || e.Kind == exCapture; return true }, nil)
			for name := range p.slotOf {
				if name != "" && !strings.HasPrefix(name, "\x00") {
					capture = true
				}
			}
			safe = safe && p.elided == "" && !capture && len(p.conds) == 0 && len(p.predictConds) == 0 && len(p.rankedConditions) == 0 && len(p.itemConds) == 0 && p.parentTags == nil
		}
		info := props[id]
		g.chartRules[id] = chartReading{symbol: symbol{id: int32(id)}, qualified: safe && !info.outside, settlesEntry: info.entry && info.boundary}
	}
	for _, p := range g.prods {
		p.chartSites = make([]chartReading, len(p.rhs))
		for index, symbol := range p.rhs {
			site := chartReading{qualified: true}
			if !symbol.term {
				site = g.chartRules[symbol.id]
			}
			site.symbol = symbol
			if p.tests != nil {
				site.test = p.tests[index]
			}
			p.chartSites[index] = site
		}
	}
}

func chartSite(p *production, index int) *chartReading {
	if p == nil || len(p.chartSites) == 0 {
		return nil
	}
	return &p.chartSites[index]
}

// One raw recognizer and one eligibility fixed point serve every local reading.
func (r *recognizer) chartReading(local *checkValue, clean bool) *nestedResult {
	site := local.site
	if r.recon != nil || site == nil || !site.qualified || local.span.a == r.base && site.settlesEntry {
		return nil
	}
	start := local.span.a - r.base
	var rows []witnessEnd
	if site.symbol.term {
		if start < r.n && r.reads(start, site.symbol.id) {
			tags := r.run.tagsets[local.span.a]
			if (!clean || len(r.run.toks[local.span.a].Errors) == 0) && (site.test == nil || r.run.testHolds(site.test, local.span.a, local.span.a+1, tags)) {
				rows = append(rows, witnessEnd{1, tags})
			}
		}
	} else {
		if r.localCompletions == nil {
			r.localCompletions = map[[2]int32][]*symNode{}
			for _, set := range r.sets {
				for _, completion := range set.syms {
					eligibilityStep()
					key := [2]int32{completion.rule, completion.start}
					r.localCompletions[key] = append(r.localCompletions[key], completion)
				}
			}
		}
		items := r.localCompletions[[2]int32{site.symbol.id, int32(start)}]
		if r.localEligibility == nil {
			var all []*item
			for _, set := range r.sets {
				for _, completion := range set.syms {
					all = append(all, completion.items...)
				}
			}
			r.localEligibility = r.eligibilityStates(all, true)
		}
		for _, completion := range items {
			if r.boundaries != nil && !r.boundaries.accepts(completion.boundary, func(*boundaryLiteral) {}) {
				continue
			}
			tags := completion.tags
			end := r.base + int(completion.end)
			if site.test != nil && !r.run.testHolds(site.test, local.span.a, end, tags) {
				continue
			}
			for _, item := range completion.items {
				states := r.localEligibility[item]
				if states != 0 && (!clean || states&1 != 0) {
					rows = append(rows, witnessEnd{end - local.span.a, tags})
					break
				}
			}
		}
	}
	var tags []*tagset
	for _, row := range rows {
		tags = append(tags, row.tags)
	}
	return &nestedResult{holds: len(rows) > 0, tags: r.run.ps.in.unionAll(tags), ends: rows}
}
