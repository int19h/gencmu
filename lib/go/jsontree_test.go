package gencmu

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"runtime/debug"
	"slices"
	"sort"
	"strconv"
	"strings"
	"testing"
	"unicode/utf8"
)

// The shared runners read, compare and write JSON as deep as a result or a
// case nests, with no limit of depth (tests/engine/deep-left-recursion.json).
// encoding/json refuses a document nested more than 10,000 deep, and
// reflect.DeepEqual recurses. So the runners decode, convert, compare and
// copy JSON here, each on a stack of its own.

// decodeJSON decodes a JSON document into the values that json.Unmarshal
// gives an any: maps, slices, strings, float64, bool and nil. A value whose
// member name is in raw stays the json.RawMessage of its text, as written.
func decodeJSON(data []byte, raw ...string) (any, error) {
	d := jsonDecoder{data: data, raw: raw, rawAt: -1}
	return d.document()
}

type jsonDecoder struct {
	data []byte
	at   int
	raw  []string
	// rawAt is the depth of the open object whose member is kept raw, or
	// -1, and rawFrom is where the member's value began.
	rawAt, rawFrom int
}

// jsonOpen is an object or an array whose members are still being read.
// key is the member name that the next value takes.
type jsonOpen struct {
	obj   map[string]any
	arr   []any
	isObj bool
	key   string
	// named says that a member's name is read and its value is not.
	named bool
}

func (d *jsonDecoder) fail(what string) error {
	return fmt.Errorf("JSON at byte %d: %s", d.at, what)
}

func (d *jsonDecoder) space() {
	for d.at < len(d.data) {
		switch d.data[d.at] {
		case ' ', '\t', '\n', '\r':
			d.at++
		default:
			return
		}
	}
}

func (d *jsonDecoder) document() (any, error) {
	var stack []*jsonOpen
	var root any
	// put gives a finished value to the open container on top, or makes it
	// the document. A value that began a raw member is kept as its text.
	put := func(v any) {
		if d.rawAt == len(stack) {
			v = json.RawMessage(d.data[d.rawFrom:d.at])
			d.rawAt = -1
		}
		if len(stack) == 0 {
			root = v
			return
		}
		top := stack[len(stack)-1]
		if top.isObj {
			top.obj[top.key], top.named = v, false
		} else {
			top.arr = append(top.arr, v)
		}
	}
	for {
		d.space()
		if d.at == len(d.data) {
			return nil, d.fail("unexpected end")
		}
		// A value, or the end of the container on top.
		c := d.data[d.at]
		if len(stack) > 0 {
			top := stack[len(stack)-1]
			closer := byte(']')
			if top.isObj {
				closer = '}'
			}
			if c == closer && !top.named {
				d.at++
				stack = stack[:len(stack)-1]
				if top.isObj {
					put(top.obj)
				} else {
					if top.arr == nil {
						top.arr = []any{}
					}
					put(top.arr)
				}
				if done, err := d.next(stack); done || err != nil {
					return root, err
				}
				continue
			}
		}
		start := d.at
		switch {
		case c == '{':
			d.at++
			open := &jsonOpen{obj: map[string]any{}, isObj: true}
			stack = append(stack, open)
			d.space()
			if d.at < len(d.data) && d.data[d.at] == '}' {
				continue
			}
			if err := d.member(open, len(stack)); err != nil {
				return nil, err
			}
			continue
		case c == '[':
			d.at++
			stack = append(stack, &jsonOpen{})
			continue
		case c == '"':
			s, err := d.str()
			if err != nil {
				return nil, err
			}
			put(s)
		case c == 't' || c == 'f' || c == 'n':
			for _, lit := range []struct {
				text  string
				value any
			}{{"true", true}, {"false", false}, {"null", nil}} {
				if strings.HasPrefix(string(d.data[d.at:min(len(d.data), d.at+5)]), lit.text) {
					d.at += len(lit.text)
					put(lit.value)
					break
				}
			}
			if d.at == start {
				return nil, d.fail("not a value")
			}
		default:
			f, err := d.number()
			if err != nil {
				return nil, err
			}
			put(f)
		}
		if done, err := d.next(stack); done || err != nil {
			return root, err
		}
	}
}

// next reads what follows a value: the end of the document, a comma and
// the next member's name, or the closer, which it leaves.
func (d *jsonDecoder) next(stack []*jsonOpen) (bool, error) {
	d.space()
	if len(stack) == 0 {
		if d.at != len(d.data) {
			return true, d.fail("data after the value")
		}
		return true, nil
	}
	if d.at == len(d.data) {
		return false, d.fail("unexpected end")
	}
	top := stack[len(stack)-1]
	switch c := d.data[d.at]; {
	case c == ',':
		d.at++
		if top.isObj {
			return false, d.member(top, len(stack))
		}
		d.space()
		if d.at < len(d.data) && d.data[d.at] == ']' {
			return false, d.fail("a comma before ]")
		}
		return false, nil
	case top.isObj && c == '}', !top.isObj && c == ']':
		return false, nil
	}
	return false, d.fail("expected a comma or a closer")
}

// member reads a member's name and its colon. Where the name is one that
// stays raw, the value's text is kept from where it begins, unless an
// outer value is kept raw already.
func (d *jsonDecoder) member(open *jsonOpen, depth int) error {
	d.space()
	if d.at == len(d.data) || d.data[d.at] != '"' {
		return d.fail("expected a member name")
	}
	key, err := d.str()
	if err != nil {
		return err
	}
	d.space()
	if d.at == len(d.data) || d.data[d.at] != ':' {
		return d.fail("expected a colon")
	}
	d.at++
	d.space()
	open.key, open.named = key, true
	if d.rawAt == -1 {
		for _, r := range d.raw {
			if r == key {
				d.rawAt, d.rawFrom = depth, d.at
			}
		}
	}
	return nil
}

// str reads a string. One with no escape, no control character and valid
// UTF-8 is its bytes. Any other goes to encoding/json, which decodes and
// checks it as json.Unmarshal does: a string never nests.
func (d *jsonDecoder) str() (string, error) {
	start := d.at
	d.at++
	plain := true
	for d.at < len(d.data) {
		c := d.data[d.at]
		switch {
		case c == '"':
			d.at++
			text := d.data[start:d.at]
			if plain && utf8.Valid(text) {
				return string(text[1 : len(text)-1]), nil
			}
			var s string
			if err := json.Unmarshal(text, &s); err != nil {
				return "", err
			}
			return s, nil
		case c == '\\':
			plain = false
			d.at += 2
		case c < 0x20:
			return "", d.fail("a control character in a string")
		default:
			d.at++
		}
	}
	return "", d.fail("an unterminated string")
}

// number reads a number as JSON writes it, as a float64.
func (d *jsonDecoder) number() (float64, error) {
	start := d.at
	digits := func() int {
		n := 0
		for d.at < len(d.data) && d.data[d.at] >= '0' && d.data[d.at] <= '9' {
			d.at++
			n++
		}
		return n
	}
	if d.at < len(d.data) && d.data[d.at] == '-' {
		d.at++
	}
	first := d.at
	if n := digits(); n == 0 || (n > 1 && d.data[first] == '0') {
		return 0, d.fail("not a value")
	}
	if d.at < len(d.data) && d.data[d.at] == '.' {
		d.at++
		if digits() == 0 {
			return 0, d.fail("a fraction with no digits")
		}
	}
	if d.at < len(d.data) && (d.data[d.at] == 'e' || d.data[d.at] == 'E') {
		d.at++
		if d.at < len(d.data) && (d.data[d.at] == '+' || d.data[d.at] == '-') {
			d.at++
		}
		if digits() == 0 {
			return 0, d.fail("an exponent with no digits")
		}
	}
	f, err := strconv.ParseFloat(string(d.data[start:d.at]), 64)
	if err != nil {
		return 0, d.fail(err.Error())
	}
	return f, nil
}

// unmarshalJSON decodes data into out, as json.Unmarshal does for the
// types that the runners decode, with no limit of depth.
func unmarshalJSON(data []byte, out any, raw ...string) error {
	tree, err := decodeJSON(data, raw...)
	if err != nil {
		return err
	}
	return fromTree(tree, out)
}

var rawMessageType = reflect.TypeOf(json.RawMessage(nil))

// jsonPath is where a value stands in a document: the step to it from the
// value that holds it. A message writes it out. Each step shares the path
// before it, so a deep walk does not copy its path at every step.
type jsonPath struct {
	up   *jsonPath
	step string
}

func (p *jsonPath) member(name string) *jsonPath { return &jsonPath{p, "." + name} }

func (p *jsonPath) index(i int) *jsonPath { return &jsonPath{p, "[" + strconv.Itoa(i) + "]"} }

func (p *jsonPath) String() string {
	var steps []string
	for ; p != nil; p = p.up {
		steps = append(steps, p.step)
	}
	slices.Reverse(steps)
	return strings.Join(steps, "")
}

// fromTree sets out, a pointer, from a decoded tree, as json.Unmarshal
// would from its text: a member names a field of a struct in any case, an
// unknown member is ignored, and null leaves a value as it is. Each value
// is set from a list of work, not by recursion. A value of a map is set
// once everything is, since a map holds a copy.
func fromTree(tree any, out any) error {
	type job struct {
		v    any
		to   reflect.Value
		path *jsonPath
	}
	type entry struct{ m, k, v reflect.Value }
	jobs := []job{{tree, reflect.ValueOf(out).Elem(), &jsonPath{step: "$"}}}
	var entries []entry
	for len(jobs) > 0 {
		j := jobs[len(jobs)-1]
		jobs = jobs[:len(jobs)-1]
		to := j.to
		if j.v == nil {
			continue
		}
		wrong := func() error {
			return fmt.Errorf("%s: cannot set a %s from %T", j.path, to.Type(), j.v)
		}
		if to.Type() == rawMessageType {
			r, ok := j.v.(json.RawMessage)
			if !ok {
				return wrong()
			}
			to.Set(reflect.ValueOf(r))
			continue
		}
		switch to.Kind() {
		case reflect.Interface:
			to.Set(reflect.ValueOf(j.v))
		case reflect.Pointer:
			p := reflect.New(to.Type().Elem())
			to.Set(p)
			jobs = append(jobs, job{j.v, p.Elem(), j.path})
		case reflect.Struct:
			m, ok := j.v.(map[string]any)
			if !ok {
				return wrong()
			}
			for k, v := range m {
				if f := fieldNamed(to, k); f.IsValid() {
					jobs = append(jobs, job{v, f, j.path.member(k)})
				}
			}
		case reflect.Slice:
			a, ok := j.v.([]any)
			if !ok {
				return wrong()
			}
			s := reflect.MakeSlice(to.Type(), len(a), len(a))
			to.Set(s)
			for i, v := range a {
				jobs = append(jobs, job{v, s.Index(i), j.path.index(i)})
			}
		case reflect.Map:
			m, ok := j.v.(map[string]any)
			if !ok || to.Type().Key().Kind() != reflect.String {
				return wrong()
			}
			mv := reflect.MakeMapWithSize(to.Type(), len(m))
			to.Set(mv)
			for k, v := range m {
				e := reflect.New(to.Type().Elem()).Elem()
				jobs = append(jobs, job{v, e, j.path.member(k)})
				entries = append(entries, entry{mv, reflect.ValueOf(k).Convert(to.Type().Key()), e})
			}
		case reflect.String:
			s, ok := j.v.(string)
			if !ok {
				return wrong()
			}
			to.SetString(s)
		case reflect.Bool:
			b, ok := j.v.(bool)
			if !ok {
				return wrong()
			}
			to.SetBool(b)
		case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
			f, ok := j.v.(float64)
			if !ok || f != float64(int64(f)) || to.OverflowInt(int64(f)) {
				return wrong()
			}
			to.SetInt(int64(f))
		case reflect.Float32, reflect.Float64:
			f, ok := j.v.(float64)
			if !ok {
				return wrong()
			}
			to.SetFloat(f)
		default:
			return wrong()
		}
	}
	for _, e := range entries {
		e.m.SetMapIndex(e.k, e.v)
	}
	return nil
}

// fieldNamed is the exported field of a struct that a member name sets:
// its json tag's name, or its own, matched exactly first and then in any
// case, as encoding/json matches them.
func fieldNamed(s reflect.Value, name string) reflect.Value {
	var folded reflect.Value
	for i := 0; i < s.NumField(); i++ {
		f := s.Type().Field(i)
		if f.PkgPath != "" {
			continue
		}
		fieldName := f.Name
		if tag, _, _ := strings.Cut(f.Tag.Get("json"), ","); tag == "-" {
			continue
		} else if tag != "" {
			fieldName = tag
		}
		if fieldName == name {
			return s.Field(i)
		}
		if !folded.IsValid() && strings.EqualFold(fieldName, name) {
			folded = s.Field(i)
		}
	}
	return folded
}

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
