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
