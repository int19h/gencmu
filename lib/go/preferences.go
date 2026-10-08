package gencmu

import (
	"fmt"
	"sort"
	"strings"
)

// ReferenceSite identifies one written construction site in a surviving alternative.
type ReferenceSite struct {
	Document    string `json:"document"`
	At          [2]int `json:"at"`
	Rule        string `json:"rule"`
	Alternative int    `json:"alternative"`
	Path        string `json:"path"`
}

// LoadWarning describes the source scope of a rule preference.
type LoadWarning struct {
	Kind       string          `json:"kind"`
	Stage      string          `json:"stage"`
	Rule       string          `json:"rule,omitempty"`
	Higher     string          `json:"higher,omitempty"`
	Lower      string          `json:"lower,omitempty"`
	Container  string          `json:"container,omitempty"`
	Contained  string          `json:"contained,omitempty"`
	References []ReferenceSite `json:"references"`
	Message    string          `json:"message"`
}
type preferenceDeclaration struct {
	higher, lower, document string
	at                      [2]int
}
type preferences struct {
	paths    map[string]map[string][]string
	warnings []LoadWarning
}

func sortedPreferenceNames[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
func newPreferences(g *stageGrammar, ds []preferenceDeclaration) (*preferences, *Error) {
	p := &preferences{paths: map[string]map[string][]string{}}
	edges := map[string]map[string]bool{}
	fail := func(d preferenceDeclaration, message string) *Error {
		e := grammarError(d.document, d.at, "%s", message)
		e.Stage = g.name
		return e
	}
	for _, d := range ds {
		for _, name := range []string{d.higher, d.lower} {
			if isTerminalName(name) || g.byName[name] == nil {
				return nil, fail(d, "%prefer requires an existing rule: "+name)
			}
			if edges[name] == nil {
				edges[name] = map[string]bool{}
			}
		}
		if d.higher == d.lower {
			return nil, fail(d, "%prefer cannot prefer "+d.higher+" to itself")
		}
		edges[d.higher][d.lower] = true
	}
	for _, start := range sortedPreferenceNames(edges) {
		found := map[string][]string{}
		queue := [][]string{{start}}
		for i := 0; i < len(queue); i++ {
			path := queue[i]
			for _, next := range sortedPreferenceNames(edges[path[len(path)-1]]) {
				reached := append(append([]string{}, path...), next)
				if next == start {
					var locations []string
					var first preferenceDeclaration
					for j := 1; j < len(reached); j++ {
						for _, d := range ds {
							if d.higher == reached[j-1] && d.lower == reached[j] {
								locations = append(locations, fmt.Sprintf("%s:%d:%d", d.document, d.at[0], d.at[1]))
								if j == 1 {
									first = d
								}
								break
							}
						}
					}
					return nil, fail(first, "preference cycle: "+strings.Join(reached, " > ")+" ("+strings.Join(locations, ", ")+")")
				}
				if found[next] == nil {
					found[next] = reached
					queue = append(queue, reached)
				}
			}
		}
		p.paths[start] = found
	}
	if len(edges) == 0 {
		return p, nil
	}
	sites := map[string][]ReferenceSite{}
	for name := range edges {
		sites[name] = []ReferenceSite{}
	}
	restorable := map[string]bool{}
	rules := append([]*sRule{}, g.rules...)
	sort.Slice(rules, func(i, j int) bool { return rules[i].name < rules[j].name })
	site := func(rule *sRule, i int, alt *sAlt, path string) ReferenceSite {
		return ReferenceSite{alt.doc, alt.at, rule.name, i, path}
	}
	for _, rule := range rules {
		for i, alt := range rule.alts {
			walkPreferenceExpr(alt.alt.Expr, func(e *domExpr, path string) {
				if e.Kind == exRef {
					if _, ok := sites[e.Name]; ok {
						sites[e.Name] = append(sites[e.Name], site(rule, i, alt, path))
					}
				}
				if e.Kind == exOptional && e.Elidable {
					head := e.Inner
					if head.Kind == exSeq && len(head.Items) > 0 {
						head = head.Items[0]
					}
					if head.Kind == exTest {
						head = head.Inner
					}
					if head.Kind == exRef || head.Kind == exTerminal {
						restorable[head.Name] = true
					}
				}
			})
		}
	}
	for _, name := range sortedPreferenceNames(sites) {
		if len(sites[name]) > 1 {
			p.warnings = append(p.warnings, LoadWarning{Kind: "prefer-multiple-references", Stage: g.name, Rule: name, References: sites[name], Message: "Preference rule " + name + " has several written construction sites."})
		}
	}
	facts := map[string][3]bool{}
	for _, rule := range rules {
		facts[rule.name] = [3]bool{}
	}
	for {
		changed := false
		for _, rule := range rules {
			var value [3]bool
			for _, a := range rule.alts {
				v := preferenceProperties(a.alt.Expr, facts, restorable)
				for i := 0; i < 3; i++ {
					value[i] = value[i] || v[i]
				}
			}
			before := facts[rule.name]
			for i := 0; i < 3; i++ {
				if value[i] && !before[i] {
					before[i] = true
					changed = true
				}
			}
			facts[rule.name] = before
		}
		if !changed {
			break
		}
	}
	type containmentEdge struct {
		to   string
		site ReferenceSite
	}
	containment := map[string][]containmentEdge{}
	for _, rule := range rules {
		for i, alt := range rule.alts {
			containedPreferenceRefs(alt.alt.Expr, "", facts, restorable, func(name, path string) {
				containment[rule.name] = append(containment[rule.name], containmentEdge{name, site(rule, i, alt, path)})
			})
		}
	}
	containmentPath := func(from, to string) []ReferenceSite {
		type step struct {
			name string
			path []ReferenceSite
		}
		queue := []step{{name: from}}
		seen := map[string]bool{from: true}
		for i := 0; i < len(queue); i++ {
			for _, edge := range containment[queue[i].name] {
				path := append(append([]ReferenceSite{}, queue[i].path...), edge.site)
				if edge.to == to {
					return path
				}
				if !seen[edge.to] {
					seen[edge.to] = true
					queue = append(queue, step{edge.to, path})
				}
			}
		}
		return nil
	}
	for _, higher := range sortedPreferenceNames(p.paths) {
		for _, lower := range sortedPreferenceNames(p.paths[higher]) {
			for _, pair := range [][2]string{{higher, lower}, {lower, higher}} {
				container, contained := pair[0], pair[1]
				if !facts[contained][2] {
					continue
				}
				if refs := containmentPath(container, contained); refs != nil {
					p.warnings = append(p.warnings, LoadWarning{Kind: "prefer-same-span-containment", Stage: g.name, Higher: higher, Lower: lower, Container: container, Contained: contained, References: refs, Message: "Rule " + container + " can contain rival " + contained + " over the same original words."})
				}
			}
		}
	}
	sort.SliceStable(p.warnings, func(i, j int) bool {
		a, b := p.warnings[i], p.warnings[j]
		xs, ys := []string{a.Kind, a.Rule, a.Higher, a.Lower, a.Container, a.Contained}, []string{b.Kind, b.Rule, b.Higher, b.Lower, b.Container, b.Contained}
		for k, x := range xs {
			if x != ys[k] {
				return x < ys[k]
			}
		}
		return false
	})
	return p, nil
}
func walkPreferenceExpr(root *domExpr, call func(*domExpr, string)) {
	type step struct {
		e *domExpr
		p string
	}
	stack := []step{{root, ""}}
	for len(stack) > 0 {
		s := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		e, p := s.e, s.p
		call(e, p)
		switch e.Kind {
		case exSeq, exChoice, exAnd:
			for i := len(e.Items) - 1; i >= 0; i-- {
				stack = append(stack, step{e.Items[i], fmt.Sprintf("%s/%s/%d", p, e.Kind, i)})
			}
		case exCapture, exTest:
			stack = append(stack, step{e.Inner, p + "/expr"})
		case exOptional:
			stack = append(stack, step{e.Inner, p + "/optional"})
		case exRepeat:
			if e.Sep != nil {
				stack = append(stack, step{e.Sep, p + "/separator"})
			}
			stack = append(stack, step{e.Inner, p + "/repeat"})
		}
	}
}
func preferenceProperties(e *domExpr, f map[string][3]bool, r map[string]bool) [3]bool {
	switch e.Kind {
	case exCapture, exTest:
		return preferenceProperties(e.Inner, f, r)
	case exEmpty:
		return [3]bool{true, true, false}
	case exRef:
		if !isTerminalName(e.Name) {
			return f[e.Name]
		}
		fallthrough
	case exTerminal:
		return [3]bool{r[e.Name], true, true}
	case exRange, exProperty:
		return [3]bool{false, true, true}
	case exOptional:
		v := preferenceProperties(e.Inner, f, r)
		return [3]bool{true, true, v[2]}
	case exRepeat:
		a := preferenceProperties(e.Inner, f, r)
		b := [3]bool{true, true, false}
		if e.Sep != nil {
			b = preferenceProperties(e.Sep, f, r)
		}
		return [3]bool{a[0], a[1], a[2] || a[1] && b[1] && b[2]}
	case exChoice, exAnd:
		var v [3]bool
		for _, x := range e.Items {
			p := preferenceProperties(x, f, r)
			for i := 0; i < 3; i++ {
				v[i] = v[i] || p[i]
			}
		}
		return v
	case exSeq:
		v := [3]bool{true, true, false}
		for _, x := range e.Items {
			p := preferenceProperties(x, f, r)
			v[0] = v[0] && p[0]
			v[1] = v[1] && p[1]
			v[2] = v[2] || p[2]
		}
		v[2] = v[1] && v[2]
		return v
	}
	panic("gencmu: unknown preference expression")
}
func containedPreferenceRefs(e *domExpr, p string, f map[string][3]bool, r map[string]bool, call func(string, string)) {
	switch e.Kind {
	case exRef:
		if !isTerminalName(e.Name) {
			call(e.Name, p)
		}
	case exCapture, exTest:
		containedPreferenceRefs(e.Inner, p+"/expr", f, r, call)
	case exOptional:
		containedPreferenceRefs(e.Inner, p+"/optional", f, r, call)
	case exRepeat:
		containedPreferenceRefs(e.Inner, p+"/repeat", f, r, call)
		if e.Sep != nil && preferenceProperties(e.Inner, f, r)[0] {
			containedPreferenceRefs(e.Sep, p+"/separator", f, r, call)
		}
	case exSeq, exChoice, exAnd:
		for i, x := range e.Items {
			allowed := true
			if e.Kind == exSeq {
				for j, y := range e.Items {
					if i != j && !preferenceProperties(y, f, r)[0] {
						allowed = false
						break
					}
				}
			}
			if allowed {
				containedPreferenceRefs(x, fmt.Sprintf("%s/%s/%d", p, e.Kind, i), f, r, call)
			}
		}
	}
}
