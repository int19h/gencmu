package gencmu

import (
	"sort"
	"strings"
)

// A tag set (engine §1): tags in code point order, each strong or weak,
// interned so that an item can key on its id.
type tagset struct {
	id     int32
	names  []string
	strong []bool
	key    string
}

func (t *tagset) has(name string) (strong, ok bool) {
	i := sort.SearchStrings(t.names, name)
	if i < len(t.names) && t.names[i] == name {
		return t.strong[i], true
	}
	return false, false
}

func (t *tagset) toMap() map[string]bool {
	m := make(map[string]bool, len(t.names))
	for i, n := range t.names {
		m[n] = t.strong[i]
	}
	return m
}

type interner struct {
	byKey map[string]*tagset
	all   []*tagset
}

func newInterner() *interner {
	return &interner{byKey: map[string]*tagset{}}
}

func (in *interner) make(names []string, strong []bool) *tagset {
	var b strings.Builder
	for i, n := range names {
		b.WriteString(n)
		if strong[i] {
			b.WriteByte(1)
		} else {
			b.WriteByte(2)
		}
	}
	key := b.String()
	if t, ok := in.byKey[key]; ok {
		return t
	}
	t := &tagset{id: int32(len(in.all)), names: names, strong: strong, key: key}
	in.byKey[key] = t
	in.all = append(in.all, t)
	return t
}

func (in *interner) fromMap(m map[string]bool) *tagset {
	names := make([]string, 0, len(m))
	for n := range m {
		names = append(names, n)
	}
	sort.Strings(names)
	strong := make([]bool, len(names))
	for i, n := range names {
		strong[i] = m[n]
	}
	return in.make(names, strong)
}

func (in *interner) empty() *tagset { return in.make(nil, nil) }

func (in *interner) single(name string, strong bool) *tagset {
	return in.make([]string{name}, []bool{strong})
}

// union holds every tag of either, strong if strong in either.
func (in *interner) union(a, b *tagset) *tagset {
	if len(b.names) == 0 {
		return a
	}
	if len(a.names) == 0 {
		return b
	}
	var names []string
	var strong []bool
	i, j := 0, 0
	for i < len(a.names) || j < len(b.names) {
		switch {
		case j == len(b.names) || (i < len(a.names) && a.names[i] < b.names[j]):
			names, strong = append(names, a.names[i]), append(strong, a.strong[i])
			i++
		case i == len(a.names) || b.names[j] < a.names[i]:
			names, strong = append(names, b.names[j]), append(strong, b.strong[j])
			j++
		default:
			names, strong = append(names, a.names[i]), append(strong, a.strong[i] || b.strong[j])
			i++
			j++
		}
	}
	return in.make(names, strong)
}

// intersection holds the tags of a that are in b, with a's strength.
func (in *interner) intersection(a, b *tagset) *tagset {
	var names []string
	var strong []bool
	for i, n := range a.names {
		if _, ok := b.has(n); ok {
			names, strong = append(names, n), append(strong, a.strong[i])
		}
	}
	return in.make(names, strong)
}

// sameNames compares two sets by their tags alone, ignoring strength.
func sameNames(a, b *tagset) bool {
	if len(a.names) != len(b.names) {
		return false
	}
	for i := range a.names {
		if a.names[i] != b.names[i] {
			return false
		}
	}
	return true
}

// phonemeTag is the phoneme a tag /p/ names, a pause / / being a space: a
// phoneme tag is exactly three code points, the first and last / (§5).
func phonemeTag(tag string) (string, bool) {
	r := []rune(tag)
	if len(r) == 3 && r[0] == '/' && r[2] == '/' {
		return string(r[1]), true
	}
	return "", false
}
