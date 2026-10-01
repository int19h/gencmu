package gencmu

import (
	"encoding/json"
	"errors"
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
		return `{` + format + `,"rules":[{"name":"text","op":"define",` + fields + `,"at":[1,1]}],"directives":[{"name":"ambiguity-resolution","args":["greedy"],"at":[2,1]}],"constants":[],"classifiers":[],"implications":[]}`
	}
	guarded := func(guard string) string {
		return rule(`"alternatives":[{"guards":[` + guard + `],"expr":` + good + `}],"conditions":[]`)
	}
	alt := func(expr string) string {
		return rule(`"alternatives":[{"guards":[],"expr":` + expr + `}],"conditions":[]`)
	}
	// A second directive after the first.
	directive := func(dir string) string {
		return strings.Replace(alt(good), `"at":[2,1]}]`, `"at":[2,1]},`+dir+`]`, 1)
	}
	// A document with one constant's definition.
	constant := func(k string) string {
		return strings.Replace(alt(good), `"constants":[]`, `"constants":[`+k+`]`, 1)
	}
	// A document with classifiers and implications.
	classified := func(classifiers, implications string) string {
		return strings.Replace(alt(good), `"classifiers":[],"implications":[]`, `"classifiers":[`+classifiers+`],"implications":[`+implications+`]`, 1)
	}
	entry := func(e string) string {
		return classified(`{"name":"lex","entries":[`+e+`],"at":[3,1]}`, "")
	}
	implies := func(m string) string { return classified("", m) }
	runs := `{"call":"split","args":[{"call":"phonemes","args":[{"capture":"x"}]},{"string":"."}]}`
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
		{"an opaque rule does not emit ε", emit(`{"items":[]},"opaque":true`)},
		{"opaque is true or absent", strings.Replace(alt(good), `"conditions":[]`, `"conditions":[],"opaque":false`, 1)},
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
		// A guard has exactly its feature, its kind and whether it is
		// negated, as an entry's guard has.
		{"a guard has no other member", guarded(`{"feature":"f","kind":"gate","negated":false,"extra":true}`)},
		{"a guard is not null", guarded(`null`)},
		{"a guard's negated is a boolean", guarded(`{"feature":"f","kind":"gate","negated":null}`)},
		{"an alternative has a list of guards", rule(`"alternatives":[{"guards":null,"expr":` + good + `}],"conditions":[]`)},
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
		// Attachments are named captures of the rule, on a named capture,
		// each once in the emission, in the order they stand, and present
		// only when not empty (engine §9, §11).
		{"a list of attachments is not empty", emit(`{"items":[{"capture":"x","after":[]}]}`)},
		{"a list of attachments is a list", emit(`{"items":[{"capture":"x","after":"y"}]}`)},
		{"an attachment is a capture's name", emit(`{"items":[{"capture":"x","after":["Y"]}]}`)},
		{"an attachment is not $", emit(`{"items":[{"capture":"x","after":[""]}]}`)},
		{"$ carries no attachments", emit(`{"items":[{"capture":"","after":["y"]}]}`)},
		{"an inserted tag carries no attachments", emit(`{"items":[{"insert":"T","before":["x"]},{"capture":"y"}]}`)},
		{"an attachment is not also an item", emit(`{"items":[{"capture":"x","after":["y"]},{"capture":"y"}]}`)},
		{"an attachment is listed once", emit(`{"items":[{"capture":"x","after":["y","y"]}]}`)},
		{"attachments stand in the order of the captures", emit(`{"items":[{"capture":"x","before":["y"]}]}`)},
		{"an attachment is a capture of the rule", emit(`{"items":[{"capture":"x","after":["z"]}]}`)},
		{"an alternative without the carrier lacks its attachments", rule(`"alternatives":[{"guards":[],"expr":{"seq":[{"capture":"x","expr":{"terminal":"a"}},{"capture":"y","expr":{"terminal":"b"}}]}},{"guards":[],"expr":{"seq":[{"terminal":"a"},{"capture":"y","expr":{"terminal":"b"}}]}}],"emit":{"items":[{"capture":"x","after":["y"]}]},"conditions":[]`)},
		// Tests in a body (engine §2, §9).
		{"a test's comparator is known", alt(`{"seq":[{"terminal":"a"},{"test":"==","value":{"string":"b"},"expr":{"ref":"B"}}]}`)},
		{"a test's comparator is a string", alt(`{"seq":[{"terminal":"a"},{"test":7,"value":{"string":"b"},"expr":{"ref":"B"}}]}`)},
		{"a sound test's string is in lower case", alt(`{"seq":[{"terminal":"a"},{"test":"=","value":{"string":"lA"},"expr":{"ref":"B"}}]}`)},
		{"a sound test's string is in lower case (Cyrillic)", alt(`{"seq":[{"terminal":"a"},{"test":"=","value":{"string":"Ла"},"expr":{"ref":"B"}}]}`)},
		{"a sound test's string has no comma", alt(`{"seq":[{"terminal":"a"},{"test":"≠","value":{"string":"l,a"},"expr":{"ref":"B"}}]}`)},
		{"a sound test's value is a string", alt(`{"seq":[{"terminal":"a"},{"test":"=","value":{"tag":"UI"},"expr":{"ref":"B"}}]}`)},
		{"a tag test's value is a tag set", alt(`{"seq":[{"terminal":"a"},{"test":"⊇","value":{"string":"b"},"expr":{"ref":"B"}}]}`)},
		{"a test's value is closed (tags)", alt(`{"seq":[{"terminal":"a"},{"test":"⊇","value":{"call":"tags","args":[{"capture":""}]},"expr":{"ref":"B"}}]}`)},
		{"a test's value is closed (phonemes)", alt(`{"seq":[{"terminal":"a"},{"test":"=","value":{"call":"phonemes","args":[{"capture":""}]},"expr":{"ref":"B"}}]}`)},
		{"a test's value is closed (a capture)", alt(`{"seq":[{"terminal":"a"},{"test":"=","value":{"capture":"x"},"expr":{"ref":"B"}}]}`)},
		{"a test does not follow #", alt(`{"seq":[{"terminal":"a"},{"test":"=","value":{"string":"b"},"expr":{"ref":"#"}}]}`)},
		{"a test does not follow a group", alt(`{"seq":[{"terminal":"a"},{"test":"=","value":{"string":"b"},"expr":{"seq":[{"ref":"B"},{"ref":"C"}]}}]}`)},
		{"a test does not follow an optional", alt(`{"seq":[{"terminal":"a"},{"test":"=","value":{"string":"b"},"expr":{"optional":{"ref":"B"}}}]}`)},
		{"a test does not follow a test", alt(`{"seq":[{"terminal":"a"},{"test":"=","value":{"string":"b"},"expr":{"test":"=","value":{"string":"b"},"expr":{"ref":"B"}}}]}`)},
		{"a test does not follow a capture", alt(`{"seq":[{"terminal":"a"},{"test":"=","value":{"string":"b"},"expr":{"capture":"x","expr":{"ref":"B"}}}]}`)},
		{"a test does not follow ε", alt(`{"seq":[{"terminal":"a"},{"test":"=","value":{"string":"b"},"expr":{"empty":true}}]}`)},
		{"a tested reference is not also empty", alt(`{"seq":[{"terminal":"a"},{"test":"=","value":{"string":"b"},"expr":{"empty":true,"ref":"B"}}]}`)},
		{"a tested reference is not also a terminal", alt(`{"seq":[{"terminal":"a"},{"test":"=","value":{"string":"b"},"expr":{"ref":"B","terminal":"b"}}]}`)},
		{"a tested symbol is not also empty", alt(`{"seq":[{"terminal":"a"},{"test":"=","value":{"string":"b"},"expr":{"ref":"B"},"empty":true}]}`)},
		{"a tested symbol has its symbol", alt(`{"seq":[{"terminal":"a"},{"test":"=","value":{"string":"b"},"ref":"B"}]}`)},
		{"a tested symbol has its value", alt(`{"seq":[{"terminal":"a"},{"test":"=","expr":{"ref":"B"}}]}`)},
		{"a tested symbol is not also a capture", alt(`{"seq":[{"terminal":"a"},{"capture":"x","test":"=","value":{"string":"b"},"expr":{"ref":"B"}}]}`)},
		{"a tested symbol is not also an optional", alt(`{"seq":[{"terminal":"a"},{"optional":{"ref":"B"},"test":"=","value":{"string":"b"},"expr":{"ref":"#"}}]}`)},
		{"a capture of a tested symbol is checked", alt(`{"seq":[{"terminal":"a"},{"capture":"x","expr":{"test":"=","value":{"string":"B"},"expr":{"ref":"B"}}}]}`)},
		{"a tested symbol counts toward the nesting", alt(`{"seq":[` + strings.Repeat(`{"seq":[{"terminal":"a"},`, 255) + `{"test":"=","value":{"string":"b"},"expr":{"terminal":"b"}}` + strings.Repeat(`]}`, 255) + `,{"terminal":"b"}]}`)},
		{"a test's value counts on from the test", alt(strings.Repeat(`{"optional":`, 255) + `{"test":"⊇","value":{"union":[{"tag":"A"},{"tag":"B"}]},"expr":{"ref":"LE"}}` + strings.Repeat(`}`, 255))},
		{"no tags on an inserted tag", emit(`{"items":[{"capture":"x"},{"insert":"y","tags":{"tag":"Z"}}]}`)},
		{"an emission's items are a list", emit(`{"items":null}`)},
		{"a function exists", tagged(`{"call":"size","args":[{"capture":"x"}]}`)},
		{"phonemes takes one span", tagged(`{"call":"phonemes","args":[{"capture":"x"},{"capture":"x"}]}`)},
		{"text takes a span", tagged(`{"call":"text","args":[{"string":"x"}]}`)},
		{"tags takes a span and a rule name", tagged(`{"call":"tags","args":[{"capture":"x"},{"string":"r"}]}`)},
		{"lowercase is not a function", tagged(`{"call":"lowercase","args":[{"string":"X"}]}`)},
		{"runs is not a function", cond(`{"op":"∈","left":{"string":"a"},"right":{"call":"runs","args":[{"capture":"x"}]}}`)},
		{"tag takes a string", tagged(`{"call":"tag","args":[{"tag":"X"}]}`)},
		{"split takes two strings", cond(`{"op":"∈","left":{"string":"a"},"right":{"call":"split","args":[{"string":"a"}]}}`)},
		{"split takes strings, not spans", cond(`{"op":"∈","left":{"string":"a"},"right":{"call":"split","args":[{"capture":"x"},{"string":"."}]}}`)},
		{"split has no empty delimiter", cond(`{"op":"∈","left":{"string":"a"},"right":{"call":"split","args":[{"string":"a"},{"string":""}]}}`)},
		{"tag takes a name", tagged(`{"call":"tag","args":[{"string":"x y"}]}`)},
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
		{"a span is not a value in ∈", cond(`{"op":"∈","left":{"capture":"x"},"right":` + runs + `}`)},
		{"∈ tests a string in a set of strings", cond(`{"op":"∈","left":{"string":"b"},"right":{"call":"tags","args":[{"capture":"x"}]}}`)},
		{"⊆ compares sets of one kind", cond(`{"op":"⊆","left":{"tag":"a"},"right":` + runs + `}`)},
		{"= compares values of one type", cond(`{"op":"=","left":{"call":"text","args":[{"capture":"x"}]},"right":{"tag":"a"}}`)},
		{"the kind of ∅ = ∅ is given", cond(`{"op":"=","left":{"emptySet":true},"right":{"emptySet":true}}`)},
		{"a tag term is a tag set", tagged(`{"string":"x"}`)},
		{"a union joins sets of one kind", tagged(`{"union":[{"call":"tags","args":[{"capture":"x"}]},` + runs + `]}`)},
		{"tag takes a string, not a span", tagged(`{"call":"tag","args":[{"capture":"x"}]}`)},
		// Constants and their definitions (engine §2, §9, §10).
		{"a DOM has constants", strings.Replace(alt(good), `,"constants":[]`, ``, 1)},
		{"constants are a list", strings.Replace(alt(good), `"constants":[]`, `"constants":null`, 1)},
		{"a constant's name begins with a capital", constant(`{"name":"a","op":"define","value":{"tag":"X"},"at":[3,1]}`)},
		{"a constant's op is define or redefine", constant(`{"name":"A","op":"extend","value":{"tag":"X"},"at":[3,1]}`)},
		{"a constant has a value", constant(`{"name":"A","op":"define","at":[3,1]}`)},
		{"a constant has no other member", constant(`{"name":"A","op":"define","value":{"tag":"X"},"at":[3,1],"x":1}`)},
		{"a constant has a position", constant(`{"name":"A","op":"define","value":{"tag":"X"},"at":[3]}`)},
		{"a constant's value holds no capture", constant(`{"name":"A","op":"define","value":{"union":[{"tag":"X"},{"capture":"x"}]},"at":[3,1]}`)},
		{"a constant's value calls no phonemes", constant(`{"name":"A","op":"define","value":{"call":"split","args":[{"call":"phonemes","args":[{"capture":"x"}]},{"string":"."}]},"at":[3,1]}`)},
		{"a constant's value holds no guarded term", constant(`{"name":"A","op":"define","value":{"if":{"op":"⊆","left":{"tag":"X"},"right":{"tag":"Y"}},"then":{"tag":"Z"}},"at":[3,1]}`)},
		{"a constant's value has a kind", constant(`{"name":"A","op":"define","value":{"emptySet":true},"at":[3,1]}`)},
		{"a constant's value is well formed", constant(`{"name":"A","op":"define","value":{"union":[{"tag":"X"}]},"at":[3,1]}`)},
		{"a constant's value agrees in type", constant(`{"name":"A","op":"define","value":{"union":[{"tag":"X"},{"string":"x"}]},"at":[3,1]}`)},
		{"a constant and a rule at one position", constant(`{"name":"A","op":"define","value":{"tag":"X"},"at":[1,1]}`)},
		{"a constant's reference names a constant", tagged(`{"const":"x","at":[1,5]}`)},
		{"a constant's reference has a position", tagged(`{"const":"X"}`)},
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
		// A range or a property is checked as the reader checks it
		// (engine §1, §9).
		{"a range starts at or below its end", alt(`{"range":["'z'","'a'"]}`)},
		{"a range has two ends", alt(`{"range":["'a'"]}`)},
		{"a range's ends are canonical", alt(`{"range":["'\\u{61}'","'z'"]}`)},
		{"a range's ends are character tags", alt(`{"range":["A","'z'"]}`)},
		{"a range's ends are strings", alt(`{"range":["'a'",1]}`)},
		{"a range has no other member", alt(`{"range":["'a'","'z'"],"terminal":"A"}`)},
		{"a property's name is a short form", alt(`{"property":"Letter"}`)},
		{"a property's name has its case", alt(`{"property":"lu"}`)},
		{"a property has no other member", alt(`{"property":"L","range":["'a'","'z'"]}`)},
		{"a tested range is checked", alt(`{"test":"⊇","value":{"tag":"'a'"},"expr":{"range":["'z'","'a'"]}}`)},
		{"a tested property is checked", alt(`{"test":"=","value":{"string":"a"},"expr":{"property":"Letter"}}`)},
		{"a property is not a term", tagged(`{"property":"L"}`)},
		{"a range in a term starts at or below its end", tagged(`{"range":["'z'","'a'"]}`)},
		{"an inserted range is not one tag", emit(`{"items":[{"insert":"'a'..'z'"},{"capture":"x"}]}`)},
		// Classifiers, implications and classify (engine §2, §9).
		{"a DOM has classifiers", strings.Replace(alt(good), `,"classifiers":[]`, ``, 1)},
		{"implications are a list", strings.Replace(alt(good), `"implications":[]`, `"implications":null`, 1)},
		{"a classifier's name begins with a lower-case letter", classified(`{"name":"Lex","entries":[],"at":[3,1]}`, "")},
		{"a classifier has a position", classified(`{"name":"lex","entries":[],"at":null}`, "")},
		{"a classifier has no other member", classified(`{"name":"lex","entries":[],"at":[3,1],"x":true}`, "")},
		{"a classifier's entries are a list", classified(`{"name":"lex","entries":null,"at":[3,1]}`, "")},
		{"an entry takes no warning", entry(`{"guards":[{"feature":"f","kind":"warning","negated":false}],"keys":["mi"],"op":"∈","class":"KOhA","at":[3,3]}`)},
		{"a rule's gate is not empty", guarded(`{"feature":"","kind":"gate","negated":false}`)},
		{"a rule's gate is not a mark", guarded(`{"feature":"!","kind":"gate","negated":false}`)},
		{"a rule's gate has no space", guarded(`{"feature":"bad name","kind":"gate","negated":true}`)},
		{"a warning is not empty", guarded(`{"feature":"","kind":"warning","negated":false}`)},
		{"a warning is not a mark", guarded(`{"feature":"!","kind":"warning","negated":false}`)},
		{"a warning has no space", guarded(`{"feature":"bad name","kind":"warning","negated":false}`)},
		{"a gate's feature is not empty", entry(`{"guards":[{"feature":"","kind":"gate","negated":false}],"keys":["mi"],"op":"∈","class":"KOhA","at":[3,3]}`)},
		{"a gate's feature is not a mark", entry(`{"guards":[{"feature":"!","kind":"gate","negated":false}],"keys":["mi"],"op":"∈","class":"KOhA","at":[3,3]}`)},
		{"a gate's feature has no space", entry(`{"guards":[{"feature":"bad name","kind":"gate","negated":false}],"keys":["mi"],"op":"∈","class":"KOhA","at":[3,3]}`)},
		{"an entry's guard has no other member", entry(`{"guards":[{"feature":"f","kind":"gate","negated":false,"x":1}],"keys":["mi"],"op":"∈","class":"KOhA","at":[3,3]}`)},
		{"an entry has a key", entry(`{"guards":[],"keys":[],"op":"∈","class":"KOhA","at":[3,3]}`)},
		{"a key is in lower case", entry(`{"guards":[],"keys":["Mi"],"op":"∈","class":"KOhA","at":[3,3]}`)},
		{"a key has no comma", entry(`{"guards":[],"keys":["m,i"],"op":"∈","class":"KOhA","at":[3,3]}`)},
		{"a key is a string", entry(`{"guards":[],"keys":[1],"op":"∈","class":"KOhA","at":[3,3]}`)},
		{"an entry's operator is ∈ or ∉", entry(`{"guards":[],"keys":["mi"],"op":"=","class":"KOhA","at":[3,3]}`)},
		{"a class begins with a capital", entry(`{"guards":[],"keys":["mi"],"op":"∈","class":"koha","at":[3,3]}`)},
		{"a class is a name", entry(`{"guards":[],"keys":["mi"],"op":"∈","class":"/a/","at":[3,3]}`)},
		{"an entry has no other member", entry(`{"guards":[],"keys":["mi"],"op":"∈","class":"KOhA","at":[3,3],"x":true}`)},
		{"an implication has a position", implies(`{"if":{"tag":"UI"},"then":{"tag":"m"},"at":null}`)},
		{"an implication has no other member", implies(`{"if":{"tag":"UI"},"then":{"tag":"m"},"at":[3,1],"x":true}`)},
		{"an implication has two sides", implies(`{"if":{"tag":"UI"},"at":[3,1]}`)},
		{"a side of an implication is closed", implies(`{"if":{"tag":"UI"},"then":{"call":"tags","args":[{"capture":"x"}]},"at":[3,1]}`)},
		{"a side of an implication calls no classify", implies(`{"if":{"call":"classify","args":[{"string":"mi"},{"classifier":"lex"}]},"then":{"tag":"m"},"at":[3,1]}`)},
		{"a side of an implication is a tag set", implies(`{"if":{"tag":"UI"},"then":{"string":"a"},"at":[3,1]}`)},
		{"an implication and a rule at one position", implies(`{"if":{"tag":"UI"},"then":{"tag":"m"},"at":[1,1]}`)},
		{"a classifier and an implication at one position", classified(`{"name":"lex","entries":[],"at":[3,1]}`, `{"if":{"tag":"UI"},"then":{"tag":"m"},"at":[3,1]}`)},
		{"classify names a classifier, not a rule", tagged(`{"call":"classify","args":[{"call":"phonemes","args":[{"capture":"x"}]},{"rule":"lex"}]}`)},
		{"a classifier's name in classify begins with a lower-case letter", tagged(`{"call":"classify","args":[{"call":"phonemes","args":[{"capture":"x"}]},{"classifier":"Lex"}]}`)},
		{"classify takes a string, not a span", tagged(`{"call":"classify","args":[{"capture":"x"},{"classifier":"lex"}]}`)},
		{"classify takes a string, not a tag set", tagged(`{"call":"classify","args":[{"tag":"x"},{"classifier":"lex"}]}`)},
		{"classify takes two arguments", tagged(`{"call":"classify","args":[{"call":"phonemes","args":[{"capture":"x"}]}]}`)},
		{"a classifier is not a term", tagged(`{"classifier":"lex"}`)},
		{"split takes no classifier", cond(`{"op":"∈","left":{"string":"a"},"right":{"call":"split","args":[{"string":"a"},{"classifier":"lex"}]}}`)},
		{"split takes no classifier first", cond(`{"op":"∈","left":{"string":"a"},"right":{"call":"split","args":[{"classifier":"lex"},{"string":"."}]}}`)},
		{"tag takes no classifier", cond(`{"op":"⊆","left":{"call":"tag","args":[{"classifier":"lex"}]},"right":{"tag":"a"}}`)},
		{"a constant's value calls no classify", constant(`{"name":"A","op":"define","value":{"call":"classify","args":[{"string":"mi"},{"classifier":"lex"}]},"at":[3,1]}`)},
	}
	// Each variation's well-formed twin decodes, so that the refusals are
	// the rule's and not the test's.
	for _, ok := range []string{alt(good), alt(nested(255)),
		// A range, a property, each captured, and a range in a term.
		alt(`{"range":["'a'","'z'"]}`), alt(`{"property":"White_Space"}`),
		alt(`{"seq":[{"capture":"c","expr":{"range":["'\\u{300}'","'\\u{36F}'"]}},{"capture":"d","expr":{"property":"Cs"}}]}`),
		tagged(`{"union":[{"range":["'a'","'c'"]},{"tag":"'x'"}]}`),
		// Classifiers, entries, implications and classify.
		classified(`{"name":"lex","entries":[{"guards":[],"keys":["mi","do"],"op":"∈","class":"KOhA","at":[3,3]},{"guards":[{"feature":"f","kind":"gate","negated":true}],"keys":["u'i"],"op":"∉","class":"UI","at":[4,3]}],"at":[3,1]},{"name":"empty","entries":[],"at":[5,1]}`,
			`{"if":{"union":[{"tag":"UI"},{"const":"K","at":[6,15]}]},"then":{"tag":"indicator"},"at":[6,1]},{"if":{"range":["'a'","'c'"]},"then":{"union":[{"tag":"early"},{"tag":"/a/"}]},"at":[7,1]}`),
		tagged(`{"union":[{"tag":"T"},{"call":"classify","args":[{"call":"phonemes","args":[{"capture":"x"}]},{"classifier":"lex"}]}]}`),
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
		cond(`{"op":"∈","left":{"call":"text","args":[{"capture":"x"}]},"right":` + runs + `}`),
		cond(`{"op":"⊈","left":{"tag":"a"},"right":{"call":"tags","args":[{"capture":"x"}]}}`),
		cond(`{"op":"=","left":{"emptySet":true},"right":` + runs + `}`),
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
		cond(`{"op":"⊆","left":{"call":"tag","args":[{"call":"text","args":[{"call":"head","args":[{"capture":"x"}]}]}]},"right":{"tag":"a"}}`),
		// Constants, their definitions and their references.
		constant(`{"name":"A","op":"define","value":{"union":[{"tag":"X"},{"const":"B","at":[3,20]}]},"at":[3,1]}`),
		constant(`{"name":"A","op":"redefine","value":{"emptySet":true},"at":[3,1]}`),
		constant(`{"name":"A","op":"define","value":{"call":"split","args":[{"string":"a.b"},{"const":"P","at":[3,20]}]},"at":[3,1]}`),
		constant(`{"name":"A","op":"define","value":{"call":"tag","args":[{"string":"X"}]},"at":[3,1]}`),
		tagged(`{"union":[{"const":"A","at":[1,5]},{"call":"tag","args":[{"const":"S","at":[1,9]}]}]}`),
		cond(`{"op":"∈","left":{"const":"S","at":[1,5]},"right":{"call":"split","args":[{"call":"phonemes","args":[{"capture":"x"}]},{"const":"P","at":[1,9]}]}}`),
		cond(`{"any":[{"not":{"matches":{"capture":"x"},"rule":"text"}},{"op":"=","left":{"string":"a"},"right":{"string":"a"}}]}`),
		cond(strings.Repeat(`{"not":`, 254) + `{"initial":{"call":"tail","args":[{"capture":"x"}]}}` + strings.Repeat(`}`, 254)),
		// A lookahead, at the bound, and the tokens' tags from $ on.
		cond(strings.Repeat(`{"not":`, 254) + `{"begins":{"call":"after","args":[{"capture":"x"}]},"rule":"text"}` + strings.Repeat(`}`, 254)),
		cond(`{"begins":{"call":"from","args":[{"call":"tail","args":[{"capture":""}]}]},"rule":"text"}`),
		tagged(`{"call":"tags","args":[{"call":"from","args":[{"capture":""}]}]}`),
		// Tested symbols, captured or not, of each comparator, and at the
		// bound of the nesting.
		alt(`{"seq":[{"capture":"x","expr":{"test":"=","value":{"string":"la'i"},"expr":{"ref":"LE"}}},{"test":"≠","value":{"string":"a"},"expr":{"terminal":"/a/"}}]}`),
		alt(`{"seq":[{"test":"=","value":{"string":""},"expr":{"ref":"LE"}},{"test":"∩=∅","value":{"tag":"UI"},"expr":{"ref":"cmavo"}}]}`),
		alt(`{"seq":[{"test":"⊇","value":{"union":[{"tag":"UI"},{"range":["'a'","'c'"]}]},"expr":{"range":["'a'","'z'"]}},{"test":"⊉","value":{"emptySet":true},"expr":{"property":"L"}}]}`),
		alt(`{"seq":[{"test":"∩≠∅","value":{"const":"A","at":[1,1]},"expr":{"ref":"LE"}},{"test":"=","value":{"const":"S","at":[1,2]},"expr":{"ref":"LE"}}]}`),
		alt(`{"seq":[{"capture":"l","expr":{"test":"=","value":{"string":"la"},"expr":{"ref":"LE"}}},{"repeat":{"test":"=","value":{"string":"ui"},"expr":{"ref":"UI"}},"min":1}]}`),
		alt(`{"seq":[` + strings.Repeat(`{"seq":[{"terminal":"a"},`, 254) + `{"test":"=","value":{"string":"b"},"expr":{"terminal":"b"}}` + strings.Repeat(`]}`, 254) + `,{"terminal":"b"}]}`),
		alt(strings.Repeat(`{"optional":`, 254) + `{"test":"⊇","value":{"union":[{"tag":"A"},{"tag":"B"}]},"expr":{"ref":"LE"}}` + strings.Repeat(`}`, 254)),
		strings.Replace(alt(good), `"define"`, `"redefine"`, 1),
		strings.Replace(alt(good), `"conditions":[]`, `"conditions":[],"opaque":true`, 1), emit(`{"items":[{"capture":"x"}]},"opaque":true`),
		// Clauses that serve alternatives with different captures.
		two(`"tags":{"union":[{"tag":"T"},{"if":{"captured":"x"},"then":{"call":"tags","args":[{"capture":"x"}]}}]},"conditions":[]`),
		two(`"conditions":[{"captured":"x"},{"if":{"captured":"z"},"then":{"matches":{"capture":"z"},"rule":"text"}}]`),
		two(`"emit":{"items":[{"capture":"x"},{"insert":"T"}]},"conditions":[]`),
		// Attachments before and after a carrier, and one that an
		// alternative with the carrier lacks.
		emit(`{"items":[{"capture":"y","before":["x"]}]}`), emit(`{"items":[{"capture":"x","after":["y"]}]}`),
		rule(`"alternatives":[{"guards":[],"expr":{"seq":[{"capture":"x","expr":{"terminal":"a"}},{"capture":"y","expr":{"terminal":"b"}}]}},{"guards":[],"expr":{"seq":[{"capture":"x","expr":{"terminal":"a"}},{"terminal":"b"}]}}],"emit":{"items":[{"insert":"T"},{"capture":"x","after":["y"]}]},"conditions":[]`),
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

// The reader holds an implication to the nesting limit too, at the
// implication (engine §9).
func TestReaderImplicationNesting(t *testing.T) {
	loadBundled()
	// n differences, each of a tag and the next in parentheses: the
	// innermost tag lies below n compound nodes.
	doc := func(n int) string {
		return "```jbogenbau\n\n%implies " + strings.Repeat("A ∖ (", n) + "B" + strings.Repeat(")", n) + " ⟹ ~m\n```\n"
	}
	if _, err := bundled.reader.read(doc(256), "g.md"); err != nil {
		t.Fatalf("256 deep: %v", err)
	}
	_, err := bundled.reader.read(doc(257), "g.md")
	if err == nil || err.Line != 3 || err.Column != 1 || !strings.Contains(err.Message, "nested more than 256 deep") {
		t.Fatalf("257 deep: expected an error at the implication, 3:1, got %v", err)
	}
}

// bootstrapError loads a dialect whose bootstrap has item first in the
// list of the given name of its first document, and gives the error.
func bootstrapError(t *testing.T, list, item string) error {
	t.Helper()
	loadBundled()
	src := oneStage("%ambiguity-resolution greedy\n%rule text 'a' 'b'")
	bootstrap := bundled.sources["notation/bootstrap.json"]
	i := strings.Index(bootstrap, `"`+list+`":[`)
	if i < 0 {
		t.Fatalf("no %s in the bootstrap", list)
	}
	i += len(`"` + list + `":[`)
	sep := ","
	if bootstrap[i] == ']' {
		sep = ""
	}
	src["notation/bootstrap.json"] = bootstrap[:i] + item + sep + bootstrap[i:]
	_, err := LoadDialectSources(src, "p.md")
	return err
}

// assertGrammarError fails unless err is an error of the grammar whose
// message holds want.
func assertGrammarError(t *testing.T, err error, want string) {
	t.Helper()
	var e *Error
	if !errors.As(err, &e) || e.Kind != ErrorGrammar || !strings.Contains(e.Message, want) {
		t.Errorf("expected an error of the grammar with %q, got %v", want, err)
	}
}

// A bootstrap with a malformed classifier is an error of the grammar
// (engine §9).
func TestBootstrapMalformedClassifier(t *testing.T) {
	bad := `{"name":"lex","entries":[{"guards":[],"keys":["Mi"],"op":"∈","class":"KOhA","at":[9999,3]}],"at":[9999,1]}`
	assertGrammarError(t, bootstrapError(t, "classifiers", bad), "canonical sound")
}

// A classifier's name stands only as the second argument of classify
// (engine §9). Elsewhere a bootstrap is an error of the grammar.
func TestBootstrapMisplacedClassifier(t *testing.T) {
	rule := func(condition string) string {
		return `{"name":"misplaced-classifier","op":"define","alternatives":[{"guards":[],"expr":{"capture":"x","expr":{"ref":"A"}}}],"conditions":[` + condition + `],"at":[9999,1]}`
	}
	if err := bootstrapError(t, "rules", rule(`{"op":"∈","left":{"string":"a"},"right":{"call":"split","args":[{"string":"a.b"},{"string":"."}]}}`)); err != nil {
		t.Fatalf("a well-formed rule: %v", err)
	}
	for _, condition := range []string{
		`{"op":"⊆","left":{"call":"tag","args":[{"classifier":"lex"}]},"right":{"tag":"a"}}`,
		`{"op":"∈","left":{"string":"a"},"right":{"call":"split","args":[{"classifier":"lex"},{"string":"."}]}}`,
		`{"op":"∈","left":{"string":"a"},"right":{"call":"split","args":[{"string":"a.b"},{"classifier":"lex"}]}}`,
	} {
		assertGrammarError(t, bootstrapError(t, "rules", rule(condition)), "a malformed call")
	}
}

// A constant nested too deeply is refused before any walk that recurses
// (engine §9): a compiled.json entry is a miss, and a bootstrap is an error
// of the grammar.
func TestDeepConstant(t *testing.T) {
	loadBundled()
	deep := strings.Repeat(`{"union":[`, 2000) + `{"tag":"a"}` + strings.Repeat(`,{"tag":"B"}]}`, 2000)
	k := `{"name":"K","op":"define","value":` + deep + `,"at":[9999,1]}`
	src := oneStage("%ambiguity-resolution greedy\n%rule text 'a' 'b'")
	dom := `{"format":` + strconv.Itoa(domFormat) + `,"rules":[{"name":"text","op":"define","alternatives":[{"guards":[],"expr":{"seq":[{"terminal":"a"},{"terminal":"b"}]}}],"conditions":[],"at":[4,1]}],"directives":[{"name":"ambiguity-resolution","args":["greedy"],"at":[3,1]}],"constants":[` + k + `],"classifiers":[],"implications":[]}`
	if _, err := decodeDOM(json.RawMessage(dom), bundled.uni); err == nil || !strings.Contains(err.Error(), "nested more than 256 deep") {
		t.Fatalf("a deep constant: expected the nesting error, got %v", err)
	}
	src["compiled.json"] = `{"format":` + strconv.Itoa(domFormat) + `,"bootstrap":"` + bundled.reader.hash + `","documents":{"g.md":{"hash":"` + fnv1a64(src["g.md"]) + `","dom":` + dom + `}}}`
	d, err := LoadDialectSources(src, "p.md")
	if err != nil {
		t.Fatal(err)
	}
	if res, err := d.Parse("ab", ParseOptions{}); err != nil || !res.OK {
		t.Fatalf("the document was not read instead: %v %+v", err, res.Error)
	}
	delete(src, "compiled.json")
	bootstrap := bundled.sources["notation/bootstrap.json"]
	i := strings.Index(bootstrap, `"constants":[`)
	if i < 0 {
		t.Fatal("no constants in the bootstrap")
	}
	i += len(`"constants":[`)
	sep := ","
	if bootstrap[i] == ']' {
		sep = ""
	}
	src["notation/bootstrap.json"] = bootstrap[:i] + k + sep + bootstrap[i:]
	_, err = LoadDialectSources(src, "p.md")
	var e *Error
	if !errors.As(err, &e) || e.Kind != ErrorGrammar || !strings.Contains(e.Message, "nested more than 256 deep") {
		t.Fatalf("a deep bootstrap constant: expected an error of the grammar, got %v", err)
	}
}

// A cached DOM whose capture checks wait for a constant's value is used,
// and the loader makes the checks once the constants have their values
// (engine §3.6, §9).
func TestCachedClauseWaitsForConstant(t *testing.T) {
	loadBundled()
	grammar := func(first, last string) string {
		return "%ambiguity-resolution greedy\n%const $E " + first + "\n%rule text 'a' | $x('a')\n%tags Y ∪ ($E ∩ tags($x))\n%redefine-const $E " + last
	}
	// The tags of the parse's tree, or the load error's position, with the
	// cache entry given.
	outcome := func(g string, entry string) string {
		src := oneStage(g)
		if entry != "" {
			src["compiled.json"] = `{"format":` + strconv.Itoa(domFormat) + `,"bootstrap":"` + bundled.reader.hash + `","documents":{"g.md":{"hash":"` + fnv1a64(src["g.md"]) + `","dom":` + entry + `}}}`
		}
		d, err := LoadDialectSources(src, "p.md")
		if err != nil {
			var e *Error
			if !errors.As(err, &e) {
				t.Fatal(err)
			}
			return "error at " + strconv.Itoa(e.Line) + ":" + strconv.Itoa(e.Column)
		}
		res, err := d.Parse("a", ParseOptions{})
		if err != nil || !res.OK {
			t.Fatalf("%v %+v", err, res.Error)
		}
		return strings.Join(res.Tree.Tags, " ")
	}
	read := func(g string) string {
		dom, err := bundled.reader.read(oneStage(g)["g.md"], "g.md")
		if err != nil {
			t.Fatalf("the document is refused: %v", err)
		}
		if _, err := decodeDOM(json.RawMessage(dom.json()), bundled.uni); err != nil {
			t.Fatalf("its DOM is refused: %v", err)
		}
		return string(dom.json())
	}
	empty := grammar("B", "$E ∖ B")
	dom := read(empty)
	for _, entry := range []string{"", dom} {
		if got := outcome(empty, entry); got != "Y" {
			t.Errorf("an empty constant, cached %v: %s", entry != "", got)
		}
	}
	// A hit: the entry, changed, is the one the parse sees.
	changed := strings.Replace(dom, `{"tag":"Y"}`, `{"tag":"Z"}`, 1)
	if changed == dom || outcome(empty, changed) != "Z" {
		t.Errorf("the cache entry was not used")
	}
	full := grammar("B ∖ B", "B")
	dom = read(full)
	for _, entry := range []string{"", dom} {
		if got := outcome(full, entry); got != "error at 6:1" {
			t.Errorf("a constant that is not empty, cached %v: %s", entry != "", got)
		}
	}
}

// A gate of a classifier's entry and a guard of a rule's alternative follow
// the notation's name syntax (engine §9). A cached entry with another
// feature is a miss, so it never changes the dialect's features, and a
// bootstrap with one is an error of the grammar.
func TestGuardFeatureName(t *testing.T) {
	loadBundled()
	format := `"format":` + strconv.Itoa(domFormat)
	classifier := func(guard string, line int) string {
		at := strconv.Itoa(line)
		return `{"name":"lex","entries":[{"guards":[` + guard + `],"keys":["mi"],"op":"∈","class":"KOhA","at":[` + at + `,3]}],"at":[` + at + `,1]}`
	}
	rule := func(guard, name string, line int) string {
		return `{"name":"` + name + `","op":"define","alternatives":[{"guards":[` + guard + `],"expr":{"seq":[{"terminal":"a"},{"terminal":"b"}]}}],"conditions":[],"at":[` + strconv.Itoa(line) + `,1]}`
	}
	// features is the dialect's features, each as name:kind, when its
	// compiled.json holds a DOM of the document with rules and classifiers.
	features := func(rules, classifiers string) []string {
		src := oneStage("%ambiguity-resolution greedy\n%rule text 'a' 'b'")
		dom := `{` + format + `,"rules":[` + rules + `],"directives":[{"name":"ambiguity-resolution","args":["greedy"],"at":[3,1]}],"constants":[],"classifiers":[` + classifiers + `],"implications":[]}`
		src["compiled.json"] = `{` + format + `,"bootstrap":"` + bundled.reader.hash + `","documents":{"g.md":{"hash":"` + fnv1a64(src["g.md"]) + `","dom":` + dom + `}}}`
		d, err := LoadDialectSources(src, "p.md")
		if err != nil {
			t.Fatalf("%s %s: %v", rules, classifiers, err)
		}
		var names []string
		for _, f := range d.Features() {
			names = append(names, f.Name+":"+string(f.Kind))
		}
		return names
	}
	for _, c := range []struct{ kind, where, problem string }{
		{"gate", "classifier", "a gate's feature is a name"},
		{"gate", "rule", "a guard's feature is a name"},
		{"warning", "rule", "a guard's feature is a name"},
	} {
		guard := func(feature string) string {
			return `{"feature":"` + feature + `","kind":"` + c.kind + `","negated":false}`
		}
		// The DOM's items, and the bootstrap's list and item, for a guard.
		items := func(feature string) (string, string, string, string) {
			if c.where == "classifier" {
				return rule("", "text", 4), classifier(guard(feature), 5), "classifiers", classifier(guard(feature), 9999)
			}
			return rule(guard(feature), "text", 4), "", "rules", rule(guard(feature), "misnamed-feature", 9999)
		}
		rules, classifiers, list, item := items("f")
		if got := features(rules, classifiers); len(got) != 1 || got[0] != "f:"+c.kind {
			t.Fatalf("%s %s, the control: expected the feature f, got %v", c.where, c.kind, got)
		}
		if err := bootstrapError(t, list, item); err != nil {
			t.Fatalf("%s %s, the control: a well-formed bootstrap item: %v", c.where, c.kind, err)
		}
		for _, feature := range []string{"", "!", "bad name"} {
			rules, classifiers, list, item := items(feature)
			if got := features(rules, classifiers); len(got) != 0 {
				t.Errorf("%s %s %q: the cache entry was used, with the features %v", c.where, c.kind, feature, got)
			}
			assertGrammarError(t, bootstrapError(t, list, item), c.problem)
		}
	}
}

// An expression or a condition has exactly the members of one form, and a
// reference is a name or # (docs/output.md, engine §9). A compiled.json
// entry that breaks this is a miss, and the document is read instead. A
// bootstrap that breaks it is an error of the grammar. The order of the
// members varies, as the other libraries read JSON in order.
func TestMixedForms(t *testing.T) {
	loadBundled()
	format := `"format":` + strconv.Itoa(domFormat)
	src := oneStage("%ambiguity-resolution greedy\n%rule text $x('a') 'b'\n%conditions text($x) = \"a\"")
	const (
		a        = `{"terminal":"'a'"}`
		b        = `{"terminal":"'b'"}`
		c        = `{"terminal":"'c'"}`
		captured = `{"capture":"x","expr":` + a + `}`
		// A condition that wants "z", which the text does not give. So an
		// entry used by mistake refuses the text.
		compared = `"op":"=","left":{"call":"text","args":[{"capture":"x"}]},"right":{"string":"z"}`
	)
	rule := func(name, expr, condition, emit string, line int) string {
		if emit != "" {
			emit = `,"emit":` + emit
		}
		return `{"name":"` + name + `","op":"define","alternatives":[{"guards":[],"expr":` + expr + `}]` + emit + `,"conditions":[` + condition + `],"at":[` + strconv.Itoa(line) + `,1]}`
	}
	seq := func(first, second string) string { return `{"seq":[` + first + `,` + second + `]}` }
	parse := func(dom string) bool {
		s := map[string]string{}
		for k, v := range src {
			s[k] = v
		}
		if dom != "" {
			s["compiled.json"] = `{` + format + `,"bootstrap":"` + bundled.reader.hash + `","documents":{"g.md":{"hash":"` + fnv1a64(s["g.md"]) + `","dom":` + dom + `}}}`
		}
		d, err := LoadDialectSources(s, "p.md")
		if err != nil {
			t.Fatalf("%s: %v", dom, err)
		}
		res, err := d.Parse("ab", ParseOptions{})
		return err == nil && res.OK
	}
	document := func(expr, condition, emit string) string {
		return `{` + format + `,"rules":[` + rule("text", expr, condition, emit, 4) + `],"directives":[{"name":"ambiguity-resolution","args":["greedy"],"at":[3,1]}],"constants":[],"classifiers":[],"implications":[]}`
	}
	if !parse("") {
		t.Fatal("the document does not accept the text")
	}
	control := document(seq(captured, b), `{`+compared+`}`, "")
	if parse(control) {
		t.Fatal("the control: the cache entry was not used")
	}
	if err := bootstrapError(t, "rules", rule("unused-rule", seq(captured, b), `{`+compared+`}`, "", 9999)); err != nil {
		t.Fatalf("the control: a well-formed bootstrap rule: %v", err)
	}
	for _, m := range []struct{ name, expr, condition, emit string }{
		{"empty with a terminal", seq(captured, `{"empty":true,"terminal":"'b'"}`), "", ""},
		{"a terminal with empty", seq(captured, `{"terminal":"'b'","empty":true}`), "", ""},
		{"a choice with a sequence", seq(captured, `{"choice":[`+b+`,`+c+`],"seq":[`+c+`,`+c+`]}`), "", ""},
		{"a sequence with a choice", seq(captured, `{"seq":[`+c+`,`+c+`],"choice":[`+b+`,`+c+`]}`), "", ""},
		{"a choice with a sequence of a bad reference", seq(captured, `{"choice":[`+b+`,`+c+`],"seq":[{"ref":5},`+c+`]}`), "", ""},
		{"a repetition with an optional", seq(captured, `{"repeat":`+b+`,"min":1,"optional":`+c+`}`), "", ""},
		{"an optional with a repetition", seq(captured, `{"optional":`+c+`,"repeat":`+b+`,"min":1}`), "", ""},
		{"a repetition with an optional of a bad reference", seq(captured, `{"repeat":`+b+`,"min":1,"optional":{"ref":["x"]}}`), "", ""},
		{"a reference that is not a name", seq(captured, `{"ref":"x y"}`), "", ""},
		{"a top-level sequence with a choice", `{"seq":[` + captured + `,` + b + `],"choice":[` + b + `,` + c + `]}`, "", ""},
		{"a captured terminal not in its canonical spelling", seq(`{"capture":"x","expr":{"terminal":"'ab'"}}`, b), "", ""},
		{"a captured reference with a terminal", seq(`{"capture":"x","expr":{"ref":"A","terminal":"'a'"}}`, b), "", ""},
		{"a captured terminal with a reference", seq(`{"capture":"x","expr":{"terminal":"'a'","ref":"A"}}`, b), "", ""},
		{"a captured reference that is not a name", seq(`{"capture":"x","expr":{"ref":"x y"}}`, b), "", ""},
		{"a capture with a reference", seq(`{"capture":"x","expr":`+a+`,"ref":"B"}`, b), "", ""},
		{"a comparison with a negation", "", `{` + compared + `,"not":{"captured":"x"}}`, ""},
		{"a negation with a comparison", "", `{"not":{"captured":"x"},` + compared + `}`, ""},
		{"a presence test with a comparison", "", `{"captured":"x",` + compared + `}`, ""},
		{"a comparison with a match", "", `{` + compared + `,"matches":{"capture":"x"}}`, ""},
		{"a match with a rule and another member", "", `{"matches":{"capture":"x"},"rule":"text","initial":{"capture":"x"}}`, ""},
		{"an emission with another member", "", "", `{"items":[{"capture":"x"}],"extra":true}`},
		{"another member with an emission", "", "", `{"extra":true,"items":[{"capture":"x"}]}`},
	} {
		expr, condition := m.expr, m.condition
		if expr == "" {
			expr = seq(captured, b)
		}
		if condition == "" {
			condition = `{` + compared + `}`
		}
		dom := document(expr, condition, m.emit)
		if _, err := decodeDOM(json.RawMessage(dom), bundled.uni); err == nil {
			t.Errorf("%s: the DOM decodes", m.name)
		}
		if !parse(dom) {
			t.Errorf("%s: the cache entry was used", m.name)
		}
		err := bootstrapError(t, "rules", rule("unused-rule", expr, condition, m.emit, 9999))
		var e *Error
		if !errors.As(err, &e) || e.Kind != ErrorGrammar || e.Document != "notation/bootstrap.json" {
			t.Errorf("%s: expected an error of the bootstrap, got %v", m.name, err)
		}
	}
}

// A guard of an alternative has exactly its feature, its kind and whether
// it is negated, as a guard of a classifier's entry has (docs/output.md).
// A bootstrap with a guard of another member is an error of the grammar.
func TestBootstrapGuardMembers(t *testing.T) {
	rule := func(guard string) string {
		return `{"name":"guarded-rule","op":"define","alternatives":[{"guards":[` + guard + `],"expr":{"ref":"A"}}],"conditions":[],"at":[9999,1]}`
	}
	if err := bootstrapError(t, "rules", rule(`{"feature":"f","kind":"gate","negated":false}`)); err != nil {
		t.Fatalf("a well-formed guard: %v", err)
	}
	assertGrammarError(t, bootstrapError(t, "rules", rule(`{"feature":"f","kind":"gate","negated":false,"extra":true}`)), "a malformed guard")
	assertGrammarError(t, bootstrapError(t, "rules", rule(`{"kind":"gate","negated":false,"feature":"f","note":"x"}`)), "a malformed guard")
}
