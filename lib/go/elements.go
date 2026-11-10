package gencmu

import (
	"fmt"
	"sort"
	"strings"
)

type elementGroup struct {
	expression *domExpr
	start, end int
}

func elementGroupsOf(body []slot) []elementGroup {
	var groups []elementGroup
	var stack []int
	position := 0
	for _, s := range body {
		switch s.elementMark {
		case 1:
			stack = append(stack, len(groups))
			groups = append(groups, elementGroup{expression: s.elementExpr, start: position})
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

func (p *production) precedingElementOptional(dot int) *elementGroup {
	for i := range p.elementGroups {
		g := &p.elementGroups[i]
		if g.end == dot {
			return g
		}
	}
	return nil
}

// elementPriority joins physical optional routes at their fixed prefix.
// A later written route can forbid an earlier omission even when that
// route never completes its named rule (engine §4).
type elementPrefixKey struct {
	treePrefix       int
	treeRequested    bool
	boundary         *boundaryRecord
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

type elementPrefixSearch struct {
	item *item
	dot  int32
}
type elementPriority struct {
	r       *recognizer
	further map[elementPrefixKey]int32
	memo    map[elementPrefixSearch][]*item
}

func newElementPriority(r *recognizer, reads map[*item]bool) *elementPriority {
	l := &elementPriority{r: r, further: map[elementPrefixKey]int32{}, memo: map[elementPrefixSearch][]*item{}}
	for it := range reads {
		if it.prod.precedingElementOptional(int(it.dot)) == nil {
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

func (l *elementPriority) prefixes(it *item) []*item {
	g := it.prod.precedingElementOptional(int(it.dot))
	if g == nil {
		return nil
	}
	key := elementPrefixSearch{item: it, dot: int32(g.start)}
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

func (l *elementPriority) key(it, prefix *item) elementPrefixKey {
	g := it.prod.precedingElementOptional(int(it.dot))
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
		if l.r.trees != nil {
			fmt.Fprintf(&captures, "t%d/", c.tree)
		}
	}
	// Split helpers of a element parent share its written site. Named rules
	// retain their rule identity. Both keep the proof's own prefix observations.
	rule := it.prod.lhs
	parent := it.prod.helperExpression
	if parent != nil {
		rule = -1
	}
	treePrefix := 0
	if prefix.tree != nil {
		treePrefix = prefix.tree.prefix
	}
	return elementPrefixKey{treePrefix: treePrefix, treeRequested: it.prod.treeRequested, boundary: prefix.boundary, alternative: it.prod.sourceAlternative, expression: g.expression, parent: parent, rule: rule, origin: it.origin, position: prefix.set, prefix: prefix.prefix, closes: prefix.closes, lexical: it.prod.lexical, requested: it.prod.closeRequested, captures: captures.String()}
}

func (l *elementPriority) permits(it, prefix *item) bool {
	end, exists := l.further[l.key(it, prefix)]
	return !exists || end < it.set
}

// permitsEligible follows only eligible advances from a candidate to its
// own fixed prefix. Blocker discovery still uses prefixes on the raw chart.
// E/P grow during the fixed point, so these filtered paths are not memoized.
func (l *elementPriority) permitsEligible(it *item, bit uint8, state func(*item) uint8, predecessors func(*item, link, uint8) uint8) bool {
	g := it.prod.precedingElementOptional(int(it.dot))
	type proof struct {
		item *item
		bit  uint8
	}
	seen := map[proof]bool{}
	stack := []proof{{it, bit}}
	for len(stack) > 0 {
		current := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if seen[current] || state(current.item)&current.bit == 0 {
			continue
		}
		seen[current] = true
		p := current.item
		if int(p.dot) == g.start {
			if l.permits(it, p) {
				return true
			}
			continue
		}
		for _, edge := range p.links {
			allowed := predecessors(p, edge, current.bit)
			for _, before := range []uint8{1, 2} {
				if allowed&before != 0 {
					stack = append(stack, proof{l.r.before(p, edge), before})
				}
			}
		}
	}
	return false
}

// elementBody keeps optional helper structure after capture expansion.
// Markers affect inheritance and visible closes, but consume no symbol.
func elementBody(body []slot) ([]slot, int, int) {
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
		switch s.elementMark {
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
