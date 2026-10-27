package gencmu

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

// Each probe changes a fresh bootstrap in memory. The bundled copy stays intact.
func reviewBootstrap(t *testing.T, change func(string, map[string]any)) string {
	t.Helper()
	raw, err := bundledFS.ReadFile("data/preparsed/gencmu.json")
	if err != nil {
		t.Fatal(err)
	}
	var bootstrap map[string]any
	if err := json.Unmarshal(raw, &bootstrap); err != nil {
		t.Fatal(err)
	}
	for path, item := range bootstrap["documents"].(map[string]any) {
		document := item.(map[string]any)
		change(path, document["dom"].(map[string]any))
	}
	encoded, err := json.Marshal(bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	return string(encoded)
}

func reviewSources(grammar, bootstrap string) map[string]string {
	return map[string]string{
		"grammars/test/p.md":         block("%stage main", `%include "main.md"`),
		"grammars/test/main.md":      block("%ambiguity-resolution greedy", grammar),
		"data/preparsed/gencmu.json": bootstrap,
	}
}

func TestReviewGuardValidation(t *testing.T) {
	t.Parallel()
	bootstrap := reviewBootstrap(t, func(path string, dom map[string]any) {
		if path != "grammars/gencmu/jbogenbau/lexical.md" {
			return
		}
		for _, value := range dom["rules"].([]any) {
			rule := value.(map[string]any)
			var expr any
			switch rule["name"] {
			case "feature-character":
				expr = map[string]any{"literal": map[string]any{"string": "_"}}
			case "guard":
				expr = map[string]any{"seq": []any{
					map[string]any{"literal": map[string]any{"string": "¬"}},
					map[string]any{"ref": "feature-name"},
					map[string]any{"literal": map[string]any{"string": "!"}},
				}}
			default:
				continue
			}
			rule["alternatives"] = append(rule["alternatives"].([]any), map[string]any{"guards": []any{}, "expr": expr})
		}
	})
	for _, c := range []struct {
		grammar string
		column  int
	}{
		{`%rule text bad_name? A`, 12},
		{`%rule text bad_name? [A]="x"`, 12},
		{"%classifier c bad_name? \"a\" ∈ A\n%rule text _", 15},
		{`%rule text ¬fine! A`, 12},
		{`%rule text ¬fine! [A]="x"`, 12},
		{"%classifier c ¬fine! \"a\" ∈ A\n%rule text _", 15},
	} {
		t.Run(c.grammar, func(t *testing.T) {
			_, err := LoadPipelineSources(reviewSources(c.grammar, bootstrap), "grammars/test/p.md")
			var e *Error
			if !errors.As(err, &e) || e.Kind != ErrorGrammar || e.Document != "grammars/test/main.md" || e.Line != 3 || e.Column != c.column {
				t.Fatalf("expected the guard at 3:%d, got %v", c.column, err)
			}
		})
	}
	// Capital-initial features, gates and ordinary warnings remain valid.
	for _, grammar := range []string{`%rule text Cbm? A | ¬Cbm? B | fine! C`, "%classifier c Cbm? \"a\" ∈ A\n%rule text _"} {
		if _, err := LoadPipelineSources(reviewSources(grammar, bootstrap), "grammars/test/p.md"); err != nil {
			t.Fatalf("valid guards: %v", err)
		}
	}
}

func TestReviewPropertyWrapper(t *testing.T) {
	t.Parallel()
	bootstrap := reviewBootstrap(t, func(path string, dom map[string]any) {
		if path != "grammars/gencmu/jbogenbau/syntax.md" {
			return
		}
		for _, value := range dom["rules"].([]any) {
			rule := value.(map[string]any)
			if rule["name"] != "untested-primary" {
				continue
			}
			for _, alternative := range rule["alternatives"].([]any) {
				expr := alternative.(map[string]any)["expr"].(map[string]any)
				if expr["ref"] == "string-terminal" {
					expr["ref"] = "property"
				}
			}
		}
		dom["rules"] = append(dom["rules"].([]any), map[string]any{
			"name": "property", "op": "define", "flags": []any{},
			"alternatives": []any{map[string]any{"guards": []any{}, "expr": map[string]any{"ref": "string-terminal"}}},
			"conditions":   []any{}, "at": []any{1, 1},
		})
	})
	pipeline, err := LoadPipelineSources(reviewSources(`%rule text "a" %emits $`, bootstrap), "grammars/test/p.md")
	if err != nil {
		t.Fatal(err)
	}
	result, err := pipeline.Parse("a", ParseOptions{})
	if err != nil || !result.OK {
		t.Fatalf("wrapped string terminal: %v %+v", err, result)
	}
}

func TestReviewRecipeCyclePath(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		grammar string
		path    string
	}{
		{`%rule text := $.emitted.value | "a" %emits`, "text.value -> text.value"},
		{`%rule text := $.emitted.image :- $.emitted.value | "a" %emits`, "text.value -> text.image -> text.value"},
		{`%rule text := "x" :- $.emitted.image | "a" %emits`, "text.image -> text.image"},
		// Engine §11.3 identifies an implied image with the value recipe it reuses.
		{`%rule text := $.emitted.image | "a" %emits`, "text.value -> text.value"},
	} {
		t.Run(c.path, func(t *testing.T) {
			_, err := LoadPipelineSources(oneStage("%ambiguity-resolution greedy\n"+c.grammar), "p.md")
			var e *Error
			if !errors.As(err, &e) || e.Kind != ErrorGrammar || !strings.Contains(e.Message, c.path) {
				t.Fatalf("expected a recipe cycle with path %q, got %v", c.path, err)
			}
		})
	}
	// Cross-channel dependencies remain valid when the other channel is independent.
	for _, grammar := range []string{
		`%rule text := $.emitted.image :- "x" | "a" %emits $`,
		`%rule text := "x" :- $.emitted.value | "a" %emits $`,
	} {
		pipeline := mustLoad(t, oneStage("%ambiguity-resolution greedy\n"+grammar))
		result, err := pipeline.Parse("a", ParseOptions{})
		if err != nil || !result.OK || len(result.Stages[0].Output) != 1 || result.Stages[0].Output[0].Value != "x" || result.Stages[0].Output[0].Image != "x" {
			t.Fatalf("acyclic recipe: %v %+v", err, result)
		}
	}
}
