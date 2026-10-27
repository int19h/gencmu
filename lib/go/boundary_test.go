package gencmu

import (
	"reflect"
	"runtime/debug"
	"strconv"
	"strings"
	"testing"
)

func TestBoundaryRecordEmptyTransfer(t *testing.T) {
	m := &boundaryMachine{names: map[string]boundaryBits{}, records: map[boundaryShape]*boundaryRecord{}}
	m.empty = m.intern(boundaryShape{empty: true})
	target := m.name("A")
	lit := &boundaryLiteral{0, boundaryBit(0), target, false, false}
	m.literals = []*boundaryLiteral{lit}
	prefix := m.intern(boundaryShape{end: lit.bit, last: target})
	// The prefix's own backward obligation passes through an empty child.
	got := m.advance(prefix, m.empty, func(*boundaryLiteral) { t.Fatal("prefix obligation met its own offer") })
	if got != prefix {
		t.Fatal("empty transfer changed the prefix")
	}
	child := m.intern(boundaryShape{empty: true, end: lit.bit})
	if m.advance(m.intern(boundaryShape{last: target}), child, func(*boundaryLiteral) {}) != nil {
		t.Fatal("empty child's negative obligation survived a matching offer")
	}
}

func TestBoundarySetsHaveNoWidthLimit(t *testing.T) {
	a, b := boundaryBit(3), boundaryBit(300)
	both := a.union(b)
	if !a.subset(both) || !b.subset(both) || both.subset(a) || both.without(a) != b {
		t.Fatal("boundary sets lost a high bit")
	}
}

func TestBoundaryAnnotationLateJoin(t *testing.T) {
	root, child := &boundarySource{}, &boundarySource{}
	child.inherit(root)
	early, later := &boundarySite{rule: "early"}, &boundarySite{rule: "later"}
	root.add(early)
	child.inherit(root)
	root.add(later)
	if !child.sites[early] || !child.sites[later] {
		t.Fatal("late source did not reach a dependent item")
	}
}

func TestBoundaryMeetFollowsTagErrors(t *testing.T) {
	grammar := "%rule text A :: ($.matches(text) ⟹ X) | B\n%conditions $.followed-by(B)"
	c := &engineCase{Grammar: &grammar, Tokens: []caseToken{{Text: "a", Tags: []string{"A"}}}}
	d, err := caseDialect(c, false)
	if err != nil {
		t.Fatal(err)
	}
	result, err := runCase(d, c, &caseOptions{})
	if err != nil || result.Error == nil || result.Error.Kind != ErrorGrammar {
		t.Fatalf("tag error was hidden: %+v %v", result, err)
	}
}

func TestBoundaryRecordGrowth(t *testing.T) {
	grammar := "%rule text r [B]\n%rule r A [tail]\n%conditions ¬$.followed-by(B) ∨ $.starts-input\n%rule s A [tail]\n%rule tail r | s"
	d, err := caseDialect(&engineCase{Grammar: &grammar}, false)
	if err != nil {
		t.Fatal(err)
	}
	for n := 1; n <= 16; n++ {
		c := &engineCase{Tokens: make([]caseToken, n)}
		for i := range c.Tokens {
			c.Tokens[i] = caseToken{Text: "a", Tags: []string{"A"}}
		}
		w := &workCounts{}
		var result *ParseResult
		countWorkIn(w, func() { result, err = runCase(d, c, &caseOptions{}) })
		if err != nil {
			t.Fatal(err)
		}
		want := VerdictTie
		if n == 1 {
			want = VerdictUnique
		}
		if len(result.Stages) != 1 || result.Stages[0].Verdict != want {
			t.Fatalf("n=%d: %+v", n, result)
		}
		// The recognizer uses two records at n=1 and three thereafter.
		wantRecords := int64(3)
		if n == 1 {
			wantRecords = 2
		}
		if got := w.boundaryRecords.Load(); got != wantRecords {
			t.Fatalf("n=%d: %d records, want %d", n, got, wantRecords)
		}
		t.Logf("n=%d records=%d items=%d edges=%d contexts=%d", n, w.boundaryRecords.Load(), w.items.Load(), w.packedEdges.Load(), w.summaryContexts.Load())
	}
}

func TestBoundaryLoadCacheDiagnostics(t *testing.T) {
	sources := oneStage("%ambiguity-resolution greedy\n%const $K A\n%rule text X r | Y r\n%rule r C (aa ≻ $a:bb) :: ∅\n%conditions $.ends-input, $a.tags = $K ∧ ¬$.preceded-by(X)\n%rule aa A\n%rule bb A")
	sources = map[string]string{"grammars/test/p.md": sources["p.md"], "grammars/test/g.md": sources["g.md"]}
	_, plain := LoadDialectSources(sources, "grammars/test/p.md")
	if plain == nil {
		t.Fatal("missing private boundary load error")
	}
	dom, e := bundled.reader.readMode(sources["grammars/test/g.md"], "grammars/test/g.md", true)
	if e != nil {
		t.Fatal(e)
	}
	sources["data/preparsed/test.json"] = `{"format":` + strconv.Itoa(domFormat) + `,"bootstrap":"` + bundled.reader.hash + `","unicode":"` + bundled.uni.hash + `","properties":"` + fnv1a64(bundled.sources["data/unicode/unicode-properties.txt"]) + `","documents":{"grammars/test/g.md":{"hash":"` + fnv1a64(sources["grammars/test/g.md"]) + `","dom":` + string(dom.json()) + `}}}`
	_, cached := LoadDialectSources(sources, "grammars/test/p.md")
	if !reflect.DeepEqual(plain, cached) {
		t.Fatalf("plain=%+v cached=%+v", plain, cached)
	}
	error := plain.(*Error)
	if error.Code != "ranked-choice-boundary" || error.Option == nil || *error.Option != 1 || !strings.Contains(string(error.Expression), `"const":"K"`) || !strings.Contains(error.Message, "Condition 2") || !strings.Contains(error.Message, "$.preceded-by(X)") {
		t.Fatalf("%+v", error)
	}
}

// Reading checks boundary surfaces before the DOM depth limit.
func TestBoundaryDeepCaptureValidation(t *testing.T) {
	defer debug.SetMaxStack(debug.SetMaxStack(1 << 20))
	atom := &domCond{Kind: cdBoundary, Op: "followed-by", Span: &domTerm{Kind: tmCapture, Str: "x"}, Targets: []*domTerm{{Kind: tmTerminal, Str: "B"}}}
	c := atom
	for i := 0; i < 20000; i++ {
		c = &domCond{Kind: cdNot, Inner: c}
	}
	rule := &domRule{Conditions: []*domCond{c}}
	if _, problem := boundaryRuleProblem(rule); problem != "" {
		t.Fatal(problem)
	}
	rule.Conditions = []*domCond{{Kind: cdAll, Items: []*domCond{c, {Kind: cdCaptured, Rule: "y"}}}}
	if _, problem := boundaryRuleProblem(rule); problem == "" {
		t.Fatal("mixed capture was accepted")
	}
}

func TestBoundaryCachedTargetLocationWidth(t *testing.T) {
	// A valid cached DOM can differ from the source that supplies locations.
	makeDoc := func(targets ...string) *domDoc {
		atom := &domCond{Kind: cdBoundary}
		for _, name := range targets {
			atom.Targets = append(atom.Targets, &domTerm{Kind: tmRule, Str: name})
		}
		return &domDoc{Rules: []*domRule{{Conditions: []*domCond{atom}}}}
	}
	cached, source := makeDoc("a", "z"), makeDoc("a")
	source.Rules[0].Conditions[0].Targets[0].At = [2]int{5, 17}
	restoreBoundaryLocations(cached, source)
	targets := cached.Rules[0].Conditions[0].Targets
	if targets[0].At != [2]int{5, 17} || targets[1].At != [2]int{} {
		t.Fatal("unmatched cached targets acquired invented locations")
	}
}
