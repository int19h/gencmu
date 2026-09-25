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
	Tokens      []struct {
		Text     string
		Tags     []string
		Phonemes *string
	}
	Input   *string
	Options struct {
		Features        []string
		WithoutFeatures []string
		ElisionOnly     *bool
		AutoFeatures    *bool
		Until           string
	}
	Expect struct {
		Result   json.RawMessage
		Brackets *string
		Warnings json.RawMessage
		Features json.RawMessage
		Error    string
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
		return loadSources(map[string]string{
			"p.md": "## main <?stage main?>\n\n- [g](g.md) <?grammar?>\n",
			"g.md": "```jbogenbau\n" + g + "\n```\n",
		}, "p.md", noCache)
	}
	return loadSources(c.Documents, c.Pipeline, noCache)
}

func runCase(d *Dialect, c *engineCase) (*ParseResult, error) {
	opts := ParseOptions{Features: c.Options.Features, WithoutFeatures: c.Options.WithoutFeatures, ElisionOnly: c.Options.ElisionOnly, Until: c.Options.Until, NoAutoFeatures: true}
	if c.Options.AutoFeatures != nil && *c.Options.AutoFeatures {
		opts.NoAutoFeatures = false
	}
	if c.Input != nil {
		return d.Parse(*c.Input, opts)
	}
	var texts []string
	toks := make([]Token, 0, len(c.Tokens))
	pos := 0
	for i, tk := range c.Tokens {
		tags := map[string]bool{}
		for _, tag := range tk.Tags {
			if strings.HasPrefix(tag, "?") {
				tags[tag[1:]] = false
			} else {
				tags[tag] = true
			}
		}
		n := len([]rune(tk.Text))
		tok := Token{Text: tk.Text, Tags: tags, Span: [2]int{i, i + 1}, Source: [2]int{pos, pos + n}}
		if tk.Phonemes != nil {
			tok.Phonemes = *tk.Phonemes
		}
		toks = append(toks, tok)
		texts = append(texts, tk.Text)
		pos += n + 1
	}
	return d.ParseTokens(strings.Join(texts, " "), toks, opts)
}

func checkCase(c *engineCase, noCache bool) error {
	d, err := caseDialect(c, noCache)
	if err != nil {
		e, ok := err.(*Error)
		if !ok {
			return fmt.Errorf("load: %v", err)
		}
		if c.Expect.Error != e.Kind || c.Expect.Result != nil {
			return fmt.Errorf("unexpected load error: %v", err)
		}
		return nil
	}
	// The dialect's features, compared whole.
	if c.Expect.Features != nil {
		var want any
		json.Unmarshal(c.Expect.Features, &want)
		have := []any{}
		for _, f := range d.Features() {
			have = append(have, map[string]any{"name": f.Name, "kind": f.Kind, "default": f.Default})
		}
		if !reflect.DeepEqual(have, want) {
			return fmt.Errorf("features: expected %s, got %+v", c.Expect.Features, d.Features())
		}
	}
	res, err := runCase(d, c)
	if err != nil {
		// A mistake of the caller is an error, and there is no result
		// (engine §13).
		if e, ok := err.(*Error); ok && e.Kind == ErrorUsage && c.Expect.Error == ErrorUsage {
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
	if c.Expect.Warnings != nil {
		var want any
		json.Unmarshal(c.Expect.Warnings, &want)
		have, ok := got.(map[string]any)["warnings"]
		if !ok {
			have = []any{}
		}
		if !reflect.DeepEqual(have, want) {
			return fmt.Errorf("warnings: expected %s\n%s", c.Expect.Warnings, data)
		}
	}
	if c.Expect.Result != nil {
		var pattern any
		json.Unmarshal(c.Expect.Result, &pattern)
		if err := match(pattern, got, "result"); err != nil {
			return fmt.Errorf("%v\n%s", err, data)
		}
	}
	// An error the case expects is a load error or the result's error, as
	// where the grammar's error is found while lowering it (engine §3.3).
	if c.Expect.Brackets != nil {
		if b := Brackets(res, BracketOptions{}); b != *c.Expect.Brackets {
			return fmt.Errorf("brackets: expected %q, got %q", *c.Expect.Brackets, b)
		}
	}
	if c.Expect.Error != "" {
		if res.Error == nil || res.Error.Kind != c.Expect.Error {
			return fmt.Errorf("expected error %s\n%s", c.Expect.Error, data)
		}
	} else if res.Error != nil {
		return fmt.Errorf("unexpected error\n%s", data)
	}
	return nil
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
