package gencmu

import (
	"encoding/json"
	"reflect"
	"strconv"
	"strings"
	"testing"
)

func TestRankedValidationRejectsIncompleteLowering(t *testing.T) {
	fault := &Error{Kind: ErrorGrammar, Message: "incomplete lowering", Document: "source.md", Line: 7}
	got := (&rankedGroups{}).validateTags(&lowered{fault: fault.Message, faultLocation: fault})
	if got != fault {
		t.Fatalf("got %v, want the original lowering fault %v", got, fault)
	}
}
func TestRankedLinearForest(t *testing.T) {
	d := mustLoad(t, oneStage("%ambiguity-resolution late-elision\n%rule text {unit}\n%rule unit a ≻ b\n%rule a X Y\n%rule b X Y"))
	for _, n := range []int{1, 2, 4, 8, 16} {
		tokens := make([]Token, n*2)
		for i := range tokens {
			tag, text := "X", "x"
			if i%2 != 0 {
				tag, text = "Y", "y"
			}
			tokens[i] = Token{Text: text, Tags: []string{tag}, Span: [2]int{i, i + 1}, Source: [2]int{i, i + 1}}
		}
		var stats []slotStatistics
		res, err := d.ParseTokens(strings.Repeat("xy", n), tokens, ParseOptions{NoAutoFeatures: true, private: &privateOptions{slotAdmission: func(s slotStatistics) { stats = append(stats, s) }}})
		if err != nil || res.Stages[0].Verdict != VerdictUnique || len(stats) == 0 || stats[0].groups != n || stats[0].candidateEdges != 2*n || stats[0].retainedEdges != n {
			t.Fatalf("%d: %v %+v", n, err, stats)
		}
	}
}
func TestRankedDOMCacheDiagnostics(t *testing.T) {
	sources := oneStage("%const $K ~k\n%ambiguity-resolution late-elision\n%rule text Q (($x(a) ≻ b) ≻ c) Z\n%tags $x ⟹ (tags($x) ∪ $K)\n%rule a X Y\n%rule b U V\n%rule c R S")
	_, plain := LoadDialectSources(sources, "p.md")
	dom, e := bundled.reader.read(sources["g.md"], "g.md")
	if e != nil {
		t.Fatal(e)
	}
	sources["compiled.json"] = `{"format":` + strconv.Itoa(domFormat) + `,"bootstrap":"` + bundled.reader.hash + `","documents":{"g.md":{"hash":"` + fnv1a64(sources["g.md"]) + `","dom":` + string(dom.json()) + `}}}`
	_, cached := LoadDialectSources(sources, "p.md")
	if plain == nil || !reflect.DeepEqual(plain, cached) {
		t.Fatalf("%+v\n%+v", plain, cached)
	}
	error := plain.(*Error)
	if error.Code != "ranked-choice-export" || error.Group.Path != "/seq/1/ranked/0" || *error.Group.At != [2]int{6, 22} || *error.Option != 0 {
		t.Fatalf("%+v", error)
	}
	raw, err := json.Marshal(error)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(string(raw), `{"kind":"grammar","code":"ranked-choice-export","message":`) {
		t.Fatal(string(raw))
	}
	if !strings.Contains(string(error.Expression), `"const":"K"`) {
		t.Fatal(string(raw))
	}
}
func TestRankedShortestTagWitness(t *testing.T) {
	_, err := LoadDialectSources(oneStage("%ambiguity-resolution late-elision\n%rule text a ≻ b\n%rule a u | v\n%rule u deeper\n%rule deeper X\n%rule v Y\n%rule b Z\n%tags ∅"), "p.md")
	if err == nil {
		t.Fatal("grammar loaded")
	}
	e := err.(*Error)
	names := []string{}
	for _, site := range e.Inheritance {
		names = append(names, site.Rule)
	}
	if e.Code != "ranked-choice-tags" || !reflect.DeepEqual(names, []string{"text", "a", "v"}) {
		t.Fatalf("%+v", e)
	}
}
func TestRankedSyntaxAndRetirement(t *testing.T) {
	for _, body := range []string{"a | b ≻ c", "a ≻ b | c", "| a ≻ b", "a ≻", "≻ a"} {
		_, e := bundled.reader.read("```jbogenbau\n%rule text "+body+"\n```\n", "g.md")
		if e == nil || e.Code != "ranked-choice-syntax" {
			t.Fatalf("%s: %v", body, e)
		}
	}
	_, e := bundled.reader.read("```jbogenbau\n%prefer a > b\n```\n", "g.md")
	if e == nil || e.Code != "" || e.Line != 2 || e.Column != 1 || !strings.Contains(e.Message, "unknown directive %prefer; use an inline ranked choice") {
		t.Fatal(e)
	}
}
