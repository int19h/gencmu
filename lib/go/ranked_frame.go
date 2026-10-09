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
	root               *production
	origin             int32
	prefix, sealPrefix int
	inside             bool
}
type rankedProductionKey struct {
	p     *production
	frame *rankedFrame
}
type rankedPrediction struct {
	rule  int32
	frame *rankedFrame
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
func (lw *lowerer) rankedCommonConditions(body []slot, a *sAlt) []*domCond {
	if lw.g.ranked == nil || len(lw.g.ranked.groups) == 0 {
		return a.conds
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
		return a.conds
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
	for _, c := range a.conds {
		reads := map[string]bool{}
		rankedCondReads(c, reads)
		if !overlaps(reads, names) {
			out = append(out, c)
		}
	}
	lw.commonConds[a][key] = out
	return out
}
func (g *lowered) prepareRanked() {
	if g.stage.ranked == nil || len(g.stage.ranked.groups) == 0 {
		return
	}
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
			p.contextual = sources[p.slot.source]
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
			for _, c := range p.slot.source.conds {
				reads := map[string]bool{}
				rankedCondReads(c, reads)
				if overlaps(reads, own) && !overlaps(reads, inside) {
					p.privateConds = append(p.privateConds, c)
				}
			}
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
		symbols = append(symbols, role+"/"+slotTestKey(p.testAt(i)))
	}
	captures := []string{}
	caps := r.caps(&it.itemKey)
	for i := 0; i < int(it.dot); i++ {
		if n := p.capName[i]; n != "" && p.capSlot[i] >= 0 {
			captures = append(captures, fmt.Sprintf("%q/%v", n, caps.at(p.capSlot[i])))
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
	return fmt.Sprintf("%s/%v/%q/%q/%d/%d/%d/%q/%q/%t", p.ruleName, p.at, path, symbols, it.dot, it.origin, it.prefix, captures, lexical, it.restores)
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
	key := r.rankedPrefix(it)
	if r.rankedFrames == nil {
		r.rankedFrames = map[string]*rankedFrame{}
	}
	if old := r.rankedFrames[key]; old != nil {
		return old
	}
	f := &rankedFrame{id: int32(len(r.rankedFrames) + 1), key: key, captures: map[string]capVal{}, present: map[string]bool{}, root: p, origin: it.origin, prefix: it.prefix, sealPrefix: it.prefix}
	if outer != nil {
		for n, c := range outer.captures {
			f.captures[n] = c
		}
		for n := range outer.present {
			f.present[n] = true
		}
		f.root, f.origin = outer.root, outer.origin
		f.prefix = r.machine.concat(outer.prefix, it.prefix)
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
	if f.inside && outer != nil {
		f.sealPrefix = outer.sealPrefix
	}
	r.rankedFrames[key] = f
	return f
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
	q.conds = nil
	q.condFrom = nil
	q.predictConds = nil
	has := func(n string) bool { _, local := p.slotOf[n]; return n == "" || local || f.present[n] }
	for _, raw := range p.privateConds {
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
			if !has(n) {
				missing = true
				break
			}
			if n == "" {
				trigger = len(p.rhs)
			} else if at, ok := p.posOf[n]; ok && at+1 > trigger {
				trigger = at + 1
			}
		}
		if missing {
			continue
		}
		if trigger == 0 {
			q.predictConds = append(q.predictConds, c)
		} else {
			q.conds = append(q.conds, lcond{c, trigger, reads[""]})
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
	source := p.slot.source
	private := map[string]bool{}
	for _, group := range r.g.stage.ranked.groups {
		if group.source == source {
			for n := range rankedPrivateNames(group.expr) {
				private[n] = true
			}
		}
	}
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
			copy.prefix = r.machine.empty
			copy.more = 0
			copy.cap0 = capVal{}
			before = &copy
		}
		parts = append(parts, r.rankedPrefix(before)+fmt.Sprint(before.strict))
	}
	for _, bound := range scope.bounds {
		c := bound.carrier
		parts = append(parts, fmt.Sprintf("%s/%d/%d/%t", r.g.writtenHelpers[c.rule], c.start, c.end, bound.restricted))
	}
	return strings.Join(parts, "|")
}

func baseProduction(p *production) *production {
	if p.base != nil {
		return p.base
	}
	return p
}
