package gencmu

import (
	"encoding/json"
	"strings"
	"testing"
)

// One malformed DOM per rule the reader enforces (engine §9, docs/output.md
// "A grammar DOM"): each is refused when decoded, and as a compiled.json
// entry it is a miss, so the document is read instead.
func TestDOMRules(t *testing.T) {
	loadBundled()
	const good = `{"seq":[{"terminal":"a"},{"terminal":"b"}]}`
	rule := func(fields string) string {
		return `{"format":1,"rules":[{"name":"text","op":"define",` + fields + `,"at":[1,1]}],"directives":[{"name":"ambiguity-resolution","args":["greedy"],"at":[1,1]}]}`
	}
	alt := func(expr string) string {
		return rule(`"alternatives":[{"guards":[],"expr":` + expr + `}],"conditions":[]`)
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
	// n optionals around a sequence of two terminals: the terminals are
	// n+1 deep.
	nested := func(n int) string {
		return strings.Repeat(`{"optional":`, n) + good + strings.Repeat(`}`, n)
	}
	cases := []struct{ rule, dom string }{
		{"format 1", strings.Replace(alt(good), `"format":1`, `"format":2`, 1)},
		{"a rule's name is a name", strings.Replace(alt(good), `"name":"text"`, `"name":"9x"`, 1)},
		{"op is define or extend", strings.Replace(alt(good), `"define"`, `"replace"`, 1)},
		{"a rule has alternatives", rule(`"alternatives":[],"conditions":[]`)},
		{"a rule has conditions", rule(`"alternatives":[{"guards":[],"expr":` + good + `}]`)},
		{"a rule has a position", strings.Replace(alt(good), `"at":[1,1]}],"directives"`, `"at":[1]}],"directives"`, 1)},
		{"a guard has a feature and negated", rule(`"alternatives":[{"guards":[{"feature":"f"}],"expr":` + good + `}],"conditions":[]`)},
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
		{"a capture name once per alternative", alt(`{"seq":[{"capture":"x","expr":{"terminal":"a"}},{"capture":"x","expr":{"terminal":"b"}}]}`)},
		{"a flag is true", alt(`{"seq":[{"terminal":"a"},{"hash":false}]}`)},
		{"an expression is known", alt(`{"seq":[{"terminal":"a"},{"what":"b"}]}`)},
		{"a reference names something", alt(`{"seq":[{"terminal":"a"},{"ref":""}]}`)},
		{"nothing alone", emit(`{"nothing":true,"items":[{"capture":"x"}]}`)},
		{"nothing without tags", emit(`{"nothing":true,"tags":{"literal":"X"}}`)},
		{"this only with this (a capture)", emit(`{"items":[{"this":true},{"capture":"x"}]}`)},
		{"this only with this (an inserted tag)", emit(`{"items":[{"this":true},{"insert":"/a/"}]}`)},
		{"a capture listed once", emit(`{"items":[{"capture":"x"},{"capture":"x"}]}`)},
		{"no tags on an inserted tag", emit(`{"items":[{"capture":"x"},{"insert":"y","tags":{"literal":"Z"}}]}`)},
		{"an emission lists items", emit(`{"items":[]}`)},
		{"a function exists", tagged(`{"call":"size","args":[{"capture":"x"}]}`)},
		{"phonemes takes one span", tagged(`{"call":"phonemes","args":[{"capture":"x"},{"capture":"x"}]}`)},
		{"text takes a span", tagged(`{"call":"text","args":[{"literal":"x"}]}`)},
		{"tags takes a span and a rule name", tagged(`{"call":"tags","args":[{"capture":"x"},{"literal":"r"}]}`)},
		{"lowercase takes a string", tagged(`{"call":"lowercase","args":[{"weak":"X"}]}`)},
		{"head is a span, not a value", tagged(`{"call":"head","args":[{"capture":"x"}]}`)},
		{"head takes a span", tagged(`{"call":"tags","args":[{"call":"head","args":[{"literal":"x"}]}]}`)},
		{"matches is never a term", tagged(`{"call":"matches","args":[{"capture":"x"},{"rule":"text"}]}`)},
		{"a union has two parts or more", tagged(`{"union":[{"literal":"X"}]}`)},
		{"an intersection has two parts or more", tagged(`{"intersection":[]}`)},
		{"a term is known", tagged(`{"what":"X"}`)},
		{"a comparison is known", cond(`{"op":"<","left":{"literal":"a"},"right":{"literal":"b"}}`)},
		{"a comparison has two terms", cond(`{"op":"=","left":{"literal":"a"}}`)},
		{"an any has two conditions or more", cond(`{"any":[{"not":{"matches":{"capture":"x"},"rule":"text"}}]}`)},
		{"matches takes a span", cond(`{"matches":{"literal":"x"},"rule":"text"}`)},
		{"matches takes a rule", cond(`{"matches":{"capture":"x"}}`)},
		{"nesting at most 256", alt(nested(256))},
		{"a directive has arguments", strings.Replace(alt(good), `"args":["greedy"],`, ``, 1)},
		{"a directive has a position", strings.Replace(alt(good), `"args":["greedy"],"at":[1,1]`, `"args":["greedy"],"at":[1,1,1]`, 1)},
	}
	// Each variation's well-formed twin decodes, so that the refusals are
	// the rule's and not the test's.
	for _, ok := range []string{alt(good), alt(nested(255)), emit(`{"items":[{"this":true},{"this":true}]}`), emit(`{"items":[{"insert":"y"},{"capture":"x"}]}`),
		tagged(`{"call":"lowercase","args":[{"call":"text","args":[{"call":"head","args":[{"capture":"x"}]}]}]}`),
		cond(`{"any":[{"not":{"matches":{"capture":"x"},"rule":"text"}},{"op":"=","left":{"literal":"a"},"right":{"literal":"a"}}]}`)} {
		if _, err := decodeDOM(json.RawMessage(ok)); err != nil {
			t.Fatalf("a well-formed DOM is refused: %v\n%s", err, ok)
		}
	}
	sources := oneStage("%ambiguity-resolution greedy ;\ntext ≔ \"a\" \"b\" ;")
	for _, c := range cases {
		if _, err := decodeDOM(json.RawMessage(c.dom)); err == nil {
			t.Errorf("%s: a DOM breaking it decodes", c.rule)
			continue
		}
		src := map[string]string{}
		for k, v := range sources {
			src[k] = v
		}
		src["compiled.json"] = `{"format":1,"bootstrap":"` + bundled.reader.hash + `","documents":{"g.md":{"hash":"` + fnv1a64(src["g.md"]) + `","dom":` + c.dom + `}}}`
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
		return "```ebnf\n\ntext ≔ " + strings.Repeat("[", n) + "A" + strings.Repeat("]", n) + " ;\n```\n"
	}
	if _, err := bundled.reader.read(doc(256), "g.md"); err != nil {
		t.Fatalf("256 deep: %v", err)
	}
	_, err := bundled.reader.read(doc(257), "g.md")
	if err == nil || err.Line != 3 || err.Column != 1 {
		t.Fatalf("257 deep: expected an error at the rule, 3:1, got %v", err)
	}
}
