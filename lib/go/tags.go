package gencmu

import (
	"regexp"
	"sort"
	"strconv"
	"strings"
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
	return t.find(name, nil)
}

// find says whether the set holds a member, by a binary search whose
// probes each count in c, unless it is nil, before they are made. The set
// operations below count their searches so that a slower search shows.
func (t *tagset) find(name string, c *workCount) bool {
	if c != nil && work.Load().scanOther {
		// The mutation: a scan of every member before the one sought.
		for _, n := range t.names {
			c.add("interned members")
			if n >= name {
				return n == name
			}
		}
		return false
	}
	i := sort.Search(len(t.names), func(k int) bool {
		if c != nil {
			c.add("interned members")
		}
		return t.names[k] >= name
	})
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

// fromList interns the set of the members of some lists, in any order,
// repeats allowed. Each member counts as it is copied, so that a copy
// which grows faster than the lists shows.
func (in *interner) fromList(lists ...[]string) *tagset {
	c := internedCount()
	total := 0
	for _, list := range lists {
		total += len(list)
	}
	names := make([]string, 0, total)
	w := work.Load()
	for _, list := range lists {
		for _, n := range list {
			if w != nil && w.copyGrowing {
				// The mutation: the members so far copied again for each.
				names = appendCounted(make([]string, 0, total), names, c, "interned members")
			}
			if c != nil {
				c.add("interned members")
			}
			names = append(names, n)
		}
	}
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
	lists := make([][]string, len(sets))
	for i, s := range sets {
		lists[i] = s.names
	}
	return in.fromList(lists...)
}

// intersection holds the members of both.
func (in *interner) intersection(a, b *tagset) *tagset {
	c := internedCount()
	var names []string
	for _, n := range a.names {
		if c != nil {
			c.add("interned members")
		}
		if b.find(n, c) {
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
		if !b.find(n, c) {
			names = append(names, n)
		}
	}
	return in.make(names)
}

// subset says whether every member of a is in b. Each member of a and
// each probe of b counts before it is looked at.
func subset(a, b *tagset) bool {
	c := internedCount()
	for _, n := range a.names {
		if c != nil {
			c.add("interned members")
		}
		if !b.find(n, c) {
			return false
		}
	}
	return true
}

var nameSyntax = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_-]*$`)

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

// isTag accepts user tags and reserved Unicode tags (engine §1).
func isTag(tag string, uni *unicodeTable) bool {
	return isCapital(tag) && isName(tag) || (engineTag(tag) && uni.canonicalTag(tag) == tag)
}

// charClass is the characters a range or a property terminal matches: a
// range's first and last scalar values, or a property's name.
type charClass struct {
	from, to rune
	literal  *string
	wildcard bool
}

func ngrams(s, digits string) []string {
	points := []rune(s)
	n, err := strconv.Atoi(digits)
	if err != nil || n > len(points) {
		return nil
	}
	var result []string
	for i := 0; i+n <= len(points); i++ {
		result = append(result, string(points[i:i+n]))
	}
	return result
}
