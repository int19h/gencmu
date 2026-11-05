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

func (dc *domDecoder) decodeRequirements(raw any, depth int) ([]tagRequirement, error) {
	return domList(raw, func(raw any) (tagRequirement, error) {
		o, err := domObjectOf(raw)
		var r tagRequirement
		if err != nil || len(o) != 2 || domScalar(o["negated"], &r.Negated) != nil {
			return r, fmt.Errorf("a malformed tag requirement")
		}
		r.Value, err = dc.decodeTermAt(o["value"], depth)
		return r, err
	})
}

func (dc *domDecoder) decodeStringRange(raw any, depth int) ([2]*domTerm, error) {
	ends, err := domList(raw, func(raw any) (*domTerm, error) { return dc.decodeTermAt(raw, depth) })
	if err != nil {
		return [2]*domTerm{}, err
	}
	if len(ends) != 2 {
		return [2]*domTerm{}, fmt.Errorf("a range requires two string operands")
	}
	return [2]*domTerm{ends[0], ends[1]}, nil
}

func (dc *domDecoder) decodeRecipes(o domObject) (value, image *domTerm, err error) {
	for _, c := range []struct {
		name string
		into **domTerm
	}{{"value", &value}, {"image", &image}} {
		if raw, ok := o[c.name]; ok {
			obj, e := domObjectOf(raw)
			if e != nil || len(obj) != 1 || obj[tmConcat] == nil {
				return nil, nil, fmt.Errorf("a malformed recipe")
			}
			parts, e := domList(obj[tmConcat], dc.decodeTerm)
			if e != nil || len(parts) == 0 {
				return nil, nil, fmt.Errorf("a recipe requires atoms")
			}
			*c.into = &domTerm{Kind: tmConcat, Items: parts}
		}
	}
	return
}

func engineTag(name string) bool {
	return propertyInventory.Tags[name] != nil
}

func isClass(name string) bool {
	return isCapital(name) && name[len(name)-1] >= 'A' && name[len(name)-1] <= 'Z'
}

func stringTermShape(t *domTerm) bool {
	return t != nil && (t.Kind == tmString || t.Kind == tmConst || t.Kind == tmParam)
}

func hasRecipes(r *domRule) bool {
	if r.Value != nil || r.Image != nil || r.Error != nil || r.Warning != nil {
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
	return []*domTerm{v, i, r.Error, r.Warning}
}

func recipeCapturesProblem(recipe *domTerm, has func(string) bool) string {
	if missing, found := firstAbsentRecipeCapture(recipe, has); found {
		return "a selected recipe reads an absent capture $" + missing
	}
	return ""
}

func firstAbsentRecipeCapture(recipe *domTerm, has func(string) bool) (string, bool) {
	if recipe == nil {
		return "", false
	}
	missing, found := "", false
	walkClause(clausePart{t: recipe}, func(p clausePart) bool {
		if !found && p.t != nil && p.t.Kind == tmCapture && !has(p.t.Str) {
			missing, found = p.t.Str, true
		}
		return !found
	})
	return missing, found
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
	var out strings.Builder
	out.WriteByte('"')
	for _, c := range s {
		if c == '"' || c == '‹' || c <= 0x1F || c >= 0x7F && c <= 0x9F || uni.isMark(c) || uni.category(c) == "Cf" || uni.changesInDocument(c) ||
			c != 0x20 && uni.isWhiteSpace(c) || c >= 0xE000 && c <= 0xF8FF || c >= 0xF0000 && c <= 0xFFFFD || c >= 0x100000 && c <= 0x10FFFD {
			alias, ok := uni.canonicalAbbreviations[c]
			if !ok {
				alias = fmt.Sprintf("U+%04X", c)
			}
			out.WriteString("‹" + alias + "›")
		} else {
			out.WriteRune(c)
		}
	}
	out.WriteByte('"')
	return out.String()
}

func messageReadsEmitted(recipe *domTerm) bool {
	pending := []*domTerm{recipe}
	for len(pending) > 0 {
		term := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		if term == nil {
			continue
		}
		if term.Kind == tmCall && term.Str == "emitted" {
			return true
		}
		pending = append(pending, term.Items...)
	}
	return false
}
