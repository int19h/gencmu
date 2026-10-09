//! Exact natural numbers for the ranking (engine §6). A derivation can be
//! exponentially long in the size of the grammar, even over an empty input:
//! a rule that repeats the rule before it twice doubles its length. So the
//! length of an action sequence, a place in one, and the number of elided
//! terminators at one boundary can pass any fixed width. A `Nat` holds a
//! small number inline and a larger one in limbs, and it never wraps.

use std::cmp::Ordering;

/// A natural number of any size.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) enum Nat {
    Small(u64),
    /// A number of 2^64 or more, as little-endian limbs whose last limb is
    /// not zero. The box keeps a `Nat` as small as a `u64` and its tag,
    /// since lengths of derivations are mostly small.
    #[allow(clippy::box_collection)]
    Big(Box<Vec<u64>>),
}

impl Nat {
    pub(crate) const ZERO: Nat = Nat::Small(0);
    pub(crate) const ONE: Nat = Nat::Small(1);

    pub(crate) fn is_zero(&self) -> bool {
        matches!(self, Nat::Small(0))
    }

    /// The number, or `u64::MAX` if it is larger, for a hint that only has
    /// to order sizes roughly.
    pub(crate) fn saturated(&self) -> u64 {
        match self {
            Nat::Small(n) => *n,
            Nat::Big(_) => u64::MAX,
        }
    }

    fn limbs(&self) -> Vec<u64> {
        match self {
            Nat::Small(n) => vec![*n],
            Nat::Big(limbs) => limbs.to_vec(),
        }
    }

    fn from_limbs(mut limbs: Vec<u64>) -> Nat {
        while limbs.len() > 1 && limbs.last() == Some(&0) {
            limbs.pop();
        }
        match limbs[..] {
            [] => Nat::ZERO,
            [n] => Nat::Small(n),
            _ => Nat::Big(Box::new(limbs)),
        }
    }

    pub(crate) fn add(&self, other: &Nat) -> Nat {
        if let (Nat::Small(a), Nat::Small(b)) = (self, other) {
            if let Some(sum) = a.checked_add(*b) {
                return Nat::Small(sum);
            }
        }
        let (a, b) = (self.limbs(), other.limbs());
        let mut sum = Vec::with_capacity(a.len().max(b.len()) + 1);
        let mut carry = 0u128;
        for index in 0..a.len().max(b.len()) {
            let total =
                u128::from(a.get(index).copied().unwrap_or(0)) + u128::from(b.get(index).copied().unwrap_or(0)) + carry;
            sum.push(total as u64);
            carry = total >> 64;
        }
        if carry > 0 {
            sum.push(carry as u64);
        }
        Nat::from_limbs(sum)
    }

    /// `self - other`, where `other` is not greater than `self`.
    pub(crate) fn sub(&self, other: &Nat) -> Nat {
        debug_assert!(other <= self, "a natural number less than what it loses");
        if let (Nat::Small(a), Nat::Small(b)) = (self, other) {
            return Nat::Small(a - b);
        }
        let (a, b) = (self.limbs(), other.limbs());
        let mut difference = Vec::with_capacity(a.len());
        let mut borrow = 0u64;
        for (index, &limb) in a.iter().enumerate() {
            let take = b.get(index).copied().unwrap_or(0);
            let (once, first) = limb.overflowing_sub(take);
            let (twice, second) = once.overflowing_sub(borrow);
            difference.push(twice);
            borrow = u64::from(first || second);
        }
        Nat::from_limbs(difference)
    }
}

impl From<u64> for Nat {
    fn from(n: u64) -> Nat {
        Nat::Small(n)
    }
}

impl Ord for Nat {
    fn cmp(&self, other: &Nat) -> Ordering {
        match (self, other) {
            (Nat::Small(a), Nat::Small(b)) => a.cmp(b),
            (Nat::Small(_), Nat::Big(_)) => Ordering::Less,
            (Nat::Big(_), Nat::Small(_)) => Ordering::Greater,
            (Nat::Big(a), Nat::Big(b)) => a.len().cmp(&b.len()).then_with(|| a.iter().rev().cmp(b.iter().rev())),
        }
    }
}

impl PartialOrd for Nat {
    fn partial_cmp(&self, other: &Nat) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

#[cfg(test)]
mod tests {
    use super::Nat;

    /// 2^k, by doubling from one.
    fn power(k: u32) -> Nat {
        (0..k).fold(Nat::ONE, |n, _| n.add(&n))
    }

    #[test]
    fn numbers_past_any_fixed_width_stay_exact() {
        let max = Nat::from(u64::MAX);
        let big = max.add(&Nat::ONE);
        assert_eq!(big, power(64));
        assert!(big > max);
        assert_eq!(big.sub(&Nat::ONE), max);
        assert_eq!(big.sub(&big), Nat::ZERO);
        let huge = power(200);
        assert_eq!(huge.add(&huge), power(201));
        assert_eq!(power(201).sub(&huge), huge);
        assert!(power(200).add(&Nat::ONE) > power(200));
        assert!(power(130) < power(131));
        assert_eq!(power(129).add(&power(129)).sub(&power(128)).sub(&power(128)), power(129));
        assert_eq!(huge.saturated(), u64::MAX);
        assert_eq!(Nat::from(7).saturated(), 7);
    }
}
