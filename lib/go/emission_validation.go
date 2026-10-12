package gencmu

// Emission overlap depends on structural consumption, never on successful
// conditions, enabled gates, recipes, or erasure (engine §9.3).
func (g *stageGrammar) validateEmissionOverlap() *Error {
	consuming := map[string]bool{}
	var reads func(*domExpr) bool
	reads = func(e *domExpr) bool {
		if e == nil {
			return false
		}
		switch e.Kind {
		case exLiteral, exRange, exWildcard, exTerminal:
			return true
		case exRef:
			return isTerminalName(e.Name) || consuming[e.Name]
		}
		if reads(e.Inner) || reads(e.Sep) {
			return true
		}
		for _, child := range e.Items {
			if reads(child) {
				return true
			}
		}
		return false
	}
	for changed := true; changed; {
		changed = false
		for _, r := range g.rules {
			if consuming[r.name] {
				continue
			}
			for _, a := range r.alts {
				if reads(a.alt.Expr) {
					consuming[r.name] = true
					changed = true
					break
				}
			}
		}
	}
	for _, r := range g.rules {
		for _, a := range r.alts {
			if a.emit == nil {
				continue
			}
			captures := map[string]bool{}
			stack := []*domExpr{a.alt.Expr}
			for len(stack) > 0 {
				e := stack[len(stack)-1]
				stack = stack[:len(stack)-1]
				if e == nil {
					continue
				}
				if e.Kind == exCapture {
					captures[e.Name] = captures[e.Name] || reads(e.Inner)
				}
				stack = append(stack, e.Inner, e.Sep)
				stack = append(stack, e.Items...)
			}
			for i, x := range a.emit.Items {
				for _, y := range a.emit.Items[i+1:] {
					if x.IsInsert || y.IsInsert || x.Capture != "" && y.Capture != "" {
						continue
					}
					if x.Capture == "" && y.Capture == "" {
						if reads(a.alt.Expr) {
							return g.constError(a.doc, a.at, "emitted whole carriers overlap consuming input")
						}
						continue
					}
					other := x
					if x.Capture == "" {
						other = y
					}
					for _, name := range other.captures() {
						if captures[name] {
							return g.constError(a.doc, a.at, "a whole carrier overlaps consuming capture $%s", name)
						}
					}
				}
			}
		}
	}
	return nil
}

func (g *stageGrammar) validateRecipeCycles() *Error {
	for _, r := range g.rules {
		for _, a := range r.alts {
			value, image := a.alt.Value, a.alt.Image
			if value == nil {
				value = a.ruleValue
			}
			if image == nil {
				image = a.ruleImage
			}
			if image == nil {
				image = value
			}
			recipes := [2]*domTerm{value, image}
			var edges [2][]int
			for channel, recipe := range recipes {
				if recipe == nil {
					continue
				}
				for _, atom := range recipe.Items {
					if atom.Kind != tmCall || len(atom.Items) != 1 {
						continue
					}
					receiver := atom.Items[0]
					if receiver.Kind == tmCall && receiver.Str == "emitted" && receiver.Items[0].Kind == tmCapture && receiver.Items[0].Str == "" {
						target := 0
						if atom.Str == "image" {
							target = 1
						}
						edges[channel] = append(edges[channel], target)
					}
				}
			}
			var state [2]byte
			var visit func(int) bool
			visit = func(channel int) bool {
				if state[channel] == 1 {
					return true
				}
				if state[channel] == 2 {
					return false
				}
				state[channel] = 1
				for _, target := range edges[channel] {
					if visit(target) {
						return true
					}
				}
				state[channel] = 2
				return false
			}
			for channel, recipe := range recipes {
				if recipe != nil && visit(channel) {
					return g.constError(a.doc, recipe.At, "string recipe dependency cycle through constituent value or image")
				}
			}
		}
	}
	return nil
}

func (g *stageGrammar) resolveClassifierKeys() *Error {
	for index, item := range g.classifierSet.items {
		copy := *item.classifier
		copy.Entries = make([]*domEntry, len(item.classifier.Entries))
		for i, e := range item.classifier.Entries {
			entry := *e
			copy.Entries[i] = &entry
		}
		item.classifier = &copy
		g.classifierSet.items[index] = item
		for _, entry := range item.classifier.Entries {
			entry.Keys = nil
			for _, key := range entry.KeyTerms {
				for _, ref := range constRefs(key) {
					if _, scalar := engineScalar(ref.Str); g.constants[ref.Str] == nil && !scalar {
						return g.constError(item.doc, ref.At, "unknown classifier string constant $%s", ref.Str)
					}
				}
				if ty, f := termTypeIn(key, g.constantTypes()); f != nil {
					return g.faultError(item.doc, f.node, entry.At, f.problem)
				} else if ty != tyString {
					return g.faultError(item.doc, key, entry.At, "classifier keys require strings")
				}
				value, err := g.evaluateClosed(item.doc, key, entry.At)
				if err != nil {
					return err
				}
				entry.Keys = append(entry.Keys, value.s)
			}
		}
	}
	return nil
}
