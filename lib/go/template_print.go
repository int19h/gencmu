package gencmu

import (
	"fmt"
	"strings"
	"unicode/utf16"
)

func templateQuoted(s string, uni *unicodeTable) string {
	var b strings.Builder
	b.WriteByte('"')
	for _, c := range s {
		switch c {
		case '"', '\\':
			b.WriteByte('\\')
			b.WriteRune(c)
		case '\b':
			b.WriteString(`\b`)
		case '\t':
			b.WriteString(`\t`)
		case '\n':
			b.WriteString(`\n`)
		case '\f':
			b.WriteString(`\f`)
		case '\r':
			b.WriteString(`\r`)
		default:
			if strings.HasPrefix(stringTerminal(string(c), uni), "$_") {
				for _, x := range utf16.Encode([]rune{c}) {
					fmt.Fprintf(&b, `\u%04x`, x)
				}
			} else {
				b.WriteRune(c)
			}
		}
	}
	b.WriteByte('"')
	return b.String()
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
	for _, k := range []string{"rule", "tag", "terminal", "ref", "name"} {
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
		return "#(" + templatePatternText(templateObj(n["pattern"]), uni) + ")"
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
			for _, x := range xs {
				text := p(x)
				o := templateObj(x)
				if o["concat"] != nil || o["union"] != nil || o["intersection"] != nil || o["difference"] != nil {
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
		if receiver["concat"] != nil || receiver["union"] != nil || receiver["intersection"] != nil || receiver["difference"] != nil {
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
		return "(" + p(n["if"]) + " ⟹ " + p(n["then"]) + ")"
	}
	if n["op"] != nil {
		return p(n["left"]) + " " + templateText(n["op"]) + " " + p(n["right"])
	}
	if n["not"] != nil {
		return "¬" + p(n["not"])
	}
	if n["any"] != nil {
		return "(" + join(n["any"], " ∨ ") + ")"
	}
	if n["all"] != nil {
		return "(" + join(n["all"], " ∧ ") + ")"
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

// Pattern spelling follows the reference printer while its syntax remains open.
func templatePatternText(n templateObject, uni *unicodeTable) string {
	p := func(x any) string { return templatePatternText(templateObj(x), uni) }
	for _, key := range []string{"node", "children"} {
		if n[key] != nil {
			return p(n[key])
		}
	}
	if n["sequence"] != nil {
		xs := []string{}
		for _, v := range templateList(n["sequence"]) {
			xs = append(xs, p(v))
		}
		return strings.Join(xs, " ")
	}
	if n["siblings"] != nil {
		return "⋯"
	}
	if n["path"] != nil {
		inner := "(" + p(n["pattern"]) + ")"
		if n["path"] == "first" {
			return inner + " ⋰"
		}
		if n["path"] == "last" {
			return "⋱ " + inner
		}
		return "⋮ " + inner
	}
	if n["optional"] != nil {
		return "[" + p(n["optional"]) + "]"
	}
	if n["repeat"] != nil {
		sep := ""
		if n["separator"] != nil {
			sep = " / " + p(n["separator"])
		}
		return "{" + p(n["repeat"]) + sep + "}"
	}
	for _, pair := range [][2]string{{"union", " ∪ "}, {"intersection", " ∩ "}, {"difference", " ∖ "}} {
		if n[pair[0]] != nil {
			xs := []string{}
			for _, v := range templateList(n[pair[0]]) {
				xs = append(xs, "("+p(v)+")")
			}
			return strings.Join(xs, pair[1])
		}
	}
	return templateCanonical(n, uni)
}
