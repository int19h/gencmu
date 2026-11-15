package gencmu

import (
	"slices"
	"strings"
)

func unresolvedTerm(t *domTerm) bool {
	return t != nil && (t.Kind == tmParam || t.Kind == tmSourceCall)
}

func (c *domChecker) ruleName(name string) bool {
	return isRuleName(name, c.uni) || c.expanded && strings.Contains(name, "(") && strings.HasSuffix(name, ")")
}

func (c *domChecker) parameter(name string, at [2]int) {
	c.unresolved = true
	if !domName.MatchString(name) || !c.parameters[name] || at[0] <= 0 || at[1] <= 0 {
		message := "an undeclared or malformed parameter"
		if domName.MatchString(name) && at[0] > 0 && at[1] > 0 {
			message = "undeclared parameter @" + name
		}
		c.failAt(at, "%s", message)
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
	if t == nil || t.Kind != tmRule && t.Kind != tmTerminal || t.Kind == tmRule && !c.ruleName(t.Str) ||
		t.Kind == tmTerminal && (!isCapital(t.Str) || engineTag(t.Str) || !isTag(t.Str, c.uni)) {
		c.fail("a malformed query target")
	}
}

func (c *domChecker) sourceHead(r *domRule) {
	nameAt := r.nameAt
	if nameAt == [2]int{} {
		nameAt = r.At
	}
	if r.Params != nil {
		c.parameters = map[string]bool{}
		c.unresolved = true
		valid := len(r.Params) > 0 && r.Args == nil && r.Instance == nil
		for _, name := range r.Params {
			valid = valid && domName.MatchString(name)
		}
		if !valid {
			c.failAt(r.At, "malformed template parameters")
			return
		}
		for i, name := range r.Params {
			if c.parameters[name] {
				var at [2]int
				if i < len(r.paramAts) {
					at = r.paramAts[i]
				}
				if at == [2]int{} {
					at = r.At
				}
				c.failAt(at, "duplicate parameter @%s", name)
				return
			}
			c.parameters[name] = true
		}
	}
	if r.Instance != nil {
		if r.hasHead {
			c.failAt(r.At, "a binding requires a plain rule name")
			return
		}
		if !c.ruleName(r.Name) {
			c.failAt(nameAt, "a rule name starts with a lowercase letter or uses one eligible emoji")
			return
		}
		if r.Op == "extend" || len(r.Conditions) != 0 || len(r.Alternatives) != 0 ||
			r.Tags != nil || r.Value != nil || r.Image != nil || r.Error != nil || r.Warning != nil || r.SuppressWarnings != nil || r.Emit != nil || r.Erased {
			c.failAt(nameAt, "a malformed instance binding")
		}
		return
	}
	if r.Args != nil {
		if len(r.Args) == 0 {
			c.failAt(nameAt, "a malformed call")
			return
		}
		for _, a := range r.Args {
			if a != nil && (termHasUnresolved(a.Term) || exprHasUnresolved(a.Expr) || slices.ContainsFunc(a.Targets, termHasUnresolved) || slices.ContainsFunc(a.Requirements, func(r tagRequirement) bool { return termHasUnresolved(r.Value) })) {
				c.failAt(nameAt, "a head cannot mix parameters and concrete arguments")
				return
			}
		}
		if r.Op != "redefine" && r.Op != "extend" {
			c.failAt(nameAt, "an instance head requires an edit")
			return
		}
	}
	if !c.ruleName(r.Name) {
		c.failAt(nameAt, "a rule name starts with a lowercase letter or uses one eligible emoji")
	}
}

// sourceHeadCalls checks the call of an instance binding or an edit's
// head, which come after the rule's header (engine §9.3 step 5).
func (c *domChecker) sourceHeadCalls(r *domRule) {
	if r.Instance != nil {
		c.sourceCall(r.Instance, 0)
	} else if r.Args != nil {
		c.sourceCall(&domSourceCall{Name: r.Name, Args: r.Args, At: r.At}, 0)
	}
}
