package gencmu

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"runtime/debug"
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
	if err := json.Unmarshal(data, &cases); err != nil {
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
			// A budget of 0 is none; the item past a budget stops the parse.
			items := func(n int, most int64) int64 {
				links := strings.TrimSuffix(strings.Repeat(c.Link+" ", n), " ")
				text := strings.Replace(c.Text, "{links}", links, 1)
				w := countWork(t)
				w.items.most = most
				res, err := d.Parse(text, ParseOptions{})
				if err != nil {
					t.Fatal(err)
				}
				if !res.OK {
					t.Fatalf("%s: does not parse", text)
				}
				return w.items.Load()
			}
			small := items(c.Small, 0)
			large := items(c.Large, c.Most*small)
			if large > c.Most*small {
				t.Errorf("%s\n%q: %d items for %d links, %d for %d", c.Description, c.Link, small, c.Small, large, c.Large)
			}
			t.Logf("%d items for %d links, %d for %d", small, c.Small, large, c.Large)
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

// TestCaptureStorage: one production of C captures over C tokens keeps C
// interned capture entries, each sharing the one it extends, not C² (engine
// §4). Its tag term and its condition read them in a bounded number of
// walks, not one walk for each capture.
func TestCaptureStorage(t *testing.T) {
	for _, n := range []int{100, 200, 400} {
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
		// A walk of every capture for each would pass this budget at once.
		w := &workCounts{}
		w.captureSteps.most = int64(2*n + 4)
		var rec *recognizer
		countWorkIn(w, func() { rec = run.recognize(lg, lg.byName["text"], 0, n) })
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

// TestCaptureSearch: a condition at each capture of a long production
// reads the part it names without a walk of every part before it. The
// capture just made is the last part. The second capture is a search by
// the jumps, whose steps grow with the logarithm of the parts (engine §4).
// The first is kept apart and costs no search.
func TestCaptureSearch(t *testing.T) {
	steps := func(n int, most int64, far func(int) string) int64 {
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
		w := &workCounts{}
		w.captureSteps.most = most
		var rec *recognizer
		countWorkIn(w, func() { rec = run.recognize(lg, lg.byName["text"], 0, n) })
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
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	if len(cases) <= 5 {
		t.Fatal("too few cases")
	}
	for _, c := range cases {
		// A budget of 0 is none. Each count past its budget stops the read.
		read := func(n int, most int64) int64 {
			text := "```jbogenbau\n" + c.Prefix + strings.Repeat(c.Open, n) + c.Middle + strings.Repeat(c.Close, n) + c.Suffix + "\n```\n"
			w := &workCounts{}
			w.items.most, w.readerSteps.most = most, most
			// An error is an outcome too. Its place is the notation cases'
			// concern.
			countWorkIn(w, func() { bundled.reader.read(text, "t.md") })
			return w.items.Load() + w.readerSteps.Load()
		}
		// Once first, so that loading the notation counts in neither.
		read(250, 0)
		small := read(250, 0)
		large := read(1000, 5*small)
		if large > 5*small {
			t.Errorf("%s: %d for 250 levels, %d for 1000", c.Name, small, large)
		}
		t.Logf("%s: %d for 250 levels, %d for 1000", c.Name, small, large)
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
	if err := json.Unmarshal(data, &cases); err != nil {
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
	if err := json.Unmarshal(data, &cases); err != nil {
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
