package gencmu

import (
	"math/bits"
)

// The tree (engine §12) and emission (engine §11), both walks of a chosen
// derivation. Derivations nest as deep as a text is long, so the walks keep
// their own stacks.

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
		node := &Node{Kind: KindRule, Rule: n.prod.ruleName, Span: [2]int{a, b}, Source: run.spanSource(a, b), Tags: n.tags.list(), Children: []*Node{}}
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
			node := &Node{Kind: KindElided, Terminal: n.prod.elided, Span: [2]int{p, p}, Source: run.emptySource(p), sound: elidedValue(n.prod.elidedTest), tested: elidedTested(n.prod.elidedTest)}
			if node.tested {
				value := node.sound
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

// warnings lists the warnings of a chosen derivation (engine §12): each rule
// node of its tree gives one for each warning of its production, in the
// order a walk meets the nodes, parent before children and children left to
// right. Helpers give their children in their place, as in buildTree.
func (run *stageRun) warnings(rec *recognizer, d *dn) []Warning {
	var out []Warning
	pending := []*dn{d}
	for len(pending) > 0 {
		n := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		if n.kind == dRead {
			continue
		}
		if !n.prod.helper {
			a, b := rec.base+int(n.start), rec.base+int(n.end)
			for _, f := range n.prod.warnings {
				out = append(out, Warning{Stage: run.name, Feature: f, Rule: n.prod.ruleName, Span: [2]int{a, b}, Source: run.spanSource(a, b)})
			}
		}
		pending = pushKids(pending, n)
	}
	return out
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
