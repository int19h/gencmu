package gencmu

import "strings"

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

func (run *stageRun) spanSource(a, b int) [2]int {
	if b <= a {
		return run.emptySource(a)
	}
	return [2]int{run.toks[a].Source[0], run.toks[b-1].Source[1]}
}

type pendingKid struct {
	n      *dn
	splice bool // the prefix of a trailing repetition
}

// treeFrame is a rule node being built; pending holds its remaining
// children in reverse, the next one last.
type treeFrame struct {
	node    *Node
	pending []pendingKid
}

// pushKids pushes a close's children onto a pending stack, the first last,
// marking the first as spliced when the close is a trailing repetition's.
func pushKids(pending []pendingKid, n *dn, splice bool) []pendingKid {
	kids := flattenKids(n.a)
	for i := len(kids) - 1; i >= 0; i-- {
		pending = append(pending, pendingKid{n: kids[i], splice: splice && i == 0 && n.prod.repeatPrefix})
	}
	return pending
}

// buildTree turns a derivation of a constituent into the result's tree.
func (run *stageRun) buildTree(rec *recognizer, d *dn) *Node {
	base := rec.base
	g := rec.g
	newRule := func(n *dn) *treeFrame {
		a, b := base+int(n.start), base+int(n.end)
		node := &Node{Kind: KindRule, Rule: n.prod.ruleName, Span: [2]int{a, b}, Source: run.spanSource(a, b), Tags: n.tags.toMap(), Children: []*Node{}}
		return &treeFrame{node: node, pending: pushKids(nil, n, true)}
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
		k := f.pending[len(f.pending)-1]
		f.pending = f.pending[:len(f.pending)-1]
		n := k.n
		switch {
		case n.kind == dRead:
			i := base + int(n.tok)
			f.node.Children = append(f.node.Children, &Node{Kind: KindToken, Terminal: g.terminals[n.term], Token: i, Span: [2]int{i, i + 1}, Source: run.toks[i].Source})
		case n.prod.helper && n.a == nil && n.prod.elided != "":
			p := base + int(n.start)
			f.node.Children = append(f.node.Children, &Node{Kind: KindElided, Terminal: n.prod.elided, Span: [2]int{p, p}, Source: run.emptySource(p)})
		case n.prod.helper || k.splice:
			f.pending = pushKids(f.pending, n, k.splice)
		default:
			stack = append(stack, newRule(n))
		}
	}
	return root.node
}

// warnings lists the warnings of a chosen derivation (engine §12): each rule
// node of its tree gives one for each warning of its production, in the
// order a walk meets the nodes, parent before children and children left to
// right. Helpers and the prefixes of a trailing repetition give their
// children in their place, as in buildTree.
func (run *stageRun) warnings(rec *recognizer, d *dn) []Warning {
	var out []Warning
	pending := []pendingKid{{n: d}}
	for len(pending) > 0 {
		k := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		n := k.n
		if n.kind == dRead {
			continue
		}
		if !n.prod.helper && !k.splice {
			a, b := rec.base+int(n.start), rec.base+int(n.end)
			for _, f := range n.prod.warnings {
				out = append(out, Warning{Stage: run.name, Feature: f, Rule: n.prod.ruleName, Span: [2]int{a, b}, Source: run.spanSource(a, b)})
			}
		}
		// buildTree splices the first child of a rule node or of a spliced
		// prefix whose production is r → r x; a helper's never is, so true
		// serves for every close.
		pending = pushKids(pending, n, true)
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

// ---- emission

type emitTask struct {
	walk *dn
	emit *dn
	tags *tagset
	tok  *Token
}

func (run *stageRun) kidSpan(rec *recognizer, k *dn) (int, int, *tagset) {
	if k.kind == dRead {
		i := rec.base + int(k.tok)
		return i, i + 1, run.tagsets[i]
	}
	return rec.base + int(k.start), rec.base + int(k.end), k.tags
}

// emit walks the chosen derivation from the left and returns the tokens of
// the next stage.
func (run *stageRun) emit(rec *recognizer, d *dn) []Token {
	out := []Token{}
	stack := []emitTask{{walk: d}}
	for len(stack) > 0 {
		t := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		switch {
		case t.tok != nil:
			out = append(out, *t.tok)
		case t.emit != nil:
			out = append(out, run.emitted(rec, t.emit, t.tags))
		case t.walk != nil:
			n := t.walk
			if n.kind == dRead {
				continue
			}
			plan := run.plan(rec, n)
			for i := len(plan) - 1; i >= 0; i-- {
				stack = append(stack, plan[i])
			}
		}
	}
	return out
}

// plan is what one constituent's emission clause does, in order.
func (run *stageRun) plan(rec *recognizer, n *dn) []emitTask {
	p := n.prod
	kids := flattenKids(n.a)
	if p.emit == nil {
		plan := make([]emitTask, len(kids))
		for i, k := range kids {
			plan[i] = emitTask{walk: k}
		}
		return plan
	}
	if p.nothing {
		return nil
	}
	start, end := rec.base+int(n.start), rec.base+int(n.end)
	ev := run.evaluator(rec.g, func(name string) (spanVal, bool) {
		if name == "" {
			return spanVal{a: start, b: end, whole: true, tags: n.tags}, true
		}
		for i, c := range p.capName {
			if c == name {
				a, b, tags := run.kidSpan(rec, kids[i])
				return spanVal{a: a, b: b, whole: true, tags: tags}, true
			}
		}
		return spanVal{}, false
	})
	// An item's tag term that gives no tags is an error of the grammar: no
	// terminal could read the token (§11).
	itemTags := func(it *domEmitItem, own *tagset) *tagset {
		if it.Tags == nil {
			return own
		}
		tags := ev.tagsOf(it.Tags)
		if len(tags.names) == 0 {
			panic(&parseFailure{message: p.ruleName + " emits a token with no tags", token: start, tokenEnd: end, hasToken: true, rule: p.ruleName})
		}
		return tags
	}
	// The items as listed, and nothing else of the constituent (§11).
	part := func(name string) *dn {
		for i, c := range p.capName {
			if c == name {
				return kids[i]
			}
		}
		return nil
	}
	var plan []emitTask
	for i, it := range p.emit.Items {
		switch {
		case it.IsInsert:
			// Its span is empty at the start of the part of the capture
			// listed next after it, or at the constituent's end.
			at := end
			for _, next := range p.emit.Items[i+1:] {
				if !next.IsInsert {
					if k := part(next.Capture); k != nil {
						at, _, _ = run.kidSpan(rec, k)
					}
					break
				}
			}
			plan = append(plan, run.inserted(it.Insert, at, start, end, p.ruleName))
		case it.Capture == "":
			plan = append(plan, emitTask{emit: n, tags: itemTags(it, n.tags)})
		default:
			k := part(it.Capture)
			_, _, own := run.kidSpan(rec, k)
			plan = append(plan, emitTask{emit: k, tags: itemTags(it, own)})
		}
	}
	return plan
}

// inserted is the token of an inserted tag at token position at of a
// constituent over [start, end): its source is empty at the source end of
// the token before, or at the constituent's source start if at is its
// start (§11).
func (run *stageRun) inserted(tag string, at, start, end int, rule string) emitTask {
	src := run.spanSource(start, end)
	if at > start {
		e := run.toks[at-1].Source[1]
		src = [2]int{e, e}
	} else {
		src = [2]int{src[0], src[0]}
	}
	tok := &Token{Text: "", Tags: map[string]bool{tag: true}, Span: [2]int{at, at}, Source: src, InsertedBy: rule}
	if ph, ok := phonemeTag(tag); ok {
		tok.Phonemes = ph
	}
	return emitTask{tok: tok}
}

// emitted is the token a constituent emits, with the given tags.
func (run *stageRun) emitted(rec *recognizer, n *dn, tags *tagset) Token {
	a, b, _ := run.kidSpan(rec, n)
	src := run.spanSource(a, b)
	tok := Token{Text: string(run.ps.text[src[0]:src[1]]), Tags: tags.toMap(), Span: [2]int{a, b}, Source: src}
	var strong []string
	for i, name := range tags.names {
		if ph, ok := phonemeTag(name); ok && tags.strong[i] {
			strong = append(strong, ph)
		}
	}
	if len(strong) > 1 {
		panic(&parseFailure{message: "an emitted token has two strong phoneme tags", token: a, tokenEnd: b, hasToken: true})
	}
	if len(strong) == 1 {
		tok.Phonemes = strong[0]
		return tok
	}
	// The phonemes of the tokens it covers, joined, leaving out every token
	// inside a constituent that does not count, its own included (§5).
	var sb strings.Builder
	stack := []*dn{n}
	for len(stack) > 0 {
		x := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		switch x.kind {
		case dRead:
			sb.WriteString(run.toks[rec.base+int(x.tok)].Phonemes)
		case dClose:
			if x.prod.nothing || x.a == nil {
				continue
			}
			stack = append(stack, x.a)
		case dPart:
			stack = append(stack, x.b)
			if x.a != nil {
				stack = append(stack, x.a)
			}
		}
	}
	tok.Phonemes = tidyPauses(sb.String())
	return tok
}

// tidyPauses makes each run of pauses, ., one, and removes a pause at
// either end (§5).
func tidyPauses(s string) string {
	if !strings.Contains(s, ".") {
		return s
	}
	// . is one byte, and never part of another code point's encoding.
	b := make([]byte, 0, len(s))
	pause := false
	for i := 0; i < len(s); i++ {
		if s[i] == '.' {
			pause = len(b) > 0
			continue
		}
		if pause {
			b = append(b, '.')
			pause = false
		}
		b = append(b, s[i])
	}
	return string(b)
}
