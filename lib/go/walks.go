package gencmu

// Walks of the clauses of a definition with explicit stacks: a DOM that
// the reader reads is as deep as its document nests until the check of its
// depth (engine §9), so no walk of it during reading recurses.

// clausePart is a term or a condition of a clause.
type clausePart struct {
	t *domTerm
	c *domCond
}

// parts of a clause part, in the order written: a term's condition, then
// its items; a condition's sides, its span, its inner condition, then its
// items.
func (p clausePart) children() []clausePart {
	var out []clausePart
	if p.t != nil {
		if p.t.Cond != nil {
			out = append(out, clausePart{c: p.t.Cond})
		}
		for _, it := range p.t.Items {
			if it != nil {
				out = append(out, clausePart{t: it})
			}
		}
		return out
	}
	if p.c == nil {
		return nil
	}
	for _, t := range []*domTerm{p.c.Left, p.c.Right, p.c.Span} {
		if t != nil {
			out = append(out, clausePart{t: t})
		}
	}
	if p.c.Inner != nil {
		out = append(out, clausePart{c: p.c.Inner})
	}
	for _, it := range p.c.Items {
		out = append(out, clausePart{c: it})
	}
	return out
}

// walkClause meets each part below a start, the start too, in the order
// written; enter says whether to go below a part.
func walkClause(start clausePart, enter func(clausePart) bool) {
	if start.t == nil && start.c == nil {
		return
	}
	stack := []clausePart{start}
	for len(stack) > 0 {
		readerWork.steps.Add(1)
		p := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if !enter(p) {
			continue
		}
		kids := p.children()
		for i := len(kids) - 1; i >= 0; i-- {
			stack = append(stack, kids[i])
		}
	}
}
