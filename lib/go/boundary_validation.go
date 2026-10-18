package gencmu

import "fmt"

// boundaryRuleProblem enforces the single-boundary surfaces of engine §9.3.
func boundaryRuleProblem(r *domRule) (*domCond, string) {
	for _, c := range r.Conditions {
		atoms := boundaryAtoms(clausePart{c: c})
		if len(atoms) > 1 {
			return atoms[1], "a condition item accepts only one boundary atom"
		}
		if len(atoms) == 1 && atoms[0].Span.Str != "" {
			receiver := atoms[0].Span.Str
			mixed := false
			walkClause(clausePart{c: c}, func(p clausePart) bool {
				if p.t != nil && p.t.Kind == tmCapture && p.t.Str != receiver {
					mixed = true
				}
				if p.c != nil && p.c.Kind == cdCaptured && p.c.Rule != receiver {
					mixed = true
				}
				return !mixed
			})
			if mixed {
				return atoms[0], "a boundary condition with a captured receiver reads only that capture"
			}
		}
	}
	var terms []*domTerm
	terms = append(terms, r.Tags, r.Value, r.Image)
	for _, a := range r.Alternatives {
		terms = append(terms, a.Tags, a.Value, a.Image)
		pending := []*domExpr{a.Expr}
		for len(pending) > 0 {
			e := pending[len(pending)-1]
			pending = pending[:len(pending)-1]
			if e == nil {
				continue
			}
			terms = append(terms, e.Value, e.Ends[0], e.Ends[1])
			for _, req := range e.Requirements {
				terms = append(terms, req.Value)
			}
			pending = append(pending, e.Items...)
			pending = append(pending, e.Inner, e.Sep)
		}
	}
	if r.Emit != nil {
		for _, it := range r.Emit.Items {
			terms = append(terms, it.Value, it.Image)
		}
	}
	for _, t := range terms {
		if atoms := boundaryAtoms(clausePart{t: t}); len(atoms) > 0 {
			return atoms[0], "a boundary atom stands only in conditions or emission tags"
		}
	}
	return nil, ""
}

func sourceBoundaryAtoms(a *sAlt) []*domCond {
	var atoms []*domCond
	for _, c := range a.conds {
		atoms = append(atoms, boundaryAtoms(clausePart{c: c})...)
	}
	if a.emit != nil {
		for _, it := range a.emit.Items {
			atoms = append(atoms, boundaryAtoms(clausePart{t: it.Tags})...)
		}
	}
	return atoms
}
func (g *stageGrammar) validateBoundaryTargets() *Error {
	atoms := false
	roots := []string{"text"}
	for _, r := range g.rules {
		for _, a := range r.alts {
			atoms = atoms || len(sourceBoundaryAtoms(a)) > 0
			var parts []clausePart
			for _, c := range a.conds {
				parts = append(parts, clausePart{c: c})
			}
			parts = append(parts, clausePart{t: a.ruleTags}, clausePart{t: a.alt.Tags})
			if a.emit != nil {
				for _, it := range a.emit.Items {
					parts = append(parts, clausePart{t: it.Tags})
				}
			}
			for _, p := range parts {
				walkClause(p, func(q clausePart) bool {
					if q.c != nil && (q.c.Kind == cdMatches || q.c.Kind == cdBegins || q.c.Kind == cdBoundary) {
						for _, t := range q.c.queryTargets() {
							if t.Kind == tmTerminal || t.Kind == tmRule && q.c.Kind != cdBoundary {
								roots = append(roots, t.Str)
							}
						}
					}
					if q.t != nil && q.t.Kind == tmCall && q.t.Str == "tags" && len(q.t.Items) == 2 {
						roots = append(roots, q.t.Items[1].Str)
					}
					return true
				})
			}
		}
	}
	if !atoms {
		return nil
	}
	rules, terminals := map[string]bool{}, map[string]bool{}
	for len(roots) > 0 {
		name := roots[len(roots)-1]
		roots = roots[:len(roots)-1]
		if isCapital(name) {
			terminals[name] = true
			continue
		}
		if rules[name] {
			continue
		}
		rules[name] = true
		rule := g.byName[name]
		if rule == nil {
			continue
		}
		for _, a := range rule.alts {
			pending := []*domExpr{a.alt.Expr}
			for len(pending) > 0 {
				e := pending[len(pending)-1]
				pending = pending[:len(pending)-1]
				if e == nil {
					continue
				}
				if e.Kind == exRef {
					if isCapital(e.Name) {
						terminals[e.Name] = true
					} else if !isTerminalName(e.Name) {
						roots = append(roots, e.Name)
					}
				}
				pending = append(pending, e.Items...)
				pending = append(pending, e.Inner, e.Sep)
			}
		}
	}
	for _, r := range g.rules {
		for _, a := range r.alts {
			for _, atom := range sourceBoundaryAtoms(a) {
				for _, target := range atom.Targets {
					reachable := rules[target.Str]
					if target.Kind == tmTerminal {
						reachable = terminals[target.Str]
					}
					if !reachable {
						err := grammarError(a.doc, target.At, "boundary target %s is unreachable", target.Str)
						err.boundaryLocation = true
						return err
					}
				}
			}
		}
	}
	return nil
}

func restoreBoundaryLocations(to, from *domDoc) {
	collect := func(d *domDoc) []*domCond {
		var out []*domCond
		for _, r := range d.Rules {
			for _, c := range r.Conditions {
				out = append(out, boundaryAtoms(clausePart{c: c})...)
			}
			if r.Emit != nil {
				for _, it := range r.Emit.Items {
					out = append(out, boundaryAtoms(clausePart{t: it.Tags})...)
				}
			}
		}
		return out
	}
	atoms, originals := collect(to), collect(from)
	if len(atoms) != len(originals) {
		return
	}
	for i, a := range atoms {
		a.At = originals[i].At
		for j, t := range a.Targets {
			if j < len(originals[i].Targets) {
				t.At = originals[i].Targets[j].At
			}
		}
	}
}

// structuralSpans uses written productions, including disabled alternatives.
func structuralSpans(g *lowered) (productive, nonempty []bool) {
	productive = make([]bool, len(g.rules))
	nonempty = make([]bool, len(g.rules))
	remaining := make([]int, len(g.prods))
	users := make([][]int, len(g.rules))
	var queue []int32
	settle := func(id int32) {
		if !productive[id] {
			productive[id] = true
			queue = append(queue, id)
		}
	}
	for i, p := range g.prods {
		for _, s := range p.rhs {
			if !s.term {
				remaining[i]++
				users[s.id] = append(users[s.id], i)
			}
		}
		if remaining[i] == 0 {
			settle(p.lhs)
		}
	}
	for at := 0; at < len(queue); at++ {
		for _, i := range users[queue[at]] {
			remaining[i]--
			if remaining[i] == 0 {
				settle(g.prods[i].lhs)
			}
		}
	}
	queue = nil
	mark := func(id int32) {
		if !nonempty[id] {
			nonempty[id] = true
			queue = append(queue, id)
		}
	}
	for i, p := range g.prods {
		if remaining[i] == 0 {
			for _, s := range p.rhs {
				if s.term {
					mark(p.lhs)
					break
				}
			}
		}
	}
	for at := 0; at < len(queue); at++ {
		for _, i := range users[queue[at]] {
			if remaining[i] == 0 {
				mark(g.prods[i].lhs)
			}
		}
	}
	return
}
func boundaryAtomText(a *domCond) string {
	targets := ""
	for i, t := range a.Targets {
		if i > 0 {
			targets += " | "
		}
		targets += t.Str
	}
	return fmt.Sprintf("$.%s(%s)", a.Op, targets)
}
