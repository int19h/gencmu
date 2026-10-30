package gencmu

import (
	"fmt"
	"slices"
	"sort"
	"strconv"
	"strings"
	"sync"
)

// unicodeTable is data/unicode/unicode.txt: the General_Category of every
// scalar value, White_Space, canonical decompositions and combining classes
// (engine §1). Every library reads this table
// rather than its platform's Unicode data, so that all of them agree.
type unicodeTable struct {
	profiles *scalarProfiles
	// The category ranges, in order, for a binary search.
	categories             []coreRange[string]
	whiteSpace             [][2]rune
	emojiPresentation      [][2]rune
	emojiComponent         [][2]rune
	decompositions         map[rune][]rune
	combining              []coreRange[int]
	abbreviations          map[string]rune
	canonicalAbbreviations map[rune]string
	hash                   string
	propertiesHash         string
	version                string
	versionCount           int
	properties             map[string]*propertyData
}

type scalarProfiles struct {
	mu      sync.Mutex
	entries map[rune][]string
}

type coreRange[T comparable] struct {
	start, end rune
	value      T
}

func coreError(line int, reason string) *Error {
	return &Error{Kind: ErrorGrammar, Document: "data/unicode/unicode.txt", Line: line, Message: reason}
}

// coreRangeIndex is a sparse interval tree over the Unicode code space.
// Its depth is at most 21. No insertion moves earlier records.
type coreRangeIndex[T comparable] struct {
	assigned bool
	value    T
	children *[2]coreRangeIndex[T]
}

func (node *coreRangeIndex[T]) add(start, end rune, value T, low, high rune, line int, reason string) error {
	if node.assigned {
		if node.value != value {
			return coreError(line, reason)
		}
		return nil
	}
	if start <= low && high <= end && node.children == nil {
		node.assigned, node.value = true, value
		return nil
	}
	if node.children == nil {
		node.children = new([2]coreRangeIndex[T])
	}
	mid := (low + high) / 2
	left, right := &node.children[0], &node.children[1]
	if start <= mid {
		if err := left.add(start, end, value, low, mid, line, reason); err != nil {
			return err
		}
	}
	if end > mid {
		if err := right.add(start, end, value, mid+1, high, line, reason); err != nil {
			return err
		}
	}
	if left.assigned && right.assigned && left.value == right.value {
		node.assigned, node.value, node.children = true, left.value, nil
	}
	return nil
}

func (node *coreRangeIndex[T]) ranges(result []coreRange[T], low, high rune) []coreRange[T] {
	if node.assigned {
		if n := len(result); n > 0 && result[n-1].end+1 == low && result[n-1].value == node.value {
			result[n-1].end = high
		} else {
			result = append(result, coreRange[T]{low, high, node.value})
		}
	} else if node.children != nil {
		mid := (low + high) / 2
		result = node.children[0].ranges(result, low, mid)
		result = node.children[1].ranges(result, mid+1, high)
	}
	return result
}

// categoryNames are the General_Category values in their short form
// (engine §1).
var categoryNames = []string{
	"Lu", "Ll", "Lt", "Lm", "Lo", "Mn", "Mc", "Me", "Nd", "Nl", "No", "Pc", "Pd", "Ps", "Pe", "Pi", "Pf", "Po",
	"Sm", "Sc", "Sk", "So", "Zs", "Zl", "Zp", "Cc", "Cf", "Cs", "Co", "Cn",
}

func parseUnicodeTable(text string) (*unicodeTable, error) {
	t := &unicodeTable{profiles: &scalarProfiles{}, decompositions: map[rune][]rune{}, abbreviations: map[string]rune{}, canonicalAbbreviations: map[rune]string{}, hash: fnv1a64(text)}
	var categories coreRangeIndex[string]
	var combining coreRangeIndex[int]
	hex := func(s string) (rune, error) {
		for _, c := range s {
			if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f' || c >= 'A' && c <= 'F') {
				return 0, fmt.Errorf("bad hexadecimal field %q", s)
			}
		}
		digits := strings.TrimLeft(s, "0")
		if len(digits) > 6 {
			return 0, fmt.Errorf("bad code point %q", s)
		}
		if digits == "" {
			digits = "0"
		}
		v, err := strconv.ParseUint(digits, 16, 32)
		if v > 0x10ffff {
			return 0, fmt.Errorf("bad code point %q", s)
		}
		return rune(v), err
	}
	lines := strings.Split(text, "\n")
	for n, line := range lines {
		if n < len(lines)-1 {
			line = strings.TrimSuffix(line, "\r")
		}
		f := strings.FieldsFunc(line, func(c rune) bool { return c == ' ' || c == '\t' })
		if len(f) == 0 {
			continue
		}
		want := 3
		switch f[0] {
		case "unicode":
			if len(f) != 2 {
				return nil, coreError(n+1, "the core record is invalid")
			}
			t.version = f[1]
			t.versionCount++
			continue
		case "abbreviation":
			if len(f) != 3 {
				return nil, coreError(n+1, "the core record is invalid")
			}
			code, err := hex(f[1])
			if err != nil {
				return nil, coreError(n+1, "an invalid code point")
			}
			alias := f[2]
			valid := len(alias) > 0 && alias[0] >= 'A' && alias[0] <= 'Z'
			for _, c := range alias {
				valid = valid && (c >= 'A' && c <= 'Z' || c >= '0' && c <= '9')
			}
			_, duplicate := t.abbreviations[alias]
			pinned, standard := pinnedCoreNames[alias]
			if code >= 0xd800 && code <= 0xdfff || !valid || duplicate || standard && pinned != code {
				return nil, coreError(n+1, "an invalid abbreviation")
			}
			t.abbreviations[alias] = code
			earlier, found := t.canonicalAbbreviations[code]
			if !found || len(alias) < len(earlier) || len(alias) == len(earlier) && alias < earlier {
				t.canonicalAbbreviations[code] = alias
			}
			continue
		case "decompose":
			if len(f) < 3 {
				return nil, coreError(n+1, "the core record is invalid")
			}
			scalars := make([]rune, len(f)-1)
			for i, field := range f[1:] {
				c, err := hex(field)
				if err != nil {
					return nil, coreError(n+1, "an invalid code point")
				}
				if c >= 0xd800 && c <= 0xdfff {
					return nil, coreError(n+1, "an invalid scalar")
				}
				scalars[i] = c
			}
			if _, duplicate := t.decompositions[scalars[0]]; duplicate {
				return nil, coreError(n+1, "a second decompose record")
			}
			t.decompositions[scalars[0]] = scalars[1:]
			continue
		case "category", "combining":
			want = 4
		case "white-space", "emoji-presentation", "emoji-component":
		default:
			return nil, coreError(n+1, "the core record is invalid")
		}
		if len(f) != want {
			return nil, coreError(n+1, "the core record is invalid")
		}
		a, err1 := hex(f[want-2])
		b, err2 := hex(f[want-1])
		if err1 != nil || err2 != nil {
			return nil, coreError(n+1, "an invalid code point")
		}
		if a > b {
			return nil, coreError(n+1, "a reversed range")
		}
		switch f[0] {
		case "category":
			if !slices.Contains(categoryNames, f[1]) {
				return nil, coreError(n+1, "an unknown category")
			}
			if f[1] == "Cs" {
				return nil, coreError(n+1, "category Cs is not allowed")
			}
			var err error
			err = categories.add(a, b, f[1], 0, 0x10ffff, n+1, "conflicting category ranges")
			if err != nil {
				return nil, err
			}
		case "combining":
			for _, c := range f[1] {
				if c < '0' || c > '9' {
					return nil, coreError(n+1, "an invalid combining class")
				}
			}
			digits := strings.TrimLeft(f[1], "0")
			if len(digits) > 3 {
				return nil, coreError(n+1, "an invalid combining class")
			}
			class, err := strconv.Atoi(digits)
			if err != nil || class < 1 || class > 254 {
				return nil, coreError(n+1, "an invalid combining class")
			}
			err = combining.add(a, b, class, 0, 0x10ffff, n+1, "conflicting combining ranges")
			if err != nil {
				return nil, err
			}
		case "emoji-presentation":
			t.emojiPresentation = append(t.emojiPresentation, [2]rune{a, b})
		case "emoji-component":
			t.emojiComponent = append(t.emojiComponent, [2]rune{a, b})
		case "white-space":
			t.whiteSpace = append(t.whiteSpace, [2]rune{a, b})
		}
	}
	t.categories = categories.ranges(nil, 0, 0x10ffff)
	t.combining = combining.ranges(nil, 0, 0x10ffff)
	t.emojiPresentation = unionUnicodeRanges(t.emojiPresentation)
	t.emojiComponent = unionUnicodeRanges(t.emojiComponent)
	t.whiteSpace = unionUnicodeRanges(t.whiteSpace)
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
		return r[i].value
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

// fnv1a64 is the hash that keys preparsed DOMs (engine §8).
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
		return t.combining[i].value
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

func inUnicodeRanges(ranges [][2]rune, c rune) bool {
	i := sort.Search(len(ranges), func(i int) bool { return ranges[i][1] >= c })
	return i < len(ranges) && ranges[i][0] <= c
}
func (t *unicodeTable) isEmojiName(name string) bool {
	chars := []rune(name)
	return name != "#" && name != "@" && len(chars) == 1 && inUnicodeRanges(t.emojiPresentation, chars[0]) && !inUnicodeRanges(t.emojiComponent, chars[0])
}

// unionUnicodeRanges merges overlapping and adjacent property records.
func unionUnicodeRanges(ranges [][2]rune) [][2]rune {
	sort.Slice(ranges, func(i, j int) bool { return ranges[i][0] < ranges[j][0] })
	union := ranges[:0]
	for _, interval := range ranges {
		last := len(union) - 1
		if last >= 0 && interval[0] <= union[last][1]+1 {
			union[last][1] = max(union[last][1], interval[1])
		} else {
			union = append(union, interval)
		}
	}
	return union
}
