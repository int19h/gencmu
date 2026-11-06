package gencmu

// nullableError checks the structural width after stitching (engine §3.6).
// Gates remain present, and conditions and tests cannot prove positive width.
func (g *stageGrammar) nullableError() *Error {
	type site struct {
		rule *sRule
		expr *domExpr
	}
	type node struct {
		all, nullable bool
		remaining     int
		users         []int
	}
	type errorSite struct {
		rule *sRule
		alt  *sAlt
		root int
	}
	var nodes []node
	var pending []site
	seen := map[site]int{}
	step := func() {
		if w := work.Load(); w != nil {
			w.ruleSetSteps.add("rule-set steps")
		}
	}
	intern := func(s site) int {
		step()
		if known, ok := seen[s]; ok {
			return known
		}
		index := len(nodes)
		seen[s] = index
		nodes = append(nodes, node{})
		pending = append(pending, s)
		return index
	}
	var errors []errorSite
	for _, rule := range g.rules {
		for _, alt := range rule.alts {
			step()
			if alt.error != nil {
				errors = append(errors, errorSite{rule, alt, intern(site{expr: alt.alt.Expr})})
			}
		}
	}
	for index := 0; index < len(pending); index++ {
		step()
		s := pending[index]
		var children []site
		all := false
		if s.rule != nil {
			for _, alt := range s.rule.alts {
				children = append(children, site{expr: alt.alt.Expr})
			}
		} else if expr := s.expr; expr != nil {
			switch expr.Kind {
			case exEmpty, exOptional:
				all = true
			case exSeq:
				all = true
				for _, child := range expr.Items {
					children = append(children, site{expr: child})
				}
			case exChoice, exRanked, exAnd:
				for _, child := range expr.Items {
					children = append(children, site{expr: child})
				}
			case exCapture, exTest, exSplice, exRepeat:
				children = append(children, site{expr: expr.Inner})
			case exRef:
				if rule := g.byName[expr.Name]; rule != nil {
					children = append(children, site{rule: rule})
				}
			}
		}
		nodes[index].all, nodes[index].remaining = all, len(children)
		for _, child := range children {
			childIndex := intern(child)
			nodes[childIndex].users = append(nodes[childIndex].users, index)
		}
	}
	var ready []int
	for i := range nodes {
		step()
		if nodes[i].all && nodes[i].remaining == 0 {
			nodes[i].nullable = true
			ready = append(ready, i)
		}
	}
	for index := 0; index < len(ready); index++ {
		for _, user := range nodes[ready[index]].users {
			step()
			if nodes[user].nullable {
				continue
			}
			nodes[user].remaining--
			if !nodes[user].all || nodes[user].remaining == 0 {
				nodes[user].nullable = true
				ready = append(ready, user)
			}
		}
	}
	for _, error := range errors {
		if nodes[error.root].nullable {
			fault := grammarError(error.alt.doc, error.alt.at, "an error production of %s can match no tokens", error.rule.name)
			fault.Stage = g.name
			return fault
		}
	}
	return nil
}
