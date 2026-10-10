# gencmu for Rust

gencmu is a Lojban parser whose grammars are literate Markdown documents, loaded at runtime. A literate grammar document mixes prose with grammar rules. This crate is the Rust library of [gencmu](https://github.com/int19h/gencmu). A clean-room implementation uses the specification alone.

The crate is a clean-room implementation of the engine specification, `docs/engine.md`, with no dependencies at all. The crate embeds the grammars that it bundles. An API is the operations that a library exposes.

The minimum supported Rust version is 1.75.

```rust
// in a function that returns Result<_, gencmu::Error>
let dialect = gencmu::load_dialect("cll-ebnf")?;
let result = dialect.parse("mi klama le zarci", &gencmu::ParseOptions::default())?;
if result.ok {
    println!("{}", gencmu::to_brackets(&result, true));
} else if let Some(error) = &result.error {
    println!("{error}");
}
println!("{}", gencmu::to_json(&result));
```

## Loading a dialect

`load_dialect(name)` loads a bundled dialect, the pipeline document `grammars/dialects/NAME.md`. `load_dialect_file(path)` loads a pipeline document from disk, and finds the documents that it includes relative to it. `load_dialect_sources(sources, pipeline)` loads documents held in memory, from any iterable of `(path, text)` pairs. Each returns `Result<Dialect, gencmu::Error>`. A tie while the notation reads a document is an error of the kind `ErrorKind::Grammar` that names the document, with no line or column.

## Parsing

- `Dialect::parse(&self, text, &ParseOptions) -> Result<ParseResult, Error>` parses a text. A text that does not parse is a result whose `ok` is false. The same holds for a grammar defect found while parsing, such as an entry that adds a class twice under the selected features. The `Error` is for a mistake of the caller. Examples are an unknown stage in `until`, and a feature named both to turn on and to turn off.
- `ParseOptions` has `features`, `without_features`, `auto_features` (on by default), `until` and `elision_only`. `features` names the features to turn on, besides the pipeline's own. `without_features` names the features to turn off, the pipeline's own included.
- `Dialect::features()` lists the features of the dialect in code point order, the gates of its classifiers' entries included. Each is a `Feature` with its `name`, its `kind` (`FeatureKind::Gate` or `FeatureKind::Warning`), and whether the pipeline turns it on by `default`.

## Results

- `to_json(&result)` writes the canonical JSON of `docs/output.md`.
- `to_brackets(&result, show_elided)` renders the tree as brackets. It shows each token by its label. A token with attachments is a group of its before-attachments, its label and its after-attachments, so `mi ui klama` in the `cll-ebnf` dialect is `([mi ui] klama)`.
- A `ParseResult` owns its data: the stages, the tree, the error and the warnings. Each stage has its input and output tokens, its verdict and, for a tie, its witness. A tied stage has no output tokens, and the error of the result holds its two readings. An error of the kind `ParseErrorKind::Ambiguous` has a `reason`: `AmbiguityReason::Tie` for a tie, or `AmbiguityReason::ElisionOnly` where the check of `elision-only` fails. That error also has a `witness`, the pair of actions where its readings first differ (engine §7.10). Such an action can be `Action::Elided`, a read of a terminator that the check wrote back.

  An error whose `kind` is `ParseErrorKind::Grammar` and whose `code` is `Some(ErrorCode::ElisionWitnessLost)` marks a library defect. The check loses the stage's chosen derivation (engine §7.9). Such an error also has `chosen`, the stage's chosen tree, and `completion`, the terminators that the check wrote back. Each `Restoration` has its `terminal`, input position `at`, and the empty `source` of its elided node.

  A terminator with an `=` test also has its `sound`. The JSON writes them after the message, as `docs/output.md` says. Every other error has no `code`, no `chosen` and an empty `completion`.

  A token has its text, its phonemes, its label, its tags, its span and its source range. The label is what the renderings for people show. An opaque part, such as the body of a `zoi` quote, sounds `?` and has its text as its label. A pause has a space as its label.

  A token also has its attachments, `before` and `after`. These are tokens that belong to it and that no later stage reads, such as the indicators after a word. Each is an `Attachment`, a token without a span, with attachments of its own. Both lists are empty unless an emission gives the token attachments.

  The warnings are those of the warning features that are turned on. Source positions count Unicode code points. Spans and token indices count tokens of the relevant stage. Tags are a `BTreeSet<String>`, each tag in its canonical spelling, such as `'a'` for a character tag. A character token of the first stage carries only its character tag.

Lowering can find grammar defects for the features of a parse. Examples include a chain beside another alternative or a repeated item that can match no tokens. The dialect loads, but parsing returns a result whose error has kind `ParseErrorKind::Grammar` and the stage's name. It does not return an `Error`. Its message begins with the document, line and column of the definition that wrote the alternative at fault, as `g.md:4:1:`.

`Dialect` is `Send` and `Sync`, so threads can share one dialect freely.

## Tools

For tests and tools: `Dialect::parse_tokens` feeds tokens straight to the first stage. A token that the caller supplies has its text as its label. An `InputToken` has no attachments, since a caller cannot supply them. A DOM (document object model) is the parsed form of a grammar document.

`gencmu::tools` reads a grammar document into a DOM. It tests that DOM as a precompiled DOM. It also splices bundled pipelines into stages and computes the hashes for the DOM cache. `gencmu::tools::DOM_FORMAT` is the version of the DOM's shape, which every cache key holds.

A DOM holds the document's constants, classifiers and implications as the document writes them, never their values. The loader gives each constant its value when it stitches a stage. A stage resolves its classifiers for the features of each parse, once for each set of features.

The DOM format is 18. Braces are a `repeat`, with a `separator` for `{x \ s}`. A chain has `chain` set to `left` or `right` and forms its alternative's whole expression. An elidable optional, `[+T x]`, is an `optional` with `elidable`, and `[++T x]` also has `maximal`. No directive names elidable terminators: `%elidable` is a syntax error.

A capture can stand anywhere in an alternative but inside braces or an elidable optional, and a production holds each name once. A production can have any number of captures. Each capture forms part of the identity of a recognizer item. A capture whose rule can end in many places multiplies items (engine §4).

## Development

The grammars of the crate, `grammars/`, are a copy of the grammars of the repository. `node tools/sync.js` writes this copy. To change the grammars, edit the `grammars/` of the repository. From the repository root, run `node tools/sync.js`.

`cargo test` runs these tests:

- The shared engine and notation cases of the repository's `tests/`, apart from two engine cases whose input tokens have a `before` or `after` member
- The bootstrap fixpoint
- The DOM cache
- The API
- The core sample of the Lojban corpus
- The ranking property test in `tests/ranking.rs` compares results with every derivation of small random grammars. These grammars contain optionals, marked optionals, flat braces, separated lists, and chains.
- The tests in `tests/engine.rs` compare the place and order of lowering errors. The tests in `src/earley.rs` measure captures with many ends, which keep one completed item per end.
- The eligibility property test in `src/eligible.rs` searches eligible proof trees for small random grammars. These grammars contain chained elidable optionals and maximal terminators.
- The tests examine invariants of canonical results from shared cases. Examples include ties and ambiguous errors without positions. Other tests supply broken results to these tests.
- The witness of the check of `elision-only` (tests/README.md). The runners of the shared cases and of the corpus fail any result with the error `elision-witness-lost`. They also ask the hidden hook `gencmu::tools::with_elision_checks`, after each check, whether the check kept the chosen derivation, mapped to the reconstructed input. A watched check marks that derivation's links before it ranks.

  Its own ranking then says whether it counted them, and where its readings stand against them. The library's own tests lose that witness on purpose with `gencmu::tools::losing_witness`, which the documented API does not name. They also turn on faults of the library's own paths in the check with `gencmu::tools::with_fault`. `tests/faults.rs` shows that the shared cases catch each one, through the result or through the hook alone (tests/README.md).

`GENCMU_PROPERTY_CASES` and `GENCMU_PROPERTY_SEED` run a larger sweep. `GENCMU_CORPUS=full cargo test --release --test corpus` runs the whole corpus, on `GENCMU_CORPUS_WORKERS` threads. By default, the number of threads is one fewer than the number of cores.

The crate uses the MIT License.
