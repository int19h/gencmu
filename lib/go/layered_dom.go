package gencmu

import (
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"
)

// Decode a layered pattern only after its complete shape and depth pass.
func decodeLayeredPattern(raw json.RawMessage, depth int) (*domPattern, error) {
	value, err := decodeJSON(raw)
	if err != nil {
		return nil, err
	}
	root := templateObj(value)
	problem := layeredPatternProblem(root, layeredPatternInspection{depth: depth, name: func(name string) bool {
		r, size := utf8.DecodeRuneInString(name)
		// The public schema checks eligibility against the configured core.
		return layeredRuleName(name) || strings.Contains(name, "(") && strings.HasSuffix(name, ")") ||
			utf8.ValidString(name) && size > 0 && size == len(name) && r != '#' && r != '@' && r != '_' && !(r >= 'A' && r <= 'Z') && !(r >= '0' && r <= '9')
	}})
	if problem != "" {
		if problem == "nested too deeply" {
			return nil, errTooDeep
		}
		return nil, fmt.Errorf("%s", problem)
	}
	type task struct {
		value  templateObject
		target *domPattern
		item   bool
		depth  int
	}
	result := &domPattern{}
	pending := []task{{root, result, false, depth}}
	list := func(values []any) []*domPattern {
		items := make([]*domPattern, len(values))
		for i := range items {
			items[i] = &domPattern{}
		}
		return items
	}
	scheduleItems := func(values []any, targets []*domPattern, depth int) {
		for i := len(values) - 1; i >= 0; i-- {
			pending = append(pending, task{templateObj(values[i]), targets[i], true, depth})
		}
	}
	for len(pending) > 0 {
		current := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		n, p, d := current.value, current.target, current.depth
		if current.item {
			if child := templateObj(n["child"]); child != nil {
				p.Kind = "node"
				p.Items = []*domPattern{{}}
				pending = append(pending, task{child, p.Items[0], false, d + 1})
			} else if n["siblings"] == true {
				p.Kind = "siblings"
			} else if arms := templateList(n["choice"]); arms != nil {
				p.Kind = "choice"
				p.Items = make([]*domPattern, len(arms))
				for i, arm := range arms {
					values := templateList(arm)
					p.Items[i] = &domPattern{Kind: "sequence", Items: list(values)}
					scheduleItems(values, p.Items[i].Items, d+1)
				}
			} else {
				key := "optional"
				if n["repeat"] != nil {
					key = "repeat"
				}
				p.Kind = key
				for _, field := range []string{key, "separator"} {
					if values := templateList(n[field]); values != nil {
						body := &domPattern{Kind: "sequence", Items: list(values)}
						p.Items = append(p.Items, body)
						scheduleItems(values, body.Items, d+1)
					}
				}
			}
			continue
		}
		p.Exact = n["exact"] == true
		if values := templateList(n["children"]); values != nil {
			p.Attached = list(values)
			scheduleItems(values, p.Attached, d+1)
		}
		switch {
		case n["name"] != nil:
			p.Kind, p.Name, p.At = "name", templateText(n["name"]), templateAt(n)
		case n["terminal"] != nil:
			p.Kind, p.Name, p.At = "terminal", templateText(n["terminal"]), templateAt(n)
		case n["constant"] != nil:
			p.Kind, p.Name, p.At = "constant", templateText(n["constant"]), templateAt(n)
		case n["literal"] != nil:
			p.Kind, p.At = "literal", templateAt(n)
			p.Value, err = decodeTermAt(templateJSON(n["literal"]), d)
		case n["range"] != nil:
			p.Kind, p.At = "range", templateAt(n)
			p.Ends, err = decodeStringRange(templateJSON(n["range"]), d)
		case n["wildcard"] != nil:
			p.Kind, p.At = "wildcard", templateAt(n)
		case n["any"] != nil:
			p.Kind = "any"
		case n["test"] != nil:
			p.Kind, p.Op = "test", templateText(n["test"])
			if p.Op == "tags" {
				p.Requirements, err = decodeRequirements(templateJSON(n["requirements"]), d+1)
			} else {
				p.Value, err = decodeTermAt(templateJSON(n["value"]), d+1)
			}
			p.Items = []*domPattern{{}}
			pending = append(pending, task{templateObj(n["expr"]), p.Items[0], false, d + 1})
		case n["path"] != nil:
			p.Kind, p.Name = "path", templateText(n["path"])
			p.Items = []*domPattern{{}}
			pending = append(pending, task{templateObj(n["pattern"]), p.Items[0], false, d + 1})
		case layeredPatternSet(n) != "":
			p.Kind = layeredPatternSet(n)
			values := templateList(n[p.Kind])
			p.Items = list(values)
			for i := len(values) - 1; i >= 0; i-- {
				pending = append(pending, task{templateObj(values[i]), p.Items[i], false, d + 1})
			}
		default:
			return nil, fmt.Errorf("a pattern still contains an unresolved reference")
		}
		if err != nil {
			return nil, err
		}
	}
	return result, nil
}

// Write private child containers as public arrays, without recursive calls.
func writeLayeredPattern(w *jsonWriter, root *domPattern) {
	type task struct {
		pattern *domPattern
		kind    string
		raw     string
	}
	pending := []task{{root, "pattern", ""}}
	appendItems := func(items []*domPattern) {
		pending = append(pending, task{kind: "raw", raw: "]"})
		for i := len(items) - 1; i >= 0; i-- {
			pending = append(pending, task{pattern: items[i], kind: "item"})
			if i > 0 {
				pending = append(pending, task{kind: "raw", raw: ","})
			}
		}
	}
	for len(pending) > 0 {
		current := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		p := current.pattern
		switch current.kind {
		case "raw":
			w.raw(current.raw)
			continue
		case "items":
			items := []*domPattern{}
			stack := []*domPattern{p}
			for len(stack) > 0 {
				item := stack[len(stack)-1]
				stack = stack[:len(stack)-1]
				if item.Kind == "sequence" {
					for i := len(item.Items) - 1; i >= 0; i-- {
						stack = append(stack, item.Items[i])
					}
				} else {
					items = append(items, item)
				}
			}
			w.raw("[")
			appendItems(items)
			continue
		case "item":
			pending = append(pending, task{kind: "raw", raw: "}"})
			switch p.Kind {
			case "node":
				w.raw(`{"child":`)
				pending = append(pending, task{p.Items[0], "pattern", ""})
			case "siblings":
				w.raw(`{"siblings":true`)
			case "choice":
				w.raw(`{"choice":[`)
				pending = append(pending, task{kind: "raw", raw: "]"})
				for i := len(p.Items) - 1; i >= 0; i-- {
					pending = append(pending, task{p.Items[i], "items", ""})
					if i > 0 {
						pending = append(pending, task{kind: "raw", raw: ","})
					}
				}
			case "optional", "repeat":
				w.raw(`{"` + p.Kind + `":`)
				if len(p.Items) == 2 {
					pending = append(pending, task{p.Items[1], "items", ""}, task{kind: "raw", raw: `,"separator":`})
				}
				pending = append(pending, task{p.Items[0], "items", ""})
			default:
				panic("a child array is not an item")
			}
			continue
		}
		if p.Kind == "children" {
			clone := *p
			clone.Kind = "any"
			clone.Attached = []*domPattern{p.Items[0]}
			clone.Items = nil
			p = &clone
		}
		w.raw(`{"` + p.Kind + `":`)
		at := false
		switch p.Kind {
		case "name", "terminal", "constant":
			w.str(p.Name)
			at = true
		case "any", "wildcard":
			w.raw("true")
			at = p.Kind == "wildcard"
		case "literal":
			p.Value.writeJSON(w)
			at = true
		case "range":
			w.raw("[")
			p.Ends[0].writeJSON(w)
			w.raw(",")
			p.Ends[1].writeJSON(w)
			w.raw("]")
			at = true
		case "test":
			w.str(p.Op)
			if p.Op == "tags" {
				w.raw(`,"requirements":`)
				writeRequirements(w, p.Requirements)
			} else {
				w.raw(`,"value":`)
				p.Value.writeJSON(w)
			}
			w.raw(`,"expr":`)
		case "path":
			w.str(p.Name)
			w.raw(`,"pattern":`)
		case tmUnion, tmIntersection, tmDifference:
			w.raw("[")
		default:
			panic("a resolved pattern constructor is required")
		}
		suffix := "}"
		if at {
			tail := &jsonWriter{}
			tail.raw(`,"at":`)
			tail.pair(p.At)
			tail.raw("}")
			suffix = string(tail.buf)
		}
		pending = append(pending, task{kind: "raw", raw: suffix})
		if p.Attached != nil {
			pending = append(pending, task{&domPattern{Kind: "sequence", Items: p.Attached}, "items", ""}, task{kind: "raw", raw: `,"children":`})
		}
		if p.Exact {
			pending = append(pending, task{kind: "raw", raw: `,"exact":true`})
		}
		switch p.Kind {
		case "test", "path":
			pending = append(pending, task{p.Items[0], "pattern", ""})
		case tmUnion, tmIntersection, tmDifference:
			pending = append(pending, task{kind: "raw", raw: "]"})
			for i := len(p.Items) - 1; i >= 0; i-- {
				pending = append(pending, task{p.Items[i], "pattern", ""})
				if i > 0 {
					pending = append(pending, task{kind: "raw", raw: ","})
				}
			}
		}
	}
}
