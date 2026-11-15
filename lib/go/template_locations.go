package gencmu

import "fmt"

const templateSourceKey = "\x00source"

type templateSource struct{ at, defaultAt [2]int }

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
func templateAnnotateTerm(n templateObject, t *domTerm) {
	if t == nil || n == nil {
		return
	}
	templateLocate(n, t.At)
	if t.Kind == tmBody {
		templateAnnotateExpr(templateObj(n["body"]), t.Body)
		return
	}
	if t.Kind == tmSourceCall {
		annotateSourceCall(n, t.Call)
		return
	}
	if t.Kind == tmPattern {
		annotateSourcePattern(templateObj(n["pattern"]), t.Pattern)
		return
	}
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
	if c.Kind == cdForest {
		templateAnnotateTerm(n, c.Left)
		return
	}
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
	templateLocate(n, e.At)
	if e.Kind == exCall {
		annotateSourceCall(n, e.Call)
	}
	if e.DefaultAt != [2]int{} {
		templateLocate(n, [2]int{})
		n[templateSourceKey].(*templateSource).defaultAt = e.DefaultAt
	}
	templateAnnotateTerm(templateObj(n["default"]), e.Default)
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
		n := templateObj(templateList(raw["rules"])[i])
		templateNativeRuleSource(n, r)
		annotateSourceArguments(templateList(n["args"]), r.Args)
		if r.Instance != nil {
			annotateSourceCall(templateObj(n["instance"]), r.Instance)
		}
	}
	for i, r := range d.Constants {
		templateAnnotateTerm(templateObj(templateObj(templateList(raw["constants"])[i])["value"]), r.Value)
	}
	for i, r := range d.Directives {
		n := templateObj(templateList(raw["directives"])[i])
		for j, condition := range r.Conditions {
			templateAnnotateCond(templateObj(templateList(n["conditions"])[j]), condition)
		}
	}
	for i, r := range d.Implications {
		n := templateObj(templateList(raw["implications"])[i])
		templateAnnotateTerm(templateObj(n["if"]), r.If)
		templateAnnotateTerm(templateObj(n["then"]), r.Then)
	}
}
func templateNativeRuleSource(raw templateObject, r *domRule) {
	templateAnnotateTerm(templateObj(raw["tags"]), r.Tags)
	templateAnnotateTerm(templateObj(raw["value"]), r.Value)
	templateAnnotateTerm(templateObj(raw["image"]), r.Image)
	for i, c := range r.Conditions {
		templateAnnotateCond(templateObj(templateList(raw["conditions"])[i]), c)
	}
	for i, a := range r.Alternatives {
		n := templateObj(templateList(raw["alternatives"])[i])
		templateAnnotateExpr(templateObj(n["expr"]), a.Expr)
		templateAnnotateTerm(templateObj(n["tags"]), a.Tags)
		templateAnnotateTerm(templateObj(n["value"]), a.Value)
		templateAnnotateTerm(templateObj(n["image"]), a.Image)
	}
}
func restoreTemplateRuleLocations(r *domRule, raw templateObject) {
	var term func(*domTerm, templateObject)
	var cond func(*domCond, templateObject)
	var expr func(*domExpr, templateObject, string)
	term = func(t *domTerm, n templateObject) {
		if t == nil || n == nil {
			return
		}
		if at := templateSourceAt(n); at != [2]int{} {
			t.At = at
		}
		if t.Kind == tmPattern {
			walkSourcePattern(templateObj(n["pattern"]), t.Pattern, func(raw templateObject, p *domPattern) {
				if at := templateSourceAt(raw); at != [2]int{} {
					p.At = at
				}
				if p.Kind == "test" {
					term(p.Value, templateObj(raw["value"]))
					for i, r := range p.Requirements {
						term(r.Value, templateObj(templateObj(templateList(raw["requirements"])[i])["value"]))
					}
				}
			})
			return
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
	expr = func(e *domExpr, n templateObject, path string) {
		if e == nil || n == nil {
			return
		}
		if s, ok := n[templateSourceKey].(*templateSource); ok {
			e.DefaultAt = s.defaultAt
		}
		// A ranked expression's position is its own at, which the DOM
		// now holds, so no side table of ranked positions is kept.
		for i, v := range templateList(n[e.Kind]) {
			if i < len(e.Items) {
				expr(e.Items[i], templateObj(v), fmt.Sprintf("%s/%s/%d", path, e.Kind, i))
			}
		}
		innerKey := e.Kind
		if e.Kind == exCapture || e.Kind == exTest {
			innerKey = "expr"
		}
		expr(e.Inner, templateObj(n[innerKey]), path+"/"+innerKey)
		expr(e.Sep, templateObj(n["separator"]), path+"/separator")
		term(e.Default, templateObj(n["default"]))
		term(e.Value, templateObj(n["value"]))
		if e.Kind == exLiteral {
			term(e.Value, templateObj(n["literal"]))
		}
	}
	for i, a := range r.Alternatives {
		n := templateObj(templateList(raw["alternatives"])[i])
		expr(a.Expr, templateObj(n["expr"]), "")
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
