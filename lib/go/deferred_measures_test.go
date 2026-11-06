package gencmu

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func fixedMeasure(a, b, c int64) diagnosticMeasure {
	return diagnosticMeasure{countOf(a), countOf(b), countOf(c)}
}

func requireMeasure(t *testing.T, got, want diagnosticMeasure) {
	t.Helper()
	if got.cmp(want) != 0 {
		t.Fatalf("measure %v, want %v", got, want)
	}
}

func TestDeferredFixedMeasureOrderAndArithmetic(t *testing.T) {
	// Engine §6: blame and sourceless count ascend, while count descends.
	for _, pair := range [][2]diagnosticMeasure{
		{fixedMeasure(0, 2000, 2000), fixedMeasure(1, 0, 1)},
		{{}, fixedMeasure(0, 2000, 2000)},
		{fixedMeasure(0, 0, 4), fixedMeasure(0, 0, 3)},
	} {
		if pair[0].cmp(pair[1]) >= 0 {
			t.Fatal("wrong measure order", pair)
		}
	}
	large := fixedMeasure(1<<62, 1<<62, 1<<62)
	doubled := large.add(large)
	for _, component := range doubled {
		if component.bigValue().String() != "9223372036854775808" {
			t.Fatal("inexact sum", component)
		}
	}
}

func TestDeferredSourceChargesAndProjectedReconstruction(t *testing.T) {
	// Engine §6: sourcelessness tests the tokens rather than their envelope.
	m := newDiagnosticMeasures([]Token{{Source: [2]int{2, 2}}, {Source: [2]int{9, 9}}, {Source: [2]int{7, 8}}})
	requireMeasure(t, m.own(0, 2), fixedMeasure(0, 1, 1))
	requireMeasure(t, m.own(0, 3), fixedMeasure(7, 0, 1))
	// Engine §7.7: synthetic anchors neither add source nor extend envelopes.
	for _, sources := range [][2][2]int{{{0, 1}, {5, 6}}, {{10, 11}, {0, 1}}} {
		original := newDiagnosticMeasures([]Token{{Source: sources[0]}, {Source: sources[1]}})
		restored := newDiagnosticMeasures([]Token{{Source: sources[0]}, {Source: [2]int{50, 50}}, {Source: sources[1]}})
		restored.original, restored.project = original, []int{0, 1, 1, 2}
		requireMeasure(t, restored.own(1, 3), fixedMeasure(1, 0, 1))
		requireMeasure(t, restored.own(1, 2), fixedMeasure(0, 1, 1))
		requireMeasure(t, restored.own(0, 3), original.own(0, 2))
	}
}

func TestDeferredCarriedIdentityAndChargeSurvivePublicMutation(t *testing.T) {
	// Engine §1: public coordinates cannot alter a fixed carried charge.
	identity := &diagnosticIdentity{stageOrder: 1, ordinal: 2}
	original := recordDiagnostic(Warning{Stage: "before", Code: "fault", Rule: "fault", Source: [2]int{2, 6}}, fixedMeasure(4, 0, 1), identity)
	duplicate := original
	duplicate.Source, duplicate.Span = [2]int{0, 100}, [2]int{3, 9}
	if duplicate.record != original.record || duplicate.record.identity != identity {
		t.Fatal("lost private identity")
	}
	m := newDiagnosticMeasures([]Token{{Source: [2]int{0, 1}, Errors: []Warning{duplicate}}})
	requireMeasure(t, m.carried[0], fixedMeasure(4, 0, 1))
}

func TestDeferredCallerDiagnosticsAreUsageErrors(t *testing.T) {
	// API caller tokens: only empty diagnostic lists enter through ParseTokens.
	pipeline := &Pipeline{}
	for _, token := range []InputToken{{Errors: []Warning{{Code: "fault"}}}, {Warnings: []Warning{{Code: "note"}}}} {
		_, err := pipeline.ParseTokens("", []InputToken{token}, ParseOptions{})
		if failure, ok := err.(*Error); !ok || failure.Kind != ErrorUsage {
			t.Fatalf("expected usage error, got %v", err)
		}
	}
}

func TestDeferredCanonicalDiagnosticFieldsAndMemberOrder(t *testing.T) {
	// Output §1: errors alone carry rejection evidence, after their message.
	diagnostic := Warning{Stage: "main", Code: "fault", Rule: "fault", Span: [2]int{0, 1}, Source: [2]int{0, 1}, Message: "fault",
		Rejection: &RejectionEvidence{Token: 1, Source: [2]int{1, 1}, Line: 1, Column: 2, Expected: []Expected{{Terminal: "B", Rules: []string{"text"}}}}}
	token := Token{Text: "a", Value: "a", Image: "a", Tags: []string{"A"}, Span: [2]int{0, 1}, Source: [2]int{0, 1}, Errors: []Warning{diagnostic}, Warnings: []Warning{diagnostic}}
	token.Before = []Token{token}
	result := &ParseResult{Stages: []Stage{{Name: "main", Verdict: VerdictUnique, Output: []Token{token}, Errors: []Warning{diagnostic}, Warnings: []Warning{diagnostic}}},
		Error: &ParseError{Kind: ErrorGrammar, Stage: "main", Code: "guard", Document: "g.md", Errors: []Warning{diagnostic}, Warnings: []Warning{diagnostic}, Message: "guard"}, Warnings: []Warning{diagnostic}}
	raw, err := MarshalResult(result)
	if err != nil {
		t.Fatal(err)
	}
	var data map[string]any
	if err = json.Unmarshal(raw, &data); err != nil {
		t.Fatal(err)
	}
	if data["format"] != float64(17) {
		t.Fatal("old result format")
	}
	pending := []map[string]any{data}
	for len(pending) > 0 {
		current := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		for key, value := range current {
			if items, ok := value.([]any); ok {
				for _, item := range items {
					if object, ok := item.(map[string]any); ok {
						if key == "errors" || key == "warnings" {
							_, present := object["rejection"]
							if present != (key == "errors") {
								t.Fatalf("%s evidence: %v", key, object)
							}
						}
						pending = append(pending, object)
					}
				}
			} else if object, ok := value.(map[string]any); ok {
				pending = append(pending, object)
			}
		}
	}
	envelope := data["error"].(map[string]any)
	if _, present := envelope["document"]; present {
		t.Fatal("grammar envelope has document")
	}
	if !strings.Contains(string(raw), `"kind":"grammar","stage":"main","code":"guard","errors":[`) {
		t.Fatal("wrong grammar member order", string(raw))
	}
	if !reflect.DeepEqual(envelope["warnings"], data["warnings"]) {
		t.Fatal("envelope warning order differs")
	}
	// Output §1: absent and empty diagnostics both omit their array members.
	empty, _ := MarshalResult(&ParseResult{Error: &ParseError{Kind: ErrorReported, Stage: "main", Errors: []Warning{}}})
	if strings.Contains(string(empty), `"errors"`) {
		t.Fatal("serialized an empty diagnostic list")
	}
}
