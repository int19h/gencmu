package gencmu

import (
	"fmt"
	"math"
	"os"
	"runtime/debug"
	"strconv"
	"strings"
	"testing"
)

// The shared cases of tests/growth.json: the work of the bundled grammars
// on long texts. A condition that parses a whole prefix again at each step
// makes a long text cost more than its length says, so these tests count
// the items that the recognizer makes, in parses and nested parses alike.
func TestGrowth(t *testing.T) {
	data, err := os.ReadFile("../../tests/growth.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Description string
		Dialect     string
		Text        string
		Link        string
		Small       int
		Large       int
		Most        int64
	}
	if err := unmarshalJSON(data, &cases); err != nil {
		t.Fatal(err)
	}
	if len(cases) == 0 {
		t.Fatal("no cases")
	}
	for _, c := range cases {
		t.Run(c.Dialect+" with "+c.Link, func(t *testing.T) {
			d, err := LoadDialect(c.Dialect)
			if err != nil {
				t.Fatal(err)
			}
			// A budget of 0 is none; the count past a budget stops the
			// parse. The keys of nested parses by content are counted too,
			// since a key costs as much as its span is long.
			work := func(n int, items, keys int64) (int64, int64) {
				links := strings.TrimSuffix(strings.Repeat(c.Link+" ", n), " ")
				text := strings.Replace(c.Text, "{links}", links, 1)
				w := countWork(t)
				w.items.most, w.keySteps.most = items, keys
				res, err := d.Parse(text, ParseOptions{})
				if err != nil {
					t.Fatal(err)
				}
				if !res.OK {
					t.Fatalf("%s: does not parse", text)
				}
				return w.items.Load(), w.keySteps.Load()
			}
			small, smallKeys := work(c.Small, 0, 0)
			large, largeKeys := work(c.Large, c.Most*small, c.Most*smallKeys+1)
			t.Logf("%d items and %d key steps for %d links, %d and %d for %d", small, smallKeys, c.Small, large, largeKeys, c.Large)
		})
	}
}

// A captured part's span is part of an item's identity (engine §4), so a
// capture of a rule that can end in many places keeps one completed item
// for each place: with t → $l(t) $r(t) | A over n tokens, n − 1 completed
// items of that production span the input, and with t → t t | A one
// (tests/README.md).
func TestCaptureGrowth(t *testing.T) {
	wholeItems := func(grammar string, n int) int {
		d := mustLoad(t, oneStage("%ambiguity-resolution greedy\n"+grammar))
		lg := d.lower(0, map[string]bool{})
		toks := make([]Token, n)
		for i := range toks {
			toks[i] = Token{Text: "a", Tags: []string{"A"}, Span: [2]int{i, i + 1}, Source: [2]int{2 * i, 2*i + 1}}
		}
		ps := newParseState(d.uni, []rune(strings.TrimSpace(strings.Repeat("a ", n))))
		rec := ps.newRun("main", d.stages[0], toks).recognize(lg, lg.byName["text"], 0, n)
		count := 0
		for _, it := range rec.sets[n].items {
			if int(it.dot) == len(it.prod.rhs) && it.origin == 0 && lg.rules[it.prod.lhs].name == "t" && len(it.prod.rhs) == 2 {
				count++
			}
		}
		return count
	}
	for n := 2; n <= 5; n++ {
		if got := wholeItems("%rule text t\n%rule t t t | A", n); got != 1 {
			t.Errorf("t t over %d: %d completed items", n, got)
		}
		if got := wholeItems("%rule text t\n%rule t $l(t) $r(t) | A", n); got != n-1 {
			t.Errorf("$l(t) $r(t) over %d: %d completed items, not %d", n, got, n-1)
		}
	}
}

// captureStorageRun is a run of one production of n captures over n
// tokens, whose tag term and condition read every capture, and the
// recognition of it.
func captureStorageRun(t *testing.T, n int) func() *recognizer {
	names := make([]string, n)
	for i := range names {
		names[i] = fmt.Sprintf("$c%d(A)", i)
	}
	// A tag term that reads every capture, the first last.
	tags := make([]string, n)
	for i := range tags {
		tags[i] = fmt.Sprintf("tags($c%d)", n-1-i)
	}
	d := mustLoad(t, oneStage("%ambiguity-resolution greedy\n%rule text "+strings.Join(names, " ")+"\n%tags ~x ∪ "+strings.Join(tags, " ∪ ")+"\n%conditions text($c0) = \"a\""))
	lg := d.lower(0, map[string]bool{})
	toks := make([]Token, n)
	for i := range toks {
		toks[i] = Token{Text: "a", Tags: []string{"A"}, Span: [2]int{i, i + 1}, Source: [2]int{2 * i, 2*i + 1}}
	}
	ps := newParseState(d.uni, []rune(strings.TrimSpace(strings.Repeat("a ", n))))
	run := ps.newRun("main", d.stages[0], toks)
	return func() *recognizer { return run.recognize(lg, lg.byName["text"], 0, n) }
}

// TestCaptureStorage: one production of C captures over C tokens keeps C
// interned capture entries, each sharing the one it extends, not C² (engine
// §4). Each entry counts as it is stored, against a budget of the C − 1
// after the empty one. Its tag term and its condition read them in a
// bounded number of walks, not one walk for each capture.
func TestCaptureStorage(t *testing.T) {
	for _, n := range []int{100, 200, 400} {
		recognize := captureStorageRun(t, n)
		// A walk of every capture for each would pass this budget at once.
		w := &workCounts{}
		w.captureSteps.most = int64(2*n + 4)
		w.capEntries.most = int64(n - 1)
		var rec *recognizer
		countWorkIn(w, func() { rec = recognize() })
		if len(rec.sets[n].items) == 0 {
			t.Fatalf("%d captures: no item at the end", n)
		}
		// The empty sequence, and one entry for each capture after the first.
		if len(rec.capNodes) != n {
			t.Errorf("%d captures: %d interned capture entries", n, len(rec.capNodes))
		}
		t.Logf("%d captures: %d steps to read them", n, w.captureSteps.Load())
	}
}

// TestCaptureStorageMutation stores each entry's prefix again, as the
// entries did before they shared their prefixes. The budget of entries
// stops the recognition at the first entry past it, not after the parse.
func TestCaptureStorageMutation(t *testing.T) {
	const n = 100
	recognize := captureStorageRun(t, n)
	w := &workCounts{storePrefixes: true}
	w.capEntries.most = n - 1
	stopsAtFirst(t, w, &w.capEntries, "capture entries", func() { recognize() })
}

// captureSearchRun is the recognition of a production of n captures over
// n tokens, with a condition at each capture that reads the part that far
// names.
func captureSearchRun(t *testing.T, n int, far func(int) string) func() *recognizer {
	names := make([]string, n)
	conditions := make([]string, n)
	for i := range names {
		names[i] = fmt.Sprintf("$c%d(A)", i)
		conditions[i] = fmt.Sprintf("text($c%d) = text(%s)", i, far(i))
	}
	d := mustLoad(t, oneStage("%ambiguity-resolution greedy\n%rule text "+strings.Join(names, " ")+"\n%conditions "+strings.Join(conditions, ", ")))
	lg := d.lower(0, map[string]bool{})
	toks := make([]Token, n)
	for i := range toks {
		toks[i] = Token{Text: "a", Tags: []string{"A"}, Span: [2]int{i, i + 1}, Source: [2]int{2 * i, 2*i + 1}}
	}
	ps := newParseState(d.uni, []rune(strings.TrimSpace(strings.Repeat("a ", n))))
	run := ps.newRun("main", d.stages[0], toks)
	return func() *recognizer { return run.recognize(lg, lg.byName["text"], 0, n) }
}

// TestCaptureSearch: a condition at each capture of a long production
// reads the part it names without a walk of every part before it. The
// capture just made is the last part. The second capture is a search by
// the jumps, whose steps grow with the logarithm of the parts (engine §4).
// The first is kept apart and costs no search.
func TestCaptureSearch(t *testing.T) {
	steps := func(n int, most int64, far func(int) string) int64 {
		recognize := captureSearchRun(t, n, far)
		w := &workCounts{}
		w.captureSteps.most = most
		var rec *recognizer
		countWorkIn(w, func() { rec = recognize() })
		if len(rec.sets[n].items) == 0 {
			t.Fatalf("%d captures: no item at the end", n)
		}
		return w.captureSteps.Load()
	}
	// A walk of every part before the one read would pass these budgets,
	// which grow with n and with n log n.
	for _, n := range []int{100, 200, 400} {
		near := steps(n, int64(2*n+4), func(i int) string { return fmt.Sprintf("$c%d", i) })
		second := steps(n, int64(float64(n)*(2*math.Log2(float64(n))+4)), func(int) string { return "$c1" })
		t.Logf("%d captures: %d steps read where made, %d reading the second", n, near, second)
	}
}

// TestCaptureSearchSteps: each step of a search counts as it is taken, so
// any budget stops the search at the first step past it, within a search
// and not after it. The conditions read the second part.
func TestCaptureSearchSteps(t *testing.T) {
	recognize := captureSearchRun(t, 100, func(int) string { return "$c1" })
	for most := int64(1); most <= 40; most++ {
		w := &workCounts{}
		w.captureSteps.most = most
		stopsAtFirst(t, w, &w.captureSteps, "capture steps", func() { recognize() })
	}
}

// TestNotationGrowth: the shared cases of tests/notation-growth.json.
// Reading a document whose constructs nest deep costs work that grows with
// its length, not with its square. The work is the recognizer's items and
// the steps of the reader and its walks, counted, not timed.
func TestNotationGrowth(t *testing.T) {
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile("../../tests/notation-growth.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Name, Prefix, Open, Middle, Close, Suffix string
	}
	if err := unmarshalJSON(data, &cases); err != nil {
		t.Fatal(err)
	}
	if len(cases) <= 5 {
		t.Fatal("too few cases")
	}
	for _, c := range cases {
		// A budget of 0 is none. Each count past its budget stops the read
		// at once, with the panic that the test reports.
		read := func(n int, items, steps int64) (w *workCounts, stop any) {
			text := "```jbogenbau\n" + c.Prefix + strings.Repeat(c.Open, n) + c.Middle + strings.Repeat(c.Close, n) + c.Suffix + "\n```\n"
			w = &workCounts{}
			w.items.most, w.readerSteps.most = items, steps
			defer func() { stop = recover() }()
			// An error is an outcome too. Its place is the notation cases'
			// concern.
			countWorkIn(w, func() { bundled.reader.read(text, "t.md") })
			return w, nil
		}
		// Once first, so that loading the notation counts in neither.
		read(250, 0, 0)
		small, _ := read(250, 0, 0)
		// Each count has its own budget, so that work which grows faster
		// than its input in either stops at the first count past it.
		large, stop := read(1000, 5*small.items.Load()+1, 5*small.readerSteps.Load()+1)
		if stop != nil {
			t.Errorf("%s: %v, after %d items and %d steps for 250 levels", c.Name, stop, small.items.Load(), small.readerSteps.Load())
			continue
		}
		t.Logf("%s: %d items and %d steps for 250 levels, %d and %d for 1000", c.Name, small.items.Load(), small.readerSteps.Load(), large.items.Load(), large.readerSteps.Load())
	}
}

// TestNotationDeep reads each construct of tests/notation-growth.json
// nested 20,000 deep with the stack of a goroutine held to 1 MiB: no part
// of reading recurses as deep as the document nests, so the depth ends in
// the error of engine §9 or in a DOM, never in a stack overflow. A deeper
// stack than the limit is fatal, so the test fails by ending the process.
func TestNotationDeep(t *testing.T) {
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile("../../tests/notation-growth.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Name, Prefix, Open, Middle, Close, Suffix string
	}
	if err := unmarshalJSON(data, &cases); err != nil {
		t.Fatal(err)
	}
	defer debug.SetMaxStack(debug.SetMaxStack(1 << 20))
	for _, c := range cases {
		text := "```jbogenbau\n" + c.Prefix + strings.Repeat(c.Open, 20000) + c.Middle + strings.Repeat(c.Close, 20000) + c.Suffix + "\n```\n"
		dom, rerr := bundled.reader.read(text, "t.md")
		if dom == nil && rerr == nil {
			t.Errorf("%s: neither a DOM nor an error", c.Name)
		}
		if rerr != nil && rerr.Line == 0 {
			t.Errorf("%s: an error with no place: %v", c.Name, rerr)
		}
	}
}

// TestQueryDepth parses each case of tests/query-depth.json with the stack
// of a goroutine held to 1 MiB. Each nested parse starts the next, so the
// queries nest as deep as the text is long. The recognizer keeps them on a
// stack of its own, and a call stack that grew with them would end the
// process.
func TestQueryDepth(t *testing.T) {
	data, err := os.ReadFile("../../tests/query-depth.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Name, Grammar, Link, Suffix string
		Count                       int
	}
	if err := unmarshalJSON(data, &cases); err != nil {
		t.Fatal(err)
	}
	if len(cases) == 0 {
		t.Fatal("no query depth cases")
	}
	defer debug.SetMaxStack(debug.SetMaxStack(1 << 20))
	for _, c := range cases {
		d := mustLoad(t, oneStage(c.Grammar))
		res, err := d.Parse(strings.Repeat(c.Link, c.Count)+c.Suffix, ParseOptions{})
		if err != nil || !res.OK {
			t.Errorf("%s: %v %+v", c.Name, err, res.Error)
		}
	}
}

// TestNestedChainDeep makes a chain of nested parses as long as the text,
// in recognition and in emission, with the stack of a goroutine held to
// 1 MiB. Each nested parse asks another over a span one token shorter.
func TestNestedChainDeep(t *testing.T) {
	chain := "%rule c 'a' %conditions ¬matches(after($), c)"
	text := strings.Repeat("a", 20000)
	defer debug.SetMaxStack(debug.SetMaxStack(1 << 20))
	for _, grammar := range []string{
		"%ambiguity-resolution greedy\n%rule text c {'a'}\n" + chain,
		"%ambiguity-resolution greedy\n%rule text $x(s) %emits $ <T ∪ tags($x, c)>\n%rule s {'a'}\n" + chain,
	} {
		d := mustLoad(t, oneStage(grammar))
		res, err := d.Parse(text, ParseOptions{})
		if err != nil || !res.OK {
			t.Errorf("%s: %v %+v", grammar, err, res.Error)
		}
	}
}

// TestIncludeChainDeep loads a chain of 20,000 documents, each including
// the next, with a valid stage at its end. The stack of a goroutine is held
// to 1 MiB, so splicing the chain by recursion would end the process.
func TestIncludeChainDeep(t *testing.T) {
	const n = 20000
	sources := map[string]string{"p.md": block("%stage main", `%include "d1.md"`)}
	for i := 1; i < n; i++ {
		sources[fmt.Sprintf("d%d.md", i)] = block(fmt.Sprintf("%%include \"d%d.md\"", i+1))
	}
	sources[fmt.Sprintf("d%d.md", n)] = block("%ambiguity-resolution greedy", "%rule text A")
	defer debug.SetMaxStack(debug.SetMaxStack(1 << 20))
	d := mustLoad(t, sources)
	if got := strings.Join(d.StageNames(), " "); got != "main" {
		t.Fatalf("stages %q", got)
	}
}

// TestDeepGrammar ranks and emits along chains 20,000 deep with the stack
// of a goroutine held to 1 MiB. A chain of rules, each a unit of the next,
// makes the items of one set and origin depend on one another as deep as
// the grammar nests. A capture that attaches the one before it makes
// attachments as deep as the text is long. Ranking, emission and both
// renderings keep their own stacks for these.
func TestDeepGrammar(t *testing.T) {
	const n = 20000
	chain := func(body func(i int) string) string {
		var b strings.Builder
		for i := range n {
			fmt.Fprintf(&b, "%%rule r%d %s\n", i, body(i))
		}
		return b.String()
	}
	for _, c := range []struct{ name, grammar, text string }{
		{"units", "%rule text r0\n" + chain(func(i int) string { return fmt.Sprintf("r%d", i+1) }) + fmt.Sprintf("%%rule r%d 'a'", n), "a"},
		{"attachments", "%rule text w\n%rule w $y(w) $x('a') | $x('a')\n%emits\n  ($y) $x", strings.Repeat("a", n)},
	} {
		d := mustLoad(t, oneStage("%ambiguity-resolution greedy\n"+c.grammar))
		func() {
			defer debug.SetMaxStack(debug.SetMaxStack(1 << 20))
			res, err := d.Parse(c.text, ParseOptions{})
			if err != nil || !res.OK {
				t.Fatalf("%s: %v %+v", c.name, err, res.Error)
			}
			data, err := MarshalResult(res)
			if err != nil || len(data) < len(c.text) || Brackets(res, BracketOptions{}) == "" {
				t.Fatalf("%s: no output: %v", c.name, err)
			}
		}()
	}
}

// TestQueryWork parses each case of tests/query-work.json, whose step or
// term starts many queries. A query halts the evaluation, which then goes
// on from where it halted. Every visit of a node of a condition or a term
// counts, so a step made again from its start passes the budget.
func TestQueryWork(t *testing.T) {
	data, err := os.ReadFile("../../tests/query-work.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Name, Head, Item, Joiner, Tail, Rule, Text string
		Count                                      int
		Most                                       int64
	}
	if err := unmarshalJSON(data, &cases); err != nil {
		t.Fatal(err)
	}
	if len(cases) == 0 {
		t.Fatal("no query work cases")
	}
	for _, c := range cases {
		items := make([]string, c.Count)
		var rules strings.Builder
		for i := range items {
			n := strconv.Itoa(i)
			items[i] = strings.ReplaceAll(c.Item, "{i}", n)
			rules.WriteString(strings.ReplaceAll(c.Rule, "{i}", n))
		}
		d := mustLoad(t, oneStage(c.Head+strings.Join(items, c.Joiner)+c.Tail+rules.String()))
		w := &workCounts{}
		w.visits.most = c.Most * int64(c.Count)
		var res *ParseResult
		countWorkIn(w, func() { res, err = d.Parse(c.Text, ParseOptions{}) })
		if err != nil {
			t.Errorf("%s: %v", c.Name, err)
			continue
		}
		if !res.OK {
			t.Errorf("%s: %+v", c.Name, res.Error)
			continue
		}
		t.Logf("%s: %d visits", c.Name, w.visits.Load())
	}
}
