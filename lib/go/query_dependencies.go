package gencmu

// A clause walk shares source lists across the productions of one rule (§4.3).
// Both suffix and carried-error dependencies use this complete clause walk.
type productionClauseWalk struct {
	visit     func(clausePart) bool
	seen      map[clausePart]bool
	lists     map[condsKey]bool
	sources   map[*sAlt]bool
	emissions map[*domEmit]bool
}

func newProductionClauseWalk(visit func(clausePart) bool) *productionClauseWalk {
	return &productionClauseWalk{visit: visit, seen: map[clausePart]bool{}, lists: map[condsKey]bool{}, sources: map[*sAlt]bool{}, emissions: map[*domEmit]bool{}}
}

func (walk *productionClauseWalk) root(root clausePart) {
	if walk.seen[root] {
		return
	}
	walkClause(root, func(part clausePart) bool {
		if walk.seen[part] {
			return false
		}
		walk.seen[part] = true
		return walk.visit(part)
	})
}

func (walk *productionClauseWalk) conditions(items []*domCond) {
	if len(items) == 0 {
		return
	}
	key := condsKey{&items[0], len(items)}
	if walk.lists[key] {
		return
	}
	walk.lists[key] = true
	for _, item := range items {
		walk.root(clausePart{c: item})
	}
}

func (walk *productionClauseWalk) terms(items ...*domTerm) {
	for _, item := range items {
		walk.root(clausePart{t: item})
	}
}

func (walk *productionClauseWalk) emission(emit *domEmit) {
	if emit == nil || walk.emissions[emit] {
		return
	}
	walk.emissions[emit] = true
	for _, item := range emit.Items {
		walk.terms(item.Tags, item.Value, item.Image)
	}
}

func (walk *productionClauseWalk) source(source *sAlt) {
	if source == nil || walk.sources[source] {
		return
	}
	walk.sources[source] = true
	walk.conditions(source.conds)
	walk.terms(source.ruleTags, source.ruleValue, source.ruleImage, source.alt.Tags, source.alt.Value, source.alt.Image, source.error, source.warning)
	walk.emission(source.emit)
}

func (walk *productionClauseWalk) production(p *production) {
	walk.conditions(p.predictConds)
	for _, condition := range p.conds {
		walk.root(clausePart{c: condition.cond})
	}
	walk.conditions(p.itemConds)
	walk.conditions(p.rankedConditions)
	walk.terms(p.tags, p.parentTags, p.value, p.image, p.error, p.warning)
	walk.emission(p.emit)
	walk.source(p.sourceAlternative)
	if p.slot != nil {
		walk.source(p.slot.source)
	}
}

func queryParts(part clausePart, g *lowered) (*domTerm, []string) {
	if condition := part.c; condition != nil && (condition.Kind == cdMatches || condition.Kind == cdBegins || condition.Kind == cdEnds) {
		var names []string
		for _, target := range condition.queryTargets() {
			names = append(names, queryName(target))
		}
		return condition.Span, names
	}
	if term := part.t; term != nil && term.Kind == tmCall {
		if term.Str == "tags" && len(term.Items) == 2 {
			return term.Items[0], []string{term.Items[1].Str}
		}
		if term.Str == "parse" {
			return term.Items[0], []string{g.stage.queryTargets[term.Items[1].Body]}
		}
	}
	return nil, nil
}

// A single closure serves all targets of one lowered grammar (§4.3).
func (g *lowered) readsCarriedErrors(rule int32) bool {
	g.carriedOnce.Do(func() {
		users := make([][]int32, len(g.rules))
		dependent := make([]bool, len(g.rules))
		var ready []int32
		for number, rule := range g.rules {
			targets := map[int32]bool{}
			filtered := false
			scan := func(part clausePart) bool {
				if term := part.t; term != nil && term.Kind == tmCall && term.Str == "error-free" {
					filtered = true
				}
				_, names := queryParts(part, g)
				for _, name := range names {
					if id, known := g.byName[name]; known {
						targets[id] = true
					}
				}
				return true
			}
			walk := newProductionClauseWalk(scan)
			for _, production := range rule.prods {
				if w := work.Load(); w != nil {
					w.ruleSetSteps.add("rule set steps")
				}
				for _, symbol := range production.rhs {
					if !symbol.term {
						targets[symbol.id] = true
					}
				}
				walk.production(production)
			}
			for target := range targets {
				users[target] = append(users[target], int32(number))
			}
			if filtered {
				dependent[number] = true
				ready = append(ready, int32(number))
			}
		}
		for index := 0; index < len(ready); index++ {
			for _, user := range users[ready[index]] {
				if w := work.Load(); w != nil {
					w.ruleSetSteps.add("rule set steps")
				}
				if !dependent[user] {
					dependent[user] = true
					ready = append(ready, user)
				}
			}
		}
		g.carriedDependencies = dependent
	})
	return g.carriedDependencies[rule]
}

func (run *stageRun) spanErrors(span spanVal) string {
	// Shared content keys cover only bounded spans, so this walk is bounded.
	bits := make([]byte, span.b-span.a)
	for index := range bits {
		if w := work.Load(); w != nil {
			w.keySteps.add("key steps")
		}
		if len(run.toks[span.a+index].Errors) > 0 {
			bits[index] = 1
		}
	}
	return string(bits)
}
