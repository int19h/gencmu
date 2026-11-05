package gencmu

import "unicode/utf8"

// These checks use final constants, including declarations in replaced
// definitions. The cached DOM retains its original unresolved terms.
func (g *stageGrammar) validateStringRange(doc string, terms [2]*domTerm, at [2]int) *Error {
	var ends [2]rune
	complete := true
	for i, t := range terms {
		if valueHasSource(t) {
			complete = false
			continue
		}
		value, err := g.evaluateClosed(doc, t, at)
		if err != nil {
			return err
		}
		if utf8.RuneCountInString(value.s) != 1 {
			return g.faultError(doc, t, at, "a range endpoint is one scalar")
		}
		ends[i], _ = utf8.DecodeRuneInString(value.s)
	}
	if complete && ends[0] > ends[1] {
		where := at
		if references := constRefs(terms[0], terms[1]); len(references) > 0 {
			where = references[0].At
		}
		return g.constError(doc, where, "a range starts above its end")
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
	add(r.Error)
	add(r.Warning)
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
