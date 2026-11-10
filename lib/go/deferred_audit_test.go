package gencmu

import (
	"fmt"
	"reflect"
	"sort"
	"strings"
	"testing"
)

func auditPipeline(t *testing.T, grammar string) *Pipeline {
	t.Helper()
	if !strings.Contains(grammar, "%ambiguity-resolution") {
		grammar = "%ambiguity-resolution greedy\n" + grammar
	}
	return mustLoad(t, oneStage(grammar))
}
func hasEffect(report ErasureReport, effect string) bool {
	for _, name := range report.Effects {
		if name == effect {
			return true
		}
	}
	return false
}

func TestDeferredAuditClassifiesOneLiftedErasure(t *testing.T) {
	// Design, Diagnostics and debugging: each classification lifts only its own erasure.
	pipeline := auditPipeline(t, "%rule text gone empty choice warning inserted\n%rule gone A\n%erased\n%rule empty ε\n%erased\n%rule choice (ε | ε)\n%erased\n%rule warning ε\n%warning \"note\"\n%erased\n%rule inserted producer\n%erased\n%rule producer ε\n%emits ε :: X")
	report := pipeline.RankingReports()[0]
	entries := map[string]ErasureReport{}
	for _, entry := range report.Erasures {
		entries[entry.Rule] = entry
	}
	if entries["empty"].Kind != "inert" || !reflect.DeepEqual(report.IdleErasures, []IdleErasure{{"empty", "g.md"}}) {
		t.Fatalf("wrong inert erasures: %v", report)
	}
	for _, example := range []struct{ rule, effect string }{{"gone", "counted-parts"}, {"gone", "diagnostics"}, {"choice", "derivation-choice"}, {"warning", "diagnostics"}, {"inserted", "emission"}} {
		if !hasEffect(entries[example.rule], example.effect) {
			t.Fatalf("missing %s effect for %s", example.effect, example.rule)
		}
	}
	printed := FormatRankingReports([]RankingReport{report})
	if !strings.Contains(printed, "semantic erasure: gone") || !strings.Contains(printed, "inert erasure: empty") {
		t.Fatal(printed)
	}
}

func TestDeferredAuditKeepsAlternativeEffectsAndInnerErasure(t *testing.T) {
	// Design, Diagnostics and debugging: another erasure retains its own effects.
	report := auditPipeline(t, "%rule text outer multi closed\n%rule outer inner\n%erased\n%rule inner A\n%erased\n%rule multi ε | A\n%erased\n%rule closed producer\n%erased\n%rule producer child\n%emits\n%rule child ε\n%emits ε :: X").RankingReports()[0]
	entries := map[string][]ErasureReport{}
	for _, entry := range report.Erasures {
		entries[entry.Rule] = append(entries[entry.Rule], entry)
	}
	if len(entries["multi"]) != 2 || entries["outer"][0].Kind != "inert" || entries["closed"][0].Kind != "semantic" {
		t.Fatalf("wrong effects: %v", entries)
	}
	for _, entry := range report.IdleErasures {
		if entry.Rule == "multi" {
			t.Fatal("a mixed rule is not inert")
		}
	}
}

func TestDeferredAuditSeparatesOrdinaryAndFilteredQueryNotes(t *testing.T) {
	// Engine §4.3: an erased own error can supply either kind of witness.
	pipeline := auditPipeline(t, "%rule text $a:A\n%conditions $a.parse(target), $a.parse(target …).error-free\n%rule target hidden\n%rule hidden A\n%error \"fault\"\n%erased")
	report := pipeline.RankingReports()[0]
	found := map[bool]bool{}
	for _, note := range report.DiagnosticNotes {
		if note.Kind == "query-error" {
			if note.Target != "hidden" {
				t.Fatal(note)
			}
			found[note.Filtered] = true
		}
	}
	if len(found) != 2 {
		t.Fatal(report.DiagnosticNotes)
	}
	printed := FormatRankingReports([]RankingReport{report})
	if !strings.Contains(printed, "allow carried errors") || !strings.Contains(printed, "carried errors outside erased parts") || strings.Contains(printed, "cannot supply") {
		t.Fatal(printed)
	}
}

func TestDeferredAuditSharesEffectAndClauseWalks(t *testing.T) {
	// Engine §4.3: shared definitions close their union of query targets once.
	for _, family := range []string{"chain", "conditions", "emission"} {
		var counts []int64
		for _, n := range []int{50, 200} {
			var grammar string
			if family == "chain" {
				grammar = "%rule text gone\n%rule gone r0\n%erased"
				for index := range n {
					target := fmt.Sprintf("r%d", index+1)
					if index == n-1 {
						target = "A"
					}
					grammar += fmt.Sprintf("\n%%rule r%d %s", index, target)
				}
			} else {
				alternatives, clauses := make([]string, n), make([]string, n)
				for index := range n {
					alternatives[index] = fmt.Sprintf("$c%d:A", index)
					if family == "conditions" {
						clauses[index] = fmt.Sprintf("$c%d.value=\"a\"", index)
					} else {
						clauses[index] = fmt.Sprintf("$c%d", index)
					}
				}
				grammar = "%rule text " + strings.Join(alternatives, " | ")
				if family == "conditions" {
					grammar += "\n%conditions " + strings.Join(clauses, ", ")
				} else {
					grammar += "\n%emits " + strings.Join(clauses, ", ")
				}
			}
			pipeline := auditPipeline(t, grammar)
			work := &workCounts{}
			countWorkIn(work, func() {
				report := pipeline.RankingReports()[0]
				if family == "chain" && !hasEffect(report.Erasures[0], "counted-parts") {
					t.Fatal("missing propagated effect")
				}
			})
			count := work.readerSteps.Load() + work.clauseSteps.Load() + work.ruleSetSteps.Load()
			counts = append(counts, count)
			if count > int64(80*n+100) {
				t.Fatalf("%s n=%d: %d audit steps", family, n, count)
			}
			t.Logf("%s n=%d: %d audit steps", family, n, count)
		}
		if counts[1] > 5*counts[0] {
			t.Fatalf("%s: nonlinear audit %v", family, counts)
		}
	}
}

func TestDeferredAuditCachesQueryReportTargets(t *testing.T) {
	// Design, Diagnostics and debugging: alternatives share the filtered report targets.
	var counts []int64
	for _, n := range []int{50, 200} {
		alternatives, conditions, rules := make([]string, n), make([]string, n), make([]string, n)
		for index := range n {
			alternatives[index] = fmt.Sprintf("$c%d:A :: T%d", index, index)
			conditions[index] = fmt.Sprintf("$c%d.parse(r0)", index)
			target := "A"
			if index+1 < n {
				target = fmt.Sprintf("r%d", index+1)
			}
			rules[index] = fmt.Sprintf("%%rule r%d %s", index, target)
		}
		grammar := "%rule text :: $.parse(r0).tags | " + strings.Join(alternatives, " | ") + "\n%conditions " + strings.Join(conditions, ", ") + "\n" + strings.Join(rules, "\n") + "\n%error \"fault\"\n%erased"
		pipeline := auditPipeline(t, grammar)
		work := &workCounts{}
		var notes []DiagnosticNote
		countWorkIn(work, func() { notes = pipeline.RankingReports()[0].DiagnosticNotes })
		if len(notes) != 1 || notes[0].Kind != "query-error" || notes[0].Target != fmt.Sprintf("r%d", n-1) || notes[0].Filtered {
			t.Fatalf("wrong notes: %v", notes)
		}
		count := work.readerSteps.Load() + work.clauseSteps.Load() + work.ruleSetSteps.Load()
		if count > int64(80*n+100) {
			t.Fatalf("n=%d: %d audit steps", n, count)
		}
		counts = append(counts, count)
		t.Logf("query annotations n=%d: %d audit steps", n, count)
	}
	if counts[1] > 5*counts[0] {
		t.Fatalf("nonlinear audit: %v", counts)
	}
}

func TestDeferredAuditKeepsAlternativeTargetsAndExtensionLocations(t *testing.T) {
	// Engine §2: cached queries keep each definition's clauses and source position.
	grammar := "%rule text :: $.parse(common).tags | A :: $.parse(first).tags | A :: $.parse(second).tags\n%conditions $.parse(target), $.parse(target).error-free\n%extend-rule text A :: $.parse(first).tags\n%conditions $.parse(other).error-free\n"
	for _, name := range []string{"common", "first", "second", "target", "other"} {
		grammar += "%rule " + name + " A\n%error \"fault\"\n%erased\n"
	}
	notes := auditPipeline(t, grammar).RankingReports()[0].DiagnosticNotes
	var got []string
	for _, note := range notes {
		if note.Kind == "query-error" {
			got = append(got, fmt.Sprintf("%d:%s:%v", note.Line, note.Target, note.Filtered))
		}
	}
	want := []string{"5:common:false", "5:first:false", "5:second:false", "5:target:false", "5:target:true", "7:first:false", "7:other:true"}
	sort.Strings(got)
	sort.Strings(want)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("wrong locations: %v", got)
	}
}

func TestDeferredAuditQueryNotesFollowDiscoveryOrder(t *testing.T) {
	// Design, Diagnostics and debugging: query notes retain the clause walk's order.
	report := auditPipeline(t, "%rule text (r3 ≻ r2) :: ∅ | W\n%rule r2 X\n%error \"r2\"\n%rule r3 $x:W [*r4]\n%conditions $x.parse(text …)\n%rule r4 W X W\n%error \"r4\"").RankingReports()[0]
	var targets []string
	for _, note := range report.DiagnosticNotes {
		if note.Kind == "query-error" && note.Rule == "r3" {
			targets = append(targets, note.Target)
		}
	}
	if !reflect.DeepEqual(targets, []string{"r4", "r2"}) {
		t.Fatalf("query targets: %v", targets)
	}
}
