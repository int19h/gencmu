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
	// In the reconstruction mode of the check of elision-only (engine
	// §7.4): strict says that every step that made the item is strict;
	// restores that it is the restoration of an elidable optional, a read of
	// the synthetic token at its origin. queued says that the item waits in
	// its set's queue, and processed that it has been processed once.
	strict, restores, queued, processed bool
}

// link is one way an item was reached: its predecessor (nil for dot 1 from a
// prediction) and the child it read, a token or a completed constituent. A
// restoration has one link, with no predecessor, that reads its synthetic
// token (engine §7.4).
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
	items []*item
	// queue holds the items still to process, from head; an item that
	// becomes ordinary after it was processed strict comes again (§7.4).
	queue   []*item
	head    int
	index   map[itemKey]*item
	waiting map[int32][]*item
	// predicted holds the rules predicted here, each with how: predStrict
	// or predOrdinary (§7.4).
	predicted map[int32]uint8
	syms      map[symKey]*symNode
	empties   map[int32][]*symNode
}

const (
	predStrict = iota + 1
	predOrdinary
)

type recognizer struct {
	run     *stageRun
	g       *lowered
	base, n int
	// recon is how the recognition of the check of elision-only reads the
	// reconstructed input and observes the stage's input (§7.2-§7.5); nil
	// for every other recognition.
	recon    *reconstruction
	sets     []*eset
	furthest int
	// mx is the maximality of a nested query's chart, made when first
	// asked for (eligible.go).
	mx     *maximal
	mxMade bool
}

func (r *recognizer) set(k int) *eset {
	for len(r.sets) <= k {
		r.sets = append(r.sets, &eset{index: map[itemKey]*item{}})
	}
	return r.sets[k]
}

// recognize runs the recognizer over tokens [base, base+n) of the stage with
// start as the start rule. While it runs, the input that initial(), from()
// and after() see is [base, base+n), and a nested recognition sets its own.
func (run *stageRun) recognize(g *lowered, start int32, base, n int) *recognizer {
	outerStart, outerEnd := run.inputStart, run.inputEnd
	run.inputStart, run.inputEnd = base, base+n
	defer func() { run.inputStart, run.inputEnd = outerStart, outerEnd }()
	r := &recognizer{run: run, g: g, base: base, n: n}
	r.loop(start)
	return r
}

// loop recognizes the recognizer's input from the start rule.
func (r *recognizer) loop(start int32) {
	s0 := r.set(0)
	r.predict(s0, 0, start, false)
	for k := 0; k <= r.n && k < len(r.sets); k++ {
		s := r.sets[k]
		if len(s.items) > 0 {
			r.furthest = k
		}
		for s.head < len(s.queue) {
			it := s.queue[s.head]
			s.head++
			it.queued = false
			r.process(k, it)
		}
		s.queue, s.head = nil, 0
	}
}

// tokenTags is the tags that recognition reads of token k: in the check of
// elision-only, its recognition tags (§7.2).
func (r *recognizer) tokenTags(k int) *tagset {
	if r.recon != nil {
		return r.recon.tagsets[k]
	}
	return r.run.tagsets[r.base+k]
}

// observed is where an observation reads the span [a, b) of the
// recognizer's input, in positions of the stage's input: in the check of
// elision-only, its projection (§7.3).
func (r *recognizer) observed(a, b int32) (int, int) {
	if r.recon != nil {
		return r.recon.project[a], r.recon.project[b]
	}
	return r.base + int(a), r.base + int(b)
}

// predict adds the items of a rule's productions at k, except those whose
// first symbol is a terminal the next token lacks, which could never
// advance; expected() accounts for them in a rejection.
//
// In the reconstruction mode (§7.4), the empty production of an elidable
// optional is its restoration, which reads the synthetic token at k, and
// it never derives the empty sequence. A strict prediction predicts only
// the productions that can read, and its items are strict. An ordinary
// prediction after a strict one adds what the strict one left out, and
// makes ordinary the items that they share.
func (r *recognizer) predict(s *eset, k int, rule int32, strict bool) {
	before := s.predicted[rule]
	if before == predOrdinary || (before == predStrict && strict) {
		return
	}
	if s.predicted == nil {
		s.predicted = map[int32]uint8{}
	}
	s.predicted[rule] = predOrdinary
	if strict {
		s.predicted[rule] = predStrict
	}
	var reading *readingSets
	if r.recon != nil {
		reading = r.recon.reading
	}
	for _, p := range r.g.rules[rule].prods {
		if reading != nil && p.restoration() {
			r.restore(k, p)
			continue
		}
		if strict && reading.last[p] < 0 {
			continue
		}
		if len(p.rhs) > 0 && p.rhs[0].term && !r.canRead(k, p.rhs[0].id) {
			continue
		}
		if !r.predictable(p, k) {
			continue
		}
		r.add(k, itemKey{prod: p, origin: int32(k)}, link{}, false, strict)
	}
}

// restore adds the restoration of an elidable optional at k (§7.4): its
// empty production read over the one synthetic token there, where that
// token is compatible with the optional. It has no tags, and it evaluates
// nothing of the optional's content.
func (r *recognizer) restore(k int, p *production) {
	rc := r.recon
	if k >= r.n || !rc.synthetic[k] {
		return
	}
	term, ok := r.g.termID[p.elided]
	if !ok || !rc.tagsets[k].has(p.elided) {
		return
	}
	if p.elidedTest != nil && !r.tokenTest(p.elidedTest, k) && !r.run.ps.fault("restore") {
		return
	}
	key := itemKey{prod: p, origin: int32(k)}
	s := r.set(k + 1)
	if s.index[key] != nil {
		return
	}
	it := &item{itemKey: key, set: int32(k + 1), restores: true, queued: true}
	it.links = []link{{tok: int32(k), term: term}}
	if w := work.Load(); w != nil {
		w.items.Add(1)
	}
	s.index[key] = it
	s.items = append(s.items, it)
	s.queue = append(s.queue, it)
}

func (r *recognizer) canRead(k int, term int32) bool {
	if k >= r.n {
		return false
	}
	return r.reads(r.tokenTags(k), term)
}

// reads says whether a terminal matches a token with these tags (§4): a tag
// it carries, or, for a range or a property, one of its character tags.
func (r *recognizer) reads(ts *tagset, term int32) bool {
	if cc := r.g.classes[term]; cc != nil {
		return cc.carries(r.run.ps.uni, ts)
	}
	return ts.has(r.g.terminals[term])
}

// predictable checks the conditions of a production that mention no
// capture, which hold or fail at prediction at k, as do those of a
// production with no symbols that mention $, over the empty span there.
func (r *recognizer) predictable(p *production, k int) bool {
	if len(p.predictConds) > 0 {
		var caps [4]capVal
		var tags func() *tagset
		if len(p.rhs) == 0 {
			// The tag term runs only where a condition reads $'s tags (§4).
			tags = r.lazyTags(p, &caps, int32(k), int32(k))
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

// add adds an item, or a link to it where it exists. strict says whether
// the step that makes it is strict (§7.4): a strict item never completes,
// and one ordinary step makes an item ordinary, which is then processed
// again for what its strictness held back.
func (r *recognizer) add(k int, key itemKey, l link, hasLink, strict bool) {
	if strict && int(key.dot) == len(key.prod.rhs) {
		return
	}
	s := r.set(k)
	it := s.index[key]
	if it == nil {
		it = &item{itemKey: key, set: int32(k), strict: strict, queued: true}
		if w := work.Load(); w != nil {
			w.items.Add(1)
		}
		s.index[key] = it
		s.items = append(s.items, it)
		s.queue = append(s.queue, it)
	} else if it.strict && !strict {
		it.strict = false
		if !it.queued && !(r.recon != nil && r.run.ps.fault("reprocess")) {
			it.queued = true
			s.queue = append(s.queue, it)
		}
	}
	if hasLink {
		if r.recon != nil {
			// Processing an item again can make a link that it made before.
			for _, x := range it.links {
				if x == l {
					return
				}
			}
		}
		it.links = append(it.links, l)
	}
}

// readsLater says whether a symbol after an item's next symbol can read
// (§7.4).
func (r *recognizer) readsLater(it *item) bool {
	return r.recon.reading.last[it.prod] > int(it.dot)
}

// heldBack says whether a strict item's advances over empty constituents
// are held back: a strict item makes them only where a symbol after its
// next symbol can read (§7.4).
func (r *recognizer) heldBack(it *item) bool {
	return r.recon != nil && it.strict && !r.readsLater(it)
}

func (r *recognizer) process(k int, it *item) {
	p := it.prod
	s := r.sets[k]
	again := it.processed
	it.processed = true
	if int(it.dot) < len(p.rhs) {
		sym := p.rhs[it.dot]
		if sym.term {
			// Strictness never holds back a read, so an item processed
			// again has read already.
			if k < r.n && !again {
				ts := r.tokenTags(k)
				if r.reads(ts, sym.id) {
					// In the check, a terminal that reads a synthetic token
					// captures no tags (§7.5). The written route of an
					// elidable optional from a synthetic token makes the item
					// after T strict (§7.4).
					tags, strict := ts.id, false
					if r.recon != nil && r.recon.synthetic[k] {
						tags = r.run.ps.in.empty().id
						strict = it.dot == 0 && r.recon.reading.elidable[p.lhs] && !r.run.ps.fault("route3")
					}
					r.advance(it, k+1, capVal{int32(k), int32(k + 1), tags}, link{prev: it, tok: int32(k), term: sym.id}, strict)
				}
			}
			return
		}
		if !again {
			if s.waiting == nil {
				s.waiting = map[int32][]*item{}
			}
			s.waiting[sym.id] = append(s.waiting[sym.id], it)
		}
		// A strict item predicts its next symbol strictly where no symbol
		// after it can read (§7.4).
		held := r.heldBack(it)
		r.predict(s, k, sym.id, held)
		if held {
			return
		}
		for _, c := range s.empties[sym.id] {
			r.advance(it, k, capVal{c.start, c.end, c.tags.id}, link{prev: it, sym: c}, it.strict)
		}
		return
	}
	// Complete.
	var ts *tagset
	if it.restores {
		// A restoration has the tags of the empty production, none (§7.4).
		ts = r.run.ps.in.empty()
	} else {
		ts = r.completedTags(p, &it.caps, it.origin, int32(k))
	}
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
	empty := int(it.origin) == k
	for i := 0; i < len(waiters); i++ {
		w := waiters[i]
		if empty && r.heldBack(w) {
			continue
		}
		r.advance(w, k, capVal{c.start, c.end, ts.id}, link{prev: w, sym: c}, empty && w.strict)
	}
}

// advance moves an item over its next symbol, read over cv, into set k,
// unless the symbol's test does not hold of it or a condition triggered
// there fails.
func (r *recognizer) advance(it *item, k int, cv capVal, l link, strict bool) {
	p := it.prod
	key := it.itemKey
	pos := int(key.dot)
	// A strict step that completes, route 3's read of T with nothing after
	// it, makes a strict item at the end of its production. The step drops
	// it before it evaluates anything (§4, §7.4; JS earley.js, the written
	// routes).
	if strict && pos+1 == len(p.rhs) {
		return
	}
	// A tested symbol's test must hold of its own span and tags, which is
	// checked before any condition the advance makes ready (§4).
	if t := p.testAt(pos); t != nil && !r.symbolTest(t, cv, l.sym == nil) {
		return
	}
	if slot := p.capSlot[pos]; slot >= 0 {
		key.caps[slot] = cv
	}
	key.dot++
	var whole func() *tagset
	for _, c := range p.conds {
		if c.trigger == int(key.dot) {
			// A condition on $ is evaluated once the item is complete. Its
			// production's tag term gives $ its tags, and runs only where a
			// condition reads them (§4).
			if c.whole && whole == nil {
				whole = r.lazyTags(p, &key.caps, key.origin, int32(k))
			}
			if !r.run.evaluator(r.g, r.captureFunc(p, &key.caps, key.origin, int32(k), whole)).cond(c.cond) {
				return
			}
		}
	}
	if l.prev != nil && l.prev.dot == 0 {
		l.prev = nil // a predicted item has no derivation of its own
	}
	r.add(k, key, l, true, strict)
}

// symbolTest says whether a test holds where an item advances over its
// symbol, read over cv (§4). A test of a terminal reads the token, with its
// recognition values in the check of elision-only. A test of a reference
// reads the projected span there, and its constituent's tags (§7.5).
func (r *recognizer) symbolTest(t *symTest, cv capVal, terminal bool) bool {
	if terminal {
		return r.tokenTest(t, int(cv.start))
	}
	a, b := r.observed(cv.start, cv.end)
	return r.run.testHolds(t, a, b, r.run.ps.in.all[cv.tags])
}

// tokenTest says whether a test of a terminal holds of token k of the
// recognizer's input, with its recognition tags and sound (§4, §7.2).
func (r *recognizer) tokenTest(t *symTest, k int) bool {
	if rc := r.recon; rc != nil {
		if rc.synthetic[k] {
			return testHoldsOf(t, func(s string) bool { return s == rc.sounds[k] }, rc.tagsets[k])
		}
		o := rc.original[k]
		return r.run.testHolds(t, o, o+1, r.run.tagsets[o])
	}
	i := r.base + k
	return r.run.testHolds(t, i, i+1, r.run.tagsets[i])
}

// captureFunc gives an item's captures; $ spans [origin, end) and has the
// tags that whole gives on demand, or none while they are being computed,
// when a term cannot read them (§9).
func (r *recognizer) captureFunc(p *production, caps *[4]capVal, origin, end int32, whole func() *tagset) func(string) (spanVal, bool) {
	// In the check of elision-only, every observation reads the projected
	// span, and the projection comes before any function of it (§7.5).
	return func(name string) (spanVal, bool) {
		if name == "" {
			a, b := r.observed(origin, end)
			return spanVal{a: a, b: b, whole: whole != nil, lazy: whole}, true
		}
		slot, ok := p.slotOf[name]
		if !ok {
			return spanVal{}, false
		}
		cv := caps[slot]
		a, b := r.observed(cv.start, cv.end)
		return spanVal{a: a, b: b, whole: true, tags: r.run.ps.in.all[cv.tags]}, true
	}
}

// lazyTags gives the constituent tags of a completing item on first use,
// and the same set after that (§4).
func (r *recognizer) lazyTags(p *production, caps *[4]capVal, origin, end int32) func() *tagset {
	var tags *tagset
	return func() *tagset {
		if tags == nil {
			tags = r.completedTags(p, caps, origin, end)
		}
		return tags
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

// begun says whether a start-rule constituent begins at the start of the
// input, in any set, with an eligible proof tree: whether a prefix of the
// input, the empty one included, parses as the start rule.
func (r *recognizer) begun(start int32) bool {
	var items []*item
	for _, s := range r.sets {
		for key, c := range s.syms {
			if key.rule == start && key.origin == 0 {
				items = append(items, c.items...)
			}
		}
	}
	// Only an item with an eligible proof tree counts (§4).
	return len(r.eligibleItems(items)) > 0
}

func sortSyms(s []*symNode) {
	for i := 1; i < len(s); i++ {
		for j := i; j > 0 && s[j].tags.key < s[j-1].tags.key; j-- {
			s[j], s[j-1] = s[j-1], s[j]
		}
	}
}
