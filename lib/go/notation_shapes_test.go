package gencmu

import (
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
)

// A bootstrap of another notation gives the reader a tree of another shape
// (engine §9). Every library reads through a wrapper, and needs the parts
// of each rule that it knows. tests/notation-shapes.json holds the outcome
// that every library gives.
func TestNotationShapes(t *testing.T) {
	raw, err := os.ReadFile("../../tests/notation-shapes.json")
	if err != nil {
		t.Fatal(err)
	}
	var shapes struct {
		Document   string         `json:"document"`
		Inputs     []string       `json:"inputs"`
		Control    any            `json:"control"`
		Loads      map[string]any `json:"loads"`
		ExtraParts []struct {
			Description string   `json:"description"`
			Find        string   `json:"find"`
			Replace     string   `json:"replace"`
			Document    string   `json:"document"`
			Inputs      []string `json:"inputs"`
			Expect      any      `json:"expect"`
			// Where is the place of an expected load error in its
			// document, when the item gives it (tests/README.md).
			Where *struct {
				Document string `json:"document"`
				Line     int    `json:"line"`
				Column   int    `json:"column"`
			} `json:"where"`
		} `json:"extraParts"`
	}
	if err := unmarshalJSON(raw, &shapes); err != nil {
		t.Fatal(err)
	}
	bootstrapRaw, err := os.ReadFile("../../grammars/notation/bootstrap.json")
	if err != nil {
		t.Fatal(err)
	}
	bootstrap := string(bootstrapRaw)
	syntaxAt := strings.Index(bootstrap, `"path":"notation/syntax.md"`)
	var b struct {
		Stages []struct {
			Documents []struct {
				Path string `json:"path"`
				Dom  struct {
					Rules []struct {
						Name string `json:"name"`
					} `json:"rules"`
				} `json:"dom"`
			} `json:"documents"`
		} `json:"stages"`
	}
	if err := unmarshalJSON(bootstrapRaw, &b); err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, s := range b.Stages {
		for _, d := range s.Documents {
			if d.Path != "notation/syntax.md" {
				continue
			}
			for _, r := range d.Dom.Rules {
				if r.Name != "text" {
					names = append(names, r.Name)
				}
			}
		}
	}
	// outcomeOf loads a document with a bootstrap, and parses each input:
	// its brackets, or the kind of its error. A load that fails gives the
	// kind of its error, which must be an *Error.
	outcomeAt := func(boot, document string, inputs []string, where *[3]any) any {
		d, err := LoadDialectSources(map[string]string{"p.md": "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n", "g.md": document, "notation/bootstrap.json": boot}, "p.md")
		if err != nil {
			var e *Error
			if !errors.As(err, &e) {
				t.Fatalf("an error that is not an *Error: %v", err)
			}
			if where != nil && *where != [3]any{e.Document, e.Line, e.Column} {
				t.Errorf("the load error stands at %s:%d:%d, not at %v: %v", e.Document, e.Line, e.Column, *where, e)
			}
			return e.Kind
		}
		if where != nil {
			t.Errorf("the document loaded, but the error should stand at %v", *where)
		}
		var results []any
		for _, input := range inputs {
			res, err := d.Parse(input, ParseOptions{})
			if err != nil {
				t.Fatalf("%q: %v", input, err)
			}
			if res.OK {
				results = append(results, Brackets(res, BracketOptions{}))
			} else {
				results = append(results, res.Error.Kind)
			}
		}
		return results
	}
	outcomeOf := func(boot, document string, inputs []string) any { return outcomeAt(boot, document, inputs, nil) }
	outcome := func(boot string) any { return outcomeOf(boot, shapes.Document, shapes.Inputs) }
	withSyntax := func(change func(string) string) string {
		return bootstrap[:syntaxAt] + change(bootstrap[syntaxAt:])
	}
	if got := outcome(bootstrap); !equalJSON(got, shapes.Control) {
		t.Errorf("the bundled bootstrap: %v, not %v", got, shapes.Control)
	}
	// A wrapper around each rule of the notation changes nothing.
	wrapped := withSyntax(func(syntax string) string {
		var wrappers strings.Builder
		for i, name := range names {
			syntax = strings.ReplaceAll(syntax, `{"ref":"`+name+`"}`, `{"ref":"`+name+`-wrapper"}`)
			fmt.Fprintf(&wrappers, `{"name":"%s-wrapper","op":"define","flags":[],"alternatives":[{"guards":[],"expr":{"ref":"%s"}}],"conditions":[],"at":[%d,1]},`, name, name, 100000+i)
		}
		return strings.Replace(syntax, `"rules":[`, `"rules":[`+wrappers.String(), 1)
	})
	if got := outcome(wrapped); !equalJSON(got, shapes.Control) {
		t.Errorf("a wrapper around each rule: %v, not %v", got, shapes.Control)
	}
	// Each renamed rule gives the outcome of every library.
	known := map[string]bool{}
	for _, name := range names {
		known[name] = true
		renamed := withSyntax(func(syntax string) string {
			syntax = strings.ReplaceAll(syntax, `"name":"`+name+`","op"`, `"name":"`+name+`x","op"`)
			return strings.ReplaceAll(syntax, `{"ref":"`+name+`"}`, `{"ref":"`+name+`x"}`)
		})
		var want any = ErrorGrammar
		if loads, ok := shapes.Loads[name]; ok {
			want = loads
		}
		if got := outcome(renamed); !equalJSON(got, want) {
			t.Errorf("%s renamed: %v, not %v", name, got, want)
		}
	}
	for name := range shapes.Loads {
		if !known[name] {
			t.Errorf("%s is no rule of the notation", name)
		}
	}
	// A part that the reader does not read is ignored.
	for _, item := range shapes.ExtraParts {
		if len(findPlaces(bootstrap[syntaxAt:], item.Find)) != 1 {
			t.Fatalf("%s: the text to replace does not stand once", item.Description)
		}
		changed := withSyntax(func(syntax string) string {
			replaced, err := substitute(syntax, item.Find, item.Replace)
			if err != nil {
				t.Fatalf("%s: %v", item.Description, err)
			}
			return replaced
		})
		var where *[3]any
		if w := item.Where; w != nil {
			where = &[3]any{w.Document, w.Line, w.Column}
		}
		if got := outcomeAt(changed, item.Document, item.Inputs, where); !equalJSON(got, item.Expect) {
			t.Errorf("%s: %v, not %v", item.Description, got, item.Expect)
		}
	}
}

// Each notation stage runs the check of elision-only where its own
// directive declares it (engine §8). With greedy and elision-only on the
// lexical stage, the check finds the ambiguity that greedy settled in
// `++`, which is also two `+`, and the document does not load.
func TestNotationStageRunsTheCheck(t *testing.T) {
	raw, err := os.ReadFile("../../grammars/notation/bootstrap.json")
	if err != nil {
		t.Fatal(err)
	}
	bootstrap := string(raw)
	directive := `"name":"ambiguity-resolution","args":["greedy"]`
	lexical := strings.Index(bootstrap, `"path":"notation/lexical.md"`)
	syntax := strings.Index(bootstrap, `"path":"notation/syntax.md"`)
	at := strings.Index(bootstrap, directive)
	if lexical < 0 || !(lexical < at && at < syntax) {
		t.Fatalf("the first directive is not the lexical stage's: %d %d %d", lexical, at, syntax)
	}
	elision := strings.Replace(bootstrap, directive, `"name":"ambiguity-resolution","args":["greedy","elision-only"]`, 1)
	sources := func(boot string) map[string]string {
		return map[string]string{"p.md": "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n",
			"g.md": "```jbogenbau\n%ambiguity-resolution greedy\n%rule text A [++B]\n```\n", "notation/bootstrap.json": boot}
	}
	// The bundled bootstrap loads the same documents.
	if _, err := LoadDialectSources(sources(bootstrap), "p.md"); err != nil {
		t.Fatal(err)
	}
	_, err = LoadDialectSources(sources(elision), "p.md")
	e, ok := err.(*Error)
	if !ok || e.Kind != ErrorGrammar || e.Line != 0 || !strings.Contains(e.Message, "lexical stage of the notation") {
		t.Fatalf("%v", err)
	}
}
