package gencmu

import (
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func issue276Case(t *testing.T, name string) *engineCase {
	t.Helper()
	return loadCase(t, filepath.Join("../../tests/engine", "i276-"+name+".json"))
}
func issue276Pipeline(t *testing.T, c *engineCase) *Pipeline {
	t.Helper()
	pipeline, err := casePipeline(c, false)
	if err != nil {
		t.Fatal(err)
	}
	return pipeline
}
func issue276Parse(t *testing.T, pipeline *Pipeline, c *engineCase) *ParseResult {
	t.Helper()
	result, err := runCase(pipeline, c, &c.Options)
	if err != nil {
		t.Fatal(err)
	}
	return result
}
func issue276Hook(pipeline *Pipeline, call func(*occurrence, *domTerm)) {
	stages := map[*stageGrammar]bool{}
	for _, stage := range pipeline.stages {
		stages[stage] = true
	}
	diagnosticMessage.Store(&messageHook{stages: stages, call: call})
}
func TestIssue276MessageFailure(t *testing.T) {
	c := issue276Case(t, "message-guard")
	p := issue276Pipeline(t, c)
	calls := 0
	issue276Hook(p, func(node *occurrence, recipe *domTerm) {
		calls++
		if node.d.prod.ruleName == "bad" {
			panic(&parseFailure{message: "injected message failure"})
		}
	})
	defer diagnosticMessage.Store(nil)
	result := issue276Parse(t, p, c)
	if calls != 3 || result.Error.Kind != ErrorGrammar || result.Tree != nil || len(result.Error.Errors) != 0 || result.Stages[1].Verdict != VerdictUnique || result.Stages[1].Output != nil {
		t.Fatalf("calls=%d result=%+v error=%+v", calls, result, result.Error)
	}
	if len(result.Warnings) != 1 || result.Warnings[0].Code != "early" || result.Stages[0].Output[0].Value != "a" {
		t.Fatalf("earlier reports or output lost: %+v", result)
	}
}
func TestIssue276SkippedMessages(t *testing.T) {
	for _, name := range []string{"warning-suppression-descendant", "warning-erased"} {
		c := issue276Case(t, name)
		if name == "warning-erased" {
			c.Options = caseOptions{}
		}
		p := issue276Pipeline(t, c)
		issue276Hook(p, func(*occurrence, *domTerm) { panic("a skipped message ran") })
		result := issue276Parse(t, p, c)
		diagnosticMessage.Store(nil)
		if !result.OK {
			t.Fatalf("%s: %+v", name, result.Error)
		}
	}
}
func TestIssue276MessageOnce(t *testing.T) {
	c := issue276Case(t, "tags-report-once")
	p := issue276Pipeline(t, c)
	calls := 0
	issue276Hook(p, func(*occurrence, *domTerm) { calls++ })
	defer diagnosticMessage.Store(nil)
	result := issue276Parse(t, p, c)
	if calls != 1 || len(result.Warnings) != 1 || result.Warnings[0].Message != "warning left" {
		t.Fatalf("calls=%d warnings=%+v", calls, result.Warnings)
	}
}
func TestIssue276AuditNotes(t *testing.T) {
	for _, entry := range []struct {
		fixture, kind, target string
		variants              int
	}{
		{"error-query-matches", "query-error", "bad", 0},
		{"tags-variants-4", "guarded-tag-variants", "", 16},
	} {
		p := issue276Pipeline(t, issue276Case(t, entry.fixture))
		found := false
		for _, note := range p.RankingReports()[0].DiagnosticNotes {
			if note.Kind == entry.kind && note.Target == entry.target && note.Variants == entry.variants {
				found = true
			}
		}
		if !found {
			t.Fatalf("missing note for %s: %+v", entry.fixture, p.RankingReports())
		}
		if entry.variants > 0 && !strings.Contains(FormatRankingReports(p.RankingReports()), "16 guarded tag variants") {
			t.Fatal("variant count missing from text")
		}
	}
	c := issue276Case(t, "warning-suppression-descendant")
	grammar := strings.Replace(*c.Grammar, "%rule wrap *warn", "%rule wrap A", 1)
	c.Grammar = &grammar
	notes := issue276Pipeline(t, c).RankingReports()[0].DiagnosticNotes
	found := false
	for _, note := range notes {
		found = found || note.Kind == "unused-suppression" && note.Code == "warn"
	}
	if !found {
		t.Fatalf("missing suppression note: %+v", notes)
	}
}
func TestIssue276CorpusProjection(t *testing.T) {
	c := issue276Case(t, "error-shape")
	result := issue276Parse(t, issue276Pipeline(t, c), c)
	raw, _ := MarshalResult(result)
	canonical, _ := decodeJSON(raw)
	got, err := corpusOutcomeOf(result, canonical)
	if err != nil {
		t.Fatal(err)
	}
	expected := map[string]any{"expect": "reject", "verdict": VerdictUnique, "stage": "main", "error": map[string]any{"kind": ErrorReported}, "errors": []any{map[string]any{"code": "bad", "at": float64(0)}}, "warnings": []any{}, "at": float64(0)}
	if !reflect.DeepEqual(got, expected) {
		t.Fatalf("got %+v, want %+v", got, expected)
	}
}

// Repeated independent choices must retain a count capped at two.
func TestIssue276CountCap(t *testing.T) {
	pipeline := mustLoad(t, oneStage("%ambiguity-resolution greedy\n%rule text {a}\n%rule a \"a\" | \"a\""))
	result, err := pipeline.Parse(strings.Repeat("a", 100), ParseOptions{})
	if err != nil || result.Error == nil || result.Error.Kind != ErrorAmbiguous || result.Stages[0].Verdict != VerdictTie || len(result.Error.Readings) != 2 {
		t.Fatalf("counted choices: %v %+v", err, result)
	}
}

func TestIssue276CorpusWarningsOptional(t *testing.T) {
	pipeline := mustLoad(t, oneStage("%ambiguity-resolution greedy\n%rule text *warn\n%rule warn \"a\" %warning \"warning\""))
	fields := map[string]any{"expect": "accept", "verdict": VerdictUnique, "brackets": "a"}
	c := &corpusCase{Text: "a", Features: []string{"warn"}, fields: fields}
	got, err := corpusOutcome(pipeline, c)
	if err != nil {
		t.Fatal(err)
	}
	for key, value := range got {
		if key != "warnings" {
			fields[key] = value
		}
	}
	if failure := checkCorpusCase(pipeline, c); failure != "" {
		t.Fatal(failure)
	}
	fields["warnings"] = []any{}
	if failure := checkCorpusCase(pipeline, c); failure == "" {
		t.Fatal("an explicit empty list ignored a warning")
	}
	fields["warnings"] = got["warnings"]
	if failure := checkCorpusCase(pipeline, c); failure != "" {
		t.Fatal(failure)
	}
}

func TestIssue276TagLimitIsLoadError(t *testing.T) {
	for _, name := range []string{"tags-variants-5", "tags-same-result-limit"} {
		_, err := casePipeline(issue276Case(t, name), false)
		if err == nil || !strings.Contains(err.Error(), "16") {
			t.Fatalf("%s: expected load error, got %v", name, err)
		}
	}
}

func TestIssue276SpliceOnlyCycles(t *testing.T) {
	for _, entry := range []string{"loop", "*loop"} {
		p := mustLoad(t, oneStage("%ambiguity-resolution greedy\n%rule text "+entry+"\n%rule loop *loop | A"))
		result, err := p.ParseTokens("a", []InputToken{{Text: "a", Tags: []string{"A"}, Span: [2]int{0, 1}, Source: [2]int{0, 1}}}, ParseOptions{})
		if err != nil || !result.OK || result.Stages[0].Verdict != VerdictUnique {
			t.Fatalf("%s: %v %+v", entry, err, result)
		}
	}
}
