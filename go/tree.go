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
	if p.emit.Nothing {
		return nil
	}
	ev := run.evaluator(rec.g, func(name string) (spanVal, bool) {
		for i, c := range p.capName {
			if c == name {
				a, b, tags := run.kidSpan(rec, kids[i])
				return spanVal{a: a, b: b, whole: true, tags: tags}, true
			}
		}
		return spanVal{}, false
	})
	items := p.emit.Items
	allThis := len(items) > 0
	for _, it := range items {
		if !it.This {
			allThis = false
		}
	}
	if allThis {
		var plan []emitTask
		for _, it := range items {
			tags := n.tags
			if it.Tags != nil {
				tags = ev.tagsOf(it.Tags)
			}
			plan = append(plan, emitTask{emit: n, tags: tags})
		}
		return plan
	}
	start, end := rec.base+int(n.start), rec.base+int(n.end)
	insert := func(tag string, index int) emitTask {
		src := run.spanSource(start, end)
		if index > start {
			e := run.toks[index-1].Source[1]
			src = [2]int{e, e}
		} else {
			src = [2]int{src[0], src[0]}
		}
		tok := &Token{Text: "", Tags: map[string]bool{tag: true}, Span: [2]int{index, index}, Source: src, InsertedBy: p.ruleName}
		if ph, ok := phonemeTag(tag); ok {
			tok.Phonemes = ph
		}
		return emitTask{tok: tok}
	}
	// Each inserted tag goes after the capture listed before it, or before
	// the first capture listed if none is.
	named := map[string]*domEmitItem{}
	after := map[string][]string{}
	var leading []string
	firstCapture := ""
	lastCapture := ""
	for _, it := range items {
		switch {
		case it.IsInsert:
			if lastCapture == "" {
				leading = append(leading, it.Insert)
			} else {
				after[lastCapture] = append(after[lastCapture], it.Insert)
			}
		case it.Capture != "":
			named[it.Capture] = it
			lastCapture = it.Capture
			if firstCapture == "" {
				firstCapture = it.Capture
			}
		}
	}
	var plan []emitTask
	if firstCapture == "" {
		for _, tag := range leading {
			plan = append(plan, insert(tag, start))
		}
	}
	for i, k := range kids {
		name := p.capName[i]
		it := named[name]
		if name == "" || it == nil {
			plan = append(plan, emitTask{walk: k})
			continue
		}
		a, b, own := run.kidSpan(rec, k)
		if name == firstCapture {
			for _, tag := range leading {
				plan = append(plan, insert(tag, a))
			}
		}
		tags := own
		if it.Tags != nil {
			tags = ev.tagsOf(it.Tags)
		}
		plan = append(plan, emitTask{emit: k, tags: tags})
		for _, tag := range after[name] {
			plan = append(plan, insert(tag, b))
		}
	}
	return plan
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
	// The phonemes of the tokens it was emitted from, omitting what a
	// constituent that emits nothing covers.
	var sb strings.Builder
	stack := []*dn{n}
	for len(stack) > 0 {
		x := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		switch x.kind {
		case dRead:
			sb.WriteString(run.toks[rec.base+int(x.tok)].Phonemes)
		case dClose:
			if (x.prod.emit != nil && x.prod.emit.Nothing) || x.a == nil {
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
	tok.Phonemes = strings.Trim(sb.String(), " ")
	return tok
}
