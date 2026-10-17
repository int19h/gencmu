package gencmu

import (
	"encoding/json"
	"os"
	"slices"
	"strconv"
	"strings"
	"testing"
)

// A shared source DOM must resolve independently in each stage, including
// when a matching cache supplies that DOM (engine §§2, 8, and 10).
func TestPatternResolutionCachedStages(t *testing.T) {
	t.Parallel()
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		name, body, pattern, before, after string
	}{
		{"compound", "A", `(($P ∪ @(B)) ∩ @(A) ∖ ∅)`, `@(A)`, `@(C)`},
		{"contextual empty", "A", `($P ∪ ∅)`, `@(A)`, `@(B)`},
		{"signed constants", "A", `($P ∩ @(A<$GOOD ¬$BAD>))`, `@(A)`, `@(B)`},
		{"literal identity", `"a"`, `$P`, `@("a")`, `@("b")`},
		{"range identity", `"a".."z"`, `$P`, `@("a".."z")`, `@("a".."m")`},
		{"wildcard identity", `_`, `$P`, `@(_)`, `@(A)`},
	} {
		for _, comparator := range []string{"≅", "≇"} {
			t.Run(c.name+comparator, func(t *testing.T) {
				t.Parallel()
				condition := "$ " + comparator + " " + c.pattern
				sources := map[string]string{
					"p.md": block("%stage before", "%ambiguity-resolution greedy", `%include "before.md"`, `%include "shared.md"`,
						"%stage after", "%ambiguity-resolution greedy", `%include "after.md"`, `%include "shared.md"`),
					"before.md":               block("%const $P "+c.before, "%const $GOOD Extra", "%const $BAD Blocked"),
					"after.md":                block("%const $P "+c.after, "%const $GOOD Extra", "%const $BAD Blocked"),
					"shared.md":               block("%rule text "+c.body+" :: ("+condition+" ⟹ X)", "%emits $ :: (A Extra) ∪ ("+condition+" ⟹ X)"),
					"notation/bootstrap.json": bundled.sources["notation/bootstrap.json"],
				}
				fresh := mustLoad(t, sources)
				sources["compiled.json"] = reviewCache(t, sources)
				cached := mustLoad(t, sources)
				var canonical string
				for _, dialect := range []*Dialect{fresh, cached} {
					// Repeated parses also retain the stage's original binding.
					for repeat := 0; repeat < 2; repeat++ {
						result, err := dialect.ParseTokens("a", []InputToken{{Text: "a", Tags: []string{"A", "Extra"}, Span: [2]int{0, 1}, Source: [2]int{0, 1}}}, ParseOptions{NoAutoFeatures: true})
						if err != nil || !result.OK || len(result.Stages) != 2 || result.Tree == nil {
							t.Fatalf("stage parse: %v %+v", err, result)
						}
						for i, stage := range result.Stages {
							want := []string{"A", "Extra"}
							matched := i == 0
							if comparator == "≇" {
								matched = !matched
							}
							if matched {
								want = append(want, "X")
							}
							if len(stage.Output) != 1 || !slices.Equal(stage.Output[0].Tags, want) {
								t.Fatalf("stage %d tags: %+v, want %v", i, stage.Output, want)
							}
						}
						wantTags := []string{}
						if comparator == "≇" {
							wantTags = append(wantTags, "X")
						}
						if !slices.Equal(result.Tree.Tags, wantTags) {
							t.Fatalf("alternative tags: %v, want %v", result.Tree.Tags, wantTags)
						}
						raw, err := MarshalResult(result)
						if err != nil {
							t.Fatal(err)
						}
						got := string(raw)
						if canonical != "" && got != canonical {
							t.Fatalf("fresh/cache result differs:\n%s\n%s", canonical, got)
						}
						canonical = got
					}
				}
			})
		}
	}
}

func TestPatternDOM(t *testing.T) {
	t.Parallel()
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile("../../tests/pattern-dom.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Description string
		Pattern     json.RawMessage
		Expr        json.RawMessage
		Condition   json.RawMessage
		Malformed   bool
	}
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	for _, c := range cases {
		t.Run(c.Description, func(t *testing.T) {

			constants, rules := "[]", "[]"
			if len(c.Pattern) > 0 {
				constants = `[{"name":"P","op":"define","at":[1,1],"value":{"pattern":` + string(c.Pattern) + `}}]`
			}
			if len(c.Expr) > 0 {
				rules = `[{"name":"text","op":"define","at":[1,1],"flags":[],"alternatives":[{"guards":[],"expr":` + string(c.Expr) + `}],"conditions":[]}]`
			} else if len(c.Condition) > 0 {
				rules = `[{"name":"text","op":"define","at":[1,1],"flags":[],"alternatives":[{"guards":[],"expr":{"capture":"x","expr":{"ref":"A"}}}],"conditions":[` + string(c.Condition) + `]}]`
			}
			dom := `{"format":` + strconv.Itoa(domFormat) + `,"rules":` + rules + `,"directives":[],"constants":` + constants + `,"classifiers":[],"implications":[]}`
			_, err := decodeDOM(json.RawMessage(dom), bundled.uni)
			if (err != nil) != c.Malformed {
				t.Fatalf("malformed %t, got %v", c.Malformed, err)
			}
		})
	}
}
func TestPatternDepth(t *testing.T) {
	t.Parallel()
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	for _, n := range []int{250, 3000} {
		document := "```jbogenbau\n%const $P @(" + strings.Repeat("⋮(", n) + "A" + strings.Repeat(")", n) + ")\n```"
		_, err := bundled.reader.read(document, "case.md")
		if (err != nil) != (n > 256) {
			t.Fatalf("depth %d: %v", n, err)
		}
	}
}
func TestPatternStateGrowth(t *testing.T) {
	t.Parallel()
	p := &domPattern{Kind: "children", Items: []*domPattern{{Kind: "repeat", Items: []*domPattern{patternChildren(&domPattern{Kind: "terminal", Name: "A"})}}}}
	m := newPatternMachine([]*domPattern{p})
	leaf := m.node("", m.empty, "A", "a", newInterner().single("A"))
	prefix := m.empty
	for i := 0; i < 1000; i++ {
		prefix = m.concat(prefix, leaf)
	}
	root := m.node("text", prefix, "", "", nil)
	if !m.matches(root, p) || len(m.states) > 10 {
		t.Fatalf("match %t, states %d", m.matches(root, p), len(m.states))
	}
}

func TestPatternMachineBeyondWordSize(t *testing.T) {
	t.Parallel()
	var roots []*domPattern
	for i := 0; i < 150; i++ {
		roots = append(roots, &domPattern{Kind: "terminal", Name: "A" + strconv.Itoa(i)})
	}
	var children []*domPattern
	for i := 0; i < 100; i++ {
		children = append(children, patternChildren(&domPattern{Kind: "terminal", Name: "A149"}))
	}
	sequence := &domPattern{Kind: "children", Items: []*domPattern{{Kind: "sequence", Items: children}}}
	roots = append(roots, sequence)
	m := newPatternMachine(roots)
	leaf := m.node("", m.empty, "A149", "a", newInterner().single("A149"))
	if !m.matches(leaf, roots[149]) {
		t.Fatal("predicate past bit 64 was lost")
	}
	prefix := m.empty
	for i := 0; i < 100; i++ {
		prefix = m.concat(prefix, leaf)
	}
	root := m.node("text", prefix, "", "", nil)
	if !m.matches(root, sequence) {
		t.Fatal("automaton past state 64 was lost")
	}
}
