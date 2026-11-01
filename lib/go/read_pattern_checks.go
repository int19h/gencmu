package gencmu

// Inspect child repetition after all local pattern constructors succeed.
func sourcePatternProblem(root *domPattern) string {
	type task struct {
		node     *domPattern
		repeated bool
	}
	pending := []task{{root, false}}
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
	return ""
}
