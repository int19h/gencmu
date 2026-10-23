package gencmu

import (
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"
)

type layeredReadResult struct {
	pattern templateObject
	phase   string
	at      [2]int
}

func layeredRecognitionReader(t *testing.T) *notationReader {
	t.Helper()
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile("../../tests/fixtures/layered-patterns/recognition.json")
	if err != nil {
		t.Fatal(err)
	}
	var recognition templateObject
	if err = json.Unmarshal(raw, &recognition); err != nil {
		t.Fatal(err)
	}
	var bootstrap templateObject
	if err = json.Unmarshal([]byte(bundled.sources["notation/bootstrap.json"]), &bootstrap); err != nil {
		t.Fatal(err)
	}
	for _, stage := range templateList(bootstrap["stages"]) {
		s := templateObj(stage)
		for _, document := range templateList(s["documents"]) {
			dom := templateObj(templateObj(document)["dom"])
			rules := []any{}
			for _, rule := range templateList(dom["rules"]) {
				r := templateObj(rule)
				name := templateText(r["name"])
				if s["name"] == "syntax" && (strings.HasPrefix(name, "pattern-") || strings.HasPrefix(name, "child-")) {
					continue
				}
				if s["name"] == "lexical" && name == "symbol" {
					rule = recognition["lexical"]
				}
				rules = append(rules, rule)
			}
			if s["name"] == "syntax" {
				rules = append(rules, templateList(recognition["syntax"])...)
			}
			dom["rules"] = rules
		}
	}
	raw, err = json.Marshal(bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	reader, err := newNotationReader(string(raw), bundled.uni)
	if err != nil {
		t.Fatal(err)
	}
	return reader
}
func layeredRead(t *testing.T, nr *notationReader, prefix, pattern string, omitted ...string) (result layeredReadResult) {
	t.Helper()
	gt := extractGrammarText("```jbogenbau\n" + prefix + pattern + "\n```")
	ps := newParseState(nr.uni, gt.text)
	tokens := ps.characterTokens()
	features := map[string]bool{}
	var out stageOutcome
	for index, g := range nr.stages {
		run := ps.newRun(g.name, g, tokens)
		if failure := run.activateFeatures(g.features, features, nil); failure != nil {
			t.Fatal(failure)
		}
		lowered := nr.lowered[index]
		if len(features) > 0 {
			lowered = lower(g, features)
		}
		out = run.run(lowered, g.elisionOnly)
		if out.err != nil {
			if out.err.Kind != ErrorRejected {
				t.Fatal(out.err)
			}
			return layeredReadResult{phase: g.name, at: gt.at(out.err.Source[0])}
		}
		if index < len(nr.stages)-1 {
			tokens = out.stage.Output
		}
	}
	pending := []*Node{out.tree}
	var node *Node
	for len(pending) > 0 {
		n := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		if n.Rule == "pattern-literal" {
			node = n
			break
		}
		for index := len(n.Children) - 1; index >= 0; index-- {
			pending = append(pending, n.Children[index])
		}
	}
	if node == nil {
		t.Fatal("the recognition tree contains no pattern literal")
	}
	omit := map[string]bool{}
	for _, value := range omitted {
		omit[value] = true
	}
	mutate := []*Node{node}
	for len(mutate) > 0 {
		current := mutate[len(mutate)-1]
		mutate = mutate[:len(mutate)-1]
		children := current.Children[:0]
		for _, child := range current.Children {
			if child.Kind != KindToken || !omit[tokens[child.Token].Value] {
				children = append(children, child)
				mutate = append(mutate, child)
			}
		}
		current.Children = children
	}

	builder := &domBuilder{toks: tokens, gt: gt, doc: "layered-reader.md", uni: nr.uni, types: newTypeMemo()}
	defer func() {
		if value := recover(); value != nil {
			if err, ok := value.(*Error); ok {
				result = layeredReadResult{phase: "reader", at: [2]int{err.Line, err.Column}}
			} else {
				panic(value)
			}
		}
	}()
	return layeredReadResult{pattern: templateObj(builder.templateTerm(node, false)["pattern"])}
}
func layeredReaderTerm(n templateObject) string {
	for _, key := range []string{"name", "terminal", "tag"} {
		if value, ok := n[key].(string); ok {
			return value
		}
	}
	for key, prefix := range map[string]string{"param": "@", "const": "$"} {
		if value, ok := n[key].(string); ok {
			return prefix + value
		}
	}
	if value, ok := n["string"].(string); ok {
		return templateQuoted(value, bundled.uni)
	}
	if name, ok := n["call"].(string); ok {
		args := []string{}
		for _, arg := range templateList(n["args"]) {
			args = append(args, layeredReaderTerm(templateObj(arg)))
		}
		return name + "(" + strings.Join(args, ", ") + ")"
	}
	if value := templateObj(n["pattern"]); value != nil {
		return layeredPatternText(value, layeredReaderTerm, true)
	}
	if requirements := templateList(n["requirements"]); requirements != nil {
		parts := []string{}
		for _, raw := range requirements {
			r := templateObj(raw)
			prefix := ""
			if r["negated"] == true {
				prefix = "¬"
			}
			parts = append(parts, prefix+layeredReaderTerm(templateObj(r["value"])))
		}
		return "<" + strings.Join(parts, " ") + ">"
	}
	panic("an unknown reader fixture term")
}
func TestLayeredReader(t *testing.T) {
	nr := layeredRecognitionReader(t)
	raw, err := os.ReadFile("../../tests/layered-pattern-reader.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Parameters []string
		Cases      []struct {
			Description, Source string
			Pattern             templateObject
			Error               struct {
				Phase  string
				Offset int
			}
		}
	}
	if err = json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	params := []string{}
	for _, name := range fixture.Parameters {
		params = append(params, "@"+name)
	}
	prefix := "%rule probe(" + strings.Join(params, ", ") + ") A\n%conditions $ ≅ "
	start := len([]rune("%conditions $ ≅ ")) + 1
	for _, c := range fixture.Cases {
		t.Run(c.Description, func(t *testing.T) {
			result := layeredRead(t, nr, prefix, c.Source)
			if c.Pattern != nil {
				if !reflect.DeepEqual(templateIdentity(result.pattern), c.Pattern) {
					t.Fatalf("pattern: %s; error: %s at %v", templateJSON(result.pattern), result.phase, result.at)
				}
				text := layeredPatternText(result.pattern, layeredReaderTerm, true)
				again := layeredRead(t, nr, prefix, text)
				if !reflect.DeepEqual(templateIdentity(again.pattern), c.Pattern) {
					t.Fatalf("round trip %s: %s; %s %v", text, templateJSON(again.pattern), again.phase, again.at)
				}
			} else if result.phase != c.Error.Phase || result.at != [2]int{3, start + c.Error.Offset} {
				t.Fatalf("got %s at %v, expected %s at %v", result.phase, result.at, c.Error.Phase, [2]int{3, start + c.Error.Offset})
			}
		})
	}
	raw, err = os.ReadFile("../../tests/layered-patterns.json")
	if err != nil {
		t.Fatal(err)
	}
	var printing struct {
		Printing []struct {
			Description, Text string
			Pattern           templateObject
		}
	}
	if err = json.Unmarshal(raw, &printing); err != nil {
		t.Fatal(err)
	}
	for _, c := range printing.Printing {
		t.Run("round trip "+c.Description, func(t *testing.T) {
			result := layeredRead(t, nr, prefix, c.Text)
			if !reflect.DeepEqual(templateIdentity(result.pattern), templateIdentity(c.Pattern)) {
				t.Fatalf("pattern: %s; %s %v", templateJSON(result.pattern), result.phase, result.at)
			}
			if actual := layeredPatternText(result.pattern, layeredReaderTerm, true); actual != c.Text {
				t.Fatalf("got %s, expected %s", actual, c.Text)
			}
		})
	}
	var constructors struct {
		Constructors []struct {
			Description, Source string
			Omit                []string
			Pattern             templateObject
		}
	}
	if err := json.Unmarshal(rawReaderFixture(t), &constructors); err != nil {
		t.Fatal(err)
	}
	for _, c := range constructors.Constructors {
		t.Run("supplied "+c.Description, func(t *testing.T) {
			result := layeredRead(t, nr, prefix, c.Source, c.Omit...)
			if !reflect.DeepEqual(templateIdentity(result.pattern), c.Pattern) {
				t.Fatalf("%s: %s %v", templateJSON(result.pattern), result.phase, result.at)
			}
		})
	}

	for _, kind := range []string{"groups", "siblings"} {
		t.Run(kind+" growth", func(t *testing.T) {
			var baseline int64
			for _, size := range []int{128, 256, 512} {
				body := strings.TrimSpace(strings.Repeat("a ", size))
				if kind == "groups" {
					body = strings.Repeat("(", size) + "a" + strings.Repeat(")", size)
				}
				counts := &workCounts{}
				counts.readerSteps.most = 1000000
				if baseline > 0 {
					counts.readerSteps.most = baseline * 5
				}
				var result layeredReadResult
				countWorkIn(counts, func() { result = layeredRead(t, nr, prefix, "#« "+body+" »") })
				expected := size
				if kind == "groups" {
					expected = 1
				}
				if result.pattern == nil || len(templateList(result.pattern["children"])) != expected {
					t.Fatalf("%d: %s %v", size, result.phase, result.at)
				}
				if baseline == 0 {
					baseline = counts.readerSteps.Load()
				}
			}
		})
	}

	t.Run("atom positions", func(t *testing.T) {
		p := layeredRead(t, nr, prefix, "#·a« b »").pattern
		if templateAt(p) != [2]int{3, start + 2} || templateAt(templateObj(templateObj(templateList(p["children"])[0])["child"])) != [2]int{3, start + 5} {
			t.Fatal(templateJSON(p))
		}
		for _, source := range []string{"#·a", `#"a"`} {
			offset := 1
			if source == "#·a" {
				offset = 2
			}
			if templateAt(layeredRead(t, nr, prefix, source).pattern) != [2]int{3, start + offset} {
				t.Fatal(source)
			}
		}
	})
}

func rawReaderFixture(t *testing.T) []byte {
	t.Helper()
	raw, err := os.ReadFile("../../tests/layered-pattern-reader.json")
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
