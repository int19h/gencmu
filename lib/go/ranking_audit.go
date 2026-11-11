package gencmu

import (
	"encoding/json"
	"fmt"
	"strings"
)

// RankingStepReport gives a key step's static label.
type RankingStepReport struct {
	Step    int
	Pattern string
	Status  string
}

// CountedRuleChange names a definition change and its affected step.
type CountedRuleChange struct {
	Step                 int
	Rule, Kind, Document string
}

// RankingReport holds the static reports of one stage.
type RankingReport struct {
	Erasures        []ErasureReport
	IdleErasures    []IdleErasure
	DiagnosticNotes []DiagnosticNote
	Name            string
	KeySteps        []RankingStepReport
	CountedChanges  []CountedRuleChange
}

func addRankingTags(into, from map[string]bool) {
	for tag := range from {
		into[tag] = true
	}
}

func rankingBody(root *domExpr, g *stageGrammar, refs, terms, omitted map[string]bool) {
	pending := []*domExpr{root}
	for len(pending) > 0 {
		e := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		if e == nil {
			continue
		}
		switch e.Kind {
		case exRef:
			if g.byName[e.Name] != nil {
				refs[e.Name] = true
			} else {
				terms[e.Name] = true
			}
		case exLiteral:
			if e.Value != nil && e.Value.Kind == tmString {
				terms[stringTerminal(e.Value.Str, g.uni)] = true
			}
		case exRange:
			if e.Ends[0] != nil && e.Ends[1] != nil {
				left, right := e.Ends[0], e.Ends[1]
				a, b := left.Str, right.Str
				if left.Kind == tmConst && left.value != nil {
					a = left.value.s
				}
				if right.Kind == tmConst && right.value != nil {
					b = right.value.s
				}
				terms[stringTerminal(a, g.uni)+".."+stringTerminal(b, g.uni)] = true
			}
		case exWildcard:
			terms["_"] = true
		case exOptional:
			if e.Elidable {
				head := e.Inner
				for head.Kind == exCapture || head.Kind == exTest || head.Kind == exSeq {
					if head.Kind == exSeq {
						head = head.Items[0]
					} else {
						head = head.Inner
					}
				}
				if head.Kind == exRef {
					omitted[head.Name] = true
				}
			}
		}
		pending = append(pending, e.Items...)
		pending = append(pending, e.Inner, e.Sep)
	}
}
func rankingDead(p *domPattern, reachable, terminals map[string]bool) bool {
	switch p.Kind {
	case "name":
		return !reachable[p.Name]
	case "terminal":
		return p.Name == "_" && len(terminals) == 0 || p.Name != "_" && !terminals[p.Name]
	case "test":
		return len(p.Items) > 0 && rankingDead(p.Items[0], reachable, terminals)
	case tmUnion:
		for _, n := range p.Items {
			if !rankingDead(n, reachable, terminals) {
				return false
			}
		}
		return true
	case tmIntersection:
		for _, n := range p.Items {
			if rankingDead(n, reachable, terminals) {
				return true
			}
		}
	case tmDifference:
		return rankingDead(p.Items[0], reachable, terminals)
	}
	return false
}
func rankingReach(g *stageGrammar, roots []string, body *domExpr) (map[string]bool, map[string]bool) {
	reachable, terminals := map[string]bool{}, map[string]bool{}
	pending := append([]string{}, roots...)
	add := func(expr *domExpr) {
		refs, omitted := map[string]bool{}, map[string]bool{}
		rankingBody(expr, g, refs, terminals, omitted)
		addRankingTags(terminals, omitted)
		for name := range refs {
			pending = append(pending, name)
		}
	}
	if body != nil {
		add(body)
	}
	for len(pending) > 0 {
		name := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		rule := g.byName[name]
		if reachable[name] || rule == nil {
			continue
		}
		reachable[name] = true
		for _, alt := range rule.alts {
			add(alt.alt.Expr)
		}
	}
	return reachable, terminals
}

func rankingStageReport(g *stageGrammar) RankingReport {
	if len(g.steps) == 0 {
		return RankingReport{Name: g.name, KeySteps: []RankingStepReport{}, CountedChanges: []CountedRuleChange{}}
	}
	reachable, terminals := rankingReach(g, []string{"text"}, nil)

	report := RankingReport{Name: g.name, KeySteps: []RankingStepReport{}, CountedChanges: []CountedRuleChange{}}
	for step, key := range g.steps {
		names := map[string]bool{}
		walkPattern(key.pattern, func(p *domPattern) {
			if p.Kind == "name" {
				names[p.Name] = true
			}
		})
		status := ""
		if rankingDead(key.pattern, reachable, terminals) {
			status = "impossible"
		}
		w := &jsonWriter{}
		w.pattern(key.pattern)
		report.KeySteps = append(report.KeySteps, RankingStepReport{Step: step, Pattern: rankingPatternText(w.buf, g.uni), Status: status})
		for _, change := range g.changes {
			if names[change.rule] {
				report.CountedChanges = append(report.CountedChanges, CountedRuleChange{Step: step, Rule: change.rule, Kind: map[string]string{"extend": "extended", "replace": "replaced"}[change.op], Document: change.document})
			}
		}
	}
	return report
}

// RankingReports returns static reports for each stage's key steps.
func (p *Pipeline) RankingReports() []RankingReport {
	out := make([]RankingReport, 0, len(p.stages))
	for _, g := range p.stages {
		report := rankingStageReport(g)
		report.DiagnosticNotes = diagnosticNotes(g)
		report.Erasures = erasureAudit(g)
		report.IdleErasures = []IdleErasure{}
		inert := map[string]bool{}
		for _, entry := range report.Erasures {
			if _, known := inert[entry.Rule]; !known {
				inert[entry.Rule] = true
			}
			inert[entry.Rule] = inert[entry.Rule] && entry.Kind == "inert"
		}
		seen := map[string]bool{}
		for _, entry := range report.Erasures {
			if inert[entry.Rule] && !seen[entry.Rule] {
				seen[entry.Rule] = true
				report.IdleErasures = append(report.IdleErasures, IdleErasure{entry.Rule, entry.Document})
			}
		}
		out = append(out, report)
	}
	return out
}

// FormatRankingReports prints static ranking reports.
func FormatRankingReports(reports []RankingReport) string {
	lines := []string{}
	for _, report := range reports {
		lines = append(lines, report.Name+":")
		for _, step := range report.KeySteps {
			if step.Status != "" {
				lines = append(lines, fmt.Sprintf("  ranking step %d: %s", step.Step+1, step.Status))
			}
		}
		for _, erasure := range report.Erasures {
			lines = append(lines, fmt.Sprintf("  %s erasure: %s", erasure.Kind, erasure.Rule))
		}
		for _, note := range report.DiagnosticNotes {
			switch note.Kind {
			case "query-error":
				detail := fmt.Sprintf("query target %s contains error productions. Witnesses exclude unerased own errors", note.Target)
				if note.Filtered {
					detail += " and carried errors outside erased parts"
				} else {
					detail += " but allow carried errors"
				}
				lines = append(lines, fmt.Sprintf("  %s: %s", note.Rule, detail))
			case "unused-suppression":
				lines = append(lines, fmt.Sprintf("  %s: suppression code %s reaches no warning", note.Rule, note.Code))
			case "guarded-tag-variants":
				lines = append(lines, fmt.Sprintf("  %s: %d guarded tag variants", note.Rule, note.Variants))
			}
		}
		for _, change := range report.CountedChanges {
			lines = append(lines, fmt.Sprintf("  counted rule %s: %s, step %d", change.Rule, change.Kind, change.Step+1))
		}
	}
	return strings.Join(lines, "\n")
}

func rankingPatternText(data []byte, uni *unicodeTable) string {
	var pattern map[string]any
	if err := json.Unmarshal(data, &pattern); err != nil {
		panic(err)
	}
	return templateCanonical(templateObject{"pattern": pattern}, uni)
}
