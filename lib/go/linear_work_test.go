package gencmu

import (
	"encoding/json"
	"fmt"
	"math"
	"runtime"
	"runtime/debug"
	"strings"
	"testing"
	"time"
)

// bestOf is the shortest of three runs of f. The collector is off while f
// runs: it starts at a heap size set by what the test keeps alive, so it
// would run during a large run and not during a small one, and make work
// that is linear look superlinear.
func bestOf(f func()) time.Duration {
	defer debug.SetGCPercent(debug.SetGCPercent(-1))
	best := time.Duration(math.MaxInt64)
	for range 3 {
		runtime.GC()
		start := time.Now()
		f()
		best = min(best, time.Since(start))
	}
	return best
}

// linearTime checks that work(4n) takes at most eight times as long as
// work(n), the best of three runs each, with a millisecond to spare.
func linearTime(t *testing.T, what string, n int, work func(n int)) {
	t.Helper()
	small := bestOf(func() { work(n) })
	large := bestOf(func() { work(4 * n) })
	if large > 8*small+time.Millisecond {
		t.Errorf("%s: %v for %d, %v for %d", what, small, n, large, 4*n)
	}
	t.Logf("%s: %v for %d, %v for %d", what, small, n, large, 4*n)
}

// silentRun is a stage run over n tokens without phonemes, but for the last,
// which sounds like "a".
func silentRun(t *testing.T, n int) *stageRun {
	d := mustLoad(t, oneStage("%ambiguity-resolution greedy\n%rule text {A}"))
	toks := make([]Token, n)
	for i := range toks {
		toks[i] = Token{Text: "x", Tags: []string{"A"}, Span: [2]int{i, i + 1}, Source: [2]int{2 * i, 2*i + 1}}
	}
	toks[n-1].Phonemes = "a"
	ps := newParseState(d.uni, []rune(strings.TrimSpace(strings.Repeat("x ", n))))
	return ps.newRun("main", d.stages[0], toks)
}

// TestSilentSoundWork: a sound test and phonemes() over a span of tokens
// without phonemes skip them, so their work is bounded by the sound, not by
// the span (engine §4, §5).
func TestSilentSoundWork(t *testing.T) {
	for _, n := range []int{1000, 4000} {
		run := silentRun(t, n)
		for i := 0; i < n; i++ {
			if !run.soundIs("a", i, n) || run.soundIs("", i, n) || !run.soundIs("", i, n-1) {
				t.Fatalf("%d tokens: the wrong sound from %d", n, i)
			}
			if got := run.phonemes(spanVal{a: i, b: n}); got != "a" {
				t.Fatalf("%d tokens: phonemes from %d are %q", n, i, got)
			}
		}
		if run.soundSteps > 4*n {
			t.Errorf("%d tokens: %d steps for %d tests", n, run.soundSteps, 4*n)
		}
	}
}

// TestManyLinksAddLinear: in the check of elision-only, an item reached in
// many ways checks each new link against those it has without a scan of
// them all (engine §7.4).
func TestManyLinksAddLinear(t *testing.T) {
	for _, n := range []int{1000, 4000} {
		r := &recognizer{recon: &reconstruction{}}
		key := itemKey{prod: &production{rhs: make([]symbol, 1)}}
		for range 2 {
			for i := range n {
				r.add(0, key, link{tok: int32(i)}, true, false)
			}
		}
		if got := len(r.sets[0].index[key].links); got != n {
			t.Fatalf("%d links, not %d", got, n)
		}
		if r.linkSteps > 4*n+linkScanLimit*linkScanLimit {
			t.Errorf("%d links added twice: %d steps", n, r.linkSteps)
		}
	}
}

// TestUnionsLinear: tags() of a long span, a union of many parts and a
// constant of many parts gather their members once, without copying and
// interning a growing set at each part (engine §10).
func TestUnionsLinear(t *testing.T) {
	d := mustLoad(t, oneStage("%ambiguity-resolution greedy\n%rule text {A}"))
	tagRun := func(n int) *stageRun {
		toks := make([]Token, n)
		for i := range toks {
			toks[i] = Token{Text: "x", Tags: []string{"A", fmt.Sprintf("T%d", i)}, Span: [2]int{i, i + 1}, Source: [2]int{2 * i, 2*i + 1}}
		}
		ps := newParseState(d.uni, []rune(strings.TrimSpace(strings.Repeat("x ", n))))
		return ps.newRun("main", d.stages[0], toks)
	}
	// Each union of n parts interns at most a few times n members.
	for _, n := range []int{1000, 4000} {
		run := tagRun(n)
		internWork.names.Store(0)
		if got := len(run.evaluator(nil, nil).spanTags(spanVal{a: 0, b: n}).names); got != n+1 {
			t.Fatalf("%d tags, not %d", got, n+1)
		}
		if got := len(run.evaluator(nil, nil).term(tagUnion(n)).set.names); got != n {
			t.Fatalf("%d tags, not %d", got, n)
		}
		v, err := (&stageGrammar{}).evaluateClosed("", tagUnion(n), [2]int{})
		if err != nil || len(v.names) != n {
			t.Fatalf("%v, not %d tags", err, n)
		}
		if work := internWork.names.Load(); work > 8*int64(n) {
			t.Errorf("unions of %d parts: %d members interned", n, work)
		}
	}
}

// tagUnion is the term ~T0 ∪ ~T1 ∪ … of n parts.
func tagUnion(n int) *domTerm {
	union := &domTerm{Kind: tmUnion}
	for i := range n {
		union.Items = append(union.Items, &domTerm{Kind: tmTag, Str: fmt.Sprintf("T%d", i)})
	}
	return union
}

// domStage loads a one-stage dialect whose grammar is a DOM, given as
// JSON, so that a large grammar costs no reading of its notation.
func domStage(t *testing.T, dom string) *Dialect {
	t.Helper()
	l, err := bundledLoader()
	if err != nil {
		t.Fatal(err)
	}
	src := oneStage("")
	l.read = func(p string) (string, bool) { s, ok := src[p]; return s, ok }
	l.compiled = map[string]json.RawMessage{fnv1a64(src["g.md"]): json.RawMessage(dom)}
	d, err := l.dialect("p.md")
	if err != nil {
		t.Fatal(err)
	}
	return d
}

// TestEmissionLinear: a constituent of many captures that emits them with
// a run of inserted tags before them finds each part and each anchor
// without a scan of the production or of the items (engine §11).
func TestEmissionLinear(t *testing.T) {
	dialect := func(n int) *Dialect {
		seq := make([]string, n)
		items := make([]string, 0, 4*n)
		for i := range seq {
			seq[i] = fmt.Sprintf(`{"capture":"c%d","expr":{"ref":"A"}}`, i)
			items = append(items, `{"insert":"X"}`, `{"insert":"X"}`, `{"insert":"X"}`)
		}
		for i := range seq {
			items = append(items, fmt.Sprintf(`{"capture":"c%d"}`, i))
		}
		return domStage(t, fmt.Sprintf(`{"format":%d,"rules":[{"name":"text","op":"define","alternatives":[{"guards":[],"expr":{"seq":[%s]}}],"emit":{"items":[%s]},"conditions":[],"at":[1,1]}],"directives":[{"name":"ambiguity-resolution","args":["greedy"],"at":[2,1]}],"constants":[],"classifiers":[],"implications":[]}`, domFormat, strings.Join(seq, ","), strings.Join(items, ",")))
	}
	const n = 4000
	dialects := map[int]*Dialect{n: dialect(n), 4 * n: dialect(4 * n)}
	parse := func(n int) {
		toks := make([]Token, n)
		for i := range toks {
			toks[i] = Token{Text: "a", Tags: []string{"A"}, Span: [2]int{i, i + 1}, Source: [2]int{2 * i, 2*i + 1}}
		}
		res, err := dialects[n].ParseTokens(strings.TrimSpace(strings.Repeat("a ", n)), toks, ParseOptions{})
		if err != nil || !res.OK || len(res.Stages[0].Output) != 4*n {
			t.Fatalf("%d captures: %v", n, err)
		}
	}
	// Once each first, so that lowering counts in neither.
	parse(n)
	parse(4 * n)
	linearTime(t, "emission", n, parse)
}

// seqDOM is the DOM of a grammar whose rule text is the sequence of items,
// each given as the JSON of an expression, with more rules after it.
func seqDOM(items []string, rules ...string) string {
	all := append([]string{`{"name":"text","op":"define","alternatives":[{"guards":[],"expr":{"seq":[` + strings.Join(items, ",") + `]}}],"conditions":[],"at":[1,1]}`}, rules...)
	return fmt.Sprintf(`{"format":%d,"rules":[%s],"directives":[{"name":"ambiguity-resolution","args":["greedy"],"at":[2,1]}],"constants":[],"classifiers":[],"implications":[]}`, domFormat, strings.Join(all, ","))
}

// TestLoweringLinear: lowering a long sequence copies each of its symbols
// a bounded number of times, not once for each symbol after it (engine §3).
func TestLoweringLinear(t *testing.T) {
	for _, n := range []int{1000, 4000} {
		d := domStage(t, seqDOM(strings.Split(strings.Repeat(`{"ref":"A"} `, n-1)+`{"ref":"A"}`, " ")))
		lowerWork.slots.Store(0)
		if l := lower(d.stages[0], map[string]bool{}); len(l.prods[0].rhs) != n {
			t.Fatalf("%d symbols, not %d", len(l.prods[0].rhs), n)
		}
		if work := lowerWork.slots.Load(); work > 4*int64(n) {
			t.Errorf("a sequence of %d: %d slots copied", n, work)
		}
	}
}

// TestCaptureSequencesLinear: the checks of a definition list the captures
// of a long sequence in one pass, without copying the sequence so far at
// each capture (engine §3.5).
func TestCaptureSequencesLinear(t *testing.T) {
	for _, n := range []int{1000, 4000} {
		seq := &domExpr{Kind: exSeq}
		for i := range n {
			seq.Items = append(seq.Items, &domExpr{Kind: exCapture, Name: fmt.Sprintf("c%d", i), Inner: &domExpr{Kind: exRef, Name: "A"}})
		}
		readerWork.steps.Store(0)
		caps := altCaptures(&domAlt{Expr: seq})
		if len(caps) != 1 || len(caps[0]) != n+1 {
			t.Fatalf("%d captures: %d sequences", n, len(caps))
		}
		if steps := readerWork.steps.Load(); steps > 8*int64(n) {
			t.Errorf("%d captures: %d steps", n, steps)
		}
	}
}
