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
			items := func(n int) int64 {
				links := strings.TrimSuffix(strings.Repeat(c.Link+" ", n), " ")
				text := strings.Replace(c.Text, "{links}", links, 1)
				recognizerWork.items.Store(0)
				res, err := d.Parse(text, ParseOptions{})
				if err != nil {
					t.Fatal(err)
				}
				if !res.OK {
					t.Fatalf("%s: does not parse", text)
				}
				return recognizerWork.items.Load()
			}
			small := items(c.Small)
			large := items(c.Large)
			if large > c.Most*small {
				t.Errorf("%s\n%q: %d items for %d links, %d for %d", c.Description, c.Link, small, c.Small, large, c.Large)
			}
			t.Logf("%d items for %d links, %d for %d", small, c.Small, large, c.Large)
		})
	}
}
