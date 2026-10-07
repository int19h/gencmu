package gencmu

// The check of elision-only (engine §7). It writes the chosen derivation's
// elided terminators back into the stage's input as synthetic tokens, and
// recognizes that input, R, with the main lowering in the reconstruction
// mode of §7.4. Every observation reads the stage's input, O, through the
// projection π (§7.3, §7.5), and the nested queries that the check starts
// run over O in the ordinary mode, sharing the main parse's memo and active
// queries (§7.6).

// restoration says whether a production is the empty production of the
// helper of an elidable optional (§3.8), which the check reads as a
// restoration (§7.4).
func (p *production) restoration() bool {
	return len(p.rhs) == 0 && p.helper && p.elided != ""
}

// readingSets is what can read in the reconstruction mode (§7.4): for each
// production, the index of its last symbol that can read, or -1. A terminal
// can read. A production can read where it holds a symbol that can, and the
// restoration can read too. A rule or helper can read where one of its
// productions can. These are the least sets that the rules give.
//
// elidable marks the helpers of elidable optionals, whose productions other
// than the restoration begin with the optional's terminal.
type readingSets struct {
	last     map[*production]int
	elidable []bool
}

func readingOf(g *lowered) *readingSets {
	g.readingOnce.Do(func() { g.reading = makeReading(g) })
	return g.reading
}

func makeReading(g *lowered) *readingSets {
	// From nothing up, so that a rule that can read only through itself,
	// such as z → z, cannot read.
	rules := derivedRules(len(g.rules), len(g.prods), func(i int) (int32, []symbol) { return g.prods[i].lhs, g.prods[i].rhs }, func(i int) bool { return g.prods[i].restoration() }, false)
	reads := func(s symbol) bool { return s.term || rules[s.id] }
	rs := &readingSets{last: make(map[*production]int, len(g.prods)), elidable: make([]bool, len(g.rules))}
	w := work.Load()
	for _, p := range g.prods {
		if w != nil {
			w.ruleSetSteps.add("rule set steps")
		}
		if p.restoration() {
			rs.elidable[p.lhs] = true
		}
		at := -1
		for i, s := range p.rhs {
			if w != nil {
				w.ruleSetSteps.add("rule set steps")
			}
			if reads(s) {
				at = i
			}
		}
		rs.last[p] = at
	}
	return rs
}

// reconstruction is how the recognition of R reads its tokens and observes
// O (§7.2, §7.3).
type reconstruction struct {
	// tagsets and sounds are each token's recognition tags and, for a
	// synthetic token, its recognition sound, in canonical form.
	tagsets []*tagset
	sounds  []string
	// synthetic marks each token's provenance, original holds an original
	// token's index in O (-1 for a synthetic token), and record a synthetic
	// token's record (-1 for an original token).
	synthetic []bool
	original  []int
	record    []int
	// project is π: for each position of R, the number of original tokens
	// before it.
	project []int
	reading *readingSets
}

// elisionCheckRun is what a check of elision-only that recognized R and met
// no error of the grammar hands its test hook before it ranks
// (tests/README.md): D, the chosen derivation, the recognition of R and its
// completed items of text, and how R relates to O.
type elisionCheckRun struct {
	chosen *dn
	rec    *recognizer
	top    []*symNode
	recon  *reconstruction
	// originalAt is each token of O's index in R, recordAt each record's.
	originalAt, recordAt []int
}

// elisionWatch is what the witness test gives back to a check: the marks of
// W(D)'s links, nil where the chart does not hold W(D), and a callback that
// receives the check's ranking, nil where it has none, and its ranker.
type elisionWatch struct {
	marks  map[*item]map[link]bool
	ranked func(*rankResult, *ranker)
}

// privateOptions are the switches and hooks of the library's own tests,
// which a parse takes through an unexported field of ParseOptions, so that
// no caller can set them and parses that run at once keep them apart.
type privateOptions struct {
	// elisionCheck, when set, receives each check of elision-only that
	// recognized R and met no error of the grammar, before it ranks, for
	// the witness test of tests/README.md. It gives back the marks of
	// W(D)'s links, which the check's own ranker takes, and a callback
	// that receives the ranking and the ranker.
	elisionCheck func(*elisionCheckRun) elisionWatch
	// loseWitness loses the witness of a check after recognition (§7.9):
	// "roots" drops the completed items of text over R, and "count" drops
	// their derivations.
	loseWitness string
	// fault turns on a fault of the library's own paths in the check, to
	// show that the shared cases catch it (tests/README.md,
	// faults_test.go):
	//   - "reprocess" leaves an item that an ordinary step reaches as it
	//     was processed while strict (§7.4);
	//   - "route3" makes the item after the T of route 3 ordinary (§7.4);
	//   - "restore" makes a restoration without the test of its terminal,
	//     outside add (§7.4);
	//   - "rank-restoration" gives a restoration no derivation in the
	//     ranking, so the ranking does not count W(D) though the chart
	//     holds it.
	//   - "lost:context" makes the check's count skip the last of two or
	//     more links of an item, or completed items of a constituent, and
	//     "lost:select" makes its candidates skip it. Only the witness hook
	//     sees lost:context where the readings stay.
	fault string
	// hits records each site of the fault that the parse entered while it
	// was on, by its name, or its name and site after an @, for the fault
	// test (tests/README.md).
	hits map[string]bool
}

// fault says whether a test turned on this fault of the check, at its one
// site.
func (ps *parseState) fault(name string) bool {
	return ps.faultAt(name, "")
}

// faultAt says whether a test turned on this fault of the check, at one of
// its sites, which a fault that is on records as entered.
func (ps *parseState) faultAt(name, site string) bool {
	if ps.private == nil || ps.private.fault != name {
		return false
	}
	if ps.private.hits != nil {
		key := name
		if site != "" {
			key += "@" + site
		}
		ps.private.hits[key] = true
	}
	return true
}

// checkElision is the check of §7 for the chosen derivation d, whose tree is
// tree, of the recognition rec. It is nil where the check passes. A check
// can also end with an error of the grammar, which panics as any does.
func (run *stageRun) checkElision(rec *recognizer, d *dn, tree *Node) *ParseError {
	g := rec.g
	in := run.ps.in
	// The records, in the order of the tree's leaves (§7.2).
	var records []Restoration
	for _, n := range elidedNodes(tree) {
		records = append(records, Restoration{Terminal: n.Terminal, At: n.Span[0], Source: n.Source, Sound: n.sound, Tested: n.tested})
	}
	// R: O with one synthetic token before the token at each record's
	// position, or at the end. Records at one position keep their order.
	rc := &reconstruction{reading: readingOf(g)}
	var toks []Token // R's tokens, for the readings' trees
	originalAt := make([]int, len(run.toks))
	recordAt := make([]int, len(records))
	next := 0
	for i := 0; i <= len(run.toks); i++ {
		for next < len(records) && records[next].At == i {
			r := records[next]
			recordAt[next] = len(toks)
			toks = append(toks, Token{Tags: []string{r.Terminal}, Phonemes: r.Sound, Span: [2]int{i, i}, Source: r.Source})
			rc.tagsets = append(rc.tagsets, in.single(r.Terminal))
			rc.sounds = append(rc.sounds, run.ps.uni.canonical(r.Sound))
			rc.synthetic = append(rc.synthetic, true)
			rc.original = append(rc.original, -1)
			rc.record = append(rc.record, next)
			next++
		}
		if i < len(run.toks) {
			originalAt[i] = len(toks)
			toks = append(toks, run.toks[i])
			rc.tagsets = append(rc.tagsets, run.tagsets[i])
			rc.sounds = append(rc.sounds, "")
			rc.synthetic = append(rc.synthetic, false)
			rc.original = append(rc.original, i)
			rc.record = append(rc.record, -1)
		}
	}
	rc.project = make([]int, len(toks)+1)
	for k := range toks {
		rc.project[k+1] = rc.project[k]
		if !rc.synthetic[k] {
			rc.project[k+1]++
		}
	}
	// The recognition of R is not a query, and the input that initial(),
	// from() and after() see is O (§7.5, §7.6), the main parse's.
	start := g.byName["text"]
	r := &recognizer{run: run, g: g, n: len(toks), recon: rc, lo: run.inputStart, hi: run.inputEnd}
	r.loop(start)
	top := r.accepted(start)
	private := run.ps.private
	if private == nil {
		private = &privateOptions{}
	}
	if private.loseWitness == "roots" {
		top = nil
	}
	// A test that watches the check marks W(D)'s links before the check
	// ranks (tests/README.md).
	var watch elisionWatch
	if private.elisionCheck != nil {
		watch = private.elisionCheck(&elisionCheckRun{chosen: d, rec: r, top: top, recon: rc, originalAt: originalAt, recordAt: recordAt})
	}
	// Maximality does not apply to R, and the check ranks with no
	// lean (§7.7).
	var restored *dn
	marks := watch.marks
	var chosenProfile ruleProfile
	flagged := false
	for _, rule := range g.rules {
		flagged = flagged || rule.leftmostLongest
	}
	if flagged {
		chosenProfile = derivationProfile(g, d)
		marks, restored = walkWitness(&elisionCheckRun{chosen: d, rec: r, top: top, recon: rc, originalAt: originalAt, recordAt: recordAt})
		if restored == nil {
			top = nil
		}
	}
	var res *rankResult
	rk := newRanker(r, "", nil)
	rk.check, rk.marks = true, marks
	if len(top) > 0 && private.loseWitness != "count" {
		res = rk.rank(top)
	}
	if res != nil && flagged && !res.witnessCounted {
		res = nil
	}
	if res != nil && flagged {
		switch c := compareProfiles(res.profile, chosenProfile); {
		case c > 0:
			res = nil
		case c < 0:
			res.second, res.first = res.first, restored
			diff := rk.compare(res.first, res.second)
			if diff.kind == cVisDiff {
				res.witness = [2]action{diff.va, diff.vb}
			} else {
				res.witness = [2]action{diff.wa, diff.wb}
			}
		}
	}
	if watch.ranked != nil {
		watch.ranked(res, rk)
	}
	if res == nil {
		// The witness of the chosen derivation is lost: a defect of the
		// engine, not of the text (§7.9).
		if records == nil {
			records = []Restoration{}
		}
		return &ParseError{Kind: ErrorGrammar, Stage: run.name, Code: CodeElisionWitnessLost,
			Message: "the " + run.name + " stage could not reconstruct its chosen derivation for elision-only",
			Chosen:  tree, Completion: records}
	}
	if res.second == nil {
		return nil
	}
	// The readings, mapped to O (§7.10).
	over := run.ps.newRun(run.name, run.grammar, toks)
	mapTree := func(root *Node) *Node {
		stack := []*Node{root}
		for len(stack) > 0 {
			n := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			switch n.Kind {
			case KindToken:
				k := n.Token
				if rc.synthetic[k] {
					// A read of a synthetic token is an elided node of its
					// record's terminal, at the record's position, with the
					// record's source.
					rec := records[rc.record[k]]
					p := rc.project[k]
					*n = Node{Kind: KindElided, Terminal: rec.Terminal, Span: [2]int{p, p}, Source: rec.Source, sound: rec.Sound, tested: rec.Tested}
				} else {
					i := rc.original[k]
					n.Token, n.Span, n.Source = i, [2]int{i, i + 1}, run.toks[i].Source
				}
			default:
				a, b := rc.project[n.Span[0]], rc.project[n.Span[1]]
				n.Span, n.Source = [2]int{a, b}, run.spanSource(a, b)
			}
			stack = append(stack, n.Children...)
		}
		return root
	}
	first := tree
	if !flagged || compareProfiles(res.profile, chosenProfile) >= 0 {
		first = mapTree(over.buildTree(r, res.first))
	}
	readings := []*Node{first, mapTree(over.buildTree(r, res.second))}
	// The witness, mapped to O as the readings are: a read of a synthetic
	// token is an elided action at its record's position, and a close has
	// the projection of its span (§7.10).
	witness := make([]Action, 2)
	for i, a := range res.witness {
		switch {
		case a.read && rc.synthetic[a.tok]:
			witness[i] = Action{Elided: &ElidedAction{At: rc.project[a.tok], Terminal: g.terminals[a.term]}}
		case a.read:
			witness[i] = Action{Read: &ReadAction{Token: rc.project[a.tok], Terminal: g.terminals[a.term]}}
		case a.prod != nil:
			witness[i] = Action{Close: &CloseAction{Rule: a.prod.ruleName, Production: a.prod.num, Span: [2]int{rc.project[a.start], rc.project[a.end]}}}
		default:
			// Neither action is ever missing (engine §6, §7.10).
			panic("gencmu: the witness of the check of elision-only lacks an action")
		}
	}
	return &ParseError{Kind: ErrorAmbiguous, Stage: run.name, Reason: ReasonElisionOnly, Readings: readings, Witness: witness,
		Message: "stage " + run.name + ": the text is ambiguous even with every elided terminator written"}
}
