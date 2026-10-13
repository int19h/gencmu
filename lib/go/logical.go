package gencmu

import (
	"fmt"
	"sort"
	"strings"
)

type logicalGroup struct {
	expression *domExpr
	start, end int
}

func logicalGroupsOf(body []slot) []logicalGroup {
	var groups []logicalGroup
	var stack []int
	position := 0
	for _, s := range body {
		switch s.logicalMark {
		case 1:
			stack = append(stack, len(groups))
			groups = append(groups, logicalGroup{expression: s.logicalExpr, start: position})
		case -1:
			index := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			groups[index].end = position
		default:
			position++
		}
	}
	return groups
}

func (p *production) precedingLogicalOptional(dot int) *logicalGroup {
	for i := range p.logicalGroups {
		g := &p.logicalGroups[i]
		if g.end == dot {
			return g
		}
	}
	return nil
}

// logicalPriority joins physical optional routes at their fixed prefix.
// A later written route can forbid an earlier omission even when that
// route never completes its named rule (engine §4).
type logicalPrefixKey struct {
	alternative      *sAlt
	expression       *domExpr
	parent           *domExpr
	rule             int32
	origin, position int32
	prefix, closes   int
	lexical          *rankedFrame
	requested        bool
	captures         string
}

type logicalPrefixSearch struct {
	item *item
	dot  int32
}
type logicalPriority struct {
	r       *recognizer
	further map[logicalPrefixKey]int32
	memo    map[logicalPrefixSearch][]*item
}

func newLogicalPriority(r *recognizer, reads map[*item]bool) *logicalPriority {
	l := &logicalPriority{r: r, further: map[logicalPrefixKey]int32{}, memo: map[logicalPrefixSearch][]*item{}}
	for it := range reads {
		if it.prod.precedingLogicalOptional(int(it.dot)) == nil {
			continue
		}
		for _, prefix := range l.prefixes(it) {
			key := l.key(it, prefix)
			if end, exists := l.further[key]; !exists || end < it.set {
				l.further[key] = it.set
			}
		}
	}
	return l
}

func (l *logicalPriority) prefixes(it *item) []*item {
	g := it.prod.precedingLogicalOptional(int(it.dot))
	if g == nil {
		return nil
	}
	key := logicalPrefixSearch{item: it, dot: int32(g.start)}
	if result, ok := l.memo[key]; ok {
		return result
	}
	var result []*item
	seen := map[*item]bool{}
	stack := []*item{it}
	for len(stack) > 0 {
		p := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if seen[p] {
			continue
		}
		seen[p] = true
		if p.dot == key.dot {
			result = append(result, p)
			continue
		}
		for _, link := range p.links {
			stack = append(stack, l.r.before(p, link))
		}
	}
	l.memo[key] = result
	return result
}

func (l *logicalPriority) key(it, prefix *item) logicalPrefixKey {
	g := it.prod.precedingLogicalOptional(int(it.dot))
	var names []string
	for name, position := range prefix.prod.posOf {
		if position < int(prefix.dot) {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	var captures strings.Builder
	for _, name := range names {
		c := l.r.caps(&prefix.itemKey).at(prefix.prod.slotOf[name])
		fmt.Fprintf(&captures, "%d:%s/%d/%d/%d/%d/%d;", len(name), name, c.start, c.end, c.tags, c.structure, c.closes)
	}
	// Split helpers of a logical parent share its written site. Named rules
	// retain their rule identity. Both keep the proof's own prefix observations.
	rule := it.prod.lhs
	parent := it.prod.helperExpression
	if parent != nil {
		rule = -1
	}
	return logicalPrefixKey{alternative: it.prod.sourceAlternative, expression: g.expression, parent: parent, rule: rule, origin: it.origin, position: prefix.set, prefix: prefix.prefix, closes: prefix.closes, lexical: it.prod.lexical, requested: it.prod.closeRequested, captures: captures.String()}
}

func (l *logicalPriority) permits(it, prefix *item) bool {
	end, exists := l.further[l.key(it, prefix)]
	return !exists || end < it.set
}

// permitsEligible follows only eligible advances from a candidate to its
// own fixed prefix. Blocker discovery still uses prefixes on the raw chart.
// E/P grow during the fixed point, so these filtered paths are not memoized.
func (l *logicalPriority) permitsEligible(it *item, advance func(*item, link) bool) bool {
	g := it.prod.precedingLogicalOptional(int(it.dot))
	seen := map[*item]bool{}
	stack := []*item{it}
	for len(stack) > 0 {
		p := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if seen[p] {
			continue
		}
		seen[p] = true
		if int(p.dot) == g.start {
			if l.permits(it, p) {
				return true
			}
			continue
		}
		for _, edge := range p.links {
			if advance(p, edge) {
				stack = append(stack, l.r.before(p, edge))
			}
		}
	}
	return false
}

// logicalBody keeps optional helper structure after capture expansion.
// Markers affect inheritance and visible closes, but consume no symbol.
func logicalBody(body []slot) ([]slot, int, int) {
	type group struct{ count, inherit int }
	stack := []group{{inherit: -1}}
	physical := make([]slot, 0, len(body))
	add := func(index int) {
		g := &stack[len(stack)-1]
		g.count++
		if g.count == 1 {
			g.inherit = index
		} else {
			g.inherit = -1
		}
	}
	for _, s := range body {
		switch s.logicalMark {
		case 1:
			stack = append(stack, group{inherit: -1})
		case -1:
			g := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			add(g.inherit)
		default:
			add(len(physical))
			physical = append(physical, s)
		}
	}
	return physical, stack[0].count, stack[0].inherit
}
