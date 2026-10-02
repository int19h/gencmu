package gencmu

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"
)

// The shared cases of tests/README.md.

type engineCase struct {
	Description string
	Grammar     *string
	Documents   map[string]string
	Pipeline    string
	Tokens      []caseToken
	Input       *string
	Options     caseOptions
	Expect      caseExpect
	// Parses, when present, parses the input several times with the one
	// loaded dialect, each with its own options and expectation, in place
	// of the case's (tests/README.md).
	Parses []struct {
		Options caseOptions
		Expect  caseExpect
	}
}

// caseToken is a token that a case supplies (tests/README.md). Its before
// and after, which a caller cannot supply, go to the library as they
// stand, so that it refuses them or drops empty ones.
type caseToken struct {
	Text     string
	Tags     []string
	Phonemes *string
	Before   []caseToken
	After    []caseToken
}

type caseOptions struct {
	Features        []string
	WithoutFeatures []string
	ElisionOnly     *bool
	AutoFeatures    *bool
	Until           string
}

type caseExpect struct {
	Result   json.RawMessage
	Brackets *string
	Warnings json.RawMessage
	Features json.RawMessage
	Error    string
	// Where is where a load error stands (tests/README.md).
	Where *struct {
		Document     string
		Line, Column int
	}
}

// match matches a value against a pattern (tests/README.md).
func match(pattern, value any, path string) error {
	switch p := pattern.(type) {
	case map[string]any:
		v, ok := value.(map[string]any)
		if !ok {
			return fmt.Errorf("%s: expected an object, got %v", path, value)
		}
		keys := make([]string, 0, len(p))
		for k := range p {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			vv, ok := v[k]
			if !ok {
				return fmt.Errorf("%s.%s: missing", path, k)
			}
			if err := match(p[k], vv, path+"."+k); err != nil {
				return err
			}
		}
		return nil
	case []any:
		v, ok := value.([]any)
		if !ok || len(v) != len(p) {
			return fmt.Errorf("%s: expected an array of %d, got %v", path, len(p), value)
		}
		for i := range p {
			if err := match(p[i], v[i], fmt.Sprintf("%s[%d]", path, i)); err != nil {
				return err
			}
		}
		return nil
	}
	if !reflect.DeepEqual(pattern, value) {
		return fmt.Errorf("%s: expected %v, got %v", path, pattern, value)
	}
	return nil
}

func loadCase(t testing.TB, file string) *engineCase {
	data, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	c := &engineCase{}
	if err := json.Unmarshal(data, c); err != nil {
		t.Fatalf("%s: %v", file, err)
	}
	return c
}

func caseDialect(c *engineCase, noCache bool) (*Dialect, error) {
	if c.Grammar != nil {
		g := *c.Grammar
		if !strings.Contains(g, "%ambiguity-resolution") {
			g = "%ambiguity-resolution greedy\n" + g
		}
		// The grammar is main.md, whose fence is line 1 (tests/README.md).
		return loadSources(map[string]string{
			"pipeline.md": "```jbogenbau\n%stage main\n%include \"main.md\"\n```\n",
			"main.md":     "```jbogenbau\n" + g + "\n```\n",
		}, "pipeline.md", noCache)
	}
	return loadSources(c.Documents, c.Pipeline, noCache)
}

// runCase parses a case's input with a loaded dialect, under the options
// of the case or of one item of its parses.
func runCase(d *Dialect, c *engineCase, o *caseOptions) (*ParseResult, error) {
	if err := loadBundled(); err != nil {
		return nil, err
	}
	opts := ParseOptions{Features: o.Features, WithoutFeatures: o.WithoutFeatures, ElisionOnly: o.ElisionOnly, Until: o.Until, NoAutoFeatures: true}
	if o.AutoFeatures != nil && *o.AutoFeatures {
		opts.NoAutoFeatures = false
	}
	if c.Input != nil {
		return d.Parse(*c.Input, opts)
	}
	toks, text, err := caseTokens(c.Tokens)
	if err != nil {
		return nil, err
	}
	return d.ParseTokens(text, toks, opts)
}

// caseTokens makes a case's tokens and the text they index
// (tests/README.md). An empty list of attachments stays an empty list, not
// nil, as a caller could give it.
func caseTokens(specs []caseToken) ([]Token, string, error) {
	var texts []string
	toks := make([]Token, 0, len(specs))
	pos := 0
	for i, tk := range specs {
		// Each tag in its canonical spelling, as the output writes it
		// (tests/README.md).
		for _, tag := range tk.Tags {
			if !isTag(tag, bundled.uni) {
				return nil, "", fmt.Errorf("a case token's tag %s is not a tag", tag)
			}
		}
		n := len([]rune(tk.Text))
		tok := Token{Text: tk.Text, Tags: tk.Tags, Span: [2]int{i, i + 1}, Source: [2]int{pos, pos + n}}
		if tk.Phonemes != nil {
			tok.Phonemes = *tk.Phonemes
		}
		for _, side := range []struct {
			specs []caseToken
			into  *[]Token
		}{{tk.Before, &tok.Before}, {tk.After, &tok.After}} {
			if side.specs == nil {
				continue
			}
			inner, _, err := caseTokens(side.specs)
			if err != nil {
				return nil, "", err
			}
			*side.into = attached(inner)
		}
		toks = append(toks, tok)
		texts = append(texts, tk.Text)
		pos += n + 1
	}
	return toks, strings.Join(texts, " "), nil
}

func checkCase(c *engineCase, noCache bool) error {
	d, err := caseDialect(c, noCache)
	if c.Parses != nil {
		// One loaded dialect parses the input with each item's options in
		// order (tests/README.md).
		if err != nil {
			return fmt.Errorf("unexpected load error: %v", err)
		}
		for i := range c.Parses {
			if err := checkParse(d, c, &c.Parses[i].Options, &c.Parses[i].Expect); err != nil {
				return fmt.Errorf("parse %d: %v", i, err)
			}
		}
		return nil
	}
	if err != nil {
		return checkLoadError(&c.Expect, err)
	}
	return checkParse(d, c, &c.Options, &c.Expect)
}

// checkLoadError matches the error of a dialect that did not load against
// an expectation. The error is the whole outcome, so an expectation of
// anything that only a loaded dialect gives fails (tests/README.md).
func checkLoadError(expect *caseExpect, err error) error {
	e, ok := err.(*Error)
	if !ok {
		return fmt.Errorf("load: %v", err)
	}
	if expect.Error != e.Kind {
		return fmt.Errorf("unexpected load error: %v", err)
	}
	if expect.Result != nil || expect.Brackets != nil || expect.Warnings != nil || expect.Features != nil {
		return fmt.Errorf("the dialect did not load: %v", err)
	}
	// Where the error stands, in a document of the case, given only for a
	// grammar error.
	if w := expect.Where; w != nil && e.Kind != ErrorGrammar {
		return fmt.Errorf("expect.where is only for a grammar error: %v", err)
	} else if w != nil && (e.Document != w.Document || e.Line != w.Line || e.Column != w.Column) {
		return fmt.Errorf("the load error stands at %s:%d:%d, not at %s:%d:%d: %v", e.Document, e.Line, e.Column, w.Document, w.Line, w.Column, err)
	}
	return nil
}

// checkParse parses a case's input with a loaded dialect and matches the
// result against an expectation.
func checkParse(d *Dialect, c *engineCase, options *caseOptions, expect *caseExpect) error {
	// The dialect's features, compared whole.
	if expect.Features != nil {
		var want any
		json.Unmarshal(expect.Features, &want)
		have := []any{}
		for _, f := range d.Features() {
			have = append(have, map[string]any{"name": f.Name, "kind": f.Kind, "default": f.Default})
		}
		if !reflect.DeepEqual(have, want) {
			return fmt.Errorf("features: expected %s, got %+v", expect.Features, d.Features())
		}
	}
	res, err := runCase(d, c, options)
	if err != nil {
		// A mistake of the caller is an error, and there is no result
		// (engine §13).
		if e, ok := err.(*Error); ok && e.Kind == ErrorUsage && expect.Error == ErrorUsage {
			return nil
		}
		return err
	}
	data, _ := MarshalResult(res)
	var got any
	if err := json.Unmarshal(data, &got); err != nil {
		return fmt.Errorf("the canonical JSON does not parse: %v\n%s", err, data)
	}
	return checkResult(res, got, data, expect)
}

// resultProblems lists what a canonical result breaks of the invariants
// that the runners check on every result, whatever the case expects
// (tests/README.md): no stage has a member tied, and a stage whose verdict
// is tie has no output, is the last stage, and has the result's ambiguous
// error with the reason tie, its name and two readings. An ambiguous error
// has no token or source.
func resultProblems(got any) []string {
	var problems []string
	result, _ := got.(map[string]any)
	stages, _ := result["stages"].([]any)
	// An ambiguous error has no position (docs/output.md).
	if e, _ := result["error"].(map[string]any); e != nil && e["kind"] == ErrorAmbiguous {
		for _, member := range []string{"token", "source"} {
			if _, ok := e[member]; ok {
				problems = append(problems, "the ambiguous error has a member "+member)
			}
		}
	}
	for i, s := range stages {
		stage, _ := s.(map[string]any)
		name, _ := stage["name"].(string)
		if _, ok := stage["tied"]; ok {
			problems = append(problems, "stage "+name+" has a tied tree")
		}
		if stage["verdict"] != VerdictTie {
			continue
		}
		if _, ok := stage["output"]; ok {
			problems = append(problems, "the tied stage "+name+" has output")
		}
		if i != len(stages)-1 {
			problems = append(problems, "a stage runs after the tied stage "+name)
		}
		e, _ := result["error"].(map[string]any)
		readings, _ := e["readings"].([]any)
		tree, hasTree := result["tree"]
		if result["ok"] != false || !hasTree || tree != nil || e == nil || e["kind"] != ErrorAmbiguous || e["reason"] != ReasonTie || e["stage"] != name || len(readings) != 2 {
			problems = append(problems, "the tied stage "+name+" lacks its error of kind ambiguous, reason tie and two readings")
		}
	}
	return problems
}

// checkResult matches a result, and its canonical JSON as got and as data,
// against an expectation. The invariants of the result come first.
func checkResult(res *ParseResult, got any, data []byte, expect *caseExpect) error {
	if problems := resultProblems(got); len(problems) > 0 {
		return fmt.Errorf("the result breaks an invariant: %s\n%s", strings.Join(problems, "; "), data)
	}
	// The warnings, compared whole, so [] says that there are none; the
	// canonical JSON leaves them out then.
	if expect.Warnings != nil {
		var want any
		json.Unmarshal(expect.Warnings, &want)
		have, ok := got.(map[string]any)["warnings"]
		if !ok {
			have = []any{}
		}
		if !reflect.DeepEqual(have, want) {
			return fmt.Errorf("warnings: expected %s\n%s", expect.Warnings, data)
		}
	}
	if expect.Result != nil {
		var pattern any
		json.Unmarshal(expect.Result, &pattern)
		if err := match(pattern, got, "result"); err != nil {
			return fmt.Errorf("%v\n%s", err, data)
		}
	}
	// An error the case expects is a load error or the result's error, as
	// where the grammar's error is found while lowering it (engine §3.3).
	if expect.Brackets != nil {
		if b := Brackets(res, BracketOptions{}); b != *expect.Brackets {
			return fmt.Errorf("brackets: expected %q, got %q", *expect.Brackets, b)
		}
	}
	if expect.Error != "" {
		if res.Error == nil || res.Error.Kind != expect.Error {
			return fmt.Errorf("expected error %s\n%s", expect.Error, data)
		}
	} else if res.Error != nil {
		return fmt.Errorf("unexpected error\n%s", data)
	}
	return nil
}

// The runner fails a case whose dialect does not load, when the case
// expects another kind of error, or more than the error.
func TestEngineRunnerLoadError(t *testing.T) {
	grammar := "%rule text A\n%rule text A"
	brackets := ""
	// "\xed\xa0\x80" encodes the surrogate U+D800, so this document held in
	// memory is a usage error at load (engine §1).
	unusable := "%rule text 'a\xed\xa0\x80'"
	where := &struct {
		Document     string
		Line, Column int
	}{Document: "main.md"}
	for _, tc := range []struct {
		name    string
		grammar *string
		expect  caseExpect
		pass    bool
	}{
		{"grammar", &grammar, caseExpect{Error: ErrorGrammar}, true},
		{"usage", &grammar, caseExpect{Error: ErrorUsage}, false},
		{"none", &grammar, caseExpect{}, false},
		{"result", &grammar, caseExpect{Error: ErrorGrammar, Result: json.RawMessage("{}")}, false},
		{"brackets", &grammar, caseExpect{Error: ErrorGrammar, Brackets: &brackets}, false},
		{"warnings", &grammar, caseExpect{Error: ErrorGrammar, Warnings: json.RawMessage("[]")}, false},
		{"features", &grammar, caseExpect{Error: ErrorGrammar, Features: json.RawMessage("[]")}, false},
		{"usage at load", &unusable, caseExpect{Error: ErrorUsage}, true},
		{"usage at load, grammar expected", &unusable, caseExpect{Error: ErrorGrammar}, false},
		{"usage at load, result expected", &unusable, caseExpect{Error: ErrorUsage, Result: json.RawMessage("{}")}, false},
		{"usage at load, where given", &unusable, caseExpect{Error: ErrorUsage, Where: where}, false},
	} {
		c := &engineCase{Grammar: tc.grammar, Expect: tc.expect}
		if err := checkCase(c, true); (err == nil) != tc.pass {
			t.Errorf("%s: the runner gave %v", tc.name, err)
		}
	}
}

// tieMutants are the changes to a tied result that the runners must refuse
// (tests/README.md). Each changes the canonical result got, whose last stage
// is the tied stage tied.
var tieMutants = map[string]func(got, tied map[string]any){
	"an error with a token":  func(got, tied map[string]any) { got["error"].(map[string]any)["token"] = 0.0 },
	"an error with a source": func(got, tied map[string]any) { got["error"].(map[string]any)["source"] = []any{0.0, 0.0} },
	"a tree":                 func(got, tied map[string]any) { got["tree"] = got["error"].(map[string]any)["readings"].([]any)[0] },
	"one reading": func(got, tied map[string]any) {
		e := got["error"].(map[string]any)
		e["readings"] = e["readings"].([]any)[:1]
	},
	"ok":                        func(got, tied map[string]any) { got["ok"] = true },
	"an error of another kind":  func(got, tied map[string]any) { got["error"].(map[string]any)["kind"] = ErrorRejected },
	"an error of another stage": func(got, tied map[string]any) { got["error"].(map[string]any)["stage"] = "other" },
	"another reason":            func(got, tied map[string]any) { got["error"].(map[string]any)["reason"] = ReasonElisionOnly },
	"a tied stage with output":  func(got, tied map[string]any) { tied["output"] = []any{} },
	"a stage with tied": func(got, tied map[string]any) {
		tied["tied"] = got["error"].(map[string]any)["readings"].([]any)[1]
	},
	"a stage after the tie": func(got, tied map[string]any) {
		got["stages"] = append(got["stages"].([]any), map[string]any{"name": "later", "verdict": VerdictUnique})
	},
	"no error":                func(got, tied map[string]any) { got["error"] = nil },
	"an error without reason": func(got, tied map[string]any) { delete(got["error"].(map[string]any), "reason") },
}

// The runner fails a case that does not finish in time.
func TestEngineRunnerTimeout(t *testing.T) {
	grammar := doublingGrammar("late-elision", 25, false, "%rule text ε | rN")
	c := &engineCase{Grammar: &grammar, Tokens: []caseToken{}, Expect: caseExpect{}}
	if err := checkCaseWithin(c, time.Nanosecond); err == nil || !strings.Contains(err.Error(), "did not finish") {
		t.Fatalf("the runner gave %v", err)
	}
}

// The runner refuses a result that breaks an invariant, whatever the case
// expects (tests/README.md).
func TestEngineRunnerInvariants(t *testing.T) {
	grammar := "%rule text x | y\n%rule x A\n%rule y A"
	c := &engineCase{Grammar: &grammar, Tokens: []caseToken{{Text: "a", Tags: []string{"A"}}}, Expect: caseExpect{Error: ErrorAmbiguous}}
	if err := checkCase(c, true); err != nil {
		t.Fatal(err)
	}
	d, err := caseDialect(c, true)
	if err != nil {
		t.Fatal(err)
	}
	res, err := runCase(d, c, &c.Options)
	if err != nil {
		t.Fatal(err)
	}
	data, _ := MarshalResult(res)
	fresh := func() (map[string]any, map[string]any) {
		var got map[string]any
		json.Unmarshal(data, &got)
		stages := got["stages"].([]any)
		return got, stages[len(stages)-1].(map[string]any)
	}
	for name, mutate := range tieMutants {
		got, tied := fresh()
		mutate(got, tied)
		if len(resultProblems(got)) == 0 {
			t.Errorf("%s: no problem found", name)
		}
		if checkResult(res, got, data, &c.Expect) == nil {
			t.Errorf("%s: the runner accepts it", name)
		}
	}
}

// caseTimeout is how long one engine case can run before it fails, so that
// a hang is reported as a failure of its case. GENCMU_CASE_TIMEOUT sets it,
// as a Go duration.
const caseTimeout = 30 * time.Second

// checkCaseWithin checks a case, and fails it when it takes longer than
// the timeout. A case that hangs keeps its goroutine, but the run goes on.
func checkCaseWithin(c *engineCase, timeout time.Duration) error {
	done := make(chan error, 1)
	go func() { done <- checkCase(c, false) }()
	select {
	case err := <-done:
		return err
	case <-time.After(timeout):
		return fmt.Errorf("the case did not finish within %v", timeout)
	}
}

func TestEngineCases(t *testing.T) {
	timeout := caseTimeout
	if s := os.Getenv("GENCMU_CASE_TIMEOUT"); s != "" {
		d, err := time.ParseDuration(s)
		if err != nil {
			t.Fatalf("GENCMU_CASE_TIMEOUT: %v", err)
		}
		timeout = d
	}
	files, _ := filepath.Glob("../../tests/engine/*.json")
	if len(files) == 0 {
		t.Fatal("no engine cases in ../../tests/engine")
	}
	for _, f := range files {
		c := loadCase(t, f)
		t.Run(strings.TrimSuffix(filepath.Base(f), ".json"), func(t *testing.T) {
			if err := checkCaseWithin(c, timeout); err != nil {
				t.Errorf("%s\n%v", c.Description, err)
			}
		})
	}
}
