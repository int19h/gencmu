package gencmu

import (
	"fmt"
	"strings"
)

func templateQuoted(s string, uni *unicodeTable) string { return stringTerminal(s, uni) }
func templateTermGroup(n templateObject, parent string, index int) bool {
	if n["if"] != nil {
		return true
	}
	key := ""
	for _, k := range []string{"concat", "union", "intersection", "difference"} {
		if n[k] != nil {
			key = k
			break
		}
	}
	if key == "" {
		return false
	}
	if key == "union" {
		tags, strs := true, true
		for _, x := range templateList(n[key]) {
			tags = tags && templateObj(x)["tag"] != nil
			strs = strs && templateObj(x)["string"] != nil
		}
		if tags || strs {
			return parent == "intersection" || parent == "difference"
		}
	}
	priority := map[string]int{"union": 1, "difference": 1, "intersection": 2, "concat": 3, "method": 4}
	return priority[key] < priority[parent] || priority[key] == priority[parent] && (parent == "intersection" || index > 0 && (parent == "union" || parent == "difference"))
}
func templateBooleanGroup(n templateObject, parent string) bool {
	key := ""
	for _, k := range []string{"if", "any", "all", "not"} {
		if n[k] != nil {
			key = k
			break
		}
	}
	if key == "" {
		return false
	}
	priority := map[string]int{"if": 1, "any": 2, "all": 3, "not": 4}
	return priority[key] < priority[parent] || priority[key] == priority[parent] && parent != "not"
}
func templateCanonical(n templateObject, uni *unicodeTable) string {
	p := func(v any) string { return templateCanonical(templateObj(v), uni) }
	join := func(v any, sep string) string {
		parts := []string{}
		for _, x := range templateList(v) {
			parts = append(parts, p(x))
		}
		return strings.Join(parts, sep)
	}
	if n["call"] != nil {
		return templateText(n["call"]) + "(" + join(n["args"], ", ") + ")"
	}
	if n["param"] != nil {
		return "@" + templateText(n["param"])
	}
	for _, k := range []string{"rule", "tag", "terminal", "ref", "name", "integer", "classifier"} {
		if n[k] != nil {
			return templateText(n[k])
		}
	}
	for _, k := range []string{"const", "constant"} {
		if n[k] != nil {
			return "$" + templateText(n[k])
		}
	}
	if n["string"] != nil {
		return templateQuoted(templateText(n["string"]), uni)
	}
	if n["literal"] != nil {
		return p(n["literal"])
	}
	if n["range"] != nil {
		return join(n["range"], "..")
	}
	for _, pair := range [][2]string{{"wildcard", "_"}, {"empty", "ε"}, {"emptySet", "∅"}} {
		if n[pair[0]] != nil {
			return pair[1]
		}
	}
	if n["requirements"] != nil && n["test"] == nil {
		xs := []string{}
		for _, v := range templateList(n["requirements"]) {
			r := templateObj(v)
			text := p(r["value"])
			if r["negated"] == true {
				text = "¬" + text
			}
			xs = append(xs, text)
		}
		return "<" + strings.Join(xs, " ") + ">"
	}
	if n["targets"] != nil {
		return join(n["targets"], " | ")
	}
	if n["body"] != nil {
		x := templateObj(n["body"])
		text := templateBodyText(x, uni, "")
		if x["empty"] != nil || x["optional"] != nil || x["repeat"] != nil {
			return text
		}
		return "(" + text + ")"
	}
	if n["test"] != nil {
		test := ""
		if n["test"] == "tags" {
			test = p(templateObject{"requirements": n["requirements"]})
		} else {
			test = templateText(n["test"]) + p(n["value"])
		}
		return p(n["expr"]) + test
	}
	if n["pattern"] != nil {
		return layeredPatternText(templateObj(n["pattern"]), func(n templateObject) string { return templateCanonical(n, uni) }, true)
	}
	for _, pair := range [][2]string{{"concat", " ++ "}, {"union", " ∪ "}, {"intersection", " ∩ "}, {"difference", " ∖ "}} {
		if n[pair[0]] != nil {
			xs := templateList(n[pair[0]])
			sep := pair[1]
			if pair[0] == "union" {
				tags, strs := true, true
				for _, x := range xs {
					tags = tags && templateObj(x)["tag"] != nil
					strs = strs && templateObj(x)["string"] != nil
				}
				if tags || strs {
					sep = " "
				}
			}
			parts := []string{}
			for i, x := range xs {
				text := p(x)
				if templateTermGroup(templateObj(x), pair[0], i) {
					text = "(" + text + ")"
				}
				parts = append(parts, text)
			}
			return strings.Join(parts, sep)
		}
	}
	if n["method"] != nil {
		name := templateText(n["method"])
		sep := ", "
		if name == "matches" || name == "begins" || name == "ends" || name == "followed-by" || name == "preceded-by" {
			sep = " | "
		}
		args := ""
		if len(templateList(n["args"])) > 0 {
			args = "(" + join(n["args"], sep) + ")"
		}
		receiver := templateObj(n["receiver"])
		text := p(receiver)
		if templateTermGroup(receiver, "method", 0) {
			text = "(" + text + ")"
		}
		return text + "." + name + args
	}
	if n["capture"] != nil {
		return "$" + templateText(n["capture"])
	}
	if n["captured"] != nil {
		return "$" + templateText(n["captured"])
	}
	if n["if"] != nil {
		condition := p(n["if"])
		if templateBooleanGroup(templateObj(n["if"]), "if") {
			condition = "(" + condition + ")"
		}
		return condition + " ⟹ " + p(n["then"])
	}
	if n["op"] != nil {
		parts := []string{}
		for _, x := range []any{n["left"], n["right"]} {
			text := p(x)
			if templateObj(x)["if"] != nil {
				text = "(" + text + ")"
			}
			parts = append(parts, text)
		}
		return strings.Join(parts, " "+templateText(n["op"])+" ")
	}
	if n["not"] != nil {
		text := p(n["not"])
		if templateBooleanGroup(templateObj(n["not"]), "not") {
			text = "(" + text + ")"
		}
		return "¬" + text
	}
	for _, pair := range [][2]string{{"any", " ∨ "}, {"all", " ∧ "}} {
		if n[pair[0]] != nil {
			parts := []string{}
			for _, x := range templateList(n[pair[0]]) {
				text := p(x)
				if templateBooleanGroup(templateObj(x), pair[0]) {
					text = "(" + text + ")"
				}
				parts = append(parts, text)
			}
			return strings.Join(parts, pair[1])
		}
	}
	panic(fmt.Sprintf("unprintable argument %v", n))
}
func templateBodyText(n templateObject, uni *unicodeTable, parent string) string {
	priority := map[string]int{"seq": 3, "and": 2, "choice": 1, "ranked": 1}
	for _, pair := range [][2]string{{"seq", " "}, {"and", " & "}, {"choice", " | "}, {"ranked", " ≻ "}} {
		if n[pair[0]] != nil {
			xs := []string{}
			for _, v := range templateList(n[pair[0]]) {
				xs = append(xs, templateBodyText(templateObj(v), uni, pair[0]))
			}
			text := strings.Join(xs, pair[1])
			if parent != "" && priority[pair[0]] <= priority[parent] {
				return "(" + text + ")"
			}
			return text
		}
	}
	if n["optional"] != nil {
		marker := ""
		if n["elidable"] == true {
			marker = "+"
		}
		return "[" + marker + templateBodyText(templateObj(n["optional"]), uni, "") + "]"
	}
	if n["repeat"] != nil {
		before, after, sep := "", "", ""
		if n["chain"] == "left" {
			before = "... "
		}
		if n["chain"] == "right" {
			after = " ..."
		}
		if n["separator"] != nil {
			sep = " / " + templateBodyText(templateObj(n["separator"]), uni, "")
		}
		return "{" + before + templateBodyText(templateObj(n["repeat"]), uni, "") + after + sep + "}"
	}
	return templateCanonical(n, uni)
}

func templatePatternText(n templateObject, uni *unicodeTable) string {
	return layeredPatternText(n, func(n templateObject) string { return templateCanonical(n, uni) }, false)
}
