package gencmu

import (
	"fmt"
	"sort"
	"strings"
)

type templateEvent struct {
	path     string
	rule     templateObject
	index    int
	origin   templateObject
	instance string
}
type ruleTemplate struct {
	name, path string
	arity      int
	at         [2]int
	events     []*templateEvent
}
type ruleInstance struct {
	key, canonical, name  string
	call, origin, binding templateObject
	locals, definitions   []*templateEvent
	discovered            bool
}

func (i *ruleInstance) effective() string {
	if i.name != "" {
		return i.name
	}
	return i.canonical
}

type templateExpansion struct {
	docs       []docDOM
	order      []string
	templates  []*ruleTemplate
	instances  []*ruleInstance
	validation []constUser
}
type templateExpander struct {
	uni           *unicodeTable
	patterns      map[string]bool
	templates     map[string]*ruleTemplate
	templateOrder []*ruleTemplate
	instances     map[string]*ruleInstance
	instanceOrder []*ruleInstance
	queue         []*ruleInstance
}

func (x *templateExpander) fail(e *templateEvent, n templateObject, message string) {
	at := templateAt(n)
	if at == [2]int{} {
		at = templateAt(e.rule)
	}
	if e.origin != nil {
		a := templateAt(e.origin)
		message += fmt.Sprintf(", in %s called at %s:%d:%d", e.instance, templateText(e.origin["document"]), a[0], a[1])
	}
	err := grammarError(e.path, at, "%s", message)
	if strings.HasPrefix(message, "unbounded-instantiation:") {
		err.Code = "unbounded-instantiation"
	}
	panic(err)
}
func templateRetained(items []*templateEvent) []*templateEvent {
	start := 0
	for i, e := range items {
		if e.rule["op"] != "extend" {
			start = i
		}
	}
	return items[start:]
}
func templateSorted(items ...[]*templateEvent) []*templateEvent {
	out := []*templateEvent{}
	for _, xs := range items {
		out = append(out, xs...)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].index < out[j].index })
	return out
}
func templateHasEvent(xs []*templateEvent, e *templateEvent) bool {
	for _, v := range xs {
		if v == e {
			return true
		}
	}
	return false
}
func expandTemplates(docs []docDOM, uni *unicodeTable) (result *templateExpansion, err *Error) {
	defer func() {
		if r := recover(); r != nil {
			if e, ok := r.(*Error); ok {
				err = e
				result = nil
			} else {
				panic(r)
			}
		}
	}()
	unresolved := false
	for _, d := range docs {
		for _, r := range d.dom.Rules {
			unresolved = unresolved || r.rawTemplate != nil
		}
		for _, r := range d.dom.Constants {
			unresolved = unresolved || r.rawTemplate != nil
		}
		for _, r := range d.dom.Directives {
			unresolved = unresolved || r.rawTemplate != nil
		}
		for _, r := range d.dom.Implications {
			unresolved = unresolved || r.rawTemplate != nil
		}
	}
	if !unresolved {
		return &templateExpansion{docs: docs}, nil
	}
	x := &templateExpander{uni: uni, templates: map[string]*ruleTemplate{}, instances: map[string]*ruleInstance{}}
	names := map[string][]*templateEvent{}
	slots := []string{}
	events, extra := []*templateEvent{}, []*templateEvent{}
	rawDocs := []templateObject{}
	serial := 0
	for _, d := range docs {
		raw, e := templateFromJSON(d.dom.json())
		if e != nil {
			panic(e)
		}
		templateSourceDocument(raw, d.dom)
		rawDocs = append(rawDocs, raw)
		type item struct {
			kind string
			rule templateObject
		}
		items := []item{}
		for _, kind := range []string{"rules", "constants", "directives", "classifiers", "implications"} {
			for _, v := range templateList(raw[kind]) {
				items = append(items, item{kind, templateObj(v)})
			}
		}
		sort.SliceStable(items, func(i, j int) bool { return before(templateAt(items[i].rule), templateAt(items[j].rule)) })
		for _, it := range items {
			r := it.rule
			e := &templateEvent{path: d.path, rule: r, index: serial}
			serial++
			if it.kind != "rules" {
				extra = append(extra, e)
				continue
			}
			events = append(events, e)
			name := templateText(r["name"])
			if r["params"] != nil {
				previous := x.templates[name]
				if r["op"] == "define" {
					if previous != nil || names[name] != nil {
						x.fail(e, r, "duplicate template "+name)
					}
					t := &ruleTemplate{name: name, path: d.path, arity: len(templateList(r["params"])), at: templateAt(r), events: []*templateEvent{e}}
					x.templates[name] = t
					x.templateOrder = append(x.templateOrder, t)
				} else {
					if previous == nil || previous.arity != len(templateList(r["params"])) {
						x.fail(e, r, "template "+name+" requires an earlier declaration with the same arity")
					}
					previous.events = append(previous.events, e)
				}
			} else if r["args"] == nil {
				if x.templates[name] != nil {
					x.fail(e, r, "a template and an ordinary rule cannot share a name")
				}
				if r["op"] == "define" {
					if names[name] != nil {
						x.fail(e, r, "duplicate rule "+name)
					}
					names[name] = []*templateEvent{e}
					slots = append(slots, name)
				} else {
					if names[name] == nil {
						x.fail(e, r, name+" requires an earlier definition")
					}
					names[name] = append(names[name], e)
				}
			}
		}
	}
	definitions := []templateObject{}
	for _, doc := range rawDocs {
		for _, c := range templateList(doc["constants"]) {
			definitions = append(definitions, templateObj(c))
		}
	}
	x.patterns = templatePatternConstants(definitions)
	x.flow(templateSorted(events, extra))
	current := map[string]*ruleInstance{}
	ordinary := map[string][]*templateEvent{}
	for _, e := range events {
		r := e.rule
		name := templateText(r["name"])
		if r["params"] != nil {
			continue
		}
		if r["args"] != nil {
			t := x.templates[name]
			if t == nil || t.events[0].index >= e.index {
				x.fail(e, r, "an instance edit requires an earlier template")
			}
			i := x.intern(templateObject{"call": name, "args": r["args"], "at": r["at"]}, e, false)
			i.locals = append(i.locals, e)
		} else if r["instance"] != nil {
			i := x.intern(templateObj(r["instance"]), e, false)
			old := current[name]
			if i.name != "" && i.name != name {
				x.fail(e, r, "an instance has at most one public name")
			}
			if old == i {
				x.fail(e, r, "repeating an instance binding is invalid")
			}
			if old != nil {
				old.name = ""
				old.binding = nil
			}
			i.name = name
			i.binding = templateObject{"document": e.path, "line": float64(templateAt(r)[0]), "column": float64(templateAt(r)[1])}
			current[name] = i
			delete(ordinary, name)
		} else if current[name] != nil {
			current[name].locals = append(current[name].locals, e)
		} else {
			ordinary[name] = append(ordinary[name], e)
		}
	}
	for _, e := range templateSorted(events, extra) {
		r := e.rule
		if templateHasEvent(extra, e) {
			x.discover(r, e)
			continue
		}
		if r["instance"] != nil {
			x.discover(r["instance"], e)
			continue
		}
		if r["args"] != nil {
			x.discover(templateObject{"call": r["name"], "args": r["args"], "at": r["at"]}, e)
		}
		var items []*templateEvent
		if r["params"] != nil {
			items = x.templates[templateText(r["name"])].events
		} else {
			items = ordinary[templateText(r["name"])]
		}
		if items == nil {
			for _, i := range x.instanceOrder {
				if templateHasEvent(i.locals, e) {
					items = templateSorted(x.templates[templateText(i.call["call"])].events, i.locals)
					break
				}
			}
		}
		if items != nil && templateHasEvent(templateRetained(items), e) {
			body := templateCopy(r)
			delete(body, "args")
			x.discover(body, e)
		}
	}
	for cursor := 0; cursor < len(x.queue); cursor++ {
		i := x.queue[cursor]
		t := x.templates[templateText(i.call["call"])]
		for _, e := range templateSorted(t.events, i.locals) {
			env := map[string]templateObject{}
			for k, p := range templateList(e.rule["params"]) {
				env[templateText(p)] = templateObj(templateList(i.call["args"])[k])
			}
			body := templateCopy(e.rule)
			delete(body, "params")
			delete(body, "args")
			delete(body, "instance")
			body["name"] = i.effective()
			context := &templateEvent{path: e.path, rule: e.rule, index: e.index, origin: i.origin, instance: i.canonical}
			expanded := x.substitute(body, env, context, "term")
			checked := templateCopy(templateObj(expanded))
			checked["name"] = "expanded"
			if p := checkTemplateDeclaration(checked, "rules", uni); p != nil {
				x.fail(context, templateObj(expanded), p.message)
			}
			copy := *context
			copy.rule = templateObj(expanded)
			i.definitions = append(i.definitions, &copy)
		}
		for _, e := range templateRetained(i.definitions) {
			x.discover(e.rule, e)
		}
	}
	validation := []*templateEvent{}
	for _, e := range events {
		if e.rule["params"] == nil && e.rule["args"] == nil && e.rule["instance"] == nil {
			copy := *e
			copy.rule = templateObj(x.rewrite(e.rule, e, "term"))
			validation = append(validation, &copy)
		}
	}
	for _, i := range x.queue {
		for _, e := range i.definitions {
			copy := *e
			body := templateCopy(e.rule)
			body["name"] = i.effective()
			copy.rule = templateObj(x.rewrite(body, e, "term"))
			validation = append(validation, &copy)
		}
	}
	users := []constUser{}
	for _, e := range validation {
		shadow := templateObj(templateClone(e.rule))
		aliases := map[string]string{}
		for _, n := range templateNodes(shadow) {
			for _, k := range []string{"name", "rule", "ref"} {
				s := templateText(n[k])
				if strings.Contains(s, "(") {
					if aliases[s] == "" {
						aliases[s] = fmt.Sprintf("instance-%d", len(aliases))
					}
					n[k] = aliases[s]
				}
			}
		}
		dom, decodeErr := decodeDOMMode(templateJSON(templateDocument([]any{shadow})), uni, false)
		if decodeErr != nil {
			x.fail(e, e.rule, decodeErr.Error())
		}
		_ = dom
		written, decodeErr := decodeDOMMode(templateJSON(templateDocument([]any{e.rule})), uni, true)
		if decodeErr != nil {
			x.fail(e, e.rule, decodeErr.Error())
		}
		restoreTemplateRuleLocations(written.Rules[0], e.rule)
		users = append(users, constUser{doc: e.path, rule: written.Rules[0]})
	}
	output := []*templateEvent{}
	for _, name := range slots {
		for _, e := range ordinary[name] {
			copy := *e
			copy.rule = templateObj(x.rewrite(e.rule, e, "term"))
			output = append(output, &copy)
		}
	}
	for _, i := range x.queue {
		for _, e := range i.definitions {
			copy := *e
			body := templateCopy(e.rule)
			body["name"] = i.effective()
			copy.rule = templateObj(x.rewrite(body, e, "term"))
			output = append(output, &copy)
		}
	}
	started := map[string]bool{}
	for _, e := range output {
		name := templateText(e.rule["name"])
		if !started[name] {
			e.rule = templateCopy(e.rule)
			e.rule["op"] = "define"
			started[name] = true
		}
	}
	expandedDocs := []docDOM{}
	for index, d := range docs {
		dom := templateCopy(rawDocs[index])
		dom["rules"] = []any{}
		for _, kind := range []string{"constants", "directives", "classifiers", "implications"} {
			items := []any{}
			for _, v := range templateList(dom[kind]) {
				e := &templateEvent{path: d.path, rule: templateObj(v)}
				items = append(items, x.rewrite(v, e, "term"))
			}
			dom[kind] = items
		}
		written, decodeErr := decodeDOMMode(templateJSON(dom), uni, true)
		if decodeErr != nil {
			x.fail(&templateEvent{path: d.path, rule: templateObject{}}, templateObject{}, decodeErr.Error())
		}
		expandedDocs = append(expandedDocs, docDOM{d.path, written})
	}
	for _, e := range output {
		dom, decodeErr := decodeDOMMode(templateJSON(templateDocument([]any{e.rule})), uni, true)
		if decodeErr != nil {
			x.fail(e, e.rule, decodeErr.Error())
		}
		restoreTemplateRuleLocations(dom.Rules[0], e.rule)
		expandedDocs = append(expandedDocs, docDOM{e.path, dom})
	}
	order := []string{}
	for _, name := range slots {
		if current[name] != nil || ordinary[name] != nil {
			order = append(order, name)
		}
	}
	for _, i := range x.queue {
		if i.name == "" {
			order = append(order, i.effective())
		}
	}
	return &templateExpansion{docs: expandedDocs, order: order, templates: x.templateOrder, instances: x.queue, validation: users}, nil
}
func templateClone(v any) any {
	switch n := v.(type) {
	case map[string]any:
		r := templateObject{}
		for k, v := range n {
			r[k] = templateClone(v)
		}
		return r
	case []any:
		r := make([]any, len(n))
		for i, v := range n {
			r[i] = templateClone(v)
		}
		return r
	}
	return v
}
func (x *templateExpander) intern(call templateObject, e *templateEvent, discover bool) *ruleInstance {
	t := x.templates[templateText(call["call"])]
	if t == nil || len(templateList(call["args"])) != t.arity {
		x.fail(e, call, "an instance call requires the declared arity")
	}
	for _, n := range templateNodes(call["args"]) {
		if n["param"] != nil {
			x.fail(e, n, "an instance edit requires a closed call")
		}
	}
	normalized := templateObject{"call": call["call"], "args": x.normalize(call["args"]), "at": call["at"]}
	key := templateKey(normalized)
	i := x.instances[key]
	if i == nil {
		i = &ruleInstance{key: key, canonical: templateCanonical(normalized, x.uni), call: normalized, origin: templateObject{"document": e.path, "at": call["at"]}}
		x.instances[key] = i
		x.instanceOrder = append(x.instanceOrder, i)
	}
	if discover && !i.discovered {
		i.discovered = true
		i.origin = templateObject{"document": e.path, "at": call["at"]}
		x.queue = append(x.queue, i)
	}
	return i
}
func (x *templateExpander) discover(root any, e *templateEvent) {
	switch n := root.(type) {
	case []any:
		for _, v := range n {
			x.discover(v, e)
		}
	case map[string]any:
		if n["alternatives"] != nil {
			for i, a := range templateList(n["alternatives"]) {
				alt := templateObj(a)
				for _, k := range []string{"expr", "tags", "value", "image"} {
					x.discover(alt[k], e)
				}
				if i == 0 {
					for _, k := range []string{"tags", "value", "image", "conditions", "emit"} {
						x.discover(n[k], e)
					}
				}
			}
			return
		}
		if n["method"] != nil {
			x.discover(n["receiver"], e)
			x.discover(n["args"], e)
		} else if n["call"] != nil {
			x.discover(n["args"], e)
		} else {
			for _, k := range templateOrderedKeys(n) {
				if k != "at" {
					x.discover(n[k], e)
				}
			}
		}
		if n["call"] != nil {
			closed := true
			for _, part := range templateNodes(n["args"]) {
				closed = closed && part["param"] == nil
			}
			if closed {
				x.intern(n, e, true)
			}
		}
		if n["call"] != nil && n["children"] != nil {
			x.discover(n["children"], e)
		}
	}
}
func templateOrderedKeys(n templateObject) []string {
	keys := []string{}
	seen := map[string]bool{}
	for _, k := range []string{"if", "then", "op", "left", "right", "not", "any", "all", "body", "targets", "requirements", "negated", "value", "pattern", "child", "children", "expr", "repeat", "separator", "optional", "seq", "choice", "ranked", "and", "union", "intersection", "difference", "concat", "items", "tags", "image", "before", "after"} {
		if _, ok := n[k]; ok {
			keys = append(keys, k)
			seen[k] = true
		}
	}
	for _, k := range templateKeys(n) {
		if !seen[k] {
			keys = append(keys, k)
		}
	}
	return keys
}

type templateFlowPoint struct {
	name  string
	index int
}
type templateFlowEdge struct {
	to             templateFlowPoint
	growing        bool
	event          *templateEvent
	node, argument templateObject
}

func (x *templateExpander) flow(events []*templateEvent) {
	edges := map[templateFlowPoint][]templateFlowEdge{}
	for _, e := range events {
		params := templateList(e.rule["params"])
		for _, n := range templateNodes(e.rule) {
			if n["param"] != nil {
				found := false
				for _, p := range params {
					found = found || p == n["param"]
				}
				if !found {
					x.fail(e, n, "undeclared parameter @"+templateText(n["param"]))
				}
			}
			if n["call"] == nil {
				continue
			}
			t := x.templates[templateText(n["call"])]
			if t == nil {
				x.fail(e, n, "unknown template "+templateText(n["call"]))
			}
			if len(templateList(n["args"])) != t.arity {
				x.fail(e, n, fmt.Sprintf("template %s expects %d arguments", t.name, t.arity))
			}
			for j, arg := range templateList(n["args"]) {
				for _, part := range templateNodes(arg) {
					if part["capture"] != nil || part["captured"] != nil {
						x.fail(e, part, "an argument cannot read or declare captures")
					}
					for k, p := range params {
						if p == part["param"] {
							source := templateFlowPoint{templateText(e.rule["name"]), k}
							edges[source] = append(edges[source], templateFlowEdge{to: templateFlowPoint{t.name, j}, growing: templateObj(x.normalize(arg))["param"] != part["param"], event: e, node: n, argument: templateObj(arg)})
						}
					}
				}
			}
		}
	}
	points := []templateFlowPoint{}
	for _, t := range x.templateOrder {
		for index := 0; index < t.arity; index++ {
			points = append(points, templateFlowPoint{t.name, index})
		}
	}
	for _, source := range points {
		outgoing := edges[source]
		for _, edge := range outgoing {
			if !edge.growing {
				continue
			}
			type step struct {
				point templateFlowPoint
				trail string
			}
			pending := []step{{edge.to, fmt.Sprintf("%s:%d → %s:%d at %s:%d:%d", source.name, source.index, edge.to.name, edge.to.index, edge.event.path, templateAt(edge.node)[0], templateAt(edge.node)[1])}}
			seen := map[templateFlowPoint]bool{}
			for len(pending) > 0 {
				last := pending[len(pending)-1]
				pending = pending[:len(pending)-1]
				if last.point == source {
					x.fail(edge.event, edge.node, "unbounded-instantiation: "+last.trail+", growing argument "+templateCanonical(edge.argument, x.uni))
				}
				if seen[last.point] {
					continue
				}
				seen[last.point] = true
				for _, next := range edges[last.point] {
					pending = append(pending, step{next.to, last.trail + fmt.Sprintf(" then %s:%d → %s:%d at %s:%d:%d", last.point.name, last.point.index, next.to.name, next.to.index, next.event.path, templateAt(next.node)[0], templateAt(next.node)[1])})
				}
			}
		}
	}
}
func (x *templateExpander) convert(arg templateObject, position string, e *templateEvent, use templateObject) templateObject {
	arg = templateObj(x.normalize(arg))
	if position == "arg" {
		return arg
	}
	switch position {
	case "expr":
		if arg["body"] != nil {
			return templateObj(arg["body"])
		}
		if arg["targets"] != nil {
			xs := []any{}
			for _, v := range templateList(arg["targets"]) {
				xs = append(xs, x.convert(templateObj(v), "expr", e, use))
			}
			return templateObject{"choice": xs}
		}
		for _, k := range []string{"rule", "tag", "terminal"} {
			if arg[k] != nil {
				return templateObject{"ref": arg[k]}
			}
		}
		if arg["string"] != nil || arg["const"] != nil {
			return templateObject{"literal": arg}
		}
		for _, k := range []string{"call", "test", "range", "wildcard"} {
			if arg[k] != nil {
				return arg
			}
		}
	case "pattern":
		if arg["rule"] != nil {
			return templateObject{"name": arg["rule"], "at": use["at"]}
		}
		for _, k := range []string{"tag", "terminal"} {
			if arg[k] != nil {
				return templateObject{"terminal": arg[k], "at": use["at"]}
			}
		}
		if arg["pattern"] != nil {
			return templateObj(arg["pattern"])
		}
		if arg["string"] != nil {
			return templateObject{"literal": arg, "at": use["at"]}
		}
		if arg["const"] != nil {
			return templateObject{"constant": arg["const"], "at": use["at"]}
		}
		if arg["test"] != nil {
			r := templateCopy(arg)
			r["expr"] = x.convert(templateArgument(templateObj(arg["expr"])), "pattern", e, use)
			return r
		}
		for _, k := range []string{"range", "wildcard", "call"} {
			if arg[k] != nil {
				r := templateCopy(arg)
				r["at"] = use["at"]
				return r
			}
		}
	case "target":
		if arg["tag"] != nil {
			return templateObject{"terminal": arg["tag"]}
		}
		for _, k := range []string{"rule", "terminal", "call"} {
			if arg[k] != nil {
				return arg
			}
		}
	case "term":
		valid := true
		for _, k := range []string{"body", "targets", "requirements", "rule", "call", "test", "range", "wildcard"} {
			valid = valid && arg[k] == nil
		}
		if valid {
			return arg
		}
	}
	x.fail(e, use, fmt.Sprintf("argument %s is invalid at @%s in %s position", templateCanonical(arg, x.uni), templateText(use["param"]), position))
	return nil
}
func (x *templateExpander) substitute(root any, env map[string]templateObject, e *templateEvent, position string) any {
	switch n := root.(type) {
	case []any:
		r := []any{}
		for _, v := range n {
			r = append(r, x.substitute(v, env, e, position))
		}
		return r
	case map[string]any:
		if n["param"] != nil {
			converted := x.convert(env[templateText(n["param"])], position, e, n)
			if position != "pattern" || n["exact"] == nil && n["children"] == nil {
				return converted
			}
			for _, key := range []string{"union", "intersection", "difference", "path"} {
				if converted[key] != nil {
					x.fail(e, n, "a compound pattern cannot carry node decorations")
				}
			}
			result := templateCopy(converted)
			if n["exact"] != nil {
				if converted["exact"] != nil {
					x.fail(e, n, "an exact prefix conflicts with an argument prefix")
				}
				result["exact"] = true
			}
			if n["children"] != nil {
				if converted["name"] == nil && converted["call"] == nil || converted["children"] != nil {
					x.fail(e, n, "an attached list requires a rule test without children")
				}
				result["children"] = x.substitute(n["children"], env, e, "pattern-item")
			}
			return result
		}
		r := templateCopy(n)
		for _, k := range templateOrderedKeys(n) {
			v := n[k]
			if k == "at" {
				continue
			}
			if k == "args" && n["call"] != nil {
				r[k] = x.substitute(v, env, e, "arg")
				continue
			}
			if k == "args" && n["method"] != nil {
				items := []any{}
				name := templateText(n["method"])
				query := strings.Contains("|matches|begins|ends|followed-by|preceded-by|", "|"+name+"|")
				target := query || name == "tags" || name == "without-elision-except"
				for _, a := range templateList(v) {
					arg := templateObj(a)
					replacement := env[templateText(arg["param"])]
					if query && replacement["targets"] != nil {
						for _, t := range templateList(replacement["targets"]) {
							items = append(items, x.convert(templateObj(t), "target", e, arg))
						}
					} else {
						p := "term"
						if target {
							p = "target"
						}
						items = append(items, x.substitute(arg, env, e, p))
					}
				}
				r[k] = items
				continue
			}
			if k == "requirements" {
				items := []any{}
				for _, a := range templateList(v) {
					req := templateObj(a)
					use := templateObj(req["value"])
					replacement := env[templateText(use["param"])]
					if templateOnly(replacement, "requirements") {
						if req["negated"] == true {
							x.fail(e, use, "a requirement list cannot replace a negated requirement")
						}
						items = append(items, templateList(replacement["requirements"])...)
					} else {
						item := templateCopy(req)
						item["value"] = x.substitute(use, env, e, "term")
						items = append(items, item)
					}
				}
				r[k] = items
				continue
			}
			if k == "optional" && n["elidable"] == true {
				head := templateObj(v)
				if head["seq"] != nil {
					head = templateObj(templateList(head["seq"])[0])
				}
				for head["test"] != nil {
					head = templateObj(head["expr"])
				}
				if head["param"] != nil {
					arg := templateObj(x.normalize(env[templateText(head["param"])]))
					if !templateOnly(arg, "tag") || !className.MatchString(templateText(arg["tag"])) {
						x.fail(e, head, "an elidable parameter head requires one bare user tag")
					}
				}
			}
			r[k] = x.substitute(v, env, e, templateChildPosition(k, position))
		}
		if position == "pattern" && r["test"] != nil && templateObj(r["expr"])["exact"] != nil {
			if r["exact"] != nil {
				use := templateObj(n["expr"])
				for use["expr"] != nil {
					use = templateObj(use["expr"])
				}
				x.fail(e, use, "an exact prefix conflicts with an argument prefix")
			}
			r["exact"] = true
			inner := templateCopy(templateObj(r["expr"]))
			delete(inner, "exact")
			r["expr"] = inner
		}

		keys := []string{"concat", "union"}
		if position == "pattern" || templatePatternTerm(r, x.patterns) {
			keys = append(keys, "intersection")
		}
		for _, k := range keys {
			if r[k] != nil {
				flat := []any{}
				for _, v := range templateList(r[k]) {
					if nested := templateObj(v)[k]; nested != nil {
						flat = append(flat, templateList(nested)...)
					} else {
						flat = append(flat, v)
					}
				}
				r[k] = flat
			}
		}
		return r
	}
	return root
}
func (x *templateExpander) rewrite(root any, e *templateEvent, position string) any {
	switch n := root.(type) {
	case []any:
		r := []any{}
		for _, v := range n {
			r = append(r, x.rewrite(v, e, position))
		}
		return r
	case map[string]any:
		if n["call"] != nil {
			i := x.instances[templateKey(x.normalize(templateObject{"call": n["call"], "args": n["args"], "at": n["at"]}))]
			name := templateCanonical(n, x.uni)
			if i != nil {
				name = i.effective()
			}
			if position == "pattern" {
				result := templateObject{"name": name, "at": n["at"]}
				if n["exact"] != nil {
					result["exact"] = true
				}
				if n["children"] != nil {
					result["children"] = x.rewrite(n["children"], e, "pattern-item")
				}
				return result
			}
			key := "rule"
			if position == "expr" {
				key = "ref"
			}
			return templateObject{key: name}
		}
		if position == "pattern" && x.templates[templateText(n["name"])] != nil {
			members := []any{}
			for _, i := range x.queue {
				if i.call["call"] == n["name"] {
					member := templateCopy(n)
					member["name"] = i.effective()
					if n["children"] != nil {
						member["children"] = x.rewrite(n["children"], e, "pattern-item")
					}
					members = append(members, member)
				}
			}
			if len(members) == 1 {
				return members[0]
			}
			if len(members) > 0 {
				return templateObject{"union": members}
			}
			return templateObject{"difference": []any{templateObject{"name": "text", "at": n["at"]}, templateObject{"name": "text", "at": n["at"]}}}
		}
		if x.templates[templateText(n["ref"])] != nil || x.templates[templateText(n["rule"])] != nil {
			x.fail(e, n, "a bare template reference must name one instance")
		}
		r := templateCopy(n)
		for k, v := range n {
			if k != "at" && k != templateSourceKey {
				r[k] = x.rewrite(v, e, templateChildPosition(k, position))
			}
		}
		if position == "pattern" {
			for _, key := range []string{"union", "intersection"} {
				if r[key] == nil {
					continue
				}
				flat := []any{}
				for _, v := range templateList(r[key]) {
					if nested := templateObj(v)[key]; nested != nil {
						flat = append(flat, templateList(nested)...)
					} else {
						flat = append(flat, v)
					}
				}
				r[key] = flat
			}
		}

		return r
	}
	return root
}
