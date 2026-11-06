package gencmu

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestDeferredReportingErrorsBarReconstruction(t *testing.T) {
	// Engine §7: both carried errors and pending stage errors bar reconstruction.
	for _, name := range []string{"pending-skips-elision", "carried-skips-elision"} {
		c := loadCase(t, filepath.Join("../../tests/engine", "deferred-report-"+name+".json"))
		pipeline := issue276Pipeline(t, c)
		options := ParseOptions{private: &privateOptions{elisionCheck: func(*elisionCheckRun) elisionWatch {
			t.Fatal("a counted error entered reconstruction")
			return elisionWatch{}
		}}}
		tokens, text, err := caseTokens(c.Tokens)
		if err != nil {
			t.Fatal(err)
		}
		result, err := pipeline.ParseTokens(text, inputTokensOf(tokens), options)
		if err != nil || result.Error == nil || result.Error.Kind != ErrorReported {
			t.Fatalf("lost report: %v %v", err, result)
		}
	}
}

func TestDeferredReportingTieMessageFailureKeepsItsPrefix(t *testing.T) {
	// Engine §12.1: a failed second message keeps evaluated and carried diagnostics.
	c := loadCase(t, "../../tests/engine/deferred-report-tie-carried-and-multiplicity.json")
	pipeline := issue276Pipeline(t, c)
	calls := 0
	issue276Hook(pipeline, func(node *occurrence, _ *domTerm) {
		if node.d.prod.ruleName == "note" {
			calls++
			if calls == 2 {
				panic(&parseFailure{message: "message guard"})
			}
		}
	})
	defer diagnosticMessage.Store(nil)
	result := issue276Parse(t, pipeline, c)
	if result.Error == nil || result.Error.Kind != ErrorGrammar || result.Stages[len(result.Stages)-1].Verdict != VerdictTie || result.Tree != nil || result.Stages[len(result.Stages)-1].Output != nil {
		t.Fatalf("wrong failure: %v", result.Error)
	}
	requireFlowCodes(t, result.Error.Errors, "fault")
	requireFlowCodes(t, result.Warnings, "note", "carrier")
	requireFlowCodes(t, result.Error.Warnings, "note", "carrier")
}

func TestDeferredReportingFailuresDropErasedEvaluatedDiagnostics(t *testing.T) {
	// Engine §12.1: a grammar ending excludes evaluated diagnostics under erasure.
	for _, example := range []struct {
		tied   bool
		failAt int
	}{{false, 1}, {true, 1}, {true, 2}} {
		body := "first gone fail"
		if example.tied {
			body += " | " + body
		}
		source := "%stage before\n%ambiguity-resolution greedy\n%rule text $a:A $b:older $c:C\n%emits $a, $b, $c\n%rule older B\n%error \"input fault\"\n%stage last\n%ambiguity-resolution greedy\n%rule text " + body + "\n%rule first A\n%warning \"kept\"\n%rule gone bad notice\n%erased\n%rule bad B\n%error \"erased error\"\n%rule notice ε\n%warning \"erased warning\"\n%rule fail C\n%warning \"stop\""
		pipeline := mustLoad(t, map[string]string{"p.md": "```jbogenbau\n" + source + "\n```\n"})
		seen := map[string]int{}
		calls := 0
		issue276Hook(pipeline, func(node *occurrence, _ *domTerm) {
			code := node.d.prod.ruleName
			seen[code]++
			if code == "fail" {
				calls++
				if calls == example.failAt {
					panic(&parseFailure{message: "message guard"})
				}
			}
		})
		result, err := pipeline.ParseTokens("abc", []InputToken{{Text: "a", Tags: []string{"A"}, Source: [2]int{0, 1}}, {Text: "b", Tags: []string{"B"}, Source: [2]int{1, 2}}, {Text: "c", Tags: []string{"C"}, Source: [2]int{2, 3}}}, ParseOptions{Features: []string{"first", "notice", "fail"}})
		diagnosticMessage.Store(nil)
		if err != nil || result.Error == nil || result.Error.Kind != ErrorGrammar {
			t.Fatalf("wrong failure: %v %v", err, result)
		}
		requireFlowCodes(t, result.Error.Errors, "older")
		if result.Error.Errors[0].Stage != "before" {
			t.Fatal("changed raising stage")
		}
		want := []string{"first"}
		if example.failAt == 2 {
			want = []string{"first", "fail", "first"}
		}
		requireFlowCodes(t, result.Warnings, want...)
		if seen["bad"] != example.failAt || seen["notice"] != example.failAt {
			t.Fatalf("erased messages did not evaluate: %v", seen)
		}
		encoded, err := MarshalResult(result)
		if err != nil || strings.Contains(string(encoded), "erased error") {
			t.Fatal("serialized erased diagnostic")
		}
	}
}
