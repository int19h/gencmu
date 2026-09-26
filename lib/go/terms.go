package gencmu

import (
	"strconv"
	"strings"
)

// Terms and conditions (engine §10).

type spanVal struct {
	a, b  int // absolute token range in the stage input
	whole bool
	tags  *tagset // for a whole capture: the captured part's tags
}

// A term is a string or a tag set (§10).
const (
	vString = iota
	vSet
)

type value struct {
	kind int
	s    string
	set  *tagset
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
			case "from", "after":
				// To the end of the input of the parse that evaluates the
				// condition (§10).
				if t.Str == "after" {
					s.a = s.b
				}
				s.b = ev.run.inputEnd
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
			// The set of the words between pauses, ., each a strong tag,
			// the empty string never among them (engine §5).
			words := map[string]bool{}
			for _, word := range strings.Split(ev.run.phonemes(ev.span(t.Items[0])), ".") {
				if word != "" {
					words[word] = true
				}
			}
			return value{kind: vSet, set: ev.in().fromMap(words)}
		case "lowercase":
			v := ev.term(t.Items[0])
			if v.kind != vString {
				panic(&parseFailure{message: "lowercase() takes a string"})
			}
			return value{kind: vString, s: ev.run.ps.uni.lowercase(v.s)}
		case "tags":
			s := ev.span(t.Items[0])
			if len(t.Items) == 2 {
				// The same parse, and the same answer, as matches().
				_, tags := ev.run.nested(ev.g, cdMatches, t.Items[1].Str, s)
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
		case "head", "tail", "last", "from", "after":
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
			default:
				eq = sameNames(ev.toSet(l), ev.toSet(r))
			}
			return eq == (c.Op == "=")
		case "∈", "∉":
			var member bool
			if l.kind == vString {
				switch r.kind {
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
	case cdMatches, cdBegins:
		ok, _ := ev.run.nested(ev.g, c.Kind, c.Rule, ev.span(c.Span))
		return ok
	case cdInitial:
		// Where the input of the parse that reads the condition begins (§10).
		return ev.span(c.Span).a == ev.run.inputStart
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

// contentKeyLimit is the longest span whose nested parses are remembered by
// content, so that a word repeated at many places is parsed once; a longer
// span is remembered by position, since a key of content costs as much as
// the span is long, and the span of from() or after() runs to the end of
// the input (engine §4).
const contentKeyLimit = 64

// nested parses tokens [s.a, s.b) alone as rule (engine §4, nested parses)
// for a query of one kind: cdMatches, which also gives the tags of
// tags(span, rule), or cdBegins, whether a prefix of the span, the empty one
// included, parses as rule. The answer is remembered for the whole parse.
func (run *stageRun) nested(g *lowered, kind, rule string, s spanVal) (bool, *tagset) {
	ps := run.ps
	start := g.byName[rule]
	k := nestedKey{g: g, kind: kind, rule: start, a: s.a, b: s.b}
	if s.b-s.a <= contentKeyLimit {
		k.content, k.a, k.b = run.spanContent(s), -1, -1
	}
	if r, ok := ps.nested[k]; ok {
		return r.holds, r.tags
	}
	at := spanKey{g: g, rule: start, a: s.a, b: s.b}
	// A query about the span as the rule from inside its own parse, of any
	// kind, negated or not, defines the rule in terms of itself.
	if ps.inProgress[at] {
		panic(&parseFailure{
			message:  "a condition asks whether its own span parses as " + rule + ", which defines " + rule + " in terms of itself over the same text",
			token:    s.a,
			hasToken: true,
			tokenEnd: s.b,
			rule:     rule,
		})
	}
	ps.inProgress[at] = true
	defer delete(ps.inProgress, at)
	rec := run.recognize(g, start, s.a, s.b-s.a)
	res := &nestedResult{}
	if kind == cdBegins {
		res.holds = rec.begun(start)
	} else {
		acc := rec.accepted(start)
		res.holds, res.tags = len(acc) > 0, ps.in.empty()
		for _, c := range acc {
			res.tags = ps.in.union(res.tags, c.tags)
		}
	}
	ps.nested[k] = res
	return res.holds, res.tags
}

// spanContent is everything a nested parse of a span can observe: the
// original text that holds its tokens' sources, and each token's text,
// phonemes, tags with their strengths, and source.
func (run *stageRun) spanContent(s spanVal) string {
	var key strings.Builder
	// Each field is written with its length before it, so that no two
	// contents give the same key, whatever characters the fields hold.
	field := func(v string) {
		key.WriteString(strconv.Itoa(len(v)))
		key.WriteByte(':')
		key.WriteString(v)
	}
	// The text runs from the least source start to the greatest source end,
	// which an inserted token or an empty part can put before the first
	// token's start or after the last's.
	low, high := 0, 0
	if s.a < s.b {
		low = run.toks[s.a].Source[0]
		high = low
	}
	for i := s.a; i < s.b; i++ {
		low = min(low, run.toks[i].Source[0])
		high = max(high, run.toks[i].Source[1])
	}
	field(string(run.ps.text[low:high]))
	for i := s.a; i < s.b; i++ {
		t := &run.toks[i]
		field(t.Text)
		field(t.Phonemes)
		field(run.tagsets[i].key)
		// Where the token begins and ends in that text, which text() of a
		// part of the span reads.
		field(strconv.Itoa(t.Source[0] - low))
		field(strconv.Itoa(t.Source[1] - low))
	}
	return key.String()
}

// spanKey is a parse of tokens [a, b) as a rule, by position. The tokens of
// a lowered grammar's stage do not change within one parse: the reparse of
// elision-only, over other tokens, has a lowered grammar of its own.
type spanKey struct {
	g    *lowered
	rule int32
	a, b int
}

// nestedKey is what the answer of one kind of query about a span as a rule
// is remembered by: a short span's content, or a long span's position.
type nestedKey struct {
	g       *lowered
	kind    string
	rule    int32
	content string // a short span's content, or ""
	a, b    int    // a long span's position, or -1 where content keys it
}

// nestedResult is whether a query holds, and for matches, the tags.
type nestedResult struct {
	holds bool
	tags  *tagset
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
