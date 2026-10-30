package gencmu

// Parentheses add no union or Boolean grouping anywhere in the source DOM.
func flattenGroups(d *domDoc) {
	var stack []any
	for _, r := range d.Rules {
		stack = append(stack, r)
	}
	for _, r := range d.Constants {
		stack = append(stack, r.Value)
	}
	for _, r := range d.Implications {
		stack = append(stack, r.If, r.Then)
	}
	for _, r := range d.Directives {
		for _, c := range r.Conditions {
			stack = append(stack, c)
		}
	}
	for _, r := range d.Classifiers {
		for _, e := range r.Entries {
			for _, k := range e.Keys {
				stack = append(stack, k)
			}
		}
	}
	for len(stack) > 0 {
		node := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		switch n := node.(type) {
		case *domRule:
			stack = append(stack, n.Tags, n.Value, n.Image, n.Instance)
			for _, a := range n.Args {
				stack = append(stack, a)
			}
			for _, a := range n.Alternatives {
				stack = append(stack, a.Expr, a.Tags, a.Value, a.Image)
			}
			for _, c := range n.Conditions {
				stack = append(stack, c)
			}
			if n.Emit != nil {
				for _, it := range n.Emit.Items {
					stack = append(stack, it.Tags, it.Value, it.Image)
				}
			}
		case *domExpr:
			if n == nil {
				continue
			}
			stack = append(stack, n.Inner, n.Sep, n.Value, n.Call, n.Ends[0], n.Ends[1])
			for _, it := range n.Items {
				stack = append(stack, it)
			}
			for _, r := range n.Requirements {
				stack = append(stack, r.Value)
			}
		case *domTerm:
			if n == nil {
				continue
			}
			if n.Kind == tmUnion {
				n.Items = flattenList(n.Items, func(it *domTerm) ([]*domTerm, bool) { return it.Items, it.Kind == tmUnion })
			}
			stack = append(stack, n.Cond, n.Call, n.Pattern)
			for _, it := range n.Items {
				stack = append(stack, it)
			}
		case *domCond:
			if n == nil {
				continue
			}
			if n.Kind == cdAny || n.Kind == cdAll {
				n.Items = flattenList(n.Items, func(it *domCond) ([]*domCond, bool) { return it.Items, it.Kind == n.Kind })
			}
			stack = append(stack, n.Left, n.Right, n.Span, n.Inner)
			for _, it := range n.Items {
				stack = append(stack, it)
			}
			for _, t := range n.Targets {
				stack = append(stack, t)
			}
		case *domSourceCall:
			if n == nil {
				continue
			}
			for _, a := range n.Args {
				stack = append(stack, a)
			}
		case *domArgument:
			stack = append(stack, n.Term, n.Expr)
			for _, r := range n.Requirements {
				stack = append(stack, r.Value)
			}
			for _, t := range n.Targets {
				stack = append(stack, t)
			}
		case *domPattern:
			if n == nil {
				continue
			}
			if n.Kind == tmUnion {
				n.Items = flattenList(n.Items, func(it *domPattern) ([]*domPattern, bool) { return it.Items, it.Kind == tmUnion })
			}
			stack = append(stack, n.Value, n.Call, n.Ends[0], n.Ends[1])
			for _, r := range n.Requirements {
				stack = append(stack, r.Value)
			}
			for _, it := range n.Items {
				stack = append(stack, it)
			}
			for _, it := range n.Attached {
				stack = append(stack, it)
			}
		}
		if w := work.Load(); w != nil {
			w.readerSteps.add("reader steps")
		}
	}
}

// Gather a complete same-operator group once, in written order.
func flattenList[T any](items []*T, children func(*T) ([]*T, bool)) []*T {
	pending := make([]*T, len(items))
	for i, it := range items {
		pending[len(items)-1-i] = it
	}
	joined := make([]*T, 0, len(items))
	for len(pending) > 0 {
		it := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		if w := work.Load(); w != nil {
			w.readerSteps.add("reader steps")
		}
		if inner, ok := children(it); ok {
			for i := len(inner) - 1; i >= 0; i-- {
				pending = append(pending, inner[i])
			}
		} else {
			joined = append(joined, it)
		}
	}
	return joined
}
