package gencmu

import (
	"encoding/json"
	"os"
	"strconv"
	"strings"
	"testing"
)

func TestPatternDOM(t *testing.T) {
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
