package gencmu

import "sync/atomic"

// The hook exercises recipe failures that current notation cannot express.
type messageHook struct {
	stages map[*stageGrammar]bool
	call   func(*occurrence, *domTerm)
}

var diagnosticMessage atomic.Pointer[messageHook]

func (g *stageGrammar) checkDiagnosticsAndSplices() *Error {
	warnings := map[string]bool{}
	prohibited := map[string]bool{}
	names := func(pattern *domPattern) {
		walkPattern(pattern, func(node *domPattern) {
			if node.Kind == "name" {
				prohibited[node.Name] = true
			}
		})
	}
	for _, step := range g.steps {
		names(step.pattern)
	}
	for _, constant := range g.constants {
		if constant.value != nil && constant.value.pattern != nil {
			names(constant.value.pattern)
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
			pending := []*domExpr{alt.alt.Expr}
			for len(pending) > 0 {
				expr := pending[len(pending)-1]
				pending = pending[:len(pending)-1]
				if expr == nil || expressions[expr] {
					continue
				}
				expressions[expr] = true
				if expr.Kind == exSplice {
					splices = append(splices, splice{expr.Inner.Name, alt})
				}
				pending = append(pending, expr.Items...)
				pending = append(pending, expr.Inner, expr.Sep)
			}
			visit := func(part clausePart) bool {
				if clauses[part] {
					return false
				}
				clauses[part] = true
				if part.t != nil && part.t.Pattern != nil {
					names(part.t.Pattern)
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
	for _, splice := range splices {
		if prohibited[splice.name] {
			return grammarError(splice.alt.doc, splice.alt.at, "a splice of %s conflicts with a pattern or neighbour target", splice.name)
		}
	}
	return nil
}
