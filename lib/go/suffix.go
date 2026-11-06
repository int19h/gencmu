package gencmu

// Suffix recognition retains eligible answers at completed input boundaries.
type suffixTarget struct {
	g    *lowered
	rule int32
}

type suffixKey struct {
	target     suffixTarget
	start, end int
	errorFree  bool
}

type suffixState struct {
	errorFree bool
	answers   map[int]bool
	rec       *recognizer
	dependent bool
}

func restoredTerm(term *domTerm) bool {
	for depth := 0; term != nil && depth <= maxDOMDepth; depth++ {
		if term.Kind != tmCall {
			return false
		}
		if isRestorationMethod(term.Str) {
			return true
		}
		if term.Str != "onward" || len(term.Items) != 1 {
			return false
		}
		term = term.Items[0]
	}
	return false
}

func (run *stageRun) suffixState(g *lowered, rule int32, start, end int, errorFree bool) *suffixState {
	ps := run.ps
	target := suffixTarget{g, rule}
	if ps.suffixDeps == nil {
		ps.suffixDeps = map[suffixTarget]bool{}
	}
	dependent, known := ps.suffixDeps[target]
	if !known {
		dependent = suffixReadsEnd(g, rule)
		ps.suffixDeps[target] = dependent
	}
	key := suffixKey{target: target, start: start, end: -1, errorFree: errorFree}
	if dependent {
		key.end = end
	}
	if ps.suffixes == nil {
		ps.suffixes = map[suffixKey]*suffixState{}
	}
	state := ps.suffixes[key]
	if state == nil {
		state = &suffixState{answers: map[int]bool{}, errorFree: errorFree}
		ps.suffixes[key] = state
	}
	return state
}

// Ordinary nested queries own their ends. Restored queries at any depth
// retain an outer dependency. Body references propagate both observations.
func suffixReadsEnd(g *lowered, start int32) bool {
	type entry struct {
		rule   int32
		nested bool
	}
	pending := []entry{{start, false}}
	seen := map[entry]bool{}
	for len(pending) > 0 {
		here := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		if seen[here] {
			continue
		}
		seen[here] = true
		for _, p := range g.rules[here.rule].prods {
			for _, s := range p.rhs {
				if !s.term {
					pending = append(pending, entry{s.id, here.nested})
				}
			}
			found := false
			scan := func(n clausePart) bool {
				span, targets := queryParts(n, g)
				if c := n.c; c != nil {
					if !here.nested && (c.Kind == cdEnd || c.Kind == cdBoundary && c.Op == "followed-by") {
						found = true
					}
				}
				if t := n.t; t != nil && t.Kind == tmCall {
					if !here.nested && (t.Str == "onward" || t.Str == "following-tokens") {
						found = true
					}
				}
				if span != nil {
					if restoredTerm(span) {
						found = true
					}
					for _, target := range targets {
						if number, known := g.byName[target]; known {
							pending = append(pending, entry{number, true})
						}
					}
				}
				return !found
			}
			for _, root := range productionClauses(p) {
				walkClause(root, scan)
			}
			if found {
				return true
			}
		}
	}
	return false
}

func (r *recognizer) retainSuffix(k int) {
	at := r.base + k
	if _, known := r.suffix.answers[at]; known {
		return
	}
	var witnesses []*item
	for key, node := range r.sets[k].syms {
		if key.rule == r.startRule && key.requested == 0 && (r.boundaries == nil || r.boundaries.accepts(node.boundary, func(*boundaryLiteral) {})) {
			witnesses = append(witnesses, node.items...)
		}
	}
	r.suffix.answers[at] = len(r.eligibleItems(witnesses, r.suffix.errorFree)) > 0
}

// scan readies one terminal advance. Suffix recognition delays these
// advances until it retains the answer at their starting boundary.
func (r *recognizer) scan(k int, it *item) bool {
	sym := it.prod.rhs[it.dot]
	if k >= r.n || !r.reads(k, sym.id) {
		return false
	}
	tags, strict := r.tokenTags(k).id, false
	if r.recon != nil && r.recon.synthetic[k] {
		tags = r.run.ps.in.empty().id
		strict = it.dot == 0 && r.recon.reading.elidable[it.prod.lhs] && !r.run.ps.fault("route3")
	}
	st := &r.step
	st.kind, st.it, st.k, st.strict = stepTerminal, it, k+1, strict
	st.cv = capVal{int32(k), int32(k + 1), tags, r.terminalStructure(it.prod, int(it.dot), k, sym.id), r.terminalCloses(k, r.g.terminals[sym.id]), 0}
	st.l = link{prev: it, tok: int32(k), term: sym.id}
	return true
}
