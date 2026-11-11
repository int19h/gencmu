package gencmu

// Local node tests share their tag and value semantics with tree conditions.
func localNodeMatches(p *domPattern, name, terminal, value string, tags *tagset) bool {
	switch p.Kind {
	case tmUnion:
		for _, child := range p.Items {
			if localNodeMatches(child, name, terminal, value, tags) {
				return true
			}
		}
		return false
	case tmIntersection:
		for _, child := range p.Items {
			if !localNodeMatches(child, name, terminal, value, tags) {
				return false
			}
		}
		return true
	case tmDifference:
		return localNodeMatches(p.Items[0], name, terminal, value, tags) && !localNodeMatches(p.Items[1], name, terminal, value, tags)
	case "test":
		if len(p.Items) > 0 && !localNodeMatches(p.Items[0], name, terminal, value, tags) {
			return false
		}
		if p.Op != "tags" {
			return (name != "" || terminal != "") && (value == p.Value.Str) == (p.Op == "=")
		}
		for _, requirement := range p.Requirements {
			pending := []*domTerm{requirement.Value}
			for len(pending) > 0 {
				term := pending[len(pending)-1]
				pending = pending[:len(pending)-1]
				if term.Kind == tmTag && (tags != nil && tags.has(term.Str)) == requirement.Negated {
					return false
				}
				pending = append(pending, term.Items...)
			}
		}
		return name != "" || terminal != ""
	case "name":
		return name == p.Name
	case "terminal":
		return terminal != "" && (p.Name == "_" || terminal == p.Name)
	case "any":
		return name != "" || terminal != ""
	}
	return false
}

func patternReadsNodeTags(p *domPattern) bool {
	if p == nil {
		return false
	}
	if p.Kind == "test" && p.Op == "tags" && len(p.Items) > 0 && (p.Items[0].Kind == "name" || p.Items[0].Kind == "call") {
		return true
	}
	for _, part := range p.Items {
		if patternReadsNodeTags(part) {
			return true
		}
	}
	for _, part := range p.Attached {
		if patternReadsNodeTags(part) {
			return true
		}
	}
	return false
}

func patternHasValue(p *domPattern) bool {
	if p.Kind == "test" && p.Op != "tags" {
		return true
	}
	for _, part := range p.Items {
		if patternHasValue(part) {
			return true
		}
	}
	return false
}

func rankingPatternProblem(p *domPattern) string {
	if p.Kind == "never" {
		return ""
	}
	if p.Kind == tmUnion || p.Kind == tmIntersection || p.Kind == tmDifference {
		for _, part := range p.Items {
			if problem := rankingPatternProblem(part); problem != "" {
				return problem
			}
		}
		return ""
	}
	if !p.Exact || p.Attached != nil || p.Kind == "path" || p.Kind == "any" {
		return "a ranking step requires an exact local node pattern"
	}
	return ""
}

func requiresElided(p *domPattern) bool {
	if p.Kind == tmUnion {
		for _, part := range p.Items {
			if !requiresElided(part) {
				return false
			}
		}
		return true
	}
	if p.Kind == tmIntersection {
		for _, part := range p.Items {
			if requiresElided(part) {
				return true
			}
		}
		return false
	}
	if p.Kind == tmDifference {
		return requiresElided(p.Items[0])
	}
	if p.Kind == "test" && p.Op == "tags" {
		for _, requirement := range p.Requirements {
			pending := []*domTerm{requirement.Value}
			for len(pending) > 0 {
				term := pending[len(pending)-1]
				pending = pending[:len(pending)-1]
				if !requirement.Negated && term.Kind == tmTag && term.Str == "_Elided" {
					return true
				}
				pending = append(pending, term.Items...)
			}
		}
	}
	for _, part := range p.Items {
		if requiresElided(part) {
			return true
		}
	}
	return false
}

// possibleNodeMatch uses -1 for an answer that depends on runtime tags or values.
func possibleNodeMatch(p *domPattern, name, terminal string, omitted bool, tags *tagset) int {
	and := func(a, b int) int {
		if a == 0 || b == 0 {
			return 0
		}
		if a < 0 || b < 0 {
			return -1
		}
		return 1
	}
	switch p.Kind {
	case tmUnion:
		result := 0
		for _, part := range p.Items {
			answer := possibleNodeMatch(part, name, terminal, omitted, tags)
			if answer == 1 {
				return 1
			}
			if answer < 0 {
				result = -1
			}
		}
		return result
	case tmIntersection:
		result := 1
		for _, part := range p.Items {
			result = and(result, possibleNodeMatch(part, name, terminal, omitted, tags))
		}
		return result
	case tmDifference:
		right := possibleNodeMatch(p.Items[1], name, terminal, omitted, tags)
		if right >= 0 {
			right = 1 - right
		}
		return and(possibleNodeMatch(p.Items[0], name, terminal, omitted, tags), right)
	case "test":
		base := 1
		if len(p.Items) > 0 {
			base = possibleNodeMatch(p.Items[0], name, terminal, omitted, tags)
		}
		if base == 0 {
			return 0
		}
		if p.Op != "tags" {
			return -1
		}
		if tags != nil {
			if localNodeMatches(p, name, terminal, "", tags) {
				return 1
			}
			return 0
		}
		if requiresElided(p) && !omitted {
			return 0
		}
		if omitted {
			tags := &tagset{names: []string{terminal, "_Elided"}}
			// Local matching uses binary search.
			if terminal > "_Elided" {
				tags.names[0], tags.names[1] = tags.names[1], tags.names[0]
			}
			if !localNodeMatches(p, name, terminal, "", tags) {
				return 0
			}
			return 1
		}
		return and(base, -1)
	case "name":
		if name == p.Name {
			return 1
		}
	case "terminal":
		if terminal != "" && (p.Name == "_" || terminal == p.Name) {
			return 1
		}
	}
	return 0
}

func (g *lowered) canCountProfiles(steps []keyStep) bool {
	g.profileOnce.Do(func() {
		erased := false
		for _, production := range g.prods {
			erased = erased || production.nothing
		}
		if g.hasErrors || erased {
			g.profilePossible = true
			return
		}
		if len(steps) == 0 {
			return
		}
		pending := []int32{g.byName["text"]}
		seen := map[int32]bool{}
		matches := func(name, terminal string, omitted bool, tags *tagset) bool {
			for _, step := range steps {
				if possibleNodeMatch(step.pattern, name, terminal, omitted, tags) != 0 {
					return true
				}
			}
			return false
		}
		for len(pending) > 0 {
			identity := pending[len(pending)-1]
			pending = pending[:len(pending)-1]
			if seen[identity] {
				continue
			}
			seen[identity] = true
			rule := g.rules[identity]
			for _, production := range rule.prods {
				if !rule.helper {
					tags := knownRankingTags(production.tags)
					if production.tags == nil && !production.implicit {
						tags = &tagset{}
					}
					g.profilePossible = g.profilePossible || matches(rule.name, "", false, tags)
				}
				if production.restoration() {
					g.profilePossible = g.profilePossible || matches("", production.elided, true, nil)
				}
				for _, symbol := range production.rhs {
					if symbol.term {
						g.profilePossible = g.profilePossible || matches("", g.terminals[symbol.id], false, nil)
					} else {
						pending = append(pending, symbol.id)
					}
				}
			}
		}
	})
	return g.profilePossible
}

func knownRankingTags(term *domTerm) *tagset {
	if term == nil {
		return nil
	}
	names := map[string]bool{}
	switch term.Kind {
	case tmTag:
		names[term.Str] = true
	case tmEmptySet:
	case tmConst:
		if term.value == nil || term.value.ty != tyTags && term.value.ty != tySet {
			return nil
		}
		for _, tag := range term.value.names {
			names[tag] = true
		}
	case tmUnion, tmIntersection, tmDifference:
		for index, part := range term.Items {
			tags := knownRankingTags(part)
			if tags == nil {
				return nil
			}
			current := map[string]bool{}
			for _, tag := range tags.names {
				current[tag] = true
			}
			if index == 0 || term.Kind == tmUnion {
				for tag := range current {
					names[tag] = true
				}
			} else {
				for tag := range names {
					if term.Kind == tmIntersection && !current[tag] || term.Kind == tmDifference && current[tag] {
						delete(names, tag)
					}
				}
			}
		}
	default:
		return nil
	}
	list := make([]string, 0, len(names))
	for tag := range names {
		list = append(list, tag)
	}
	return newInterner().fromList(list)
}

func patternReadsNodeValue(p *domPattern) bool {
	if p == nil {
		return false
	}
	if p.Kind == "test" && p.Op != "tags" && len(p.Items) > 0 {
		atom := p.Items[0]
		if atom.Kind == "test" && len(atom.Items) > 0 {
			atom = atom.Items[0]
		}
		if atom.Kind == "name" || atom.Kind == "call" {
			return true
		}
	}
	for _, child := range p.Items {
		if patternReadsNodeValue(child) {
			return true
		}
	}
	for _, child := range p.Attached {
		if patternReadsNodeValue(child) {
			return true
		}
	}
	return false
}
