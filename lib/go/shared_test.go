package gencmu

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"runtime/debug"
	"sort"
	"strings"
	"testing"
	"time"
)

// The shared cases of tests/README.md.

func isGuardedCrash(err error) bool {
	var failure *Error
	return errors.As(err, &failure) && failure != nil && strings.HasPrefix(failure.Message, "internal error: ")
}

type engineCase struct {
	Pipeline         *string           `json:"pipeline"`
	Description      string            `json:"description"`
	Grammar          *string           `json:"grammar"`
	Documents        map[string]string `json:"documents"`
	PipelineDocument string            `json:"pipelineDocument"`
	Tokens           []caseToken       `json:"tokens"`
	Input            *string           `json:"input"`
	Options          caseOptions       `json:"options"`
	Expect           caseExpect        `json:"expect"`
	// Parses, when present, parses the input several times with the one
	// loaded pipeline, each with its own options and expectation, in place
	// of the case's (tests/README.md).
	Parses []struct {
		Options caseOptions `json:"options"`
		Expect  caseExpect  `json:"expect"`
	} `json:"parses"`
	// fault, which no case file sets, is a fault of the library's own
	// paths that the parses of the case turn on (faults_test.go).
	fault      string
	skipReason string
	// noHook, which no case file sets either, ignores the witness hook's
	// answer, so that only the result can fail the case, and onlyHook
	// ignores everything but the hook's answer (faults_test.go).
	noHook   bool
	onlyHook bool
	// hits, where set, records the sites of the fault that the parses
	// enter (faults_test.go).
	hits         map[string]bool
	familyOracle func(*recognizer, *item)
}

// caseToken is a token that a case supplies (tests/README.md). Its before
// and after, which a caller cannot supply, go to the library as they
// stand, so that it refuses them or drops empty ones.
type caseToken struct {
	Text   string      `json:"text"`
	Tags   []string    `json:"tags"`
	Value  *string     `json:"value"`
	Image  *string     `json:"image"`
	Span   *[2]int     `json:"span"`
	Source *[2]int     `json:"source"`
	Before []caseToken `json:"before"`
	After  []caseToken `json:"after"`
}

type caseOptions struct {
	Features        []string `json:"features"`
	WithoutFeatures []string `json:"withoutFeatures"`
	ElisionOnly     *bool    `json:"elisionOnly"`
	Until           string   `json:"until"`
}

// caseExpect is what a case expects. Result, Warnings and Features are
// decoded JSON, nil where the case leaves them out.
type caseExpect struct {
	Message          *string `json:"message"`
	BundledPipelines *any    `json:"bundledPipelines"`
	Diagnostic       *string `json:"diagnostic"`
	Result           *any    `json:"result"`
	Brackets         *string `json:"brackets"`
	Warnings         *any    `json:"warnings"`
	Features         *any    `json:"features"`
	EnabledFeatures  *any    `json:"enabledFeatures"`
	Error            string  `json:"error"`
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
	t.Helper()
	data, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	c, err := decodeEngineCase(data)
	if err != nil {
		t.Fatalf("%s: %v", file, err)
	}
	return c
}

func decodeEngineCase(data []byte) (*engineCase, error) {
	raw, decodeErr := decodeJSON(data)
	if decodeErr != nil {
		return nil, decodeErr
	}
	return decodeEngineCaseFields(data, raw)
}

func decodeParameterCase(data []byte) (string, *engineCase, error) {
	raw, err := decodeJSON(data)
	if err != nil {
		return "", nil, err
	}
	object, ok := raw.(map[string]any)
	if !ok {
		return "", nil, fmt.Errorf("parameter case: expected an object")
	}
	name, ok := object["name"].(string)
	if !ok {
		return "", nil, fmt.Errorf("parameter case: expected a string name")
	}
	delete(object, "name")
	c, err := decodeEngineCaseFields(data, object)
	return name, c, err
}

func decodeEngineCaseFields(data []byte, raw any) (*engineCase, error) {
	c := &engineCase{}
	if err := engineCaseSchema(raw); err != nil {
		return nil, err
	}
	object := raw.(map[string]any)
	usage := caseExpectsUsage(object)
	if usage {
		c.skipReason = unrepresentableTokenField(object["tokens"])
	}
	if err := unmarshalJSON(data, c); err != nil {
		if usage {
			c.skipReason = "Go input records cannot express this field: " + err.Error()
			return c, nil
		}
		return nil, err
	}
	if expect, ok := object["expect"].(map[string]any); ok {
		if result, present := expect["result"]; present {
			c.Expect.Result = &result
		}
	}
	if parses, ok := object["parses"].([]any); ok {
		for i, raw := range parses {
			expect := raw.(map[string]any)["expect"].(map[string]any)
			if result, present := expect["result"]; present {
				c.Parses[i].Expect.Result = &result
			}
		}
	}

	return c, nil
}

func casePipeline(c *engineCase, noCache bool) (*Pipeline, error) {
	if c.Pipeline != nil {
		return LoadPipeline(*c.Pipeline)
	}
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
		if strings.Contains(text, `%include "../grammars/`) {
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
					documents["grammars/"+filepath.ToSlash(key)] = string(raw)
				}
				return nil
			})
			if err != nil {
				return nil, err
			}
			for name, text := range c.Documents {
				documents["case/"+name] = text
			}
			return loadSources(documents, "case/"+c.PipelineDocument, noCache)
		}
	}
	return loadSources(c.Documents, c.PipelineDocument, noCache)
}

// runCase parses a case's input with a loaded pipeline, under the options
// of the case or of one item of its parses.
func runCase(d *Pipeline, c *engineCase, o *caseOptions) (*ParseResult, error) {
	res, _, err := runCaseLogged(d, c, o, "")
	return res, err
}

// runCaseLogged is runCase, with the checks of elision-only that ran, and
// with a private switch that loses their witness, or "" for none.
func runCaseLogged(d *Pipeline, c *engineCase, o *caseOptions, lose string) (*ParseResult, *checkLog, error) {
	if err := loadBundled(); err != nil {
		return nil, nil, err
	}
	opts := ParseOptions{Features: o.Features, WithoutFeatures: o.WithoutFeatures, ElisionOnly: o.ElisionOnly, Until: o.Until}
	log := withChecks(&opts)
	opts.private.loseWitness = lose
	opts.private.fault, opts.private.hits = c.fault, c.hits
	opts.private.familyOracle = c.familyOracle
	var res *ParseResult
	var err error
	if c.Input != nil && c.Tokens == nil {
		res, err = d.Parse(*c.Input, opts)
	} else {
		toks, text, terr := caseTokens(c.Tokens)
		if terr != nil {
			return nil, nil, terr
		}
		if c.Input != nil {
			text = *c.Input
		}
		res, err = d.ParseTokens(text, inputTokensOf(toks), opts)
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
			n := len([]rune(tk.Text))
			toks[i] = Token{Text: tk.Text, Value: tk.Text, Image: tk.Text, Tags: tk.Tags, Span: [2]int{i, i + 1}, Source: [2]int{pos, pos + n}}
			if tk.Value != nil {
				toks[i].Value = *tk.Value
			}
			if tk.Image != nil {
				toks[i].Image = *tk.Image
			}
			if tk.Source != nil {
				toks[i].Source = *tk.Source
			}
			if tk.Span != nil {
				toks[i].Span = *tk.Span
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
	if c.Expect.Result != nil {
		if err := resultPatternProblem(*c.Expect.Result); err != nil {
			return err
		}
	}
	for _, parse := range c.Parses {
		if parse.Expect.Result != nil {
			if err := resultPatternProblem(*parse.Expect.Result); err != nil {
				return err
			}
		}
	}
	d, err := casePipeline(c, noCache)
	if isGuardedCrash(err) {
		return err
	}
	if c.Parses != nil {
		// One loaded pipeline parses the input with each item's options in
		// order (tests/README.md).
		if err != nil {
			return fmt.Errorf("unexpected load error: %v", err)
		}
		for i := range c.Parses {
			if err := checkParse(d, c, &c.Parses[i].Options, &c.Parses[i].Expect); err != nil {
				return fmt.Errorf("parse %d: %w", i, err)
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

// checkLoadError matches the error of a pipeline that did not load against
// an expectation. The error is the whole outcome, so an expectation of
// anything that only a loaded pipeline gives fails (tests/README.md).
func checkLoadError(expect *caseExpect, err error) error {
	if isGuardedCrash(err) {
		return fmt.Errorf("load crashed: %w", err)
	}
	if expect.BundledPipelines != nil {
		have := []any{}
		for _, name := range BundledPipelines() {
			have = append(have, name)
		}
		if !equalJSON(have, *expect.BundledPipelines) {
			return fmt.Errorf("bundledPipelines: got %v, expected %v", have, *expect.BundledPipelines)
		}
	}

	e, ok := err.(*Error)
	if !ok {
		return fmt.Errorf("load: %v", err)
	}
	if (expect.Message != nil || expect.Diagnostic != nil) && e.Kind != ErrorGrammar {
		return fmt.Errorf("message and diagnostic apply only to grammar load errors")
	}
	if expect.Message != nil && e.Message != *expect.Message {
		return fmt.Errorf("load message: got %q, expected %q", e.Message, *expect.Message)
	}
	if expect.Error != e.Kind {
		return fmt.Errorf("unexpected load error: %v", err)
	}
	if expect.Result != nil || expect.Brackets != nil || expect.Warnings != nil || expect.Features != nil || expect.EnabledFeatures != nil {
		return fmt.Errorf("the pipeline did not load: %v", err)
	}
	// Where the error stands, in a document of the case, given only for a
	// grammar error.
	if w := expect.Where; w != nil && e.Kind != ErrorGrammar {
		return fmt.Errorf("expect.where is only for a grammar error: %v", err)
	} else if w != nil && (e.Document != w.Document || e.Line != w.Line || e.Column != w.Column) {
		return fmt.Errorf("the load error stands at %s:%d:%d, not at %s:%d:%d: %v", e.Document, e.Line, e.Column, w.Document, w.Line, w.Column, err)
	}
	if expect.Diagnostic != nil && e.Code != *expect.Diagnostic {
		return fmt.Errorf("the load diagnostic is %s, not %s", e.Code, *expect.Diagnostic)
	}
	return nil
}

// checkParse parses a case's input with a loaded pipeline and matches the
// result against an expectation.
func checkParse(d *Pipeline, c *engineCase, options *caseOptions, expect *caseExpect) error {
	if expect.Where != nil || expect.Diagnostic != nil {
		return fmt.Errorf("where and diagnostic apply only to load errors")
	}
	if expect.BundledPipelines != nil {
		have := []any{}
		for _, name := range BundledPipelines() {
			have = append(have, name)
		}
		if !equalJSON(have, *expect.BundledPipelines) {
			return fmt.Errorf("bundledPipelines: got %v, expected %v", have, *expect.BundledPipelines)
		}
	}

	// The pipeline's features, compared whole.
	if expect.Features != nil {
		have := []any{}
		for _, f := range d.Features() {
			have = append(have, map[string]any{"name": f.Name, "kind": f.Kind, "default": f.Default})
		}
		if !equalJSON(have, *expect.Features) {
			return fmt.Errorf("features: expected %s, got %+v", shown(*expect.Features), d.Features())
		}
	}

	res, log, err := runCaseLogged(d, c, options, "")
	if isGuardedCrash(err) {
		return err
	}
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
			if expect.Result != nil || expect.Brackets != nil || expect.Warnings != nil || expect.EnabledFeatures != nil || expect.Message != nil {
				return fmt.Errorf("a usage error has no parse result or grammar message")
			}
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
	if object, ok := got.(map[string]any); ok {
		if _, present := object["features"]; present {
			return fmt.Errorf("canonical JSON contains enabled features")
		}
	}
	if expect.EnabledFeatures != nil {
		have := []any{}
		for _, name := range res.Features {
			have = append(have, name)
		}
		if !equalJSON(have, *expect.EnabledFeatures) {
			return fmt.Errorf("enabled features: expected %s, got %v", shown(*expect.EnabledFeatures), res.Features)
		}
	}
	// A runtime lowering error keeps its structured location in the lowered
	// grammar. The public result deliberately has no position (engine §13).
	var location *Error
	if expect.Message != nil && res.Error != nil && res.Error.Kind == ErrorGrammar {
		features := map[string]bool{}
		for _, name := range res.Features {
			features[name] = true
		}
		for i, stage := range d.stages {
			if stage.name == res.Error.Stage {
				location = d.lower(i, features).faultLocation
				break
			}
		}
	}
	return checkResult(res, got, data, expect, location)
}

// resultProblems lists what a canonical result breaks of the invariants
// that the runners check on every result, whatever the case expects
// (tests/README.md): no stage has a member tied, and a stage whose verdict
// is tie has no output, is the last stage, and has the result's ambiguous
// error with the reason tie, its name and two readings. An ambiguous error
// has no token or source. An error that loses the witness of elision-only
// is a grammar error of the last stage, which is unique or resolved and has no
// output, with its chosen tree and completion and no position, reason or
// readings (engine §7.9). No result has it, whatever the case expects, since
// engine §7.8 proves that no grammar gives it.
func namedDiagnostic(value any, errors ...bool) bool {
	diagnostic, ok := value.(map[string]any)
	if !ok || len(diagnostic) < 6 || len(diagnostic) > 7 {
		return false
	}
	allowed := map[string]bool{"stage": true, "code": true, "rule": true, "message": true, "span": true, "source": true}
	if len(errors) > 0 && errors[0] {
		allowed["rejection"] = true
	}
	for field := range diagnostic {
		if !allowed[field] {
			return false
		}
	}
	if evidence, present := diagnostic["rejection"]; present && !rejectionEvidence(evidence) {
		return false
	}
	for _, field := range []string{"stage", "code", "rule", "message"} {
		if _, ok := diagnostic[field].(string); !ok {
			return false
		}
	}
	if diagnostic["code"] != diagnostic["rule"] {
		return false
	}
	for _, field := range []string{"span", "source"} {
		pair, ok := diagnostic[field].([]any)
		if !ok || len(pair) != 2 {
			return false
		}
		for _, number := range pair {
			if caseInteger(number, field) != nil || number.(float64) < 0 || number.(float64) > 9007199254740991 {
				return false
			}
		}
		if pair[0].(float64) > pair[1].(float64) {
			return false
		}
	}
	return true
}

func rejectionEvidence(value any) bool {
	evidence, ok := value.(map[string]any)
	if !ok || len(evidence) != 5 {
		return false
	}
	for _, key := range []string{"token", "line", "column"} {
		n, ok := evidence[key].(float64)
		if !ok || caseInteger(n, key) != nil || n < 0 || key != "token" && n < 1 {
			return false
		}
	}
	source, ok := evidence["source"].([]any)
	if !ok || len(source) != 2 {
		return false
	}
	for _, n := range source {
		value, ok := n.(float64)
		if !ok || caseInteger(n, "source") != nil || value < 0 {
			return false
		}
	}
	if source[0].(float64) > source[1].(float64) {
		return false
	}
	expected, ok := evidence["expected"].([]any)
	if !ok {
		return false
	}
	for _, value := range expected {
		item, ok := value.(map[string]any)
		if !ok || len(item) != 2 {
			return false
		}
		if _, ok := item["terminal"].(string); !ok {
			return false
		}
		rules, ok := item["rules"].([]any)
		if !ok {
			return false
		}
		for _, rule := range rules {
			if _, ok := rule.(string); !ok {
				return false
			}
		}
	}
	return true
}

func resultProblems(got any) []string {
	var problems []string
	result, _ := got.(map[string]any)
	stages, _ := result["stages"].([]any)
	if result["format"] != float64(resultFormat) {
		problems = append(problems, "the result has the wrong format")
	}
	names := map[any]bool{}
	for _, entry := range stages {
		stage, _ := entry.(map[string]any)
		names[stage["name"]] = true
	}
	pending := []any{result}
	for len(pending) > 0 {
		entry := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		switch item := entry.(type) {
		case []any:
			pending = append(pending, item...)
		case map[string]any:
			for key, value := range item {
				if key != "errors" && key != "warnings" {
					pending = append(pending, value)
					continue
				}
				list, ok := value.([]any)
				if !ok || len(list) == 0 {
					problems = append(problems, key+" is not a nonempty list of named diagnostics")
					continue
				}
				for _, diagnostic := range list {
					if !namedDiagnostic(diagnostic, key == "errors") {
						problems = append(problems, key+" contains an invalid diagnostic")
					} else if !names[diagnostic.(map[string]any)["stage"]] {
						problems = append(problems, "a diagnostic names an unknown raising stage")
					}
				}
			}
		}
	}
	for _, entry := range stages {
		stage, _ := entry.(map[string]any)
		if stage["errors"] != nil || stage["warnings"] != nil {
			output, ok := stage["output"].([]any)
			if !ok || len(output) != 0 {
				problems = append(problems, "stage diagnostics require an empty emission")
			}
		}
	}
	if e, _ := result["error"].(map[string]any); e != nil && e["code"] != nil {
		problems = append(problems, witnessLostProblems(e, stages)...)
		problems = append(problems, "the result is the error elision-witness-lost, which no grammar gives")
	}
	error, _ := result["error"].(map[string]any)
	if error != nil && (error["kind"] == ErrorRejected || error["kind"] == ErrorGrammar || error["kind"] == ErrorFeatureConflict) {
		warnings, _ := error["warnings"].([]any)
		outer, _ := result["warnings"].([]any)
		if !reflect.DeepEqual(warnings, outer) {
			problems = append(problems, "failure warnings differ from result warnings")
		}
	}
	if error != nil && error["kind"] != ErrorReported && result["tree"] != nil {
		problems = append(problems, "an error result other than reported has a tree")
	}
	if warnings, ok := result["warnings"].([]any); ok {
		for _, warning := range warnings {
			if !namedDiagnostic(warning) {
				problems = append(problems, "a warning lacks its diagnostic fields")
			}
		}
	}
	if error != nil && error["kind"] == ErrorReported {
		var last map[string]any
		if len(stages) > 0 {
			last, _ = stages[len(stages)-1].(map[string]any)
		}
		_, output := last["output"]
		if result["ok"] != false || result["tree"] == nil || last["name"] != error["stage"] || last["verdict"] != VerdictUnique && last["verdict"] != VerdictResolved || !output {
			problems = append(problems, "a reported result lacks its retained tree, verdict or output")
		}
		errors, ok := error["errors"].([]any)
		valid := ok && len(errors) > 0
		for _, diagnostic := range errors {
			if !namedDiagnostic(diagnostic, true) {
				valid = false
			}
		}
		if !valid {
			problems = append(problems, "a reported result lacks its ordered named errors")
		}
		for _, field := range []string{"token", "source", "line", "column", "expected", "readings"} {
			if _, present := error[field]; present {
				problems = append(problems, "a reported error has the member "+field)
			}
		}
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
		if result["ok"] != false || !hasTree || tree != nil || e == nil || e["kind"] != ErrorAmbiguous || e["reason"] != ReasonTie || e["stage"] != name || len(readings) != 2 {
			problems = append(problems, "the tied stage "+name+" lacks its error of kind ambiguous, reason tie and two readings")
		}
	}
	if e, _ := result["error"].(map[string]any); e != nil {
		for _, field := range []string{"cycle", "conflict", "chosenReading"} {
			if _, present := e[field]; present {
				problems = append(problems, "the error has the member "+field)
			}
		}
	}

	return problems
}

// checkResult matches a result, and its canonical JSON as got and as data,
// against an expectation. Location is the original lowering error, or nil.
// The invariants of the result come first.
func checkResult(res *ParseResult, got any, data []byte, expect *caseExpect, location *Error) error {
	if expect.Where != nil || expect.Diagnostic != nil {
		return fmt.Errorf("where and diagnostic apply only to load errors")
	}
	if expect.Result != nil {
		if err := resultPatternProblem(*expect.Result); err != nil {
			return err
		}
	}
	if expect.Message != nil && (res.Error == nil || res.Error.Kind != ErrorGrammar) {
		return fmt.Errorf("expect.message applies only to grammar errors")
	}
	if expect.Message != nil {
		message := res.Error.Message
		if location != nil {
			prefix := fmt.Sprintf("%s:%d:%d: ", location.Document, location.Line, location.Column)
			message = strings.TrimPrefix(message, prefix)
		}
		if message != *expect.Message {
			return fmt.Errorf("runtime message: expected %q, got %s", *expect.Message, data)
		}
	}
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
	// where the grammar's error is found while lowering it (engine §3).
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

// The runner fails a case whose pipeline does not load, when the case
// expects another kind of error, or more than the error.
func TestEngineRunnerAgreedReasons(t *testing.T) {
	for _, name := range []string{"unicode-categories-conflict.json", "suffix-recursion-local.json"} {
		c := loadCase(t, "../../tests/engine/"+name)
		if err := checkCase(c, false); err != nil {
			t.Fatal(err)
		}
		wrong := "a wrong reason"
		c.Expect.Message = &wrong
		if checkCase(c, false) == nil {
			t.Fatalf("%s accepted a wrong reason", name)
		}
	}
}

func TestEngineRunnerLoadError(t *testing.T) {
	t.Parallel()
	grammar := "%rule text A\n%rule text A"
	runtimeGrammar := "%rule text {ε}"
	if _, err := casePipeline(&engineCase{Grammar: &runtimeGrammar}, true); err != nil {
		t.Fatalf("the runtime fixture must load: %v", err)
	}
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
		{"runtime grammar", &runtimeGrammar, caseExpect{Error: ErrorGrammar}, true},
		{"runtime grammar with where", &runtimeGrammar, caseExpect{Error: ErrorGrammar, Where: where}, false},
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
	d, err := casePipeline(c, true)
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
	t.Parallel()
	grammar := doublingGrammar("late #·_<_Elided>", 25, false, "%rule text ε | rN")
	c := &engineCase{Grammar: &grammar, Tokens: []caseToken{}, Expect: caseExpect{}}
	if err := checkCaseWithin(c, time.Nanosecond); err == nil || !strings.Contains(err.Error(), "did not finish") {
		t.Fatalf("the runner gave %v", err)
	}
}

// The runner refuses a result that breaks an invariant, whatever the case
// expects: each shared mutant (tests/README.md, "Result mutants").
func TestEngineRunnerInvariants(t *testing.T) {
	t.Parallel()
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
		if checkResult(res, got, data, &caseExpect{Error: ErrorAmbiguous}, nil) == nil {
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
	t.Parallel()
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
		t.Run(strings.TrimSuffix(filepath.Base(f), ".json"), func(t *testing.T) {
			t.Parallel()
			c := loadCase(t, f)
			if c.skipReason != "" {
				t.Skip(c.skipReason)
			}
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
	_, isList := e["completion"].([]any)
	if e["kind"] != ErrorGrammar || stage == "" || !chosen || !isList {
		problems = append(problems, "the elision-witness-lost error lacks its kind grammar, stage, chosen or completion")
	}
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
	if last == nil || last["name"] != stage || (last["verdict"] != VerdictUnique && last["verdict"] != VerdictResolved) || output {
		problems = append(problems, "the stage of the elision-witness-lost error is not the last, unique or resolved, with no output")
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

func inputTokensOf(tokens []Token) []InputToken {
	out := make([]InputToken, len(tokens))
	for i, t := range tokens {
		value, image := t.Value, t.Image
		out[i] = InputToken{Text: t.Text, Value: &value, Image: &image, Tags: t.Tags, Span: t.Span, Source: t.Source}
		if t.Before != nil {
			out[i].Before = inputTokensOf(t.Before)
		}
		if t.After != nil {
			out[i].After = inputTokensOf(t.After)
		}
	}
	return out
}

func unrepresentableTokenField(raw any) string {
	tokens, _ := raw.([]any)
	for _, raw := range tokens {
		// tokenSchema already requires an object at every depth.
		token := raw.(map[string]any)
		for _, field := range []string{"text", "tags"} {
			if _, exists := token[field]; !exists {
				return "Go InputToken cannot express an absent " + field + " member"
			}
		}
		for _, field := range []string{"text", "value", "image", "tags", "span", "source", "before", "after"} {
			if value, exists := token[field]; exists && value == nil {
				return "Go InputToken cannot distinguish explicit null " + field + " from its default"
			}
		}
		for _, field := range []string{"before", "after"} {
			if reason := unrepresentableTokenField(token[field]); reason != "" {
				return reason
			}
		}
	}
	return ""
}

// parseStoredTokens adapts output-shaped fixtures to the caller API.
func (d *Pipeline) parseStoredTokens(text string, tokens []Token, options ParseOptions) (*ParseResult, error) {
	inputs := inputTokensOf(tokens)

	return d.ParseTokens(text, inputs, options)
}

func TestLoadDiagnosticMismatchNamesCode(t *testing.T) {
	wanted := "wanted-code"
	err := checkLoadError(&caseExpect{Error: ErrorGrammar, Diagnostic: &wanted},
		&Error{Kind: ErrorGrammar, Code: "actual-code", Message: "human reason"})
	if err == nil || !strings.Contains(err.Error(), "actual-code") || strings.Contains(err.Error(), "human reason") {
		t.Fatalf("diagnostic mismatch does not identify its code: %v", err)
	}
}

func TestEngineCaseSchemaRejectsInvalidMembers(t *testing.T) {
	for _, raw := range []string{
		`{"grammar":"%rule text A","unknown":1}`,
		`{"grammar":"%rule text A","options":{"unknown":true}}`,
		`{"grammar":"%rule text A","expect":{"unknown":true}}`,
		`{"grammar":"%rule text A","options":{"features":null}}`,
		`{"grammar":"%rule text A","options":{"until":null}}`,
		`{"grammar":"%rule text A","options":{"elisionOnly":null}}`,
		`{"grammar":"%rule text A","parses":null}`,
		`{"grammar":"%rule text A","expect":{"diagnostic":null}}`,
		`{"grammar":"%rule text A","expect":{"where":{"line":true}}}`,
		`{"grammar":"%rule text A","tokens":[{"text":"a","tags":["A"],"unknown":true}],"expect":{"error":"usage"}}`,
	} {
		if _, err := decodeEngineCase([]byte(raw)); err == nil {
			t.Errorf("accepted invalid case %s", raw)
		}
	}
}

func TestEngineRunnerRejectsInapplicableExpectations(t *testing.T) {
	grammar, input := `%rule text "a"`, "a"
	for _, raw := range []string{
		`{"where":{"document":"main.md","line":99,"column":1}}`,
		`{"diagnostic":"no-such-code"}`,
	} {
		var expect caseExpect
		if err := unmarshalJSON([]byte(raw), &expect); err != nil {
			t.Fatal(err)
		}
		if err := checkCase(&engineCase{Grammar: &grammar, Input: &input, Expect: expect}, true); err == nil {
			t.Errorf("accepted %s on a successful parse", raw)
		}
	}
	for _, raw := range []string{
		`{"error":"usage","result":{}}`, `{"error":"usage","brackets":""}`,
		`{"error":"usage","warnings":[]}`, `{"error":"usage","message":"wrong"}`,
		`{"error":"usage","where":{"document":"main.md"}}`, `{"error":"usage","diagnostic":"wrong"}`,
		`{"error":"usage","enabledFeatures":[]}`,
	} {
		var expect caseExpect
		if err := unmarshalJSON([]byte(raw), &expect); err != nil {
			t.Fatal(err)
		}
		if err := checkCase(&engineCase{Grammar: &grammar, Input: &input, Options: caseOptions{Until: "missing"}, Expect: expect}, true); err == nil {
			t.Errorf("accepted %s on a usage error", raw)
		}
	}
}

func TestResultPatternsRejectErrorMessages(t *testing.T) {
	for _, pattern := range []any{
		map[string]any{"error": map[string]any{"message": "reason"}},
		map[string]any{"stages": []any{map[string]any{"error": map[string]any{"message": "reason"}}}},
	} {
		expect := &caseExpect{Error: ErrorGrammar, Result: &pattern}
		if err := checkResult(&ParseResult{Error: &ParseError{Kind: ErrorGrammar, Message: "reason"}}, pattern, nil, expect, nil); err == nil {
			t.Errorf("accepted error message pattern %+v", pattern)
		}
	}
}

func TestEngineCaseKeepsScalarResultPatterns(t *testing.T) {
	for _, scalar := range []string{"null", "false", "0", `""`} {
		c, err := decodeEngineCase([]byte(`{"grammar":"%rule text A","expect":{"result":` + scalar + `}}`))
		if err != nil || c.Expect.Result == nil {
			t.Fatalf("lost result pattern %s: %v", scalar, err)
		}
	}
}

func TestEngineCaseRejectsIgnoredParseExpectations(t *testing.T) {
	_, err := decodeEngineCase([]byte(`{"grammar":"%rule text A","expect":{"result":{}},"parses":[{"expect":{}}]}`))
	if err == nil {
		t.Fatal("accepted an ignored outer expectation")
	}
}

func TestTokenCaseSchemaInspectsDeepAttachments(t *testing.T) {
	var token any = map[string]any{"text": "x", "tags": []any{}, "unknown": true}
	for i := 0; i < 20000; i++ {
		token = map[string]any{"text": "x", "tags": []any{}, "before": []any{token}}
	}
	if err := tokenSchema(true)([]any{token}, "tokens"); err == nil {
		t.Fatal("accepted an unknown member in deep attachments")
	}
}

func TestParameterCaseSchemaRejectsInvalidMembers(t *testing.T) {
	for _, raw := range []string{
		`{"name":"bad","grammar":"%rule text A","unknown":true}`,
		`{"name":"bad","grammar":"%rule text A","expect":{"unknown":true}}`,
	} {
		if _, _, err := decodeParameterCase([]byte(raw)); err == nil {
			t.Errorf("accepted %s", raw)
		}
	}
}

func TestGuardedCrashRecognition(t *testing.T) {
	crash := &Error{Kind: ErrorGrammar, Message: "internal error: probe crash"}
	var absent *Error
	for _, c := range []struct {
		err  error
		want bool
	}{
		{nil, false}, {absent, false},
		{&Error{Kind: ErrorGrammar, Message: "ordinary error"}, false},
		{fmt.Errorf("internal error: ordinary error value"), false},
		{crash, true}, {fmt.Errorf("parse 0: %w", crash), true},
	} {
		if got := isGuardedCrash(c.err); got != c.want {
			t.Errorf("%v: guarded crash=%t, want %t", c.err, got, c.want)
		}
	}
}

func TestTokenCaseSchemaRejectsNonObjectTokens(t *testing.T) {
	for _, bad := range []string{`null`, `false`, `0`, `"x"`, `[]`} {
		for _, sides := range [][]string{nil, {"before"}, {"after"}, {"before", "after"}, {"after", "before"}} {
			token, path := bad, "case.tokens[0]"
			for i := len(sides) - 1; i >= 0; i-- {
				token = `{"text":"x","tags":[],"` + sides[i] + `":[` + token + `]}`
			}
			for _, side := range sides {
				path += "." + side + "[0]"
			}
			body := `"grammar":"%rule text A","tokens":[` + token + `],"expect":{"error":"usage"}`
			_, err := decodeEngineCase([]byte(`{` + body + `}`))
			if err == nil || !strings.Contains(err.Error(), path+": expected a token object") {
				t.Errorf("engine case accepted %s at %s: %v", bad, path, err)
			}
			_, _, err = decodeParameterCase([]byte(`{"name":"token shape",` + body + `}`))
			if err == nil || !strings.Contains(err.Error(), path+": expected a token object") {
				t.Errorf("parameter case accepted %s at %s: %v", bad, path, err)
			}
		}
	}
}

func TestUsageTokenCaseKeepsInvalidPayloads(t *testing.T) {
	for _, token := range []string{
		`{"text":false,"tags":[]}`,
		`{"text":"x","tags":null}`,
		`{"text":"x","tags":[],"before":false}`,
		`{"text":"x","tags":[],"before":[{"text":false,"tags":[]}]}`,
		`{"text":"x","tags":[],"after":[{"text":"y","tags":[],"before":null}]}`,
	} {
		raw := `{"grammar":"%rule text A","tokens":[` + token + `],"expect":{"error":"usage"}}`
		c, err := decodeEngineCase([]byte(raw))
		if err != nil || c.skipReason == "" {
			t.Errorf("lost an invalid known payload in %s: %v", token, err)
		}
	}
	c, err := decodeEngineCase([]byte(`{"grammar":"%rule text A","tokens":[{"text":"x","tags":["A"],"before":[{"text":"y","tags":[]}]}],"expect":{"error":"usage"}}`))
	if err != nil {
		t.Fatal(err)
	}
	if c.skipReason != "" {
		t.Fatal(c.skipReason)
	}
	if err := checkCase(c, true); err != nil {
		t.Fatal(err)
	}
}

func TestEngineRunnerRuntimeReasons(t *testing.T) {
	const reason = "an item of braces in text can match no tokens"
	for _, document := range []string{"main.md", "g:7: part.md"} {
		t.Run(document, func(t *testing.T) {
			c := &engineCase{
				Documents: map[string]string{
					"pipeline.md": block("%stage main", "%ambiguity-resolution greedy", fmt.Sprintf("%%include %q", document)),
					document:      block("%rule text {ε}"),
				},
				PipelineDocument: "pipeline.md",
				Expect:           caseExpect{Error: ErrorGrammar},
			}
			d, err := casePipeline(c, true)
			if err != nil {
				t.Fatal(err)
			}
			full := document + ":2:1: " + reason
			for _, message := range []string{reason, full, "wrong reason"} {
				c.Expect.Message = &message
				err := checkParse(d, c, &c.Options, &c.Expect)
				if (err == nil) != (message == reason) {
					t.Errorf("message %q: %v", message, err)
				}
			}
			res, err := runCase(d, c, &c.Options)
			if err != nil || res.Error == nil || res.Error.Message != full {
				t.Fatalf("public runtime message changed: %+v, %v", res, err)
			}
			if res.Error.Document != "" || res.Error.Line != 0 || res.Error.Column != 0 {
				t.Fatalf("public runtime error gained a position: %+v", res.Error)
			}
		})
	}
}

func TestRuntimeReasonRemovesOnlyItsLocation(t *testing.T) {
	location := &Error{Document: "g:7: part.md", Line: 12, Column: 3}
	prefix := "g:7: part.md:12:3: "
	reason := "other.md:4:5: a reason with a location-shaped start"
	res := &ParseResult{Error: &ParseError{Kind: ErrorGrammar, Message: prefix + reason}}
	data, err := MarshalResult(res)
	if err != nil {
		t.Fatal(err)
	}
	got, err := decodeJSON(data)
	if err != nil {
		t.Fatal(err)
	}
	for _, message := range []string{reason, prefix + reason, "a reason with a location-shaped start", "wrong reason"} {
		err := checkResult(res, got, data, &caseExpect{Error: ErrorGrammar, Message: &message}, location)
		if (err == nil) != (message == reason) {
			t.Errorf("message %q: %v", message, err)
		}
	}
	wrongLocation := &Error{Document: location.Document, Line: 1, Column: location.Column}
	if err := checkResult(res, got, data, &caseExpect{Error: ErrorGrammar, Message: &reason}, wrongLocation); err == nil {
		t.Error("removed a prefix that does not match the structured location")
	}
	after, err := MarshalResult(res)
	if err != nil || string(after) != string(data) {
		t.Fatalf("message comparison changed the public result: %s, %v", after, err)
	}
	bare := &ParseResult{Error: &ParseError{Kind: ErrorGrammar, Message: reason}}
	if err := checkResult(bare, nil, nil, &caseExpect{Error: ErrorGrammar, Message: &reason}, nil); err != nil {
		t.Fatalf("changed a reason without location metadata: %v", err)
	}
}
