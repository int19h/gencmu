package gencmu

import (
	"errors"
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

// A closed declaration uses the same native representation as a cached DOM.
// Pattern syntax alone does not make a declaration an unresolved template.
func (b *domBuilder) appendReadDeclaration(d *domDoc, kind string, raw templateObject) error {
	if templateUnresolved(raw) {
		return appendTemplateDeclaration(d, kind, raw)
	}
	field := map[string]string{"rule": "rules", "constant-definition": "constants", "directive": "directives", "implication-declaration": "implications"}[kind]
	if field == "" {
		return fmt.Errorf("unexpected closed declaration %s", kind)
	}
	document := templateDocument([]any{})
	document[field] = []any{raw}
	closed, err := decodeDOMMode(templateJSON(document), b.uni, true)
	if errors.Is(err, errTooDeep) {
		return appendTemplateDeclaration(d, kind, raw)
	}
	if err != nil {
		return err
	}
	for _, rule := range closed.Rules {
		restoreTemplateRuleLocations(rule, raw)
	}
	for _, directive := range closed.Directives {
		restoreTemplateRuleLocations(&domRule{Conditions: directive.Conditions}, raw)
	}
	d.Rules = append(d.Rules, closed.Rules...)
	d.Constants = append(d.Constants, closed.Constants...)
	d.Directives = append(d.Directives, closed.Directives...)
	d.Implications = append(d.Implications, closed.Implications...)
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
			if !templateAllowed(node, "param", "at", "exact", "children") || !scope[templateText(p)] || templateAt(node) == [2]int{} {
				p := problem("an undeclared or malformed parameter")
				if at := templateAt(node); at != [2]int{} {
					p.at = at
				}
				return p
			}
		}
	}
	walk := func(n any, k string, whole bool) *domProblem {
		if msg := templateNodeProblem(n, k, 0, whole, false, false, false, false, uni); msg != "" {
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
						// The clause check above distinguishes constituent tags from
						// emission tags. An emission can read its constituent's tags.
						k = "term"
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
			shape := templateCaptureShape(templateObj(alt["expr"]))
			if len(duplicateCaptures(shape)) > 0 {
				return problem("a capture name used twice in one production")
			}
			// The name of an item capture stands nowhere else in its
			// alternative (engine §3.5, §9).
			if repeatsItemCapture(shape) {
				return problem("the name of an item capture used twice in one alternative")
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
func templateQuery(name string) bool {
	return strings.Contains("|matches|begins|ends|starts-input|ends-input|followed-by|preceded-by|", "|"+name+"|")
}
func templateBareCapture(n templateObject) bool {
	name, ok := n["capture"].(string)
	return templateOnly(n, "capture") && ok && (name == "" || captureName.MatchString(name))
}
func templateRecipeAtom(n templateObject) bool {
	if n["string"] != nil || n["const"] != nil || n["param"] != nil {
		return true
	}
	name := templateText(n["method"])
	if !strings.Contains("|value|image|source-text|decomposed-source-text|verbatim-text|", "|"+name+"|") || !templateArray(n, "args", 0) || len(templateList(n["args"])) != 0 {
		return false
	}
	receiver := templateObj(n["receiver"])
	return templateBareCapture(receiver) || (name == "value" || name == "image") && receiver["method"] == "emitted" && len(templateList(receiver["args"])) == 0 && templateBareCapture(templateObj(receiver["receiver"]))
}
func templateMethodProblem(n templateObject, recipe bool, uni *unicodeTable) string {
	name := templateText(n["method"])
	args := templateList(n["args"])
	receiver := templateObj(n["receiver"])
	if name == "ends" {
		span := receiver
		for depth := 0; depth <= maxDOMDepth; depth++ {
			method := templateText(span["method"])
			if method == "without-elision" || method == "without-elision-except" {
				return "ends requires an ordinary span, not a restored span"
			}
			if method != "onward" {
				break
			}
			span = templateObj(span["receiver"])
		}
	}
	if receiver == nil {
		return "a malformed method receiver"
	}
	bare := templateBareCapture(receiver) || receiver["param"] != nil || receiver["call"] != nil
	span := bare || strings.Contains("|first-token|tokens-after-first|last-token|onward|following-tokens|preceding-tokens|without-elision|without-elision-except|", "|"+templateText(receiver["method"])+"|") && receiver["method"] != nil
	rule := func(v any) bool {
		a := templateObj(v)
		return templateOnly(a, "rule") && templateNamed(a["rule"], uni) || a["param"] != nil || a["call"] != nil
	}
	targets := func() bool {
		if len(args) == 0 {
			return false
		}
		for _, v := range args {
			a := templateObj(v)
			if !rule(a) && !(templateOnly(a, "terminal") && className.MatchString(templateText(a["terminal"]))) {
				return false
			}
		}
		return true
	}
	valid := false
	switch name {
	case "ngrams":
		valid = len(args) == 1 && templateOnly(templateObj(args[0]), "integer") && validInteger(templateText(templateObj(args[0])["integer"]))
	case "split":
		if len(args) == 1 {
			a := templateObj(args[0])
			valid = a != nil && a["string"] != "" && a["rule"] == nil && a["terminal"] == nil && a["classifier"] == nil && a["integer"] == nil
		}
	case "classify":
		valid = len(args) == 1 && templateOnly(templateObj(args[0]), "classifier") && classifierName.MatchString(templateText(templateObj(args[0])["classifier"]))
	case "tags":
		valid = span && (len(args) == 0 || len(args) == 1 && rule(args[0]))
	case "matches", "begins", "ends":
		valid = span && targets()
	case "followed-by", "preceded-by":
		valid = bare && targets()
	case "without-elision-except":
		valid = bare && len(args) == 1 && rule(args[0])
	case "without-elision":
		valid = bare && len(args) == 0
	case "verbatim-text", "emitted":
		valid = recipe && bare && len(args) == 0
	case "value", "image", "source-text", "decomposed-source-text", "classes", "first-token", "last-token", "tokens-after-first", "onward", "following-tokens", "preceding-tokens", "starts-input", "ends-input":
		valid = len(args) == 0 && (span || recipe && receiver["method"] == "emitted" && (name == "value" || name == "image"))
	default:
		return "unknown method name"
	}
	if valid {
		return ""
	}
	return "a method has the wrong receiver or arguments"
}

var templateSourceForms = map[string][]string{
	"expr":        {"seq", "choice", "ranked", "and", "optional", "repeat", "capture", "test", "literal", "range", "ref", "wildcard", "empty"},
	"condition":   {"op", "not", "any", "all", "if", "captured", "method"},
	"string":      {"string", "const"},
	"term":        {"string", "tag", "const", "emptySet", "capture", "concat", "union", "intersection", "difference", "if", "pattern", "method"},
	"recipe-term": {"string", "tag", "const", "emptySet", "capture", "concat", "union", "intersection", "difference", "if", "pattern", "method"},
}

// templateNodeProblem is why a node of a template DOM is malformed, or "".
// sealed says the node lies inside an elidable optional, chain that the
// innermost braces around it are a chain, item that they are flat braces,
// and ranked that a ranked group stands between those braces and the node
// (engine §3.5, §9).
func templateNodeProblem(value any, kind string, depth int, whole, sealed, chain, item, ranked bool, uni *unicodeTable) string {
	if depth > maxDOMDepth {
		return errTooDeep.Error()
	}
	n := templateObj(value)
	if n == nil {
		return "a malformed " + kind
	}
	walk := func(v any, k string) string {
		return templateNodeProblem(v, k, depth+1, false, sealed, chain, item, ranked, uni)
	}
	list := func(key, k string, min int) string {
		if !templateArray(n, key, min) {
			return "a malformed " + kind
		}
		for _, v := range templateList(n[key]) {
			// An item capture stands in no ranked group (engine §3.5).
			if p := templateNodeProblem(v, k, depth+1, false, sealed, chain, item, ranked || key == "ranked", uni); p != "" {
				return p
			}
		}
		return ""
	}
	if kind == "pattern" {
		problem := layeredPatternProblem(templateClean(n), layeredPatternInspection{depth: depth, name: func(name string) bool { return templateNamed(name, uni) && !isTag(name, uni) }, terminal: func(name string) bool { return isTag(name, uni) }})
		if problem != "" {
			return problem
		}
		return templateNodeProblem(n, "pattern-part", depth, whole, sealed, chain, item, ranked, uni)
	}
	if kind == "pattern-part" {
		if n["call"] != nil {
			for _, part := range templateNodes(n["args"]) {
				if part["rule"] != nil && isTag(templateText(part["rule"]), uni) {
					return "a pattern argument rule reads back as a tag"
				}
			}
			if p := list("args", "arg", 1); p != "" {
				return p
			}
		}
		if n["literal"] != nil {
			if p := templateNodeProblem(n["literal"], "string", depth, false, sealed, chain, item, ranked, uni); p != "" {
				return p
			}
		}
		if ends := templateList(n["range"]); len(ends) == 2 {
			var literal [2]*domTerm
			for i, end := range ends {
				if value, ok := templateObj(end)["string"].(string); ok {
					literal[i] = &domTerm{Kind: tmString, Str: value}
				}
			}
			if problem := literalRangeProblem(literal); problem != "" {
				return problem
			}
		}
		for _, end := range templateList(n["range"]) {
			if p := templateNodeProblem(end, "string", depth, false, sealed, chain, item, ranked, uni); p != "" {
				return p
			}
		}
		if n["test"] == "tags" {
			for _, r := range templateList(n["requirements"]) {
				if p := walk(templateObj(r)["value"], "term"); p != "" {
					return p
				}
			}
		} else if n["test"] != nil {
			if p := walk(n["value"], "string"); p != "" {
				return p
			}
		}
		for _, key := range []string{"expr", "pattern"} {
			if n[key] != nil {
				if p := walk(n[key], "pattern-part"); p != "" {
					return p
				}
			}
		}
		for _, key := range []string{"union", "intersection", "difference"} {
			for _, v := range templateList(n[key]) {
				if p := walk(v, "pattern-part"); p != "" {
					return p
				}
			}
		}
		for _, v := range templateList(n["children"]) {
			if p := walk(v, "pattern-item"); p != "" {
				return p
			}
		}
		return ""
	}
	if kind == "pattern-item" {
		if n["child"] != nil {
			if p := walk(n["child"], "pattern-part"); p != "" {
				return p
			}
		}
		for _, key := range []string{"optional", "repeat", "separator"} {
			for _, v := range templateList(n[key]) {
				if p := walk(v, "pattern-item"); p != "" {
					return p
				}
			}
		}
		for _, arm := range templateList(n["choice"]) {
			for _, v := range templateList(arm) {
				if p := walk(v, "pattern-item"); p != "" {
					return p
				}
			}
		}
		return ""
	}
	// Unresolved leaves still obey the category of their position.
	if n["param"] != nil {
		switch kind {
		case "expr", "arg", "term", "tags", "string", "target", "pattern", "recipe-atom":
		default:
			return "a parameter in the wrong source category"
		}
		if !templateOnly(n, "param", "at") || !domName.MatchString(templateText(n["param"])) || templateAt(n) == [2]int{} {
			return "an undeclared or malformed parameter"
		}
		return ""
	}
	if n["call"] != nil || kind == "call" {
		if kind == "string" {
			return "a string operand requires a literal or constant"
		}
		switch kind {
		case "expr", "arg", "term", "tags", "target", "pattern", "call":
		default:
			return "a call in the wrong source category"
		}
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
			return templateNodeProblem(n["body"], "expr", depth, true, false, false, false, false, uni)
		}
		if n["targets"] != nil {
			if !templateOnly(n, "targets") {
				return "a malformed target choice"
			}
			if !templateArray(n, "targets", 2) {
				return "a malformed target choice"
			}
			for _, v := range templateList(n["targets"]) {
				if p := templateNodeProblem(v, "target", depth, false, sealed, chain, item, ranked, uni); p != "" {
					return p
				}
			}
			return ""
		}
		if n["requirements"] != nil && n["test"] == nil {
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
	if kind == "recipe" {
		if !templateOnly(n, "concat") || !templateArray(n, "concat", 1) {
			return "a malformed recipe"
		}
		return list("concat", "recipe-atom", 1)
	}
	if kind == "recipe-atom" {
		if !templateRecipeAtom(n) {
			return "a malformed recipe atom"
		}
		kind = "recipe-term"
	}
	found := false
	formKind := kind
	if formKind == "tags" {
		formKind = "term"
	}
	for _, key := range templateSourceForms[formKind] {
		found = found || n[key] != nil
	}
	if !found {
		return "a malformed source category"
	}
	if !templateUnresolved(n) && !(kind == "recipe-term" && n["method"] != nil) {
		c := &domChecker{uni: uni, deferTypes: true}
		raw := templateJSON(n)
		var err error
		switch kind {
		case "expr":
			var e *domExpr
			e, err = decodeExpr(raw)
			if err == nil {
				c.expr(e, depth, whole, sealed, chain, item, ranked)
			}
		case "condition":
			var e *domCond
			e, err = decodeCond(raw)
			if err == nil {
				c.condition(e, depth)
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
			return templateNodeProblem(n["optional"], "expr", depth+1, false, sealed || n["elidable"] == true, chain, item, ranked, uni)
		}
		if n["repeat"] != nil {
			if !templateAllowed(n, "repeat", "separator", "chain") || n["chain"] != nil && (!whole || n["chain"] != "left" && n["chain"] != "right") {
				return "a malformed repetition"
			}
			// A chain holds no capture, and flat braces hold item captures,
			// also inside a chain; an elidable optional seals everything
			// inside it (engine §3.5).
			if p := templateNodeProblem(n["repeat"], "expr", depth+1, false, sealed, n["chain"] != nil, n["chain"] == nil, false, uni); p != "" {
				return p
			}
			if n["separator"] != nil {
				return templateNodeProblem(n["separator"], "expr", depth+1, false, sealed, n["chain"] != nil, n["chain"] == nil, false, uni)
			}
			return ""
		}
		if n["capture"] != nil {
			if !templateOnly(n, "capture", "expr") || sealed || chain || item && ranked || (!captureName.MatchString(templateText(n["capture"])) || !templateSymbol(templateObj(n["expr"]))) {
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
			if p := templateRequirementProblem(n["requirements"], depth+1, uni); p != "" {
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
		fields := []string{"range"}
		if !templateOnly(n, fields...) || len(templateList(n["range"])) != 2 {
			return "a malformed range"
		}
		for _, v := range templateList(n["range"]) {
			if p := templateNodeProblem(v, "string", depth, false, false, false, false, false, uni); p != "" {
				return p
			}
		}
		return ""
	}
	if n["literal"] != nil {
		fields := []string{"literal"}
		if !templateOnly(n, fields...) {
			return "a malformed literal"
		}
		return templateNodeProblem(n["literal"], "string", depth, false, false, false, false, false, uni)
	}
	if kind == "recipe" {
		if !templateOnly(n, "concat") {
			return "a malformed recipe"
		}
		return list("concat", "recipe-atom", 1)
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
		if templateQuery(name) != (kind == "condition") {
			return "a method in the wrong category"
		}
		if p := templateMethodProblem(n, kind == "recipe-term", uni); p != "" {
			return p
		}
		if (name == "classify" || name == "ngrams") && templateUnresolved(n["args"]) {
			return "a parameter cannot replace a classifier name or integer argument"
		}
		receiverKind := "term"
		if kind == "recipe-term" {
			receiverKind = "recipe-term"
		}
		if p := walk(n["receiver"], receiverKind); p != "" {
			return p
		}
		for _, a := range templateList(n["args"]) {
			arg := templateObj(a)
			if arg["rule"] != nil {
				if !templateOnly(arg, "rule") || !templateNamed(arg["rule"], uni) || !strings.Contains("|tags|matches|begins|ends|without-elision-except|followed-by|preceded-by|", "|"+name+"|") {
					return "a malformed rule argument"
				}
				continue
			}
			if arg["terminal"] != nil {
				if !templateOnly(arg, "terminal") || !className.MatchString(templateText(arg["terminal"])) || !strings.Contains("|matches|begins|ends|followed-by|preceded-by|", "|"+name+"|") {
					return "a malformed target argument"
				}
				continue
			}
			if arg["classifier"] != nil || arg["integer"] != nil {
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
			if !templateOnly(n, key) || key == "difference" && len(templateList(n[key])) != 2 {
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
		if (n["op"] == "≅" || n["op"] == "≇") && !templateBareCapture(templateObj(n["left"])) {
			return "a tree comparison requires a bare capture"
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
		if p := templateNodeProblem(operand, "term", depth, false, false, false, false, false, uni); p != "" {
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
			if kind == exRepeat && n["chain"] != nil {
				e.Chain = templateText(n["chain"])
			}
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
	if len(templateLiteralEngineTags(root)) != 0 {
		return "a tag clause introduces an engine tag"
	}
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

// Keep the native provenance calculation for unresolved terms. Parameters,
// calls, and every forwarded term contribute no literal memberships.
func templateLiteralEngineTags(root any) map[string][][2]int {
	type task struct {
		raw  any
		term *domTerm
	}
	result := &domTerm{}
	pending := []task{{root, result}}
	for len(pending) > 0 {
		last := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		n := templateObj(last.raw)
		t := last.term
		t.Kind, t.Str, t.At = tmTag, templateText(n["tag"]), templateSourceAt(n)
		for _, key := range []string{tmUnion, tmIntersection, tmDifference, tmIf} {
			if n[key] == nil {
				continue
			}
			t.Kind = key
			items := templateList(n[key])
			if key == tmIf {
				items = []any{n["then"]}
			}
			for _, item := range items {
				child := &domTerm{}
				t.Items = append(t.Items, child)
				pending = append(pending, task{item, child})
			}
			break
		}
	}
	return literalEngineTags(result)
}
