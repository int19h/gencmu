# gencmu for Rust

gencmu is a Lojban parser whose grammars are literate Markdown documents, loaded at runtime. This crate is the Rust library of [gencmu](https://github.com/int19h/gencmu). A clean-room implementation is written from the specification alone. The crate is a clean-room implementation of the engine specification, `docs/engine.md`, with no dependencies at all. The crate embeds the grammars that it bundles.

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

## The API

- `load_dialect(name)` loads a bundled dialect, the pipeline document `grammars/dialects/NAME.md`. `load_dialect_file(path)` loads a pipeline document from disk, and finds the documents that it includes relative to it. `load_dialect_sources(sources, pipeline)` loads documents held in memory, from any iterable of `(path, text)` pairs. Each returns `Result<Dialect, gencmu::Error>`.
- `Dialect::parse(&self, text, &ParseOptions) -> Result<ParseResult, Error>` parses a text. A text that does not parse is a result whose `ok` is false. The same holds for a grammar defect found while parsing, such as an entry that adds a class twice under the selected features. The `Error` is for a mistake of the caller. Examples are an unknown stage in `until`, and a feature named both to turn on and to turn off.
- `ParseOptions` has `features`, `without_features`, `auto_features` (on by default), `until` and `elision_only`. `features` names the features to turn on, besides the pipeline's own. `without_features` names the features to turn off, the pipeline's own included.
- `Dialect::features()` lists the features of the dialect in code point order, the gates of its classifiers' entries included. Each is a `Feature` with its `name`, its `kind` (`FeatureKind::Gate` or `FeatureKind::Warning`), and whether the pipeline turns it on by `default`.
- `to_json(&result)` writes the canonical JSON of `docs/output.md`.
- `to_brackets(&result, show_elided)` renders the tree as brackets. It shows each token by its label. A token with attachments is a group of its before-attachments, its label and its after-attachments, so `mi ui klama` in the `cll-ebnf` dialect is `([mi ui] klama)`.
- A `ParseResult` owns its data: the stages, the tree, the error and the warnings. Each stage has its input and output tokens, its verdict and, for a tie, its witness and tied tree.

  A token has its text, its phonemes, its label, its tags, its span and its source range. The label is what the renderings for people show. A foreign part, such as the body of a `zoi` quote, sounds `?` and has its text as its label. A pause has a space as its label.

  A token also has its attachments, `before` and `after`. These are tokens that belong to it and that no later stage reads, such as the indicators after a word. Each is an `Attachment`, a token without a span, with attachments of its own. Both lists are empty unless an emission gave the token attachments.

  The warnings are those of the warning features that are turned on. Source positions count Unicode code points. Spans and token indices count tokens of the relevant stage. Tags are a `BTreeSet<String>`, each tag in its canonical spelling, such as `'a'` for a character tag. A character token of the first stage carries only its character tag.
- `Dialect` is `Send` and `Sync`, so threads can share one dialect freely.
- For tests and tools: `Dialect::parse_tokens` feeds tokens straight to the first stage. A token that the caller supplies has its text as its label. An `InputToken` has no attachments, since a caller cannot supply them. A DOM (document object model) is the parsed form of a grammar document. `gencmu::tools` reads one grammar document to its DOM, splices a bundled pipeline into its stages, and computes the hashes of the DOM cache. `gencmu::tools::DOM_FORMAT` is the version of the DOM's shape, which every cache key holds.

  A DOM holds the document's constants, classifiers and implications as the document writes them, never their values. The loader gives each constant its value when it stitches a stage. A stage resolves its classifiers for the features of each parse, once for each set of features.

The minimum supported Rust version is 1.75.

## Development

The grammars of the crate, `grammars/`, are a copy of the grammars of the repository. `node tools/sync.js` writes this copy. To change the grammars, edit the `grammars/` of the repository. Then run `node tools/sync.js`.

`cargo test` runs these tests:

- The shared engine and notation cases of the repository's `tests/`, apart from two engine cases whose input tokens have a `before` or `after` member
- The bootstrap fixpoint
- The DOM cache
- The API
- The core sample of the Lojban corpus
- A property test of the ranking, which compares the library with a brute-force enumeration of every derivation of random small grammars

`GENCMU_PROPERTY_CASES` and `GENCMU_PROPERTY_SEED` run a larger sweep. `GENCMU_CORPUS=full cargo test --release --test corpus` runs the whole corpus, on `GENCMU_CORPUS_WORKERS` threads. By default, the number of threads is one fewer than the number of cores.

The crate uses the MIT License.
