package gencmu

import (
	"sort"
	"strconv"
	"strings"
)

// The ranking (engine §6), composed over the packed forest the recognizer
// leaves, without enumerating derivations.
//
// Where the key steps of the directive count anything, the ranking first
// keeps, for each item in each context, the greatest profile of its
// derivations and the links that attain it (see profileSpace). Then it
// ranks over that smaller forest of the best derivations with the lean of
// the directive: greedy, lazy or none. Under greedy, lazy and no lean, the
// ranking compares the action sequences of derivations, as below. With no
// lean, the count of the best derivations gives the verdict.
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
	workingStructure int
	structure        int
	closes           int
	kind             uint8
	tok              int32 // read: the token, relative to the recognizer's base
	term             int32
	prod             *production // close
	start, end       int32       // close
	tags             *tagset     // close
	a                *dn         // part: the children before; close: its children
	b                *dn         // part: the last child
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
	if len(structure) > 1 {
		n.closes = structure[1]
	}
	if len(structure) > 2 {
		n.workingStructure = structure[2]
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
	hidden     bool
	start, end int32
}

func (a action) visible() bool { return a.read || !a.hidden }

func (a action) same(b action) bool {
	if a.read || b.read {
		return a.read && b.read && a.tok == b.tok && a.term == b.term
	}
	return a.prod == b.prod && a.start == b.start && a.end == b.end
}

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
	return action{prod: sourceProduction(e.n.prod), hidden: e.n.prod.transparent, start: e.n.start, end: e.n.end}
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
	restoration       *restorationViews
	admission         *slotAdmission
	rawWitnessCounted *bool
	canonical         *ranker
	witnessOnly       bool
	witnessShown      *dn
	rec               *recognizer
	// lean is greedy, lazy, or "" for no lean, where any two differing
	// derivations tie.
	lean string
	// space holds the key steps of the ranking, and profiles says whether
	// they count anything: a step names elision, or a rule counts as a
	// pattern of a key step (engine §6).
	space    *profileSpace
	profiles bool
	items    map[*item]*itemRank
	syms     map[*symNode]*itemRank
	marked   map[*item]bool
	// marks holds W(D)'s links for each item of W(D) (tests/README.md).
	// Each count also says whether it includes a derivation of marked links only.
	// Every elision-only check supplies these marks, including without a test hook.
	marks map[*item]map[link]bool
	// check selects canonical competitors during reconstruction.
	check bool
	views *slotViews
}

// skips says whether a fault of the check skips this alternative: the last
// of two or more links of an item, or completed items of a constituent
// (tests/README.md). Independent action summaries retain their complete candidates.
func (rk *ranker) skips(fault, site string, i, n int) bool {
	return rk.check && !rk.witnessOnly && rk.canonical != rk && n > 1 && i == n-1 && rk.rec.run.ps.faultAt(fault, site)
}

// newRanker ranks by the key steps of a directive and then its lean,
// greedy, lazy, or no lean for "" (engine §6).
func newRanker(rec *recognizer, steps []keyStep, lean string) *ranker {
	projection := newRestorationViews(rec)
	if projection != nil {
		rec = projection.rec
	}
	rk := newUnfilteredRanker(rec, steps, lean)
	rk.restoration = projection
	if len(rec.g.rankedHelpers) > 0 {
		rk.views = newSlotViews(rk)
		rk.admission = newSlotAdmission(rk)
	}
	return rk
}

// newUnfilteredRanker keeps the raw forest without ranked views or admission.
func newUnfilteredRanker(rec *recognizer, steps []keyStep, lean string) *ranker {
	rk := &ranker{rec: rec, lean: lean, space: newProfileSpace(steps), items: map[*item]*itemRank{}, syms: map[*symNode]*itemRank{}, marked: map[*item]bool{}}
	rk.space.rec = rec
	rk.profiles = rec.g.canCountProfiles(steps)
	carried := false
	for _, measure := range rec.diagnosticMeasures().carried {
		carried = carried || !measure[2].isZero()
	}
	rk.profiles = rk.profiles || carried
	if rec.recon != nil {
		onlyOmitted := true
		for _, step := range steps {
			onlyOmitted = onlyOmitted && requiresElided(step.pattern)
		}
		if onlyOmitted && !rec.g.hasErrors && !carried {
			rk.profiles = false
		}
	}
	return rk
}

// The extra action summary cuts only to the diagnostic measure (§6).
// Its ordinary prefix frontier keeps actions that later context can distinguish.
func (rk *ranker) canonicalItem(it *item, f forbidden) *entry {
	if rk.canonical == nil {
		canonical := newUnfilteredRanker(rk.rec, nil, "")
		canonical.profiles = true
		canonical.canonical = canonical
		canonical.admission, canonical.views = rk.admission, rk.views
		canonical.restoration = rk.restoration
		canonical.check, canonical.marks = rk.check, rk.marks
		rk.canonical = canonical
	}
	return rk.canonical.itemVal(it, f)
}

// The shown W(D) preserves its exterior edges and uses kept erased interiors (§7.10).
func (rk *ranker) witnessRepresentative(top []*symNode) *dn {
	representative := newUnfilteredRanker(rk.rec, nil, "")
	representative.profiles, representative.check, representative.witnessOnly = true, rk.check, true
	representative.admission, representative.views, representative.marks = rk.admission, rk.views, rk.marks
	representative.restoration = rk.restoration
	if rk.restoration != nil {
		mapped := make([]*symNode, len(top))
		for i, s := range top {
			mapped[i] = rk.restoration.syms[s]
			if mapped[i] == nil {
				mapped[i] = s
			}
		}
		top = mapped
	}
	if representative.views != nil {
		mapped := make([]*symNode, len(top))
		for index, symbol := range top {
			mapped[index] = representative.views.plainSyms[symbol]
		}
		top = mapped
	}
	result := representative.rankOriginal(top)
	if result == nil {
		return nil
	}
	rk.witnessShown = result.first
	return result.first
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
	first := func(visible bool) cmpRes {
		var ia, ib actionIter
		ia.push(a)
		ib.push(b)
		position := count{}
		size := elWhole
		if visible {
			size = elVis
		}
		norm := func(it *actionIter) (iterEl, bool) {
			for {
				e, ok := it.top()
				if !ok || !size(e).isZero() {
					return e, ok
				}
				it.pop()
			}
		}
		for {
			ea, oka := norm(&ia)
			eb, okb := norm(&ib)
			switch {
			case !oka && !okb:
				return cmpRes{kind: cVisEqual, pos: position}
			case !oka:
				return cmpRes{kind: cAPrefix, pos: position}
			case !okb:
				return cmpRes{kind: cBPrefix, pos: position}
			}
			if ea == eb {
				position = position.add(size(ea))
				ia.pop()
				ib.pop()
				continue
			}
			if !isLeaf(ea) || !isLeaf(eb) {
				c := size(ea).cmp(size(eb))
				if !isLeaf(ea) && c >= 0 {
					ia.expand()
				}
				if !isLeaf(eb) && c <= 0 {
					ib.expand()
				}
				continue
			}
			xa, xb := elAction(ea), elAction(eb)
			if xa.same(xb) {
				position = position.add(countOne)
				ia.pop()
				ib.pop()
				continue
			}
			return cmpRes{kind: cVisDiff, pos: position, va: xa, vb: xb, outcome: rk.decide(xa, xb)}
		}
	}
	result, whole := first(true), first(false)
	result.aEnded = whole.kind == cAPrefix
	result.hasWhole = whole.kind == cVisDiff
	result.wa, result.wb = whole.va, whole.vb
	if result.kind == cVisEqual && whole.kind == cVisEqual {
		result.kind = cIdentical
	}
	return result
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
	cands []*cand
	count int // derivations, up to 2: the total of engine §6
	// Under profiles, profile is the greatest profile of the derivations,
	// and least the number of them that attain it, up to 2. cands then
	// holds only derivations that attain profile.
	profile profile
	least   int
	// w, with the runtime witness marks, says whether count includes a
	// derivation of marked links only (tests/README.md). The same loop
	// decides both, so any choice that drops W(D) from the count drops it
	// here.
	w bool
}

func (rk *ranker) addTo(s *tiedSet, d *dn, div count) {
	c := div.cmp(s.div)
	if !rk.check && len(s.ds) > 0 && c > 0 {
		return
	}
	if len(s.ds) == 0 || !rk.check && c < 0 {
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
	if len(s.ds) == 0 || !rk.check && s.div.cmp(below) >= 0 {
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
	if len(cands) == 0 {
		return nil
	}
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
// A restoration (engine §7.4) has one link, a read of its synthetic token,
// and its close follows (§7.7).
func (rk *ranker) startItem(it *item, f forbidden) (rankFrame, *entry) {
	if it.dot == 0 && !it.restores {
		if rk.witnessOnly && rk.slotMarks(it) == nil {
			return nil, nil
		}
		// A predicted item of W(D), such as an empty production's, is
		// W(D)'s (tests/README.md).
		if rk.slotMarks(it) != nil {
			return nil, markedUnitEntry
		}
		return nil, unitEntry
	}
	if it.restores && rk.rec.run.ps.faultAt("rank-restoration", "ranker") {
		return nil, nil
	}
	var scope *slotScope
	if rk.views != nil {
		scope = rk.views.itemScopes[it]
	}
	f = rk.slotContext(f, rk.rec.g.cycleRule(it.prod.lhs), scope)
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
	return &itemFrame{it: it, f: f, slot: slot, marked: rk.slotMarks(it)}, nil
}

// linkVal is the summary of one link: its derivations, and under
// profiles their greatest profile and how many attain it.
type linkVal struct {
	profile     profile
	prev, child *entry
	admitted    bool
	least       int
}

// itemFrame ranks an item's links in turn, each first its predecessor and
// then its child.
type itemFrame struct {
	it     *item
	f      forbidden
	slot   *memoSlot
	marked map[link]bool
	// The link being ranked, what of it is ranked so far, and the values
	// and summaries of the links before it.
	i           int
	phase       int
	prev, child *entry
	vals        []linkVal
	all         summary
	allW        bool
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
	it := fr.it
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
			fr.prev, fr.phase = prev, linkAskChild
			fallthrough
		case linkAskChild:
			if fr.prev == nil || fr.prev.count == 0 {
				fr.i, fr.phase = fr.i+1, linkAskPrev
				continue
			}
			if l.sym == nil {
				var profile profile
				if rk.profiles {
					profile = rk.space.measureProfile(rk.rec.carriedMeasure(l.tok))
					a, b := l.tok, l.tok+1
					if rc := rk.rec.recon; rc != nil {
						a, b = int32(rc.project[a]), int32(rc.project[b])
					}
					if a < b {
						index := rk.rec.base + int(l.tok)
						if rc := rk.rec.recon; rc != nil {
							index = rc.original[l.tok]
						}
						profile = rk.space.sum(profile, rk.space.occurrence("", rk.rec.g.terminals[l.term], rk.rec.run.toks[index].Value, rk.rec.run.tagsets[index], a, b))
					}
				}
				fr.child, fr.phase = &entry{cands: []*cand{{d: readNode(l.tok, l.term)}}, count: 1, least: 1, profile: profile}, linkSummarize
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
	it := fr.it
	prev, child, i := fr.prev, fr.child, fr.i
	if child == nil || child.count == 0 {
		return
	}
	v := linkVal{prev: prev, child: child, admitted: true}
	if rk.admission != nil {
		if mask, ok := rk.admission.mask(it, fr.f); ok {
			v.admitted = mask[i]
		}
	}
	if rk.witnessOnly && !fr.marked[l] {
		v.admitted = false
	}
	count := prev.count * child.count
	if rk.profiles {
		// An edge's profile is the sum of its children's, and its least
		// count their product (engine §6).
		v.least = min(prev.least*child.least, 2)
		v.profile = rk.space.sum(prev.profile, child.profile)
	}
	// The link is W(D)'s where it is marked, and its predecessor and
	// child are W(D)'s. A predicted predecessor and a read are.
	w := fr.marked[l] && (l.prev == nil || prev.w) && (l.sym == nil || child.w)
	// Faults of the check skip the last of two or more links, in the
	// count or in the candidates (tests/README.md).
	if !rk.skips("lost:context", "links", i, len(it.links)) {
		if v.admitted {
			fr.all.add(rk.space, v.profile, v.least, count)
			fr.allW = fr.allW || w
		}
	}
	if !rk.skips("lost:select", "links", i, len(it.links)) {
		fr.vals = append(fr.vals, v)
	}
}

// finish gives the item's value from its links' and remembers it.
func (fr *itemFrame) finish(rk *ranker) *entry {
	// The candidates. Under profiles, only the links that attain the
	// greatest profile of the summary give them.
	var cands []*cand
	for _, v := range fr.vals {
		inAll := v.admitted && (!rk.profiles || rk.space.compare(v.profile, fr.all.profile) == 0)
		if !inAll {
			continue
		}
		produced := rk.extend(v.prev.cands, v.child.cands, nil)
		cands = append(cands, produced...)
	}
	var e *entry
	if fr.all.total > 0 {
		e = &entry{count: fr.all.total, profile: fr.all.profile, least: fr.all.least, w: fr.allW}
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
	if f.has(rk.rec.g.cycleRule(s.rule)) {
		return nil, nil
	}
	f = rk.slotContext(f, rk.rec.g.cycleRule(s.rule), scope)
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
		inner = f.with(rk.rec.g.cycleRule(s.rule))
	}
	return &symFrame{s: s, inner: inner, slot: slot}, nil
}

// edgeVal is the value of one completed item, an edge of a constituent.
type edgeVal struct {
	profile profile
	it      *item
	e       *entry
}

// symFrame ranks a constituent's completed items in turn.
type symFrame struct {
	s     *symNode
	inner forbidden
	slot  *memoSlot
	// The item being ranked, whether its value is asked for, and the
	// values and summary of the items before it.
	i      int
	asked  bool
	vals   []edgeVal
	sum    summary
	w      bool
	erased []*edgeVal
}

func (fr *symFrame) resume(rk *ranker, in *entry) (rankFrame, *entry) {
	s := fr.s
	for ; fr.i < len(s.items); fr.i++ {
		c := s.items[fr.i]
		e := in
		if !fr.asked && rk.witnessOnly && c.prod.nothing {
			e = rk.canonicalItem(c, fr.inner)
		} else if !fr.asked {
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
		if rk.profiles {
			if c.prod.nothing {
				profile = nil
			} else if c.prod.error != nil {
				profile = rk.space.sum(profile, rk.space.measureProfile(rk.rec.ownMeasure(c.origin, c.set)))
			}
			if c.prod.restoration() && !c.restores && rk.rec.recon == nil {
				tags := rk.rec.run.ps.in.fromList([]string{c.prod.elided, "_Elided"})
				profile = rk.space.sum(rk.space.occurrence("", c.prod.elided, "", tags, s.start, s.start), profile)
			}
			a, b := s.start, s.end
			if rc := rk.rec.recon; rc != nil {
				a, b = int32(rc.project[a]), int32(rc.project[b])
			}
			if !rk.rec.g.rules[s.rule].helper && a < b {
				profile = rk.space.sum(rk.space.occurrence(rk.rec.g.rules[s.rule].name, "", "", s.tags, a, b), profile)
			}
		}
		if c.prod.nothing {
			// Equal erased completions contribute one exterior occurrence.
			// Their selected interior comes from the independent action summary.
			canonical := rk.canonicalItem(c, fr.inner)
			if canonical != nil && canonical.count > 0 {
				inside := canonical.profile
				if c.prod.error != nil {
					inside = rk.canonical.space.sum(inside, rk.canonical.space.measureProfile(rk.rec.ownMeasure(c.origin, c.set)))
				}
				fr.erased = append(fr.erased, &edgeVal{it: c, e: canonical, profile: inside})
				fr.w = fr.w || e.w
			}
			continue
		}
		// Faults of the check skip the last of two or more completed
		// items, in the count or in the candidates (tests/README.md).
		if !rk.skips("lost:context", "items", fr.i, len(s.items)) {
			fr.sum.add(rk.space, profile, e.least, e.count)
			fr.w = fr.w || e.w
		}
		if !rk.skips("lost:select", "items", fr.i, len(s.items)) {
			fr.vals = append(fr.vals, edgeVal{it: c, e: e, profile: profile})
		}
	}
	if len(fr.erased) > 0 {
		if rk.admission != nil || rk.witnessOnly {
			for _, c := range s.items {
				if c.prod.nothing && rk.slotMarks(c) != nil {
					fr.w = true
				}
			}
		}
		var interior profile
		var candidates []*cand
		for _, v := range fr.erased {
			order := v.profile.measure().cmp(interior.measure())
			if len(candidates) == 0 || order < 0 {
				interior, candidates = v.profile, nil
			} else if order > 0 {
				continue
			}
			for _, x := range v.e.cands {
				candidates = append(candidates, &cand{d: closeNode(v.it.prod, s.start, s.end, s.tags, x.d, s.structure, s.closes, v.it.structure)})
			}
		}
		var exterior profile
		a, b := s.start, s.end
		if rc := rk.rec.recon; rc != nil {
			a, b = int32(rc.project[a]), int32(rc.project[b])
		}
		if rk.profiles && !rk.rec.g.rules[s.rule].helper && a < b {
			exterior = rk.space.occurrence(rk.rec.g.rules[s.rule].name, "", "", s.tags, a, b)
		}
		selected := rk.canonical.finish(rk.canonical.merge(candidates))
		if selected != nil {
			fr.sum.add(rk.space, exterior, 1, 1)
			fr.vals = append(fr.vals, edgeVal{e: &entry{cands: []*cand{{d: selected.d}}, count: 1, least: 1}, profile: exterior})
		}
	}
	var cands []*cand
	for _, v := range fr.vals {
		if rk.profiles && rk.space.compare(v.profile, fr.sum.profile) != 0 {
			continue
		}
		c := v.it
		if c == nil {
			cands = append(cands, v.e.cands...)
			continue
		}
		for _, x := range v.e.cands {
			n := &cand{d: closeNode(c.prod, s.start, s.end, s.tags, x.d, s.structure, s.closes, c.structure)}
			rk.inherit(n, x, count{}, func(t *dn) *dn {
				return closeNode(c.prod, s.start, s.end, s.tags, t, s.structure, s.closes, c.structure)
			}, pastInf)
			cands = append(cands, n)
		}
	}
	var e *entry
	if fr.sum.total > 0 {
		e = &entry{cands: rk.merge(cands), count: fr.sum.total, profile: fr.sum.profile, least: fr.sum.least, w: fr.w}
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
	profile profile
	verdict string
	first   *dn
	second  *dn // nil unless the verdict is a tie
	witness [2]action
	// witnessCounted, with the runtime witness marks, says whether the count
	// counted W(D): a root has the bit (tests/README.md).
	witnessCounted bool
}

// rank ranks the derivations of the input, those of every completed item of
// text that spans it, combined as the edges of one root (engine §6). It is
// nil when every derivation is cyclic.
func (rk *ranker) rank(top []*symNode) *rankResult {
	if rk.restoration != nil {
		mapped := make([]*symNode, len(top))
		for i, s := range top {
			mapped[i] = rk.restoration.syms[s]
			if mapped[i] == nil {
				mapped[i] = s
			}
		}
		top = mapped
	}
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
	var vals []*entry
	var root summary
	counted := false
	for _, s := range top {
		e := rk.symVal(s, nil)
		if e == nil || e.count == 0 {
			continue
		}
		root.add(rk.space, e.profile, e.least, e.count)
		counted = counted || e.w
		vals = append(vals, e)
	}
	if root.total == 0 {
		return nil
	}
	var cands []*cand
	for _, e := range vals {
		if rk.profiles && rk.space.compare(e.profile, root.profile) != 0 {
			continue
		}
		cands = append(cands, e.cands...)
	}
	m := rk.finish(rk.merge(cands))
	if m == nil {
		return nil
	}

	res := &rankResult{profile: root.profile, first: m.d, witnessCounted: rk.marks != nil && counted}
	// Without a lean, the count of the best derivations decides; with one,
	// the lean decides among them (engine §6).
	counts := rk.profiles && rk.lean == ""
	// Without a lean, the forest holds a second best derivation exactly
	// when the best count is two (engine §6).
	if counts && (root.least == 2) != (len(m.tied.ds) > 0) {
		panic("gencmu: the best count disagrees with its forest")
	}
	switch {
	case root.total == 1:
		res.verdict = VerdictUnique
	case counts && root.least < 2, !counts && len(m.tied.ds) == 0:
		res.verdict = VerdictResolved
	default:
		res.verdict = VerdictTie
	}
	if res.verdict != VerdictTie {
		return res
	}
	if len(m.tied.ds) == 0 {
		// Without a lean, the forest of the best derivations holds a
		// second one exactly when the best count is two.
		panic("gencmu: the best count disagrees with its forest")
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
// root in one context (engine §6): their total, and under profiles the
// greatest profile and the number of derivations that attain it, each up
// to 2.
type summary struct {
	profile profile
	total   int
	least   int
}

// add adds an edge's derivations. The total counts every edge, losing ones
// included; the least count counts only those that attain the greatest
// profile. Outside profiles every profile is zero, so least follows total.
func (s *summary) add(space *profileSpace, p profile, least, total int) {
	if total == 0 {
		return
	}
	comparison := space.compare(p, s.profile)
	errors := p.measure().cmp(s.profile.measure())
	if s.total == 0 || errors < 0 {
		s.total = min(total, 2)
	} else if errors == 0 {
		s.total = min(s.total+total, 2)
	}
	switch {
	case s.least == 0 || comparison < 0:
		s.least, s.profile = least, p
	case comparison == 0:
		s.least = min(s.least+least, 2)
	}
}

// elSeq is the component of a profile under late(c) and early(c) (engine
// §6), kept as the sequence of the starting positions of a derivation's
// occurrences of c in text order: a leaf is one occurrence at its position,
// and a pair is left followed by right. nil is the empty sequence. The
// elision vector of late #·<_Elided> is one such sequence. The sequence of an edge is that of the item before
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

// keyStep is a step of %ambiguity-resolution that compares the occurrences
// of one category: leftmost-longest, fewest, most, late or early (engine
// §6).
type keyStep struct {
	step    string
	pattern *domPattern
}

// profileSpan is the count of the occurrences over one nonempty span.
type profileSpan struct {
	start, end int32
	count      count
}

// component is a profile's counts for one key step: under leftmost-longest
// the counts over the spans, in start order and reverse end order, under
// fewest and most their sum, and under late and early the sequence of
// their starting positions. The zero component counts nothing.
type component struct {
	spans []profileSpan
	n     count
	seq   *elSeq
}

// profile is a derivation's counts of every category that a key step
// names, one component per key step, in the order of the steps (engine
// §6). nil is the profile that counts nothing.
type profile []component

func (p profile) at(i int) component {
	if p == nil {
		return component{}
	}
	return p[i]
}

func (p profile) measure() diagnosticMeasure {
	return diagnosticMeasure{p.at(0).n, p.at(1).n, p.at(2).n}
}

// profileSpace holds the key steps of one ranking: how they count
// occurrences, add profiles and compare them (engine §6).
type profileSpace struct {
	kinds      []string
	steps      []keyStep
	answers    map[rankingNodeKey]bool
	values     []bool
	nodeValues bool
	spanValues map[[2]int32]string
	rec        *recognizer
	// leaves holds the one sequence of a single occurrence at each position.
	leaves map[int32]*elSeq
}

type rankingNodeKey struct {
	step                  int
	name, terminal, value string
	tags                  *tagset
}

func newProfileSpace(steps []keyStep) *profileSpace {
	sp := &profileSpace{kinds: []string{"fewest", "fewest", "most"}, steps: steps, answers: map[rankingNodeKey]bool{}, leaves: map[int32]*elSeq{}}
	for _, step := range steps {
		sp.kinds = append(sp.kinds, step.step)
		sp.values = append(sp.values, patternHasValue(step.pattern))
		sp.nodeValues = sp.nodeValues || patternReadsNodeValue(step.pattern)
	}
	return sp
}

func (sp *profileSpace) occurrence(name, terminal, value string, tags *tagset, p, q int32) profile {
	var out profile
	if name != "" && sp.nodeValues {
		if sp.spanValues == nil {
			sp.spanValues = map[[2]int32]string{}
		}
		key := [2]int32{p, q}
		var found bool
		value, found = sp.spanValues[key]
		if !found {
			a, b := sp.rec.observed(p, q)
			value = sp.rec.run.spanValue(spanVal{a: a, b: b})
			sp.spanValues[key] = value
		}
	}
	for index, step := range sp.steps {
		key := rankingNodeKey{step: index, name: name, terminal: terminal, tags: tags}
		if sp.values[index] {
			key.value = value
		}
		match, found := sp.answers[key]
		if !found {
			match = localNodeMatches(step.pattern, name, terminal, value, tags)
			sp.answers[key] = match
		}
		if !match {
			continue
		}
		if out == nil {
			out = make(profile, len(sp.kinds))
		}
		switch step.step {
		case "leftmost-longest":
			if p < q {
				out[index+3].spans = []profileSpan{{p, q, countOne}}
			}
		case "fewest", "most":
			out[index+3].n = countOne
		default:
			out[index+3].seq = sp.leaf(p)
		}
	}
	return out
}

func (sp *profileSpace) leaf(at int32) *elSeq {
	l := sp.leaves[at]
	if l == nil {
		l = &elSeq{first: at, last: at, size: countOne}
		sp.leaves[at] = l
	}
	return l
}

// sum adds two profiles component by component. The positions of a
// precede those of b.
func (sp *profileSpace) sum(a, b profile) profile {
	if a == nil {
		return b
	}
	if b == nil {
		return a
	}
	out := make(profile, len(sp.kinds))
	for i, step := range sp.kinds {
		switch step {
		case "leftmost-longest":
			out[i].spans = sumSpans(a[i].spans, b[i].spans)
		case "fewest", "most":
			out[i].n = a[i].n.add(b[i].n)
		default:
			out[i].seq = concatElisions(a[i].seq, b[i].seq)
		}
	}
	return out
}

// compare compares two profiles step by step: the first step whose
// comparison decides gives the order. It is negative when a is the greater
// profile, so that its derivation wins (engine §6).
func (sp *profileSpace) compare(a, b profile) int {
	if a == nil && b == nil {
		return 0
	}
	for i, step := range sp.kinds {
		x, y := a.at(i), b.at(i)
		c := 0
		switch step {
		case "leftmost-longest":
			c = compareSpans(x.spans, y.spans)
		case "fewest":
			c = x.n.cmp(y.n)
		case "most":
			c = y.n.cmp(x.n)
		case "late":
			c = compareElisions(x.seq, y.seq)
		case "early":
			c = compareElisions(y.seq, x.seq)
		}
		if c != 0 {
			return c
		}
	}
	return 0
}

// derivationProfile counts every completed nonempty occurrence in a chosen
// derivation, and no elision (engine §7). It visits the closes in text
// order, a parent before its children, so that the sequences of late and
// early list their positions in order.
func (sp *profileSpace) derivationProfile(g *lowered, d *dn) profile {
	if sp.rec.recon != nil {
		original, rec := *sp, *sp.rec
		rec.recon, rec.base = nil, 0
		rec.measures = sp.rec.diagnosticMeasures().original
		original.rec, original.spanValues = &rec, nil
		sp = &original
	}
	var out profile
	stack := []*dn{d}
	for len(stack) > 0 {
		n := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if n == nil {
			continue
		}
		if n.kind == dClose && n.prod.error != nil && !n.prod.nothing {
			out = sp.sum(out, sp.measureProfile(sp.rec.ownMeasure(n.start, n.end)))
		}
		if n.kind == dClose && !g.rules[n.prod.lhs].helper && n.start < n.end {
			out = sp.sum(out, sp.occurrence(g.rules[n.prod.lhs].name, "", "", n.tags, n.start, n.end))
		} else if n.kind == dRead {
			rec := sp.rec
			index := rec.base + int(n.tok)
			out = sp.sum(out, sp.measureProfile(rec.carriedMeasure(n.tok)))
			out = sp.sum(out, sp.occurrence("", g.terminals[n.term], rec.run.toks[index].Value, rec.run.tagsets[index], n.tok, n.tok+1))
		}
		if n.kind == dClose && n.prod.nothing {
			continue
		}
		stack = append(stack, n.b, n.a)
	}
	return out
}

func spanOrder(a, b profileSpan) int {
	if a.start < b.start || (a.start == b.start && a.end > b.end) {
		return -1
	}
	if a.start == b.start && a.end == b.end {
		return 0
	}
	return 1
}

// compareSpans compares span counts in start order and reverse end order:
// at the first differing span, the side that counts an earlier or longer
// span, or more over one span, wins. It is negative when x wins.
func compareSpans(x, y []profileSpan) int {
	for i := 0; i < len(x) && i < len(y); i++ {
		if c := spanOrder(x[i], y[i]); c != 0 {
			return c
		}
		if c := x[i].count.cmp(y[i].count); c != 0 {
			return -c
		}
	}
	if len(x) > len(y) {
		return -1
	}
	if len(x) < len(y) {
		return 1
	}
	return 0
}

// sumSpans adds span counts without expanding repeated occurrences.
func sumSpans(x, y []profileSpan) []profileSpan {
	if len(x) == 0 {
		return y
	}
	if len(y) == 0 {
		return x
	}
	out := make([]profileSpan, 0, len(x)+len(y))
	i, j := 0, 0
	for i < len(x) && j < len(y) {
		switch c := spanOrder(x[i], y[j]); {
		case c < 0:
			out = append(out, x[i])
			i++
		case c > 0:
			out = append(out, y[j])
			j++
		default:
			out = append(out, profileSpan{x[i].start, x[i].end, x[i].count.add(y[j].count)})
			i++
			j++
		}
	}
	out = append(out, x[i:]...)
	out = append(out, y[j:]...)
	return out
}

func (sp *profileSpace) measureProfile(measure diagnosticMeasure) profile {
	if measure == (diagnosticMeasure{}) {
		return nil
	}
	out := make(profile, len(sp.kinds))
	for index, value := range measure {
		out[index].n = value
	}
	return out
}
