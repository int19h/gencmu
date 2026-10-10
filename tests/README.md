# The shared tests

Every gencmu library runs every shared case that its API can express. The Rust library skips two engine cases, as "Engine cases" says. If a case fails in one library and passes in another, there is a bug. The bug is in the library that disagrees with `docs/engine.md`, or in the specification itself.

## External JSON cases: `json-keys.json`

The shared cases exercise exact member names, escaped names, duplicate members, ignored values, and raw DOM contents. Bootstrap cases change the bundled bootstrap and require either a working reader or a grammar error with its document attribution. Cache cases use different source and cached grammars, so the parsing result proves whether the loader reads the cache. The optional `document` field selects the included document name.

The `loads` and `cached` fields state the expected behavior. Rust rejects ignored integers outside signed 64-bit range because of an existing reader limit. For those cases, `rustLoads` and `rustCached` record the current Rust behavior, and each note names the limit. The coordinator tracks that limit outside the numbers branch.

## Engine cases: `engine/*.json`

Each file is one case:

```
{
  "description": "what the case pins down, and which section of docs/engine.md",
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

The input is `input` or `tokens`. `input` is a string of characters, read as engine §1 says. `tokens` replaces the input of the first stage. Each token gets these values:

- Its tags are its listed tags, each written as the output writes a tag (`docs/output.md`). So a character tag is `'a'`.
- Its text is as given.
- Its phonemes are the `phonemes` member if present, or else none.
- Its label is its text.
- Its span is `[i, i+1)`.
- Its source is the position of its text in the texts joined with single spaces.
- Its attachments are its `before` and `after` members, when present, each a list of tokens in this same form. A caller cannot supply attachments. So a list that is not empty is a `usage` error, and the library drops an empty one (`docs/api.md`). The Rust library, whose input tokens have no attachments, skips a case whose tokens have either member.

Auto features (engine §13) are off for a case unless its options say `"autoFeatures": true`.

`options.features` and `options.withoutFeatures` are the features the caller turns on and off (engine §13).

`options.until`, when present, names the last stage to run (engine §13). A name that is not a stage of the dialect is a `usage` error. No case gives an empty name, because Go cannot tell an empty name from no name (`docs/api.md`). Each library tests an empty name in its own tests.

`expect.result` is a pattern matched against the canonical result of `docs/output.md`. A pattern matches in these ways:

- An object matches when every member of the pattern matches the member of the same name.
- An array matches when it has the same length and each element matches.
- Anything else matches when it is equal.

A pattern never pins the `message` of an error. Its wording is each library's own (`docs/output.md`), so the JavaScript runner refuses a case whose pattern holds one.

Every runner also checks these invariants on each canonical result that a case gives, whatever the case expects. A case cannot turn them off, and its pattern need not repeat them:

- An error of kind `ambiguous` has no member `token` and no member `source`.
- No stage has a member `tied`.
- A stage whose verdict is `tie` has no member `output`, and it is the last stage of the result.
- Such a result has `ok` false and `tree` null. Its error has kind `ambiguous`, reason `tie`, and that stage's name. It contains exactly two readings.
- No result has an error with the code `elision-witness-lost`. Engine §7.8 proves raw witness membership when recognition meets no grammar error. Section 7.9 reports witness loss only for raw absence. So no grammar can give it, and it is a defect of the library, whatever the case expects.

A library's own tests lose the witness on purpose, through a private switch, and call the engine directly, not through the runner. They check the form of the error: it has the kind `grammar`, a `stage`, `chosen` and `completion`, and no `token`, `source`, `line`, `column`, `expected`, `reason` or `readings`. Its stage has the verdict `resolved` and no `output`, and it is the last stage of the result. A library's own tests also show that an ordinary error of the grammar in the check has no `code`.

Take each stage where the check of engine §7 ran and ended without an error of the grammar. Every runner also asks its library whether that check kept its witness. The library answers through a test-only export that the documented API does not name (as `gencmu::tools` does in Rust), or through a module of its own tests. The answer records raw W(D), which engine §7.8 reconstructs from the chosen derivation. Admission can intentionally exclude that witness. The hook observes that ranking, and it ranks nothing itself:

- **The walk.** After the check recognizes R and before it ranks, a walk looks for W(D) in the chart. It takes each occurrence in the derivation tree on its own, even where the representation shares one object between occurrences. It marks the edges or links that W(D) uses. JavaScript and Python mark an edge by its index among its item's edges. Go marks a link. Rust marks a link as its ranker rebuilds it, by the item and the set where its predecessor stands. Where the chart does not hold W(D), the answer is no.
- **The count channel.** The check passes the marks to the ranker that it uses. Beside each item's count, capped at two, the ranker keeps a bit: whether the count includes a derivation made only of marked edges. The same loop decides both, over the same edges, in the same contexts, with the same faults. So a choice that drops W(D) from the count also drops it from the bit. A cut that closes a cycle has no bit. The loop may stop once the count is two, but at a marked item only once the bit is known. A root of W(D) must have the bit.
- **The selection channel.** An elision-only error reports raw W(D) first, including when admission excludes it. The second reading is the T-first best admitted competitor distinct from W(D). The walk builds the witness actions in post-order for comparison.

A parse that no test watches passes no marks, and its ranker does the same work as before.

The hook asks about the check's own ranking because any other question is a stand-in. A chart that holds W(D) is not enough, because a faulty ranker can still lose it. A positive count is not enough, because another reading can survive without W(D). A ranking of W(D) alone is not enough either, because the ranker's handling of an edge can depend on its siblings, and W(D) alone has none. Equal trees are not enough, because transparent productions can give equal trees. A loss that passes both channels changes no output of the check: the count still counted W(D), and the readings are those of a set that holds it.

The walk pins the shape of W(D), not its tags. The tags follow from the derivation, and the cases pin them. A runner fails a case, or a corpus case, whose answer is no.

For slot reconstruction, the count channel proves membership in the raw forest before filtering. A filter can exclude that witness intentionally. The error then reports the raw witness first and an admitted competitor second.

A pattern matches a result that has members beyond its own. So the invariants, and not the patterns, say that a tied stage has no output.

`expect.diagnostic` pins the code of a ranked-choice loading error. The API supplies that code directly. Loading diagnostics also expose their written group, option, expression, and inheritance witness where available.

`expect.brackets` is the bracket rendering, with elided terminators hidden. `expect.warnings` is the list of warnings of the result, compared whole. So `[]` says that there are no warnings. `expect.features` is the list of features of the dialect (`docs/api.md`), compared whole. Each feature is written as `{"name":..., "kind":..., "default":...}`.

A case can also parse its input several times with the one loaded dialect. Then it has `parses`, a list of objects, each with its own `options` and `expect`, in place of the case's `options` and `expect`:

```
"parses": [{"options": {}, "expect": {"brackets": "a"}}, {"options": {"features": ["f"]}, "expect": {"error": "grammar"}}]
```

The library loads the dialect once, and then parses the input with each item's options in order. Each result matches its item's `expect`, as below. So a case can show that one loaded dialect gives each set of features its own result, whatever it parsed before.

`expect.error` is the error kind, when the case is about an error. For a grammar that cannot be loaded, the result is the error alone. For a mistake of the caller, `usage`, there is no result.

A load that fails gives only its error. Its kind is `grammar` for a grammar that cannot be loaded. It is `usage` for a mistake of the caller at load, such as a document held in memory that is not a sequence of Unicode scalar values (engine §1). A case expects such an error with `expect.error` of that kind. For a `grammar` error, it can also give `expect.where`. It gives no `result`, `brackets`, `warnings` or `features`, because only a loaded dialect gives them. A runner fails a case when the load fails with another kind, or when the case expects one of these members. It also fails a case that gives `expect.where` with a kind other than `grammar`.

An error that lowering finds (engine §3), such as an item of braces that can match no tokens, is not a load error. The dialect loads, and the parse gives a result whose error has the kind `grammar`, so a case expects it with `expect.error`. Its message, which names the definition at fault, is the library's own, so no case compares it.

Each library tests that the message of such an error begins with the document, line and column of that definition. It also tests the error order of engine §3: a chain beside another alternative comes before an empty item of braces.

Each library also tests its recognizer on a capture of a rule that can end in many places (engine §4). The rule is `t → $l(t) $r(t) | A`, over n tokens. Then n − 1 completed items of that production span the input. With `t → t t | A`, one item does. A last test reads one production of C captures over C tokens, and counts C stored captured parts, not C².

`expect.where`, when present, is where the error of a grammar that cannot be loaded stands. It is only for an error of kind `grammar`. It names a document of the case and a line and a column in it. For a case with `grammar`, the document is `main.md`. Its fence is line 1, so the rules start on line 3, or on line 2 when they hold their own `%ambiguity-resolution`.

### Faults

A shared case shows that a library is wrong where it fails. It cannot show that a library is right. So each library also breaks itself on purpose, one fault at a time, and checks that the shared cases see the break. A fault is a private switch of the library's own tests, which the documented API does not name. Each one changes one path of the engine, mostly a path of the check of engine §7, in a way that the specification forbids.

- The JavaScript library holds the full table. Its faults cover each observer of engine §7.5, the tags of synthetic tokens, and the routes and strictness of §7.4. They also cover the projection, the queries of §7.6, cycles and maximality in the check, the order of steps 3 and 4 of §4, and the ways to lose W(D). `lib/js/test/faults.json` names the cases that must catch each fault, and records every catch.
- Each other library has faults of its own paths. Some are paths that JavaScript does not have, such as a ranker that rebuilds the check's links from completed spans and applies the tests there. Others are paths that every library has in a form of its own. Examples are the strictness of route 3, a restoration's test, and the ways to lose W(D). Another is the processing again of an item that an ordinary step reaches after it was processed as strict. Its own tests name, for each fault, the shared cases that catch it.

Each library's fault test checks three things for each fault:

- **How a case catches it.** The test checks each named case twice, once by its result alone and once by the witness hook alone, so that each check is shown on its own. The catch is `result` where only the result fails the case, `hook` where only the hook does, and `result+hook` where both do. Each library has a fault whose only catch is `hook`, a mutation that the result alone does not show. An example is a count that skips W(D)'s edge where its item has siblings. Each library also has a case that the hook catches when the candidates skip W(D)'s edge, so the selection channel is shown to work by itself, whatever the result does. JavaScript labels a catch `bound` where the fault's own bound ends a recursion that it lets through.
- **Its sites.** A fault can have several places in the code. Each place is a declared site, and the test asserts that the named cases enter every declared site while the fault is on. So a case that catches a fault at one site does not hide a site that nothing reaches.
- **Completeness.** The list of faults comes from the declarations, and every fault has an entry in the table.

A fault of the strict path shows only where that path comes first. The queue of a set is first in, first out in JavaScript, Go and Rust, and last in, first out in Python. So `reparse-strict-reclose-late` catches the processing-again fault of the first three, and `reparse-strict-reclose-swapped` that of Python.

Apart from the table, each library's own tests lose the witness on purpose after recognition. They leave no completed item of `text` over R (`lost:roots`), or no counted derivation (`lost:count`). They check the form of the error `elision-witness-lost`, as "Engine cases" says.

## Notation cases: `notation/*.json`

```
{"description": "...", "document": "Markdown text", "expect": {"dom": PATTERN} or {"error": {"line": 3, "column": 7}}}
```

Each library reads the document as a grammar document (engine §8, §9). The reading makes a DOM (document object model), as `docs/output.md` describes. The library matches the DOM against the pattern, or it compares the position of the error with the expected position. The reader reports a syntax error at the first token that cannot continue the document. It reports an error of §9 at the first token of the offending construct.

## Bootstrap errors: `bootstrap-errors.json`

Each case supplies bootstrap text or replaces the first place of `find` with `replace` in the bundled bootstrap, as "Places in fixtures" says. Each library loads a simple pipeline with that bootstrap and requires a grammar error. The error must name `notation/bootstrap.json`, including failures that arise when the loader constructs the stages. If a case supplies `line` and `column`, the error must keep that position. A case of the bundled bootstrap gives `at` instead, and the error must stand where `at` stands in the document `context`.

## Notation shapes: `notation-shapes.json`

```
{"description": "...", "document": "Markdown text", "inputs": ["b", "qs"], "control": [OUTCOME...], "loads": {"guard": [OUTCOME...]}}
```

A caller can supply its own `notation/bootstrap.json` (`docs/api.md`). Its notation can give the reader a tree of another shape, and engine §9 says how the reader reads it. Each library loads `document` as the one document of a stage `main`, with a bootstrap made from the bundled one. It then parses each of `inputs`, with the options of the API's default. The outcome of an input is its bracket rendering if it parses, or else the kind of its error. A load that fails gives only the kind of its error.

- With the bundled bootstrap, the outcomes are `control`.
- Then each rule of the bundled bootstrap's syntax document, except `text`, gets a wrapper: a new rule whose one alternative is a reference to it. Every reference to the rule in that document becomes a reference to its wrapper. The outcomes are `control` again.
- Then each rule of that document, except `text`, gets a new name in turn: its name with `x` after it, in its definition and in every reference to it. A rule named in `loads` gives a dialect, and the outcomes are those of `loads`. Any other rule gives the load error `grammar`. No other error escapes the library.

Each item of `extraParts` gives a rule a part that the reader does not read. In the bundled bootstrap's syntax document, `find` stands once, and the bootstrap of the item has `replace` in its place ("Places in fixtures"). Each library loads the item's `document` with that bootstrap and parses its `inputs`, as above. The outcomes are those of `expect`.

The extra part holds text that the reader refuses if it reads it, so an outcome other than `expect` shows that the library read it. Other items give a rule of the notation another shape, such as a `repetition` whose markers stand elsewhere. An item whose `expect` is a load error can give `where`, `{"document": "g.md", "line": 3, "column": 21}`, the place of that error in its document. The load must then fail there, as `expect.where` says for an engine case.

## Places in fixtures

No fixture names a line of a grammar document by its number. So an edit of a document never changes a fixture, unless it changes what the fixture is about. A fixture names a place by its content in two ways.

- In the `find` and `replace` of `bootstrap-errors.json` and `notation-shapes.json`, `"at":[*]` stands for a source position, `"at":[LINE,COLUMN]`, of any value. A place of `find` is a place where the text matches it, each `"at":[*]` matching one position. In `replace`, each `"at":[*]` takes the position that the one in the same order in `find` matched. So in `bootstrap-errors.json`, the `find` `"directives":[{"name":"ambiguity-resolution","args":["greedy"],"at":[*]}]` finds the lexical document's directives wherever the directive stands. The text of `find` is literal apart from `"at":[*]`.
- In `bootstrap-errors.json`, `at` is a text that stands exactly once in the grammar document `context`. The expected line and column of the error are those of the first character of that text. A line ends at CR LF, CR or LF, and a column counts code points.

Each library's runner finds these places in the same way, and `places.json` holds cases that every runner checks its helpers against. Each entry of its `positions` gives a text, a `needle`, a line and a column. The line and column are `null` where the needle is absent, repeated or empty. Each entry of its `substitutions` gives a text, a `find`, a `replace`, the number of places of `find` and the expected result. The result is the text after the replacement, or `null` where `find` stands nowhere. `tests/quoted-allow.txt` names the lines of its entries by phrases, as "Quoted texts" says.

## Malformed directives: `dom-malformed.json`

```
[{"description": "...", "directive": DIRECTIVE, "malformed": true}, ...]
```

Each item is one directive of a DOM (`docs/output.md`). A library puts it alone in an otherwise empty DOM of the current format, and checks the DOM as it checks a precompiled one (engine §9). The DOM is malformed exactly when `malformed` is true. A library that refuses a malformed precompiled DOM reads the document instead, so the check is not visible through a parse. That is why these cases test the check directly.

## Growth cases: `growth.json`

```
[{"description": "...", "dialect": DIALECT, "text": "mi {links} klama", "link": ".e do",
  "small": 10, "large": 40, "most": 5}, ...]
```

Each item says that a bundled dialect's work on a long text grows in proportion to its length. A condition that parses a whole prefix again at each step makes a long text cost more than its length says, and no other case shows that. The library builds two texts from `text`. It replaces `{links}` with `small` copies of `link`, joined by spaces, and then with `large` copies. Both texts must parse. The library counts the items that its recognizer makes for each text, in the main parse and in every nested parse, but not while it loads the dialect. The count for `large` copies must be at most `most` times the count for `small` copies.

## Notation growth cases: `notation-growth.json`

```
[{"name": "groups", "description": "...", "prefix": "%rule text ", "open": "(", "middle": "A",
  "close": ")", "suffix": ""}, ...]
```

Each item says that reading a document whose constructs nest deep costs work in proportion to its length. A reader that types or copies a whole subtree at each level of nesting makes a deep document cost the square of its depth. No other case shows that.

One item nests sequences that each capture the same name, so the check of repeated captures marks captures at every level. The library counts each marking among its reader's steps.

Some items repeat no nesting but one long token, such as a name, a comment or a string. Each says that the lexical stage reads a long token in work in proportion to its length. A lexer that tries every prefix of a name, or scans to a token's end again from each character inside it, makes the token cost the square of its length.

The library builds the document `prefix`, `open` n times, `middle`, `close` n times and `suffix`, in a fence. It builds it for n = 250 and for n = 1000. It reads each once with its reader, after one read that loads the notation. The read can end in an error. The library counts the items that its recognizer makes and the steps of its reader and of the walks of what the reader reads. The count for 1000 must be at most five times the count for 250.

The JavaScript library also reads each document with the hand-written bootstrap reader, whose lexer counts its steps too. The Rust library reads each on a thread with a stack of 2 MiB, which no depth changes. The Go library also reads each nested 20,000 deep, with the stack of a goroutine held to 1 MiB. A reader or a walk that recursed as deep as the document nests ends the process there.

A library compares only its own two counts. Counts from different libraries are not compared, since each library makes its items in its own way.

The Python tests need Python 3.12 or later. Their work counters use `sys.monitoring` to watch the selected code. Each nested counter uses a separate monitoring tool. Each counter disables its events and unregisters its callbacks before it frees the tool. The counters include calls, line steps, loop jumps, and weighted reads by C operations. A budget stops the work before the first unit past it runs.

## Query depth cases: `query-depth.json`

```
[{"name": "begins-chain", "description": "...", "grammar": "%rule text {x} ...", "link": "a",
  "count": 20000, "suffix": "b"}]
```

Each item says that nested queries nest as deep as the input makes them, with no bound (engine §4). A grammar whose conditions start a query inside each nested parse makes a chain of active queries as long as the text. A library that runs each nested parse on its call stack runs out of stack on such a chain.

The library loads `grammar` as the one stage of a dialect, which reads the text's characters. It parses `link` repeated `count` times, then `suffix`, and the parse must succeed. It runs the parse on an ordinary stack: the main thread in JavaScript and Python, a test thread of the default size in Rust, and a goroutine whose stack is held to 1 MiB in Go.

## Query work cases: `query-work.json`

```
[{"name": "queries-in-one-step", "description": "...", "head": "%rule text 'a'\n%conditions ",
  "item": "matches(after($), r{i})", "joiner": ", ", "tail": "", "rule": "\n%rule r{i} ε",
  "count": 400, "text": "a", "most": 8}]
```

Each item says that a step or a term that starts many queries evaluates each part of its conditions and terms a bounded number of times. A query whose answer is not yet known halts the evaluation while its nested parse runs. The evaluation must then go on from where it halted. Starting the step again from its first condition would evaluate the earlier parts once for each query, the square of their number.

The library builds the grammar from `head`, then `item` once for each i from 0 to `count` − 1, joined by `joiner`, then `tail`, then `rule` once for each i. In `item` and `rule`, `{i}` stands for i. It loads the grammar as the one stage of a dialect and parses `text`, and the parse must succeed. The library counts every visit of a node of a condition or a term, before it evaluates the node, also in an evaluation that halts. The count has a budget of `most` times `count`, and the parse stops at the first visit past it.

## Result mutants: `result-mutants.json`

```
{"mutants": [{"name": "...", "case": "attach-tie.json", "path": ["error", "token"], "set": 0}, ...]}
```

Each mutant is a change to a canonical result that breaks an invariant (above). Every library runs the engine case `case` under `engine/`, and checks that its result keeps the invariants. Then it applies the change, and requires two refusals. The engine runner refuses the changed result, and so does the corpus runner. So the four runners hold the same invariants, and no library keeps a list of its own. Each runner requires at least one mutant, so an emptied file does not pass in silence. `node tools/sync.js --check` checks the shape of the file, as it does that of the corpus (`tools/corpus-shape.js`).

`path` leads from the result to the member or element that changes. A step is a member name or an index into a list, and the index -1 is the last element. No other negative index is defined. The change is one of these:

- `set`: the value there becomes the given value, `null` included.
- `copy`: the value there becomes a copy of the value at another path of the same result.
- `keep`: the list there keeps only its first `keep` elements.
- `remove`, with the value `true`: the member there is removed. The last step of its path is a member name, since the runners would remove an element of a list in different ways.
- `append`: the given value is added at the end of the list there.

## Corpus cases

Some corpus IDs preserve historical rule names. Their identifiers stay stable across grammar migrations.: `corpus/*.jsonl` and `core.txt`

Each line is one case: a Lojban text, with the result that gencmu must give for it:

```
{"id": "cll.5.1.c5e1d1", "text": "do mamta mi", "dialect": "cll-ebnf", "expect": "accept",
 "verdict": "unique", "words": ["do", "mamta", "mi"], "brackets": "(do [mamta mi])"}
```

- `dialect` is the name of a bundled dialect. `features`, when present, lists the features that the case turns on. `withoutFeatures` lists those that it turns off.
- `expect` is `accept` or `reject`. For an accepted text, `verdict` is the verdict of the last stage, and `brackets` is its tree, with elided terminators hidden. For a rejected one, `stage` names the stage that rejected it.
- `at`, in a rejected case, is where that stage stopped, as a position in the text: the start of the `source` of the error, in code points, counted from 0. At the end of the stage's input, `at` is the end of the source of its last token. That is the length of the text only when no pause, attached indicator or erased word follows that token. For example, `mi le ui` stops at 5, the end of `le`, which carries `ui`, and not at 8 (case `adhoc.syntax.at-end-after-attached-indicator`). A change to an earlier stage, such as one that splits words in another way, can move the start or the end of the token where the stage stops, and then `at` moves too. A change of that position fails the case. Two different failures can stop at the same place, so `at` does not show the reason for the rejection. It and the accepted twins of a rejection make the cases stronger, and neither proves the reason. An error with no position, such as an ambiguity, gives no `at`.
- `error` is present exactly when the result's error is of kind `ambiguous`. It is `{"kind": "ambiguous", "reason": "tie"}`, or the same with the reason `elision-only` (engine §6, §7). A case with any other result has no `error`, a rejection or an error of the grammar included. A case expects an ambiguity with `expect` set to `reject`, its `stage`, and this `error`. A third value of `expect` is not needed.
- The `reason` inside `error` is the reason of the ambiguous error. It is a field of `error`, and it is not the case's own `reason`, which explains a departure from the seed (below). A case can have both.
- `ties`, when present, names the stage whose verdict is `tie`. A tie ends the run, so at most one stage has it, and that stage can come before the last.
- `words` records the word stage's output when that output is present. The case writes each token as its label (engine §5). So a pause inside a word is a space, and an opaque part is its text.

A runner also checks the invariants of a tie (above) on the result of each corpus case, and fails a corpus case whose result has an error with the code `elision-witness-lost`. No corpus text ties in its dialect, so each library also tests that its runner refuses the result mutants below. A case runs with auto features on, which is the default of the API. The case matches when every one of those fields that the case or the result of the library has is equal. Every runner compares all of these fields, `at` included.

The runners differ on input that this format does not allow, such as a field whose value is null. So `node tools/sync.js --check` checks the shape of every case first (`tools/corpus-shape.js`). Each file is UTF-8, and each line is one JSON object. No object has a member name twice, at any depth, and every string is a sequence of Unicode scalar values, with no lone surrogate. A case has only the fields above, and none of them is null. An accepted case has `verdict` and `brackets`. A rejected case has `stage`, and it has `at` exactly when it has no `error`.

The corpus started from a seed: a fixture collection whose verdicts came from another parser. Where the expectation of gencmu differs from that seed, the case says so. `"seeded": "accept"` or `"reject"` is the verdict of the seed, and `reason` explains the expectation in terms of its grammar. A case can also have `reason` without `seeded`, to explain a grammar change or a dialect policy. `node tools/corpus-departures.js` lists every such case, grouped by reason. A change to the `words` or `brackets` of a case needs no field of its own. It is a change to what gencmu produces, made in the same commit as the grammar change that causes it.

`core.txt` lists the ids of the sample that every library runs on each pull request. It holds every case that pins a text that a checked document quotes ("Quoted texts" below). So a change that makes such prose false fails in every library. On a pull request, the JavaScript and Rust libraries also run the whole corpus, and the others run it nightly. To run every case in JavaScript, run `GENCMU_CORPUS=full node --test test/corpus.test.js` in `lib/js/`.

## CLL source identities

For examples from *The Complete Lojban Language* (CLL), `cll.NUMBER.ANCHOR` uses the CLL 1.1 display number and the XML source anchor. The anchor identifies the source. Suffixes distinguish fixtures for the same source. The `.inherited` suffix retains an older fixture when another case already uses the canonical identifier.

Unnumbered illustrations keep their inherited numeric fixture labels. Their reasons state that those labels are not example numbers in the local CLL 1.1 rendering.

Numeric suffixes in `adhoc.syntax.errata.*`, `adhoc.syntax.errata-controls.*`, `adhoc.syntax.elision-unforced.*`, and `adhoc.syntax.negation-scope.*` name their original candidate positions. A missing position reused an existing corpus record or repeated the text of another erratum. The reused records explain their cases, and `core.txt` includes their identifiers. New identifiers describe their content.

## CLL footnotes: `cll-footnotes.json`

A footnote is a reference whose definition follows the document. `tools/cll-footnotes.js` compares each CLL footnote with the published headings and example anchors in `cll-footnotes.json`. The file pins CLL 1.1 and the later versioned sources that the documents cite.

A source hash identifies the exact downloaded bytes. Page records include this hash, headings, and example numbers. The check reads the index once and uses no network. Both `tools/sync.js` and the JavaScript document tests run it.

Run `python3 tools/cll-footnotes-index.py` from the repository root to refresh the index from the published sources. The generator reads each source page once. To use saved source pages, add `--cache-dir PATH`. Read each citation's clause to make sure that its source supports the statement. Matching numbers alone do not prove that relationship.

## Quoted texts: `quoted-allow.txt`

A grammar document often says what gencmu does with a Lojban text that it quotes. A corpus case pins that text. Then a grammar change that makes the sentence false fails the case. `node tools/quoted-texts.js` checks that each quoted text has a case or an entry in the allow-list `quoted-allow.txt`. `node tools/sync.js --check` runs the same check.

A quoted text is a code span in the prose of a document, outside code blocks, with these properties:

- It has two words or more, separated by white space. A single word is often a name or a part of a rule.
- It holds only lowercase ASCII letters, apostrophes, full stops, commas and white space, and each word has a letter. So a rule name is not a quoted text, since it has a hyphen or a digit. Nor is a selma'o or a token, which is uppercase, or jbogenbau, which has brackets and other symbols.
- It holds no `...` or `…`, which mark a gap in the words.

The check finds the code spans with the CommonMark and GFM parser of `tools/markdown.js`, so a code block holds none. Every prose block is one line, with its code spans ("Documents" in `docs/design.md`). So the line of a text's code span is the paragraph, heading or table row that quotes it.

The check covers every document that the pipelines of the cll-ebnf and bpfk dialects include, at any depth, and the two dialect documents themselves. `CHECKED_DIALECTS` in `tools/quoted-texts.js` names these dialects. The includes come from the DOMs of the source documents, and each path resolves as the pipeline resolves it. A checked document has the dialects that its claims are about: those of the two that include it. The experimental and Zantufa dialects include some of these documents and layer their own over them. So a claim about one of them is checked only where the prose names it. Every other grammar document is left out with a reason. A document that only other dialects include has the reason that names them, read from their pipelines. The dialect documents of those dialects, and any document that no dialect includes, have a reason in `UNCHECKED`. A grammar document with no reason is an error, so a new document is not left out in silence.

The words of a quoted text, joined by single spaces, are compared with the text of each corpus case, written the same way. A quoted text needs a case of each dialect of its document. Its scope can name more dialects, as in "the bpfk dialect rejects it" or "In cll-ebnf and bpfk". The text then needs a case of each of those too. The scope is the list item that holds the text, without the lists nested in it at any depth (inside a block quote too), together with each item that encloses it, again without their nested lists. Outside a list item, the scope is the paragraph, heading or table row. So a blank line inside a list item changes nothing, a name in a nested item does not scope the item above it, and a name in an item scopes the items nested in it. A name counts in any case, when it stands as a word in the prose or in the text of a link. A name in a code span or a link target does not count. The names are those of the dialect documents, less `notation`. In this prose, "experimental" always names the dialect.

Each dialect that a text needs has one reading of it. A case of the whole text gives its verdict and brackets. A case of an entry (below) gives its verdict and role. The two kinds are compared apart. The dialects that the scope does not name must read the text alike, since the sentence then speaks for all of them. So a text that reads differently in two dialects is an error unless its scope names one of them, and a name of a third dialect does not change that. The sentence then says which dialect it is about, and what the other does. This compares only the cases, never the sentence.

A sentence that says how a text reads quotes that exact text. For example, it says "Here `le poi blabi gerku cu klama` parses", not "the text without `ku'o` parses". Then the check sees the text that the claim is about.

The case pins what the sentence says about the text: its verdict, and its brackets or words where the sentence says how the text reads. Before a case is added, the claim is checked by running the text. A false claim is corrected in the prose, not pinned. No tool compares the verdict that a sentence states with the case.

When a case fails, the JavaScript corpus runner names the lines that the case pins, as `quoted at grammars/syntax/cll.md:669`. These are the lines that quote the case's text, and those that quote a fragment that an entry of `quoted-allow.txt` pins with the case. The prose there may now be false.

Every case that pins a quoted text, by its own text or through an entry of `quoted-allow.txt`, is in `core.txt`. So every library runs it on a pull request. The check reports a case that is not there.

Each entry of `quoted-allow.txt` covers one quoted text in one document: every line that quotes it there, or the lines that the entry names. Its line is the text, then ` # `, then the document, with ` @ "PHRASE"` for each line where it names them. An example is `va pu # grammars/syntax/cll.md @ "Space can precede time"`. Then comes one of these:

- ` = ` and cases, each as its id after its role. A role applies to the ids after it, and a role with no id after it is an error. A role is the name of a rule, `words` or `reject`. The check parses each case. With a rule, the tree of some stage has a node of that rule whose words are exactly the quoted text. With `words`, some stage gives the text's words as the labels of tokens in a row, one label for each word. The label of a word is the word without the full stops and commas at its edges, with a space for each full stop inside it. So `la djim.bu` is the labels `la` and `djim bu`. These tokens, with their attachments, also stand together in the case's text: no letter between them is outside them. So `mi ui klama` shows `mi klama`, and `mi do si klama` does not. With `reject`, the dialect rejects the case, and both its `at` and the start of the source of the parsed error fall within the quoted text in the case's text, or within the word after it. Among the cases, there is one of each dialect that the text needs, even a dialect where a case of the whole text has the fragment's words: that case does not show the claim about the fragment. This form is for a part of a text that the sentence makes a claim about: a special grouping, a rejection or a repair. An example is `na'e ka'e` as one `simple-tense-modal`. The author checks that the role is the one that the sentence gives the fragment.
- ` # ` and the reason. This form is for notation, such as `nu'i terms nu'u`, and for a shape that a rule produces as written, such as `mi .e do`. It is also for a part of a reading that the grammar does not choose, where the whole text has its own case. A reason that begins with "deferred:" names the branch that owes the text a pin.

The sentence on each line makes its own claim. So when a document quotes a text unpinned on more than one line, its entry names those lines, and a line can have an entry of its own.

A phrase names a line by its content, not by its number. So an edit above the line never changes the entry. The phrase is a part of the line's Markdown, such as a few words of the sentence that quotes the text. It names the one line of the document that quotes the text and holds the phrase. The check reports a phrase on no such line or on several. It also reports an entry that names no lines and covers several, and a named line that does not need the entry.

Lines that begin with `#` are comments. An entry that the check does not need is an error, so the list does not keep stale entries.
