package gencmu

import (
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

// Unresolved source nodes remain separate from the runtime grammar.
type templateObject = map[string]any

func templateObj(v any) templateObject { o, _ := v.(map[string]any); return o }
func templateList(v any) []any         { a, _ := v.([]any); return a }
func templateText(v any) string        { s, _ := v.(string); return s }
func templateAt(n templateObject) [2]int {
	a := templateList(n["at"])
	if len(a) != 2 {
		return [2]int{}
	}
	coordinate := func(v any) (int, bool) {
		switch n := v.(type) {
		case json.Number:
			value, err := strconv.ParseInt(string(n), 10, 64)
			return int(value), err == nil && value >= 1 && value <= maxDOMPosition
		case float64:
			return int(n), n >= 1 && n <= maxDOMPosition && n == float64(int(n))
		}
		return 0, false
	}
	x, xok := coordinate(a[0])
	y, yok := coordinate(a[1])
	if !xok || !yok {
		return [2]int{}
	}
	return [2]int{int(x), int(y)}
}
func templateNodes(root any) []templateObject {
	found := []templateObject{}
	pending := []any{root}
	for len(pending) > 0 {
		n := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		switch n := n.(type) {
		case map[string]any:
			found = append(found, n)
			keys := templateSourceKeys(n)
			for i := len(keys) - 1; i >= 0; i-- {
				if keys[i] != "at" && keys[i] != templateSourceKey {
					pending = append(pending, n[keys[i]])
				}
			}
		case []any:
			for i := len(n) - 1; i >= 0; i-- {
				pending = append(pending, n[i])
			}
		}
	}
	return found
}

func templateSourceKeys(n templateObject) []string {
	var prefix []string
	switch {
	case n["name"] != nil && n["op"] != nil:
		prefix = []string{"instance", "args", "tags", "value", "image", "alternatives", "conditions", "error", "warning", "suppressWarnings", "emit"}
	case n["expr"] != nil && n["test"] == nil:
		prefix = []string{"expr", "tags", "value", "image"}
	case n["capture"] != nil || n["insert"] != nil:
		prefix = []string{"tags", "value", "image"}
	}
	order := append(prefix, "if", "then", "left", "right", "not", "any", "all", "receiver", "args", "expr", "splice", "body", "targets", "requirements", "negated", "tags", "value", "image", "pattern", "child", "children", "repeat", "separator", "optional", "seq", "choice", "ranked", "and", "union", "intersection", "difference", "concat", "items", "before", "after")
	var keys []string
	seen := map[string]bool{}
	for _, key := range order {
		if _, ok := n[key]; ok && !seen[key] {
			keys = append(keys, key)
			seen[key] = true
		}
	}
	for _, key := range templateKeys(n) {
		if !seen[key] {
			keys = append(keys, key)
		}
	}
	return keys
}
func templateKeys(n templateObject) []string {
	keys := make([]string, 0, len(n))
	for k := range n {
		if k != templateSourceKey {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	return keys
}
func templateCopy(n templateObject) templateObject {
	out := templateObject{}
	for k, v := range n {
		out[k] = v
	}
	return out
}

func templateIdentity(root any) any {
	switch n := root.(type) {
	case []any:
		out := make([]any, len(n))
		for i, v := range n {
			out[i] = templateIdentity(v)
		}
		return out
	case map[string]any:
		out := templateObject{}
		for k, v := range n {
			if k != "at" && k != templateSourceKey {
				out[k] = templateIdentity(v)
			}
		}
		return out
	}
	return root
}
func templateKey(root any) string { raw, _ := json.Marshal(templateIdentity(root)); return string(raw) }
func templateArgument(expr templateObject) templateObject {
	if ref := templateText(expr["ref"]); ref != "" {
		key := "rule"
		if isTerminalName(ref) {
			key = "tag"
		}
		return templateObject{key: ref}
	}
	if expr["literal"] != nil {
		return templateObj(expr["literal"])
	}
	for _, key := range []string{"param", "call", "splice", "test", "range", "wildcard"} {
		if expr[key] != nil {
			return expr
		}
	}
	return templateObject{"body": expr}
}
func templateNormalize(root any, patterns ...map[string]bool) any {
	switch n := root.(type) {
	case []any:
		out := make([]any, len(n))
		for i, v := range n {
			out[i] = templateNormalize(v, patterns...)
		}
		return out
	case map[string]any:
		if n["body"] != nil {
			return templateArgument(templateObj(templateNormalize(n["body"], patterns...)))
		}
		out := templateObject{}
		for k, v := range n {
			if k == "args" && n["method"] == "parse" {
				arguments := []any{}
				for _, raw := range templateList(v) {
					argument := templateCopy(templateObj(raw))
					argument["body"] = templateNormalize(argument["body"], patterns...)
					arguments = append(arguments, argument)
				}
				out[k] = arguments
				continue
			}
			out[k] = templateNormalize(v, patterns...)
			if k == "union" || k == "concat" || k == "intersection" && templatePatternTerm(n, patterns...) {
				if items, ok := out[k].([]any); ok {
					flat := []any{}
					for _, item := range items {
						if nested, ok := templateObj(item)[k].([]any); ok {
							flat = append(flat, nested...)
						} else {
							flat = append(flat, item)
						}
					}
					out[k] = flat
				}
			}
		}
		return out
	}
	return root
}
func templateJSON(v any) []byte { w := &jsonWriter{}; writeTemplateJSON(w, v); return w.buf }
func writeTemplateJSON(w *jsonWriter, v any) {
	switch n := v.(type) {
	case map[string]any:
		keys := templateKeys(n)
		order := []string{"name", "params", "args", "op", "tags", "value", "image", "alternatives", "emit", "conditions", "error", "warning", "suppressWarnings", "erased", "at"}
		switch {
		case n["name"] != nil && n["args"] != nil && n["op"] == nil:
			order = []string{"name", "args", "at", "conditions"}
		case n["call"] != nil:
			order = []string{"call", "args", "at"}
		case n["param"] != nil:
			order = []string{"param", "at"}
		case n["gates"] != nil:
			order = []string{"gates", "expr", "tags", "value", "image"}
		case n["method"] != nil:
			order = []string{"method", "receiver", "args"}
		case n["test"] != nil:
			order = []string{"test", "requirements", "value", "expr"}
		case n["left"] != nil:
			order = []string{"op", "left", "right"}
		case n["negated"] != nil:
			order = []string{"negated", "value"}
		case n["const"] != nil:
			order = []string{"const", "at"}
		case n["if"] != nil:
			order = []string{"if", "then", "at"}
		case n["capture"] != nil || n["insert"] != nil:
			order = []string{"capture", "insert", "expr", "tags", "value", "image", "before", "after"}
		}
		written := map[string]bool{}
		w.raw("{")
		first := true
		for _, k := range append(order, keys...) {
			value, ok := n[k]
			if !ok || written[k] {
				continue
			}
			written[k] = true
			w.key(first, k)
			first = false
			writeTemplateJSON(w, value)
		}
		w.raw("}")
	case []any:
		w.raw("[")
		for i, x := range n {
			if i > 0 {
				w.raw(",")
			}
			writeTemplateJSON(w, x)
		}
		w.raw("]")
	case string:
		w.str(n)
	case bool:
		w.bool(n)
	case float64:
		w.int(int(n))
	case int:
		w.int(n)
	case nil:
		w.raw("null")
	default:
		panic(fmt.Sprintf("unknown template value %T", v))
	}
}
func templateFromJSON(raw []byte) (templateObject, error) {
	v, err := decodeJSON(raw)
	if err != nil {
		return nil, err
	}
	out := templateObj(v)
	if out == nil {
		return nil, fmt.Errorf("expected an object")
	}
	for _, n := range templateNodes(out) {
		if _, exists := n[templateSourceKey]; exists {
			return nil, fmt.Errorf("a reserved DOM member")
		}
		for _, v := range n {
			if text, ok := v.(string); ok && !utf8.ValidString(text) {
				return nil, fmt.Errorf("a string is not valid UTF-8")
			}
		}
	}
	return out, nil
}

func templateDocument(rules []any) templateObject {
	return templateObject{"format": float64(domFormat), "rules": rules, "directives": []any{}, "constants": []any{}, "classifiers": []any{}, "implications": []any{}, "checks": []any{}}
}
func templateChildPosition(key, position string) string {
	if key == "body" {
		return "expr"
	}
	if key == "children" || position == "pattern-item" && (key == "choice" || key == "optional" || key == "repeat" || key == "separator") {
		return "pattern-item"
	}
	if position == "pattern" && (key == "union" || key == "intersection" || key == "difference") {
		return "pattern"
	}
	if strings.Contains("|alternatives|conditions|error|warning|emit|tags|value|image|default|requirements|range|literal|concat|union|intersection|difference|left|right|receiver|if|then|not|all|any|args|", "|"+key+"|") {
		return "term"
	}
	if position != "pattern" && strings.Contains("|seq|choice|ranked|and|optional|repeat|separator|expr|splice|body|", "|"+key+"|") {
		return "expr"
	}
	if key == "pattern" || key == "child" {
		return "pattern"
	}
	return position
}

func templatePatternTerm(root any, patterns ...map[string]bool) bool {
	pending := []any{root}
	for len(pending) > 0 {
		n := templateObj(pending[len(pending)-1])
		pending = pending[:len(pending)-1]
		if n["pattern"] != nil || len(patterns) > 0 && patterns[0][templateText(n["const"])] {
			return true
		}
		for _, key := range []string{"union", "intersection", "difference"} {
			pending = append(pending, templateList(n[key])...)
		}
	}
	return false
}
func templatePatternConstants(definitions []templateObject) map[string]bool {
	patterns, users := map[string]bool{}, map[string][]string{}
	for _, definition := range definitions {
		name := templateText(definition["name"])
		pending := []any{definition["value"]}
		for len(pending) > 0 {
			n := templateObj(pending[len(pending)-1])
			pending = pending[:len(pending)-1]
			if n["pattern"] != nil {
				patterns[name] = true
			}
			if n["const"] != nil {
				ref := templateText(n["const"])
				users[ref] = append(users[ref], name)
			}
			for _, key := range []string{"union", "intersection", "difference"} {
				pending = append(pending, templateList(n[key])...)
			}
		}
	}
	queue := []string{}
	for name := range patterns {
		queue = append(queue, name)
	}
	for i := 0; i < len(queue); i++ {
		for _, user := range users[queue[i]] {
			if !patterns[user] {
				patterns[user] = true
				queue = append(queue, user)
			}
		}
	}
	return patterns
}
func (x *templateExpander) normalize(root any) any { return templateNormalize(root, x.patterns) }

func templateOnly(n templateObject, keys ...string) bool {
	if templateLen(n) != len(keys) {
		return false
	}
	for _, k := range keys {
		if _, ok := n[k]; !ok {
			return false
		}
	}
	return true
}
