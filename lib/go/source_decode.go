package gencmu

import (
	"encoding/json"
	"fmt"
)

func decodeSourceCall(o jobj, depth int) (*domSourceCall, error) {
	if depth > maxDOMDepth {
		return nil, errTooDeep
	}
	if !hasOneForm(o, [][]string{{"call", "args", "at"}}) {
		return nil, fmt.Errorf("a malformed call")
	}
	name, err := decodeString(o["call"])
	if err != nil {
		return nil, err
	}
	at, err := decodePosition(o["at"])
	if err != nil {
		return nil, err
	}
	args, err := decodeSourceArguments(o["args"], depth+1)
	return &domSourceCall{Name: name, At: at, Args: args}, err
}

func decodeSourceArguments(raw json.RawMessage, depth int) ([]*domArgument, error) {
	return decodeList(raw, func(raw json.RawMessage) (*domArgument, error) {
		if depth > maxDOMDepth {
			return nil, errTooDeep
		}
		o, err := decodeObj(raw)
		if err != nil {
			return nil, err
		}
		a := &domArgument{}
		switch {
		case o["body"] != nil:
			if len(o) != 1 {
				return nil, fmt.Errorf("a malformed body argument")
			}
			a.Body = true
			a.Expr, err = decodeExprAt(o["body"], depth)
		case o["targets"] != nil:
			if len(o) != 1 {
				return nil, fmt.Errorf("a malformed target choice")
			}
			a.Targets, err = decodeList(o["targets"], func(raw json.RawMessage) (*domTerm, error) { return decodeTermAt(raw, depth) })
		case o["requirements"] != nil && o["test"] == nil:
			if len(o) != 1 {
				return nil, fmt.Errorf("a malformed requirement list")
			}
			a.Requirements, err = decodeRequirements(o["requirements"], depth)
		case o["test"] != nil || o["range"] != nil || o["wildcard"] != nil:
			a.Expr, err = decodeExprObj(raw, o, depth)
		default:
			a.Term, err = decodeTermAt(raw, depth)
		}
		return a, err
	})
}

func decodeParameter(o jobj) (string, [2]int, error) {
	name, err := decodeString(o["param"])
	if err != nil {
		return "", [2]int{}, err
	}
	at, err := decodePosition(o["at"])
	return name, at, err
}
