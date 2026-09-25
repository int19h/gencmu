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
	ID       string
	Text     string
	Dialect  string
	Features []string
	fields   map[string]any // the fields compared
}

var corpusFields = []string{"expect", "verdict", "stage", "ties", "words", "brackets"}

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
	res, err := d.Parse(c.Text, ParseOptions{Features: c.Features})
	if err != nil {
		return nil, err
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
	var ties []any
	for _, s := range res.Stages {
		if s.Verdict == VerdictTie {
			ties = append(ties, s.Name)
		}
		if s.Name == "words" && s.Output != nil {
			words := make([]any, len(s.Output))
			for i, tok := range s.Output {
				if tok.Phonemes != "" {
					words[i] = tok.Phonemes
				} else {
					words[i] = tok.Text
				}
			}
			got["words"] = words
		}
	}
	if len(ties) > 0 {
		got["ties"] = ties
	}
	return got, nil
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
