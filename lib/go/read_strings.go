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
	t := &domTerm{Kind: tmUnion}
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
	named := first.Rule == "name" || first.Rule == "reference" || first.Kind == KindToken && (first.Terminal == "Lowercase-Name" || first.Terminal == "Emoji-Name")
	terminal := !named && (first.Rule == "parameter" || first.Rule == "tag" || first.Rule == "string-terminal" || first.Rule == "string" || first.Rule == "range" || first.Rule == "wildcard" || first.Rule == "constant-reference" || first.Kind == KindToken && (isCapital(name) || engineTag(name)))
	tagSeen, valueSeen := false, false
	for _, test := range tests {
		if (!terminal && !named && first.Rule != "call" && first.Rule != "tag-test") || named && test.Rule == "value-test" || first.Rule == "call" && test.Rule == "value-test" || test.Rule == "tag-test" && (tagSeen || valueSeen) || test.Rule == "value-test" && valueSeen {
			b.fail(test, "invalid pattern test target or order")
		}
		if test.Rule == "tag-test" {
			tagSeen = true
		} else {
			valueSeen = true
		}
	}
	p := &domPattern{At: b.at(first)}
	if named {
		if !b.uni.isEmojiName(name) && !classifierName.MatchString(name) {
			b.fail(first, "a malformed pattern rule name")
		}
		p.Kind, p.Name = "name", name
	}
	if !named {
		switch first.Rule {
		case "tag-test":
			p.Kind = "any"
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
	if p.Kind == "name" && !b.uni.isEmojiName(p.Name) && !classifierName.MatchString(p.Name) {
		b.fail(first, "a malformed pattern rule name")
	}
	for _, test := range tests {
		next := &domPattern{Kind: "test", Items: []*domPattern{p}}
		if test.Rule == "tag-test" {
			next.Op = "tags"
			next.Requirements = b.patternRequirements(test)
			if named || first.Rule == "call" {
				for _, requirement := range next.Requirements {
					if !requirement.Negated && requirement.Value.Kind == tmTag && requirement.Value.Str == "_Elided" {
						panic(grammarError(b.doc, requirement.Value.At, "a rule pattern cannot require _Elided"))
					}
				}
			}
			if first.Rule == "tag-test" && p.Kind == "any" {
				next.Items = nil
			}
		} else {
			next.Op = b.operator(b.token(b.only(test, "test")))
			operand := b.only(test, "test-operand")
			part := b.knownOf(operand, atomRules)
			if part.Rule != "string" && part.Rule != "constant-reference" && part.Rule != "parameter" {
				b.fail(operand, "a pattern value test requires a string")
			}
			next.Value = b.term(part)
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
	for _, atom := range t.Items {
		if stringTermShape(atom) {
			c.term(atom, 1, false)
			continue
		}
		if atom == nil || atom.Kind != tmCall || len(atom.Items) != 1 {
			c.fail("invalid recipe atom")
			continue
		}
		r := atom.Items[0]
		if r.Kind == tmCapture && (atom.Str == "value" || atom.Str == "image" || atom.Str == "source-text" || atom.Str == "decomposed-source-text" || atom.Str == "verbatim-text") {
			continue
		}
		if r.Kind == tmCall && r.Str == "emitted" && len(r.Items) == 1 && r.Items[0].Kind == tmCapture && (atom.Str == "value" || atom.Str == "image") {
			continue
		}
		c.fail("invalid recipe method")
	}
}

func (b *domBuilder) constantRef(n *Node) *domTerm {
	token := b.token(n)
	name := strings.TrimPrefix(b.tokenValue(token), "$")
	if !constName.MatchString(name) {
		b.fail(token, "a user constant begins with a capital")
	}
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
	return &domTerm{Kind: tmString, Str: value}
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
	r := [2]*domTerm{ends[0], ends[1]}
	var scalars [2]rune
	known := true
	for i, end := range r {
		if end.Kind != tmString {
			known = false
			continue
		}
		cs := []rune(end.Str)
		if len(cs) != 1 {
			b.fail(n, "a range endpoint is one scalar")
		}
		scalars[i] = cs[0]
	}
	if known && scalars[0] > scalars[1] {
		b.fail(n, "a range starts above its end")
	}
	return r
}

func (b *domBuilder) findTestBase(n *Node) *Node {
	if p := b.one(n, "primary"); p != nil {
		return b.knownOf(p, primaryRules)
	}
	for _, p := range b.ruleParts(n) {
		for _, kind := range primaryRules {
			if p.Rule == kind && kind != "tested" {
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
	valid := capturedRules[base.Rule] && base.Rule != "tested"
	seenTags, seenValue := false, false
	for _, test := range tests {
		if test.Rule == "default-value" {
			continue
		}
		if !valid || test.Rule == "tag-test" && (seenTags || seenValue) || test.Rule == "value-test" && seenValue {
			b.fail(test, "invalid test target or order")
		}
		if test.Rule == "tag-test" {
			seenTags = true
		} else {
			seenValue = true
		}
	}
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
		e := &domExpr{Kind: exTest, Inner: expr}
		if test.Rule == "tag-test" {
			e.Op = "tags"
			e.Requirements = b.requirements(test)
		} else {
			e.Op = b.operator(b.token(b.only(test, "test")))
			operand := b.only(test, "test-operand")
			part := b.knownOf(operand, atomRules)
			if part.Rule != "string" && part.Rule != "constant-reference" && part.Rule != "parameter" {
				b.fail(operand, "a value test requires a string or string constant")
			}
			e.Value = b.term(part)
		}
		expr = e
	}
	return expr
}

func (b *domBuilder) requirements(n *Node) []tagRequirement {
	out := []tagRequirement{}
	for _, p := range b.ofRule(n, "tag-requirement") {
		operand := b.only(p, "test-operand")
		part := b.knownOf(operand, atomRules)
		if part.Rule != "tag" && part.Rule != "constant-reference" && part.Rule != "name" && part.Rule != "parameter" {
			b.fail(operand, "a tag requirement requires a tag or tag-set constant")
		}
		if part.Rule == "name" && !isCapital(b.tokenValue(b.token(part))) {
			b.fail(operand, "a tag requirement requires a tag")
		}
		r := tagRequirement{Value: b.term(part)}
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
	for _, atom := range b.some(n, "recipe-atom", 1) {
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
			valid := stringTermShape(t) || t.Kind == tmParam || t.Kind == tmSourceCall
			if t.Kind == tmCall && len(t.Items) == 1 {
				receiver := t.Items[0]
				valid = receiver.Kind == tmCapture && (t.Str == "value" || t.Str == "image" || t.Str == "source-text" || t.Str == "decomposed-source-text" || t.Str == "verbatim-text")
				if receiver.Kind == tmCall && receiver.Str == "emitted" && len(receiver.Items) == 1 && receiver.Items[0].Kind == tmCapture {
					valid = t.Str == "value" || t.Str == "image"
				}
			}
			if !valid {
				b.fail(atom, "a recipe requires a string or capture string method")
			}
			r.Items = append(r.Items, t)
		}
	}
	return r
}

type methodFrame struct {
	n           *Node
	inCondition bool
	started     bool
	selectors   []*Node
	index       int
	receiver    *domTerm
	dependent   bool
	args        []*domTerm
	arguments   []*Node
}

func (f *methodFrame) resume(b *domBuilder, in any) readStep {
	if !f.started {
		f.started = true
		receiver := b.only(b.only(f.n, "method-receiver"), "term-atom")
		f.dependent = b.sourceSyntaxUnresolved(receiver)
		return ask(&termFrame{n: receiver, argument: true})
	}
	if f.receiver == nil {
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
		name := b.tokenValue(b.token(b.only(selector, "method-name")))
		arguments := b.one(selector, "arguments")
		if f.arguments == nil {
			if !knownMethod(name) {
				b.fail(f.n, "unknown method %s", name)
			}
			if b.closedFor != "" && name != "split" && name != "ngrams" {
				b.fail(f.n, "%s cannot read an input method", b.closedFor)
			}
			f.arguments = []*Node{}
			if arguments != nil {
				f.arguments = b.some(arguments, "argument", 1)
			}
		}
		if len(f.args) < len(f.arguments) {
			arg := f.arguments[len(f.args)]
			if integer := b.one(arg, "integer"); integer != nil {
				digits := b.tokenValue(b.token(integer))
				if !validInteger(digits) {
					b.fail(integer, "an integer argument is positive and has no leading zeros")
				}
				f.args = append(f.args, &domTerm{Kind: tmInteger, Str: digits})
				continue
			}
			return ask(&termFrame{n: b.only(arg, "term"), argument: true})
		}
		if arguments != nil {
			expected := ","
			if boundaryMethod(name) || name == "matches" || name == "begins" || name == "ends" {
				expected = "|"
			}
			for _, p := range b.parts(arguments) {
				if p.Kind == KindToken && b.tokenValue(p) != expected {
					b.fail(arguments, "invalid method argument separator")
				}
			}
			for i, a := range f.args {
				a.At = b.at(f.arguments[i])
			}
		}
		argumentUnresolved := arguments != nil && b.sourceSyntaxUnresolved(arguments)
		if (name == "classify" || name == "ngrams") && argumentUnresolved {
			b.fail(f.n, "a parameter cannot replace a classifier name or integer argument")
		}
		f.dependent = f.dependent || argumentUnresolved
		f.receiver = b.finishMethod(f.n, name, f.receiver, f.args, f.dependent)
		f.index++
		if f.index == len(f.selectors) {
			isPredicate := name == "starts-input" || name == "ends-input" || boundaryMethod(name) || name == "matches" || name == "begins" || name == "ends"
			if isPredicate != f.inCondition {
				if isPredicate {
					b.fail(f.n, "a query method is a condition, not a term")
				}
				b.fail(f.n, "a condition requires a query method")
			}
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
	methodQuery
	methodNgrams
	methodSplit
	methodClassify
)

var sourceMethods = map[string]sourceMethodKind{
	"value": methodSpan, "image": methodSpan, "source-text": methodSpan,
	"decomposed-source-text": methodSpan, "classes": methodSpan, "onward": methodSpan,
	"following-tokens": methodSpan, "preceding-tokens": methodSpan, "first-token": methodSpan,
	"last-token": methodSpan, "tokens-after-first": methodSpan, "starts-input": methodSpan, "ends-input": methodSpan,
	"without-elision": methodRestored, "without-elision-except": methodRestored,
	"verbatim-text": methodRecipe, "emitted": methodRecipe,
	"tags": methodTags, "followed-by": methodBoundary, "preceded-by": methodBoundary,
	"matches": methodQuery, "begins": methodQuery, "ends": methodQuery,
	"ngrams": methodNgrams, "split": methodSplit, "classify": methodClassify,
}

func knownMethod(name string) bool { return sourceMethods[name] != 0 }

func (b *domBuilder) finishMethod(n *Node, name string, receiver *domTerm, args []*domTerm, dependent bool) *domTerm {
	fail := func() {
		if b.featureContext || dependent {
			b.fail(n, "a method has the wrong receiver or arguments")
		}
		if name == "without-elision" {
			b.fail(n, "without-elision requires a bare capture: write $x.without-elision.onward")
		}
		if name == "without-elision-except" {
			if receiver.Kind != tmCapture {
				b.fail(n, "without-elision-except requires a bare capture: write $x.without-elision-except(family).onward")
			}
			b.fail(n, "without-elision-except requires one rule name")
		}
		b.fail(n, "a method has the wrong receiver or arguments")
	}
	if name == "ends" && restoredTerm(receiver) {
		b.fail(n, "ends requires an ordinary span, not a restored span")
	}
	unknown := func(t *domTerm) bool { return t.Kind == tmParam || t.Kind == tmSourceCall }
	span := b.featureContext || isSpanTerm(receiver)
	valid := false
	switch sourceMethods[name] {
	case methodSpan:
		valid = len(args) == 0 && span
		if receiver.Kind == tmCall && receiver.Str == "emitted" {
			valid = len(args) == 0 && (name == "value" || name == "image")
		}
	case methodRestored:
		if receiver.Kind != tmCapture && !unknown(receiver) && !b.featureContext {
			fail()
		}
		valid = name == "without-elision" && len(args) == 0 || name == "without-elision-except" && len(args) == 1 && (args[0].Kind == tmRule || unknown(args[0]))
	case methodRecipe:
		valid = (b.inRecipe || name == "emitted" && b.inCondition) && len(args) == 0 && receiver.Kind == tmCapture
	case methodTags:
		valid = span && (len(args) == 0 || len(args) == 1 && (args[0].Kind == tmRule || unknown(args[0])))
	case methodBoundary:
		valid = (b.featureContext || receiver.Kind == tmCapture || unknown(receiver)) && len(args) > 0
		for _, a := range args {
			if a.Kind == tmTag && isCapital(a.Str) {
				a.Kind = tmTerminal
			}
			valid = valid && (a.Kind == tmRule || a.Kind == tmTerminal || unknown(a)) && !engineTag(a.Str)
		}
	case methodQuery:
		valid = span && len(args) > 0
		for _, a := range args {
			if a.Kind == tmTag && isCapital(a.Str) {
				a.Kind = tmTerminal
			}
			valid = valid && (a.Kind == tmRule || a.Kind == tmTerminal || unknown(a)) && !engineTag(a.Str)
		}
	case methodNgrams:
		valid = len(args) == 1 && (b.featureContext || b.isStringTerm(receiver)) && args[0].Kind == tmInteger && validInteger(args[0].Str)
	case methodSplit:
		valid = len(args) == 1 && (b.featureContext || b.isStringTerm(receiver) && b.isStringTerm(args[0]))
	case methodClassify:
		valid = len(args) == 1 && (b.featureContext || b.isStringTerm(receiver)) && (unknown(args[0]) || args[0].Kind == tmRule && classifierName.MatchString(args[0].Str))
		if valid && !unknown(args[0]) {
			args[0] = &domTerm{Kind: tmClassifier, Str: args[0].Str}
		}
	}
	if !valid {
		fail()
	}
	items := append([]*domTerm{receiver}, args...)
	if msg := literalCallProblem(name, items); msg != "" && !b.featureContext {
		b.fail(n, "%s", msg)
	}
	return &domTerm{Kind: tmCall, Str: name, Items: items, At: b.at(n)}
}

func (b *domBuilder) sourceSyntaxUnresolved(n *Node) bool {
	if b.unresolvedNodes == nil {
		b.unresolvedNodes = make(map[*Node]bool)
	}
	type visit struct {
		node     *Node
		complete bool
	}
	pending := []visit{{n, false}}
	for len(pending) > 0 {
		part := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		if _, ok := b.unresolvedNodes[part.node]; ok {
			continue
		}
		if part.complete {
			dependent := false
			for _, child := range b.parts(part.node) {
				dependent = dependent || b.unresolvedNodes[child]
			}
			b.unresolvedNodes[part.node] = dependent
			continue
		}
		if w := work.Load(); w != nil {
			w.readerSteps.add("reader steps")
		}
		if part.node.Rule == "parameter" || part.node.Rule == "call" {
			b.unresolvedNodes[part.node] = true
			continue
		}
		pending = append(pending, visit{part.node, true})
		for _, child := range b.parts(part.node) {
			if _, ok := b.unresolvedNodes[child]; !ok {
				pending = append(pending, visit{child, false})
			}
		}
	}
	return b.unresolvedNodes[n]
}

func (b *domBuilder) patternRequirements(n *Node) []tagRequirement {
	out := []tagRequirement{}
	for _, p := range b.ofRule(n, "tag-requirement") {
		operand := b.only(p, "test-operand")
		part := b.knownOf(operand, atomRules)
		if part.Rule != "tag" && part.Rule != "constant-reference" && part.Rule != "name" && part.Rule != "parameter" {
			b.fail(operand, "a tag requirement requires a tag or tag-set constant")
		}
		var value *domTerm
		if b.tokenValue(b.token(part)) == "_Elided" {
			value = &domTerm{Kind: tmTag, Str: "_Elided", At: b.at(part)}
		} else {
			value = b.term(part)
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
