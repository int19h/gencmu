package gencmu

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

type layeredFixturePattern struct {
	Name, Terminal                  string
	Any, Exact                      bool
	Children                        *[]layeredFixtureItem
	Union, Intersection, Difference []layeredFixturePattern
	Path                            string
	Pattern                         *layeredFixturePattern
	Test                            string
	Expr                            *layeredFixturePattern
	Value                           struct{ String string }
	Requirements                    []struct {
		Negated bool
		Value   struct{ Set []string }
	}
}
type layeredFixtureItem struct {
	Child                       *layeredFixturePattern
	Siblings                    bool
	Optional, Repeat, Separator *[]layeredFixtureItem
	Choice                      [][]layeredFixtureItem
}
type layeredFixtureTree struct {
	Name, Terminal, Value string
	Tags                  []string
	Children              []layeredFixtureTree
	Seal                  bool
}

func layeredFixtureItems(items []layeredFixtureItem) *domPattern {
	seq := &domPattern{Kind: "sequence", Items: []*domPattern{}}
	for _, item := range items {
		n := &domPattern{}
		switch {
		case item.Child != nil:
			n.Kind, n.Items = "node", []*domPattern{layeredFixtureBound(*item.Child)}
		case item.Siblings:
			n.Kind = "siblings"
		case item.Optional != nil:
			n.Kind, n.Items = "optional", []*domPattern{layeredFixtureItems(*item.Optional)}
		case item.Repeat != nil:
			n.Kind, n.Items = "repeat", []*domPattern{layeredFixtureItems(*item.Repeat)}
			if item.Separator != nil {
				n.Items = append(n.Items, layeredFixtureItems(*item.Separator))
			}
		default:
			n.Kind = "choice"
			for _, arm := range item.Choice {
				n.Items = append(n.Items, layeredFixtureItems(arm))
			}
		}
		seq.Items = append(seq.Items, n)
	}
	return seq
}
func layeredFixtureBound(p layeredFixturePattern) *domPattern {
	n := &domPattern{Exact: p.Exact, At: [2]int{1, 1}}
	switch {
	case p.Name != "":
		n.Kind, n.Name = "name", p.Name
	case p.Terminal != "":
		n.Kind, n.Name = "terminal", p.Terminal
	case p.Any:
		n.Kind = "any"
	case p.Test != "":
		n.Kind, n.Op, n.Items = "test", p.Test, []*domPattern{layeredFixtureBound(*p.Expr)}
		if p.Test == "tags" {
			for _, r := range p.Requirements {
				n.Requirements = append(n.Requirements, tagRequirement{Negated: r.Negated, Value: patternLiteral(&constValue{ty: tyTags, names: r.Value.Set})})
			}
		} else {
			n.Value = &domTerm{Kind: tmString, Str: p.Value.String}
		}
	case p.Path != "":
		n.Kind, n.Name, n.Items = "path", p.Path, []*domPattern{layeredFixtureBound(*p.Pattern)}
	default:
		n.Kind = tmUnion
		items := p.Union
		if p.Intersection != nil {
			n.Kind, items = tmIntersection, p.Intersection
		}
		if p.Difference != nil {
			n.Kind, items = tmDifference, p.Difference
		}
		for _, c := range items {
			n.Items = append(n.Items, layeredFixtureBound(c))
		}
	}
	if p.Children != nil {
		n.Attached = layeredFixtureItems(*p.Children).Items
	}
	return n
}
func layeredFixtureObserve(m *patternMachine, in *interner, tree layeredFixtureTree) int {
	if tree.Seal {
		return m.sealed()
	}
	if tree.Terminal != "" {
		return m.node("", m.empty, tree.Terminal, tree.Value, in.make(tree.Tags))
	}
	children := m.empty
	for _, child := range tree.Children {
		children = m.concat(children, layeredFixtureObserve(m, in, child))
	}
	return m.node(tree.Name, children, "", "", nil)
}
func TestLayeredPatternMatching(t *testing.T) {
	t.Parallel()
	data, err := os.ReadFile("../../tests/layered-patterns.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases struct {
		Matching []struct {
			Description string
			Pattern     layeredFixturePattern
			Tree        layeredFixtureTree
			Expected    bool
		}
	}
	if err = json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	for _, c := range cases.Matching {
		t.Run(c.Description, func(t *testing.T) {
			p := layeredFixtureBound(c.Pattern)
			m := newPatternMachine([]*domPattern{p})
			if got := m.matches(layeredFixtureObserve(m, newInterner(), c.Tree), p); got != c.Expected {
				t.Fatalf("match = %v, want %v", got, c.Expected)
			}
		})
	}
}
func TestLayeredPatternRepeatStateGrowth(t *testing.T) {
	t.Parallel()
	p := &domPattern{Kind: "any", Attached: []*domPattern{{Kind: "repeat", Items: []*domPattern{{Kind: "sequence", Items: []*domPattern{{Kind: "node", Items: []*domPattern{{Kind: "terminal", Name: "A"}}}}}}}}}
	m := newPatternMachine([]*domPattern{p})
	a := m.node("", m.empty, "A", "a", newInterner().single("A"))
	prefix := m.empty
	for i := 0; i < 1000; i++ {
		prefix = m.concat(prefix, a)
		if !m.matches(m.node("list", prefix, "", "", nil), p) {
			t.Fatal("repeat rejected its children")
		}
	}
	if len(m.states) >= 10 {
		t.Fatalf("%d structural states", len(m.states))
	}
}

func TestLayeredPatternWalkKeepsChildOrder(t *testing.T) {
	t.Parallel()
	p := &domPattern{Kind: "name", Name: "root", Attached: []*domPattern{
		{Kind: "node", Items: []*domPattern{{Kind: "name", Name: "a"}}},
		{Kind: "node", Items: []*domPattern{{Kind: "name", Name: "b"}}},
	}}
	var names []string
	walkPattern(p, func(n *domPattern) {
		if n.Kind == "name" {
			names = append(names, n.Name)
		}
	})
	if len(names) != 3 || names[0] != "root" || names[1] != "a" || names[2] != "b" {
		t.Fatalf("walk order = %v", names)
	}
}

func layeredFixtureTerm(n templateObject) string {
	for _, key := range []string{"name", "terminal", "tag"} {
		if layeredHas(n, key) {
			return templateText(n[key])
		}
	}
	for _, pair := range [][2]string{{"param", "@"}, {"const", "$"}} {
		if layeredHas(n, pair[0]) {
			return pair[1] + templateText(n[pair[0]])
		}
	}
	if layeredHas(n, "call") {
		var args []string
		for _, arg := range templateList(n["args"]) {
			args = append(args, layeredFixtureTerm(templateObj(arg)))
		}
		return templateText(n["call"]) + "(" + strings.Join(args, ", ") + ")"
	}
	if layeredHas(n, "pattern") {
		return layeredPatternText(templateObj(n["pattern"]), layeredFixtureTerm, true)
	}
	if layeredHas(n, "string") {
		data, _ := json.Marshal(n["string"])
		return string(data)
	}
	if layeredHas(n, "requirements") {
		var args []string
		for _, value := range templateList(n["requirements"]) {
			r := templateObj(value)
			prefix := ""
			if r["negated"] == true {
				prefix = "¬"
			}
			args = append(args, prefix+layeredFixtureTerm(templateObj(r["value"])))
		}
		return "<" + strings.Join(args, " ") + ">"
	}
	panic("unhandled fixture term")
}
func TestLayeredPatternShapesAndPrinting(t *testing.T) {
	t.Parallel()
	data, err := os.ReadFile("../../tests/layered-patterns.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases struct {
		Shapes []struct {
			Description string
			Pattern     any
			Valid       bool
			Problem     string
			Depth       int
		}
		Printing []struct {
			Description string
			Pattern     templateObject
			Text        string
		}
	}
	if err = json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	for _, c := range cases.Shapes {
		t.Run("shape/"+c.Description, func(t *testing.T) {
			problem := layeredPatternProblem(c.Pattern, layeredPatternInspection{depth: c.Depth})
			if c.Problem != "" && problem != c.Problem {
				t.Fatalf("shape problem = %q, want %q", problem, c.Problem)
			}
			if (problem == "") != c.Valid {
				t.Fatalf("shape problem = %q, want valid = %v", problem, c.Valid)
			}
		})
	}
	for _, c := range cases.Printing {
		t.Run("printing/"+c.Description, func(t *testing.T) {
			if got := layeredPatternText(c.Pattern, layeredFixtureTerm, true); got != c.Text {
				t.Fatalf("text = %q, want %q", got, c.Text)
			}
		})
	}
}
func TestLayeredPatternDepthAndWidth(t *testing.T) {
	t.Parallel()
	p := templateObject{"name": "a", "at": templatePosition([2]int{1, 1})}
	for i := 0; i < 256; i++ {
		p = templateObject{"path": "descendant", "pattern": p}
	}
	if problem := layeredPatternProblem(p, layeredPatternInspection{}); problem != "" {
		t.Fatal(problem)
	}
	if problem := layeredPatternProblem(templateObject{"path": "descendant", "pattern": p}, layeredPatternInspection{}); problem != "nested too deeply" {
		t.Fatal(problem)
	}
	if got, want := layeredPatternText(p, layeredFixtureTerm, true), "#("+strings.Repeat("⋮ (", 255)+"⋮ a"+strings.Repeat(")", 256); got != want {
		t.Fatal("deep print differs")
	}
	var children, siblings []any
	for i := 0; i < 1000; i++ {
		children = append(children, templateObject{"child": templateObject{"name": "a", "at": templatePosition([2]int{1, 1})}})
		siblings = append(siblings, templateObject{"siblings": true})
	}
	for _, c := range []struct {
		array []any
		depth int
	}{{children, 254}, {siblings, 255}} {
		n := templateObject{"any": true, "children": c.array}
		if problem := layeredPatternProblem(n, layeredPatternInspection{depth: c.depth}); problem != "" {
			t.Fatal(problem)
		}
		if problem := layeredPatternProblem(n, layeredPatternInspection{depth: c.depth + 1}); problem != "nested too deeply" {
			t.Fatal(problem)
		}
	}
	wide := make([]any, 150000)
	for i := range wide {
		wide[i] = templateObject{"child": templateObject{"param": "X", "at": templatePosition([2]int{1, 1})}}
	}
	n := templateObject{"any": true, "children": []any{templateObject{"repeat": []any{templateObject{"optional": wide}}}}}
	if problem := layeredPatternProblem(n, layeredPatternInspection{}); problem != "" {
		t.Fatal(problem)
	}
}
