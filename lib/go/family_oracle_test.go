package gencmu

import (
	"path/filepath"
	"testing"
)

type markedFamilyRecord struct {
	event     closeEvent
	permitted bool
}

// This test-only oracle enumerates finite proofs on the small shared cases.
// The engine retains no marked records. The oracle uses the definition's
// deletion choices directly, rather than its relation summaries.
func familyProofRecords(r *recognizer, root *item, visit func([]markedFamilyRecord)) {
	active := map[spanKey]bool{}
	var complete func(*item, func([]markedFamilyRecord))
	var prefix func(*item, func([]markedFamilyRecord))
	complete = func(it *item, done func([]markedFamilyRecord)) {
		a, b := r.observed(it.origin, it.set)
		key := spanKey{g: r.g, rule: it.prod.lhs, a: a, b: b}
		named := !it.prod.helper
		if named && active[key] {
			return
		}
		if named {
			active[key] = true
			defer delete(active, key)
		}
		prefix(it, func(events []markedFamilyRecord) {
			if it.prod.restoration() {
				events = append(append([]markedFamilyRecord{}, events...), markedFamilyRecord{closeEvent{record: r.closeRecord(it.prod.elided, a, it.prod.elidedTest)}, r.family.members[it.prod.ruleName]})
			}
			// The continuation is outside this named occurrence.
			if named {
				delete(active, key)
			}
			done(events)
			if named {
				active[key] = true
			}
		})
	}
	prefix = func(it *item, done func([]markedFamilyRecord)) {
		if it == nil || it.dot == 0 {
			done(nil)
			return
		}
		for _, edge := range it.links {
			prefix(edge.prev, func(left []markedFamilyRecord) {
				if edge.sym == nil {
					done(left)
					return
				}
				if r.g.rankedHelpers[edge.sym.rule] != nil {
					done(append(append([]markedFamilyRecord{}, left...), markedFamilyRecord{event: r.blockEvent(edge.sym)}))
					return
				}
				for _, child := range edge.sym.items {
					complete(child, func(right []markedFamilyRecord) {
						joined := append(append([]markedFamilyRecord{}, left...), right...)
						done(joined)
					})
				}
			})
		}
	}
	complete(root, visit)
}

func plainFamilyDeletion(f *familyArena, witness []markedFamilyRecord, end int) bool {
	h := min(f.b, end)
	groups := map[int][]markedFamilyRecord{}
	for _, w := range witness {
		p := w.event.record.At
		if p > h || w.event.block != nil && p == h && w.event.end > h {
			continue
		}
		if w.event.block != nil && p < h && w.event.end > h {
			return false
		}
		groups[p] = append(groups[p], w)
	}
	boundaries := map[int]bool{}
	for p := range f.groups {
		if p <= h {
			boundaries[p] = true
		}
	}
	for p := range groups {
		boundaries[p] = true
	}
	for p := range boundaries {
		candidate := f.groups[p]
		if p == h && len(candidate) > 0 {
			last := candidate[len(candidate)-1]
			if last.block != nil && last.end > h {
				candidate = candidate[:len(candidate)-1]
			}
		}
		records := groups[p]
		type state struct{ w, c int }
		seen := map[state]bool{}
		var match func(int, int) bool
		match = func(w, c int) bool {
			if w == len(records) {
				return c == len(candidate)
			}
			key := state{w, c}
			if seen[key] {
				return false
			}
			seen[key] = true
			record := records[w]
			if c < len(candidate) && equalFamilyRecord(record.event, candidate[c]) && match(w+1, c+1) {
				return true
			}
			before, after := p > f.a || c > 0, p < h || c < len(candidate)
			return record.event.block == nil && record.permitted && before && after && match(w+1, c)
		}
		if !match(0, 0) {
			return false
		}
	}
	return true
}

func TestFamilyDeletionOracle(t *testing.T) {
	files, err := filepath.Glob("../../tests/engine/*.json")
	if err != nil || len(files) == 0 {
		t.Fatal("no family fixtures", err)
	}
	checked, proofs := 0, 0
	for _, file := range files {
		t.Run(filepath.Base(file), func(t *testing.T) {
			c := loadCase(t, file)
			if c.skipReason != "" {
				t.Skip(c.skipReason)
			}
			c.familyOracle = func(r *recognizer, it *item) {
				checked++
				_, end := r.observed(it.origin, it.set)
				want := r.family.matches(it.familySummary, r.query.at.a, end)
				if it.closes == invalidCloses {
					if want {
						t.Fatal("cyclic family summary is live")
					}
					return
				}
				found := false
				familyProofRecords(r, it, func(records []markedFamilyRecord) {
					proofs++
					found = true
					got := plainFamilyDeletion(r.family, records, end)
					if got != want {
						t.Fatalf("deletion differs at %d: summary %t, plain %t, %v", end, want, got, records)
					}
				})
				if !found {
					t.Fatalf("qualified family item has no finite proof: %s origin=%d end=%d dot=%d links=%d summary=%d", it.prod.ruleName, it.origin, it.set, it.dot, len(it.links), it.familySummary)
				}
			}
			if err := checkCase(c, true); err != nil {
				t.Fatal(err)
			}
		})
	}
	if checked == 0 || proofs == 0 {
		t.Fatal("oracle observed no family witnesses")
	}
	t.Logf("%d qualified items, %d finite witness proofs", checked, proofs)
}
