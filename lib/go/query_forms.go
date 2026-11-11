package gencmu

import (
	"fmt"
	"sort"
)

func (g *stageGrammar) allRules() []*sRule {
	if g.allRuleList == nil {
		g.allRuleList = append(append([]*sRule{}, g.rules...), g.queryRules...)
	}
	return g.allRuleList
}

// Query identities omit positions and expand final constant values (§4.3).
func (g *stageGrammar) queryIdentity(body *domExpr) string {
	if key, known := g.queryIdentities[body]; known {
		return key
	}
	core, _, _ := queryBody(body)
	var writer jsonWriter
	core.writeJSON(&writer)
	value, err := decodeJSON(writer.buf)
	if err != nil {
		panic(err)
	}
	var normalize func(any) any
	normalize = func(raw any) any {
		if w := work.Load(); w != nil {
			w.clauseSteps.add("clause steps")
		}
		switch node := raw.(type) {
		case []any:
			out := make([]any, len(node))
			for i, part := range node {
				out[i] = normalize(part)
			}
			return out
		case map[string]any:
			if name, ok := node["const"].(string); ok {
				if constant := g.constants[name]; constant != nil {
					if constant.value.ty == tyString {
						return templateObject{"string": constant.value.s}
					}
					names := append([]string{}, constant.value.names...)
					sort.Strings(names)
					items := make([]any, len(names))
					for i, name := range names {
						items[i] = name
					}
					return templateObject{"set": items}
				}
			}
			out := templateObject{}
			for _, key := range templateKeys(node) {
				if key == "at" {
					continue
				}
				part := normalize(node[key])
				if key == exSeq || key == exChoice {
					var flat []any
					for _, child := range templateList(part) {
						if nested := templateObj(child)[key]; nested != nil {
							flat = append(flat, templateList(nested)...)
						} else {
							flat = append(flat, child)
						}
					}
					part = flat
				}
				out[key] = part
			}
			return out
		}
		return raw
	}
	key := string(templateJSON(normalize(value)))
	if g.queryIdentities == nil {
		g.queryIdentities = map[*domExpr]string{}
	}
	g.queryIdentities[body] = key
	return key
}

// prepareBodyQueries gives equivalent old and new forms the same target.
func (g *stageGrammar) prepareBodyQueries() *Error {
	g.queryTargets, g.queryNames = map[*domExpr]string{}, map[string]string{}
	identities, seen := map[string]string{}, map[clausePart]bool{}
	var owners []*sAlt
	local := false
	for _, rule := range g.rules {
		owners = append(owners, rule.alts...)
	}
	for _, entry := range g.checks {
		owners = append(owners, &sAlt{doc: entry.doc, at: entry.definition.At, alt: &domAlt{}, conds: entry.definition.Conditions})
		for _, condition := range entry.definition.Conditions {
			walkClause(clausePart{c: condition}, func(part clausePart) bool {
				if part.t != nil && part.t.Kind == tmCall {
					local = local || part.t.Str == "local-readings"
					g.hasElements = g.hasElements || part.t.Str == "preceding-element"
				}
				return true
			})
		}
	}
	bodies := map[*domExpr]*domExpr{}
	if local {
		for _, rule := range g.rules {
			for _, source := range rule.alts {
				walkQueryBody(source.alt.Expr, func(expr *domExpr) bool {
					if expr.Kind == exSeq || expr.Kind == exChoice || expr.Kind == exAnd || expr.Kind == exCapture || expr.Kind == exEmpty || expr.Kind == exRemainder || expr.Kind == exRepeat && expr.Chain != "" {
						return true
					}
					body := readingBody(expr)
					bodies[expr] = body
					query := &domTerm{Kind: tmCall, Str: "parse", Items: []*domTerm{{Kind: tmCapture}, {Kind: tmBody, Body: body}}}
					owners = append(owners, &sAlt{doc: source.doc, at: source.at, alt: &domAlt{}, conds: []*domCond{{Kind: cdForest, Left: query}}})
					return true
				}, nil)
			}
		}
	}
	for _, alternative := range owners {
		var fault *Error
		visit := func(part clausePart) bool {
			if seen[part] || fault != nil {
				return false
			}
			seen[part] = true
			term := part.t
			if term == nil || term.Kind != tmCall || term.Str != "parse" {
				return true
			}
			body := term.Items[1].Body
			key := g.queryIdentity(body)
			target, known := identities[key]
			if !known {
				core, _, _ := queryBody(body)
				if core.Kind == exRef && !engineTag(core.Name) {
					target = core.Name
					if isTerminalName(target) {
						target = "\x00query:" + target
						g.queryNames[target] = core.Name
					} else if g.byName[target] == nil {
						fault = g.faultError(alternative.doc, core, alternative.at, target+" is not a rule of stage "+g.name)
						return false
					}
				} else {
					target = fmt.Sprintf("\x00parse:%d", len(g.queryRules))
					source := &sAlt{alt: &domAlt{Expr: core}, ruleTags: &domTerm{Kind: tmEmptySet}, doc: alternative.doc, at: alternative.at, written: alternative.written, textOrder: alternative.textOrder}
					query := &sRule{name: target, alts: []*sAlt{source}, doc: alternative.doc, at: alternative.at, query: true}
					checked := &checkedClauses{terms: map[*domTerm]bool{}, conds: map[condListKey]bool{}, emits: map[*domEmit]bool{}}
					if fault = g.checkAlt(source, checked); fault != nil {
						return false
					}
					g.queryRules = append(g.queryRules, query)
					g.byName[target] = query
					var out jsonWriter
					core.writeJSON(&out)
					wire, err := decodeJSON(out.buf)
					if err != nil {
						panic(err)
					}
					g.queryNames[target] = templateBodyText(templateObj(wire), g.uni, "")
				}
				identities[key] = target
			}
			g.queryTargets[body] = target
			return true
		}
		for _, term := range []*domTerm{alternative.alt.Tags, alternative.ruleTags, alternative.alt.Value, alternative.alt.Image, alternative.ruleValue, alternative.ruleImage, alternative.error, alternative.warning} {
			walkClause(clausePart{t: term}, visit)
		}
		for _, condition := range alternative.conds {
			walkClause(clausePart{c: condition}, visit)
		}
		if alternative.emit != nil {
			for _, item := range alternative.emit.Items {
				for _, term := range []*domTerm{item.Tags, item.Value, item.Image} {
					walkClause(clausePart{t: term}, visit)
				}
			}
		}
		if fault != nil {
			return fault
		}
	}
	if local {
		g.localTargets = map[*domExpr]string{}
		for expression, body := range bodies {
			g.localTargets[expression] = g.queryTargets[body]
			delete(g.queryTargets, body)
		}
	}
	g.allRuleList = nil
	return nil
}

// queryBody removes the sole optional outer remainder (engine §4.3).
// The returned mode agrees with the old whole, prefix, and suffix forms.
func queryBody(body *domExpr) (*domExpr, string, string) {
	if body == nil || body.Kind != exSeq {
		return body, cdWhole, ""
	}
	var markers []int
	var parts []*domExpr
	for i, part := range body.Items {
		if w := work.Load(); w != nil {
			w.clauseSteps.add("clause steps")
		}
		if part != nil && part.Kind == exRemainder {
			markers = append(markers, i)
		} else {
			parts = append(parts, part)
		}
	}
	if len(markers) == 0 {
		return body, cdWhole, ""
	}
	for _, marker := range markers {
		if len(markers) > 2 || len(parts) == 0 || marker != 0 && marker != len(body.Items)-1 {
			return body, cdWhole, "a remainder stands at one outer edge of a parse argument"
		}
	}
	core := &domExpr{Kind: exSeq, Items: parts}
	if len(parts) == 1 {
		core = parts[0]
	}
	mode := cdPrefix
	if len(markers) == 2 {
		mode = cdContains
	} else if markers[0] == 0 {
		mode = cdSuffix
	}
	return core, mode, ""
}

func queryCapture(body *domExpr) *domExpr {
	var found *domExpr
	walkQueryBody(body, func(expr *domExpr) bool {
		if expr.Kind == exCapture {
			found = expr
			return false
		}
		return true
	}, func() bool { return found == nil })
	return found
}

// walkQueryBody preserves source order through every expression wrapper.
func walkQueryBody(body *domExpr, visit func(*domExpr) bool, more func() bool) {
	pending := []*domExpr{body}
	for len(pending) > 0 && (more == nil || more()) {
		if w := work.Load(); w != nil {
			w.clauseSteps.add("clause steps")
		}
		expr := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		if expr == nil || !visit(expr) {
			continue
		}
		children := exprChildren(expr)
		for i := len(children) - 1; i >= 0; i-- {
			pending = append(pending, children[i])
		}
	}
}

func queryTerms(body *domExpr) []*domTerm {
	var terms []*domTerm
	walkQueryBody(body, func(expr *domExpr) bool {
		for _, term := range []*domTerm{expr.Value, expr.Default, expr.Ends[0], expr.Ends[1]} {
			if term != nil {
				terms = append(terms, term)
			}
		}
		for _, requirement := range expr.Requirements {
			terms = append(terms, requirement.Value)
		}
		return true
	}, nil)
	return terms
}

func forestTerm(term *domTerm) bool {
	return term != nil && term.Kind == tmCall && (term.Str == "parse" || term.Str == "error-free" || term.Str == "ending-after" || term.Str == "local-readings")
}

func readingBody(expr *domExpr) *domExpr {
	if expr.Kind == exCapture {
		return readingBody(expr.Inner)
	}
	copied := *expr
	if expr.Inner != nil {
		copied.Inner = readingBody(expr.Inner)
	}
	if expr.Sep != nil {
		copied.Sep = readingBody(expr.Sep)
	}
	if expr.Items != nil {
		copied.Items = make([]*domExpr, len(expr.Items))
		for i, child := range expr.Items {
			copied.Items[i] = readingBody(child)
		}
	}
	return &copied
}
