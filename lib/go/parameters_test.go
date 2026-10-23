package gencmu

import (
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"
)

func TestParameterCacheComparisonKeepsSerializedFields(t *testing.T) {
	cached := templateObject{"call": "f", "args": []any{templateObject{"tag": "A"}}, "at": templatePosition([2]int{2, 3})}
	source := templateObj(templateClone(cached))
	templateObj(templateList(source["args"])[0])[templateSourceKey] = &templateSource{at: [2]int{2, 5}}
	for _, pair := range [][2]templateObject{{cached, source}, {source, cached}} {
		if !sameValue(reflect.ValueOf(pair[0]), reflect.ValueOf(pair[1])) {
			t.Fatal("private locations changed cache equality")
		}
	}
	for _, change := range []func(templateObject){
		func(n templateObject) { n["call"] = "g" },
		func(n templateObject) { n["at"] = templatePosition([2]int{3, 4}) },
		func(n templateObject) { templateObj(templateList(n["args"])[0])["tag"] = "B" },
		func(n templateObject) { delete(n, "args") },
	} {
		mutant := templateObj(templateClone(source))
		change(mutant)
		if sameValue(reflect.ValueOf(cached), reflect.ValueOf(mutant)) {
			t.Fatal("a serialized field change escaped the cache comparison")
		}
	}
}

func TestParameters(t *testing.T) {
	raw, err := os.ReadFile("../../tests/parameters.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Name string `json:"name"`
		engineCase
	}
	if err = json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	if len(cases) != 274 {
		t.Fatalf("got %d shared cases", len(cases))
	}
	for _, c := range cases {
		t.Run(c.Name, func(t *testing.T) {
			if err := checkCase(&c.engineCase, false); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func parameterGrammar(t *testing.T, text string) *stageGrammar {
	t.Helper()
	d, e := caseDialect(&engineCase{Grammar: &text}, false)
	if e != nil {
		t.Fatal(e)
	}
	return d.stages[0]
}
func parameterRuleNames(g *stageGrammar) []string {
	names := []string{}
	for _, r := range g.rules {
		names = append(names, r.name)
	}
	return names
}
func parameterRead(t *testing.T, text string) *domDoc {
	t.Helper()
	if e := loadBundled(); e != nil {
		t.Fatal(e)
	}
	d, e := bundled.reader.read("```jbogenbau\n"+text+"\n```", "test.md")
	if e != nil {
		t.Fatal(e)
	}
	return d
}
func parameterEqual(t *testing.T, got, want any) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v, want %#v", got, want)
	}
}
func TestParameterRuleOrderAndRebinding(t *testing.T) {
	g := parameterGrammar(t, "%rule atom(@X) @X\n%rule text atom(\"a\") named\n%rule named = atom(\"b\")\n%redefine-rule named = atom(\"c\")")
	parameterEqual(t, parameterRuleNames(g), []string{"text", "named", "atom(\"a\")", "atom(\"b\")"})
	audit := templateAudit(g)
	names := []string{}
	for _, v := range templateList(audit["instances"]) {
		names = append(names, templateText(templateObj(v)["name"]))
	}
	parameterEqual(t, names, []string{"named", "atom(\"a\")", "atom(\"b\")"})
}
func TestParameterClosedInnerCalls(t *testing.T) {
	g := parameterGrammar(t, "%rule atom(@X) @X\n%rule outer(@X) atom(@X) @X\n%rule text outer(atom(\"a\")) atom(\"b\")")
	parameterEqual(t, parameterRuleNames(g), []string{"text", "atom(\"a\")", "outer(atom(\"a\"))", "atom(\"b\")", "atom(atom(\"a\"))"})
}
func TestParameterPinnedPublicEdits(t *testing.T) {
	g := parameterGrammar(t, "%rule atom(@X) @X\n%rule text item atom(\"a\")\n%rule item = atom(\"a\")\n%extend-rule item \"b\"\n%redefine-rule item = atom(\"c\")\n%extend-rule item \"d\"")
	for name, want := range map[string][]string{"atom(\"a\")": {"a", "b"}, "item": {"c", "d"}} {
		got := []string{}
		for _, a := range g.byName[name].alts {
			got = append(got, a.alt.Expr.Value.Str)
		}
		parameterEqual(t, got, want)
	}
}
func TestParameterFlags(t *testing.T) {
	g := parameterGrammar(t, "%rule(fewest) atom(@X) @X\n%rule text atom(\"a\") atom(\"b\")\n%redefine-rule atom(\"a\") \"c\"\n%extend-rule atom(@Y) \"d\"")
	parameterEqual(t, g.byName["atom(\"a\")"].flags, []string{})
	parameterEqual(t, g.byName["atom(\"b\")"].flags, []string{"fewest"})
	instance := templateObj(templateList(templateAudit(g)["instances"])[0])
	events := []any{}
	for _, v := range templateList(instance["events"]) {
		e := templateObj(v)
		events = append(events, []any{e["scope"], e["op"], e["flagsAfter"]})
	}
	parameterEqual(t, events, []any{[]any{"template", "define", []any{"fewest"}}, []any{"instance", "redefine", []any{}}, []any{"template", "extend", []any{}}})
}
func TestParameterNormalizationAndConstants(t *testing.T) {
	g := parameterGrammar(t, "%const $A \"a\"\n%rule atom(@X) @X\n%rule text atom(\"a\") atom((\"a\")) atom($A)")
	parameterEqual(t, parameterRuleNames(g), []string{"text", "atom(\"a\")", "atom($A)"})
}
func TestParameterBindingTree(t *testing.T) {
	text := "%rule atom(@X) @X\n%rule text atom(\"a\")\n%rule named = atom(\"a\")"
	d, e := caseDialect(&engineCase{Grammar: &text}, false)
	if e != nil {
		t.Fatal(e)
	}
	result, e := d.Parse("a", ParseOptions{})
	if e != nil {
		t.Fatal(e)
	}
	if result.Tree.Children[0].Rule != "named" || result.Tree.Children[0].Children[0].Kind != KindToken {
		t.Fatalf("binding adds a wrapper: %+v", result.Tree)
	}
}
func TestParameterAuditNotes(t *testing.T) {
	g := parameterGrammar(t, "%rule atom(@X) @X\n%rule unused(@A,@B) @A\n%rule outer(@X) @X\n%rule text outer(named) outer(atom(\"a\"))\n%rule named = atom(\"a\")")
	audit := templateAudit(g)
	parameterEqual(t, templateObj(templateList(audit["templates"])[1])["notes"], []any{templateObject{"kind": "unused-parameter", "parameter": "B"}, templateObject{"kind": "uncalled-template"}})
	notes := []any{}
	for _, v := range templateList(audit["instances"]) {
		i := templateObj(v)
		if i["template"] == "outer" {
			notes = append(notes, i["notes"])
		}
	}
	parameterEqual(t, notes, []any{[]any{templateObject{"kind": "argument-alias-twin", "instances": []any{"outer(atom(\"a\"))"}}}, []any{templateObject{"kind": "argument-alias-twin", "instances": []any{"outer(named)"}}}})
}
func TestParameterCanonicalArguments(t *testing.T) {
	uni := parameterGrammar(t, "%rule text \"a\"").uni
	argument := templateObject{"call": "f", "args": []any{templateObject{"string": "a\n\t\u0301"}, templateObject{"concat": []any{templateObject{"string": "a"}, templateObject{"string": ""}}}}, "at": templatePosition([2]int{1, 1})}
	parameterEqual(t, templateCanonical(argument, uni), `f("a‹LF›‹HT›‹U+0301›", "a" ++ "")`)
	parameterEqual(t, templateCanonical(templateObject{"body": templateObject{"seq": []any{templateObject{"ref": "a"}, templateObject{"seq": []any{templateObject{"ref": "b"}, templateObject{"ref": "c"}}}}}}, uni), "(a (b c))")
	tested := templateObject{"test": "tags", "expr": templateObject{"ref": "A"}, "requirements": []any{templateObject{"negated": false, "value": templateObject{"tag": "K"}}}}
	parameterEqual(t, templateCanonical(tested, uni), "A<K>")
}
func TestParameterSuppliedDOM(t *testing.T) {
	d := parameterRead(t, "%rule atom(@X) @X\n%rule text atom(\"a\")")
	raw, _ := templateFromJSON(d.json())
	for _, bad := range []templateObject{{"param": "X"}, {"param": "Y", "at": templatePosition([2]int{1, 1})}, {"param": "X", "at": templatePosition([2]int{0, 1})}} {
		mutated := templateObj(templateClone(raw))
		r := templateObj(templateList(mutated["rules"])[0])
		templateObj(templateList(r["alternatives"])[0])["expr"] = bad
		if _, e := decodeDOM(templateJSON(mutated), bundled.uni); e == nil {
			t.Fatalf("accepted parameter %v", bad)
		}
	}
	for _, bad := range []templateObject{{"capture": "x"}, {"method": "value", "receiver": templateObject{"capture": ""}, "args": []any{}}, {"body": templateObject{"capture": "x", "expr": templateObject{"ref": "A"}}}} {
		mutated := templateObj(templateClone(raw))
		r := templateObj(templateList(mutated["rules"])[1])
		templateObj(templateObj(templateList(r["alternatives"])[0])["expr"])["args"] = []any{bad}
		if _, e := decodeDOM(templateJSON(mutated), bundled.uni); e == nil {
			t.Fatalf("accepted argument %v", bad)
		}
	}
}
func TestParameterSuppliedBodyNormalizes(t *testing.T) {
	d := parameterRead(t, "%ambiguity-resolution greedy\n%rule atom(@X) @X\n%rule text atom(\"a\") atom(\"a\")")
	r := d.Rules[1].rawTemplate
	second := templateObj(templateList(templateObj(templateObj(templateList(r["alternatives"])[0])["expr"])["seq"])[1])
	second["args"] = []any{templateObject{"body": templateObject{"literal": templateObject{"string": "a"}}}}
	if e := validateDOM(d, bundled.uni); e != nil {
		t.Fatal(e)
	}
	x, e := expandTemplates([]docDOM{{"test.md", d}}, bundled.uni)
	if e != nil {
		t.Fatal(e)
	}
	if len(x.instances) != 1 {
		t.Fatalf("got %d instances", len(x.instances))
	}
}
func TestParameterOrdinaryIdentity(t *testing.T) {
	d := parameterRead(t, "%ambiguity-resolution greedy\n%rule text \"a\"\n%extend-rule text \"b\"")
	docs := []docDOM{{"plain.md", d}}
	x, e := expandTemplates(docs, bundled.uni)
	if e != nil {
		t.Fatal(e)
	}
	if x.docs[0].dom != d || x.order != nil || &x.docs[0] != &docs[0] {
		t.Fatal("ordinary documents changed")
	}
}
func TestParameterOrdinaryEditHistory(t *testing.T) {
	g := parameterGrammar(t, "%rule atom(@X) @X\n%rule text \"a\"\n%extend-rule text \"b\"\n%redefine-rule text \"c\"")
	ops := []string{}
	for _, c := range g.changes {
		ops = append(ops, c.op)
	}
	parameterEqual(t, ops, []string{"extend", "replace"})
	parameterEqual(t, g.byName["text"].alts[0].alt.Expr.Value.Str, "c")
}
func TestParameterDeepBodies(t *testing.T) {
	for _, supplied := range []bool{false, true} {
		d := parameterRead(t, "%rule atom(@X) @X\n%rule text atom(\"a\")")
		expr := templateObject{"param": "X", "at": templatePosition([2]int{2, 16})}
		if supplied {
			expr = templateObject{"literal": templateObject{"string": "a"}}
		}
		for range 250 {
			expr = templateObject{"seq": []any{expr, templateObject{"empty": true}}}
		}
		if supplied {
			r := d.Rules[1].rawTemplate
			templateObj(templateObj(templateList(r["alternatives"])[0])["expr"])["args"] = []any{templateObject{"body": expr}}
		} else {
			templateObj(templateList(d.Rules[0].rawTemplate["alternatives"])[0])["expr"] = expr
		}
		if e := validateDOM(d, bundled.uni); e != nil {
			t.Fatal(e)
		}
		x, e := expandTemplates([]docDOM{{"deep.md", d}}, bundled.uni)
		if e != nil {
			t.Fatal(e)
		}
		if len(x.instances) != 1 {
			t.Fatal("deep body changed instance count")
		}
	}
}
func TestParameterElidableOwner(t *testing.T) {
	g := parameterGrammar(t, "%rule tail(@T) \"a\" [+@T]\n%rule text tail(KU)")
	l := lower(g, nil)
	found := false
	for _, p := range l.prods {
		if p.elided == "KU" {
			found = true
			if p.ruleName != "tail(KU)" {
				t.Fatalf("owner: %s", p.ruleName)
			}
		}
	}
	if !found {
		t.Fatal("no elided KU")
	}
}
func TestParameterCacheValidation(t *testing.T) {
	d := parameterRead(t, "%ambiguity-resolution greedy\n%rule atom(@X) @X\n%rule text = atom(\"a\")")
	notationCacheCases(t, "```jbogenbau\n%ambiguity-resolution greedy\n%rule atom(@X) @X\n%rule text = atom(\"a\")\n```", d, bundled.reader)
	const text = "```jbogenbau\n%ambiguity-resolution greedy\n%rule atom(@X) @X\n%rule text = atom(\"a\")\n```"
	for _, valid := range []bool{true, false} {
		raw, _ := templateFromJSON(d.json())
		if valid {
			templateObj(templateObj(templateList(raw["rules"])[1])["instance"])["args"] = []any{templateObject{"body": templateObject{"literal": templateObject{"string": "a"}}}}
		} else {
			templateObj(templateList(templateObj(templateList(raw["rules"])[0])["alternatives"])[0])["expr"] = templateObject{"param": "Other", "at": templatePosition([2]int{3, 16})}
		}
		l, e := bundledLoader()
		if e != nil {
			t.Fatal(e)
		}
		l.read = func(path string) (string, bool) { return text, path == "g.md" }
		l.compiled = map[domCacheKey]json.RawMessage{{fnv1a64(text), l.bootstrapHash, l.uni.hash, l.uni.propertiesHash, domFormat}: templateJSON(raw)}
		if valid {
			l.reader = nil
		}
		got, err := l.document("g.md")
		if err != nil {
			t.Fatal(err)
		}
		if valid {
			if templateObj(templateObj(templateList(got.Rules[1].rawTemplate["instance"].(map[string]any)["args"])[0])["body"]) == nil {
				t.Fatal("valid cached argument was not used")
			}
		} else {
			parameterEqual(t, domValue(t, got), domValue(t, d))
		}
	}

}
func TestParameterRankedLocations(t *testing.T) {
	d := parameterRead(t, "%rule pair(@X,@Y) @X @Y\n%rule text pair(\"a\",\"b\") (\"c\" ≻ \"d\") :: ∅")
	before := string(d.json())
	restoreRankedLocations(d, []Token{{Value: "≻", Source: [2]int{0, 1}}}, func(int) [2]int { return [2]int{3, 42} })
	if string(d.json()) != before {
		t.Fatal("locations changed source DOM")
	}
	x, e := expandTemplates([]docDOM{{"locations.md", d}}, bundled.uni)
	if e != nil {
		t.Fatal(e)
	}
	var at [2]int
	for _, doc := range x.docs {
		for _, r := range doc.dom.Rules {
			if r.Name == "text" {
				at = r.Alternatives[0].rankedLocations["/seq/1"]
			}
		}
	}
	parameterEqual(t, at, [2]int{3, 42})
}
func TestParameterRankedArgumentLocation(t *testing.T) {
	d := parameterRead(t, "%rule choice(@X) @X :: ∅\n%rule text choice((\"a\" ≻ \"b\"))")
	restoreRankedLocations(d, []Token{{Value: "≻", Source: [2]int{0, 1}}}, func(int) [2]int { return [2]int{3, 29} })
	x, e := expandTemplates([]docDOM{{"locations.md", d}}, bundled.uni)
	if e != nil {
		t.Fatal(e)
	}
	var at [2]int
	for _, doc := range x.docs {
		for _, r := range doc.dom.Rules {
			if r.Name == `choice(("a" ≻ "b"))` {
				at = r.Alternatives[0].rankedLocations[""]
			}
		}
	}
	parameterEqual(t, at, [2]int{3, 29})
}

func TestParameterUncalledTemplateValidation(t *testing.T) {
	for _, c := range []struct{ source, message string }{
		{`%rule unused(@X) $x:A $x:@X`, "capture name used twice"},
		{`%rule unused(@X) $x:(A @X)`, "malformed capture"},
		{`%rule unused(@X) @X %emits $x :: @X, $x`, "lists a capture twice"},
		{`%rule unused(@X) @X %emits ($y) $x ($y) :: @X`, "lists a capture twice"},
		{`%rule unused(@X) @X :: _L ∪ @X`, "engine tag"},
		{`%rule unused(@X) @X :: $.tags ∪ @X`, "own tags"},
		{`%rule unused(@X) @X := @X %erased`, "erased"},
		{`%rule unused(@X) [+| @X]`, "leading separator"},
	} {
		t.Run(c.source, func(t *testing.T) {
			text := c.source + "\n%rule text \"a\""
			_, e := caseDialect(&engineCase{Grammar: &text}, false)
			if e == nil {
				t.Fatal("accepted an invalid uncalled template")
			}
			if !strings.Contains(e.Error(), c.message) {
				t.Fatalf("expected %q, got %v", c.message, e)
			}
		})
	}
	for _, good := range []string{`%rule unused(@X) $x:A | $x:@X`, `%rule unused(@X) $x:@X %emits $x :: @X`, `%rule unused(@X) [+@X]`} {
		text := good + "\n%rule text \"a\""
		if _, e := caseDialect(&engineCase{Grammar: &text}, false); e != nil {
			t.Fatal(e)
		}
	}
	d := parameterRead(t, "%rule unused(@X) @X\n%rule text \"a\"")
	for _, expr := range []templateObject{{"capture": "x", "expr": templateObject{"seq": []any{templateObject{"ref": "A"}, templateObject{"param": "X", "at": templatePosition([2]int{1, 1})}}}}, {"optional": templateObject{"call": "unused", "args": []any{templateObject{"param": "X", "at": templatePosition([2]int{1, 1})}}, "at": templatePosition([2]int{1, 1})}, "elidable": true}} {
		raw, _ := templateFromJSON(d.json())
		templateObj(templateList(templateObj(templateList(raw["rules"])[0])["alternatives"])[0])["expr"] = expr
		if _, e := decodeDOM(templateJSON(raw), bundled.uni); e == nil {
			t.Fatalf("accepted an invalid supplied expression: %v", expr)
		}
	}
}

func TestParameterPatternTestOperands(t *testing.T) {
	for _, grammar := range []string{
		`%rule use(@V) $x:_ %conditions $x ≅ #_=@V
%rule text = use("a")`,
		`%rule use(@T) $x:_ %conditions $x ≅ #_<@T>
%rule text = use(_L)`,
		`%rule use(@X) @X<_L>
%rule text = use(_)`,
	} {
		t.Run(grammar, func(t *testing.T) {
			input := "a"
			c := engineCase{Grammar: &grammar, Input: &input}
			d, e := caseDialect(&c, false)
			if e != nil {
				t.Fatal(e)
			}
			result, e := runCase(d, &c, &caseOptions{})
			if e != nil || !result.OK {
				t.Fatalf("parse: %v %+v", e, result)
			}
		})
	}
	text := `%rule atom(@X) @X
%rule unused(@X) @X %conditions $ ≅ #(atom("a")="a")
%rule text "a"`
	if _, e := caseDialect(&engineCase{Grammar: &text}, false); e == nil || !strings.Contains(e.Error(), "invalid pattern test") {
		t.Fatalf("tested exact call: %v", e)
	}
}

func TestParameterNestedAliasTwins(t *testing.T) {
	for _, source := range []string{`%rule atom(@X) @X
%rule outer(@X) @X
%rule public "a"
%rule text outer((named named)) outer((atom("a") atom("a"))) outer((named atom("a"))) outer((atom("a") named))
%rule named = atom("a")
%redefine-rule public = outer((atom("a") named))`, `%rule atom(@X) @X
%rule outer(@P) $x:named %conditions $x ≅ @P
%rule text outer(#named) outer(#atom("a"))
%rule named = atom("a")`} {
		instances := []templateObject{}
		for _, v := range templateList(templateAudit(parameterGrammar(t, source))["instances"]) {
			if i := templateObj(v); i["template"] == "outer" {
				instances = append(instances, i)
			}
		}
		want := 2
		if strings.Contains(source, "public") {
			want = 4
		}
		parameterEqual(t, len(instances), want)
		for index, instance := range instances {
			names := []any{}
			for other, item := range instances {
				if other != index {
					names = append(names, item["name"])
				}
			}
			parameterEqual(t, instance["notes"], []any{templateObject{"kind": "argument-alias-twin", "instances": names}})
		}
	}
}

func TestParameterSharedStructure(t *testing.T) {
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile("../../tests/parameter-structure.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Name, Grammar string
		CacheFallback bool
		Input         string
		DOM           json.RawMessage
		Argument      any
		Order         []string
		Instances     int
		Flags         map[string][]string
	}
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	for _, c := range cases {
		t.Run(c.Name, func(t *testing.T) {
			raw := c.DOM
			if len(raw) == 0 {
				raw = parameterRead(t, c.Grammar).json()
			}
			if c.CacheFallback {
				if _, err := decodeDOM(raw, bundled.uni); err == nil {
					t.Fatal("malformed DOM accepted")
				}
				source := "```jbogenbau\n" + c.Grammar + "\n```"
				value, e := templateFromJSON(raw)
				if e != nil {
					t.Fatal(e)
				}
				cache := templateObject{"format": float64(domFormat), "bootstrap": bundled.reader.hash, "unicode": bundled.uni.hash, "properties": fnv1a64(bundled.sources["unicode-properties.txt"]), "documents": templateObject{"g.md": templateObject{"hash": fnv1a64(source), "dom": value}}}
				sources := map[string]string{"g.md": source, "p.md": "```jbogenbau\n%stage main\n%ambiguity-resolution greedy\n%include \"g.md\"\n```", "compiled.json": string(templateJSON(cache))}
				dialect, err := LoadDialectSources(sources, "p.md")
				if err != nil {
					t.Fatal(err)
				}
				result, err := dialect.Parse(c.Input, ParseOptions{})
				if err != nil || !result.OK {
					t.Fatalf("cache fallback: %v, %v", err, result)
				}
				return
			}
			dom, err := decodeDOM(raw, bundled.uni)
			if err != nil {
				t.Fatal(err)
			}
			if c.Argument != nil {
				value, err := templateFromJSON(raw)
				if err != nil {
					t.Fatal(err)
				}
				rules := templateList(value["rules"])
				expr := templateObj(templateObj(templateList(templateObj(rules[len(rules)-1])["alternatives"])[0])["expr"])
				parameterEqual(t, templateList(expr["args"])[0], c.Argument)
			}
			x, expansionErr := expandTemplates([]docDOM{{"review.md", dom}}, bundled.uni)
			if expansionErr != nil {
				t.Fatal(expansionErr)
			}
			if c.Order != nil {
				parameterEqual(t, x.order, c.Order)
			}
			if c.Instances != 0 && len(x.instances) != c.Instances {
				t.Fatalf("got %d instances, want %d", len(x.instances), c.Instances)
			}
			if c.Flags != nil {
				g := parameterGrammar(t, c.Grammar)
				for name, flags := range c.Flags {
					parameterEqual(t, g.byName[name].flags, flags)
				}
			}
		})
	}
}

func TestParameterOverDeepSuppliedTemplate(t *testing.T) {
	d := parameterRead(t, "%rule use(@X) @X")
	rule := templateObj(templateClone(d.Rules[0].rawTemplate))
	expr := templateObject{"param": "X", "at": templatePosition([2]int{1, 1})}
	for i := 0; i < 20000; i++ {
		expr = templateObject{"optional": expr}
	}
	templateObj(templateList(rule["alternatives"])[0])["expr"] = expr
	p := checkTemplateDeclaration(rule, "rules", bundled.uni)
	if p == nil || p.message != errTooDeep.Error() {
		t.Fatalf("got %v", p)
	}
}
