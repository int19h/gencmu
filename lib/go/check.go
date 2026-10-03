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
	rules := make([]bool, len(g.rules))
	reads := func(s symbol) bool { return s.term || rules[s.id] }
	// From nothing up, until nothing changes, so that a rule that can read
	// only through itself, such as z → z, cannot read.
	for changed := true; changed; {
		changed = false
		for _, p := range g.prods {
			if rules[p.lhs] {
				continue
			}
			ok := p.restoration()
			for _, s := range p.rhs {
				ok = ok || reads(s)
			}
			if ok {
				rules[p.lhs], changed = true, true
			}
		}
	}
	rs := &readingSets{last: make(map[*production]int, len(g.prods)), elidable: make([]bool, len(g.rules))}
	for _, p := range g.prods {
		if p.restoration() {
			rs.elidable[p.lhs] = true
		}
		at := -1
		for i, s := range p.rhs {
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

// elisionCheckRun is what a check of elision-only that met no error of the
// grammar hands its test hook (tests/README.md): D, the chosen derivation,
// the recognition of R and its completed items of text, the check's own
// ranking of a part of its forest, and how R relates to O.
type elisionCheckRun struct {
	chosen *dn
	rec    *recognizer
	top    []*symNode
	// counts says whether the check's ranker, with no lean and no
	// maximality, counts a derivation of the part of the forest made of
	// these items, each with these links.
	counts func(only map[*item][]link) bool
	recon  *reconstruction
	// originalAt is each token of O's index in R, recordAt each record's.
	originalAt, recordAt []int
}

// privateOptions are the switches and hooks of the library's own tests,
// which a parse takes through an unexported field of ParseOptions, so that
// no caller can set them and parses that run at once keep them apart.
type privateOptions struct {
	// elisionCheck, when set, receives each check of elision-only that ran
	// and met no error of the grammar, for the witness test of
	// tests/README.md.
	elisionCheck func(*elisionCheckRun)
	// loseWitness loses the witness of a check after recognition (§7.9):
	// "roots" drops the completed items of text over R, and "count" drops
	// their derivations.
	loseWitness string
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
		records = append(records, Restoration{Terminal: n.Terminal, At: n.Span[0], Source: n.Source, Sound: n.sound, tested: n.tested})
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
	r := &recognizer{run: run, g: g, n: len(toks), recon: rc}
	r.loop(start)
	top := r.accepted(start)
	private := run.ps.private
	if private == nil {
		private = &privateOptions{}
	}
	if private.loseWitness == "roots" {
		top = nil
	}
	// Neither form of maximality applies to R, and the check ranks with no
	// lean (§7.7).
	var res *rankResult
	if len(top) > 0 && private.loseWitness != "count" {
		res = newRanker(r, "", nil).rank(top)
	}
	if private.elisionCheck != nil {
		counts := func(only map[*item][]link) bool {
			if len(top) == 0 || private.loseWitness == "count" {
				return false
			}
			rk := newRanker(r, "", nil)
			rk.only = only
			return rk.rank(top) != nil
		}
		private.elisionCheck(&elisionCheckRun{chosen: d, rec: r, top: top, counts: counts, recon: rc, originalAt: originalAt, recordAt: recordAt})
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
					*n = Node{Kind: KindElided, Terminal: rec.Terminal, Span: [2]int{p, p}, Source: rec.Source, sound: rec.Sound, tested: rec.tested}
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
	readings := []*Node{mapTree(over.buildTree(r, res.first)), mapTree(over.buildTree(r, res.second))}
	return &ParseError{Kind: ErrorAmbiguous, Stage: run.name, Reason: ReasonElisionOnly, Readings: readings,
		Message: "stage " + run.name + ": the text is ambiguous even with every elided terminator written"}
}
