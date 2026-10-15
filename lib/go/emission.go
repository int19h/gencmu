package gencmu

import "strings"

// occurrence distinguishes uses of a shared derivation node. Recipes use
// occurrence identity, not production numbers or spans (engine §11.3).
type occurrence struct {
	d       *dn
	kids    []*occurrence
	strings [2]*stringParts
	ready   [2]bool
	active  [2]bool
	recipes map[*domTerm]*stringParts
}

type stringEmitter struct {
	run       *stageRun
	rec       *recognizer
	claims    map[[2]int][][2]int
	inherited map[int]bool
}

func occurrenceTree(d *dn) *occurrence {
	root := &occurrence{d: d}
	stack := []*occurrence{root}
	for len(stack) > 0 {
		o := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if o.d.kind != dClose {
			continue
		}
		for _, kid := range flattenKids(o.d.a) {
			child := &occurrence{d: kid}
			o.kids = append(o.kids, child)
			stack = append(stack, child)
		}
	}
	return root
}

func (em *stringEmitter) span(o *occurrence) (int, int, *tagset) { return em.run.kidSpan(em.rec, o.d) }

func (em *stringEmitter) capture(o *occurrence, name string) *occurrence {
	if name == "" {
		return o
	}
	if w := work.Load(); w != nil {
		w.emitSteps.add("emit steps")
	}
	if o.d.kind == dClose {
		if pos, ok := o.d.prod.posOf[name]; ok {
			return o.kids[pos]
		}
	}
	panic(&parseFailure{message: "a recipe reads an absent capture $" + name})
}

// channel runs the string walk without executing emission items. Its
// frames preserve left-to-right dependency evaluation without recursion.
func (em *stringEmitter) channel(root *occurrence, channel int) string {
	type frame struct {
		o       *occurrence
		channel int
		recipe  *domTerm
		started bool
		next    int
		pieces  []*stringParts
	}
	stack := []*frame{{o: root, channel: channel}}
	var result *stringParts
	pushChannel := func(o *occurrence, c int) { stack = append(stack, &frame{o: o, channel: c}) }
	pushRecipe := func(o *occurrence, t *domTerm) { stack = append(stack, &frame{o: o, recipe: t}) }
	for len(stack) > 0 {
		f := stack[len(stack)-1]
		finish := func(value *stringParts) {
			if f.recipe != nil {
				if f.o.recipes == nil {
					f.o.recipes = map[*domTerm]*stringParts{}
				}
				f.o.recipes[f.recipe] = value
			} else {
				f.o.strings[f.channel] = value
				f.o.ready[f.channel] = true
				f.o.active[f.channel] = false
			}
			result = value
			stack = stack[:len(stack)-1]
		}
		if f.started {
			f.pieces = append(f.pieces, result)
		}
		if !f.started {
			if f.recipe != nil {
				if value, ok := f.o.recipes[f.recipe]; ok {
					finish(value)
					continue
				}
			} else {
				if f.o.ready[f.channel] {
					finish(f.o.strings[f.channel])
					continue
				}
				if f.o.active[f.channel] {
					panic(&parseFailure{message: "cyclic string recipe dependency"})
				}
				f.o.active[f.channel] = true
				d := f.o.d
				if d.kind == dRead {
					token := em.run.toks[em.rec.base+int(d.tok)]
					value := token.Value
					if f.channel == 1 {
						value = token.Image
					}
					finish(literalParts(value))
					continue
				}
				if d.kind != dClose || d.prod.nothing {
					finish(literalParts(""))
					continue
				}
				recipe := d.prod.value
				if f.channel == 1 && d.prod.image != nil {
					recipe = d.prod.image
				}
				if recipe != nil {
					f.started = true
					f.next = -1
					pushRecipe(f.o, recipe)
					continue
				}
			}
			f.started = true
		}
		if f.recipe == nil {
			if f.next == -1 || f.next == len(f.o.kids) {
				finish(concatParts(f.pieces))
				continue
			}
			child := f.o.kids[f.next]
			f.next++
			pushChannel(child, f.channel)
			continue
		}
		if f.next == len(f.recipe.Items) {
			finish(concatParts(f.pieces))
			continue
		}
		atom := f.recipe.Items[f.next]
		f.next++
		if stringTermShape(atom) {
			v, err := em.rec.g.stage.evaluateClosed("", atom, [2]int{})
			if err != nil {
				panic(&parseFailure{message: err.Message})
			}
			result = literalParts(v.s)
			continue
		}
		receiver := atom.Items[0]
		if receiver.Kind == tmCall {
			part := em.capture(f.o, receiver.Items[0].Str)
			c := 0
			if atom.Str == "image" {
				c = 1
			}
			pushChannel(part, c)
			continue
		}
		part := em.capture(f.o, receiver.Str)
		a, b, _ := em.span(part)
		s := spanVal{a: a, b: b}
		switch atom.Str {
		case "value":
			result = literalParts(em.run.spanValue(s))
		case "image":
			result = literalParts(em.run.spanImage(s))
		case "source-text":
			result = literalParts(em.run.spanText(s))
		case "decomposed-source-text":
			result = literalParts(em.run.ps.uni.decompose(em.run.spanText(s)))
		case "verbatim-text":
			result = literalParts(em.verbatim(a, b))
		}
	}
	return partsText(result)
}

func (em *stringEmitter) recipe(o *occurrence, recipe *domTerm) string {
	var result strings.Builder
	for _, atom := range recipe.Items {
		if stringTermShape(atom) {
			v, err := em.rec.g.stage.evaluateClosed("", atom, [2]int{})
			if err != nil {
				panic(&parseFailure{message: err.Message})
			}
			result.WriteString(v.s)
			continue
		}
		r := atom.Items[0]
		if r.Kind == tmCall {
			c := 0
			if atom.Str == "image" {
				c = 1
			}
			result.WriteString(em.channel(em.capture(o, r.Items[0].Str), c))
			continue
		}
		part := em.capture(o, r.Str)
		a, b, _ := em.span(part)
		s := spanVal{a: a, b: b}
		switch atom.Str {
		case "value":
			result.WriteString(em.run.spanValue(s))
		case "image":
			result.WriteString(em.run.spanImage(s))
		case "source-text":
			result.WriteString(em.run.spanText(s))
		case "decomposed-source-text":
			result.WriteString(em.run.ps.uni.decompose(em.run.spanText(s)))
		case "verbatim-text":
			result.WriteString(em.verbatim(a, b))
		}
	}
	return result.String()
}

func (em *stringEmitter) verbatim(a, b int) string {
	if a == b {
		return ""
	}
	source := em.run.spanSource(a, b)
	l, r := source[0], source[1]
	p, q := 0, len(em.run.ps.text)
	if a > 0 {
		p = em.run.toks[a-1].Source[1]
	}
	if b < len(em.run.toks) {
		q = em.run.toks[b].Source[0]
	}
	covered := func(at int) bool {
		for _, t := range em.run.toks {
			if t.Source[0] <= at && at < t.Source[1] {
				return true
			}
		}
		return false
	}
	for p < l && !covered(l-1) {
		l--
	}
	for r < q && !covered(r) {
		r++
	}
	span := [2]int{a, b}
	if _, exists := em.claims[span]; !exists {
		var claims [][2]int
		if l < source[0] {
			claims = append(claims, [2]int{l, source[0]})
		}
		if source[1] < r {
			claims = append(claims, [2]int{source[1], r})
		}
		for other, intervals := range em.claims {
			if other == span {
				continue
			}
			for _, x := range intervals {
				for _, y := range claims {
					if x[0] < y[1] && y[0] < x[1] {
						panic(&parseFailure{message: "different verbatim spans claim the same source gap"})
					}
				}
			}
		}
		em.claims[span] = claims
	}
	return string(em.run.ps.text[l:r])
}

func hasAttachments(t *Token) bool { return len(t.Before)+len(t.After) > 0 }
func attached(tokens []Token) []Token {
	for i := range tokens {
		tokens[i].Span = [2]int{}
	}
	return tokens
}

func (run *stageRun) kidSpan(rec *recognizer, k *dn) (int, int, *tagset) {
	if k.kind == dRead {
		i := rec.base + int(k.tok)
		return i, i + 1, run.tagsets[i]
	}
	return rec.base + int(k.start), rec.base + int(k.end), k.tags
}

func (em *stringEmitter) ownership(o *occurrence) int {
	count, attached := 0, -1
	stack := []*occurrence{o}
	for len(stack) > 0 {
		part := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if part.d.kind == dRead {
			count++
			i := em.rec.base + int(part.d.tok)
			if hasAttachments(&em.run.toks[i]) {
				attached = i
			}
			continue
		}
		if part.d.kind == dClose && part.d.prod.nothing {
			continue
		}
		stack = append(stack, part.kids...)
	}
	if attached >= 0 && count > 1 {
		panic(&parseFailure{message: "a covering token combines an attached token with another counted token"})
	}
	return attached
}

func (run *stageRun) emit(rec *recognizer, d *dn) []Token {
	em := &stringEmitter{run: run, rec: rec, claims: map[[2]int][][2]int{}, inherited: map[int]bool{}}
	root := occurrenceTree(d)
	type frame struct {
		o             *occurrence
		next          int
		items         []*domEmitItem
		item          int
		phase         int
		token         Token
		before, after []Token
		attachments   []*occurrence
		attachment    int
		into          *[]Token
		following     []int
	}
	output := []Token{}
	newOutput := func() *[]Token { list := []Token{}; return &list }
	stack := []*frame{{o: root, into: &output}}
	var result []Token
	for len(stack) > 0 {
		f := stack[len(stack)-1]
		if f.o.d.kind != dClose || f.o.d.prod.nothing {
			result = []Token{}
			stack = stack[:len(stack)-1]
			continue
		}
		p := f.o.d.prod
		if p.emit == nil {

			if f.next == len(f.o.kids) {
				result = *f.into
				stack = stack[:len(stack)-1]
				continue
			}
			child := f.o.kids[f.next]
			f.next++
			stack = append(stack, &frame{o: child, into: f.into})
			continue
		}
		if f.item == len(p.emit.Items) {
			result = *f.into
			stack = stack[:len(stack)-1]
			continue
		}
		it := p.emit.Items[f.item]
		if f.following == nil {
			f.following = nextCaptureItems(p.emit.Items)
		}
		if f.phase == 0 {
			if w := work.Load(); w != nil {
				w.emitSteps.add("emit steps")
			}
			f.phase = 1
			f.attachments = nil
			f.attachment = 0
			f.before = nil
			f.after = nil
			for _, name := range it.Before {
				f.attachments = append(f.attachments, em.capture(f.o, name))
			}
		}
		if f.phase == 1 || f.phase == 3 {
			if f.attachment > 0 {
				if f.phase == 1 {
					f.before = append(f.before, attached(result)...)
				} else {
					f.after = append(f.after, attached(result)...)
				}
			}
			if f.attachment < len(f.attachments) {
				part := f.attachments[f.attachment]
				f.attachment++
				stack = append(stack, &frame{o: part, into: newOutput()})
				continue
			}
			if f.phase == 3 {
				f.token.Before = append(f.before, f.token.Before...)
				f.token.After = append(f.token.After[:len(f.token.After):len(f.token.After)], f.after...)
				*f.into = append(*f.into, f.token)
				f.item++
				f.phase = 0
				continue
			}
			f.phase = 2
		}
		if f.phase == 2 {
			part := f.o
			if !it.IsInsert && it.Capture != "" {
				part = em.capture(f.o, it.Capture)
			}
			a, b, own := em.span(part)
			src := run.spanSource(a, b)
			if it.IsInsert {
				a = rec.base + int(f.o.d.end)
				b = a
				anchored := false
				if nextIndex := f.following[f.item]; nextIndex >= 0 {
					next := p.emit.Items[nextIndex]
					anchor := f.o
					if next.Capture != "" {
						name := next.Capture
						if len(next.Before) > 0 {
							name = next.Before[0]
						}
						anchor = em.capture(f.o, name)
					}
					anchorStart, anchorEnd, _ := em.span(anchor)
					a, b = anchorStart, anchorStart
					anchorSource := run.spanSource(anchorStart, anchorEnd)
					src = [2]int{anchorSource[0], anchorSource[0]}
					anchored = true
				}
				if !anchored {
					point := src[0]
					if a > rec.base+int(f.o.d.start) {
						point = run.toks[a-1].Source[1]
					}
					src = [2]int{point, point}
				}
				own = run.ps.in.empty()
			}
			if it.Tags != nil {
				ev := run.evaluator(rec.g, func(name string) (spanVal, bool) {
					o := em.capture(f.o, name)
					x, y, tags := em.span(o)
					return spanVal{a: x, b: y, whole: true, tags: tags, machine: rec.machine, structure: rec.derivationStructure(o.d), arena: rec.closes, closes: rec.derivationCloses(o.d)}, true
				})
				own = toSet(run.evaluate(ev, it.Tags))
			}
			token := Token{Text: string(run.ps.text[src[0]:src[1]]), Tags: run.implied(own).list(), Span: [2]int{a, b}, Source: src}
			if it.IsInsert {
				token.InsertedBy = p.ruleName
			}
			if it.Value != nil {
				token.Value = em.recipe(f.o, it.Value)
			} else if !it.IsInsert {
				token.Value = em.channel(part, 0)
			}
			if it.Image != nil {
				token.Image = em.recipe(f.o, it.Image)
			} else if it.Value != nil {
				token.Image = token.Value
			} else if !it.IsInsert {
				token.Image = em.channel(part, 1)
			}
			if !it.IsInsert {
				if index := em.ownership(part); index >= 0 {
					if em.inherited[index] {
						panic(&parseFailure{message: "two emitted tokens inherit the same attachments"})
					}
					em.inherited[index] = true
					source := run.toks[index]
					token.Before = source.Before[:len(source.Before):len(source.Before)]
					token.After = source.After[:len(source.After):len(source.After)]
				}
			}
			f.token = token
			f.phase = 3
			f.attachments = nil
			f.attachment = 0
			for _, name := range it.After {
				f.attachments = append(f.attachments, em.capture(f.o, name))
			}
		}
	}
	return result
}
