package gencmu

// Every observation that can belong to an effective production (§4.3).
// Item conditions use the same walk as the suffix and error dependencies.
func productionClauses(p *production) []clausePart {
	var roots []clausePart
	conditions := func(items []*domCond) {
		for _, item := range items {
			roots = append(roots, clausePart{c: item})
		}
	}
	terms := func(items ...*domTerm) {
		for _, item := range items {
			roots = append(roots, clausePart{t: item})
		}
	}
	emission := func(emit *domEmit) {
		if emit != nil {
			for _, item := range emit.Items {
				terms(item.Tags, item.Value, item.Image)
			}
		}
	}
	conditions(p.predictConds)
	for _, condition := range p.conds {
		roots = append(roots, clausePart{c: condition.cond})
	}
	conditions(p.itemConds)
	conditions(p.rankedConditions)
	terms(p.tags, p.parentTags, p.value, p.image, p.error, p.warning)
	emission(p.emit)
	sourceClauses := func(source *sAlt) {
		if source == nil {
			return
		}
		conditions(source.conds)
		terms(source.ruleTags, source.ruleValue, source.ruleImage, source.alt.Tags, source.alt.Value, source.alt.Image, source.error, source.warning)
		emission(source.emit)
	}
	sourceClauses(p.sourceAlternative)
	if p.slot != nil && p.slot.source != p.sourceAlternative {
		sourceClauses(p.slot.source)
	}
	return roots
}

func queryParts(part clausePart, g *lowered) (*domTerm, []string) {
	if condition := part.c; condition != nil && (condition.Kind == cdMatches || condition.Kind == cdBegins || condition.Kind == cdEnds) {
		var names []string
		for _, target := range condition.queryTargets() {
			names = append(names, queryName(target))
		}
		return condition.Span, names
	}
	if term := part.t; term != nil && term.Kind == tmCall {
		if term.Str == "tags" && len(term.Items) == 2 {
			return term.Items[0], []string{term.Items[1].Str}
		}
		if term.Str == "parse" {
			return term.Items[0], []string{g.stage.queryTargets[term.Items[1].Body]}
		}
	}
	return nil, nil
}

// A single closure serves all targets of one lowered grammar (§4.3).
func (g *lowered) readsCarriedErrors(rule int32) bool {
	g.carriedOnce.Do(func() {
		users := make([][]int32, len(g.rules))
		dependent := make([]bool, len(g.rules))
		var ready []int32
		for number, rule := range g.rules {
			seen, targets := map[clausePart]bool{}, map[int32]bool{}
			filtered := false
			scan := func(part clausePart) bool {
				if seen[part] {
					return false
				}
				seen[part] = true
				if term := part.t; term != nil && term.Kind == tmCall && term.Str == "error-free" {
					filtered = true
				}
				_, names := queryParts(part, g)
				for _, name := range names {
					if id, known := g.byName[name]; known {
						targets[id] = true
					}
				}
				return true
			}
			for _, production := range rule.prods {
				if w := work.Load(); w != nil {
					w.ruleSetSteps.add("rule set steps")
				}
				for _, symbol := range production.rhs {
					if !symbol.term {
						targets[symbol.id] = true
					}
				}
				for _, root := range productionClauses(production) {
					walkClause(root, scan)
				}
			}
			for target := range targets {
				users[target] = append(users[target], int32(number))
			}
			if filtered {
				dependent[number] = true
				ready = append(ready, int32(number))
			}
		}
		for index := 0; index < len(ready); index++ {
			for _, user := range users[ready[index]] {
				if w := work.Load(); w != nil {
					w.ruleSetSteps.add("rule set steps")
				}
				if !dependent[user] {
					dependent[user] = true
					ready = append(ready, user)
				}
			}
		}
		g.carriedDependencies = dependent
	})
	return g.carriedDependencies[rule]
}

func (run *stageRun) spanErrors(span spanVal) string {
	// Shared content keys cover only bounded spans, so this walk is bounded.
	bits := make([]byte, span.b-span.a)
	for index := range bits {
		if w := work.Load(); w != nil {
			w.keySteps.add("key steps")
		}
		if len(run.toks[span.a+index].Errors) > 0 {
			bits[index] = 1
		}
	}
	return string(bits)
}
