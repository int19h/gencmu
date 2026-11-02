package gencmu

import (
	"encoding/json"
	"fmt"
	"regexp"
	"slices"
	"strings"
)

// domFormat is the version of the grammar DOM (docs/output.md).
const domFormat = 42

// The grammar DOM: what reading one grammar document produces (engine §8,
// §9), and what data/preparsed/gencmu.json and data/preparsed/FAMILY.json hold.
type domDoc struct {
	unresolved        bool
	namesDependencies map[string]string
	Rules             []*domRule
	Directives        []*domDirective
	Constants         []*domConst
	Classifiers       []*domClassifier
	Implications      []*domImplication
}

// domClassifier is a %classifier item (engine §2): its name, which begins
// with a lower-case letter, and its entries as written. The DOM never holds
// the classifier's value, which depends on the features.
type domClassifier struct {
	Name    string
	Entries []*domEntry
	At      [2]int
}

// domEntry holds a classifier entry's gates, exact scalar string keys,
// operator, class, and source position.
// The class starts and ends with an uppercase ASCII letter.
type domEntry struct {
	Guards   []domGuard
	Keys     []string
	KeyTerms []*domTerm
	Op       string
	Class    string
	At       [2]int
}

// domImplication is %implies If ⟹ Then (engine §2, §11): two closed terms
// whose type is a tag set.
type domImplication struct {
	If, Then *domTerm
	At       [2]int
}

// domConst is a constant's definition (engine §2): %const, "define", or
// %redefine-const, "redefine", its name without $, and its value, a closed
// term. The DOM never holds the value the loader gives the constant.
type domConst struct {
	Name  string
	Op    string
	Value *domTerm
	At    [2]int
}

type domRule struct {
	Params           []string
	Args             []*domArgument
	Instance         *domSourceCall
	deferredEmission *definitionIssue
	Name             string
	Categories       []string // the names of its %counts-as clause (engine §2)
	Op               string   // "define", "redefine" or "extend"
	Tags             *domTerm
	Value, Image     *domTerm
	Alternatives     []*domAlt
	Emit             *domEmit
	Conditions       []*domCond
	Erased           bool
	At               [2]int
}

type domAlt struct {
	rankedLocations map[string][2]int
	Guards          []domGuard
	Expr            *domExpr
	Tags            *domTerm
	Value, Image    *domTerm
}

// domGuard is a gate, f? or ¬f?, or a warning, f!, which is never negated
// (engine §9).
type domGuard struct {
	Feature string
	Kind    string // FeatureGate or FeatureWarning
	Negated bool
}

// Expression kinds.
const (
	exSeq      = "seq"
	exChoice   = "choice"
	exRanked   = "ranked"
	exAnd      = "and"
	exOptional = "optional"
	exRepeat   = "repeat"
	exRef      = "ref"
	exCapture  = "capture"
	exTest     = "test"
	exEmpty    = "empty"
	exRange    = "range"
	exLiteral  = "literal"
	exWildcard = "wildcard"
	exParam    = "param"
	exCall     = "call"
)

type domExpr struct {
	At       [2]int
	RankedAt [2]int
	Call     *domSourceCall
	Kind     string
	Items    []*domExpr // seq, choice, and
	Inner    *domExpr   // optional, repeat (its item), capture, test (its symbol)
	// Sep is a repeat's separator, or nil; Chain is "left" or "right" for
	// a chain, "" for flat braces (engine §3.2, §3.3).
	Sep          *domExpr
	Chain        string
	Elidable     bool
	Default      *domTerm
	DefaultAt    [2]int
	Name         string   // ref or capture name
	Op           string   // test: its comparator, one of testOps
	Value        *domTerm // test: its value, a closed term
	Ends         [2]*domTerm
	Requirements []tagRequirement
}

type tagRequirement struct {
	Negated bool
	Value   *domTerm
}

// testOps are the two value comparators and signed tag requirements (§4).
var testOps = map[string]bool{"=": true, "≠": true, "tags": true}

// isValueTest identifies equality and inequality of stored strings (§4).
func isValueTest(op string) bool {
	return op == "=" || op == "≠"
}

// Term kinds. A string is tmString, and a tag literal tmTag, the tag in its
// canonical spelling. A span is a term of kind tmCapture, "" for $, the
// whole constituent, or a tmCall of a span method (§10). A rule
// argument is tmRule, and the classifier that classify names is
// tmClassifier. A difference, a ∖ b, has exactly two items. A guarded
// term, A ⟹ t, is tmIf: Cond is A, and Items holds t alone.
// A reference to a constant is
// tmConst, its name without $ in Str and its position in At.
const (
	tmString       = "string"
	tmTag          = "tag"
	tmEmptySet     = "emptySet"
	tmUnion        = "union"
	tmIntersection = "intersection"
	tmDifference   = "difference"
	tmCall         = "call"
	tmCapture      = "capture"
	tmRule         = "rule"
	tmClassifier   = "classifier"
	tmTerminal     = "terminal"
	tmInteger      = "integer"
	tmIf           = "if"
	tmConst        = "const"
	tmPattern      = "pattern"
	tmConcat       = "concat"
	tmParam        = "param"
	tmSourceCall   = "source-call"
)

type domTerm struct {
	Call  *domSourceCall
	Kind  string
	Str   string     // string, tag, call (the function), capture, rule, classifier
	Items []*domTerm // union, intersection, difference, call arguments; if: its term
	Cond  *domCond   // if: its condition
	At    [2]int     // const: the position of the reference
	// value is a constant's final value in its stage, which only a
	// stitched grammar's copy of the reference holds (engine §2).
	value   *constValue
	Pattern *domPattern
}

// isSpanFunction says whether a function gives a span (engine §10).
func isSpanFunction(name string) bool {
	switch name {
	case "first-token", "tokens-after-first", "last-token", "onward", "following-tokens", "preceding-tokens", "without-elision", "without-elision-except":
		return true
	}
	return false
}

// Condition kinds. A presence test $x is cdCaptured, its name in Rule, ""
// for $; A ⟹ B is cdIf, its Items A and B.
const (
	cdCompare  = "compare"
	cdMatches  = "matches"
	cdBegins   = "begins"
	cdEnds     = "ends"
	cdInitial  = "initial"
	cdEnd      = "ends-input"
	cdBoundary = "boundary"
	cdNot      = "not"
	cdAny      = "any"
	cdAll      = "all"
	cdCaptured = "captured"
	cdIf       = "if"
)

type domCond struct {
	Targets     []*domTerm
	At          [2]int
	Kind        string
	Op          string
	Left, Right *domTerm
	Span        *domTerm // The receiver of a predicate method.
	Capture     string   // The name in a presence test.
	Inner       *domCond
	Items       []*domCond
}

// domEmit holds the items of a %emits clause. Erasure uses the separate rule field erased.
type domEmit struct {
	Items []*domEmitItem
}

// domEmitItem is a capture, "" for $, or an inserted item, with optional clauses.
// A named capture, the item's carrier, can name attachment captures before
// it and after it (engine §11).
type domEmitItem struct {
	Capture      string
	IsInsert     bool
	Tags         *domTerm
	Value, Image *domTerm
	Before       []string
	After        []string
}

// captures lists a named capture item's captures in written order: its
// before-attachments, its carrier and its after-attachments.
func (it *domEmitItem) captures() []string {
	out := make([]string, 0, len(it.Before)+1+len(it.After))
	out = append(out, it.Before...)
	out = append(out, it.Capture)
	return append(out, it.After...)
}

// attachments lists an item's attachment captures, before and after.
func (it *domEmitItem) attachments() []string {
	return append(append([]string(nil), it.Before...), it.After...)
}

type domDirective struct {
	Conditions []*domCond
	Name       string
	// Args are the operands, which %ambiguity-resolution lacks: it has
	// Steps instead (engine §9).
	Args  []string
	Steps []domStep
	At    [2]int
}

// domStep is a step of %ambiguity-resolution: a key step, which compares
// the occurrences of its category, or a lean, which has no category
// (engine §6).
type domStep struct {
	Step        string
	Category    string
	HasCategory bool
}

// The steps of %ambiguity-resolution that take a category, and those that
// compare actions (engine §6).
var (
	keySteps = map[string]bool{"leftmost-longest": true, "fewest": true, "most": true, "late": true, "early": true}
	leans    = map[string]bool{"greedy": true, "lazy": true}
)

// categoryName is the form of a category name of a %counts-as clause
// (engine §9.1).
var categoryName = regexp.MustCompile(`^[a-z][a-z0-9-]*$`)

// validSteps says whether steps is a well-formed list of ranking steps: one
// or more, each a key step with a category or a lean, with a lean only last
// (engine §9.3).
func validSteps(steps []domStep) bool {
	if len(steps) == 0 {
		return false
	}
	for i, step := range steps {
		if leans[step.Step] {
			if i != len(steps)-1 || step.HasCategory {
				return false
			}
			continue
		}
		if !keySteps[step.Step] || !step.HasCategory || !categoryName.MatchString(step.Category) {
			return false
		}
	}
	return true
}

// validCategories says whether categories is a well-formed list of a rule's
// categories: distinct category names other than elision (engine §9.3).
func validCategories(categories []string) bool {
	for i, name := range categories {
		if !categoryName.MatchString(name) || name == "elision" || slices.Contains(categories[:i], name) {
			return false
		}
	}
	return true
}

// ---- writing

func (d *domDoc) writeJSON(w *jsonWriter) {
	w.raw(`{"format":`)
	w.int(domFormat)
	w.raw(`,"rules":[`)
	for i, r := range d.Rules {
		if i > 0 {
			w.raw(",")
		}
		r.writeJSON(w)
	}
	w.raw(`],"directives":[`)
	for i, dir := range d.Directives {
		if i > 0 {
			w.raw(",")
		}
		w.raw(`{"name":`)
		w.str(dir.Name)
		if dir.Name == "ambiguity-resolution" {
			w.raw(`,"steps":[`)
			for j, step := range dir.Steps {
				if j > 0 {
					w.raw(",")
				}
				w.raw(`{"step":`)
				w.str(step.Step)
				if step.HasCategory {
					w.raw(`,"category":`)
					w.str(step.Category)
				}
				w.raw("}")
			}
			w.raw("]")
		} else {
			w.raw(`,"args":[`)
			for j, a := range dir.Args {
				if j > 0 {
					w.raw(",")
				}
				w.str(a)
			}
			w.raw("]")
		}
		w.raw(`,"at":`)
		w.pair(dir.At)
		if dir.Conditions != nil {
			w.raw(`,"conditions":[`)
			for i, condition := range dir.Conditions {
				if i > 0 {
					w.raw(",")
				}
				condition.writeJSON(w)
			}
			w.raw("]")
		}
		w.raw("}")
	}
	w.raw(`],"constants":[`)
	for i, k := range d.Constants {
		if i > 0 {
			w.raw(",")
		}
		w.raw(`{"name":`)
		w.str(k.Name)
		w.raw(`,"op":`)
		w.str(k.Op)
		w.raw(`,"value":`)
		k.Value.writeJSON(w)
		w.raw(`,"at":`)
		w.pair(k.At)
		w.raw("}")
	}
	w.raw(`],"classifiers":[`)
	for i, c := range d.Classifiers {
		if i > 0 {
			w.raw(",")
		}
		w.raw(`{"name":`)
		w.str(c.Name)
		w.raw(`,"entries":[`)
		for j, e := range c.Entries {
			if j > 0 {
				w.raw(",")
			}
			w.raw(`{"guards":`)
			writeGuards(w, e.Guards)
			w.raw(`,"keys":[`)
			for k, key := range e.KeyTerms {
				if k > 0 {
					w.raw(",")
				}
				key.writeJSON(w)
			}
			w.raw(`],"op":`)
			w.str(e.Op)
			w.raw(`,"class":`)
			w.str(e.Class)
			w.raw(`,"at":`)
			w.pair(e.At)
			w.raw("}")
		}
		w.raw(`],"at":`)
		w.pair(c.At)
		w.raw("}")
	}
	w.raw(`],"implications":[`)
	for i, m := range d.Implications {
		if i > 0 {
			w.raw(",")
		}
		w.raw(`{"if":`)
		m.If.writeJSON(w)
		w.raw(`,"then":`)
		m.Then.writeJSON(w)
		w.raw(`,"at":`)
		w.pair(m.At)
		w.raw("}")
	}
	w.raw("]}")
}

// writeGuards writes a list of guards, as an alternative or an entry of a
// classifier holds them.
func writeGuards(w *jsonWriter, guards []domGuard) {
	w.raw("[")
	for j, g := range guards {
		if j > 0 {
			w.raw(",")
		}
		w.raw(`{"feature":`)
		w.str(g.Feature)
		w.raw(`,"kind":`)
		w.str(g.Kind)
		w.raw(`,"negated":`)
		w.bool(g.Negated)
		w.raw("}")
	}
	w.raw("]")
}

func (r *domRule) writeJSON(w *jsonWriter) {
	w.raw(`{"name":`)
	w.str(r.Name)
	if r.Params != nil {
		w.raw(`,"params":[`)
		for i, name := range r.Params {
			if i > 0 {
				w.raw(",")
			}
			w.str(name)
		}
		w.raw("]")
	}
	if r.Args != nil {
		w.raw(`,"args":`)
		writeSourceArguments(w, r.Args)
	}
	w.raw(`,"op":`)
	w.str(r.Op)
	w.raw(`,"categories":[`)
	for i, category := range r.Categories {
		if i > 0 {
			w.raw(",")
		}
		w.str(category)
	}
	w.raw("]")
	if r.Instance != nil {
		w.raw(`,"instance":`)
		r.Instance.writeJSON(w)
		w.raw(`,"conditions":[],"at":`)
		w.pair(r.At)
		w.raw("}")
		return
	}
	if r.Tags != nil {
		w.raw(`,"tags":`)
		r.Tags.writeJSON(w)
	}
	writeRecipes(w, r.Value, r.Image)
	w.raw(`,"alternatives":[`)
	for i, a := range r.Alternatives {
		if i > 0 {
			w.raw(",")
		}
		w.raw(`{"guards":`)
		writeGuards(w, a.Guards)
		w.raw(`,"expr":`)
		a.Expr.writeJSON(w)
		if a.Tags != nil {
			w.raw(`,"tags":`)
			a.Tags.writeJSON(w)
		}
		writeRecipes(w, a.Value, a.Image)
		w.raw("}")
	}
	w.raw("]")
	if r.Emit != nil {
		w.raw(`,"emit":`)
		r.Emit.writeJSON(w)
	}
	w.raw(`,"conditions":[`)
	for i, c := range r.Conditions {
		if i > 0 {
			w.raw(",")
		}
		c.writeJSON(w)
	}
	w.raw("]")
	if r.Erased {
		w.raw(`,"erased":true`)
	}
	w.raw(`,"at":`)
	w.pair(r.At)
	w.raw("}")
}

func (e *domExpr) writeJSON(w *jsonWriter) {
	switch e.Kind {
	case exParam:
		writeParameter(w, e.Name, e.At)
	case exCall:
		e.Call.writeJSON(w)
	case exSeq, exChoice, exRanked, exAnd:
		w.raw("{")
		w.str(e.Kind)
		w.raw(":[")
		for i, it := range e.Items {
			if i > 0 {
				w.raw(",")
			}
			it.writeJSON(w)
		}
		w.raw("]}")
	case exOptional:
		w.raw(`{"optional":`)
		e.Inner.writeJSON(w)
		if e.Elidable {
			w.raw(`,"elidable":true`)
		}
		if e.Default != nil {
			w.raw(`,"default":`)
			e.Default.writeJSON(w)
		}
		w.raw("}")
	case exRepeat:
		w.raw(`{"repeat":`)
		e.Inner.writeJSON(w)
		if e.Sep != nil {
			w.raw(`,"separator":`)
			e.Sep.writeJSON(w)
		}
		if e.Chain != "" {
			w.raw(`,"chain":`)
			w.str(e.Chain)
		}
		w.raw("}")
	case exRef:
		w.raw("{")
		w.str("ref")
		w.raw(":")
		w.str(e.Name)
		w.raw("}")
	case exCapture:
		w.raw(`{"capture":`)
		w.str(e.Name)
		w.raw(`,"expr":`)
		e.Inner.writeJSON(w)
		w.raw("}")
	case exLiteral:
		w.raw(`{"literal":`)
		e.Value.writeJSON(w)
		w.raw("}")
	case exWildcard:
		w.raw(`{"wildcard":true}`)
	case exTest:
		w.raw(`{"test":`)
		w.str(e.Op)
		if e.Op == "tags" {
			w.raw(`,"requirements":`)
			writeRequirements(w, e.Requirements)
		} else {
			w.raw(`,"value":`)
			e.Value.writeJSON(w)
		}
		w.raw(`,"expr":`)
		e.Inner.writeJSON(w)
		w.raw("}")
	case exEmpty:
		w.raw(`{"empty":true}`)
	case exRange:
		writeStringRange(w, e.Ends)
	}
}

func (t *domTerm) writeJSON(w *jsonWriter) {
	switch t.Kind {
	case tmParam:
		writeParameter(w, t.Str, t.At)
	case tmSourceCall:
		t.Call.writeJSON(w)
	case tmPattern:
		w.raw(`{"pattern":`)
		w.pattern(t.Pattern)
		w.raw("}")
	case tmString, tmTag, tmCapture, tmRule, tmClassifier, tmTerminal, tmInteger:
		w.raw("{")
		w.str(t.Kind)
		w.raw(":")
		w.str(t.Str)
		w.raw("}")
	case tmEmptySet:
		w.raw(`{"emptySet":true}`)
	case tmConst:
		w.raw(`{"const":`)
		w.str(t.Str)
		w.raw(`,"at":`)
		w.pair(t.At)
		w.raw("}")
	case tmUnion, tmIntersection, tmDifference, tmConcat:
		w.raw("{")
		w.str(t.Kind)
		w.raw(":[")
		for i, it := range t.Items {
			if i > 0 {
				w.raw(",")
			}
			it.writeJSON(w)
		}
		w.raw("]}")
	case tmCall:
		w.raw(`{"method":`)
		w.str(t.Str)
		w.raw(`,"receiver":`)
		t.Items[0].writeJSON(w)
		w.raw(`,"args":[`)
		for i, it := range t.Items[1:] {
			if i > 0 {
				w.raw(",")
			}
			it.writeJSON(w)
		}
		w.raw("]}")
	case tmIf:
		w.raw(`{"if":`)
		t.Cond.writeJSON(w)
		w.raw(`,"then":`)
		t.Items[0].writeJSON(w)
		w.raw("}")
	}
}

func (c *domCond) writeJSON(w *jsonWriter) {
	switch c.Kind {
	case cdCompare:
		w.raw(`{"op":`)
		w.str(c.Op)
		w.raw(`,"left":`)
		c.Left.writeJSON(w)
		w.raw(`,"right":`)
		c.Right.writeJSON(w)
		w.raw("}")
	case cdMatches, cdBegins, cdEnds, cdInitial, cdEnd, cdBoundary:
		name := c.Kind
		if name == cdInitial {
			name = "starts-input"
		}
		t := &domTerm{Kind: tmCall, Str: name, Items: []*domTerm{c.Span}}
		if c.Kind == cdBoundary {
			t.Str = c.Op
			t.Items = append(t.Items, c.Targets...)
		} else if c.Kind != cdInitial && c.Kind != cdEnd {
			t.Items = append(t.Items, c.queryTargets()...)
		}
		t.writeJSON(w)
	case cdNot:
		w.raw(`{"not":`)
		c.Inner.writeJSON(w)
		w.raw("}")
	case cdCaptured:
		w.raw(`{"captured":`)
		w.str(c.Capture)
		w.raw("}")
	case cdIf:
		w.raw(`{"if":`)
		c.Items[0].writeJSON(w)
		w.raw(`,"then":`)
		c.Items[1].writeJSON(w)
		w.raw("}")
	case cdAny, cdAll:
		w.raw("{")
		w.str(c.Kind)
		w.raw(":[")
		for i, it := range c.Items {
			if i > 0 {
				w.raw(",")
			}
			it.writeJSON(w)
		}
		w.raw("]}")
	}
}

func (e *domEmit) writeJSON(w *jsonWriter) {
	w.raw(`{"items":[`)
	for i, it := range e.Items {
		if i > 0 {
			w.raw(",")
		}
		switch {
		case it.IsInsert:
			w.raw(`{"insert":`)
			w.raw("true")
		default:
			w.raw(`{"capture":`)
			w.str(it.Capture)
		}
		if it.Tags != nil {
			w.raw(`,"tags":`)
			it.Tags.writeJSON(w)
		}
		writeRecipes(w, it.Value, it.Image)
		for _, side := range []struct {
			key   string
			names []string
		}{{"before", it.Before}, {"after", it.After}} {
			if len(side.names) == 0 {
				continue
			}
			w.raw(`,"` + side.key + `":[`)
			for j, name := range side.names {
				if j > 0 {
					w.raw(",")
				}
				w.str(name)
			}
			w.raw("]")
		}
		w.raw("}")
	}
	w.raw("]}")
}

func (d *domDoc) json() []byte {
	var w jsonWriter
	d.writeJSON(&w)
	return w.buf
}

// ---- reading

// errTooDeep is the shared depth diagnostic after constructor inspection.
var errTooDeep = fmt.Errorf("an expression, term or condition is nested more than %d deep", maxDOMDepth)

const maxDOMPosition = 9007199254740991

type jobj map[string]json.RawMessage

func decodeObj(raw json.RawMessage) (jobj, error) {
	// The bytes are charged in one sum before the call, since
	// encoding/json reads them where no count can reach. Counting each
	// byte would mean a decoder of our own, whose errors would differ.
	// The charge is the input of the call, not the size of its result.
	if w := work.Load(); w != nil {
		w.decodeSteps.addN(int64(len(raw)), "decoded bytes")
	}
	var o jobj
	if err := json.Unmarshal(raw, &o); err != nil {
		return nil, err
	}
	if o == nil {
		return nil, fmt.Errorf("expected an object")
	}
	return o, nil
}

// decodeDOM reads a DOM that did not come from reading its document and
// validates it; uni supplies the configured Unicode data for its string
// tests are checked against (engine §9).
func decodeDOM(raw json.RawMessage, uni *unicodeTable) (*domDoc, error) {
	return decodeDOMMode(raw, uni, false)
}
func decodeDOMMode(raw json.RawMessage, uni *unicodeTable, expanded bool) (*domDoc, error) {
	dc := &domDecoder{}
	parser := jsonDecoder{data: raw, numbers: true}
	node, err := parser.document(nil)
	if err != nil {
		return nil, err
	}
	if w := work.Load(); w != nil {
		w.decodeSteps.addN(int64(len(raw)), "decoded bytes")
	}
	{
		// Unknown directive members carry no grammar nodes.
		for _, directive := range templateList(templateObj(node)["directives"]) {
			for key := range templateObj(directive) {
				switch key {
				case "name", "args", "steps", "conditions", "at":
				default:
					delete(templateObj(directive), key)
				}
			}
		}
		var roots []any
		for _, key := range []string{"rules", "directives", "constants", "classifiers", "implications"} {
			roots = append(roots, templateObj(node)[key])
		}
		for _, part := range templateNodes(roots) {
			if _, exists := part[templateSourceKey]; exists {
				return nil, fmt.Errorf("a reserved DOM member")
			}
			for _, field := range []string{"ref", "tag", "terminal"} {
				if name, ok := part[field].(string); ok && strings.HasPrefix(name, "_") && uni.canonicalTag(name) != name {
					return nil, fmt.Errorf("unknown, unavailable, or noncanonical engine tag")
				}
			}
		}
	}
	o, err := domObjectOf(node)
	if err != nil {
		return nil, err
	}
	if !hasOneForm(o, [][]string{{"format", "rules", "directives", "constants", "classifiers", "implications"}}) {
		return nil, fmt.Errorf("a malformed DOM envelope")
	}
	var format int
	if err := domScalar(o["format"], &format); err != nil || format != domFormat {
		return nil, fmt.Errorf("unsupported DOM format")
	}
	var rules, dirs []any
	if err := domScalar(o["rules"], &rules); err != nil {
		return nil, err
	}
	if err := domScalar(o["directives"], &dirs); err != nil {
		return nil, err
	}
	var consts, classifiers, implications []any
	if domScalar(o["constants"], &consts) != nil || domScalar(o["classifiers"], &classifiers) != nil || domScalar(o["implications"], &implications) != nil {
		return nil, fmt.Errorf("not a DOM of format %d", domFormat)
	}
	d := &domDoc{}
	for _, c := range classifiers {
		classifier, err := dc.decodeClassifier(c)
		if err != nil {
			return nil, err
		}
		d.Classifiers = append(d.Classifiers, classifier)
	}
	for _, m := range implications {
		implication, err := dc.decodeImplication(m)
		if err != nil {
			return nil, err
		}
		d.Implications = append(d.Implications, implication)
	}
	for _, k := range consts {
		constant, err := dc.decodeConst(k)
		if err != nil {
			return nil, err
		}
		d.Constants = append(d.Constants, constant)
	}
	for _, r := range rules {
		rule, err := dc.decodeRule(r)
		if err != nil {
			return nil, err
		}
		d.Rules = append(d.Rules, rule)
	}
	for _, r := range dirs {
		o, err := domObjectOf(r)
		if err != nil {
			return nil, err
		}
		name, err := domString(o["name"])
		if err != nil {
			return nil, fmt.Errorf("a malformed directive")
		}
		var args []string
		var steps []domStep
		if name == "ambiguity-resolution" {
			// The ranking directive has steps and no operands (engine §9).
			if _, ok := o["args"]; ok {
				return nil, fmt.Errorf("a malformed directive")
			}
			if steps, err = domList(o["steps"], decodeStep); err != nil {
				return nil, fmt.Errorf("a malformed directive")
			}
		} else if args, err = domList(o["args"], domString); err != nil {
			return nil, fmt.Errorf("a malformed directive")
		}
		at, err := domPosition(o["at"])
		if err != nil {
			return nil, fmt.Errorf("a malformed directive")
		}
		var conditions []*domCond
		if raw, ok := o["conditions"]; ok {
			conditions, err = domList(raw, dc.decodeCond)
			if err != nil {
				return nil, fmt.Errorf("malformed feature conditions: %w", err)
			}
		}
		d.Directives = append(d.Directives, &domDirective{Name: name, Args: args, Steps: steps, At: at, Conditions: conditions})
	}
	if err := dc.run(); err != nil {
		return nil, err
	}
	if !expanded {
		if err := validateDOM(d, uni); err != nil {
			return nil, err
		}
	}
	return d, nil
}

// decodeStep reads a step of %ambiguity-resolution, an object with a
// step and, for a key step, a category.
func decodeStep(raw any) (domStep, error) {
	o, err := domObjectOf(raw)
	if err != nil {
		return domStep{}, err
	}
	var step domStep
	for key, value := range o {
		switch key {
		case "step":
			step.Step, err = domString(value)
		case "category":
			step.Category, err = domString(value)
			step.HasCategory = true
		}
		if err != nil {
			return domStep{}, err
		}
	}
	if _, ok := o["step"]; !ok {
		return domStep{}, fmt.Errorf("a malformed directive")
	}
	return step, nil
}

// decodeConst reads a constant's definition, which has exactly its name,
// its op, its value and its position.
func (dc *domDecoder) decodeConst(raw any) (*domConst, error) {
	o, err := domObjectOf(raw)
	malformed := fmt.Errorf("a malformed constant")
	if err != nil || len(o) != 4 || o["value"] == nil {
		return nil, malformed
	}
	k := &domConst{}
	if k.Name, err = domString(o["name"]); err != nil {
		return nil, malformed
	}
	if k.Op, err = domString(o["op"]); err != nil {
		return nil, malformed
	}
	if k.At, err = domPosition(o["at"]); err != nil {
		return nil, malformed
	}
	if k.Value, err = dc.decodeTerm(o["value"]); err != nil {
		return nil, err
	}
	return k, nil
}

// decodeClassifier reads a classifier, which has exactly its name, its
// entries and its position. Each entry has exactly its guards, its keys,
// its operator, its class and its position; the checker holds them to the
// reader's rules.
func (dc *domDecoder) decodeClassifier(raw any) (*domClassifier, error) {
	o, err := domObjectOf(raw)
	malformed := fmt.Errorf("a malformed classifier")
	if err != nil || len(o) != 3 {
		return nil, malformed
	}
	c := &domClassifier{}
	if c.Name, err = domString(o["name"]); err != nil {
		return nil, malformed
	}
	if c.At, err = domPosition(o["at"]); err != nil {
		return nil, malformed
	}
	if c.Entries, err = domList(o["entries"], dc.decodeEntry); err != nil {
		return nil, err
	}
	return c, nil
}

func (dc *domDecoder) decodeEntry(raw any) (*domEntry, error) {
	o, err := domObjectOf(raw)
	malformed := fmt.Errorf("a malformed entry of a classifier")
	if err != nil || len(o) != 5 {
		return nil, malformed
	}
	e := &domEntry{}
	if e.Guards, err = dc.decodeGuards(o["guards"]); err != nil {
		return nil, malformed
	}
	if e.KeyTerms, err = domList(o["keys"], dc.decodeTerm); err != nil {
		return nil, malformed
	}
	if e.Op, err = domString(o["op"]); err != nil {
		return nil, malformed
	}
	if e.Class, err = domString(o["class"]); err != nil {
		return nil, malformed
	}
	if e.At, err = domPosition(o["at"]); err != nil {
		return nil, malformed
	}
	return e, nil
}

// decodeImplication reads an implication, which has exactly its two sides
// and its position.
func (dc *domDecoder) decodeImplication(raw any) (*domImplication, error) {
	o, err := domObjectOf(raw)
	malformed := fmt.Errorf("a malformed implication")
	if err != nil || len(o) != 3 || o["if"] == nil || o["then"] == nil {
		return nil, malformed
	}
	m := &domImplication{}
	if m.At, err = domPosition(o["at"]); err != nil {
		return nil, malformed
	}
	if m.If, err = dc.decodeTerm(o["if"]); err != nil {
		return nil, err
	}
	if m.Then, err = dc.decodeTerm(o["then"]); err != nil {
		return nil, err
	}
	return m, nil
}

// decodeGuards reads a list of guards, each with exactly its feature, its
// kind and whether it is negated.
func (dc *domDecoder) decodeGuards(raw any) ([]domGuard, error) {
	var items []any
	if err := domScalar(raw, &items); err != nil {
		return nil, fmt.Errorf("a malformed guard")
	}
	guards := []domGuard{}
	for _, it := range items {
		o, err := domObjectOf(it)
		if err != nil || len(o) != 3 {
			return nil, fmt.Errorf("a malformed guard")
		}
		var g domGuard
		if domScalar(o["feature"], &g.Feature) != nil || domScalar(o["kind"], &g.Kind) != nil || domScalar(o["negated"], &g.Negated) != nil {
			return nil, fmt.Errorf("a malformed guard")
		}
		guards = append(guards, g)
	}
	return guards, nil
}

func (dc *domDecoder) decodeRule(raw any) (*domRule, error) {
	o, err := domObjectOf(raw)
	if err != nil {
		return nil, err
	}
	if !onlyMembers(o, "name", "params", "args", "instance", "op", "categories", "tags", "value", "image", "alternatives", "emit", "conditions", "erased", "at") {
		return nil, fmt.Errorf("a malformed rule")
	}
	r := &domRule{}
	if r.Name, err = domString(o["name"]); err != nil {
		return nil, err
	}
	if r.Op, err = domString(o["op"]); err != nil {
		return nil, err
	}
	if r.Categories, err = domList(o["categories"], domString); err != nil {
		return nil, fmt.Errorf("a malformed rule")
	}
	if r.At, err = domPosition(o["at"]); err != nil {
		return nil, fmt.Errorf("a malformed rule")
	}
	if _, ok := o["conditions"]; !ok {
		return nil, fmt.Errorf("a malformed rule")
	}
	if params, ok := o["params"]; ok {
		if r.Params, err = domList(params, domString); err != nil {
			return nil, err
		}
	}
	if args, ok := o["args"]; ok {
		if r.Args, err = dc.decodeSourceArguments(args, 1); err != nil {
			return nil, err
		}
	}
	if instance, ok := o["instance"]; ok {
		if !hasOneForm(o, [][]string{{"name", "op", "categories", "instance", "conditions", "at"}}) {
			return nil, fmt.Errorf("a malformed instance binding")
		}
		call, err := domObjectOf(instance)
		if err != nil {
			return nil, err
		}
		r.Instance, err = dc.decodeSourceCall(call, 0)
		if err != nil {
			return nil, err
		}
		r.Conditions, err = domList(o["conditions"], dc.decodeCond)
		return r, err
	}
	if t, ok := o["tags"]; ok {
		if r.Tags, err = dc.decodeTerm(t); err != nil {
			return nil, err
		}
	}
	if e, ok := o["emit"]; ok {
		if r.Emit, err = dc.decodeEmit(e); err != nil {
			return nil, err
		}
	}
	if v, ok := o["erased"]; ok {
		if !domTrue(v) {
			return nil, fmt.Errorf("a malformed rule")
		}
		r.Erased = true
	}
	if r.Value, r.Image, err = dc.decodeRecipes(o); err != nil {
		return nil, err
	}
	var alts, conds []any
	if err := domScalar(o["alternatives"], &alts); err != nil {
		return nil, err
	}
	if c, ok := o["conditions"]; ok {
		if !domArray(c) {
			return nil, fmt.Errorf("a malformed condition list")
		}
		if err := domScalar(c, &conds); err != nil {
			return nil, err
		}
	}
	for _, a := range alts {
		ao, err := domObjectOf(a)
		if err != nil {
			return nil, err
		}
		if !onlyMembers(ao, "guards", "expr", "tags", "value", "image") {
			return nil, fmt.Errorf("a malformed alternative")
		}
		alt := &domAlt{}
		// The guards of an alternative have the members of an entry's
		// guards. The checker holds their kinds to the reader's rules.
		if alt.Guards, err = dc.decodeGuards(ao["guards"]); err != nil {
			return nil, err
		}
		if alt.Expr, err = dc.decodeExpr(ao["expr"]); err != nil {
			return nil, err
		}
		if t, ok := ao["tags"]; ok {
			if alt.Tags, err = dc.decodeTerm(t); err != nil {
				return nil, err
			}
		}
		if alt.Value, alt.Image, err = dc.decodeRecipes(ao); err != nil {
			return nil, err
		}
		r.Alternatives = append(r.Alternatives, alt)
	}
	for _, c := range conds {
		cond, err := dc.decodeCond(c)
		if err != nil {
			return nil, err
		}
		r.Conditions = append(r.Conditions, cond)
	}
	return r, nil
}

func (dc *domDecoder) decodeExpr(raw any) (*domExpr, error) { return dc.decodeExprAt(raw, 0) }

func (dc *domDecoder) decodeExprNode(raw any, depth int) (*domExpr, error) {
	o, err := domObjectOf(raw)
	if err != nil {
		return nil, err
	}
	return dc.decodeExprObj(raw, o, depth)
}

// decodeExprObj reads an expression, raw, whose members o are decoded.
func (dc *domDecoder) decodeExprObj(raw any, o domObject, depth int) (*domExpr, error) {
	// An expression has exactly the members of one form (docs/output.md).
	if !hasOneForm(o, exprForms) {
		return nil, fmt.Errorf("a malformed expression")
	}
	if _, ok := o["param"]; ok {
		name, at, err := domParameter(o)
		return &domExpr{Kind: exParam, Name: name, At: at}, err
	}
	if _, ok := o["call"]; ok {
		call, err := dc.decodeSourceCall(o, depth)
		e := &domExpr{Kind: exCall, Call: call}
		if call != nil {
			e.At = call.At
		}
		return e, err
	}
	if v, ok := o[exRange]; ok {
		r, err := dc.decodeStringRange(v, depth)
		return &domExpr{Kind: exRange, Ends: r}, err
	}
	for _, k := range []string{exSeq, exChoice, exRanked, exAnd} {
		if v, ok := o[k]; ok {
			if k == exRanked {
				var options []any
				if domScalar(v, &options) != nil || len(options) < 2 {
					return nil, fmt.Errorf("ranked-choice-syntax: a ranked expression requires two options")
				}
			}
			items, err := domList(v, func(r any) (*domExpr, error) { return dc.decodeExprAt(r, depth+1) })
			return &domExpr{Kind: k, Items: items}, err
		}
	}
	if v, ok := o["optional"]; ok {
		inner, err := dc.decodeExprAt(v, depth+1)
		if err != nil {
			return nil, err
		}
		e := &domExpr{Kind: exOptional, Inner: inner}
		if raw, ok := o["elidable"]; ok {
			if !domTrue(raw) {
				return nil, fmt.Errorf("a malformed expression")
			}
			e.Elidable = true
		}
		if raw, ok := o["default"]; ok {
			if !e.Elidable {
				return nil, fmt.Errorf("a default requires an elidable optional")
			}
			e.Default, err = dc.decodeTerm(raw)
			if err != nil {
				return nil, err
			}
		}
		return e, nil
	}
	if v, ok := o["repeat"]; ok {
		inner, err := dc.decodeExprAt(v, depth+1)
		if err != nil {
			return nil, err
		}
		e := &domExpr{Kind: exRepeat, Inner: inner}
		if sep, ok := o["separator"]; ok {
			if e.Sep, err = dc.decodeExprAt(sep, depth+1); err != nil {
				return nil, err
			}
		}
		// A chain's direction is left or right (engine §9).
		if raw, ok := o["chain"]; ok {
			if err := domScalar(raw, &e.Chain); err != nil || (e.Chain != "left" && e.Chain != "right") {
				return nil, fmt.Errorf("a malformed expression")
			}
		}
		return e, nil
	}
	if v, ok := o["capture"]; ok {
		name, err := domString(v)
		if err != nil {
			return nil, err
		}
		inner, err := dc.decodeExprAt(o["expr"], depth+1)
		return &domExpr{Kind: exCapture, Name: name, Inner: inner}, err
	}
	if v, ok := o["test"]; ok {
		// The symbol is one reference, terminal, range or property alone,
		// so that no node reads two ways.
		op, err := domString(v)
		if err != nil {
			return nil, fmt.Errorf("a malformed test")
		}
		inner, err := dc.decodeExprAt(o["expr"], depth+1)
		if err != nil {
			return nil, err
		}
		e := &domExpr{Kind: exTest, Op: op, Inner: inner}
		if op == "tags" {
			if _, present := o["value"]; present {
				return nil, fmt.Errorf("a tag test has no value member")
			}
			e.Requirements, err = dc.decodeRequirements(o["requirements"], depth+1)
		} else {
			if _, present := o["requirements"]; present {
				return nil, fmt.Errorf("a value test has no requirement member")
			}
			e.Value, err = dc.decodeTermAt(o["value"], depth+1)
		}
		return e, err
	}
	for _, k := range []string{exRef} {
		if v, ok := o[k]; ok {
			name, err := domString(v)
			return &domExpr{Kind: k, Name: name}, err
		}
	}
	if v, ok := o["literal"]; ok {
		t, err := dc.decodeTermAt(v, depth)
		return &domExpr{Kind: exLiteral, Value: t}, err
	}
	if domTrue(o["wildcard"]) {
		return &domExpr{Kind: exWildcard}, nil
	}
	if domTrue(o["empty"]) {
		return &domExpr{Kind: exEmpty}, nil
	}
	return nil, fmt.Errorf("unknown expression %v", raw)
}

// exprForms, termForms and condForms are the forms of an expression, a
// term and a condition, each as its members (docs/output.md). The first
// member names the form. A rule argument and a classifier argument are
// forms of a term too.
var exprForms = [][]string{
	{exSeq}, {exChoice}, {exRanked}, {exAnd}, {exOptional, "elidable?", "default?"}, {exRepeat, "separator?", "chain?"}, {exRef}, {exCapture, "expr"},
	{"param", "at"}, {"call", "args", "at"},
	{exRange}, {exLiteral}, {exWildcard}, {exTest, "value?", "requirements?", "expr"}, {exEmpty},
}

var termForms = [][]string{
	{tmUnion}, {tmIntersection}, {tmDifference}, {tmIf, "then"}, {"method", "receiver", "args"},
	{"param", "at"}, {"call", "args", "at"},
	{tmString}, {tmTag}, {tmTerminal}, {tmInteger}, {tmConcat}, {tmEmptySet}, {tmCapture}, {tmRule}, {tmClassifier}, {tmConst, "at"}, {tmPattern},
}

var condForms = [][]string{
	{"op", "left", "right"}, {"method", "receiver", "args"}, {cdNot}, {cdAny}, {cdAll}, {cdCaptured}, {cdIf, "then"},
}

// hasOneForm says whether a node has exactly the members of one of its
// forms, and no other. So a node that joins two forms, such as
// {"tag":…,"string":…}, is refused before it is read, and no library reads
// it one way where another reads it another way. A member that ends in ?
// may be absent.
func hasOneForm[V any](o map[string]V, forms [][]string) bool {
	for _, form := range forms {
		if _, ok := o[form[0]]; !ok {
			continue
		}
		known := 0
		for _, member := range form {
			name, optional := strings.CutSuffix(member, "?")
			if _, ok := o[name]; ok {
				known++
			} else if !optional {
				return false
			}
		}
		return known == len(o)
	}
	return false
}

func (dc *domDecoder) decodeTerm(raw any) (*domTerm, error) { return dc.decodeTermAt(raw, 0) }

func (dc *domDecoder) decodeTermNode(raw any, depth int) (*domTerm, error) {
	o, err := domObjectOf(raw)
	if err != nil {
		return nil, err
	}
	if !hasOneForm(o, termForms) {
		return nil, fmt.Errorf("a malformed term")
	}
	if _, ok := o["param"]; ok {
		name, at, err := domParameter(o)
		return &domTerm{Kind: tmParam, Str: name, At: at}, err
	}
	if _, ok := o["call"]; ok {
		call, err := dc.decodeSourceCall(o, depth)
		t := &domTerm{Kind: tmSourceCall, Call: call}
		if call != nil {
			t.At = call.At
		}
		return t, err
	}
	for _, k := range []string{tmString, tmTag, tmCapture, tmRule, tmClassifier, tmTerminal, tmInteger} {
		if v, ok := o[k]; ok {
			s, err := domString(v)
			return &domTerm{Kind: k, Str: s}, err
		}
	}
	if v, ok := o[tmPattern]; ok {
		p, err := dc.decodeLayeredPattern(v, depth+1)
		return &domTerm{Kind: tmPattern, Pattern: p}, err
	}
	if domTrue(o["emptySet"]) {
		return &domTerm{Kind: tmEmptySet}, nil
	}
	if v, ok := o[tmConst]; ok {
		name, err := domString(v)
		if err != nil {
			return nil, err
		}
		at, err := domPosition(o["at"])
		return &domTerm{Kind: tmConst, Str: name, At: at}, err
	}
	for _, k := range []string{tmUnion, tmIntersection, tmDifference, tmConcat} {
		if v, ok := o[k]; ok {
			items, err := domList(v, func(r any) (*domTerm, error) { return dc.decodeTermAt(r, depth+1) })
			return &domTerm{Kind: k, Items: items}, err
		}
	}
	if v, ok := o["method"]; ok {
		name, err := domString(v)
		if err != nil {
			return nil, err
		}
		args, err := domList(o["args"], func(r any) (*domTerm, error) { return dc.decodeTermAt(r, depth+1) })
		if err != nil {
			return nil, err
		}
		receiver, err := dc.decodeTermAt(o["receiver"], depth+1)
		return &domTerm{Kind: tmCall, Str: name, Items: append([]*domTerm{receiver}, args...)}, err
	}
	if v, ok := o["if"]; ok {
		cond, err := dc.decodeCondAt(v, depth+1)
		if err != nil {
			return nil, err
		}
		then, err := dc.decodeTermAt(o["then"], depth+1)
		return &domTerm{Kind: tmIf, Cond: cond, Items: []*domTerm{then}}, err
	}
	return nil, fmt.Errorf("unknown term %v", raw)
}

func (dc *domDecoder) decodeCond(raw any) (*domCond, error) { return dc.decodeCondAt(raw, 0) }

func (dc *domDecoder) decodeCondNode(raw any, depth int) (*domCond, error) {
	o, err := domObjectOf(raw)
	if err != nil {
		return nil, err
	}
	// A condition has exactly the members of one form (docs/output.md).
	if !hasOneForm(o, condForms) {
		return nil, fmt.Errorf("a malformed condition")
	}
	if v, ok := o["op"]; ok {
		c := &domCond{Kind: cdCompare}
		if c.Op, err = domString(v); err != nil {
			return nil, err
		}
		if c.Left, err = dc.decodeTermAt(o["left"], depth+1); err != nil {
			return nil, err
		}
		c.Right, err = dc.decodeTermAt(o["right"], depth+1)
		return c, err
	}
	if o["method"] != nil {
		name, err := domString(o["method"])
		if err != nil {
			return nil, err
		}
		args, err := domList(o["args"], func(v any) (*domTerm, error) { return dc.decodeTermAt(v, depth+1) })
		if err != nil {
			return nil, err
		}
		receiver, err := dc.decodeTermAt(o["receiver"], depth+1)
		if err != nil {
			return nil, err
		}
		switch {
		case name == "ends-input" && len(args) == 0:
			return &domCond{Kind: cdEnd, Span: receiver}, nil
		case name == "starts-input" && len(args) == 0:
			return &domCond{Kind: cdInitial, Span: receiver}, nil
		case boundaryMethod(name) && len(args) >= 1:
			return &domCond{Kind: cdBoundary, Op: name, Span: receiver, Targets: args}, nil
		case (name == "matches" || name == "begins" || name == "ends") && len(args) >= 1:
			return &domCond{Kind: name, Span: receiver, Targets: args}, nil
		}
		return nil, fmt.Errorf("a malformed predicate method")
	}
	if v, ok := o["not"]; ok {
		inner, err := dc.decodeCondAt(v, depth+1)
		return &domCond{Kind: cdNot, Inner: inner}, err
	}
	if v, ok := o["captured"]; ok {
		name, err := domString(v)
		return &domCond{Kind: cdCaptured, Capture: name}, err
	}
	if v, ok := o["if"]; ok {
		premise, err := dc.decodeCondAt(v, depth+1)
		if err != nil {
			return nil, err
		}
		then, err := dc.decodeCondAt(o["then"], depth+1)
		return &domCond{Kind: cdIf, Items: []*domCond{premise, then}}, err
	}
	for _, k := range []string{cdAny, cdAll} {
		if v, ok := o[k]; ok {
			items, err := domList(v, func(r any) (*domCond, error) { return dc.decodeCondAt(r, depth+1) })
			return &domCond{Kind: k, Items: items}, err
		}
	}
	return nil, fmt.Errorf("unknown condition %v", raw)
}

func (dc *domDecoder) decodeEmit(raw any) (*domEmit, error) {
	o, err := domObjectOf(raw)
	if err != nil {
		return nil, err
	}
	if len(o) != 1 || o["items"] == nil {
		return nil, fmt.Errorf("a malformed emission")
	}
	items, err := domList(o["items"], func(r any) (*domEmitItem, error) {
		io, err := domObjectOf(r)
		if err != nil {
			return nil, err
		}
		it := &domEmitItem{}
		// An item has one target, optional clauses, and optional attachments.
		for k := range io {
			if k != "capture" && k != "insert" && k != "tags" && k != "before" && k != "after" && k != "value" && k != "image" {
				return nil, fmt.Errorf("a malformed emission item")
			}
		}
		_, insert := io["insert"]
		_, capture := io["capture"]
		switch {
		case insert && !capture:
			it.IsInsert = true
			if !domTrue(io["insert"]) {
				err = fmt.Errorf("insert must be true")
			}
		case capture && !insert:
			it.Capture, err = domString(io["capture"])
		default:
			err = fmt.Errorf("unknown emission item %v", r)
		}
		if tags, present := io["tags"]; err == nil && present {
			it.Tags, err = dc.decodeTerm(tags)
		}
		if err == nil {
			it.Value, it.Image, err = dc.decodeRecipes(io)
		}
		// A list of attachments is present only when it is not empty.
		for _, side := range []struct {
			key  string
			into *[]string
		}{{"before", &it.Before}, {"after", &it.After}} {
			raw, present := io[side.key]
			if err != nil || !present {
				continue
			}
			*side.into, err = domList(raw, domString)
			if err == nil && len(*side.into) == 0 {
				err = fmt.Errorf("a malformed emission item: an empty list of attachments")
			}
		}
		return it, err
	})
	if err == nil && len(items) == 0 {
		err = fmt.Errorf("a malformed emission: items must be nonempty")
	}
	return &domEmit{Items: items}, err
}

func (c *domCond) queryTargets() []*domTerm { return c.Targets }
func queryName(t *domTerm) string {
	if t.Kind == tmTerminal {
		return "\x00query:" + t.Str
	}
	return t.Str
}
func validInteger(s string) bool {
	if len(s) == 0 || s[0] < '1' || s[0] > '9' {
		return false
	}
	for i := 1; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}

func (dc *domDecoder) decodeExprAt(raw any, depth int) (*domExpr, error) {
	if _, err := domObjectOf(raw); err != nil {
		return nil, err
	}
	out := &domExpr{}
	dc.pending = append(dc.pending, func() error {
		value, err := dc.decodeExprNode(raw, depth)
		if err == nil {
			*out = *value
		}
		return err
	})
	return out, nil
}

func (dc *domDecoder) decodeTermAt(raw any, depth int) (*domTerm, error) {
	if _, err := domObjectOf(raw); err != nil {
		return nil, err
	}
	out := &domTerm{}
	dc.pending = append(dc.pending, func() error {
		value, err := dc.decodeTermNode(raw, depth)
		if err == nil {
			*out = *value
		}
		return err
	})
	return out, nil
}

func (dc *domDecoder) decodeCondAt(raw any, depth int) (*domCond, error) {
	if _, err := domObjectOf(raw); err != nil {
		return nil, err
	}
	out := &domCond{}
	dc.pending = append(dc.pending, func() error {
		value, err := dc.decodeCondNode(raw, depth)
		if err == nil {
			*out = *value
		}
		return err
	})
	return out, nil
}
