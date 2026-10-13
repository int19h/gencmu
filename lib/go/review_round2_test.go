package gencmu

import (
	"errors"
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
