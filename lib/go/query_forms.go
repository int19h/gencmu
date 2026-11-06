package gencmu

// queryBody removes the sole optional outer remainder (engine §4.3).
// The returned mode agrees with the old whole, prefix, and suffix forms.
func queryBody(body *domExpr) (*domExpr, string, string) {
	if body == nil || body.Kind != exSeq {
		return body, cdMatches, ""
	}
	marker := -1
	var parts []*domExpr
	for i, part := range body.Items {
		if w := work.Load(); w != nil {
			w.clauseSteps.add("clause steps")
		}
		if part != nil && part.Kind == exRemainder {
			if marker != -1 {
				return body, cdMatches, "a remainder stands at one outer edge of a parse argument"
			}
			marker = i
		} else {
			parts = append(parts, part)
		}
	}
	if marker == -1 {
		return body, cdMatches, ""
	}
	if len(parts) == 0 || marker != 0 && marker != len(body.Items)-1 {
		return body, cdMatches, "a remainder stands at one outer edge of a parse argument"
	}
	core := &domExpr{Kind: exSeq, Items: parts}
	if len(parts) == 1 {
		core = parts[0]
	}
	mode := cdBegins
	if marker == 0 {
		mode = cdEnds
	}
	return core, mode, ""
}

func queryCapture(body *domExpr) *domExpr {
	var found *domExpr
	walkQueryBody(body, func(expr *domExpr) bool {
		if expr.Kind == exCapture {
			found = expr
			return false
		}
		return true
	}, func() bool { return found == nil })
	return found
}

// walkQueryBody preserves source order through every expression wrapper.
func walkQueryBody(body *domExpr, visit func(*domExpr) bool, more func() bool) {
	pending := []*domExpr{body}
	for len(pending) > 0 && (more == nil || more()) {
		if w := work.Load(); w != nil {
			w.clauseSteps.add("clause steps")
		}
		expr := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		if expr == nil || !visit(expr) {
			continue
		}
		children := exprChildren(expr)
		for i := len(children) - 1; i >= 0; i-- {
			pending = append(pending, children[i])
		}
	}
}

func queryTerms(body *domExpr) []*domTerm {
	var terms []*domTerm
	walkQueryBody(body, func(expr *domExpr) bool {
		for _, term := range []*domTerm{expr.Value, expr.Default, expr.Ends[0], expr.Ends[1]} {
			if term != nil {
				terms = append(terms, term)
			}
		}
		for _, requirement := range expr.Requirements {
			terms = append(terms, requirement.Value)
		}
		return true
	}, nil)
	return terms
}

func forestTerm(term *domTerm) bool {
	return term != nil && term.Kind == tmCall && (term.Str == "parse" || term.Str == "error-free")
}
