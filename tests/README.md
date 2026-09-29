# The shared tests

Every gencmu library runs every case here. If a case fails in one library and passes in another, there is a bug. The bug is in the library that disagrees with `docs/engine.md`, or in the specification itself.

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
  "options": {"features": ["f"], "withoutFeatures": ["g"], "elisionOnly": true},
  "expect": {"result": PATTERN, "brackets": "(a b)", "warnings": [WARNING...], "features": [FEATURE...], "error": "grammar",
             "where": {"document": "main.md", "line": 4, "column": 12}}
}
```

The grammar comes from `grammar`, or from `documents` and `pipeline`. `grammar` is rule text for a single stage named `main`. The document of this stage is those rules in one `jbogenbau` block. On a line of its own before the rules, the block has `%ambiguity-resolution greedy`, unless the text has its own `%ambiguity-resolution`. `pipeline` names a pipeline document among `documents`.

The input is `input` or `tokens`. `input` is a string of characters, read as engine §1 says. `tokens` replaces the input of the first stage. Each token gets these values:

- Its tags are its listed tags, each written as the output writes a tag (`docs/output.md`). So a character tag is `'a'`.
- Its text is as given.
- Its phonemes are the `phonemes` member if present, or else none.
- Its span is `[i, i+1]`.
- Its source is the position of its text in the texts joined with single spaces.

Auto features (engine §13) are off for a case unless its options say `"autoFeatures": true`.

`options.features` and `options.withoutFeatures` are the features the caller turns on and off (engine §13).

`expect.result` is a pattern matched against the canonical result of `docs/output.md`. A pattern matches in these ways:

- An object matches when every member of the pattern matches the member of the same name.
- An array matches when it has the same length and each element matches.
- Anything else matches when it is equal.

`expect.brackets` is the bracket rendering, with elided terminators hidden. `expect.warnings` is the list of warnings of the result, compared whole. So `[]` says that there are no warnings. `expect.features` is the list of features of the dialect (`docs/api.md`), compared whole. Each feature is written as `{"name":..., "kind":..., "default":...}`.

`expect.error` is the error kind, when the case is about an error. For a grammar that cannot be loaded, the result is the error alone. For a mistake of the caller, `usage`, there is no result.

`expect.where`, when present, is where the error of a grammar that cannot be loaded stands. It names a document of the case and a line and a column in it. For a case with `grammar`, the document is `main.md`. Its fence is line 1, so the rules start on line 3, or on line 2 when they hold their own `%ambiguity-resolution`.

## Notation cases: `notation/*.json`

```
{"description": "...", "document": "Markdown text", "expect": {"dom": PATTERN} or {"error": {"line": 3, "column": 7}}}
```

Each library reads the document as a grammar document (engine §8, §9). The reading makes a DOM (document object model), as `docs/output.md` describes. The library matches the DOM against the pattern, or it compares the position of the error with the expected position. The reader reports a syntax error at the first token that cannot continue the document. It reports an error of §9 at the first token of the offending construct.

## Corpus cases: `corpus/*.jsonl` and `core.txt`

Each line is one case: a Lojban text, with the result that gencmu must give for it:

```
{"id": "cll.5.1.c5e1d1", "text": "do mamta mi", "dialect": "cll-ebnf", "expect": "accept",
 "verdict": "unique", "words": ["do", "mamta", "mi"], "brackets": "(do [mamta mi])"}
```

- `dialect` is the name of a bundled dialect. `features`, when present, lists the features that the case turns on. `withoutFeatures` lists those that it turns off.
- `expect` is `accept` or `reject`. For an accepted text, `verdict` is the verdict of the last stage, and `brackets` is its tree, with elided terminators hidden. For a rejected one, `stage` names the stage that rejected it.
- `ties`, when present, names every stage whose verdict is `tie`, so that a tie in a stage before the last is pinned too.
- `words` is the output of the word stage, whenever the word stage accepted. Each token is written as its phonemes, with a pause written `.`. A token with no phonemes is written as its text.

A case runs with auto features on, which is the default of the API. The case matches when every one of those fields that the case or the result of the library has is equal.

The corpus started from a seed: a fixture collection whose verdicts came from another parser. Where the expectation of gencmu differs from that seed, the case says so. `"seeded": "accept"` or `"reject"` is the verdict of the seed, and `reason` says why gencmu differs, in terms of its own grammars. `node tools/corpus-departures.js` lists every such case, grouped by reason. A change to the `words` or `brackets` of a case needs no field of its own. It is a change to what gencmu produces, made in the same commit as the grammar change that causes it.

`core.txt` lists the ids of the sample that every library runs on each pull request. On a pull request, the JavaScript and Rust libraries also run the whole corpus, and the others run it nightly. To run every case in JavaScript, run `GENCMU_CORPUS=full node --test test/corpus.test.js` in `lib/js/`.
