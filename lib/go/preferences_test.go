package gencmu

import (
	"reflect"
	"strconv"
	"strings"
	"testing"
)

func TestSlotValidationRejectsIncompleteLowering(t *testing.T) {
	fault := &Error{Kind: ErrorGrammar, Message: "incomplete lowering", Document: "source.md", Line: 7}
	got := (&preferences{}).validate(&lowered{fault: fault.Message, faultLocation: fault})
	if got != fault {
		t.Fatalf("got %v, want the original lowering fault %v", got, fault)
	}
}

func TestSlotLinearForest(t *testing.T) {
	d := mustLoad(t, oneStage("%ambiguity-resolution late-elision\n%rule text {unit}\n%rule unit a | b\n%rule a X\n%tags ∅\n%rule b X\n%tags ∅\n%prefer a > b"))
	for n := 1; n <= 32; n++ {
		tokens := make([]Token, n)
		for i := range tokens {
			tokens[i] = Token{Text: "x", Tags: []string{"X"}, Span: [2]int{i, i + 1}, Source: [2]int{i, i + 1}}
		}
		var stats []slotStatistics
		res, err := d.ParseTokens(strings.Repeat("x", n), tokens, ParseOptions{NoAutoFeatures: true, private: &privateOptions{slotAdmission: func(s slotStatistics) { stats = append(stats, s) }}})
		if err != nil || res.Stages[0].Verdict != VerdictUnique || len(stats) == 0 || stats[0].groups != n || stats[0].candidateEdges != 2*n {
			t.Fatalf("%d: %v %+v", n, err, stats)
		}
	}
}
func TestPreferenceDOMCache(t *testing.T) {
	sources := oneStage("%ambiguity-resolution late-elision\n%rule text a | b\n%rule a 'x'\n%tags ∅\n%rule b 'x'\n%tags ∅\n%prefer a > b")
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

func TestSlotCacheDiagnostics(t *testing.T) {
	for _, body := range []string{
		"%rule text X a | Y b\n%rule a X Y\n%rule b X Y\n%prefer a > b",
		"%rule text $h(a) X | b X\n%emits $h\n%rule a Y Z\n%rule b Y Z\n%prefer a > b",
	} {
		sources := oneStage("%ambiguity-resolution late-elision\n" + body)
		_, plainErr := LoadDialectSources(sources, "p.md")
		dom, e := bundled.reader.readMode(sources["g.md"], "g.md", true)
		if e != nil {
			t.Fatal(e)
		}
		sources["compiled.json"] = `{"format":21,"bootstrap":"` + bundled.reader.hash + `","documents":{"g.md":{"hash":"` + fnv1a64(sources["g.md"]) + `","dom":` + string(dom.json()) + `}}}`
		_, cachedErr := LoadDialectSources(sources, "p.md")
		if plainErr == nil || !reflect.DeepEqual(plainErr, cachedErr) || !strings.Contains(plainErr.Error(), "prefer-slot-template") {
			t.Fatalf("%v\n%v", plainErr, cachedErr)
		}
	}
}

func TestSlotTagClosureSourceOrder(t *testing.T) {
	_, err := LoadDialectSources(oneStage("%ambiguity-resolution late-elision\n%rule text a | b\n%rule a u | v\n%rule v Y\n%rule u X\n%rule b X Y\n%prefer a > b"), "p.md")
	if err == nil || !strings.Contains(err.Error(), "prefer-slot-tags") || !strings.Contains(err.Error(), "u terminal X") || strings.Contains(err.Error(), "v terminal Y") {
		t.Fatal(err)
	}
}
