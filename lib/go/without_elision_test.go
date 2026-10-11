package gencmu

import (
	"fmt"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestWithoutElisionEmission(t *testing.T) {
	grammar := "%rule text $x(candidate)\n%emits $x<tags(without-elision($x), rival)>\n%rule candidate X [+T]\n%rule rival X [+T] <~aligned>"
	d := mustLoad(t, oneStage("%ambiguity-resolution late-elision\n"+grammar))
	res, err := d.ParseTokens("x", []Token{{Text: "x", Tags: []string{"X"}, Span: [2]int{0, 1}, Source: [2]int{0, 1}}}, ParseOptions{})
	if err != nil || !res.OK || len(res.Stages[0].Output) != 1 {
		t.Fatalf("emission: %v, %+v", err, res)
	}
	if got := res.Stages[0].Output[0].Tags; len(got) != 1 || got[0] != "aligned" {
		t.Fatalf("emission tags: %v", got)
	}
}

func TestWithoutElisionOriginalEmptySource(t *testing.T) {
	grammar := "%rule text $x(candidate) Y\n%conditions matches(without-elision($x), rival)\n%rule candidate X [+T=\"a\"]\n%rule rival X [+T=\"b\"]\n%conditions text($) = \"\", phonemes($) = \"a\", initial($), begins(after($), suffix)\n%rule suffix Y"
	d := mustLoad(t, oneStage("%ambiguity-resolution late-elision\n"+grammar))
	tokens := []Token{
		{Text: "", Phonemes: "a", Tags: []string{"X"}, Span: [2]int{0, 1}, Source: [2]int{0, 0}},
		{Text: "y", Tags: []string{"Y"}, Span: [2]int{1, 2}, Source: [2]int{0, 1}},
	}
	res, err := d.ParseTokens("y", tokens, ParseOptions{})
	if err != nil || !res.OK || res.Tree.Children[0].Span != [2]int{0, 1} {
		t.Fatalf("an original empty-source token lost its observations: %v, %+v", err, res)
	}
}

func TestWithoutElisionCommonEntrySound(t *testing.T) {
	grammar := "%rule text Q $x(choice)\n%conditions matches(without-elision($x), choice)\n%rule choice $p(prefix) (a ≻ b)\n%rule prefix t | u\n%rule t X [+T=\"a\"]\n%conditions ¬initial($)\n%rule u X [+T=\"b\"]\n%conditions initial($)\n%rule a Y [+U]\n%rule b Y [+V]"
	d := mustLoad(t, oneStage("%ambiguity-resolution late-elision\n"+grammar))
	tokens := []Token{}
	for i, tag := range []string{"Q", "X", "Y"} {
		tokens = append(tokens, Token{Text: strings.ToLower(tag), Tags: []string{tag}, Span: [2]int{i, i + 1}, Source: [2]int{2 * i, 2*i + 1}})
	}
	res, err := d.ParseTokens("q x y", tokens, ParseOptions{})
	if err != nil || !res.OK || res.Tree.Children[1].Children[0].Children[0].Rule != "t" {
		t.Fatalf("saved sound changed common entry equality: %v, %+v", err, res)
	}
}

func TestWithoutElisionNestedWholeSeal(t *testing.T) {
	grammar := "%ambiguity-resolution greedy\n%rule text Q $x(outer)\n%rule outer (X [+T] (a ≻ b)) ≻ (X [+U] c)\n%conditions ¬initial($) ⟹ matches(without-elision($), outer)\n%rule a Y [+V]\n%rule b Y [+W]\n%rule c Y [+Z]"
	d := mustLoad(t, oneStage(grammar))
	tokens := []Token{}
	for i, tag := range []string{"Q", "X", "Y"} {
		tokens = append(tokens, Token{Text: strings.ToLower(tag), Tags: []string{tag}, Span: [2]int{i, i + 1}, Source: [2]int{2 * i, 2*i + 1}})
	}
	res, err := d.ParseTokens("q x y", tokens, ParseOptions{})
	if err != nil || !res.OK {
		t.Fatalf("nested whole seal: %v, %+v", err, res)
	}
	omitted := elidedNodes(res.Tree)
	if len(omitted) != 2 || omitted[0].Terminal != "T" || omitted[1].Terminal != "V" {
		t.Fatalf("the outside guard exposed a private nested option: %+v", omitted)
	}
}

func TestWithoutElisionAttachments(t *testing.T) {
	d := mustLoad(t, map[string]string{
		"p.md":      "```jbogenbau\n%stage words\n%include \"words.md\"\n%stage syntax\n%include \"syntax.md\"\n```\n",
		"words.md":  "```jbogenbau\n%ambiguity-resolution greedy\n%rule text $w(word) $m(mark)\n%emits $w ($m)\n%rule word 'x' <X>\n%rule mark 'm' <M>\n%emits $\n```\n",
		"syntax.md": "```jbogenbau\n%ambiguity-resolution greedy\n%rule text $x(candidate)\n%conditions matches(without-elision($x), rival)\n%emits $x\n%rule candidate X [+T]\n%rule rival X [+T]\n%conditions text($) = \"x\", tags(without-elision($)) = X\n```\n",
	})
	res, err := d.Parse("xm", ParseOptions{})
	if err != nil || !res.OK || len(res.Stages[1].Output) != 1 {
		t.Fatalf("attachments: %v, %+v", err, res)
	}
	output := res.Stages[1].Output[0]
	if len(output.After) != 1 || output.After[0].Text != "m" || output.Source != [2]int{0, 1} {
		t.Fatalf("the aligned view changed the original carrier or its attachment: %+v", output)
	}
}

func TestWithoutElisionMemoActiveContext(t *testing.T) {
	run := silentRun(t, 1)
	g := lower(run.grammar, map[string]bool{})
	span := spanVal{a: 0, b: 1}
	_, _, q := run.nested(g, cdMatches, "text", span)
	run.ps.nested[q.key] = &nestedResult{holds: true, tags: run.ps.in.empty()}
	run.ps.inProgress[q.at] = true
	defer func() {
		if recover() == nil {
			t.Fatal("a cached answer concealed an active query over the same original interval")
		}
	}()
	run.nested(g, cdMatches, "text", span)
}

func TestWithoutElisionCloseStorage(t *testing.T) {
	for _, n := range []int{1000, 4000} {
		m := newCloseArena()
		state := 0
		for i := 0; i < n; i++ {
			state = m.event(state, closeEvent{record: Restoration{Terminal: "T", At: i, Source: [2]int{2 * i, 2 * i}, Sound: "a", Tested: true}})
		}
		if len(m.links) > 2*n+1 || len(m.states) > n+2 || len(m.contexts) != 1 {
			t.Fatalf("%d closes retain %d links, %d states, %d contexts", n, len(m.links), len(m.states), len(m.contexts))
		}
		other := 0
		for i := 0; i < n; i++ {
			other = m.event(other, closeEvent{record: Restoration{Terminal: "T", At: i, Sound: "b", Tested: true}})
		}
		if m.semantic(state) != m.semantic(other) || !m.aligned(state, other, n) {
			t.Fatal("equal closes with different restoration sound failed to share their semantic sequence")
		}
		t.Logf("%d closes: %d retained links and %d states", n, len(m.links), len(m.states))
	}
}

func TestWithoutElisionPrefixAncestryStorage(t *testing.T) {
	m := newCloseArena()
	state := 0
	for i := 0; i < 4000; i++ {
		child := m.named(m.event(0, closeEvent{record: Restoration{Terminal: "T", At: i}}), int32(i))
		state = m.join(state, child, false, false)
		if len(m.contexts[m.states[state].context]) != 0 {
			t.Fatal("a smaller completed prefix retained ancestry in the larger interval")
		}
	}
	total := 0
	for _, context := range m.contexts {
		total += len(context)
	}
	if total > 4000 {
		t.Fatalf("trimmed prefixes retain %d named occurrences", total)
	}
	child := m.named(0, 42)
	siblings := m.join(child, child, true, true)
	if m.named(siblings, 43) == invalidCloses || m.named(siblings, 42) != invalidCloses {
		t.Fatal("siblings and repeated ancestors have the same cycle policy")
	}
	if m.seal(invalidCloses, closeEvent{}) != invalidCloses {
		t.Fatal("a seal restored an invalid proof observation")
	}
}

func TestWithoutElisionParserGrowth(t *testing.T) {
	grammars := map[string]string{
		"closes":   "%rule text $x(candidate)\n%conditions matches(without-elision($x), rival)\n%rule candidate {piece}\n%rule piece X [+T]\n%rule rival {piece}",
		"blocks":   "%rule text $x(candidate)\n%conditions matches(without-elision($x), rival)\n%rule candidate {piece}\n%rule piece a ≻ b\n%rule a X [+T]\n%rule b X [+U]\n%rule rival {piece}",
		"wrappers": "%rule text $x(candidate)\n%conditions matches(without-elision($x), candidate)\n%rule candidate X [candidate] [+T]",
	}
	for name, grammar := range grammars {
		t.Run(name, func(t *testing.T) {
			d := mustLoad(t, oneStage("%ambiguity-resolution late-elision\n"+grammar))
			var previousItems, previousLinks int64
			for _, n := range []int{12, 24, 48} {
				tokens := make([]Token, n)
				for i := range tokens {
					tokens[i] = Token{Text: "x", Tags: []string{"X"}, Span: [2]int{i, i + 1}, Source: [2]int{2 * i, 2*i + 1}}
				}
				var before, after runtime.MemStats
				runtime.ReadMemStats(&before)
				start := time.Now()
				w := &workCounts{}
				countWorkIn(w, func() {
					res, err := d.ParseTokens(strings.TrimSpace(strings.Repeat("x ", n)), tokens, ParseOptions{})
					if err != nil || !res.OK {
						t.Fatalf("%s, %d tokens: %v, %+v", name, n, err, res)
					}
				})
				runtime.ReadMemStats(&after)
				items, links := w.items.Load(), w.closeLinks.Load()
				factor := int64(3)
				if name == "wrappers" {
					factor = 5
				}
				if previousItems != 0 && (items > factor*previousItems || links > factor*previousLinks) {
					t.Fatalf("%s growth exceeded a quadratic bound: %d items, %d links", name, items, links)
				}
				if w.eligibilityRuns.Load() > 3 {
					t.Fatal("candidate endpoints repeated raw qualification over one context")
				}
				previousItems, previousLinks = items, links
				t.Logf("%s", fmt.Sprintf("%d tokens: %d items, %d edges, %d observation states, %d links, %d cycle contexts, %d summary contexts, %s, %d allocated bytes, %d heap bytes", n, items, w.packedEdges.Load(), w.closeStates.Load(), links, w.closeContexts.Load(), w.summaryContexts.Load(), time.Since(start), after.TotalAlloc-before.TotalAlloc, after.HeapAlloc))
			}
		})
	}
}
