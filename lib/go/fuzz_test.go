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
			Documents map[string]struct{ Dom json.RawMessage }
		}
		json.Unmarshal([]byte(bundled.sources["compiled.json"]), &c)
		f.Add(string(c.Documents[doc].Dom), "%rule text A")
	}
	format := `{"format":` + strconv.Itoa(domFormat)
	f.Add(format+`,"rules":[{"name":"text","op":"define","alternatives":[{"guards":[],"expr":{"seq":[]}}],"conditions":[],"at":[1,1]}],"directives":[{"name":"ambiguity-resolution","args":["greedy"],"at":[1,1]}]}`, "ab")
	f.Add(format+`,"rules":[{"name":"text","op":"define","tags":{"call":"tags","args":[{"capture":"x"},{"rule":"text"}]},"alternatives":[{"guards":[],"expr":{"capture":"x","expr":{"terminal":"a"}}}],"emit":{"items":[{"capture":"x"},{"insert":"/a/"}]},"conditions":[{"not":{"matches":{"call":"head","args":[{"capture":"x"}]},"rule":"text"}}],"at":[1,1]}],"directives":[{"name":"ambiguity-resolution","args":["lazy","elision-only"],"at":[1,1]},{"name":"elidable","args":["a"],"at":[1,1]}]}`, "aa")
	// Warnings on a trailing repetition and on the rule below it, and gates.
	f.Add(format+`,"rules":[{"name":"text","op":"define","alternatives":[{"guards":[{"feature":"w","kind":"warning","negated":false}],"expr":{"seq":[{"ref":"a"},{"repeat":{"terminal":"b"},"min":1}]}}],"conditions":[],"at":[1,1]},{"name":"a","op":"define","alternatives":[{"guards":[{"feature":"v","kind":"warning","negated":false},{"feature":"g","kind":"gate","negated":true}],"expr":{"terminal":"a"}},{"guards":[{"feature":"g","kind":"gate","negated":false}],"expr":{"terminal":"a"}}],"conditions":[],"at":[1,1]}],"directives":[{"name":"ambiguity-resolution","args":["greedy"],"at":[1,1]}]}`, "abb")
	f.Fuzz(func(t *testing.T, domJSON, text string) {
		dom, err := decodeDOM(json.RawMessage(domJSON))
		if err != nil {
			return
		}
		g, gerr := stitch("main", []docDOM{{path: "g.md", dom: dom}})
		if gerr != nil {
			return
		}
		features, ferr := dialectFeatures([]*stageGrammar{g}, nil)
		if ferr != nil {
			return
		}
		d := &Dialect{stages: []*stageGrammar{g}, features: features, uni: bundled.uni, lowered: map[lowerKey]*lowered{}}
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
