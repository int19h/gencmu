package gencmu

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
)

// Shared DOM depth boundaries from engine §9 and tests/dom-depth.json.
func TestDOMDepth(t *testing.T) {
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile("../../tests/dom-depth.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Description        string
		DOM, Leaf, Wrapper json.RawMessage
		AtLimit            int
	}
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	if len(cases) == 0 {
		t.Fatal("no shared depth cases")
	}
	for _, c := range cases {
		t.Run(c.Description, func(t *testing.T) {
			wrapper := compactJSON(t, c.Wrapper)
			template := compactJSON(t, c.DOM)
			if strings.Count(wrapper, `"$inner"`) != 1 || strings.Count(template, `"$inner"`) != 1 {
				t.Fatal("one hole is required")
			}
			for extra := 0; extra <= 1; extra++ {
				node := compactJSON(t, c.Leaf)
				for i := 0; i < c.AtLimit+extra; i++ {
					node = strings.Replace(wrapper, `"$inner"`, node, 1)
				}
				text := strings.Replace(template, `"$inner"`, node, 1)
				text = fmt.Sprintf(`{"format":%d,`, domFormat) + text[1:]
				_, err := decodeDOM(json.RawMessage(text), bundled.uni)
				if extra == 0 && err != nil {
					t.Fatalf("at the limit: %v", err)
				}
				if extra == 1 && (err == nil || !strings.Contains(err.Error(), "nested")) {
					t.Fatalf("past the limit: %v", err)
				}
			}
		})
	}
}

func compactJSON(t *testing.T, raw json.RawMessage) string {
	t.Helper()
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func TestSourceDepth(t *testing.T) {
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile("../../tests/dom-depth-source.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Description, Head, Prefix, Leaf, Suffix, Tail string
		AtLimit                                       int
	}
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	for _, c := range cases {
		t.Run(c.Description, func(t *testing.T) {
			for extra := 0; extra <= 1; extra++ {
				n := c.AtLimit + extra
				source := "```jbogenbau\n" + c.Head + strings.Repeat(c.Prefix, n) + c.Leaf + strings.Repeat(c.Suffix, n) + c.Tail + "\n```\n"
				_, err := bundled.reader.read(source, "depth.md")
				if extra == 0 && err != nil {
					t.Fatalf("at the limit: %v", err)
				}
				if extra == 1 && (err == nil || !strings.Contains(err.Error(), "nested")) {
					t.Fatalf("past the limit: %v", err)
				}
			}
		})
	}
}
