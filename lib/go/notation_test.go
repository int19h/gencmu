package gencmu

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"testing"
)

func domValue(t testing.TB, d *domDoc) any {
	v, err := decodeJSON(d.json())
	if err != nil {
		t.Fatalf("the DOM's JSON does not parse: %v", err)
	}
	return v
}

type notationCase struct {
	Description string `json:"description"`
	CacheMisses bool   `json:"cacheMisses"`
	Document    string `json:"document"`
	Expect      struct {
		Dom   *any `json:"dom"`
		Error *struct {
			Line    int     `json:"line"`
			Column  int     `json:"column"`
			Message *string `json:"message"`
		} `json:"error"`
	} `json:"expect"`
}

func decodeNotationCase(data []byte) (*notationCase, error) {
	c := &notationCase{}
	raw, err := decodeJSON(data)
	if err != nil {
		return nil, err
	}
	if err := notationCaseSchema(raw); err != nil {
		return nil, err
	}
	err = unmarshalJSON(data, c)
	return c, err
}

func TestNotationCases(t *testing.T) {
	t.Parallel()
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	files, _ := filepath.Glob("../../tests/notation/*.json")
	if len(files) == 0 {
		t.Fatal("no notation cases in ../../tests/notation")
	}
	for _, f := range files {
		data, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		c, err := decodeNotationCase(data)
		if err != nil {
			t.Fatal(err)
		}
		t.Run(strings.TrimSuffix(filepath.Base(f), ".json"), func(t *testing.T) {
			t.Parallel()
			dom, rerr := bundled.reader.read(c.Document, "case.md")
			if c.Expect.Error != nil {
				if rerr == nil {
					t.Fatalf("%s\nexpected an error at %d:%d, got %s", c.Description, c.Expect.Error.Line, c.Expect.Error.Column, dom.json())
				}
				if rerr.Line != c.Expect.Error.Line || rerr.Column != c.Expect.Error.Column {
					t.Fatalf("%s\nexpected an error at %d:%d, got %v", c.Description, c.Expect.Error.Line, c.Expect.Error.Column, rerr)
				}
				if c.Expect.Error.Message != nil && rerr.Message != *c.Expect.Error.Message {
					t.Fatalf("expected message %q, got %q", *c.Expect.Error.Message, rerr.Message)
				}
				return
			}
			if rerr != nil {
				t.Fatalf("%s\n%v", c.Description, rerr)
			}
			var pattern any
			if c.Expect.Dom != nil {
				pattern = *c.Expect.Dom
			}
			if err := match(pattern, domValue(t, dom), "dom"); err != nil {
				t.Fatalf("%s\n%v\n%s", c.Description, err, dom.json())
			}
			if c.CacheMisses {
				notationCacheCases(t, c.Document, dom, bundled.reader)
			}
		})
	}
}

func TestRecipeSetOperatorsDescribeOperators(t *testing.T) {
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	_, err := bundled.reader.read("```jbogenbau\n%rule r A := ∪ \"a\"\n```\n", "grammar.md")
	if err == nil || !strings.Contains(err.Error(), "set operator") {
		t.Fatalf("expected a set-operator error, got %v", err)
	}
}

func TestRangeEmissionTargetReportsContentError(t *testing.T) {
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	_, err := bundled.reader.read("```jbogenbau\n%rule r A %emits \"a\"..\"z\"\n```\n", "grammar.md")
	if err == nil || !strings.Contains(err.Error(), "an emission target requires a capture or ε") {
		t.Fatalf("expected an emission-target error, got %v", err)
	}
}

func TestConstantNamePrecedesRequiredValue(t *testing.T) {
	b := &domBuilder{doc: "g.md", gt: &grammarText{pos: [][2]int{{1, 1}}}, toks: []Token{{Value: "%const"}, {Value: "$bad"}}}
	definer := &Node{Kind: KindRule, Rule: "constant-definer", Children: []*Node{{Kind: KindToken, Token: 0}}}
	reference := &Node{Kind: KindRule, Rule: "constant-reference", Children: []*Node{{Kind: KindToken, Token: 1}}}
	node := &Node{Kind: KindRule, Rule: "constant-definition", Children: []*Node{definer, reference}}
	defer func() {
		problem, ok := recover().(*Error)
		if !ok || !strings.Contains(problem.Error(), "a constant requires a user name") {
			t.Fatalf("expected the invalid name before the missing term, got %v", problem)
		}
	}()
	b.constant(node)
	t.Fatal("the invalid name was accepted")
}

func TestSuppliedIntersectionsNeedNoOperatorTokens(t *testing.T) {
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	node := func(name string, children ...*Node) *Node {
		return &Node{Kind: KindRule, Rule: name, Children: children}
	}
	for count := 2; count <= 4; count++ {
		parts := make([]*Node, count)
		tokens := make([]Token, count)
		for i := range parts {
			tokens[i] = Token{Value: "A"}
			parts[i] = node("concatenation", node("term-atom", node("tag", &Node{Kind: KindToken, Token: i})))
		}
		b := &domBuilder{doc: "g.md", uni: bundled.uni, gt: &grammarText{pos: [][2]int{{1, 1}}}, types: newTypeMemo(), toks: tokens}
		term := b.term(node("union", node("intersection", parts...)))
		if term.Kind != tmIntersection || len(term.Items) != count {
			t.Fatalf("%d operands: got %v", count, term)
		}
	}
}

func TestMalformedSuppliedConstructorsGiveDocumentErrors(t *testing.T) {
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	node := func(name string, children ...*Node) *Node {
		return &Node{Kind: KindRule, Rule: name, Children: children}
	}
	token := func(index int) *Node { return &Node{Kind: KindToken, Token: index} }
	tag := func(index int) *Node {
		return node("intersection", node("concatenation", node("term-atom", node("tag", token(index)))))
	}
	binding := node("rule", node("definer", token(0)), node("rule-name", token(1)), token(2))
	atom := node("recipe-atom")
	atom.Span = [2]int{999, 1000}
	for _, item := range []struct {
		name string
		read func(*domBuilder)
	}{
		{"binding without a call", func(b *domBuilder) { b.rule(binding) }},
		{"union without an operator", func(b *domBuilder) { b.term(node("union", tag(3), tag(4))) }},
		{"recipe span outside the tokens", func(b *domBuilder) { b.recipe(node("recipe", atom)) }},
		{"empty pattern atom", func(b *domBuilder) { b.run(&patternFrame{n: node("pattern-node", node("pattern-atom"))}) }},
	} {
		t.Run(item.name, func(t *testing.T) {
			defer func() {
				problem := recover()
				if _, ok := problem.(*Error); !ok {
					t.Fatalf("expected a document error, got %v", problem)
				}
			}()
			b := &domBuilder{doc: "g.md", uni: bundled.uni, gt: &grammarText{pos: [][2]int{{1, 1}}}, types: newTypeMemo(), toks: []Token{{Value: "%rule"}, {Value: "r"}, {Value: "="}, {Value: "A"}, {Value: "B"}}}
			item.read(b)
			t.Fatal("the malformed constructor was accepted")
		})
	}
}

// TestFixpoint loads the notation's pipeline, grammars/gencmu/jbogenbau/pipeline.md, with
// the bootstrap, splices it, and compares the stages with the bootstrap
// itself (engine §8): the same names, and the same runs of documents with
// the same DOMs.
func TestFixpoint(t *testing.T) {
	t.Parallel()
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	var b struct {
		Documents map[string]struct {
			Dom json.RawMessage `json:"dom"`
		} `json:"documents"`
	}
	if err := unmarshalJSON([]byte(bundled.sources["data/preparsed/gencmu.json"]), &b); err != nil {
		t.Fatal(err)
	}
	// The repository's documents, each read with the bootstrap.
	l := &loader{
		read: func(p string) (string, bool, *Error) {
			text, err := os.ReadFile(filepath.Join("..", "..", filepath.FromSlash(p)))
			return string(text), err == nil, nil
		},
		uni:     bundled.uni,
		reader:  bundled.reader,
		noCache: true,
	}
	p, err := l.splice("grammars/gencmu/jbogenbau/pipeline.md")
	if err != nil {
		t.Fatal(err)
	}
	pipelineDOM, derr := decodeDOM(b.Documents["grammars/gencmu/jbogenbau/pipeline.md"].Dom, l.uni)
	if derr != nil {
		t.Fatal(derr)
	}
	var names []string
	for _, d := range pipelineDOM.Directives {
		if d.Name == "stage" {
			names = append(names, d.Args[0])
		}
	}
	if len(p.stages) != len(names) {
		t.Fatal("the stage count differs")
	}
	for i, stage := range p.stages {
		if stage.name != names[i] {
			t.Fatal("the stage name differs")
		}
		for _, document := range stage.documents {
			want, _ := decodeJSON(b.Documents[document.path].Dom)
			if !equalJSON(domValue(t, document.dom), want) {
				t.Errorf("%s: the bootstrap DOM differs", document.path)
			}
		}
	}
	for path, entry := range b.Documents {
		text, ok, readErr := l.read(path)
		if readErr != nil || !ok {
			t.Fatal(path)
		}
		fresh, err := bundled.reader.read(text, path)
		if err != nil {
			t.Fatal(err)
		}
		want, _ := decodeJSON(entry.Dom)
		if !equalJSON(domValue(t, fresh), want) {
			t.Errorf("%s: the document DOM differs", path)
		}
	}

}

// TestPreparsed checks that data/preparsed/lojban.json agrees with a fresh reading of
// every document it lists, and that it is the file of the grammars.
func TestPreparsed(t *testing.T) {
	t.Parallel()
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	var c struct {
		Format    int    `json:"format"`
		Bootstrap string `json:"bootstrap"`
		Unicode   string `json:"unicode"`
		Documents map[string]struct {
			Hash string          `json:"hash"`
			Dom  json.RawMessage `json:"dom"`
		} `json:"documents"`
	}
	preparsedText, _ := bundledNamesText("data/preparsed/lojban.json")
	if err := unmarshalJSON([]byte(preparsedText), &c); err != nil {
		t.Fatal(err)
	}
	if c.Format != domFormat || c.Bootstrap != bundled.reader.hash || c.Unicode != bundled.uni.hash {
		t.Fatalf("data/preparsed/lojban.json is for format %d and bootstrap %s, not %d and %s", c.Format, c.Bootstrap, domFormat, bundled.reader.hash)
	}
	if len(c.Documents) == 0 {
		t.Fatal("data/preparsed/lojban.json lists no documents")
	}
	for p, d := range c.Documents {
		text, ok := bundled.sources[p]
		if !ok {
			t.Errorf("%s: listed in data/preparsed/lojban.json but not bundled", p)
			continue
		}
		if fnv1a64(text) != d.Hash {
			t.Errorf("%s: data/preparsed/lojban.json's hash %s is not the text's %s", p, d.Hash, fnv1a64(text))
		}
		dom, rerr := bundled.reader.read(text, p)
		if rerr != nil {
			t.Fatalf("%s: %v", p, rerr)
		}
		want, _ := decodeJSON(d.Dom)
		if !equalJSON(domValue(t, dom), want) {
			t.Errorf("%s: data/preparsed/lojban.json's DOM differs from a fresh reading", p)
		}
	}
	for p, text := range bundled.sources {
		disk, err := os.ReadFile(filepath.Join("..", "..", p))
		if err != nil || string(disk) != text {
			t.Errorf("lib/go/%s differs from %s; run node tools/sync.js", p, p)
		}
	}
}

// TestCacheUsedAndBypassed parses with the preparsed DOMs and without
// them, and the two agree.
func TestCacheUsedAndBypassed(t *testing.T) {
	t.Parallel()
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	sources := map[string]string{}
	for p, text := range bundled.sources {
		sources[p] = text
	}
	text := bundled.sources["grammars/gencmu/jbogenbau/syntax.md"]
	var outs [][]byte
	for _, noCache := range []bool{false, true} {
		d, err := loadSources(sources, "grammars/gencmu/jbogenbau/pipeline.md", noCache)
		if err != nil {
			t.Fatal(err)
		}
		res, err := d.Parse(string(extractGrammarText(text, bundled.uni).text), ParseOptions{})
		if err != nil {
			t.Fatal(err)
		}
		if !res.OK {
			t.Fatalf("the notation pipeline does not parse syntax.md (cache bypassed: %v): %s", noCache, res.Error.Message)
		}
		data, _ := MarshalResult(res)
		outs = append(outs, data)
	}
	if string(outs[0]) != string(outs[1]) {
		t.Error("parsing with the cache and without it differ")
	}
	// A cache entry for a different bootstrap is a miss.
	preparsedText, _ := bundledNamesText("data/preparsed/lojban.json")
	if got, _, _ := readPreparsedCache(preparsedText, "0000000000000000", bundled.uni.hash, fnv1a64(bundled.sources["data/unicode/unicode-properties.txt"])); len(got) != 0 {
		t.Error("data/preparsed/lojban.json was used with another bootstrap")
	}
}

// TestBundledCacheSameStages loads each bundled pipeline with the preparsed
// DOMs and without them, and the two give the same stages and features.
func TestBundledCacheSameStages(t *testing.T) {
	t.Parallel()
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	configured, err := bundledLoader()
	if err != nil {
		t.Fatal(err)
	}
	configured.activatePreparsed("grammars/lojban/cll/pipeline.md")
	if len(configured.preparsed) == 0 {
		t.Fatal("data/preparsed/lojban.json holds no DOMs for this bootstrap")
	}
	var names []string
	for p := range bundled.sources {
		if strings.HasPrefix(p, "grammars/") && strings.HasSuffix(p, "/pipeline.md") {
			names = append(names, p)
		}
	}
	if len(names) == 0 {
		t.Fatal("no bundled pipelines")
	}
	for _, name := range names {
		var loaded [2]*Pipeline
		for i, noCache := range []bool{false, true} {
			l, err := bundledLoader()
			if err != nil {
				t.Fatal(err)
			}
			l.noCache = noCache
			if !noCache {
				// A cache miss fails because this loader cannot read notation.
				l.reader = nil
			}
			if loaded[i], err = l.pipeline(name); err != nil {
				t.Fatalf("%s (cache bypassed: %v): %v", name, noCache, err)
			}
		}
		if !reflect.DeepEqual(loaded[0].Features(), loaded[1].Features()) {
			t.Errorf("%s: the features differ: %+v and %+v", name, loaded[0].Features(), loaded[1].Features())
		}
		if !sameValue(reflect.ValueOf(loaded[0].stages), reflect.ValueOf(loaded[1].stages)) {
			t.Errorf("%s: the stages differ", name)
		}
	}
}

// sameValue is reflect.DeepEqual for values with no cycles, but a nil slice
// or map equals an empty one: a decoded DOM leaves an empty list nil where
// the reader makes it empty.
func sameValue(a, b reflect.Value) bool {
	if a.Kind() != b.Kind() {
		return false
	}
	switch a.Kind() {
	case reflect.Pointer, reflect.Interface:
		if a.IsNil() || b.IsNil() {
			return a.IsNil() == b.IsNil()
		}
		return sameValue(a.Elem(), b.Elem())
	case reflect.Struct:
		// Private reader positions do not belong to cached grammar identity.
		// Parameter and constant reference positions remain public DOM members.
		kind := a.Type()
		for i := 0; i < a.NumField(); i++ {
			field := kind.Field(i).Name
			if kind == reflect.TypeOf(domAlt{}) && field == "rankedLocations" ||
				kind == reflect.TypeOf(domExpr{}) && (field == "DefaultAt" || field == "RankedAt" || field == "At" && a.FieldByName("Kind").String() != exParam) ||
				kind == reflect.TypeOf(domCond{}) && field == "At" ||
				kind == reflect.TypeOf(domTerm{}) && field == "At" && a.FieldByName("Kind").String() != tmConst && a.FieldByName("Kind").String() != tmParam {
				continue
			}
			if !sameValue(a.Field(i), b.Field(i)) {
				return false
			}
		}
		return true
	case reflect.Slice, reflect.Array:
		if a.Len() != b.Len() {
			return false
		}
		for i := 0; i < a.Len(); i++ {
			if !sameValue(a.Index(i), b.Index(i)) {
				return false
			}
		}
		return true
	case reflect.Map:
		if a.Type() == reflect.TypeOf(templateObject{}) {
			// Template audit records retain private source locations. The DOM
			// cache omits them, as it omits the native term locations above.
			key := reflect.ValueOf(templateSourceKey)
			al, bl := a.Len(), b.Len()
			if a.MapIndex(key).IsValid() {
				al--
			}
			if b.MapIndex(key).IsValid() {
				bl--
			}
			if al != bl {
				return false
			}
			for _, k := range a.MapKeys() {
				if k.String() == templateSourceKey {
					continue
				}
				v := b.MapIndex(k)
				if !v.IsValid() || !sameValue(a.MapIndex(k), v) {
					return false
				}
			}
			return true
		}
		if a.Len() != b.Len() {
			return false
		}

		if a.Type().Key().Kind() == reflect.Pointer {
			keys := b.MapKeys()
			used := make([]bool, len(keys))
			for _, key := range a.MapKeys() {
				found := false
				for i, other := range keys {
					if !used[i] && sameValue(key, other) && sameValue(a.MapIndex(key), b.MapIndex(other)) {
						used[i] = true
						found = true
						break
					}
				}
				if !found {
					return false
				}
			}
			return true
		}
		for _, k := range a.MapKeys() {
			v := b.MapIndex(k)
			if !v.IsValid() || !sameValue(a.MapIndex(k), v) {
				return false
			}
		}
		return true
	case reflect.String:
		return a.String() == b.String()
	case reflect.Bool:
		return a.Bool() == b.Bool()
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return a.Int() == b.Int()
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return a.Uint() == b.Uint()
	case reflect.Float32, reflect.Float64:
		return a.Float() == b.Float()
	}
	panic("sameValue: cannot compare a " + a.Kind().String())
}

// DOM 27 uses stored tags for names and strings. Single-scalar punctuation inherits the stage zero Unicode tags.
func TestNotationLexicalTags(t *testing.T) {
	// The quoted scalar-shaped text tests literal dollars.
	t.Parallel()
	d, err := LoadPipeline("gencmu/jbogenbau")
	if err != nil {
		t.Fatal(err)
	}
	res, err := d.Parse(`%rule a :: X | ¬f? B "c" / {E ... "$(_005C)"} [+KU] [+TOI] | g? %rulex $e ¬h "x".."y" _General_Category_Letter "a"...`, ParseOptions{Until: "lexical"})
	if err != nil || !res.OK {
		t.Fatalf("%v %+v", err, res)
	}
	var got [][2]string
	for _, tok := range res.Stages[0].Output {
		got = append(got, [2]string{tok.Text, strings.Join(tok.Tags, " ")})
	}
	want := [][2]string{
		{"%rule", "KW-RULE"}, {"a", "Identifier Lowercase-Name"}, {"::", ""}, {"X", "Identifier Uppercase-Name"}, {"|", "_Age_V1_1 _Bidi_Class_Other_Neutral _Bidi_Paired_Bracket_Type_None _Block_Basic_Latin _Canonical_Combining_Class_Not_Reordered _Decomposition_Type_None _East_Asian_Width_Narrow _General_Category_Math_Symbol _General_Category_Symbol _Grapheme_Base _Grapheme_Cluster_Break_Other _Hangul_Syllable_Type_Not_Applicable _Indic_Conjunct_Break_None _Indic_Positional_Category_NA _Indic_Syllabic_Category_Other _Joining_Group_No_Joining_Group _Joining_Type_Non_Joining _Line_Break_Break_After _Math _NFC_Quick_Check_Yes _NFD_Quick_Check_Yes _NFKC_Quick_Check_Yes _NFKD_Quick_Check_Yes _Numeric_Type_None _Pattern_Syntax _Script_Common _Script_Extensions_Common _Sentence_Break_Other _Vertical_Orientation_Rotated _Word_Break_Other"},
		{"¬f?", "Guard"}, {"B", "Identifier Uppercase-Name"}, {`"c"`, "String"}, {"/", "_Age_V1_1 _Bidi_Class_Common_Separator _Bidi_Paired_Bracket_Type_None _Block_Basic_Latin _Canonical_Combining_Class_Not_Reordered _Decomposition_Type_None _East_Asian_Width_Narrow _General_Category_Other_Punctuation _General_Category_Punctuation _Grapheme_Base _Grapheme_Cluster_Break_Other _Hangul_Syllable_Type_Not_Applicable _Indic_Conjunct_Break_None _Indic_Positional_Category_NA _Indic_Syllabic_Category_Other _Joining_Group_No_Joining_Group _Joining_Type_Non_Joining _Line_Break_Break_Symbols _NFC_Quick_Check_Yes _NFD_Quick_Check_Yes _NFKC_Quick_Check_Yes _NFKD_Quick_Check_Yes _Numeric_Type_None _Pattern_Syntax _Script_Common _Script_Extensions_Common _Sentence_Break_Other _Vertical_Orientation_Rotated _Word_Break_Other"}, {"{", "_Age_V1_1 _Bidi_Class_Other_Neutral _Bidi_Mirrored _Bidi_Paired_Bracket_Type_Open _Block_Basic_Latin _Canonical_Combining_Class_Not_Reordered _Decomposition_Type_None _East_Asian_Width_Narrow _General_Category_Open_Punctuation _General_Category_Punctuation _Grapheme_Base _Grapheme_Cluster_Break_Other _Hangul_Syllable_Type_Not_Applicable _Indic_Conjunct_Break_None _Indic_Positional_Category_NA _Indic_Syllabic_Category_Other _Joining_Group_No_Joining_Group _Joining_Type_Non_Joining _Line_Break_Open_Punctuation _NFC_Quick_Check_Yes _NFD_Quick_Check_Yes _NFKC_Quick_Check_Yes _NFKD_Quick_Check_Yes _Numeric_Type_None _Pattern_Syntax _Script_Common _Script_Extensions_Common _Sentence_Break_Close _Vertical_Orientation_Rotated _Word_Break_Other"}, {"E", "Identifier Uppercase-Name"}, {"...", ""}, {`"$(_005C)"`, "String"}, {"}", "_Age_V1_1 _Bidi_Class_Other_Neutral _Bidi_Mirrored _Bidi_Paired_Bracket_Type_Close _Block_Basic_Latin _Canonical_Combining_Class_Not_Reordered _Decomposition_Type_None _East_Asian_Width_Narrow _General_Category_Close_Punctuation _General_Category_Punctuation _Grapheme_Base _Grapheme_Cluster_Break_Other _Hangul_Syllable_Type_Not_Applicable _Indic_Conjunct_Break_None _Indic_Positional_Category_NA _Indic_Syllabic_Category_Other _Joining_Group_No_Joining_Group _Joining_Type_Non_Joining _Line_Break_Close_Punctuation _NFC_Quick_Check_Yes _NFD_Quick_Check_Yes _NFKC_Quick_Check_Yes _NFKD_Quick_Check_Yes _Numeric_Type_None _Pattern_Syntax _Script_Common _Script_Extensions_Common _Sentence_Break_Close _Vertical_Orientation_Rotated _Word_Break_Other"},
		{"[", "_Age_V1_1 _Bidi_Class_Other_Neutral _Bidi_Mirrored _Bidi_Paired_Bracket_Type_Open _Block_Basic_Latin _Canonical_Combining_Class_Not_Reordered _Decomposition_Type_None _East_Asian_Width_Narrow _General_Category_Open_Punctuation _General_Category_Punctuation _Grapheme_Base _Grapheme_Cluster_Break_Other _Hangul_Syllable_Type_Not_Applicable _Indic_Conjunct_Break_None _Indic_Positional_Category_NA _Indic_Syllabic_Category_Other _Joining_Group_No_Joining_Group _Joining_Type_Non_Joining _Line_Break_Open_Punctuation _NFC_Quick_Check_Yes _NFD_Quick_Check_Yes _NFKC_Quick_Check_Yes _NFKD_Quick_Check_Yes _Numeric_Type_None _Pattern_Syntax _Script_Common _Script_Extensions_Common _Sentence_Break_Close _Vertical_Orientation_Rotated _Word_Break_Other"}, {"+", "_Age_V1_1 _Bidi_Class_European_Separator _Bidi_Paired_Bracket_Type_None _Block_Basic_Latin _Canonical_Combining_Class_Not_Reordered _Decomposition_Type_None _East_Asian_Width_Narrow _General_Category_Math_Symbol _General_Category_Symbol _Grapheme_Base _Grapheme_Cluster_Break_Other _Hangul_Syllable_Type_Not_Applicable _Indic_Conjunct_Break_None _Indic_Positional_Category_NA _Indic_Syllabic_Category_Other _Joining_Group_No_Joining_Group _Joining_Type_Non_Joining _Line_Break_Prefix_Numeric _Math _NFC_Quick_Check_Yes _NFD_Quick_Check_Yes _NFKC_Quick_Check_Yes _NFKD_Quick_Check_Yes _Numeric_Type_None _Pattern_Syntax _Script_Common _Script_Extensions_Common _Sentence_Break_Other _Vertical_Orientation_Rotated _Word_Break_Other"}, {"KU", "Identifier Uppercase-Name"}, {"]", "_Age_V1_1 _Bidi_Class_Other_Neutral _Bidi_Mirrored _Bidi_Paired_Bracket_Type_Close _Block_Basic_Latin _Canonical_Combining_Class_Not_Reordered _Decomposition_Type_None _East_Asian_Width_Narrow _General_Category_Close_Punctuation _General_Category_Punctuation _Grapheme_Base _Grapheme_Cluster_Break_Other _Hangul_Syllable_Type_Not_Applicable _Indic_Conjunct_Break_None _Indic_Positional_Category_NA _Indic_Syllabic_Category_Other _Joining_Group_No_Joining_Group _Joining_Type_Non_Joining _Line_Break_Close_Parenthesis _NFC_Quick_Check_Yes _NFD_Quick_Check_Yes _NFKC_Quick_Check_Yes _NFKD_Quick_Check_Yes _Numeric_Type_None _Pattern_Syntax _Script_Common _Script_Extensions_Common _Sentence_Break_Close _Vertical_Orientation_Rotated _Word_Break_Other"}, {"[", "_Age_V1_1 _Bidi_Class_Other_Neutral _Bidi_Mirrored _Bidi_Paired_Bracket_Type_Open _Block_Basic_Latin _Canonical_Combining_Class_Not_Reordered _Decomposition_Type_None _East_Asian_Width_Narrow _General_Category_Open_Punctuation _General_Category_Punctuation _Grapheme_Base _Grapheme_Cluster_Break_Other _Hangul_Syllable_Type_Not_Applicable _Indic_Conjunct_Break_None _Indic_Positional_Category_NA _Indic_Syllabic_Category_Other _Joining_Group_No_Joining_Group _Joining_Type_Non_Joining _Line_Break_Open_Punctuation _NFC_Quick_Check_Yes _NFD_Quick_Check_Yes _NFKC_Quick_Check_Yes _NFKD_Quick_Check_Yes _Numeric_Type_None _Pattern_Syntax _Script_Common _Script_Extensions_Common _Sentence_Break_Close _Vertical_Orientation_Rotated _Word_Break_Other"}, {"+", "_Age_V1_1 _Bidi_Class_European_Separator _Bidi_Paired_Bracket_Type_None _Block_Basic_Latin _Canonical_Combining_Class_Not_Reordered _Decomposition_Type_None _East_Asian_Width_Narrow _General_Category_Math_Symbol _General_Category_Symbol _Grapheme_Base _Grapheme_Cluster_Break_Other _Hangul_Syllable_Type_Not_Applicable _Indic_Conjunct_Break_None _Indic_Positional_Category_NA _Indic_Syllabic_Category_Other _Joining_Group_No_Joining_Group _Joining_Type_Non_Joining _Line_Break_Prefix_Numeric _Math _NFC_Quick_Check_Yes _NFD_Quick_Check_Yes _NFKC_Quick_Check_Yes _NFKD_Quick_Check_Yes _Numeric_Type_None _Pattern_Syntax _Script_Common _Script_Extensions_Common _Sentence_Break_Other _Vertical_Orientation_Rotated _Word_Break_Other"}, {"TOI", "Identifier Uppercase-Name"}, {"]", "_Age_V1_1 _Bidi_Class_Other_Neutral _Bidi_Mirrored _Bidi_Paired_Bracket_Type_Close _Block_Basic_Latin _Canonical_Combining_Class_Not_Reordered _Decomposition_Type_None _East_Asian_Width_Narrow _General_Category_Close_Punctuation _General_Category_Punctuation _Grapheme_Base _Grapheme_Cluster_Break_Other _Hangul_Syllable_Type_Not_Applicable _Indic_Conjunct_Break_None _Indic_Positional_Category_NA _Indic_Syllabic_Category_Other _Joining_Group_No_Joining_Group _Joining_Type_Non_Joining _Line_Break_Close_Parenthesis _NFC_Quick_Check_Yes _NFD_Quick_Check_Yes _NFKC_Quick_Check_Yes _NFKD_Quick_Check_Yes _Numeric_Type_None _Pattern_Syntax _Script_Common _Script_Extensions_Common _Sentence_Break_Close _Vertical_Orientation_Rotated _Word_Break_Other"},
		{"|", "_Age_V1_1 _Bidi_Class_Other_Neutral _Bidi_Paired_Bracket_Type_None _Block_Basic_Latin _Canonical_Combining_Class_Not_Reordered _Decomposition_Type_None _East_Asian_Width_Narrow _General_Category_Math_Symbol _General_Category_Symbol _Grapheme_Base _Grapheme_Cluster_Break_Other _Hangul_Syllable_Type_Not_Applicable _Indic_Conjunct_Break_None _Indic_Positional_Category_NA _Indic_Syllabic_Category_Other _Joining_Group_No_Joining_Group _Joining_Type_Non_Joining _Line_Break_Break_After _Math _NFC_Quick_Check_Yes _NFD_Quick_Check_Yes _NFKC_Quick_Check_Yes _NFKD_Quick_Check_Yes _Numeric_Type_None _Pattern_Syntax _Script_Common _Script_Extensions_Common _Sentence_Break_Other _Vertical_Orientation_Rotated _Word_Break_Other"}, {"g?", "Guard"}, {"%rulex", "Keyword"}, {"$e", "Capture"}, {"¬", "_Age_V1_1 _Bidi_Class_Other_Neutral _Bidi_Paired_Bracket_Type_None _Block_Latin_1_Supplement _Canonical_Combining_Class_Not_Reordered _Decomposition_Type_None _East_Asian_Width_Narrow _General_Category_Math_Symbol _General_Category_Symbol _Grapheme_Base _Grapheme_Cluster_Break_Other _Hangul_Syllable_Type_Not_Applicable _Indic_Conjunct_Break_None _Indic_Positional_Category_NA _Indic_Syllabic_Category_Other _Joining_Group_No_Joining_Group _Joining_Type_Non_Joining _Line_Break_Alphabetic _Math _NFC_Quick_Check_Yes _NFD_Quick_Check_Yes _NFKC_Quick_Check_Yes _NFKD_Quick_Check_Yes _Numeric_Type_None _Pattern_Syntax _Script_Common _Script_Extensions_Common _Sentence_Break_Other _Vertical_Orientation_Rotated _Word_Break_Other"}, {"h", "Identifier Lowercase-Name"},
		{`"x"`, "String"}, {"..", ""}, {`"y"`, "String"}, {"_General_Category_Letter", "Engine-Tag"}, {`"a"`, "String"}, {"...", ""},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v\nwant %v", got, want)
	}
}

// A tie in a stage of the notation is a grammar error that names the
// document, with no line or column (engine §8).
func TestNotationTie(t *testing.T) {
	t.Parallel()
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	// A notation whose one stage reads the character a in two ways.
	notation, err := bundled.reader.read("```jbogenbau\n%ambiguity-resolution greedy\n%rule text p | q\n%rule p \"a\"\n%rule q \"a\"\n```\n", "n.md")
	if err != nil {
		t.Fatal(err)
	}
	bootstrap := `{"format":` + strconv.Itoa(domFormat) + `,"documents":{"grammars/gencmu/jbogenbau/pipeline.md":{"hash":"0","dom":{"format":` + strconv.Itoa(domFormat) + `,"rules":[],"directives":[{"name":"stage","args":["syntax"],"at":[1,1]},{"name":"include","args":["../../../n.md"],"at":[2,1]}],"constants":[],"classifiers":[],"implications":[],"checks":[]}},"n.md":{"hash":"0","dom":` + string(notation.json()) + `}}}`
	tying, nerr := newNotationReader(bootstrap, bundled.uni)
	if nerr != nil {
		t.Fatal(nerr)
	}
	_, e := tying.read("```jbogenbau\na\n```\n", "t.md")
	if e == nil || e.Kind != ErrorGrammar || e.Document != "t.md" || e.Line != 0 || e.Column != 0 {
		t.Fatalf("got %#v", e)
	}
	if want := "t.md: the grammar text is ambiguous: the syntax stage of the notation reads it in two ways"; e.Error() != want {
		t.Fatalf("got %q, want %q", e.Error(), want)
	}
}

// The notation's lexical stage tags constants and the keywords that define
// them (grammars/gencmu/jbogenbau/lexical.md).
func TestNotationLexicalConstants(t *testing.T) {
	t.Parallel()
	d, err := LoadPipeline("gencmu/jbogenbau")
	if err != nil {
		t.Fatal(err)
	}
	res, err := d.Parse(`%const $SU-STOPS %redefine-const $x $ $K1`, ParseOptions{Until: "lexical"})
	if err != nil || !res.OK {
		t.Fatalf("%v %+v", err, res)
	}
	var got [][2]string
	for _, tok := range res.Stages[0].Output {
		got = append(got, [2]string{tok.Text, strings.Join(tok.Tags, " ")})
	}
	want := [][2]string{
		{"%const", "KW-CONST"}, {"$SU-STOPS", "Constant"}, {"%redefine-const", "KW-REDEFINE-CONST"},
		{"$x", "Capture"}, {"$", "Capture"}, {"$K1", "Constant"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got  %v\nwant %v", got, want)
	}
}

// Scalar constants and terminal diagnostics replace character tags (engine §1, §4).
func TestCharacterTags(t *testing.T) {
	t.Parallel()
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	for c, want := range map[rune]string{'a': `"a"`, 0x301: `"‹U+0301›"`, 0xED80: `"‹U+ED80›"`, '"': `"‹U+0022›"`, '\\': `"\"`, 0x7F: `"‹DEL›"`, 'é': `"‹U+00E9›"`, '각': `"‹U+AC01›"`, 0x10FFFD: `"‹U+10FFFD›"`} {
		if got := stringTerminal(string(c), bundled.uni); got != want {
			t.Errorf("U+%04X: %s, want %s", c, got, want)
		}
	}
	for _, bad := range []string{"'a'", "/a/", "lowercase", "_Bogus"} {
		if isTag(bad, bundled.uni) {
			t.Errorf("%s is a tag", bad)
		}
	}
}

// The records of a table give the same answers in any order (engine §1).
// The code points next to a boundary of a record are where an unsorted
// search goes wrong first.
func TestUnicodeTableOrder(t *testing.T) {
	t.Parallel()
	data, err := bundledFS.ReadFile("data/unicode/unicode.txt")
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	lines := strings.Split(strings.TrimRight(text, "\n"), "\n")
	for i, j := 0, len(lines)-1; i < j; i, j = i+1, j-1 {
		lines[i], lines[j] = lines[j], lines[i]
	}
	bundled, err := parseUnicodeTable(text)
	if err != nil {
		t.Fatal(err)
	}
	reversed, err := parseUnicodeTable(strings.Join(lines, "\n"))
	if err != nil {
		t.Fatal(err)
	}
	for _, line := range lines {
		fields := strings.Fields(line)
		for _, field := range fields[min(1, len(fields)):] {
			v, err := strconv.ParseUint(field, 16, 32)
			if err != nil {
				continue
			}
			for _, c := range []rune{rune(v) - 1, rune(v), rune(v) + 1} {
				if c < 0 || c > 0x10FFFF {
					continue
				}
				if reversed.category(c) != bundled.category(c) || reversed.isWhiteSpace(c) != bundled.isWhiteSpace(c) {
					t.Errorf("U+%04X: the reversed table disagrees", c)
				}
			}
		}
	}
	if reversed.category('a') != "Ll" || reversed.category('A') != "Lu" {
		t.Error("the reversed table misreads a letter")
	}
}

// A scalar value that a caller's table omits is Cn, without White_Space
// or a stored Unicode category (engine §1).
func TestUnicodeTablePartial(t *testing.T) {
	t.Parallel()
	uni, err := parseUnicodeTable("unicode 0.0.0\ncategory Lu 0041 005A\n")
	if err != nil {
		t.Fatal(err)
	}
	for c, want := range map[rune]string{'A': "Lu", 'a': "Cn", 0x10FFFF: "Cn", 0: "Cn", 0xD800: "Cs"} {
		if got := uni.category(c); got != want {
			t.Errorf("U+%04X: category %s, want %s", c, got, want)
		}
	}
	if uni.category('a') != "Cn" {
		t.Error("category is wrong for an omitted scalar value")
	}
	if uni.isWhiteSpace(' ') || uni.isWhiteSpace('\t') {
		t.Error("a table without white-space lines has White_Space")
	}
	if uni.isMark(0x301) {
		t.Error("a table without category lines has a mark")
	}
}

// A caller's table replaces the bundled one entirely (engine §1). This one
// knows no letters, only the white space that the notation reads between
// tokens.
func TestUnicodeTableOfCaller(t *testing.T) {
	t.Parallel()
	sources := func(rule string, table bool) map[string]string {
		m := map[string]string{
			"p.md": "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n",
			"g.md": "```jbogenbau\n%ambiguity-resolution greedy\n%rule text " + rule + "\n```\n",
		}
		if table {
			m["data/unicode/unicode.txt"] = "unicode 0.0.0\nwhite-space 0009 000D\nwhite-space 0020 0020\n"
		}
		return m
	}
	for _, c := range []struct {
		rule  string
		table bool
		ok    bool
	}{{`_General_Category_Letter`, true, false}, {`_General_Category_Unassigned`, true, true}, {`_General_Category_Letter`, false, true}} {
		d, err := LoadPipelineSources(sources(c.rule, c.table), "p.md")
		if err != nil {
			t.Fatal(err)
		}
		res, err := d.Parse("a", ParseOptions{})
		if err != nil {
			t.Fatal(err)
		}
		if res.OK != c.ok {
			t.Errorf("%s with the caller's table %v: ok %v", c.rule, c.table, res.OK)
		}
	}
}

// data/unicode/unicode.txt gives each scalar value its General_Category and
// says which have White_Space (engine §1).
func TestUnicodeTable(t *testing.T) {
	t.Parallel()
	data, err := bundledFS.ReadFile("data/unicode/unicode.txt")
	if err != nil {
		t.Fatal(err)
	}
	uni, err := parseUnicodeTable(string(data))
	if err != nil {
		t.Fatal(err)
	}
	for c, want := range map[rune]string{'a': "Ll", 'A': "Lu", '0': "Nd", ' ': "Zs", 0x301: "Mn", 0xD800: "Cs", 0xE000: "Co", 0x378: "Cn", 0x10FFFF: "Cn", 0: "Cc"} {
		if got := uni.category(c); got != want {
			t.Errorf("U+%04X: category %s, want %s", c, got, want)
		}
	}
	if !uni.isMark(0x301) || uni.isMark('a') || uni.isMark(0x903) {
		t.Error("isMark disagrees with Mn")
	}
	for _, c := range []rune{9, 0x0D, ' ', 0x85, 0xA0, 0x2028, 0x3000} {
		if !uni.isWhiteSpace(c) {
			t.Errorf("U+%04X lacks White_Space", c)
		}
	}
	if uni.isWhiteSpace(0x200B) || uni.category('é')[0] != 'L' || uni.category('1')[0] == 'L' || uni.category(0x378) != "Cn" {
		t.Error("scalar properties are wrong")
	}
}

// A cache of another format is a miss.
// An unknown expression member also invalidates a current DOM.
func TestFormat17Refused(t *testing.T) {
	t.Parallel()
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	dom := func(format int, expr string) string {
		return `{"format":` + strconv.Itoa(format) + `,"rules":[{"name":"text","op":"define","alternatives":[{"guards":[],"expr":` + expr + `}],"conditions":[],"at":[2,1]}],"directives":[],"constants":[],"classifiers":[],"implications":[],"checks":[]}`
	}
	entry := func(format int, d string) string {
		return `{"format":` + strconv.Itoa(format) + `,"bootstrap":"` + bundled.reader.hash + `","unicode":"` + bundled.uni.hash + `","properties":"` + fnv1a64(bundled.sources["data/unicode/unicode-properties.txt"]) + `","documents":{"g.md":{"hash":"0","dom":` + d + `}}}`
	}
	if got, _, _ := readPreparsedCache(entry(domFormat, dom(domFormat, `{"repeat":{"ref":"A"}}`)), bundled.reader.hash, bundled.uni.hash, fnv1a64(bundled.sources["data/unicode/unicode-properties.txt"])); len(got) != 1 {
		t.Fatalf("a data/preparsed/lojban.json of format %d is not used", domFormat)
	}
	if got, _, _ := readPreparsedCache(entry(17, dom(17, `{"repeat":{"ref":"A"},"extra":true}`)), bundled.reader.hash, bundled.uni.hash, fnv1a64(bundled.sources["data/unicode/unicode-properties.txt"])); len(got) != 0 {
		t.Fatal("a data/preparsed/lojban.json of format 17 is used")
	}
	for _, d := range []string{dom(17, `{"repeat":{"ref":"A"}}`), dom(domFormat, `{"repeat":{"ref":"A"},"extra":true}`)} {
		if _, err := decodeDOM(json.RawMessage(d), bundled.uni); err == nil {
			t.Errorf("an unsupported or malformed DOM decodes: %s", d)
		}
	}
}

func TestRecipeConcatenationDiagnostics(t *testing.T) {
	t.Parallel()
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	text, err := os.ReadFile("../../tests/recipe-diagnostics.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases struct {
		Recipes []struct {
			Source string `json:"source"`
			At     string `json:"at"`
		} `json:"recipes"`
		Positions []struct {
			Name     string `json:"name"`
			Template string `json:"template"`
		} `json:"positions"`
		Ordinary []string `json:"ordinary"`
	}
	if err := unmarshalJSON(text, &cases); err != nil {
		t.Fatal(err)
	}
	for _, position := range cases.Positions {
		for _, channel := range []string{":=", ":-"} {
			for _, recipe := range cases.Recipes {
				t.Run(position.Name+channel+recipe.Source, func(t *testing.T) {
					body := strings.ReplaceAll(strings.ReplaceAll(position.Template, "@CHANNEL@", channel), "@RECIPE@", recipe.Source)
					marker := strings.Index(body, recipe.Source) + strings.Index(recipe.Source, recipe.At)
					_, failure := bundled.reader.read("```jbogenbau\n"+body+"\n```", "recipe.md")
					if failure == nil || !strings.Contains(strings.ToLower(failure.Message), "use ++") {
						t.Fatalf("expected a recipe instruction: %v", failure)
					}
					if failure.Line != 2 || failure.Column != len([]rune(body[:marker]))+1 {
						t.Fatalf("expected the first juxtaposed string at column %d: %v", len([]rune(body[:marker]))+1, failure)
					}
				})
			}
		}
	}
	for _, body := range cases.Ordinary {
		_, failure := bundled.reader.read("```jbogenbau\n"+body+"\n```", "ordinary.md")
		if failure == nil || !strings.Contains(failure.Message, "++") || strings.Contains(strings.ToLower(failure.Message), "use ++") {
			t.Fatalf("expected an ordinary type error: %v", failure)
		}
	}
}

func TestUnicodeProfilesShareSafely(t *testing.T) {
	upper, err := parseUnicodeTable("category Lu 0041 0041\n")
	if err != nil {
		t.Fatal(err)
	}
	absent, err := parseUnicodeTable("")
	if err != nil {
		t.Fatal(err)
	}
	profile := upper.profile('A')
	if reflect.DeepEqual(profile, absent.profile('A')) {
		t.Fatal("profiles crossed table identities")
	}
	var workers sync.WaitGroup
	for range 4 {
		workers.Add(1)
		go func() {
			defer workers.Done()
			if other := upper.profile('A'); &profile[0] != &other[0] {
				t.Error("the table did not share its profile")
			}
		}()
	}
	workers.Wait()
	for code := range rune(5000) {
		upper.profile(code)
	}
	if len(upper.profiles.entries) > 4096 {
		t.Fatal("the profile cache exceeded its bound")
	}
	if !reflect.DeepEqual(profile, upper.profile('A')) {
		t.Fatal("cache eviction changed the profile")
	}
}

func TestDecoratedPatternMemberOrder(t *testing.T) {
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	document := "```jbogenbau\n%const $P #·pair(\"a\")⁅⁆\n%rule f(@X) A %conditions $ ≅ #·@X⁅⁆\n```\n"
	dom, err := bundled.reader.read(document, "order.md")
	if err != nil {
		t.Fatal(err)
	}
	json := string(dom.json())
	for _, want := range []string{`"call":"pair","args":[{"string":"a"}],"exact":true,"children":[],"at":[2,13]`, `"param":"X","exact":true,"children":[],"at":[3,33]`} {
		if !strings.Contains(json, want) {
			t.Fatalf("missing %s in %s", want, json)
		}
	}
}

func TestFeatureConditionDepthLabel(t *testing.T) {
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	document := "```jbogenbau\n%features f %conditions " + strings.Repeat("¬(", 300) + "$" + strings.Repeat(")", 300) + "\n```\n"
	_, err := bundled.reader.read(document, "depth.md")
	if err == nil || !strings.HasPrefix(err.Message, "%features: an expression, term or condition is nested") {
		t.Fatalf("got %v", err)
	}
}

func TestCanonicalDOMMemberOrder(t *testing.T) {
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	dom, err := bundled.reader.read("```jbogenbau\n%rule f(@X) @X\n%extend-rule f(\"a\") A\n%features f %conditions $\n```\n", "order.md")
	if err != nil {
		t.Fatal(err)
	}
	tree, parseErr := templateFromJSON(dom.json())
	if parseErr != nil {
		t.Fatal(parseErr)
	}
	for _, text := range []string{string(dom.json()), string(templateJSON(tree))} {
		for _, want := range []string{`"name":"f","params":["X"],"op":"define"`, `"name":"f","args":[{"string":"a"}],"op":"extend"`, `"name":"features","args":["f"],"at":[4,1],"conditions":[{"captured":""}]`} {
			if !strings.Contains(text, want) {
				t.Fatalf("missing %s in %s", want, text)
			}
		}
	}
}

func TestAttachmentRejectsBareCaptureAfterStrayToken(t *testing.T) {
	b := &domBuilder{doc: "g.md", gt: &grammarText{pos: [][2]int{{1, 1}}}, toks: []Token{{Value: "A"}, {Value: "$"}}}
	n := &Node{Kind: KindRule, Rule: "capture-reference", Children: []*Node{{Kind: KindToken, Token: 0}, {Kind: KindToken, Token: 1}}}
	defer func() {
		if e, ok := recover().(*Error); !ok || e.Kind != ErrorGrammar {
			t.Fatalf("expected a document error, got %v", e)
		}
	}()
	b.attachment(n, n)
}

func TestGuardValidationFromSuppliedBootstrap(t *testing.T) {
	t.Parallel()
	bootstrap := bootstrapWithDOMChange(t, func(path string, dom map[string]any) {
		if path != "grammars/gencmu/jbogenbau/lexical.md" {
			return
		}
		for _, value := range dom["rules"].([]any) {
			rule := value.(map[string]any)
			var expr any
			switch rule["name"] {
			case "feature-character":
				expr = map[string]any{"literal": map[string]any{"string": "_"}}
			case "guard":
				expr = map[string]any{"seq": []any{
					map[string]any{"literal": map[string]any{"string": "¬"}},
					map[string]any{"ref": "feature-name"},
					map[string]any{"literal": map[string]any{"string": "!"}},
				}}
			default:
				continue
			}
			rule["alternatives"] = append(rule["alternatives"].([]any), map[string]any{"guards": []any{}, "expr": expr})
		}
	})
	for _, c := range []struct {
		grammar string
		column  int
	}{
		{`%rule text bad_name? A`, 12},
		{`%rule text bad_name? [A]="x"`, 12},
		{"%classifier c bad_name? \"a\" ∈ A\n%rule text _", 15},
		{`%rule text ¬fine! A`, 12},
		{`%rule text ¬fine! [A]="x"`, 12},
		{"%classifier c ¬fine! \"a\" ∈ A\n%rule text _", 15},
	} {
		t.Run(c.grammar, func(t *testing.T) {
			_, err := LoadPipelineSources(sourcesWithBootstrap(c.grammar, bootstrap), "grammars/test/p.md")
			var e *Error
			if !errors.As(err, &e) || e.Kind != ErrorGrammar || e.Document != "grammars/test/main.md" || e.Line != 3 || e.Column != c.column {
				t.Fatalf("expected the guard at 3:%d, got %v", c.column, err)
			}
		})
	}
	// Capital-initial feature names and ordinary gates remain valid.
	for _, grammar := range []string{`%rule text Cbm? A | ¬Cbm? B | fine? C`, "%classifier c Cbm? \"a\" ∈ A\n%rule text _"} {
		if _, err := LoadPipelineSources(sourcesWithBootstrap(grammar, bootstrap), "grammars/test/p.md"); err != nil {
			t.Fatalf("valid guards: %v", err)
		}
	}
}

func TestPropertyWrapperFromSuppliedBootstrap(t *testing.T) {
	t.Parallel()
	bootstrap := bootstrapWithDOMChange(t, func(path string, dom map[string]any) {
		if path != "grammars/gencmu/jbogenbau/syntax.md" {
			return
		}
		for _, value := range dom["rules"].([]any) {
			rule := value.(map[string]any)
			if rule["name"] != "untested-primary" {
				continue
			}
			for _, alternative := range rule["alternatives"].([]any) {
				expr := alternative.(map[string]any)["expr"].(map[string]any)
				if expr["ref"] == "string-terminal" {
					expr["ref"] = "property"
				}
			}
		}
		dom["rules"] = append(dom["rules"].([]any), map[string]any{
			"name": "property", "op": "define",
			"alternatives": []any{map[string]any{"guards": []any{}, "expr": map[string]any{"ref": "string-terminal"}}},
			"conditions":   []any{}, "at": []any{1, 1},
		})
	})
	pipeline, err := LoadPipelineSources(sourcesWithBootstrap(`%rule text "a" %emits $`, bootstrap), "grammars/test/p.md")
	if err != nil {
		t.Fatal(err)
	}
	result, err := pipeline.Parse("a", ParseOptions{})
	if err != nil || !result.OK {
		t.Fatalf("wrapped string terminal: %v %+v", err, result)
	}
}

func TestEmptyGuardWrapperValidation(t *testing.T) {
	t.Parallel()
	bootstrap := bootstrapWithDOMChange(t, func(path string, dom map[string]any) {
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
			dom["rules"] = append(dom["rules"].([]any), map[string]any{"name": "padding", "op": "define", "alternatives": []any{map[string]any{"guards": []any{}, "expr": map[string]any{"empty": true}}}, "conditions": []any{}, "at": []any{1, 1}})
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
			_, err := LoadPipelineSources(sourcesWithBootstrap(c.grammar, bootstrap), "grammars/test/p.md")
			var e *Error
			if !errors.As(err, &e) || e.Kind != ErrorGrammar || e.Document != "grammars/test/main.md" || e.Line != 3 || e.Column != c.column {
				t.Fatalf("guard at 3:%d: %v", c.column, err)
			}
		})
	}
}

func TestEmptyConstructorAnchorAtDocumentEnd(t *testing.T) {
	t.Parallel()
	gt := extractGrammarText(block("A"), &unicodeTable{})
	end := len(gt.text)
	b := &domBuilder{gt: gt, toks: []Token{{Source: [2]int{0, end}}}}
	node := &Node{Kind: KindRule, Span: [2]int{1, 1}, Children: []*Node{{Kind: KindRule, Source: [2]int{0, 0}}}}
	if got := b.at(node); got != gt.at(end) {
		t.Fatalf("empty constructor anchor %v, want %v", got, gt.at(end))
	}
}

func preparsedCacheForSources(t *testing.T, sources map[string]string) string {
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

func TestNotationCaseSchemaRejectsInvalidMembers(t *testing.T) {
	for _, raw := range []string{
		`{"document":"","unknown":true,"expect":{"dom":{}}}`,
		`{"document":"","expect":{"unknown":true}}`,
		`{"document":"","expect":{"error":{"unknown":true}}}`,
		`{"document":"","expect":{"dom":{},"error":{}}}`,
		`{"document":"","expect":{"error":null}}`,
		`{"document":"","expect":{"error":{"line":null}}}`,
	} {
		if _, err := decodeNotationCase([]byte(raw)); err == nil {
			t.Errorf("accepted invalid case %s", raw)
		}
	}
}
