package gencmu

import "strings"

func unionTerm(a, b *domTerm) *domTerm {
	var parts []*domTerm
	for _, t := range []*domTerm{a, b} {
		if t.Kind == tmUnion {
			parts = append(parts, t.Items...)
		} else {
			parts = append(parts, t)
		}
	}
	return &domTerm{Kind: tmUnion, Items: parts}
}

func (b *domBuilder) tagRun(n *Node) *domTerm {
	if b.inRecipe && n.Rule == "string-run" {
		b.fail(n, "juxtaposed recipe strings require ++, use ++ between string atoms")
	}
	for _, index := range []int{n.Span[0] - 1, n.Span[1]} {
		if index >= 0 && index < len(b.toks) {
			t := b.toks[index].Value
			if t == "∩" || t == "∖" {
				b.fail(n, "a tag run beside intersection or difference requires parentheses")
			}
		}
	}
	t := &domTerm{Kind: tmUnion}
	kind := "tag"
	if n.Rule == "string-run" {
		kind = "string"
	}
	for _, tag := range b.some(n, kind, 2) {
		t.Items = append(t.Items, b.value(tag))
	}
	return t
}

func joinedPattern(kind string, a, b *domPattern) *domPattern {
	if kind != tmUnion {
		return &domPattern{Kind: kind, Items: []*domPattern{a, b}}
	}
	var items []*domPattern
	for _, p := range []*domPattern{a, b} {
		if p.Kind == tmUnion {
			items = append(items, p.Items...)
		} else {
			items = append(items, p)
		}
	}
	return &domPattern{Kind: kind, Items: items}
}

func patternTestTarget(p *domPattern) bool {
	if len(p.Items) != 1 {
		return false
	}
	n := p.Items[0]
	if p.Op != "tags" && n.Kind == "test" && n.Op == "tags" {
		return patternTestTarget(n)
	}
	return n.Kind == "terminal" || n.Kind == "constant" || n.Kind == "literal" || n.Kind == "range" || n.Kind == "wildcard"
}

func patternLeafMatches(p *domPattern, terminal, value string, tags *tagset) bool {
	for p.Kind == "test" {
		if p.Op == "tags" {
			for _, r := range p.Requirements {
				stack := []*domTerm{r.Value}
				for len(stack) > 0 {
					t := stack[len(stack)-1]
					stack = stack[:len(stack)-1]
					if t.Kind == tmTag && tags.has(t.Str) == r.Negated {
						return false
					}
					stack = append(stack, t.Items...)
				}
			}
		} else if (value == p.Value.Str) != (p.Op == "=") {
			return false
		}
		p = p.Items[0]
	}
	return p.Kind == "terminal" && terminal == p.Name
}

func (b *domBuilder) patternAtom(n, first *Node) *domPattern {
	var tests []*Node
	for _, p := range ruleParts(n) {
		if p.Rule == "tag-test" || p.Rule == "value-test" {
			tests = append(tests, p)
		}
	}
	name := b.tokenValue(first)
	terminal := first.Rule == "tag" || first.Rule == "string-terminal" || first.Rule == "string" || first.Rule == "range" || first.Rule == "wildcard" || first.Rule == "constant-reference" || first.Kind == KindToken && (isCapital(name) || engineTag(name))
	tagSeen, valueSeen := false, false
	for _, test := range tests {
		if !terminal || test.Rule == "tag-test" && (tagSeen || valueSeen) || test.Rule == "value-test" && valueSeen {
			b.fail(test, "invalid pattern test target or order")
		}
		if test.Rule == "tag-test" {
			tagSeen = true
		} else {
			valueSeen = true
		}
	}
	p := &domPattern{At: b.at(first)}
	switch first.Rule {
	case "tag":
		p.Kind, p.Name = "terminal", b.tagOf(b.token(first))
	case "string-terminal":
		part := b.knownOf(first, []string{"string", "constant-reference"})
		p.Kind, p.Value = "literal", b.term(part)
	case "string":
		p.Kind, p.Value = "literal", b.term(first)
	case "wildcard":
		p.Kind = "wildcard"
	case "range":
		p.Kind, p.Ends = "range", b.stringRange(first)
	case "constant-reference":
		t := b.constantRef(first)
		if _, scalar := engineScalar(t.Str); scalar {
			p.Kind, p.Value = "literal", t
		} else {
			p.Kind, p.Name = "constant", t.Str
		}
	default:
		p.Kind, p.Name = "name", name
		if terminal {
			p.Kind = "terminal"
		}
	}
	for _, test := range tests {
		next := &domPattern{Kind: "test", Items: []*domPattern{p}}
		if test.Rule == "tag-test" {
			next.Op = "tags"
			next.Requirements = b.requirements(test)
		} else {
			next.Op = b.operator(b.token(b.only(test, "test")))
			operand := b.only(test, "test-operand")
			part := b.knownOf(operand, atomRules)
			if part.Rule != "string" && part.Rule != "constant-reference" {
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
		if _, ok := engineScalar(name); !ok {
			b.fail(token, "invalid scalar constant %s", name)
		}
	}
	return &domTerm{Kind: tmConst, Str: name, At: b.at(token)}
}

func (b *domBuilder) stringTerm(n *Node) *domTerm {
	rs := []rune(b.tokenValue(n))
	if len(rs) < 2 || rs[0] != '"' || rs[len(rs)-1] != '"' {
		b.fail(n, "a string uses double quotes")
	}
	return &domTerm{Kind: tmString, Str: string(rs[1 : len(rs)-1])}
}

func (b *domBuilder) stringRange(n *Node) [2]*domTerm {
	var ends []*domTerm
	for _, p := range ruleParts(n) {
		if p.Rule == "string" || p.Rule == "constant-reference" {
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
			b.fail(n, "a range endpoint requires one scalar")
		}
		scalars[i] = cs[0]
	}
	if known && scalars[0] > scalars[1] {
		b.fail(n, "a range starts above its end")
	}
	return r
}

func (b *domBuilder) testBase(n *Node) *Node {
	if p := one(n, "primary"); p != nil {
		return b.knownOf(p, primaryRules)
	}
	for _, p := range ruleParts(n) {
		for _, kind := range primaryRules {
			if p.Rule == kind && kind != "tested" {
				return p
			}
		}
	}
	b.lacks(n, "primary")
	return nil
}

func (b *domBuilder) tested(n *Node) *domExpr {
	var tests []*Node
	for _, p := range ruleParts(n) {
		if p.Rule == "tag-test" || p.Rule == "value-test" {
			tests = append(tests, p)
		}
	}
	if len(tests) == 0 {
		b.lacks(n, "test")
	}
	base := b.testBase(n)
	valid := capturedRules[base.Rule] && base.Rule != "tested" && !(base.Rule == "reference" && b.tokenValue(b.token(base)) == "#")
	seenTags, seenValue := false, false
	for _, test := range tests {
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
		e := &domExpr{Kind: exTest, Inner: expr}
		if test.Rule == "tag-test" {
			e.Op = "tags"
			e.Requirements = b.requirements(test)
		} else {
			e.Op = b.operator(b.token(b.only(test, "test")))
			operand := b.only(test, "test-operand")
			part := b.knownOf(operand, atomRules)
			if part.Rule != "string" && part.Rule != "constant-reference" {
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
	for _, p := range ofRule(n, "tag-requirement") {
		operand := b.only(p, "test-operand")
		part := b.knownOf(operand, atomRules)
		if part.Rule != "tag" && part.Rule != "constant-reference" && part.Rule != "name" {
			b.fail(operand, "a tag requirement requires a tag or tag-set constant")
		}
		if part.Rule == "name" && !isCapital(b.tokenValue(b.token(part))) {
			b.fail(operand, "a tag requirement requires a tag")
		}
		r := tagRequirement{Value: b.term(part)}
		for _, token := range parts(p) {
			if token.Kind == KindToken && b.tokenValue(token) == "¬" {
				r.Negated = true
			}
		}
		out = append(out, r)
	}
	return out
}

func (b *domBuilder) recipes(n *Node) (value, image *domTerm) {
	if clause := one(n, "value-clause"); clause != nil {
		value = b.recipe(b.only(clause, "recipe"))
	}
	if clause := one(n, "image-clause"); clause != nil {
		image = b.recipe(b.only(clause, "recipe"))
	}
	return
}

func (b *domBuilder) recipe(n *Node) *domTerm {
	r := &domTerm{Kind: tmConcat, At: b.at(n)}
	for _, atom := range b.some(n, "recipe-atom", 1) {
		for i := atom.Span[0]; i < atom.Span[1]; i++ {
			if b.toks[i].Value == "(" || b.toks[i].Value == ")" || b.toks[i].Value == "∪" || b.toks[i].Value == "∩" || b.toks[i].Value == "∖" || b.toks[i].Value == "⟹" {
				b.fail(atom, "a recipe uses no grouping or arguments")
			}
		}
		b.inRecipe = true
		t := b.term(b.only(atom, "term"))
		b.inRecipe = false
		items := []*domTerm{t}
		if t.Kind == tmConcat {
			items = t.Items
		}
		if len(r.Items) > 0 {
			b.fail(atom, "juxtaposed recipe strings require ++, use ++ between string atoms")
		}
		for _, t := range items {
			if t.Kind == tmUnion {
				b.fail(atom, "juxtaposed recipe strings require ++, use ++ between string atoms")
			}
			valid := stringTermShape(t)
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
	args        []*domTerm
	arguments   []*Node
}

func (f *methodFrame) resume(b *domBuilder, in any) readStep {
	if !f.started {
		f.started = true
		f.selectors = b.some(f.n, "method-selector", 1)
		return ask(&termFrame{n: b.only(b.only(f.n, "method-receiver"), "term-atom"), argument: true})
	}
	if f.receiver == nil {
		f.receiver = in.(*domTerm)
	} else if in != nil {
		f.args = append(f.args, in.(*domTerm))
	}
	selector := f.selectors[f.index]
	name := b.tokenValue(b.token(b.only(selector, "method-name")))
	if f.arguments == nil {
		f.arguments = []*Node{}
		if arguments := one(selector, "arguments"); arguments != nil {
			f.arguments = b.some(arguments, "argument", 1)
		}
	}
	if len(f.args) < len(f.arguments) {
		arg := f.arguments[len(f.args)]
		if integer := one(arg, "integer"); integer != nil {
			digits := b.tokenValue(b.token(integer))
			if !validInteger(digits) {
				b.fail(integer, "an integer argument is positive without leading zeros")
			}
			f.args = append(f.args, &domTerm{Kind: tmInteger, Str: digits})
			return f.resume(b, nil)
		}
		return ask(&termFrame{n: b.only(arg, "term"), argument: true})
	}
	if arguments := one(selector, "arguments"); arguments != nil {
		for _, p := range parts(arguments) {
			if p.Kind == KindToken && b.tokenValue(p) != map[bool]string{true: "|", false: ","}[boundaryMethod(name) || name == "matches" || name == "begins"] {
				b.fail(arguments, "invalid method argument separator")
			}
		}
		for i, a := range f.args {

			a.At = b.at(f.arguments[i])
		}
	}
	f.receiver = b.finishMethod(f.n, name, f.receiver, f.args, f.inCondition && f.index == len(f.selectors)-1)
	f.index++
	if f.index == len(f.selectors) {
		return give(f.receiver)
	}
	f.args, f.arguments = nil, nil
	return f.resume(b, nil)
}

func (b *domBuilder) finishMethod(n *Node, name string, receiver *domTerm, args []*domTerm, predicate bool) *domTerm {
	fail := func() { b.fail(n, "invalid receiver or arguments for .%s", name) }
	span := b.featureContext || isSpanTerm(receiver)
	valid := false
	switch name {
	case "value", "image", "source-text", "decomposed-source-text", "classes", "onward", "following-tokens", "first-token", "last-token", "tokens-after-first", "starts-input", "ends-input":
		valid = len(args) == 0 && span
		if b.inRecipe && receiver.Kind == tmCall && receiver.Str == "emitted" {
			valid = len(args) == 0 && (name == "value" || name == "image")
		}
	case "without-elision", "without-elision-except":
		if receiver.Kind != tmCapture && !b.featureContext {
			if name == "without-elision-except" {
				b.fail(n, ".without-elision-except requires a bare capture. Use $x.without-elision-except(f).onward.")
			}
			b.fail(n, ".without-elision requires a bare capture. Use $x.without-elision.onward.")
		}
		valid = name == "without-elision" && len(args) == 0 || name == "without-elision-except" && len(args) == 1 && args[0].Kind == tmRule
	case "verbatim-text", "emitted":
		valid = b.inRecipe && len(args) == 0 && receiver.Kind == tmCapture
	case "tags":
		valid = span && (len(args) == 0 || len(args) == 1 && args[0].Kind == tmRule)
	case "followed-by", "preceded-by":
		valid = (b.featureContext || receiver.Kind == tmCapture) && len(args) > 0
		for _, a := range args {
			if a.Kind == tmTag && isCapital(a.Str) {
				a.Kind = tmTerminal
			}
			valid = valid && (a.Kind == tmRule || a.Kind == tmTerminal) && !engineTag(a.Str)
		}
	case "matches", "begins":
		valid = span && len(args) > 0
		for _, a := range args {
			if a.Kind == tmTag && isCapital(a.Str) {
				a.Kind = tmTerminal
			}
			valid = valid && (a.Kind == tmRule || a.Kind == tmTerminal) && !engineTag(a.Str)
		}
	case "ngrams":
		valid = len(args) == 1 && (b.featureContext || b.isStringTerm(receiver)) && args[0].Kind == tmInteger && validInteger(args[0].Str)
	case "split":
		valid = len(args) == 1 && (b.featureContext || b.isStringTerm(receiver) && b.isStringTerm(args[0]))
	case "classify":
		valid = len(args) == 1 && (b.featureContext || b.isStringTerm(receiver)) && args[0].Kind == tmRule && classifierName.MatchString(args[0].Str)
		if valid {
			args[0] = &domTerm{Kind: tmClassifier, Str: args[0].Str}
		}
	default:
		b.fail(n, "unknown method .%s", name)
	}
	if !valid {
		fail()
	}
	if b.closedFor != "" && name != "split" && name != "ngrams" {
		b.fail(n, "%s requires a closed term", b.closedFor)
	}
	isPredicate := name == "starts-input" || name == "ends-input" || boundaryMethod(name) || name == "matches" || name == "begins"
	if isPredicate != predicate {
		b.fail(n, ".%s has the wrong result type here", name)
	}
	items := append([]*domTerm{receiver}, args...)
	if msg := literalCallProblem(name, items); msg != "" && !b.featureContext {
		b.fail(n, "%s", msg)
	}
	return &domTerm{Kind: tmCall, Str: name, Items: items, At: b.at(n)}
}
