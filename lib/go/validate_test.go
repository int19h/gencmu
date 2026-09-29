package gencmu

import (
	"encoding/json"
	"strconv"
	"strings"
	"testing"
)

// One malformed DOM per rule the reader enforces (engine §9, docs/output.md
// "A grammar DOM"): each is refused when decoded, and as a compiled.json
// entry it is a miss, so the document is read instead.
func TestDOMRules(t *testing.T) {
	loadBundled()
	const good = `{"seq":[{"terminal":"a"},{"terminal":"b"}]}`
	format := `"format":` + strconv.Itoa(domFormat)
	rule := func(fields string) string {
		return `{` + format + `,"rules":[{"name":"text","op":"define",` + fields + `,"at":[1,1]}],"directives":[{"name":"ambiguity-resolution","args":["greedy"],"at":[2,1]}]}`
	}
	guarded := func(guard string) string {
		return rule(`"alternatives":[{"guards":[` + guard + `],"expr":` + good + `}],"conditions":[]`)
	}
	alt := func(expr string) string {
		return rule(`"alternatives":[{"guards":[],"expr":` + expr + `}],"conditions":[]`)
	}
	// A second directive after the first.
	directive := func(dir string) string {
		return strings.Replace(alt(good), `"at":[2,1]}]}`, `"at":[2,1]},`+dir+`]}`, 1)
	}
	tagged := func(tags string) string {
		return rule(`"alternatives":[{"guards":[],"expr":{"seq":[{"capture":"x","expr":{"terminal":"a"}},{"terminal":"b"}]},"tags":` + tags + `}],"conditions":[]`)
	}
	emit := func(emission string) string {
		return rule(`"alternatives":[{"guards":[],"expr":{"seq":[{"capture":"x","expr":{"terminal":"a"}},{"capture":"y","expr":{"terminal":"b"}}]}}],"emit":` + emission + `,"conditions":[]`)
	}
	cond := func(condition string) string {
		return rule(`"alternatives":[{"guards":[],"expr":{"seq":[{"capture":"x","expr":{"terminal":"a"}},{"terminal":"b"}]}}],"conditions":[` + condition + `]`)
	}
	// Two alternatives, the first capturing x and z, the second neither.
	two := func(clauses string) string {
		return rule(`"alternatives":[{"guards":[],"expr":{"seq":[{"capture":"x","expr":{"terminal":"a"}},{"capture":"z","expr":{"terminal":"b"}}]}},{"guards":[],"expr":{"seq":[{"terminal":"a"},{"terminal":"b"}]}}],` + clauses)
	}
	// n unions, each of a tag and the next: the innermost tag is n
	// deep.
	unions := func(n int) string {
		return strings.Repeat(`{"union":[{"tag":"Y"},`, n) + `{"tag":"X"}` + strings.Repeat(`]}`, n)
	}
	// n optionals around a sequence of two terminals: the terminals are
	// n+1 deep.
	nested := func(n int) string {
		return strings.Repeat(`{"optional":`, n) + good + strings.Repeat(`}`, n)
	}
	cases := []struct{ rule, dom string }{
		{"format 3", strings.Replace(alt(good), format, `"format":3`, 1)},
		{"a rule's name is a name", strings.Replace(alt(good), `"name":"text"`, `"name":"9x"`, 1)},
		{"a rule's name is a name or #", strings.Replace(alt(good), `"name":"text"`, `"name":"##"`, 1)},
		{"op is define, redefine or extend", strings.Replace(alt(good), `"define"`, `"replace"`, 1)},
		// A compared term has exactly the members of one form, in either
		// order: read as the string, either would reject "ab".
		{"a compared tag that is also a string", cond(`{"op":"=","left":{"call":"text","args":[{"capture":"x"}]},"right":{"tag":"Bad","string":"wrong"}}`)},
		{"a compared string that is also a tag", cond(`{"op":"=","left":{"call":"text","args":[{"capture":"x"}]},"right":{"string":"wrong","tag":"Bad"}}`)},
		{"a difference that is also a union", tagged(`{"difference":[{"tag":"X"},{"tag":"Y"}],"union":[{"tag":"X"},{"tag":"Y"}]}`)},
		{"a union that is also a difference", tagged(`{"union":[{"tag":"X"},{"tag":"Y"}],"difference":[{"tag":"X"},{"tag":"Y"}]}`)},
		// A definition as a whole (engine §9, the end).
		{"a mentioned capture is captured", cond(`{"matches":{"capture":"z"},"rule":"text"}`)},
		{"a tested capture is captured", cond(`{"captured":"z"}`)},
		{"a condition applies to an alternative", cond(`{"captured":"x"}`)},
		{"a rule's tags use captures every alternative has", two(`"tags":{"call":"tags","args":[{"capture":"x"}]},"conditions":[]`)},
		{"an item's tags use captures its alternatives have", two(`"emit":{"items":[{"capture":"z","tags":{"call":"tags","args":[{"capture":"x"}]}}]},"conditions":[]`)},
		{"captures are emitted in text order", emit(`{"items":[{"capture":"y"},{"capture":"x"}]}`)},
		{"an inserted tag's anchor is in every alternative", two(`"emit":{"items":[{"insert":"T"},{"capture":"x"}]},"conditions":[]`)},
		{"every alternative emits something", two(`"emit":{"items":[{"capture":"x"}]},"conditions":[]`)},
		{"a verbatim rule does not emit ε", emit(`{"items":[]},"verbatim":true`)},
		{"verbatim is true or absent", strings.Replace(alt(good), `"conditions":[]`, `"conditions":[],"verbatim":false`, 1)},
		{"a guard does not read the constituent's tags", tagged(`{"if":{"op":"⊆","left":{"tag":"a"},"right":{"call":"tags","args":[{"capture":""}]}},"then":{"tag":"T"}}`)},
		{"a guarded term has a term", tagged(`{"if":{"captured":"x"}}`)},
		{"an implication has a consequent", cond(`{"if":{"captured":"x"}}`)},
		{"a presence test names a capture", cond(`{"captured":"9"}`)},
		{"a rule has alternatives", rule(`"alternatives":[],"conditions":[]`)},
		{"a rule has conditions", rule(`"alternatives":[{"guards":[],"expr":` + good + `}]`)},
		{"a rule has a position", strings.Replace(alt(good), `"at":[1,1]}],"directives"`, `"at":[1]}],"directives"`, 1)},
		{"a guard has a feature and negated", rule(`"alternatives":[{"guards":[{"feature":"f"}],"expr":` + good + `}],"conditions":[]`)},
		{"a guard has a kind", guarded(`{"feature":"f","negated":false}`)},
		{"a guard is a gate or a warning", guarded(`{"feature":"f","kind":"hint","negated":false}`)},
		{"a warning is never negated", guarded(`{"feature":"f","kind":"warning","negated":true}`)},
		{"an alternative has guards", rule(`"alternatives":[{"expr":` + good + `}],"conditions":[]`)},
		{"a seq has two items or more", alt(`{"seq":[{"terminal":"a"}]}`)},
		{"a seq is not empty", alt(`{"seq":[]}`)},
		{"a choice has two items or more", alt(`{"choice":[{"terminal":"a"}]}`)},
		{"an & has two items or more", alt(`{"and":[{"terminal":"a"}]}`)},
		{"an & has at most 16 items", alt(`{"and":[` + strings.TrimSuffix(strings.Repeat(`{"terminal":"a"},`, 17), ",") + `]}`)},
		{"a repetition's min is 0 or 1", alt(`{"repeat":{"terminal":"a"},"min":2}`)},
		{"a capture wraps a reference or terminal", alt(`{"capture":"x","expr":{"optional":{"terminal":"a"}}}`)},
		{"a capture stands at the top level (optional)", alt(`{"seq":[{"optional":{"capture":"x","expr":{"terminal":"a"}}},{"terminal":"b"}]}`)},
		{"a capture stands at the top level (choice)", alt(`{"choice":[{"capture":"x","expr":{"terminal":"a"}},{"terminal":"b"}]}`)},
		{"a capture stands at the top level (&)", alt(`{"and":[{"capture":"x","expr":{"terminal":"a"}},{"terminal":"b"}]}`)},
		{"a capture stands at the top level (repetition)", alt(`{"seq":[{"terminal":"a"},{"repeat":{"capture":"x","expr":{"terminal":"b"}},"min":1}]}`)},
		{"at most four captures per alternative", alt(`{"seq":[{"capture":"a","expr":{"terminal":"a"}},{"capture":"b","expr":{"terminal":"b"}},{"capture":"c","expr":{"ref":"C"}},{"capture":"d","expr":{"ref":"D"}},{"capture":"e","expr":{"ref":"E"}}]}`)},
		{"a capture's symbol counts toward the nesting", alt(`{"seq":[` + strings.Repeat(`{"seq":[{"terminal":"a"},`, 255) + `{"capture":"x","expr":{"terminal":"b"}}` + strings.Repeat(`]}`, 255) + `,{"terminal":"b"}]}`)},
		{"a term nests at most 256 deep", tagged(unions(257))},
		{"a condition nests at most 256 deep", cond(strings.Repeat(`{"not":`, 256) + `{"matches":{"capture":"x"},"rule":"text"}` + strings.Repeat(`}`, 256))},
		{"an emitted item's term nests at most 256 deep", emit(`{"items":[{"capture":"","tags":` + unions(257) + `}]}`)},
		{"a capture name once per alternative", alt(`{"seq":[{"capture":"x","expr":{"terminal":"a"}},{"capture":"x","expr":{"terminal":"b"}}]}`)},
		{"a flag is true", alt(`{"seq":[{"terminal":"a"},{"empty":false}]}`)},
		{"# is not an expression", alt(`{"seq":[{"terminal":"a"},{"hash":true}]}`)},
		{"$ wraps nothing", alt(`{"seq":[{"capture":"","expr":{"terminal":"a"}},{"terminal":"b"}]}`)},
		{"an expression is known", alt(`{"seq":[{"terminal":"a"},{"what":"b"}]}`)},
		{"a reference names something", alt(`{"seq":[{"terminal":"a"},{"ref":""}]}`)},
		{"a captured reference names something", alt(`{"seq":[{"terminal":"a"},{"capture":"x","expr":{"ref":""}}]}`)},
		{"an emission has only items", emit(`{"items":[{"capture":"x"}],"what":true}`)},
		{"$ only with $ (a capture)", emit(`{"items":[{"capture":""},{"capture":"x"}]}`)},
		{"$ only with $ (an inserted tag)", emit(`{"items":[{"capture":""},{"insert":"/a/"}]}`)},
		{"an item is a capture or an inserted tag", emit(`{"items":[{"capture":"x","insert":"y"}]}`)},
		{"an item has only capture, insert and tags", emit(`{"items":[{"capture":"x","tags":{"tag":"X"},"what":true}]}`)},
		{"no ∅ as an item's tags", emit(`{"items":[{"capture":"x","tags":{"emptySet":true}}]}`)},
		{"a capture listed once", emit(`{"items":[{"capture":"x"},{"capture":"x"}]}`)},
		// Spellings (engine §9).
		{"a spelling is not empty", alt(`{"seq":[{"terminal":"a"},{"spelling":"","expr":{"ref":"B"}}]}`)},
		{"a spelling is in lower case", alt(`{"seq":[{"terminal":"a"},{"spelling":"lA","expr":{"ref":"B"}}]}`)},
		{"a spelling is in lower case (Cyrillic)", alt(`{"seq":[{"terminal":"a"},{"spelling":"Ла","expr":{"ref":"B"}}]}`)},
		{"a spelling does not follow #", alt(`{"seq":[{"terminal":"a"},{"spelling":"b","expr":{"ref":"#"}}]}`)},
		{"a spelling does not follow a group", alt(`{"seq":[{"terminal":"a"},{"spelling":"b","expr":{"seq":[{"ref":"B"},{"ref":"C"}]}}]}`)},
		{"a spelling does not follow a spelling", alt(`{"seq":[{"terminal":"a"},{"spelling":"b","expr":{"spelling":"b","expr":{"ref":"B"}}}]}`)},
		{"a spelling is a string", alt(`{"seq":[{"terminal":"a"},{"spelling":1,"expr":{"ref":"B"}}]}`)},
		{"a spelling has no backtick", alt("{\"seq\":[{\"terminal\":\"a\"},{\"spelling\":\"b`c\",\"expr\":{\"ref\":\"B\"}}]}")},
		{"a spelled reference is not also empty", alt(`{"seq":[{"terminal":"a"},{"spelling":"b","expr":{"empty":true,"ref":"B"}}]}`)},
		{"a spelled reference is not also a terminal", alt(`{"seq":[{"terminal":"a"},{"spelling":"b","expr":{"ref":"B","terminal":"b"}}]}`)},
		{"a spelled symbol is not also empty", alt(`{"seq":[{"terminal":"a"},{"spelling":"b","expr":{"ref":"B"},"empty":true}]}`)},
		{"a spelled symbol has its symbol", alt(`{"seq":[{"terminal":"a"},{"spelling":"b","ref":"B"}]}`)},
		{"a spelled symbol is not also a capture", alt(`{"seq":[{"terminal":"a"},{"capture":"x","spelling":"B","expr":{"ref":"B"}}]}`)},
		{"a spelled symbol is not also an optional", alt(`{"seq":[{"terminal":"a"},{"optional":{"ref":"B"},"spelling":"b","expr":{"ref":"#"}}]}`)},
		{"a capture of a spelled symbol is checked", alt(`{"seq":[{"terminal":"a"},{"capture":"x","expr":{"spelling":"B","expr":{"ref":"B"}}}]}`)},
		{"a spelled symbol counts toward the nesting", alt(`{"seq":[` + strings.Repeat(`{"seq":[{"terminal":"a"},`, 255) + `{"spelling":"b","expr":{"terminal":"b"}}` + strings.Repeat(`]}`, 255) + `,{"terminal":"b"}]}`)},
		{"no tags on an inserted tag", emit(`{"items":[{"capture":"x"},{"insert":"y","tags":{"tag":"Z"}}]}`)},
		{"an emission's items are a list", emit(`{"items":null}`)},
		{"a function exists", tagged(`{"call":"size","args":[{"capture":"x"}]}`)},
		{"phonemes takes one span", tagged(`{"call":"phonemes","args":[{"capture":"x"},{"capture":"x"}]}`)},
		{"text takes a span", tagged(`{"call":"text","args":[{"string":"x"}]}`)},
		{"tags takes a span and a rule name", tagged(`{"call":"tags","args":[{"capture":"x"},{"string":"r"}]}`)},
		{"lowercase takes a string", tagged(`{"call":"lowercase","args":[{"tag":"X"}]}`)},
		{"a capture is not on the left of ∈", cond(`{"op":"∈","left":{"capture":"x"},"right":{"capture":"x"}}`)},
		{"tags() is not on the left of ∉", cond(`{"op":"∉","left":{"call":"tags","args":[{"capture":"x"}]},"right":{"string":"b"}}`)},
		{"head is a span, not a value", tagged(`{"call":"head","args":[{"capture":"x"}]}`)},
		{"head takes a span", tagged(`{"call":"tags","args":[{"call":"head","args":[{"tag":"x"}]}]}`)},
		{"matches is never a term", tagged(`{"call":"matches","args":[{"capture":"x"},{"rule":"text"}]}`)},
		{"initial is never a term", tagged(`{"call":"initial","args":[{"capture":"x"}]}`)},
		{"a union has two parts or more", tagged(`{"union":[{"tag":"X"}]}`)},
		{"an intersection has two parts or more", tagged(`{"intersection":[]}`)},
		{"a term is known", tagged(`{"what":"X"}`)},
		{"no set", tagged(`{"set":[{"tag":"X"},{"tag":"Y"}]}`)},
		// No weak tag and no untyped literal (engine §10); a difference has
		// exactly two parts.
		{"no weak tag", tagged(`{"weak":"X"}`)},
		{"no literal", tagged(`{"literal":"X"}`)},
		{"a difference has two parts", tagged(`{"difference":[{"tag":"X"},{"tag":"Y"},{"tag":"Z"}]}`)},
		{"a tag is canonical", tagged(`{"tag":"'\\'"}`)},
		{"a tag is a tag", tagged(`{"tag":"a b"}`)},
		// The types of terms and conditions agree (engine §10).
		{"a span is not a value in ∈", cond(`{"op":"∈","left":{"capture":"x"},"right":{"call":"runs","args":[{"capture":"x"}]}}`)},
		{"∈ tests a string in a set of strings", cond(`{"op":"∈","left":{"string":"b"},"right":{"call":"tags","args":[{"capture":"x"}]}}`)},
		{"⊆ compares sets of one kind", cond(`{"op":"⊆","left":{"tag":"a"},"right":{"call":"runs","args":[{"capture":"x"}]}}`)},
		{"= compares values of one type", cond(`{"op":"=","left":{"call":"text","args":[{"capture":"x"}]},"right":{"tag":"a"}}`)},
		{"the kind of ∅ = ∅ is given", cond(`{"op":"=","left":{"emptySet":true},"right":{"emptySet":true}}`)},
		{"a tag term is a tag set", tagged(`{"string":"x"}`)},
		{"a union joins sets of one kind", tagged(`{"union":[{"call":"tags","args":[{"capture":"x"}]},{"call":"runs","args":[{"capture":"x"}]}]}`)},
		{"lowercase takes a string, not a span", tagged(`{"call":"lowercase","args":[{"capture":"x"}]}`)},
		// Capture names, terminals and inserted tags (engine §1, §9).
		{"a capture name is lower case", alt(`{"seq":[{"capture":"X","expr":{"ref":"A"}},{"ref":"B"}]}`)},
		{"a terminal is a tag", alt(`{"seq":[{"terminal":"é"},{"terminal":"b"}]}`)},
		{"a terminal is one character", alt(`{"seq":[{"terminal":"'ab'"},{"terminal":"b"}]}`)},
		{"an inserted tag is a tag", emit(`{"items":[{"insert":"a b"},{"capture":"x"}]}`)},
		{"an inserted tag is canonical", emit(`{"items":[{"insert":"'\\u{61}'"},{"capture":"x"}]}`)},
		{"elidable takes names", directive(`{"name":"elidable","args":["/a/"],"at":[3,1]}`)},
		{"a call's arguments are a list", tagged(`{"call":"tags","args":null}`)},
		{"a rule's tag term is well formed", rule(`"tags":{"call":"classes","args":null},"alternatives":[{"guards":[],"expr":` + good + `}],"conditions":[]`)},
		{"an alternative's tags are not $", tagged(`{"union":[{"tag":"X"},{"capture":""}]}`)},
		{"an alternative's tags are not tags($)", tagged(`{"call":"tags","args":[{"capture":""}]}`)},
		{"an alternative's tags are not classes($)", tagged(`{"call":"classes","args":[{"capture":""}]}`)},
		{"a rule's tags are not tags($)", rule(`"tags":{"call":"tags","args":[{"capture":""}]},"alternatives":[{"guards":[],"expr":` + good + `}],"conditions":[]`)},
		{"a comparison is known", cond(`{"op":"<","left":{"string":"a"},"right":{"string":"b"}}`)},
		{"a comparison has two terms", cond(`{"op":"=","left":{"string":"a"}}`)},
		{"an any has two conditions or more", cond(`{"any":[{"not":{"matches":{"capture":"x"},"rule":"text"}}]}`)},
		{"an all has two conditions or more", cond(`{"all":[{"not":{"matches":{"capture":"x"},"rule":"text"}}]}`)},
		{"an all counts toward the nesting", cond(strings.Repeat(`{"all":[{"matches":{"capture":"x"},"rule":"text"},`, 256) + `{"matches":{"capture":"x"},"rule":"text"}` + strings.Repeat(`]}`, 256))},
		{"matches takes a span", cond(`{"matches":{"tag":"x"},"rule":"text"}`)},
		{"matches takes a rule", cond(`{"matches":{"capture":"x"}}`)},
		{"begins takes a span", cond(`{"begins":{"tag":"x"},"rule":"text"}`)},
		{"begins takes a rule", cond(`{"begins":{"capture":"x"}}`)},
		{"a condition is matches or begins, not both", cond(`{"matches":{"capture":"x"},"begins":{"capture":"x"},"rule":"text"}`)},
		{"a capture begins mentions is captured", cond(`{"begins":{"call":"after","args":[{"capture":"z"}]},"rule":"text"}`)},
		{"begins counts toward the nesting", cond(strings.Repeat(`{"not":`, 256) + `{"begins":{"capture":"x"},"rule":"text"}` + strings.Repeat(`}`, 256))},
		{"begins is never a term", tagged(`{"call":"begins","args":[{"capture":"x"},{"rule":"text"}]}`)},
		{"from is a span, not a value", tagged(`{"call":"from","args":[{"capture":"x"}]}`)},
		{"after takes a span", tagged(`{"call":"tags","args":[{"call":"after","args":[{"tag":"x"}]}]}`)},
		{"initial takes a span", cond(`{"initial":{"tag":"x"}}`)},
		{"initial has only its span", cond(`{"initial":{"capture":"x"},"rule":"text"}`)},
		{"initial counts toward the nesting", cond(strings.Repeat(`{"not":`, 256) + `{"initial":{"capture":"x"}}` + strings.Repeat(`}`, 256))},
		{"nesting at most 256", alt(nested(256))},
		{"a directive has arguments", strings.Replace(alt(good), `"args":["greedy"],`, ``, 1)},
		{"a directive has a position", strings.Replace(alt(good), `"args":["greedy"],"at":[2,1]`, `"args":["greedy"],"at":[2,1,1]`, 1)},
		// The pipeline directives' operands (engine §9).
		{"a stage has a name", directive(`{"name":"stage","args":[],"at":[3,1]}`)},
		{"a stage has one name", directive(`{"name":"stage","args":["a","b"],"at":[3,1]}`)},
		{"a stage's name is a name", directive(`{"name":"stage","args":["9a"],"at":[3,1]}`)},
		{"an include has a path", directive(`{"name":"include","args":[],"at":[3,1]}`)},
		{"an include has one path", directive(`{"name":"include","args":["a.md","b.md"],"at":[3,1]}`)},
		{"features names a feature", directive(`{"name":"features","args":[],"at":[3,1]}`)},
		{"features names only names", directive(`{"name":"features","args":["a","b c"],"at":[3,1]}`)},
		// The order of items is the order of their positions (engine §9).
		{"two directives at one position", directive(`{"name":"elidable","args":["A"],"at":[2,1]}`)},
		{"a rule and a directive at one position", strings.Replace(alt(good), `"at":[2,1]`, `"at":[1,1]`, 1)},
	}
	// Each variation's well-formed twin decodes, so that the refusals are
	// the rule's and not the test's.
	for _, ok := range []string{alt(good), alt(nested(255)),
		// A gate, negated or not, and a warning.
		guarded(`{"feature":"f","kind":"gate","negated":true}`), guarded(`{"feature":"f","kind":"gate","negated":false},{"feature":"g","kind":"warning","negated":false}`),
		alt(`{"seq":[{"capture":"a","expr":{"terminal":"a"}},{"capture":"b","expr":{"terminal":"b"}},{"capture":"c","expr":{"ref":"C"}},{"capture":"d","expr":{"ref":"D"}}]}`),
		// Each at the bound: the deepest node below exactly 256 compound ones.
		alt(`{"seq":[` + strings.Repeat(`{"seq":[{"terminal":"a"},`, 254) + `{"capture":"x","expr":{"terminal":"b"}}` + strings.Repeat(`]}`, 254) + `,{"terminal":"b"}]}`),
		tagged(unions(256)),
		strings.Replace(alt(good), `"name":"text"`, `"name":"#"`, 1),
		// The pipeline directives with their operands; an include's path
		// is any string.
		directive(`{"name":"stage","args":["a-1"],"at":[3,1]}`), directive(`{"name":"include","args":["../a b\\\"c.md"],"at":[3,1]}`),
		directive(`{"name":"features","args":["a","b-c"],"at":[3,1]}`),
		directive(`{"name":"elidable","args":["KU","ku"],"at":[3,1]}`),
		// Terms of each type where they agree, and canonical tags.
		tagged(`{"difference":[{"tag":"X"},{"tag":"Y"}]}`), tagged(`{"tag":"'\\u{5C}'"}`),
		cond(`{"op":"=","left":{"call":"text","args":[{"capture":"x"}]},"right":{"string":"wrong"}}`),
		alt(`{"seq":[{"terminal":"'é'"},{"terminal":"'\\u{301}'"}]}`), emit(`{"items":[{"insert":"'a'"},{"capture":"x"}]}`),
		cond(`{"op":"∈","left":{"call":"text","args":[{"capture":"x"}]},"right":{"call":"runs","args":[{"capture":"x"}]}}`),
		cond(`{"op":"⊈","left":{"tag":"a"},"right":{"call":"tags","args":[{"capture":"x"}]}}`),
		cond(`{"op":"=","left":{"emptySet":true},"right":{"call":"runs","args":[{"capture":"x"}]}}`),
		// An emission and its items are not compound: an item's term counts
		// from the top.
		emit(`{"items":[{"capture":"","tags":` + unions(256) + `}]}`),
		cond(strings.Repeat(`{"not":`, 255) + `{"matches":{"capture":"x"},"rule":"text"}` + strings.Repeat(`}`, 255)), emit(`{"items":[{"capture":""},{"capture":""}]}`), emit(`{"items":[{"insert":"y"},{"capture":"x"}]}`),
		// ε, no items, for one alternative and for several.
		emit(`{"items":[]}`), two(`"emit":{"items":[]},"conditions":[]`),
		emit(`{"items":[{"capture":"x"},{"insert":"y"},{"capture":"y","tags":{"call":"tags","args":[{"capture":""}]}}]}`),
		tagged(`{"call":"tags","args":[{"capture":""},{"rule":"text"}]}`), tagged(`{"call":"tags","args":[{"call":"head","args":[{"capture":""}]}]}`),
		cond(`{"all":[{"matches":{"capture":""},"rule":"text"},{"op":"⊆","left":{"tag":"a"},"right":{"call":"tags","args":[{"capture":""}]}}]}`),
		cond(strings.Repeat(`{"all":[{"matches":{"capture":"x"},"rule":"text"},`, 255) + `{"matches":{"capture":"x"},"rule":"text"}` + strings.Repeat(`]}`, 255)),
		cond(`{"op":"=","left":{"call":"lowercase","args":[{"call":"text","args":[{"call":"head","args":[{"capture":"x"}]}]}]},"right":{"string":"a"}}`),
		cond(`{"any":[{"not":{"matches":{"capture":"x"},"rule":"text"}},{"op":"=","left":{"string":"a"},"right":{"string":"a"}}]}`),
		cond(strings.Repeat(`{"not":`, 254) + `{"initial":{"call":"tail","args":[{"capture":"x"}]}}` + strings.Repeat(`}`, 254)),
		// A lookahead, at the bound, and the tokens' tags from $ on.
		cond(strings.Repeat(`{"not":`, 254) + `{"begins":{"call":"after","args":[{"capture":"x"}]},"rule":"text"}` + strings.Repeat(`}`, 254)),
		cond(`{"begins":{"call":"from","args":[{"call":"tail","args":[{"capture":""}]}]},"rule":"text"}`),
		tagged(`{"call":"tags","args":[{"call":"from","args":[{"capture":""}]}]}`),
		// Spelled symbols, captured or not, and at the bound of the nesting.
		alt(`{"seq":[{"capture":"x","expr":{"spelling":"la'i","expr":{"ref":"LE"}}},{"spelling":"a","expr":{"terminal":"/a/"}}]}`),
		alt(`{"seq":[` + strings.Repeat(`{"seq":[{"terminal":"a"},`, 254) + `{"spelling":"b","expr":{"terminal":"b"}}` + strings.Repeat(`]}`, 254) + `,{"terminal":"b"}]}`),
		strings.Replace(alt(good), `"define"`, `"redefine"`, 1),
		strings.Replace(alt(good), `"conditions":[]`, `"conditions":[],"verbatim":true`, 1), emit(`{"items":[{"capture":"x"}]},"verbatim":true`),
		// Clauses that serve alternatives with different captures.
		two(`"tags":{"union":[{"tag":"T"},{"if":{"captured":"x"},"then":{"call":"tags","args":[{"capture":"x"}]}}]},"conditions":[]`),
		two(`"conditions":[{"captured":"x"},{"if":{"captured":"z"},"then":{"matches":{"capture":"z"},"rule":"text"}}]`),
		two(`"emit":{"items":[{"capture":"x"},{"insert":"T"}]},"conditions":[]`),
		two(`"emit":{"items":[{"capture":"x","tags":{"call":"tags","args":[{"capture":"z"}]}},{"capture":"z"},{"insert":"T"}]},"conditions":[]`)} {
		if _, err := decodeDOM(json.RawMessage(ok), bundled.uni); err != nil {
			t.Fatalf("a well-formed DOM is refused: %v\n%s", err, ok)
		}
	}
	sources := oneStage("%ambiguity-resolution greedy\n%rule text 'a' 'b'")
	for _, c := range cases {
		if _, err := decodeDOM(json.RawMessage(c.dom), bundled.uni); err == nil {
			t.Errorf("%s: a DOM breaking it decodes", c.rule)
			continue
		}
		src := map[string]string{}
		for k, v := range sources {
			src[k] = v
		}
		src["compiled.json"] = `{` + format + `,"bootstrap":"` + bundled.reader.hash + `","documents":{"g.md":{"hash":"` + fnv1a64(src["g.md"]) + `","dom":` + c.dom + `}}}`
		d, err := LoadDialectSources(src, "p.md")
		if err != nil {
			t.Errorf("%s: %v", c.rule, err)
			continue
		}
		if res, err := d.Parse("ab", ParseOptions{}); err != nil || !res.OK {
			t.Errorf("%s: the cache entry was used: %v %+v", c.rule, err, res.Error)
		}
	}
}

// The reader holds a document to the nesting limit too, at the rule.
func TestReaderNesting(t *testing.T) {
	loadBundled()
	doc := func(n int) string {
		return "```jbogenbau\n\n%rule text " + strings.Repeat("[", n) + "A" + strings.Repeat("]", n) + "\n```\n"
	}
	if _, err := bundled.reader.read(doc(256), "g.md"); err != nil {
		t.Fatalf("256 deep: %v", err)
	}
	_, err := bundled.reader.read(doc(257), "g.md")
	if err == nil || err.Line != 3 || err.Column != 1 {
		t.Fatalf("257 deep: expected an error at the rule, 3:1, got %v", err)
	}
}
