package gencmu

import (
	"fmt"
	"strings"
	"testing"
)

func queryAnswer(t *testing.T, run *stageRun, grammar *lowered, kind, target string, filtered bool) bool {
	t.Helper()
	span := spanVal{a: 0, b: 1}
	answer, _, pending := run.nested(grammar, kind, target, span, filtered)
	if pending != nil {
		run.startQuery(pending)
		run.drive(pending.recognizer(run))
		answer, _, pending = run.nested(grammar, kind, target, span, filtered)
		if pending != nil {
			t.Fatal("completed query did not retain its answer")
		}
	}
	return answer
}

func queryRun(t *testing.T, pipeline *Pipeline, dirty bool) *stageRun {
	t.Helper()
	token := Token{Text: "a", Value: "a", Image: "a", Tags: []string{"A"}, Span: [2]int{0, 1}, Source: [2]int{0, 1}}
	if dirty {
		token.Errors = []Warning{recordDiagnostic(Warning{Stage: "before", Code: "fault", Rule: "fault"}, fixedMeasure(1, 0, 1), nil)}
	}
	state := newParseState(pipeline.uni, []rune("a"))
	state.memoLimit = defaultMemoLimit
	return state.newRun("main", pipeline.stages[0], []Token{token})
}

func TestDeferredQueriesKeepOrdinaryAndFilteredMemosSeparate(t *testing.T) {
	// Engine §4.3: carried errors bar only the filtered answer of a span.
	pipeline := mustLoad(t, oneStage("%ambiguity-resolution greedy\n%rule text target\n%rule target A"))
	lowered := pipeline.lower(0, map[string]bool{})
	for _, dirty := range []bool{false, true, false} {
		run := queryRun(t, pipeline, dirty)
		for _, kind := range []string{cdMatches, cdBegins, cdEnds} {
			if !queryAnswer(t, run, lowered, kind, "target", false) {
				t.Fatal("ordinary witness lost", dirty, kind)
			}
			if answer := queryAnswer(t, run, lowered, kind, "target", true); answer == dirty {
				t.Fatal("wrong filtered witness", dirty, kind, answer)
			}
		}
	}
}

func TestDeferredNestedFilteredAnswersMakeTheOuterMemoErrorDependent(t *testing.T) {
	// Engine §4.3: an ordinary outer query inherits its nested F dependency.
	pipeline := mustLoad(t, oneStage("%ambiguity-resolution greedy\n%rule text target\n%rule target A\n%conditions $.parse(A).error-free"))
	lowered := pipeline.lower(0, map[string]bool{})
	work := &workCounts{}
	countWorkIn(work, func() {
		if !lowered.readsCarriedErrors(lowered.byName["target"]) {
			t.Fatal("missing nested error dependency")
		}
	})
	first := work.clauseSteps.Load() + work.ruleSetSteps.Load()
	if first == 0 {
		t.Fatal("dependency walk is not counted")
	}
	countWorkIn(work, func() {
		for number := range lowered.rules {
			lowered.readsCarriedErrors(int32(number))
		}
	})
	if work.clauseSteps.Load()+work.ruleSetSteps.Load() != first {
		t.Fatal("repeated the closed rule graph")
	}
	for _, dirty := range []bool{false, true, false} {
		if answer := queryAnswer(t, queryRun(t, pipeline, dirty), lowered, cdMatches, "target", false); answer == dirty {
			t.Fatal("outer memo lost error dependence", dirty, answer)
		}
	}
	if len(lowered.memo.newer) == 0 {
		t.Fatal("the test bypassed the shared memo")
	}
}

func TestDeferredQueriesValidateRestoredReceiversDuringLoading(t *testing.T) {
	// Engine §3.10: the new forest condition keeps ordinary receiver checks.
	_, err := LoadPipelineSources(oneStage("%ambiguity-resolution greedy\n%rule text A\n%conditions $.without-elision-except(missing).parse(A)"), "p.md")
	if err == nil {
		t.Fatal("undefined restored family was accepted")
	}
}

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

func TestDeferredQueryDependencyWalkSharesProductionClauses(t *testing.T) {
	// Engine §4.3: dependency walks visit shared source clauses once per rule.
	var counts []int64
	for _, n := range []int{50, 200} {
		alternatives, conditions := make([]string, n), make([]string, n)
		for i := range n {
			alternatives[i] = fmt.Sprintf("$x%d:A", i)
			conditions[i] = fmt.Sprintf("$x%d ⟹ $x%d.parse(A).error-free", i, i)
		}
		pipeline := mustLoad(t, oneStage("%ambiguity-resolution greedy\n%rule text target\n%rule target "+strings.Join(alternatives, " | ")+"\n%conditions "+strings.Join(conditions, ", ")))
		grammar := pipeline.lower(0, map[string]bool{})
		work := &workCounts{}
		countWorkIn(work, func() {
			if suffixReadsEnd(grammar, grammar.byName["target"]) {
				t.Fatal("unexpected end dependency")
			}
			if !grammar.readsCarriedErrors(grammar.byName["target"]) {
				t.Fatal("missing filter dependency")
			}
		})
		count := work.readerSteps.Load() + work.clauseSteps.Load() + work.ruleSetSteps.Load()
		counts = append(counts, count)
		t.Logf("%d alternatives: %d dependency steps", n, count)
	}
	if counts[1] > 5*counts[0] {
		t.Fatalf("dependency walk is not linear: %v", counts)
	}
}
