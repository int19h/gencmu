package gencmu

// A stage's grammar: its documents stitched into one set of rules and
// directives (engine §2).
type stageGrammar struct {
	name        string
	rules       []*sRule
	byName      map[string]*sRule
	lean        string // "greedy" or "lazy"
	elisionOnly bool
	maximal     bool // no terminator is elided where its constituent could have been longer (engine §4)
	elidable    map[string]bool
	changes     []stitchChange
}

// stitchChange records a rule a later document replaced or extended.
type stitchChange struct {
	rule, document, op string
}

type sRule struct {
	name string
	alts []*sAlt
	doc  string
	at   [2]int
}

// sAlt is an alternative with the clauses of the rule statement that wrote
// it: an extension's alternatives keep the extension's own clauses.
type sAlt struct {
	alt      *domAlt
	ruleTags *domTerm
	emit     *domEmit
	conds    []*domCond
	doc      string
	at       [2]int
}

type docDOM struct {
	path string
	dom  *domDoc
}

// maxAnd is the most items an & may join: it expands to 2ⁿ−1 sequences
// (engine §3.2, §9).
const maxAnd = 16

func isTerminalName(name string) bool {
	return name != "" && name[0] >= 'A' && name[0] <= 'Z'
}

func stitch(stageName string, docs []docDOM) (*stageGrammar, *Error) {
	g := &stageGrammar{name: stageName, byName: map[string]*sRule{}, elidable: map[string]bool{}}
	fail := func(doc string, at [2]int, format string, args ...any) *Error {
		e := grammarError(doc, at, format, args...)
		e.Stage = stageName
		return e
	}
	var ambiguity []*domDirective
	for _, d := range docs {
		defined := map[string]bool{}
		for _, r := range d.dom.Rules {
			alts := make([]*sAlt, len(r.Alternatives))
			for i, a := range r.Alternatives {
				alts[i] = &sAlt{alt: a, ruleTags: r.Tags, emit: r.Emit, conds: r.Conditions, doc: d.path, at: r.At}
			}
			existing := g.byName[r.Name]
			// Each way of stating a rule says what it expects to be there
			// already (engine §2).
			switch r.Op {
			case "define":
				if existing != nil {
					return nil, fail(d.path, r.At, "%%rule %s is already defined, in %s; %%redefine-rule replaces a rule", r.Name, existing.doc)
				}
				defined[r.Name] = true
				nr := &sRule{name: r.Name, alts: alts, doc: d.path, at: r.At}
				g.rules = append(g.rules, nr)
				g.byName[r.Name] = nr
			case "redefine":
				if existing == nil || defined[r.Name] {
					return nil, fail(d.path, r.At, "%%redefine-rule %s replaces no rule of an earlier document", r.Name)
				}
				defined[r.Name] = true
				// The replacement keeps the place of the rule it replaces.
				g.changes = append(g.changes, stitchChange{r.Name, d.path, "replace"})
				existing.alts, existing.doc, existing.at = alts, d.path, r.At
			case "extend":
				if existing == nil {
					return nil, fail(d.path, r.At, "%%extend-rule %s extends a rule not defined before it", r.Name)
				}
				g.changes = append(g.changes, stitchChange{r.Name, d.path, "extend"})
				existing.alts = append(existing.alts, alts...)
			default:
				return nil, fail(d.path, r.At, "unknown rule operator %q", r.Op)
			}
		}
		for _, dir := range d.dom.Directives {
			switch dir.Name {
			case "ambiguity-resolution":
				ambiguity = append(ambiguity, dir)
				if len(ambiguity) > 1 {
					return nil, fail(d.path, dir.At, "stage %s has more than one %%ambiguity-resolution", stageName)
				}
				// greedy or lazy, then optionally elision-only, then
				// optionally maximal, in that order (engine §2).
				args := dir.Args
				rest := args
				if len(rest) > 0 {
					rest = rest[1:]
				}
				elisionOnly := len(rest) > 0 && rest[0] == "elision-only"
				if elisionOnly {
					rest = rest[1:]
				}
				maximal := len(rest) > 0 && rest[0] == "maximal"
				if maximal {
					rest = rest[1:]
				}
				if len(args) == 0 || (args[0] != "greedy" && args[0] != "lazy") || len(rest) > 0 {
					return nil, fail(d.path, dir.At, "%%ambiguity-resolution takes greedy or lazy, then optionally elision-only, then optionally maximal")
				}
				g.lean, g.elisionOnly, g.maximal = args[0], elisionOnly, maximal
			case "elidable":
				for _, a := range dir.Args {
					g.elidable[a] = true
				}
			default:
				return nil, fail(d.path, dir.At, "unknown directive %%%s", dir.Name)
			}
		}
	}
	if len(ambiguity) == 0 {
		e := &Error{Kind: "grammar", Stage: stageName, Message: "stage " + stageName + " has no %ambiguity-resolution"}
		if len(docs) > 0 {
			e.Document = docs[0].path
		}
		return nil, e
	}
	if g.byName["text"] == nil {
		e := &Error{Kind: "grammar", Stage: stageName, Message: "stage " + stageName + " defines no start rule text"}
		if len(docs) > 0 {
			e.Document = docs[0].path
		}
		return nil, e
	}
	for _, r := range g.rules {
		for _, a := range r.alts {
			if err := g.checkAlt(a); err != nil {
				err.Stage = stageName
				return nil, err
			}
		}
	}
	return g, nil
}

// checkAlt checks what the notation's grammar cannot state: every rule named
// is defined, and captures stand at the top level.
func (g *stageGrammar) checkAlt(a *sAlt) *Error {
	fail := func(format string, args ...any) *Error { return grammarError(a.doc, a.at, format, args...) }
	captures := map[string]bool{}
	var walk func(e *domExpr, top bool) *Error
	walk = func(e *domExpr, top bool) *Error {
		switch e.Kind {
		case exRef:
			if !isTerminalName(e.Name) && g.byName[e.Name] == nil {
				return fail("%s is not a rule of stage %s", e.Name, g.name)
			}
		case exCapture:
			if !top {
				return fail("a capture must stand at the top level of an alternative")
			}
			if captures[e.Name] {
				return fail("$%s is captured twice in one alternative", e.Name)
			}
			captures[e.Name] = true
			if len(captures) > 4 {
				return fail("an alternative has at most four captures")
			}
			if e.Inner.Kind != exRef && e.Inner.Kind != exTerminal {
				return fail("a capture wraps a single symbol")
			}
			return walk(e.Inner, false)
		case exSeq:
			for _, it := range e.Items {
				if err := walk(it, top); err != nil {
					return err
				}
			}
		case exChoice, exAnd:
			if e.Kind == exAnd && len(e.Items) > maxAnd {
				return fail("an & joins at most %d items", maxAnd)
			}
			for _, it := range e.Items {
				if err := walk(it, false); err != nil {
					return err
				}
			}
		case exOptional, exRepeat:
			return walk(e.Inner, false)
		}
		return nil
	}
	if err := walk(a.alt.Expr, true); err != nil {
		return err
	}
	var checkTerm func(t *domTerm) *Error
	var checkCond func(c *domCond) *Error
	checkTerm = func(t *domTerm) *Error {
		if t == nil {
			return nil
		}
		if t.Kind == tmRule && g.byName[t.Str] == nil {
			return fail("%s is not a rule of stage %s", t.Str, g.name)
		}
		if t.Cond != nil {
			if err := checkCond(t.Cond); err != nil {
				return err
			}
		}
		for _, it := range t.Items {
			if err := checkTerm(it); err != nil {
				return err
			}
		}
		return nil
	}
	checkCond = func(c *domCond) *Error {
		switch c.Kind {
		case cdCompare:
			if err := checkTerm(c.Left); err != nil {
				return err
			}
			return checkTerm(c.Right)
		case cdMatches:
			if g.byName[c.Rule] == nil {
				return fail("%s is not a rule of stage %s", c.Rule, g.name)
			}
			return checkTerm(c.Span)
		case cdNot:
			return checkCond(c.Inner)
		case cdAny, cdAll, cdIf:
			for _, it := range c.Items {
				if err := checkCond(it); err != nil {
					return err
				}
			}
		}
		return nil
	}
	for _, t := range []*domTerm{a.alt.Tags, a.ruleTags} {
		if err := checkTerm(t); err != nil {
			return err
		}
	}
	for _, c := range a.conds {
		if err := checkCond(c); err != nil {
			return err
		}
	}
	if a.emit != nil {
		for _, it := range a.emit.Items {
			if err := checkTerm(it.Tags); err != nil {
				return err
			}
		}
	}
	return nil
}
