package gencmu

import (
	"fmt"
	"testing"
)

// countWork has the parses of a test count their work, from now until the
// test ends, and gives the counts.
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
func stopsAtFirst(t *testing.T, w *workCounts, c *workCount, name string, f func()) {
	t.Helper()
	want := fmt.Sprintf("%d %s, past the budget of %d", c.most+1, name, c.most)
	var stop any
	func() {
		defer func() { stop = recover() }()
		countWorkIn(w, f)
	}()
	if stop == nil {
		t.Errorf("no stop, %d %s, where %q was expected", c.Load(), name, want)
	} else if got := fmt.Sprint(stop); got != want {
		t.Errorf("stopped with %q, not %q", got, want)
	}
}
