package gencmu

import (
	"strings"
	"testing"
)

func deferredTokens(tags ...string) []Token {
	tokens := make([]Token, len(tags))
	for i, tag := range tags {
		tokens[i] = Token{Text: strings.ToLower(tag), Value: strings.ToLower(tag), Image: strings.ToLower(tag), Tags: []string{tag}, Span: [2]int{i, i + 1}, Source: [2]int{i, i + 1}}
	}
	return tokens
}

func derivationNamed(root *dn, name string) *dn {
	pending := []*dn{root}
	for len(pending) > 0 {
		n := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		if n == nil {
			continue
		}
		if n.kind == dClose && n.prod.ruleName == name {
			return n
		}
		pending = append(pending, n.b, n.a)
	}
	return nil
}

func TestDeferredErasedCompletionsIgnorePrivateInteriorState(t *testing.T) {
	// Engine §6: an erased completion exposes only completed demanded state.
	for _, body := range []string{"[A] [A] :: ∅", "[$x:A] [A] :: ∅", "first | second"} {
		_, result := rankedMeasure(t, "%rule text gone\n%rule gone "+body+"\n%erased\n%rule first A\n%rule second A", deferredTokens("A"))
		if result.verdict != VerdictUnique {
			t.Fatal(body, result.verdict)
		}
		requireMeasure(t, result.profile.measure(), diagnosticMeasure{})
	}
}

func TestDeferredErasedInteriorsUseIndependentCanonicalSummaries(t *testing.T) {
	// Engine §6: grammar keys affect a live caller but not an erased interior.
	_, result := rankedMeasure(t, "%ambiguity-resolution fewest #·a\n%rule text gone B live\n%rule gone choices\n%erased\n%rule live choices\n%rule choices a | b\n%rule a A\n%rule b A", deferredTokens("A", "B", "A"))
	if result.verdict != VerdictResolved {
		t.Fatal(result.verdict)
	}
	if derivationNamed(derivationNamed(result.first, "gone"), "a") == nil || derivationNamed(derivationNamed(result.first, "live"), "b") == nil {
		t.Fatal("interior and live summaries did not separate")
	}
}

func TestDeferredErasedInteriorsPreferMeasureBeforeActions(t *testing.T) {
	// Engine §6: the canonical interior prefers a clean reading over an error.
	_, result := rankedMeasure(t, "%rule text gone\n%rule gone bad | A\n%erased\n%rule bad A\n%error \"bad\"", deferredTokens("A"))
	if result.verdict != VerdictUnique || derivationNamed(result.first, "bad") != nil {
		t.Fatal("wrong interior", result.verdict)
	}
}

func TestDeferredErasedInteriorsKeepCanonicalPrefixFrontiers(t *testing.T) {
	// Engine §6: the common suffix settles prefix-related canonical candidates.
	_, result := rankedMeasure(t, "%rule text gone\n%rule gone x y\n%erased\n%rule x a | a b\n%rule a ε\n%rule b ε\n%rule y ε", nil)
	if result.verdict != VerdictUnique || derivationNamed(result.first, "b") == nil {
		t.Fatal("lost prefix companion", result.verdict)
	}
}

func TestDeferredErasedInteriorsKeepFiniteCycleContexts(t *testing.T) {
	// Engine §6: erasure leaves the same-span cycle restriction in force.
	_, result := rankedMeasure(t, "%rule text gone\n%rule gone gone | A\n%erased", deferredTokens("A"))
	if result.verdict != VerdictUnique {
		t.Fatal(result.verdict)
	}
}

func TestDeferredErasedInteriorsKeepRankedAdmission(t *testing.T) {
	// Engine §6.1: admission runs before an erased contribution disappears.
	for _, example := range []struct {
		grammar       string
		tags          []string
		kept, dropped string
	}{
		{"%rule text gone\n%rule gone A (b ≻ c) :: ∅\n%erased\n%rule b B\n%rule c B", []string{"A", "B"}, "b", "c"},
		{"%rule text (gone ≻ live) :: ∅\n%rule gone bad\n%erased\n%rule bad A\n%error \"bad\"\n%rule live A", []string{"A"}, "gone", "live"},
	} {
		_, result := rankedMeasure(t, example.grammar, deferredTokens(example.tags...))
		if result.verdict != VerdictUnique || derivationNamed(result.first, example.kept) == nil || derivationNamed(result.first, example.dropped) != nil {
			t.Fatal("wrong ranked interior", result.verdict)
		}
	}
}

func TestDeferredErasedWitnessMembershipUsesItsKeptInterior(t *testing.T) {
	// Engine §7.10: class membership does not require the kept interior's edges.
	ranker, result := rankedMeasure(t, "%elision-only\n%rule text gone\n%rule gone \"a\" T | bad [+T]\n%erased\n%rule bad \"a\"\n%error \"bad\"", deferredTokens("A"))
	rec := ranker.rec
	if err := rec.run.checkElision(rec, result.first, rec.run.buildTree(rec, result.first)); err != nil {
		t.Fatalf("lost erased witness class: %v", err)
	}
}

func TestDeferredErasedInteriorsShareLinearSummaries(t *testing.T) {
	// Engine §6: the extra summary does not enumerate independent interiors.
	for _, n := range []int{2, 8, 32} {
		pipeline := mustLoad(t, oneStage("%ambiguity-resolution greedy\n%rule text "+strings.Repeat("gone B ", n)+"\n%rule gone [A] [A] :: ∅\n%erased"))
		grammar := pipeline.lower(0, map[string]bool{})
		tags := make([]string, 0, 2*n)
		for range n {
			tags = append(tags, "A", "B")
		}
		state := newParseState(pipeline.uni, []rune(strings.Repeat("ab", n)))
		rec := state.newRun("main", pipeline.stages[0], deferredTokens(tags...)).recognize(grammar, grammar.byName["text"], 0, 2*n)
		work := &workCounts{}
		work.summaryContexts.most = int64(80*n + 20)
		countWorkIn(work, func() {
			result := newRanker(rec, grammar.steps, grammar.lean).rank(rec.accepted(grammar.byName["text"]))
			if result == nil || result.verdict != VerdictUnique {
				t.Fatal("wrong erased count")
			}
		})
		t.Logf("%d erased choices: %d summary contexts", n, work.summaryContexts.Load())
	}
}

func TestDeferredErasureUndemandedPatternStatesAreEqual(t *testing.T) {
	// Engine §4.1: an empty predicate set has one structural observation.
	machine := newPatternMachine(nil)
	node := machine.node("r", machine.empty, "", "", nil)
	if node != machine.empty || machine.seal != machine.empty || machine.concat(node, machine.seal) != machine.empty {
		t.Fatal("undemanded states differ")
	}
}
