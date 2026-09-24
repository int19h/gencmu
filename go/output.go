package gencmu

import (
	"sort"
	"strings"
)

// resultFormat is the version of docs/output.md.
const resultFormat = 1

// MarshalResult writes the canonical JSON of a result (docs/output.md).
func MarshalResult(result *ParseResult) ([]byte, error) {
	var w jsonWriter
	w.raw(`{"format":`)
	w.int(resultFormat)
	w.raw(`,"ok":`)
	w.bool(result.OK)
	w.raw(`,"stages":[`)
	for i := range result.Stages {
		if i > 0 {
			w.raw(",")
		}
		writeStage(&w, &result.Stages[i])
	}
	w.raw(`],"tree":`)
	writeNode(&w, result.Tree)
	w.raw(`,"error":`)
	writeError(&w, result.Error)
	w.raw("}")
	return w.buf, nil
}

func writeStage(w *jsonWriter, s *Stage) {
	w.raw(`{"name":`)
	w.str(s.Name)
	w.raw(`,"verdict":`)
	if s.Verdict == "" {
		w.raw("null")
	} else {
		w.str(s.Verdict)
	}
	if s.Verdict == VerdictTie {
		w.raw(`,"witness":[`)
		for i, a := range s.Witness {
			if i > 0 {
				w.raw(",")
			}
			writeAction(w, a)
		}
		w.raw(`],"tied":`)
		writeNode(w, s.Tied)
	}
	if s.Output != nil {
		w.raw(`,"output":[`)
		for i := range s.Output {
			if i > 0 {
				w.raw(",")
			}
			writeToken(w, &s.Output[i])
		}
		w.raw("]")
	}
	w.raw("}")
}

func writeTags(w *jsonWriter, tags map[string]bool) {
	names := make([]string, 0, len(tags))
	for n := range tags {
		names = append(names, n)
	}
	sort.Strings(names)
	w.raw("{")
	for i, n := range names {
		w.key(i == 0, n)
		w.bool(tags[n])
	}
	w.raw("}")
}

func writeToken(w *jsonWriter, t *Token) {
	w.raw(`{"text":`)
	w.str(t.Text)
	w.raw(`,"phonemes":`)
	w.str(t.Phonemes)
	w.raw(`,"tags":`)
	writeTags(w, t.Tags)
	w.raw(`,"span":`)
	w.pair(t.Span)
	w.raw(`,"source":`)
	w.pair(t.Source)
	if t.InsertedBy != "" {
		w.raw(`,"insertedBy":`)
		w.str(t.InsertedBy)
	}
	w.raw("}")
}

func writeAction(w *jsonWriter, a Action) {
	switch {
	case a.Read != nil:
		w.raw(`{"read":{"token":`)
		w.int(a.Read.Token)
		w.raw(`,"terminal":`)
		w.str(a.Read.Terminal)
		w.raw("}}")
	case a.Close != nil:
		w.raw(`{"close":{"rule":`)
		w.str(a.Close.Rule)
		w.raw(`,"production":`)
		w.int(a.Close.Production)
		w.raw(`,"span":`)
		w.pair(a.Close.Span)
		w.raw("}}")
	default:
		w.raw("null")
	}
}

// writeNode writes a tree; trees are as deep as the grammar nests, so this
// keeps its own stack.
func writeNode(w *jsonWriter, root *Node) {
	if root == nil {
		w.raw("null")
		return
	}
	type frame struct {
		n    *Node
		next int
	}
	stack := []frame{{n: root}}
	open := func(n *Node) {
		w.raw(`{"kind":`)
		w.str(n.Kind)
		switch n.Kind {
		case KindRule:
			w.raw(`,"rule":`)
			w.str(n.Rule)
		default:
			w.raw(`,"terminal":`)
			w.str(n.Terminal)
			if n.Kind == KindToken {
				w.raw(`,"token":`)
				w.int(n.Token)
			}
		}
		w.raw(`,"span":`)
		w.pair(n.Span)
		w.raw(`,"source":`)
		w.pair(n.Source)
		if n.Kind == KindRule {
			w.raw(`,"tags":`)
			writeTags(w, n.Tags)
			w.raw(`,"children":[`)
		} else {
			w.raw("}")
		}
	}
	open(root)
	if root.Kind != KindRule {
		return
	}
	for len(stack) > 0 {
		f := &stack[len(stack)-1]
		if f.next == len(f.n.Children) {
			w.raw("]}")
			stack = stack[:len(stack)-1]
			continue
		}
		c := f.n.Children[f.next]
		if f.next > 0 {
			w.raw(",")
		}
		f.next++
		open(c)
		if c.Kind == KindRule {
			stack = append(stack, frame{n: c})
		}
	}
}

func writeError(w *jsonWriter, e *ParseError) {
	if e == nil {
		w.raw("null")
		return
	}
	w.raw(`{"kind":`)
	w.str(e.Kind)
	if e.Stage != "" {
		w.raw(`,"stage":`)
		w.str(e.Stage)
	}
	if e.Token != nil {
		w.raw(`,"token":`)
		w.int(*e.Token)
	}
	if e.Source != nil {
		w.raw(`,"source":`)
		w.pair(*e.Source)
	}
	if e.Document != "" {
		w.raw(`,"document":`)
		w.str(e.Document)
	}
	if e.Line > 0 {
		w.raw(`,"line":`)
		w.int(e.Line)
		w.raw(`,"column":`)
		w.int(e.Column)
	}
	switch e.Kind {
	case ErrorRejected:
		w.raw(`,"expected":[`)
		for i, x := range e.Expected {
			if i > 0 {
				w.raw(",")
			}
			w.raw(`{"terminal":`)
			w.str(x.Terminal)
			w.raw(`,"rules":[`)
			for j, r := range x.Rules {
				if j > 0 {
					w.raw(",")
				}
				w.str(r)
			}
			w.raw("]}")
		}
		w.raw("]")
	case ErrorAmbiguous:
		w.raw(`,"readings":[`)
		for i, r := range e.Readings {
			if i > 0 {
				w.raw(",")
			}
			writeNode(w, r)
		}
		w.raw("]")
	}
	w.raw(`,"message":`)
	w.str(e.Message)
	w.raw("}")
}

// BracketOptions are the options of the bracket rendering.
type BracketOptions struct {
	// ShowElided shows elided terminators as ⟨ku⟩.
	ShowElided bool
}

// Brackets renders a result's tree as nested groups (docs/output.md,
// "Brackets"): "" for a result without a tree.
func Brackets(result *ParseResult, options BracketOptions) string {
	if result == nil || result.Tree == nil || len(result.Stages) == 0 {
		return ""
	}
	input := result.Stages[len(result.Stages)-1].Input
	// Render bottom-up: each node becomes empty, a label, or a group.
	type rendered struct {
		leaf  string
		group []*rendered
		empty bool
	}
	type frame struct {
		n    *Node
		kids []*rendered
	}
	var result2 *rendered
	stack := []*frame{{n: result.Tree}}
	finish := func(f *frame) *rendered {
		switch f.n.Kind {
		case KindToken:
			t := input[f.n.Token]
			if t.Phonemes != "" {
				return &rendered{leaf: t.Phonemes}
			}
			return &rendered{leaf: t.Text}
		case KindElided:
			if options.ShowElided {
				return &rendered{leaf: "⟨" + strings.ToLower(f.n.Terminal) + "⟩"}
			}
			return &rendered{empty: true}
		}
		var kept []*rendered
		for _, k := range f.kids {
			if !k.empty {
				kept = append(kept, k)
			}
		}
		switch len(kept) {
		case 0:
			return &rendered{empty: true}
		case 1:
			return kept[0]
		}
		return &rendered{group: kept}
	}
	for len(stack) > 0 {
		f := stack[len(stack)-1]
		if f.n.Kind == KindRule && len(f.kids) < len(f.n.Children) {
			stack = append(stack, &frame{n: f.n.Children[len(f.kids)]})
			continue
		}
		r := finish(f)
		stack = stack[:len(stack)-1]
		if len(stack) == 0 {
			result2 = r
		} else {
			parent := stack[len(stack)-1]
			parent.kids = append(parent.kids, r)
		}
	}
	var b strings.Builder
	var write func(r *rendered, depth int)
	write = func(r *rendered, depth int) {
		if r.group == nil {
			b.WriteString(r.leaf)
			return
		}
		open, close := "([{"[depth%3], ")]}"[depth%3]
		b.WriteByte(open)
		for i, k := range r.group {
			if i > 0 {
				b.WriteByte(' ')
			}
			write(k, depth+1)
		}
		b.WriteByte(close)
	}
	if !result2.empty {
		write(result2, 0)
	}
	return b.String()
}
