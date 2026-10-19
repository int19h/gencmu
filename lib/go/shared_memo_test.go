package gencmu

import (
	"encoding/json"
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
	Dialect string          `json:"dialect"`
	Grammar string          `json:"grammar"`
	Texts   []string        `json:"texts"`
	Inputs  [][]caseToken   `json:"inputs"`
	Options []memoRunOption `json:"options"`
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
	var file struct {
		Runs []memoRun `json:"runs"`
	}
	if err := json.Unmarshal(data, &file); err != nil {
		t.Fatal(err)
	}
	return file.Runs
}

// memoDialect is a fresh dialect of a run, with a bound on its shared
// memos.
func memoDialect(t *testing.T, run memoRun, limit int) *Dialect {
	t.Helper()
	var d *Dialect
	var err error
	if run.Dialect != "" {
		d, err = LoadDialect(run.Dialect)
	} else {
		grammar := run.Grammar
		if !strings.Contains(grammar, "%ambiguity-resolution") {
			grammar = "%ambiguity-resolution greedy\n" + grammar
		}
		d, err = LoadDialectSources(oneStage(grammar), "p.md")
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

func memoParseJSON(d *Dialect, p memoParse) string {
	var res *ParseResult
	var err error
	if p.tokens == nil {
		res, err = d.Parse(p.text, p.options)
	} else {
		res, err = d.ParseTokens(p.text, inputTokensOf(p.tokens), p.options)
	}
	if err != nil {
		return fmt.Sprintf("error %v", err)
	}
	data, _ := MarshalResult(res)
	return string(data)
}

// TestSharedMemoRuns runs every order of the parses of each run on one
// dialect, with the default bound and with a bound of one entry. Each
// result must equal the result with an empty shared memo (engine §4.3).
func TestSharedMemoRuns(t *testing.T) {
	t.Parallel()
	for _, run := range memoRuns(t) {
		parses := memoParses(t, run)
		cold := memoDialect(t, run, 0)
		reference := make([]string, len(parses))
		for i, p := range parses {
			reference[i] = memoParseJSON(cold, p)
		}
		for _, limit := range []int{defaultMemoLimit, 1} {
			warm := memoDialect(t, run, limit)
			order := make([]int, len(parses))
			for i := range order {
				order[i] = i
			}
			backward := slices.Clone(order)
			slices.Reverse(backward)
			for _, o := range [][]int{order, backward, order} {
				for _, i := range o {
					if got := memoParseJSON(warm, parses[i]); got != reference[i] {
						t.Fatalf("%s%s parse %d with bound %d:\n%.400s\nnot\n%.400s", run.Dialect, run.Grammar, i, limit, got, reference[i])
					}
				}
			}
		}
	}
}

// TestConcurrentSharedMemo makes the parses of each run from several
// goroutines at once on one dialect. Continuous integration runs it
// under the race detector.
func TestConcurrentSharedMemo(t *testing.T) {
	t.Parallel()
	for _, run := range memoRuns(t) {
		parses := memoParses(t, run)
		cold := memoDialect(t, run, 0)
		reference := make([]string, len(parses))
		for i, p := range parses {
			reference[i] = memoParseJSON(cold, p)
		}
		for _, limit := range []int{defaultMemoLimit, 1} {
			shared := memoDialect(t, run, limit)
			var wg sync.WaitGroup
			failures := make(chan string, 4*len(parses))
			visited := make([][]bool, 4)
			for worker := 0; worker < 4; worker++ {
				wg.Add(1)
				visited[worker] = make([]bool, len(parses))
				go func() {
					defer wg.Done()
					// Every parse of the run, from a starting place of
					// the goroutine's own.
					for step := 0; step < len(parses); step++ {
						i := (step + worker*len(parses)/4) % len(parses)
						visited[worker][i] = true
						if got := memoParseJSON(shared, parses[i]); got != reference[i] {
							failures <- fmt.Sprintf("parse %d with bound %d on goroutine %d", i, limit, worker)
						}
					}
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

// memoRules lists the rules of the entries of every shared memo of a
// dialect.
func memoRules(d *Dialect) []string {
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
		d := memoDialect(t, run, defaultMemoLimit)
		for _, p := range memoParses(t, run) {
			memoParseJSON(d, p)
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
// dialect, so that answers repeat. No shared answer may be served while an
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
		d := memoDialect(t, run, defaultMemoLimit)
		parses := memoParses(t, run)
		for _, p := range append(slices.Clone(parses), parses...) {
			memoParseJSON(d, p)
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

func memoOneParse(t *testing.T, d *Dialect, text string, tags ...string) string {
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
	d, err := LoadDialectSources(oneStage(memoOne), "p.md")
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
	d, err := LoadDialectSources(oneStage(memoOne), "p.md")
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
		d := memoDialect(t, run, defaultMemoLimit)
		for _, p := range memoParses(t, run) {
			memoParseJSON(d, p)
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

// TestSharedMemoTwoDialects parses in turn on two dialects whose probe
// reads other tags. Neither serves the other's answers.
func TestSharedMemoTwoDialects(t *testing.T) {
	t.Parallel()
	grammars := []string{memoOne, strings.Replace(memoOne, "%rule probe W", "%rule probe X", 1)}
	tags := []string{"W", "X"}
	var reference [2][2]string
	var warm [2]*Dialect
	for g, grammar := range grammars {
		cold, err := LoadDialectSources(oneStage(grammar), "p.md")
		if err != nil {
			t.Fatal(err)
		}
		cold.setMemoLimit(0)
		for i, tag := range tags {
			reference[g][i] = memoOneParse(t, cold, "x", tag)
		}
		if warm[g], err = LoadDialectSources(oneStage(grammar), "p.md"); err != nil {
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
