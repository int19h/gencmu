package gencmu

import (
	"encoding/json"
	"fmt"
	"slices"
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

// RankingTagReport describes forwarded tags or dropped inherited tags.
type RankingTagReport struct {
	Rule         string
	Step         int
	Tags         []string
	Unknown      bool
	Document     string
	Line, Column int
}

// RankingVocabularyWarning names a tested tag outside its stage's sources.
type RankingVocabularyWarning struct {
	Stage string
	Step  int
	Tag   string
}

// RankingReport holds the static reports of one stage.
type RankingReport struct {
	Name                                     string
	KeySteps                                 []RankingStepReport
	CountedChanges                           []CountedRuleChange
	InheritedRankingTags, DroppedRankingTags []RankingTagReport
	VocabularyWarnings                       []RankingVocabularyWarning
}

func rankingLiterals(t *domTerm) map[string]bool {
	out := map[string]bool{}
	pending := []clausePart{{t: t}}
	for len(pending) > 0 {
		part := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		n := part.t
		if n != nil {
			if n.Kind == tmTag {
				out[n.Str] = true
			}
			if n.Kind == tmConst && n.value != nil {
				if n.value.ty == tyTags {
					for _, tag := range n.value.names {
						out[tag] = true
					}
				}
				if n.value.pattern != nil {
					pending = append(pending, clausePart{t: &domTerm{Kind: tmPattern, Pattern: n.value.pattern}})
				}
			}
		}
		pending = append(pending, part.children()...)
	}
	return out
}
func addRankingTags(into, from map[string]bool) {
	for tag := range from {
		into[tag] = true
	}
}
func sortedRankingTags(tags map[string]bool) []string {
	out := make([]string, 0, len(tags))
	for tag := range tags {
		out = append(out, tag)
	}
	slices.Sort(out)
	return out
}
func rankingWidthsTogether(a, b uint8) uint8 {
	var out uint8
	for i := 0; i < 3; i++ {
		for j := 0; j < 3; j++ {
			if a&(1<<i) != 0 && b&(1<<j) != 0 {
				out |= 1 << min(2, i+j)
			}
		}
	}
	return out
}
func rankingWidths(e *domExpr) uint8 {
	switch e.Kind {
	case exEmpty:
		return 1
	case exCapture, exTest:
		return rankingWidths(e.Inner)
	case exSeq:
		mask := uint8(1)
		for _, p := range e.Items {
			mask = rankingWidthsTogether(mask, rankingWidths(p))
		}
		return mask
	case exChoice, exRanked:
		mask := uint8(0)
		for _, p := range e.Items {
			mask |= rankingWidths(p)
		}
		return mask
	case exAnd:
		return 7
	}
	return 2
}
func rankingSole(e *domExpr) *domExpr {
	if rankingWidths(e)&2 == 0 {
		return nil
	}
	switch e.Kind {
	case exCapture, exTest:
		return rankingSole(e.Inner)
	case exSeq:
		parts := []*domExpr{}
		for _, p := range e.Items {
			if rankingWidths(p) != 1 {
				parts = append(parts, p)
			}
		}
		if len(parts) == 1 {
			return rankingSole(parts[0])
		}
	}
	return e
}

type rankingRuleData struct {
	refs, terminals, omitted, own map[string]bool
	sets                          []*tagset
	unary                         []*sAlt
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
func rankingTested(p *domPattern) (map[string]bool, map[string]bool, map[string]bool) {
	names, tags, positive := map[string]bool{}, map[string]bool{}, map[string]bool{}
	walkPattern(p, func(n *domPattern) {
		if n.Kind == "name" {
			names[n.Name] = true
		}
		for _, r := range n.Requirements {
			set := rankingLiterals(r.Value)
			addRankingTags(tags, set)
			if !r.Negated {
				addRankingTags(positive, set)
			}
		}
	})
	return names, tags, positive
}
func rankingDead(p *domPattern, reachable, terminals map[string]bool) bool {
	switch p.Kind {
	case "name":
		return !reachable[p.Name]
	case "terminal":
		return !terminals[p.Name]
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
func rankingStageReport(g *stageGrammar, previous map[string]bool) (RankingReport, map[string]bool) {
	vocabulary := map[string]bool{"_Elided": true}
	addRankingTags(vocabulary, previous)
	data := map[string]*rankingRuleData{}
	for _, rule := range g.rules {
		d := &rankingRuleData{refs: map[string]bool{}, terminals: map[string]bool{}, omitted: map[string]bool{}, own: map[string]bool{}}
		for _, alt := range rule.alts {
			rankingBody(alt.alt.Expr, g, d.refs, d.terminals, d.omitted)
			terms := []*domTerm{}
			for _, t := range []*domTerm{alt.alt.Tags, alt.ruleTags} {
				if t != nil {
					terms = append(terms, t)
					addRankingTags(d.own, rankingLiterals(t))
				}
			}
			var tags *tagset
			if len(terms) > 0 {
				tags = knownRankingTags(&domTerm{Kind: tmUnion, Items: terms})
			} else if rankingSole(alt.alt.Expr) == nil {
				tags = &tagset{}
			}
			d.sets = append(d.sets, tags)
			if rankingSole(alt.alt.Expr) != nil {
				d.unary = append(d.unary, alt)
			}
			if alt.emit != nil {
				for _, item := range alt.emit.Items {
					addRankingTags(vocabulary, rankingLiterals(item.Tags))
				}
			}
		}
		addRankingTags(vocabulary, d.own)
		addRankingTags(vocabulary, d.omitted)
		data[rule.name] = d
	}
	for _, implication := range g.implications {
		for _, tag := range implication.thenNames {
			vocabulary[tag] = true
		}
	}
	for _, item := range g.classifierSet.items {
		for _, entry := range item.classifier.Entries {
			vocabulary[entry.Class] = true
		}
	}
	reachable := map[string]bool{}
	pending := []string{"text"}
	for len(pending) > 0 {
		n := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		if reachable[n] || data[n] == nil {
			continue
		}
		reachable[n] = true
		for child := range data[n].refs {
			pending = append(pending, child)
		}
	}
	terminals, omitted := map[string]bool{}, map[string]bool{}
	for n := range reachable {
		addRankingTags(terminals, data[n].terminals)
		addRankingTags(omitted, data[n].omitted)
	}
	allTerms := map[string]bool{}
	addRankingTags(allTerms, terminals)
	addRankingTags(allTerms, omitted)
	report := RankingReport{Name: g.name, KeySteps: []RankingStepReport{}, CountedChanges: []CountedRuleChange{}, InheritedRankingTags: []RankingTagReport{}, DroppedRankingTags: []RankingTagReport{}, VocabularyWarnings: []RankingVocabularyWarning{}}
	for step, key := range g.steps {
		names, tested, positive := rankingTested(key.pattern)
		possible, unknown := false, false
		countedRules := map[string]bool{}
		observe := func(answer int) { possible = possible || answer == 1; unknown = unknown || answer < 0 }
		for _, rule := range g.rules {
			d := data[rule.name]
			hasUnknown := false
			for _, set := range d.sets {
				hasUnknown = hasUnknown || set == nil
			}
			carried := map[string]bool{}
			for tag := range tested {
				if d.own[tag] || tag == "_Elided" {
					continue
				}
				if hasUnknown {
					carried[tag] = true
				} else {
					for _, set := range d.sets {
						if set.has(tag) {
							carried[tag] = true
						}
					}
				}
			}
			if len(carried) > 0 {
				report.InheritedRankingTags = append(report.InheritedRankingTags, RankingTagReport{Rule: rule.name, Step: step, Tags: sortedRankingTags(carried), Unknown: hasUnknown})
			}
			for _, alt := range d.unary {
				terms := []*domTerm{}
				literal := map[string]bool{}
				for _, t := range []*domTerm{alt.alt.Tags, alt.ruleTags} {
					if t != nil {
						terms = append(terms, t)
						addRankingTags(literal, rankingLiterals(t))
					}
				}
				testedLiteral := false
				for tag := range literal {
					testedLiteral = testedLiteral || tested[tag]
				}
				if !testedLiteral {
					continue
				}
				child := rankingSole(alt.alt.Expr)
				var source *rankingRuleData
				if child.Kind == exRef {
					source = data[child.Name]
				}
				explicit := knownRankingTags(&domTerm{Kind: tmUnion, Items: terms})
				lost := map[string]bool{}
				sourceUnknown := source == nil || explicit == nil
				if source != nil {
					for _, set := range source.sets {
						if set == nil {
							sourceUnknown = true
							continue
						}
						for _, tag := range set.names {
							if explicit != nil && !explicit.has(tag) {
								lost[tag] = true
							}
						}
					}
				}
				report.DroppedRankingTags = append(report.DroppedRankingTags, RankingTagReport{Rule: rule.name, Step: step, Tags: sortedRankingTags(lost), Unknown: sourceUnknown, Document: alt.doc, Line: alt.at[0], Column: alt.at[1]})
			}
			counted := names[rule.name]
			for tag := range d.own {
				counted = counted || tested[tag]
			}
			if counted {
				countedRules[rule.name] = true
			}
			if reachable[rule.name] {
				for _, tags := range d.sets {
					observe(possibleNodeMatch(key.pattern, rule.name, "", false, tags))
				}
			}
		}
		for _, change := range g.changes {
			if countedRules[change.rule] {
				report.CountedChanges = append(report.CountedChanges, CountedRuleChange{Step: step, Rule: change.rule, Kind: map[string]string{"extend": "extended", "replace": "replaced"}[change.op], Document: change.document})
			}
		}
		for t := range terminals {
			observe(possibleNodeMatch(key.pattern, "", t, false, nil))
		}
		for t := range omitted {
			observe(possibleNodeMatch(key.pattern, "", t, true, nil))
		}
		status := "impossible"
		if !rankingDead(key.pattern, reachable, allTerms) {
			if unknown {
				status = "unknown"
			} else if possible {
				status = "possible"
			}
		}
		w := &jsonWriter{}
		w.pattern(key.pattern)
		report.KeySteps = append(report.KeySteps, RankingStepReport{Step: step, Pattern: rankingPatternText(w.buf, g.uni), Status: status})
		for _, tag := range sortedRankingTags(positive) {
			if !vocabulary[tag] && !(strings.HasPrefix(tag, "_") && engineTag(tag)) {
				report.VocabularyWarnings = append(report.VocabularyWarnings, RankingVocabularyWarning{Stage: g.name, Step: step, Tag: tag})
			}
		}
	}
	return report, vocabulary
}

// RankingReports returns static reports for each stage's key steps.
func (p *Pipeline) RankingReports() []RankingReport {
	out := make([]RankingReport, 0, len(p.stages))
	vocabulary := map[string]bool{}
	for _, g := range p.stages {
		report, next := rankingStageReport(g, vocabulary)
		vocabulary = next
		out = append(out, report)
	}
	return out
}

// LoadWarnings returns loading warnings about the stage vocabulary.
func (p *Pipeline) LoadWarnings() []RankingVocabularyWarning { return slices.Clone(p.loadWarnings) }

// FormatRankingReports prints static ranking reports.
func FormatRankingReports(reports []RankingReport) string {
	lines := []string{}
	for _, r := range reports {
		lines = append(lines, r.Name+":")
		for _, s := range r.KeySteps {
			lines = append(lines, fmt.Sprintf("  ranking step %d: %s", s.Step+1, s.Status))
		}
		for _, c := range r.CountedChanges {
			lines = append(lines, fmt.Sprintf("  counted rule %s: %s, step %d", c.Rule, c.Kind, c.Step+1))
		}
		for _, group := range []struct {
			notes []RankingTagReport
			label string
		}{{r.InheritedRankingTags, "ranking tags without a literal"}, {r.DroppedRankingTags, "dropped inherited tags"}} {
			for _, n := range group.notes {
				unknown := ""
				if n.Unknown {
					unknown = " (unknown)"
				}
				lines = append(lines, fmt.Sprintf("  %s: %s, step %d, %s%s", group.label, n.Rule, n.Step+1, strings.Join(n.Tags, ", "), unknown))
			}
		}
		for _, w := range r.VocabularyWarnings {
			lines = append(lines, fmt.Sprintf("  warning: ranking step %d tests %s, outside the stage vocabulary", w.Step+1, w.Tag))
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
