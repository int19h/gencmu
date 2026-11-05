package gencmu

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

// The shared Lojban corpus (tests/README.md, "Corpus cases"): the core
// sample by default, every case with GENCMU_CORPUS=full. Cases run on
// GENCMU_CORPUS_WORKERS goroutines (the number of CPUs by default), which
// share one *Pipeline per pipeline.

type corpusCase struct {
	ID              string         `json:"id"`
	Text            string         `json:"text"`
	Pipeline        string         `json:"pipeline"`
	Features        []string       `json:"features"`
	WithoutFeatures []string       `json:"withoutFeatures"`
	fields          map[string]any // the fields compared
}

var corpusFields = []string{"expect", "verdict", "stage", "at", "error", "errors", "ties", "words", "brackets", "warnings"}

func readCorpus(t *testing.T) []*corpusCase {
	files, _ := filepath.Glob("../../tests/corpus/*.jsonl")
	sort.Strings(files)
	if len(files) == 0 {
		t.Fatal("no corpus in ../../tests/corpus")
	}
	var cases []*corpusCase
	for _, f := range files {
		fh, err := os.Open(f)
		if err != nil {
			t.Fatal(err)
		}
		sc := bufio.NewScanner(fh)
		sc.Buffer(make([]byte, 1<<20), 1<<26)
		for sc.Scan() {
			c, err := decodeCorpusLine(sc.Bytes())
			if err != nil {
				t.Fatalf("%s: %v", f, err)
			}
			if c != nil {
				cases = append(cases, c)
			}
		}
		fh.Close()
		if err := sc.Err(); err != nil {
			t.Fatalf("%s: %v", f, err)
		}
	}
	return cases
}

// decodeCorpusLine ignores JSON whitespace alone and decodes every other
// line unchanged, so non-JSON whitespace reaches the decoder.
func decodeCorpusLine(line []byte) (*corpusCase, error) {
	if blankJSONLine(line) {
		return nil, nil
	}
	c := &corpusCase{}
	if err := unmarshalJSON(line, c); err != nil {
		return nil, err
	}
	var all map[string]json.RawMessage
	if err := unmarshalJSON(line, &all); err != nil {
		return nil, err
	}
	c.fields = map[string]any{}
	for _, k := range corpusFields {
		if raw, ok := all[k]; ok {
			v, err := decodeJSON(raw)
			if err != nil {
				return nil, err
			}
			c.fields[k] = v
		}
	}
	return c, nil
}

func TestCorpusJSONLWhitespace(t *testing.T) {
	const record = `{"id":"record","text":"a","pipeline":"unused","expect":"reject","stage":"main","at":0}`
	for _, line := range []string{"", " ", "\t", "\r", "\n", " \t\r\n"} {
		if !blankJSONLine([]byte(line)) {
			t.Errorf("JSON whitespace is not blank: %q", line)
		}
		if c, err := decodeCorpusLine([]byte(line)); err != nil || c != nil {
			t.Errorf("blank line %q: %+v, %v", line, c, err)
		}
	}
	for _, line := range []string{record, " \t\r" + record + "\r\t "} {
		c, err := decodeCorpusLine([]byte(line))
		if err != nil || c == nil || c.ID != "record" || c.Text != "a" || c.fields["expect"] != "reject" {
			t.Errorf("valid line %q: %+v, %v", line, c, err)
		}
	}
	for _, space := range []string{"\u00a0", "\v", "\f", "\u2028", "\u2029", "\ufeff"} {
		if blankJSONLine([]byte(space)) {
			t.Errorf("non-JSON whitespace is blank: %q", space)
		}
		for _, line := range []string{space, space + record, record + space, space + record + space} {
			if c, err := decodeCorpusLine([]byte(line)); err == nil || c != nil {
				t.Errorf("accepted non-JSON whitespace: %q: %+v, %v", line, c, err)
			}
		}
		line, err := json.Marshal(map[string]any{"id": "record", "text": space, "pipeline": "unused", "expect": "reject", "stage": "main", "at": 0})
		if err != nil {
			t.Fatal(err)
		}
		c, err := decodeCorpusLine(line)
		if err != nil || c == nil || c.Text != space {
			t.Errorf("changed whitespace inside a string: %s: %+v, %v", line, c, err)
		}
	}
}

// corpusOutcome is what gencmu makes of a case, in the case's own terms.
func corpusOutcome(d *Pipeline, c *corpusCase) (map[string]any, error) {
	return corpusOutcomeLosing(d, c, "")
}

// corpusOutcomeLosing is corpusOutcome, with a private switch that loses
// the witness of each check of elision-only, or "" for none. A result with
// the error elision-witness-lost fails, whatever the case expects, and so
// does a check that did not keep its witness (tests/README.md).
func corpusOutcomeLosing(d *Pipeline, c *corpusCase, lose string) (map[string]any, error) {
	opts := ParseOptions{Features: c.Features, WithoutFeatures: c.WithoutFeatures}
	log := withChecks(&opts)
	opts.private.slotAdmission = func(stats slotStatistics) {
		if len(stats.boundarySplits) > 0 {
			data, _ := json.Marshal(struct {
				Case   string          `json:"case"`
				Groups []boundarySplit `json:"boundaryAdmissionSplits"`
			}{c.ID, stats.boundarySplits})
			fmt.Println(string(data))
		}
	}
	opts.private.loseWitness = lose
	res, err := d.Parse(c.Text, opts)
	if err != nil {
		return nil, err
	}
	if res.Error != nil && res.Error.Code != "" {
		return nil, fmt.Errorf("the result is the error %s, which no grammar gives", res.Error.Code)
	}
	if n := log.lost(); n > 0 {
		return nil, fmt.Errorf("%d checks of elision-only lost the witness of their chosen derivation", n)
	}
	data, _ := MarshalResult(res)
	canonical, err := decodeJSON(data)
	if err != nil {
		return nil, err
	}
	return corpusOutcomeOf(res, canonical)
}

// corpusOutcomeOf is the outcome of a result and its canonical JSON. The
// invariants of a tie hold of the canonical result first: a tied stage
// emits nothing and ends the run with its error (tests/README.md).
func corpusOutcomeOf(res *ParseResult, canonical any) (map[string]any, error) {
	if problems := resultProblems(canonical); len(problems) > 0 {
		return nil, fmt.Errorf("the result breaks an invariant: %s", strings.Join(problems, "; "))
	}
	got := map[string]any{}
	if res.OK {
		got["expect"] = "accept"
		got["verdict"] = res.Stages[len(res.Stages)-1].Verdict
		got["brackets"] = Brackets(res, BracketOptions{})
	} else {
		got["expect"] = "reject"
		if res.Error != nil && res.Error.Stage != "" {
			got["stage"] = res.Error.Stage
		} else {
			got["stage"] = nil
		}
		// A rejection pins where its stage stopped, as a position in the
		// text (tests/README.md). A case's numbers decode as float64.
		if res.Error != nil && res.Error.Source != nil {
			got["at"] = float64(res.Error.Source[0])
		}
	}
	if res.Error != nil && res.Error.Kind == ErrorReported {
		got["verdict"] = res.Stages[len(res.Stages)-1].Verdict
		got["error"] = map[string]any{"kind": ErrorReported}
		errors := []any{}
		for _, error := range res.Error.Errors {
			errors = append(errors, map[string]any{"code": error.Code, "at": float64(error.Source[0])})
		}
		got["errors"] = errors
	}
	warnings := []any{}
	for _, warning := range res.Warnings {
		warnings = append(warnings, map[string]any{"stage": warning.Stage, "code": warning.Code, "at": float64(warning.Source[0])})
	}
	got["warnings"] = warnings
	// An ambiguous error pins its kind and its reason (tests/README.md).
	if res.Error != nil && res.Error.Kind == ErrorAmbiguous {
		got["error"] = map[string]any{"kind": res.Error.Kind, "reason": res.Error.Reason}
	}
	var ties []any
	for _, s := range res.Stages {
		if s.Verdict == VerdictTie {
			ties = append(ties, s.Name)
		}
		if s.Name == "words" && s.Output != nil {
			// A case writes each word as its label (tests/README.md).
			words := make([]any, len(s.Output))
			for i, tok := range s.Output {
				words[i] = tok.Image
			}
			got["words"] = words
		}
	}
	if len(ties) > 0 {
		got["ties"] = ties
	}
	return got, nil
}

// corpusTieCases requires at least one case that expects a tie.
func corpusTieCases(cases []*corpusCase) ([]*corpusCase, error) {
	var ties []*corpusCase
	for _, c := range cases {
		if _, ok := c.fields["ties"]; ok {
			ties = append(ties, c)
		}
	}
	if len(ties) == 0 {
		return nil, fmt.Errorf("no corpus cases expect a tie")
	}
	return ties, nil
}

// The corpus runner refuses a result that breaks an invariant, whatever the
// case expects: each shared mutant (tests/README.md, "Result mutants").
// Each corpus case that expects a tie must also pass without a mutation.
func TestCorpusRunnerInvariants(t *testing.T) {
	for _, m := range loadResultMutants(t) {
		res, data := mutantResult(t, m)
		got := decodedResult(t, data)
		if _, err := corpusOutcomeOf(res, got); err != nil {
			t.Fatalf("%s: %v", m.Case, err)
		}
		applyMutant(t, got, m)
		if _, err := corpusOutcomeOf(res, got); err == nil {
			t.Errorf("%s: the corpus runner accepts it", m.Name)
		}
	}
	ties, err := corpusTieCases(readCorpus(t))
	if err != nil {
		t.Fatal(err)
	}
	pipelines := map[string]*Pipeline{}
	for _, c := range ties {
		d := pipelines[c.Pipeline]
		if d == nil {
			var err error
			if d, err = LoadPipeline(c.Pipeline); err != nil {
				t.Fatal(err)
			}
			pipelines[c.Pipeline] = d
		}
		if f := checkCorpusCase(d, c); f != "" {
			t.Fatal(f)
		}
	}
}

func TestCorpus(t *testing.T) {
	cases := readCorpus(t)
	full := os.Getenv("GENCMU_CORPUS") == "full"
	if !full {
		data, err := os.ReadFile("../../tests/core.txt")
		if err != nil {
			t.Fatal(err)
		}
		core := map[string]bool{}
		for _, id := range strings.Fields(string(data)) {
			core[id] = true
		}
		var sample []*corpusCase
		for _, c := range cases {
			if core[c.ID] {
				sample = append(sample, c)
			}
		}
		if len(sample) != len(core) {
			t.Fatalf("core.txt names %d ids, of which %d are cases", len(core), len(sample))
		}
		cases = sample
	}
	pipelines := map[string]*Pipeline{}
	for _, c := range cases {
		if pipelines[c.Pipeline] == nil {
			d, err := LoadPipeline(c.Pipeline)
			if err != nil {
				t.Fatalf("%s: %v", c.Pipeline, err)
			}
			pipelines[c.Pipeline] = d
		}
	}
	// The longest texts first, so that the pool is not left waiting on one.
	queue := append([]*corpusCase(nil), cases...)
	sort.SliceStable(queue, func(i, j int) bool { return len(queue[i].Text) > len(queue[j].Text) })
	workers := runtime.NumCPU()
	if s := os.Getenv("GENCMU_CORPUS_WORKERS"); s != "" {
		workers, _ = strconv.Atoi(s)
	}
	// The peak of the live heap, sampled while the cases run, for comparing
	// the memory of one version with another's (runtime.MemStats).
	var before runtime.MemStats
	runtime.ReadMemStats(&before)
	var peakAlloc, peakInuse uint64
	sampled := make(chan struct{})
	stopSampling := make(chan struct{})
	go func() {
		defer close(sampled)
		tick := time.NewTicker(250 * time.Millisecond)
		defer tick.Stop()
		for {
			var m runtime.MemStats
			runtime.ReadMemStats(&m)
			peakAlloc, peakInuse = max(peakAlloc, m.HeapAlloc), max(peakInuse, m.HeapInuse)
			select {
			case <-stopSampling:
				return
			case <-tick.C:
			}
		}
	}()
	started := time.Now()
	jobs := make(chan *corpusCase)
	var mu sync.Mutex
	var failures []string
	var wg sync.WaitGroup
	for w := 0; w < max(1, workers); w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for c := range jobs {
				failure := checkCorpusCase(pipelines[c.Pipeline], c)
				if failure != "" {
					mu.Lock()
					failures = append(failures, failure)
					mu.Unlock()
				}
			}
		}()
	}
	for _, c := range queue {
		jobs <- c
	}
	close(jobs)
	wg.Wait()
	close(stopSampling)
	<-sampled
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)
	t.Logf("%d cases on %d goroutines in %v; %d differ; live heap at peak %d MB allocated, %d MB in use; %d MB allocated in all; heap obtained from the OS %d MB", len(cases), workers, time.Since(started).Round(time.Millisecond), len(failures), peakAlloc>>20, peakInuse>>20, (mem.TotalAlloc-before.TotalAlloc)>>20, mem.Sys>>20)
	sort.Strings(failures)
	for i, f := range failures {
		if i == 20 {
			t.Errorf("... and %d more", len(failures)-20)
			break
		}
		t.Error(f)
	}
}

func checkCorpusCase(d *Pipeline, c *corpusCase) (failure string) {
	defer func() {
		if x := recover(); x != nil {
			failure = fmt.Sprintf("%s: panic: %v", c.ID, x)
		}
	}()
	got, err := corpusOutcome(d, c)
	if err != nil {
		return fmt.Sprintf("%s: %v", c.ID, err)
	}
	for _, k := range corpusFields {
		want, inCase := c.fields[k]
		have, inGot := got[k]
		if !inCase && !inGot {
			continue
		}
		if !equalJSON(want, have) {
			w, h := encodeJSON(want, 0), encodeJSON(have, 0)
			if !inCase {
				w = "(absent)"
			}
			if !inGot {
				h = "(absent)"
			}
			return fmt.Sprintf("%s (%s): %s expected %s, got %s", c.ID, c.Pipeline, k, w, h)
		}
	}
	return ""
}

func TestCorpusTieSelectionRequiresCases(t *testing.T) {
	ordinary := &corpusCase{fields: map[string]any{}}
	if got, err := corpusTieCases([]*corpusCase{ordinary}); err == nil {
		t.Errorf("accepted an empty tie selection: %v", got)
	}
	tied := &corpusCase{fields: map[string]any{"ties": []any{"syntax"}}}
	got, err := corpusTieCases([]*corpusCase{ordinary, tied})
	if err != nil || len(got) != 1 || got[0] != tied {
		t.Fatalf("lost the tie case: %v, %v", got, err)
	}
}
