package gencmu

import "strings"

// patternFrame reads predicates and child lists into the ordinary typed DOM.
type patternFrame struct {
	n       *Node
	started bool
	parts   []*Node
	values  []*domPattern
	atom    *domPattern
}

func (b *domBuilder) patternChild(value *domPattern, n *Node) *domPattern {
	if value.Kind != "sequence" || len(value.Items) != 1 || value.Items[0].Kind != "node" {
		b.fail(n, "a pattern path or set requires one whole pattern")
	}
	return value.Items[0].Items[0]
}

func (f *patternFrame) resume(b *domBuilder, in any) readStep {
	n := f.n
	if !f.started {
		f.started = true
		f.parts = ruleParts(n)
		if n.Rule == "pattern-node" || n.Rule == "pattern-bare" {
			f.atom = &domPattern{Kind: "any"}
			if n.Rule == "pattern-node" {
				atom := b.only(n, "pattern-atom")
				f.atom = b.patternAtom(atom, parts(atom)[0])
			}
			f.parts = nil
			if children := one(n, "pattern-children"); children != nil {
				if f.atom.Kind != "name" && f.atom.Kind != "any" {
					b.fail(children, "a child list requires a rule test")
				}
				f.parts = []*Node{children}
			}
		}
		if n.Rule == "child-item" {
			ps := parts(n)
			if len(ps) == 0 {
				b.lacks(n, "child item")
			}
			if ps[0].Kind == KindToken && b.tokenValue(ps[0]) == "⋯" {
				return give(&domPattern{Kind: "sequence", Items: []*domPattern{{Kind: "siblings"}}})
			}
		}
	} else {
		f.values = append(f.values, in.(*domPattern))
	}
	if len(f.values) < len(f.parts) {
		return ask(&patternFrame{n: f.parts[len(f.values)]})
	}
	values := f.values
	switch n.Rule {
	case "pattern-primary", "child-item":
		if len(values) != 1 {
			b.lacks(n, "one pattern operand")
		}
		return give(values[0])
	case "pattern-node", "pattern-bare":
		for _, p := range parts(n) {
			if p.Kind == KindToken && b.tokenValue(p) == "·" {
				f.atom.Exact = true
			}
		}
		if len(values) > 0 {
			f.atom.Attached = values[0].Items
		}
		return give(f.atom)
	case "pattern-union", "pattern-intersection", "child-set", "child-intersection":
		if len(values) == 0 {
			b.lacks(n, "pattern operands")
		}
		for i, value := range values {
			if f.parts[i].Rule == "child-path" {
				values[i] = b.patternChild(value, f.parts[i])
			}
		}
		var ops []string
		for _, p := range parts(n) {
			if p.Kind == KindToken {
				ops = append(ops, b.tokenValue(p))
			}
		}
		result := values[0]
		for i, value := range values[1:] {
			kind := "union"
			if strings.HasSuffix(n.Rule, "intersection") || i < len(ops) && ops[i] == "∩" {
				kind = "intersection"
			} else if i < len(ops) && ops[i] == "∖" {
				kind = "difference"
			}
			if kind != "difference" && result.Kind == kind && !result.Exact && result.Attached == nil {
				if value.Kind == kind && !value.Exact && value.Attached == nil {
					result.Items = append(result.Items, value.Items...)
				} else {
					result.Items = append(result.Items, value)
				}
			} else {
				items := []*domPattern{result}
				if kind != "difference" && value.Kind == kind && !value.Exact && value.Attached == nil {
					items = append(items, value.Items...)
				} else {
					items = append(items, value)
				}
				result = &domPattern{Kind: kind, Items: items}
			}
		}
		return give(result)
	case "pattern-path", "child-path":
		if len(values) != 1 {
			b.lacks(n, "one pattern operand")
		}
		axis := ""
		for _, p := range parts(n) {
			if p.Kind == KindToken {
				axis = b.tokenValue(p)
				break
			}
		}
		if axis == "" {
			return give(values[0])
		}
		path := map[string]string{"⋮": "descendant", "⋱": "last", "⋰": "first"}[axis]
		if path == "" {
			b.fail(n, "a malformed pattern path")
		}
		pattern := values[0]
		if n.Rule == "child-path" {
			pattern = b.patternChild(pattern, f.parts[0])
		}
		result := &domPattern{Kind: "path", Name: path, Items: []*domPattern{pattern}}
		if n.Rule == "child-path" {
			return give(&domPattern{Kind: "sequence", Items: []*domPattern{{Kind: "node", Items: []*domPattern{result}}}})
		}
		return give(result)
	case "pattern-children":
		if len(values) == 0 {
			return give(&domPattern{Kind: "sequence", Items: []*domPattern{}})
		}
		return give(values[0])
	case "child-choice":
		var arms []*domPattern
		for _, value := range values {
			if len(value.Items) == 1 && value.Items[0].Kind == "choice" {
				arms = append(arms, value.Items[0].Items...)
			} else {
				arms = append(arms, value)
			}
		}
		if len(arms) == 1 {
			return give(arms[0])
		}
		return give(&domPattern{Kind: "sequence", Items: []*domPattern{{Kind: "choice", Items: arms}}})
	case "child-alternative", "child-primary":
		if len(values) != 1 {
			b.lacks(n, "one child operand")
		}
		if f.parts[0].Rule == "child-set" || f.parts[0].Rule == "pattern-node" || f.parts[0].Rule == "pattern-bare" {
			return give(&domPattern{Kind: "sequence", Items: []*domPattern{{Kind: "node", Items: values}}})
		}
		return give(values[0])
	case "child-sequence":
		items := []*domPattern{}
		for _, value := range values {
			items = append(items, value.Items...)
		}
		return give(&domPattern{Kind: "sequence", Items: items})
	case "pattern-brackets", "pattern-repeat":
		if len(values) == 0 || n.Rule == "pattern-brackets" && len(values) != 1 {
			b.lacks(n, "child choice")
		}
		kind := "optional"
		if n.Rule == "pattern-repeat" {
			kind = "repeat"
		}
		return give(&domPattern{Kind: "sequence", Items: []*domPattern{{Kind: kind, Items: values}}})
	}
	b.fail(n, "unexpected %s in a pattern", n.Rule)
	return give(nil)
}
