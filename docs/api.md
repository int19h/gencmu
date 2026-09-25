# The library API

Every gencmu library offers the same operations on the same data, spelled the way its language spells things. This document says what they are; the engine specification, `docs/engine.md`, says what they compute, and `docs/output.md` what the results look like as JSON.

## What every library offers

**Loading a dialect.** A dialect is a pipeline document and the grammar documents it names. A library loads one in three ways:

- by name, from the grammars bundled in the package: the name is a pipeline document's file name under `grammars/dialects/` without `.md`, so `cll`, `bpfk`, `experimental`, `zantufa` and `notation`;
- from a pipeline document on disk, whose grammar documents are found relative to it, and whose `unicode.txt` and `notation/bootstrap.json` come from the bundled grammars;
- from documents held in memory: a map from `/`-separated path to text, and the path of the pipeline document in it. The map may supply its own `unicode.txt`, `notation/bootstrap.json` and `compiled.json`; any it lacks come from the bundled grammars, except in the portable JavaScript entry point, which has no bundle to read and needs the map to hold the first two (see "JavaScript").

Paths inside a pipeline resolve against the pipeline document's own path, with `.` and `..` normalized (engine §8). A document is read through the notation only when `compiled.json` has no entry for it with the same text hash, the same bootstrap hash and the same DOM format.

A dialect that cannot be loaded, because a document is missing, does not parse as the notation, or does not stitch into a valid grammar, is an error: an exception in JavaScript and Python, a returned error in Go and Rust. It carries a message with the document, line and column where known.

**Parsing.** A loaded dialect parses a text with these options, all optional:

| option | default | meaning |
| --- | --- | --- |
| features | none | feature names to turn on for every stage, besides those the pipeline's `<?features?>` turns on |
| without features | none | feature names to turn off for every stage, among them any that the pipeline's `<?features?>` turns on; a name in both lists is a usage error |
| auto features | on | add `sa-su` only where the text needs it (design, "Expensive constructs behind features"), unless `without features` names it; ignored for a dialect with no stage named `words` |
| until | the last stage | the name of the last stage to run; an unknown name is an error |
| elision-only | the grammar's own | on or off for every stage that runs, overriding `%ambiguity-resolution ... elision-only` |

A text that does not parse is not an error but a result whose `ok` is false and whose `error` says why (`rejected`, `ambiguous`, or `grammar` for a defect found only while parsing, such as a nested parse asked about its own span). Parsing is synchronous, and a loaded dialect may be used for any number of parses. In Python, Go and Rust one dialect may be shared by any number of threads parsing at once; JavaScript has one thread, and the playground's worker has its own dialects.

**The dialect's features.** A loaded dialect lists its features (engine §13), each with its name, its kind, `gate` or `warning`, and whether the pipeline turns it on by default, in code point order of the names. The CLI and the playground use the list to offer the features by name.

**The result** has the fields of `docs/output.md`, as the language's own data: whether it is `ok`, the stages, the last stage's `tree`, the `error`, and the `warnings`, an empty list when there are none. A stage has its name, its input and output tokens, its verdict, and for a tie its witness and tied tree. A node has its kind (`rule`, `token` or `elided`), its rule or terminal, its span and source range, its tags, its children, and for a token node the index of the token it read. Tags are a map from name to strength. Positions are code points, whatever the language's own string indexing.

**Output.** Every library writes the canonical JSON of a result, as text in the key order `docs/output.md` gives, and renders it as brackets, with elided terminators hidden or shown. The JavaScript library also renders the tree listing and the display JSON, for the CLI and the playground.

**Tests.** Every library runs `tests/engine/`, `tests/notation/`, the fixpoint of the bootstrap (reading `grammars/notation/*.md` with the bootstrap reproduces it) and the check that `compiled.json` matches a fresh reading, with the cache both used and bypassed.

## JavaScript

`gencmu` works anywhere JavaScript runs; `gencmu/node` adds the disk.

```js
import { loadDialect, loadDialectFile } from "gencmu/node";
import { loadDialectSources, toJson, toBrackets } from "gencmu";

const dialect = loadDialect("cll");
const result = dialect.parse("mi klama", { features: ["cbm"], until: "words" });
result.ok; result.tree; result.error; result.warnings;
dialect.features; // [{ name: "cbm", kind: "gate", default: false }, ...]
toJson(result); toBrackets(result, { showElided: true });
```

- `loadDialect(name)` and `loadDialectFile(path)` from `gencmu/node`, and `loadDialectSources(sources, pipelinePath)`, where `sources` is a `Map` or a plain object. The `gencmu/node` version fills in `unicode.txt`, `notation/bootstrap.json` and `compiled.json` from the bundled grammars; the `gencmu` version, which has no files to read, needs the map to hold the first two itself, as the browser bundle's grammar object does.
- `dialect.parse(text, { features, withoutFeatures, autoFeatures, until, elisionOnly })` returns a `ParseResult`; `autoFeatures` defaults to `true`.
- `dialect.features` is an array of `{ name, kind, default }`.
- `toJson(result)` writes the canonical JSON as text and `resultJson(result)` returns it as a value; `toBrackets`, `toTree`, `displayValue` and `prettyJson` render it. `toJson` and `prettyJson` do not recurse, since a tree can nest deeper than the call stack allows, which `JSON.stringify` does not survive.
- Errors are `GencmuError`, with `kind` and `where`.
- The lower-level `Loader`, `loaderFromSources` and `loaderFromDirectory` stay available for tools that load several dialects over one set of documents.

The types are in the package's declarations (`lib/js/types/`).

## Python

```python
import gencmu

dialect = gencmu.load_dialect("cll")
result = dialect.parse("mi klama", features={"cbm"}, until="words")
result.ok, result.tree, result.error, result.warnings
dialect.features  # (Feature(name="cbm", kind="gate", default=False), ...)
gencmu.to_json(result)
gencmu.to_brackets(result, show_elided=True)
```

- `load_dialect(name)`, `load_dialect_file(path)`, `load_dialect_sources(sources, pipeline)` where `sources` is a mapping from path to text.
- `Dialect.parse(text, *, features=(), without_features=(), auto_features=True, until=None, elision_only=None) -> ParseResult`.
- `Dialect.features` is a tuple of `Feature`, a dataclass with `name`, `kind` and `default`.
- `ParseResult`, `Stage`, `Node`, `Token`, `ParseWarning` and `ParseError` are dataclasses; tags are `dict[str, bool]`. The warning class is not called `Warning`, which is a built-in exception.
- `to_json(result) -> str` writes the canonical JSON; `result_json(result)` returns it as plain data. `to_brackets(result, *, show_elided=False)`.
- Errors raise `gencmu.GencmuError`, with `kind` and `where`.

Python 3.10 and later; the package is pure Python with no dependencies.

## Go

```go
import gencmu "github.com/int19h/gencmu/lib/go"

dialect, err := gencmu.LoadDialect("cll")
result, err := dialect.Parse("mi klama", gencmu.ParseOptions{Features: []string{"cbm"}, Until: "words"})
result.OK; result.Tree; result.Error; result.Warnings
dialect.Features() // []gencmu.Feature{{Name: "cbm", Kind: "gate", Default: false}, ...}
data, err := gencmu.MarshalResult(result)
gencmu.Brackets(result, gencmu.BracketOptions{ShowElided: true})
```

- `LoadDialect(name)`, `LoadDialectFile(path)`, `LoadDialectSources(sources map[string]string, pipeline string)`, each returning `(*Dialect, error)`; a load error is a `*gencmu.Error`.
- `(*Dialect).Parse(text string, options ParseOptions) (*ParseResult, error)`, where the error is for a caller's mistake, such as an unknown stage name, and a text that does not parse is a result. `ParseOptions` has `Features []string`, `WithoutFeatures []string`, `NoAutoFeatures bool` (auto features are on unless it is set), `Until string` and `ElisionOnly *bool`.
- `(*Dialect).Features() []Feature`, where `Feature` has `Name`, `Kind` and `Default`.
- `MarshalResult(result) ([]byte, error)` writes the canonical JSON.
- A `*Dialect` is safe for concurrent use by any number of goroutines.

## Rust

```rust
let dialect = gencmu::load_dialect("cll")?;
let result = dialect.parse("mi klama", &gencmu::ParseOptions {
    features: vec!["cbm".into()],
    until: Some("words".into()),
    ..Default::default()
})?;
let (ok, tree, error, warnings) = (result.ok, &result.tree, &result.error, &result.warnings);
let features = dialect.features(); // &[Feature { name, kind, default }]
gencmu::to_json(&result);
gencmu::to_brackets(&result, true);
```

- `load_dialect(name)`, `load_dialect_file(path)`, `load_dialect_sources(sources, pipeline)`, each returning `Result<Dialect, gencmu::Error>`.
- `Dialect::parse(&self, text: &str, options: &ParseOptions) -> Result<ParseResult, Error>`; `ParseOptions` has `features` and `without_features`, and `ParseOptions::default()` has auto features on.
- `Dialect::features(&self) -> &[Feature]`, where `Feature` has `name`, `kind` and `default`.
- `to_json(&ParseResult) -> String`; `to_brackets(&ParseResult, show_elided: bool) -> String`.
- A result owns its data (`String`, `Vec`), borrowing neither the text nor the dialect, so it outlives both.
- No dependencies; the crate states its minimum supported Rust version.
