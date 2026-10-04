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
	// lazy, for $ of a completing item, gives its tags on first use: the
	// tag term runs only where a condition reads them (§4).
	lazy *lazyTags
}

// A term's value is a string or a set, of strings or of tags (§10). The
// reader has checked that the types agree, so a set's kind needs no mark
// here, and no value turns into another.
const (
	vString = iota
	vSet
)

type value struct {
	kind int
	s    string
	set  *tagset
}

// evaluator is what an evaluation reads: the stage run, the grammar, and
// the captures of the item or the constituent that it evaluates.
type evaluator struct {
	run     *stageRun
	g       *lowered
	capture func(name string) (spanVal, bool)
}

func (run *stageRun) evaluator(g *lowered, capture func(string) (spanVal, bool)) *evaluator {
	return &evaluator{run: run, g: g, capture: capture}
}

func (ev *evaluator) in() *interner { return ev.run.ps.in }

// lazyTags is the constituent tags of a completing item, which $ has. The
// tag term that gives them runs on first use, as part of the evaluation
// that reads them, and only where a condition reads them (§4).
type lazyTags struct {
	r           *recognizer
	p           *production
	caps        itemCaps
	origin, end int32
	tags        *tagset
}

// toSet is a value that must be a set.
func toSet(v value) *tagset {
	if v.kind != vSet {
		panic(&parseFailure{message: "expected a set"})
	}
	return v.set
}

// toStr is a value that must be a string.
func toStr(v value) string {
	if v.kind != vString {
		panic(&parseFailure{message: "expected a string"})
	}
	return v.s
}

// spanTags is tags(s): the captured part's tags for a whole capture, else
// the union of its tokens' tags. A lazy $ has its tags by now.
func (ev *evaluator) spanTags(s spanVal) *tagset {
	if s.whole && s.tags == nil && s.lazy != nil {
		s.tags = s.lazy.tags
	}
	if s.whole && s.tags != nil {
		return s.tags
	}
	if s.b <= s.a {
		return ev.in().empty()
	}
	return ev.in().unionAll(ev.run.tagsets[s.a:s.b])
}

// walk evaluates a condition or a term on a stack of frames, not of calls
// (engine §4). A query whose answer is not yet known halts the walk, which
// keeps its frames. Once the nested parse has answered, the walk goes on
// from the frame that halted, so no node is evaluated twice. The order of
// evaluation, and so of errors, is the order of a recursive evaluation.
type walk struct {
	frames []frame
	// b and v are the value of the frame that ended last: b of a
	// condition, v of a term.
	b bool
	v value
	// chain holds the calls of a span while it is read.
	chain []*domTerm
}

// frame is one node of a condition or a term, being evaluated: at says
// how far it has got, and s, v and sets keep what it has so far. A frame
// with neither a condition nor a term fills lazy with the value of the
// term above it, the tags of $.
type frame struct {
	ev   *evaluator
	c    *domCond
	t    *domTerm
	at   int
	s    spanVal
	v    value
	sets []*tagset
	lazy *lazyTags
}

// cond begins the walk of a condition.
func (w *walk) cond(ev *evaluator, c *domCond) {
	w.frames = w.frames[:0]
	w.push(frame{ev: ev, c: c})
}

// term begins the walk of a term.
func (w *walk) term(ev *evaluator, t *domTerm) {
	w.frames = w.frames[:0]
	w.push(frame{ev: ev, t: t})
}

// push enters a node, which counts as one visit before it is evaluated.
func (w *walk) push(f frame) {
	if f.lazy == nil {
		if wc := work.Load(); wc != nil {
			wc.visits.add("visits")
		}
	}
	w.frames = append(w.frames, f)
}

func (w *walk) endCond(b bool) {
	w.frames = w.frames[:len(w.frames)-1]
	w.b = b
}

func (w *walk) endTerm(v value) {
	w.frames = w.frames[:len(w.frames)-1]
	w.v = v
}

func (w *walk) endSet(set *tagset) { w.endTerm(value{kind: vSet, set: set}) }

// resume goes on with the walk until it ends, or halts for the nested parse
// that it returns. Each step works on the frame on top: it enters a child,
// ends the frame with its value, or halts and keeps it as it is.
func (w *walk) resume() *nestedQuery {
	for len(w.frames) > 0 {
		f := &w.frames[len(w.frames)-1]
		var q *nestedQuery
		switch {
		case f.c != nil:
			q = w.condStep(f)
		case f.t != nil:
			q = w.termStep(f)
		default:
			// The tag term of $ has ended. Its value is the tags.
			f.lazy.tags = toSet(w.v)
			w.frames = w.frames[:len(w.frames)-1]
		}
		if q != nil {
			return q
		}
	}
	return nil
}

// span is the value of a term that is a span: a capture, or a chain of
// calls of one argument that ends in one. It never halts, so it is read
// at once, without recursion. Each node of the chain counts as a visit.
func (w *walk) span(ev *evaluator, t *domTerm) spanVal {
	w.chain = w.chain[:0]
	for {
		if wc := work.Load(); wc != nil {
			wc.visits.add("visits")
		}
		if t.Kind != tmCall || len(t.Items) != 1 {
			break
		}
		w.chain = append(w.chain, t)
		t = t.Items[0]
	}
	if t.Kind != tmCapture {
		panic(&parseFailure{message: "not a span: " + t.Kind})
	}
	s, ok := ev.capture(t.Str)
	if !ok {
		s = spanVal{}
	}
	for i := len(w.chain) - 1; i >= 0; i-- {
		call := w.chain[i]
		s.whole, s.tags, s.lazy = false, nil, nil
		switch call.Str {
		case "head":
			if s.b > s.a {
				s.b = s.a + 1
			}
		case "tail":
			if s.b > s.a {
				s.a++
			}
		case "last":
			if s.b > s.a {
				s.a = s.b - 1
			}
		case "from", "after":
			// To the end of the input of the parse that evaluates the
			// condition (§10).
			if call.Str == "after" {
				s.a = s.b
			}
			s.b = ev.run.inputEnd
		default:
			panic(&parseFailure{message: "not a span: " + call.Kind})
		}
	}
	return s
}

// fillLazy enters the tag term of a lazy $ whose tags a frame is about to
// read, and says whether it did. Tags that need no term are set at once.
func (w *walk) fillLazy(s spanVal) bool {
	lz := s.lazy
	if !s.whole || s.tags != nil || lz == nil || lz.tags != nil {
		return false
	}
	r, p := lz.r, lz.p
	switch {
	case p.tags != nil:
		w.frames = append(w.frames, frame{lazy: lz})
		w.push(frame{ev: r.run.evaluator(r.g, r.captureFunc(p, lz.caps, lz.origin, lz.end, nil)), t: p.tags})
		return true
	case p.implicit:
		lz.tags = r.run.ps.in.all[lz.caps.at(p.capSlot[0]).tags]
	default:
		lz.tags = r.run.ps.in.empty()
	}
	return false
}

func (w *walk) termStep(f *frame) *nestedQuery {
	ev, t := f.ev, f.t
	in := ev.in()
	switch t.Kind {
	case tmString:
		w.endTerm(value{kind: vString, s: t.Str})
		return nil
	case tmTag:
		w.endSet(in.single(t.Str))
		return nil
	case tmRange:
		ps := ev.run.ps
		set := ps.ranges[t.Range]
		if set == nil {
			set = in.fromList(rangeTags(t.Range, ps.uni.isMark))
			ps.ranges[t.Range] = set
		}
		w.endSet(set)
		return nil
	case tmEmptySet:
		w.endSet(in.empty())
		return nil
	case tmConst:
		// A constant holds its final value once the stage is stitched (§2).
		v := t.value
		if v == nil {
			panic(&parseFailure{message: "the constant $" + t.Str + " has no value"})
		}
		if v.ty == tyString {
			w.endTerm(value{kind: vString, s: v.s})
			return nil
		}
		ps := ev.run.ps
		set := ps.consts[v]
		if set == nil {
			set = in.make(v.names)
			ps.consts[v] = set
		}
		w.endSet(set)
		return nil
	case tmUnion:
		// Each part, then the union of them all.
		if f.at == 0 {
			f.sets = make([]*tagset, 0, len(t.Items))
		} else {
			f.sets = append(f.sets, toSet(w.v))
		}
		if f.at == len(t.Items) {
			w.endSet(in.unionAll(f.sets))
			return nil
		}
		f.at++
		w.push(frame{ev: ev, t: t.Items[f.at-1]})
		return nil
	case tmIntersection:
		switch {
		case f.at == 1:
			f.v = value{kind: vSet, set: toSet(w.v)}
		case f.at > 1:
			f.v.set = in.intersection(f.v.set, toSet(w.v))
		}
		if f.at == len(t.Items) {
			w.endTerm(f.v)
			return nil
		}
		f.at++
		w.push(frame{ev: ev, t: t.Items[f.at-1]})
		return nil
	case tmDifference:
		switch f.at {
		case 0:
			f.at = 1
			w.push(frame{ev: ev, t: t.Items[0]})
		case 1:
			f.v, f.at = value{kind: vSet, set: toSet(w.v)}, 2
			w.push(frame{ev: ev, t: t.Items[1]})
		default:
			w.endSet(in.difference(f.v.set, toSet(w.v)))
		}
		return nil
	case tmCall:
		switch t.Str {
		case "phonemes":
			w.endTerm(value{kind: vString, s: ev.run.phonemes(w.span(ev, t.Items[0]))})
			return nil
		case "text":
			w.endTerm(value{kind: vString, s: ev.run.spanText(w.span(ev, t.Items[0]))})
			return nil
		case "split":
			// A set of strings (§10); an empty delimiter that only a parse
			// sees is an error of the grammar.
			switch f.at {
			case 0:
				f.at = 1
				w.push(frame{ev: ev, t: t.Items[0]})
			case 1:
				f.v, f.at = value{kind: vString, s: toStr(w.v)}, 2
				w.push(frame{ev: ev, t: t.Items[1]})
			default:
				delimiter := toStr(w.v)
				if delimiter == "" {
					panic(&parseFailure{message: "split has an empty delimiter"})
				}
				w.endSet(in.fromList(splitString(f.v.s, delimiter)))
			}
			return nil
		case "tag":
			if f.at == 0 {
				f.at = 1
				w.push(frame{ev: ev, t: t.Items[0]})
				return nil
			}
			name := toStr(w.v)
			if !isName(name) {
				panic(&parseFailure{message: "tag(" + strconv.Quote(name) + "): the string is not a name"})
			}
			w.endSet(in.single(name))
			return nil
		case "tags":
			if f.at == 0 {
				f.s, f.at = w.span(ev, t.Items[0]), 1
				if len(t.Items) == 1 && w.fillLazy(f.s) {
					return nil
				}
			}
			if len(t.Items) == 2 {
				// The same parse, and the same answer, as matches().
				_, tags, q := ev.run.nested(ev.g, cdMatches, t.Items[1].Str, f.s)
				if q != nil {
					return q
				}
				w.endSet(tags)
				return nil
			}
			w.endSet(ev.spanTags(f.s))
			return nil
		case "classify":
			// The classes that the classifier gives the string, for the
			// features of the parse, or none for an unknown key (§10).
			if f.at == 0 {
				f.at = 1
				w.push(frame{ev: ev, t: t.Items[0]})
				return nil
			}
			classes := ev.g.classifiers[t.Items[1].Str][toStr(w.v)]
			if classes == nil {
				w.endSet(in.empty())
				return nil
			}
			ps := ev.run.ps
			set := ps.consts[classes]
			if set == nil {
				set = in.make(classes.names)
				ps.consts[classes] = set
			}
			w.endSet(set)
			return nil
		case "classes":
			if f.at == 0 {
				f.s, f.at = w.span(ev, t.Items[0]), 1
				if w.fillLazy(f.s) {
					return nil
				}
			}
			all := ev.spanTags(f.s)
			var names []string
			for _, n := range all.names {
				if isTerminalName(n) {
					names = append(names, n)
				}
			}
			w.endSet(in.make(names))
			return nil
		}
	case tmIf:
		// Its term, evaluated only where its condition holds (§10).
		switch f.at {
		case 0:
			f.at = 1
			w.push(frame{ev: ev, c: t.Cond})
		case 1:
			if !w.b {
				w.endSet(in.empty())
				return nil
			}
			f.at = 2
			w.push(frame{ev: ev, t: t.Items[0]})
		default:
			w.endSet(toSet(w.v))
		}
		return nil
	}
	panic(&parseFailure{message: "cannot evaluate term " + t.Kind + " " + t.Str})
}

func (w *walk) condStep(f *frame) *nestedQuery {
	ev, c := f.ev, f.c
	switch c.Kind {
	case cdCompare:
		switch f.at {
		case 0:
			f.at = 1
			w.push(frame{ev: ev, t: c.Left})
			return nil
		case 1:
			f.v, f.at = w.v, 2
			w.push(frame{ev: ev, t: c.Right})
			return nil
		}
		l, r := f.v, w.v
		switch c.Op {
		case "=", "≠":
			var eq bool
			switch {
			case l.kind == vString && r.kind == vString:
				eq = l.s == r.s
			default:
				eq = toSet(l).key == toSet(r).key
			}
			w.endCond(eq == (c.Op == "="))
			return nil
		case "∈", "∉":
			// A string in a set of strings; the reader refuses any other
			// pair (§10).
			if l.kind != vString {
				panic(&parseFailure{message: "the left side of " + c.Op + " is a string"})
			}
			w.endCond(toSet(r).has(l.s) == (c.Op == "∈"))
			return nil
		case "⊆", "⊈":
			w.endCond(subset(toSet(l), toSet(r)) == (c.Op == "⊆"))
			return nil
		}
	case cdMatches, cdBegins:
		// The span is read once. A halt keeps it for the answer.
		if f.at == 0 {
			f.s, f.at = w.span(ev, c.Span), 1
		}
		ok, _, q := ev.run.nested(ev.g, c.Kind, c.Rule, f.s)
		if q != nil {
			return q
		}
		w.endCond(ok)
		return nil
	case cdInitial:
		// Where the input of the parse that reads the condition begins (§10).
		w.endCond(w.span(ev, c.Span).a == ev.run.inputStart)
		return nil
	case cdNot:
		if f.at == 0 {
			f.at = 1
			w.push(frame{ev: ev, c: c.Inner})
			return nil
		}
		w.endCond(!w.b)
		return nil
	case cdCaptured:
		// Simplification decides every presence test (§3.6); one left here
		// asks the production.
		_, ok := ev.capture(c.Rule)
		w.endCond(ok)
		return nil
	case cdIf:
		// The consequent only where the antecedent holds (§10).
		switch f.at {
		case 0:
			f.at = 1
			w.push(frame{ev: ev, c: c.Items[0]})
		case 1:
			if !w.b {
				w.endCond(true)
				return nil
			}
			f.at = 2
			w.push(frame{ev: ev, c: c.Items[1]})
		default:
			w.endCond(w.b)
		}
		return nil
	case cdAny, cdAll:
		// The parts in order, up to the first that decides: one that
		// holds decides any, and one that fails decides all.
		decides := c.Kind == cdAny
		if f.at > 0 && w.b == decides {
			w.endCond(decides)
			return nil
		}
		if f.at == len(c.Items) {
			w.endCond(!decides)
			return nil
		}
		f.at++
		w.push(frame{ev: ev, c: c.Items[f.at-1]})
		return nil
	}
	panic(&parseFailure{message: "cannot evaluate condition " + c.Kind})
}

// evaluate walks a term outside any recognition, as emission does, and
// answers each nested parse that it halts for, on a stack of its own,
// before it goes on.
func (run *stageRun) evaluate(ev *evaluator, t *domTerm) value {
	var w walk
	w.term(ev, t)
	for {
		q := w.resume()
		if q == nil {
			return w.v
		}
		run.startQuery(q)
		run.drive(q.recognizer(run))
	}
}

// phonemes(span): the canonical sound of the span, its tokens' phonemes
// joined, in lower case and without commas (§5).
func (run *stageRun) phonemes(s spanVal) string {
	var b strings.Builder
	for i := run.nextVoiced(s.a); i < s.b; i = run.nextVoiced(i + 1) {
		if w := work.Load(); w != nil {
			w.soundSteps.add("sound steps")
		}
		b.WriteString(run.sound(i))
	}
	return b.String()
}

// spanText is text(span): the original text over the source of the span's
// tokens (§1).
func (run *stageRun) spanText(s spanVal) string {
	if s.b <= s.a {
		return ""
	}
	src := run.spanSource(s.a, s.b)
	return string(run.ps.text[src[0]:src[1]])
}

// contentKeyLimit is the longest span whose nested parses are remembered by
// content, so that a word repeated at many places is parsed once; a longer
// span is remembered by position, since a key of content costs as much as
// the span is long, and the span of from() or after() runs to the end of
// the input (engine §4).
const contentKeyLimit = 64

// nested is the answer of a nested parse of tokens [s.a, s.b) alone as
// rule (engine §4, nested parses), for a query of one kind: cdMatches,
// which also gives the tags of tags(span, rule), or cdBegins, whether a
// prefix of the span, the empty one included, parses as rule. The answer
// is remembered for the whole parse. Where it is not yet known, nested
// gives the query instead, which halts the walk that asked it. The
// recognition that walks, or emission, answers it on a stack of its own.
func (run *stageRun) nested(g *lowered, kind, rule string, s spanVal) (bool, *tagset, *nestedQuery) {
	ps := run.ps
	start := g.byName[rule]
	k := nestedKey{g: g, kind: kind, rule: start, a: s.a, b: s.b}
	if s.b-s.a <= contentKeyLimit {
		k.content, k.a, k.b = run.spanContent(s), -1, -1
	}
	if r, ok := ps.nested[k]; ok {
		return r.holds, r.tags, nil
	}
	return false, nil, &nestedQuery{g: g, name: rule, start: start, key: k, at: spanKey{g: g, rule: start, a: s.a, b: s.b}}
}

// nestedQuery is a nested parse that an evaluation needs: the span at as
// the rule named name, for the query that key remembers.
type nestedQuery struct {
	g     *lowered
	name  string
	start int32
	key   nestedKey
	at    spanKey
}

// recognizer is the recognition that answers the query: its span alone,
// with its rule as the start rule, in the ordinary mode (§7.6).
func (q *nestedQuery) recognizer(run *stageRun) *recognizer {
	a, b := q.at.a, q.at.b
	r := &recognizer{run: run, g: q.g, base: a, n: b - a, lo: a, hi: b, query: q}
	r.begin(q.start)
	return r
}

// drive runs a recognition and the nested parses it needs, on a stack of
// recognitions and not of calls, so that queries nest to any depth (§4). A
// recognition that halts for a nested parse waits below the one that
// answers it, and then goes on from where it halted. Each sees its own
// input while it runs.
func (run *stageRun) drive(root *recognizer) {
	outerStart, outerEnd := run.inputStart, run.inputEnd
	frames := []*recognizer{root}
	defer func() {
		// A parse that failed frees its place, as one that finished does.
		for _, r := range frames {
			if r.query != nil {
				delete(run.ps.inProgress, r.query.at)
			}
		}
		run.inputStart, run.inputEnd = outerStart, outerEnd
	}()
	for len(frames) > 0 {
		r := frames[len(frames)-1]
		run.inputStart, run.inputEnd = r.lo, r.hi
		if q := r.resume(); q != nil {
			run.startQuery(q)
			frames = append(frames, q.recognizer(run))
			continue
		}
		frames = frames[:len(frames)-1]
		if r.query != nil {
			delete(run.ps.inProgress, r.query.at)
			run.settle(r)
		}
	}
}

// startQuery marks the span of a nested parse as running. A query about
// the span as the rule from inside its own parse, of any kind, negated or
// not, defines the rule in terms of itself.
func (run *stageRun) startQuery(q *nestedQuery) {
	ps := run.ps
	if ps.inProgress[q.at] {
		panic(&parseFailure{message: "a condition asks whether its own span parses as " + q.name + ", which defines " + q.name + " in terms of itself over the same text"})
	}
	ps.inProgress[q.at] = true
}

// settle remembers the answer of the query that a finished recognition
// answers. Each query reads only the completed items of the rule that
// have an eligible proof tree (§4).
func (run *stageRun) settle(rec *recognizer) {
	q, ps := rec.query, run.ps
	start := q.start
	res := &nestedResult{}
	if q.key.kind == cdBegins {
		res.holds = rec.begun(start)
	} else {
		// One search of eligibility over the items of every tag set, and
		// then the union of the tag sets that keep an item.
		acc := rec.accepted(start)
		var items []*item
		for _, c := range acc {
			items = append(items, c.items...)
		}
		kept := map[*item]bool{}
		for _, it := range rec.eligibleItems(items) {
			kept[it] = true
		}
		var sets []*tagset
		for _, c := range acc {
			for _, it := range c.items {
				if kept[it] {
					sets = append(sets, c.tags)
					break
				}
			}
		}
		res.holds, res.tags = len(sets) > 0, ps.in.unionAll(sets)
	}
	ps.nested[q.key] = res
}

// spanContent is everything a nested parse of a span can observe: the
// original text that holds its tokens' sources, and each token's text,
// phonemes, tags, and source.
func (run *stageRun) spanContent(s spanVal) string {
	var key strings.Builder
	// Each field is written with its length before it, so that no two
	// contents give the same key, whatever characters the fields hold.
	field := func(v string) {
		key.WriteString(strconv.Itoa(len(v)))
		key.WriteByte(':')
		key.WriteString(v)
	}
	// The text over the source of the span's tokens (§1).
	low, high := 0, 0
	if s.a < s.b {
		src := run.spanSource(s.a, s.b)
		low, high = src[0], src[1]
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
// a lowered grammar's stage do not change within one parse. The queries
// that the check of elision-only starts read the stage's own input, at
// their projected spans, with the main lowering (§4, §7.6). So they share
// the main parse's answers and active queries.
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
// parse (engine §4, §5). It has a message and no position (§13).
type parseFailure struct {
	message string
	// located says that the message begins with the document, line and
	// column at fault, as an error of lowering does (§3), and needs no
	// stage before it.
	located bool
}
