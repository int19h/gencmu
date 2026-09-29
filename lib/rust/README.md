# gencmu for Rust

gencmu is a Lojban parser whose grammars are literate Markdown documents, loaded at runtime. This crate is the Rust library of [gencmu](https://github.com/int19h/gencmu). It is a clean-room implementation of the engine specification, `docs/engine.md`, with no dependencies at all. A clean-room implementation is written from the specification alone. The crate embeds the grammars that it bundles.

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
- `Dialect::parse(&self, text, &ParseOptions) -> Result<ParseResult, Error>`. A text that does not parse is a result whose `ok` is false. The `Error` is for a mistake of the caller. Examples are an unknown stage in `until`, and a feature named both to turn on and to turn off. `ParseOptions` has `features` and `without_features`, the features to turn on and off besides the pipeline's own, `auto_features` (on by default), `until` and `elision_only`.
- `Dialect::features()` lists the features of the dialect in code point order. Each is a `Feature` with its `name`, its `kind` (`FeatureKind::Gate` or `FeatureKind::Warning`), and whether the pipeline turns it on by `default`.
- `to_json(&result)` writes the canonical JSON of `docs/output.md`.
- `to_brackets(&result, show_elided)` renders the tree as brackets.
- A `ParseResult` owns its data: the stages, the tree, the error and the warnings. Each stage has its input and output tokens, its verdict and, for a tie, its witness. The warnings are those of the warning features that are turned on. Positions are Unicode code points. Tags are a `BTreeSet<String>`, each tag in its canonical spelling, such as `'a'` for a character tag.
- `Dialect` is `Send` and `Sync`, so threads can share one dialect freely.
- For tests and tools: `Dialect::parse_tokens` feeds tokens straight to the first stage. A DOM (document object model) is the parsed form of a grammar document. `gencmu::tools` reads one grammar document to its DOM, splices a bundled pipeline into its stages, and computes the hashes of the DOM cache.

The minimum supported Rust version is 1.75.

## Development

The grammars of the crate, `grammars/`, are a copy of the grammars of the repository. `node tools/sync.js` writes this copy. To change the grammars, edit the `grammars/` of the repository. Then run `node tools/sync.js`.

`cargo test` runs these tests:

- The shared engine and notation cases of the `tests/` of the repository
- The bootstrap fixpoint
- The DOM cache
- The API
- The core sample of the Lojban corpus
- A property test of the ranking, which compares the library with a brute-force enumeration of every derivation of random small grammars

`GENCMU_PROPERTY_CASES` and `GENCMU_PROPERTY_SEED` run a larger sweep. `GENCMU_CORPUS=full cargo test --release --test corpus` runs the whole corpus, on `GENCMU_CORPUS_WORKERS` threads. By default, the number of threads is one fewer than the number of cores.

The crate uses the MIT License.
