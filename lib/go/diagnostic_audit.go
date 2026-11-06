package gencmu

import (
	"encoding/json"
	"sort"
)

// DiagnosticNote names a query, suppression, or guarded tag expansion.
type DiagnosticNote struct {
	Kind, Rule, Document string
	Line, Column         int
	Target, Code         string
	Filtered             bool
	Variants             int
	Captures             []string
}

// Audit roots retain whether a query filters carried errors (§4.3).
type auditTargets struct{ names map[string]uint8 }

func diagnosticNotes(g *stageGrammar) []DiagnosticNote {
	referencesCache := map[*domExpr]map[string]bool{}
	references := func(root *domExpr) map[string]bool {
		if known, ok := referencesCache[root]; ok {
			return known
		}
		found := map[string]bool{}
		walkQueryBody(root, func(node *domExpr) bool {
			if node.Kind == exRef && g.byName[node.Name] != nil {
				found[node.Name] = true
			}
			return true
		}, nil)
		referencesCache[root] = found
		return found
	}
	edges := map[string]map[string]bool{}
	warnings, errors := map[string]bool{}, map[string]bool{}
	order := map[string]int{}
	for index, rule := range g.rules {
		order[rule.name] = index
		edges[rule.name] = map[string]bool{}
		for _, alt := range rule.alts {
			evidenceAuditClosure()
			for target := range references(alt.alt.Expr) {
				edges[rule.name][target] = true
			}
			warnings[rule.name] = warnings[rule.name] || alt.warning != nil
			errors[rule.name] = errors[rule.name] || alt.error != nil
		}
	}
	closure := func(roots map[string]uint8) map[string]uint8 {
		found := map[string]uint8{}
		type entry struct {
			name string
			bits uint8
		}
		var pending []entry
		for name, bits := range roots {
			pending = append(pending, entry{name, bits})
		}
		for len(pending) > 0 {
			evidenceAuditClosure()
			at := pending[len(pending)-1]
			pending = pending[:len(pending)-1]
			added := at.bits &^ found[at.name]
			if added == 0 {
				continue
			}
			found[at.name] |= added
			for child := range edges[at.name] {
				evidenceAuditClosure()
				pending = append(pending, entry{child, added})
			}
		}
		return found
	}
	empty := &auditTargets{names: map[string]uint8{}}
	rootsCache := map[clausePart]*auditTargets{}
	targetsOf := func(root clausePart) *auditTargets {
		if known, ok := rootsCache[root]; ok {
			return known
		}
		names := map[string]uint8{}
		type entry struct {
			part     clausePart
			filtered bool
		}
		pending := []entry{{part: root}}
		seen := map[entry]bool{}
		for len(pending) > 0 {
			evidenceWork()
			at := pending[len(pending)-1]
			pending = pending[:len(pending)-1]
			if seen[at] {
				continue
			}
			seen[at] = true
			var targets []string
			method := ""
			if condition := at.part.c; condition != nil && (condition.Kind == cdMatches || condition.Kind == cdBegins || condition.Kind == cdEnds) {
				for _, target := range condition.queryTargets() {
					if target.Kind == tmRule {
						targets = append(targets, target.Str)
					}
				}
			}
			if term := at.part.t; term != nil && term.Kind == tmCall {
				method = term.Str
				if method == "tags" && len(term.Items) > 1 {
					targets = append(targets, term.Items[1].Str)
				}
				if method == "parse" {
					walkQueryBody(term.Items[1].Body, func(node *domExpr) bool {
						if node.Kind == exRef {
							targets = append(targets, node.Name)
						}
						return true
					}, nil)
				}
			}
			bit := uint8(1)
			if at.filtered {
				bit = 2
			}
			for _, target := range targets {
				names[target] |= bit
			}
			for _, child := range at.part.children() {
				pending = append(pending, entry{child, at.filtered || method == "error-free"})
			}
		}
		result := empty
		if len(names) > 0 {
			result = &auditTargets{names: names}
		}
		rootsCache[root] = result
		return result
	}
	merge := func(into map[string]uint8, source *auditTargets) {
		for name, bits := range source.names {
			into[name] |= bits
		}
	}
	conditionsCache := map[condsKey]*auditTargets{}
	conditionsOf := func(conditions []*domCond) *auditTargets {
		if len(conditions) == 0 {
			return empty
		}
		key := condsKey{&conditions[0], len(conditions)}
		if known := conditionsCache[key]; known != nil {
			return known
		}
		names := map[string]uint8{}
		for _, condition := range conditions {
			merge(names, targetsOf(clausePart{c: condition}))
		}
		result := &auditTargets{names: names}
		conditionsCache[key] = result
		return result
	}
	emissionCache := map[*domEmit]*auditTargets{}
	emissionOf := func(emit *domEmit) *auditTargets {
		if emit == nil {
			return empty
		}
		if known := emissionCache[emit]; known != nil {
			return known
		}
		names := map[string]uint8{}
		for _, item := range emit.Items {
			for _, term := range []*domTerm{item.Tags, item.Value, item.Image} {
				merge(names, targetsOf(clausePart{t: term}))
			}
		}
		result := &auditTargets{names: names}
		emissionCache[emit] = result
		return result
	}
	type queryKey struct {
		definition *domRule
		own        *auditTargets
	}
	queriesCache := map[queryKey]map[string]uint8{}
	guards := map[*domTerm]bool{}
	guarded := func(term *domTerm) bool {
		if known, ok := guards[term]; ok {
			return known
		}
		found := len(neighbourGuards(term)) > 0
		guards[term] = found
		return found
	}
	var notes []DiagnosticNote
	for _, rule := range g.rules {
		for _, alt := range rule.alts {
			where := DiagnosticNote{Rule: rule.name, Document: alt.doc, Line: alt.at[0], Column: alt.at[1]}
			own := targetsOf(clausePart{t: alt.alt.Tags})
			key := queryKey{alt.definition, own}
			reached, known := queriesCache[key]
			if !known {
				roots := map[string]uint8{}
				for _, part := range []*auditTargets{own, emissionOf(alt.emit), targetsOf(clausePart{t: alt.ruleTags}), conditionsOf(alt.conds)} {
					merge(roots, part)
				}
				reached = closure(roots)
				for name := range reached {
					evidenceAuditClosure()
					if !errors[name] {
						delete(reached, name)
					}
				}
				queriesCache[key] = reached
			}
			var targets []string
			for target := range reached {
				evidenceAuditClosure()
				if errors[target] {
					targets = append(targets, target)
				}
			}
			sort.Slice(targets, func(i, j int) bool { return order[targets[i]] < order[targets[j]] })
			for _, target := range targets {
				for _, bit := range []uint8{1, 2} {
					if reached[target]&bit != 0 {
						note := where
						note.Kind = "query-error"
						note.Target = target
						note.Filtered = bit == 2
						notes = append(notes, note)
					}
				}
			}
			if len(alt.suppressWarnings) > 0 {
				roots := map[string]uint8{}
				for name := range references(alt.alt.Expr) {
					roots[name] = 1
				}
				possible := map[string]bool{}
				if alt.warning != nil {
					possible[rule.name] = true
				}
				for name := range closure(roots) {
					if warnings[name] {
						possible[name] = true
					}
				}
				seen := map[string]bool{}
				for _, code := range alt.suppressWarnings {
					if seen[code] {
						continue
					}
					seen[code] = true
					if code == "_" && len(possible) == 0 || code != "_" && !possible[code] {
						note := where
						note.Kind = "unused-suppression"
						note.Code = code
						notes = append(notes, note)
					}
				}
			}

			terms := []*domTerm{}
			for _, term := range []*domTerm{alt.ruleTags, alt.alt.Tags} {
				if term != nil {
					terms = append(terms, term)
				}
			}
			term := &domTerm{Kind: tmUnion, Items: terms}
			if !guarded(alt.ruleTags) && !guarded(alt.alt.Tags) {
				continue
			}
			owner := &domRule{Name: rule.name, Tags: alt.ruleTags, Value: alt.ruleValue, Image: alt.ruleImage, Conditions: alt.conds, Emit: alt.emit, Error: alt.error, Warning: alt.warning, Alternatives: []*domAlt{alt.alt}}
			for _, captures := range validationCaptures(owner, alt.alt) {
				present := func(name string) bool { _, ok := captures[name]; return ok || name == "" }
				variants, fault := guardedTagVariants(simplifyTerm(term, present))
				if fault != "" || len(variants) <= 8 {
					continue
				}
				note := where
				note.Kind = "guarded-tag-variants"
				note.Variants = len(variants)
				for name := range captures {
					if name != "" {
						note.Captures = append(note.Captures, name)
					}
				}
				sort.Strings(note.Captures)
				notes = append(notes, note)
			}
		}
	}
	found := map[string]bool{}
	unique := []DiagnosticNote{}
	for _, note := range notes {
		data, _ := json.Marshal(note)
		key := string(data)
		if !found[key] {
			found[key] = true
			unique = append(unique, note)
		}
	}
	return unique
}

func evidenceAuditClosure() {
	if w := work.Load(); w != nil {
		w.ruleSetSteps.add("rule set steps")
	}
}
