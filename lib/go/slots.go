package gencmu

import (
	"fmt"
)

type boundarySplit struct {
	Rule        string
	Alternative int
	Path, Entry string
	Start, End  int32
}
type slotStatistics struct {
	chartFacts, groups, candidateEdges, retainedEdges int
	boundarySplits                                    []boundarySplit
}
type slotCandidate struct {
	open  *boundaryRecord
	item  *item
	index int
	label string
	group *slotGroup
}
type slotGroup struct {
	split      boundarySplit
	reported   bool
	candidates []slotCandidate
	maxima     map[string]slotLabels
}
type slotChoice struct {
	item  *item
	index int
}
type slotLabels map[slotChoice]bool
type slotMask map[int]bool
type slotCount struct {
	measure diagnosticMeasure
	all     int
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
	var items []*item
	for _, set := range rk.rec.sets {
		if set == nil {
			continue
		}
		for _, it := range set.index {
			a.stats.chartFacts++
			items = append(items, it)
		}
	}
	if rk.views != nil {
		items = rk.views.items
	}
	for _, it := range items {
		var scope *slotScope
		if rk.views != nil {
			scope = rk.views.itemScopes[it]
		}
		if g.rules[it.prod.lhs].helper && it.prod.spliceTarget == nil && scope == nil {
			continue
		}
		pos := int(it.dot) - 1
		if pos < 0 || pos >= len(it.prod.rhs) {
			continue
		}
		s := it.prod.rhs[pos]
		if s.term {
			continue
		}

		groupInfo := g.rankedHelpers[s.id]
		if groupInfo == nil {
			continue
		}
		for index, edge := range it.links {
			if edge.sym == nil {
				continue
			}
			before := edge.prev
			if before == nil {
				copy := *it
				copy.dot = 0
				if rk.rec.trees != nil {
					copy.tree = nil
					rk.rec.finishTree(&copy.itemKey)
				}
				if rk.rec.boundaries != nil {
					copy.boundary = rk.rec.boundaries.empty
				}
				if rk.rec.machine != nil {
					copy.prefix = rk.rec.machine.empty
				}
				copy.cap0 = capVal{}
				copy.more = 0
				before = &copy
			}
			ancestry := ""
			if rk.views != nil {
				ancestry = rk.views.rankedAncestry(scope, rk.rec)
			}
			key := fmt.Sprintf("%d/%s/%t/%s/%d/%d", groupInfo.id, rk.rec.rankedPrefix(before), before.strict, ancestry, edge.sym.start, edge.sym.end)
			group := a.groups[key]
			if group == nil {
				group = &slotGroup{maxima: map[string]slotLabels{}, split: boundarySplit{groupInfo.parent, groupInfo.alternative, groupInfo.path, key, edge.sym.start, edge.sym.end}}
				a.groups[key] = group
			}
			label := fmt.Sprintf("%020d", edge.sym.option)
			var open *boundaryRecord
			if rk.rec.boundaries != nil {
				open = rk.rec.boundaries.open(before.boundary, edge.sym.boundary)
			}
			group.candidates = append(group.candidates, slotCandidate{open: open, item: it, index: index, label: label, group: group})
			if a.at[it] == nil {
				a.at[it] = map[int]*slotGroup{}
			}
			a.at[it][index] = group
			a.stats.candidateEdges++
		}
		continue

	}
	a.stats.groups = len(a.groups)
	return a
}
func (a *slotAdmission) key(it *item, sym *symNode, f forbidden) slotCountKey {
	var scope *slotScope
	if a.rk.views != nil {
		if sym != nil {
			scope = a.rk.views.symScopes[sym]
		} else {
			scope = a.rk.views.itemScopes[it]
		}
	}
	cut := sym != nil && f.has(a.rk.rec.g.cycleRule(sym.rule))
	if sym != nil {
		f = a.rk.slotContext(f, a.rk.rec.g.cycleRule(sym.rule), scope)
	} else {
		f = a.rk.slotContext(f, a.rk.rec.g.cycleRule(it.prod.lhs), scope)
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
		return slotCount{all: 1}
	}
	return a.counts[key]
}
func (a *slotAdmission) availabilityKey(it *item, context string) string {
	parent := int32(-1)
	if int(it.dot) == len(it.prod.rhs) {
		parent = it.prod.lhs
		if a.rk.views != nil {
			if scope := a.rk.views.itemScopes[it]; scope != nil {
				parent = scope.frames[0].parent.prod.lhs
			}
		}
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
		if a.rk.rec.g.rules[s.rule].scc >= 0 && (a.rk.views == nil || a.rk.views.symScopes[s] == nil) {
			f = f.with(a.rk.rec.g.cycleRule(s.rule))
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
func (a *slotAdmission) edgeCount(it *item, edge link, f forbidden) (slotCount, slotCount) {
	p, c := a.edgeKeys(it, edge, f)
	left, right := a.value(p), a.value(c)
	if edge.sym == nil {
		right.measure = a.rk.rec.carriedMeasure(edge.tok)
	}
	return left, right
}
func (a *slotAdmission) admit(key slotCountKey) {
	choices := a.at[key.it]
	if choices == nil {
		return
	}
	context := a.availabilityKey(key.it, key.context)
	f := a.contexts[key.context]
	mask := slotMask{}
	for index, group := range choices {
		kept, ok := group.maxima[context]
		if !ok {
			var viable []slotCandidate
			for _, candidate := range group.candidates {
				left, right := a.edgeCount(candidate.item, candidate.item.links[candidate.index], f)
				if left.all > 0 && right.all > 0 {
					viable = append(viable, candidate)
				}
			}
			kept = slotLabels{}
			split := false
			for _, proof := range viable {
				excluded, hasHigher := false, false
				for _, higher := range viable {
					if higher.label < proof.label {
						hl, hr := a.edgeCount(higher.item, higher.item.links[higher.index], f)
						pl, pr := a.edgeCount(proof.item, proof.item.links[proof.index], f)
						hasHigher = true
						if hl.measure.add(hr.measure).cmp(pl.measure.add(pr.measure)) <= 0 && boundaryDominates(higher.open, proof.open) {
							excluded = true
							break
						}
					}
				}
				if !excluded {
					kept[slotChoice{proof.item, proof.index}] = true
					split = split || hasHigher
				}
			}
			if split && !group.reported {
				group.reported = true
				a.stats.boundarySplits = append(a.stats.boundarySplits, group.split)
			}
			group.maxima[context] = kept
		}
		if kept[slotChoice{key.it, index}] {
			mask[index] = true
		}
	}
	a.masks[key] = mask
	a.stats.retainedEdges += len(mask)
}
func (a *slotAdmission) compute(key slotCountKey) slotCount {
	if key.cut {
		return slotCount{}
	}
	rk := a.rk
	if s := key.sym; s != nil {
		f := a.contexts[key.context]
		if rk.rec.g.rules[s.rule].scc >= 0 && (rk.views == nil || rk.views.symScopes[s] == nil) {
			f = f.with(a.rk.rec.g.cycleRule(s.rule))
		}
		var out slotCount
		for i, it := range s.items {
			if rk.skips("lost:context", "admission-members", i, len(s.items)) {
				continue
			}
			v := a.value(a.key(it, nil, f))
			if it.prod.error != nil {
				v.measure = v.measure.add(rk.rec.ownMeasure(it.origin, it.set))
			}
			if it.prod.nothing {
				v.measure = diagnosticMeasure{}
			}
			out.offer(v)
		}
		return out
	}
	it := key.it
	if it.dot == 0 && !it.restores {
		return slotCount{all: 1}
	}
	if it.restores && rk.rec.run.ps.faultAt("rank-restoration", "admission") {
		return slotCount{}
	}
	a.admit(key)
	mask, filtered := a.masks[key]
	var out slotCount
	f := a.contexts[key.context]
	for index, edge := range it.links {
		if rk.skips("lost:context", "admission-links", index, len(it.links)) {
			continue
		}
		l, r := a.edgeCount(it, edge, f)
		ways := min(l.all*r.all, 2)
		if !filtered || mask[index] {
			out.offer(slotCount{all: ways, measure: l.measure.add(r.measure)})
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

func (s *slotCount) offer(value slotCount) {
	if value.all == 0 {
		return
	}
	if s.all == 0 || value.measure.cmp(s.measure) < 0 {
		*s = value
	} else if value.measure.cmp(s.measure) == 0 {
		s.all = min(s.all+value.all, 2)
	}
}
