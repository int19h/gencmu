package gencmu

import (
	"encoding/json"
	"fmt"
	"math/bits"
	"strings"
	"testing"
)

// silentRun is a stage run over n tokens without phonemes, but for the last,
// which sounds like "a".
func silentRun(t *testing.T, n int) *stageRun {
	d := mustLoad(t, oneStage("%ambiguity-resolution greedy\n%rule text {A}"))
	toks := make([]Token, n)
	for i := range toks {
		toks[i] = Token{Text: "x", Tags: []string{"A"}, Span: [2]int{i, i + 1}, Source: [2]int{2 * i, 2*i + 1}}
	}
	toks[n-1].Phonemes = "a"
	ps := newParseState(d.uni, []rune(strings.TrimSpace(strings.Repeat("x ", n))))
	return ps.newRun("main", d.stages[0], toks)
}

// TestSilentSoundWork: a sound test and phonemes() over a span of tokens
// without phonemes skip them, so their work is bounded by the sound, not by
// the span (engine §4, §5).
func TestSilentSoundWork(t *testing.T) {
	for _, n := range []int{1000, 4000} {
		run := silentRun(t, n)
		// A walk of the silent tokens would cost n at each of n starts.
		w := &workCounts{}
		w.soundSteps.most = int64(4 * n)
		countWorkIn(w, func() {
			for i := 0; i < n; i++ {
				if !run.soundIs("a", i, n) || run.soundIs("", i, n) || !run.soundIs("", i, n-1) {
					t.Fatalf("%d tokens: the wrong sound from %d", n, i)
				}
				if got := run.phonemes(spanVal{a: i, b: n}); got != "a" {
					t.Fatalf("%d tokens: phonemes from %d are %q", n, i, got)
				}
			}
		})
		t.Logf("%d tokens: %d steps for %d tests", n, w.soundSteps.Load(), 4*n)
	}
}

// TestManyLinksAddLinear: in the check of elision-only, an item reached in
// many ways checks each new link against those it has without a scan of
// them all (engine §7.4).
func TestManyLinksAddLinear(t *testing.T) {
	for _, n := range []int{1000, 4000} {
		r := &recognizer{recon: &reconstruction{}}
		key := itemKey{prod: &production{rhs: make([]symbol, 1)}}
		// A scan of every link at each add would cost n squared.
		w := &workCounts{}
		w.linkSteps.most = int64(4*n + linkScanLimit*linkScanLimit)
		countWorkIn(w, func() {
			for range 2 {
				for i := range n {
					r.add(0, key, link{tok: int32(i)}, true, false)
				}
			}
		})
		if got := len(r.sets[0].index[key].links); got != n {
			t.Fatalf("%d links, not %d", got, n)
		}
		t.Logf("%d links added twice: %d steps", n, w.linkSteps.Load())
	}
}

// tagRun is a stage run over n tokens, the token i with the tags A and Ti.
func tagRun(t *testing.T, n int) *stageRun {
	d := mustLoad(t, oneStage("%ambiguity-resolution greedy\n%rule text {A}"))
	toks := make([]Token, n)
	for i := range toks {
		toks[i] = Token{Text: "x", Tags: []string{"A", fmt.Sprintf("T%d", i)}, Span: [2]int{i, i + 1}, Source: [2]int{2 * i, 2*i + 1}}
	}
	ps := newParseState(d.uni, []rune(strings.TrimSpace(strings.Repeat("x ", n))))
	return ps.newRun("main", d.stages[0], toks)
}

// TestUnionsLinear: tags() of a long span, a union of many parts and a
// constant of many parts gather their members once, without copying and
// interning a growing set at each part (engine §10).
func TestUnionsLinear(t *testing.T) {
	// Each union of n parts examines a few times n members, and sorts
	// them in a few times n log n comparisons.
	for _, n := range []int{1000, 4000} {
		run := tagRun(t, n)
		w := &workCounts{}
		w.interned.most = int64(n) * (8 + 5*int64(bits.Len(uint(n))))
		countWorkIn(w, func() {
			if got := len(run.evaluator(nil, nil).spanTags(spanVal{a: 0, b: n}).names); got != n+1 {
				t.Fatalf("%d tags, not %d", got, n+1)
			}
			if got := len(run.evaluate(run.evaluator(nil, nil), tagUnion(n)).set.names); got != n {
				t.Fatalf("%d tags, not %d", got, n)
			}
			v, err := (&stageGrammar{}).evaluateClosed("", tagUnion(n), [2]int{})
			if err != nil || len(v.names) != n {
				t.Fatalf("%v, not %d tags", err, n)
			}
		})
		t.Logf("unions of %d parts: %d members interned", n, w.interned.Load())
	}
}

// tagUnion is the term ~T0 ∪ ~T1 ∪ … of n parts.
func tagUnion(n int) *domTerm {
	union := &domTerm{Kind: tmUnion}
	for i := range n {
		union.Items = append(union.Items, &domTerm{Kind: tmTag, Str: fmt.Sprintf("T%d", i)})
	}
	return union
}

// domStage loads a one-stage dialect whose grammar is a DOM, given as
// JSON, so that a large grammar costs no reading of its notation.
func domStage(t *testing.T, dom string) *Dialect {
	t.Helper()
	l, err := bundledLoader()
	if err != nil {
		t.Fatal(err)
	}
	src := oneStage("")
	l.read = func(p string) (string, bool) { s, ok := src[p]; return s, ok }
	l.compiled = map[string]json.RawMessage{fnv1a64(src["g.md"]): json.RawMessage(dom)}
	d, err := l.dialect("p.md")
	if err != nil {
		t.Fatal(err)
	}
	return d
}

// TestEmissionLinear: a constituent of many captures that emits them with
// a run of inserted tags before them finds each part and each anchor
// without a scan of the production or of the items (engine §11).
func TestEmissionLinear(t *testing.T) {
	dialect := func(n int) *Dialect {
		seq := make([]string, n)
		items := make([]string, 0, 4*n)
		for i := range seq {
			seq[i] = fmt.Sprintf(`{"capture":"c%d","expr":{"ref":"A"}}`, i)
			items = append(items, `{"insert":"X"}`, `{"insert":"X"}`, `{"insert":"X"}`)
		}
		for i := range seq {
			items = append(items, fmt.Sprintf(`{"capture":"c%d"}`, i))
		}
		return domStage(t, fmt.Sprintf(`{"format":%d,"rules":[{"name":"text","op":"define","alternatives":[{"guards":[],"expr":{"seq":[%s]}}],"emit":{"items":[%s]},"conditions":[],"at":[1,1]}],"directives":[{"name":"ambiguity-resolution","args":["greedy"],"at":[2,1]}],"constants":[],"classifiers":[],"implications":[]}`, domFormat, strings.Join(seq, ","), strings.Join(items, ",")))
	}
	for _, n := range []int{1000, 4000} {
		d := dialect(n)
		toks := make([]Token, n)
		for i := range toks {
			toks[i] = Token{Text: "a", Tags: []string{"A"}, Span: [2]int{i, i + 1}, Source: [2]int{2 * i, 2*i + 1}}
		}
		text := strings.TrimSpace(strings.Repeat("a ", n))
		parse := func() {
			res, err := d.ParseTokens(text, toks, ParseOptions{})
			if err != nil || !res.OK || len(res.Stages[0].Output) != 4*n {
				t.Fatalf("%d captures: %v", n, err)
			}
		}
		// Once first, so that lowering counts in no budget.
		parse()
		// The 4n items and the n parts, each looked at a bounded number of
		// times. A scan from each insert would cost the inserts their square.
		w := &workCounts{}
		w.emitSteps.most = 12 * int64(n)
		countWorkIn(w, parse)
		t.Logf("%d captures and %d inserts: %d steps", n, 3*n, w.emitSteps.Load())
	}
}

// seqDOM is the DOM of a grammar whose rule text is the sequence of items,
// each given as the JSON of an expression, with more rules after it.
func seqDOM(items []string, rules ...string) string {
	all := append([]string{`{"name":"text","op":"define","alternatives":[{"guards":[],"expr":{"seq":[` + strings.Join(items, ",") + `]}}],"conditions":[],"at":[1,1]}`}, rules...)
	return fmt.Sprintf(`{"format":%d,"rules":[%s],"directives":[{"name":"ambiguity-resolution","args":["greedy"],"at":[2,1]}],"constants":[],"classifiers":[],"implications":[]}`, domFormat, strings.Join(all, ","))
}

// TestLoweringLinear: lowering a long sequence copies each of its symbols
// a bounded number of times, not once for each symbol after it (engine §3).
func TestLoweringLinear(t *testing.T) {
	for _, n := range []int{1000, 4000} {
		d := domStage(t, seqDOM(strings.Split(strings.Repeat(`{"ref":"A"} `, n-1)+`{"ref":"A"}`, " ")))
		w := &workCounts{}
		w.loweredSlots.most = 4 * int64(n)
		var l *lowered
		countWorkIn(w, func() { l = lower(d.stages[0], map[string]bool{}) })
		if len(l.prods[0].rhs) != n {
			t.Fatalf("%d symbols, not %d", len(l.prods[0].rhs), n)
		}
		t.Logf("a sequence of %d: %d slots copied", n, w.loweredSlots.Load())
	}
}

// TestCaptureSequencesLinear: the checks of a definition list the captures
// of a long sequence in one pass, without copying the sequence so far at
// each capture (engine §3.5). A sequence of many groups costs its length
// too, without copying the groups already read at each group.
func TestCaptureSequencesLinear(t *testing.T) {
	capture := func(i int) *domExpr {
		return &domExpr{Kind: exCapture, Name: fmt.Sprintf("c%d", i), Inner: &domExpr{Kind: exRef, Name: "A"}}
	}
	for _, n := range []int{1000, 4000} {
		flat, grouped := &domExpr{Kind: exSeq}, &domExpr{Kind: exSeq}
		for i := range n {
			flat.Items = append(flat.Items, capture(i))
			grouped.Items = append(grouped.Items, &domExpr{Kind: exSeq, Items: []*domExpr{capture(i)}})
		}
		for _, seq := range []*domExpr{flat, grouped} {
			// Each capture and each group is looked at, copied and joined
			// a bounded number of times.
			w := &workCounts{}
			w.readerSteps.most = 12 * int64(n)
			var caps []map[string]int
			countWorkIn(w, func() { caps = altCaptures(&domAlt{Expr: seq}) })
			if len(caps) != 1 || len(caps[0]) != n+1 {
				t.Fatalf("%d captures: %d sequences", n, len(caps))
			}
			t.Logf("%d captures: %d steps", n, w.readerSteps.Load())
		}
	}
}

// TestCaptureSequencesOutputBound: captures in nested optionals, $c0(A)
// [$c1(A) [… $c(n−1)(A) …]], give n+1 sequences of up to n captures each.
// Listing them costs a bounded number of steps for each capture of each
// sequence. A list is written out once, so a check for repeated lists that
// wrote out every list at each level would cost n cubed.
func TestCaptureSequencesOutputBound(t *testing.T) {
	for _, n := range []int{60, 240} {
		var e *domExpr
		for i := n - 1; i >= 0; i-- {
			c := &domExpr{Kind: exCapture, Name: fmt.Sprintf("c%d", i), Inner: &domExpr{Kind: exRef, Name: "A"}}
			if e == nil {
				e = &domExpr{Kind: exOptional, Inner: c}
				continue
			}
			e = &domExpr{Kind: exOptional, Inner: &domExpr{Kind: exSeq, Items: []*domExpr{c, e}}}
		}
		size := int64(n + 1)
		for k := 1; k <= n; k++ {
			size += int64(k)
		}
		w := &workCounts{}
		w.readerSteps.most = 8 * size
		var caps []map[string]int
		countWorkIn(w, func() { caps = altCaptures(&domAlt{Expr: e}) })
		if len(caps) != n+1 {
			t.Fatalf("%d levels: %d sequences", n, len(caps))
		}
		t.Logf("%d levels, %d captures in all: %d steps", n, size, w.readerSteps.Load())
	}
}

// TestSharedClausesOnce: a rule's clauses, which all its alternatives
// share, are checked and given their constants' values once, not once for
// each alternative (engine §2, §9).
func TestSharedClausesOnce(t *testing.T) {
	for _, n := range []int{100, 400} {
		alts := strings.TrimSuffix(strings.Repeat(`{"guards":[],"expr":{"capture":"x","expr":{"ref":"A"}}},`, n), ",")
		conds := strings.TrimSuffix(strings.Repeat(`{"op":"=","left":{"call":"text","args":[{"capture":"x"}]},"right":{"const":"K","at":[3,1]}},`, n), ",")
		dom := fmt.Sprintf(`{"format":%d,"rules":[{"name":"text","op":"define","tags":{"union":[{"tag":"T"},{"tag":"U"}]},"alternatives":[%s],"conditions":[%s],"at":[3,1]}],"directives":[{"name":"ambiguity-resolution","args":["greedy"],"at":[1,1]}],"constants":[{"name":"K","op":"define","value":{"string":"a"},"at":[2,1]}],"classifiers":[],"implications":[]}`, domFormat, alts, conds)
		w := &workCounts{}
		w.clauseSteps.most = 20 * int64(n)
		countWorkIn(w, func() { domStage(t, dom) })
		t.Logf("%d alternatives sharing %d conditions: %d steps", n, n, w.clauseSteps.Load())
	}
}

// chainDOM is the DOM of a chain of rules, text → r0 A, r0 → r1, …, each
// rule's one production the next rule, the last's last.
func chainDOM(n int, last string) string {
	rules := make([]string, n)
	for i := range rules {
		expr := fmt.Sprintf(`{"ref":"r%d"}`, i+1)
		if i == n-1 {
			expr = last
		}
		rules[i] = fmt.Sprintf(`{"name":"r%d","op":"define","alternatives":[{"guards":[],"expr":%s}],"conditions":[],"at":[%d,1]}`, i, expr, i+3)
	}
	return seqDOM([]string{`{"ref":"r0"}`, `{"ref":"A"}`}, rules...)
}

// TestRuleSetsLinear: the rules that can derive the empty sequence and the
// rules that can read are found by a worklist, each rule settled once, so
// a long chain of rules costs its length, not its square. The rules a long
// production reaches over the same span cost its length too (engine §3,
// §4, §7.4).
func TestRuleSetsLinear(t *testing.T) {
	last := `{"choice":[{"ref":"A"},{"empty":true}]}`
	for _, n := range []int{1000, 4000} {
		d := domStage(t, chainDOM(n, last))
		// Each of the three sets examines each production and symbol a few
		// times.
		w := &workCounts{}
		w.ruleSetSteps.most = 20 * int64(n)
		var l *lowered
		var rs *readingSets
		countWorkIn(w, func() {
			l = lower(d.stages[0], map[string]bool{})
			rs = makeReading(l)
		})
		if !l.rules[l.byName["r0"]].nullable {
			t.Fatalf("r0 of %d is not nullable", n)
		}
		if rs.last[l.rules[l.byName["r0"]].prods[0]] != 0 {
			t.Fatalf("r0 of %d cannot read", n)
		}
		t.Logf("a chain of %d rules: %d steps", n, w.ruleSetSteps.Load())
		// The rules that text reaches over the same span, through a long
		// production of nullable rules, cost the production's length.
		e := `{"name":"e","op":"define","alternatives":[{"guards":[],"expr":{"empty":true}}],"conditions":[],"at":[3,1]}`
		d = domStage(t, seqDOM(strings.Split(strings.Repeat(`{"ref":"e"} `, n-1)+`{"ref":"e"}`, " "), e))
		w = &workCounts{}
		w.ruleSetSteps.most = 20 * int64(n)
		countWorkIn(w, func() { l = lower(d.stages[0], map[string]bool{}) })
		if !l.rules[l.byName["text"]].nullable {
			t.Fatalf("text of %d is not nullable", n)
		}
		t.Logf("a production of %d nullable rules: %d steps", n, w.ruleSetSteps.Load())
	}
}

// TestUnitEdgesMutation checks every other symbol of a production for
// each of its symbols, to find the rules it reaches over the same span.
// With the budget the fixed lowering takes, the first check past it stops.
func TestUnitEdgesMutation(t *testing.T) {
	const n = 1000
	e := `{"name":"e","op":"define","alternatives":[{"guards":[],"expr":{"empty":true}}],"conditions":[],"at":[3,1]}`
	d := domStage(t, seqDOM(strings.Split(strings.Repeat(`{"ref":"e"} `, n-1)+`{"ref":"e"}`, " "), e))
	lowerIt := func() { lower(d.stages[0], map[string]bool{}) }
	all := &workCounts{}
	countWorkIn(all, lowerIt)
	w := &workCounts{checkOthers: true}
	w.ruleSetSteps.most = all.ruleSetSteps.Load()
	stopsAtFirst(t, w, &w.ruleSetSteps, "rule set steps", lowerIt)
}

// TestClassesLinear: a key of a classifier given many classes, one entry
// each, and a later entry removing them, costs the classes, not their
// square (engine §2).
func TestClassesLinear(t *testing.T) {
	for _, n := range []int{1000, 4000} {
		c := &domClassifier{Name: "c"}
		for i := range n {
			c.Entries = append(c.Entries, &domEntry{Keys: []string{"a"}, Op: "∈", Class: fmt.Sprintf("C%d", n-i)})
		}
		for i := range n / 2 {
			c.Entries = append(c.Entries, &domEntry{Keys: []string{"a"}, Op: "∉", Class: fmt.Sprintf("C%d", 2*i+1)})
		}
		// Each entry looks at a bounded number of classes, and the sort at
		// the end makes n log n comparisons. A copy of the key's classes at
		// each entry would cost them their square.
		w := &workCounts{}
		w.classSteps.most = int64(n) * (4 + int64(bits.Len(uint(n))))
		var tables *classifierTables
		countWorkIn(w, func() { tables = resolveClassifiers([]classifierItem{{classifier: c}}, nil) })
		if tables.fault != "" || len(tables.tables["c"]["a"].names) != n/2 {
			t.Fatalf("%d classes: %q", n, tables.fault)
		}
		t.Logf("%d classes, half removed: %d steps", n, w.classSteps.Load())
	}
}

// TestImpliedLinear: the implications that a chain of tags sets off fire
// once each, found by the tags that set them off, so a token's work is the
// implications that fire, not passes over all of them (engine §11).
func TestImpliedLinear(t *testing.T) {
	run := tagRun(t, 1)
	for _, n := range []int{1000, 4000} {
		g := &stageGrammar{}
		// Listed last first, so that a pass over them in order would add
		// one tag.
		for i := n - 1; i >= 0; i-- {
			g.implications = append(g.implications, stageImplication{ifNames: []string{fmt.Sprintf("T%d", i)}, thenNames: []string{fmt.Sprintf("T%d", i+1)}})
		}
		g.indexImplications()
		run.grammar = g
		tags := run.ps.in.single("T0")
		// Each implication is looked at once. Passes over all of them until
		// none adds a tag would cost the chain its square.
		w := &workCounts{}
		w.implicationSteps.most = 2 * int64(n)
		var got *tagset
		countWorkIn(w, func() { got = run.implied(tags) })
		if len(got.names) != n+1 {
			t.Fatalf("%d tags, not %d", len(got.names), n+1)
		}
		t.Logf("a chain of %d implications: %d steps", n, w.implicationSteps.Load())
	}
}

// TestDeepDOMRefusedEarly: a precompiled DOM nested far deeper than its
// limit is refused once decoding passes the limit, so its cost grows with
// its size, not with its size times its depth (engine §9).
func TestDeepDOMRefusedEarly(t *testing.T) {
	// Each capture is one level of JSON, and encoding/json refuses more
	// than 10,000.
	for _, n := range []int{1000, 4000} {
		expr := strings.Repeat(`{"capture":"x","expr":`, n) + `{"ref":"A"}` + strings.Repeat(`}`, n)
		dom := json.RawMessage(seqDOM([]string{expr}))
		// Each level down to the limit reads what lies below it, and a few
		// levels above the expression read it all too. Decoding every level
		// would read the DOM as many times as it is deep.
		w := &workCounts{}
		w.decodeSteps.most = int64(maxDOMDepth+32) * int64(len(dom))
		var err error
		countWorkIn(w, func() { _, err = decodeDOM(dom, nil) })
		if err == nil {
			t.Fatalf("a DOM %d deep is not refused", n)
		}
		t.Logf("a DOM %d deep, %d bytes: %d bytes decoded", n, len(dom), w.decodeSteps.Load())
	}
}

// TestEligibilityQueryConstant: a query of eligibility finds the helpers of
// elidable optionals, and its maximality the terminators it restricts,
// made once for the lowered grammar, not by a walk of its productions, so
// n queries of a grammar of n rules cost n (engine §4).
func TestEligibilityQueryConstant(t *testing.T) {
	const n = 1000
	elidable := `{"optional":{"ref":"A"},"elidable":true}`
	l := lower(domStage(t, chainDOM(n, elidable)).stages[0], map[string]bool{})
	if !l.anyElidable {
		t.Fatalf("no elidable optional in %d rules", n)
	}
	// The queries walk no production. A walk of the grammar for any query
	// would pass this budget.
	w := &workCounts{}
	w.elidableSteps.most = int64(n)
	r := &recognizer{g: l}
	countWorkIn(w, func() {
		for range 100 {
			r.eligibleItems(nil)
			newMaximal(r, false)
		}
	})
	if steps := w.elidableSteps.Load(); steps != 0 {
		t.Errorf("100 queries of %d rules: %d productions walked", n, steps)
	}
}

// conditionsRun is the recognition of a production of n captures over n
// tokens, with a condition at each capture.
func conditionsRun(t *testing.T, n int) func() *recognizer {
	names := make([]string, n)
	conditions := make([]string, n)
	for i := range names {
		names[i] = fmt.Sprintf("$c%d(A)", i)
		conditions[i] = fmt.Sprintf("text($c%d) = \"a\"", i)
	}
	d := mustLoad(t, oneStage("%ambiguity-resolution greedy\n%rule text "+strings.Join(names, " ")+"\n%conditions "+strings.Join(conditions, ", ")))
	lg := d.lower(0, map[string]bool{})
	toks := make([]Token, n)
	for i := range toks {
		toks[i] = Token{Text: "a", Tags: []string{"A"}, Span: [2]int{i, i + 1}, Source: [2]int{2 * i, 2*i + 1}}
	}
	ps := newParseState(d.uni, []rune(strings.TrimSpace(strings.Repeat("a ", n))))
	run := ps.newRun("main", d.stages[0], toks)
	return func() *recognizer { return run.recognize(lg, lg.byName["text"], 0, n) }
}

// TestConditionsByDot: an advance looks only at the conditions that its
// dot makes ready, so a production of n captures, each with a condition,
// looks at n conditions over a parse, not n at each advance (engine §4).
func TestConditionsByDot(t *testing.T) {
	for _, n := range []int{100, 400} {
		recognize := conditionsRun(t, n)
		// A look at every condition at each advance would cost n squared.
		w := &workCounts{}
		w.conditions.most = int64(n)
		var rec *recognizer
		countWorkIn(w, func() { rec = recognize() })
		if len(rec.sets[n].items) == 0 {
			t.Fatalf("%d captures: no item at the end", n)
		}
		if got := w.conditions.Load(); got != int64(n) {
			t.Errorf("%d captures: %d conditions looked at", n, got)
		}
	}
}

// TestConditionsByDotMutation selects each advance's conditions by a scan
// of all of them. The first advance examines all n, so the second stops
// at the first condition past the budget.
func TestConditionsByDotMutation(t *testing.T) {
	const n = 100
	recognize := conditionsRun(t, n)
	w := &workCounts{scanConds: true}
	w.conditions.most = n
	stopsAtFirst(t, w, &w.conditions, "conditions", func() { recognize() })
}

// TestPredictionConditionsStopAtFirst: a condition that holds or fails at
// prediction counts before it is evaluated, so a budget one less than a
// run's total stops the run at its last condition. The rule e is
// predicted at each token, with a condition on its empty span.
func TestPredictionConditionsStopAtFirst(t *testing.T) {
	const n = 50
	d := mustLoad(t, oneStage("%ambiguity-resolution greedy\n%rule text {A e}\n%rule e ε\n%conditions text($) = \"\""))
	lg := d.lower(0, map[string]bool{})
	if len(lg.rules[lg.byName["e"]].prods[0].predictConds) == 0 {
		t.Fatal("e has no condition at prediction")
	}
	toks := make([]Token, n)
	for i := range toks {
		toks[i] = Token{Text: "a", Tags: []string{"A"}, Span: [2]int{i, i + 1}, Source: [2]int{2 * i, 2*i + 1}}
	}
	ps := newParseState(d.uni, []rune(strings.TrimSpace(strings.Repeat("a ", n))))
	run := ps.newRun("main", d.stages[0], toks)
	recognize := func() { run.recognize(lg, lg.byName["text"], 0, n) }
	all := &workCounts{}
	countWorkIn(all, recognize)
	total := all.conditions.Load()
	if total < n {
		t.Fatalf("%d tokens: %d conditions", n, total)
	}
	w := &workCounts{}
	w.conditions.most = total - 1
	stopsAtFirst(t, w, &w.conditions, "conditions", recognize)
}

// TestIncludeChainLinear: a chain of documents, each including the next,
// is spliced without copying the chain at each include, and n stages are
// told apart by name without a scan of those before (engine §2).
func TestIncludeChainLinear(t *testing.T) {
	for _, n := range []int{1000, 4000} {
		doms := map[string]*domDoc{}
		for i := range n {
			doms[fmt.Sprintf("d%d.md", i)] = &domDoc{
				Rules:      []*domRule{{Name: "text", At: [2]int{2, 1}}},
				Directives: []*domDirective{{Name: "stage", Args: []string{fmt.Sprintf("s%d", i)}, At: [2]int{1, 1}}, {Name: "include", Args: []string{fmt.Sprintf("d%d.md", i+1)}, At: [2]int{3, 1}}},
			}
		}
		doms[fmt.Sprintf("d%d.md", n)] = &domDoc{}
		// One step for each include and each stage. A copy or scan of the
		// chain at each would cost it its square.
		w := &workCounts{}
		w.spliceSteps.most = 4 * int64(n)
		var p *splicedPipeline
		var err *Error
		countWorkIn(w, func() {
			p, err = splicePipeline("d0.md", func(path string) (*domDoc, *Error) { return doms[path], nil })
		})
		if err != nil || len(p.stages) != n {
			t.Fatalf("%d documents: %v", n, err)
		}
		t.Logf("a chain of %d includes: %d steps", n, w.spliceSteps.Load())
	}
}

// TestCaptureSetsStopAtFirst: the checks of a definition count each
// capture they look at, compare or copy before they do, so a budget
// stops them at the first step past it. The expression is a sequence of
// groups of captures whose names repeat, with a choice that makes the
// sequences multiply.
func TestCaptureSetsStopAtFirst(t *testing.T) {
	capture := func(name string) *domExpr {
		return &domExpr{Kind: exCapture, Name: name, Inner: &domExpr{Kind: exRef, Name: "A"}}
	}
	seq := &domExpr{Kind: exSeq}
	for g := range 12 {
		group := &domExpr{Kind: exSeq}
		for i := range 10 {
			group.Items = append(group.Items, capture(fmt.Sprintf("c%d", (g+i)%5)))
		}
		seq.Items = append(seq.Items, group)
		if g == 6 {
			seq.Items = append(seq.Items, &domExpr{Kind: exChoice, Items: []*domExpr{capture("x"), capture("y")}})
		}
	}
	for _, c := range []struct {
		name string
		f    func()
	}{
		{"captureSequences", func() { captureSequences(seq) }},
		{"duplicateCaptures", func() { duplicateCaptures(seq) }},
	} {
		name, f := c.name, c.f
		all := &workCounts{}
		countWorkIn(all, f)
		total := all.readerSteps.Load()
		for most := int64(1); most < total; most++ {
			w := &workCounts{}
			w.readerSteps.most = most
			if !stopsAtFirst(t, w, &w.readerSteps, "reader steps", f) {
				t.Errorf("%s, %d steps in all", name, total)
				break
			}
		}
	}
}

// setOperations is an intersection, a difference and a subset test of two
// sets of n members each, every other member of one in the other.
func setOperations(t *testing.T, n int) func() {
	in := newInterner()
	evens, all := make([]string, 0, n), make([]string, 0, n)
	for i := range n {
		evens = append(evens, fmt.Sprintf("T%06d", 2*i))
		all = append(all, fmt.Sprintf("T%06d", i))
	}
	a, b := in.fromList(evens), in.fromList(all)
	return func() {
		if got := len(in.intersection(a, b).names); got != n/2 {
			t.Fatalf("%d members in common, not %d", got, n/2)
		}
		if got := len(in.difference(a, b).names); got != n-n/2 {
			t.Fatalf("%d members left, not %d", got, n-n/2)
		}
		if subset(a, b) {
			t.Fatalf("the evens of %d are a subset", n)
		}
	}
}

// TestSetOperationsLinear: an intersection, a difference and a subset test
// look each member up in the other set by a binary search. Each probe
// counts, so a scan of the other set would pass the budget.
func TestSetOperationsLinear(t *testing.T) {
	for _, n := range []int{1000, 4000} {
		ops := setOperations(t, n)
		w := &workCounts{}
		w.interned.most = int64(n) * (6 + 3*int64(bits.Len(uint(n))))
		countWorkIn(w, ops)
		t.Logf("set operations of %d members: %d steps", n, w.interned.Load())
	}
}

// TestSetOperationsMutation looks each member up in the other set by a
// scan. The budget of the binary searches stops it at the first probe
// past it.
func TestSetOperationsMutation(t *testing.T) {
	const n = 1000
	ops := setOperations(t, n)
	w := &workCounts{scanOther: true}
	w.interned.most = int64(n) * (6 + 3*int64(bits.Len(uint(n))))
	stopsAtFirst(t, w, &w.interned, "interned members", ops)
}

// TestUnionsMutation copies the members gathered so far again for each
// member of a union. The budget of the linear union stops it at the first
// copy past it.
func TestUnionsMutation(t *testing.T) {
	const n = 1000
	run := tagRun(t, n)
	w := &workCounts{copyGrowing: true}
	w.interned.most = int64(n) * (8 + 5*int64(bits.Len(uint(n))))
	stopsAtFirst(t, w, &w.interned, "interned members", func() {
		run.evaluate(run.evaluator(nil, nil), tagUnion(n))
	})
}
