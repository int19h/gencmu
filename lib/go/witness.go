package gencmu

// walkWitness finds the restored chosen derivation W(D) before ranking.
// It matches each production, span and child in the reconstruction chart.
// Original reads match their token provenance.
// Each omitted terminator matches its helper's synthetic token.
// The result holds matched links and W(D) in the ranking's form.
// A missing witness gives nil.
// The walk preserves the chosen tree's shape.
// Tests compare its tags separately.
func walkWitness(run *elisionCheckRun) (map[*item]map[link]bool, *dn) {
	rc := run.recon
	// Visit each occurrence in W(D) after its children.
	// Shared nodes can represent several occurrences in the chosen tree.
	// A cursor visits leaves from left to right.
	// Reads consume original tokens.
	// Omitted terminators consume their records' synthetic tokens.
	type wnode struct {
		d          *dn
		kids       []*wnode
		start, end int
	}
	elided := func(d *dn) bool { return d.kind != dRead && d.prod.restoration() && d.a == nil }
	var order []*wnode
	cursor, records := 0, 0
	type frame struct {
		w    *wnode
		kids []*dn
		next int
	}
	root := &wnode{d: run.chosen}
	stack := []*frame{{w: root, kids: flattenKids(run.chosen.a)}}
	for len(stack) > 0 {
		f := stack[len(stack)-1]
		w := f.w
		switch {
		case w.d.kind == dRead:
			at := run.originalAt[w.d.tok]
			if at != cursor || rc.synthetic[at] {
				return nil, nil
			}
			cursor++
			w.end = cursor
			order = append(order, w)
			stack = stack[:len(stack)-1]
			continue
		case elided(w.d):
			if records >= len(run.recordAt) {
				return nil, nil
			}
			at := run.recordAt[records]
			records++
			if at != cursor || !rc.synthetic[at] {
				return nil, nil
			}
			cursor++
			w.end = cursor
			order = append(order, w)
			stack = stack[:len(stack)-1]
			continue
		}
		if f.next < len(f.kids) {
			k := f.kids[f.next]
			f.next++
			kw := &wnode{d: k, start: cursor}
			w.kids = append(w.kids, kw)
			stack = append(stack, &frame{w: kw, kids: flattenKids(k.a)})
			continue
		}
		w.end = cursor
		order = append(order, w)
		stack = stack[:len(stack)-1]
	}
	if records != len(run.recordAt) || cursor != len(rc.synthetic) {
		return nil, nil
	}

	// The items that W(D) can use, by set, production, dot and origin: only
	// the keys that its nodes ask for are indexed.
	type where struct {
		set         int
		prod        *production
		dot, origin int32
	}
	index := map[where][]*item{}
	need := map[int]bool{}
	for _, w := range order {
		if w.d.kind == dRead {
			continue
		}
		if elided(w.d) {
			index[where{w.end, w.d.prod, 0, int32(w.start)}] = nil
			need[w.end] = true
			continue
		}
		index[where{w.start, w.d.prod, 0, int32(w.start)}] = nil
		need[w.start] = true
		for i, k := range w.kids {
			index[where{k.end, w.d.prod, int32(i + 1), int32(w.start)}] = nil
			need[k.end] = true
		}
	}
	for k := range need {
		if k >= len(run.rec.sets) {
			continue
		}
		for _, it := range run.rec.sets[k].items {
			key := where{k, it.prod, it.dot, it.origin}
			if list, ok := index[key]; ok {
				index[key] = append(list, it)
			}
		}
	}
	itemsAt := func(k int, p *production, dot, origin int) []*item {
		return index[where{k, p, int32(dot), int32(origin)}]
	}

	// Record exact items for each close and matched links for each item.
	found := map[*wnode]map[*item]bool{}
	steps := map[*wnode]map[*item]link{}
	marks := map[*item]map[link]bool{}
	keep := func(it *item, l link) {
		if marks[it] == nil {
			marks[it] = map[link]bool{}
		}
		marks[it][l] = true
	}
	for _, w := range order {
		n := w.d
		steps[w] = map[*item]link{}
		if n.kind == dRead {
			continue
		}
		if elided(n) {
			set := map[*item]bool{}
			for _, it := range itemsAt(w.end, n.prod, 0, w.start) {
				if it.restores {
					set[it] = true
					for _, l := range it.links {
						keep(it, l)
					}
				}
			}
			found[w] = set
			continue
		}
		// A link from a predicted item has no predecessor (earley.go).
		current := map[*item]bool{}
		predicted := false
		for _, it := range itemsAt(w.start, n.prod, 0, w.start) {
			if !it.restores {
				current[it], predicted = true, true
				// A predicted item has no links, and W(D) holds it all
				// the same.
				if marks[it] == nil {
					marks[it] = map[link]bool{}
				}
			}
		}
		for i, k := range w.kids {
			next := map[*item]bool{}
			for _, it := range itemsAt(k.end, n.prod, i+1, w.start) {
				for _, l := range it.links {
					if l.prev == nil {
						if i != 0 || !predicted {
							continue
						}
					} else if !current[l.prev] {
						continue
					}
					var ok bool
					if k.d.kind == dRead {
						ok = l.sym == nil && int(l.tok) == k.start && l.term == k.d.term
					} else if l.sym != nil {
						for _, c := range l.sym.items {
							if found[k][c] {
								ok = true
								break
							}
						}
					}
					if ok {
						if !next[it] {
							steps[w][it] = l
						}
						next[it] = true
						keep(it, l)
					}
				}
			}
			current = next
		}
		found[w] = current
	}
	// Bind one coherent reconstruction to its actual constituent states.
	type bound struct {
		w   *wnode
		sym *symNode
		it  *item
	}
	var pending []bound
	for _, s := range run.top {
		for _, it := range s.items {
			if found[root][it] {
				pending = []bound{{root, s, it}}
				break
			}
		}
		if len(pending) > 0 {
			break
		}
	}
	if len(pending) == 0 {
		return nil, nil
	}
	states := map[*wnode]*symNode{}
	for len(pending) > 0 {
		b := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		states[b.w] = b.sym
		it := b.it
		for i := len(b.w.kids) - 1; i >= 0; i-- {
			k := b.w.kids[i]
			l := steps[b.w][it]
			if k.d.kind != dRead {
				for _, child := range l.sym.items {
					if found[k][child] {
						pending = append(pending, bound{k, l.sym, child})
						break
					}
				}
			}
			it = l.prev
		}
	}
	// Build W(D) in the ranking's form over reconstruction tokens and spans.
	// Each restoration reads its synthetic token and closes over it.
	built := map[*wnode]*dn{}
	for _, w := range order {
		switch {
		case w.d.kind == dRead:
			built[w] = readNode(int32(w.end-1), w.d.term)
		case elided(w.d):
			read := readNode(int32(w.end-1), run.rec.g.termID[w.d.prod.elided])
			built[w] = closeNode(w.d.prod, int32(w.end-1), int32(w.end), states[w].tags, partNode(nil, read), states[w].structure)
		default:
			var kids *dn
			for _, k := range w.kids {
				kids = partNode(kids, built[k])
			}
			built[w] = closeNode(w.d.prod, int32(w.start), int32(w.end), states[w].tags, kids, states[w].structure)
		}
	}
	return marks, built[root]
}
