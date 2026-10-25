package gencmu

// Suffix recognition retains eligible answers at completed input boundaries.
type suffixTarget struct {
	g    *lowered
	rule int32
}

type suffixKey struct {
	target     suffixTarget
	start, end int
}

type suffixState struct {
	answers map[int]bool
	rec     *recognizer
	active  bool
	errorAt int
	fault   any
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

func (run *stageRun) suffixState(g *lowered, rule int32, start, end int) *suffixState {
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
	key := suffixKey{target, start, -1}
	if dependent {
		key.end = end
	}
	if ps.suffixes == nil {
		ps.suffixes = map[suffixKey]*suffixState{}
	}
	state := ps.suffixes[key]
	if state == nil {
		state = &suffixState{answers: map[int]bool{}}
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
				var span *domTerm
				var targets []*domTerm
				if c := n.c; c != nil {
					if !here.nested && (c.Kind == cdEnd || c.Kind == cdBoundary && c.Op == "followed-by") {
						found = true
					}
					if c.Kind == cdMatches || c.Kind == cdBegins || c.Kind == cdEnds {
						span, targets = c.Span, c.queryTargets()
					}
				}
				if t := n.t; t != nil && t.Kind == tmCall {
					if !here.nested && (t.Str == "onward" || t.Str == "following-tokens") {
						found = true
					}
					if t.Str == "tags" && len(t.Items) == 2 {
						span, targets = t.Items[0], t.Items[1:]
					}
				}
				if span != nil {
					if restoredTerm(span) {
						found = true
					}
					for _, target := range targets {
						if target.Kind == tmRule {
							pending = append(pending, entry{g.byName[target.Str], true})
						}
					}
				}
				return !found
			}
			for _, c := range p.predictConds {
				walkClause(clausePart{c: c}, scan)
			}
			for _, c := range p.conds {
				walkClause(clausePart{c: c.cond}, scan)
			}
			for _, c := range p.rankedConditions {
				walkClause(clausePart{c: c}, scan)
			}
			walkClause(clausePart{t: p.tags}, scan)
			walkClause(clausePart{t: p.parentTags}, scan)
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
		if key.rule == r.startRule && !key.requested && (r.boundaries == nil || r.boundaries.accepts(node.boundary, func(*boundaryLiteral) {})) {
			witnesses = append(witnesses, node.items...)
		}
	}
	r.suffix.answers[at] = len(r.eligibleItems(witnesses)) > 0
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
	st.cv = capVal{int32(k), int32(k + 1), tags, r.terminalStructure(it.prod, int(it.dot), k, sym.id), r.terminalCloses(k, r.g.terminals[sym.id])}
	st.l = link{prev: it, tok: int32(k), term: sym.id}
	return true
}
