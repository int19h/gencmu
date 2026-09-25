package gencmu

import (
	"fmt"
	"regexp"
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

// domProblem is why a DOM is malformed; tooDeep marks the nesting limit,
// the one problem a DOM the reader built can have.
type domProblem struct {
	message string
	rule    *domRule
	tooDeep bool
}

func (p *domProblem) Error() string { return p.message }

func validateDOM(d *domDoc) error {
	if p := checkDOM(d); p != nil {
		return p
	}
	return nil
}

func checkDOM(d *domDoc) *domProblem {
	for _, dir := range d.Directives {
		if dir == nil || dir.Args == nil {
			return &domProblem{message: "a malformed directive"}
		}
	}
	for _, r := range d.Rules {
		if r == nil || !(domName.MatchString(r.Name) || r.Name == "#") || (r.Op != "define" && r.Op != "redefine" && r.Op != "extend") || len(r.Alternatives) == 0 {
			return &domProblem{message: "a malformed rule"}
		}
		c := &domChecker{rule: r}
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
		// The definition as a whole (engine §9, the end).
		if msg := definitionProblem(r); msg != "" {
			return &domProblem{message: msg, rule: r}
		}
	}
	return nil
}

type domChecker struct {
	rule     *domRule
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
		if e.Inner == nil || (e.Inner.Kind != exRef && e.Inner.Kind != exTerminal) || (e.Inner.Kind == exRef && e.Inner.Name == "") {
			c.fail("a capture of something other than a reference or a terminal")
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
		c.deep(depth + 1)
	case exRef:
		if e.Name == "" {
			c.fail("an empty ref")
		}
	case exTerminal:
		// Any string, "" included: the reader decodes "" to one.
	case exEmpty:
	default:
		c.fail("an unknown expression %q", e.Kind)
	}
}

// isSpanShape: a capture, or head, tail or last of a span.
func isSpanShape(t *domTerm) bool {
	return t != nil && (t.Kind == tmCapture ||
		(t.Kind == tmCall && (t.Str == "head" || t.Str == "tail" || t.Str == "last")))
}

// term checks a term; argument says it is a function's argument, where a
// span may stand. A nil term is an absent, optional one.
func (c *domChecker) term(t *domTerm, depth int, argument bool) {
	if t == nil || c.deep(depth) {
		return
	}
	switch t.Kind {
	case tmLiteral, tmWeak, tmCapture, tmEmptySet:
	case tmUnion, tmIntersection:
		if len(t.Items) < 2 {
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
		// head, tail and last only where a span may stand, and matches and
		// initial never as terms.
		args := t.Items
		isRule := func(a *domTerm) bool { return a != nil && a.Kind == tmRule && a.Str != "" }
		var ok bool
		switch t.Str {
		case "phonemes", "text", "words", "classes", "head", "tail", "last":
			ok = len(args) == 1 && isSpanShape(args[0])
		case "tags":
			ok = (len(args) == 1 && isSpanShape(args[0])) || (len(args) == 2 && isSpanShape(args[0]) && isRule(args[1]))
		case "lowercase":
			ok = len(args) == 1 && isStringTerm(args[0])
		}
		if !ok || (!argument && (t.Str == "head" || t.Str == "tail" || t.Str == "last")) {
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
		case "=", "≠", "∈", "∉", "⊆":
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
	case cdMatches:
		if !isSpanShape(d.Span) || d.Rule == "" {
			c.fail("a malformed matches()")
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
	case tmUnion, tmIntersection:
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

// condReadsOwnTags is readsOwnTags of a guard's condition: matches() parses
// the tokens again, initial() reads where they begin, and a presence test
// reads no tags.
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
