package gencmu

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// Close observations share leaves and concatenations. A state combines
// that sequence with the named occurrences over its own original span.
// Smaller spans cannot repeat a later ancestor, so they leave the context.
type closeEvent struct {
	record Restoration
	block  *rankedGroup
	end    int
	entry  string
}

type closeLink struct {
	left, right         int
	event               closeEvent
	leaf                bool
	height              int
	length, hash, power uint64
	min, max            int
	semantic            int
}

type closeState struct {
	sequence, context int
}

type closeArena struct {
	links      []closeLink
	leaves     map[closeEvent]int
	buckets    map[[2]uint64][]int
	prefixes   map[[2]int]int
	rules      map[int32]bool
	states     []closeState
	stateIDs   map[closeState]int
	contexts   [][]int32
	contextIDs map[string]int
	concatIDs  map[[2]int]int
}

// State 1 is the shared invalid observation. Its chart edges still exist
// for ordinary finite proofs and original written-priority blockers.
const invalidCloses = 1

func newCloseArena() *closeArena {
	return &closeArena{
		links: []closeLink{{power: 1}}, leaves: map[closeEvent]int{},
		buckets: map[[2]uint64][]int{}, prefixes: map[[2]int]int{},
		states: []closeState{{}, {}}, stateIDs: map[closeState]int{{}: 0},
		contexts: [][]int32{nil}, contextIDs: map[string]int{"": 0},
		concatIDs: map[[2]int]int{},
	}
}

func (m *closeArena) state(sequence, context int) int {
	s := closeState{sequence, context}
	if id, ok := m.stateIDs[s]; ok {
		return id
	}
	id := len(m.states)
	m.states = append(m.states, s)
	m.stateIDs[s] = id
	if w := work.Load(); w != nil {
		w.closeStates.add("close states")
	}
	return id
}

// Shared leaves and concatenations keep storage proportional to chart
// structure. Fingerprints filter candidates, and equality uses exact nodes.
func (m *closeArena) equal(a, b int) bool {
	left, right := []int{a}, []int{b}
	for len(left) > 0 && len(right) > 0 {
		x, y := left[len(left)-1], right[len(right)-1]
		left, right = left[:len(left)-1], right[:len(right)-1]
		if x == y {
			continue
		}
		one, two := m.links[x], m.links[y]
		if one.leaf && two.leaf {
			if one.event != two.event {
				return false
			}
			continue
		}
		if !one.leaf && (two.leaf || one.height >= two.height) {
			left = append(left, one.right, one.left)
			right = append(right, y)
		} else {
			left = append(left, x)
			right = append(right, two.right, two.left)
		}
	}
	return len(left) == 0 && len(right) == 0
}

func (m *closeArena) store(node closeLink) int {
	if w := work.Load(); w != nil {
		w.closeLinks.add("close links")
	}
	key := [2]uint64{node.length, node.hash}
	id := len(m.links)
	m.links = append(m.links, node)
	for _, old := range m.buckets[key] {
		if m.equal(id, old) {
			m.links = m.links[:id]
			return old
		}
	}
	m.buckets[key] = append(m.buckets[key], id)
	return id
}

func (m *closeArena) leaf(event closeEvent) int {
	if id, ok := m.leaves[event]; ok {
		return id
	}
	end := event.record.At
	if event.block != nil {
		end = event.end
	}
	id := m.store(closeLink{event: event, leaf: true, height: 1, length: 1,
		hash: uint64(len(m.links)), power: 1099511628211, min: event.record.At, max: end})
	m.leaves[event] = id
	normal := event
	normal.record = Restoration{Terminal: event.record.Terminal, At: event.record.At}
	semantic := id
	if normal != event {
		semantic = m.leaf(normal)
	}
	m.links[id].semantic = semantic
	return id
}

func (m *closeArena) append(sequence int, event closeEvent) int {
	return m.concat(sequence, m.leaf(event))
}

func (m *closeArena) semantic(state int) int {
	if state == invalidCloses {
		return 0
	}
	return m.links[m.states[state].sequence].semantic
}

func (m *closeArena) concat(a, b int) int {
	if a == 0 {
		return b
	}
	if b == 0 {
		return a
	}
	key := [2]int{a, b}
	if id, ok := m.concatIDs[key]; ok {
		return id
	}
	x, y := m.links[a], m.links[b]
	node := closeLink{left: a, right: b, height: max(x.height, y.height) + 1,
		length: x.length + y.length, hash: x.hash*y.power + y.hash, power: x.power * y.power,
		min: min(x.min, y.min), max: max(x.max, y.max)}
	id := m.store(node)
	m.concatIDs[key] = id
	semantic := id
	if x.semantic != a || y.semantic != b {
		semantic = m.concat(x.semantic, y.semantic)
	}
	m.links[id].semantic = semantic
	return id
}

func (m *closeArena) context(rules []int32) int {
	if len(rules) == 0 {
		return 0
	}
	var key strings.Builder
	for _, r := range rules {
		key.WriteString(strconv.Itoa(int(r)))
		key.WriteByte('/')
	}
	k := key.String()
	if id, ok := m.contextIDs[k]; ok {
		return id
	}
	id := len(m.contexts)
	m.contexts = append(m.contexts, append([]int32(nil), rules...))
	m.contextIDs[k] = id
	if w := work.Load(); w != nil {
		w.closeContexts.add("close contexts")
	}
	return id
}

func mergeCloseRules(a, b []int32) []int32 {
	out := make([]int32, 0, len(a)+len(b))
	for i, j := 0, 0; i < len(a) || j < len(b); {
		switch {
		case j == len(b) || i < len(a) && a[i] < b[j]:
			out = append(out, a[i])
			i++
		case i == len(a) || b[j] < a[i]:
			out = append(out, b[j])
			j++
		default:
			out = append(out, a[i])
			i++
			j++
		}
	}
	return out
}

func (m *closeArena) join(a, b int, keepA, keepB bool) int {
	if a == invalidCloses || b == invalidCloses {
		return invalidCloses
	}
	x, y := m.states[a], m.states[b]
	var left, right []int32
	if keepA {
		left = m.contexts[x.context]
	}
	if keepB {
		right = m.contexts[y.context]
	}
	return m.state(m.concat(x.sequence, y.sequence), m.context(mergeCloseRules(left, right)))
}

func (m *closeArena) named(state int, rule int32) int {
	if state == invalidCloses {
		return state
	}
	s := m.states[state]
	xs := m.contexts[s.context]
	i := sort.Search(len(xs), func(i int) bool { return xs[i] >= rule })
	if i < len(xs) && xs[i] == rule {
		return invalidCloses
	}
	return m.state(s.sequence, m.context(mergeCloseRules(xs, []int32{rule})))
}

func (m *closeArena) event(state int, event closeEvent) int {
	if state == invalidCloses {
		return state
	}
	s := m.states[state]
	return m.state(m.append(s.sequence, event), s.context)
}

// seal hides events, but retains cycle ancestry and invalidity.
func (m *closeArena) seal(state int, event closeEvent) int {
	if state == invalidCloses {
		return state
	}
	return m.state(m.append(0, event), m.states[state].context)
}

func (run *stageRun) closeArena(g *lowered) *closeArena {
	if run.closeArenas == nil {
		run.closeArenas = map[*lowered]*closeArena{}
	}
	if m, known := run.closeArenas[g]; known {
		return m
	}
	rules := demandedCloses(g)
	var m *closeArena
	if len(rules) > 0 {
		m = newCloseArena()
		m.rules = rules
	}
	run.closeArenas[g] = m
	return m
}

func (r *recognizer) closeRecord(terminal string, at int, test *symTest) Restoration {
	record := Restoration{Terminal: terminal, At: at, Source: r.run.emptySource(at)}
	if test != nil && test.op == "=" {
		record.Sound, record.Tested = test.sound, true
	}
	return record
}

func (r *recognizer) observesCloses(rule int32) bool {
	return r.closes != nil && (r.closes.rules == nil || r.closes.rules[rule])
}

func (r *recognizer) finishCloses(key *itemKey, end int32) {
	if !r.observesCloses(key.prod.lhs) {
		key.closes = 0
		return
	}
	if int(key.dot) != len(key.prod.rhs) {
		return
	}
	p := key.prod
	a, _ := r.observed(key.origin, end)
	if p.restoration() {
		key.closes = r.closes.event(key.closes, closeEvent{record: r.closeRecord(p.elided, a, p.elidedTest)})
	}
	if !p.helper && (r.recon != nil || r.g.rules[p.lhs].scc >= 0) {
		key.closes = r.closes.named(key.closes, p.lhs)
	}
}

func (r *recognizer) terminalCloses(k int, terminal string) int {
	if r.closes == nil || r.recon == nil || !r.recon.synthetic[k] {
		return 0
	}
	record := r.recon.records[r.recon.record[k]]
	record.Terminal = terminal
	return r.closes.event(0, closeEvent{record: record})
}

func (r *recognizer) derivationCloses(n *dn) int {
	if r.closes == nil {
		return 0
	}
	if n.kind == dRead {
		return r.terminalCloses(int(n.tok), r.g.terminals[n.term])
	}
	if n.prod != nil && n.prod.ranked != nil && r.observesCloses(n.prod.lhs) {
		return r.closes.seal(n.closes, r.blockEvent(&symNode{rule: n.prod.lhs, lexical: n.prod.lexical, start: n.start, end: n.end}))
	}
	return n.closes
}

func (r *recognizer) blockEvent(c *symNode) closeEvent {
	a, b := r.observed(c.start, c.end)
	entry := ""
	if f := c.lexical; f != nil {
		names := make([]string, 0, len(f.captures))
		for n := range f.captures {
			names = append(names, n)
		}
		sort.Strings(names)
		var key strings.Builder
		origin, _ := r.observed(f.origin, f.origin)
		fmt.Fprintf(&key, "%q:%d:%d:%d:%q/", f.root.ruleName, origin, f.prefix, r.closes.semantic(f.closes), f.closeRoute)
		for _, n := range names {
			cv := f.captures[n]
			x, y := r.observed(cv.start, cv.end)
			sequence := r.closes.semantic(cv.closes)
			fmt.Fprintf(&key, "%q:%d:%d:%q:%d:%d/", n, x, y, r.run.ps.in.all[cv.tags].key, cv.structure, sequence)
		}
		entry = key.String()
	}
	return closeEvent{record: Restoration{At: a}, block: r.g.rankedHelpers[c.rule], end: b, entry: entry}
}

// aligned compares complete groups through the shared original boundary.
// Positive-width blocks starting at that boundary lie beyond a prefix.
func (m *closeArena) through(id, end int) int {
	stack := []int{id}
	for len(stack) > 0 {
		at := stack[len(stack)-1]
		key := [2]int{at, end}
		if _, ok := m.prefixes[key]; ok {
			stack = stack[:len(stack)-1]
			continue
		}
		node := m.links[at]
		switch {
		case at == 0 || node.min > end:
			m.prefixes[key] = 0
		case node.max <= end:
			m.prefixes[key] = at
		case node.leaf:
			if node.min < end {
				m.prefixes[key] = -1
			} else {
				m.prefixes[key] = 0
			}
		default:
			a, aok := m.prefixes[[2]int{node.left, end}]
			b, bok := m.prefixes[[2]int{node.right, end}]
			if !aok {
				stack = append(stack, node.left)
			} else if !bok {
				stack = append(stack, node.right)
			} else if a < 0 || b < 0 {
				m.prefixes[key] = -1
			} else {
				m.prefixes[key] = m.concat(a, b)
			}
		}
	}
	return m.prefixes[[2]int{id, end}]
}

func (m *closeArena) aligned(candidate, witness, end int) bool {
	if candidate == invalidCloses || witness == invalidCloses {
		return false
	}
	a, b := m.through(m.semantic(candidate), end), m.through(m.semantic(witness), end)
	return a >= 0 && b >= 0 && a == b
}

func demandedCloses(g *lowered) map[int32]bool {
	wanted, seen := map[int32]bool{}, map[int32]bool{}
	pending := []int32{g.byName["text"]}
	for len(pending) > 0 {
		rule := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		if seen[rule] {
			continue
		}
		seen[rule] = true
		for _, p := range g.rules[rule].prods {
			for _, s := range p.rhs {
				if !s.term {
					pending = append(pending, s.id)
				}
			}
			uses := func(t *domTerm) bool {
				found := false
				walkClause(clausePart{t: t}, func(n clausePart) bool {
					if n.t != nil && n.t.Kind == tmCall && n.t.Str == "without-elision" {
						found = true
					}
					return true
				})
				return found
			}
			scan := func(n clausePart) bool {
				var span *domTerm
				var target string
				if n.c != nil && (n.c.Kind == cdMatches || n.c.Kind == cdBegins) {
					span, target = n.c.Span, n.c.Rule
				}
				if n.t != nil && n.t.Kind == tmCall && n.t.Str == "tags" && len(n.t.Items) == 2 {
					span, target = n.t.Items[0], n.t.Items[1].Str
				}
				if target != "" {
					if id, ok := g.byName[target]; ok {
						pending = append(pending, id)
						if uses(span) {
							wanted[id] = true
						}
					}
				}
				if n.t != nil && n.t.Kind == tmCall && n.t.Str == "without-elision" {
					name := n.t.Items[0].Str
					at, ok := p.posOf[name]
					if name == "" || !ok || p.contextual {
						wanted[p.lhs] = true
						wanted[g.byName[p.ruleName]] = true
					} else if !p.rhs[at].term {
						wanted[p.rhs[at].id] = true
					}
				}
				return true
			}
			for _, c := range p.conds {
				walkClause(clausePart{c: c.cond}, scan)
			}
			for _, c := range p.predictConds {
				walkClause(clausePart{c: c}, scan)
			}
			walkClause(clausePart{t: p.tags}, scan)
			walkClause(clausePart{t: p.parentTags}, scan)
			if p.emit != nil {
				for _, e := range p.emit.Items {
					walkClause(clausePart{t: e.Tags}, scan)
				}
			}
			if p.slot != nil {
				for _, c := range p.slot.source.conds {
					walkClause(clausePart{c: c}, scan)
				}
				walkClause(clausePart{t: p.slot.source.alt.Tags}, scan)
				walkClause(clausePart{t: p.slot.source.ruleTags}, scan)
			}
		}
	}
	for rule := range wanted {
		pending = append(pending, rule)
	}
	for len(pending) > 0 {
		rule := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		for _, p := range g.rules[rule].prods {
			for _, s := range p.rhs {
				if !s.term && !wanted[s.id] {
					wanted[s.id] = true
					pending = append(pending, s.id)
				}
			}
		}
	}
	return wanted
}
