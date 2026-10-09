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
	Kind, Name string
	At         [2]int
	Items      []*domPattern
	Value      *domTerm
	Op         string
}

func patternNode(c *domPattern) *domPattern {
	if c.Kind == "node" {
		return c.Items[0]
	}
	return &domPattern{Kind: "children", Items: []*domPattern{c}}
}
func patternChildren(p *domPattern) *domPattern {
	return &domPattern{Kind: "node", Items: []*domPattern{p}}
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
		for i := len(n.Items) - 1; i >= 0; i-- {
			stack = append(stack, n.Items[i])
		}
	}
}
func patternConsumes(p *domPattern) bool {
	result := false
	walkPattern(p, func(n *domPattern) {
		if n.Kind == "node" || n.Kind == "siblings" {
			result = true
		}
	})
	return result
}
func patternProblem(root *domPattern, depth int, check func(*domPattern, int) string) string {
	type entry struct {
		p                  *domPattern
		depth              int
		children, repeated bool
	}
	stack := []entry{{root, depth, false, false}}
	for len(stack) > 0 {
		e := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		p := e.p
		if e.depth > maxDOMDepth {
			return "nested too deeply"
		}
		if p == nil {
			return "a malformed pattern"
		}
		push := func(n *domPattern, c, r bool) { stack = append(stack, entry{n, e.depth + 1, c, r}) }
		if e.children {
			switch p.Kind {
			case "node":
				if len(p.Items) != 1 {
					return "a malformed pattern node"
				}
				push(p.Items[0], false, e.repeated)
			case "siblings":
				if e.repeated {
					return "a sibling ellipsis cannot be a repeat item or separator"
				}
			case "sequence":
				if len(p.Items) < 2 {
					return "a malformed pattern sequence"
				}
				for _, n := range p.Items {
					push(n, true, e.repeated)
				}
			case "optional":
				if len(p.Items) != 1 {
					return "a malformed pattern optional"
				}
				push(p.Items[0], true, e.repeated)
			case "repeat":
				if len(p.Items) < 1 || len(p.Items) > 2 {
					return "a malformed pattern repeat"
				}
				if !patternConsumes(p.Items[0]) {
					return "a pattern repeat cannot match only empty sequences"
				}
				for _, n := range p.Items {
					push(n, true, true)
				}
			default:
				return "a malformed pattern children expression"
			}
		} else {
			switch p.Kind {
			case "name":
				if p.Name != "#" && !classifierName.MatchString(p.Name) {
					return "a malformed pattern rule name"
				}
			case "terminal", "constant":
				if !constName.MatchString(p.Name) {
					return "a malformed pattern terminal or constant"
				}
			case "test":
				if len(p.Items) != 1 || p.Items[0].Kind != "terminal" || !testOps[p.Op] || p.Value == nil {
					return "a pattern test requires one terminal atom"
				}
				if check != nil {
					if msg := check(p, e.depth); msg != "" {
						return msg
					}
				}
				push(p.Items[0], false, e.repeated)
			case "children":
				if len(p.Items) != 1 {
					return "a malformed pattern"
				}
				push(p.Items[0], true, e.repeated)
			case "path":
				if len(p.Items) != 1 || (p.Name != "descendant" && p.Name != "first" && p.Name != "last") {
					return "a malformed pattern path"
				}
				push(p.Items[0], false, e.repeated)
			case tmUnion, tmIntersection, tmDifference:
				if len(p.Items) < 2 || (p.Kind == tmDifference && len(p.Items) != 2) {
					return "a malformed pattern"
				}
				for _, n := range p.Items {
					push(n, false, e.repeated)
				}
			default:
				return "a malformed pattern"
			}
		}
	}
	return ""
}
func decodePattern(raw json.RawMessage, children bool, depth int) (*domPattern, error) {
	if depth > maxDOMDepth {
		return nil, errTooDeep
	}
	o, err := decodeObj(raw)
	if err != nil {
		return nil, err
	}
	forms := [][]string{{"name", "at"}, {"terminal", "at"}, {"constant", "at"}, {"test", "expr", "value"}, {"children"}, {"path", "pattern"}, {tmUnion}, {tmIntersection}, {tmDifference}}
	if children {
		forms = [][]string{{"node"}, {"siblings"}, {"sequence"}, {"optional"}, {"repeat", "separator?"}}
	}
	if !hasOneForm(o, forms) {
		return nil, fmt.Errorf("a malformed pattern")
	}
	p := &domPattern{}
	for _, k := range []string{"name", "terminal", "constant"} {
		if v, ok := o[k]; ok {
			p.Kind = k
			p.Name, err = decodeString(v)
			if err != nil {
				return nil, err
			}
			p.At, err = decodePosition(o["at"])
			return p, err
		}
	}
	for _, k := range []string{tmUnion, tmIntersection, tmDifference, "sequence"} {
		if v, ok := o[k]; ok {
			p.Kind = k
			p.Items, err = decodeList(v, func(r json.RawMessage) (*domPattern, error) { return decodePattern(r, k == "sequence", depth+1) })
			return p, err
		}
	}
	if v, ok := o["siblings"]; ok {
		if !isTrue(v) {
			return nil, fmt.Errorf("a malformed sibling ellipsis")
		}
		p.Kind = "siblings"
		return p, nil
	}
	if v, ok := o["test"]; ok {
		p.Kind = "test"
		p.Op, err = decodeString(v)
		if err != nil {
			return nil, err
		}
		p.Value, err = decodeTermAt(o["value"], depth+1)
		if err != nil {
			return nil, err
		}
		n, err := decodePattern(o["expr"], false, depth+1)
		p.Items = []*domPattern{n}
		return p, err
	}
	if v, ok := o["path"]; ok {
		p.Kind = "path"
		p.Name, err = decodeString(v)
		if err != nil {
			return nil, err
		}
		n, err := decodePattern(o["pattern"], false, depth+1)
		p.Items = []*domPattern{n}
		return p, err
	}
	for _, k := range []string{"children", "node", "optional", "repeat"} {
		if v, ok := o[k]; ok {
			p.Kind = k
			n, e := decodePattern(v, k != "node", depth+1)
			if e != nil {
				return nil, e
			}
			p.Items = []*domPattern{n}
			if s, ok := o["separator"]; ok {
				n, e = decodePattern(s, true, depth+1)
				if e != nil {
					return nil, e
				}
				p.Items = append(p.Items, n)
			}
			return p, nil
		}
	}
	return nil, fmt.Errorf("a malformed pattern")
}
func (w *jsonWriter) pattern(p *domPattern) {
	w.raw(`{"` + p.Kind + `":`)
	switch p.Kind {
	case "name", "terminal", "constant":
		w.str(p.Name)
		w.raw(`,"at":`)
		w.pair(p.At)
	case "siblings":
		w.raw("true")
	case "test":
		w.str(p.Op)
		w.raw(`,"value":`)
		p.Value.writeJSON(w)
		w.raw(`,"expr":`)
		w.pattern(p.Items[0])
	case "path":
		w.str(p.Name)
		w.raw(`,"pattern":`)
		w.pattern(p.Items[0])
	case tmUnion, tmIntersection, tmDifference, "sequence":
		w.raw("[")
		for i, n := range p.Items {
			if i > 0 {
				w.raw(",")
			}
			w.pattern(n)
		}
		w.raw("]")
	default:
		w.pattern(p.Items[0])
		if p.Kind == "repeat" && len(p.Items) == 2 {
			w.raw(`,"separator":`)
			w.pattern(p.Items[1])
		}
	}
	w.raw("}")
}
func patternKey(p *domPattern) string {
	copy := *p
	copy.At = [2]int{}
	copy.Items = make([]*domPattern, len(p.Items))
	for i, n := range p.Items {
		copy.Items[i] = patternKeyCopy(n)
	}
	var w jsonWriter
	w.pattern(&copy)
	return string(w.buf)
}
func patternKeyCopy(p *domPattern) *domPattern {
	n := *p
	n.At = [2]int{}
	n.Items = make([]*domPattern, len(p.Items))
	for i, c := range p.Items {
		n.Items[i] = patternKeyCopy(c)
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
	case "children":
		n := m.sequence(p.Items[0])
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
			for i, c := range p.Items {
				t := b
				if i < len(p.Items)-1 {
					t = state()
				}
				build(c, a, t)
				a = t
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
func patternLeafTest(p *domPattern, sound string, tags *tagset) bool {
	v := p.Value
	if isSoundTest(p.Op) {
		return (sound == v.Str) == (p.Op == "=")
	}

	in := newInterner()
	var names []string
	todo := []*domTerm{v}
	for len(todo) > 0 {
		t := todo[len(todo)-1]
		todo = todo[:len(todo)-1]
		if t.Kind == tmTag {
			names = append(names, t.Str)
		} else if t.Kind == tmUnion {
			todo = append(todo, t.Items...)
		}
	}
	set := in.fromList(names)
	switch p.Op {
	case "⊇":
		return subset(set, tags)
	case "⊉":
		return !subset(set, tags)
	case "∩≠∅":
		return len(in.intersection(set, tags).names) > 0
	default:
		return len(in.intersection(set, tags).names) == 0
	}
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
			holds = tags != nil && terminal == p.Items[0].Name && patternLeafTest(p, sound, tags)
		case "children":
			n := m.machines[pr.machine]
			holds = s.relations[pr.machine][n.start].Bit(n.end) != 0
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
		if (p.Kind == "name" || p.Kind == "terminal" || p.Kind == "test" || p.Kind == "children") && s.count == 1 {
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

// readPattern uses postorder frames so syntax wrappers do not consume the
// semantic nesting bound or the Go call stack.
func (b *domBuilder) readPattern(root *Node) *domPattern {
	type pending struct {
		n     *Node
		ready bool
	}
	stack := []pending{{root, false}}
	values := map[*Node]*domPattern{}
	for len(stack) > 0 {
		e := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		n := e.n
		var children []*Node
		switch n.Rule {
		case "pattern-union":
			children = ofRule(n, "pattern-intersection")
		case "pattern-intersection":
			children = ofRule(n, "pattern-sequence")
		case "pattern-sequence":
			children = ofRule(n, "pattern-item")
		case "pattern-item":
			for _, c := range parts(n) {
				if c.Kind != KindToken {
					children = append(children, c)
				}
			}
		case "pattern-brackets", "pattern-repeat":
			children = ofRule(n, "pattern-union")
		case "pattern-path":
			children = ofRule(n, "pattern-atom")
		case "pattern-atom":
			xs := parts(n)
			if len(xs) == 0 {
				b.fail(n, "a malformed pattern atom")
			}
			first := xs[0]
			if first.Kind == KindToken && b.text(first) == "(" {
				children = ofRule(n, "pattern-union")
			} else if first.Rule == "pattern-literal" {
				children = ofRule(first, "pattern-union")
			}
		default:
			b.fail(n, "unexpected %s in a pattern", n.Rule)
		}
		if !e.ready {
			stack = append(stack, pending{n, true})
			for i := len(children) - 1; i >= 0; i-- {
				stack = append(stack, pending{children[i], false})
			}
			continue
		}
		xs := make([]*domPattern, len(children))
		for i, c := range children {
			xs[i] = values[c]
			delete(values, c)
		}
		var result *domPattern
		switch n.Rule {
		case "pattern-union", "pattern-intersection":
			if len(xs) == 1 {
				result = xs[0]
			} else {
				p := patternNode(xs[0])
				var ops []string
				for _, t := range parts(n) {
					if t.Kind == KindToken {
						ops = append(ops, b.text(t))
					}
				}
				for i, x := range xs[1:] {
					kind := tmUnion
					if n.Rule == "pattern-intersection" {
						kind = tmIntersection
					} else if i < len(ops) && ops[i] == "∖" {
						kind = tmDifference
					}
					p = &domPattern{Kind: kind, Items: []*domPattern{p, patternNode(x)}}
					if msg := patternProblem(p, 0, nil); msg != "" {
						b.fail(n, "%s", msg)
					}
				}
				result = patternChildren(p)
			}
		case "pattern-sequence":
			var flat []*domPattern
			for _, c := range xs {
				if c.Kind == "sequence" {
					flat = append(flat, c.Items...)
				} else {
					flat = append(flat, c)
				}
			}
			if len(flat) == 1 {
				result = flat[0]
			} else {
				result = &domPattern{Kind: "sequence", Items: flat}
			}
		case "pattern-item":
			if len(xs) == 0 {
				result = &domPattern{Kind: "siblings"}
			} else {
				result = xs[0]
			}
		case "pattern-atom":
			first := parts(n)[0]
			if len(xs) > 0 {
				result = xs[0]
				if first.Rule == "pattern-literal" {
					result = patternChildren(patternNode(result))
				}
			} else if first.Kind == KindToken {
				name := b.text(first)
				kind := "name"
				if isCapital(name) {
					kind = "terminal"
				}
				p := &domPattern{Kind: kind, Name: name, At: b.at(first)}
				if t := one(n, "test"); t != nil {
					if kind != "terminal" {
						b.fail(t, "a pattern test requires one terminal atom")
					}
					operand := b.only(t, "test-operand")
					if firstOfRule(operand, "pattern-literal") != nil {
						b.fail(operand, "a symbol test cannot read a pattern")
					}
					before := b.closedFor
					b.closedFor = "a test's operand"
					v := b.term(operand)
					b.closedFor = before
					ty, msg := b.typeOf(v)
					if msg == "" {
						msg = testTypeProblem(b.comparator(t), ty)
					}
					if msg != "" {
						b.fail(operand, "%s", msg)
					}
					if isSoundTest(b.comparator(t)) && v.Kind == tmString {
						if msg := soundProblem(v.Str, b.uni); msg != "" {
							b.fail(operand, "%s", msg)
						}
					}
					p = &domPattern{Kind: "test", Op: b.comparator(t), Value: v, Items: []*domPattern{p}}
				}
				result = patternChildren(p)
			} else if first.Rule == "constant-reference" {
				result = patternChildren(&domPattern{Kind: "constant", Name: strings.TrimPrefix(b.text(b.token(first)), "$"), At: b.at(first)})
			} else {
				b.fail(n, "a malformed pattern atom")
			}
		case "pattern-brackets":
			result = &domPattern{Kind: "optional", Items: xs}
		case "pattern-repeat":
			result = &domPattern{Kind: "repeat", Items: xs}
		case "pattern-path":
			// The direct operator token can follow the named atom.
			operator := b.text(b.token(n))
			name := map[string]string{"⋮": "descendant", "⋰": "first", "⋱": "last"}[operator]
			result = patternChildren(&domPattern{Kind: "path", Name: name, Items: []*domPattern{patternNode(xs[0])}})
		}
		if msg := patternProblem(patternNode(result), 0, nil); msg != "" {
			b.fail(n, "%s", msg)
		}
		values[n] = result
	}
	return values[root]
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
	if p.Kind == "constant" {
		return g.constants[p.Name].value.pattern, nil
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
	if p.Kind == "test" {
		v, err := g.evaluateClosed(doc, p.Value, at)
		if err != nil {
			return nil, err
		}
		if isSoundTest(p.Op) {
			if msg := soundProblem(v.s, g.uni); msg != "" {
				return nil, g.faultError(doc, p.Value, at, msg)
			}
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
		return &domPattern{Kind: t.Kind, Items: xs}
	}
}
func (r *resolver) pattern(p *domPattern) *domPattern {
	if p.Kind == "constant" {
		return r.constants[p.Name].value.pattern
	}
	n := *p
	n.Items = make([]*domPattern, len(p.Items))
	for i, c := range p.Items {
		n.Items[i] = r.pattern(c)
	}
	if p.Kind == "test" {
		g := &stageGrammar{constants: r.constants, uni: r.uni}
		v, err := g.evaluateClosed("", p.Value, [2]int{})
		if err != nil {
			panic(err)
		}
		n.Value = patternLiteral(v)
	}
	return &n
}

func (r *recognizer) preparePatterns() {
	run := r.run
	if m, ok := run.patternMachines[r.g]; ok {
		r.machine = m
	} else {
		var roots []*domPattern
		scan := func(p clausePart) bool {
			if p.c != nil && (p.c.Op == "≅" || p.c.Op == "≇") {
				roots = append(roots, p.c.Right.Pattern)
			}
			return true
		}
		for _, p := range r.g.prods {
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
		for _, p := range r.g.prods {
			for _, c := range p.privateConds {
				walkClause(clausePart{c: c}, scan)
			}
			if p.contextual {
				for _, term := range []*domTerm{p.slot.source.alt.Tags, p.slot.source.ruleTags} {
					walkClause(clausePart{t: term}, scan)
				}
			}
		}
		if len(r.g.rankedHelpers) > 0 || len(roots) > 0 || r.g.stage != nil && r.g.stage.preferences != nil && len(r.g.stage.preferences.paths) > 0 {
			r.machine = newPatternMachine(roots)
		}
		if run.patternMachines == nil {
			run.patternMachines = map[*lowered]*patternMachine{}
		}
		run.patternMachines[r.g] = r.machine
	}
	if r.machine == nil {
		return
	}
	r.elidableHeads = map[int32]string{}
	for _, p := range r.g.prods {
		if p.restoration() {
			r.elidableHeads[p.lhs] = p.elided
		}
	}
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
