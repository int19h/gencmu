# The library API

Every gencmu library offers the same operations on the same data. An API is the operations that a library exposes. Each library spells them the way its language spells things. This document says what the operations are. The engine specification, `docs/engine.md`, says what they compute. `docs/output.md` says what the results look like as JSON.

## What every library offers

### Loading a dialect

A dialect defines a parsing pipeline. A pipeline runs grammar stages in sequence. A stage is one step with its own grammar. A pipeline document and the grammar documents that it includes define a dialect. The pipeline document names the stages of the dialect. A library loads a dialect in three ways:

- It loads a dialect by name, from the grammars bundled in the package. The name is the file name of a pipeline document under `grammars/dialects/` without `.md`. The [dialect documents](../grammars/dialects/) define the bundled names.
- It loads a pipeline document from disk. The library finds its grammar documents relative to it. Its `unicode.txt` and `notation/bootstrap.json` come from the bundled grammars. Each document is known by its absolute path, so an error names the same file from any working directory.
- It loads documents held in memory: a map from `/`-separated path to text, and the path of the pipeline document in the map. The map can supply its own `unicode.txt`, `notation/bootstrap.json` and `compiled.json`. Any of these that the map lacks come from the bundled grammars. The exception is the portable JavaScript entry point, which has no bundle to read. There, the map must hold the first two (see "JavaScript").

A `unicode.txt` in the map replaces the bundled table entirely, with no fallback to the bundled data. This holds for `White_Space`, `Emoji_Presentation`, and `Emoji_Component` too, so the table must list the white space that the documents use. A code point that the table omits has category `Cn` and lacks all three properties (engine §1).

The include path of an `%include` resolves against the document that holds it, with `.` and `..` normalized (engine §13). A DOM (document object model) is the parsed form of a grammar document, as `docs/output.md` describes. `compiled.json` holds precompiled DOMs. A library reads a document through the notation (the grammar of grammar documents) only when `compiled.json` has no entry for it that matches. An entry matches where four values are the same: the text hash, the bootstrap hash, the Unicode table hash and the DOM format. A caller's `unicode.txt` changes the table hash, so it never reuses a DOM that another table produced.

A dialect that cannot be loaded is an error. A dialect cannot be loaded when a document is missing, does not parse as the notation, or does not stitch (combine) into a valid grammar. It also cannot be loaded when a document on disk is not valid UTF-8 (engine §1). A tie while the notation reads a document is a load error too (engine §8).

The error is an exception in JavaScript and Python, and a returned error in Go and Rust. It carries a message with the document, line and column where known. A tie has no line or column.

Ranked-choice loading errors also carry `code`, `group`, `option`, `expression`, and `inheritance` where available. `docs/output.md` defines their schema and canonical member order. These members remain outside parse-result warnings and document caches.

Grammar DOM format 35 supports templates, parameters, calls, named instances, argument lists, and backward queries. It also supports token strings, recipes, stored engine tags, method expressions, and the `conditions` member of feature directives. Written strings decompose, and engine constants keep their exact scalars. Parse-result format 15 exposes `value` and `image`. Libraries reject a bootstrap with another format and skip a cached DOM with another format. A format match alone never excuses invalid schema data.

The compatibility boundary is the format number and the notation contract. Callers supply format-35 DOMs or grammar text in the specified notation. `docs/notation.md` and `docs/output.md` define accepted forms.

The Python loaders also take `use_cache=False`. With it, the loader reads every document through the notation.

### The dialect's features

A feature is a named switch that the grammars of the dialect test (engine §13).

A loaded dialect lists its features (engine §13), in code point order of the names. The list includes the gates of the entries of its classifiers. Each feature in the list has its name, its kind (`gate` or `warning`), and whether the pipeline turns it on by default. The CLI and the playground use the list to offer the features by name. Unconditional declarations, global or stage-local, set `default:true`. The inventory does not depend on the caller's last stage. Conditional declarations contribute feature names without defaults.

### Parsing

A loaded dialect parses a text with these configuration arguments. Each argument is optional:

| Argument | Default | Meaning |
| --- | --- | --- |
| features | none | feature names to turn on for every stage, besides those the pipeline's `%features` turns on. Unknown names are legal and do not change grammar behavior. |
| without features | none | feature names to turn off for every stage, including defaults. If a conditional declaration holds for a disabled feature, the result is `feature-conflict` with its feature and stage. Unknown names are legal and do not change grammar behavior. A name in both lists is a usage error. |
| until | the last stage | the name of the last stage to run. An unknown name is an error, and so is an empty name. Go is the exception, as its section says. |
| elision-only | the grammar's own | On or off for every stage that runs. This overrides `%ambiguity-resolution ... elision-only`. |

A text must be a sequence of Unicode scalar values, or it is a usage error (engine §1). So a JavaScript or Python string with a lone surrogate is a usage error. So is a Go string that is not valid UTF-8. The same holds for a document held in memory. A document read from disk is different: bytes that are not valid UTF-8 there are a `grammar` load error, with no line or column.

A text that does not parse gives a failed result. Its `ok` is false, and its `error` explains the failure. The kind of that error is `rejected`, `ambiguous`, `feature-conflict`, or `grammar`.

An `ambiguous` error has a reason. It is `tie` where a stage has two or more best readings (engine §6). It is `elision-only` where the check of engine §7 fails.

A `feature-conflict` error names a disabled feature whose conditional declaration holds for the stage input. It also names the stage. The failed stage has a null verdict and no output. Earlier stages retain their output and warnings.

An `elision-only` error also has a witness, the pair of actions where its two readings first differ, visible if there is one (engine §7.10). Such an action can be a read of a written-back terminator, with its position and terminal. A `tie` error has no witness of its own. The tied stage holds it (`docs/output.md`).

A check that cannot recognize its chosen reconstruction before filtering reports a `grammar` error with the code `elision-witness-lost` (engine §7.9). It marks a defect of the library, not of the text.

Here, `grammar` is for a defect found only while parsing. One example is a nested parse asked about its own span as the same rule. Another is a classifier's entry that adds a class twice under the features of the parse.

Parsing is synchronous, and you can use a loaded dialect for any number of parses. In Python, Go and Rust, any number of threads can share one dialect and parse at once. JavaScript has one thread, and the worker of the playground has its own dialects.

### The result

The result has the fields of `docs/output.md`, in the data types of the language. These fields are `ok`, the stages, the `tree` of the last stage, the `error`, and the `warnings`. `warnings` is an empty list when there are no warnings.

The result also has `features`, the enabled feature names in code point order, without duplicates. This field stays outside canonical JSON. Go calls it `Features`.

It includes caller-enabled names, including unknown names, and global defaults, except names that the caller disables. It also includes features enabled by declarations in stages that the run reaches. A cutoff before a stage excludes its declarations.

A failed result retains features enabled before the failure, including earlier declarations in the failed stage. Operands before a disabled operand can enable features before that declaration reports a conflict. Each parse starts with a fresh feature set.

`unique` means exactly one [admitted derivation](notation.md#ranked-choices). `resolved` means several admitted derivations with exactly one best. Several best admitted derivations give a tie.

[Ambiguity](notation.md#ambiguity) defines how filtering and seals affect results.

The [dialect guide](dialects.md#phoneme-values-and-stress) describes the bundled stages and comparison values. The `until` argument must name a stage in the selected pipeline.

A stage exposes its name, input and output tokens, verdict, and any tie witness. Find stages by name because their order differs by dialect. A tied stage emits nothing and places both readings in the result error. A token stores text, value, image, tags, span, and source. Both strings always exist.

An `ε` item records its inserting rule and has empty source text. A token can carry before- and after-attachments, which remain token lists. Attached tokens have no stage span. An image can include neighboring text outside its source without changing its text field.

Result format 15 admits punctuation, quotes, and emoji in rule-name strings, including canonical call spellings. A named instance uses its public name everywhere, including `insertedBy`, warnings, expected lists, and error witnesses. A binding adds no tree node.

A node has its kind (`rule`, `token` or `elided`), its rule or terminal, its span and source range, its tags and its children. A token node also has the index of the token that it read. Tags are a set of tags, each a string in its canonical spelling (engine §1). Source positions count Unicode code points, whatever the string indexing of the language is. Spans and token indices count tokens of the relevant stage.

A result shares no value that can change with the dialect, or with the tokens of the caller. This holds for every tag set of a token or a node, in the chosen tree and the readings of an error. So a change to a result changes no later parse. A later change to a token of the caller does not change the result.

### Output

Every library writes the canonical JSON of a result as text, in the key order that `docs/output.md` gives. Every library also renders a result as brackets, with elided terminators hidden or shown. The JavaScript library also renders the tree listing and the display JSON, for the CLI and the playground.

### Tokens for tests and tools

Some entry points exist for tests and tools, outside the common API. They supply pre-built tokens instead of stage-zero characters.

JavaScript supplies tokens in `dialect.parse(text, { tokens, ...configuration })`. Python uses `Dialect.parse_tokens(tokens, text, ...)`. Go uses `(*Dialect).ParseTokens(text, tokens, options)`. Rust uses `Dialect::parse_tokens(tokens, options)`.

JavaScript, Python and Go take the original text beside the tokens. Token sources, `.source-text`, and `.verbatim-text` use that text.

In JavaScript, Python and Go, a caller's token has a source and a span. Its source counts code points of the text. It must start at 0 or later, end at or after its start, and end within the text. The sources of two tokens can overlap or lie out of order (engine §11).

A caller's token span counts tokens of the stage before, not code points, so it has no upper bound. The span must start at 0 or later and end at or after its start. A token that breaks the source or span rules is a usage error.

The `.verbatim-text` method searches left and right separately (engine §11.1). Each neighbor bound limits only its own side. Token order remains the caller's order.

The `InputToken` of Rust has no source and no span. The library gives each token its span, and a source in a text of the tokens' texts joined with single spaces. The generated source range always lies within that text.

A caller cannot supply attachments (engine §11). JavaScript and Python accept token-shaped input objects. Go accepts `InputToken` records. These inputs expose `before` and `after`, or `Before` and `After` in Go. Nonempty attachment lists cause a usage error. Libraries accept empty lists and drop them.

The caller supplies tags, `value`, and `image` for pre-built tokens. An omitted string defaults to `text`. An explicit empty string stays empty. The engine adds no tags and applies no normalization. The caller can supply stored engine tags to represent earlier grammar stages. The engine does not decompose them, so a caller supplies decomposed values where its grammar expects them.

All supplied string fields must contain scalar values. Invalid strings, tag names, source ranges, spans, or attachments cause a usage error before parsing. Tags follow engine §1, including its reserved engine inventory. The input object is not an output recipe and stores both strings directly.

Rust `InputToken` stores `value: Option<String>` and `image: Option<String>` alongside its text and tags. `None` uses the text default. JavaScript uses omitted `value` and `image` properties for defaults. Python uses `None` defaults for those fields. Explicit empty strings remain empty.

Go `ParseTokens` accepts `[]InputToken`. Its `Value *string` and `Image *string` use `nil` for defaults. Non-nil pointers can supply empty strings. `InputToken` also carries `Text`, `Tags`, `Span`, `Source`, `Before`, and `After`. Nonempty attachment slices remain usage errors. Output `Token` stores `Value` and `Image` as strings.

For example, a supplied token with `text:"A"`, `value:"a"`, `image:"A"`, and `tags:["Stressed"]` compares as `a` and displays as `A`. A supplied normalized comma can have `value:""`, `image:","`, and `tags:["Syllable-Break"]`. Neither token receives `_Lu` or any other engine tag unless the caller supplies it.

Each library copies the caller's tokens before it parses them, and it leaves the caller's objects unchanged.

### Tests

Every library runs each case of these tests that its API can express (`tests/README.md`):

- `tests/engine/`
- `tests/notation/`
- The fixpoint of the bootstrap, where a reading of `grammars/notation/*.md` with the bootstrap reproduces the bootstrap
- A comparison of `compiled.json` with a fresh reading, with the cache both used and bypassed

The language examples below use the bundled `cll-ebnf` dialect and its features. Their texts, stage names, and feature names illustrate API calls.

## JavaScript

`gencmu` works anywhere JavaScript runs. `gencmu/node` adds access to the disk.

```js
import { loadDialect, loadDialectFile } from "gencmu/node";
import { loadDialectSources, toJson, toBrackets } from "gencmu";

const dialect = loadDialect("cll-ebnf");
const result = dialect.parse("mi klama", { features: ["y-cmavo"], until: "words" });
const supplied = dialect.parse("A", {
    tokens: [{ text: "A", value: "a", image: "A", tags: ["_Lu", "_L"], span: [0, 1], source: [0, 1] }],
    until: "phonemes"
});
result.ok; result.tree; result.error; result.warnings;
dialect.features; // [{ name: "cll-cyrillic", kind: "gate", default: true },
                  //  { name: "sa-su", kind: "gate", default: false },
                  //  { name: "su-boundary", kind: "gate", default: true },
                  //  { name: "y-cmavo", kind: "warning", default: false }]
toJson(result); toBrackets(result, { showElided: true });
```

- `loadDialect(name)` and `loadDialectFile(path)` come from `gencmu/node`. `loadDialectSources(sources, pipelinePath)` comes from both `gencmu` and `gencmu/node`, and its `sources` is a `Map` or a plain object. The `gencmu/node` version fills in `unicode.txt`, `notation/bootstrap.json` and `compiled.json` from the bundled grammars. The `gencmu` version has no files to read. So the map must hold the first two itself, as the grammar object of the browser bundle does.
- `dialect.parse(text, { tokens, features, withoutFeatures, until, elisionOnly })` returns a `ParseResult`.
- `dialect.features` is an array of `{ name, kind, default }`.
- `toJson(result)` writes the canonical JSON as text, and `resultJson(result)` returns it as a value. `toBrackets`, `toTree`, `displayValue` and `prettyJson` render it. `toJson` and `prettyJson` do not recurse, because a tree can nest deeper than the call stack allows. `JSON.stringify` fails on such a tree.
- Errors are `GencmuError`, with `kind` and `where`.
- The lower-level `Loader`, `loaderFromSources` and `loaderFromDirectory` are available for tools that load several dialects over one set of documents.

The types are in the package's declarations (`lib/js/types/`).

## Python

```python
import gencmu

dialect = gencmu.load_dialect("cll-ebnf")
result = dialect.parse("mi klama", features={"y-cmavo"}, until="words")
tokens = [gencmu.Token(text="A", value="a", image="A", tags={"_Lu", "_L"}, span=(0, 1), source=(0, 1))]
supplied = dialect.parse_tokens(tokens, "A", until="phonemes")
result.ok, result.tree, result.error, result.warnings
dialect.features  # (Feature(name="cll-cyrillic", kind="gate", default=True),
                  #  Feature(name="sa-su", kind="gate", default=False),
                  #  Feature(name="su-boundary", kind="gate", default=True),
                  #  Feature(name="y-cmavo", kind="warning", default=False))
gencmu.to_json(result)
gencmu.to_brackets(result, show_elided=True)
```

- `load_dialect(name)`, `load_dialect_file(path)` and `load_dialect_sources(sources, pipeline)` load a dialect. `sources` is a mapping from path to text.
- `Dialect.parse(text, *, features=(), without_features=(), until=None, elision_only=None) -> ParseResult` parses a text.
- `Dialect.parse_tokens(tokens: Sequence[Token], text: str, *, features=(), without_features=(), until=None, elision_only=None) -> ParseResult` parses supplied tokens.
- `Dialect.features` is a tuple of `Feature`, a dataclass with `name`, `kind` and `default`.
- `ParseResult`, `Stage`, `Node`, `Token`, `ParseWarning` and `ParseError` are dataclasses. Tags are a set of strings. The warning class is not called `Warning`, because `Warning` is a built-in exception.
- `to_json(result) -> str` writes the canonical JSON. `result_json(result)` returns it as plain data. `to_brackets(result, *, show_elided=False)` renders the tree as brackets.
- Errors raise `gencmu.GencmuError`, with `kind` and `where`.

The package needs Python 3.14 or later. It is pure Python with no runtime dependencies.

## Go

```go
import gencmu "github.com/int19h/gencmu/lib/go"

dialect, err := gencmu.LoadDialect("cll-ebnf")
result, err := dialect.Parse("mi klama", gencmu.ParseOptions{Features: []string{"y-cmavo"}, Until: "words"})
result.OK; result.Tree; result.Error; result.Warnings
value, image := "a", "A"
supplied, err := dialect.ParseTokens("A", []gencmu.InputToken{{
    Text: "A", Value: &value, Image: &image, Tags: []string{"_Lu", "_L"},
    Span: [2]int{0, 1}, Source: [2]int{0, 1},
}}, gencmu.ParseOptions{Until: "phonemes"})
dialect.Features() // []gencmu.Feature{{Name: "cll-cyrillic", Kind: "gate", Default: true},
                   //   {Name: "sa-su", Kind: "gate", Default: false},
                   //   {Name: "su-boundary", Kind: "gate", Default: true},
                   //   {Name: "y-cmavo", Kind: "warning", Default: false}}
data, err := gencmu.MarshalResult(result)
gencmu.Brackets(result, gencmu.BracketOptions{ShowElided: true})
```

- `LoadDialect(name)`, `LoadDialectFile(path)` and `LoadDialectSources(sources map[string]string, pipeline string)` each return `(*Dialect, error)`. A load error is a `*gencmu.Error`.
- `(*Dialect).Parse(text string, options ParseOptions) (*ParseResult, error)` parses a text. The error is for a mistake of the caller, such as an unknown stage name. A text that does not parse is a result. `ParseOptions` has `Features []string`, `WithoutFeatures []string`, `Until string` and `ElisionOnly *bool`.

  `Until` is a string, so Go cannot distinguish an empty name from no name. An empty `Until` runs every stage.

- `(*Dialect).ParseTokens(text string, tokens []InputToken, options ParseOptions) (*ParseResult, error)` parses supplied tokens with the same configuration.
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
let supplied = dialect.parse_tokens(&[gencmu::InputToken {
    text: "A".into(), value: Some("a".into()), image: Some("A".into()),
    tags: ["_Lu".into(), "_L".into()].into_iter().collect(),
}], &gencmu::ParseOptions {
    until: Some("phonemes".into()), ..Default::default()
})?;
let (ok, tree, error, warnings) = (result.ok, &result.tree, &result.error, &result.warnings);
let features = dialect.features(); // &[Feature { name, kind, default }]
gencmu::to_json(&result);
gencmu::to_brackets(&result, true);
```

- `load_dialect(name)`, `load_dialect_file(path)` and `load_dialect_sources(sources, pipeline)` each return `Result<Dialect, gencmu::Error>`.
- `Dialect::parse(&self, text: &str, options: &ParseOptions) -> Result<ParseResult, Error>` parses a text. `ParseOptions` has `features`, `without_features`, `until` and `elision_only`.
- `Dialect::parse_tokens(&self, tokens: &[InputToken], options: &ParseOptions) -> Result<ParseResult, Error>` parses supplied tokens with the same configuration.
- `Dialect::features(&self) -> &[Feature]` lists the features. Each `Feature` has `name`, `kind` and `default`.
- `to_json(&ParseResult) -> String` writes the canonical JSON.
- `to_brackets(&ParseResult, show_elided: bool) -> String` renders the tree as brackets.
- A result owns its data (`String`, `Vec`) and borrows neither the text nor the dialect. So it outlives both.
- The crate has no dependencies. It states its minimum supported Rust version.
