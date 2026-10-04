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
		readerWork.steps.Add(1)
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

// value reads a term where a value is needed: head, tail, last, from and
// after give spans, which are not values (§9).
func (b *domBuilder) value(n *Node) *domTerm {
	return b.run(&valueFrame{n: n}).(*domTerm)
}

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
	kind    string
	parts   []*Node
	items   []*domExpr
	inWhole bool
	pass    bool
	capture string
	test    *domExpr
	operand *Node
	marked  bool
	elide   *domExpr
	repeat  *domExpr
	choices []*Node
}

func (f *exprFrame) resume(b *domBuilder, in any) readStep {
	n := f.n
	if !f.started {
		f.started = true
		return f.start(b)
	}
	switch {
	case f.pass:
		return give(in)
	case f.kind != "":
		f.items = append(f.items, in.(*domExpr))
		return f.next(b)
	case f.capture != "":
		e := &domExpr{Kind: exCapture, Name: f.capture, Inner: in.(*domExpr)}
		b.captureNodes[e] = n
		return give(e)
	case f.test != nil:
		b.closedFor = ""
		value := in.(*domTerm)
		ty, problem := b.typeOf(value)
		if problem == "" {
			problem = testTypeProblem(f.test.Op, ty)
		}
		if problem != "" {
			b.fail(f.operand, "%s", problem)
		}
		if isSoundTest(f.test.Op) && value.Kind == tmString {
			if msg := soundProblem(value.Str, b.uni); msg != "" {
				at := firstOfRule(f.operand, "string")
				if at == nil {
					at = f.operand
				}
				b.fail(at, "%s", msg)
			}
		}
		f.test.Value = value
		return give(f.test)
	case f.elide != nil:
		if f.marked {
			b.marked--
		}
		f.elide.Inner = in.(*domExpr)
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
		b.braces--
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
	if len(f.items) == 1 {
		return give(f.items[0])
	}
	return give(&domExpr{Kind: f.kind, Items: f.items})
}

func (f *exprFrame) start(b *domBuilder) readStep {
	n := f.n
	switch n.Rule {
	case "choice", "conjunction", "sequence":
		f.kind = map[string]string{"choice": exChoice, "conjunction": exAnd, "sequence": exSeq}[n.Rule]
		f.parts = b.some(n, map[string]string{"choice": "conjunction", "conjunction": "sequence", "sequence": "primary"}[n.Rule], 1)
		// Only the one conjunction of an alternative, and its one sequence
		// of one primary, are its whole expression.
		f.inWhole = f.whole && f.kind != exChoice && len(f.parts) == 1
		// The bound of an & is its own form, so it comes before its items
		// (engine §9).
		if f.kind == exAnd && len(f.parts) > maxAnd {
			b.fail(n, "an & joins at most %d items, since it expands to 2ⁿ−1 sequences", maxAnd)
		}
		return f.next(b)
	case "repetition":
		return f.startRepetition(b)
	case "reference":
		return give(&domExpr{Kind: exRef, Name: b.text(b.token(n))})
	case "tag", "character", "phoneme":
		return give(&domExpr{Kind: exTerminal, Name: b.tagOf(b.token(n))})
	case "range":
		return give(&domExpr{Kind: exRange, Range: b.readRange(n)})
	case "property":
		return give(&domExpr{Kind: exProperty, Name: b.readProperty(b.token(n))})
	case "tested":
		// A reference other than # or a terminal, and one test on its own
		// span (engine §2, §9). The syntax grammar reads a test after any
		// primary, so that the reader can name the reason. The test is
		// checked before anything the primary holds.
		testNode := b.only(n, "test")
		symbol := b.knownOf(b.only(n, "primary"), primaryRules)
		switch symbol.Rule {
		case "constant-reference":
			b.fail(symbol, "%s", constantInBody)
		case "reference", "tag", "character", "phoneme", "range", "property":
		default:
			b.fail(testNode, "a test follows only a reference other than # or a terminal, not a group, an optional, braces, a capture, ε, # or another test")
		}
		if symbol.Rule == "reference" && b.text(b.token(symbol)) == "#" {
			b.fail(testNode, "a test follows only a reference other than # or a terminal, not a group, an optional, braces, a capture, ε, # or another test")
		}
		// A symbol, which holds no construct.
		inner := b.expr(symbol)
		// The comparator is the test's tokens: =, ≠, ⊇ or ⊉, or ∩ and =∅
		// or ≠∅ around the operand.
		f.test = &domExpr{Kind: exTest, Op: b.comparator(testNode), Inner: inner}
		f.operand = b.only(testNode, "test-operand")
		b.closedFor = "a test's operand"
		return ask(&termFrame{n: f.operand})
	case "capture":
		// Its place, then $, its name and its symbol, each at the capture,
		// before what it wraps (engine §9).
		if b.braces > 0 {
			b.fail(n, "a capture cannot stand inside braces, whose parts repeat: name the list as a rule, and capture that")
		}
		if b.marked > 0 {
			b.fail(n, "a capture cannot stand inside an elidable optional, which elision restores as one unit")
		}
		captureToken := b.token(n)
		inner := b.only(n, "primary")
		if b.text(captureToken) == "$" {
			b.fail(n, "$ is the whole constituent and wraps nothing")
		}
		name := strings.TrimPrefix(b.text(captureToken), "$")
		if !captureName.MatchString(name) {
			b.fail(n, "a capture's name is all lower case")
		}
		wrapped := b.knownOf(inner, primaryRules)
		if wrapped.Rule == "constant-reference" {
			b.fail(wrapped, "%s", constantInBody)
		}
		if !capturedRules[wrapped.Rule] {
			b.fail(n, "a capture wraps a single symbol: a name, a tag literal, a character tag, a phoneme tag, a range or a property, or a tested one")
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
		b.fail(n, "%s", constantInBody)
	}
	b.fail(n, "unexpected %s in an expression", n.Rule)
	return readStep{}
}

// startOptional checks an optional, and with a marker + or ++ among its
// parts an elidable one (engine §3.8, §9). Its form is checked on the
// tree, where a group is still a node: one sequence, with no leading | or
// &, whose first primary is the terminal itself, =-tested or not. Its
// parts are looked up in the order of §9: its choice, then its markers.
func (f *exprFrame) startOptional(b *domBuilder) readStep {
	n := f.n
	choice := b.only(n, "choice")
	var markers []*Node
	for _, p := range parts(n) {
		if p.Kind == KindToken && (b.text(p) == "+" || b.text(p) == "++") {
			markers = append(markers, p)
		}
	}
	if len(markers) >= 2 {
		b.fail(markers[1], "an optional has one marker + or ++ at most")
	}
	if len(markers) == 0 {
		f.elide = &domExpr{Kind: exOptional}
		return ask(&exprFrame{n: choice})
	}
	const form = "an elidable optional begins with its terminator, a name with a capital or ~name, written directly after the marker, and joins it to nothing with | or &"
	hasToken := func(node *Node, text string) bool {
		for _, p := range parts(node) {
			if p.Kind == KindToken && b.text(p) == text {
				return true
			}
		}
		return false
	}
	conjunctions := ofRule(choice, "conjunction")
	leading := hasToken(choice, "|") || (len(conjunctions) == 1 && hasToken(conjunctions[0], "&"))
	var head *Node
	if len(conjunctions) == 1 && !leading {
		if sequences := ofRule(conjunctions[0], "sequence"); len(sequences) == 1 {
			if primaries := ofRule(sequences[0], "primary"); len(primaries) > 0 {
				head = b.knownOf(primaries[0], primaryRules)
			}
		}
	}
	isTerminal := func(symbol *Node) bool {
		return symbol.Rule == "tag" || (symbol.Rule == "reference" && isTerminalName(b.text(b.token(symbol))))
	}
	switch {
	case head == nil:
		b.fail(n, form)
	case head.Rule == "tested":
		if !isTerminal(b.knownOf(b.only(head, "primary"), primaryRules)) {
			b.fail(n, form)
		}
		testNode := b.only(head, "test")
		if b.comparator(testNode) != "=" {
			b.fail(testNode, "the terminator of an elidable optional takes no test but =, since elision-only restores it with its sound")
		}
	case !isTerminal(head):
		b.fail(n, form)
	}
	b.marked++
	f.marked = true
	f.elide = &domExpr{Kind: exOptional, Elidable: true, Maximal: b.text(markers[0]) == "++"}
	return ask(&exprFrame{n: choice})
}

// startRepetition checks braces: the item, its separator if a backslash
// has one, and a chain's direction from its marker, a ... among the parts
// (engine §9).
func (f *exprFrame) startRepetition(b *domBuilder) readStep {
	n := f.n
	found := parts(n)
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
		if p.Kind == KindToken && b.text(p) == "..." {
			markers = append(markers, i)
		}
	}
	// Two markers are an error at the second, and a marker after the
	// separator is an error at that marker, whichever a reader meets first.
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
	b.braces++
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
	if f.guards != nil {
		if c, ok := in.(*domCond); ok {
			f.conds = append(f.conds, c)
			if len(f.conds) < len(f.guards) {
				return ask(&anyOfFrame{n: f.guards[len(f.conds)]})
			}
			last := one(n, "union")
			if last == nil {
				last = b.only(n, "term")
			}
			return ask(&valueFrame{n: last})
		}
		t := in.(*domTerm)
		// The reader has checked each comparison of a condition, so a
		// condition's terms agree; the term guarded last must be a tag
		// set, an error at its guard.
		ty, problem := b.typeOf(t)
		if problem == "" {
			problem = expectedProblem(ty, tyTags)
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
	if problem != "" {
		b.fail(n, "%s", problem)
	}
	f.items = append(f.items, t)
	f.types = append(f.types, ty)
	if len(f.items) < len(f.parts) {
		return ask(&valueFrame{n: f.parts[len(f.items)]})
	}
	op := f.ops[0]
	for _, o := range f.ops {
		if o == "∖" {
			op = o
		}
	}
	if _, problem := joinedType(f.types, op); problem != "" {
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
	case "term":
		f.pass = true
		return ask(&termFrame{n: b.knownOf(n, termRules), argument: f.argument})
	case "test-operand", "term-atom":
		// A test's operand is one term, as a term-atom reads it (§9).
		f.pass = true
		return ask(&termFrame{n: b.knownOf(n, atomRules), argument: f.argument})
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
		for _, p := range parts(n) {
			if p.Kind == KindToken {
				if t := b.text(p); t == "∪" || t == "∖" {
					ops = append(ops, t)
				}
			}
		}
		// A leading ∪ is a separator, not an operator.
		for len(ops) >= len(ps) {
			ops = ops[1:]
		}
		f.parts, f.ops = ps, ops
		return ask(&valueFrame{n: ps[0]})
	case "intersection":
		ps := b.some(n, "term-atom", 1)
		if len(ps) == 1 {
			f.pass = true
			return ask(&termFrame{n: ps[0], argument: f.argument})
		}
		f.parts, f.ops = ps, []string{"∩"}
		return ask(&valueFrame{n: ps[0]})
	case "string":
		return give(&domTerm{Kind: tmString, Str: b.decode(b.token(n))})
	case "tag", "character", "phoneme":
		return give(&domTerm{Kind: tmTag, Str: b.tagOf(b.token(n))})
	case "range":
		return give(&domTerm{Kind: tmRange, Range: b.readRange(n)})
	case "property":
		b.fail(n, "a property is not a tag set, and stands only as a terminal in a body")
	case "name":
		// A bare name is a tag literal if it begins with a capital, and
		// otherwise a rule, which only a function's argument names.
		name := b.text(b.token(n))
		switch {
		case isCapital(name):
			return give(&domTerm{Kind: tmTag, Str: name})
		case f.argument:
			return give(&domTerm{Kind: tmRule, Str: name})
		}
		b.fail(n, "%s names a rule, which is not a value; ~%s is the tag", name, name)
	case "empty-set":
		return give(&domTerm{Kind: tmEmptySet})
	case "constant-reference":
		return give(&domTerm{Kind: tmConst, Str: strings.TrimPrefix(b.text(b.token(n)), "$"), At: b.at(n)})
	case "capture-reference":
		name := strings.TrimPrefix(b.text(b.token(n)), "$")
		if b.closedFor != "" {
			b.fail(n, "%s is a closed term, and holds no capture", b.closedFor)
		}
		if !f.argument {
			b.fail(n, "a span is not a value: tags($%s) is the tag set of $%s", name, name)
		}
		return give(&domTerm{Kind: tmCapture, Str: name})
	case "call":
		f.pass = true
		return ask(&callFrame{n: n})
	}
	b.fail(n, "unexpected %s in a term", n.Rule)
	return readStep{}
}

// valueFrame reads a term where a value is needed.
type valueFrame struct {
	n       *Node
	started bool
}

func (f *valueFrame) resume(b *domBuilder, in any) readStep {
	if !f.started {
		f.started = true
		return ask(&termFrame{n: f.n})
	}
	t := in.(*domTerm)
	if t.Kind == tmCall && isSpanFunction(t.Str) {
		b.fail(f.n, "%s() gives a span, which is not a value", t.Str)
	}
	return give(t)
}

// callFrame reads a call in a term, or, in a condition, matches(), begins()
// or initial().
type callFrame struct {
	n           *Node
	inCondition bool
	started     bool
	name        *Node
	arguments   []*Node
	args        []*domTerm
}

func (f *callFrame) resume(b *domBuilder, in any) readStep {
	if !f.started {
		f.started = true
		f.name = b.token(f.n)
		name := b.text(f.name)
		// A closed term calls only split and tag, the closed functions (§9,
		// §10).
		if b.closedFor != "" && name != "split" && name != "tag" {
			if !notationFunctions[name] {
				b.fail(f.name, "%s() is not a function of the notation", name)
			}
			if name == "classify" {
				b.fail(f.name, "%s is a closed term, and classify() depends on the features", b.closedFor)
			}
			b.fail(f.name, "%s is a closed term, and %s() is not closed", b.closedFor, name)
		}
		f.arguments = ofRule(f.n, "argument")
	} else {
		f.args = append(f.args, in.(*domTerm))
	}
	if len(f.args) < len(f.arguments) {
		return ask(&termFrame{n: b.only(f.arguments[len(f.args)], "union"), argument: true})
	}
	return give(b.finishCall(f.name, f.args, f.inCondition))
}

// finishCall checks a call's arguments against its function's signature.
func (b *domBuilder) finishCall(nameNode *Node, args []*domTerm, inCondition bool) *domTerm {
	name := b.text(nameNode)
	shape := func(ok bool) {
		if !ok {
			b.fail(nameNode, "%s() is not called with the arguments it takes", name)
		}
	}
	span := func(i int) bool { return i < len(args) && isSpanTerm(args[i]) }
	rule := func(i int) bool { return i < len(args) && args[i].Kind == tmRule }
	// A bare name in another slot is a call with the wrong arguments, so
	// the error is the call's, as for any other signature (§9).
	for i, a := range args {
		if a.Kind == tmRule && !(i == 1 && (name == "tags" || name == "matches" || name == "begins" || name == "classify")) {
			b.fail(nameNode, "a bare name is an argument only as the rule of tags(), matches() or begins(), or the classifier of classify()")
		}
	}
	if inCondition {
		switch name {
		case "matches", "begins":
			shape(len(args) == 2 && span(0) && rule(1))
		case "initial":
			shape(len(args) == 1 && span(0))
		default:
			b.fail(nameNode, "a condition calls only matches(), begins() or initial(); %s() is a term", name)
		}
		return &domTerm{Kind: tmCall, Str: name, Items: args}
	}
	switch name {
	case "phonemes", "text", "classes", "head", "tail", "last", "from", "after":
		shape(len(args) == 1 && span(0))
	case "tags":
		shape((len(args) == 1 && span(0)) || (len(args) == 2 && span(0) && rule(1)))
	case "split":
		shape(len(args) == 2 && b.isStringTerm(args[0]) && b.isStringTerm(args[1]))
	case "tag":
		shape(len(args) == 1 && b.isStringTerm(args[0]))
	case "classify":
		// A string, and a bare name, which names a classifier and not a
		// rule (§9).
		shape(len(args) == 2 && b.isStringTerm(args[0]) && rule(1))
		return &domTerm{Kind: tmCall, Str: name, Items: []*domTerm{args[0], {Kind: tmClassifier, Str: args[1].Str}}}
	case "matches", "begins", "initial":
		b.fail(nameNode, "%s() is a condition, not a term", name)
	default:
		b.fail(nameNode, "%s() is not a function of the notation", name)
	}
	// An empty delimiter or a tag's name that the reader sees (§9).
	if msg := literalCallProblem(name, args); msg != "" {
		b.fail(nameNode, "%s", msg)
	}
	return &domTerm{Kind: tmCall, Str: name, Items: args}
}

// implicationFrame reads its any-ofs in order, and after them the
// implication of a notation that writes one after ⟹, grouped to the right
// (§9).
type implicationFrame struct {
	n       *Node
	started bool
	anyOfs  []*Node
	nested  *Node
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
		if consequent := one(f.n, "implication"); consequent != nil {
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
		case "comparison":
			ps := b.some(n, "union", 2)
			f.compare = &domCond{Kind: cdCompare}
			f.right = ps[1]
			return ask(&valueFrame{n: ps[0]})
		case "negation", "call", "implication":
		case "presence":
			return give(&domCond{Kind: cdCaptured, Rule: strings.TrimPrefix(b.text(b.token(n)), "$")})
		default:
			b.fail(n, "unexpected %s in a condition", n.Rule)
		}
		switch n.Rule {
		case "negation":
			return ask(&conditionFrame{n: b.only(n, "condition")})
		case "call":
			return ask(&callFrame{n: n, inCondition: true})
		}
		// Between parentheses, which make no node.
		f.pass = true
		return ask(&implicationFrame{n: n})
	}
	if f.pass {
		return give(in)
	}
	switch n.Rule {
	case "comparison":
		if f.right != nil {
			f.compare.Left = in.(*domTerm)
			f.compare.Op = b.text(b.token(b.only(n, "comparator")))
			right := f.right
			f.right = nil
			return ask(&valueFrame{n: right})
		}
		f.compare.Right = in.(*domTerm)
		// The two sides fit the comparator (§10).
		if fault := condTypeMemo(f.compare, nil, b.types); fault != nil {
			b.fail(n, "%s", fault.problem)
		}
		return give(f.compare)
	case "negation":
		return give(&domCond{Kind: cdNot, Inner: in.(*domCond)})
	}
	t := in.(*domTerm)
	if t.Str == "initial" {
		return give(&domCond{Kind: cdInitial, Span: t.Items[0]})
	}
	kind := cdMatches
	if t.Str == "begins" {
		kind = cdBegins
	}
	return give(&domCond{Kind: kind, Span: t.Items[0], Rule: t.Items[1].Str})
}
