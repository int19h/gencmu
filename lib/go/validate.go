package gencmu

import (
	"fmt"
	"regexp"
	"strconv"
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

// checkDOM checks a DOM; uni is the loader's table, never nil: the
// lowercase mapping that the strings of sound tests are checked against,
// and the marks that decide a character tag's canonical spelling.
func checkDOM(d *domDoc, uni *unicodeTable) *domProblem {
	for _, dir := range d.Directives {
		if dir == nil || dir.Args == nil || !directiveOperandsOK(dir) {
			return &domProblem{message: "a malformed directive"}
		}
	}
	// The order of a document's items is the order of their positions, so
	// no two items share one (engine §9).
	positions := map[[2]int]bool{}
	for _, k := range d.Constants {
		if k == nil {
			return &domProblem{message: "a malformed constant"}
		}
		if positions[k.At] {
			return &domProblem{message: "two items at one position"}
		}
		positions[k.At] = true
	}
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
	for _, c := range d.Classifiers {
		if c == nil {
			return &domProblem{message: "a malformed classifier"}
		}
		if positions[c.At] {
			return &domProblem{message: "two items at one position"}
		}
		positions[c.At] = true
	}
	for _, m := range d.Implications {
		if m == nil {
			return &domProblem{message: "a malformed implication"}
		}
		if positions[m.At] {
			return &domProblem{message: "two items at one position"}
		}
		positions[m.At] = true
	}
	// A classifier: its name, and entries of gates, canonical keys, an
	// operator and a class (engine §2, §9).
	for _, c := range d.Classifiers {
		if !classifierName.MatchString(c.Name) || c.Entries == nil {
			return &domProblem{message: "a malformed classifier"}
		}
		for _, e := range c.Entries {
			if p := entryProblem(e, uni); p != "" {
				return &domProblem{message: fmt.Sprintf("classifier %s: %s", c.Name, p)}
			}
		}
	}
	for _, r := range d.Rules {
		if r == nil || !(domName.MatchString(r.Name) || r.Name == "#") || (r.Op != "define" && r.Op != "redefine" && r.Op != "extend") || len(r.Alternatives) == 0 {
			return &domProblem{message: "a malformed rule"}
		}
		c := &domChecker{rule: r, label: "rule " + r.Name, uni: uni}
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
			// form. Its feature is a name (§9).
			for _, g := range a.Guards {
				if g.Kind != FeatureGate && (g.Kind != FeatureWarning || g.Negated) {
					c.fail("a malformed guard")
				}
				if !domName.MatchString(g.Feature) {
					c.fail("a malformed guard: a guard's feature is a name")
				}
			}
			c.expr(a.Expr, 0, true, false)
			c.constituentTags(a.Tags)
		}
		if c.problem != nil {
			return c.problem
		}
		// A capture name stands at most once in each production (engine
		// §3.5).
		for _, a := range r.Alternatives {
			if twice := duplicateCaptures(a.Expr); len(twice) > 0 {
				return &domProblem{message: fmt.Sprintf("rule %s: a capture name used twice in one production", r.Name), rule: r}
			}
		}
		// The values of its tests, once the nesting is bounded (engine §9).
		for _, t := range c.tests {
			if f := testValueFault(t.Op, t.Value, uni); f != nil {
				return &domProblem{message: fmt.Sprintf("rule %s: %s", r.Name, f.problem), rule: r}
			}
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
	// A constant's definition: its name, its op, and a value that is a
	// closed term of a type that a constant can have (engine §2, §10).
	for _, k := range d.Constants {
		if !constName.MatchString(k.Name) || (k.Op != "define" && k.Op != "redefine") || k.Value == nil {
			return &domProblem{message: "a malformed constant", constant: k}
		}
		c := &domChecker{constant: k, label: "constant $" + k.Name, uni: uni}
		c.term(k.Value, 0, false)
		if c.problem != nil {
			return c.problem
		}
		// The walks below recurse, so they run only once the nesting is
		// bounded.
		if openPart(k.Value) != nil {
			return &domProblem{message: fmt.Sprintf("constant $%s: a constant's value is not a closed term", k.Name), constant: k}
		}
		if _, f := constantValueType(k.Value, k.Op == "redefine", nil); f != nil {
			return &domProblem{message: fmt.Sprintf("constant $%s: %s", k.Name, f.problem), constant: k}
		}
	}
	// An implication: two closed terms whose type is a tag set, checked
	// once the nesting is bounded (engine §2, §9).
	for _, m := range d.Implications {
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
		for _, side := range []*domTerm{m.If, m.Then} {
			if msg := implicationSideProblem(side, nil); msg != "" {
				return &domProblem{message: "an implication: " + msg, implication: m}
			}
		}
	}
	return nil
}

// classifierName is the syntax of a classifier's name, which begins with a
// lower-case letter, and className that of a class, which begins with a
// capital (engine §2, §9).
var (
	classifierName = regexp.MustCompile(`^[a-z][A-Za-z0-9-]*$`)
	className      = regexp.MustCompile(`^[A-Z][A-Za-z0-9-]*$`)
)

// entryProblem is what is wrong with an entry of a classifier (engine §9),
// or "": its guards are gates, it has one or more keys, each a canonical
// sound, its operator is ∈ or ∉, and its class a name with a capital.
func entryProblem(e *domEntry, uni *unicodeTable) string {
	if e == nil || e.Guards == nil || (e.Op != "∈" && e.Op != "∉") || !className.MatchString(e.Class) || len(e.Keys) == 0 {
		return "a malformed entry of a classifier"
	}
	for _, g := range e.Guards {
		if g.Kind != FeatureGate {
			return "a malformed entry of a classifier: an entry takes gates only, not a warning"
		}
		if !domName.MatchString(g.Feature) {
			return "a malformed entry of a classifier: a gate's feature is a name"
		}
	}
	for _, key := range e.Keys {
		if msg := soundProblem(key, uni); msg != "" {
			return "a malformed entry of a classifier: a key is a canonical sound: " + msg
		}
	}
	return ""
}

// implicationSideProblem is why a side of an implication is not a closed
// term whose type is a tag set, or "" (engine §2, §9, §10); ct gives each
// constant's type, where the loader knows it.
func implicationSideProblem(side *domTerm, ct constTypes) string {
	if openPart(side) != nil {
		return "a side of an implication is not a closed term"
	}
	if f := implicationSideFault(side, ct); f != nil {
		return f.problem
	}
	return ""
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

// directiveOperandsOK checks a directive's name, one of the notation's four
// directives, and the operands the notation's syntax allows the pipeline
// directives (engine §9): %stage one name, %include one string and
// %features one or more names. %elidable is no directive.
func directiveOperandsOK(dir *domDirective) bool {
	switch dir.Name {
	case "stage":
		return len(dir.Args) == 1 && domName.MatchString(dir.Args[0])
	case "include":
		return len(dir.Args) == 1
	case "features":
		if len(dir.Args) == 0 {
			return false
		}
		for _, a := range dir.Args {
			if !domName.MatchString(a) {
				return false
			}
		}
	case "ambiguity-resolution":
	default:
		return false
	}
	return true
}

type domChecker struct {
	rule        *domRule        // the rule checked, or nil
	constant    *domConst       // the constant checked, or nil
	implication *domImplication // the implication checked, or nil
	label       string          // what the problems name: rule r, constant $C or an implication
	uni         *unicodeTable
	tests       []*domExpr // the tested symbols seen, whose values are checked once the nesting is bounded
	problem     *domProblem
}

func (c *domChecker) fail(format string, args ...any) {
	if c.problem == nil {
		c.problem = &domProblem{message: c.label + ": " + fmt.Sprintf(format, args...), rule: c.rule, constant: c.constant, implication: c.implication}
	}
}

func (c *domChecker) deep(depth int) bool {
	if depth > maxDOMDepth {
		if c.problem == nil {
			c.problem = &domProblem{message: fmt.Sprintf("%s: an expression, term or condition is nested more than %d deep", c.label, maxDOMDepth), rule: c.rule, constant: c.constant, implication: c.implication, tooDeep: true}
		}
		return true
	}
	return c.problem != nil
}

// expr checks an expression. whole says it is the alternative's whole
// expression, the only place a chain may stand, and sealed that it lies
// inside braces or an elidable optional, where no capture stands (engine
// §3.5, §9).
func (c *domChecker) expr(e *domExpr, depth int, whole, sealed bool) {
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
			c.expr(it, depth+1, false, sealed)
		}
	case exOptional:
		// An elidable optional begins with its terminal (engine §3.8, §9).
		if e.Elidable && elidableHead(e.Inner) == nil {
			c.fail("a malformed elidable optional")
			return
		}
		c.expr(e.Inner, depth+1, false, sealed || e.Elidable)
	case exRepeat:
		// A chain is the whole expression of its alternative (engine §9).
		// A separator counts on from the depth of its repeat, as the item
		// does.
		if e.Chain != "" && !whole {
			c.fail("a chain that is not the whole expression of its alternative")
			return
		}
		c.expr(e.Inner, depth+1, false, true)
		if e.Sep != nil {
			c.expr(e.Sep, depth+1, false, true)
		}
	case exCapture:
		// A capture wraps one symbol, and stands anywhere but in braces or
		// an elidable optional; $, the whole constituent, wraps nothing.
		if sealed {
			c.fail("a capture inside braces or an elidable optional")
			return
		}
		if e.Name == "" {
			c.fail("$ wraps a symbol")
			return
		}
		if !captureName.MatchString(e.Name) {
			c.fail("a capture name is not all lower case")
			return
		}
		if e.Inner == nil || !isCapturable(e.Inner.Kind) {
			c.fail("a capture of something other than a reference, a terminal, a range, a property or a tested one of these")
			return
		}
		// A capture is a compound node: its symbol lies below it, and is
		// checked as any expression is.
		c.expr(e.Inner, depth+1, false, sealed)
	case exTest:
		// A compound node (engine §9) over one symbol; its value counts on
		// from its depth, and is checked once the nesting is bounded.
		if !testOps[e.Op] {
			c.fail("a malformed test")
			return
		}
		if !isTestable(e.Inner) {
			c.fail("a test follows only a reference other than # or a terminal")
			return
		}
		c.expr(e.Inner, depth+1, false, sealed)
		if e.Value == nil {
			c.fail("a missing value of a test")
			return
		}
		c.term(e.Value, depth+1, false)
		c.tests = append(c.tests, e)
	case exRef:
		// A reference is a name or # (engine §9).
		if e.Name != "#" && !domName.MatchString(e.Name) {
			c.fail("a reference to %q, which is not a name", e.Name)
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

// elidableHead is the terminal at the head of an elidable optional's
// expression, or nil when it has none (engine §3.8, §9): a reference whose
// name begins with a capital, a terminal whose tag is a name, or an = test
// of one of these, alone or first in a sequence.
func elidableHead(e *domExpr) *domExpr {
	if e == nil {
		return nil
	}
	head := e
	if e.Kind == exSeq && len(e.Items) > 0 {
		head = e.Items[0]
	}
	if head == nil {
		return nil
	}
	isTerminal := func(n *domExpr) bool {
		return n != nil && ((n.Kind == exRef && constName.MatchString(n.Name)) || (n.Kind == exTerminal && domName.MatchString(n.Name)))
	}
	if isTerminal(head) || (head.Kind == exTest && head.Op == "=" && isTerminal(head.Inner)) {
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
		case n.Kind == exSeq || n.Kind == exAnd || n.Kind == exChoice:
			return n.Items
		case n.Kind == exOptional && !n.Elidable:
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

// captureSequences lists the distinct sequences of captures that the
// productions of an expression read, each in the order read (engine §3.2,
// §3.5): a choice gives each branch's, an & each subsequence's, a plain
// optional none or its content's, and braces and an elidable optional
// none. Productions that read the same names in the same order are one
// sequence. duplicates are the captures that some production reads after
// one of the same name. Gates do not matter, since they drop whole
// alternatives.
func captureSequences(e *domExpr) (sequences [][]*domExpr, duplicates map[*domExpr]bool) {
	duplicates = map[*domExpr]bool{}
	// Each capture that the work below looks at, compares, copies or
	// writes into a key counts before it does.
	w := work.Load()
	step := func() {
		if w != nil {
			w.readerSteps.add("reader steps")
		}
	}
	distinct := func(lists [][]*domExpr) [][]*domExpr {
		seen := map[string]bool{}
		var out [][]*domExpr
		for _, list := range lists {
			var key strings.Builder
			for _, c := range list {
				step()
				key.WriteString(c.Name)
				key.WriteByte(' ')
			}
			if seen[key.String()] {
				continue
			}
			seen[key.String()] = true
			out = append(out, list)
		}
		return out
	}
	product := func(left, right [][]*domExpr) [][]*domExpr {
		var out [][]*domExpr
		for _, a := range left {
			for _, b := range right {
				for _, c := range b {
					for _, other := range a {
						step()
						if other.Name == c.Name {
							duplicates[c] = true
							break
						}
					}
				}
				for range len(a) + len(b) {
					step()
				}
				joined := make([]*domExpr, 0, len(a)+len(b))
				out = append(out, append(append(joined, a...), b...))
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
		case n.Kind == exSeq || n.Kind == exAnd || n.Kind == exChoice:
			return n.Items
		case n.Kind == exOptional && !n.Elidable:
			return []*domExpr{n.Inner}
		}
		return nil
	}
	type frame struct {
		n       *domExpr
		combine bool
	}
	stack := []frame{{n: e}}
	var done [][][]*domExpr
	for len(stack) > 0 {
		step()
		top := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		n := top.n
		if !top.combine {
			if n != nil && n.Kind == exCapture {
				done = append(done, [][]*domExpr{{n}})
				continue
			}
			items := kids(n)
			if len(items) == 0 {
				done = append(done, [][]*domExpr{nil})
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
		var out [][]*domExpr
		switch n.Kind {
		case exSeq:
			// While the sequence has one way to read its captures, each
			// part with one way extends it in place, and names holds the
			// names read so far. A product would copy the prefix at each
			// part, so C captures would cost C squared.
			out = [][]*domExpr{nil}
			var names map[string]bool
			for _, part := range parts {
				if len(out) != 1 || len(part) != 1 {
					names = nil
					out = product(out, part)
					continue
				}
				if names == nil {
					names = map[string]bool{}
					for _, c := range out[0] {
						step()
						names[c.Name] = true
					}
				}
				// Each capture of the part counts once as it is looked up
				// and recorded, and once more as it is copied.
				for _, c := range part[0] {
					step()
					if names[c.Name] {
						duplicates[c] = true
					}
				}
				for _, c := range part[0] {
					names[c.Name] = true
				}
				out[0] = appendCounted(out[0], part[0], readerCount(), "reader steps")
			}
		case exChoice:
			for _, part := range parts {
				for range part {
					step()
				}
				out = append(out, part...)
			}
			out = distinct(out)
		case exAnd:
			for mask := 1; mask < 1<<len(parts); mask++ {
				seqs := [][]*domExpr{nil}
				for i, part := range parts {
					if mask&(1<<i) != 0 {
						seqs = product(seqs, part)
					}
				}
				out = append(out, seqs...)
			}
			out = distinct(out)
		default:
			out = distinct(append([][]*domExpr{nil}, parts[0]...))
		}
		done = append(done, out)
	}
	return done[0], duplicates
}

// isCapturable says whether a capture can wrap an expression of a kind: a
// reference, a terminal, a range, a property or a tested symbol (engine §9).
func isCapturable(kind string) bool {
	switch kind {
	case exRef, exTerminal, exRange, exProperty, exTest:
		return true
	}
	return false
}

// isTestable says whether an expression can carry a test (engine §2): a
// reference other than #, a terminal, a range or a property.
func isTestable(e *domExpr) bool {
	if e == nil {
		return false
	}
	switch e.Kind {
	case exRef:
		return e.Name != "#"
	case exTerminal, exRange, exProperty:
		return true
	}
	return false
}

// rangeProblem is what is wrong with a range (engine §1, §9), or "": its
// ends must be two character tags in their canonical spelling by the
// table, which says which code points are marks, the start not above the
// end.
func rangeProblem(r [2]string, uni *unicodeTable) string {
	var codes [2]rune
	for i, end := range r {
		c, ok := characterOfTag(end, uni.isMark)
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

// soundProblem is what is wrong with the string of a sound test (engine
// §9), or "": one that no canonical sound can be, with a comma or a code
// point that the lowercase mapping would change. Without a table, the
// lowercase mapping is not checked.
func soundProblem(sound string, uni *unicodeTable) string {
	if strings.Contains(sound, ",") {
		return fmt.Sprintf("the string %s holds a comma, which no canonical sound holds", strconv.Quote(sound))
	}
	if uni != nil && uni.lowercase(sound) != sound {
		return fmt.Sprintf("the string %s is not in lower case, which every canonical sound is", strconv.Quote(sound))
	}
	return ""
}

// testValueFault is what is wrong with a test's value (engine §9), or nil:
// it must be a closed term, of type string for a sound test and tag set for
// a tag test, and a string literal of a sound test must be a canonical
// sound. The shape of the value must already be checked, and its nesting
// bounded.
func testValueFault(op string, value *domTerm, uni *unicodeTable) *typeFault {
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
	if isSoundTest(op) && value.Kind == tmString {
		if problem := soundProblem(value.Str, uni); problem != "" {
			return &typeFault{problem, value}
		}
	}
	return nil
}

// testTypeProblem is why a value of a type cannot be the value of a test,
// or "": a sound test's is a string, and a tag test's a tag set.
func testTypeProblem(op string, ty termType) string {
	expected, name := tyTags, "a tag set"
	if isSoundTest(op) {
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

// literalCallProblem is what is wrong with a call of split or tag whose
// argument the reader sees as a string literal (engine §9, §10), or "": an
// empty delimiter, or a tag's string that is not a name.
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
	if s, ok := literal(0); call == "tag" && ok && !isName(s) {
		return fmt.Sprintf("tag(%s): the string is not a name", strconv.Quote(s))
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
	case tmConst:
		if !constName.MatchString(t.Str) {
			c.fail("a malformed constant $%s", t.Str)
		}
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
		isClassifier := func(a *domTerm) bool {
			return a != nil && a.Kind == tmClassifier && classifierName.MatchString(a.Str)
		}
		var ok bool
		switch t.Str {
		case "phonemes", "text", "classes", "head", "tail", "last", "from", "after":
			ok = len(args) == 1 && isSpanShape(args[0])
		case "tags":
			ok = (len(args) == 1 && isSpanShape(args[0])) || (len(args) == 2 && isSpanShape(args[0]) && isRule(args[1]))
		case "split", "tag":
			// Its arguments are values, whose types are checked with the
			// rule's (engine §10).
			ok = len(args) == map[string]int{"split": 2, "tag": 1}[t.Str]
			for _, a := range args {
				ok = ok && a != nil && !isRule(a) && !isClassifier(a) && !isSpanShape(a)
			}
		case "classify":
			// A string, and the name of a classifier (engine §9).
			ok = len(args) == 2 && args[0] != nil && !isRule(args[0]) && !isClassifier(args[0]) && !isSpanShape(args[0]) && isClassifier(args[1])
		}
		if !ok || (!argument && isSpanFunction(t.Str)) {
			c.fail("a malformed call of %q", t.Str)
			return
		}
		if msg := literalCallProblem(t.Str, args); msg != "" {
			c.fail("%s", msg)
			return
		}
		for _, a := range args {
			if isRule(a) || isClassifier(a) {
				c.deep(depth + 1) // a rule's or a classifier's name is a node below the call
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
			// matches() and begins() parse the tokens again, initial()
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
			if p.t.Str == "" {
				return true
			}
		case tmIf, tmUnion, tmIntersection, tmDifference:
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

// emission: $ only with $; a capture other than $ listed once, as an item
// or as an attachment; attachments only on a named capture; no tags on an
// inserted tag; no ∅ as an item's tags. No items is ε.
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
			// A capture stands once in an emission, as an item or as an
			// attachment, and an attachment is a named capture (engine §9).
			for _, name := range it.attachments() {
				if !captureName.MatchString(name) {
					c.fail("a malformed attachment %q", name)
					return
				}
			}
			for _, name := range it.captures() {
				if listed[name] {
					c.fail("$%s is listed twice in an emission", name)
					return
				}
				listed[name] = true
			}
		}
		// Only a named capture carries attachments (engine §9).
		if (it.IsInsert || it.Capture == "") && len(it.Before)+len(it.After) > 0 {
			c.fail("attachments on an item that is not a named capture")
			return
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
)

var typeNames = map[termType]string{tyString: "a string", tyStrings: "a set of strings", tyTags: "a tag set", tySpan: "a span", tySet: "a set", tyAny: "a value"}

const spanNotValue = "a span is not a value: tags($x) is the tag set of $x"

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

// callStrings says what the functions that take strings take.
var callStrings = map[string]string{"split": "two strings", "tag": "one string", "classify": "a string and a classifier's name"}

// callType is the type of the value a function gives.
func callType(name string) termType {
	switch name {
	case "phonemes", "text":
		return tyString
	case "split":
		return tyStrings
	case "tags", "classes", "tag", "classify":
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
		if t != tyAny && !isSetType(t) {
			return 0, fmt.Sprintf("%s joins sets, not %s", op, typeNames[t])
		}
	}
	kind, unknown := tySet, false
	for _, t := range types {
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
	if left == tySpan || right == tySpan {
		return spanNotValue
	}
	switch op {
	case "∈", "∉":
		if left != tyString && left != tyAny {
			return fmt.Sprintf("%s tests a string, not %s, in a set of strings; ⊆ and ⊈ compare two sets", op, typeNames[left])
		}
		if right != tyStrings && right != tySet && right != tyAny {
			return fmt.Sprintf("%s tests a string in a set of strings, not in %s", op, typeNames[right])
		}
		return ""
	case "=", "≠":
		// Two values of one type.
		if left == tyAny || right == tyAny {
			return ""
		}
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
// given, and a constant of unknown type fits.
func expectedProblem(t, expected termType) string {
	if t == expected || t == tyAny || (t == tySet && expected == tyTags) {
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
	case tmString:
		return tyString, nil
	case tmTag, tmRange:
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
		if problem := expectedProblem(ty, tyTags); problem != "" {
			return 0, &typeFault{problem, t}
		}
		return tyTags, nil
	case tmCall:
		for _, a := range t.Items {
			if a.Kind == tmRule || a.Kind == tmClassifier {
				continue
			}
			ty, f := termTypeMemo(a, ct, memo)
			if f != nil {
				return 0, f
			}
			if t.Str == "split" || t.Str == "tag" || t.Str == "classify" {
				if problem := expectedProblem(ty, tyString); problem != "" {
					return 0, &typeFault{t.Str + " takes " + callStrings[t.Str] + ": " + problem, t}
				}
			}
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
		if problem := comparisonProblem(c.Op, left, right); problem != "" {
			return &typeFault{problem, c}
		}
	}
	return nil
}

// tagTermProblem is why a term that must be a tag set, a constituent's or
// an item's, is not one, or "".
func tagTermProblem(t *domTerm) string {
	if f := tagTermFault(t, nil); f != nil {
		return f.problem
	}
	return ""
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

// ruleTypeProblem is why a rule's terms and conditions do not agree in
// type, or "".
func ruleTypeProblem(r *domRule) string {
	if f := ruleTypeFault(r, nil); f != nil {
		return f.problem
	}
	return ""
}

// ruleTypeFault is why a rule's terms and conditions do not agree in type,
// with the construct at fault, or nil.
func ruleTypeFault(r *domRule, ct constTypes) *typeFault {
	for _, t := range ruleTagTerms(r) {
		if f := tagTermFault(t, ct); f != nil {
			return f
		}
	}
	for _, c := range r.Conditions {
		if f := condTypeFault(c, ct); f != nil {
			return f
		}
	}
	// A test's value is a string for a sound test and a tag set for a tag
	// test (engine §9, §10).
	for _, a := range r.Alternatives {
		for _, t := range testsIn(a.Expr) {
			ty, f := termTypeIn(t.Value, ct)
			if f != nil {
				return f
			}
			if problem := testTypeProblem(t.Op, ty); problem != "" {
				return &typeFault{problem, t.Value}
			}
		}
	}
	return nil
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
var constName = regexp.MustCompile(`^[A-Z][A-Za-z0-9-]*$`)

// openPart is the first part of a term that is not closed (engine §10), or
// nil: a capture, a guarded term, or a call of anything but split and tag.
func openPart(t *domTerm) *domTerm {
	if t == nil {
		return nil
	}
	switch t.Kind {
	case tmCapture, tmIf:
		return t
	case tmCall:
		if t.Str != "split" && t.Str != "tag" {
			return t
		}
	case tmUnion, tmIntersection, tmDifference:
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
	collect := func(start clausePart) {
		walkClause(start, func(p clausePart) bool {
			if p.t != nil && p.t.Kind == tmConst {
				found = append(found, p.t)
				return false
			}
			return true
		})
	}
	term := func(t *domTerm) {
		if t != nil {
			collect(clausePart{t: t})
		}
	}
	cond := func(c *domCond) {
		if c != nil {
			collect(clausePart{c: c})
		}
	}
	for _, n := range nodes {
		switch x := n.(type) {
		case *domTerm:
			term(x)
		case *domCond:
			cond(x)
		case []*domCond:
			for _, c := range x {
				cond(c)
			}
		case *domRule:
			// In the order the DOM writes them: the rule's tags, each
			// alternative's tests and tags, the emission and the
			// conditions.
			term(x.Tags)
			for _, a := range x.Alternatives {
				for _, t := range testsIn(a.Expr) {
					term(t.Value)
				}
				term(a.Tags)
			}
			if x.Emit != nil {
				for _, it := range x.Emit.Items {
					term(it.Tags)
				}
			}
			for _, c := range x.Conditions {
				cond(c)
			}
		}
	}
	return found
}
