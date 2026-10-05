package gencmu

import (
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
		Kind     string `json:"kind"`
		Document string `json:"document"`
		Cases    []struct {
			Description string  `json:"description"`
			Find        string  `json:"find"`
			Replace     string  `json:"replace"`
			Context     string  `json:"context"`
			Message     string  `json:"message"`
			Stage       *string `json:"stage"`
			Line        *int    `json:"line"`
			Column      *int    `json:"column"`
			Bootstrap   *string `json:"bootstrap"`
		} `json:"cases"`
	}
	if err := unmarshalJSON(raw, &fixtures); err != nil {
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
			if !strings.HasPrefix(e.Message, fixtures.Document+":") || e.Error() != e.Message {
				t.Fatalf("the diagnostic does not name the bootstrap: %s", e)
			}
			if item.Context != "" && !strings.Contains(e.Message, item.Context) {
				t.Fatalf("the diagnostic lost its source: %s", e)
			}
			if item.Message != "" && !strings.Contains(e.Message, item.Message) {
				t.Fatalf("expected %q, got %s", item.Message, e)
			}
			line, column, stage := 0, 0, ""
			if item.Line != nil {
				line = *item.Line
			}
			if item.Column != nil {
				column = *item.Column
			}
			if item.Stage != nil {
				stage = *item.Stage
			}
			if e.Line != line || e.Column != column || e.Stage != stage {
				t.Fatalf("expected stage %q at %d:%d, got %#v", stage, line, column, e)
			}

		})
	}
}
