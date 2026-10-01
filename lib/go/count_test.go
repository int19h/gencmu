package gencmu

import (
	"math"
	"math/big"
	"testing"
)

// A count stays exact across the int64 boundary (engine §6).
func TestCountExact(t *testing.T) {
	big62 := countOf(1 << 62)
	sum := big62.add(big62) // 2^63, which no int64 holds
	if sum.big == nil || sum.cmp(countOf(math.MaxInt64)) != 1 || sum.cmp(sum.add(countOne)) != -1 {
		t.Fatalf("2^63 is %+v", sum)
	}
	if back := sum.sub(big62); back.big != nil || back.n != 1<<62 {
		t.Fatalf("2^63 - 2^62 is %+v", back)
	}
	if inf.add(sum).cmp(inf) != 0 || inf.cmp(sum) != 1 || pastInf.cmp(inf) != 1 {
		t.Fatal("the marks do not stand above every number")
	}
}

// Runs of 2^32, 2^53, 2^60, 2^64 and 2^100 elisions at one position compare
// exactly, with each other and with runs that differ from them by one. Each
// run is built apart, as two chains of rules build them, so that no node is
// shared and the comparison must take runs whole (engine §6).
func TestCompareElisionRuns(t *testing.T) {
	// run is 2^k elisions at a position, built from a leaf of its own.
	run := func(at int32, k int) *elSeq {
		s := &elSeq{first: at, last: at, size: countOne}
		for i := 0; i < k; i++ {
			s = concatElisions(s, s)
		}
		return s
	}
	leaf := func(at int32) *elSeq { return &elSeq{first: at, last: at, size: countOne} }
	for _, k := range []int{32, 53, 60, 64, 100} {
		for _, tc := range []struct {
			name string
			a, b *elSeq
			want int
		}{
			{"equal", run(0, k), run(0, k), 0},
			{"one more", concatElisions(run(0, k), leaf(0)), run(0, k), 1},
			{"one more in front", run(0, k), concatElisions(leaf(0), run(0, k)), -1},
			{"one more apart", concatElisions(leaf(0), run(0, k)), concatElisions(run(0, k), leaf(0)), 0},
			{"one fewer", run(0, k), concatElisions(run(0, k-1), concatElisions(run(0, k-1), leaf(0))), -1},
			{"the next position", concatElisions(run(0, k), leaf(1)), concatElisions(run(0, k), leaf(2)), 1},
			{"one more, then less later", concatElisions(concatElisions(run(0, k), leaf(0)), run(3, k)), concatElisions(run(0, k), run(1, 1)), 1},
			{"a later run of the same size", run(1, k), run(0, k), -1},
			{"against one elision earlier", run(1, k), leaf(0), -1},
			{"against one elision there", run(0, k), leaf(0), 1},
			{"against nothing", run(0, k), nil, 1},
		} {
			got := compareElisions(tc.a, tc.b)
			if got != tc.want {
				t.Errorf("2^%d, %s: got %d, want %d", k, tc.name, got, tc.want)
			}
			if back := compareElisions(tc.b, tc.a); back != -tc.want {
				t.Errorf("2^%d, %s, reversed: got %d, want %d", k, tc.name, back, -tc.want)
			}
		}
		want := new(big.Int).Lsh(big.NewInt(1), uint(k))
		if s := run(0, k).size; s.bigValue().Cmp(want) != 0 {
			t.Errorf("2^%d: the size is %v", k, s.bigValue())
		}
	}
}
