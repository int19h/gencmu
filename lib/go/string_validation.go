package gencmu

import "unicode/utf8"

// These checks use final constants, including declarations in replaced
// definitions. The cached DOM retains its original unresolved terms.
func (g *stageGrammar) validateStringUses(doc string, r *domRule) *Error {
	for _, a := range r.Alternatives {
		stack := []*domExpr{a.Expr}
		for len(stack) > 0 {
			e := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			if e == nil {
				continue
			}
			if e.Kind == exRange {
				var ends [2]rune
				for i, t := range e.Ends {
					v, err := g.evaluateClosed(doc, t, r.At)
					if err != nil {
						return err
					}
					if utf8.RuneCountInString(v.s) != 1 {
						return g.faultError(doc, t, r.At, "a range endpoint is one scalar")
					}
					ends[i], _ = utf8.DecodeRuneInString(v.s)
				}
				if ends[0] > ends[1] {
					where := r.At
					if references := constRefs(e.Ends[0], e.Ends[1]); len(references) > 0 {
						where = references[0].At
					}
					return g.constError(doc, where, "a range starts above its end")
				}
			}
			stack = append(stack, e.Sep, e.Inner)
			for i := len(e.Items) - 1; i >= 0; i-- {
				stack = append(stack, e.Items[i])
			}
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
