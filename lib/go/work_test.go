package gencmu

import "testing"

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
