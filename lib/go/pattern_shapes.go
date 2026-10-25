package gencmu

import (
	"strings"
	"unicode/utf8"
)

// Pattern constructors and child items occupy separate positions in layered DOMs.
type layeredPatternInspection struct {
	deferDepth     bool
	name, terminal func(string) bool
	test           func(templateObject) string
	depth          int
}

func layeredOnly(n templateObject, keys ...string) bool {
	if n == nil || len(n) != len(keys) {
		return false
	}
	for _, key := range keys {
		if !layeredHas(n, key) {
			return false
		}
	}
	return true
}
func layeredHas(n templateObject, key string) bool { _, ok := n[key]; return ok }
func layeredRuleName(s string) bool {
	r, size := utf8.DecodeRuneInString(s)
	return classifierName.MatchString(s) || utf8.ValidString(s) && r > 127 && size == len(s)
}
func layeredTerminalName(s string) bool { return constName.MatchString(s) || strings.HasPrefix(s, "_") }
func layeredStringTerm(v any) bool {
	n := templateObj(v)
	if layeredOnly(n, "string") {
		s, ok := n["string"].(string)
		return ok && utf8.ValidString(s)
	}
	for _, key := range []string{"const", "param"} {
		if layeredOnly(n, key, "at") && templateAt(n) != [2]int{} {
			s, ok := n[key].(string)
			return ok && (key == "const" && constName.MatchString(s) || key == "param" && nameSyntax.MatchString(s))
		}
	}
	return false
}
func layeredTerminalAtom(v any) bool {
	n := templateObj(v)
	if n == nil || layeredHas(n, "exact") || layeredHas(n, "children") {
		return false
	}
	for _, key := range []string{"terminal", "literal", "range", "wildcard", "constant", "param"} {
		if layeredHas(n, key) {
			return true
		}
	}
	return false
}
func layeredPatternSet(n templateObject) string {
	for _, key := range []string{"union", "intersection", "difference"} {
		if layeredHas(n, key) {
			return key
		}
	}
	return ""
}
func layeredItemParts(n templateObject) []any {
	if layeredHas(n, "child") {
		return []any{n["child"]}
	}
	var parts []any
	if layeredHas(n, "choice") {
		for _, arm := range templateList(n["choice"]) {
			parts = append(parts, templateList(arm)...)
		}
		return parts
	}
	key := "repeat"
	if layeredHas(n, "optional") {
		key = "optional"
	}
	parts = append(parts, templateList(n[key])...)
	return append(parts, templateList(n["separator"])...)
}
func layeredPatternProblem(root any, inspect layeredPatternInspection) string {
	type task struct {
		node                  any
		item, repeated, inner bool
		depth                 int
	}
	name := inspect.name
	if name == nil {
		name = layeredRuleName
	}
	terminal := inspect.terminal
	if terminal == nil {
		terminal = layeredTerminalName
	}
	requirementTerm := func(v any) bool {
		n := templateObj(v)
		if layeredStringTerm(v) && !layeredHas(n, "string") {
			return true
		}
		s, ok := n["tag"].(string)
		return layeredOnly(n, "tag") && ok && terminal(s)
	}
	pending := []task{{node: root, depth: inspect.depth}}
	var repeats [][]any
	for len(pending) > 0 {
		t := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		if !inspect.deferDepth && t.depth > 256 {
			return "nested too deeply"
		}
		n := templateObj(t.node)
		if n == nil {
			return "a malformed pattern"
		}
		push := func(v any, item, repeated, inner bool) {
			pending = append(pending, task{v, item, repeated, inner, t.depth + 1})
		}
		items := func(v any, repeated, empty bool) bool {
			a, ok := v.([]any)
			if !ok || !empty && len(a) == 0 {
				return false
			}
			for _, child := range a {
				push(child, true, repeated, false)
			}
			return true
		}
		if t.item {
			switch {
			case layeredOnly(n, "child"):
				push(n["child"], false, false, false)
			case layeredOnly(n, "siblings"):
				if n["siblings"] != true {
					return "a malformed sibling ellipsis"
				}
				if t.repeated {
					return "a sibling ellipsis cannot be a repeat item or separator"
				}
			case layeredOnly(n, "optional"):
				if !items(n["optional"], t.repeated, false) {
					return "a malformed pattern optional"
				}
			case layeredOnly(n, "repeat") || layeredOnly(n, "repeat", "separator"):
				if !items(n["repeat"], true, false) || layeredHas(n, "separator") && !items(n["separator"], true, false) {
					return "a malformed pattern repeat"
				}
				repeats = append(repeats, templateList(n["repeat"]))
			case layeredOnly(n, "choice"):
				arms, ok := n["choice"].([]any)
				if !ok || len(arms) < 2 {
					return "a malformed pattern choice"
				}
				for _, arm := range arms {
					if !items(arm, t.repeated, false) {
						return "a malformed pattern choice"
					}
					a := templateList(arm)
					if len(a) == 1 && layeredHas(templateObj(a[0]), "choice") {
						return "a malformed pattern choice"
					}
				}
			default:
				return "a malformed pattern child item"
			}
			continue
		}
		if key := layeredPatternSet(n); key != "" {
			a, ok := n[key].([]any)
			if !layeredOnly(n, key) || !ok || len(a) < 2 || key == "difference" && len(a) != 2 {
				return "a malformed pattern"
			}
			for _, child := range a {
				if key != "difference" && layeredHas(templateObj(child), key) {
					return "a nested pattern set must be flat"
				}
				push(child, false, false, false)
			}
			continue
		}
		if layeredHas(n, "path") {
			if !layeredOnly(n, "path", "pattern") || n["path"] != "descendant" && n["path"] != "first" && n["path"] != "last" {
				return "a malformed pattern path"
			}
			push(n["pattern"], false, false, false)
			continue
		}
		key, count := "", 0
		for _, k := range []string{"name", "call", "param", "terminal", "literal", "range", "wildcard", "constant", "test", "any"} {
			if layeredHas(n, k) {
				key, count = k, count+1
			}
		}
		if count != 1 {
			return "a malformed pattern node test"
		}
		fields := []string{key}
		if layeredHas(n, "exact") {
			if n["exact"] != true || t.inner {
				return "a malformed exact pattern prefix"
			}
			fields = append(fields, "exact")
		}
		if layeredHas(n, "children") {
			if t.inner || key != "name" && key != "call" && key != "param" && key != "any" {
				return "a child list requires a rule test"
			}
			fields = append(fields, "children")
		}
		switch key {
		case "test":
			if n["test"] == "tags" {
				fields = append(fields, "requirements", "expr")
				a, ok := n["requirements"].([]any)
				if !layeredTerminalAtom(n["expr"]) || !ok {
					return "a pattern tag test requires a terminal atom"
				}
				for _, value := range a {
					r := templateObj(value)
					_, boolean := r["negated"].(bool)
					if !layeredOnly(r, "value", "negated") || !boolean || !requirementTerm(r["value"]) {
						return "a malformed pattern requirement"
					}
				}
			} else {
				fields = append(fields, "value", "expr")
				expr := templateObj(n["expr"])
				if n["test"] != "=" && n["test"] != "≠" || !(layeredTerminalAtom(expr) || expr["test"] == "tags" && !layeredHas(expr, "exact") && !layeredHas(expr, "children") && layeredTerminalAtom(expr["expr"])) {
					return "a pattern value test requires a terminal atom"
				}
				if !layeredStringTerm(n["value"]) {
					return "a malformed pattern value test"
				}
			}
			if inspect.test != nil {
				if problem := inspect.test(n); problem != "" {
					return problem
				}
			}
			push(n["expr"], false, false, true)
		case "any":
			if n["any"] != true || !layeredHas(n, "children") {
				return "a malformed bare child list"
			}
		default:
			fields = append(fields, "at")
			if templateAt(n) == [2]int{} {
				return "a malformed pattern position"
			}
			s, stringValue := n[key].(string)
			switch key {
			case "call":
				fields = append(fields, "args")
				a, ok := n["args"].([]any)
				if !stringValue || !name(s) || !ok || len(a) == 0 {
					return "a malformed pattern call"
				}
				for _, arg := range a {
					if templateObj(arg) == nil {
						return "a malformed pattern call"
					}
				}
			case "name":
				if !stringValue || !name(s) {
					return "a malformed pattern rule name"
				}
			case "param", "constant":
				if !stringValue || key == "param" && !nameSyntax.MatchString(s) || key == "constant" && !constName.MatchString(s) {
					return "a malformed pattern reference"
				}
			case "terminal":
				if !stringValue || !terminal(s) {
					return "a malformed pattern terminal"
				}
			case "wildcard":
				if n[key] != true {
					return "a malformed pattern wildcard"
				}
			case "literal":
				if !layeredStringTerm(n[key]) || !layeredHas(templateObj(n[key]), "string") {
					return "a malformed pattern literal"
				}
			case "range":
				a, ok := n[key].([]any)
				if !ok || len(a) != 2 || !layeredStringTerm(a[0]) || !layeredStringTerm(a[1]) {
					return "a malformed pattern range"
				}
			}
		}
		if !layeredOnly(n, fields...) {
			return "a malformed pattern node test"
		}
		if layeredHas(n, "children") && !items(n["children"], false, true) {
			return "a malformed pattern child list"
		}
	}
	for _, repeat := range repeats {
		pendingItems := append([]any{}, repeat...)
		consumes := false
		for len(pendingItems) > 0 && !consumes {
			n := templateObj(pendingItems[len(pendingItems)-1])
			pendingItems = pendingItems[:len(pendingItems)-1]
			if layeredHas(n, "child") {
				consumes = true
			} else {
				pendingItems = append(pendingItems, layeredItemParts(n)...)
			}
		}
		if !consumes {
			return "a pattern repeat cannot match only empty sequences"
		}
	}
	return ""
}

// The printer uses an explicit stack so that depth does not use the call stack.
func layeredPatternText(root templateObject, term func(templateObject) string, literal bool) string {
	type task struct {
		kind  string
		value any
	}
	atom := func(n templateObject) bool { return layeredPatternSet(n) == "" && !layeredHas(n, "path") }
	var out strings.Builder
	pending := []task{{"pattern", root}}
	if literal {
		out.WriteString("#")
		if !atom(root) {
			out.WriteString("(")
			pending = append([]task{{"text", ")"}}, pending...)
		}
	}
	for len(pending) > 0 {
		t := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		var tasks []task
		n := templateObj(t.value)
		switch t.kind {
		case "text":
			out.WriteString(t.value.(string))
		case "term":
			out.WriteString(term(n))
		case "items":
			a := templateList(t.value)
			for i, v := range a {
				x := templateObj(v)
				if i > 0 {
					tasks = append(tasks, task{"text", " "})
				}
				group := len(a) > 1 && (layeredHas(x, "choice") || layeredHas(x, "child") && layeredPatternSet(templateObj(x["child"])) != "")
				if group {
					tasks = append(tasks, task{"text", "("})
				}
				tasks = append(tasks, task{"item", x})
				if group {
					tasks = append(tasks, task{"text", ")"})
				}
			}
		case "item":
			switch {
			case layeredHas(n, "child"):
				tasks = append(tasks, task{"pattern", n["child"]})
			case layeredHas(n, "siblings"):
				out.WriteString("⋯")
			case layeredHas(n, "optional"):
				tasks = append(tasks, task{"text", "["}, task{"items", n["optional"]}, task{"text", "]"})
			case layeredHas(n, "repeat"):
				tasks = append(tasks, task{"text", "{"}, task{"items", n["repeat"]})
				if layeredHas(n, "separator") {
					tasks = append(tasks, task{"text", " / "}, task{"items", n["separator"]})
				}
				tasks = append(tasks, task{"text", "}"})
			default:
				for i, arm := range templateList(n["choice"]) {
					if i > 0 {
						tasks = append(tasks, task{"text", " | "})
					}
					tasks = append(tasks, task{"items", arm})
				}
			}
		default:
			switch {
			case layeredHas(n, "path"):
				if n["path"] != "first" {
					prefix := "⋮ "
					if n["path"] == "last" {
						prefix = "⋱ "
					}
					tasks = append(tasks, task{"text", prefix})
				}
				group := !atom(templateObj(n["pattern"]))
				if group {
					tasks = append(tasks, task{"text", "("})
				}
				tasks = append(tasks, task{"pattern", n["pattern"]})
				if group {
					tasks = append(tasks, task{"text", ")"})
				}
				if n["path"] == "first" {
					tasks = append(tasks, task{"text", " ⋰"})
				}
			case layeredPatternSet(n) != "":
				key := layeredPatternSet(n)
				for i, child := range templateList(n[key]) {
					x := templateObj(child)
					if i > 0 {
						tasks = append(tasks, task{"text", map[string]string{"union": " ∪ ", "intersection": " ∩ ", "difference": " ∖ "}[key]})
					}
					group := key == "intersection" && (layeredHas(x, "union") || layeredHas(x, "difference")) || key == "difference" && i == 1 && (layeredHas(x, "union") || layeredHas(x, "difference")) || key == "union" && i > 0 && layeredHas(x, "difference")
					if group {
						tasks = append(tasks, task{"text", "("})
					}
					tasks = append(tasks, task{"pattern", x})
					if group {
						tasks = append(tasks, task{"text", ")"})
					}
				}
			default:
				if n["exact"] == true {
					tasks = append(tasks, task{"text", "·"})
				}
				switch {
				case layeredHas(n, "test"):
					tasks = append(tasks, task{"pattern", n["expr"]})
					if n["test"] == "tags" {
						tasks = append(tasks, task{"term", templateObject{"requirements": n["requirements"]}})
					} else {
						tasks = append(tasks, task{"text", n["test"]}, task{"term", n["value"]})
					}
				case layeredHas(n, "literal"):
					tasks = append(tasks, task{"term", n["literal"]})
				case layeredHas(n, "range"):
					a := templateList(n["range"])
					tasks = append(tasks, task{"term", a[0]}, task{"text", ".."}, task{"term", a[1]})
				case layeredHas(n, "wildcard"):
					tasks = append(tasks, task{"text", "_"})
				case layeredHas(n, "constant"):
					tasks = append(tasks, task{"text", "$" + templateText(n["constant"])})
				case !layeredHas(n, "any"):
					tasks = append(tasks, task{"term", n})
				}
				if layeredHas(n, "children") {
					if len(templateList(n["children"])) == 0 {
						tasks = append(tasks, task{"text", "«»"})
					} else {
						tasks = append(tasks, task{"text", "« "}, task{"items", n["children"]}, task{"text", " »"})
					}
				}
			}
		}
		for i := len(tasks) - 1; i >= 0; i-- {
			pending = append(pending, tasks[i])
		}
	}
	return out.String()
}
