package gencmu

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"runtime/debug"
	"sort"
	"strings"
	"testing"
)

// The shared runners read, compare and write JSON as deep as a result or a
// case nests, with no limit of depth (tests/engine/deep-left-recursion.json).
// encoding/json refuses a document nested more than 10,000 deep, and
// reflect.DeepEqual recurses. So the runners decode, convert, compare and
// copy JSON here, each on a stack of its own.

// equalJSON says whether two decoded values are equal, as reflect.DeepEqual
// says of them, comparing pairs from a list of work.
func equalJSON(a, b any) bool {
	type pair struct{ a, b any }
	work := []pair{{a, b}}
	for len(work) > 0 {
		p := work[len(work)-1]
		work = work[:len(work)-1]
		switch x := p.a.(type) {
		case map[string]any:
			y, ok := p.b.(map[string]any)
			if !ok || len(x) != len(y) || (x == nil) != (y == nil) {
				return false
			}
			for k, v := range x {
				w, ok := y[k]
				if !ok {
					return false
				}
				work = append(work, pair{v, w})
			}
		case []any:
			y, ok := p.b.([]any)
			if !ok || len(x) != len(y) || (x == nil) != (y == nil) {
				return false
			}
			for i := range x {
				work = append(work, pair{x[i], y[i]})
			}
		case nil, string, float64, bool:
			if p.a != p.b {
				return false
			}
		default:
			if !reflect.DeepEqual(p.a, p.b) {
				return false
			}
		}
	}
	return true
}

// copyJSON is a copy of a decoded value that shares nothing with it.
func copyJSON(v any) any {
	type job struct {
		from any
		put  func(any)
	}
	var out any
	work := []job{{v, func(x any) { out = x }}}
	for len(work) > 0 {
		j := work[len(work)-1]
		work = work[:len(work)-1]
		switch x := j.from.(type) {
		case map[string]any:
			m := make(map[string]any, len(x))
			j.put(m)
			for k, v := range x {
				work = append(work, job{v, func(c any) { m[k] = c }})
			}
		case []any:
			a := make([]any, len(x))
			j.put(a)
			for i, v := range x {
				work = append(work, job{v, func(c any) { a[i] = c }})
			}
		default:
			j.put(x)
		}
	}
	return out
}

// encodeJSON writes a decoded value as JSON, members in the order of their
// names, from a list of work. A text longer than limit, if limit > 0, ends
// there, with "…" after it, for a message.
func encodeJSON(v any, limit int) string {
	var b strings.Builder
	// Each item is a value to write, or, where text is set, text.
	type item struct {
		v    any
		text string
	}
	work := []item{{v: v}}
	for len(work) > 0 {
		if limit > 0 && b.Len() > limit {
			return b.String()[:limit] + "…"
		}
		it := work[len(work)-1]
		work = work[:len(work)-1]
		if it.text != "" {
			b.WriteString(it.text)
			continue
		}
		switch x := it.v.(type) {
		case map[string]any:
			keys := make([]string, 0, len(x))
			for k := range x {
				keys = append(keys, k)
			}
			sort.Strings(keys)
			b.WriteByte('{')
			work = append(work, item{text: "}"})
			for i := len(keys) - 1; i >= 0; i-- {
				work = append(work, item{v: x[keys[i]]})
				name, _ := json.Marshal(keys[i])
				sep := ""
				if i > 0 {
					sep = ","
				}
				work = append(work, item{text: sep + string(name) + ":"})
			}
		case []any:
			b.WriteByte('[')
			work = append(work, item{text: "]"})
			for i := len(x) - 1; i >= 0; i-- {
				work = append(work, item{v: x[i]})
				if i > 0 {
					work = append(work, item{text: ","})
				}
			}
		default:
			data, err := json.Marshal(x)
			if err != nil {
				data = []byte(fmt.Sprintf("%v", x))
			}
			b.Write(data)
		}
	}
	return b.String()
}

// shown is a value as a message shows it: its JSON, cut short.
func shown(v any) string {
	return encodeJSON(v, 300)
}

// TestJSONTreeAgrees decodes every shared JSON file and corpus line, and
// some text that is not JSON, as json.Unmarshal does.
func TestJSONTreeAgrees(t *testing.T) {
	var docs [][]byte
	for _, pattern := range []string{"../../tests/*.json", "../../tests/*/*.json", "../../tests/corpus/*.jsonl"} {
		files, _ := filepath.Glob(pattern)
		for _, f := range files {
			data, err := os.ReadFile(f)
			if err != nil {
				t.Fatal(err)
			}
			if !strings.HasSuffix(f, ".jsonl") {
				docs = append(docs, data)
				continue
			}
			for _, line := range bytes.Split(data, []byte("\n")) {
				if len(bytes.TrimSpace(line)) > 0 {
					docs = append(docs, line)
				}
			}
		}
	}
	if len(docs) < 100 {
		t.Fatalf("only %d documents", len(docs))
	}
	for _, s := range []string{`{}`, `[]`, ` [1, -2.5e3, 0, "a\"é😀", true, false, null, {"a": {"b": []}}] `,
		`{"a": 1, "a": 2}`, `"\ud800"`, "\"\xff\"", `1e400`, `[1,]`, `{"a":1,}`, `{"a" 1}`, `[1 2]`, `01`, `-`, `1.`, `.5`,
		`1e`, `tru`, `nul`, `"a`, "\"\t\"", `[`, `]`, `{"a":}`, `{,}`, `[1] [2]`, ``, ` `, `{"a":[}`} {
		docs = append(docs, []byte(s))
	}
	for _, data := range docs {
		var want any
		werr := json.Unmarshal(data, &want)
		got, gerr := decodeJSON(data)
		if (werr == nil) != (gerr == nil) {
			t.Errorf("%.200s: encoding/json gives %v, decodeJSON %v", data, werr, gerr)
			continue
		}
		if werr == nil && !reflect.DeepEqual(got, want) {
			t.Errorf("%.200s: decoded as %s", data, shown(got))
		}
	}
	// A member kept raw keeps its text, and what follows it is read on.
	got, err := decodeJSON([]byte(`[{"d": {"x": [1, {"d": 2}]} , "e": 3}]`), "d")
	if err != nil || !reflect.DeepEqual(got, []any{map[string]any{"d": json.RawMessage(`{"x": [1, {"d": 2}]}`), "e": 3.0}}) {
		t.Errorf("raw: %#v %v", got, err)
	}
}

// TestJSONTreeDeep reads, converts, compares, copies and writes JSON
// 20,000 deep with the stack of a goroutine held to 1 MiB, which a
// recursion as deep as that would pass. encoding/json refuses such a
// document, as the runners did before they read JSON here.
func TestJSONTreeDeep(t *testing.T) {
	const n = 20000
	text := []byte(strings.Repeat(`{"text":"a","before":[`, n) + strings.Repeat(`]}`, n))
	var refused any
	if err := json.Unmarshal(text, &refused); err == nil || !strings.Contains(err.Error(), "exceeded max depth") {
		t.Fatalf("encoding/json gives %v", err)
	}
	defer debug.SetMaxStack(debug.SetMaxStack(1 << 20))
	tree, err := decodeJSON(text)
	if err != nil {
		t.Fatal(err)
	}
	// The members are written in the order of their names.
	if want := strings.Repeat(`{"before":[`, n) + strings.Repeat(`],"text":"a"}`, n); encodeJSON(tree, 0) != want {
		t.Error("the deep value is not written as it was read")
	}
	copied := copyJSON(tree)
	if !equalJSON(tree, copied) || match(tree, copied, "deep") != nil {
		t.Error("the copy differs")
	}
	// The innermost member differs, and the comparisons find it.
	inner := copied
	for range n - 1 {
		inner = inner.(map[string]any)["before"].([]any)[0]
	}
	inner.(map[string]any)["text"] = "b"
	if equalJSON(tree, copied) {
		t.Error("equalJSON misses the innermost difference")
	}
	if err := match(tree, copied, "deep"); err == nil || !strings.HasSuffix(strings.SplitN(err.Error(), ":", 2)[0], "[0].text") {
		t.Errorf("match gives %v", err)
	}
	// The tokens that a case attaches nest as deep, and each attached list
	// is made of its own.
	var spec caseToken
	if err := fromTree(tree, &spec); err != nil {
		t.Fatal(err)
	}
	if err := loadBundled(); err != nil {
		t.Fatal(err)
	}
	toks, _, err := caseTokens([]caseToken{spec})
	if err != nil {
		t.Fatal(err)
	}
	depth := 0
	for tok := toks; len(tok) > 0; tok = tok[0].Before {
		depth++
	}
	if depth != n {
		t.Errorf("tokens %d deep, not %d", depth, n)
	}
}
