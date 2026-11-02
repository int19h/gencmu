package gencmu

import (
	"fmt"
	"os"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

// memoRun is one run of tests/shared-memo.json (tests/README.md).
type memoRun struct {
	Pipeline string          `json:"pipeline"`
	Grammar  string          `json:"grammar"`
	Texts    []string        `json:"texts"`
	Inputs   [][]caseToken   `json:"inputs"`
	Options  []memoRunOption `json:"options"`
}

type memoRunOption struct {
	Features        []string `json:"features"`
	WithoutFeatures []string `json:"withoutFeatures"`
	Until           string   `json:"until"`
	ElisionOnly     *bool    `json:"elisionOnly"`
}

// memoParse is one parse of a run: a text or tokens, under options.
type memoParse struct {
	text    string
	tokens  []Token
	options ParseOptions
}

func memoRuns(t *testing.T) []memoRun {
	t.Helper()
	data, err := os.ReadFile("../../tests/shared-memo.json")
	if err != nil {
		t.Fatal(err)
	}
	runs, err := decodeMemoRuns(data)
	if err != nil {
		t.Fatal(err)
	}
	return runs
}

func decodeMemoRuns(data []byte) ([]memoRun, error) {
	raw, err := decodeJSON(data)
	if err != nil {
		return nil, err
	}
	if err := memoRunsSchema(raw); err != nil {
		return nil, err
	}
	var file struct {
		Runs []memoRun `json:"runs"`
	}
	if err := unmarshalJSON(data, &file); err != nil {
		return nil, err
	}
	return file.Runs, nil
}

// memoPipeline is a fresh pipeline of a run, with a bound on its shared
// memos.
func memoPipeline(t *testing.T, run memoRun, limit int) *Pipeline {
	t.Helper()
	var d *Pipeline
	var err error
	if run.Pipeline != "" {
		d, err = LoadPipeline(run.Pipeline)
	} else {
		grammar := run.Grammar
		if !strings.Contains(grammar, "%ambiguity-resolution") {
			grammar = "%ambiguity-resolution greedy\n" + grammar
		}
		d, err = LoadPipelineSources(oneStage(grammar), "p.md")
	}
	if err != nil {
		t.Fatal(err)
	}
	d.setMemoLimit(limit)
	return d
}

func memoParses(t *testing.T, run memoRun) []memoParse {
	t.Helper()
	var out []memoParse
	add := func(text string, tokens []Token) {
		for _, o := range run.Options {
			options := ParseOptions{Features: o.Features, WithoutFeatures: o.WithoutFeatures, Until: o.Until}
			if o.ElisionOnly != nil {
				options.ElisionOnly = o.ElisionOnly
			}
			out = append(out, memoParse{text, tokens, options})
		}
	}
	for _, text := range run.Texts {
		add(text, nil)
	}
	for _, input := range run.Inputs {
		tokens, text, err := caseTokens(input)
		if err != nil {
			t.Fatal(err)
		}
		add(text, tokens)
	}
	return out
}

func memoParseJSON(t *testing.T, d *Pipeline, p memoParse) string {
	t.Helper()
	data, err := memoParseOutcome(d, p)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func memoParseOutcome(d *Pipeline, p memoParse) (string, error) {
	var res *ParseResult
	var err error
	if p.tokens == nil {
		res, err = d.Parse(p.text, p.options)
	} else {
		res, err = d.ParseTokens(p.text, inputTokensOf(p.tokens), p.options)
	}
	if err != nil {
		if isGuardedCrash(err) {
			return "", err
		}
		return fmt.Sprintf("error %v", err), nil
	}
	data, _ := MarshalResult(res)
	return string(data), nil
}

// TestSharedMemoRuns runs every order of the parses of each run on one
// pipeline, with the default bound and with a bound of one entry. Each
// result must equal the result with an empty shared memo (engine §4.3).
func TestSharedMemoRuns(t *testing.T) {
	t.Parallel()
	for _, run := range memoRuns(t) {
		parses := memoParses(t, run)
		cold := memoPipeline(t, run, 0)
		reference := make([]string, len(parses))
		for i, p := range parses {
			reference[i] = memoParseJSON(t, cold, p)
		}
		for _, limit := range []int{defaultMemoLimit, 1} {
			warm := memoPipeline(t, run, limit)
			order := make([]int, len(parses))
			for i := range order {
				order[i] = i
			}
			backward := slices.Clone(order)
			slices.Reverse(backward)
			for _, o := range [][]int{order, backward, order} {
				for _, i := range o {
					if got := memoParseJSON(t, warm, parses[i]); got != reference[i] {
						t.Fatalf("%s%s parse %d with bound %d:\n%.400s\nnot\n%.400s", run.Pipeline, run.Grammar, i, limit, got, reference[i])
					}
				}
			}
		}
	}
}

// TestConcurrentSharedMemo makes the parses of each run from several
// goroutines at once on one pipeline. Continuous integration runs it
// under the race detector.
func TestConcurrentSharedMemo(t *testing.T) {
	t.Parallel()
	for _, run := range memoRuns(t) {
		parses := memoParses(t, run)
		cold := memoPipeline(t, run, 0)
		reference := make([]string, len(parses))
		for i, p := range parses {
			reference[i] = memoParseJSON(t, cold, p)
		}
		for _, limit := range []int{defaultMemoLimit, 1} {
			shared := memoPipeline(t, run, limit)
			var wg sync.WaitGroup
			failures := make(chan string, 4*len(parses))
			visited := make([][]bool, 4)
			for worker := 0; worker < 4; worker++ {
				wg.Add(1)
				visited[worker] = make([]bool, len(parses))
				go func() {
					defer wg.Done()
					memoWorker(shared, parses, reference, worker, limit, visited[worker], failures)
				}()
			}
			wg.Wait()
			close(failures)
			for failure := range failures {
				t.Error(failure)
			}
			for worker, seen := range visited {
				if slices.Contains(seen, false) {
					t.Errorf("goroutine %d left a parse out", worker)
				}
			}
		}
	}
}

func memoWorker(shared *Pipeline, parses []memoParse, reference []string, worker, limit int, visited []bool, failures chan<- string) {
	// Every parse of the run, from the worker's own starting place.
	for step := 0; step < len(parses); step++ {
		i := (step + worker*len(parses)/4) % len(parses)
		visited[i] = true
		got, err := memoParseOutcome(shared, parses[i])
		if err != nil {
			failures <- fmt.Sprintf("parse %d with bound %d on goroutine %d: %v", i, limit, worker, err)
			continue
		}
		if got != reference[i] {
			failures <- fmt.Sprintf("parse %d with bound %d on goroutine %d", i, limit, worker)
		}
	}
}

// memoRules lists the rules of the entries of every shared memo of a
// pipeline.
func memoRules(d *Pipeline) []string {
	d.mu.Lock()
	defer d.mu.Unlock()
	var out []string
	for _, cache := range d.lowered {
		for _, entry := range cache.entries {
			if g := entry.l; g != nil {
				for _, rule := range g.memo.rules() {
					out = append(out, g.rules[rule].name)
				}
			}
		}
	}
	return out
}

// TestSharedMemoKeepsNoAlignedAnswer checks that an answer whose nested
// parse asked an aligned query, directly or through the memo of the parse,
// stays out of the shared memo, while an ordinary answer enters it (engine
// §4.3).
func TestSharedMemoKeepsNoAlignedAnswer(t *testing.T) {
	t.Parallel()
	runs := 0
	for _, run := range memoRuns(t) {
		if run.Grammar == "" || !strings.Contains(run.Grammar, "without-elision") {
			continue
		}
		runs++
		d := memoPipeline(t, run, defaultMemoLimit)
		for _, p := range memoParses(t, run) {
			memoParseJSON(t, d, p)
		}
		// driver asks an aligned query, and wrap reads driver's answer
		// from the memo of the parse.
		held := memoRules(d)
		if !slices.Contains(held, "tail") || slices.Contains(held, "driver") || slices.Contains(held, "wrap") {
			t.Fatalf("the shared memo holds %v", held)
		}
	}
	if runs != 2 {
		t.Fatalf("%d runs with without-elision, not 2", runs)
	}
}

// TestSharedMemoServesNothingWhileAligned makes each run twice on one
// pipeline, so that answers repeat. No shared answer may be served while an
// aligned query is active (engine §4.3), and ordinary ones must be. The
// test does not run in parallel, since it sets the package's hook.
func TestSharedMemoServesNothingWhileAligned(t *testing.T) {
	// The test keeps its own count of the aligned queries active, from
	// the start and end of their nested parses, apart from the library's.
	// At each hit the two counts must agree. Both rest on one
	// classification of a query as aligned, so the runs of driver and wrap
	// stand behind it.
	var during, ordinary, active, starts, desync atomic.Int64
	alignedQueryHook = func(change int) {
		active.Add(int64(change))
		if change > 0 {
			starts.Add(1)
		}
	}
	memoHitHook = func(_ int32, library int) {
		if int64(library) != active.Load() {
			desync.Add(1)
		}
		if active.Load() > 0 {
			during.Add(1)
		} else {
			ordinary.Add(1)
		}
	}
	defer func() { memoHitHook, alignedQueryHook = nil, nil }()
	for _, run := range memoRuns(t) {
		d := memoPipeline(t, run, defaultMemoLimit)
		parses := memoParses(t, run)
		for _, p := range append(slices.Clone(parses), parses...) {
			memoParseJSON(t, d, p)
		}
	}
	if active.Load() != 0 {
		t.Fatalf("%d aligned queries never ended", active.Load())
	}
	if starts.Load() == 0 {
		t.Fatal("no aligned query started")
	}
	if desync.Load() != 0 {
		t.Fatalf("the test's count and the library's differ at %d hits", desync.Load())
	}
	if during.Load() != 0 {
		t.Fatalf("%d shared hits while an aligned query was active", during.Load())
	}
	if ordinary.Load() == 0 {
		t.Fatal("no ordinary shared hit")
	}
}

// memoOne is a grammar of one query about one token.
const memoOne = "%ambiguity-resolution greedy\n%rule text $x:_ %conditions $x.matches(probe)\n%rule probe W\n"

func memoOneParse(t *testing.T, d *Pipeline, text string, tags ...string) string {
	t.Helper()
	if len(tags) == 0 {
		tags = []string{"W"}
	}
	value := text
	res, err := d.ParseTokens(text, []InputToken{{Text: text, Value: &value, Image: &value, Tags: tags, Span: [2]int{0, 1}, Source: [2]int{0, len(text)}}}, ParseOptions{})
	if err != nil {
		t.Fatal(err)
	}
	data, _ := MarshalResult(res)
	return string(data)
}

// TestSharedMemoZeroBound checks that a bound of 0 keeps and serves
// nothing. It sets the package's hook, so it does not run in parallel.
func TestSharedMemoZeroBound(t *testing.T) {
	var hits atomic.Int64
	memoHitHook = func(int32, int) { hits.Add(1) }
	defer func() { memoHitHook = nil }()
	d, err := LoadPipelineSources(oneStage(memoOne), "p.md")
	if err != nil {
		t.Fatal(err)
	}
	d.setMemoLimit(0)
	for _, text := range []string{"a", "a", "b", "a"} {
		memoOneParse(t, d, text)
	}
	if held := memoRules(d); hits.Load() != 0 || len(held) != 0 {
		t.Fatalf("%d hits, and the memo holds %v", hits.Load(), held)
	}
}

// TestSharedMemoCeiling makes three generations of distinct answers. The
// newest is all there, in the newer generation, and the oldest is gone.
func TestSharedMemoCeiling(t *testing.T) {
	var hits atomic.Int64
	memoHitHook = func(int32, int) { hits.Add(1) }
	defer func() { memoHitHook = nil }()
	d, err := LoadPipelineSources(oneStage(memoOne), "p.md")
	if err != nil {
		t.Fatal(err)
	}
	// The settled bound of engine §4.3, written out so that a changed
	// default fails here.
	bound := 8192
	reference := memoOneParse(t, d, "t0")
	accepted := strings.Contains(reference, `"ok":true`)
	for i := 0; i < 3*bound; i++ {
		if got := memoOneParse(t, d, fmt.Sprint("t", i)); strings.Contains(got, `"ok":true`) != accepted {
			t.Fatalf("parse %d: %.200s", i, got)
		}
	}
	hits.Store(0)
	for i := 2 * bound; i < 3*bound; i++ {
		memoOneParse(t, d, fmt.Sprint("t", i))
	}
	if hits.Load() != int64(bound) {
		t.Fatalf("%d answers of the newest generation served, not %d", hits.Load(), bound)
	}
	hits.Store(0)
	for i := 0; i < bound; i++ {
		memoOneParse(t, d, fmt.Sprint("t", i))
	}
	if hits.Load() != 0 {
		t.Fatalf("%d answers of the oldest generation served", hits.Load())
	}
}

// TestSharedMemoMatchesAndTagsShareOneEntry makes the shared run that asks
// matches and tags about one content. One entry serves both.
func TestSharedMemoMatchesAndTagsShareOneEntry(t *testing.T) {
	t.Parallel()
	for _, run := range memoRuns(t) {
		if !strings.Contains(run.Grammar, "$x.tags(probe) = ∅") {
			continue
		}
		d := memoPipeline(t, run, defaultMemoLimit)
		for _, p := range memoParses(t, run) {
			memoParseJSON(t, d, p)
		}
		count := 0
		for _, rule := range memoRules(d) {
			if rule == "probe" {
				count++
			}
		}
		if count != 1 {
			t.Fatalf("%d entries for probe, not 1", count)
		}
		return
	}
	t.Fatal("no run asks matches and tags")
}

// TestSharedMemoTwoPipelines parses in turn on two pipelines whose probe
// reads other tags. Neither serves the other's answers.
func TestSharedMemoTwoPipelines(t *testing.T) {
	t.Parallel()
	grammars := []string{memoOne, strings.Replace(memoOne, "%rule probe W", "%rule probe X", 1)}
	tags := []string{"W", "X"}
	var reference [2][2]string
	var warm [2]*Pipeline
	for g, grammar := range grammars {
		cold, err := LoadPipelineSources(oneStage(grammar), "p.md")
		if err != nil {
			t.Fatal(err)
		}
		cold.setMemoLimit(0)
		for i, tag := range tags {
			reference[g][i] = memoOneParse(t, cold, "x", tag)
		}
		if warm[g], err = LoadPipelineSources(oneStage(grammar), "p.md"); err != nil {
			t.Fatal(err)
		}
	}
	for round := 0; round < 2; round++ {
		for i, tag := range tags {
			for g, d := range warm {
				if got := memoOneParse(t, d, "x", tag); got != reference[g][i] {
					t.Fatalf("grammar %d, input %d, round %d", g, i, round)
				}
			}
		}
	}
}

func TestWarmMemoCannotHideSuffixRecursion(t *testing.T) {
	runs := memoRuns(t)
	pipeline := memoPipeline(t, runs[len(runs)-1], 1<<13)
	first, err := pipeline.Parse("paa", ParseOptions{})
	if err != nil || !first.OK {
		t.Fatalf("warmup: %v %+v", err, first)
	}
	result, err := pipeline.Parse("qaa", ParseOptions{})
	if err != nil || result.OK || result.Error == nil || result.Error.Kind != ErrorGrammar {
		t.Fatalf("a warm cache hid recursion: %v %+v", err, result)
	}
}

func TestSuffixCacheHitsPreserveAlignedDependencies(t *testing.T) {
	c := loadCase(t, "../../tests/engine/retained-suffix-dependency.json")
	pipeline := memoPipeline(t, memoRun{Grammar: *c.Grammar}, 1<<13)
	result, err := pipeline.Parse("a", ParseOptions{})
	if err != nil || !result.OK {
		t.Fatalf("parse: %v %+v", err, result)
	}
	rules := memoRules(pipeline)
	if !slices.Contains(rules, "plain") || slices.Contains(rules, "driver") || slices.Contains(rules, "wrap") {
		t.Fatalf("retained suffix dependency: %v", rules)
	}
}

func TestMemoRunSchemaRejectsInvalidMembers(t *testing.T) {
	for _, token := range []string{
		`{"text":"x","tags":["X"],"bogus":true}`,
		`{"text":"x","tags":["X"],"before":[{"text":"x","tags":[],"nested-bogus":true}]}`,
		`{"text":"x","tags":["X"],"after":[{"text":"x","tags":[],"nested-bogus":true}]}`,
	} {
		raw := `{"runs":[{"grammar":"%rule text X","inputs":[[` + token + `]],"options":[{}]}]}`
		if _, err := decodeMemoRuns([]byte(raw)); err == nil {
			t.Errorf("accepted unknown token member in %s", token)
		}
	}
	for _, raw := range []string{
		`{"runs":[{"grammar":"%rule text X","unknown":true,"options":[{}]}]}`,
		`{"runs":[{"grammar":"%rule text X","options":[{"unknown":true}]}]}`,
		`{"runs":[{"grammar":"%rule text X","inputs":[[{"text":"x","tags":null}]],"options":[{}]}]}`,
	} {
		if _, err := decodeMemoRuns([]byte(raw)); err == nil {
			t.Errorf("accepted invalid memo input %s", raw)
		}
	}
}

func TestMemoRunSchemaKeepsTokenFields(t *testing.T) {
	runs, err := decodeMemoRuns([]byte(`{"runs":[{"grammar":"%rule text X","inputs":[[{"text":"x","tags":["X"],"value":"","image":"image","span":[0,1],"source":[0,1],"before":[{"text":"b","tags":[]}],"after":[{"text":"a","tags":[]}]}]],"options":[{"features":["f"],"withoutFeatures":["g"],"until":"main","elisionOnly":false}]}]}`))
	if err != nil {
		t.Fatal(err)
	}
	token := runs[0].Inputs[0][0]
	if token.Value == nil || *token.Value != "" || token.Before[0].Text != "b" || token.After[0].Text != "a" {
		t.Fatalf("the decoder lost token fields: %+v", token)
	}
}

func TestMemoRunsRejectParseCrashes(t *testing.T) {
	c := loadCase(t, "../../tests/engine/without-elision-except-owner-choice.json")
	d, err := casePipeline(c, true)
	if err != nil {
		t.Fatal(err)
	}
	tokens, text, err := caseTokens(c.Tokens)
	if err != nil {
		t.Fatal(err)
	}
	p := memoParse{text: text, tokens: tokens}
	p.options.private = &privateOptions{familyOracle: func(*recognizer, *item) { panic("memo probe crash") }}
	if data, err := memoParseOutcome(d, p); err == nil || !strings.Contains(err.Error(), "memo probe crash") {
		t.Fatalf("crash counted as a memo outcome: %q, %v", data, err)
	}
}

func TestMemoRunsKeepUsageErrors(t *testing.T) {
	d := mustLoad(t, oneStage("%ambiguity-resolution greedy\n%rule text \"a\""))
	data, err := memoParseOutcome(d, memoParse{text: "a", options: ParseOptions{Until: "missing"}})
	if err != nil || !strings.Contains(data, "missing") {
		t.Fatalf("the memo runner lost a usage error: %q, %v", data, err)
	}
}

func TestMemoWorkerReportsCrashesAndContinues(t *testing.T) {
	c := loadCase(t, "../../tests/engine/without-elision-except-owner-choice.json")
	d, err := casePipeline(c, true)
	if err != nil {
		t.Fatal(err)
	}
	tokens, text, err := caseTokens(c.Tokens)
	if err != nil {
		t.Fatal(err)
	}
	good := memoParse{text: text, tokens: tokens}
	want, err := memoParseOutcome(d, good)
	if err != nil {
		t.Fatal(err)
	}
	crash := good
	crash.options.private = &privateOptions{familyOracle: func(*recognizer, *item) { panic("worker probe crash") }}
	visited := make([]bool, 2)
	failures := make(chan string, 2)
	done := make(chan struct{})
	go func() {
		defer close(done)
		memoWorker(d, []memoParse{crash, good}, []string{"", want}, 0, 1, visited, failures)
	}()
	<-done
	close(failures)
	if slices.Contains(visited, false) {
		t.Errorf("worker skipped parses after the crash: %v", visited)
	}
	var messages []string
	for failure := range failures {
		messages = append(messages, failure)
	}
	if len(messages) != 1 || !strings.Contains(messages[0], "worker probe crash") {
		t.Errorf("worker lost the crash reason: %v", messages)
	}
}
