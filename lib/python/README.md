# gencmu for Python

gencmu is a Lojban parser. A literate grammar document mixes prose with grammar rules. gencmu loads these Markdown documents at runtime. This is the Python library. An API is the operations that a library exposes.

The library is pure Python, uses the standard library only, and needs Python 3.14 or later. It implements the engine specification of the gencmu repository, `docs/engine.md`. The library reads DOM format 33 and writes result format 14. It writes the canonical JSON of `docs/output.md`.

```python
import gencmu

dialect = gencmu.load_dialect("cll-ebnf")
result = dialect.parse("mi klama le zarci")
result.ok, result.tree, result.error, result.warnings
gencmu.to_json(result)
gencmu.to_brackets(result, show_elided=True)
```

A caller can enable or disable an unknown feature name. Unknown names do not change grammar behavior. Naming one feature in both lists is a usage error.

## Loading a dialect

A pipeline document and the grammar documents that it includes define a dialect. The pipeline declares its stages with `%stage`, and the grammar documents of each stage with `%include`. It declares the features that it turns on with `%features` (`docs/notation.md`, "Pipelines").

- `load_dialect(name)` loads a dialect of the bundled grammars. `name` is the name of its pipeline document under `grammars/dialects/` without `.md`.
- `load_dialect_file(path)` loads a pipeline document from disk. The loader finds its grammar documents relative to it. The Unicode table and the bootstrap of the notation come from the bundled grammars.
- `load_dialect_sources(sources, pipeline)` loads documents held in memory. `sources` is a mapping from `/`-separated path to text, and `pipeline` is the path of the pipeline document in it. The mapping can hold its own `unicode.txt`, `notation/bootstrap.json` and `compiled.json`. The bundled ones fill in what it lacks. A `unicode.txt` in the map replaces the bundled table entirely, White_Space included (`docs/api.md`).

The loader reads a grammar document through the notation (the grammar of grammar documents) only when `compiled.json` has no matching entry. `compiled.json` holds the precompiled DOMs, the parsed forms of the grammar documents. An entry matches when it is for the same text, under the same bootstrap, Unicode table fingerprint, and DOM format. The fingerprint is the 64-bit FNV-1a hash of the table text. Reading a large grammar through the notation is slow in pure Python. So the bundled grammars all have an entry.

Each loader takes `use_cache=False` to read every document afresh.

An entry holds a document's constants (`%const` and `%redefine-const`), classifiers (`%classifier`) and implications (`%implies`) as the document writes them, never their values. The loader gives each constant its value when it stitches a stage (`docs/engine.md`, §2). A stage resolves each classifier for the features of a parse, and keeps the result for each set of features. So a document that several stages or dialects include takes the values of each, and one entry serves them all.

A dialect that cannot be loaded raises `gencmu.GencmuError`. Its `kind` is `"grammar"`, and its `where` is `document:line:column` as far as it is known. An error of a constant stands at the definition that is wrong, or else at the reference to the constant. A document on disk that is not valid UTF-8 is such an error, with no line or column. A document in the mapping with a lone surrogate is the caller's mistake, of `kind` `"usage"`.

## Parsing

```python
result = dialect.parse(text, features=(), without_features=(), until=None, elision_only=None)
```

- `features` names the features that the caller turns on in every stage, besides those the pipeline turns on with `%features`.
- `without_features` names features to disable in every stage, including unconditional defaults. A name in both lists raises `GencmuError` with `kind` `"usage"`.
- `until` names the last stage to run. An unknown name raises `GencmuError` with `kind` `"usage"`.
- `elision_only`, when it is `True` or `False`, overrides the grammars' `%ambiguity-resolution ... elision-only`.

A `text` with a lone surrogate raises `GencmuError` with `kind` `"usage"`. A text that does not parse is a result whose `ok` is false and whose `error` says why. The kind of that error is `rejected`, `ambiguous`, `feature-conflict`, or `grammar`. An `ambiguous` error has a `reason` and two `readings`.

A `feature-conflict` error names a disabled feature whose conditional declaration holds for the stage input. Its `stage` and `feature` fields identify the conflict.

A rejected error can carry `boundary`. It names the rule, the condition index from zero, and the input boundary where a tree condition fails. The index counts conditions through the rule definitions in source order.

The reason is `"tie"` where a stage has two or more best readings (`docs/engine.md`, §6). The stage then has the verdict `"tie"` and a `witness`, and it has no tree and no output. The reason is `"elision-only"` where the check of §7 fails. That error also has a `witness`, the pair of actions where its readings first differ. Such an `Action` can have the kind `"elided"`, a read of a terminator that the check wrote back, at the position `at` (§7.10).

Here, `grammar` is for a defect of a grammar found only while parsing. Lowering finds such defects for the features of the parse (`docs/engine.md`, §3), so the dialect still loads. One example is a classifier's entry that adds a class that a key already has.

Another is an item of braces, `{x}` or `{x / s}`, that can match no tokens. A chain, `{... x / s}` or `{x ... / s}`, beside another alternative after gates apply is also a defect. The message of such an error begins with the document, line and column of the entry or of the definition at fault, as `a.md:3:1:`. Where a grammar has several, the parse reports the one that `docs/engine.md` §3 puts first.

An error of kind `grammar` whose `code` is `"elision-witness-lost"` marks a defect of the library, not of the text or the grammar. The check of `elision-only` lost the chosen derivation, which it must always find again (`docs/engine.md`, §7.9). Such an error also has `chosen`, the stage's chosen tree, and `completion`, the terminators that the check wrote back, in their order. Each `Restoration` has its `terminal`, input position `at`, and the empty `source` of its elided node.

Its `value` is the exact string of an `=` test, or `None` without that test. The stage keeps its verdict, `"resolved"`, and its warnings, but it has no output. Other parse-result errors have no `code`, `chosen`, or `completion`. Ranked-choice load errors use the separate diagnostic schema of `docs/output.md`.

For tests and tools, `Dialect.parse_tokens(tokens, text, ...)` takes tokens in place of the first stage characters. A supplied token stores `text`, `value`, `image`, `tags`, `span`, and `source`. Each string defaults independently to `text` when the constructor receives `None`. An explicit empty string stays empty. Recognition reads `value`, and output shows `image`.

A caller cannot supply attachments. Nonempty `before` or `after` lists raise `GencmuError` with `kind` `"usage"`. Empty attachment lists are accepted. The parse copies supplied tokens, so changes to a result cannot change the caller tokens.

`dialect.features` lists the features of the dialect in code point order of their names, as a tuple of `Feature`. The list includes the gates of the entries of its classifiers. Each `Feature` has these fields:

- `name`
- `kind`: `"gate"` for a guard `f?` or `¬f?`, or `"warning"` for `f!`
- `default`: Whether the pipeline turns the feature on

A dialect whose guards use one name both as a gate and as a warning cannot be loaded. A gate of a classifier's entry counts here too.

You can use a dialect for any number of parses, and you can share it between threads.

## The result

`ParseResult`, `Stage`, `Node`, `Token`, `ParseError`, `ParseWarning`, `Action`, `Expected` and `Restoration` are dataclasses. A tag set is a `frozenset[str]`. User tags start with a capital, as in `KOhA`. Engine tags use the fixed inventory of `docs/engine.md` §1.

Stage zero canonically decomposes the input with the shared Unicode table. Each token stores one decomposed scalar as its value and image. Its source and text refer to its original scalar. Its span counts decomposed scalars. Caller-supplied tokens skip decomposition.

A stage-zero token's tags include the configured general category, its major category, and `_White_Space` where applicable. For example, `A` carries `_Lu` and `_L`. Later stages read stored tags and exact values.

A `Token` has `text`, `value`, `image`, `tags`, `span`, and `source`. Only an inserted `ε` item sets `inserted_by`. Recipes supply strings, and tags never assign strings. A constituent without a channel recipe concatenates its children on that channel. `%erased` excludes its contribution. A verbatim recipe preserves original text and follows the gap-claim rules of engine §11.

The grammar method `.decomposed-source-text` returns the canonical decomposition of the original source text over a span. It uses the configured Unicode table. An empty span returns an empty string. The method works in conditions and string recipes.

A `Token` also has its attachments, `before` and `after`. These are two lists of tokens that belong to it and that no later stage reads, such as the indicators after a word (`docs/engine.md`, §11). Both lists are empty unless an emission gives the token attachments. An attached token has no span, so its `span` is `None`. Its `source` is still a range of the original text.

A terminal in a token node, witness, or expected list is a tag, canonical string, range, or `_` wildcard. Examples include `KOhA`, `"a"`, and `"a".."z"`. Expected terminals include their exact value test or signed tag requirements, as in `LE="la"` or `KOhA<¬UI>`. Spans are `(start, end)` tuples, and source ranges count code points.

`result.warnings` lists the warnings of the nodes of the chosen tree of each stage. A node has one `ParseWarning` for each warning guard `f!` of its alternative whose feature `f` is on. The warnings come in stage order and then in tree order. Each has its `stage`, `feature`, `rule`, `span` and `source`. The list is empty when there are no warnings.

- `gencmu.to_json(result)` is the canonical JSON as text, in the key order of `docs/output.md`.
- `gencmu.result_json(result)` is the same as plain data.
- `gencmu.to_brackets(result, show_elided=False)` renders the last stage's tree as nested groups, with each token shown by its image. A token with attachments is a group of its before-attachments, its image and its after-attachments. So in the `cll-ebnf` dialect, `mi ui klama` is `([mi ui] klama)`.

## Development

`node tools/sync.js` generates the grammar copy under `src/gencmu/grammars/`. After you change `grammars/`, run `node tools/sync.js` at the repository root.

The tests keep their `unittest` assertions. pytest with pytest-xdist runs them in separate processes. Each shared engine and notation fixture has a separate test method. The `test` dependency group pins the runner dependencies, which the wheel does not require.

From `lib/python`, create an environment and install the test runner:

```sh
uv venv --python 3.14
uv pip install --group test
.venv/bin/python -m pytest
```

Local tests read the sources in `src/`. The runner selects its worker count from the available CPU cores through `-n auto`. The `worksteal` scheduler moves queued tests from busy workers to idle workers. Use `.venv/bin/python -m pytest -n 4` to select four workers. Use `.venv/bin/python -m pytest -n 1` for a serial suite. Use `-n 0` to investigate one test in the main process.

Corpus cases use the same pytest workers as the other tests.

CI builds and installs the wheel, then runs the suite once with `GENCMU_INSTALLED=1`. The import guard refuses a source import in that mode. CI uses Python 3.14.

The tests cover these items:

- The shared cases of `tests/engine/` and `tests/notation/` in the repository, with the position of each load error that a case gives
- For a case with `parses`, several parses of its input with one loaded dialect
- The fixpoint of the bootstrap of the notation
- A comparison of `compiled.json` with a fresh reading
- The API
- The checks of a precompiled DOM, and the refusal of a cache of another DOM format
- The place and the order of the errors of lowering, and the items that captures add to the recognizer (`tests/README.md`)
- A property test of the ranking against brute-force enumeration
- The core sample of the Lojban corpus (`tests/core.txt`)

`GENCMU_CORPUS=full` runs every corpus case. The `-n` flag controls its workers too. A book chapter of about 15,000 characters takes up to a minute and about a gigabyte. `GENCMU_PROPERTY_CASES` and `GENCMU_PROPERTY_SEED` run a larger sweep of the property test. `GENCMU_INSTALLED=1` tests an installed package instead of `src/`.

The wheel build needs `build` and setuptools, at build time only. To build the wheel, run this command:

```sh
python -m build
```

### Tests of elision-only

`src/gencmu/_testing.py` holds a hook for the library's own tests, which the package does not export. After each check of `elision-only`, the shared and corpus runners ask whether the hook retains the chosen derivation (`tests/README.md`, `tests/witness.py`). `tests/test_elision_check.py` loses the witness on purpose and makes sure that the error `elision-witness-lost` has the required form. The hook's `faults` turn on faults of the library's own paths in the check. `tests/test_faults.py` shows that the shared cases catch each one, through the result or through the hook alone (`tests/README.md`).

### Tests of close families

The shared engine runner enables the private `family_check` hook for `.without-elision-except` queries. It compares each eligible witness with an independent deletion test over the complete observation. Only this test retains permission marks, which say whether a family permits an omitted terminator. The engine stores unmarked close observations and candidate-sized summaries instead.

`tests/test_close_families.py` runs each family growth case beside its strict twin at every specified size. It stops before the first count past a shared bound. It records the seven work counts, elapsed time, and peak traced memory.
