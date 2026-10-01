package gencmu

import (
	"fmt"
	"sort"
	"strings"
)

// parseState is what one Parse call shares across its stages and nested
// parses; nothing in it outlives the call.
type parseState struct {
	uni        *unicodeTable
	in         *interner
	text       []rune
	lineStarts []int
	// nested holds the answers of nested parses, and inProgress those now
	// running (terms.go).
	nested     map[nestedKey]*nestedResult
	inProgress map[spanKey]bool
	// ranges holds the tag set of each range a term has read, made once
	// (engine §10).
	ranges map[[2]string]*tagset
	// consts holds the tag set of each constant's value a term has read,
	// made once (engine §2).
	consts map[*constValue]*tagset
}

func newParseState(uni *unicodeTable, text []rune) *parseState {
	ps := &parseState{uni: uni, in: newInterner(), text: text, nested: map[nestedKey]*nestedResult{}, inProgress: map[spanKey]bool{}, ranges: map[[2]string]*tagset{}, consts: map[*constValue]*tagset{}}
	ps.lineStarts = []int{0}
	for i := 0; i < len(text); i++ {
		switch text[i] {
		case '\n':
			ps.lineStarts = append(ps.lineStarts, i+1)
		case '\r':
			if i+1 < len(text) && text[i+1] == '\n' {
				i++
			}
			ps.lineStarts = append(ps.lineStarts, i+1)
		}
	}
	return ps
}

// lineColumn is a text position's line and column, from 1.
func (ps *parseState) lineColumn(pos int) (int, int) {
	i := sort.Search(len(ps.lineStarts), func(i int) bool { return ps.lineStarts[i] > pos }) - 1
	if i < 0 {
		i = 0
	}
	return i + 1, pos - ps.lineStarts[i] + 1
}

// characterTokens is the first stage's input (engine §1): one token per
// code point, tagged with its character tag and nothing else.
func (ps *parseState) characterTokens() []Token {
	toks := make([]Token, len(ps.text))
	for i, c := range ps.text {
		tags := []string{characterTag(c, ps.uni.isMark)}
		toks[i] = Token{Text: string(c), Label: string(c), Tags: tags, Span: [2]int{i, i + 1}, Source: [2]int{i, i + 1}}
	}
	return toks
}

type stageRun struct {
	ps      *parseState
	name    string
	grammar *stageGrammar
	toks    []Token
	tagsets []*tagset
	// inputStart and inputEnd are where the input of the recognition now
	// running begins and ends; outside one, the stage's input.
	inputStart, inputEnd int
	// sources answers where a run of toks lies in the text, made at the
	// first question (see spanSource); nil when toks are in order.
	sources     *sourceTable
	sourcesMade bool
	// sounds holds each token's phonemes in canonical form, for the sound
	// tests of symbols and for phonemes(), computed when one first
	// looks at the token (§4, §5).
	sounds     []string
	soundsMade []bool
}

// sound is a token's phonemes in canonical form (§5). The lowercase mapping
// and the removal of commas act on each code point alone, so the canonical
// sound of a span is its tokens' joined.
func (run *stageRun) sound(i int) string {
	if run.sounds == nil {
		run.sounds = make([]string, len(run.toks))
		run.soundsMade = make([]bool, len(run.toks))
	}
	if !run.soundsMade[i] {
		run.sounds[i] = run.ps.uni.canonical(run.toks[i].Phonemes)
		run.soundsMade[i] = true
	}
	return run.sounds[i]
}

// soundIs says whether the tokens [a, b) sound like a string: their
// canonical sound is exactly it (§4, §5). A token with no phonemes adds
// nothing, and an empty span sounds like the empty string.
func (run *stageRun) soundIs(sound string, a, b int) bool {
	offset := 0
	for i := a; i < b; i++ {
		s := run.sound(i)
		if !strings.HasPrefix(sound[offset:], s) {
			return false
		}
		offset += len(s)
	}
	return offset == len(sound)
}

// testHolds says whether a test holds of a symbol's own span, the tokens
// [a, b), and its own tags (§4): a token's for a terminal, the completed
// item's for a reference.
func (run *stageRun) testHolds(t *symTest, a, b int, tags *tagset) bool {
	switch t.op {
	case "=", "≠":
		return run.soundIs(t.sound, a, b) == (t.op == "=")
	case "⊇", "⊉":
		all := true
		for _, name := range t.tags {
			if !tags.has(name) {
				all = false
				break
			}
		}
		return all == (t.op == "⊇")
	}
	meets := false
	for _, name := range t.tags {
		if tags.has(name) {
			meets = true
			break
		}
	}
	return meets == (t.op == "∩≠∅")
}

func (ps *parseState) newRun(name string, grammar *stageGrammar, toks []Token) *stageRun {
	run := &stageRun{ps: ps, name: name, grammar: grammar, toks: toks, tagsets: make([]*tagset, len(toks)), inputEnd: len(toks)}
	for i := range toks {
		run.tagsets[i] = ps.in.fromList(toks[i].Tags)
	}
	return run
}

// stageOutcome is one stage's part of the result.
type stageOutcome struct {
	stage    Stage
	tree     *Node
	err      *ParseError
	warnings []Warning // those of the chosen tree (§12)
}

func (run *stageRun) actions(rec *recognizer, w [2]action) []Action {
	out := make([]Action, 2)
	for i, a := range w {
		if a.read {
			out[i] = Action{Read: &ReadAction{Token: rec.base + int(a.tok), Terminal: rec.g.terminals[a.term]}}
		} else if a.prod != nil {
			out[i] = Action{Close: &CloseAction{Rule: a.prod.ruleName, Production: a.prod.num, Span: [2]int{rec.base + int(a.start), rec.base + int(a.end)}}}
		}
	}
	return out
}

// run runs one stage over its input (engine §4-§7, §11, §12).
func (run *stageRun) run(g *lowered, mandatory func() *lowered, elisionOnly bool) (out stageOutcome) {
	out.stage = Stage{Name: run.name, Input: run.toks}
	defer func() {
		if x := recover(); x != nil {
			f, ok := x.(*parseFailure)
			if !ok {
				panic(x)
			}
			// A fault found once the stage has chosen its tree, while
			// emitting or in the reparse of elision-only, leaves it without
			// output; it keeps its verdict, witness, tied tree and warnings,
			// none of which is set if the fault came earlier (§7, §11, §12).
			out.stage.Output = nil
			out.tree = nil
			out.err = run.failure(f)
		}
	}()
	// An error of the grammar that lowering for these features found is a
	// result like one found while parsing (§3.3).
	if g.fault != "" {
		panic(&parseFailure{message: g.fault})
	}
	start := g.byName["text"]
	rec := run.recognize(g, start, 0, len(run.toks))
	top := rec.accepted(start)
	var mx *maximal
	if g.maximal {
		mx = newMaximal(rec)
	}
	var res *rankResult
	if len(top) > 0 {
		res = newRanker(rec, g.lean, mx).rank(top)
	}
	if res == nil {
		// A text that maximal leaves with no derivation is rejected at the
		// first terminator it forbids in the derivation the stage would
		// otherwise have chosen (§4).
		if mx != nil && len(top) > 0 {
			if other := newRanker(rec, g.lean, nil).rank(top); other != nil {
				out.err = run.forbiddenTerminator(rec, other.first, mx)
			}
		}
		if out.err == nil {
			out.err = run.rejection(rec)
		}
		return out
	}
	out.stage.Verdict = res.verdict
	if res.verdict == VerdictTie {
		out.stage.Witness = run.actions(rec, res.witness)
	}
	out.tree = run.buildTree(rec, res.first)
	// Only the chosen tree gives warnings: not the tied one, nor the reparse
	// of elision-only (§12).
	if g.warns {
		out.warnings = run.warnings(rec, res.first)
	}
	if elisionOnly && out.stage.Verdict != VerdictUnique {
		if err := run.checkElision(out.tree, mandatory()); err != nil {
			// The stage accepted its input: it keeps its verdict, witness,
			// tied tree and output, and the result has no tree (§7).
			out.err = err
			out.tree = nil
		}
	}
	out.stage.Output = run.emit(rec, res.first)
	return out
}

func (run *stageRun) rejection(rec *recognizer) *ParseError {
	k := rec.furthest
	rules := map[string]map[string]bool{}
	expect := func(p *production, pos int) {
		if pos < len(p.rhs) && p.rhs[pos].term {
			// A tested terminal is written with its test (docs/output.md).
			t := writtenSymbol(rec.g.terminals[p.rhs[pos].id], p.testAt(pos))
			if rules[t] == nil {
				rules[t] = map[string]bool{}
			}
			rules[t][p.ruleName] = true
		}
	}
	if k < len(rec.sets) {
		for _, it := range rec.sets[k].items {
			expect(it.prod, int(it.dot))
		}
		// The predictions left out because they could not read the next
		// token (earley.go, predict).
		for rule := range rec.sets[k].predicted {
			for _, p := range rec.g.rules[rule].prods {
				if rec.predictable(p, k) {
					expect(p, 0)
				}
			}
		}
	}
	var expected []Expected
	for t, rs := range rules {
		e := Expected{Terminal: t}
		for r := range rs {
			e.Rules = append(e.Rules, r)
		}
		sort.Strings(e.Rules)
		expected = append(expected, e)
	}
	sort.Slice(expected, func(i, j int) bool { return expected[i].Terminal < expected[j].Terminal })
	return run.rejectedAt(k, expected)
}

// forbiddenTerminator is the rejection of a text that maximal leaves with no
// derivation (§4): of the derivation d the stage would otherwise have chosen,
// the first elided terminator, in the order of the tree's leaves, that
// maximal forbids, at its position, with its terminal and the rule its
// optional is written in as the one expected there. It is nil if d has none.
func (run *stageRun) forbiddenTerminator(rec *recognizer, d *dn, mx *maximal) *ParseError {
	type frame struct {
		prod *production
		kids []*dn
		next int
	}
	stack := []frame{{prod: d.prod, kids: flattenKids(d.a)}}
	for len(stack) > 0 {
		f := &stack[len(stack)-1]
		if f.next == len(f.kids) {
			stack = stack[:len(stack)-1]
			continue
		}
		i := f.next
		f.next++
		k := f.kids[i]
		if k.kind == dRead {
			continue
		}
		if i > 0 && mx.elided(k.prod.lhs, k.start, k.end) {
			// Its constituent is the node before it, unless that is a token,
			// or what a production whose first symbol is its own rule has
			// read so far.
			rhs := f.prod.rhs
			own := i == 1 && !rhs[0].term && rhs[0].id == f.prod.lhs
			if b := f.kids[i-1]; !own && b.kind == dClose && mx.forbids(b.prod.lhs, b.start, b.end, f.prod.testAt(i-1)) {
				expected := []Expected{{Terminal: writtenSymbol(mx.elides[k.prod.lhs], k.prod.elidedTest), Rules: []string{k.prod.ruleName}}}
				return run.rejectedAt(rec.base+int(k.start), expected)
			}
		}
		stack = append(stack, frame{prod: k.prod, kids: flattenKids(k.a)})
	}
	return nil
}

// rejectedAt is the error of a text rejected at token k, where the expected
// terminals could have been read.
func (run *stageRun) rejectedAt(k int, expected []Expected) *ParseError {
	var src [2]int
	if k < len(run.toks) {
		src = run.toks[k].Source
	} else if len(run.toks) > 0 {
		e := run.toks[len(run.toks)-1].Source[1]
		src = [2]int{e, e}
	} else {
		src = [2]int{len(run.ps.text), len(run.ps.text)}
	}
	line, col := run.ps.lineColumn(src[0])
	tok := k
	var names []string
	for _, e := range expected {
		names = append(names, e.Terminal)
	}
	what := "the end of the text"
	if k < len(run.toks) {
		what = fmt.Sprintf("%q", run.toks[k].Text)
	}
	msg := fmt.Sprintf("stage %s: the grammar does not accept %s at line %d, column %d", run.name, what, line, col)
	if len(names) > 0 {
		msg += "; expected " + strings.Join(names, ", ")
	}
	return &ParseError{Kind: ErrorRejected, Stage: run.name, Token: &tok, Source: &src, Line: line, Column: col, Expected: expected, Message: msg}
}

// failure is a grammar error found while parsing: its kind, stage and
// message, and no position (§13).
func (run *stageRun) failure(f *parseFailure) *ParseError {
	return &ParseError{Kind: ErrorGrammar, Stage: run.name, Message: "stage " + run.name + ": " + f.message}
}

// checkElision is engine §7: write the chosen tree's elided terminators back
// and parse again with none elidable. The check passes when that parse has
// one derivation or none, and fails with two readings when it has more:
// ranked with no lean, any two derivations that differ are tied.
func (run *stageRun) checkElision(tree *Node, g *lowered) *ParseError {
	elided := elidedNodes(tree)
	var toks []Token
	var orig []int // new index → original index, or -1 for a written-back terminator
	var terms []string
	e := 0
	for i := 0; i <= len(run.toks); i++ {
		for e < len(elided) && elided[e].Span[0] == i {
			src := run.emptySource(i)
			// A restored terminator with an = test sounds like the test's
			// string, so that it matches its own terminator in the stricter
			// grammar (§7).
			toks = append(toks, Token{Tags: []string{elided[e].Terminal}, Phonemes: elided[e].sound, Span: [2]int{i, i}, Source: src})
			orig = append(orig, -1)
			terms = append(terms, elided[e].Terminal)
			e++
		}
		if i < len(run.toks) {
			toks = append(toks, run.toks[i])
			orig = append(orig, i)
			terms = append(terms, "")
		}
	}
	run2 := run.ps.newRun(run.name, run.grammar, toks)
	start := g.byName["text"]
	rec := run2.recognize(g, start, 0, len(toks))
	top := rec.accepted(start)
	if len(top) == 0 {
		return nil
	}
	res := newRanker(rec, "", nil).rank(top)
	if res == nil || res.second == nil {
		return nil
	}
	before := make([]int, len(toks)+1)
	for j := range toks {
		before[j+1] = before[j]
		if orig[j] >= 0 {
			before[j+1]++
		}
	}
	mapTree := func(root *Node) *Node {
		stack := []*Node{root}
		for len(stack) > 0 {
			n := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			switch n.Kind {
			case KindToken:
				j := n.Token
				if orig[j] < 0 {
					p := before[j]
					*n = Node{Kind: KindElided, Terminal: n.Terminal, Span: [2]int{p, p}, Source: run.emptySource(p)}
				} else {
					i := orig[j]
					n.Token, n.Span, n.Source = i, [2]int{i, i + 1}, run.toks[i].Source
				}
			default:
				a, b := before[n.Span[0]], before[n.Span[1]]
				n.Span, n.Source = [2]int{a, b}, run.spanSource(a, b)
			}
			stack = append(stack, n.Children...)
		}
		return root
	}
	readings := []*Node{mapTree(run2.buildTree(rec, res.first)), mapTree(run2.buildTree(rec, res.second))}
	return &ParseError{Kind: ErrorAmbiguous, Stage: run.name, Readings: readings,
		Message: "stage " + run.name + ": the text is ambiguous even with every elided terminator written"}
}

// writtenSymbol is a terminal as the diagnostics write it: its name,
// followed by its test if it has one, such as LE="la" (docs/output.md).
func writtenSymbol(name string, t *symTest) string {
	if t == nil {
		return name
	}
	return name + t.written
}

// elidedSound is the string of an elided terminator's = test, which a
// restored token sounds like (§7), or "".
func elidedSound(t *symTest) string {
	if t == nil || t.op != "=" {
		return ""
	}
	return t.sound
}
