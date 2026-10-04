package gencmu

import (
	"fmt"
	"strings"
	"testing"
)

// guardedText is a rule of a choice of n captures, $c0(A) | … | $c(n−1)(A),
// with clause(i) written for each capture and joined by sep after keyword.
func guardedText(n int, keyword, sep string, clause func(i int) string) string {
	caps := make([]string, n)
	clauses := make([]string, n)
	for i := range n {
		caps[i] = fmt.Sprintf("$c%d(A)", i)
		clauses[i] = clause(i)
	}
	return "```jbogenbau\n%ambiguity-resolution greedy\n%rule text (" + strings.Join(caps, " | ") + ")\n" + keyword + " " + strings.Join(clauses, sep) + "\n```\n"
}

// loweredSize is the size of what lowering made of the clauses: each
// production and each emitted item, and each node of their tags and
// conditions. A node that productions share counts once, as it is made
// once.
func loweredSize(l *lowered) int64 {
	var size int64
	seen := map[clausePart]bool{}
	nodes := func(p clausePart) {
		walkClause(p, func(q clausePart) bool {
			if seen[q] {
				return false
			}
			seen[q] = true
			size++
			return true
		})
	}
	for _, p := range l.prods {
		size++
		nodes(clausePart{t: p.tags})
		for _, c := range p.conds {
			nodes(clausePart{c: c.cond})
		}
		for _, c := range p.predictConds {
			nodes(clausePart{c: c})
		}
		if p.emit != nil {
			for _, it := range p.emit.Items {
				size++
				nodes(clausePart{t: it.Tags})
			}
		}
	}
	return size
}

// TestClausesByPresence: a rule's clauses whose parts each apply to the
// productions with one capture cost each production its own captures and
// what it keeps (engine §3.6, §9). The rule is a choice of n captures, and
// its clause has a part for each, such as ($c0 ⟹ ~t0) ∪ … ∪ ($c(n−1) ⟹
// ~t(n−1)). Each production keeps one part, so what lowering makes grows
// with n, and the work of reading the rule and of lowering it may not
// grow faster. Simplifying every part for every production would cost n
// squared. The budget is a constant times n and the size of what
// lowering makes, applied as the work is done, at n and at 4n.
func TestClausesByPresence(t *testing.T) {
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name, keyword, sep string
		clause             func(i int) string
	}{
		{"guarded tags", "%tags", " ∪ ", func(i int) string { return fmt.Sprintf("($c%d ⟹ ~t%d)", i, i) }},
		{"fixed tags", "%tags", " ∪ ", func(i int) string { return fmt.Sprintf("~t%d", i) }},
		{"guarded conditions", "%conditions", ", ", func(i int) string { return fmt.Sprintf(`$c%d ⟹ text($c%d) = "a"`, i, i) }},
		{"conditions that use a capture", "%conditions", ", ", func(i int) string { return fmt.Sprintf(`text($c%d) = "a"`, i) }},
		{"emitted captures", "%emits", ", ", func(i int) string { return fmt.Sprintf("$c%d <~t%d>", i, i) }},
	}
	// The steps of each unit of n and of what lowering makes: reading
	// takes some 60 for each alternative, and lowering a few for each part
	// it keeps.
	const readEach, lowerEach = 60, 10
	for _, c := range cases {
		for _, n := range []int{100, 400} {
			text := guardedText(n, c.keyword, c.sep, c.clause)
			// Once without counting, for the size of what lowering makes.
			dom, err := bundled.reader.read(text, "g.md")
			if err != nil {
				t.Fatalf("%s: %v", c.name, err)
			}
			d := domStage(t, string(dom.json()))
			size := loweredSize(lower(d.stages[0], map[string]bool{}))
			// A count past its budget stops the work at once, with the panic
			// that the test reports.
			run := func(w *workCounts, f func()) (stop any) {
				defer func() { stop = recover() }()
				countWorkIn(w, f)
				return nil
			}
			read := &workCounts{}
			read.readerSteps.most = readEach * (int64(n) + size)
			if stop := run(read, func() { bundled.reader.read(text, "g.md") }); stop != nil {
				t.Errorf("%s, n=%d, reading: %v", c.name, n, stop)
				continue
			}
			lowering := &workCounts{}
			lowering.readerSteps.most = lowerEach * (int64(n) + size)
			if stop := run(lowering, func() { lower(d.stages[0], map[string]bool{}) }); stop != nil {
				t.Errorf("%s, n=%d, lowering: %v", c.name, n, stop)
				continue
			}
			t.Logf("%s, n=%d: lowering makes %d, reading takes %d steps and lowering %d", c.name, n, size, read.readerSteps.Load(), lowering.readerSteps.Load())
		}
	}
}
