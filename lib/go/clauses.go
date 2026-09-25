package gencmu

import (
	"fmt"
	"sort"
)

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

// simplifyCond simplifies a condition for a production that has the
// captures has says it has (engine §3.6): each presence test becomes true
// or false, A ⟹ B becomes B where A is true and true where A is false, a
// true B makes it true and a false one ¬A, and ¬, ∧ and ∨ over a true or
// false part are reduced as logic says. An open result is the condition
// left to evaluate; the one given is returned where nothing changed. A
// reduced part is never evaluated (§10).
func simplifyCond(c *domCond, has func(string) bool) (*domCond, truth) {
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
// intersection with one.
func simplifyTerm(t *domTerm, has func(string) bool) *domTerm {
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
		if then.Kind == tmEmptySet {
			return reducedEmpty
		}
		if cond == t.Cond && then == t.Items[0] {
			return t
		}
		return &domTerm{Kind: tmIf, Cond: cond, Items: []*domTerm{then}}
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
			if s.Kind == tmEmptySet {
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
	if t == nil {
		return
	}
	if t.Kind == tmCapture {
		into[t.Str] = true
	}
	if t.Cond != nil {
		condCaptures(t.Cond, into)
	}
	for _, it := range t.Items {
		termCaptures(it, into)
	}
}

func condCaptures(c *domCond, into map[string]bool) {
	switch c.Kind {
	case cdCompare:
		termCaptures(c.Left, into)
		termCaptures(c.Right, into)
	case cdMatches:
		termCaptures(c.Span, into)
	case cdNot:
		condCaptures(c.Inner, into)
	case cdAny, cdAll, cdIf:
		for _, it := range c.Items {
			condCaptures(it, into)
		}
	}
}

// termMentions adds every capture a term mentions, presence tests included.
func termMentions(t *domTerm, into map[string]bool) {
	if t == nil {
		return
	}
	if t.Kind == tmCapture {
		into[t.Str] = true
	}
	if t.Cond != nil {
		condMentions(t.Cond, into)
	}
	for _, it := range t.Items {
		termMentions(it, into)
	}
}

func condMentions(c *domCond, into map[string]bool) {
	switch c.Kind {
	case cdCaptured:
		into[c.Rule] = true
	case cdCompare:
		termMentions(c.Left, into)
		termMentions(c.Right, into)
	case cdMatches:
		termMentions(c.Span, into)
	case cdNot:
		condMentions(c.Inner, into)
	case cdAny, cdAll, cdIf:
		for _, it := range c.Items {
			condMentions(it, into)
		}
	}
}

// altCaptures maps each capture of an alternative to its position among the
// items of its top level; $ is at -1.
func altCaptures(a *domAlt) map[string]int {
	out := map[string]int{"": -1}
	items := []*domExpr{a.Expr}
	if a.Expr.Kind == exSeq {
		items = a.Expr.Items
	}
	for i, it := range items {
		if it.Kind == exCapture {
			out[it.Name] = i
		}
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

// definitionProblem is why a definition, a rule's alternatives with the
// clauses written with them, cannot be read (engine §9), or "". The DOM's
// shape must already be sound.
func definitionProblem(r *domRule) string {
	alts := make([]map[string]int, len(r.Alternatives))
	for i, a := range r.Alternatives {
		alts[i] = altCaptures(a)
	}
	var items []*domEmitItem
	if r.Emit != nil {
		items = r.Emit.Items
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
	for _, it := range items {
		if !it.IsInsert {
			mentioned[it.Capture] = true
		}
		termMentions(it.Tags, mentioned)
	}
	for _, name := range sortedKeys(mentioned) {
		found := false
		for _, caps := range alts {
			if _, ok := caps[name]; ok {
				found = true
				break
			}
		}
		if !found {
			return fmt.Sprintf("$%s is captured by no alternative of %s", name, r.Name)
		}
	}
	// A condition that applies to no alternative.
	for _, c := range r.Conditions {
		applies := false
		for _, caps := range alts {
			has := hasIn(caps)
			s, tv := simplifyCond(c, has)
			if tv == alwaysTrue {
				continue
			}
			if tv == alwaysFalse {
				applies = true
				break
			}
			used := map[string]bool{}
			condCaptures(s, used)
			if _, ok := usesAll(used, has); ok {
				applies = true
				break
			}
		}
		if !applies {
			return fmt.Sprintf("a condition of %s applies to no alternative", r.Name)
		}
	}
	unguarded := func(t *domTerm, has func(string) bool) string {
		if t == nil {
			return ""
		}
		used := map[string]bool{}
		termCaptures(simplifyTerm(t, has), used)
		if name, ok := usesAll(used, has); !ok {
			return fmt.Sprintf("a tag term of %s uses $%s, which an alternative lacks; guard it with $%s ⟹", r.Name, name, name)
		}
		return ""
	}
	for i, a := range r.Alternatives {
		caps := alts[i]
		has := hasIn(caps)
		// The tags an alternative's constituent carries serve it.
		for _, t := range []*domTerm{r.Tags, a.Tags} {
			if msg := unguarded(t, has); msg != "" {
				return msg
			}
		}
		if r.Emit == nil {
			continue
		}
		// What is left of the emission for this alternative: something, in
		// the order its captures stand, each item's tags using only what it
		// has.
		last, left := -2, 0
		for _, it := range items {
			if !it.IsInsert && !has(it.Capture) {
				continue
			}
			left++
			if it.IsInsert {
				continue
			}
			if it.Capture != "" {
				at := caps[it.Capture]
				if at < last {
					return fmt.Sprintf("%%emits of %s lists captures out of the order they stand in", r.Name)
				}
				last = at
			}
			if msg := unguarded(it.Tags, has); msg != "" {
				return msg
			}
		}
		// Only a rule that lists items can leave nothing; ε lists none.
		if left == 0 && len(items) > 0 {
			return fmt.Sprintf("%%emits of %s leaves an alternative nothing to emit; a rule that emits nothing says %%emits ε", r.Name)
		}
	}
	// An inserted tag's anchor, the capture listed next after it, is one
	// every alternative has.
	for i, it := range items {
		if !it.IsInsert {
			continue
		}
		for _, next := range items[i+1:] {
			if next.IsInsert {
				continue
			}
			for _, caps := range alts {
				if _, ok := caps[next.Capture]; !ok {
					return fmt.Sprintf("%%emits of %s inserts a tag before $%s, which an alternative lacks", r.Name, next.Capture)
				}
			}
			break
		}
	}
	return ""
}

func sortedKeys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func hasIn(caps map[string]int) func(string) bool {
	return func(name string) bool {
		_, ok := caps[name]
		return ok
	}
}
