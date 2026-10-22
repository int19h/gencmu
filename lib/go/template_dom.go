package gencmu

import (
	"fmt"
	"strings"
)

func templateWrittenDirective(d *domDirective) templateObject {
	doc := &domDoc{Directives: []*domDirective{d}}
	raw, e := templateFromJSON(doc.json())
	if e != nil {
		panic(e)
	}
	return templateObj(templateList(raw["directives"])[0])
}
func templateWrittenPattern(p *domPattern) templateObject {
	w := &jsonWriter{}
	w.pattern(p)
	r, e := templateFromJSON(w.buf)
	if e != nil {
		panic(e)
	}
	return r
}
func appendTemplateDeclaration(d *domDoc, kind string, r templateObject) error {
	at := templateAt(r)
	if at == [2]int{} {
		return fmt.Errorf("a declaration requires a position")
	}
	switch kind {
	case "rule", "rules":
		flags := []string{}
		for _, v := range templateList(r["flags"]) {
			flags = append(flags, templateText(v))
		}
		d.Rules = append(d.Rules, &domRule{Name: templateText(r["name"]), Op: templateText(r["op"]), Flags: flags, At: at, Conditions: []*domCond{}, rawTemplate: r})
	case "constant-definition", "constants":
		d.Constants = append(d.Constants, &domConst{Name: templateText(r["name"]), Op: templateText(r["op"]), At: at, rawTemplate: r})
	case "directive", "directives":
		args := []string{}
		for _, v := range templateList(r["args"]) {
			s, ok := v.(string)
			if !ok {
				return fmt.Errorf("a malformed directive")
			}
			args = append(args, s)
		}
		dir := &domDirective{Name: templateText(r["name"]), Args: args, At: at, rawTemplate: r}
		if r["conditions"] != nil {
			dir.Conditions = []*domCond{{}}
		}
		d.Directives = append(d.Directives, dir)
	case "implication-declaration", "implications":
		d.Implications = append(d.Implications, &domImplication{At: at, rawTemplate: r})
	default:
		return fmt.Errorf("unexpected unresolved declaration %s", kind)
	}
	return nil
}
func decodeTemplateDOM(root templateObject, uni *unicodeTable) (*domDoc, error) {
	if root["format"] != float64(domFormat) {
		return nil, fmt.Errorf("unsupported DOM format")
	}
	closed := templateCopy(root)
	d := &domDoc{}
	for _, kind := range []string{"rules", "constants", "directives", "classifiers", "implications"} {
		items, ok := root[kind].([]any)
		if !ok {
			return nil, fmt.Errorf("not a DOM of format %d", domFormat)
		}
		closed[kind] = []any{}
		for _, item := range items {
			r := templateObj(item)
			if r == nil {
				return nil, fmt.Errorf("a malformed declaration")
			}
			if templateUnresolved(r) {
				if err := appendTemplateDeclaration(d, kind, r); err != nil {
					return nil, err
				}
			} else {
				closed[kind] = append(templateList(closed[kind]), item)
			}
		}
	}
	ordinary, err := decodeDOMMode(templateJSON(closed), uni, true)
	if err != nil {
		return nil, err
	}
	d.Rules = append(d.Rules, ordinary.Rules...)
	d.Constants = append(d.Constants, ordinary.Constants...)
	d.Directives = append(d.Directives, ordinary.Directives...)
	d.Classifiers = ordinary.Classifiers
	d.Implications = append(d.Implications, ordinary.Implications...)
	if err = validateDOM(d, uni); err != nil {
		return nil, err
	}
	return d, nil
}
func templateOnly(n templateObject, keys ...string) bool {
	if templateLen(n) != len(keys) {
		return false
	}
	for _, k := range keys {
		if _, ok := n[k]; !ok {
			return false
		}
	}
	return true
}
func templateAllowed(n templateObject, keys ...string) bool {
	for k := range n {
		if k == templateSourceKey {
			continue
		}
		found := false
		for _, v := range keys {
			if k == v {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}
func templateArray(n templateObject, key string, min int) bool {
	v, ok := n[key].([]any)
	return ok && len(v) >= min
}
func templateNamed(v any, uni *unicodeTable) bool {
	s, ok := v.(string)
	return ok && (classifierName.MatchString(s) || uni.isEmojiName(s))
}
func checkTemplateDeclaration(r templateObject, kind string, uni *unicodeTable) *domProblem {
	problem := func(s string) *domProblem {
		return &domProblem{message: s, at: templateAt(r), tooDeep: s == errTooDeep.Error()}
	}
	scope := map[string]bool{}
	if kind == "rules" {
		if !templateNamed(r["name"], uni) {
			return problem("a malformed rule name")
		}
		op := templateText(r["op"])
		if op != "define" && op != "redefine" && op != "extend" {
			return problem("a malformed rule operation")
		}
		if ps, exists := r["params"]; exists {
			params, ok := ps.([]any)
			if !ok || len(params) == 0 || r["args"] != nil {
				return problem("malformed template parameters")
			}
			for _, p := range params {
				s, ok := p.(string)
				if !ok || !domName.MatchString(s) || scope[s] {
					return problem("malformed template parameters")
				}
				scope[s] = true
			}
		}
	}
	for _, node := range templateNodes(r) {
		if p, ok := node["param"]; ok {
			if !templateOnly(node, "param", "at") || !scope[templateText(p)] || templateAt(node) == [2]int{} {
				p := problem("an undeclared or malformed parameter")
				if at := templateAt(node); at != [2]int{} {
					p.at = at
				}
				return p
			}
		}
	}
	walk := func(n any, k string, whole bool) *domProblem {
		if msg := templateNodeProblem(n, k, 0, whole, false, uni); msg != "" {
			return problem(msg)
		}
		return nil
	}
	switch kind {
	case "rules":
		flags, ok := r["flags"].([]any)
		if !ok || len(flags) > 1 || len(flags) == 1 && (flags[0] != "fewest" && flags[0] != "leftmost-longest" || r["op"] == "extend") {
			return problem("a malformed rule flag list")
		}
		if r["instance"] != nil {
			if !templateOnly(r, "name", "op", "flags", "instance", "conditions", "at") || r["op"] == "extend" || len(flags) != 0 || !templateArray(r, "conditions", 0) || len(templateList(r["conditions"])) != 0 {
				return problem("a malformed instance binding")
			}
			return walk(r["instance"], "call", false)
		}
		if args, exists := r["args"]; exists {
			if r["op"] == "define" {
				return problem("an instance head requires an edit")
			}
			if p := walk(templateObject{"call": r["name"], "args": args, "at": r["at"]}, "call", false); p != nil {
				return p
			}
		}
		if !templateAllowed(r, "name", "params", "args", "op", "flags", "tags", "value", "image", "alternatives", "emit", "conditions", "erased", "at") || !templateArray(r, "alternatives", 1) || !templateArray(r, "conditions", 0) {
			return problem("a malformed rule")
		}
		if r["erased"] != nil && (r["erased"] != true || r["emit"] != nil || r["value"] != nil || r["image"] != nil) {
			return problem("a malformed erased rule")
		}
		clauses := func(x templateObject) *domProblem {
			for _, key := range []string{"tags", "value", "image"} {
				if x[key] != nil {
					k := "recipe"
					if key == "tags" {
						if msg := templateTagClauseProblem(x[key], x["capture"] == nil && x["insert"] == nil); msg != "" {
							return problem(msg)
						}
						k = "tags"
					}
					if p := walk(x[key], k, false); p != nil {
						return p
					}
				}
			}
			return nil
		}
		if p := clauses(r); p != nil {
			return p
		}
		for _, c := range templateList(r["conditions"]) {
			if p := walk(c, "condition", false); p != nil {
				return p
			}
		}
		for _, a := range templateList(r["alternatives"]) {
			alt := templateObj(a)
			if !templateAllowed(alt, "guards", "expr", "tags", "value", "image") || !templateArray(alt, "guards", 0) {
				return problem("a malformed alternative")
			}
			for _, g := range templateList(alt["guards"]) {
				guard := templateObj(g)
				neg, ok := guard["negated"].(bool)
				if !templateOnly(guard, "feature", "kind", "negated") || !ok || !nameSyntaxFeature.MatchString(templateText(guard["feature"])) || guard["kind"] != FeatureGate && (guard["kind"] != FeatureWarning || neg) {
					return problem("a malformed guard")
				}
			}
			if p := walk(alt["expr"], "expr", true); p != nil {
				return p
			}
			if len(duplicateCaptures(templateCaptureShape(templateObj(alt["expr"])))) > 0 {
				return problem("a capture name used twice in one production")
			}
			if r["erased"] == true && (alt["value"] != nil || alt["image"] != nil) {
				return problem("an erased rule has a recipe")
			}
			if p := clauses(alt); p != nil {
				return p
			}
		}
		if r["emit"] != nil {
			emit := templateObj(r["emit"])
			if !templateOnly(emit, "items") || !templateArray(emit, "items", 1) {
				return problem("a malformed emission")
			}
			listed := map[string]bool{}
			for _, it := range templateList(emit["items"]) {
				item := templateObj(it)
				if !templateAllowed(item, "capture", "insert", "tags", "value", "image", "before", "after") {
					return problem("a malformed emission item")
				}
				if item["insert"] != nil {
					if item["insert"] != true || item["capture"] != nil || item["before"] != nil || item["after"] != nil {
						return problem("a malformed insertion")
					}
				} else if s, ok := item["capture"].(string); !ok || s != "" && !captureName.MatchString(s) {
					return problem("a malformed carrier")
				}
				for _, side := range []string{"before", "after"} {
					if item[side] != nil {
						if templateText(item["capture"]) == "" || !templateArray(item, side, 1) {
							return problem("a malformed attachment")
						}
						for _, name := range templateList(item[side]) {
							if !captureName.MatchString(templateText(name)) {
								return problem("a malformed attachment")
							}
							if listed[templateText(name)] {
								return problem("an emission lists a capture twice")
							}
							listed[templateText(name)] = true
						}
					}
				}
				if name := templateText(item["capture"]); name != "" {
					if listed[name] {
						return problem("an emission lists a capture twice")
					}
					listed[name] = true
				}
				if p := clauses(item); p != nil {
					return p
				}
			}
		}
	case "constants":
		if !templateOnly(r, "name", "op", "value", "at") || !constName.MatchString(templateText(r["name"])) || r["op"] != "define" && r["op"] != "redefine" {
			return problem("a malformed constant")
		}
		if p := templateClosedProblem(r["value"]); p != "" {
			return problem(p)
		}
		return walk(r["value"], "term", false)
	case "implications":
		if !templateOnly(r, "if", "then", "at") {
			return problem("a malformed implication")
		}
		for _, key := range []string{"if", "then"} {
			if p := templateClosedProblem(r[key]); p != "" {
				return problem(p)
			}
			if p := walk(r[key], "tags", false); p != nil {
				return p
			}
		}
	case "directives":
		if !templateAllowed(r, "name", "args", "at", "conditions") || r["name"] != "features" || !templateArray(r, "conditions", 1) {
			return problem("malformed feature conditions")
		}
		for _, c := range templateList(r["conditions"]) {
			if p := walk(c, "condition", false); p != nil {
				return p
			}
		}
	}
	return nil
}
func templateClosedProblem(root any) string {
	for _, n := range templateNodes(root) {
		if n["capture"] != nil || n["captured"] != nil || strings.HasPrefix(templateText(n["tag"]), "_") {
			return "a closed declaration requires a closed term without engine-tag literals"
		}
	}
	return ""
}
func templateNodeProblem(value any, kind string, depth int, whole, sealed bool, uni *unicodeTable) string {
	if depth > maxDOMDepth {
		return errTooDeep.Error()
	}
	n := templateObj(value)
	if n == nil {
		return "a malformed " + kind
	}
	walk := func(v any, k string) string { return templateNodeProblem(v, k, depth+1, false, sealed, uni) }
	list := func(key, k string, min int) string {
		if !templateArray(n, key, min) {
			return "a malformed " + kind
		}
		for _, v := range templateList(n[key]) {
			if p := walk(v, k); p != "" {
				return p
			}
		}
		return ""
	}
	if n["param"] != nil {
		if !templateOnly(n, "param", "at") || !domName.MatchString(templateText(n["param"])) || templateAt(n) == [2]int{} {
			return "an undeclared or malformed parameter"
		}
		return ""
	}
	if n["call"] != nil || kind == "call" {
		if !templateOnly(n, "call", "args", "at") || !templateNamed(n["call"], uni) || templateAt(n) == [2]int{} {
			return "a malformed call"
		}
		return list("args", "arg", 1)
	}
	if kind == "arg" {
		for _, part := range templateNodes(n) {
			if part["capture"] != nil || part["captured"] != nil {
				return "an argument cannot read or declare captures"
			}
		}
		if n["body"] != nil {
			if !templateOnly(n, "body") {
				return "a malformed body argument"
			}
			return templateNodeProblem(n["body"], "expr", depth, true, false, uni)
		}
		if n["targets"] != nil {
			if !templateOnly(n, "targets") {
				return "a malformed target choice"
			}
			return list("targets", "target", 2)
		}
		if n["requirements"] != nil {
			if !templateOnly(n, "requirements") {
				return "a malformed requirement list"
			}
			return templateRequirementProblem(n["requirements"], depth, uni)
		}
		if n["rule"] != nil {
			if !templateOnly(n, "rule") || !templateNamed(n["rule"], uni) {
				return "a malformed nominal rule argument"
			}
			return ""
		}
		if n["test"] != nil || n["range"] != nil || n["wildcard"] != nil {
			kind = "expr"
		} else {
			kind = "term"
		}
	}
	if kind == "target" {
		if templateOnly(n, "rule") && templateNamed(n["rule"], uni) || templateOnly(n, "terminal") && className.MatchString(templateText(n["terminal"])) {
			return ""
		}
		return "a malformed query target"
	}
	if !templateUnresolved(n) {
		c := &domChecker{uni: uni, deferTypes: true}
		raw := templateJSON(n)
		var err error
		switch kind {
		case "expr":
			var e *domExpr
			e, err = decodeExpr(raw)
			if err == nil {
				c.expr(e, depth, whole, sealed)
			}
		case "condition":
			var e *domCond
			e, err = decodeCond(raw)
			if err == nil {
				c.condition(e, depth)
			}
		case "pattern", "pattern-children":
			var e *domPattern
			e, err = decodePattern(raw, kind == "pattern-children", depth)
			if err == nil {
				if p := patternProblem(e, depth, nil); p != "" {
					return p
				}
			}
		default:
			var e *domTerm
			e, err = decodeTerm(raw)
			if err == nil {
				switch kind {
				case "recipe":
					c.recipe(e)
				case "tags":
					c.constituentTags(e)
				default:
					c.term(e, depth, false)
				}
			}
		}
		if err != nil {
			return err.Error()
		}
		if c.problem != nil {
			return c.problem.message
		}
		return ""
	}
	if kind == "expr" {
		for _, key := range []string{"seq", "choice", "ranked", "and"} {
			if n[key] != nil {
				if !templateOnly(n, key) || key == "and" && len(templateList(n[key])) > maxAnd {
					return "a malformed expression"
				}
				return list(key, "expr", 2)
			}
		}
		if n["optional"] != nil {
			if !templateAllowed(n, "optional", "elidable") || n["elidable"] != nil && (n["elidable"] != true || !templateElidableHead(templateObj(n["optional"]))) {
				return "a malformed optional"
			}
			return templateNodeProblem(n["optional"], "expr", depth+1, false, sealed || n["elidable"] == true, uni)
		}
		if n["repeat"] != nil {
			if !templateAllowed(n, "repeat", "separator", "chain") || n["chain"] != nil && (!whole || n["chain"] != "left" && n["chain"] != "right") {
				return "a malformed repetition"
			}
			if p := templateNodeProblem(n["repeat"], "expr", depth+1, false, true, uni); p != "" {
				return p
			}
			if n["separator"] != nil {
				return templateNodeProblem(n["separator"], "expr", depth+1, false, true, uni)
			}
			return ""
		}
		if n["capture"] != nil {
			if !templateOnly(n, "capture", "expr") || sealed || (!captureName.MatchString(templateText(n["capture"])) || !templateSymbol(templateObj(n["expr"]))) {
				return "a malformed capture"
			}
			return walk(n["expr"], "expr")
		}
	}
	if n["test"] != nil {
		if kind == "expr" && !templateSymbol(n) {
			return "a malformed test"
		}
		if n["test"] == "tags" {
			if !templateOnly(n, "test", "expr", "requirements") {
				return "a malformed tag test"
			}
			if p := templateRequirementProblem(n["requirements"], depth, uni); p != "" {
				return p
			}
		} else {
			if !templateOnly(n, "test", "expr", "value") || n["test"] != "=" && n["test"] != "≠" {
				return "a malformed value test"
			}
			if p := walk(n["value"], "string"); p != "" {
				return p
			}
		}
		return walk(n["expr"], kind)
	}
	if n["range"] != nil {
		if !templateOnly(n, "range") || len(templateList(n["range"])) != 2 {
			return "a malformed range"
		}
		for _, v := range templateList(n["range"]) {
			if p := templateNodeProblem(v, "string", depth, false, false, uni); p != "" {
				return p
			}
		}
		return ""
	}
	if n["literal"] != nil {
		if !templateOnly(n, "literal") {
			return "a malformed literal"
		}
		return templateNodeProblem(n["literal"], "string", depth, false, false, uni)
	}
	if kind == "recipe" {
		if !templateOnly(n, "concat") {
			return "a malformed recipe"
		}
		return list("concat", "term", 1)
	}
	if kind == "pattern-children" {
		if n["node"] != nil {
			if !templateOnly(n, "node") {
				return "a malformed pattern"
			}
			return walk(n["node"], "pattern")
		}
		if n["sequence"] != nil {
			if !templateOnly(n, "sequence") {
				return "a malformed pattern"
			}
			return list("sequence", "pattern-children", 2)
		}
		for _, key := range []string{"optional", "repeat"} {
			if n[key] != nil {
				if key == "optional" && !templateOnly(n, key) || key == "repeat" && !templateAllowed(n, key, "separator") {
					return "a malformed pattern"
				}
				if p := walk(n[key], "pattern-children"); p != "" {
					return p
				}
				if n["separator"] != nil {
					return walk(n["separator"], "pattern-children")
				}
				return ""
			}
		}
		return "a malformed pattern"
	}
	if kind == "pattern" {
		if n["children"] != nil {
			if !templateOnly(n, "children") {
				return "a malformed pattern"
			}
			return walk(n["children"], "pattern-children")
		}
		for _, key := range []string{"union", "intersection", "difference"} {
			if n[key] != nil {
				if !templateOnly(n, key) || key == "difference" && len(templateList(n[key])) != 2 {
					return "a malformed pattern"
				}
				return list(key, "pattern", 2)
			}
		}
		if n["path"] != nil {
			if !templateOnly(n, "path", "pattern") || n["path"] != "first" && n["path"] != "last" && n["path"] != "descendant" {
				return "a malformed pattern path"
			}
			return walk(n["pattern"], "pattern")
		}
		return "a malformed pattern"
	}
	if n["pattern"] != nil {
		if !templateOnly(n, "pattern") {
			return "a malformed pattern term"
		}
		return walk(n["pattern"], "pattern")
	}
	if n["method"] != nil {
		name := templateText(n["method"])
		if !templateOnly(n, "method", "receiver", "args") || !templateArray(n, "args", 0) {
			return "a malformed method"
		}
		if !strings.Contains("|value|image|source-text|decomposed-source-text|verbatim-text|emitted|tags|classes|onward|following-tokens|first-token|last-token|tokens-after-first|starts-input|ends-input|matches|begins|followed-by|preceded-by|without-elision|without-elision-except|classify|split|ngrams|", "|"+name+"|") {
			return "unknown method name"
		}
		if (name == "classify" || name == "ngrams") && templateUnresolved(n["args"]) {
			return "a parameter cannot replace a classifier name or integer argument"
		}
		if p := walk(n["receiver"], "term"); p != "" {
			return p
		}
		for _, a := range templateList(n["args"]) {
			x := templateObj(a)
			if x["rule"] != nil || x["terminal"] != nil || x["classifier"] != nil || x["integer"] != nil {
				continue
			}
			if p := walk(a, "term"); p != "" {
				return p
			}
		}
		return ""
	}
	for _, key := range []string{"concat", "union", "intersection", "difference", "any", "all"} {
		if n[key] != nil {
			if !templateOnly(n, key) {
				return "a malformed compound node"
			}
			k := "term"
			if key == "any" || key == "all" {
				k = "condition"
			}
			return list(key, k, 2)
		}
	}
	if n["not"] != nil {
		if !templateOnly(n, "not") {
			return "a malformed negation"
		}
		return walk(n["not"], "condition")
	}
	if n["op"] != nil {
		if !templateOnly(n, "op", "left", "right") || !strings.Contains("|=|≠|∈|∉|⊆|⊈|≅|≇|", "|"+templateText(n["op"])+"|") {
			return "a malformed comparison"
		}
		if p := walk(n["left"], "term"); p != "" {
			return p
		}
		return walk(n["right"], "term")
	}
	if n["if"] != nil {
		if !templateOnly(n, "if", "then") {
			return "a malformed implication"
		}
		if p := walk(n["if"], "condition"); p != "" {
			return p
		}
		return walk(n["then"], kind)
	}
	return "a malformed " + kind
}
func templateRequirementProblem(value any, depth int, uni *unicodeTable) string {
	items, ok := value.([]any)
	if !ok {
		return "a malformed requirement list"
	}
	for _, v := range items {
		r := templateObj(v)
		_, ok := r["negated"].(bool)
		operand := templateObj(r["value"])
		if !templateOnly(r, "negated", "value") || !ok || operand["tag"] == nil && operand["const"] == nil && operand["param"] == nil {
			return "a malformed requirement"
		}
		if p := templateNodeProblem(operand, "term", depth+1, false, false, uni); p != "" {
			return p
		}
	}
	return ""
}

func templateSymbol(n templateObject) bool {
	if n["test"] != nil {
		inner := templateObj(n["expr"])
		if n["test"] == "tags" {
			return inner["test"] == nil && templateSymbol(inner)
		}
		if n["test"] != "=" && n["test"] != "≠" {
			return false
		}
		return inner["test"] == nil && templateSymbol(inner) || inner["test"] == "tags" && templateSymbol(inner)
	}
	return n["param"] != nil || n["call"] != nil || n["ref"] != nil || n["literal"] != nil || n["range"] != nil || n["wildcard"] == true
}
func templateElidableHead(n templateObject) bool {
	if xs := templateList(n["seq"]); len(xs) > 0 {
		n = templateObj(xs[0])
	}
	if !templateSymbol(n) {
		return false
	}
	for n["test"] != nil {
		n = templateObj(n["expr"])
	}
	return n["param"] != nil || templateOnly(n, "ref") && className.MatchString(templateText(n["ref"]))
}
func templateCaptureShape(n templateObject) *domExpr {
	for _, kind := range []string{exSeq, exChoice, exRanked, exAnd} {
		if n[kind] != nil {
			items := []*domExpr{}
			for _, v := range templateList(n[kind]) {
				items = append(items, templateCaptureShape(templateObj(v)))
			}
			return &domExpr{Kind: kind, Items: items}
		}
	}
	for _, kind := range []string{exOptional, exRepeat} {
		if n[kind] != nil {
			e := &domExpr{Kind: kind, Inner: templateCaptureShape(templateObj(n[kind]))}
			if n["separator"] != nil {
				e.Sep = templateCaptureShape(templateObj(n["separator"]))
			}
			return e
		}
	}
	if n["capture"] != nil {
		return &domExpr{Kind: exCapture, Name: templateText(n["capture"]), Inner: templateCaptureShape(templateObj(n["expr"]))}
	}
	if n["test"] != nil {
		return templateCaptureShape(templateObj(n["expr"]))
	}
	return &domExpr{Kind: exWildcard}
}
func templateTagClauseProblem(root any, own bool) string {
	pending := []any{root}
	for len(pending) > 0 {
		v := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		switch n := v.(type) {
		case []any:
			pending = append(pending, n...)
		case map[string]any:
			if n["pattern"] != nil {
				continue
			}
			if engineTag(templateText(n["tag"])) {
				return "a tag clause introduces an engine tag"
			}
			if own && (n["method"] == "tags" || n["method"] == "classes") {
				receiver := templateObj(n["receiver"])
				if value, ok := receiver["capture"]; ok && value == "" {
					return "a constituent's tags cannot read its own tags"
				}
			}
			for _, key := range templateKeys(n) {
				if key != "at" {
					pending = append(pending, n[key])
				}
			}
		}
	}
	return ""
}
