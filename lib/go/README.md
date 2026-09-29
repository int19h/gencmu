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
- `LoadDialectFile(path)`: a pipeline document on disk. The loader finds its grammar documents relative to it.
- `LoadDialectSources(sources, pipeline)`: documents held in memory, a map from `/`-separated path to text. The map can hold its own `unicode.txt`, `notation/bootstrap.json` and `compiled.json`. The bundled ones fill in the rest.
- `(*Dialect).Parse(text, ParseOptions{Features, WithoutFeatures, NoAutoFeatures, Until, ElisionOnly})` parses a text. For tests and tools, `(*Dialect).ParseTokens(text, tokens, options)` feeds pre-built tokens to the first stage. The `Warnings` of a result are those of the warning features that are turned on.
- `(*Dialect).Features()`: the features of the dialect. Each is a `Feature` with `Name`, `Kind` (`gate` or `warning`) and `Default`. `Default` says whether the pipeline turns the feature on.
- `MarshalResult(result)` writes the canonical JSON.
- `Brackets(result, BracketOptions{ShowElided})` renders the tree as nested groups.

A `*Dialect` is safe for concurrent use. Positions are code points. The `Tags` of a `Token` or a `Node` are a `[]string` in code point order, each tag once in its canonical spelling, such as `KOhA`, `/a/` or `'a'`.

The module states Go 1.22, and CI tests it on 1.22 and the current stable release. The code needs generics and the `min` builtin (1.21). It is also written for the per-iteration loop variables of 1.22. Long-lived distributions such as Ubuntu 24.04 package 1.22 too. So a floor that old costs nothing, and the users of these distributions can build the module with the toolchain they have.

## The grammar copy

`node tools/sync.js`, run from the repository root, generates `grammars/` here from the `grammars/` of the repository. The copy exists because `embed` cannot reach outside the module and refuses symbolic links. Do not edit it. CI fails if it is out of date.

## Tests

```sh
go vet ./...
go test ./...
go test -race -run Concurrent ./...
```

The tests read the shared cases in `../../tests/`. They run every engine and notation case, the corpus and the fixpoint of the bootstrap. They also compare `compiled.json` with a fresh reading, with the cache both used and bypassed.

`TestCorpus` runs the core sample of the Lojban corpus (`../../tests/core.txt`) on as many goroutines as there are CPUs. The goroutines share one `*Dialect` for each dialect. `GENCMU_CORPUS=full` runs every case of `../../tests/corpus/`, and `GENCMU_CORPUS_WORKERS` sets the number of goroutines.

`TestRankingProperty` compares the ranking with a brute-force enumeration of every derivation of small random grammars. To run a larger sweep, run this command:

```sh
GENCMU_PROPERTY_CASES=200000 GENCMU_PROPERTY_SEED=1000 go test -run TestRankingProperty -timeout 30m ./...
```

For longer inputs, add `GENCMU_PROPERTY_TOKENS`. To set the percentage of cases ranked with no lean, as elision-only's check ranks them, add `GENCMU_PROPERTY_RULE1`. To run one case again and print its derivations, add `GENCMU_PROPERTY_ONLY=seed`.
