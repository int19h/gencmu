package gencmu

// Only channels that conditions read enter completed states (engine §4.1).
func (g *lowered) demandedStrings() map[int32]uint8 {
	if !g.stage.conditionStrings {
		return nil
	}
	g.stringsOnce.Do(func() { g.stringDemands = g.stringReach() })
	return g.stringDemands
}

func (g *lowered) stringReach() map[int32]uint8 {
	bindings := map[*sAlt]map[string][]int32{}
	for _, p := range g.prods {
		if bindings[p.sourceAlternative] == nil {
			bindings[p.sourceAlternative] = map[string][]int32{}
		}
		for name, position := range p.posOf {
			if !p.rhs[position].term {
				bindings[p.sourceAlternative][name] = append(bindings[p.sourceAlternative][name], p.rhs[position].id)
			}
		}
	}
	demands := map[int32]uint8{}
	changed := false
	add := func(p *production, channel int) {
		id := int32(p.num)
		bit := uint8(1 << channel)
		if demands[id]&bit == 0 {
			demands[id] |= bit
			changed = true
		}
	}
	byRule := map[int32][]*production{}
	for _, p := range g.prods {
		byRule[p.lhs] = append(byRule[p.lhs], p)
	}
	child := func(rule int32, channel int) {
		for _, p := range byRule[rule] {
			add(p, channel)
		}
	}
	var cond func(*domCond, *production)
	var read func(*domTerm, *production, bool)
	read = func(t *domTerm, p *production, own bool) {
		if t == nil {
			return
		}
		if t.Kind == tmCall && (t.Str == "value" || t.Str == "image") && len(t.Items) == 1 && t.Items[0].Kind == tmCall && t.Items[0].Str == "emitted" {
			name := t.Items[0].Items[0].Str
			channel := 0
			if t.Str == "image" {
				channel = 1
			}
			if name == "" {
				if own || !p.helper {
					add(p, channel)
				} else {
					for _, root := range g.prods {
						if !root.helper && root.sourceAlternative == p.sourceAlternative {
							add(root, channel)
						}
					}
				}
			} else if position, ok := p.posOf[name]; ok && !p.rhs[position].term {
				child(p.rhs[position].id, channel)
			} else {
				for _, target := range bindings[p.sourceAlternative][name] {
					child(target, channel)
				}
			}

		}
		cond(t.Cond, p)
		for _, part := range t.Items {
			read(part, p, own)
		}
	}
	cond = func(c *domCond, p *production) {
		if c == nil {
			return
		}
		read(c.Left, p, false)
		read(c.Right, p, false)
		read(c.Span, p, false)
		cond(c.Inner, p)
		for _, part := range c.Items {
			cond(part, p)
		}
	}
	for _, p := range g.prods {
		for _, c := range p.conds {
			cond(c.cond, p)
		}
		for _, c := range p.rankedConditions {
			cond(c, p)
		}
		for _, c := range p.predictConds {
			cond(c, p)
		}
	}
	for changed = true; changed; {
		changed = false
		for _, p := range g.prods {
			for channel := 0; channel < 2; channel++ {
				if demands[int32(p.num)]&(1<<channel) == 0 || p.nothing {
					continue
				}
				recipe := p.value
				if channel == 1 && p.image != nil {
					recipe = p.image
				}
				if recipe != nil {
					read(recipe, p, true)
				} else {
					for _, s := range p.rhs {
						if !s.term {
							child(s.id, channel)
						}
					}
				}
			}
		}
	}
	return demands
}

func emittedStringReads(conditions []*domCond, recipe *domTerm) []*domTerm {
	var out []*domTerm
	var term func(*domTerm)
	var cond func(*domCond)
	term = func(t *domTerm) {
		if t == nil {
			return
		}
		if t.Kind == tmCall && (t.Str == "value" || t.Str == "image") && len(t.Items) == 1 && t.Items[0].Kind == tmCall && t.Items[0].Str == "emitted" {
			out = append(out, t)
			return
		}
		cond(t.Cond)
		for _, part := range t.Items {
			term(part)
		}
	}
	cond = func(c *domCond) {
		if c == nil {
			return
		}
		term(c.Left)
		term(c.Right)
		term(c.Span)
		cond(c.Inner)
		for _, part := range c.Items {
			cond(part)
		}
	}
	term(recipe)
	for _, c := range conditions {
		cond(c)
	}
	return out
}
func (g *stageGrammar) validateConditionStrings() *Error {
	type definition struct {
		rule     *sRule
		document string
		at       [2]int
	}
	definitions := map[definition]map[string]map[*sRule]bool{}
	bodies := map[*sAlt]map[*sRule]bool{}
	children := func(e *domExpr) []*domExpr {
		out := append([]*domExpr{}, e.Items...)
		if e.Inner != nil {
			out = append(out, e.Inner)
		}
		if e.Sep != nil {
			out = append(out, e.Sep)
		}
		return out
	}
	references := func(expr *domExpr) map[*sRule]bool {
		out := map[*sRule]bool{}
		pending := []*domExpr{expr}
		for len(pending) > 0 {
			e := pending[len(pending)-1]
			pending = pending[:len(pending)-1]
			if e.Kind == exRef && g.byName[e.Name] != nil {
				out[g.byName[e.Name]] = true
			}
			pending = append(pending, children(e)...)
		}
		return out
	}
	for _, rule := range g.rules {
		for _, alt := range rule.alts {
			bodies[alt] = references(alt.alt.Expr)
			key := definition{rule, alt.doc, alt.at}
			if definitions[key] == nil {
				definitions[key] = map[string]map[*sRule]bool{}
			}
			bindings := definitions[key]
			pending := []*domExpr{alt.alt.Expr}
			for len(pending) > 0 {
				e := pending[len(pending)-1]
				pending = pending[:len(pending)-1]
				if e.Kind == exCapture {
					if bindings[e.Name] == nil {
						bindings[e.Name] = map[*sRule]bool{}
					}
					for target := range references(e.Inner) {
						bindings[e.Name][target] = true
					}
				}
				pending = append(pending, children(e)...)
			}
		}
	}
	targets := func(rule *sRule, alt *sAlt, read *domTerm) map[*sRule]bool {
		capture := read.Items[0].Items[0].Str
		if capture == "" {
			return map[*sRule]bool{rule: true}
		}
		return definitions[definition{rule, alt.doc, alt.at}][capture]
	}
	type visit struct {
		rule  *sRule
		image bool
	}
	reachesVerbatim := func(rule *sRule, alt *sAlt, read *domTerm) bool {
		var pending []visit
		for target := range targets(rule, alt, read) {
			pending = append(pending, visit{target, read.Str == "image"})
		}
		seen := map[visit]bool{}
		for len(pending) > 0 {
			next := pending[len(pending)-1]
			pending = pending[:len(pending)-1]
			if seen[next] {
				continue
			}
			seen[next] = true
			for _, variant := range next.rule.alts {
				if variant.erased {
					continue
				}
				value, image := variant.alt.Value, variant.alt.Image
				if value == nil {
					value = variant.ruleValue
				}
				if image == nil {
					image = variant.ruleImage
				}
				recipe := value
				if next.image && image != nil {
					recipe = image
				}
				if recipe != nil {
					for _, atom := range recipe.Items {
						if atom.Kind == tmCall && atom.Str == "verbatim-text" {
							return true
						}
					}
					for _, atom := range emittedStringReads(nil, recipe) {
						for target := range targets(next.rule, variant, atom) {
							pending = append(pending, visit{target, atom.Str == "image"})
						}
					}
				} else {
					for target := range bodies[variant] {
						pending = append(pending, visit{target, next.image})
					}
				}
			}
		}
		return false
	}
	for _, rule := range g.rules {
		for _, alt := range rule.alts {
			for _, read := range emittedStringReads(alt.conds, nil) {
				if reachesVerbatim(rule, alt, read) {
					at := read.Items[0].At
					return &Error{Kind: "grammar", Message: "a condition walk cannot reach verbatim-text", Document: alt.doc, Line: at[0], Column: at[1], boundaryLocation: true}
				}
			}
		}
	}
	return nil
}

func withStringCapture(capture func(string) (spanVal, bool), read func(int) string) func(string) (spanVal, bool) {
	return func(name string) (spanVal, bool) {
		span, ok := capture(name)
		if name == "" {
			span.stringReader = read
		}
		return span, ok
	}
}

func (r *recognizer) tokenStrings(at int) [2]string {
	if r.recon != nil {
		if r.recon.synthetic[at] {
			return [2]string{r.recon.sounds[at], ""}
		}
		at = r.recon.original[at]
	} else {
		at += r.base
	}
	token := r.run.toks[at]
	return [2]string{token.Value, token.Image}
}

func (r *recognizer) finishStrings(key *itemKey, end int32) {
	r.finishStringsIn(key, end, nil)
}
func (r *recognizer) finishStringsIn(key *itemKey, end int32, enclosing func(string) (spanVal, bool)) {
	p := key.prod
	channels := r.g.demandedStrings()[int32(p.num)]
	if channels == 0 || int(key.dot) != len(p.rhs) {
		return
	}
	prefix := key.emitted
	var values [2]string
	var ready, active [2]bool
	var get func(int) string
	get = func(channel int) string {
		if ready[channel] {
			return values[channel]
		}
		if active[channel] {
			panic(&parseFailure{message: "cyclic string recipe dependency"})
		}
		active[channel] = true
		recipe := p.value
		if channel == 1 && p.image != nil {
			recipe = p.image
		}
		text := ""
		if p.restoration() {
			if channel == 0 {
				text = elidedValue(p.elidedTest)
				if r.recon != nil && int(key.origin) < len(r.recon.synthetic) && r.recon.synthetic[key.origin] && end > key.origin {
					text = r.recon.sounds[key.origin]
				}
			}
		} else if !p.nothing {
			if recipe == nil {
				text = prefix[channel]
			} else {
				capture := enclosing
				if capture == nil {
					capture = r.captureFunc(p, r.caps(key), key.origin, end, nil)
				}
				capture = withStringCapture(capture, get)
				ev := r.run.evaluator(r.g, capture)
				for _, atom := range recipe.Items {
					text += toStr(r.run.evaluate(ev, atom))
				}
			}
		}
		active[channel] = false
		ready[channel] = true
		values[channel] = text
		return text
	}
	for channel := 0; channel < 2; channel++ {
		if channels&(1<<channel) != 0 {
			get(channel)
		}
	}
	key.emitted = values
}

func (r *recognizer) conditionStrings(key itemKey, end int32) [2]string {
	p := key.prod
	if p.lexical == nil {
		return key.emitted
	}
	frame := p.lexical
	root := *frame.root
	root.lexical = nil
	values := frame.stringPrefix
	for channel := range values {
		values[channel] += key.emitted[channel]
	}
	parent := itemKey{prod: &root, dot: int32(len(root.rhs)), origin: frame.origin, emitted: values}
	capture := r.captureFunc(p, r.caps(&key), key.origin, end, nil)
	r.finishStringsIn(&parent, end, capture)
	return parent.emitted
}
