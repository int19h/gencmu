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
	walkSourcePattern(raw, pattern, func(n templateObject, p *domPattern) {
		if p.Kind == "test" {
			templateAnnotateTerm(templateObj(n["value"]), p.Value)
			for i, r := range p.Requirements {
				templateAnnotateTerm(templateObj(templateObj(templateList(n["requirements"])[i])["value"]), r.Value)
			}
		}
		if p.Kind == "call" {
			annotateSourceCall(n, p.Call)
		}
	})
}

func walkSourcePattern(raw templateObject, pattern *domPattern, visit func(templateObject, *domPattern)) {
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
		if n != nil {
			visit(n, p)
		}
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
			if len(p.Items) > 0 {
				pending = append(pending, task{n["expr"], p.Items[0]})
			}
		}
		if p.Attached != nil {
			pending = append(pending, task{n["children"], &domPattern{Kind: "sequence", Items: p.Attached}})
		}
	}
}

// Cache errors retain their DOM. A fresh read supplies private positions only.
func restoreSourceLocations(to, from *domDoc) {
	type pair struct{ target, source any }
	var pending []pair
	originals := map[[2]int]any{}
	for _, r := range from.Rules {
		originals[r.At] = r
	}
	for _, r := range from.Constants {
		originals[r.At] = r
	}
	for _, r := range from.Directives {
		originals[r.At] = r
	}
	for _, r := range from.Implications {
		originals[r.At] = r
	}
	for _, r := range to.Rules {
		pending = append(pending, pair{r, originals[r.At]})
	}
	for _, r := range to.Constants {
		pending = append(pending, pair{r, originals[r.At]})
	}
	for _, r := range to.Directives {
		pending = append(pending, pair{r, originals[r.At]})
	}
	for _, r := range to.Implications {
		pending = append(pending, pair{r, originals[r.At]})
	}
	terms := func(a, b []*domTerm) {
		for i, v := range a {
			if i < len(b) {
				pending = append(pending, pair{v, b[i]})
			}
		}
	}
	exprs := func(a, b []*domExpr) {
		for i, v := range a {
			if i < len(b) {
				pending = append(pending, pair{v, b[i]})
			}
		}
	}
	conds := func(a, b []*domCond) {
		for i, v := range a {
			if i < len(b) {
				pending = append(pending, pair{v, b[i]})
			}
		}
	}
	args := func(a, b []*domArgument) {
		for i, v := range a {
			if i < len(b) {
				pending = append(pending, pair{v, b[i]})
			}
		}
	}
	patterns := func(a, b []*domPattern) {
		for i, v := range a {
			if i < len(b) {
				pending = append(pending, pair{v, b[i]})
			}
		}
	}
	requirements := func(a, b []tagRequirement) {
		for i, v := range a {
			if i < len(b) {
				pending = append(pending, pair{v.Value, b[i].Value})
			}
		}
	}
	for len(pending) > 0 {
		current := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		switch a := current.target.(type) {
		case *domRule:
			b, ok := current.source.(*domRule)
			if !ok || a == nil || b == nil {
				continue
			}
			pending = append(pending, pair{a.Tags, b.Tags}, pair{a.Value, b.Value}, pair{a.Image, b.Image}, pair{a.Instance, b.Instance}, pair{a.Emit, b.Emit})
			args(a.Args, b.Args)
			conds(a.Conditions, b.Conditions)
			for i, v := range a.Alternatives {
				if i < len(b.Alternatives) {
					pending = append(pending, pair{v, b.Alternatives[i]})
				}
			}
		case *domAlt:
			b, ok := current.source.(*domAlt)
			if !ok || a == nil || b == nil {
				continue
			}
			pending = append(pending, pair{a.Expr, b.Expr}, pair{a.Tags, b.Tags}, pair{a.Value, b.Value}, pair{a.Image, b.Image})
		case *domConst:
			b, ok := current.source.(*domConst)
			if ok && a != nil && b != nil {
				pending = append(pending, pair{a.Value, b.Value})
			}
		case *domDirective:
			b, ok := current.source.(*domDirective)
			if ok && a != nil && b != nil {
				conds(a.Conditions, b.Conditions)
			}
		case *domImplication:
			b, ok := current.source.(*domImplication)
			if ok && a != nil && b != nil {
				pending = append(pending, pair{a.If, b.If}, pair{a.Then, b.Then})
			}
		case *domExpr:
			b, ok := current.source.(*domExpr)
			if !ok || a == nil || b == nil || a.Kind != b.Kind {
				continue
			}
			if a.Kind != exParam {
				a.At = b.At
			}
			a.RankedAt = b.RankedAt
			exprs(a.Items, b.Items)
			requirements(a.Requirements, b.Requirements)
			pending = append(pending, pair{a.Inner, b.Inner}, pair{a.Sep, b.Sep}, pair{a.Value, b.Value}, pair{a.Call, b.Call}, pair{a.Ends[0], b.Ends[0]}, pair{a.Ends[1], b.Ends[1]})
		case *domTerm:
			b, ok := current.source.(*domTerm)
			if !ok || a == nil || b == nil || a.Kind != b.Kind {
				continue
			}
			if a.Kind != tmParam && a.Kind != tmConst && a.Kind != tmSourceCall {
				a.At = b.At
			}
			terms(a.Items, b.Items)
			pending = append(pending, pair{a.Call, b.Call}, pair{a.Cond, b.Cond}, pair{a.Pattern, b.Pattern})
		case *domCond:
			b, ok := current.source.(*domCond)
			if !ok || a == nil || b == nil || a.Kind != b.Kind {
				continue
			}
			a.At = b.At
			terms(a.Targets, b.Targets)
			conds(a.Items, b.Items)
			pending = append(pending, pair{a.Left, b.Left}, pair{a.Right, b.Right}, pair{a.Span, b.Span}, pair{a.Inner, b.Inner})
		case *domSourceCall:
			b, ok := current.source.(*domSourceCall)
			if ok && a != nil && b != nil {
				args(a.Args, b.Args)
			}
		case *domArgument:
			b, ok := current.source.(*domArgument)
			if !ok || a == nil || b == nil {
				continue
			}
			pending = append(pending, pair{a.Term, b.Term}, pair{a.Expr, b.Expr})
			requirements(a.Requirements, b.Requirements)
			terms(a.Targets, b.Targets)
		case *domPattern:
			b, ok := current.source.(*domPattern)
			if !ok || a == nil || b == nil || a.Kind != b.Kind {
				continue
			}
			patterns(a.Items, b.Items)
			patterns(a.Attached, b.Attached)
			requirements(a.Requirements, b.Requirements)
			pending = append(pending, pair{a.Value, b.Value}, pair{a.Call, b.Call}, pair{a.Ends[0], b.Ends[0]}, pair{a.Ends[1], b.Ends[1]})
		case *domEmit:
			b, ok := current.source.(*domEmit)
			if !ok || a == nil || b == nil {
				continue
			}
			for i, v := range a.Items {
				if i < len(b.Items) {
					pending = append(pending, pair{v, b.Items[i]})
				}
			}
		case *domEmitItem:
			b, ok := current.source.(*domEmitItem)
			if ok && a != nil && b != nil {
				pending = append(pending, pair{a.Tags, b.Tags}, pair{a.Value, b.Value}, pair{a.Image, b.Image})
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
	w.raw("{")
	c.writeFields(w)
	w.raw(`,"at":`)
	w.pair(c.At)
	w.raw("}")
}

func (c *domSourceCall) writeFields(w *jsonWriter) {
	w.raw(`"call":`)
	w.str(c.Name)
	w.raw(`,"args":`)
	writeSourceArguments(w, c.Args)
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
	case exTest, exRange, exWildcard, exSplice:
		return &domArgument{Expr: expr}
	default:
		return &domArgument{Expr: expr, Body: true}
	}
}
