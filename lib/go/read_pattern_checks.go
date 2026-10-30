package gencmu

// Inspect child repetition after all local pattern constructors succeed.
func sourcePatternProblem(root *domPattern) string {
	type task struct {
		node     *domPattern
		repeated bool
	}
	pending := []task{{root, false}}
	var repeats []*domPattern
	for len(pending) > 0 {
		t := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		p := t.node
		if p.Kind == "siblings" && t.repeated {
			return "a sibling ellipsis cannot be a repeat item or separator"
		}
		repeated := t.repeated
		switch p.Kind {
		case "repeat":
			repeated = true
			repeats = append(repeats, p.Items[0])
		case "node", "path", "test", "union", "intersection", "difference":
			repeated = false
		}
		for _, item := range p.Items {
			pending = append(pending, task{item, repeated})
		}
		for _, item := range p.Attached {
			pending = append(pending, task{item, false})
		}
	}
	known := map[*domPattern]bool{}
	for _, root := range repeats {
		type frame struct {
			node  *domPattern
			ready bool
		}
		stack := []frame{{root, false}}
		for len(stack) > 0 {
			f := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			p := f.node
			if _, ok := known[p]; ok {
				continue
			}
			if !f.ready && p.Kind != "node" && len(p.Items) > 0 {
				stack = append(stack, frame{p, true})
				for _, item := range p.Items {
					stack = append(stack, frame{item, false})
				}
				continue
			}
			consumes := p.Kind == "node"
			for _, item := range p.Items {
				consumes = consumes || known[item]
			}
			known[p] = consumes
		}
		if !known[root] {
			return "a pattern repeat cannot match only empty sequences"
		}
	}
	return ""
}
