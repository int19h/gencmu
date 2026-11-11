package gencmu

import (
	"fmt"
	"sort"
	"strings"
)

type templateEvent struct {
	kind          int
	definition    *templateEvent // the source definition shared by validation and output
	path          string
	rule          templateObject
	index         int
	inspectionRun int
	origin        templateObject
	instance      string
	// heldParameter says, per condition of the generic rule, whether it
	// held a parameter as written (§3.6).
	templateConditions []*domCond
}

// templateConditionsOf gives, per condition of a rule as written, its
// form where it mentions a parameter (§3.6). A parameter decodes to a
// parameter term, which is never closed, so the decoded form is the
// template's reading.
func templateConditionsOf(rule templateObject) []*domCond {
	conditions, _ := rule["conditions"].([]any)
	held := make([]*domCond, len(conditions))
	for i, condition := range conditions {
		if mentionsAnyParameter(condition) {
			if decoded, err := decodeCondJSON(templateJSON(condition)); err == nil {
				held[i] = decoded
			}
		}
	}
	return held
}

func mentionsAnyParameter(value any) bool {
	switch node := value.(type) {
	case map[string]any:
		for key, member := range node {
			if key == "param" {
				if _, ok := member.(string); ok {
					return true
				}
			}
			if key != "at" && mentionsAnyParameter(member) {
				return true
			}
		}
	case []any:
		for _, member := range node {
			if mentionsAnyParameter(member) {
				return true
			}
		}
	}
	return false
}

type ruleTemplate struct {
	name   string
	arity  int
	events []*templateEvent
}
type ruleInstance struct {
	canonical, name     string
	call, origin        templateObject
	locals, definitions []*templateEvent
	discovered          bool
}

func (i *ruleInstance) effective() string {
	if i.name != "" {
		return i.name
	}
	return i.canonical
}

type templateExpansion struct {
	erasureChecks  []erasurePatternCheck
	docs           []docDOM
	inspectionRuns []int
	order          []string
	instanceNames  []string
	validation     []constUser
	arguments      []constArgument
}
type templateExpander struct {
	erasureChecks []erasurePatternCheck
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
		unresolved = unresolved || d.dom.unresolved
	}
	if !unresolved {
		return &templateExpansion{docs: docs}, nil
	}
	x := &templateExpander{erasureChecks: []erasurePatternCheck{}, uni: uni, templates: map[string]*ruleTemplate{}, instances: map[string]*ruleInstance{}}
	names := map[string][]*templateEvent{}
	slots := []string{}
	events, extra, sourceEvents := []*templateEvent{}, []*templateEvent{}, []*templateEvent{}
	rawDocs := []templateObject{}
	serial := 0
	for docIndex, d := range docs {
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
		for _, kind := range []string{"rules", "directives", "constants", "classifiers", "implications", "checks"} {
			for _, v := range templateList(raw[kind]) {
				items = append(items, item{kind, templateObj(v)})
			}
		}
		sort.SliceStable(items, func(i, j int) bool { return before(templateAt(items[i].rule), templateAt(items[j].rule)) })
		for _, it := range items {
			r := it.rule
			e := &templateEvent{path: d.path, rule: r, index: serial, inspectionRun: docIndex, kind: map[string]int{"rules": 0, "directives": 1, "constants": 2, "classifiers": 3, "implications": 4, "checks": 5}[it.kind]}
			serial++
			sourceEvents = append(sourceEvents, e)
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
					t := &ruleTemplate{name: name, arity: len(templateList(r["params"])), events: []*templateEvent{e}}
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
	x.flow(sourceEvents)
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
			}
			i.name = name
			current[name] = i
			delete(ordinary, name)
		} else if current[name] != nil {
			current[name].locals = append(current[name].locals, e)
		} else {
			ordinary[name] = append(ordinary[name], e)
		}
	}
	extraIndexes := map[int]bool{}
	for _, e := range extra {
		extraIndexes[e.index] = true
	}
	retainedIndexes := map[int]bool{}
	rememberRetained := func(histories ...[]*templateEvent) {
		first := 0
		for _, history := range histories {
			for _, e := range history {
				if e.rule["op"] != "extend" && e.index > first {
					first = e.index
				}
			}
		}
		for _, history := range histories {
			for _, e := range history {
				if e.index >= first {
					retainedIndexes[e.index] = true
				}
			}
		}
	}
	for _, t := range x.templateOrder {
		rememberRetained(t.events)
	}
	for _, history := range ordinary {
		rememberRetained(history)
	}
	for _, i := range x.instanceOrder {
		rememberRetained(x.templates[templateText(i.call["call"])].events, i.locals)
	}
	for _, e := range sourceEvents {
		r := e.rule
		if extraIndexes[e.index] {
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
		if retainedIndexes[e.index] {
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
			context := &templateEvent{path: e.path, rule: e.rule, index: e.index, origin: i.origin, instance: i.canonical, templateConditions: templateConditionsOf(e.rule)}
			expanded := x.substitute(body, env, context, "term")
			copy := *context
			copy.rule = templateObj(expanded)
			x.inspectDefinition(&copy)
			i.definitions = append(i.definitions, &copy)
		}
		for _, e := range templateRetained(i.definitions) {
			x.discover(e.rule, e)
		}
	}
	validationKeys := map[string]bool{}
	for key := range x.instances {
		validationKeys[key] = true
	}
	type validationCall struct{ call, origin templateObject }
	validationQueue := []validationCall{}
	validationDefinitions := []*templateEvent{}
	collect := func(root any, event *templateEvent) {
		templateCalls(root, func(call templateObject) {
			normalized := templateObject{"call": call["call"], "args": x.normalize(call["args"]), "at": call["at"]}
			key := templateKey(normalized)
			if !validationKeys[key] {
				validationKeys[key] = true
				validationQueue = append(validationQueue, validationCall{normalized, templateObject{"document": event.path, "at": call["at"]}})
			}
		})
	}
	for _, e := range events {
		if e.rule["params"] == nil && e.rule["args"] == nil && e.rule["instance"] == nil {
			collect(e.rule, e)
		}
	}
	for _, i := range x.queue {
		for _, e := range i.definitions {
			collect(e.rule, e)
		}
	}
	for cursor := 0; cursor < len(validationQueue); cursor++ {
		call, origin := validationQueue[cursor].call, validationQueue[cursor].origin
		name := templateCanonical(call, uni)
		for _, e := range x.templates[templateText(call["call"])].events {
			env := map[string]templateObject{}
			for k, p := range templateList(e.rule["params"]) {
				env[templateText(p)] = templateObj(templateList(call["args"])[k])
			}
			body := templateCopy(e.rule)
			delete(body, "params")
			body["name"] = name
			context := &templateEvent{path: e.path, rule: e.rule, index: e.index, origin: origin, instance: name, templateConditions: templateConditionsOf(e.rule)}
			definition := *context
			definition.rule = templateObj(x.substitute(body, env, context, "term"))
			x.inspectDefinition(&definition)
			definition.definition = &definition
			validationDefinitions = append(validationDefinitions, &definition)
			collect(definition.rule, &definition)
		}
	}
	validation := []*templateEvent{}
	for _, e := range events {
		if e.rule["params"] != nil {
			x.rewrite(e.rule, e, "term")
			validation = append(validation, e)
		} else if e.rule["args"] == nil && e.rule["instance"] == nil {
			copy := *e
			copy.definition = e
			copy.rule = templateObj(x.rewrite(e.rule, e, "term"))
			validation = append(validation, &copy)
		}
	}
	for _, i := range x.queue {
		for _, e := range i.definitions {
			copy := *e
			copy.definition = e
			body := templateCopy(e.rule)
			body["name"] = i.effective()
			copy.rule = templateObj(x.rewrite(body, e, "term"))
			validation = append(validation, &copy)
		}
	}
	for _, e := range validationDefinitions {
		copy := *e
		copy.rule = templateObj(x.rewrite(e.rule, e, "term"))
		validation = append(validation, &copy)
	}
	ownerRuns := map[*templateEvent]int{}
	for index, event := range validation {
		run := event.inspectionRun
		if event.origin != nil {
			run = len(docs) + index
		}
		event.inspectionRun = run
		owner := event.definition
		if owner == nil {
			owner = event
		}
		ownerRuns[owner] = run
	}
	decodeInspection := func(event *templateEvent) *domDoc {
		dom, err := decodeDOMMode(templateJSON(templateDocument([]any{event.rule})), uni, true)
		if err != nil {
			x.fail(event, event.rule, err.Error())
		}
		if event.templateConditions != nil {
			dom.Rules[0].TemplateConditions = event.templateConditions
		}
		if problem := checkDOMMode(dom, uni, true); problem != nil {
			x.fail(event, event.rule, problem.message)
		}
		restoreTemplateRuleLocations(dom.Rules[0], event.rule)
		return dom
	}
	type fragmentInspection struct {
		index int
		event *templateEvent
	}
	var fragments []fragmentInspection
	arguments := []constArgument{}
	inspectArgument := func(argument templateObject, event *templateEvent) {
		parts := templateNodes(argument)
		references := []templateObject{}
		open := false
		for _, part := range parts {
			open = open || part["param"] != nil
			if part["const"] != nil || part["constant"] != nil {
				references = append(references, part)
			}
		}
		if len(references) == 0 {
			return
		}
		run, ok := ownerRuns[event]
		if !ok {
			run = event.inspectionRun
		}
		owner := constArgument{kind: event.kind, doc: event.path, at: templateAt(event.rule), position: templateAt(references[0]), inspectionRun: run}
		add := func(raw templateObject, tags bool) {
			term, err := decodeTerm(templateJSON(x.rewrite(raw, event, "term")))
			if err != nil {
				x.fail(event, raw, err.Error())
			}
			record := owner
			record.term, record.tags = term, tags
			arguments = append(arguments, record)
		}
		arg := templateObj(x.normalize(argument))
		if arg["body"] != nil || arg["test"] != nil || arg["range"] != nil || arg["wildcard"] != nil || arg["splice"] != nil {
			body := arg["body"]
			if body == nil {
				body = arg
			}
			name := event.rule["name"]
			if extraIndexes[event.index] {
				name = "text"
			}
			rule := templateObject{"name": name, "op": "define", "conditions": []any{}, "alternatives": []any{templateObject{"guards": []any{}, "expr": x.rewrite(body, event, "expr")}}, "at": event.rule["at"]}
			if open {
				rule["params"] = event.rule["params"]
			}
			copy := *event
			copy.rule = rule
			record := owner
			record.fragment = true
			fragments = append(fragments, fragmentInspection{len(arguments), &copy})
			arguments = append(arguments, record)
		} else if arg["requirements"] != nil {
			for _, requirement := range templateList(arg["requirements"]) {
				add(templateObj(templateObj(requirement)["value"]), true)
			}
		} else if arg["call"] == nil && arg["rule"] == nil && arg["targets"] == nil {
			add(arg, false)
		}
	}
	inspectArguments := func(event *templateEvent) {
		for _, node := range templateNodes(event.rule) {
			if node["call"] != nil || node["name"] != nil && node["args"] != nil && node["op"] != nil {
				for _, argument := range templateList(node["args"]) {
					inspectArgument(templateObj(argument), event)
				}
			}
		}
	}
	for _, event := range sourceEvents {
		inspectArguments(event)
	}
	for _, instance := range x.queue {
		for _, event := range instance.definitions {
			inspectArguments(event)
		}
	}
	for _, event := range validationDefinitions {
		inspectArguments(event)
	}
	users := []constUser{}
	decoded := map[*templateEvent]*domDoc{}
	decodedRuns := map[*templateEvent]int{}
	for _, e := range validation {
		run := e.inspectionRun
		dom := decodeInspection(e)
		if e.definition != nil {
			decoded[e.definition] = dom
			decodedRuns[e.definition] = run
		}
		users = append(users, constUser{doc: e.path, rule: dom.Rules[0], inspectionRun: run})
	}
	for _, fragment := range fragments {
		arguments[fragment.index].rule = decodeInspection(fragment.event).Rules[0]
	}

	output := []*templateEvent{}
	for _, name := range slots {
		output = append(output, ordinary[name]...)
	}
	for _, i := range x.queue {
		output = append(output, i.definitions...)
	}
	expandedDocs := []docDOM{}
	inspectionRuns := []int{}
	for index, d := range docs {
		dom := templateCopy(rawDocs[index])
		dom["rules"] = []any{}
		for _, kind := range []string{"constants", "directives", "classifiers", "implications", "checks"} {
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
		inspectionRuns = append(inspectionRuns, index)
	}
	for _, e := range output {
		dom := decoded[e]
		if dom == nil {
			panic("an expanded output definition was not validated")
		}
		expandedDocs = append(expandedDocs, docDOM{e.path, dom})
		inspectionRuns = append(inspectionRuns, decodedRuns[e])
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
	instanceSet := map[string]bool{}
	for _, i := range x.queue {
		instanceSet[i.effective()] = true
	}
	instanceNames := []string{}
	for _, name := range order {
		if instanceSet[name] {
			instanceNames = append(instanceNames, name)
		}
	}
	return &templateExpansion{docs: expandedDocs, inspectionRuns: inspectionRuns, order: order, instanceNames: instanceNames, validation: users, arguments: arguments, erasureChecks: x.erasureChecks}, nil
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
	normalized := templateObject{"call": call["call"], "args": x.normalize(call["args"]), "at": call["at"]}
	key := templateKey(normalized)
	i := x.instances[key]
	if i == nil {
		i = &ruleInstance{canonical: templateCanonical(normalized, x.uni), call: normalized, origin: templateObject{"document": e.path, "at": call["at"]}}
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
	templateCalls(root, func(call templateObject) { x.intern(call, e, true) })
}
func templateCalls(root any, visit func(templateObject)) {
	switch n := root.(type) {
	case []any:
		for _, v := range n {
			templateCalls(v, visit)
		}
	case map[string]any:
		if n["alternatives"] != nil {
			for i, a := range templateList(n["alternatives"]) {
				alt := templateObj(a)
				for _, k := range []string{"expr", "tags", "value", "image"} {
					templateCalls(alt[k], visit)
				}
				if i == 0 {
					for _, k := range []string{"tags", "value", "image", "conditions", "error", "warning", "emit"} {
						templateCalls(n[k], visit)
					}
				}
			}
			return
		}
		if n["method"] != nil {
			templateCalls(n["receiver"], visit)
			templateCalls(n["args"], visit)
		} else if n["call"] != nil {
			templateCalls(n["args"], visit)
		} else {
			for _, k := range templateOrderedKeys(n) {
				if k != "at" {
					templateCalls(n[k], visit)
				}
			}
		}
		if n["call"] != nil {
			closed := true
			for _, part := range templateNodes(n["args"]) {
				closed = closed && part["param"] == nil
			}
			if closed {
				visit(n)
			}
		}
		if n["call"] != nil && n["children"] != nil {
			templateCalls(n["children"], visit)
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
				var normalized templateObject
				for _, part := range templateNodes(arg) {
					if part["capture"] != nil || part["captured"] != nil {
						x.fail(e, part, "an argument cannot read or declare captures")
					}
					for k, p := range params {
						if p == part["param"] {
							if normalized == nil {
								normalized = templateObj(x.normalize(arg))
							}
							source := templateFlowPoint{templateText(e.rule["name"]), k}
							edges[source] = append(edges[source], templateFlowEdge{to: templateFlowPoint{t.name, j}, growing: normalized["param"] != part["param"], event: e, node: n, argument: templateObj(arg)})
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
			type trail struct {
				from     templateFlowPoint
				edge     templateFlowEdge
				previous *trail
			}
			type step struct {
				point templateFlowPoint
				trace *trail
			}
			pending := []step{{edge.to, &trail{source, edge, nil}}}
			seen := map[templateFlowPoint]bool{}
			for len(pending) > 0 {
				last := pending[len(pending)-1]
				pending = pending[:len(pending)-1]
				if last.point == source {
					var path []*trail
					for cursor := last.trace; cursor != nil; cursor = cursor.previous {
						path = append(path, cursor)
					}
					parts := make([]string, len(path))
					for i, p := range path {
						a := templateAt(p.edge.node)
						parts[len(path)-i-1] = fmt.Sprintf("%s:%d → %s:%d at %s:%d:%d", p.from.name, p.from.index, p.edge.to.name, p.edge.to.index, p.edge.event.path, a[0], a[1])
					}
					x.fail(edge.event, edge.node, "unbounded-instantiation: "+strings.Join(parts, " then ")+", growing argument "+templateCanonical(edge.argument, x.uni))
				}
				if seen[last.point] {
					continue
				}
				seen[last.point] = true
				for _, next := range edges[last.point] {
					pending = append(pending, step{next.to, &trail{last.point, next, last.trace}})
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
		for _, k := range []string{"call", "splice", "test", "range", "wildcard"} {
			if arg[k] != nil {
				return arg
			}
		}
	case "pattern":
		if arg["emptySet"] == true {
			return templateObject{"never": true}
		}
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
		for _, k := range []string{"body", "targets", "requirements", "rule", "call", "splice", "test", "range", "wildcard"} {
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
			if converted["never"] == true {
				x.fail(e, n, "an empty pattern cannot carry node decorations")
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
		for _, k := range templateSourceKeys(n) {
			v := n[k]
			if k == "at" {
				continue
			}
			if k == "body" && n["body"] != nil {
				r[k] = x.substitute(v, env, e, "expr")
				continue
			}
			if k == "args" && n["call"] != nil {
				r[k] = x.substitute(v, env, e, "arg")
				continue
			}
			if k == "args" && n["method"] != nil {
				items := []any{}
				name := templateText(n["method"])
				query := strings.Contains("|followed-by|preceded-by|", "|"+name+"|")
				target := query || name == "without-elision-except"
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
		if position == "pattern" && r["test"] != nil && templateObj(r["expr"])["never"] == true {
			x.fail(e, templateObj(n["expr"]), "an empty pattern cannot carry node decorations")
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
		erasedCheck := func(names []string, name string) {
			children := templateList(n["children"])
			if position != "pattern" || n["children"] == nil || len(children) == 1 && templateObj(children[0])["siblings"] == true {
				return
			}
			at := templateAt(n)
			if at == [2]int{} {
				at = templateAt(e.rule)
			}
			x.erasureChecks = append(x.erasureChecks, erasurePatternCheck{names, name, e.path, at})
		}
		if name := templateText(n["name"]); name != "" && x.templates[name] == nil {
			erasedCheck([]string{name}, name)
		}
		if n["call"] != nil {
			i := x.instances[templateKey(x.normalize(templateObject{"call": n["call"], "args": n["args"], "at": n["at"]}))]
			name := templateCanonical(n, x.uni)
			if i != nil {
				name = i.effective()
			}
			erasedCheck([]string{name}, name)
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
			names := []string{}
			for _, i := range x.queue {
				if i.call["call"] == n["name"] {
					names = append(names, i.effective())
				}
			}
			erasedCheck(names, templateText(n["name"]))
			var children any
			if n["children"] != nil {
				children = x.rewrite(n["children"], e, "pattern-item")
			}
			members := []any{}
			for _, i := range x.queue {
				if i.call["call"] == n["name"] {
					member := templateCopy(n)
					member["name"] = i.effective()
					if n["children"] != nil {
						member["children"] = children
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
			left, right := templateObject{"name": "text", "at": n["at"]}, templateObject{"name": "text", "at": n["at"]}
			if n["exact"] == true {
				left["exact"], right["exact"] = true, true
			}
			return templateObject{"difference": []any{left, right}}
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
		if position == "pattern" && r["test"] != nil {
			return distributeFamilyTest(r)
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

// Substituted arguments must meet the schema before calls become rule names.
func (x *templateExpander) inspectDefinition(e *templateEvent) {
	dom, err := decodeDOMMode(templateJSON(templateDocument([]any{e.rule})), x.uni, true)
	if err != nil {
		x.fail(e, e.rule, "rule "+templateText(e.rule["name"])+": "+err.Error())
	}
	if e.templateConditions != nil {
		dom.Rules[0].TemplateConditions = e.templateConditions
	}
	if problem := checkDOMMode(dom, x.uni, true); problem != nil {
		x.fail(e, e.rule, problem.message)
	}
}

func distributeFamilyTest(test templateObject) templateObject {
	for _, key := range []string{"union", "intersection", "difference"} {
		if parts := templateList(templateObj(test["expr"])[key]); parts != nil {
			members := make([]any, 0, len(parts))
			for _, part := range parts {
				member := templateCopy(test)
				member["expr"] = part
				members = append(members, distributeFamilyTest(member))
			}
			out := templateObject{key: members}
			if source, ok := test[templateSourceKey]; ok {
				out[templateSourceKey] = source
			}
			return out
		}
	}
	return test
}
