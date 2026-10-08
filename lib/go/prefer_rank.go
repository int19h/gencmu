package gencmu

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
)

type preferenceOccurrence struct {
	name       string
	start, end int32
}
type occurrenceCounts map[preferenceOccurrence]count
type preferenceElisions map[int32]count
type preferenceSignature struct {
	profile     ruleProfile
	occurrences occurrenceCounts
	elisions    preferenceElisions
	cands       []*cand
	count       int
	w           bool
}
type signatureSet map[string]*preferenceSignature
type signatureSummary struct{ all, allowed signatureSet }
type preferenceStatistics struct {
	slow                                                                    bool
	forestItems, forestEdges, contexts, signatures, largestSet, comparisons int
}
type preferenceReason struct {
	basis     string
	contests  []PreferenceContest
	directive string
	boundary  *int32
	counts    [2]string
	witness   *[2]action
}
type preferenceEdge struct {
	from, to int
	reason   preferenceReason
}

func decimalCount(n count) string { return n.bigValue().String() }
func sumPreferenceCounts[K comparable](a, b map[K]count) map[K]count {
	out := map[K]count{}
	for k, n := range a {
		out[k] = n
	}
	for k, n := range b {
		out[k] = out[k].add(n)
	}
	return out
}
func comparePreferenceElisions(a, b preferenceElisions) (int, *int32, [2]string) {
	seen := map[int32]bool{}
	for k := range a {
		seen[k] = true
	}
	for k := range b {
		seen[k] = true
	}
	keys := make([]int32, 0, len(seen))
	for k := range seen {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool { return keys[i] < keys[j] })
	for _, p := range keys {
		if c := a[p].cmp(b[p]); c != 0 {
			return c, &p, [2]string{decimalCount(a[p]), decimalCount(b[p])}
		}
	}
	return 0, nil, [2]string{}
}
func preferenceContests(p *preferences, a, b occurrenceCounts) PreferenceConflict {
	left, right := occurrenceCounts{}, occurrenceCounts{}
	keys := map[preferenceOccurrence]bool{}
	for k := range a {
		keys[k] = true
	}
	for k := range b {
		keys[k] = true
	}
	for k := range keys {
		switch c := a[k].cmp(b[k]); {
		case c > 0:
			left[k] = a[k].sub(b[k])
		case c < 0:
			right[k] = b[k].sub(a[k])
		}
	}
	out := PreferenceConflict{Forward: []PreferenceContest{}, Reverse: []PreferenceContest{}}
	contest := func(x, y preferenceOccurrence, xn, yn count, path []string) PreferenceContest {
		return PreferenceContest{[2]int{int(x.start), int(x.end)}, x.name, y.name, append([]string{}, path...), [2]string{decimalCount(xn), decimalCount(yn)}}
	}
	for x, xn := range left {
		for y, yn := range right {
			if x.start != y.start || x.end != y.end {
				continue
			}
			if path := p.paths[x.name][y.name]; path != nil {
				out.Forward = append(out.Forward, contest(x, y, xn, yn, path))
			}
			if path := p.paths[y.name][x.name]; path != nil {
				out.Reverse = append(out.Reverse, contest(y, x, yn, xn, path))
			}
		}
	}
	order := func(xs []PreferenceContest) {
		sort.Slice(xs, func(i, j int) bool {
			a, b := xs[i], xs[j]
			if a.Span[0] != b.Span[0] {
				return a.Span[0] < b.Span[0]
			}
			if a.Span[1] != b.Span[1] {
				return a.Span[1] < b.Span[1]
			}
			if a.Higher != b.Higher {
				return a.Higher < b.Higher
			}
			return a.Lower < b.Lower
		})
	}
	order(out.Forward)
	order(out.Reverse)
	return out
}

// reconstructionConflict describes the finalized diagnostic pair over original spans.
func (rk *ranker) reconstructionConflict(first, second *dn) *PreferenceConflict {
	if rk.preferences == nil || len(rk.preferences.paths) == 0 {
		return nil
	}
	occurrences := func(root *dn) occurrenceCounts {
		out := occurrenceCounts{}
		stack := []*dn{root}
		for len(stack) > 0 {
			n := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			if n == nil {
				continue
			}
			if n.kind == dClose && !n.prod.helper && rk.preferences.paths[n.prod.ruleName] != nil {
				p, q := rk.preferencePosition(n.start), rk.preferencePosition(n.end)
				if p < q {
					key := preferenceOccurrence{n.prod.ruleName, p, q}
					out[key] = out[key].add(countOne)
				}
			}
			stack = append(stack, n.a, n.b)
		}
		return out
	}
	c := preferenceContests(rk.preferences, occurrences(first), occurrences(second))
	if len(c.Forward) > 0 && len(c.Reverse) > 0 {
		return &c
	}
	return nil
}

func preferenceDirectedCycle(edges []map[int]preferenceReason) []int {
	done := map[int]bool{}
	type frame struct {
		vertex, next int
		targets      []int
	}
	targets := func(v int) []int {
		out := []int{}
		for k := range edges[v] {
			out = append(out, k)
		}
		sort.Ints(out)
		return out
	}
	for start := range edges {
		if done[start] {
			continue
		}
		stack := []frame{{vertex: start, targets: targets(start)}}
		active := map[int]int{start: 0}
		for len(stack) > 0 {
			f := &stack[len(stack)-1]
			if f.next == len(f.targets) {
				done[f.vertex] = true
				delete(active, f.vertex)
				stack = stack[:len(stack)-1]
				continue
			}
			next := f.targets[f.next]
			f.next++
			if at, ok := active[next]; ok {
				cycle := []int{}
				least := 0
				for _, f := range stack[at:] {
					cycle = append(cycle, f.vertex)
					if cycle[len(cycle)-1] < cycle[least] {
						least = len(cycle) - 1
					}
				}
				return append(append([]int{}, cycle[least:]...), cycle[:least]...)
			}
			if !done[next] {
				active[next] = len(stack)
				stack = append(stack, frame{vertex: next, targets: targets(next)})
			}
		}
	}
	return nil
}
func (rk *ranker) preferencePosition(p int32) int32 {
	if rc := rk.rec.recon; rc != nil {
		return int32(rc.project[p])
	}
	return p
}
func (rk *ranker) possiblePreferenceContest(top []*symNode) bool {
	items := map[*item]bool{}
	syms := map[*symNode]bool{}
	inventory := map[[2]int32]map[string]bool{}
	stack := append([]*symNode{}, top...)
	var body []*item
	possible := false
	for len(stack) > 0 || len(body) > 0 {
		if len(stack) > 0 {
			s := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			if syms[s] {
				continue
			}
			syms[s] = true
			rk.statistics.forestItems++
			r := rk.rec.g.rules[s.rule]
			p, q := rk.preferencePosition(s.start), rk.preferencePosition(s.end)
			if !r.helper && p < q && rk.preferences.paths[r.name] != nil {
				key := [2]int32{p, q}
				names := inventory[key]
				if names == nil {
					names = map[string]bool{}
					inventory[key] = names
				}
				for n := range names {
					if rk.preferences.paths[r.name][n] != nil || rk.preferences.paths[n][r.name] != nil {
						possible = true
					}
				}
				names[r.name] = true
			}
			body = append(body, s.items...)
			rk.statistics.forestEdges += len(s.items)
		} else {
			it := body[len(body)-1]
			body = body[:len(body)-1]
			if items[it] {
				continue
			}
			items[it] = true
			rk.statistics.forestItems++
			rk.statistics.forestEdges += len(it.links)
			for _, l := range it.links {
				if l.prev != nil {
					body = append(body, l.prev)
				}
				if l.sym != nil {
					stack = append(stack, l.sym)
				}
			}
		}
	}
	return possible
}
func forkPreferenceCands(xs []*cand) []*cand {
	out := make([]*cand, len(xs))
	for i, c := range xs {
		out[i] = c.fork()
	}
	return out
}
func (rk *ranker) preferenceSignatureKey(s *preferenceSignature) string {
	var b strings.Builder
	for _, span := range s.profile {
		fmt.Fprintf(&b, "l%d,%d=%s;", span.start, span.end, decimalCount(span.count))
	}
	keys := make([]preferenceOccurrence, 0, len(s.occurrences))
	for k := range s.occurrences {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		a, c := keys[i], keys[j]
		if a.name != c.name {
			return a.name < c.name
		}
		if a.start != c.start {
			return a.start < c.start
		}
		return a.end < c.end
	})
	for _, k := range keys {
		fmt.Fprintf(&b, "p%s,%d,%d=%s;", strconv.Quote(k.name), k.start, k.end, decimalCount(s.occurrences[k]))
	}
	if rk.stageLean == "late-elision" {
		ps := make([]int32, 0, len(s.elisions))
		for p := range s.elisions {
			ps = append(ps, p)
		}
		sort.Slice(ps, func(i, j int) bool { return ps[i] < ps[j] })
		for _, p := range ps {
			fmt.Fprintf(&b, "e%d=%s;", p, decimalCount(s.elisions[p]))
		}
	}
	if rk.stageLean == "greedy" || rk.stageLean == "lazy" {
		it := actionIter{}
		it.push(s.cands[0].d)
		for {
			e, ok := it.top()
			if !ok {
				break
			}
			if !isLeaf(e) {
				it.expand()
				continue
			}
			it.pop()
			a := elAction(e)
			if !a.visible() {
				continue
			}
			if a.read {
				fmt.Fprintf(&b, "r%d,%d;", a.tok, a.term)
			} else {
				fmt.Fprintf(&b, "c%d,%d,%d;", a.prod.num, a.start, a.end)
			}
		}
	}
	return b.String()
}
func (rk *ranker) storePreferenceSignature(set signatureSet, s *preferenceSignature) {
	key := rk.preferenceSignatureKey(s)
	if prev := set[key]; prev != nil {
		prev.count = min(2, prev.count+s.count)
		prev.w = prev.w || s.w
		prev.cands = rk.merge(append(prev.cands, forkPreferenceCands(s.cands)...))
		return
	}
	copy := *s
	copy.cands = forkPreferenceCands(s.cands)
	set[key] = &copy
}

// The node key keeps tag, capture, structural, and same-span cycle contexts.
type preferenceNode struct {
	it            *item
	sym           *symNode
	f             string
	read, blocked bool
	tok, term     int32
}
type preferenceLink struct {
	left, right preferenceNode
	source      link
}
type preferenceDependencies struct {
	links    []preferenceLink
	children []preferenceNode
}

func (rk *ranker) preferenceContext(f forbidden) string {
	key := f.key()
	rk.prefContexts[key] = f
	return key
}
func (rk *ranker) preferenceItem(it *item, f forbidden) preferenceNode {
	return preferenceNode{it: it, f: rk.preferenceContext(rk.restrict(f, it.prod.lhs))}
}
func (rk *ranker) preferenceSym(s *symNode, f forbidden) preferenceNode {
	if f.has(s.rule) {
		return preferenceNode{blocked: true}
	}
	return preferenceNode{sym: s, f: rk.preferenceContext(rk.restrict(f, s.rule))}
}
func (rk *ranker) preferenceDependencies(k preferenceNode) preferenceDependencies {
	f := rk.prefContexts[k.f]
	out := preferenceDependencies{}
	if s := k.sym; s != nil {
		inner := f
		if rk.rec.g.rules[s.rule].scc >= 0 {
			inner = f.with(s.rule)
		}
		for _, it := range s.items {
			out.children = append(out.children, rk.preferenceItem(it, inner))
		}
		return out
	}
	it := k.it
	if it == nil || it.dot == 0 && !it.restores {
		return out
	}
	for _, l := range it.links {
		left := preferenceNode{}
		if l.prev != nil {
			var pf forbidden
			if l.prev.set == it.set {
				pf = f
			}
			left = rk.preferenceItem(l.prev, pf)
		}
		right := preferenceNode{read: true, tok: l.tok, term: l.term}
		if l.sym != nil {
			var cf forbidden
			if l.sym.start == it.origin && l.sym.end == it.set {
				cf = f
			}
			right = rk.preferenceSym(l.sym, cf)
		}
		out.links = append(out.links, preferenceLink{left, right, l})
	}
	return out
}
func preferenceDependencyNodes(d preferenceDependencies) []preferenceNode {
	out := append([]preferenceNode{}, d.children...)
	for _, l := range d.links {
		out = append(out, l.left, l.right)
	}
	return out
}
func newSignatureSummary() signatureSummary { return signatureSummary{all: signatureSet{}} }
func (rk *ranker) computePreferenceSignatures(k preferenceNode, d preferenceDependencies, memo map[preferenceNode]signatureSummary) signatureSummary {
	out := newSignatureSummary()
	if k.blocked {
		return out
	}
	if s := k.sym; s != nil {
		rule := rk.rec.g.rules[s.rule]
		p, q := rk.preferencePosition(s.start), rk.preferencePosition(s.end)
		for i, dep := range d.children {
			if rk.skips("lost:select", "items", i, len(s.items)) {
				continue
			}
			it := s.items[i]
			for _, body := range memo[dep].all {
				v := *body
				v.cands = nil
				if !rule.helper && p < q {
					if rule.leftmostLongest {
						v.profile = sumProfiles(v.profile, ruleProfile{{p, q, countOne}})
					}
					if rk.preferences.paths[rule.name] != nil {
						v.occurrences = sumPreferenceCounts(body.occurrences, occurrenceCounts{{rule.name, p, q}: countOne})
					}
				}
				if rk.stageLean == "late-elision" && it.prod.restoration() && !it.restores {
					v.elisions = sumPreferenceCounts(body.elisions, preferenceElisions{s.start: countOne})
				}
				if rk.skips("lost:context", "items", i, len(s.items)) {
					v.count = 0
					v.w = false
				}
				for _, c := range body.cands {
					n := &cand{d: closeNode(it.prod, s.start, s.end, s.tags, c.d, s.structure)}
					rk.inherit(n, c, count{}, func(t *dn) *dn { return closeNode(it.prod, s.start, s.end, s.tags, t, s.structure) }, pastInf)
					v.cands = append(v.cands, n)
				}
				rk.storePreferenceSignature(out.all, &v)
			}
		}
		return out
	}
	it := k.it
	if k.read || it == nil || it.dot == 0 && !it.restores {
		var node *dn
		w := true
		if k.read {
			node = readNode(k.tok, k.term)
		} else if it != nil {
			_, w = rk.marks[it]
		}
		v := &preferenceSignature{occurrences: occurrenceCounts{}, elisions: preferenceElisions{}, cands: []*cand{{d: node}}, count: 1, w: w}
		rk.storePreferenceSignature(out.all, v)
		return out
	}
	if it.restores && rk.rec.run.ps.fault("rank-restoration") {
		return out
	}
	mx := rk.maximal
	guarded := mx != nil && mx.guards(it)
	if guarded {
		out.allowed = signatureSet{}
	}
	for i, dep := range d.links {
		if rk.skips("lost:select", "links", i, len(it.links)) {
			continue
		}
		l := dep.source
		left := memo[dep.left].all
		if mx != nil && l.sym != nil && mx.elided(l.sym.rule, l.sym.start, l.sym.end) && memo[dep.left].allowed != nil {
			left = memo[dep.left].allowed
		}
		permitted := !guarded || l.sym == nil || !mx.forbids(l.sym.rule, l.sym.start, l.sym.end, it.prod.testAt(int(it.dot)-1))
		for _, a := range left {
			for _, b := range memo[dep.right].all {
				v := &preferenceSignature{profile: sumProfiles(a.profile, b.profile), occurrences: sumPreferenceCounts(a.occurrences, b.occurrences), elisions: sumPreferenceCounts(a.elisions, b.elisions), cands: rk.extend(a.cands, b.cands, nil), count: min(2, a.count*b.count), w: rk.marks[it][l] && (l.prev == nil || a.w) && (l.sym == nil || b.w)}
				if rk.skips("lost:context", "links", i, len(it.links)) {
					v.count = 0
					v.w = false
				}
				rk.storePreferenceSignature(out.all, v)
				if guarded && permitted {
					rk.storePreferenceSignature(out.allowed, v)
				}
			}
		}
	}
	return out
}
func (rk *ranker) preferenceSignatures(roots []preferenceNode) map[preferenceNode]signatureSummary {
	memo := map[preferenceNode]signatureSummary{}
	active := map[preferenceNode]bool{}
	type frame struct {
		k    preferenceNode
		deps *preferenceDependencies
	}
	stack := []frame{}
	for _, k := range roots {
		stack = append(stack, frame{k: k})
	}
	for len(stack) > 0 {
		f := &stack[len(stack)-1]
		if _, ok := memo[f.k]; ok {
			stack = stack[:len(stack)-1]
			continue
		}
		if f.deps == nil {
			if active[f.k] {
				memo[f.k] = newSignatureSummary()
				stack = stack[:len(stack)-1]
				continue
			}
			active[f.k] = true
			deps := rk.preferenceDependencies(f.k)
			f.deps = &deps
			for _, dep := range preferenceDependencyNodes(deps) {
				if _, ok := memo[dep]; !ok {
					stack = append(stack, frame{k: dep})
				}
			}
			continue
		}
		result := rk.computePreferenceSignatures(f.k, *f.deps, memo)
		memo[f.k] = result
		delete(active, f.k)
		rk.statistics.contexts++
		rk.statistics.signatures += len(result.all)
		rk.statistics.largestSet = max(rk.statistics.largestSet, len(result.all), len(result.allowed))
		stack = stack[:len(stack)-1]
	}
	return memo
}
func (rk *ranker) preferenceCanonical(s *preferenceSignature) *cand {
	return rk.finish(rk.merge(forkPreferenceCands(s.cands)))
}
func (rk *ranker) preferenceTotalOrder(a, b *dn) int {
	r := rk.compare(a, b)
	if r.kind == cIdentical {
		return 0
	}
	if rk.aFirst(r) {
		return -1
	}
	return 1
}
func (rk *ranker) comparePreferenceSignatures(a, b *preferenceSignature, ac, bc *cand) (int, *preferenceReason) {
	c := preferenceContests(rk.preferences, a.occurrences, b.occurrences)
	switch {
	case len(c.Forward) > 0 && len(c.Reverse) > 0:
		return 0, nil
	case len(c.Forward) > 0:
		return -1, &preferenceReason{basis: "prefer", contests: c.Forward}
	case len(c.Reverse) > 0:
		return 1, nil
	}
	if rk.stageLean == "late-elision" {
		order, boundary, counts := comparePreferenceElisions(a.elisions, b.elisions)
		if order == 0 {
			return 0, nil
		}
		return order, &preferenceReason{basis: "stage", directive: "late-elision", boundary: boundary, counts: counts}
	}
	r := rk.compare(ac.d, bc.d)
	if r.kind != cVisDiff || r.outcome == oTie {
		return 0, nil
	}
	order := 1
	if r.outcome == oA {
		order = -1
	}
	return order, &preferenceReason{basis: "stage", directive: rk.stageLean, witness: &[2]action{r.va, r.vb}}
}
func (rk *ranker) rankPreferences(top []*symNode) *rankResult {
	rk.statistics.slow = true
	rk.prefContexts = map[string]forbidden{}
	roots := []preferenceNode{}
	for _, s := range top {
		roots = append(roots, rk.preferenceSym(s, nil))
	}
	memo := rk.preferenceSignatures(roots)
	root := signatureSet{}
	for _, k := range roots {
		for _, s := range memo[k].all {
			rk.storePreferenceSignature(root, s)
		}
	}
	rk.statistics.contexts++
	rk.statistics.signatures += len(root)
	rk.statistics.largestSet = max(rk.statistics.largestSet, len(root))
	total := 0
	counted := false
	var profile ruleProfile
	set := false
	for _, s := range root {
		total = min(2, total+s.count)
		counted = counted || s.w
		if !set || compareProfiles(s.profile, profile) < 0 {
			profile = s.profile
			set = true
		}
	}
	if total == 0 || len(root) == 0 {
		return nil
	}
	type representative struct {
		s *preferenceSignature
		c *cand
	}
	best := []representative{}
	for _, s := range root {
		if compareProfiles(s.profile, profile) == 0 {
			best = append(best, representative{s, rk.preferenceCanonical(s)})
		}
	}
	sort.Slice(best, func(i, j int) bool {
		a, b := best[i], best[j]
		if rk.stageLean == "late-elision" {
			if order, _, _ := comparePreferenceElisions(a.s.elisions, b.s.elisions); order != 0 {
				return order < 0
			}
		}
		return rk.preferenceTotalOrder(a.c.d, b.c.d) < 0
	})
	edges := make([]map[int]preferenceReason, len(best))
	incoming := make([]bool, len(best))
	for i := range edges {
		edges[i] = map[int]preferenceReason{}
	}
	for i, a := range best {
		for j := i + 1; j < len(best); j++ {
			rk.statistics.comparisons++
			b := best[j]
			order, reason := rk.comparePreferenceSignatures(a.s, b.s, a.c, b.c)
			if order == 0 {
				continue
			}
			from, to := i, j
			if order > 0 {
				from, to = j, i
				_, reason = rk.comparePreferenceSignatures(b.s, a.s, b.c, a.c)
			}
			edges[from][to] = *reason
			incoming[to] = true
		}
	}
	res := &rankResult{slow: true, profile: profile, witnessCounted: rk.marks != nil && counted}
	if cycle := preferenceDirectedCycle(edges); cycle != nil {
		res.verdict = VerdictTie
		for i, v := range cycle {
			res.readings = append(res.readings, best[v].c.d)
			res.cycle = append(res.cycle, preferenceEdge{i, (i + 1) % len(cycle), edges[v][cycle[(i+1)%len(cycle)]]})
		}
		res.first = res.readings[0]
		return res
	}
	survivors := []representative{}
	for i, s := range best {
		if !incoming[i] {
			survivors = append(survivors, s)
		}
	}
	res.first = survivors[0].c.d
	type alternative struct {
		d *dn
		s *preferenceSignature
	}
	alts := []alternative{}
	for i, s := range survivors {
		if i > 0 {
			alts = append(alts, alternative{s.c.d, s.s})
		}
		for _, d := range s.c.tied.ds {
			alts = append(alts, alternative{d, s.s})
		}
	}
	divergence := func(d *dn) count {
		r := rk.compare(res.first, d)
		if r.kind == cVisDiff || r.kind == cAPrefix || r.kind == cBPrefix {
			return r.pos
		}
		return inf
	}
	sort.Slice(alts, func(i, j int) bool {
		a, b := alts[i], alts[j]
		if c := divergence(a.d).cmp(divergence(b.d)); c != 0 {
			return c < 0
		}
		if rk.stageLean == "late-elision" {
			if c, _, _ := comparePreferenceElisions(a.s.elisions, b.s.elisions); c != 0 {
				return c < 0
			}
		}
		return rk.preferenceTotalOrder(a.d, b.d) < 0
	})
	if len(alts) == 0 {
		res.verdict = VerdictResolved
		if total == 1 {
			res.verdict = VerdictUnique
		}
		return res
	}
	res.verdict = VerdictTie
	res.second = alts[0].d
	r := rk.compare(res.first, res.second)
	if r.kind == cVisDiff {
		res.witness = [2]action{r.va, r.vb}
	} else {
		res.witness = [2]action{r.wa, r.wb}
	}
	c := preferenceContests(rk.preferences, survivors[0].s.occurrences, alts[0].s.occurrences)
	if len(c.Forward) > 0 && len(c.Reverse) > 0 {
		res.conflict = &c
	}
	return res
}
