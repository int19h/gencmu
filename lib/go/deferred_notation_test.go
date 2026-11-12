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
	// Engine §9: the supplied DOM permits a remainder at each outer edge,
	// and no remainder inside.
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	dom, err := bundled.reader.read(deferredQueryDocument("$.parse(A …).error-free"), "g.md")
	if err != nil {
		t.Fatal(err)
	}
	replace := func(body string) []byte {
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
		return raw
	}
	if supplied, err := decodeDOM(replace(`{"seq":[{"remainder":true},{"ref":"A"},{"remainder":true}]}`), bundled.uni); err != nil || checkDOM(supplied, bundled.uni) != nil {
		t.Fatal("rejected a remainder at both edges")
	}
	for _, body := range []string{`{"remainder":true}`,
		`{"seq":[{"ref":"A"},{"optional":{"remainder":true}}]}`, `{"capture":"x","expr":{"ref":"A"}}`,
		`{"seq":[{"ref":"A"},{"remainder":true}],"extra":true}`} {
		if supplied, err := decodeDOM(replace(body), bundled.uni); err == nil && checkDOM(supplied, bundled.uni) == nil {
			t.Fatal("accepted malformed body", body)
		}
	}
}

func TestDeferredQueriesShareStructuralTargetsAndRetainTests(t *testing.T) {
	// Engine §3.10 and §4.3: target identity ignores groups and outer remainders.
	pipeline := mustLoad(t, oneStage(`%ambiguity-resolution greedy
%const $K "x"
%rule text A
%conditions $.parse(A), $.parse((A)), $.parse(A …), $.parse(… A), $.parse(A="x"), $.parse(A=$K), $.parse(A≠"x"), $.parse(_), $.parse(target), $.parse(A ≻ B)
%rule target A`))
	g := pipeline.stages[0]
	var targets []string
	for _, condition := range g.byName["text"].alts[0].conds {
		targets = append(targets, g.queryTargets[condition.Left.Items[1].Body])
	}
	for _, i := range []int{1, 2, 3} {
		if targets[i] != targets[0] {
			t.Fatal("different equivalent targets", targets)
		}
	}
	if targets[4] != targets[5] || targets[4] == targets[0] || targets[4] == targets[6] {
		t.Fatal("lost structural tests", targets)
	}
	if targets[0] != "\x00query:A" || targets[8] != "target" {
		t.Fatal("old and new queries use different names", targets)
	}
	lowered := pipeline.lower(0, map[string]bool{})
	if lowered.fault != "" {
		t.Fatal(lowered.fault)
	}
	for _, target := range targets {
		if _, found := lowered.byName[target]; !found {
			t.Fatal("target missing", target)
		}
	}
	for _, target := range []string{targets[4], targets[6], targets[7]} {
		for _, production := range lowered.rules[lowered.byName[target]].prods {
			// Engine §3.10: an anonymous target takes the tags of its one symbol.
			if !production.helper || production.tags != nil && production.tags.Kind == tmEmptySet {
				t.Fatal("anonymous target forces empty tags on its root", target)
			}
		}
	}
}

func TestDeferredQueryBodiesKeepStageSpliceRestrictions(t *testing.T) {
	// Engine §3.7: a parse body does not hide its splices from loading checks.
	_, err := LoadPipelineSources(oneStage("%ambiguity-resolution fewest #·target, greedy\n%rule text A\n%conditions $.parse(*target)\n%rule target A"), "p.md")
	if err == nil || !strings.Contains(err.Error(), "a splice of target conflicts") {
		t.Fatalf("query splice escaped inspection: %v", err)
	}
}
