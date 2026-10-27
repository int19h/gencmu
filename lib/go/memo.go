package gencmu

import (
	"slices"
	"sync"
)

// memoHitHook, which only the library's own tests set, sees the rule of
// each answer that a shared memo serves, with the number of aligned queries
// active then.
var memoHitHook func(rule int32, alignedActive int)

// alignedQueryHook, which only the library's own tests set, sees 1 where
// the nested parse of an aligned query starts, and -1 where it ends.
var alignedQueryHook func(change int)

// defaultMemoLimit is the default bound on the entries of one generation
// of a shared memo.
const defaultMemoLimit = 1 << 13

// sharedKey is what a nested parse of a short span can observe (engine
// §4.3): the query kind, the rule, and the span's content as spanContent
// writes it. That content names tags, so it holds no tag number of one
// parse.
type sharedKey struct {
	begins  bool
	rule    int32
	content string
}

// sharedAnswer is whether a query holds, and for matches its tags by name.
type sharedAnswer struct {
	holds bool
	tags  []string
}

// sharedMemo keeps the answers of ordinary nested queries across the
// parses of one lowered grammar, in two generations (engine §4.3). Each
// lookup and each insertion holds its lock, and an answer never changes
// after its insertion.
type sharedMemo struct {
	mu           sync.Mutex
	newer, older map[sharedKey]sharedAnswer
}

// room makes room for one entry in the newer generation.
func (m *sharedMemo) room(limit int) {
	if len(m.newer) >= limit {
		m.older, m.newer = m.newer, nil
	}
	if m.newer == nil {
		m.newer = map[sharedKey]sharedAnswer{}
	}
}

// get is the answer of a key, if the memo holds it. An answer found in
// the older generation moves to the newer one.
func (m *sharedMemo) get(k sharedKey, limit int) (sharedAnswer, bool) {
	if limit <= 0 {
		return sharedAnswer{}, false
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if a, ok := m.newer[k]; ok {
		return a, true
	}
	a, ok := m.older[k]
	if !ok {
		return sharedAnswer{}, false
	}
	delete(m.older, k)
	m.room(limit)
	m.newer[k] = a
	return a, true
}

// insert keeps an answer. With a bound of 0 the memo keeps nothing.
func (m *sharedMemo) insert(k sharedKey, a sharedAnswer, limit int) {
	if limit <= 0 {
		return
	}
	a.tags = slices.Clone(a.tags)
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.newer[k]; ok {
		return
	}
	m.room(limit)
	m.newer[k] = a
}

// rules lists the rules of the entries in both generations, for the
// library's own tests.
func (m *sharedMemo) rules() []int32 {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []int32
	for k := range m.newer {
		out = append(out, k.rule)
	}
	for k := range m.older {
		out = append(out, k.rule)
	}
	return out
}

// memoBound is the bound of the pipeline's shared memos: the default where
// the library's own tests set none, and 0 where they turn the memos off.
func (d *Pipeline) memoBound() int {
	switch n := d.memoLimit.Load(); {
	case n == 0:
		return defaultMemoLimit
	case n < 0:
		return 0
	default:
		return int(n)
	}
}

// setMemoLimit sets the bound of the pipeline's shared memos, for the
// library's own tests. A bound of 0 turns them off.
func (d *Pipeline) setMemoLimit(n int) {
	if n == 0 {
		d.memoLimit.Store(-1)
	} else {
		d.memoLimit.Store(int64(n))
	}
}
