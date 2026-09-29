package gencmu

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"
)

func domValue(t testing.TB, d *domDoc) any {
	var v any
	if err := json.Unmarshal(d.json(), &v); err != nil {
		t.Fatalf("the DOM's JSON does not parse: %v", err)
	}
	return v
}

func TestNotationCases(t *testing.T) {
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	files, _ := filepath.Glob("../../tests/notation/*.json")
	if len(files) == 0 {
		t.Fatal("no notation cases in ../../tests/notation")
	}
	for _, f := range files {
		data, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		var c struct {
			Description string
			Document    string
			Expect      struct {
				Dom   json.RawMessage
				Error *struct{ Line, Column int }
			}
		}
		if err := json.Unmarshal(data, &c); err != nil {
			t.Fatal(err)
		}
		t.Run(strings.TrimSuffix(filepath.Base(f), ".json"), func(t *testing.T) {
			dom, rerr := bundled.reader.read(c.Document, "case.md")
			if c.Expect.Error != nil {
				if rerr == nil {
					t.Fatalf("%s\nexpected an error at %d:%d, got %s", c.Description, c.Expect.Error.Line, c.Expect.Error.Column, dom.json())
				}
				if rerr.Line != c.Expect.Error.Line || rerr.Column != c.Expect.Error.Column {
					t.Fatalf("%s\nexpected an error at %d:%d, got %v", c.Description, c.Expect.Error.Line, c.Expect.Error.Column, rerr)
				}
				return
			}
			if rerr != nil {
				t.Fatalf("%s\n%v", c.Description, rerr)
			}
			var pattern any
			json.Unmarshal(c.Expect.Dom, &pattern)
			if err := match(pattern, domValue(t, dom), "dom"); err != nil {
				t.Fatalf("%s\n%v\n%s", c.Description, err, dom.json())
			}
		})
	}
}

// TestFixpoint loads the notation's pipeline, dialects/notation.md, with
// the bootstrap, splices it, and compares the stages with the bootstrap
// itself (engine §8): the same names, and the same runs of documents with
// the same DOMs.
func TestFixpoint(t *testing.T) {
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	var b struct {
		Stages []struct {
			Name      string
			Documents []struct {
				Path string
				Dom  json.RawMessage
			}
		}
	}
	if err := json.Unmarshal([]byte(bundled.sources["notation/bootstrap.json"]), &b); err != nil {
		t.Fatal(err)
	}
	// The repository's documents, each read with the bootstrap.
	l := &loader{
		read: func(p string) (string, bool) {
			text, err := os.ReadFile(filepath.Join("..", "..", "grammars", filepath.FromSlash(p)))
			return string(text), err == nil
		},
		uni:     bundled.uni,
		reader:  bundled.reader,
		noCache: true,
	}
	p, err := l.pipeline("dialects/notation.md")
	if err != nil {
		t.Fatal(err)
	}
	if len(p.stages) != len(b.Stages) || len(p.stages) == 0 {
		t.Fatalf("the pipeline has %d stages, the bootstrap %d", len(p.stages), len(b.Stages))
	}
	for i, s := range p.stages {
		want := b.Stages[i]
		if s.name != want.Name || len(s.documents) != len(want.Documents) {
			t.Errorf("stage %d: %s of %d runs, the bootstrap's %s of %d", i, s.name, len(s.documents), want.Name, len(want.Documents))
			continue
		}
		for j, d := range s.documents {
			if d.path != want.Documents[j].Path {
				t.Errorf("stage %s, run %d: %s, the bootstrap's %s", s.name, j, d.path, want.Documents[j].Path)
				continue
			}
			var wantDOM any
			json.Unmarshal(want.Documents[j].Dom, &wantDOM)
			if got := domValue(t, d.dom); !reflect.DeepEqual(got, wantDOM) {
				t.Errorf("%s: reading it with the bootstrap does not reproduce the bootstrap\n got %s", d.path, d.dom.json())
			}
			// The DOM also writes byte for byte as the bootstrap holds it.
			if string(d.dom.json()) != string(want.Documents[j].Dom) {
				t.Errorf("%s: the DOM's canonical JSON differs from the bootstrap's text", d.path)
			}
		}
	}
}

// TestCompiled checks that compiled.json agrees with a fresh reading of
// every document it lists, and that it is the file of the grammars.
func TestCompiled(t *testing.T) {
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	var c struct {
		Format    int
		Bootstrap string
		Documents map[string]struct {
			Hash string
			Dom  json.RawMessage
		}
	}
	if err := json.Unmarshal([]byte(bundled.sources["compiled.json"]), &c); err != nil {
		t.Fatal(err)
	}
	if c.Format != domFormat || c.Bootstrap != bundled.reader.hash {
		t.Fatalf("compiled.json is for format %d and bootstrap %s, not %d and %s", c.Format, c.Bootstrap, domFormat, bundled.reader.hash)
	}
	if len(c.Documents) == 0 {
		t.Fatal("compiled.json lists no documents")
	}
	for p, d := range c.Documents {
		text, ok := bundled.sources[p]
		if !ok {
			t.Errorf("%s: listed in compiled.json but not bundled", p)
			continue
		}
		if fnv1a64(text) != d.Hash {
			t.Errorf("%s: compiled.json's hash %s is not the text's %s", p, d.Hash, fnv1a64(text))
		}
		dom, rerr := bundled.reader.read(text, p)
		if rerr != nil {
			t.Fatalf("%s: %v", p, rerr)
		}
		var want any
		json.Unmarshal(d.Dom, &want)
		if !reflect.DeepEqual(domValue(t, dom), want) {
			t.Errorf("%s: compiled.json's DOM differs from a fresh reading", p)
		}
	}
	for p, text := range bundled.sources {
		disk, err := os.ReadFile(filepath.Join("..", "..", "grammars", p))
		if err != nil || string(disk) != text {
			t.Errorf("lib/go/grammars/%s differs from grammars/%s; run node tools/sync.js", p, p)
		}
	}
}

// TestCacheUsedAndBypassed parses with the precompiled DOMs and without
// them, and the two agree.
func TestCacheUsedAndBypassed(t *testing.T) {
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	sources := map[string]string{}
	for p, text := range bundled.sources {
		sources[p] = text
	}
	text := bundled.sources["notation/syntax.md"]
	var outs [][]byte
	for _, noCache := range []bool{false, true} {
		d, err := loadSources(sources, "dialects/notation.md", noCache)
		if err != nil {
			t.Fatal(err)
		}
		res, err := d.Parse(string(extractGrammarText(text).text), ParseOptions{})
		if err != nil {
			t.Fatal(err)
		}
		if !res.OK {
			t.Fatalf("the notation dialect does not parse syntax.md (cache bypassed: %v): %s", noCache, res.Error.Message)
		}
		data, _ := MarshalResult(res)
		outs = append(outs, data)
	}
	if string(outs[0]) != string(outs[1]) {
		t.Error("parsing with the cache and without it differ")
	}
	// A cache entry for a different bootstrap is a miss.
	if got := readCompiled(bundled.sources["compiled.json"], "0000000000000000"); len(got) != 0 {
		t.Error("compiled.json was used with another bootstrap")
	}
}

// TestBundledCacheSameStages loads each bundled dialect with the precompiled
// DOMs and without them, and the two give the same stages and features.
func TestBundledCacheSameStages(t *testing.T) {
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	if len(bundled.compiled) == 0 {
		t.Fatal("compiled.json holds no DOMs for this bootstrap")
	}
	var names []string
	for p := range bundled.sources {
		if strings.HasPrefix(p, "dialects/") && strings.HasSuffix(p, ".md") {
			names = append(names, p)
		}
	}
	if len(names) == 0 {
		t.Fatal("no bundled dialects")
	}
	for _, name := range names {
		var loaded [2]*Dialect
		for i, noCache := range []bool{false, true} {
			l, err := bundledLoader()
			if err != nil {
				t.Fatal(err)
			}
			l.noCache = noCache
			if loaded[i], err = l.dialect(name); err != nil {
				t.Fatalf("%s (cache bypassed: %v): %v", name, noCache, err)
			}
		}
		if !reflect.DeepEqual(loaded[0].Features(), loaded[1].Features()) {
			t.Errorf("%s: the features differ: %+v and %+v", name, loaded[0].Features(), loaded[1].Features())
		}
		if !sameValue(reflect.ValueOf(loaded[0].stages), reflect.ValueOf(loaded[1].stages)) {
			t.Errorf("%s: the stages differ", name)
		}
	}
}

// sameValue is reflect.DeepEqual for values with no cycles, but a nil slice
// or map equals an empty one: a decoded DOM leaves an empty list nil where
// the reader makes it empty.
func sameValue(a, b reflect.Value) bool {
	if a.Kind() != b.Kind() {
		return false
	}
	switch a.Kind() {
	case reflect.Pointer, reflect.Interface:
		if a.IsNil() || b.IsNil() {
			return a.IsNil() == b.IsNil()
		}
		return sameValue(a.Elem(), b.Elem())
	case reflect.Struct:
		for i := 0; i < a.NumField(); i++ {
			if !sameValue(a.Field(i), b.Field(i)) {
				return false
			}
		}
		return true
	case reflect.Slice, reflect.Array:
		if a.Len() != b.Len() {
			return false
		}
		for i := 0; i < a.Len(); i++ {
			if !sameValue(a.Index(i), b.Index(i)) {
				return false
			}
		}
		return true
	case reflect.Map:
		if a.Len() != b.Len() {
			return false
		}
		for _, k := range a.MapKeys() {
			v := b.MapIndex(k)
			if !v.IsValid() || !sameValue(a.MapIndex(k), v) {
				return false
			}
		}
		return true
	case reflect.String:
		return a.String() == b.String()
	case reflect.Bool:
		return a.Bool() == b.Bool()
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return a.Int() == b.Int()
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return a.Uint() == b.Uint()
	case reflect.Float32, reflect.Float64:
		return a.Float() == b.Float()
	}
	panic("sameValue: cannot compare a " + a.Kind().String())
}

// The notation's lexical stage tags keywords, tag literals, character tags,
// properties and symbols (grammars/notation/lexical.md).
func TestNotationLexicalTags(t *testing.T) {
	d, err := LoadDialect("notation")
	if err != nil {
		t.Fatal(err)
	}
	res, err := d.Parse(`%rule a ¬f? ~b 'c' /d/ E ... | g! %tags X %rulex $e ¬h 'x'..'y' '\p{L}' 'a'...`, ParseOptions{Until: "lexical"})
	if err != nil || !res.OK {
		t.Fatalf("%v %+v", err, res)
	}
	var got [][2]string
	for _, tok := range res.Stages[0].Output {
		got = append(got, [2]string{tok.Text, strings.Join(tok.Tags, " ")})
	}
	want := [][2]string{
		{"%rule", "keyword-rule"}, {"a", "identifier"}, {"¬f?", "guard"}, {"~b", "tag"}, {"'c'", "character"},
		{"/d/", "phoneme"}, {"E", "identifier"}, {"...", "ellipsis"}, {"|", "'|'"}, {"g!", "guard"},
		{"%tags", "keyword-tags"}, {"X", "identifier"}, {"%rulex", "keyword"}, {"$e", "capture"}, {"¬", "'¬'"}, {"h", "identifier"},
		{"'x'", "character"}, {"..", "double-dot"}, {"'y'", "character"}, {`'\p{L}'`, "property"}, {"'a'", "character"}, {"...", "ellipsis"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got  %v\nwant %v", got, want)
	}
}

// The notation's lexical stage tags constants and the keywords that define
// them (grammars/notation/lexical.md).
func TestNotationLexicalConstants(t *testing.T) {
	d, err := LoadDialect("notation")
	if err != nil {
		t.Fatal(err)
	}
	res, err := d.Parse(`%const $SU-STOPS %redefine-const $x $ $K1`, ParseOptions{Until: "lexical"})
	if err != nil || !res.OK {
		t.Fatalf("%v %+v", err, res)
	}
	var got [][2]string
	for _, tok := range res.Stages[0].Output {
		got = append(got, [2]string{tok.Text, strings.Join(tok.Tags, " ")})
	}
	want := [][2]string{
		{"%const", "keyword-const"}, {"$SU-STOPS", "constant"}, {"%redefine-const", "keyword-redefine-const"},
		{"$x", "capture"}, {"$", "capture"}, {"$K1", "constant"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got  %v\nwant %v", got, want)
	}
}

// A character tag is one scalar value in one canonical spelling (engine
// §1): the escapes of the reader and the engine's spelling agree.
func TestCharacterTags(t *testing.T) {
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	for c, want := range map[rune]string{'a': "'a'", 0x301: `'\u{301}'`, 0xED80: `'\u{ED80}'`, '\'': `'\u{27}'`, '\\': `'\u{5C}'`, 0x7F: `'\u{7F}'`, 'é': "'é'", 0x10FFFD: `'\u{10FFFD}'`} {
		if got := characterTag(c, bundled.uni.isMark); got != want {
			t.Errorf("U+%04X: got %s, want %s", c, got, want)
		}
		if back, ok := characterOfTag(want, bundled.uni.isMark); !ok || back != c {
			t.Errorf("%s: read back as U+%04X, %v", want, back, ok)
		}
	}
	for _, bad := range []string{`'\u{61}'`, `'\u{0301}'`, `'\u{ed80}'`, "'́'", "''", "'ab'", `'\u{D800}'`, `'\u{110000}'`, "'''"} {
		if isTag(bad, bundled.uni) {
			t.Errorf("%s is taken for a canonical tag", bad)
		}
	}
}

// The records of a table give the same answers in any order (engine §1).
// The code points next to a boundary of a record are where an unsorted
// search goes wrong first.
func TestUnicodeTableOrder(t *testing.T) {
	data, err := bundledFS.ReadFile("grammars/unicode.txt")
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	lines := strings.Split(strings.TrimRight(text, "\n"), "\n")
	for i, j := 0, len(lines)-1; i < j; i, j = i+1, j-1 {
		lines[i], lines[j] = lines[j], lines[i]
	}
	bundled, err := parseUnicodeTable(text)
	if err != nil {
		t.Fatal(err)
	}
	reversed, err := parseUnicodeTable(strings.Join(lines, "\n"))
	if err != nil {
		t.Fatal(err)
	}
	for _, line := range lines {
		fields := strings.Fields(line)
		for _, field := range fields[min(1, len(fields)):] {
			v, err := strconv.ParseUint(field, 16, 32)
			if err != nil {
				continue
			}
			for _, c := range []rune{rune(v) - 1, rune(v), rune(v) + 1} {
				if c < 0 || c > 0x10FFFF {
					continue
				}
				if reversed.category(c) != bundled.category(c) || reversed.isWhiteSpace(c) != bundled.isWhiteSpace(c) {
					t.Errorf("U+%04X: the reversed table disagrees", c)
				}
				if (c < 0xD800 || c > 0xDFFF) && reversed.lowercase(string(c)) != bundled.lowercase(string(c)) {
					t.Errorf("U+%04X: the reversed table lowercases it otherwise", c)
				}
			}
		}
	}
	if reversed.category('a') != "Ll" || reversed.category('A') != "Lu" {
		t.Error("the reversed table misreads a letter")
	}
}

// A scalar value that a caller's table omits is Cn, without White_Space
// or a lowercase mapping (engine §1).
func TestUnicodeTablePartial(t *testing.T) {
	uni, err := parseUnicodeTable("unicode 0.0.0\ncategory Lu 0041 005A\n")
	if err != nil {
		t.Fatal(err)
	}
	for c, want := range map[rune]string{'A': "Lu", 'a': "Cn", 0x10FFFF: "Cn", 0: "Cn", 0xD800: "Cs"} {
		if got := uni.category(c); got != want {
			t.Errorf("U+%04X: category %s, want %s", c, got, want)
		}
	}
	if !uni.hasProperty("Cn", 'a') || !uni.hasProperty("C", 'a') || uni.hasProperty("L", 'a') || uni.hasProperty("Cs", 'a') {
		t.Error("hasProperty is wrong for an omitted scalar value")
	}
	if uni.isWhiteSpace(' ') || uni.isWhiteSpace('\t') || uni.hasProperty("White_Space", ' ') {
		t.Error("a table without white-space lines has White_Space")
	}
	if uni.lowercase("AB") != "AB" || uni.isMark(0x301) {
		t.Error("a table without lower lines lowercases, or has a mark")
	}
}

// A caller's table replaces the bundled one entirely (engine §1). This one
// knows no letters, only the white space that the notation reads between
// tokens.
func TestUnicodeTableOfCaller(t *testing.T) {
	sources := func(rule string, table bool) map[string]string {
		m := map[string]string{
			"p.md": "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n",
			"g.md": "```jbogenbau\n%ambiguity-resolution greedy\n%rule text " + rule + "\n```\n",
		}
		if table {
			m["unicode.txt"] = "unicode 0.0.0\nwhite-space 0009 000D\nwhite-space 0020 0020\n"
		}
		return m
	}
	for _, c := range []struct {
		rule  string
		table bool
		ok    bool
	}{{`'\p{L}'`, true, false}, {`'\p{Cn}'`, true, true}, {`'\p{L}'`, false, true}} {
		d, err := LoadDialectSources(sources(c.rule, c.table), "p.md")
		if err != nil {
			t.Fatal(err)
		}
		res, err := d.Parse("a", ParseOptions{NoAutoFeatures: true})
		if err != nil {
			t.Fatal(err)
		}
		if res.OK != c.ok {
			t.Errorf("%s with the caller's table %v: ok %v", c.rule, c.table, res.OK)
		}
	}
}

// grammars/unicode.txt gives each scalar value its General_Category and
// says which have White_Space (engine §1).
func TestUnicodeTable(t *testing.T) {
	data, err := bundledFS.ReadFile("grammars/unicode.txt")
	if err != nil {
		t.Fatal(err)
	}
	uni, err := parseUnicodeTable(string(data))
	if err != nil {
		t.Fatal(err)
	}
	for c, want := range map[rune]string{'a': "Ll", 'A': "Lu", '0': "Nd", ' ': "Zs", 0x301: "Mn", 0xD800: "Cs", 0xE000: "Co", 0x378: "Cn", 0x10FFFF: "Cn", 0: "Cc"} {
		if got := uni.category(c); got != want {
			t.Errorf("U+%04X: category %s, want %s", c, got, want)
		}
	}
	if !uni.isMark(0x301) || uni.isMark('a') || uni.isMark(0x903) {
		t.Error("isMark disagrees with Mn")
	}
	for _, c := range []rune{9, 0x0D, ' ', 0x85, 0xA0, 0x2028, 0x3000} {
		if !uni.hasProperty("White_Space", c) {
			t.Errorf("U+%04X lacks White_Space", c)
		}
	}
	if uni.hasProperty("White_Space", 0x200B) || !uni.hasProperty("L", 'é') || uni.hasProperty("L", '1') || !uni.hasProperty("Any", 0x378) {
		t.Error("hasProperty is wrong")
	}
}
