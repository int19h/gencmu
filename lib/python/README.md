# gencmu for Python

A Lojban parser whose grammars are literate Markdown documents loaded at runtime. This is the Python library: pure Python, standard library only, Python 3.10 and later. It implements the engine specification of the gencmu repository, `docs/engine.md`, and its results are the canonical JSON of `docs/output.md`.

```python
import gencmu

dialect = gencmu.load_dialect("cll")
result = dialect.parse("mi klama le zarci")
result.ok, result.tree, result.error, result.warnings
gencmu.to_json(result)
gencmu.to_brackets(result, show_elided=True)
```

## Loading a dialect

A dialect is a pipeline document and the grammar documents it names.

- `load_dialect(name)`: a dialect of the bundled grammars, by the name of its pipeline document under `grammars/dialects/` without `.md`.
- `load_dialect_file(path)`: a pipeline document on disk; its grammar documents are found relative to it, and the Unicode table and the notation's bootstrap come from the bundled grammars.
- `load_dialect_sources(sources, pipeline)`: documents held in memory, a mapping from `/`-separated path to text, and the path of the pipeline document in it. The mapping may hold its own `unicode.txt`, `notation/bootstrap.json` and `compiled.json`; the bundled ones fill in what it lacks.

A grammar document is read through the notation only when the precompiled DOMs, `compiled.json`, have no entry for its text under the same bootstrap and DOM format; reading a large grammar through the notation is slow in pure Python, so the bundled grammars all have one. Each loader takes `use_cache=False` to read every document afresh. A dialect that cannot be loaded raises `gencmu.GencmuError`, whose `kind` is `"grammar"` and whose `where` is `document:line:column` as far as it is known.

## Parsing

```python
result = dialect.parse(text, features=(), without_features=(), auto_features=True, until=None, elision_only=None)
```

- `features`: feature names to turn on in every stage, besides those the pipeline turns on with `<?features?>`.
- `without_features`: feature names to turn off in every stage, the pipeline's among them. A name in both lists raises `GencmuError` with `kind` `"usage"`.
- `auto_features`: add `sa-su` only where the text needs it, by parsing up to the stage named `words` without it first; only in a dialect where `sa-su` is a gate, and not when `without_features` names it.
- `until`: the name of the last stage to run; an unknown name raises `GencmuError` with `kind` `"usage"`.
- `elision_only`: `True` or `False` to override the grammars' `%ambiguity-resolution ... elision-only`.

A text that does not parse is a result whose `ok` is false and whose `error` says why: `rejected`, `ambiguous`, or `grammar` for a defect of a grammar found only while parsing. `Dialect.parse_tokens(tokens, text, ...)` takes pre-built tokens in place of the first stage's characters, for tests and tools.

`dialect.features` lists the dialect's features in code point order of their names, as a tuple of `Feature`, each with its `name`, its `kind`, `"gate"` for a guard `@f?` or `@¬f?` or `"warning"` for `@f!`, and its `default`, whether the pipeline turns it on. A dialect whose guards use one name both as a gate and as a warning cannot be loaded.

A dialect may be used for any number of parses and shared between threads.

## The result

`ParseResult`, `Stage`, `Node`, `Token`, `ParseError`, `ParseWarning`, `Action` and `Expected` are dataclasses. Tags are `dict[str, bool]`, `True` for a strong tag; ranges are `(start, end)` tuples, source ranges in code points.

`result.warnings` lists a `ParseWarning` for each node of a stage's chosen tree whose alternative has a warning `@f!` while `f` is on, in stage order and then tree order, with its `stage`, `feature`, `rule`, `span` and `source`; it is empty when there are none.

- `gencmu.to_json(result)` is the canonical JSON as text, in the key order of `docs/output.md`; `gencmu.result_json(result)` is the same as plain data.
- `gencmu.to_brackets(result, show_elided=False)` renders the last stage's tree as nested groups.

## Development

The grammar copy under `src/gencmu/grammars/` is generated: run `node tools/sync.js` at the repository root after changing `grammars/`.

The tests use only `unittest` and run from this directory against the sources in `src/`:

```sh
python -m unittest
```

They run the shared cases of the repository's `tests/engine/` and `tests/notation/`, the fixpoint of the notation's bootstrap, the check of `compiled.json` against a fresh reading, the API, and a property test of the ranking against brute-force enumeration, and the core sample of the Lojban corpus (`tests/core.txt`). `GENCMU_CORPUS=full` runs every corpus case, on a pool of processes whose size `GENCMU_CORPUS_WORKERS` sets; a book chapter of about 15,000 characters takes up to a minute and about a gigabyte. `GENCMU_PROPERTY_CASES` and `GENCMU_PROPERTY_SEED` run a larger sweep of the property test, and `GENCMU_INSTALLED=1` tests an installed package instead of `src/`.

Building the wheel needs `build` and setuptools, at build time only:

```sh
python -m build
```
