package gencmu

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

func layeredExpectedValue(n any) any {
	switch n := n.(type) {
	case map[string]any:
		if tags := templateList(n["set"]); tags != nil {
			items := []any{}
			for _, tag := range tags {
				items = append(items, templateObject{"tag": tag})
			}
			if len(items) == 0 {
				return templateObject{"emptySet": true}
			}
			if len(items) == 1 {
				return items[0]
			}
			return templateObject{"union": items}
		}
		result := templateObject{}
		for key, value := range n {
			result[key] = layeredExpectedValue(value)
		}
		return result
	case []any:
		result := make([]any, len(n))
		for i, value := range n {
			result[i] = layeredExpectedValue(value)
		}
		return result
	default:
		return n
	}
}
func TestLayeredValueBinding(t *testing.T) {
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile("../../tests/layered-pattern-values.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Constants map[string]templateObject
		Cases     []struct {
			Description       string
			Pattern, Resolved templateObject
			Error             *struct{ At [2]int }
		}
	}
	if err = json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	g := &stageGrammar{name: "main", uni: bundled.uni, constants: map[string]*stageConst{}}
	for name, node := range fixture.Constants {
		value := &constValue{}
		if pattern := node["pattern"]; pattern != nil {
			value.ty = tyPattern
			value.pattern, err = decodeLayeredPattern(templateJSON(pattern), 0)
		} else if tags := templateList(node["set"]); tags != nil {
			value.ty = tyTags
			for _, tag := range tags {
				value.names = append(value.names, templateText(tag))
			}
		} else {
			value.ty, value.s = tyString, templateText(node["string"])
		}
		if err != nil {
			t.Fatal(err)
		}
		g.constants[name] = &stageConst{value: value, doc: "values.md"}
	}
	for _, c := range fixture.Cases {
		t.Run(c.Description, func(t *testing.T) {
			pattern, err := decodeLayeredPattern(templateJSON(c.Pattern), 0)
			if err != nil {
				t.Fatal(err)
			}
			value, failure := g.resolvePatternValue("values.md", pattern, [2]int{1, 1})
			if c.Error != nil {
				if failure == nil {
					t.Fatal("a malformed binding was accepted")
				}
				if [2]int{failure.Line, failure.Column} != c.Error.At {
					t.Fatal(failure)
				}
				return
			}
			if failure != nil {
				t.Fatal(failure)
			}
			w := &jsonWriter{}
			writeLayeredPattern(w, value)
			actual, err := decodeJSON(w.buf)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(actual, layeredExpectedValue(c.Resolved)) {
				t.Fatalf("got %s, expected %s", w.buf, templateJSON(layeredExpectedValue(c.Resolved)))
			}
		})
	}
}
func TestLayeredTypedDOM(t *testing.T) {
	raw, err := os.ReadFile("../../tests/layered-patterns.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Printing []struct {
			Description string
			Pattern     templateObject
		}
		Shapes []struct {
			Description string
			Pattern     any
			Valid       bool
			Depth       int
		}
	}
	if err = json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	for _, c := range fixture.Printing {
		if templateUnresolved(c.Pattern) {
			continue
		}
		t.Run(c.Description, func(t *testing.T) {
			p, err := decodeLayeredPattern(templateJSON(c.Pattern), 0)
			if err != nil {
				t.Fatal(err)
			}
			w := &jsonWriter{}
			writeLayeredPattern(w, p)
			actual, err := decodeJSON(w.buf)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(actual, c.Pattern) {
				t.Fatalf("got %s, expected %s", w.buf, templateJSON(c.Pattern))
			}
		})
	}
	for _, c := range fixture.Shapes {
		if c.Valid && templateUnresolved(c.Pattern) {
			continue
		}
		t.Run("shape "+c.Description, func(t *testing.T) {
			_, err := decodeLayeredPattern(templateJSON(c.Pattern), c.Depth)
			if (err == nil) != c.Valid {
				t.Fatalf("valid %v: %v", c.Valid, err)
			}
		})
	}
}

func layeredPublicMatchingFixture(value any) any {
	switch n := value.(type) {
	case []any:
		result := make([]any, len(n))
		for i, item := range n {
			result[i] = layeredPublicMatchingFixture(item)
		}
		return result
	case map[string]any:
		result := templateObject{}
		for key, value := range n {
			if key == "requirements" {
				requirements := []any{}
				for _, entry := range templateList(value) {
					entry := templateObj(entry)
					for _, tag := range templateList(templateObj(entry["value"])["set"]) {
						requirements = append(requirements, templateObject{"negated": entry["negated"], "value": templateObject{"tag": tag}})
					}
				}
				result[key] = requirements
			} else {
				result[key] = layeredPublicMatchingFixture(value)
			}
		}
		return result
	default:
		return value
	}
}
func TestLayeredTypedDOMMatching(t *testing.T) {
	raw, err := os.ReadFile("../../tests/layered-patterns.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Matching []struct {
			Description string
			Pattern     templateObject
			Tree        layeredFixtureTree
			Expected    bool
		}
	}
	if err = json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	for _, c := range fixture.Matching {
		t.Run(c.Description, func(t *testing.T) {
			p, err := decodeLayeredPattern(templateJSON(layeredPublicMatchingFixture(c.Pattern)), 0)
			if err != nil {
				t.Fatal(err)
			}
			machine := newPatternMachine([]*domPattern{p})
			if actual := machine.matches(layeredFixtureObserve(machine, newInterner(), c.Tree), p); actual != c.Expected {
				t.Fatalf("got %v, expected %v", actual, c.Expected)
			}
		})
	}
}
