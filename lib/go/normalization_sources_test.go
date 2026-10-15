package gencmu

import (
	"reflect"
	"testing"
)

func TestNormalizationStageZeroSources(t *testing.T) {
	t.Parallel()
	table := normalizationTable(t)
	for _, text := range []string{"á\u0323", "a\u0301\u0323", "각", "𝅗𝅥", ""} {
		t.Run(text, func(t *testing.T) {
			ps := newParseState(table, []rune(text))
			tokens := ps.characterTokens()
			normalized := table.decomposeWithOrigins([]rune(text))
			if len(tokens) != len(normalized) {
				t.Fatalf("tokens: %d, want %d", len(tokens), len(normalized))
			}
			for i, scalar := range normalized {
				token := tokens[i]
				if token.Value != string(scalar.character) || token.Image != token.Value || token.Text != string([]rune(text)[scalar.origin]) || token.Source != [2]int{scalar.origin, scalar.origin + 1} || token.Span != [2]int{i, i + 1} {
					t.Fatalf("token %d: %#v", i, token)
				}
				category := table.category(scalar.character)
				wantTags := []string{"_" + category, "_" + category[:1]}
				if !reflect.DeepEqual(token.Tags, wantTags) {
					t.Fatalf("tags: %v, want %v", token.Tags, wantTags)
				}
			}
			if string(ps.text) != text {
				t.Fatalf("original text changed: %q", string(ps.text))
			}
		})
	}
}

func TestNormalizationSourceEnvelopeAndPositions(t *testing.T) {
	t.Parallel()
	ps := newParseState(normalizationTable(t), []rune("á\u0323\r\n각"))
	tokens := ps.characterTokens()
	run := ps.newRun("test", nil, tokens)
	if got := run.spanSource(0, 3); got != [2]int{0, 2} {
		t.Fatalf("envelope: %v", got)
	}
	if got := run.spanText(spanVal{a: 0, b: 3}); got != "á\u0323" {
		t.Fatalf("source text: %q", got)
	}
	if got := run.spanSource(1, 3); got != [2]int{0, 2} {
		t.Fatalf("reordered envelope: %v", got)
	}
	if line, col := ps.lineColumn(4); line != 2 || col != 1 {
		t.Fatalf("position: %d:%d", line, col)
	}
	// The last decomposed mark originates before the last original mark.
	ps = newParseState(ps.uni, []rune("a\u0301\u0323"))
	run = ps.newRun("test", nil, ps.characterTokens())
	if got := run.spanSource(3, 3); got != [2]int{2, 2} {
		t.Fatalf("end anchor: %v", got)
	}
}
