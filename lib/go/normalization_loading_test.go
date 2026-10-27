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
	text := bundled.sources["grammars/compiled.json"]
	if len(readPreparsed(text, bundled.reader.hash, bundled.uni.hash, fnv1a64(bundled.sources["data/unicode/unicode-properties.txt"]))) == 0 {
		t.Fatal("bundled cache missed")
	}
	for _, hash := range []string{"", "0000000000000000"} {
		if len(readPreparsed(text, bundled.reader.hash, hash, fnv1a64(bundled.sources["data/unicode/unicode-properties.txt"]))) != 0 {
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
	if len(readPreparsed(string(old), bundled.reader.hash, bundled.uni.hash, fnv1a64(bundled.sources["data/unicode/unicode-properties.txt"]))) != 0 {
		t.Fatal("used cache without Unicode identity")
	}

	sources := oneStage("%ambiguity-resolution greedy\n%rule text \"é\"")
	dom, failure := bundled.reader.read(sources["g.md"], "g.md")
	if failure != nil {
		t.Fatal(failure)
	}
	cache, err := json.Marshal(map[string]any{
		"format": domFormat, "bootstrap": bundled.reader.hash, "unicode": bundled.uni.hash, "properties": fnv1a64(bundled.sources["data/unicode/unicode-properties.txt"]),
		"documents": map[string]any{"g.md": map[string]any{"hash": fnv1a64(sources["g.md"]), "dom": json.RawMessage(dom.json())}},
	})
	if err != nil {
		t.Fatal(err)
	}
	sources["grammars/compiled.json"] = string(cache)
	// The replacement table deliberately omits all normalization records.
	sources["data/unicode/unicode.txt"] = "white-space 0009 000D\nwhite-space 0020 0020\n"
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

func TestNormalizationIncludePathAndConstantLocations(t *testing.T) {
	t.Parallel()
	sources := oneStage("%ambiguity-resolution greedy\n%rule text \"e\" \"‹U+0301›\"")
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
	doc := "```jbogenbau\n%const $S \"é$é\" ++ \"‹U+0301›\" ++ \"é\" ++ \"‹U+0323›\"\n%rule text $S\n```"
	dom, failure := bundled.reader.read(doc, "g.md")
	if failure != nil {
		t.Fatal(failure)
	}
	parts := dom.Constants[0].Value.Items
	if dom.Constants[0].At != [2]int{2, 1} || parts[1].Kind != tmString || parts[1].Str != "\u0301" || parts[3].Str != "\u0323" || parts[1].At != [2]int{} || parts[3].At != [2]int{} {
		t.Fatalf("decoded strings and definition location: %#v %#v", parts[1], parts[3])
	}
}

func TestNormalizationDiagnosticReadBack(t *testing.T) {
	t.Parallel()
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	for _, value := range []string{"é", "각", "\u0340", "a\u0301\u0323", "$é", "𝅗𝅥"} {
		spelling := stringTerminal(value, bundled.uni)
		d := mustLoad(t, oneStage("%ambiguity-resolution greedy\n%const $S "+spelling+"\n%rule text $S"))
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
			sources["data/unicode/unicode.txt"] = "white-space 0009 000D\nwhite-space 0020 0020\n"
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
