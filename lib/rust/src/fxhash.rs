//! A fast, non-cryptographic hasher for the parser's tables (the one rustc
//! uses), since the standard library's SipHash dominates otherwise. The
//! tables' keys are the parser's own, never an adversary's.

use std::collections::{HashMap, HashSet};
use std::hash::{BuildHasherDefault, Hasher};

#[derive(Default, Clone, Copy)]
pub(crate) struct FxHasher {
    hash: u64,
}

const SEED: u64 = 0x51_7c_c1_b7_27_22_0a_95;

impl FxHasher {
    #[inline]
    fn add(&mut self, word: u64) {
        self.hash = (self.hash.rotate_left(5) ^ word).wrapping_mul(SEED);
    }
}

impl Hasher for FxHasher {
    #[inline]
    fn write(&mut self, bytes: &[u8]) {
        let mut chunks = bytes.chunks_exact(8);
        for chunk in &mut chunks {
            self.add(u64::from_le_bytes(chunk.try_into().expect("eight bytes")));
        }
        let rest = chunks.remainder();
        if !rest.is_empty() {
            let mut word = [0u8; 8];
            word[..rest.len()].copy_from_slice(rest);
            self.add(u64::from_le_bytes(word));
        }
    }

    #[inline]
    fn write_u8(&mut self, value: u8) {
        self.add(u64::from(value));
    }

    #[inline]
    fn write_u16(&mut self, value: u16) {
        self.add(u64::from(value));
    }

    #[inline]
    fn write_u32(&mut self, value: u32) {
        self.add(u64::from(value));
    }

    #[inline]
    fn write_u64(&mut self, value: u64) {
        self.add(value);
    }

    #[inline]
    fn write_usize(&mut self, value: usize) {
        self.add(value as u64);
    }

    /// The state, rotated so that its best-mixed high bits become the low
    /// bits that a table picks its bucket by. A product's low bits depend
    /// only on the low bits of what was multiplied, so names that share
    /// their first bytes, such as `t0` to `t159999`, would otherwise fall
    /// into a few buckets, and each lookup would scan a long probe chain.
    #[inline]
    fn finish(&self) -> u64 {
        self.hash.rotate_left(26)
    }
}

pub(crate) type FxMap<K, V> = HashMap<K, V, BuildHasherDefault<FxHasher>>;
pub(crate) type FxSet<K> = HashSet<K, BuildHasherDefault<FxHasher>>;

#[cfg(test)]
mod tests {
    use super::FxHasher;
    use std::collections::HashSet;
    use std::hash::{Hash, Hasher};

    fn hash(value: impl Hash) -> u64 {
        let mut hasher = FxHasher::default();
        value.hash(&mut hasher);
        hasher.finish()
    }

    /// Names that differ only after a shared first byte spread over the
    /// low bits, which a table's buckets come from, and so do numbers and
    /// pairs of them. With 2^16 keys and the low 16 bits, a good spread
    /// fills about 63% of the values; one that ignores the later bytes
    /// fills a handful.
    #[test]
    fn similar_keys_spread_over_the_low_bits() {
        let keys = 1u64 << 16;
        let low = |hashes: &mut dyn Iterator<Item = u64>| {
            hashes.map(|h| h & (keys - 1)).collect::<HashSet<u64>>().len() as u64
        };
        let names = low(&mut (0..keys).map(|i| hash(format!("t{i}"))));
        let suffixed = low(&mut (0..keys).map(|i| hash(format!("{i}t"))));
        let numbers = low(&mut (0..keys).map(|i| hash(i as u32)));
        let pairs = low(&mut (0..keys).map(|i| hash((i as u32 & 255, i as u32 >> 8))));
        for (what, filled) in [("names", names), ("suffixed names", suffixed), ("numbers", numbers), ("pairs", pairs)] {
            assert!(filled * 2 > keys, "{what}: {filled} of {keys} low values");
        }
    }
}
