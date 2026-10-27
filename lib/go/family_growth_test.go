package gencmu

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"testing"
	"time"
)

type familyGrowthBounds struct {
	Case           string `json:"case"`
	StrictCase     string `json:"strictCase"`
	Lengths        []int  `json:"lengths"`
	Depths         []int  `json:"depths"`
	ItemsPerUnit   *int64 `json:"itemsPerUnit"`
	Slack          int64  `json:"slack"`
	NodesPerDepth  *int64 `json:"nodesPerDepth"`
	MaxCloseNodes  *int64 `json:"maxCloseNodes"`
	MaxCloseStates *int64 `json:"maxCloseStates"`
	EqualsStrict   bool   `json:"equalsStrict"`
	AtMostStrict   bool   `json:"atMostStrict"`
	OverStrict     *struct {
		ItemsPercent        int64 `json:"itemsPercent"`
		ItemsPercentPerUnit int64 `json:"itemsPercentPerUnit"`
		ItemsSlack          int64 `json:"itemsSlack"`
		CloseStatesPerUnit  int64 `json:"closeStatesPerUnit"`
	} `json:"overStrict"`
	StrictBound *struct {
		CloseStatesPerUnit int64 `json:"closeStatesPerUnit"`
		CloseStatesSlack   int64 `json:"closeStatesSlack"`
	} `json:"strictBound"`
	Summaries *struct {
		PerSquare int64 `json:"perSquare"`
		Slack     int64 `json:"slack"`
	} `json:"summaries"`
	Steps *struct {
		PerCube int64 `json:"perCube"`
		Slack   int64 `json:"slack"`
	} `json:"steps"`
}

func growFamilyCase(t *testing.T, file string, n int, depth bool) *engineCase {
	t.Helper()
	c := loadCase(t, filepath.Join("../../tests", file))
	if depth {
		grammar := *c.Grammar
		var family string
		for _, line := range strings.Split(grammar, "\n") {
			if strings.HasPrefix(line, "%rule fam ") {
				family = line
				break
			}
		}
		first, lines := 16, 5
		if strings.Contains(file, "ranked-sibling") {
			first, lines = 10, 7
		}
		grammar = strings.ReplaceAll(strings.Join(strings.Split(grammar, "\n")[:lines], "\n"), fmt.Sprintf("r%d", first), fmt.Sprintf("r%d", n))
		for i := 1; i <= n; i++ {
			grammar += fmt.Sprintf("\n%%rule r%d r%d r%d", i, i-1, i-1)
			if first == 10 {
				grammar += " | [+V]"
			}
		}
		if family != "" {
			grammar += "\n" + family
		}
		c.Grammar = &grammar
	} else if c.Tokens == nil {
		text := "x" + strings.Repeat("a", n)
		c.Input = &text
	} else {
		first, last := -1, -1
		for i, token := range c.Tokens {
			for _, tag := range token.Tags {
				if tag == "X" || tag == "Y" {
					if first < 0 {
						first = i
					}
					last = i
					break
				}
			}
		}
		if first < 0 {
			t.Fatal("growth fixture has no repeatable token")
		}
		prefix := append([]caseToken{}, c.Tokens[:first]...)
		units := c.Tokens[first : last+1]
		for i := 0; i < n; i++ {
			prefix = append(prefix, units[i%len(units)])
		}
		c.Tokens = append(prefix, c.Tokens[last+1:]...)
		c.Input = nil
	}
	return c
}

func TestFamilyGrowth(t *testing.T) {
	data, err := os.ReadFile("../../tests/without-elision-growth.json")
	if err != nil {
		t.Fatal(err)
	}
	var entries map[string]json.RawMessage
	if err := unmarshalJSON(data, &entries); err != nil {
		t.Fatal(err)
	}
	names := []string{}
	for name := range entries {
		if strings.HasPrefix(name, "family") {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	for _, name := range names {
		var bound familyGrowthBounds
		if err := unmarshalJSON(entries[name], &bound); err != nil {
			t.Fatal(err)
		}
		t.Run(name, func(t *testing.T) {
			lengths := bound.Lengths
			depth := false
			if len(bound.Depths) > 0 {
				lengths = bound.Depths
				depth = true
			}
			if len(lengths) == 0 || bound.Case == "" || bound.StrictCase == "" {
				t.Fatal("incomplete family growth fixture")
			}
			for _, n := range lengths {
				runFamilyGrowth(t, bound, n, depth, false)
				if depth && bound.NodesPerDepth != nil {
					runFamilyGrowth(t, bound, n, depth, true)
				}
			}
		})
	}
}

// A fixed upper counter supports zero and combines bounds by their minimum.
func boundFamilyWork(c *workCount, limit int64) {
	if c.under != nil && c.under.Load() <= limit {
		return
	}
	c.under = &workCount{}
	c.under.n.Store(limit)
}

func familyGrowthCounters(b familyGrowthBounds, n int, strict *workCounts) *workCounts {
	w := &workCounts{}
	length := int64(n)
	if b.ItemsPerUnit != nil {
		boundFamilyWork(&w.items, *b.ItemsPerUnit*length+b.Slack)
	}
	if b.NodesPerDepth != nil {
		boundFamilyWork(&w.closeLinks, *b.NodesPerDepth*(length+1)+b.Slack)
	}
	if b.MaxCloseNodes != nil {
		boundFamilyWork(&w.closeLinks, *b.MaxCloseNodes)
	}
	if b.MaxCloseStates != nil {
		boundFamilyWork(&w.closeStates, *b.MaxCloseStates)
	}
	if strict == nil {
		if v := b.StrictBound; v != nil {
			boundFamilyWork(&w.closeStates, v.CloseStatesPerUnit*length+v.CloseStatesSlack)
		}
		boundFamilyWork(&w.familySummaries, 0)
		boundFamilyWork(&w.familySteps, 0)
		return w
	}
	if v := b.OverStrict; v != nil {
		boundFamilyWork(&w.items, strict.items.Load()*(v.ItemsPercent+v.ItemsPercentPerUnit*length)/100+v.ItemsSlack)
		boundFamilyWork(&w.closeStates, strict.closeStates.Load()+v.CloseStatesPerUnit*length)
	}
	if b.EqualsStrict || b.AtMostStrict {
		boundFamilyWork(&w.items, strict.items.Load())
		boundFamilyWork(&w.closeStates, strict.closeStates.Load())
	}
	if v := b.Summaries; v != nil {
		boundFamilyWork(&w.familySummaries, v.PerSquare*length*length+v.Slack)
	}
	if v := b.Steps; v != nil {
		boundFamilyWork(&w.familySteps, v.PerCube*length*length*length+v.Slack)
	}
	return w
}

func runFamilyGrowth(t *testing.T, bound familyGrowthBounds, n int, depth, witness bool) {
	t.Helper()
	counts := []*workCounts{}
	for _, file := range []string{bound.StrictCase, bound.Case} {
		c := growFamilyCase(t, file, n, depth)
		if witness {
			grammar := strings.ReplaceAll(*c.Grammar, ".matches(empty)", fmt.Sprintf(".matches(r%d)", n))
			grammar = strings.ReplaceAll(grammar, "$x.without-elision", "¬$x.without-elision")
			c.Grammar = &grammar
		}
		d, err := casePipeline(c, true)
		if err != nil {
			t.Fatal(err)
		}
		var strict *workCounts
		if len(counts) > 0 {
			strict = counts[0]
		}
		w := familyGrowthCounters(bound, n, strict)
		var before, after runtime.MemStats
		runtime.ReadMemStats(&before)
		start := time.Now()
		peak := before.HeapAlloc
		stop, stopped := make(chan struct{}), make(chan struct{})
		go func() {
			defer close(stopped)
			tick := time.NewTicker(time.Millisecond)
			defer tick.Stop()
			for {
				select {
				case <-stop:
					return
				case <-tick.C:
					var sample runtime.MemStats
					runtime.ReadMemStats(&sample)
					peak = max(peak, sample.HeapAlloc)
				}
			}
		}()
		func() {
			defer func() { close(stop); <-stopped }()
			countWorkIn(w, func() {
				if err := checkGrowthParse(d, c); err != nil {
					t.Fatal(err)
				}
			})
		}()
		runtime.ReadMemStats(&after)
		peak = max(peak, after.HeapAlloc)
		counts = append(counts, w)
		t.Logf("%s, %d units, demanded witness %t: %d items, %d edges, %d close states, %d close nodes, %d cycle contexts, %d summaries, %d steps, %s, %d allocated bytes, %d peak live heap bytes", file, n, witness, w.items.Load(), w.packedEdges.Load(), w.closeStates.Load(), w.closeLinks.Load(), w.closeContexts.Load(), w.familySummaries.Load(), w.familySteps.Load(), time.Since(start), after.TotalAlloc-before.TotalAlloc, peak)
		if witness && (w.closeLinks.Load() == 0 || w.closeStates.Load() == 0) {
			t.Fatal("doubled witness created no close observations")
		}
		if bound.MaxCloseNodes != nil && w.closeLinks.Load() > *bound.MaxCloseNodes {
			t.Fatalf("close nodes exceed %d", *bound.MaxCloseNodes)
		}
		if bound.MaxCloseStates != nil && w.closeStates.Load() > *bound.MaxCloseStates {
			t.Fatalf("close states exceed %d", *bound.MaxCloseStates)
		}
		if bound.NodesPerDepth != nil && w.closeLinks.Load() > *bound.NodesPerDepth*int64(n+1)+bound.Slack {
			t.Fatal("shared doubling node bound")
		}
		if bound.ItemsPerUnit != nil && w.items.Load() > *bound.ItemsPerUnit*int64(n)+bound.Slack {
			t.Fatal("linear item bound")
		}
	}
	strict, family := counts[0], counts[1]
	if strict.familySummaries.Load() != 0 || strict.familySteps.Load() != 0 {
		t.Fatal("family state leaks into a strict query")
	}
	length := int64(n)
	if b := bound.StrictBound; b != nil && strict.closeStates.Load() > b.CloseStatesPerUnit*length+b.CloseStatesSlack {
		t.Fatal("strict owner observation bound")
	}
	if b := bound.OverStrict; b != nil {
		limit := strict.items.Load()*(b.ItemsPercent+b.ItemsPercentPerUnit*length)/100 + b.ItemsSlack
		if family.items.Load() > limit {
			t.Fatalf("%d family items exceed %d", family.items.Load(), limit)
		}
		if family.closeStates.Load() > strict.closeStates.Load()+b.CloseStatesPerUnit*length {
			t.Fatal("family raw observation bound")
		}
	}
	if bound.EqualsStrict && (family.items.Load() != strict.items.Load() || family.closeStates.Load() != strict.closeStates.Load()) {
		t.Fatal("irrelevant family changes strict counts")
	}
	if bound.AtMostStrict && (family.items.Load() > strict.items.Load() || family.closeStates.Load() > strict.closeStates.Load()) {
		t.Fatal("family exceeds strict counts")
	}
	if b := bound.Summaries; b != nil && family.familySummaries.Load() > b.PerSquare*length*length+b.Slack {
		t.Fatalf("%d summaries exceed bound", family.familySummaries.Load())
	}
	if b := bound.Steps; b != nil && family.familySteps.Load() > b.PerCube*length*length*length+b.Slack {
		t.Fatalf("%d steps exceed bound", family.familySteps.Load())
	}
}

// Only the input length changes in a growth fixture. Its result's language
// assertions stay in force without pinning the original token spans.
func checkGrowthParse(d *Pipeline, c *engineCase) error {
	result, err := runCase(d, c, &c.Options)
	if err != nil {
		return err
	}
	raw, err := MarshalResult(result)
	if err != nil {
		return err
	}
	value, err := decodeJSON(raw)
	if err != nil {
		return err
	}
	if problems := resultProblems(value.(map[string]any)); len(problems) > 0 {
		return fmt.Errorf("%v", problems)
	}
	if c.Expect.Result != nil {
		if err := match(*c.Expect.Result, value, "result"); err != nil {
			return err
		}
	}
	return nil
}
