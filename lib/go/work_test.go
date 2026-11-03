package gencmu

import (
	"fmt"
	"testing"
)

// countWork has the parses of a test count their work, from now until the
// test ends, and gives the counts.
// Tests that use this process-wide hook must stay serial. Go runs them
// before tests that call t.Parallel, so other parses cannot enter it.
func countWork(t *testing.T) *workCounts {
	t.Helper()
	w := &workCounts{}
	work.Store(w)
	t.Cleanup(func() { work.Store(nil) })
	return w
}

// countWorkIn counts the work of f alone in w, whose budgets the test has
// set, so that the work of setting up a run counts in no budget.
func countWorkIn(w *workCounts, f func()) {
	work.Store(w)
	defer work.Store(nil)
	f()
}

// stopsAtFirst runs f with w counting, and checks that it stops at the
// first count of c past its budget, not at a later one: a count added
// after its work, or many at once, passes the budget by more than one.
// It says whether it did.
func stopsAtFirst(t *testing.T, w *workCounts, c *workCount, name string, f func()) bool {
	t.Helper()
	want := fmt.Sprintf("%d %s, past the budget of %d", c.most+1, name, c.most)
	var stop any
	func() {
		defer func() { stop = recover() }()
		countWorkIn(w, f)
	}()
	if stop == nil {
		t.Errorf("no stop, %d %s, where %q was expected", c.Load(), name, want)
		return false
	}
	if got := fmt.Sprint(stop); got != want {
		t.Errorf("stopped with %q, not %q", got, want)
		return false
	}
	return true
}

// Asking for the constituent's tags adds only the condition's observation.
// It never repeats the term, including at prediction and boundary processing.
func TestReadyConditionsKeepComputedTags(t *testing.T) {
	for _, empty := range []bool{false, true} {
		for _, boundary := range []bool{false, true} {
			body, input := `"a"`, "ab"
			if empty {
				body, input = "ε", "b"
			}
			var visits [2]int64
			for index, observed := range []bool{false, true} {
				condition := `X ⊆ X`
				if observed {
					condition = `X ⊆ $.tags`
				}
				if boundary {
					condition += ", $.followed-by(tail)"
				}
				grammar := fmt.Sprintf(`%%ambiguity-resolution greedy
%%rule text body tail
%%rule body %s :: X ∪ Y %%conditions %s
%%rule tail "b"`, body, condition)
				d := mustLoad(t, oneStage(grammar))
				w := &workCounts{}
				countWorkIn(w, func() {
					result, err := d.Parse(input, ParseOptions{})
					if err != nil {
						t.Fatal(err)
					}
					if !result.OK {
						t.Fatalf("empty=%v boundary=%v: %v", empty, boundary, result.Error)
					}
				})
				visits[index] = w.visits.Load()
			}
			if delta := visits[1] - visits[0]; delta > 2 {
				t.Errorf("empty=%v boundary=%v: observing tags added %d visits", empty, boundary, delta)
			}
		}
	}
}

func TestRuntimePresenceTestReportsLoweringFault(t *testing.T) {
	for _, name := range []string{"", "x"} {
		t.Run("$"+name, func(t *testing.T) {
			defer func() {
				failure, ok := recover().(*parseFailure)
				if !ok || failure.message != "a presence test outlived lowering" {
					t.Fatalf("unexpected lowering fault: %+v", failure)
				}
			}()
			var w walk
			ev := &evaluator{capture: func(string) (spanVal, bool) { return spanVal{}, true }}
			w.cond(ev, &domCond{Kind: cdCaptured, Capture: name})
			w.resume()
		})
	}
}

func TestStageInputPresenceKeepsEvaluationOrder(t *testing.T) {
	for _, input := range []string{"", "a"} {
		t.Run(fmt.Sprintf("input=%q", input), func(t *testing.T) {
			body := `"a"`
			if input == "" {
				body = "ε"
			}
			grammar := `
%features enabled
%conditions ¬¬$, ¬$ ∨ ($ ∧ $), ($ ⟹ A) = A, $ ∨ "a" ∈ "a".split($.value)
%ambiguity-resolution greedy
%rule text enabled? ` + body
			d := mustLoad(t, oneStage(grammar))
			result, err := d.Parse(input, ParseOptions{})
			if err != nil || !result.OK {
				t.Fatalf("stage presence: %v %+v", err, result)
			}
		})
	}
	d := mustLoad(t, oneStage(`
%features enabled
%conditions "a" ∈ "a".split($.value) ∨ $
%ambiguity-resolution greedy
%rule text ε`))
	result, err := d.Parse("", ParseOptions{})
	if err != nil || result.OK || result.Error == nil || result.Error.Kind != ErrorGrammar || result.Error.Message != "split has an empty delimiter" {
		t.Fatalf("an earlier runtime fault must precede a true presence test: %v %+v", err, result)
	}
}

func TestUnusedTreeObservationsBuildNoRecords(t *testing.T) {
	run := silentRun(t, 20)
	g := lower(run.grammar, nil)
	rec := run.recognize(g, g.byName["text"], 0, 20)
	if len(rec.accepted(g.byName["text"])) == 0 {
		t.Fatal("the control grammar rejects its input")
	}
	if g.stage.treeComparisons || g.treeDemands != nil || rec.trees != nil {
		t.Fatal("a grammar without tree comparisons prepares tree observations")
	}
	for _, set := range rec.sets {
		for _, item := range set.items {
			if item.tree != nil || item.cap0.tree != 0 {
				t.Fatal("an unobserved item holds a tree identity")
			}
		}
	}
	for _, node := range rec.capNodes {
		if node.cv.tree != 0 {
			t.Fatal("an unobserved capture holds a tree identity")
		}
	}
}
