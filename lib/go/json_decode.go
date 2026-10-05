package gencmu

import (
	"encoding/json"
	"fmt"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"
)

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

// fromTree sets out, a pointer, from a decoded tree. A member names a
// struct field by its exact JSON name, an
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

// fieldNamed finds an exported field by its exact JSON tag or field name.
func fieldNamed(s reflect.Value, name string) reflect.Value {
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
	}
	return reflect.Value{}
}
