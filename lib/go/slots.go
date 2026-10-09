package gencmu

import (
	"fmt"
)

type slotStatistics struct{ chartFacts, groups, candidateEdges, retainedEdges int }
type slotCandidate struct {
	item  *item
	index int
	label string
	group *slotGroup
}
type slotGroup struct {
	candidates []slotCandidate
	maxima     map[string]slotLabels
}
type slotLabels struct{ all, allowed map[string]bool }
type slotMask struct{ all, allowed map[int]bool }
type slotCount struct {
	all, allowed int
	w, allowedW  bool
}
type slotCountKey struct {
	it      *item
	sym     *symNode
	context string
	cut     bool
}
type slotAdmission struct {
	rk       *ranker
	groups   map[string]*slotGroup
	at       map[*item]map[int]*slotGroup
	masks    map[slotCountKey]slotMask
	counts   map[slotCountKey]slotCount
	contexts map[string]forbidden
	stats    slotStatistics
}

func newSlotAdmission(rk *ranker) *slotAdmission {
	a := &slotAdmission{rk: rk, groups: map[string]*slotGroup{}, at: map[*item]map[int]*slotGroup{}, masks: map[slotCountKey]slotMask{}, counts: map[slotCountKey]slotCount{}, contexts: map[string]forbidden{"": nil}}
	g := rk.rec.g
	prefs := g.stage.preferences
	for _, set := range rk.rec.sets {
		if set == nil {
			continue
		}
		for _, it := range set.index {
			a.stats.chartFacts++
			pos := int(it.dot) - 1
			if pos < 0 || pos >= len(it.prod.rhs) {
				continue
			}
			s := it.prod.rhs[pos]
			if s.term || g.rules[s.id].helper {
				continue
			}
			label := g.rules[s.id].name
			component, ok := prefs.labels[label]
			if !ok {
				continue
			}
			v := prefs.variants[label]
			role := "root"
			if path, ok := v.paths[it.prod.slot.path]; ok {
				role = path
			}
			var prefix []string
			for i, s := range it.prod.rhs[:pos] {
				prefix = append(prefix, slotSymbolRole(s, v, g)+"/"+slotTestKey(it.prod.testAt(i)))
			}
			for index, edge := range it.links {
				if edge.sym == nil {
					continue
				}
				state := rk.rec.machine.empty
				strict, restores := false, false
				var captures []string
				if edge.prev != nil {
					before := edge.prev
					state = before.prefix
					strict, restores = before.strict, before.restores
					caps := rk.rec.caps(&before.itemKey)
					for i := 0; i < int(before.dot); i++ {
						if slot := before.prod.capSlot[i]; slot >= 0 {
							n := before.prod.capName[i]
							r, ok := v.roles[n]
							if !ok {
								r = n
							}
							captures = append(captures, fmt.Sprintf("%q/%v", r, caps.at(slot)))
						}
					}
				}
				key := fmt.Sprintf("%d/%q/%q/%d/%d/%q/%t/%t/%d/%d", component, role, prefix, it.origin, state, captures, strict, restores, edge.sym.start, edge.sym.end)
				group := a.groups[key]
				if group == nil {
					group = &slotGroup{maxima: map[string]slotLabels{}}
					a.groups[key] = group
				}
				group.candidates = append(group.candidates, slotCandidate{it, index, label, group})
				if a.at[it] == nil {
					a.at[it] = map[int]*slotGroup{}
				}
				a.at[it][index] = group
				a.stats.candidateEdges++
			}
		}
	}
	a.stats.groups = len(a.groups)
	return a
}
func (a *slotAdmission) key(it *item, sym *symNode, f forbidden) slotCountKey {
	cut := sym != nil && f.has(sym.rule)
	if sym != nil {
		f = a.rk.restrict(f, sym.rule)
	} else {
		f = a.rk.restrict(f, it.prod.lhs)
	}
	context := f.key()
	a.contexts[context] = f
	return slotCountKey{it, sym, context, cut}
}
func (a *slotAdmission) edgeKeys(it *item, edge link, f forbidden) (slotCountKey, slotCountKey) {
	var prev, child slotCountKey
	if edge.prev != nil {
		pf := forbidden(nil)
		if edge.prev.set == it.set {
			pf = f
		}
		prev = a.key(edge.prev, nil, pf)
	}
	if edge.sym != nil {
		cf := forbidden(nil)
		if edge.sym.start == it.origin && edge.sym.end == it.set {
			cf = f
		}
		child = a.key(nil, edge.sym, cf)
	}
	return prev, child
}
func (a *slotAdmission) value(key slotCountKey) slotCount {
	if key.it == nil && key.sym == nil {
		return slotCount{all: 1, allowed: 1, w: true, allowedW: true}
	}
	return a.counts[key]
}
func (a *slotAdmission) availabilityKey(it *item, context string) string {
	parent := int32(-1)
	if int(it.dot) == len(it.prod.rhs) {
		parent = it.prod.lhs
	}
	return fmt.Sprintf("%s/%d", context, parent)
}
func (a *slotAdmission) dependencies(key slotCountKey) []slotCountKey {
	if key.cut {
		return nil
	}
	f := a.contexts[key.context]
	out := []slotCountKey{}
	if s := key.sym; s != nil {
		if a.rk.rec.g.rules[s.rule].scc >= 0 {
			f = f.with(s.rule)
		}
		for _, it := range s.items {
			out = append(out, a.key(it, nil, f))
		}
		return out
	}
	it := key.it
	if it.dot == 0 && !it.restores {
		return nil
	}
	for _, edge := range it.links {
		p, c := a.edgeKeys(it, edge, f)
		if p.it != nil {
			out = append(out, p)
		}
		if c.sym != nil {
			out = append(out, c)
		}
	}
	seen := map[*slotGroup]bool{}
	context := a.availabilityKey(it, key.context)
	for _, group := range a.at[it] {
		if seen[group] {
			continue
		}
		seen[group] = true
		if _, done := group.maxima[context]; done {
			continue
		}
		for _, candidate := range group.candidates {
			edge := candidate.item.links[candidate.index]
			p, c := a.edgeKeys(candidate.item, edge, f)
			if p.it != nil {
				out = append(out, p)
			}
			if c.sym != nil {
				out = append(out, c)
			}
		}
	}
	return out
}
func (a *slotAdmission) edgeCount(it *item, edge link, f forbidden) (slotCount, slotCount, bool) {
	p, c := a.edgeKeys(it, edge, f)
	left, right := a.value(p), a.value(c)
	mx := a.rk.maximal
	if edge.sym != nil && mx != nil && mx.elided(edge.sym.rule, edge.sym.start, edge.sym.end) {
		left.all, left.w = left.allowed, left.allowedW
	}
	allowed := true
	if mx != nil && mx.guards(it) && edge.sym != nil {
		allowed = !mx.forbids(edge.sym.rule, edge.sym.start, edge.sym.end, it.prod.testAt(int(it.dot)-1))
	}
	return left, right, allowed
}
func (a *slotAdmission) admit(key slotCountKey) {
	choices := a.at[key.it]
	if choices == nil {
		return
	}
	context := a.availabilityKey(key.it, key.context)
	f := a.contexts[key.context]
	mask := slotMask{map[int]bool{}, map[int]bool{}}
	for index, group := range choices {
		kept, ok := group.maxima[context]
		if !ok {
			present, allowed := map[string]bool{}, map[string]bool{}
			for _, candidate := range group.candidates {
				l, r, permit := a.edgeCount(candidate.item, candidate.item.links[candidate.index], f)
				if l.all > 0 && r.all > 0 {
					present[candidate.label] = true
					if permit {
						allowed[candidate.label] = true
					}
				}
			}
			maximal := func(labels map[string]bool) map[string]bool {
				out := map[string]bool{}
				for label := range labels {
					dominated := false
					for higher := range labels {
						dominated = dominated || a.rk.preferences.paths[higher][label] != nil
					}
					if !dominated {
						out[label] = true
					}
				}
				return out
			}
			kept = slotLabels{maximal(present), maximal(allowed)}
			group.maxima[context] = kept
		}
		label := a.rk.rec.g.rules[key.it.prod.rhs[int(key.it.dot)-1].id].name
		if kept.all[label] {
			mask.all[index] = true
		}
		if kept.allowed[label] {
			mask.allowed[index] = true
		}
	}
	a.masks[key] = mask
	a.stats.retainedEdges += len(mask.all)
}
func (a *slotAdmission) compute(key slotCountKey) slotCount {
	if key.cut {
		return slotCount{}
	}
	rk := a.rk
	if s := key.sym; s != nil {
		f := a.contexts[key.context]
		if rk.rec.g.rules[s.rule].scc >= 0 {
			f = f.with(s.rule)
		}
		var out slotCount
		for i, it := range s.items {
			if rk.skips("lost:context", "members", i, len(s.items)) {
				continue
			}
			v := a.value(a.key(it, nil, f))
			out.all = min(out.all+v.all, 2)
			out.w = out.w || v.w
		}
		out.allowed, out.allowedW = out.all, out.w
		return out
	}
	it := key.it
	if it.dot == 0 && !it.restores {
		_, w := rk.marks[it]
		return slotCount{1, 1, w, w}
	}
	if it.restores && rk.rec.run.ps.fault("rank-restoration") {
		return slotCount{}
	}
	a.admit(key)
	mask, filtered := a.masks[key]
	var out slotCount
	f := a.contexts[key.context]
	for index, edge := range it.links {
		if rk.skips("lost:context", "links", index, len(it.links)) {
			continue
		}
		l, r, permit := a.edgeCount(it, edge, f)
		ways := min(l.all*r.all, 2)
		w := rk.marks[it][edge] && (edge.prev == nil || l.w) && (edge.sym == nil || r.w)
		if !filtered || mask.all[index] {
			out.all = min(out.all+ways, 2)
			out.w = out.w || ways > 0 && w
		}
		if permit && (!filtered || mask.allowed[index]) {
			out.allowed = min(out.allowed+ways, 2)
			out.allowedW = out.allowedW || ways > 0 && w
		}
	}
	return out
}
func (a *slotAdmission) prepare(key slotCountKey) {
	type frame struct {
		key  slotCountKey
		deps []slotCountKey
		next int
	}
	if _, done := a.counts[key]; done {
		return
	}
	stack := []frame{{key: key, deps: a.dependencies(key)}}
	active := map[slotCountKey]bool{key: true}
	for len(stack) > 0 {
		fr := &stack[len(stack)-1]
		if fr.next < len(fr.deps) {
			dep := fr.deps[fr.next]
			fr.next++
			if _, done := a.counts[dep]; done {
				continue
			}
			if active[dep] {
				panic("gencmu: slot admission dependency repeats its cycle context")
			}
			active[dep] = true
			stack = append(stack, frame{key: dep, deps: a.dependencies(dep)})
			continue
		}
		done := fr.key
		value := a.compute(done)
		a.counts[done] = value
		delete(active, done)
		stack = stack[:len(stack)-1]
	}
}
func (a *slotAdmission) mask(it *item, f forbidden) (slotMask, bool) {
	if a.at[it] == nil {
		return slotMask{}, false
	}
	key := a.key(it, nil, f)
	a.prepare(key)
	mask, ok := a.masks[key]
	if !ok {
		panic("gencmu: a slot advance lacks admission")
	}
	return mask, true
}
func (a *slotAdmission) prepareRoots(top []*symNode) {
	for _, s := range top {
		a.prepare(a.key(nil, s, nil))
	}
}
func (a *slotAdmission) rawWitnessCounted(top []*symNode) bool {
	for _, s := range top {
		if a.value(a.key(nil, s, nil)).w {
			return true
		}
	}
	return false
}
