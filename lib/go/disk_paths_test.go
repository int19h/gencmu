package gencmu

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// A pipeline loaded from disk knows each document by its absolute path, so
// an error names the file the same way from any working directory, and in
// every library.
func TestDiskPathsFromAnotherWorkingDirectory(t *testing.T) {
	write := func(root string, files map[string]string) {
		for name, text := range files {
			file := filepath.Join(root, filepath.FromSlash(name))
			if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(file, []byte(text), 0o644); err != nil {
				t.Fatal(err)
			}
		}
	}
	included, pipeline, elsewhere := t.TempDir(), t.TempDir(), t.TempDir()
	write(included, map[string]string{
		"p.md":     "```jbogenbau\n%stage main\n%include \"sub/g.md\"\n```\n",
		"sub/g.md": "```jbogenbau\n%ambiguity-resolution greedy\n%rule text (\n```\n",
	})
	write(pipeline, map[string]string{"p.md": "```jbogenbau\n%stage main\n%rule text (\n```\n"})
	home, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(elsewhere); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := os.Chdir(home); err != nil {
			t.Fatal(err)
		}
	}()
	for _, c := range []struct{ root, bad string }{{included, "sub/g.md"}, {pipeline, "p.md"}} {
		expected, err := filepath.Abs(filepath.Join(c.root, filepath.FromSlash(c.bad)))
		if err != nil {
			t.Fatal(err)
		}
		expected = filepath.ToSlash(expected)
		relative, err := filepath.Rel(elsewhere, filepath.Join(c.root, "p.md"))
		if err != nil {
			t.Fatal(err)
		}
		for _, given := range []string{filepath.Join(c.root, "p.md"), relative} {
			_, err := LoadPipelineFile(given)
			var e *Error
			if !errors.As(err, &e) {
				t.Fatalf("%s: %v", given, err)
			}
			if e.Document != expected || !strings.HasPrefix(e.Error(), expected+":") {
				t.Fatalf("%s: the error names %q, not %q: %v", given, e.Document, expected, e)
			}
		}
	}
}

func TestSelectedDiskNames(t *testing.T) {
	data, err := os.ReadFile("../../tests/disk-names.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Description string
		Files       map[string]string
		Error       struct {
			Document     string
			Line, Column int
		}
	}
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	for _, c := range cases {
		t.Run(c.Description, func(t *testing.T) {
			root := t.TempDir()
			for name, text := range c.Files {
				file := filepath.Join(root, name)
				if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(file, []byte(text), 0o644); err != nil {
					t.Fatal(err)
				}
			}
			home, err := os.Getwd()
			if err != nil {
				t.Fatal(err)
			}
			if err := os.Chdir(root); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				if err := os.Chdir(home); err != nil {
					t.Fatal(err)
				}
			})
			_, err = LoadPipelineFile(filepath.Join(root, "p.md"))
			var e *Error
			if !errors.As(err, &e) {
				t.Fatalf("expected grammar error: %v", err)
			}
			if e.Kind != "grammar" || e.Document != filepath.ToSlash(filepath.Join(root, c.Error.Document)) || e.Line != c.Error.Line || e.Column != c.Error.Column {
				t.Fatal(e)
			}
		})
	}
}

func TestIncludeErrorRelocationUsesItsKind(t *testing.T) {
	t.Parallel()
	top := &domDoc{Directives: []*domDirective{
		{Name: "stage", Args: []string{"main"}, At: [2]int{1, 1}},
		{Name: "include", Args: []string{"g.md"}, At: [2]int{2, 1}},
	}}
	for _, c := range []struct {
		line    int
		problem spliceProblem
		message string
	}{
		{0, 0, "the document could not be read: a grammar diagnostic"},
		{7, 0, "the document could not be read: a grammar diagnostic"},
		{0, unreadableDocumentProblem, "an unreadable document"},
		{7, unreadableDocumentProblem, "an unreadable document"},
	} {
		fault := &Error{Kind: ErrorGrammar, Document: "g.md", Line: c.line,
			Message: c.message, Code: "sentinel", spliceProblem: c.problem}
		want := *fault
		want.Stage = "main"
		if c.problem == unreadableDocumentProblem && c.line == 0 {
			want.Message = "g.md: " + c.message
			want.Document, want.Line, want.Column = "p.md", 2, 1
		}
		_, got := splicePipeline("p.md", func(path string) (*domDoc, *Error) {
			if path == "p.md" {
				return top, nil
			}
			return nil, fault
		})
		if !reflect.DeepEqual(got, &want) {
			t.Fatalf("%#v: got %#v, wanted %#v", c, got, &want)
		}
	}
}

func TestUnreadableDocuments(t *testing.T) {
	for _, included := range []bool{false, true} {
		for _, exists := range []bool{false, true} {
			root := t.TempDir()
			pipeline := filepath.Join(root, "p.md")
			file := pipeline
			if included {
				file = filepath.Join(root, "g.md")
				if err := os.WriteFile(pipeline, []byte("```jbogenbau\n%stage main\n%include \"g.md\"\n```\n"), 0o644); err != nil {
					t.Fatal(err)
				}
			}
			if exists {
				if err := os.Mkdir(file, 0o755); err != nil {
					t.Fatal(err)
				}
			}
			_, err := LoadPipelineFile(pipeline)
			var problem *Error
			if !errors.As(err, &problem) {
				t.Fatalf("expected a grammar error: %v", err)
			}
			message := "was not found"
			if exists {
				message = "the document could not be read:"
			}
			if problem.Kind != ErrorGrammar || !strings.Contains(problem.Error(), message) || !strings.Contains(problem.Error(), filepath.ToSlash(file)) {
				t.Fatal(problem)
			}
			if problem.Document != filepath.ToSlash(pipeline) {
				t.Fatal(problem)
			}
			if included && (problem.Line != 3 || problem.Column != 1) {
				t.Fatal(problem)
			}
		}
	}
}
