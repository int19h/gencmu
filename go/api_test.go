package gencmu

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func mustLoad(t *testing.T, sources map[string]string) *Dialect {
	t.Helper()
	d, err := LoadDialectSources(sources, "p.md")
	if err != nil {
		t.Fatal(err)
	}
	return d
}

func oneStage(grammar string) map[string]string {
	return map[string]string{
		"p.md": "# A dialect\n\n## Main <?stage main?>\n\n- [the grammar](g.md) <?grammar?>\n",
		"g.md": "# A grammar\n\n```ebnf\n" + grammar + "\n```\n",
	}
}

func TestLoadDialectBundled(t *testing.T) {
	d, err := LoadDialect("notation")
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(d.StageNames(), " "); got != "lexical syntax" {
		t.Fatalf("stages %q", got)
	}
	res, err := d.Parse("text ≔ A [B] ... ;", ParseOptions{})
	if err != nil || !res.OK {
		t.Fatalf("%v %+v", err, res.Error)
	}
	if res.Tree == nil || res.Tree.Rule != "text" || len(res.Stages) != 2 {
		t.Fatalf("unexpected result %+v", res)
	}
	if _, err := LoadDialect("no-such-dialect"); err == nil {
		t.Fatal("a missing dialect loaded")
	} else {
		var e *Error
		if !errors.As(err, &e) || e.Kind != ErrorGrammar || e.Document != "dialects/no-such-dialect.md" {
			t.Fatalf("unexpected error %#v", err)
		}
	}
}

func TestLoadDialectFile(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "dialects"), 0o755)
	os.MkdirAll(filepath.Join(dir, "syntax"), 0o755)
	os.WriteFile(filepath.Join(dir, "dialects", "mine.md"), []byte("## Main <?stage main?>\n\n- [g](../syntax/g.md) <?grammar?>\n"), 0o644)
	os.WriteFile(filepath.Join(dir, "syntax", "g.md"), []byte("```ebnf\n%ambiguity-resolution greedy ;\ntext ≔ \"a\" ... ;\n```\n"), 0o644)
	d, err := LoadDialectFile(filepath.Join(dir, "dialects", "mine.md"))
	if err != nil {
		t.Fatal(err)
	}
	res, _ := d.Parse("aaa", ParseOptions{})
	if !res.OK || Brackets(res, BracketOptions{}) != "(a a a)" {
		t.Fatalf("%+v %q", res.Error, Brackets(res, BracketOptions{}))
	}
	os.WriteFile(filepath.Join(dir, "dialects", "broken.md"), []byte("## Main <?stage main?>\n\n- [g](../syntax/missing.md) <?grammar?>\n"), 0o644)
	_, err = LoadDialectFile(filepath.Join(dir, "dialects", "broken.md"))
	var e *Error
	if !errors.As(err, &e) || !strings.HasSuffix(e.Document, "syntax/missing.md") || e.Stage != "main" {
		t.Fatalf("unexpected error %#v", err)
	}
}

func TestLoadErrors(t *testing.T) {
	cases := map[string]struct {
		sources map[string]string
		line    int
		column  int
		doc     string
	}{
		"syntax":         {oneStage("%ambiguity-resolution greedy ;\ntext ≔ A B"), 5, 11, "g.md"},
		"escape":         {oneStage("%ambiguity-resolution greedy ;\ntext ≔ \"\\q\" ;"), 5, 8, "g.md"},
		"undefined":      {oneStage("%ambiguity-resolution greedy ;\ntext ≔ nowhere ;"), 5, 1, "g.md"},
		"missing":        {map[string]string{"p.md": "## Main <?stage main?>\n\n- [g](g.md) <?grammar?>\n"}, 0, 0, "g.md"},
		"no link":        {map[string]string{"p.md": "## Main <?stage main?>\n\n- g.md <?grammar?>\n"}, 3, 8, "p.md"},
		"two stages":     {map[string]string{"p.md": "## A <?stage x?>\n## B <?stage x?>\n"}, 2, 6, "p.md"},
		"bad feature":    {map[string]string{"p.md": "# D <?features 9x?>\n## A <?stage x?>\n"}, 1, 5, "p.md"},
		"empty features": {map[string]string{"p.md": "# D <?features ?>\n## A <?stage x?>\n"}, 1, 5, "p.md"},
	}
	for name, c := range cases {
		_, err := LoadDialectSources(c.sources, "p.md")
		var e *Error
		if !errors.As(err, &e) {
			t.Errorf("%s: expected a *Error, got %v", name, err)
			continue
		}
		if e.Kind != ErrorGrammar || e.Document != c.doc || e.Line != c.line || e.Column != c.column || e.Error() == "" {
			t.Errorf("%s: unexpected error %#v", name, e)
		}
	}
}

func TestParseOptions(t *testing.T) {
	d := mustLoad(t, map[string]string{
		"p.md": "# D <?features base?>\n\n## One <?stage one?>\n\n- [g](g.md) <?grammar?>\n\n## Two <?stage two?>\n\n- [h](h.md) <?grammar?>\n",
		"g.md": "```ebnf\n%ambiguity-resolution greedy ;\ntext ≔ [w] ... ;\nw ≔ @base \"a\" <\"A\"> | @extra \"b\" <\"B\"> ⇒ this ;\n```\n",
		"h.md": "```ebnf\n%ambiguity-resolution greedy ;\ntext ≔ s | s B ; s ≔ A [B] ;\n```\n",
	})
	res, err := d.Parse("a", ParseOptions{})
	if err != nil || !res.OK || len(res.Stages) != 2 {
		t.Fatalf("%v %+v", err, res)
	}
	if res, _ := d.Parse("ab", ParseOptions{}); res.OK || res.Error.Kind != ErrorRejected || res.Error.Stage != "one" || *res.Error.Token != 1 || res.Error.Column != 2 {
		t.Fatalf("expected a rejection at b: %+v", res.Error)
	}
	res, _ = d.Parse("ab", ParseOptions{Features: []string{"extra"}})
	if !res.OK || res.Stages[1].Verdict != VerdictResolved {
		t.Fatalf("%+v", res.Error)
	}
	res, _ = d.Parse("ab", ParseOptions{Features: []string{"extra"}, ElisionOnly: boolPtr(true)})
	if res.OK || res.Error.Kind != ErrorAmbiguous || len(res.Error.Readings) != 2 || res.Tree != nil {
		t.Fatalf("expected elision-only to fail: %+v", res.Error)
	}
	// An ambiguous stage keeps its verdict and output, and the error has no
	// position (§7).
	if last := res.Stages[1]; last.Verdict != VerdictResolved || last.Output == nil || res.Error.Token != nil || res.Error.Source != nil || res.Error.Stage != "two" {
		t.Fatalf("the ambiguous stage lost its result: %+v %+v", last, res.Error)
	}
	res, err = d.Parse("ab", ParseOptions{Features: []string{"extra"}, Until: "one"})
	if err != nil || !res.OK || len(res.Stages) != 1 || res.Tree.Rule != "text" || len(res.Stages[0].Output) != 2 {
		t.Fatalf("%v %+v", err, res)
	}
	if _, err := d.Parse("a", ParseOptions{Until: "three"}); err == nil {
		t.Fatal("an unknown stage is not an error")
	} else if e, ok := err.(*Error); !ok || e.Kind != ErrorUsage {
		t.Fatalf("an unknown stage is %#v, not a usage error", err)
	}
	toks := []Token{{Text: "a", Tags: map[string]bool{"A": true}, Span: [2]int{0, 1}, Source: [2]int{0, 1}}}
	res, err = d.ParseTokens("a", toks, ParseOptions{Until: "one"})
	if err != nil || res.OK {
		t.Fatalf("pre-built tokens tagged A are not characters: %+v", res)
	}
}

func boolPtr(b bool) *bool { return &b }

// A words stage whose word is sa: auto features run the parse again with
// sa-su (engine §13).
func TestAutoFeatures(t *testing.T) {
	d := mustLoad(t, map[string]string{
		"p.md": "## Sounds <?stage sounds?>\n\n- [g](g.md) <?grammar?>\n\n## Words <?stage words?>\n\n- [h](h.md) <?grammar?>\n\n## Syntax <?stage syntax?>\n\n- [s](s.md) <?grammar?>\n",
		"g.md": "```ebnf\n%ambiguity-resolution greedy ;\ntext ≔ [c] ... ;\nc ≔ \"s\" </s/> | \"a\" </a/> | \"u\" </u/> | @sa-su \"x\" </x/> ⇒ this ;\n```\n",
		"h.md": "```ebnf\n%ambiguity-resolution lazy ;\ntext ≔ [word] ... ;\nword ≔ @!sa-su /s/ /a/ <\"W\"> | @sa-su /s/ /a/ <\"SA\"> | /u/ <\"W\"> | /x/ <\"W\"> ⇒ this ;\n```\n",
		"s.md": "```ebnf\n%ambiguity-resolution greedy ;\ntext ≔ [W | SA] ... ;\n```\n",
	})
	tags := func(res *ParseResult) string {
		var out []string
		for _, tok := range res.Stages[1].Output {
			for tag := range tok.Tags {
				out = append(out, tag)
			}
		}
		return strings.Join(out, " ")
	}
	res, _ := d.Parse("sa", ParseOptions{})
	if !res.OK || tags(res) != "SA" {
		t.Fatalf("auto features did not add sa-su: %q", tags(res))
	}
	res, _ = d.Parse("sa", ParseOptions{NoAutoFeatures: true})
	if !res.OK || tags(res) != "W" {
		t.Fatalf("sa-su was added with auto features off: %q", tags(res))
	}
	res, _ = d.Parse("u", ParseOptions{})
	if !res.OK || tags(res) != "W" {
		t.Fatalf("%q", tags(res))
	}
	// A probe that fails before words, for any reason, runs the parse again
	// with sa-su (§13).
	res, _ = d.Parse("x", ParseOptions{})
	if !res.OK || tags(res) != "W" {
		t.Fatalf("an earlier stage's rejection did not rerun with sa-su: %+v", res.Error)
	}
	// A run that stops before words does not probe.
	res, _ = d.Parse("sa", ParseOptions{Until: "sounds"})
	if !res.OK || len(res.Stages) != 1 {
		t.Fatalf("%+v", res)
	}
}

func TestMarshalResult(t *testing.T) {
	d := mustLoad(t, oneStage("%ambiguity-resolution greedy ;\n%elidable KU ;\ntext ≔ \"é\" [KU] ;"))
	res, _ := d.Parse("é", ParseOptions{})
	data, err := MarshalResult(res)
	if err != nil {
		t.Fatal(err)
	}
	want := `{"format":1,"ok":true,"stages":[{"name":"main","verdict":"unique","output":[]}],"tree":{"kind":"rule","rule":"text","span":[0,1],"source":[0,1],"tags":{},"children":[{"kind":"token","terminal":"é","token":0,"span":[0,1],"source":[0,1]},{"kind":"elided","terminal":"KU","span":[1,1],"source":[1,1]}]},"error":null}`
	if string(data) != want {
		t.Fatalf("got  %s\nwant %s", data, want)
	}
	if b := Brackets(res, BracketOptions{ShowElided: true}); b != "(é ⟨ku⟩)" {
		t.Fatalf("brackets %q", b)
	}
	if b := Brackets(res, BracketOptions{}); b != "é" {
		t.Fatalf("brackets %q", b)
	}
	res, _ = d.Parse("x", ParseOptions{})
	data, _ = MarshalResult(res)
	if !strings.HasPrefix(string(data), `{"format":1,"ok":false,"stages":[{"name":"main","verdict":null}],"tree":null,"error":{"kind":"rejected","stage":"main","token":0,"source":[0,1],"line":1,"column":1,"expected":[{"terminal":"é","rules":["text"]}],"message":`) {
		t.Fatalf("%s", data)
	}
}

func TestBracketsDepth(t *testing.T) {
	d := mustLoad(t, oneStage("%ambiguity-resolution greedy ;\ntext ≔ a a ; a ≔ \"x\" b ; b ≔ \"y\" c ; c ≔ \"z\" \"w\" ;"))
	res, _ := d.Parse("xyzwxyzw", ParseOptions{})
	if b := Brackets(res, BracketOptions{}); b != "([x {y (z w)}] [x {y (z w)}])" {
		t.Fatalf("brackets %q", b)
	}
}

// TestConcurrentParses shares one dialect among goroutines; run it with
// -race.
func TestConcurrentParses(t *testing.T) {
	d, err := LoadDialect("notation")
	if err != nil {
		t.Fatal(err)
	}
	texts := []string{"a ≔ A ;", "b ≔ [B] ... C & D ;", "c <\"X\"> ≔ $x(C) : text($x) = \"c\" ⇒ this ;", "%elidable KU ;"}
	want := make([]string, len(texts))
	for i, text := range texts {
		res, _ := d.Parse(text, ParseOptions{})
		data, _ := MarshalResult(res)
		want[i] = string(data)
	}
	var wg sync.WaitGroup
	errs := make(chan string, 64)
	for g := 0; g < 16; g++ {
		wg.Add(1)
		go func(g int) {
			defer wg.Done()
			for i := range texts {
				k := (i + g) % len(texts)
				res, err := d.Parse(texts[k], ParseOptions{Features: []string{"f" + string(rune('a'+g%4))}})
				if err != nil {
					errs <- err.Error()
					return
				}
				data, _ := MarshalResult(res)
				if string(data) != want[k] {
					errs <- "a concurrent parse differs"
				}
			}
		}(g)
	}
	wg.Wait()
	close(errs)
	for e := range errs {
		t.Fatal(e)
	}
}

// TestDeepDerivations parses long inputs whose derivations nest as deep as
// the input is long, to the left and, shorter since right recursion costs
// an Earley recognizer quadratic time, to the right.
func TestDeepDerivations(t *testing.T) {
	for _, c := range []struct {
		grammar string
		n       int
	}{
		{"text ≔ text \"a\" | \"a\" ;", 50000},
		{"text ≔ [w] ... ; w ≔ \"a\" ⇒ this ;", 50000},
		{"text ≔ \"a\" text | \"a\" ;", 1500},
	} {
		d := mustLoad(t, oneStage("%ambiguity-resolution greedy ;\n"+c.grammar))
		res, err := d.Parse(strings.Repeat("a", c.n), ParseOptions{})
		if err != nil || !res.OK {
			t.Fatalf("%s: %v %+v", c.grammar, err, res.Error)
		}
		data, _ := MarshalResult(res)
		if len(data) < c.n || len(Brackets(res, BracketOptions{})) < c.n {
			t.Fatalf("%s: the output is too short", c.grammar)
		}
	}
}

// Malformed precompiled DOMs: a bad compiled.json entry is a miss, read
// from the document instead, and a bad bootstrap is a load error; neither
// panics (review of PR #8).
func TestMalformedPrecompiled(t *testing.T) {
	loadBundled()
	sources := oneStage("%ambiguity-resolution greedy ;\ntext ≔ \"a\" \"b\" ;")
	gText := sources["g.md"]
	bad := []string{
		`{"seq":[]}`, `{"choice":[]}`, `{"and":[]}`, `{"seq":[null]}`, `{"optional":null}`,
		`{"repeat":{"ref":"A"},"min":5}`, `{"capture":"x","expr":{"seq":[{"ref":"A"},{"ref":"B"}]}}`,
		`{"ref":""}`, `{"what":1}`, `null`, `[]`,
	}
	// Terms the reader never builds, in an otherwise good alternative.
	badTags := []string{
		`{"call":"lowercase","args":[{"weak":"X"}]}`,
		`{"call":"lowercase","args":[{"emptySet":true}]}`,
		`{"call":"head","args":[{"literal":"x"}]}`,
		`{"union":[]}`,
	}
	for _, tags := range badTags {
		bad = append(bad, `{"seq":[{"terminal":"a"},{"terminal":"b"}]},"tags":`+tags)
	}
	for _, expr := range bad {
		dom := `{"format":1,"rules":[{"name":"text","op":"define","alternatives":[{"guards":[],"expr":` + expr + `}],"conditions":[],"at":[1,1]}],"directives":[{"name":"ambiguity-resolution","args":["greedy"],"at":[1,1]}]}`
		// In compiled.json, with every hash matching: a miss.
		src := map[string]string{}
		for k, v := range sources {
			src[k] = v
		}
		src["compiled.json"] = `{"format":1,"bootstrap":"` + bundled.reader.hash + `","documents":{"g.md":{"hash":"` + fnv1a64(gText) + `","dom":` + dom + `}}}`
		d, err := LoadDialectSources(src, "p.md")
		if err != nil {
			t.Fatalf("%s in compiled.json: %v", expr, err)
		}
		res, err := d.Parse("ab", ParseOptions{})
		if err != nil || !res.OK {
			t.Fatalf("%s in compiled.json: the document was not read instead: %v %+v", expr, err, res)
		}
		// In the bootstrap: a load error.
		src = map[string]string{}
		for k, v := range sources {
			src[k] = v
		}
		src["notation/bootstrap.json"] = `{"format":1,"stages":[{"name":"lexical","documents":[{"path":"notation/lexical.md","dom":` + dom + `}]}]}`
		_, err = LoadDialectSources(src, "p.md")
		var e *Error
		if !errors.As(err, &e) || e.Kind != ErrorGrammar {
			t.Fatalf("%s in the bootstrap: expected a load error, got %v", expr, err)
		}
	}
}

// Caller tokens whose source lies outside the text are a usage error, not
// a panic (review of PR #8).
func TestParseTokensOutOfRange(t *testing.T) {
	d := mustLoad(t, oneStage("%ambiguity-resolution greedy ;\ntext ≔ \"a\" ⇒ this ;"))
	for _, src := range [][2]int{{100, 101}, {1, 0}, {-1, 0}, {0, 2}} {
		toks := []Token{{Text: "a", Tags: map[string]bool{"a": true}, Span: [2]int{0, 1}, Source: src}}
		res, err := d.ParseTokens("a", toks, ParseOptions{})
		var e *Error
		if res != nil || !errors.As(err, &e) || e.Kind != ErrorUsage {
			t.Fatalf("source %v: expected a usage error, got %v %v", src, res, err)
		}
	}
	toks := []Token{
		{Text: "a", Tags: map[string]bool{"a": true}, Source: [2]int{2, 3}},
		{Text: "a", Tags: map[string]bool{"a": true}, Source: [2]int{0, 1}},
	}
	if _, err := d.ParseTokens("a a", toks, ParseOptions{}); err == nil {
		t.Fatal("tokens out of order were accepted")
	}
	toks = []Token{{Text: "a", Tags: map[string]bool{"a": true}, Span: [2]int{0, 1}, Source: [2]int{0, 1}}}
	if res, err := d.ParseTokens("a", toks, ParseOptions{}); err != nil || !res.OK {
		t.Fatalf("%v %+v", err, res)
	}
}

// An empty string is a terminal the reader produces, so a document with one
// loads, from its text and from its precompiled DOM (Codex's review).
func TestEmptyStringTerminal(t *testing.T) {
	for _, noCache := range []bool{true, false} {
		sources := oneStage("%ambiguity-resolution greedy ;\ntext ≔ \"\" | \"a\" ;")
		if !noCache {
			loadBundled()
			dom, err := bundled.reader.read(sources["g.md"], "g.md")
			if err != nil {
				t.Fatal(err)
			}
			sources["compiled.json"] = `{"format":1,"bootstrap":"` + bundled.reader.hash + `","documents":{"g.md":{"hash":"` + fnv1a64(sources["g.md"]) + `","dom":` + string(dom.json()) + `}}}`
			if _, err := decodeDOM(dom.json()); err != nil {
				t.Fatalf("the reader's DOM is refused: %v", err)
			}
		}
		d, err := loadSources(sources, "p.md", noCache)
		if err != nil {
			t.Fatalf("cache bypassed %v: %v", noCache, err)
		}
		res, err := d.Parse("a", ParseOptions{})
		if err != nil || !res.OK || Brackets(res, BracketOptions{}) != "a" {
			t.Fatalf("cache bypassed %v: %v %+v", noCache, err, res)
		}
	}
}
