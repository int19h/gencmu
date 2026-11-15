package gencmu

import "strings"

func (b *domBuilder) tagRun(n *Node) *domTerm {
	if b.inRecipe && n.Rule == "string-run" {
		b.fail(n, "juxtaposed recipe strings require ++, use ++ between string atoms")
	}
	for _, index := range []int{n.Span[0] - 1, n.Span[1]} {
		if index >= 0 && index < len(b.toks) {
			t := b.toks[index].Value
			if t == "∩" || t == "∖" {
				kind := "tag"
				if n.Rule == "string-run" {
					kind = "string"
				}
				b.fail(n, "a %s run beside intersection or difference requires parentheses", kind)
			}
		}
	}
	t := &domTerm{Kind: tmUnion, At: b.at(n)}
	kind := "tag"
	if n.Rule == "string-run" {
		kind = "string"
	}
	for _, tag := range b.some(n, kind, 2) {
		t.Items = append(t.Items, b.term(tag))
	}
	return t
}

func (b *domBuilder) patternAtom(n, first *Node) *domPattern {
	var tests []*Node
	for _, p := range b.ruleParts(n) {
		if p.Rule == "default-value" {
			b.fail(p, "a default stands only on an elidable optional head")
		}
		if p.Rule == "tag-test" || p.Rule == "value-test" || p.Rule == "default-value" {
			tests = append(tests, p)
		}
	}
	name := b.tokenValue(first)
	named := first.Rule == "rule-or-classifier-name" || first.Rule == "rule-reference" || first.Kind == KindToken && (first.Terminal == "Lowercase-Name" || first.Terminal == "Emoji-Name")
	terminal := !named && (first.Rule == "parameter" || first.Rule == "tag" || first.Rule == "string-terminal" || first.Rule == "string" || first.Rule == "range" || first.Rule == "wildcard" || first.Rule == "constant-reference" || first.Kind == KindToken && (isCapital(name) || engineTag(name)))
	tagSeen, valueSeen := false, false
	for _, test := range tests {
		if (!terminal && !named && first.Rule != "call" && first.Rule != "tag-test") || test.Rule == "tag-test" && (tagSeen || valueSeen) || test.Rule == "value-test" && valueSeen {
			b.fail(test, "invalid pattern test target or order")
		}
		if test.Rule == "tag-test" {
			tagSeen = true
		} else {
			valueSeen = true
		}
	}
	p := &domPattern{At: b.at(first)}
	// A malformed rule name is a DOM fault, which the validator reports
	// (engine §9.3 step 5).
	if named {
		p.Kind, p.Name = "name", name
	}
	if !named {
		switch first.Rule {
		case "tag-test":
			b.fail(first, "a pattern requires an atom before its tag test")
		case "parameter":
			parameter := b.parameter(first)
			p.Kind, p.Name = "param", parameter.Str
		case "call":
			p.Kind = "call"
			p.Call = b.run(&sourceCallFrame{n: first}).(*domSourceCall)
		case "tag":
			p.Kind, p.Name = "terminal", b.tagOf(b.token(first))
		case "string-terminal":
			part := b.knownOf(first, []string{"string", "constant-reference"})
			p.Kind, p.Value = "literal", b.term(part)
		case "string":
			p.Kind, p.Value = "literal", b.term(first)
		case "wildcard":
			b.token(first)
			p.Kind = "wildcard"
		case "range":
			p.Kind, p.Ends = "range", b.stringRange(first)
		case "constant-reference":
			t := b.constantRef(first)
			p.Kind, p.Name = "constant", t.Str
		default:
			p.Kind, p.Name = "name", name
			if terminal {
				p.Kind = "terminal"
			}
		}
	}
	if p.Kind == "literal" && p.Value.Kind == tmConst {
		p.Kind, p.Name, p.Value = "constant", p.Value.Str, nil
	}
	for _, test := range tests {
		next := &domPattern{Kind: "test", Items: []*domPattern{p}}
		if test.Rule == "tag-test" {
			next.Op = "tags"
			next.Requirements = b.patternRequirements(test)
		} else {
			next.Op = b.operator(b.token(b.only(test, "value-comparator")))
			operand := b.only(test, "test-operand")
			next.Value = b.testOperand(operand)
		}
		p = next
	}
	return p
}

func (c *domChecker) recipe(t *domTerm) {
	if t == nil {
		return
	}
	if t.Kind != tmConcat || len(t.Items) == 0 {
		c.fail("a malformed recipe")
		return
	}
	// Each atom is checked as a term. Whether it is a string or a
	// recipe method is a fault of rule type inspection, which reports
	// it in clause order after the clause's tag terms (engine §9.3).
	for _, atom := range t.Items {
		if atom == nil {
			c.fail("a malformed recipe atom")
			return
		}
	}
	previous := c.inRecipe
	c.inRecipe = true
	for _, atom := range t.Items {
		c.term(atom, 1, false)
	}
	c.inRecipe = previous
}

func (b *domBuilder) constantRef(n *Node) *domTerm {
	token := b.token(n)
	name := strings.TrimPrefix(b.tokenValue(token), "$")
	// A malformed name is a DOM fault, which the validator reports
	// (engine §9.3 step 5).
	return &domTerm{Kind: tmConst, Str: name, At: b.at(token)}
}

func (b *domBuilder) stringTerm(n *Node) *domTerm {
	token := n
	if token.Kind != KindToken {
		token = b.token(n)
	}
	value, err := b.strings.decode(b.toks[token.Token], false)
	if err != nil {
		panic(err)
	}
	return &domTerm{Kind: tmString, Str: value, At: b.at(token)}
}

func (b *domBuilder) stringRange(n *Node) [2]*domTerm {
	var ends []*domTerm
	for _, p := range b.ruleParts(n) {
		if p.Rule == "string" || p.Rule == "constant-reference" || p.Rule == "parameter" {
			ends = append(ends, b.term(p))
			if len(ends) == 2 {
				break
			}
		}
	}
	if len(ends) < 2 {
		b.lacks(n, "two string operands")
	}
	// Whether an endpoint is one scalar, and whether the range starts
	// above its end, is a DOM fault, which the validator reports at
	// the range (engine §9.3 step 5).
	return [2]*domTerm{ends[0], ends[1]}
}

func (b *domBuilder) findTestBase(n *Node) *Node {
	if p := b.one(n, "primary"); p != nil {
		return b.knownOf(p, primaryRules)
	}
	for _, p := range b.ruleParts(n) {
		for _, kind := range primaryRules {
			if p.Rule == kind && kind != "tested-primary" {
				return p
			}
		}
	}
	return nil
}

func (b *domBuilder) testBase(n *Node) *Node {
	base := b.findTestBase(n)
	if base == nil {
		b.lacks(n, "primary")
	}
	return base
}

func (b *domBuilder) tested(n *Node) *domExpr {
	var tests []*Node
	for _, p := range b.ruleParts(n) {
		if p.Rule == "tag-test" || p.Rule == "value-test" || p.Rule == "default-value" {
			tests = append(tests, p)
		}
	}
	if len(tests) == 0 {
		b.lacks(n, "test")
	}
	base := b.testBase(n)
	// Whether the target can carry a test, and whether the tests are
	// in their order, is a DOM fault, which the validator reports at
	// the test (engine §9.3 step 5).
	expr := b.expr(base)
	for _, test := range tests {
		if test.Rule == "default-value" {
			if n != b.defaultHead {
				b.fail(test, "a default stands only on an elidable optional head")
			}
			if b.headDefault != nil {
				b.fail(test, "an elidable head has one default at most")
			}
			operand := b.only(test, "test-operand")
			part := b.knownOf(operand, atomRules)
			if part.Rule != "string" && part.Rule != "constant-reference" && part.Rule != "parameter" {
				b.fail(operand, "a default requires one string")
			}
			b.headDefault, b.defaultNode = b.term(part), test
			continue
		}
		e := &domExpr{Kind: exTest, Inner: expr, At: b.at(test)}
		if test.Rule == "tag-test" {
			e.Op = "tags"
			e.Requirements = b.requirements(test)
		} else {
			e.Op = b.operator(b.token(b.only(test, "value-comparator")))
			// Whether the operand is a string is a DOM fault, which the
			// validator reports after the tested symbol (§9.3 step 5).
			e.Value = b.testOperand(b.only(test, "test-operand"))
		}
		expr = e
	}
	return expr
}

// testOperand reads the operand of a test. A grouped operand is marked,
// and stands at its parenthesis, as no DOM node records.
func (b *domBuilder) testOperand(operand *Node) *domTerm {
	part := b.knownOf(operand, atomRules)
	value := b.term(part)
	if value != nil && (part.Rule == "term" || part.Rule == "term-atom") {
		value.grouped = true
		value.At = b.at(operand)
	}
	return value
}

func (b *domBuilder) requirements(n *Node) []tagRequirement {
	out := []tagRequirement{}
	for _, p := range b.ofRule(n, "tag-requirement") {
		// Whether the operand is a tag, a tag-set constant or a
		// parameter is a DOM fault, which the validator reports (§9.3).
		r := tagRequirement{Value: b.testOperand(b.only(p, "test-operand"))}
		for _, token := range b.parts(p) {
			if token.Kind == KindToken && b.tokenValue(token) == "¬" {
				r.Negated = true
			}
		}
		out = append(out, r)
	}
	return out
}

func (b *domBuilder) recipes(n *Node) (value, image *domTerm) {
	if clause := b.one(n, "value-clause"); clause != nil {
		value = b.recipe(b.only(clause, "recipe"))
	}
	if clause := b.one(n, "image-clause"); clause != nil {
		image = b.recipe(b.only(clause, "recipe"))
	}
	return
}

func (b *domBuilder) recipe(n *Node) *domTerm {
	r := &domTerm{Kind: tmConcat, At: b.at(n)}
	for _, atom := range b.some(n, "recipe-term", 1) {
		if atom.Span[0] < 0 || atom.Span[1] < atom.Span[0] || atom.Span[1] > len(b.toks) {
			b.lacks(atom, "valid token span")
		}
		if len(r.Items) > 0 {
			b.fail(atom, "juxtaposed recipe strings require ++, use ++ between string atoms")
		}
		for i := atom.Span[0]; i < atom.Span[1]; i++ {
			if b.toks[i].Value == "(" || b.toks[i].Value == ")" {
				b.fail(atom, "a recipe uses no grouping or arguments")
			}
			if b.toks[i].Value == "∪" || b.toks[i].Value == "∩" || b.toks[i].Value == "∖" || b.toks[i].Value == "⟹" {
				b.fail(atom, "a recipe atom has no set operator")
			}
		}
		b.inRecipe = true
		t := b.term(b.only(atom, "term"))
		b.inRecipe = false
		items := []*domTerm{t}
		if t.Kind == tmConcat {
			items = t.Items
		}
		for _, t := range items {
			if t.Kind == tmUnion {
				b.fail(atom, "juxtaposed recipe strings require ++, use ++ between string atoms")
			}
			// Whether the atom is a string or a capture string method is
			// a fault of rule type inspection in the validator (§9.3).
			r.Items = append(r.Items, t)
		}
	}
	return r
}

type methodFrame struct {
	readingBody   bool
	parseArgument *Node
	n             *Node
	inCondition   bool
	started       bool
	selectors     []*Node
	index         int
	receiver      *domTerm
	args          []*domTerm
	arguments     []*Node
}

func (f *methodFrame) resume(b *domBuilder, in any) readStep {
	if !f.started {
		f.started = true
		receiver := b.only(b.only(f.n, "method-receiver"), "plain-term-atom")
		return ask(&termFrame{n: receiver, argument: true})
	}
	if f.readingBody {
		f.readingBody = false
		body := in.(*domExpr)
		{
			var sequence []*domExpr
			for _, part := range b.parts(f.parseArgument) {
				if part.Kind == KindToken && b.tokenValue(part) == "…" {
					sequence = append(sequence, &domExpr{Kind: exRemainder, At: b.at(part), atHidden: true})
				} else if part.Rule == "choice" {
					sequence = append(sequence, body)
				}
			}
			if len(sequence) > 1 {
				body = &domExpr{Kind: exSeq, Items: sequence, At: b.at(f.parseArgument)}
			} else if len(sequence) == 1 && sequence[0].Kind == exRemainder {
				body = &domExpr{Kind: exSeq, Items: []*domExpr{sequence[0], body}, At: b.at(f.parseArgument)}
			}
		}
		// The body's form and captures are DOM faults, which the
		// validator reports (engine §9.3 step 5).
		f.args = []*domTerm{{Kind: tmBody, Body: body}}
	} else if f.receiver == nil {
		f.receiver = in.(*domTerm)
	} else if in != nil {
		f.args = append(f.args, in.(*domTerm))
	}
	if f.selectors == nil {
		f.selectors = b.some(f.n, "method-selector", 1)
	}
	for {
		if w := work.Load(); w != nil {
			w.readerSteps.add("reader steps")
		}
		selector := f.selectors[f.index]
		parsed := b.one(selector, "parse-selector")
		name := "parse"
		if parsed == nil {
			name = b.tokenValue(b.token(b.only(selector, "method-name")))
		}
		arguments := b.one(selector, "method-arguments")
		if f.arguments == nil {
			// An unknown method is a fault of the validator, after the
			// receiver (engine §9.3 step 5).
			f.arguments = []*Node{}
			if parsed != nil {
				f.parseArgument = b.only(parsed, "parse-argument")
				f.readingBody = true
				return ask(&exprFrame{n: b.only(f.parseArgument, "choice")})
			}
			if arguments != nil {
				f.arguments = b.some(arguments, "method-argument", 1)
			}
		}
		if len(f.args) < len(f.arguments) {
			arg := f.arguments[len(f.args)]
			if integer := b.one(arg, "integer"); integer != nil {
				// Whether the integer is positive with no leading zero is a
				// DOM fault, which the validator reports (§9.3 step 5).
				digits := b.tokenValue(b.token(integer))
				f.args = append(f.args, &domTerm{Kind: tmInteger, Str: digits, At: b.at(integer)})
				continue
			}
			return ask(&termFrame{n: b.only(arg, "term"), argument: true})
		}
		if arguments != nil {
			expected := ","
			if boundaryMethod(name) {
				expected = "|"
			}
			for _, p := range b.parts(arguments) {
				if p.Kind == KindToken && b.tokenValue(p) != expected {
					b.fail(arguments, "invalid method argument separator")
				}
			}
			// An argument keeps its own position, and a rule name or
			// one without stands at its argument (engine §9.3).
			for i, a := range f.args {
				if a.At == [2]int{} || a.Kind == tmRule {
					a.At = b.at(f.arguments[i])
				}
			}
		}
		// Where the method stands, and whether a parameter replaces a
		// classifier name or an integer, are DOM faults, which the
		// validator reports (engine §9.3 step 5).
		f.receiver = b.finishMethod(f.n, name, f.receiver, f.args)
		f.index++
		if f.index == len(f.selectors) {
			return give(f.receiver)
		}
		f.args, f.arguments = nil, nil
	}
}

type sourceMethodKind int

const (
	methodSpan sourceMethodKind = iota + 1
	methodRestored
	methodRecipe
	methodTags
	methodBoundary
	methodNgrams
	methodSplit
	methodClassify
	methodParse
	methodErrorFree
)

var sourceMethods = map[string]sourceMethodKind{
	"value": methodSpan, "image": methodSpan, "source-text": methodSpan,
	"decomposed-source-text": methodSpan, "classes": methodSpan, "onward": methodSpan,
	"following-tokens": methodSpan, "preceding-tokens": methodSpan, "first-token": methodSpan,
	"last-token": methodSpan, "tokens-after-first": methodSpan, "starts-input": methodSpan, "ends-input": methodSpan,
	"without-elision": methodRestored, "without-elision-except": methodRestored,
	"verbatim-text": methodRecipe, "emitted": methodRecipe,
	"tags": methodTags, "followed-by": methodBoundary, "preceded-by": methodBoundary,
	"ngrams": methodNgrams, "split": methodSplit, "classify": methodClassify,
	"parse": methodParse, "error-free": methodErrorFree,
}

func knownMethod(name string) bool { return sourceMethods[name] != 0 }

// finishMethod builds a method term. A boundary method's capitalized
// tags are terminals, and classify's one lowercase name is a classifier.
// Whether the receiver and arguments fit the method is a DOM fault,
// which the validator reports (engine §9.3 step 5).
func (b *domBuilder) finishMethod(n *Node, name string, receiver *domTerm, args []*domTerm) *domTerm {
	if name == "classify" && len(args) == 1 && args[0].Kind == tmRule && classifierName.MatchString(args[0].Str) {
		args[0] = &domTerm{Kind: tmClassifier, Str: args[0].Str, At: args[0].At}
	}
	if boundaryMethod(name) {
		for _, a := range args {
			if a.Kind == tmTag && !strings.HasPrefix(a.Str, "_") {
				a.Kind = tmTerminal
			}
		}
	}
	items := append([]*domTerm{receiver}, args...)
	return &domTerm{Kind: tmCall, Str: name, Items: items, At: b.at(n)}
}

func (b *domBuilder) patternRequirements(n *Node) []tagRequirement {
	out := []tagRequirement{}
	for _, p := range b.ofRule(n, "tag-requirement") {
		operand := b.only(p, "test-operand")
		part := b.knownOf(operand, atomRules)
		var value *domTerm
		if part.Rule == "tag" && b.tokenValue(b.token(part)) == "_Elided" {
			value = &domTerm{Kind: tmTag, Str: "_Elided", At: b.at(b.token(part))}
		} else {
			value = b.testOperand(operand)
		}
		requirement := tagRequirement{Value: value}
		for _, token := range b.parts(p) {
			if token.Kind == KindToken && b.tokenValue(token) == "¬" {
				requirement.Negated = true
			}
		}
		out = append(out, requirement)
	}
	return out
}
