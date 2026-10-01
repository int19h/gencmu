package gencmu

import (
	"math"
	"math/big"
)

// count is a whole number that the ranking keeps exact however large it
// grows: a number of actions, a position in a sequence of actions, or a
// number of elisions (engine §6). A derivation over an empty span can hold
// exponentially many of them, so a count is n while it fits in an int64,
// and big beyond that, never both.
//
// level puts two marks above every number. inf is the divergence of
// derivations that differ only in transparent actions, and pastInf is a
// bound above it.
type count struct {
	n     int64
	big   *big.Int
	level uint8
}

var (
	countOne = count{n: 1}
	inf      = count{level: 1}
	pastInf  = count{level: 2}
)

func countOf(n int64) count { return count{n: n} }

func (a count) isZero() bool { return a.level == 0 && a.big == nil && a.n == 0 }

func (a count) bigValue() *big.Int {
	if a.big != nil {
		return a.big
	}
	return big.NewInt(a.n)
}

// fromBig keeps a result small where it fits.
func fromBig(x *big.Int) count {
	if x.IsInt64() {
		return count{n: x.Int64()}
	}
	return count{big: x}
}

// add is a + b. A mark plus a number is the mark.
func (a count) add(b count) count {
	if a.level > 0 || b.level > 0 {
		return count{level: max(a.level, b.level)}
	}
	if a.big == nil && b.big == nil && a.n <= math.MaxInt64-b.n {
		return count{n: a.n + b.n}
	}
	return fromBig(new(big.Int).Add(a.bigValue(), b.bigValue()))
}

// sub is a - b, for two numbers with a ≥ b.
func (a count) sub(b count) count {
	if a.big == nil && b.big == nil {
		return count{n: a.n - b.n}
	}
	return fromBig(new(big.Int).Sub(a.bigValue(), b.bigValue()))
}

// cmp is -1, 0 or 1 as a is less than, equal to or greater than b.
func (a count) cmp(b count) int {
	switch {
	case a.level != b.level:
		if a.level < b.level {
			return -1
		}
		return 1
	case a.level > 0:
		return 0
	case a.big == nil && b.big == nil:
		switch {
		case a.n < b.n:
			return -1
		case a.n > b.n:
			return 1
		}
		return 0
	}
	return a.bigValue().Cmp(b.bigValue())
}
