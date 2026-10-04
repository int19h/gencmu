package gencmu

import (
	"fmt"
	"slices"
	"strings"
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
//     reading a captured part takes, each as it is taken.
//   - capEntries: the interned capture entries that the recognizer
//     stores, each as it is stored.
//   - linkSteps: the links that the check of elision-only compares and
//     looks up to find a repeated link.
//   - conditions: the conditions that advances examine, each before it is
//     looked at, also one whose dot is not the advance's, and those that
//     predictions evaluate, each before it is evaluated.
//   - visits: the nodes of conditions and terms that an evaluation enters,
//     each before it is evaluated, in an evaluation that halts as well.
//   - soundSteps: the tokens that sound tests and phonemes() visit.
//   - readerSteps: the steps of the notation's reader and of the walks it
//     makes of what it reads.
//   - interned: the members that making interned tag sets examines, in
//     the unions, intersections and differences that gather them, in the
//     comparisons that sort them, and in the keys that intern them.
//   - loweredSlots: the slots that lowering copies into the bodies of
//     productions, each before it is copied.
//   - ruleSetSteps: the productions, symbols and uses that the nullable
//     and reading rule sets visit, and the symbols, rules and edges that
//     finding the reach of cycles examines, each before it is examined.
//   - clauseSteps: the nodes of clauses that the checks of a definition
//     and the resolver of constants walk.
//   - emitSteps: the parts and anchors that an emission looks at, each
//     before it does.
//   - classSteps: the classes that resolving a classifier looks at,
//     indexes and compares as it sorts them, each before it does.
//   - implicationSteps: the implications that a token's tags set off.
//   - decodeSteps: the values that decoding a precompiled DOM reads.
//   - elidableSteps: the productions that finding elidable helpers and
//     maximal terminators walks, each before it is looked at.
//   - spliceSteps: the documents and stages that splicing a pipeline
//     looks at.
//   - keySteps: the tokens that keys of nested parses by content are
//     written from, each before it is written.
type workCounts struct {
	items, checks, scanned, candidates, eligibilityRuns workCount

	captureSteps, linkSteps, conditions, soundSteps, readerSteps workCount
	interned, loweredSlots, ruleSetSteps, clauseSteps, emitSteps workCount
	classSteps, implicationSteps, decodeSteps, elidableSteps     workCount
	spliceSteps, visits, capEntries, keySteps                    workCount

	// storePrefixes is a mutation for the tests of the budgets: each
	// capture entry stored stores its prefix again, as the code did before
	// entries shared their prefixes. A budget must stop it at once.
	storePrefixes bool
	// scanConds is a mutation for the tests of the budgets: an advance
	// examines every condition of its production, as a selection by scan
	// would, and not only those its dot makes ready.
	scanConds bool
	// checkOthers is a mutation for the tests of the budgets: finding the
	// unit edges of a production checks every other symbol for each, as
	// the code did before it counted the symbols that are not nullable.
	checkOthers bool
	// copyGrowing is a mutation for the tests of the budgets: gathering
	// the members of a set copies those gathered so far again for each.
	copyGrowing bool
	// scanOther is a mutation for the tests of the budgets: an
	// intersection, difference or subset looks a member up in the other
	// set by a scan, not by a binary search.
	scanOther bool
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

// sortStrings sorts names in code point order, as sort.Strings does. Each
// comparison counts in c, unless it is nil, before it is made, since a
// sort examines its elements only through its comparisons.
func sortStrings(names []string, c *workCount, name string) {
	slices.SortFunc(names, func(a, b string) int {
		if c != nil {
			c.add(name)
		}
		return strings.Compare(a, b)
	})
}

// appendCounted appends each element of xs to out, each counted in c,
// unless it is nil, before it is copied. A copy is work that grows with
// what it copies, so a copy on a counted path goes through here.
func appendCounted[T any](out, xs []T, c *workCount, name string) []T {
	for _, x := range xs {
		if c != nil {
			c.add(name)
		}
		out = append(out, x)
	}
	return out
}

// readerCount is the count of the reader's steps, or nil when work is not
// counted.
func readerCount() *workCount {
	if w := work.Load(); w != nil {
		return &w.readerSteps
	}
	return nil
}

// work is where a parse counts its work. It is nil outside the tests that
// set it, so that a parse only loads a nil pointer and counts nothing.
var work atomic.Pointer[workCounts]
