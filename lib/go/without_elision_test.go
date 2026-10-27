package gencmu

import (
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestWithoutElisionEmission(t *testing.T) {
	grammar := "%rule text $x:candidate\n%emits $x:: $x.without-elision.tags(rival)\n%rule candidate X [+T]\n%rule rival X [+T] :: Aligned"
	d := mustLoad(t, oneStage("%ambiguity-resolution late-elision\n"+grammar))
	res, err := d.parseStoredTokens("x", []Token{{Text: "x", Tags: []string{"X"}, Span: [2]int{0, 1}, Source: [2]int{0, 1}}}, ParseOptions{})
	if err != nil || !res.OK || len(res.Stages[0].Output) != 1 {
		t.Fatalf("emission: %v, %+v", err, res)
	}
	if got := res.Stages[0].Output[0].Tags; len(got) != 1 || got[0] != "Aligned" {
		t.Fatalf("emission tags: %v", got)
	}
}

func TestWithoutElisionOriginalEmptySource(t *testing.T) {
	grammar := "%rule text $x:candidate Y\n%conditions $x.without-elision.matches(rival)\n%rule candidate X [+T=\"a\"]\n%rule rival X [+T=\"b\"]\n%conditions $.source-text = \"\", $.value = \"a\", $.starts-input, $.following-tokens.begins(suffix)\n%rule suffix Y"
	d := mustLoad(t, oneStage("%ambiguity-resolution late-elision\n"+grammar))
	tokens := []Token{
		{Text: "", Value: "a", Tags: []string{"X"}, Span: [2]int{0, 1}, Source: [2]int{0, 0}},
		{Text: "y", Tags: []string{"Y"}, Span: [2]int{1, 2}, Source: [2]int{0, 1}},
	}
	res, err := d.parseStoredTokens("y", tokens, ParseOptions{})
	if err != nil || !res.OK || res.Tree.Children[0].Span != [2]int{0, 1} {
		t.Fatalf("an original empty-source token lost its observations: %v, %+v", err, res)
	}
}

func TestWithoutElisionCommonEntryValue(t *testing.T) {
	grammar := "%rule text Q $x:choice\n%conditions $x.without-elision.matches(choice)\n%rule choice $p:prefix (a ≻ b)\n%rule prefix t | u\n%rule t X [+T=\"a\"]\n%conditions ¬$.starts-input\n%rule u X [+T=\"b\"]\n%conditions $.starts-input\n%rule a Y [+U]\n%rule b Y [+V]"
	d := mustLoad(t, oneStage("%ambiguity-resolution late-elision\n"+grammar))
	tokens := []Token{}
	for i, tag := range []string{"Q", "X", "Y"} {
		tokens = append(tokens, Token{Text: strings.ToLower(tag), Tags: []string{tag}, Span: [2]int{i, i + 1}, Source: [2]int{2 * i, 2*i + 1}})
	}
	res, err := d.parseStoredTokens("q x y", tokens, ParseOptions{})
	if err != nil || !res.OK || res.Tree.Children[1].Children[0].Children[0].Rule != "t" {
		t.Fatalf("saved sound changed common entry equality: %v, %+v", err, res)
	}
}

func TestWithoutElisionNestedWholeSeal(t *testing.T) {
	grammar := "%ambiguity-resolution greedy\n%rule text Q $x:outer\n%rule outer (X [+T] (a ≻ b)) ≻ (X [+U] c)\n%conditions ¬$.starts-input ⟹ $.without-elision.matches(outer)\n%rule a Y [+V]\n%rule b Y [+W]\n%rule c Y [+Z]"
	d := mustLoad(t, oneStage(grammar))
	tokens := []Token{}
	for i, tag := range []string{"Q", "X", "Y"} {
		tokens = append(tokens, Token{Text: strings.ToLower(tag), Tags: []string{tag}, Span: [2]int{i, i + 1}, Source: [2]int{2 * i, 2*i + 1}})
	}
	res, err := d.parseStoredTokens("q x y", tokens, ParseOptions{})
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
		"words.md":  "```jbogenbau\n%ambiguity-resolution greedy\n%rule text $w:word $m:mark\n%emits $w ($m)\n%rule word \"x\" :: X\n%rule mark \"m\" :: M\n%emits $\n```\n",
		"syntax.md": "```jbogenbau\n%ambiguity-resolution greedy\n%rule text $x:candidate\n%conditions $x.without-elision.matches(rival)\n%emits $x\n%rule candidate X [+T]\n%rule rival X [+T]\n%conditions $.source-text = \"x\", $.without-elision.tags = X\n```\n",
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
			state = m.event(state, closeEvent{record: Restoration{Terminal: "T", At: i, Source: [2]int{2 * i, 2 * i}, Value: "a", Tested: true}})
		}
		if len(m.links) > 4*n+1 || len(m.states) > n+2 || len(m.contexts) != 1 {
			t.Fatalf("%d closes retain %d links, %d states, %d contexts", n, len(m.links), len(m.states), len(m.contexts))
		}
		other := 0
		for i := 0; i < n; i++ {
			other = m.event(other, closeEvent{record: Restoration{Terminal: "T", At: i, Value: "b", Tested: true}})
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
		"closes":   "%rule text $x:candidate\n%conditions $x.without-elision.matches(rival)\n%rule candidate {piece}\n%rule piece X [+T]\n%rule rival {piece}",
		"blocks":   "%rule text $x:candidate\n%conditions $x.without-elision.matches(rival)\n%rule candidate {piece}\n%rule piece a ≻ b\n%rule a X [+T]\n%rule b X [+U]\n%rule rival {piece}",
		"wrappers": "%rule text $x:candidate\n%conditions $x.without-elision.matches(candidate)\n%rule candidate X [candidate] [+T]",
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
					res, err := d.parseStoredTokens(strings.TrimSpace(strings.Repeat("x ", n)), tokens, ParseOptions{})
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

func TestWithoutElisionSharedDoublingBound(t *testing.T) {
	data, err := os.ReadFile("../../tests/without-elision-growth.json")
	if err != nil {
		t.Fatal(err)
	}
	var shared struct {
		Case          string   `json:"case"`
		Depths        []int    `json:"depths"`
		NodesPerDepth int64    `json:"nodesPerDepth"`
		Slack         int64    `json:"slack"`
		UnusedCases   []string `json:"unusedCases"`
	}
	if err = unmarshalJSON(data, &shared); err != nil {
		t.Fatal(err)
	}
	fixture := loadCase(t, filepath.Join("../../tests", shared.Case))
	for _, depth := range shared.Depths {
		for _, witness := range []bool{false, true} {
			head := strings.Split(*fixture.Grammar, "\n")[:5]
			grammar := strings.ReplaceAll(strings.Join(head, "\n"), "r16", fmt.Sprintf("r%d", depth))
			for i := 1; i <= depth; i++ {
				grammar += fmt.Sprintf("\n%%rule r%d r%d r%d", i, i-1, i-1)
			}
			if witness {
				grammar = strings.ReplaceAll(grammar, "$x.without-elision.matches(empty)", fmt.Sprintf("¬$x.without-elision.matches(r%d)", depth))
			}
			c := *fixture
			c.Grammar = &grammar
			d, err := casePipeline(&c, true)
			if err != nil {
				t.Fatal(err)
			}
			w := &workCounts{}
			w.closeLinks.most = shared.NodesPerDepth*int64(depth+1) + shared.Slack
			countWorkIn(w, func() {
				res, err := runCase(d, &c, &c.Options)
				if err != nil || !res.OK {
					t.Fatalf("depth %d, witness %t: %v, %+v", depth, witness, err, res)
				}
			})
			t.Logf("depth %d, witness %t: %d close nodes", depth, witness, w.closeLinks.Load())
		}
	}
	for _, file := range shared.UnusedCases {
		c := loadCase(t, filepath.Join("../../tests/engine", file))
		grammar := *c.Grammar + "\n%rule unused $x:empty\n%conditions $x.without-elision.matches(empty)\n%rule empty ε"
		c.Grammar = &grammar
		d, err := casePipeline(c, true)
		if err != nil {
			t.Fatal(err)
		}
		if (&stageRun{}).closeArena(lower(d.stages[0], map[string]bool{})) != nil {
			t.Fatalf("%s created an unused close arena", file)
		}
		w := &workCounts{}
		w.closeLinks.most = 1
		w.closeStates.most = 1
		countWorkIn(w, func() {
			if err := checkCase(c, true); err != nil {
				t.Fatal(err)
			}
		})
		if w.closeLinks.Load() != 0 || w.closeStates.Load() != 0 {
			t.Fatalf("%s activated unused observations", file)
		}
	}
}

func TestWithoutElisionUndemandedRankedSibling(t *testing.T) {
	data, err := os.ReadFile("../../tests/without-elision-growth.json")
	if err != nil {
		t.Fatal(err)
	}
	var growth struct {
		RankedSibling struct {
			Case          string `json:"case"`
			Depths        []int  `json:"depths"`
			MaxCloseNodes int64  `json:"maxCloseNodes"`
		} `json:"rankedSibling"`
	}
	if err = unmarshalJSON(data, &growth); err != nil {
		t.Fatal(err)
	}
	shared := growth.RankedSibling
	fixture := loadCase(t, filepath.Join("../../tests", shared.Case))
	for _, depth := range shared.Depths {
		grammar := strings.ReplaceAll(strings.Join(strings.Split(*fixture.Grammar, "\n")[:7], "\n"), "r10", fmt.Sprintf("r%d", depth))
		for i := 1; i <= depth; i++ {
			grammar += fmt.Sprintf("\n%%rule r%d r%d r%d | [+V]", i, i-1, i-1)
		}
		results := []*ParseResult{}
		counts := []*workCounts{}
		for _, aligned := range []bool{false, true} {
			c := *fixture
			rules := grammar
			if !aligned {
				rules = strings.ReplaceAll(rules, "$x.without-elision", "$x")
			}
			c.Grammar = &rules
			d, err := casePipeline(&c, true)
			if err != nil {
				t.Fatal(err)
			}
			w := &workCounts{}
			w.closeLinks.under = &workCount{}
			w.closeLinks.under.n.Store(shared.MaxCloseNodes)
			countWorkIn(w, func() {
				result, err := runCase(d, &c, &c.Options)
				if err != nil || !result.OK {
					t.Fatalf("depth %d, aligned %t: %v, %+v", depth, aligned, err, result)
				}
				results = append(results, result)
			})
			if w.closeLinks.Load() != shared.MaxCloseNodes {
				t.Fatalf("depth %d: %d close nodes", depth, w.closeLinks.Load())
			}
			counts = append(counts, w)
		}
		if !reflect.DeepEqual(results[0], results[1]) {
			t.Fatalf("depth %d changed the ordinary result", depth)
		}
		if counts[0].items.Load() != counts[1].items.Load() {
			t.Fatalf("depth %d changed item counts: %d, %d", depth, counts[0].items.Load(), counts[1].items.Load())
		}
		t.Logf("ranked sibling depth %d: %d items, 0 close nodes", depth, counts[1].items.Load())
	}
}

func TestWithoutElisionRopeGroupingAndSharedDepth(t *testing.T) {
	m := newCloseArena()
	a := m.event(0, closeEvent{record: Restoration{Terminal: "T", At: 0}})
	b := m.event(0, closeEvent{record: Restoration{Terminal: "U", At: 0}})
	join := func(a, b int) int { return m.join(a, b, true, true) }
	left, right := join(join(a, b), a), join(a, join(b, a))
	if m.semantic(left) != m.semantic(right) || m.semantic(left) == m.semantic(join(join(a, a), b)) {
		t.Fatal("rope identity changed with grouping")
	}
	large := a
	for i := 0; i < 100; i++ {
		large = join(large, large)
	}
	if !m.aligned(large, large, 0) || m.aligned(large, join(large, large), 0) {
		t.Fatal("wrapped fingerprints changed sequence equality")
	}
	if len(m.links) > 120 {
		t.Fatalf("shared doubling stored %d nodes", len(m.links))
	}
}

func TestWithoutElisionCallerScope(t *testing.T) {
	data, err := os.ReadFile("../../tests/without-elision-growth.json")
	if err != nil {
		t.Fatal(err)
	}
	type bounds struct {
		Case           string `json:"case"`
		Lengths        []int  `json:"lengths"`
		MaxCloseNodes  int64  `json:"maxCloseNodes"`
		MaxCloseStates int64  `json:"maxCloseStates"`
		ItemsPerUnit   int64  `json:"itemsPerUnit"`
		Slack          int64  `json:"slack"`
	}
	var growth struct {
		CallerScope      bounds `json:"callerScope"`
		ImpossiblePrefix bounds `json:"impossiblePrefix"`
	}
	if err = unmarshalJSON(data, &growth); err != nil {
		t.Fatal(err)
	}
	for _, shared := range []bounds{growth.CallerScope, growth.ImpossiblePrefix} {
		fixture := loadCase(t, filepath.Join("../../tests", shared.Case))
		d, err := casePipeline(fixture, true)
		if err != nil {
			t.Fatal(err)
		}
		for _, length := range shared.Lengths {
			c := *fixture
			text := "x" + strings.Repeat("a", length)
			c.Input = &text
			w := &workCounts{}
			w.closeLinks.under = &workCount{}
			w.closeLinks.under.n.Store(shared.MaxCloseNodes)
			w.closeStates.under = &workCount{}
			w.closeStates.under.n.Store(shared.MaxCloseStates)
			w.items.under = &workCount{}
			w.items.under.n.Store(shared.ItemsPerUnit*int64(length) + shared.Slack)
			countWorkIn(w, func() {
				result, err := runCase(d, &c, &c.Options)
				if err != nil || result.OK || result.Error == nil || result.Error.Kind != "ambiguous" {
					t.Fatalf("caller scope: %v, %+v", err, result)
				}
			})
			if shared.MaxCloseNodes > 0 && w.closeStates.Load() == 0 {
				t.Fatal("no close observations")
			}
			t.Logf("%d units: %d items, %d states, %d sequences", length, w.items.Load(), w.closeStates.Load(), w.closeLinks.Load())
		}
	}
}
