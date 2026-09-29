package gencmu

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
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

// block is a jbogenbau block of the given lines.
func block(lines ...string) string {
	return "```jbogenbau\n" + strings.Join(lines, "\n") + "\n```\n"
}

func oneStage(grammar string) map[string]string {
	return map[string]string{
		"p.md": "# A dialect\n\n- [The grammar](g.md)\n  " + strings.ReplaceAll(block("%stage main", `%include "g.md"`), "\n", "\n  "),
		"g.md": "# A grammar\n\n```jbogenbau\n" + grammar + "\n```\n",
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
	res, err := d.Parse("%rule text A [B] ...", ParseOptions{})
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
	os.WriteFile(filepath.Join(dir, "dialects", "mine.md"), []byte(block("%stage main", `%include "../syntax/g.md"`)), 0o644)
	os.WriteFile(filepath.Join(dir, "syntax", "g.md"), []byte("```jbogenbau\n%ambiguity-resolution greedy\n%rule text 'a' ...\n```\n"), 0o644)
	d, err := LoadDialectFile(filepath.Join(dir, "dialects", "mine.md"))
	if err != nil {
		t.Fatal(err)
	}
	res, _ := d.Parse("aaa", ParseOptions{})
	if !res.OK || Brackets(res, BracketOptions{}) != "(a a a)" {
		t.Fatalf("%+v %q", res.Error, Brackets(res, BracketOptions{}))
	}
	os.WriteFile(filepath.Join(dir, "dialects", "broken.md"), []byte(block("%stage main", `%include "../syntax/missing.md"`)), 0o644)
	_, err = LoadDialectFile(filepath.Join(dir, "dialects", "broken.md"))
	var e *Error
	// At the %include, naming the document it did not find.
	if !errors.As(err, &e) || !strings.HasSuffix(e.Document, "dialects/broken.md") || e.Line != 3 || e.Column != 1 || !strings.Contains(e.Message, "syntax/missing.md") {
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
		"syntax":        {oneStage("%ambiguity-resolution greedy\n%rule text A ) B"), 5, 14, "g.md"},
		"keyword":       {oneStage("%ambiguity-resolution greedy\n%rule text A\n  %emit $"), 6, 3, "g.md"},
		"escape":        {oneStage("%ambiguity-resolution greedy\n%rule text '\\q'"), 5, 12, "g.md"},
		"undefined":     {oneStage("%ambiguity-resolution greedy\n%rule text nowhere"), 5, 1, "g.md"},
		"defined twice": {oneStage("%ambiguity-resolution greedy\n%rule text A\n%rule text B"), 6, 1, "g.md"},
		"definition":    {oneStage("%ambiguity-resolution greedy\n%rule text $a(A) | B\n%emits $a"), 5, 1, "g.md"},
		// The pipeline (engine §13): the errors of splicing, at the item.
		"missing":        {map[string]string{"p.md": block("%stage main", `%include "g.md"`)}, 3, 1, "p.md"},
		"cycle":          {map[string]string{"p.md": block("%stage main", `%include "a.md"`), "a.md": block(`%include "p.md"`)}, 2, 1, "a.md"},
		"two stages":     {map[string]string{"p.md": block("%stage x", "%ambiguity-resolution greedy", "%rule text A", "%stage x")}, 5, 1, "p.md"},
		"before a stage": {map[string]string{"p.md": block("%rule text A", "%stage x")}, 2, 1, "p.md"},
		"no rules":       {map[string]string{"p.md": block("%stage x", "%ambiguity-resolution greedy", "%stage y", "%ambiguity-resolution greedy", "%rule text A")}, 2, 1, "p.md"},
		"no stage":       {map[string]string{"p.md": block("%features f")}, 0, 0, "p.md"},
		// The operands of the directives, when the document is read.
		"include a name": {map[string]string{"p.md": block("%stage x", "%include g")}, 3, 1, "p.md"},
		"bad feature":    {map[string]string{"p.md": block("%features 9x", "%stage x")}, 2, 11, "p.md"},
		"empty features": {map[string]string{"p.md": block("%features", "%stage x")}, 2, 1, "p.md"},
		// At the rule of the guard that disagrees with the first (§13).
		"gate and warning": {oneStage("%ambiguity-resolution greedy\n%rule text f? A | B\n%rule a f! A"), 6, 1, "g.md"},
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
		"p.md": block("%features base", "%stage one", `%include "g.md"`, "%stage two", `%include "h.md"`),
		"g.md": "```jbogenbau\n%ambiguity-resolution greedy\n%rule text [w] ...\n%rule w base? 'a' <A> | extra? 'b' <B>\n%emits $\n```\n",
		"h.md": "```jbogenbau\n%ambiguity-resolution greedy\n%rule text s | s B\n%rule s A [B]\n```\n",
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
	toks := []Token{{Text: "a", Tags: []string{"A"}, Span: [2]int{0, 1}, Source: [2]int{0, 1}}}
	res, err = d.ParseTokens("a", toks, ParseOptions{Until: "one"})
	if err != nil || res.OK {
		t.Fatalf("pre-built tokens tagged A are not characters: %+v", res)
	}
}

func boolPtr(b bool) *bool { return &b }

// A trailing repetition that captures a part is an error of the grammar
// found at lowering, for the features that leave it alone in its rule: a
// result, not a load error (engine §3.3).
func TestLoweringFault(t *testing.T) {
	d := mustLoad(t, oneStage("%ambiguity-resolution greedy\n%rule text f? $a(A) B ... | ¬f? A B ..."))
	toks := []Token{{Text: "a", Tags: []string{"A"}, Span: [2]int{0, 1}, Source: [2]int{0, 1}}, {Text: "b", Tags: []string{"B"}, Span: [2]int{1, 2}, Source: [2]int{1, 2}}}
	res, err := d.ParseTokens("ab", toks, ParseOptions{Features: []string{"f"}})
	if err != nil || res.OK || res.Error.Kind != ErrorGrammar || res.Error.Stage != "main" || res.Stages[0].Verdict != "" || res.Tree != nil {
		t.Fatalf("expected a grammar error as the result: %v %+v", err, res)
	}
	if res, err := d.ParseTokens("ab", toks, ParseOptions{}); err != nil || !res.OK {
		t.Fatalf("without f the alternative with a capture is not alone: %v %+v", err, res)
	}
}

// A words stage whose word has the class SA: auto features run the parse
// again with sa-su (engine §13).
func TestAutoFeatures(t *testing.T) {
	d := mustLoad(t, map[string]string{
		"p.md": block("%stage sounds", `%include "g.md"`, "%stage words", `%include "h.md"`, "%stage syntax", `%include "s.md"`),
		"g.md": "```jbogenbau\n%ambiguity-resolution greedy\n%rule text [c] ...\n%rule c 's' </s/> | 'a' </a/> | 'u' </u/> | sa-su? 'x' </x/>\n%emits $\n```\n",
		"h.md": "```jbogenbau\n%ambiguity-resolution lazy\n%rule text [word] ...\n%rule word ¬sa-su? /s/ /a/ <SA> | sa-su? /s/ /a/ <E> | /u/ <W> | /x/ <W>\n%emits $\n```\n",
		"s.md": "```jbogenbau\n%ambiguity-resolution greedy\n%rule text [W | SA | E] ...\n```\n",
	})
	tags := func(res *ParseResult) string {
		var out []string
		for _, tok := range res.Stages[1].Output {
			for _, tag := range tok.Tags {
				out = append(out, tag)
			}
		}
		return strings.Join(out, " ")
	}
	res, _ := d.Parse("sa", ParseOptions{})
	if !res.OK || tags(res) != "E" {
		t.Fatalf("auto features did not add sa-su: %q", tags(res))
	}
	res, _ = d.Parse("sa", ParseOptions{NoAutoFeatures: true})
	if !res.OK || tags(res) != "SA" {
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

// Every bundled dialect with a words stage has sa-su as a gate, off by
// default, which auto features need (engine §13); a dialect's list of
// features is the caller's own copy.
func TestDialectFeatures(t *testing.T) {
	for _, name := range []string{"cll-ebnf", "bpfk", "experimental", "zantufa"} {
		d, err := LoadDialect(name)
		if err != nil {
			t.Fatal(err)
		}
		gate := false
		for _, f := range d.Features() {
			if f.Name == "sa-su" {
				gate = f.Kind == FeatureGate && !f.Default
			}
		}
		if !gate {
			t.Errorf("%s: sa-su is not a gate off by default: %+v", name, d.Features())
		}
	}
	d, err := LoadDialect("zantufa")
	if err != nil {
		t.Fatal(err)
	}
	features := d.Features()
	features[0] = Feature{Name: "changed"}
	if d.Features()[0].Name == "changed" {
		t.Fatal("changing the list changed the dialect's")
	}
	if d, _ := LoadDialect("notation"); d.Features() == nil || len(d.Features()) != 0 {
		t.Fatalf("the notation has features %#v", d.Features())
	}
}

func TestMarshalResult(t *testing.T) {
	d := mustLoad(t, oneStage("%ambiguity-resolution greedy\n%elidable KU\n%rule text 'é' [KU]"))
	res, _ := d.Parse("é", ParseOptions{})
	data, err := MarshalResult(res)
	if err != nil {
		t.Fatal(err)
	}
	want := `{"format":6,"ok":true,"stages":[{"name":"main","verdict":"unique","output":[]}],"tree":{"kind":"rule","rule":"text","span":[0,1],"source":[0,1],"tags":[],"children":[{"kind":"token","terminal":"'é'","token":0,"span":[0,1],"source":[0,1]},{"kind":"elided","terminal":"KU","span":[1,1],"source":[1,1]}]},"error":null}`
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
	if !strings.HasPrefix(string(data), `{"format":6,"ok":false,"stages":[{"name":"main","verdict":null}],"tree":null,"error":{"kind":"rejected","stage":"main","token":0,"source":[0,1],"line":1,"column":1,"expected":[{"terminal":"'é'","rules":["text"]}],"message":`) {
		t.Fatalf("%s", data)
	}
	// The warnings follow the error, only when there is one; the result's
	// list is empty, not nil, when there is none.
	d = mustLoad(t, oneStage("%ambiguity-resolution greedy\n%rule text w! 'é' 'x' | 'x'"))
	res, _ = d.Parse("éx", ParseOptions{})
	if data, _ = MarshalResult(res); res.Warnings == nil || len(res.Warnings) != 0 || strings.Contains(string(data), "warnings") {
		t.Fatalf("%#v %s", res.Warnings, data)
	}
	res, _ = d.Parse("éx", ParseOptions{Features: []string{"w"}})
	data, _ = MarshalResult(res)
	if !strings.HasSuffix(string(data), `,"error":null,"warnings":[{"stage":"main","feature":"w","rule":"text","span":[0,2],"source":[0,2]}]}`) {
		t.Fatalf("%s", data)
	}
	// "label" follows "phonemes" on every token. A foreign part sounds ?
	// and shows its text, and nothing marks it.
	d = mustLoad(t, oneStage("%ambiguity-resolution greedy\n%rule text w 'x'\n%rule w 'é'\n%emits $ <W>\n%foreign"))
	res, _ = d.Parse("éx", ParseOptions{})
	data, _ = MarshalResult(res)
	if !strings.Contains(string(data), `"output":[{"text":"é","phonemes":"?","label":"é","tags":["W"],"span":[0,1],"source":[0,1]}]}`) {
		t.Fatalf("%s", data)
	}
}

// A trailing repetition is one node of the tree, however many times it
// repeats, and gives its warnings once; the prefixes spliced into it and the
// helpers of [ ] and ... give none (engine §12).
func TestWarningsSpliced(t *testing.T) {
	for _, c := range []struct {
		grammar, text string
		want          []Warning
	}{
		{"%rule text w! a ['b'] ...\n%rule a v! 'a' ['c']", "acbbb", []Warning{
			{Stage: "main", Feature: "w", Rule: "text", Span: [2]int{0, 5}, Source: [2]int{0, 5}},
			{Stage: "main", Feature: "v", Rule: "a", Span: [2]int{0, 2}, Source: [2]int{0, 2}},
		}},
		{"%rule text w! a 'b' ...\n%rule a v! 'a' ['c']", "abb", []Warning{
			{Stage: "main", Feature: "w", Rule: "text", Span: [2]int{0, 3}, Source: [2]int{0, 3}},
			{Stage: "main", Feature: "v", Rule: "a", Span: [2]int{0, 1}, Source: [2]int{0, 1}},
		}},
		{"%rule text x | w! 'q'\n%rule x w! ['a'] ... 'b' | 'c'", "aab", []Warning{
			{Stage: "main", Feature: "w", Rule: "x", Span: [2]int{0, 3}, Source: [2]int{0, 3}},
		}},
	} {
		d := mustLoad(t, oneStage("%ambiguity-resolution greedy\n"+c.grammar))
		res, err := d.Parse(c.text, ParseOptions{Features: []string{"v", "w"}})
		if err != nil || !res.OK {
			t.Fatalf("%s: %v %+v", c.grammar, err, res)
		}
		if !reflect.DeepEqual(res.Warnings, c.want) {
			t.Errorf("%s: warnings %+v", c.grammar, res.Warnings)
		}
	}
}

func TestBracketsDepth(t *testing.T) {
	d := mustLoad(t, oneStage("%ambiguity-resolution greedy\n%rule text a a\n%rule a 'x' b\n%rule b 'y' c\n%rule c 'z' 'w'"))
	res, _ := d.Parse("xyzwxyzw", ParseOptions{})
	if b := Brackets(res, BracketOptions{}); b != "([x {y (z w)}] [x {y (z w)}])" {
		t.Fatalf("brackets %q", b)
	}
}

// Brackets show each token by its label (docs/output.md, "Brackets"). A
// token that a caller supplies has its text as its label, whatever its
// phonemes or its Label say, and keeps its phonemes (engine §5, docs/api.md).
// ParseTokens leaves the caller's tokens as they are.
func TestBracketsLabel(t *testing.T) {
	d := mustLoad(t, oneStage("%ambiguity-resolution greedy\n%rule text A A"))
	toks := []Token{{Text: "x", Tags: []string{"A"}, Phonemes: "a.b", Label: "z", Span: [2]int{0, 1}, Source: [2]int{0, 1}}, {Text: "y", Tags: []string{"A"}, Phonemes: "c", Span: [2]int{1, 2}, Source: [2]int{1, 2}}}
	res, err := d.ParseTokens("xy", toks, ParseOptions{})
	if err != nil || !res.OK {
		t.Fatalf("%v %+v", err, res)
	}
	if b := Brackets(res, BracketOptions{}); b != "(x y)" {
		t.Fatalf("brackets %q", b)
	}
	if in := res.Stages[0].Input[0]; in.Phonemes != "a.b" || in.Label != "x" {
		t.Fatalf("the token's phonemes are %q and its label %q", in.Phonemes, in.Label)
	}
	if toks[0].Label != "z" || toks[1].Label != "" {
		t.Fatalf("the caller's tokens changed: %+v", toks)
	}
}

// split(phonemes(s), ".") is the set of the runs between pauses (engine
// §10), each run whole: a run may hold a space, so {"a b", "c"} is not
// {"a", "b c"}.
func TestSplitKeepsSpaces(t *testing.T) {
	d := mustLoad(t, oneStage("%ambiguity-resolution greedy\n%const $RUNS \".\"\n%rule text $x(A) $y(A)\n%conditions split(phonemes($x), $RUNS) ≠ split(phonemes($y), \".\"), \"a b\" ∈ split(phonemes($x), $RUNS), \"a\" ∉ split(phonemes($x), \".\")"))
	toks := []Token{{Text: "x", Tags: []string{"A"}, Phonemes: "a b.c", Span: [2]int{0, 1}, Source: [2]int{0, 1}}, {Text: "y", Tags: []string{"A"}, Phonemes: "a.b c", Span: [2]int{1, 2}, Source: [2]int{1, 2}}}
	if res, err := d.ParseTokens("xy", toks, ParseOptions{}); err != nil || !res.OK {
		t.Fatalf("%v %+v", err, res)
	}
}

// TestConcurrentParses shares one dialect among goroutines; run it with
// -race.
func TestConcurrentParses(t *testing.T) {
	d, err := LoadDialect("notation")
	if err != nil {
		t.Fatal(err)
	}
	texts := []string{"%rule a A", "%rule b [B] ... C & D", "%rule c $x(C) %tags X %conditions text($x) = \"c\" ⟹ $x %emits $", "%elidable KU"}
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

// TestConcurrentFeatures shares one dialect among goroutines that turn
// gates and warnings on and off; run it with -race.
func TestConcurrentFeatures(t *testing.T) {
	d := mustLoad(t, map[string]string{
		"p.md": block("%features g", "%stage main", `%include "g.md"`),
		"g.md": "```jbogenbau\n%ambiguity-resolution greedy\n%rule text [item] ...\n%rule item g? w! 'a' | ¬g? 'a' <A> | v! 'b'\n```\n",
	})
	options := []ParseOptions{
		{}, {Features: []string{"w"}}, {Features: []string{"v", "w"}},
		{WithoutFeatures: []string{"g"}}, {Features: []string{"v", "w"}, WithoutFeatures: []string{"g"}},
	}
	counts := []int{0, 2, 4, 0, 2}
	want := make([]string, len(options))
	for i, o := range options {
		res, err := d.Parse("abab", o)
		if err != nil || !res.OK || len(res.Warnings) != counts[i] {
			t.Fatalf("%+v: %v %+v", o, err, res)
		}
		data, _ := MarshalResult(res)
		want[i] = string(data)
	}
	var wg sync.WaitGroup
	errs := make(chan string, 64)
	for g := 0; g < 16; g++ {
		wg.Add(1)
		go func(g int) {
			defer wg.Done()
			for i := range options {
				k := (i + g) % len(options)
				res, err := d.Parse("abab", options[k])
				if err != nil {
					errs <- err.Error()
					return
				}
				if data, _ := MarshalResult(res); string(data) != want[k] {
					errs <- "a concurrent parse differs"
				}
				if len(d.Features()) != 3 {
					errs <- "the dialect's features changed"
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

// TestConcurrentClassifiers shares one dialect among goroutines whose
// parses resolve its classifier for different features, one of which makes
// an entry an error of the grammar (engine §2); run it with -race.
func TestConcurrentClassifiers(t *testing.T) {
	d := mustLoad(t, map[string]string{
		"p.md": block("%stage main", `%include "g.md"`),
		"g.md": "```jbogenbau\n%ambiguity-resolution greedy\n%classifier lex\n  \"a\" ∈ A\n  f? \"a\" ∉ A\n  f? \"b\" ∈ A\n  g? \"a\" ∈ A\n" +
			"%implies A ⟹ ~m\n%rule text [item] ...\n%rule item $c(letter) <~i ∪ classify(text($c), lex)>\n%emits\n  $\n%rule letter 'a' | 'b'\n```\n",
	})
	options := []ParseOptions{{}, {Features: []string{"f"}}, {Features: []string{"g"}}, {Features: []string{"f", "g"}}}
	want := make([]string, len(options))
	for i, o := range options {
		res, err := d.Parse("ab", o)
		if err != nil {
			t.Fatal(err)
		}
		data, _ := MarshalResult(res)
		want[i] = string(data)
	}
	// With f, b is in A and a is not; with g alone, a is in A twice.
	if !strings.Contains(want[0], `"tags":["A","i","m"]`) || !strings.Contains(want[1], `"tags":["A","i","m"]`) ||
		!strings.Contains(want[2], `"kind":"grammar"`) || strings.Contains(want[3], `"kind":"grammar"`) {
		t.Fatalf("unexpected results:\n%s", strings.Join(want, "\n"))
	}
	var wg sync.WaitGroup
	errs := make(chan string, 64)
	for g := 0; g < 16; g++ {
		wg.Add(1)
		go func(g int) {
			defer wg.Done()
			for i := range options {
				k := (i + g) % len(options)
				res, err := d.Parse("ab", options[k])
				if err != nil {
					errs <- err.Error()
					return
				}
				if data, _ := MarshalResult(res); string(data) != want[k] {
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
		{"%rule text text 'a' | 'a'", 50000},
		{"%rule text [w] ...\n%rule w 'a'\n%emits $", 50000},
		{"%rule text 'a' text | 'a'", 1500},
	} {
		d := mustLoad(t, oneStage("%ambiguity-resolution greedy\n"+c.grammar))
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

// A bootstrap stage's name and a document's path are strings, and null is
// refused as the other libraries refuse it.
func TestBootstrapNulls(t *testing.T) {
	loadBundled()
	bootstrap := bundled.sources["notation/bootstrap.json"]
	for _, change := range [][2]string{{`"name":"lexical"`, `"name":null`}, {`"path":"notation/lexical.md"`, `"path":null`}} {
		if !strings.Contains(bootstrap, change[0]) {
			t.Fatalf("no %s in the bootstrap", change[0])
		}
		src := oneStage("%ambiguity-resolution greedy\n%rule text 'a' 'b'")
		src["notation/bootstrap.json"] = strings.Replace(bootstrap, change[0], change[1], 1)
		_, err := LoadDialectSources(src, "p.md")
		var e *Error
		if !errors.As(err, &e) || e.Kind != ErrorGrammar || e.Document != "notation/bootstrap.json" {
			t.Errorf("%s: expected an error of the bootstrap, got %v", change[1], err)
		}
	}
}

// Malformed precompiled DOMs: a bad compiled.json entry is a miss, read
// from the document instead, and a bad bootstrap is a load error; neither
// panics (review of PR #8).
func TestMalformedPrecompiled(t *testing.T) {
	loadBundled()
	sources := oneStage("%ambiguity-resolution greedy\n%rule text 'a' 'b'")
	gText := sources["g.md"]
	bad := []string{
		`{"seq":[]}`, `{"choice":[]}`, `{"and":[]}`, `{"seq":[null]}`, `{"optional":null}`,
		`{"repeat":{"ref":"A"},"min":5}`, `{"capture":"x","expr":{"seq":[{"ref":"A"},{"ref":"B"}]}}`,
		`{"ref":""}`, `{"what":1}`, `null`, `[]`,
		// Tests the reader never writes: a string with a comma, a value of
		// the wrong type, and a tested node or symbol with a second kind of
		// key.
		`{"seq":[{"terminal":"a"},{"test":"=","value":{"string":"b,c"},"expr":{"terminal":"b"}}]}`,
		`{"seq":[{"terminal":"a"},{"test":"=","value":{"tag":"B"},"expr":{"terminal":"b"}}]}`,
		`{"seq":[{"terminal":"a"},{"test":"⊇","value":{"string":"b"},"expr":{"terminal":"b"}}]}`,
		`{"seq":[{"terminal":"a"},{"test":"=","value":{"string":"b"},"expr":{"empty":true,"ref":"B"}}]}`,
		`{"seq":[{"terminal":"a"},{"test":"=","value":{"string":"b"},"expr":{"ref":"B","terminal":"b"}}]}`,
		`{"seq":[{"terminal":"a"},{"test":"=","value":{"string":"b"},"expr":{"terminal":"b"},"empty":true}]}`,
		`{"seq":[{"terminal":"a"},{"capture":"x","expr":{"test":"=","value":{"string":"b"},"expr":{"terminal":"b"},"ref":"B"}}]}`,
		// A top-level sequence that is also a tested symbol.
		`{"seq":[{"terminal":"a"},{"terminal":"b"}],"test":"=","value":{"string":"a"},"expr":{"terminal":"a"}}`,
		// Null where the DOM holds a string or a number, which Go would
		// otherwise read as "" or 0.
		`{"seq":[{"terminal":"a"},{"test":"=","value":{"string":"b"},"expr":{"terminal":null}}]}`,
		`{"seq":[{"terminal":"a"},{"test":"=","value":{"string":"b"},"expr":{"ref":null}}]}`,
		`{"seq":[{"terminal":"a"},{"test":null,"value":{"string":"b"},"expr":{"terminal":"b"}}]}`,
		`{"seq":[{"terminal":"a"},{"test":"=","value":{"string":null},"expr":{"terminal":"b"}}]}`,
		`{"seq":[{"terminal":null},{"terminal":"b"}]}`,
		`{"seq":[{"capture":null,"expr":{"terminal":"a"}},{"terminal":"b"}]}`,
		`{"seq":[{"terminal":"a"},{"repeat":{"terminal":"b"},"min":null}]}`,
		`{"seq":[{"terminal":"a"},{"terminal":"b"}]},"tags":{"tag":null}`,
	}
	// Terms the reader never builds, in an otherwise good alternative.
	badTags := []string{
		`{"call":"lowercase","args":[{"string":"X"}]}`,
		`{"call":"tag","args":[{"tag":"X"}]}`,
		`{"call":"tag","args":[{"string":"not a name"}]}`,
		`{"const":"x","at":[1,1]}`,
		`{"const":"X"}`,
		`{"weak":"X"}`,
		`{"literal":"X"}`,
		`{"difference":[{"tag":"X"},{"tag":"Y"},{"tag":"Z"}]}`,
		`{"string":"X"}`,
		`{"call":"tag","args":[{"emptySet":true}]}`,
		`{"call":"head","args":[{"tag":"x"}]}`,
		`{"union":[]}`,
		// A term has exactly the members of one form, in either order.
		`{"tag":"T","string":"b"}`,
		`{"string":"b","tag":"T"}`,
		`{"tag":"!","string":"x"}`,
		`{"string":"x","tag":"!"}`,
		`{"difference":[{"tag":"X"},{"tag":"Y"}],"union":[{"tag":"X"},{"tag":"Y"}]}`,
		`{"union":[{"tag":"X"},{"tag":"Y"}],"difference":[{"tag":"X"},{"tag":"Y"}]}`,
		`{"difference":[{"tag":"X"},{"tag":"Y"}],"intersection":[{"tag":"X"},{"tag":"Y"}]}`,
		`{"difference":[{"tag":"X"},{"tag":"Y"}],"tag":"X"}`,
		`{"tag":"X","difference":[{"tag":"X"},{"tag":"Y"}]}`,
		`{"difference":[{"tag":"X"}]}`,
		`{"call":"tags","args":[{"call":"head","args":[{"capture":""}],"tag":"X"}]}`,
		`{"if":{"captured":""},"then":{"tag":"X"},"tag":"X"}`,
	}
	for _, tags := range badTags {
		bad = append(bad, `{"seq":[{"terminal":"a"},{"terminal":"b"}]},"tags":`+tags)
	}
	format := strconv.Itoa(domFormat)
	var doms []string
	for _, expr := range bad {
		doms = append(doms, `{"format":`+format+`,"rules":[{"name":"text","op":"define","alternatives":[{"guards":[],"expr":`+expr+`}],"conditions":[],"at":[1,1]}],"directives":[{"name":"ambiguity-resolution","args":["greedy"],"at":[2,1]}],"constants":[],"classifiers":[],"implications":[]}`)
	}
	// Null in the rest of the DOM, where the other libraries refuse it too.
	good := doms[0][:strings.Index(doms[0], `"expr":`)] + `"expr":{"seq":[{"terminal":"a"},{"terminal":"b"}]}}],"conditions":[],"at":[1,1]}],"directives":[{"name":"ambiguity-resolution","args":["greedy"],"at":[2,1]}],"constants":[{"name":"K","op":"define","value":{"tag":"X"},"at":[3,1]}],"classifiers":[],"implications":[]}`
	if _, err := decodeDOM([]byte(good), bundled.uni); err != nil {
		t.Fatalf("the DOM the null cases change is refused: %v", err)
	}
	for _, change := range [][2]string{
		{`"name":"text"`, `"name":null`}, {`"op":"define"`, `"op":null`}, {`"conditions":[]`, `"conditions":null`},
		{`"conditions":[],"at":[1,1]`, `"conditions":[],"at":[null,1]`}, {`"args":["greedy"]`, `"args":[null]`},
		{`"args":["greedy"],"at":[2,1]`, `"args":["greedy"],"at":[2,null]`}, {`"directives":[{`, `"directives":null,"x":[{`},
		{`"rules":[{`, `"rules":null,"x":[{`}, {`"constants":[{`, `"constants":null,"x":[{`},
		{`"name":"K"`, `"name":null`}, {`"op":"define","value"`, `"op":null,"value"`}, {`"value":{"tag":"X"}`, `"value":null`},
		{`"value":{"tag":"X"},"at":[3,1]`, `"value":{"tag":"X"},"at":[3,null]`},
	} {
		if !strings.Contains(good, change[0]) {
			t.Fatalf("no %s in %s", change[0], good)
		}
		doms = append(doms, strings.Replace(good, change[0], change[1], 1))
	}
	for _, dom := range doms {
		expr := dom
		if _, err := decodeDOM([]byte(dom), bundled.uni); err == nil {
			t.Fatalf("a malformed DOM decodes: %s", dom)
		}
		// In compiled.json, with every hash matching: a miss.
		src := map[string]string{}
		for k, v := range sources {
			src[k] = v
		}
		src["compiled.json"] = `{"format":` + format + `,"bootstrap":"` + bundled.reader.hash + `","documents":{"g.md":{"hash":"` + fnv1a64(gText) + `","dom":` + dom + `}}}`
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
		src["notation/bootstrap.json"] = `{"format":` + format + `,"stages":[{"name":"lexical","documents":[{"path":"notation/lexical.md","dom":` + dom + `}]}]}`
		_, err = LoadDialectSources(src, "p.md")
		var e *Error
		if !errors.As(err, &e) || e.Kind != ErrorGrammar {
			t.Fatalf("%s in the bootstrap: expected a load error, got %v", expr, err)
		}
	}
}

// Malformed range and property nodes take the whole loading path: in
// compiled.json each is a miss, read from the document instead, and in the
// bootstrap each is an error of the bootstrap (engine §9). Each keeps the
// range 'b'..'c' first, so an entry used by mistake would reject "ab".
func TestMalformedCharacterClasses(t *testing.T) {
	loadBundled()
	sources := oneStage("%ambiguity-resolution greedy\n%rule text 'a'..'z' '\\p{L}'")
	gText := sources["g.md"]
	format := strconv.Itoa(domFormat)
	dom := func(expr string) string {
		return `{"format":` + format + `,"rules":[{"name":"text","op":"define","alternatives":[{"guards":[],"expr":` + expr + `}],"conditions":[],"at":[3,1]}],"directives":[{"name":"ambiguity-resolution","args":["greedy"],"at":[2,1]}],"constants":[],"classifiers":[],"implications":[]}`
	}
	compiled := func(dom string) map[string]string {
		src := map[string]string{}
		for k, v := range sources {
			src[k] = v
		}
		src["compiled.json"] = `{"format":` + format + `,"bootstrap":"` + bundled.reader.hash + `","documents":{"g.md":{"hash":"` + fnv1a64(gText) + `","dom":` + dom + `}}}`
		return src
	}
	bootstrap := func(dom string) error {
		src := map[string]string{}
		for k, v := range sources {
			src[k] = v
		}
		src["notation/bootstrap.json"] = `{"format":` + format + `,"stages":[{"name":"lexical","documents":[{"path":"notation/lexical.md","dom":` + dom + `}]}]}`
		_, err := LoadDialectSources(src, "p.md")
		return err
	}
	parse := func(src map[string]string) bool {
		d, err := LoadDialectSources(src, "p.md")
		if err != nil {
			t.Fatal(err)
		}
		res, err := d.Parse("ab", ParseOptions{NoAutoFeatures: true})
		if err != nil {
			t.Fatal(err)
		}
		return res.OK
	}
	// The control: a well-formed entry is used, and rejects "ab"; in the
	// bootstrap, it is read, and its notation then fails on g.md.
	control := dom(`{"seq":[{"range":["'b'","'c'"]},{"property":"L"}]}`)
	if parse(compiled(control)) {
		t.Fatal("the well-formed entry was not used")
	}
	var e *Error
	if err := bootstrap(control); !errors.As(err, &e) || e.Document == "notation/bootstrap.json" {
		t.Fatalf("the well-formed bootstrap was refused: %v", err)
	}
	for _, expr := range []string{
		`{"seq":[{"range":["'c'","'b'"]},{"property":"L"}]}`,
		`{"seq":[{"range":["'\\u{62}'","'c'"]},{"property":"L"}]}`,
		`{"seq":[{"range":["'b'","'c'"]},{"property":"Bogus"}]}`,
		`{"seq":[{"range":["'b'","'c'"]},{"property":"L"}]},"tags":{"property":"L"}`,
		// A range or a property beside a sequence, which is checked before
		// the sequence is split.
		`{"seq":[{"range":["'b'","'c'"]},{"property":"L"}],"range":["'z'","'a'"]}`,
		`{"seq":[{"range":["'b'","'c'"]},{"property":"L"}],"range":["'a'","'z'"]}`,
		`{"seq":[{"range":["'b'","'c'"]},{"property":"L"}],"property":"Bogus"}`,
		`{"seq":[{"range":["'b'","'c'"]},{"property":"L"}],"property":"L"}`,
	} {
		d := dom(expr)
		if _, err := decodeDOM([]byte(d), bundled.uni); err == nil {
			t.Errorf("a malformed DOM decodes: %s", expr)
		}
		if !parse(compiled(d)) {
			t.Errorf("%s in compiled.json: the document was not read instead", expr)
		}
		if err := bootstrap(d); !errors.As(err, &e) || e.Kind != ErrorGrammar || e.Document != "notation/bootstrap.json" {
			t.Errorf("%s in the bootstrap: expected an error of the bootstrap, got %v", expr, err)
		}
	}
}

// Caller tokens whose source lies outside the text are a usage error, not
// a panic (review of PR #8).
func TestParseTokensOutOfRange(t *testing.T) {
	d := mustLoad(t, oneStage("%ambiguity-resolution greedy\n%rule text 'a'\n%emits $"))
	for _, src := range [][2]int{{100, 101}, {1, 0}, {-1, 0}, {0, 2}} {
		toks := []Token{{Text: "a", Tags: []string{"'a'"}, Span: [2]int{0, 1}, Source: src}}
		res, err := d.ParseTokens("a", toks, ParseOptions{})
		var e *Error
		if res != nil || !errors.As(err, &e) || e.Kind != ErrorUsage {
			t.Fatalf("source %v: expected a usage error, got %v %v", src, res, err)
		}
	}
	toks := []Token{
		{Text: "a", Tags: []string{"'a'"}, Source: [2]int{2, 3}},
		{Text: "a", Tags: []string{"'a'"}, Source: [2]int{0, 1}},
	}
	if _, err := d.ParseTokens("a a", toks, ParseOptions{}); err == nil {
		t.Fatal("tokens out of order were accepted")
	}
	toks = []Token{{Text: "a", Tags: []string{"'a'"}, Span: [2]int{0, 1}, Source: [2]int{0, 1}}}
	if res, err := d.ParseTokens("a", toks, ParseOptions{}); err != nil || !res.OK {
		t.Fatalf("%v %+v", err, res)
	}
}

// A text or a document that is not valid UTF-8 is no sequence of scalar
// values, so it is a usage error, refused before any character token
// (engine §1). "\xed\xa0\x80" encodes the surrogate U+D800.
func TestInvalidUTF8(t *testing.T) {
	isUsage := func(err error) bool {
		var e *Error
		return errors.As(err, &e) && e.Kind == ErrorUsage
	}
	// Each of these would read U+FFFD or U+D800 if the text became tokens.
	rules := []string{`'\p{Cs}'`, `'\p{Any}'`, `'\u{D7FF}'..'\u{E000}'`, `'\u{FFFD}'`, "[character] ...\n%rule character '\\p{Any}'"}
	for _, rule := range rules {
		d := mustLoad(t, oneStage("%ambiguity-resolution greedy\n%rule text "+rule))
		for _, text := range []string{"\xed\xa0\x80", "a\xff", "\xc3", "\xf4\x90\x80\x80", "\xe2\x82"} {
			if res, err := d.Parse(text, ParseOptions{NoAutoFeatures: true}); res != nil || !isUsage(err) {
				t.Errorf("%s over %q: expected a usage error, got %v %v", rule, text, res, err)
			}
			if res, err := d.ParseTokens(text, nil, ParseOptions{NoAutoFeatures: true}); res != nil || !isUsage(err) {
				t.Errorf("%s over %q with tokens: expected a usage error, got %v %v", rule, text, res, err)
			}
		}
	}
	d := mustLoad(t, oneStage("%ambiguity-resolution greedy\n%rule text '\\p{Any}'"))
	if res, err := d.Parse("\U0001F600", ParseOptions{NoAutoFeatures: true}); err != nil || !res.OK {
		t.Errorf("a valid text: %v %+v", err, res)
	}
	_, err := LoadDialectSources(oneStage("%ambiguity-resolution greedy\n%rule text '\xed\xa0\x80'"), "p.md")
	var e *Error
	if !errors.As(err, &e) || e.Kind != ErrorUsage || e.Document != "g.md" {
		t.Errorf("a document that is not valid UTF-8: %v", err)
	}
}

// A grammar document read from disk is strict UTF-8 (engine §1): bytes that
// do not decode are a grammar error of that document, with no line or
// column, found before any hash or compiled DOM. U+FFFD, supplementary
// characters and a byte order mark decode as themselves.
func TestFileUTF8(t *testing.T) {
	const pipeline = "# A dialect\n\n```jbogenbau\n%stage main\n%include \"g.md\"\n```\n"
	grammar := func(rule string) string {
		return "# A grammar\n\n```jbogenbau\n%ambiguity-resolution greedy\n" + rule + "\n```\n"
	}
	dir := func(files map[string]string) string {
		root := t.TempDir()
		for name, text := range files {
			if err := os.WriteFile(filepath.Join(root, name), []byte(text), 0o644); err != nil {
				t.Fatal(err)
			}
		}
		return root
	}
	// A stray continuation, a truncated sequence, an overlong form, an
	// encoded surrogate and a value above U+10FFFF.
	invalid := []string{"\x80", "\xe2\x82", "\xc0\xaf", "\xed\xa0\x80", "\xf4\x90\x80\x80", "\xff"}
	good := grammar("%rule text 'a'")
	places := []struct {
		place string
		files func(b string) map[string]string
		bad   string
	}{
		{"the pipeline's prose", func(b string) map[string]string {
			return map[string]string{"p.md": "# A dialect " + b + "\n\n" + pipeline, "g.md": good}
		}, "p.md"},
		{"a comment of the pipeline", func(b string) map[string]string {
			return map[string]string{"p.md": strings.Replace(pipeline, "%stage main", "%stage main (* "+b+" *)", 1), "g.md": good}
		}, "p.md"},
		{"an included document's prose", func(b string) map[string]string {
			return map[string]string{"p.md": pipeline, "g.md": "# A grammar " + b + "\n\n" + good}
		}, "g.md"},
		{"a comment of an included document", func(b string) map[string]string {
			return map[string]string{"p.md": pipeline, "g.md": grammar("%rule text 'a' (* " + b + " *)")}
		}, "g.md"},
	}
	for _, p := range places {
		for _, b := range invalid {
			root := dir(p.files(b))
			_, err := LoadDialectFile(filepath.Join(root, "p.md"))
			var e *Error
			if !errors.As(err, &e) || e.Kind != ErrorGrammar || !strings.HasSuffix(e.Document, "/"+p.bad) ||
				!strings.Contains(e.Message, "not valid UTF-8") || e.Line != 0 || e.Column != 0 {
				t.Errorf("%s, %q: expected a grammar error of %s, got %#v", p.place, b, p.bad, err)
			}
		}
	}
	root := dir(map[string]string{
		"p.md": "# A dialect \uFFFD \U0001F600\n\n" + pipeline,
		"g.md": grammar("%rule text '\uFFFD' '\U0001F600' '\U0010FFFD' (* \uFFFD \U0001F600 *)"),
	})
	d, err := LoadDialectFile(filepath.Join(root, "p.md"))
	if err != nil {
		t.Fatal(err)
	}
	for text, want := range map[string]bool{"\uFFFD\U0001F600\U0010FFFD": true, "\uFFFD\U0001F600": false} {
		if res, err := d.Parse(text, ParseOptions{NoAutoFeatures: true}); err != nil || res.OK != want {
			t.Errorf("%q: %v %+v", text, err, res)
		}
	}
	// A byte order mark stays U+FEFF, so a fence after it opens no block.
	marked := dir(map[string]string{"p.md": "\uFEFF" + pipeline[strings.Index(pipeline, "```"):], "g.md": good})
	if _, err := LoadDialectFile(filepath.Join(marked, "p.md")); err == nil || !strings.Contains(err.Error(), "at least one %stage") {
		t.Errorf("a fence after a byte order mark: %v", err)
	}
	prose := dir(map[string]string{"p.md": "\uFEFF" + pipeline, "g.md": grammar("%rule text '\uFEFF'")})
	d, err = LoadDialectFile(filepath.Join(prose, "p.md"))
	if err != nil {
		t.Fatal(err)
	}
	if res, err := d.Parse("\uFEFF", ParseOptions{NoAutoFeatures: true}); err != nil || !res.OK {
		t.Errorf("a byte order mark in a character tag: %v %+v", err, res)
	}
}

// A character tag holds exactly one character, so an empty one is an error
// of the document, and a precompiled DOM with the terminal "" is refused
// (engine §1, §9).
func TestEmptyCharacterTag(t *testing.T) {
	_, err := loadSources(oneStage("%ambiguity-resolution greedy\n%rule text '' | 'a'"), "p.md", true)
	var e *Error
	if !errors.As(err, &e) || e.Kind != ErrorGrammar || e.Line != 5 || e.Column != 12 {
		t.Fatalf("expected an error at 5:12, got %v", err)
	}
	loadBundled()
	dom := `{"format":` + strconv.Itoa(domFormat) + `,"rules":[{"name":"text","op":"define","alternatives":[{"guards":[],"expr":{"terminal":""}}],"conditions":[],"at":[1,1]}],"directives":[],"constants":[],"classifiers":[],"implications":[]}`
	if _, err := decodeDOM([]byte(dom), bundled.uni); err == nil {
		t.Fatal("a DOM with the terminal \"\" is accepted")
	}
}

// A defect of a grammar found while parsing is an error with the stage and
// no position (engine §13, docs/output.md): two phoneme tags on a token that
// a constituent emits, on a token over a foreign part and on an inserted
// one, a token with no tags, and a condition that asks about its own span.
func TestGrammarFaultHasNoPosition(t *testing.T) {
	const twoPhonemes = "stage main: an emitted token has two phoneme tags"
	for _, c := range []struct{ grammar, message string }{
		{"%implies A ⟹ /o/\n%rule text [word] ...\n%rule word $w(W) <A ∪ /e/>\n%emits\n  $", twoPhonemes},
		{"%rule text [word] ...\n%rule word $w(W) </e/ ∪ /o/>\n%emits\n  $\n%foreign", twoPhonemes},
		{"%implies /e/ ⟹ /o/\n%rule text [word] ...\n%rule word $w(W)\n%emits\n  $w, /e/", twoPhonemes},
		{"%rule text $a(W) %emits $a <tags($a) ∩ Z>", "stage main: text emits a token with no tags"},
		{"%rule text $a(x) %conditions ¬matches($a, text)\n%rule x W",
			"stage main: a condition asks whether its own span parses as text, which defines text in terms of itself over the same text"},
		{"%rule text $a(x) %conditions ¬begins(from($a), text)\n%rule x W",
			"stage main: a condition asks whether its own span parses as text, which defines text in terms of itself over the same text"},
	} {
		d, err := LoadDialectSources(oneStage("%ambiguity-resolution greedy\n"+c.grammar), "p.md")
		if err != nil {
			t.Fatalf("%s: %v", c.grammar, err)
		}
		res, err := d.ParseTokens("x", []Token{{Text: "x", Tags: []string{"W"}, Phonemes: "x", Span: [2]int{0, 1}, Source: [2]int{0, 1}}}, ParseOptions{})
		if err != nil {
			t.Fatalf("%s: %v", c.grammar, err)
		}
		if res.OK || res.Error == nil || res.Error.Kind != ErrorGrammar || res.Error.Stage != "main" {
			t.Fatalf("%s: expected an error of the grammar in the stage main, got %+v", c.grammar, res.Error)
		}
		if res.Error.Message != c.message {
			t.Errorf("%s: expected the message %q, with no position, got %q", c.grammar, c.message, res.Error.Message)
		}
		if res.Error.Token != nil || res.Error.Source != nil || res.Error.Line != 0 || res.Error.Column != 0 {
			t.Errorf("%s: expected no position, got %+v", c.grammar, res.Error)
		}
	}
}

// A caller cannot supply attachments: a token with a non-empty Before or
// After is a usage error, and empty ones are accepted and dropped. The
// caller's tokens stay as they are (docs/api.md).
func TestCallerAttachments(t *testing.T) {
	d := mustLoad(t, oneStage("%ambiguity-resolution greedy\n%rule text A"))
	inner := []Token{{Text: "i", Tags: []string{"I"}, Source: [2]int{0, 1}}}
	for _, tok := range []Token{
		{Text: "a", Tags: []string{"A"}, Span: [2]int{0, 1}, Source: [2]int{0, 1}, After: inner},
		{Text: "a", Tags: []string{"A"}, Span: [2]int{0, 1}, Source: [2]int{0, 1}, Before: inner},
	} {
		res, err := d.ParseTokens("a", []Token{tok}, ParseOptions{})
		var e *Error
		if res != nil || !errors.As(err, &e) || e.Kind != ErrorUsage {
			t.Fatalf("expected a usage error, got %v %v", res, err)
		}
	}
	toks := []Token{{Text: "a", Tags: []string{"A"}, Span: [2]int{0, 1}, Source: [2]int{0, 1}, Before: []Token{}, After: []Token{}}}
	res, err := d.ParseTokens("a", toks, ParseOptions{})
	if err != nil || !res.OK {
		t.Fatalf("%v %+v", err, res)
	}
	if in := res.Stages[0].Input[0]; in.Before != nil || in.After != nil {
		t.Fatalf("the empty attachments were kept: %+v", in)
	}
	if toks[0].Before == nil || toks[0].After == nil {
		t.Fatalf("the caller's tokens changed: %+v", toks)
	}
}

// The brackets show a token with attachments as a group of its
// before-attachments, its label and its after-attachments, and the
// canonical JSON writes an attached token without its span
// (docs/output.md).
func TestAttachmentsRendered(t *testing.T) {
	d, err := LoadDialect("cll-ebnf")
	if err != nil {
		t.Fatal(err)
	}
	for text, want := range map[string]string{
		"mi ui klama":     "([mi ui] klama)",
		"ba'e mi klama":   "([ba'e mi] klama)",
		"mi ui nai klama": "([mi {ui nai}] klama)",
	} {
		res, err := d.Parse(text, ParseOptions{})
		if err != nil || !res.OK {
			t.Fatalf("%s: %v %+v", text, err, res.Error)
		}
		if b := Brackets(res, BracketOptions{}); b != want {
			t.Errorf("%s: brackets %q, not %q", text, b, want)
		}
	}
	res, _ := d.Parse("mi ui nai klama", ParseOptions{})
	data, _ := MarshalResult(res)
	want := `"span":[0,1],"source":[0,2],"after":[{"text":"ui","phonemes":"ui","label":"ui","tags":["UI","cmavo","continued","indicator","run-final","run-initial","word"],"source":[3,5],"after":[{"text":"nai","phonemes":"nai","label":"nai","tags":["NAI","cmavo","continued","onset","run-final","run-initial","word"],"source":[6,9]}]}]}`
	if !strings.Contains(string(data), want) {
		t.Fatalf("no token %s in\n%s", want, data)
	}
}

// Within one item, the before-attachments come before the carrier's tag
// term, so of two errors the attachment's ends the emission (engine §11).
func TestAttachmentErrorOrder(t *testing.T) {
	c := loadCase(t, "../../tests/engine/attach-error-order.json")
	d, err := caseDialect(c, false)
	if err != nil {
		t.Fatal(err)
	}
	res, err := runCase(d, c, &c.Options)
	if err != nil || res.Error == nil || !strings.Contains(res.Error.Message, "two phoneme tags") {
		t.Fatalf("%v %+v", err, res)
	}
}

// An inserted token is made when its item's turn comes, so the error of an
// earlier item's attachment comes before the inserted token's (engine §11).
func TestInsertedAfterAttachmentErrorOrder(t *testing.T) {
	c := loadCase(t, "../../tests/engine/attach-error-insert-order.json")
	d, err := caseDialect(c, false)
	if err != nil {
		t.Fatal(err)
	}
	res, err := runCase(d, c, &c.Options)
	if err != nil || res.Error == nil || !strings.Contains(res.Error.Message, `tag("?")`) {
		t.Fatalf("%v %+v", err, res.Error)
	}
}
