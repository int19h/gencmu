package gencmu

import (
	"fmt"
	"math"
	"runtime"
	"strings"
	"testing"
	"time"
)

// bestOf is the shortest of three runs of f.
func bestOf(f func()) time.Duration {
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
	linearTime(t, "links", 30000, func(n int) {
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
	})
}

// TestUnionsLinear: tags() of a long span, a union of many parts and a
// constant of many parts gather their members once, without copying a
// growing set at each part (engine §10).
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
	linearTime(t, "tags of a span", 20000, func(n int) {
		run := tagRun(n)
		if got := len(run.evaluator(nil, nil).spanTags(spanVal{a: 0, b: n}).names); got != n+1 {
			t.Fatalf("%d tags, not %d", got, n+1)
		}
	})
	linearTime(t, "a union of parts", 30000, func(n int) {
		run := tagRun(1)
		if got := len(run.evaluator(nil, nil).term(tagUnion(n)).set.names); got != n {
			t.Fatalf("%d tags, not %d", got, n)
		}
	})
	linearTime(t, "a constant union", 20000, func(n int) {
		v, err := (&stageGrammar{}).evaluateClosed("", tagUnion(n), [2]int{})
		if err != nil || len(v.names) != n {
			t.Fatalf("%v, not %d tags", err, n)
		}
	})
}

// tagUnion is the term ~T0 ∪ ~T1 ∪ … of n parts.
func tagUnion(n int) *domTerm {
	union := &domTerm{Kind: tmUnion}
	for i := range n {
		union.Items = append(union.Items, &domTerm{Kind: tmTag, Str: fmt.Sprintf("T%d", i)})
	}
	return union
}
