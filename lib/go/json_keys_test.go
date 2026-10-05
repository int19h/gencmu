package gencmu

import (
	"errors"
	"os"
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
			Description string `json:"description"`
			Find        string `json:"find"`
			Replace     string `json:"replace"`
			Cached      bool   `json:"cached"`
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
