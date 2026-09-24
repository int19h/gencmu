package gencmu

import (
	"encoding/json"
	"fmt"
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
		Stages []struct {
			Name      string
			Documents []struct {
				Path string
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
		var docs []docDOM
		for _, d := range s.Documents {
			dom, err := decodeDOM(d.Dom)
			if err != nil {
				return nil, &Error{Kind: ErrorGrammar, Document: "notation/bootstrap.json", Message: "cannot read the bootstrap's DOM of " + d.Path + ": " + err.Error()}
			}
			docs = append(docs, docDOM{path: d.Path, dom: dom})
		}
		g, gerr := stitch(s.Name, docs)
		if gerr != nil {
			return nil, gerr
		}
		nr.stages = append(nr.stages, g)
		nr.lowered = append(nr.lowered, lower(g, nil, false))
	}
	if len(nr.stages) == 0 {
		return nil, &Error{Kind: ErrorGrammar, Document: "notation/bootstrap.json", Message: "the bootstrap has no stages"}
	}
	return nr, nil
}

// read reads one grammar document into its DOM.
func (nr *notationReader) read(text, docPath string) (dom *domDoc, err *Error) {
	gt := extractEBNF(text)
	if gt.unclosed != nil {
		return nil, grammarError(docPath, *gt.unclosed, "an ebnf block is never closed")
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
	b := &domBuilder{toks: toks, gt: gt, doc: docPath}
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
	// nesting deeper than 256 (§9), reported at the rule.
	if p := checkDOM(dom); p != nil {
		e := &Error{Kind: ErrorGrammar, Document: docPath, Message: p.message}
		if p.rule != nil {
			e.Line, e.Column = p.rule.At[0], p.rule.At[1]
		}
		return nil, e
	}
	return dom, nil
}

type domBuilder struct {
	captures map[string]bool // the captures of the alternative being read
	inner    int             // how deep inside [ ], ( ), ..., & or a choice the reader is
	toks     []Token
	gt       *grammarText
	doc      string
}

// The rules the reader looks at by name; every other rule is transparent.
var domRules = map[string]bool{
	"directive-statement": true, "rule": true, "alternative": true, "choice": true,
	"conjunction": true, "sequence": true, "element": true, "reference": true,
	"string": true, "phoneme": true, "capture": true, "group": true, "optional": true,
	"empty": true, "emission": true, "conditions": true, "any-of": true,
	"all-of": true, "comparison": true, "negation": true, "call": true,
	"term": true, "intersection": true, "weak": true, "empty-set": true,
	"capture-reference": true, "rule-tags": true, "alternative-tags": true,
	"emit-tags": true, "erase": true, "emit-item": true, "definer": true,
	"argument-word": true, "guard": true, "comparator": true,
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

func (b *domBuilder) isIdentifier(n *Node) bool {
	if n.Kind != KindToken {
		return false
	}
	_, ok := b.toks[n.Token].Tags["identifier"]
	return ok
}

func (b *domBuilder) document(root *Node) *domDoc {
	d := &domDoc{Rules: []*domRule{}, Directives: []*domDirective{}}
	for _, c := range ruleParts(root) {
		switch c.Rule {
		case "rule":
			d.Rules = append(d.Rules, b.rule(c))
		case "directive-statement":
			ps := parts(c)
			dir := &domDirective{Name: strings.TrimPrefix(b.text(ps[0]), "%"), Args: []string{}, At: b.at(ps[0])}
			for _, p := range ps {
				if p.Kind == KindRule && p.Rule == "argument-word" {
					dir.Args = append(dir.Args, b.text(p))
				}
			}
			d.Directives = append(d.Directives, dir)
		}
	}
	return d
}

func (b *domBuilder) rule(n *Node) *domRule {
	ps := parts(n)
	r := &domRule{Name: b.text(ps[0]), At: b.at(ps[0]), Conditions: []*domCond{}}
	var emission *Node
	for _, p := range ps[1:] {
		if p.Kind != KindRule {
			continue
		}
		switch p.Rule {
		case "rule-tags":
			r.Tags = b.constituentTags(p)
		case "definer":
			if b.text(p) == "|≔" {
				r.Op = "extend"
			} else {
				r.Op = "define"
			}
		case "alternative":
			r.Alternatives = append(r.Alternatives, b.alternative(p))
		case "emission":
			if emission != nil {
				b.fail(p, "a rule has at most one emission")
			}
			emission = p
			r.Emit = b.emission(p)
		case "conditions":
			// The conditions joined by ∧ at the top are the rule's
			// conditions, one by one (§9).
			top := ruleParts(p)[0]
			if alls := ruleParts(top); len(alls) == 1 {
				for _, c := range ruleParts(alls[0]) {
					r.Conditions = append(r.Conditions, b.condition(c))
				}
			} else {
				r.Conditions = append(r.Conditions, b.anyOf(top))
			}
		}
	}
	return r
}

func (b *domBuilder) alternative(n *Node) *domAlt {
	a := &domAlt{Guards: []domGuard{}}
	b.captures = map[string]bool{}
	for _, p := range ruleParts(n) {
		switch p.Rule {
		case "guard":
			g := strings.TrimPrefix(b.text(p), "@")
			neg := strings.HasPrefix(g, "¬")
			a.Guards = append(a.Guards, domGuard{Feature: strings.TrimPrefix(g, "¬"), Negated: neg})
		case "alternative-tags":
			a.Tags = b.constituentTags(p)
		default:
			a.Expr = b.expr(p)
		}
	}
	return a
}

// constituentTags reads a rule's or an alternative's tag term, which cannot
// be made of the tags it defines: $, tags($) or classes($) (§9).
func (b *domBuilder) constituentTags(n *Node) *domTerm {
	t := b.value(ruleParts(n)[0])
	if readsOwnTags(t) {
		b.fail(n, "a constituent's tags cannot be made of its own: $, tags($) or classes($)")
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
	case "string":
		return &domExpr{Kind: exTerminal, Name: b.decode(n)}
	case "phoneme":
		return &domExpr{Kind: exTerminal, Name: b.text(n)}
	case "capture":
		ps := parts(n)
		inner := ruleParts(n)
		if b.text(ps[0]) == "$" {
			b.fail(ps[0], "$ is the whole constituent and wraps nothing")
		}
		if len(inner) != 1 || (inner[0].Rule != "reference" && inner[0].Rule != "string" && inner[0].Rule != "phoneme") {
			b.fail(ps[0], "a capture wraps a single symbol: a name, a string or a phoneme tag")
		}
		name := strings.TrimPrefix(b.text(ps[0]), "$")
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
	}
	b.fail(n, "unexpected %s in an expression", n.Rule)
	return nil
}

// decode decodes a string token (engine §9).
func (b *domBuilder) decode(n *Node) string {
	s := b.text(n)
	rs := []rune(s)
	if len(rs) < 2 {
		b.fail(n, "a malformed string")
	}
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
		case '\\', '"':
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
			if err != nil || end == i+2 || v > 0x10FFFF || (v >= 0xD800 && v <= 0xDFFF) {
				b.fail(n, "\\u{%s} is not a code point", string(rs[i+2:end]))
			}
			out.WriteRune(rune(v))
			i = end
		default:
			b.fail(n, "\\%c is not an escape; a string knows \\\\, \\\" and \\u{hex}", rs[i])
		}
	}
	return out.String()
}

func (b *domBuilder) term(n *Node) *domTerm {
	switch n.Rule {
	case "term", "intersection":
		kind := tmUnion
		if n.Rule == "intersection" {
			kind = tmIntersection
		}
		var items []*domTerm
		parts := ruleParts(n)
		if len(parts) == 1 {
			return b.term(parts[0])
		}
		for _, p := range parts {
			items = append(items, b.value(p))
		}
		return &domTerm{Kind: kind, Items: items}
	case "string":
		return &domTerm{Kind: tmLiteral, Str: b.decode(n)}
	case "phoneme":
		return &domTerm{Kind: tmLiteral, Str: b.text(n)}
	case "weak":
		for _, p := range parts(n) {
			if p.Kind == KindToken && strings.HasPrefix(b.text(p), "\"") {
				return &domTerm{Kind: tmWeak, Str: b.decode(p)}
			}
		}
	case "empty-set":
		return &domTerm{Kind: tmEmptySet}
	case "capture-reference":
		return &domTerm{Kind: tmCapture, Str: strings.TrimPrefix(b.text(n), "$")}
	case "call":
		return b.call(n, false)
	}
	b.fail(n, "unexpected %s in a term", n.Rule)
	return nil
}

// value reads a term where a value is needed: head, tail and last give
// spans, which are not values (§9).
func (b *domBuilder) value(n *Node) *domTerm {
	t := b.term(n)
	if t.Kind == tmCall && (t.Str == "head" || t.Str == "tail" || t.Str == "last") {
		b.fail(n, "%s() gives a span, which is not a value", t.Str)
	}
	return t
}

// isStringTerm: a quoted string, a phoneme tag, or phonemes, text or
// lowercase of something.
func isStringTerm(t *domTerm) bool {
	return t.Kind == tmLiteral || (t.Kind == tmCall && (t.Str == "phonemes" || t.Str == "text" || t.Str == "lowercase"))
}

func isSpanTerm(t *domTerm) bool {
	return t.Kind == tmCapture || (t.Kind == tmCall && (t.Str == "head" || t.Str == "tail" || t.Str == "last"))
}

// call reads a call in a term, or, in a condition, matches().
func (b *domBuilder) call(n *Node, inCondition bool) *domTerm {
	ps := parts(n)
	name := b.text(ps[0])
	var args []*domTerm
	var argNodes []*Node
	for _, p := range ps[1:] {
		switch {
		case p.Kind == KindRule:
			args = append(args, b.term(p))
			argNodes = append(argNodes, p)
		case b.isIdentifier(p):
			args = append(args, &domTerm{Kind: tmRule, Str: b.text(p)})
			argNodes = append(argNodes, p)
		}
	}
	shape := func(ok bool) {
		if !ok {
			b.fail(ps[0], "%s() is not called with the arguments it takes", name)
		}
	}
	span := func(i int) bool { return i < len(args) && isSpanTerm(args[i]) }
	rule := func(i int) bool { return i < len(args) && args[i].Kind == tmRule }
	for i, a := range args {
		if a.Kind == tmRule && !(i == 1 && (name == "tags" || name == "matches")) {
			b.fail(argNodes[i], "a bare name is an argument only as the rule of tags() or matches()")
		}
	}
	if inCondition {
		if name != "matches" {
			b.fail(ps[0], "a condition calls only matches(); %s() is a term", name)
		}
		shape(len(args) == 2 && span(0) && rule(1))
		return &domTerm{Kind: tmCall, Str: name, Items: args}
	}
	switch name {
	case "phonemes", "text", "words", "classes", "head", "tail", "last":
		shape(len(args) == 1 && span(0))
	case "tags":
		shape((len(args) == 1 && span(0)) || (len(args) == 2 && span(0) && rule(1)))
	case "lowercase":
		shape(len(args) == 1 && isStringTerm(args[0]))
	case "matches":
		b.fail(ps[0], "matches() is a condition, not a term")
	default:
		b.fail(ps[0], "%s() is not a function of the notation", name)
	}
	return &domTerm{Kind: tmCall, Str: name, Items: args}
}

// anyOf reads conditions joined by ∨, each several joined by ∧.
func (b *domBuilder) anyOf(n *Node) *domCond {
	var items []*domCond
	for _, all := range ruleParts(n) {
		var conds []*domCond
		for _, p := range ruleParts(all) {
			conds = append(conds, b.condition(p))
		}
		if len(conds) == 1 {
			items = append(items, conds[0])
		} else {
			items = append(items, &domCond{Kind: cdAll, Items: conds})
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
		return &domCond{Kind: cdCompare, Left: b.value(ps[0]), Op: b.text(ps[1]), Right: b.value(ps[2])}
	case "negation":
		return &domCond{Kind: cdNot, Inner: b.condition(ruleParts(n)[0])}
	case "call":
		t := b.call(n, true)
		return &domCond{Kind: cdMatches, Span: t.Items[0], Rule: t.Items[1].Str}
	case "any-of":
		return b.anyOf(n)
	}
	b.fail(n, "unexpected %s in a condition", n.Rule)
	return nil
}

func (b *domBuilder) emission(n *Node) *domEmit {
	first := parts(n)[0]
	e := &domEmit{}
	whole, erasesWhole := 0, false
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
		case strings.HasPrefix(text, "\""):
			it.IsInsert, it.Insert = true, b.decode(target)
		default:
			it.IsInsert, it.Insert = true, text
		}
		if tagsNode != nil {
			if it.IsInsert {
				b.fail(target, "an inserted tag takes no tags, and is not erased")
			}
			inner := ruleParts(tagsNode)[0]
			if inner.Rule == "erase" {
				it.Erase = true
				if it.Capture == "" {
					erasesWhole = true
				}
			} else {
				it.Tags = b.value(inner)
				if it.Tags.Kind == tmEmptySet {
					b.fail(target, "<∅> emits a token no terminal can read; <> erases")
				}
			}
		}
		e.Items = append(e.Items, it)
	}
	if whole > 0 && whole != len(e.Items) {
		b.fail(first, "$ is used with items other than $")
	}
	if erasesWhole && len(e.Items) != 1 {
		b.fail(first, "$ <> stands alone")
	}
	return e
}
