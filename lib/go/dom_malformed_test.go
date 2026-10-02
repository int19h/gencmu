package gencmu

import (
	"encoding/json"
	"os"
	"strconv"
	"testing"
)

// The shared cases of tests/dom-malformed.json: each directive alone in an
// otherwise empty DOM of the current format, checked as a precompiled DOM
// is (engine §9).
func TestDOMMalformed(t *testing.T) {
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile("../../tests/dom-malformed.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Description string
		Directive   json.RawMessage
		Malformed   bool
	}
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	if len(cases) == 0 {
		t.Fatal("no cases")
	}
	for _, c := range cases {
		dom := `{"format":` + strconv.Itoa(domFormat) + `,"rules":[],"directives":[` + string(c.Directive) + `],"constants":[],"classifiers":[],"implications":[]}`
		_, err := decodeDOM(json.RawMessage(dom), bundled.uni)
		if (err != nil) != c.Malformed {
			t.Errorf("%s\n%s: refused %v", c.Description, c.Directive, err)
		}
	}
}
