package gencmu

import "strings"

func templateSyntax(root *Node) bool {
	pending := []*Node{root}
	for len(pending) > 0 {
		n := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		if n.Rule == "call" || n.Rule == "parameter" {
			return true
		}
		pending = append(pending, n.Children...)
	}
	return false
}

var templatePrimaries = append(append([]string{}, primaryRules...), "call", "parameter")
var templateAtoms = append(append([]string{}, atomRules...), "call", "parameter")

func (b *domBuilder) templateParameter(n *Node) templateObject {
	return templateObject{"param": strings.TrimPrefix(b.tokenValue(b.token(n)), "@"), "at": templatePosition(b.at(n))}
}
func (b *domBuilder) templateCall(n *Node) templateObject {
	args := []any{}
	for _, a := range b.some(n, "call-argument", 1) {
		p := b.knownOf(a, []string{"requirement-argument", "target-argument", "body-argument", "symbol-argument", "term"})
		var value templateObject
		switch p.Rule {
		case "requirement-argument":
			value = templateObject{"requirements": b.templateRequirements(p)}
		case "target-argument":
			targets := []any{}
			for _, t := range ruleParts(p) {
				switch t.Rule {
				case "reference":
					targets = append(targets, templateObject{"rule": b.tokenValue(b.token(t))})
				case "tag":
					targets = append(targets, templateObject{"terminal": b.tagOf(b.token(t))})
				case "call":
					targets = append(targets, b.templateCall(t))
				case "parameter":
					targets = append(targets, b.templateParameter(t))
				default:
					b.fail(t, "invalid target argument")
				}
			}
			value = templateObject{"targets": targets}
		case "body-argument", "symbol-argument":
			value = templateArgument(b.templateExpr(b.knownOf(p, templatePrimaries), true))
		default:
			value = b.templateTerm(p, true)
		}
		args = append(args, value)
	}
	return templateObject{"call": b.tokenValue(b.token(n)), "args": args, "at": templatePosition(b.at(n))}
}
func (b *domBuilder) templateDeclaration(n *Node) templateObject {
	switch n.Rule {
	case "rule":
		op := "define"
		switch b.tokenValue(b.token(b.only(n, "definer"))) {
		case "%redefine-rule":
			op = "redefine"
		case "%extend-rule":
			op = "extend"
		}
		r := templateObject{"op": op, "flags": []any{}, "conditions": []any{}, "at": templatePosition(b.at(n))}
		if name := one(n, "rule-name"); name != nil {
			r["name"] = b.tokenValue(b.token(name))
		} else {
			head := b.templateCall(b.only(n, "call"))
			r["name"] = head["call"]
			args := templateList(head["args"])
			params := []any{}
			for _, a := range args {
				if p := templateObj(a)["param"]; p != nil {
					params = append(params, p)
				}
			}
			if len(params) == len(args) {
				r["params"] = params
			} else {
				r["args"] = args
			}
		}
		if fs := one(n, "rule-flags"); fs != nil {
			for _, f := range b.some(fs, "rule-flag", 1) {
				r["flags"] = append(templateList(r["flags"]), b.tokenValue(b.token(f)))
			}
		}
		for _, p := range parts(n) {
			if p.Kind == KindToken && b.tokenValue(p) == "=" {
				r["instance"] = b.templateCall(b.only(n, "call"))
				return r
			}
		}
		b.templateClauses(n, "tags-clause", r)
		body := one(n, "body")
		if body == nil {
			body = b.only(n, "headed-body")
		}
		alts := []*Node{}
		if ranked := one(body, "ranked-alternative"); ranked != nil {
			alts = append(alts, ranked)
		} else {
			alts = b.some(body, "alternative", 1)
		}
		values := []any{}
		for _, a := range alts {
			b.braces = 0
			b.captureNodes = map[*domExpr]*Node{}
			b.marked = 0
			guards := []any{}
			for _, g := range ofRule(a, "guard") {
				guard := b.guard(g)
				guards = append(guards, templateObject{"feature": guard.Feature, "kind": guard.Kind, "negated": guard.Negated})
			}
			exprName := "conjunction"
			if a.Rule == "ranked-alternative" {
				exprName = "ranked-choice"
			}
			alt := templateObject{"guards": guards, "expr": b.templateExpr(b.only(a, exprName), true)}
			b.templateClauses(a, "alternative-tags", alt)
			values = append(values, alt)
		}
		r["alternatives"] = values
		if c := one(n, "conditions-clause"); c != nil {
			for _, p := range b.some(c, "implication", 1) {
				r["conditions"] = append(templateList(r["conditions"]), b.templateCondition(p))
			}
		}
		if c := one(n, "emits-clause"); c != nil {
			r["emit"] = b.templateEmission(c)
		}
		if one(n, "erased-clause") != nil {
			r["erased"] = true
		}
		return r
	case "constant-definition":
		op := "define"
		if b.tokenValue(b.token(b.only(n, "constant-definer"))) == "%redefine-const" {
			op = "redefine"
		}
		return templateObject{"name": strings.TrimPrefix(b.tokenValue(b.token(b.only(n, "constant-reference"))), "$"), "op": op, "value": b.templateTerm(b.only(n, "term"), false), "at": templatePosition(b.at(n))}
	case "implication-declaration":
		sides := b.some(n, "union", 2)
		return templateObject{"if": b.templateTerm(sides[0], false), "then": b.templateTerm(sides[1], false), "at": templatePosition(b.at(n))}
	case "directive":
		// Ordinary operand validation is shared with the closed reader.
		clone := *n
		clone.Children = nil
		for _, c := range n.Children {
			if !templateSyntax(c) {
				clone.Children = append(clone.Children, c)
			}
		}
		d := b.document(&Node{Kind: KindRule, Rule: "document", Children: []*Node{&clone}})
		if len(d.Directives) != 1 {
			b.fail(n, "a malformed directive")
		}
		r := templateWrittenDirective(d.Directives[0])
		if c := one(n, "conditions-clause"); c != nil {
			conditions := []any{}
			for _, p := range b.some(c, "implication", 1) {
				conditions = append(conditions, b.templateCondition(p))
			}
			r["conditions"] = conditions
		}
		return r
	}
	b.fail(n, "unexpected %s with parameters", n.Rule)
	return nil
}
func (b *domBuilder) templateClauses(n *Node, tagName string, out templateObject) {
	if p := one(n, tagName); p != nil {
		out["tags"] = b.templateTerm(b.only(p, "term"), false)
	}
	for _, key := range []string{"value", "image"} {
		if p := one(n, key+"-clause"); p != nil {
			out[key] = b.templateRecipe(b.only(p, "recipe"))
		}
	}
}
func (b *domBuilder) templateRecipe(n *Node) templateObject {
	if !templateSyntax(n) {
		return templateSourceTerm(b.recipe(n))
	}
	for i := n.Span[0]; i < n.Span[1]; i++ {
		v := b.toks[i].Value
		if v == "(" || v == ")" || v == "∪" || v == "∩" || v == "∖" || v == "⟹" {
			b.fail(n, "a recipe uses no grouping or arguments")
		}
	}
	atoms := b.some(n, "recipe-atom", 1)
	if len(atoms) != 1 {
		b.fail(n, "juxtaposed recipe strings require ++, use ++ between string atoms")
	}
	return templateObject{"concat": []any{b.templateTerm(b.only(atoms[0], "term"), false)}}
}
func (b *domBuilder) templateExpr(n *Node, whole bool) (result templateObject) {
	defer func() {
		if result != nil {
			templateLocate(result, b.at(n))
		}
	}()
	if !templateSyntax(n) {
		return templateSourceExpr(b.exprIn(n, whole))
	}
	switch n.Rule {
	case "call":
		return b.templateCall(n)
	case "parameter":
		return b.templateParameter(n)
	case "choice", "ranked-choice", "conjunction", "sequence":
		if n.Rule == "choice" {
			if c := one(n, "ranked-choice"); c != nil {
				return b.templateExpr(c, false)
			}
		}
		kind := map[string]string{"choice": "choice", "ranked-choice": "ranked", "conjunction": "and", "sequence": "seq"}[n.Rule]
		part := map[string]string{"choice": "conjunction", "ranked-choice": "conjunction", "conjunction": "sequence", "sequence": "primary"}[n.Rule]
		xs := b.some(n, part, 1)
		if kind == "and" && len(xs) > maxAnd {
			b.fail(n, "an & joins at most %d items", maxAnd)
		}
		values := []any{}
		for _, p := range xs {
			if kind == "seq" {
				p = b.knownOf(p, templatePrimaries)
			}
			values = append(values, b.templateExpr(p, whole && kind != "choice" && kind != "ranked" && len(xs) == 1))
		}
		if len(values) == 1 {
			return templateObj(values[0])
		}
		return templateObject{kind: values}
	case "group":
		return b.templateExpr(b.only(n, "choice"), false)
	case "capture":
		if b.braces > 0 || b.marked > 0 {
			b.fail(n, "a capture cannot stand inside braces or an elidable optional")
		}
		name := strings.TrimPrefix(b.tokenValue(b.token(n)), "$")
		if !captureName.MatchString(name) {
			b.fail(n, "a capture's name is all lower case")
		}
		return templateObject{"capture": name, "expr": b.templateExpr(b.knownOf(b.only(n, "primary"), templatePrimaries), false)}
	case "optional":
		c := b.only(n, "choice")
		markers := 0
		for _, p := range parts(n) {
			if p.Kind == KindToken && b.tokenValue(p) == "+" {
				markers++
			}
		}
		if markers > 1 {
			b.fail(n, "an optional has one marker + at most")
		}
		if markers == 1 {
			cs := ofRule(c, "conjunction")
			if len(cs) != 1 {
				b.fail(n, "an elidable optional requires one sequence")
			}
			for _, part := range append(parts(c), parts(cs[0])...) {
				if part.Kind == KindToken && (b.tokenValue(part) == "|" || b.tokenValue(part) == "&") {
					b.fail(n, "an elidable optional requires one sequence without a leading separator")
				}
			}
			ss := ofRule(cs[0], "sequence")
			if len(ss) != 1 {
				b.fail(n, "an elidable optional requires one sequence")
			}
			ps := b.some(ss[0], "primary", 1)
			head := b.knownOf(ps[0], templatePrimaries)
			if head.Rule == "tested" {
				head = b.templateTestBase(head)
			}
			if head.Rule != "parameter" && (head.Rule != "tag" && head.Rule != "reference" || !className.MatchString(b.tokenValue(b.token(head)))) {
				b.fail(n, "an elidable optional begins with a bare user tag or parameter")
			}
			b.marked++
		}
		r := templateObject{"optional": b.templateExpr(c, false)}
		if markers == 1 {
			b.marked--
			r["elidable"] = true
		}
		return r
	case "repetition":
		cs := b.some(n, "choice", 1)
		chain := ""
		marker := -1
		first := -1
		second := -1
		for i, p := range parts(n) {
			if p == cs[0] {
				first = i
			}
			if len(cs) > 1 && p == cs[1] {
				second = i
			}
			if p.Kind == KindToken && b.tokenValue(p) == "..." {
				if marker >= 0 {
					b.fail(n, "braces have one chain marker ... at most")
				}
				marker = i
			}
		}
		if marker >= 0 {
			if second >= 0 && marker > second {
				b.fail(n, "a separator has no chain marker")
			}
			if !whole {
				b.fail(n, "a chain is the whole expression of its alternative")
			}
			chain = "right"
			if marker < first {
				chain = "left"
			}
		}
		b.braces++
		r := templateObject{"repeat": b.templateExpr(cs[0], false)}
		if len(cs) > 1 {
			r["separator"] = b.templateExpr(cs[1], false)
		}
		b.braces--
		if chain != "" {
			r["chain"] = chain
		}
		return r
	case "tested":
		base := b.templateTestBase(n)
		tests := []*Node{}
		for _, p := range ruleParts(n) {
			if p.Rule == "tag-test" || p.Rule == "value-test" {
				tests = append(tests, p)
			}
		}
		return b.templateTests(b.templateExpr(base, false), tests)
	case "range":
		ends := []any{}
		for _, p := range ruleParts(n) {
			if p.Rule == "string" || p.Rule == "constant-reference" || p.Rule == "parameter" {
				ends = append(ends, b.templateTerm(p, false))
			}
		}
		return templateObject{"range": ends}
	}
	b.fail(n, "unexpected %s in an expression", n.Rule)
	return nil
}
func (b *domBuilder) templateTestBase(n *Node) *Node {
	if p := one(n, "primary"); p != nil {
		return b.knownOf(p, templatePrimaries)
	}
	for _, p := range ruleParts(n) {
		for _, k := range templatePrimaries {
			if p.Rule == k && k != "tested" {
				return p
			}
		}
	}
	b.lacks(n, "base symbol")
	return nil
}
func (b *domBuilder) templateRequirements(n *Node) []any {
	out := []any{}
	for _, r := range ofRule(n, "tag-requirement") {
		negated := false
		for _, p := range parts(r) {
			if p.Kind == KindToken && b.tokenValue(p) == "¬" {
				negated = true
			}
		}
		value := b.templateTerm(b.knownOf(b.only(r, "test-operand"), templateAtoms), false)
		out = append(out, templateObject{"negated": negated, "value": value})
	}
	return out
}
func (b *domBuilder) templateTests(expr templateObject, tests []*Node) templateObject {
	seen := map[string]bool{}
	for _, t := range tests {
		if seen[t.Rule] || t.Rule == "tag-test" && seen["value-test"] {
			b.fail(t, "invalid test target or test order")
		}
		seen[t.Rule] = true
		if t.Rule == "tag-test" {
			expr = templateObject{"test": "tags", "expr": expr, "requirements": b.templateRequirements(t)}
		} else {
			expr = templateObject{"test": b.operator(b.token(b.only(t, "test"))), "expr": expr, "value": b.templateTerm(b.knownOf(b.only(t, "test-operand"), templateAtoms), false)}
		}
	}
	return expr
}
func (b *domBuilder) templateTerm(n *Node, argument bool) (result templateObject) {
	defer func() {
		if result != nil {
			templateLocate(result, b.at(n))
		}
	}()
	if !templateSyntax(n) {
		return templateSourceTerm(b.termIn(n, argument))
	}
	switch n.Rule {
	case "parameter":
		return b.templateParameter(n)
	case "call":
		return b.templateCall(n)
	case "term":
		return b.templateTerm(b.knownOf(n, termRules), argument)
	case "term-atom":
		return b.templateTerm(b.knownOf(n, templateAtoms), argument)
	case "union", "intersection", "concatenation":
		part := map[string]string{"union": "intersection", "intersection": "concatenation", "concatenation": "term-atom"}[n.Rule]
		ps := b.some(n, part, 1)
		if len(ps) == 1 {
			return b.templateTerm(ps[0], argument)
		}
		items := []any{}
		for _, p := range ps {
			items = append(items, b.templateTerm(p, false))
		}
		if n.Rule != "union" {
			key := n.Rule
			if key == "concatenation" {
				key = "concat"
			}
			return templateJoined(key, items)
		}
		ops := []string{}
		for _, p := range parts(n) {
			if p.Kind == KindToken {
				op := b.tokenValue(p)
				if op == "∪" || op == "∖" {
					ops = append(ops, op)
				}
			}
		}
		ops = ops[len(ops)-len(items)+1:]
		r := templateObj(items[0])
		for i, op := range ops {
			key := "union"
			if op == "∖" {
				key = "difference"
			}
			r = templateJoined(key, []any{r, items[i+1]})
		}
		return r
	case "guarded-term":
		r := b.templateTerm(b.only(n, "term"), argument)
		cs := ofRule(n, "implication")
		for i := len(cs) - 1; i >= 0; i-- {
			r = templateObject{"if": b.templateCondition(cs[i]), "then": r}
		}
		return r
	case "method":
		return b.templateMethod(n)
	case "pattern-literal":
		var p *Node
		if p = one(n, "pattern-union"); p == nil {
			p = b.only(n, "pattern-atom")
		}
		return templateObject{"pattern": templatePatternNode(b.templatePattern(p))}
	}
	b.fail(n, "unexpected %s in a term", n.Rule)
	return nil
}
func (b *domBuilder) templateMethod(n *Node) templateObject {
	r := b.templateTerm(b.only(b.only(n, "method-receiver"), "term-atom"), true)
	for _, s := range b.some(n, "method-selector", 1) {
		name := b.tokenValue(b.token(b.only(s, "method-name")))
		args := []any{}
		if a := one(s, "arguments"); a != nil {
			for _, p := range b.some(a, "argument", 1) {
				if integer := one(p, "integer"); integer != nil {
					args = append(args, templateObject{"integer": b.tokenValue(b.token(integer))})
				} else {
					arg := b.templateTerm(b.only(p, "term"), true)
					if name == "classify" && arg["rule"] != nil {
						arg = templateObject{"classifier": arg["rule"]}
					}
					if (name == "matches" || name == "begins" || boundaryMethod(name)) && arg["tag"] != nil && !engineTag(templateText(arg["tag"])) {
						arg = templateObject{"terminal": arg["tag"]}
					}
					templateLocate(arg, b.at(p))
					args = append(args, arg)
				}
			}
			for _, p := range parts(a) {
				if p.Kind == KindToken && b.tokenValue(p) != map[bool]string{true: "|", false: ","}[boundaryMethod(name) || name == "matches" || name == "begins"] {
					b.fail(a, "invalid method argument separator")
				}
			}
		}
		r = templateObject{"method": name, "receiver": r, "args": args}
		templateLocate(r, b.at(n))
	}
	return r
}
func (b *domBuilder) templateCondition(n *Node) (result templateObject) {
	defer func() {
		if result != nil {
			templateLocate(result, b.at(n))
		}
	}()
	if !templateSyntax(n) {
		return templateSourceCond(b.implication(n))
	}
	switch n.Rule {
	case "condition":
		return b.templateCondition(b.knownOf(n, conditionRules))
	case "implication":
		xs := b.some(n, "any-of", 1)
		r := b.templateCondition(xs[len(xs)-1])
		for i := len(xs) - 2; i >= 0; i-- {
			r = templateObject{"if": b.templateCondition(xs[i]), "then": r}
		}
		return r
	case "any-of", "all-of":
		key := "any"
		part := "all-of"
		if n.Rule == "all-of" {
			key = "all"
			part = "condition"
		}
		xs := b.some(n, part, 1)
		if len(xs) == 1 {
			return b.templateCondition(xs[0])
		}
		out := []any{}
		for _, x := range xs {
			out = append(out, b.templateCondition(x))
		}
		return templateJoined(key, out)
	case "negation":
		return templateObject{"not": b.templateCondition(b.only(n, "condition"))}
	case "comparison":
		ps := b.some(n, "union", 2)
		return templateObject{"op": b.operator(b.token(b.only(n, "comparator"))), "left": b.templateTerm(ps[0], false), "right": b.templateTerm(ps[1], false)}
	case "tree-comparison":
		return templateObject{"op": b.operator(b.token(b.only(n, "tree-comparator"))), "left": templateObject{"capture": strings.TrimPrefix(b.tokenValue(b.token(b.only(n, "capture-reference"))), "$")}, "right": b.templateTerm(b.only(n, "union"), false)}
	case "method":
		return b.templateMethod(n)
	}
	b.fail(n, "unexpected %s in a condition", n.Rule)
	return nil
}
func templatePatternNode(p templateObject) templateObject {
	if n := p["node"]; n != nil {
		return templateObj(n)
	}
	return templateObject{"children": p}
}
func (b *domBuilder) templatePattern(n *Node) templateObject {
	if !templateSyntax(n) {
		return templateWrittenPattern(b.readPattern(n))
	}
	switch n.Rule {
	case "pattern-union", "pattern-intersection":
		part := "pattern-intersection"
		if n.Rule == "pattern-intersection" {
			part = "pattern-sequence"
		}
		ps := b.some(n, part, 1)
		r := b.templatePattern(ps[0])
		if len(ps) == 1 {
			return r
		}
		ops := []string{}
		for _, p := range parts(n) {
			if p.Kind == KindToken {
				ops = append(ops, b.tokenValue(p))
			}
		}
		r = templatePatternNode(r)
		for i, p := range ps[1:] {
			key := "union"
			if n.Rule == "pattern-intersection" {
				key = "intersection"
			} else if i < len(ops) && ops[i] == "∖" {
				key = "difference"
			}
			r = templateJoined(key, []any{r, templatePatternNode(b.templatePattern(p))})
		}
		return templateObject{"node": r}
	case "pattern-sequence":
		ps := b.some(n, "pattern-item", 1)
		if len(ps) == 1 {
			return b.templatePattern(ps[0])
		}
		xs := []any{}
		for _, p := range ps {
			child := b.templatePattern(p)
			if nested := templateList(child["sequence"]); nested != nil {
				xs = append(xs, nested...)
			} else {
				xs = append(xs, child)
			}
		}
		return templateObject{"sequence": xs}
	case "pattern-item":
		ps := ruleParts(n)
		if len(ps) == 0 {
			return templateObject{"siblings": true}
		}
		return b.templatePattern(ps[0])
	case "pattern-brackets":
		return templateObject{"optional": b.templatePattern(b.only(n, "pattern-union"))}
	case "pattern-repeat":
		ps := b.some(n, "pattern-union", 1)
		r := templateObject{"repeat": b.templatePattern(ps[0])}
		if len(ps) > 1 {
			r["separator"] = b.templatePattern(ps[1])
		}
		return r
	case "pattern-path":
		return templateObject{"node": templateObject{"path": map[string]string{"⋮": "descendant", "⋰": "first", "⋱": "last"}[b.tokenValue(b.token(n))], "pattern": templatePatternNode(b.templatePattern(b.only(n, "pattern-atom")))}}
	case "pattern-atom":
		first := parts(n)[0]
		if first.Kind == KindToken && b.tokenValue(first) == "(" {
			return b.templatePattern(b.only(n, "pattern-union"))
		}
		if first.Rule == "pattern-literal" {
			p := one(first, "pattern-union")
			if p == nil {
				p = b.only(first, "pattern-atom")
			}
			return templateObject{"node": templateObject{"children": b.templatePattern(p)}}
		}
		var r templateObject
		if first.Rule == "parameter" {
			r = b.templateParameter(first)
		} else if first.Rule == "call" {
			r = b.templateCall(first)
		} else {
			r = templateWrittenPattern(b.patternAtom(n, first))
			return templateObject{"node": r}
		}
		tests := []*Node{}
		for _, p := range ruleParts(n) {
			if p.Rule == "tag-test" || p.Rule == "value-test" {
				tests = append(tests, p)
			}
		}
		r = b.templateTests(r, tests)
		return templateObject{"node": r}
	}
	b.fail(n, "unexpected %s in a pattern", n.Rule)
	return nil
}
func (b *domBuilder) templateEmission(n *Node) templateObject {
	// A closed item retains the ordinary reader's recipe and capture checks.
	if !templateSyntax(n) {
		w := &jsonWriter{}
		b.emission(n).writeJSON(w)
		r, e := templateFromJSON(w.buf)
		if e != nil {
			panic(e)
		}
		return r
	}
	items := []any{}
	parts := ofRule(n, "emit-item")
	if len(parts) == 0 {
		r := templateObject{"capture": ""}
		b.templateClauses(n, "emit-tags", r)
		items = append(items, r)
	}
	for _, p := range parts {
		target := b.only(p, "emit-target")
		text := b.tokenValue(target)
		if text == "" {
			text = b.tokenValue(b.token(target))
		}
		r := templateObject{}
		if strings.HasPrefix(text, "$") {
			r["capture"] = strings.TrimPrefix(text, "$")
		} else if text == "ε" {
			r["insert"] = true
		} else {
			b.fail(p, "an emission target requires a capture or ε")
		}
		b.templateClauses(p, "emit-tags", r)
		for _, key := range []string{"before", "after"} {
			names := []any{}
			for _, attachment := range ofRule(p, "emit-"+key) {
				for _, capture := range b.some(attachment, "capture-reference", 1) {
					names = append(names, b.attachment(capture))
				}
			}
			if len(names) > 0 {
				r[key] = names
			}
		}
		items = append(items, r)
	}
	return templateObject{"items": items}
}
