package gencmu

// Sources propagate late joins to dependent items without splitting records.
type boundarySource struct {
	sites map[*boundarySite]bool
	users map[*boundarySource]bool
}

func (s *boundarySource) add(site *boundarySite) {
	if s == nil || site == nil {
		return
	}
	pending := []*boundarySource{s}
	for at := 0; at < len(pending); at++ {
		p := pending[at]
		if p.sites == nil {
			p.sites = map[*boundarySite]bool{}
		}
		if p.sites[site] {
			continue
		}
		p.sites[site] = true
		for user := range p.users {
			pending = append(pending, user)
		}
	}
}
func (s *boundarySource) inherit(p *boundarySource) {
	if p == nil || s == p {
		return
	}
	if p.users == nil {
		p.users = map[*boundarySource]bool{}
	}
	if p.users[s] {
		return
	}
	p.users[s] = true
	for site := range p.sites {
		s.add(site)
	}
}

type boundarySources map[int]*boundarySource
type boundaryAnnotations struct{ start, end boundarySources }

var emptyBoundaryAnnotations = &boundaryAnnotations{}

func newBoundaryAnnotations() *boundaryAnnotations { return emptyBoundaryAnnotations }
func selectBoundary(bits boundaryBits, inputs ...boundarySources) boundarySources {
	if bits == "" {
		return nil
	}
	var out boundarySources
	for _, input := range inputs {
		for id, source := range input {
			if !bits.has(id) {
				continue
			}
			if out == nil {
				out = boundarySources{}
			}
			if out[id] == nil {
				out[id] = &boundarySource{}
			}
			out[id].inherit(source)
		}
	}
	return out
}
func (a *boundaryAnnotations) retain(r *boundaryRecord) *boundaryAnnotations {
	if a == nil || r.start == "" && r.end == "" {
		return newBoundaryAnnotations()
	}
	return &boundaryAnnotations{selectBoundary(r.start, a.start), selectBoundary(r.end, a.end)}
}
func (a *boundaryAnnotations) get(start bool, id int) *boundarySource {
	if start {
		return a.start[id]
	}
	return a.end[id]
}
func (a *boundaryAnnotations) add(start bool, id int, site *boundarySite) *boundaryAnnotations {
	if a == emptyBoundaryAnnotations {
		a = &boundaryAnnotations{}
	}
	if start && a.start == nil {
		a.start = boundarySources{}
	}
	if !start && a.end == nil {
		a.end = boundarySources{}
	}
	sources := a.end
	if start {
		sources = a.start
	}
	if sources[id] == nil {
		sources[id] = &boundarySource{}
	}
	sources[id].add(site)
	return a
}
func (a *boundaryAnnotations) merge(b *boundaryAnnotations) {
	if b == nil {
		return
	}
	for i, src := range []boundarySources{b.start, b.end} {
		if len(src) == 0 {
			continue
		}
		if i == 0 && a.start == nil {
			a.start = boundarySources{}
		}
		if i == 1 && a.end == nil {
			a.end = boundarySources{}
		}
		dst := a.end
		if i == 0 {
			dst = a.start
		}
		for id, s := range src {
			if dst[id] == nil {
				dst[id] = &boundarySource{}
			}
			dst[id].inherit(s)
		}
	}
}
func (a *boundaryAnnotations) meeting(c *boundaryAnnotations, empty bool, id int) *boundarySource {
	s := &boundarySource{}
	if empty {
		s.inherit(c.end[id])
	} else {
		s.inherit(a.end[id])
		s.inherit(c.start[id])
	}
	return s
}
func (a *boundaryAnnotations) advance(m *boundaryMachine, p, c, result *boundaryRecord, b *boundaryAnnotations) *boundaryAnnotations {
	if result.start == "" && result.end == "" {
		return newBoundaryAnnotations()
	}
	if c.empty {
		pending := c.end
		if !p.empty {
			pending, _ = m.meet(c.end, p.last, false, false, func(*boundaryLiteral) {})
		}
		return &boundaryAnnotations{selectBoundary(result.start, a.start), selectBoundary(result.end, a.end, selectBoundary(pending, b.end))}
	}
	if p.empty {
		return &boundaryAnnotations{selectBoundary(result.start, a.end, b.start), selectBoundary(result.end, b.end)}
	}
	return &boundaryAnnotations{selectBoundary(result.start, a.start), selectBoundary(result.end, b.end)}
}

type boundaryFailure struct {
	at     int32
	end    int
	source *boundarySource
}
