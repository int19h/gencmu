package gencmu

import (
	"encoding/json"
	"errors"
	"reflect"
	"strconv"
	"strings"
	"testing"
)

func TestReviewEmptyGuardWrapper(t *testing.T) {
	t.Parallel()
	bootstrap := reviewBootstrap(t, func(path string, dom map[string]any) {
		for _, value := range dom["rules"].([]any) {
			rule := value.(map[string]any)
			if path == "grammars/gencmu/jbogenbau/lexical.md" && rule["name"] == "feature-character" {
				rule["alternatives"] = append(rule["alternatives"].([]any), map[string]any{"guards": []any{}, "expr": map[string]any{"literal": map[string]any{"string": "_"}}})
			}
			if path == "grammars/gencmu/jbogenbau/syntax.md" && rule["name"] == "guard" {
				rule["alternatives"].([]any)[0].(map[string]any)["expr"] = map[string]any{"seq": []any{map[string]any{"ref": "padding"}, map[string]any{"ref": "Guard"}}}
			}
		}
		if path == "grammars/gencmu/jbogenbau/syntax.md" {
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
			_, err := LoadPipelineSources(reviewSources(c.grammar, bootstrap), "grammars/test/p.md")
			var e *Error
			if !errors.As(err, &e) || e.Kind != ErrorGrammar || e.Document != "grammars/test/main.md" || e.Line != 3 || e.Column != c.column {
				t.Fatalf("guard at 3:%d: %v", c.column, err)
			}
		})
	}
}

func TestReviewEmptyConstructorAnchor(t *testing.T) {
	t.Parallel()
	gt := extractGrammarText(block("A"))
	b := &domBuilder{gt: gt}
	end := len(gt.text)
	node := &Node{Kind: KindRule, Source: [2]int{end, end}, Children: []*Node{{Kind: KindRule, Source: [2]int{0, 0}}}}
	if got := b.at(node); got != gt.at(end) {
		t.Fatalf("empty constructor anchor %v, want %v", got, gt.at(end))
	}
}

func TestReviewPrivateRecipeExports(t *testing.T) {
	t.Parallel()
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
		{`%rule text ($x:A ≻ $x:B) := $.emitted.value ++ $x.value %emits`, "concat"},
		{`%rule text ($x:A ≻ B) := $x.value %emits`, "concat"},
		{`%rule text :: ∅ := $x.value | ($x:A ≻ B) := "overridden" %emits`, "concat"},
		{`%rule text :: ∅ | ($x:A ≻ B) [$carrier:C] %emits $carrier := $x.value`, "items"},
	} {
		t.Run(c.grammar, func(t *testing.T) {
			_, err := LoadPipelineSources(oneStage("%ambiguity-resolution greedy\n"+c.grammar), "p.md")
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
		if _, err := LoadPipelineSources(oneStage("%ambiguity-resolution greedy\n"+grammar), "p.md"); err != nil {
			t.Fatalf("common recipe capture: %v", err)
		}
	}
	// Earlier local constructors still reject invalid recipe methods.
	_, err := LoadPipelineSources(oneStage("%ambiguity-resolution greedy\n"+`%rule text ($x:A ≻ B) := $x.tags %emits`), "p.md")
	var e *Error
	if !errors.As(err, &e) || e.Code != "" || !strings.Contains(e.Message, "recipe") {
		t.Fatalf("local recipe constructor: %v", err)
	}
}

func reviewCache(t *testing.T, sources map[string]string) string {
	t.Helper()
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	documents := map[string]any{}
	for path, text := range sources {
		dom, err := bundled.reader.readMode(text, path, true)
		if err != nil {
			t.Fatal(err)
		}
		documents[path] = map[string]any{"hash": fnv1a64(text), "dom": json.RawMessage(dom.json())}
	}
	raw, err := json.Marshal(map[string]any{"format": domFormat, "bootstrap": bundled.reader.hash, "unicode": bundled.uni.hash, "properties": fnv1a64(bundled.sources["data/unicode/unicode-properties.txt"]), "documents": documents})
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func TestReviewCachedRecipeCyclePositions(t *testing.T) {
	t.Parallel()
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		grammar, receiver string
		line              int
	}{
		{`%rule text := $.emitted.value | "a" %emits`, "$.emitted.value", 3},
		{`%rule text := $.emitted.image | "a" %emits`, "$.emitted.image", 3},
		// The image recipe closes the cycle, so §11.3 now selects its first atom.
		{`%rule text := $.emitted.image :- $.emitted.value | "a" %emits`, "$.emitted.value", 3},
		{`%rule text := "independent" :- $.emitted.image | "a" %emits`, "$.emitted.image", 3},
		{`%rule text := $.emitted.image :- "prefix" ++ $.emitted.value | "a" %emits`, `"prefix"`, 3},
		{`%rule text := $.emitted.image ++ $.emitted.value :- "image first" ++ $.emitted.image | "a" %emits`, `"image first"`, 3},
		{`%rule text := $.emitted.value ++ $.emitted.image :- $.emitted.value | "a" %emits`, "$.emitted.value", 3},
		{`%rule text := $.emitted.image :- "header"
  | "a" :- $.emitted.value %emits`, "$.emitted.value", 4},
		{`%rule text "a" := $.emitted.value %emits`, "$.emitted.value", 3},
		{`%rule text := $.emitted.value | "a" := "override" :- $.emitted.image %emits`, "$.emitted.image", 3},
		{`%rule text := "unused" | "a" := $.emitted.image :- $.emitted.value %emits`, "$.emitted.value", 3},
		{`%rule text := "header" | "a"
%extend-rule text "b" := $.emitted.value`, "$.emitted.value", 4},
	} {
		t.Run(c.grammar, func(t *testing.T) {
			grammar := c.grammar
			sources := reviewSources(grammar, bundled.sources["data/preparsed/gencmu.json"])
			_, fresh := LoadPipelineSources(sources, "grammars/test/p.md")
			var e *Error
			sourceLine := strings.Split(grammar, "\n")[c.line-3]
			column := strings.Index(sourceLine, c.receiver) + 1
			if !errors.As(fresh, &e) || e.Document != "grammars/test/main.md" || e.Line != c.line || e.Column != column || !strings.Contains(e.Message, "recipe dependency cycle") {
				t.Fatalf("fresh recipe position: %v", fresh)
			}
			sources["data/preparsed/test.json"] = reviewCache(t, sources)
			_, cached := LoadPipelineSources(sources, "grammars/test/p.md")
			if !reflect.DeepEqual(fresh, cached) {
				t.Fatalf("fresh/cache cycle diagnostics differ:\n%+v\n%+v", fresh, cached)
			}
		})
	}
}
func TestReviewRecipeLocationRecoveryPreservesCache(t *testing.T) {
	t.Parallel()
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	// A matching cache still owns the recipe, even when the source spells another value.
	original := reviewSources(`%rule text := $.emitted.value | "a" %emits`, bundled.sources["data/preparsed/gencmu.json"])
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	dom, err := bundled.reader.readMode(original["grammars/test/main.md"], "grammars/test/main.md", true)
	if err != nil {
		t.Fatal(err)
	}
	sources := reviewSources(`%rule text := "source is independent" | "a" %emits`, bundled.sources["data/preparsed/gencmu.json"])
	sources["data/preparsed/test.json"] = `{"format":` + strconv.Itoa(domFormat) + `,"bootstrap":"` + bundled.reader.hash + `","unicode":"` + bundled.uni.hash + `","properties":"` + fnv1a64(bundled.sources["data/unicode/unicode-properties.txt"]) + `","documents":{"grammars/test/main.md":{"hash":"` + fnv1a64(sources["grammars/test/main.md"]) + `","dom":` + string(dom.json()) + `}}}`
	_, failure := LoadPipelineSources(sources, "grammars/test/p.md")
	var e *Error
	if !errors.As(failure, &e) || e.Line != 3 || e.Column != 15 || !strings.Contains(e.Message, "text.value -> text.value") {
		t.Fatalf("cache semantics or location changed: %v", failure)
	}
	// A valid cached recipe needs no source reader for location recovery.
	valid := reviewSources(`%rule text := "a" | "a" %emits $`, bundled.sources["data/preparsed/gencmu.json"])
	cache := readPreparsed(reviewCache(t, valid), bundled.reader.hash, bundled.uni.hash, fnv1a64(bundled.sources["data/unicode/unicode-properties.txt"]))
	configured, loadErr := bundledLoader()
	if loadErr != nil {
		t.Fatal(loadErr)
	}
	l := &loader{uni: configured.uni, bootstrapHash: bundled.reader.hash, preparsed: cache, read: func(path string) (string, bool) { s, ok := valid[path]; return s, ok }}
	if _, err := l.pipeline("grammars/test/p.md"); err != nil {
		t.Fatalf("valid cache reparsed: %v", err)
	}
}

func TestReviewRecipeProductionOrder(t *testing.T) {
	t.Parallel()
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		name, grammar string
		line          int
	}{
		{"extension", `%rule text "a"
%rule other := $.emitted.value | "b"
%extend-rule text := $.emitted.image | "c"`, 4},
		{"replacement", `%rule text "a"
%rule other := $.emitted.value | "b"
%redefine-rule text := $.emitted.image | "c"`, 4},
		{"removed cycle", `%rule text := $.emitted.value | "a"
%rule other := $.emitted.value | "b"
%redefine-rule text "a"`, 4},
		{"resolved constant", `%const $K "k"
%rule text "a"
%rule other := $K ++ $.emitted.value | "b"
%extend-rule text := $.emitted.image | "c"`, 5},
	} {
		t.Run(c.name, func(t *testing.T) {
			sources := reviewSources(c.grammar, bundled.sources["data/preparsed/gencmu.json"])
			_, fresh := LoadPipelineSources(sources, "grammars/test/p.md")
			var e *Error
			if !errors.As(fresh, &e) || e.Document != "grammars/test/main.md" || e.Line != c.line || e.Column != 16 || !strings.Contains(e.Message, "other.value -> other.value") {
				t.Fatalf("production order: %v", fresh)
			}
			sources["data/preparsed/test.json"] = reviewCache(t, sources)
			_, cached := LoadPipelineSources(sources, "grammars/test/p.md")
			if !reflect.DeepEqual(fresh, cached) {
				t.Fatalf("fresh/cache production order differs:\n%+v\n%+v", fresh, cached)
			}
		})
	}
	t.Run("document order", func(t *testing.T) {
		sources := map[string]string{
			"grammars/test/p.md":         block("%stage main", "%ambiguity-resolution greedy", `%include "base.md"`, `%include "earlier.md"`, `%include "later.md"`),
			"grammars/test/base.md":      block(`%rule text "a"`),
			"grammars/test/earlier.md":   block(`%rule other := $.emitted.value | "b"`),
			"grammars/test/later.md":     block(`%extend-rule text := $.emitted.image | "c"`),
			"data/preparsed/gencmu.json": bundled.sources["data/preparsed/gencmu.json"],
		}
		_, fresh := LoadPipelineSources(sources, "grammars/test/p.md")
		var e *Error
		if !errors.As(fresh, &e) || e.Document != "grammars/test/earlier.md" || e.Line != 2 || e.Column != 16 {
			t.Fatalf("document order: %v", fresh)
		}
		sources["data/preparsed/test.json"] = reviewCache(t, sources)
		_, cached := LoadPipelineSources(sources, "grammars/test/p.md")
		if !reflect.DeepEqual(fresh, cached) {
			t.Fatalf("fresh/cache document order differs:\n%+v\n%+v", fresh, cached)
		}
	})
}
