package gencmu

import (
	"encoding/json"
	"os"
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
