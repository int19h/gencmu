package gencmu

import (
	"fmt"
	"strings"
	"testing"
)

func errorWidthGrammar(expr *domExpr) *stageGrammar {
	rule := &sRule{name: "text", alts: []*sAlt{{error: &domTerm{Kind: tmString, Str: "bad"}, alt: &domAlt{Expr: expr}, doc: "g.md", at: [2]int{2, 1}}}}
	return &stageGrammar{name: "main", rules: []*sRule{rule}, byName: map[string]*sRule{"text": rule}}
}

func TestDeferredNullableErrorsIgnoreGatesTestsAndConditions(t *testing.T) {
	// Engine §3.6: each structural empty expansion fails before feature gates.
	empty, token := &domExpr{Kind: exEmpty}, &domExpr{Kind: exRef, Name: "A"}
	for _, expr := range []*domExpr{
		empty, {Kind: exOptional, Inner: token}, {Kind: exSeq, Items: []*domExpr{empty, empty}},
		{Kind: exChoice, Items: []*domExpr{token, empty}}, {Kind: exRanked, Items: []*domExpr{token, empty}},
		{Kind: exAnd, Items: []*domExpr{token, empty}}, {Kind: exRepeat, Inner: empty},
		{Kind: exCapture, Name: "x", Inner: empty}, {Kind: exTest, Op: "=", Value: &domTerm{Kind: tmString, Str: "never"}, Inner: empty},
	} {
		g := errorWidthGrammar(expr)
		g.rules[0].alts[0].alt.Gates = []domGate{{Feature: "disabled", Kind: FeatureGate}}
		g.rules[0].alts[0].conds = []*domCond{{Kind: cdAny}}
		if err := g.nullableError(); err == nil || err.Stage != "main" || err.Document != "g.md" || err.Line != 2 || !strings.Contains(err.Message, "text can match no tokens") {
			t.Fatalf("%s: wrong width error: %v", expr.Kind, err)
		}
	}
	for _, expr := range []*domExpr{token, {Kind: exSeq, Items: []*domExpr{empty, token}}, {Kind: exRepeat, Inner: token}, {Kind: exChoice, Items: []*domExpr{token, token}}} {
		if err := errorWidthGrammar(expr).nullableError(); err != nil {
			t.Fatal("positive body rejected", err)
		}
	}
	// Engine §3.6: nullable warnings remain legal.
	g := errorWidthGrammar(empty)
	g.rules[0].alts[0].warning, g.rules[0].alts[0].error = g.rules[0].alts[0].error, nil
	if err := g.nullableError(); err != nil {
		t.Fatal(err)
	}
}

func TestDeferredNullableErrorsFollowFinalRulesAndSplices(t *testing.T) {
	// Engine §3.6: the final stitched rule supplies the splice's nullability.
	g := errorWidthGrammar(&domExpr{Kind: exSplice, Inner: &domExpr{Kind: exRef, Name: "other"}})
	other := &sRule{name: "other", alts: []*sAlt{{alt: &domAlt{Expr: &domExpr{Kind: exEmpty}}}}}
	g.rules, g.byName[other.name] = append(g.rules, other), other
	if g.nullableError() == nil {
		t.Fatal("nullable spliced rule was accepted")
	}
	other.alts[0].alt.Expr = &domExpr{Kind: exRef, Name: "A"}
	if err := g.nullableError(); err != nil {
		t.Fatal(err)
	}
	// Engine §3.6: a cycle alone has no finite empty derivation.
	other.alts[0].alt.Expr = &domExpr{Kind: exRef, Name: "other"}
	if err := g.nullableError(); err != nil {
		t.Fatal(err)
	}
}

func TestDeferredNullableErrorClosureCostsLinearWork(t *testing.T) {
	// Engine §3.6: nullability propagates once through each dependency.
	for _, size := range []int{50, 200} {
		g := errorWidthGrammar(&domExpr{Kind: exRef, Name: "r0"})
		for i := 0; i < size; i++ {
			expr := &domExpr{Kind: exRef, Name: fmt.Sprintf("r%d", i+1)}
			if i == size-1 {
				expr = &domExpr{Kind: exEmpty}
			}
			rule := &sRule{name: fmt.Sprintf("r%d", i), alts: []*sAlt{{alt: &domAlt{Expr: expr}}}}
			g.rules, g.byName[rule.name] = append(g.rules, rule), rule
		}
		w := &workCounts{}
		var err *Error
		countWorkIn(w, func() { err = g.nullableError() })
		if err == nil {
			t.Fatal("missed nullable chain")
		}
		if count := w.ruleSetSteps.Load(); count > int64(20*size+40) {
			t.Fatal("nonlinear nullability", size, count)
		}
	}
}
