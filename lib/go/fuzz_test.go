package gencmu

import (
	"encoding/json"
	"strconv"
	"testing"
)

// FuzzPrecompiledDOM feeds arbitrary JSON as a document's DOM: whatever it
// is, decoding, stitching, lowering and parsing return errors or results and
// never panic. go test runs the seeds; go test -fuzz FuzzPrecompiledDOM
// searches further.
func FuzzPrecompiledDOM(f *testing.F) {
	loadBundled()
	for _, doc := range []string{"notation/lexical.md", "notation/syntax.md"} {
		var c struct {
			Documents map[string]struct {
				Dom json.RawMessage `json:"dom"`
			} `json:"documents"`
		}
		unmarshalJSON([]byte(bundled.sources["compiled.json"]), &c, "dom")
		f.Add(string(c.Documents[doc].Dom), "%rule text A")
	}
	format := `{"format":` + strconv.Itoa(domFormat)
	f.Add(format+`,"rules":[{"name":"text","op":"define","alternatives":[{"guards":[],"expr":{"seq":[]}}],"conditions":[],"at":[1,1]}],"directives":[{"name":"ambiguity-resolution","args":["greedy"],"at":[1,1]}],"constants":[],"classifiers":[],"implications":[]}`, "ab")
	f.Add(format+`,"rules":[{"name":"text","op":"define","tags":{"call":"tags","args":[{"capture":"x"},{"rule":"text"}]},"alternatives":[{"guards":[],"expr":{"capture":"x","expr":{"terminal":"a"}}}],"emit":{"items":[{"capture":"x"},{"insert":"/a/"}]},"conditions":[{"not":{"matches":{"call":"head","args":[{"capture":"x"}]},"rule":"text"}}],"at":[1,1]}],"directives":[{"name":"ambiguity-resolution","args":["lazy","elision-only"],"at":[1,1]}],"constants":[],"classifiers":[],"implications":[]}`, "aa")
	// An elidable optional, a maximal one, and a capture in a plain
	// optional.
	f.Add(format+`,"rules":[{"name":"text","op":"define","alternatives":[{"guards":[],"expr":{"seq":[{"terminal":"a"},{"optional":{"capture":"x","expr":{"terminal":"b"}}},{"optional":{"ref":"KU"},"elidable":true},{"optional":{"seq":[{"ref":"VAU"},{"terminal":"a"}]},"elidable":true,"maximal":true}]}}],"conditions":[{"if":{"captured":"x"},"then":{"op":"=","left":{"call":"phonemes","args":[{"capture":"x"}]},"right":{"string":"b"}}}],"at":[1,1]}],"directives":[{"name":"ambiguity-resolution","args":["late-elision","elision-only","maximal"],"at":[1,1]}],"constants":[],"classifiers":[],"implications":[]}`, "ab")
	// Warnings on a rule with flat braces and on the rule below it, and
	// gates.
	f.Add(format+`,"rules":[{"name":"text","op":"define","alternatives":[{"guards":[{"feature":"w","kind":"warning","negated":false}],"expr":{"seq":[{"ref":"a"},{"repeat":{"terminal":"b"}}]}}],"conditions":[],"at":[1,1]},{"name":"a","op":"define","alternatives":[{"guards":[{"feature":"v","kind":"warning","negated":false},{"feature":"g","kind":"gate","negated":true}],"expr":{"terminal":"a"}},{"guards":[{"feature":"g","kind":"gate","negated":false}],"expr":{"terminal":"a"}}],"conditions":[],"at":[1,1]}],"directives":[{"name":"ambiguity-resolution","args":["greedy"],"at":[1,1]}],"constants":[],"classifiers":[],"implications":[]}`, "abb")
	// A left chain with a separator, and a right chain beside another
	// alternative, an error of lowering.
	f.Add(format+`,"rules":[{"name":"text","op":"define","alternatives":[{"guards":[],"expr":{"repeat":{"ref":"r"},"separator":{"terminal":"s"},"chain":"left"}}],"conditions":[],"at":[1,1]},{"name":"r","op":"define","alternatives":[{"guards":[],"expr":{"repeat":{"terminal":"a"},"chain":"right"}},{"guards":[{"feature":"g","kind":"gate","negated":false}],"expr":{"terminal":"b"}}],"conditions":[],"at":[2,1]}],"directives":[{"name":"ambiguity-resolution","args":["greedy"],"at":[1,1]}],"constants":[],"classifiers":[],"implications":[]}`, "aasa")
	// A constant in a tag term and in a condition.
	f.Add(format+`,"rules":[{"name":"text","op":"define","alternatives":[{"guards":[],"expr":{"capture":"x","expr":{"terminal":"a"}},"tags":{"const":"K","at":[3,1]}}],"conditions":[{"op":"∈","left":{"call":"phonemes","args":[{"capture":"x"}]},"right":{"call":"split","args":[{"string":"a.b"},{"const":"P","at":[3,5]}]}}],"at":[3,1]}],"directives":[{"name":"ambiguity-resolution","args":["greedy"],"at":[1,1]}],"constants":[{"name":"K","op":"define","value":{"tag":"X"},"at":[1,2]},{"name":"P","op":"define","value":{"string":"."},"at":[2,1]}],"classifiers":[],"implications":[]}`, "a")
	f.Fuzz(func(t *testing.T, domJSON, text string) {
		dom, err := decodeDOM(json.RawMessage(domJSON), bundled.uni)
		if err != nil {
			return
		}
		g, gerr := stitch("main", []docDOM{{path: "g.md", dom: dom}}, bundled.uni)
		if gerr != nil {
			return
		}
		features, ferr := dialectFeatures([]*stageGrammar{g}, nil)
		if ferr != nil {
			return
		}
		d := &Dialect{stages: []*stageGrammar{g}, features: features, uni: bundled.uni}
		// With no feature on, and with every one on: every warning, and the
		// gates that are not negated.
		var all []string
		for _, feature := range features {
			all = append(all, feature.Name)
		}
		for _, on := range [][]string{nil, all} {
			for _, elision := range []bool{false, true} {
				if _, err := d.Parse(text, ParseOptions{Features: on, ElisionOnly: &elision}); err != nil {
					if e, ok := err.(*Error); ok && e.Message != "" && len(e.Message) > 15 && e.Message[:15] == "internal error:" {
						t.Fatalf("a panic, recovered: %v", e)
					}
				}
			}
		}
	})
}
