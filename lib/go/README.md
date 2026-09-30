# gencmu for Go

This is the Go library of [gencmu](../../README.md), a Lojban parser whose grammars are literate Markdown documents loaded at runtime. It implements [`docs/engine.md`](../../docs/engine.md) from the specification alone, with the standard library only. It embeds the bundled grammars.

```go
import gencmu "github.com/int19h/gencmu/lib/go"

dialect, err := gencmu.LoadDialect("cll-ebnf")
if err != nil {
	log.Fatal(err) // a *gencmu.Error, with document, line and column
}
result, err := dialect.Parse("mi klama le zarci", gencmu.ParseOptions{})
if err != nil {
	log.Fatal(err) // a caller's mistake, such as an unknown stage
}
if !result.OK {
	fmt.Println(result.Error.Message)
}
fmt.Println(gencmu.Brackets(result, gencmu.BracketOptions{ShowElided: true}))
data, _ := gencmu.MarshalResult(result) // canonical JSON, docs/output.md
```

## API

- `LoadDialect(name)` loads a bundled dialect. `name` is the name of a pipeline document under `grammars/dialects/` without `.md`.
- `LoadDialectFile(path)` loads a pipeline document from disk. The loader finds its grammar documents relative to it. A document that is not valid UTF-8 is a load error of kind `grammar`.
- `LoadDialectSources(sources, pipeline)` loads documents held in memory, a map from `/`-separated path to text. The map can hold its own `unicode.txt`, `notation/bootstrap.json` and `compiled.json`. The bundled ones fill in the rest. A `unicode.txt` in the map replaces the bundled table entirely, White_Space included (`docs/api.md`).
- `(*Dialect).Parse(text, ParseOptions{Features, WithoutFeatures, NoAutoFeatures, Until, ElisionOnly})` parses a text. A text that is not valid UTF-8 is a usage error. The `Warnings` of a result are those of the warning features that are turned on.

  For tests and tools, `(*Dialect).ParseTokens(text, tokens, options)` feeds pre-built tokens to the first stage. Each of those tokens has its `Text` as its label, whatever its `Label` says. A caller cannot supply attachments: a token with a non-empty `Before` or `After` is a usage error, and empty ones are dropped. The parse copies the tokens, so the caller's stay as they are.
- `(*Dialect).Features()` lists the features of the dialect, the gates of its classifiers' entries included. Each is a `Feature` with `Name`, `Kind` (`gate` or `warning`) and `Default`. `Default` says whether the pipeline turns the feature on.
- `MarshalResult(result)` writes the canonical JSON.
- `Brackets(result, BracketOptions{ShowElided})` renders the tree as nested groups. It shows each token by its `Label`. A token with attachments is a group of its before-attachments, its label and its after-attachments, so `mi ui klama` is `([mi ui] klama)` in the CLL dialect.

A `*Dialect` is safe for concurrent use. Source positions count Unicode code points. Spans and token indices count tokens of the relevant stage. The `Tags` of a `Token` or a `Node` are a `[]string` in code point order. Each tag appears once in its canonical spelling, such as `KOhA`, `/a/` or `'a'`.

A `Token` has `Phonemes`, what it sounds like, and `Label`, what it shows to people (engine §5). A token over a foreign part, such as the body of a `zoi` quote, sounds `?` and has the part's text as its label.

A `Token` also has its attachments, `Before` and `After` (engine §11). These are tokens that belong to it and that no later stage reads, such as the indicators after a word. They are nil when there are none. An attached token has no span: its `Span` is zero, and the canonical JSON leaves it out.

The module states Go 1.22, and CI tests it on 1.22 and the current stable release. The code needs generics and the `min` builtin (1.21). It is also written for the per-iteration loop variables of 1.22. Long-lived distributions such as Ubuntu 24.04 package 1.22 too. So a floor that old costs nothing, and the users of these distributions can build the module with the toolchain they have.

## The grammar copy

`node tools/sync.js`, run from the repository root, generates `grammars/` here from the `grammars/` of the repository. The copy exists because `embed` cannot reach outside the module and refuses symbolic links. Do not edit it. CI fails if it is out of date.

## Tests

```sh
go vet ./...
go test ./...
go test -race -run Concurrent ./...
```

The tests read the shared cases in `../../tests/`. They run every engine and notation case, the core sample of the corpus and the fixpoint of the bootstrap. For an engine case whose grammar cannot be loaded, they also compare where the error stands, when the case gives it. An engine case with `parses` loads its dialect once and parses its input with each item's options in turn. They also compare `compiled.json` with a fresh reading, with the cache both used and bypassed.

`TestCorpus` runs the core sample of the Lojban corpus (`../../tests/core.txt`) on as many goroutines as there are CPUs. The goroutines share one `*Dialect` for each dialect. `GENCMU_CORPUS=full` runs every case of `../../tests/corpus/`, and `GENCMU_CORPUS_WORKERS` sets the number of goroutines.

`TestRankingProperty` compares the ranking with a brute-force enumeration of every derivation of small random grammars. To run a larger sweep, run this command:

```sh
GENCMU_PROPERTY_CASES=200000 GENCMU_PROPERTY_SEED=1000 go test -run TestRankingProperty -timeout 30m ./...
```

For longer inputs, add `GENCMU_PROPERTY_TOKENS`. To set the percentage of cases ranked with no lean, as elision-only's check ranks them, add `GENCMU_PROPERTY_RULE1`. To run one case again and print its derivations, add `GENCMU_PROPERTY_ONLY=seed`.
