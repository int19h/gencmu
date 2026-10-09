package gencmu

import (
	"strings"
	"sync"
	"testing"
)

// The witness hook of tests/README.md: whether a check of elision-only kept
// W(D), the chosen derivation mapped to the reconstructed input, as a
// counted derivation of its forest (engine §7.8). The runners read the
// checks through the library's private hook, never through its API. The
// hook ranks nothing itself: it marks W(D)'s links before the check ranks,
// and reads what the check's own ranking did with them.

// checkLog counts the checks of elision-only that ran in one parse, and
// those that did not keep their witness. The hook answers while the
// check's forest is at hand and keeps only the answer, so that no forest
// outlives its check.
type checkLog struct {
	mu          sync.Mutex
	checks, bad int
}

// withChecks sets the options' hook to count the checks of a parse.
func withChecks(opts *ParseOptions) *checkLog {
	log := &checkLog{}
	opts.private = &privateOptions{elisionCheck: func(run *elisionCheckRun) elisionWatch {
		marks, w := walkWitness(run)
		return elisionWatch{marks: marks, ranked: func(res *rankResult, rk *ranker) {
			kept := marks != nil && keeps(res, rk, w)
			log.mu.Lock()
			log.checks++
			if !kept {
				log.bad++
			}
			log.mu.Unlock()
		}}
	}}
	return log
}

// lost counts the checks that did not keep their witness.
func (log *checkLog) lost() int { return log.bad }

// keeps is the hook's two channels. The count channel: the check's own
// count, in the same loop that counts, counted a derivation of W(D)'s
// marked links only. The selection channel: where the check reports two
// readings, the first does not come after W(D) in the order T. Where the
// first is not W(D), W(D) was a candidate for the second, so the second
// does not come after W(D) by the criterion of engine §6 that picks it:
// divergence from the first, then T.
func keeps(res *rankResult, rk *ranker, w *dn) bool {
	if rk.rawWitnessCounted != nil {
		return res != nil && *rk.rawWitnessCounted
	}
	if res == nil || !res.witnessCounted {
		return false
	}
	if res.verdict != VerdictTie {
		return true
	}
	first := rk.compare(res.first, w)
	if !rk.aFirst(first) {
		return false
	}
	return first.kind == cIdentical || secondFirst(rk, res.first, res.second, w)
}

// secondFirst says whether a comes before b as the second reading after
// first (engine §6): it diverges from first earlier, in visible actions, or
// at the same point and before b in the order T, as contribute measures it.
func secondFirst(rk *ranker, first, a, b *dn) bool {
	div := func(d *dn) count {
		r := rk.compare(first, d)
		switch r.kind {
		case cVisDiff, cAPrefix, cBPrefix:
			return r.pos
		}
		return inf
	}
	switch c := div(a).cmp(div(b)); {
	case c < 0:
		return true
	case c > 0:
		return false
	}
	return rk.aFirst(rk.compare(a, b))
}

// lostCase is a two-stage pipeline whose first stage runs the check of
// elision-only over two terminators at one position, one tested, with a
// warning on its chosen tree.
func lostCase(t *testing.T) (*Dialect, *engineCase) {
	c := &engineCase{
		Documents: map[string]string{"p.md": "```jbogenbau\n%stage main\n%ambiguity-resolution late-elision elision-only\n" +
			"%rule text a | b\n%rule a w! A [+T=\"ta\"] [+U] %emits $ <~x>\n%rule b A [+T=\"ta\"] [+U] [+U]\n" +
			"%stage later\n%ambiguity-resolution greedy\n%rule text ~x\n```\n"},
		Pipeline: "p.md",
		Tokens:   []caseToken{{Text: "a", Tags: []string{"A"}}},
		Options:  caseOptions{Features: []string{"w"}},
	}
	d, err := caseDialect(c, true)
	if err != nil {
		t.Fatal(err)
	}
	return d, c
}

// A check that loses its witness after recognition, with no completed item
// of text over R or with items that have no counted derivation, gives the
// grammar error elision-witness-lost, and the run ends there (engine §7.9).
// No grammar gives it while the witness of engine §7.8 holds, so the test
// loses the witness through the library's private switch.
func TestWitnessLost(t *testing.T) {
	d, c := lostCase(t)
	clean, log, err := runCaseLogged(d, c, &c.Options, "")
	if err != nil || !clean.OK || log.checks != 1 || log.lost() != 0 {
		t.Fatalf("%v %#v: %d checks, %d lost", err, clean.Error, log.checks, log.lost())
	}
	// The chosen tree is that of the main stage, as a run that ends there
	// shows it.
	off := false
	main, _ := runCase(d, c, &caseOptions{Features: c.Options.Features, ElisionOnly: &off, Until: "main"})
	mainTree, _ := MarshalResult(&ParseResult{Tree: main.Tree})
	for _, lose := range []string{"roots", "count"} {
		res, log, err := runCaseLogged(d, c, &c.Options, lose)
		if err != nil {
			t.Fatal(err)
		}
		// The witness hook sees the loss too, also where the chart still
		// holds W(D) but the ranking counted nothing.
		if log.checks != 1 || log.lost() != 1 {
			t.Fatalf("%s: %d checks, %d lost", lose, log.checks, log.lost())
		}
		data, _ := MarshalResult(res)
		got := decodedResult(t, data)
		// The runner fails it, whatever a case expects (tests/README.md),
		// though it has the form that docs/output.md gives it.
		problems := resultProblems(got)
		if len(problems) != 1 || !strings.Contains(problems[0], "elision-witness-lost") {
			t.Fatalf("%s: %v\n%s", lose, problems, data)
		}
		if err := checkResult(res, got, data, &caseExpect{Error: ErrorGrammar}); err == nil {
			t.Fatalf("%s: the runner passes the error", lose)
		}
		e := res.Error
		if res.OK || res.Tree != nil || e.Kind != ErrorGrammar || e.Stage != "main" || e.Code != CodeElisionWitnessLost || e.Reason != "" || e.Token != nil || e.Source != nil || e.Line != 0 || e.Readings != nil || e.Expected != nil {
			t.Fatalf("%s: %s", lose, data)
		}
		if e.Message != "the main stage could not reconstruct its chosen derivation for elision-only" {
			t.Fatalf("%s: %q", lose, e.Message)
		}
		chosen, _ := MarshalResult(&ParseResult{Tree: e.Chosen})
		if string(chosen) != string(mainTree) {
			t.Fatalf("%s: chosen %s, not %s", lose, chosen, mainTree)
		}
		// The members in their order, and the records in their order of
		// insertion, with the sound only for the tested terminator.
		want := `"error":{"kind":"grammar","stage":"main","code":"elision-witness-lost","message":"the main stage could not reconstruct its chosen derivation for elision-only","chosen":`
		if !strings.Contains(string(data), want) || !strings.Contains(string(data), `,"completion":[{"terminal":"T","at":1,"source":[1,1],"sound":"ta"},{"terminal":"U","at":1,"source":[1,1]}]}`) {
			t.Fatalf("%s: %s", lose, data)
		}
		// The stage keeps its verdict and warnings, has no output, and no
		// later stage runs.
		if len(res.Stages) != 1 || res.Stages[0].Verdict != VerdictResolved || res.Stages[0].Output != nil {
			t.Fatalf("%s: %s", lose, data)
		}
		if len(res.Warnings) != 1 || res.Warnings[0].Stage != "main" {
			t.Fatalf("%s: warnings %#v", lose, res.Warnings)
		}
	}
}

// An ordinary error of the grammar in the check keeps its own message, and
// has no code, chosen tree or completion.
func TestCheckGrammarErrorHasNoCode(t *testing.T) {
	c := loadCase(t, "../../tests/engine/reparse-competing-evaluation-error.json")
	d, err := caseDialect(c, true)
	if err != nil {
		t.Fatal(err)
	}
	res, err := runCase(d, c, &c.Options)
	if err != nil {
		t.Fatal(err)
	}
	data, _ := MarshalResult(res)
	e := res.Error
	if e == nil || e.Kind != ErrorGrammar || e.Code != "" || e.Chosen != nil || e.Completion != nil || strings.Contains(string(data), `"code"`) || strings.Contains(e.Message, "could not reconstruct") {
		t.Fatalf("%s", data)
	}
}

// The corpus runner refuses the error elision-witness-lost. The check of le
// sutra tavla runs in cll-ebnf, since the ranking chooses the fragment
// (grammars/syntax/cll.md). The private switch loses its witness after
// recognition.
func TestCorpusRunnerWitnessLost(t *testing.T) {
	d, err := LoadDialect("cll-ebnf")
	if err != nil {
		t.Fatal(err)
	}
	c := &corpusCase{Dialect: "cll-ebnf", Text: "le sutra tavla"}
	got, err := corpusOutcome(d, c)
	if err != nil || got["verdict"] != VerdictResolved {
		t.Fatalf("%v %v", got, err)
	}
	for _, lose := range []string{"roots", "count"} {
		if _, err := corpusOutcomeLosing(d, c, lose); err == nil || !strings.Contains(err.Error(), "elision-witness-lost") {
			t.Fatalf("%s: %v", lose, err)
		}
	}
}
