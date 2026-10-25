package gencmu

import "sort"

func templateAudit(g *stageGrammar) templateObject {
	positions := map[string]int{}
	for i, r := range g.rules {
		positions[r.name] = i
	}
	ordered := append([]*ruleInstance{}, g.instances...)
	sort.SliceStable(ordered, func(i, j int) bool { return positions[ordered[i].effective()] < positions[ordered[j].effective()] })
	byName := map[string]*ruleInstance{}
	for _, i := range ordered {
		if i.name != "" {
			byName[i.name] = i
		}
	}
	reference := func(n templateObject) string {
		for _, key := range []string{"rule", "ref", "name"} {
			if value := templateText(n[key]); value != "" {
				return value
			}
		}
		return ""
	}
	var aliases func(any, any) bool
	aliases = func(a, b any) bool {
		switch a := a.(type) {
		case map[string]any:
			o, ok := b.(map[string]any)
			if !ok {
				return false
			}
			if i := byName[reference(a)]; i != nil && o["call"] != nil {
				return i.key == templateKey(templateNormalize(o))
			}
			if i := byName[reference(o)]; i != nil && a["call"] != nil {
				return i.key == templateKey(templateNormalize(a))
			}
			ak, bk := 0, 0
			for k, v := range a {
				if k != "at" && k != templateSourceKey {
					ak++
					if !aliases(v, o[k]) {
						return false
					}
				}
			}
			for k := range o {
				if k != "at" && k != templateSourceKey {
					bk++
				}
			}
			return ak == bk
		case []any:
			o, ok := b.([]any)
			if !ok || len(a) != len(o) {
				return false
			}
			for i, v := range a {
				if !aliases(v, o[i]) {
					return false
				}
			}
			return true
		default:
			return a == b
		}
	}
	templates, instances := []any{}, []any{}
	for _, t := range g.templates {
		used := map[int]bool{}
		for _, e := range templateRetained(t.events) {
			for _, n := range templateNodes(e.rule) {
				if n["param"] != nil {
					for i, p := range templateList(e.rule["params"]) {
						if p == n["param"] {
							used[i] = true
						}
					}
				}
			}
		}
		parameters := templateList(t.events[0].rule["params"])
		notes := []any{}
		for i, p := range parameters {
			if !used[i] {
				notes = append(notes, templateObject{"kind": "unused-parameter", "parameter": p})
			}
		}
		called := false
		for _, i := range ordered {
			called = called || i.call["call"] == t.name
		}
		if !called {
			notes = append(notes, templateObject{"kind": "uncalled-template"})
		}
		templates = append(templates, templateObject{"template": t.name, "parameters": parameters, "document": t.path, "line": float64(t.at[0]), "column": float64(t.at[1]), "notes": notes})
	}
	for _, i := range ordered {
		t := (*ruleTemplate)(nil)
		for _, v := range g.templates {
			if v.name == i.call["call"] {
				t = v
				break
			}
		}
		indices := map[int]bool{}
		for _, e := range t.events {
			indices[e.index] = true
		}
		flags, events := []any{}, []any{}
		for _, e := range i.definitions {
			before := append([]any{}, flags...)
			if e.rule["op"] != "extend" {
				flags = append([]any{}, templateList(e.rule["flags"])...)
			}
			scope := "instance"
			if indices[e.index] {
				scope = "template"
			}
			at := templateAt(e.rule)
			events = append(events, templateObject{"scope": scope, "op": e.rule["op"], "document": e.path, "line": float64(at[0]), "column": float64(at[1]), "flagsBefore": before, "flagsAfter": append([]any{}, flags...)})
		}
		twins := []any{}
		for _, other := range ordered {
			if other != i && other.call["call"] == i.call["call"] && aliases(other.call["args"], i.call["args"]) {
				twins = append(twins, other.effective())
			}
		}
		notes := []any{}
		if len(twins) > 0 {
			notes = append(notes, templateObject{"kind": "argument-alias-twin", "instances": twins})
		}
		at := templateAt(i.origin)
		var binding any
		if i.binding != nil {
			binding = i.binding
		}
		instances = append(instances, templateObject{"template": i.call["call"], "arguments": templateIdentity(i.call["args"]), "name": i.effective(), "binding": binding, "firstCall": templateObject{"document": i.origin["document"], "line": float64(at[0]), "column": float64(at[1])}, "flags": flags, "events": events, "notes": notes})
	}
	return templateObject{"templates": templates, "instances": instances}
}
