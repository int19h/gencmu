package gencmu

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

// A set of tags or of strings (engine §1, §10): its members in code point
// order, interned so that an item can key on its id. A tag has no
// strength, so a set holds a member or not. A set of strings, such as
// runs() gives, has the same form; the reader has checked that no set of
// one kind meets a set of the other.
type tagset struct {
	id    int32
	names []string
	key   string
}

func (t *tagset) has(name string) bool {
	i := sort.SearchStrings(t.names, name)
	return i < len(t.names) && t.names[i] == name
}

// list is the set's members in code point order, as the output lists them.
func (t *tagset) list() []string {
	return append([]string{}, t.names...)
}

type interner struct {
	byKey map[string]*tagset
	all   []*tagset
}

func newInterner() *interner {
	return &interner{byKey: map[string]*tagset{}}
}

// make interns a set from its members, sorted and each once.
func (in *interner) make(names []string) *tagset {
	// Each name is written with its length before it, so that no two sets
	// share a key, whatever characters their names hold.
	var b strings.Builder
	for _, n := range names {
		b.WriteString(strconv.Itoa(len(n)))
		b.WriteByte(':')
		b.WriteString(n)
	}
	key := b.String()
	if t, ok := in.byKey[key]; ok {
		return t
	}
	t := &tagset{id: int32(len(in.all)), names: names, key: key}
	in.byKey[key] = t
	in.all = append(in.all, t)
	return t
}

// fromList interns the set of a list of members in any order, repeats
// allowed.
func (in *interner) fromList(list []string) *tagset {
	names := append([]string{}, list...)
	sort.Strings(names)
	out := names[:0]
	for i, n := range names {
		if i == 0 || n != names[i-1] {
			out = append(out, n)
		}
	}
	return in.make(out)
}

func (in *interner) empty() *tagset { return in.make(nil) }

func (in *interner) single(name string) *tagset {
	return in.make([]string{name})
}

// union holds every member of either.
func (in *interner) union(a, b *tagset) *tagset {
	if len(b.names) == 0 {
		return a
	}
	if len(a.names) == 0 {
		return b
	}
	var names []string
	i, j := 0, 0
	for i < len(a.names) || j < len(b.names) {
		switch {
		case j == len(b.names) || (i < len(a.names) && a.names[i] < b.names[j]):
			names = append(names, a.names[i])
			i++
		case i == len(a.names) || b.names[j] < a.names[i]:
			names = append(names, b.names[j])
			j++
		default:
			names = append(names, a.names[i])
			i++
			j++
		}
	}
	return in.make(names)
}

// intersection holds the members of both.
func (in *interner) intersection(a, b *tagset) *tagset {
	var names []string
	for _, n := range a.names {
		if b.has(n) {
			names = append(names, n)
		}
	}
	return in.make(names)
}

// difference holds the members of a that are not in b.
func (in *interner) difference(a, b *tagset) *tagset {
	if len(b.names) == 0 {
		return a
	}
	var names []string
	for _, n := range a.names {
		if !b.has(n) {
			names = append(names, n)
		}
	}
	return in.make(names)
}

// subset says whether every member of a is in b.
func subset(a, b *tagset) bool {
	for _, n := range a.names {
		if !b.has(n) {
			return false
		}
	}
	return true
}

// phonemeTag is the phoneme a tag /p/ names, the pause /./ being .: a
// phoneme tag is exactly three code points, the first and last / (§1, §5).
func phonemeTag(tag string) (string, bool) {
	r := []rune(tag)
	if len(r) == 3 && r[0] == '/' && r[2] == '/' {
		return string(r[1]), true
	}
	return "", false
}

var nameSyntax = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9-]*$`)

// isName says whether a string is a name, and so an identifier tag
// (engine §1).
func isName(s string) bool { return nameSyntax.MatchString(s) }

// isCapital says whether a name begins with a capital, and so is a
// terminal and a tag literal (engine §2).
func isCapital(name string) bool {
	return name != "" && name[0] >= 'A' && name[0] <= 'Z'
}

// escapedInTag says whether a code point is written as \u{h…} in a
// character tag's canonical spelling (engine §1): a control character, a
// nonspacing mark, a private-use character, the quote or the backslash.
func escapedInTag(c rune, isMark func(rune) bool) bool {
	return c <= 0x1F || (c >= 0x7F && c <= 0x9F) || c == '\'' || c == '\\' ||
		(c >= 0xE000 && c <= 0xF8FF) || (c >= 0xF0000 && c <= 0xFFFFD) || (c >= 0x100000 && c <= 0x10FFFD) ||
		isMark(c)
}

// characterTag is the character tag of a Unicode scalar value in its
// canonical spelling (engine §1): 'a', or '\u{301}' for a code point that
// is escaped.
func characterTag(c rune, isMark func(rune) bool) string {
	if escapedInTag(c, isMark) {
		return fmt.Sprintf(`'\u{%X}'`, c)
	}
	return "'" + string(c) + "'"
}

// characterOfTag is the scalar value that a character tag in its canonical
// spelling names; ok is false for a string that is not one.
func characterOfTag(tag string, isMark func(rune) bool) (rune, bool) {
	if len(tag) < 3 || tag[0] != '\'' || tag[len(tag)-1] != '\'' {
		return 0, false
	}
	inner := tag[1 : len(tag)-1]
	var c rune
	if strings.HasPrefix(inner, `\u{`) && strings.HasSuffix(inner, "}") {
		hex := inner[3 : len(inner)-1]
		if len(hex) < 1 || len(hex) > 6 || strings.ToUpper(hex) != hex {
			return 0, false
		}
		v, err := strconv.ParseUint(hex, 16, 32)
		if err != nil {
			return 0, false
		}
		c = rune(v)
	} else {
		r, size := utf8.DecodeRuneInString(inner)
		if size != len(inner) || r == utf8.RuneError {
			return 0, false
		}
		c = r
	}
	if c > 0x10FFFF || (c >= 0xD800 && c <= 0xDFFF) {
		return 0, false
	}
	if characterTag(c, isMark) != tag {
		return 0, false
	}
	return c, true
}

// isTag says whether a string is a tag in its canonical spelling: a name,
// a phoneme tag or a character tag (engine §1). Without a table, which
// says which code points are marks, a character tag passes in either
// spelling that a table could make canonical.
func isTag(tag string, uni *unicodeTable) bool {
	if isName(tag) {
		return true
	}
	if _, ok := phonemeTag(tag); ok {
		return true
	}
	if uni != nil {
		_, ok := characterOfTag(tag, uni.isMark)
		return ok
	}
	// No mark lies below U+0300.
	if _, ok := characterOfTag(tag, func(rune) bool { return false }); ok {
		return true
	}
	_, ok := characterOfTag(tag, func(c rune) bool { return c >= 0x300 })
	return ok
}
