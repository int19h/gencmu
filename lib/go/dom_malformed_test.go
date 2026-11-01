package gencmu

import (
	"encoding/json"
	"os"
	"strconv"
	"strings"
	"testing"
)

// The shared cases of tests/dom-malformed.json: each directive alone in an
// otherwise empty DOM of the current format, checked as a preparsed DOM
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

func TestRankedSyntaxCodeShape(t *testing.T) {
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		expr  string
		coded bool
	}{
		{`{"ranked":null}`, true}, {`{"ranked":[]}`, true}, {`{"ranked":[{"ref":"A"}]}`, true},
		{`{"ranked":[{"ref":"A"},{"ref":"B"}],"extra":1}`, false},
		{`{"extra":1,"ranked":[{"ref":"A"},{"ref":"B"}]}`, false},
		{`{"ranked":[null,{"ref":"B"}]}`, false},
	} {
		raw := `{"format":40,"rules":[{"name":"text","op":"define","flags":[],"alternatives":[{"guards":[],"expr":` + c.expr + `}],"conditions":[],"at":[1,1]}],"directives":[],"constants":[],"classifiers":[],"implications":[]}`
		_, err := decodeDOM(json.RawMessage(raw), bundled.uni)
		if err == nil {
			t.Fatal("malformed ranked DOM accepted")
		}
		if strings.Contains(err.Error(), "ranked-choice-syntax:") != c.coded {
			t.Fatalf("%s: %v", c.expr, err)
		}
	}
}

func TestArgumentCaptureMessage(t *testing.T) {
	t.Parallel()
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	raw := `{"format":40,"rules":[{"name":"text","op":"define","flags":[],"alternatives":[{"guards":[],"expr":{"call":"pair","args":[{"body":{"capture":"x","expr":{"ref":"A"}}}],"at":[2,12]}}],"conditions":[],"at":[2,1]}],"directives":[],"constants":[],"classifiers":[],"implications":[]}`
	_, err := decodeDOM(json.RawMessage(raw), bundled.uni)
	if err == nil || !strings.Contains(err.Error(), "an argument cannot read or declare captures") {
		t.Fatalf("capture in a call argument: %v", err)
	}
}

func TestInputBoundaryMethodMessage(t *testing.T) {
	t.Parallel()
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	for _, method := range []string{"starts-input", "ends-input"} {
		raw := `{"format":40,"rules":[{"name":"text","op":"define","flags":[],"alternatives":[{"guards":[],"expr":{"ref":"A"}}],"conditions":[{"method":"` + method + `","receiver":{"string":"a"},"args":[]}],"at":[2,1]}],"directives":[],"constants":[],"classifiers":[],"implications":[]}`
		_, err := decodeDOM(json.RawMessage(raw), bundled.uni)
		if err == nil || !strings.Contains(err.Error(), "a malformed "+method+"()") {
			t.Fatalf("%s receiver: %v", method, err)
		}
	}
}

func TestSpanTagHintUsesSourceSpelling(t *testing.T) {
	t.Parallel()
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	raw := `{"format":40,"rules":[{"name":"text","op":"define","flags":[],"alternatives":[{"guards":[],"expr":{"capture":"x","expr":{"ref":"A"}}}],"tags":{"union":[{"capture":"x"},{"tag":"B"}]},"conditions":[],"at":[2,1]}],"directives":[],"constants":[],"classifiers":[],"implications":[]}`
	_, err := decodeDOM(json.RawMessage(raw), bundled.uni)
	if err == nil || !strings.Contains(err.Error(), "$x.tags") || strings.Contains(err.Error(), "tags($x)") {
		t.Fatalf("tag-set hint: %v", err)
	}
}
