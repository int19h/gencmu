package gencmu

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
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

// TestFixpoint reads the notation's documents with the bootstrap and
// compares the result with the bootstrap itself (engine §8).
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
	n := 0
	for _, s := range b.Stages {
		for _, d := range s.Documents {
			text, err := os.ReadFile(filepath.Join("..", "..", "grammars", d.Path))
			if err != nil {
				t.Fatal(err)
			}
			dom, rerr := bundled.reader.read(string(text), d.Path)
			if rerr != nil {
				t.Fatalf("%s: %v", d.Path, rerr)
			}
			var want any
			json.Unmarshal(d.Dom, &want)
			if got := domValue(t, dom); !reflect.DeepEqual(got, want) {
				t.Errorf("%s: reading it with the bootstrap does not reproduce the bootstrap\n got %s", d.Path, dom.json())
			}
			// The DOM also writes byte for byte as the bootstrap holds it.
			if string(dom.json()) != string(d.Dom) {
				t.Errorf("%s: the DOM's canonical JSON differs from the bootstrap's text", d.Path)
			}
			n++
		}
	}
	if n == 0 {
		t.Fatal("the bootstrap has no documents")
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
