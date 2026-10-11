package gencmu

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// Close observations share canonical parent/event links. A state combines
// that sequence with the named occurrences over its own original span.
// Smaller spans cannot repeat a later ancestor, so they leave the context.
type closeEvent struct {
	record Restoration
	block  *rankedGroup
	end    int
	entry  string
}

type closeLink struct {
	parent   int
	event    closeEvent
	depth    int
	semantic int
}

type closeLinkKey struct {
	parent int
	event  closeEvent
}

type closeState struct {
	sequence, context int
}

type closeArena struct {
	links      []closeLink
	linkIDs    map[closeLinkKey]int
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
		links: []closeLink{{}}, linkIDs: map[closeLinkKey]int{},
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

func (m *closeArena) append(sequence int, event closeEvent) int {
	k := closeLinkKey{sequence, event}
	if id, ok := m.linkIDs[k]; ok {
		return id
	}
	id := len(m.links)
	m.links = append(m.links, closeLink{parent: sequence, event: event, depth: m.links[sequence].depth + 1})
	m.linkIDs[k] = id
	normal := event
	normal.record = Restoration{Terminal: event.record.Terminal, At: event.record.At}
	parent := m.links[sequence].semantic
	semantic := id
	if normal != event || parent != sequence {
		semantic = m.append(parent, normal)
	}
	m.links[id].semantic = semantic
	if w := work.Load(); w != nil {
		w.closeLinks.add("close links")
	}
	return id
}

func (m *closeArena) semantic(state int) int {
	if state == invalidCloses {
		return 0
	}
	return m.links[m.states[state].sequence].semantic
}

// concat keeps no flattened copy of either prefix. The temporary reverse
// path ends when the operation ends, and its result uses canonical links.
func (m *closeArena) concat(a, b int) int {
	if a == 0 {
		return b
	}
	if b == 0 {
		return a
	}
	k := [2]int{a, b}
	if id, ok := m.concatIDs[k]; ok {
		return id
	}
	var path []int
	for id := b; id != 0; id = m.links[id].parent {
		path = append(path, id)
	}
	sequence := a
	for i := len(path) - 1; i >= 0; i-- {
		sequence = m.append(sequence, m.links[path[i]].event)
	}
	m.concatIDs[k] = sequence
	return sequence
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
	wanted := false
	scan := func(p clausePart) bool {
		if p.t != nil && p.t.Kind == tmCall && p.t.Str == "without-elision" {
			wanted = true
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
		if p.contextual {
			for _, c := range p.slot.source.conds {
				walkClause(clausePart{c: c}, scan)
			}
			walkClause(clausePart{t: p.slot.source.alt.Tags}, scan)
			walkClause(clausePart{t: p.slot.source.ruleTags}, scan)
		}
	}
	var m *closeArena
	if wanted {
		m = newCloseArena()
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

func (r *recognizer) finishCloses(key *itemKey, end int32) {
	if r.closes == nil || int(key.dot) != len(key.prod.rhs) {
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
	if n.prod != nil && n.prod.ranked != nil {
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
func (m *closeArena) aligned(candidate, witness int, end int) bool {
	if candidate == invalidCloses || witness == invalidCloses {
		return false
	}
	through := func(state int) ([]int, bool) {
		var out []int
		for id := m.states[state].sequence; id != 0; id = m.links[id].parent {
			e := m.links[id].event
			if e.block != nil && e.record.At < end && end < e.end {
				return nil, false
			}
			if e.record.At > end || e.block != nil && e.record.At == end && e.end > end {
				continue
			}
			out = append(out, id)
		}
		return out, true
	}
	a, ok := through(candidate)
	if !ok {
		return false
	}
	b, ok := through(witness)
	if !ok || len(a) != len(b) {
		return false
	}
	for i := range a {
		x, y := m.links[a[i]].event, m.links[b[i]].event
		if x.record.Terminal != y.record.Terminal || x.record.At != y.record.At || x.block != y.block || x.end != y.end || x.entry != y.entry {
			return false
		}
	}
	return true
}
