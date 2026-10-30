package gencmu

// templatePartial retains capture structure and types only the known operands.
// Unknown constants stand for unresolved terms during this private analysis.
func templatePartial(value any, kind string) any {
	if xs, ok := value.([]any); ok {
		out := make([]any, len(xs))
		for i, x := range xs {
			out[i] = templatePartial(x, kind)
		}
		return out
	}
	n := templateObj(value)
	if n == nil {
		return value
	}
	if n["param"] != nil || n["call"] != nil {
		if kind == "expr" {
			return templateObject{"wildcard": true}
		}
		if kind == "pattern" {
			return templateObject{"constant": "Unresolved", "at": []any{1, 1}}
		}
		return templateObject{"const": "Unresolved", "at": []any{1, 1}}
	}
	out := templateObject{}
	for key, child := range n {
		if key == templateSourceKey {
			continue
		}
		next := kind
		if key == "expr" || key == "seq" || key == "choice" || key == "ranked" || key == "and" || key == "optional" || key == "repeat" || key == "separator" {
			if kind != "pattern" {
				next = "expr"
			}
		}
		if key == "pattern" {
			next = "pattern"
		}
		if key == "literal" || key == "range" || key == "tags" || key == "value" || key == "image" || key == "conditions" || key == "receiver" || key == "args" || key == "requirements" {
			next = "term"
		}
		if key == "args" && partialQuery(templateText(n["method"])) || key == "args" && (n["method"] == "tags" || n["method"] == "without-elision-except") {
			args := []any{}
			for _, arg := range templateList(child) {
				a := templateObj(arg)
				if a["param"] != nil || a["call"] != nil {
					args = append(args, templateObject{"rule": "unresolved"})
				} else {
					args = append(args, templatePartial(arg, "term"))
				}
			}
			out[key] = args
		} else if key == "receiver" && (n["method"] == "followed-by" || n["method"] == "preceded-by") && (templateObj(child)["param"] != nil || templateObj(child)["call"] != nil) {
			out[key] = templateObject{"capture": ""}
		} else {
			out[key] = templatePartial(child, next)
		}
	}
	return out
}

func partialSourceRule(r *domRule) (*domRule, error) {
	w := &jsonWriter{}
	r.writeJSON(w)
	raw, err := templateFromJSON(w.buf)
	if err != nil {
		return nil, err
	}
	projected := templateObj(templatePartial(raw, "declaration"))
	delete(projected, "params")
	delete(projected, "args")
	return decodeRule(templateJSON(projected))
}

func partialQuery(name string) bool {
	switch name {
	case "matches", "begins", "ends", "starts-input", "ends-input", "followed-by", "preceded-by":
		return true
	}
	return false
}
