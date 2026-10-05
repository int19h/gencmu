package gencmu

import (
	"bufio"
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
// share one *Dialect per dialect.

type corpusCase struct {
	ID              string         `json:"id"`
	Text            string         `json:"text"`
	Dialect         string         `json:"dialect"`
	Features        []string       `json:"features"`
	WithoutFeatures []string       `json:"withoutFeatures"`
	fields          map[string]any // the fields compared
}

var corpusFields = []string{"expect", "verdict", "stage", "at", "error", "ties", "words", "brackets"}

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
			line := strings.TrimSpace(sc.Text())
			if line == "" {
				continue
			}
			tree, err := decodeJSON([]byte(line))
			if err != nil {
				t.Fatalf("%s: %v", f, err)
			}
			c := &corpusCase{}
			if err := fromTree(tree, c); err != nil {
				t.Fatalf("%s: %v", f, err)
			}
			all, _ := tree.(map[string]any)
			c.fields = map[string]any{}
			for _, k := range corpusFields {
				if v, ok := all[k]; ok {
					c.fields[k] = v
				}
			}
			cases = append(cases, c)
		}
		fh.Close()
		if err := sc.Err(); err != nil {
			t.Fatalf("%s: %v", f, err)
		}
	}
	return cases
}

// corpusOutcome is what gencmu makes of a case, in the case's own terms.
func corpusOutcome(d *Dialect, c *corpusCase) (map[string]any, error) {
	return corpusOutcomeLosing(d, c, "")
}

// corpusOutcomeLosing is corpusOutcome, with a private switch that loses
// the witness of each check of elision-only, or "" for none. A result with
// the error elision-witness-lost fails, whatever the case expects, and so
// does a check that did not keep its witness (tests/README.md).
func corpusOutcomeLosing(d *Dialect, c *corpusCase, lose string) (map[string]any, error) {
	opts := ParseOptions{Features: c.Features, WithoutFeatures: c.WithoutFeatures}
	log := withChecks(&opts)
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
				words[i] = tok.Label
			}
			got["words"] = words
		}
	}
	if len(ties) > 0 {
		got["ties"] = ties
	}
	return got, nil
}

// The corpus runner refuses a result that breaks an invariant, whatever the
// case expects: each shared mutant (tests/README.md, "Result mutants"). No
// text ties in a bundled dialect, so the tied corpus cases, if any, only
// pass as they are.
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
	dialects := map[string]*Dialect{}
	for _, c := range readCorpus(t) {
		if _, ok := c.fields["ties"]; !ok {
			continue
		}
		d := dialects[c.Dialect]
		if d == nil {
			var err error
			if d, err = LoadDialect(c.Dialect); err != nil {
				t.Fatal(err)
			}
			dialects[c.Dialect] = d
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
	dialects := map[string]*Dialect{}
	for _, c := range cases {
		if dialects[c.Dialect] == nil {
			d, err := LoadDialect(c.Dialect)
			if err != nil {
				t.Fatalf("%s: %v", c.Dialect, err)
			}
			dialects[c.Dialect] = d
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
				failure := checkCorpusCase(dialects[c.Dialect], c)
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

func checkCorpusCase(d *Dialect, c *corpusCase) (failure string) {
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
			return fmt.Sprintf("%s (%s): %s expected %s, got %s", c.ID, c.Dialect, k, w, h)
		}
	}
	return ""
}
