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
			f.node.Children = append(f.node.Children, &Node{Kind: KindElided, Terminal: n.prod.elided, Span: [2]int{p, p}, Source: run.emptySource(p), sound: elidedSound(n.prod.elidedTest), tested: elidedTested(n.prod.elidedTest)})
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

// ---- emission

// An emitTask walks a constituent, emits a token over one, or makes an
// inserted token. inside says whether the constituent that it walks or emits
// lies inside an opaque part (§11). The ranking can share one node among
// several places of the chosen derivation, and only some of them can lie
// inside an opaque part. So the walk carries this with each place, and the
// node does not. A token's tags are evaluated when the task runs, so that
// the errors of a stage's emission come in the order of evaluation (§10,
// §11). An inserted token is made when its task runs too, for the same
// reason. before and after are the parts whose tokens a carrier takes as its
// attachments.
type emitTask struct {
	walk          *dn
	emit          *dn
	tags          func() *tagset
	insert        func() Token
	inside        bool
	before, after []*dn
}

// emitter is what one derivation's emission shares: its opaque parts,
// whether any input token has attachments to forward, and the input tokens
// whose attachments a token of this emission has inherited (§11).
type emitter struct {
	rec       *recognizer
	opaque    map[*dn]*opaquePart
	forwards  bool
	inherited map[int]bool
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
	// The opaque parts and their texts, fixed before any token (§11).
	em := &emitter{rec: rec, opaque: run.opaqueParts(rec, d), inherited: map[int]bool{}}
	for i := range run.toks {
		if hasAttachments(&run.toks[i]) {
			em.forwards = true
			break
		}
	}
	return run.emitWalk(em, d, false)
}

// emitWalk is what a constituent emits in its place in the derivation
// (§11): the stage's output from the root, or an attachment from a
// captured part. inside says whether the constituent lies inside an opaque
// part.
func (run *stageRun) emitWalk(em *emitter, d *dn, inside bool) []Token {
	rec := em.rec
	out := []Token{}
	stack := []emitTask{{walk: d, inside: inside}}
	for len(stack) > 0 {
		t := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		switch {
		case t.insert != nil:
			out = append(out, t.insert())
		case t.emit != nil:
			// Before-attachments, then the carrier with its tag term, then
			// after-attachments; the first error ends the emission. New
			// attachments are outer to inherited ones (§11).
			var before, after []Token
			for _, k := range t.before {
				before = append(before, attached(run.emitWalk(em, k, t.inside))...)
			}
			tok := run.emitted(em, t.emit, t.tags(), t.inside)
			for _, k := range t.after {
				after = append(after, attached(run.emitWalk(em, k, t.inside))...)
			}
			if len(before) > 0 {
				tok.Before = append(before, tok.Before...)
			}
			if len(after) > 0 {
				tok.After = append(tok.After[:len(tok.After):len(tok.After)], after...)
			}
			out = append(out, tok)
		case t.walk != nil:
			n := t.walk
			if n.kind == dRead {
				continue
			}
			plan := run.plan(rec, n, t.inside)
			for i := len(plan) - 1; i >= 0; i-- {
				stack = append(stack, plan[i])
			}
		}
	}
	return out
}

// hasAttachments says whether a token has attachments (§11).
func hasAttachments(t *Token) bool {
	return len(t.Before) > 0 || len(t.After) > 0
}

// attached is tokens as attachments: the same tokens without their spans,
// since a span counts the input of the stage that attached them (§11).
func attached(toks []Token) []Token {
	for i := range toks {
		toks[i].Span = [2]int{}
	}
	return toks
}

// plan is what one constituent's emission clause does, in order. inside
// says whether the constituent lies inside an opaque part.
func (run *stageRun) plan(rec *recognizer, n *dn, inside bool) []emitTask {
	p := n.prod
	kids := flattenKids(n.a)
	// Its children lie inside an opaque part if it is one or lies inside one.
	within := inside || p.opaque
	if p.emit == nil {
		plan := make([]emitTask, len(kids))
		for i, k := range kids {
			plan[i] = emitTask{walk: k, inside: within}
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
	itemTags := func(it *domEmitItem, own *tagset) func() *tagset {
		return func() *tagset {
			if it.Tags == nil {
				return own
			}
			tags := ev.tagsOf(it.Tags)
			if len(tags.names) == 0 {
				panic(&parseFailure{message: p.ruleName + " emits a token with no tags"})
			}
			return tags
		}
	}
	// The items as listed, and nothing else of the constituent but their
	// attachments (§11).
	part := func(name string) *dn {
		for i, c := range p.capName {
			if c == name {
				return kids[i]
			}
		}
		return nil
	}
	parts := func(names []string) []*dn {
		out := make([]*dn, 0, len(names))
		for _, name := range names {
			out = append(out, part(name))
		}
		return out
	}
	var plan []emitTask
	for i, it := range p.emit.Items {
		switch {
		case it.IsInsert:
			// Its span is empty at the start of its anchor, the first
			// written part of the capture item listed next after it, or at
			// the constituent's end.
			at := end
			for _, next := range p.emit.Items[i+1:] {
				if !next.IsInsert {
					anchor := next.Capture
					if len(next.Before) > 0 {
						anchor = next.Before[0]
					}
					if k := part(anchor); k != nil {
						at, _, _ = run.kidSpan(rec, k)
					}
					break
				}
			}
			plan = append(plan, run.inserted(it.Insert, at, start, end, p.ruleName))
		case it.Capture == "":
			plan = append(plan, emitTask{emit: n, tags: itemTags(it, n.tags), inside: inside})
		default:
			k := part(it.Capture)
			_, _, own := run.kidSpan(rec, k)
			plan = append(plan, emitTask{emit: k, tags: itemTags(it, own), inside: within, before: parts(it.Before), after: parts(it.After)})
		}
	}
	return plan
}

// inserted is the task that makes the token of an inserted tag at token
// position at of a constituent over [start, end): its source is empty at
// the source end of the token before, or at the constituent's source start
// if at is its start (§11).
func (run *stageRun) inserted(tag string, at, start, end int, rule string) emitTask {
	return emitTask{insert: func() Token { return run.insertedToken(tag, at, start, end, rule) }}
}

// insertedToken is the token that inserted describes.
func (run *stageRun) insertedToken(tag string, at, start, end int, rule string) Token {
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
	tok := Token{Text: "", Tags: tags.list(), Span: [2]int{at, at}, Source: src, InsertedBy: rule}
	// An inserted token has no parts: a phoneme tag gives its phonemes and
	// its label, or both are empty (§5). It reads no input, so the error of
	// two phoneme tags has no input position (§13, docs/output.md).
	if phoneme, ok := run.phonemeOf(tags); ok {
		tok.Phonemes, tok.Label = sounded(phoneme)
	}
	return tok
}

// emitted is the token a constituent emits, with the given explicit tags
// and those its stage's implications add to them. The emitter holds the
// sources and the texts of the derivation's opaque parts, and inside says
// whether the constituent lies inside an opaque part (§11).
func (run *stageRun) emitted(em *emitter, n *dn, explicit *tagset, inside bool) Token {
	rec, opaque := em.rec, em.opaque
	a, b, _ := run.kidSpan(rec, n)
	// The stage's implications apply before the phonemes and the label
	// (§11).
	tags := run.implied(explicit)
	// Two phoneme tags are an error on any token (§5).
	phoneme, ok := run.phonemeOf(tags)
	// A token over an opaque part has the part's source and text (§11).
	var tok Token
	if n.kind == dClose && n.prod.opaque && !inside {
		part := opaque[n]
		tok = Token{Text: part.text, Tags: tags.list(), Span: [2]int{a, b}, Source: part.source}
	} else {
		src := run.spanSource(a, b)
		tok = Token{Text: string(run.ps.text[src[0]:src[1]]), Tags: tags.list(), Span: [2]int{a, b}, Source: src}
	}
	// A phoneme tag decides the sound and the label, over ? (§5).
	if ok {
		tok.Phonemes, tok.Label = sounded(phoneme)
	} else {
		tok.Phonemes, tok.Label = run.spoken(rec, n, opaque, inside)
	}
	// The parts decide the attachments too, after the phoneme tags are
	// checked (§11).
	if em.forwards {
		if from := run.forwarded(rec, n, inside); from >= 0 {
			// Attachments belong to one token: an input token that is the
			// one part of a second token is an error of the grammar.
			if em.inherited[from] {
				panic(&parseFailure{message: "a token with attachments is the one part of two emitted tokens, and its attachments cannot belong to both"})
			}
			em.inherited[from] = true
			in := &run.toks[from]
			tok.Before, tok.After = in.Before[:len(in.Before):len(in.Before)], in.After[:len(in.After):len(in.After)]
		}
	}
	return tok
}

// forwarded is the input token whose attachments a token over n inherits,
// or -1 (§11). The parts are those of the join (§5): a read input token, or
// an opaque part as one piece, and nothing inside a constituent that emits
// ε. A token with attachments among other parts, or an opaque part that
// holds one, is an error of the grammar.
func (run *stageRun) forwarded(rec *recognizer, n *dn, inside bool) int {
	parts, found := 0, -1
	stack := []*dn{n}
	for len(stack) > 0 {
		x := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		switch x.kind {
		case dRead:
			parts++
			if i := rec.base + int(x.tok); hasAttachments(&run.toks[i]) {
				found = i
			}
		case dClose:
			if x.prod.nothing {
				continue
			}
			if x.prod.opaque && !inside {
				parts++
				if run.holdsAttachments(rec, x) {
					panic(&parseFailure{message: x.prod.ruleName + " is an opaque part over a token with attachments, which a token over it cannot place"})
				}
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
	if found >= 0 && parts > 1 {
		panic(&parseFailure{message: "a token over a token with attachments and another part cannot say which part each attachment belongs to"})
	}
	return found
}

// holdsAttachments says whether an opaque part holds an input token with
// attachments: one that it reads outside any constituent that emits ε
// (§11).
func (run *stageRun) holdsAttachments(rec *recognizer, n *dn) bool {
	stack := []*dn{n}
	for len(stack) > 0 {
		x := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		switch x.kind {
		case dRead:
			if hasAttachments(&run.toks[rec.base+int(x.tok)]) {
				return true
			}
		case dClose:
			if x.prod.nothing {
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
	return false
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
// of its parts, joined (§5, §11). A part is a read input token or an opaque
// part. Nothing inside a constituent that does not count is a part, and the
// walk does not enter an opaque part. inside says whether the constituent
// lies inside an opaque part. Then nothing in it is an opaque part.
// Otherwise the walk stops at the first %opaque constituent on each path,
// so no constituent that it reaches lies inside an opaque part.
func (run *stageRun) spoken(rec *recognizer, n *dn, opaque map[*dn]*opaquePart, inside bool) (string, string) {
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
			if x.prod.opaque && !inside {
				phonemes.add("?", false)
				label.add(opaque[x].text, false)
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

// opaquePart is the source and the text of an opaque part (§11).
type opaquePart struct {
	source [2]int
	text   string
}

// opaqueParts finds the opaque parts of a chosen derivation, with their
// sources and texts (§11): the constituents of %opaque productions inside
// no constituent that emits ε and no other opaque part. The stage fixes
// them before it emits anything, so that every token over a part holds the
// same text.
//
// The map holds the source and the text of each node that is an opaque part
// in some place of the derivation. It does not say which places those are,
// because a node can be shared by several places, and only some of them can
// be opaque parts. The emission walk decides that for each place. The
// source and the text depend only on the node's span, so they are the same
// in each place where the node is an opaque part.
func (run *stageRun) opaqueParts(rec *recognizer, root *dn) map[*dn]*opaquePart {
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
			if x.prod.opaque {
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
	out := make(map[*dn]*opaquePart, len(parts))
	for _, x := range parts {
		a, b := rec.base+int(x.start), rec.base+int(x.end)
		// An empty part takes in no text. Its source is that of an empty
		// node (§12).
		if a == b {
			out[x] = &opaquePart{source: run.emptySource(a)}
			continue
		}
		before := 0
		if a > 0 {
			before = run.toks[a-1].Source[1]
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
		out[x] = &opaquePart{source: [2]int{start, end}, text: string(run.ps.text[start:end])}
	}
	return out
}
