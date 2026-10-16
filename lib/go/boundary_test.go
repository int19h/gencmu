package gencmu

import "testing"

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
