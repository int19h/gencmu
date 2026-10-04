package gencmu

import "sync/atomic"

// workCounts counts work, for the tests that it grows with the input as it
// should: the items that the recognizer makes, in parses and nested parses
// alike (tests/growth.json), the checks of maximality and the completions
// that they read, and the searches of eligibility. Each is counted where
// the work is done, as it is done: scanned counts the completed symbols of
// the chart that the checks read to find their tables, and candidates the
// completions that they read for a tested symbol.
type workCounts struct {
	items, checks, scanned, candidates, eligibilityRuns atomic.Int64
}

// work is where a parse counts its work. It is nil outside the tests that
// set it, so that a parse only loads a nil pointer and counts nothing.
var work atomic.Pointer[workCounts]
