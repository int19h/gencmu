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
	for value.Kind == "sequence" && len(value.Items) == 1 && value.Items[0].Kind == "sequence" {
		value = value.Items[0]
	}
	if value.Kind != "sequence" || len(value.Items) != 1 || value.Items[0].Kind != "node" {
		b.fail(n, "a pattern path or set requires one whole pattern")
	}
	return value.Items[0].Items[0]
}

func (f *patternFrame) resume(b *domBuilder, in any) readStep {
	n := f.n
	if !f.started {
		f.started = true
		f.parts = b.ruleParts(n)
		switch n.Rule {
		case "pattern-union":
			f.parts = b.some(n, "pattern-intersection", 1)
		case "pattern-intersection":
			f.parts = b.some(n, "pattern-path", 1)
		case "child-intersection":
			f.parts = b.some(n, "child-path", 1)
		case "child-set":
			f.parts = nil
			for _, p := range b.ruleParts(n) {
				if p.Rule == "child-intersection" || p.Rule == "child-path" {
					f.parts = append(f.parts, p)
				}
			}
		case "child-choice":
			f.parts = b.some(n, "child-alternative", 1)
		case "child-sequence":
			f.parts = b.some(n, "child-item", 1)
		case "child-alternative":
			part := b.one(n, "child-sequence")
			if part == nil {
				part = b.only(n, "child-set")
			}
			f.parts = []*Node{part}
		case "child-primary":
			f.parts = []*Node{b.knownOf(n, []string{"pattern-node", "pattern-bare", "child-choice"})}
		case "pattern-path":
			f.parts = []*Node{b.only(n, "pattern-primary")}
		case "child-path":
			f.parts = []*Node{b.only(n, "child-primary")}
		}
		if n.Rule == "pattern-children" {
			f.parts = nil
			if child := b.one(n, "child-choice"); child != nil {
				f.parts = []*Node{child}
			}
		}
		if n.Rule == "pattern-brackets" || n.Rule == "pattern-repeat" {
			f.parts = b.some(n, "child-choice", 1)
			limit := 1
			if n.Rule == "pattern-repeat" {
				limit = 2
			}
			if len(f.parts) > limit {
				f.parts = f.parts[:limit]
			}
		}
		if n.Rule == "pattern-primary" {
			f.parts = []*Node{b.knownOf(n, []string{"pattern-node", "pattern-bare", "pattern-union"})}
		}
		if n.Rule == "pattern-node" || n.Rule == "pattern-bare" {
			f.atom = &domPattern{Kind: "any"}
			if n.Rule == "pattern-node" {
				atom := b.only(n, "pattern-atom")
				atomParts := b.parts(atom)
				if len(atomParts) == 0 {
					b.lacks(atom, "pattern atom")
				}
				f.atom = b.patternAtom(atom, atomParts[0])
			}
			f.parts = nil
			if children := b.one(n, "pattern-children"); children != nil {
				if f.atom.Kind != "name" && f.atom.Kind != "any" && f.atom.Kind != "param" && f.atom.Kind != "call" {
					b.fail(children, "a child list requires a rule test")
				}
				f.parts = []*Node{children}
			}
		}
		if n.Rule == "child-item" {
			ps := b.parts(n)
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
		for _, p := range b.parts(n) {
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
		for _, p := range b.parts(n) {
			if p.Kind == KindToken {
				op := b.tokenValue(p)
				if op == "∪" || op == "∖" || n.Rule != "pattern-union" && op == "∩" {
					ops = append(ops, op)
				}
			}
		}
		if n.Rule == "pattern-union" || n.Rule == "child-set" {
			required := len(values) - 1
			if n.Rule == "child-set" && required < 1 {
				required = 1
			}
			if len(ops) < required {
				b.lacks(n, "operator")
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
			result = &domPattern{Kind: kind, Items: []*domPattern{result, value}}
		}
		return give(result)
	case "pattern-path", "child-path":
		if len(values) != 1 {
			b.lacks(n, "one pattern operand")
		}
		axis := ""
		for _, p := range b.parts(n) {
			if p.Kind == KindToken {
				axis = b.tokenValue(p)
				break
			}
		}
		if axis == "" {
			return give(values[0])
		}
		path := ""
		switch axis {
		case "⋮":
			path = "descendant"
		case "⋱":
			path = "last"
		case "⋰":
			path = "first"
		default:
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
		if len(values) == 1 {
			return give(values[0])
		}
		return give(&domPattern{Kind: "sequence", Items: []*domPattern{{Kind: "choice", Items: values}}})
	case "child-alternative", "child-primary":
		if len(values) != 1 {
			b.lacks(n, "one child operand")
		}
		if f.parts[0].Rule == "child-set" || f.parts[0].Rule == "pattern-node" || f.parts[0].Rule == "pattern-bare" {
			return give(&domPattern{Kind: "sequence", Items: []*domPattern{{Kind: "node", Items: values}}})
		}
		return give(values[0])
	case "child-sequence":
		return give(&domPattern{Kind: "sequence", Items: values})
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
