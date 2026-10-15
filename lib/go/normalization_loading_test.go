package gencmu

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestNormalizationCacheIdentity(t *testing.T) {
	t.Parallel()
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	text := bundled.sources["compiled.json"]
	if len(readCompiled(text, bundled.reader.hash, bundled.uni.hash)) == 0 {
		t.Fatal("bundled cache missed")
	}
	for _, hash := range []string{"", "0000000000000000"} {
		if len(readCompiled(text, bundled.reader.hash, hash)) != 0 {
			t.Fatalf("used cache under Unicode hash %q", hash)
		}
	}
	var envelope map[string]any
	if err := json.Unmarshal([]byte(text), &envelope); err != nil {
		t.Fatal(err)
	}
	delete(envelope, "unicode")
	old, err := json.Marshal(envelope)
	if err != nil {
		t.Fatal(err)
	}
	if len(readCompiled(string(old), bundled.reader.hash, bundled.uni.hash)) != 0 {
		t.Fatal("used cache without Unicode identity")
	}

	sources := oneStage("%ambiguity-resolution greedy\n%rule text \"é\"")
	dom, failure := bundled.reader.read(sources["g.md"], "g.md")
	if failure != nil {
		t.Fatal(failure)
	}
	cache, err := json.Marshal(map[string]any{
		"format": domFormat, "bootstrap": bundled.reader.hash, "unicode": bundled.uni.hash,
		"documents": map[string]any{"g.md": map[string]any{"hash": fnv1a64(sources["g.md"]), "dom": json.RawMessage(dom.json())}},
	})
	if err != nil {
		t.Fatal(err)
	}
	sources["compiled.json"] = string(cache)
	// The replacement table deliberately omits all normalization records.
	sources["unicode.txt"] = "white-space 0009 000D\nwhite-space 0020 0020\n"
	d := mustLoad(t, sources)
	res, err := d.Parse("é", ParseOptions{})
	if err != nil || !res.OK {
		t.Fatalf("replacement table reused a bundled DOM: %v %#v", err, res)
	}
	res, err = d.Parse("e\u0301", ParseOptions{})
	if err != nil || res.OK {
		t.Fatalf("replacement table gained bundled mappings: %v %#v", err, res)
	}
}

func TestNormalizationIncludePathAndInterpolationLocations(t *testing.T) {
	t.Parallel()
	sources := oneStage("%ambiguity-resolution greedy\n%rule text \"e\" $_0301")
	sources["p.md"] = strings.ReplaceAll(sources["p.md"], "g.md", "café.md")
	sources["café.md"] = sources["g.md"]
	delete(sources, "g.md")
	d := mustLoad(t, sources)
	if res, err := d.Parse("e\u0301", ParseOptions{}); err != nil || !res.OK {
		t.Fatalf("include path or literal: %v %#v", err, res)
	}
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	doc := "```jbogenbau\n%rule text \"é$$é$(_0301)é$(_0323)\"\n```"
	dom, failure := bundled.reader.read(doc, "g.md")
	if failure != nil {
		t.Fatal(failure)
	}
	parts := dom.Rules[0].Alternatives[0].Expr.Value.Items
	if parts[1].At != [2]int{2, 17} || parts[3].At != [2]int{2, 26} {
		t.Fatalf("interpolation locations: %#v %#v", parts[1], parts[3])
	}
}

func TestNormalizationDiagnosticReadBack(t *testing.T) {
	t.Parallel()
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	for _, value := range []string{"é", "각", "\u0340", "a\u0301\u0323", "$é", "𝅗𝅥"} {
		spelling := stringTerminal(value, bundled.uni)
		d := mustLoad(t, oneStage("%ambiguity-resolution greedy\n%rule text "+spelling))
		token := InputToken{Text: value, Value: &value, Image: &value, Source: [2]int{0, len([]rune(value))}}
		if res, err := d.ParseTokens(value, []InputToken{token}, ParseOptions{}); err != nil || !res.OK {
			t.Fatalf("read-back %q: %v %#v", spelling, err, res)
		}
	}
}

func TestNormalizationDecomposedSourceRecipes(t *testing.T) {
	t.Parallel()
	grammar := "%ambiguity-resolution greedy\n%rule text $x:piece\n%emits $ := $x.emitted.value :- $x.emitted.image\n%rule piece [{_}] := $.decomposed-source-text :- $.source-text"
	for _, custom := range []bool{false, true} {
		sources := oneStage(grammar)
		want := "e\u0323\u0301"
		if custom {
			sources["unicode.txt"] = "white-space 0009 000D\nwhite-space 0020 0020\n"
			want = "é\u0323"
		}
		d := mustLoad(t, sources)
		res, err := d.Parse("é\u0323", ParseOptions{})
		if err != nil || !res.OK {
			t.Fatalf("custom %v: %v %#v", custom, err, res)
		}
		output := res.Stages[0].Output
		if len(output) != 1 || output[0].Value != want || output[0].Image != "é\u0323" || output[0].Text != "é\u0323" {
			t.Fatalf("custom %v: %#v", custom, output)
		}
	}
	for _, recipe := range []string{"$.emitted.decomposed-source-text", "$.onward.decomposed-source-text"} {
		if _, err := LoadDialectSources(oneStage("%ambiguity-resolution greedy\n%rule text _\n%emits $ := "+recipe), "p.md"); err == nil {
			t.Fatalf("accepted invalid recipe: %s", recipe)
		}
	}
}
