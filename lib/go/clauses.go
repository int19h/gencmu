package gencmu

import "fmt"

// A rule's clauses against the captures of its alternatives (engine §3.6,
// §9): simplifying a clause for one production, the captures a clause uses
// or mentions, and the checks of a definition as a whole.

// truth is what a condition simplified to: a constant, or open, when it is
// left to be evaluated while parsing.
type truth int8

const (
	open truth = iota
	alwaysTrue
	alwaysFalse
)

// reducedEmpty is the empty set a term reduces to.
var reducedEmpty = &domTerm{Kind: tmEmptySet}

// isEmptySet says whether a term is the empty set as lowering sees it: ∅,
// or a constant whose value is an empty set, since a constant is its value
// there (§3.6).
func isEmptySet(t *domTerm) bool {
	return t.Kind == tmEmptySet || (t.Kind == tmConst && t.value != nil && t.value.ty != tyString && len(t.value.names) == 0)
}

// simplifyCond simplifies a condition for a production that has the
// captures has says it has (engine §3.6): each presence test becomes true
// or false, A ⟹ B becomes B where A is true and true where A is false, a
// true B makes it true and a false one ¬A, and ¬, ∧ and ∨ over a true or
// false part are reduced as logic says. An open result is the condition
// left to evaluate; the one given is returned where nothing changed. A
// reduced part is never evaluated (§10).
func simplifyCond(c *domCond, has func(string) bool) (*domCond, truth) {
	if w := work.Load(); w != nil {
		w.readerSteps.add("reader steps")
	}
	switch c.Kind {
	case cdCaptured:
		if has(c.Rule) {
			return nil, alwaysTrue
		}
		return nil, alwaysFalse
	case cdNot:
		inner, tv := simplifyCond(c.Inner, has)
		switch tv {
		case alwaysTrue:
			return nil, alwaysFalse
		case alwaysFalse:
			return nil, alwaysTrue
		}
		if inner == c.Inner {
			return c, open
		}
		return &domCond{Kind: cdNot, Inner: inner}, open
	case cdAll, cdAny:
		// A false part decides an all, a true part an any; the other
		// constant is dropped.
		decides, drops := alwaysFalse, alwaysTrue
		if c.Kind == cdAny {
			decides, drops = alwaysTrue, alwaysFalse
		}
		var items []*domCond
		changed := false
		for _, it := range c.Items {
			s, tv := simplifyCond(it, has)
			switch tv {
			case decides:
				return nil, decides
			case drops:
				changed = true
				continue
			}
			if s != it {
				changed = true
			}
			items = append(items, s)
		}
		switch {
		case len(items) == 0:
			return nil, drops
		case len(items) == 1:
			return items[0], open
		case !changed:
			return c, open
		}
		return &domCond{Kind: c.Kind, Items: items}, open
	case cdIf:
		premise, tv := simplifyCond(c.Items[0], has)
		if tv == alwaysFalse {
			return nil, alwaysTrue
		}
		then, ttv := simplifyCond(c.Items[1], has)
		switch {
		case tv == alwaysTrue:
			return then, ttv
		case ttv == alwaysTrue:
			return nil, alwaysTrue
		case ttv == alwaysFalse:
			return &domCond{Kind: cdNot, Inner: premise}, open
		case premise == c.Items[0] && then == c.Items[1]:
			return c, open
		}
		return &domCond{Kind: cdIf, Items: []*domCond{premise, then}}, open
	case cdCompare:
		l, r := simplifyTerm(c.Left, has), simplifyTerm(c.Right, has)
		if l == c.Left && r == c.Right {
			return c, open
		}
		return &domCond{Kind: cdCompare, Op: c.Op, Left: l, Right: r}, open
	}
	return c, open
}

// simplifyTerm simplifies a term for a production, as simplifyCond does a
// condition: a guarded term is its term where its condition is true, and
// the empty set where it is false or its term is empty; an empty set is
// dropped from a union, a union of nothing else is empty, and so is an
// intersection with one. A difference whose first part is empty is empty,
// and one whose second part is empty is its first part.
func simplifyTerm(t *domTerm, has func(string) bool) *domTerm {
	if w := work.Load(); w != nil {
		w.readerSteps.add("reader steps")
	}
	if t == nil {
		return nil
	}
	switch t.Kind {
	case tmIf:
		cond, tv := simplifyCond(t.Cond, has)
		switch tv {
		case alwaysFalse:
			return reducedEmpty
		case alwaysTrue:
			return simplifyTerm(t.Items[0], has)
		}
		then := simplifyTerm(t.Items[0], has)
		if isEmptySet(then) {
			return reducedEmpty
		}
		if cond == t.Cond && then == t.Items[0] {
			return t
		}
		return &domTerm{Kind: tmIf, Cond: cond, Items: []*domTerm{then}}
	case tmDifference:
		l, r := simplifyTerm(t.Items[0], has), simplifyTerm(t.Items[1], has)
		switch {
		case isEmptySet(l):
			return reducedEmpty
		case isEmptySet(r):
			return l
		case l == t.Items[0] && r == t.Items[1]:
			return t
		}
		return &domTerm{Kind: tmDifference, Items: []*domTerm{l, r}}
	case tmUnion, tmIntersection, tmCall:
		// An empty set, written ∅ or left by a guard, is dropped from a
		// union and makes an intersection empty.
		var items []*domTerm
		changed := false
		for _, it := range t.Items {
			s := simplifyTerm(it, has)
			if s != it {
				changed = true
			}
			if isEmptySet(s) {
				if t.Kind == tmIntersection {
					return reducedEmpty
				}
				if t.Kind == tmUnion {
					changed = true
					continue
				}
			}
			items = append(items, s)
		}
		switch {
		case !changed:
			return t
		case t.Kind == tmUnion && len(items) == 0:
			return reducedEmpty
		case t.Kind == tmUnion && len(items) == 1:
			return items[0]
		}
		return &domTerm{Kind: t.Kind, Str: t.Str, Items: items}
	}
	return t
}

// termCaptures adds the captures a term uses, as values or spans, "" for $;
// a presence test is not a use.
func termCaptures(t *domTerm, into map[string]bool) {
	walkClause(clausePart{t: t}, func(p clausePart) bool {
		if p.t != nil && p.t.Kind == tmCapture {
			into[p.t.Str] = true
		}
		return true
	})
}

func condCaptures(c *domCond, into map[string]bool) {
	walkClause(clausePart{c: c}, func(p clausePart) bool {
		if p.t != nil && p.t.Kind == tmCapture {
			into[p.t.Str] = true
		}
		return true
	})
}

// termMentions adds every capture a term mentions, presence tests included.
func termMentions(t *domTerm, into map[string]bool) {
	walkClause(clausePart{t: t}, func(p clausePart) bool {
		switch {
		case p.t != nil && p.t.Kind == tmCapture:
			into[p.t.Str] = true
		case p.c != nil && p.c.Kind == cdCaptured:
			into[p.c.Rule] = true
		}
		return true
	})
}

func condMentions(c *domCond, into map[string]bool) {
	walkClause(clausePart{c: c}, func(p clausePart) bool {
		switch {
		case p.t != nil && p.t.Kind == tmCapture:
			into[p.t.Str] = true
		case p.c != nil && p.c.Kind == cdCaptured:
			into[p.c.Rule] = true
		}
		return true
	})
}

// anyAltTags says whether an alternative of a rule has tags of its own.
func anyAltTags(r *domRule) bool {
	for _, a := range r.Alternatives {
		if a.Tags != nil {
			return true
		}
	}
	return false
}

// altCaptures lists, for each production of an alternative, each capture
// it reads with its place in the order read; $ is at -1 (engine §3.5).
// Productions that read the same captures in the same order are one.
func altCaptures(a *domAlt) []map[string]int {
	seqs := captureSequences(a.Expr)
	out := make([]map[string]int, len(seqs))
	for i, seq := range seqs {
		caps := map[string]int{"": -1}
		for j, c := range seq {
			caps[c.Name] = j
		}
		out[i] = caps
	}
	return out
}

// usesAll says whether a clause, simplified, uses only captures has has.
func usesAll(names map[string]bool, has func(string) bool) (string, bool) {
	for n := range names {
		if !has(n) {
			return n, false
		}
	}
	return "", true
}

// outcome is what a clause gives for a production once simplified (§3.6),
// as far as the checks of a definition need it: a condition true or false,
// or else whether its simplified form uses a capture the production lacks,
// the first such in the order written; a term empty, or else that capture.
type outcome struct {
	kind    int8
	lacks   bool
	missing string
}

const (
	oUses int8 = iota
	oTrue
	oFalse
	oEmpty
)

// simplifiedOutcome is the outcome of a clause for a production that has
// the captures has says it has. It walks the clause once, with an explicit
// stack, and builds no simplified clause, so a deep clause costs its size.
func simplifiedOutcome(start clausePart, has func(string) bool) outcome {
	type frame struct {
		p       clausePart
		combine bool
	}
	first := func(a, b outcome) outcome {
		if a.lacks {
			return outcome{kind: oUses, lacks: true, missing: a.missing}
		}
		return outcome{kind: oUses, lacks: b.lacks, missing: b.missing}
	}
	// What a part gives as written: the first capture it uses that the
	// production lacks.
	asWritten := func(p clausePart) outcome {
		used := outcome{kind: oUses}
		walkClause(p, func(q clausePart) bool {
			if !used.lacks && q.t != nil && q.t.Kind == tmCapture && !has(q.t.Str) {
				used = outcome{kind: oUses, lacks: true, missing: q.t.Str}
			}
			return !used.lacks
		})
		return used
	}
	kids := func(p clausePart) []clausePart {
		if p.t != nil {
			switch p.t.Kind {
			case tmIf, tmUnion, tmIntersection, tmDifference:
				return p.children()
			}
			return nil
		}
		switch p.c.Kind {
		case cdNot, cdAny, cdAll, cdIf, cdCompare:
			return p.children()
		}
		return nil
	}
	stack := []frame{{p: start}}
	var done []outcome
	for len(stack) > 0 {
		if w := work.Load(); w != nil {
			w.readerSteps.add("reader steps")
		}
		top := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		p := top.p
		if !top.combine {
			ks := kids(p)
			stack = append(stack, frame{p: p, combine: true})
			for i := len(ks) - 1; i >= 0; i-- {
				stack = append(stack, frame{p: ks[i]})
			}
			continue
		}
		n := len(kids(p))
		parts := appendCounted(nil, done[len(done)-n:], readerCount(), "reader steps")
		done = done[:len(done)-n]
		var o outcome
		if p.t != nil {
			switch p.t.Kind {
			case tmEmptySet:
				o = outcome{kind: oEmpty}
			case tmConst:
				// A constant is its value here; an empty one is ∅.
				if isEmptySet(p.t) {
					o = outcome{kind: oEmpty}
				} else {
					o = outcome{kind: oUses}
				}
			case tmIf:
				cond, then := parts[0], parts[1]
				switch {
				case cond.kind == oFalse || then.kind == oEmpty:
					o = outcome{kind: oEmpty}
				case cond.kind == oTrue:
					o = then
				default:
					o = first(cond, then)
				}
			case tmUnion:
				o = outcome{kind: oEmpty}
				for _, part := range parts {
					if part.kind == oEmpty {
						continue
					}
					if o.kind == oEmpty {
						o = part
					} else {
						o = first(o, part)
					}
				}
			case tmIntersection:
				o = outcome{kind: oUses}
				for _, part := range parts {
					if part.kind == oEmpty {
						o = outcome{kind: oEmpty}
						break
					}
					o = first(o, part)
				}
			case tmDifference:
				switch {
				case parts[0].kind == oEmpty:
					o = outcome{kind: oEmpty}
				case parts[1].kind == oEmpty:
					o = parts[0]
				default:
					o = first(parts[0], parts[1])
				}
			default:
				// A capture, a literal or a call, as written.
				o = asWritten(p)
			}
		} else {
			switch p.c.Kind {
			case cdCaptured:
				o = outcome{kind: oFalse}
				if has(p.c.Rule) {
					o = outcome{kind: oTrue}
				}
			case cdNot:
				o = parts[0]
				switch o.kind {
				case oTrue:
					o = outcome{kind: oFalse}
				case oFalse:
					o = outcome{kind: oTrue}
				}
			case cdAll, cdAny:
				decides, drops := oFalse, oTrue
				if p.c.Kind == cdAny {
					decides, drops = oTrue, oFalse
				}
				o = outcome{kind: drops}
				for _, part := range parts {
					if part.kind == decides {
						o = outcome{kind: decides}
						break
					}
					if part.kind == drops {
						continue
					}
					if o.kind == drops {
						o = part
					} else {
						o = first(o, part)
					}
				}
			case cdIf:
				premise, then := parts[0], parts[1]
				switch {
				case premise.kind == oFalse:
					o = outcome{kind: oTrue}
				case premise.kind == oTrue:
					o = then
				case then.kind == oTrue:
					o = outcome{kind: oTrue}
				case then.kind == oFalse:
					o = premise
				default:
					o = first(premise, then)
				}
			case cdCompare:
				// An empty side is ∅, which uses nothing.
				left, right := parts[0], parts[1]
				if left.kind == oEmpty {
					left = outcome{kind: oUses}
				}
				if right.kind == oEmpty {
					right = outcome{kind: oUses}
				}
				o = first(left, right)
			default:
				// matches(), begins() and initial(), as written.
				o = asWritten(p)
			}
		}
		done = append(done, o)
	}
	return done[0]
}

// definitionProblem is why a definition, a rule's alternatives with the
// clauses written with them, cannot be read (engine §9), or "". The DOM's
// shape must already be sound.
func definitionProblem(r *domRule) string {
	// A definition with no clause has nothing to check about its captures,
	// and its productions, whose number can be exponential, are not listed.
	if r.Tags == nil && len(r.Conditions) == 0 && r.Emit == nil && !anyAltTags(r) {
		return ""
	}
	// A constant is its value in simplification (§3.6). A clause that holds
	// a constant without one waits for the loader, which checks the
	// definition again once the constants have their values (§9).
	waits := func(node any) bool {
		for _, ref := range constRefs(node) {
			if ref.value == nil {
				return true
			}
		}
		return false
	}
	// Each production of each alternative, with the captures it reads
	// (engine §3.5, §9).
	type prodCaptures struct {
		caps map[string]int
		alt  *domAlt
	}
	var prods []prodCaptures
	var alts []map[string]int
	// How many productions capture each name, made once, so that a
	// mentioned name or an anchor is one lookup and not a search of every
	// production. Each name entered and each lookup counts before it is.
	step := func() {
		if w := work.Load(); w != nil {
			w.readerSteps.add("reader steps")
		}
	}
	capturedBy := map[string]int{}
	for _, a := range r.Alternatives {
		for _, caps := range altCaptures(a) {
			prods = append(prods, prodCaptures{caps, a})
			alts = append(alts, caps)
			for name := range caps {
				step()
				capturedBy[name]++
			}
		}
	}
	var items []*domEmitItem
	if r.Emit != nil {
		items = r.Emit.Items
	}
	// A constituent that does not count is never an opaque part (engine §9).
	if r.Opaque && r.Emit != nil && r.Emit.nothing() {
		return fmt.Sprintf("%s is opaque and emits ε", r.Name)
	}
	// A capture no alternative captures, wherever it is mentioned.
	mentioned := map[string]bool{}
	termMentions(r.Tags, mentioned)
	for _, c := range r.Conditions {
		condMentions(c, mentioned)
	}
	for _, a := range r.Alternatives {
		termMentions(a.Tags, mentioned)
	}
	// An emission item mentions its own capture and its attachments,
	// whatever else it says.
	for _, it := range items {
		if !it.IsInsert {
			mentioned[it.Capture] = true
			for _, name := range it.attachments() {
				mentioned[name] = true
			}
		}
		termMentions(it.Tags, mentioned)
	}
	names := make([]string, 0, len(mentioned))
	for name := range mentioned {
		step()
		names = append(names, name)
	}
	sortStrings(names, readerCount(), "reader steps")
	for _, name := range names {
		step()
		if capturedBy[name] == 0 {
			return fmt.Sprintf("$%s is captured by no production of %s", name, r.Name)
		}
	}
	// A condition that applies to no alternative.
	for _, c := range r.Conditions {
		if waits(c) {
			continue
		}
		applies := false
		for _, caps := range alts {
			o := simplifiedOutcome(clausePart{c: c}, hasIn(caps))
			if o.kind == oTrue {
				continue
			}
			if o.kind == oFalse || !o.lacks {
				applies = true
				break
			}
		}
		if !applies {
			return fmt.Sprintf("a condition of %s applies to no production", r.Name)
		}
	}
	unguarded := func(t *domTerm, has func(string) bool) string {
		if t == nil || waits(t) {
			return ""
		}
		if o := simplifiedOutcome(clausePart{t: t}, has); o.kind == oUses && o.lacks {
			return fmt.Sprintf("a tag term of %s uses $%s, which a production lacks; guard it with $%s ⟹", r.Name, o.missing, o.missing)
		}
		return ""
	}
	for _, prod := range prods {
		caps, a := prod.caps, prod.alt
		has := hasIn(caps)
		// The tags a production's constituent carries serve it.
		for _, t := range []*domTerm{r.Tags, a.Tags} {
			if msg := unguarded(t, has); msg != "" {
				return msg
			}
		}
		if r.Emit == nil {
			continue
		}
		// What is left of the emission for this production: something, in
		// the order its captures stand, each item's tags using only what it
		// has.
		var present []*domEmitItem
		for _, it := range items {
			if it.IsInsert || has(it.Capture) {
				present = append(present, it)
			}
		}
		// Only a rule that lists items can leave nothing; ε lists none.
		if len(present) == 0 && len(items) > 0 {
			return fmt.Sprintf("%%emits of %s leaves a production nothing to emit; a rule that emits nothing says %%emits ε", r.Name)
		}
		// A production without an item's carrier lacks its attachments too
		// (engine §9).
		for _, it := range items {
			if it.IsInsert || has(it.Capture) {
				continue
			}
			for _, name := range it.attachments() {
				if has(name) {
					return fmt.Sprintf("%%emits of %s attaches $%s in a production without its carrier $%s", r.Name, name, it.Capture)
				}
			}
		}
		// The written order of the captures, attachments included, is the
		// order they stand in (engine §9).
		last := -2
		for _, it := range present {
			if it.IsInsert || it.Capture == "" {
				continue
			}
			for _, name := range it.captures() {
				at, ok := caps[name]
				if !ok {
					continue
				}
				if at < last {
					return fmt.Sprintf("%%emits of %s lists captures out of the order they stand in", r.Name)
				}
				last = at
			}
		}
		for _, it := range present {
			if msg := unguarded(it.Tags, has); msg != "" {
				return msg
			}
		}
	}
	// An inserted tag's anchor, the capture listed next after it, is one
	// every production has.
	following := nextCaptureItems(items)
	for i, it := range items {
		if !it.IsInsert || following[i] < 0 {
			continue
		}
		next := items[following[i]]
		step()
		if capturedBy[next.Capture] < len(alts) {
			return fmt.Sprintf("%%emits of %s inserts a tag before $%s, which a production lacks", r.Name, next.Capture)
		}
	}
	return ""
}

// nextCaptureItems gives, for each emitted item, the index of the first
// item after it that is not an inserted tag, or -1. One backward pass finds
// every anchor, where a scan from each insert would cost a run of inserts
// its square.
func nextCaptureItems(items []*domEmitItem) []int {
	w := work.Load()
	out := make([]int, len(items))
	next := -1
	for i := len(items) - 1; i >= 0; i-- {
		if w != nil {
			w.emitSteps.add("emit steps")
		}
		out[i] = next
		if !items[i].IsInsert {
			next = i
		}
	}
	return out
}

func hasIn(caps map[string]int) func(string) bool {
	return func(name string) bool {
		_, ok := caps[name]
		return ok
	}
}
