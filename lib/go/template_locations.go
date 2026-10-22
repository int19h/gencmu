package gencmu

import "fmt"

const templateSourceKey = "\x00source"

type templateSource struct{ at, ranked [2]int }

func templateLen(n templateObject) int {
	size := len(n)
	if n[templateSourceKey] != nil {
		size--
	}
	return size
}
func templateLocate(n templateObject, at [2]int) {
	s, _ := n[templateSourceKey].(*templateSource)
	if s == nil {
		n[templateSourceKey] = &templateSource{at: at}
	}
}
func templateSourceAt(n templateObject) [2]int {
	if s, ok := n[templateSourceKey].(*templateSource); ok {
		return s.at
	}
	return templateAt(n)
}
func templateSourceTerm(t *domTerm) templateObject {
	n := templateWritten(t)
	templateAnnotateTerm(n, t)
	return n
}
func templateSourceCond(c *domCond) templateObject {
	n := templateWritten(c)
	templateAnnotateCond(n, c)
	return n
}
func templateSourceExpr(e *domExpr) templateObject {
	n := templateWritten(e)
	templateAnnotateExpr(n, e)
	return n
}
func templateAnnotateTerm(n templateObject, t *domTerm) {
	if t == nil || n == nil {
		return
	}
	templateLocate(n, t.At)
	if t.Kind == tmCall {
		templateAnnotateTerm(templateObj(n["receiver"]), t.Items[0])
		for i, v := range templateList(n["args"]) {
			templateAnnotateTerm(templateObj(v), t.Items[i+1])
		}
	} else if t.Kind == tmIf {
		templateAnnotateCond(templateObj(n["if"]), t.Cond)
		templateAnnotateTerm(templateObj(n["then"]), t.Items[0])
	} else {
		for i, v := range templateList(n[t.Kind]) {
			if i < len(t.Items) {
				templateAnnotateTerm(templateObj(v), t.Items[i])
			}
		}
	}
}
func templateAnnotateCond(n templateObject, c *domCond) {
	if c == nil || n == nil {
		return
	}
	templateLocate(n, c.At)
	templateAnnotateTerm(templateObj(n["left"]), c.Left)
	templateAnnotateTerm(templateObj(n["right"]), c.Right)
	templateAnnotateTerm(templateObj(n["receiver"]), c.Span)
	for i, v := range templateList(n["args"]) {
		if i < len(c.Targets) {
			templateAnnotateTerm(templateObj(v), c.Targets[i])
		}
	}
	for _, key := range []string{"any", "all"} {
		for i, v := range templateList(n[key]) {
			if i < len(c.Items) {
				templateAnnotateCond(templateObj(v), c.Items[i])
			}
		}
	}
	templateAnnotateCond(templateObj(n["not"]), c.Inner)
	if c.Kind == cdIf && len(c.Items) == 2 {
		templateAnnotateCond(templateObj(n["if"]), c.Items[0])
		templateAnnotateCond(templateObj(n["then"]), c.Items[1])
	}
}
func templateAnnotateExpr(n templateObject, e *domExpr) {
	if e == nil || n == nil {
		return
	}
	for i, v := range templateList(n[e.Kind]) {
		if i < len(e.Items) {
			templateAnnotateExpr(templateObj(v), e.Items[i])
		}
	}
	key := e.Kind
	if e.Kind == exCapture || e.Kind == exTest {
		key = "expr"
	}
	templateAnnotateExpr(templateObj(n[key]), e.Inner)
	templateAnnotateExpr(templateObj(n["separator"]), e.Sep)
	templateAnnotateTerm(templateObj(n["value"]), e.Value)
	templateAnnotateTerm(templateObj(n["literal"]), e.Value)
}
func templateSourceDocument(raw templateObject, d *domDoc) {
	for i, r := range d.Rules {
		if r.rawTemplate != nil {
			templateList(raw["rules"])[i] = r.rawTemplate
		} else {
			templateNativeRuleSource(templateObj(templateList(raw["rules"])[i]), r)
		}
	}
	for i, r := range d.Constants {
		if r.rawTemplate != nil {
			templateList(raw["constants"])[i] = r.rawTemplate
		}
	}
	for i, r := range d.Directives {
		if r.rawTemplate != nil {
			templateList(raw["directives"])[i] = r.rawTemplate
		}
	}
	for i, r := range d.Implications {
		if r.rawTemplate != nil {
			templateList(raw["implications"])[i] = r.rawTemplate
		}
	}
}
func templateNativeRuleSource(raw templateObject, r *domRule) {
	for i, a := range r.Alternatives {
		var visit func(templateObject, string)
		visit = func(n templateObject, path string) {
			if at := a.rankedLocations[path]; at != [2]int{} {
				templateLocate(n, [2]int{})
				n[templateSourceKey].(*templateSource).ranked = at
			}
			for _, k := range []string{"seq", "and", "choice", "ranked"} {
				for index, v := range templateList(n[k]) {
					visit(templateObj(v), fmt.Sprintf("%s/%s/%d", path, k, index))
				}
			}
			for _, k := range []string{"optional", "repeat", "separator", "expr"} {
				if v := templateObj(n[k]); v != nil {
					visit(v, path+"/"+k)
				}
			}
		}
		visit(templateObj(templateObj(templateList(raw["alternatives"])[i])["expr"]), "")
	}
}
func restoreTemplateRuleLocations(r *domRule, raw templateObject) {
	var term func(*domTerm, templateObject)
	var cond func(*domCond, templateObject)
	var expr func(*domExpr, templateObject, string, map[string][2]int)
	term = func(t *domTerm, n templateObject) {
		if t == nil || n == nil {
			return
		}
		if at := templateSourceAt(n); at != [2]int{} {
			t.At = at
		}
		if t.Kind == tmCall {
			term(t.Items[0], templateObj(n["receiver"]))
			for i, a := range templateList(n["args"]) {
				if i+1 < len(t.Items) {
					term(t.Items[i+1], templateObj(a))
				}
			}
			return
		}
		if t.Kind == tmIf {
			cond(t.Cond, templateObj(n["if"]))
			if len(t.Items) > 0 {
				term(t.Items[0], templateObj(n["then"]))
			}
			return
		}
		for i, v := range templateList(n[t.Kind]) {
			if i < len(t.Items) {
				term(t.Items[i], templateObj(v))
			}
		}
	}
	cond = func(c *domCond, n templateObject) {
		if c == nil || n == nil {
			return
		}
		if at := templateSourceAt(n); at != [2]int{} {
			c.At = at
		}
		term(c.Left, templateObj(n["left"]))
		term(c.Right, templateObj(n["right"]))
		term(c.Span, templateObj(n["receiver"]))
		for i, t := range c.Targets {
			if i < len(templateList(n["args"])) {
				term(t, templateObj(templateList(n["args"])[i]))
			}
		}
		for _, key := range []string{"any", "all"} {
			for i, v := range templateList(n[key]) {
				if i < len(c.Items) {
					cond(c.Items[i], templateObj(v))
				}
			}
		}
		cond(c.Inner, templateObj(n["not"]))
		if c.Kind == cdIf && len(c.Items) == 2 {
			cond(c.Items[0], templateObj(n["if"]))
			cond(c.Items[1], templateObj(n["then"]))
		}
	}
	expr = func(e *domExpr, n templateObject, path string, locations map[string][2]int) {
		if e == nil || n == nil {
			return
		}
		if s, ok := n[templateSourceKey].(*templateSource); ok && s.ranked != [2]int{} {
			locations[path] = s.ranked
		}
		for i, v := range templateList(n[e.Kind]) {
			if i < len(e.Items) {
				expr(e.Items[i], templateObj(v), fmt.Sprintf("%s/%s/%d", path, e.Kind, i), locations)
			}
		}
		innerKey := e.Kind
		if e.Kind == exCapture || e.Kind == exTest {
			innerKey = "expr"
		}
		expr(e.Inner, templateObj(n[innerKey]), path+"/"+innerKey, locations)
		expr(e.Sep, templateObj(n["separator"]), path+"/separator", locations)
		term(e.Value, templateObj(n["value"]))
		if e.Kind == exLiteral {
			term(e.Value, templateObj(n["literal"]))
		}
	}
	for i, a := range r.Alternatives {
		n := templateObj(templateList(raw["alternatives"])[i])
		a.rankedLocations = map[string][2]int{}
		expr(a.Expr, templateObj(n["expr"]), "", a.rankedLocations)
		term(a.Tags, templateObj(n["tags"]))
		term(a.Value, templateObj(n["value"]))
		term(a.Image, templateObj(n["image"]))
	}
	term(r.Tags, templateObj(raw["tags"]))
	term(r.Value, templateObj(raw["value"]))
	term(r.Image, templateObj(raw["image"]))
	for i, c := range r.Conditions {
		if i < len(templateList(raw["conditions"])) {
			cond(c, templateObj(templateList(raw["conditions"])[i]))
		}
	}
}

func restoreTemplateRankedLocations(d *domDoc, tokens []Token, position func(int) [2]int) bool {
	raw := false
	for _, r := range d.Rules {
		raw = raw || r.rawTemplate != nil
	}
	if !raw {
		return false
	}
	separators := [][2]int{}
	for _, t := range tokens {
		if t.Value == "≻" {
			separators = append(separators, position(t.Source[0]))
		}
	}
	root, e := templateFromJSON(d.json())
	if e != nil {
		return true
	}
	templateSourceDocument(root, d)
	index := 0
	var visit func(any)
	visit = func(v any) {
		switch n := v.(type) {
		case []any:
			for _, c := range n {
				visit(c)
			}
		case map[string]any:
			if xs := templateList(n["ranked"]); len(xs) > 0 {
				visit(xs[0])
				if index < len(separators) {
					s, _ := n[templateSourceKey].(*templateSource)
					if s == nil {
						s = &templateSource{}
					} else {
						copy := *s
						s = &copy
					}
					s.ranked = separators[index]
					n[templateSourceKey] = s
				}
				for _, c := range xs[1:] {
					index++
					visit(c)
				}
				return
			}
			if n["alternatives"] != nil {
				visit(n["args"])
				for i, a := range templateList(n["alternatives"]) {
					alt := templateObj(a)
					for _, k := range []string{"expr", "tags", "value", "image"} {
						visit(alt[k])
					}
					if i == 0 {
						for _, k := range []string{"tags", "value", "image", "conditions", "emit"} {
							visit(n[k])
						}
					}
				}
				return
			}
			if n["method"] != nil {
				visit(n["receiver"])
				visit(n["args"])
				return
			}
			if n["call"] != nil {
				visit(n["args"])
				return
			}
			for _, k := range templateOrderedKeys(n) {
				if k != "at" {
					visit(n[k])
				}
			}
		}
	}
	for _, it := range itemsInOrder(d) {
		var n templateObject
		switch {
		case it.rule != nil:
			for i, r := range d.Rules {
				if r == it.rule {
					n = templateObj(templateList(root["rules"])[i])
					break
				}
			}
		case it.constant != nil:
			n = it.constant.rawTemplate
		case it.dir != nil:
			n = it.dir.rawTemplate
		case it.implication != nil:
			n = it.implication.rawTemplate
		}
		if n != nil {
			visit(n)
		}
	}
	for i, r := range d.Rules {
		if r.rawTemplate == nil {
			restoreTemplateRuleLocations(r, templateObj(templateList(root["rules"])[i]))
		}
	}
	return true
}
