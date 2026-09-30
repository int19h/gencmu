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
	// Where the error stands, in a document of the case.
	if w := expect.Where; w != nil && (e.Document != w.Document || e.Line != w.Line || e.Column != w.Column) {
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
	for _, tc := range []struct {
		name   string
		expect caseExpect
		pass   bool
	}{
		{"grammar", caseExpect{Error: ErrorGrammar}, true},
		{"usage", caseExpect{Error: ErrorUsage}, false},
		{"none", caseExpect{}, false},
		{"result", caseExpect{Error: ErrorGrammar, Result: json.RawMessage("{}")}, false},
		{"brackets", caseExpect{Error: ErrorGrammar, Brackets: &brackets}, false},
		{"warnings", caseExpect{Error: ErrorGrammar, Warnings: json.RawMessage("[]")}, false},
		{"features", caseExpect{Error: ErrorGrammar, Features: json.RawMessage("[]")}, false},
	} {
		c := &engineCase{Grammar: &grammar, Expect: tc.expect}
		if err := checkCase(c, true); (err == nil) != tc.pass {
			t.Errorf("%s: the runner gave %v", tc.name, err)
		}
	}
}

func TestEngineCases(t *testing.T) {
	files, _ := filepath.Glob("../../tests/engine/*.json")
	if len(files) == 0 {
		t.Fatal("no engine cases in ../../tests/engine")
	}
	for _, f := range files {
		c := loadCase(t, f)
		t.Run(strings.TrimSuffix(filepath.Base(f), ".json"), func(t *testing.T) {
			if err := checkCase(c, false); err != nil {
				t.Errorf("%s\n%v", c.Description, err)
			}
		})
	}
}
