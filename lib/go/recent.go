package gencmu

import "sort"

// maxLowered is the most lowered grammars, and the most classifier tables,
// that a stage keeps. Each set of the stage's gates that is on has its own,
// so a stage with k gates can have 2^k of them. The least recently used
// goes first.
const maxLowered = 16

// recent is a map of at most limit entries. When it is full, a new entry
// drops the entry that was used least recently. It has no lock of its own,
// so its owner locks it when goroutines share it.
type recent[K comparable, V any] struct {
	limit   int
	keys    []K // least recently used first
	entries map[K]V
}

func newRecent[K comparable, V any](limit int) *recent[K, V] {
	return &recent[K, V]{limit: limit, entries: map[K]V{}}
}

// get is the value of a key, now the most recently used.
func (r *recent[K, V]) get(key K) (V, bool) {
	v, ok := r.entries[key]
	if ok {
		r.touch(key)
	}
	return v, ok
}

// put adds a value, and drops the least recently used when the map is full.
func (r *recent[K, V]) put(key K, value V) {
	if _, ok := r.entries[key]; ok {
		r.touch(key)
	} else {
		r.keys = append(r.keys, key)
	}
	r.entries[key] = value
	for len(r.keys) > r.limit {
		delete(r.entries, r.keys[0])
		r.keys = r.keys[1:]
	}
}

func (r *recent[K, V]) touch(key K) {
	for i, k := range r.keys {
		if k == key {
			copy(r.keys[i:], r.keys[i+1:])
			r.keys[len(r.keys)-1] = key
			return
		}
	}
}

func (r *recent[K, V]) len() int { return len(r.entries) }

// guardNames are the names of the features that guards use, in code point
// order, each once.
func guardNames(guards []domGuard) []string {
	seen := map[string]bool{}
	var names []string
	for _, gd := range guards {
		if !seen[gd.Feature] {
			seen[gd.Feature] = true
			names = append(names, gd.Feature)
		}
	}
	sort.Strings(names)
	return names
}

// namesOn is the set of the names that are on among features, and a key
// that names that set: one byte for each name, in the order of names. Two
// sets of features with the same names on have the same key, and no two
// other sets do.
func namesOn(names []string, features map[string]bool) (map[string]bool, string) {
	on := map[string]bool{}
	key := make([]byte, len(names))
	for i, name := range names {
		key[i] = '0'
		if features[name] {
			on[name] = true
			key[i] = '1'
		}
	}
	return on, string(key)
}
