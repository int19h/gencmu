package gencmu

import "unicode/utf8"

// These checks use final constants, including declarations in replaced
// definitions. The cached DOM retains its original unresolved terms.
func (g *stageGrammar) validateStringUses(doc string, r *domRule) *Error {
	stringUse := func(t *domTerm) *Error {
		if ty, f := termTypeIn(t, g.constantTypes()); f != nil {
			return g.faultError(doc, f.node, r.At, f.problem)
		} else if ty != tyString {
			return g.faultError(doc, t, r.At, "a string operand resolves to a non-string constant")
		}
		return nil
	}
	for _, recipe := range ruleRecipes(r) {
		for _, atom := range recipe.Items {
			if stringTermShape(atom) {
				if err := stringUse(atom); err != nil {
					return err
				}
			}
		}
	}
	for _, a := range r.Alternatives {
		stack := []*domExpr{a.Expr}
		for len(stack) > 0 {
			e := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			if e == nil {
				continue
			}
			if e.Kind == exLiteral {
				if err := stringUse(e.Value); err != nil {
					return err
				}
			}
			if e.Kind == exRange {
				var ends [2]rune
				for i, t := range e.Ends {
					if err := stringUse(t); err != nil {
						return err
					}
					v, err := g.evaluateClosed(doc, t, r.At)
					if err != nil {
						return err
					}
					if utf8.RuneCountInString(v.s) != 1 {
						return g.faultError(doc, t, r.At, "a range endpoint resolves to more or fewer than one scalar")
					}
					ends[i], _ = utf8.DecodeRuneInString(v.s)
				}
				if ends[0] > ends[1] {
					return g.faultError(doc, e.Ends[0], r.At, "a range starts above its end")
				}
			}
			stack = append(stack, e.Inner, e.Sep)
			stack = append(stack, e.Items...)
		}
	}
	return nil
}

func ruleRecipes(r *domRule) []*domTerm {
	var out []*domTerm
	add := func(t *domTerm) {
		if t != nil {
			out = append(out, t)
		}
	}
	add(r.Value)
	add(r.Image)
	for _, a := range r.Alternatives {
		add(a.Value)
		add(a.Image)
	}
	if r.Emit != nil {
		for _, it := range r.Emit.Items {
			add(it.Value)
			add(it.Image)
		}
	}
	return out
}
