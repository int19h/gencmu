# The shared tests

Every gencmu library runs every shared case that its API can express. A library skips a usage case when its token or string types cannot express the invalid field. If a case fails in one library and passes in another, there is a bug. The bug is in the library that disagrees with `docs/engine.md`, or in the specification itself.

## Running the tests

Run `node tools/sync.js` from the repository root after a grammar change. Each library runs all of its tests and the core corpus sample by default. Use `GENCMU_CORPUS=full` to select the whole corpus.

Run each command from the named library directory:

- JavaScript, `lib/js`: `npm ci`, then `node --test`. Set `--test-concurrency=N` to select the number of processes.
- Rust, `lib/rust`: `cargo test`. Set `-- --test-threads=N` or `RUST_TEST_THREADS=N` to select the number of test threads.
- Go, `lib/go`: `go test ./...`. Set `-parallel N` to select the number of concurrent tests.
- Python, `lib/python`: install the `test` dependency group, then run `python -m pytest`. Set `-n N` to select the number of workers.

Rust tests use optimization level 3. For a debug build, set `CARGO_PROFILE_TEST_OPT_LEVEL=0` and select one test. Python needs version 3.14 or later. Its README gives the local interpreter and installation commands. CI runs the Python suite once, against the installed wheel. Local Python tests read `src/`.

Rust generates shared tests only when the corresponding integration test exists inside the crate. Published dependency builds read no external fixtures. The Rust README gives the packaged consumer procedure that both Rust CI versions run.

Rust, Go, and JavaScript have separate corpus pools, which `GENCMU_CORPUS_WORKERS` controls. Python schedules corpus cases through the same pytest workers as its other tests. Its `worksteal` scheduler moves queued tests to idle workers. For a serial Rust, Go, or JavaScript suite, set both controls to `1`. For a serial Python suite, use `python -m pytest -n 1`. Use Go's `-count=1` flag when you measure a suite, so Go does not reuse a cached result.

Tests must not depend on execution order. Go tests with process-wide controls or allocation counts stay serial. Other tests cannot enter these controls or change those counts.

## Engine cases: `engine/*.json`

The bundled grammars use the current notation. A case that loads a bundled pipeline tests that pipeline's documents ([engine.md](../docs/engine.md)). The JavaScript runner executes every engine and notation case and the complete corpus when `GENCMU_CORPUS=full`.

The corpus records full outcomes. These shared fixtures also express stage cutoffs and token metadata that the corpus cannot record. A description names the grammar documents when a case tests their rules.

The cases in `parameters.json` use the same case shape. All four libraries run these shared parameter cases.

The cases in `parameter-structure.json` inspect parameter DOMs and expanded rules in all four libraries. Each case supplies `grammar` source or a complete `dom`. The optional `argument` matches the last source rule's first call argument. `order` lists the expanded rule names. `instances` gives the instance count. `flags` maps rule names to their final flags. A `cacheFallback` case supplies valid source and a malformed cached DOM. Each library uses matching cache fingerprints and must parse `input` from the source.

Each file is one case:

```
{
  "description": "what the case pins down, and which engine or grammar section defines it",
  "grammar": "%rule text A B",
  "documents": {"path.md": "Markdown text"},
  "pipeline": "path.md",
  "tokens": [{"text": "a", "tags": ["A"]}, {"text": "b", "tags": ["B", "C"]}],
  "input": "characters",
  "options": {"features": ["f"], "withoutFeatures": ["g"], "elisionOnly": true, "until": "words"},
  "expect": {"result": PATTERN, "brackets": "(a b)", "warnings": [WARNING...], "features": [FEATURE...], "error": "grammar",
             "where": {"document": "main.md", "line": 4, "column": 12}}
}
```

The grammar comes from `grammar`, or from `documents` and `pipeline`. `grammar` is rule text for a single stage named `main`. The document of this stage is those rules in one `jbogenbau` block. On a line of its own before the rules, the block has `%ambiguity-resolution greedy`, unless the text has its own `%ambiguity-resolution`. `pipeline` names a pipeline document among `documents`.

The input is `input` or `tokens`. `input` supplies scalar characters as engine §1 states. `tokens` replaces the first stage input. With both members, `input` supplies the original source text. Without `input`, the runner joins token texts with single spaces. Each token gets these values:

- Its tags are its listed tags, including stored engine tags (`docs/output.md`).
- Its text is as given.
- Its value is the `value` member when present, otherwise its text.
- Its image is the `image` member when present, otherwise its text.
- Its strings default independently. Explicit empty strings remain empty.
- Its span is its `span` member when present, otherwise `[i, i+1)`.
- Its source is its `source` member when present, otherwise its position in the joined texts.
- Its attachments are its `before` and `after` members, when present, each a list of tokens in this same form. A caller cannot supply attachments. So a list that is not empty is a `usage` error, and the library drops an empty one (`docs/api.md`). The Rust library, whose input tokens have no attachments, skips a case whose tokens have either member.

A usage case can supply an invalid field. The runner passes that field to the library, which reports the usage error. If the API cannot express that field, the runner records its reason for skipping the case.

Each case follows the global and stage-local feature declarations of its pipeline (engine §13).

The condition-loading cases stop before the condition's stage, so a runtime failure cannot satisfy their expectation.

`options.features` and `options.withoutFeatures` are the features the caller turns on and off (engine §13).

`options.until`, when present, names the last stage to run (engine §13). A name that is not a stage of the dialect is a `usage` error. No case gives an empty name, because Go cannot tell an empty name from no name (`docs/api.md`). Each library tests an empty name in its own tests.

A pattern describes required result fields. `expect.result` is a pattern matched against the format 15 canonical result of `docs/output.md`. A pattern matches in these ways:

- An object matches when every member of the pattern matches the member of the same name.
- An array matches when it has the same length and each element matches.
- Anything else matches when it is equal.

A pattern never pins the `message` of an error. Its wording is each library's own (`docs/output.md`), so the JavaScript runner refuses a case whose pattern holds one.

A pattern matches a result that has members beyond its own. So the invariants, and not the patterns, say that a tied stage has no output.

`expect.diagnostic` pins the code of a ranked-choice loading error. The API supplies that code directly. Loading diagnostics also expose their written group, option, expression, and inheritance witness where available.

`expect.enabledFeatures` compares the result's enabled feature names as a complete list, outside canonical JSON (`docs/api.md`).

`expect.brackets` is the bracket rendering, with elided terminators hidden. `expect.warnings` is the list of warnings of the result, compared whole. So `[]` says that there are no warnings. `expect.features` is the list of features of the dialect (`docs/api.md`), compared whole. Each feature is written as `{"name":..., "kind":..., "default":...}`.

A case can also parse its input several times with the one loaded dialect. Then it has `parses`, a list of objects, each with its own `options` and `expect`, in place of the case's `options` and `expect`:

```
"parses": [{"options": {}, "expect": {"brackets": "a"}}, {"options": {"features": ["f"]}, "expect": {"error": "grammar"}}]
```

The library loads the dialect once, and then parses the input with each item's configuration in order. Each result matches its item's `expect`. So a case can show that one loaded dialect gives each set of features its own result, whatever it parsed before.

`expect.error` is the error kind, when the case is about an error. For a grammar that cannot be loaded, the result is the error alone. For a mistake of the caller, `usage`, there is no result.

A load that fails gives only its error. Its kind is `grammar` for a grammar that cannot be loaded. A caller's mistake at load gives `usage`. One example is an in-memory document that is not a sequence of Unicode scalar values (engine §1). A case expects such an error with `expect.error` of that kind.

For a `grammar` error, it can also give `expect.where`. It gives no `result`, `brackets`, `warnings`, `features` or `enabledFeatures`, because only a loaded dialect gives them. A runner fails a case when the load fails with another kind, or when the case expects one of these members. It also fails a case that gives `expect.where` with a kind other than `grammar`.

An error that lowering finds (engine §3), such as an item of braces that can match no tokens, is not a load error. The dialect loads, and the parse gives a result whose error has the kind `grammar`, so a case expects it with `expect.error`. Its message, which names the definition at fault, is the library's own, so no case compares it.

`expect.where`, when present, is where the error of a grammar that cannot be loaded stands. It is only for an error of kind `grammar`. It names a document of the case and a line and a column in it. For a case with `grammar`, the document is `main.md`. Its fence is line 1, so the rules start on line 3, or on line 2 when they hold their own `%ambiguity-resolution`.

### Result invariants and witness tests

An invariant is a required property of every result. Every runner also makes sure that each canonical result meets these invariants, whatever the case expects. A case cannot turn them off, and its pattern need not repeat them:

- An error of kind `ambiguous` has no member `token` and no member `source`.
- No stage has a member `tied`.
- A stage whose verdict is `tie` has no member `output`, and it is the last stage of the result.
- Such a result has `ok` false and `tree` null. Its error has kind `ambiguous`, reason `tie`, and that stage's name. It contains exactly two readings.
- No result has an error with the code `elision-witness-lost`. Engine §7.8 proves raw witness membership when recognition meets no grammar error. Section 7.9 reports witness loss only for raw absence. So no grammar can give it, and it is a defect of the library, whatever the case expects.

A library's own tests lose the witness on purpose, through a private switch, and call the engine directly, not through the runner. They test the error's form. It has kind `grammar`, a `stage`, `chosen`, and `completion`. It has no `token`, `source`, `line`, `column`, `expected`, `reason`, or `readings`. Its stage has the verdict `resolved` and no `output`, and it is the last stage of the result. A library's own tests also show that an ordinary error of the grammar in the check has no `code`.

Take each stage where the check of engine §7 ran and ended without an error of the grammar. Every runner also asks its library whether that check kept its witness. The library answers through a test-only export outside the documented API, such as `gencmu::tools` in Rust. It can also answer through a test module.

The answer records raw W(D), which engine §7.8 reconstructs from the chosen derivation. Admission can intentionally exclude that witness. The hook observes that ranking, and it ranks nothing itself:

- The walk: After the check recognizes R and before it ranks, a walk looks for W(D) in the chart. It takes each occurrence in the derivation tree on its own, even where the representation shares one object between occurrences. It marks the edges or links that W(D) uses. JavaScript and Python mark an edge by its index among its item's edges.

  Go marks a link. Rust marks a link as its ranker rebuilds it, by the item and the set where its predecessor stands. Where the chart does not hold W(D), the answer is no.
- The count channel: The check passes the marks to the ranker that it uses. Beside each item's count, capped at two, the ranker keeps a bit: whether the count includes a derivation made only of marked edges. The same loop decides both, over the same edges, in the same contexts, with the same faults. So a choice that drops W(D) from the count also drops it from the bit.

  A cut that closes a cycle has no bit. The loop can stop once the count is two, but at a marked item only once the bit is known. A root of W(D) must have the bit.
- The selection channel: An elision-only error reports raw W(D) first, including when admission excludes it. The second reading is the T-first best admitted competitor distinct from W(D). The walk builds the witness actions in post-order for comparison.

Every check tracks W(D) and passes its marks to the ranker, whether or not a test watches it. The optional test hook observes the reconstruction and ranking. It does not enable runtime witness tracking.

The hook asks about the check's own ranking because any other question is a stand-in. A chart that holds W(D) is not enough, because a faulty ranker can still lose it. A positive count is not enough, because another reading can survive without W(D). Ranking W(D) alone is insufficient because edge handling can depend on siblings.

W(D) alone has no siblings. Equal trees are not enough, because transparent productions can give equal trees. A loss that passes both channels changes no output of the check. The count includes W(D), and the readings belong to a set that contains it.

The walk pins the shape of W(D), not its tags. The tags follow from the derivation, and the cases pin them. A runner fails a case, or a corpus case, whose answer is no.

For slot reconstruction, the count channel proves membership in the raw forest before filtering. A filter can exclude that witness intentionally. The error then reports the raw witness first and an admitted competitor second.

Each library tests that a lowering error's message begins with the faulty definition's document, line and column. It also tests the error order of engine §3: a chain beside another alternative comes before an empty item of braces.

Each library also tests its recognizer on a capture of a rule that can end in many places (engine §4). The rule is `t → $l:t $r:t | A`, over n tokens. Then n − 1 completed items of that production span the input. With `t → t t | A`, one item does. A last test reads one production of C captures over C tokens, and counts C stored captured parts, not C².

### Faults

A shared case shows that a library is wrong where it fails. It cannot show that a library is right. So each library also breaks itself on purpose, one fault at a time, and makes sure that the shared cases see the break. A fault is a private switch of the library's own tests, which the documented API does not name. Each one changes one path of the engine, mostly a path of the check of engine §7, in a way that the specification forbids.

- The JavaScript library holds the full table. Its faults cover each observer of engine §7.5, the tags of synthetic tokens, and the routes and strictness of §7.4. They cover projection, queries (§7.6), cycles and ways to lose W(D). They also cover the order of steps 3 and 4 of §4. `lib/js/test/faults.json` names the cases that must catch each fault, and records every catch.
- Each other library has faults of its own paths. Some are paths that JavaScript does not have, such as a ranker that rebuilds the check's links from completed spans and applies the tests there. Others are paths that every library has in a form of its own. Examples are the strictness of route 3, a restoration's test, and the ways to lose W(D). Another is the processing again of an item that an ordinary step reaches after it was processed as strict. Its own tests name, for each fault, the shared cases that catch it.

Each library's fault test must establish three facts about each fault:

- How a case catches it: The test runs each named case twice. It examines the result alone and the witness hook alone, so each test stands on its own. The catch is `result` where only the result fails the case, `hook` where only the hook does, and `result+hook` where both do. Each library has a fault whose only catch is `hook`, a mutation that the result alone does not show. An example is a count that skips W(D)'s edge where its item has siblings.

  Each library also has a case where the hook catches candidates that skip W(D)'s edge. This tests the selection channel independently of the result. JavaScript labels a catch `bound` where the fault's own bound ends a recursion that it lets through.
- Its sites: A fault can have several places in the code. Each place is a declared site, and the test asserts that the named cases enter every declared site while the fault is on. So a case that catches a fault at one site does not hide a site that nothing reaches.
- Completeness: The list of faults comes from the declarations, and every fault has an entry in the table.

A fault of the strict path shows only where that path comes first. The queue of a set is first in, first out in JavaScript, Go and Rust, and last in, first out in Python. So `reparse-strict-reclose-late` catches the processing-again fault of the first three, and `reparse-strict-reclose-swapped` that of Python.

Apart from the table, each library's own tests lose the witness on purpose after recognition. They leave no completed item of `text` over R (`lost:roots`), or no counted derivation (`lost:count`). They make sure that the required form holds for the error `elision-witness-lost`, as "Engine cases" says.

## Notation cases: `notation/*.json`

```
{"description": "...", "document": "Markdown text", "expect": {"dom": PATTERN} or {"error": {"line": 3, "column": 7}}}
```

Each library reads the document as a grammar document (engine §8, §9). The reading makes a DOM (document object model), as `docs/output.md` describes. The library matches the DOM against the pattern, or it compares the position of the error with the expected position. The reader reports a syntax error at the first token that cannot continue the document. It reports an error of §9 at the first token of the offending construct.

Message wording is not part of conformance. Error cases pin only their line and column.

Every library also runs a notation case with `cacheMisses: true` through its document loader. The document first loads without a compiled entry. A matching compiled entry must give the same DOM.

Four further loads each change one identity field: the document hash, bootstrap hash, Unicode table hash, or DOM format. Each mismatched entry contains a valid DOM whose first rule has the name `cache-poison`. Each load must ignore that entry and give the original DOM. A second read with each loader must also give the original DOM.

JavaScript compares every notation case with the handwritten bootstrap reader. Both readers must produce the same DOM or error position.

The JavaScript library also reads each cache case with the handwritten bootstrap reader. Both DOMs must match every asserted name and equal each other. Each reader supplies the DOM for a separate cache exercise, including a cold load and all four mismatches.

Open names are names that grammar authors choose.

The `canonical-*` cases pair ASCII `K` with the canonically equivalent Kelvin sign in each open name context. Their DOM patterns assert rule names, tags, constant names, features, classifier names, classes, and query arguments. Patterns and elidable terminators assert their own names. Captures require lowercase ASCII, and fixed keywords, methods, flags, and engine names have no Kelvin spelling.

## Supplied notation values: `notation-values.json`

Each case gives a document, lexical aliases, and a DOM pattern or an error expectation. Every library adds each alias as a rule in the lexical stage of its bundled bootstrap. The rule recognizes `spelling`, emits `tags`, and sets its value to `value`. Its `leftmost-longest` flag selects it over ordinary lexical divisions. The library reads the document with this bootstrap and compares the DOM or error. A successful reading also exercises the cold, matching, and mismatched cache paths described above.

An error expectation pins its line and column through `expect.error`. Message wording is not part of conformance. The invalid pattern-name cases cover constants, nested patterns and rule conditions.

The canonical-name cases use canonically equivalent ASCII and Kelvin spellings. These aliases test captures and fixed names through a supplied notation. The invalid-name cases supply semantic values that the bundled notation cannot produce. These cases add no spelling to the bundled notation. The handwritten reader implements the bundled notation, so these cases apply to library readers.

## Recipe diagnostics: `recipe-diagnostics.json`

This file lists recipe fragments, diagnostic markers, and templates for every recipe position. Each library substitutes both channel operators and every fragment into each template. A recipe contains exactly one term, which can be a `++` chain. The reader reports a second term at its first token and tells the author to use `++`. The marker identifies that token or the first string of an invalid run.

Ordinary controls require the concatenation type error without a recipe instruction. JavaScript also runs the handwritten bootstrap reader against the same cases.

## Bootstrap errors: `bootstrap-errors.json`

Each case supplies bootstrap text or replaces the first place of `find` with `replace` in the bundled bootstrap, as "Places in fixtures" says. Each library loads a simple pipeline with that bootstrap and requires a grammar error. The error must name `notation/bootstrap.json`, including failures that arise when the loader constructs the stages. If a case supplies `line` and `column`, the error must keep that position. A case of the bundled bootstrap gives `at` instead, and the error must stand where `at` stands in the document `context`.

## Notation shapes: `notation-shapes.json`

```
{"description": "...", "document": "Markdown text", "inputs": ["b", "qs"], "control": [OUTCOME...], "loads": {"guard": [OUTCOME...]}}
```

A caller can supply its own `notation/bootstrap.json` (`docs/api.md`). Its notation can give the reader a tree of another shape, and engine §9 says how the reader reads it. Each library loads `document` as the one document of a stage `main`, with a bootstrap made from the bundled one. It then parses each of `inputs`, with the default API configuration. The outcome of an input is its bracket rendering if it parses, or else the kind of its error. A load that fails gives only the kind of its error.

- With the bundled bootstrap, the outcomes are `control`.
- Then each rule of the bundled bootstrap's syntax document, except `text`, gets a wrapper: a new rule whose one alternative is a reference to it. Every reference to the rule in that document becomes a reference to its wrapper. The outcomes are `control` again.
- Then each rule except `text` gets a name with `x` appended, in turn. The definition and every reference use that name. A rule named in `loads` gives a dialect, and the outcomes are those of `loads`. Any other rule gives the load error `grammar`. No other error escapes the library.

Each item of `extraParts` changes a rule of either notation stage. Its `find` stands once in the bundled bootstrap. The item's bootstrap has `replace` in that place ("Places in fixtures"). Each library loads the item's `document` with that bootstrap and parses its `inputs`, as above. The outcomes are those of `expect`.

An extra part holds text that the reader refuses if it reads it. An outcome other than `expect` then shows that the library read it. Other items change constructor shapes or supply tokens that the bundled lexical stage refuses. These tokens test reader validation, including guard errors and their priority (engine §9.3). An item whose `expect` is a load error can give `where`, `{"document": "g.md", "line": 3, "column": 21}`, the place of that error in its document. The load must then fail there, as `expect.where` says for an engine case.

## External JSON cases: `json-keys.json`

The shared cases exercise exact member names, escaped names, duplicate members, ignored values, and raw DOM contents. Bootstrap cases change the bundled bootstrap and require either a working reader or a grammar error with its document attribution. Cache cases use different source and cached grammars, so the parsing result proves whether the loader reads the cache. The optional `document` field selects the included document name. The cache template uses `@unicode@` for the fingerprint of the Unicode table.

The `loads` and `cached` fields state the expected behavior. Rust rejects ignored integers outside signed 64-bit range because of a reader limit. For those cases, `rustLoads` and `rustCached` record the current Rust behavior, and each note names the limit.

## Places in fixtures

No fixture names a line of a grammar document by its number. So an edit of a document never changes a fixture, unless it changes what the fixture is about. A fixture names a place by its content in two ways.

- In the `find` and `replace` of `bootstrap-errors.json` and `notation-shapes.json`, `"at":[*]` stands for a source position, `"at":[LINE,COLUMN]`, of any value. A place of `find` is a place where the text matches it, each `"at":[*]` matching one position. In `replace`, each `"at":[*]` takes the position that the one in the same order in `find` matched. So in `bootstrap-errors.json`, the `find` `"directives":[{"name":"ambiguity-resolution","args":["greedy"],"at":[*]}]` finds the lexical document's directives wherever the directive stands. The text of `find` is literal apart from `"at":[*]`.
- In `bootstrap-errors.json`, `at` is a text that stands exactly once in the grammar document `context`. The expected line and column of the error are those of the first character of that text. A line ends at CR LF, CR or LF, and a column counts code points.

Each library's runner finds these places in the same way, and `places.json` holds cases for those helpers. Every runner makes sure that its helpers give the expected results. Each entry of its `positions` gives a text, a `needle`, a line and a column. The line and column are `null` where the needle is absent, repeated or empty.

Each entry of its `substitutions` gives a text, a `find`, a `replace`, the number of places of `find` and the expected result. The result is the text after the replacement, or `null` where `find` stands nowhere. `tests/quoted-allow.txt` names the lines of its entries by phrases, as "Quoted texts" says.

## Malformed DOMs: `dom-malformed.json`

```
[{"description": "...", "directive": DIRECTIVE, "malformed": true},
 {"description": "...", "rule": RULE, "malformed": false}, ...]
```

Each item supplies one `directive` or one `rule` of a DOM (`docs/output.md`). A library puts the supplied item alone in its corresponding array, with all other declaration arrays present and empty. The DOM uses format 35. The library tests it as a precompiled DOM (engine §9). The DOM is malformed exactly when `malformed` is true.

An optional `unicode` member supplies the contents of `unicode.txt` for that case. Without it, the case uses the bundled table.

A library that refuses a malformed precompiled DOM reads the document instead. That refusal does not appear in a parse result. These cases test the DOM operation directly. The rule cases include restored spans, their accepted compositions, and invalid arguments.

## DOM depth cases: `dom-depth.json` and `dom-depth-source.json`

The shared depth cases pin the compound-ancestor count of [engine §9.3](../docs/engine.md#93-conversion-and-validation). They cover recursive DOM forms, leaves, cross-form transitions, and independent declaration and emission roots.

Each DOM case supplies an envelope without `format`, a `leaf`, a `wrapper`, and `atLimit`. The envelope and wrapper each contain one string placeholder, `$inner`. A runner wraps the leaf `atLimit` times and substitutes the result into the envelope. It supplies the current DOM format. The resulting DOM must pass, and one additional wrapper must fail because of depth.

The source cases give `head`, `prefix`, `leaf`, `suffix`, and `tail`. A runner repeats each prefix and suffix `atLimit` times around the leaf, then adds the head and tail. It surrounds that text with a jbogenbau fence. That document must read, and one additional repetition must fail because of depth. Source cases also cover signed tag tests and pattern terms under their enclosing constructors.

## Engine measurements

Measure work on growing inputs for [shared observations](../docs/engine.md#41-shared-candidate-observations), [boundary obligations](../docs/engine.md#42-boundary-obligations), [ranking](../docs/engine.md#6-choosing-a-parse), and [ranked admission](../docs/engine.md#61-ranked-admission-before-ranking).

Record chart items, packed proof edges, structural observation states, close observations, cycle contexts, and summary contexts. Record elapsed time and peak memory. Measure boundary records separately from structural states and close observations.

Include nested omissions, repeated wrappers, recursive queries, and ambiguous ranked groups. Include increasingly long lists, unary chains, and independent ambiguous children. Include long NA-term runs, free-modifier runs, and nested parentheses. Include aligned queries over lists whose items each choose one of two omissions.

For ranked admission, record chart facts, admission groups, and retained edges. Measure loader cost separately from recognition. Include stored-value comparison work when interpreting admission costs.

The cases in `without-elision-growth.json` bound the measured close-summary fixtures. Their bounds do not establish a grammar-wide bound on summaries. A passing language corpus alone does not establish sharing and termination properties. The growth sections below define the fixture bounds. The growth tests of each library define its counters, as `lib/js/test/ranked-growth.test.js` and `lib/js/test/grammar-growth.test.js` do in JavaScript.

### Unicode property performance gate

The [engine guarantee](../docs/engine.md#property-conformance-and-performance) requires complete profiles without a meaningful slowdown for dialects naming no additional property. This section defines the measurement policy. It separates timed samples from full-corpus outcome comparisons.

`python3 tools/bench-unicode-properties.py --baseline REF` compares all four libraries with baseline revision REF. The baseline is the implementation before property profiles. Both revisions use the same machine, runtime versions, core character data, build mode, corpus inputs, and parsing configuration. New abbreviation records remain available for candidate printing without changing the baseline's character classifications.

The timed corpus sample contains 400 cll-ebnf cases. Selection takes the first 400 case IDs in ASCII order from the baseline corpus. The manifest records their IDs, texts, features, and disabled features. The candidate uses those exact records rather than selecting its own sample. A missing record or an incompatible configuration fails the comparison.

The repeated-character workloads use this forwarding grammar:

```jbogenbau
%stage main
%ambiguity-resolution greedy
%rule text {token}
%rule token _
%emits $
```

The three inputs contain 4,096 ASCII a characters, 2,048 pairs of e and U+0301, or 1,365 Hangul 한 syllables. Every decomposed scalar passes through its own token rule and retains its tags. The text rule has no whole-constituent emission that merges those tokens.

Timings include stage-zero construction, parsing, and tag propagation. Each workload receives two warm-up runs, then nine paired timed runs with revision order alternating between pairs. Calibration selects one repetition count for both revisions of a workload, so each timed batch lasts at least one second. The report records that count and time per repetition. Median warm time per repetition can increase by at most five percent for each workload and library.

Cold runs use new processes and include loading and one timed corpus-sample batch. They use the same nine-pair ordering. The median increase cannot exceed five percent or 25 milliseconds, whichever is larger. The report also records peak memory and separate JSON serialization time. Those two measurements have no separate numerical gate.

Each revision also runs the full cll-ebnf corpus once for outcome comparison. These runs are outside the timing protocol and need no warm-ups or paired repetitions. The comparison includes every case's acceptance, failure stage, verdict, bracket tree, emitted words, warnings, and error or witness data. Every changed outcome appears in the report with its cause. Unexplained changes fail the gate.

A tag projection keeps all user tags and the engine inventory before profiles. That inventory consists of the atomic and seven major category tags, `_White_Space`, `_Emoji_Presentation`, and `_Emoji_Component`. The projection excludes Canonical_Combining_Class tags and every other newly exposed property tag. It applies recursively to all token and node tag sets, including attachments, witnesses, warnings, and error readings. Every other result field remains intact.

The workload comparison uses this projection for equality against the baseline. It still compares parse outcomes, complete tree structure, values, images, sources, spans, and all retained user tags. A reviewed full-corpus change does not excuse different parse work in a timed workload. Separate conformance cases inspect complete unprojected profiles, generic set operations, and serialization.

The harness records both revisions, environment, selection manifest, raw timings, medians, peak memory, serialization time, and full-corpus differences. It exits unsuccessfully for a timing failure, missing measurement, unexplained outcome change, or changed timed-workload result. CI requires this comparison for implementation changes that affect profiles. The gate cannot pass through omitted logical tags or reduced parse work.

## Growth cases: `growth.json`

```
[{"description": "...", "dialect": DIALECT, "text": "mi {links} klama", "link": ".e do",
  "small": 10, "large": 40, "most": 5}, ...]
```

Each item says that a bundled dialect's work on a long text grows in proportion to its length. A condition that reparses each whole prefix makes work grow faster than text length. No other case exposes this cost. The library builds two texts from `text`. It replaces `{links}` with `small` copies of `link`, joined by spaces, and then with `large` copies.

Both texts must parse. The library counts recognizer items for each text in the main parse and every nested parse. It excludes items made while loading the dialect. A library with a shared memo (engine §4.3) counts with the memo off, so that answers from the small text never shorten the large one. The count for `large` copies must be at most `most` times the count for `small` copies.

## Notation growth cases: `notation-growth.json`

```
[{"name": "groups", "description": "...", "prefix": "%rule text ", "open": "(", "middle": "A",
  "close": ")", "suffix": ""}, ...]
```

Each item says that reading a document whose constructs nest deep costs work in proportion to its length. A reader that types or copies a whole subtree at each level of nesting makes a deep document cost the square of its depth. No other case shows that.

One item nests sequences that each capture the same name, so the check of repeated captures marks captures at every level. The library counts each marking among its reader's steps.

Some items repeat no nesting but one long token, such as a name, a comment or a string. Each says that the lexical stage reads a long token in work in proportion to its length. A lexer can try every prefix or scan to a token's end from each character. Either behavior makes work grow with squared token length.

The library builds the document `prefix`, `open` n times, `middle`, `close` n times and `suffix`, in a fence. It builds it for n = 250 and for n = 1000. It reads each once with its reader, after one read that loads the notation. The read can end in an error. The library counts the items that its recognizer makes and the steps of its reader and of the walks of what the reader reads. The count for 1000 must be at most five times the count for 250.

The JavaScript library also reads each document with the hand-written bootstrap reader, whose lexer counts its steps too. The Rust library reads each on a thread with a stack of 2 MiB, which no depth changes. The Go library also reads each nested 20,000 deep, with the stack of a goroutine held to 1 MiB. A reader or a walk that recursed as deep as the document nests ends the process there.

A library compares only its own two counts. Counts from different libraries are not compared, since each library makes its items in its own way.

The Python tests need Python 3.14 or later. Their work counters use `sys.monitoring` to watch the selected code. Each nested counter uses a separate monitoring tool. Each counter disables its events and unregisters its callbacks before it frees the tool. The counters include calls, line steps, loop jumps, and weighted reads by C operations. A budget stops the work before the first unit past it runs.

## Query depth cases: `query-depth.json`

```
[{"name": "begins-chain", "description": "...", "grammar": "%rule text {x} ...", "link": "a",
  "count": 20000, "suffix": "b"}]
```

Each item says that nested queries nest as deep as the input makes them, with no bound (engine §4). A grammar whose conditions start a query inside each nested parse makes a chain of active queries as long as the text. A library that runs each nested parse on its call stack runs out of stack on such a chain.

The library loads `grammar` as the one stage of a dialect, which reads the text's characters. It parses `link` repeated `count` times, then `suffix`, and the parse must succeed. The parse uses an ordinary stack. JavaScript and Python use the main thread. Rust uses a test thread of default size. Go uses a goroutine whose stack is held to 1 MiB.

## Query work cases: `query-work.json`

```
[{"name": "queries-in-one-step", "description": "...", "head": "%rule text \"a\"\n%conditions ",
  "item": "$.following-tokens.matches(r{i})", "joiner": ", ", "tail": "", "rule": "\n%rule r{i} ε",
  "count": 400, "text": "a", "most": 8}]
```

Each item bounds how often a step or term evaluates its parts when it starts many queries. A query whose answer is not yet known halts the evaluation while its nested parse runs. The evaluation must then go on from where it halted. Restarting from the first condition evaluates preceding parts once per query. The work then grows with the square of the query count.

The library joins `item` for each i from 0 to `count` − 1 with `joiner`. It puts `head` before them and `tail` after them. It then appends `rule` once per i. In `item` and `rule`, `{i}` stands for i.

It loads the grammar as the one stage of a dialect and parses `text`, and the parse must succeed. The library counts every visit of a node of a condition or a term, before it evaluates the node, also in an evaluation that halts. The count has a budget of `most` times `count`, and the parse stops at the first visit past it.

## Shared memo runs: `shared-memo.json`

```
{"description": "...", "runs": [{"dialect": "bpfk", "texts": ["klama"], "options": [{}, {"until": "forms"}]},
  {"grammar": "%rule text X", "inputs": [[{"text": "x", "tags": ["X"]}]], "options": [{}]}]}
```

Each run tests that parses on one dialect do not depend on each other, which the shared memo of engine §4.3 must not change. A run names a bundled dialect, or gives `grammar` as an engine case does. Its inputs are `texts`, or `inputs`, which are token lists in the form of engine cases. Its options are option sets in the form of engine cases.

The parses of a run are each input under each option set, input by input. A library first makes each parse on a dialect whose shared memo holds nothing. These results are the reference. A library without a shared memo makes each reference parse on a fresh dialect.

It then makes the parses on one dialect, in order, then in reverse order, then in order again. A library with a shared memo uses its default bound there. It repeats the parses on one dialect whose bound is one entry for each generation, so that eviction happens during each parse. Each result must equal its reference as canonical JSON. A parse that ends in an error must give the same error.

Where dialects can serve several threads, a library also makes the parses from several threads at once on one dialect. Each thread makes every parse of the run, from its own starting place, and the test checks that each parse runs. It compares each result in the same way. The Go library runs this threaded test under the race detector in continuous integration.

Some runs pin one field of the shared key each: a token's value, image, tags or source offsets, or the source text. The runs for the value, tags, offsets and source text ask one query in each parse. So the memo of one parse cannot hide a missing field there. The run for the image asks two queries in each parse, over spans that differ only in an image. No run pins a token's text, since no condition reads it.

Other runs keep `begins` apart from `matches`, and serve `tags` and `matches` from one entry. Others turn on a gate of a classifier entry, or a conditional feature, over the same span content. One run asks a query that is an error of the grammar. One asks about a span longer than 64 tokens, and one puts separator characters in token values.

The runs with `without-elision` hold answers that read an aligned query, directly or through the memo of the parse. A library with a shared memo checks that the rules `driver` and `wrap` never enter it. Its test hooks see each served answer, and the start and end of each aligned nested parse. The shared memo must serve no answer while an aligned query is active, and the test must see some ordinary shared hits. The test also checks that aligned queries start, and that its own count agrees with the library's at each served answer.

The bound is a setting inside each library, for its own tests. It is not part of the API.

## Close growth cases: `without-elision-growth.json`

A nullable rule accepts an empty span. These cases bound close storage when a nullable rule repeats one shared child twice.

A close node stores an omitted terminator, a ranked seal, or a shared concatenation. A ranked seal records an uninspected ranked group.

`case` names the engine fixture that defines the family. `depths` gives the rule depths that each library tests.

`nodesPerDepth` and `slack` set the bound `nodesPerDepth*(depth+1)+slack`. Every library stops a growth case when close node creation passes this bound.

An aligned witness is a query proof with matching closes.

The runners replace `r16` with the selected deepest rule and regenerate each doubled rule. Each runner also demands that rule as an aligned witness, so the bound exercises close concatenation.

`unusedCases` names ordinary fixtures that receive an unreachable facility rule. These fixtures must keep their expected results and allocate no close observations.

An observed capture retains close information for a query. A caller is a rule that uses another rule.

`callerScope` bounds an ordinary repetition beside an observed capture. The observed rule can reach that repetition through a parenthesis. Its demand must not split the ordinary caller into different close sequences.

`impossiblePrefix` bounds a capture whose first token cannot start its aligned witness. The capture cannot be empty or begin with an omission. It needs no close sequences because every possible witness fails before their comparison.

Both families repeat the fixture's unit for each count in `lengths`. `maxCloseNodes` bounds close sequence nodes. `maxCloseStates` bounds close observation states. `itemsPerUnit` and `slack` bound chart items by `itemsPerUnit*length+slack`. Each library stops before its first count past a bound.

A family run uses `.without-elision-except`. Its entry names an engine fixture in `case`, and its strict twin in `strictCase`. Every library runs both at each size in `lengths`. The strict twin uses `.without-elision` instead.

An entry with `depths` uses those rule depths instead of token lengths. It regenerates the doubled rules as the strict case does. Every entry keeps its absolute bounds beside its bounds over the strict twin.

Each library also runs the shared engine cases with a conformance switch for family alignment. The switch applies the whole-observation deletion test of engine §4 beside the item summaries of §4.1. Both answers must agree for every eligible family witness. Only this switch can retain permission marks for the independent test.

A library records chart items, proof edges, close observation states, close sequence nodes and cycle contexts, with elapsed time and peak memory. For the family run, it also records summary states and automaton steps. A summary state is one distinct summary that some item of a family query takes. The dead summary and the identity of an empty item count only once an item takes them. Automaton steps follow the costs of engine §4.1. A witness record costs `2(n+1)` steps, and an image or preimage costs one step for each row of its relation.

A join costs one image for each row. An empty item without records has the identity relation, and an image, preimage or join through it costs nothing. A close or block that the automaton does not read costs nothing, such as one beyond `b`. The JavaScript work counters call these seven `items`, `packedEdges`, `closeStates`, `closeSequences`, `summaryContexts`, `familySummaries` and `familySteps`. No library retains a marked close, so there is no count of marked events.

Counts from different libraries are not compared, so most bounds compare a run with the same library's strict twin. An entry can hold these fields:

| Field | Bound at each length |
| --- | --- |
| `overStrict.itemsPercent`, `.itemsPercentPerUnit` and `.itemsSlack` | items ≤ strict items × (itemsPercent + itemsPercentPerUnit × length) / 100 + itemsSlack |
| `overStrict.closeStatesPerUnit` | close states ≤ strict close states + closeStatesPerUnit × length |
| `strictBound.closeStatesPerUnit` and `.closeStatesSlack` | the strict twin's close states ≤ closeStatesPerUnit × length + closeStatesSlack |
| `summaries.perSquare` and `.slack` | summary states ≤ perSquare × length² + slack |
| `steps.perCube` and `.slack` | automaton steps ≤ perCube × length³ + slack |
| `equalsStrict` | items and close states equal the strict twin's |
| `atMostStrict` | items and close states do not exceed the strict twin's |

Within `overStrict`, a missing field is zero. An entry without `overStrict` has no bound over its twin. `itemsPerUnit` and `slack` set an absolute linear bound on items.

## Result mutants: `result-mutants.json`

```
{"mutants": [{"name": "...", "case": "attach-tie.json", "path": ["error", "token"], "set": 0}, ...]}
```

Each mutant is a change to a canonical result that breaks an invariant (above). Every library runs the engine case `case` under `engine/`, and makes sure that its result keeps the invariants. Then it applies the change, and requires two refusals. The engine runner refuses the changed result, and so does the corpus runner.

So the four runners hold the same invariants, and no library keeps a list of its own. Each runner requires at least one mutant, so an emptied file does not pass in silence. `node tools/sync.js --check` makes sure that the file and corpus meet their schemas (`tools/corpus-shape.js`).

`path` leads from the result to the member or element that changes. A step is a member name or an index into a list, and the index -1 is the last element. No other negative index is defined. The change is one of these:

- `set`: the value there becomes the given value, `null` included.
- `copy`: the value there becomes a copy of the value at another path of the same result.
- `keep`: the list there keeps only its first `keep` elements.
- `remove`, with the value `true`: the member there is removed. The last path step is a member name because the runners remove list elements in different ways.
- `append`: the given value is added at the end of the list there.

## Corpus cases: `corpus/*.jsonl` and `core.txt`

The corpus format cannot express `feature-conflict`, which has no input position. Shared engine cases pin this error for bundled dialects.

Corpus identifiers stay stable when grammar rules change.

Dialect and grammar documents define dialect behavior. Corpus cases pin their texts, verdicts, and images. Shared engine cases also test stage values, recipes, attachment ownership, and source gaps. Image equality alone does not establish equal structure or ownership. Structural comparisons use each stage's input coordinates and map positions when token counts differ between stages.

`corpus/literary.jsonl` contains longer story bodies, songs, and paired repair cases for cll-ebnf and bpfk. [Literary text sources](text-sources/README.md) records their source snapshots, extraction boundaries, and transformations.

Each line is one case: a Lojban text, with the result that gencmu must give for it:

```
{"id": "cll.5.1.c5e1d1", "text": "do mamta mi", "dialect": "cll-ebnf", "expect": "accept",
 "verdict": "unique", "words": ["do", "mamta", "mi"], "brackets": "(do [mamta mi])"}
```

- `dialect` is the name of a bundled dialect. `features`, when present, lists the features that the case turns on. `withoutFeatures` lists those that it turns off.
- `expect` is `accept` or `reject`. For an accepted text, `verdict` is the verdict of the last stage, and `brackets` is its tree, with elided terminators hidden. For a rejected one, `stage` names the stage that rejected it.
- In a rejected case, `at` is the start of the error's `source` in the text. It counts code points from 0. At the end of the stage's input, `at` is the end of the source of its last token. That is the length of the text only when no pause, attached indicator or erased word follows that token. For example, `mi le ui` stops at 5, the end of `le`, which carries `ui`, and not at 8 (case `adhoc.syntax.at-end-after-attached-indicator`).

  A change in a preceding stage can move the failing token's start or end. For example, splitting words differently can move `at`. A change of that position fails the case. Two different failures can stop at the same place, so `at` does not show the reason for the rejection. It and the accepted twins of a rejection make the cases stronger, and neither proves the reason.

  An error with no position, such as an ambiguity, gives no `at`.
- `error` is present exactly when the result's error is of kind `ambiguous`. It is `{"kind": "ambiguous", "reason": "tie"}`, or the same with the reason `elision-only` (engine §6, §7). A case with any other result has no `error`, a rejection or an error of the grammar included. A case expects an ambiguity with `expect` set to `reject`, its `stage`, and this `error`. A third value of `expect` is not needed.
- The `reason` inside `error` is the reason of the ambiguous error. It is a field of `error`, and it is not the case's own `reason`, which explains the expected verdict (below). A case can have both.
- `ties`, when present, names the stage whose verdict is `tie`. A tie ends the run, so at most one stage has it, and that stage can come before the last.
- `words` records the words stage's output when that output is present. The case writes each token as its image (engine §5). The dialect's grammar recipes supply pause spaces and verbatim text.

A runner also tests tie invariants (above) for each corpus result. It fails a case whose result has the error code `elision-witness-lost`. Some corpus texts tie in their dialect, and those cases expect the tie. Each library also tests that its runner refuses the result mutants above. A case uses its pipeline declarations and the caller configuration. The case matches when every one of those fields that the case or the result of the library has is equal.

Every runner compares all of these fields, `at` included.

The runners differ on input that this format does not allow, such as a field whose value is null. So `node tools/sync.js --check` first makes sure that every case meets its schema (`tools/corpus-shape.js`). Each file is UTF-8, and each line is one JSON object. No object has a member name twice, at any depth, and every string is a sequence of Unicode scalar values, with no lone surrogate.

A case has only the fields above, and none of them is null. An accepted case has `verdict` and `brackets`. A rejected case has `stage`, and it has `at` exactly when it has no `error`.

The optional `seeded` field records a reference fixture's verdict, `"accept"` or `"reject"`. When gencmu expects a different verdict, `reason` explains that expectation in terms of its grammar. A case can also have `reason` without `seeded`, to explain a grammar change or a dialect policy. `node tools/corpus-departures.js` lists every such case, grouped by reason. A change to the `words` or `brackets` of a case needs no field of its own. It is a change to what gencmu produces, made in the same commit as the grammar change that causes it.

`core.txt` lists the ids of the sample that every library runs on each pull request. It holds every case that pins a text that a checked document quotes ("Quoted texts" below). So a change that makes such prose false fails in every library. On a pull request, the JavaScript and Rust libraries also run the whole corpus, and the others run it nightly. To run every case in JavaScript, run `GENCMU_CORPUS=full node --test test/corpus.test.js` in `lib/js/`.

### CLL source identities

For examples from *The Complete Lojban Language* (CLL), `cll.NUMBER.ANCHOR` uses the CLL 1.1 display number and the XML source anchor. The anchor identifies the source. Suffixes distinguish fixtures for the same source. The `.inherited` suffix distinguishes a fixture when another case uses the canonical identifier.

Unnumbered illustrations have numeric fixture labels. Their reasons state that those labels are not example numbers in the local CLL 1.1 rendering.

Numeric suffixes in `adhoc.syntax.errata.*`, `adhoc.syntax.errata-controls.*`, `adhoc.syntax.elision-unforced.*`, and `adhoc.syntax.negation-scope.*` name their candidate positions. A missing position corresponds to a shared corpus record or duplicate erratum text. The shared records explain their cases, and `core.txt` includes their identifiers. Other identifiers describe their content.

## CLL footnotes: `cll-footnotes.json`

A footnote is a reference whose definition follows the document. `tools/cll-footnotes.js` compares each CLL footnote with the published headings and example anchors in `cll-footnotes.json`. The file pins CLL 1.1 and the later versioned sources that the documents cite.

A source hash identifies the exact downloaded bytes. Page records include this hash, headings, and example numbers. The check reads the index once and uses no network. Both `tools/sync.js` and the JavaScript document tests run it.

Run `python3 tools/cll-footnotes-index.py` from the repository root to refresh the index from the published sources. The generator reads each source page once. To use saved source pages, add `--cache-dir PATH`. Read each citation's clause to make sure that its source supports the statement. Matching numbers alone do not prove that relationship.

## Quoted texts: `quoted-allow.txt`

A grammar document often says what gencmu does with a Lojban text that it quotes. A corpus case pins that text. Then a grammar change that makes the sentence false fails the case. `node tools/quoted-texts.js` makes sure that each quoted text has a case or an entry in the allow-list `quoted-allow.txt`. `node tools/sync.js --check` runs the same check.

A quoted text is a code span in the prose of a document, outside code blocks, with these properties:

- It has two words or more, separated by white space. A single word is often a name or a part of a rule.
- It holds only lowercase ASCII letters, apostrophes, periods, commas and white space, and each word has a letter. So a rule name is not a quoted text, since it has a hyphen or a digit. Nor is a selma'o or a token, which is uppercase, or jbogenbau, which has brackets and other symbols.
- It holds no `...` or `…`, which mark a gap in the words.

The check finds the code spans with the CommonMark and GFM parser of `tools/markdown.js`, so a code block holds none. Every prose block is one line, with its code spans ("Documents" in `docs/design.md`). So the line of a text's code span is the paragraph, heading or table row that quotes it.

The check covers every document that the pipelines of the cll-ebnf and bpfk dialects include, at any depth, and the two dialect documents themselves. `CHECKED_DIALECTS` in `tools/quoted-texts.js` names these dialects. The includes come from the DOMs of the source documents, and each path resolves as the pipeline resolves it. A checked document has the dialects that its claims are about: those of the two that include it.

The experimental and Zantufa dialects include some of these documents and layer their own over them. So a claim about one of them is checked only where the prose names it. Every other grammar document is left out with a reason. A document that only other dialects include has the reason that names them, read from their pipelines.

The dialect documents of those dialects, and any document that no dialect includes, have a reason in `UNCHECKED`. A grammar document with no reason is an error, so a new document is not left out in silence.

The words of a quoted text, joined by single spaces, are compared with the text of each corpus case, written the same way. A quoted text needs a case of each dialect of its document. Its scope can name more dialects, as in "the bpfk dialect rejects it" or "In cll-ebnf and bpfk". The text then needs a case of each of those too.

The scope includes the list item that holds the text and every enclosing item, even inside a block quote. It excludes nested lists from each item. Outside a list item, the scope is the paragraph, heading or table row. A blank line inside an item changes no scope.

A name in a nested item does not scope its parent. A name scopes all nested items. A name counts in any case, when it stands as a word in the prose or in the text of a link.

A name in a code span or a link target does not count. The names are those of the dialect documents, less `notation`. In this prose, "experimental" always names the dialect.

Each dialect that a text needs has one reading of it. A case of the whole text gives its verdict and brackets. A case of an entry (below) gives its verdict and role. The two kinds are compared apart.

The dialects that the scope does not name must read the text alike, since the sentence then speaks for all of them. A text with different readings in two dialects is an error unless its scope names one of them. Naming a third dialect does not change this. The sentence then says which dialect it is about, and what the other does. This compares only the cases, never the sentence.

A sentence that says how a text reads quotes that exact text. For example, it says "Here `le poi blabi gerku cu klama` parses", not "the text without `ku'o` parses". Then the check sees the text that the claim is about.

The case pins what the sentence says about the text: its verdict, and its brackets or words where the sentence says how the text reads. Before you add a case, parse the quoted text to make sure that the claim holds. If the claim is false, correct the prose. No tool compares the verdict that a sentence states with the case.

When a case fails, the JavaScript corpus runner names the lines that the case pins, as `quoted at grammars/syntax/cll.md:669`. These are the lines that quote the case's text, and those that quote a fragment that an entry of `quoted-allow.txt` pins with the case. The prose there can be false.

Every case that pins a quoted text, by its own text or through an entry of `quoted-allow.txt`, is in `core.txt`. So every library runs it on a pull request. The check reports a case that is not there.

Each entry of `quoted-allow.txt` covers one quoted text in one document: every line that quotes it there, or the lines that the entry names. Its line is the text, then ` # `, then the document, with ` @ "PHRASE"` for each line where it names them. An example is `va pu # grammars/syntax/cll.md @ "Space can precede time"`. Then comes one of these:

- ` = ` and cases, each as its id after its role. A role applies to the ids after it, and a role with no id after it is an error. A role is the name of a rule, `words` or `reject`. The check parses each case.

  With a rule, the tree of some stage has a node of that rule whose words are exactly the quoted text. With `words`, some stage gives the text's words as the images of tokens in a row, one image for each word. The dialect's grammar recipes define these strings. For example, `la djim.bu` has the images `la` and `djim bu`.

  These tokens, with their attachments, also stand together in the case's text: no letter between them is outside them. So `mi ui klama` shows `mi klama`, and `mi do si klama` does not. With `reject`, the dialect rejects the case. Both `at` and the parsed error's source start lie within the quoted text or its following word. The cases include each required dialect, even when a whole-text case contains the fragment's words. Such a whole-text case does not pin the fragment's claim.

  This form is for a part of a text that the sentence makes a claim about: a special grouping, a rejection or a repair. An example is `na'e ka'e` as one `simple-tense-modal`. The author makes sure that the role is the one that the sentence gives the fragment.
- ` # ` and the reason. This form is for notation, such as `nu'i terms nu'u`, and for a shape that a rule produces as written, such as `mi .e do`. It is also for a part of a reading that the grammar does not choose, where the whole text has its own case. A reason that begins with "deferred:" names the branch responsible for the text's pin.

The sentence on each line makes its own claim. When a document quotes an unpinned text on several lines, its entry names those lines. Each line can also have its own entry.

A phrase names a line by its content, not by its number. So an edit above the line never changes the entry. The phrase is a part of the line's Markdown, such as a few words of the sentence that quotes the text. It names the one line of the document that quotes the text and holds the phrase. The check reports a phrase on no such line or on several. It also reports an entry that names no lines and covers several, and a named line that does not need the entry.

Lines that begin with `#` are comments. An entry that the check does not need is an error, so the list does not keep stale entries.

## Unicode normalization

`unicode/NormalizationTest.txt` is the complete Unicode 15.1 normalization conformance file from Unicode.org. Each library tests its canonical decomposition against every data line. Columns 1, 2 and 3 decompose to column 3. Columns 4 and 5 decompose to column 5. Every scalar that part 1 omits decomposes to itself.

The shared engine cases also pin original sources, canonical ordering, class-zero barriers, leading marks, Hangul arithmetic and caller tokens. Loader cases cover table-dependent caches, exact escaped scalars, original user-constant positions, and include paths. Escape-inspection cases pin the ordering between lexical recognition, escape errors, syntax errors, and reader errors. The [escape migration](../docs/notation.md#escape-migration) defines changed fixture outcomes.
