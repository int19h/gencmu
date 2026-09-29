package gencmu

import (
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// notationReader reads grammar documents with the notation dialect, whose
// DOM is the bootstrap (engine §8), and turns the tree into the document's
// DOM (engine §9).
type notationReader struct {
	uni     *unicodeTable
	stages  []*stageGrammar
	lowered []*lowered
	hash    string
}

func newNotationReader(bootstrap string, uni *unicodeTable) (*notationReader, error) {
	var b struct {
		Format int
		// A stage's name and a document's path are strings: null and
		// absent are refused, as the other libraries refuse them.
		Stages []struct {
			Name      *string
			Documents []struct {
				Path *string
				Dom  json.RawMessage
			}
		}
	}
	if err := json.Unmarshal([]byte(bootstrap), &b); err != nil {
		return nil, &Error{Kind: ErrorGrammar, Document: "notation/bootstrap.json", Message: "cannot read the bootstrap: " + err.Error()}
	}
	if b.Format != domFormat {
		return nil, &Error{Kind: ErrorGrammar, Document: "notation/bootstrap.json", Message: "the bootstrap has an unknown format"}
	}
	nr := &notationReader{uni: uni, hash: fnv1a64(bootstrap)}
	for _, s := range b.Stages {
		if s.Name == nil {
			return nil, &Error{Kind: ErrorGrammar, Document: "notation/bootstrap.json", Message: "a stage of the bootstrap has no name"}
		}
		var docs []docDOM
		for _, d := range s.Documents {
			if d.Path == nil {
				return nil, &Error{Kind: ErrorGrammar, Document: "notation/bootstrap.json", Message: "a document of the bootstrap has no path"}
			}
			dom, err := decodeDOM(d.Dom, uni)
			if err != nil {
				return nil, &Error{Kind: ErrorGrammar, Document: "notation/bootstrap.json", Message: "cannot read the bootstrap's DOM of " + *d.Path + ": " + err.Error()}
			}
			docs = append(docs, docDOM{path: *d.Path, dom: dom})
		}
		g, gerr := stitch(*s.Name, docs, uni)
		if gerr != nil {
			return nil, gerr
		}
		l := lower(g, nil, false)
		if l.fault != "" {
			return nil, &Error{Kind: ErrorGrammar, Document: "notation/bootstrap.json", Stage: *s.Name, Message: l.fault}
		}
		nr.stages = append(nr.stages, g)
		nr.lowered = append(nr.lowered, l)
	}
	if len(nr.stages) == 0 {
		return nil, &Error{Kind: ErrorGrammar, Document: "notation/bootstrap.json", Message: "the bootstrap has no stages"}
	}
	return nr, nil
}

// read reads one grammar document into its DOM.
func (nr *notationReader) read(text, docPath string) (dom *domDoc, err *Error) {
	gt := extractGrammarText(text)
	if gt.unclosed != nil {
		return nil, grammarError(docPath, *gt.unclosed, "a jbogenbau block is never closed")
	}
	ps := newParseState(nr.uni, gt.text)
	toks := ps.characterTokens()
	var out stageOutcome
	for i, g := range nr.stages {
		run := ps.newRun(g.name, g, toks)
		out = run.run(nr.lowered[i], nil, false)
		if out.err != nil {
			e := &Error{Kind: ErrorGrammar, Document: docPath, Message: "the document does not parse as the notation"}
			if out.err.Source != nil {
				at := gt.at(out.err.Source[0])
				e.Line, e.Column = at[0], at[1]
			}
			if out.err.Kind == ErrorRejected {
				e.Message = "the notation does not allow what stands here"
				if out.err.Token != nil && *out.err.Token < len(toks) {
					e.Message = fmt.Sprintf("the notation does not allow %q here", toks[*out.err.Token].Text)
				}
			} else {
				e.Message = out.err.Message
			}
			return nil, e
		}
		if i < len(nr.stages)-1 {
			toks = out.stage.Output
		}
	}
	b := &domBuilder{toks: toks, gt: gt, doc: docPath, uni: nr.uni}
	defer func() {
		if x := recover(); x != nil {
			if e, ok := x.(*Error); ok {
				dom, err = nil, e
				return
			}
			panic(x)
		}
	}()
	dom = b.document(out.tree)
	// What the notation's grammar cannot state and the walk does not see:
	// nesting deeper than 256 (§9), reported at the first item, a rule, a
	// constant's definition or an implication, that nests too deeply, in
	// the order of the document.
	if p := checkDOM(dom, nr.uni); p != nil {
		if p.tooDeep {
			p = firstTooDeep(dom, nr.uni, p)
		}
		e := &Error{Kind: ErrorGrammar, Document: docPath, Message: p.message}
		if p.rule != nil {
			e.Line, e.Column = p.rule.At[0], p.rule.At[1]
		} else if p.constant != nil {
			e.Line, e.Column = p.constant.At[0], p.constant.At[1]
		} else if p.implication != nil {
			e.Line, e.Column = p.implication.At[0], p.implication.At[1]
		}
		return nil, e
	}
	return dom, nil
}

// firstTooDeep is the nesting problem of the first item of a document, in
// the order of its positions, that nests too deeply alone; found, when no
// item does alone.
func firstTooDeep(dom *domDoc, uni *unicodeTable, found *domProblem) *domProblem {
	type item struct {
		at    [2]int
		alone *domDoc
	}
	var items []item
	for _, r := range dom.Rules {
		items = append(items, item{r.At, &domDoc{Rules: []*domRule{r}}})
	}
	for _, k := range dom.Constants {
		items = append(items, item{k.At, &domDoc{Constants: []*domConst{k}}})
	}
	for _, m := range dom.Implications {
		items = append(items, item{m.At, &domDoc{Implications: []*domImplication{m}}})
	}
	sort.SliceStable(items, func(i, j int) bool {
		a, b := items[i].at, items[j].at
		return a[0] < b[0] || (a[0] == b[0] && a[1] < b[1])
	})
	for _, it := range items {
		if p := checkDOM(it.alone, uni); p != nil && p.tooDeep {
			return p
		}
	}
	return found
}

type domBuilder struct {
	captures map[string]bool // the captures of the alternative being read
	inner    int             // how deep inside [ ], ( ), ..., & or a choice the reader is
	toks     []Token
	gt       *grammarText
	doc      string
	uni      *unicodeTable // the lowercase mapping the strings of sound tests are checked against
	// closedFor is what the reader is reading as a closed term, a
	// constant's value or a test's operand, or "" (§9, §10).
	closedFor string
}

// The rules the reader looks at by name; every other rule is transparent.
var domRules = map[string]bool{
	"directive": true, "rule": true, "definer": true, "alternative": true, "choice": true,
	"conjunction": true, "sequence": true, "element": true, "reference": true,
	"string": true, "tag": true, "character": true, "phoneme": true, "name": true,
	"tested": true, "test": true, "test-operand": true, "capture": true, "group": true, "optional": true,
	"empty": true, "tags-clause": true, "conditions-clause": true, "emits-clause": true,
	"foreign-clause": true, "emit-item": true, "emit-tags": true, "implication": true,
	"any-of": true, "all-of": true, "comparison": true, "negation": true,
	"presence": true, "call": true, "term": true, "guarded-term": true, "union": true,
	"intersection": true, "empty-set": true, "capture-reference": true,
	"alternative-tags": true, "argument-word": true, "argument-string": true, "argument-tag": true, "guard": true,
	"comparator": true, "range": true, "property": true,
	"constant-definition": true, "constant-definer": true, "constant-reference": true,
	"classifier": true, "classifier-name": true, "classifier-entry": true, "classifier-key": true,
	"classifier-operator": true, "classifier-class": true, "implication-declaration": true,
}

func (b *domBuilder) at(n *Node) [2]int {
	for n.Kind == KindRule {
		if len(n.Children) == 0 {
			return b.gt.at(n.Source[0])
		}
		n = n.Children[0]
	}
	return b.gt.at(b.toks[n.Token].Source[0])
}

func (b *domBuilder) fail(n *Node, format string, args ...any) {
	panic(grammarError(b.doc, b.at(n), format, args...))
}

// parts lists a node's children, reading transparent rules in their place.
func parts(n *Node) []*Node {
	var out []*Node
	stack := make([]*Node, 0, len(n.Children))
	for i := len(n.Children) - 1; i >= 0; i-- {
		stack = append(stack, n.Children[i])
	}
	for len(stack) > 0 {
		c := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if c.Kind == KindRule && !domRules[c.Rule] {
			for i := len(c.Children) - 1; i >= 0; i-- {
				stack = append(stack, c.Children[i])
			}
			continue
		}
		out = append(out, c)
	}
	return out
}

func ruleParts(n *Node) []*Node {
	var out []*Node
	for _, c := range parts(n) {
		if c.Kind == KindRule {
			out = append(out, c)
		}
	}
	return out
}

func (b *domBuilder) text(n *Node) string {
	if n.Kind == KindToken {
		return b.toks[n.Token].Text
	}
	for _, c := range parts(n) {
		if c.Kind == KindToken {
			return b.toks[c.Token].Text
		}
	}
	return ""
}

func (b *domBuilder) document(root *Node) *domDoc {
	d := &domDoc{Rules: []*domRule{}, Directives: []*domDirective{}, Constants: []*domConst{}, Classifiers: []*domClassifier{}, Implications: []*domImplication{}}
	for _, c := range ruleParts(root) {
		switch c.Rule {
		case "rule":
			d.Rules = append(d.Rules, b.rule(c))
		case "constant-definition":
			d.Constants = append(d.Constants, b.constant(c))
		case "classifier":
			d.Classifiers = append(d.Classifiers, b.classifier(c))
		case "implication-declaration":
			d.Implications = append(d.Implications, b.implicationDeclaration(c))
		case "directive":
			ps := parts(c)
			dir := &domDirective{Name: strings.TrimPrefix(b.text(ps[0]), "%"), Args: []string{}, At: b.at(ps[0])}
			var kinds []string
			for _, p := range ps {
				if p.Kind != KindRule {
					continue
				}
				switch p.Rule {
				case "argument-word":
					dir.Args = append(dir.Args, b.text(p))
					if isCapital(b.text(p)) {
						kinds = append(kinds, operandClass)
					} else {
						kinds = append(kinds, operandName)
					}
				case "argument-string":
					// A string operand is decoded, as a string of a rule is.
					dir.Args = append(dir.Args, b.decode(parts(p)[0]))
					kinds = append(kinds, operandString)
				case "argument-tag":
					// A tag literal is its name; a phoneme or character tag,
					// a range or a property is refused below.
					t := parts(p)[0]
					if t.Kind == KindRule {
						// A range or a property, which has no tag.
						dir.Args = append(dir.Args, b.text(t))
						kinds = append(kinds, t.Rule)
						continue
					}
					dir.Args = append(dir.Args, b.tagOf(t))
					switch b.text(t)[0] {
					case '~':
						kinds = append(kinds, operandTag)
					case '/':
						kinds = append(kinds, operandPhoneme)
					default:
						kinds = append(kinds, operandCharacter)
					}
				}
			}
			if problem := operandProblem(dir.Name, kinds); problem != "" {
				b.fail(ps[0], "%s", problem)
			}
			d.Directives = append(d.Directives, dir)
		}
	}
	return d
}

// constant reads a constant's definition: its name without $, and its
// value, a closed term of a type that a constant can have (engine §2, §9,
// §10).
func (b *domBuilder) constant(n *Node) *domConst {
	ps := ruleParts(n)
	k := &domConst{Name: strings.TrimPrefix(b.text(ps[1]), "$"), Op: "define", At: b.at(n)}
	if b.text(ps[0]) == "%redefine-const" {
		k.Op = "redefine"
	}
	b.closedFor = "a constant's value"
	k.Value = b.value(ps[2])
	b.closedFor = ""
	if _, f := constantValueType(k.Value, k.Op == "redefine", nil); f != nil {
		b.fail(ps[2], "%s", f.problem)
	}
	return k
}

// classifier reads a %classifier item: its name, which begins with a
// lower-case letter, and its entries (engine §2, §9).
func (b *domBuilder) classifier(n *Node) *domClassifier {
	c := &domClassifier{Entries: []*domEntry{}, At: b.at(n)}
	for _, p := range ruleParts(n) {
		switch p.Rule {
		case "classifier-name":
			c.Name = b.text(p)
			if !classifierName.MatchString(c.Name) {
				b.fail(p, "%s begins with a capital, so it is a tag; a classifier's name begins with a lower-case letter", c.Name)
			}
		case "classifier-entry":
			c.Entries = append(c.Entries, b.entry(p))
		}
	}
	return c
}

// entry reads an entry of a classifier: gates, canonical keys, ∈ or ∉, and
// a class (engine §2, §9).
func (b *domBuilder) entry(n *Node) *domEntry {
	e := &domEntry{Guards: []domGuard{}, At: b.at(n)}
	for _, p := range ruleParts(n) {
		switch p.Rule {
		case "guard":
			g := b.text(p)
			if strings.HasSuffix(g, "!") {
				b.fail(p, "an entry of a classifier takes gates only, not a warning")
			}
			neg := strings.HasPrefix(g, "¬")
			e.Guards = append(e.Guards, domGuard{Feature: strings.TrimSuffix(strings.TrimPrefix(g, "¬"), "?"), Kind: FeatureGate, Negated: neg})
		case "classifier-key":
			key := b.decode(parts(p)[0])
			if msg := soundProblem(key, b.uni); msg != "" {
				b.fail(p, "a key is a canonical sound: %s", msg)
			}
			e.Keys = append(e.Keys, key)
		case "classifier-operator":
			e.Op = b.text(p)
		case "classifier-class":
			written := b.text(p)
			e.Class = strings.TrimPrefix(written, "~")
			if !isCapital(e.Class) {
				b.fail(p, "%s is not a class: a class is an identifier tag that begins with a capital", written)
			}
		}
	}
	return e
}

// implicationDeclaration reads %implies A ⟹ B: two closed terms whose type
// is a tag set (engine §2, §9).
func (b *domBuilder) implicationDeclaration(n *Node) *domImplication {
	m := &domImplication{At: b.at(n)}
	var sides []*domTerm
	for _, p := range ruleParts(n) {
		if p.Rule != "union" {
			continue
		}
		b.closedFor = "a side of an implication"
		t := b.term(p)
		b.closedFor = ""
		if f := implicationSideFault(t, nil); f != nil {
			b.fail(p, "%s", f.problem)
		}
		sides = append(sides, t)
	}
	m.If, m.Then = sides[0], sides[1]
	return m
}

// constantInBody is the error of a constant that stands in a body (§9).
const constantInBody = "a constant cannot stand in a body: a body names a class of tokens with a rule, such as %rule digit '0'..'9'"

func (b *domBuilder) rule(n *Node) *domRule {
	// The definer, the name, the alternatives and the clauses; the syntax
	// allows at most one of each clause, in order.
	ps := parts(n)
	r := &domRule{Name: b.text(ps[1]), At: b.at(ps[0]), Conditions: []*domCond{}}
	switch b.text(ps[0]) {
	case "%redefine-rule":
		r.Op = "redefine"
	case "%extend-rule":
		r.Op = "extend"
	default:
		r.Op = "define"
	}
	for _, p := range ps[2:] {
		if p.Kind != KindRule {
			continue
		}
		switch p.Rule {
		case "alternative":
			r.Alternatives = append(r.Alternatives, b.alternative(p))
		case "tags-clause":
			r.Tags = b.constituentTags(p)
		case "conditions-clause":
			// Each item of the list is one condition (§9).
			for _, c := range ruleParts(p) {
				r.Conditions = append(r.Conditions, b.implication(c))
			}
		case "emits-clause":
			r.Emit = b.emission(p)
		case "foreign-clause":
			r.Foreign = true
		}
	}
	// The definition as a whole (§9), reported at the rule.
	if msg := definitionProblem(r); msg != "" {
		b.fail(ps[0], "%s", msg)
	}
	return r
}

func (b *domBuilder) alternative(n *Node) *domAlt {
	a := &domAlt{Guards: []domGuard{}}
	b.captures = map[string]bool{}
	for _, p := range ruleParts(n) {
		switch p.Rule {
		case "guard":
			// A guard's token is its spelling: f? or ¬f? for a gate, f! for
			// a warning (§9).
			g := b.text(p)
			kind := FeatureGate
			if strings.HasSuffix(g, "!") {
				kind = FeatureWarning
			}
			neg := strings.HasPrefix(g, "¬")
			name := strings.TrimSuffix(strings.TrimSuffix(strings.TrimPrefix(g, "¬"), "?"), "!")
			a.Guards = append(a.Guards, domGuard{Feature: name, Kind: kind, Negated: neg})
		case "alternative-tags":
			a.Tags = b.constituentTags(p)
		default:
			a.Expr = b.expr(p)
		}
	}
	return a
}

// constituentTags reads a rule's or an alternative's tag term, which cannot
// be made of the tags it defines: tags($) or classes($) (§9).
func (b *domBuilder) constituentTags(n *Node) *domTerm {
	t := b.tagTerm(ruleParts(n)[0])
	if readsOwnTags(t) {
		b.fail(n, "a constituent's tags cannot be made of its own tags, tags($) or classes($)")
	}
	return t
}

// tagTerm reads a whole term that must be a tag set: a constituent's or an
// item's tags (§10). The error stands at the term.
func (b *domBuilder) tagTerm(n *Node) *domTerm {
	t := b.value(n)
	if problem := tagTermProblem(t); problem != "" {
		b.fail(n, "%s", problem)
	}
	return t
}

func (b *domBuilder) expr(n *Node) *domExpr {
	switch n.Rule {
	case "choice", "conjunction", "sequence":
		kind := map[string]string{"choice": exChoice, "conjunction": exAnd, "sequence": exSeq}[n.Rule]
		var items []*domExpr
		parts := ruleParts(n)
		// A capture stands only at an alternative's top level (§3.5): an
		// item of a choice or an & is inside.
		inside := kind != exSeq && len(parts) > 1
		if inside {
			b.inner++
		}
		for _, p := range parts {
			items = append(items, b.expr(p))
		}
		if inside {
			b.inner--
		}
		if len(items) == 1 {
			return items[0]
		}
		if kind == exAnd && len(items) > maxAnd {
			b.fail(n, "an & joins at most %d items, since it expands to 2ⁿ−1 sequences", maxAnd)
		}
		return &domExpr{Kind: kind, Items: items}
	case "element":
		var prim *domExpr
		repeat := false
		var primNode *Node
		for _, p := range parts(n) {
			if p.Kind == KindRule {
				primNode = p
			} else if b.text(p) == "..." {
				repeat = true
			}
		}
		if repeat {
			b.inner++
		}
		prim = b.expr(primNode)
		if repeat {
			b.inner--
		}
		if !repeat {
			return prim
		}
		if prim.Kind == exOptional {
			return &domExpr{Kind: exRepeat, Inner: prim.Inner, Min: 0}
		}
		return &domExpr{Kind: exRepeat, Inner: prim, Min: 1}
	case "reference":
		return &domExpr{Kind: exRef, Name: b.text(n)}
	case "tag", "character", "phoneme":
		return &domExpr{Kind: exTerminal, Name: b.tagOf(parts(n)[0])}
	case "range":
		return &domExpr{Kind: exRange, Range: b.readRange(n)}
	case "property":
		return &domExpr{Kind: exProperty, Name: b.readProperty(parts(n)[0])}
	case "tested":
		// A reference other than # or a terminal, and one test on its own
		// span (engine §2, §9). The syntax grammar reads a test after any
		// primary, so that the reader can name the reason.
		ps := ruleParts(n)
		symbol, testNode := ps[0], ps[1]
		switch symbol.Rule {
		case "constant-reference":
			b.fail(symbol, "%s", constantInBody)
		case "reference", "tag", "character", "phoneme", "range", "property":
		default:
			b.fail(testNode, "a test follows only a reference other than # or a terminal, not a group, an optional, a capture, ε, # or another test")
		}
		if symbol.Rule == "reference" && b.text(symbol) == "#" {
			b.fail(testNode, "a test follows only a reference other than # or a terminal, not a group, an optional, a capture, ε, # or another test")
		}
		inner := b.expr(symbol)
		// The comparator is the test's tokens: =, ≠, ⊇ or ⊉, or ∩ and =∅
		// or ≠∅ around the operand.
		var op strings.Builder
		var operand *Node
		for _, p := range parts(testNode) {
			if p.Kind == KindToken {
				op.WriteString(b.text(p))
			} else if p.Rule == "test-operand" {
				operand = p
			}
		}
		test := op.String()
		b.closedFor = "a test's operand"
		value := b.term(operand)
		b.closedFor = ""
		ty, problem := typeOf(value)
		if problem == "" {
			problem = testTypeProblem(test, ty)
		}
		if problem != "" {
			b.fail(operand, "%s", problem)
		}
		if isSoundTest(test) && value.Kind == tmString {
			if msg := soundProblem(value.Str, b.uni); msg != "" {
				at := firstOfRule(operand, "string")
				if at == nil {
					at = operand
				}
				b.fail(at, "%s", msg)
			}
		}
		return &domExpr{Kind: exTest, Op: test, Value: value, Inner: inner}
	case "capture":
		ps := parts(n)
		inner := ruleParts(n)
		if b.text(ps[0]) == "$" {
			b.fail(ps[0], "$ is the whole constituent and wraps nothing")
		}
		name := strings.TrimPrefix(b.text(ps[0]), "$")
		if !captureName.MatchString(name) {
			b.fail(ps[0], "a capture's name is all lower case")
		}
		if len(inner) == 1 && inner[0].Rule == "constant-reference" {
			b.fail(inner[0], "%s", constantInBody)
		}
		if len(inner) != 1 || !capturedRules[inner[0].Rule] {
			b.fail(ps[0], "a capture wraps a single symbol: a name, a tag literal, a character tag, a phoneme tag, a range or a property, or a tested one")
		}
		if b.inner > 0 {
			b.fail(ps[0], "a capture stands only at the top level of an alternative, not inside [ ], ( ), ..., & or a choice")
		}
		if b.captures[name] {
			b.fail(ps[0], "$%s is captured twice in one alternative", name)
		}
		b.captures[name] = true
		return &domExpr{Kind: exCapture, Name: name, Inner: b.expr(inner[0])}
	case "group", "optional":
		b.inner++
		inner := b.expr(ruleParts(n)[0])
		b.inner--
		if n.Rule == "group" {
			return inner
		}
		return &domExpr{Kind: exOptional, Inner: inner}
	case "empty":
		return &domExpr{Kind: exEmpty}
	case "constant-reference":
		b.fail(n, "%s", constantInBody)
	}
	b.fail(n, "unexpected %s in an expression", n.Rule)
	return nil
}

// capturedRules are the rules of the symbols a capture can wrap (engine §9).
var capturedRules = map[string]bool{
	"reference": true, "tag": true, "character": true, "phoneme": true, "range": true, "property": true, "tested": true,
}

// firstOfRule is the first node of a rule at or below a node, in the order
// written, or nil.
func firstOfRule(n *Node, name string) *Node {
	if n.Kind == KindRule && n.Rule == name {
		return n
	}
	for _, c := range parts(n) {
		if found := firstOfRule(c, name); found != nil {
			return found
		}
	}
	return nil
}

// readRange reads a range's two ends, each a character tag in its canonical
// spelling; its start must not be above its end (engine §1, §9).
func (b *domBuilder) readRange(n *Node) [2]string {
	var ends []string
	for _, c := range ruleParts(n) {
		ends = append(ends, b.tagOf(parts(c)[0]))
	}
	if len(ends) != 2 {
		b.fail(n, "a range's ends are two character tags")
	}
	r := [2]string{ends[0], ends[1]}
	if msg := rangeProblem(r, b.uni); msg != "" {
		b.fail(n, "%s", msg)
	}
	return r
}

// readProperty reads a property's name: its token is '\p{Name}', with a
// name of engine §1.
func (b *domBuilder) readProperty(n *Node) string {
	written := b.text(n)
	if !strings.HasPrefix(written, `'\p{`) || !strings.HasSuffix(written, "}'") || strings.Count(written, "}") != 1 {
		b.fail(n, `a property is written '\p{Name}'`)
	}
	name := written[4 : len(written)-2]
	if msg := propertyProblem(name); msg != "" {
		b.fail(n, "%s", msg)
	}
	return name
}

// decode decodes a string or a character tag token (engine §9). A string
// escapes its double quote, and a character tag its quote.
func (b *domBuilder) decode(n *Node) string {
	s := b.text(n)
	rs := []rune(s)
	if len(rs) < 2 {
		b.fail(n, "a malformed string")
	}
	quote := rs[0]
	rs = rs[1 : len(rs)-1]
	var out strings.Builder
	for i := 0; i < len(rs); i++ {
		c := rs[i]
		if c != '\\' {
			out.WriteRune(c)
			continue
		}
		if i+1 >= len(rs) {
			b.fail(n, "a string ends in a backslash")
		}
		i++
		switch rs[i] {
		case '\\', quote:
			out.WriteRune(rs[i])
		case 'u':
			end := -1
			if i+1 < len(rs) && rs[i+1] == '{' {
				for j := i + 2; j < len(rs); j++ {
					if rs[j] == '}' {
						end = j
						break
					}
				}
			}
			if end < 0 {
				b.fail(n, "\\u must be followed by {hex}")
			}
			v, err := strconv.ParseUint(string(rs[i+2:end]), 16, 32)
			// One to six hexadecimal digits of a Unicode scalar value (engine §9).
			if err != nil || end == i+2 || end-(i+2) > 6 || v > 0x10FFFF || (v >= 0xD800 && v <= 0xDFFF) {
				b.fail(n, "\\u{%s} is not a code point", string(rs[i+2:end]))
			}
			out.WriteRune(rune(v))
			i = end
		default:
			b.fail(n, "\\%c is not an escape; a string knows \\\\, \\\" and \\u{hex}, and a character tag \\\\, \\' and \\u{hex}", rs[i])
		}
	}
	return out.String()
}

// tagOf is the tag of a tag literal ~name, a character tag or a phoneme
// tag token: a character tag in its canonical spelling (engine §1, §9).
func (b *domBuilder) tagOf(n *Node) string {
	written := b.text(n)
	switch {
	case strings.HasPrefix(written, "~"):
		return written[1:]
	case strings.HasPrefix(written, "/"):
		return written
	}
	decoded := []rune(b.decode(n))
	if len(decoded) != 1 {
		b.fail(n, "a character tag holds exactly one character")
	}
	return characterTag(decoded[0], b.uni.isMark)
}

func (b *domBuilder) term(n *Node) *domTerm { return b.termIn(n, false) }

// termIn reads a term; argument says it is a function's argument, where a
// span or a rule may stand (§9, §10).
func (b *domBuilder) termIn(n *Node, argument bool) *domTerm {
	switch n.Rule {
	case "term":
		return b.termIn(ruleParts(n)[0], argument)
	case "test-operand":
		// One term: a string, a tag, a range, ∅, a constant, or a term in
		// parentheses (§9).
		return b.termIn(ruleParts(n)[0], argument)
	case "guarded-term":
		// A ⟹ t: its condition, and its term, which must be a tag set
		// (§10).
		if b.closedFor != "" {
			b.fail(n, "%s is a closed term, and holds no guarded term", b.closedFor)
		}
		ps := ruleParts(n)
		cond := b.anyOf(ps[0])
		if problem := condTypeProblem(cond); problem != "" {
			b.fail(n, "%s", problem)
		}
		t := &domTerm{Kind: tmIf, Cond: cond, Items: []*domTerm{b.value(ps[1])}}
		if _, problem := typeOf(t); problem != "" {
			b.fail(n, "%s", problem)
		}
		return t
	case "union":
		// Parts joined by ∪ and ∖ group from the left: a run joined by ∪
		// is one union, and each ∖ takes what stands before it (§9).
		ps := ruleParts(n)
		if len(ps) == 1 {
			return b.termIn(ps[0], argument)
		}
		var ops []string
		for _, p := range parts(n) {
			if p.Kind == KindToken {
				if t := b.text(p); t == "∪" || t == "∖" {
					ops = append(ops, t)
				}
			}
		}
		// A leading ∪ is a separator, not an operator.
		for len(ops) >= len(ps) {
			ops = ops[1:]
		}
		items := b.joined(n, ps, ops)
		result := items[0]
		open := false
		for i, op := range ops {
			next := items[i+1]
			switch {
			case op == "∖":
				result = &domTerm{Kind: tmDifference, Items: []*domTerm{result, next}}
				open = false
			case open:
				result.Items = append(result.Items, next)
			default:
				result = &domTerm{Kind: tmUnion, Items: []*domTerm{result, next}}
				open = true
			}
		}
		return result
	case "intersection":
		ps := ruleParts(n)
		if len(ps) == 1 {
			return b.termIn(ps[0], argument)
		}
		return &domTerm{Kind: tmIntersection, Items: b.joined(n, ps, []string{"∩"})}
	case "string":
		return &domTerm{Kind: tmString, Str: b.decode(n)}
	case "tag", "character", "phoneme":
		return &domTerm{Kind: tmTag, Str: b.tagOf(parts(n)[0])}
	case "range":
		return &domTerm{Kind: tmRange, Range: b.readRange(n)}
	case "property":
		b.fail(n, "a property is not a tag set, and stands only as a terminal in a body")
	case "name":
		// A bare name is a tag literal if it begins with a capital, and
		// otherwise a rule, which only a function's argument names.
		name := b.text(n)
		switch {
		case isCapital(name):
			return &domTerm{Kind: tmTag, Str: name}
		case argument:
			return &domTerm{Kind: tmRule, Str: name}
		}
		b.fail(n, "%s names a rule, which is not a value; ~%s is the tag", name, name)
	case "empty-set":
		return &domTerm{Kind: tmEmptySet}
	case "constant-reference":
		return &domTerm{Kind: tmConst, Str: strings.TrimPrefix(b.text(n), "$"), At: b.at(n)}
	case "capture-reference":
		name := strings.TrimPrefix(b.text(n), "$")
		if b.closedFor != "" {
			b.fail(n, "%s is a closed term, and holds no capture", b.closedFor)
		}
		if !argument {
			b.fail(n, "a span is not a value: tags($%s) is the tag set of $%s", name, name)
		}
		return &domTerm{Kind: tmCapture, Str: name}
	case "call":
		return b.call(n, false)
	}
	b.fail(n, "unexpected %s in a term", n.Rule)
	return nil
}

// joined reads the parts that ∪, ∩ or ∖ join, which are sets of one kind
// (§10); the error stands at the node that joins them.
func (b *domBuilder) joined(n *Node, ps []*Node, ops []string) []*domTerm {
	items := make([]*domTerm, 0, len(ps))
	types := make([]termType, 0, len(ps))
	for _, p := range ps {
		t := b.value(p)
		ty, problem := typeOf(t)
		if problem != "" {
			b.fail(n, "%s", problem)
		}
		items = append(items, t)
		types = append(types, ty)
	}
	op := ops[0]
	for _, o := range ops {
		if o == "∖" {
			op = o
		}
	}
	if _, problem := joinedType(types, op); problem != "" {
		b.fail(n, "%s", problem)
	}
	return items
}

// value reads a term where a value is needed: head, tail, last, from and
// after give spans, which are not values (§9).
func (b *domBuilder) value(n *Node) *domTerm {
	t := b.term(n)
	if t.Kind == tmCall && isSpanFunction(t.Str) {
		b.fail(n, "%s() gives a span, which is not a value", t.Str)
	}
	return t
}

func isSpanTerm(t *domTerm) bool {
	return t.Kind == tmCapture || (t.Kind == tmCall && isSpanFunction(t.Str))
}

// isStringTerm says whether a term, not a rule, is a string (§10). A
// constant's type is known only when the loader stitches the stage.
func isStringTerm(t *domTerm) bool {
	if t.Kind == tmRule {
		return false
	}
	ty, problem := typeOf(t)
	return problem == "" && (ty == tyString || ty == tyAny)
}

// call reads a call in a term, or, in a condition, matches(), begins() or
// initial().
func (b *domBuilder) call(n *Node, inCondition bool) *domTerm {
	ps := parts(n)
	name := b.text(ps[0])
	// A closed term calls only split and tag, the closed functions (§9,
	// §10).
	if b.closedFor != "" && name != "split" && name != "tag" {
		if !notationFunctions[name] {
			b.fail(ps[0], "%s() is not a function of the notation", name)
		}
		if name == "classify" {
			b.fail(ps[0], "%s is a closed term, and classify() depends on the features", b.closedFor)
		}
		b.fail(ps[0], "%s is a closed term, and %s() is not closed", b.closedFor, name)
	}
	var args []*domTerm
	for _, p := range ps[1:] {
		if p.Kind == KindRule {
			args = append(args, b.termIn(p, true))
		}
	}
	shape := func(ok bool) {
		if !ok {
			b.fail(ps[0], "%s() is not called with the arguments it takes", name)
		}
	}
	span := func(i int) bool { return i < len(args) && isSpanTerm(args[i]) }
	rule := func(i int) bool { return i < len(args) && args[i].Kind == tmRule }
	// A bare name in another slot is a call with the wrong arguments, so
	// the error is the call's, as for any other signature (§9).
	for i, a := range args {
		if a.Kind == tmRule && !(i == 1 && (name == "tags" || name == "matches" || name == "begins" || name == "classify")) {
			b.fail(ps[0], "a bare name is an argument only as the rule of tags(), matches() or begins(), or the classifier of classify()")
		}
	}
	if inCondition {
		switch name {
		case "matches", "begins":
			shape(len(args) == 2 && span(0) && rule(1))
		case "initial":
			shape(len(args) == 1 && span(0))
		default:
			b.fail(ps[0], "a condition calls only matches(), begins() or initial(); %s() is a term", name)
		}
		return &domTerm{Kind: tmCall, Str: name, Items: args}
	}
	switch name {
	case "phonemes", "text", "classes", "head", "tail", "last", "from", "after":
		shape(len(args) == 1 && span(0))
	case "tags":
		shape((len(args) == 1 && span(0)) || (len(args) == 2 && span(0) && rule(1)))
	case "split":
		shape(len(args) == 2 && isStringTerm(args[0]) && isStringTerm(args[1]))
	case "tag":
		shape(len(args) == 1 && isStringTerm(args[0]))
	case "classify":
		// A string, and a bare name, which names a classifier and not a
		// rule (§9).
		shape(len(args) == 2 && isStringTerm(args[0]) && rule(1))
		return &domTerm{Kind: tmCall, Str: name, Items: []*domTerm{args[0], {Kind: tmClassifier, Str: args[1].Str}}}
	case "matches", "begins", "initial":
		b.fail(ps[0], "%s() is a condition, not a term", name)
	default:
		b.fail(ps[0], "%s() is not a function of the notation", name)
	}
	// An empty delimiter or a tag's name that the reader sees (§9).
	if msg := literalCallProblem(name, args); msg != "" {
		b.fail(ps[0], "%s", msg)
	}
	return &domTerm{Kind: tmCall, Str: name, Items: args}
}

// notationFunctions are the functions of the notation (§10).
var notationFunctions = map[string]bool{
	"phonemes": true, "text": true, "split": true, "tag": true, "tags": true, "classes": true, "classify": true, "head": true, "tail": true,
	"last": true, "from": true, "after": true, "matches": true, "begins": true, "initial": true,
}

// implication reads A ⟹ B, which groups to the right, or the one any-of.
func (b *domBuilder) implication(n *Node) *domCond {
	ps := ruleParts(n)
	premise := b.anyOf(ps[0])
	if len(ps) == 1 {
		return premise
	}
	return &domCond{Kind: cdIf, Items: []*domCond{premise, b.implication(ps[1])}}
}

// anyOf reads conditions joined by ∨, each several joined by ∧. Parentheses
// make no node, so a group of the connective around it is folded into it:
// (a ∧ b) ∧ c is an all of three, (a ∨ b) ∨ c an any of three (§9).
func (b *domBuilder) anyOf(n *Node) *domCond {
	var items []*domCond
	for _, all := range ruleParts(n) {
		var conds []*domCond
		for _, p := range ruleParts(all) {
			if c := b.condition(p); c.Kind == cdAll {
				conds = append(conds, c.Items...)
			} else {
				conds = append(conds, c)
			}
		}
		switch {
		case len(conds) > 1:
			items = append(items, &domCond{Kind: cdAll, Items: conds})
		case conds[0].Kind == cdAny:
			items = append(items, conds[0].Items...)
		default:
			items = append(items, conds[0])
		}
	}
	if len(items) == 1 {
		return items[0]
	}
	return &domCond{Kind: cdAny, Items: items}
}

func (b *domBuilder) condition(n *Node) *domCond {
	switch n.Rule {
	case "comparison":
		ps := ruleParts(n)
		d := &domCond{Kind: cdCompare, Left: b.value(ps[0]), Op: b.text(ps[1]), Right: b.value(ps[2])}
		// The two sides fit the comparator (§10).
		if problem := condTypeProblem(d); problem != "" {
			b.fail(n, "%s", problem)
		}
		return d
	case "negation":
		return &domCond{Kind: cdNot, Inner: b.condition(ruleParts(n)[0])}
	case "call":
		t := b.call(n, true)
		if t.Str == "initial" {
			return &domCond{Kind: cdInitial, Span: t.Items[0]}
		}
		kind := cdMatches
		if t.Str == "begins" {
			kind = cdBegins
		}
		return &domCond{Kind: kind, Span: t.Items[0], Rule: t.Items[1].Str}
	case "presence":
		return &domCond{Kind: cdCaptured, Rule: strings.TrimPrefix(b.text(n), "$")}
	case "implication":
		// Between parentheses, which make no node.
		return b.implication(n)
	}
	b.fail(n, "unexpected %s in a condition", n.Rule)
	return nil
}

func (b *domBuilder) emission(n *Node) *domEmit {
	first := parts(n)[0]
	e := &domEmit{}
	whole := 0
	listed := map[string]bool{}
	for _, item := range ruleParts(n) {
		ps := parts(item)
		target := ps[0]
		it := &domEmitItem{}
		var tagsNode *Node
		for _, p := range ps[1:] {
			if p.Kind == KindRule && p.Rule == "emit-tags" {
				tagsNode = p
			}
		}
		text := b.text(target)
		switch {
		case target.Kind == KindRule && (target.Rule == "range" || target.Rule == "property"):
			b.fail(target, "an inserted item is one tag, not a range or a property")
		case strings.HasPrefix(text, "$"):
			it.Capture = text[1:]
			if it.Capture == "" {
				whole++
			} else {
				if listed[it.Capture] {
					b.fail(first, "an emission lists $%s twice", it.Capture)
				}
				listed[it.Capture] = true
			}
		case strings.HasPrefix(text, "~"), strings.HasPrefix(text, "/"), strings.HasPrefix(text, "'"):
			// An inserted tag is a single tag literal (§9).
			it.IsInsert, it.Insert = true, b.tagOf(target)
		case isCapital(text):
			it.IsInsert, it.Insert = true, text
		default:
			b.fail(target, "%s names a rule; an inserted tag is a tag literal, such as ~%s", text, text)
		}
		if tagsNode != nil {
			if it.IsInsert {
				b.fail(target, "an inserted tag takes no tags")
			}
			it.Tags = b.tagTerm(ruleParts(tagsNode)[0])
			if it.Tags.Kind == tmEmptySet {
				b.fail(target, "<∅> emits a token no terminal can read; %%emits ε emits nothing")
			}
		}
		e.Items = append(e.Items, it)
	}
	if whole > 0 && whole != len(e.Items) {
		b.fail(first, "$ is used with items other than $")
	}
	return e
}

// The kinds of a directive's operand: a bare name, lower case or with a
// capital, a string, a tag literal ~name, a phoneme tag, a character tag,
// a range or a property.
const (
	operandName      = "name"
	operandClass     = "class"
	operandString    = "string"
	operandTag       = "tag"
	operandPhoneme   = "phoneme"
	operandCharacter = "character"
	operandRange     = "range"
	operandProperty  = "property"
)

// operandProblem says what is wrong with a directive's operands, given the
// kind of each, or "" (engine §9).
func operandProblem(name string, kinds []string) string {
	names := true
	for _, k := range kinds {
		if k != operandName && k != operandClass {
			names = false
		}
	}
	switch name {
	case "stage":
		if len(kinds) != 1 || !names {
			return "%stage takes one name"
		}
	case "include":
		if len(kinds) != 1 || kinds[0] != operandString {
			return "%include takes one string"
		}
	case "features":
		if len(kinds) == 0 || !names {
			return "%features takes one or more names"
		}
	case "elidable":
		// Identifier tags: a name with a capital, or ~name.
		for _, k := range kinds {
			if k != operandClass && k != operandTag {
				return "%elidable takes identifier tags: names with a capital, or ~name"
			}
		}
	default:
		if !names {
			return "%" + name + " takes names only"
		}
	}
	return ""
}
