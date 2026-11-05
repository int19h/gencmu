package gencmu

import (
	"encoding/json"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestIssue276GuardErrorPositionsPreparsed(t *testing.T) {
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"guard-target-header-position", "guard-target-alternative-position", "guard-compound-position", "guard-negated-nonliteral-position", "guard-negated-receiver-position"} {
		t.Run(name, func(t *testing.T) {
			fixture := issue276Case(t, name)
			source := "```jbogenbau\n%ambiguity-resolution greedy\n" + *fixture.Grammar + "\n```\n"
			compound := name == "guard-compound-position"
			negated := strings.HasPrefix(name, "guard-negated-")
			readable := strings.Replace(source, " ∧ $.followed-by(b)", "", 1)
			readable = strings.Replace(readable, "$y.tags", "T", 1)
			readable = strings.Replace(readable, "¬$y.followed-by", "¬$.followed-by", 1)
			dom, readErr := bundled.reader.read(readable, "grammars/test/g.md")
			if readErr != nil {
				t.Fatal(readErr)
			}
			var rule *domRule
			for _, r := range dom.Rules {
				if r.Name == "x" {
					rule = r
				}
			}
			term := rule.Tags
			if term == nil {
				term = rule.Alternatives[0].Tags
			}
			atom := term.Cond
			if negated {
				atom = atom.Inner
			}
			consequent, receiver := term.Items[0], atom.Span
			if name == "guard-negated-nonliteral-position" {
				term.Items[0] = &domTerm{Kind: tmCall, Str: "tags", Items: []*domTerm{{Kind: tmCapture, Str: "y"}}}
			} else if negated {
				atom.Span = &domTerm{Kind: tmCapture, Str: "y"}
			}
			if compound {
				term.Cond = &domCond{Kind: cdAll, Items: []*domCond{atom, atom}}
			}
			load := func(cached bool) error {
				sources := map[string]string{"grammars/test/p.md": "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n", "grammars/test/g.md": source}
				if cached {
					cache, err := json.Marshal(map[string]any{
						"format": domFormat, "bootstrap": bundled.reader.hash, "unicode": bundled.uni.hash,
						"properties": fnv1a64(bundled.sources["data/unicode/unicode-properties.txt"]),
						"documents":  map[string]any{"grammars/test/g.md": map[string]any{"hash": fnv1a64(source), "dom": json.RawMessage(dom.json())}},
					})
					if err != nil {
						t.Fatal(err)
					}
					sources["data/preparsed/test.json"] = string(cache)
				}
				_, err := LoadPipelineSources(sources, "grammars/test/p.md")
				return err
			}
			plain, cached := load(false), load(true)
			if !reflect.DeepEqual(plain, cached) {
				t.Fatalf("source=%+v preparsed=%+v", plain, cached)
			}
			wantLine, wantColumn := 4, 27
			if name == "guard-target-alternative-position" {
				wantLine, wantColumn = 5, 31
			} else if compound {
				wantColumn = 1
			} else if negated {
				wantColumn = 21
			}
			failure, ok := plain.(*Error)
			if !ok || failure.Kind != "grammar" || failure.Line != wantLine || failure.Column != wantColumn {
				t.Fatalf("wrong error position: %+v", plain)
			}
			if negated {
				term.Items[0], atom.Span = consequent, receiver
			} else if compound {
				term.Cond = atom
			} else {
				atom.Targets[0].Str = "x"
			}
			if err := load(true); err != nil {
				t.Fatalf("the preparsed control must use its DOM instead of the invalid source: %v", err)
			}
		})
	}
}

func TestIssue276GuardSitesPreparsed(t *testing.T) {
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		name  string
		index int
	}{
		{"guard-duplicate-alternatives", 1}, {"guard-header-first", 0}, {"guard-simplified-origin", 1},
	} {
		t.Run(c.name, func(t *testing.T) {
			fixture := issue276Case(t, c.name)
			source := "```jbogenbau\n" + *fixture.Grammar + "\n```\n"
			dom, readErr := bundled.reader.read(source, "grammars/test/g.md")
			if readErr != nil {
				t.Fatal(readErr)
			}
			cache, err := json.Marshal(map[string]any{
				"format": domFormat, "bootstrap": bundled.reader.hash, "unicode": bundled.uni.hash,
				"properties": fnv1a64(bundled.sources["data/unicode/unicode-properties.txt"]),
				"documents":  map[string]any{"grammars/test/g.md": map[string]any{"hash": fnv1a64(source), "dom": json.RawMessage(dom.json())}},
			})
			if err != nil {
				t.Fatal(err)
			}
			parse := func(cache string) *ParseResult {
				sources := map[string]string{"grammars/test/p.md": "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n", "grammars/test/g.md": source}
				if cache != "" {
					sources["data/preparsed/test.json"] = cache
				}
				pipeline, err := LoadPipelineSources(sources, "grammars/test/p.md")
				if err != nil {
					t.Fatal(err)
				}
				result, err := pipeline.Parse("bab", ParseOptions{})
				if err != nil {
					t.Fatal(err)
				}
				return result
			}
			plain, cached := parse(""), parse(string(cache))
			for _, result := range []*ParseResult{plain, cached} {
				if result.Error == nil || result.Error.Boundary == nil || result.Error.Boundary.Condition != c.index {
					t.Fatalf("wrong guard site: %+v", result.Error)
				}
			}
			left, err := MarshalResult(plain)
			if err != nil {
				t.Fatal(err)
			}
			right, err := MarshalResult(cached)
			if err != nil {
				t.Fatal(err)
			}
			if string(left) != string(right) {
				t.Fatalf("source and preparsed results differ: %s %s", left, right)
			}
			if c.name == "guard-duplicate-alternatives" {
				changed := strings.Replace(string(cache), `"string":"x"`, `"string":"a"`, 1)
				if changed == string(cache) || parse(changed).Error.Boundary.Condition != 0 {
					t.Fatal("the preparsed route must use its DOM")
				}
			}
		})
	}
}

func TestIssue276SpliceActionVisibility(t *testing.T) {
	original := &production{num: 7}
	alias := &production{num: 8, transparent: true, source: original}
	for _, occurrence := range []*production{original, alias} {
		a := elAction(iterEl{n: &dn{kind: dClose, prod: occurrence}, leaf: true})
		if a.prod != original || a.visible() == occurrence.transparent || !a.same(action{prod: original}) {
			t.Fatalf("action loses occurrence visibility or canonical identity: %+v", a)
		}
	}
	ranking := (&ranker{}).compare(closeNode(alias, 0, 0, nil, nil), closeNode(original, 0, 0, nil, nil))
	if ranking.kind != cAPrefix || ranking.hasWhole {
		t.Fatalf("canonical equality includes visibility: %+v", ranking)
	}
}

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
