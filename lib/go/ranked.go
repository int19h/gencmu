package gencmu

import (
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// Ranked groups retain written identities independently of generated helpers.
type rankedGroup struct {
	id, alternative int
	parent, path    string
	expr            *domExpr
	source          *sAlt
	final           bool
}
type rankedGroups struct {
	groups               []*rankedGroup
	expressions          map[*domExpr]*rankedGroup
	owners               map[*domExpr]*rankedGroup
	paths                map[*domExpr]string
	sourceSites          map[*sAlt]GroupSite
	analyses             map[*sAlt]*rankedClauseAnalysis
	productive, nonempty map[string]bool
}
type rankedClauseAnalysis struct {
	conditions  []map[string]bool
	exports     map[string]bool
	projections map[string][]rankedRoute
}
type rankedSpan struct{ productive, nonempty bool }

func rankedJoinSpans(a, b rankedSpan) rankedSpan {
	productive := a.productive && b.productive
	return rankedSpan{productive, productive && (a.nonempty || b.nonempty)}
}

type rankedCapture struct {
	owner *rankedGroup
	at    int
}
type rankedEnd struct {
	at, option int
	start      rankedSpan
}

// Route positions count relevant capture closes, independently of other symbols.
type rankedRoute struct {
	span     rankedSpan
	bindings map[string]*rankedGroup
	length   int
	captures map[string]rankedCapture
	ends     map[*rankedGroup]rankedEnd
}

func rankedEmptyRoute() rankedRoute {
	return rankedRoute{span: rankedSpan{productive: true}, bindings: map[string]*rankedGroup{}, captures: map[string]rankedCapture{}, ends: map[*rankedGroup]rankedEnd{}}
}
func rankedJoin(left, right rankedRoute) rankedRoute {
	out := rankedEmptyRoute()
	out.length, out.span = left.length+right.length, rankedJoinSpans(left.span, right.span)
	for name, group := range left.bindings {
		out.bindings[name] = group
	}
	for name, group := range right.bindings {
		out.bindings[name] = group
	}
	for name, capture := range left.captures {
		out.captures[name] = capture
	}
	for name, capture := range right.captures {
		capture.at += left.length
		out.captures[name] = capture
	}
	for group, end := range left.ends {
		out.ends[group] = end
	}
	for group, end := range right.ends {
		end.at += left.length
		end.start = rankedJoinSpans(left.span, end.start)
		out.ends[group] = end
	}
	return out
}
func rankedRouteKey(route rankedRoute) string {
	var key strings.Builder
	fmt.Fprintf(&key, "%d:%t:%t;", route.length, route.span.productive, route.span.nonempty)
	names := []string{}
	for name := range route.captures {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		capture := route.captures[name]
		owner := -1
		if capture.owner != nil {
			owner = capture.owner.id
		}
		fmt.Fprintf(&key, "c%s:%d:%d;", name, owner, capture.at)
	}
	groups := []*rankedGroup{}
	for group := range route.ends {
		groups = append(groups, group)
	}
	sort.Slice(groups, func(i, j int) bool { return groups[i].id < groups[j].id })
	for _, group := range groups {
		end := route.ends[group]
		fmt.Fprintf(&key, "g%d:%d:%d:%t:%t;", group.id, end.at, end.option, end.start.productive, end.start.nonempty)
	}
	names = names[:0]
	for name := range route.bindings {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		fmt.Fprintf(&key, "b%s:%d;", name, route.bindings[name].id)
	}
	return key.String()
}
func rankedUnique(routes []rankedRoute) []rankedRoute {
	seen, out := map[string]bool{}, []rankedRoute{}
	for _, route := range routes {
		key := rankedRouteKey(route)
		if !seen[key] {
			seen[key] = true
			out = append(out, route)
		}
	}
	return out
}
func rankedProduct(left, right []rankedRoute) []rankedRoute {
	seen, out := map[string]bool{}, []rankedRoute{}
	for _, a := range left {
		for _, b := range right {
			route := rankedJoin(a, b)
			key := rankedRouteKey(route)
			if !seen[key] {
				seen[key] = true
				out = append(out, route)
			}
		}
	}
	return out
}
func (r *rankedGroups) routes(g *stageGrammar, expr *domExpr, needed map[string]bool) []rankedRoute {
	visit := func(child *domExpr) []rankedRoute { return r.routes(g, child, needed) }
	switch expr.Kind {
	case exEmpty:
		return []rankedRoute{rankedEmptyRoute()}
	case exSeq:
		out := []rankedRoute{rankedEmptyRoute()}
		for _, child := range expr.Items {
			out = rankedProduct(out, visit(child))
		}
		return out
	case exChoice:
		out := []rankedRoute{}
		for _, child := range expr.Items {
			out = append(out, visit(child)...)
		}
		return rankedUnique(out)
	case exRanked:
		out, group := []rankedRoute{}, r.expressions[expr]
		names := rankedPrivateNames(expr)
		for name := range names {
			if !needed[name] {
				delete(names, name)
			}
		}
		for option, child := range expr.Items {
			for _, route := range visit(child) {
				if len(names) > 0 {
					for name := range names {
						if route.bindings[name] == nil {
							route.bindings[name] = group
						}
					}
					route.ends[group] = rankedEnd{at: route.length, option: option, start: rankedSpan{productive: true}}
				}
				out = append(out, route)
			}
		}
		return rankedUnique(out)
	case exAnd:
		type selected struct {
			mask  int
			order []int
			route rankedRoute
		}
		states := []selected{{route: rankedEmptyRoute()}}
		for bit, child := range expr.Items {
			parts, candidates := visit(child), append([]selected{}, states...)
			for _, state := range states {
				for index, part := range parts {
					order := append(append([]int{}, state.order...), index)
					candidates = append(candidates, selected{state.mask | (1 << bit), order, rankedJoin(state.route, part)})
				}
			}
			sort.SliceStable(candidates, func(i, j int) bool {
				a, b := candidates[i], candidates[j]
				if a.mask != b.mask {
					return a.mask < b.mask
				}
				for k := 0; k < len(a.order) && k < len(b.order); k++ {
					if a.order[k] != b.order[k] {
						return a.order[k] < b.order[k]
					}
				}
				return len(a.order) < len(b.order)
			})
			states = nil
			seen := map[string]bool{}
			for _, state := range candidates {
				key := fmt.Sprint(state.mask != 0) + rankedRouteKey(state.route)
				if !seen[key] {
					seen[key] = true
					states = append(states, state)
				}
			}
		}
		out := []rankedRoute{}
		for _, state := range states {
			if state.mask != 0 {
				out = append(out, state.route)
			}
		}
		return rankedUnique(out)
	case exOptional:
		return rankedUnique(append([]rankedRoute{rankedEmptyRoute()}, visit(expr.Inner)...))
	case exRepeat:
		items := visit(expr.Inner)
		if expr.Sep != nil {
			return rankedUnique(append(items, rankedProduct(items, visit(expr.Sep))...))
		}
		return items
	default:
		route := rankedEmptyRoute()
		if expr.Kind == exCapture && needed[expr.Name] {
			route.length = 1
			route.captures[expr.Name] = rankedCapture{r.owners[expr], 1}
		}
		for expr.Kind == exCapture || expr.Kind == exTest || expr.Kind == exSplice {
			expr = expr.Inner
		}
		if expr.Kind == exRef && g.byName[expr.Name] != nil {
			route.span = rankedSpan{r.productive[expr.Name], r.nonempty[expr.Name]}
		} else {
			route.span = rankedSpan{true, true}
		}
		return []rankedRoute{route}
	}
}
func rankedTermReads(term *domTerm, out map[string]bool) {
	if term == nil {
		return
	}
	if term.Kind == tmCapture {
		out[term.Str] = true
	}
	rankedCondReads(term.Cond, out)
	for _, child := range term.Items {
		rankedTermReads(child, out)
	}
}
func rankedCondReads(cond *domCond, out map[string]bool) {
	if cond == nil {
		return
	}
	if cond.Kind == cdCaptured {
		out[cond.Capture] = true
	}
	rankedTermReads(cond.Left, out)
	rankedTermReads(cond.Right, out)
	rankedTermReads(cond.Span, out)
	rankedCondReads(cond.Inner, out)
	for _, child := range cond.Items {
		rankedCondReads(child, out)
	}
}
func newRankedGroups(g *stageGrammar) *rankedGroups {
	r := &rankedGroups{expressions: map[*domExpr]*rankedGroup{}, owners: map[*domExpr]*rankedGroup{}, paths: map[*domExpr]string{}, sourceSites: map[*sAlt]GroupSite{}, analyses: map[*sAlt]*rankedClauseAnalysis{}}
	for _, rule := range g.allRules() {
		for alternative, source := range rule.alts {
			at := source.at
			r.sourceSites[source] = GroupSite{Document: source.doc, At: &at, Rule: rule.name, Alternative: alternative}
			var visit func(*domExpr, string, bool, *rankedGroup)
			visit = func(expr *domExpr, path string, final bool, owner *rankedGroup) {
				r.paths[expr] = path
				if expr.Kind == exRanked {
					group := &rankedGroup{len(r.groups), alternative, rule.name, path, expr, source, final}
					r.groups = append(r.groups, group)
					r.expressions[expr] = group
					for index, child := range expr.Items {
						visit(child, fmt.Sprintf("%s/ranked/%d", path, index), final, group)
					}
					return
				}
				if expr.Kind == exCapture && owner != nil {
					r.owners[expr] = owner
				}
				switch expr.Kind {
				case exSeq, exChoice, exAnd:
					for index, child := range expr.Items {
						visit(child, fmt.Sprintf("%s/%s/%d", path, expr.Kind, index), final && (expr.Kind == exChoice || index+1 == len(expr.Items)), owner)
					}
				case exOptional:
					visit(expr.Inner, path+"/optional", final, owner)
				case exRepeat:
					visit(expr.Inner, path+"/repeat", false, owner)
					if expr.Sep != nil {
						visit(expr.Sep, path+"/separator", false, owner)
					}
				case exCapture, exTest:
					visit(expr.Inner, path+"/expr", final, owner)
				}
			}
			visit(source.alt.Expr, "", true, nil)
		}
	}
	return r
}
func (r *rankedGroups) validateClauses(g *stageGrammar, group *rankedGroup) *Error {
	analysis := r.analyses[group.source]
	if analysis == nil {
		analysis = &rankedClauseAnalysis{exports: rankedExportReads(group.source), projections: map[string][]rankedRoute{}}
		for _, condition := range group.source.conds {
			names := map[string]bool{}
			rankedCondReads(condition, names)
			analysis.conditions = append(analysis.conditions, names)
		}
		r.analyses[group.source] = analysis
	}
	private := rankedPrivateNames(group.expr)
	needed := map[string]bool{}
	for name := range analysis.exports {
		if private[name] {
			needed[name] = true
		}
	}
	for _, names := range analysis.conditions {
		if overlaps(names, private) {
			for name := range names {
				needed[name] = true
			}
		}
	}
	delete(needed, "")
	if len(needed) == 0 {
		return nil
	}
	names := []string{}
	for name := range needed {
		names = append(names, name)
	}
	sort.Strings(names)
	key := strings.Join(names, ",")
	paths := analysis.projections[key]
	if paths == nil {
		if r.productive == nil {
			r.productive, r.nonempty = rankedWrittenSpans(g)
		}
		paths = r.routes(g, group.source.alt.Expr, needed)
		analysis.projections[key] = paths
	}
	for _, route := range paths {
		end, present := route.ends[group]
		if !present {
			continue
		}
		has := func(name string) bool { _, present := route.captures[name]; return name == "" || present }
		private := func(reads map[string]bool) bool {
			for name := range reads {
				if capture, present := route.captures[name]; present && capture.owner == group {
					return true
				}
			}
			return false
		}
		for conditionIndex, condition := range group.source.conds {
			original := map[string]bool{}
			rankedCondReads(condition, original)
			bindingRead := false
			for name := range original {
				bindingRead = bindingRead || route.bindings[name] == group
			}
			if !bindingRead {
				continue
			}
			effective, state := simplifyCond(condition, has)
			if state != open {
				continue
			}
			reads := map[string]bool{}
			rankedCondReads(effective, reads)
			missing := false
			for name := range reads {
				if !has(name) {
					missing = true
				}
			}
			if missing {
				continue
			}
			for name := range reads {
				if name == "" && !group.final || name != "" && route.captures[name].at > end.at {
					return r.fail(g, group, "ranked-choice-continuation", "A private capture requires a condition ready when its ranked choice closes.").rankedDetail(end.option, rankedWrittenClause(group.source, "conditions", conditionIndex))
				}
			}
			atom := firstBoundaryAtom(effective)
			if atom != nil && atom.Op == "preceded-by" && atom.Span.Str == "" && end.start.nonempty {
				message := fmt.Sprintf("Condition %d of %s combines %s with a private capture in option %d. That option can start after the rule starts. Move the condition into a rule that starts with the ranked group, or test the private capture itself.", conditionIndex+1, group.parent, boundaryAtomText(atom), end.option+1)
				return r.fail(g, group, "ranked-choice-boundary", message).rankedDetail(end.option, rankedWrittenClause(group.source, "conditions", conditionIndex))
			}
		}
		for termIndex, term := range []*domTerm{group.source.alt.Tags, group.source.ruleTags} {
			if term == nil {
				continue
			}
			reads := map[string]bool{}
			rankedTermReads(term, reads)
			if private(reads) {
				return r.fail(g, group, "ranked-choice-export", "A tag term cannot read a private ranked capture.").rankedDetail(end.option, rankedWrittenClause(group.source, []string{"alternative-tags", "tags"}[termIndex], -1))
			}
		}
		// Scope belongs to every written recipe, before channel selection or pruning.
		for _, recipe := range []struct {
			term *domTerm
			key  string
		}{
			{group.source.alt.Value, "alternative-value"}, {group.source.alt.Image, "alternative-image"},
			{group.source.ruleValue, "value"}, {group.source.ruleImage, "image"},
		} {
			reads := map[string]bool{}
			rankedTermReads(recipe.term, reads)
			if private(reads) {
				return r.fail(g, group, "ranked-choice-export", "A recipe cannot read a private ranked capture.").rankedDetail(end.option, rankedWrittenClause(group.source, recipe.key, -1))
			}
		}
		reads := map[string]bool{}
		if group.source.emit != nil {
			for _, item := range group.source.emit.Items {
				if !item.IsInsert {
					for _, name := range item.captures() {
						reads[name] = true
					}
				}
				rankedTermReads(item.Tags, reads)
				rankedTermReads(item.Value, reads)
				rankedTermReads(item.Image, reads)
			}
		}
		if private(reads) {
			return r.fail(g, group, "ranked-choice-export", "An emission item cannot read a private ranked capture.").rankedDetail(end.option, rankedWrittenClause(group.source, "emit", -1))
		}
	}
	return nil
}
func rankedWrittenClause(source *sAlt, key string, index int) json.RawMessage {
	if source.written == nil {
		return nil
	}
	value := source.written[key]
	if strings.HasPrefix(key, "alternative-") {
		var alternatives []json.RawMessage
		_ = json.Unmarshal(source.written["alternatives"], &alternatives)
		if source.writtenAlternative >= len(alternatives) {
			return nil
		}
		alt, _ := decodeObj(alternatives[source.writtenAlternative])
		value = alt[strings.TrimPrefix(key, "alternative-")]
	}
	if index >= 0 {
		var items []json.RawMessage
		_ = json.Unmarshal(value, &items)
		if index >= len(items) {
			return nil
		}
		value = items[index]
	}
	return append(json.RawMessage(nil), value...)
}
func rankedWrittenExpression(group *rankedGroup) json.RawMessage {
	var alternatives []json.RawMessage
	_ = json.Unmarshal(group.source.written["alternatives"], &alternatives)
	if group.source.writtenAlternative >= len(alternatives) {
		return nil
	}
	alt, _ := decodeObj(alternatives[group.source.writtenAlternative])
	value := alt["expr"]
	for _, part := range strings.Split(group.path, "/")[1:] {
		if index, err := strconv.Atoi(part); err == nil {
			var items []json.RawMessage
			_ = json.Unmarshal(value, &items)
			if index >= len(items) {
				return nil
			}
			value = items[index]
		} else {
			object, _ := decodeObj(value)
			value = object[part]
		}
	}
	return append(json.RawMessage(nil), value...)
}
func (r *rankedGroups) fail(g *stageGrammar, group *rankedGroup, code, message string) *Error {
	site := r.sourceSites[group.source]
	site.Path = group.path
	site.At = nil
	if at := group.expr.RankedAt; at != [2]int{} {
		site.At = &at
	} else if at, known := group.source.alt.rankedLocations[group.path]; known {
		site.At = &at
	}
	at := [2]int{}
	if site.At != nil {
		at = *site.At
	}
	err := grammarError(group.source.doc, at, "%s: %s", code, message)
	err.Code = code
	err.Group = &site
	return err
}

// rankedExportReads includes written carriers before absent ones disappear.
func rankedExportReads(source *sAlt) map[string]bool {
	reads := map[string]bool{}
	for _, term := range []*domTerm{source.alt.Tags, source.ruleTags, source.alt.Value, source.alt.Image, source.ruleValue, source.ruleImage} {
		rankedTermReads(term, reads)
	}
	if source.emit != nil {
		for _, item := range source.emit.Items {
			if !item.IsInsert {
				for _, name := range item.captures() {
					reads[name] = true
				}
			}
			rankedTermReads(item.Tags, reads)
			rankedTermReads(item.Value, reads)
			rankedTermReads(item.Image, reads)
		}
	}
	return reads
}

func (r *rankedGroups) validateTags(g *stageGrammar) *Error {
	graph := newRankedTagGraph(g, r)
	unsafe := make([]bool, len(graph.nodes))
	users := make([][]int, len(graph.nodes))
	for index, node := range graph.nodes {
		for _, route := range node.routes {
			if route.tagged {
				unsafe[index] = unsafe[index] || route.unsafe
			} else {
				for _, child := range route.children {
					if child < 0 {
						unsafe[index] = true
					} else {
						users[child] = append(users[child], index)
					}
				}
			}
		}
	}
	pending := []int{}
	for index, marked := range unsafe {
		if marked {
			pending = append(pending, index)
		}
	}
	for i := 0; i < len(pending); i++ {
		for _, parent := range users[pending[i]] {
			if !unsafe[parent] {
				unsafe[parent] = true
				pending = append(pending, parent)
			}
		}
	}
	for _, group := range r.groups {
		if err := r.validateClauses(g, group); err != nil {
			return err
		}
		helper := graph.groups[group]
		if !unsafe[helper] {
			continue
		}
		outward, seen := []int{helper}, map[int]bool{helper: true}
		for i := 0; i < len(outward); i++ {
			for _, parent := range users[outward[i]] {
				node := graph.nodes[parent]
				if !node.helper && node.owner == group.parent {
					return r.tagFailure(g, graph, group, helper, unsafe)
				}
				if node.helper && node.owner == group.parent && !seen[parent] {
					seen[parent] = true
					outward = append(outward, parent)
				}
			}
		}
	}
	return nil
}

func (r *rankedGroups) tagFailure(g *stageGrammar, graph *rankedTagGraph, group *rankedGroup, helper int, unsafe []bool) *Error {
	err := r.fail(g, group, "ranked-choice-tags", "A ranked choice must discard its returned tags or return provably empty tags.")
	err.Expression = rankedWrittenExpression(group)
	type state struct {
		node   int
		steps  []GroupSite
		option *int
	}
	queue, seen := []state{{helper, []GroupSite{*err.Group}, nil}}, map[int]bool{helper: true}
	for i := 0; i < len(queue); i++ {
		current := queue[i]
		for _, route := range graph.nodes[current.node].routes {
			option := current.option
			if option == nil && route.option >= 0 {
				value := route.option
				option = &value
			}
			steps := append([]GroupSite(nil), current.steps...)
			if current.node != helper {
				site := r.sourceSites[route.source]
				site.Path = r.paths[route.expr]
				steps = append(steps, site)
			}
			source := route.unsafe
			if !route.tagged {
				for _, child := range route.children {
					source = source || child < 0
				}
			}
			if source {
				err.Option, err.Inheritance = option, steps
				return err
			}
			if !route.tagged {
				for _, child := range route.children {
					if child >= 0 && unsafe[child] && !seen[child] {
						seen[child] = true
						queue = append(queue, state{child, steps, option})
					}
				}
			}
		}
	}
	return err
}

type rankedTagRoute struct {
	source         *sAlt
	expr           *domExpr
	option         int
	tagged, unsafe bool
	children       []int
}
type rankedTagNode struct {
	owner  string
	helper bool
	routes []rankedTagRoute
}
type rankedTagGraph struct {
	nodes  []*rankedTagNode
	groups map[*rankedGroup]int
}
type rankedUnary struct {
	zero     bool
	children []int
}

func (g *rankedTagGraph) node(owner string, helper bool) int {
	g.nodes = append(g.nodes, &rankedTagNode{owner: owner, helper: helper})
	return len(g.nodes) - 1
}

// newRankedTagGraph summarizes element arity without production products.
func newRankedTagGraph(g *stageGrammar, ranked *rankedGroups) *rankedTagGraph {
	graph := &rankedTagGraph{groups: map[*rankedGroup]int{}}
	named := map[string]int{}
	for _, rule := range g.rules {
		named[rule.name] = graph.node(rule.name, false)
	}
	captured := map[*domExpr]bool{}
	var hasCapture func(*domExpr) bool
	hasCapture = func(expr *domExpr) bool {
		if value, ok := captured[expr]; ok {
			return value
		}
		value := false
		if expr.Kind != exRanked {
			value = expr.Kind == exCapture
			for _, child := range expr.Items {
				value = value || hasCapture(child)
			}
			if expr.Inner != nil {
				value = value || hasCapture(expr.Inner)
			}
			if expr.Sep != nil {
				value = value || hasCapture(expr.Sep)
			}
		}
		captured[expr] = value
		return value
	}
	for _, rule := range g.rules {
		for _, source := range rule.alts {
			memo := map[*domExpr]rankedUnary{}
			var describe func(*domExpr) rankedUnary
			describe = func(expr *domExpr) rankedUnary {
				if result, ok := memo[expr]; ok {
					return result
				}
				result := rankedUnary{}
				switch expr.Kind {
				case exEmpty:
					result.zero = true
				case exSeq:
					parts, blocking := []rankedUnary{}, 0
					for _, child := range expr.Items {
						part := describe(child)
						parts = append(parts, part)
						if !part.zero {
							blocking++
						}
					}
					result.zero = blocking == 0
					for _, part := range parts {
						others := blocking
						if !part.zero {
							others--
						}
						if others == 0 {
							result.children = append(result.children, part.children...)
						}
					}
				case exChoice, exAnd:
					for _, child := range expr.Items {
						part := describe(child)
						result.zero = result.zero || part.zero
						result.children = append(result.children, part.children...)
					}
				case exRanked, exOptional, exRepeat:
					if expr.Kind == exOptional && !expr.Elidable && hasCapture(expr.Inner) {
						result.children = describe(expr.Inner).children
					} else {
						helper := graph.node(rule.name, true)
						result.children = []int{helper}
						memo[expr] = result
						if expr.Kind == exRanked {
							graph.groups[ranked.expressions[expr]] = helper
							for option, child := range expr.Items {
								graph.nodes[helper].routes = append(graph.nodes[helper].routes, rankedTagRoute{source: source, expr: expr, option: option, children: describe(child).children})
							}
						} else {
							graph.nodes[helper].routes = append(graph.nodes[helper].routes, rankedTagRoute{source: source, expr: expr, option: -1, children: describe(expr.Inner).children})
						}
						// Recursive repetition only adds a self edge.
						if expr.Sep != nil {
							describe(expr.Sep)
						}
					}
				case exCapture, exTest, exSplice:
					result = describe(expr.Inner)
				default:
					child, ok := named[expr.Name]
					if expr.Kind != exRef || !ok {
						child = -1
					}
					result.children = []int{child}
				}
				memo[expr] = result
				return result
			}
			expr := source.alt.Expr
			body := rankedUnary{}
			if isChain(expr) {
				body = describe(expr.Inner)
				if expr.Sep != nil {
					describe(expr.Sep)
				}
			} else {
				body = describe(expr)
			}
			route := rankedTagRoute{source: source, expr: expr, option: -1, children: body.children}
			for _, term := range []*domTerm{source.alt.Tags, source.ruleTags} {
				if term != nil {
					route.tagged = true
					route.unsafe = route.unsafe || !isEmptySet(term)
				}
			}
			node := graph.nodes[named[rule.name]]
			node.routes = append(node.routes, route)
		}
	}
	return graph
}

// rankedWrittenSpans uses each written branch and concatenation once.
func rankedWrittenSpans(g *stageGrammar) (map[string]bool, map[string]bool) {
	type branch struct {
		lhs int
		rhs []int
	}
	named, memo := map[string]int{}, map[*domExpr]int{}
	count, branches := len(g.rules)+1, []branch{}
	for i, rule := range g.rules {
		named[rule.name] = i + 1
	}
	var expression func(*domExpr) int
	expression = func(expr *domExpr) int {
		if id, ok := memo[expr]; ok {
			return id
		}
		id := 0
		switch expr.Kind {
		case exCapture, exTest, exSplice:
			id = expression(expr.Inner)
		case exRef:
			id = named[expr.Name]
		case exLiteral, exRange, exWildcard:
		default:
			id = count
			count++
			switch expr.Kind {
			case exEmpty:
				branches = append(branches, branch{id, nil})
			case exSeq:
				rhs := []int{}
				for _, child := range expr.Items {
					rhs = append(rhs, expression(child))
				}
				branches = append(branches, branch{id, rhs})
			case exChoice, exRanked, exAnd:
				for _, child := range expr.Items {
					target := expression(child)
					branches = append(branches, branch{id, []int{target}})
				}
			case exOptional:
				child := expression(expr.Inner)
				branches = append(branches, branch{id, nil}, branch{id, []int{child}})
			case exRepeat:
				item := expression(expr.Inner)
				branches = append(branches, branch{id, []int{item}})
				if expr.Sep != nil {
					separator := expression(expr.Sep)
					branches = append(branches, branch{id, []int{item, separator, item}})
				}
			}
		}
		memo[expr] = id
		return id
	}
	for _, rule := range g.rules {
		for _, source := range rule.alts {
			rhs := expression(source.alt.Expr)
			branches = append(branches, branch{named[rule.name], []int{rhs}})
		}
	}
	users, remaining := make([][]int, count), make([]int, len(branches))
	productive, nonempty := make([]bool, count), make([]bool, count)
	productive[0], nonempty[0] = true, true
	pending := []int{0}
	for i, branch := range branches {
		remaining[i] = len(branch.rhs)
		if remaining[i] == 0 && !productive[branch.lhs] {
			productive[branch.lhs] = true
			pending = append(pending, branch.lhs)
		}
		for _, child := range branch.rhs {
			users[child] = append(users[child], i)
		}
	}
	for i := 0; i < len(pending); i++ {
		for _, index := range users[pending[i]] {
			remaining[index]--
			lhs := branches[index].lhs
			if remaining[index] == 0 && !productive[lhs] {
				productive[lhs] = true
				pending = append(pending, lhs)
			}
		}
	}
	pending = []int{0}
	for i, branch := range branches {
		if remaining[i] == 0 {
			for _, child := range branch.rhs {
				if nonempty[child] && !nonempty[branch.lhs] {
					nonempty[branch.lhs] = true
					pending = append(pending, branch.lhs)
				}
			}
		}
	}
	for i := 0; i < len(pending); i++ {
		for _, index := range users[pending[i]] {
			lhs := branches[index].lhs
			if remaining[index] == 0 && !nonempty[lhs] {
				nonempty[lhs] = true
				pending = append(pending, lhs)
			}
		}
	}
	p, n := map[string]bool{}, map[string]bool{}
	for name, id := range named {
		p[name], n[name] = productive[id], nonempty[id]
	}
	return p, n
}

func containsRanked(expr *domExpr) bool {
	pending := []*domExpr{expr}
	for len(pending) > 0 {
		current := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		if current == nil {
			continue
		}
		if current.Kind == exRanked {
			return true
		}
		pending = append(pending, current.Items...)
		pending = append(pending, current.Inner, current.Sep)
	}
	return false
}

// Recover metadata from the same source constructors used on a cache miss.
func (nr *notationReader) restoreLocations(text, document string, cached *domDoc, names *namesScope) {
	source, err := nr.readMode(text, document, true, names)
	if err == nil {
		restoreSourceLocations(cached, source)
	}
}
func rankedSyntaxFailure(tokens []Token, at int) bool {
	if at < len(tokens) && tokens[at].Value == "≻" || at > 0 && at-1 < len(tokens) && tokens[at-1].Value == "≻" {
		return true
	}
	if at >= len(tokens) || tokens[at].Value != "|" {
		return false
	}
	levels := []bool{false}
	for _, token := range tokens[:at] {
		switch token.Value {
		case "(", "[", "{":
			levels = append(levels, false)
		case ")", "]", "}":
			if len(levels) > 0 {
				levels = levels[:len(levels)-1]
			}
		case "≻":
			if len(levels) > 0 {
				levels[len(levels)-1] = true
			}
		default:
			if strings.HasPrefix(token.Value, "%") && len(levels) > 0 {
				levels[len(levels)-1] = false
			}
		}
	}
	return len(levels) > 0 && levels[len(levels)-1]
}
func rankedDOMCode(err error) string {
	if problem, ok := err.(*domProblem); ok {
		return problem.code
	}
	if strings.HasPrefix(err.Error(), "ranked-choice-syntax:") {
		return "ranked-choice-syntax"
	}
	return ""
}
