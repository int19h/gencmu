package gencmu

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// unicodeTable is grammars/unicode.txt: the mark and alpha ranges that give
// a character its class (engine §1), and the simple lowercase mappings that
// lowercase() applies (engine §10). Every library reads this table rather
// than its platform's Unicode data, so that all of them agree.
type unicodeTable struct {
	marks, alphas [][2]rune
	lower         map[rune]rune
}

func parseUnicodeTable(text string) (*unicodeTable, error) {
	t := &unicodeTable{lower: map[rune]rune{}}
	for n, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		f := strings.Fields(line)
		hex := func(s string) (rune, error) {
			v, err := strconv.ParseUint(s, 16, 32)
			return rune(v), err
		}
		switch f[0] {
		case "unicode":
			continue
		case "mark", "alpha", "lower":
			if len(f) != 3 {
				return nil, fmt.Errorf("unicode.txt line %d: expected three fields", n+1)
			}
			a, err1 := hex(f[1])
			b, err2 := hex(f[2])
			if err1 != nil || err2 != nil {
				return nil, fmt.Errorf("unicode.txt line %d: bad code point", n+1)
			}
			switch f[0] {
			case "mark":
				t.marks = append(t.marks, [2]rune{a, b})
			case "alpha":
				t.alphas = append(t.alphas, [2]rune{a, b})
			default:
				t.lower[a] = b
			}
		default:
			return nil, fmt.Errorf("unicode.txt line %d: unknown entry %q", n+1, f[0])
		}
	}
	for _, r := range [][][2]rune{t.marks, t.alphas} {
		sort.Slice(r, func(i, j int) bool { return r[i][0] < r[j][0] })
	}
	return t, nil
}

func inRanges(ranges [][2]rune, c rune) bool {
	i := sort.Search(len(ranges), func(i int) bool { return ranges[i][1] >= c })
	return i < len(ranges) && ranges[i][0] <= c
}

// class is the weak class tag of a character token (engine §1).
func (t *unicodeTable) class(c rune) string {
	switch {
	case c >= 0x09 && c <= 0x0D, c == 0x20, c == 0x85, c == 0xA0, c == 0x1680,
		c >= 0x2000 && c <= 0x200A, c == 0x2028, c == 0x2029, c == 0x202F, c == 0x205F, c == 0x3000:
		return "space"
	case c >= '0' && c <= '9':
		return "digit"
	case inRanges(t.marks, c):
		return "mark"
	case inRanges(t.alphas, c):
		return "alpha"
	}
	return "other"
}

func (t *unicodeTable) lowercase(s string) string {
	var b strings.Builder
	for _, c := range s {
		if l, ok := t.lower[c]; ok {
			c = l
		}
		b.WriteRune(c)
	}
	return b.String()
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
