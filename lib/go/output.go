package gencmu

import (
	"sort"
	"strings"
)

// resultFormat is the version of docs/output.md.
const resultFormat = 9

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
	// Present only when there is a warning.
	if len(result.Warnings) > 0 {
		w.raw(`,"warnings":[`)
		for i := range result.Warnings {
			if i > 0 {
				w.raw(",")
			}
			writeWarning(&w, &result.Warnings[i])
		}
		w.raw("]")
	}
	w.raw("}")
	return w.buf, nil
}

func writeWarning(w *jsonWriter, x *Warning) {
	w.raw(`{"stage":`)
	w.str(x.Stage)
	w.raw(`,"feature":`)
	w.str(x.Feature)
	w.raw(`,"rule":`)
	w.str(x.Rule)
	w.raw(`,"span":`)
	w.pair(x.Span)
	w.raw(`,"source":`)
	w.pair(x.Source)
	w.raw("}")
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
		w.raw("]")
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

// writeTags lists every tag once, in code point order (docs/output.md).
func writeTags(w *jsonWriter, tags []string) {
	names := append([]string{}, tags...)
	sort.Strings(names)
	w.raw("[")
	for i, n := range names {
		if i > 0 && n == names[i-1] {
			continue
		}
		if i > 0 {
			w.raw(",")
		}
		w.str(n)
	}
	w.raw("]")
}

// writeToken writes a token of a stage's output. An attached token has no
// span, and a list of attachments is present only when it is not empty
// (docs/output.md).
func writeToken(w *jsonWriter, t *Token) {
	writeTokenAs(w, t, false)
}

func writeTokenAs(w *jsonWriter, t *Token, isAttached bool) {
	// Attachments nest as deeply as the derivation that made them, so the
	// tokens being written are frames on a stack and not recursion. A
	// frame's side is 0 for its before-attachments and 1 for its
	// after-attachments, and next is the next one to write.
	type frame struct {
		t          *Token
		side, next int
	}
	open := func(t *Token, isAttached bool) {
		w.raw(`{"text":`)
		w.str(t.Text)
		w.raw(`,"phonemes":`)
		w.str(t.Phonemes)
		w.raw(`,"label":`)
		w.str(t.Label)
		w.raw(`,"tags":`)
		writeTags(w, t.Tags)
		if !isAttached {
			w.raw(`,"span":`)
			w.pair(t.Span)
		}
		w.raw(`,"source":`)
		w.pair(t.Source)
		if t.InsertedBy != "" {
			w.raw(`,"insertedBy":`)
			w.str(t.InsertedBy)
		}
	}
	keys := [2]string{"before", "after"}
	open(t, isAttached)
	stack := []*frame{{t: t}}
	for len(stack) > 0 {
		f := stack[len(stack)-1]
		if f.side == 2 {
			w.raw("}")
			stack = stack[:len(stack)-1]
			continue
		}
		list := f.t.Before
		if f.side == 1 {
			list = f.t.After
		}
		if f.next == len(list) {
			// The list is written only when it is not empty.
			if len(list) > 0 {
				w.raw("]")
			}
			f.side, f.next = f.side+1, 0
			continue
		}
		if f.next == 0 {
			w.raw(`,"` + keys[f.side] + `":[`)
		} else {
			w.raw(",")
		}
		k := &list[f.next]
		f.next++
		open(k, true)
		stack = append(stack, &frame{t: k})
	}
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
	case a.Elided != nil:
		w.raw(`{"elided":{"at":`)
		w.int(a.Elided.At)
		w.raw(`,"terminal":`)
		w.str(a.Elided.Terminal)
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
	if e.Code != "" {
		w.raw(`,"code":`)
		w.str(e.Code)
	}
	if e.Reason != "" {
		w.raw(`,"reason":`)
		w.str(e.Reason)
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
		if len(e.Witness) > 0 {
			w.raw(`,"witness":[`)
			for i, a := range e.Witness {
				if i > 0 {
					w.raw(",")
				}
				writeAction(w, a)
			}
			w.raw("]")
		}
	}
	w.raw(`,"message":`)
	w.str(e.Message)
	// The members of elision-witness-lost follow its message
	// (docs/output.md).
	if e.Code == CodeElisionWitnessLost {
		w.raw(`,"chosen":`)
		writeNode(w, e.Chosen)
		w.raw(`,"completion":[`)
		for i, r := range e.Completion {
			if i > 0 {
				w.raw(",")
			}
			w.raw(`{"terminal":`)
			w.str(r.Terminal)
			w.raw(`,"at":`)
			w.int(r.At)
			w.raw(`,"source":`)
			w.pair(r.Source)
			if r.Tested {
				w.raw(`,"sound":`)
				w.str(r.Sound)
			}
			w.raw("}")
		}
		w.raw("]")
	}
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
	// A token with attachments is a group of its before-attachments, its
	// label and its after-attachments. Attachments nest as deeply as the
	// derivation that made them, so the groups are built with a stack of
	// their own and not by recursion.
	tokenRendered := func(t *Token) *rendered {
		type tokFrame struct {
			t     *Token
			group []*rendered
			next  int // the attachment to render next, the label at len(t.Before)
		}
		var done *rendered
		stack := []*tokFrame{{t: t}}
		for len(stack) > 0 {
			f := stack[len(stack)-1]
			if done != nil {
				f.group = append(f.group, done)
				done = nil
			}
			var k *Token
			switch {
			case !hasAttachments(f.t):
				done = &rendered{leaf: f.t.Label}
			case f.next < len(f.t.Before):
				k = &f.t.Before[f.next]
			case f.next == len(f.t.Before):
				f.group = append(f.group, &rendered{leaf: f.t.Label})
				f.next++
				continue
			case f.next <= len(f.t.Before)+len(f.t.After):
				k = &f.t.After[f.next-len(f.t.Before)-1]
			default:
				done = &rendered{group: f.group}
			}
			if k != nil {
				f.next++
				if f.group == nil {
					f.group = make([]*rendered, 0, len(f.t.Before)+1+len(f.t.After))
				}
				stack = append(stack, &tokFrame{t: k})
				continue
			}
			stack = stack[:len(stack)-1]
		}
		return done
	}
	var result2 *rendered
	stack := []*frame{{n: result.Tree}}
	finish := func(f *frame) *rendered {
		switch f.n.Kind {
		case KindToken:
			// Every rendering shows a token by its label (docs/output.md),
			// and a token with attachments as a group of its
			// before-attachments, its label and its after-attachments.
			return tokenRendered(&input[f.n.Token])
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
	if result2.empty {
		return ""
	}
	// Write the groups with an explicit stack: a group's members, then its
	// closing bracket.
	type task struct {
		r     *rendered
		depth int
		close byte
		space bool
	}
	tasks := []task{{r: result2}}
	for len(tasks) > 0 {
		t := tasks[len(tasks)-1]
		tasks = tasks[:len(tasks)-1]
		if t.space {
			b.WriteByte(' ')
		}
		switch {
		case t.r == nil:
			b.WriteByte(t.close)
		case t.r.group == nil:
			b.WriteString(t.r.leaf)
		default:
			b.WriteByte("([{"[t.depth%3])
			tasks = append(tasks, task{close: ")]}"[t.depth%3]})
			for i := len(t.r.group) - 1; i >= 0; i-- {
				tasks = append(tasks, task{r: t.r.group[i], depth: t.depth + 1, space: i > 0})
			}
		}
	}
	return b.String()
}
