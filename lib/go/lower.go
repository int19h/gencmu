package gencmu

import (
	"fmt"
	"sort"
	"sync"
)

// The lowered grammar (engine §3): context-free productions over terminals
// and rules, the helpers for the notation's sugar among the rules.

type symbol struct {
	term bool
	id   int32 // a terminal's index in lowered.terminals, or a rule's in lowered.rules
}

type slotMetadata struct {
	source     *sAlt
	path       *domExpr
	tags       []*domTerm
	tagClauses [2]*domTerm
}

type production struct {
	base         *production
	lexical      *rankedFrame
	ranked       *rankedGroup
	option       int
	contextual   bool
	privateConds []*domCond
	parentTags   *domTerm
	slot         *slotMetadata
	num          int
	lhs          int32
	rhs          []symbol
	tests        []*symTest // per position: the test its symbol must pass, or nil; nil when no symbol is tested (§4)
	capName      []string   // per position: the capture's name, or ""
	capSlot      []int32    // per position: the item's capture slot, or -1
	nslots       int
	slotOf       map[string]int32 // capture name → slot
	posOf        map[string]int   // capture name → its first position
	tags         *domTerm         // nil: default tags (§4)
	implicit     bool             // one symbol and no tags: the constituent has its symbol's tags (§3.7)
	conds        []lcond
	condFrom     []int32    // conds[condFrom[d]:condFrom[d+1]] are those triggered at dot d, or nil for none
	predictConds []*domCond // conditions using no capture but $ of an empty production, checked at prediction
	emit         *domEmit   // as dropped and simplified for the production (§3.6)
	nothing      bool       // %emits ε: the constituent emits nothing and does not count (§11)
	opaque       bool       // %opaque: the constituent is an opaque part, which sounds ? and shows its text (§11)
	transparent  bool
	helper       bool
	elided       string   // for the ε production of an optional beginning with an elidable terminal
	elidedTest   *symTest // the test of that terminal, if it is tested; a restored token sounds like the string of an = test (§7)
	ruleName     string   // the rule the author wrote (for a helper, the one it serves)
	doc          string
	at           [2]int
	// warnings are the features of its alternative's warnings that are on,
	// in the order written, each giving a warning for a node of the chosen
	// tree built by the production (§12); a helper has none.
	warnings []string
}

// condRange is where the conditions that are ready once an item's dot
// reaches d lie in conds: from lo up to hi, and none when the two are equal.
func (p *production) condRange(d int) (lo, hi int) {
	if p.condFrom == nil {
		return 0, 0
	}
	return int(p.condFrom[d]), int(p.condFrom[d+1])
}

// lcond is a condition, simplified for its production, with the dot
// position at which the item has read the last capture it uses, or, for one
// that uses $, at which it is complete.
type lcond struct {
	cond    *domCond
	trigger int
	whole   bool // it uses $
}

type lrule struct {
	leftmostLongest bool
	name            string
	helper          bool
	owner           string
	prods           []*production
	nullable        bool
	scc             int // the index of its same-span cycle class, or -1 if it can never lie below itself
}

type lowered struct {
	rankedHelpers  map[int32]*rankedGroup
	writtenHelpers map[int32]string
	stage          *stageGrammar
	rules          []*lrule
	byName         map[string]int32
	terminals      []string
	termID         map[string]int32
	// classes holds, for each terminal that is a range or a property, the
	// characters it matches; nil for a terminal that is a tag (§4).
	classes []*charClass
	prods   []*production
	lean    string // "greedy", "lazy", "late-elision", or "" for no lean (§6, §7)
	// maximalH holds the helpers of the optionals written [++T x], whose
	// terminators are maximal, which maximality restricts anyway (§3.8, §4).
	maximalH   map[int32]bool
	sccMembers [][]int32
	// fault is an error of the grammar that lowering for these features
	// found (§3.3), or "": parsing with it is a result with that error.
	fault         string
	faultLocation *Error
	// warns says some production gives warnings under these features (§12).
	warns bool
	// classifiers holds the stage's classifiers resolved for these
	// features: for each, each key's classes (§2).
	classifiers map[string]map[string]*constValue
	// reading is what can read in the reconstruction mode of the check of
	// elision-only, made once, when a check first needs it (§7.4).
	readingOnce sync.Once
	reading     *readingSets
	// elidable says, for each rule, whether it is the helper of an elidable
	// optional, and anyElidable whether one is. Both are made once, since
	// every nested query asks (§3.8).
	elidable    []bool
	anyElidable bool
	// maximalElides records the helpers of maximal terminators.
	maximalElides []string
}

type slot struct {
	sym     symbol
	capture string
	test    *symTest // nil for a symbol without a test
}

// symTest is a test of a symbol in a body (engine §2, §4) with its value:
// a string for a sound test, = or ≠, and a tag set for a tag test.
type symTest struct {
	op    string
	sound string
	tags  []string // a tag test's tags, in code point order
	// written is the test as an expected list writes it after its
	// terminal, such as ="la" (docs/output.md).
	written string
}

// testAt is the test of a production's symbol at a position, or nil.
func (p *production) testAt(i int) *symTest {
	if p.tests == nil {
		return nil
	}
	return p.tests[i]
}

type lowerer struct {
	helperNodes map[int32]*helperNode
	rankOptions map[int32][]int
	commonConds map[*sAlt]map[string][]*domCond
	validation  bool
	currentExpr *domExpr
	g           *stageGrammar
	l           *lowered
	features    map[string]bool
	helpers     int
	memo        map[*domExpr][][]slot // expansions of one alternative, by place
	tests       map[*domExpr]*symTest // the tests of that alternative with their values
	into        *[]*helperNode        // where a new helper goes
	// structural is every production that the gates and the expansion
	// make, before a false condition removes any (§3.3).
	structural []structuralProduction
	// braceItems is the item of each pair of braces, as its expansions,
	// with the alternative and the rule that wrote it, in the order
	// lowering met them.
	braceItems []braceItem
	// The clauses of each rule, split by the presence of captures once
	// for all its productions, by the term, list or emission split, and
	// the warnings of each alternative, found once (§3.6).
	terms    map[*domTerm]*termLowering
	condsOf  map[condsKey]*condLowering
	emits    map[*domEmit]*emitSplit
	warnings map[*sAlt][]string
}

// condsKey is a list of conditions, known by its first element and its
// length.
type condsKey struct {
	first **domCond
	n     int
}

type structuralProduction struct {
	lhs int32
	rhs []symbol
}

type braceItem struct {
	items [][]slot
	alt   *sAlt
	rule  string
}

// helperNode is the helper of one place where [ ] or flat { } is written,
// with the helpers of the places written inside it.
type helperNode struct {
	path     *domExpr
	rule     int32
	bodies   [][]slot
	elide    string
	elideT   *symTest // the test of the elidable terminal, or nil
	owner    *sAlt
	children []*helperNode
}

// lower lowers a stage's grammar for a set of features. The check of
// elision-only reads the same productions in a mode of its own (§3.8, §7.4).
func lower(g *stageGrammar, features map[string]bool) *lowered { return lowerMode(g, features, false) }
func lowerForSlots(g *stageGrammar) *lowered                   { return lowerMode(g, nil, true) }
func lowerMode(g *stageGrammar, features map[string]bool, validation bool) *lowered {
	l := &lowered{stage: g, byName: map[string]int32{}, termID: map[string]int32{}, lean: g.lean, maximalH: map[int32]bool{}}
	// The stage resolves its classifiers for the same features, before it
	// lowers its rules; an error there ends the stage as an error of
	// lowering does (§2, §3.3).
	if !validation {
		tables := g.classifiers(features)
		if tables.fault != "" {
			l.fault = tables.fault
			location := *tables.faultLocation
			location.Stage = g.name
			l.faultLocation = &location
			return l
		}
		l.classifiers = tables.tables
	}
	lw := &lowerer{helperNodes: map[int32]*helperNode{}, rankOptions: map[int32][]int{}, commonConds: map[*sAlt]map[string][]*domCond{}, validation: validation, g: g, l: l, features: features, terms: map[*domTerm]*termLowering{}, condsOf: map[condsKey]*condLowering{}, emits: map[*domEmit]*emitSplit{}, warnings: map[*sAlt][]string{}}
	for _, r := range g.rules {
		l.byName[r.name] = int32(len(l.rules))
		l.rules = append(l.rules, &lrule{leftmostLongest: len(r.flags) > 0, name: r.name, owner: r.name, scc: -1})
	}
	for _, r := range g.rules {
		if lw.lowerRule(r); l.fault != "" {
			return l
		}
	}
	// An item of braces that can match no tokens comes last, once every
	// rule is lowered (§3.3).
	if !validation {
		lw.checkBraceItems()
	}
	if l.fault != "" {
		return l
	}
	l.computeCycles()
	l.elidable, l.anyElidable = elidableHelpers(l)
	l.maximalElides = maximalElides(l)
	l.prepareRanked()
	return l
}

// loweringFault records an error of the grammar that lowering finds (§3),
// the first one, which ends lowering. Its message begins with the
// document, line and column of the definition that wrote the alternative
// at fault.
func (lw *lowerer) loweringFault(a *sAlt, format string, args ...any) {
	if lw.l.fault == "" {
		lw.l.fault = fmt.Sprintf("%s:%d:%d: ", a.doc, a.at[0], a.at[1]) + fmt.Sprintf(format, args...)
		lw.l.faultLocation = &Error{Kind: ErrorGrammar, Document: a.doc, Line: a.at[0], Column: a.at[1], Stage: lw.g.name, Message: lw.l.fault}
	}
}

// checkBraceItems reports the first item of braces, in the order lowering
// met them, that can derive the empty sequence (§3.3). Nullability is
// decided over the structural grammar: every production that the gates and
// the expansion make, helpers included, before a false condition removes
// any, with tests ignored, reachable or not.
func (lw *lowerer) checkBraceItems() {
	nullable := nullableRules(len(lw.l.rules), len(lw.structural), func(i int) (int32, []symbol) { return lw.structural[i].lhs, lw.structural[i].rhs })
	empty := func(rhs []symbol) bool {
		for _, s := range rhs {
			if s.term || !nullable[s.id] {
				return false
			}
		}
		return true
	}
	for _, b := range lw.braceItems {
		for _, x := range b.items {
			rhs := make([]symbol, len(x))
			for i, s := range x {
				rhs[i] = s.sym
			}
			if empty(rhs) {
				lw.loweringFault(b.alt, "an item of braces in %s can match no tokens", b.rule)
				return
			}
		}
	}
}

func (lw *lowerer) terminal(name string) symbol { return lw.classTerminal(name, nil) }

// classTerminal is a terminal that matches by its characters, a range or a
// property, whose name is its written form (§4); cc is nil for a tag.
func (lw *lowerer) classTerminal(name string, cc *charClass) symbol {
	id, ok := lw.l.termID[name]
	if !ok {
		id = int32(len(lw.l.terminals))
		lw.l.terminals = append(lw.l.terminals, name)
		lw.l.classes = append(lw.l.classes, cc)
		lw.l.termID[name] = id
	}
	return symbol{term: true, id: id}
}

func (lw *lowerer) newHelper(owner *sAlt, ownerRule string) int32 {
	lw.helpers++
	id := int32(len(lw.l.rules))
	lw.l.rules = append(lw.l.rules, &lrule{name: fmt.Sprintf("%s#%d", ownerRule, lw.helpers), helper: true, owner: ownerRule, scc: -1})
	return id
}

// guardsHold says whether an alternative's gates all hold; a warning is not
// a gate and never drops its alternative (§3.1).
func (lw *lowerer) guardsHold(a *domAlt) bool {
	if lw.validation {
		return true
	}
	for _, gd := range a.Guards {
		if gd.Kind != FeatureWarning && lw.features[gd.Feature] == gd.Negated {
			return false
		}
	}
	return true
}

func (lw *lowerer) lowerRule(r *sRule) {
	var alts []*sAlt
	for _, a := range r.alts {
		if lw.guardsHold(a.alt) {
			alts = append(alts, a)
		}
	}
	// A chain is the only alternative of its rule that the gates leave
	// (§3.3); a %extend-rule can add another.
	for _, a := range alts {
		if !lw.validation && isChain(a.alt.Expr) && len(alts) > 1 {
			lw.loweringFault(a, "%s is a chain, which is the whole of its rule, but another alternative stands beside it", r.name)
			return
		}
	}
	lhs := lw.l.byName[r.name]
	for _, a := range alts {
		var helpers []*helperNode
		lw.memo = map[*domExpr][][]slot{}
		lw.tests = map[*domExpr]*symTest{}
		for i, t := range testsIn(a.alt.Expr) {
			lw.tests[t] = a.tests[i]
		}
		lw.into = &helpers
		if e := a.alt.Expr; isChain(e) {
			// A chain is recursion on the rule itself, with no helper: its
			// base productions first, one for each expansion of the item,
			// then its recursive ones (§3.3).
			xs := lw.expand(e.Inner, a, r.name)
			lw.braceItems = append(lw.braceItems, braceItem{xs, a, r.name})
			ss := [][]slot{{}}
			if e.Sep != nil {
				ss = lw.expand(e.Sep, a, r.name)
			}
			self := []slot{{sym: symbol{id: lhs}}}
			for _, x := range xs {
				lw.addProduction(lhs, x, a)
			}
			if e.Chain == "left" {
				for _, s := range ss {
					for _, x := range xs {
						lw.addProduction(lhs, concat(concat(self, s), x), a)
					}
				}
			} else {
				for _, x := range xs {
					for _, s := range ss {
						lw.addProduction(lhs, concat(concat(x, s), self), a)
					}
				}
			}
		} else {
			for _, x := range lw.expand(e, a, r.name) {
				lw.addProduction(lhs, x, a)
			}
		}
		// Then the helpers, in the order their places are written, each
		// followed at once by those inside it (§3, Numbering).
		var number func(hs []*helperNode)
		number = func(hs []*helperNode) {
			for _, h := range hs {
				for optionIndex, b := range h.bodies {
					lw.structural = append(lw.structural, structuralProduction{h.rule, symbolsOf(b)})
					p := lw.newProduction(h.rule, b)
					if lw.g.ranked != nil && len(lw.g.ranked.groups) > 0 {
						p.slot = &slotMetadata{source: h.owner, path: h.path}
					}
					if lw.g.ranked != nil && len(lw.g.ranked.groups) > 0 {
						p.posOf = map[string]int{}
						p.nslots = 0
						for i, s := range b {
							p.capSlot[i] = -1
							if s.capture != "" {
								p.capName[i] = s.capture
								p.capSlot[i] = int32(p.nslots)
								p.slotOf[s.capture] = int32(p.nslots)
								p.posOf[s.capture] = i
								p.nslots++
							}
						}
						if p.implicit && p.capSlot[0] < 0 {
							p.capSlot[0] = int32(p.nslots)
							p.nslots++
						}
						if group := lw.g.ranked.expressions[h.path]; group != nil {
							p.ranked = group
							p.option = lw.rankOptions[h.rule][optionIndex]
						}
					}
					p.helper = true
					p.transparent = true
					p.ruleName = lw.l.rules[h.rule].owner
					p.doc, p.at = h.owner.doc, h.owner.at
					if len(b) == 0 && h.elide != "" {
						p.elided = h.elide
						p.elidedTest = h.elideT
					}
				}
				number(h.children)
			}
		}
		number(helpers)
	}
}

// isChain says whether an expression is a chain, {... x \ s} or
// {x ... \ s}.
func isChain(e *domExpr) bool {
	return e.Kind == exRepeat && e.Chain != ""
}

// holdsCapture says whether an expression holds a capture, at any depth
// (§3.5).
func holdsCapture(e *domExpr) bool {
	if e == nil {
		return false
	}
	if e.Kind == exRanked {
		return false
	}
	if e.Kind == exCapture {
		return true
	}
	for _, it := range e.Items {
		if holdsCapture(it) {
			return true
		}
	}
	return holdsCapture(e.Inner) || holdsCapture(e.Sep)
}

func symbolsOf(body []slot) []symbol {
	out := make([]symbol, len(body))
	for i, s := range body {
		out[i] = s.sym
	}
	return out
}

// concat is a new body of a's slots then b's. Each slot counts before it
// is copied, so that a budget stops a copy at its first slot past it.
func concat(a, b []slot) []slot {
	out := make([]slot, 0, len(a)+len(b))
	return appendSlots(appendSlots(out, a), b)
}

// appendSlots appends each slot of xs to out, each counted before it is
// copied.
func appendSlots(out, xs []slot) []slot {
	w := work.Load()
	for _, x := range xs {
		if w != nil {
			w.loweredSlots.add("lowered slots")
		}
		out = append(out, x)
	}
	return out
}

func (lw *lowerer) newProduction(lhs int32, body []slot) *production {
	p := &production{num: len(lw.l.prods), lhs: lhs, slotOf: map[string]int32{}}
	p.capName = make([]string, len(body))
	p.capSlot = make([]int32, len(body))
	for i, s := range body {
		p.rhs = append(p.rhs, s.sym)
		p.capSlot[i] = -1
		if s.test != nil {
			// A tested symbol is the symbol, and carries its test (§3).
			if p.tests == nil {
				p.tests = make([]*symTest, len(body))
			}
			p.tests[i] = s.test
		}
	}
	if len(body) == 1 {
		// One symbol and no tags: the symbol's tags (§3.7), read as captured.
		p.implicit = true
		p.capSlot[0] = 0
		p.nslots = 1
	}
	lw.l.prods = append(lw.l.prods, p)
	r := lw.l.rules[lhs]
	r.prods = append(r.prods, p)
	return p
}

func (lw *lowerer) addProduction(lhs int32, body []slot, a *sAlt) {
	// The structural grammar counts the production, whatever its
	// conditions (§3.3).
	lw.structural = append(lw.structural, structuralProduction{lhs, symbolsOf(body)})
	position := map[string]int{}
	for i, s := range body {
		if s.capture != "" {
			position[s.capture] = i
		}
	}
	// $, the whole constituent, is a capture every production has (§3.5).
	has := func(name string) bool {
		_, ok := position[name]
		return ok || name == ""
	}
	// The names of the captures the production has, by which the parts of
	// its clauses are found.
	names := []string{""}
	for name := range position {
		presenceStep()
		names = append(names, name)
	}
	// The clauses are simplified for the production (§3.6). A condition
	// that became true is dropped, and one that became false removes the
	// production; one that uses a capture the production lacks does not
	// apply to it.
	var conds []*domCond
	rawConds := lw.rankedCommonConditions(body, a)
	if len(rawConds) > 0 {
		key := condsKey{&rawConds[0], len(rawConds)}
		cl := lw.condsOf[key]
		if cl == nil {
			cl = newCondLowering(rawConds)
			lw.condsOf[key] = cl
		}
		var ok bool
		if conds, ok = cl.forProduction(names, has); !ok && !lw.validation {
			return
		}
	}
	p := lw.newProduction(lhs, body)
	if lw.g.ranked != nil && len(lw.g.ranked.groups) > 0 {
		p.slot = &slotMetadata{source: a}
	}
	p.opaque = a.opaque
	p.ruleName = lw.l.rules[lhs].name
	p.doc, p.at = a.doc, a.at
	warnings, ok := lw.warnings[a]
	if !ok {
		for _, gd := range a.alt.Guards {
			presenceStep()
			if gd.Kind == FeatureWarning && lw.features[gd.Feature] {
				warnings = append(warnings, gd.Feature)
			}
		}
		lw.warnings[a] = warnings
	}
	if len(warnings) > 0 {
		p.warnings = appendCounted(nil, warnings, readerCount(), "reader steps")
		lw.l.warns = true
	}
	p.transparent = len(body) == 1
	p.implicit = false
	p.nslots = 0
	p.posOf = make(map[string]int, len(position))
	for i, s := range body {
		p.capName[i] = s.capture
		p.capSlot[i] = -1
		if _, ok := p.posOf[s.capture]; !ok && s.capture != "" {
			p.posOf[s.capture] = i
		}
		if s.capture != "" {
			p.capSlot[i] = int32(p.nslots)
			p.slotOf[s.capture] = int32(p.nslots)
			p.nslots++
		}
	}
	// The union of the alternative's own tag term and its definition's
	// %tags, where either is written (§3.7).
	var written []*domTerm
	var tagClauses [2]*domTerm
	for index, t := range [2]*domTerm{a.alt.Tags, a.ruleTags} {
		if t != nil {
			tagClauses[index] = lw.simplifyTerm(t, names, has)
			written = append(written, tagClauses[index])
		}
	}
	if lw.validation {
		p.slot.tags = written
		p.slot.tagClauses = tagClauses
	}
	switch len(written) {
	case 1:
		p.tags = written[0]
	case 2:
		p.tags = &domTerm{Kind: tmUnion, Items: written}
	}
	if p.tags == nil && len(body) == 1 {
		p.implicit = true
		if p.capSlot[0] < 0 {
			p.capSlot[0] = int32(p.nslots)
			p.nslots++
		}
	}
	for _, c := range conds {
		names := map[string]bool{}
		condCaptures(c, names)
		trigger := 0
		for n := range names {
			at := len(body)
			if n != "" {
				at = position[n] + 1
			}
			if at > trigger {
				trigger = at
			}
		}
		if trigger == 0 {
			p.predictConds = append(p.predictConds, c)
		} else {
			p.conds = append(p.conds, lcond{cond: c, trigger: trigger, whole: names[""]})
		}
	}
	if len(p.conds) > 0 {
		// By trigger, each dot's in the order written, so that an advance
		// finds those ready at its dot without a scan of them all.
		sort.SliceStable(p.conds, func(i, j int) bool { return p.conds[i].trigger < p.conds[j].trigger })
		p.condFrom = make([]int32, len(body)+2)
		for _, c := range p.conds {
			p.condFrom[c.trigger+1]++
		}
		for d := 1; d < len(p.condFrom); d++ {
			p.condFrom[d] += p.condFrom[d-1]
		}
	}
	if a.emit != nil {
		// An item whose carrier the production lacks is dropped, and so is
		// each attachment capture it lacks (§3.6).
		e := &domEmit{}
		present := func(names []string) []string {
			var out []string
			for _, name := range names {
				if has(name) {
					out = append(out, name)
				}
			}
			return out
		}
		es := lw.emits[a.emit]
		if es == nil {
			es = newEmitSplit(a.emit.Items)
			lw.emits[a.emit] = es
		}
		for _, i := range es.present(names) {
			it := a.emit.Items[i]
			if it.Tags != nil || len(it.Before)+len(it.After) > 0 {
				kept := *it
				if it.Tags != nil {
					kept.Tags = lw.simplifyTerm(it.Tags, names, has)
				}
				kept.Before, kept.After = present(it.Before), present(it.After)
				it = &kept
			}
			e.Items = append(e.Items, it)
		}
		p.emit = e
		p.nothing = a.emit.nothing()
	}
}

// simplifyTerm simplifies a term for a production whose captures are
// names, by has, as simplifyTerm does, the term split once for all the
// productions that simplify it.
func (lw *lowerer) simplifyTerm(t *domTerm, names []string, has func(string) bool) *domTerm {
	tl := lw.terms[t]
	if tl == nil {
		tl = newTermLowering(t)
		lw.terms[t] = tl
	}
	return tl.forProduction(names, has)
}

// elidableTerminal is the terminal of an elidable optional, the content or
// the first item of its sequence (§3.8), and its tested node, if it is
// tested.
func elidableTerminal(e *domExpr) (string, *domExpr) {
	switch {
	case e.Kind == exSeq:
		return elidableTerminal(e.Items[0])
	case e.Kind == exTest && isTagSymbol(e.Inner):
		return e.Inner.Name, e
	case isTagSymbol(e):
		return e.Name, nil
	}
	return "", nil
}

// isTagSymbol says whether a symbol matches by a tag: a terminal, or a
// reference whose name begins with a capital. A reference in lower case
// names a rule, so it is never the terminator of an elidable optional,
// even one that shares its name with an identifier tag (§2, §3.8).
func isTagSymbol(e *domExpr) bool {
	return e.Kind == exTerminal || e.Kind == exRef && isTerminalName(e.Name)
}

// expandSeq is the product of the expansions of a sequence's items. Each
// body of out is its own, so an item with one expansion extends every body
// in place. Copying each body at each item would cost a long sequence the
// square of its length.
func (lw *lowerer) expandSeq(items []*domExpr, a *sAlt, ruleName string) [][]slot {
	out := [][]slot{{}}
	for _, it := range items {
		xs := lw.expand(it, a, ruleName)
		if len(xs) == 1 {
			for i := range out {
				out[i] = appendSlots(out[i], xs[0])
			}
			continue
		}
		var next [][]slot
		for _, o := range out {
			for _, x := range xs {
				next = append(next, concat(o, x))
			}
		}
		out = next
	}
	// The bodies are shared through the memo, so none may grow in place
	// later.
	for i := range out {
		out[i] = out[i][:len(out[i]):len(out[i])]
	}
	return out
}

func (lw *lowerer) expand(e *domExpr, a *sAlt, ruleName string) [][]slot {
	if x, ok := lw.memo[e]; ok {
		return x
	}
	outer := lw.currentExpr
	lw.currentExpr = e
	x := lw.expandPlace(e, a, ruleName)
	lw.currentExpr = outer
	lw.memo[e] = x
	return x
}

// helper makes the helper of one place, its bodies expanded at once so that
// the helpers inside it follow it.
func (lw *lowerer) helper(a *sAlt, ruleName, elide string, elideT *symTest, bodies func(h int32) [][]slot) [][]slot {
	h := lw.newHelper(a, ruleName)
	node := &helperNode{path: lw.currentExpr, rule: h, elide: elide, elideT: elideT, owner: a}
	*lw.into = append(*lw.into, node)
	lw.helperNodes[h] = node
	outer := lw.into
	lw.into = &node.children
	node.bodies = bodies(h)
	lw.into = outer
	return [][]slot{{{sym: symbol{id: h}}}}
}

func (lw *lowerer) expandPlace(e *domExpr, a *sAlt, ruleName string) [][]slot {
	switch e.Kind {
	case exSeq:
		return lw.expandSeq(e.Items, a, ruleName)
	case exRanked:
		return lw.helper(a, ruleName, "", nil, func(h int32) [][]slot {
			var out [][]slot
			for option, item := range e.Items {
				for _, body := range lw.expand(item, a, ruleName) {
					out = append(out, body)
					lw.rankOptions[h] = append(lw.rankOptions[h], option)
				}
			}
			return out
		})
	case exChoice:
		var out [][]slot
		for _, it := range e.Items {
			out = append(out, lw.expand(it, a, ruleName)...)
		}
		return out
	case exAnd:
		var out [][]slot
		n := len(e.Items)
		for mask := 1; mask < 1<<n; mask++ {
			var chosen []*domExpr
			for i := 0; i < n; i++ {
				if mask&(1<<i) != 0 {
					chosen = append(chosen, e.Items[i])
				}
			}
			out = append(out, lw.expandSeq(chosen, a, ruleName)...)
		}
		return out
	case exOptional:
		inner := e.Inner
		// A plain optional that holds a capture expands in place, as
		// (ε | x) would: first the empty sequence, then each expansion of
		// x (§3.2).
		if !e.Elidable && holdsCapture(inner) {
			return append([][]slot{{}}, lw.expand(inner, a, ruleName)...)
		}
		// Any other optional is a helper, and a marked one is elidable,
		// with the terminal that its marker names; ++ makes it maximal
		// (§3.8).
		elide := ""
		var elideT *symTest
		if e.Elidable {
			if t, tested := elidableTerminal(inner); t != "" {
				elide = t
				if tested != nil {
					elideT = lw.tests[tested]
				}
			}
		}
		out := lw.helper(a, ruleName, elide, elideT, func(int32) [][]slot {
			return append([][]slot{{}}, lw.expand(inner, a, ruleName)...)
		})
		if e.Maximal {
			lw.l.maximalH[out[0][0].sym.id] = true
		}
		return out
	case exRepeat:
		// Flat braces are a helper, h → x | h s x, its base productions
		// first; the places inside the item come before those inside the
		// separator (§3.2).
		if isChain(e) {
			lw.loweringFault(a, "a chain in %s is not the whole of its rule", ruleName)
		}
		item, sep := e.Inner, e.Sep
		return lw.helper(a, ruleName, "", nil, func(h int32) [][]slot {
			xs := lw.expand(item, a, ruleName)
			lw.braceItems = append(lw.braceItems, braceItem{xs, a, ruleName})
			ss := [][]slot{{}}
			if sep != nil {
				ss = lw.expand(sep, a, ruleName)
			}
			out := append([][]slot{}, xs...)
			for _, s := range ss {
				for _, x := range xs {
					out = append(out, concat(concat([]slot{{sym: symbol{id: h}}}, s), x))
				}
			}
			return out
		})
	case exRef:
		if isTerminalName(e.Name) {
			return [][]slot{{{sym: lw.terminal(e.Name)}}}
		}
		return [][]slot{{{sym: symbol{id: lw.l.byName[e.Name]}}}}
	case exTerminal:
		return [][]slot{{{sym: lw.terminal(e.Name)}}}
	case exRange:
		// A range or a property is a terminal whose name is its written
		// form, and which matches by its characters rather than by a tag.
		cc := &charClass{from: codeOfCharacterTag(e.Range[0]), to: codeOfCharacterTag(e.Range[1])}
		return [][]slot{{{sym: lw.classTerminal(rangeName(e.Range), cc)}}}
	case exProperty:
		return [][]slot{{{sym: lw.classTerminal(propertyName(e.Name), &charClass{property: e.Name})}}}
	case exCapture:
		var out [][]slot
		for _, x := range lw.expand(e.Inner, a, ruleName) {
			c := concat(nil, x)
			c[0].capture = e.Name
			out = append(out, c)
		}
		return out
	case exTest:
		// A tested symbol lowers to its symbol with the test, and adds no
		// helper (§3).
		x := lw.expand(e.Inner, a, ruleName)
		c := concat(nil, x[0])
		c[0].test = lw.tests[e]
		return [][]slot{c}
	case exEmpty:
		return [][]slot{{}}
	}
	panic("unknown expression " + e.Kind)
}

// derivedRules is the least set of rules closed under the productions:
// a production's rule is in it when seed says so, or when one of its
// symbols is a rule in it (any), or when all of its symbols are (all, and
// none is a terminal). A worklist indexed by each rule's uses settles each
// rule once. A pass over every production until nothing changes would
// settle one rule per pass, and cost the rules times the grammar.
func derivedRules(rules, prods int, prod func(i int) (int32, []symbol), seed func(i int) bool, all bool) []bool {
	w := work.Load()
	in := make([]bool, rules)
	// waiting[i] is the number of symbols of production i still to be
	// settled: all of them for all, one for any.
	waiting := make([]int, prods)
	uses := make([][]int32, rules)
	var queue []int32
	settle := func(rule int32) {
		if !in[rule] {
			in[rule] = true
			queue = append(queue, rule)
		}
	}
	for i := 0; i < prods; i++ {
		if w != nil {
			w.ruleSetSteps.add("rule set steps")
		}
		lhs, rhs := prod(i)
		if seed(i) {
			settle(lhs)
			continue
		}
		blocked := false
		for _, s := range rhs {
			if w != nil {
				w.ruleSetSteps.add("rule set steps")
			}
			if s.term {
				blocked = all
				if !all {
					settle(lhs)
				}
				break
			}
		}
		if blocked || in[lhs] {
			continue
		}
		waiting[i] = 1
		if all {
			waiting[i] = len(rhs)
		}
		if all && len(rhs) == 0 {
			settle(lhs)
			continue
		}
		for _, s := range rhs {
			if w != nil {
				w.ruleSetSteps.add("rule set steps")
			}
			uses[s.id] = append(uses[s.id], int32(i))
		}
	}
	for len(queue) > 0 {
		rule := queue[0]
		queue = queue[1:]
		for _, i := range uses[rule] {
			if w != nil {
				w.ruleSetSteps.add("rule set steps")
			}
			if waiting[i] == 0 {
				continue
			}
			waiting[i]--
			if waiting[i] == 0 {
				lhs, _ := prod(int(i))
				settle(lhs)
			}
		}
	}
	return in
}

// nullableRules is the rules that can derive the empty sequence.
func nullableRules(rules, prods int, prod func(i int) (int32, []symbol)) []bool {
	return derivedRules(rules, prods, prod, func(int) bool { return false }, true)
}

// othersNullable is the quadratic check of unit edges that the test-only
// switch checkOthers restores: whether every symbol of rhs but the one at
// j is a nullable rule, each symbol counted before it is checked.
func othersNullable(w *workCounts, rhs []symbol, j int, nullable []bool) bool {
	for o, x := range rhs {
		if o == j {
			continue
		}
		w.ruleSetSteps.add("rule set steps")
		if x.term || !nullable[x.id] {
			return false
		}
	}
	return true
}

// computeCycles finds the rules that can lie below themselves over the same
// span: A reaches B when A → α B β with α and β nullable. A forbidden set of
// ancestors (engine §4, derivations) matters only within such a class.
func (l *lowered) computeCycles() {
	nullable := nullableRules(len(l.rules), len(l.prods), func(i int) (int32, []symbol) { return l.prods[i].lhs, l.prods[i].rhs })
	for i, r := range l.rules {
		r.nullable = nullable[i]
	}
	n := len(l.rules)
	edges := make([][]int32, n)
	self := make([]bool, n)
	// Each symbol and edge counts before it is examined, so that a check of
	// every other symbol for each passes the budget at once.
	wc := work.Load()
	for i, r := range l.rules {
		for _, p := range r.prods {
			// B is reached through every other symbol nullable. One count of
			// the symbols that are not finds each B, where a check of the
			// others for each B would cost a long production its square.
			blocking, at := 0, -1
			for j, o := range p.rhs {
				if wc != nil {
					wc.ruleSetSteps.add("rule set steps")
				}
				if o.term || !nullable[o.id] {
					blocking++
					at = j
				}
			}
			for j, s := range p.rhs {
				if wc != nil {
					wc.ruleSetSteps.add("rule set steps")
				}
				if s.term {
					continue
				}
				if wc != nil && wc.checkOthers {
					if !othersNullable(wc, p.rhs, j, nullable) {
						continue
					}
				} else if blocking > 1 || (blocking == 1 && at != j) {
					continue
				}
				edges[i] = append(edges[i], s.id)
				if s.id == int32(i) {
					self[i] = true
				}
			}
		}
	}
	// Tarjan's algorithm, iteratively.
	index := make([]int, n)
	low := make([]int, n)
	on := make([]bool, n)
	for i := range index {
		index[i] = -1
	}
	var stack []int32
	counter := 0
	type frame struct {
		v int32
		e int
	}
	for root := 0; root < n; root++ {
		if wc != nil {
			wc.ruleSetSteps.add("rule set steps")
		}
		if index[root] >= 0 {
			continue
		}
		calls := []frame{{int32(root), 0}}
		index[root], low[root] = counter, counter
		counter++
		stack = append(stack, int32(root))
		on[root] = true
		for len(calls) > 0 {
			f := &calls[len(calls)-1]
			v := f.v
			if f.e < len(edges[v]) {
				if wc != nil {
					wc.ruleSetSteps.add("rule set steps")
				}
				w := edges[v][f.e]
				f.e++
				if index[w] < 0 {
					index[w], low[w] = counter, counter
					counter++
					stack = append(stack, w)
					on[w] = true
					calls = append(calls, frame{w, 0})
				} else if on[w] && index[w] < low[v] {
					low[v] = index[w]
				}
				continue
			}
			if low[v] == index[v] {
				var members []int32
				for {
					w := stack[len(stack)-1]
					stack = stack[:len(stack)-1]
					on[w] = false
					members = append(members, w)
					if w == v {
						break
					}
				}
				if len(members) > 1 || self[v] {
					id := len(l.sccMembers)
					l.sccMembers = append(l.sccMembers, members)
					for _, m := range members {
						l.rules[m].scc = id
					}
				}
			}
			calls = calls[:len(calls)-1]
			if len(calls) > 0 {
				u := calls[len(calls)-1].v
				if low[v] < low[u] {
					low[u] = low[v]
				}
			}
		}
	}
}
