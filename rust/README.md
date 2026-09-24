# gencmu for Rust

A Lojban parser whose grammars are literate Markdown documents, loaded at
runtime. This crate is the Rust library of
[gencmu](https://github.com/int19h/gencmu): a clean-room implementation of
the engine specification, `docs/engine.md`, with no dependencies at all.
The grammars it bundles are embedded in the crate.

```rust
// in a function that returns Result<_, gencmu::Error>
let dialect = gencmu::load_dialect("notation")?;
let result = dialect.parse("text ≔ A ;", &gencmu::ParseOptions::default())?;
if result.ok {
    println!("{}", gencmu::to_brackets(&result, true));
} else if let Some(error) = &result.error {
    println!("{error}");
}
println!("{}", gencmu::to_json(&result));
```

## The API

- `load_dialect(name)` loads a bundled dialect, the pipeline document
  `grammars/dialects/NAME.md`; `load_dialect_file(path)` loads a pipeline
  document from disk, finding its grammar documents relative to it; and
  `load_dialect_sources(sources, pipeline)` loads documents held in memory,
  any iterable of `(path, text)` pairs. Each returns
  `Result<Dialect, gencmu::Error>`.
- `Dialect::parse(&self, text, &ParseOptions) -> Result<ParseResult, Error>`.
  A text that does not parse is a result whose `ok` is false; the `Error`
  is for a caller's mistake, such as an unknown stage in `until`.
  `ParseOptions` has `features`, `auto_features` (on by default), `until`
  and `elision_only`.
- `to_json(&result)` writes the canonical JSON of `docs/output.md`;
  `to_brackets(&result, show_elided)` renders the tree as brackets.
- A `ParseResult` owns its data: stages with their input and output
  tokens, verdicts and tie witnesses, the tree, and the error. Positions
  are Unicode code points; tags are a `BTreeMap<String, bool>`, `true`
  for strong.
- `Dialect` is `Send` and `Sync`: share one between threads freely.
- For tests and tools: `Dialect::parse_tokens` feeds tokens straight to
  the first stage, and `gencmu::tools` reads one grammar document to its
  DOM and computes the hashes of the DOM cache.

The minimum supported Rust version is 1.75.

## Development

The crate's grammars, `grammars/`, are a copy of the repository's that
`node tools/sync.js` writes; edit the repository's `grammars/` and run it.
`cargo test` runs the shared engine and notation cases of the repository's
`tests/`, the bootstrap fixpoint, the DOM cache, the API, and a property
test of the ranking, which compares the library with a brute-force
enumeration of every derivation of random small grammars.
`GENCMU_RANKING_CASES` and `GENCMU_RANKING_SEED` run a larger sweep.

MIT licensed.
