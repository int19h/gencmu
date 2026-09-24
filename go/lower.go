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
	predictConds []*domCond // conditions mentioning no capture, checked at prediction
	emit         *domEmit
	transparent  bool
	helper       bool
	elided       string // for the ε production of an optional beginning with an elidable terminal
	repeatPrefix bool   // r ≔ r x of a trailing repetition: the first child is spliced out (§12)
	ruleName     string // the rule the author wrote (for a helper, the one it serves)
	doc          string
	at           [2]int
}

// lcond is a condition with the dot position at which the item has read the
// last capture it mentions.
type lcond struct {
	cond    *domCond
	trigger int
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
	sccMembers [][]int32
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
	pending   []pendingHelper
	helpers   int
}

type pendingHelper struct {
	rule  int32
	build func() [][]slot // its productions' bodies
	elide string
	owner *sAlt
}

// lower lowers a stage's grammar for a set of features; mandatory makes
// every optional that begins with an elidable terminal mandatory (§3.8).
func lower(g *stageGrammar, features map[string]bool, mandatory bool) *lowered {
	l := &lowered{stage: g, byName: map[string]int32{}, termID: map[string]int32{}, lean: g.lean}
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

func (lw *lowerer) guardsHold(a *domAlt) bool {
	for _, gd := range a.Guards {
		if lw.features[gd.Feature] == gd.Negated {
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
		lw.pending = nil
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
		if last != nil {
			// Trailing repetition (§3.3): r ≔ p x ... is r ≔ p x | r x, and
			// r ≔ p [x] ... is r ≔ p | r x.
			xs := lw.expand(last.Inner, a, r.name)
			ps := lw.expandSeq(prefix, a, r.name)
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
		// Helpers after the productions that introduced them, in the order
		// they were created; a helper's own helpers come after it.
		for i := 0; i < len(lw.pending); i++ {
			h := lw.pending[i]
			bodies := h.build()
			for _, b := range bodies {
				p := lw.newProduction(h.rule, b)
				p.helper = true
				p.transparent = true
				p.ruleName = lw.l.rules[h.rule].owner
				p.doc, p.at = h.owner.doc, h.owner.at
				if len(b) == 0 && h.elide != "" {
					p.elided = h.elide
				}
			}
		}
	}
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
	p := lw.newProduction(lhs, body)
	p.repeatPrefix = repeatPrefix
	p.ruleName = lw.l.rules[lhs].name
	p.doc, p.at = a.doc, a.at
	p.transparent = len(body) == 1
	p.implicit = false
	p.nslots = 0
	position := map[string]int{}
	for i, s := range body {
		p.capName[i] = s.capture
		p.capSlot[i] = -1
		if s.capture != "" {
			p.capSlot[i] = int8(p.nslots)
			p.slotOf[s.capture] = int8(p.nslots)
			position[s.capture] = i
			p.nslots++
		}
	}
	has := func(names map[string]bool) bool {
		for n := range names {
			if _, ok := position[n]; !ok {
				return false
			}
		}
		return true
	}
	tags := a.alt.Tags
	if tags == nil {
		tags = a.ruleTags
	}
	if tags != nil {
		names := map[string]bool{}
		termCaptures(tags, names)
		if has(names) {
			p.tags = tags
		}
	}
	if p.tags == nil && len(body) == 1 {
		p.implicit = true
		if p.capSlot[0] < 0 {
			p.capSlot[0] = int8(p.nslots)
			p.nslots++
		}
	}
	for _, c := range a.conds {
		names := map[string]bool{}
		condCaptures(c, names)
		if !has(names) {
			continue
		}
		trigger := 0
		for n := range names {
			if position[n]+1 > trigger {
				trigger = position[n] + 1
			}
		}
		if trigger == 0 {
			p.predictConds = append(p.predictConds, c)
		} else {
			p.conds = append(p.conds, lcond{cond: c, trigger: trigger})
		}
	}
	if a.emit != nil {
		if a.emit.Nothing {
			p.emit = a.emit
		} else {
			e := &domEmit{}
			for _, it := range a.emit.Items {
				switch {
				case it.IsInsert:
					e.Items = append(e.Items, it)
				case it.This:
					names := map[string]bool{}
					termCaptures(it.Tags, names)
					if has(names) {
						e.Items = append(e.Items, it)
					} else {
						e.Items = append(e.Items, &domEmitItem{This: true})
					}
				default:
					if _, ok := position[it.Capture]; !ok {
						continue
					}
					names := map[string]bool{}
					termCaptures(it.Tags, names)
					if has(names) {
						e.Items = append(e.Items, it)
					} else {
						e.Items = append(e.Items, &domEmitItem{Capture: it.Capture})
					}
				}
			}
			p.emit = e
		}
	}
}

// firstTerminal is the terminal an expression's expansions begin with, if it
// is one written first.
func firstTerminal(e *domExpr) string {
	switch e.Kind {
	case exSeq:
		return firstTerminal(e.Items[0])
	case exRepeat:
		if e.Min == 1 {
			return firstTerminal(e.Inner)
		}
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
		h := lw.newHelper(a, ruleName)
		inner := e.Inner
		elide := ""
		if t := firstTerminal(inner); t != "" && lw.g.elidable[t] {
			elide = t
		}
		mandatory := elide != "" && lw.mandatory
		lw.pending = append(lw.pending, pendingHelper{rule: h, owner: a, elide: elide, build: func() [][]slot {
			var out [][]slot
			if !mandatory {
				out = append(out, []slot{})
			}
			return append(out, lw.expand(inner, a, ruleName)...)
		}})
		return [][]slot{{{sym: symbol{id: h}}}}
	case exRepeat:
		h := lw.newHelper(a, ruleName)
		inner, min := e.Inner, e.Min
		lw.pending = append(lw.pending, pendingHelper{rule: h, owner: a, build: func() [][]slot {
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
		}})
		return [][]slot{{{sym: symbol{id: h}}}}
	case exHash:
		h := lw.newHelper(a, ruleName)
		free := lw.l.byName[lw.g.freeModifiers]
		lw.pending = append(lw.pending, pendingHelper{rule: h, owner: a, build: func() [][]slot {
			return [][]slot{{}, {{sym: symbol{id: h}}, {sym: symbol{id: free}}}}
		}})
		return [][]slot{{{sym: symbol{id: h}}}}
	case exRef:
		if isTerminalName(e.Name) {
			return [][]slot{{{sym: lw.terminal(e.Name)}}}
		}
		return [][]slot{{{sym: symbol{id: lw.l.byName[e.Name]}}}}
	case exTerminal:
		return [][]slot{{{sym: lw.terminal(e.Name)}}}
	case exCapture:
		xs := lw.expand(e.Inner, a, ruleName)
		for _, x := range xs {
			x[0].capture = e.Name
		}
		return xs
	case exEmpty:
		return [][]slot{{}}
	}
	panic("unknown expression " + e.Kind)
}

// computeCycles finds the rules that can lie below themselves over the same
// span: A reaches B when A ≔ α B β with α and β nullable. A forbidden set of
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
