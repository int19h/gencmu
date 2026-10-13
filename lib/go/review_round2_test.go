package gencmu

import (
	"errors"
	"strings"
	"testing"
)

func TestReviewEmptyGuardWrapper(t *testing.T) {
	bootstrap := reviewBootstrap(t, func(path string, dom map[string]any) {
		for _, value := range dom["rules"].([]any) {
			rule := value.(map[string]any)
			if path == "notation/lexical.md" && rule["name"] == "feature-character" {
				rule["alternatives"] = append(rule["alternatives"].([]any), map[string]any{"guards": []any{}, "expr": map[string]any{"literal": map[string]any{"string": "_"}}})
			}
			if path == "notation/syntax.md" && rule["name"] == "guard" {
				rule["alternatives"].([]any)[0].(map[string]any)["expr"] = map[string]any{"seq": []any{map[string]any{"ref": "padding"}, map[string]any{"ref": "Guard"}}}
			}
		}
		if path == "notation/syntax.md" {
			dom["rules"] = append(dom["rules"].([]any), map[string]any{"name": "padding", "op": "define", "flags": []any{}, "alternatives": []any{map[string]any{"guards": []any{}, "expr": map[string]any{"empty": true}}}, "conditions": []any{}, "at": []any{1, 1}})
		}
	})
	for _, c := range []struct {
		grammar string
		column  int
	}{
		{`%rule text bad_name? A`, 12},
		{`%rule text bad_name? [A]="x"`, 12},
		{"%classifier c bad_name? \"a\" ∈ A\n%rule text _", 15},
	} {
		t.Run(c.grammar, func(t *testing.T) {
			_, err := LoadDialectSources(reviewSources(c.grammar, bootstrap), "p.md")
			var e *Error
			if !errors.As(err, &e) || e.Kind != ErrorGrammar || e.Document != "main.md" || e.Line != 3 || e.Column != c.column {
				t.Fatalf("guard at 3:%d: %v", c.column, err)
			}
		})
	}
}

func TestReviewEmptyConstructorAnchor(t *testing.T) {
	gt := extractGrammarText(block("A"))
	b := &domBuilder{gt: gt}
	end := len(gt.text)
	node := &Node{Kind: KindRule, Source: [2]int{end, end}, Children: []*Node{{Kind: KindRule, Source: [2]int{0, 0}}}}
	if got := b.at(node); got != gt.at(end) {
		t.Fatalf("empty constructor anchor %v, want %v", got, gt.at(end))
	}
}

func TestReviewPrivateRecipeExports(t *testing.T) {
	for _, c := range []struct{ grammar, expression string }{
		{`%rule text :: ∅ := $x.value | ($x:A ≻ $x:B) %emits`, "concat"},
		{`%rule text :: ∅ :- $x.image | ($x:A ≻ $x:B) %emits`, "concat"},
		{`%rule text :: ∅ | ($x:A ≻ $x:B) := $x.value %emits`, "concat"},
		{`%rule text :: ∅ | ($x:A ≻ $x:B) :- $x.emitted.image %emits`, "concat"},
		{`%rule text :: ∅ | ($x:A ≻ $x:B) %emits $ := $x.value`, "items"},
		{`%rule text :: ∅ | ($x:A ≻ $x:B) %emits $ :- $x.emitted.image`, "items"},
		{`%rule text :: ∅ | ($x:A ≻ $x:B) %emits ε := $x.value`, "items"},
		{`%rule text :: ∅ | ($x:A ≻ $x:B) %emits ε :- $x.image`, "items"},
		{`%rule text :: ∅ | ($x:A ≻ $x:B) %emits ε :: $x ⟹ $x.tags`, "items"},
		{`%rule text ($x:A ≻ $x:B) := $.emitted.value $x.value %emits`, "concat"},
		{`%rule text ($x:A ≻ B) := $x.value %emits`, "concat"},
		{`%rule text :: ∅ := $x.value | ($x:A ≻ B) := "overridden" %emits`, "concat"},
		{`%rule text :: ∅ | ($x:A ≻ B) [$carrier:C] %emits $carrier := $x.value`, "items"},
	} {
		t.Run(c.grammar, func(t *testing.T) {
			_, err := LoadDialectSources(oneStage("%ambiguity-resolution greedy\n"+c.grammar), "p.md")
			var e *Error
			if !errors.As(err, &e) || e.Code != "ranked-choice-export" || e.Group == nil || e.Group.Path != "" && e.Group.Path != "/seq/0" || e.Option == nil || *e.Option != 0 || !strings.Contains(string(e.Expression), `"`+c.expression+`"`) {
				t.Fatalf("private recipe load diagnostic: %v %+v", err, e)
			}
		})
	}
	// Common captures and the whole parent remain legal in recipes.
	for _, grammar := range []string{
		`%rule text :: ∅ | $before:C (A ≻ B) := $before.value %emits $`,
		`%rule text :: ∅ | (A ≻ B) $after:C := $after.image %emits ε := $.value`,
	} {
		if _, err := LoadDialectSources(oneStage("%ambiguity-resolution greedy\n"+grammar), "p.md"); err != nil {
			t.Fatalf("common recipe capture: %v", err)
		}
	}
	// Earlier local constructors still reject invalid recipe methods.
	_, err := LoadDialectSources(oneStage("%ambiguity-resolution greedy\n"+`%rule text ($x:A ≻ B) := $x.tags %emits`), "p.md")
	var e *Error
	if !errors.As(err, &e) || e.Code != "" || !strings.Contains(e.Message, "recipe") {
		t.Fatalf("local recipe constructor: %v", err)
	}
}
