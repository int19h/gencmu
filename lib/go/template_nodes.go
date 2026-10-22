package gencmu

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"unicode/utf8"
)

// Unresolved source nodes remain separate from the runtime grammar.
type templateObject = map[string]any

func templateObj(v any) templateObject { o, _ := v.(map[string]any); return o }
func templateList(v any) []any         { a, _ := v.([]any); return a }
func templateText(v any) string        { s, _ := v.(string); return s }
func templatePosition(at [2]int) []any { return []any{float64(at[0]), float64(at[1])} }
func templateAt(n templateObject) [2]int {
	a := templateList(n["at"])
	if len(a) != 2 {
		return [2]int{}
	}
	x, xok := a[0].(float64)
	y, yok := a[1].(float64)
	if !xok || !yok || x < 1 || y < 1 || x != float64(int(x)) || y != float64(int(y)) {
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
			keys := templateKeys(n)
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
func templateUnresolved(root any) bool {
	for _, n := range templateNodes(root) {
		if n["param"] != nil || n["call"] != nil || n["params"] != nil || n["instance"] != nil || n["args"] != nil && n["name"] != nil && n["op"] != nil {
			return true
		}
	}
	return false
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
	for _, key := range []string{"param", "call", "test", "range", "wildcard"} {
		if expr[key] != nil {
			return expr
		}
	}
	return templateObject{"body": expr}
}
func templateNormalize(root any) any {
	switch n := root.(type) {
	case []any:
		out := make([]any, len(n))
		for i, v := range n {
			out[i] = templateNormalize(v)
		}
		return out
	case map[string]any:
		if n["body"] != nil {
			return templateArgument(templateObj(templateNormalize(n["body"])))
		}
		out := templateObject{}
		for k, v := range n {
			out[k] = templateNormalize(v)
			if k == "union" || k == "concat" || k == "any" || k == "all" {
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
		order := []string{"name", "params", "args", "op", "flags", "tags", "value", "image", "alternatives", "emit", "conditions", "erased", "at"}
		switch {
		case n["call"] != nil:
			order = []string{"call", "args", "at"}
		case n["param"] != nil:
			order = []string{"param", "at"}
		case n["guards"] != nil:
			order = []string{"guards", "expr", "tags", "value", "image"}
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

func templateWritten(value interface{ writeJSON(*jsonWriter) }) templateObject {
	w := &jsonWriter{}
	value.writeJSON(w)
	out, err := templateFromJSON(w.buf)
	if err != nil {
		panic(err)
	}
	return out
}
func templateDocument(rules []any) templateObject {
	return templateObject{"format": float64(domFormat), "rules": rules, "directives": []any{}, "constants": []any{}, "classifiers": []any{}, "implications": []any{}}
}
func templateChildPosition(key, position string) string {
	if position == "pattern" && (key == "union" || key == "intersection" || key == "difference") {
		return "pattern"
	}
	if strings.Contains("|alternatives|conditions|emit|tags|value|image|requirements|range|literal|concat|union|intersection|difference|left|right|receiver|if|then|not|all|any|args|", "|"+key+"|") {
		return "term"
	}
	if position != "pattern" && strings.Contains("|seq|choice|ranked|and|optional|repeat|separator|expr|", "|"+key+"|") {
		return "expr"
	}
	if key == "pattern" || key == "children" || key == "node" {
		return "pattern"
	}
	return position
}

func templateJoined(key string, items []any) templateObject {
	if key != "union" && key != "concat" && key != "any" && key != "all" {
		return templateObject{key: items}
	}
	flat := []any{}
	for _, v := range items {
		if nested := templateList(templateObj(v)[key]); nested != nil {
			flat = append(flat, nested...)
		} else {
			flat = append(flat, v)
		}
	}
	return templateObject{key: flat}
}
