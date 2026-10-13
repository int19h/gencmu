package gencmu

import (
	"encoding/json"
	"errors"
	"testing"
)

// Each probe changes a fresh bootstrap in memory. The bundled copy stays intact.
func reviewBootstrap(t *testing.T, change func(string, map[string]any)) string {
	t.Helper()
	raw, err := bundledFS.ReadFile("grammars/notation/bootstrap.json")
	if err != nil {
		t.Fatal(err)
	}
	var bootstrap map[string]any
	if err := json.Unmarshal(raw, &bootstrap); err != nil {
		t.Fatal(err)
	}
	for _, stage := range bootstrap["stages"].([]any) {
		for _, item := range stage.(map[string]any)["documents"].([]any) {
			document := item.(map[string]any)
			change(document["path"].(string), document["dom"].(map[string]any))
		}
	}
	encoded, err := json.Marshal(bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	return string(encoded)
}

func reviewSources(grammar, bootstrap string) map[string]string {
	return map[string]string{
		"p.md":                    block("%stage main", `%include "main.md"`),
		"main.md":                 block("%ambiguity-resolution greedy", grammar),
		"notation/bootstrap.json": bootstrap,
	}
}

func TestReviewGuardValidation(t *testing.T) {
	bootstrap := reviewBootstrap(t, func(path string, dom map[string]any) {
		if path != "notation/lexical.md" {
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
			_, err := LoadDialectSources(reviewSources(c.grammar, bootstrap), "p.md")
			var e *Error
			if !errors.As(err, &e) || e.Kind != ErrorGrammar || e.Document != "main.md" || e.Line != 3 || e.Column != c.column {
				t.Fatalf("expected the guard at 3:%d, got %v", c.column, err)
			}
		})
	}
	// Capital-initial features, gates and ordinary warnings remain valid.
	for _, grammar := range []string{`%rule text Cbm? A | ¬Cbm? B | fine! C`, "%classifier c Cbm? \"a\" ∈ A\n%rule text _"} {
		if _, err := LoadDialectSources(reviewSources(grammar, bootstrap), "p.md"); err != nil {
			t.Fatalf("valid guards: %v", err)
		}
	}
}

func TestReviewPropertyWrapper(t *testing.T) {
	bootstrap := reviewBootstrap(t, func(path string, dom map[string]any) {
		if path != "notation/syntax.md" {
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
	dialect, err := LoadDialectSources(reviewSources(`%rule text "a" %emits $`, bootstrap), "p.md")
	if err != nil {
		t.Fatal(err)
	}
	result, err := dialect.Parse("a", ParseOptions{})
	if err != nil || !result.OK {
		t.Fatalf("wrapped string terminal: %v %+v", err, result)
	}
}
