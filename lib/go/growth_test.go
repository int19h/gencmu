package gencmu

import (
	"encoding/json"
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
