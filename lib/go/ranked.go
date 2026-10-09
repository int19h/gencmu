package gencmu

import (
	"encoding/json"
	"fmt"
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
	groups       []*rankedGroup
	expressions  map[*domExpr]*rankedGroup
	owners       map[*domExpr]*rankedGroup
	paths        map[*domExpr]string
	clauseErrors map[*rankedGroup]*Error
	sourceSites  map[*sAlt]GroupSite
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
	r := &rankedGroups{expressions: map[*domExpr]*rankedGroup{}, owners: map[*domExpr]*rankedGroup{}, paths: map[*domExpr]string{}, clauseErrors: map[*rankedGroup]*Error{}, sourceSites: map[*sAlt]GroupSite{}}
	for _, rule := range g.rules {
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
	for _, group := range r.groups {
		if err := r.validateClauses(g, group); err != nil {
			r.clauseErrors[group] = err
		}
	}
	return r, nil
}
func (r *rankedGroups) validateClauses(g *stageGrammar, group *rankedGroup) *Error {
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
		for conditionIndex, condition := range group.source.conds {
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
					return r.fail(g, group, "ranked-choice-continuation", "A private capture requires a condition ready when its ranked choice closes.").rankedDetail(end.option, rankedWrittenClause(group.source, "conditions", conditionIndex))
				}
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
	if key == "alternative-tags" {
		var alternatives []json.RawMessage
		_ = json.Unmarshal(source.written["alternatives"], &alternatives)
		if source.writtenAlternative >= len(alternatives) {
			return nil
		}
		alt, _ := decodeObj(alternatives[source.writtenAlternative])
		value = alt["tags"]
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
	if at, known := group.source.alt.rankedLocations[group.path]; known {
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
		if err := r.clauseErrors[group]; err != nil {
			return err
		}
		helper, present := helpers[group]
		if !present || !unsafe[helper] {
			continue
		}
		outward := []int32{helper}
		seen := map[int32]bool{helper: true}
		for at := 0; at < len(outward); at++ {
			for _, p := range users[outward[at]] {
				if !p.helper && p.ruleName == group.parent {
					return r.tagFailure(g, group, helper, unsafe)
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

func (r *rankedGroups) tagFailure(g *lowered, group *rankedGroup, helper int32, unsafe map[int32]bool) *Error {
	err := r.fail(g.stage, group, "ranked-choice-tags", "A ranked choice must discard its returned tags or return provably empty tags.")
	err.Expression = rankedWrittenExpression(group)
	type state struct {
		rule   int32
		steps  []GroupSite
		option *int
	}
	queue := []state{{helper, []GroupSite{*err.Group}, nil}}
	seen := map[int32]bool{helper: true}
	for at := 0; at < len(queue); at++ {
		current := queue[at]
		for _, p := range g.rules[current.rule].prods {
			option := current.option
			if option == nil && p.ranked != nil {
				value := p.option
				option = &value
			}
			steps := append([]GroupSite(nil), current.steps...)
			if current.rule != helper {
				site := r.sourceSites[p.slot.source]
				site.Path = r.paths[p.slot.path]
				steps = append(steps, site)
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
			source := len(terms) == 0 && len(p.rhs) == 1 && p.rhs[0].term
			for _, term := range terms {
				source = source || !isEmptySet(term)
			}
			if source {
				err.Option = option
				err.Inheritance = steps
				return err
			}
			if len(terms) == 0 && len(p.rhs) == 1 && !p.rhs[0].term {
				child := p.rhs[0].id
				if unsafe[child] && !seen[child] {
					seen[child] = true
					queue = append(queue, state{child, steps, option})
				}
			}
		}
	}
	return err
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
func domHasRanked(dom *domDoc) bool {
	for _, rule := range dom.Rules {
		for _, alt := range rule.Alternatives {
			if containsRanked(alt.Expr) {
				return true
			}
		}
	}
	return false
}
func restoreRankedLocations(dom *domDoc, tokens []Token, position func(int) [2]int) {
	separators := [][2]int{}
	for _, token := range tokens {
		if token.Text == "≻" {
			separators = append(separators, position(token.Source[0]))
		}
	}
	index := 0
	type task struct {
		expr   *domExpr
		path   string
		action int
	}
	for _, rule := range dom.Rules {
		for _, alternative := range rule.Alternatives {
			locations := map[string][2]int{}
			alternative.rankedLocations = locations
			pending := []task{{alternative.Expr, "", 0}}
			for len(pending) > 0 {
				item := pending[len(pending)-1]
				pending = pending[:len(pending)-1]
				expr, path := item.expr, item.path
				if item.action == 1 {
					if index < len(separators) {
						locations[path] = separators[index]
					}
					continue
				}
				if item.action == 2 {
					index++
					continue
				}
				if expr == nil {
					continue
				}
				if expr.Kind == exRanked && len(expr.Items) > 0 {
					for i := len(expr.Items) - 1; i > 0; i-- {
						pending = append(pending, task{expr.Items[i], fmt.Sprintf("%s/ranked/%d", path, i), 0}, task{nil, "", 2})
					}
					pending = append(pending, task{nil, path, 1}, task{expr.Items[0], path + "/ranked/0", 0})
					continue
				}
				switch expr.Kind {
				case exOptional:
					pending = append(pending, task{expr.Inner, path + "/optional", 0})
				case exRepeat:
					pending = append(pending, task{expr.Sep, path + "/separator", 0}, task{expr.Inner, path + "/repeat", 0})
				case exCapture, exTest:
					pending = append(pending, task{expr.Inner, path + "/expr", 0})
				}
				for i := len(expr.Items) - 1; i >= 0; i-- {
					pending = append(pending, task{expr.Items[i], fmt.Sprintf("%s/%s/%d", path, expr.Kind, i), 0})
				}
			}
		}
	}
	if index != len(separators) {
		for _, rule := range dom.Rules {
			for _, alternative := range rule.Alternatives {
				alternative.rankedLocations = nil
			}
		}
	}
}
func (nr *notationReader) restoreLocations(text string, dom *domDoc) {
	gt := extractGrammarText(text)
	ps := newParseState(nr.uni, gt.text)
	if len(nr.stages) == 0 {
		return
	}
	run := ps.newRun(nr.stages[0].name, nr.stages[0], ps.characterTokens())
	out := run.run(nr.lowered[0], nr.stages[0].elisionOnly)
	if out.err == nil {
		restoreRankedLocations(dom, out.stage.Output, gt.at)
	}
}
func rankedSyntaxFailure(tokens []Token, at int) bool {
	if at < len(tokens) && tokens[at].Text == "≻" || at > 0 && at-1 < len(tokens) && tokens[at-1].Text == "≻" {
		return true
	}
	if at >= len(tokens) || tokens[at].Text != "|" {
		return false
	}
	levels := []bool{false}
	for _, token := range tokens[:at] {
		switch token.Text {
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
			if strings.HasPrefix(token.Text, "%") && len(levels) > 0 {
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
