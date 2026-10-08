package gencmu

import (
	"reflect"
	"strconv"
	"strings"
	"testing"
)

func TestPreferenceExactCounts(t *testing.T) {
	p := &preferences{paths: map[string]map[string][]string{"a": {"b": {"a", "b"}}}}
	n := countOne
	for i := 0; i < 70; i++ {
		n = n.add(n)
	}
	n = n.add(countOne)
	a := occurrenceCounts{{"a", 0, 1}: n}
	b := occurrenceCounts{{"b", 0, 1}: countOne}
	c := preferenceContests(p, a, b)
	if len(c.Forward) != 1 || c.Forward[0].ResidualCounts != [2]string{"1180591620717411303425", "1"} {
		t.Fatalf("%+v", c)
	}
	cancelled := preferenceContests(p, a, occurrenceCounts{{"a", 0, 1}: n.sub(countOne), {"b", 0, 1}: countOne})
	if len(cancelled.Forward) != 1 || cancelled.Forward[0].ResidualCounts != [2]string{"1", "1"} {
		t.Fatal(cancelled)
	}
	for i := 0; i < 10000; i++ {
		common := occurrenceCounts{{"a", 0, 1}: countOf(int64(i)), {"b", 0, 1}: countOf(int64(i))}
		if got := preferenceContests(p, sumPreferenceCounts(a, common), sumPreferenceCounts(b, common)); !reflect.DeepEqual(got, c) {
			t.Fatal(got)
		}
	}
}
func TestPreferenceIndependentSignatures(t *testing.T) {
	d := mustLoad(t, oneStage("%ambiguity-resolution late-elision\n%rule text {unit}\n%rule unit a | b\n%rule a X\n%rule b X\n%prefer a > b"))
	for n := 1; n <= 8; n++ {
		tokens := make([]Token, n)
		for i := range tokens {
			tokens[i] = Token{Text: "x", Tags: []string{"X"}, Span: [2]int{i, i + 1}, Source: [2]int{i, i + 1}}
		}
		var stats []preferenceStatistics
		res, err := d.ParseTokens(strings.Repeat("x", n), tokens, ParseOptions{NoAutoFeatures: true, private: &privateOptions{preferenceRanking: func(s preferenceStatistics) { stats = append(stats, s) }}})
		if err != nil || res.Stages[0].Verdict != VerdictResolved || !stats[0].slow || stats[0].largestSet != 1<<n {
			t.Fatalf("%d: %v %+v", n, err, stats)
		}
	}
}
func TestPreferenceFastPath(t *testing.T) {
	text := "%ambiguity-resolution late-elision\n%rule text a | n [+T]\n%rule a X\n%rule b Y\n%rule n X"
	plain := mustLoad(t, oneStage(text))
	preferred := mustLoad(t, oneStage(text+"\n%prefer a > b"))
	tokens := []Token{{Text: "x", Tags: []string{"X"}, Span: [2]int{0, 1}, Source: [2]int{0, 1}}}
	slow := false
	got, err := preferred.ParseTokens("x", tokens, ParseOptions{NoAutoFeatures: true, private: &privateOptions{preferenceRanking: func(s preferenceStatistics) { slow = slow || s.slow }}})
	if err != nil || slow {
		t.Fatalf("%v slow=%v", err, slow)
	}
	want, err := plain.ParseTokens("x", tokens, ParseOptions{NoAutoFeatures: true})
	if err != nil {
		t.Fatal(err)
	}
	a, _ := MarshalResult(got)
	b, _ := MarshalResult(want)
	if string(a) != string(b) {
		t.Fatalf("%s\n%s", a, b)
	}
}
func TestPreferenceDOMCache(t *testing.T) {
	sources := oneStage("%ambiguity-resolution late-elision\n%rule text a | b\n%rule a b\n%rule b 'x'\n%prefer a > b")
	plain := mustLoad(t, sources)
	dom, e := bundled.reader.read(sources["g.md"], "g.md")
	if e != nil {
		t.Fatal(e)
	}
	sources["compiled.json"] = `{"format":21,"bootstrap":"` + bundled.reader.hash + `","documents":{"g.md":{"hash":"` + fnv1a64(sources["g.md"]) + `","dom":` + string(dom.json()) + `}}}`
	cached := mustLoad(t, sources)
	if !reflect.DeepEqual(plain.LoadWarnings(), cached.LoadWarnings()) {
		t.Fatal("warnings differ")
	}
	a, _ := plain.Parse("x", ParseOptions{NoAutoFeatures: true})
	b, _ := cached.Parse("x", ParseOptions{NoAutoFeatures: true})
	aj, _ := MarshalResult(a)
	bj, _ := MarshalResult(b)
	if string(aj) != string(bj) {
		t.Fatalf("%s\n%s", aj, bj)
	}
}
func TestPreferenceBundledWarnings(t *testing.T) {
	for _, name := range []string{"cll-ebnf", "bpfk", "experimental", "zantufa"} {
		d, err := LoadDialect(name)
		if err != nil {
			t.Fatal(err)
		}
		if len(d.LoadWarnings()) != 0 {
			t.Fatalf("%s: %+v", name, d.LoadWarnings())
		}
	}
}
func TestPreferenceCycleLocations(t *testing.T) {
	_, err := LoadDialectSources(oneStage("%ambiguity-resolution late-elision\n%rule text a\n%rule a 'x'\n%rule b 'x'\n%rule c 'x'\n%prefer a > b\n%prefer b > c\n%prefer c > a"), "p.md")
	if err == nil || !strings.Contains(err.Error(), "a > b > c > a") {
		t.Fatal(err)
	}
	for n := 9; n <= 11; n++ {
		if !strings.Contains(err.Error(), "g.md:"+strconv.Itoa(n)+":1") {
			t.Fatal(err)
		}
	}
}
