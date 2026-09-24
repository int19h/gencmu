package gencmu

import (
	"encoding/json"
	"fmt"
)

// domFormat is the version of the grammar DOM (docs/output.md).
const domFormat = 1

// The grammar DOM: what reading one grammar document produces (engine §8,
// §9), and what bootstrap.json and compiled.json hold.
type domDoc struct {
	Rules      []*domRule
	Directives []*domDirective
}

type domRule struct {
	Name         string
	Op           string // "define" or "extend"
	Tags         *domTerm
	Alternatives []*domAlt
	Emit         *domEmit
	Conditions   []*domCond
	At           [2]int
}

type domAlt struct {
	Guards []domGuard
	Expr   *domExpr
	Tags   *domTerm
}

type domGuard struct {
	Feature string
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
	exHash     = "hash"
	exEmpty    = "empty"
)

type domExpr struct {
	Kind  string
	Items []*domExpr // seq, choice, and
	Inner *domExpr   // optional, repeat, capture
	Min   int        // repeat
	Name  string     // ref, terminal, capture
}

// Term kinds. A span is a term of kind tmCapture, or a tmCall of head, tail
// or last; a rule argument is tmRule.
const (
	tmLiteral      = "literal"
	tmWeak         = "weak"
	tmEmptySet     = "emptySet"
	tmSet          = "set"
	tmUnion        = "union"
	tmIntersection = "intersection"
	tmCall         = "call"
	tmCapture      = "capture"
	tmRule         = "rule"
)

type domTerm struct {
	Kind  string
	Str   string     // literal, weak, call (the function), capture, rule
	Items []*domTerm // set, union, intersection, call arguments
}

// Condition kinds.
const (
	cdCompare = "compare"
	cdMatches = "matches"
	cdNot     = "not"
	cdAny     = "any"
)

type domCond struct {
	Kind        string
	Op          string
	Left, Right *domTerm
	Span        *domTerm // matches
	Rule        string   // matches
	Inner       *domCond
	Items       []*domCond
}

type domEmit struct {
	Nothing bool
	Items   []*domEmitItem
}

type domEmitItem struct {
	This     bool
	Capture  string
	IsInsert bool
	Insert   string
	Tags     *domTerm
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
	w.raw("]}")
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
		w.raw(`{"guards":[`)
		for j, g := range a.Guards {
			if j > 0 {
				w.raw(",")
			}
			w.raw(`{"feature":`)
			w.str(g.Feature)
			w.raw(`,"negated":`)
			w.bool(g.Negated)
			w.raw("}")
		}
		w.raw(`],"expr":`)
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
	w.raw(`],"at":`)
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
	case exHash, exEmpty:
		w.raw("{")
		w.str(e.Kind)
		w.raw(":true}")
	}
}

func (t *domTerm) writeJSON(w *jsonWriter) {
	switch t.Kind {
	case tmLiteral, tmWeak, tmCapture, tmRule:
		w.raw("{")
		w.str(t.Kind)
		w.raw(":")
		w.str(t.Str)
		w.raw("}")
	case tmEmptySet:
		w.raw(`{"emptySet":true}`)
	case tmSet, tmUnion, tmIntersection:
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
	case cdMatches:
		w.raw(`{"matches":`)
		c.Span.writeJSON(w)
		w.raw(`,"rule":`)
		w.str(c.Rule)
		w.raw("}")
	case cdNot:
		w.raw(`{"not":`)
		c.Inner.writeJSON(w)
		w.raw("}")
	case cdAny:
		w.raw(`{"any":[`)
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
	if e.Nothing {
		w.raw(`{"nothing":true}`)
		return
	}
	w.raw(`{"items":[`)
	for i, it := range e.Items {
		if i > 0 {
			w.raw(",")
		}
		switch {
		case it.IsInsert:
			w.raw(`{"insert":`)
			w.str(it.Insert)
		case it.This:
			w.raw(`{"this":true`)
		default:
			w.raw(`{"capture":`)
			w.str(it.Capture)
		}
		if it.Tags != nil {
			w.raw(`,"tags":`)
			it.Tags.writeJSON(w)
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

func decodeDOM(raw json.RawMessage) (*domDoc, error) {
	o, err := decodeObj(raw)
	if err != nil {
		return nil, err
	}
	var format int
	if err := json.Unmarshal(o["format"], &format); err != nil || format != domFormat {
		return nil, fmt.Errorf("unsupported DOM format")
	}
	var rules, dirs []json.RawMessage
	if err := json.Unmarshal(o["rules"], &rules); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(o["directives"], &dirs); err != nil {
		return nil, err
	}
	d := &domDoc{}
	for _, r := range rules {
		rule, err := decodeRule(r)
		if err != nil {
			return nil, err
		}
		d.Rules = append(d.Rules, rule)
	}
	for _, r := range dirs {
		if string(r) == "null" {
			return nil, fmt.Errorf("a null directive")
		}
		var dir struct {
			Name *string
			Args []string
			At   []int
		}
		if err := json.Unmarshal(r, &dir); err != nil {
			return nil, err
		}
		if dir.Name == nil || dir.Args == nil || len(dir.At) != 2 {
			return nil, fmt.Errorf("a malformed directive")
		}
		d.Directives = append(d.Directives, &domDirective{Name: *dir.Name, Args: dir.Args, At: [2]int{dir.At[0], dir.At[1]}})
	}
	if err := validateDOM(d); err != nil {
		return nil, err
	}
	return d, nil
}

func decodeRule(raw json.RawMessage) (*domRule, error) {
	o, err := decodeObj(raw)
	if err != nil {
		return nil, err
	}
	r := &domRule{}
	if err := json.Unmarshal(o["name"], &r.Name); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(o["op"], &r.Op); err != nil {
		return nil, err
	}
	var at []int
	if err := json.Unmarshal(o["at"], &at); err != nil || len(at) != 2 {
		return nil, fmt.Errorf("a malformed rule")
	}
	r.At = [2]int{at[0], at[1]}
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
	var alts, conds []json.RawMessage
	if err := json.Unmarshal(o["alternatives"], &alts); err != nil {
		return nil, err
	}
	if c, ok := o["conditions"]; ok {
		if err := json.Unmarshal(c, &conds); err != nil {
			return nil, err
		}
	}
	for _, a := range alts {
		ao, err := decodeObj(a)
		if err != nil {
			return nil, err
		}
		alt := &domAlt{Guards: []domGuard{}}
		var guards []*struct {
			Feature *string
			Negated *bool
		}
		if err := json.Unmarshal(ao["guards"], &guards); err != nil || guards == nil {
			return nil, fmt.Errorf("a malformed alternative")
		}
		for _, gd := range guards {
			if gd == nil || gd.Feature == nil || gd.Negated == nil {
				return nil, fmt.Errorf("a malformed guard")
			}
			alt.Guards = append(alt.Guards, domGuard{*gd.Feature, *gd.Negated})
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

// isTrue: the flags of the DOM, such as {"hash":true}, are true or absent.
func isTrue(raw json.RawMessage) bool {
	var b bool
	return raw != nil && json.Unmarshal(raw, &b) == nil && b
}

func decodeList[T any](raw json.RawMessage, each func(json.RawMessage) (T, error)) ([]T, error) {
	var items []json.RawMessage
	if err := json.Unmarshal(raw, &items); err != nil {
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

func decodeString(raw json.RawMessage) (string, error) {
	var s string
	err := json.Unmarshal(raw, &s)
	return s, err
}

func decodeExpr(raw json.RawMessage) (*domExpr, error) {
	o, err := decodeObj(raw)
	if err != nil {
		return nil, err
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
		err = json.Unmarshal(o["min"], &e.Min)
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
	for _, k := range []string{exRef, exTerminal} {
		if v, ok := o[k]; ok {
			name, err := decodeString(v)
			return &domExpr{Kind: k, Name: name}, err
		}
	}
	if isTrue(o["hash"]) {
		return &domExpr{Kind: exHash}, nil
	}
	if isTrue(o["empty"]) {
		return &domExpr{Kind: exEmpty}, nil
	}
	return nil, fmt.Errorf("unknown expression %s", string(raw))
}

func decodeTerm(raw json.RawMessage) (*domTerm, error) {
	o, err := decodeObj(raw)
	if err != nil {
		return nil, err
	}
	for _, k := range []string{tmLiteral, tmWeak, tmCapture, tmRule} {
		if v, ok := o[k]; ok {
			s, err := decodeString(v)
			return &domTerm{Kind: k, Str: s}, err
		}
	}
	if isTrue(o["emptySet"]) {
		return &domTerm{Kind: tmEmptySet}, nil
	}
	for _, k := range []string{tmSet, tmUnion, tmIntersection} {
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
	return nil, fmt.Errorf("unknown term %s", string(raw))
}

func decodeCond(raw json.RawMessage) (*domCond, error) {
	o, err := decodeObj(raw)
	if err != nil {
		return nil, err
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
	if v, ok := o["matches"]; ok {
		c := &domCond{Kind: cdMatches}
		if c.Span, err = decodeTerm(v); err != nil {
			return nil, err
		}
		c.Rule, err = decodeString(o["rule"])
		return c, err
	}
	if v, ok := o["not"]; ok {
		inner, err := decodeCond(v)
		return &domCond{Kind: cdNot, Inner: inner}, err
	}
	if v, ok := o["any"]; ok {
		items, err := decodeList(v, decodeCond)
		return &domCond{Kind: cdAny, Items: items}, err
	}
	return nil, fmt.Errorf("unknown condition %s", string(raw))
}

func decodeEmit(raw json.RawMessage) (*domEmit, error) {
	o, err := decodeObj(raw)
	if err != nil {
		return nil, err
	}
	if _, ok := o["nothing"]; ok {
		// Nothing alone, and without tags (§9).
		if !isTrue(o["nothing"]) || len(o) != 1 {
			return nil, fmt.Errorf("a malformed emission")
		}
		return &domEmit{Nothing: true}, nil
	}
	items, err := decodeList(o["items"], func(r json.RawMessage) (*domEmitItem, error) {
		io, err := decodeObj(r)
		if err != nil {
			return nil, err
		}
		it := &domEmitItem{}
		switch {
		case io["insert"] != nil:
			it.IsInsert = true
			it.Insert, err = decodeString(io["insert"])
		case io["this"] != nil:
			if !isTrue(io["this"]) {
				return nil, fmt.Errorf("a malformed emission item")
			}
			it.This = true
		case io["capture"] != nil:
			it.Capture, err = decodeString(io["capture"])
		default:
			err = fmt.Errorf("unknown emission item %s", string(r))
		}
		if err == nil && io["tags"] != nil {
			it.Tags, err = decodeTerm(io["tags"])
		}
		return it, err
	})
	return &domEmit{Items: items}, err
}
