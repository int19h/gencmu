package gencmu

import (
	"bytes"
	"encoding/json"
	"fmt"
)

// domFormat is the version of the grammar DOM (docs/output.md).
const domFormat = 16

// The grammar DOM: what reading one grammar document produces (engine §8,
// §9), and what bootstrap.json and compiled.json hold.
type domDoc struct {
	Rules        []*domRule
	Directives   []*domDirective
	Constants    []*domConst
	Classifiers  []*domClassifier
	Implications []*domImplication
}

// domClassifier is a %classifier item (engine §2): its name, which begins
// with a lower-case letter, and its entries as written. The DOM never holds
// the classifier's value, which depends on the features.
type domClassifier struct {
	Name    string
	Entries []*domEntry
	At      [2]int
}

// domEntry is an entry of a classifier: its gates, one or more keys, each a
// canonical sound, ∈ or ∉, and one class, a name that begins with a
// capital. At is its first token, where the loader reports an error of the
// entry.
type domEntry struct {
	Guards []domGuard
	Keys   []string
	Op     string
	Class  string
	At     [2]int
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
	Name         string
	Op           string // "define", "redefine" or "extend"
	Tags         *domTerm
	Alternatives []*domAlt
	Emit         *domEmit
	Conditions   []*domCond
	Opaque       bool // %opaque: its constituents are opaque parts, which sound ? and show their text (engine §11)
	At           [2]int
}

type domAlt struct {
	Guards []domGuard
	Expr   *domExpr
	Tags   *domTerm
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
	exAnd      = "and"
	exOptional = "optional"
	exRepeat   = "repeat"
	exRef      = "ref"
	exTerminal = "terminal"
	exCapture  = "capture"
	exTest     = "test"
	exEmpty    = "empty"
	exRange    = "range"
	exProperty = "property"
)

type domExpr struct {
	Kind  string
	Items []*domExpr // seq, choice, and
	Inner *domExpr   // optional, repeat, capture, test (its symbol)
	Min   int        // repeat
	Name  string     // ref, terminal (a tag in its canonical spelling), capture, property (its name)
	Range [2]string  // range: its two ends, character tags in their canonical spelling
	Op    string     // test: its comparator, one of testOps
	Value *domTerm   // test: its value, a closed term
}

// testOps are the comparators of a test in a body (engine §2): the two
// sound tests and the four tag tests.
var testOps = map[string]bool{"=": true, "≠": true, "⊇": true, "⊉": true, "∩=∅": true, "∩≠∅": true}

// isSoundTest says whether a test's comparator is a sound test, whose
// value is a string, rather than a tag test, whose value is a tag set
// (engine §2).
func isSoundTest(op string) bool {
	return op == "=" || op == "≠"
}

// Term kinds. A string is tmString, and a tag literal tmTag, the tag in its
// canonical spelling. A span is a term of kind tmCapture, "" for $, the
// whole constituent, or a tmCall of head, tail, last, from or after; a rule
// argument is tmRule, and the classifier that classify names is
// tmClassifier. A difference, a ∖ b, has exactly two items. A guarded
// term, A ⟹ t, is tmIf: Cond is A, and Items holds t alone. A range,
// 'a'..'z', is tmRange, its ends in Range. A reference to a constant is
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
	tmIf           = "if"
	tmRange        = "range"
	tmConst        = "const"
)

type domTerm struct {
	Kind  string
	Str   string     // string, tag, call (the function), capture, rule, classifier
	Items []*domTerm // union, intersection, difference, call arguments; if: its term
	Cond  *domCond   // if: its condition
	Range [2]string  // range: its two ends
	At    [2]int     // const: the position of the reference
	// value is a constant's final value in its stage, which only a
	// stitched grammar's copy of the reference holds (engine §2).
	value *constValue
}

// isSpanFunction says whether a function gives a span (engine §10).
func isSpanFunction(name string) bool {
	switch name {
	case "head", "tail", "last", "from", "after":
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
	cdInitial  = "initial"
	cdNot      = "not"
	cdAny      = "any"
	cdAll      = "all"
	cdCaptured = "captured"
	cdIf       = "if"
)

type domCond struct {
	Kind        string
	Op          string
	Left, Right *domTerm
	Span        *domTerm // matches, begins, initial
	Rule        string   // matches, begins; captured: the capture's name
	Inner       *domCond
	Items       []*domCond
}

// domEmit is an emission; no items is %emits ε.
type domEmit struct {
	Items []*domEmitItem
}

// domEmitItem is a capture, "" for $, with its tags, or an inserted tag.
// A named capture, the item's carrier, can name attachment captures before
// it and after it (engine §11).
type domEmitItem struct {
	Capture  string
	IsInsert bool
	Insert   string
	Tags     *domTerm
	Before   []string
	After    []string
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

// whole says the emission is of $, the whole constituent: every item is $.
func (e *domEmit) whole() bool {
	return len(e.Items) > 0 && !e.Items[0].IsInsert && e.Items[0].Capture == ""
}

// nothing says the emission is ε: the constituent emits nothing and does
// not count (engine §11).
func (e *domEmit) nothing() bool {
	return len(e.Items) == 0
}

type domDirective struct {
	Name string
	Args []string
	At   [2]int
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
		w.raw(`,"args":[`)
		for j, a := range dir.Args {
			if j > 0 {
				w.raw(",")
			}
			w.str(a)
		}
		w.raw(`],"at":`)
		w.pair(dir.At)
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
			for k, key := range e.Keys {
				if k > 0 {
					w.raw(",")
				}
				w.str(key)
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
	w.raw(`,"op":`)
	w.str(r.Op)
	if r.Tags != nil {
		w.raw(`,"tags":`)
		r.Tags.writeJSON(w)
	}
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
	if r.Opaque {
		w.raw(`,"opaque":true`)
	}
	w.raw(`,"at":`)
	w.pair(r.At)
	w.raw("}")
}

func (e *domExpr) writeJSON(w *jsonWriter) {
	switch e.Kind {
	case exSeq, exChoice, exAnd:
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
		w.raw("}")
	case exRepeat:
		w.raw(`{"repeat":`)
		e.Inner.writeJSON(w)
		w.raw(`,"min":`)
		w.int(e.Min)
		w.raw("}")
	case exRef, exTerminal:
		w.raw("{")
		w.str(e.Kind)
		w.raw(":")
		w.str(e.Name)
		w.raw("}")
	case exCapture:
		w.raw(`{"capture":`)
		w.str(e.Name)
		w.raw(`,"expr":`)
		e.Inner.writeJSON(w)
		w.raw("}")
	case exTest:
		w.raw(`{"test":`)
		w.str(e.Op)
		w.raw(`,"value":`)
		e.Value.writeJSON(w)
		w.raw(`,"expr":`)
		e.Inner.writeJSON(w)
		w.raw("}")
	case exEmpty:
		w.raw(`{"empty":true}`)
	case exRange:
		writeRange(w, e.Range)
	case exProperty:
		w.raw(`{"property":`)
		w.str(e.Name)
		w.raw("}")
	}
}

// writeRange writes a range, {"range":["'a'","'z'"]}, as an expression or
// a term.
func writeRange(w *jsonWriter, r [2]string) {
	w.raw(`{"range":[`)
	w.str(r[0])
	w.raw(",")
	w.str(r[1])
	w.raw("]}")
}

func (t *domTerm) writeJSON(w *jsonWriter) {
	switch t.Kind {
	case tmString, tmTag, tmCapture, tmRule, tmClassifier:
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
	case tmRange:
		writeRange(w, t.Range)
	case tmUnion, tmIntersection, tmDifference:
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
		w.raw(`{"call":`)
		w.str(t.Str)
		w.raw(`,"args":[`)
		for i, it := range t.Items {
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
	case cdMatches, cdBegins:
		w.raw("{")
		w.str(c.Kind)
		w.raw(":")
		c.Span.writeJSON(w)
		w.raw(`,"rule":`)
		w.str(c.Rule)
		w.raw("}")
	case cdInitial:
		w.raw(`{"initial":`)
		c.Span.writeJSON(w)
		w.raw("}")
	case cdNot:
		w.raw(`{"not":`)
		c.Inner.writeJSON(w)
		w.raw("}")
	case cdCaptured:
		w.raw(`{"captured":`)
		w.str(c.Rule)
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
			w.str(it.Insert)
		default:
			w.raw(`{"capture":`)
			w.str(it.Capture)
		}
		if it.Tags != nil {
			w.raw(`,"tags":`)
			it.Tags.writeJSON(w)
		}
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

type jobj map[string]json.RawMessage

func decodeObj(raw json.RawMessage) (jobj, error) {
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
// validates it; uni is the lowercase mapping that the strings of its sound
// tests are checked against (engine §9).
func decodeDOM(raw json.RawMessage, uni *unicodeTable) (*domDoc, error) {
	o, err := decodeObj(raw)
	if err != nil {
		return nil, err
	}
	var format int
	if err := unmarshal(o["format"], &format); err != nil || format != domFormat {
		return nil, fmt.Errorf("unsupported DOM format")
	}
	var rules, dirs []json.RawMessage
	if err := unmarshal(o["rules"], &rules); err != nil {
		return nil, err
	}
	if err := unmarshal(o["directives"], &dirs); err != nil {
		return nil, err
	}
	var consts, classifiers, implications []json.RawMessage
	if unmarshal(o["constants"], &consts) != nil || unmarshal(o["classifiers"], &classifiers) != nil || unmarshal(o["implications"], &implications) != nil {
		return nil, fmt.Errorf("not a DOM of format %d", domFormat)
	}
	d := &domDoc{}
	for _, c := range classifiers {
		classifier, err := decodeClassifier(c)
		if err != nil {
			return nil, err
		}
		d.Classifiers = append(d.Classifiers, classifier)
	}
	for _, m := range implications {
		implication, err := decodeImplication(m)
		if err != nil {
			return nil, err
		}
		d.Implications = append(d.Implications, implication)
	}
	for _, k := range consts {
		constant, err := decodeConst(k)
		if err != nil {
			return nil, err
		}
		d.Constants = append(d.Constants, constant)
	}
	for _, r := range rules {
		rule, err := decodeRule(r)
		if err != nil {
			return nil, err
		}
		d.Rules = append(d.Rules, rule)
	}
	for _, r := range dirs {
		o, err := decodeObj(r)
		if err != nil {
			return nil, err
		}
		name, err := decodeString(o["name"])
		if err != nil {
			return nil, fmt.Errorf("a malformed directive")
		}
		args, err := decodeList(o["args"], decodeString)
		if err != nil {
			return nil, fmt.Errorf("a malformed directive")
		}
		at, err := decodePosition(o["at"])
		if err != nil {
			return nil, fmt.Errorf("a malformed directive")
		}
		d.Directives = append(d.Directives, &domDirective{Name: name, Args: args, At: at})
	}
	if err := validateDOM(d, uni); err != nil {
		return nil, err
	}
	return d, nil
}

// decodeConst reads a constant's definition, which has exactly its name,
// its op, its value and its position.
func decodeConst(raw json.RawMessage) (*domConst, error) {
	o, err := decodeObj(raw)
	malformed := fmt.Errorf("a malformed constant")
	if err != nil || len(o) != 4 || o["value"] == nil {
		return nil, malformed
	}
	k := &domConst{}
	if k.Name, err = decodeString(o["name"]); err != nil {
		return nil, malformed
	}
	if k.Op, err = decodeString(o["op"]); err != nil {
		return nil, malformed
	}
	if k.At, err = decodePosition(o["at"]); err != nil {
		return nil, malformed
	}
	if k.Value, err = decodeTerm(o["value"]); err != nil {
		return nil, err
	}
	return k, nil
}

// decodeClassifier reads a classifier, which has exactly its name, its
// entries and its position. Each entry has exactly its guards, its keys,
// its operator, its class and its position; the checker holds them to the
// reader's rules.
func decodeClassifier(raw json.RawMessage) (*domClassifier, error) {
	o, err := decodeObj(raw)
	malformed := fmt.Errorf("a malformed classifier")
	if err != nil || len(o) != 3 {
		return nil, malformed
	}
	c := &domClassifier{}
	if c.Name, err = decodeString(o["name"]); err != nil {
		return nil, malformed
	}
	if c.At, err = decodePosition(o["at"]); err != nil {
		return nil, malformed
	}
	if c.Entries, err = decodeList(o["entries"], decodeEntry); err != nil {
		return nil, err
	}
	return c, nil
}

func decodeEntry(raw json.RawMessage) (*domEntry, error) {
	o, err := decodeObj(raw)
	malformed := fmt.Errorf("a malformed entry of a classifier")
	if err != nil || len(o) != 5 {
		return nil, malformed
	}
	e := &domEntry{}
	if e.Guards, err = decodeGuards(o["guards"]); err != nil {
		return nil, malformed
	}
	if e.Keys, err = decodeList(o["keys"], decodeString); err != nil {
		return nil, malformed
	}
	if e.Op, err = decodeString(o["op"]); err != nil {
		return nil, malformed
	}
	if e.Class, err = decodeString(o["class"]); err != nil {
		return nil, malformed
	}
	if e.At, err = decodePosition(o["at"]); err != nil {
		return nil, malformed
	}
	return e, nil
}

// decodeImplication reads an implication, which has exactly its two sides
// and its position.
func decodeImplication(raw json.RawMessage) (*domImplication, error) {
	o, err := decodeObj(raw)
	malformed := fmt.Errorf("a malformed implication")
	if err != nil || len(o) != 3 || o["if"] == nil || o["then"] == nil {
		return nil, malformed
	}
	m := &domImplication{}
	if m.At, err = decodePosition(o["at"]); err != nil {
		return nil, malformed
	}
	if m.If, err = decodeTerm(o["if"]); err != nil {
		return nil, err
	}
	if m.Then, err = decodeTerm(o["then"]); err != nil {
		return nil, err
	}
	return m, nil
}

// decodeGuards reads a list of guards, each with exactly its feature, its
// kind and whether it is negated.
func decodeGuards(raw json.RawMessage) ([]domGuard, error) {
	var items []json.RawMessage
	if err := unmarshal(raw, &items); err != nil {
		return nil, fmt.Errorf("a malformed guard")
	}
	guards := []domGuard{}
	for _, it := range items {
		o, err := decodeObj(it)
		if err != nil || len(o) != 3 {
			return nil, fmt.Errorf("a malformed guard")
		}
		var g domGuard
		if unmarshal(o["feature"], &g.Feature) != nil || unmarshal(o["kind"], &g.Kind) != nil || unmarshal(o["negated"], &g.Negated) != nil {
			return nil, fmt.Errorf("a malformed guard")
		}
		guards = append(guards, g)
	}
	return guards, nil
}

func decodeRule(raw json.RawMessage) (*domRule, error) {
	o, err := decodeObj(raw)
	if err != nil {
		return nil, err
	}
	r := &domRule{}
	if r.Name, err = decodeString(o["name"]); err != nil {
		return nil, err
	}
	if r.Op, err = decodeString(o["op"]); err != nil {
		return nil, err
	}
	if r.At, err = decodePosition(o["at"]); err != nil {
		return nil, fmt.Errorf("a malformed rule")
	}
	if _, ok := o["conditions"]; !ok {
		return nil, fmt.Errorf("a malformed rule")
	}
	if t, ok := o["tags"]; ok {
		if r.Tags, err = decodeTerm(t); err != nil {
			return nil, err
		}
	}
	if e, ok := o["emit"]; ok {
		if r.Emit, err = decodeEmit(e); err != nil {
			return nil, err
		}
	}
	// A flag: true or absent.
	if v, ok := o["opaque"]; ok {
		if !isTrue(v) {
			return nil, fmt.Errorf("a malformed rule")
		}
		r.Opaque = true
	}
	var alts, conds []json.RawMessage
	if err := unmarshal(o["alternatives"], &alts); err != nil {
		return nil, err
	}
	if c, ok := o["conditions"]; ok {
		if err := unmarshal(c, &conds); err != nil {
			return nil, err
		}
	}
	for _, a := range alts {
		ao, err := decodeObj(a)
		if err != nil {
			return nil, err
		}
		alt := &domAlt{}
		// The guards of an alternative have the members of an entry's
		// guards. The checker holds their kinds to the reader's rules.
		if alt.Guards, err = decodeGuards(ao["guards"]); err != nil {
			return nil, err
		}
		if alt.Expr, err = decodeExpr(ao["expr"]); err != nil {
			return nil, err
		}
		if t, ok := ao["tags"]; ok {
			if alt.Tags, err = decodeTerm(t); err != nil {
				return nil, err
			}
		}
		r.Alternatives = append(r.Alternatives, alt)
	}
	for _, c := range conds {
		cond, err := decodeCond(c)
		if err != nil {
			return nil, err
		}
		r.Conditions = append(r.Conditions, cond)
	}
	return r, nil
}

// isTrue: the flags of the DOM, such as {"empty":true}, are true or absent.
func isTrue(raw json.RawMessage) bool {
	var b bool
	return raw != nil && json.Unmarshal(raw, &b) == nil && b
}

func decodeList[T any](raw json.RawMessage, each func(json.RawMessage) (T, error)) ([]T, error) {
	var items []json.RawMessage
	if err := unmarshal(raw, &items); err != nil {
		return nil, err
	}
	out := make([]T, 0, len(items))
	for _, it := range items {
		v, err := each(it)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, nil
}

// unmarshal is json.Unmarshal, but refuses null. json.Unmarshal reads null
// into a string, a number or a list as its zero value, with no error, where
// the other libraries refuse the DOM.
func unmarshal(raw json.RawMessage, v any) error {
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return fmt.Errorf("a null where the DOM holds a value")
	}
	return json.Unmarshal(raw, v)
}

func decodeString(raw json.RawMessage) (string, error) {
	var s string
	err := unmarshal(raw, &s)
	return s, err
}

// decodePosition reads a [line, column] pair, each an integer.
func decodePosition(raw json.RawMessage) ([2]int, error) {
	at, err := decodeList(raw, func(r json.RawMessage) (int, error) {
		var n int
		err := unmarshal(r, &n)
		return n, err
	})
	if err != nil || len(at) != 2 {
		return [2]int{}, fmt.Errorf("a malformed position")
	}
	return [2]int{at[0], at[1]}, nil
}

func decodeExpr(raw json.RawMessage) (*domExpr, error) {
	o, err := decodeObj(raw)
	if err != nil {
		return nil, err
	}
	// An expression has exactly the members of one form (docs/output.md).
	if !hasOneForm(o, exprForms) {
		return nil, fmt.Errorf("a malformed expression")
	}
	if v, ok := o[exRange]; ok {
		r, err := decodeRange(v)
		return &domExpr{Kind: exRange, Range: r}, err
	}
	if v, ok := o[exProperty]; ok {
		name, err := decodeString(v)
		return &domExpr{Kind: exProperty, Name: name}, err
	}
	for _, k := range []string{exSeq, exChoice, exAnd} {
		if v, ok := o[k]; ok {
			items, err := decodeList(v, decodeExpr)
			return &domExpr{Kind: k, Items: items}, err
		}
	}
	if v, ok := o["optional"]; ok {
		inner, err := decodeExpr(v)
		return &domExpr{Kind: exOptional, Inner: inner}, err
	}
	if v, ok := o["repeat"]; ok {
		inner, err := decodeExpr(v)
		if err != nil {
			return nil, err
		}
		e := &domExpr{Kind: exRepeat, Inner: inner}
		err = unmarshal(o["min"], &e.Min)
		return e, err
	}
	if v, ok := o["capture"]; ok {
		name, err := decodeString(v)
		if err != nil {
			return nil, err
		}
		inner, err := decodeExpr(o["expr"])
		return &domExpr{Kind: exCapture, Name: name, Inner: inner}, err
	}
	if v, ok := o["test"]; ok {
		// The symbol is one reference, terminal, range or property alone,
		// so that no node reads two ways.
		op, err := decodeString(v)
		if err != nil {
			return nil, fmt.Errorf("a malformed test")
		}
		if io, err := decodeObj(o["expr"]); err != nil || len(io) != 1 {
			return nil, fmt.Errorf("a test follows only a reference other than # or a terminal")
		}
		inner, err := decodeExpr(o["expr"])
		if err != nil {
			return nil, err
		}
		value, err := decodeTerm(o["value"])
		return &domExpr{Kind: exTest, Op: op, Inner: inner, Value: value}, err
	}
	for _, k := range []string{exRef, exTerminal} {
		if v, ok := o[k]; ok {
			name, err := decodeString(v)
			return &domExpr{Kind: k, Name: name}, err
		}
	}
	if isTrue(o["empty"]) {
		return &domExpr{Kind: exEmpty}, nil
	}
	return nil, fmt.Errorf("unknown expression %s", string(raw))
}

// exprForms, termForms and condForms are the forms of an expression, a
// term and a condition, each as its members (docs/output.md). The first
// member names the form. A rule argument and a classifier argument are
// forms of a term too.
var exprForms = [][]string{
	{exSeq}, {exChoice}, {exAnd}, {exOptional}, {exRepeat, "min"}, {exRef}, {exTerminal}, {exCapture, "expr"},
	{exRange}, {exProperty}, {exTest, "value", "expr"}, {exEmpty},
}

var termForms = [][]string{
	{tmUnion}, {tmIntersection}, {tmDifference}, {tmIf, "then"}, {tmCall, "args"},
	{tmString}, {tmTag}, {tmRange}, {tmEmptySet}, {tmCapture}, {tmRule}, {tmClassifier}, {tmConst, "at"},
}

var condForms = [][]string{
	{"op", "left", "right"}, {cdMatches, "rule"}, {cdBegins, "rule"}, {cdInitial}, {cdNot}, {cdAny}, {cdAll}, {cdCaptured}, {cdIf, "then"},
}

// decodeRange decodes a range's two ends, which the checker then holds to
// the reader's rules.
func decodeRange(raw json.RawMessage) ([2]string, error) {
	var ends []string
	if err := unmarshal(raw, &ends); err != nil || len(ends) != 2 {
		return [2]string{}, fmt.Errorf("a malformed range")
	}
	return [2]string{ends[0], ends[1]}, nil
}

// hasOneForm says whether a node has exactly the members of one of its
// forms, and no other. So a node that joins two forms, such as
// {"tag":…,"string":…}, is refused before it is read, and no library reads
// it one way where another reads it another way.
func hasOneForm(o jobj, forms [][]string) bool {
	for _, form := range forms {
		if _, ok := o[form[0]]; !ok {
			continue
		}
		if len(o) != len(form) {
			return false
		}
		for _, member := range form {
			if _, ok := o[member]; !ok {
				return false
			}
		}
		return true
	}
	return false
}

func decodeTerm(raw json.RawMessage) (*domTerm, error) {
	o, err := decodeObj(raw)
	if err != nil {
		return nil, err
	}
	if !hasOneForm(o, termForms) {
		return nil, fmt.Errorf("a malformed term")
	}
	for _, k := range []string{tmString, tmTag, tmCapture, tmRule, tmClassifier} {
		if v, ok := o[k]; ok {
			s, err := decodeString(v)
			return &domTerm{Kind: k, Str: s}, err
		}
	}
	if isTrue(o["emptySet"]) {
		return &domTerm{Kind: tmEmptySet}, nil
	}
	if v, ok := o[tmConst]; ok {
		name, err := decodeString(v)
		if err != nil {
			return nil, err
		}
		at, err := decodePosition(o["at"])
		return &domTerm{Kind: tmConst, Str: name, At: at}, err
	}
	if v, ok := o[tmRange]; ok {
		r, err := decodeRange(v)
		return &domTerm{Kind: tmRange, Range: r}, err
	}
	for _, k := range []string{tmUnion, tmIntersection, tmDifference} {
		if v, ok := o[k]; ok {
			items, err := decodeList(v, decodeTerm)
			return &domTerm{Kind: k, Items: items}, err
		}
	}
	if v, ok := o["call"]; ok {
		name, err := decodeString(v)
		if err != nil {
			return nil, err
		}
		args, err := decodeList(o["args"], decodeTerm)
		return &domTerm{Kind: tmCall, Str: name, Items: args}, err
	}
	if v, ok := o["if"]; ok {
		cond, err := decodeCond(v)
		if err != nil {
			return nil, err
		}
		then, err := decodeTerm(o["then"])
		return &domTerm{Kind: tmIf, Cond: cond, Items: []*domTerm{then}}, err
	}
	return nil, fmt.Errorf("unknown term %s", string(raw))
}

func decodeCond(raw json.RawMessage) (*domCond, error) {
	o, err := decodeObj(raw)
	if err != nil {
		return nil, err
	}
	// A condition has exactly the members of one form (docs/output.md).
	if !hasOneForm(o, condForms) {
		return nil, fmt.Errorf("a malformed condition")
	}
	if v, ok := o["op"]; ok {
		c := &domCond{Kind: cdCompare}
		if c.Op, err = decodeString(v); err != nil {
			return nil, err
		}
		if c.Left, err = decodeTerm(o["left"]); err != nil {
			return nil, err
		}
		c.Right, err = decodeTerm(o["right"])
		return c, err
	}
	for _, k := range []string{cdMatches, cdBegins} {
		if v, ok := o[k]; ok {
			// A span and a rule, of one of the two.
			if o[cdMatches] != nil && o[cdBegins] != nil {
				return nil, fmt.Errorf("a malformed condition")
			}
			c := &domCond{Kind: k}
			if c.Span, err = decodeTerm(v); err != nil {
				return nil, err
			}
			c.Rule, err = decodeString(o["rule"])
			return c, err
		}
	}
	if v, ok := o["initial"]; ok {
		// Its span, and nothing else.
		if len(o) != 1 {
			return nil, fmt.Errorf("a malformed condition")
		}
		span, err := decodeTerm(v)
		return &domCond{Kind: cdInitial, Span: span}, err
	}
	if v, ok := o["not"]; ok {
		inner, err := decodeCond(v)
		return &domCond{Kind: cdNot, Inner: inner}, err
	}
	if v, ok := o["captured"]; ok {
		name, err := decodeString(v)
		return &domCond{Kind: cdCaptured, Rule: name}, err
	}
	if v, ok := o["if"]; ok {
		premise, err := decodeCond(v)
		if err != nil {
			return nil, err
		}
		then, err := decodeCond(o["then"])
		return &domCond{Kind: cdIf, Items: []*domCond{premise, then}}, err
	}
	for _, k := range []string{cdAny, cdAll} {
		if v, ok := o[k]; ok {
			items, err := decodeList(v, decodeCond)
			return &domCond{Kind: k, Items: items}, err
		}
	}
	return nil, fmt.Errorf("unknown condition %s", string(raw))
}

func decodeEmit(raw json.RawMessage) (*domEmit, error) {
	o, err := decodeObj(raw)
	if err != nil {
		return nil, err
	}
	if len(o) != 1 || o["items"] == nil || string(o["items"]) == "null" {
		return nil, fmt.Errorf("a malformed emission")
	}
	items, err := decodeList(o["items"], func(r json.RawMessage) (*domEmitItem, error) {
		io, err := decodeObj(r)
		if err != nil {
			return nil, err
		}
		it := &domEmitItem{}
		// An item is a capture or an inserted tag, and has no other member
		// than its tags and its attachments.
		for k := range io {
			if k != "capture" && k != "insert" && k != "tags" && k != "before" && k != "after" {
				return nil, fmt.Errorf("a malformed emission item")
			}
		}
		switch {
		case io["insert"] != nil && io["capture"] == nil:
			it.IsInsert = true
			it.Insert, err = decodeString(io["insert"])
		case io["capture"] != nil && io["insert"] == nil:
			it.Capture, err = decodeString(io["capture"])
		default:
			err = fmt.Errorf("unknown emission item %s", string(r))
		}
		if err == nil && io["tags"] != nil {
			it.Tags, err = decodeTerm(io["tags"])
		}
		// A list of attachments is present only when it is not empty.
		for _, side := range []struct {
			key  string
			into *[]string
		}{{"before", &it.Before}, {"after", &it.After}} {
			if err != nil || io[side.key] == nil {
				continue
			}
			*side.into, err = decodeList(io[side.key], decodeString)
			if err == nil && len(*side.into) == 0 {
				err = fmt.Errorf("a malformed emission item: an empty list of attachments")
			}
		}
		return it, err
	})
	return &domEmit{Items: items}, err
}
