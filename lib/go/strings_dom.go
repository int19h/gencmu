package gencmu

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"unicode/utf16"
)

type resolvedRequirement struct {
	name    string
	negated bool
}

// decodeJSONString preserves an unpaired surrogate as invalid UTF-8.
// Go can then reject the supplied string at its API boundary (§1).
func decodeJSONString(raw []byte) (string, error) {
	var decoded string
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return "", err
	}
	if !strings.Contains(string(raw), `\u`) {
		return decoded, nil
	}
	var b strings.Builder
	for i := 1; i < len(raw)-1; {
		if raw[i] != '\\' {
			b.WriteByte(raw[i])
			i++
			continue
		}
		if raw[i+1] != 'u' {
			var s string
			if err := json.Unmarshal(append(append([]byte{'"'}, raw[i:i+2]...), '"'), &s); err != nil {
				return "", err
			}
			b.WriteString(s)
			i += 2
			continue
		}
		v, _ := strconv.ParseUint(string(raw[i+2:i+6]), 16, 16)
		i += 6
		c := rune(v)
		if c >= 0xD800 && c <= 0xDBFF && i+6 <= len(raw)-1 && raw[i] == '\\' && raw[i+1] == 'u' {
			w, _ := strconv.ParseUint(string(raw[i+2:i+6]), 16, 16)
			if w >= 0xDC00 && w <= 0xDFFF {
				c = utf16.DecodeRune(c, rune(w))
				i += 6
			}
		}
		if c >= 0xD800 && c <= 0xDFFF {
			b.WriteByte(byte(0xE0 | (c >> 12)))
			b.WriteByte(byte(0x80 | ((c >> 6) & 0x3F)))
			b.WriteByte(byte(0x80 | (c & 0x3F)))
		} else {
			b.WriteRune(c)
		}
	}
	return b.String(), nil
}

// Methods keep their receiver in Items[0] internally. The DOM writes it
// separately, as engine §9 requires.
func writeRecipes(w *jsonWriter, value, image *domTerm) {
	for _, c := range []struct {
		name   string
		recipe *domTerm
	}{{"value", value}, {"image", image}} {
		if c.recipe != nil {
			w.raw(`,"` + c.name + `":`)
			c.recipe.writeJSON(w)
		}
	}
}

func writeStringRange(w *jsonWriter, ends [2]*domTerm) {
	w.raw(`{"range":[`)
	ends[0].writeJSON(w)
	w.raw(",")
	ends[1].writeJSON(w)
	w.raw("]}")
}

func writeRequirements(w *jsonWriter, requirements []tagRequirement) {
	w.raw("[")
	for i, r := range requirements {
		if i > 0 {
			w.raw(",")
		}
		w.raw(`{"negated":`)
		w.bool(r.Negated)
		w.raw(`,"value":`)
		r.Value.writeJSON(w)
		w.raw("}")
	}
	w.raw("]")
}

func decodeRequirements(raw json.RawMessage, depth int) ([]tagRequirement, error) {
	return decodeList(raw, func(raw json.RawMessage) (tagRequirement, error) {
		o, err := decodeObj(raw)
		var r tagRequirement
		if err != nil || len(o) != 2 || unmarshal(o["negated"], &r.Negated) != nil {
			return r, fmt.Errorf("a malformed tag requirement")
		}
		r.Value, err = decodeTermAt(o["value"], depth+1)
		return r, err
	})
}

func decodeStringRange(raw json.RawMessage, depth int) ([2]*domTerm, error) {
	ends, err := decodeList(raw, func(raw json.RawMessage) (*domTerm, error) { return decodeTermAt(raw, depth) })
	if err != nil || len(ends) != 2 {
		return [2]*domTerm{}, fmt.Errorf("a range requires two string operands")
	}
	return [2]*domTerm{ends[0], ends[1]}, nil
}

func decodeRecipes(o jobj) (value, image *domTerm, err error) {
	for _, c := range []struct {
		name string
		into **domTerm
	}{{"value", &value}, {"image", &image}} {
		if raw, ok := o[c.name]; ok {
			obj, e := decodeObj(raw)
			if e != nil || len(obj) != 1 || obj[tmConcat] == nil {
				return nil, nil, fmt.Errorf("a malformed recipe")
			}
			parts, e := decodeList(obj[tmConcat], decodeTerm)
			if e != nil || len(parts) == 0 {
				return nil, nil, fmt.Errorf("a recipe requires atoms")
			}
			*c.into = &domTerm{Kind: tmConcat, Items: parts}
		}
	}
	return
}

func engineScalar(name string) (string, bool) {
	if len(name) < 5 || len(name) > 7 || name[0] != '_' {
		return "", false
	}
	for _, c := range name[1:] {
		if !(c >= '0' && c <= '9' || c >= 'A' && c <= 'F') {
			return "", false
		}
	}
	v, err := strconv.ParseUint(name[1:], 16, 32)
	if err != nil || v > 0x10FFFF || v >= 0xD800 && v <= 0xDFFF {
		return "", false
	}
	return string(rune(v)), true
}

func engineTag(name string) bool {
	return strings.HasPrefix(name, "_") && name != "_Any" && propertyNames[strings.TrimPrefix(name, "_")]
}

func isClass(name string) bool {
	return isCapital(name) && name[len(name)-1] >= 'A' && name[len(name)-1] <= 'Z'
}

func userConstRefs(nodes ...any) []*domTerm {
	var out []*domTerm
	for _, r := range constRefs(nodes...) {
		if _, scalar := engineScalar(r.Str); !scalar {
			out = append(out, r)
		}
	}
	return out
}

func stringTermShape(t *domTerm) bool {
	return t != nil && (t.Kind == tmString || t.Kind == tmConst || t.Kind == tmInterpolate)
}

func hasRecipes(r *domRule) bool {
	if r.Value != nil || r.Image != nil {
		return true
	}
	for _, a := range r.Alternatives {
		if a.Value != nil || a.Image != nil {
			return true
		}
	}
	return false
}

func effectiveRecipes(r *domRule, a *domAlt) []*domTerm {
	v, i := a.Value, a.Image
	if v == nil {
		v = r.Value
	}
	if i == nil {
		i = r.Image
	}
	return []*domTerm{v, i}
}

func recipeCapturesProblem(recipe *domTerm, has func(string) bool) string {
	if recipe == nil {
		return ""
	}
	used := map[string]bool{}
	termCaptures(recipe, used)
	for name := range used {
		if !has(name) {
			return "a selected recipe reads an absent capture $" + name
		}
	}
	return ""
}

// literalEngineTags retains literal occurrences through filters (§1).
func literalEngineTags(root *domTerm) map[string][][2]int {
	type entry struct {
		t      *domTerm
		finish bool
	}
	stack := []entry{{root, false}}
	done := map[*domTerm]map[string][][2]int{}
	for len(stack) > 0 {
		f := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if f.t == nil {
			continue
		}
		if !f.finish {
			stack = append(stack, entry{f.t, true})
			for _, child := range f.t.Items {
				stack = append(stack, entry{child, false})
			}
			continue
		}
		t := f.t
		result := map[string][][2]int{}
		if t.Kind == tmTag && engineTag(t.Str) {
			result[t.Str] = [][2]int{t.At}
		}
		switch t.Kind {
		case tmUnion:
			for _, child := range t.Items {
				for tag, at := range done[child] {
					result[tag] = append(result[tag], at...)
				}
			}
		case tmIntersection:
			if len(t.Items) > 0 {
				for tag := range done[t.Items[0]] {
					all := true
					for _, child := range t.Items[1:] {
						if len(done[child][tag]) == 0 {
							all = false
						}
					}
					if all {
						for _, child := range t.Items {
							result[tag] = append(result[tag], done[child][tag]...)
						}
					}
				}
			}
		case tmDifference, tmIf:
			if len(t.Items) > 0 {
				result = done[t.Items[0]]
			}
		}
		done[t] = result
	}
	return done[root]
}

func (run *stageRun) spanImage(s spanVal) string {
	var b strings.Builder
	for i := s.a; i < s.b; i++ {
		b.WriteString(run.toks[i].Image)
	}
	return b.String()
}

func stringTerminal(s string, uni *unicodeTable) string {
	var b strings.Builder
	b.WriteByte('"')
	for _, c := range s {
		switch {
		case c == '$':
			b.WriteString("$$")
		case c == '"' || c == '\\' || c <= 0x1F || c >= 0x7F && c <= 0x9F ||
			c >= 0xE000 && c <= 0xF8FF || c >= 0xF0000 && c <= 0xFFFFD || c >= 0x100000 && c <= 0x10FFFD || uni.isMark(c) || uni.changesInDocument(c):
			fmt.Fprintf(&b, "$(_%04X)", c)
		default:
			b.WriteRune(c)
		}
	}
	b.WriteByte('"')
	return b.String()
}
