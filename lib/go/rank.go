package gencmu

import (
	"sort"
	"strconv"
	"strings"
)

// The ranking (engine §6), composed over the packed forest the recognizer
// leaves, without enumerating derivations.
//
// A derivation is kept as a persistent structure (dn) whose bottom-up action
// sequence is read lazily, so that two derivations sharing a subtree compare
// without walking it. For each item the ranking keeps a short list of
// candidates: the derivations no other derivation of the item beats, which
// are exactly those whose visible sequences are prefixes of one another,
// since the order of those depends on what follows. With each candidate it
// keeps the derivations tied with it that diverge from it earliest (engine
// §6, "Computing it"): all at one divergence, again only those that are
// visible prefixes of one another.

const (
	dRead = iota
	dClose
	dPart
)

// dn is a derivation of a constituent (a read or a close) or a partial one
// (a part: the derivation of an item's children so far).
type dn struct {
	kind       uint8
	tok        int32 // read: the token, relative to the recognizer's base
	term       int32
	prod       *production // close
	start, end int32       // close
	tags       *tagset     // close
	a          *dn         // part: the children before; close: its children
	b          *dn         // part: the last child
	vis, whole int32
}

func readNode(tok, term int32) *dn {
	return &dn{kind: dRead, tok: tok, term: term, vis: 1, whole: 1}
}

func partNode(prev, child *dn) *dn {
	n := &dn{kind: dPart, a: prev, b: child, vis: child.vis, whole: child.whole}
	if prev != nil {
		n.vis += prev.vis
		n.whole += prev.whole
	}
	return n
}

func closeNode(p *production, start, end int32, tags *tagset, kids *dn) *dn {
	n := &dn{kind: dClose, prod: p, start: start, end: end, tags: tags, a: kids, whole: 1}
	if !p.transparent {
		n.vis = 1
	}
	if kids != nil {
		n.vis += kids.vis
		n.whole += kids.whole
	}
	return n
}

func visOf(n *dn) int {
	if n == nil {
		return 0
	}
	return int(n.vis)
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

func elWhole(e iterEl) int {
	if isLeaf(e) {
		return 1
	}
	return int(e.n.whole)
}

func elVis(e iterEl) int {
	if e.leaf {
		if e.n.prod.transparent {
			return 0
		}
		return 1
	}
	return int(e.n.vis)
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
	pos      int // visible actions before the difference
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
	rec    *recognizer
	lean   string // greedy, lazy, or "" for rule 1 alone
	items  map[*item]*itemRank
	syms   map[*symNode]*itemRank
	marked map[*item]bool
}

func newRanker(rec *recognizer, lean string) *ranker {
	return &ranker{rec: rec, lean: lean, items: map[*item]*itemRank{}, syms: map[*symNode]*itemRank{}, marked: map[*item]bool{}}
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
	if x.read && y.read {
		ts := rk.rec.run.tagsets[rk.rec.base+int(x.tok)]
		sx, _ := ts.has(rk.rec.g.terminals[x.term])
		sy, _ := ts.has(rk.rec.g.terminals[y.term])
		switch {
		case sx && !sy:
			return oA
		case sy && !sx:
			return oB
		}
		return oTie
	}
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
	vis := 0
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
			vis += elVis(ea)
			ia.pop()
			ib.pop()
			continue
		}
		if !isLeaf(ea) || !isLeaf(eb) {
			// Expand the larger side first, so that the two meet at a
			// subtree they share.
			wa, wb := elWhole(ea), elWhole(eb)
			if !isLeaf(ea) && wa >= wb {
				ia.expand()
			}
			if !isLeaf(eb) && wb >= wa {
				ib.expand()
			}
			continue
		}
		xa, xb := elAction(ea), elAction(eb)
		if xa == xb {
			if xa.visible() {
				vis++
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
			if e.n.vis == 0 {
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
			vis += elVis(ea)
			ia.pop()
			ib.pop()
			continue
		}
		if !isLeaf(ea) || !isLeaf(eb) {
			va, vb := elVis(ea), elVis(eb)
			if !isLeaf(ea) && va >= vb {
				ia.expand()
			}
			if !isLeaf(eb) && vb >= va {
				ib.expand()
			}
			continue
		}
		xa, xb := elAction(ea), elAction(eb)
		if xa == xb {
			vis++
			ia.pop()
			ib.pop()
			continue
		}
		r.kind, r.pos, r.va, r.vb = cVisDiff, vis, xa, xb
		r.outcome = rk.decide(xa, xb)
		return r
	}
}

const inf = 1 << 30 // the divergence of derivations that differ only in transparent actions

// tiedSet holds the derivations tied with a candidate that diverge from it
// earliest, all at div, reduced to those no other beats.
type tiedSet struct {
	ds  []*dn
	div int
}

type cand struct {
	d    *dn
	tied tiedSet
	// closes is the same for the tied derivations whose action where they
	// diverge is a close. Under rule 1 alone (§7) tying is not an
	// equivalence: a close ties with a strong read and a weak one alike, so
	// when a strong read beats a weak one, a close tied with the weak one is
	// tied with the strong one too, though the best tied derivation, a read,
	// is not.
	closes tiedSet
}

type entry struct {
	cands []*cand
	count int // derivations, up to 2
}

func (rk *ranker) addTo(s *tiedSet, d *dn, div int) {
	if len(s.ds) > 0 && div > s.div {
		return
	}
	if len(s.ds) == 0 || div < s.div {
		s.ds, s.div = []*dn{d}, div
		return
	}
	s.ds = rk.insertChain(s.ds, d)
}

// addTied offers a derivation tied with c that diverges from it at div,
// where its action is a close or not.
func (rk *ranker) addTied(c *cand, d *dn, div int, close bool) {
	rk.addTo(&c.tied, d, div)
	if close {
		rk.addTo(&c.closes, d, div)
	}
}

// inherit offers what of a tied set, with each derivation changed by f, is
// tied with c at the same divergence.
func (rk *ranker) inherit(c *cand, z *cand, shift int, f func(*dn) *dn, below int) {
	for _, set := range []struct {
		s     tiedSet
		close bool
	}{{z.tied, false}, {z.closes, true}} {
		if len(set.s.ds) == 0 {
			continue
		}
		div := set.s.div
		if div != inf {
			div += shift
		}
		if set.s.div >= below {
			continue
		}
		for _, t := range set.s.ds {
			rk.addTied(c, f(t), div, set.close)
		}
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
			rk.addTied(w, z.d, r.pos, r.kind == cVisDiff && !r.vb.read)
		}
		rk.inherit(w, z, 0, same, r.pos)
		if r.kind == cVisDiff && len(z.closes.ds) > 0 && z.closes.div == r.pos {
			for _, t := range z.closes.ds {
				if r2 := rk.compare(w.d, t); r2.kind == cVisDiff && r2.outcome == oTie {
					rk.addTied(w, t, r2.pos, true)
				}
			}
		}
	case cVisEqual, cIdentical:
		if r.kind == cVisEqual {
			rk.addTied(w, z.d, inf, false)
		}
		rk.inherit(w, z, 0, same, inf+1)
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

func (rk *ranker) extend(xs, cs []*cand, into []*cand) []*cand {
	for _, x := range xs {
		for _, c := range cs {
			n := &cand{d: partNode(x.d, c.d)}
			rk.inherit(n, x, 0, func(t *dn) *dn { return partNode(t, c.d) }, inf+1)
			rk.inherit(n, c, visOf(x.d), func(t *dn) *dn { return partNode(x.d, t) }, inf+1)
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

var unitEntry = &entry{cands: []*cand{{}}, count: 1}

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

// itemVal ranks the derivations of an item's children; f applies to its
// children over the item's whole span.
func (rk *ranker) itemVal(it *item, f forbidden) *entry {
	if it.dot == 0 {
		return unitEntry
	}
	f = rk.restrict(f, it.prod.lhs)
	slot := memoSlotFor(rk.itemMemo(it), f)
	switch slot.state {
	case 1:
		return nil
	case 2:
		return slot.e
	}
	slot.state = 1
	var cands []*cand
	count := 0
	for _, l := range it.links {
		prev := unitEntry
		if l.prev != nil {
			var pf forbidden
			if l.prev.set == it.set {
				pf = f
			}
			prev = rk.itemVal(l.prev, pf)
		}
		if prev == nil || prev.count == 0 {
			continue
		}
		var child *entry
		if l.sym == nil {
			child = &entry{cands: []*cand{{d: readNode(l.tok, l.term)}}, count: 1}
		} else {
			var cf forbidden
			if l.sym.start == it.origin && l.sym.end == it.set {
				cf = f
			}
			child = rk.symVal(l.sym, cf)
		}
		if child == nil || child.count == 0 {
			continue
		}
		count += prev.count * child.count
		cands = rk.extend(prev.cands, child.cands, cands)
	}
	var e *entry
	if count > 0 {
		e = &entry{cands: rk.merge(cands), count: min(count, 2)}
	}
	slot.state, slot.e = 2, e
	return e
}

// symVal ranks the derivations of a constituent under ancestors f.
func (rk *ranker) symVal(s *symNode, f forbidden) *entry {
	if f.has(s.rule) {
		return nil
	}
	f = rk.restrict(f, s.rule)
	slot := memoSlotFor(rk.symMemo(s), f)
	switch slot.state {
	case 1:
		return nil
	case 2:
		return slot.e
	}
	slot.state = 1
	inner := f
	if rk.rec.g.rules[s.rule].scc >= 0 {
		inner = f.with(s.rule)
	}
	var cands []*cand
	count := 0
	for _, c := range s.items {
		e := rk.itemVal(c, inner)
		if e == nil || e.count == 0 {
			continue
		}
		count += e.count
		for _, x := range e.cands {
			n := &cand{d: closeNode(c.prod, s.start, s.end, s.tags, x.d)}
			rk.inherit(n, x, 0, func(t *dn) *dn { return closeNode(c.prod, s.start, s.end, s.tags, t) }, inf+1)
			cands = append(cands, n)
		}
	}
	var e *entry
	if count > 0 {
		e = &entry{cands: rk.merge(cands), count: min(count, 2)}
	}
	slot.state, slot.e = 2, e
	return e
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

// rankResult is the outcome of ranking one parse.
type rankResult struct {
	count   int
	chosen  *dn
	tied    *dn // nil unless the verdict is a tie
	witness [2]action
}

func (rk *ranker) rank(top []*symNode) *rankResult {
	rk.prepare(top)
	var cands []*cand
	count := 0
	for _, s := range top {
		e := rk.symVal(s, nil)
		if e == nil {
			continue
		}
		count += e.count
		cands = append(cands, e.cands...)
	}
	if count == 0 {
		return nil
	}
	m := rk.finish(rk.merge(cands))
	res := &rankResult{count: min(count, 2), chosen: m.d}
	if len(m.tied.ds) > 0 {
		res.tied = m.tied.ds[0]
		r := rk.compare(m.d, res.tied)
		if r.kind == cVisDiff {
			res.witness = [2]action{r.va, r.vb}
		} else {
			res.witness = [2]action{r.wa, r.wb}
		}
	}
	return res
}
