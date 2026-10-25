package gencmu

import "strings"

// Frames keep source grouping on the heap. A value is a predicate or an item list.
type layeredPatternFrame struct {
	n       *Node
	started bool
	parts   []*Node
	values  []any
	atom    templateObject
}

func (b *domBuilder) layeredPattern(n *Node) templateObject {
	return templateObj(b.run(&layeredPatternFrame{n: n}))
}
func (b *domBuilder) layeredChildPredicate(value any, n *Node) templateObject {
	items := templateList(value)
	if len(items) != 1 || !layeredHas(templateObj(items[0]), "child") {
		b.fail(n, "a pattern path or set requires one whole pattern")
	}
	return templateObj(templateObj(items[0])["child"])
}
func layeredReaderSet(key string, left, right templateObject) templateObject {
	items := []any{}
	for _, value := range []templateObject{left, right} {
		if nested := templateList(value[key]); key != "difference" && nested != nil {
			items = append(items, nested...)
		} else {
			items = append(items, value)
		}
	}
	return templateObject{key: items}
}
func (f *layeredPatternFrame) resume(b *domBuilder, in any) readStep {
	n := f.n
	if !f.started {
		f.started = true
		f.parts = ruleParts(n)
		if n.Rule == "pattern-node" || n.Rule == "pattern-bare" {
			f.atom = templateObject{"any": true}
			if n.Rule == "pattern-node" {
				f.atom = templateObj(b.templatePattern(b.only(n, "pattern-atom"))["node"])
			}
			f.parts = nil
			if list := one(n, "pattern-children"); list != nil {
				if !layeredHas(f.atom, "name") && !layeredHas(f.atom, "call") && !layeredHas(f.atom, "param") && !layeredHas(f.atom, "any") {
					b.fail(list, "a child list requires a rule test")
				}
				f.parts = []*Node{list}
			}
		}
		if n.Rule == "child-item" {
			ps := parts(n)
			if len(ps) == 0 {
				b.lacks(n, "child item")
			}
			if ps[0].Kind == KindToken && b.tokenValue(ps[0]) == "⋯" {
				return give([]any{templateObject{"siblings": true}})
			}
		}
	} else {
		f.values = append(f.values, in)
	}
	if len(f.values) < len(f.parts) {
		return ask(&layeredPatternFrame{n: f.parts[len(f.values)]})
	}
	values := f.values
	switch n.Rule {
	case "pattern-primary", "child-item":
		if len(values) != 1 {
			b.lacks(n, "one pattern operand")
		}
		return give(values[0])
	case "pattern-node", "pattern-bare":
		for _, part := range parts(n) {
			if part.Kind == KindToken && b.tokenValue(part) == "·" {
				f.atom["exact"] = true
			}
		}
		if len(values) > 0 {
			f.atom["children"] = values[0]
		}
		return give(f.atom)
	case "pattern-union", "pattern-intersection", "child-set", "child-intersection":
		if len(values) == 0 {
			b.lacks(n, "pattern operands")
		}
		operands := make([]templateObject, len(values))
		for index, value := range values {
			operands[index] = templateObj(value)
			if f.parts[index].Rule == "child-path" {
				operands[index] = b.layeredChildPredicate(value, f.parts[index])
			}
		}
		ops := []string{}
		for _, part := range parts(n) {
			if part.Kind == KindToken {
				ops = append(ops, b.tokenValue(part))
			}
		}
		result := operands[0]
		for index, operand := range operands[1:] {
			key := "union"
			op := ""
			if index < len(ops) {
				op = ops[index]
			}
			if strings.HasSuffix(n.Rule, "intersection") || op == "∩" {
				key = "intersection"
			} else if op == "∖" {
				key = "difference"
			}
			result = layeredReaderSet(key, result, operand)
		}
		return give(result)
	case "pattern-path", "child-path":
		if len(values) != 1 {
			b.lacks(n, "one pattern operand")
		}
		axis := ""
		for _, part := range parts(n) {
			if part.Kind == KindToken {
				axis = b.tokenValue(part)
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
		pattern := templateObj(values[0])
		if n.Rule == "child-path" {
			pattern = b.layeredChildPredicate(values[0], f.parts[0])
		}
		result := templateObject{"path": path, "pattern": pattern}
		if n.Rule == "child-path" {
			return give([]any{templateObject{"child": result}})
		}
		return give(result)
	case "pattern-children":
		if len(values) == 0 {
			return give([]any{})
		}
		return give(values[0])
	case "child-choice":
		arms := []any{}
		for _, value := range values {
			items := templateList(value)
			if len(items) == 1 && layeredHas(templateObj(items[0]), "choice") {
				arms = append(arms, templateList(templateObj(items[0])["choice"])...)
			} else {
				arms = append(arms, items)
			}
		}
		if len(arms) == 1 {
			return give(arms[0])
		}
		return give([]any{templateObject{"choice": arms}})
	case "child-alternative", "child-primary":
		if len(values) != 1 {
			b.lacks(n, "one child operand")
		}
		if f.parts[0].Rule == "child-set" || f.parts[0].Rule == "pattern-node" || f.parts[0].Rule == "pattern-bare" {
			return give([]any{templateObject{"child": values[0]}})
		}
		return give(values[0])
	case "child-sequence":
		items := []any{}
		for _, value := range values {
			items = append(items, templateList(value)...)
		}
		return give(items)
	case "pattern-brackets":
		if len(values) != 1 {
			b.lacks(n, "one child choice")
		}
		return give([]any{templateObject{"optional": values[0]}})
	case "pattern-repeat":
		if len(values) == 0 {
			b.lacks(n, "child choice")
		}
		result := templateObject{"repeat": values[0]}
		if len(values) == 2 {
			result["separator"] = values[1]
		}
		return give([]any{result})
	}
	b.fail(n, "unexpected %s in layered pattern", n.Rule)
	return give(nil)
}
