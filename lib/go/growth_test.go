package gencmu

import (
	"encoding/json"
	"fmt"
	"os"
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
		rec := ps.newRun("main", d.stages[0], toks).recognize(lg, lg.byName["text"], 0, n)
		if len(rec.sets[n].items) == 0 {
			t.Fatalf("%d captures: no item at the end", n)
		}
		// The empty sequence, and one entry for each capture after the first.
		if len(rec.capNodes) != n {
			t.Errorf("%d captures: %d interned capture entries", n, len(rec.capNodes))
		}
		if rec.capSteps > 2*n+4 {
			t.Errorf("%d captures: %d steps to read them", n, rec.capSteps)
		}
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
		work := func(n int) int64 {
			text := "```jbogenbau\n" + c.Prefix + strings.Repeat(c.Open, n) + c.Middle + strings.Repeat(c.Close, n) + c.Suffix + "\n```\n"
			recognizerWork.items.Store(0)
			readerWork.steps.Store(0)
			// An error is an outcome too; its place is the notation cases'
			// concern.
			bundled.reader.read(text, "t.md")
			return recognizerWork.items.Load() + readerWork.steps.Load()
		}
		// Once first, so that loading the notation counts in neither.
		work(250)
		small, large := work(250), work(1000)
		if large > 5*small {
			t.Errorf("%s: %d for 250 levels, %d for 1000", c.Name, small, large)
		}
		t.Logf("%s: %d for 250 levels, %d for 1000", c.Name, small, large)
	}
}
