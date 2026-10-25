package gencmu

import (
	"strings"
	"testing"
)

// A written optional can block an earlier omission even when its later
// continuation fails. Capture expansion must keep that helper query (§4).
func TestCapturedOptionalQueryPriority(t *testing.T) {
	t.Parallel()
	for _, optional := range []string{"[b]", "[$b:b]"} {
		grammar := `%rule text $all:run
%conditions ¬$all.begins(r)
%rule run { _ }
%rule r "a" ` + optional + ` [+T] "u"
%rule b "u" "b"`
		d, err := caseDialect(&engineCase{Grammar: &grammar}, true)
		if err != nil {
			t.Fatal(err)
		}
		tokens := []InputToken{{Text: "a"}, {Text: "u"}, {Text: "b"}, {Text: "t", Tags: []string{"T"}}, {Text: "w"}}
		for i := range tokens {
			tokens[i].Span = [2]int{i, i + 1}
			tokens[i].Source = [2]int{i, i + 1}
		}
		result, err := d.ParseTokens("aubtw", tokens, ParseOptions{})
		if err != nil || !result.OK {
			t.Fatalf("%s: %v %v", optional, err, result.Error)
		}
	}
}

func TestStackedOmissionPredicates(t *testing.T) {
	t.Parallel()
	grammar := `%rule text [+T<U>="saved"] %emits`
	d, err := caseDialect(&engineCase{Grammar: &grammar}, true)
	if err != nil {
		t.Fatal(err)
	}
	result, err := d.Parse("", ParseOptions{})
	if err != nil || result.OK || result.Error.Kind != ErrorRejected {
		t.Fatalf("an omitted T lacks U: %v %+v", err, result)
	}
	value := "saved"
	result, err = d.ParseTokens("t", []InputToken{{Text: "t", Value: &value, Tags: []string{"T", "U"}, Span: [2]int{0, 1}, Source: [2]int{0, 1}}}, ParseOptions{})
	if err != nil || !result.OK {
		t.Fatalf("a written T carrying U passes both predicates: %v %+v", err, result)
	}
}

// Nil pointers default independently. Empty pointed-to strings are stored
// unchanged, and brackets use the image rather than the text or value.
func TestInputStringDefaults(t *testing.T) {
	t.Parallel()
	d := mustLoad(t, oneStage("%ambiguity-resolution greedy\n%rule text _ %emits $"))
	for _, c := range []struct {
		value, image         *string
		wantValue, wantImage string
	}{
		{nil, nil, "x", "x"},
		{stringPtr(""), nil, "", "x"},
		{nil, stringPtr(""), "x", ""},
		{stringPtr("A,b"), stringPtr("shown"), "A,b", "shown"},
	} {
		input := InputToken{Text: "x", Value: c.value, Image: c.image, Source: [2]int{0, 1}}
		res, err := d.ParseTokens("x", []InputToken{input}, ParseOptions{})
		if err != nil || !res.OK {
			t.Fatalf("%v %+v", err, res)
		}
		out := res.Stages[0].Output[0]
		if out.Value != c.wantValue || out.Image != c.wantImage || Brackets(res, BracketOptions{}) != c.wantImage {
			t.Fatalf("defaults: %+v, brackets %q", out, Brackets(res, BracketOptions{}))
		}
	}
}

// Comparisons and classifier keys retain case and punctuation. A scalar
// constant can also serve as a closed method argument without a user definition.
func TestExactStoredStrings(t *testing.T) {
	t.Parallel()
	d := mustLoad(t, oneStage(`%ambiguity-resolution greedy
%classifier lex
 "A,b" ∈ T
%rule text $x:_="A,b" :: $x.classify(lex)
%conditions "A" ∈ $x.split("‹U+002C›")
%emits $`))
	for _, v := range []string{"A,b", "a,b", "Ab", "ab"} {
		res, err := d.ParseTokens("x", []InputToken{{Text: "x", Value: stringPtr(v), Source: [2]int{0, 1}}}, ParseOptions{})
		if err != nil || res.OK != (v == "A,b") {
			t.Fatalf("%q: %v %+v", v, err, res)
		}
		if res.OK && (len(res.Tree.Tags) != 1 || res.Tree.Tags[0] != "T") {
			t.Fatalf("exact key: %v", res.Tree.Tags)
		}
	}
}

// An attachment cannot occur without its carrier in any expansion
// (engine §9). A capture from another branch cannot supply that carrier.
func TestAttachmentRequiresItsCarrier(t *testing.T) {
	t.Parallel()
	_, err := LoadDialectSources(oneStage(`%ambiguity-resolution greedy
%rule text r
%rule r $e:empty | $a:word
%emits $, $e ($a)
%rule empty ε
%rule word "x"`), "p.md")
	e, ok := err.(*Error)
	if !ok || e.Kind != ErrorGrammar || e.Document != "g.md" || e.Line != 6 || e.Column != 1 || !strings.Contains(e.Message, "attaches $a in a production without its carrier $e") {
		t.Fatalf("an attachment requires its carrier: %v", err)
	}
}
