package gencmu

import (
	"strings"
	"testing"
)

func TestQueryHelperClassification(t *testing.T) {
	text := "%rule text $x:A %conditions $x.matches(Z | T | Z)"
	aux := "%rule aux ($q:A ≻ B) ::∅ %conditions $q.without-elision.matches(Q)"
	for name, grammar := range map[string]string{
		"text first": text + "\n" + aux,
		"aux first":  aux + "\n" + text,
	} {
		t.Run(name, func(t *testing.T) {
			d := mustLoad(t, oneStage("%ambiguity-resolution greedy\n"+grammar))
			g := lower(d.stages[0], map[string]bool{})
			count := 0
			for _, p := range g.prods {
				name := g.rules[p.lhs].name
				if !strings.HasPrefix(name, "\x00query:") {
					continue
				}
				count++
				if !p.helper {
					t.Errorf("%q production is not classified as a helper", name)
				}
				if !p.transparent {
					t.Errorf("%q production is not transparent", name)
				}
				if (action{prod: p}).visible() {
					t.Errorf("%q close is visible in canonical ranking", name)
				}
			}
			if count != 3 {
				t.Errorf("got %d query productions, want 3", count)
			}
		})
	}
}
