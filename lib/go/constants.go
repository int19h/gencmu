package gencmu

import (
	"fmt"
	"strconv"
)

// A stage's constants (engine §2): the loader gives each its value when it
// stitches the stage, in the stitching order, and then gives every
// reference in a rule the final value. A DOM never holds a value, so a
// document shared by several stages or dialects takes the values of each.

// stageConst is a constant of a stage: its value now, with its type, and
// the document of its last definition.
type stageConst struct {
	value *constValue
	doc   string
}

// constUser is a rule statement that holds references to constants, which
// the loader checks once the constants have their final values.
type constUser struct {
	doc  string
	rule *domRule
}

// constantTypes gives the type of each constant of the stage now.
func (g *stageGrammar) constantTypes() constTypes {
	return func(name string) termType { return g.constants[name].value.ty }
}

// constError is an error of the document at a position of it.
func (g *stageGrammar) constError(doc string, at [2]int, format string, args ...any) *Error {
	e := grammarError(doc, at, format, args...)
	e.Stage = g.name
	return e
}

// faultError is the error of a construct whose types disagree, or whose
// value is refused: at its first constant, which the loader alone could
// know, or else at the item (engine §2, §9).
func (g *stageGrammar) faultError(doc string, node any, item [2]int, message string) *Error {
	if refs := constRefs(node); len(refs) > 0 {
		return g.constError(doc, refs[0].At, "%s", message)
	}
	return g.constError(doc, item, "%s", message)
}

// addConstant defines or redefines a constant, with the value its term has
// at this point of the stage (engine §2).
func (g *stageGrammar) addConstant(doc string, k *domConst) *Error {
	previous := g.constants[k.Name]
	if k.Op == "define" && previous != nil {
		return g.constError(doc, k.At, "%%const $%s is already defined in stage %s, in %s; %%redefine-const gives it a new value", k.Name, g.name, previous.doc)
	}
	if k.Op == "redefine" && previous == nil {
		return g.constError(doc, k.At, "%%redefine-const $%s gives a value to no constant defined before it in stage %s", k.Name, g.name)
	}
	// A reference sees the constants defined before this point.
	for _, ref := range constRefs(k.Value) {
		if g.constants[ref.Str] == nil {
			return g.constError(doc, ref.At, "$%s is not defined before this point of stage %s", ref.Str, g.name)
		}
	}
	ty, f := constantValueType(k.Value, k.Op == "redefine", g.constantTypes())
	if f != nil {
		return g.faultError(doc, f.node, k.At, f.problem)
	}
	if previous != nil {
		// A redefinition keeps the type, which gives ∅ its kind.
		if ty == tySet && (previous.value.ty == tyStrings || previous.value.ty == tyTags) {
			ty = previous.value.ty
		}
		if ty != previous.value.ty {
			return g.constError(doc, k.At, "%%redefine-const $%s keeps the type of the constant, and cannot make it %s", k.Name, typeNames[ty])
		}
	}
	v, err := g.evaluateClosed(doc, k.Value, k.At)
	if err != nil {
		return err
	}
	v.ty = ty
	g.constants[k.Name] = &stageConst{value: v, doc: doc}
	return nil
}

// evaluateClosed is the value of a closed term, with the constants' values
// now (engine §2, §10). An empty delimiter or a tag's string that is not a
// name comes from a constant here, since the reader refuses a literal one,
// and the error stands at that constant.
func (g *stageGrammar) evaluateClosed(doc string, t *domTerm, item [2]int) (*constValue, *Error) {
	set := func(part *domTerm) (*tagset, *Error) {
		v, err := g.evaluateClosed(doc, part, item)
		if err != nil {
			return nil, err
		}
		return &tagset{names: v.names}, nil
	}
	str := func(part *domTerm) (string, *Error) {
		v, err := g.evaluateClosed(doc, part, item)
		if err != nil {
			return "", err
		}
		return v.s, nil
	}
	in := newInterner()
	switch t.Kind {
	case tmString:
		return &constValue{ty: tyString, s: t.Str}, nil
	case tmTag:
		return &constValue{ty: tyTags, names: []string{t.Str}}, nil
	case tmRange:
		return &constValue{ty: tyTags, names: in.fromList(rangeTags(t.Range, g.uni.isMark)).names}, nil
	case tmEmptySet:
		return &constValue{ty: tySet}, nil
	case tmConst:
		v := *g.constants[t.Str].value
		return &v, nil
	case tmUnion, tmIntersection, tmDifference:
		var out *tagset
		for i, it := range t.Items {
			s, err := set(it)
			if err != nil {
				return nil, err
			}
			switch {
			case i == 0:
				out = in.make(s.names)
			case t.Kind == tmUnion:
				out = in.union(out, in.make(s.names))
			case t.Kind == tmIntersection:
				out = in.intersection(out, in.make(s.names))
			default:
				out = in.difference(out, in.make(s.names))
			}
		}
		return &constValue{ty: tySet, names: out.names}, nil
	case tmCall:
		switch t.Str {
		case "split":
			delimiter, err := str(t.Items[1])
			if err != nil {
				return nil, err
			}
			if delimiter == "" {
				return nil, g.faultError(doc, t.Items[1], item, "split has an empty delimiter")
			}
			s, err := str(t.Items[0])
			if err != nil {
				return nil, err
			}
			return &constValue{ty: tyStrings, names: in.fromList(splitString(s, delimiter)).names}, nil
		case "tag":
			name, err := str(t.Items[0])
			if err != nil {
				return nil, err
			}
			if !isName(name) {
				return nil, g.faultError(doc, t.Items[0], item, fmt.Sprintf("tag(%s): the string is not a name", strconv.Quote(name)))
			}
			return &constValue{ty: tyTags, names: []string{name}}, nil
		}
	}
	return nil, g.constError(doc, item, "a constant's value is not a closed term")
}

// resolveConstants checks what the reader could not in every rule that
// uses constants, once the stage is stitched: that each is defined, that
// the types agree, and that a constant that split or tag reads directly is
// a delimiter that is not empty, or a name (engine §2, §9, §10). Then it
// gives every reference its final value.
func (g *stageGrammar) resolveConstants() *Error {
	types := g.constantTypes()
	for _, u := range g.constUsers {
		for _, ref := range constRefs(u.rule) {
			if g.constants[ref.Str] == nil {
				return g.constError(u.doc, ref.At, "$%s is not defined in stage %s", ref.Str, g.name)
			}
		}
		if f := ruleTypeFault(u.rule, types); f != nil {
			return g.faultError(u.doc, f.node, u.rule.At, f.problem)
		}
		// The checks that simplification decides, which the reader left to
		// the loader, now with the constants' values (§9).
		if msg := definitionProblem(newResolver(g.constants).rule(u.rule)); msg != "" {
			return g.constError(u.doc, u.rule.At, "%s", msg)
		}
		for _, call := range closedCalls(u.rule) {
			arg := call.Items[0]
			if call.Str == "split" {
				arg = call.Items[1]
			}
			if arg.Kind != tmConst {
				continue
			}
			seen := g.constants[arg.Str].value.s
			if call.Str == "split" && seen == "" {
				return g.constError(u.doc, arg.At, "split has an empty delimiter")
			}
			if call.Str == "tag" && !isName(seen) {
				return g.constError(u.doc, arg.At, "tag(%s): the string is not a name", strconv.Quote(seen))
			}
		}
	}
	if len(g.constUsers) == 0 {
		return nil
	}
	// Each reference holds the final value. The DOM is shared by every
	// stage and dialect that includes its document, so the clauses are
	// copied, and a clause that alternatives share stays shared.
	r := newResolver(g.constants)
	for _, rule := range g.rules {
		for _, a := range rule.alts {
			a.ruleTags = r.term(a.ruleTags)
			a.emit = r.emit(a.emit)
			a.conds = r.condList(a.conds)
			if a.alt.Tags != nil && len(constRefs(a.alt.Tags)) > 0 {
				alt, ok := r.alts[a.alt]
				if !ok {
					copied := *a.alt
					copied.Tags = r.term(a.alt.Tags)
					alt = &copied
					r.alts[a.alt] = alt
				}
				a.alt = alt
			}
		}
	}
	return nil
}

// closedCalls lists the calls of split and tag in a rule's clauses.
func closedCalls(rule *domRule) []*domTerm {
	var found []*domTerm
	var term func(t *domTerm)
	var cond func(c *domCond)
	term = func(t *domTerm) {
		if t == nil {
			return
		}
		if t.Kind == tmCall && (t.Str == "split" || t.Str == "tag") {
			found = append(found, t)
		}
		if t.Cond != nil {
			cond(t.Cond)
		}
		for _, it := range t.Items {
			term(it)
		}
	}
	cond = func(c *domCond) {
		if c == nil {
			return
		}
		term(c.Left)
		term(c.Right)
		term(c.Span)
		cond(c.Inner)
		for _, it := range c.Items {
			cond(it)
		}
	}
	for _, t := range ruleTagTerms(rule) {
		term(t)
	}
	for _, c := range rule.Conditions {
		cond(c)
	}
	return found
}

// resolver copies clauses with each reference to a constant holding its
// value, each node once, and leaves a node without one as it is.
type resolver struct {
	constants map[string]*stageConst
	terms     map[*domTerm]*domTerm
	conds     map[*domCond]*domCond
	emits     map[*domEmit]*domEmit
	alts      map[*domAlt]*domAlt
}

func newResolver(constants map[string]*stageConst) *resolver {
	return &resolver{constants: constants, terms: map[*domTerm]*domTerm{}, conds: map[*domCond]*domCond{}, emits: map[*domEmit]*domEmit{}, alts: map[*domAlt]*domAlt{}}
}

// rule copies a rule definition with each reference to a constant holding
// its value.
func (r *resolver) rule(rule *domRule) *domRule {
	copied := *rule
	copied.Tags = r.term(rule.Tags)
	copied.Conditions = r.condList(rule.Conditions)
	copied.Emit = r.emit(rule.Emit)
	copied.Alternatives = make([]*domAlt, len(rule.Alternatives))
	for i, a := range rule.Alternatives {
		copied.Alternatives[i] = a
		if a.Tags != nil && len(constRefs(a.Tags)) > 0 {
			alt := *a
			alt.Tags = r.term(a.Tags)
			copied.Alternatives[i] = &alt
		}
	}
	return &copied
}

func (r *resolver) term(t *domTerm) *domTerm {
	if t == nil || len(constRefs(t)) == 0 {
		return t
	}
	if done, ok := r.terms[t]; ok {
		return done
	}
	copied := *t
	if t.Kind == tmConst {
		copied.value = r.constants[t.Str].value
	}
	if t.Items != nil {
		copied.Items = make([]*domTerm, len(t.Items))
		for i, it := range t.Items {
			copied.Items[i] = r.term(it)
		}
	}
	copied.Cond = r.cond(t.Cond)
	r.terms[t] = &copied
	return &copied
}

func (r *resolver) cond(c *domCond) *domCond {
	if c == nil || len(constRefs(c)) == 0 {
		return c
	}
	if done, ok := r.conds[c]; ok {
		return done
	}
	copied := *c
	copied.Left, copied.Right, copied.Span = r.term(c.Left), r.term(c.Right), r.term(c.Span)
	copied.Inner = r.cond(c.Inner)
	if c.Items != nil {
		copied.Items = r.condList(c.Items)
	}
	r.conds[c] = &copied
	return &copied
}

// condList copies a list of conditions where one of them holds a
// constant; a list without one stays as it is, shared.
func (r *resolver) condList(cs []*domCond) []*domCond {
	if len(constRefs(cs)) == 0 {
		return cs
	}
	out := make([]*domCond, len(cs))
	for i, c := range cs {
		out[i] = r.cond(c)
	}
	return out
}

func (r *resolver) emit(e *domEmit) *domEmit {
	if e == nil {
		return nil
	}
	if done, ok := r.emits[e]; ok {
		return done
	}
	changed := false
	items := make([]*domEmitItem, len(e.Items))
	for i, it := range e.Items {
		items[i] = it
		if tags := r.term(it.Tags); tags != it.Tags {
			copied := *it
			copied.Tags = tags
			items[i] = &copied
			changed = true
		}
	}
	out := e
	if changed {
		out = &domEmit{Items: items}
	}
	r.emits[e] = out
	return out
}
