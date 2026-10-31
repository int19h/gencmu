package gencmu

import (
	"encoding/json"
	"errors"
	"reflect"
	"strconv"
	"strings"
	"testing"
)

func TestRankedLinearForest(t *testing.T) {
	t.Parallel()
	d := mustLoad(t, oneStage("%ambiguity-resolution late(elision)\n%rule text {unit}\n%rule unit a ≻ b\n%rule a X Y\n%rule b X Y"))
	for _, n := range []int{1, 2, 4, 8, 16} {
		tokens := make([]Token, n*2)
		for i := range tokens {
			tag, text := "X", "x"
			if i%2 != 0 {
				tag, text = "Y", "y"
			}
			tokens[i] = Token{Text: text, Tags: []string{tag}, Span: [2]int{i, i + 1}, Source: [2]int{i, i + 1}}
		}
		var stats []slotStatistics
		res, err := d.parseStoredTokens(strings.Repeat("xy", n), tokens, ParseOptions{private: &privateOptions{slotAdmission: func(s slotStatistics) { stats = append(stats, s) }}})
		if err != nil || res.Stages[0].Verdict != VerdictUnique || len(stats) == 0 || stats[0].groups != n || stats[0].candidateEdges != 2*n || stats[0].retainedEdges != n {
			t.Fatalf("%d: %v %+v", n, err, stats)
		}
	}
}
func TestRankedDOMCacheDiagnostics(t *testing.T) {
	t.Parallel()
	sources := oneStage("%const $K K\n%ambiguity-resolution late(elision)\n%rule text :: $x ⟹ ($x.tags ∪ $K) | Q (($x:a ≻ b) ≻ c) Z\n%rule a X Y\n%rule b U V\n%rule c R S")
	sources = map[string]string{"grammars/test/p.md": sources["p.md"], "grammars/test/g.md": sources["g.md"]}
	_, plain := LoadPipelineSources(sources, "grammars/test/p.md")
	dom, e := bundled.reader.read(sources["grammars/test/g.md"], "grammars/test/g.md")
	if e != nil {
		t.Fatal(e)
	}
	// The source alone now loads. Only the cached DOM retains the export error.
	sources["grammars/test/g.md"] = strings.Replace(sources["grammars/test/g.md"], ":: $x ⟹ ($x.tags ∪ $K)", ":: ∅"+strings.Repeat(" ", len([]rune(":: $x ⟹ ($x.tags ∪ $K)"))-4), 1)
	if _, err := LoadPipelineSources(sources, "grammars/test/p.md"); err != nil {
		t.Fatalf("cache bypass control does not load: %v", err)
	}
	sources["data/preparsed/test.json"] = `{"format":` + strconv.Itoa(domFormat) + `,"bootstrap":"` + bundled.reader.hash + `","unicode":"` + bundled.uni.hash + `","properties":"` + fnv1a64(bundled.sources["data/unicode/unicode-properties.txt"]) + `","documents":{"grammars/test/g.md":{"hash":"` + fnv1a64(sources["grammars/test/g.md"]) + `","dom":` + string(dom.json()) + `}}}`
	_, cached := LoadPipelineSources(sources, "grammars/test/p.md")
	if plain == nil || !reflect.DeepEqual(plain, cached) {
		t.Fatalf("%+v\n%+v", plain, cached)
	}
	error := plain.(*Error)
	if error.Code != "ranked-choice-export" || error.Group.Path != "/seq/1/ranked/0" || *error.Group.At != [2]int{6, 46} || *error.Option != 0 {
		t.Fatalf("%+v path=%s at=%v option=%d", error, error.Group.Path, *error.Group.At, *error.Option)
	}
	raw, err := json.Marshal(error)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(string(raw), `{"kind":"grammar","code":"ranked-choice-export","message":`) {
		t.Fatal(string(raw))
	}
	if !strings.Contains(string(error.Expression), `"const":"K"`) {
		t.Fatal(string(raw))
	}
}
func TestRankedShortestTagWitness(t *testing.T) {
	t.Parallel()
	_, err := LoadPipelineSources(oneStage("%ambiguity-resolution late(elision)\n%rule text a ≻ b\n%rule a u | v\n%rule u deeper\n%rule deeper X\n%rule v Y\n%rule b :: ∅ | Z\n"), "p.md")
	if err == nil {
		t.Fatal("grammar loaded")
	}
	e := err.(*Error)
	names := []string{}
	for _, site := range e.Inheritance {
		names = append(names, site.Rule)
	}
	if e.Code != "ranked-choice-tags" || !reflect.DeepEqual(names, []string{"text", "a", "v"}) {
		t.Fatalf("%+v", e)
	}
}
func TestRankedSyntaxAndRetirement(t *testing.T) {
	t.Parallel()
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	for _, body := range []string{"a | b ≻ c", "a ≻ b | c", "| a ≻ b", "a ≻", "≻ a"} {
		_, e := bundled.reader.read("```jbogenbau\n%rule text "+body+"\n```\n", "g.md")
		if e == nil || e.Code != "ranked-choice-syntax" {
			t.Fatalf("%s: %v", body, e)
		}
	}
	_, e := bundled.reader.read("```jbogenbau\n%prefer a > b\n```\n", "g.md")
	if e == nil || e.Code != "" || e.Line != 2 || e.Column != 1 || strings.Contains(e.Message, "inline ranked choice") {
		t.Fatal(e)
	}
}

func TestValidRankedCacheSkipsLocationRecovery(t *testing.T) {
	t.Parallel()
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	sources := oneStage("%ambiguity-resolution late(elision)\n%rule text Q (a ≻ b) Z\n%rule a X Y\n%rule b X Y")
	documents := map[domCacheKey]json.RawMessage{}
	for path, text := range sources {
		dom, err := bundled.reader.read(text, path)
		if err != nil {
			t.Fatal(err)
		}
		for _, rule := range dom.Rules {
			for _, alternative := range rule.Alternatives {
				if len(alternative.rankedLocations) != 0 {
					t.Fatal("fresh source-location recovery ran")
				}
			}
		}
		documents[domCacheKey{path, fnv1a64(text), bundled.reader.hash, bundled.uni.hash, bundled.uni.propertiesHash, domFormat}] = dom.json()
	}
	// A missing reader makes any source parse or location recovery fail.
	l := &loader{uni: bundled.uni, bootstrapHash: bundled.reader.hash, preparsed: documents, read: func(path string) (string, bool, *Error) { text, ok := sources[path]; return text, ok, nil }}
	for i := 0; i < 2; i++ {
		if _, err := l.pipeline("p.md"); err != nil {
			t.Fatal(err)
		}
		dom, err := l.document("g.md")
		if err != nil {
			t.Fatal(err)
		}
		for _, rule := range dom.Rules {
			for _, alternative := range rule.Alternatives {
				if len(alternative.rankedLocations) != 0 {
					t.Fatal("source-location recovery ran")
				}
			}
		}
	}
}

func TestDeferredRecipePrecedesEmptyEmission(t *testing.T) {
	grammar := `%rule text [$a:A] (X ≻ Y) | [$b:B] Z := $b.value %emits $a`
	_, err := casePipeline(&engineCase{Grammar: &grammar}, false)
	if isGuardedCrash(err) || err == nil || !strings.Contains(err.Error(), "recipe") || !strings.Contains(err.Error(), "$b") {
		t.Fatalf("got %v", err)
	}
	if e, ok := err.(*Error); !ok || e.Code != "" {
		t.Fatalf("got %v", err)
	}
}

func TestRankedRecipeOrder(t *testing.T) {
	t.Parallel()
	_, err := LoadPipelineSources(oneStage("%ambiguity-resolution greedy\n%rule text :: ∅ := $x.value | ($x:A ≻ $x:B) := $x.image %emits"), "p.md")
	if err == nil {
		t.Fatal("the private recipe loaded")
	}
	fault := err.(*Error)
	if fault.Code != "ranked-choice-export" || !strings.Contains(string(fault.Expression), `"method":"image"`) {
		t.Fatalf("got %v, expression %s", fault, fault.Expression)
	}
}

func TestProjectedRankedRoutePriorityAndBindings(t *testing.T) {
	for _, separator := range []string{"|", "&"} {
		grammar := "%ambiguity-resolution greedy\n%rule text (($x:A " + separator + " $y:B) ≻ C) Z\n%conditions ($y ⟹ $.value = \"y\"), ($x ⟹ $.value = \"x\")"
		_, failure := LoadPipelineSources(oneStage(grammar), "p.md")
		if failure == nil {
			t.Fatal("grammar loaded")
		}
		err := failure.(*Error)
		if err.Code != "ranked-choice-continuation" || err.Option == nil || *err.Option != 0 {
			t.Fatal(err)
		}
		var expression struct{ If struct{ Captured string } }
		if failure := json.Unmarshal(err.Expression, &expression); failure != nil {
			t.Fatal(failure)
		}
		if expression.If.Captured != "x" {
			t.Fatalf("wrong condition: %s", err.Expression)
		}
	}
	_, failure := LoadPipelineSources(oneStage("%ambiguity-resolution greedy\n%rule text (($x:A ≻ B) ≻ C) Z\n%conditions (¬$x ∧ $.value = \"b\")"), "p.md")
	if failure == nil {
		t.Fatal("grammar loaded")
	}
	err := failure.(*Error)
	if err.Code != "ranked-choice-continuation" || err.Option == nil || *err.Option != 1 {
		t.Fatal(err)
	}
}

func TestRankedPrivateRecipeExports(t *testing.T) {
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
	if isGuardedCrash(err) || !errors.As(err, &e) || e.Code != "" || !strings.Contains(e.Message, "recipe") {
		t.Fatalf("local recipe constructor: %v", err)
	}
}
