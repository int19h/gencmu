package gencmu

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSharedJSONKeys(t *testing.T) {
	raw, err := os.ReadFile("../../tests/json-keys.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures struct {
		Values []struct {
			Description string `json:"description"`
			JSON        string `json:"json"`
			Expect      any    `json:"expect"`
		} `json:"values"`
		Bootstrap []struct {
			Description string `json:"description"`
			Find        string `json:"find"`
			Replace     string `json:"replace"`
			Loads       bool   `json:"loads"`
		} `json:"bootstrap"`
		Compiled []struct {
			Description string   `json:"description"`
			Find        string   `json:"find"`
			Replace     string   `json:"replace"`
			Cached      bool     `json:"cached"`
			Document    string   `json:"document"`
			Tags        []string `json:"tags"`
		} `json:"compiled"`
		Grammar string `json:"grammar"`
		Cache   string `json:"cache"`
	}
	if err := unmarshalJSON(raw, &fixtures); err != nil {
		t.Fatal(err)
	}
	bundled, err := os.ReadFile("../../grammars/notation/bootstrap.json")
	if err != nil {
		t.Fatal(err)
	}
	mutate := func(text, find, replacement string) string {
		t.Helper()
		if !strings.Contains(text, find) {
			t.Fatalf("missing mutation: %s", find)
		}
		return strings.Replace(text, find, replacement, 1)
	}
	sources := func() map[string]string {
		return map[string]string{"p.md": "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n", "g.md": fixtures.Grammar}
	}
	for _, item := range fixtures.Values {
		t.Run(item.Description, func(t *testing.T) {
			got, err := decodeJSON([]byte(item.JSON))
			if err != nil || !equalJSON(got, item.Expect) {
				t.Fatalf("got %v, %v", got, err)
			}
		})
	}
	for _, item := range fixtures.Bootstrap {
		t.Run(item.Description, func(t *testing.T) {
			s := sources()
			s["notation/bootstrap.json"] = mutate(string(bundled), item.Find, item.Replace)
			d, err := LoadDialectSources(s, "p.md")
			if item.Loads {
				if err != nil {
					t.Fatal(err)
				}
				r, err := d.Parse("a", ParseOptions{})
				if err != nil || !r.OK {
					t.Fatalf("parse: %#v, %v", r, err)
				}
			} else {
				var e *Error
				if !errors.As(err, &e) {
					t.Fatalf("expected grammar error, got %v", err)
				}
				if e.Kind != ErrorGrammar || e.Document != "notation/bootstrap.json" || e.Stage != "" || e.Line != 0 || e.Column != 0 || !strings.HasPrefix(e.Message, "notation/bootstrap.json:") {
					t.Fatalf("metadata: %#v", e)
				}
			}
		})
	}
	for _, item := range fixtures.Compiled {
		t.Run(item.Description, func(t *testing.T) {
			s := sources()
			if item.Document != "" {
				delete(s, "g.md")
				s[item.Document] = fixtures.Grammar
				s["p.md"] = fmt.Sprintf("```jbogenbau\n%%stage main\n%%include %q\n```\n", item.Document)
			}
			s["compiled.json"] = strings.ReplaceAll(strings.ReplaceAll(mutate(fixtures.Cache, item.Find, item.Replace), "@bootstrap@", fnv1a64(string(bundled))), "@source@", fnv1a64(fixtures.Grammar))
			d, err := LoadDialectSources(s, "p.md")
			if err != nil {
				t.Fatal(err)
			}
			a, err := d.Parse("a", ParseOptions{})
			if err != nil {
				t.Fatal(err)
			}
			b, err := d.Parse("b", ParseOptions{})
			if err != nil {
				t.Fatal(err)
			}
			if a.OK == item.Cached || b.OK != item.Cached {
				t.Fatalf("cached=%v: a=%v b=%v", item.Cached, a.OK, b.OK)
			}
			if item.Tags != nil && !equalJSON(b.Tree.Tags, item.Tags) {
				t.Fatalf("tags: got %v, want %v", b.Tree.Tags, item.Tags)
			}
		})
	}
}

func TestJSONStructKeysAreExact(t *testing.T) {
	var out struct {
		Name  string `json:"name"`
		Upper string `json:"K"`
	}
	if err := unmarshalJSON([]byte(`{"name":"first","Name":null,"NAME":"wrong","name":"last","K":"exact","K":"wrong"}`), &out); err != nil {
		t.Fatal(err)
	}
	if out.Name != "last" || out.Upper != "exact" {
		t.Fatalf("%#v", out)
	}
	// All external runner structs require their explicit JSON names.
	var engine engineCase
	if err := unmarshalJSON([]byte(`{"grammar":"A","Grammar":"B","options":{"autoFeatures":false,"AutoFeatures":true}}`), &engine); err != nil {
		t.Fatal(err)
	}
	if engine.Grammar == nil || *engine.Grammar != "A" || engine.Options.AutoFeatures == nil || *engine.Options.AutoFeatures {
		t.Fatalf("%#v", engine)
	}
	var corpus corpusCase
	if err := unmarshalJSON([]byte(`{"id":"a","ID":"b","text":"a","Text":"b"}`), &corpus); err != nil {
		t.Fatal(err)
	}
	if corpus.ID != "a" || corpus.Text != "a" {
		t.Fatalf("%#v", corpus)
	}
}

// Ignored and raw values require syntax validation, not value conversion.
func TestJSONRawAndIgnored(t *testing.T) {
	var docs [][]byte
	for _, pattern := range []string{"../../tests/*.json", "../../tests/*/*.json", "../../tests/corpus/*.jsonl"} {
		files, _ := filepath.Glob(pattern)
		for _, path := range files {
			data, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if strings.HasSuffix(path, ".jsonl") {
				for _, line := range bytes.Split(data, []byte("\n")) {
					if len(bytes.TrimSpace(line)) != 0 {
						docs = append(docs, line)
					}
				}
			} else {
				docs = append(docs, data)
			}
		}
	}
	for _, text := range []string{`null`, `true`, `false`, `"\ud800"`, `"\\\""`, `"\u0041"`, `"\x41"`, `"\u0xxx"`, `"\u000"`, `"a`, `1e400`, strings.Repeat("9", 400), `[1,]`, `{"a":1,}`, `{"a" 1}`, `[1 2]`, `01`, `-`, `1.`, `.5`, `1e`, `tru`, `nul`, `[`, `]`, `{"a":}`, `{,}`, `[1] [2]`, ``, ` `, `{"a":[}`, `[1`, `{"a":true`, `["a"`} {
		docs = append(docs, []byte(text))
	}
	for _, raw := range docs {
		data := append([]byte(`{"ignored":`), raw...)
		data = append(data, []byte(`,"raw":`)...)
		data = append(data, raw...)
		data = append(data, '}')
		var got struct {
			Raw json.RawMessage `json:"raw"`
		}
		err := unmarshalJSON(data, &got)
		if (err == nil) != json.Valid(data) {
			t.Fatalf("%.200s: %v", data, err)
		}
		if err == nil && !bytes.Equal(got.Raw, bytes.TrimSpace(raw)) {
			t.Fatalf("raw text differs: %.200s", raw)
		}
	}
	// The number stays exact until the known integer field requests it.
	var out struct {
		N int64 `json:"n"`
	}
	if err := unmarshalJSON([]byte(`{"n":9007199254740993}`), &out); err != nil || out.N != 9007199254740993 {
		t.Fatalf("exact integer: %#v, %v", out, err)
	}
	if err := unmarshalJSON([]byte(`{"n":`+strings.Repeat("9", 400)+`,"n":5}`), &out); err != nil || out.N != 5 {
		t.Fatalf("replaced integer: %#v, %v", out, err)
	}
	if err := unmarshalJSON([]byte(`{"n":`+strings.Repeat("9", 400)+`}`), &out); err == nil {
		t.Fatal("known integer accepted overflow")
	}
	// Raw DOM width does not increase the allocation count.
	allocations := func(width int) float64 {
		data := []byte(`{"raw":[` + strings.Repeat(`{"ignored":123},`, width) + `null]}`)
		return testing.AllocsPerRun(5, func() {
			var out struct {
				Raw json.RawMessage `json:"raw"`
			}
			if err := unmarshalJSON(data, &out); err != nil {
				t.Fatal(err)
			}
		})
	}
	small, large := allocations(1), allocations(10000)
	if large > small+2 {
		t.Fatalf("raw DOM allocations grow with width: %v -> %v", small, large)
	}
	// Raw and ignored values keep the existing unbounded depth policy.
	deep := strings.Repeat(`[`, 20000) + `0` + strings.Repeat(`]`, 20000)
	var raw struct {
		Raw json.RawMessage `json:"raw"`
	}
	if err := unmarshalJSON([]byte(`{"ignored":`+deep+`,"raw":`+deep+`}`), &raw); err != nil || string(raw.Raw) != deep {
		t.Fatalf("deep raw: %v", err)
	}
}

func BenchmarkReadCompiledJSON(b *testing.B) {
	cache, err := os.ReadFile("../../grammars/compiled.json")
	if err != nil {
		b.Fatal(err)
	}
	bootstrap, err := os.ReadFile("../../grammars/notation/bootstrap.json")
	if err != nil {
		b.Fatal(err)
	}
	text, hash := string(cache), fnv1a64(string(bootstrap))
	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		if len(readCompiled(text, hash)) == 0 {
			b.Fatal("cache miss")
		}
	}
}
