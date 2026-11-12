package gencmu

import "strings"

func checkNodeTerm(term *domTerm) bool {
	for term != nil && term.Kind == tmCall && len(term.Items) == 1 {
		if term.Str != "parent" && term.Str != "preceding-node" && term.Str != "following-node" {
			return false
		}
		term = term.Items[0]
	}
	return term != nil && term.Kind == tmCapture
}
func checkElementTerm(term *domTerm) bool {
	return term != nil && term.Kind == tmCall && term.Str == "preceding-element" && len(term.Items) == 1 && checkNodeTerm(term.Items[0])
}

func (b *domBuilder) checkWrittenShape(root *Node) {
	pending := []*Node{root}
	for len(pending) > 0 {
		if w := work.Load(); w != nil {
			w.readerSteps.add("reader steps")
		}
		current := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		if current.Kind != KindRule {
			continue
		}
		switch current.Rule {
		case "parameter":
			b.fail(current, "an undeclared or malformed parameter")
		case "integer":
			if !validInteger(b.tokenValue(current)) {
				b.fail(current, "a malformed integer argument")
			}
		case "capture", "captured-terminator":
			if !captureName.MatchString(strings.TrimPrefix(b.tokenValue(current), "$")) {
				b.fail(current, "a malformed capture name")
			}
		case "method-selector":
			name := "parse"
			if head := b.one(current, "method-name"); head != nil {
				name = b.tokenValue(head)
			}
			if arguments := b.one(current, "method-arguments"); arguments != nil {
				for _, arg := range b.some(arguments, "method-argument", 0) {
					text := ""
					if arg.Span[0] >= 0 && arg.Span[0] < len(b.toks) {
						text = b.toks[arg.Span[0]].Value
					}
					if arg.Span[1]-arg.Span[0] == 1 && isRuleName(text, b.uni) && name != "classify" && name != "without-elision-except" && name != "followed-by" && name != "preceded-by" {
						b.fail(arg, "a malformed rule argument")
					}
					if b.one(arg, "integer") != nil && name != "ngrams" {
						b.fail(arg, "a malformed integer argument")
					}
				}
			}
		}
		parts := b.parts(current)
		for i := len(parts) - 1; i >= 0; i-- {
			pending = append(pending, parts[i])
		}
	}
}

func (b *domBuilder) check(node *Node) *domCheck {
	b.checkWrittenShape(node)
	previous := b.types
	b.checkContext, b.types = true, newTypeMemo()
	b.types.check = true
	defer func() { b.checkContext, b.types = false, previous }()
	for _, part := range b.parts(node) {
		if part.Kind != KindRule {
			continue
		}
		switch part.Rule {
		case "rule-name", "pattern-literal", "constant-reference", "conditions-clause", "error-clause", "warning-clause":
		default:
			b.fail(part, "a check has an unsupported clause")
		}
	}
	if len(b.some(node, "rule-name", 0)) != 1 || len(b.some(node, "conditions-clause", 0)) > 1 || len(b.some(node, "error-clause", 0))+len(b.some(node, "warning-clause", 0)) != 1 {
		b.fail(node, "a check requires one name and one diagnostic")
	}
	nameNode := b.only(node, "rule-name")
	name := b.tokenValue(b.token(nameNode))
	if !classifierName.MatchString(name) && !b.uni.isEmojiName(name) {
		b.fail(nameNode, "a check name starts with a lowercase letter or uses one eligible emoji")
	}
	var bodies []*Node
	for _, part := range b.parts(node) {
		if part.Rule == "pattern-literal" || part.Rule == "constant-reference" {
			bodies = append(bodies, part)
		}
	}
	if len(bodies) != 1 {
		b.fail(node, "a check requires one pattern")
	}
	check := &domCheck{Name: name, Pattern: b.term(bodies[0]), Conditions: []*domCond{}, At: b.at(node), PatternAt: b.at(bodies[0])}
	if clause := b.one(node, "conditions-clause"); clause != nil {
		for _, item := range b.some(clause, "condition", 1) {
			check.Conditions = append(check.Conditions, b.implication(item))
		}
	}
	if clause := b.one(node, "warning-clause"); clause != nil {
		check.Warning = b.recipe(b.only(clause, "recipe"))
	}
	if clause := b.one(node, "error-clause"); clause != nil {
		check.Error = b.recipe(b.only(clause, "recipe"))
	}

	return check
}

type stageCheck struct {
	doc        string
	definition *domCheck
}

func checkStageNames(docs []docDOM) *Error {
	checks, rules := map[string]bool{}, map[string]bool{}
	for _, document := range docs {
		for _, rule := range document.dom.Rules {
			rules[rule.Name] = true
		}
	}
	for _, document := range docs {
		for _, check := range document.dom.Checks {
			name := check.Name
			if checks[name] {
				return grammarError(document.path, check.At, "%%check %s is already defined", name)
			}
			if rules[name] {
				return grammarError(document.path, check.At, "a rule and a check cannot share the name %s", name)
			}
			checks[name] = true
		}
	}
	return nil
}

func checkDOMCheck(check *domCheck, uni *unicodeTable, expanded bool, document *domDoc) *domProblem {
	fail := func(message string) *domProblem { return &domProblem{message: message, at: check.At} }
	if !isRuleName(check.Name, uni) || check.Conditions == nil || (check.Warning == nil) == (check.Error == nil) {
		return fail("a malformed check")
	}
	if check.Warning != nil && !nameSyntaxFeature.MatchString(check.Name) {
		return fail("a warning code must be a feature name")
	}
	if check.Pattern == nil || check.Pattern.Kind != tmPattern && check.Pattern.Kind != tmConst {
		return fail("a check requires one pattern")
	}
	checker := &domChecker{check: true, structural: true, uni: uni, expanded: expanded, label: "check " + check.Name}
	for _, structural := range []bool{true, false} {
		checker.structural = structural
		checker.term(check.Pattern, 0, false)
		for _, condition := range check.Conditions {
			checker.condition(condition, 0)
		}
		checker.recipe(check.Warning)
		checker.recipe(check.Error)
		document.unresolved = document.unresolved || checker.unresolved
		if checker.problem != nil {
			checker.problem.at = check.At
			return checker.problem
		}
	}

	return nil
}

func checkCandidateProblem(pattern *domPattern) string {
	pending := []*domPattern{pattern}
	for len(pending) > 0 {
		node := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		if node.Kind == "never" {
			continue
		}
		if node.Kind == tmUnion || node.Kind == tmIntersection || node.Kind == tmDifference {
			pending = append(pending, node.Items...)
			continue
		}
		if !node.Exact || node.Kind == "path" {
			return "a check requires exact candidate tests without paths"
		}
	}
	return ""
}

func (g *stageGrammar) resolveCheck(index int) *Error {
	entry := &g.checks[index]
	check := *entry.definition
	at := check.PatternAt
	if at == [2]int{} {
		at = check.At
		if check.Pattern.At != [2]int{} {
			at = check.Pattern.At
		}
		if check.Pattern.Pattern != nil {
			found := false
			walkPattern(check.Pattern.Pattern, func(part *domPattern) {
				if part.At != [2]int{} && (!found || part.At[0] < at[0] || part.At[0] == at[0] && part.At[1] < at[1]) {
					at, found = part.At, true
				}
			})
		}
	}
	if check.Pattern.Kind == tmConst && g.constants[check.Pattern.Str] == nil {
		return g.constError(entry.doc, at, "$%s is not defined in stage %s", check.Pattern.Str, g.name)
	}
	roots := []clausePart{{t: check.Pattern}}
	for _, condition := range check.Conditions {
		roots = append(roots, clausePart{c: condition})
	}
	roots = append(roots, clausePart{t: check.Warning}, clausePart{t: check.Error})
	for _, root := range roots {
		var fault *Error
		walkClause(root, func(part clausePart) bool {
			if fault == nil && part.t != nil && part.t.Kind == tmConst && g.constants[part.t.Str] == nil {
				position := part.t.At
				if position == [2]int{} {
					position = check.At
				}
				fault = g.constError(entry.doc, position, "$%s is not defined in stage %s", part.t.Str, g.name)
			}
			return fault == nil
		})
		if fault != nil {
			return fault
		}
	}
	value, err := g.evaluateClosed(entry.doc, check.Pattern, at, tyPattern)
	if err != nil {
		return err
	}
	if value.ty != tyPattern {
		return g.constError(entry.doc, at, "a check requires one pattern")
	}
	if problem := checkCandidateProblem(value.pattern); problem != "" {
		return g.constError(entry.doc, at, problem)
	}
	check.Pattern = &domTerm{Kind: tmPattern, Pattern: value.pattern}
	var patternError *Error
	walkPattern(value.pattern, func(pattern *domPattern) {
		if patternError == nil && pattern.Kind == "name" && g.byName[pattern.Name] == nil {
			position := pattern.At
			if position == [2]int{} {
				position = check.At
			}
			patternError = g.constError(entry.doc, position, "%s is not a rule of stage %s", pattern.Name, g.name)
		}
	})
	if patternError != nil {
		return patternError
	}
	memo := newTypeMemo()
	memo.check = true
	for _, condition := range check.Conditions {
		if fault := condTypeMemo(condition, g.constantTypes(), memo); fault != nil {
			return g.faultError(entry.doc, fault.node, check.At, fault.problem)
		}
		if err := g.checkValueUses(entry.doc, valuePart{cond: condition}, check.At, false); err != nil {
			return err
		}
	}
	for _, recipe := range []*domTerm{check.Warning, check.Error} {
		if recipe == nil {
			continue
		}
		if _, fault := termTypeMemo(recipe, g.constantTypes(), memo); fault != nil {
			return g.faultError(entry.doc, fault.node, check.At, fault.problem)
		}
		if err := g.checkValueUses(entry.doc, valuePart{term: recipe}, check.At, false); err != nil {
			return err
		}
	}
	resolver := newResolver(g.constants, g.uni)
	check.Conditions, check.Warning, check.Error = resolver.condList(check.Conditions), resolver.term(check.Warning), resolver.term(check.Error)
	checked := &checkedClauses{terms: map[*domTerm]bool{}, conds: map[condListKey]bool{}, emits: map[*domEmit]bool{}}
	if err := g.checkAlt(&sAlt{doc: entry.doc, at: check.At, alt: &domAlt{Expr: &domExpr{Kind: exEmpty}}, conds: check.Conditions}, checked); err != nil {
		return err
	}
	entry.definition = &check
	return nil
}

// Missing names do not replace faults from the existing validation passes.
func (g *stageGrammar) checkConditionReferences() *Error {
	for _, entry := range g.checks {
		check := entry.definition
		for _, condition := range check.Conditions {
			var referenceError *Error
			walkClause(clausePart{c: condition}, func(part clausePart) bool {
				missing := func(name string, position [2]int) {
					if referenceError == nil && g.byName[name] == nil {
						if position == [2]int{} {
							position = check.At
						}
						referenceError = g.constError(entry.doc, position, "%s is not a rule of stage %s", name, g.name)
					}
				}
				if part.c != nil && part.c.Kind == cdBoundary {
					for _, target := range part.c.Targets {
						if target.Kind == tmRule {
							missing(target.Str, target.At)
						}
					}
				}
				if part.t != nil && part.t.Kind == tmPattern {
					walkPattern(part.t.Pattern, func(pattern *domPattern) {
						if pattern.Kind == "name" {
							missing(pattern.Name, pattern.At)
						}
					})
				}
				return referenceError == nil
			})
			if referenceError != nil {
				return referenceError
			}
		}
	}
	return nil
}

func sameCheckNode(left, right *domTerm) bool {
	for left.Kind == tmCall && right.Kind == tmCall && left.Str == right.Str && len(left.Items) == 1 && len(right.Items) == 1 {
		left, right = left.Items[0], right.Items[0]
	}
	return left.Kind == tmCapture && right.Kind == tmCapture && left.Str == right.Str
}
