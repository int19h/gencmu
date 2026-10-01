package gencmu

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
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
	ID              string
	Text            string
	Dialect         string
	Features        []string
	WithoutFeatures []string
	fields          map[string]any // the fields compared
}

var corpusFields = []string{"expect", "verdict", "stage", "error", "ties", "words", "brackets"}

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
			c := &corpusCase{}
			if err := json.Unmarshal([]byte(line), c); err != nil {
				t.Fatalf("%s: %v", f, err)
			}
			var all map[string]any
			json.Unmarshal([]byte(line), &all)
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
	res, err := d.Parse(c.Text, ParseOptions{Features: c.Features, WithoutFeatures: c.WithoutFeatures})
	if err != nil {
		return nil, err
	}
	data, _ := MarshalResult(res)
	var canonical any
	if err := json.Unmarshal(data, &canonical); err != nil {
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

// The corpus runner refuses a result that breaks an invariant of a tie,
// whatever the case expects (tests/README.md).
func TestCorpusRunnerInvariants(t *testing.T) {
	const id = "cll.10.124.c10e17d8" // a tie in the syntax stage
	var c *corpusCase
	for _, x := range readCorpus(t) {
		if x.ID == id {
			c = x
		}
	}
	if c == nil {
		t.Fatalf("no corpus case %s", id)
	}
	d, err := LoadDialect(c.Dialect)
	if err != nil {
		t.Fatal(err)
	}
	if f := checkCorpusCase(d, c); f != "" {
		t.Fatal(f)
	}
	res, err := d.Parse(c.Text, ParseOptions{Features: c.Features, WithoutFeatures: c.WithoutFeatures})
	if err != nil {
		t.Fatal(err)
	}
	data, _ := MarshalResult(res)
	mutants := map[string]func(got, tied map[string]any){
		"a tied stage with output": func(got, tied map[string]any) { tied["output"] = []any{} },
		"a stage with tied": func(got, tied map[string]any) {
			tied["tied"] = got["error"].(map[string]any)["readings"].([]any)[1]
		},
		"a stage after the tie": func(got, tied map[string]any) {
			got["stages"] = append(got["stages"].([]any), map[string]any{"name": "later", "verdict": VerdictUnique})
		},
		"a tree":   func(got, tied map[string]any) { got["tree"] = got["error"].(map[string]any)["readings"].([]any)[0] },
		"ok":       func(got, tied map[string]any) { got["ok"] = true },
		"no error": func(got, tied map[string]any) { got["error"] = nil },
		"an error without reason": func(got, tied map[string]any) {
			delete(got["error"].(map[string]any), "reason")
		},
		"an error of another stage": func(got, tied map[string]any) { got["error"].(map[string]any)["stage"] = "words" },
		"one reading": func(got, tied map[string]any) {
			e := got["error"].(map[string]any)
			e["readings"] = e["readings"].([]any)[:1]
		},
	}
	for name, mutate := range mutants {
		var got map[string]any
		json.Unmarshal(data, &got)
		stages := got["stages"].([]any)
		mutate(got, stages[len(stages)-1].(map[string]any))
		if _, err := corpusOutcomeOf(res, got); err == nil {
			t.Errorf("%s: the corpus runner accepts it", name)
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
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)
	t.Logf("%d cases on %d goroutines in %v; %d differ; heap obtained from the OS %d MB", len(cases), workers, time.Since(started).Round(time.Millisecond), len(failures), mem.Sys>>20)
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
		if !reflect.DeepEqual(want, have) {
			w, _ := json.Marshal(want)
			h, _ := json.Marshal(have)
			if !inCase {
				w = []byte("(absent)")
			}
			if !inGot {
				h = []byte("(absent)")
			}
			return fmt.Sprintf("%s (%s): %s expected %s, got %s", c.ID, c.Dialect, k, w, h)
		}
	}
	return ""
}
