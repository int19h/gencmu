package gencmu

import (
	"strings"
	"testing"
)

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
