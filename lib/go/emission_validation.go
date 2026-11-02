package gencmu

import (
	"sort"
	"strings"
)

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
		case exLiteral, exRange, exWildcard:
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

// Rule stitching retains the original rule slots, but cycles follow the text
// order of the surviving alternatives, including extensions and replacements.
func (g *stageGrammar) validateRecipeCycles() *Error {
	type alternative struct {
		rule string
		alt  *sAlt
	}
	var alternatives []alternative
	for _, r := range g.rules {
		for _, a := range r.alts {
			alternatives = append(alternatives, alternative{r.name, a})
		}
	}
	sort.Slice(alternatives, func(i, j int) bool {
		return alternatives[i].alt.textOrder < alternatives[j].alt.textOrder
	})
	for _, a := range alternatives {
		if err := g.validateAlternativeRecipeCycle(a.rule, a.alt); err != nil {
			return err
		}
	}
	return nil
}

func (g *stageGrammar) validateAlternativeRecipeCycle(rule string, a *sAlt) *Error {
	value, image := a.alt.Value, a.alt.Image
	if value == nil {
		value = a.ruleValue
	}
	if image == nil {
		image = a.ruleImage
	}
	impliedImage := image == nil
	if impliedImage {
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
				if atom.Str == "image" && !impliedImage {
					target = 1
				}
				edges[channel] = append(edges[channel], target)
			}
		}
	}
	var state [2]byte
	var active []int
	var path []string
	var visit func(int) *domTerm
	visit = func(channel int) *domTerm {
		if state[channel] == 2 {
			return nil
		}
		state[channel] = 1
		active = append(active, channel)
		for _, target := range edges[channel] {
			if state[target] == 1 {
				for _, step := range append(active, target) {
					path = append(path, rule+"."+[2]string{"value", "image"}[step])
				}
				return recipes[channel]
			}
			if closing := visit(target); closing != nil {
				return closing
			}
		}
		state[channel] = 2
		active = active[:len(active)-1]
		return nil
	}
	for channel, recipe := range recipes {
		if recipe == nil || channel == 1 && impliedImage {
			continue
		}
		if closing := visit(channel); closing != nil {
			err := g.constError(a.doc, closing.At, "string recipe dependency cycle: %s", strings.Join(path, " -> "))
			err.recipeCycle = true
			return err
		}
	}
	return nil
}
