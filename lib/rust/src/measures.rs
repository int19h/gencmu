//! Fixed diagnostic charges and private identities (engine §1 and §6).

use std::cmp::Ordering;
use std::sync::Arc;

use crate::earley::Tok;
use crate::nat::Nat;
use crate::tree::Sources;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Measure(pub(crate) [Nat; 3]);

impl Measure {
    pub(crate) const ZERO: Self = Self([Nat::ZERO, Nat::ZERO, Nat::ZERO]);

    pub(crate) fn add(&self, other: &Self) -> Self {
        Self(std::array::from_fn(|index| self.0[index].add(&other.0[index])))
    }

    pub(crate) fn compare(&self, other: &Self) -> Ordering {
        self.0[0].cmp(&other.0[0]).then_with(|| self.0[1].cmp(&other.0[1])).then_with(|| other.0[2].cmp(&self.0[2]))
    }
}

#[derive(Debug)]
pub(crate) struct DiagnosticIdentity {
    pub(crate) stage_order: usize,
    pub(crate) ordinal: usize,
}

#[derive(Debug)]
pub(crate) struct DiagnosticRecord {
    pub(crate) identity: Arc<DiagnosticIdentity>,
    pub(crate) measure: Measure,
}

pub(crate) struct Measures {
    sources: Sources,
    nonempty: Vec<usize>,
    pub(crate) carried: Vec<Measure>,
}

impl Measures {
    pub(crate) fn new(tokens: &[Tok]) -> Self {
        let mut nonempty = Vec::with_capacity(tokens.len() + 1);
        let mut carried = Vec::with_capacity(tokens.len());
        nonempty.push(0);
        for token in tokens {
            nonempty.push(nonempty.last().copied().unwrap() + usize::from(token.source.0 < token.source.1));
            let charge = token.errors.iter().fold(Measure::ZERO, |sum, diagnostic| {
                sum.add(&diagnostic.record.as_ref().expect("a carried diagnostic has a fixed charge").measure)
            });
            carried.push(charge);
        }
        Self { sources: Sources::new(tokens), nonempty, carried }
    }

    pub(crate) fn own(&self, start: usize, end: usize) -> Measure {
        if self.nonempty[end] == self.nonempty[start] {
            return Measure([Nat::ZERO, Nat::ONE, Nat::ONE]);
        }
        let (start, end) = self.sources.of(start, end);
        Measure([Nat::Small((end - start) as u64), Nat::ZERO, Nat::ONE])
    }

    pub(crate) fn projected_own(&self, project: &[u32], start: usize, end: usize) -> Measure {
        self.own(project[start] as usize, project[end] as usize)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::result::Warning;

    fn token(source: (usize, usize)) -> Tok {
        Tok {
            text: "a".into(),
            value: "a".into(),
            image: "a".into(),
            tags: 0,
            source,
            sound: Default::default(),
            quiet: 0,
            before: Vec::new(),
            after: Vec::new(),
            errors: Vec::new(),
            warnings: Vec::new(),
        }
    }

    #[test]
    fn deferred_measure_orders_blame_sourceless_and_count() {
        // Engine §6: the first two counts ascend and the last descends.
        let charge = |a, b, c| Measure([Nat::Small(a), Nat::Small(b), Nat::Small(c)]);
        assert!(charge(0, 2000, 2000).compare(&charge(1, 0, 1)).is_lt());
        assert!(Measure::ZERO.compare(&charge(0, 2000, 2000)).is_lt());
        assert!(charge(0, 0, 4).compare(&charge(0, 0, 3)).is_lt());
        let large = charge(1 << 63, 1 << 63, 1 << 63);
        assert_eq!(large.add(&large).0[0], Nat::Small(u64::MAX).add(&Nat::ONE));
    }

    #[test]
    fn deferred_measure_uses_tokens_and_projected_original_sources() {
        // Engine §6 and §7.7: synthetic anchors add neither width nor a source.
        let sourcefree = Measures::new(&[token((2, 2)), token((9, 9)), token((7, 8))]);
        assert_eq!(sourcefree.own(0, 2), Measure([Nat::ZERO, Nat::ONE, Nat::ONE]));
        assert_eq!(sourcefree.own(0, 3), Measure([Nat::Small(7), Nat::ZERO, Nat::ONE]));
        for sources in [[(0, 1), (5, 6)], [(10, 11), (0, 1)]] {
            let original = Measures::new(&sources.into_iter().map(token).collect::<Vec<_>>());
            assert_eq!(original.projected_own(&[0, 1, 1, 2], 1, 3), Measure([Nat::ONE, Nat::ZERO, Nat::ONE]));
            assert_eq!(original.projected_own(&[0, 1, 1, 2], 1, 2), Measure([Nat::ZERO, Nat::ONE, Nat::ONE]));
            assert_eq!(original.projected_own(&[0, 1, 1, 2], 0, 3), original.own(0, 2));
        }
    }

    #[test]
    fn deferred_measure_keeps_a_carried_identity_and_charge() {
        // Engine §1: public coordinates do not change the private fixed charge.
        let mut diagnostic = Warning::new("before".into(), "fault".into(), 0..1, 2..6, "fault".into());
        diagnostic.record = Some(Arc::new(DiagnosticRecord {
            identity: Arc::new(DiagnosticIdentity { stage_order: 1, ordinal: 2 }),
            measure: Measure([Nat::Small(4), Nat::ZERO, Nat::ONE]),
        }));
        let mut copied = diagnostic.clone();
        copied.source = 0..100;
        copied.span = 3..9;
        assert!(Arc::ptr_eq(diagnostic.record.as_ref().unwrap(), copied.record.as_ref().unwrap()));
        let identity = &copied.record.as_ref().unwrap().identity;
        assert_eq!((identity.stage_order, identity.ordinal), (1, 2));
        let mut input = token((0, 1));
        input.errors.push(copied);
        assert_eq!(Measures::new(&[input]).carried[0], Measure([Nat::Small(4), Nat::ZERO, Nat::ONE]));
    }
}
