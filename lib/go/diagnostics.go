package gencmu

import "sync/atomic"

// The hook exercises recipe failures that current notation cannot express.
type messageHook struct {
	stages map[*stageGrammar]bool
	call   func(*occurrence, *domTerm)
}

var diagnosticMessage atomic.Pointer[messageHook]

type erasurePatternUse struct {
	pattern *domPattern
	doc     string
	at      [2]int
}

func (g *stageGrammar) checkDiagnosticsAndSplices() *Error {
	warnings := map[string]bool{}
	prohibited := map[string]bool{}
	erased := map[string]bool{}
	for _, rule := range g.rules {
		all := true
		for _, alt := range rule.alts {
			all = all && alt.erased
		}
		erased[rule.name] = all
	}
	var problem *Error
	names := func(pattern *domPattern, doc string, at [2]int, collect bool) {
		walkPattern(pattern, func(node *domPattern) {
			if node.Kind == "name" {
				if collect {
					prohibited[node.Name] = true
				}
				if problem == nil && erased[node.Name] && node.Attached != nil && !(len(node.Attached) == 1 && node.Attached[0].Kind == "siblings") {
					pos := node.At
					if pos == [2]int{} {
						pos = at
					}
					problem = grammarError(doc, pos, "a pattern of erased rule %s permits only the child list « ⋯ »", node.Name)
				}
			}
		})
	}
	for _, use := range g.erasurePatterns {
		names(use.pattern, use.doc, use.at, false)
	}
	g.erasurePatterns, g.erasurePatternsDone = nil, true
	if problem != nil {
		return problem
	}
	for _, step := range g.steps {
		names(step.pattern, "", [2]int{}, true)
	}
	for _, constant := range g.constants {
		if constant.value != nil && constant.value.pattern != nil {
			names(constant.value.pattern, constant.doc, [2]int{}, true)
		}
	}
	type splice struct {
		name string
		alt  *sAlt
	}
	var splices []splice
	expressions := map[*domExpr]bool{}
	clauses := map[clausePart]bool{}
	for _, rule := range g.rules {
		for _, alt := range rule.alts {
			if alt.warning != nil {
				warnings[rule.name] = true
				if !nameSyntaxFeature.MatchString(rule.name) {
					return grammarError(alt.doc, alt.at, "a warning code must be a feature name")
				}
			}
			if alt.error != nil && !isRuleName(rule.name, g.uni) {
				return grammarError(alt.doc, alt.at, "an error code must be a rule name")
			}
			scanExpression := func(root *domExpr) {
				walkQueryBody(root, func(expr *domExpr) bool {
					if expressions[expr] {
						return false
					}
					expressions[expr] = true
					if expr.Kind == exSplice {
						splices = append(splices, splice{expr.Inner.Name, alt})
					}
					return true
				}, nil)
			}
			scanExpression(alt.alt.Expr)
			visit := func(part clausePart) bool {
				if clauses[part] {
					return false
				}
				clauses[part] = true
				if part.t != nil && part.t.Kind == tmBody {
					scanExpression(part.t.Body)
				}
				if part.t != nil && part.t.Pattern != nil {
					names(part.t.Pattern, alt.doc, alt.at, true)
				}
				if part.c != nil && part.c.Kind == cdBoundary {
					for _, target := range part.c.Targets {
						if target.Kind == tmRule {
							prohibited[target.Str] = true
						}
					}
				}
				return true
			}
			for _, term := range []*domTerm{alt.alt.Tags, alt.ruleTags} {
				walkClause(clausePart{t: term}, visit)
			}
			for _, condition := range alt.conds {
				walkClause(clausePart{c: condition}, visit)
			}
			if alt.emit != nil {
				for _, item := range alt.emit.Items {
					for _, term := range []*domTerm{item.Tags, item.Value, item.Image} {
						walkClause(clausePart{t: term}, visit)
					}
				}
			}
		}
	}
	for _, rule := range g.rules {
		for _, alt := range rule.alts {
			for _, code := range alt.suppressWarnings {
				if code != "_" && !warnings[code] {
					return grammarError(alt.doc, alt.at, "suppression code %s is not a warning of stage %s", code, g.name)
				}
			}
		}
	}
	if problem != nil {
		return problem
	}
	for _, splice := range splices {
		if prohibited[splice.name] {
			return grammarError(splice.alt.doc, splice.alt.at, "a splice of %s conflicts with a pattern or neighbour target", splice.name)
		}
	}
	return nil
}
