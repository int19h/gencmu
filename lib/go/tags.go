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
// split() gives, has the same form; the reader has checked that no set of
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

// internedCount is the count of interned members, or nil when work is not
// counted.
func internedCount() *workCount {
	if w := work.Load(); w != nil {
		return &w.interned
	}
	return nil
}

// make interns a set from its members, sorted and each once. Each member
// counts before it is written into the key, as in every loop below that
// gathers the members of a set.
func (in *interner) make(names []string) *tagset {
	c := internedCount()
	// Each name is written with its length before it, so that no two sets
	// share a key, whatever characters their names hold.
	var b strings.Builder
	for _, n := range names {
		if c != nil {
			c.add("interned members")
		}
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
	c := internedCount()
	names := append([]string{}, list...)
	sortStrings(names, c, "interned members")
	out := names[:0]
	for i, n := range names {
		if c != nil {
			c.add("interned members")
		}
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
	c := internedCount()
	var names []string
	i, j := 0, 0
	for i < len(a.names) || j < len(b.names) {
		if c != nil {
			c.add("interned members")
		}
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

// unionAll holds every member of any of the sets. A union folded pair by
// pair copies and interns each growing partial result, so k sets cost k
// times the result. This gathers the members once and interns the result
// alone.
func (in *interner) unionAll(sets []*tagset) *tagset {
	var only *tagset
	total := 0
	for _, s := range sets {
		if len(s.names) > 0 {
			if only == nil {
				only = s
			}
			total += len(s.names)
		}
	}
	if only == nil {
		return in.empty()
	}
	if total == len(only.names) {
		return only
	}
	c := internedCount()
	names := make([]string, 0, total)
	for _, s := range sets {
		for _, n := range s.names {
			if c != nil {
				c.add("interned members")
			}
			names = append(names, n)
		}
	}
	return in.fromList(names)
}

// intersection holds the members of both.
func (in *interner) intersection(a, b *tagset) *tagset {
	c := internedCount()
	var names []string
	for _, n := range a.names {
		if c != nil {
			c.add("interned members")
		}
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
	c := internedCount()
	var names []string
	for _, n := range a.names {
		if c != nil {
			c.add("interned members")
		}
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

// splitString is the value of split(s, delimiter) (engine §10): the pieces
// between the occurrences of the delimiter, found from the left without
// overlap, with the empty pieces dropped. The delimiter is not empty.
func splitString(s, delimiter string) []string {
	var pieces []string
	for _, piece := range strings.Split(s, delimiter) {
		if piece != "" {
			pieces = append(pieces, piece)
		}
	}
	return pieces
}

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
		// An invalid byte decodes as RuneError with size 1. A correctly
		// encoded U+FFFD decodes as RuneError with size 3 and is valid.
		r, size := utf8.DecodeRuneInString(inner)
		if size != len(inner) || (r == utf8.RuneError && size < 3) {
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

// codeOfCharacterTag is the scalar value of a character tag in its
// canonical spelling, or -1 for any other tag. The tag is not checked
// beyond its form: every tag inside the engine is in its canonical spelling
// (engine §1).
func codeOfCharacterTag(tag string) rune {
	if len(tag) < 3 || tag[0] != '\'' {
		return -1
	}
	if tag[1] == '\\' {
		v, err := strconv.ParseUint(tag[4:len(tag)-2], 16, 32)
		if err != nil {
			return -1
		}
		return rune(v)
	}
	r, _ := utf8.DecodeRuneInString(tag[1:])
	return r
}

// rangeName is the written form of a range, its identity as a terminal
// (engine §4): its two ends, in their canonical spelling, joined by "..".
func rangeName(r [2]string) string { return r[0] + ".." + r[1] }

// propertyName is the written form of a property, its identity as a
// terminal (engine §4).
func propertyName(name string) string { return `'\p{` + name + `}'` }

// rangeTags lists the character tags of a range (engine §1), from its start
// to its end by scalar value, the surrogates skipped.
func rangeTags(r [2]string, isMark func(rune) bool) []string {
	var out []string
	last := codeOfCharacterTag(r[1])
	for c := codeOfCharacterTag(r[0]); c <= last; c++ {
		if c == 0xD800 {
			c = 0xE000
			if c > last {
				break
			}
		}
		out = append(out, characterTag(c, isMark))
	}
	return out
}

// charClass is the characters a range or a property terminal matches: a
// range's first and last scalar values, or a property's name.
type charClass struct {
	from, to rune
	property string // "" for a range
}

// carries says whether a tag set holds a character tag of the class
// (engine §4): the terminal then matches the token once, however many of
// its tags qualify.
func (cc *charClass) carries(uni *unicodeTable, ts *tagset) bool {
	for _, tag := range ts.names {
		c := codeOfCharacterTag(tag)
		if c < 0 {
			continue
		}
		if cc.property != "" {
			if uni.hasProperty(cc.property, c) {
				return true
			}
		} else if c >= cc.from && c <= cc.to {
			return true
		}
	}
	return false
}

// writtenTest is a test as an expected list writes it after its terminal
// (docs/output.md): its comparator and its value in canonical form. A
// string stands between double quotes, a backslash before each \ and ". A
// tag set is ∅, its one tag, or its tags in code point order joined by
// " ∪ " in parentheses.
func writtenTest(op string, v *constValue) string {
	var written string
	if v.ty == tyString {
		written = `"` + strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(v.s) + `"`
	} else {
		switch len(v.names) {
		case 0:
			written = "∅"
		case 1:
			written = v.names[0]
		default:
			written = "(" + strings.Join(v.names, " ∪ ") + ")"
		}
	}
	if rest, ok := strings.CutPrefix(op, "∩"); ok {
		return "∩" + written + rest
	}
	return op + written
}
