package gencmu

import (
	"encoding/json"
	"sort"
)

// Diagnostic ownership and reporting collections (engine §11.5 and §12.1).
type diagnosticLists struct{ errors, warnings []Warning }
type stageDiagnostics struct{ collected, evaluated diagnosticLists }

func diagnosticID(diagnostic Warning) *diagnosticIdentity { return diagnostic.record.identity }

func joinDiagnostics(collections ...diagnosticLists) diagnosticLists {
	var result diagnosticLists
	for kind := 0; kind < 2; kind++ {
		seen := map[*diagnosticIdentity]bool{}
		into := &result.errors
		if kind == 1 {
			into = &result.warnings
		}
		for _, collection := range collections {
			list := collection.errors
			if kind == 1 {
				list = collection.warnings
			}
			for _, diagnostic := range list {
				identity := diagnosticID(diagnostic)
				if !seen[identity] {
					seen[identity] = true
					*into = append(*into, diagnostic)
				}
			}
		}
	}
	return result
}

func inputDiagnostics(tokens []Token) diagnosticLists {
	collections := make([]diagnosticLists, len(tokens))
	for index, token := range tokens {
		collections[index] = diagnosticLists{token.Errors, token.Warnings}
	}
	return joinDiagnostics(collections...)
}

func orderedDiagnostics(list []Warning) []Warning {
	result := append([]Warning(nil), list...)
	sort.SliceStable(result, func(i, j int) bool {
		a, b := diagnosticID(result[i]), diagnosticID(result[j])
		if a.stageOrder != b.stageOrder {
			return a.stageOrder < b.stageOrder
		}
		return a.ordinal < b.ordinal
	})
	return result
}

type diagnosticEvent struct {
	node       *occurrence
	diagnostic Warning
	error, own bool
}

func tiedDiagnostics(first, second []diagnosticEvent) diagnosticLists {
	var result diagnosticLists
	for kind := 0; kind < 2; kind++ {
		carried := map[*diagnosticIdentity]bool{}
		counts, later := map[string]int{}, map[string]int{}
		into := &result.errors
		if kind == 1 {
			into = &result.warnings
		}
		for reading, events := range [][]diagnosticEvent{first, second} {
			for _, event := range events {
				if event.error != (kind == 0) {
					continue
				}
				if !event.own {
					identity := diagnosticID(event.diagnostic)
					if carried[identity] {
						continue
					}
					carried[identity] = true
				} else {
					diagnostic := event.diagnostic
					encoded, _ := json.Marshal([]any{diagnostic.Stage, diagnostic.Code, diagnostic.Rule, diagnostic.Span, diagnostic.Source, diagnostic.Message, diagnostic.Rejection})
					key := string(encoded)
					table := counts
					if reading == 1 {
						table = later
					}
					table[key]++
					if reading == 1 && table[key] <= counts[key] {
						continue
					}
				}
				*into = append(*into, event.diagnostic)
			}
		}
	}
	return result
}

type emissionScope struct {
	root    *occurrence
	rows    []*diagnosticCarrier
	carrier *diagnosticCarrier
	unowned diagnosticLists
}

type diagnosticNodeInfo struct {
	parent *occurrence
	erased bool
	scope  *emissionScope
}

type diagnosticGroup struct {
	scope *emissionScope
	lists diagnosticLists
}
type diagnosticCarrier struct {
	token          Token
	span           [2]int
	part, emission *occurrence
	scope          *emissionScope
	support        *[2]int
	own            diagnosticLists
	groups         []diagnosticGroup
}

type diagnosticFlow struct {
	root                   *occurrence
	run                    *stageRun
	rec                    *recognizer
	nodes                  map[*occurrence]*diagnosticNodeInfo
	own                    map[*occurrence][]diagnosticEvent
	scopeRoots             map[*occurrence]*emissionScope
	order                  []*occurrence
	evaluated              []diagnosticEvent
	main                   *emissionScope
	scopes                 []*emissionScope
	prefix, next, previous []int
}

func newDiagnosticFlow(root *occurrence, run *stageRun, rec *recognizer) *diagnosticFlow {
	main := &emissionScope{root: root}
	flow := &diagnosticFlow{root: root, run: run, rec: rec, nodes: map[*occurrence]*diagnosticNodeInfo{}, own: map[*occurrence][]diagnosticEvent{}, scopeRoots: map[*occurrence]*emissionScope{}, main: main, scopes: []*emissionScope{main}}
	live := make([]int, len(run.toks))
	type visit struct {
		node, parent *occurrence
		erased       bool
	}
	pending := []visit{{node: root}}
	for len(pending) > 0 {
		at := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		node := at.node
		erased := at.erased || node.d.kind == dClose && node.d.prod.nothing
		flow.nodes[node] = &diagnosticNodeInfo{at.parent, erased, main}
		flow.order = append(flow.order, node)
		if node.d.kind == dRead {
			if !erased {
				live[rec.base+int(node.d.tok)] = 1
			}
		} else {
			for i := len(node.kids) - 1; i >= 0; i-- {
				pending = append(pending, visit{node.kids[i], node, erased})
			}
		}
	}
	flow.prefix, flow.next, flow.previous = make([]int, len(live)+1), make([]int, len(live)+1), make([]int, len(live)+1)
	flow.next[len(live)] = len(live)
	for index, bit := range live {
		flow.prefix[index+1] = flow.prefix[index] + bit
		flow.previous[index+1] = flow.previous[index]
		if bit != 0 {
			flow.previous[index+1] = index + 1
		}
	}
	for index := len(live) - 1; index >= 0; index-- {
		flow.next[index] = flow.next[index+1]
		if live[index] != 0 {
			flow.next[index] = index
		}
	}
	return flow
}

func (flow *diagnosticFlow) span(node *occurrence) (int, int) {
	a, b, _ := flow.run.kidSpan(flow.rec, node.d)
	return a, b
}

func (flow *diagnosticFlow) add(node *occurrence, diagnostic Warning, isError bool) {
	event := diagnosticEvent{node, diagnostic, isError, true}
	flow.own[node] = append(flow.own[node], event)
	flow.evaluated = append(flow.evaluated, event)
}

func appendDiagnostic(result *diagnosticLists, event diagnosticEvent) {
	if event.error {
		result.errors = append(result.errors, event.diagnostic)
	} else {
		result.warnings = append(result.warnings, event.diagnostic)
	}
}

func (flow *diagnosticFlow) messages() diagnosticLists {
	var result diagnosticLists
	for _, event := range flow.evaluated {
		if !flow.nodes[event.node].erased {
			appendDiagnostic(&result, event)
		}
	}
	return result
}

func (flow *diagnosticFlow) events() []diagnosticEvent {
	var events []diagnosticEvent
	for _, node := range flow.order {
		if flow.nodes[node].erased {
			continue
		}
		events = append(events, flow.own[node]...)
		if node.d.kind == dRead {
			token := flow.run.toks[flow.rec.base+int(node.d.tok)]
			for _, diagnostic := range token.Errors {
				events = append(events, diagnosticEvent{node, diagnostic, true, false})
			}
			for _, diagnostic := range token.Warnings {
				events = append(events, diagnosticEvent{node, diagnostic, false, false})
			}
		}
	}
	return events
}

func (flow *diagnosticFlow) collected() diagnosticLists {
	var result diagnosticLists
	// Reporting keeps the chosen preorder and each leaf's stored list order (§12.1).
	for _, event := range flow.events() {
		appendDiagnostic(&result, event)
	}
	return joinDiagnostics(result)
}

func (flow *diagnosticFlow) attachment(root *occurrence) *emissionScope {
	scope := &emissionScope{root: root}
	flow.scopeRoots[root] = scope
	flow.scopes = append(flow.scopes, scope)
	return scope
}

func (flow *diagnosticFlow) count(a, b int) int { return flow.prefix[b] - flow.prefix[a] }

func (flow *diagnosticFlow) emitted(token Token, part, emission *occurrence, scope *emissionScope) *diagnosticCarrier {
	row := &diagnosticCarrier{token: token, span: token.Span, part: part, emission: emission, scope: scope}
	if part != nil {
		a, b := flow.span(part)
		if flow.count(a, b) > 0 {
			row.support = &[2]int{flow.next[a], flow.previous[b]}
		}
	}
	scope.rows = append(scope.rows, row)
	return row
}

func (flow *diagnosticFlow) all(scope *emissionScope) diagnosticLists {
	lists := []diagnosticLists{scope.unowned}
	for _, row := range scope.rows {
		lists = append(lists, diagnosticLists{row.token.Errors, row.token.Warnings})
	}
	joined := joinDiagnostics(lists...)
	return diagnosticLists{orderedDiagnostics(joined.errors), orderedDiagnostics(joined.warnings)}
}

func firstCarrier(rows []*diagnosticCarrier, before func(*diagnosticCarrier) bool) *diagnosticCarrier {
	index := sort.Search(len(rows), func(i int) bool { return !before(rows[i]) })
	if index == len(rows) {
		return nil
	}
	return rows[index]
}

func (flow *diagnosticFlow) assign() diagnosticLists {
	for _, node := range flow.order {
		info := flow.nodes[node]
		scope := flow.main
		if info.parent != nil {
			scope = flow.nodes[info.parent].scope
		}
		if root := flow.scopeRoots[node]; root != nil {
			scope = root
		}
		info.scope = scope
	}
	buckets := map[*emissionScope][]diagnosticEvent{}
	emissions, nearest := map[*occurrence][]*diagnosticCarrier{}, map[*occurrence][]*diagnosticCarrier{}
	for _, event := range flow.events() {
		scope := flow.nodes[event.node].scope
		buckets[scope] = append(buckets[scope], event)
	}
	for _, scope := range flow.scopes {
		for _, row := range scope.rows {
			emissions[row.emission] = append(emissions[row.emission], row)
		}
	}
	for _, node := range flow.order {
		info := flow.nodes[node]
		rows := emissions[node]
		if len(rows) == 0 && info.parent != nil && flow.nodes[info.parent].scope == info.scope {
			rows = nearest[info.parent]
		}
		nearest[node] = rows
	}
	for _, scope := range flow.scopes {
		var supported []*diagnosticCarrier
		for _, row := range scope.rows {
			if row.support != nil {
				supported = append(supported, row)
			}
		}
		owner := func(node *occurrence) *diagnosticCarrier {
			a, b := flow.span(node)
			if flow.count(a, b) > 0 {
				row := firstCarrier(supported, func(row *diagnosticCarrier) bool { return row.support[1] <= a })
				if row != nil && row.support[0] < b && flow.count(max(a, row.support[0]), min(b, row.support[1])) > 0 {
					return row
				}
			}
			if rows := nearest[node]; len(rows) > 0 {
				row := firstCarrier(rows, func(row *diagnosticCarrier) bool {
					span := row.span
					if row.support != nil {
						span = *row.support
					}
					return span[1] < a
				})
				if row != nil {
					return row
				}
				return rows[len(rows)-1]
			}
			row := firstCarrier(scope.rows, func(row *diagnosticCarrier) bool { return row.span[0] < a })
			if row != nil {
				return row
			}
			if len(scope.rows) > 0 {
				return scope.rows[len(scope.rows)-1]
			}
			return nil
		}
		for _, event := range buckets[scope] {
			lists := &scope.unowned
			if row := owner(event.node); row != nil {
				lists = &row.own
			}
			appendDiagnostic(lists, event)
		}
	}
	for index := len(flow.scopes) - 1; index >= 0; index-- {
		for _, row := range flow.scopes[index].rows {
			groups := make([]diagnosticLists, len(row.groups))
			for index, group := range row.groups {
				groups[index] = group.lists
				if group.scope != nil {
					groups[index] = flow.all(group.scope)
				}
			}
			for kind := 0; kind < 2; kind++ {
				displayed := map[*diagnosticIdentity]bool{}
				for _, group := range groups {
					list := group.errors
					if kind == 1 {
						list = group.warnings
					}
					for _, diagnostic := range list {
						displayed[diagnosticID(diagnostic)] = true
					}
				}
				own := row.own.errors
				if kind == 1 {
					own = row.own.warnings
				}
				var kept []Warning
				for _, diagnostic := range own {
					if !displayed[diagnosticID(diagnostic)] {
						kept = append(kept, diagnostic)
					}
				}
				joined := diagnosticLists{}
				if kind == 0 {
					joined.errors = orderedDiagnostics(kept)
				} else {
					joined.warnings = orderedDiagnostics(kept)
				}
				joined = joinDiagnostics(append([]diagnosticLists{joined}, groups...)...)
				if kind == 0 {
					row.token.Errors = joined.errors
				} else {
					row.token.Warnings = joined.warnings
				}
			}
		}
	}
	return flow.main.unowned
}
