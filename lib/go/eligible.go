package gencmu

// Written-terminator priority for nested queries (engine §4): which
// completed items of a queried rule have an eligible proof tree.
//
// A proof tree of an item is made of the advances that the recognizer
// recorded as links. An omission is an advance over the empty helper of an
// elidable optional. It is forbidden where the prefix that the proof tree
// holds fixed can go on and read the whole optional as written:
//
//   - Where the optional has a constituent Y, the fixed prefix is the item
//     before Y. The omission at p is forbidden when the chart advances that
//     item over a completed Y to some p′ ≥ p, and the item so made advances
//     over the optional's nonempty alternative.
//   - Otherwise the fixed prefix is the item before the optional, and the
//     omission is forbidden when the chart advances that item over the
//     nonempty alternative.
//
// The chart is the whole recognition of the query, so an attempt that
// never completes the rule can forbid an omission.
//
// Each item has two states, computed together to the least fixpoint.
// E says that the item has an eligible proof tree.
// P says that the same tree permits the optional after its own prefix to be empty.
//
// elidableHelpers says, for each rule of a lowered grammar, whether it is
// the helper of an elidable optional (§3.8).
func elidableHelpers(g *lowered) ([]bool, bool) {
	helpers := make([]bool, len(g.rules))
	any := false
	w := work.Load()
	for _, p := range g.prods {
		if w != nil {
			w.elidableSteps.add("elidable steps")
		}
		if p.helper && p.elided != "" {
			helpers[p.lhs], any = true, true
		}
	}
	return helpers, any
}

// Where an elidable optional comes next after an item.
const (
	nextNone            = iota // no elidable optional comes next
	nextAlone                  // one comes next, and it has no constituent
	nextConstituent            // one comes next, after the node of its constituent Y
	nextElementOptional        // the preceding optional has several physical routes
)

// eligibility holds the states of the items that some queried items rest on.
type eligibility struct {
	r       *recognizer
	helpers []bool
	index   map[*item]int
	order   []*item
}

// before is the item before the advance of a link of it: the link's item,
// or for an advance from a predicted item, which the link does not hold,
// that predicted item.
func (r *recognizer) before(it *item, l link) *item {
	if l.prev != nil {
		return l.prev
	}
	key := itemKey{prod: it.prod, origin: it.origin}
	if r.trees != nil {
		r.finishTree(&key)
	}
	if r.boundaries != nil {
		key.boundary = r.boundaries.empty
	}
	return r.sets[it.origin].index[key]
}

// omission says whether a link advances over the empty helper of an
// elidable optional, and written whether it advances over its nonempty
// alternative.
func (e *eligibility) omission(l link) bool {
	return l.sym != nil && e.helpers[l.sym.rule] && l.sym.start == l.sym.end
}

func (e *eligibility) written(l link) bool {
	return l.sym != nil && e.helpers[l.sym.rule] && l.sym.start < l.sym.end
}

// next says whether an elidable optional comes next after an item, and
// whether it has a constituent: not at the start, not after a terminal, and
// not after the first symbol of a production whose first symbol is its own
// rule (§4).
func (e *eligibility) next(it *item) int {
	rhs := it.prod.rhs
	d := int(it.dot)
	if d >= len(rhs) || rhs[d].term || !e.helpers[rhs[d].id] {
		return nextNone
	}
	if it.prod.precedingElementOptional(d) != nil {
		return nextElementOptional
	}
	if d == 0 || rhs[d-1].term || (d == 1 && rhs[0].id == it.prod.lhs && it.prod.precedingElementOptional(0) == nil) {
		return nextAlone
	}
	return nextConstituent
}

// eligibleItems keeps of the completed items those that have an eligible
// proof tree (§4).
func (r *recognizer) eligibleItems(items []*item, errorFree bool) []*item {
	states := r.eligibilityStates(items, errorFree)
	var out []*item
	for _, it := range items {
		if states[it] != 0 && (!errorFree || states[it]&1 != 0) {
			out = append(out, it)
		}
	}
	return out
}

func eligibilityStep() {
	if w := work.Load(); w != nil {
		w.visits.add("eligibility steps")
	}
}

func (r *recognizer) eligibilityStates(items []*item, errorFree bool) map[*item]uint8 {
	helpers := r.g.elidable
	if !r.g.anyElidable && !r.g.hasErrors && !errorFree || len(items) == 0 {
		states := map[*item]uint8{}
		for _, item := range items {
			states[item] = 1
		}
		return states
	}
	if w := work.Load(); w != nil {
		w.eligibilityRuns.add("eligibilityRuns")
	}
	e := &eligibility{r: r, helpers: helpers, index: map[*item]int{}}
	// The items that the queried ones rest on, each after those below it
	// where the links allow, so that one sweep settles most of them.
	omits := false
	type frame struct {
		it   *item
		next int // the next step: link i's item before, then its child's items
		kid  int
	}
	for _, root := range items {
		eligibilityStep()
		if _, ok := e.index[root]; ok {
			continue
		}
		e.index[root] = -1
		stack := []frame{{it: root}}
		for len(stack) > 0 {
			eligibilityStep()
			f := &stack[len(stack)-1]
			var below *item
			for below == nil && f.next < 2*len(f.it.links) {
				eligibilityStep()
				l := f.it.links[f.next/2]
				if f.next%2 == 0 {
					below = r.before(f.it, l)
					f.next++
				} else if l.sym != nil && f.kid < len(l.sym.items) {
					below = l.sym.items[f.kid]
					f.kid++
				} else {
					if e.omission(l) {
						omits = true
					}
					f.next++
					f.kid = 0
				}
				if below != nil {
					if _, seen := e.index[below]; seen {
						below = nil
					}
				}
			}
			if below != nil {
				e.index[below] = -1
				stack = append(stack, frame{it: below})
				continue
			}
			e.index[f.it] = len(e.order)
			e.order = append(e.order, f.it)
			stack = stack[:len(stack)-1]
		}
	}
	// With no omission, every item of a chart has a finite proof tree, made
	// from predicted items in the order in which the recognizer made it.
	if !omits && !r.g.hasErrors && !errorFree {
		states := map[*item]uint8{}
		for _, item := range items {
			states[item] = 1
		}
		return states
	}
	// The prefixes that the chart advances over a written optional, from
	// the whole chart, and for each item before a constituent Y, the
	// furthest end of an advance over Y whose item then reads the optional
	// as written.
	reads := map[*item]bool{}
	for _, s := range r.sets {
		for _, it := range s.items {
			eligibilityStep()
			for _, l := range it.links {
				eligibilityStep()
				if e.written(l) {
					reads[r.before(it, l)] = true
				}
			}
		}
	}
	further := map[*item]int32{}
	for it := range reads {
		for _, l := range it.links {
			eligibilityStep()
			if l.sym == nil {
				continue
			}
			b := r.before(it, l)
			if end, ok := further[b]; !ok || end < it.set {
				further[b] = it.set
			}
		}
	}
	element := newElementPriority(r, reads)
	n := len(e.order)
	next := make([]int, n)
	for i, it := range e.order {
		next[i] = e.next(it)
	}
	// Bit 1 is a clean proof, and bit 2 is a proof with carried errors.
	// Raw support admits own errors so an erased completion can replace it.
	E, P := make([]uint8, n), make([]uint8, n)
	R, RP := make([]uint8, n), make([]uint8, n)
	dirty := func(l link) bool {
		index := r.base + int(l.tok)
		if r.recon != nil {
			index = r.recon.original[l.tok]
			if index < 0 {
				return false
			}
		}
		return len(r.run.toks[index].Errors) > 0
	}
	children := func(sym *symNode, states []uint8) uint8 {
		var result uint8
		for _, child := range sym.items {
			eligibilityStep()
			result |= states[e.index[child]]
		}
		return result
	}
	for changed := true; changed; {
		changed = false
		for x, it := range e.order {
			eligibilityStep()
			for channel := 0; channel < 2; channel++ {
				states, permissions := R, RP
				if channel == 1 {
					states, permissions = E, P
				}
				stateOf := func(item *item) uint8 { return states[e.index[item]] }
				beforeStates := func(item *item, edge link) uint8 {
					before := r.before(item, edge)
					if e.omission(edge) {
						return permissions[e.index[before]]
					}
					return stateOf(before)
				}
				advance := func(item *item, edge link) uint8 {
					before := beforeStates(item, edge)
					if edge.sym == nil {
						if dirty(edge) && before != 0 {
							return 2
						}
						return before
					}
					return combineProofStates(before, children(edge.sym, states))
				}
				a, p := uint8(0), uint8(0)
				if it.dot == 0 {
					a = 1
					if it.restores && dirty(it.links[0]) {
						a = 2
					}
				}
				if next[x] == nextAlone && !reads[it] {
					p = a
				}
				if !it.restores {
					for _, edge := range it.links {
						eligibilityStep()
						through := advance(it, edge)
						if through == 0 {
							continue
						}
						a |= through
						switch next[x] {
						case nextAlone:
							if !reads[it] {
								p |= through
							}
						case nextConstituent:
							if edge.sym != nil {
								if end, ok := further[r.before(it, edge)]; !ok || end < it.set {
									p |= through
								}
							}
						}
					}
				}
				if a != 0 && next[x] == nextElementOptional {
					predecessors := func(item *item, edge link, bit uint8) uint8 {
						before := beforeStates(item, edge)
						var allowed uint8
						for _, b := range []uint8{1, 2} {
							if before&b == 0 {
								continue
							}
							if edge.sym == nil {
								after := b
								if dirty(edge) {
									after = 2
								}
								if after == bit {
									allowed |= b
								}
							} else {
								child := children(edge.sym, states)
								for _, c := range []uint8{1, 2} {
									if child&c != 0 && combineProofStates(b, c) == bit {
										allowed |= b
									}
								}
							}
						}
						return allowed
					}
					for _, bit := range []uint8{1, 2} {
						if a&bit != 0 && element.permitsEligible(it, bit, stateOf, predecessors) {
							p |= bit
						}
					}
				}
				if int(it.dot) == len(it.prod.rhs) {
					if it.prod.nothing {
						if R[x]|a != 0 {
							a = 1
						}
						if p != 0 {
							p = 1
						}
					} else if it.prod.error != nil {
						if channel == 0 {
							if a != 0 {
								a = 2
							}
							if p != 0 {
								p = 2
							}
						} else {
							a, p = 0, 0
						}
					}
				}
				if states[x]|a != states[x] {
					states[x] |= a
					changed = true
				}
				if permissions[x]|p != permissions[x] {
					permissions[x] |= p
					changed = true
				}
			}
		}
	}
	states := map[*item]uint8{}
	for _, item := range items {
		states[item] = E[e.index[item]]
	}
	return states
}

func combineProofStates(left, right uint8) uint8 {
	clean := left & right & 1
	if left != 0 && right != 0 && (left|right)&2 != 0 {
		return clean | 2
	}
	return clean
}
