# gencmu for Python

gencmu is a Lojban parser whose grammars are literate Markdown documents loaded at runtime. This is the Python library. It is pure Python, uses the standard library only, and needs Python 3.10 or later. It implements the engine specification of the gencmu repository, `docs/engine.md`. Its results are the canonical JSON of `docs/output.md`.

```python
import gencmu

dialect = gencmu.load_dialect("cll-ebnf")
result = dialect.parse("mi klama le zarci")
result.ok, result.tree, result.error, result.warnings
gencmu.to_json(result)
gencmu.to_brackets(result, show_elided=True)
```

## Loading a dialect

A dialect is a pipeline document and the documents that it includes. The pipeline declares its stages with `%stage`, and the grammar documents of each stage with `%include`. It declares the features that it turns on with `%features` (`docs/notation.md`, "Pipelines").

- `load_dialect(name)` loads a dialect of the bundled grammars. `name` is the name of its pipeline document under `grammars/dialects/` without `.md`.
- `load_dialect_file(path)`: a pipeline document on disk. The loader finds its grammar documents relative to it. The Unicode table and the bootstrap of the notation come from the bundled grammars.
- `load_dialect_sources(sources, pipeline)`: documents held in memory, a mapping from `/`-separated path to text, and the path of the pipeline document in it. The mapping can hold its own `unicode.txt`, `notation/bootstrap.json` and `compiled.json`. The bundled ones fill in what it lacks. A `unicode.txt` in the map replaces the bundled table entirely, White_Space included (`docs/api.md`).

The loader reads a grammar document through the notation (the grammar of grammar documents) only when `compiled.json` has no matching entry. `compiled.json` holds the precompiled DOMs, the parsed forms of the grammar documents. An entry matches when it is for the same text, under the same bootstrap and DOM format. Reading a large grammar through the notation is slow in pure Python. So the bundled grammars all have an entry. Each loader takes `use_cache=False` to read every document afresh.

An entry holds a document's constants (`%const` and `%redefine-const`) as the document writes them, never their values. The loader gives each constant its value when it stitches a stage (`docs/engine.md`, §2). So a document that several stages or dialects include takes the values of each, and one entry serves them all.

A dialect that cannot be loaded raises `gencmu.GencmuError`. Its `kind` is `"grammar"`, and its `where` is `document:line:column` as far as it is known. An error of a constant stands at the definition that is wrong, or else at the reference to the constant. A document on disk that is not valid UTF-8 is such an error, with no line or column. A document in the mapping with a lone surrogate is the caller's mistake, of `kind` `"usage"`.

## Parsing

```python
result = dialect.parse(text, features=(), without_features=(), auto_features=True, until=None, elision_only=None)
```

- `features`: feature names to turn on in every stage, besides those the pipeline turns on with `%features`.
- `without_features`: feature names to turn off in every stage, including those that the pipeline turns on. A name in both lists raises `GencmuError` with `kind` `"usage"`.
- `auto_features`: add `sa-su` only where the text needs it. To find out, the parser first parses up to the stage named `words` without `sa-su`. This works only in a dialect that has `sa-su` as a gate and a stage named `words`. It does nothing if `sa-su` is already on, if `without_features` names it, or if `until` names a stage before `words`.
- `until`: the name of the last stage to run. An unknown name raises `GencmuError` with `kind` `"usage"`.
- `elision_only`: `True` or `False` to override the grammars' `%ambiguity-resolution ... elision-only`.

A `text` with a lone surrogate raises `GencmuError` with `kind` `"usage"`. A text that does not parse is a result whose `ok` is false and whose `error` says why. The kind of that error is `rejected`, `ambiguous` or `grammar`. Here, `grammar` is for a defect of a grammar found only while parsing. For tests and tools, `Dialect.parse_tokens(tokens, text, ...)` takes pre-built tokens in place of the characters of the first stage.

`dialect.features` lists the features of the dialect in code point order of their names, as a tuple of `Feature`. Each `Feature` has these fields:

- `name`
- `kind`: `"gate"` for a guard `f?` or `¬f?`, or `"warning"` for `f!`
- `default`: whether the pipeline turns the feature on

A dialect whose guards use one name both as a gate and as a warning cannot be loaded.

You can use a dialect for any number of parses, and you can share it between threads.

## The result

`ParseResult`, `Stage`, `Node`, `Token`, `ParseError`, `ParseWarning`, `Action` and `Expected` are dataclasses. A tag set is a `frozenset[str]` of tags, each in its canonical spelling, such as `KOhA`, `/a/` or `'a'` (`docs/engine.md`, §1). A character token of the first stage carries one tag, its character tag. A terminal in a token node, witness or expected list is a tag, range or property. A range or property uses its written form, such as `'a'..'z'` or `'\p{L}'` (`docs/engine.md`, §4). An expected list writes a terminal that carries a test in a body with its test, such as `LE="la"` or `KOhA∩UI=∅` (`docs/output.md`). Spans are `(start, end)` tuples, and source ranges are in code points.

`result.warnings` lists the warnings of the nodes of the chosen tree of each stage. A node has one `ParseWarning` for each warning guard `f!` of its alternative whose feature `f` is on. The warnings come in stage order and then in tree order. Each has its `stage`, `feature`, `rule`, `span` and `source`. The list is empty when there are no warnings.

- `gencmu.to_json(result)` is the canonical JSON as text, in the key order of `docs/output.md`.
- `gencmu.result_json(result)` is the same as plain data.
- `gencmu.to_brackets(result, show_elided=False)` renders the last stage's tree as nested groups.

## Development

`node tools/sync.js` generates the grammar copy under `src/gencmu/grammars/`. After you change `grammars/`, run `node tools/sync.js` at the repository root.

The tests use only `unittest` and run from this directory against the sources in `src/`:

```sh
python -m unittest
```

The tests cover these items:

- The shared cases of `tests/engine/` and `tests/notation/` in the repository, with the position of each load error that a case gives
- The fixpoint of the bootstrap of the notation
- A comparison of `compiled.json` with a fresh reading
- The API
- A property test of the ranking against brute-force enumeration
- The core sample of the Lojban corpus (`tests/core.txt`)

`GENCMU_CORPUS=full` runs every corpus case, on a pool of processes. `GENCMU_CORPUS_WORKERS` sets the size of the pool. A book chapter of about 15,000 characters takes up to a minute and about a gigabyte. `GENCMU_PROPERTY_CASES` and `GENCMU_PROPERTY_SEED` run a larger sweep of the property test. `GENCMU_INSTALLED=1` tests an installed package instead of `src/`.

The wheel build needs `build` and setuptools, at build time only. To build the wheel, run this command:

```sh
python -m build
```
