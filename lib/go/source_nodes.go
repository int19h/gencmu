package gencmu

// Calls and arguments belong to the source DOM. Expansion resolves them before
// the runtime grammar receives a rule.
type domSourceCall struct {
	Name string
	Args []*domArgument
	At   [2]int
}

type domArgument struct {
	Term         *domTerm
	Expr         *domExpr
	Body         bool
	Requirements []tagRequirement
	Targets      []*domTerm
}

func nativeRuleSource(r *domRule) templateObject {
	raw := templateWritten(r)
	templateNativeRuleSource(raw, r)
	if r.Args != nil {
		annotateSourceArguments(templateList(raw["args"]), r.Args)
	}
	if r.Instance != nil {
		annotateSourceCall(templateObj(raw["instance"]), r.Instance)
	}
	return raw
}

func annotateSourceCall(raw templateObject, call *domSourceCall) {
	templateLocate(raw, call.At)
	annotateSourceArguments(templateList(raw["args"]), call.Args)
}

func annotateSourceArguments(raw []any, args []*domArgument) {
	for i, arg := range args {
		n := templateObj(raw[i])
		if arg.Term != nil {
			templateAnnotateTerm(n, arg.Term)
		}
		if arg.Expr != nil {
			if arg.Body {
				n = templateObj(n["body"])
			}
			templateAnnotateExpr(n, arg.Expr)
		}
		for j, requirement := range arg.Requirements {
			templateAnnotateTerm(templateObj(templateObj(templateList(n["requirements"])[j])["value"]), requirement.Value)
		}
		for j, target := range arg.Targets {
			templateAnnotateTerm(templateObj(templateList(n["targets"])[j]), target)
		}
	}
}

func annotateSourcePattern(raw templateObject, pattern *domPattern) {
	type task struct {
		raw     any
		pattern *domPattern
	}
	pending := []task{{raw, pattern}}
	for len(pending) > 0 {
		t := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		p := t.pattern
		if p == nil {
			continue
		}
		n := templateObj(t.raw)
		switch p.Kind {
		case "sequence":
			for i, v := range templateList(t.raw) {
				if i < len(p.Items) {
					pending = append(pending, task{v, p.Items[i]})
				}
			}
		case "node":
			pending = append(pending, task{n["child"], p.Items[0]})
		case "optional", "repeat":
			pending = append(pending, task{n[p.Kind], p.Items[0]})
			if len(p.Items) > 1 {
				pending = append(pending, task{n["separator"], p.Items[1]})
			}
		case "choice", "union", "intersection", "difference":
			for i, v := range templateList(n[p.Kind]) {
				pending = append(pending, task{v, p.Items[i]})
			}
		case "path":
			pending = append(pending, task{n["pattern"], p.Items[0]})
		case "test":
			pending = append(pending, task{n["expr"], p.Items[0]})
			templateAnnotateTerm(templateObj(n["value"]), p.Value)
		case "call":
			annotateSourceCall(n, p.Call)
		}
		if p.Attached != nil {
			pending = append(pending, task{n["children"], &domPattern{Kind: "sequence", Items: p.Attached}})
		}
	}
}

// Cache errors retain their DOM. A fresh read supplies private positions only.
func restoreSourceLocations(to, from *domDoc) {
	type pair struct{ target, source any }
	copyRaw := func(target, source templateObject) {
		pending := []pair{{target, source}}
		for len(pending) > 0 {
			p := pending[len(pending)-1]
			pending = pending[:len(pending)-1]
			if target := templateObj(p.target); target != nil {
				source := templateObj(p.source)
				if source == nil {
					continue
				}
				if at := source[templateSourceKey]; at != nil {
					target[templateSourceKey] = at
				}
				for key, value := range target {
					if key != templateSourceKey {
						pending = append(pending, pair{value, source[key]})
					}
				}
			} else if target := templateList(p.target); target != nil {
				source := templateList(p.source)
				for i, value := range target {
					if i < len(source) {
						pending = append(pending, pair{value, source[i]})
					}
				}
			}
		}
	}
	constants := map[[2]int]*domConst{}
	for _, value := range from.Constants {
		constants[value.At] = value
	}
	for _, value := range to.Constants {
		if original := constants[value.At]; original != nil && value.rawTemplate != nil {
			copyRaw(value.rawTemplate, original.rawTemplate)
		}
	}
	directives := map[[2]int]*domDirective{}
	for _, value := range from.Directives {
		directives[value.At] = value
	}
	for _, value := range to.Directives {
		if original := directives[value.At]; original != nil && value.rawTemplate != nil {
			copyRaw(value.rawTemplate, original.rawTemplate)
		}
	}
	implications := map[[2]int]*domImplication{}
	for _, value := range from.Implications {
		implications[value.At] = value
	}
	for _, value := range to.Implications {
		if original := implications[value.At]; original != nil && value.rawTemplate != nil {
			copyRaw(value.rawTemplate, original.rawTemplate)
		}
	}
	written := map[[2]int]*domRule{}
	for _, rule := range from.Rules {
		written[rule.At] = rule
	}
	for _, rule := range to.Rules {
		source := written[rule.At]
		if source == nil {
			continue
		}
		if rule.rawTemplate != nil {
			raw := source.rawTemplate
			if raw == nil {
				raw = nativeRuleSource(source)
			}
			copyRaw(rule.rawTemplate, raw)
			continue
		}
		type exprPair struct{ target, source *domExpr }
		var pending []exprPair
		for i, alt := range rule.Alternatives {
			if i < len(source.Alternatives) {
				pending = append(pending, exprPair{alt.Expr, source.Alternatives[i].Expr})
			}
		}
		for len(pending) > 0 {
			p := pending[len(pending)-1]
			pending = pending[:len(pending)-1]
			if p.target == nil || p.source == nil || p.target.Kind != p.source.Kind {
				continue
			}
			p.target.RankedAt = p.source.RankedAt
			pending = append(pending, exprPair{p.target.Inner, p.source.Inner}, exprPair{p.target.Sep, p.source.Sep})
			for i, child := range p.target.Items {
				if i < len(p.source.Items) {
					pending = append(pending, exprPair{child, p.source.Items[i]})
				}
			}
		}
	}
}

func writeParameter(w *jsonWriter, name string, at [2]int) {
	w.raw(`{"param":`)
	w.str(name)
	w.raw(`,"at":`)
	w.pair(at)
	w.raw("}")
}

func (c *domSourceCall) writeJSON(w *jsonWriter) {
	w.raw(`{"call":`)
	w.str(c.Name)
	w.raw(`,"args":`)
	writeSourceArguments(w, c.Args)
	w.raw(`,"at":`)
	w.pair(c.At)
	w.raw("}")
}

func writeSourceArguments(w *jsonWriter, args []*domArgument) {
	w.raw("[")
	for i, arg := range args {
		if i > 0 {
			w.raw(",")
		}
		switch {
		case arg.Term != nil:
			arg.Term.writeJSON(w)
		case arg.Expr != nil:
			if arg.Body {
				w.raw(`{"body":`)
			}
			arg.Expr.writeJSON(w)
			if arg.Body {
				w.raw("}")
			}
		case arg.Requirements != nil:
			w.raw(`{"requirements":`)
			writeRequirements(w, arg.Requirements)
			w.raw("}")
		case arg.Targets != nil:
			w.raw(`{"targets":[`)
			for i, target := range arg.Targets {
				if i > 0 {
					w.raw(",")
				}
				target.writeJSON(w)
			}
			w.raw("]}")
		}
	}
	w.raw("]")
}

func sourceArgument(expr *domExpr) *domArgument {
	switch expr.Kind {
	case exRef:
		kind := tmRule
		if isTerminalName(expr.Name) {
			kind = tmTag
		}
		return &domArgument{Term: &domTerm{Kind: kind, Str: expr.Name, At: expr.At}}
	case exLiteral:
		return &domArgument{Term: expr.Value}
	case exParam:
		return &domArgument{Term: &domTerm{Kind: tmParam, Str: expr.Name, At: expr.At}}
	case exCall:
		return &domArgument{Term: &domTerm{Kind: tmSourceCall, Call: expr.Call, At: expr.At}}
	case exTest, exRange, exWildcard:
		return &domArgument{Expr: expr}
	default:
		return &domArgument{Expr: expr, Body: true}
	}
}
