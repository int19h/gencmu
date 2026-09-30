# The library API

Every gencmu library offers the same operations on the same data. Each library spells them the way its language spells things. This document says what the operations are. The engine specification, `docs/engine.md`, says what they compute. `docs/output.md` says what the results look like as JSON.

## What every library offers

### Loading a dialect

A pipeline document and the grammar documents that it includes define a dialect. The pipeline document names the stages of the dialect. A library loads a dialect in three ways:

- It loads a dialect by name, from the grammars bundled in the package. The name is the file name of a pipeline document under `grammars/dialects/` without `.md`. So the names are `cll-ebnf`, `bpfk`, `experimental`, `zantufa` and `notation`.
- It loads a pipeline document from disk. The library finds its grammar documents relative to it. Its `unicode.txt` and `notation/bootstrap.json` come from the bundled grammars.
- It loads documents held in memory: a map from `/`-separated path to text, and the path of the pipeline document in the map. The map can supply its own `unicode.txt`, `notation/bootstrap.json` and `compiled.json`. Any of these that the map lacks come from the bundled grammars. The exception is the portable JavaScript entry point, which has no bundle to read. There, the map must hold the first two (see "JavaScript").

A `unicode.txt` in the map replaces the bundled table entirely, with no fallback to the bundled data. This holds for `White_Space` too, so the table must list the white space that the documents use. A code point that the table omits has the category `Cn`, no White_Space and no lowercase mapping (engine §1).

The path of an `%include` resolves against the document that holds it, with `.` and `..` normalized (engine §13). A DOM (document object model) is the parsed form of a grammar document, as `docs/output.md` describes. `compiled.json` holds precompiled DOMs. A library reads a document through the notation (the grammar of grammar documents) only when `compiled.json` has no entry for it that matches. An entry matches when it has the same text hash, the same bootstrap hash and the same DOM format.

A dialect that cannot be loaded is an error. A dialect cannot be loaded when a document is missing, does not parse as the notation, or does not stitch (combine) into a valid grammar. It also cannot be loaded when a document on disk is not valid UTF-8 (engine §1). The error is an exception in JavaScript and Python, and a returned error in Go and Rust. It carries a message with the document, line and column where known.

### Parsing

A feature is a named switch that the grammars of the dialect test (engine §13). A loaded dialect parses a text with these options, all optional:

| option | default | meaning |
| --- | --- | --- |
| features | none | feature names to turn on for every stage, besides those the pipeline's `%features` turns on |
| without features | none | feature names to turn off for every stage, including any that the `%features` of the pipeline turns on. A name in both lists is a usage error. |
| auto features | on | add `sa-su` only where the text needs it (design, "Expensive constructs behind features"). It does nothing when `without features` names `sa-su` or `sa-su` is already on. It also does nothing when the dialect has no gate `sa-su`, or when the run does not reach a stage named `words` (engine §13). |
| until | the last stage | the name of the last stage to run. An unknown name is an error. |
| elision-only | the grammar's own | on or off for every stage that runs, overriding `%ambiguity-resolution ... elision-only` |

A text must be a sequence of Unicode scalar values, or it is a usage error (engine §1). So a JavaScript or Python string with a lone surrogate is a usage error. So is a Go string that is not valid UTF-8. The same holds for a document held in memory. A document read from disk is different: bytes that are not valid UTF-8 there are a `grammar` load error, with no line or column.

A text that does not parse is not an error, but a result whose `ok` is false and whose `error` says why. The kind of that error is `rejected`, `ambiguous` or `grammar`. Here, `grammar` is for a defect found only while parsing. One example is a nested parse asked about its own span as the same rule. Another is a classifier's entry that adds a class twice under the features of the parse.

Parsing is synchronous, and you can use a loaded dialect for any number of parses. In Python, Go and Rust, any number of threads can share one dialect and parse at once. JavaScript has one thread, and the worker of the playground has its own dialects.

Some entry points exist for tests and tools. They are outside the common API, and each language spells them its own way. Each library can feed pre-built tokens to the first stage in place of the characters of a text. This is the `tokens` option in JavaScript, `Dialect.parse_tokens(tokens, text, ...)` in Python, `(*Dialect).ParseTokens(text, tokens, options)` in Go, and `Dialect::parse_tokens(tokens, options)` in Rust. A token that the caller supplies has its text as its label (engine §5).

A caller cannot supply attachments (engine §11). In JavaScript, Python and Go, a caller's token has the type of a token that a stage emits. So it can hold attachments: `before` and `after`, or `Before` and `After` in Go. In these three libraries, a caller's token whose attachments are not empty is a usage error. The library accepts empty lists and drops them. The `InputToken` of Rust has no such fields.

Each library copies the caller's tokens before it parses them, and it leaves the caller's objects unchanged.

The Python loaders also take `use_cache=False`. With it, the loader reads every document through the notation.

### The dialect's features

A loaded dialect lists its features (engine §13), in code point order of the names. The list includes the gates of the entries of its classifiers. Each feature in the list has its name, its kind (`gate` or `warning`), and whether the pipeline turns it on by default. The CLI and the playground use the list to offer the features by name.

### The result

The result has the fields of `docs/output.md`, in the data types of the language. These fields are `ok`, the stages, the `tree` of the last stage, the `error`, and the `warnings`. `warnings` is an empty list when there are no warnings.

A stage has its name, its input and output tokens, its verdict, and for a tie its witness and tied tree. A token has its text, its phonemes, its label, its tags, its span and its source range. An inserted token also names the rule that inserted it. A token also has its attachments, `before` and `after`, two lists of tokens (engine §11). An attached token has no span.

A node has its kind (`rule`, `token` or `elided`), its rule or terminal, its span and source range, its tags and its children. A token node also has the index of the token that it read. Tags are a set of tags, each a string in its canonical spelling (engine §1). Source positions count Unicode code points, whatever the string indexing of the language is. Spans and token indices count tokens of the relevant stage.

### Output

Every library writes the canonical JSON of a result as text, in the key order that `docs/output.md` gives. Every library also renders a result as brackets, with elided terminators hidden or shown. The JavaScript library also renders the tree listing and the display JSON, for the CLI and the playground.

### Tests

Every library runs each case of these tests that its API can express (`tests/README.md`):

- `tests/engine/`
- `tests/notation/`
- The fixpoint of the bootstrap, where a reading of `grammars/notation/*.md` with the bootstrap reproduces the bootstrap
- A comparison of `compiled.json` with a fresh reading, with the cache both used and bypassed

## JavaScript

`gencmu` works anywhere JavaScript runs. `gencmu/node` adds access to the disk.

```js
import { loadDialect, loadDialectFile } from "gencmu/node";
import { loadDialectSources, toJson, toBrackets } from "gencmu";

const dialect = loadDialect("cll-ebnf");
const result = dialect.parse("mi klama", { features: ["y-cmavo"], until: "words" });
result.ok; result.tree; result.error; result.warnings;
dialect.features; // [{ name: "cll-cyrillic", kind: "gate", default: true },
                  //  { name: "sa-su", kind: "gate", default: false },
                  //  { name: "su-boundary", kind: "gate", default: false },
                  //  { name: "y-cmavo", kind: "warning", default: false }]
toJson(result); toBrackets(result, { showElided: true });
```

- `loadDialect(name)` and `loadDialectFile(path)` come from `gencmu/node`. `loadDialectSources(sources, pipelinePath)` comes from both `gencmu` and `gencmu/node`, and its `sources` is a `Map` or a plain object. The `gencmu/node` version fills in `unicode.txt`, `notation/bootstrap.json` and `compiled.json` from the bundled grammars. The `gencmu` version has no files to read. So the map must hold the first two itself, as the grammar object of the browser bundle does.
- `dialect.parse(text, { features, withoutFeatures, autoFeatures, until, elisionOnly })` returns a `ParseResult`. `autoFeatures` defaults to `true`.
- `dialect.features` is an array of `{ name, kind, default }`.
- `toJson(result)` writes the canonical JSON as text, and `resultJson(result)` returns it as a value. `toBrackets`, `toTree`, `displayValue` and `prettyJson` render it. `toJson` and `prettyJson` do not recurse, because a tree can nest deeper than the call stack allows. `JSON.stringify` fails on such a tree.
- Errors are `GencmuError`, with `kind` and `where`.
- The lower-level `Loader`, `loaderFromSources` and `loaderFromDirectory` stay available for tools that load several dialects over one set of documents.

The types are in the package's declarations (`lib/js/types/`).

## Python

```python
import gencmu

dialect = gencmu.load_dialect("cll-ebnf")
result = dialect.parse("mi klama", features={"y-cmavo"}, until="words")
result.ok, result.tree, result.error, result.warnings
dialect.features  # (Feature(name="cll-cyrillic", kind="gate", default=True),
                  #  Feature(name="sa-su", kind="gate", default=False),
                  #  Feature(name="su-boundary", kind="gate", default=False),
                  #  Feature(name="y-cmavo", kind="warning", default=False))
gencmu.to_json(result)
gencmu.to_brackets(result, show_elided=True)
```

- `load_dialect(name)`, `load_dialect_file(path)` and `load_dialect_sources(sources, pipeline)` load a dialect. `sources` is a mapping from path to text.
- `Dialect.parse(text, *, features=(), without_features=(), auto_features=True, until=None, elision_only=None) -> ParseResult` parses a text.
- `Dialect.features` is a tuple of `Feature`, a dataclass with `name`, `kind` and `default`.
- `ParseResult`, `Stage`, `Node`, `Token`, `ParseWarning` and `ParseError` are dataclasses. Tags are a set of strings. The warning class is not called `Warning`, because `Warning` is a built-in exception.
- `to_json(result) -> str` writes the canonical JSON. `result_json(result)` returns it as plain data. `to_brackets(result, *, show_elided=False)` renders the tree as brackets.
- Errors raise `gencmu.GencmuError`, with `kind` and `where`.

The package needs Python 3.10 or later. It is pure Python with no dependencies.

## Go

```go
import gencmu "github.com/int19h/gencmu/lib/go"

dialect, err := gencmu.LoadDialect("cll-ebnf")
result, err := dialect.Parse("mi klama", gencmu.ParseOptions{Features: []string{"y-cmavo"}, Until: "words"})
result.OK; result.Tree; result.Error; result.Warnings
dialect.Features() // []gencmu.Feature{{Name: "cll-cyrillic", Kind: "gate", Default: true},
                   //   {Name: "sa-su", Kind: "gate", Default: false},
                   //   {Name: "su-boundary", Kind: "gate", Default: false},
                   //   {Name: "y-cmavo", Kind: "warning", Default: false}}
data, err := gencmu.MarshalResult(result)
gencmu.Brackets(result, gencmu.BracketOptions{ShowElided: true})
```

- `LoadDialect(name)`, `LoadDialectFile(path)` and `LoadDialectSources(sources map[string]string, pipeline string)` each return `(*Dialect, error)`. A load error is a `*gencmu.Error`.
- `(*Dialect).Parse(text string, options ParseOptions) (*ParseResult, error)` parses a text. The error is for a mistake of the caller, such as an unknown stage name. A text that does not parse is a result. `ParseOptions` has `Features []string`, `WithoutFeatures []string`, `NoAutoFeatures bool`, `Until string` and `ElisionOnly *bool`. Auto features are on unless `NoAutoFeatures` is set.
- `(*Dialect).Features() []Feature` lists the features. Each `Feature` has `Name`, `Kind` and `Default`.
- `MarshalResult(result) ([]byte, error)` writes the canonical JSON.
- A `*Dialect` is safe for concurrent use by any number of goroutines.

## Rust

```rust
let dialect = gencmu::load_dialect("cll-ebnf")?;
let result = dialect.parse("mi klama", &gencmu::ParseOptions {
    features: vec!["y-cmavo".into()],
    until: Some("words".into()),
    ..Default::default()
})?;
let (ok, tree, error, warnings) = (result.ok, &result.tree, &result.error, &result.warnings);
let features = dialect.features(); // &[Feature { name, kind, default }]
gencmu::to_json(&result);
gencmu::to_brackets(&result, true);
```

- `load_dialect(name)`, `load_dialect_file(path)` and `load_dialect_sources(sources, pipeline)` each return `Result<Dialect, gencmu::Error>`.
- `Dialect::parse(&self, text: &str, options: &ParseOptions) -> Result<ParseResult, Error>` parses a text. `ParseOptions` has `features`, `without_features`, `auto_features`, `until` and `elision_only`, and `ParseOptions::default()` has auto features on.
- `Dialect::features(&self) -> &[Feature]` lists the features. Each `Feature` has `name`, `kind` and `default`.
- `to_json(&ParseResult) -> String` writes the canonical JSON.
- `to_brackets(&ParseResult, show_elided: bool) -> String` renders the tree as brackets.
- A result owns its data (`String`, `Vec`) and borrows neither the text nor the dialect. So it outlives both.
- The crate has no dependencies. It states its minimum supported Rust version.
