package gencmu

import (
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
)

// Every library runs the same bootstrap errors and requires their document metadata.
func TestBootstrapErrorMetadata(t *testing.T) {
	raw, err := os.ReadFile("../../tests/bootstrap-errors.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures struct {
		Kind, Document string
		Cases          []struct {
			Description, Find, Replace string
			Line, Column               int
			Bootstrap                  *string
		}
	}
	if err := json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatal(err)
	}
	bundled, err := os.ReadFile("../../grammars/notation/bootstrap.json")
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range fixtures.Cases {
		t.Run(item.Description, func(t *testing.T) {
			bootstrap := string(bundled)
			if item.Bootstrap != nil {
				bootstrap = *item.Bootstrap
			} else {
				if !strings.Contains(bootstrap, item.Find) {
					t.Fatal("the mutation is absent")
				}
				bootstrap = strings.Replace(bootstrap, item.Find, item.Replace, 1)
			}
			_, err := LoadDialectSources(map[string]string{
				"p.md":                    "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n",
				"g.md":                    "```jbogenbau\n%ambiguity-resolution greedy\n%rule text A\n```\n",
				"notation/bootstrap.json": bootstrap,
			}, "p.md")
			var e *Error
			if !errors.As(err, &e) {
				t.Fatalf("expected a library error, got %v", err)
			}
			if e.Kind != fixtures.Kind || e.Document != fixtures.Document {
				t.Fatalf("expected %s in %s, got %#v", fixtures.Kind, fixtures.Document, e)
			}
			if item.Line != 0 && (e.Line != item.Line || e.Column != item.Column) {
				t.Fatalf("expected %d:%d, got %d:%d", item.Line, item.Column, e.Line, e.Column)
			}
		})
	}
}
