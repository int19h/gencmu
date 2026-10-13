package gencmu

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
)

func TestFamilyMethodDOM(t *testing.T) {
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		receiver, args string
		valid          bool
	}{
		{`{"capture":"x"}`, `[{"rule":"family"}]`, true},
		{`{"capture":""}`, `[{"rule":"#"}]`, true},
		{`{"capture":"x"}`, `[]`, false},
		{`{"capture":"x"}`, `[{"rule":"f"},{"rule":"r"}]`, false},
		{`{"capture":"x"}`, `[{"tag":"A"}]`, false},
		{`{"capture":"x"}`, `[{"capture":"x"}]`, false},
		{`{"string":"x"}`, `[{"rule":"f"}]`, false},
		{`{"method":"onward","receiver":{"capture":"x"},"args":[]}`, `[{"rule":"f"}]`, false},
		{`{"method":"without-elision","receiver":{"capture":"x"},"args":[]}`, `[{"rule":"f"}]`, false},
	} {
		t.Run(c.receiver+c.args, func(t *testing.T) {
			call := `{"method":"without-elision-except","receiver":` + c.receiver + `,"args":` + c.args + `}`
			dom := fmt.Sprintf(`{"format":%d,"rules":[{"name":"text","op":"define","flags":[],"alternatives":[{"guards":[],"expr":{"capture":"x","expr":{"ref":"A"}}}],"conditions":[{"method":"matches","receiver":%s,"args":[{"rule":"r"}]}],"at":[1,1]}],"directives":[],"constants":[],"classifiers":[],"implications":[]}`, domFormat, call)
			_, err := decodeDOM(json.RawMessage(dom), bundled.uni)
			if (err == nil) != c.valid {
				t.Fatalf("valid %t: %v", c.valid, err)
			}
		})
	}
}

func TestFamilyReferenceOrder(t *testing.T) {
	for _, clause := range []string{
		`%conditions $x.without-elision-except(first).matches(second)`,
		`:: ($x.without-elision-except(first).matches(second) ⟹ X)`,
		`%emits $ :: ($x.without-elision-except(first).matches(second) ⟹ X)`,
	} {
		_, err := LoadDialectSources(oneStage("%ambiguity-resolution greedy\n%rule text $x:A "+clause), "p.md")
		var e *Error
		if !errors.As(err, &e) || !strings.Contains(e.Message, "first") || strings.Contains(e.Message, "second") || e.Line != 5 || e.Column != 1 {
			t.Fatalf("receiver reference order: %v", err)
		}
	}
}
