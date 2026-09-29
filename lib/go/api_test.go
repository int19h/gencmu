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
	want := `{"format":4,"ok":true,"stages":[{"name":"main","verdict":"unique","output":[]}],"tree":{"kind":"rule","rule":"text","span":[0,1],"source":[0,1],"tags":[],"children":[{"kind":"token","terminal":"'é'","token":0,"span":[0,1],"source":[0,1]},{"kind":"elided","terminal":"KU","span":[1,1],"source":[1,1]}]},"error":null}`
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
	if !strings.HasPrefix(string(data), `{"format":4,"ok":false,"stages":[{"name":"main","verdict":null}],"tree":null,"error":{"kind":"rejected","stage":"main","token":0,"source":[0,1],"line":1,"column":1,"expected":[{"terminal":"'é'","rules":["text"]}],"message":`) {
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
	// "verbatim":true follows source, only on a verbatim token.
	d = mustLoad(t, oneStage("%ambiguity-resolution greedy\n%rule text w 'x'\n%rule w 'é'\n%emits $ <W>\n%verbatim"))
	res, _ = d.Parse("éx", ParseOptions{})
	data, _ = MarshalResult(res)
	if !strings.Contains(string(data), `"output":[{"text":"é","phonemes":"é","tags":["W"],"span":[0,1],"source":[0,1],"verbatim":true}]}`) {
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

// Brackets write each pause in a token's phonemes as a space; the token
// keeps its . (docs/output.md, "Brackets").
func TestBracketsPause(t *testing.T) {
	d := mustLoad(t, oneStage("%ambiguity-resolution greedy\n%rule text A A"))
	toks := []Token{{Text: "x", Tags: []string{"A"}, Phonemes: "a.b", Span: [2]int{0, 1}, Source: [2]int{0, 1}}, {Text: "y", Tags: []string{"A"}, Phonemes: "c", Span: [2]int{1, 2}, Source: [2]int{1, 2}}}
	res, err := d.ParseTokens("xy", toks, ParseOptions{})
	if err != nil || !res.OK {
		t.Fatalf("%v %+v", err, res)
	}
	if b := Brackets(res, BracketOptions{}); b != "(a b c)" {
		t.Fatalf("brackets %q", b)
	}
	if p := res.Stages[0].Input[0].Phonemes; p != "a.b" {
		t.Fatalf("the token's phonemes are %q", p)
	}
}

// runs() is the set of the runs between pauses (engine §5), each run
// whole: a run may hold a space, so {"a b", "c"} is not {"a", "b c"}.
func TestRunsKeepSpaces(t *testing.T) {
	d := mustLoad(t, oneStage("%ambiguity-resolution greedy\n%rule text $x(A) $y(A)\n%conditions runs($x) ≠ runs($y), \"a b\" ∈ runs($x), \"a\" ∉ runs($x)"))
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
		// Spellings the reader never writes: one with a backtick, and a
		// spelled node or symbol with a second kind of key.
		"{\"seq\":[{\"terminal\":\"a\"},{\"spelling\":\"b`c\",\"expr\":{\"terminal\":\"b\"}}]}",
		`{"seq":[{"terminal":"a"},{"spelling":"b","expr":{"empty":true,"ref":"B"}}]}`,
		`{"seq":[{"terminal":"a"},{"spelling":"b","expr":{"ref":"B","terminal":"b"}}]}`,
		`{"seq":[{"terminal":"a"},{"spelling":"b","expr":{"terminal":"b"},"empty":true}]}`,
		`{"seq":[{"terminal":"a"},{"capture":"x","expr":{"spelling":"b","expr":{"terminal":"b"},"ref":"B"}}]}`,
		// A top-level sequence that is also a spelled symbol.
		`{"seq":[{"terminal":"a"},{"terminal":"b"}],"spelling":"a","expr":{"terminal":"a"}}`,
		// Null where the DOM holds a string or a number, which Go would
		// otherwise read as "" or 0.
		`{"seq":[{"terminal":"a"},{"spelling":"b","expr":{"terminal":null}}]}`,
		`{"seq":[{"terminal":"a"},{"spelling":"b","expr":{"ref":null}}]}`,
		`{"seq":[{"terminal":"a"},{"spelling":null,"expr":{"terminal":"b"}}]}`,
		`{"seq":[{"terminal":null},{"terminal":"b"}]}`,
		`{"seq":[{"capture":null,"expr":{"terminal":"a"}},{"terminal":"b"}]}`,
		`{"seq":[{"terminal":"a"},{"repeat":{"terminal":"b"},"min":null}]}`,
		`{"seq":[{"terminal":"a"},{"terminal":"b"}]},"tags":{"tag":null}`,
	}
	// Terms the reader never builds, in an otherwise good alternative.
	badTags := []string{
		`{"call":"lowercase","args":[{"tag":"X"}]}`,
		`{"weak":"X"}`,
		`{"literal":"X"}`,
		`{"difference":[{"tag":"X"},{"tag":"Y"},{"tag":"Z"}]}`,
		`{"string":"X"}`,
		`{"call":"lowercase","args":[{"emptySet":true}]}`,
		`{"call":"head","args":[{"tag":"x"}]}`,
		`{"union":[]}`,
	}
	for _, tags := range badTags {
		bad = append(bad, `{"seq":[{"terminal":"a"},{"terminal":"b"}]},"tags":`+tags)
	}
	format := strconv.Itoa(domFormat)
	var doms []string
	for _, expr := range bad {
		doms = append(doms, `{"format":`+format+`,"rules":[{"name":"text","op":"define","alternatives":[{"guards":[],"expr":`+expr+`}],"conditions":[],"at":[1,1]}],"directives":[{"name":"ambiguity-resolution","args":["greedy"],"at":[2,1]}]}`)
	}
	// Null in the rest of the DOM, where the other libraries refuse it too.
	good := doms[0][:strings.Index(doms[0], `"expr":`)] + `"expr":{"seq":[{"terminal":"a"},{"terminal":"b"}]}}],"conditions":[],"at":[1,1]}],"directives":[{"name":"ambiguity-resolution","args":["greedy"],"at":[2,1]}]}`
	if _, err := decodeDOM([]byte(good), bundled.uni); err != nil {
		t.Fatalf("the DOM the null cases change is refused: %v", err)
	}
	for _, change := range [][2]string{
		{`"name":"text"`, `"name":null`}, {`"op":"define"`, `"op":null`}, {`"conditions":[]`, `"conditions":null`},
		{`"conditions":[],"at":[1,1]`, `"conditions":[],"at":[null,1]`}, {`"args":["greedy"]`, `"args":[null]`},
		{`"args":["greedy"],"at":[2,1]`, `"args":["greedy"],"at":[2,null]`}, {`"directives":[{`, `"directives":null,"x":[{`},
		{`"rules":[{`, `"rules":null,"x":[{`},
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
	dom := `{"format":` + strconv.Itoa(domFormat) + `,"rules":[{"name":"text","op":"define","alternatives":[{"guards":[],"expr":{"terminal":""}}],"conditions":[],"at":[1,1]}],"directives":[]}`
	if _, err := decodeDOM([]byte(dom), bundled.uni); err == nil {
		t.Fatal("a DOM with the terminal \"\" is accepted")
	}
}
