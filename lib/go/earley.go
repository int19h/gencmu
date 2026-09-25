package gencmu

// The recognizer (engine §4): an Earley parser whose items carry, for each
// capture before the dot, the captured part's span and tag set, and which
// evaluates each condition as soon as the item has read the last capture it
// mentions. Every item records how it was reached, which is the packed
// forest the ranking (rank.go) reads.

type capVal struct {
	start, end int32
	tags       int32
}

type itemKey struct {
	prod   *production
	dot    int32
	origin int32
	caps   [4]capVal
}

type item struct {
	itemKey
	set   int32
	links []link
}

// link is one way an item was reached: its predecessor (nil for dot 1 from a
// prediction) and the child it read, a token or a completed constituent.
type link struct {
	prev *item
	sym  *symNode // nil for a read
	tok  int32    // for a read: the token, relative to the recognizer's base
	term int32
}

// symNode is every completed item of one rule over one span with one tag set.
type symNode struct {
	rule       int32
	start, end int32
	tags       *tagset
	items      []*item
}

type symKey struct {
	rule, origin, tags int32
}

type eset struct {
	items     []*item
	index     map[itemKey]*item
	waiting   map[int32][]*item
	predicted map[int32]bool
	syms      map[symKey]*symNode
	empties   map[int32][]*symNode
}

type recognizer struct {
	run      *stageRun
	g        *lowered
	base, n  int
	sets     []*eset
	furthest int
}

func (r *recognizer) set(k int) *eset {
	for len(r.sets) <= k {
		r.sets = append(r.sets, &eset{index: map[itemKey]*item{}})
	}
	return r.sets[k]
}

// recognize runs the recognizer over tokens [base, base+n) of the stage with
// start as the start rule. While it runs, the input that initial() tests
// begins at base, and a nested recognition sets its own.
func (run *stageRun) recognize(g *lowered, start int32, base, n int) *recognizer {
	outer := run.inputStart
	run.inputStart = base
	defer func() { run.inputStart = outer }()
	r := &recognizer{run: run, g: g, base: base, n: n}
	s0 := r.set(0)
	r.predict(s0, 0, start)
	for k := 0; k <= n && k < len(r.sets); k++ {
		s := r.sets[k]
		if len(s.items) > 0 {
			r.furthest = k
		}
		for i := 0; i < len(s.items); i++ {
			r.process(k, s.items[i])
		}
	}
	return r
}

// predict adds the items of a rule's productions at k, except those whose
// first symbol is a terminal the next token lacks, which could never
// advance; expected() accounts for them in a rejection.
func (r *recognizer) predict(s *eset, k int, rule int32) {
	if s.predicted[rule] {
		return
	}
	if s.predicted == nil {
		s.predicted = map[int32]bool{}
	}
	s.predicted[rule] = true
	for _, p := range r.g.rules[rule].prods {
		if len(p.rhs) > 0 && p.rhs[0].term && !r.canRead(k, p.rhs[0].id) {
			continue
		}
		if !r.predictable(p, k) {
			continue
		}
		r.add(k, itemKey{prod: p, origin: int32(k)}, link{}, false)
	}
}

func (r *recognizer) canRead(k int, term int32) bool {
	if k >= r.n {
		return false
	}
	_, ok := r.run.tagsets[r.base+k].has(r.g.terminals[term])
	return ok
}

// predictable checks the conditions of a production that mention no
// capture, which hold or fail at prediction at k, as do those of a
// production with no symbols that mention $, over the empty span there.
func (r *recognizer) predictable(p *production, k int) bool {
	if len(p.predictConds) > 0 {
		var caps [4]capVal
		var tags *tagset
		if len(p.rhs) == 0 {
			tags = r.completedTags(p, &caps, int32(k), int32(k))
		}
		ev := r.run.evaluator(r.g, r.captureFunc(p, &caps, int32(k), int32(k), tags))
		ok := true
		for _, c := range p.predictConds {
			if !ev.cond(c) {
				ok = false
				break
			}
		}
		if !ok {
			return false
		}
	}
	return true
}

func (r *recognizer) add(k int, key itemKey, l link, hasLink bool) {
	s := r.set(k)
	it := s.index[key]
	if it == nil {
		it = &item{itemKey: key, set: int32(k)}
		s.index[key] = it
		s.items = append(s.items, it)
	}
	if hasLink {
		it.links = append(it.links, l)
	}
}

func (r *recognizer) process(k int, it *item) {
	p := it.prod
	s := r.sets[k]
	if int(it.dot) < len(p.rhs) {
		sym := p.rhs[it.dot]
		if sym.term {
			if k < r.n {
				ts := r.run.tagsets[r.base+k]
				if _, ok := ts.has(r.g.terminals[sym.id]); ok {
					r.advance(it, k+1, capVal{int32(k), int32(k + 1), ts.id}, link{prev: it, tok: int32(k), term: sym.id})
				}
			}
			return
		}
		if s.waiting == nil {
			s.waiting = map[int32][]*item{}
		}
		s.waiting[sym.id] = append(s.waiting[sym.id], it)
		r.predict(s, k, sym.id)
		for _, c := range s.empties[sym.id] {
			r.advance(it, k, capVal{c.start, c.end, c.tags.id}, link{prev: it, sym: c})
		}
		return
	}
	// Complete.
	ts := r.completedTags(p, &it.caps, it.origin, int32(k))
	key := symKey{p.lhs, it.origin, ts.id}
	c := s.syms[key]
	if c != nil {
		c.items = append(c.items, it)
		return
	}
	c = &symNode{rule: p.lhs, start: it.origin, end: int32(k), tags: ts, items: []*item{it}}
	if s.syms == nil {
		s.syms = map[symKey]*symNode{}
	}
	s.syms[key] = c
	if int(it.origin) == k {
		if s.empties == nil {
			s.empties = map[int32][]*symNode{}
		}
		s.empties[p.lhs] = append(s.empties[p.lhs], c)
	}
	waiters := r.sets[it.origin].waiting[p.lhs]
	for i := 0; i < len(waiters); i++ {
		w := waiters[i]
		r.advance(w, k, capVal{c.start, c.end, ts.id}, link{prev: w, sym: c})
	}
}

// advance moves an item over its next symbol, read over cv, into set k,
// unless a condition triggered there fails.
func (r *recognizer) advance(it *item, k int, cv capVal, l link) {
	p := it.prod
	key := it.itemKey
	pos := int(key.dot)
	if slot := p.capSlot[pos]; slot >= 0 {
		key.caps[slot] = cv
	}
	key.dot++
	var whole *tagset
	for _, c := range p.conds {
		if c.trigger == int(key.dot) {
			// A condition on $ is evaluated once the item is complete,
			// with the tags its production's tag term gives it (§4).
			if c.whole && whole == nil {
				whole = r.completedTags(p, &key.caps, key.origin, int32(k))
			}
			if !r.run.evaluator(r.g, r.captureFunc(p, &key.caps, key.origin, int32(k), whole)).cond(c.cond) {
				return
			}
		}
	}
	if l.prev != nil && l.prev.dot == 0 {
		l.prev = nil // a predicted item has no derivation of its own
	}
	r.add(k, key, l, true)
}

// captureFunc gives an item's captures; $ spans [origin, end) and has the
// given tags, nil while they are being computed, when a term cannot read
// them (§9).
func (r *recognizer) captureFunc(p *production, caps *[4]capVal, origin, end int32, whole *tagset) func(string) (spanVal, bool) {
	return func(name string) (spanVal, bool) {
		if name == "" {
			return spanVal{a: r.base + int(origin), b: r.base + int(end), whole: whole != nil, tags: whole}, true
		}
		slot, ok := p.slotOf[name]
		if !ok {
			return spanVal{}, false
		}
		cv := caps[slot]
		return spanVal{a: r.base + int(cv.start), b: r.base + int(cv.end), whole: true, tags: r.run.ps.in.all[cv.tags]}, true
	}
}

// completedTags is the constituent tags of a production's item over
// [origin, end) with the given captures (engine §4).
func (r *recognizer) completedTags(p *production, caps *[4]capVal, origin, end int32) *tagset {
	in := r.run.ps.in
	switch {
	case p.tags != nil:
		return r.run.evaluator(r.g, r.captureFunc(p, caps, origin, end, nil)).tagsOf(p.tags)
	case p.implicit:
		return in.all[caps[p.capSlot[0]].tags]
	}
	return in.empty()
}

// accepted lists the completed start-rule constituents over the whole input.
func (r *recognizer) accepted(start int32) []*symNode {
	if len(r.sets) <= r.n {
		return nil
	}
	var out []*symNode
	for key, c := range r.sets[r.n].syms {
		if key.rule == start && key.origin == 0 {
			out = append(out, c)
		}
	}
	sortSyms(out)
	return out
}

func sortSyms(s []*symNode) {
	for i := 1; i < len(s); i++ {
		for j := i; j > 0 && s[j].tags.key < s[j-1].tags.key; j-- {
			s[j], s[j-1] = s[j-1], s[j]
		}
	}
}
