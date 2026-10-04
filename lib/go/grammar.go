package gencmu

// A stage's grammar: its documents stitched into one set of rules,
// directives, constants, classifiers and implications (engine §2).
type stageGrammar struct {
	name        string
	uni         *unicodeTable // the loader's table, for the tags of a range in a constant's value
	constants   map[string]*stageConst
	constUsers  []constUser
	rules       []*sRule
	byName      map[string]*sRule
	lean        string // the rule of the ranking: "greedy", "lazy" or "late-elision" (engine §6)
	elisionOnly bool
	maximal     bool // no terminator is elided where its constituent could have been longer (engine §4)
	changes     []stitchChange
	// classifierSet holds the stage's classifiers, and implications its
	// implications with their values (engine §2, §11).
	classifierSet stageClassifiers
	implications  []stageImplication
	// impliedBy indexes the implications by each tag of their if side.
	impliedBy map[string][]int
	// guarded are the features that guard an alternative or an entry of a
	// classifier, in code point order. Only these change a lowered grammar:
	// a gate drops an alternative, and a production lists the warnings that
	// are on. Any other name matches no guard (engine §13).
	guarded []string
}

// stitchChange records a rule a later item of the stage replaced or
// extended.
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
	opaque   bool
	doc      string
	at       [2]int
	// tests are the tests of its body with their values, in the order
	// testsIn lists them, from the constants' final values (engine §2, §4).
	tests []*symTest
}

// constValue is a constant's value (engine §2, §10): a string, or a set of
// strings or of tags, with its type.
type constValue struct {
	ty    termType // tyString, tyStrings or tyTags
	s     string
	names []string // a set's members, in code point order, each once
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

func stitch(stageName string, docs []docDOM, uni *unicodeTable) (*stageGrammar, *Error) {
	g := &stageGrammar{name: stageName, uni: uni, constants: map[string]*stageConst{}, byName: map[string]*sRule{}}
	g.classifierSet.names = map[string]bool{}
	var implications []implicationItem
	fail := func(doc string, at [2]int, format string, args ...any) *Error {
		e := grammarError(doc, at, format, args...)
		e.Stage = stageName
		return e
	}
	var ambiguity []*domDirective
	for _, d := range docs {
		for _, r := range d.dom.Rules {
			if len(constRefs(r)) > 0 {
				g.constUsers = append(g.constUsers, constUser{doc: d.path, rule: r})
			}
			alts := make([]*sAlt, len(r.Alternatives))
			for i, a := range r.Alternatives {
				alts[i] = &sAlt{alt: a, ruleTags: r.Tags, emit: r.Emit, conds: r.Conditions, opaque: r.Opaque, doc: d.path, at: r.At}
			}
			existing := g.byName[r.Name]
			// Each way of stating a rule says what it expects to be there
			// already (engine §2).
			switch r.Op {
			case "define":
				if existing != nil {
					return nil, fail(d.path, r.At, "%%rule %s is already defined, in %s; %%redefine-rule replaces a rule", r.Name, existing.doc)
				}
				nr := &sRule{name: r.Name, alts: alts, doc: d.path, at: r.At}
				g.rules = append(g.rules, nr)
				g.byName[r.Name] = nr
			case "redefine":
				// It replaces the rule of that name any earlier item of the
				// stage defined, in this document or another (engine §2).
				if existing == nil {
					return nil, fail(d.path, r.At, "%%redefine-rule %s replaces no rule defined before it", r.Name)
				}
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
				// The rule of the ranking, greedy, lazy or late-elision, then
				// optionally elision-only, then optionally maximal, in that
				// order (engine §2).
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
				if len(args) == 0 || !isRankingRule(args[0]) || len(rest) > 0 {
					return nil, fail(d.path, dir.At, "%%ambiguity-resolution takes greedy, lazy or late-elision, then optionally elision-only, then optionally maximal")
				}
				g.lean, g.elisionOnly, g.maximal = args[0], elisionOnly, maximal
			default:
				return nil, fail(d.path, dir.At, "unknown directive %%%s", dir.Name)
			}
		}
		for _, k := range d.dom.Constants {
			if err := g.addConstant(d.path, k); err != nil {
				return nil, err
			}
		}
		// Every item of a classifier's name adds to one classifier, in the
		// stitching order (engine §2).
		for _, c := range d.dom.Classifiers {
			g.classifierSet.items = append(g.classifierSet.items, classifierItem{doc: d.path, classifier: c})
			g.classifierSet.names[c.Name] = true
		}
		for _, m := range d.dom.Implications {
			implications = append(implications, implicationItem{doc: d.path, implication: m})
		}
	}
	if err := g.resolveConstants(); err != nil {
		return nil, err
	}
	if err := g.addImplications(implications); err != nil {
		return nil, err
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
	checked := &checkedClauses{terms: map[*domTerm]bool{}, conds: map[condListKey]bool{}, emits: map[*domEmit]bool{}}
	for _, r := range g.rules {
		for _, a := range r.alts {
			if err := g.checkAlt(a, checked); err != nil {
				err.Stage = stageName
				return nil, err
			}
		}
	}
	if err := g.makeTests(); err != nil {
		return nil, err
	}
	var guards, entries []domGuard
	for _, it := range g.classifierSet.items {
		for _, e := range it.classifier.Entries {
			entries = append(entries, e.Guards...)
		}
	}
	for _, r := range g.rules {
		for _, a := range r.alts {
			guards = append(guards, a.alt.Guards...)
		}
	}
	// The guards of an entry are all gates (engine §2).
	g.classifierSet.gates = guardNames(entries)
	g.guarded = guardNames(append(guards, entries...))
	return g, nil
}

// makeTests gives each test of the stitched stage's bodies its value, made
// once for every lowering.
func (g *stageGrammar) makeTests() *Error {
	for _, r := range g.rules {
		for _, a := range r.alts {
			for _, t := range testsIn(a.alt.Expr) {
				v, err := g.evaluateClosed(a.doc, t.Value, a.at)
				if err != nil {
					return err
				}
				st := &symTest{op: t.Op}
				if v.ty == tyString {
					st.sound = v.s
				} else {
					st.tags = v.names
				}
				st.written = writtenTest(t.Op, v)
				a.tests = append(a.tests, st)
			}
		}
	}
	return nil
}

// checkedClauses are the clauses that checkAlt has found sound, by
// identity. The clauses of a rule statement are shared by its
// alternatives, so each is walked once, not once for each alternative.
type checkedClauses struct {
	terms map[*domTerm]bool
	conds map[condListKey]bool
	emits map[*domEmit]bool
}

// checkAlt checks what the notation's grammar cannot state: every rule named
// is defined.
func (g *stageGrammar) checkAlt(a *sAlt, checked *checkedClauses) *Error {
	fail := func(format string, args ...any) *Error { return grammarError(a.doc, a.at, format, args...) }
	var walk func(e *domExpr) *Error
	walk = func(e *domExpr) *Error {
		if e == nil {
			return nil
		}
		if e.Kind == exRef && !isTerminalName(e.Name) && g.byName[e.Name] == nil {
			return fail("%s is not a rule of stage %s", e.Name, g.name)
		}
		if e.Kind == exAnd && len(e.Items) > maxAnd {
			return fail("an & joins at most %d items", maxAnd)
		}
		for _, it := range e.Items {
			if err := walk(it); err != nil {
				return err
			}
		}
		// A tested symbol refers to what its symbol does.
		if err := walk(e.Inner); err != nil {
			return err
		}
		return walk(e.Sep)
	}
	if err := walk(a.alt.Expr); err != nil {
		return err
	}
	var checkTerm func(t *domTerm) *Error
	var checkCond func(c *domCond) *Error
	checkTerm = func(t *domTerm) *Error {
		if t == nil {
			return nil
		}
		if w := work.Load(); w != nil {
			w.clauseSteps.add("clause steps")
		}
		if t.Kind == tmRule && g.byName[t.Str] == nil {
			return fail("%s is not a rule of stage %s", t.Str, g.name)
		}
		// A classifier that classify names belongs to the stage (§2).
		if t.Kind == tmClassifier && !g.classifierSet.names[t.Str] {
			return fail("classify() names %s, which no %%classifier of stage %s names", t.Str, g.name)
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
		if w := work.Load(); w != nil {
			w.clauseSteps.add("clause steps")
		}
		switch c.Kind {
		case cdCompare:
			if err := checkTerm(c.Left); err != nil {
				return err
			}
			return checkTerm(c.Right)
		case cdMatches, cdBegins:
			if g.byName[c.Rule] == nil {
				return fail("%s is not a rule of stage %s", c.Rule, g.name)
			}
			return checkTerm(c.Span)
		case cdInitial:
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
		if t == nil || checked.terms[t] {
			continue
		}
		if err := checkTerm(t); err != nil {
			return err
		}
		checked.terms[t] = true
	}
	if len(a.conds) > 0 {
		if key := (condListKey{&a.conds[0], len(a.conds)}); !checked.conds[key] {
			for _, c := range a.conds {
				if err := checkCond(c); err != nil {
					return err
				}
			}
			checked.conds[key] = true
		}
	}
	if a.emit != nil && !checked.emits[a.emit] {
		for _, it := range a.emit.Items {
			if err := checkTerm(it.Tags); err != nil {
				return err
			}
		}
		checked.emits[a.emit] = true
	}
	return nil
}

// isRankingRule says whether a word names the rule of a stage's ranking
// (engine §2, §6). No lean, which the check of §7 uses, has no name.
func isRankingRule(word string) bool {
	return word == "greedy" || word == "lazy" || word == "late-elision"
}
