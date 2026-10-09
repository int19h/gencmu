package gencmu

import (
	"sort"
	"strconv"
	"strings"
)

// The ranking (engine §6), composed over the packed forest the recognizer
// leaves, without enumerating derivations.
//
// Under greedy, lazy and no lean, the ranking compares the action sequences
// of derivations, as below. Under late-elision, it first keeps, for each
// item in each context, the least elision vector of its derivations and the
// links that attain it (see elSeq). Then it ranks with no lean over that
// smaller forest of the best derivations, which gives the two readings.
//
// A derivation is kept as a persistent structure (dn) whose bottom-up action
// sequence is read lazily, so that two derivations sharing a subtree compare
// without walking it. For each item the ranking keeps a short list of
// candidates: the derivations no other derivation of the item beats, which
// are exactly those whose visible sequences are prefixes of one another,
// since the order of those depends on what follows. With each candidate it
// keeps the derivations tied with it that diverge from it earliest (engine
// §6, on computing m and t): all at one divergence, again only those that are
// visible prefixes of one another.

const (
	dRead = iota
	dClose
	dPart
)

// dn is a derivation of a constituent (a read or a close) or a partial one
// (a part: the derivation of an item's children so far).
type dn struct {
	structure  int
	kind       uint8
	tok        int32 // read: the token, relative to the recognizer's base
	term       int32
	prod       *production // close
	start, end int32       // close
	tags       *tagset     // close
	a          *dn         // part: the children before; close: its children
	b          *dn         // part: the last child
	// vis and whole are the numbers of its visible actions and of all its
	// actions, and sizes holds both instead where either does not fit in an
	// int64: a derivation over an empty span can have exponentially many.
	vis, whole int64
	sizes      *dnSizes
}

type dnSizes struct{ vis, whole count }

func (n *dn) visCount() count {
	if n.sizes != nil {
		return n.sizes.vis
	}
	return countOf(n.vis)
}

func (n *dn) wholeCount() count {
	if n.sizes != nil {
		return n.sizes.whole
	}
	return countOf(n.whole)
}

func (n *dn) setSizes(vis, whole count) {
	if vis.big == nil && whole.big == nil {
		n.vis, n.whole = vis.n, whole.n
	} else {
		n.sizes = &dnSizes{vis: vis, whole: whole}
	}
}

func readNode(tok, term int32) *dn {
	return &dn{kind: dRead, tok: tok, term: term, vis: 1, whole: 1}
}

func partNode(prev, child *dn) *dn {
	n := &dn{kind: dPart, a: prev, b: child}
	vis, whole := child.visCount(), child.wholeCount()
	if prev != nil {
		vis, whole = vis.add(prev.visCount()), whole.add(prev.wholeCount())
	}
	n.setSizes(vis, whole)
	return n
}

func closeNode(p *production, start, end int32, tags *tagset, kids *dn, structure ...int) *dn {
	n := &dn{kind: dClose, prod: p, start: start, end: end, tags: tags, a: kids}
	if len(structure) > 0 {
		n.structure = structure[0]
	}
	vis, whole := count{}, countOne
	if !p.transparent {
		vis = countOne
	}
	if kids != nil {
		vis, whole = vis.add(kids.visCount()), whole.add(kids.wholeCount())
	}
	n.setSizes(vis, whole)
	return n
}

func visOf(n *dn) count {
	if n == nil {
		return count{}
	}
	return n.visCount()
}

// action is one read or close.
type action struct {
	read       bool
	tok        int32
	term       int32
	prod       *production
	start, end int32
}

func (a action) visible() bool { return a.read || !a.prod.transparent }

type iterEl struct {
	n    *dn
	leaf bool // the close action of n itself
}

type actionIter struct{ st []iterEl }

func (it *actionIter) push(n *dn) {
	if n != nil {
		it.st = append(it.st, iterEl{n: n})
	}
}

func (it *actionIter) top() (iterEl, bool) {
	if len(it.st) == 0 {
		return iterEl{}, false
	}
	return it.st[len(it.st)-1], true
}

func (it *actionIter) pop() { it.st = it.st[:len(it.st)-1] }

func isLeaf(e iterEl) bool { return e.leaf || e.n.kind == dRead }

func (it *actionIter) expand() {
	e := it.st[len(it.st)-1]
	it.pop()
	switch e.n.kind {
	case dPart:
		it.push(e.n.b)
		it.push(e.n.a)
	case dClose:
		it.st = append(it.st, iterEl{n: e.n, leaf: true})
		it.push(e.n.a)
	}
}

func elAction(e iterEl) action {
	if e.n.kind == dRead {
		return action{read: true, tok: e.n.tok, term: e.n.term}
	}
	return action{prod: e.n.prod, start: e.n.start, end: e.n.end}
}

func elWhole(e iterEl) count {
	if isLeaf(e) {
		return countOne
	}
	return e.n.wholeCount()
}

func elVis(e iterEl) count {
	if e.leaf {
		if e.n.prod.transparent {
			return count{}
		}
		return countOne
	}
	return e.n.visCount()
}

const (
	cIdentical = iota
	cVisDiff   // the visible sequences differ at pos
	cVisEqual  // they differ only in transparent actions
	cAPrefix   // a's visible sequence is a proper prefix of b's
	cBPrefix
)

const (
	oTie = iota
	oA
	oB
)

type cmpRes struct {
	kind     int
	pos      count // visible actions before the difference
	va, vb   action
	outcome  int
	wa, wb   action // the first difference of the whole sequences
	hasWhole bool   // both sequences have an action at the first whole difference
	aEnded   bool   // without one, whether a's whole sequence is the one that ended
}

// decided says whether the comparison holds whatever follows both.
func (r cmpRes) decided() bool {
	return r.kind == cVisDiff || r.kind == cIdentical || (r.kind == cVisEqual && r.hasWhole)
}

func (r cmpRes) flip() cmpRes {
	r.va, r.vb = r.vb, r.va
	r.wa, r.wb = r.wb, r.wa
	if !r.hasWhole {
		r.aEnded = !r.aEnded
	}
	switch r.outcome {
	case oA:
		r.outcome = oB
	case oB:
		r.outcome = oA
	}
	switch r.kind {
	case cAPrefix:
		r.kind = cBPrefix
	case cBPrefix:
		r.kind = cAPrefix
	}
	return r
}

type ranker struct {
	preferences       *preferences
	admission         *slotAdmission
	rawWitnessCounted *bool
	rec               *recognizer
	// lean is greedy, lazy, or "" for no lean, where any two differing
	// derivations tie. Under late-elision it is "", and elisions is set.
	lean     string
	elisions bool
	profiles bool
	maximal  *maximal // the maximal terminators, if there are any (engine §4)
	items    map[*item]*itemRank
	syms     map[*symNode]*itemRank
	marked   map[*item]bool
	// leaves holds the one vector of a single elision at each position.
	leaves map[int32]*elSeq
	// marks, where a test watches the check, are the witness hook's marks
	// of W(D): for each item of W(D), the links that W(D) uses
	// (tests/README.md). With them, each count also says whether it includes
	// a derivation of marked links only. A parse that no test watches has
	// none.
	marks map[*item]map[link]bool
	// check says that this ranks the check of elision-only, which only its
	// faults read.
	check bool
	views *slotViews
}

// skips says whether a fault of the check skips this alternative: the last
// of two or more links of an item, or completed items of a constituent
// (tests/README.md).
func (rk *ranker) skips(fault, site string, i, n int) bool {
	return rk.check && n > 1 && i == n-1 && rk.rec.run.ps.faultAt(fault, site)
}

// newRanker ranks under the rule of a directive, greedy, lazy or
// late-elision, or under no lean for "".
func newRanker(rec *recognizer, rule string, mx *maximal) *ranker {
	rk := &ranker{rec: rec, lean: rule, maximal: mx, items: map[*item]*itemRank{}, syms: map[*symNode]*itemRank{}, marked: map[*item]bool{}}
	if rec.g.stage != nil {
		rk.preferences = rec.g.stage.preferences
	}
	if rule == "late-elision" {
		// The readings come from a ranking with no lean over the forest of
		// the best derivations (engine §6).
		rk.lean, rk.elisions = "", true
		rk.leaves = map[int32]*elSeq{}
	}
	for _, r := range rec.g.rules {
		rk.profiles = rk.profiles || r.leftmostLongest
	}
	if len(rec.g.rankedHelpers) > 0 || rk.preferences != nil && len(rk.preferences.paths) > 0 {
		rk.views = newSlotViews(rk)
		rk.admission = newSlotAdmission(rk)
	}
	return rk
}

func (rk *ranker) itemMemo(it *item) *itemRank {
	m := rk.items[it]
	if m == nil {
		m = &itemRank{}
		rk.items[it] = m
	}
	return m
}

func (rk *ranker) symMemo(s *symNode) *itemRank {
	m := rk.syms[s]
	if m == nil {
		m = &itemRank{}
		rk.syms[s] = m
	}
	return m
}

// canonLess orders the actions at a first difference (engine §6): a read
// before a close, reads by terminal, closes by production, start, end.
func (rk *ranker) canonLess(x, y action) bool {
	if x.read != y.read {
		return x.read
	}
	if x.read {
		tx, ty := rk.rec.g.terminals[x.term], rk.rec.g.terminals[y.term]
		if tx != ty {
			return tx < ty
		}
		return x.tok < y.tok
	}
	if x.prod.num != y.prod.num {
		return x.prod.num < y.prod.num
	}
	if x.start != y.start {
		return x.start < y.start
	}
	return x.end < y.end
}

// decide applies rules 1 to 3 of engine §6 to two differing visible actions.
func (rk *ranker) decide(x, y action) int {
	// Two reads of one token as different terminals are tied, and so are
	// two closes.
	if x.read != y.read {
		switch rk.lean {
		case "greedy":
			if x.read {
				return oA
			}
			return oB
		case "lazy":
			if x.read {
				return oB
			}
			return oA
		}
	}
	return oTie
}

// aFirst says whether a precedes b in the total order T, where that is
// decided (not for a visible prefix, unless final).
func (rk *ranker) aFirst(r cmpRes) bool {
	switch r.kind {
	case cVisDiff:
		switch r.outcome {
		case oA:
			return true
		case oB:
			return false
		}
		return rk.canonLess(r.va, r.vb)
	case cIdentical:
		return true
	case cAPrefix:
		return true // a visible prefix precedes its extensions
	case cBPrefix:
		return false
	}
	if !r.hasWhole {
		return r.aEnded // a whole prefix precedes its extensions
	}
	return rk.canonLess(r.wa, r.wb)
}

func (rk *ranker) compare(a, b *dn) cmpRes {
	var ia, ib actionIter
	ia.push(a)
	ib.push(b)
	var r cmpRes
	vis := count{}
	// The whole sequences, in step, skipping shared subtrees.
	for {
		ea, oka := ia.top()
		eb, okb := ib.top()
		if !oka && !okb {
			return cmpRes{kind: cIdentical}
		}
		if !oka || !okb {
			r.aEnded = !oka
			break
		}
		if ea == eb {
			vis = vis.add(elVis(ea))
			ia.pop()
			ib.pop()
			continue
		}
		if !isLeaf(ea) || !isLeaf(eb) {
			// Expand the larger side first, so that the two meet at a
			// subtree they share.
			c := elWhole(ea).cmp(elWhole(eb))
			if !isLeaf(ea) && c >= 0 {
				ia.expand()
			}
			if !isLeaf(eb) && c <= 0 {
				ib.expand()
			}
			continue
		}
		xa, xb := elAction(ea), elAction(eb)
		if xa == xb {
			if xa.visible() {
				vis = vis.add(countOne)
			}
			ia.pop()
			ib.pop()
			continue
		}
		r.wa, r.wb, r.hasWhole = xa, xb, true
		break
	}
	// The visible sequences, from there.
	norm := func(it *actionIter) (iterEl, bool) {
		for {
			e, ok := it.top()
			if !ok {
				return e, false
			}
			if isLeaf(e) {
				if e.leaf && e.n.prod.transparent {
					it.pop()
					continue
				}
				return e, true
			}
			if e.n.visCount().isZero() {
				it.pop()
				continue
			}
			return e, true
		}
	}
	for {
		ea, oka := norm(&ia)
		eb, okb := norm(&ib)
		switch {
		case !oka && !okb:
			r.kind = cVisEqual
			r.pos = vis
			return r
		case !oka:
			r.kind, r.pos = cAPrefix, vis
			return r
		case !okb:
			r.kind, r.pos = cBPrefix, vis
			return r
		}
		if ea == eb {
			vis = vis.add(elVis(ea))
			ia.pop()
			ib.pop()
			continue
		}
		if !isLeaf(ea) || !isLeaf(eb) {
			c := elVis(ea).cmp(elVis(eb))
			if !isLeaf(ea) && c >= 0 {
				ia.expand()
			}
			if !isLeaf(eb) && c <= 0 {
				ib.expand()
			}
			continue
		}
		xa, xb := elAction(ea), elAction(eb)
		if xa == xb {
			vis = vis.add(countOne)
			ia.pop()
			ib.pop()
			continue
		}
		r.kind, r.pos, r.va, r.vb = cVisDiff, vis, xa, xb
		r.outcome = rk.decide(xa, xb)
		return r
	}
}

// tiedSet holds the derivations tied with a candidate that diverge from it
// earliest, all at div, reduced to those no other beats.
type tiedSet struct {
	ds  []*dn
	div count
}

type cand struct {
	d    *dn
	tied tiedSet
}

type entry struct {
	profile ruleProfile
	cands   []*cand
	count   int // derivations, up to 2: the total of engine §6
	// Under late-elision, vec is the least elision vector of the
	// derivations, and least the number of them that attain it, up to 2.
	// cands then holds only derivations that attain vec.
	vec   *elSeq
	least int
	// w, with the witness hook's marks, says whether count includes a
	// derivation of marked links only (tests/README.md). The same loop
	// decides both, so any choice that drops W(D) from the count drops it
	// here.
	w bool
	// allowed is the same over only the derivations an elided terminator
	// may follow, where maximal forbids some of the item's (see itemVal);
	// nil where it may follow them all.
	allowed *entry
}

func (rk *ranker) addTo(s *tiedSet, d *dn, div count) {
	c := div.cmp(s.div)
	if len(s.ds) > 0 && c > 0 {
		return
	}
	if len(s.ds) == 0 || c < 0 {
		s.ds, s.div = []*dn{d}, div
		return
	}
	s.ds = rk.insertChain(s.ds, d)
}

// addTied offers a derivation tied with c that diverges from it at div.
func (rk *ranker) addTied(c *cand, d *dn, div count) {
	rk.addTo(&c.tied, d, div)
}

// inherit offers what of a tied set, with each derivation changed by f, is
// tied with c at the same divergence.
func (rk *ranker) inherit(c *cand, z *cand, shift count, f func(*dn) *dn, below count) {
	s := z.tied
	if len(s.ds) == 0 || s.div.cmp(below) >= 0 {
		return
	}
	// A shift leaves inf as it is.
	div := s.div.add(shift)
	for _, t := range s.ds {
		rk.addTied(c, f(t), div)
	}
}

func same(d *dn) *dn { return d }

// insertChain adds d to a list of derivations no other beats, whose members
// are visible prefixes of one another.
func (rk *ranker) insertChain(chain []*dn, d *dn) []*dn {
	for i := 0; i < len(chain); i++ {
		r := rk.compare(chain[i], d)
		if r.kind == cIdentical {
			return chain
		}
		if r.decided() {
			if rk.aFirst(r) {
				return chain
			}
			chain = append(chain[:i:i], chain[i+1:]...)
			i--
		}
	}
	return append(chain, d)
}

// contribute passes to w, which precedes z in T, what of z's family is tied
// with w: z itself when their first difference is a tie, and z's tied
// derivations that diverged from z before w and z differ.
func (rk *ranker) contribute(w, z *cand, r cmpRes) {
	switch r.kind {
	case cVisDiff, cAPrefix, cBPrefix:
		tie := r.kind != cVisDiff || r.outcome == oTie
		if tie {
			rk.addTied(w, z.d, r.pos)
		}
		rk.inherit(w, z, count{}, same, r.pos)
	case cVisEqual, cIdentical:
		if r.kind == cVisEqual {
			rk.addTied(w, z.d, inf)
		}
		rk.inherit(w, z, count{}, same, pastInf)
	}
}

// merge reduces candidates of one item to those no other beats.
func (rk *ranker) merge(cands []*cand) []*cand {
	if len(cands) <= 1 {
		return cands
	}
	var chain []*cand
	for _, z := range cands {
		dominated := false
		for i := 0; i < len(chain); i++ {
			w := chain[i]
			r := rk.compare(w.d, z.d)
			switch {
			case r.kind == cIdentical:
				rk.contribute(w, z, r)
				dominated = true
			case r.decided():
				if rk.aFirst(r) {
					rk.contribute(w, z, r)
					dominated = true
				} else {
					rk.contribute(z, w, r.flip())
					chain = append(chain[:i:i], chain[i+1:]...)
					i--
				}
			}
			if dominated {
				break
			}
		}
		if !dominated {
			chain = append(chain, z)
		}
	}
	return chain
}

// finish orders the last candidates, whose visible sequences are prefixes of
// one another, as T does, and returns the least with its tied derivations.
func (rk *ranker) finish(cands []*cand) *cand {
	best := 0
	for i := 1; i < len(cands); i++ {
		if !rk.aFirst(rk.compare(cands[best].d, cands[i].d)) {
			best = i
		}
	}
	m := cands[best]
	for i, z := range cands {
		if i != best {
			rk.contribute(m, z, rk.compare(m.d, z.d))
		}
	}
	if len(m.tied.ds) > 1 {
		t := 0
		for i := 1; i < len(m.tied.ds); i++ {
			if !rk.aFirst(rk.compare(m.tied.ds[t], m.tied.ds[i])) {
				t = i
			}
		}
		m.tied.ds = []*dn{m.tied.ds[t]}
	}
	return m
}

// fork copies a candidate for a second list, merged apart from the first:
// merging changes a candidate's tied sets, never its derivations.
func (c *cand) fork() *cand {
	return &cand{d: c.d, tied: c.tied.fork()}
}

func (s tiedSet) fork() tiedSet {
	return tiedSet{ds: append([]*dn(nil), s.ds...), div: s.div}
}

func (rk *ranker) extend(xs, cs []*cand, into []*cand) []*cand {
	for _, x := range xs {
		for _, c := range cs {
			n := &cand{d: partNode(x.d, c.d)}
			rk.inherit(n, x, count{}, func(t *dn) *dn { return partNode(t, c.d) }, pastInf)
			rk.inherit(n, c, visOf(x.d), func(t *dn) *dn { return partNode(x.d, t) }, pastInf)
			into = append(into, n)
		}
	}
	return into
}

// ---- over the forest

type itemRank struct {
	base memoSlot
	byF  map[string]*memoSlot
	mark bool
}

// memoSlot is one ranking of an item or constituent under one set of
// forbidden ancestors: being computed, or computed.
type memoSlot struct {
	state uint8 // 0 not yet, 1 being computed, 2 done
	e     *entry
}

// forbidden is the set of rules of the constituents above, over the same
// span (engine §4, derivations), restricted to one cycle class.
type forbidden []int32

func (f forbidden) key() string {
	var b strings.Builder
	for _, r := range f {
		b.WriteString(strconv.Itoa(int(r)))
		b.WriteByte(',')
	}
	return b.String()
}

func (f forbidden) has(r int32) bool {
	for _, x := range f {
		if x == r {
			return true
		}
	}
	return false
}

func (rk *ranker) restrict(f forbidden, rule int32) forbidden {
	scc := rk.rec.g.rules[rule].scc
	if scc < 0 || len(f) == 0 {
		return nil
	}
	var out forbidden
	for _, r := range f {
		if rk.rec.g.rules[r].scc == scc {
			out = append(out, r)
		}
	}
	return out
}

func (f forbidden) with(r int32) forbidden {
	if f.has(r) {
		return f
	}
	out := append(append(forbidden{}, f...), r)
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}

var unitEntry = &entry{cands: []*cand{{}}, count: 1, least: 1}

// markedUnitEntry is unitEntry for a predicted item that the witness hook
// marked.
var markedUnitEntry = &entry{cands: []*cand{{}}, count: 1, least: 1, w: true}

func memoSlotFor(m *itemRank, f forbidden) *memoSlot {
	if len(f) == 0 {
		return &m.base
	}
	if m.byF == nil {
		m.byF = map[string]*memoSlot{}
	}
	k := f.key()
	slot := m.byF[k]
	if slot == nil {
		slot = &memoSlot{}
		m.byF[k] = slot
	}
	return slot
}

// itemVal and symVal call each other down a chain of items and
// constituents. Within one set and origin, the chain is as long as the
// grammar's unit and empty rules make it, so it runs as frames on an
// explicit stack and not as recursion. Each frame does the same reads in
// the same order as the recursion would.

// rankFrame is an item or a constituent being ranked. resume takes the
// value it asked for and either asks for another frame's value or gives
// its own.
type rankFrame interface {
	resume(rk *ranker, in *entry) (call rankFrame, out *entry)
}

// runRank runs a frame to its value.
func (rk *ranker) runRank(first rankFrame) *entry {
	stack := []rankFrame{first}
	var in *entry
	for {
		call, out := stack[len(stack)-1].resume(rk, in)
		if call != nil {
			stack = append(stack, call)
			in = nil
			continue
		}
		stack = stack[:len(stack)-1]
		if len(stack) == 0 {
			return out
		}
		in = out
	}
}

// itemVal ranks the derivations of an item's children; f applies to its
// children over the item's whole span.
func (rk *ranker) itemVal(it *item, f forbidden) *entry {
	if call, e := rk.startItem(it, f); call != nil {
		return rk.runRank(call)
	} else {
		return e
	}
}

// symVal ranks the derivations of a constituent under ancestors f.
func (rk *ranker) symVal(s *symNode, f forbidden) *entry {
	if call, e := rk.startSym(s, f); call != nil {
		return rk.runRank(call)
	} else {
		return e
	}
}

// startItem gives an item's value where it is known without its links,
// and otherwise a frame that ranks them.
//
// Under maximal (engine §4, §6), an item whose next symbol is an elidable
// optional ranks twice: over all its derivations, and over only those of
// the links whose last symbol's node maximal does not forbid, which an
// elided terminator may follow. A link over an elided terminator combines
// the second of the item before it.
//
// A restoration (engine §7.4) has one link, a read of its synthetic token,
// and its close follows (§7.7).
func (rk *ranker) startItem(it *item, f forbidden) (rankFrame, *entry) {
	if rk.views != nil && rk.views.itemScopes[it] != nil && rk.views.itemScopes[it].blocked {
		return nil, nil
	}
	if it.dot == 0 && !it.restores {
		// A predicted item of W(D), such as an empty production's, is
		// W(D)'s (tests/README.md).
		if rk.slotMarks(it) != nil {
			return nil, markedUnitEntry
		}
		return nil, unitEntry
	}
	if it.restores && rk.rec.run.ps.fault("rank-restoration") {
		return nil, nil
	}
	var scope *slotScope
	if rk.views != nil {
		scope = rk.views.itemScopes[it]
	}
	f = rk.slotContext(f, it.prod.lhs, scope)
	slot := memoSlotFor(rk.itemMemo(it), f)
	switch slot.state {
	case 1:
		return nil, nil
	case 2:
		return nil, slot.e
	}
	slot.state = 1
	if w := work.Load(); w != nil {
		w.summaryContexts.add("summary contexts")
	}
	mx := rk.maximal
	return &itemFrame{it: it, f: f, slot: slot, guarded: mx != nil && mx.guards(it), marked: rk.slotMarks(it)}, nil
}

// linkVal is the summary of one link: its derivations, and under
// late-elision their least vector and how many attain it.
type linkVal struct {
	profile     ruleProfile
	prev, child *entry
	permitted   bool
	admitted    bool
	vec         *elSeq
	least       int
}

// itemFrame ranks an item's links in turn, each first its predecessor and
// then its child.
type itemFrame struct {
	it      *item
	f       forbidden
	slot    *memoSlot
	guarded bool
	marked  map[link]bool
	// The link being ranked, what of it is ranked so far, and the values
	// and summaries of the links before it.
	i              int
	phase          int
	prev, child    *entry
	vals           []linkVal
	all, allowed   summary
	allW, allowedW bool
	forbade        bool
}

// The phases of a link: ask for its predecessor, take it, ask for its
// child, take it, and summarize the link.
const (
	linkAskPrev = iota
	linkTakePrev
	linkAskChild
	linkTakeChild
	linkSummarize
)

func (fr *itemFrame) resume(rk *ranker, in *entry) (rankFrame, *entry) {
	it, mx := fr.it, rk.maximal
	for fr.i < len(it.links) {
		l := it.links[fr.i]
		switch fr.phase {
		case linkAskPrev:
			if l.prev == nil {
				fr.prev, fr.phase = unitEntry, linkAskChild
				continue
			}
			var pf forbidden
			if l.prev.set == it.set {
				pf = fr.f
			}
			call, e := rk.startItem(l.prev, pf)
			fr.phase = linkTakePrev
			if call != nil {
				return call, nil
			}
			in = e
			fallthrough
		case linkTakePrev:
			prev := in
			if prev != nil && prev.allowed != nil && l.sym != nil && mx.elided(l.sym.rule, l.sym.start, l.sym.end) {
				prev = prev.allowed
			}
			fr.prev, fr.phase = prev, linkAskChild
			fallthrough
		case linkAskChild:
			if fr.prev == nil || fr.prev.count == 0 {
				fr.i, fr.phase = fr.i+1, linkAskPrev
				continue
			}
			if l.sym == nil {
				fr.child, fr.phase = &entry{cands: []*cand{{d: readNode(l.tok, l.term)}}, count: 1, least: 1}, linkSummarize
				continue
			}
			var cf forbidden
			if l.sym.start == it.origin && l.sym.end == it.set {
				cf = fr.f
			}
			call, e := rk.startSym(l.sym, cf)
			fr.phase = linkTakeChild
			if call != nil {
				return call, nil
			}
			in = e
			fallthrough
		case linkTakeChild:
			fr.child, fr.phase = in, linkSummarize
			fallthrough
		case linkSummarize:
			fr.summarize(rk, l)
			fr.i, fr.phase = fr.i+1, linkAskPrev
		}
	}
	return nil, fr.finish(rk)
}

// summarize adds a link whose predecessor and child are ranked.
func (fr *itemFrame) summarize(rk *ranker, l link) {
	it, mx := fr.it, rk.maximal
	prev, child, i := fr.prev, fr.child, fr.i
	if child == nil || child.count == 0 {
		return
	}
	v := linkVal{prev: prev, child: child, permitted: true, admitted: true}
	if rk.admission != nil {
		if mask, ok := rk.admission.mask(it, fr.f); ok {
			v.admitted = mask.all[i]
			v.permitted = mask.allowed[i]
			fr.forbade = fr.forbade || v.admitted != v.permitted
		}
	}
	if fr.guarded && l.sym != nil && mx.forbidsIn(l.sym.rule, l.sym.start, l.sym.end, it.prod.testAt(int(it.dot)-1), l.sym.lexical) {
		v.permitted, fr.forbade = false, true
	}
	count := prev.count * child.count
	if rk.elisions || rk.profiles {
		// An edge's vector is the sum of its children's, and its least
		// count their product (engine §6).
		v.vec, v.least = concatElisions(prev.vec, child.vec), min(prev.least*child.least, 2)
		v.profile = sumProfiles(prev.profile, child.profile)
	}
	// The link is W(D)'s where it is marked, and its predecessor and
	// child are W(D)'s. A predicted predecessor and a read are.
	w := fr.marked[l] && (l.prev == nil || prev.w) && (l.sym == nil || child.w)
	// Faults of the check skip the last of two or more links, in the
	// count or in the candidates (tests/README.md).
	if !rk.skips("lost:context", "links", i, len(it.links)) {
		if v.admitted {
			fr.all.add(v.profile, v.vec, v.least, count)
			fr.allW = fr.allW || w
		}
		if v.permitted {
			fr.allowed.add(v.profile, v.vec, v.least, count)
			fr.allowedW = fr.allowedW || w
		}
	}
	if !rk.skips("lost:select", "links", i, len(it.links)) {
		fr.vals = append(fr.vals, v)
	}
}

// finish gives the item's value from its links' and remembers it.
func (fr *itemFrame) finish(rk *ranker) *entry {
	// The candidates. Under late-elision, only the links that attain the
	// least vector of the summary give them.
	var cands, permitted []*cand
	for _, v := range fr.vals {
		inAll := v.admitted && (!(rk.elisions || rk.profiles) || compareScore(v.profile, v.vec, fr.all.profile, fr.all.vec) == 0)
		inAllowed := v.permitted && (!(rk.elisions || rk.profiles) || compareScore(v.profile, v.vec, fr.allowed.profile, fr.allowed.vec) == 0)
		if !inAll && !(fr.forbade && inAllowed) {
			continue
		}
		produced := rk.extend(v.prev.cands, v.child.cands, nil)
		if inAll {
			cands = append(cands, produced...)
		}
		if fr.forbade && inAllowed {
			permitted = append(permitted, produced...)
		}
	}
	var e *entry
	if fr.all.total > 0 || fr.allowed.total > 0 {
		e = &entry{count: fr.all.total, profile: fr.all.profile, vec: fr.all.vec, least: fr.all.least, w: fr.allW}
		// Where maximal forbids none of the links, an elided terminator may
		// follow every derivation. Otherwise it may follow the candidates of
		// the links maximal permits, copied before merging changes them.
		if fr.forbade {
			forks := make([]*cand, len(permitted))
			for i, c := range permitted {
				forks[i] = c.fork()
			}
			e.allowed = &entry{cands: rk.merge(forks), count: fr.allowed.total, profile: fr.allowed.profile, vec: fr.allowed.vec, least: fr.allowed.least, w: fr.allowedW}
		}
		e.cands = rk.merge(cands)
	}
	fr.slot.state, fr.slot.e = 2, e
	return e
}

// startSym gives a constituent's value where it is known without its
// items, and otherwise a frame that ranks them.
func (rk *ranker) startSym(s *symNode, f forbidden) (rankFrame, *entry) {
	var scope *slotScope
	if rk.views != nil {
		scope = rk.views.symScopes[s]
	}
	if scope != nil && scope.blocked {
		return nil, nil
	}
	if f.has(s.rule) {
		return nil, nil
	}
	f = rk.slotContext(f, s.rule, scope)
	slot := memoSlotFor(rk.symMemo(s), f)
	switch slot.state {
	case 1:
		return nil, nil
	case 2:
		return nil, slot.e
	}
	slot.state = 1
	if w := work.Load(); w != nil {
		w.summaryContexts.add("summary contexts")
	}
	inner := f
	if rk.rec.g.rules[s.rule].scc >= 0 && scope == nil {
		inner = f.with(s.rule)
	}
	return &symFrame{s: s, inner: inner, slot: slot}, nil
}

// edgeVal is the value of one completed item, an edge of a constituent.
type edgeVal struct {
	profile ruleProfile
	it      *item
	e       *entry
	vec     *elSeq
}

// symFrame ranks a constituent's completed items in turn.
type symFrame struct {
	s     *symNode
	inner forbidden
	slot  *memoSlot
	// The item being ranked, whether its value is asked for, and the
	// values and summary of the items before it.
	i     int
	asked bool
	vals  []edgeVal
	sum   summary
	w     bool
}

func (fr *symFrame) resume(rk *ranker, in *entry) (rankFrame, *entry) {
	s := fr.s
	for ; fr.i < len(s.items); fr.i++ {
		c := s.items[fr.i]
		e := in
		if !fr.asked {
			call, v := rk.startItem(c, fr.inner)
			if call != nil {
				fr.asked = true
				return call, nil
			}
			e = v
		}
		fr.asked, in = false, nil
		if e == nil || e.count == 0 {
			continue
		}
		profile := e.profile
		if rk.rec.g.rules[s.rule].leftmostLongest {
			a, b := s.start, s.end
			if rc := rk.rec.recon; rc != nil {
				a, b = int32(rc.project[a]), int32(rc.project[b])
			}
			if a < b {
				profile = sumProfiles(profile, ruleProfile{{a, b, countOne}})
			}
		}
		vec := e.vec
		if rk.elisions && c.prod.restoration() && !c.restores {
			// The helper of an elidable optional that derives ε elides its
			// terminator at its position (engine §6).
			vec = rk.leaf(s.start)
		}
		// Faults of the check skip the last of two or more completed
		// items, in the count or in the candidates (tests/README.md).
		if !rk.skips("lost:context", "items", fr.i, len(s.items)) {
			fr.sum.add(profile, vec, e.least, e.count)
			fr.w = fr.w || e.w
		}
		if !rk.skips("lost:select", "items", fr.i, len(s.items)) {
			fr.vals = append(fr.vals, edgeVal{it: c, e: e, vec: vec, profile: profile})
		}
	}
	var cands []*cand
	for _, v := range fr.vals {
		if (rk.elisions || rk.profiles) && compareScore(v.profile, v.vec, fr.sum.profile, fr.sum.vec) != 0 {
			continue
		}
		c := v.it
		for _, x := range v.e.cands {
			n := &cand{d: closeNode(c.prod, s.start, s.end, s.tags, x.d, s.structure)}
			rk.inherit(n, x, count{}, func(t *dn) *dn { return closeNode(c.prod, s.start, s.end, s.tags, t, s.structure) }, pastInf)
			cands = append(cands, n)
		}
	}
	var e *entry
	if fr.sum.total > 0 {
		e = &entry{cands: rk.merge(cands), count: fr.sum.total, profile: fr.sum.profile, vec: fr.sum.vec, least: fr.sum.least, w: fr.w}
	}
	fr.slot.state, fr.slot.e = 2, e
	return nil, e
}

// prepare ranks, without forbidden ancestors, every item the accepted
// constituents depend on, set by set and, within a set, by origin from the
// right, so that no recursion runs deeper than one set's items of one origin.
func (rk *ranker) prepare(top []*symNode) {
	var stack []*item
	seen := map[*symNode]bool{}
	markSym := func(s *symNode) {
		if seen[s] {
			return
		}
		seen[s] = true
		for _, c := range s.items {
			if !rk.marked[c] {
				rk.marked[c] = true
				stack = append(stack, c)
			}
		}
	}
	for _, s := range top {
		markSym(s)
	}
	for len(stack) > 0 {
		it := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		for _, l := range it.links {
			if l.prev != nil && !rk.marked[l.prev] {
				rk.marked[l.prev] = true
				stack = append(stack, l.prev)
			}
			if l.sym != nil {
				markSym(l.sym)
			}
		}
	}
	bySet := make([][]*item, len(rk.rec.sets))
	for it := range rk.marked {
		bySet[it.set] = append(bySet[it.set], it)
	}
	for _, marked := range bySet {
		// By origin from the right; ties by creation are irrelevant to the
		// result, but a fixed order keeps recursion shallow the same way
		// every time.
		sort.Slice(marked, func(i, j int) bool {
			if marked[i].origin != marked[j].origin {
				return marked[i].origin > marked[j].origin
			}
			return marked[i].dot < marked[j].dot
		})
		for _, it := range marked {
			rk.itemVal(it, nil)
		}
	}
}

// rankResult is the outcome of ranking one parse: the verdict, the first
// reading, m, which is the chosen derivation unless the verdict is a tie,
// and for a tie the second reading, t, and the witness (engine §6).
type rankResult struct {
	profile ruleProfile
	verdict string
	first   *dn
	second  *dn // nil unless the verdict is a tie
	witness [2]action
	// witnessCounted, with the witness hook's marks, says whether the count
	// counted W(D): a root has the bit (tests/README.md).
	witnessCounted bool
}

// rank ranks the derivations of the input, those of every completed item of
// text that spans it, combined as the edges of one root (engine §6). It is
// nil when every derivation is cyclic.
func (rk *ranker) rank(top []*symNode) *rankResult {
	if rk.admission != nil && rk.views != nil {
		mapped := make([]*symNode, len(top))
		for i, s := range top {
			mapped[i] = rk.views.plainSyms[s]
		}
		top = mapped
	}
	if rk.admission != nil {
		rk.admission.prepareRoots(top)
		defer func() {
			if private := rk.rec.run.ps.private; private != nil && private.slotAdmission != nil {
				private.slotAdmission(rk.admission.stats)
			}
		}()
	}
	return rk.rankOriginal(top)
}
func (rk *ranker) rankOriginal(top []*symNode) *rankResult {
	rk.prepare(top)
	type rootVal struct {
		e   *entry
		vec *elSeq
	}
	var vals []rootVal
	var root summary
	counted := false
	for _, s := range top {
		e := rk.symVal(s, nil)
		if e == nil || e.count == 0 {
			continue
		}
		root.add(e.profile, e.vec, e.least, e.count)
		counted = counted || e.w
		vals = append(vals, rootVal{e: e, vec: e.vec})
	}
	if root.total == 0 {
		return nil
	}
	var cands []*cand
	for _, v := range vals {
		if (rk.elisions || rk.profiles) && compareScore(v.e.profile, v.vec, root.profile, root.vec) != 0 {
			continue
		}
		cands = append(cands, v.e.cands...)
	}
	m := rk.finish(rk.merge(cands))
	res := &rankResult{profile: root.profile, first: m.d, witnessCounted: rk.marks != nil && counted}
	switch {
	case root.total == 1:
		res.verdict = VerdictUnique
	case rk.elisions && root.least < 2, !rk.elisions && len(m.tied.ds) == 0:
		res.verdict = VerdictResolved
	default:
		res.verdict = VerdictTie
	}
	if res.verdict != VerdictTie {
		return res
	}
	if len(m.tied.ds) == 0 {
		// Under late-elision, the forest of the best derivations holds a
		// second one exactly when the least count is two.
		panic("gencmu: the least count of late-elision disagrees with its forest")
	}
	res.second = m.tied.ds[0]
	r := rk.compare(m.d, res.second)
	if r.kind == cVisDiff {
		res.witness = [2]action{r.va, r.vb}
	} else {
		res.witness = [2]action{r.wa, r.wb}
	}
	return res
}

// summary sums the derivations of the edges of one item, constituent or
// root in one context (engine §6): their total, and under late-elision the
// least vector and the number of derivations that attain it, each up to 2.
type summary struct {
	profile ruleProfile
	total   int
	vec     *elSeq
	least   int
}

// add adds an edge's derivations. The total counts every edge, losing ones
// included; the least count counts only those that attain the least vector.
// Outside late-elision every vector is empty, so least follows total.
func (s *summary) add(profile ruleProfile, vec *elSeq, least, total int) {
	if total == 0 {
		return
	}
	switch c := compareScore(profile, vec, s.profile, s.vec); {
	case s.total == 0 || c < 0:
		s.vec, s.least, s.profile = vec, least, profile
	case c == 0:
		s.least = min(s.least+least, 2)
	}
	s.total = min(s.total+total, 2)
}

// elSeq is an elision vector (engine §6), kept as the sequence of the
// positions of a derivation's elided terminators in text order: a leaf is
// one elision at its position, and a pair is left followed by right. nil
// is the empty sequence. The sequence of an edge is that of the item before
// it followed by that of the child, so sequences built on one prefix share
// it, and a comparison skips what both share.
//
// Each node knows its first and last position and its exact size. A node
// whose positions are all one is a run of that many elisions there, which
// a comparison takes whole: over an empty span, a run can hold
// exponentially many elisions, and two runs built apart share no node.
type elSeq struct {
	first, last int32 // the first and the last position
	left, right *elSeq
	size        count
}

func (rk *ranker) leaf(at int32) *elSeq {
	l := rk.leaves[at]
	if l == nil {
		l = &elSeq{first: at, last: at, size: countOne}
		rk.leaves[at] = l
	}
	return l
}

func concatElisions(a, b *elSeq) *elSeq {
	if a == nil {
		return b
	}
	if b == nil {
		return a
	}
	return &elSeq{first: a.first, last: b.last, left: a, right: b, size: a.size.add(b.size)}
}

// compareElisions is -1 when vector a is less than b, 1 when it is greater,
// and 0 when they are equal. Two vectors compare at the first boundary where
// their counts differ, and the smaller count is less. As sequences of
// positions, they compare at their first difference: the one that elides at
// the earlier position has the greater count there, so the later position
// is less. A sequence that ends first has fewer elisions after the shared
// part, so it is less.
//
// The comparison walks the two sequences run by run. It takes the front run
// of each side, the elisions of one node at one position, and it takes away
// the smaller from the greater, so the cost depends on the number of nodes
// it opens and not on the number of elisions.
func compareElisions(a, b *elSeq) int {
	if a == b {
		return 0
	}
	x, y := runWalk{st: []*elSeq{a}}, runWalk{st: []*elSeq{b}}
	for {
		xn, yn := x.front(), y.front()
		switch {
		case xn == nil && yn == nil:
			return 0
		case xn == nil:
			return -1
		case yn == nil:
			return 1
		}
		if xn == yn && !x.cut && !y.cut {
			x.pop()
			y.pop()
			continue
		}
		xMany, yMany := xn.first != xn.last, yn.first != yn.last
		if xMany || yMany {
			// Open the larger side first, so that a part both share is met
			// at the front of both. A node over one position is a run, and
			// a walk never opens it.
			c := xn.size.cmp(yn.size)
			if xMany && (!yMany || c >= 0) {
				x.open()
			}
			if yMany && (!xMany || c <= 0) {
				y.open()
			}
			continue
		}
		if xn.first != yn.first {
			if xn.first > yn.first {
				return -1
			}
			return 1
		}
		xs, ys := x.runSize(), y.runSize()
		switch c := xs.cmp(ys); {
		case c == 0:
			x.pop()
			y.pop()
		case c < 0:
			x.pop()
			y.rest, y.cut = ys.sub(xs), true
		default:
			y.pop()
			x.rest, x.cut = xs.sub(ys), true
		}
	}
}

// runWalk walks a sequence of elisions. Where the run at its front is cut,
// rest is what remains of it.
type runWalk struct {
	st   []*elSeq
	rest count
	cut  bool
}

func (w *runWalk) front() *elSeq {
	for len(w.st) > 0 {
		if n := w.st[len(w.st)-1]; n != nil {
			return n
		}
		w.st = w.st[:len(w.st)-1]
	}
	return nil
}

func (w *runWalk) pop() {
	w.st = w.st[:len(w.st)-1]
	w.cut = false
}

func (w *runWalk) open() {
	n := w.st[len(w.st)-1]
	w.st = append(w.st[:len(w.st)-1], n.right, n.left)
}

func (w *runWalk) runSize() count {
	if w.cut {
		return w.rest
	}
	return w.st[len(w.st)-1].size
}

// ruleProfile stores nonempty spans with exact occurrence counts.
type profileSpan struct {
	start, end int32
	count      count
}
type ruleProfile []profileSpan

func spanOrder(a, b profileSpan) int {
	if a.start < b.start || (a.start == b.start && a.end > b.end) {
		return -1
	}
	if a.start == b.start && a.end == b.end {
		return 0
	}
	return 1
}

func compareProfiles(a, b ruleProfile) int {
	for i := 0; i < len(a) && i < len(b); i++ {
		if c := spanOrder(a[i], b[i]); c != 0 {
			return c
		}
		if c := a[i].count.cmp(b[i].count); c != 0 {
			return -c
		}
	}
	if len(a) > len(b) {
		return -1
	}
	if len(a) < len(b) {
		return 1
	}
	return 0
}

func sumProfiles(a, b ruleProfile) ruleProfile {
	if len(a) == 0 {
		return b
	}
	if len(b) == 0 {
		return a
	}
	out := make(ruleProfile, 0, len(a)+len(b))
	i, j := 0, 0
	for i < len(a) && j < len(b) {
		switch c := spanOrder(a[i], b[j]); {
		case c < 0:
			out = append(out, a[i])
			i++
		case c > 0:
			out = append(out, b[j])
			j++
		default:
			out = append(out, profileSpan{a[i].start, a[i].end, a[i].count.add(b[j].count)})
			i++
			j++
		}
	}
	out = append(out, a[i:]...)
	return append(out, b[j:]...)
}

func compareScore(a ruleProfile, av *elSeq, b ruleProfile, bv *elSeq) int {
	if c := compareProfiles(a, b); c != 0 {
		return c
	}
	return compareElisions(av, bv)
}

func derivationProfile(g *lowered, d *dn) ruleProfile {
	var out ruleProfile
	stack := []*dn{d}
	for len(stack) > 0 {
		n := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if n == nil {
			continue
		}
		if n.kind == dClose && g.rules[n.prod.lhs].leftmostLongest && n.start < n.end {
			out = sumProfiles(out, ruleProfile{{n.start, n.end, countOne}})
		}
		stack = append(stack, n.a, n.b)
	}
	return out
}

// secondBefore says whether a comes before b as the second reading after
// first (engine §6): it diverges from first earlier, in visible actions, or
// at the same point and before b in the order T, as contribute measures it.
func secondBefore(rk *ranker, first, a, b *dn) bool {
	div := func(d *dn) count {
		r := rk.compare(first, d)
		switch r.kind {
		case cVisDiff, cAPrefix, cBPrefix:
			return r.pos
		}
		return inf
	}
	switch c := div(a).cmp(div(b)); {
	case c < 0:
		return true
	case c > 0:
		return false
	}
	return rk.aFirst(rk.compare(a, b))
}
