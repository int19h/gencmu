package gencmu

import (
	"fmt"
	"reflect"
	"sort"
	"strings"
	"testing"
)

func competitorContext(t *testing.T, body string, tags ...string) *recognizer {
	t.Helper()
	pipeline := mustLoad(t, oneStage("%ambiguity-resolution greedy\n"+body))
	grammar := pipeline.lower(0, map[string]bool{})
	state := newParseState(pipeline.uni, []rune(strings.ToLower(strings.Join(tags, ""))))
	return state.newRun("main", pipeline.stages[0], deferredTokens(tags...)).recognize(grammar, grammar.byName["text"], 0, len(tags))
}
func competitorOption(t *testing.T, rec *recognizer, label int) *production {
	t.Helper()
	for _, set := range rec.sets {
		for _, item := range set.items {
			p := item.prod
			if item.dot == 0 && p.ranked != nil && p.ranked.parent == "text" && p.option == label {
				return p
			}
		}
	}
	t.Fatal("no ranked text option")
	return nil
}

func TestDeferredCompetitorEvidenceRetainsItsRecognizerFrames(t *testing.T) {
	// Engine §12.1: another recognition cannot replace a chart's lexical frames.
	rec := competitorContext(t, "%rule text :: ∅ | bad ≻ good\n%rule bad A\n%error \"bad\"\n%rule good inner B\n%rule inner :: ∅ | A ≻ C", "A")
	other := rec.run.recognize(rec.g, rec.g.byName["text"], 0, 1)
	for _, chart := range []*recognizer{rec, other} {
		evidence := chart.run.competitorSlice(chart, 0, 1, competitorOption(t, chart, 0))
		if evidence == nil || evidence.Token != 1 || !reflect.DeepEqual(evidence.Expected, []Expected{{Terminal: "B", Rules: []string{"good"}}}) {
			t.Fatalf("wrong evidence: %#v", evidence)
		}
	}
}

func TestDeferredCompetitorCandidatesAndEnumerationGrowLinearly(t *testing.T) {
	// Engine §12.1: candidate indexes and shared prediction groups bound the walk.
	for _, family := range []string{"names", "skipped group", "entry group", "frames"} {
		var counts []int64
		for _, n := range []int{50, 200} {
			alternatives, rules, expected := make([]string, n), make([]string, n), make([]Expected, n)
			for index := range n {
				name := fmt.Sprintf("r%d", index)
				if family != "names" {
					name = "r"
				}
				alternatives[index] = "A " + name
				owner := name
				switch family {
				case "names":
					rules[index] = fmt.Sprintf("%%rule %s B%d", name, index)
				case "skipped group":
					rules[index] = fmt.Sprintf("B%d", index)
				default:
					rules[index] = fmt.Sprintf("%%rule s%d B%d", index, index)
					owner = fmt.Sprintf("s%d", index)
				}
				expected[index] = Expected{Terminal: fmt.Sprintf("B%d", index), Rules: []string{owner}}
			}
			good := "%rule good " + strings.Join(alternatives, " | ")
			body := strings.Join(rules, "\n")
			if family == "skipped group" {
				body = "%rule r " + strings.Join(rules, " | ")
			}
			if family == "entry group" {
				names := make([]string, n)
				for index := range n {
					names[index] = fmt.Sprintf("s%d", index)
				}
				body = "%rule r " + strings.Join(names, " | ") + "\n" + body
			}
			if family == "frames" {
				good = "%rule good $x:choice {$i:inner} B\n%conditions $i.value ≠ \"x\""
				choices := make([]string, n)
				for index := range n {
					choices[index] = fmt.Sprintf("A :: T%d", index)
				}
				body = "%rule choice " + strings.Join(choices, " | ") + "\n%rule inner C"
				expected = []Expected{{Terminal: "C", Rules: []string{"inner"}}}
			}
			rec := competitorContext(t, "%rule text :: ∅ | good ≻ bad\n%rule bad A\n%error \"bad\"\n"+good+"\n"+body, "A")
			option := competitorOption(t, rec, 1)
			work := &workCounts{}
			work.readerSteps.most = int64(100*n + 100)
			var evidence *RejectionEvidence
			countWorkIn(work, func() { evidence = rec.run.competitorSlice(rec, 0, 1, option) })
			sort.Slice(expected, func(i, j int) bool { return expected[i].Terminal < expected[j].Terminal })
			if evidence == nil || evidence.Token != 1 || !reflect.DeepEqual(evidence.Expected, expected) {
				t.Fatalf("%s n=%d: wrong evidence %#v", family, n, evidence)
			}
			counts = append(counts, work.readerSteps.Load())
			t.Logf("%s n=%d: %d slice steps", family, n, work.readerSteps.Load())
		}
		if counts[1] > 5*counts[0] {
			t.Fatalf("%s: nonlinear slice: %v", family, counts)
		}
	}
}

func TestDeferredCompetitorConditionsRemainScopedAndCached(t *testing.T) {
	// Engine §12.1: the extra pass evaluates conditions only inside its slice.
	rec := competitorContext(t, "%rule text :: ∅ | (good ≻ bad) C\n%extend-rule text unrelated\n%rule good A wanted\n%rule wanted K\n%conditions \"x\" = \"x\"\n%rule bad A B\n%error \"bad\"\n%rule unrelated A B unwanted\n%rule unwanted Z\n%conditions \"x\" = \"x\"", "A", "B", "C")
	var option *production
	for _, set := range rec.sets {
		for _, it := range set.items {
			p := it.prod
			if p.ranked != nil && p.option == 1 && len(p.rhs) > 0 && !p.rhs[0].term && rec.g.rules[p.rhs[0].id].name == "bad" {
				option = p
				break
			}
		}
	}
	if option == nil {
		t.Fatal("missing error option")
	}
	work := &workCounts{}
	countWorkIn(work, func() {
		evidence := rec.run.competitorSlice(rec, 0, 2, option)
		if evidence == nil || !reflect.DeepEqual(evidence.Expected, []Expected{{Terminal: "K", Rules: []string{"wanted"}}}) {
			t.Fatalf("wrong scoped evidence: %#v", evidence)
		}
	})
	first := work.conditions.Load()
	if first != 1 {
		t.Fatalf("evaluated %d conditions, want the single reached prediction", first)
	}
	countWorkIn(work, func() { rec.run.competitorSlice(rec, 0, 2, option) })
	if work.conditions.Load() != first {
		t.Fatal("repeated a cached omitted condition")
	}
}
