package gencmu

import (
	"fmt"
	"strconv"
	"strings"
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

// constVersion retains the lexical predecessor of each redefinition.
type constVersion struct {
	definition   *domConst
	doc          string
	previous     int
	dependencies []int
	references   []*domTerm
	value        *constValue
}

func (g *stageGrammar) addConstant(doc string, k *domConst) *Error {
	if g.constLatest == nil {
		g.constLatest = map[string]int{}
	}
	previous, exists := g.constLatest[k.Name]
	if k.Op == "define" && exists {
		return g.constError(doc, k.At, "%%const $%s is already defined in stage %s, in %s; %%redefine-const gives it a new value", k.Name, g.name, g.constVersions[previous].doc)
	}
	if k.Op == "redefine" && !exists {
		return g.constError(doc, k.At, "%%redefine-const $%s gives a value to no constant defined before it in stage %s", k.Name, g.name)
	}
	if !exists {
		previous = -1
	}
	g.constLatest[k.Name] = len(g.constVersions)
	g.constVersions = append(g.constVersions, &constVersion{definition: k, doc: doc, previous: previous})
	return nil
}
func (g *stageGrammar) bindConstants() *Error {
	for _, v := range g.constVersions {
		v.references = constRefs(v.definition.Value)
		for _, r := range v.references {
			target, ok := g.constLatest[r.Str]
			if r.Str == v.definition.Name && v.definition.Op == "redefine" {
				target = v.previous
				ok = target >= 0
			}
			if !ok {
				return g.constError(v.doc, r.At, "$%s is not defined in stage %s; dependency $%s → $%s", r.Str, g.name, v.definition.Name, r.Str)
			}
			v.dependencies = append(v.dependencies, target)
		}
	}
	state := make([]byte, len(g.constVersions))
	var ordered []int
	type entry struct{ id, next int }
	for root := range g.constVersions {
		if state[root] != 0 {
			continue
		}
		state[root] = 1
		stack := []entry{{root, 0}}
		for len(stack) > 0 {
			f := &stack[len(stack)-1]
			v := g.constVersions[f.id]
			if f.next < len(v.dependencies) {
				i := f.next
				f.next++
				target := v.dependencies[i]
				if state[target] == 1 {
					var names []string
					for _, e := range stack {
						names = append(names, "$"+g.constVersions[e.id].definition.Name)
					}
					names = append(names, "$"+g.constVersions[target].definition.Name)
					return g.constError(v.doc, v.references[i].At, "constant dependency cycle: %s", strings.Join(names, " → "))
				}
				if state[target] == 0 {
					state[target] = 1
					stack = append(stack, entry{target, 0})
				}
				continue
			}
			state[f.id] = 2
			ordered = append(ordered, f.id)
			stack = stack[:len(stack)-1]
		}
	}
	kinds := map[string]termType{}
	users := map[string]map[int]bool{}
	for i, v := range g.constVersions {
		names := []string{v.definition.Name}
		for _, r := range v.references {
			names = append(names, r.Str)
		}
		for _, n := range names {
			if users[n] == nil {
				users[n] = map[int]bool{}
			}
			users[n][i] = true
		}
	}
	queue := make([]int, len(g.constVersions))
	queued := map[int]bool{}
	for i := range queue {
		queue[i] = i
		queued[i] = true
	}
	ct := func(n string) termType {
		if ty, ok := kinds[n]; ok {
			return ty
		}
		return tyAny
	}
	for at := 0; at < len(queue); at++ {
		i := queue[at]
		delete(queued, i)
		v := g.constVersions[i]
		k := v.definition
		ty, f := constantValueType(k.Value, k.Op == "redefine", ct)
		if f != nil {
			return g.faultError(v.doc, f.node, k.At, f.problem)
		}
		if ty == tyAny || ty == tySet {
			continue
		}
		old, ok := kinds[k.Name]
		if ok && old != ty {
			return g.constError(v.doc, k.At, "%%redefine-const $%s keeps the type of the constant, and cannot make it %s", k.Name, typeNames[ty])
		}
		if !ok {
			kinds[k.Name] = ty
			for u := range users[k.Name] {
				if !queued[u] {
					queue = append(queue, u)
					queued[u] = true
				}
			}
		}
	}
	for _, i := range ordered {
		v := g.constVersions[i]
		k := v.definition
		ty, ok := kinds[k.Name]
		if !ok {
			return g.constError(v.doc, k.At, "the kind of the value of $%s is not given", k.Name)
		}
		g.constants = map[string]*stageConst{}
		for j, r := range v.references {
			d := g.constVersions[v.dependencies[j]]
			g.constants[r.Str] = &stageConst{value: d.value, doc: d.doc}
		}
		var value *constValue
		var err *Error
		if ty == tyPattern && k.Value.Kind == tmEmptySet {
			value = &constValue{ty: tyPattern, pattern: emptyPattern()}
		} else {
			value, err = g.evaluateClosed(v.doc, k.Value, k.At)
		}
		if err != nil {
			return err
		}
		value.ty = ty
		v.value = value
	}
	g.constants = map[string]*stageConst{}
	for name, id := range g.constLatest {
		v := g.constVersions[id]
		g.constants[name] = &stageConst{value: v.value, doc: v.doc}
	}
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
	case tmPattern:
		p, err := g.resolvePatternValue(doc, t.Pattern, item)
		return &constValue{ty: tyPattern, pattern: p}, err
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
		ty, _ := termTypeIn(t, g.constantTypes())
		if ty == tyPattern {
			var patterns []*domPattern
			for _, it := range t.Items {
				v, err := g.evaluateClosed(doc, it, item)
				if err != nil {
					return nil, err
				}
				p := v.pattern
				if v.ty == tySet {
					p = emptyPattern()
				}
				patterns = append(patterns, p)
			}
			return &constValue{ty: tyPattern, pattern: &domPattern{Kind: t.Kind, Items: patterns}}, nil
		}
		if t.Kind != tmUnion {
			var out *tagset
			for i, it := range t.Items {
				v, err := set(it)
				if err != nil {
					return nil, err
				}
				if i == 0 {
					out = in.make(v.names)
				} else if t.Kind == tmIntersection {
					out = in.intersection(out, in.make(v.names))
				} else {
					out = in.difference(out, in.make(v.names))
				}
			}
			return &constValue{ty: tySet, names: out.names}, nil
		}
		// Gathered at once, since a pairwise fold copies the growing union.
		sets := make([]*tagset, len(t.Items))
		for i, it := range t.Items {
			s, err := set(it)
			if err != nil {
				return nil, err
			}
			sets[i] = in.make(s.names)
		}
		return &constValue{ty: tySet, names: in.unionAll(sets).names}, nil
	case tmCall:
		switch t.Str {
		case "split":
			// Left to right, as a parse evaluates a term (§10).
			s, err := str(t.Items[0])
			if err != nil {
				return nil, err
			}
			delimiter, err := str(t.Items[1])
			if err != nil {
				return nil, err
			}
			if delimiter == "" {
				return nil, g.faultError(doc, t.Items[1], item, "split has an empty delimiter")
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
	if err := g.bindConstants(); err != nil {
		return err
	}
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
		var patternErr *Error
		scan := func(p clausePart) bool {
			if patternErr != nil {
				return false
			}
			if p.t != nil && p.t.Kind == tmPattern {
				_, patternErr = g.evaluateClosed(u.doc, p.t, u.rule.At)
				return false
			}
			return true
		}
		for _, c := range u.rule.Conditions {
			walkClause(clausePart{c: c}, scan)
		}
		for _, t := range ruleTagTerms(u.rule) {
			walkClause(clausePart{t: t}, scan)
		}
		if patternErr != nil {
			return patternErr
		}

		// The checks that simplification decides, which the reader left to
		// the loader, now with the constants' values (§9).
		if msg := definitionProblem(newResolver(g.constants, g.uni).rule(u.rule)); msg != "" {
			return g.constError(u.doc, u.rule.At, "%s", msg)
		}
		// A string constant in a sound test must be a canonical sound (§2,
		// §9); the error stands at the constant.
		for _, a := range u.rule.Alternatives {
			for _, t := range testsIn(a.Expr) {
				refs := constRefs(t.Value)
				if !isSoundTest(t.Op) || len(refs) == 0 {
					continue
				}
				v, err := g.evaluateClosed(u.doc, t.Value, u.rule.At)
				if err != nil {
					return err
				}
				if msg := soundProblem(v.s, g.uni); msg != "" {
					return g.constError(u.doc, refs[0].At, "%s", msg)
				}
			}
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

	// Each reference holds the final value. The DOM is shared by every
	// stage and dialect that includes its document, so the clauses are
	// copied, and a clause that alternatives share stays shared.
	r := newResolver(g.constants, g.uni)
	for _, rule := range g.rules {
		for _, a := range rule.alts {
			a.ruleTags = r.term(a.ruleTags)
			a.emit = r.emit(a.emit)
			a.conds = r.condList(a.conds)
			if tags := r.term(a.alt.Tags); tags != a.alt.Tags {
				alt, ok := r.alts[a.alt]
				if !ok {
					copied := *a.alt
					copied.Tags = tags
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
	term(rule.Tags)
	for _, a := range rule.Alternatives {
		for _, t := range testsIn(a.Expr) {
			term(t.Value)
		}
		term(a.Tags)
	}
	if rule.Emit != nil {
		for _, it := range rule.Emit.Items {
			term(it.Tags)
		}
	}
	for _, c := range rule.Conditions {
		cond(c)
	}
	return found
}

// resolver copies clauses with each reference to a constant holding its
// value, each node once, and leaves a node without one as it is. Each node
// is looked up before it is walked, so a clause that many alternatives
// share costs one walk, not one for each.
type resolver struct {
	constants map[string]*stageConst
	uni       *unicodeTable
	terms     map[*domTerm]*domTerm
	conds     map[*domCond]*domCond
	condLists map[condListKey][]*domCond
	emits     map[*domEmit]*domEmit
	alts      map[*domAlt]*domAlt
}

// condListKey is a list of conditions by identity: where it starts in
// memory and how long it is.
type condListKey struct {
	first **domCond
	n     int
}

func newResolver(constants map[string]*stageConst, uni *unicodeTable) *resolver {
	return &resolver{constants: constants, uni: uni, terms: map[*domTerm]*domTerm{}, conds: map[*domCond]*domCond{}, condLists: map[condListKey][]*domCond{}, emits: map[*domEmit]*domEmit{}, alts: map[*domAlt]*domAlt{}}
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
		if tags := r.term(a.Tags); tags != a.Tags {
			alt := *a
			alt.Tags = tags
			copied.Alternatives[i] = &alt
		}
	}
	return &copied
}

// term is t with each constant holding its value: t itself where no part
// of it is a constant, else a copy.
func (r *resolver) term(t *domTerm) *domTerm {
	if t == nil {
		return nil
	}
	if done, ok := r.terms[t]; ok {
		return done
	}
	if w := work.Load(); w != nil {
		w.clauseSteps.add("clause steps")
	}
	if t.Kind == tmPattern || (t.Kind == tmUnion || t.Kind == tmIntersection || t.Kind == tmDifference) && resolverHasPattern(r, t) {
		v := r.patternValue(t)
		copied := &domTerm{Kind: tmPattern, Pattern: v}
		r.terms[t] = copied
		return copied
	}
	changed := t.Kind == tmConst
	var items []*domTerm
	if t.Items != nil {
		items = make([]*domTerm, len(t.Items))
		for i, it := range t.Items {
			items[i] = r.term(it)
			changed = changed || items[i] != it
		}
	}
	cond := r.cond(t.Cond)
	changed = changed || cond != t.Cond
	if !changed {
		r.terms[t] = t
		return t
	}
	copied := *t
	if t.Kind == tmConst {
		copied.value = r.constants[t.Str].value
		if copied.value.ty == tyPattern {
			copied.Kind = tmPattern
			copied.Pattern = copied.value.pattern
		}
	}
	copied.Items = items
	copied.Cond = cond
	r.terms[t] = &copied
	return &copied
}

// cond is c with each constant holding its value, as term is.
func (r *resolver) cond(c *domCond) *domCond {
	if c == nil {
		return nil
	}
	if done, ok := r.conds[c]; ok {
		return done
	}
	if w := work.Load(); w != nil {
		w.clauseSteps.add("clause steps")
	}
	left, right, span := r.term(c.Left), r.term(c.Right), r.term(c.Span)
	if (c.Op == "≅" || c.Op == "≇") && right.Kind == tmEmptySet {
		right = &domTerm{Kind: tmPattern, Pattern: emptyPattern()}
	}
	inner := r.cond(c.Inner)
	items := c.Items
	if c.Items != nil {
		items = r.condList(c.Items)
	}
	if left == c.Left && right == c.Right && span == c.Span && inner == c.Inner && sameConds(items, c.Items) {
		r.conds[c] = c
		return c
	}
	copied := *c
	copied.Left, copied.Right, copied.Span, copied.Inner, copied.Items = left, right, span, inner, items
	r.conds[c] = &copied
	return &copied
}

// sameConds says whether two lists of conditions are one list.
func sameConds(a, b []*domCond) bool {
	return len(a) == len(b) && (len(a) == 0 || &a[0] == &b[0])
}

// condList copies a list of conditions where one of them holds a
// constant; a list without one stays as it is, shared.
func (r *resolver) condList(cs []*domCond) []*domCond {
	if len(cs) == 0 {
		return cs
	}
	key := condListKey{&cs[0], len(cs)}
	if done, ok := r.condLists[key]; ok {
		return done
	}
	// Each condition counts as it is looked at, also one already resolved,
	// so that a list resolved again for each alternative passes the budget.
	w := work.Load()
	var out []*domCond
	for i, c := range cs {
		if w != nil {
			w.clauseSteps.add("clause steps")
		}
		if resolved := r.cond(c); resolved != c && out == nil {
			out = make([]*domCond, len(cs))
			copy(out, cs[:i])
			out[i] = resolved
		} else if out != nil {
			out[i] = resolved
		}
	}
	if out == nil {
		out = cs
	}
	r.condLists[key] = out
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
