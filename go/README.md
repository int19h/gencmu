# gencmu for Go

The Go library of [gencmu](../README.md), a Lojban parser whose grammars
are literate Markdown documents loaded at runtime. It implements
[`docs/engine.md`](../docs/engine.md) from the specification alone, with the
standard library only, and embeds the bundled grammars.

```go
import gencmu "github.com/int19h/gencmu/go"

dialect, err := gencmu.LoadDialect("cll")
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

- `LoadDialect(name)`: a bundled dialect, the name of a pipeline document
  under `grammars/dialects/` without `.md`.
- `LoadDialectFile(path)`: a pipeline document on disk, whose grammar
  documents are found relative to it.
- `LoadDialectSources(sources, pipeline)`: documents held in memory, a map
  from `/`-separated path to text. The map may hold its own `unicode.txt`,
  `notation/bootstrap.json` and `compiled.json`; the bundled ones fill in
  the rest.
- `(*Dialect).Parse(text, ParseOptions{Features, NoAutoFeatures, Until,
  ElisionOnly})`, and `(*Dialect).ParseTokens(text, tokens, options)`,
  which feeds pre-built tokens to the first stage, for tests and tools.
- `MarshalResult(result)` writes the canonical JSON; `Brackets(result,
  BracketOptions{ShowElided})` renders the tree as nested groups.

A `*Dialect` is safe for concurrent use. Positions are code points.

The module states Go 1.22, and CI tests it on 1.22 and the current stable
release. The code needs generics and the `min` builtin (1.21) and is
written for 1.22's per-iteration loop variables; 1.22 is also what
long-lived distributions such as Ubuntu 24.04 package, so a floor that old
costs nothing and lets their users build the module with the toolchain
they have.

## The grammar copy

`grammars/` here is generated from the repository's `grammars/` by
`node tools/sync.js`, run from the repository root, because `embed` cannot
reach outside the module and refuses symbolic links. Do not edit it; CI
fails if it is out of date.

## Tests

```sh
go vet ./...
go test ./...
go test -race -run Concurrent ./...
```

The tests read the shared cases in `../tests/`: every engine and notation
case, the corpus, the bootstrap's fixpoint, and `compiled.json` against a
fresh reading with the cache both used and bypassed. `TestCorpus` runs the
core sample of the Lojban corpus (`../tests/core.txt`) on as many
goroutines as there are CPUs, sharing one dialect each;
`GENCMU_CORPUS=full` runs every case of `../tests/corpus/`, and
`GENCMU_CORPUS_WORKERS` sets the number of goroutines.
`TestRankingProperty` checks the
ranking against a brute-force enumeration of every derivation of small
random grammars; a larger sweep is

```sh
GENCMU_PROPERTY_CASES=200000 GENCMU_PROPERTY_SEED=1000 go test -run TestRankingProperty -timeout 30m ./...
```

with `GENCMU_PROPERTY_TOKENS` for longer inputs, `GENCMU_PROPERTY_RULE1`
for the percentage of cases ranked by rule 1 alone, and
`GENCMU_PROPERTY_ONLY=seed` to rerun one case and print its derivations.
