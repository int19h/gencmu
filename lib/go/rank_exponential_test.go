package gencmu

import (
	"fmt"
	"strings"
	"testing"
)

// doublingGrammar adds the rules r0 → [+T], with T elidable, and
// rN → rN-1 rN-1 up to rn, and the same chain of q from q0 when qChain is
// set, so that rn and qn each elide 2^n terminators at boundary 0 of the
// empty input, in two chains that share no node.
func doublingGrammar(rule string, n int, qChain bool, text string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "%%ambiguity-resolution %s\n", rule)
	for _, chain := range []string{"r", "q"} {
		if chain == "q" && !qChain {
			break
		}
		fmt.Fprintf(&b, "%%rule %s0 [+T]\n", chain)
		for i := 1; i <= n; i++ {
			fmt.Fprintf(&b, "%%rule %s%d %s%d %s%d\n", chain, i, chain, i-1, chain, i-1)
		}
	}
	b.WriteString(strings.ReplaceAll(text, "N", fmt.Sprint(n)))
	return b.String()
}

// rankEmpty ranks the derivations of the empty input of a one-stage grammar.
// It does not build the readings, which can have exponentially many nodes.
func rankEmpty(t *testing.T, grammar string) *rankResult {
	t.Helper()
	d := mustLoad(t, oneStage(grammar))
	lg := d.lower(0, map[string]bool{})
	ps := newParseState(d.uni, nil)
	rec := ps.newRun("main", d.stages[0], nil).recognize(lg, lg.byName["text"], 0, 0)
	return newRanker(rec, lg.lean, nil).rank(rec.accepted(lg.byName["text"]))
}

// The ranking stays exact and polynomial where a derivation of the empty
// input has exponentially many actions and elisions (engine §6). Counts of
// 2^n do not wrap, and two runs of 2^n elisions built apart compare whole.
func TestRankExponential(t *testing.T) {
	for _, n := range []int{31, 32, 64, 100} {
		// Under greedy, the second reading is the tied derivation that
		// diverges first, through w, and not the one through y, which
		// diverges after 2^n visible actions.
		res := rankEmpty(t, doublingGrammar("greedy", n, false, "%rule text rN x | rN y | w rN x\n%rule x ε\n%rule y ε\n%rule w ε\n"))
		if res.verdict != VerdictTie || res.witness[1].prod == nil || res.witness[1].prod.ruleName != "w" {
			t.Errorf("greedy, n = %d: %s, the witness closes %v", n, res.verdict, res.witness[1].prod)
		}
		for _, tc := range []struct{ text, verdict string }{
			{"%rule text rN | rN [+T]", VerdictResolved},
			{"%rule text rN [+T] | [+T] rN", VerdictTie},
			{"%rule text rN | qN", VerdictTie},
			{"%rule text rN | qN [+T]", VerdictResolved},
			{"%rule text qN [+T] | [+T] rN", VerdictTie},
		} {
			if res := rankEmpty(t, doublingGrammar("late-elision", n, true, tc.text)); res.verdict != tc.verdict {
				t.Errorf("late-elision, n = %d, %s: %s, want %s", n, tc.text, res.verdict, tc.verdict)
			}
		}
	}
}
