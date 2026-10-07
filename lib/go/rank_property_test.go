package gencmu

import (
	"fmt"
	"math/rand"
	"os"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"
)

// The ranking checked against its definition (engine §6): small random
// grammars with ε, left recursion and unary cycles, short random inputs
// with several tags on a token, every derivation enumerated by brute force
// (cyclic ones excluded as engine §4 defines them), and the verdict, the
// chosen derivation, the tied one and the witness computed from the
// definitions and compared with the library's. A share of the cases rank
// under late-elision, with T elidable. Under another rule too, T is now and
// then elidable, and then the stage now and then declares maximal. Rule
// references are now and then tested by their sound, often right before an
// elidable optional. The input can be empty.
//
// The oracle enumerates the derivations from the grammar alone, applying
// tests and maximal on its own terms. A ranking must be nil exactly when no
// derivation counts, and the stage's verdict must agree with the oracle.
//
// GENCMU_PROPERTY_CASES sets the number of cases (default 1500) and
// GENCMU_PROPERTY_SEED the first seed, for a larger sweep.

type genGrammar struct {
	r        *rand.Rand
	rules    []string
	terms    []string
	late     bool // late-elision, with T elidable
	elidable bool // T is elidable
	maximal  bool // the stage declares maximal
}

func (g *genGrammar) ref() *domExpr {
	if g.r.Intn(2) == 0 {
		return &domExpr{Kind: exRef, Name: g.terms[g.r.Intn(len(g.terms))]}
	}
	return g.ruleRef()
}

// ruleRef is a reference to a rule, now and then tested by its sound
// (engine §4).
func (g *genGrammar) ruleRef() *domExpr {
	ref := &domExpr{Kind: exRef, Name: g.rules[g.r.Intn(len(g.rules))]}
	switch k := g.r.Intn(20); {
	case k < 3:
		return &domExpr{Kind: exTest, Inner: ref, Op: "=", Value: &domTerm{Kind: tmString, Str: "x"}}
	case k < 5:
		return &domExpr{Kind: exTest, Inner: ref, Op: "≠", Value: &domTerm{Kind: tmString, Str: "x"}}
	}
	return ref
}

// elidableOptional is [+T] or [+T x] (engine §3.8).
func (g *genGrammar) elidableOptional() *domExpr {
	t := &domExpr{Kind: exRef, Name: "T"}
	if g.r.Intn(2) == 0 {
		return &domExpr{Kind: exOptional, Inner: t, Elidable: true, Maximal: g.maximal}
	}
	return &domExpr{Kind: exOptional, Inner: &domExpr{Kind: exSeq, Items: []*domExpr{t, g.ref()}}, Elidable: true, Maximal: g.maximal}
}

func (g *genGrammar) item(depth int) *domExpr {
	k := g.r.Intn(20)
	if depth > 1 && k >= 12 {
		k = 0
	}
	switch {
	case k < 11:
		return g.ref()
	case k < 13:
		return &domExpr{Kind: exOptional, Inner: g.seq(depth + 1)}
	case k < 14:
		return &domExpr{Kind: exRepeat, Inner: g.ref()}
	case k < 16:
		return &domExpr{Kind: exOptional, Inner: &domExpr{Kind: exRepeat, Inner: g.ref()}}
	case k < 17:
		return &domExpr{Kind: exRepeat, Inner: g.ref(), Sep: &domExpr{Kind: exRef, Name: g.terms[g.r.Intn(len(g.terms))]}}
	case k < 18:
		return &domExpr{Kind: exChoice, Items: []*domExpr{g.seq(depth + 1), g.seq(depth + 1)}}
	case k < 19:
		return &domExpr{Kind: exAnd, Items: []*domExpr{g.ref(), g.ref()}}
	}
	return &domExpr{Kind: exEmpty}
}

func (g *genGrammar) seq(depth int) *domExpr {
	n := g.r.Intn(3) + 1
	if depth == 0 {
		n = g.r.Intn(4)
	}
	if n == 0 {
		return &domExpr{Kind: exEmpty}
	}
	var items []*domExpr
	for i := 0; i < n; i++ {
		if g.elidable && g.r.Intn(4) == 0 {
			// An elidable optional, often right after a rule, whose node
			// maximal tests.
			if g.r.Intn(2) == 0 {
				items = append(items, g.ruleRef())
			}
			items = append(items, g.elidableOptional())
			continue
		}
		items = append(items, g.item(depth))
	}
	if len(items) == 1 {
		return items[0]
	}
	return &domExpr{Kind: exSeq, Items: items}
}

func (g *genGrammar) grammar() *domDoc {
	d := &domDoc{}
	lean := "greedy"
	if g.r.Intn(2) == 0 {
		lean = "lazy"
	}
	if g.late {
		lean = "late-elision"
	}
	args := []string{lean}
	d.Directives = []*domDirective{{Name: "ambiguity-resolution", Args: args}}
	for _, name := range g.rules {
		r := &domRule{Name: name, Op: "define"}
		if g.r.Intn(100) < 35 {
			r.Flags = []string{"greedy"}
		}
		// Now and then a rule is a chain, whose levels are its own nodes
		// (engine §3.3).
		if name != "text" {
			if k := g.r.Intn(20); k < 2 {
				item := func() *domExpr {
					if g.r.Intn(2) == 0 {
						return &domExpr{Kind: exRef, Name: g.terms[g.r.Intn(len(g.terms))]}
					}
					return g.ruleRef()
				}
				r.Alternatives = []*domAlt{{Expr: &domExpr{Kind: exRepeat, Inner: item(), Sep: item(), Chain: []string{"left", "right"}[k]}}}
				d.Rules = append(d.Rules, r)
				continue
			}
		}
		n := g.r.Intn(3) + 1
		for i := 0; i < n; i++ {
			var e *domExpr
			switch g.r.Intn(8) {
			case 0: // a unary step, for cycles
				e = &domExpr{Kind: exRef, Name: g.rules[g.r.Intn(len(g.rules))]}
			case 1: // left recursion
				e = &domExpr{Kind: exSeq, Items: []*domExpr{{Kind: exRef, Name: name}, g.ref()}}
			default:
				e = g.seq(0)
			}
			alt := &domAlt{Expr: e}
			switch g.r.Intn(8) {
			case 0: // a constant tag term
				alt.Tags = &domTerm{Kind: tmTag, Str: []string{"P", "Q"}[g.r.Intn(2)]}
			case 1, 2: // a captured symbol's tags, grown by one, which splits items by tag set
				target := &alt.Expr
				if e.Kind == exSeq {
					target = &e.Items[g.r.Intn(len(e.Items))]
				}
				if (*target).Kind == exRef {
					*target = &domExpr{Kind: exCapture, Name: "x", Inner: *target}
					alt.Tags = &domTerm{Kind: tmUnion, Items: []*domTerm{
						{Kind: tmCall, Str: "tags", Items: []*domTerm{{Kind: tmCapture, Str: "x"}}},
						{Kind: tmTag, Str: []string{"P", "Q"}[g.r.Intn(2)]},
					}}
				}
			}
			r.Alternatives = append(r.Alternatives, alt)
		}
		d.Rules = append(d.Rules, r)
	}
	return d
}

func exprText(e *domExpr) string {
	switch e.Kind {
	case exSeq, exAnd, exChoice:
		sep := map[string]string{exSeq: " ", exAnd: " & ", exChoice: " | "}[e.Kind]
		var parts []string
		for _, it := range e.Items {
			s := exprText(it)
			if it.Kind == exChoice || (e.Kind == exSeq && it.Kind == exAnd) {
				s = "(" + s + ")"
			}
			parts = append(parts, s)
		}
		return strings.Join(parts, sep)
	case exOptional:
		if e.Maximal {
			return "[++" + exprText(e.Inner) + "]"
		}
		if e.Elidable {
			return "[+" + exprText(e.Inner) + "]"
		}
		return "[" + exprText(e.Inner) + "]"
	case exRepeat:
		item := exprText(e.Inner)
		switch e.Chain {
		case "left":
			item = "... " + item
		case "right":
			item += " ..."
		}
		if e.Sep != nil {
			item += " \\ " + exprText(e.Sep)
		}
		return "{" + item + "}"
	case exEmpty:
		return "ε"
	case exCapture:
		return "$" + e.Name + "(" + exprText(e.Inner) + ")"
	case exTest:
		return exprText(e.Inner) + e.Op + strconv.Quote(e.Value.Str)
	}
	return e.Name
}

func domText(d *domDoc) string {
	var b strings.Builder
	fmt.Fprintf(&b, "%%ambiguity-resolution %s\n", strings.Join(d.Directives[0].Args, " "))
	for _, dir := range d.Directives[1:] {
		fmt.Fprintf(&b, "%%%s %s\n", dir.Name, strings.Join(dir.Args, " "))
	}
	for _, r := range d.Rules {
		var alts []string
		for _, a := range r.Alternatives {
			text := exprText(a.Expr)
			if a.Tags != nil {
				var w jsonWriter
				a.Tags.writeJSON(&w)
				text += " <" + string(w.buf) + ">"
			}
			alts = append(alts, text)
		}
		flag := ""
		if len(r.Flags) > 0 {
			flag = "(greedy)"
		}
		fmt.Fprintf(&b, "%%rule%s %s\n  %s\n", flag, r.Name, strings.Join(alts, " | "))
	}
	return b.String()
}

// ---- brute force

type bnode struct {
	read  bool
	tok   int
	term  int32
	prod  *production
	start int
	end   int
	kids  []*bnode
}

type enumerator struct {
	g      *lowered
	tags   []map[string]bool
	sounds []string // each token's phonemes
	memo   map[string][]*bnode
	work   int
	budget int
	// maximal leaves out a derivation with an elided terminator whose
	// constituent could have been longer; plain enumerates without it, to
	// find the longer constituents (engine §4).
	maximal bool
	plain   *enumerator
}

// soundHolds says whether a sound test holds of the tokens [i, j): their
// phonemes joined are its string, or are not, for ≠ (engine §4, §5).
func (en *enumerator) soundHolds(t *symTest, i, j int) bool {
	if t.op != "=" && t.op != "≠" {
		panic("the generator makes only sound tests")
	}
	return (strings.Join(en.sounds[i:j], "") == t.sound) == (t.op == "=")
}

// longer says whether a symbol with a test, or nil, also derives a span from
// i that ends after j, where the test holds too.
func (en *enumerator) longer(sym symbol, t *symTest, i, j int) (bool, error) {
	for e := j + 1; e < len(en.sounds)+1; e++ {
		if t != nil && !en.soundHolds(t, i, e) {
			continue
		}
		ds, err := en.plain.derive(sym, i, e, nil)
		if err != nil {
			return false, err
		}
		if len(ds) > 0 {
			return true, nil
		}
	}
	return false, nil
}

// isElidedNode says whether a node is an elided terminator: the empty
// production of an elidable optional's helper.
func isElidedNode(n *bnode) bool {
	return !n.read && n.prod.helper && n.prod.elided != "" && len(n.prod.rhs) == 0
}

var errBudget = fmt.Errorf("over budget")

func (en *enumerator) derive(sym symbol, i, j int, f []int32) ([]*bnode, error) {
	if sym.term {
		if j == i+1 {
			if _, ok := en.tags[i][en.g.terminals[sym.id]]; ok {
				return []*bnode{{read: true, tok: i, term: sym.id}}, nil
			}
		}
		return nil, nil
	}
	for _, r := range f {
		if r == sym.id {
			return nil, nil
		}
	}
	key := fmt.Sprint(sym.id, i, j, f)
	if v, ok := en.memo[key]; ok {
		return v, nil
	}
	inner := append(append([]int32{}, f...), sym.id)
	sort.Slice(inner, func(a, b int) bool { return inner[a] < inner[b] })
	var out []*bnode
	for _, p := range en.g.rules[sym.id].prods {
		// Every way of splitting [i, j] among the production's symbols.
		var rec func(pos, at int, kids []*bnode) error
		rec = func(pos, at int, kids []*bnode) error {
			if pos == len(p.rhs) {
				if at == j {
					out = append(out, &bnode{prod: p, start: i, end: j, kids: append([]*bnode{}, kids...)})
					en.work++
					if en.work > en.budget {
						return errBudget
					}
				}
				return nil
			}
			for e := at; e <= j; e++ {
				var cf []int32
				if at == i && e == j {
					cf = inner
				}
				if t := p.testAt(pos); t != nil && !en.soundHolds(t, at, e) {
					continue
				}
				ds, err := en.derive(p.rhs[pos], at, e, cf)
				if err != nil {
					return err
				}
				// Under maximal, an elided terminator cannot follow the node
				// before it where that could have been longer. A terminal, a
				// first symbol, and what a production whose first symbol is
				// its own rule has read so far are not guarded.
				guarded := en.maximal && pos > 0 && !(pos == 1 && !p.rhs[0].term && p.rhs[0].id == p.lhs) && !kids[pos-1].read
				for _, d := range ds {
					if guarded && isElidedNode(d) {
						prev := kids[pos-1]
						long, err := en.longer(p.rhs[pos-1], p.testAt(pos-1), prev.start, prev.end)
						if err != nil {
							return err
						}
						if long {
							continue
						}
					}
					if err := rec(pos+1, e, append(kids, d)); err != nil {
						return err
					}
				}
			}
			return nil
		}
		if err := rec(0, i, nil); err != nil {
			return nil, err
		}
	}
	en.memo[key] = out
	return out, nil
}

func bnodeActions(n *bnode, into []action) []action {
	if n.read {
		return append(into, action{read: true, tok: int32(n.tok), term: n.term})
	}
	for _, k := range n.kids {
		into = bnodeActions(k, into)
	}
	return append(into, action{prod: n.prod, start: int32(n.start), end: int32(n.end)})
}

func visibleOnly(as []action) []action {
	var out []action
	for _, a := range as {
		if a.visible() {
			out = append(out, a)
		}
	}
	return out
}

type bderiv struct {
	whole, vis []action
	profile    []int
	// elisions is the elision vector (engine §6), as the positions of the
	// derivation's elided terminators in text order.
	elisions []int32
}

func elisionsOf(whole []action) []int32 {
	var out []int32
	for _, a := range whole {
		if !a.read && a.prod.helper && a.prod.elided != "" && len(a.prod.rhs) == 0 {
			out = append(out, a.start)
		}
	}
	return out
}

// compareVectors compares two elision vectors as counts at each boundary,
// from the first: -1 when x is less.
func compareVectors(x, y []int32) int {
	count := func(ps []int32, at int32) int {
		n := 0
		for _, p := range ps {
			if p == at {
				n++
			}
		}
		return n
	}
	var bounds []int32
	bounds = append(append(bounds, x...), y...)
	sort.Slice(bounds, func(i, j int) bool { return bounds[i] < bounds[j] })
	for _, at := range bounds {
		if d := count(x, at) - count(y, at); d != 0 {
			if d < 0 {
				return -1
			}
			return 1
		}
	}
	return 0
}

// bruteCompare returns: whether the first difference is decided (and for
// whom), the tie-break order, and where the visible sequences diverge.
type bcmp struct {
	visDiff bool
	pos     int // visible position of the difference; the shorter length for a prefix; bruteInf if visibly equal
	outcome int
	aFirst  bool
	pair    [2]action // the witness pair
}

func bruteCompare(rk *ranker, x, y bderiv) bcmp {
	n := min(len(x.vis), len(y.vis))
	wholeDiff := func() [2]action {
		for i := 0; i < min(len(x.whole), len(y.whole)); i++ {
			if x.whole[i] != y.whole[i] {
				return [2]action{x.whole[i], y.whole[i]}
			}
		}
		panic("identical derivations")
	}
	for i := 0; i < n; i++ {
		if x.vis[i] != y.vis[i] {
			c := bcmp{visDiff: true, pos: i, outcome: rk.decide(x.vis[i], y.vis[i]), pair: [2]action{x.vis[i], y.vis[i]}}
			switch c.outcome {
			case oA:
				c.aFirst = true
			case oB:
				c.aFirst = false
			default:
				c.aFirst = rk.canonLess(x.vis[i], y.vis[i])
			}
			return c
		}
	}
	c := bcmp{pos: n, pair: wholeDiff()}
	if len(x.vis) == len(y.vis) {
		c.pos = bruteInf
		c.aFirst = rk.canonLess(c.pair[0], c.pair[1])
	} else {
		// A visible prefix precedes its extensions.
		c.aFirst = len(x.vis) < len(y.vis)
	}
	return c
}

// bruteInf is the divergence of derivations that differ only in
// transparent actions, beyond every position of a small case.
const bruteInf = 1 << 30

type bruteResult struct {
	count   int
	verdict string
	chosen  []action
	tied    []action
	witness [2]action
}

// The oracle counts named closes in a dense span matrix.
// It reads flag assignments from the generated source definitions.
func bruteProfile(whole []action, n int, flags map[string]bool) []int {
	counts := make([][]int, n+1)
	for i := range counts {
		counts[i] = make([]int, n+1)
	}
	for _, a := range whole {
		if !a.read && !a.prod.helper && flags[a.prod.ruleName] && a.start < a.end {
			counts[a.start][a.end]++
		}
	}
	var profile []int
	for start := 0; start < n; start++ {
		for end := n; end > start; end-- {
			profile = append(profile, counts[start][end])
		}
	}
	return profile
}

func compareBruteProfiles(left, right []int) int {
	for i := range left {
		if left[i] > right[i] {
			return -1
		}
		if left[i] < right[i] {
			return 1
		}
	}
	return 0
}

// bruteRank compares profiles first and then the stage preference.
func bruteRank(rk *ranker, ds []bderiv) (*bruteResult, error) {
	if len(ds) == 0 {
		return nil, nil
	}
	late := rk.elisions
	tFirst := func(x, y bderiv) bool {
		if c := compareBruteProfiles(x.profile, y.profile); c != 0 {
			return c < 0
		}
		if late {
			if c := compareVectors(x.elisions, y.elisions); c != 0 {
				return c < 0
			}
		}
		return bruteCompare(rk, x, y).aFirst
	}
	m := 0
	for i := 1; i < len(ds); i++ {
		if !tFirst(ds[m], ds[i]) {
			m = i
		}
	}
	res := &bruteResult{count: min(len(ds), 2), chosen: ds[m].whole}
	t, tdiv := -1, 0
	for i := range ds {
		if i == m {
			continue
		}
		if compareBruteProfiles(ds[m].profile, ds[i].profile) != 0 {
			continue
		}
		if late && compareVectors(ds[m].elisions, ds[i].elisions) != 0 {
			continue // m beats it
		}
		c := bruteCompare(rk, ds[m], ds[i])
		if !c.aFirst {
			g := rk.rec.g
			var chain []string
			for j := range ds {
				if j != m && j != i && bruteCompare(rk, ds[m], ds[j]).aFirst && bruteCompare(rk, ds[j], ds[i]).aFirst {
					chain = append(chain, actionsText(g, ds[j].whole))
					break
				}
			}
			return nil, fmt.Errorf("T is not transitive: m precedes a third, which precedes d, which precedes m\n  m %s\n  d %s\n  third %s", actionsText(g, ds[m].whole), actionsText(g, ds[i].whole), strings.Join(chain, ""))
		}
		if c.visDiff && c.outcome != oTie {
			continue
		}
		if t < 0 || c.pos < tdiv || (c.pos == tdiv && bruteCompare(rk, ds[i], ds[t]).aFirst) {
			t, tdiv = i, c.pos
			res.witness = c.pair
		}
	}
	switch {
	case len(ds) == 1:
		res.verdict = VerdictUnique
	case t >= 0:
		res.verdict = VerdictTie
		res.tied = ds[t].whole
	default:
		res.verdict = VerdictResolved
	}
	return res, nil
}

func dnActions(d *dn) []action {
	var out []action
	var it actionIter
	it.push(d)
	for {
		e, ok := it.top()
		if !ok {
			return out
		}
		if isLeaf(e) {
			out = append(out, elAction(e))
			it.pop()
			continue
		}
		it.expand()
	}
}

func actionsText(g *lowered, as []action) string {
	var parts []string
	for _, a := range as {
		if a.read {
			parts = append(parts, fmt.Sprintf("read %d %s", a.tok, g.terminals[a.term]))
		} else {
			mark := ""
			if a.prod.transparent {
				mark = "~"
			}
			parts = append(parts, fmt.Sprintf("%sclose %s#%d [%d,%d]", mark, g.rules[a.prod.lhs].name, a.prod.num, a.start, a.end))
		}
	}
	return strings.Join(parts, ", ")
}

func sameActions(a, b []action) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

var printDerivations = false

func TestRankingProperty(t *testing.T) {
	cases := 5000
	if s := os.Getenv("GENCMU_PROPERTY_CASES"); s != "" {
		cases, _ = strconv.Atoi(s)
	}
	seed := int64(1)
	if s := os.Getenv("GENCMU_PROPERTY_ONLY"); s != "" {
		cases = 1
		seed, _ = strconv.ParseInt(s, 10, 64)
		printDerivations = true
	} else if s := os.Getenv("GENCMU_PROPERTY_SEED"); s != "" {
		seed, _ = strconv.ParseInt(s, 10, 64)
	}
	leanNone, lateShare, maxTokens := 25, 30, 4
	if s := os.Getenv("GENCMU_PROPERTY_TOKENS"); s != "" {
		maxTokens, _ = strconv.Atoi(s)
	}
	if s := os.Getenv("GENCMU_PROPERTY_RULE1"); s != "" {
		leanNone, _ = strconv.Atoi(s)
	}
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	started := time.Now()
	checked, skipped, ties, resolved, rejected, late, lateResolved, empty, withMaximal, narrowed := 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
	for c := 0; c < cases; c++ {
		r := rand.New(rand.NewSource(seed + int64(c)))
		gen := &genGrammar{r: r, rules: []string{"text", "a", "b", "c"}[:2+r.Intn(3)], terms: []string{"A", "B", "C"}}
		if r.Intn(100) < lateShare {
			gen.late = true
		}
		gen.elidable = gen.late || r.Intn(10) < 3
		gen.maximal = gen.elidable && r.Intn(10) < 4
		if gen.elidable {
			gen.terms = []string{"A", "B", "T"}
		}
		dom := gen.grammar()
		sg, serr := stitch("main", []docDOM{{path: "g.md", dom: dom}}, bundled.uni)
		if serr != nil {
			t.Fatalf("seed %d: %v", seed+int64(c), serr)
		}
		lg := lower(sg, nil)
		if lg.fault != "" {
			skipped++
			continue
		}
		// The input can be empty.
		n := r.Intn(maxTokens + 1)
		sounds := make([]string, n)
		toks := make([]Token, n)
		var texts []string
		tagMaps := make([]map[string]bool, n)
		for i := range toks {
			tags := map[string]bool{}
			var list []string
			for k := 0; k < 1+r.Intn(3); k++ {
				tag := gen.terms[r.Intn(len(gen.terms))]
				if !tags[tag] {
					list = append(list, tag)
				}
				tags[tag] = true
			}
			sort.Strings(list)
			sounds[i] = "x"
			if r.Intn(10) >= 6 {
				sounds[i] = "y"
			}
			toks[i] = Token{Text: "x", Phonemes: sounds[i], Tags: list, Span: [2]int{i, i + 1}, Source: [2]int{2 * i, 2*i + 1}}
			texts = append(texts, "x")
			tagMaps[i] = tags
		}
		en := &enumerator{g: lg, tags: tagMaps, sounds: sounds, memo: map[string][]*bnode{}, budget: 20000, maximal: gen.maximal}
		en.plain = &enumerator{g: lg, tags: tagMaps, sounds: sounds, memo: map[string][]*bnode{}, budget: 20000}
		trees, err := en.derive(symbol{id: lg.byName["text"]}, 0, n, nil)
		if err != nil {
			skipped++
			continue
		}
		ps := newParseState(bundled.uni, []rune(strings.Join(texts, " ")))
		run := ps.newRun("main", sg, toks)
		rec := run.recognize(lg, lg.byName["text"], 0, n)
		lean := lg.lean
		if r.Intn(100) < leanNone {
			lean = "" // no lean, as elision-only ranks (engine §7)
		}
		var mx *maximal
		if gen.maximal {
			mx = newMaximal(rec)
		}
		rk := newRanker(rec, lean, mx)
		var got *rankResult
		if top := rec.accepted(lg.byName["text"]); len(top) > 0 {
			got = rk.rank(top)
		}
		flags := map[string]bool{}
		for _, definition := range dom.Rules {
			flags[definition.Name] = len(definition.Flags) > 0
		}
		var ds []bderiv
		for _, tr := range trees {
			w := bnodeActions(tr, nil)
			ds = append(ds, bderiv{whole: w, vis: visibleOnly(w), elisions: elisionsOf(w), profile: bruteProfile(w, n, flags)})
		}
		want, werr := bruteRank(rk, ds)
		if printDerivations {
			for _, d := range ds {
				fmt.Println("DERIV", actionsText(lg, d.whole))
			}
		}
		fail := func(format string, args ...any) {
			var tags []string
			for _, m := range tagMaps {
				var ts []string
				for k := range m {
					ts = append(ts, k)
				}
				sort.Strings(ts)
				tags = append(tags, "{"+strings.Join(ts, " ")+"}")
			}
			t.Fatalf("seed %d, %d derivations, ranked with lean %q\n%sinput %s\n%s", seed+int64(c), len(ds), lean, domText(dom), strings.Join(tags, " "), fmt.Sprintf(format, args...))
		}
		if werr != nil {
			fail("%v", werr)
		}
		if (got == nil) != (want == nil) {
			var ws []string
			for _, d := range ds {
				ws = append(ws, actionsText(lg, d.whole))
			}
			fail("library accepts: %v (accepted items %d); derivations: %d\n  %s", got != nil, len(rec.accepted(lg.byName["text"])), len(ds), strings.Join(ws, "\n  "))
		}
		// The stage agrees: it rejects exactly when no derivation counts, and
		// otherwise it has the verdict of the oracle.
		if lean == lg.lean {
			ps := newParseState(bundled.uni, []rune(strings.Join(texts, " ")))
			out := ps.newRun("main", sg, toks).run(lg, false)
			wantVerdict := ""
			if want != nil {
				wantVerdict = want.verdict
			}
			if out.stage.Verdict != wantVerdict {
				fail("the stage's verdict %q, want %q", out.stage.Verdict, wantVerdict)
			}
		}
		if want == nil {
			rejected++
			continue
		}
		checked++
		if n == 0 {
			empty++
		}
		if gen.maximal {
			withMaximal++
			// Whether maximal left out a derivation here.
			if plain, err := en.plain.derive(symbol{id: lg.byName["text"]}, 0, n, nil); err == nil && len(plain) > len(trees) {
				narrowed++
			}
		}
		if rk.elisions {
			late++
		}
		if got.verdict != want.verdict {
			fail("verdict %s, want %s", got.verdict, want.verdict)
		}
		if gc := dnActions(got.first); !sameActions(gc, want.chosen) {
			fail("chosen\n  got  %s\n  want %s", actionsText(lg, gc), actionsText(lg, want.chosen))
		}
		if (got.second == nil) != (want.tied == nil) {
			var gt string
			if got.second != nil {
				gt = actionsText(lg, dnActions(got.second))
			}
			fail("tie: got %v (%s), want %v", got.second != nil, gt, want.tied != nil)
		}
		if want.tied != nil {
			ties++
			if gt := dnActions(got.second); !sameActions(gt, want.tied) {
				fail("tied, chosen %s\n  got  %s\n  want %s", actionsText(lg, want.chosen), actionsText(lg, gt), actionsText(lg, want.tied))
			}
			if got.witness != want.witness {
				fail("witness %s, want %s", actionsText(lg, got.witness[:]), actionsText(lg, want.witness[:]))
			}
		} else if want.count > 1 {
			resolved++
			if rk.elisions {
				lateResolved++
			}
		}
	}
	t.Logf("%d accepted cases checked (%d ties, %d resolved, %d under late-elision, %d of them resolved, %d empty inputs, %d under maximal, %d narrowed by it), %d rejected by both, %d skipped, in %v", checked, ties, resolved, late, lateResolved, empty, withMaximal, narrowed, rejected, skipped, time.Since(started))
	if checked < cases/10 {
		t.Errorf("only %d of %d cases were checked", checked, cases)
	}
	// Every kind of case is checked often enough to count.
	if rejected <= cases/50 || empty <= cases/100 || withMaximal <= cases/50 || narrowed <= cases/500 {
		t.Errorf("%d rejections, %d empty inputs, %d cases under maximal, %d narrowed by it", rejected, empty, withMaximal, narrowed)
	}
}

// The oracle treats only a rule completed again over its own span as a
// cycle, not a repeated partial item: on A B, the outer p and the nested p
// start at A but end apart, so the input has three derivations (engine §4;
// tests/engine/cycle-repeated-partial-item.json).
func TestOracleRepeatedPartialItem(t *testing.T) {
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	dom, err := bundled.reader.read("```jbogenbau\n%ambiguity-resolution lazy\n%rule text p\n%rule p r q [B]\n%rule r A | ε\n%rule q p | ε\n```\n", "g.md")
	if err != nil {
		t.Fatal(err)
	}
	sg, serr := stitch("main", []docDOM{{path: "g.md", dom: dom}}, bundled.uni)
	if serr != nil {
		t.Fatal(serr)
	}
	lg := lower(sg, nil)
	tags := []map[string]bool{{"A": true}, {"B": true}}
	en := &enumerator{g: lg, tags: tags, sounds: []string{"", ""}, memo: map[string][]*bnode{}, budget: 20000}
	trees, derr := en.derive(symbol{id: lg.byName["text"]}, 0, 2, nil)
	if derr != nil || len(trees) != 3 {
		t.Fatalf("%d derivations, %v", len(trees), derr)
	}
}
