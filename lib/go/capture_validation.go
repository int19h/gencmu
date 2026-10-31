package gencmu

import (
	"sort"
	"strings"
)

// A capture query keeps four order states and one first witness per state.
// It never expands the product of optional or alternative capture sequences.
type captureRope[T any] struct {
	left, right *captureRope[T]
	value       T
	leaf        bool
}

func captureLeaf[T any](value T) *captureRope[T] { return &captureRope[T]{value: value, leaf: true} }
func captureJoin[T any](a, b *captureRope[T]) *captureRope[T] {
	if a == nil {
		return b
	}
	if b == nil {
		return a
	}
	return &captureRope[T]{left: a, right: b}
}
func captureFlat[T any](r *captureRope[T]) []T {
	var out []T
	pending := []*captureRope[T]{r}
	for len(pending) > 0 {
		p := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		if p == nil {
			continue
		}
		if p.leaf {
			out = append(out, p.value)
		} else {
			pending = append(pending, p.right, p.left)
		}
	}
	return out
}

type captureWitness struct {
	present map[string]bool
	count   int
	names   *captureRope[string]
	key     *captureRope[int]
	mask    int
}

func captureBefore(a, b *captureWitness) bool {
	x, y := []*captureRope[int]{a.key}, []*captureRope[int]{b.key}
	for len(x) > 0 && len(y) > 0 {
		u, v := x[len(x)-1], y[len(y)-1]
		switch {
		case u == nil:
			x = x[:len(x)-1]
		case v == nil:
			y = y[:len(y)-1]
		case u == v:
			x = x[:len(x)-1]
			y = y[:len(y)-1]
		case !u.leaf:
			x = x[:len(x)-1]
			x = append(x, u.right, u.left)
		case !v.leaf:
			y = y[:len(y)-1]
			y = append(y, v.right, v.left)
		case u.value != v.value:
			return u.value < v.value
		default:
			x = x[:len(x)-1]
			y = y[:len(y)-1]
		}
	}
	for _, p := range x {
		if p != nil {
			return false
		}
	}
	for _, p := range y {
		if p != nil {
			return true
		}
	}
	return false
}
func capturePick(out *[4]*captureWitness, state int, w *captureWitness) {
	old := out[state]
	if old == nil || w.count > old.count || w.count == old.count && captureBefore(w, old) {
		out[state] = w
	}
}
func captureQuery(e *domExpr, required, forbidden map[string]bool, order []string) *captureWitness {
	if forbidden[""] {
		return nil
	}
	need := 0
	for n := range required {
		if forbidden[n] {
			return nil
		}
		if n != "" {
			need++
		}
	}
	var visit func(*domExpr) [4]*captureWitness
	visit = func(e *domExpr) (out [4]*captureWitness) {
		if w := work.Load(); w != nil {
			w.readerSteps.add("reader steps")
		}
		if e == nil {
			out[0] = &captureWitness{}
			return
		}
		if e.Kind == exCapture {
			if forbidden[e.Name] {
				return
			}
			state := 0
			if len(order) > 0 {
				if e.Name == order[0] {
					state = 1
				} else if e.Name == order[1] {
					state = 2
				}
			}
			n := 0
			if required[e.Name] {
				n = 1
			}
			out[state] = &captureWitness{count: n, names: captureLeaf(e.Name)}
			return
		}
		if e.Kind == exChoice || e.Kind == exRanked {
			for i, child := range e.Items {
				for state, w := range visit(child) {
					if w != nil {
						v := *w
						v.key = captureJoin(captureLeaf(i), w.key)
						capturePick(&out, state, &v)
					}
				}
			}
			return
		}
		if e.Kind == exSeq || e.Kind == exAnd {
			if e.Kind == exSeq {
				out[0] = &captureWitness{}
			}
			for i, child := range e.Items {
				part := visit(child)
				var next [4]*captureWitness
				if e.Kind == exAnd {
					next = out
					for state, w := range part {
						if w != nil {
							v := *w
							v.mask = 1 << i
							v.key = captureJoin(captureLeaf(v.mask), w.key)
							capturePick(&next, state, &v)
						}
					}
				}
				for a, x := range out {
					if x == nil {
						continue
					}
					for b, y := range part {
						if y == nil || a&b != 0 || a&2 != 0 && b&1 != 0 {
							continue
						}
						v := &captureWitness{count: x.count + y.count, names: captureJoin(x.names, y.names), key: captureJoin(x.key, y.key)}
						if e.Kind == exAnd {
							v.mask = x.mask | 1<<i
							var old *captureRope[int]
							if x.key.leaf {
								old = nil
							} else {
								old = x.key.right
							}
							v.key = captureJoin(captureLeaf(v.mask), captureJoin(old, y.key))
						}
						capturePick(&next, a|b, v)
					}
				}
				out = next
			}
			return
		}
		if e.Kind == exOptional && !e.Elidable {
			out[0] = &captureWitness{key: captureLeaf(0)}
			for state, w := range visit(e.Inner) {
				if w != nil {
					v := *w
					v.key = captureJoin(captureLeaf(1), w.key)
					capturePick(&out, state, &v)
				}
			}
			return
		}
		if e.Kind == exTest {
			return visit(e.Inner)
		}
		out[0] = &captureWitness{}
		return
	}
	states := visit(e)
	state := 0
	if len(order) > 0 {
		state = 3
	}
	w := states[state]
	if w != nil && w.count == need {
		w.present = map[string]bool{"": true}
		for _, name := range captureFlat(w.names) {
			w.present[name] = true
		}
		return w
	}
	return nil
}
func variableCaptureExpr(root *domExpr) bool {
	type summary struct{ has, variable bool }
	type task struct {
		e     *domExpr
		ready bool
	}
	pending := []task{{root, false}}
	var done []summary
	for len(pending) > 0 {
		t := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		e := t.e
		var kids []*domExpr
		if e != nil {
			switch e.Kind {
			case exSeq, exChoice, exRanked, exAnd:
				kids = e.Items
			case exOptional:
				if !e.Elidable {
					kids = []*domExpr{e.Inner}
				}
			case exTest:
				kids = []*domExpr{e.Inner}
			}
		}
		if !t.ready {
			pending = append(pending, task{e, true})
			for i := len(kids) - 1; i >= 0; i-- {
				pending = append(pending, task{kids[i], false})
			}
			continue
		}
		v := summary{has: e != nil && e.Kind == exCapture}
		for _, s := range done[len(done)-len(kids):] {
			v.has = v.has || s.has
			v.variable = v.variable || s.variable
		}
		done = done[:len(done)-len(kids)]
		if e != nil && v.has && (e.Kind == exOptional || len(kids) > 1 && (e.Kind == exChoice || e.Kind == exRanked || e.Kind == exAnd)) {
			v.variable = true
		}
		done = append(done, v)
	}
	return done[0].variable
}

// Independent choices have fixed capture lists in each branch. They need
// no search over combinations of unrelated presence guards.
func independentCaptureChoices(root *domExpr) ([]map[string]int, bool) {
	branches := []*domExpr{root}
	var out []map[string]int
	seen := map[string]bool{}
	for len(branches) > 0 {
		expr := branches[len(branches)-1]
		branches = branches[:len(branches)-1]
		if w := work.Load(); w != nil {
			w.readerSteps.add("reader steps")
		}
		if expr != nil {
			if expr.Kind == exChoice || expr.Kind == exRanked {
				for i := len(expr.Items) - 1; i >= 0; i-- {
					branches = append(branches, expr.Items[i])
				}
				continue
			}
			if expr.Kind == exTest {
				branches = append(branches, expr.Inner)
				continue
			}
		}
		if variableCaptureExpr(expr) {
			return nil, false
		}
		caps := map[string]int{"": -1}
		var names []string
		pending := []*domExpr{expr}
		for len(pending) > 0 {
			node := pending[len(pending)-1]
			pending = pending[:len(pending)-1]
			if w := work.Load(); w != nil {
				w.readerSteps.add("reader steps")
			}
			if node == nil {
				continue
			}
			switch node.Kind {
			case exCapture:
				caps[node.Name] = len(caps) - 1
				names = append(names, node.Name)
			case exSeq:
				for i := len(node.Items) - 1; i >= 0; i-- {
					pending = append(pending, node.Items[i])
				}
			case exChoice, exRanked, exAnd:
				pending = append(pending, node.Items[0])
			case exTest:
				pending = append(pending, node.Inner)
			}
		}
		key := strings.Join(names, "\x00")
		if !seen[key] {
			seen[key] = true
			out = append(out, caps)
		}
	}
	return out, true
}
func validationCaptures(r *domRule, a *domAlt) []map[string]int {
	if captures, ok := independentCaptureChoices(a.Expr); ok {
		return captures
	}
	var witnesses []*captureWitness
	ask := func(required, forbidden, order []string) {
		yes, no := map[string]bool{}, map[string]bool{}
		for _, n := range required {
			yes[n] = true
		}
		for _, n := range forbidden {
			no[n] = true
		}
		if w := captureQuery(a.Expr, yes, no, order); w != nil {
			witnesses = append(witnesses, w)
		}
	}
	initial := captureQuery(a.Expr, nil, nil, nil)
	if initial != nil {
		witnesses = append(witnesses, initial)
	}
	var items []*domEmitItem
	if r.Emit != nil {
		items = r.Emit.Items
	}
	mentioned := map[string]bool{}
	for _, t := range []*domTerm{r.Tags, r.Value, r.Image} {
		termMentions(t, mentioned)
	}
	for _, c := range r.Conditions {
		condMentions(c, mentioned)
	}
	for _, v := range r.Alternatives {
		for _, t := range []*domTerm{v.Tags, v.Value, v.Image} {
			termMentions(t, mentioned)
		}
	}
	for _, it := range items {
		if !it.IsInsert {
			mentioned[it.Capture] = true
			for _, n := range it.attachments() {
				mentioned[n] = true
			}
		}
		for _, t := range []*domTerm{it.Tags, it.Value, it.Image} {
			termMentions(t, mentioned)
		}
	}
	for n := range mentioned {
		ask([]string{n}, nil, nil)
	}
	var clause func(clausePart, []string)
	clause = func(p clausePart, carrier []string) {
		if p.t == nil && p.c == nil {
			return
		}
		var refs []*domTerm
		if p.t != nil {
			refs = constRefs(p.t)
		} else {
			refs = constRefs(p.c)
		}
		for _, ref := range refs {
			if ref.value == nil {
				return
			}
		}
		if p.t != nil && p.t.Kind == tmUnion {
			for _, term := range p.t.Items {
				clause(clausePart{t: term}, carrier)
			}
			return
		}
		fixed := fixedClauseParts(p)
		var branch func(clausePart, []string, []string, *captureWitness)
		branch = func(part clausePart, yes, no []string, witness *captureWitness) {
			has := func(name string) truth {
				if name == "" {
					return alwaysTrue
				}
				for _, present := range yes {
					if name == present {
						return alwaysTrue
					}
				}
				for _, absent := range no {
					if name == absent {
						return alwaysFalse
					}
				}
				return open
			}
			var simple clausePart
			var guard string
			if part.c != nil {
				var value truth
				simple.c, value, guard = simplifyCondPartial(part.c, has, fixed)
				if value == alwaysTrue {
					return
				}
			} else {
				simple.t, guard = simplifyTermPartial(part.t, has, fixed)
			}
			extend := func(required, forbidden []string) *captureWitness {
				names := witness.present
				matches := true
				for _, name := range required {
					if !names[name] {
						matches = false
						break
					}
				}
				if matches {
					for _, name := range forbidden {
						if names[name] {
							matches = false
							break
						}
					}
				}
				if matches {
					return witness
				}
				req, absent := map[string]bool{}, map[string]bool{}
				for _, name := range required {
					req[name] = true
				}
				for _, name := range forbidden {
					absent[name] = true
				}
				return captureQuery(a.Expr, req, absent, nil)
			}
			if guard != "" {
				absent := append(append([]string{}, no...), guard)
				present := append(append([]string{}, yes...), guard)
				if found := extend(yes, absent); found != nil {
					branch(simple, yes, absent, found)
				}
				if found := extend(present, no); found != nil {
					branch(simple, present, no, found)
				}
				return
			}
			used := map[string]bool{}
			if part.c != nil {
				condCaptures(simple.c, used)
				required := append(append([]string{}, carrier...), yes...)
				for name := range used {
					required = append(required, name)
				}
				if found := extend(required, no); found != nil {
					witnesses = append(witnesses, found)
				}
			} else {
				termCaptures(simple.t, used)
				for name := range used {
					if found := extend(append(append([]string{}, carrier...), yes...), append(append([]string{}, no...), name)); found != nil {
						witnesses = append(witnesses, found)
					}
				}
			}
		}
		if initial != nil {
			branch(p, nil, nil, initial)
		}
	}
	for _, c := range r.Conditions {
		clause(clausePart{c: c}, nil)
	}
	for _, t := range []*domTerm{r.Tags, a.Tags} {
		clause(clausePart{t: t}, nil)
	}
	for _, t := range effectiveRecipes(r, a) {
		used := map[string]bool{}
		termCaptures(t, used)
		for n := range used {
			ask(nil, []string{n}, nil)
		}
	}
	var carriers []string
	always := false
	type writtenCapture struct{ name, carrier string }
	var written []writtenCapture
	for _, it := range items {
		var carrier []string
		if it.IsInsert {
			always = true
		} else {
			carrier = []string{it.Capture}
			carriers = append(carriers, it.Capture)
			always = always || it.Capture == ""
			for _, n := range it.attachments() {
				ask([]string{n}, carrier, nil)
			}
			ask(nil, carrier, nil)
		}
		for _, t := range []*domTerm{it.Value, it.Image} {
			used := map[string]bool{}
			termCaptures(t, used)
			for n := range used {
				ask(carrier, []string{n}, nil)
			}
		}
		clause(clausePart{t: it.Tags}, carrier)
		if !it.IsInsert && it.Capture != "" {
			for _, n := range it.captures() {
				written = append(written, writtenCapture{n, it.Capture})
			}
		}
	}
	if len(items) > 0 && !always {
		ask(nil, carriers, nil)
	}
	for i, x := range written {
		for _, y := range written[i+1:] {
			if x.name != y.name {
				ask([]string{x.name, x.carrier, y.name, y.carrier}, nil, []string{y.name, x.name})
			}
		}
	}
	sort.SliceStable(witnesses, func(i, j int) bool { return captureBefore(witnesses[i], witnesses[j]) })
	var out []map[string]int
	seen := map[string]bool{}
	for _, w := range witnesses {
		names := captureFlat(w.names)
		key := strings.Join(names, "\x00")
		if seen[key] {
			continue
		}
		seen[key] = true
		caps := map[string]int{"": -1}
		for i, n := range names {
			caps[n] = i
		}
		out = append(out, caps)
	}
	return out
}
