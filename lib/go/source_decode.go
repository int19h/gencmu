package gencmu

import (
	"fmt"
)

func (dc *domDecoder) decodeSourceCall(o domObject, depth int) (*domSourceCall, error) {
	if !hasOneForm(o, [][]string{{"call", "args", "at"}}) {
		return nil, fmt.Errorf("a malformed call")
	}
	name, err := domString(o["call"])
	if err != nil {
		return nil, err
	}
	at, err := domPosition(o["at"])
	if err != nil {
		return nil, err
	}
	args, err := dc.decodeSourceArguments(o["args"], depth+1)
	return &domSourceCall{Name: name, At: at, Args: args}, err
}

func (dc *domDecoder) decodeSourceArguments(raw any, depth int) ([]*domArgument, error) {
	return domList(raw, func(raw any) (*domArgument, error) {
		o, err := domObjectOf(raw)
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
			a.Expr, err = dc.decodeExprAt(o["body"], depth)
		case o["targets"] != nil:
			if len(o) != 1 {
				return nil, fmt.Errorf("a malformed target choice")
			}
			a.Targets, err = domList(o["targets"], func(raw any) (*domTerm, error) { return dc.decodeTermAt(raw, depth) })
		case o["requirements"] != nil && o["test"] == nil:
			if len(o) != 1 {
				return nil, fmt.Errorf("a malformed requirement list")
			}
			a.Requirements, err = dc.decodeRequirements(o["requirements"], depth)
		case o["test"] != nil || o["range"] != nil || o["wildcard"] != nil:
			a.Expr, err = dc.decodeExprObj(raw, o, depth)
		default:
			a.Term, err = dc.decodeTermAt(raw, depth)
		}
		return a, err
	})
}

func domParameter(o domObject) (string, [2]int, error) {
	name, err := domString(o["param"])
	if err != nil {
		return "", [2]int{}, err
	}
	at, err := domPosition(o["at"])
	return name, at, err
}

func onlyMembers[V any](o map[string]V, members ...string) bool {
	for key := range o {
		found := false
		for _, member := range members {
			if key == member {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}
