package gencmu

import (
	"strconv"
	"unicode/utf8"
)

// jsonWriter builds canonical JSON (docs/output.md): no whitespace outside
// strings, keys in the order the caller writes them, non-ASCII characters as
// themselves.
type jsonWriter struct {
	buf []byte
}

func (w *jsonWriter) raw(s string) { w.buf = append(w.buf, s...) }

func (w *jsonWriter) str(s string) {
	w.buf = append(w.buf, '"')
	for i := 0; i < len(s); {
		c := s[i]
		if c < utf8.RuneSelf {
			switch {
			case c == '"':
				w.buf = append(w.buf, '\\', '"')
			case c == '\\':
				w.buf = append(w.buf, '\\', '\\')
			case c == '\n':
				w.buf = append(w.buf, '\\', 'n')
			case c == '\r':
				w.buf = append(w.buf, '\\', 'r')
			case c == '\t':
				w.buf = append(w.buf, '\\', 't')
			case c == '\b':
				w.buf = append(w.buf, '\\', 'b')
			case c == '\f':
				w.buf = append(w.buf, '\\', 'f')
			case c < 0x20:
				const hex = "0123456789abcdef"
				w.buf = append(w.buf, '\\', 'u', '0', '0', hex[c>>4], hex[c&15])
			default:
				w.buf = append(w.buf, c)
			}
			i++
			continue
		}
		r, size := utf8.DecodeRuneInString(s[i:])
		if r == utf8.RuneError && size == 1 {
			w.buf = append(w.buf, "�"...)
		} else {
			w.buf = append(w.buf, s[i:i+size]...)
		}
		i += size
	}
	w.buf = append(w.buf, '"')
}

func (w *jsonWriter) int(n int) { w.buf = strconv.AppendInt(w.buf, int64(n), 10) }

func (w *jsonWriter) bool(b bool) {
	if b {
		w.raw("true")
	} else {
		w.raw("false")
	}
}

// key writes a member name, preceded by a comma unless first.
func (w *jsonWriter) key(first bool, k string) {
	if !first {
		w.buf = append(w.buf, ',')
	}
	w.str(k)
	w.buf = append(w.buf, ':')
}

func (w *jsonWriter) pair(p [2]int) {
	w.buf = append(w.buf, '[')
	w.int(p[0])
	w.buf = append(w.buf, ',')
	w.int(p[1])
	w.buf = append(w.buf, ']')
}
