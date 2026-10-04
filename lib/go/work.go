package gencmu

import (
	"fmt"
	"sync/atomic"
)

// workCounts counts work, for the tests that it grows with the input as it
// should: the items that the recognizer makes, in parses and nested parses
// alike (tests/growth.json), the checks of maximality and the completions
// that they read, and the searches of eligibility. Each is counted where
// the work is done, as it is done: scanned counts the completed symbols of
// the chart that the checks read to find their tables, and candidates the
// completions that they read for a tested symbol. A test can give a count
// a budget, which the count past it panics at, so that a regression to
// quadratic work stops at once and does not run on.
type workCounts struct {
	items, checks, scanned, candidates, eligibilityRuns workCount
}

// workCount is one count of workCounts, with its budget, or 0 for none,
// which a test sets before the parse.
type workCount struct {
	n    atomic.Int64
	most int64
}

// add counts one, and panics if that passes the budget.
func (c *workCount) add(name string) {
	if n := c.n.Add(1); c.most > 0 && n > c.most {
		panic(fmt.Sprintf("%d %s, past the budget of %d", n, name, c.most))
	}
}

// Load is the count so far.
func (c *workCount) Load() int64 {
	return c.n.Load()
}

// work is where a parse counts its work. It is nil outside the tests that
// set it, so that a parse only loads a nil pointer and counts nothing.
var work atomic.Pointer[workCounts]
