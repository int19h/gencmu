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
//
// The other counts are the steps of work that once grew faster than its
// input, each counted where the fixed code does it, so that the old code
// would count its square:
//   - captureSteps: the steps through an item's interned captures that
//     reading a captured part takes.
//   - linkSteps: the links that the check of elision-only compares and
//     looks up to find a repeated link.
//   - conditions: the conditions that advances look at.
//   - soundSteps: the tokens that sound tests and phonemes() visit.
//   - readerSteps: the steps of the notation's reader and of the walks it
//     makes of what it reads.
//   - interned: the members of the sets that make interned tag sets.
//   - loweredSlots: the slots that lowering copies into the bodies of
//     productions.
//   - ruleSetSteps: the productions and symbols that the nullable and
//     reading rule sets, and the reach of cycles, visit.
//   - clauseSteps: the nodes of clauses that the checks of a definition
//     and the resolver of constants walk.
//   - emitSteps: the parts and anchors that an emission looks at.
//   - classSteps: the entries and classes that resolving a classifier
//     looks at.
//   - implicationSteps: the implications that a token's tags set off.
//   - decodeSteps: the values that decoding a precompiled DOM reads.
//   - elidableSteps: the productions that finding elidable helpers and
//     maximal terminators walks.
//   - spliceSteps: the documents and stages that splicing a pipeline
//     looks at.
type workCounts struct {
	items, checks, scanned, candidates, eligibilityRuns workCount

	captureSteps, linkSteps, conditions, soundSteps, readerSteps workCount
	interned, loweredSlots, ruleSetSteps, clauseSteps, emitSteps workCount
	classSteps, implicationSteps, decodeSteps, elidableSteps     workCount
	spliceSteps                                                  workCount
}

// workCount is one count of workCounts, with its budget, or 0 for none,
// which a test sets before the parse. A test can also bound it by another
// count, which it may never pass, for work whose budget is the size of
// what other work made.
type workCount struct {
	n     atomic.Int64
	most  int64
	under *workCount
}

// add counts one, and panics if that passes the budget.
func (c *workCount) add(name string) {
	c.addN(1, name)
}

// addN counts k, and panics if that passes the budget.
func (c *workCount) addN(k int64, name string) {
	n := c.n.Add(k)
	if c.most > 0 && n > c.most {
		panic(fmt.Sprintf("%d %s, past the budget of %d", n, name, c.most))
	}
	if c.under != nil {
		if bound := c.under.Load(); n > bound {
			panic(fmt.Sprintf("%d %s, past the bound of %d", n, name, bound))
		}
	}
}

// Load is the count so far.
func (c *workCount) Load() int64 {
	return c.n.Load()
}

// work is where a parse counts its work. It is nil outside the tests that
// set it, so that a parse only loads a nil pointer and counts nothing.
var work atomic.Pointer[workCounts]
