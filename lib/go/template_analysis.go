package gencmu

// partialSourceRule preserves known structure before the final depth check.
// A native worklist avoids JSON limits and retains private source positions.
func partialSourceRule(rule *domRule) *domRule {
	type task struct {
		source, target any
		role           string
	}
	var result *domRule
	pending := []task{{rule, &result, ""}}
	term := func(source *domTerm, target **domTerm, role string) {
		if source != nil {
			pending = append(pending, task{source, target, role})
		}
	}
	condition := func(source *domCond, target **domCond) {
		if source != nil {
			pending = append(pending, task{source, target, ""})
		}
	}
	expression := func(source *domExpr, target **domExpr) {
		if source != nil {
			pending = append(pending, task{source, target, ""})
		}
	}
	terms := func(source []*domTerm, role func(int) string) []*domTerm {
		if source == nil {
			return nil
		}
		out := make([]*domTerm, len(source))
		for i, value := range source {
			term(value, &out[i], role(i))
		}
		return out
	}
	conditions := func(source []*domCond) []*domCond {
		if source == nil {
			return nil
		}
		out := make([]*domCond, len(source))
		for i, value := range source {
			condition(value, &out[i])
		}
		return out
	}
	expressions := func(source []*domExpr) []*domExpr {
		if source == nil {
			return nil
		}
		out := make([]*domExpr, len(source))
		for i, value := range source {
			expression(value, &out[i])
		}
		return out
	}
	requirements := func(source []tagRequirement) []tagRequirement {
		if source == nil {
			return nil
		}
		out := make([]tagRequirement, len(source))
		for i, value := range source {
			out[i].Negated = value.Negated
			term(value.Value, &out[i].Value, "")
		}
		return out
	}
	patterns := func(source []*domPattern) []*domPattern {
		if source == nil {
			return nil
		}
		out := make([]*domPattern, len(source))
		for i, value := range source {
			pending = append(pending, task{value, &out[i], ""})
		}
		return out
	}
	ordinary := func(int) string { return "" }
	nominal := func(int) string { return "target" }
	for len(pending) > 0 {
		current := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		switch source := current.source.(type) {
		case *domRule:
			copied := *source
			*current.target.(**domRule) = &copied
			copied.Params, copied.Args = nil, nil
			term(source.Tags, &copied.Tags, "")
			term(source.Value, &copied.Value, "")
			term(source.Image, &copied.Image, "")
			copied.Conditions = conditions(source.Conditions)
			copied.Alternatives = make([]*domAlt, len(source.Alternatives))
			for i, value := range source.Alternatives {
				pending = append(pending, task{value, &copied.Alternatives[i], ""})
			}
			if source.Emit != nil {
				pending = append(pending, task{source.Emit, &copied.Emit, ""})
			}
		case *domAlt:
			copied := *source
			*current.target.(**domAlt) = &copied
			expression(source.Expr, &copied.Expr)
			term(source.Tags, &copied.Tags, "")
			term(source.Value, &copied.Value, "")
			term(source.Image, &copied.Image, "")
		case *domExpr:
			target := current.target.(**domExpr)
			if source.Kind == exParam || source.Kind == exCall {
				*target = &domExpr{Kind: exWildcard, At: source.At}
				continue
			}
			copied := *source
			*target = &copied
			copied.Items = expressions(source.Items)
			expression(source.Inner, &copied.Inner)
			expression(source.Sep, &copied.Sep)
			term(source.Value, &copied.Value, "")
			for i, value := range source.Ends {
				term(value, &copied.Ends[i], "")
			}
			copied.Requirements = requirements(source.Requirements)
		case *domTerm:
			target := current.target.(**domTerm)
			if unresolvedTerm(source) {
				kind, name := tmConst, "Unresolved"
				if current.role == "target" {
					kind, name = tmRule, "unresolved"
				}
				if current.role == "boundary" {
					kind, name = tmCapture, ""
				}
				*target = &domTerm{Kind: kind, Str: name, At: [2]int{1, 1}}
				continue
			}
			copied := *source
			*target = &copied
			roles := ordinary
			if source.Kind == tmCall {
				roles = func(i int) string {
					if i > 0 && (partialQuery(source.Str) || source.Str == "tags" || source.Str == "without-elision-except") {
						return "target"
					}
					if i == 0 && boundaryMethod(source.Str) {
						return "boundary"
					}
					return ""
				}
			}
			copied.Items = terms(source.Items, roles)
			condition(source.Cond, &copied.Cond)
			if source.Pattern != nil {
				pending = append(pending, task{source.Pattern, &copied.Pattern, ""})
			}
		case *domCond:
			copied := *source
			*current.target.(**domCond) = &copied
			term(source.Left, &copied.Left, "")
			term(source.Right, &copied.Right, "")
			role := ""
			if source.Kind == cdBoundary {
				role = "boundary"
			}
			term(source.Span, &copied.Span, role)
			condition(source.Inner, &copied.Inner)
			copied.Items = conditions(source.Items)
			copied.Targets = terms(source.Targets, nominal)
		case *domPattern:
			target := current.target.(**domPattern)
			if source.Kind == "param" || source.Kind == "call" {
				*target = &domPattern{Kind: "constant", Name: "Unresolved", At: [2]int{1, 1}}
				continue
			}
			copied := *source
			*target = &copied
			copied.Items, copied.Attached = patterns(source.Items), patterns(source.Attached)
			term(source.Value, &copied.Value, "")
			for i, value := range source.Ends {
				term(value, &copied.Ends[i], "")
			}
			copied.Requirements = requirements(source.Requirements)
		case *domEmit:
			copied := *source
			*current.target.(**domEmit) = &copied
			copied.Items = make([]*domEmitItem, len(source.Items))
			for i, value := range source.Items {
				pending = append(pending, task{value, &copied.Items[i], ""})
			}
		case *domEmitItem:
			copied := *source
			*current.target.(**domEmitItem) = &copied
			term(source.Tags, &copied.Tags, "")
			term(source.Value, &copied.Value, "")
			term(source.Image, &copied.Image, "")
		}
	}
	return result
}

func partialQuery(name string) bool {
	switch name {
	case "matches", "begins", "ends", "starts-input", "ends-input", "followed-by", "preceded-by":
		return true
	}
	return false
}
