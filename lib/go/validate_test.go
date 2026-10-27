package gencmu

import (
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"testing"
)

// One malformed DOM per rule the reader enforces (engine §9, docs/output.md
// "A grammar DOM"): each is refused when decoded, and as a data/preparsed/test.json
// entry it is a miss, so the document is read instead.
func TestDOMRules(t *testing.T) {
	t.Parallel()
	loadBundled()
	const good = `{"seq":[{"literal":{"string":"a"}},{"literal":{"string":"b"}}]}`
	format := `"format":` + strconv.Itoa(domFormat)
	rule := func(fields string) string {
		return `{` + format + `,"rules":[{"name":"text","op":"define","flags":[],` + fields + `,"at":[1,1]}],"directives":[{"name":"ambiguity-resolution","args":["greedy"],"at":[2,1]}],"constants":[],"classifiers":[],"implications":[]}`
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
	runs := `{"method":"split","receiver":{"method":"value","receiver":{"capture":"x"},"args":[]},"args":[{"string":"."}]}`
	tagged := func(tags string) string {
		return rule(`"alternatives":[{"guards":[],"expr":{"seq":[{"capture":"x","expr":{"literal":{"string":"a"}}},{"literal":{"string":"b"}}]},"tags":` + tags + `}],"conditions":[]`)
	}
	emit := func(emission string) string {
		return rule(`"alternatives":[{"guards":[],"expr":{"seq":[{"capture":"x","expr":{"literal":{"string":"a"}}},{"capture":"y","expr":{"literal":{"string":"b"}}}]}}],"emit":` + emission + `,"conditions":[]`)
	}
	cond := func(condition string) string {
		return rule(`"alternatives":[{"guards":[],"expr":{"seq":[{"capture":"x","expr":{"literal":{"string":"a"}}},{"literal":{"string":"b"}}]}}],"conditions":[` + condition + `]`)
	}
	// Two alternatives, the first capturing x and z, the second neither.
	two := func(clauses string) string {
		return rule(`"alternatives":[{"guards":[],"expr":{"seq":[{"capture":"x","expr":{"literal":{"string":"a"}}},{"capture":"z","expr":{"literal":{"string":"b"}}}]}},{"guards":[],"expr":{"seq":[{"literal":{"string":"a"}},{"literal":{"string":"b"}}]}}],` + clauses)
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
		{"a rule name is an identifier or one eligible emoji", strings.Replace(alt(good), `"name":"text"`, `"name":"##"`, 1)},
		{"op is define, redefine or extend", strings.Replace(alt(good), `"define"`, `"replace"`, 1)},
		// A compared term has exactly the members of one form, in either
		// order: read as the string, either would reject "ab".
		{"a compared tag that is also a string", cond(`{"op":"=","left":{"method":"source-text","receiver":{"capture":"x"},"args":[]},"right":{"tag":"Bad","string":"wrong"}}`)},
		{"a compared string that is also a tag", cond(`{"op":"=","left":{"method":"source-text","receiver":{"capture":"x"},"args":[]},"right":{"string":"wrong","tag":"Bad"}}`)},
		{"a difference that is also a union", tagged(`{"difference":[{"tag":"X"},{"tag":"Y"}],"union":[{"tag":"X"},{"tag":"Y"}]}`)},
		{"a union that is also a difference", tagged(`{"union":[{"tag":"X"},{"tag":"Y"}],"difference":[{"tag":"X"},{"tag":"Y"}]}`)},
		// A definition as a whole (engine §9, the end).
		{"a mentioned capture is captured", cond(`{"method":"matches","receiver":{"capture":"z"},"args":[{"rule":"text"}]}`)},
		{"a tested capture is captured", cond(`{"captured":"z"}`)},
		{"a condition applies to an alternative", cond(`{"captured":"x"}`)},
		{"a rule's tags use captures every alternative has", two(`"tags":{"method":"tags","receiver":{"capture":"x"},"args":[]},"conditions":[]`)},
		{"an item's tags use captures its alternatives have", two(`"emit":{"items":[{"capture":"z","tags":{"method":"tags","receiver":{"capture":"x"},"args":[]}}]},"conditions":[]`)},
		{"captures are emitted in text order", emit(`{"items":[{"capture":"y"},{"capture":"x"}]}`)},
		{"an inserted tag's anchor is in every alternative", two(`"emit":{"items":[{"insert":"T"},{"capture":"x"}]},"conditions":[]`)},
		{"every alternative emits something", two(`"emit":{"items":[{"capture":"x"}]},"conditions":[]`)},
		{"an opaque member beside an empty emission list", emit(`{"items":[]},"opaque":true`)},
		{"opaque is true or absent", strings.Replace(alt(good), `"conditions":[]`, `"conditions":[],"opaque":false`, 1)},
		{"a guard does not read the constituent's tags", tagged(`{"if":{"op":"⊆","left":{"tag":"a"},"right":{"method":"tags","receiver":{"capture":""},"args":[]}},"then":{"tag":"T"}}`)},
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
		{"a seq has two items or more", alt(`{"seq":[{"literal":{"string":"a"}}]}`)},
		{"a seq is not empty", alt(`{"seq":[]}`)},
		{"a choice has two items or more", alt(`{"choice":[{"literal":{"string":"a"}}]}`)},
		{"an & has two items or more", alt(`{"and":[{"literal":{"string":"a"}}]}`)},
		{"an & has at most 16 items", alt(`{"and":[` + strings.TrimSuffix(strings.Repeat(`{"literal":{"string":"a"}},`, 17), ",") + `]}`)},
		{"a repeat refuses an unknown member", alt(`{"repeat":{"literal":{"string":"a"}},"extra":true}`)},
		{"a separated list refuses an unknown member", alt(`{"repeat":{"literal":{"string":"a"}},"separator":{"literal":{"string":"b"}},"extra":false}`)},
		{"a separator is an expression", alt(`{"repeat":{"literal":{"string":"a"}},"separator":{"ref":"x y"}}`)},
		{"a chain is the whole expression (sequence)", alt(`{"seq":[{"literal":{"string":"a"}},{"repeat":{"literal":{"string":"b"}},"chain":"left"}]}`)},
		{"a chain is the whole expression (choice)", alt(`{"choice":[{"repeat":{"literal":{"string":"b"}},"chain":"left"},{"literal":{"string":"a"}}]}`)},
		{"a chain is the whole expression (optional)", alt(`{"optional":{"repeat":{"literal":{"string":"a"}},"chain":"right"}}`)},
		{"a chain is the whole expression (separator)", alt(`{"repeat":{"literal":{"string":"a"}},"separator":{"repeat":{"literal":{"string":"b"}},"chain":"left"}}`)},
		{"a chain is the whole expression (item)", alt(`{"repeat":{"repeat":{"literal":{"string":"a"}},"chain":"left"}}`)},
		{"a chain is left or right", alt(`{"repeat":{"literal":{"string":"a"}},"chain":"up"}`)},
		{"a chain is a string", alt(`{"repeat":{"literal":{"string":"a"}},"chain":true}`)},
		{"elidable is true (false)", alt(`{"optional":{"ref":"KU"},"elidable":false}`)},
		{"elidable is true (a string)", alt(`{"optional":{"ref":"KU"},"elidable":"true"}`)},
		{"elidable is true (null)", alt(`{"optional":{"ref":"KU"},"elidable":null}`)},
		{"unknown optional member (true)", alt(`{"optional":{"ref":"KU"},"elidable":true,"extra":true}`)},
		{"unknown optional member (null)", alt(`{"optional":{"ref":"KU"},"elidable":true,"extra":null}`)},
		{"unknown member on a plain optional", alt(`{"optional":{"ref":"KU"},"extra":true}`)},
		{"unknown optional member (false)", alt(`{"optional":{"ref":"KU"},"elidable":true,"extra":false}`)},
		{"an elidable optional begins with its terminal (choice)", alt(`{"optional":{"choice":[{"ref":"KU"},{"ref":"VAU"}]},"elidable":true}`)},
		{"an elidable optional begins with its terminal (&)", alt(`{"optional":{"and":[{"ref":"KU"},{"ref":"A"}]},"elidable":true}`)},
		{"an elidable optional begins with its terminal (rule)", alt(`{"optional":{"ref":"ku"},"elidable":true}`)},
		{"an elidable optional begins with its terminal (🆓)", alt(`{"optional":{"seq":[{"ref":"🆓"},{"ref":"KU"}]},"elidable":true}`)},
		{"an elidable optional begins with its terminal (phoneme)", alt(`{"optional":{"literal":{"string":"/a/"}},"elidable":true}`)},
		{"an elidable optional begins with its terminal (character)", alt(`{"optional":{"literal":{"string":"a"}},"elidable":true}`)},
		{"an elidable optional begins with its terminal (range)", alt(`{"optional":{"range":[{"string":"a"},{"string":"z"}]},"elidable":true}`)},
		{"an elidable optional begins with its terminal (seq)", alt(`{"optional":{"seq":[{"seq":[{"ref":"KU"},{"ref":"🆓"}]},{"ref":"A"}]},"elidable":true}`)},
		{"an elidable optional begins with its terminal (optional)", alt(`{"optional":{"optional":{"ref":"KU"}},"elidable":true}`)},
		{"an elidable optional begins with its terminal (ε)", alt(`{"optional":{"empty":true},"elidable":true}`)},
		{"a capture wraps a reference or terminal", alt(`{"capture":"x","expr":{"optional":{"literal":{"string":"a"}}}}`)},
		{"a capture stands not inside an elidable optional", alt(`{"optional":{"seq":[{"ref":"KU"},{"capture":"x","expr":{"ref":"A"}}]},"elidable":true}`)},
		{"a capture stands not inside an elidable optional, at any depth", alt(`{"optional":{"seq":[{"ref":"KU"},{"optional":{"capture":"x","expr":{"ref":"A"}}}]},"elidable":true}`)},
		{"a capture stands not inside braces (item)", alt(`{"seq":[{"literal":{"string":"a"}},{"repeat":{"capture":"x","expr":{"literal":{"string":"b"}}}}]}`)},
		{"a capture stands not inside braces (separator)", alt(`{"repeat":{"ref":"A"},"separator":{"capture":"s","expr":{"ref":"S"}}}`)},
		{"a capture name once per production (optional)", alt(`{"seq":[{"optional":{"capture":"x","expr":{"ref":"A"}}},{"capture":"x","expr":{"ref":"B"}}]}`)},
		{"a capture name once per production (&)", alt(`{"and":[{"capture":"x","expr":{"ref":"A"}},{"capture":"x","expr":{"ref":"B"}}]}`)},
		{"a capture name once per production (two choices)", alt(`{"seq":[{"choice":[{"capture":"x","expr":{"ref":"A"}},{"ref":"B"}]},{"choice":[{"capture":"x","expr":{"ref":"C"}},{"ref":"D"}]}]}`)},
		{"a capture's symbol counts toward the nesting", alt(`{"seq":[` + strings.Repeat(`{"seq":[{"literal":{"string":"a"}},`, 255) + `{"capture":"x","expr":{"literal":{"string":"b"}}}` + strings.Repeat(`]}`, 255) + `,{"literal":{"string":"b"}}]}`)},
		{"a term nests at most 256 deep", tagged(unions(257))},
		{"a condition nests at most 256 deep", cond(strings.Repeat(`{"not":`, 256) + `{"method":"matches","receiver":{"capture":"x"},"args":[{"rule":"text"}]}` + strings.Repeat(`}`, 256))},
		{"an emitted item's term nests at most 256 deep", emit(`{"items":[{"capture":"","tags":` + unions(257) + `}]}`)},
		{"a capture name once per production", alt(`{"seq":[{"capture":"x","expr":{"literal":{"string":"a"}}},{"capture":"x","expr":{"literal":{"string":"b"}}}]}`)},
		{"a flag is true", alt(`{"seq":[{"literal":{"string":"a"}},{"empty":false}]}`)},
		{"# is not an expression", alt(`{"seq":[{"literal":{"string":"a"}},{"hash":true}]}`)},
		{"$ wraps nothing", alt(`{"seq":[{"capture":"","expr":{"literal":{"string":"a"}}},{"literal":{"string":"b"}}]}`)},
		{"an expression is known", alt(`{"seq":[{"literal":{"string":"a"}},{"what":"b"}]}`)},
		{"a reference names something", alt(`{"seq":[{"literal":{"string":"a"}},{"ref":""}]}`)},
		{"a captured reference names something", alt(`{"seq":[{"literal":{"string":"a"}},{"capture":"x","expr":{"ref":""}}]}`)},
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
		{"an alternative without the carrier lacks its attachments", rule(`"alternatives":[{"guards":[],"expr":{"seq":[{"capture":"x","expr":{"literal":{"string":"a"}}},{"capture":"y","expr":{"literal":{"string":"b"}}}]}},{"guards":[],"expr":{"seq":[{"literal":{"string":"a"}},{"capture":"y","expr":{"literal":{"string":"b"}}}]}}],"emit":{"items":[{"capture":"x","after":["y"]}]},"conditions":[]`)},
		// Tests in a body (engine §2, §9).
		{"a test's comparator is known", alt(`{"seq":[{"literal":{"string":"a"}},{"test":"==","value":{"string":"b"},"expr":{"ref":"B"}}]}`)},
		{"a test's comparator is a string", alt(`{"seq":[{"literal":{"string":"a"}},{"test":7,"value":{"string":"b"},"expr":{"ref":"B"}}]}`)},
		{"a sound test's string is in lower case", alt(`{"seq":[{"literal":{"string":"a"}},{"test":"=","value":{"string":"lA"},"expr":{"ref":"B"}}]}`)},
		{"a sound test's string is in lower case (Cyrillic)", alt(`{"seq":[{"literal":{"string":"a"}},{"test":"=","value":{"string":"Ла"},"expr":{"ref":"B"}}]}`)},
		{"a sound test's string has no comma", alt(`{"seq":[{"literal":{"string":"a"}},{"test":"≠","value":{"string":"l,a"},"expr":{"ref":"B"}}]}`)},
		{"a sound test's value is a string", alt(`{"seq":[{"literal":{"string":"a"}},{"test":"=","value":{"tag":"UI"},"expr":{"ref":"B"}}]}`)},
		{"a tag test's value is a tag set", alt(`{"seq":[{"literal":{"string":"a"}},{"test":"⊇","value":{"string":"b"},"expr":{"ref":"B"}}]}`)},
		{"a test's value is closed (tags)", alt(`{"seq":[{"literal":{"string":"a"}},{"test":"⊇","value":{"method":"tags","receiver":{"capture":""},"args":[]},"expr":{"ref":"B"}}]}`)},
		{"a test's value is closed (phonemes)", alt(`{"seq":[{"literal":{"string":"a"}},{"test":"=","value":{"method":"value","receiver":{"capture":""},"args":[]},"expr":{"ref":"B"}}]}`)},
		{"a test's value is closed (a capture)", alt(`{"seq":[{"literal":{"string":"a"}},{"test":"=","value":{"capture":"x"},"expr":{"ref":"B"}}]}`)},
		{"a test does not follow a group", alt(`{"seq":[{"literal":{"string":"a"}},{"test":"=","value":{"string":"b"},"expr":{"seq":[{"ref":"B"},{"ref":"C"}]}}]}`)},
		{"a test does not follow an optional", alt(`{"seq":[{"literal":{"string":"a"}},{"test":"=","value":{"string":"b"},"expr":{"optional":{"ref":"B"}}}]}`)},
		{"a test does not follow a test", alt(`{"seq":[{"literal":{"string":"a"}},{"test":"=","value":{"string":"b"},"expr":{"test":"=","value":{"string":"b"},"expr":{"ref":"B"}}}]}`)},
		{"a test does not follow a capture", alt(`{"seq":[{"literal":{"string":"a"}},{"test":"=","value":{"string":"b"},"expr":{"capture":"x","expr":{"ref":"B"}}}]}`)},
		{"a test does not follow ε", alt(`{"seq":[{"literal":{"string":"a"}},{"test":"=","value":{"string":"b"},"expr":{"empty":true}}]}`)},
		{"a tested reference is not also empty", alt(`{"seq":[{"literal":{"string":"a"}},{"test":"=","value":{"string":"b"},"expr":{"empty":true,"ref":"B"}}]}`)},
		{"a tested reference is not also a terminal", alt(`{"seq":[{"literal":{"string":"a"}},{"test":"=","value":{"string":"b"},"expr":{"ref":"B","terminal":"b"}}]}`)},
		{"a tested symbol is not also empty", alt(`{"seq":[{"literal":{"string":"a"}},{"test":"=","value":{"string":"b"},"expr":{"ref":"B"},"empty":true}]}`)},
		{"a tested symbol has its symbol", alt(`{"seq":[{"literal":{"string":"a"}},{"test":"=","value":{"string":"b"},"ref":"B"}]}`)},
		{"a tested symbol has its value", alt(`{"seq":[{"literal":{"string":"a"}},{"test":"=","expr":{"ref":"B"}}]}`)},
		{"a tested symbol is not also a capture", alt(`{"seq":[{"literal":{"string":"a"}},{"capture":"x","test":"=","value":{"string":"b"},"expr":{"ref":"B"}}]}`)},
		{"a tested symbol is not also an optional", alt(`{"seq":[{"literal":{"string":"a"}},{"optional":{"ref":"B"},"test":"=","value":{"string":"b"},"expr":{"ref":"🆓"}}]}`)},
		{"a capture of a tested symbol is checked", alt(`{"seq":[{"literal":{"string":"a"}},{"capture":"x","expr":{"test":"=","value":{"string":"B"},"expr":{"ref":"B"}}}]}`)},
		{"a tested symbol counts toward the nesting", alt(`{"seq":[` + strings.Repeat(`{"seq":[{"literal":{"string":"a"}},`, 255) + `{"test":"=","value":{"string":"b"},"expr":{"literal":{"string":"b"}}}` + strings.Repeat(`]}`, 255) + `,{"literal":{"string":"b"}}]}`)},
		{"a test's value counts on from the test", alt(strings.Repeat(`{"optional":`, 255) + `{"test":"⊇","value":{"union":[{"tag":"A"},{"tag":"B"}]},"expr":{"ref":"LE"}}` + strings.Repeat(`}`, 255))},
		{"no tags on an inserted tag", emit(`{"items":[{"capture":"x"},{"insert":"y","tags":{"tag":"Z"}}]}`)},
		{"an emission's items are a list", emit(`{"items":null}`)},
		{"a function exists", tagged(`{"method":"size","receiver":{"capture":"x"},"args":[]}`)},
		{"phonemes takes one span", tagged(`{"method":"value","receiver":{"capture":"x"},"args":[{"capture":"x"}]}`)},
		{"text takes a span", tagged(`{"method":"source-text","receiver":{"string":"x"},"args":[]}`)},
		{"tags takes a span and a rule name", tagged(`{"method":"tags","receiver":{"capture":"x"},"args":[{"string":"r"}]}`)},
		{"lowercase is not a function", tagged(`{"method":"lowercase","receiver":{"string":"X"},"args":[]}`)},
		{"runs is not a function", cond(`{"op":"∈","left":{"string":"a"},"right":{"method":"runs","receiver":{"capture":"x"},"args":[]}}`)},
		{"tag takes a string", tagged(`{"method":"tag","receiver":{"tag":"X"},"args":[]}`)},
		{"split takes two strings", cond(`{"op":"∈","left":{"string":"a"},"right":{"method":"split","receiver":{"string":"a"},"args":[]}}`)},
		{"split takes strings, not spans", cond(`{"op":"∈","left":{"string":"a"},"right":{"method":"split","receiver":{"capture":"x"},"args":[{"string":"."}]}}`)},
		{"split has no empty delimiter", cond(`{"op":"∈","left":{"string":"a"},"right":{"method":"split","receiver":{"string":"a"},"args":[{"string":""}]}}`)},
		{"tag takes a name", tagged(`{"method":"tag","receiver":{"string":"x y"},"args":[]}`)},
		{"a capture is not on the left of ∈", cond(`{"op":"∈","left":{"capture":"x"},"right":{"capture":"x"}}`)},
		{"tags() is not on the left of ∉", cond(`{"op":"∉","left":{"method":"tags","receiver":{"capture":"x"},"args":[]},"right":{"string":"b"}}`)},
		{"head is a span, not a value", tagged(`{"method":"first-token","receiver":{"capture":"x"},"args":[]}`)},
		{"head takes a span", tagged(`{"method":"tags","receiver":{"method":"first-token","receiver":{"tag":"x"},"args":[]},"args":[]}`)},
		{"matches is never a term", tagged(`{"method":"matches","receiver":{"capture":"x"},"args":[{"rule":"text"}]}`)},
		{"initial is never a term", tagged(`{"method":"starts-input","receiver":{"capture":"x"},"args":[]}`)},
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
		{"∈ tests a string in a set of strings", cond(`{"op":"∈","left":{"string":"b"},"right":{"method":"tags","receiver":{"capture":"x"},"args":[]}}`)},
		{"⊆ compares sets of one kind", cond(`{"op":"⊆","left":{"tag":"a"},"right":` + runs + `}`)},
		{"= compares values of one type", cond(`{"op":"=","left":{"method":"source-text","receiver":{"capture":"x"},"args":[]},"right":{"tag":"a"}}`)},
		{"the kind of ∅ = ∅ is given", cond(`{"op":"=","left":{"emptySet":true},"right":{"emptySet":true}}`)},
		{"a tag term is a tag set", tagged(`{"string":"x"}`)},
		{"a union joins sets of one kind", tagged(`{"union":[{"method":"tags","receiver":{"capture":"x"},"args":[]},` + runs + `]}`)},
		{"tag takes a string, not a span", tagged(`{"method":"tag","receiver":{"capture":"x"},"args":[]}`)},
		// Constants and their definitions (engine §2, §9, §10).
		{"a DOM has constants", strings.Replace(alt(good), `,"constants":[]`, ``, 1)},
		{"constants are a list", strings.Replace(alt(good), `"constants":[]`, `"constants":null`, 1)},
		{"a constant's name begins with a capital", constant(`{"name":"a","op":"define","value":{"tag":"X"},"at":[3,1]}`)},
		{"a constant's op is define or redefine", constant(`{"name":"A","op":"extend","value":{"tag":"X"},"at":[3,1]}`)},
		{"a constant has a value", constant(`{"name":"A","op":"define","at":[3,1]}`)},
		{"a constant has no other member", constant(`{"name":"A","op":"define","value":{"tag":"X"},"at":[3,1],"x":1}`)},
		{"a constant has a position", constant(`{"name":"A","op":"define","value":{"tag":"X"},"at":[3]}`)},
		{"a constant's value holds no capture", constant(`{"name":"A","op":"define","value":{"union":[{"tag":"X"},{"capture":"x"}]},"at":[3,1]}`)},
		{"a constant's value calls no phonemes", constant(`{"name":"A","op":"define","value":{"method":"split","receiver":{"method":"value","receiver":{"capture":"x"},"args":[]},"args":[{"string":"."}]},"at":[3,1]}`)},
		{"a constant's value holds no guarded term", constant(`{"name":"A","op":"define","value":{"if":{"op":"⊆","left":{"tag":"X"},"right":{"tag":"Y"}},"then":{"tag":"Z"}},"at":[3,1]}`)},
		{"a constant's value has a kind", constant(`{"name":"A","op":"define","value":{"emptySet":true},"at":[3,1]}`)},
		{"a constant's value is well formed", constant(`{"name":"A","op":"define","value":{"union":[{"tag":"X"}]},"at":[3,1]}`)},
		{"a constant's value agrees in type", constant(`{"name":"A","op":"define","value":{"union":[{"tag":"X"},{"string":"x"}]},"at":[3,1]}`)},
		{"a constant and a rule at one position", constant(`{"name":"A","op":"define","value":{"tag":"X"},"at":[1,1]}`)},
		{"a constant's reference names a constant", tagged(`{"const":"x","at":[1,5]}`)},
		{"a constant's reference has a position", tagged(`{"const":"X"}`)},
		// Capture names, terminals and inserted tags (engine §1, §9).
		{"a capture name is lower case", alt(`{"seq":[{"capture":"X","expr":{"ref":"A"}},{"ref":"B"}]}`)},
		{"a terminal is a tag", alt(`{"seq":[{"literal":{"string":"é"}},{"literal":{"string":"b"}}]}`)},
		{"a terminal is one character", alt(`{"seq":[{"literal":{"string":"'ab'"}},{"literal":{"string":"b"}}]}`)},
		{"an inserted tag is a tag", emit(`{"items":[{"insert":"a b"},{"capture":"x"}]}`)},
		{"an inserted tag is canonical", emit(`{"items":[{"insert":"'\\u{61}'"},{"capture":"x"}]}`)},
		{"unknown directive name", directive(`{"name":"unknown","args":["KU"],"at":[3,1]}`)},
		{"a call's arguments are a list", tagged(`{"call":"tags","args":null}`)},
		{"a rule's tag term is well formed", rule(`"tags":{"call":"classes","args":null},"alternatives":[{"guards":[],"expr":` + good + `}],"conditions":[]`)},
		{"an alternative's tags are not $", tagged(`{"union":[{"tag":"X"},{"capture":""}]}`)},
		{"an alternative's tags are not $.tags", tagged(`{"method":"tags","receiver":{"capture":""},"args":[]}`)},
		{"an alternative's tags are not classes($)", tagged(`{"method":"classes","receiver":{"capture":""},"args":[]}`)},
		{"a rule's tags are not $.tags", rule(`"tags":{"method":"tags","receiver":{"capture":""},"args":[]},"alternatives":[{"guards":[],"expr":` + good + `}],"conditions":[]`)},
		{"a comparison is known", cond(`{"op":"<","left":{"string":"a"},"right":{"string":"b"}}`)},
		{"a comparison has two terms", cond(`{"op":"=","left":{"string":"a"}}`)},
		{"an any has two conditions or more", cond(`{"any":[{"not":{"method":"matches","receiver":{"capture":"x"},"args":[{"rule":"text"}]}}]}`)},
		{"an all has two conditions or more", cond(`{"all":[{"not":{"method":"matches","receiver":{"capture":"x"},"args":[{"rule":"text"}]}}]}`)},
		{"an all counts toward the nesting", cond(strings.Repeat(`{"all":[{"matches":{"capture":"x"},"rule":"text"},`, 256) + `{"method":"matches","receiver":{"capture":"x"},"args":[{"rule":"text"}]}` + strings.Repeat(`]}`, 256))},
		{"matches takes a span", cond(`{"method":"matches","receiver":{"tag":"x"},"args":[{"rule":"text"}]}`)},
		{"matches takes a rule", cond(`{"matches":{"capture":"x"}}`)},
		{"begins takes a span", cond(`{"method":"begins","receiver":{"tag":"x"},"args":[{"rule":"text"}]}`)},
		{"begins takes a rule", cond(`{"begins":{"capture":"x"}}`)},
		{"a condition is matches or begins, not both", cond(`{"method":"matches","receiver":{"capture":"x"},"args":[{"rule":"text"}],"begins":true}`)},
		{"a capture begins mentions is captured", cond(`{"method":"begins","receiver":{"method":"following-tokens","receiver":{"capture":"z"},"args":[]},"args":[{"rule":"text"}]}`)},
		{"begins counts toward the nesting", cond(strings.Repeat(`{"not":`, 256) + `{"method":"begins","receiver":{"capture":"x"},"args":[{"rule":"text"}]}` + strings.Repeat(`}`, 256))},
		{"begins is never a term", tagged(`{"method":"begins","receiver":{"capture":"x"},"args":[{"rule":"text"}]}`)},
		{"from is a span, not a value", tagged(`{"method":"onward","receiver":{"capture":"x"},"args":[]}`)},
		{"after takes a span", tagged(`{"method":"tags","receiver":{"method":"following-tokens","receiver":{"tag":"x"},"args":[]},"args":[]}`)},
		{"initial takes a span", cond(`{"method":"starts-input","receiver":{"tag":"x"},"args":[]}`)},
		{"initial has only its span", cond(`{"method":"starts-input","receiver":{"capture":"x"},"args":[],"rule":"text"}`)},
		{"initial counts toward the nesting", cond(strings.Repeat(`{"not":`, 256) + `{"method":"starts-input","receiver":{"capture":"x"},"args":[]}` + strings.Repeat(`}`, 256))},
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
		{"two directives at one position", directive(`{"name":"features","args":["f"],"at":[2,1]}`)},
		{"a rule and a directive at one position", strings.Replace(alt(good), `"at":[2,1]`, `"at":[1,1]`, 1)},
		// A range or a property is checked as the reader checks it
		// (engine §1, §9).
		{"a range starts at or below its end", alt(`{"range":[{"string":"z"},{"string":"a"}]}`)},
		{"a range has two ends", alt(`{"range":[{"string":"a"}]}`)},
		{"a range's ends are canonical", alt(`{"range":[{"string":"a"},{"string":"z"}]}`)},
		{"a range's ends are character tags", alt(`{"range":[{"string":"A"},{"string":"z"}]}`)},
		{"a range's ends are strings", alt(`{"range":[{"string":"a"},1]}`)},
		{"a range has no other member", alt(`{"range":[{"string":"a"},{"string":"z"}],"terminal":"A"}`)},
		{"a property's name is a short form", alt(`{"ref":"_Letter"}`)},
		{"a property's name has its case", alt(`{"ref":"_lu"}`)},
		{"a property has no other member", alt(`{"property":"L","range":[{"string":"a"},{"string":"z"}]}`)},
		{"a tested range is checked", alt(`{"test":"⊇","value":{"tag":"'a'"},"expr":{"range":[{"string":"z"},{"string":"a"}]}}`)},
		{"a tested property is checked", alt(`{"test":"=","value":{"string":"a"},"expr":{"ref":"_Letter"}}`)},
		{"a property is not a term", tagged(`{"ref":"_General_Category_Letter"}`)},
		{"a range in a term starts at or below its end", tagged(`{"range":[{"string":"z"},{"string":"a"}]}`)},
		{"an inserted range is not one tag", emit(`{"items":[{"insert":"'a'..'z'"},{"capture":"x"}]}`)},
		// Classifiers, implications and classify (engine §2, §9).
		{"a DOM has classifiers", strings.Replace(alt(good), `,"classifiers":[]`, ``, 1)},
		{"implications are a list", strings.Replace(alt(good), `"implications":[]`, `"implications":null`, 1)},
		{"a classifier's name begins with a lower-case letter", classified(`{"name":"Lex","entries":[],"at":[3,1]}`, "")},
		{"a classifier has a position", classified(`{"name":"lex","entries":[],"at":null}`, "")},
		{"a classifier has no other member", classified(`{"name":"lex","entries":[],"at":[3,1],"x":true}`, "")},
		{"a classifier's entries are a list", classified(`{"name":"lex","entries":null,"at":[3,1]}`, "")},
		{"an entry takes no warning", entry(`{"guards":[{"feature":"f","kind":"warning","negated":false}],"keys":[{"string":"mi"}],"op":"∈","class":"KOhA","at":[3,3]}`)},
		{"a rule's gate is not empty", guarded(`{"feature":"","kind":"gate","negated":false}`)},
		{"a rule's gate is not a mark", guarded(`{"feature":"!","kind":"gate","negated":false}`)},
		{"a rule's gate has no space", guarded(`{"feature":"bad name","kind":"gate","negated":true}`)},
		{"a warning is not empty", guarded(`{"feature":"","kind":"warning","negated":false}`)},
		{"a warning is not a mark", guarded(`{"feature":"!","kind":"warning","negated":false}`)},
		{"a warning has no space", guarded(`{"feature":"bad name","kind":"warning","negated":false}`)},
		{"a gate's feature is not empty", entry(`{"guards":[{"feature":"","kind":"gate","negated":false}],"keys":[{"string":"mi"}],"op":"∈","class":"KOhA","at":[3,3]}`)},
		{"a gate's feature is not a mark", entry(`{"guards":[{"feature":"!","kind":"gate","negated":false}],"keys":[{"string":"mi"}],"op":"∈","class":"KOhA","at":[3,3]}`)},
		{"a gate's feature has no space", entry(`{"guards":[{"feature":"bad name","kind":"gate","negated":false}],"keys":[{"string":"mi"}],"op":"∈","class":"KOhA","at":[3,3]}`)},
		{"an entry's guard has no other member", entry(`{"guards":[{"feature":"f","kind":"gate","negated":false,"x":1}],"keys":[{"string":"mi"}],"op":"∈","class":"KOhA","at":[3,3]}`)},
		{"an entry has a key", entry(`{"guards":[],"keys":[],"op":"∈","class":"KOhA","at":[3,3]}`)},
		{"a key is in lower case", entry(`{"guards":[],"keys":[{"string":"\ud800"}],"op":"∈","class":"KOhA","at":[3,3]}`)},
		{"a key has no comma", entry(`{"guards":[],"keys":[{"string":"m,i"}],"op":"∈","class":"KOhA","at":[3,3]}`)},
		{"a key is a string", entry(`{"guards":[],"keys":[1],"op":"∈","class":"KOhA","at":[3,3]}`)},
		{"an entry's operator is ∈ or ∉", entry(`{"guards":[],"keys":[{"string":"mi"}],"op":"=","class":"KOhA","at":[3,3]}`)},
		{"a class begins with a capital", entry(`{"guards":[],"keys":[{"string":"mi"}],"op":"∈","class":"koha","at":[3,3]}`)},
		{"a class is a name", entry(`{"guards":[],"keys":[{"string":"mi"}],"op":"∈","class":"/a/","at":[3,3]}`)},
		{"an entry has no other member", entry(`{"guards":[],"keys":[{"string":"mi"}],"op":"∈","class":"KOhA","at":[3,3],"x":true}`)},
		{"an implication has a position", implies(`{"if":{"tag":"UI"},"then":{"tag":"m"},"at":null}`)},
		{"an implication has no other member", implies(`{"if":{"tag":"UI"},"then":{"tag":"m"},"at":[3,1],"x":true}`)},
		{"an implication has two sides", implies(`{"if":{"tag":"UI"},"at":[3,1]}`)},
		{"a side of an implication is closed", implies(`{"if":{"tag":"UI"},"then":{"method":"tags","receiver":{"capture":"x"},"args":[]},"at":[3,1]}`)},
		{"a side of an implication calls no classify", implies(`{"if":{"method":"classify","receiver":{"string":"mi"},"args":[{"classifier":"lex"}]},"then":{"tag":"m"},"at":[3,1]}`)},
		{"a side of an implication is a tag set", implies(`{"if":{"tag":"UI"},"then":{"string":"a"},"at":[3,1]}`)},
		{"an implication and a rule at one position", implies(`{"if":{"tag":"UI"},"then":{"tag":"m"},"at":[1,1]}`)},
		{"a classifier and an implication at one position", classified(`{"name":"lex","entries":[],"at":[3,1]}`, `{"if":{"tag":"UI"},"then":{"tag":"m"},"at":[3,1]}`)},
		{"classify names a classifier, not a rule", tagged(`{"method":"classify","receiver":{"method":"value","receiver":{"capture":"x"},"args":[]},"args":[{"rule":"lex"}]}`)},
		{"a classifier's name in classify begins with a lower-case letter", tagged(`{"method":"classify","receiver":{"method":"value","receiver":{"capture":"x"},"args":[]},"args":[{"classifier":"Lex"}]}`)},
		{"classify takes a string, not a span", tagged(`{"method":"classify","receiver":{"capture":"x"},"args":[{"classifier":"lex"}]}`)},
		{"classify takes a string, not a tag set", tagged(`{"method":"classify","receiver":{"tag":"x"},"args":[{"classifier":"lex"}]}`)},
		{"classify takes two arguments", tagged(`{"method":"classify","receiver":{"method":"value","receiver":{"capture":"x"},"args":[]},"args":[]}`)},
		{"a classifier is not a term", tagged(`{"classifier":"lex"}`)},
		{"split takes no classifier", cond(`{"op":"∈","left":{"string":"a"},"right":{"method":"split","receiver":{"string":"a"},"args":[{"classifier":"lex"}]}}`)},
		{"split takes no classifier first", cond(`{"op":"∈","left":{"string":"a"},"right":{"method":"split","receiver":{"classifier":"lex"},"args":[{"string":"."}]}}`)},
		{"tag takes no classifier", cond(`{"op":"⊆","left":{"method":"tag","receiver":{"classifier":"lex"},"args":[]},"right":{"tag":"a"}}`)},
		{"a constant's value calls no classify", constant(`{"name":"A","op":"define","value":{"method":"classify","receiver":{"string":"mi"},"args":[{"classifier":"lex"}]},"at":[3,1]}`)},
	}
	// Each variation's well-formed twin decodes, so that the refusals are
	// the rule's and not the test's.
	for _, ok := range []string{alt(good), alt(nested(255)),
		// A range, a property, each captured, and a range in a term.
		alt(`{"range":[{"string":"a"},{"string":"z"}]}`), alt(`{"ref":"_White_Space"}`),
		alt(`{"seq":[{"capture":"c","expr":{"range":[{"string":"\u0300"},{"string":"\u036f"}]}},{"capture":"d","expr":{"ref":"_General_Category_Surrogate"}}]}`),
		tagged(`{"union":[{"tag":"A"},{"tag":"X"}]}`),
		// Classifiers, entries, implications and classify.
		classified(`{"name":"lex","entries":[{"guards":[],"keys":[{"string":"mi"},{"string":"do"}],"op":"∈","class":"KOhA","at":[3,3]},{"guards":[{"feature":"f","kind":"gate","negated":true}],"keys":[{"string":"u'i"}],"op":"∉","class":"UI","at":[4,3]}],"at":[3,1]},{"name":"empty","entries":[],"at":[5,1]}`,
			`{"if":{"union":[{"tag":"UI"},{"const":"K","at":[6,15]}]},"then":{"tag":"Indicator"},"at":[6,1]},{"if":{"union":[{"tag":"A"},{"tag":"C"}]},"then":{"union":[{"tag":"Early"},{"tag":"A"}]},"at":[7,1]}`),
		tagged(`{"union":[{"tag":"T"},{"method":"classify","receiver":{"method":"value","receiver":{"capture":"x"},"args":[]},"args":[{"classifier":"lex"}]}]}`),
		// A gate, negated or not, and a warning.
		guarded(`{"feature":"f","kind":"gate","negated":true}`), guarded(`{"feature":"f","kind":"gate","negated":false},{"feature":"g","kind":"warning","negated":false}`),
		alt(`{"seq":[{"capture":"a","expr":{"literal":{"string":"a"}}},{"capture":"b","expr":{"literal":{"string":"b"}}},{"capture":"c","expr":{"ref":"C"}},{"capture":"d","expr":{"ref":"D"}}]}`),
		// Each at the bound: the deepest node below exactly 256 compound ones.
		alt(`{"seq":[` + strings.Repeat(`{"seq":[{"literal":{"string":"a"}},`, 254) + `{"capture":"x","expr":{"literal":{"string":"b"}}}` + strings.Repeat(`]}`, 254) + `,{"literal":{"string":"b"}}]}`),
		tagged(unions(256)),
		strings.Replace(alt(good), `"name":"text"`, `"name":"🆓"`, 1),
		alt(`{"test":"=","value":{"string":"b"},"expr":{"ref":"🆓"}}`),
		// The pipeline directives with their operands; an include's path
		// is any string.
		directive(`{"name":"stage","args":["a-1"],"at":[3,1]}`), directive(`{"name":"include","args":["../a b\\\"c.md"],"at":[3,1]}`),
		directive(`{"name":"features","args":["a","b-c"],"at":[3,1]}`),
		directive(`{"name":"features","args":["f","g"],"at":[3,1]}`),
		// Braces, chains, marked optionals, and captures anywhere but in
		// braces or an elidable optional, of any number (engine §3.5, §9).
		alt(`{"repeat":{"literal":{"string":"a"}}}`), alt(`{"repeat":{"literal":{"string":"a"}},"separator":{"literal":{"string":"b"}}}`), alt(`{"optional":{"repeat":{"literal":{"string":"a"}}}}`),
		alt(`{"repeat":{"literal":{"string":"a"}},"chain":"left"}`), alt(`{"repeat":{"literal":{"string":"a"}},"separator":{"literal":{"string":"b"}},"chain":"right"}`),
		alt(`{"seq":[{"capture":"a","expr":{"ref":"A"}},{"repeat":{"ref":"B"}}]}`),
		alt(`{"optional":{"ref":"KU"},"elidable":true}`),
		alt(`{"optional":{"ref":"KU"},"elidable":true}`), alt(`{"optional":{"seq":[{"ref":"KU"},{"ref":"🆓"}]},"elidable":true}`),
		alt(`{"optional":{"test":"=","value":{"string":"ku"},"expr":{"ref":"KU"}},"elidable":true}`),
		alt(`{"optional":{"seq":[{"ref":"KU"},{"choice":[{"ref":"A"},{"ref":"B"}]}]},"elidable":true}`),
		alt(`{"seq":[{"optional":{"capture":"x","expr":{"ref":"A"}}},{"ref":"B"}]}`), alt(`{"choice":[{"capture":"x","expr":{"ref":"A"}},{"ref":"B"}]}`),
		alt(`{"and":[{"capture":"x","expr":{"ref":"A"}},{"ref":"B"}]}`), alt(`{"choice":[{"capture":"x","expr":{"ref":"A"}},{"capture":"x","expr":{"ref":"B"}}]}`),
		alt(`{"seq":[{"ref":"A"},{"optional":{"seq":[{"ref":"B"},{"optional":{"capture":"c","expr":{"ref":"C"}}}]}}]}`),
		alt(`{"seq":[{"capture":"c","expr":{"ref":"A"}},{"capture":"d","expr":{"ref":"A"}},{"capture":"e","expr":{"ref":"A"}},{"capture":"f","expr":{"ref":"A"}},{"capture":"g","expr":{"ref":"A"}},{"capture":"h","expr":{"ref":"A"}}]}`),
		// Terms of each type where they agree, and canonical tags.
		tagged(`{"difference":[{"tag":"X"},{"tag":"Y"}]}`), tagged(`{"tag":"Backslash"}`),
		cond(`{"op":"=","left":{"method":"source-text","receiver":{"capture":"x"},"args":[]},"right":{"string":"wrong"}}`),
		alt(`{"seq":[{"literal":{"string":"é"}},{"literal":{"string":"'\\u{301}'"}}]}`), emit(`{"items":[{"insert":true,"value":{"concat":[{"string":"a"}]}},{"capture":"x"}]}`),
		cond(`{"op":"∈","left":{"method":"source-text","receiver":{"capture":"x"},"args":[]},"right":` + runs + `}`),
		cond(`{"op":"⊈","left":{"tag":"A"},"right":{"method":"tags","receiver":{"capture":"x"},"args":[]}}`),
		cond(`{"op":"=","left":{"emptySet":true},"right":` + runs + `}`),
		// An emission and its items are not compound: an item's term counts
		// from the top.
		emit(`{"items":[{"capture":"","tags":` + unions(256) + `}]}`),
		cond(strings.Repeat(`{"not":`, 255) + `{"method":"matches","receiver":{"capture":"x"},"args":[{"rule":"text"}]}` + strings.Repeat(`}`, 255)), emit(`{"items":[{"capture":""},{"capture":""}]}`), emit(`{"items":[{"insert":true,"value":{"concat":[{"string":"y"}]}},{"capture":"x"}]}`),
		// %erased, for one alternative and for several.
		strings.Replace(alt(good), `"conditions":[]`, `"conditions":[],"erased":true`, 1), two(`"erased":true,"conditions":[]`),
		emit(`{"items":[{"capture":"x"},{"insert":true,"value":{"concat":[{"string":"y"}]}},{"capture":"y","tags":{"method":"tags","receiver":{"capture":""},"args":[]}}]}`),
		tagged(`{"method":"tags","receiver":{"capture":""},"args":[{"rule":"text"}]}`), tagged(`{"method":"tags","receiver":{"method":"first-token","receiver":{"capture":""},"args":[]},"args":[]}`),
		cond(`{"all":[{"method":"matches","receiver":{"capture":""},"args":[{"rule":"text"}]},{"op":"⊆","left":{"tag":"A"},"right":{"method":"tags","receiver":{"capture":""},"args":[]}}]}`),
		cond(strings.Repeat(`{"all":[{"method":"matches","receiver":{"capture":"x"},"args":[{"rule":"text"}]},`, 255) + `{"method":"matches","receiver":{"capture":"x"},"args":[{"rule":"text"}]}` + strings.Repeat(`]}`, 255)),
		cond(`{"op":"⊆","left":{"method":"tags","receiver":{"method":"first-token","receiver":{"capture":"x"},"args":[]},"args":[]},"right":{"tag":"A"}}`),
		// Constants, their definitions and their references.
		constant(`{"name":"A","op":"define","value":{"union":[{"tag":"X"},{"const":"B","at":[3,20]}]},"at":[3,1]}`),
		constant(`{"name":"A","op":"redefine","value":{"emptySet":true},"at":[3,1]}`),
		constant(`{"name":"A","op":"define","value":{"method":"split","receiver":{"string":"a.b"},"args":[{"const":"P","at":[3,20]}]},"at":[3,1]}`),
		constant(`{"name":"A","op":"define","value":{"tag":"X"},"at":[3,1]}`),
		tagged(`{"union":[{"const":"A","at":[1,5]},{"const":"S","at":[1,9]}]}`),
		cond(`{"op":"∈","left":{"const":"S","at":[1,5]},"right":{"method":"split","receiver":{"method":"value","receiver":{"capture":"x"},"args":[]},"args":[{"const":"P","at":[1,9]}]}}`),
		cond(`{"any":[{"not":{"method":"matches","receiver":{"capture":"x"},"args":[{"rule":"text"}]}},{"op":"=","left":{"string":"a"},"right":{"string":"a"}}]}`),
		cond(strings.Repeat(`{"not":`, 254) + `{"method":"starts-input","receiver":{"method":"tokens-after-first","receiver":{"capture":"x"},"args":[]},"args":[]}` + strings.Repeat(`}`, 254)),
		// A lookahead, at the bound, and the tokens' tags from $ on.
		cond(strings.Repeat(`{"not":`, 254) + `{"method":"begins","receiver":{"method":"following-tokens","receiver":{"capture":"x"},"args":[]},"args":[{"rule":"text"}]}` + strings.Repeat(`}`, 254)),
		cond(`{"method":"begins","receiver":{"method":"onward","receiver":{"method":"tokens-after-first","receiver":{"capture":""},"args":[]},"args":[]},"args":[{"rule":"text"}]}`),
		tagged(`{"method":"tags","receiver":{"method":"onward","receiver":{"capture":""},"args":[]},"args":[]}`),
		// Tested symbols, captured or not, of each comparator, and at the
		// bound of the nesting.
		alt(`{"seq":[{"capture":"x","expr":{"test":"=","value":{"string":"la'i"},"expr":{"ref":"LE"}}},{"test":"≠","value":{"string":"a"},"expr":{"literal":{"string":"/a/"}}}]}`),
		alt(`{"seq":[{"test":"=","value":{"string":""},"expr":{"ref":"LE"}},{"test":"tags","requirements":[{"negated":true,"value":{"tag":"UI"}}],"expr":{"ref":"Cmavo"}}]}`),
		alt(`{"seq":[{"test":"tags","requirements":[{"negated":false,"value":{"tag":"UI"}},{"negated":false,"value":{"tag":"A"}},{"negated":false,"value":{"tag":"C"}}],"expr":{"range":[{"string":"a"},{"string":"z"}]}},{"test":"tags","requirements":[{"negated":true,"value":{"tag":"X"}}],"expr":{"ref":"_General_Category_Letter"}}]}`),
		alt(`{"seq":[{"test":"tags","requirements":[{"negated":false,"value":{"const":"A","at":[1,1]}}],"expr":{"ref":"LE"}},{"test":"=","value":{"const":"S","at":[1,2]},"expr":{"ref":"LE"}}]}`),
		alt(`{"seq":[{"capture":"l","expr":{"test":"=","value":{"string":"la"},"expr":{"ref":"LE"}}},{"repeat":{"test":"=","value":{"string":"ui"},"expr":{"ref":"UI"}}}]}`),
		alt(`{"seq":[` + strings.Repeat(`{"seq":[{"literal":{"string":"a"}},`, 254) + `{"test":"=","value":{"string":"b"},"expr":{"literal":{"string":"b"}}}` + strings.Repeat(`]}`, 254) + `,{"literal":{"string":"b"}}]}`),
		alt(strings.Repeat(`{"optional":`, 254) + `{"test":"tags","requirements":[{"negated":false,"value":{"tag":"A"}},{"negated":false,"value":{"tag":"B"}}],"expr":{"ref":"LE"}}` + strings.Repeat(`}`, 254)),
		strings.Replace(alt(good), `"define"`, `"redefine"`, 1),
		strings.Replace(alt(good), `"conditions":[]`, `"conditions":[],"value":{"concat":[{"string":"?"}]}`, 1), emit(`{"items":[{"capture":"x"}]},"value":{"concat":[{"string":"?"}]}`),
		// Clauses that serve alternatives with different captures.
		two(`"tags":{"union":[{"tag":"T"},{"if":{"captured":"x"},"then":{"method":"tags","receiver":{"capture":"x"},"args":[]}}]},"conditions":[]`),
		two(`"conditions":[{"captured":"x"},{"if":{"captured":"z"},"then":{"method":"matches","receiver":{"capture":"z"},"args":[{"rule":"text"}]}}]`),
		two(`"emit":{"items":[{"capture":"x"},{"insert":true,"value":{"concat":[{"string":"T"}]}}]},"conditions":[]`),
		// Attachments before and after a carrier, and one that an
		// alternative with the carrier lacks.
		emit(`{"items":[{"capture":"y","before":["x"]}]}`), emit(`{"items":[{"capture":"x","after":["y"]}]}`),
		rule(`"alternatives":[{"guards":[],"expr":{"seq":[{"capture":"x","expr":{"literal":{"string":"a"}}},{"capture":"y","expr":{"literal":{"string":"b"}}}]}},{"guards":[],"expr":{"seq":[{"capture":"x","expr":{"literal":{"string":"a"}}},{"literal":{"string":"b"}}]}}],"emit":{"items":[{"insert":true,"value":{"concat":[{"string":"T"}]}},{"capture":"x","after":["y"]}]},"conditions":[]`),
		two(`"emit":{"items":[{"capture":"x","tags":{"method":"tags","receiver":{"capture":"z"},"args":[]}},{"capture":"z"},{"insert":true,"value":{"concat":[{"string":"T"}]}}]},"conditions":[]`)} {
		if _, err := decodeDOM(json.RawMessage(ok), bundled.uni); err != nil {
			t.Fatalf("a well-formed DOM is refused: %v\n%s", err, ok)
		}
	}
	sources := oneStage("%ambiguity-resolution greedy\n%rule text \"a\" \"b\"")
	sources = map[string]string{"grammars/test/p.md": sources["p.md"], "grammars/test/g.md": sources["g.md"]}
	accepted := map[string]string{
		"$ only with $ (a capture)":                         "Overlap is checked from the stitched consuming graph, rather than this local DOM.",
		"no ∅ as an item's tags":                            "An emitted token can have an empty tag set (engine §1).",
		"a sound test's string is in lower case":            "Stored values compare exactly and permit uppercase (engine §4).",
		"a sound test's string is in lower case (Cyrillic)": "Stored values compare exactly and permit uppercase (engine §4).",
		"a sound test's string has no comma":                "Stored values retain commas (engine §4).",
		"a capture of a tested symbol is checked":           "Stored value tests permit uppercase operands (engine §4).",
		"split takes strings, not spans":                    "A string method converts its span receiver to value (engine §10).",
		"a span is not a value in ∈":                        "Value operations convert spans to stored values (engine §10).",
		"a terminal is a tag":                               "A literal is a string terminal even when it is not a tag (engine §1).",
		"a terminal is one character":                       "String terminals can contain several scalars (engine §1).",
		"a range's ends are canonical":                      "String endpoints use their exact decoded scalar values (engine §9).",
		"a range's ends are character tags":                 "Range endpoints are strings rather than character tags (engine §9).",
		"a key has no comma":                                "Classifier keys are exact strings and retain commas (engine §2).",
		"classify takes a string, not a span":               "A string method converts its span receiver to value (engine §10).",
	}
	for _, c := range cases {
		if reason, ok := accepted[c.rule]; ok {
			dom, err := decodeDOM(json.RawMessage(c.dom), bundled.uni)
			if err != nil {
				t.Errorf("%s: %s: %v", c.rule, reason, err)
				continue
			}
			if _, err := decodeDOM(dom.json(), bundled.uni); err != nil {
				t.Errorf("%s: accepted DOM does not round trip: %v", c.rule, err)
			}
			continue
		}
		if _, err := decodeDOM(json.RawMessage(c.dom), bundled.uni); err == nil {
			t.Errorf("%s: a DOM breaking it decodes", c.rule)
			continue
		}
		src := map[string]string{}
		for k, v := range sources {
			src[k] = v
		}
		src["data/preparsed/test.json"] = `{` + format + `,"bootstrap":"` + bundled.reader.hash + `","unicode":"` + bundled.uni.hash + `","properties":"` + fnv1a64(bundled.sources["data/unicode/unicode-properties.txt"]) + `","documents":{"grammars/test/g.md":{"hash":"` + fnv1a64(src["grammars/test/g.md"]) + `","dom":` + c.dom + `}}}`
		d, err := LoadDialectSources(src, "grammars/test/p.md")
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
	t.Parallel()
	loadBundled()
	doc := func(n int) string {
		return "```jbogenbau\n\n%rule text " + strings.Repeat("[", n) + "A" + strings.Repeat("]", n) + "\n```\n"
	}
	if _, err := bundled.reader.read(doc(256), "grammars/test/g.md"); err != nil {
		t.Fatalf("256 deep: %v", err)
	}
	_, err := bundled.reader.read(doc(257), "grammars/test/g.md")
	if err == nil || err.Line != 3 || err.Column != 1 {
		t.Fatalf("257 deep: expected an error at the rule, 3:1, got %v", err)
	}
}

// The reader holds an implication to the nesting limit too, at the
// implication (engine §9).
func TestReaderImplicationNesting(t *testing.T) {
	t.Parallel()
	loadBundled()
	// n differences, each of a tag and the next in parentheses: the
	// innermost tag lies below n compound nodes.
	doc := func(n int) string {
		return "```jbogenbau\n\n%implies " + strings.Repeat("A ∖ (", n) + "B" + strings.Repeat(")", n) + " ⟹ M\n```\n"
	}
	if _, err := bundled.reader.read(doc(256), "grammars/test/g.md"); err != nil {
		t.Fatalf("256 deep: %v", err)
	}
	_, err := bundled.reader.read(doc(257), "grammars/test/g.md")
	if err == nil || err.Line != 3 || err.Column != 1 || !strings.Contains(err.Message, "nested more than 256 deep") {
		t.Fatalf("257 deep: expected an error at the implication, 3:1, got %v", err)
	}
}

// bootstrapError loads a dialect whose bootstrap has item first in the
// list of the given name of its first document, and gives the error.
func bootstrapError(t *testing.T, list, item string) error {
	t.Helper()
	loadBundled()
	src := oneStage("%ambiguity-resolution greedy\n%rule text \"a\" \"b\"")
	src = map[string]string{"grammars/test/p.md": src["p.md"], "grammars/test/g.md": src["g.md"]}
	bootstrap := bundled.sources["data/preparsed/gencmu.json"]
	start := strings.Index(bootstrap, `"grammars/notation/lexical.md":`)
	i := start + strings.Index(bootstrap[start:], `"`+list+`":[`)
	if i < 0 {
		t.Fatalf("no %s in the bootstrap", list)
	}
	i += len(`"` + list + `":[`)
	sep := ","
	if bootstrap[i] == ']' {
		sep = ""
	}
	src["data/preparsed/gencmu.json"] = bootstrap[:i] + item + sep + bootstrap[i:]
	_, err := LoadDialectSources(src, "grammars/test/p.md")
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
	t.Parallel()
	bad := `{"name":"lex","entries":[{"guards":[],"keys":[{"string":"\ud800"}],"op":"∈","class":"KOhA","at":[9999,3]}],"at":[9999,1]}`
	assertGrammarError(t, bootstrapError(t, "classifiers", bad), "not valid UTF-8")
}

// A classifier's name stands only as the second argument of classify
// (engine §9). Elsewhere a bootstrap is an error of the grammar.
func TestBootstrapMisplacedClassifier(t *testing.T) {
	t.Parallel()
	rule := func(condition string) string {
		return `{"name":"misplaced-classifier","op":"define","flags":[],"alternatives":[{"guards":[],"expr":{"capture":"x","expr":{"ref":"A"}}}],"conditions":[` + condition + `],"at":[9999,1]}`
	}
	if err := bootstrapError(t, "rules", rule(`{"op":"∈","left":{"string":"a"},"right":{"method":"split","receiver":{"string":"a.b"},"args":[{"string":"."}]}}`)); err != nil {
		t.Fatalf("a well-formed rule: %v", err)
	}
	for _, condition := range []string{
		`{"op":"⊆","left":{"method":"tag","receiver":{"classifier":"lex"},"args":[]},"right":{"tag":"a"}}`,
		`{"op":"∈","left":{"string":"a"},"right":{"method":"split","receiver":{"classifier":"lex"},"args":[{"string":"."}]}}`,
		`{"op":"∈","left":{"string":"a"},"right":{"method":"split","receiver":{"string":"a.b"},"args":[{"classifier":"lex"}]}}`,
	} {
		assertGrammarError(t, bootstrapError(t, "rules", rule(condition)), "a malformed call")
	}
}

// A constant nested too deeply is refused before any walk that recurses
// (engine §9): a data/preparsed/test.json entry is a miss, and a bootstrap is an error
// of the grammar.
func TestDeepConstant(t *testing.T) {
	t.Parallel()
	loadBundled()
	deep := strings.Repeat(`{"union":[`, 2000) + `{"tag":"a"}` + strings.Repeat(`,{"tag":"B"}]}`, 2000)
	k := `{"name":"K","op":"define","value":` + deep + `,"at":[9999,1]}`
	src := oneStage("%ambiguity-resolution greedy\n%rule text \"a\" \"b\"")
	src = map[string]string{"grammars/test/p.md": src["p.md"], "grammars/test/g.md": src["g.md"]}
	dom := `{"format":` + strconv.Itoa(domFormat) + `,"rules":[{"name":"text","op":"define","flags":[],"alternatives":[{"guards":[],"expr":{"seq":[{"literal":{"string":"a"}},{"literal":{"string":"b"}}]}}],"conditions":[],"at":[4,1]}],"directives":[{"name":"ambiguity-resolution","args":["greedy"],"at":[3,1]}],"constants":[` + k + `],"classifiers":[],"implications":[]}`
	if _, err := decodeDOM(json.RawMessage(dom), bundled.uni); err == nil || !strings.Contains(err.Error(), "nested more than 256 deep") {
		t.Fatalf("a deep constant: expected the nesting error, got %v", err)
	}
	src["data/preparsed/test.json"] = `{"format":` + strconv.Itoa(domFormat) + `,"bootstrap":"` + bundled.reader.hash + `","unicode":"` + bundled.uni.hash + `","properties":"` + fnv1a64(bundled.sources["data/unicode/unicode-properties.txt"]) + `","documents":{"grammars/test/g.md":{"hash":"` + fnv1a64(src["grammars/test/g.md"]) + `","dom":` + dom + `}}}`
	d, err := LoadDialectSources(src, "grammars/test/p.md")
	if err != nil {
		t.Fatal(err)
	}
	if res, err := d.Parse("ab", ParseOptions{}); err != nil || !res.OK {
		t.Fatalf("the document was not read instead: %v %+v", err, res.Error)
	}
	delete(src, "data/preparsed/test.json")
	bootstrap := bundled.sources["data/preparsed/gencmu.json"]
	i := strings.Index(bootstrap, `"constants":[`)
	if i < 0 {
		t.Fatal("no constants in the bootstrap")
	}
	i += len(`"constants":[`)
	sep := ","
	if bootstrap[i] == ']' {
		sep = ""
	}
	src["data/preparsed/gencmu.json"] = bootstrap[:i] + k + sep + bootstrap[i:]
	_, err = LoadDialectSources(src, "grammars/test/p.md")
	var e *Error
	if !errors.As(err, &e) || e.Kind != ErrorGrammar || !strings.Contains(e.Message, "nested more than 256 deep") {
		t.Fatalf("a deep bootstrap constant: expected an error of the grammar, got %v", err)
	}
}

// A cached DOM whose capture checks wait for a constant's value is used,
// and the loader makes the checks once the constants have their values
// (engine §3.6, §9).
func TestCachedClauseWaitsForConstant(t *testing.T) {
	t.Parallel()
	loadBundled()
	grammar := func(first, last string) string {
		return "%ambiguity-resolution greedy\n%const $E " + first + "\n%rule text :: Y ∪ ($E ∩ $x.tags) | \"b\" | $x:\"a\"\n%redefine-const $E " + last
	}
	// The tags of the parse's tree, or the load error's position, with the
	// cache entry given.
	outcome := func(g string, entry string) string {
		src := oneStage(g)
		src = map[string]string{"grammars/test/p.md": src["p.md"], "grammars/test/g.md": src["g.md"]}
		if entry != "" {
			src["data/preparsed/test.json"] = `{"format":` + strconv.Itoa(domFormat) + `,"bootstrap":"` + bundled.reader.hash + `","unicode":"` + bundled.uni.hash + `","properties":"` + fnv1a64(bundled.sources["data/unicode/unicode-properties.txt"]) + `","documents":{"grammars/test/g.md":{"hash":"` + fnv1a64(src["grammars/test/g.md"]) + `","dom":` + entry + `}}}`
		}
		d, err := LoadDialectSources(src, "grammars/test/p.md")
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
		dom, err := bundled.reader.read(oneStage(g)["grammars/test/g.md"], "grammars/test/g.md")
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
	t.Parallel()
	loadBundled()
	format := `"format":` + strconv.Itoa(domFormat)
	classifier := func(guard string, line int) string {
		at := strconv.Itoa(line)
		return `{"name":"lex","entries":[{"guards":[` + guard + `],"keys":[{"string":"mi"}],"op":"∈","class":"KOhA","at":[` + at + `,3]}],"at":[` + at + `,1]}`
	}
	rule := func(guard, name string, line int) string {
		return `{"name":"` + name + `","op":"define","flags":[],"alternatives":[{"guards":[` + guard + `],"expr":{"seq":[{"literal":{"string":"a"}},{"literal":{"string":"b"}}]}}],"conditions":[],"at":[` + strconv.Itoa(line) + `,1]}`
	}
	// features is the dialect's features, each as name:kind, when its
	// data/preparsed/test.json holds a DOM of the document with rules and classifiers.
	features := func(rules, classifiers string) []string {
		src := oneStage("%ambiguity-resolution greedy\n%rule text \"a\" \"b\"")
		src = map[string]string{"grammars/test/p.md": src["p.md"], "grammars/test/g.md": src["g.md"]}
		dom := `{` + format + `,"rules":[` + rules + `],"directives":[{"name":"ambiguity-resolution","args":["greedy"],"at":[3,1]}],"constants":[],"classifiers":[` + classifiers + `],"implications":[]}`
		src["data/preparsed/test.json"] = `{` + format + `,"bootstrap":"` + bundled.reader.hash + `","unicode":"` + bundled.uni.hash + `","properties":"` + fnv1a64(bundled.sources["data/unicode/unicode-properties.txt"]) + `","documents":{"grammars/test/g.md":{"hash":"` + fnv1a64(src["grammars/test/g.md"]) + `","dom":` + dom + `}}}`
		d, err := LoadDialectSources(src, "grammars/test/p.md")
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
// reference is an identifier or one eligible emoji (engine §9). A data/preparsed/test.json
// entry that breaks this is a miss, and the document is read instead. A
// bootstrap that breaks it is an error of the grammar. The order of the
// members varies, as the other libraries read JSON in order.
func TestMixedForms(t *testing.T) {
	t.Parallel()
	loadBundled()
	format := `"format":` + strconv.Itoa(domFormat)
	src := oneStage("%ambiguity-resolution greedy\n%rule text $x:\"a\" \"b\"\n%conditions $x.source-text = \"a\"")
	src = map[string]string{"grammars/test/p.md": src["p.md"], "grammars/test/g.md": src["g.md"]}
	const (
		a        = `{"literal":{"string":"a"}}`
		b        = `{"literal":{"string":"b"}}`
		c        = `{"literal":{"string":"c"}}`
		captured = `{"capture":"x","expr":` + a + `}`
		// A condition that wants "z", which the text does not give. So an
		// entry used by mistake refuses the text.
		compared = `"op":"=","left":{"method":"source-text","receiver":{"capture":"x"},"args":[]},"right":{"string":"z"}`
	)
	rule := func(name, expr, condition, emit string, line int) string {
		if emit != "" {
			emit = `,"emit":` + emit
		}
		return `{"name":"` + name + `","op":"define","flags":[],"alternatives":[{"guards":[],"expr":` + expr + `}]` + emit + `,"conditions":[` + condition + `],"at":[` + strconv.Itoa(line) + `,1]}`
	}
	seq := func(first, second string) string { return `{"seq":[` + first + `,` + second + `]}` }
	parse := func(dom string) bool {
		s := map[string]string{}
		for k, v := range src {
			s[k] = v
		}
		if dom != "" {
			s["data/preparsed/test.json"] = `{` + format + `,"bootstrap":"` + bundled.reader.hash + `","unicode":"` + bundled.uni.hash + `","properties":"` + fnv1a64(bundled.sources["data/unicode/unicode-properties.txt"]) + `","documents":{"grammars/test/g.md":{"hash":"` + fnv1a64(s["grammars/test/g.md"]) + `","dom":` + dom + `}}}`
		}
		d, err := LoadDialectSources(s, "grammars/test/p.md")
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
		{"a repetition with an optional", seq(captured, `{"repeat":`+b+`,"optional":`+c+`}`), "", ""},
		{"an optional with a repetition", seq(captured, `{"optional":`+c+`,"repeat":`+b+`}`), "", ""},
		{"a repetition with an optional of a bad reference", seq(captured, `{"repeat":`+b+`,"optional":{"ref":["x"]}}`), "", ""},
		{"a reference that is not a name", seq(captured, `{"ref":"x y"}`), "", ""},
		{"a top-level sequence with a choice", `{"seq":[` + captured + `,` + b + `],"choice":[` + b + `,` + c + `]}`, "", ""},
		{"a captured terminal with invalid scalar contents", seq(`{"capture":"x","expr":{"literal":{"string":"\ud800"}}}`, b), "", ""},
		{"a captured reference with a terminal", seq(`{"capture":"x","expr":{"ref":"A","terminal":"'a'"}}`, b), "", ""},
		{"a captured terminal with a reference", seq(`{"capture":"x","expr":{"terminal":"'a'","ref":"A"}}`, b), "", ""},
		{"a captured reference that is not a name", seq(`{"capture":"x","expr":{"ref":"x y"}}`, b), "", ""},
		{"a capture with a reference", seq(`{"capture":"x","expr":`+a+`,"ref":"B"}`, b), "", ""},
		{"a comparison with a negation", "", `{` + compared + `,"not":{"captured":"x"}}`, ""},
		{"a negation with a comparison", "", `{"not":{"captured":"x"},` + compared + `}`, ""},
		{"a presence test with a comparison", "", `{"captured":"x",` + compared + `}`, ""},
		{"a comparison with a match", "", `{` + compared + `,"matches":{"capture":"x"}}`, ""},
		{"a match with a rule and another member", "", `{"method":"starts-input","receiver":{"capture":"x"},"args":[],"rule":"text"}`, ""},
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
		if !errors.As(err, &e) || e.Kind != ErrorGrammar || e.Document != "data/preparsed/gencmu.json" {
			t.Errorf("%s: expected an error of the bootstrap, got %v", m.name, err)
		}
	}
}

// A guard of an alternative has exactly its feature, its kind and whether
// it is negated, as a guard of a classifier's entry has (docs/output.md).
// A bootstrap with a guard of another member is an error of the grammar.
func TestBootstrapGuardMembers(t *testing.T) {
	t.Parallel()
	rule := func(guard string) string {
		return `{"name":"guarded-rule","op":"define","flags":[],"alternatives":[{"guards":[` + guard + `],"expr":{"ref":"A"}}],"conditions":[],"at":[9999,1]}`
	}
	if err := bootstrapError(t, "rules", rule(`{"feature":"f","kind":"gate","negated":false}`)); err != nil {
		t.Fatalf("a well-formed guard: %v", err)
	}
	assertGrammarError(t, bootstrapError(t, "rules", rule(`{"feature":"f","kind":"gate","negated":false,"extra":true}`)), "a malformed guard")
	assertGrammarError(t, bootstrapError(t, "rules", rule(`{"kind":"gate","negated":false,"feature":"f","note":"x"}`)), "a malformed guard")
}
