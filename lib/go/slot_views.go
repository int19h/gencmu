package gencmu

// A ranking view carries the written invocation through generated helpers.
// Recognition retains its original items and completion tables.
type slotFrame struct{ before, parent *item }
type slotScope struct {
	frames  []slotFrame
	bounds  []slotBound
	blocked bool
}
type slotBound struct {
	carrier    *symNode
	restricted bool
}
type slotScopeKey struct {
	before, parent *item
	carrier        *symNode
	outer          *slotScope
	restricted     bool
}
type slotItemKey struct {
	raw   *item
	scope *slotScope
}
type slotSymKey struct {
	raw   *symNode
	scope *slotScope
}
type slotViews struct {
	items      []*item
	plainItems map[*item]*item
	plainSyms  map[*symNode]*symNode
	itemScopes map[*item]*slotScope
	symScopes  map[*symNode]*slotScope
	originals  map[*item]*item
	indices    map[*item][]int
	routes     map[*item]slotMask
	marked     map[*item]map[link]bool
}

func newSlotViews(rk *ranker) *slotViews {
	g := rk.rec.g
	users := map[int32][]int32{}
	for _, p := range g.prods {
		if g.rules[p.lhs].helper {
			for _, s := range p.rhs {
				if !s.term {
					users[s.id] = append(users[s.id], p.lhs)
				}
			}
		}
	}
	wrapped := map[int32]bool{}
	pending := []int32{}
	for r := range g.rankedHelpers {
		wrapped[r] = true
		pending = append(pending, r)
	}
	for at := 0; at < len(pending); at++ {
		for _, r := range users[pending[at]] {
			if !wrapped[r] {
				wrapped[r] = true
				pending = append(pending, r)
			}
		}
	}
	if len(wrapped) == 0 {
		return nil
	}
	v := &slotViews{plainItems: map[*item]*item{}, plainSyms: map[*symNode]*symNode{}, itemScopes: map[*item]*slotScope{}, symScopes: map[*symNode]*slotScope{}, originals: map[*item]*item{}, indices: map[*item][]int{}, routes: map[*item]slotMask{}, marked: map[*item]map[link]bool{}}
	items := map[slotItemKey]*item{}
	syms := map[slotSymKey]*symNode{}
	scopes := map[slotScopeKey]*slotScope{}
	var itemView func(*item, *slotScope) *item
	var symView func(*symNode, *slotScope) *symNode
	itemView = func(raw *item, scope *slotScope) *item {
		if raw == nil {
			return nil
		}
		key := slotItemKey{raw, scope}
		if old := items[key]; old != nil {
			return old
		}
		copy := *raw
		copy.links = nil
		out := &copy
		items[key] = out
		v.items = append(v.items, out)
		v.originals[out] = raw
		v.itemScopes[out] = scope
		if scope == nil {
			v.plainItems[raw] = out
		}
		return out
	}
	symView = func(raw *symNode, scope *slotScope) *symNode {
		if raw == nil {
			return nil
		}
		key := slotSymKey{raw, scope}
		if old := syms[key]; old != nil {
			return old
		}
		copy := *raw
		copy.items = nil
		out := &copy
		syms[key] = out
		v.symScopes[out] = scope
		if scope == nil {
			v.plainSyms[raw] = out
		}
		for _, it := range raw.items {
			out.items = append(out.items, itemView(it, scope))
		}
		return out
	}
	scopeFor := func(parent *item, edge link, outer *slotScope, restricted, guarded bool) *slotScope {
		if outer != nil && parent.prod.lhs == edge.sym.rule {
			return outer
		}
		key := slotScopeKey{edge.prev, parent, edge.sym, outer, restricted}
		if old := scopes[key]; old != nil {
			return old
		}
		scope := &slotScope{}
		if outer != nil {
			scope.frames = append(scope.frames, outer.frames...)
			scope.bounds = append(scope.bounds, outer.bounds...)
			scope.blocked = outer.blocked
		}
		scope.frames = append(scope.frames, slotFrame{edge.prev, parent})
		scope.bounds = append(scope.bounds, slotBound{edge.sym, restricted})
		scope.blocked = scope.blocked || restricted && guarded && rk.maximal.forbidsIn(edge.sym.rule, edge.sym.start, edge.sym.end, parent.prod.testAt(int(parent.dot)-1), edge.sym.lexical)
		scopes[key] = scope
		return scope
	}
	for _, set := range rk.rec.sets {
		if set != nil {
			for _, raw := range set.index {
				itemView(raw, nil)
			}
			for _, raw := range set.syms {
				symView(raw, nil)
			}
		}
	}
	for at := 0; at < len(v.items); at++ {
		it := v.items[at]
		raw := v.originals[it]
		scope := v.itemScopes[it]
		mask := slotMask{map[int]bool{}, map[int]bool{}}
		routed := false
		appendEdge := func(edge link, index, channel int) {
			n := len(it.links)
			it.links = append(it.links, edge)
			v.indices[it] = append(v.indices[it], index)
			if channel != 1 {
				mask.all[n] = true
			}
			if channel != 0 {
				mask.allowed[n] = true
			}
		}
		for index, edge := range raw.links {
			prev := itemView(edge.prev, scope)
			if edge.sym == nil || !wrapped[edge.sym.rule] || g.rules[raw.prod.lhs].helper && scope == nil {
				copy := edge
				copy.prev = prev
				copy.sym = symView(edge.sym, nil)
				appendEdge(copy, index, 2)
				continue
			}
			guarded := rk.maximal != nil && rk.maximal.guards(raw)
			copy := edge
			copy.prev = prev
			copy.sym = symView(edge.sym, scopeFor(raw, edge, scope, false, guarded))
			channel := 2
			if guarded {
				channel = 0
			}
			appendEdge(copy, index, channel)
			if guarded {
				routed = true
				copy.sym = symView(edge.sym, scopeFor(raw, edge, scope, true, true))
				appendEdge(copy, index, 1)
			}
		}
		if routed {
			v.routes[it] = mask
		}
	}
	return v
}

func (rk *ranker) slotMarks(it *item) map[link]bool {
	if rk.marks == nil {
		return nil
	}
	if rk.views == nil {
		return rk.marks[it]
	}
	v := rk.views
	raw := v.originals[it]
	if raw == nil {
		return rk.marks[it]
	}
	if cached, ok := v.marked[it]; ok {
		return cached
	}
	original := rk.marks[raw]
	if original == nil {
		v.marked[it] = nil
		return nil
	}
	out := map[link]bool{}
	for index, edge := range it.links {
		if original[raw.links[v.indices[it][index]]] {
			out[edge] = true
		}
	}
	v.marked[it] = out
	return out
}
func (rk *ranker) slotContext(f forbidden, rule int32, scope *slotScope) forbidden {
	if scope == nil || !rk.rec.g.rules[rule].helper {
		return rk.restrict(f, rule)
	}
	var out forbidden
	for _, r := range f {
		if !rk.rec.g.rules[r].helper {
			out = append(out, r)
		}
	}
	return out
}
