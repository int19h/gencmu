package gencmu

import (
	"fmt"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"
)

// The DOM of a grammar document, when it did not come from reading the
// document (the bootstrap's, or a preparsed one from data/preparsed/FAMILY.json), is
// held to every rule the reader enforces (engine §9, docs/output.md "A
// grammar DOM"), so that a malformed one is refused rather than lowered: a
// bad cache entry is then a miss, and a bad bootstrap a load error.

// maxDOMDepth is how deep an expression, a term or a condition may nest
// (engine §9): no node of one may lie below more than 256 compound nodes
// of it. A node's depth is the number of compound nodes above it, 0 for
// the one a rule, an alternative or a clause holds; every node with
// children, a capture and a call included, is compound, and ( ) makes no
// node.
const maxDOMDepth = 256

type notationName struct{ *regexp.Regexp }

func (p notationName) MatchString(text string) bool {
	return !strings.Contains(text, "--") && p.Regexp.MatchString(text)
}

var nameSyntaxFeature = notationName{regexp.MustCompile(`^[A-Za-z][A-Za-z0-9-]*$`)}

var domName = notationName{regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_-]*$`)}

// captureName is the syntax of a capture's name, all lower case (engine §9).
var captureName = notationName{regexp.MustCompile(`^[a-z][a-z0-9_-]*$`)}

// domProblem is why a DOM is malformed; tooDeep marks the nesting limit,
// the one problem a DOM the reader built can have.
type domProblem struct {
	at          [2]int
	code        string
	message     string
	rule        *domRule
	constant    *domConst
	implication *domImplication
	tooDeep     bool
}

func (p *domProblem) Error() string { return p.message }

func validateDOM(d *domDoc, uni *unicodeTable) error {
	if p := checkDOM(d, uni); p != nil {
		return p
	}
	return nil
}

// checkDOM holds supplied and cached DOMs to engine §9.
func checkDOM(d *domDoc, uni *unicodeTable) *domProblem { return checkDOMMode(d, uni, false) }
func checkDOMMode(d *domDoc, uni *unicodeTable, expanded bool) *domProblem {
	d.unresolved = false
	for _, r := range d.Rules {
		if r == nil {
			return &domProblem{message: "a malformed rule"}
		}
	}
	for _, dir := range d.Directives {
		if dir == nil {
			return &domProblem{message: "a malformed directive"}
		}
	}
	for _, k := range d.Constants {
		if k == nil {
			return &domProblem{message: "a malformed constant"}
		}
	}
	for _, c := range d.Classifiers {
		if c == nil {
			return &domProblem{message: "a malformed classifier"}
		}
	}
	for _, m := range d.Implications {
		if m == nil {
			return &domProblem{message: "a malformed implication"}
		}
	}
	// The order of a document's items is the order of their positions, so
	// no two items share one (engine §9.3 step 5): rules, directives,
	// constants, classifiers and implications, in that order.
	positions := map[[2]int]bool{}
	var twice *domProblem
	place := func(at [2]int) {
		if twice == nil && positions[at] {
			twice = &domProblem{message: "two items at one position", at: at}
		}
		positions[at] = true
	}
	for _, r := range d.Rules {
		place(r.At)
	}
	for _, dir := range d.Directives {
		place(dir.At)
	}
	for _, k := range d.Constants {
		place(k.At)
	}
	for _, c := range d.Classifiers {
		place(c.At)
	}
	for _, m := range d.Implications {
		place(m.At)
	}
	if twice != nil {
		return twice
	}
	namesPositions := map[[2]int]bool{}
	for _, dir := range d.Directives {
		if dir.Name == "names" {
			namesPositions[dir.At] = true
		}
	}
	firstStatement := [2]int{}
	for at := range positions {
		if !namesPositions[at] && (firstStatement == [2]int{} || before(at, firstStatement)) {
			firstStatement = at
		}
	}
	var lateNames *domDirective
	for _, dir := range d.Directives {
		if dir.Name == "names" && firstStatement != [2]int{} && before(firstStatement, dir.At) && (lateNames == nil || before(dir.At, lateNames.At)) {
			lateNames = dir
		}
	}
	if lateNames != nil {
		return &domProblem{message: "%names must precede every other statement", at: lateNames.At}
	}
	// Each declaration, in the order of its position, gets its structural
	// checks and then its semantic ones (engine §9.3 step 5). run sets
	// *semantic before it returns a semantic fault.
	type inspection struct {
		at  [2]int
		run func(semantic *bool) *domProblem
	}
	var inspections []inspection
	var firstDeep *domProblem
	noteDeep := func(c *domChecker) {
		if firstDeep == nil && c.deepProblem != nil {
			firstDeep = c.deepProblem
		}
	}
	for _, dir := range d.Directives {
		inspections = append(inspections, inspection{dir.At, func(semantic *bool) *domProblem {
			if p := directiveHeaderProblem(dir); p != "" {
				return &domProblem{message: p, at: dir.At}
			}
			if dir.Conditions == nil {
				return nil
			}
			// Every fault in a feature condition stands at its directive.
			checker := &domChecker{uni: uni, label: "%features", deferTypes: true, featureAt: dir.At}
			for _, condition := range dir.Conditions {
				checker.condition(condition, 0)
				if checker.problem != nil {
					return checker.problem
				}
			}
			d.unresolved = d.unresolved || checker.unresolved
			*semantic = true
			if checker.argCapture != nil {
				checker.argCapture.at = dir.At
				return checker.argCapture
			}
			if checker.deepProblem != nil {
				checker.deepProblem.at = dir.At
			}
			noteDeep(checker)
			return nil
		}})
	}
	// A classifier: its name, and entries of gates, exact string keys, an
	// operator and a class (engine §2, §9).
	for _, c := range d.Classifiers {
		inspections = append(inspections, inspection{c.At, func(*bool) *domProblem {
			if !classifierName.MatchString(c.Name) || c.Entries == nil {
				at := c.nameAt
				if at == [2]int{} {
					at = c.At
				}
				if c.Entries != nil {
					return &domProblem{message: c.Name + " begins with a capital, so it is a tag; a classifier's name begins with a lower-case letter", at: at}
				}
				return &domProblem{message: "a malformed classifier", at: at}
			}
			for _, e := range c.Entries {
				if p := entryProblem(e, uni); p != nil {
					if p.at == [2]int{} {
						p.at = c.At
						if e != nil && e.At != [2]int{} {
							p.at = e.At
						}
					}
					return p
				}
			}
			return nil
		}})
	}
	for _, r := range d.Rules {
		if r == nil {
			return &domProblem{message: "a malformed rule"}
		}
		inspections = append(inspections, inspection{r.At, func(semantic *bool) *domProblem {
			// The header, then its head call, tags, value, image,
			// alternatives, conditions, diagnostic and emission, each
			// with what it holds (engine §9.3 step 5).
			c := &domChecker{rule: r, label: "rule " + r.Name, uni: uni, expanded: expanded, declAt: r.At}
			c.sourceHead(r)
			if c.problem == nil && (r.Op != "define" && r.Op != "redefine" && r.Op != "extend" || r.Instance != nil && r.Op == "extend" || r.Instance == nil && len(r.Alternatives) == 0) {
				at := r.nameAt
				if at == [2]int{} {
					at = r.At
				}
				c.failAt(at, "a malformed rule")
			}
			if c.problem == nil && r.Instance == nil {
				if r.Error != nil && r.Warning != nil || r.Params != nil && (r.Error != nil || r.Warning != nil) {
					c.fail("a definition accepts one diagnostic, and a template accepts none")
				}
				if r.SuppressWarnings != nil {
					if len(r.SuppressWarnings) == 0 {
						c.fail("a malformed warning suppression")
					}
					for _, code := range r.SuppressWarnings {
						if code == "_" && len(r.SuppressWarnings) != 1 || code != "_" && !nameSyntaxFeature.MatchString(code) {
							c.fail("a malformed warning suppression")
						}
					}
				}
			}
			if c.problem == nil {
				c.sourceHeadCalls(r)
			}
			d.unresolved = d.unresolved || c.unresolved
			if r.Instance != nil {
				if c.problem != nil {
					return c.problem
				}
				*semantic = true
				if c.argCapture != nil {
					return c.argCapture
				}
				noteDeep(c)
				return nil
			}
			c.constituentTags(r.Tags)
			c.recipe(r.Value)
			c.recipe(r.Image)
			for _, a := range r.Alternatives {
				if a == nil || a.Gates == nil {
					c.fail("a malformed alternative")
					continue
				}
				// A guard is a gate or a warning, and a warning has no negated
				// form. Its feature is a name (§9).
				for _, g := range a.Gates {
					if g.Kind != FeatureGate {
						c.fail("a malformed guard")
					}
					if !nameSyntaxFeature.MatchString(g.Feature) {
						c.fail("a malformed guard: a guard's feature is a name")
					}
				}
				c.expr(a.Expr, 0, true, false, false, false, false)
				c.constituentTags(a.Tags)
				c.recipe(a.Value)
				c.recipe(a.Image)
			}
			for _, cond := range r.Conditions {
				c.condition(cond, 0)
			}
			for _, recipe := range []*domTerm{r.Error, r.Warning} {
				if recipe != nil && c.problem == nil && recipe.Kind == tmConcat && len(recipe.Items) > 0 && messageReadsEmitted(recipe) {
					c.failAt(recipe.ClauseAt, "a message recipe cannot read .emitted")
				}
				c.recipe(recipe)
			}
			c.emission(r.Emit)
			if c.problem != nil {
				return c.problem
			}

			if c.unresolved && !c.ruleName(r.Name) {
				return &domProblem{message: "a malformed rule name", rule: r}
			}
			*semantic = true
			d.unresolved = d.unresolved || c.unresolved
			// The semantic pass of §9.3 step 5, in its order: the header
			// tag clause, then each alternative's duplicate and repeated
			// item captures and its tag clause, then rule type
			// inspection, emission duplicates, boundary atoms, erased
			// emission, and whole-definition inspection.
			if p := tagClauseSemantic(r.Tags, r); p != nil {
				return p
			}
			for _, a := range r.Alternatives {
				if twice := duplicateCaptures(a.Expr); len(twice) > 0 {
					var first *domExpr
					for _, capture := range allCaptures(a.Expr) {
						if !twice[capture] {
							continue
						}
						if first == nil || capture.At != [2]int{} && (first.At == [2]int{} || before(capture.At, first.At)) {
							first = capture
						}
					}
					return &domProblem{message: fmt.Sprintf("the capture $%s is read twice by one production of the alternative", first.Name), rule: r, at: first.At}
				}
				if repeated := repeatedItemCapture(a.Expr); repeated != nil {
					return &domProblem{message: fmt.Sprintf("the item capture $%s is read again: the name of an item capture stands once in its alternative", repeated.Name), rule: r, at: repeated.At}
				}
				if p := tagClauseSemantic(a.Tags, r); p != nil {
					return p
				}
			}
			if c.argCapture != nil {
				return c.argCapture
			}
			// The values of its tests, once the nesting is bounded (engine §9).
			for _, t := range c.tests {
				if f := testValueFault(t.Op, t.Value); f != nil {
					return &domProblem{message: fmt.Sprintf("rule %s: %s", r.Name, f.problem), rule: r}
				}
			}
			checked := r
			if c.unresolved {
				checked = partialSourceRule(r)
			}
			if f := ruleTypeFault(checked, nil); f != nil {
				return &domProblem{message: f.problem, rule: r, at: faultNodeAt(f.node)}
			}
			if checked != r {
				// A partial rule replaces a call recipe atom with an
				// unresolved constant, so the atom's shape is checked
				// on the rule as written.
				for _, recipe := range ruleRecipes(r) {
					for _, atom := range recipe.Items {
						if f := recipeAtomFault(atom); f != nil {
							return &domProblem{message: f.problem, rule: r, at: faultNodeAt(f.node)}
						}
					}
				}
			}
			if r.Emit != nil {
				listed := map[string]bool{}
				for _, it := range r.Emit.Items {
					if it == nil {
						continue
					}
					names := it.attachments()
					if it.Capture != "" {
						names = append([]string{it.Capture}, names...)
					}
					for _, name := range names {
						if listed[name] {
							return &domProblem{message: "an emission lists a capture twice", rule: r, at: r.Emit.At}
						}
						listed[name] = true
					}
				}
			}
			if !c.unresolved && c.hasBoundary {
				if atom, msg := boundaryRuleProblem(r); msg != "" {
					return &domProblem{message: msg, rule: r, at: faultNodeAt(atom)}
				}
			}
			if c.unresolved {
				if atom, msg := boundaryRuleProblem(checked); msg != "" {
					return &domProblem{message: msg, rule: r, at: faultNodeAt(atom)}
				}
			}
			if r.Erased && (r.Emit != nil || r.Value != nil || r.Image != nil) {
				return &domProblem{message: "a malformed erased rule", rule: r}
			}
			if r.Erased && slices.ContainsFunc(r.Alternatives, func(a *domAlt) bool { return a.Value != nil || a.Image != nil }) {
				return &domProblem{message: "a recipe beside erasure", rule: r}
			}
			result := checkDefinition(checked, true)
			r.deferredEmission = result.deferred
			if result.problem != nil {
				return &domProblem{message: result.problem.message, rule: r}
			}
			noteDeep(c)
			return nil
		}})
	}
	// A constant's definition: its name, its op, and a value that is a
	// closed term of a type that a constant can have (engine §2, §10).
	for _, k := range d.Constants {
		inspections = append(inspections, inspection{k.At, func(semantic *bool) *domProblem {
			if !constName.MatchString(k.Name) || (k.Op != "define" && k.Op != "redefine") || k.Value == nil {
				at := k.NameAt
				if at == [2]int{} {
					at = k.At
				}
				if !constName.MatchString(k.Name) {
					return &domProblem{message: "a constant requires a user name", constant: k, at: at}
				}
				return &domProblem{message: "a malformed constant", constant: k, at: at}
			}
			c := &domChecker{constant: k, label: "constant $" + k.Name, uni: uni}
			c.term(k.Value, 0, false)
			if c.problem != nil {
				return c.problem
			}
			*semantic = true
			d.unresolved = d.unresolved || c.unresolved
			if c.argCapture != nil {
				return c.argCapture
			}
			// Closedness and engine-tag literals in one walk, then the
			// value's type (engine §9.3 step 5).
			if p := closedTermFault(k.Value, "a constant's value", k.At); p != nil {
				p.constant = k
				return p
			}
			if _, f := constantValueType(k.Value, k.Op == "redefine", nil); f != nil {
				at := faultNodeAt(f.node)
				if at == [2]int{} {
					at = k.Value.At
				}
				return &domProblem{message: f.problem, constant: k, at: at}
			}
			noteDeep(c)
			return nil
		}})
	}
	// An implication: two closed terms whose type is a tag set, checked
	// once the nesting is bounded (engine §2, §9).
	for _, m := range d.Implications {
		inspections = append(inspections, inspection{m.At, func(semantic *bool) *domProblem {
			c := &domChecker{implication: m, label: "an implication", uni: uni}
			for _, side := range []*domTerm{m.If, m.Then} {
				if side == nil {
					return &domProblem{message: "a malformed implication", implication: m}
				}
				c.term(side, 0, false)
			}
			if c.problem != nil {
				return c.problem
			}
			*semantic = true
			d.unresolved = d.unresolved || c.unresolved
			if c.argCapture != nil {
				return c.argCapture
			}
			for _, side := range []*domTerm{m.If, m.Then} {
				sideAt := side.At
				if sideAt == [2]int{} {
					sideAt = m.At
				}
				if p := closedTermFault(side, "a side of an implication", sideAt); p != nil {
					p.implication = m
					return p
				}
				if f := implicationSideFault(side, nil); f != nil {
					at := faultNodeAt(f.node)
					if at == [2]int{} {
						at = sideAt
					}
					return &domProblem{message: f.problem, implication: m, at: at}
				}
			}
			noteDeep(c)
			return nil
		}})
	}
	for _, dir := range d.Directives {
		if dir.Name != "ambiguity-resolution" {
			continue
		}
		inspections = append(inspections, inspection{dir.At, func(semantic *bool) *domProblem {
			c := &domChecker{uni: uni, label: "%ambiguity-resolution", expanded: expanded}
			for _, step := range dir.Steps {
				if step.Pattern != nil {
					c.term(step.Pattern, 0, false)
				}
			}
			if c.problem != nil {
				c.problem.at = dir.At
				return c.problem
			}
			d.unresolved = d.unresolved || c.unresolved
			*semantic = true
			if c.argCapture != nil {
				return c.argCapture
			}
			noteDeep(c)
			return nil
		}})
	}
	// The first fault stands, except that a ranked-choice syntax fault
	// in a later declaration replaces an earlier semantic one. The depth
	// bound is reported only when no other fault stands (engine §9.3).
	slices.SortStableFunc(inspections, func(a, b inspection) int { return slices.Compare(a.at[:], b.at[:]) })
	var firstSemantic *domProblem
	for _, inspection := range inspections {
		semantic := false
		problem := inspection.run(&semantic)
		if problem == nil {
			continue
		}
		if !semantic && problem.code == "ranked-choice-syntax" {
			return problem
		}
		if !semantic && strings.HasSuffix(problem.message, "split has an empty delimiter") {
			semantic = true
		}
		if firstSemantic == nil {
			if !semantic {
				return problem
			}
			firstSemantic = problem
		}
	}
	if firstSemantic != nil {
		return firstSemantic
	}
	return firstDeep
}

// closedTermFault is the first part of a constant's value or a side of
// an implication, in written order, that a closed term cannot hold: a
// capture, a guarded term, an engine-tag literal, or an input method
// (engine §9.3 step 5). A pattern's own values are not walked. at is
// the position of the enclosing node.
func closedTermFault(t *domTerm, closedFor string, at [2]int) *domProblem {
	if t == nil {
		return nil
	}
	if t.At != [2]int{} {
		at = t.At
	}
	switch {
	case t.Kind == tmCapture:
		return &domProblem{message: closedFor + " is a closed term, and holds no capture", at: at}
	case t.Kind == tmIf:
		return &domProblem{message: closedFor + " is a closed term, and holds no guarded term", at: at}
	case t.Kind == tmTag && strings.HasPrefix(t.Str, "_"):
		return &domProblem{message: closedFor + " cannot contain an engine-tag literal", at: at}
	case t.Kind == tmPattern:
		return nil
	case t.Kind == tmCall:
		if t.Str != "split" && t.Str != "ngrams" {
			if len(t.Items) > 0 {
				if p := closedTermFault(t.Items[0], closedFor, at); p != nil {
					return p
				}
			}
			return &domProblem{message: closedFor + " cannot read an input method", at: at}
		}
	case t.Kind == tmUnion || t.Kind == tmIntersection || t.Kind == tmDifference || t.Kind == tmConcat:
	default:
		return nil
	}
	for _, it := range t.Items {
		if p := closedTermFault(it, closedFor, at); p != nil {
			return p
		}
	}
	return nil
}

// tagClauseSemantic is the semantic fault of one tag clause, or nil:
// its type first, then whether it reads the tags it defines (engine
// §9.3 step 5).
func tagClauseSemantic(t *domTerm, r *domRule) *domProblem {
	if t == nil {
		return nil
	}
	if f := tagTermFault(t, nil); f != nil {
		at := faultNodeAt(f.node)
		if at == [2]int{} {
			at = t.ClauseAt
		}
		return &domProblem{message: f.problem, rule: r, at: at}
	}
	if readsOwnTags(t) {
		at := t.ClauseAt
		if at == [2]int{} {
			at = t.At
		}
		return &domProblem{message: "a constituent's tags cannot be made of its own: $.tags or $.classes", rule: r, at: at}
	}
	return nil
}

// faultNodeAt is the position a type fault's node carries, or the zero
// position, in which case the declaration's position stands.
func faultNodeAt(node any) [2]int {
	switch n := node.(type) {
	case *domTerm:
		if n != nil {
			// A tag clause's term whose own type is not a tag set stands
			// where it is written, parentheses and all.
			if n.TagAt != [2]int{} {
				if _, inner := termTypeIn(n, nil); inner == nil {
					return n.TagAt
				}
			}
			return n.At
		}
	case *domExpr:
		if n != nil {
			return n.At
		}
	case *domCond:
		if n != nil {
			return n.At
		}
	}
	return [2]int{}
}

// repeatedItemCapture is the later capture, in written order, whose name
// is an item capture that stands again in its alternative, or nil.
func repeatedItemCapture(e *domExpr) *domExpr {
	items := itemCaptures(e)
	if len(items) == 0 {
		return nil
	}
	seen := map[string]bool{}
	for _, capture := range allCaptures(e) {
		if _, item := items[capture.Name]; !item {
			continue
		}
		if seen[capture.Name] {
			return capture
		}
		seen[capture.Name] = true
	}
	return nil
}

// classifierName is the syntax of a classifier's name, which begins with a
// lower-case letter, and className that of a class, which begins with a
// capital (engine §2, §9).
var (
	classifierName = notationName{regexp.MustCompile(`^[a-z][A-Za-z0-9_-]*$`)}
	className      = notationName{regexp.MustCompile(`^[A-Z][A-Za-z0-9_-]*$`)}
)

// entryProblem validates classifier gates, keys, operators, and classes.
// Each key is a string term. Each class starts and ends uppercase.
func entryProblem(e *domEntry, uni *unicodeTable) *domProblem {
	if e == nil || e.Gates == nil || (e.Op != "∈" && e.Op != "∉") || len(e.KeyTerms) == 0 {
		return &domProblem{message: "a malformed classifier entry"}
	}
	for _, g := range e.Gates {
		if g.Kind != FeatureGate || !nameSyntaxFeature.MatchString(g.Feature) {
			return &domProblem{message: "a malformed classifier entry"}
		}
	}
	for _, key := range e.KeyTerms {
		if !stringTermShape(key) {
			return &domProblem{message: "a malformed classifier key", at: key.At}
		}
	}
	// The keys' terms, then the class (engine §9.3 step 5).
	for _, key := range e.KeyTerms {
		c := &domChecker{uni: uni, at: e.At}
		c.term(key, 0, false)
		if c.problem != nil {
			return c.problem
		}
	}
	if !className.MatchString(e.Class) || !isClass(e.Class) {
		at := e.classAt
		if at == [2]int{} {
			at = e.At
		}
		return &domProblem{message: e.Class + " is not a class: a class starts and ends with a capital", at: at}
	}
	return nil
}

// implicationSideFault is why a side of an implication is not a tag set,
// with the construct at fault, or nil.
func implicationSideFault(side *domTerm, ct constTypes) *typeFault {
	ty, f := termTypeIn(side, ct)
	if f != nil {
		return &typeFault{"a side of an implication is a tag set: " + f.problem, f.node}
	}
	if problem := expectedProblem(ty, tyTags); problem != "" {
		return &typeFault{"a side of an implication is a tag set: " + problem, side}
	}
	return nil
}

// directiveOperandsOK checks a directive's name, one of the notation's
// directives, and the operands the notation's syntax allows (engine §9):
// stage selectors take one name, %include one string, %features one or more
// names and %elision-only none. %ambiguity-resolution has well-formed steps
// in place of operands.
// directiveHeaderProblem is why a directive's name, conditions or
// operands are malformed, in the order of engine §9.3 step 5, or "".
func directiveHeaderProblem(dir *domDirective) string {
	switch {
	case !directiveNames[dir.Name]:
		return "a malformed directive"
	case dir.Conditions != nil && dir.Name != "features":
		return "only %features accepts conditions"
	case dir.Conditions != nil && len(dir.Conditions) == 0:
		return "malformed feature conditions"
	case dir.Name == "ambiguity-resolution":
		if !directiveOperandsOK(dir) {
			return "%ambiguity-resolution requires a pattern for each key step and no operand on a final lean"
		}
	case directiveOperandsOK(dir):
	case dir.Args == nil || dir.Steps != nil || dir.Name == "elision-only":
		return "a malformed directive"
	case dir.Name == "stage" || dir.Name == "extend-stage" || dir.Name == "redefine-stage":
		return "%" + dir.Name + " takes one lowercase name"
	case dir.Name == "features":
		return "%features takes feature names"
	default:
		return "a malformed directive"
	}
	return ""
}

var directiveNames = map[string]bool{"stage": true, "extend-stage": true, "redefine-stage": true, "include": true, "names": true, "features": true, "elision-only": true, "ambiguity-resolution": true}

func directiveOperandsOK(dir *domDirective) bool {
	if dir.Name == "ambiguity-resolution" {
		return dir.Args == nil && validSteps(dir.Steps)
	}
	if dir.Args == nil || dir.Steps != nil {
		return false
	}
	switch dir.Name {
	case "stage", "extend-stage", "redefine-stage":
		return len(dir.Args) == 1 && classifierName.MatchString(dir.Args[0])
	case "include", "names":
		return len(dir.Args) == 1
	case "features":
		if len(dir.Args) == 0 {
			return false
		}
		for _, a := range dir.Args {
			if !nameSyntaxFeature.MatchString(a) {
				return false
			}
		}
	case "elision-only":
		return len(dir.Args) == 0
	default:
		return false
	}
	return true
}

type domChecker struct {
	parseBody       bool
	expanded        bool
	parameters      map[string]bool
	unresolved      bool
	inArgument      bool
	patternArgument bool
	deferTypes      bool
	hasBoundary     bool
	rule            *domRule        // the rule checked, or nil
	constant        *domConst       // the constant checked, or nil
	implication     *domImplication // the implication checked, or nil
	label           string          // what the diagnostic names
	uni             *unicodeTable
	tests           []*domExpr // the tested symbols seen, whose values are checked once the nesting is bounded
	problem         *domProblem
	// at is the position of the node being checked, or of the nearest
	// enclosing node with one, where a fault stands. featureAt is a
	// %features directive's position, where every fault in its
	// conditions stands.
	at, featureAt [2]int
	// query says the term checked is a condition's method, and
	// inRecipe that it is an atom of a recipe (engine §9.3 step 5).
	query, inRecipe bool
	// setAt is the position of a set condition's operation while its
	// operands are checked, and nodeSetAt its value at the term being
	// checked (engine §9.3 step 5).
	setAt, nodeSetAt [2]int
	// declAt is the position of the declaration checked.
	declAt [2]int
	// argCapture is the first capture read or declared in an argument,
	// a semantic fault that the semantic pass reports in its order
	// (engine §9.3 step 5, firstCaptureArgIn).
	argCapture *domProblem
	// deepProblem is the first node beyond the depth bound, reported
	// after all declarations pass their other checks.
	deepProblem *domProblem
	// flat says the walk is below the depth bound, where each node is a
	// task on an explicit stack and batch collects a task's children,
	// so the native stack stays bounded however deep a DOM nests.
	flat  bool
	batch []func()
}

// checkContext is what a node's check reads of the walk around it.
type checkContext struct {
	at, setAt, nodeSetAt                                    [2]int
	query, inRecipe, parseBody, inArgument, patternArgument bool
}

func (c *domChecker) context() checkContext {
	return checkContext{c.at, c.setAt, c.nodeSetAt, c.query, c.inRecipe, c.parseBody, c.inArgument, c.patternArgument}
}

func (c *domChecker) restore(k checkContext) {
	c.at, c.setAt, c.nodeSetAt = k.at, k.setAt, k.nodeSetAt
	c.query, c.inRecipe, c.parseBody, c.inArgument, c.patternArgument = k.query, k.inRecipe, k.parseBody, k.inArgument, k.patternArgument
}

// visit checks a node now, or, below the depth bound, as a task of the
// explicit stack, in the context it is reached in. Tasks run in written
// order, each before the nodes that follow it.
func (c *domChecker) visit(depth int, check func()) {
	if c.flat {
		k := c.context()
		c.batch = append(c.batch, func() {
			c.restore(k)
			check()
		})
		return
	}
	if depth <= maxDOMDepth {
		check()
		return
	}
	outer := c.context()
	c.flat = true
	stack := []func(){check}
	for len(stack) > 0 && c.problem == nil {
		task := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		c.batch = nil
		task()
		for i := len(c.batch) - 1; i >= 0; i-- {
			stack = append(stack, c.batch[i])
		}
	}
	c.batch = nil
	c.flat = false
	c.restore(outer)
}

// noteArgCapture records a capture in an argument for the semantic pass.
func (c *domChecker) noteArgCapture(at [2]int) {
	if c.argCapture == nil {
		c.argCapture = &domProblem{message: "an argument cannot read or declare captures", rule: c.rule, constant: c.constant, implication: c.implication, at: at}
	}
}

func literalRangeProblem(ends [2]*domTerm) string {
	var known [2]bool
	for i, end := range ends {
		known[i] = end != nil && end.Kind == tmString
		if known[i] && utf8.RuneCountInString(end.Str) != 1 {
			return "a range endpoint is one scalar"
		}
	}
	if known[0] && known[1] && ends[0].Str > ends[1].Str {
		return "a range starts above its end"
	}
	return ""
}

func (c *domChecker) fail(format string, args ...any) {
	if c.problem == nil {
		at := c.at
		if c.featureAt != [2]int{} {
			at = c.featureAt
		}
		c.problem = &domProblem{message: fmt.Sprintf(format, args...), rule: c.rule, constant: c.constant, implication: c.implication, at: at}
	}
}

// failAt is fail for a fault that stands at a node of its own, at, or
// at the enclosing node when at is the zero position.
func (c *domChecker) failAt(at [2]int, format string, args ...any) {
	if c.problem != nil {
		return
	}
	c.fail(format, args...)
	if at != [2]int{} && c.featureAt == [2]int{} {
		c.problem.at = at
	}
}

// enter makes at, when it is a position, the position of the faults
// found until leave restores the one it returns (engine §9.3 step 5:
// a fault stands at its node, or at the nearest enclosing node with a
// position).
func (c *domChecker) enter(at [2]int) [2]int {
	previous := c.at
	if at != [2]int{} {
		c.at = at
	}
	return previous
}

// deep records the first node beyond the depth bound, which is reported
// only after every declaration passes its other checks (§9.3 step 5).
// The walk goes on below the bound, so a deeper node still gets its
// own checks. deep says whether the walk stops: it stops at a fault.
func (c *domChecker) deep(depth int) bool {
	if depth > maxDOMDepth && c.deepProblem == nil {
		c.deepProblem = &domProblem{message: fmt.Sprintf("%s: an expression, term or condition is nested more than %d deep", c.label, maxDOMDepth), rule: c.rule, constant: c.constant, implication: c.implication, tooDeep: true}
	}
	return c.problem != nil
}

// expr checks an expression. whole says it is the alternative's whole
// expression, the only place a chain may stand. sealed says it lies inside
// an elidable optional, and chain that the innermost braces around it are
// a chain: no capture stands in either. item says the innermost braces are
// flat, where a capture is an item capture, and ranked that a ranked group
// stands between those braces and the expression, where no item capture
// stands (engine §3.5, §9).
func (c *domChecker) expr(e *domExpr, depth int, whole, sealed, chain, item, ranked bool) {
	c.visit(depth, func() {
		if e != nil {
			defer func(previous [2]int) { c.at = previous }(c.enter(e.At))
		}
		c.exprChecked(e, depth, whole, sealed, chain, item, ranked)
	})
}

func (c *domChecker) exprChecked(e *domExpr, depth int, whole, sealed, chain, item, ranked bool) {
	if c.deep(depth) {
		return
	}
	if e == nil {
		c.fail("a missing expression")
		return
	}
	switch e.Kind {
	case exParam:
		c.parameter(e.Name, e.At)
	case exCall:
		c.sourceCall(e.Call, depth)
	case exSeq, exChoice, exRanked, exAnd:
		// The reader makes each only of two or more, an & of at most 16.
		if len(e.Items) < 2 || (e.Kind == exAnd && len(e.Items) > maxAnd) {
			switch {
			case e.Kind == exRanked:
				if c.problem == nil {
					c.fail("ranked-choice-syntax: a ranked expression requires two options")
					c.problem.code = "ranked-choice-syntax"
				}
			case e.Kind == exAnd && len(e.Items) > maxAnd:
				c.fail("an & joins at most %d items", maxAnd)
			default:
				c.fail("a %s of %d items", e.Kind, len(e.Items))
			}
			return
		}
		for _, it := range e.Items {
			c.expr(it, depth+1, false, sealed, chain, item, ranked || e.Kind == exRanked)
		}
	case exOptional:
		if e.Default != nil {
			if !e.Elidable || !stringTermShape(e.Default) {
				c.fail("a malformed default")
				return
			}
			// A string default passes each value test of its head.
			if e.Default.Kind == tmString && e.Inner != nil {
				head := e.Inner
				if head.Kind == exCapture || head.Kind == exSeq && len(head.Items) > 0 {
					if head.Kind == exCapture {
						head = head.Inner
					} else {
						head = head.Items[0]
					}
				}
				for head != nil && head.Kind == exTest {
					if head.Op != "tags" && head.Value != nil && head.Value.Kind == tmString && (e.Default.Str == head.Value.Str) != (head.Op == "=") {
						c.failAt(e.DefaultAt, "a default fails its head test")
						return
					}
					head = head.Inner
				}
			}
			c.term(e.Default, depth+1, false)
		}
		// An elidable optional begins with its terminal (engine §3.8, §9).
		if e.Elidable && elidableHead(e.Inner) == nil {
			c.fail("a malformed optional")
			return
		}
		c.expr(e.Inner, depth+1, false, sealed || e.Elidable && e.Inner.Kind != exCapture, chain, item, ranked)
	case exRepeat:
		// A chain is the whole expression of its alternative (engine §9).
		// A separator counts on from the depth of its repeat, as the item
		// does. The innermost braces decide whether a capture inside them
		// is an item capture (engine §3.5).
		if e.Chain != "" && (!whole || e.Grouped) {
			c.fail("a chain is the whole expression of its alternative: name it as a rule to use it here")
			return
		}
		c.expr(e.Inner, depth+1, false, sealed, e.Chain != "", e.Chain == "", false)
		if e.Sep != nil {
			c.expr(e.Sep, depth+1, false, sealed, e.Chain != "", e.Chain == "", false)
		}
	case exSplice:
		if e.Inner == nil || e.Inner.Kind != exCall && (e.Inner.Kind != exRef || !c.ruleName(e.Inner.Name)) {
			c.fail("a splice requires a rule or instance")
			return
		}
		c.expr(e.Inner, depth+1, false, sealed, chain, item, ranked)
	case exCapture:
		// A capture wraps one symbol, and stands anywhere but in braces or
		// an elidable optional; $, the whole constituent, wraps nothing.
		if c.inArgument {
			c.noteArgCapture(e.At)
		}
		if chain {
			c.fail("a capture cannot stand inside a chain, whose levels are constituents of its rule: a condition on $ serves each level")
			return
		}
		if item && ranked {
			c.fail("an item capture cannot stand inside a ranked group: name the ranked choice as a rule and capture that rule")
			return
		}
		if sealed {
			c.fail("a capture cannot stand inside an elidable optional, which elision restores as one unit")
			return
		}
		if e.Name == "" {
			c.fail("$ is the whole constituent and wraps nothing")
			return
		}
		if !captureName.MatchString(e.Name) {
			c.fail("a capture's name is all lower case")
			return
		}
		base := e.Inner
		for base != nil && base.Kind == exTest {
			base = base.Inner
		}
		if base == nil || base.Grouped || !isCapturable(base.Kind) {
			c.fail("a capture wraps one symbol")
			return
		}
		// A capture is a compound node: its symbol lies below it, and is
		// checked as any expression is.
		c.expr(e.Inner, depth+1, false, sealed, chain, item, ranked)
	case exTest:
		// The test's own form, then the tested symbol, then its operands
		// (engine §9.3 step 5). A tag test stands on a base symbol, and a
		// value test also on a tag test of one.
		if !testOps[e.Op] || e.Op == "tags" && !isTestable(e.Inner) || e.Op != "tags" && !isTestable(e.Inner) && !(e.Inner != nil && !e.Inner.Grouped && e.Inner.Kind == exTest && e.Inner.Op == "tags" && isTestable(e.Inner.Inner)) {
			c.fail("a malformed test")
			return
		}
		c.expr(e.Inner, depth+1, false, sealed, chain, item, ranked)
		if c.problem != nil {
			return
		}
		if e.Op == "tags" {
			for _, r := range e.Requirements {
				if r.Value == nil || r.Value.grouped || r.Value.Kind != tmTag && r.Value.Kind != tmConst && r.Value.Kind != tmParam {
					var at [2]int
					if r.Value != nil {
						at = r.Value.At
					}
					c.failAt(at, "a malformed requirement")
					return
				}
			}
			for _, r := range e.Requirements {
				c.term(r.Value, depth+1, false)
			}
			return
		}
		if !stringTermShape(e.Value) {
			var at [2]int
			if e.Value != nil {
				at = e.Value.At
			}
			c.failAt(at, "a malformed value test")
			return
		}
		// A value counts on from the depth of its test, and is checked
		// once the nesting is bounded.
		c.term(e.Value, depth+1, false)
		c.tests = append(c.tests, e)
	case exLiteral:
		c.term(e.Value, depth, false)
		if !stringTermShape(e.Value) {
			c.fail("a literal requires a string term")
		}
	case exWildcard:
	case exRef:
		// A reference is an identifier or one eligible emoji (engine §9).
		if !c.uni.isEmojiName(e.Name) && !domName.MatchString(e.Name) && !engineTag(e.Name) && !(c.expanded && c.ruleName(e.Name)) {
			c.fail("a reference to %q, which is not a name", e.Name)
		}
	case exRange:
		for _, end := range e.Ends {
			c.term(end, depth, false)
			if !stringTermShape(end) {
				c.fail("a range requires string endpoints")
			}
		}
		if problem := literalRangeProblem(e.Ends); problem != "" {
			c.fail("%s", problem)
		}
	case exEmpty:
	case exRemainder:
		if !c.parseBody {
			c.fail("a remainder stands at one outer edge of a parse argument")
		}
	default:
		c.fail("an unknown expression %q", e.Kind)
	}
}

// elidableHead selects the first sequence item, then unwraps only symbol tests.
// The base must be one capitalized user-tag reference (engine §9).
func elidableHead(e *domExpr) *domExpr {
	if e == nil || e.Grouped {
		return nil
	}
	head := e
	if e.Kind == exSeq && len(e.Items) > 0 {
		head = e.Items[0]
	}
	if head == nil || head.Grouped {
		return nil
	}
	if head.Kind == exCapture {
		head = head.Inner
	}
	if head == nil || head.Grouped {
		return nil
	}
	base := head
	for base != nil && !base.Grouped && base.Kind == exTest && (base.Op == "=" || base.Op == "≠" || base.Op == "tags") {
		base = base.Inner
	}
	if base != nil && base.Grouped {
		return nil
	}
	if base != nil && (base.Kind == exParam || base.Kind == exRef && constName.MatchString(base.Name)) {
		return head
	}
	return nil
}

// duplicateCaptures lists the captures that some production of an
// expression reads after a capture of the same name (engine §3.5, §9),
// found from the structure alone: two captures are read by one production
// exactly when they stand in different items of one sequence or one &,
// since each item is read in any of its expansions. So no production is
// listed. A choice's branches never meet, and braces and an elidable
// optional hold no capture.
func duplicateCaptures(e *domExpr) map[*domExpr]bool {
	duplicates := map[*domExpr]bool{}
	// Each part gives its captures by name, and their number. An item of a
	// sequence or an & meets the items before it: the side with fewer
	// captures is looked up in the other, and the two are then joined, the
	// smaller into the larger, so a capture moves a number of times that
	// grows with the logarithm of their count, not with the depth of the
	// expression.
	type found struct {
		names map[string][]*domExpr
		size  int
	}
	kids := func(n *domExpr) []*domExpr {
		switch {
		case n == nil:
			return nil
		case n.Kind == exSeq || n.Kind == exAnd || n.Kind == exChoice || n.Kind == exRanked:
			return n.Items
		case n.Kind == exOptional && (!n.Elidable || n.Inner.Kind == exCapture):
			return []*domExpr{n.Inner}
		}
		return nil
	}
	// Each node is met twice, with an explicit stack: first to push its
	// parts, and then to join what they give, which stands on done.
	type frame struct {
		n    *domExpr
		join bool
	}
	stack := []frame{{n: e}}
	var done []found
	for len(stack) > 0 {
		if w := work.Load(); w != nil {
			w.readerSteps.add("reader steps")
		}
		top := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		n := top.n
		if !top.join {
			if n != nil && n.Kind == exCapture {
				done = append(done, found{map[string][]*domExpr{n.Name: {n}}, 1})
				continue
			}
			items := kids(n)
			if len(items) == 0 {
				done = append(done, found{map[string][]*domExpr{}, 0})
				continue
			}
			stack = append(stack, frame{n: n, join: true})
			for i := len(items) - 1; i >= 0; i-- {
				stack = append(stack, frame{n: items[i]})
			}
			continue
		}
		count := len(kids(n))
		partsDone := appendCounted(nil, done[len(done)-count:], readerCount(), "reader steps")
		done = done[:len(done)-count]
		meets := n.Kind == exSeq || n.Kind == exAnd
		joined := partsDone[0]
		// Each name looked up and each capture marked or moved counts
		// before it is.
		w := work.Load()
		step := func() {
			if w != nil {
				w.readerSteps.add("reader steps")
			}
		}
		// A marked capture leaves its list but keeps its name present, so
		// that it is marked once and not again at each level above it.
		// The sizes stay as they were, which keeps the smaller side small.
		for _, part := range partsDone[1:] {
			if meets {
				if joined.size <= part.size {
					for name := range joined.names {
						step()
						cs, ok := part.names[name]
						for _, c := range cs {
							step()
							duplicates[c] = true
						}
						if ok {
							part.names[name] = nil
						}
					}
				} else {
					for name, cs := range part.names {
						step()
						if _, ok := joined.names[name]; ok {
							for _, c := range cs {
								step()
								duplicates[c] = true
							}
							part.names[name] = nil
						}
					}
				}
			}
			large, small := joined, part
			if part.size > joined.size {
				large, small = part, joined
			}
			// A name whose list a marking emptied still moves, so it counts
			// as well as each capture with it.
			for name, cs := range small.names {
				step()
				for range cs {
					step()
				}
				large.names[name] = append(large.names[name], cs...)
			}
			large.size += small.size
			joined = large
		}
		done = append(done, joined)
	}
	return duplicates
}

// exprChildren lists the parts of an expression in the order written: the
// items of a list, then what a capture, a test, an optional or braces
// wrap, then a separator.
func exprChildren(e *domExpr) []*domExpr {
	var out []*domExpr
	if e == nil {
		return out
	}
	out = append(out, e.Items...)
	if e.Inner != nil {
		out = append(out, e.Inner)
	}
	if e.Sep != nil {
		out = append(out, e.Sep)
	}
	return out
}

// allCaptures lists the captures of an expression in the order written,
// those inside braces and elidable optionals included. Each node counts
// before it is met.
func allCaptures(e *domExpr) []*domExpr {
	var found []*domExpr
	stack := []*domExpr{e}
	for len(stack) > 0 {
		if w := work.Load(); w != nil {
			w.readerSteps.add("reader steps")
		}
		n := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if n == nil {
			continue
		}
		if n.Kind == exCapture {
			found = append(found, n)
		}
		kids := exprChildren(n)
		for i := len(kids) - 1; i >= 0; i-- {
			stack = append(stack, kids[i])
		}
	}
	return found
}

// itemPlace is where an item capture stands: the innermost flat braces
// around it, whose item captures one condition may read together, and the
// outermost flat braces around it, which a production of the alternative
// reads in their place (engine §3.5, §3.6).
type itemPlace struct {
	braces, outer *domExpr
}

// itemCaptures lists the item captures of an expression, the captures
// inside flat braces, by name, each with its place (engine §3.5). A chain
// holds no capture, which the reader makes sure of, so a capture inside a
// chain's own braces is not listed. Flat braces inside a chain's item are
// the outermost flat braces of their captures.
func itemCaptures(e *domExpr) map[string]itemPlace {
	found := map[string]itemPlace{}
	type frame struct {
		n     *domExpr
		place *itemPlace
	}
	stack := []frame{{n: e}}
	for len(stack) > 0 {
		if w := work.Load(); w != nil {
			w.readerSteps.add("reader steps")
		}
		top := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		n := top.n
		if n == nil {
			continue
		}
		place := top.place
		switch n.Kind {
		case exCapture:
			if place != nil {
				if _, ok := found[n.Name]; !ok {
					found[n.Name] = *place
				}
			}
		case exRepeat:
			if n.Chain == "" {
				inner := &itemPlace{braces: n, outer: n}
				if place != nil {
					inner.outer = place.outer
				}
				place = inner
			}
		}
		kids := exprChildren(n)
		for i := len(kids) - 1; i >= 0; i-- {
			stack = append(stack, frame{kids[i], place})
		}
	}
	return found
}

// bracesName is the pseudo-capture that stands for a pair of flat braces
// in bracesSequences: the braces themselves, by their identity.
func bracesName(braces *domExpr) string { return fmt.Sprintf("\x01%p", braces) }

// bracesSequences lists the distinct sequences of captures that the
// productions of an expression read, as captureSequences does, with each
// pair of flat braces that a production reads as a pseudo-capture named
// by bracesName. The captures and braces inside the braces stay out, as in
// every production. The check of item conditions compares the place of
// the braces with the places of the captures a condition reads (engine
// §3.6).
func bracesSequences(e *domExpr) [][]string {
	w := work.Load()
	step := func() {
		if w != nil {
			w.readerSteps.add("reader steps")
		}
	}
	distinct := func(lists [][]string) [][]string {
		seen := map[string]bool{}
		var out [][]string
		for _, list := range lists {
			step()
			key := strings.Join(list, "\x00")
			if seen[key] {
				continue
			}
			seen[key] = true
			out = append(out, list)
		}
		return out
	}
	product := func(left, right [][]string) [][]string {
		var out [][]string
		for _, a := range left {
			for _, b := range right {
				step()
				out = append(out, append(append([]string{}, a...), b...))
			}
		}
		return distinct(out)
	}
	// A chain holds no capture, and its productions read an item, or a
	// separator followed by an item, so it gives the item's sequences and
	// each separator sequence followed by an item sequence (engine §3.3).
	// Only braces stand in them.
	kids := func(n *domExpr) []*domExpr {
		switch {
		case n == nil:
			return nil
		case n.Kind == exSeq || n.Kind == exAnd || n.Kind == exChoice || n.Kind == exRanked:
			return n.Items
		case n.Kind == exOptional && (!n.Elidable || n.Inner.Kind == exCapture):
			return []*domExpr{n.Inner}
		case n.Kind == exRepeat && n.Chain != "":
			if n.Sep != nil {
				return []*domExpr{n.Inner, n.Sep}
			}
			return []*domExpr{n.Inner}
		}
		return nil
	}
	type frame struct {
		n       *domExpr
		combine bool
	}
	stack := []frame{{n: e}}
	var done [][][]string
	for len(stack) > 0 {
		step()
		top := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		n := top.n
		if !top.combine {
			switch {
			case n != nil && n.Kind == exCapture:
				done = append(done, [][]string{{n.Name}})
				continue
			case n != nil && n.Kind == exRepeat && n.Chain == "":
				done = append(done, [][]string{{bracesName(n)}})
				continue
			}
			items := kids(n)
			if len(items) == 0 {
				done = append(done, [][]string{{}})
				continue
			}
			stack = append(stack, frame{n: n, combine: true})
			for i := len(items) - 1; i >= 0; i-- {
				stack = append(stack, frame{n: items[i]})
			}
			continue
		}
		count := len(kids(n))
		parts := append([][][]string{}, done[len(done)-count:]...)
		done = done[:len(done)-count]
		var out [][]string
		switch n.Kind {
		case exSeq:
			out = [][]string{{}}
			for _, part := range parts {
				out = product(out, part)
			}
		case exChoice, exRanked:
			for _, part := range parts {
				out = append(out, part...)
			}
			out = distinct(out)
		case exRepeat:
			out = append(out, parts[0]...)
			if len(parts) > 1 {
				out = append(out, product(parts[1], parts[0])...)
			}
			out = distinct(out)
		case exAnd:
			for mask := 1; mask < 1<<len(parts); mask++ {
				seqs := [][]string{{}}
				for i, part := range parts {
					if mask&(1<<i) != 0 {
						seqs = product(seqs, part)
					}
				}
				out = append(out, seqs...)
			}
			out = distinct(out)
		case exOptional:
			out = append([][]string{{}}, parts[0]...)
		}
		done = append(done, out)
	}
	return done[0]
}

// captureSequences lists the distinct sequences of captures that the
// productions of an expression read, each in the order read (engine §3.2,
// §3.5): a choice gives each branch's, an & each subsequence's, a plain
// optional none or its content's, and braces and an elidable optional
// none. Productions that read the same names in the same order are one
// sequence. Gates do not matter, since they drop whole alternatives.
// Repeated names are duplicateCaptures' concern.
func captureSequences(e *domExpr) [][]*domExpr {
	// Each capture or join that the work below makes, looks up, compares
	// or writes out counts before it does.
	w := work.Load()
	step := func() {
		if w != nil {
			w.readerSteps.add("reader steps")
		}
	}
	// A sequence is a tree of the sequences it joins, so a join shares its
	// parts and costs one step. A copy at each join would cost nested
	// sequences the square of their depth. Each sequence is written out
	// once, at the end.
	type capSeq struct {
		c    *domExpr
		l, r *capSeq
		// h is a hash of the names in order, and pw the base to the power
		// of their number, so that a join finds its hash in one step.
		h, pw uint64
	}
	const base = 1099511628211
	empty := (*capSeq)(nil)
	powOf := func(s *capSeq) uint64 {
		if s == nil {
			return 1
		}
		return s.pw
	}
	hashOf := func(s *capSeq) uint64 {
		if s == nil {
			return 0
		}
		return s.h
	}
	leaf := func(c *domExpr) *capSeq {
		// The hash of a name reads each of its bytes once, as reading the
		// name did.
		h := uint64(14695981039346656037)
		for i := 0; i < len(c.Name); i++ {
			h = (h ^ uint64(c.Name[i])) * base
		}
		return &capSeq{c: c, h: h | 1, pw: base}
	}
	// flat writes a sequence out in order, each part of its tree counted
	// before it is entered.
	flat := func(s *capSeq) []*domExpr {
		var out []*domExpr
		stack := []*capSeq{s}
		for len(stack) > 0 {
			step()
			top := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			switch {
			case top == nil:
			case top.c != nil:
				out = append(out, top.c)
			default:
				stack = append(stack, top.r, top.l)
			}
		}
		return out
	}
	join := func(a, b *capSeq) *capSeq {
		step()
		switch {
		case a == nil:
			return b
		case b == nil:
			return a
		}
		return &capSeq{l: a, r: b, h: hashOf(a)*powOf(b) + b.h, pw: a.pw * b.pw}
	}
	same := func(a, b *capSeq) bool {
		x, y := flat(a), flat(b)
		if len(x) != len(y) {
			return false
		}
		for i := range x {
			step()
			if x[i].Name != y[i].Name {
				return false
			}
		}
		return true
	}
	// distinct keeps the first of each list of names. Lists are found by
	// their hash, and only lists of equal hash are written out and
	// compared, so a list that is not repeated is never written out here.
	distinct := func(lists []*capSeq) []*capSeq {
		if len(lists) < 2 {
			return lists
		}
		seen := map[uint64][]*capSeq{}
		var out []*capSeq
	next:
		for _, list := range lists {
			step()
			h := hashOf(list)
			for _, other := range seen[h] {
				if same(list, other) {
					continue next
				}
			}
			seen[h] = append(seen[h], list)
			out = append(out, list)
		}
		return out
	}
	product := func(left, right []*capSeq) []*capSeq {
		var out []*capSeq
		for _, a := range left {
			for _, b := range right {
				out = append(out, join(a, b))
			}
		}
		return distinct(out)
	}
	// Each node is met twice, with an explicit stack: first to push its
	// parts, and then to combine their sequences, which stand on done.
	kids := func(n *domExpr) []*domExpr {
		switch {
		case n == nil:
			return nil
		case n.Kind == exSeq || n.Kind == exAnd || n.Kind == exChoice || n.Kind == exRanked:
			return n.Items
		case n.Kind == exOptional && (!n.Elidable || n.Inner.Kind == exCapture):
			return []*domExpr{n.Inner}
		}
		return nil
	}
	type frame struct {
		n       *domExpr
		combine bool
	}
	stack := []frame{{n: e}}
	var done [][]*capSeq
	for len(stack) > 0 {
		step()
		top := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		n := top.n
		if !top.combine {
			if n != nil && n.Kind == exCapture {
				done = append(done, []*capSeq{leaf(n)})
				continue
			}
			items := kids(n)
			if len(items) == 0 {
				done = append(done, []*capSeq{empty})
				continue
			}
			stack = append(stack, frame{n: n, combine: true})
			for i := len(items) - 1; i >= 0; i-- {
				stack = append(stack, frame{n: items[i]})
			}
			continue
		}
		count := len(kids(n))
		parts := appendCounted(nil, done[len(done)-count:], readerCount(), "reader steps")
		done = done[:len(done)-count]
		var out []*capSeq
		switch n.Kind {
		case exSeq:
			out = []*capSeq{empty}
			for _, part := range parts {
				out = product(out, part)
			}
		case exChoice, exRanked:
			for _, part := range parts {
				out = appendCounted(out, part, readerCount(), "reader steps")
			}
			out = distinct(out)
		case exAnd:
			for mask := 1; mask < 1<<len(parts); mask++ {
				seqs := []*capSeq{empty}
				for i, part := range parts {
					if mask&(1<<i) != 0 {
						seqs = product(seqs, part)
					}
				}
				out = appendCounted(out, seqs, readerCount(), "reader steps")
			}
			out = distinct(out)
		default:
			out = distinct(appendCounted([]*capSeq{empty}, parts[0], readerCount(), "reader steps"))
		}
		done = append(done, out)
	}
	sequences := make([][]*domExpr, len(done[0]))
	for i, s := range done[0] {
		sequences[i] = flat(s)
	}
	return sequences
}

// isCapturable says whether a capture can wrap an expression of a kind: a
// reference, a terminal, a range, a property or a tested symbol (engine §9).
func isCapturable(kind string) bool {
	switch kind {
	case exRef, exRange, exLiteral, exWildcard, exTest, exParam, exCall, exSplice:
		return true
	}
	return false
}

// isTestable says whether an expression can carry a test (engine §2): a
// reference, a terminal, a range or a property.
func isTestable(e *domExpr) bool {
	if e == nil || e.Grouped {
		return false
	}
	switch e.Kind {
	case exRef, exParam, exCall, exSplice:
		return true
	case exRange, exLiteral, exWildcard:
		return true
	}
	return false
}

// testValueFault is what is wrong with a test's value (engine §9), or nil:
// it must be a closed string term for a value test. Its shape and nesting
// are checked first.
func testValueFault(op string, value *domTerm) *typeFault {
	if open := openPart(value); open != nil {
		return &typeFault{"a test's operand is a closed term, and reads no capture or span", open}
	}
	ty, f := termTypeIn(value, nil)
	if f != nil {
		return f
	}
	if problem := testTypeProblem(op, ty); problem != "" {
		return &typeFault{problem, value}
	}
	return nil
}

// testTypeProblem is why a value of a type cannot be the value of a test,
// or "": a sound test's is a string, and a tag test's a tag set.
func testTypeProblem(op string, ty termType) string {
	expected, name := tyTags, "a tag set"
	if isValueTest(op) {
		expected, name = tyString, "a string"
	}
	if problem := expectedProblem(ty, expected); problem != "" {
		return op + " tests " + name + ": " + problem
	}
	return ""
}

// testsIn lists the tested symbols of an expression, in the order written.
func testsIn(e *domExpr) []*domExpr {
	var found []*domExpr
	// In the order written, with an explicit stack; a repeat's item comes
	// before its separator.
	stack := []*domExpr{e}
	for len(stack) > 0 {
		e := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if e == nil {
			continue
		}
		if e.Kind == exTest {
			found = append(found, e)
		}
		stack = append(stack, e.Sep, e.Inner)
		for i := len(e.Items) - 1; i >= 0; i-- {
			stack = append(stack, e.Items[i])
		}
	}
	return found
}

// literalCallProblem rejects an empty split delimiter visible to the reader
// as a string literal, or returns "" (engine §9, §10).
func literalCallProblem(call string, args []*domTerm) string {
	literal := func(i int) (string, bool) {
		if i < len(args) && args[i] != nil && args[i].Kind == tmString {
			return args[i].Str, true
		}
		return "", false
	}
	if s, ok := literal(1); call == "split" && ok && s == "" {
		return "split has an empty delimiter"
	}
	return ""
}

// isSpanShape identifies captures and span methods (§10).
func isSpanShape(t *domTerm) bool {
	return t != nil && (t.Kind == tmCapture || unresolvedTerm(t) || (t.Kind == tmCall && isSpanFunction(t.Str)))
}

func isRuleName(name string, uni *unicodeTable) bool {
	return classifierName.MatchString(name) || uni.isEmojiName(name)
}

// term checks a term; argument says it is a function's argument, where a
// span may stand. A nil term is an absent, optional one.
func (c *domChecker) term(t *domTerm, depth int, argument bool) {
	c.visit(depth, func() { c.termNode(t, depth, argument) })
}

func (c *domChecker) termNode(t *domTerm, depth int, argument bool) {
	if t != nil {
		defer func(previous [2]int) { c.at = previous }(c.enter(t.At))
	}
	// A set condition's operation passes its position to its operands
	// alone, where a query method's fault stands (engine §9.3 step 5).
	setAt := c.setAt
	c.nodeSetAt = setAt
	if t == nil || t.Kind != tmUnion && t.Kind != tmIntersection && t.Kind != tmDifference {
		c.setAt = [2]int{}
	}
	c.termChecked(t, depth, argument)
	c.setAt = setAt
}

func (c *domChecker) termChecked(t *domTerm, depth int, argument bool) {
	if t == nil || c.deep(depth) {
		return
	}
	switch t.Kind {
	case tmBody:
		if !c.parseBody || !argument {
			c.fail("a body stands only in a parse argument")
			return
		}
		core, _, problem := queryBody(t.Body)
		if problem != "" {
			c.fail("%s", problem)
			return
		}
		if queryCapture(core) != nil {
			c.fail("a parse argument cannot declare captures")
			return
		}
		nested := false
		walkQueryBody(core, func(expr *domExpr) bool { nested = nested || expr.Kind == exRemainder; return !nested }, func() bool { return !nested })
		if nested {
			c.fail("a remainder stands at one outer edge of a parse argument")
			return
		}
		// The body wrapper is not a syntax node (engine §9).
		c.expr(t.Body, depth, false, false, false, false, false)
	case tmString:
		if !utf8.ValidString(t.Str) {
			c.fail("a string is not valid UTF-8")
		}
	case tmCapture:
		if t.Str != "" && !captureName.MatchString(t.Str) {
			c.fail("a malformed capture name")
		}
		if c.inArgument {
			c.noteArgCapture(t.At)
		}
	case tmEmptySet:
	case tmParam:
		c.parameter(t.Str, t.At)
	case tmSourceCall:
		c.sourceCall(t.Call, depth)
	case tmConcat:
		if len(t.Items) < 2 {
			c.fail("a concatenation requires two operands")
		}
		for _, part := range t.Items {
			c.term(part, depth+1, false)
		}
	case tmPattern:
		msg, at := patternProblem(t.Pattern, depth+1, func(p *domPattern, d int) (string, [2]int) {
			none := [2]int{}
			switch p.Kind {
			case "param":
				c.parameter(p.Name, p.At)
				return "", none
			case "call":
				before := c.patternArgument
				c.patternArgument = true
				c.sourceCall(p.Call, d)
				c.patternArgument = before
				return "", none
			case "name":
				if !c.ruleName(p.Name) {
					return "a malformed pattern rule name", p.At
				}
				return "", none
			case "literal":
				if !stringTermShape(p.Value) {
					return "a malformed pattern literal", p.At
				}
				c.term(p.Value, d, false)
				return "", none
			case "range":
				for _, end := range p.Ends {
					if !stringTermShape(end) {
						return "a malformed pattern range", p.At
					}
				}
				if problem := literalRangeProblem(p.Ends); problem != "" {
					return problem, p.At
				}
				for _, end := range p.Ends {
					c.term(end, d, false)
				}
				return "", none
			case "wildcard":
				return "", none
			}
			// A test: its operands' forms, then the operands (engine
			// §9.3 step 5).
			if p.Op == "tags" {
				for _, r := range p.Requirements {
					if r.Value == nil || r.Value.grouped || r.Value.Kind != tmTag && r.Value.Kind != tmConst && r.Value.Kind != tmParam {
						var at [2]int
						if r.Value != nil {
							at = r.Value.At
						}
						return "a malformed pattern requirement", at
					}
				}
				if !c.expanded && len(p.Items) > 0 && p.Items[0] != nil && (p.Items[0].Kind == "name" || p.Items[0].Kind == "call") {
					for _, r := range p.Requirements {
						if !r.Negated && r.Value.Kind == tmTag && r.Value.Str == "_Elided" {
							return "a rule pattern cannot require _Elided", r.Value.At
						}
					}
				}
				for _, r := range p.Requirements {
					if r.Value.Kind != tmTag || r.Value.Str != "_Elided" {
						c.term(r.Value, d+1, false)
					}
				}
				return "", none
			}
			if !stringTermShape(p.Value) {
				var at [2]int
				if p.Value != nil {
					at = p.Value.At
				}
				return "a malformed pattern value test", at
			}
			c.term(p.Value, d+1, false)
			if openPart(p.Value) != nil {
				return "a pattern test requires a closed operand", none
			}
			ty, f := termTypeIn(p.Value, nil)
			if f != nil {
				return f.problem, none
			}
			if msg := testTypeProblem(p.Op, ty); msg != "" {
				return msg, none
			}
			return "", none
		})
		if msg == "nested too deeply" {
			c.deep(maxDOMDepth + 1)
		} else if msg != "" {
			c.failAt(at, "%s", msg)
		}
	case tmConst:
		if !constName.MatchString(t.Str) {
			c.fail("a malformed constant reference")
		}
	case tmTag:
		if !isTag(t.Str, c.uni) {
			c.fail("a malformed tag")
		}
	case tmUnion, tmIntersection, tmDifference:
		if len(t.Items) < 2 || (t.Kind == tmDifference && len(t.Items) != 2) {
			c.fail("a %s of %d items", t.Kind, len(t.Items))
			return
		}
		for _, it := range t.Items {
			if it == nil {
				c.fail("a missing term")
				return
			}
			c.term(it, depth+1, false)
		}
	case tmCall:
		c.method(t, depth)
	case tmIf:
		// A guarded term: a condition, and the term it guards.
		if t.Cond == nil || len(t.Items) != 1 || t.Items[0] == nil {
			c.fail("a malformed guarded term")
			return
		}
		c.condition(t.Cond, depth+1)
		c.term(t.Items[0], depth+1, false)
	default:
		c.fail("a malformed term")
	}
}

// method checks a method term in the order of engine §9.3 step 5: its
// placement, then its inline arguments in reverse, then its receiver,
// its other arguments, and last its signature.
func (c *domChecker) method(t *domTerm, depth int) {
	if len(t.Items) == 0 || t.Items[0] == nil {
		c.fail("a malformed method")
		return
	}
	receiver, args := t.Items[0], t.Items[1:]
	if (t.Str == "classify" || t.Str == "ngrams") && slices.ContainsFunc(args, termHasUnresolved) {
		c.fail("a parameter cannot replace a classifier name or integer argument")
		return
	}
	if !c.query && queryMethods[t.Str] && t.Str != "parse" && t.Str != "error-free" {
		c.failAt(c.nodeSetAt, "a query method is a condition, not a term")
		return
	}
	query, recipe := c.query, c.inRecipe
	c.query = false
	defer func() { c.query, c.inRecipe = query, recipe }()
	known := knownMethod(t.Str)
	var terms []*domTerm
	if known {
		for i := len(args) - 1; i >= 0; i-- {
			a := args[i]
			switch {
			case a == nil:
				c.fail("a malformed method")
				return
			case a.Kind == tmBody:
				if t.Str != "parse" || a.Body == nil {
					c.failAt(a.At, "a malformed parse argument")
					return
				}
				if _, _, problem := queryBody(a.Body); problem != "" {
					c.failAt(a.Body.At, "%s", problem)
					return
				}
				if capture := queryCapture(a.Body); capture != nil {
					c.failAt(capture.At, "a parse argument cannot declare captures")
					return
				}
			case a.Kind == tmRule:
				if t.Str != "without-elision-except" && !boundaryMethod(t.Str) || !c.ruleName(a.Str) {
					c.fail("a malformed rule argument")
					return
				}
			case a.Kind == tmTerminal:
				if !boundaryMethod(t.Str) || !isCapital(a.Str) || strings.Contains(a.Str, "--") {
					c.fail("a malformed boundary target")
					return
				}
			case a.Kind == tmInteger:
				if t.Str != "ngrams" {
					c.failAt(a.At, "a malformed integer argument")
					return
				}
				if !validInteger(a.Str) {
					c.failAt(a.At, "an integer argument is positive and has no leading zeros")
					return
				}
			case a.Kind == tmClassifier:
				if t.Str != "classify" || !classifierName.MatchString(a.Str) {
					c.fail("a malformed classifier argument")
					return
				}
			default:
				terms = append(terms, a)
			}
		}
	}
	// Only the receiver of a recipe atom is in the recipe.
	c.term(receiver, depth+1, true)
	c.inRecipe = false
	for i := len(terms) - 1; i >= 0; i-- {
		c.term(terms[i], depth+1, true)
	}
	for _, a := range args {
		switch {
		case a.Kind == tmBody && known:
			previous := c.parseBody
			c.parseBody = true
			c.term(a, depth+1, true)
			c.parseBody = previous
		case a.Kind == tmRule || a.Kind == tmClassifier || a.Kind == tmInteger || a.Kind == tmTerminal:
			c.deep(depth + 1) // a name or an integer is a node below the call
		}
	}
	if c.problem != nil {
		return
	}
	// A closed term's input method is a fault of its semantic pass.
	if (c.constant != nil || c.implication != nil) && known && t.Str != "split" && t.Str != "ngrams" {
		return
	}
	// An unknown method in a recipe atom is a fault of rule type
	// inspection (engine §9.3 step 5).
	if recipe && !known {
		return
	}
	if problem := methodShapeProblem(t.Str, receiver, args, recipe); problem != "" {
		c.fail("%s", problem)
		return
	}
	if query && known && !queryMethods[t.Str] {
		c.fail("a condition requires a query method")
	}
}

// queryMethods are the methods that make a condition (engine §10).
var queryMethods = map[string]bool{"starts-input": true, "ends-input": true, "parse": true, "error-free": true, "followed-by": true, "preceded-by": true}

// spanMethods are the methods whose result is a span (engine §10).
var spanMethods = map[string]bool{"first-token": true, "tokens-after-first": true, "last-token": true, "onward": true, "following-tokens": true, "preceding-tokens": true, "without-elision": true, "without-elision-except": true}

const methodSignatureProblem = "a method has the wrong receiver or arguments"

// methodShapeProblem is why a method's receiver and arguments do not fit
// its structural signature, or "". It reads no operand types (engine
// §9.3 step 5, §10).
func methodShapeProblem(name string, receiver *domTerm, args []*domTerm, recipe bool) string {
	if !knownMethod(name) {
		return "unknown method " + name
	}
	bare := receiver.Kind == tmCapture || unresolvedTerm(receiver)
	span := bare || receiver.Kind == tmCall && spanMethods[receiver.Str]
	is := func(a *domTerm, kind string) bool { return a != nil && a.Kind == kind }
	rule := func(a *domTerm) bool { return is(a, tmRule) || unresolvedTerm(a) }
	term := func(a *domTerm) bool {
		return a != nil && a.Kind != tmRule && a.Kind != tmClassifier && a.Kind != tmTerminal && a.Kind != tmInteger
	}
	unresolved := termHasUnresolved(receiver) || slices.ContainsFunc(args, termHasUnresolved)
	forest := receiver.Kind == tmCall && (receiver.Str == "parse" || receiver.Str == "error-free")
	var valid bool
	switch name {
	case "parse":
		if len(args) != 1 || !is(args[0], tmBody) || args[0].Body == nil {
			return methodSignatureProblem
		}
		if _, mode, _ := queryBody(args[0].Body); restoredTerm(receiver) && (mode == cdSuffix || mode == cdContains) {
			return "suffix parse requires an ordinary span, not a restored span"
		}
		valid = span
	case "error-free":
		valid = forest && len(args) == 0
	case "ngrams":
		valid = len(args) == 1 && is(args[0], tmInteger) && validInteger(args[0].Str)
	case "split":
		valid = len(args) == 1 && term(args[0]) && !(unresolved && is(args[0], tmString) && args[0].Str == "")
	case "classify":
		valid = len(args) == 1 && is(args[0], tmClassifier)
	case "tags":
		valid = (span || forest) && len(args) == 0
	case "followed-by", "preceded-by":
		valid = bare && len(args) > 0
		for _, a := range args {
			valid = valid && (rule(a) || is(a, tmTerminal))
		}
	case "without-elision-except":
		if !unresolved {
			if !bare {
				return "without-elision-except requires a bare capture: write $x.without-elision-except(family).onward"
			}
			if len(args) != 1 || !rule(args[0]) {
				return "without-elision-except requires one rule name"
			}
		}
		valid = bare && len(args) == 1 && rule(args[0])
	case "without-elision":
		if !unresolved && (!bare || len(args) != 0) {
			return "without-elision requires a bare capture: write $x.without-elision.onward"
		}
		valid = bare && len(args) == 0
	case "verbatim-text", "emitted":
		valid = recipe && bare && len(args) == 0
	default:
		valid = len(args) == 0 && (span || receiver.Kind == tmCall && receiver.Str == "emitted" && (name == "value" || name == "image"))
	}
	if !valid {
		return methodSignatureProblem
	}
	return ""
}

// termHasUnresolved says whether a parameter or a template call stands
// anywhere in t.
func termHasUnresolved(t *domTerm) bool {
	if t == nil {
		return false
	}
	if unresolvedTerm(t) {
		return true
	}
	if t.Kind == tmBody && t.Body != nil && exprHasUnresolved(t.Body) {
		return true
	}
	if t.Cond != nil && condHasUnresolved(t.Cond) {
		return true
	}
	return slices.ContainsFunc(t.Items, termHasUnresolved)
}

func exprHasUnresolved(e *domExpr) bool {
	if e == nil {
		return false
	}
	if e.Kind == exParam || e.Kind == exCall {
		return true
	}
	if termHasUnresolved(e.Value) || termHasUnresolved(e.Default) || termHasUnresolved(e.Ends[0]) || termHasUnresolved(e.Ends[1]) {
		return true
	}
	for _, r := range e.Requirements {
		if termHasUnresolved(r.Value) {
			return true
		}
	}
	return slices.ContainsFunc(exprChildren(e), exprHasUnresolved)
}

func condHasUnresolved(d *domCond) bool {
	if d == nil {
		return false
	}
	return termHasUnresolved(d.Left) || termHasUnresolved(d.Right) || termHasUnresolved(d.Span) || slices.ContainsFunc(d.Targets, termHasUnresolved) || condHasUnresolved(d.Inner) || slices.ContainsFunc(d.Items, condHasUnresolved)
}

func (c *domChecker) condition(d *domCond, depth int) {
	c.visit(depth, func() {
		if d != nil {
			defer func(previous [2]int) { c.at = previous }(c.enter(d.At))
		}
		c.conditionChecked(d, depth)
	})
}

func (c *domChecker) conditionChecked(d *domCond, depth int) {
	if c.deep(depth) {
		return
	}
	if d == nil {
		c.fail("a missing condition")
		return
	}
	// A condition the reader read from a method is checked as that
	// method first, in a condition's place (engine §9.3 step 5).
	if d.Method != nil {
		query := c.query
		c.query = true
		c.term(d.Method, depth, false)
		c.query = query
		if c.problem != nil {
			return
		}
	}
	switch d.Kind {
	case cdMethod:
		c.fail("a condition requires a query method")
	case cdTruthy:
		setAt := c.setAt
		if d.Left != nil && (d.Left.Kind == tmUnion || d.Left.Kind == tmIntersection || d.Left.Kind == tmDifference) {
			c.setAt = d.Left.At
			if c.setAt == [2]int{} {
				c.setAt = c.at
			}
		}
		c.term(d.Left, depth, false)
		c.setAt = setAt
	case cdForest:
		if !forestTerm(d.Left) {
			c.fail("a condition requires a forest")
			return
		}
		// A forest predicate is already its condition node (engine §9).
		c.term(d.Left, depth, false)
	case cdCompare:
		switch d.Op {
		case "=", "≠", "∈", "∉", "⊆", "⊈", "≅", "≇":
		default:
			c.fail("an unknown comparison %q", d.Op)
			return
		}
		if d.Left == nil || d.Right == nil {
			c.fail("a comparison without two terms")
			return
		}
		if (d.Op == "≅" || d.Op == "≇") && d.Left.Kind != tmCapture {
			c.fail("a tree comparison requires a bare capture")
			return
		}
		c.term(d.Left, depth+1, d.Op == "≅" || d.Op == "≇")
		c.term(d.Right, depth+1, false)
	case cdWhole, cdPrefix, cdSuffix:
		if d.Kind == cdSuffix && restoredTerm(d.Span) {
			c.fail("ends requires an ordinary span, not a restored span")
			return
		}
		for _, t := range d.queryTargets() {
			c.target(t, depth+1)
		}
		if !isSpanShape(d.Span) {
			c.fail("a malformed %s()", d.Kind)
			return
		}
		c.term(d.Span, depth+1, true)
	case cdBoundary:
		c.hasBoundary = true
		if d.Span == nil || d.Span.Kind != tmCapture && !unresolvedTerm(d.Span) || !boundaryMethod(d.Op) || len(d.Targets) == 0 {
			c.fail("a malformed boundary atom")
			return
		}
		c.term(d.Span, depth+1, true)
		for _, t := range d.Targets {
			c.target(t, depth+1)
		}
	case cdInitial, cdEnd:
		if !isSpanShape(d.Span) {
			method := "starts-input"
			if d.Kind == cdEnd {
				method = "ends-input"
			}
			c.fail("a malformed %s()", method)
			return
		}
		c.term(d.Span, depth+1, true)
	case cdNot:
		c.condition(d.Inner, depth+1)
	case cdAny, cdAll:
		if len(d.Items) < 2 {
			c.fail("an %s of %d conditions", d.Kind, len(d.Items))
			return
		}
		for _, it := range d.Items {
			c.condition(it, depth+1)
		}
	case cdIf:
		if len(d.Items) != 2 {
			c.fail("a malformed implication")
			return
		}
		for _, it := range d.Items {
			c.condition(it, depth+1)
		}
	case cdCaptured:
		if c.inArgument {
			c.noteArgCapture(d.At)
		}
		// A presence test, of a capture or of $.
		if d.Capture != "" && !captureName.MatchString(d.Capture) {
			c.fail("a presence test of %q", d.Capture)
		}
	default:
		c.fail("an unknown condition %q", d.Kind)
	}
}

// constituentTags checks a rule's or an alternative's tag term in the
// structural pass: its shape first, then the engine-tag literal that a
// tag clause cannot introduce (engine §9.3 step 5). A malformed tag
// term keeps its own structural fault. The type and own-tag checks are
// semantic, and run in the semantic pass.
func (c *domChecker) constituentTags(t *domTerm) {
	if t == nil || c.problem != nil {
		return
	}
	// The engine-tag literal comes first, and a malformed term keeps
	// its own structural fault (engine §9.3 step 5).
	if engineLiteralIn(t) {
		previous := c.enter(t.At)
		c.failAt(firstEngineLiteralAt(t), "a tag clause cannot introduce an engine tag")
		c.at = previous
		return
	}
	c.term(t, 0, false)
}

// engineLiteralIn says whether a tag term holds an engine-tag literal. A
// term too malformed to walk holds none.
func engineLiteralIn(t *domTerm) (found bool) {
	defer func() {
		if recover() != nil {
			found = false
		}
	}()
	return len(literalEngineTags(t)) > 0
}

// firstEngineLiteralAt is the position of the first engine-tag literal
// in a tag term, in written order, or the zero position.
func firstEngineLiteralAt(t *domTerm) [2]int {
	var first [2]int
	for _, occurrences := range literalEngineTags(t) {
		for _, at := range occurrences {
			if first == [2]int{} || before(at, first) {
				first = at
			}
		}
	}
	return first
}

// readsOwnTags says whether a term reads the tags of $, the constituent
// whose tags it defines: $.tags or $.classes anywhere in the term,
// including the conditions of its guards.
func readsOwnTags(t *domTerm) bool {
	// The parts to look at, with an explicit stack: a term is as deep as
	// its document nests until the check of its depth (§9).
	stack := []clausePart{{t: t}}
	for len(stack) > 0 {
		if w := work.Load(); w != nil {
			w.readerSteps.add("reader steps")
		}
		p := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if p.c != nil {
			if p.c.Kind == cdCompare && (p.c.Op == "≅" || p.c.Op == "≇") {
				if p.c.Left.Kind == tmCapture && p.c.Left.Str == "" && p.c.Right.Kind == tmPattern && patternReadsNodeTags(p.c.Right.Pattern) {
					return true
				}
				continue
			}
			// A parse reads the tokens again, .starts-input
			// reads where they begin, and a presence test reads no tags.
			switch p.c.Kind {
			case cdCompare, cdNot, cdAny, cdAll, cdIf:
				stack = append(stack, p.children()...)
			}
			continue
		}
		if p.t == nil {
			continue
		}
		switch p.t.Kind {
		case tmCapture:
		case tmIf, tmUnion, tmIntersection, tmDifference, tmConcat:
			stack = append(stack, p.children()...)
		case tmCall:
			if (p.t.Str == "tags" || p.t.Str == "classes") && len(p.t.Items) == 1 {
				a := p.t.Items[0]
				if a != nil && a.Kind == tmCapture && a.Str == "" {
					return true
				}
				continue
			}
			// A span argument is not a value; a term argument may be one.
			for _, a := range p.t.Items {
				if a != nil && a.Kind != tmCapture {
					stack = append(stack, clausePart{t: a})
				}
			}
		}
	}
	return false
}

// emission validates item clauses and named capture ownership (§11).
// Only named carriers accept attachments. Each named capture appears once.
func (c *domChecker) emission(e *domEmit) {
	if e == nil || c.problem != nil {
		return
	}
	if len(e.Items) == 0 {
		c.fail("a malformed emission")
		return
	}
	// Each item's form first, then each item's tags, value and image
	// (engine §9.3 step 5).
	for _, it := range e.Items {
		if it == nil {
			c.fail("a malformed emission item")
			return
		}
		if !it.IsInsert && it.Capture != "" && !captureName.MatchString(it.Capture) {
			c.failAt(c.declAt, "a malformed emission item")
			return
		}
		if len(it.Before)+len(it.After) > 0 && (it.IsInsert || it.Capture == "") {
			c.failAt(it.At, "a malformed attachment")
			return
		}
		for _, name := range it.attachments() {
			if !captureName.MatchString(name) {
				c.failAt(c.declAt, "a malformed attachment")
				return
			}
		}
	}
	for _, it := range e.Items {
		previous := c.enter(it.At)
		c.constituentTags(it.Tags)
		c.recipe(it.Value)
		c.recipe(it.Image)
		c.at = previous
	}
}

// ---- Types (engine §10)

// termType is a term's type: a string, a set of strings, a tag set, a
// span, a set whose kind nothing has given yet, such as ∅, or, for a
// constant whose type the reader cannot know, any type but a span.
type termType int

const (
	tyString termType = iota
	tyStrings
	tyTags
	tySpan
	tySet
	tyAny
	tyPattern
	tyForest
	tyBody
)

var typeNames = map[termType]string{tyBody: "a parse body", tyForest: "a forest", tyPattern: "a tree pattern", tyString: "a string", tyStrings: "a set of strings", tyTags: "a tag set", tySpan: "a span", tySet: "a set", tyAny: "a value"}

const spanNotValue = "a span is not a value: $x.tags is the tag set of $x"

// constTypes gives the type of each constant, where the loader knows it
// (engine §2). The reader knows none: a nil constTypes gives every
// constant the type tyAny.
type constTypes func(name string) termType

func (ct constTypes) of(name string) termType {
	if ct == nil {
		return tyAny
	}
	return ct(name)
}

// typeFault is a disagreement of types, and the smallest construct that
// holds it: a *domTerm or a *domCond.
type typeFault struct {
	problem string
	node    any
}

func isSetType(t termType) bool { return t == tyStrings || t == tyTags || t == tySet }

// callType is the type of the value a function gives.
func callType(name string) termType {
	switch name {
	case "parse", "error-free":
		return tyForest
	case "value", "image", "source-text", "decomposed-source-text", "verbatim-text":
		return tyString
	case "split", "ngrams":
		return tyStrings
	case "tags", "classes", "classify":
		return tyTags
	}
	return tySpan
}

// joinedType is the kind of the sets that ∪, ∩, ∖, ⊆ or ⊈ join, or why
// they cannot be joined: each is a set, and all whose kind is known have
// one kind. A constant whose type is not known yet fits any set.
func joinedType(types []termType, op string) (termType, string) {
	for _, t := range types {
		if t == tySpan {
			return 0, spanNotValue
		}
	}
	for _, t := range types {
		if t == tyString {
			t = tyStrings
		}
		if t != tyAny && t != tyPattern && !isSetType(t) {
			return 0, fmt.Sprintf("%s joins sets, not %s", op, typeNames[t])
		}
	}
	kind, unknown := tySet, false
	for _, t := range types {
		if t == tyString {
			t = tyStrings
		}
		if t == tyAny {
			unknown = true
			continue
		}
		if t == tySet {
			continue
		}
		if kind != tySet && kind != t {
			return 0, fmt.Sprintf("%s joins two sets of one kind, not a set of strings and a tag set", op)
		}
		kind = t
	}
	if kind == tySet && unknown {
		return tyAny, ""
	}
	return kind, ""
}

// comparisonProblem is why a comparison's two sides do not fit its
// comparator, or "". A side of type tyAny fits, and the loader checks it
// again (engine §9).
func comparisonProblem(op string, left, right termType) string {
	if op == "≅" || op == "≇" {
		if left != tySpan {
			return "a tree comparison requires a bare capture on its left"
		}
		if right != tySpan && right != tyPattern && right != tySet && right != tyAny {
			return "a tree comparison requires a pattern or a bare capture on its right"
		}
		return ""
	}
	if op != "∈" && op != "∉" && (left == tySpan || right == tySpan) && (isSetType(left) || isSetType(right)) || (op == "∈" || op == "∉") && right == tySpan {
		return spanNotValue
	}
	if left == tyPattern || right == tyPattern {
		return "tree patterns use ≅ or ≇"
	}
	if op == "=" || op == "≠" {
		if left == tySpan {
			left = tyString
		}
		if right == tySpan {
			right = tyString
		}
	}
	if (op == "∈" || op == "∉") && left == tySpan {
		left = tyString
	}
	switch op {
	case "∈", "∉":
		if left != tyString && left != tyAny {
			return fmt.Sprintf("%s tests a string, not %s, in a set of strings; ⊆ and ⊈ compare two sets", op, typeNames[left])
		}
		if right != tyString && right != tyStrings && right != tySet && right != tyAny {
			return fmt.Sprintf("%s tests a string in a set of strings, not in %s", op, typeNames[right])
		}
		return ""
	case "=", "≠":
		// Two values of one type.
		if left == tyAny || right == tyAny {
			return ""
		}
		if left == tyString && right == tyString {
			return ""
		}
	}
	kind, problem := joinedType([]termType{left, right}, op)
	if problem != "" {
		return problem
	}
	if kind == tySet {
		return fmt.Sprintf("the kind of the sets that %s compares is not given", op)
	}
	return ""
}

// expectedProblem is why a term of one type cannot stand where a string or
// a tag set is needed, or "". A set of open kind takes the kind it is
// given, and a constant of unknown type fits.
func expectedProblem(t, expected termType) string {
	if t == expected || t == tySpan && expected == tyString || t == tyAny || (t == tySet && expected == tyTags) {
		return ""
	}
	if t == tySpan {
		return spanNotValue
	}
	return fmt.Sprintf("%s is needed here, not %s", typeNames[expected], typeNames[t])
}

// typeOf is a term's type, or why its parts do not agree, as the reader
// sees it. The term's shape must already be checked.
func typeOf(t *domTerm) (termType, string) {
	ty, f := termTypeIn(t, nil)
	if f != nil {
		return 0, f.problem
	}
	return ty, ""
}

// termTypeIn is a term's type, or why its parts do not agree, with the
// smallest construct whose parts disagree; ct gives each constant's type.
func termTypeIn(t *domTerm, ct constTypes) (termType, *typeFault) {
	return termTypeMemo(t, ct, nil)
}

// typeMemo keeps the types found of terms and the type faults of
// conditions: a reader asks the type of each term it reads and of the
// terms around it, so each is found once, and a deep term costs no more
// than its size. A DOM is never changed once read.
type typeMemo struct {
	terms map[*domTerm]typeFound
	conds map[*domCond]*typeFault
}

type typeFound struct {
	ty termType
	f  *typeFault
}

func newTypeMemo() *typeMemo {
	return &typeMemo{terms: map[*domTerm]typeFound{}, conds: map[*domCond]*typeFault{}}
}

// termTypeMemo is termTypeIn through a memo, which may be nil. The parts
// of the term are typed first, below it to above, with an explicit stack,
// so each step looks one level down, into the memo.
func termTypeMemo(t *domTerm, ct constTypes, memo *typeMemo) (termType, *typeFault) {
	if memo == nil {
		memo = newTypeMemo()
	}
	if found, ok := memo.terms[t]; ok {
		return found.ty, found.f
	}
	memo.fill(clausePart{t: t}, ct)
	found := memo.terms[t]
	return found.ty, found.f
}

// fill types each term and condition at or below a part that the memo does
// not hold, the parts of each before it.
func (memo *typeMemo) fill(start clausePart, ct constTypes) {
	type frame struct {
		p    clausePart
		done bool
	}
	known := func(p clausePart) bool {
		if p.t != nil {
			_, ok := memo.terms[p.t]
			return ok || p.t.Kind == tmRule || p.t.Kind == tmClassifier
		}
		_, ok := memo.conds[p.c]
		return ok
	}
	stack := []frame{{p: start}}
	for len(stack) > 0 {
		if w := work.Load(); w != nil {
			w.readerSteps.add("reader steps")
		}
		top := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if known(top.p) {
			continue
		}
		if top.done {
			if top.p.t != nil {
				ty, f := termTypeOnce(top.p.t, ct, memo)
				memo.terms[top.p.t] = typeFound{ty, f}
			} else {
				memo.conds[top.p.c] = condTypeOnce(top.p.c, ct, memo)
			}
			continue
		}
		stack = append(stack, frame{p: top.p, done: true})
		for _, kid := range top.p.children() {
			if !known(kid) {
				stack = append(stack, frame{p: kid})
			}
		}
	}
}

func termTypeOnce(t *domTerm, ct constTypes, memo *typeMemo) (termType, *typeFault) {
	if w := work.Load(); w != nil {
		w.readerSteps.add("reader steps")
	}
	switch t.Kind {
	case tmBody:
		for _, term := range queryTerms(t.Body) {
			if _, fault := termTypeMemo(term, ct, memo); fault != nil {
				return 0, fault
			}
		}
		return tyBody, nil
	case tmParam, tmSourceCall:
		return tyAny, nil
	case tmPattern:
		var fault *typeFault
		walkPattern(t.Pattern, func(p *domPattern) {
			if fault != nil {
				return
			}
			if p.Kind == "constant" {
				if ty := ct.of(p.Name); ty != tyString && ty != tyPattern && ty != tyAny {
					msg := "a pattern atom requires a string or pattern constant"
					fault = &typeFault{msg, &domTerm{Kind: tmConst, Str: p.Name, At: p.At}}
				}
			}
			operands := []*domTerm{}
			if p.Kind == "literal" {
				operands = append(operands, p.Value)
			}
			if p.Kind == "range" {
				operands = append(operands, p.Ends[:]...)
			}
			for _, operand := range operands {
				ty, f := termTypeMemo(operand, ct, memo)
				if f != nil {
					fault = f
					return
				}
				if ty != tyString && ty != tyAny {
					fault = &typeFault{"a pattern terminal requires a string", operand}
					return
				}
			}
			if p.Kind == "test" && p.Op == "tags" {
				for _, requirement := range p.Requirements {
					ty, f := termTypeMemo(requirement.Value, ct, memo)
					if f != nil {
						fault = f
						return
					}
					if problem := expectedProblem(ty, tyTags); problem != "" {
						fault = &typeFault{problem, requirement.Value}
						return
					}
				}
			}
			if p.Kind == "test" && p.Op != "tags" {
				ty, f := termTypeMemo(p.Value, ct, memo)
				if f != nil {
					fault = f
				} else if msg := testTypeProblem(p.Op, ty); msg != "" {
					fault = &typeFault{msg, p.Value}
				}
			}
		})
		return tyPattern, fault
	case tmString:
		return tyString, nil
	case tmConcat:
		for _, part := range t.Items {
			ty, f := termTypeMemo(part, ct, memo)
			if f != nil {
				return 0, f
			}
			if ty != tyString && ty != tyAny {
				return 0, &typeFault{"++ requires string operands", t}
			}
		}
		return tyString, nil
	case tmTag:
		return tyTags, nil
	case tmEmptySet:
		return tySet, nil
	case tmCapture:
		return tySpan, nil
	case tmConst:
		return ct.of(t.Str), nil
	case tmUnion, tmIntersection, tmDifference:
		op := map[string]string{tmUnion: "∪", tmIntersection: "∩", tmDifference: "∖"}[t.Kind]
		types := make([]termType, 0, len(t.Items))
		for _, it := range t.Items {
			ty, f := termTypeMemo(it, ct, memo)
			if f != nil {
				return 0, f
			}
			types = append(types, ty)
		}
		ty, problem := joinedType(types, op)
		if problem != "" {
			return 0, &typeFault{problem, t}
		}
		return ty, nil
	case tmIf:
		if f := condTypeMemo(t.Cond, ct, memo); f != nil {
			return 0, f
		}
		ty, f := termTypeMemo(t.Items[0], ct, memo)
		if f != nil {
			return 0, f
		}
		kind, problem := joinedType([]termType{ty}, "⟹")
		if kind == tyPattern {
			problem = "a guarded term requires a set"
		}
		if problem != "" {
			return 0, &typeFault{problem, t}
		}
		return kind, nil
	case tmCall:
		for _, a := range t.Items {
			if a.Kind == tmRule || a.Kind == tmClassifier || a.Kind == tmInteger {
				continue
			}
			ty, f := termTypeMemo(a, ct, memo)
			if f != nil {
				return 0, f
			}
			if t.Str == "split" || t.Str == "classify" || t.Str == "ngrams" {
				if problem := expectedProblem(ty, tyString); problem != "" {
					return 0, &typeFault{"a method has the wrong receiver or arguments", t}
				}
			}
			if t.Str == "error-free" && ty != tyForest && ty != tyAny {
				return 0, &typeFault{"error-free requires a forest", t}
			}
		}
		if problem := literalCallProblem(t.Str, t.Items); problem != "" {
			return 0, &typeFault{problem, t}
		}
		return callType(t.Str), nil
	}
	return 0, &typeFault{"a malformed term", t}
}

// condTypeProblem is why a condition's terms do not agree in type, or "".
func condTypeProblem(c *domCond) string {
	if f := condTypeFault(c, nil); f != nil {
		return f.problem
	}
	return ""
}

// condTypeFault is why a condition's terms do not agree in type, with the
// smallest construct that disagrees, or nil.
func condTypeFault(c *domCond, ct constTypes) *typeFault {
	return condTypeMemo(c, ct, nil)
}

// condTypeMemo is condTypeFault through a memo, which may be nil, typing
// its parts first, as termTypeMemo does.
func condTypeMemo(c *domCond, ct constTypes, memo *typeMemo) *typeFault {
	if memo == nil {
		memo = newTypeMemo()
	}
	if f, ok := memo.conds[c]; ok {
		return f
	}
	memo.fill(clausePart{c: c}, ct)
	return memo.conds[c]
}

func condTypeOnce(c *domCond, ct constTypes, memo *typeMemo) *typeFault {
	if w := work.Load(); w != nil {
		w.readerSteps.add("reader steps")
	}
	switch c.Kind {
	case cdTruthy:
		ty, fault := termTypeMemo(c.Left, ct, memo)
		if fault != nil {
			return fault
		}
		if ty != tyTags && ty != tyStrings && ty != tySet && ty != tyAny {
			return &typeFault{"a condition requires a set, a forest, or a query method", c}
		}
	case cdForest:
		ty, fault := termTypeMemo(c.Left, ct, memo)
		if fault != nil {
			return fault
		}
		if ty != tyForest && ty != tyAny {
			return &typeFault{"a condition requires a forest", c}
		}
	case cdAny, cdAll, cdIf:
		for _, it := range c.Items {
			if f := condTypeMemo(it, ct, memo); f != nil {
				return f
			}
		}
	case cdNot:
		return condTypeMemo(c.Inner, ct, memo)
	case cdCompare:
		left, f := termTypeMemo(c.Left, ct, memo)
		if f != nil {
			return f
		}
		right, f := termTypeMemo(c.Right, ct, memo)
		if f != nil {
			return f
		}
		if c.Op == "≅" || c.Op == "≇" {
			if right == tySpan && c.Right.Kind != tmCapture {
				return &typeFault{"a tree comparison requires a pattern or a bare capture on its right", c.Right}
			}
			if c.Left.Kind == tmCapture && c.Right.Kind == tmCapture && c.Left.Str == c.Right.Str {
				return &typeFault{"a constituent comparison requires two different captures", c}
			}
		}
		if problem := comparisonProblem(c.Op, left, right); problem != "" {
			node := any(c)
			if (c.Op == "≅" || c.Op == "≇") && left == tySpan {
				node = c.Right
			}
			return &typeFault{problem, node}
		}
	}
	return nil
}

// recipeAtomFault is why a recipe atom is not a string term or one of
// the recipe string methods on a bare capture, or nil (engine §9.3).
func recipeAtomFault(atom *domTerm) *typeFault {
	if stringTermShape(atom) {
		return nil
	}
	if atom == nil || atom.Kind != tmCall || len(atom.Items) != 1 {
		return &typeFault{"a malformed recipe atom", atom}
	}
	switch atom.Str {
	case "value", "image", "source-text", "decomposed-source-text", "verbatim-text":
	default:
		return &typeFault{"a malformed recipe atom", atom}
	}
	receiver := atom.Items[0]
	if receiver != nil && receiver.Kind == tmCapture {
		return nil
	}
	if receiver != nil && receiver.Kind == tmCall && receiver.Str == "emitted" && len(receiver.Items) == 1 && receiver.Items[0] != nil && receiver.Items[0].Kind == tmCapture && (atom.Str == "value" || atom.Str == "image") {
		return nil
	}
	return &typeFault{"a malformed recipe receiver", atom}
}

func tagTermFault(t *domTerm, ct constTypes) *typeFault {
	ty, f := termTypeIn(t, ct)
	if f != nil {
		return f
	}
	if problem := expectedProblem(ty, tyTags); problem != "" {
		return &typeFault{problem, t}
	}
	return nil
}

// ruleTypeFault is why a rule's terms and conditions do not agree in type,
// with the construct at fault, or nil.
func ruleTypeFault(r *domRule, ct constTypes) *typeFault {
	var faults []*typeFault
	keep := func(f *typeFault) {
		if f != nil {
			faults = append(faults, f)
		}
	}
	stringUse := func(t *domTerm) {
		ty, f := termTypeIn(t, ct)
		if f != nil {
			keep(f)
		} else if problem := expectedProblem(ty, tyString); problem != "" {
			keep(&typeFault{problem, t})
		}
	}
	for _, recipe := range ruleRecipes(r) {
		for _, atom := range recipe.Items {
			if f := recipeAtomFault(atom); f != nil {
				keep(f)
				continue
			}
			stringUse(atom)
		}
	}
	for _, a := range r.Alternatives {
		stack := []*domExpr{a.Expr}
		for len(stack) > 0 {
			e := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			if e == nil {
				continue
			}
			if e.Kind == exLiteral {
				stringUse(e.Value)
			}
			if e.Kind == exRange {
				for _, end := range e.Ends {
					stringUse(end)
				}
			}
			stack = append(stack, e.Sep, e.Inner)
			for i := len(e.Items) - 1; i >= 0; i-- {
				stack = append(stack, e.Items[i])
			}
		}
	}
	for _, t := range ruleTagTerms(r) {
		if f := tagTermFault(t, ct); f != nil {
			keep(f)
		}
	}
	for _, c := range r.Conditions {
		if f := condTypeFault(c, ct); f != nil {
			keep(f)
		}
	}
	// A test's value is a string for a sound test and a tag set for a tag
	// test (engine §9, §10).
	for _, a := range r.Alternatives {
		for _, t := range testsIn(a.Expr) {
			if t.Op == "tags" {
				for _, r := range t.Requirements {
					ty, f := termTypeIn(r.Value, ct)
					if f != nil {
						keep(f)
						continue
					}
					if problem := expectedProblem(ty, tyTags); problem != "" {
						keep(&typeFault{problem, r.Value})
					}
				}
				continue
			}
			ty, f := termTypeIn(t.Value, ct)
			if f != nil {
				keep(f)
				continue
			}
			if problem := testTypeProblem(t.Op, ty); problem != "" {
				keep(&typeFault{problem, t.Value})
			}
		}
		pending := []*domExpr{a.Expr}
		for len(pending) > 0 {
			e := pending[len(pending)-1]
			pending = pending[:len(pending)-1]
			if e == nil {
				continue
			}
			if e.Default != nil {
				ty, fault := termTypeIn(e.Default, ct)
				if fault != nil {
					return fault
				}
				if problem := expectedProblem(ty, tyString); problem != "" {
					return &typeFault{problem, e.Default}
				}
			}
			pending = append(pending, exprChildren(e)...)
		}
	}
	if len(faults) == 0 {
		return nil
	}
	if len(faults) == 1 {
		return faults[0]
	}
	order := map[any]int{}
	type reference struct {
		name string
		at   [2]int
	}
	references := map[reference]int{}
	index := 0
	add := func(part clausePart) {
		walkClause(part, func(p clausePart) bool {
			var node any = p.t
			if p.c != nil {
				node = p.c
			}
			if _, ok := order[node]; !ok {
				order[node] = index
			}
			if p.t != nil && p.t.Kind == tmConst {
				key := reference{p.t.Str, p.t.At}
				if _, ok := references[key]; !ok {
					references[key] = index
				}
			}
			return true
		})
		index++
	}
	term := func(t *domTerm) {
		if t != nil {
			add(clausePart{t: t})
		}
	}
	term(r.Tags)
	term(r.Value)
	term(r.Image)
	for _, alternative := range r.Alternatives {
		pending := []*domExpr{alternative.Expr}
		for len(pending) > 0 {
			e := pending[len(pending)-1]
			pending = pending[:len(pending)-1]
			if e == nil {
				continue
			}
			term(e.Value)
			for _, end := range e.Ends {
				term(end)
			}
			for _, requirement := range e.Requirements {
				term(requirement.Value)
			}
			pending = append(pending, e.Sep, e.Inner)
			for i := len(e.Items) - 1; i >= 0; i-- {
				pending = append(pending, e.Items[i])
			}
		}
		term(alternative.Tags)
		term(alternative.Value)
		term(alternative.Image)
	}
	for _, condition := range r.Conditions {
		add(clausePart{c: condition})
	}
	term(r.Error)
	term(r.Warning)
	if r.Emit != nil {
		for _, item := range r.Emit.Items {
			term(item.Tags)
			term(item.Value)
			term(item.Image)
		}
	}
	// Pattern atoms expose their references through temporary terms.
	for _, fault := range faults {
		if _, ok := order[fault.node]; ok {
			continue
		}
		if term, ok := fault.node.(*domTerm); ok && term.Kind == tmConst {
			order[fault.node] = references[reference{term.Str, term.At}]
		}
	}
	slices.SortStableFunc(faults, func(a, b *typeFault) int { return order[a.node] - order[b.node] })
	var first *typeFault
	largest := int(^uint(0) >> 1)
	next := [2]int{largest, largest}
	position := [3]int{largest, largest, 2}
	for i := len(faults) - 1; i >= 0; i-- {
		fault := faults[i]
		refs := constRefs(fault.node)
		if len(refs) > 0 {
			next = refs[0].At
			for _, ref := range refs[1:] {
				if before(ref.At, next) {
					next = ref.At
				}
			}
		}
		key := [3]int{next[0], next[1], 0}
		if len(refs) > 0 {
			key[2] = 1
		}
		if first == nil || slices.Compare(key[:], position[:]) <= 0 {
			first, position = fault, key
		}
	}
	return first
}

// ruleTagTerms lists a rule's tag terms that are written: its %tags, its
// alternatives' and its emitted items', in that order.
func ruleTagTerms(r *domRule) []*domTerm {
	var terms []*domTerm
	add := func(t *domTerm) {
		if t != nil {
			terms = append(terms, t)
		}
	}
	add(r.Tags)
	for _, a := range r.Alternatives {
		add(a.Tags)
	}
	if r.Emit != nil {
		for _, it := range r.Emit.Items {
			add(it.Tags)
		}
	}
	return terms
}

// constantValueType is the type of a constant's value, or why it cannot be
// one (engine §2, §10): a string, a set of strings or a tag set. A
// redefinition keeps the constant's type, which gives ∅ its kind, so its
// value can be of open kind.
func constantValueType(value *domTerm, redefine bool, ct constTypes) (termType, *typeFault) {
	ty, f := termTypeIn(value, ct)
	if f != nil {
		return 0, f
	}
	if ty == tySpan {
		return 0, &typeFault{"a constant's value is a string or a set, never a span", value}
	}
	if ty == tySet && !redefine {
		return 0, &typeFault{"the kind of the set that the constant holds is not given", value}
	}
	return ty, nil
}

// ---- Constants (engine §2, §10)

// constName is the syntax of a constant's name, without its $: a name that
// begins with a capital (engine §2).
var constName = notationName{regexp.MustCompile(`^[A-Z][A-Za-z0-9_-]*$`)}

// openPart is the first part of a term that is not closed (engine §10), or
// nil: a capture, a guarded term, or a call of anything but split and ngrams.
func openPart(t *domTerm) *domTerm {
	if t == nil {
		return nil
	}
	switch t.Kind {
	case tmCapture, tmIf:
		return t
	case tmCall:
		if t.Str != "split" && t.Str != "ngrams" {
			return t
		}
	case tmPattern:
		var found *domTerm
		walkPattern(t.Pattern, func(p *domPattern) {
			if found == nil && p.Value != nil {
				found = openPart(p.Value)
			}
		})
		return found
	case tmUnion, tmIntersection, tmDifference, tmConcat:
	default:
		return nil
	}
	for _, it := range t.Items {
		if open := openPart(it); open != nil {
			return open
		}
	}
	return nil
}

// constRefs lists the references to constants in terms, conditions, rules
// and lists of them, in the order written.
func constRefs(nodes ...any) []*domTerm {
	var found []*domTerm
	collect := func(root valuePart) {
		walkValues(root, func(part valuePart) *Error {
			if t := part.term; t != nil && t.Kind == tmConst {
				found = append(found, t)
			}
			if p := part.patternNode; p != nil && p.Kind == "constant" {
				found = append(found, &domTerm{Kind: tmConst, Str: p.Name, At: p.At})
			}
			return nil
		}, true)
	}
	for _, n := range nodes {
		switch x := n.(type) {
		case *domTerm:
			collect(valuePart{term: x})
		case *domCond:
			collect(valuePart{cond: x})
		case []*domCond:
			for _, c := range x {
				collect(valuePart{cond: c})
			}
		case *domRule:
			collect(valuePart{rule: x})
		}
	}
	return found
}

func inputConditionsProblem(conditions []*domCond) string {
	allowed := map[string]bool{"tags": true, "classes": true, "value": true, "image": true, "source-text": true, "decomposed-source-text": true, "first-token": true, "tokens-after-first": true, "last-token": true, "split": true, "ngrams": true}
	problem := ""
	for _, condition := range conditions {
		walkClause(clausePart{c: condition}, func(p clausePart) bool {
			if problem != "" {
				return false
			}
			if t := p.t; t != nil {
				if t.Kind == tmCapture && t.Str != "" {
					problem = "feature conditions can read only $"
				}
				if t.Kind == tmCall && (!allowed[t.Str] || t.Str == "tags" && len(t.Items) != 1) {
					problem = "feature conditions can read only tokens"
				}
			}
			if c := p.c; c != nil {
				switch c.Kind {
				case cdCompare:
					if c.Op == "≅" || c.Op == "≇" {
						problem = "feature conditions can read only tokens"
					}
				case cdCaptured:
					if c.Capture != "" {
						problem = "feature conditions can read only $"
					}
				case cdNot, cdAny, cdAll, cdIf, cdTruthy:
				default:
					problem = "feature conditions can read only tokens"
				}
			}
			return true
		})
		if problem != "" {
			return problem
		}
		if problem = condTypeProblem(condition); problem != "" {
			return problem
		}
	}
	return ""
}
