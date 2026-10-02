package gencmu

import (
	"errors"
	"fmt"
	"math/rand"
	"os"
	"strconv"
	"strings"
	"testing"
)

// Written-terminator priority (engine §4) checked against a search for
// eligible proof trees, found one by one, on small random grammars with
// chained elidable optionals. The search reads whether an omission is
// forbidden from the chart's links as the specification words it, with no
// precomputed tables.
//
// GENCMU_PROPERTY_CASES sets the number of cases (default 2000) and
// GENCMU_PROPERTY_SEED the first seed.

var errTooMany = errors.New("too many steps")

type proofOracle struct {
	r       *recognizer
	helpers map[int32]bool
	maximal map[int32]bool // the helpers of the optionals of maximal terminators
	budget  int
	// written and after remember the answers of readsWritten and
	// forbiddenAfter, which scan the whole chart.
	written map[*item]bool
	after   map[proofAfter]bool
}

type proofAfter struct {
	prefix *item
	p      int32
}

// prior is the item before the advance of a link of it. An advance from a
// predicted item does not hold it, so the oracle finds it in its set.
func (o *proofOracle) prior(it *item, l link) *item {
	if l.prev != nil {
		return l.prev
	}
	for _, x := range o.r.sets[it.origin].items {
		if x.prod == it.prod && x.dot == 0 && x.origin == it.origin {
			return x
		}
	}
	panic("no predicted item")
}

func (o *proofOracle) isHelper(rule int32) bool { return o.helpers[rule] }

// readsWritten says whether the chart advances an item over the nonempty
// alternative of the elidable optional after it.
func (o *proofOracle) readsWritten(x *item) bool {
	if v, ok := o.written[x]; ok {
		return v
	}
	v := o.scanWritten(x)
	o.written[x] = v
	return v
}

func (o *proofOracle) scanWritten(x *item) bool {
	for _, s := range o.r.sets {
		for _, it := range s.items {
			for _, l := range it.links {
				if l.sym != nil && o.isHelper(l.sym.rule) && l.sym.end > l.sym.start && o.prior(it, l) == x {
					return true
				}
			}
		}
	}
	return false
}

// forbiddenAfter says whether the chart advances a prefix over Y to some
// p′ ≥ p, and the item so made reads the optional as written.
func (o *proofOracle) forbiddenAfter(prefix *item, p int32) bool {
	k := proofAfter{prefix, p}
	if v, ok := o.after[k]; ok {
		return v
	}
	v := o.scanAfter(prefix, p)
	o.after[k] = v
	return v
}

func (o *proofOracle) scanAfter(prefix *item, p int32) bool {
	for _, s := range o.r.sets {
		for _, made := range s.items {
			for _, l := range made.links {
				if l.sym != nil && o.prior(made, l) == prefix && made.set >= p && o.readsWritten(made) {
					return true
				}
			}
		}
	}
	return false
}

// nextOptional is "constituent" where an elidable optional comes next after
// the node of a rule that can be longer, "alone" where one comes next
// without, and "" where none does.
func (o *proofOracle) nextOptional(x *item) string {
	rhs := x.prod.rhs
	if int(x.dot) >= len(rhs) || rhs[x.dot].term || !o.isHelper(rhs[x.dot].id) {
		return ""
	}
	if x.dot == 0 {
		return "alone"
	}
	if b := rhs[x.dot-1]; b.term || (x.dot == 1 && b.id == x.prod.lhs) {
		return "alone"
	}
	return "constituent"
}

// longer says whether the chart has a completed item of a constituent's
// rule from its origin that ends later.
func (o *proofOracle) longer(y *symNode) bool {
	for _, s := range o.r.sets {
		for _, c := range s.syms {
			if c.rule == y.rule && c.start == y.start && c.end > y.end {
				return true
			}
		}
	}
	return false
}

type proofState struct {
	it     *item
	permit bool
}

// search says whether an item has an eligible proof tree, and with permit,
// one whose own advance permits the optional after it to be empty. A tree
// never repeats an item in one state on one path, so a cycle alone proves
// nothing.
func (o *proofOracle) search(x *item, permit bool, path map[proofState]bool) (bool, error) {
	if o.budget--; o.budget < 0 {
		return false, errTooMany
	}
	key := proofState{x, permit}
	if path[key] {
		return false, nil
	}
	// The path holds the states above this one, while it is searched.
	path[key] = true
	defer delete(path, key)
	kind := ""
	if permit {
		kind = o.nextOptional(x)
	}
	if kind == "alone" && o.readsWritten(x) {
		return false, nil
	}
	if x.dot == 0 {
		return kind != "constituent", nil
	}
	for _, l := range x.links {
		b := o.prior(x, l)
		if kind == "constituent" && (l.sym == nil || o.forbiddenAfter(b, x.set)) {
			continue
		}
		// Before the optional of a maximal terminator, Y must also be the
		// longest that the chart has from its origin. The generated
		// grammars have no tests.
		if kind == "constituent" && o.maximal[x.prod.rhs[x.dot].id] && o.longer(l.sym) {
			continue
		}
		if l.sym == nil {
			ok, err := o.search(b, false, path)
			if ok || err != nil {
				return ok, err
			}
			continue
		}
		omission := o.isHelper(l.sym.rule) && l.sym.start == l.sym.end
		ok, err := o.search(b, omission, path)
		if err != nil {
			return false, err
		}
		if !ok {
			continue
		}
		for _, c := range l.sym.items {
			ok, err := o.search(c, false, path)
			if ok || err != nil {
				return ok, err
			}
		}
	}
	return false, nil
}

func TestEligibleProperty(t *testing.T) {
	cases := 2000
	if s := os.Getenv("GENCMU_PROPERTY_CASES"); s != "" {
		cases, _ = strconv.Atoi(s)
	}
	seed := int64(20261001)
	if s := os.Getenv("GENCMU_PROPERTY_SEED"); s != "" {
		seed, _ = strconv.ParseInt(s, 10, 64)
	}
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	rules := []string{"r", "t", "u", "v"}
	terms := []string{"A", "B", "T", "U"}
	checked, filtered, skipped := 0, 0, 0
	for c := 0; c < cases; c++ {
		r := rand.New(rand.NewSource(seed + int64(c)))
		symbol := func() string {
			if r.Intn(2) == 0 {
				return terms[r.Intn(len(terms))]
			}
			return rules[r.Intn(len(rules))]
		}
		body := func() string {
			var syms []string
			for i := r.Intn(4); i > 0; i-- {
				switch k := r.Intn(50); {
				case k < 10:
					syms = append(syms, "[T]")
				case k < 15:
					syms = append(syms, "[U]")
				case k < 19:
					syms = append(syms, "[T "+symbol()+"]")
				default:
					syms = append(syms, symbol())
				}
			}
			if len(syms) == 0 {
				return "ε"
			}
			return strings.Join(syms, " ")
		}
		var lines []string
		for _, rule := range rules {
			lines = append(lines, "%rule "+rule+" "+body()+" | "+body())
		}
		// Now and then T or U is a maximal terminator.
		elidable, maximalT := "%elidable T U", map[string]bool{}
		switch r.Intn(4) {
		case 0:
			elidable, maximalT = "%elidable U\n%elidable maximal T", map[string]bool{"T": true}
		case 1:
			elidable, maximalT = "%elidable maximal T U", map[string]bool{"T": true, "U": true}
		}
		grammar := "%ambiguity-resolution greedy\n" + elidable + "\n%rule text A\n" + strings.Join(lines, "\n")
		dom, err := bundled.reader.read("```jbogenbau\n"+grammar+"\n```\n", "g.md")
		if err != nil {
			skipped++
			continue
		}
		sg, serr := stitch("main", []docDOM{{path: "g.md", dom: dom}}, bundled.uni)
		if serr != nil {
			skipped++
			continue
		}
		lg := lower(sg, nil, false)
		if lg.fault != "" {
			skipped++
			continue
		}
		n := r.Intn(5)
		toks := make([]Token, n)
		var tags []string
		for i := range toks {
			tag := terms[r.Intn(len(terms))]
			toks[i] = Token{Text: "x", Tags: []string{tag}, Span: [2]int{i, i + 1}, Source: [2]int{2 * i, 2*i + 1}}
			tags = append(tags, tag)
		}
		ps := newParseState(bundled.uni, []rune(strings.TrimSpace(strings.Repeat("x ", n))))
		start := lg.byName["r"]
		rec := ps.newRun("main", sg, toks).recognize(lg, start, 0, n)
		// The items of begins: completed items of r from the start, in any
		// set.
		var items []*item
		for _, s := range rec.sets {
			for _, sym := range s.syms {
				if sym.rule == start && sym.start == 0 {
					items = append(items, sym.items...)
				}
			}
		}
		if len(items) == 0 {
			continue
		}
		o := &proofOracle{r: rec, helpers: map[int32]bool{}, maximal: map[int32]bool{}, budget: 200000, written: map[*item]bool{}, after: map[proofAfter]bool{}}
		for _, p := range lg.prods {
			if p.helper && p.elided != "" {
				o.helpers[p.lhs] = true
				if maximalT[p.elided] {
					o.maximal[p.lhs] = true
				}
			}
		}
		var want []bool
		tooMany := false
		for _, it := range items {
			ok, err := o.search(it, false, map[proofState]bool{})
			if err != nil {
				tooMany = true
				break
			}
			want = append(want, ok)
		}
		if tooMany {
			skipped++
			continue
		}
		kept := map[*item]bool{}
		for _, it := range rec.eligibleItems(items) {
			kept[it] = true
		}
		for i, it := range items {
			if kept[it] != want[i] {
				t.Fatalf("seed %d: item %d (%s, dot %d, [%d, %d)) eligible %v, want %v\n%s\ntokens %v", seed+int64(c), i, lg.rules[it.prod.lhs].name, it.dot, it.origin, it.set, kept[it], want[i], grammar, tags)
			}
		}
		for _, w := range want {
			if !w {
				filtered++
				break
			}
		}
		checked++
	}
	t.Logf("%d cases checked, %d with an item filtered out, %d skipped", checked, filtered, skipped)
	if checked <= cases/4 || filtered <= cases/50 {
		t.Errorf("%s", fmt.Sprintf("%d cases checked, %d with an item filtered out", checked, filtered))
	}
}
