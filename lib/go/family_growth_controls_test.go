package gencmu

import (
	"fmt"
	"strings"
	"testing"
)

func TestFamilyRecordCharges(t *testing.T) {
	closes := newCloseArena()
	candidate := closeEvent{record: Restoration{Terminal: "T", At: 1}}
	observation := closes.state(closes.leaf(candidate), 0)
	f := newFamilyArena(closes, observation, 0, 2, nil)
	block := &rankedGroup{}
	w := &workCounts{}
	countWorkIn(w, func() {
		for _, c := range []struct {
			name      string
			event     closeEvent
			permitted bool
			steps     int64
		}{
			{"permitted close", candidate, true, 4},
			{"unpermitted close", candidate, false, 4},
			{"block", closeEvent{record: Restoration{At: 1}, block: block, end: 2}, false, 4},
			{"close beyond end", closeEvent{record: Restoration{Terminal: "T", At: 3}}, true, 0},
			{"block beyond end", closeEvent{record: Restoration{At: 3}, block: block, end: 4}, false, 0},
			{"block starting at end", closeEvent{record: Restoration{At: 2}, block: block, end: 3}, false, 0},
		} {
			before := w.familySteps.Load()
			id := f.record(c.event, c.permitted)
			if got := w.familySteps.Load() - before; got != c.steps {
				t.Fatalf("%s: first record costs %d, want %d", c.name, got, c.steps)
			}
			states := len(f.summaries)
			before = w.familySteps.Load()
			if repeated := f.record(c.event, c.permitted); repeated != id || len(f.summaries) != states {
				t.Fatalf("%s: repeated record did not reuse its summary", c.name)
			}
			if got := w.familySteps.Load() - before; got != c.steps {
				t.Fatalf("%s: repeated record costs %d, want %d", c.name, got, c.steps)
			}
		}
	})
}

func TestFamilyRankedGrowthMembers(t *testing.T) {
	const file = "engine/without-elision-except-undemanded-ranked-sibling.json"
	for _, depth := range []int{4, 256} {
		c := growFamilyCase(t, file, depth, true)
		d, err := caseDialect(c, true)
		if err != nil {
			t.Fatal(err)
		}
		members := d.stages[0].families["fam"]
		if len(members) != 4 || !members["fam"] || !members["a"] || !members["b"] || !members["r0"] {
			t.Fatalf("depth %d changed the permitting family: %v", depth, members)
		}
	}
}

func TestFamilyGrowthStopsAtBudget(t *testing.T) {
	strictCase := growFamilyCase(t, "engine/without-elision-owner-choice.json", 4, false)
	familyCase := growFamilyCase(t, "engine/without-elision-except-owner-choice.json", 4, false)
	strictDialect, err := caseDialect(strictCase, true)
	if err != nil {
		t.Fatal(err)
	}
	familyDialect, err := caseDialect(familyCase, true)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct{ name, limits string }{
		{"absolute", `{"itemsPerUnit":0,"slack":103}`},
		{"relative", `{"overStrict":{"itemsPercent":100,"itemsSlack":11}}`},
	} {
		t.Run(c.name, func(t *testing.T) {
			var bound familyGrowthBounds
			if err := unmarshalJSON([]byte(c.limits), &bound); err != nil {
				t.Fatal(err)
			}
			strict := familyGrowthCounters(bound, 4, nil)
			countWorkIn(strict, func() {
				if err := checkGrowthParse(strictDialect, strictCase); err != nil {
					t.Fatal(err)
				}
			})
			if strict.items.Load() != 92 {
				t.Fatalf("strict control needs 92 items, got %d", strict.items.Load())
			}
			family := familyGrowthCounters(bound, 4, strict)
			finished := false
			var stop any
			var parseErr error
			func() {
				defer func() { stop = recover() }()
				countWorkIn(family, func() {
					parseErr = checkGrowthParse(familyDialect, familyCase)
					finished = parseErr == nil
				})
			}()
			if finished || family.items.Load() != 104 || !strings.Contains(fmt.Sprint(stop, parseErr), "104 items, past the bound of 103") {
				t.Fatalf("parse did not stop at its first excess item: finished=%t, items=%d, stop=%v, error=%v", finished, family.items.Load(), stop, parseErr)
			}
			t.Logf("strict finishes with %d items; family stops at item %d before producing its result", strict.items.Load(), family.items.Load())
		})
	}
}

func TestFamilyGrowthZeroBudgets(t *testing.T) {
	var bound familyGrowthBounds
	if err := unmarshalJSON([]byte(`{"itemsPerUnit":0,"nodesPerDepth":0,"maxCloseNodes":0,"maxCloseStates":0,"overStrict":{},"strictBound":{},"summaries":{},"steps":{}}`), &bound); err != nil {
		t.Fatal(err)
	}
	for _, strict := range []*workCounts{nil, {}} {
		w := familyGrowthCounters(bound, 4, strict)
		for _, c := range []struct {
			name string
			c    *workCount
		}{
			{"items", &w.items}, {"close nodes", &w.closeLinks}, {"close states", &w.closeStates},
			{"summaries", &w.familySummaries}, {"steps", &w.familySteps},
		} {
			continued := false
			var stop any
			func() {
				defer func() { stop = recover() }()
				c.c.add(c.name)
				continued = true
			}()
			if continued || c.c.Load() != 1 || !strings.Contains(fmt.Sprint(stop), "past the bound of 0") {
				t.Fatalf("%s did not enforce zero: %v", c.name, stop)
			}
		}
	}
}
