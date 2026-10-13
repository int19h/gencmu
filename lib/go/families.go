package gencmu

import (
	"math/big"
	"strings"
)

func isRestorationMethod(name string) bool {
	return name == "without-elision" || name == "without-elision-except"
}

// Family membership reads written alternatives, before any helper expansion.
func (g *stageGrammar) resolveFamilies() {
	for name := range g.families {
		members := map[string]bool{name: true}
		pending := []string{name}
		for at := 0; at < len(pending); at++ {
			for _, a := range g.byName[pending[at]].alts {
				stack := []*domExpr{a.alt.Expr}
				for len(stack) > 0 {
					e := stack[len(stack)-1]
					stack = stack[:len(stack)-1]
					if e == nil {
						continue
					}
					switch e.Kind {
					case exCapture, exTest:
						stack = append(stack, e.Inner)
					case exChoice:
						for i := len(e.Items) - 1; i >= 0; i-- {
							stack = append(stack, e.Items[i])
						}
					case exRef:
						if !isTerminalName(e.Name) && !members[e.Name] {
							members[e.Name] = true
							pending = append(pending, e.Name)
						}
					}
				}
			}
		}
		g.families[name] = members
	}
}

// Summaries never retain permission-marked records. Zero denotes the identity
// relation of an empty item, and one denotes a dead observation. Other states
// contain boundary sets or an empty item's relation, interned by their values.
type familySummary struct {
	start, end *big.Int
	rows       []*big.Int
}
type familyRecord struct {
	event     closeEvent
	permitted bool
}
type familyArena struct {
	closes    *closeArena
	a, b      int
	members   map[string]bool
	groups    map[int][]closeEvent
	summaries []familySummary
	ids       map[string]int
	records   map[familyRecord]int
	taken     map[int]bool
}

func newFamilyArena(closes *closeArena, candidate, a, b int, members map[string]bool) *familyArena {
	f := &familyArena{closes: closes, a: a, b: b, members: members, groups: map[int][]closeEvent{},
		summaries: []familySummary{{}, {}}, ids: map[string]int{}, records: map[familyRecord]int{}, taken: map[int]bool{}}
	// The candidate's sequence is unmarked. Its own records alone define the
	// automata, independently of how many records a witness can produce.
	stack := []int{closes.semantic(candidate)}
	for len(stack) > 0 {
		id := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if id == 0 {
			continue
		}
		n := closes.links[id]
		if n.leaf {
			f.groups[n.event.record.At] = append(f.groups[n.event.record.At], n.event)
		} else {
			stack = append(stack, n.right, n.left)
		}
	}
	return f
}
func familyBit(i int) *big.Int        { return new(big.Int).SetBit(new(big.Int), i, 1) }
func (f *familyArena) size(p int) int { return 2 * (len(f.groups[p]) + 1) }
func (f *familyArena) accept(p int, final bool) *big.Int {
	n := len(f.groups[p])
	if final && n > 0 {
		last := f.groups[p][n-1]
		if last.block != nil && last.end > p {
			n--
		}
	}
	out := familyBit(2 * n)
	if !final {
		out.SetBit(out, 2*n+1, 1)
	}
	return out
}
func (f *familyArena) taking(id int) {
	if !f.taken[id] {
		f.taken[id] = true
		if w := work.Load(); w != nil {
			w.familySummaries.add("family summaries")
		}
	}
}
func familySteps(n int) {
	if w := work.Load(); w != nil {
		w.familySteps.addN(int64(n), "family steps")
	}
}
func (f *familyArena) intern(s familySummary) int {
	var key strings.Builder
	if s.rows != nil {
		key.WriteByte('r')
		for _, row := range s.rows {
			key.WriteString(row.Text(16))
			key.WriteByte('/')
		}
	} else {
		key.WriteByte('s')
		key.WriteString(s.start.Text(16))
		key.WriteByte('/')
		key.WriteString(s.end.Text(16))
	}
	k := key.String()
	if id, ok := f.ids[k]; ok {
		return id
	}
	id := len(f.summaries)
	f.ids[k] = id
	f.summaries = append(f.summaries, s)
	return id
}
func (f *familyArena) image(rows []*big.Int, input *big.Int) *big.Int {
	if rows == nil {
		return input
	}
	out := new(big.Int)
	familySteps(len(rows))
	for i, row := range rows {
		if input.Bit(i) != 0 {
			out.Or(out, row)
		}
	}
	return out
}
func (f *familyArena) preimage(rows []*big.Int, output *big.Int) *big.Int {
	if rows == nil {
		return output
	}
	out := new(big.Int)
	familySteps(len(rows))
	for i, row := range rows {
		if new(big.Int).And(row, output).Sign() != 0 {
			out.SetBit(out, i, 1)
		}
	}
	return out
}
func (f *familyArena) token(a, b int) int {
	if a == b {
		return 0
	}
	return f.intern(familySummary{start: f.accept(a, a >= f.b), end: familyBit(0)})
}
func equalFamilyRecord(a, b closeEvent) bool {
	if a.block != nil || b.block != nil {
		return a.block == b.block && a.record.At == b.record.At && a.end == b.end && a.entry == b.entry
	}
	return a.record.At == b.record.At && a.record.Terminal == b.record.Terminal
}
func (f *familyArena) record(event closeEvent, permitted bool) int {
	p := event.record.At
	if p > f.b || event.block != nil && p == f.b && event.end > p {
		return 0
	}
	if event.block != nil && p < f.b && event.end > f.b {
		return 1
	}
	event.record = Restoration{Terminal: event.record.Terminal, At: p}
	key := familyRecord{event, permitted}
	if id, ok := f.records[key]; ok {
		return id
	}
	size := f.size(p)
	rows := make([]*big.Int, size)
	familySteps(size)
	for state := 0; state < size; state++ {
		i := state / 2
		row := new(big.Int)
		if i < len(f.groups[p]) && equalFamilyRecord(event, f.groups[p][i]) {
			row.SetBit(row, 2*(i+1), 1)
		}
		if event.block == nil && permitted && (i > 0 || p > f.a) {
			row.SetBit(row, 2*i+1, 1)
		}
		rows[state] = row
	}
	id := f.intern(familySummary{rows: rows})
	f.records[key] = id
	return id
}
func (f *familyArena) join(left, right, a, p, b int) int {
	if left == 1 || right == 1 {
		return 1
	}
	l, r := f.summaries[left], f.summaries[right]
	switch {
	case a == p && p == b:
		if left == 0 {
			return right
		}
		if right == 0 {
			return left
		}
		rows := make([]*big.Int, len(l.rows))
		for i, row := range l.rows {
			rows[i] = f.image(r.rows, row)
		}
		return f.intern(familySummary{rows: rows})
	case a == p:
		return f.intern(familySummary{start: f.preimage(l.rows, r.start), end: r.end})
	case p == b:
		return f.intern(familySummary{start: l.start, end: f.image(r.rows, l.end)})
	default:
		if new(big.Int).And(l.end, r.start).Sign() == 0 {
			return 1
		}
		return f.intern(familySummary{start: l.start, end: r.end})
	}
}
func (f *familyArena) matches(id, a, b int) bool {
	if id == 1 {
		return false
	}
	s := f.summaries[id]
	if a == b {
		return new(big.Int).And(f.image(s.rows, familyBit(0)), f.accept(a, true)).Sign() != 0
	}
	return s.start.Bit(0) != 0 && (b > f.b || new(big.Int).And(s.end, f.accept(b, true)).Sign() != 0)
}
