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
//! let result = dialect.parse("text ≔ A ;", &gencmu::ParseOptions::default())?;
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
#![allow(missing_docs)]

mod dialect;
mod dom;
mod earley;
mod error;
mod grammar;
mod json;
mod loader;
mod lower;
mod markdown;
mod notation;
mod output;
mod rank;
mod result;
mod tags;
mod tree;
mod unicode;

pub use dialect::{Dialect, InputToken, ParseOptions};
pub use error::{Error, ErrorKind};
pub use grammar::Change;
pub use loader::{load_dialect, load_dialect_file, load_dialect_sources};
pub use output::{node_to_json, to_brackets, to_json};
pub use result::{
    Action, Expected, Node, NodeKind, ParseError, ParseErrorKind, ParseResult, Stage, Tags, Token, Verdict,
};

/// Helpers for tests and tools: reading one grammar document to its DOM,
/// and the hashes the DOM cache is keyed by (engine §8).
pub mod tools {
    pub use crate::json::fnv1a64;
    pub use crate::loader::{bootstrap_hash, read_grammar_document};
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
