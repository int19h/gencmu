//! `FastMap` and `FastSet` share one fast multiply-based hasher with a
//! per-process random seed from `RandomState`. Tables that use the standard
//! library's default hasher keep it. An attacker who does not know the seed
//! cannot build colliding inputs in advance, except with a negligible chance
//! over the random seed. The seed fixes the first word's factor, and a seed
//! that makes the hasher weak with a chance near `2^-48` or less is accepted.
//! Two one-word keys `w` and `!w` can share a hash with a chance near
//! `2^-27`, but such pairs stay alone and cannot fill a bucket.
//! The order of iteration over a table changes from run to run, so no result
//! may depend on it.

use std::collections::hash_map::RandomState;
use std::collections::{HashMap, HashSet};
use std::hash::{BuildHasher, BuildHasherDefault, Hasher};
use std::sync::OnceLock;

#[inline]
fn fold(a: u64, b: u64) -> u64 {
    let product = u128::from(a) * u128::from(b);
    (product as u64) ^ ((product >> 64) as u64)
}

#[inline]
pub(crate) fn process_seed() -> (u64, u64, u64) {
    static SEED: OnceLock<(u64, u64, u64)> = OnceLock::new();
    *SEED.get_or_init(|| {
        let state = RandomState::new();
        let word = |n: u64| {
            let mut hasher = state.build_hasher();
            hasher.write_u64(n);
            hasher.finish()
        };
        let mut n = 0;
        loop {
            let seed = (word(n), word(n + 1), word(n + 2));
            if usable_seed(seed) {
                return seed;
            }
            n += 3;
        }
    })
}

/// Whether `s2` and the first word's factor `s0 ^ s2` avoid `0` and
/// `u64::MAX`, the two factors for which `fold(x, factor)` ignores `x`.
fn usable_seed((s0, _, s2): (u64, u64, u64)) -> bool {
    let keeps_input = |factor: u64| factor != 0 && factor != u64::MAX;
    keeps_input(s2) && keeps_input(s0 ^ s2)
}

#[derive(Clone, Copy)]
pub(crate) struct FastHasher {
    hash: u64,
    s0: u64,
    s1: u64,
    s2: u64,
    pending: u64,
    bits: u64,
}

impl Default for FastHasher {
    #[inline]
    fn default() -> Self {
        let (s0, s1, s2) = process_seed();
        Self { hash: s0, s0, s1, s2, pending: 0, bits: 0 }
    }
}

impl FastHasher {
    #[cfg(test)]
    #[inline]
    pub(crate) fn with_seed(s0: u64, s1: u64, s2: u64) -> Self {
        Self { hash: s0, s0, s1, s2, pending: 0, bits: 0 }
    }

    /// Mixes one word with a folded multiply and feeds the earlier state
    /// forward outside the product so that no fixed word erases the state.
    /// Both multiply factors depend on the seed, and the second factor
    /// changes with the state from the second word on.
    #[inline]
    fn add(&mut self, word: u64) {
        self.hash = fold(word ^ self.s1, self.hash ^ self.s2) ^ (self.hash ^ (self.hash >> 1)).rotate_left(35);
    }

    /// Mixes the pending word of packed small writes and XORs `self.bits`
    /// into `self.hash` so that the state records the packed field boundaries.
    /// Full-word writes add no marker, so a `u64` and two `u32` halves leave
    /// different states after the same mixed word.
    #[inline]
    fn flush(&mut self) {
        let word = self.pending;
        let bits = self.bits;
        self.pending = 0;
        self.bits = 0;
        self.add(word);
        self.hash ^= bits;
    }

    /// Packs a write of `shift` bits into `self.pending` and sets bit
    /// `shift - 8` in `self.bits` at the top byte of the field.
    /// Earlier fields shift left by `shift`, so the highest mark bit gives
    /// the packed width and the gaps between marks give each field width.
    /// Different field widths or orders within a word therefore produce
    /// different `(pending, bits)` pairs, and a write that exceeds 64 bits
    /// flushes first.
    #[inline]
    fn write_bits(&mut self, value: u64, shift: u32) {
        let mark = 1 << (shift - 8);
        if self.bits < 1 << (64 - shift) {
            self.pending = (self.pending << shift) | value;
            self.bits = (self.bits << shift) | mark;
        } else {
            self.flush();
            self.pending = value;
            self.bits = mark;
        }
    }
}

impl Hasher for FastHasher {
    #[inline]
    fn write(&mut self, bytes: &[u8]) {
        if self.bits > 0 {
            self.flush();
        }
        self.add(bytes.len() as u64);
        let mut chunks = bytes.chunks_exact(8);
        for chunk in &mut chunks {
            self.add(u64::from_le_bytes(chunk.try_into().expect("eight bytes")));
        }
        let rest = chunks.remainder();
        if !rest.is_empty() {
            let mut word = [0u8; 8];
            word[..rest.len()].copy_from_slice(rest);
            self.pending = u64::from_le_bytes(word);
            self.bits = 1 << ((rest.len() - 1) * 8);
        }
    }

    #[inline]
    fn write_u8(&mut self, value: u8) {
        self.write_bits(u64::from(value), 8);
    }

    #[inline]
    fn write_u16(&mut self, value: u16) {
        self.write_bits(u64::from(value), 16);
    }

    #[inline]
    fn write_u32(&mut self, value: u32) {
        self.write_bits(u64::from(value), 32);
    }

    #[inline]
    fn write_u64(&mut self, value: u64) {
        if self.bits > 0 {
            self.flush();
        }
        self.add(value);
    }

    #[inline]
    fn write_u128(&mut self, value: u128) {
        if self.bits > 0 {
            self.flush();
        }
        self.add(value as u64);
        self.add((value >> 64) as u64);
    }

    #[inline]
    fn write_usize(&mut self, value: usize) {
        self.write_u64(value as u64);
    }

    /// Flushes any pending small writes and applies the fixed bijective
    /// SplitMix64 finalizer to `state.hash ^ state.s0`. It cannot collapse two
    /// states, and the low bits depend on the full state.
    #[inline]
    fn finish(&self) -> u64 {
        let mut state = *self;
        if state.bits > 0 {
            state.flush();
        }
        let mut h = state.hash ^ state.s0;
        h = (h ^ (h >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        h = (h ^ (h >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        h ^ (h >> 31)
    }
}

pub(crate) type FastMap<K, V> = HashMap<K, V, BuildHasherDefault<FastHasher>>;
pub(crate) type FastSet<K> = HashSet<K, BuildHasherDefault<FastHasher>>;

#[cfg(test)]
mod tests {
    use super::FastHasher;
    use std::collections::HashSet;
    use std::hash::{Hash, Hasher};

    const FIXED_SEED: (u64, u64, u64) = (0xbf58_476d_1ce4_e5b9, 0x9e37_79b9_7f4a_7c15, 0x94d0_49bb_1331_11eb);

    fn hash_default(value: impl Hash) -> u64 {
        let mut hasher = FastHasher::default();
        value.hash(&mut hasher);
        hasher.finish()
    }

    fn hash_with(seed: (u64, u64, u64), value: impl Hash) -> u64 {
        let mut hasher = FastHasher::with_seed(seed.0, seed.1, seed.2);
        value.hash(&mut hasher);
        hasher.finish()
    }

    fn hash_bytes_with(seed: (u64, u64, u64), bytes: &[u8]) -> u64 {
        let mut hasher = FastHasher::with_seed(seed.0, seed.1, seed.2);
        hasher.write(bytes);
        hasher.finish()
    }

    fn hash(value: impl Hash) -> u64 {
        hash_with(FIXED_SEED, value)
    }

    #[test]
    fn degenerate_seeds_are_not_usable() {
        assert!(!super::usable_seed((0, 0, 0)));
        assert!(!super::usable_seed((2, 1, 0)));
        assert!(!super::usable_seed((FIXED_SEED.0, 5, 0)));
        assert!(!super::usable_seed((0, 1, u64::MAX)));
        assert!(!super::usable_seed((1u64 << 32, FIXED_SEED.1, u64::MAX)));
        assert!(!super::usable_seed((7, 1, 7)));
        assert!(!super::usable_seed((1, 7, !1)));
        assert!(!super::usable_seed((FIXED_SEED.0, FIXED_SEED.1, !FIXED_SEED.0)));
        assert!(!super::usable_seed((FIXED_SEED.2, FIXED_SEED.0, !FIXED_SEED.2)));
        assert!(super::usable_seed((1, 7, 7)));
        assert!(super::usable_seed((7, 1, !1)));
        assert!(super::usable_seed((7, 5, u64::MAX ^ 5)));
        assert!(super::usable_seed((0, 0, 1)));
        assert!(super::usable_seed((1, 0, 2)));
        assert!(super::usable_seed((FIXED_SEED.0, FIXED_SEED.1, !FIXED_SEED.1)));
        assert!(super::usable_seed((FIXED_SEED.2, FIXED_SEED.0, !FIXED_SEED.0)));
        assert!(super::usable_seed(super::process_seed()));
    }

    #[test]
    fn two_hashers_in_one_process_agree() {
        for sample in ["", "a", "klama", "t159999"] {
            assert_eq!(hash_default(sample), hash_default(sample));
        }
        assert_eq!(hash_default(42u64), hash_default(42u64));
        assert_eq!(hash_default((7u32, 9u32)), hash_default((7u32, 9u32)));
    }

    #[test]
    fn state_feed_forward_preserves_prefixes_and_suffixes() {
        let suffixes: HashSet<u64> = (0..1024u64).map(|i| hash_with((2, 1, 0), (1u64, i, 17u64))).collect();
        assert_eq!(suffixes.len(), 1024);

        for seed in [(1, 0, 2), (1, u64::MAX, 2), (1, 1u64 << 35, 2)] {
            let triples: HashSet<u64> = (0..1024u64).map(|i| hash_with(seed, (i, 0u64, 17u64))).collect();
            assert_eq!(triples.len(), 1024);
        }

        let zero_tailed_slices: HashSet<u64> = (0..1024u64)
            .map(|i| {
                let mut bytes = [0u8; 16];
                bytes[..8].copy_from_slice(&i.to_le_bytes());
                hash_bytes_with((1, 0, 2), &bytes)
            })
            .collect();
        assert_eq!(zero_tailed_slices.len(), 1024);

        let nul_tailed_strings: HashSet<u64> =
            (0..1024u32).map(|i| hash_with((1, 0, 2), format!("{i:08x}\0\0\0\0\0\0\0\0"))).collect();
        assert_eq!(nul_tailed_strings.len(), 1024);

        for s1 in [0xff, !0xff, 0xff ^ (1u64 << 35)] {
            let seed = (FIXED_SEED.0, s1, FIXED_SEED.2);
            let words: HashSet<u64> = ["", "a", "klama", "prami", "tavla", "citka", "dunda"]
                .into_iter()
                .map(|s| hash_with(seed, s))
                .collect();
            assert_eq!(words.len(), 7);
            let numbered: HashSet<u64> = (0..1024u32).map(|i| hash_with(seed, format!("s{i}"))).collect();
            assert_eq!(numbered.len(), 1024);
        }
    }

    #[test]
    fn bijective_finalizer_separates_states_and_spreads_low_bits() {
        let finish_twins = [
            (7, 5, u64::MAX ^ 5),
            (FIXED_SEED.0, FIXED_SEED.1, !FIXED_SEED.1),
            (FIXED_SEED.2, FIXED_SEED.0, !FIXED_SEED.0),
        ];
        for seed in finish_twins {
            let pairs: HashSet<u64> = (0..1024u64).map(|i| hash_with(seed, (0u64, i))).collect();
            let names: HashSet<u64> = (0..1024u32).map(|i| hash_with(seed, format!("t{i}"))).collect();
            assert_eq!(pairs.len(), 1024);
            assert_eq!(names.len(), 1024);
        }
        let single_words: HashSet<u64> = (0..1024u64).map(|i| hash_with((7, 5, u64::MAX ^ 5), i)).collect();
        assert!(single_words.len() > 200);

        for seed in [(FIXED_SEED.0, FIXED_SEED.1, !FIXED_SEED.1), (FIXED_SEED.2, FIXED_SEED.0, !FIXED_SEED.0)] {
            let numbers: HashSet<u64> = (0..65_536u32).map(|i| hash_with(seed, i)).collect();
            let pairs: HashSet<u64> = (0..65_536u32).map(|i| hash_with(seed, (i & 255, i >> 8))).collect();
            assert_eq!(numbers.len(), 65_536);
            assert_eq!(pairs.len(), 65_536);
        }

        let shifted_full: HashSet<u64> = (0..1024u64).map(|i| hash_with((0, 0, 1), i << 16)).collect();
        let shifted_low: HashSet<u64> = (0..1024u64).map(|i| hash_with((0, 0, 1), i << 16) & 0xffff).collect();
        assert_eq!(shifted_full.len(), 1024);
        assert!(shifted_low.len() > 900);
    }

    #[test]
    fn state_varying_factor_separates_rational_multiplier_families() {
        for seed in [FIXED_SEED, (FIXED_SEED.0, 0x2889_dd18_248c_5363, 0x5555_5555_5555_5557)] {
            let pairs: HashSet<u64> = (0..65_536u32).map(|i| hash_with(seed, (i & 255, i >> 8))).collect();
            let numbers: HashSet<u64> = (0..65_536u32).map(|i| hash_with(seed, i)).collect();
            assert_eq!(pairs.len(), 65_536);
            assert_eq!(numbers.len(), 65_536);
        }

        let first_factor_seed = (FIXED_SEED.0, FIXED_SEED.1, FIXED_SEED.0 ^ 0x5555_5555_5555_5557);
        for seed in [FIXED_SEED, (FIXED_SEED.0, FIXED_SEED.1, 0x5555_5555_5555_5557)] {
            let mut digests = HashSet::with_capacity(1024);
            let mut second_word_digests = HashSet::with_capacity(1024);
            for mask in 0..1024u32 {
                let mut y = 0u64;
                for d in 0..10 {
                    let digit = if (mask >> d) & 1 == 0 { 7u64 } else { 9u64 };
                    y |= digit << (6 * d);
                }
                digests.insert(hash_with(seed, 3 * y));
                second_word_digests.insert(hash_with(first_factor_seed, (0u64, 3 * y)));
            }
            assert_eq!(digests.len(), 1024);
            assert_eq!(second_word_digests.len(), 1024);
        }
    }

    #[test]
    fn write_length_distinguishes_padded_tails_and_fields() {
        assert_ne!(hash("a"), hash("a\0"));
        assert_ne!(hash("abcdefgh"), hash("abcdefgh\0"));
        assert_ne!(hash(""), hash("\0"));
        assert_ne!(hash(("a\0", "b")), hash(("a", "b\0")));
        assert_ne!(hash(("a", "b")), hash(("a\0\0", "b\0")));
        assert_ne!(hash(vec!["a".to_string(), "b".to_string()]), hash(vec!["a\0".to_string(), "b\0\0\0".to_string()]));
        assert_ne!(hash(vec!["a\0".to_string(), "b".to_string()]), hash(vec!["a".to_string(), "b\0".to_string()]));
        assert_ne!(hash((0u64,)), hash((0u64, 0u64)));
    }

    #[test]
    fn packed_writes_separate_field_orders_and_widths() {
        for seed in [FIXED_SEED, (1, 0, 2), (0, 0, 1)] {
            assert_ne!(hash_with(seed, (1u8, 2u8)), hash_with(seed, (2u8, 1u8)));
            assert_ne!(hash_with(seed, (1u16, 2u16)), hash_with(seed, (2u16, 1u16)));
            assert_ne!(hash_with(seed, (1u32, 2u32)), hash_with(seed, (2u32, 1u32)));
            assert_ne!(hash_with(seed, (1u8, 2u16, 3u32)), hash_with(seed, (3u8, 2u16, 1u32)));

            let zero_tuples = [
                hash_with(seed, (0u8,)),
                hash_with(seed, (0u8, 0u8)),
                hash_with(seed, (0u8, 0u8, 0u8)),
                hash_with(seed, (0u8, 0u8, 0u8, 0u8)),
                hash_with(seed, (0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8)),
                hash_with(seed, (0u16,)),
                hash_with(seed, (0u16, 0u16)),
                hash_with(seed, (0u16, 0u16, 0u16, 0u16)),
                hash_with(seed, (0u32,)),
                hash_with(seed, (0u32, 0u32)),
                hash_with(seed, (0u32, 0u32, 0u32)),
                hash_with(seed, (0u32, 0u32, 0u32, 0u32)),
                hash_with(seed, (0u64,)),
            ];
            assert_eq!(zero_tuples.into_iter().collect::<HashSet<u64>>().len(), zero_tuples.len());
            assert_ne!(hash_with(seed, (1u8,)), hash_with(seed, (1u8, 0u8)));
            assert_ne!(hash_with(seed, (1u16,)), hash_with(seed, (1u16, 0u16)));
            assert_ne!(hash_with(seed, (1u32,)), hash_with(seed, (1u32, 0u32)));
            assert_ne!(hash_with(seed, (1u32, 2u32)), hash_with(seed, (1u32, 2u32, 0u32)));

            assert_ne!(hash_with(seed, 0u64), hash_with(seed, (0u32, 0u32)));
            assert_ne!(hash_with(seed, 0x0000_0001_0000_0002u64), hash_with(seed, (1u32, 2u32)));
            assert_ne!(hash_with(seed, 0x0000_0002_0000_0001u64), hash_with(seed, (1u32, 2u32)));
            assert_ne!(hash_with(seed, 0xdead_beef_cafe_babau64), hash_with(seed, (0xdead_beefu32, 0xcafe_babau32)));
            assert_ne!(hash_with(seed, 0xdead_beef_cafe_babau64), hash_with(seed, (0xcafe_babau32, 0xdead_beefu32)));
            assert_ne!(hash_with(seed, 0x0001_0002u32), hash_with(seed, (1u16, 2u16)));
            assert_ne!(hash_with(seed, 0x0002_0001u32), hash_with(seed, (1u16, 2u16)));
            assert_ne!(hash_with(seed, 0x0102u16), hash_with(seed, (1u8, 2u8)));
            assert_ne!(hash_with(seed, 0x0201u16), hash_with(seed, (1u8, 2u8)));

            assert_ne!(hash_with(seed, (0u8, 0u32)), hash_with(seed, (0u32, 0u8)));
            assert_ne!(hash_with(seed, (1u8, 0u32)), hash_with(seed, (1u32, 0u8)));
            assert_ne!(hash_with(seed, (0u8, 1u32)), hash_with(seed, (1u32, 0u8)));
            assert_ne!(hash_with(seed, (1u8, 2u32)), hash_with(seed, (2u32, 1u8)));
            assert_ne!(hash_with(seed, (0x12u8, 0x3456_789au32)), hash_with(seed, (0x1234_5678u32, 0x9au8)));
            assert_ne!(hash_with(seed, (0x12u8, 0x3456_789au32)), hash_with(seed, (0x5678_9a12u32, 0x34u8)));
        }
    }

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
