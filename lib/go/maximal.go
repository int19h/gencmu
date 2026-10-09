package gencmu

// Maximality (engine §4): an elided terminator is forbidden where its
// constituent, the node before it, could have been longer.
// A maximal terminator restricts omission in main and nested parses.
// maximal is what the ranking asks of maximal, over one parse's chart.
type maximal struct {
	contextual        map[rankedCompletion][]*symNode
	contextualPassing map[rankedMaximal]int32
	rec               *recognizer
	// elides is, for the helper of each elidable optional, the terminal it
	// elides, and "" for every other rule.
	elides []string
	// furthest is the furthest set holding a completed item of each rule from
	// each origin, found when first asked for.
	furthest map[ruleOrigin]int32
	// completed lists, for a tested symbol, every completed constituent of
	// each rule from each origin, with its end and its tags, found when
	// first asked for.
	completed map[ruleOrigin][]*symNode
	// passing is, for a tested symbol, the furthest end of a completed
	// constituent of its rule from an origin that passes the test, or -1,
	// found once for each rule, origin and test.
	passing map[testOrigin]int32
}

type ruleOrigin struct{ rule, origin int32 }

type testOrigin struct {
	ro ruleOrigin
	t  *symTest
}

// newMaximal restricts the maximal terminators of a chart.
// It is nil where the grammar has none.
func newMaximal(rec *recognizer) *maximal {
	elides := rec.g.maximalElides
	if elides == nil {
		return nil
	}
	return &maximal{rec: rec, elides: elides}
}

// maximalElides is, for the helper of each elidable optional that
// maximality restricts, the terminal it elides, and "" for every other
// rule, or nil where it restricts none. Lowering makes it once.
func maximalElides(g *lowered) []string {
	var elides []string
	w := work.Load()
	for _, p := range g.prods {
		if w != nil {
			w.elidableSteps.add("elidable steps")
		}
		if p.helper && p.elided != "" && g.maximalH[p.lhs] {
			if elides == nil {
				elides = make([]string, len(g.rules))
			}
			elides[p.lhs] = p.elided
		}
	}
	return elides
}

// elided says whether a constituent of a rule over [start, end) is an elided
// terminator that maximality restricts: the helper of such an optional,
// deriving ε.
func (mx *maximal) elided(rule, start, end int32) bool {
	return start == end && mx.elides[rule] != ""
}

// guards says whether an item's next symbol is a restricted optional whose
// elision the node before it can forbid: not at the start of a production,
// and not after a production's first symbol when that is its own rule, what
// left recursion, such as a left chain's, has read so far.
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
// a rule over [start, end), which stands for a symbol with the given test,
// or nil: whether the rule completes from start in a later set, where the
// test, if there is one, holds of that longer constituent too, with its own
// span and tags (§4).
func (mx *maximal) forbids(rule, start, end int32, t *symTest) bool {
	if w := work.Load(); w != nil {
		w.checks.add("checks")
	}
	if t != nil {
		if mx.completed == nil {
			mx.completed = map[ruleOrigin][]*symNode{}
			for _, s := range mx.rec.sets {
				for key, c := range s.syms {
					if w := work.Load(); w != nil {
						w.scanned.add("scanned")
					}
					ro := ruleOrigin{key.rule, key.origin}
					mx.completed[ro] = append(mx.completed[ro], c)
				}
			}
		}
		// The test reads only the candidate's own span and tags, so the
		// furthest end that passes it is found once.
		ro := ruleOrigin{rule, start}
		key := testOrigin{ro, t}
		if mx.passing == nil {
			mx.passing = map[testOrigin]int32{}
		}
		far, ok := mx.passing[key]
		if !ok {
			far = -1
			base := mx.rec.base
			for _, c := range mx.completed[ro] {
				if w := work.Load(); w != nil {
					w.candidates.add("candidates")
				}
				if c.end > far && mx.rec.run.testHolds(t, base+int(start), base+int(c.end), c.tags) {
					far = c.end
				}
			}
			mx.passing[key] = far
		}
		return far > end
	}
	if mx.furthest == nil {
		// Whether a constituent could have been longer depends only on its
		// rule, origin and end: the furthest set in which each rule completes
		// from each origin decides it.
		mx.furthest = map[ruleOrigin]int32{}
		for k, s := range mx.rec.sets {
			for key := range s.syms {
				if w := work.Load(); w != nil {
					w.scanned.add("scanned")
				}
				mx.furthest[ruleOrigin{key.rule, key.origin}] = int32(k)
			}
		}
	}
	far, ok := mx.furthest[ruleOrigin{rule, start}]
	return ok && far > end
}

type rankedCompletion struct {
	rule, origin int32
	frame        *rankedFrame
}
type rankedMaximal struct {
	completion rankedCompletion
	test       *symTest
}

func (mx *maximal) forbidsIn(rule, start, end int32, t *symTest, lexical *rankedFrame) bool {
	if lexical == nil {
		return mx.forbids(rule, start, end, t)
	}
	if mx.contextual == nil {
		mx.contextual = map[rankedCompletion][]*symNode{}
		mx.contextualPassing = map[rankedMaximal]int32{}
		for _, set := range mx.rec.sets {
			for _, sym := range set.syms {
				key := rankedCompletion{sym.rule, sym.start, sym.lexical}
				mx.contextual[key] = append(mx.contextual[key], sym)
			}
		}
	}
	key := rankedMaximal{rankedCompletion{rule, start, lexical}, t}
	furthest, ok := mx.contextualPassing[key]
	if !ok {
		furthest = -1
		for _, sym := range mx.contextual[key.completion] {
			if (t == nil || mx.rec.symbolTest(t, capVal{sym.start, sym.end, sym.tags.id, sym.structure}, false)) && sym.end > furthest {
				furthest = sym.end
			}
		}
		mx.contextualPassing[key] = furthest
	}
	return furthest > end
}
