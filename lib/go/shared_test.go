package gencmu

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"runtime/debug"
	"sort"
	"strings"
	"testing"
	"time"
)

// The shared cases of tests/README.md.

type engineCase struct {
	Description string            `json:"description"`
	Grammar     *string           `json:"grammar"`
	Documents   map[string]string `json:"documents"`
	Pipeline    string            `json:"pipeline"`
	Tokens      []caseToken       `json:"tokens"`
	Input       *string           `json:"input"`
	Options     caseOptions       `json:"options"`
	Expect      caseExpect        `json:"expect"`
	// Parses, when present, parses the input several times with the one
	// loaded dialect, each with its own options and expectation, in place
	// of the case's (tests/README.md).
	Parses []struct {
		Options caseOptions `json:"options"`
		Expect  caseExpect  `json:"expect"`
	} `json:"parses"`
	// fault, which no case file sets, is a fault of the library's own
	// paths that the parses of the case turn on (faults_test.go).
	fault string
	// noHook, which no case file sets either, ignores the witness hook's
	// answer, so that only the result can fail the case, and onlyHook
	// ignores everything but the hook's answer (faults_test.go).
	noHook   bool
	onlyHook bool
	// hits, where set, records the sites of the fault that the parses
	// enter (faults_test.go).
	hits map[string]bool
}

// caseToken is a token that a case supplies (tests/README.md). Its before
// and after, which a caller cannot supply, go to the library as they
// stand, so that it refuses them or drops empty ones.
type caseToken struct {
	Text     string      `json:"text"`
	Tags     []string    `json:"tags"`
	Phonemes *string     `json:"phonemes"`
	Before   []caseToken `json:"before"`
	After    []caseToken `json:"after"`
}

type caseOptions struct {
	Features        []string `json:"features"`
	WithoutFeatures []string `json:"withoutFeatures"`
	ElisionOnly     *bool    `json:"elisionOnly"`
	AutoFeatures    *bool    `json:"autoFeatures"`
	Until           string   `json:"until"`
}

// caseExpect is what a case expects. Result, Warnings and Features are
// decoded JSON, nil where the case leaves them out.
type caseExpect struct {
	LoadWarnings *any    `json:"loadWarnings"`
	Result       *any    `json:"result"`
	Brackets     *string `json:"brackets"`
	Warnings     *any    `json:"warnings"`
	Features     *any    `json:"features"`
	Error        string  `json:"error"`
	// Where is where a load error stands (tests/README.md).
	Where *struct {
		Document string `json:"document"`
		Line     int    `json:"line"`
		Column   int    `json:"column"`
	} `json:"where"`
}

// match matches a value against a pattern (tests/README.md). It compares
// pairs from a list of work, not by recursion, in the order of a recursive
// walk: an object's members in the order of their names, depth first.
func match(pattern, value any, path string) error {
	type job struct {
		pattern, value any
		path           *jsonPath
		missing        bool
	}
	work := []job{{pattern, value, &jsonPath{step: path}, false}}
	for len(work) > 0 {
		j := work[len(work)-1]
		work = work[:len(work)-1]
		if j.missing {
			return fmt.Errorf("%s: missing", j.path)
		}
		switch p := j.pattern.(type) {
		case map[string]any:
			v, ok := j.value.(map[string]any)
			if !ok {
				return fmt.Errorf("%s: expected an object, got %s", j.path, shown(j.value))
			}
			keys := make([]string, 0, len(p))
			for k := range p {
				keys = append(keys, k)
			}
			sort.Strings(keys)
			for i := len(keys) - 1; i >= 0; i-- {
				k := keys[i]
				vv, ok := v[k]
				work = append(work, job{p[k], vv, j.path.member(k), !ok})
			}
		case []any:
			v, ok := j.value.([]any)
			if !ok || len(v) != len(p) {
				return fmt.Errorf("%s: expected an array of %d, got %s", j.path, len(p), shown(j.value))
			}
			for i := len(p) - 1; i >= 0; i-- {
				work = append(work, job{p[i], v[i], j.path.index(i), false})
			}
		default:
			if !equalJSON(j.pattern, j.value) {
				return fmt.Errorf("%s: expected %s, got %s", j.path, shown(j.pattern), shown(j.value))
			}
		}
	}
	return nil
}

func loadCase(t testing.TB, file string) *engineCase {
	data, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	c := &engineCase{}
	if err := unmarshalJSON(data, c); err != nil {
		t.Fatalf("%s: %v", file, err)
	}
	return c
}

func caseDialect(c *engineCase, noCache bool) (*Dialect, error) {
	if c.Grammar != nil {
		g := *c.Grammar
		if !strings.Contains(g, "%ambiguity-resolution") {
			g = "%ambiguity-resolution greedy\n" + g
		}
		// The grammar is main.md, whose fence is line 1 (tests/README.md).
		return loadSources(map[string]string{
			"pipeline.md": "```jbogenbau\n%stage main\n%include \"main.md\"\n```\n",
			"main.md":     "```jbogenbau\n" + g + "\n```\n",
		}, "pipeline.md", noCache)
	}
	for _, text := range c.Documents {
		if strings.Contains(text, `%include "../dialects/`) {
			documents := map[string]string{}
			err := filepath.WalkDir("../../grammars", func(path string, entry os.DirEntry, err error) error {
				if err != nil {
					return err
				}
				if !entry.IsDir() {
					raw, err := os.ReadFile(path)
					if err != nil {
						return err
					}
					key, err := filepath.Rel("../../grammars", path)
					if err != nil {
						return err
					}
					documents[filepath.ToSlash(key)] = string(raw)
				}
				return nil
			})
			if err != nil {
				return nil, err
			}
			for name, text := range c.Documents {
				documents["case/"+name] = text
			}
			return loadSources(documents, "case/"+c.Pipeline, noCache)
		}
	}
	return loadSources(c.Documents, c.Pipeline, noCache)
}

// runCase parses a case's input with a loaded dialect, under the options
// of the case or of one item of its parses.
func runCase(d *Dialect, c *engineCase, o *caseOptions) (*ParseResult, error) {
	res, _, err := runCaseLogged(d, c, o, "")
	return res, err
}

// runCaseLogged is runCase, with the checks of elision-only that ran, and
// with a private switch that loses their witness, or "" for none.
func runCaseLogged(d *Dialect, c *engineCase, o *caseOptions, lose string) (*ParseResult, *checkLog, error) {
	if err := loadBundled(); err != nil {
		return nil, nil, err
	}
	opts := ParseOptions{Features: o.Features, WithoutFeatures: o.WithoutFeatures, ElisionOnly: o.ElisionOnly, Until: o.Until, NoAutoFeatures: true}
	log := withChecks(&opts)
	opts.private.loseWitness = lose
	opts.private.fault, opts.private.hits = c.fault, c.hits
	if o.AutoFeatures != nil && *o.AutoFeatures {
		opts.NoAutoFeatures = false
	}
	var res *ParseResult
	var err error
	if c.Input != nil {
		res, err = d.Parse(*c.Input, opts)
	} else {
		toks, text, terr := caseTokens(c.Tokens)
		if terr != nil {
			return nil, nil, terr
		}
		res, err = d.ParseTokens(text, toks, opts)
	}
	return res, log, err
}

// caseTokens makes a case's tokens and the text they index
// (tests/README.md). An empty list of attachments stays an empty list, not
// nil, as a caller could give it. The attachments nest as deep as the case
// does, so each list is made from a list of work, not by recursion.
func caseTokens(specs []caseToken) ([]Token, string, error) {
	type job struct {
		specs []caseToken
		into  *[]Token
	}
	var out []Token
	work := []job{{specs, &out}}
	for len(work) > 0 {
		j := work[len(work)-1]
		work = work[:len(work)-1]
		toks := make([]Token, len(j.specs))
		pos := 0
		for i, tk := range j.specs {
			// Each tag in its canonical spelling, as the output writes it
			// (tests/README.md).
			for _, tag := range tk.Tags {
				if !isTag(tag, bundled.uni) {
					return nil, "", fmt.Errorf("a case token's tag %s is not a tag", tag)
				}
			}
			n := len([]rune(tk.Text))
			toks[i] = Token{Text: tk.Text, Tags: tk.Tags, Span: [2]int{i, i + 1}, Source: [2]int{pos, pos + n}}
			if tk.Phonemes != nil {
				toks[i].Phonemes = *tk.Phonemes
			}
			if tk.Before != nil {
				work = append(work, job{tk.Before, &toks[i].Before})
			}
			if tk.After != nil {
				work = append(work, job{tk.After, &toks[i].After})
			}
			pos += n + 1
		}
		// An attached list takes the library's own form of attachments.
		if j.into != &out {
			toks = attached(toks)
		}
		*j.into = toks
	}
	texts := make([]string, len(specs))
	for i, tk := range specs {
		texts[i] = tk.Text
	}
	return out, strings.Join(texts, " "), nil
}

func checkCase(c *engineCase, noCache bool) error {
	d, err := caseDialect(c, noCache)
	if c.Parses != nil {
		// One loaded dialect parses the input with each item's options in
		// order (tests/README.md).
		if err != nil {
			return fmt.Errorf("unexpected load error: %v", err)
		}
		for i := range c.Parses {
			if err := checkParse(d, c, &c.Parses[i].Options, &c.Parses[i].Expect); err != nil {
				return fmt.Errorf("parse %d: %v", i, err)
			}
		}
		return nil
	}
	if err != nil {
		if c.onlyHook {
			return nil
		}
		return checkLoadError(&c.Expect, err)
	}
	return checkParse(d, c, &c.Options, &c.Expect)
}

// checkLoadError matches the error of a dialect that did not load against
// an expectation. The error is the whole outcome, so an expectation of
// anything that only a loaded dialect gives fails (tests/README.md).
func checkLoadError(expect *caseExpect, err error) error {
	e, ok := err.(*Error)
	if !ok {
		return fmt.Errorf("load: %v", err)
	}
	if expect.Error != e.Kind {
		return fmt.Errorf("unexpected load error: %v", err)
	}
	if expect.Result != nil || expect.Brackets != nil || expect.Warnings != nil || expect.Features != nil || expect.LoadWarnings != nil {
		return fmt.Errorf("the dialect did not load: %v", err)
	}
	// Where the error stands, in a document of the case, given only for a
	// grammar error.
	if w := expect.Where; w != nil && e.Kind != ErrorGrammar {
		return fmt.Errorf("expect.where is only for a grammar error: %v", err)
	} else if w != nil && (e.Document != w.Document || e.Line != w.Line || e.Column != w.Column) {
		return fmt.Errorf("the load error stands at %s:%d:%d, not at %s:%d:%d: %v", e.Document, e.Line, e.Column, w.Document, w.Line, w.Column, err)
	}
	return nil
}

// checkParse parses a case's input with a loaded dialect and matches the
// result against an expectation.
func checkParse(d *Dialect, c *engineCase, options *caseOptions, expect *caseExpect) error {
	// The dialect's features, compared whole.
	if expect.Features != nil {
		have := []any{}
		for _, f := range d.Features() {
			have = append(have, map[string]any{"name": f.Name, "kind": f.Kind, "default": f.Default})
		}
		if !equalJSON(have, *expect.Features) {
			return fmt.Errorf("features: expected %s, got %+v", shown(*expect.Features), d.Features())
		}
	}
	if expect.LoadWarnings != nil {
		warnings := d.LoadWarnings()
		if c.Grammar != nil {
			for i := range warnings {
				for j := range warnings[i].References {
					warnings[i].References[j].Document = "case/" + warnings[i].References[j].Document
				}
			}
		}
		data, _ := json.Marshal(warnings)
		found, err := decodeJSON(data)
		if err != nil {
			return err
		}
		if err := match(*expect.LoadWarnings, found, "loadWarnings"); err != nil {
			return err
		}
	}
	res, log, err := runCaseLogged(d, c, options, "")
	if c.onlyHook {
		if err == nil && log.lost() > 0 {
			return fmt.Errorf("%d checks of elision-only lost the witness of their chosen derivation", log.lost())
		}
		return nil
	}
	if err != nil {
		// A mistake of the caller is an error, and there is no result
		// (engine §13).
		if e, ok := err.(*Error); ok && e.Kind == ErrorUsage && expect.Error == ErrorUsage {
			return nil
		}
		return err
	}
	data, _ := MarshalResult(res)
	got, err := decodeJSON(data)
	if err != nil {
		return fmt.Errorf("the canonical JSON does not parse: %v\n%s", err, data)
	}
	// Every check of elision-only that ran keeps its witness
	// (tests/README.md).
	if n := log.lost(); n > 0 && !c.noHook {
		return fmt.Errorf("%d checks of elision-only lost the witness of their chosen derivation\n%s", n, data)
	}
	return checkResult(res, got, data, expect)
}

// resultProblems lists what a canonical result breaks of the invariants
// that the runners check on every result, whatever the case expects
// (tests/README.md): no stage has a member tied, and a stage whose verdict
// is tie has no output, is the last stage, and has the result's ambiguous
// error with the reason tie, its name and two readings. An ambiguous error
// has no token or source. An error that loses the witness of elision-only
// is a grammar error of the last stage, which is resolved and has no
// output, with its chosen tree and completion and no position, reason or
// readings (engine §7.9). No result has it, whatever the case expects, since
// engine §7.8 proves that no grammar gives it.
func resultProblems(got any) []string {
	var problems []string
	result, _ := got.(map[string]any)
	stages, _ := result["stages"].([]any)
	if e, _ := result["error"].(map[string]any); e != nil && e["code"] != nil {
		problems = append(problems, witnessLostProblems(e, stages)...)
		problems = append(problems, "the result is the error elision-witness-lost, which no grammar gives")
	}
	// An ambiguous error has no position (docs/output.md).
	if e, _ := result["error"].(map[string]any); e != nil && e["kind"] == ErrorAmbiguous {
		for _, member := range []string{"token", "source"} {
			if _, ok := e[member]; ok {
				problems = append(problems, "the ambiguous error has a member "+member)
			}
		}
	}
	for i, s := range stages {
		stage, _ := s.(map[string]any)
		name, _ := stage["name"].(string)
		if _, ok := stage["tied"]; ok {
			problems = append(problems, "stage "+name+" has a tied tree")
		}
		if stage["verdict"] != VerdictTie {
			continue
		}
		if _, ok := stage["output"]; ok {
			problems = append(problems, "the tied stage "+name+" has output")
		}
		if i != len(stages)-1 {
			problems = append(problems, "a stage runs after the tied stage "+name)
		}
		e, _ := result["error"].(map[string]any)
		readings, _ := e["readings"].([]any)
		tree, hasTree := result["tree"]
		if result["ok"] != false || !hasTree || tree != nil || e == nil || e["kind"] != ErrorAmbiguous || e["reason"] != ReasonTie || e["stage"] != name || len(readings) != 2 && e["cycle"] == nil {
			problems = append(problems, "the tied stage "+name+" lacks its error of kind ambiguous, reason tie and two readings")
		}
	}
	if e, _ := result["error"].(map[string]any); e != nil && e["cycle"] != nil {
		problems = append(problems, cycleProblems(e, stages)...)
	}
	return problems
}

// checkResult matches a result, and its canonical JSON as got and as data,
// against an expectation. The invariants of the result come first.
func checkResult(res *ParseResult, got any, data []byte, expect *caseExpect) error {
	if problems := resultProblems(got); len(problems) > 0 {
		return fmt.Errorf("the result breaks an invariant: %s\n%s", strings.Join(problems, "; "), data)
	}
	// The warnings, compared whole, so [] says that there are none; the
	// canonical JSON leaves them out then.
	if expect.Warnings != nil {
		have, ok := got.(map[string]any)["warnings"]
		if !ok {
			have = []any{}
		}
		if !equalJSON(have, *expect.Warnings) {
			return fmt.Errorf("warnings: expected %s\n%s", shown(*expect.Warnings), data)
		}
	}
	if expect.Result != nil {
		if err := match(*expect.Result, got, "result"); err != nil {
			return fmt.Errorf("%v\n%s", err, data)
		}
	}
	// An error the case expects is a load error or the result's error, as
	// where the grammar's error is found while lowering it (engine §3.3).
	if expect.Brackets != nil {
		if b := Brackets(res, BracketOptions{}); b != *expect.Brackets {
			return fmt.Errorf("brackets: expected %q, got %q", *expect.Brackets, b)
		}
	}
	if expect.Error != "" {
		if res.Error == nil || res.Error.Kind != expect.Error {
			return fmt.Errorf("expected error %s\n%s", expect.Error, data)
		}
	} else if res.Error != nil {
		return fmt.Errorf("unexpected error\n%s", data)
	}
	return nil
}

// The runner fails a case whose dialect does not load, when the case
// expects another kind of error, or more than the error.
func TestEngineRunnerLoadError(t *testing.T) {
	grammar := "%rule text A\n%rule text A"
	brackets := ""
	decoded := func(v any) *any { return &v }
	// "\xed\xa0\x80" encodes the surrogate U+D800, so this document held in
	// memory is a usage error at load (engine §1).
	unusable := "%rule text 'a\xed\xa0\x80'"
	where := &struct {
		Document string `json:"document"`
		Line     int    `json:"line"`
		Column   int    `json:"column"`
	}{Document: "main.md"}
	for _, tc := range []struct {
		name    string
		grammar *string
		expect  caseExpect
		pass    bool
	}{
		{"grammar", &grammar, caseExpect{Error: ErrorGrammar}, true},
		{"usage", &grammar, caseExpect{Error: ErrorUsage}, false},
		{"none", &grammar, caseExpect{}, false},
		{"result", &grammar, caseExpect{Error: ErrorGrammar, Result: decoded(map[string]any{})}, false},
		{"brackets", &grammar, caseExpect{Error: ErrorGrammar, Brackets: &brackets}, false},
		{"warnings", &grammar, caseExpect{Error: ErrorGrammar, Warnings: decoded([]any{})}, false},
		{"features", &grammar, caseExpect{Error: ErrorGrammar, Features: decoded([]any{})}, false},
		{"usage at load", &unusable, caseExpect{Error: ErrorUsage}, true},
		{"usage at load, grammar expected", &unusable, caseExpect{Error: ErrorGrammar}, false},
		{"usage at load, result expected", &unusable, caseExpect{Error: ErrorUsage, Result: decoded(map[string]any{})}, false},
		{"usage at load, where given", &unusable, caseExpect{Error: ErrorUsage, Where: where}, false},
	} {
		c := &engineCase{Grammar: tc.grammar, Expect: tc.expect}
		if err := checkCase(c, true); (err == nil) != tc.pass {
			t.Errorf("%s: the runner gave %v", tc.name, err)
		}
	}
}

// resultMutant is a change to a canonical result that breaks an invariant
// (tests/README.md, "Result mutants"): its name, its engine case and the
// change itself, as tests/result-mutants.json writes it.
type resultMutant struct {
	Name   string `json:"name"`
	Case   string `json:"case"`
	change map[string]any
}

// loadResultMutants reads the shared mutants, which every runner applies.
func loadResultMutants(t testing.TB) []resultMutant {
	t.Helper()
	data, err := os.ReadFile("../../tests/result-mutants.json")
	if err != nil {
		t.Fatal(err)
	}
	var file struct {
		Mutants []map[string]any `json:"mutants"`
	}
	if err := unmarshalJSON(data, &file); err != nil {
		t.Fatal(err)
	}
	// An empty list would pass every runner with nothing refused.
	if len(file.Mutants) == 0 {
		t.Fatal("tests/result-mutants.json has no mutant")
	}
	var mutants []resultMutant
	for _, m := range file.Mutants {
		mutants = append(mutants, resultMutant{Name: m["name"].(string), Case: m["case"].(string), change: m})
	}
	return mutants
}

// mutantStep is the member or element at one step of a path; -1 is the
// last element of a list.
func mutantStep(target any, step any) any {
	if list, ok := target.([]any); ok {
		return list[mutantIndex(list, step)]
	}
	return target.(map[string]any)[step.(string)]
}

func mutantIndex(list []any, step any) int {
	if i := int(step.(float64)); i >= 0 {
		return i
	}
	return len(list) - 1
}

// applyMutant changes the canonical result got, decoded from JSON, in place.
func applyMutant(t testing.TB, got map[string]any, m resultMutant) {
	t.Helper()
	follow := func(path []any) any {
		var value any = got
		for _, step := range path {
			value = mutantStep(value, step)
		}
		return value
	}
	fresh := copyJSON
	path := m.change["path"].([]any)
	parent := follow(path[:len(path)-1])
	last := path[len(path)-1]
	put := func(value any) {
		if list, ok := parent.([]any); ok {
			list[mutantIndex(list, last)] = value
		} else {
			parent.(map[string]any)[last.(string)] = value
		}
	}
	if value, ok := m.change["set"]; ok {
		put(fresh(value))
	} else if from, ok := m.change["copy"]; ok {
		put(follow(from.([]any)))
	} else if keep, ok := m.change["keep"]; ok {
		put(mutantStep(parent, last).([]any)[:int(keep.(float64))])
	} else if _, ok := m.change["remove"]; ok {
		delete(parent.(map[string]any), last.(string))
	} else if value, ok := m.change["append"]; ok {
		put(append(append([]any{}, mutantStep(parent, last).([]any)...), fresh(value)))
	} else {
		t.Fatalf("the mutant %s changes nothing", m.Name)
	}
}

// mutantResult runs the engine case of a mutant: the result, and its
// canonical JSON.
func mutantResult(t testing.TB, m resultMutant) (*ParseResult, []byte) {
	t.Helper()
	c := loadCase(t, "../../tests/engine/"+m.Case)
	d, err := caseDialect(c, true)
	if err != nil {
		t.Fatal(err)
	}
	res, err := runCase(d, c, &c.Options)
	if err != nil {
		t.Fatal(err)
	}
	data, _ := MarshalResult(res)
	return res, data
}

// decodedResult is a canonical result, decoded.
func decodedResult(t testing.TB, data []byte) map[string]any {
	t.Helper()
	got, err := decodeJSON(data)
	if err != nil {
		t.Fatal(err)
	}
	return got.(map[string]any)
}

// The runner fails a case that does not finish in time.
func TestEngineRunnerTimeout(t *testing.T) {
	grammar := doublingGrammar("late-elision", 25, false, "%rule text ε | rN")
	c := &engineCase{Grammar: &grammar, Tokens: []caseToken{}, Expect: caseExpect{}}
	if err := checkCaseWithin(c, time.Nanosecond); err == nil || !strings.Contains(err.Error(), "did not finish") {
		t.Fatalf("the runner gave %v", err)
	}
}

// The runner refuses a result that breaks an invariant, whatever the case
// expects: each shared mutant (tests/README.md, "Result mutants").
func TestEngineRunnerInvariants(t *testing.T) {
	for _, m := range loadResultMutants(t) {
		res, data := mutantResult(t, m)
		got := decodedResult(t, data)
		if problems := resultProblems(got); len(problems) != 0 {
			t.Fatalf("%s: %v", m.Case, problems)
		}
		applyMutant(t, got, m)
		if len(resultProblems(got)) == 0 {
			t.Errorf("%s: no problem found", m.Name)
		}
		if checkResult(res, got, data, &caseExpect{Error: ErrorAmbiguous}) == nil {
			t.Errorf("%s: the runner accepts it", m.Name)
		}
	}
}

// caseTimeout is how long one engine case can run before it fails, so that
// a hang is reported as a failure of its case. GENCMU_CASE_TIMEOUT sets it,
// as a Go duration.
const caseTimeout = 30 * time.Second

// checkCaseWithin checks a case, and fails it when it takes longer than
// the timeout. A case that hangs keeps its goroutine, but the run goes on.
func checkCaseWithin(c *engineCase, timeout time.Duration) error {
	done := make(chan error, 1)
	go func() { done <- checkCase(c, false) }()
	select {
	case err := <-done:
		return err
	case <-time.After(timeout):
		return fmt.Errorf("the case did not finish within %v", timeout)
	}
}

func TestEngineCases(t *testing.T) {
	timeout := caseTimeout
	if s := os.Getenv("GENCMU_CASE_TIMEOUT"); s != "" {
		d, err := time.ParseDuration(s)
		if err != nil {
			t.Fatalf("GENCMU_CASE_TIMEOUT: %v", err)
		}
		timeout = d
	}
	files, _ := filepath.Glob("../../tests/engine/*.json")
	if len(files) == 0 {
		t.Fatal("no engine cases in ../../tests/engine")
	}
	for _, f := range files {
		c := loadCase(t, f)
		t.Run(strings.TrimSuffix(filepath.Base(f), ".json"), func(t *testing.T) {
			if err := checkCaseWithin(c, timeout); err != nil {
				t.Errorf("%s\n%v", c.Description, err)
			}
		})
	}
}

// witnessLostProblems lists what an error with a code breaks of the form of
// elision-witness-lost (tests/README.md, engine §7.9).
func witnessLostProblems(e map[string]any, stages []any) []string {
	var problems []string
	if e["code"] != CodeElisionWitnessLost {
		problems = append(problems, fmt.Sprintf("the error has the code %v", e["code"]))
	}
	stage, _ := e["stage"].(string)
	_, chosen := e["chosen"]
	completion, isList := e["completion"].([]any)
	if e["kind"] != ErrorGrammar || stage == "" || !chosen || !isList {
		problems = append(problems, "the elision-witness-lost error lacks its kind grammar, stage, chosen or completion")
	}
	_ = completion
	for _, member := range []string{"token", "source", "line", "column", "expected", "reason", "readings"} {
		if _, ok := e[member]; ok {
			problems = append(problems, "the elision-witness-lost error has a member "+member)
		}
	}
	var last map[string]any
	if len(stages) > 0 {
		last, _ = stages[len(stages)-1].(map[string]any)
	}
	_, output := last["output"]
	if last == nil || last["name"] != stage || last["verdict"] != VerdictResolved || output {
		problems = append(problems, "the stage of the elision-witness-lost error is not the last, resolved, with no output")
	}
	return problems
}

// TestEngineCaseDeep runs the deep engine case through the whole runner,
// which reads, writes and compares its result 20,000 deep, with the stack
// of a goroutine held to 1 MiB. A deeper stack is fatal, so a runner that
// recursed as deep would end the process.
func TestEngineCaseDeep(t *testing.T) {
	c := loadCase(t, "../../tests/engine/deep-left-recursion.json")
	defer debug.SetMaxStack(debug.SetMaxStack(1 << 20))
	if err := checkCase(c, true); err != nil {
		t.Fatalf("%.500v", err)
	}
}

func cycleProblems(error map[string]any, stages []any) []string {
	problems := []string{}
	readings, _ := error["readings"].([]any)
	cycle, _ := error["cycle"].([]any)
	if len(readings) < 3 {
		problems = append(problems, "a cycle needs at least three readings")
	}
	if len(cycle) < 3 {
		problems = append(problems, "a cycle needs at least three edges")
	}
	natural := func(v any) (int, bool) { n, ok := v.(float64); return int(n), ok && n >= 0 && n == math.Trunc(n) }
	digits := func(v any, positive bool) bool {
		s, ok := v.(string)
		if !ok || s == "" || len(s) > 1 && s[0] == '0' || positive && s[0] == '0' {
			return false
		}
		for i := range s {
			if s[i] < '0' || s[i] > '9' {
				return false
			}
		}
		return true
	}
	vertices := map[int]bool{}
	for i, x := range cycle {
		edge, _ := x.(map[string]any)
		from, fok := natural(edge["from"])
		to, tok := natural(edge["to"])
		if !fok || !tok || from >= len(readings) || to >= len(readings) {
			problems = append(problems, "a cycle index is out of range")
		}
		next, _ := cycle[(i+1)%len(cycle)].(map[string]any)
		nf, nok := natural(next["from"])
		if !tok || !nok || to != nf {
			problems = append(problems, "cycle edges do not connect")
		}
		if vertices[from] {
			problems = append(problems, "a cycle repeats a vertex")
		}
		vertices[from] = true
		basis, _ := edge["basis"].(string)
		contests, _ := edge["contests"].([]any)
		switch basis {
		case "prefer":
			if len(contests) == 0 {
				problems = append(problems, "a preference edge lacks contests")
			}
		case "stage":
			directive, _ := edge["directive"].(string)
			counts, _ := edge["counts"].([]any)
			witness, _ := edge["witness"].([]any)
			_, boundary := natural(edge["boundary"])
			if directive == "late-elision" {
				if !boundary || len(counts) != 2 {
					problems = append(problems, "a stage edge lacks its directive witness")
				}
			} else if (directive != "greedy" && directive != "lazy") || len(witness) != 2 {
				problems = append(problems, "a stage edge lacks its directive witness")
			}
		default:
			problems = append(problems, "a cycle edge lacks its reason")
		}
		counts, _ := edge["counts"].([]any)
		for _, n := range counts {
			if !digits(n, false) {
				problems = append(problems, "a cycle count is not an exact integer string")
			}
		}
		for _, x := range contests {
			c, _ := x.(map[string]any)
			span, _ := c["span"].([]any)
			path, _ := c["path"].([]any)
			counts, _ := c["residualCounts"].([]any)
			good := len(span) == 2 && len(path) >= 2 && len(counts) == 2
			if good {
				start, sok := natural(span[0])
				end, eok := natural(span[1])
				a, aok := path[0].(string)
				b, bok := path[len(path)-1].(string)
				higher, _ := c["higher"].(string)
				lower, _ := c["lower"].(string)
				good = sok && eok && start < end && aok && bok && a == higher && b == lower
			}
			if !good {
				problems = append(problems, "a preference contest is malformed")
			}
			for _, n := range counts {
				if !digits(n, true) {
					problems = append(problems, "a residual count is not a positive integer string")
				}
			}
		}
	}
	_, hasWitness := error["witness"]
	for _, s := range stages {
		stage, _ := s.(map[string]any)
		if _, ok := stage["witness"]; ok {
			hasWitness = true
		}
	}
	if hasWitness {
		problems = append(problems, "a cycle has a pairwise witness")
	}
	if error["reason"] == ReasonElisionOnly && error["chosenReading"] != float64(0) {
		problems = append(problems, "a reconstruction cycle lacks its chosen reading index")
	}
	return problems
}
