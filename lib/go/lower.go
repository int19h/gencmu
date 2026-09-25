package gencmu

import "fmt"

// The lowered grammar (engine §3): context-free productions over terminals
// and rules, the helpers for the notation's sugar among the rules.

type symbol struct {
	term bool
	id   int32 // a terminal's index in lowered.terminals, or a rule's in lowered.rules
}

type production struct {
	num          int
	lhs          int32
	rhs          []symbol
	capName      []string // per position: the capture's name, or ""
	capSlot      []int8   // per position: the item's capture slot, or -1
	nslots       int
	slotOf       map[string]int8 // capture name → slot
	tags         *domTerm        // nil: default tags (§4)
	implicit     bool            // one symbol and no tags: the constituent has its symbol's tags (§3.7)
	conds        []lcond
	predictConds []*domCond // conditions using no capture but $ of an empty production, checked at prediction
	emit         *domEmit   // as dropped and simplified for the production (§3.6)
	nothing      bool       // %emits ε: the constituent emits nothing and does not count (§11)
	transparent  bool
	helper       bool
	elided       string // for the ε production of an optional beginning with an elidable terminal
	repeatPrefix bool   // r → r x of a trailing repetition: the first child is spliced out (§12)
	ruleName     string // the rule the author wrote (for a helper, the one it serves)
	doc          string
	at           [2]int
	// warnings are the features of its alternative's warnings that are on,
	// in the order written, each giving a warning for a node of the chosen
	// tree built by the production (§12); a helper has none.
	warnings []string
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
	name     string
	helper   bool
	owner    string
	prods    []*production
	nullable bool
	scc      int // the index of its same-span cycle class, or -1 if it can never lie below itself
}

type lowered struct {
	stage      *stageGrammar
	rules      []*lrule
	byName     map[string]int32
	terminals  []string
	termID     map[string]int32
	prods      []*production
	lean       string // "greedy", "lazy", or "" for rule 1 only (§7)
	maximal    bool   // no terminator is elided where its constituent could have been longer (§4)
	sccMembers [][]int32
	// fault is an error of the grammar that lowering for these features
	// found (§3.3), or "": parsing with it is a result with that error.
	fault string
	// warns says some production gives warnings under these features (§12).
	warns bool
}

type slot struct {
	sym     symbol
	capture string
}

type lowerer struct {
	g         *stageGrammar
	l         *lowered
	features  map[string]bool
	mandatory bool
	helpers   int
	memo      map[*domExpr][][]slot // expansions of one alternative, by place
	into      *[]*helperNode        // where a new helper goes
}

// helperNode is the helper of one place where [ ] or ... is written,
// with the helpers of the places written inside it.
type helperNode struct {
	rule     int32
	bodies   [][]slot
	elide    string
	owner    *sAlt
	children []*helperNode
}

// lower lowers a stage's grammar for a set of features; mandatory makes
// every optional that begins with an elidable terminal mandatory (§3.8).
func lower(g *stageGrammar, features map[string]bool, mandatory bool) *lowered {
	l := &lowered{stage: g, byName: map[string]int32{}, termID: map[string]int32{}, lean: g.lean, maximal: g.maximal}
	lw := &lowerer{g: g, l: l, features: features, mandatory: mandatory}
	for _, r := range g.rules {
		l.byName[r.name] = int32(len(l.rules))
		l.rules = append(l.rules, &lrule{name: r.name, owner: r.name, scc: -1})
	}
	for _, r := range g.rules {
		lw.lowerRule(r)
	}
	l.computeCycles()
	return l
}

func (lw *lowerer) terminal(name string) symbol {
	id, ok := lw.l.termID[name]
	if !ok {
		id = int32(len(lw.l.terminals))
		lw.l.terminals = append(lw.l.terminals, name)
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
	lhs := lw.l.byName[r.name]
	for _, a := range alts {
		var helpers []*helperNode
		lw.memo = map[*domExpr][][]slot{}
		lw.into = &helpers
		e := a.alt.Expr
		var last *domExpr
		var prefix []*domExpr
		if len(alts) == 1 {
			if e.Kind == exRepeat {
				last = e
			} else if e.Kind == exSeq && e.Items[len(e.Items)-1].Kind == exRepeat {
				last = e.Items[len(e.Items)-1]
				prefix = e.Items[:len(e.Items)-1]
			}
		}
		if last != nil && lw.l.fault == "" && hasCapture(e) {
			// Its recursive productions could not have its captures, whose
			// parts lie inside the inner constituent (§3.3).
			lw.l.fault = fmt.Sprintf("%s: an alternative of %s captures a part, and is lowered as a trailing repetition", a.doc, r.name)
		}
		if last != nil {
			// Trailing repetition (§3.3): r → p x ... is r → p x | r x, and
			// r → p [x] ... is r → p | r x. The places are expanded in the
			// order they are written, which numbers their helpers.
			ps := lw.expandSeq(prefix, a, r.name)
			xs := lw.expand(last.Inner, a, r.name)
			if last.Min == 1 {
				for _, p := range ps {
					for _, x := range xs {
						lw.addProduction(lhs, concat(p, x), a, false)
					}
				}
			} else {
				for _, p := range ps {
					lw.addProduction(lhs, p, a, false)
				}
			}
			for _, x := range xs {
				lw.addProduction(lhs, concat([]slot{{sym: symbol{id: lhs}}}, x), a, true)
			}
		} else {
			for _, s := range lw.expand(e, a, r.name) {
				lw.addProduction(lhs, s, a, false)
			}
		}
		// Then the helpers, in the order their places are written, each
		// followed at once by those inside it (§3, Numbering).
		var number func(hs []*helperNode)
		number = func(hs []*helperNode) {
			for _, h := range hs {
				for _, b := range h.bodies {
					p := lw.newProduction(h.rule, b)
					p.helper = true
					p.transparent = true
					p.ruleName = lw.l.rules[h.rule].owner
					p.doc, p.at = h.owner.doc, h.owner.at
					if len(b) == 0 && h.elide != "" {
						p.elided = h.elide
					}
				}
				number(h.children)
			}
		}
		number(helpers)
	}
}

// hasCapture says whether an alternative's expression captures a part,
// which it can only at its top level (§3.5).
func hasCapture(e *domExpr) bool {
	items := []*domExpr{e}
	if e.Kind == exSeq {
		items = e.Items
	}
	for _, it := range items {
		if it.Kind == exCapture {
			return true
		}
	}
	return false
}

func concat(a, b []slot) []slot {
	out := make([]slot, 0, len(a)+len(b))
	return append(append(out, a...), b...)
}

func (lw *lowerer) newProduction(lhs int32, body []slot) *production {
	p := &production{num: len(lw.l.prods), lhs: lhs, slotOf: map[string]int8{}}
	p.capName = make([]string, len(body))
	p.capSlot = make([]int8, len(body))
	for i, s := range body {
		p.rhs = append(p.rhs, s.sym)
		p.capSlot[i] = -1
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

func (lw *lowerer) addProduction(lhs int32, body []slot, a *sAlt, repeatPrefix bool) {
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
	// The clauses are simplified for the production (§3.6). A condition
	// that became true is dropped, and one that became false removes the
	// production; one that uses a capture the production lacks does not
	// apply to it.
	var conds []*domCond
	for _, c := range a.conds {
		s, tv := simplifyCond(c, has)
		switch tv {
		case alwaysTrue:
			continue
		case alwaysFalse:
			return
		}
		used := map[string]bool{}
		condCaptures(s, used)
		if _, ok := usesAll(used, has); ok {
			conds = append(conds, s)
		}
	}
	p := lw.newProduction(lhs, body)
	p.repeatPrefix = repeatPrefix
	p.ruleName = lw.l.rules[lhs].name
	p.doc, p.at = a.doc, a.at
	for _, gd := range a.alt.Guards {
		if gd.Kind == FeatureWarning && lw.features[gd.Feature] {
			p.warnings = append(p.warnings, gd.Feature)
			lw.l.warns = true
		}
	}
	p.transparent = len(body) == 1
	p.implicit = false
	p.nslots = 0
	for i, s := range body {
		p.capName[i] = s.capture
		p.capSlot[i] = -1
		if s.capture != "" {
			p.capSlot[i] = int8(p.nslots)
			p.slotOf[s.capture] = int8(p.nslots)
			p.nslots++
		}
	}
	// The union of the alternative's own tag term and its definition's
	// %tags, where either is written (§3.7).
	var written []*domTerm
	for _, t := range []*domTerm{a.alt.Tags, a.ruleTags} {
		if t != nil {
			written = append(written, simplifyTerm(t, has))
		}
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
			p.capSlot[0] = int8(p.nslots)
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
	if a.emit != nil {
		// An item naming a capture the production lacks is dropped (§3.6).
		e := &domEmit{}
		for _, it := range a.emit.Items {
			if !it.IsInsert && !has(it.Capture) {
				continue
			}
			if it.Tags != nil {
				kept := *it
				kept.Tags = simplifyTerm(it.Tags, has)
				it = &kept
			}
			e.Items = append(e.Items, it)
		}
		p.emit = e
		p.nothing = a.emit.nothing()
	}
}

// elidableTerminal is the symbol an optional's content is, or begins with
// as a sequence, recursively (§3.8); a choice or an & begins with none.
func elidableTerminal(e *domExpr) string {
	switch e.Kind {
	case exSeq:
		return elidableTerminal(e.Items[0])
	case exRef, exTerminal:
		return e.Name
	}
	return ""
}

func (lw *lowerer) expandSeq(items []*domExpr, a *sAlt, ruleName string) [][]slot {
	out := [][]slot{{}}
	for _, it := range items {
		xs := lw.expand(it, a, ruleName)
		var next [][]slot
		for _, o := range out {
			for _, x := range xs {
				next = append(next, concat(o, x))
			}
		}
		out = next
	}
	return out
}

func (lw *lowerer) expand(e *domExpr, a *sAlt, ruleName string) [][]slot {
	if x, ok := lw.memo[e]; ok {
		return x
	}
	x := lw.expandPlace(e, a, ruleName)
	lw.memo[e] = x
	return x
}

// helper makes the helper of one place, its bodies expanded at once so that
// the helpers inside it follow it.
func (lw *lowerer) helper(a *sAlt, ruleName, elide string, bodies func(h int32) [][]slot) [][]slot {
	h := lw.newHelper(a, ruleName)
	node := &helperNode{rule: h, elide: elide, owner: a}
	*lw.into = append(*lw.into, node)
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
		elide := ""
		if t := elidableTerminal(inner); t != "" && lw.g.elidable[t] {
			elide = t
		}
		mandatory := elide != "" && lw.mandatory
		return lw.helper(a, ruleName, elide, func(int32) [][]slot {
			var out [][]slot
			if !mandatory {
				out = append(out, []slot{})
			}
			return append(out, lw.expand(inner, a, ruleName)...)
		})
	case exRepeat:
		inner, min := e.Inner, e.Min
		return lw.helper(a, ruleName, "", func(h int32) [][]slot {
			xs := lw.expand(inner, a, ruleName)
			var out [][]slot
			if min == 0 {
				out = append(out, []slot{})
			} else {
				out = append(out, xs...)
			}
			for _, x := range xs {
				out = append(out, concat([]slot{{sym: symbol{id: h}}}, x))
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
	case exCapture:
		var out [][]slot
		for _, x := range lw.expand(e.Inner, a, ruleName) {
			c := concat(nil, x)
			c[0].capture = e.Name
			out = append(out, c)
		}
		return out
	case exEmpty:
		return [][]slot{{}}
	}
	panic("unknown expression " + e.Kind)
}

// computeCycles finds the rules that can lie below themselves over the same
// span: A reaches B when A → α B β with α and β nullable. A forbidden set of
// ancestors (engine §4, derivations) matters only within such a class.
func (l *lowered) computeCycles() {
	for changed := true; changed; {
		changed = false
		for _, r := range l.rules {
			if r.nullable {
				continue
			}
			for _, p := range r.prods {
				all := true
				for _, s := range p.rhs {
					if s.term || !l.rules[s.id].nullable {
						all = false
						break
					}
				}
				if all {
					r.nullable = true
					changed = true
					break
				}
			}
		}
	}
	n := len(l.rules)
	edges := make([][]int32, n)
	self := make([]bool, n)
	for i, r := range l.rules {
		for _, p := range r.prods {
			for j, s := range p.rhs {
				if s.term {
					continue
				}
				ok := true
				for k, o := range p.rhs {
					if k != j && (o.term || !l.rules[o.id].nullable) {
						ok = false
						break
					}
				}
				if ok {
					edges[i] = append(edges[i], s.id)
					if s.id == int32(i) {
						self[i] = true
					}
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
