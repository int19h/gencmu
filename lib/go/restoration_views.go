package gencmu

import "fmt"

// Ranking projects restoration identities after recognition (§6 and §7.10).
// The original items and their cycle observations remain unchanged.
type restorationLink struct {
	item *item
	edge link
}
type restorationViews struct {
	rec     *recognizer
	items   map[*item]*item
	syms    map[*symNode]*symNode
	origins map[*item]map[link][]restorationLink
	marked  map[*item]map[link]bool
}

func newRestorationViews(raw *recognizer) *restorationViews {
	if raw.closes == nil {
		return nil
	}
	erased := false
	for _, p := range raw.g.prods {
		erased = erased || p.nothing
	}
	if !erased {
		return nil
	}
	v := &restorationViews{items: map[*item]*item{}, syms: map[*symNode]*symNode{}, origins: map[*item]map[link][]restorationLink{}, marked: map[*item]map[link]bool{}}
	project := func(state int) int {
		if state == invalidCloses {
			return state
		}
		return raw.closes.state(raw.closes.semantic(state), 0)
	}
	capture := func(c capVal) capVal { c.closes = project(c.closes); return c }
	caps, capIDs := map[capStep]int32{}, make([]int32, len(raw.capNodes))
	for i, part := range raw.capNodes {
		if i > 0 {
			if w := work.Load(); w != nil {
				w.visits.add("visits")
			}
			key := capStep{capsParent(capIDs, part.parent), capture(part.cv)}
			id, ok := caps[key]
			if !ok {
				id = int32(len(caps) + 1)
				caps[key] = id
			}
			capIDs[i] = id
		}
	}
	frames, frameIDs := map[*rankedFrame]*rankedFrame{}, map[string]*rankedFrame{}
	var frame func(*rankedFrame) *rankedFrame
	frame = func(f *rankedFrame) *rankedFrame {
		if f == nil {
			return nil
		}
		if before := frames[f]; before != nil {
			return before
		}
		if w := work.Load(); w != nil {
			w.visits.add("visits")
		}
		key := *f
		key.id = 0
		key.root = baseProduction(f.root)
		key.closes = project(f.closes)
		key.sealCloses = project(f.sealCloses)
		key.captures = map[string]capVal{}
		for name, c := range f.captures {
			if w := work.Load(); w != nil {
				w.visits.add("visits")
			}
			key.captures[name] = capture(c)
		}
		if f.sealEntry == f {
			key.sealEntry = nil
		} else {
			key.sealEntry = frame(f.sealEntry)
		}
		text := fmt.Sprintf("%#v", key)
		out := frameIDs[text]
		if out == nil {
			copy := *f
			copy.id = int32(len(frameIDs) + 1)
			out = &copy
			frameIDs[text] = out
		}
		frames[f] = out
		return out
	}
	type observedProduction struct {
		p         *production
		frame     *rankedFrame
		requested observationKinds
	}
	productions := map[observedProduction]*production{}
	production := func(p *production) *production {
		if p.lexical == nil {
			return p
		}
		key := observedProduction{baseProduction(p), frame(p.lexical), p.requestedKinds()}
		if old := productions[key]; old != nil {
			return old
		}
		copy := *p
		copy.lexical = key.frame
		productions[key] = &copy
		return &copy
	}
	copyRec := *raw
	v.rec = &copyRec
	v.rec.sets = make([]*eset, len(raw.sets))
	type itemIdentity struct {
		key              itemKey
		strict, restores bool
	}
	for pos, set := range raw.sets {
		if set != nil {
			out := *set
			out.index = map[itemKey]*item{}
			out.syms = map[symKey]*symNode{}
			out.items = nil
			v.rec.sets[pos] = &out
			found := map[itemIdentity]*item{}
			for _, it := range set.items {
				if w := work.Load(); w != nil {
					w.visits.add("visits")
				}
				key := it.itemKey
				key.prod = production(it.prod)
				key.closes = project(it.closes)
				key.cap0 = capture(it.cap0)
				key.more = capsParent(capIDs, it.more)
				id := itemIdentity{key, it.strict, it.restores}
				node := found[id]
				if node == nil {
					copy := *it
					copy.prod = key.prod
					copy.links = nil
					node = &copy
					found[id] = node
					out.index[node.itemKey] = node
					out.items = append(out.items, node)
					v.origins[node] = map[link][]restorationLink{}
				}
				v.items[it] = node
			}
			for _, s := range set.syms {
				if w := work.Load(); w != nil {
					w.visits.add("visits")
				}
				key := symKey{treeIdentity: s.treeIdentity, boundary: s.boundary, requested: s.items[0].prod.requestedKinds(), lexical: frame(s.lexical), option: s.option, rule: s.rule, origin: s.start, tags: s.tags.id, structure: s.structure, closes: project(s.closes), familySummary: s.familySummary}
				node := out.syms[key]
				if node == nil {
					copy := *s
					copy.lexical = key.lexical
					copy.items = nil
					node = &copy
					out.syms[key] = node
				}
				v.syms[s] = node
			}
		}
	}
	members := map[*symNode]map[*item]bool{}
	for _, set := range raw.sets {
		if set != nil {
			for _, s := range set.syms {
				node := v.syms[s]
				seen := members[node]
				if seen == nil {
					seen = map[*item]bool{}
					members[node] = seen
				}
				for _, it := range s.items {
					if w := work.Load(); w != nil {
						w.visits.add("visits")
					}
					child := v.items[it]
					if !seen[child] {
						node.items = append(node.items, child)
						seen[child] = true
					}
				}
			}
			for _, it := range set.items {
				node := v.items[it]
				table := v.origins[node]
				for _, e := range it.links {
					if w := work.Load(); w != nil {
						w.visits.add("visits")
					}
					edge := e
					edge.prev = v.items[e.prev]
					edge.sym = v.syms[e.sym]
					if _, found := table[edge]; !found {
						node.links = append(node.links, edge)
					}
					table[edge] = append(table[edge], restorationLink{it, e})
				}
			}
		}
	}
	return v
}

func capsParent(ids []int32, id int32) int32 {
	if id == 0 {
		return 0
	}
	return ids[id]
}

func (rk *ranker) restorationMarks(it *item) map[link]bool {
	if rk.restoration == nil {
		return rk.marks[it]
	}
	v := rk.restoration
	if out, ok := v.marked[it]; ok {
		return out
	}
	out := map[link]bool{}
	for edge, origins := range v.origins[it] {
		for _, origin := range origins {
			if w := work.Load(); w != nil {
				w.visits.add("visits")
			}
			if rk.marks[origin.item][origin.edge] {
				out[edge] = true
				break
			}
		}
	}
	v.marked[it] = out
	return out
}
