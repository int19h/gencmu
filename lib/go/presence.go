package gencmu

import "slices"

// A rule's clauses split into parts by the presence of captures, so that
// simplifying them for each production (engine §3.6) costs that
// production's captures and what it keeps, not the number of parts. A
// union of guarded terms, ($c0 ⟹ ~t0) ∪ … ∪ ($c(n−1) ⟹ ~t(n−1)), over a
// choice of n captures, would otherwise cost each of its n productions all
// n parts.
//
// A part is fixed when it reads no presence of a capture: it simplifies
// the same way for every production, so it is simplified once. A part is
// guarded when it is $c ⟹ X with X fixed: it is X where c is present and
// nothing where it is not, so it is indexed by c. Every other part is
// simplified for each production, as written.

type partShape int8

const (
	partOther partShape = iota
	partFixed
	partGuarded
	// partJunction is an ∧ or an ∨ in a list of conditions that reads
	// presence, split into parts of its own.
	partJunction
)

// junctionOf is the junction of a condition of a list, or nil where it is
// not an ∧ or an ∨ of the other shape.
func junctionOf(c *domCond, shape partShape) *junction {
	if shape != partOther || (c.Kind != cdAll && c.Kind != cdAny) || len(c.Items) == 0 {
		return nil
	}
	return newJunction(c)
}

// junctionKey is where a junction is indexed: under a guard where it is
// an ∨, which is true where a production lacks it, or "" where it applies
// to every production.
func junctionKey(j *junction) string {
	key := ""
	if j.any {
		for _, g := range j.guards {
			presenceStep()
			if key == "" || g < key {
				key = g
			}
		}
	}
	return key
}

// presenceStep counts one step of the work of the split clauses.
func presenceStep() {
	if w := work.Load(); w != nil {
		w.readerSteps.add("reader steps")
	}
}

// readsPresence says whether a clause part holds a test of a capture's
// presence anywhere in it.
func readsPresence(p clausePart) bool {
	found := false
	walkClause(p, func(q clausePart) bool {
		if q.c != nil && q.c.Kind == cdCaptured {
			found = true
		}
		return !found
	})
	return found
}

// shapeOf is the shape of a part, and the capture that guards it.
func shapeOf(p clausePart) (partShape, string) {
	var premise *domCond
	var then clausePart
	switch {
	case p.t != nil && p.t.Kind == tmIf:
		premise, then = p.t.Cond, clausePart{t: p.t.Items[0]}
	case p.c != nil && p.c.Kind == cdIf:
		premise, then = p.c.Items[0], clausePart{c: p.c.Items[1]}
	}
	if premise != nil && premise.Kind == cdCaptured && !readsPresence(then) {
		return partGuarded, premise.Rule
	}
	if !readsPresence(p) {
		return partFixed, ""
	}
	return partOther, ""
}

// guardedBody is what a guarded part is where its capture is present.
func guardedBody(p clausePart) clausePart {
	if p.t != nil {
		return clausePart{t: p.t.Items[0]}
	}
	return clausePart{c: p.c.Items[1]}
}

// clauseSplit is a list of parts: the items of a union, the conditions of
// a list, or one clause alone. shared lists the parts that are not
// guarded, and byCapture the guarded parts under their captures, each in
// the order written.
type clauseSplit struct {
	parts     []clausePart
	shape     []partShape
	shared    []int
	byCapture map[string][]int
}

func splitParts(parts []clausePart) *clauseSplit {
	s := &clauseSplit{parts: parts, shape: make([]partShape, len(parts)), byCapture: map[string][]int{}}
	for i, p := range parts {
		presenceStep()
		shape, capture := shapeOf(p)
		s.shape[i] = shape
		if shape == partGuarded {
			s.byCapture[capture] = append(s.byCapture[capture], i)
		} else {
			s.shared = append(s.shared, i)
		}
	}
	return s
}

// termParts are the parts of a term: a union's items, or the term alone.
func termParts(t *domTerm) []clausePart {
	if t.Kind != tmUnion {
		return []clausePart{{t: t}}
	}
	out := make([]clausePart, 0, len(t.Items))
	for _, it := range t.Items {
		presenceStep()
		out = append(out, clausePart{t: it})
	}
	return out
}

// mergeIndices merges two lists of indices, each in increasing order,
// into one in increasing order. Each index counts before it is taken.
func mergeIndices(a, b []int) []int {
	out := make([]int, 0, len(a)+len(b))
	for len(a) > 0 || len(b) > 0 {
		presenceStep()
		if len(b) == 0 || (len(a) > 0 && a[0] < b[0]) {
			out, a = append(out, a[0]), a[1:]
		} else {
			out, b = append(out, b[0]), b[1:]
		}
	}
	return out
}

// partsFor lists, in the order written, the parts that apply to a
// production whose captures are names: the shared parts, and the guarded
// parts under the names. Each name looked up, each part found and each
// comparison of the sort counts before it is made.
func (s *clauseSplit) partsFor(names []string, shared []int) []int {
	var hits []int
	for _, name := range names {
		presenceStep()
		for _, i := range s.byCapture[name] {
			presenceStep()
			hits = append(hits, i)
		}
	}
	slices.SortFunc(hits, func(a, b int) int {
		presenceStep()
		return a - b
	})
	return mergeIndices(shared, hits)
}

// termLowering simplifies a term for each production, its parts split by
// the presence of captures. simplified holds each fixed part simplified,
// and each guarded part's term simplified, both once.
type termLowering struct {
	whole      *domTerm
	split      *clauseSplit
	simplified []*domTerm
	// changed says whether every production's union differs from the
	// term as written: it has a guarded part, which is never the part as
	// written, or a fixed part that simplified to another or to nothing.
	changed bool
	// kept are the fixed parts that are not empty and the other parts, in
	// the order written. A fixed part that is empty is in no production.
	kept []int
	// others says whether a part has neither shape. Where none has, a
	// production with no guarded part gives the same union as any other,
	// so base holds it once made.
	others bool
	base   *domTerm
}

func newTermLowering(t *domTerm) *termLowering {
	tl := &termLowering{whole: t, split: splitParts(termParts(t))}
	tl.simplified = make([]*domTerm, len(tl.split.parts))
	none := func(string) bool { return false }
	for i, p := range tl.split.parts {
		switch tl.split.shape[i] {
		case partFixed:
			s := simplifyTerm(p.t, none)
			tl.simplified[i] = s
			if s != p.t {
				tl.changed = true
			}
			if isEmptySet(s) {
				tl.changed = true
				continue
			}
		case partGuarded:
			tl.changed = true
			tl.simplified[i] = simplifyTerm(guardedBody(p).t, none)
			continue
		}
		if tl.split.shape[i] == partOther {
			tl.others = true
		}
		tl.kept = append(tl.kept, i)
	}
	return tl
}

// forProduction is what simplifyTerm gives for a production whose
// captures are names, by has: the same term, built from the parts that
// apply to the production alone.
func (tl *termLowering) forProduction(names []string, has func(string) bool) *domTerm {
	t := tl.whole
	value := func(i int) (*domTerm, bool) {
		p := tl.split.parts[i].t
		switch tl.split.shape[i] {
		case partFixed:
			return tl.simplified[i], tl.simplified[i] != p
		case partGuarded:
			return tl.simplified[i], true
		}
		s := simplifyTerm(p, has)
		return s, s != p
	}
	if t.Kind != tmUnion {
		if tl.split.shape[0] == partGuarded && len(tl.split.partsFor(names, nil)) == 0 {
			return reducedEmpty
		}
		v, _ := value(0)
		return v
	}
	hits := tl.split.partsFor(names, nil)
	same := len(hits) == 0 && !tl.others
	if same && tl.base != nil {
		return tl.base
	}
	var items []*domTerm
	changed := tl.changed
	for _, i := range mergeIndices(tl.kept, hits) {
		s, c := value(i)
		if c {
			changed = true
		}
		if isEmptySet(s) {
			changed = true
			continue
		}
		items = append(items, s)
	}
	var out *domTerm
	switch {
	case !changed:
		out = t
	case len(items) == 0:
		out = reducedEmpty
	case len(items) == 1:
		out = items[0]
	default:
		out = &domTerm{Kind: t.Kind, Str: t.Str, Items: items}
	}
	if same {
		tl.base = out
	}
	return out
}

// condLowering simplifies a list of conditions for each production, as
// addProduction does one by one. A fixed condition is simplified once.
// When it uses captures, it applies only where they are all present, so
// it is indexed under one of them like a guarded condition.
type condLowering struct {
	split *clauseSplit
	// simplified is each fixed condition simplified, and each guarded
	// condition's consequent, with the captures each uses.
	simplified []*domCond
	uses       []map[string]bool
	// always are the fixed conditions that use no capture but $.
	always []int
	// junctions holds each ∧ and ∨ split into its parts.
	junctions map[int]*junction
}

func newCondLowering(conds []*domCond) *condLowering {
	cl := &condLowering{split: &clauseSplit{byCapture: map[string][]int{}}, junctions: map[int]*junction{}}
	s := cl.split
	s.parts = make([]clausePart, len(conds))
	s.shape = make([]partShape, len(conds))
	cl.simplified = make([]*domCond, len(conds))
	cl.uses = make([]map[string]bool, len(conds))
	none := func(string) bool { return false }
	var others []int
	for i, c := range conds {
		presenceStep()
		p := clausePart{c: c}
		s.parts[i] = p
		shape, capture := shapeOf(p)
		body := p
		if shape == partGuarded {
			body = guardedBody(p)
		}
		var simplified *domCond
		if shape != partOther {
			// A condition without a presence test is left to the parse,
			// unless it is an empty ∧ or ∨, which is simplified for each
			// production as written.
			var tv truth
			simplified, tv = simplifyCond(body.c, none)
			if tv != open {
				shape = partOther
			}
		}
		s.shape[i] = shape
		if j := junctionOf(c, shape); j != nil {
			s.shape[i] = partJunction
			cl.junctions[i] = j
			// An ∨ is found under one of its guards, since it is true
			// where a production lacks it. Any other junction stands with
			// the conditions every production looks at.
			if key := junctionKey(j); key != "" {
				s.byCapture[key] = append(s.byCapture[key], i)
			} else {
				others = append(others, i)
			}
			continue
		}
		if shape == partOther {
			others = append(others, i)
			continue
		}
		cl.simplified[i] = simplified
		used := map[string]bool{}
		condCaptures(simplified, used)
		cl.uses[i] = used
		if shape == partGuarded {
			s.byCapture[capture] = append(s.byCapture[capture], i)
			continue
		}
		key := ""
		for name := range used {
			presenceStep()
			if name != "" && (key == "" || name < key) {
				key = name
			}
		}
		if key == "" {
			cl.always = append(cl.always, i)
		} else {
			s.byCapture[key] = append(s.byCapture[key], i)
		}
	}
	s.shared = mergeIndices(cl.always, others)
	return cl
}

// forProduction is the conditions that a production whose captures are
// names, by has, keeps, in the order written, or false where one became
// false and removes the production, as addProduction found them one by
// one.
func (cl *condLowering) forProduction(names []string, has func(string) bool) ([]*domCond, bool) {
	var conds []*domCond
	for _, i := range cl.split.partsFor(names, cl.split.shared) {
		c := cl.split.parts[i].c
		if shape := cl.split.shape[i]; shape == partOther || shape == partJunction {
			var s *domCond
			var tv truth
			if shape == partJunction {
				s, tv = cl.junctions[i].lower(names, has)
			} else {
				s, tv = simplifyCond(c, has)
			}
			switch tv {
			case alwaysTrue:
				continue
			case alwaysFalse:
				return nil, false
			}
			used := map[string]bool{}
			condCaptures(s, used)
			if _, ok := usesAll(used, has); ok {
				conds = append(conds, s)
			}
			continue
		}
		if usesAllCounted(cl.uses[i], has) {
			conds = append(conds, cl.simplified[i])
		}
	}
	return conds, true
}

// usesAllCounted is usesAll, each lookup counted before it is made.
func usesAllCounted(names map[string]bool, has func(string) bool) bool {
	for n := range names {
		presenceStep()
		if !has(n) {
			return false
		}
	}
	return true
}

// emitSplit indexes the items of an emission by their carriers. An
// inserted tag, or an item of $, is in every production, and an item of a
// capture only where its carrier is present (§3.6). attachers lists, by
// name, the items of a capture that attach it.
type emitSplit struct {
	shared    []int
	byCarrier map[string][]int
	attachers map[string][]int
}

func newEmitSplit(items []*domEmitItem) *emitSplit {
	es := &emitSplit{byCarrier: map[string][]int{}, attachers: map[string][]int{}}
	for i, it := range items {
		presenceStep()
		if it.IsInsert || it.Capture == "" {
			es.shared = append(es.shared, i)
		} else {
			es.byCarrier[it.Capture] = append(es.byCarrier[it.Capture], i)
		}
		if !it.IsInsert {
			for _, name := range it.attachments() {
				presenceStep()
				es.attachers[name] = append(es.attachers[name], i)
			}
		}
	}
	return es
}

// present lists the items that a production whose captures are names
// keeps, in the order written.
func (es *emitSplit) present(names []string) []int {
	var hits []int
	for _, name := range names {
		presenceStep()
		for _, i := range es.byCarrier[name] {
			presenceStep()
			hits = append(hits, i)
		}
	}
	slices.SortFunc(hits, func(a, b int) int {
		presenceStep()
		return a - b
	})
	return mergeIndices(es.shared, hits)
}

// strandsAttachment says whether a production, whose captures are names,
// has an attachment of an item whose carrier it lacks (engine §9).
func (es *emitSplit) strandsAttachment(items []*domEmitItem, names []string, has func(string) bool) bool {
	for _, name := range names {
		presenceStep()
		for _, i := range es.attachers[name] {
			presenceStep()
			if !has(items[i].Capture) {
				return true
			}
		}
	}
	return false
}

// termCheck finds, for the checks of a definition, whether a tag term
// uses a capture that a production lacks (engine §9), its parts split by
// the presence of captures. kind and req hold the outcome of each fixed
// part, and of each guarded part's term, found once: its kind, and the
// captures whose absence makes it lack one. fixedReq holds those of the
// fixed parts that are not empty, each once.
type termCheck struct {
	whole    *domTerm
	split    *clauseSplit
	kind     []int8
	req      [][]string
	fixedReq []string
	// others are the parts of neither shape, checked for each production.
	others []int
}

func newTermCheck(t *domTerm) *termCheck {
	tc := &termCheck{whole: t, split: splitParts(termParts(t))}
	tc.kind = make([]int8, len(tc.split.parts))
	tc.req = make([][]string, len(tc.split.parts))
	seen := map[string]bool{}
	for i, p := range tc.split.parts {
		shape := tc.split.shape[i]
		if shape == partOther {
			tc.others = append(tc.others, i)
			continue
		}
		if shape == partGuarded {
			p = guardedBody(p)
		}
		var req []string
		tc.kind[i] = simplifiedOutcome(p, nil, &req).kind
		tc.req[i] = req
		if shape == partFixed && tc.kind[i] != oEmpty {
			for _, name := range req {
				presenceStep()
				if !seen[name] {
					seen[name] = true
					tc.fixedReq = append(tc.fixedReq, name)
				}
			}
		}
	}
	return tc
}

// lacks says whether the term, simplified for a production whose captures
// are names, by has, uses a capture it lacks: whether some part that is
// not empty does. Each name looked up counts before it is.
func (tc *termCheck) lacks(names []string, has func(string) bool) bool {
	for _, name := range tc.fixedReq {
		presenceStep()
		if !has(name) {
			return true
		}
	}
	for _, i := range tc.split.partsFor(names, nil) {
		if tc.kind[i] == oEmpty {
			continue
		}
		for _, name := range tc.req[i] {
			presenceStep()
			if !has(name) {
				return true
			}
		}
	}
	for _, i := range tc.others {
		if o := simplifiedOutcome(tc.split.parts[i], has, nil); o.kind != oEmpty && o.lacks {
			return true
		}
	}
	return false
}

// condCheck finds, for the checks of a definition, whether each condition
// of a list applies to some production (engine §9). A condition applies
// where it is false, or where it is left to the parse and uses only
// captures the production has. A fixed condition that uses captures is
// indexed under one of them, since a production without it lacks it.
type condCheck struct {
	split *clauseSplit
	kind  []int8
	req   [][]string
	// applied marks each condition found to apply, and left counts those
	// not yet found. others are the conditions of neither shape not yet
	// found to apply.
	applied []bool
	left    int
	others  []int
	// junctions holds each ∧ and ∨ split into its parts.
	junctions map[int]*junction
}

// newCondCheck splits the conditions; skip says which need no check.
func newCondCheck(conds []*domCond, skip func(*domCond) bool) *condCheck {
	cc := &condCheck{split: &clauseSplit{byCapture: map[string][]int{}}, junctions: map[int]*junction{}}
	s := cc.split
	n := len(conds)
	s.parts, s.shape = make([]clausePart, n), make([]partShape, n)
	cc.kind, cc.req, cc.applied = make([]int8, n), make([][]string, n), make([]bool, n)
	var always []int
	for i, c := range conds {
		presenceStep()
		p := clausePart{c: c}
		s.parts[i] = p
		if skip(c) {
			cc.applied[i] = true
			continue
		}
		cc.left++
		shape, capture := shapeOf(p)
		s.shape[i] = shape
		if j := junctionOf(c, shape); j != nil {
			s.shape[i] = partJunction
			cc.junctions[i] = j
			if key := junctionKey(j); key != "" {
				s.byCapture[key] = append(s.byCapture[key], i)
			} else {
				cc.others = append(cc.others, i)
			}
			continue
		}
		if shape == partOther {
			cc.others = append(cc.others, i)
			continue
		}
		body := p
		if shape == partGuarded {
			body = guardedBody(p)
		}
		var req []string
		cc.kind[i] = simplifiedOutcome(body, nil, &req).kind
		cc.req[i] = req
		key := capture
		if shape == partFixed {
			for _, name := range req {
				presenceStep()
				if name != "" && (key == "" || name < key) {
					key = name
				}
			}
			if cc.kind[i] != oUses || key == "" {
				if cc.kind[i] != oTrue {
					always = append(always, i)
				}
				continue
			}
		}
		// A condition that is true where it is indexed applies nowhere.
		if cc.kind[i] != oTrue {
			s.byCapture[key] = append(s.byCapture[key], i)
		}
	}
	s.shared = always
	return cc
}

// applies says whether a condition of either indexed shape applies to a
// production, by has.
func (cc *condCheck) applies(i int, names []string, has func(string) bool) bool {
	if j := cc.junctions[i]; j != nil {
		kind, lacks := j.outcome(names, has)
		return kind == oFalse || (kind == oUses && !lacks)
	}
	switch cc.kind[i] {
	case oTrue:
		return false
	case oFalse:
		return true
	}
	for _, name := range cc.req[i] {
		presenceStep()
		if !has(name) {
			return false
		}
	}
	return true
}

// see marks the conditions that apply to a production whose captures are
// names, by has.
func (cc *condCheck) see(names []string, has func(string) bool) {
	mark := func(i int) {
		if !cc.applied[i] {
			cc.applied[i] = true
			cc.left--
		}
	}
	for _, i := range cc.split.partsFor(names, cc.split.shared) {
		if !cc.applied[i] && cc.applies(i, names, has) {
			mark(i)
		}
	}
	kept := cc.others[:0]
	for _, i := range cc.others {
		if cc.junctions[i] != nil {
			if cc.applies(i, names, has) {
				mark(i)
				continue
			}
			kept = append(kept, i)
			continue
		}
		o := simplifiedOutcome(cc.split.parts[i], has, nil)
		if o.kind == oFalse || (o.kind == oUses && !o.lacks) {
			mark(i)
			continue
		}
		kept = append(kept, i)
	}
	cc.others = kept
}

// junction is a condition that is an ∧ or an ∨ of parts, split by the
// presence of captures as a list of conditions is (§3.6). A guarded part
// $c ⟹ X is true where c is absent. So an ∨ is true where a production
// lacks one of its guards, and an ∧ drops such a part. A fixed part that
// decides the whole decides it for every production, and one that the
// whole drops is dropped for every production.
type junction struct {
	c     *domCond
	any   bool
	split *clauseSplit
	// For lowering: each fixed part simplified, and each guarded part's
	// consequent, with what it simplified to.
	simplified []*domCond
	tv         []truth
	// For the checks: the outcome of the same, with the captures whose
	// absence makes it lack one.
	kind []int8
	req  [][]string
	// guards are the captures that guard parts, each once, and guarded
	// all the guarded parts in order.
	guards  []string
	guarded []int
	// shared are the fixed parts that the whole keeps and the other parts,
	// in order. changed says whether the whole is rebuilt for every
	// production. decides and decidesO say whether a fixed part decides
	// the whole, in lowering and in the checks.
	shared            []int
	changed           bool
	decides, decidesO bool
	fixedReq          []string
}

// newJunction splits c, an ∧ or an ∨ of at least one part.
func newJunction(c *domCond) *junction {
	j := &junction{c: c, any: c.Kind == cdAny}
	parts := make([]clausePart, len(c.Items))
	for i, it := range c.Items {
		presenceStep()
		parts[i] = clausePart{c: it}
	}
	j.split = splitParts(parts)
	n := len(parts)
	j.simplified, j.tv = make([]*domCond, n), make([]truth, n)
	j.kind, j.req = make([]int8, n), make([][]string, n)
	dec, decO, dropO := alwaysFalse, oFalse, oTrue
	if j.any {
		dec, decO, dropO = alwaysTrue, oTrue, oFalse
	}
	none := func(string) bool { return false }
	seenGuard, seenReq := map[string]bool{}, map[string]bool{}
	var fixedKept, others []int
	for i, p := range parts {
		shape := j.split.shape[i]
		if shape == partOther {
			others = append(others, i)
			continue
		}
		body := p
		if shape == partGuarded {
			body = guardedBody(p)
			j.changed = true
			j.guarded = append(j.guarded, i)
			if g := p.c.Items[0].Rule; !seenGuard[g] {
				seenGuard[g] = true
				j.guards = append(j.guards, g)
			}
		}
		j.simplified[i], j.tv[i] = simplifyCond(body.c, none)
		var req []string
		j.kind[i] = simplifiedOutcome(body, nil, &req).kind
		j.req[i] = req
		if shape == partGuarded {
			continue
		}
		if j.tv[i] == dec {
			j.decides = true
		}
		if j.kind[i] == decO {
			j.decidesO = true
		}
		if j.tv[i] != open || j.simplified[i] != p.c {
			j.changed = true
		}
		if j.tv[i] == open {
			fixedKept = append(fixedKept, i)
		}
		if j.kind[i] != decO && j.kind[i] != dropO {
			for _, name := range req {
				presenceStep()
				if !seenReq[name] {
					seenReq[name] = true
					j.fixedReq = append(j.fixedReq, name)
				}
			}
		}
	}
	j.shared = mergeIndices(fixedKept, others)
	return j
}

// lacksGuard says whether a production lacks a capture that guards a part.
func (j *junction) lacksGuard(has func(string) bool) bool {
	for _, g := range j.guards {
		presenceStep()
		if !has(g) {
			return true
		}
	}
	return false
}

// present lists the guarded parts that apply to a production: every one
// in an ∨, which a missing guard has already decided, and in an ∧ those
// under the production's captures.
func (j *junction) present(names []string) []int {
	if j.any {
		return j.guarded
	}
	return j.split.partsFor(names, nil)
}

// lower is what simplifyCond gives for the junction for a production
// whose captures are names, by has.
func (j *junction) lower(names []string, has func(string) bool) (*domCond, truth) {
	dec, drop := alwaysFalse, alwaysTrue
	if j.any {
		dec, drop = alwaysTrue, alwaysFalse
	}
	if j.decides || (j.any && j.lacksGuard(has)) {
		return nil, dec
	}
	var items []*domCond
	changed := j.changed
	for _, i := range mergeIndices(j.shared, j.present(names)) {
		s, tv := j.simplified[i], j.tv[i]
		if j.split.shape[i] == partOther {
			s, tv = simplifyCond(j.split.parts[i].c, has)
			if s != j.split.parts[i].c {
				changed = true
			}
		}
		switch tv {
		case dec:
			return nil, dec
		case drop:
			changed = true
			continue
		}
		items = append(items, s)
	}
	switch {
	case len(items) == 0:
		return nil, drop
	case len(items) == 1:
		return items[0], open
	case !changed:
		return j.c, open
	}
	return &domCond{Kind: j.c.Kind, Items: items}, open
}

// outcome is what simplifiedOutcome gives for the junction for a
// production whose captures are names, by has: its kind, and whether it
// lacks a capture.
func (j *junction) outcome(names []string, has func(string) bool) (int8, bool) {
	decO, dropO := oFalse, oTrue
	if j.any {
		decO, dropO = oTrue, oFalse
	}
	if j.decidesO || (j.any && j.lacksGuard(has)) {
		return decO, false
	}
	kept, lacks := 0, false
	for _, i := range mergeIndices(j.shared, j.present(names)) {
		kind := j.kind[i]
		partLacks := false
		switch j.split.shape[i] {
		case partOther:
			o := simplifiedOutcome(j.split.parts[i], has, nil)
			kind, partLacks = o.kind, o.lacks
		case partGuarded:
			if kind == oUses {
				for _, name := range j.req[i] {
					presenceStep()
					if !has(name) {
						partLacks = true
						break
					}
				}
			}
		}
		switch kind {
		case decO:
			return decO, false
		case dropO:
			continue
		}
		kept++
		lacks = lacks || partLacks
	}
	// The fixed parts that the whole keeps lack what their captures say.
	for _, name := range j.fixedReq {
		if lacks {
			break
		}
		presenceStep()
		if !has(name) {
			lacks = true
		}
	}
	if kept == 0 {
		return dropO, false
	}
	return oUses, lacks
}
