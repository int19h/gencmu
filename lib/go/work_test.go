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
