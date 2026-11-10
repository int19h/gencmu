package gencmu

import (
	"math/bits"
)

// The tree (engine §12) and source tables. The tree walk keeps its own
// stack because derivations nest as deep as a text is long.

// flattenKids lists a close's children in order.
func flattenKids(kids *dn) []*dn {
	var out []*dn
	for p := kids; p != nil; p = p.a {
		out = append(out, p.b)
	}
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out
}

// emptySource is the source of an empty span at token position p: the end
// of the token before it, or the start of the first token.
func (run *stageRun) emptySource(p int) [2]int {
	switch {
	case p > 0 && p <= len(run.toks):
		e := run.toks[p-1].Source[1]
		return [2]int{e, e}
	case len(run.toks) > 0:
		s := run.toks[0].Source[0]
		return [2]int{s, s}
	}
	return [2]int{0, 0}
}

// spanSource is the source of tokens [a, b) (§1): from the least source
// start among them to the greatest source end, or, for an empty span, the
// point where it lies (§12). Tokens usually lie in the order of their
// sources, and then that is the first token's start and the last token's
// end.
func (run *stageRun) spanSource(a, b int) [2]int {
	if b <= a {
		return run.emptySource(a)
	}
	if !run.sourcesMade {
		run.sources, run.sourcesMade = newSourceTable(run.toks), true
	}
	if run.sources == nil {
		return [2]int{run.toks[a].Source[0], run.toks[b-1].Source[1]}
	}
	return run.sources.source(a, b)
}

// sourceTable answers the source of a run of tokens that are not in the
// order of their sources without a scan, so that the nested nodes of a long
// left-recursive rule cost no more than its tokens: lows[k][i] is the least
// source start of tokens [i, i+2^k), and highs[k][i] the greatest end.
type sourceTable struct {
	lows, highs [][]int
}

// newSourceTable is nil when each token starts and ends no earlier than
// the token before it.
func newSourceTable(toks []Token) *sourceTable {
	ordered := true
	for i := 1; i < len(toks) && ordered; i++ {
		ordered = toks[i-1].Source[0] <= toks[i].Source[0] && toks[i-1].Source[1] <= toks[i].Source[1]
	}
	if ordered {
		return nil
	}
	low, high := make([]int, len(toks)), make([]int, len(toks))
	for i := range toks {
		low[i], high[i] = toks[i].Source[0], toks[i].Source[1]
	}
	st := &sourceTable{lows: [][]int{low}, highs: [][]int{high}}
	for w := 1; 2*w <= len(toks); w *= 2 {
		n := len(toks) - 2*w + 1
		nextLow, nextHigh := make([]int, n), make([]int, n)
		for i := 0; i < n; i++ {
			nextLow[i] = min(low[i], low[i+w])
			nextHigh[i] = max(high[i], high[i+w])
		}
		st.lows, st.highs = append(st.lows, nextLow), append(st.highs, nextHigh)
		low, high = nextLow, nextHigh
	}
	return st
}

// source is the source of tokens [a, b), which is not empty: two runs of a
// power of two tokens cover it.
func (st *sourceTable) source(a, b int) [2]int {
	k := bits.Len(uint(b-a)) - 1
	o := b - 1<<k
	return [2]int{min(st.lows[k][a], st.lows[k][o]), max(st.highs[k][a], st.highs[k][o])}
}

// treeFrame is a rule node being built; pending holds its remaining
// children in reverse, the next one last.
type treeFrame struct {
	node    *Node
	pending []*dn
}

// pushKids pushes a close's children onto a pending stack, the first last.
func pushKids(pending []*dn, n *dn) []*dn {
	kids := flattenKids(n.a)
	for i := len(kids) - 1; i >= 0; i-- {
		pending = append(pending, kids[i])
	}
	return pending
}

// buildTree turns a derivation of a constituent into the result's tree.
func (run *stageRun) buildTree(rec *recognizer, d *dn) *Node {
	base := rec.base
	g := rec.g
	newRule := func(n *dn) *treeFrame {
		a, b := base+int(n.start), base+int(n.end)
		node := &Node{Kind: KindRule, Rule: n.prod.ruleName, Span: [2]int{a, b}, Source: run.spanSource(a, b), Tags: run.ps.publicTags(n.tags), Children: []*Node{}}
		return &treeFrame{node: node, pending: pushKids(nil, n)}
	}
	root := newRule(d)
	stack := []*treeFrame{root}
	for len(stack) > 0 {
		f := stack[len(stack)-1]
		if len(f.pending) == 0 {
			stack = stack[:len(stack)-1]
			if len(stack) > 0 {
				parent := stack[len(stack)-1]
				parent.node.Children = append(parent.node.Children, f.node)
			}
			continue
		}
		n := f.pending[len(f.pending)-1]
		f.pending = f.pending[:len(f.pending)-1]
		switch {
		case n.kind == dRead:
			i := base + int(n.tok)
			f.node.Children = append(f.node.Children, &Node{Kind: KindToken, Terminal: g.terminals[n.term], Token: i, Span: [2]int{i, i + 1}, Source: run.toks[i].Source})
		case n.prod.helper && n.a == nil && n.prod.elided != "":
			p := base + int(n.start)
			node := &Node{Kind: KindElided, Terminal: n.prod.elided, Span: [2]int{p, p}, Source: run.emptySource(p)}
			if elidedTested(n.prod.elidedTest) {
				value := elidedValue(n.prod.elidedTest)
				node.Value = &value
			}
			f.node.Children = append(f.node.Children, node)
		case n.prod.helper:
			// A helper is spliced: its children stand in its place, and a
			// chain's levels are rule nodes, which stay (§12).
			f.pending = pushKids(f.pending, n)
		default:
			stack = append(stack, newRule(n))
		}
	}
	return root.node
}

// Evaluate messages after choice, before erasure and emission (engine §12.1).
func (run *stageRun) evaluateDiagnostics(flow *diagnosticFlow, features map[string]bool) {
	rec := flow.rec
	strings := &stringEmitter{run: run, rec: rec, observing: true}
	var checks *checkTree
	for _, entry := range rec.g.stage.checks {
		if entry.definition.Error != nil || features[entry.definition.Name] {
			checks = newCheckTree(flow, features)
			break
		}
	}
	type visit struct {
		node       *occurrence
		suppressed map[string]bool
	}
	occurrences := map[string]int{}
	pending := []visit{{node: flow.root, suppressed: map[string]bool{}}}
	for len(pending) > 0 {
		at := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		node, suppressed := at.node, at.suppressed
		if node.d.kind == dClose {
			p := node.d.prod
			if len(p.suppressWarnings) > 0 {
				copied := map[string]bool{}
				for code := range suppressed {
					copied[code] = true
				}
				for _, code := range p.suppressWarnings {
					copied[code] = true
				}
				suppressed = copied
			}
			code, recipe := p.ruleName, p.error
			if recipe == nil && features[code] && !suppressed[code] && !suppressed["_"] {
				recipe = p.warning
			}
			if recipe != nil {
				if hook := diagnosticMessage.Load(); hook != nil && hook.stages[rec.g.stage] {
					hook.call(node, recipe)
				}
				a, b := rec.base+int(node.d.start), rec.base+int(node.d.end)
				report := Warning{Stage: run.name, Code: code, Rule: code, Span: [2]int{a, b}, Source: run.spanSource(a, b), Message: strings.recipe(node, recipe)}
				measure := diagnosticMeasure{}
				if p.error != nil {
					measure = rec.ownMeasure(node.d.start, node.d.end)
				}
				report = recordDiagnostic(report, measure, &diagnosticIdentity{stageOrder: run.stageOrder, ordinal: len(flow.evaluated)})
				flow.add(node, report, p.error != nil)
			}
		}
		if checks != nil {
			if current := checks.bySource[node]; current != nil && current.candidate {
				for _, entry := range rec.g.stage.checks {
					check := entry.definition
					error := check.Error != nil
					if !error && (!features[check.Name] || suppressed[check.Name] || suppressed["_"]) {
						continue
					}
					if !checks.machine.matches(current.span.structure, check.Pattern.Pattern) {
						continue
					}
					holds := true
					for _, condition := range check.Conditions {
						if !checks.condition(current, condition) {
							holds = false
							break
						}
					}
					if !holds {
						continue
					}
					recipe := check.Warning
					if error {
						recipe = check.Error
					}
					a, b := current.span.a, current.span.b
					report := Warning{Stage: run.name, Code: check.Name, Rule: check.Name, Span: [2]int{a, b}, Source: run.spanSource(a, b), Message: strings.recipe(node, recipe)}
					measure := diagnosticMeasure{}
					if error {
						measure = rec.ownMeasure(int32(a-rec.base), int32(b-rec.base))
					}
					report = recordDiagnostic(report, measure, &diagnosticIdentity{stageOrder: run.stageOrder, ordinal: len(flow.evaluated), check: check.Name, occurrence: occurrences[check.Name]})
					occurrences[check.Name]++
					flow.add(node, report, error)
				}
			}
		}
		for index := len(node.kids) - 1; index >= 0; index-- {
			pending = append(pending, visit{node.kids[index], suppressed})
		}
	}
}

// hasElided stops at the first elided node of the tree.
func hasElided(root *Node) bool {
	stack := []*Node{root}
	for len(stack) > 0 {
		n := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if n.Kind == KindElided {
			return true
		}
		for i := len(n.Children) - 1; i >= 0; i-- {
			stack = append(stack, n.Children[i])
		}
	}
	return false
}

// elidedNodes lists a tree's elided nodes in text order.
func elidedNodes(root *Node) []*Node {
	var out []*Node
	stack := []*Node{root}
	for len(stack) > 0 {
		n := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if n.Kind == KindElided {
			out = append(out, n)
		}
		for i := len(n.Children) - 1; i >= 0; i-- {
			stack = append(stack, n.Children[i])
		}
	}
	return out
}
