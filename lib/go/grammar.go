package gencmu

import (
	"slices"
	"sort"
	"strings"
)

// A stage's grammar: its documents stitched into one set of rules,
// directives, constants, classifiers and implications (engine §2).
type stageFeature struct {
	doc       string
	directive *domDirective
}

type argumentSite struct {
	run int
	doc string
	at  [2]int
}

type defaultUse struct {
	expr        *domExpr
	alternative *sAlt
}

type stageGrammar struct {
	localTargets        map[*domExpr]string
	hasElements         bool
	checks              []stageCheck
	erasureChecks       []erasurePatternCheck
	erasurePatterns     []erasurePatternUse
	erasurePatternsDone bool
	queryTargets        map[*domExpr]string
	queryIdentities     map[*domExpr]string
	queryNames          map[string]string
	queryRules          []*sRule
	allRuleList         []*sRule
	defaults            []defaultUse
	treeComparisons     bool
	treeExpressions     bool
	arguments           map[argumentSite][]constArgument
	features            []stageFeature
	families            map[string]map[string]bool
	ranked              *rankedGroups
	deferredEmissions   []*Error
	templateDeferred    []*Error
	name                string
	uni                 *unicodeTable // the loader's table, for the tags of a range in a constant's value
	constants           map[string]*stageConst
	constVersions       []*constVersion
	constLatest         map[string]int
	rules               []*sRule
	byName              map[string]*sRule
	// steps are the key steps of the stage's %ambiguity-resolution, in
	// order, and lean its last step if that is greedy or lazy, or "" for no
	// lean (engine §6). elisionOnly says whether the stage declares
	// %elision-only (engine §7).
	steps       []keyStep
	lean        string
	elisionOnly bool
	changes     []stitchChange
	// classifierSet holds the stage's classifiers, and implications its
	// implications with their values (engine §2, §11).
	classifierSet stageClassifiers
	implications  []stageImplication
	// impliedBy indexes the implications by each tag of their if side.
	impliedBy map[string][]int
	// gates are the features that guard an alternative or an entry of a
	// classifier, in code point order. Only gates change a lowered grammar.
	// Productions retain all written warnings. Output selects enabled names
	// for each parse. Any other name matches no guard (engine §13).
	gates []string
}

// stitchChange records a rule a later item of the stage replaced or
// extended.
type stitchChange struct {
	rule, document, op string
}

type sRule struct {
	query bool
	name  string
	alts  []*sAlt
	doc   string
	at    [2]int
}

// sAlt is an alternative with the clauses of the rule statement that wrote
// it: an extension's alternatives keep the extension's own clauses.
type sAlt struct {
	definition           *domRule
	error, warning       *domTerm
	suppressWarnings     []string
	boundaryOwner        *sAlt
	boundarySites        map[*domCond]*boundarySite
	written              jobj
	writtenAlternative   int
	textOrder            int // order of alternatives across the stage documents
	alt                  *domAlt
	ruleTags             *domTerm
	emit                 *domEmit
	conds                []*domCond
	erased               bool
	ruleValue, ruleImage *domTerm
	doc                  string
	at                   [2]int
	// tests are the tests of its body with their values, in the order
	// testsIn lists them, from the constants' final values (engine §2, §4).
	tests []*symTest
}

// constValue is a constant's value (engine §2, §10): a string, or a set of
// strings or of tags, with its type.
type constValue struct {
	ty      termType // tyString, tyStrings or tyTags
	s       string
	pattern *domPattern
	names   []string // a set's members, in code point order, each once
}

type docDOM struct {
	path string
	dom  *domDoc
}

// maxAnd is the most items an & may join: it expands to 2ⁿ−1 sequences
// (engine §3.2, §9).
const maxAnd = 16

func isTerminalName(name string) bool {
	return isCapital(name) || engineTag(name)
}

func stitch(stageName string, docs []docDOM, uni *unicodeTable) (*stageGrammar, *Error) {
	grammar, err := stitchStage(stageName, docs, uni)
	if err != nil {
		err.Stage = stageName
	}
	return grammar, err
}

func stitchStage(stageName string, docs []docDOM, uni *unicodeTable) (*stageGrammar, *Error) {
	if err := checkStageNames(docs); err != nil {
		return nil, err
	}
	expanded, expansionError := expandTemplates(docs, uni)
	if expansionError != nil {
		expansionError.Stage = stageName
		return nil, expansionError
	}
	docs = expanded.docs
	g := &stageGrammar{name: stageName, uni: uni, constants: map[string]*stageConst{}, byName: map[string]*sRule{}}
	g.erasureChecks = expanded.erasureChecks
	g.arguments = map[argumentSite][]constArgument{}
	for _, argument := range expanded.arguments {
		key := argumentSite{argument.inspectionRun, argument.doc, argument.at}
		g.arguments[key] = append(g.arguments[key], argument)
	}
	g.classifierSet.names = map[string]bool{}
	type inspection struct {
		run   int
		at    [2]int
		kind  int
		check func() *Error
	}
	var checks []inspection
	schedule := func(run int, at [2]int, kind int, check func() *Error) {
		checks = append(checks, inspection{run, at, kind, check})
	}
	fail := func(doc string, at [2]int, format string, args ...any) *Error {
		e := grammarError(doc, at, format, args...)
		e.Stage = stageName
		return e
	}
	var ambiguity []*domDirective
	textOrder := 0
	for index, d := range docs {
		run := index
		if len(expanded.inspectionRuns) > 0 {
			run = expanded.inspectionRuns[index]
		}
		type item struct {
			at          [2]int
			rule        *domRule
			directive   *domDirective
			constant    *domConst
			classifier  *domClassifier
			implication *domImplication
			check       *domCheck
		}
		var items []item
		for _, x := range d.dom.Rules {
			items = append(items, item{at: x.At, rule: x})
		}
		for _, x := range d.dom.Directives {
			items = append(items, item{at: x.At, directive: x})
		}
		for _, x := range d.dom.Constants {
			items = append(items, item{at: x.At, constant: x})
		}
		for _, x := range d.dom.Classifiers {
			items = append(items, item{at: x.At, classifier: x})
		}
		for _, x := range d.dom.Implications {
			items = append(items, item{at: x.At, implication: x})
		}
		for _, check := range d.dom.Checks {
			items = append(items, item{at: check.At, check: check})
		}
		slices.SortStableFunc(items, func(a, b item) int {
			if a.at[0] != b.at[0] {
				return a.at[0] - b.at[0]
			}
			return a.at[1] - b.at[1]
		})
		for _, it := range items {
			if r := it.rule; r != nil {
				if len(constRefs(r)) > 0 || ruleHasPattern(r) || len(g.arguments[argumentSite{run, d.path, r.At}]) > 0 {
					user := constUser{inspectionRun: run, doc: d.path, rule: r}
					schedule(run, r.At, 0, func() *Error { return g.checkConstantRule(user) })
				} else if r.deferredEmission != nil {
					schedule(run, r.At, 0, func() *Error {
						g.deferredEmissions = append(g.deferredEmissions, fail(d.path, r.At, "%s", r.deferredEmission.message))
						return nil
					})
				}
				var written jobj
				for _, alternative := range r.Alternatives {
					if containsRanked(alternative.Expr) {
						w := &jsonWriter{}
						r.writeJSON(w)
						var err error
						written, err = decodeObj(w.buf)
						if err != nil {
							return nil, fail(d.path, r.At, "cannot retain the written rule DOM: %v", err)
						}
						break
					}
				}
				alts := make([]*sAlt, len(r.Alternatives))
				for i, a := range r.Alternatives {
					alts[i] = &sAlt{definition: r, error: r.Error, warning: r.Warning, suppressWarnings: r.SuppressWarnings, written: written, writtenAlternative: i, textOrder: textOrder, alt: a, ruleTags: r.Tags, emit: r.Emit, conds: r.Conditions, erased: r.Erased, ruleValue: r.Value, ruleImage: r.Image, doc: d.path, at: r.At}
					textOrder++
				}
				for _, a := range alts {
					a.boundaryOwner = alts[0]
				}
				existing := g.byName[r.Name]
				// Each way of stating a rule says what it expects to be there
				// already (engine §2).
				switch r.Op {
				case "define":
					if existing != nil {
						return nil, fail(d.path, r.At, "%%rule %s is already defined, in %s; %%redefine-rule replaces a rule", r.Name, existing.doc)
					}
					nr := &sRule{name: r.Name, alts: alts, doc: d.path, at: r.At}
					g.rules = append(g.rules, nr)
					g.byName[r.Name] = nr
				case "redefine":
					// It replaces the rule of that name any earlier item of the
					// stage defined, in this document or another (engine §2).
					if existing == nil {
						return nil, fail(d.path, r.At, "%%redefine-rule %s replaces no rule defined before it", r.Name)
					}
					// The replacement keeps the place of the rule it replaces.
					change := stitchChange{rule: r.Name, document: d.path, op: "replace"}

					g.changes = append(g.changes, change)
					existing.alts, existing.doc, existing.at = alts, d.path, r.At
				case "extend":
					if existing == nil {
						return nil, fail(d.path, r.At, "%%extend-rule %s extends a rule that is not defined before it", r.Name)
					}
					g.changes = append(g.changes, stitchChange{rule: r.Name, document: d.path, op: "extend"})
					existing.alts = append(existing.alts, alts...)
				default:
					return nil, fail(d.path, r.At, "unknown rule operator %q", r.Op)
				}
			} else if dir := it.directive; dir != nil {
				switch dir.Name {
				case "features":
					index := len(g.features)
					g.features = append(g.features, stageFeature{d.path, dir})
					schedule(run, dir.At, 1, func() *Error { return g.resolveFeature(index, run) })
				case "ambiguity-resolution":
					ambiguity = append(ambiguity, dir)
					if len(ambiguity) > 1 {
						return nil, fail(d.path, dir.At, "has a second %%ambiguity-resolution")
					}
					g.lean = ""
					g.steps = nil
					schedule(run, dir.At, 1, func() *Error {
						for _, step := range dir.Steps {
							if step.Pattern == nil {
								g.lean = step.Step
								continue
							}
							value, err := g.evaluateClosed(d.path, step.Pattern, dir.At, tyPattern)
							if err != nil {
								return err
							}
							position := step.Pattern.At
							if position == [2]int{} {
								position = dir.At
							}
							if value.ty != tyPattern {
								return g.constError(d.path, position, "a ranking step requires a pattern")
							}
							pattern := value.pattern
							if problem := rankingPatternProblem(pattern); problem != "" {
								return g.constError(d.path, position, problem)
							}
							if step.Step == "leftmost-longest" && requiresElided(pattern) {
								return g.constError(d.path, position, "leftmost-longest cannot require _Elided")
							}
							var fault *Error
							walkPattern(pattern, func(node *domPattern) {
								if fault == nil && node.Kind == "name" && g.byName[node.Name] == nil {
									fault = g.constError(d.path, node.At, "%s is not defined in stage %s", node.Name, g.name)
								}
							})
							if fault != nil {
								return fault
							}
							g.steps = append(g.steps, keyStep{step: step.Step, pattern: pattern})
						}
						return nil
					})
				case "elision-only":
					if g.elisionOnly {
						return nil, fail(d.path, dir.At, "has a second %%elision-only")
					}
					g.elisionOnly = true
				default:
					return nil, fail(d.path, dir.At, "unknown directive %%%s", dir.Name)
				}
			} else if k := it.constant; k != nil {
				if err := g.addConstant(d.path, k); err != nil {
					return nil, err
				}
			} else if c := it.classifier; c != nil {
				index := len(g.classifierSet.items)
				g.classifierSet.items = append(g.classifierSet.items, classifierItem{doc: d.path, classifier: c})
				g.classifierSet.names[c.Name] = true
				schedule(run, c.At, 3, func() *Error { return g.resolveClassifierKeys(index) })
			} else if check := it.check; check != nil {
				entry := stageCheck{doc: d.path, definition: check}
				index := len(g.checks)
				g.checks = append(g.checks, entry)
				schedule(run, check.At, 5, func() *Error { return g.resolveCheck(index) })
			} else {
				implication := implicationItem{doc: d.path, implication: it.implication}
				schedule(run, it.implication.At, 4, func() *Error { return g.addImplications([]implicationItem{implication}) })
			}
		}
	}
	for _, user := range expanded.validation {
		if user.rule.Params != nil || len(constRefs(user.rule)) > 0 || ruleHasPattern(user.rule) || len(g.arguments[argumentSite{user.inspectionRun, user.doc, user.rule.At}]) > 0 {
			schedule(user.inspectionRun, user.rule.At, 0, func() *Error { return g.checkConstantRule(user) })
		}
	}
	for _, argument := range expanded.arguments {
		key := argumentSite{argument.inspectionRun, argument.doc, argument.at}
		schedule(key.run, key.at, argument.kind, func() *Error {
			uses := g.arguments[key]
			delete(g.arguments, key)
			if len(uses) > 0 {
				return g.checkArguments(uses)
			}
			return nil
		})
	}

	slices.SortStableFunc(checks, func(a, b inspection) int {
		if a.run != b.run {
			return a.run - b.run
		}
		if a.at[0] != b.at[0] {
			return a.at[0] - b.at[0]
		}
		if a.at[1] != b.at[1] {
			return a.at[1] - b.at[1]
		}
		return a.kind - b.kind
	})
	functions := make([]func() *Error, len(checks))
	for index, item := range checks {
		functions[index] = item.check
	}
	if err := g.resolveConstants(functions); err != nil {
		return nil, err
	}
	g.indexImplications()
	if len(ambiguity) == 0 {
		e := &Error{Kind: "grammar", Stage: stageName, Message: "has no %ambiguity-resolution"}
		return nil, e
	}
	if g.byName["text"] == nil {
		e := &Error{Kind: "grammar", Stage: stageName, Message: "has no rule text"}
		return nil, e
	}
	if expanded.order != nil {
		ordered := make([]*sRule, 0, len(expanded.order))
		for _, name := range expanded.order {
			ordered = append(ordered, g.byName[name])
		}
		g.rules = ordered
	}

	if err := g.checkDiagnosticsAndSplices(); err != nil {
		return nil, err
	}
	if err := g.validateBoundaryTargets(); err != nil {
		return nil, err
	}
	checked := &checkedClauses{terms: map[*domTerm]bool{}, conds: map[condListKey]bool{}, emits: map[*domEmit]bool{}}
	for _, r := range g.rules {
		for _, a := range r.alts {
			if err := g.checkAlt(a, checked); err != nil {
				err.Stage = stageName
				return nil, err
			}
		}
	}
	if err := g.prepareBodyQueries(); err != nil {
		return nil, err
	}
	g.resolveFamilies()
	if err := g.makeTests(); err != nil {
		return nil, err
	}
	var gates, entries []domGate
	for _, it := range g.classifierSet.items {
		for _, e := range it.classifier.Entries {
			entries = append(entries, e.Gates...)
		}
	}
	for _, r := range g.rules {
		for _, a := range r.alts {
			gates = append(gates, a.alt.Gates...)
		}
	}
	// The gates of an entry are all gates (engine §2).
	g.classifierSet.gates = gateNames(entries)
	g.gates = gateNames(append(gates, entries...))
	g.ranked = newRankedGroups(g)
	if len(g.ranked.groups) > 0 {
		if err := g.ranked.validateTags(g); err != nil {
			return nil, err
		}
	}
	// Ranked scope errors precede deferred emissions and recipe cycles (§11.4).
	if len(g.deferredEmissions) > 0 {
		return nil, g.deferredEmissions[0]
	}
	if len(g.templateDeferred) > 0 {
		return nil, g.templateDeferred[0]
	}
	if err := g.validateRecipeCycles(); err != nil {
		return nil, err
	}
	if err := g.validateEmissionOverlap(); err != nil {
		return nil, err
	}
	if err := g.nullableError(); err != nil {
		return nil, err
	}
	g.treeExpressions = checked.treeComparisons
	if checked.treeComparisons {
		for _, rule := range g.rules {
			for _, alternative := range rule.alts {
				if len(constituentComparisons(clausePart{t: alternative.ruleTags})) > 0 || len(constituentComparisons(clausePart{t: alternative.alt.Tags})) > 0 {
					g.treeComparisons = true
				}
				for _, condition := range alternative.conds {
					g.treeComparisons = g.treeComparisons || len(constituentComparisons(clausePart{c: condition})) > 0
				}
			}
		}
	}
	g.prepareBoundarySites()
	return g, nil
}

// makeTests gives each test of the stitched stage's bodies its value, made
// once for every lowering.
func (g *stageGrammar) makeTests() *Error {
	for _, r := range g.allRules() {
		for _, a := range r.alts {
			for _, t := range testsIn(a.alt.Expr) {
				st := &symTest{op: t.Op}
				if t.Op == "tags" {
					var written []string
					for _, r := range t.Requirements {
						v, err := g.evaluateClosed(a.doc, r.Value, a.at)
						if err != nil {
							return err
						}
						if v.ty != tyTags && v.ty != tySet {
							return g.faultError(a.doc, r.Value, a.at, "a tag requirement requires a tag set")
						}
						for _, name := range v.names {
							st.requirements = append(st.requirements, resolvedRequirement{name: name, negated: r.Negated})
							prefix := ""
							if r.Negated {
								prefix = "¬"
							}
							written = append(written, prefix+name)
						}
					}
					sort.Slice(st.requirements, func(i, j int) bool {
						a, b := st.requirements[i], st.requirements[j]
						return a.name < b.name || a.name == b.name && !a.negated && b.negated
					})
					written = nil
					var last *resolvedRequirement
					for i, r := range st.requirements {
						if last != nil && *last == r {
							continue
						}
						last = &st.requirements[i]
						prefix := ""
						if r.negated {
							prefix = "¬"
						}
						written = append(written, prefix+r.name)
					}
					st.written = "<" + strings.Join(written, " ") + ">"
				} else {
					v, err := g.evaluateClosed(a.doc, t.Value, a.at)
					if err != nil {
						return err
					}
					st.sound = v.s
					st.written = t.Op + stringTerminal(v.s, g.uni)
				}
				a.tests = append(a.tests, st)
			}
		}
	}
	for _, use := range g.defaults {
		a := use.alternative
		lw := &lowerer{g: g, l: &lowered{}, tests: map[*domExpr]*symTest{}}
		for i, t := range testsIn(a.alt.Expr) {
			lw.tests[t] = a.tests[i]
		}
		lw.elision(use.expr, a)
		if lw.l.fault != "" {
			return lw.l.faultLocation
		}
	}
	g.defaults = nil
	return nil
}

// checkedClauses are the clauses that checkAlt has found sound, by
// identity. The clauses of a rule statement are shared by its
// alternatives, so each is walked once, not once for each alternative.
type checkedClauses struct {
	treeComparisons bool
	terms           map[*domTerm]bool
	conds           map[condListKey]bool
	emits           map[*domEmit]bool
}

// checkAlt checks what the notation's grammar cannot state: every rule named
// is defined.
func (g *stageGrammar) checkAlt(a *sAlt, checked *checkedClauses) *Error {
	fail := func(format string, args ...any) *Error { return grammarError(a.doc, a.at, format, args...) }
	var walk func(e *domExpr) *Error
	walk = func(e *domExpr) *Error {
		if e == nil {
			return nil
		}
		if e.Default != nil {
			g.defaults = append(g.defaults, defaultUse{e, a})
		}
		if e.Kind == exRef && !isTerminalName(e.Name) && g.byName[e.Name] == nil {
			return fail("%s is not a rule of stage %s", e.Name, g.name)
		}
		for _, it := range e.Items {
			if err := walk(it); err != nil {
				return err
			}
		}
		// A tested symbol refers to what its symbol does.
		if err := walk(e.Inner); err != nil {
			return err
		}
		return walk(e.Sep)
	}
	if err := walk(a.alt.Expr); err != nil {
		return err
	}
	var checkTerm func(t *domTerm) *Error
	var checkCond func(c *domCond) *Error
	checkTerm = func(t *domTerm) *Error {
		if t == nil {
			return nil
		}
		if w := work.Load(); w != nil {
			w.clauseSteps.add("clause steps")
		}
		if t.Kind == tmCall && t.Str == "without-elision-except" {
			if g.families == nil {
				g.families = map[string]map[string]bool{}
			}
			g.families[t.Items[1].Str] = nil
		}
		if t.Kind == tmRule && g.byName[t.Str] == nil {
			return fail("%s is not a rule of stage %s", t.Str, g.name)
		}
		// A parse body in a term names its rules here, in written
		// order, as a shorthand target did (§2).
		if t.Kind == tmBody && t.Body != nil {
			if err := walk(t.Body); err != nil {
				return err
			}
		}
		// A classifier that classify names belongs to the stage (§2).
		if t.Kind == tmClassifier && !g.classifierSet.names[t.Str] {
			return fail("%s is not a classifier of stage %s", t.Str, g.name)
		}
		if t.Cond != nil {
			if err := checkCond(t.Cond); err != nil {
				return err
			}
		}
		for _, it := range t.Items {
			if err := checkTerm(it); err != nil {
				return err
			}
		}
		return nil
	}
	checkCond = func(c *domCond) *Error {
		if w := work.Load(); w != nil {
			w.clauseSteps.add("clause steps")
		}
		switch c.Kind {
		case cdTruthy:
			return checkTerm(c.Left)
		case cdForest:
			return checkTerm(c.Left)
		case cdCompare:
			if (c.Op == "≅" || c.Op == "≇") && c.Right.Kind == tmCapture {
				checked.treeComparisons = true
			}
			if err := checkTerm(c.Left); err != nil {
				return err
			}
			return checkTerm(c.Right)
		case cdWhole, cdPrefix, cdSuffix:
			if err := checkTerm(c.Span); err != nil {
				return err
			}
			for _, t := range c.queryTargets() {
				if t.Kind == tmRule && g.byName[t.Str] == nil {
					return fail("%s is not a rule of stage %s", t.Str, g.name)
				}
			}
			return nil
		case cdPresent, cdInitial, cdEnd:
			return checkTerm(c.Span)
		case cdNot:
			return checkCond(c.Inner)
		case cdAny, cdAll, cdIf:
			for _, it := range c.Items {
				if err := checkCond(it); err != nil {
					return err
				}
			}
		}
		return nil
	}
	for _, t := range []*domTerm{a.alt.Tags, a.ruleTags} {
		if t == nil || checked.terms[t] {
			continue
		}
		if err := checkTerm(t); err != nil {
			return err
		}
		checked.terms[t] = true
	}
	if len(a.conds) > 0 {
		if key := (condListKey{&a.conds[0], len(a.conds)}); !checked.conds[key] {
			for _, c := range a.conds {
				if err := checkCond(c); err != nil {
					return err
				}
			}
			checked.conds[key] = true
		}
	}
	if a.emit != nil && !checked.emits[a.emit] {
		for _, it := range a.emit.Items {
			if err := checkTerm(it.Tags); err != nil {
				return err
			}
		}
		checked.emits[a.emit] = true
	}
	return nil
}
