package gencmu

// ErasureReport classifies the effect of removing one written erasure.
type ErasureReport struct {
	Rule, Document            string
	Line, Column, Alternative int
	Kind                      string
	Effects                   []string
}

type IdleErasure struct{ Rule, Document string }

const (
	erasureRead uint8 = 1 << iota
	erasureEmit
	erasureDiagnostic
	erasureChoice
	erasureAll = erasureRead | erasureEmit | erasureDiagnostic | erasureChoice
)

func erasureAudit(g *stageGrammar) []ErasureReport {
	type observation struct {
		bits, mask uint8
		references map[string]bool
	}
	alternatives := map[*sAlt]observation{}
	effects := map[string]uint8{}
	type dependency struct {
		name string
		mask uint8
	}
	dependents := map[string][]dependency{}
	type emissionIndex struct {
		fixed    bool
		carriers map[string]bool
	}
	emissions := map[*domEmit]emissionIndex{}
	emits := func(emit *domEmit, captures map[string]bool) bool {
		if emit == nil {
			return false
		}
		index, known := emissions[emit]
		if !known {
			index.carriers = map[string]bool{}
			for _, item := range emit.Items {
				evidenceWork()
				if item.IsInsert || item.Capture == "" {
					index.fixed = true
				} else {
					index.carriers[item.Capture] = true
				}
			}
			emissions[emit] = index
		}
		if index.fixed {
			return true
		}
		for name := range captures {
			evidenceAuditClosure()
			if index.carriers[name] {
				return true
			}
		}
		return false
	}
	var pending []string
	add := func(name string, bits uint8) {
		if old := effects[name]; old|bits != old {
			effects[name] = old | bits
			pending = append(pending, name)
		}
	}
	for _, rule := range g.rules {
		if len(rule.alts) > 1 {
			add(rule.name, erasureChoice)
		}
		for _, alt := range rule.alts {
			evidenceAuditClosure()
			bits := uint8(0)
			if alt.error != nil || alt.warning != nil {
				bits |= erasureDiagnostic
			}
			captures, references := map[string]bool{}, map[string]bool{}
			walkQueryBody(alt.alt.Expr, func(node *domExpr) bool {
				switch node.Kind {
				case exRef:
					if g.byName[node.Name] != nil {
						references[node.Name] = true
					} else {
						bits |= erasureRead | erasureDiagnostic
					}
				case exLiteral, exRange, exWildcard:
					bits |= erasureRead | erasureDiagnostic
				case exOptional, exRepeat, exChoice, exRanked, exAnd:
					bits |= erasureChoice
				case exCapture:
					captures[node.Name] = true
				}
				return true
			}, nil)
			if emits(alt.emit, captures) {
				bits |= erasureEmit
			}
			mask := uint8(erasureAll)
			if alt.emit != nil {
				mask &^= erasureEmit
			}
			alternatives[alt] = observation{bits, mask, references}
			if alt.erased {
				continue
			}
			add(rule.name, bits)
			for name := range references {
				dependents[name] = append(dependents[name], dependency{rule.name, mask})
			}
		}
	}
	for cursor := 0; cursor < len(pending); cursor++ {
		name := pending[cursor]
		for _, user := range dependents[name] {
			evidenceAuditClosure()
			add(user.name, effects[name]&user.mask)
		}
	}
	result := []ErasureReport{}
	for _, rule := range g.rules {
		for index, alt := range rule.alts {
			if !alt.erased {
				continue
			}
			own := alternatives[alt]
			bits := own.bits
			if len(rule.alts) > 1 {
				bits |= erasureChoice
			}
			for name := range own.references {
				bits |= effects[name] & own.mask
			}
			names := []string{}
			for _, effect := range []struct {
				bit  uint8
				name string
			}{{erasureRead, "counted-parts"}, {erasureEmit, "emission"}, {erasureDiagnostic, "diagnostics"}, {erasureChoice, "derivation-choice"}} {
				if bits&effect.bit != 0 {
					names = append(names, effect.name)
				}
			}
			kind := "inert"
			if bits != 0 {
				kind = "semantic"
			}
			result = append(result, ErasureReport{rule.name, alt.doc, alt.at[0], alt.at[1], index, kind, names})
		}
	}
	return result
}
