package gencmu

import "fmt"

// validateDOM checks the shape of a DOM read from JSON, a precompiled one
// or the bootstrap's, as the notation reader would have built it (engine
// §9), so that a malformed one is refused rather than lowered: a bad cache
// entry is then a miss, and a bad bootstrap a load error.
func validateDOM(d *domDoc) error {
	for _, r := range d.Rules {
		if r == nil || r.Name == "" || (r.Op != "define" && r.Op != "extend") || len(r.Alternatives) == 0 {
			return fmt.Errorf("a malformed rule")
		}
		if err := validateTerm(r.Tags, false); err != nil {
			return fmt.Errorf("rule %s: %v", r.Name, err)
		}
		for _, a := range r.Alternatives {
			if a == nil {
				return fmt.Errorf("rule %s: a missing alternative", r.Name)
			}
			for _, g := range a.Guards {
				if g.Feature == "" {
					return fmt.Errorf("rule %s: a guard without a feature", r.Name)
				}
			}
			if err := validateExpr(a.Expr); err != nil {
				return fmt.Errorf("rule %s: %v", r.Name, err)
			}
			if err := validateTerm(a.Tags, false); err != nil {
				return fmt.Errorf("rule %s: %v", r.Name, err)
			}
		}
		if err := validateEmit(r.Emit); err != nil {
			return fmt.Errorf("rule %s: %v", r.Name, err)
		}
		for _, c := range r.Conditions {
			if err := validateCond(c); err != nil {
				return fmt.Errorf("rule %s: %v", r.Name, err)
			}
		}
	}
	for _, dir := range d.Directives {
		if dir == nil || dir.Name == "" {
			return fmt.Errorf("a malformed directive")
		}
	}
	return nil
}

func validateExpr(e *domExpr) error {
	if e == nil {
		return fmt.Errorf("a missing expression")
	}
	switch e.Kind {
	case exSeq, exChoice, exAnd:
		if len(e.Items) == 0 {
			return fmt.Errorf("an empty %s", e.Kind)
		}
		if e.Kind == exAnd && len(e.Items) > maxAnd {
			return fmt.Errorf("an & of more than %d items", maxAnd)
		}
		for _, it := range e.Items {
			if err := validateExpr(it); err != nil {
				return err
			}
		}
	case exOptional:
		return validateExpr(e.Inner)
	case exRepeat:
		if e.Min != 0 && e.Min != 1 {
			return fmt.Errorf("a repetition with min %d", e.Min)
		}
		return validateExpr(e.Inner)
	case exCapture:
		if e.Name == "" || e.Inner == nil || (e.Inner.Kind != exRef && e.Inner.Kind != exTerminal) {
			return fmt.Errorf("a malformed capture")
		}
		return validateExpr(e.Inner)
	case exRef, exTerminal:
		if e.Name == "" {
			return fmt.Errorf("an empty %s", e.Kind)
		}
	case exHash, exEmpty:
	default:
		return fmt.Errorf("an unknown expression %q", e.Kind)
	}
	return nil
}

func isSpanShape(t *domTerm) bool {
	if t == nil {
		return false
	}
	switch {
	case t.Kind == tmCapture:
		return t.Str != ""
	case t.Kind == tmCall && (t.Str == "head" || t.Str == "tail" || t.Str == "last"):
		return len(t.Items) == 1 && isSpanShape(t.Items[0])
	}
	return false
}

// validateTerm checks a term; a nil one is an absent, optional term unless
// required.
func validateTerm(t *domTerm, required bool) error {
	if t == nil {
		if required {
			return fmt.Errorf("a missing term")
		}
		return nil
	}
	switch t.Kind {
	case tmLiteral, tmWeak:
	case tmCapture:
		if t.Str == "" {
			return fmt.Errorf("a capture without a name")
		}
	case tmEmptySet:
	case tmSet, tmUnion, tmIntersection:
		if t.Kind != tmSet && len(t.Items) == 0 {
			return fmt.Errorf("an empty %s", t.Kind)
		}
		for _, it := range t.Items {
			if err := validateTerm(it, true); err != nil {
				return err
			}
		}
	case tmCall:
		args := t.Items
		ok := false
		switch t.Str {
		case "phonemes", "text", "words", "classes", "head", "tail", "last":
			ok = len(args) == 1 && isSpanShape(args[0])
		case "tags":
			ok = (len(args) == 1 || len(args) == 2) && isSpanShape(args[0]) &&
				(len(args) == 1 || (args[1] != nil && args[1].Kind == tmRule && args[1].Str != ""))
		case "lowercase":
			ok = len(args) == 1 && args[0] != nil && validateTerm(args[0], true) == nil && args[0].Kind != tmRule
		}
		if !ok {
			return fmt.Errorf("a malformed call of %q", t.Str)
		}
	default:
		return fmt.Errorf("an unknown term %q", t.Kind)
	}
	return nil
}

func validateCond(c *domCond) error {
	if c == nil {
		return fmt.Errorf("a missing condition")
	}
	switch c.Kind {
	case cdCompare:
		switch c.Op {
		case "=", "≠", "∈", "∉", "⊆":
		default:
			return fmt.Errorf("an unknown comparison %q", c.Op)
		}
		if err := validateTerm(c.Left, true); err != nil {
			return err
		}
		return validateTerm(c.Right, true)
	case cdMatches:
		if !isSpanShape(c.Span) || c.Rule == "" {
			return fmt.Errorf("a malformed matches()")
		}
	case cdNot:
		return validateCond(c.Inner)
	case cdAny:
		if len(c.Items) == 0 {
			return fmt.Errorf("an empty any")
		}
		for _, it := range c.Items {
			if err := validateCond(it); err != nil {
				return err
			}
		}
	default:
		return fmt.Errorf("an unknown condition %q", c.Kind)
	}
	return nil
}

func validateEmit(e *domEmit) error {
	if e == nil || e.Nothing {
		return nil
	}
	if len(e.Items) == 0 {
		return fmt.Errorf("an emission of no items")
	}
	for _, it := range e.Items {
		if it == nil {
			return fmt.Errorf("a missing emission item")
		}
		kinds := 0
		if it.This {
			kinds++
		}
		if it.Capture != "" {
			kinds++
		}
		if it.IsInsert {
			kinds++
			if it.Insert == "" || it.Tags != nil {
				return fmt.Errorf("a malformed inserted tag")
			}
		}
		if kinds != 1 {
			return fmt.Errorf("a malformed emission item")
		}
		if err := validateTerm(it.Tags, false); err != nil {
			return err
		}
	}
	return nil
}
