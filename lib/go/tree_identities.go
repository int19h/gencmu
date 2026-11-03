package gencmu

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
)

type observationKinds uint8

const (
	closeObservation observationKinds = 1 << iota
	treeObservation
)

func closeKinds(requested bool) observationKinds {
	if requested {
		return closeObservation
	}
	return 0
}

func (p *production) requestedKinds() observationKinds {
	kinds := closeKinds(p.closeRequested)
	if p.treeRequested {
		kinds |= treeObservation
	}
	return kinds
}

func constituentComparisons(root clausePart) []*domCond {
	var out []*domCond
	walkClause(root, func(part clausePart) bool {
		if c := part.c; c != nil && (c.Op == "≅" || c.Op == "≇") && c.Right.Kind == tmCapture {
			out = append(out, c)
			return false
		}
		return true
	})
	return out
}

type treeDemand struct {
	whole     bool
	positions map[int]bool
	names     map[string]bool
}

func (g *lowered) localTreeDemand(p *production) *treeDemand {
	p = baseProduction(p)
	if previous := g.treeDemands[p]; previous != nil {
		return previous
	}
	d := &treeDemand{positions: map[int]bool{}, names: map[string]bool{}}
	collect := func(root clausePart) {
		for _, c := range constituentComparisons(root) {
			for _, t := range []*domTerm{c.Left, c.Right} {
				d.names[t.Str] = true
				if t.Str == "" {
					d.whole = true
				} else if at, found := p.posOf[t.Str]; found {
					d.positions[at] = true
				}
			}
		}
	}
	collect(clausePart{t: p.tags})
	collect(clausePart{t: p.parentTags})
	for _, c := range p.conds {
		collect(clausePart{c: c.cond})
	}
	for _, c := range p.predictConds {
		collect(clausePart{c: c})
	}
	for _, c := range p.rankedConditions {
		collect(clausePart{c: c})
	}
	g.treeDemands[p] = d
	return d
}

func (g *lowered) prepareTreeDemands() {
	g.treeDemands = map[*production]*treeDemand{}
	outer := map[int32]map[string]bool{}
	whole := map[int32]bool{}
	for _, p := range g.prods {
		d := g.localTreeDemand(p)
		if !p.helper {
			continue
		}
		if outer[p.lhs] == nil {
			outer[p.lhs] = map[string]bool{}
		}
		for name := range d.names {
			if _, local := p.slotOf[name]; name != "" && !local {
				outer[p.lhs][name] = true
			}
		}
		whole[p.lhs] = whole[p.lhs] || d.whole
	}
	for changed := true; changed; {
		changed = false
		for _, p := range g.prods {
			if !p.helper {
				continue
			}
			for _, symbol := range p.rhs {
				if symbol.term {
					continue
				}
				if whole[symbol.id] && !whole[p.lhs] {
					whole[p.lhs], changed = true, true
				}
				for name := range outer[symbol.id] {
					if _, local := p.slotOf[name]; !local && !outer[p.lhs][name] {
						outer[p.lhs][name], changed = true, true
					}
				}
			}
		}
	}
	for _, p := range g.prods {
		d := g.localTreeDemand(p)
		for index, symbol := range p.rhs {
			if symbol.term {
				continue
			}
			d.whole = d.whole || whole[symbol.id]
			for name := range outer[symbol.id] {
				if at, found := p.posOf[name]; found && at < index {
					d.positions[at] = true
				}
			}
		}
	}
}

type treeNodeKey struct {
	kind, name, value string
	children          int
}

type treeState struct{ prefix, identity, sequence int }

type treeArena struct {
	nodes           []treeNodeKey
	nodeIDs         map[treeNodeKey]int
	sequences       [][2]int
	sequenceIDs     map[[2]int]int
	concatenations  map[[2]int]int
	states          map[treeState]*treeState
	seals           map[[2]int32]int
	semanticNodes   map[int]string
	semanticLists   map[int]string
	emptyProjection int
}

func newTreeArena() *treeArena {
	m := &treeArena{nodes: []treeNodeKey{{}}, nodeIDs: map[treeNodeKey]int{}, sequences: [][2]int{{}}, sequenceIDs: map[[2]int]int{}, concatenations: map[[2]int]int{}, states: map[treeState]*treeState{}, seals: map[[2]int32]int{}}
	m.emptyProjection = m.intern(treeNodeKey{kind: "EmptyProjection"})
	return m
}

func (m *treeArena) intern(key treeNodeKey) int {
	if id, found := m.nodeIDs[key]; found {
		return id
	}
	id := len(m.nodes)
	m.nodes = append(m.nodes, key)
	m.nodeIDs[key] = id
	return id
}

func (m *treeArena) append(prefix, identity int) int {
	if identity == 0 {
		return prefix
	}
	n := m.nodes[identity]
	if n.kind == "EmptyProjection" || n.kind == "Rule" && n.children == 0 {
		return prefix
	}
	key := [2]int{prefix, identity}
	if id, found := m.sequenceIDs[key]; found {
		return id
	}
	id := len(m.sequences)
	m.sequences = append(m.sequences, key)
	m.sequenceIDs[key] = id
	return id
}

func (m *treeArena) concat(left, right int) int {
	if left == 0 {
		return right
	}
	if right == 0 {
		return left
	}
	key := [2]int{left, right}
	if id, found := m.concatenations[key]; found {
		return id
	}
	var pending []int
	for at := right; at != 0; at = m.sequences[at][0] {
		pending = append(pending, m.sequences[at][1])
	}
	for i := len(pending) - 1; i >= 0; i-- {
		left = m.append(left, pending[i])
	}
	m.concatenations[key] = left
	return left
}

func (r *recognizer) terminalIdentity(terminal string, at int32) int {
	if r.recon != nil && r.recon.synthetic[at] {
		return r.trees.emptyProjection
	}
	index := r.base + int(at)
	if r.recon != nil {
		index = r.recon.original[at]
	}
	return r.trees.intern(treeNodeKey{kind: "Written", name: terminal, value: r.run.toks[index].Value})
}

func (r *recognizer) sealIdentity(start, end int32) int {
	key := [2]int32{start, end}
	if id, found := r.trees.seals[key]; found {
		return id
	}
	a, b := r.observed(start, end)
	id := r.trees.intern(treeNodeKey{kind: "Seal", value: treeSealValues(r.run, a, b)})
	r.trees.seals[key] = id
	return id
}

func treeSealValues(run *stageRun, start, end int) string {
	var values strings.Builder
	for i := start; i < end; i++ {
		values.WriteString(strconv.Quote(run.toks[i].Value))
		values.WriteByte(',')
	}
	return values.String()
}

func (m *treeArena) elements(sequence int) []int {
	var out []int
	for at := sequence; at != 0; at = m.sequences[at][0] {
		out = append(out, m.sequences[at][1])
	}
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out
}

func (m *treeArena) semantic(identity int) string {
	if identity == 0 {
		return "null"
	}
	if m.semanticNodes == nil {
		m.semanticNodes, m.semanticLists = map[int]string{}, map[int]string{}
	}
	type frame struct {
		identity int
		expanded bool
	}
	pending := []frame{{identity: identity}}
	for len(pending) > 0 {
		f := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		if _, found := m.semanticNodes[f.identity]; found {
			continue
		}
		n := m.nodes[f.identity]
		if n.kind != "Rule" {
			m.semanticNodes[f.identity] = "[" + strconv.Quote(n.kind) + "," + strconv.Quote(n.name) + "," + strconv.Quote(n.value) + "]"
			continue
		}
		children := m.elements(n.children)
		if !f.expanded {
			pending = append(pending, frame{f.identity, true})
			for i := len(children) - 1; i >= 0; i-- {
				if _, found := m.semanticNodes[children[i]]; !found {
					pending = append(pending, frame{identity: children[i]})
				}
			}
			continue
		}
		var text strings.Builder
		text.WriteString("[\"Rule\"," + strconv.Quote(n.name) + ",[")
		for i, child := range children {
			if i != 0 {
				text.WriteByte(',')
			}
			text.WriteString(m.semanticNodes[child])
		}
		text.WriteString("]]")
		m.semanticNodes[f.identity] = text.String()
	}
	return m.semanticNodes[identity]
}

func (m *treeArena) sequenceSemantic(sequence int) string {
	if text, found := m.semanticLists[sequence]; found {
		return text
	}
	parts := []string{}
	for _, identity := range m.elements(sequence) {
		parts = append(parts, m.semantic(identity))
	}
	if m.semanticLists == nil {
		m.semanticLists = map[int]string{}
	}
	text := "[" + strings.Join(parts, ",") + "]"
	m.semanticLists[sequence] = text
	return text
}

func (em *stringEmitter) treeIdentity(root *occurrence) int {
	if em.trees == nil {
		em.trees, em.treeStates = newTreeArena(), map[*occurrence]treeState{}
	}
	type frame struct {
		node     *occurrence
		expanded bool
	}
	pending := []frame{{node: root}}
	for len(pending) > 0 {
		f := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		if _, found := em.treeStates[f.node]; found {
			continue
		}
		n := f.node.d
		if n.kind == dRead {
			id := em.trees.intern(treeNodeKey{kind: "Written", name: em.rec.g.terminals[n.term], value: em.run.toks[em.rec.base+int(n.tok)].Value})
			em.treeStates[f.node] = treeState{identity: id, sequence: em.trees.append(0, id)}
			continue
		}
		if !f.expanded {
			pending = append(pending, frame{f.node, true})
			for i := len(f.node.kids) - 1; i >= 0; i-- {
				child := f.node.kids[i]
				if symbol := n.prod.rhs[i]; symbol.term || em.rec.g.rankedHelpers[symbol.id] == nil {
					pending = append(pending, frame{node: child})
				}
			}
			continue
		}
		sequence := 0
		for i, child := range f.node.kids {
			if symbol := n.prod.rhs[i]; !symbol.term && em.rec.g.rankedHelpers[symbol.id] != nil {
				a, b, _ := em.span(child)
				seal := em.trees.intern(treeNodeKey{kind: "Seal", value: treeSealValues(em.run, a, b)})
				sequence = em.trees.append(sequence, seal)
			} else {
				sequence = em.trees.concat(sequence, em.treeStates[child].sequence)
			}
		}
		state := treeState{prefix: sequence, sequence: sequence}
		if !n.prod.helper {
			state.identity = em.trees.intern(treeNodeKey{kind: "Rule", name: em.rec.g.rules[n.prod.lhs].name, children: sequence})
			state.sequence = em.trees.append(0, state.identity)
		} else if n.prod.restoration() {
			state.identity = em.trees.intern(treeNodeKey{kind: "Omitted", name: n.prod.elided})
			state.sequence = em.trees.append(0, state.identity)
		}
		em.treeStates[f.node] = state
	}
	return em.treeStates[root].identity
}

func (r *recognizer) finishTree(key *itemKey) {
	p := key.prod
	if !p.observesTrees {
		return
	}
	state := treeState{}
	if key.tree != nil {
		state.prefix = key.tree.prefix
	}
	state.sequence = state.prefix
	if int(key.dot) == len(p.rhs) {
		if !p.helper {
			state.identity = r.trees.intern(treeNodeKey{kind: "Rule", name: r.g.rules[p.lhs].name, children: state.prefix})
			state.sequence = r.trees.append(0, state.identity)
		} else if p.restoration() {
			state.identity = r.trees.intern(treeNodeKey{kind: "Omitted", name: p.elided})
			state.sequence = r.trees.append(0, state.identity)
		}
	}
	r.setTreeState(key, state)
}

func (r *recognizer) setTreeState(key *itemKey, state treeState) {
	if previous := r.trees.states[state]; previous != nil {
		key.tree = previous
		return
	}
	r.trees.states[state] = &state
	key.tree = &state
}

func (r *recognizer) advanceTree(key *itemKey, it *item, cv *capVal, l link) {
	p, pos := key.prod, int(key.dot)
	cv.tree = 0
	d := r.g.localTreeDemand(p)
	if d.positions[pos] {
		if l.sym != nil {
			cv.tree = l.sym.treeIdentity
		} else {
			cv.tree = r.terminalIdentity(r.g.terminals[l.term], l.tok)
		}
	}
	if !p.observesTrees {
		return
	}
	prefix := 0
	if it.tree != nil {
		prefix = it.tree.prefix
	}
	if l.sym != nil {
		if r.g.rankedHelpers[l.sym.rule] != nil {
			prefix = r.trees.append(prefix, r.sealIdentity(l.sym.start, l.sym.end))
		} else {
			prefix = r.trees.concat(prefix, l.sym.treeSequence)
		}
	} else {
		prefix = r.trees.append(prefix, r.terminalIdentity(r.g.terminals[l.term], l.tok))
	}
	r.setTreeState(key, treeState{prefix: prefix})
}

type treeSite struct {
	comparison *domCond
	production *production
	bindings   map[string]symbol
	prefix     []int32
}

func (g *lowered) checkTreeCycles(rows []structuralProduction) {
	nullable := nullableRules(len(g.rules), len(rows), func(i int) (int32, []symbol) { return rows[i].lhs, rows[i].rhs })
	type edge struct {
		rule   int32
		marked bool
	}
	edges := make([][]edge, len(g.rules))
	for _, row := range rows {
		for index, symbol := range row.rhs {
			if symbol.term || g.rankedHelpers[symbol.id] != nil {
				continue
			}
			marked := true
			for i, other := range row.rhs {
				if i != index && (other.term || !nullable[other.id]) {
					marked = false
					break
				}
			}
			edges[row.lhs] = append(edges[row.lhs], edge{symbol.id, marked})
		}
	}
	sites := append([]treeSite(nil), g.treeSites...)
	for _, p := range g.prods {
		bindings := map[string]symbol{}
		for name, at := range p.posOf {
			bindings[name] = p.rhs[at]
		}
		collect := func(root clausePart) {
			for _, c := range constituentComparisons(root) {
				sites = append(sites, treeSite{c, p, bindings, nil})
			}
		}
		collect(clausePart{t: p.tags})
		collect(clausePart{t: p.parentTags})
		for _, c := range p.conds {
			collect(clausePart{c: c.cond})
		}
		for _, c := range p.predictConds {
			collect(clausePart{c: c})
		}
	}
	ordinal := map[string]int{}
	keyOf := func(doc string, c *domCond) string {
		return fmt.Sprintf("%q/%v/%s/%q/%q", doc, c.At, c.Op, c.Left.Str, c.Right.Str)
	}
	for _, rule := range g.stage.rules {
		groups := map[*sAlt][]*sAlt{}
		var order []*sAlt
		for _, alternative := range rule.alts {
			owner := alternative.boundaryOwner
			if owner == nil {
				owner = alternative
			}
			if _, found := groups[owner]; !found {
				order = append(order, owner)
			}
			groups[owner] = append(groups[owner], alternative)
		}
		for _, owner := range order {
			alternatives := groups[owner]
			collect := func(root clausePart) {
				for _, c := range constituentComparisons(root) {
					key := keyOf(owner.doc, c)
					if _, found := ordinal[key]; !found {
						ordinal[key] = len(ordinal)
					}
				}
			}
			collect(clausePart{t: alternatives[0].ruleTags})
			for _, alternative := range alternatives {
				collect(clausePart{t: alternative.alt.Tags})
			}
			for _, c := range alternatives[0].conds {
				collect(clausePart{c: c})
			}
		}
	}
	sort.SliceStable(sites, func(i, j int) bool {
		a, b := sites[i], sites[j]
		x, y := ordinal[keyOf(a.production.doc, a.comparison)], ordinal[keyOf(b.production.doc, b.comparison)]
		if x != y {
			return x < y
		}
		return a.production.num < b.production.num
	})
	for _, site := range sites {
		var roots []int32
		for _, operand := range []*domTerm{site.comparison.Left, site.comparison.Right} {
			if operand.Str == "" {
				roots = append(roots, site.prefix...)
				if !site.production.helper {
					for _, symbol := range site.production.rhs {
						if !symbol.term && g.rankedHelpers[symbol.id] == nil {
							roots = append(roots, symbol.id)
						}
					}
				}
			} else if binding, found := site.bindings[operand.Str]; found && !binding.term {
				roots = append(roots, binding.id)
			}
		}
		reachable := []int32{}
		known := map[int32]bool{}
		pending := append([]int32(nil), roots...)
		for i, j := 0, len(pending)-1; i < j; i, j = i+1, j-1 {
			pending[i], pending[j] = pending[j], pending[i]
		}
		for len(pending) > 0 {
			rule := pending[len(pending)-1]
			pending = pending[:len(pending)-1]
			if known[rule] {
				continue
			}
			known[rule] = true
			reachable = append(reachable, rule)
			for i := len(edges[rule]) - 1; i >= 0; i-- {
				pending = append(pending, edges[rule][i].rule)
			}
		}
		done, active := map[int32]bool{}, map[int32]int{}
		var path []int32
		type frame struct {
			rule int32
			next int
		}
		for _, root := range reachable {
			if done[root] {
				continue
			}
			stack := []frame{{rule: root}}
			for len(stack) > 0 {
				top := &stack[len(stack)-1]
				if _, found := active[top.rule]; !found {
					active[top.rule] = len(path)
					path = append(path, top.rule)
				}
				if top.next == len(edges[top.rule]) {
					path = path[:len(path)-1]
					delete(active, top.rule)
					done[top.rule] = true
					stack = stack[:len(stack)-1]
					continue
				}
				e := edges[top.rule][top.next]
				top.next++
				if !e.marked || done[e.rule] {
					continue
				}
				if at, found := active[e.rule]; found {
					var cycle []string
					for _, rule := range append(append([]int32(nil), path[at:]...), e.rule) {
						if !g.rules[rule].helper {
							cycle = append(cycle, g.rules[rule].name)
						}
					}
					at := site.comparison.At
					if at == [2]int{} {
						at = site.production.at
					}
					err := grammarError(site.production.doc, at, "tree comparison demands a cycle %s that can repeat a demanded rule over one span", strings.Join(cycle, " → "))
					err.Stage = g.stage.name
					g.fault, g.faultLocation = err.Message, err
					return
				}
				stack = append(stack, frame{rule: e.rule})
			}
		}
	}
}
