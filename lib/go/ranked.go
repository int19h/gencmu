package gencmu

import "fmt"

// Ranked groups retain written identities independently of generated helpers.
type rankedGroup struct {
	id, alternative int
	parent, path    string
	expr            *domExpr
	source          *sAlt
	final           bool
}
type rankedGroups struct {
	groups      []*rankedGroup
	expressions map[*domExpr]*rankedGroup
	owners      map[*domExpr]*rankedGroup
	paths       map[*domExpr]string
}
type rankedCapture struct {
	node *domExpr
	at   int
}
type rankedEnd struct{ at, option int }
type rankedRoute struct {
	length   int
	captures map[string]rankedCapture
	ends     map[*rankedGroup]rankedEnd
}

func rankedEmptyRoute() rankedRoute {
	return rankedRoute{captures: map[string]rankedCapture{}, ends: map[*rankedGroup]rankedEnd{}}
}
func rankedJoin(left, right rankedRoute) rankedRoute {
	out := rankedEmptyRoute()
	out.length = left.length + right.length
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
		out.ends[group] = end
	}
	return out
}
func rankedProduct(left, right []rankedRoute) []rankedRoute {
	out := []rankedRoute{}
	for _, a := range left {
		for _, b := range right {
			out = append(out, rankedJoin(a, b))
		}
	}
	return out
}
func (r *rankedGroups) routes(expr *domExpr) []rankedRoute {
	switch expr.Kind {
	case exEmpty:
		return []rankedRoute{rankedEmptyRoute()}
	case exSeq:
		out := []rankedRoute{rankedEmptyRoute()}
		for _, child := range expr.Items {
			out = rankedProduct(out, r.routes(child))
		}
		return out
	case exChoice:
		out := []rankedRoute{}
		for _, child := range expr.Items {
			out = append(out, r.routes(child)...)
		}
		return out
	case exRanked:
		out := []rankedRoute{}
		for option, child := range expr.Items {
			for _, route := range r.routes(child) {
				route.ends[r.expressions[expr]] = rankedEnd{route.length, option}
				out = append(out, route)
			}
		}
		return out
	case exAnd:
		out := []rankedRoute{}
		for mask := 1; mask < 1<<len(expr.Items); mask++ {
			route := []rankedRoute{rankedEmptyRoute()}
			for index, child := range expr.Items {
				if mask&(1<<index) != 0 {
					route = rankedProduct(route, r.routes(child))
				}
			}
			out = append(out, route...)
		}
		return out
	case exOptional:
		return append([]rankedRoute{rankedEmptyRoute()}, r.routes(expr.Inner)...)
	case exRepeat:
		out := r.routes(expr.Inner)
		if expr.Sep != nil {
			out = rankedProduct(out, r.routes(expr.Sep))
		}
		return out
	default:
		route := rankedEmptyRoute()
		route.length = 1
		if expr.Kind == exCapture {
			route.captures[expr.Name] = rankedCapture{expr, 1}
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
		out[cond.Rule] = true
	}
	rankedTermReads(cond.Left, out)
	rankedTermReads(cond.Right, out)
	rankedTermReads(cond.Span, out)
	rankedCondReads(cond.Inner, out)
	for _, child := range cond.Items {
		rankedCondReads(child, out)
	}
}
func newRankedGroups(g *stageGrammar) (*rankedGroups, *Error) {
	r := &rankedGroups{expressions: map[*domExpr]*rankedGroup{}, owners: map[*domExpr]*rankedGroup{}, paths: map[*domExpr]string{}}
	for _, rule := range g.rules {
		for alternative, source := range rule.alts {
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
	for _, group := range r.groups {
		for _, route := range r.routes(group.source.alt.Expr) {
			end, present := route.ends[group]
			if !present {
				continue
			}
			has := func(name string) bool { _, present := route.captures[name]; return name == "" || present }
			private := func(reads map[string]bool) bool {
				for name := range reads {
					if capture, present := route.captures[name]; present && r.owners[capture.node] == group {
						return true
					}
				}
				return false
			}
			for _, condition := range group.source.conds {
				original := map[string]bool{}
				rankedCondReads(condition, original)
				if !private(original) {
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
						return nil, r.fail(g, group, "ranked-choice-continuation", "A private capture requires a condition ready when its ranked choice closes.")
					}
				}
			}
			for _, term := range []*domTerm{group.source.alt.Tags, group.source.ruleTags} {
				if term == nil {
					continue
				}
				reads := map[string]bool{}
				rankedTermReads(simplifyTerm(term, has), reads)
				if private(reads) {
					return nil, r.fail(g, group, "ranked-choice-export", "A tag term cannot read a private ranked capture.")
				}
			}
			reads := map[string]bool{}
			if group.source.emit != nil {
				for _, item := range group.source.emit.Items {
					if item.IsInsert {
						continue
					}
					for _, name := range item.captures() {
						reads[name] = true
					}
					rankedTermReads(item.Tags, reads)
				}
			}
			if private(reads) {
				return nil, r.fail(g, group, "ranked-choice-export", "An emission item cannot read a private ranked capture.")
			}
		}
	}
	return r, nil
}
func (r *rankedGroups) fail(g *stageGrammar, group *rankedGroup, code, message string) *Error {
	err := grammarError(group.source.doc, group.source.at, "%s: %s", code, message)
	err.Stage = g.name
	return err
}
func (r *rankedGroups) validateTags(g *lowered) *Error {
	if g.fault != "" {
		if g.faultLocation != nil {
			return g.faultLocation
		}
		return grammarError("", [2]int{}, "%s", g.fault)
	}
	unsafe := map[int32]bool{}
	users := map[int32][]*production{}
	helpers := map[*rankedGroup]int32{}
	for _, p := range g.prods {
		if p.slot.path != nil {
			if group := r.expressions[p.slot.path]; group != nil {
				helpers[group] = p.lhs
			}
		}
		terms := p.slot.tags
		if !p.helper {
			terms = nil
			for _, term := range []*domTerm{p.slot.source.alt.Tags, p.slot.source.ruleTags} {
				if term != nil {
					terms = append(terms, term)
				}
			}
		}
		if len(terms) > 0 {
			for _, term := range terms {
				if !isEmptySet(term) {
					unsafe[p.lhs] = true
				}
			}
		} else if len(p.rhs) == 1 {
			if p.rhs[0].term {
				unsafe[p.lhs] = true
			} else {
				users[p.rhs[0].id] = append(users[p.rhs[0].id], p)
			}
		}
	}
	pending := []int32{}
	for rule := range unsafe {
		pending = append(pending, rule)
	}
	for at := 0; at < len(pending); at++ {
		for _, p := range users[pending[at]] {
			if !unsafe[p.lhs] {
				unsafe[p.lhs] = true
				pending = append(pending, p.lhs)
			}
		}
	}
	for _, group := range r.groups {
		helper, present := helpers[group]
		if !present || !unsafe[helper] {
			continue
		}
		outward := []int32{helper}
		seen := map[int32]bool{helper: true}
		for at := 0; at < len(outward); at++ {
			for _, p := range users[outward[at]] {
				if !p.helper && p.ruleName == group.parent {
					return r.fail(g.stage, group, "ranked-choice-tags", "A ranked choice must discard its returned tags or return provably empty tags.")
				}
				if p.helper && p.ruleName == group.parent && !seen[p.lhs] {
					seen[p.lhs] = true
					outward = append(outward, p.lhs)
				}
			}
		}
	}
	return nil
}
