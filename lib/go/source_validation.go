package gencmu

import "strings"

func unresolvedTerm(t *domTerm) bool {
	return t != nil && (t.Kind == tmParam || t.Kind == tmSourceCall)
}

func (c *domChecker) ruleName(name string) bool {
	return isRuleName(name, c.uni) || c.expanded && strings.Contains(name, "(") && strings.HasSuffix(name, ")")
}

func (c *domChecker) parameter(name string, at [2]int) {
	c.unresolved = true
	if !domName.MatchString(name) || !c.parameters[name] || at[0] <= 0 || at[1] <= 0 {
		c.fail("an undeclared or malformed parameter")
		if c.problem != nil {
			c.problem.at = at
		}
	}
}

func (c *domChecker) sourceCall(call *domSourceCall, depth int) {
	if c.deep(depth) {
		return
	}
	c.unresolved = true
	if call == nil || !isRuleName(call.Name, c.uni) || len(call.Args) == 0 || call.At[0] <= 0 || call.At[1] <= 0 {
		c.fail("a malformed call")
		return
	}
	before := c.inArgument
	c.inArgument = true
	defer func() { c.inArgument = before }()
	for _, arg := range call.Args {
		c.sourceArgument(arg, depth+1)
	}
}

func (c *domChecker) sourceArgument(arg *domArgument, depth int) {
	if c.deep(depth) {
		return
	}
	if arg == nil {
		c.fail("a missing argument")
		return
	}
	forms := 0
	for _, present := range []bool{arg.Term != nil, arg.Expr != nil, arg.Requirements != nil, arg.Targets != nil} {
		if present {
			forms++
		}
	}
	if forms != 1 || arg.Body && arg.Expr == nil {
		c.fail("a malformed argument")
		return
	}
	switch {
	case arg.Term != nil:
		t := arg.Term
		if t.Kind == tmRule {
			if !isRuleName(t.Str, c.uni) || c.patternArgument && isTag(t.Str, c.uni) {
				c.fail("a malformed nominal rule argument")
			}
		} else if t.Kind == tmClassifier || t.Kind == tmInteger || t.Kind == tmTerminal {
			c.fail("a term in the wrong argument category")
		} else {
			c.term(t, depth, false)
		}
	case arg.Expr != nil:
		if !arg.Body && arg.Expr.Kind != exTest && arg.Expr.Kind != exRange && arg.Expr.Kind != exWildcard && arg.Expr.Kind != exSplice {
			c.fail("a malformed symbol argument")
		}
		c.expr(arg.Expr, depth, true, false, false, false, false)
	case arg.Requirements != nil:
		c.requirements(arg.Requirements, depth)
	case arg.Targets != nil:
		if len(arg.Targets) < 2 {
			c.fail("a malformed target choice")
		}
		for _, target := range arg.Targets {
			c.target(target, depth)
		}
	}
}

func (c *domChecker) requirements(items []tagRequirement, depth int) {
	for _, r := range items {
		if r.Value == nil || r.Value.Kind != tmTag && r.Value.Kind != tmConst && r.Value.Kind != tmParam {
			c.fail("a malformed tag requirement")
		}
		c.term(r.Value, depth, false)
	}
}

func (c *domChecker) target(t *domTerm, depth int) {
	if c.deep(depth) {
		return
	}
	if unresolvedTerm(t) {
		c.term(t, depth, true)
		return
	}
	if c.check && t != nil {
		if t.Kind == tmRule && !c.ruleName(t.Str) {
			c.fail("a malformed rule argument")
			return
		}
		if t.Kind != tmRule && t.Kind != tmTerminal {
			c.term(t, depth, false)
			if !c.structural {
				c.fail("a method has the wrong receiver or arguments")
			}
			return
		}
	}
	if t == nil || t.Kind != tmRule && t.Kind != tmTerminal || t.Kind == tmRule && !c.ruleName(t.Str) ||
		t.Kind == tmTerminal && (!isCapital(t.Str) || engineTag(t.Str) || !isTag(t.Str, c.uni)) {
		c.fail("a malformed query target")
	}
}

func (c *domChecker) sourceHead(r *domRule) {
	if (r.Params != nil || r.Args != nil || r.Instance != nil) && !c.ruleName(r.Name) {
		c.fail("a malformed rule name")
	}
	if r.Params != nil {
		c.parameters = map[string]bool{}
		c.unresolved = true
		if len(r.Params) == 0 || r.Args != nil || r.Instance != nil {
			c.fail("malformed template parameters")
		}
		for _, name := range r.Params {
			if !domName.MatchString(name) || c.parameters[name] {
				c.fail("malformed template parameters")
			}
			c.parameters[name] = true
		}
	}
	if r.Args != nil {
		if r.Op == "define" || r.Instance != nil {
			c.fail("an instance head requires an edit")
		}
		c.sourceCall(&domSourceCall{Name: r.Name, Args: r.Args, At: r.At}, 0)
	}
	if r.Instance != nil {
		if r.Op == "extend" || len(r.Conditions) != 0 || len(r.Alternatives) != 0 ||
			r.Tags != nil || r.Value != nil || r.Image != nil || r.Error != nil || r.Warning != nil || r.SuppressWarnings != nil || r.Emit != nil || r.Erased {
			c.fail("a malformed instance binding")
		}
		c.sourceCall(r.Instance, 0)
	}
}
