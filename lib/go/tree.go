package gencmu

import (
	"math/bits"
	"strings"
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
		node := &Node{Kind: KindRule, Rule: n.prod.ruleName, Span: [2]int{a, b}, Source: run.spanSource(a, b), Tags: n.tags.list(), Children: []*Node{}}
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
			f.node.Children = append(f.node.Children, &Node{Kind: KindElided, Terminal: n.prod.elided, Span: [2]int{p, p}, Source: run.emptySource(p), sound: elidedSound(n.prod.elidedTest)})
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
	// The foreign parts and their texts, fixed before any token (§11).
	foreign := run.foreignParts(rec, d)
	stack := []emitTask{{walk: d}}
	for len(stack) > 0 {
		t := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		switch {
		case t.tok != nil:
			out = append(out, *t.tok)
		case t.emit != nil:
			out = append(out, run.emitted(rec, t.emit, t.tags, foreign))
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
			panic(&parseFailure{message: p.ruleName + " emits a token with no tags"})
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
	// The stage's implications apply before the phonemes and the label
	// (§11).
	tags := run.implied(run.ps.in.single(tag))
	tok := &Token{Text: "", Tags: tags.list(), Span: [2]int{at, at}, Source: src, InsertedBy: rule}
	// An inserted token has no parts: a phoneme tag gives its phonemes and
	// its label, or both are empty (§5). It reads no input, so the error of
	// two phoneme tags has no input position (§13, docs/output.md).
	if phoneme, ok := run.phonemeOf(tags); ok {
		tok.Phonemes, tok.Label = sounded(phoneme)
	}
	return emitTask{tok: tok}
}

// emitted is the token a constituent emits, with the given explicit tags
// and those its stage's implications add to them. foreign holds the
// derivation's foreign parts (§11).
func (run *stageRun) emitted(rec *recognizer, n *dn, explicit *tagset, foreign map[*dn]*foreignPart) Token {
	a, b, _ := run.kidSpan(rec, n)
	// The stage's implications apply before the phonemes and the label
	// (§11).
	tags := run.implied(explicit)
	// Two phoneme tags are an error on any token (§5).
	phoneme, ok := run.phonemeOf(tags)
	// A token over a foreign part has the part's source and text (§11).
	var tok Token
	if part := foreign[n]; part != nil {
		tok = Token{Text: part.text, Tags: tags.list(), Span: [2]int{a, b}, Source: part.source}
	} else {
		src := run.spanSource(a, b)
		tok = Token{Text: string(run.ps.text[src[0]:src[1]]), Tags: tags.list(), Span: [2]int{a, b}, Source: src}
	}
	// A phoneme tag decides the sound and the label, over ? (§5).
	if ok {
		tok.Phonemes, tok.Label = sounded(phoneme)
	} else {
		tok.Phonemes, tok.Label = run.spoken(rec, n, foreign)
	}
	return tok
}

// phonemeOf is the phoneme of the one phoneme tag among tags, if there is
// one. Two phoneme tags on one emitted token are an error of the grammar,
// found while parsing, so it has no position (§5, §13, docs/output.md).
func (run *stageRun) phonemeOf(tags *tagset) (string, bool) {
	var phonemes []string
	for _, name := range tags.names {
		if ph, ok := phonemeTag(name); ok {
			phonemes = append(phonemes, ph)
		}
	}
	if len(phonemes) > 1 {
		panic(&parseFailure{message: "an emitted token has two phoneme tags"})
	}
	if len(phonemes) == 1 {
		return phonemes[0], true
	}
	return "", false
}

// sounded is the phonemes and the label of a phoneme tag /p/: p and p, but
// a space for the label of the pause (§5).
func sounded(phoneme string) (string, string) {
	if phoneme == "." {
		return ".", " "
	}
	return phoneme, phoneme
}

// spoken is what a constituent says and shows: the phonemes and the labels
// of its parts, joined (§5, §11). A part is a read input token or a foreign
// part. Nothing inside a constituent that does not count is a part, and the
// walk does not enter a foreign part.
func (run *stageRun) spoken(rec *recognizer, n *dn, foreign map[*dn]*foreignPart) (string, string) {
	var phonemes, label join
	stack := []*dn{n}
	for len(stack) > 0 {
		x := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		switch x.kind {
		case dRead:
			t := &run.toks[rec.base+int(x.tok)]
			pause := t.Phonemes == "."
			phonemes.add(t.Phonemes, pause)
			label.add(t.Label, pause)
		case dClose:
			if x.prod.nothing {
				continue
			}
			if part := foreign[x]; part != nil {
				phonemes.add("?", false)
				label.add(part.text, false)
				continue
			}
			if x.a != nil {
				stack = append(stack, x.a)
			}
		case dPart:
			stack = append(stack, x.b)
			if x.a != nil {
				stack = append(stack, x.a)
			}
		}
	}
	return phonemes.sb.String(), label.sb.String()
}

// join is a join of the phonemes or of the labels of a token's parts (§5).
// It leaves out a part whose string is empty. Of each run of adjacent pause
// parts it keeps only the first, and it leaves out a pause part at either
// end. It counts the pauses by part, so a part keeps its own periods and
// spaces.
type join struct {
	sb strings.Builder
	// pending is the string of a pause part that follows the parts written
	// so far, written only if a part that is not a pause comes after it.
	pending string
}

func (j *join) add(piece string, pause bool) {
	switch {
	case piece == "":
	case pause:
		if j.sb.Len() > 0 && j.pending == "" {
			j.pending = piece
		}
	default:
		j.sb.WriteString(j.pending)
		j.pending = ""
		j.sb.WriteString(piece)
	}
}

// foreignPart is the source and the text of a foreign part (§11).
type foreignPart struct {
	source [2]int
	text   string
}

// foreignParts finds the foreign parts of a chosen derivation, with their
// sources and texts (§11): the constituents of %foreign productions inside
// no constituent that emits ε and no other foreign part. The stage fixes
// them before it emits anything, so that every token over a part holds the
// same text.
func (run *stageRun) foreignParts(rec *recognizer, root *dn) map[*dn]*foreignPart {
	var parts []*dn
	stack := []*dn{root}
	for len(stack) > 0 {
		x := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		switch x.kind {
		case dClose:
			if x.prod.nothing {
				continue
			}
			if x.prod.foreign {
				parts = append(parts, x)
				continue
			}
			if x.a != nil {
				stack = append(stack, x.a)
			}
		case dPart:
			stack = append(stack, x.b)
			if x.a != nil {
				stack = append(stack, x.a)
			}
		}
	}
	if len(parts) == 0 {
		return nil
	}
	// Text between two input tokens belongs to the part with a non-empty
	// span that ends there, before one that starts there.
	ends := map[int]bool{}
	for _, x := range parts {
		if x.start < x.end {
			ends[rec.base+int(x.end)] = true
		}
	}
	out := make(map[*dn]*foreignPart, len(parts))
	for _, x := range parts {
		a, b := rec.base+int(x.start), rec.base+int(x.end)
		before := 0
		if a > 0 {
			before = run.toks[a-1].Source[1]
		}
		// An empty part takes in no text.
		if a == b {
			out[x] = &foreignPart{source: [2]int{before, before}}
			continue
		}
		// It always holds its own tokens' sources, which the tokens next to
		// it can share, and takes in the text next to it that no input token
		// covers.
		own := run.spanSource(a, b)
		start, end := own[0], own[1]
		if !ends[a] && before < start {
			start = before
		}
		after := len(run.ps.text)
		if b < len(run.toks) {
			after = run.toks[b].Source[0]
		}
		if after > end {
			end = after
		}
		out[x] = &foreignPart{source: [2]int{start, end}, text: string(run.ps.text[start:end])}
	}
	return out
}
