package gencmu

import (
	"encoding/json"
	"fmt"
	"slices"
)

type domObject = map[string]any

// A conversion job reads one constructor. Its children fill stable result
// nodes through later jobs, so conversion needs no recursive call stack.
type domDecoder struct{ pending []func() error }

func (dc *domDecoder) run() error {
	slices.Reverse(dc.pending)
	for len(dc.pending) > 0 {
		last := len(dc.pending) - 1
		job := dc.pending[last]
		dc.pending = dc.pending[:last]
		start := len(dc.pending)
		if err := job(); err != nil {
			return err
		}
		// The first child scheduled is the next child converted.
		slices.Reverse(dc.pending[start:])
	}
	return nil
}

func domObjectOf(value any) (domObject, error) {
	object, ok := value.(map[string]any)
	if !ok || object == nil {
		return nil, fmt.Errorf("expected an object")
	}
	return object, nil
}
func domArray(value any) bool { _, ok := value.([]any); return ok }
func domTrue(value any) bool  { return value == true }
func domString(value any) (string, error) {
	text, ok := value.(string)
	if !ok {
		return "", fmt.Errorf("a malformed string")
	}
	return text, nil
}
func domScalar(value, out any) error {
	if value == nil {
		return fmt.Errorf("a null where the DOM holds a value")
	}
	return fromTree(value, out)
}
func domList[T any](value any, each func(any) (T, error)) ([]T, error) {
	items, ok := value.([]any)
	if !ok {
		return nil, fmt.Errorf("a malformed list")
	}
	out := make([]T, 0, len(items))
	for _, item := range items {
		result, err := each(item)
		if err != nil {
			return nil, err
		}
		out = append(out, result)
	}
	return out, nil
}
func domPosition(value any) ([2]int, error) {
	pair, err := domList(value, func(value any) (int, error) {
		var number int
		err := domScalar(value, &number)
		return number, err
	})
	if err != nil || len(pair) != 2 || pair[0] < 1 || pair[1] < 1 {
		return [2]int{}, fmt.Errorf("a malformed position")
	}
	return [2]int{pair[0], pair[1]}, nil
}

// Standalone callers use the same tree conversion as complete documents.
func decodeTerm(raw json.RawMessage) (*domTerm, error) {
	parser := jsonDecoder{data: raw, numbers: true}
	value, err := parser.document(nil)
	if err != nil {
		return nil, err
	}
	dc := &domDecoder{}
	term, err := dc.decodeTerm(value)
	if err == nil {
		err = dc.run()
	}
	return term, err
}
func decodeLayeredPattern(raw json.RawMessage, depth int) (*domPattern, error) {
	parser := jsonDecoder{data: raw, numbers: true}
	value, err := parser.document(nil)
	if err != nil {
		return nil, err
	}
	dc := &domDecoder{}
	pattern, err := dc.decodeLayeredPattern(value, depth)
	if err == nil {
		err = dc.run()
	}
	return pattern, err
}
