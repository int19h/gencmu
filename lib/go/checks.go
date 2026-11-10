package gencmu

import (
	"encoding/json"
	"fmt"
)

// checkElement retains the nesting of optionals expanded in place.
type checkElement struct {
	start, end, position int
	expression           *domExpr
	children             []*checkElement
}

func checkElements(body []slot) []*checkElement {
	root := &checkElement{}
	stack := []*checkElement{root}
	position := 0
	for _, slot := range body {
		parent := stack[len(stack)-1]
		switch slot.elementMark {
		case 1:
			next := &checkElement{start: position, expression: slot.elementExpr}
			parent.children = append(parent.children, next)
			stack = append(stack, next)
		case -1:
			parent.end = position
			stack = stack[:len(stack)-1]
		default:
			parent.children = append(parent.children, &checkElement{start: position, end: position + 1, position: position})
			position++
		}
	}
	return root.children
}

type checkValue struct {
	span   spanVal
	target string
}
type checkNode struct {
	source                  *occurrence
	name, terminal          string
	elided, seal, candidate bool
	parent                  *checkNode
	index                   int
	children                []*checkNode
	span                    spanVal
	identity                int
}
type checkTree struct {
	flow        *diagnosticFlow
	machine     *patternMachine
	bySource    map[*occurrence]*checkNode
	preceding   map[*occurrence]*checkValue
	positions   map[*occurrence]int
	first, last map[string]map[int]bool
}

func newCheckTree(flow *diagnosticFlow) *checkTree {
	g, run := flow.rec.g, flow.run
	var patterns []*domPattern
	for _, entry := range g.stage.checks {
		patterns = append(patterns, entry.definition.Pattern.Pattern)
		for _, condition := range entry.definition.Conditions {
			walkClause(clausePart{c: condition}, func(part clausePart) bool {
				if part.t != nil && part.t.Pattern != nil {
					patterns = append(patterns, part.t.Pattern)
				}
				return true
			})
		}
	}
	tree := &checkTree{flow: flow, machine: newPatternMachine(patterns), bySource: map[*occurrence]*checkNode{}, preceding: map[*occurrence]*checkValue{}, positions: map[*occurrence]int{}, first: map[string]map[int]bool{}, last: map[string]map[int]bool{}}
	for _, source := range flow.order {
		for position, child := range source.kids {
			tree.positions[child] = position
		}
		a, b, _ := run.kidSpan(flow.rec, source.d)
		name := ""
		if source.d.kind == dRead {
			name = g.terminals[source.d.term]
		} else if !source.d.prod.helper {
			name = g.rules[source.d.prod.lhs].name
		}
		if a != b && name != "" {
			if tree.first[name] == nil {
				tree.first[name], tree.last[name] = map[int]bool{}, map[int]bool{}
			}
			tree.first[name][a], tree.last[name][b] = true, true
		}
	}
	type visit struct {
		source *occurrence
		parent *checkNode
	}
	pending := []visit{{source: flow.root}}
	var nodes []*checkNode
	for len(pending) > 0 {
		at := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		source := at.source
		a, b, tags := run.kidSpan(flow.rec, source.d)
		node := &checkNode{source: source, parent: at.parent, candidate: true, span: spanVal{a: a, b: b, tags: tags, whole: true}}
		erased := false
		if source.d.kind == dRead {
			node.terminal = g.terminals[source.d.term]
		} else {
			p := source.d.prod
			if p.nothing {
				erased, node.candidate = true, false
				if p.helper {
					node.seal = true
				} else {
					node.name = g.rules[p.lhs].name
				}
			} else if p.helper && len(source.kids) == 0 && p.elided != "" {
				node.terminal, node.elided = p.elided, true
				node.span.tags = run.ps.in.make([]string{p.elided})
			} else if p.helper {
				for i := len(source.kids) - 1; i >= 0; i-- {
					pending = append(pending, visit{source.kids[i], at.parent})
				}
				continue
			} else {
				node.name = g.rules[p.lhs].name
			}
		}
		nodes = append(nodes, node)
		if at.parent != nil {
			at.parent.children = append(at.parent.children, node)
		}
		if erased && !node.seal {
			seal := &checkNode{seal: true, parent: node, span: spanVal{a: a, b: b}}
			node.children = append(node.children, seal)
			nodes = append(nodes, seal)
		} else if !erased {
			for i := len(source.kids) - 1; i >= 0; i-- {
				pending = append(pending, visit{source.kids[i], node})
			}
		}
	}
	identities := map[string]int{}
	for i := len(nodes) - 1; i >= 0; i-- {
		node := nodes[i]
		var children []*checkNode
		sequence := tree.machine.empty
		var childIdentities []int
		for _, child := range node.children {
			if child.identity == 0 {
				continue
			}
			child.index = len(children)
			children = append(children, child)
			sequence = tree.machine.concat(sequence, child.span.structure)
			childIdentities = append(childIdentities, child.identity)
		}
		node.children = children
		if node.name != "" && len(children) == 0 && node.source != flow.root {
			continue
		}
		var key any
		value := ""
		if node.seal {
			var values []string
			for _, token := range run.toks[node.span.a:node.span.b] {
				values = append(values, token.Value)
			}
			key = []any{"seal", values}
			node.span.structure = tree.machine.sealed()
		} else if node.terminal != "" {
			tags := node.span.tags
			if node.elided {
				tags = run.ps.in.make([]string{node.terminal, "_Elided"})
				key = []any{"elided", node.terminal}
			} else {
				value = run.toks[node.span.a].Value
				key = []any{"leaf", node.terminal, value}
			}
			node.span.structure = tree.machine.node("", sequence, node.terminal, value, tags)
		} else {
			key = []any{"rule", node.name, childIdentities}
			if tree.machine.nodeValues {
				value = run.spanValue(node.span)
			}
			node.span.structure = tree.machine.node(node.name, sequence, "", value, node.span.tags)
		}
		encoded, _ := json.Marshal(key)
		id := identities[string(encoded)]
		if id == 0 {
			id = len(identities) + 1
			identities[string(encoded)] = id
		}
		node.identity, node.span.tree, node.span.machine = id, id, tree.machine
		if node.source != nil && !node.seal {
			tree.bySource[node.source] = node
		}
	}
	if g.stage.hasElements {
		for _, source := range flow.order {
			if parent := flow.nodes[source].parent; parent != nil {
				tree.preceding[source] = tree.before(parent, tree.positions[source])
			}
		}
	}
	return tree
}
func (tree *checkTree) site(parent *occurrence, position int) string {
	g := tree.flow.rec.g
	p := parent.d.prod
	if position < len(p.siteExpressions) {
		if target := g.stage.localTargets[p.siteExpressions[position]]; target != "" {
			return target
		}
	}
	symbol := p.rhs[position]
	if !symbol.term {
		if !g.rules[symbol.id].helper {
			return g.rules[symbol.id].name
		}
		if len(g.rules[symbol.id].prods) > 0 {
			return g.stage.localTargets[g.rules[symbol.id].prods[0].helperExpression]
		}
	}
	return ""
}
func (tree *checkTree) before(parent *occurrence, at int) *checkValue {
	for {
		p := parent.d.prod
		sequence := p.elements
		type ancestor struct {
			sequence []*checkElement
			index    int
		}
		var ancestors []ancestor
		find := func(sequence []*checkElement) int {
			for i, e := range sequence {
				if e.start <= at && at < e.end {
					return i
				}
			}
			return -1
		}
		index := find(sequence)
		if index < 0 {
			return nil
		}
		for sequence[index].expression != nil {
			inner := find(sequence[index].children)
			if inner < 0 {
				break
			}
			ancestors = append(ancestors, ancestor{sequence, index})
			sequence = sequence[index].children
			index = inner
		}
		for index == 0 && len(ancestors) > 0 {
			outer := ancestors[len(ancestors)-1]
			ancestors = ancestors[:len(ancestors)-1]
			sequence, index = outer.sequence, outer.index
		}
		if index > 0 {
			e := sequence[index-1]
			_, b := tree.flow.span(parent)
			start, end := b, b
			if e.start < len(parent.kids) {
				start, _ = tree.flow.span(parent.kids[e.start])
				end = start
			}
			if e.start != e.end {
				_, end = tree.flow.span(parent.kids[e.end-1])
			}
			target := tree.flow.rec.g.stage.localTargets[e.expression]
			if e.expression == nil {
				target = tree.site(parent, e.position)
			}
			return &checkValue{span: spanVal{a: start, b: end}, target: target}
		}
		if !p.helper || p.spliceTarget != nil {
			return nil
		}
		child := parent
		parent = tree.flow.nodes[parent].parent
		if parent == nil {
			return nil
		}
		at = tree.positions[child]
	}
}
func (tree *checkTree) node(root *checkNode, term *domTerm) *checkNode {
	var path []string
	for term.Kind == tmCall {
		path = append(path, term.Str)
		term = term.Items[0]
	}
	node := root
	for i := len(path) - 1; i >= 0 && node != nil; i-- {
		switch path[i] {
		case "parent":
			node = node.parent
		case "preceding-node":
			if node.parent == nil || node.index == 0 {
				node = nil
			} else {
				node = node.parent.children[node.index-1]
			}
		case "following-node":
			if node.parent == nil || node.index+1 == len(node.parent.children) {
				node = nil
			} else {
				node = node.parent.children[node.index+1]
			}
		default:
			panic("a checked node walk")
		}
		if node != nil && node.seal {
			node = nil
		}
	}
	return node
}
func (tree *checkTree) value(root *checkNode, term *domTerm) *checkValue {
	if checkElementTerm(term) {
		node := tree.node(root, term.Items[0])
		if node == nil {
			return nil
		}
		return tree.preceding[node.source]
	}
	node := tree.node(root, term)
	if node == nil {
		return nil
	}
	source := node.source
	target := ""
	if source.d.kind == dClose && source.d.prod.helper && len(source.kids) == 0 && source.d.prod.elided != "" {
		target = tree.flow.rec.g.stage.localTargets[source.d.prod.helperExpression]
	} else if parent := tree.flow.nodes[source].parent; parent != nil {
		target = tree.site(parent, tree.positions[source])
	} else if source.d.kind == dClose {
		target = tree.flow.rec.g.rules[source.d.prod.lhs].name
	}
	return &checkValue{span: node.span, target: target}
}
func (tree *checkTree) boundary(atom *domCond, span spanVal) bool {
	for _, target := range atom.Targets {
		if atom.Op == "followed-by" && tree.first[target.Str][span.b] || atom.Op == "preceded-by" && tree.last[target.Str][span.a] {
			return true
		}
	}
	return false
}
func (tree *checkTree) condition(node *checkNode, condition *domCond) bool {
	run, g := tree.flow.run, tree.flow.rec.g
	ev := run.evaluator(g, nil)
	ev.check, ev.checkNode = tree, node
	ev.boundary = func(atom *domCond) bool { var walk walk; return tree.boundary(atom, walk.span(ev, atom.Span)) }
	var walk walk
	walk.cond(ev, condition)
	for {
		query := walk.resume()
		if query == nil {
			return walk.b
		}
		run.startQuery(query)
		run.drive(query.recognizer(run))
	}
}
func (tree *checkTree) local(root *checkNode, receiver *domTerm) *checkValue {
	value := tree.value(root, receiver)
	if value == nil {
		panic(absentCheckValue{})
	}
	if value.target == "" {
		panic(fmt.Sprintf("a missing local target at %v", value.span))
	}
	return value
}
