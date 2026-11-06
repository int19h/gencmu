package gencmu

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func deferredQueryDocument(condition string) string {
	return "```jbogenbau\n%ambiguity-resolution greedy\n%rule text A\n%conditions " + condition + "\n```\n"
}

func TestDeferredBodyQueriesRoundTrip(t *testing.T) {
	// Engine §9: parse arguments keep their body wrapper through normalization.
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	for _, target := range []string{"A", "A …", "… A", `A="x"`, `"a".."z"`, "_", "A | B", "A ≻ B", "[A]", "{A}", "ε"} {
		t.Run(target, func(t *testing.T) {
			dom, err := bundled.reader.read(deferredQueryDocument("$.parse("+target+").error-free"), "g.md")
			if err != nil {
				t.Fatal(err)
			}
			if problem := checkDOM(dom, bundled.uni); problem != nil {
				t.Fatal(problem)
			}
			raw := dom.json()
			supplied, decodeErr := decodeDOM(raw, bundled.uni)
			if decodeErr != nil {
				t.Fatal(decodeErr)
			}
			if problem := checkDOM(supplied, bundled.uni); problem != nil {
				t.Fatal(problem)
			}
			if string(supplied.json()) != string(raw) {
				t.Fatal("DOM round trip changed", string(supplied.json()))
			}
			condition := dom.Rules[0].Conditions[0]
			wire, decodeErr := decodeJSON(func() []byte { var w jsonWriter; condition.writeJSON(&w); return w.buf }())
			if decodeErr != nil {
				t.Fatal(decodeErr)
			}
			if normalized := templateNormalize(wire); !reflect.DeepEqual(wire, normalized) {
				t.Fatal("normalization changed query", normalized)
			}
			printed := templateCanonical(templateObj(wire), bundled.uni)
			fresh, err := bundled.reader.read(deferredQueryDocument(printed), "g.md")
			if err != nil {
				t.Fatal(printed, err)
			}
			if string(fresh.json()) != string(raw) {
				t.Fatal("printed query changed DOM", printed)
			}
		})
	}
}

func TestDeferredNestedCaptureErrorsUseTheirBinder(t *testing.T) {
	// Engine §9: a recursive walk locates the binder inside a parse body.
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	for _, target := range []string{"(A | $x:A)", "{A / $x:A}", "[$x:A]"} {
		text := deferredQueryDocument("$.parse(" + target + ")")
		_, err := bundled.reader.read(text, "g.md")
		column := strings.Index(strings.Split(text, "\n")[3], "$x") + 1
		if err == nil || err.Line != 4 || err.Column != column || !strings.Contains(err.Message, "cannot declare captures") {
			t.Fatalf("%s: %v", target, err)
		}
	}
}

func TestDeferredPreparsedBodiesRejectCapturesAndNestedRemainders(t *testing.T) {
	// Engine §9: the supplied DOM permits a remainder at one outer edge only.
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	dom, err := bundled.reader.read(deferredQueryDocument("$.parse(A …).error-free"), "g.md")
	if err != nil {
		t.Fatal(err)
	}
	for _, body := range []string{`{"remainder":true}`, `{"seq":[{"remainder":true},{"ref":"A"},{"remainder":true}]}`,
		`{"seq":[{"ref":"A"},{"optional":{"remainder":true}}]}`, `{"capture":"x","expr":{"ref":"A"}}`,
		`{"seq":[{"ref":"A"},{"remainder":true}],"extra":true}`} {
		var wire map[string]any
		if err := json.Unmarshal(dom.json(), &wire); err != nil {
			t.Fatal(err)
		}
		var replacement any
		if err := json.Unmarshal([]byte(body), &replacement); err != nil {
			t.Fatal(err)
		}
		condition := wire["rules"].([]any)[0].(map[string]any)["conditions"].([]any)[0].(map[string]any)
		condition["receiver"].(map[string]any)["args"].([]any)[0].(map[string]any)["body"] = replacement
		raw, _ := json.Marshal(wire)
		if supplied, err := decodeDOM(raw, bundled.uni); err == nil && checkDOM(supplied, bundled.uni) == nil {
			t.Fatal("accepted malformed body", body)
		}
	}
}
