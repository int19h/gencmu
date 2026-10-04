package gencmu

import (
	"strings"
	"testing"
)

// The maximality checks of a nested query read each completion once, so
// their work grows linearly with the input (engine §4). Each omission of the
// maximal T meets a longer y, whose completions from the start are as many
// as the input is long.
func TestMaximalWorkLinear(t *testing.T) {
	plain := "%ambiguity-resolution greedy\n%elidable maximal T\n%rule text body B\n%conditions begins(from($), r)\n%rule body A ...\n%rule r y [T]\n%rule y A ..."
	tested := "%ambiguity-resolution greedy\n%elidable maximal T\n%rule text body B\n%conditions begins(from($), r)\n%rule body A ...\n%rule r y⊇~p [T]\n%rule y A ... <~p>"
	for _, grammar := range []string{plain, tested} {
		d := mustLoad(t, oneStage(grammar))
		work := func(n int) (int64, int64, int64) {
			toks := make([]Token, n+1)
			for i := range toks {
				tag := "A"
				if i == n {
					tag = "B"
				}
				toks[i] = Token{Text: "x", Tags: []string{tag}, Span: [2]int{i, i + 1}, Source: [2]int{2 * i, 2*i + 1}}
			}
			w := countWork(t)
			if _, err := d.ParseTokens(strings.TrimSpace(strings.Repeat("x ", n+1)), toks, ParseOptions{}); err != nil {
				t.Fatal(err)
			}
			// The tables are found once, in one pass over the query's chart,
			// whose completed symbols are among the items that the parse
			// made. Tables found again for each check would read the chart
			// once per check, so this fails on the shorter input, before
			// the longer one costs much.
			if scanned, items := w.scanned.Load(), w.items.Load(); scanned == 0 || scanned > items {
				t.Fatalf("%d tokens: %d completed symbols read for the tables, of %d items made", n, scanned, items)
			}
			return w.checks.Load(), w.scanned.Load(), w.candidates.Load()
		}
		smallChecks, smallScanned, smallCandidates := work(1000)
		largeChecks, largeScanned, largeCandidates := work(4000)
		if smallChecks == 0 {
			t.Fatalf("the query made no maximality check")
		}
		// Four times the input, at most about four times the work.
		if largeChecks > 5*smallChecks || largeScanned > 5*smallScanned || largeCandidates > 5*max(smallCandidates, 1)+4 || largeCandidates > 2*4001 {
			t.Errorf("checks %d then %d, scanned %d then %d, candidates %d then %d", smallChecks, largeChecks, smallScanned, largeScanned, smallCandidates, largeCandidates)
		}
		t.Logf("checks %d then %d, scanned %d then %d, candidates %d then %d", smallChecks, largeChecks, smallScanned, largeScanned, smallCandidates, largeCandidates)
	}
}
