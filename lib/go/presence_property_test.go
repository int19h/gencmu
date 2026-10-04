package gencmu

import (
	"math/rand"
	"slices"
	"testing"
)

// The clauses split by the presence of captures give, for every
// production, what simplifying each clause for that production as written
// gives (engine §3.6, §9). Random clauses of guarded, fixed and other parts
// are compared on random sets of captures.

type presenceGen struct {
	r *rand.Rand
}

var presenceNames = []string{"", "a", "b", "c", "d"}

func (g presenceGen) name() string { return presenceNames[g.r.Intn(len(presenceNames))] }

// term is a random term; presence says whether it may test presence.
func (g presenceGen) term(depth int, presence bool) *domTerm {
	k := g.r.Intn(9)
	if depth <= 0 {
		k = g.r.Intn(3)
	}
	switch k {
	case 0:
		return &domTerm{Kind: tmTag, Str: []string{"T", "U"}[g.r.Intn(2)]}
	case 1:
		return &domTerm{Kind: tmEmptySet}
	case 2:
		return &domTerm{Kind: tmCall, Str: "tags", Items: []*domTerm{{Kind: tmCapture, Str: g.name()}}}
	case 3, 4:
		var items []*domTerm
		for range 1 + g.r.Intn(3) {
			items = append(items, g.term(depth-1, presence))
		}
		return &domTerm{Kind: []string{tmUnion, tmIntersection}[k-3], Items: items}
	case 5:
		return &domTerm{Kind: tmDifference, Items: []*domTerm{g.term(depth-1, presence), g.term(depth-1, presence)}}
	default:
		return &domTerm{Kind: tmIf, Cond: g.cond(depth-1, presence), Items: []*domTerm{g.term(depth-1, presence)}}
	}
}

func (g presenceGen) cond(depth int, presence bool) *domCond {
	k := g.r.Intn(6)
	if depth <= 0 {
		k = g.r.Intn(2)
	}
	if k == 0 && !presence {
		k = 1
	}
	switch k {
	case 0:
		return &domCond{Kind: cdCaptured, Rule: g.name()}
	case 1:
		return &domCond{Kind: cdCompare, Op: "=", Left: g.term(depth-1, presence), Right: &domTerm{Kind: tmString, Str: "x"}}
	case 2:
		return &domCond{Kind: cdNot, Inner: g.cond(depth-1, presence)}
	case 3, 4:
		var items []*domCond
		for range 2 + g.r.Intn(2) {
			items = append(items, g.cond(depth-1, presence))
		}
		return &domCond{Kind: []string{cdAll, cdAny}[k-3], Items: items}
	default:
		return &domCond{Kind: cdIf, Items: []*domCond{g.cond(depth-1, presence), g.cond(depth-1, presence)}}
	}
}

// part is a random part of a union or a list: guarded, fixed or other.
func (g presenceGen) termPart() *domTerm {
	switch g.r.Intn(3) {
	case 0:
		return &domTerm{Kind: tmIf, Cond: &domCond{Kind: cdCaptured, Rule: g.name()}, Items: []*domTerm{g.term(2, false)}}
	case 1:
		return g.term(2, false)
	}
	return g.term(3, true)
}

func (g presenceGen) condPart() *domCond {
	switch g.r.Intn(3) {
	case 0:
		return &domCond{Kind: cdIf, Items: []*domCond{{Kind: cdCaptured, Rule: g.name()}, g.cond(2, false)}}
	case 1:
		return g.cond(2, false)
	}
	return g.cond(3, true)
}

// production is a random set of captures, $ always among them.
func (g presenceGen) production() ([]string, func(string) bool, map[string]int) {
	caps := map[string]int{"": -1}
	names := []string{""}
	for i, n := range presenceNames[1:] {
		if g.r.Intn(2) == 0 {
			caps[n] = i
			names = append(names, n)
		}
	}
	return names, hasIn(caps), caps
}

func termJSON(t *domTerm) string {
	var w jsonWriter
	t.writeJSON(&w)
	return string(w.buf)
}

func condJSON(c *domCond) string {
	var w jsonWriter
	c.writeJSON(&w)
	return string(w.buf)
}

func TestTermSplitAsWritten(t *testing.T) {
	g := presenceGen{rand.New(rand.NewSource(1))}
	for range 3000 {
		var term *domTerm
		if g.r.Intn(4) == 0 {
			term = g.termPart()
		} else {
			term = &domTerm{Kind: tmUnion}
			for range 1 + g.r.Intn(6) {
				term.Items = append(term.Items, g.termPart())
			}
		}
		tl, tc := newTermLowering(term), newTermCheck(term)
		for range 6 {
			names, has, _ := g.production()
			want, got := simplifyTerm(term, has), tl.forProduction(names, has)
			if termJSON(want) != termJSON(got) || (want == term) != (got == term) {
				t.Fatalf("%s for %v: %s, not %s", termJSON(term), names, termJSON(got), termJSON(want))
			}
			o := simplifiedOutcome(clausePart{t: term}, has, nil)
			if wantLacks := o.kind == oUses && o.lacks; tc.lacks(names, has) != wantLacks {
				t.Fatalf("%s for %v: lacks %v", termJSON(term), names, wantLacks)
			}
		}
	}
}

func TestCondSplitAsWritten(t *testing.T) {
	g := presenceGen{rand.New(rand.NewSource(2))}
	for range 3000 {
		var conds []*domCond
		for range 1 + g.r.Intn(6) {
			conds = append(conds, g.condPart())
		}
		cl := newCondLowering(conds)
		cc := newCondCheck(conds, func(*domCond) bool { return false })
		var prods []map[string]int
		for range 1 + g.r.Intn(4) {
			names, has, caps := g.production()
			prods = append(prods, caps)
			// The conditions as addProduction found them one by one.
			var want []string
			wantOK := true
			for _, c := range conds {
				s, tv := simplifyCond(c, has)
				if tv == alwaysTrue {
					continue
				}
				if tv == alwaysFalse {
					wantOK = false
					break
				}
				used := map[string]bool{}
				condCaptures(s, used)
				if _, ok := usesAll(used, has); ok {
					want = append(want, condJSON(s))
				}
			}
			got, ok := cl.forProduction(names, has)
			var gotJSON []string
			for _, c := range got {
				gotJSON = append(gotJSON, condJSON(c))
			}
			if ok != wantOK || (ok && !slices.Equal(gotJSON, want)) {
				t.Fatalf("%v: %v %v, not %v %v", names, ok, gotJSON, wantOK, want)
			}
			cc.see(names, has)
		}
		// Each condition applies to some production as definitionProblem
		// found it, condition by condition.
		left := 0
		for _, c := range conds {
			applies := false
			for _, caps := range prods {
				o := simplifiedOutcome(clausePart{c: c}, hasIn(caps), nil)
				if o.kind != oTrue && (o.kind == oFalse || !o.lacks) {
					applies = true
					break
				}
			}
			if !applies {
				left++
			}
		}
		if (left > 0) != (cc.left > 0) {
			t.Fatalf("%d conditions apply to no production, not %d", cc.left, left)
		}
	}
}

func TestEmitSplitAsWritten(t *testing.T) {
	g := presenceGen{rand.New(rand.NewSource(3))}
	for range 3000 {
		var items []*domEmitItem
		for range 1 + g.r.Intn(6) {
			if g.r.Intn(4) == 0 {
				items = append(items, &domEmitItem{IsInsert: true, Insert: "X"})
				continue
			}
			it := &domEmitItem{Capture: g.name()}
			if g.r.Intn(2) == 0 {
				it.Before = []string{g.name()}
			}
			if g.r.Intn(2) == 0 {
				it.After = []string{g.name()}
			}
			items = append(items, it)
		}
		es := newEmitSplit(items)
		for range 6 {
			names, has, _ := g.production()
			var want []int
			for i, it := range items {
				if it.IsInsert || has(it.Capture) {
					want = append(want, i)
				}
			}
			if got := es.present(names); !slices.Equal(got, want) {
				t.Fatalf("%v: present %v, not %v", names, got, want)
			}
			strands := false
			for _, it := range items {
				if it.IsInsert || has(it.Capture) {
					continue
				}
				for _, name := range it.attachments() {
					if has(name) {
						strands = true
					}
				}
			}
			if es.strandsAttachment(items, names, has) != strands {
				t.Fatalf("%v: strands %v", names, strands)
			}
		}
	}
}
