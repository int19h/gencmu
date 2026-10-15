package gencmu

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// unicodeTable is grammars/unicode.txt: the General_Category of every
// scalar value, White_Space, canonical decompositions and combining classes
// (engine §1). Every library reads this table
// rather than its platform's Unicode data, so that all of them agree.
type unicodeTable struct {
	// The category ranges, in order, for a binary search.
	categories     []categoryRange
	whiteSpace     [][2]rune
	decompositions map[rune][]rune
	combining      []combiningRange
	hash           string
}

type combiningRange struct {
	start, end rune
	class      int
}

type categoryRange struct {
	start, end rune
	category   string
}

// categoryNames are the General_Category values in their short form
// (engine §1).
var categoryNames = []string{
	"Lu", "Ll", "Lt", "Lm", "Lo", "Mn", "Mc", "Me", "Nd", "Nl", "No", "Pc", "Pd", "Ps", "Pe", "Pi", "Pf", "Po",
	"Sm", "Sc", "Sk", "So", "Zs", "Zl", "Zp", "Cc", "Cf", "Cs", "Co", "Cn",
}

// propertyNames are the names a property can have (engine §1): the
// General_Category values in their short form, their one-letter groups,
// White_Space and Any.
var propertyNames = func() map[string]bool {
	m := map[string]bool{"L": true, "M": true, "N": true, "P": true, "S": true, "Z": true, "C": true, "White_Space": true, "Any": true}
	for _, c := range categoryNames {
		m[c] = true
	}
	return m
}()

func parseUnicodeTable(text string) (*unicodeTable, error) {
	t := &unicodeTable{decompositions: map[rune][]rune{}, hash: fnv1a64(text)}
	hex := func(s string) (rune, error) {
		v, err := strconv.ParseUint(s, 16, 32)
		return rune(v), err
	}
	for n, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		f := strings.Fields(line)
		want := 3
		switch f[0] {
		case "unicode":
			continue
		case "decompose":
			if len(f) < 3 || len(f) > 6 {
				return nil, fmt.Errorf("unicode.txt line %d: expected 3 to 6 fields", n+1)
			}
			scalars := make([]rune, len(f)-1)
			for i, field := range f[1:] {
				c, err := hex(field)
				if err != nil || c > 0x10ffff || c >= 0xd800 && c <= 0xdfff {
					return nil, fmt.Errorf("unicode.txt line %d: bad code point", n+1)
				}
				scalars[i] = c
			}
			t.decompositions[scalars[0]] = scalars[1:]
			continue
		case "category", "combining":
			want = 4
		case "white-space":
		default:
			return nil, fmt.Errorf("unicode.txt line %d: unknown entry %q", n+1, f[0])
		}
		if len(f) != want {
			return nil, fmt.Errorf("unicode.txt line %d: expected %d fields", n+1, want)
		}
		a, err1 := hex(f[want-2])
		b, err2 := hex(f[want-1])
		if err1 != nil || err2 != nil {
			return nil, fmt.Errorf("unicode.txt line %d: bad code point", n+1)
		}
		switch f[0] {
		case "category":
			t.categories = append(t.categories, categoryRange{a, b, f[1]})
		case "combining":
			class, err := strconv.Atoi(f[1])
			if err != nil || class < 1 || class > 254 {
				return nil, fmt.Errorf("unicode.txt line %d: bad combining class", n+1)
			}
			t.combining = append(t.combining, combiningRange{a, b, class})
		case "white-space":
			t.whiteSpace = append(t.whiteSpace, [2]rune{a, b})
		}
	}
	sort.Slice(t.categories, func(i, j int) bool { return t.categories[i].start < t.categories[j].start })
	sort.Slice(t.whiteSpace, func(i, j int) bool { return t.whiteSpace[i][0] < t.whiteSpace[j][0] })
	sort.Slice(t.combining, func(i, j int) bool { return t.combining[i].start < t.combining[j].start })
	return t, nil
}

// category is the General_Category of a code point in its short form,
// found by binary search (engine §1): Cs for a surrogate, which a table does
// not list, and Cn for any other code point that the table omits.
func (t *unicodeTable) category(c rune) string {
	if c >= 0xD800 && c <= 0xDFFF {
		return "Cs"
	}
	r := t.categories
	i := sort.Search(len(r), func(i int) bool { return r[i].end >= c })
	if i < len(r) && r[i].start <= c {
		return r[i].category
	}
	return "Cn"
}

// isMark says whether a code point is a nonspacing mark, of
// General_Category Mn, which terminal diagnostics escape (engine §9.1).
func (t *unicodeTable) isMark(c rune) bool { return t.category(c) == "Mn" }

// isWhiteSpace says whether a code point has the White_Space property.
func (t *unicodeTable) isWhiteSpace(c rune) bool {
	r := t.whiteSpace
	i := sort.Search(len(r), func(i int) bool { return r[i][1] >= c })
	return i < len(r) && r[i][0] <= c
}

// hasProperty says whether a scalar value has a property (engine §1),
// whose name must be one of propertyNames.
func (t *unicodeTable) hasProperty(name string, c rune) bool {
	switch {
	case name == "Any":
		return true
	case name == "White_Space":
		return t.isWhiteSpace(c)
	case len(name) == 1:
		return t.category(c)[0] == name[0]
	}
	return t.category(c) == name
}

// fnv1a64 is the hash that keys precompiled DOMs (engine §8).
func fnv1a64(text string) string {
	h := uint64(0xcbf29ce484222325)
	for i := 0; i < len(text); i++ {
		h ^= uint64(text[i])
		h *= 0x100000001b3
	}
	s := strconv.FormatUint(h, 16)
	return strings.Repeat("0", 16-len(s)) + s
}

// combiningClass reads the canonical combining class, with zero as the default.
func (t *unicodeTable) combiningClass(c rune) int {
	i := sort.Search(len(t.combining), func(i int) bool { return t.combining[i].end >= c })
	if i < len(t.combining) && t.combining[i].start <= c {
		return t.combining[i].class
	}
	return 0
}

type decomposedScalar struct {
	character     rune
	origin, class int
}

// decomposeWithOrigins applies each full mapping once, then orders nonzero
// runs stably. Origins count code points in the original text (engine §1).
func (t *unicodeTable) decomposeWithOrigins(text []rune) []decomposedScalar {
	result := make([]decomposedScalar, 0, len(text))
	for origin, c := range text {
		scalars := t.decompositions[c]
		var hangul [3]rune
		if c >= 0xac00 && c <= 0xd7a3 {
			syllable := c - 0xac00
			hangul[0], hangul[1] = 0x1100+syllable/588, 0x1161+syllable%588/28
			scalars = hangul[:2]
			if syllable%28 != 0 {
				hangul[2] = 0x11a7 + syllable%28
				scalars = hangul[:]
			}
		} else if scalars == nil {
			hangul[0] = c
			scalars = hangul[:1]
		}
		for _, scalar := range scalars {
			result = append(result, decomposedScalar{scalar, origin, t.combiningClass(scalar)})
		}
	}
	for start := 0; start < len(result); {
		if result[start].class == 0 {
			start++
			continue
		}
		end := start + 1
		for end < len(result) && result[end].class != 0 {
			end++
		}
		run := result[start:end]
		sort.SliceStable(run, func(i, j int) bool { return run[i].class < run[j].class })
		start = end
	}
	return result
}

func (t *unicodeTable) decompose(text string) string {
	var result strings.Builder
	for _, scalar := range t.decomposeWithOrigins([]rune(text)) {
		result.WriteRune(scalar.character)
	}
	return result.String()
}

// changesInDocument identifies scalars that require exact diagnostic escapes.
func (t *unicodeTable) changesInDocument(c rune) bool {
	_, mapped := t.decompositions[c]
	return mapped || c >= 0xac00 && c <= 0xd7a3 || t.combiningClass(c) != 0
}
