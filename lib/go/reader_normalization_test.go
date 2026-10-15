package gencmu

import (
	"encoding/json"
	"reflect"
	"slices"
	"testing"
)

// notationCacheCases implements cacheMisses in tests/README.md. A poisoned
// entry remains valid, so a stale cache hit cannot hide behind DOM rejection.
func notationCacheCases(t *testing.T, document string, expected *domDoc, reader *notationReader) {
	t.Helper()
	const path = "case.md"
	expectedJSON := domValue(t, expected)
	for _, mode := range []string{"cold", "matching", "document", "bootstrap", "unicode", "format"} {
		t.Run(mode, func(t *testing.T) {
			l, err := bundledLoader()
			if err != nil {
				t.Fatal(err)
			}
			l.read = func(p string) (string, bool) { return document, p == path }
			l.reader = reader
			l.bootstrapHash = reader.hash
			l.compiled = nil
			if mode != "cold" {
				raw := expected.json()
				if mode != "matching" {
					poison, err := decodeDOM(raw, l.uni)
					if err != nil {
						t.Fatal(err)
					}
					if len(poison.Rules) == 0 {
						t.Fatal("cacheMisses requires a rule")
					}
					poison.Rules[0].Name = "cache-poison"
					raw = poison.json()
					if _, err := decodeDOM(raw, l.uni); err != nil {
						t.Fatalf("invalid cache poison: %v", err)
					}
				}
				hash, bootstrap, unicode, format := fnv1a64(document), l.bootstrapHash, l.uni.hash, domFormat
				switch mode {
				case "document":
					hash = fnv1a64("another document")
				case "bootstrap":
					bootstrap = fnv1a64("another bootstrap")
				case "unicode":
					unicode = fnv1a64("another unicode")
				case "format":
					format--
				}
				envelope, err := json.Marshal(map[string]any{
					"format": format, "bootstrap": bootstrap, "unicode": unicode,
					"documents": map[string]any{path: map[string]any{"hash": hash, "dom": json.RawMessage(raw)}},
				})
				if err != nil {
					t.Fatal(err)
				}
				l.compiled = readCompiled(string(envelope), l.bootstrapHash, l.uni.hash)
				if mode == "matching" && len(l.compiled) != 1 {
					t.Fatal("matching cache not admitted")
				}
				if mode == "matching" {
					// A matching cache must work without a notation reader.
					l.reader = nil
				}
			}
			for repeat := 0; repeat < 2; repeat++ {
				got, err := l.document(path)
				if err != nil {
					t.Fatal(err)
				}
				if !equalJSON(expectedJSON, domValue(t, got)) {
					t.Fatalf("read %d changed the DOM: %s", repeat, got.json())
				}
			}
		})
	}
}

func TestFeatureProbeStageZeroOnce(t *testing.T) {
	t.Parallel()
	d, err := LoadDialect("experimental")
	if err != nil {
		t.Fatal(err)
	}
	if d.kind("sa-su") != FeatureGate || slices.Contains(d.declared, "sa-su") {
		t.Fatal("fixture does not enable the automatic probe")
	}
	for _, option := range []struct {
		name    string
		options ParseOptions
	}{
		{"continued", ParseOptions{}},
		{"disabled", ParseOptions{NoAutoFeatures: true}},
		{"words", ParseOptions{Until: "words"}},
	} {
		t.Run(option.name, func(t *testing.T) {
			var texts []string
			option.options.private = &privateOptions{stageZero: func(text []rune) { texts = append(texts, string(text)) }}
			result, err := d.Parse("mi klama", option.options)
			if err != nil || !result.OK {
				t.Fatalf("parse: %v %+v", err, result)
			}
			if !reflect.DeepEqual(texts, []string{"mi klama"}) {
				t.Fatalf("stage zero calls: %q", texts)
			}
			wordsAt := -1
			for i, stage := range result.Stages {
				if stage.Name == "words" {
					wordsAt = i
				}
			}
			if wordsAt < 0 {
				t.Fatal("words stage did not run")
			}
			if option.options.Until == "" {
				if wordsAt+1 >= len(result.Stages) {
					t.Fatal("continuation did not run")
				}
				words := result.Stages[wordsAt].Output
				next := result.Stages[wordsAt+1].Input
				if len(words) == 0 || len(next) != len(words) || &next[0] != &words[0] {
					t.Fatal("continuation did not reuse word output")
				}
			} else if wordsAt+1 != len(result.Stages) {
				t.Fatal("parse continued beyond words")
			}
		})
	}
}
