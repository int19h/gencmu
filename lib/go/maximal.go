package gencmu

// The resolution maximal (engine §4): an elided terminator is forbidden
// where its constituent, the node before it, could have been longer.

// maximal is what the ranking asks of maximal, over one parse's chart.
type maximal struct {
	rec *recognizer
	// elides is, for the helper of each elidable optional, the terminal it
	// elides, and "" for every other rule.
	elides []string
	// furthest is the furthest set holding a completed item of each rule from
	// each origin, found when first asked for.
	furthest map[ruleOrigin]int32
	// ends lists, for a spelled symbol, every set holding a completed item
	// of each rule from each origin, in order, found when first asked for.
	ends map[ruleOrigin][]int32
}

type ruleOrigin struct{ rule, origin int32 }

func newMaximal(rec *recognizer) *maximal {
	mx := &maximal{rec: rec, elides: make([]string, len(rec.g.rules))}
	for _, p := range rec.g.prods {
		if p.helper && p.elided != "" {
			mx.elides[p.lhs] = p.elided
		}
	}
	return mx
}

// elided says whether a constituent of a rule over [start, end) is an elided
// terminator: the helper of an elidable optional, deriving ε.
func (mx *maximal) elided(rule, start, end int32) bool {
	return start == end && mx.elides[rule] != ""
}

// guards says whether an item's next symbol is an elidable optional whose
// elision the node before it can forbid: not at the start of a production,
// and not after a production's first symbol when that is its own rule, what
// a repetition has read so far.
func (mx *maximal) guards(it *item) bool {
	rhs := it.prod.rhs
	if it.dot == 0 || int(it.dot) == len(rhs) {
		return false
	}
	if next := rhs[it.dot]; next.term || mx.elides[next.id] == "" {
		return false
	}
	return !(it.dot == 1 && !rhs[0].term && rhs[0].id == it.prod.lhs)
}

// forbids says whether an elided terminator may not follow a constituent of
// a rule over [start, end), which stands for a symbol with the given
// spelling, or "": whether the rule completes from start in a later set,
// over a span that also sounds like the spelling if there is one (§4).
func (mx *maximal) forbids(rule, start, end int32, spelling string) bool {
	if spelling != "" {
		if mx.ends == nil {
			mx.ends = map[ruleOrigin][]int32{}
			for k, s := range mx.rec.sets {
				for key := range s.syms {
					ro := ruleOrigin{key.rule, key.origin}
					if list := mx.ends[ro]; len(list) == 0 || list[len(list)-1] != int32(k) {
						mx.ends[ro] = append(list, int32(k))
					}
				}
			}
		}
		base := mx.rec.base
		for _, e := range mx.ends[ruleOrigin{rule, start}] {
			if e > end && mx.rec.run.spellingMatches(spelling, base+int(start), base+int(e)) {
				return true
			}
		}
		return false
	}
	if mx.furthest == nil {
		// Whether a constituent could have been longer depends only on its
		// rule, origin and end: the furthest set in which each rule completes
		// from each origin decides it.
		mx.furthest = map[ruleOrigin]int32{}
		for k, s := range mx.rec.sets {
			for key := range s.syms {
				mx.furthest[ruleOrigin{key.rule, key.origin}] = int32(k)
			}
		}
	}
	far, ok := mx.furthest[ruleOrigin{rule, start}]
	return ok && far > end
}
