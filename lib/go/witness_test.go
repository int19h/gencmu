package gencmu

import (
	"encoding/json"
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
// readings, neither comes after W(D) in the order T, unless the first is
// W(D) itself.
func keeps(res *rankResult, rk *ranker, w *dn) bool {
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
	return first.kind == cIdentical || rk.aFirst(rk.compare(res.second, w))
}

// walkWitness finds W(D) in a check's chart before the check ranks: for
// each node of W(D), from the leaves up, a completed item of the node's
// production over the node's span of R with a link whose children are the
// items of the node's children. A read is of the original token that D
// reads, found by its provenance. An elided terminator of D is the
// restoration of its helper over its own synthetic token. It gives the
// links that it matched, for each item, and W(D) as a derivation for the
// order T, or nil where the chart does not hold W(D). The walk pins the
// shape of W(D), not its tags, which the cases pin.
func walkWitness(run *elisionCheckRun) (map[*item]map[link]bool, *dn) {
	rc := run.recon
	// The nodes of W(D) in post-order, each with its span in R. The ranking
	// shares a derivation among the places where it occurs, so a node is
	// one place of a derivation in D. A cursor walks the leaves of D left to
	// right: a read takes its original token, an elided terminator its
	// record's synthetic token, in order.
	type wnode struct {
		d          *dn
		kids       []*wnode
		start, end int
	}
	elided := func(d *dn) bool { return d.kind != dRead && d.prod.restoration() && d.a == nil }
	var order []*wnode
	cursor, records := 0, 0
	type frame struct {
		w    *wnode
		kids []*dn
		next int
	}
	root := &wnode{d: run.chosen}
	stack := []*frame{{w: root, kids: flattenKids(run.chosen.a)}}
	for len(stack) > 0 {
		f := stack[len(stack)-1]
		w := f.w
		switch {
		case w.d.kind == dRead:
			at := run.originalAt[w.d.tok]
			if at != cursor || rc.synthetic[at] {
				return nil, nil
			}
			cursor++
			w.end = cursor
			order = append(order, w)
			stack = stack[:len(stack)-1]
			continue
		case elided(w.d):
			if records >= len(run.recordAt) {
				return nil, nil
			}
			at := run.recordAt[records]
			records++
			if at != cursor || !rc.synthetic[at] {
				return nil, nil
			}
			cursor++
			w.end = cursor
			order = append(order, w)
			stack = stack[:len(stack)-1]
			continue
		}
		if f.next < len(f.kids) {
			k := f.kids[f.next]
			f.next++
			kw := &wnode{d: k, start: cursor}
			w.kids = append(w.kids, kw)
			stack = append(stack, &frame{w: kw, kids: flattenKids(k.a)})
			continue
		}
		w.end = cursor
		order = append(order, w)
		stack = stack[:len(stack)-1]
	}
	if records != len(run.recordAt) || cursor != len(rc.synthetic) {
		return nil, nil
	}

	// The items that W(D) can use, by set, production, dot and origin: only
	// the keys that its nodes ask for are indexed.
	type where struct {
		set         int
		prod        *production
		dot, origin int32
	}
	index := map[where][]*item{}
	need := map[int]bool{}
	for _, w := range order {
		if w.d.kind == dRead {
			continue
		}
		if elided(w.d) {
			index[where{w.end, w.d.prod, 0, int32(w.start)}] = nil
			need[w.end] = true
			continue
		}
		index[where{w.start, w.d.prod, 0, int32(w.start)}] = nil
		need[w.start] = true
		for i, k := range w.kids {
			index[where{k.end, w.d.prod, int32(i + 1), int32(w.start)}] = nil
			need[k.end] = true
		}
	}
	for k := range need {
		if k >= len(run.rec.sets) {
			continue
		}
		for _, it := range run.rec.sets[k].items {
			key := where{k, it.prod, it.dot, it.origin}
			if list, ok := index[key]; ok {
				index[key] = append(list, it)
			}
		}
	}
	itemsAt := func(k int, p *production, dot, origin int) []*item {
		return index[where{k, p, int32(dot), int32(origin)}]
	}

	// For each close of W(D), the items that derive it exactly; and for
	// each item found, the links that the walk matched.
	found := map[*wnode]map[*item]bool{}
	marks := map[*item]map[link]bool{}
	keep := func(it *item, l link) {
		if marks[it] == nil {
			marks[it] = map[link]bool{}
		}
		marks[it][l] = true
	}
	for _, w := range order {
		n := w.d
		if n.kind == dRead {
			continue
		}
		if elided(n) {
			set := map[*item]bool{}
			for _, it := range itemsAt(w.end, n.prod, 0, w.start) {
				if it.restores {
					set[it] = true
					for _, l := range it.links {
						keep(it, l)
					}
				}
			}
			found[w] = set
			continue
		}
		// A link from a predicted item has no predecessor (earley.go).
		current := map[*item]bool{}
		predicted := false
		for _, it := range itemsAt(w.start, n.prod, 0, w.start) {
			if !it.restores {
				current[it], predicted = true, true
				// A predicted item has no links, and W(D) holds it all
				// the same.
				if marks[it] == nil {
					marks[it] = map[link]bool{}
				}
			}
		}
		for i, k := range w.kids {
			next := map[*item]bool{}
			for _, it := range itemsAt(k.end, n.prod, i+1, w.start) {
				for _, l := range it.links {
					if l.prev == nil {
						if i != 0 || !predicted {
							continue
						}
					} else if !current[l.prev] {
						continue
					}
					var ok bool
					if k.d.kind == dRead {
						ok = l.sym == nil && int(l.tok) == k.start && l.term == k.d.term
					} else if l.sym != nil {
						for _, c := range l.sym.items {
							if found[k][c] {
								ok = true
								break
							}
						}
					}
					if ok {
						next[it] = true
						keep(it, l)
					}
				}
			}
			current = next
		}
		found[w] = current
	}
	held := false
	for _, s := range run.top {
		for _, it := range s.items {
			if found[root][it] {
				held = true
			}
		}
	}
	if !held {
		return nil, nil
	}
	// W(D) as a derivation of the ranking's own kind: reads and closes in
	// post-order, over the tokens of R and the spans of the items found. A
	// restoration reads its synthetic token, and then closes over it.
	built := map[*wnode]*dn{}
	for _, w := range order {
		switch {
		case w.d.kind == dRead:
			built[w] = readNode(int32(w.end-1), w.d.term)
		case elided(w.d):
			read := readNode(int32(w.end-1), run.rec.g.termID[w.d.prod.elided])
			built[w] = closeNode(w.d.prod, int32(w.end-1), int32(w.end), nil, partNode(nil, read))
		default:
			var kids *dn
			for _, k := range w.kids {
				kids = partNode(kids, built[k])
			}
			built[w] = closeNode(w.d.prod, int32(w.start), int32(w.end), nil, kids)
		}
	}
	return marks, built[root]
}

// lostCase is a two-stage pipeline whose first stage runs the check of
// elision-only over two terminators at one position, one tested, with a
// warning on its chosen tree.
func lostCase(t *testing.T) (*Dialect, *engineCase) {
	c := &engineCase{
		Documents: map[string]string{"p.md": "```jbogenbau\n%stage main\n%ambiguity-resolution late-elision elision-only\n%elidable T U\n" +
			"%rule text a | b\n%rule a w! A [T=\"ta\"] [U] %emits $ <~x>\n%rule b A [T=\"ta\"] [U] [U]\n" +
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
		var got map[string]any
		json.Unmarshal(data, &got)
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
