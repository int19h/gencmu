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

// itemKey is an item's identity. A captured part's span and tags are part
// of it (engine §4), and a production can have any number of captures:
// cap0 holds the first capture slot, and more the rest, a sequence interned
// by the recognizer, 0 for none. The common case of one slot, the implicit
// capture of a production with one symbol, needs no interning.
type itemKey struct {
	prod   *production
	dot    int32
	origin int32
	cap0   capVal
	more   int32
}

// capStep is the sequence of the capture slots after the first, extended
// by one capture: the key of the interned sequence it makes.
type capStep struct {
	parent int32
	cv     capVal
}

// capNode is an interned sequence of the capture slots after the first:
// the sequence it extends, which it shares, the capture it adds, and how
// many slots it holds, so the slot it adds is its depth. jump is an
// earlier sequence that a search for a slot can skip to: the parent's
// jump's jump where the two jumps skip the same number of slots, and the
// parent otherwise. These are the jumps of a skew-binary list, so a search
// for any slot takes a number of steps that grows with the logarithm of
// the slots.
type capNode struct {
	parent int32
	jump   int32
	cv     capVal
	depth  int32
}

// itemCaps is an item's captures, slot by slot.
type itemCaps struct {
	first capVal
	nodes []capNode
	more  int32
}

func (c itemCaps) at(slot int32) capVal {
	cv, _ := c.find(slot)
	return cv
}

// find is one slot's capture, the last at once and an earlier one by the
// jumps, and the number of steps the search took. Each step counts as it
// is taken.
func (c itemCaps) find(slot int32) (capVal, int) {
	if slot == 0 {
		return c.first, 0
	}
	w := work.Load()
	id, steps := c.more, 0
	for c.nodes[id].depth > slot {
		if w != nil {
			w.captureSteps.add("capture steps")
		}
		if jump := c.nodes[id].jump; c.nodes[jump].depth >= slot {
			id = jump
		} else {
			id = c.nodes[id].parent
		}
		steps++
	}
	return c.nodes[id].cv, steps
}

// all is every slot's capture, in slot order, read in one walk. Each step
// of the walk counts as it is taken.
func (c itemCaps) all() []capVal {
	w := work.Load()
	out := make([]capVal, c.nodes[c.more].depth+1)
	out[0] = c.first
	for id := c.more; id != 0; id = c.nodes[id].parent {
		if w != nil {
			w.captureSteps.add("capture steps")
		}
		out[c.nodes[id].depth] = c.nodes[id].cv
	}
	return out
}

// caps is the captures of an item.
func (r *recognizer) caps(key *itemKey) itemCaps {
	if len(r.capNodes) == 0 {
		r.capNodes = []capNode{{}}
	}
	return itemCaps{first: key.cap0, nodes: r.capNodes, more: key.more}
}

// setCap captures cv in a slot of an item's key. A production's slots are
// numbered in the order of their positions, so an item fills them in order,
// and each slot after the first extends the interned vector by one.
func (r *recognizer) setCap(key *itemKey, slot int32, cv capVal) {
	if slot == 0 {
		key.cap0 = cv
		return
	}
	if len(r.capNodes) == 0 {
		r.capNodes = []capNode{{}}
	}
	if slot-1 != r.capNodes[key.more].depth {
		panic("a capture slot filled out of order")
	}
	step := capStep{key.more, cv}
	id, ok := r.capIndex[step]
	if !ok {
		id = int32(len(r.capNodes))
		parent := r.capNodes[key.more]
		jump := key.more
		if above := r.capNodes[parent.jump]; parent.depth-above.depth == above.depth-r.capNodes[above.jump].depth {
			jump = above.jump
		}
		r.capNodes = append(r.capNodes, capNode{parent: key.more, jump: jump, cv: cv, depth: slot})
		if w := work.Load(); w != nil {
			w.capEntries.add("capture entries")
			if w.storePrefixes {
				for at := key.more; at != 0; at = r.capNodes[at].parent {
					r.capNodes = append(r.capNodes, r.capNodes[at])
					w.capEntries.add("capture entries")
				}
			}
		}
		if r.capIndex == nil {
			r.capIndex = map[capStep]int32{}
		}
		r.capIndex[step] = id
	}
	key.more = id
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
	// capNodes holds the interned sequences of the capture slots after an
	// item's first, the empty one at 0, each sharing the one it extends, so
	// a production of C captures keeps C entries, not C²; capIndex finds
	// each by the sequence it extends and the capture it adds.
	capNodes []capNode
	capIndex map[capStep]int32
	// linkSets holds, in the check of elision-only, the links of each item
	// that has many, so that a duplicate is found without a scan of them.
	linkSets map[*item]map[link]struct{}
	// lo and hi are the input that initial(), from() and after() see
	// while this recognition runs (§10).
	lo, hi int
	// at is the set whose queue the recognition takes entries from, and
	// entered says that it has begun that set. step is what it does next,
	// which keeps its place when the step halts for a nested parse.
	at      int
	entered bool
	step    step
	// query is the nested parse that this recognition answers, or nil.
	query *nestedQuery
	// w walks the conditions and terms of the step. A step that halts for
	// a nested parse keeps its walk, and its place in the walk's
	// evaluations: adv for an advance, and for a prediction or a
	// completion, pending, with the condition at condAt and its evaluator.
	w       walk
	adv     advancing
	pending bool
	condAt  int
	ev      *evaluator
}

// advancing is an advance that halted in its conditions: its key, the
// condition it halted in, and the tags of $ for the conditions that read
// them. active says that the advance goes on once the step does.
type advancing struct {
	active bool
	key    itemKey
	i      int
	whole  *lazyTags
}

// The kinds of a recognition's step. A step that halts for a nested parse
// keeps its place, and its walk keeps its frames, so the step goes on from
// where it halted once the answer is known (engine §4).
const (
	// stepNext takes the next entry of the queue.
	stepNext = iota
	// stepTerminal advances it over a token, into set k, over cv and l.
	stepTerminal
	// stepPredict predicts rule in set k, from the production next on,
	// and then, with empties, advances it over the empty constituents.
	stepPredict
	// stepEmpties advances it over the empty constituents in list, from
	// the one at next on.
	stepEmpties
	// stepComplete completes it, an item of set k.
	stepComplete
	// stepWaiters advances the first count items that wait at origin for
	// rule over the constituent c, with tags ts, from the one at next on.
	stepWaiters
)

// step is a recognition's next step: its kind and what that kind uses.
// Each kind sets the fields it reads, field by field, and leaves the rest.
// A copy of the whole struct into the heap would cost a write barrier for
// every pointer it holds, at every step.
type step struct {
	kind    int
	it      *item
	k       int
	rule    int32
	strict  bool
	empties bool
	next    int
	cv      capVal
	l       link
	list    []*symNode
	origin  int32
	c       *symNode
	ts      *tagset
	empty   bool
	count   int
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
	r := &recognizer{run: run, g: g, base: base, n: n, lo: base, hi: base + n}
	r.loop(start)
	return r
}

// loop recognizes the recognizer's input from the start rule, and the
// nested parses that it needs.
func (r *recognizer) loop(start int32) {
	r.begin(start)
	r.run.drive(r)
}

// begin readies a recognition to predict its start rule in set 0.
func (r *recognizer) begin(start int32) {
	if r.beginPredict(r.set(0), start, false) {
		r.step = step{kind: stepPredict, rule: start}
	}
}

// resume goes on with the recognition until it finishes, or halts for the
// nested parse that it returns. A step that halts keeps its place in
// r.step, and comes back here with the same arguments for what it halted
// in, which then goes on from where it halted.
func (r *recognizer) resume() *nestedQuery {
	for {
		st := &r.step
		switch st.kind {
		case stepNext:
			if !r.nextEntry() {
				return nil
			}
		case stepTerminal:
			if q := r.advance(st.it, st.k, st.cv, st.l, st.strict); q != nil {
				return q
			}
			r.step.kind = stepNext
		case stepPredict:
			if q := r.predictFrom(st); q != nil {
				return q
			}
			if st.empties {
				st.kind, st.list, st.next = stepEmpties, r.sets[st.k].empties[st.rule], 0
			} else {
				r.step.kind = stepNext
			}
		case stepEmpties:
			for ; st.next < len(st.list); st.next++ {
				c := st.list[st.next]
				if q := r.advance(st.it, st.k, capVal{c.start, c.end, c.tags.id}, link{prev: st.it, sym: c}, st.it.strict); q != nil {
					return q
				}
			}
			r.step.kind = stepNext
		case stepComplete:
			if q := r.complete(st.k, st.it); q != nil {
				return q
			}
		case stepWaiters:
			// The waiters are those there were at completion. An advance
			// adds none, so the list keeps them while the step halts.
			waiters := r.sets[st.origin].waiting[st.rule]
			for ; st.next < st.count; st.next++ {
				w := waiters[st.next]
				if st.empty && r.heldBack(w) {
					continue
				}
				if q := r.advance(w, st.k, capVal{st.c.start, st.c.end, st.ts.id}, link{prev: w, sym: st.c}, st.empty && w.strict); q != nil {
					return q
				}
			}
			r.step.kind = stepNext
		}
	}
}

// nextEntry takes the next entry of the queue, from the next set once one
// is done, and readies its step: false when the recognition is over.
func (r *recognizer) nextEntry() bool {
	for r.at <= r.n && r.at < len(r.sets) {
		k := r.at
		s := r.sets[k]
		if !r.entered {
			if len(s.items) > 0 {
				r.furthest = k
			}
			r.entered = true
		}
		if s.head == len(s.queue) {
			s.queue, s.head = nil, 0
			r.at, r.entered = k+1, false
			continue
		}
		it := s.queue[s.head]
		s.head++
		it.queued = false
		if r.process(k, it) {
			return true
		}
	}
	return false
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

// A prediction adds the items of a rule's productions at k, except those
// whose first symbol is a terminal the next token lacks, which could never
// advance; expected() accounts for them in a rejection.
//
// In the reconstruction mode (§7.4), the empty production of an elidable
// optional is its restoration, which reads the synthetic token at k, and
// it never derives the empty sequence. A strict prediction predicts only
// the productions that can read, and its items are strict. An ordinary
// prediction after a strict one adds what the strict one left out, and
// makes ordinary the items that they share. beginPredict and predictFrom
// make it in two parts, so that a production whose conditions halt for a
// nested parse goes on alone.
//
// beginPredict records the prediction of a rule in a set, and says whether
// it adds anything there.
func (r *recognizer) beginPredict(s *eset, rule int32, strict bool) bool {
	before := s.predicted[rule]
	if before == predOrdinary || (before == predStrict && strict) {
		return false
	}
	if s.predicted == nil {
		s.predicted = map[int32]uint8{}
	}
	s.predicted[rule] = predOrdinary
	if strict {
		s.predicted[rule] = predStrict
	}
	return true
}

// predictFrom predicts the productions of st.rule at st.k from st.next on.
// A production whose conditions halt for a nested parse keeps st.next, and
// goes on in its conditions when the step does.
func (r *recognizer) predictFrom(st *step) *nestedQuery {
	k, strict := st.k, st.strict
	var reading *readingSets
	if r.recon != nil {
		reading = r.recon.reading
	}
	prods := r.g.rules[st.rule].prods
	for ; st.next < len(prods); st.next++ {
		p := prods[st.next]
		if !r.pending {
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
		}
		ok, q := r.predictable(p, k)
		if q != nil {
			return q
		}
		if ok {
			r.add(k, itemKey{prod: p, origin: int32(k)}, link{}, false, strict)
		}
	}
	return nil
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
		w.items.add("items")
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
// Where they halt for a nested parse, it gives the query, and goes on from
// where they halted when it is called again.
func (r *recognizer) predictable(p *production, k int) (bool, *nestedQuery) {
	if !r.pending {
		if len(p.predictConds) == 0 {
			return true, nil
		}
		var caps itemCaps
		var tags *lazyTags
		if len(p.rhs) == 0 {
			// The tag term runs only where a condition reads $'s tags (§4).
			tags = r.lazyTags(p, caps, int32(k), int32(k))
		}
		r.ev = r.run.evaluator(r.g, r.captureFunc(p, caps, int32(k), int32(k), tags))
		r.pending, r.condAt = true, 0
		r.w.cond(r.ev, p.predictConds[0])
	}
	for {
		if q := r.w.resume(); q != nil {
			return false, q
		}
		r.condAt++
		if !r.w.b || r.condAt == len(p.predictConds) {
			r.pending, r.ev = false, nil
			return r.w.b, nil
		}
		r.w.cond(r.ev, p.predictConds[r.condAt])
	}
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
			w.items.add("items")
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
		// Processing an item again can make a link that it made before.
		if r.recon != nil && r.hasLink(it, l) {
			return
		}
		it.links = append(it.links, l)
	}
}

// linkScanLimit is how many links an item keeps before a set of them is
// made. A scan of a few is cheaper than a map, and most items have one.
const linkScanLimit = 8

// hasLink says whether an item already has a link, and otherwise records
// it in the item's set where it has one. Past linkScanLimit links, the set
// keeps a duplicate check from costing the links an item already has.
func (r *recognizer) hasLink(it *item, l link) bool {
	if set := r.linkSets[it]; set != nil {
		if w := work.Load(); w != nil {
			w.linkSteps.add("link steps")
		}
		if _, ok := set[l]; ok {
			return true
		}
		set[l] = struct{}{}
		return false
	}
	for _, x := range it.links {
		if w := work.Load(); w != nil {
			w.linkSteps.add("link steps")
		}
		if x == l {
			return true
		}
	}
	if len(it.links) >= linkScanLimit {
		set := make(map[link]struct{}, 2*len(it.links))
		for _, x := range it.links {
			set[x] = struct{}{}
		}
		set[l] = struct{}{}
		if r.linkSets == nil {
			r.linkSets = map[*item]map[link]struct{}{}
		}
		r.linkSets[it] = set
	}
	return false
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

// process takes an item from the queue of set k, and readies the step that
// it makes: false when it makes none.
func (r *recognizer) process(k int, it *item) bool {
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
					st := &r.step
					st.kind, st.it, st.k, st.strict = stepTerminal, it, k+1, strict
					st.cv, st.l = capVal{int32(k), int32(k + 1), tags}, link{prev: it, tok: int32(k), term: sym.id}
					return true
				}
			}
			return false
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
		if r.beginPredict(s, sym.id, held) {
			st := &r.step
			st.kind, st.it, st.k, st.rule, st.strict, st.empties, st.next = stepPredict, it, k, sym.id, held, !held, 0
			return true
		}
		if held {
			return false
		}
		st := &r.step
		st.kind, st.it, st.k, st.list, st.next = stepEmpties, it, k, s.empties[sym.id], 0
		return true
	}
	r.step.kind, r.step.it, r.step.k = stepComplete, it, k
	return true
}

// complete completes item it of set k. Its constituent's tags may halt for
// a nested parse, before the step records anything. Called again, it goes
// on with them from where they halted.
func (r *recognizer) complete(k int, it *item) *nestedQuery {
	p := it.prod
	s := r.sets[k]
	in := r.run.ps.in
	var ts *tagset
	switch {
	case it.restores:
		// A restoration has the tags of the empty production, none (§7.4).
		ts = in.empty()
	case p.tags != nil:
		if !r.pending {
			r.pending = true
			r.w.term(r.run.evaluator(r.g, r.captureFunc(p, r.caps(&it.itemKey), it.origin, int32(k), nil)), p.tags)
		}
		if q := r.w.resume(); q != nil {
			return q
		}
		r.pending = false
		ts = toSet(r.w.v)
	case p.implicit:
		ts = in.all[r.caps(&it.itemKey).at(p.capSlot[0]).tags]
	default:
		ts = in.empty()
	}
	key := symKey{p.lhs, it.origin, ts.id}
	c := s.syms[key]
	if c != nil {
		c.items = append(c.items, it)
		r.step.kind = stepNext
		return nil
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
	count := len(r.sets[it.origin].waiting[p.lhs])
	st := &r.step
	st.kind, st.k, st.origin, st.rule, st.c, st.ts = stepWaiters, k, it.origin, p.lhs, c, ts
	st.empty, st.count, st.next = int(it.origin) == k, count, 0
	return nil
}

// advance moves an item over its next symbol, read over cv, into set k,
// unless the symbol's test does not hold of it or a condition triggered
// there fails. Where a condition halts for a nested parse, it gives the
// query and keeps its place in r.adv. Called again with the same
// arguments, it goes on from that condition, in the walk that halted.
func (r *recognizer) advance(it *item, k int, cv capVal, l link, strict bool) *nestedQuery {
	p := it.prod
	var key itemKey
	var whole *lazyTags
	i, resuming := 0, r.adv.active
	if resuming {
		key, i, whole = r.adv.key, r.adv.i, r.adv.whole
		r.adv = advancing{}
	} else {
		key = it.itemKey
		pos := int(key.dot)
		// A strict step that completes, route 3's read of T with nothing
		// after it, makes a strict item at the end of its production. The
		// step drops it before it evaluates anything (§4, §7.4; JS
		// earley.js, the written routes).
		if strict && pos+1 == len(p.rhs) {
			return nil
		}
		// A tested symbol's test must hold of its own span and tags, which
		// is checked before any condition the advance makes ready (§4).
		if t := p.testAt(pos); t != nil && !r.symbolTest(t, cv, l.sym == nil) {
			return nil
		}
		if slot := p.capSlot[pos]; slot >= 0 {
			r.setCap(&key, slot, cv)
		}
		key.dot++
	}
	// Each condition the walk examines counts before it is looked at, so
	// a walk wider than the dot's own conditions passes the budget at once.
	lo, hi := p.condRange(int(key.dot))
	w := work.Load()
	if w != nil && w.scanConds {
		lo, hi = 0, len(p.conds)
	}
	if !resuming {
		i = lo
	}
	for ; i < hi; i++ {
		if !resuming {
			if w != nil {
				w.conditions.add("conditions")
			}
			c := p.conds[i]
			if c.trigger != int(key.dot) {
				continue
			}
			// A condition on $ is evaluated once the item is complete. Its
			// production's tag term gives $ its tags, and runs only where a
			// condition reads them (§4).
			caps := r.caps(&key)
			if c.whole && whole == nil {
				whole = r.lazyTags(p, caps, key.origin, int32(k))
			}
			r.w.cond(r.run.evaluator(r.g, r.captureFunc(p, caps, key.origin, int32(k), whole)), c.cond)
		}
		resuming = false
		if q := r.w.resume(); q != nil {
			r.adv = advancing{active: true, key: key, i: i, whole: whole}
			return q
		}
		if !r.w.b {
			return nil
		}
	}
	if l.prev != nil && l.prev.dot == 0 {
		l.prev = nil // a predicted item has no derivation of its own
	}
	r.add(k, key, l, true, strict)
	return nil
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
func (r *recognizer) captureFunc(p *production, caps itemCaps, origin, end int32, whole *lazyTags) func(string) (spanVal, bool) {
	// In the check of elision-only, every observation reads the projected
	// span, and the projection comes before any function of it (§7.5).
	// A capture is found when it is read: the last at once, an earlier one
	// by the jumps. Once the searches took half as many steps as there are
	// slots, every slot comes from one walk, so a term that reads them all
	// walks them about twice at most.
	var parts []capVal
	searched := 0
	return func(name string) (spanVal, bool) {
		if name == "" {
			a, b := r.observed(origin, end)
			return spanVal{a: a, b: b, whole: whole != nil, lazy: whole}, true
		}
		slot, ok := p.slotOf[name]
		if !ok {
			return spanVal{}, false
		}
		if parts == nil && searched*2 >= int(caps.nodes[caps.more].depth)+1 {
			parts = caps.all()
		}
		var cv capVal
		if parts != nil {
			cv = parts[slot]
		} else {
			var steps int
			cv, steps = caps.find(slot)
			searched += steps + 1
		}
		a, b := r.observed(cv.start, cv.end)
		return spanVal{a: a, b: b, whole: true, tags: r.run.ps.in.all[cv.tags]}, true
	}
}

// lazyTags is the constituent tags of a completing item, which the walk
// that first reads them computes, and the same set after that (§4).
func (r *recognizer) lazyTags(p *production, caps itemCaps, origin, end int32) *lazyTags {
	return &lazyTags{r: r, p: p, caps: caps, origin: origin, end: end}
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
