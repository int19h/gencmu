package gencmu

import "testing"

func TestDeferredEligibleWitnessesSeparateCarriedErrorsAndErasure(t *testing.T) {
	// Engine §4.3: E and F refer to the same supported proof.
	for _, grammar := range []struct {
		body               string
		ordinary, filtered bool
	}{
		{"%rule target A", true, false},
		{"%rule target A\n%error \"bad\"", false, false},
		{"%rule target hidden\n%erased\n%rule hidden A\n%error \"bad\"", true, true},
		{"%rule target A\n%error \"bad\"\n%erased", true, true},
	} {
		for _, dirty := range []bool{false, true} {
			pipeline := mustLoad(t, oneStage("%ambiguity-resolution greedy\n%rule text target\n"+grammar.body))
			lowered := pipeline.lower(0, map[string]bool{})
			token := Token{Text: "a", Value: "a", Image: "a", Tags: []string{"A"}, Span: [2]int{0, 1}, Source: [2]int{0, 1}}
			if dirty {
				token.Errors = []Warning{recordDiagnostic(Warning{Stage: "before", Code: "fault", Rule: "fault"}, fixedMeasure(1, 0, 1), nil)}
			}
			state := newParseState(pipeline.uni, []rune("a"))
			start := lowered.byName["target"]
			rec := state.newRun("main", pipeline.stages[0], []Token{token}).recognize(lowered, start, 0, 1)
			var roots []*item
			for _, symbol := range rec.sets[1].syms {
				if symbol.rule == start && symbol.start == 0 {
					roots = append(roots, symbol.items...)
				}
			}
			if got := len(rec.eligibleItems(roots, false)) > 0; got != grammar.ordinary {
				t.Fatalf("ordinary dirty=%v, %s: %v", dirty, grammar.body, got)
			}
			want := grammar.ordinary && !dirty || grammar.filtered
			if got := len(rec.eligibleItems(roots, true)) > 0; got != want {
				t.Fatalf("filtered dirty=%v, %s: %v, want %v", dirty, grammar.body, got, want)
			}
		}
	}
}
