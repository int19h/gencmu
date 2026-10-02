# The shared tests

Every gencmu library runs every shared case that its API can express. The Rust library skips two engine cases, as "Engine cases" says. If a case fails in one library and passes in another, there is a bug. The bug is in the library that disagrees with `docs/engine.md`, or in the specification itself.

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

Every runner also checks these invariants on each canonical result that a case gives, whatever the case expects. A case cannot turn them off, and its pattern need not repeat them:

- No stage has a member `tied`.
- A stage whose verdict is `tie` has no member `output`, and it is the last stage of the result.
- Such a result has `ok` false, `tree` null, and an error of kind `ambiguous` with the reason `tie`, that stage's name and two readings.

A pattern matches a result that has members beyond its own. So the invariants, and not the patterns, say that a tied stage has no output.

`expect.brackets` is the bracket rendering, with elided terminators hidden. `expect.warnings` is the list of warnings of the result, compared whole. So `[]` says that there are no warnings. `expect.features` is the list of features of the dialect (`docs/api.md`), compared whole. Each feature is written as `{"name":..., "kind":..., "default":...}`.

A case can also parse its input several times with the one loaded dialect. Then it has `parses`, a list of objects, each with its own `options` and `expect`, in place of the case's `options` and `expect`:

```
"parses": [{"options": {}, "expect": {"brackets": "a"}}, {"options": {"features": ["f"]}, "expect": {"error": "grammar"}}]
```

The library loads the dialect once, and then parses the input with each item's options in order. Each result matches its item's `expect`, as below. So a case can show that one loaded dialect gives each set of features its own result, whatever it parsed before.

`expect.error` is the error kind, when the case is about an error. For a grammar that cannot be loaded, the result is the error alone. For a mistake of the caller, `usage`, there is no result.

A load that fails gives only its error. Its kind is `grammar` for a grammar that cannot be loaded. It is `usage` for a mistake of the caller at load, such as a document held in memory that is not a sequence of Unicode scalar values (engine §1). A case expects such an error with `expect.error` of that kind. For a `grammar` error, it can also give `expect.where`. It gives no `result`, `brackets`, `warnings` or `features`, because only a loaded dialect gives them. A runner fails a case when the load fails with another kind, or when the case expects one of these members. It also fails a case that gives `expect.where` with a kind other than `grammar`.

`expect.where`, when present, is where the error of a grammar that cannot be loaded stands. It is only for an error of kind `grammar`. It names a document of the case and a line and a column in it. For a case with `grammar`, the document is `main.md`. Its fence is line 1, so the rules start on line 3, or on line 2 when they hold their own `%ambiguity-resolution`.

## Notation cases: `notation/*.json`

```
{"description": "...", "document": "Markdown text", "expect": {"dom": PATTERN} or {"error": {"line": 3, "column": 7}}}
```

Each library reads the document as a grammar document (engine §8, §9). The reading makes a DOM (document object model), as `docs/output.md` describes. The library matches the DOM against the pattern, or it compares the position of the error with the expected position. The reader reports a syntax error at the first token that cannot continue the document. It reports an error of §9 at the first token of the offending construct.

## Notation shapes: `notation-shapes.json`

```
{"description": "...", "document": "Markdown text", "inputs": ["b", "qs"], "control": [OUTCOME...], "loads": {"guard": [OUTCOME...]}}
```

A caller can supply its own `notation/bootstrap.json` (`docs/api.md`). Its notation can give the reader a tree of another shape, and engine §9 says how the reader reads it. Each library loads `document` as the one document of a stage `main`, with a bootstrap made from the bundled one. It then parses each of `inputs`, with the options of the API's default. The outcome of an input is its bracket rendering if it parses, or else the kind of its error. A load that fails gives only the kind of its error.

- With the bundled bootstrap, the outcomes are `control`.
- Then each rule of the bundled bootstrap's syntax document, except `text`, gets a wrapper: a new rule whose one alternative is a reference to it. Every reference to the rule in that document becomes a reference to its wrapper. The outcomes are `control` again.
- Then each rule of that document, except `text`, gets a new name in turn: its name with `x` after it, in its definition and in every reference to it. A rule named in `loads` gives a dialect, and the outcomes are those of `loads`. Any other rule gives the load error `grammar`. No other error escapes the library.

Each item of `extraParts` gives a rule a part that the reader does not read. In the bundled bootstrap's syntax document, the text `find` stands once, and the bootstrap of the item has `replace` in its place. Each library loads the item's `document` with that bootstrap and parses its `inputs`, as above. The outcomes are those of `expect`. The extra part holds text that the reader refuses if it reads it, so an outcome other than `expect` shows that the library read it.

## Malformed directives: `dom-malformed.json`

```
[{"description": "...", "directive": DIRECTIVE, "malformed": true}, ...]
```

Each item is one directive of a DOM (`docs/output.md`). A library puts it alone in an otherwise empty DOM of the current format, and checks the DOM as it checks a precompiled one (engine §9). The DOM is malformed exactly when `malformed` is true. A library that refuses a malformed precompiled DOM reads the document instead, so the check is not visible through a parse. That is why these cases test the check directly.

## Corpus cases: `corpus/*.jsonl` and `core.txt`

Each line is one case: a Lojban text, with the result that gencmu must give for it:

```
{"id": "cll.5.1.c5e1d1", "text": "do mamta mi", "dialect": "cll-ebnf", "expect": "accept",
 "verdict": "unique", "words": ["do", "mamta", "mi"], "brackets": "(do [mamta mi])"}
```

- `dialect` is the name of a bundled dialect. `features`, when present, lists the features that the case turns on. `withoutFeatures` lists those that it turns off.
- `expect` is `accept` or `reject`. For an accepted text, `verdict` is the verdict of the last stage, and `brackets` is its tree, with elided terminators hidden. For a rejected one, `stage` names the stage that rejected it.
- `error` is present exactly when the result's error is of kind `ambiguous`. It is `{"kind": "ambiguous", "reason": "tie"}`, or the same with the reason `elision-only` (engine §6, §7). A case with any other result has no `error`, a rejection or an error of the grammar included. A case expects an ambiguity with `expect` set to `reject`, its `stage`, and this `error`. A third value of `expect` is not needed.
- The `reason` inside `error` is the reason of the ambiguous error. It is a field of `error`, and it is not the case's own `reason`, which explains a departure from the seed (below). A case can have both.
- `ties`, when present, names the stage whose verdict is `tie`. A tie ends the run, so at most one stage has it, and that stage can come before the last.
- `words` records the word stage's output when that output is present. The case writes each token as its label (engine §5). So a pause inside a word is a space, and an opaque part is its text.

A runner also checks the invariants of a tie (above) on the result of each corpus case. No corpus text ties in its dialect, so each library also tests that its runner refuses a broken tie with the engine case `attach-tie.json`. A case runs with auto features on, which is the default of the API. The case matches when every one of those fields that the case or the result of the library has is equal.

The corpus started from a seed: a fixture collection whose verdicts came from another parser. Where the expectation of gencmu differs from that seed, the case says so. `"seeded": "accept"` or `"reject"` is the verdict of the seed, and `reason` says why gencmu differs, in terms of its own grammars. `node tools/corpus-departures.js` lists every such case, grouped by reason. A change to the `words` or `brackets` of a case needs no field of its own. It is a change to what gencmu produces, made in the same commit as the grammar change that causes it.

`core.txt` lists the ids of the sample that every library runs on each pull request. On a pull request, the JavaScript and Rust libraries also run the whole corpus, and the others run it nightly. To run every case in JavaScript, run `GENCMU_CORPUS=full node --test test/corpus.test.js` in `lib/js/`.
