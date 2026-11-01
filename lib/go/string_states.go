package gencmu

// Only channels that conditions read enter completed states (engine §4.1).
func (g *lowered) demandedStrings() map[int32]uint8 {
	g.stringsOnce.Do(func() { g.stringDemands = g.stringReach(nil) })
	return g.stringDemands
}

type stringSeed struct {
	production *production
	term       *domTerm
}

func (g *lowered) stringReach(seed *stringSeed) map[int32]uint8 {
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
	add := func(rule int32, channel int) {
		bit := uint8(1 << channel)
		if demands[rule]&bit == 0 {
			demands[rule] |= bit
			changed = true
		}
	}
	var cond func(*domCond, *production)
	var read func(*domTerm, *production)
	read = func(t *domTerm, p *production) {
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
				add(p.lhs, channel)
				if root, ok := g.byName[p.ruleName]; ok {
					add(root, channel)
				}
			} else if position, ok := p.posOf[name]; ok && !p.rhs[position].term {
				add(p.rhs[position].id, channel)
			} else {
				for _, target := range bindings[p.sourceAlternative][name] {
					add(target, channel)
				}
			}
		}
		cond(t.Cond, p)
		for _, part := range t.Items {
			read(part, p)
		}
	}
	cond = func(c *domCond, p *production) {
		if c == nil {
			return
		}
		read(c.Left, p)
		read(c.Right, p)
		read(c.Span, p)
		cond(c.Inner, p)
		for _, part := range c.Items {
			cond(part, p)
		}
	}
	if seed != nil {
		read(seed.term, seed.production)
	} else {
		for _, p := range g.prods {
			for _, c := range p.conds {
				cond(c.cond, p)
			}
			for _, c := range p.rankedConditions {
				cond(c, p)
			}
			for _, c := range p.itemConds {
				cond(c, p)
			}
			for _, c := range p.predictConds {
				cond(c, p)
			}
		}
	}
	for changed = true; changed; {
		changed = false
		for _, p := range g.prods {
			for channel := 0; channel < 2; channel++ {
				if demands[p.lhs]&(1<<channel) == 0 || p.nothing {
					continue
				}
				recipe := p.value
				if channel == 1 && p.image != nil {
					recipe = p.image
				}
				if recipe != nil {
					read(recipe, p)
				} else {
					for _, s := range p.rhs {
						if !s.term {
							add(s.id, channel)
						}
					}
				}
			}
		}
	}
	return demands
}

func emittedStringReads(conditions []*domCond) []*domTerm {
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
	for _, c := range conditions {
		cond(c)
	}
	return out
}
func (g *stageGrammar) validateConditionStrings() *Error {
	hasReads := false
	for _, rule := range g.rules {
		for _, alt := range rule.alts {
			if len(emittedStringReads(alt.conds)) > 0 {
				hasReads = true
			}
		}
	}
	if !hasReads {
		return nil
	}
	lowered := lowerForSlots(g)
	for _, p := range lowered.prods {
		if p.helper || p.sourceAlternative == nil {
			continue
		}
		for _, read := range emittedStringReads(p.sourceAlternative.conds) {
			reach := lowered.stringReach(&stringSeed{p, read})
			for _, q := range lowered.prods {
				if q.nothing {
					continue
				}
				for channel := 0; channel < 2; channel++ {
					if reach[q.lhs]&(1<<channel) == 0 {
						continue
					}
					selected := q.value
					if channel == 1 && q.image != nil {
						selected = q.image
					}
					if selected == nil {
						continue
					}
					for _, atom := range selected.Items {
						if atom.Kind == tmCall && atom.Str == "verbatim-text" {
							at := read.Items[0].At
							return &Error{Kind: "grammar", Message: "a condition walk cannot reach verbatim-text", Document: p.doc, Line: at[0], Column: at[1], boundaryLocation: true}
						}
					}
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
	channels := r.g.demandedStrings()[p.lhs]
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
