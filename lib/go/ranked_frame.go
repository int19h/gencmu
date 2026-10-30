package gencmu

import (
	"fmt"
	"sort"
	"strings"
)

// A frame retains written prefix values across generated helper boundaries.
type rankedFrame struct {
	id                 int32
	key                string
	captures           map[string]capVal
	present            map[string]bool
	knownPrivate       map[string]bool
	root               *production
	origin             int32
	prefix, sealPrefix int
	closes             int
	closeRoute         string
	sealCloses         int
	sealOrigin         int32
	sealGroup          *rankedGroup
	sealEntry          *rankedFrame
	inside             bool
}
type rankedProductionKey struct {
	p     *production
	frame *rankedFrame
}
type rankedPrediction struct {
	requested bool
	rule      int32
	frame     *rankedFrame
}

func rankedPrivateNames(e *domExpr) map[string]bool {
	out := map[string]bool{}
	var visit func(*domExpr)
	visit = func(e *domExpr) {
		if e == nil {
			return
		}
		if e.Kind == exCapture {
			out[e.Name] = true
		}
		for _, c := range e.Items {
			visit(c)
		}
		visit(e.Inner)
		visit(e.Sep)
	}
	visit(e)
	return out
}
func overlaps(a, b map[string]bool) bool {
	for n := range a {
		if b[n] {
			return true
		}
	}
	return false
}

// rankedCommonConditions is the conditions of the alternative being
// lowered that its production over body carries: not an item condition,
// which the helper of its braces carries (§3.6), and not one that reads a
// private capture of a ranked group inside the body.
func (lw *lowerer) rankedCommonConditions(body []slot, a *sAlt) []*domCond {
	if lw.g.ranked == nil || len(lw.g.ranked.groups) == 0 {
		return lw.altConds
	}
	names, seen := map[string]bool{}, map[int32]bool{}
	var helper func(int32)
	helper = func(rule int32) {
		if seen[rule] {
			return
		}
		seen[rule] = true
		h := lw.helperNodes[rule]
		if h == nil {
			return
		}
		if group := lw.g.ranked.expressions[h.path]; group != nil {
			for n := range rankedPrivateNames(group.expr) {
				names[n] = true
			}
		}
		for _, body := range h.bodies {
			for _, s := range body {
				if !s.sym.term {
					helper(s.sym.id)
				}
			}
		}
	}
	for _, s := range body {
		if !s.sym.term {
			helper(s.sym.id)
		}
	}
	if len(names) == 0 {
		return lw.altConds
	}
	list := []string{}
	for n := range names {
		list = append(list, n)
	}
	sort.Strings(list)
	key := fmt.Sprint(list)
	if lw.commonConds[a] == nil {
		lw.commonConds[a] = map[string][]*domCond{}
	}
	if old, ok := lw.commonConds[a][key]; ok {
		return old
	}
	out := []*domCond{}
	for _, c := range lw.altConds {
		reads := map[string]bool{}
		rankedCondReads(c, reads)
		if !overlaps(reads, names) {
			out = append(out, c)
		}
	}
	lw.commonConds[a][key] = out
	return out
}

// hasRanked says whether the stage has ranked groups.
func (g *lowered) hasRanked() bool {
	return g.stage.ranked != nil && len(g.stage.ranked.groups) > 0
}

// prepareRanked prepares the frames of the contextual helpers: those of
// ranked alternatives, and those of alternatives with item captures (§3.5,
// §4). A grammar with neither needs no frame.
func (g *lowered) prepareRanked() {
	contextual := false
	for _, p := range g.prods {
		if p.contextual {
			contextual = true
			break
		}
	}
	if !g.hasRanked() && !contextual {
		return
	}
	if g.hasRanked() {
		g.rankedHelpers = map[int32]*rankedGroup{}
		g.writtenHelpers = map[int32]string{}
		sources := map[*sAlt]bool{}
		for _, group := range g.stage.ranked.groups {
			sources[group.source] = true
		}
		for _, p := range g.prods {
			if p.ranked != nil {
				g.rankedHelpers[p.lhs] = p.ranked
			}
			if p.helper && p.slot != nil {
				g.writtenHelpers[p.lhs] = fmt.Sprintf("%s/%v/%s", p.ruleName, p.at, g.stage.ranked.paths[p.slot.path])
				p.contextual = p.contextual || sources[p.slot.source]
			}
		}
	}
	nested := func(p *production) map[string]bool {
		names, seen := map[string]bool{}, map[int32]bool{}
		pending := []int32{}
		for _, s := range p.rhs {
			if !s.term {
				pending = append(pending, s.id)
			}
		}
		for len(pending) > 0 {
			r := pending[len(pending)-1]
			pending = pending[:len(pending)-1]
			if seen[r] || !g.rules[r].helper {
				continue
			}
			seen[r] = true
			if group := g.rankedHelpers[r]; group != nil {
				for n := range rankedPrivateNames(group.expr) {
					names[n] = true
				}
			}
			for _, child := range g.rules[r].prods {
				for _, s := range child.rhs {
					if !s.term {
						pending = append(pending, s.id)
					}
				}
			}
		}
		return names
	}
	for _, p := range g.prods {
		if p.ranked != nil {
			own, inside := rankedPrivateNames(p.ranked.expr), nested(p)
			p.privateNames = map[string]bool{}
			for n := range own {
				if !inside[n] {
					p.privateNames[n] = true
				}
			}
		}
		declared, known := []string{}, []string{}
		for name := range p.slotOf {
			if name != "" {
				declared = append(declared, name)
			}
		}
		for name := range p.privateNames {
			known = append(known, name)
		}
		sort.Strings(declared)
		sort.Strings(known)
		p.rankedBindings = fmt.Sprintf("%q/%q", declared, known)
	}
	g.prepareRankedConditions()
}

// Follow finite capture contexts through active lowered helpers.
func (g *lowered) prepareRankedConditions() {
	type entry struct {
		rule  int32
		frame *rankedFrame
	}
	var pending []entry
	enter := func(p *production, f *rankedFrame) {
		present, known := map[string]bool{}, map[string]bool{}
		for n := range f.present {
			present[n] = true
		}
		for n := range p.slotOf {
			present[n] = true
		}
		for n := range f.knownPrivate {
			known[n] = true
		}
		for n := range p.privateNames {
			known[n] = true
		}
		for index, symbol := range p.rhs {
			if symbol.term {
				continue
			}
			prods := g.rules[symbol.id].prods
			if len(prods) == 0 || !prods[0].contextual {
				continue
			}
			captures := map[string]capVal{}
			for n := range f.captures {
				captures[n] = capVal{}
			}
			for n, at := range p.posOf {
				if at < index {
					captures[n] = capVal{}
				}
			}
			pending = append(pending, entry{symbol.id, &rankedFrame{present: present, captures: captures, knownPrivate: known}})
		}
	}
	for _, p := range g.prods {
		if !p.helper {
			enter(p, &rankedFrame{})
		}
	}
	seen := map[string]bool{}
	for at := 0; at < len(pending); at++ {
		e := pending[at]
		declared, ready, known := []string{}, []string{}, []string{}
		for n := range e.frame.present {
			declared = append(declared, n)
		}
		for n := range e.frame.captures {
			ready = append(ready, n)
		}
		for n := range e.frame.knownPrivate {
			known = append(known, n)
		}
		sort.Strings(declared)
		sort.Strings(ready)
		sort.Strings(known)
		key := fmt.Sprintf("%d/%q/%q/%q", e.rule, declared, ready, known)
		if seen[key] {
			continue
		}
		seen[key] = true
		for _, p := range g.rules[e.rule].prods {
			q := *p
			g.bindRankedConditions(&q, p, e.frame, firstBoundaryAtom)
			p.rankedConditions = append(p.rankedConditions, q.predictConds...)
			for _, c := range q.conds {
				p.rankedConditions = append(p.rankedConditions, c.cond)
			}
			enter(p, e.frame)
		}
	}
}
func (r *recognizer) rankedPrefix(it *item) string {
	p := it.prod
	symbols := []string{}
	for i, s := range p.rhs {
		role := fmt.Sprintf("N%d", s.id)
		if s.term {
			role = fmt.Sprintf("T%d", s.id)
		} else if path, ok := r.g.writtenHelpers[s.id]; ok {
			role = path
		}
		symbols = append(symbols, role+"/"+rankedTestKey(p.testAt(i)))
	}
	captures := []string{}
	caps := r.caps(&it.itemKey)
	for i := 0; i < int(it.dot); i++ {
		if n := p.capName[i]; n != "" && p.capSlot[i] >= 0 {
			cv := caps.at(p.capSlot[i])
			sequence := 0
			if r.closes != nil {
				sequence = r.closes.semantic(cv.closes)
			}
			captures = append(captures, fmt.Sprintf("%q/%d/%d/%d/%d/%d", n, cv.start, cv.end, cv.tags, cv.structure, sequence))
		}
	}
	lexical := ""
	if p.lexical != nil {
		lexical = p.lexical.key
	}
	path := ""
	if p.helper {
		path = r.g.writtenHelpers[p.lhs]
	}
	sequence := 0
	if r.closes != nil {
		sequence = r.closes.semantic(it.closes)
	}
	boundary := ""
	if r.boundaries != nil && it.boundary != nil {
		boundary = fmt.Sprintf("/b%d", it.boundary.id)
	}
	return boundary + fmt.Sprintf("%s/%v/%q/%q/%d/%d/%d/%d/%q/%q/%t/%s", p.ruleName, p.at, path, symbols, it.dot, it.origin, it.prefix, sequence, captures, lexical, it.restores, p.rankedBindings)
}

func (r *recognizer) closeEntryRoute(it *item) string {
	p := it.prod
	var out strings.Builder
	fmt.Fprintf(&out, "%q/%v/%q/", p.ruleName, p.at, r.g.writtenHelpers[p.lhs])
	for i, s := range p.rhs[:it.dot] {
		role := ""
		if s.term {
			role = r.g.terminals[s.id]
		} else if path, ok := r.g.writtenHelpers[s.id]; ok {
			role = path
		} else {
			role = r.g.rules[s.id].name
		}
		fmt.Fprintf(&out, "%t:%q:%q/", s.term, role, rankedTestKey(p.testAt(i)))
	}
	return out.String()
}
func (r *recognizer) rankedEntry(it *item, rule int32) *rankedFrame {
	p0 := r.g.rules[rule].prods
	if len(p0) == 0 || !p0[0].contextual {
		return nil
	}
	p, outer := it.prod, it.prod.lexical
	if outer != nil && p.lhs == rule {
		return outer
	}
	key := fmt.Sprintf("%s/%d/%d/%d", r.rankedPrefix(it), it.closes, it.cap0.closes, it.more)
	if r.rankedFrames == nil {
		r.rankedFrames = map[string]*rankedFrame{}
	}
	if old := r.rankedFrames[key]; old != nil {
		return old
	}
	f := &rankedFrame{id: int32(len(r.rankedFrames) + 1), key: key, captures: map[string]capVal{}, present: map[string]bool{}, knownPrivate: map[string]bool{}, root: p, origin: it.origin, prefix: it.prefix, sealPrefix: it.prefix, closes: it.closes}
	f.closeRoute = r.closeEntryRoute(it)
	if outer != nil {
		for n, c := range outer.captures {
			f.captures[n] = c
		}
		for n := range outer.knownPrivate {
			f.knownPrivate[n] = true
		}
		for n := range outer.present {
			f.present[n] = true
		}
		f.root, f.origin = outer.root, outer.origin
		f.closeRoute = outer.closeRoute + f.closeRoute
		// The pattern machine exists where a pattern or a ranked group
		// needs it; without it, a prefix is the item's own.
		if r.machine != nil {
			f.prefix = r.machine.concat(outer.prefix, it.prefix)
		}
		if r.observesCloses(p) {
			a, b := r.observed(f.origin, it.set)
			x, y := r.observed(outer.origin, it.origin)
			u, v := r.observed(it.origin, it.set)
			f.closes = r.closes.join(outer.closes, it.closes, x == a && y == b, u == a && v == b)
		}
	}
	for n := range p.privateNames {
		f.knownPrivate[n] = true
	}
	for n := range p.slotOf {
		if n != "" {
			f.present[n] = true
		}
	}
	caps := r.caps(&it.itemKey)
	for i := 0; i < int(it.dot); i++ {
		if n := p.capName[i]; n != "" && p.capSlot[i] >= 0 {
			f.captures[n] = caps.at(p.capSlot[i])
		}
	}
	f.inside = p.ranked != nil || outer != nil && outer.inside
	f.sealPrefix = f.prefix
	f.sealCloses, f.sealOrigin = f.closes, it.set
	f.sealGroup, f.sealEntry = r.g.rankedHelpers[rule], f
	if f.inside && outer != nil {
		f.sealPrefix = outer.sealPrefix
		if outer.sealGroup != nil {
			f.sealCloses, f.sealOrigin = outer.sealCloses, outer.sealOrigin
			f.sealGroup, f.sealEntry = outer.sealGroup, outer.sealEntry
		}
	}
	r.rankedFrames[key] = f
	return f
}

// Both target discovery and runtime frames reduce the same conditions.
func (g *lowered) bindRankedConditions(q, p *production, f *rankedFrame, atomOf func(*domCond) *domCond) map[string]bool {
	q.conds = nil
	q.condFrom = nil
	q.predictConds = nil
	q.boundaryOriginal = map[*domCond]*domCond{}
	has := func(n string) bool { _, local := p.slotOf[n]; return n == "" || local || f.present[n] }
	private := map[string]bool{}
	if g.hasRanked() && p.slot != nil {
		for _, group := range g.stage.ranked.groups {
			if group.source == p.slot.source {
				for n := range rankedPrivateNames(group.expr) {
					private[n] = true
				}
			}
		}
	}
	// The item conditions of the braces' alternative run in the helper,
	// with the enclosing item's captures from the frame (§3.6, §4). One
	// drops where the production lacks an item capture it uses, or the
	// frame an outer one.
	for _, raw := range p.itemConds {
		c, state := simplifyCond(raw, has)
		if state == alwaysTrue {
			continue
		}
		if state == alwaysFalse {
			c = &domCond{Kind: cdAny}
		}
		reads := map[string]bool{}
		rankedCondReads(c, reads)
		missing := false
		trigger := 0
		for n := range reads {
			if at, ok := p.posOf[n]; ok && n != "" {
				if at+1 > trigger {
					trigger = at + 1
				}
			} else if _, ready := f.captures[n]; !ready || n == "" {
				missing = true
				break
			}
		}
		if missing {
			continue
		}
		q.boundaryOriginal[c] = raw
		if trigger == 0 {
			q.predictConds = append(q.predictConds, c)
		} else {
			q.conds = append(q.conds, lcond{c, trigger, false})
		}
	}
	if p.ranked != nil {
		for _, raw := range p.slot.source.conds {
			// An item condition attaches to the helper of its braces, not
			// to a ranked group beside them (§3.6).
			if len(p.altItems) > 0 {
				reads := map[string]bool{}
				rankedCondReads(raw, reads)
				condMentions(raw, reads)
				if overlaps(reads, p.altItems) {
					continue
				}
			}
			if atom := atomOf(raw); atom != nil && atom.Span.Str != "" {
				if _, prefix := f.captures[atom.Span.Str]; prefix {
					continue
				}
			}
			reads := map[string]bool{}
			rankedCondReads(raw, reads)
			unknown := false
			for n := range reads {
				_, local := p.slotOf[n]
				_, prefix := f.captures[n]
				if private[n] && !local && !prefix && !f.knownPrivate[n] && !p.privateNames[n] {
					unknown = true
				}
			}
			if unknown {
				continue
			}
			c, state := simplifyCond(raw, has)
			if state == alwaysTrue {
				continue
			}
			if state == alwaysFalse {
				c = &domCond{Kind: cdAny}
			}
			reads = map[string]bool{}
			rankedCondReads(c, reads)
			missing := false
			trigger := 0
			for n := range reads {
				if !has(n) {
					missing = true
					break
				}
				if n == "" {
					if !p.ranked.final {
						missing = true
						break
					}
					trigger = len(p.rhs)
				} else if at, ok := p.posOf[n]; ok {
					if at+1 > trigger {
						trigger = at + 1
					}
				} else if _, ready := f.captures[n]; !ready {
					missing = true
					break
				}
			}
			if missing {
				continue
			}
			q.boundaryOriginal[c] = raw
			if trigger == 0 {
				q.predictConds = append(q.predictConds, c)
			} else {
				q.conds = append(q.conds, lcond{c, trigger, reads[""]})
			}
		}
	}
	if len(q.conds) > 0 {
		sort.SliceStable(q.conds, func(i, j int) bool { return q.conds[i].trigger < q.conds[j].trigger })
		q.condFrom = make([]int32, len(p.rhs)+2)
		for _, c := range q.conds {
			q.condFrom[c.trigger+1]++
		}
		for i := 1; i < len(q.condFrom); i++ {
			q.condFrom[i] += q.condFrom[i-1]
		}
	}
	return private
}

func (r *recognizer) rankedProduction(p *production, f *rankedFrame) *production {
	if f == nil {
		return p
	}
	if r.rankedProductions == nil {
		r.rankedProductions = map[rankedProductionKey]*production{}
	}
	key := rankedProductionKey{p, f}
	if old := r.rankedProductions[key]; old != nil {
		return old
	}
	q := *p
	q.base = p
	q.lexical = f
	atomOf := firstBoundaryAtom
	if r.boundaries != nil {
		atomOf = r.boundaries.first
	}
	private := r.g.bindRankedConditions(&q, p, f, atomOf)
	// The lazy $ of a helper in a ranked frame has the enclosing rule's
	// tags. A helper outside every ranked alternative reads no $: a frame
	// gives it the enclosing item's captures and nothing else.
	if r.g.hasRanked() && p.slot != nil {
		source := p.slot.source
		public := func(n string) bool { return n == "" || f.present[n] && !private[n] }
		tags := []*domTerm{}
		for _, term := range []*domTerm{source.alt.Tags, source.ruleTags} {
			if term != nil {
				tags = append(tags, simplifyTerm(term, public))
			}
		}
		if len(tags) == 1 {
			q.parentTags = tags[0]
		} else if len(tags) > 1 {
			q.parentTags = &domTerm{Kind: tmUnion, Items: tags}
		}
	}
	r.rankedProductions[key] = &q
	return &q
}
func (v *slotViews) rankedAncestry(scope *slotScope, r *recognizer) string {
	if scope == nil {
		return ""
	}
	parts := []string{}
	for _, frame := range scope.frames {
		before := frame.before
		if before == nil {
			copy := *frame.parent
			copy.dot = 0
			if r.boundaries != nil {
				copy.boundary = r.boundaries.empty
			}
			copy.prefix = r.machine.empty
			copy.more = 0
			copy.cap0 = capVal{}
			before = &copy
		}
		parts = append(parts, r.rankedPrefix(before)+fmt.Sprint(before.strict))
	}
	for _, bound := range scope.bounds {
		c := bound.carrier
		parts = append(parts, fmt.Sprintf("%s/%d/%d", r.g.writtenHelpers[c.rule], c.start, c.end))
	}
	return strings.Join(parts, "|")
}

func baseProduction(p *production) *production {
	if p.base != nil {
		return p.base
	}
	return p
}

// Prefix identities include every stacked predicate and signed requirement.
func rankedTestKey(t *symTest) string {
	var b strings.Builder
	for ; t != nil; t = t.other {
		fmt.Fprintf(&b, "%q:%q:[", t.op, t.sound)
		var last *resolvedRequirement
		for i, req := range t.requirements {
			if last != nil && *last == req {
				continue
			}
			fmt.Fprintf(&b, "%t:%q;", req.negated, req.name)
			last = &t.requirements[i]
		}
		b.WriteByte(']')
	}
	return b.String()
}
