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
	t.Parallel()
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile("../../tests/dom-malformed.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Description string          `json:"description"`
		Directive   json.RawMessage `json:"directive"`
		Rule        json.RawMessage `json:"rule"`
		Malformed   bool            `json:"malformed"`
		Unicode     *string         `json:"unicode"`
	}
	// Each directive is kept as written, so that a malformed one reaches
	// the check as it stands.
	if err := unmarshalJSON(data, &cases); err != nil {
		t.Fatal(err)
	}
	if len(cases) == 0 {
		t.Fatal("no cases")
	}
	for _, c := range cases {
		rules, directives := "[]", "["+string(c.Directive)+"]"
		if len(c.Rule) != 0 {
			rules, directives = "["+string(c.Rule)+"]", "[]"
		}
		dom := `{"format":` + strconv.Itoa(domFormat) + `,"rules":` + rules + `,"directives":` + directives + `,"constants":[],"classifiers":[],"implications":[]}`
		table := bundled.uni
		if c.Unicode != nil {
			table, err = parseUnicodeTable(*c.Unicode)
			if err != nil {
				t.Fatalf("%s: %v", c.Description, err)
			}
		}
		_, err := decodeDOM(json.RawMessage(dom), table)
		if (err != nil) != c.Malformed {
			t.Errorf("%s\n%s: refused %v", c.Description, c.Directive, err)
		}
	}
}
