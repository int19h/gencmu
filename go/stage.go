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
	nested     map[nestedKey]*nestedResult
}

func newParseState(uni *unicodeTable, text []rune) *parseState {
	ps := &parseState{uni: uni, in: newInterner(), text: text, nested: map[nestedKey]*nestedResult{}}
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

// characterTokens is the first stage's input (engine §1).
func (ps *parseState) characterTokens() []Token {
	toks := make([]Token, len(ps.text))
	for i, c := range ps.text {
		toks[i] = Token{Text: string(c), Tags: map[string]bool{string(c): true, ps.uni.class(c): false}, Span: [2]int{i, i + 1}, Source: [2]int{i, i + 1}}
	}
	return toks
}

type stageRun struct {
	ps      *parseState
	name    string
	grammar *stageGrammar
	toks    []Token
	tagsets []*tagset
}

func (ps *parseState) newRun(name string, grammar *stageGrammar, toks []Token) *stageRun {
	run := &stageRun{ps: ps, name: name, grammar: grammar, toks: toks, tagsets: make([]*tagset, len(toks))}
	for i := range toks {
		run.tagsets[i] = ps.in.fromMap(toks[i].Tags)
	}
	return run
}

// stageOutcome is one stage's part of the result.
type stageOutcome struct {
	stage Stage
	tree  *Node
	err   *ParseError
	words []*Node // for auto features: nothing; the tree is enough
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
			out.stage.Output = nil
			out.stage.Verdict = ""
			out.stage.Witness, out.stage.Tied = nil, nil
			out.tree = nil
			out.err = run.failure(f)
		}
	}()
	start := g.byName["text"]
	rec := run.recognize(g, start, 0, len(run.toks))
	top := rec.accepted(start)
	var res *rankResult
	if len(top) > 0 {
		res = newRanker(rec, g.lean).rank(top)
	}
	if res == nil {
		out.err = run.rejection(rec)
		return out
	}
	switch {
	case res.count == 1:
		out.stage.Verdict = VerdictUnique
	case res.tied != nil:
		out.stage.Verdict = VerdictTie
		out.stage.Tied = run.buildTree(rec, res.tied)
		out.stage.Witness = run.actions(rec, res.witness)
	default:
		out.stage.Verdict = VerdictResolved
	}
	out.tree = run.buildTree(rec, res.chosen)
	if elisionOnly && out.stage.Verdict != VerdictUnique {
		if err := run.checkElision(out.tree, mandatory()); err != nil {
			out.err = err
			out.tree = nil
			return out
		}
	}
	out.stage.Output = run.emit(rec, res.chosen)
	return out
}

func (run *stageRun) rejection(rec *recognizer) *ParseError {
	k := rec.furthest
	rules := map[string]map[string]bool{}
	expect := func(p *production, pos int) {
		if pos < len(p.rhs) && p.rhs[pos].term {
			t := rec.g.terminals[p.rhs[pos].id]
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
				if rec.predictable(p) {
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

func (run *stageRun) failure(f *parseFailure) *ParseError {
	e := &ParseError{Kind: ErrorGrammar, Stage: run.name, Message: "stage " + run.name + ": " + f.message}
	if f.hasToken {
		tok := f.token
		src := run.spanSource(f.token, f.tokenEnd)
		e.Token, e.Source = &tok, &src
	}
	if f.rule != "" {
		if r := run.grammar.byName[f.rule]; r != nil {
			e.Document, e.Line, e.Column = r.doc, r.at[0], r.at[1]
		}
	}
	return e
}

// checkElision is engine §7: write the chosen tree's elided terminators back
// and parse again with none elidable; only strong and weak tags may choose.
func (run *stageRun) checkElision(tree *Node, g *lowered) *ParseError {
	elided := elidedNodes(tree)
	var toks []Token
	var orig []int // new index → original index, or -1 for a written-back terminator
	var terms []string
	e := 0
	for i := 0; i <= len(run.toks); i++ {
		for e < len(elided) && elided[e].Span[0] == i {
			src := run.emptySource(i)
			toks = append(toks, Token{Tags: map[string]bool{elided[e].Terminal: true}, Span: [2]int{i, i}, Source: src})
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
	res := newRanker(rec, "").rank(top)
	if res == nil || res.tied == nil {
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
	readings := []*Node{mapTree(run2.buildTree(rec, res.chosen)), mapTree(run2.buildTree(rec, res.tied))}
	return &ParseError{Kind: ErrorAmbiguous, Stage: run.name, Readings: readings,
		Message: "stage " + run.name + ": the text is ambiguous even with every elided terminator written"}
}
