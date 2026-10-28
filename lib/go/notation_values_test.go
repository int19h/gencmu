package gencmu

import (
	"encoding/json"
	"fmt"
	"os"
	"testing"
)

type notationAlias struct {
	Spelling string   `json:"spelling"`
	Value    string   `json:"value"`
	Tags     []string `json:"tags"`
}

// valueNotation adds the lexical aliases from tests/notation-values.json.
// The bootstrap's existing rules remain intact, including their positions.
func valueNotation(t *testing.T, aliases []notationAlias) string {
	t.Helper()
	var bootstrap map[string]any
	if err := json.Unmarshal([]byte(bundled.sources["data/preparsed/gencmu.json"]), &bootstrap); err != nil {
		t.Fatal(err)
	}
	lexical := bootstrap["documents"].(map[string]any)["grammars/gencmu/jbogenbau/lexical.md"].(map[string]any)["dom"].(map[string]any)
	if lexical == nil {
		t.Fatal("the bootstrap has no lexical stage")
	}
	rules := lexical["rules"].([]any)
	var piece map[string]any
	for _, rule := range rules {
		r := rule.(map[string]any)
		if r["name"] == "piece" {
			piece = r
		}
	}
	if piece == nil {
		t.Fatal("the lexical stage has no piece rule")
	}
	for i, alias := range aliases {
		name := fmt.Sprintf("value-alias-%d", i)
		piece["alternatives"] = append(piece["alternatives"].([]any), map[string]any{
			"guards": []any{}, "expr": map[string]any{"ref": name},
		})
		var seq, tags []any
		for _, c := range alias.Spelling {
			seq = append(seq, map[string]any{"literal": map[string]any{"string": string(c)}})
		}
		for _, tag := range alias.Tags {
			tags = append(tags, map[string]any{"tag": tag})
		}
		var tagExpr any = map[string]any{"union": tags}
		if len(tags) == 1 {
			tagExpr = tags[0]
		}
		rules = append(rules, map[string]any{
			"name": name, "op": "define", "flags": []string{"leftmost-longest"},
			"at": []int{100000 + i, 1}, "conditions": []any{},
			"alternatives": []any{map[string]any{"guards": []any{}, "expr": map[string]any{"seq": seq}}},
			"emit": map[string]any{"items": []any{map[string]any{
				"capture": "", "tags": tagExpr,
				"value": map[string]any{"concat": []any{map[string]any{"string": alias.Value}}},
			}}},
		})
	}
	lexical["rules"] = rules
	raw, err := json.Marshal(bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func TestNotationValues(t *testing.T) {
	t.Parallel()
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile("../../tests/notation-values.json")
	if err != nil {
		t.Fatal(err)
	}
	var suite struct {
		Cases []struct {
			ID          string          `json:"id"`
			Description string          `json:"description"`
			Aliases     []notationAlias `json:"aliases"`
			Document    string          `json:"document"`
			Expect      struct {
				Dom   any `json:"dom"`
				Error *struct {
					Line   int `json:"line"`
					Column int `json:"column"`
				} `json:"error"`
			} `json:"expect"`
		} `json:"cases"`
	}
	if err := unmarshalJSON(raw, &suite); err != nil {
		t.Fatal(err)
	}
	if len(suite.Cases) == 0 {
		t.Fatal("no supplied notation cases")
	}
	for _, c := range suite.Cases {
		t.Run(c.ID, func(t *testing.T) {
			t.Parallel()
			reader, err := newNotationReader(valueNotation(t, c.Aliases), bundled.uni)
			if err != nil {
				t.Fatal(err)
			}
			dom, rerr := reader.read(c.Document, "case.md")
			if expected := c.Expect.Error; expected != nil {
				if rerr == nil || rerr.Line != expected.Line || rerr.Column != expected.Column {
					t.Fatalf("%s: expected %d:%d, got %v", c.ID, expected.Line, expected.Column, rerr)
				}
				return
			}
			if rerr != nil {
				t.Fatalf("%s\n%v", c.Description, rerr)
			}
			if err := match(c.Expect.Dom, domValue(t, dom), "dom"); err != nil {
				t.Fatalf("%s\n%v\n%s", c.Description, err, dom.json())
			}
			notationCacheCases(t, c.Document, dom, reader)
		})
	}
}
