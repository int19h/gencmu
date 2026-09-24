package gencmu

import (
	"strings"
)

// Terms and conditions (engine §10).

type spanVal struct {
	a, b  int // absolute token range in the stage input
	whole bool
	tags  *tagset // for a whole capture: the captured part's tags
}

const (
	vString = iota
	vSet
	vList
)

type value struct {
	kind int
	s    string
	set  *tagset
	list []string
}

type evaluator struct {
	run     *stageRun
	g       *lowered
	capture func(name string) (spanVal, bool)
}

func (run *stageRun) evaluator(g *lowered, capture func(string) (spanVal, bool)) *evaluator {
	return &evaluator{run: run, g: g, capture: capture}
}

func (ev *evaluator) in() *interner { return ev.run.ps.in }

func (ev *evaluator) span(t *domTerm) spanVal {
	switch t.Kind {
	case tmCapture:
		s, ok := ev.capture(t.Str)
		if !ok {
			return spanVal{}
		}
		return s
	case tmCall:
		if len(t.Items) == 1 {
			s := ev.span(t.Items[0])
			s.whole, s.tags = false, nil
			switch t.Str {
			case "head":
				if s.b > s.a {
					s.b = s.a + 1
				}
				return s
			case "tail":
				if s.b > s.a {
					s.a++
				}
				return s
			case "last":
				if s.b > s.a {
					s.a = s.b - 1
				}
				return s
			}
		}
	}
	panic(&parseFailure{message: "not a span: " + t.Kind})
}

func (ev *evaluator) toSet(v value) *tagset {
	switch v.kind {
	case vString:
		return ev.in().single(v.s, true)
	case vList:
		m := map[string]bool{}
		for _, s := range v.list {
			m[s] = true
		}
		return ev.in().fromMap(m)
	}
	return v.set
}

func (ev *evaluator) tagsOf(t *domTerm) *tagset { return ev.toSet(ev.term(t)) }

// spanTags is tags(s): the captured part's tags for a whole capture, else
// the union of its tokens' tags.
func (ev *evaluator) spanTags(s spanVal) *tagset {
	if s.whole && s.tags != nil {
		return s.tags
	}
	in := ev.in()
	out := in.empty()
	for i := s.a; i < s.b; i++ {
		out = in.union(out, ev.run.tagsets[i])
	}
	return out
}

func (ev *evaluator) term(t *domTerm) value {
	in := ev.in()
	switch t.Kind {
	case tmLiteral:
		return value{kind: vString, s: t.Str}
	case tmWeak:
		return value{kind: vSet, set: in.single(t.Str, false)}
	case tmEmptySet:
		return value{kind: vSet, set: in.empty()}
	case tmUnion:
		out := in.empty()
		for _, it := range t.Items {
			out = in.union(out, ev.tagsOf(it))
		}
		return value{kind: vSet, set: out}
	case tmIntersection:
		out := ev.tagsOf(t.Items[0])
		for _, it := range t.Items[1:] {
			out = in.intersection(out, ev.tagsOf(it))
		}
		return value{kind: vSet, set: out}
	case tmCapture:
		return value{kind: vSet, set: ev.spanTags(ev.span(t))}
	case tmCall:
		switch t.Str {
		case "phonemes":
			return value{kind: vString, s: ev.run.phonemes(ev.span(t.Items[0]))}
		case "text":
			return value{kind: vString, s: ev.run.spanText(ev.span(t.Items[0]))}
		case "words":
			return value{kind: vList, list: strings.Fields(strings.ReplaceAll(ev.run.phonemes(ev.span(t.Items[0])), "\t", " "))}
		case "lowercase":
			v := ev.term(t.Items[0])
			if v.kind != vString {
				panic(&parseFailure{message: "lowercase() takes a string"})
			}
			return value{kind: vString, s: ev.run.ps.uni.lowercase(v.s)}
		case "tags":
			s := ev.span(t.Items[0])
			if len(t.Items) == 2 {
				_, tags := ev.run.nested(ev.g, t.Items[1].Str, s)
				return value{kind: vSet, set: tags}
			}
			return value{kind: vSet, set: ev.spanTags(s)}
		case "classes":
			all := ev.spanTags(ev.span(t.Items[0]))
			var names []string
			var strong []bool
			for i, n := range all.names {
				if isTerminalName(n) {
					names, strong = append(names, n), append(strong, all.strong[i])
				}
			}
			return value{kind: vSet, set: in.make(names, strong)}
		case "head", "tail", "last":
			return value{kind: vSet, set: ev.spanTags(ev.span(t))}
		}
	case tmIf:
		// Its term, evaluated only where its condition holds (§10).
		if ev.cond(t.Cond) {
			return value{kind: vSet, set: ev.tagsOf(t.Items[0])}
		}
		return value{kind: vSet, set: in.empty()}
	}
	panic(&parseFailure{message: "cannot evaluate term " + t.Kind + " " + t.Str})
}

func (ev *evaluator) cond(c *domCond) bool {
	switch c.Kind {
	case cdCompare:
		l, r := ev.term(c.Left), ev.term(c.Right)
		switch c.Op {
		case "=", "≠":
			var eq bool
			switch {
			case l.kind == vString && r.kind == vString:
				eq = l.s == r.s
			case l.kind == vList && r.kind == vList:
				eq = strings.Join(l.list, " ") == strings.Join(r.list, " ") && len(l.list) == len(r.list)
			default:
				eq = sameNames(ev.toSet(l), ev.toSet(r))
			}
			return eq == (c.Op == "=")
		case "∈", "∉":
			var member bool
			if l.kind == vString {
				switch r.kind {
				case vList:
					for _, s := range r.list {
						if s == l.s {
							member = true
							break
						}
					}
				case vSet:
					_, member = r.set.has(l.s)
				default:
					member = l.s == r.s
				}
			} else {
				member = subset(ev.toSet(l), ev.toSet(r))
			}
			return member == (c.Op == "∈")
		case "⊆":
			return subset(ev.toSet(l), ev.toSet(r))
		}
	case cdMatches:
		ok, _ := ev.run.nested(ev.g, c.Rule, ev.span(c.Span))
		return ok
	case cdNot:
		return !ev.cond(c.Inner)
	case cdCaptured:
		// Simplification decides every presence test (§3.6); one left here
		// asks the production.
		_, ok := ev.capture(c.Rule)
		return ok
	case cdIf:
		// The consequent only where the antecedent holds (§10).
		return !ev.cond(c.Items[0]) || ev.cond(c.Items[1])
	case cdAny:
		for _, it := range c.Items {
			if ev.cond(it) {
				return true
			}
		}
		return false
	case cdAll:
		for _, it := range c.Items {
			if !ev.cond(it) {
				return false
			}
		}
		return true
	}
	panic(&parseFailure{message: "cannot evaluate condition " + c.Kind})
}

func subset(a, b *tagset) bool {
	for _, n := range a.names {
		if _, ok := b.has(n); !ok {
			return false
		}
	}
	return true
}

// phonemes(span): the concatenation of the span's tokens' phonemes (§5).
func (run *stageRun) phonemes(s spanVal) string {
	var b strings.Builder
	for i := s.a; i < s.b; i++ {
		b.WriteString(run.toks[i].Phonemes)
	}
	return b.String()
}

// spanText is text(span): the original text from the start of the first
// token's source to the end of the last's.
func (run *stageRun) spanText(s spanVal) string {
	if s.b <= s.a {
		return ""
	}
	return string(run.ps.text[run.toks[s.a].Source[0]:run.toks[s.b-1].Source[1]])
}

// nested parses tokens [s.a, s.b) alone as rule (engine §4, nested parses),
// remembering the answer for the whole parse by everything such a parse can
// observe.
func (run *stageRun) nested(g *lowered, rule string, s spanVal) (bool, *tagset) {
	var key strings.Builder
	key.WriteString(rule)
	key.WriteByte(0)
	key.WriteString(run.spanText(s))
	for i := s.a; i < s.b; i++ {
		t := &run.toks[i]
		key.WriteByte(0)
		key.WriteString(t.Text)
		key.WriteByte(1)
		key.WriteString(t.Phonemes)
		key.WriteByte(1)
		key.WriteString(run.tagsets[i].key)
	}
	k := nestedKey{g: g, key: key.String()}
	ps := run.ps
	if r, ok := ps.nested[k]; ok {
		if !r.done {
			panic(&parseFailure{
				message:  "a condition asks whether its own span parses as " + rule + ", which defines " + rule + " by its own negation",
				token:    s.a,
				hasToken: true,
				tokenEnd: s.b,
				rule:     rule,
			})
		}
		return r.accepted, r.tags
	}
	res := &nestedResult{}
	ps.nested[k] = res
	start := g.byName[rule]
	rec := run.recognize(g, start, s.a, s.b-s.a)
	tags := ps.in.empty()
	acc := rec.accepted(start)
	for _, c := range acc {
		tags = ps.in.union(tags, c.tags)
	}
	res.done, res.accepted, res.tags = true, len(acc) > 0, tags
	return res.accepted, res.tags
}

type nestedKey struct {
	g   *lowered
	key string
}

type nestedResult struct {
	done     bool
	accepted bool
	tags     *tagset
}

// parseFailure is a grammar error found while parsing: it ends the whole
// parse (engine §4, §5).
type parseFailure struct {
	message  string
	token    int
	tokenEnd int
	hasToken bool
	rule     string
}
