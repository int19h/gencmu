package gencmu

import "strings"

// The reader's walk from the notation's tree to the DOM, as frames on an
// explicit stack: each construct is a frame that asks for the constructs
// it holds, one at a time, and receives each one's value in turn. A
// document can nest as deeply as its length allows (engine §9), so the walk
// does not recurse.

// readStep is what a frame does next: ask for a construct, or give its
// value.
type readStep struct {
	call  readFrame
	value any
}

type readFrame interface {
	resume(b *domBuilder, in any) readStep
}

func ask(f readFrame) readStep { return readStep{call: f} }
func give(v any) readStep      { return readStep{value: v} }

// run runs a frame to its value.
func (b *domBuilder) run(f readFrame) any {
	stack := []readFrame{f}
	var in any
	for {
		if w := work.Load(); w != nil {
			w.readerSteps.add("reader steps")
		}
		s := stack[len(stack)-1].resume(b, in)
		in = nil
		if s.call != nil {
			stack = append(stack, s.call)
			continue
		}
		stack = stack[:len(stack)-1]
		if len(stack) == 0 {
			return s.value
		}
		in = s.value
	}
}

// exprIn reads an expression; whole says it is the alternative's whole
// expression, where a chain may stand (engine §9).
func (b *domBuilder) exprIn(n *Node, whole bool) *domExpr {
	return b.run(&exprFrame{n: n, whole: whole}).(*domExpr)
}

func (b *domBuilder) expr(n *Node) *domExpr { return b.exprIn(n, false) }

// termIn reads a term; argument says it is a function's argument, where a
// span or a rule may stand (§9, §10).
func (b *domBuilder) termIn(n *Node, argument bool) *domTerm {
	return b.run(&termFrame{n: n, argument: argument}).(*domTerm)
}

func (b *domBuilder) term(n *Node) *domTerm { return b.termIn(n, false) }

// implication reads A ⟹ B, which groups to the right, or the one any-of.
func (b *domBuilder) implication(n *Node) *domCond {
	return b.run(&implicationFrame{n: n}).(*domCond)
}

// exprFrame reads an expression.
type exprFrame struct {
	n       *Node
	whole   bool
	started bool
	// What its value is made of: a list's kind, parts and items; or the
	// construct it passes on; or the capture, the test or the optional
	// that wraps what it asked for.
	spliced             bool
	capturedNode        *Node
	kind                string
	parts               []*Node
	items               []*domExpr
	inWhole             bool
	pass                bool
	capture             string
	marked              bool
	previousHead        *Node
	previousDefault     *domTerm
	previousDefaultNode *Node
	defaultNode         *Node
	elide               *domExpr
	repeat              *domExpr
	choices             []*Node
	call                bool
}

func (f *exprFrame) resume(b *domBuilder, in any) readStep {
	n := f.n
	if !f.started {
		f.started = true
		return f.start(b)
	}
	switch {
	case f.spliced:
		return give(&domExpr{Kind: exSplice, Inner: in.(*domExpr)})
	case f.call:
		call := in.(*domSourceCall)
		return give(&domExpr{Kind: exCall, Call: call, At: call.At})
	case f.pass:
		return give(in)
	case f.kind != "":
		f.items = append(f.items, in.(*domExpr))
		return f.next(b)
	case f.capture != "":
		e := &domExpr{Kind: exCapture, Name: f.capture, Inner: in.(*domExpr)}
		if b.captureNodes == nil {
			b.captureNodes = map[*domExpr]*Node{}
		}
		b.captureNodes[e] = n
		return give(e)
	case f.elide != nil:
		if f.marked {
			delete(b.allowedMarked, f.capturedNode)
			b.marked--
			f.elide.Default = b.headDefault
			f.defaultNode = b.defaultNode
			if b.defaultNode != nil {
				f.elide.DefaultAt = b.at(b.defaultNode)
			}
			b.defaultHead, b.headDefault, b.defaultNode = f.previousHead, f.previousDefault, f.previousDefaultNode
		}
		f.elide.Inner = in.(*domExpr)
		if value := f.elide.Default; value != nil && value.Kind == tmString {
			head := f.elide.Inner
			if head.Kind == exSeq {
				head = head.Items[0]
			}
			if head.Kind == exCapture {
				head = head.Inner
			}
			for head.Kind == exTest {
				if head.Op != "tags" && head.Value.Kind == tmString && ((value.Str == head.Value.Str) != (head.Op == "=")) {
					b.fail(f.defaultNode, "a default fails its head test")
				}
				head = head.Inner
			}
		}
		return give(f.elide)
	case f.repeat != nil:
		if f.repeat.Inner == nil {
			f.repeat.Inner = in.(*domExpr)
			if len(f.choices) >= 2 {
				return ask(&exprFrame{n: f.choices[1]})
			}
		} else {
			f.repeat.Sep = in.(*domExpr)
		}
		b.braces = b.braces[:len(b.braces)-1]
		return give(f.repeat)
	}
	panic("an expression frame resumed with nothing to do")
}

// next asks for the next part of a list, or gives the list.
func (f *exprFrame) next(b *domBuilder) readStep {
	if len(f.items) < len(f.parts) {
		p := f.parts[len(f.items)]
		if f.kind == exSeq {
			return ask(&exprFrame{n: b.knownOf(p, primaryRules), whole: f.inWhole})
		}
		return ask(&exprFrame{n: p, whole: f.inWhole})
	}
	if f.kind == exRanked && len(b.braces) > 0 {
		b.braces[len(b.braces)-1].ranked--
	}
	if len(f.items) == 1 {
		return give(f.items[0])
	}
	expr := &domExpr{Kind: f.kind, Items: f.items, At: b.at(f.n)}
	if f.kind == exRanked {
		for _, part := range b.parts(f.n) {
			if part.Kind == KindToken && b.tokenValue(part) == "≻" {
				expr.RankedAt = b.at(part)
				break
			}
		}
	}
	return give(expr)
}

func (f *exprFrame) start(b *domBuilder) readStep {
	n := f.n
	switch n.Rule {
	case "splice":
		target := b.knownOf(n, []string{"reference", "call"})
		marker := b.token(n)
		if b.toks[marker.Token].Source[1] != b.toks[target.Span[0]].Source[0] {
			b.fail(n, "a splice marker stands directly before its target")
		}
		f.spliced = true
		return ask(&exprFrame{n: target})
	case "parameter":
		parameter := b.parameter(n)
		return give(&domExpr{Kind: exParam, Name: parameter.Str, At: parameter.At})
	case "call":
		f.call = true
		return ask(&sourceCallFrame{n: n})
	case "choice", "ranked-choice", "conjunction", "sequence":
		if n.Rule == "choice" {
			if ranked := b.one(n, "ranked-choice"); ranked != nil {
				f.pass = true
				return ask(&exprFrame{n: ranked})
			}
		}
		child := "conjunction"
		switch n.Rule {
		case "choice":
			f.kind = exChoice
		case "ranked-choice":
			f.kind = exRanked
		case "conjunction":
			f.kind, child = exAnd, "sequence"
		case "sequence":
			f.kind, child = exSeq, "primary"
		}
		minimum := 1
		if f.kind == exRanked {
			minimum = 2
		}
		f.parts = b.some(n, child, minimum)
		// Only the one conjunction of an alternative, and its one sequence
		// of one primary, are its whole expression.
		f.inWhole = f.whole && f.kind != exChoice && f.kind != exRanked && len(f.parts) == 1
		// The bound of an & is its own form, so it comes before its items
		// (engine §9).
		if f.kind == exAnd && len(f.parts) > maxAnd {
			b.fail(n, "an & joins at most %d items, since it expands to 2ⁿ−1 sequences", maxAnd)
		}
		// An item capture cannot stand inside a ranked group (engine §3.5).
		if f.kind == exRanked && len(b.braces) > 0 {
			b.braces[len(b.braces)-1].ranked++
		}
		return f.next(b)
	case "repetition":
		return f.startRepetition(b)
	case "reference":
		return give(&domExpr{Kind: exRef, Name: b.tokenValue(b.token(n))})
	case "tag":
		return give(&domExpr{Kind: exRef, Name: b.tagOf(b.token(n))})
	case "string-terminal":
		p := b.knownOf(n, []string{"string", "constant-reference"})
		return give(&domExpr{Kind: exLiteral, Value: b.term(p)})
	case "wildcard":
		b.token(n)
		return give(&domExpr{Kind: exWildcard})
	case "range":
		return give(&domExpr{Kind: exRange, Ends: b.stringRange(n)})
	case "tested":
		return give(b.tested(n))
	case "capture":
		// Its place, then $, its name and its symbol, each at the capture,
		// before what it wraps (engine §9).
		// Inside flat braces it is an item capture, and the innermost
		// braces decide; an item capture stands in no ranked group
		// (engine §3.5).
		if len(b.braces) > 0 {
			inner := b.braces[len(b.braces)-1]
			if inner.chain {
				b.fail(n, "a capture cannot stand inside a chain, whose levels are constituents of its rule: a condition on $ serves each level")
			}
			if inner.ranked > 0 {
				b.fail(n, "an item capture cannot stand inside a ranked group: name the ranked choice as a rule and capture that rule")
			}
		}
		if b.marked > 0 && !b.allowedMarked[n] {
			b.fail(n, "a capture cannot stand inside an elidable optional, which elision restores as one unit")
		}
		captureToken := b.token(n)
		inner := b.only(n, "primary")
		if b.tokenValue(captureToken) == "$" {
			b.fail(n, "$ is the whole constituent and wraps nothing")
		}
		name := strings.TrimPrefix(b.tokenValue(captureToken), "$")
		if !captureName.MatchString(name) {
			b.fail(n, "a capture's name is all lower case")
		}
		wrapped := b.knownOf(inner, primaryRules)
		base := wrapped
		if wrapped.Rule == "tested" {
			base = b.testBase(wrapped)
		}
		if !capturedRules[base.Rule] || base.Rule == "tested" {
			b.fail(n, "a capture wraps one symbol")
		}
		f.capture = name
		return ask(&exprFrame{n: wrapped})
	case "group":
		f.pass = true
		return ask(&exprFrame{n: b.only(n, "choice")})
	case "optional":
		return f.startOptional(b)
	case "empty":
		return give(&domExpr{Kind: exEmpty})
	case "constant-reference":
		return give(&domExpr{Kind: exLiteral, Value: b.term(n)})
	}
	b.fail(n, "unexpected %s in an expression", n.Rule)
	return readStep{}
}

// startOptional checks an optional, and with a marker + among its
// parts an elidable one (engine §3.8, §9). Its form is checked on the
// tree, where a group is still a node: one sequence, with no leading | or
// &, whose first primary is the terminal itself, with or without tests. Its
// parts are looked up in the order of §9: its choice, then its markers.
func (f *exprFrame) startOptional(b *domBuilder) readStep {
	n := f.n
	if capture := b.one(n, "capture"); capture != nil {
		return f.startCapturedOptional(b, capture)
	}
	choice := b.only(n, "choice")
	var markers []*Node
	for _, p := range b.parts(n) {
		if p.Kind == KindToken && b.tokenValue(p) == "+" {
			markers = append(markers, p)
		}
	}
	if len(markers) >= 2 {
		b.fail(markers[1], "an optional has one marker + at most")
	}
	if len(markers) == 0 {
		f.elide = &domExpr{Kind: exOptional}
		return ask(&exprFrame{n: choice})
	}
	const form = "an elidable optional begins with a user tag or parameter directly after +, without | or &"
	hasToken := func(node *Node, text string) bool {
		for _, p := range b.parts(node) {
			if p.Kind == KindToken && b.tokenValue(p) == text {
				return true
			}
		}
		return false
	}
	conjunctions := b.ofRule(choice, "conjunction")
	leading := hasToken(choice, "|") || (len(conjunctions) == 1 && hasToken(conjunctions[0], "&"))
	var head *Node
	if len(conjunctions) == 1 && !leading {
		if sequences := b.ofRule(conjunctions[0], "sequence"); len(sequences) == 1 {
			if primaries := b.ofRule(sequences[0], "primary"); len(primaries) > 0 {
				head = b.knownOf(primaries[0], primaryRules)
			}
		}
	}
	isTerminal := func(symbol *Node) bool {
		return symbol != nil && (symbol.Rule == "parameter" || (symbol.Rule == "tag" || symbol.Rule == "reference") && isCapital(b.tokenValue(b.token(symbol))))
	}
	switch {
	case head == nil:
		b.fail(n, form)
	case head.Rule == "tested":
		if !isTerminal(b.findTestBase(head)) {
			b.fail(n, form)
		}
	case !isTerminal(head):
		b.fail(n, form)
	}
	f.previousHead, f.previousDefault, f.previousDefaultNode = b.defaultHead, b.headDefault, b.defaultNode
	b.defaultHead, b.headDefault, b.defaultNode = head, nil, nil
	b.marked++
	f.marked = true
	f.elide = &domExpr{Kind: exOptional, Elidable: true}
	return ask(&exprFrame{n: choice})
}

// startRepetition checks braces: the item, its separator if a `/`
// has one, and a chain's direction from its marker, a ... among the parts
// (engine §9).
func (f *exprFrame) startRepetition(b *domBuilder) readStep {
	n := f.n
	found := b.parts(n)
	choices := b.some(n, "choice", 1)
	index := func(node *Node) int {
		for i, p := range found {
			if p == node {
				return i
			}
		}
		return len(found)
	}
	var markers []int
	for i, p := range found {
		if p.Kind == KindToken && b.tokenValue(p) == "..." {
			markers = append(markers, i)
		}
	}
	// Repeated markers fail before separator placement is inspected.
	// A sole marker after the separator fails at that marker (engine §9).
	if len(markers) >= 2 {
		b.fail(found[markers[1]], "braces have one chain marker ... at most")
	}
	second := len(found)
	if len(choices) >= 2 {
		second = index(choices[1])
	}
	if len(markers) == 1 && markers[0] > second {
		b.fail(found[markers[0]], "a separator has no chain marker: ... stands after { or after the item")
	}
	e := &domExpr{Kind: exRepeat}
	if len(markers) == 1 {
		e.Chain = "right"
		if markers[0] < index(choices[0]) {
			e.Chain = "left"
		}
	}
	// A chain is the whole expression of its alternative, as the lowering
	// of its levels needs (engine §3.3, §9).
	if e.Chain != "" && !f.whole {
		b.fail(n, "a chain is the whole expression of its alternative: name it as a rule to use it here")
	}
	b.braces = append(b.braces, bracesEntry{chain: e.Chain != ""})
	f.repeat = e
	f.choices = choices
	return ask(&exprFrame{n: choices[0]})
}

// termFrame reads a term.
type termFrame struct {
	n        *Node
	argument bool
	started  bool
	pass     bool
	call     bool
	// A guarded term: its guards, the conditions read, and its last part.
	guards []*Node
	conds  []*domCond
	// A union or an intersection: its parts, its operators, and the items
	// read with their types.
	parts []*Node
	ops   []string
	items []*domTerm
	types []termType
}

func (f *termFrame) resume(b *domBuilder, in any) readStep {
	n := f.n
	if !f.started {
		f.started = true
		return f.start(b)
	}
	if f.pass {
		return give(in)
	}
	if f.call {
		call := in.(*domSourceCall)
		return give(&domTerm{Kind: tmSourceCall, Call: call, At: call.At})
	}
	if f.guards != nil {
		if c, ok := in.(*domCond); ok {
			f.conds = append(f.conds, c)
			if len(f.conds) < len(f.guards) {
				return ask(&anyOfFrame{n: f.guards[len(f.conds)]})
			}
			last := b.one(n, "union")
			if last == nil {
				last = b.only(n, "term")
			}
			return ask(&termFrame{n: last})
		}
		t := in.(*domTerm)
		// The reader has checked each comparison of a condition, so a
		// condition's terms agree; the term guarded last must be a tag
		// set, an error at its guard.
		ty, problem := b.typeOf(t)
		if problem == "" {
			_, problem = joinedType([]termType{ty}, "⟹")
			if ty == tyPattern {
				problem = "a guarded term requires a set"
			}
		}
		if problem != "" {
			b.fail(f.guards[len(f.guards)-1], "%s", problem)
		}
		for i := len(f.conds) - 1; i >= 0; i-- {
			t = &domTerm{Kind: tmIf, Cond: f.conds[i], Items: []*domTerm{t}}
		}
		return give(t)
	}
	// A part of a union or an intersection, which is a set of the kind of
	// the others (§10); the error stands at the node that joins them.
	t := in.(*domTerm)
	ty, problem := b.typeOf(t)
	if problem != "" && !b.featureContext {
		b.fail(n, "%s", problem)
	}
	if n.Rule == "concatenation" && ty != tyString && ty != tyAny && !b.featureContext {
		b.fail(n, "++ requires string operands")
	}
	f.items = append(f.items, t)
	f.types = append(f.types, ty)
	if len(f.items) < len(f.parts) {
		return ask(&termFrame{n: f.parts[len(f.items)]})
	}
	if n.Rule == "concatenation" {
		return give(&domTerm{Kind: tmConcat, Items: f.items})
	}
	// Only a union needs explicit operators (engine §9.3).
	if n.Rule == "union" && len(f.ops) < len(f.items)-1 {
		b.lacks(n, "operator")
	}
	op := f.ops[0]
	for _, o := range f.ops {
		if o == "∖" {
			op = o
		}
	}
	if _, problem := joinedType(f.types, op); problem != "" && !b.featureContext {
		b.fail(n, "%s", problem)
	}
	if n.Rule == "intersection" {
		return give(&domTerm{Kind: tmIntersection, Items: f.items})
	}
	// Parts joined by ∪ and ∖ group from the left: a run joined by ∪ is
	// one union, and each ∖ takes what stands before it (§9).
	result := f.items[0]
	open := false
	for i, op := range f.ops {
		next := f.items[i+1]
		switch {
		case op == "∖":
			result = &domTerm{Kind: tmDifference, Items: []*domTerm{result, next}}
			open = false
		case open:
			result.Items = append(result.Items, next)
		default:
			result = &domTerm{Kind: tmUnion, Items: []*domTerm{result, next}}
			open = true
		}
	}
	return give(result)
}

func (f *termFrame) start(b *domBuilder) readStep {
	n := f.n
	switch n.Rule {
	case "parameter":
		return give(b.parameter(n))
	case "call":
		f.call = true
		return ask(&sourceCallFrame{n: n})
	case "term":
		f.pass = true
		return ask(&termFrame{n: b.knownOf(n, termRules), argument: f.argument})
	case "test-operand", "term-atom", "method-receiver":
		// A test's operand is one term, as a term-atom reads it (§9).
		f.pass = true
		return ask(&termFrame{n: b.knownOf(n, atomRules), argument: f.argument})
	case "tag-run", "string-run":
		return give(b.tagRun(n))
	case "guarded-term":
		// A ⟹ t: its any-ofs, each guarding the rest, and then its union,
		// or the term of a notation that writes one after ⟹ (§9, §10).
		if b.closedFor != "" {
			b.fail(n, "%s is a closed term, and holds no guarded term", b.closedFor)
		}
		f.guards = b.some(n, "any-of", 1)
		return ask(&anyOfFrame{n: f.guards[0]})
	case "union":
		ps := b.some(n, "intersection", 1)
		if len(ps) == 1 {
			f.pass = true
			return ask(&termFrame{n: ps[0], argument: f.argument})
		}
		var ops []string
		for _, p := range b.parts(n) {
			if p.Kind == KindToken {
				if t := b.tokenValue(p); t == "∪" || t == "∖" {
					ops = append(ops, t)
				}
			}
		}
		// A leading ∪ is a separator, not an operator.
		for len(ops) >= len(ps) {
			ops = ops[1:]
		}
		f.parts, f.ops = ps, ops
		return ask(&termFrame{n: ps[0]})
	case "concatenation":
		ps := b.some(n, "term-atom", 1)
		if len(ps) == 1 {
			f.pass = true
			return ask(&termFrame{n: ps[0], argument: f.argument})
		}
		f.parts, f.ops = ps, []string{"++"}
		return ask(&termFrame{n: ps[0]})
	case "intersection":
		ps := b.some(n, "concatenation", 1)
		if len(ps) == 1 {
			f.pass = true
			return ask(&termFrame{n: ps[0], argument: f.argument})
		}
		f.parts, f.ops = ps, []string{"∩"}
		return ask(&termFrame{n: ps[0]})
	case "string":
		return give(b.stringTerm(b.token(n)))
	case "tag":
		tag := b.tagOf(b.token(n))
		if b.closedFor != "" && engineTag(tag) {
			b.fail(n, "an engine tag literal is not legal in a closed value")
		}
		return give(&domTerm{Kind: tmTag, Str: tag, At: b.at(n)})
	case "range":
		b.fail(n, "a range is a terminal, not a term")
	case "name":
		// A bare name is a tag literal if it begins with a capital, and
		// otherwise a rule, which only a function's argument names.
		name := b.tokenValue(b.token(n))
		switch {
		case isCapital(name):
			return give(&domTerm{Kind: tmTag, Str: name})
		case f.argument:
			return give(&domTerm{Kind: tmRule, Str: name})
		}
		b.fail(n, "%s names a rule, which is not a value", name)
	case "empty-set":
		return give(&domTerm{Kind: tmEmptySet})
	case "constant-reference":
		return give(b.constantRef(n))
	case "capture-reference":
		name := strings.TrimPrefix(b.tokenValue(b.token(n)), "$")
		if b.closedFor != "" {
			b.fail(n, "%s is a closed term, and holds no capture", b.closedFor)
		}
		return give(&domTerm{Kind: tmCapture, Str: name})
	case "method":
		f.pass = true
		return ask(&methodFrame{n: n})
	case "pattern-literal":
		closed := b.closedFor
		b.closedFor = ""
		defer func() { b.closedFor = closed }()
		pattern := b.run(&patternFrame{n: b.only(n, "pattern-primary")}).(*domPattern)
		if problem := sourcePatternProblem(pattern); problem != "" {
			b.fail(n, "%s", problem)
		}
		return give(&domTerm{Kind: tmPattern, Pattern: pattern, At: b.at(n)})
	}
	b.fail(n, "unexpected %s in a term", n.Rule)
	return readStep{}
}

// implicationFrame reads its any-ofs in order, and after them the
// implication of a notation that writes one after ⟹, grouped to the right
// (§9).
type implicationFrame struct {
	n       *Node
	started bool
	anyOfs  []*Node
	items   []*domCond
}

func (f *implicationFrame) resume(b *domBuilder, in any) readStep {
	if !f.started {
		f.started = true
		f.anyOfs = b.some(f.n, "any-of", 1)
		return ask(&anyOfFrame{n: f.anyOfs[0]})
	}
	f.items = append(f.items, in.(*domCond))
	if len(f.items) < len(f.anyOfs) {
		return ask(&anyOfFrame{n: f.anyOfs[len(f.items)]})
	}
	if len(f.items) == len(f.anyOfs) {
		if consequent := b.one(f.n, "implication"); consequent != nil {
			return ask(&implicationFrame{n: consequent})
		}
	}
	result := f.items[len(f.items)-1]
	for i := len(f.items) - 2; i >= 0; i-- {
		result = &domCond{Kind: cdIf, Items: []*domCond{f.items[i], result}}
	}
	return give(result)
}

// anyOfFrame reads conditions joined by ∨, each several joined by ∧.
// Parentheses make no node, so a group of the connective around it is
// folded into it: (a ∧ b) ∧ c is an all of three, (a ∨ b) ∨ c an any of
// three (§9). The reader folds such groups once the rule is read
// (flattenGroups), in one walk, since folding them here would copy a list
// at each depth.
type anyOfFrame struct {
	n       *Node
	started bool
	allOfs  []*Node
	conds   []*Node
	read    []*domCond
	items   []*domCond
}

func (f *anyOfFrame) resume(b *domBuilder, in any) readStep {
	if !f.started {
		f.started = true
		f.allOfs = b.some(f.n, "all-of", 1)
		f.conds = b.some(f.allOfs[0], "condition", 1)
		return ask(&conditionFrame{n: f.conds[0]})
	}
	f.read = append(f.read, in.(*domCond))
	if len(f.read) < len(f.conds) {
		return ask(&conditionFrame{n: f.conds[len(f.read)]})
	}
	if len(f.read) > 1 {
		f.items = append(f.items, &domCond{Kind: cdAll, Items: f.read})
	} else {
		f.items = append(f.items, f.read[0])
	}
	f.read = nil
	if len(f.items) < len(f.allOfs) {
		f.conds = b.some(f.allOfs[len(f.items)], "condition", 1)
		return ask(&conditionFrame{n: f.conds[0]})
	}
	if len(f.items) == 1 {
		return give(f.items[0])
	}
	return give(&domCond{Kind: cdAny, Items: f.items})
}

// truthyOperand reads one operand of the set operation at op. A Boolean
// method as an operand is a fault of the operation (engine §9.3).
func (b *domBuilder) truthyOperand(op, n *Node) (t *domTerm) {
	defer func() {
		if e := recover(); e != nil {
			if err, ok := e.(*Error); ok && strings.Contains(err.Message, "a query method is a condition, not a term") {
				b.fail(op, "a query method is a condition, not a term")
			}
			panic(e)
		}
	}()
	return b.run(&termFrame{n: n}).(*domTerm)
}

// truthyCheck fails at op when the operands of a set operation in a
// term-condition do not join (engine §9.3).
func (b *domBuilder) truthyCheck(op *Node, items []*domTerm, operator string) {
	if b.featureContext {
		return
	}
	types := make([]termType, len(items))
	for i, item := range items {
		ty, problem := b.typeOf(item)
		if problem != "" {
			b.fail(op, "%s", problem)
		}
		types[i] = ty
	}
	if _, problem := joinedType(types, operator); problem != "" {
		b.fail(op, "%s", problem)
	}
}

// truthyTerm reads the set term of a term-condition (§9).
func (b *domBuilder) truthyTerm(n *Node) *domTerm {
	op := b.knownOf(n, []string{"union-operation", "intersection-operation", "set-atom"})
	switch op.Rule {
	case "set-atom":
		for _, child := range b.parts(op) {
			if child.Kind == KindRule {
				return b.run(&termFrame{n: child}).(*domTerm)
			}
		}
		b.fail(op, "a set atom")
	case "intersection-operation":
		var items []*domTerm
		for _, item := range b.some(op, "concatenation", 1) {
			items = append(items, b.truthyOperand(op, item))
		}
		b.truthyCheck(op, items, "∩")
		if len(items) == 1 {
			return items[0]
		}
		return &domTerm{Kind: tmIntersection, Items: items}
	}
	found := b.some(op, "intersection", 1)
	var items []*domTerm
	for _, item := range found {
		items = append(items, b.truthyOperand(op, item))
	}
	var operators []string
	for _, part := range b.parts(op) {
		if part.Kind == KindToken {
			if v := b.tokenValue(part); v == "∪" || v == "∖" {
				operators = append(operators, v)
			}
		}
	}
	// A leading ∪ is a separator, not an operator.
	if len(operators) > len(items)-1 {
		operators = operators[len(operators)-(len(items)-1):]
	}
	joinOperator := "∪"
	for _, operator := range operators {
		if operator == "∖" {
			joinOperator = "∖"
		}
	}
	b.truthyCheck(op, items, joinOperator)
	result := items[0]
	open := false
	for index, operator := range operators {
		next := items[index+1]
		if operator == "∖" {
			result = &domTerm{Kind: tmDifference, Items: []*domTerm{result, next}}
			open = false
		} else if open && result.Kind == tmUnion {
			result.Items = append(result.Items, next)
		} else {
			result = &domTerm{Kind: tmUnion, Items: []*domTerm{result, next}}
			open = true
		}
	}
	return result
}

// conditionFrame reads a condition.
type conditionFrame struct {
	n       *Node
	started bool
	pass    bool
	compare *domCond
	right   *Node
}

func (f *conditionFrame) resume(b *domBuilder, in any) readStep {
	n := f.n
	if !f.started {
		f.started = true
		switch n.Rule {
		case "condition":
			f.pass = true
			return ask(&conditionFrame{n: b.knownOf(n, conditionRules)})
		case "tree-comparison":
			f.compare = &domCond{Kind: cdCompare, At: b.at(n), Left: &domTerm{Kind: tmCapture, Str: strings.TrimPrefix(b.tokenValue(b.token(b.only(n, "capture-reference"))), "$")}}
			f.compare.Op = b.operator(b.token(b.only(n, "tree-comparator")))
			right := b.only(n, "union")
			b.patternOperand(right)
			return ask(&termFrame{n: right})
		case "comparison":
			op := b.operator(b.token(b.only(n, "comparator")))
			ps := b.some(n, "union", 2)
			f.compare = &domCond{Kind: cdCompare, Op: op}
			f.right = ps[1]
			return ask(&termFrame{n: ps[0]})
		case "negation", "method", "implication":
		case "term-condition":
			return give(&domCond{Kind: cdTruthy, Left: b.truthyTerm(n)})
		case "presence":
			return give(&domCond{Kind: cdCaptured, Capture: strings.TrimPrefix(b.tokenValue(b.token(n)), "$")})
		default:
			b.fail(n, "unexpected %s in a condition", n.Rule)
		}
		switch n.Rule {
		case "negation":
			return ask(&conditionFrame{n: b.only(n, "condition")})
		case "method":
			return ask(&methodFrame{n: n, inCondition: true})
		}
		// Between parentheses, which make no node.
		f.pass = true
		return ask(&implicationFrame{n: n})
	}
	if f.pass {
		return give(in)
	}
	switch n.Rule {
	case "tree-comparison":
		f.compare.Right = in.(*domTerm)
		if fault := condTypeMemo(f.compare, nil, b.types); fault != nil && !b.featureContext {
			where := n
			if fault.node == f.compare.Right {
				where = b.only(n, "union")
			}
			b.fail(where, "%s", fault.problem)
		}
		return give(f.compare)
	case "comparison":
		if f.right != nil {
			f.compare.Left = in.(*domTerm)
			right := f.right
			f.right = nil
			return ask(&termFrame{n: right})
		}
		f.compare.Right = in.(*domTerm)
		// The two sides fit the comparator (§10).
		if fault := condTypeMemo(f.compare, nil, b.types); fault != nil && !b.featureContext {
			b.fail(n, "%s", fault.problem)
		}
		return give(f.compare)
	case "negation":
		return give(&domCond{Kind: cdNot, Inner: in.(*domCond)})
	}
	t := in.(*domTerm)
	if t.Str == "tags" || t.Str == "classes" || t.Str == "split" || t.Str == "ngrams" || t.Str == "classify" {
		return give(&domCond{Kind: cdTruthy, Left: t})
	}
	if t.Str == "parse" || t.Str == "error-free" || t.Str == "ending-after" {
		return give(&domCond{Kind: cdForest, Left: t})
	}
	if t.Str == "ends-input" {
		return give(&domCond{Kind: cdEnd, Span: t.Items[0]})
	}
	if boundaryMethod(t.Str) {
		b.hasBoundary = true
		return give(&domCond{Kind: cdBoundary, Op: t.Str, Span: t.Items[0], Targets: t.Items[1:], At: t.At})
	}
	if t.Str == "starts-input" {
		return give(&domCond{Kind: cdInitial, Span: t.Items[0]})
	}
	kind := cdMatches
	if t.Str == "begins" {
		kind = cdBegins
	} else if t.Str == "ends" {
		kind = cdEnds
	}
	return give(&domCond{Kind: kind, Span: t.Items[0], Targets: t.Items[1:]})
}

func (b *domBuilder) patternOperand(right *Node) {
	name := b.firstOfRule(right, "name")
	if name == nil {
		name = b.firstOfRule(right, "tag")
	}
	if name != nil && right.Span[1]-right.Span[0] == 1 {
		text := b.tokenValue(b.token(name))
		b.fail(name, "tree comparison requires a pattern; write #%s, not %s", text, text)
	}
}

func (f *exprFrame) startCapturedOptional(b *domBuilder, capture *Node) readStep {
	var markers []*Node
	for _, node := range []*Node{f.n, capture} {
		for _, child := range b.parts(node) {
			if child.Kind == KindToken && b.tokenValue(child) == "+" {
				markers = append(markers, child)
			}
		}
	}
	if len(markers) > 1 {
		b.fail(markers[1], "an optional has one marker + at most")
	}
	if len(markers) == 0 || b.one(f.n, "choice") != nil {
		b.fail(f.n, "a captured elidable optional holds only its terminator")
	}
	head := b.knownOf(b.only(capture, "primary"), primaryRules)
	base := head
	if head.Rule == "tested" {
		base = b.testBase(head)
	}
	if base == nil || base.Rule != "parameter" && (base.Rule != "tag" || !isCapital(b.tokenValue(b.token(base)))) {
		b.fail(f.n, "a captured elidable optional holds only its terminator")
	}
	f.previousHead, f.previousDefault, f.previousDefaultNode = b.defaultHead, b.headDefault, b.defaultNode
	b.defaultHead, b.headDefault, b.defaultNode = head, nil, nil
	if b.allowedMarked == nil {
		b.allowedMarked = map[*Node]bool{}
	}
	b.allowedMarked[capture] = true
	b.marked++
	f.marked = true
	f.capturedNode = capture
	f.elide = &domExpr{Kind: exOptional, Elidable: true}
	return ask(&exprFrame{n: capture})
}
