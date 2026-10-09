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
	paths        map[string]map[string][]string
	warnings     []LoadWarning
	components   []slotComponent
	labels       map[string]int
	variants     map[string]*slotVariant
	declarations []preferenceDeclaration
	stage        string
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
	p := &preferences{paths: map[string]map[string][]string{}, labels: map[string]int{}, variants: map[string]*slotVariant{}, declarations: ds, stage: g.name}
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
	sites := map[string][]slotReference{}
	for name := range edges {
		sites[name] = nil
	}
	for _, rule := range g.rules {
		for i, a := range rule.alts {
			walkPreferenceExpr(a.alt.Expr, func(e *domExpr, path string) {
				if e.Kind == exRef {
					if _, ok := sites[e.Name]; ok {
						sites[e.Name] = append(sites[e.Name], slotReference{ReferenceSite{a.doc, a.at, rule.name, i, path}, a, e})
					}
				}
			})
		}
	}
	for _, name := range sortedPreferenceNames(sites) {
		if len(sites[name]) != 1 {
			refs := []ReferenceSite{}
			for _, s := range sites[name] {
				refs = append(refs, s.ReferenceSite)
			}
			return nil, p.fail("prefer-slot-multiple-references", name, refs, "exactly one written reference site is required")
		}
	}
	seen := map[string]bool{}
	for _, start := range sortedPreferenceNames(edges) {
		if seen[start] {
			continue
		}
		names := map[string]bool{start: true}
		queue := []string{start}
		for i := 0; i < len(queue); i++ {
			name := queue[i]
			seen[name] = true
			for _, other := range sortedPreferenceNames(edges) {
				if (edges[name][other] || edges[other][name]) && !names[other] {
					names[other] = true
					queue = append(queue, other)
				}
			}
		}
		refs := []ReferenceSite{}
		parent := sites[start][0].Rule
		for _, n := range sortedPreferenceNames(names) {
			refs = append(refs, sites[n][0].ReferenceSite)
		}
		for _, r := range refs {
			if r.Rule != parent {
				return nil, p.fail("prefer-slot-parent", start, refs, "ranked references require one common parent")
			}
		}
		component := len(p.components)
		p.components = append(p.components, slotComponent{names, refs})
		common := ""
		for _, n := range sortedPreferenceNames(names) {
			s := sites[n][0]
			v := &slotVariant{component: component, source: s.source, roles: map[string]string{}, paths: map[*domExpr]string{}, holeNames: map[string]bool{}, carriers: map[*domExpr]bool{}}
			body := slotNormalize(s.source.alt.Expr, n, "", v)
			walkPreferenceExpr(s.source.alt.Expr, func(expr *domExpr, _ string) {
				if slotContains(expr, n) {
					v.carriers[expr] = slotEndsAtHole(expr, n)
				}
			})
			var w jsonWriter
			body.writeJSON(&w)
			key := string(w.buf)
			if common != "" && common != key {
				return nil, p.fail("prefer-slot-template", n, refs, "parent bodies differ outside the ranked hole")
			}
			common = key
			for name, role := range v.roles {
				if role == "hole" {
					v.holeNames[name] = true
				}
			}
			if slotEmitMentions(s.source.emit, v.holeNames) {
				return nil, p.fail("prefer-slot-template", n, refs, "an emission item cannot name or read a ranked hole capture")
			}
			p.labels[n] = component
			p.variants[n] = v
		}
	}
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
		case exSeq, exChoice, exRanked, exAnd:
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

// Slot templates retain written capture and helper roles.
type slotReference struct {
	ReferenceSite
	source *sAlt
	expr   *domExpr
}
type slotComponent struct {
	names      map[string]bool
	references []ReferenceSite
}
type slotVariant struct {
	component int
	source    *sAlt
	roles     map[string]string
	paths     map[*domExpr]string
	holeNames map[string]bool
	carriers  map[*domExpr]bool
}

func (p *preferences) fail(code, name string, refs []ReferenceSite, detail string) *Error {
	var d preferenceDeclaration
	for _, x := range p.declarations {
		if x.higher == name || x.lower == name {
			d = x
			break
		}
	}
	var sites []string
	for _, r := range refs {
		sites = append(sites, fmt.Sprintf("%s:%d:%d %s alternative %d %s", r.Document, r.At[0], r.At[1], r.Rule, r.Alternative, r.Path))
	}
	e := grammarError(d.document, d.at, "%s: Rule %s: %s. Declaration %%prefer %s > %s. References: %s", code, name, detail, d.higher, d.lower, strings.Join(sites, ", "))
	e.Stage = p.stage
	return e
}
func slotContains(e *domExpr, name string) bool {
	found := false
	walkPreferenceExpr(e, func(x *domExpr, _ string) {
		if x.Kind == exRef && x.Name == name {
			found = true
		}
	})
	return found
}
func slotDirect(e *domExpr, name string) bool {
	for e.Kind == exCapture || e.Kind == exTest {
		e = e.Inner
	}
	return e.Kind == exRef && e.Name == name
}
func slotNormalize(e *domExpr, name, path string, v *slotVariant) *domExpr {
	v.paths[e] = path
	if e.Kind == exChoice {
		for _, x := range e.Items {
			if slotContains(x, name) {
				return slotNormalize(x, name, path, v)
			}
		}
	}
	if e.Kind == exCapture {
		hole := slotDirect(e.Inner, name)
		role := path
		if hole {
			role = "hole"
		}
		v.roles[e.Name] = role
		inner := slotNormalize(e.Inner, name, path+"/expr", v)
		if hole {
			return inner
		}
		return &domExpr{Kind: exCapture, Name: path, Inner: inner}
	}
	if e.Kind == exTest && slotDirect(e.Inner, name) {
		return slotNormalize(e.Inner, name, path+"/expr", v)
	}
	if e.Kind == exRef && e.Name == name {
		return &domExpr{Kind: exRef, Name: "HOLE"}
	}
	out := *e
	if e.Items != nil {
		out.Items = make([]*domExpr, len(e.Items))
		for i, x := range e.Items {
			out.Items[i] = slotNormalize(x, name, fmt.Sprintf("%s/%s/%d", path, e.Kind, i), v)
		}
	}
	if e.Inner != nil {
		key := "expr"
		if e.Kind == exOptional {
			key = "optional"
		}
		if e.Kind == exRepeat {
			key = "repeat"
		}
		out.Inner = slotNormalize(e.Inner, name, path+"/"+key, v)
	}
	if e.Sep != nil {
		out.Sep = slotNormalize(e.Sep, name, path+"/separator", v)
	}
	out.Value = slotExpandTerm(e.Value, v.roles)
	return &out
}
func slotExpandTerm(t *domTerm, roles map[string]string) *domTerm {
	if t == nil {
		return nil
	}
	if t.Kind == tmConst && t.value != nil {
		v := t.value
		switch v.ty {
		case tyString:
			return &domTerm{Kind: tmString, Str: v.s}
		case tyPattern:
			return &domTerm{Kind: tmPattern, Pattern: v.pattern}
		default:
			if len(v.names) == 0 {
				return reducedEmpty
			}
			xs := make([]*domTerm, len(v.names))
			for i, n := range v.names {
				xs[i] = &domTerm{Kind: tmTag, Str: n}
			}
			if len(xs) == 1 {
				return xs[0]
			}
			return &domTerm{Kind: tmUnion, Items: xs}
		}
	}
	out := *t
	if t.Kind == tmCapture {
		if r, ok := roles[t.Str]; ok {
			out.Str = r
		}
	}
	if t.Items != nil {
		out.Items = make([]*domTerm, len(t.Items))
		for i, x := range t.Items {
			out.Items[i] = slotExpandTerm(x, roles)
		}
	}
	out.Cond = slotExpandCond(t.Cond, roles)
	out.At = [2]int{}
	return &out
}
func slotExpandCond(c *domCond, roles map[string]string) *domCond {
	if c == nil {
		return nil
	}
	out := *c
	out.Left = slotExpandTerm(c.Left, roles)
	out.Right = slotExpandTerm(c.Right, roles)
	out.Span = slotExpandTerm(c.Span, roles)
	out.Inner = slotExpandCond(c.Inner, roles)
	if c.Kind == cdCaptured {
		if r, ok := roles[c.Rule]; ok {
			out.Rule = r
		}
	}
	if c.Items != nil {
		out.Items = make([]*domCond, len(c.Items))
		for i, x := range c.Items {
			out.Items[i] = slotExpandCond(x, roles)
		}
	}
	return &out
}
func slotTermKey(t *domTerm, roles map[string]string) string {
	if t == nil {
		return "absent"
	}
	var w jsonWriter
	slotExpandTerm(t, roles).writeJSON(&w)
	return string(w.buf)
}
func slotCondKey(c *domCond, roles map[string]string) string {
	var w jsonWriter
	slotExpandCond(c, roles).writeJSON(&w)
	return string(w.buf)
}
func slotEmitKey(e *domEmit, roles map[string]string) string {
	if e == nil {
		return "absent"
	}
	out := &domEmit{}
	for _, i := range e.Items {
		x := *i
		if r, ok := roles[x.Capture]; ok {
			x.Capture = r
		}
		x.Tags = slotExpandTerm(x.Tags, roles)
		mapNames := func(ns []string) []string {
			out := make([]string, len(ns))
			for i, n := range ns {
				r, ok := roles[n]
				if !ok {
					r = n
				}
				out[i] = r
			}
			return out
		}
		x.Before = mapNames(x.Before)
		x.After = mapNames(x.After)
		out.Items = append(out.Items, &x)
	}
	var w jsonWriter
	out.writeJSON(&w)
	return string(w.buf)
}
func slotMentions(t *domTerm, c *domCond, names map[string]bool) bool {
	found := false
	walkClause(clausePart{t: t, c: c}, func(x clausePart) bool {
		if x.t != nil && x.t.Kind == tmCapture && names[x.t.Str] || x.c != nil && x.c.Kind == cdCaptured && names[x.c.Rule] {
			found = true
		}
		return true
	})
	return found
}
func slotEmitMentions(e *domEmit, names map[string]bool) bool {
	if e == nil {
		return false
	}
	for _, i := range e.Items {
		if !i.IsInsert && names[i.Capture] || slotMentions(i.Tags, nil, names) {
			return true
		}
		for _, n := range append(append([]string{}, i.Before...), i.After...) {
			if names[n] {
				return true
			}
		}
	}
	return false
}
func slotTagRead(t *domTerm, c *domCond, names map[string]bool) bool {
	found := false
	walkClause(clausePart{t: t, c: c}, func(x clausePart) bool {
		t := x.t
		if t != nil && t.Kind == tmCall && (t.Str == "tags" || t.Str == "classes") && len(t.Items) == 1 && t.Items[0].Kind == tmCapture && names[t.Items[0].Str] {
			found = true
		}
		return true
	})
	return found
}
func slotStructureRead(t *domTerm, c *domCond, names map[string]bool) bool {
	found := false
	walkClause(clausePart{t: t, c: c}, func(x clausePart) bool {
		if x.c != nil && (x.c.Op == "≅" || x.c.Op == "≇") && slotMentions(x.c.Left, nil, names) {
			found = true
		}
		return true
	})
	return found
}
func slotLiteralEmpty(t *domTerm) bool { return slotExpandTerm(t, nil).Kind == tmEmptySet }
func (p *preferences) variant(source *sAlt, component int, rhs []symbol, g *lowered) *slotVariant {
	for _, s := range rhs {
		if !s.term && !g.rules[s.id].helper {
			v := p.variants[g.rules[s.id].name]
			if v != nil && v.component == component {
				return v
			}
		}
	}
	for _, name := range sortedPreferenceNames(p.variants) {
		v := p.variants[name]
		if v.source == source && v.component == component {
			for _, s := range rhs {
				if !s.term && g.rules[s.id].helper {
					if _, ok := v.carriers[slotHelperPath(s.id, g)]; ok {
						return v
					}
				}
			}
		}
	}
	for _, name := range sortedPreferenceNames(p.variants) {
		v := p.variants[name]
		if v.source == source && v.component == component {
			return v
		}
	}
	return nil
}
func slotSymbolRole(s symbol, v *slotVariant, g *lowered) string {
	if s.term {
		return "T" + g.terminals[s.id]
	}
	r := g.rules[s.id]
	if r.helper && len(r.prods) > 0 && r.prods[0].slot != nil {
		if path, ok := v.paths[r.prods[0].slot.path]; ok {
			return "H" + path
		}
	}
	return "N" + r.name
}
func slotTestKey(t *symTest) string {
	if t == nil {
		return ""
	}
	return fmt.Sprintf("%s/%q/%q", t.op, t.sound, t.tags)
}
func (p *preferences) validate(g *lowered) *Error {
	if g.fault != "" {
		if g.faultLocation != nil {
			return g.faultLocation
		}
		return &Error{Kind: ErrorGrammar, Message: g.fault}
	}
	unsafe := map[int32]bool{}
	users := map[int32][]int32{}
	pending := []int32{}
	for _, prod := range g.prods {
		mark := false
		if len(prod.slot.tags) > 0 {
			for _, t := range prod.slot.tags {
				mark = mark || !slotLiteralEmpty(t)
			}
		} else if len(prod.rhs) == 1 {
			s := prod.rhs[0]
			if s.term {
				mark = true
			} else {
				users[s.id] = append(users[s.id], prod.lhs)
			}
		}
		if mark && !unsafe[prod.lhs] {
			unsafe[prod.lhs] = true
			pending = append(pending, prod.lhs)
		}
	}
	for i := 0; i < len(pending); i++ {
		for _, r := range users[pending[i]] {
			if !unsafe[r] {
				unsafe[r] = true
				pending = append(pending, r)
			}
		}
	}
	for component, c := range p.components {
		first := sortedPreferenceNames(c.names)[0]
		requireEmpty := func(expr string) *Error {
			for _, n := range sortedPreferenceNames(c.names) {
				r := g.byName[n]
				if unsafe[r] {
					return p.fail("prefer-slot-tags", n, c.references, "private hole tags in "+expr+" are neither dead nor empty: "+strings.Join(slotInheritancePath(g, r, unsafe), " -> "))
				}
			}
			return nil
		}
		type clauses struct{ body, conditions string }
		templates := map[string]clauses{}
		for _, prod := range g.prods {
			v := p.variant(prod.slot.source, component, prod.rhs, g)
			if v == nil {
				continue
			}
			hole := -1
			for i, s := range prod.rhs {
				_, carrier := v.carriers[slotHelperPath(s.id, g)]
				if !s.term && (c.names[g.rules[s.id].name] || carrier) {
					hole = i
					break
				}
			}
			actual := hole >= 0 && !g.rules[prod.rhs[hole].id].helper
			boundary := actual || hole >= 0 && v.carriers[slotHelperPath(prod.rhs[hole].id, g)]
			private := map[string]bool{}
			for n := range v.holeNames {
				private[n] = true
			}
			if actual && prod.capName[hole] != "" {
				private[prod.capName[hole]] = true
			}
			privateTags := map[string]bool{}
			for n := range private {
				privateTags[n] = true
			}
			if hole >= 0 && unsafe[prod.rhs[hole].id] && prod.capName[hole] != "" {
				privateTags[prod.capName[hole]] = true
			}
			var common []string
			allConds := append([]lcond{}, prod.conds...)
			for _, cond := range prod.predictConds {
				allConds = append(allConds, lcond{cond: cond})
			}
			for _, cond := range allConds {
				ready := hole >= 0 && (cond.trigger < hole+1 || cond.trigger == hole+1 && boundary)
				if slotStructureRead(nil, cond.cond, private) && !ready {
					return p.fail("prefer-slot-continuation", first, c.references, "private hole pattern requires a ready condition gate: "+slotCondKey(cond.cond, v.roles))
				}
				if slotTagRead(nil, cond.cond, privateTags) && !ready {
					if e := requireEmpty(slotCondKey(cond.cond, v.roles)); e != nil {
						return e
					}
				}
				if !ready {
					common = append(common, slotCondKey(cond.cond, v.roles))
				}
			}
			for _, t := range prod.slot.tags {
				if slotStructureRead(t, nil, private) {
					return p.fail("prefer-slot-continuation", first, c.references, "tag term reads private hole structure: "+slotTermKey(t, v.roles))
				}
				if slotTagRead(t, nil, privateTags) {
					if e := requireEmpty(slotTermKey(t, v.roles)); e != nil {
						return e
					}
				}
			}
			if !g.rules[prod.lhs].helper && len(prod.slot.tags) == 0 && len(prod.rhs) == 1 && hole >= 0 && (actual || unsafe[prod.rhs[hole].id]) {
				if e := requireEmpty("default inheritance"); e != nil {
					return e
				}
			}
			var syms, caps []string
			for i, s := range prod.rhs {
				if i == hole {
					syms = append(syms, "HOLE")
				} else {
					syms = append(syms, slotSymbolRole(s, v, g)+"/"+slotTestKey(prod.testAt(i)))
					if n := prod.capName[i]; n != "" {
						caps = append(caps, fmt.Sprintf("%q/%d", v.roles[n], i))
					}
				}
			}
			role := "written-parent"
			if g.rules[prod.lhs].helper {
				role = v.paths[prod.slot.path]
			}
			key := fmt.Sprintf("%q/%q/%q", role, syms, caps)
			tagClauses := [2]string{}
			for i, term := range prod.slot.tagClauses {
				if term != nil {
					tagClauses[i] = slotTermKey(term, v.roles)
				}
			}
			body := fmt.Sprintf("%q/%s", tagClauses, slotEmitKey(prod.emit, v.roles))
			conditions := fmt.Sprintf("%q", common)
			if old, ok := templates[key]; ok {
				if old.body != body {
					return p.fail("prefer-slot-template", first, c.references, "effective parent tag or emission clauses differ")
				}
				if hole >= 0 && old.conditions != conditions {
					return p.fail("prefer-slot-continuation", first, c.references, "differing conditions must be ready at the ranked hole boundary")
				}
			}
			templates[key] = clauses{body, conditions}
		}
	}
	return nil
}
func slotInheritancePath(g *lowered, start int32, unsafe map[int32]bool) []string {
	type path struct {
		text string
		prev int
	}
	type step struct {
		rule int32
		prev int
		end  bool
	}
	paths := []path{}
	stack := []step{{rule: start, prev: -1}}
	seen := map[int32]bool{}
	for len(stack) > 0 {
		s := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if s.end {
			var out []string
			for at := s.prev; at >= 0; at = paths[at].prev {
				out = append(out, paths[at].text)
			}
			for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
				out[i], out[j] = out[j], out[i]
			}
			return out
		}
		if seen[s.rule] {
			continue
		}
		seen[s.rule] = true
		ps := g.rules[s.rule].prods
		for i := len(ps) - 1; i >= 0; i-- {
			prod := ps[i]
			source := fmt.Sprintf("%s:%d:%d %s", prod.doc, prod.at[0], prod.at[1], g.rules[s.rule].name)
			mark := false
			for _, t := range prod.slot.tags {
				mark = mark || !slotLiteralEmpty(t)
			}
			if mark {
				paths = append(paths, path{source + " tags " + fmt.Sprint(prod.slot.tags), s.prev})
				stack = append(stack, step{prev: len(paths) - 1, end: true})
			} else if len(prod.slot.tags) == 0 && len(prod.rhs) == 1 {
				sym := prod.rhs[0]
				if sym.term {
					paths = append(paths, path{source + " terminal " + g.terminals[sym.id], s.prev})
					stack = append(stack, step{prev: len(paths) - 1, end: true})
				} else if unsafe[sym.id] {
					paths = append(paths, path{source, s.prev})
					stack = append(stack, step{rule: sym.id, prev: len(paths) - 1})
				}
			}
		}
	}
	panic("gencmu: an unsafe tag source lacks an inheritance path")
}

func slotHelperPath(rule int32, g *lowered) *domExpr {
	if rule < 0 || int(rule) >= len(g.rules) || !g.rules[rule].helper || len(g.rules[rule].prods) == 0 {
		return nil
	}
	return g.rules[rule].prods[0].slot.path
}
func slotEndsAtHole(e *domExpr, name string) bool {
	if e == nil {
		return false
	}
	switch e.Kind {
	case exRef:
		return e.Name == name
	case exCapture, exTest, exOptional:
		return slotEndsAtHole(e.Inner, name)
	case exSeq:
		return len(e.Items) > 0 && slotEndsAtHole(e.Items[len(e.Items)-1], name)
	case exChoice:
		for _, child := range e.Items {
			if slotEndsAtHole(child, name) {
				return true
			}
		}
	}
	return false
}
