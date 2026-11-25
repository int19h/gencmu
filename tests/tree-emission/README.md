# Tree emission fixtures

`pairs.json` groups each valid case with a corresponding malformed case. A pair can add `controls` with related inputs and their own outcomes.

Each pair names public manuals and headings that define its outcomes. The shape checker reads this file separately from the engine and notation fixtures. No library runs these cases. The checks cover fixture structure, and the outcomes await a runner.

## Inputs

- `source` gives grammar lines. Wrap the lines in one jbogenbau code fence and preserve their order. Each stage supplies its own resolution policy.
- `pipeline` names a bundled pipeline. An `overlay` adds its lines after that pipeline's declarations. `bundledSource` identifies the grammar site that the pair covers.
- `document` gives a full Markdown document for the notation reader. `domJson` supplies serialized declarations. `resultJson` supplies a serialized parse result to the result decoder.

A parse takes `input` and can replace the first stage's input with caller `tokens`. A token's `props` object holds its bare keys and any explicit string fields. An omitted string field takes the token's text.

Caller token `i` gets span `[i, i+1)`. Its source range counts Unicode scalars in the token texts joined with single spaces. That range must fit within `input`.

`options` gives the parse configuration. `features` and `withoutFeatures` select feature switches, `until` selects a stage cutoff, and `elisionOnly` turns the elision test on or off. `stageTrees` selects `compact` or `all` for earlier stage trees.

## Expectations

Each case states its `outcome`. For a grammar, document or result error, `phase` names the operation that fails. Compare `cause` by meaning.

| Field | Value | Expected observation |
| --- | --- | --- |
| Outcome | `accept` | Parsing returns a result with `ok:true`. |
| Outcome | `rejected` | Recognition finds no complete derivation. The result has `ok:false`, `error.kind:"rejected"`, and a null tree. |
| Outcome | `ambiguous` | Parsing returns `ok:false` and `error.kind:"ambiguous"`. The error gives the tie or elision-only reason. |
| Outcome | `grammar` | The operation named by `phase` reports a grammar error. The phase determines whether a parse result exists. |
| Outcome | `dom` | The notation reader returns the serialized grammar structure. |
| Outcome | `invalid-dom` | The supplied document fails decoding or document validation. The loader returns a grammar error before the pipeline can parse. |
| Outcome | `invalid-result` | The result decoder rejects the supplied JSON or its records. |
| Phase | `load` | Document reading or pipeline stitching fails. The load error has no parse result. |
| Phase | `lowering` | Stage preparation fails while it resolves gates, suppliers, refinements, proofs or live cycles. The grammar result retains earlier stages. The failed stage has a null verdict and no output. |
| Phase | `recognition` | An active condition or obligation fails with a grammar error. The result retains earlier stages. The failed stage has a null verdict and no output. |
| Phase | `publication` | An output expression or publication check fails after choice. The grammar result keeps the chosen stage root and earlier stages. It has a null top-level tree and no failed-stage output. |
| Phase | `decode` | The result decoder returns an error and produces no decoded result. |

Positions use one-based lines and Unicode scalar columns. For `source`, `at` counts from the first grammar line. When you compare a document position, add one line for the opening fence. For `document`, positions count from the first document line.

An assertion selects a location with a JSON Pointer, a slash-delimited path into a JSON record. `equals` compares the complete value and distinguishes Boolean and numeric values.

`matches` requires each listed member of an object and compares nested members in the same way. Array values in a match require equal lengths and matching items in order.

`contains` requires an array item that matches the supplied record. If the array is absent or has no matching item, `excludes` passes. `absent` requires the location to have no member.

`roundTrip` applies result assertions before serialization and after decoding. Each `references` entry gives the stage, reading, and node that the selected reference must resolve to.

Reading zero uses the stage's chosen table in `root` and `nodes`. Entry `i` of the stage's `readings` array uses reading number `i + 1`.

## Document paths

A case with `domPaths` first reads its source. It then uses `domPaths.json` as the payload of an optional cache entry with matching fingerprints. A third run uses the same JSON as a supplied document.

The `cache` member records whether the reader accepts the cached document. A miss reads the original source again. Both runs use the case expectation.

A cache hit uses the case expectation for the supplied document too. For DOM success, compare the complete normalized records from all three paths. A cache miss requires a separate `supplied` expectation for the rejected DOM.

## Inventory

Run `node tools/list-tree-emission-fixtures.js` from the repository root to list the cases with their manual headings. Add `--markdown` for a table with one row per pair.

Run `node tools/list-tree-emission-fixtures.js --check-manuals DOCS` to compare the citations with the manuals. Replace `DOCS` with the directory that contains the four manuals.

## Frozen reference

`tools/te-reference.json` records the commit and SHA-256 digests of its files and corpus projections. A projection keeps the fields specified in `tools/build-te-reference.py`.

File groups hash one JSON line per tracked path, in path order. Each line contains the path and the SHA-256 digest of the file bytes.

Corpus projections hash one JSON line per case, in file and record order. Each line contains the corpus path and the selected case members. The encoder sorts object keys and omits spaces between JSON members.

Run `python3 tools/build-te-reference.py CHECKOUT` from the repository root. Use a clean checkout of the recorded commit. The script extracts and compares the pinned files under `/build/gencmu/te-reference`.

The snapshot includes all four library ports. The script compares the active Rust toolchain and the executable digest with the record. If the runner is missing, the script builds it with the recorded configuration. It keeps a verified copy outside Cargo's target directory.

The script compares the JavaScript entry point and the active Node runtime with the record. It prints the executable and source paths. The build stops after it produces the Rust executable.
