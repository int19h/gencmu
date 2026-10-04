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
// An omission of a maximal terminator with a constituent Y is also
// forbidden when the chart has a longer Y: a completed item of Y from the
// same origin with a later end, which passes Y's test. It need not be
// eligible or fit a proof tree. Maximality never forbids an omission with no
// constituent, and stage-wide maximal does not apply to a query.
//
// Each item has two states, computed together to the least fixpoint. E says
// that the item has an eligible proof tree. P says that it has one whose
// own fixed prefix permits the optional after it to be empty. P follows the
// advance of its proof tree, so a permitted omission never combines with
// the prefix of another proof tree.

// elidableHelpers says, for each rule of a lowered grammar, whether it is
// the helper of an elidable optional (§3.8).
func elidableHelpers(g *lowered) ([]bool, bool) {
	helpers := make([]bool, len(g.rules))
	any := false
	for _, p := range g.prods {
		if p.helper && p.elided != "" {
			helpers[p.lhs], any = true, true
		}
	}
	return helpers, any
}

// Where an elidable optional comes next after an item.
const (
	nextNone        = iota // no elidable optional comes next
	nextAlone              // one comes next, and it has no constituent
	nextConstituent        // one comes next, after the node of its constituent Y
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
	return r.sets[it.origin].index[itemKey{prod: it.prod, origin: it.origin}]
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
	if d == 0 || rhs[d-1].term || (d == 1 && rhs[0].id == it.prod.lhs) {
		return nextAlone
	}
	return nextConstituent
}

// eligibleItems keeps of the completed items those that have an eligible
// proof tree (§4).
func (r *recognizer) eligibleItems(items []*item) []*item {
	helpers, any := elidableHelpers(r.g)
	if !any || len(items) == 0 {
		return items
	}
	if w := work.Load(); w != nil {
		w.eligibilityRuns.Add(1)
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
		if _, ok := e.index[root]; ok {
			continue
		}
		e.index[root] = -1
		stack := []frame{{it: root}}
		for len(stack) > 0 {
			f := &stack[len(stack)-1]
			var below *item
			for below == nil && f.next < 2*len(f.it.links) {
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
	if !omits {
		return items
	}
	// The prefixes that the chart advances over a written optional, from
	// the whole chart, and for each item before a constituent Y, the
	// furthest end of an advance over Y whose item then reads the optional
	// as written.
	reads := map[*item]bool{}
	for _, s := range r.sets {
		for _, it := range s.items {
			for _, l := range it.links {
				if e.written(l) {
					reads[r.before(it, l)] = true
				}
			}
		}
	}
	further := map[*item]int32{}
	for it := range reads {
		for _, l := range it.links {
			if l.sym == nil {
				continue
			}
			b := r.before(it, l)
			if end, ok := further[b]; !ok || end < it.set {
				further[b] = it.set
			}
		}
	}
	n := len(e.order)
	next := make([]int, n)
	// mx is the maximality of the grammar's maximal terminators over the
	// query's chart, made once per query, and maximalNext says whether the
	// optional after an item is of a maximal terminator.
	mx := r.queryMaximal()
	maximalNext := make([]bool, n)
	for i, it := range e.order {
		next[i] = e.next(it)
		if next[i] == nextConstituent && mx != nil && mx.elides[it.prod.rhs[it.dot].id] != "" {
			maximalNext[i] = true
		}
	}
	E, P := make([]bool, n), make([]bool, n)
	childE := func(s *symNode) bool {
		for _, c := range s.items {
			if E[e.index[c]] {
				return true
			}
		}
		return false
	}
	for changed := true; changed; {
		changed = false
		for x, it := range e.order {
			if E[x] && (P[x] || next[x] == nextNone) {
				continue
			}
			// A predicted item is a leaf.
			a, p := it.dot == 0, false
			if a && next[x] == nextAlone && !reads[it] {
				p = true
			}
			for _, l := range it.links {
				b := r.before(it, l)
				var ok bool
				switch {
				case l.sym == nil:
					ok = E[e.index[b]]
				case e.omission(l):
					ok = P[e.index[b]] && childE(l.sym)
				default:
					ok = E[e.index[b]] && childE(l.sym)
				}
				if !ok {
					continue
				}
				a = true
				switch next[x] {
				case nextAlone:
					if !reads[it] {
						p = true
					}
				case nextConstituent:
					// The advance over Y: its item before is the fixed
					// prefix, which must permit the omission.
					if l.sym != nil {
						// A maximal terminator also needs the longest Y.
						if end, ok := further[b]; (!ok || end < it.set) && !(maximalNext[x] && mx.forbids(l.sym.rule, l.sym.start, l.sym.end, it.prod.testAt(int(it.dot)-1))) {
							p = true
						}
					}
				}
			}
			if a && !E[x] {
				E[x], changed = true, true
			}
			if p && !P[x] {
				P[x], changed = true, true
			}
		}
	}
	var out []*item
	for _, it := range items {
		if E[e.index[it]] {
			out = append(out, it)
		}
	}
	return out
}

// queryMaximal is the maximality of a nested query's chart: of the maximal
// terminators of the grammar alone, made once per query. It is nil where
// the grammar has none.
func (r *recognizer) queryMaximal() *maximal {
	if !r.mxMade {
		r.mx, r.mxMade = newMaximal(r, false), true
	}
	return r.mx
}
