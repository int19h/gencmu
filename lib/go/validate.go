package gencmu

import (
	"fmt"
	"regexp"
	"strings"
)

// The DOM of a grammar document, when it did not come from reading the
// document (the bootstrap's, or a precompiled one from compiled.json), is
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

var domName = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9-]*$`)

// captureName is the syntax of a capture's name, all lower case (engine §9).
var captureName = regexp.MustCompile(`^[a-z][a-z0-9-]*$`)

// domProblem is why a DOM is malformed; tooDeep marks the nesting limit,
// the one problem a DOM the reader built can have.
type domProblem struct {
	message string
	rule    *domRule
	tooDeep bool
}

func (p *domProblem) Error() string { return p.message }

func validateDOM(d *domDoc, uni *unicodeTable) error {
	if p := checkDOM(d, uni); p != nil {
		return p
	}
	return nil
}

// checkDOM checks a DOM; uni is the lowercase mapping that spellings are
// checked against, or nil not to check that.
func checkDOM(d *domDoc, uni *unicodeTable) *domProblem {
	for _, dir := range d.Directives {
		if dir == nil || dir.Args == nil || !directiveOperandsOK(dir) {
			return &domProblem{message: "a malformed directive"}
		}
	}
	// The order of a document's items is the order of their positions, so
	// no two items share one (engine §9).
	positions := map[[2]int]bool{}
	for _, r := range d.Rules {
		if r == nil {
			continue
		}
		if positions[r.At] {
			return &domProblem{message: "two items at one position"}
		}
		positions[r.At] = true
	}
	for _, dir := range d.Directives {
		if positions[dir.At] {
			return &domProblem{message: "two items at one position"}
		}
		positions[dir.At] = true
	}
	for _, r := range d.Rules {
		if r == nil || !(domName.MatchString(r.Name) || r.Name == "#") || (r.Op != "define" && r.Op != "redefine" && r.Op != "extend") || len(r.Alternatives) == 0 {
			return &domProblem{message: "a malformed rule"}
		}
		c := &domChecker{rule: r, uni: uni}
		c.constituentTags(r.Tags)
		c.emission(r.Emit)
		for _, cond := range r.Conditions {
			c.condition(cond, 0)
		}
		for _, a := range r.Alternatives {
			if a == nil || a.Guards == nil {
				c.fail("a malformed alternative")
				continue
			}
			// A guard is a gate or a warning, and a warning has no negated
			// form (§9).
			for _, g := range a.Guards {
				if g.Kind != FeatureGate && (g.Kind != FeatureWarning || g.Negated) {
					c.fail("a malformed guard")
				}
			}
			c.captures = map[string]bool{}
			c.expr(a.Expr, 0, true)
			c.constituentTags(a.Tags)
		}
		if c.problem != nil {
			return c.problem
		}
		// The definition as a whole (engine §9, the end), and the types of
		// its terms and conditions (engine §10).
		if msg := definitionProblem(r); msg != "" {
			return &domProblem{message: msg, rule: r}
		}
		if msg := ruleTypeProblem(r); msg != "" {
			return &domProblem{message: fmt.Sprintf("rule %s: %s", r.Name, msg), rule: r}
		}
	}
	return nil
}

// directiveOperandsOK checks the operands the notation's syntax allows the
// pipeline directives (engine §9): %stage one name, %include one string,
// %features one or more names, and %elidable names, each the name of an
// identifier tag.
func directiveOperandsOK(dir *domDirective) bool {
	switch dir.Name {
	case "stage":
		return len(dir.Args) == 1 && domName.MatchString(dir.Args[0])
	case "include":
		return len(dir.Args) == 1
	case "features", "elidable":
		if dir.Name == "features" && len(dir.Args) == 0 {
			return false
		}
		for _, a := range dir.Args {
			if !domName.MatchString(a) {
				return false
			}
		}
	}
	return true
}

type domChecker struct {
	rule     *domRule
	uni      *unicodeTable
	captures map[string]bool
	problem  *domProblem
}

func (c *domChecker) fail(format string, args ...any) {
	if c.problem == nil {
		c.problem = &domProblem{message: fmt.Sprintf("rule %s: ", c.rule.Name) + fmt.Sprintf(format, args...), rule: c.rule}
	}
}

func (c *domChecker) deep(depth int) bool {
	if depth > maxDOMDepth {
		if c.problem == nil {
			c.problem = &domProblem{message: fmt.Sprintf("rule %s: an expression, term or condition is nested more than %d deep", c.rule.Name, maxDOMDepth), rule: c.rule, tooDeep: true}
		}
		return true
	}
	return c.problem != nil
}

// expr checks an expression; top says it is the alternative's own or an
// item of its top-level seq, the only places a capture may stand (§3.5).
func (c *domChecker) expr(e *domExpr, depth int, top bool) {
	if c.deep(depth) {
		return
	}
	if e == nil {
		c.fail("a missing expression")
		return
	}
	switch e.Kind {
	case exSeq, exChoice, exAnd:
		// The reader makes each only of two or more, an & of at most 16.
		if len(e.Items) < 2 || (e.Kind == exAnd && len(e.Items) > maxAnd) {
			c.fail("a %s of %d items", e.Kind, len(e.Items))
			return
		}
		for _, it := range e.Items {
			c.expr(it, depth+1, top && e.Kind == exSeq)
		}
	case exOptional:
		c.expr(e.Inner, depth+1, false)
	case exRepeat:
		if e.Min != 0 && e.Min != 1 {
			c.fail("a repetition with min %d", e.Min)
			return
		}
		c.expr(e.Inner, depth+1, false)
	case exCapture:
		if !top {
			c.fail("a capture inside [ ], ( ), ..., & or a choice")
			return
		}
		// A capture wraps a reference or a terminal, its name once per
		// alternative; $, the whole constituent, wraps nothing.
		if e.Name == "" {
			c.fail("$ wraps a symbol")
			return
		}
		if !captureName.MatchString(e.Name) {
			c.fail("a capture name is not all lower case")
			return
		}
		if e.Inner == nil || !isCapturable(e.Inner.Kind) || (e.Inner.Kind == exRef && e.Inner.Name == "") {
			c.fail("a capture of something other than a reference, a terminal, a range, a property or a spelled one of these")
			return
		}
		if c.captures[e.Name] {
			c.fail("$%s is captured twice in one alternative", e.Name)
		}
		c.captures[e.Name] = true
		if len(c.captures) > 4 {
			c.fail("an alternative has at most four captures")
		}
		// A capture is a compound node: its symbol lies below it.
		if e.Inner.Kind == exSpelling || e.Inner.Kind == exRange || e.Inner.Kind == exProperty {
			c.expr(e.Inner, depth+1, false)
		} else {
			c.deep(depth + 1)
		}
	case exSpelling:
		if msg := spellingProblem(e.Name, e.Inner, c.uni); msg != "" {
			c.fail("%s", msg)
			return
		}
		// A spelled symbol is a compound node over its symbol.
		c.deep(depth + 1)
	case exRef:
		if e.Name == "" {
			c.fail("an empty ref")
		}
	case exTerminal:
		// A tag in its canonical spelling (engine §1).
		if !isTag(e.Name, c.uni) {
			c.fail("a malformed terminal %q", e.Name)
		}
	case exRange:
		if msg := rangeProblem(e.Range, c.uni); msg != "" {
			c.fail("%s", msg)
		}
	case exProperty:
		if msg := propertyProblem(e.Name); msg != "" {
			c.fail("%s", msg)
		}
	case exEmpty:
	default:
		c.fail("an unknown expression %q", e.Kind)
	}
}

// isCapturable says whether a capture can wrap an expression of a kind: a
// reference, a terminal, a range, a property or a spelled symbol (engine §9).
func isCapturable(kind string) bool {
	switch kind {
	case exRef, exTerminal, exRange, exProperty, exSpelling:
		return true
	}
	return false
}

// rangeProblem is what is wrong with a range (engine §1, §9), or "": its
// ends must be two character tags in their canonical spelling, the start
// not above the end. Without a table, which says which code points are
// marks, an end passes in either spelling that a table could make
// canonical.
func rangeProblem(r [2]string, uni *unicodeTable) string {
	var codes [2]rune
	for i, end := range r {
		if !isTag(end, uni) {
			return "a range's ends are two character tags"
		}
		var c rune
		var ok bool
		if uni != nil {
			c, ok = characterOfTag(end, uni.isMark)
		} else if c, ok = characterOfTag(end, func(rune) bool { return false }); !ok {
			c, ok = characterOfTag(end, func(rune) bool { return true })
		}
		if !ok {
			return "a range's ends are two character tags"
		}
		codes[i] = c
	}
	if codes[0] > codes[1] {
		return fmt.Sprintf("the range %s..%s starts above its end", r[0], r[1])
	}
	return ""
}

// propertyProblem is what is wrong with a property's name (engine §1, §9),
// or "".
func propertyProblem(name string) string {
	if !propertyNames[name] {
		return fmt.Sprintf(`'\p{%s}' is not a property: a property is a General_Category value in its short form, a one-letter group of them, White_Space or Any`, name)
	}
	return ""
}

// spellingProblem is what is wrong with a spelling of a symbol (engine §9),
// or "": an empty spelling, one with a backtick, which the notation cannot
// write, one that the lowercase mapping would change, since the match
// ignores stress, or one of anything but a reference or a terminal, #
// included. Without a table, the lowercase mapping is not checked.
func spellingProblem(spelling string, inner *domExpr, uni *unicodeTable) string {
	if spelling == "" {
		return "a spelling is empty"
	}
	if strings.Contains(spelling, "`") {
		return "a spelling holds a backtick"
	}
	if inner == nil || !((inner.Kind == exRef && inner.Name != "" && inner.Name != "#") || inner.Kind == exTerminal) {
		return "a spelling follows only a reference other than # or a terminal"
	}
	if uni != nil && uni.lowercase(spelling) != spelling {
		return fmt.Sprintf("the spelling %s is not in lower case", spelling)
	}
	return ""
}

// isSpanShape: a capture, or head, tail, last, from or after of a span.
func isSpanShape(t *domTerm) bool {
	return t != nil && (t.Kind == tmCapture || (t.Kind == tmCall && isSpanFunction(t.Str)))
}

// term checks a term; argument says it is a function's argument, where a
// span may stand. A nil term is an absent, optional one.
func (c *domChecker) term(t *domTerm, depth int, argument bool) {
	if t == nil || c.deep(depth) {
		return
	}
	switch t.Kind {
	case tmString, tmCapture, tmEmptySet:
	case tmTag:
		if !isTag(t.Str, c.uni) {
			c.fail("a malformed tag %q", t.Str)
		}
	case tmRange:
		if msg := rangeProblem(t.Range, c.uni); msg != "" {
			c.fail("%s", msg)
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
		// The reader's signatures (engine §9), with a span where one is due;
		// head, tail, last, from and after only where a span may stand, and
		// matches, begins and initial never as terms.
		args := t.Items
		isRule := func(a *domTerm) bool { return a != nil && a.Kind == tmRule && a.Str != "" }
		var ok bool
		switch t.Str {
		case "phonemes", "text", "runs", "classes", "head", "tail", "last", "from", "after":
			ok = len(args) == 1 && isSpanShape(args[0])
		case "tags":
			ok = (len(args) == 1 && isSpanShape(args[0])) || (len(args) == 2 && isSpanShape(args[0]) && isRule(args[1]))
		case "lowercase":
			// Its one argument is a value, whose type is checked with the
			// rule's (engine §10).
			ok = len(args) == 1 && args[0] != nil && !isRule(args[0]) && !isSpanShape(args[0])
		}
		if !ok || (!argument && isSpanFunction(t.Str)) {
			c.fail("a malformed call of %q", t.Str)
			return
		}
		for _, a := range args {
			if isRule(a) {
				c.deep(depth + 1) // a rule name is a node below the call
			} else {
				c.term(a, depth+1, true)
			}
		}
	case tmIf:
		// A guarded term: a condition, and the term it guards.
		if t.Cond == nil || len(t.Items) != 1 || t.Items[0] == nil || argument {
			c.fail("a malformed guarded term")
			return
		}
		c.condition(t.Cond, depth+1)
		c.term(t.Items[0], depth+1, false)
	default:
		c.fail("an unknown term %q", t.Kind)
	}
}

func (c *domChecker) condition(d *domCond, depth int) {
	if c.deep(depth) {
		return
	}
	if d == nil {
		c.fail("a missing condition")
		return
	}
	switch d.Kind {
	case cdCompare:
		switch d.Op {
		case "=", "≠", "∈", "∉", "⊆", "⊈":
		default:
			c.fail("an unknown comparison %q", d.Op)
			return
		}
		if d.Left == nil || d.Right == nil {
			c.fail("a comparison without two terms")
			return
		}
		c.term(d.Left, depth+1, false)
		c.term(d.Right, depth+1, false)
	case cdMatches, cdBegins:
		if !isSpanShape(d.Span) || d.Rule == "" {
			c.fail("a malformed %s()", d.Kind)
			return
		}
		c.term(d.Span, depth+1, true)
	case cdInitial:
		if !isSpanShape(d.Span) {
			c.fail("a malformed initial()")
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
		// A presence test, of a capture or of $.
		if d.Rule != "" && !domName.MatchString(d.Rule) {
			c.fail("a presence test of %q", d.Rule)
		}
	default:
		c.fail("an unknown condition %q", d.Kind)
	}
}

// constituentTags checks a rule's or an alternative's tag term, which
// cannot read the tags it defines (§9). Its shape is checked first, so
// that readsOwnTags walks only a well-formed term.
func (c *domChecker) constituentTags(t *domTerm) {
	c.term(t, 0, false)
	if t != nil && c.problem == nil && readsOwnTags(t) {
		c.fail("a constituent's tags made of its own")
	}
}

// readsOwnTags says whether a term reads the tags of $, the constituent
// whose tags it may be defining: $ itself as a value, tags($) or
// classes($), anywhere in it, the conditions of its guards included.
func readsOwnTags(t *domTerm) bool {
	if t == nil {
		return false
	}
	switch t.Kind {
	case tmCapture:
		return t.Str == ""
	case tmIf:
		return condReadsOwnTags(t.Cond) || readsOwnTags(t.Items[0])
	case tmUnion, tmIntersection, tmDifference:
		for _, it := range t.Items {
			if readsOwnTags(it) {
				return true
			}
		}
	case tmCall:
		if (t.Str == "tags" || t.Str == "classes") && len(t.Items) == 1 {
			a := t.Items[0]
			return a != nil && a.Kind == tmCapture && a.Str == ""
		}
		// A span argument is not a value; a term argument may be one.
		for _, a := range t.Items {
			if a != nil && a.Kind != tmCapture && readsOwnTags(a) {
				return true
			}
		}
	}
	return false
}

// condReadsOwnTags is readsOwnTags of a guard's condition: matches() and
// begins() parse the tokens again, initial() reads where they begin, and a
// presence test reads no tags.
func condReadsOwnTags(c *domCond) bool {
	if c == nil {
		return false
	}
	switch c.Kind {
	case cdCompare:
		return readsOwnTags(c.Left) || readsOwnTags(c.Right)
	case cdNot:
		return condReadsOwnTags(c.Inner)
	case cdAny, cdAll, cdIf:
		for _, it := range c.Items {
			if condReadsOwnTags(it) {
				return true
			}
		}
	}
	return false
}

// emission: $ only with $; a capture other than $ listed once; no tags on
// an inserted tag; no ∅ as an item's tags. No items is ε.
func (c *domChecker) emission(e *domEmit) {
	if e == nil {
		return
	}
	whole := 0
	listed := map[string]bool{}
	for _, it := range e.Items {
		if it == nil {
			c.fail("a missing emission item")
			return
		}
		switch {
		case it.IsInsert:
			if it.Tags != nil {
				c.fail("tags on an inserted tag")
				return
			}
			// An inserted item is one tag (engine §9).
			if !isTag(it.Insert, c.uni) {
				c.fail("a malformed inserted tag %q", it.Insert)
				return
			}
		case it.Capture == "":
			whole++
		default:
			if listed[it.Capture] {
				c.fail("$%s is listed twice in an emission", it.Capture)
				return
			}
			listed[it.Capture] = true
		}
		if it.Tags != nil && it.Tags.Kind == tmEmptySet {
			c.fail("∅ as an emitted item's tags")
			return
		}
		c.term(it.Tags, 0, false)
	}
	if whole > 0 && whole != len(e.Items) {
		c.fail("$ with items other than $")
	}
}

// ---- Types (engine §10)

// termType is a term's type: a string, a set of strings, a tag set, a
// span, or a set whose kind nothing has given yet, such as ∅.
type termType int

const (
	tyString termType = iota
	tyStrings
	tyTags
	tySpan
	tySet
)

var typeNames = map[termType]string{tyString: "a string", tyStrings: "a set of strings", tyTags: "a tag set", tySpan: "a span", tySet: "a set"}

const spanNotValue = "a span is not a value: tags($x) is the tag set of $x"

func isSetType(t termType) bool { return t == tyStrings || t == tyTags || t == tySet }

// callType is the type of the value a function gives.
func callType(name string) termType {
	switch name {
	case "phonemes", "text", "lowercase":
		return tyString
	case "runs":
		return tyStrings
	case "tags", "classes":
		return tyTags
	}
	return tySpan
}

// joinedType is the kind of the sets that ∪, ∩, ∖, ⊆ or ⊈ join, or why
// they cannot be joined: each is a set, and all whose kind is known have
// one kind.
func joinedType(types []termType, op string) (termType, string) {
	for _, t := range types {
		if t == tySpan {
			return 0, spanNotValue
		}
	}
	for _, t := range types {
		if !isSetType(t) {
			return 0, fmt.Sprintf("%s joins sets, not %s", op, typeNames[t])
		}
	}
	kind := tySet
	for _, t := range types {
		if t == tySet {
			continue
		}
		if kind != tySet && kind != t {
			return 0, fmt.Sprintf("%s joins two sets of one kind, not a set of strings and a tag set", op)
		}
		kind = t
	}
	return kind, ""
}

// comparisonProblem is why a comparison's two sides do not fit its
// comparator, or "".
func comparisonProblem(op string, left, right termType) string {
	if left == tySpan || right == tySpan {
		return spanNotValue
	}
	switch op {
	case "∈", "∉":
		if left != tyString {
			return fmt.Sprintf("%s tests a string, not %s, in a set of strings; ⊆ and ⊈ compare two sets", op, typeNames[left])
		}
		if right != tyStrings && right != tySet {
			return fmt.Sprintf("%s tests a string in a set of strings, not in %s", op, typeNames[right])
		}
		return ""
	case "=", "≠":
		// Two values of one type.
		if left == tyString || right == tyString {
			if left == right {
				return ""
			}
			return fmt.Sprintf("%s compares two values of one type, not %s and %s", op, typeNames[left], typeNames[right])
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
// given.
func expectedProblem(t, expected termType) string {
	if t == expected || (t == tySet && expected == tyTags) {
		return ""
	}
	if t == tySpan {
		return spanNotValue
	}
	return fmt.Sprintf("%s is needed here, not %s", typeNames[expected], typeNames[t])
}

// typeOf is a term's type, or why its parts do not agree. The term's shape
// must already be checked.
func typeOf(t *domTerm) (termType, string) {
	switch t.Kind {
	case tmString:
		return tyString, ""
	case tmTag, tmRange:
		return tyTags, ""
	case tmEmptySet:
		return tySet, ""
	case tmCapture:
		return tySpan, ""
	case tmUnion, tmIntersection, tmDifference:
		op := map[string]string{tmUnion: "∪", tmIntersection: "∩", tmDifference: "∖"}[t.Kind]
		types := make([]termType, 0, len(t.Items))
		for _, it := range t.Items {
			ty, problem := typeOf(it)
			if problem != "" {
				return 0, problem
			}
			types = append(types, ty)
		}
		return joinedType(types, op)
	case tmIf:
		if problem := condTypeProblem(t.Cond); problem != "" {
			return 0, problem
		}
		ty, problem := typeOf(t.Items[0])
		if problem != "" {
			return 0, problem
		}
		if problem := expectedProblem(ty, tyTags); problem != "" {
			return 0, problem
		}
		return tyTags, ""
	case tmCall:
		for _, a := range t.Items {
			if a.Kind == tmRule {
				continue
			}
			ty, problem := typeOf(a)
			if problem != "" {
				return 0, problem
			}
			if t.Str == "lowercase" {
				if problem := expectedProblem(ty, tyString); problem != "" {
					return 0, "lowercase takes one string: " + problem
				}
			}
		}
		return callType(t.Str), ""
	}
	return 0, "a malformed term"
}

// condTypeProblem is why a condition's terms do not agree in type, or "".
func condTypeProblem(c *domCond) string {
	switch c.Kind {
	case cdAny, cdAll, cdIf:
		for _, it := range c.Items {
			if problem := condTypeProblem(it); problem != "" {
				return problem
			}
		}
	case cdNot:
		return condTypeProblem(c.Inner)
	case cdCompare:
		left, problem := typeOf(c.Left)
		if problem != "" {
			return problem
		}
		right, problem := typeOf(c.Right)
		if problem != "" {
			return problem
		}
		return comparisonProblem(c.Op, left, right)
	}
	return ""
}

// tagTermProblem is why a term that must be a tag set, a constituent's or
// an item's, is not one, or "".
func tagTermProblem(t *domTerm) string {
	ty, problem := typeOf(t)
	if problem != "" {
		return problem
	}
	return expectedProblem(ty, tyTags)
}

// ruleTypeProblem is why a rule's terms and conditions do not agree in
// type, or "".
func ruleTypeProblem(r *domRule) string {
	terms := []*domTerm{r.Tags}
	for _, a := range r.Alternatives {
		terms = append(terms, a.Tags)
	}
	if r.Emit != nil {
		for _, it := range r.Emit.Items {
			terms = append(terms, it.Tags)
		}
	}
	for _, t := range terms {
		if t == nil {
			continue
		}
		if problem := tagTermProblem(t); problem != "" {
			return problem
		}
	}
	for _, c := range r.Conditions {
		if problem := condTypeProblem(c); problem != "" {
			return problem
		}
	}
	return ""
}
