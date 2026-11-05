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
	Variants             int
	Captures             []string
}

func diagnosticNotes(g *stageGrammar) []DiagnosticNote {
	references := func(root *domExpr) map[string]bool {
		found := map[string]bool{}
		pending := []*domExpr{root}
		for len(pending) > 0 {
			node := pending[len(pending)-1]
			pending = pending[:len(pending)-1]
			if node == nil {
				continue
			}
			if node.Kind == exRef && g.byName[node.Name] != nil {
				found[node.Name] = true
			}
			pending = append(pending, node.Items...)
			pending = append(pending, node.Inner, node.Sep)
		}
		return found
	}
	edges := map[string]map[string]bool{}
	warnings, errors := map[string]bool{}, map[string]bool{}
	for _, rule := range g.rules {
		edges[rule.name] = map[string]bool{}
		for _, alt := range rule.alts {
			for target := range references(alt.alt.Expr) {
				edges[rule.name][target] = true
			}
			warnings[rule.name] = warnings[rule.name] || alt.warning != nil
			errors[rule.name] = errors[rule.name] || alt.error != nil
		}
	}
	closure := func(roots map[string]bool) map[string]bool {
		found := map[string]bool{}
		var pending []string
		for name := range roots {
			pending = append(pending, name)
		}
		for len(pending) > 0 {
			name := pending[len(pending)-1]
			pending = pending[:len(pending)-1]
			if found[name] {
				continue
			}
			found[name] = true
			for child := range edges[name] {
				pending = append(pending, child)
			}
		}
		return found
	}
	var notes []DiagnosticNote
	for _, rule := range g.rules {
		for _, alt := range rule.alts {
			where := DiagnosticNote{Rule: rule.name, Document: alt.doc, Line: alt.at[0], Column: alt.at[1]}
			roots := map[string]bool{}
			visit := func(part clausePart) bool {
				var targets []*domTerm
				if condition := part.c; condition != nil && (condition.Kind == cdMatches || condition.Kind == cdBegins || condition.Kind == cdEnds) {
					targets = condition.queryTargets()
				}
				if term := part.t; term != nil && term.Kind == tmCall && term.Str == "tags" && len(term.Items) > 1 {
					targets = term.Items[1:]
				}
				for _, target := range targets {
					if target.Kind == tmRule {
						roots[target.Str] = true
					}
				}
				return true
			}
			for _, term := range []*domTerm{alt.ruleTags, alt.alt.Tags} {
				walkClause(clausePart{t: term}, visit)
			}
			for _, condition := range alt.conds {
				walkClause(clausePart{c: condition}, visit)
			}
			if alt.emit != nil {
				for _, item := range alt.emit.Items {
					walkClause(clausePart{t: item.Tags}, visit)
				}
			}
			reached := closure(roots)
			for _, target := range g.rules {
				if reached[target.name] && errors[target.name] {
					note := where
					note.Kind = "query-error"
					note.Target = target.name
					notes = append(notes, note)
				}
			}
			possible := map[string]bool{}
			if alt.warning != nil {
				possible[rule.name] = true
			}
			for target := range closure(references(alt.alt.Expr)) {
				if warnings[target] {
					possible[target] = true
				}
			}
			codes := map[string]bool{}
			for _, code := range alt.suppressWarnings {
				if codes[code] {
					continue
				}
				codes[code] = true
				if code == "_" && len(possible) == 0 || code != "_" && !possible[code] {
					note := where
					note.Kind = "unused-suppression"
					note.Code = code
					notes = append(notes, note)
				}
			}
			terms := []*domTerm{}
			for _, term := range []*domTerm{alt.ruleTags, alt.alt.Tags} {
				if term != nil {
					terms = append(terms, term)
				}
			}
			term := &domTerm{Kind: tmUnion, Items: terms}
			if len(neighbourGuards(term)) == 0 {
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
