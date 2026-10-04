package gencmu

import (
	"strings"
	"testing"
)

// The maximality checks of a nested query read each completion once, so
// their work grows linearly with the input (engine §4). Each omission of the
// maximal T meets a longer y, whose completions from the start are as many
// as the input is long. Each grammar asks for the tables again and again:
// the furthest end of y from the start; the furthest end where y's test
// holds, from the start; and, where matches() makes a tested y from every
// position, the completions of y from many origins.
func TestMaximalWorkLinear(t *testing.T) {
	plain := "%ambiguity-resolution greedy\n%rule text body B\n%conditions begins(from($), r)\n%rule body {A}\n%rule r y [++T]\n%rule y {A}"
	tested := "%ambiguity-resolution greedy\n%rule text body B\n%conditions begins(from($), r)\n%rule body {A}\n%rule r y⊇~p [++T]\n%rule y {A} <~p>"
	many := "%ambiguity-resolution greedy\n%rule text body B\n%conditions matches($, r)\n%rule body {A}\n%rule r parts B\n%rule parts {part}\n%rule part y⊇~p [++T]\n%rule y A <~p>"
	type counts struct{ checks, scanned, candidates int64 }
	for _, grammar := range []string{plain, tested, many} {
		d := mustLoad(t, oneStage(grammar))
		// A budget of 0 is none; the count past a budget stops the parse.
		work := func(n int, most counts) counts {
			toks := make([]Token, n+1)
			for i := range toks {
				tag := "A"
				if i == n {
					tag = "B"
				}
				toks[i] = Token{Text: "x", Tags: []string{tag}, Span: [2]int{i, i + 1}, Source: [2]int{2 * i, 2*i + 1}}
			}
			w := countWork(t)
			w.checks.most, w.scanned.most, w.candidates.most = most.checks, most.scanned, most.candidates
			// The tables are found once, in one pass over the query's chart,
			// whose completed symbols are among the items that the parse
			// made before. Tables found again for each check would read the
			// chart once per check, so the first read past the items made
			// stops the shorter input, before the longer one costs much.
			w.scanned.under = &w.items
			if _, err := d.ParseTokens(strings.TrimSpace(strings.Repeat("x ", n+1)), toks, ParseOptions{}); err != nil {
				t.Fatalf("%d tokens: %v", n, err)
			}
			if w.scanned.Load() == 0 {
				t.Fatalf("%d tokens: no completed symbol read for the tables", n)
			}
			return counts{w.checks.Load(), w.scanned.Load(), w.candidates.Load()}
		}
		// The test evaluations read each completion at most about twice.
		small := work(1000, counts{candidates: 2 * 1001})
		if small.checks == 0 {
			t.Fatalf("the query made no maximality check")
		}
		// Four times the input, at most about four times the work.
		most := counts{5 * small.checks, 5 * small.scanned, min(5*max(small.candidates, 1)+4, 2*4001)}
		large := work(4000, most)
		t.Logf("%+v then %+v", small, large)
	}
}
