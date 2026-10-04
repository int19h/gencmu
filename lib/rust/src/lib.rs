//! gencmu: a Lojban parser whose grammars are literate Markdown documents,
//! loaded at runtime.
//!
//! Every layer of the language, from characters to phonemes, phonemes to
//! words and words to a parse tree, is a grammar document in one notation.
//! A *dialect* is a pipeline document that lists the stages and the grammar
//! documents stitched into each. This crate implements the engine that
//! reads those documents and runs them, as `docs/engine.md` in the gencmu
//! repository specifies it; the grammars it bundles are embedded in the
//! crate, so it needs no files beside it.
//!
//! ```
//! let dialect = gencmu::load_dialect("notation")?;
//! let result = dialect.parse("%rule text A", &gencmu::ParseOptions::default())?;
//! assert!(result.ok);
//! let json = gencmu::to_json(&result);
//! let brackets = gencmu::to_brackets(&result, false);
//! # let _ = (json, brackets);
//! # Ok::<(), gencmu::Error>(())
//! ```
//!
//! A text that does not parse is not an [`Error`]: it is a [`ParseResult`]
//! whose `ok` is false and whose `error` says why. An `Error` is a dialect
//! that cannot be loaded, or a caller's mistake.
//!
//! Positions in a result count Unicode code points, whatever Rust's own
//! string indexing: a character outside the Basic Multilingual Plane is one
//! position.
//!
//! A [`Dialect`] is `Send` and `Sync`, so one may be shared between threads
//! and used for any number of parses at once. A [`ParseResult`] owns its
//! data, borrowing neither the text nor the dialect.
//!
//! The crate has no dependencies, not even for its tests, and its minimum
//! supported Rust version is 1.75.

#![forbid(unsafe_code)]
#![warn(missing_docs)]

mod clauses;
mod dialect;
mod dom;
mod earley;
mod eligible;
mod error;
mod fxhash;
mod grammar;
mod json;
mod loader;
mod lower;
mod markdown;
mod maximal;
mod nat;
mod notation;
mod output;
mod pipeline;
mod rank;
mod recent;
mod result;
mod tags;
mod tree;
mod unicode;
mod witness;
mod work;

/// What the unit tests of growth share.
#[cfg(test)]
pub(crate) mod growth {
    use std::time::{Duration, Instant};

    /// The best of three timings of `work`.
    fn best(work: &mut dyn FnMut()) -> Duration {
        (0..3)
            .map(|_| {
                let start = Instant::now();
                work();
                start.elapsed()
            })
            .min()
            .expect("three timings")
    }

    /// Asserts that `work` at 4n takes at most eight times as long as at n,
    /// with a small allowance for noise. Work that grows with the square
    /// takes sixteen times as long. Tests run side by side, so a failed
    /// measurement is taken again twice before it counts.
    pub(crate) fn assert_linear(what: &str, n: usize, work: &mut dyn FnMut(usize)) {
        work(n);
        let mut times = Vec::new();
        for _ in 0..3 {
            let small = best(&mut || work(n));
            let large = best(&mut || work(4 * n));
            if large <= small * 8 + Duration::from_millis(2) {
                return;
            }
            times.push(format!("{small:?} at {n}, {large:?} at {}", 4 * n));
        }
        panic!("{what}: {}", times.join("; "));
    }
}

pub use dialect::{Dialect, Feature, InputToken, ParseOptions};
pub use dom::FeatureKind;
pub use error::{Error, ErrorKind};
pub use grammar::Change;
pub use loader::{load_dialect, load_dialect_file, load_dialect_sources};
pub use output::{node_to_json, to_brackets, to_json};
pub use result::{
    Action, AmbiguityReason, Attachment, ErrorCode, Expected, Node, NodeKind, ParseError, ParseErrorKind, ParseResult,
    Restoration, Stage, Tags, Token, Verdict, Warning,
};

/// Helpers for tests and tools: reading one grammar document to its DOM,
/// splicing a bundled pipeline into its stages, and the hashes the DOM
/// cache is keyed by (engine §8).
pub mod tools {
    pub use crate::dom::DOM_FORMAT;
    pub use crate::json::fnv1a64;
    pub use crate::loader::{bootstrap_hash, check_dom, read_grammar_document, splice_bundled_pipeline};

    /// The recognizer's work counter, for the growth tests only: not part
    /// of the documented API.
    #[doc(hidden)]
    pub use crate::earley::{capture_steps, recognizer_captures, recognizer_items, reset_recognizer_items, walk_steps};

    /// The test hook of the check of `elision-only` (tests/README.md): the
    /// checks that ran in a parse, each with whether its forest kept the
    /// witness of the chosen derivation, and the ways to lose it on
    /// purpose. Not part of the documented API.
    #[doc(hidden)]
    pub use crate::witness::{
        fault_hits, losing_witness, with_elision_checks, with_fault, ElisionCheckRun, Fault, Loss,
    };
}

#[cfg(test)]
mod send_sync {
    fn assert_send_sync<T: Send + Sync>() {}

    #[test]
    fn dialect_is_send_and_sync() {
        assert_send_sync::<crate::Dialect>();
        assert_send_sync::<crate::ParseResult>();
    }
}
