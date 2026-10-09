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

func newNotationReader(bootstrap string, uni *unicodeTable) (reader *notationReader, err error) {
	defer func() {
		if e, ok := err.(*Error); ok {
			embedded := e.Document
			if embedded != "" && embedded != "notation/bootstrap.json" && !strings.Contains(e.Message, embedded) {
				e.Message += " (embedded document: " + embedded + ")"
			}
			e.Document = "notation/bootstrap.json"
			location := e.Document
			if e.Line != 0 {
				location += ":" + strconv.Itoa(e.Line)
				if e.Column != 0 {
					location += ":" + strconv.Itoa(e.Column)
				}
			}
			if !strings.HasPrefix(e.Message, location+": ") {
				stage := ""
				if e.Stage != "" {
					stage = "stage " + e.Stage + ": "
				}
				e.Message = location + ": " + stage + e.Message
			}
		}
	}()
	var b struct {
		Format int `json:"format"`
		// A stage's name and a document's path are strings: null and
		// absent are refused, as the other libraries refuse them.
		Stages []struct {
			Name      *string `json:"name"`
			Documents []struct {
				Path *string         `json:"path"`
				Dom  json.RawMessage `json:"dom"`
			} `json:"documents"`
		} `json:"stages"`
	}
	if err := unmarshalJSON([]byte(bootstrap), &b); err != nil {
		return nil, &Error{Kind: ErrorGrammar, Document: "notation/bootstrap.json", Message: "cannot read the bootstrap: " + err.Error()}
	}
	if b.Format != domFormat {
		return nil, &Error{Kind: ErrorGrammar, Document: "notation/bootstrap.json", Message: "the bootstrap has an unknown format"}
	}
	nr := &notationReader{uni: uni, hash: fnv1a64(bootstrap)}
	if len(b.Stages) == 0 {
		return nil, &Error{Kind: ErrorGrammar, Document: "notation/bootstrap.json", Message: "the bootstrap has no stages"}
	}
	type stageInput struct {
		name      string
		documents []docDOM
	}
	var inputs []stageInput
	names := map[string]bool{}
	for _, s := range b.Stages {
		if s.Name == nil || !isName(*s.Name) {
			return nil, &Error{Kind: ErrorGrammar, Document: "notation/bootstrap.json", Message: "a stage of the bootstrap has no name"}
		}
		if names[*s.Name] {
			return nil, &Error{Kind: ErrorGrammar, Document: "notation/bootstrap.json", Message: "a second stage named " + *s.Name}
		}
		names[*s.Name] = true
		if len(s.Documents) == 0 {
			return nil, &Error{Kind: ErrorGrammar, Document: "notation/bootstrap.json", Message: "a bootstrap stage requires documents"}
		}
		var docs []docDOM
		for _, d := range s.Documents {
			if d.Path == nil {
				return nil, &Error{Kind: ErrorGrammar, Document: "notation/bootstrap.json", Message: "a document of the bootstrap has no path"}
			}
			dom, err := decodeDOM(d.Dom, uni)
			if err != nil {
				return nil, &Error{Kind: ErrorGrammar, Document: "notation/bootstrap.json", Message: "cannot read the bootstrap's DOM of " + *d.Path + ": " + err.Error(), Code: rankedDOMCode(err)}
			}
			docs = append(docs, docDOM{path: *d.Path, dom: dom})
		}
		inputs = append(inputs, stageInput{*s.Name, docs})
	}
	for _, input := range inputs {
		hasRules := false
		for _, document := range input.documents {
			hasRules = hasRules || len(document.dom.Rules) > 0
		}
		if !hasRules {
			return nil, &Error{Kind: ErrorGrammar, Stage: input.name, Message: "stage " + input.name + " has no rules"}
		}
	}
	for _, input := range inputs {
		g, gerr := stitch(input.name, input.documents, uni)
		if gerr != nil {
			gerr.Stage = input.name
			return nil, gerr
		}
		nr.stages = append(nr.stages, g)
	}
	if _, err := newDialect(nr.stages, nil, uni); err != nil {
		return nil, err
	}
	for _, g := range nr.stages {
		l := lower(g, nil)
		if l.fault != "" {
			fault := *l.faultLocation
			return nil, &fault
		}
		nr.lowered = append(nr.lowered, l)
	}
	return nr, nil
}

// read reads one grammar document into its DOM.
func (nr *notationReader) read(text, docPath string) (*domDoc, *Error) {
	return nr.readMode(text, docPath, false)
}
func (nr *notationReader) readMode(text, docPath string, deferEmission bool) (dom *domDoc, err *Error) {
	gt := extractGrammarText(text)
	if gt.unclosed != nil {
		return nil, grammarError(docPath, *gt.unclosed, "a jbogenbau block is never closed")
	}
	ps := newParseState(nr.uni, gt.text)
	toks := ps.characterTokens()
	var out stageOutcome
	for i, g := range nr.stages {
		if g.name == "syntax" {
			for _, token := range toks {
				if token.Text == "%prefer" {
					return nil, grammarError(docPath, gt.at(token.Source[0]), "unknown directive %%prefer; use an inline ranked choice (A ≻ B)")
				}
			}
		}
		run := ps.newRun(g.name, g, toks)
		// Each notation stage runs the check of elision-only where its own
		// directive declares it (§8).
		out = run.run(nr.lowered[i], g.elisionOnly)
		if out.err != nil && out.err.Kind == ErrorAmbiguous {
			// A tie has no single position, so the error names the document
			// alone, with no line or column (engine §8).
			return nil, &Error{Kind: ErrorGrammar, Document: docPath,
				Message: "the grammar text is ambiguous: the " + g.name + " stage of the notation reads it in two ways"}
		}
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
			if g.name == "syntax" && out.err.Kind == ErrorRejected && out.err.Token != nil && rankedSyntaxFailure(toks, *out.err.Token) {
				e.Code = "ranked-choice-syntax"
			}
			return nil, e
		}
		if i < len(nr.stages)-1 {
			toks = out.stage.Output
		}
	}
	b := &domBuilder{deferEmission: deferEmission, toks: toks, gt: gt, doc: docPath, uni: nr.uni, types: newTypeMemo()}
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
		e := &Error{Kind: ErrorGrammar, Document: docPath, Message: p.message, Code: p.code}
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
	deferEmission bool
	// captureNodes holds the notation node of each capture of the
	// alternative being read, where an error about it is reported.
	captureNodes map[*domExpr]*Node
	// braces and marked count the braces and the elidable optionals the
	// reader is inside, where no capture stands (engine §3.5).
	braces, marked int
	toks           []Token
	gt             *grammarText
	doc            string
	uni            *unicodeTable // the lowercase mapping the strings of sound tests are checked against
	// closedFor is what the reader is reading as a closed term, a
	// constant's value or a test's operand, or "" (§9, §10).
	closedFor string
	// types keeps the types found of the terms and conditions read, each
	// found once (§10).
	types *typeMemo
}

// The rules of the notation's syntax grammar that the reader knows (engine
// §9). Every other rule is a wrapper, and the reader reads its parts in its
// place.
var domRules = map[string]bool{
	"rule-name": true, "body": true, "primary": true, "emit-target": true, "condition": true, "argument": true, "term-atom": true,
	"directive": true, "rule": true, "definer": true, "rule-flags": true, "rule-flag": true, "alternative": true, "choice": true, "ranked-alternative": true, "ranked-choice": true,
	"conjunction": true, "sequence": true, "repetition": true, "reference": true,
	"string": true, "tag": true, "character": true, "phoneme": true, "name": true,
	"tested": true, "test": true, "test-operand": true, "capture": true, "group": true, "optional": true,
	"empty": true, "tags-clause": true, "conditions-clause": true, "emits-clause": true,
	"opaque-clause": true, "emit-item": true, "emit-tags": true, "emit-before": true, "emit-after": true, "implication": true,
	"any-of": true, "all-of": true, "comparison": true, "negation": true,
	"tree-comparison": true, "pattern-literal": true, "pattern-union": true, "pattern-intersection": true, "pattern-sequence": true, "pattern-item": true, "pattern-atom": true, "pattern-brackets": true, "pattern-repeat": true, "pattern-path": true, "pattern-separator": true,
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
	e := grammarError(b.doc, b.at(n), format, args...)
	if n.Rule == "ranked-choice" {
		e.Code = "ranked-choice-syntax"
	}
	panic(e)
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

// The parts that the reader reads from a node (engine §9). A node that
// lacks one is an error of the document, which only a bootstrap of another
// notation gives.

func (b *domBuilder) lacks(n *Node, what string) {
	b.fail(n, "the notation's %s has no %s", n.Rule, what)
}

// ofRule is the parts of a node of one rule.
func ofRule(n *Node, name string) []*Node {
	var out []*Node
	for _, c := range ruleParts(n) {
		if c.Rule == name {
			out = append(out, c)
		}
	}
	return out
}

// one is the first part of a rule, or nil.
func one(n *Node, name string) *Node {
	if found := ofRule(n, name); len(found) > 0 {
		return found[0]
	}
	return nil
}

func (b *domBuilder) only(n *Node, name string) *Node {
	found := one(n, name)
	if found == nil {
		b.lacks(n, name)
	}
	return found
}

// some is the parts of a rule, at least least of them.
func (b *domBuilder) some(n *Node, name string, least int) []*Node {
	found := ofRule(n, name)
	if len(found) < least {
		if least == 1 {
			b.lacks(n, name)
		}
		b.lacks(n, fmt.Sprintf("%d of %s", least, name))
	}
	return found
}

// token is the first token among a node's parts.
func (b *domBuilder) token(n *Node) *Node {
	for _, c := range parts(n) {
		if c.Kind == KindToken {
			return c
		}
	}
	b.lacks(n, "token")
	return nil
}

// symbolPart is the first part of a node: a token, a range or a property.
func (b *domBuilder) symbolPart(n *Node) *Node {
	ps := parts(n)
	if len(ps) > 0 && (ps[0].Kind == KindToken || ps[0].Rule == "range" || ps[0].Rule == "property") {
		return ps[0]
	}
	b.lacks(n, "token, range or property")
	return nil
}

// knownOf is the one rule among a node's parts, which must be one of kinds.
func (b *domBuilder) knownOf(n *Node, kinds []string) *Node {
	found := ruleParts(n)
	if len(found) == 1 {
		for _, k := range kinds {
			if found[0].Rule == k {
				return found[0]
			}
		}
	}
	b.lacks(n, "single part of these: "+strings.Join(kinds, ", "))
	return nil
}

// What a primary, a condition, a term and a term atom hold: the one rule
// among their parts is one of these (engine §9).
var (
	primaryRules   = []string{"reference", "tag", "character", "phoneme", "range", "property", "tested", "capture", "group", "optional", "repetition", "empty", "constant-reference"}
	conditionRules = []string{"comparison", "tree-comparison", "call", "negation", "presence", "implication"}
	termRules      = []string{"union", "guarded-term"}
	atomRules      = []string{"string", "tag", "character", "phoneme", "range", "property", "name", "empty-set", "term", "call", "capture-reference", "constant-reference", "pattern-literal"}
)

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
		case "rule", "constant-definition", "classifier", "implication-declaration", "directive":
		default:
			b.fail(c, "the notation gives a %s where an item stands", c.Rule)
		}
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
			keyword := b.token(c)
			ps := parts(c)
			dir := &domDirective{Name: strings.TrimPrefix(b.text(keyword), "%"), Args: []string{}, At: b.at(keyword)}
			var kinds []string
			for _, p := range ps {
				// The operands are the argument parts alone. The reader
				// ignores any other part (engine §9).
				if p.Kind != KindRule || (p.Rule != "argument-word" && p.Rule != "argument-string" && p.Rule != "argument-tag") {
					continue
				}
				switch p.Rule {
				case "argument-word":
					dir.Args = append(dir.Args, b.text(b.token(p)))
					if isCapital(b.text(b.token(p))) {
						kinds = append(kinds, operandClass)
					} else {
						kinds = append(kinds, operandName)
					}
				case "argument-string":
					// A string operand is decoded, as a string of a rule is.
					dir.Args = append(dir.Args, b.decode(b.token(p)))
					kinds = append(kinds, operandString)
				case "argument-tag":
					// A tag literal is its name; a phoneme or character tag,
					// a range or a property is refused below.
					t := b.symbolPart(p)
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
				b.fail(keyword, "%s", problem)
			}
			if dir.Name == "ambiguity-resolution" {
				for _, arg := range dir.Args {
					if arg == "maximal" {
						b.fail(keyword, "stage-wide maximal is retired; use [++T] for an individual terminator")
					}
				}
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
	definer := b.token(b.only(n, "constant-definer"))
	reference := b.token(b.only(n, "constant-reference"))
	valueNode := b.only(n, "term")
	k := &domConst{Name: strings.TrimPrefix(b.text(reference), "$"), Op: "define", At: b.at(n)}
	if b.text(definer) == "%redefine-const" {
		k.Op = "redefine"
	}
	b.closedFor = "a constant's value"
	k.Value = b.value(valueNode)
	b.closedFor = ""
	if _, f := constantValueType(k.Value, k.Op == "redefine", nil); f != nil {
		b.fail(valueNode, "%s", f.problem)
	}
	return k
}

// classifier reads a %classifier item: its name, which begins with a
// lower-case letter, and its entries (engine §2, §9).
func (b *domBuilder) classifier(n *Node) *domClassifier {
	c := &domClassifier{Entries: []*domEntry{}, At: b.at(n)}
	nameNode := b.only(n, "classifier-name")
	c.Name = b.text(b.token(nameNode))
	if !classifierName.MatchString(c.Name) {
		b.fail(nameNode, "%s begins with a capital, so it is a tag; a classifier's name begins with a lower-case letter", c.Name)
	}
	for _, p := range ofRule(n, "classifier-entry") {
		c.Entries = append(c.Entries, b.entry(p))
	}
	return c
}

// entry reads an entry of a classifier: gates, canonical keys, ∈ or ∉, and
// a class (engine §2, §9).
func (b *domBuilder) entry(n *Node) *domEntry {
	e := &domEntry{Guards: []domGuard{}, At: b.at(n)}
	for _, p := range ofRule(n, "guard") {
		g := b.text(b.token(p))
		if strings.HasSuffix(g, "!") {
			b.fail(p, "an entry of a classifier takes gates only, not a warning")
		}
		neg := strings.HasPrefix(g, "¬")
		e.Guards = append(e.Guards, domGuard{Feature: strings.TrimSuffix(strings.TrimPrefix(g, "¬"), "?"), Kind: FeatureGate, Negated: neg})
	}
	for _, p := range b.some(n, "classifier-key", 1) {
		key := b.decode(b.token(p))
		if msg := soundProblem(key, b.uni); msg != "" {
			b.fail(p, "a key is a canonical sound: %s", msg)
		}
		e.Keys = append(e.Keys, key)
	}
	e.Op = b.text(b.token(b.only(n, "classifier-operator")))
	classNode := b.only(n, "classifier-class")
	written := b.text(b.token(classNode))
	e.Class = strings.TrimPrefix(written, "~")
	if !isCapital(e.Class) {
		b.fail(classNode, "%s is not a class: a class is an identifier tag that begins with a capital", written)
	}
	return e
}

// implicationDeclaration reads %implies A ⟹ B: two closed terms whose type
// is a tag set (engine §2, §9).
func (b *domBuilder) implicationDeclaration(n *Node) *domImplication {
	m := &domImplication{At: b.at(n)}
	var sides []*domTerm
	for _, p := range b.some(n, "union", 2)[:2] {
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
	definer := b.token(b.only(n, "definer"))
	r := &domRule{Name: b.text(b.token(b.only(n, "rule-name"))), At: b.at(definer), Conditions: []*domCond{}, Flags: []string{}}
	switch b.text(definer) {
	case "%redefine-rule":
		r.Op = "redefine"
	case "%extend-rule":
		r.Op = "extend"
	default:
		r.Op = "define"
	}
	if list := one(n, "rule-flags"); list != nil {
		if r.Op == "extend" {
			b.fail(list, "%%extend-rule accepts no flags")
		}
		for _, flag := range b.some(list, "rule-flag", 1) {
			name := b.text(b.token(flag))
			if name != "leftmost-longest" {
				b.fail(flag, "unknown rule flag %s", name)
			}
			if len(r.Flags) > 0 {
				b.fail(flag, "duplicate rule flag %s", name)
			}
			r.Flags = append(r.Flags, name)
		}
	}
	// The parts of a definition are read in the order written: the body,
	// then its clauses in their fixed order, and the checks of the whole
	// definition last (engine §9).
	body := b.only(n, "body")
	var alternatives []*Node
	if ranked := one(body, "ranked-alternative"); ranked != nil {
		alternatives = []*Node{ranked}
	} else {
		alternatives = b.some(body, "alternative", 1)
	}
	for _, p := range alternatives {
		r.Alternatives = append(r.Alternatives, b.alternative(p))
	}
	if p := one(n, "tags-clause"); p != nil {
		r.Tags = b.constituentTags(p)
	}
	if p := one(n, "conditions-clause"); p != nil {
		// Each item of the list is one condition (§9).
		for _, c := range b.some(p, "implication", 1) {
			r.Conditions = append(r.Conditions, b.implication(c))
		}
	}
	if p := one(n, "emits-clause"); p != nil {
		r.Emit = b.emission(p)
	}
	r.Opaque = one(n, "opaque-clause") != nil
	flattenGroups(r)
	// The definition as a whole (§9), reported at the rule.
	if msg := definitionProblem(r); msg != "" {
		if b.deferEmission && deferredEmissionProblem(msg) {
			r.deferredEmission = msg
		} else {
			b.fail(definer, "%s", msg)
		}
	}
	return r
}

func (b *domBuilder) alternative(n *Node) *domAlt {
	a := &domAlt{Guards: []domGuard{}}
	b.captureNodes = map[*domExpr]*Node{}
	for _, p := range ofRule(n, "guard") {
		// A guard's token is its spelling: f? or ¬f? for a gate, f! for a
		// warning (§9).
		g := b.text(b.token(p))
		kind := FeatureGate
		if strings.HasSuffix(g, "!") {
			kind = FeatureWarning
		}
		neg := strings.HasPrefix(g, "¬")
		name := strings.TrimSuffix(strings.TrimSuffix(strings.TrimPrefix(g, "¬"), "?"), "!")
		a.Guards = append(a.Guards, domGuard{Feature: name, Kind: kind, Negated: neg})
	}
	if n.Rule == "ranked-alternative" {
		a.Expr = b.expr(b.only(n, "ranked-choice"))
	} else {
		a.Expr = b.exprIn(b.only(n, "conjunction"), true)
	}
	// A name stands at most once in each production, gates aside: the
	// error stands at the second capture that such a production reads, the
	// first in the text where there are several (engine §3.5, §9).
	if twice := duplicateCaptures(a.Expr); len(twice) > 0 {
		var first *Node
		for c := range twice {
			node := b.captureNodes[c]
			if first == nil || before(b.at(node), b.at(first)) {
				first = node
			}
		}
		b.fail(first, "the capture %s is read twice by one production of the alternative", b.text(b.token(first)))
	}
	if p := one(n, "alternative-tags"); p != nil {
		a.Tags = b.constituentTags(p)
	}
	return a
}

// constituentTags reads a rule's or an alternative's tag term, which cannot
// be made of the tags it defines: tags($) or classes($) (§9).
func (b *domBuilder) constituentTags(n *Node) *domTerm {
	t := b.tagTerm(b.only(n, "term"))
	if readsOwnTags(t) {
		b.fail(n, "a constituent's tags cannot be made of its own tags, tags($) or classes($)")
	}
	return t
}

// tagTerm reads a whole term that must be a tag set: a constituent's or an
// item's tags (§10). The error stands at the term.
func (b *domBuilder) tagTerm(n *Node) *domTerm {
	t := b.value(n)
	if f := tagTermFault(t, nil); f != nil {
		b.fail(n, "%s", f.problem)
	}
	return t
}

// before says whether a position comes before another in the document.
func before(a, c [2]int) bool {
	return a[0] < c[0] || (a[0] == c[0] && a[1] < c[1])
}

// comparator is a test's comparator, its tokens: =, ≠, ⊇ or ⊉, or ∩ and
// =∅ or ≠∅ around the operand.
func (b *domBuilder) comparator(testNode *Node) string {
	var op strings.Builder
	for _, p := range parts(testNode) {
		if p.Kind == KindToken {
			op.WriteString(b.text(p))
		}
	}
	return op.String()
}

// capturedRules are the rules of the symbols a capture can wrap (engine §9).
var capturedRules = map[string]bool{
	"reference": true, "tag": true, "character": true, "phoneme": true, "range": true, "property": true, "tested": true,
}

// firstOfRule is the first node of a rule at or below a node, in the order
// written, or nil.
func firstOfRule(n *Node, name string) *Node {
	stack := []*Node{n}
	for len(stack) > 0 {
		if w := work.Load(); w != nil {
			w.readerSteps.add("reader steps")
		}
		n := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if n.Kind == KindRule && n.Rule == name {
			return n
		}
		ps := parts(n)
		for i := len(ps) - 1; i >= 0; i-- {
			stack = append(stack, ps[i])
		}
	}
	return nil
}

// readRange reads a range's two ends, each a character tag in its canonical
// spelling; its start must not be above its end (engine §1, §9).
func (b *domBuilder) readRange(n *Node) [2]string {
	var ends []string
	for _, c := range b.some(n, "character", 2)[:2] {
		ends = append(ends, b.tagOf(b.token(c)))
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

func isSpanTerm(t *domTerm) bool {
	return t.Kind == tmCapture || (t.Kind == tmCall && isSpanFunction(t.Str))
}

// isStringTerm says whether a term, not a rule, is a string (§10). A
// constant's type is known only when the loader stitches the stage.
func (b *domBuilder) isStringTerm(t *domTerm) bool {
	if t.Kind == tmRule {
		return false
	}
	ty, problem := b.typeOf(t)
	return problem == "" && (ty == tyString || ty == tyAny)
}

// notationFunctions are the functions of the notation (§10).
var notationFunctions = map[string]bool{
	"phonemes": true, "text": true, "split": true, "tag": true, "tags": true, "classes": true, "classify": true, "head": true, "tail": true,
	"last": true, "from": true, "after": true, "matches": true, "begins": true, "initial": true,
}

// typeOf is a term's type, or why its parts do not agree, through the
// reader's memo.
func (b *domBuilder) typeOf(t *domTerm) (termType, string) {
	ty, f := termTypeMemo(t, nil, b.types)
	if f != nil {
		return 0, f.problem
	}
	return ty, ""
}

func (b *domBuilder) emission(n *Node) *domEmit {
	first := n
	e := &domEmit{}
	whole := 0
	// %emits ε emits nothing, and the constituent does not count.
	var items []*Node
	empty := false
	for _, p := range parts(n) {
		if p.Kind == KindToken && b.text(p) == "ε" {
			empty = true
		}
	}
	if !empty {
		items = b.some(n, "emit-item", 1)
	}
	for _, item := range items {
		it := &domEmitItem{}
		target := b.symbolPart(b.only(item, "emit-target"))
		tagsNode := one(item, "emit-tags")
		before, after := ofRule(item, "emit-before"), ofRule(item, "emit-after")
		// Errors of the item stand at the item, whose first part can be an
		// attachment (engine §9).
		text := b.text(target)
		switch {
		case target.Kind == KindRule && (target.Rule == "range" || target.Rule == "property"):
			b.fail(item, "an inserted item is one tag, not a range or a property")
		case strings.HasPrefix(text, "$"):
			it.Capture = text[1:]
			if it.Capture == "" {
				whole++
			}
		case strings.HasPrefix(text, "~"), strings.HasPrefix(text, "/"), strings.HasPrefix(text, "'"):
			// An inserted tag is a single tag literal (§9).
			it.IsInsert, it.Insert = true, b.tagOf(target)
		case isCapital(text):
			it.IsInsert, it.Insert = true, text
		default:
			b.fail(item, "%s names a rule; an inserted tag is a tag literal, such as ~%s", text, text)
		}
		if tagsNode != nil {
			if it.IsInsert {
				b.fail(item, "an inserted tag takes no tags")
			}
			it.Tags = b.tagTerm(b.only(tagsNode, "term"))
			if it.Tags.Kind == tmEmptySet {
				b.fail(item, "<∅> emits a token no terminal can read; %%emits ε emits nothing")
			}
		}
		// Attachments: named captures in parentheses, before the item and
		// after it, carried only by a named capture (engine §9, §11).
		for _, a := range before {
			it.Before = append(it.Before, b.attachment(a))
		}
		for _, a := range after {
			it.After = append(it.After, b.attachment(a))
		}
		if len(it.Before)+len(it.After) > 0 {
			if it.IsInsert {
				b.fail(item, "an inserted tag carries no attachments")
			}
			if it.Capture == "" {
				b.fail(item, "$ carries no attachments; name a capture")
			}
		}
		e.Items = append(e.Items, it)
	}
	if whole > 0 && whole != len(e.Items) {
		b.fail(first, "$ is used with items other than $")
	}
	// A capture stands once in an emission, as an item or as an attachment.
	listed := map[string]bool{}
	for _, it := range e.Items {
		if it.IsInsert || it.Capture == "" {
			continue
		}
		for _, name := range it.captures() {
			if listed[name] {
				b.fail(first, "an emission lists $%s twice", name)
			}
			listed[name] = true
		}
	}
	return e
}

// attachment is an attachment's capture, by its name without $: never $
// itself (engine §9).
func (b *domBuilder) attachment(n *Node) string {
	for _, p := range parts(n) {
		if p.Kind == KindToken {
			if text := b.text(p); strings.HasPrefix(text, "$") {
				if text == "$" {
					break
				}
				return text[1:]
			}
		}
	}
	b.fail(n, "an attachment holds a named capture, not $")
	return ""
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
	default:
		if !names {
			return "%" + name + " takes names only"
		}
	}
	return ""
}

// flattenGroups folds each any that stands directly in an any, and each
// all in an all, into the one around it, in place: a group in parentheses
// of the same connective is part of the one around it (§9). One walk, with
// an explicit stack, that gathers each folded list once.
func flattenGroups(r *domRule) {
	var conds []*domCond
	var terms []*domTerm
	push := func(t *domTerm) {
		if t != nil {
			terms = append(terms, t)
		}
	}
	conds = append(conds, r.Conditions...)
	push(r.Tags)
	for _, a := range r.Alternatives {
		push(a.Tags)
	}
	if r.Emit != nil {
		for _, it := range r.Emit.Items {
			push(it.Tags)
		}
	}
	for len(conds) > 0 || len(terms) > 0 {
		if w := work.Load(); w != nil {
			w.readerSteps.add("reader steps")
		}
		if len(terms) > 0 {
			t := terms[len(terms)-1]
			terms = terms[:len(terms)-1]
			terms = append(terms, t.Items...)
			if t.Cond != nil {
				conds = append(conds, t.Cond)
			}
			continue
		}
		c := conds[len(conds)-1]
		conds = conds[:len(conds)-1]
		if c.Kind == cdAny || c.Kind == cdAll {
			var joined []*domCond
			pending := make([]*domCond, 0, len(c.Items))
			for i := len(c.Items) - 1; i >= 0; i-- {
				pending = append(pending, c.Items[i])
			}
			for len(pending) > 0 {
				if w := work.Load(); w != nil {
					w.readerSteps.add("reader steps")
				}
				it := pending[len(pending)-1]
				pending = pending[:len(pending)-1]
				if it.Kind == c.Kind {
					for i := len(it.Items) - 1; i >= 0; i-- {
						pending = append(pending, it.Items[i])
					}
				} else {
					joined = append(joined, it)
				}
			}
			c.Items = joined
		}
		conds = append(conds, c.Items...)
		if c.Inner != nil {
			conds = append(conds, c.Inner)
		}
		for _, t := range []*domTerm{c.Left, c.Right, c.Span} {
			push(t)
		}
	}
}
