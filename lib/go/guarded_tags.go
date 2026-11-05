package gencmu

import (
	"sort"
	"strings"
)

// Neighbour guards become concrete tags with boundary obligations.
func neighbourGuards(term *domTerm) []*domTerm {
	var guards []*domTerm
	walkClause(clausePart{t: term}, func(part clausePart) bool {
		if node := part.t; node != nil && node.Kind == tmIf && len(boundaryAtoms(clausePart{c: node.Cond})) > 0 {
			guards = append(guards, node)
			return false
		}
		return true
	})
	return guards
}
func literalTagShape(term *domTerm) bool {
	if term == nil {
		return false
	}
	switch term.Kind {
	case tmTag, tmEmptySet, tmConst, tmParam:
		return true
	case tmUnion, tmIntersection, tmDifference:
		for _, child := range term.Items {
			if !literalTagShape(child) {
				return false
			}
		}
		return true
	}
	return false
}
func literalTags(term *domTerm) map[string]bool {
	if term == nil {
		return nil
	}
	result := map[string]bool{}
	switch term.Kind {
	case tmTag:
		result[term.Str] = true
	case tmEmptySet:
	case tmConst:
		if term.value == nil || term.value.ty != tyTags {
			return nil
		}
		for _, name := range term.value.names {
			result[name] = true
		}
	case tmUnion, tmIntersection, tmDifference:
		for i, child := range term.Items {
			tags := literalTags(child)
			if tags == nil {
				return nil
			}
			if i == 0 || term.Kind == tmUnion {
				for name := range tags {
					result[name] = true
				}
			} else {
				for name := range result {
					if tags[name] == (term.Kind == tmDifference) {
						delete(result, name)
					}
				}
			}
		}
	default:
		return nil
	}
	return result
}
func neighbourGuardProblem(term *domTerm) (*domCond, string) {
	for _, guard := range neighbourGuards(term) {
		atom := guard.Cond
		if atom.Kind == cdNot {
			atom = atom.Inner
		}
		if atom.Kind != cdBoundary || atom.Span == nil || atom.Span.Kind != tmCapture || atom.Span.Str != "" {
			return guard.Cond, "a tag guard requires one optionally negated neighbour atom on $"
		}
		if len(guard.Items) != 1 || !literalTagShape(guard.Items[0]) {
			return guard.Cond, "a neighbour tag guard requires a literal tag set"
		}
	}
	return nil, ""
}
func tagAtomKey(atom *domCond) string {
	targets := map[string]bool{}
	for _, target := range atom.Targets {
		targets[target.Kind+":"+target.Str] = true
	}
	names := make([]string, 0, len(targets))
	for name := range targets {
		names = append(names, name)
	}
	sort.Strings(names)
	return atom.Op + "\x00" + strings.Join(names, "\x00")
}

type guardedTagVariant struct {
	tags       *domTerm
	conditions []*domCond
}

func guardedTagVariants(term *domTerm) ([]guardedTagVariant, string) {
	guards := neighbourGuards(term)
	if len(guards) == 0 {
		return []guardedTagVariant{{tags: term}}, ""
	}
	type variable struct {
		atom    *domCond
		targets map[string]bool
	}
	type part struct {
		index   int
		negated bool
	}
	var variables []variable
	indexes := map[string]int{}
	parts := map[*domTerm]part{}
	for _, guard := range guards {
		tags := literalTags(guard.Items[0])
		if tags == nil {
			return nil, "a neighbour tag guard requires a literal tag set"
		}
		if len(tags) == 0 {
			parts[guard] = part{index: -1}
			continue
		}
		atom := guard.Cond
		negated := atom.Kind == cdNot
		if negated {
			atom = atom.Inner
		}
		key := tagAtomKey(atom)
		index, known := indexes[key]
		if !known {
			index = len(variables)
			indexes[key] = index
			targets := map[string]bool{}
			for _, target := range atom.Targets {
				targets[target.Kind+":"+target.Str] = true
			}
			variables = append(variables, variable{atom, targets})
		}
		parts[guard] = part{index, negated}
	}
	assigned := []bool{}
	possible := func() bool {
		for i, truth := range assigned {
			if !truth {
				continue
			}
			positive := variables[i]
			covered := map[string]bool{}
			for j, truth := range assigned {
				if !truth && variables[j].atom.Op == positive.atom.Op {
					for target := range variables[j].targets {
						covered[target] = true
					}
				}
			}
			subset := true
			for target := range positive.targets {
				if !covered[target] {
					subset = false
					break
				}
			}
			if subset {
				return false
			}
		}
		return true
	}
	var replace func(*domTerm) *domTerm
	replace = func(node *domTerm) *domTerm {
		if node == nil {
			return nil
		}
		if part, known := parts[node]; known {
			if part.index >= 0 && assigned[part.index] != part.negated {
				return node.Items[0]
			}
			return reducedEmpty
		}
		switch node.Kind {
		case tmIf, tmUnion, tmIntersection, tmDifference:
			copy := *node
			copy.Items = make([]*domTerm, len(node.Items))
			for i, child := range node.Items {
				copy.Items[i] = replace(child)
			}
			return &copy
		}
		return node
	}
	var result []guardedTagVariant
	var fault string
	var visit func()
	visit = func() {
		if fault != "" || !possible() {
			return
		}
		if len(assigned) == len(variables) {
			conditions := make([]*domCond, len(variables))
			for i, v := range variables {
				conditions[i] = v.atom
				if !assigned[i] {
					conditions[i] = &domCond{Kind: cdNot, Inner: v.atom}
				}
			}
			result = append(result, guardedTagVariant{replace(term), conditions})
			if len(result) > 16 {
				fault = "a production has more than 16 guarded tag variants"
			}
			return
		}
		for _, truth := range []bool{false, true} {
			assigned = append(assigned, truth)
			visit()
			assigned = assigned[:len(assigned)-1]
		}
	}
	visit()
	return result, fault
}
