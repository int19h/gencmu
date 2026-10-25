package gencmu

import (
	"encoding/json"
	"fmt"
	"math/big"
	"strconv"
	"strings"
)

// domPattern holds either a node predicate or a children expression.
// Its shape distinguishes the two sorts in the grammar DOM.
type domPattern struct {
	Kind, Name   string
	At           [2]int
	Items        []*domPattern
	Value        *domTerm
	Op           string
	Requirements []tagRequirement
	Ends         [2]*domTerm
	Exact        bool
	Attached     []*domPattern
}

func walkPattern(p *domPattern, visit func(*domPattern)) {
	stack := []*domPattern{p}
	for len(stack) > 0 {
		n := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if n == nil {
			continue
		}
		visit(n)
		for i := len(n.Attached) - 1; i >= 0; i-- {
			stack = append(stack, n.Attached[i])
		}
		for i := len(n.Items) - 1; i >= 0; i-- {
			stack = append(stack, n.Items[i])
		}
	}
}
func patternProblem(root *domPattern, depth int, check func(*domPattern, int) string) string {
	type entry struct {
		p     *domPattern
		depth int
		item  bool
	}
	stack := []entry{{root, depth, false}}
	for len(stack) > 0 {
		e := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		p := e.p
		if p == nil {
			return "a malformed pattern"
		}
		if e.item && p.Kind == "sequence" {
			for _, v := range p.Items {
				stack = append(stack, entry{v, e.depth, true})
			}
			continue
		}
		if e.depth > maxDOMDepth {
			return "nested too deeply"
		}
		push := func(v *domPattern, item bool) { stack = append(stack, entry{v, e.depth + 1, item}) }
		if e.item {
			switch p.Kind {
			case "node":
				push(p.Items[0], false)
			case "choice", "optional", "repeat":
				for _, v := range p.Items {
					push(v, true)
				}
			case "siblings":
			default:
				return "a malformed pattern item"
			}
			continue
		}
		if check != nil && (p.Kind == "name" || p.Kind == "literal" || p.Kind == "range" || p.Kind == "wildcard" || p.Kind == "test") {
			if problem := check(p, e.depth); problem != "" {
				return problem
			}
		}
		switch p.Kind {
		case "path", "test":
			push(p.Items[0], false)
		case tmUnion, tmIntersection, tmDifference:
			for _, v := range p.Items {
				push(v, false)
			}
		case "children":
			push(p.Items[0], true)
		case "name", "terminal", "constant", "literal", "range", "wildcard", "any":
		default:
			return "a malformed pattern"
		}
		for _, v := range p.Attached {
			push(v, true)
		}
	}
	return ""
}
func decodePattern(raw json.RawMessage, children bool, depth int) (*domPattern, error) {
	if children {
		return nil, fmt.Errorf("a pattern child must be an item in an array")
	}
	return decodeLayeredPattern(raw, depth)
}
func (w *jsonWriter) pattern(p *domPattern) { writeLayeredPattern(w, p) }
func patternKey(p *domPattern) string {
	var w jsonWriter
	w.pattern(patternKeyCopy(p))
	return string(w.buf)
}
func patternKeyCopy(p *domPattern) *domPattern {
	n := *p
	n.At = [2]int{}
	n.Items = make([]*domPattern, len(p.Items))
	for i, c := range p.Items {
		n.Items[i] = patternKeyCopy(c)
	}
	if p.Attached != nil {
		n.Attached = make([]*domPattern, len(p.Attached))
		for i, c := range p.Attached {
			n.Attached[i] = patternKeyCopy(c)
		}
	}
	return &n
}

// A patternMachine observes a tree through finite predicate bits and
// relations of finite automata. It never stores a candidate tree.
type patternPredicate struct {
	p        *domPattern
	operands []int
	machine  int
}
type patternEdge struct{ from, to, predicate int }
type patternNFA struct {
	size, start, end int
	edges            []patternEdge
	epsilon          []*big.Int
}
type patternState struct {
	count                  int
	first, last, any, bits *big.Int
	relations              [][]*big.Int
	empty                  bool
}
type patternMachine struct {
	predicates  []patternPredicate
	machines    []patternNFA
	ids         map[string]int
	rootIDs     map[*domPattern]int
	states      []patternState
	stateIDs    map[string]int
	transitions map[string]int
	empty       int
}

func newPatternMachine(roots []*domPattern) *patternMachine {
	m := &patternMachine{ids: map[string]int{}, rootIDs: map[*domPattern]int{}, stateIDs: map[string]int{}, transitions: map[string]int{}}
	for _, p := range roots {
		m.compile(p)
	}
	s := patternState{first: new(big.Int), last: new(big.Int), any: new(big.Int)}
	for _, n := range m.machines {
		s.relations = append(s.relations, n.epsilon)
	}
	m.empty = m.intern(s)
	return m
}
func (m *patternMachine) compile(p *domPattern) int {
	if id, ok := m.rootIDs[p]; ok {
		return id
	}
	key := patternKey(p)
	if id, ok := m.ids[key]; ok {
		m.rootIDs[p] = id
		return id
	}
	pred := patternPredicate{p: p, machine: -1}
	switch p.Kind {
	case "path", tmUnion, tmIntersection, tmDifference:
		for _, n := range p.Items {
			pred.operands = append(pred.operands, m.compile(n))
		}
	}
	if p.Kind == "children" || p.Attached != nil {
		items := &domPattern{Kind: "sequence", Items: p.Attached}
		if p.Kind == "children" {
			items = p.Items[0]
		}
		n := m.sequence(items)
		pred.machine = len(m.machines)
		m.machines = append(m.machines, n)
	}
	id := len(m.predicates)
	m.predicates = append(m.predicates, pred)
	m.ids[key] = id
	m.rootIDs[p] = id
	return id
}
func (m *patternMachine) sequence(p *domPattern) patternNFA {
	n := patternNFA{size: 2, start: 0, end: 1}
	state := func() int { id := n.size; n.size++; return id }
	edge := func(a, b, p int) { n.edges = append(n.edges, patternEdge{a, b, p}) }
	var build func(*domPattern, int, int)
	build = func(p *domPattern, a, b int) {
		switch p.Kind {
		case "node":
			edge(a, b, m.compile(p.Items[0]))
		case "siblings":
			edge(a, b, -2)
			edge(a, a, -1)
		case "sequence":
			if len(p.Items) == 0 {
				edge(a, b, -2)
			}
			for i, c := range p.Items {
				t := b
				if i < len(p.Items)-1 {
					t = state()
				}
				build(c, a, t)
				a = t
			}
		case "choice":
			for _, arm := range p.Items {
				build(arm, a, b)
			}
		case "optional":
			edge(a, b, -2)
			build(p.Items[0], a, b)
		case "repeat":
			x, y := state(), state()
			build(p.Items[0], a, x)
			edge(x, b, -2)
			if len(p.Items) == 2 {
				build(p.Items[1], x, y)
			} else {
				edge(x, y, -2)
			}
			build(p.Items[0], y, x)
		}
	}
	build(p, 0, 1)
	for i := 0; i < n.size; i++ {
		n.epsilon = append(n.epsilon, new(big.Int).SetBit(new(big.Int), i, 1))
	}
	for _, e := range n.edges {
		if e.predicate == -2 {
			n.epsilon[e.from].SetBit(n.epsilon[e.from], e.to, 1)
		}
	}
	for k := 0; k < n.size; k++ {
		for i := 0; i < n.size; i++ {
			if n.epsilon[i].Bit(k) != 0 {
				n.epsilon[i].Or(n.epsilon[i], n.epsilon[k])
			}
		}
	}
	return n
}
func (m *patternMachine) intern(s patternState) int {
	var b strings.Builder
	fmt.Fprintf(&b, "%d/%s/%s/%s/", s.count, s.first.Text(16), s.last.Text(16), s.any.Text(16))
	for _, r := range s.relations {
		for _, v := range r {
			b.WriteString(v.Text(16))
			b.WriteByte(',')
		}
		b.WriteByte(';')
	}
	if s.bits != nil {
		b.WriteString(s.bits.Text(16))
	}
	fmt.Fprintf(&b, "/%t", s.empty)
	key := b.String()
	if id, ok := m.stateIDs[key]; ok {
		return id
	}
	id := len(m.states)
	m.states = append(m.states, s)
	m.stateIDs[key] = id
	if w := work.Load(); w != nil {
		w.structuralStates.add("structural states")
	}
	return id
}
func patternCompose(a, b []*big.Int) []*big.Int {
	out := make([]*big.Int, len(a))
	for i, row := range a {
		out[i] = new(big.Int)
		for k, c := range b {
			if row.Bit(k) != 0 {
				out[i].Or(out[i], c)
			}
		}
	}
	return out
}
func (m *patternMachine) concat(a, b int) int {
	key := "c" + strconv.Itoa(a) + "," + strconv.Itoa(b)
	if id, ok := m.transitions[key]; ok {
		return id
	}
	x, y := m.states[a], m.states[b]
	s := patternState{count: min(2, x.count+y.count), first: y.first, last: x.last, any: new(big.Int).Or(x.any, y.any)}
	if x.count != 0 {
		s.first = x.first
	}
	if y.count != 0 {
		s.last = y.last
	}
	for i, r := range x.relations {
		s.relations = append(s.relations, patternCompose(r, y.relations[i]))
	}
	id := m.intern(s)
	m.transitions[key] = id
	if w := work.Load(); w != nil {
		w.structuralTransitions.add("structural transitions")
	}
	return id
}
func (m *patternMachine) nodeState(bits *big.Int, empty bool) int {
	s := patternState{count: 1, first: bits, last: bits, any: bits, bits: bits, empty: empty}
	if empty {
		s.count = 0
		s.first = new(big.Int)
		s.last = s.first
		s.any = s.first
		s.relations = m.states[m.empty].relations
	} else {
		for _, n := range m.machines {
			move := make([]*big.Int, n.size)
			for i := range move {
				move[i] = new(big.Int)
			}
			for _, e := range n.edges {
				if e.predicate != -2 && (e.predicate == -1 || bits.Bit(e.predicate) != 0) {
					move[e.from].SetBit(move[e.from], e.to, 1)
				}
			}
			s.relations = append(s.relations, patternCompose(patternCompose(n.epsilon, move), n.epsilon))
		}
	}
	return m.intern(s)
}
func (m *patternMachine) sealed() int { return m.nodeState(new(big.Int), false) }

func (m *patternMachine) node(name string, children int, terminal, sound string, tags *tagset) int {
	leaf := ""
	if tags != nil {
		leaf = terminal + "/" + strconv.Quote(sound) + "/" + tags.key
	}
	key := "n" + strconv.Quote(name) + "/" + strconv.Itoa(children) + "/" + leaf
	if id, ok := m.transitions[key]; ok {
		return id
	}
	s := m.states[children]
	bits := new(big.Int)
	for i, pr := range m.predicates {
		p := pr.p
		holds := false
		switch p.Kind {
		case "name":
			holds = name == p.Name
		case "terminal":
			holds = tags != nil && terminal == p.Name
		case "test":
			holds = tags != nil && patternLeafMatches(p, terminal, sound, tags)
		case "children":
			holds = true
		case "any":
			holds = name != "" || tags != nil
		case "path":
			holds = bits.Bit(pr.operands[0]) != 0
			child := s.any
			if p.Name == "first" {
				child = s.first
			} else if p.Name == "last" {
				child = s.last
			}
			holds = holds || child.Bit(i) != 0
		case tmUnion:
			for _, j := range pr.operands {
				holds = holds || bits.Bit(j) != 0
			}
		case tmIntersection:
			holds = true
			for _, j := range pr.operands {
				holds = holds && bits.Bit(j) != 0
			}
		case tmDifference:
			holds = bits.Bit(pr.operands[0]) != 0 && bits.Bit(pr.operands[1]) == 0
		}
		if pr.machine >= 0 {
			n := m.machines[pr.machine]
			holds = holds && s.relations[pr.machine][n.start].Bit(n.end) != 0
		}
		if !p.Exact && (p.Kind == "name" || p.Kind == "terminal" || p.Kind == "test" || p.Kind == "children" || p.Kind == "any") && s.count == 1 {
			holds = holds || s.first.Bit(i) != 0
		}
		if holds {
			bits.SetBit(bits, i, 1)
		}
	}
	id := m.nodeState(bits, tags == nil && s.count == 0)
	m.transitions[key] = id
	if w := work.Load(); w != nil {
		w.structuralTransitions.add("structural transitions")
	}
	return id
}
func (m *patternMachine) matches(state int, p *domPattern) bool {
	id, ok := m.rootIDs[p]
	return ok && state >= 0 && state < len(m.states) && m.states[state].bits != nil && m.states[state].bits.Bit(id) != 0
}

func ruleHasPattern(r *domRule) bool {
	found := false
	scan := func(p clausePart) bool {
		if p.t != nil && p.t.Kind == tmPattern {
			found = true
		}
		if p.c != nil && (p.c.Op == "≅" || p.c.Op == "≇") {
			found = true
		}
		return true
	}
	walkClause(clausePart{t: r.Tags}, scan)
	for _, a := range r.Alternatives {
		walkClause(clausePart{t: a.Tags}, scan)
	}
	if r.Emit != nil {
		for _, i := range r.Emit.Items {
			walkClause(clausePart{t: i.Tags}, scan)
		}
	}
	for _, c := range r.Conditions {
		walkClause(clausePart{c: c}, scan)
	}
	return found
}

func emptyPattern() *domPattern {
	p := &domPattern{Kind: "children", Items: []*domPattern{{Kind: "siblings"}}}
	return &domPattern{Kind: tmDifference, Items: []*domPattern{p, p}}
}
func patternLiteral(v *constValue) *domTerm {
	if v.ty == tyString {
		return &domTerm{Kind: tmString, Str: v.s}
	}
	if len(v.names) == 0 {
		return &domTerm{Kind: tmEmptySet}
	}
	items := make([]*domTerm, len(v.names))
	for i, n := range v.names {
		items[i] = &domTerm{Kind: tmTag, Str: n}
	}
	if len(items) == 1 {
		return items[0]
	}
	return &domTerm{Kind: tmUnion, Items: items}
}
func (g *stageGrammar) resolvePatternValue(doc string, p *domPattern, at [2]int) (*domPattern, *Error) {
	if p.Kind == "test" {
		base := p
		for base.Kind == "test" {
			base = base.Items[0]
		}
		if base.Kind == "constant" && g.constants[base.Name].value.ty != tyString {
			return nil, g.constError(doc, base.At, "a tested pattern constant must resolve to a string")
		}
	}
	if p.Kind == "constant" {
		v := g.constants[p.Name].value
		if v.ty == tyPattern {
			if p.Exact || p.Attached != nil {
				return nil, g.constError(doc, p.At, "a pattern-valued constant cannot carry node decorations")
			}
			return v.pattern, nil
		}
		if v.ty == tyString {
			return &domPattern{Kind: "terminal", Name: stringTerminal(v.s, g.uni), At: p.At, Exact: p.Exact}, nil
		}
		return nil, g.constError(doc, p.At, "a pattern atom requires a string or pattern")
	}
	n := *p
	n.Items = make([]*domPattern, len(p.Items))
	for i, c := range p.Items {
		v, err := g.resolvePatternValue(doc, c, at)
		if err != nil {
			return nil, err
		}
		n.Items[i] = v
	}
	if n.Kind == tmUnion || n.Kind == tmIntersection {
		flat := []*domPattern{}
		for _, item := range n.Items {
			if item.Kind == n.Kind {
				flat = append(flat, item.Items...)
			} else {
				flat = append(flat, item)
			}
		}
		n.Items = flat
	}
	if p.Attached != nil {
		n.Attached = make([]*domPattern, len(p.Attached))
		for i, child := range p.Attached {
			value, err := g.resolvePatternValue(doc, child, at)
			if err != nil {
				return nil, err
			}
			n.Attached[i] = value
		}
	}

	if p.Kind == "literal" {
		v, err := g.evaluateClosed(doc, p.Value, at)
		if err != nil {
			return nil, err
		}
		n.Kind, n.Name, n.Value = "terminal", stringTerminal(v.s, g.uni), nil
	}
	if p.Kind == "wildcard" {
		n.Kind, n.Name = "terminal", "_"
	}
	if p.Kind == "range" {
		var ends [2][]rune
		for i, term := range p.Ends {
			value, err := g.evaluateClosed(doc, term, at)
			if err != nil {
				return nil, err
			}
			ends[i] = []rune(value.s)
			if value.ty != tyString || len(ends[i]) != 1 {
				return nil, g.faultError(doc, term, p.At, "a range endpoint is one scalar")
			}
		}
		if ends[0][0] > ends[1][0] {
			where := p.At
			if references := constRefs(p.Ends[0], p.Ends[1]); len(references) > 0 {
				where = references[0].At
			}
			return nil, g.constError(doc, where, "a range starts above its end")
		}
		n.Kind, n.Name = "terminal", stringTerminal(string(ends[0]), g.uni)+".."+stringTerminal(string(ends[1]), g.uni)
	}
	if p.Kind == "test" && p.Op == "tags" {
		n.Requirements = nil
		for _, r := range p.Requirements {
			v, err := g.evaluateClosed(doc, r.Value, at)
			if err != nil {
				return nil, err
			}
			n.Requirements = append(n.Requirements, tagRequirement{Negated: r.Negated, Value: patternLiteral(v)})
		}
	}
	if p.Kind == "test" && p.Op != "tags" {
		v, err := g.evaluateClosed(doc, p.Value, at)
		if err != nil {
			return nil, err
		}
		n.Value = patternLiteral(v)
	}
	return &n, nil
}
func (r *resolver) patternValue(t *domTerm) *domPattern {
	switch t.Kind {
	case tmConst:
		return r.constants[t.Str].value.pattern
	case tmEmptySet:
		return emptyPattern()
	case tmPattern:
		return r.pattern(t.Pattern)
	default:
		xs := make([]*domPattern, len(t.Items))
		for i, n := range t.Items {
			xs[i] = r.patternValue(n)
		}
		if t.Kind == tmUnion || t.Kind == tmIntersection {
			flat := []*domPattern{}
			for _, item := range xs {
				if item.Kind == t.Kind {
					flat = append(flat, item.Items...)
				} else {
					flat = append(flat, item)
				}
			}
			xs = flat
		}
		return &domPattern{Kind: t.Kind, Items: xs}
	}
}
func (r *resolver) pattern(p *domPattern) *domPattern {
	g := &stageGrammar{constants: r.constants, uni: r.uni}
	n, err := g.resolvePatternValue("", p, [2]int{})
	if err != nil {
		panic(err)
	}
	return n
}

// preparation is what every recognition of a lowered grammar prepares from
// the grammar alone: the tree patterns that its conditions demand, whether
// it observes closes and its query prefixes, and the elidable heads. A
// lowered grammar makes it once, at its first recognition, and it does not
// change after. Each run still makes its own pattern machine and close
// arena, since both gain states as a parse runs.
type preparation struct {
	patternRoots   []*domPattern
	observesCloses bool
	queryPrefixes  []closePrefix
	elidableHeads  map[int32]string
}

func (g *lowered) prepared() *preparation {
	g.prepareOnce.Do(func() {
		var roots []*domPattern
		scan := func(p clausePart) bool {
			if p.c != nil && (p.c.Op == "≅" || p.c.Op == "≇") {
				roots = append(roots, p.c.Right.Pattern)
			}
			return true
		}
		for _, p := range g.prods {
			for _, c := range p.conds {
				walkClause(clausePart{c: c.cond}, scan)
			}
			for _, c := range p.predictConds {
				walkClause(clausePart{c: c}, scan)
			}
			walkClause(clausePart{t: p.tags}, scan)
			if p.emit != nil {
				for _, e := range p.emit.Items {
					walkClause(clausePart{t: e.Tags}, scan)
				}
			}
		}
		for _, p := range g.prods {
			if p.ranked != nil {
				for _, c := range p.slot.source.conds {
					walkClause(clausePart{c: c}, scan)
				}
			}
			if p.contextual {
				for _, term := range []*domTerm{p.slot.source.alt.Tags, p.slot.source.ruleTags} {
					walkClause(clausePart{t: term}, scan)
				}
			}
		}
		p := &preparation{patternRoots: roots, observesCloses: len(demandedCloses(g)) > 0, elidableHeads: map[int32]string{}}
		if p.observesCloses {
			p.queryPrefixes = queryPrefixes(g)
		}
		for _, prod := range g.prods {
			if prod.restoration() {
				p.elidableHeads[prod.lhs] = prod.elided
			}
		}
		g.preparation = p
	})
	return g.preparation
}

func (r *recognizer) preparePatterns() {
	run := r.run
	prepared := r.g.prepared()
	if m, ok := run.patternMachines[r.g]; ok {
		r.machine = m
	} else {
		if len(r.g.rankedHelpers) > 0 || len(prepared.patternRoots) > 0 {
			r.machine = newPatternMachine(prepared.patternRoots)
		}
		if run.patternMachines == nil {
			run.patternMachines = map[*lowered]*patternMachine{}
		}
		run.patternMachines[r.g] = r.machine
	}
	if r.machine == nil {
		return
	}
	r.elidableHeads = prepared.elidableHeads
}
func (r *recognizer) finishStructure(key *itemKey) {
	if r.machine == nil {
		return
	}
	p := key.prod
	if int(key.dot) != len(p.rhs) {
		key.structure = r.machine.empty
		return
	}
	if p.restoration() {
		key.structure = r.machine.node("", r.machine.empty, p.elided, "", r.run.ps.in.single(p.elided))
	} else if p.helper {
		key.structure = key.prefix
	} else {
		key.structure = r.machine.node(p.ruleName, key.prefix, "", "", nil)
	}
}
func (r *recognizer) terminalStructure(p *production, dot, k int, term int32) int {
	if r.machine == nil {
		return 0
	}
	terminal := r.g.terminals[term]
	if rc := r.recon; rc != nil && rc.synthetic[k] {
		if dot == 0 && r.elidableHeads[p.lhs] == terminal {
			return r.machine.node("", r.machine.empty, terminal, "", r.run.ps.in.single(terminal))
		}
		return r.machine.empty
	}
	i := r.base + k
	if r.recon != nil {
		i = r.recon.original[k]
	}
	return r.machine.node("", r.machine.empty, terminal, r.run.sound(i), r.run.tagsets[i])
}
func (r *recognizer) omissionAllowed(p *production) bool {
	if r.run.ps.fault("omission") {
		return true
	}
	if p.elidedTest == nil {
		return true
	}
	t := p.elidedTest
	sound := ""
	if t.op == "=" {
		sound = t.sound
	}
	return testHoldsOf(t, func(s string) bool { return s == sound }, r.run.ps.in.single(p.elided))
}
func (r *recognizer) derivationStructure(d *dn) int {
	if r.machine == nil {
		return 0
	}
	if d.kind != dRead {
		return d.structure
	}
	return r.terminalStructure(nil, -1, int(d.tok), d.term)
}

func resolverHasPattern(r *resolver, t *domTerm) bool {
	if t.Kind == tmPattern {
		return true
	}
	if t.Kind == tmConst {
		return r.constants[t.Str].value.ty == tyPattern
	}
	for _, n := range t.Items {
		if resolverHasPattern(r, n) {
			return true
		}
	}
	return false
}
