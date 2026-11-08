package gencmu

import "sort"

// A competitor slice reuses the recognition chart and its lexical frames (§12.1).
type predictionName struct {
	rule  int32
	frame *rankedFrame
}

func evidenceWork() {
	if w := work.Load(); w != nil {
		w.readerSteps.add("reader steps")
	}
}

func (rec *recognizer) predictionsAt(at int) map[predictionName][]rankedPrediction {
	evidenceWork()
	if rec.predictionIndexes == nil {
		rec.predictionIndexes = map[int]map[predictionName][]rankedPrediction{}
	}
	if found, ok := rec.predictionIndexes[at]; ok {
		return found
	}
	index := map[predictionName][]rankedPrediction{}
	if at < len(rec.sets) {
		for candidate := range rec.sets[at].predicted {
			evidenceWork()
			key := predictionName{candidate.rule, candidate.frame}
			index[key] = append(index[key], candidate)
		}
	}
	rec.predictionIndexes[at] = index
	return index
}

// Conditions of omitted predictions run only when a slice requests that candidate.
func (rec *recognizer) skippedProductions(at int, candidates []rankedPrediction, accept func(*production) bool) []*production {
	if rec.skippedCache == nil {
		rec.skippedCache = map[int]map[*production]bool{}
	}
	cache := rec.skippedCache[at]
	if cache == nil {
		cache = map[*production]bool{}
		rec.skippedCache[at] = cache
	}
	var result []*production
	for _, candidate := range candidates {
		evidenceWork()
		for _, base := range rec.g.rules[candidate.rule].prods {
			evidenceWork()
			p := rec.closeProduction(rec.rankedProduction(base, candidate.frame), candidate.requested)
			if accept != nil && !accept(p) {
				continue
			}
			skipped, known := cache[p]
			if !known {
				evidenceWork()
				skipped = len(p.rhs) > 0 && p.rhs[0].term && !rec.canRead(at, p.rhs[0].id)
				if skipped {
					ok, query := rec.predictable(p, at)
					for query != nil {
						rec.run.startQuery(query)
						rec.run.drive(query.recognizer(rec.run))
						ok, query = rec.predictable(p, at)
					}
					skipped = ok
				}
				cache[p] = skipped
			}
			if skipped {
				result = append(result, p)
			}
		}
	}
	return result
}

func (run *stageRun) expectedAt(rec *recognizer, items []*item, omitted []*production) []Expected {
	rules := map[string]map[string]bool{}
	expect := func(p *production, pos int) {
		evidenceWork()
		if pos < len(p.rhs) && p.rhs[pos].term {
			terminal := writtenSymbol(rec.g.terminals[p.rhs[pos].id], p.testAt(pos))
			if rules[terminal] == nil {
				rules[terminal] = map[string]bool{}
			}
			rules[terminal][p.ruleName] = true
		}
	}
	for _, item := range items {
		expect(item.prod, int(item.dot))
	}
	for _, production := range omitted {
		expect(production, 0)
	}
	expected := make([]Expected, 0, len(rules))
	for terminal, names := range rules {
		entry := Expected{Terminal: terminal, Rules: make([]string, 0, len(names))}
		for name := range names {
			entry.Rules = append(entry.Rules, name)
		}
		sort.Strings(entry.Rules)
		expected = append(expected, entry)
	}
	sort.Slice(expected, func(i, j int) bool { return expected[i].Terminal < expected[j].Terminal })
	return expected
}

func (run *stageRun) competitorRejections(flow *diagnosticFlow) {
	for index, event := range flow.evaluated {
		node := event.node
		if !event.error || node.d.kind != dClose || node.d.prod.spliceTarget != nil {
			continue
		}
		parent := flow.nodes[node].parent
		if parent == nil || parent.d.kind != dClose || parent.d.prod.ranked == nil || len(parent.kids) != 1 || parent.kids[0] != node {
			continue
		}
		a, b := flow.span(node)
		if evidence := run.competitorSlice(flow.rec, a, b, parent.d.prod); evidence != nil {
			event.diagnostic.Rejection = evidence
			own := flow.own[node]
			own.diagnostic.Rejection = evidence
			flow.own[node] = own
			flow.evaluated[index].diagnostic.Rejection = evidence
		}
	}
}

func (run *stageRun) competitorSlice(rec *recognizer, start, cap int, option *production) *RejectionEvidence {
	group := option.ranked
	entries := map[int]map[predictionName][]*item{}
	type advance struct {
		next  *item
		child *symNode
	}
	advances := map[*item][]advance{}
	type predictedKey struct {
		production *production
		origin     int32
	}
	predictedItems := map[predictedKey][]*item{}
	type initialAdvance struct {
		next  *item
		child *symNode
	}
	var initial []initialAdvance

	type completion struct{ previous, next *item }
	completions := map[*symNode][]completion{}
	symbolsOf := map[*item][]*symNode{}
	predictions := map[struct {
		at   int
		name predictionName
	}]bool{}
	sets := map[int][]*item{}
	omitted := map[int][]*production{}
	omittedSeen := map[int]map[*production]bool{}
	reached, reachedSymbols := map[*item]bool{}, map[*symNode]bool{}
	var queue []*item
	competitor := func(p *production) bool {
		if p.ranked == group {
			return p.option != option.option && p.lexical == option.lexical
		}
		source := p.sourceAlternative
		return !p.helper && p.ruleName == group.parent && source != nil && source != group.source && source.definition == group.source.definition
	}
	add := func(item *item) {
		if item.prod.error != nil || reached[item] {
			return
		}
		reached[item] = true
		queue = append(queue, item)
		transparent := item.dot == 0 && item.prod.ranked != nil && len(item.prod.rhs) == 1 && !item.prod.rhs[0].term
		if !transparent {
			sets[int(item.set)] = append(sets[int(item.set)], item)
		}
	}
	omit := func(at int, p *production) {
		evidenceWork()
		seen := omittedSeen[at]
		if seen == nil {
			seen = map[*production]bool{}
			omittedSeen[at] = seen
		}
		if seen[p] {
			return
		}
		seen[p] = true
		omitted[at] = append(omitted[at], p)
		if _, known := sets[at]; !known {
			sets[at] = nil
		}
	}
	for at, set := range rec.sets {
		if at < start || at > cap {
			continue
		}
		for _, symbol := range set.syms {
			for _, item := range symbol.items {
				evidenceWork()
				symbolsOf[item] = append(symbolsOf[item], symbol)
			}
		}
		for _, current := range set.items {
			evidenceWork()
			if current.prod.error != nil {
				continue
			}
			if current.dot == 0 {
				key := predictedKey{current.prod, current.origin}
				predictedItems[key] = append(predictedItems[key], current)
				index := entries[at]
				if index == nil {
					index = map[predictionName][]*item{}
					entries[at] = index
				}
				name := predictionName{current.prod.lhs, current.prod.lexical}
				index[name] = append(index[name], current)
				if int(current.origin) == start && at == start && competitor(current.prod) {
					add(current)
				}
			}
			for _, link := range current.links {
				evidenceWork()
				if link.prev == nil {
					initial = append(initial, initialAdvance{current, link.sym})
					continue
				}
				advances[link.prev] = append(advances[link.prev], advance{current, link.sym})
				if link.sym != nil {
					completions[link.sym] = append(completions[link.sym], completion{link.prev, current})
				}
			}
		}
	}
	for _, edge := range initial {
		for _, previous := range predictedItems[predictedKey{edge.next.prod, edge.next.origin}] {
			evidenceWork()
			advances[previous] = append(advances[previous], advance{edge.next, edge.child})
			if edge.child != nil {
				completions[edge.child] = append(completions[edge.child], completion{previous, edge.next})
			}
		}
	}
	for _, candidates := range rec.predictionsAt(start) {
		for _, p := range rec.skippedProductions(start, candidates, func(p *production) bool { return p.error == nil && competitor(p) }) {
			omit(start, p)
		}
	}
	for cursor := 0; cursor < len(queue); cursor++ {
		item := queue[cursor]
		p, at := item.prod, int(item.set)
		evidenceWork()
		if int(item.dot) < len(p.rhs) && !p.rhs[item.dot].term {
			rule := p.rhs[item.dot].id
			// rankedEntry resolves through the recognizer's own retained frame table.
			frame := rec.rankedEntry(item, rule)
			name := predictionName{rule, frame}
			key := struct {
				at   int
				name predictionName
			}{at, name}
			if !predictions[key] {
				predictions[key] = true
				evidenceWork()
				for _, entry := range entries[at][name] {
					evidenceWork()
					add(entry)
				}
				evidenceWork()
				for _, skipped := range rec.skippedProductions(at, rec.predictionsAt(at)[name], func(p *production) bool { return p.error == nil && p.lexical == frame }) {
					omit(at, skipped)
				}
			}
		}
		for _, edge := range advances[item] {
			evidenceWork()
			if edge.child == nil || reachedSymbols[edge.child] {
				add(edge.next)
			}
		}
		if int(item.dot) == len(p.rhs) {
			for _, symbol := range symbolsOf[item] {
				evidenceWork()
				if reachedSymbols[symbol] {
					continue
				}
				reachedSymbols[symbol] = true
				for _, edge := range completions[symbol] {
					evidenceWork()
					if reached[edge.previous] {
						add(edge.next)
					}
				}
			}
		}
	}
	if len(sets) == 0 {
		return nil
	}
	position := start
	for at := range sets {
		position = max(position, at)
	}
	expected := run.expectedAt(rec, sets[position], omitted[position])
	rejection := run.rejectedAt(position, expected)
	return &RejectionEvidence{Token: position, Source: *rejection.Source, Line: rejection.Line, Column: rejection.Column, Expected: expected}
}
