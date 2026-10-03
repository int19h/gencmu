# gencmu for Python

gencmu is a Lojban parser whose grammars are literate Markdown documents loaded at runtime. This is the Python library. It is pure Python, uses the standard library only, and needs Python 3.10 or later. It implements the engine specification of the gencmu repository, `docs/engine.md`. The library can write its results as the canonical JSON of `docs/output.md`.

```python
import gencmu

dialect = gencmu.load_dialect("cll-ebnf")
result = dialect.parse("mi klama le zarci")
result.ok, result.tree, result.error, result.warnings
gencmu.to_json(result)
gencmu.to_brackets(result, show_elided=True)
```

## Loading a dialect

A pipeline document and the grammar documents that it includes define a dialect. The pipeline declares its stages with `%stage`, and the grammar documents of each stage with `%include`. It declares the features that it turns on with `%features` (`docs/notation.md`, "Pipelines").

- `load_dialect(name)` loads a dialect of the bundled grammars. `name` is the name of its pipeline document under `grammars/dialects/` without `.md`.
- `load_dialect_file(path)` loads a pipeline document from disk. The loader finds its grammar documents relative to it. The Unicode table and the bootstrap of the notation come from the bundled grammars.
- `load_dialect_sources(sources, pipeline)` loads documents held in memory. `sources` is a mapping from `/`-separated path to text, and `pipeline` is the path of the pipeline document in it. The mapping can hold its own `unicode.txt`, `notation/bootstrap.json` and `compiled.json`. The bundled ones fill in what it lacks. A `unicode.txt` in the map replaces the bundled table entirely, White_Space included (`docs/api.md`).

The loader reads a grammar document through the notation (the grammar of grammar documents) only when `compiled.json` has no matching entry. `compiled.json` holds the precompiled DOMs, the parsed forms of the grammar documents. An entry matches when it is for the same text, under the same bootstrap and DOM format. Reading a large grammar through the notation is slow in pure Python. So the bundled grammars all have an entry. Each loader takes `use_cache=False` to read every document afresh.

An entry holds a document's constants (`%const` and `%redefine-const`), classifiers (`%classifier`) and implications (`%implies`) as the document writes them, never their values. The loader gives each constant its value when it stitches a stage (`docs/engine.md`, §2). A stage resolves each classifier for the features of a parse, and keeps the result for each set of features. So a document that several stages or dialects include takes the values of each, and one entry serves them all.

A dialect that cannot be loaded raises `gencmu.GencmuError`. Its `kind` is `"grammar"`, and its `where` is `document:line:column` as far as it is known. An error of a constant stands at the definition that is wrong, or else at the reference to the constant. A document on disk that is not valid UTF-8 is such an error, with no line or column. A document in the mapping with a lone surrogate is the caller's mistake, of `kind` `"usage"`.

## Parsing

```python
result = dialect.parse(text, features=(), without_features=(), auto_features=True, until=None, elision_only=None)
```

- `features` names the features that the caller turns on in every stage, besides those the pipeline turns on with `%features`.
- `without_features` names the features that the caller turns off in every stage, those that the pipeline turns on included. A name in both lists raises `GencmuError` with `kind` `"usage"`.
- `auto_features` adds `sa-su` only where the text needs it. To find out, the parser first parses up to the stage named `words` without `sa-su`. This works only in a dialect that has `sa-su` as a gate and a stage named `words`. It does nothing if `sa-su` is already on, if `without_features` names it, or if `until` names a stage before `words`.
- `until` names the last stage to run. An unknown name raises `GencmuError` with `kind` `"usage"`.
- `elision_only`, when it is `True` or `False`, overrides the grammars' `%ambiguity-resolution ... elision-only`.

A `text` with a lone surrogate raises `GencmuError` with `kind` `"usage"`. A text that does not parse is a result whose `ok` is false and whose `error` says why. The kind of that error is `rejected`, `ambiguous` or `grammar`. An `ambiguous` error has a `reason` and two `readings`. The reason is `"tie"` where a stage has two or more best readings (`docs/engine.md`, §6). The stage then has the verdict `"tie"` and a `witness`, and it has no tree and no output. The reason is `"elision-only"` where the check of §7 fails. Here, `grammar` is for a defect of a grammar found only while parsing. An example is a classifier's entry that adds a class that a key already has, under the features of the parse. The message of that error names the document, line and column of the entry.

An error of kind `grammar` whose `code` is `"elision-witness-lost"` marks a defect of the library, not of the text or the grammar. The check of `elision-only` lost the chosen derivation, which it must always find again (`docs/engine.md`, §7.9). Such an error also has `chosen`, the stage's chosen tree, and `completion`, the terminators that the check wrote back, in their order. Each of them is a `Restoration` with its `terminal`, its position `at` in the stage's input, the empty `source` of its elided node, and the `sound` of a terminator with an `=` test, or `None`. The stage keeps its verdict, `"resolved"`, and its warnings, but it has no output. No other error has a `code`, so its `code`, `chosen` and `completion` are `None`.

For tests and tools, `Dialect.parse_tokens(tokens, text, ...)` takes pre-built tokens in place of the characters of the first stage. Such a token has its text as its label, whatever `label` it carries (`docs/engine.md`, §5). It cannot have attachments. A token whose `before` or `after` is not empty raises `GencmuError` with `kind` `"usage"`, and empty lists are dropped. The parse copies each token, so your tokens stay as they are.

`dialect.features` lists the features of the dialect in code point order of their names, as a tuple of `Feature`. The list includes the gates of the entries of its classifiers. Each `Feature` has these fields:

- `name`
- `kind`: `"gate"` for a guard `f?` or `¬f?`, or `"warning"` for `f!`
- `default`: Whether the pipeline turns the feature on

A dialect whose guards use one name both as a gate and as a warning cannot be loaded. A gate of a classifier's entry counts here too.

You can use a dialect for any number of parses, and you can share it between threads.

## The result

`ParseResult`, `Stage`, `Node`, `Token`, `ParseError`, `ParseWarning`, `Action`, `Expected` and `Restoration` are dataclasses. A tag set is a `frozenset[str]` of tags, each in its canonical spelling, such as `KOhA`, `/a/` or `'a'` (`docs/engine.md`, §1). A character token of the first stage carries one tag, its character tag.

A `Token` has its `text`, `phonemes`, `label`, `tags`, `span` and `source`, and `inserted_by` for a token that an emission inserted. The `label` is what the token shows to people. A pause shows as a space. An opaque part, such as the body of a `zoi` quote, shows its text as written (`docs/engine.md`, §5 and §11). A character token's label is its text.

A `Token` also has its attachments, `before` and `after`. These are two lists of tokens that belong to it and that no later stage reads, such as the indicators after a word (`docs/engine.md`, §11). Both lists are empty unless an emission gives the token attachments. An attached token has no span, so its `span` is `None`. Its `source` is still a range of the original text.

A terminal in a token node, witness or expected list is a tag, range or property. A range or property uses its written form, such as `'a'..'z'` or `'\p{L}'` (`docs/engine.md`, §4). An expected list writes a terminal that carries a test in a body with its test, such as `LE="la"` or `KOhA∩UI=∅` (`docs/output.md`). Spans are `(start, end)` tuples, and source ranges are in code points.

`result.warnings` lists the warnings of the nodes of the chosen tree of each stage. A node has one `ParseWarning` for each warning guard `f!` of its alternative whose feature `f` is on. The warnings come in stage order and then in tree order. Each has its `stage`, `feature`, `rule`, `span` and `source`. The list is empty when there are no warnings.

- `gencmu.to_json(result)` is the canonical JSON as text, in the key order of `docs/output.md`.
- `gencmu.result_json(result)` is the same as plain data.
- `gencmu.to_brackets(result, show_elided=False)` renders the last stage's tree as nested groups, with each token shown by its label. A token with attachments is a group of its before-attachments, its label and its after-attachments. So in the `cll-ebnf` dialect, `mi ui klama` is `([mi ui] klama)`.

## Development

`node tools/sync.js` generates the grammar copy under `src/gencmu/grammars/`. After you change `grammars/`, run `node tools/sync.js` at the repository root.

The tests use only `unittest` and run from this directory against the sources in `src/`:

```sh
python -m unittest
```

The tests cover these items:

- The shared cases of `tests/engine/` and `tests/notation/` in the repository, with the position of each load error that a case gives
- For a case with `parses`, several parses of its input with one loaded dialect
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

### Tests of the check of elision-only

`src/gencmu/_testing.py` holds a hook for the library's own tests, which the package does not export. The runners of the shared cases and of the corpus ask the hook, after each check of `elision-only`, whether the check's forest kept the witness of the chosen derivation (`tests/README.md`, `tests/witness.py`). `tests/test_elision_check.py` loses the witness on purpose and checks the form of the error `elision-witness-lost`.
