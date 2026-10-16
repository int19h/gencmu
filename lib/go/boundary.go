package gencmu

import "strings"

func boundaryMethod(name string) bool { return name == "followed-by" || name == "preceded-by" }

// boundaryBits is an immutable, unbounded bit set. Trailing zero bytes are absent.
type boundaryBits string

func boundaryBit(i int) boundaryBits {
	b := make([]byte, i/8+1)
	b[i/8] = 1 << uint(i%8)
	return boundaryBits(b)
}
func (a boundaryBits) has(i int) bool { return i/8 < len(a) && a[i/8]&(1<<uint(i%8)) != 0 }
func (a boundaryBits) union(b boundaryBits) boundaryBits {
	if a == "" {
		return b
	}
	if b == "" || a == b {
		return a
	}
	c := make([]byte, max(len(a), len(b)))
	for i := range c {
		if i < len(a) {
			c[i] |= a[i]
		}
		if i < len(b) {
			c[i] |= b[i]
		}
	}
	return boundaryBits(c)
}
func (a boundaryBits) intersect(b boundaryBits) boundaryBits {
	c := make([]byte, min(len(a), len(b)))
	for i := range c {
		c[i] = a[i] & b[i]
	}
	return boundaryBits(strings.TrimRight(string(c), "\x00"))
}
func (a boundaryBits) without(b boundaryBits) boundaryBits {
	c := []byte(a)
	for i := range c {
		if i < len(b) {
			c[i] &= ^b[i]
		}
	}
	return boundaryBits(strings.TrimRight(string(c), "\x00"))
}
func (a boundaryBits) subset(b boundaryBits) bool { return a.without(b) == "" }

type boundaryLiteral struct {
	id                int
	bit, target       boundaryBits
	forward, positive bool
}
type boundaryShape struct {
	empty                   bool
	start, first, end, last boundaryBits
}
type boundaryRecord struct {
	boundaryShape
	id int
}
type boundaryMachine struct {
	names             map[string]boundaryBits
	forward, backward boundaryBits
	literals          []*boundaryLiteral
	atoms             map[*domCond][2]*boundaryLiteral
	records           map[boundaryShape]*boundaryRecord
	empty             *boundaryRecord
}

func boundaryAtoms(p clausePart) []*domCond {
	var out []*domCond
	walkClause(p, func(q clausePart) bool {
		if q.c != nil && q.c.Kind == cdBoundary {
			out = append(out, q.c)
			return false
		}
		return true
	})
	return out
}
func firstBoundaryAtom(c *domCond) *domCond {
	atoms := boundaryAtoms(clausePart{c: c})
	if len(atoms) > 0 {
		return atoms[0]
	}
	return nil
}
func (m *boundaryMachine) name(s string) boundaryBits {
	b, ok := m.names[s]
	if !ok {
		b = boundaryBit(len(m.names))
		m.names[s] = b
	}
	return b
}
func (m *boundaryMachine) intern(s boundaryShape) *boundaryRecord {
	if old := m.records[s]; old != nil {
		return old
	}
	r := &boundaryRecord{s, len(m.records)}
	m.records[s] = r
	return r
}
func newBoundaryMachine(g *lowered) *boundaryMachine {
	g.boundaryOnce.Do(func() {
		m := &boundaryMachine{names: map[string]boundaryBits{}, atoms: map[*domCond][2]*boundaryLiteral{}}
		type key struct {
			target            boundaryBits
			forward, positive bool
		}
		keys := map[key]*boundaryLiteral{}
		var conds []*domCond
		for _, p := range g.prods {
			conds = append(conds, p.predictConds...)
			for _, c := range p.conds {
				conds = append(conds, c.cond)
			}
			if p.slot != nil {
				conds = append(conds, p.slot.source.conds...)
			}
		}
		for _, c := range conds {
			for _, a := range boundaryAtoms(clausePart{c: c}) {
				if _, ok := m.atoms[a]; ok {
					continue
				}
				var target boundaryBits
				for _, t := range a.Targets {
					target = target.union(m.name(t.Str))
				}
				forward := a.Op == "followed-by"
				if forward {
					m.forward = m.forward.union(target)
				} else {
					m.backward = m.backward.union(target)
				}
				var pair [2]*boundaryLiteral
				for i := range pair {
					k := key{target, forward, i == 1}
					l := keys[k]
					if l == nil {
						l = &boundaryLiteral{len(m.literals), boundaryBit(len(m.literals)), target, forward, i == 1}
						m.literals = append(m.literals, l)
						keys[k] = l
					}
					pair[i] = l
				}
				m.atoms[a] = pair
			}
		}
		if len(m.literals) > 0 {
			g.boundary = m
		}
	})
	if g.boundary == nil {
		return nil
	}
	m := *g.boundary
	m.records = map[boundaryShape]*boundaryRecord{}
	m.empty = m.intern(boundaryShape{empty: true})
	return &m
}
func (m *boundaryMachine) literal(a *domCond, positive bool) *boundaryLiteral {
	i := 0
	if positive {
		i = 1
	}
	if pair, ok := m.atoms[a]; ok {
		return pair[i]
	}
	var target boundaryBits
	for _, t := range a.Targets {
		target = target.union(m.names[t.Str])
	}
	for _, l := range m.literals {
		if l.forward == (a.Op == "followed-by") && l.positive == positive && l.target == target {
			return l
		}
	}
	panic("unknown boundary atom")
}
func (m *boundaryMachine) meet(bits, offers boundaryBits, forward, final bool, fail func(*boundaryLiteral)) (boundaryBits, bool) {
	remaining := bits
	ok := true
	for _, l := range m.literals {
		if !bits.has(l.id) || l.forward != forward {
			continue
		}
		hit := l.target.intersect(offers) != ""
		if !hit && !final {
			continue
		}
		if hit != l.positive {
			fail(l)
			ok = false
		}
		remaining = remaining.without(l.bit)
	}
	return remaining, ok
}
func (m *boundaryMachine) append(r *boundaryRecord, b boundaryBits) *boundaryRecord {
	s := r.boundaryShape
	s.end = s.end.union(b)
	return m.intern(s)
}
func (m *boundaryMachine) leaf(name string, empty bool) *boundaryRecord {
	if empty {
		return m.empty
	}
	b := m.names[name]
	return m.intern(boundaryShape{first: b.intersect(m.forward), last: b.intersect(m.backward)})
}
func (m *boundaryMachine) advance(p, c *boundaryRecord, fail func(*boundaryLiteral)) *boundaryRecord {
	if c.empty {
		if p.empty {
			return m.append(p, c.end)
		}
		end, ok := m.meet(c.end, p.last, false, false, fail)
		if !ok {
			return nil
		}
		return m.append(p, end)
	}
	if p.empty {
		start, ok := m.meet(p.end.union(c.start), c.first, true, false, fail)
		if !ok {
			return nil
		}
		return m.intern(boundaryShape{start: start, first: c.first, end: c.end, last: c.last})
	}
	middle := p.end.union(c.start)
	_, yes := m.meet(middle, c.first, true, true, fail)
	_, no := m.meet(middle, p.last, false, true, fail)
	if !yes || !no {
		return nil
	}
	return m.intern(boundaryShape{start: p.start, first: p.first, end: c.end, last: c.last})
}
func (m *boundaryMachine) complete(r *boundaryRecord, name string, back, forward boundaryBits, fail func(*boundaryLiteral)) *boundaryRecord {
	if r.empty {
		return m.append(r, back.union(forward))
	}
	b := m.names[name]
	first, last := r.first.union(b.intersect(m.forward)), r.last.union(b.intersect(m.backward))
	start, ok := m.meet(r.start, first, true, false, fail)
	if !ok {
		return nil
	}
	end, ok := m.meet(r.end, last, false, false, fail)
	if !ok {
		return nil
	}
	return m.intern(boundaryShape{start: start.union(back), first: first, end: end.union(forward), last: last})
}
func (m *boundaryMachine) accepts(r *boundaryRecord, fail func(*boundaryLiteral)) bool {
	ok := true
	for _, l := range m.literals {
		if l.positive && r.start.union(r.end).has(l.id) {
			fail(l)
			ok = false
		}
	}
	return ok
}
func boundaryDominates(a, b *boundaryRecord) bool {
	if a == nil || b == nil {
		return a == b
	}
	return a.empty == b.empty && a.first == b.first && a.last == b.last && a.start.subset(b.start) && a.end.subset(b.end)
}
func (m *boundaryMachine) open(p, c *boundaryRecord) *boundaryRecord {
	if c.empty {
		end := c.end
		if !p.empty {
			var ok bool
			end, ok = m.meet(end, p.last, false, false, func(*boundaryLiteral) {})
			if !ok {
				return nil
			}
		}
		return m.intern(boundaryShape{empty: true, end: end})
	}
	if p.empty {
		return c
	}
	return m.intern(boundaryShape{end: c.end, last: c.last})
}

type boundaryObligation struct {
	atom    *domCond
	literal *boundaryLiteral
	site    *boundarySite
}
type boundarySite struct {
	rule             string
	condition, order int
}

// Dual evaluation preserves the walk across nested query suspension.
func (r *recognizer) startCondition(ev *evaluator, c *domCond, p *production) {
	r.conditionAtom = firstBoundaryAtom(c)
	r.condition = c
	r.conditionEv = ev
	r.conditionProd = p
	r.conditionPhase = 0
	if r.conditionAtom != nil {
		ev.boundaryValue = true
		ev.hasBoundaryValue = true
	}
	r.w.cond(ev, c)
}
func (r *recognizer) resumeCondition() *nestedQuery {
	for {
		if q := r.w.resume(); q != nil {
			return q
		}
		if r.conditionAtom == nil {
			return nil
		}
		value := r.w.b && !r.w.invalidObservation
		if r.conditionPhase == 0 {
			r.conditionYes = value
			r.conditionPhase = 1
			r.conditionEv.boundaryValue = false
			r.w.cond(r.conditionEv, r.condition)
			continue
		}
		r.conditionEv.hasBoundaryValue = false
		r.w.invalidObservation = false
		r.w.b = r.conditionYes || value
		if r.conditionYes != value && r.boundaries != nil {
			a, p := r.conditionAtom, r.conditionProd
			own := true
			if p.helper && a.Span.Str == "" {
				own = false
				raw := r.condition
				if original := p.boundaryOriginal[r.condition]; original != nil {
					raw = original
				}
				reads := map[string]bool{}
				rankedCondReads(raw, reads)
				own = overlaps(reads, p.privateNames)
			}
			if own {
				r.obligations = append(r.obligations, boundaryObligation{a, r.boundaries.literal(a, r.conditionYes), r.boundarySite(p, a)})
			}
		}
		return nil
	}
}
func (r *recognizer) boundarySite(p *production, a *domCond) *boundarySite {
	source := p.sourceAlternative
	if p.lexical != nil {
		source = p.lexical.root.sourceAlternative
	}
	if source == nil && p.slot != nil {
		source = p.slot.source
	}
	if source != nil {
		return source.boundarySites[a]
	}
	return nil
}

func (r *recognizer) bounded(k int, key *itemKey, l link) bool {
	m := r.boundaries
	if m == nil {
		return true
	}
	record := m.empty
	annotations := newBoundaryAnnotations()
	if l.prev != nil {
		record = l.prev.boundary
		annotations = l.prev.boundaryAnnotations.retain(record)
	}
	var before, after, back, forward boundaryBits
	for _, o := range r.obligations {
		if o.atom.Span.Str == "" {
			if o.literal.forward {
				forward = forward.union(o.literal.bit)
			} else {
				back = back.union(o.literal.bit)
			}
		} else if o.literal.forward {
			after = after.union(o.literal.bit)
		} else {
			before = before.union(o.literal.bit)
		}
	}
	if key.dot > 0 {
		record = m.append(record, before)
		for _, o := range r.obligations {
			if o.atom.Span.Str != "" && !o.literal.forward {
				annotations.add(false, o.literal.id, o.site)
			}
		}
		var child *boundaryRecord
		sources := newBoundaryAnnotations()
		if l.sym != nil {
			child = l.sym.boundary
			sources = l.sym.boundaryAnnotations
		} else {
			a, b := r.observed(int32(k-1), int32(k))
			child = m.leaf(r.g.terminals[l.term], a == b)
		}
		fail := func(lit *boundaryLiteral) {
			r.boundaryFailures = append(r.boundaryFailures, boundaryFailure{at: int32(k), end: k, source: annotations.meeting(sources, child.empty, lit.id)})
		}
		if l.prev != nil {
			fail = func(lit *boundaryLiteral) {
				r.boundaryFailures = append(r.boundaryFailures, boundaryFailure{at: l.prev.set, end: k, source: annotations.meeting(sources, child.empty, lit.id)})
			}
		}
		result := m.advance(record, child, fail)
		if result == nil {
			return false
		}
		annotations = annotations.advance(m, record, child, result, sources)
		record = m.append(result, after)
		for _, o := range r.obligations {
			if o.atom.Span.Str != "" && o.literal.forward {
				annotations.add(false, o.literal.id, o.site)
			}
		}
	}
	if int(key.dot) == len(key.prod.rhs) {
		name := ""
		if !key.prod.helper {
			name = r.g.rules[key.prod.lhs].name
		}
		result := m.complete(record, name, back, forward, func(lit *boundaryLiteral) {
			start := lit.forward
			at := int32(k)
			if start {
				at = key.origin
			}
			r.boundaryFailures = append(r.boundaryFailures, boundaryFailure{at, k, annotations.get(start, lit.id)})
		})
		if result == nil {
			return false
		}
		record = result
		annotations = annotations.retain(record)
		for _, o := range r.obligations {
			if o.atom.Span.Str == "" {
				annotations.add(!record.empty && !o.literal.forward, o.literal.id, o.site)
			}
		}
		if r.query == nil && key.prod.lhs == r.startRule && key.origin == 0 && k == r.n {
			if !m.accepts(record, func(lit *boundaryLiteral) {
				start := record.start.has(lit.id)
				at := int32(k)
				if start {
					at = key.origin
				}
				r.boundaryFailures = append(r.boundaryFailures, boundaryFailure{at, k, annotations.get(start, lit.id)})
			}) {
				return false
			}
		}
	}
	key.boundary = record
	r.nextBoundaryAnnotations = annotations
	return true
}
