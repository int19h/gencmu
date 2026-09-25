# The shared tests

Every gencmu library runs every case here. A case that fails in one library and passes in another is a bug in the one that disagrees with `docs/engine.md`, or in the specification itself.

## Engine cases: `engine/*.json`

Each file is one case:

```
{
  "description": "what the case pins down, and which section of docs/engine.md",
  "grammar": "%rule text A B",
  "documents": {"path.md": "Markdown text"},
  "pipeline": "path.md",
  "tokens": [{"text": "a", "tags": ["A"]}, {"text": "b", "tags": ["B", "?C"]}],
  "input": "characters",
  "options": {"features": ["f"], "withoutFeatures": ["g"], "elisionOnly": true},
  "expect": {"result": PATTERN, "brackets": "(a b)", "warnings": [WARNING...], "features": [FEATURE...], "error": "grammar"}
}
```

The grammar comes from either `grammar`, rule text for a single stage named `main` whose document is those rules in one `jbogenbau` block with `%ambiguity-resolution greedy` on a line of its own before them, unless the text has its own `%ambiguity-resolution`, or from `documents` and `pipeline`, a pipeline document among `documents`.

The input is either `input`, a string of characters read as engine §1 says, or `tokens`, which replaces the first stage's input: each token's tags are its listed tags, strong unless written with a leading `?`; its text as given; its phonemes the `phonemes` member if present, else none; its span `[i, i+1]`; and its source the position of its text in the texts joined with single spaces.

Auto features (engine §13) are off for a case unless its options say `"autoFeatures": true`.

`options.features` and `options.withoutFeatures` are the features the caller turns on and off (engine §13).

`expect.result` is a pattern matched against the canonical result of `docs/output.md`: an object matches when every member of the pattern matches the member of the same name, an array when it has the same length and each element matches, and anything else when it is equal. `expect.brackets` is the bracket rendering, elided terminators hidden. `expect.warnings` is the result's list of warnings, compared whole, so `[]` says that there are none. `expect.features` is the dialect's list of features (`docs/api.md`), compared whole, each as `{"name":..., "kind":..., "default":...}`. `expect.error` is the error kind, when the case is about an error; for a grammar that cannot be loaded, the result is the error alone, and for a mistake of the caller, `usage`, there is no result.

## Notation cases: `notation/*.json`

```
{"description": "...", "document": "Markdown text", "expect": {"dom": PATTERN} or {"error": {"line": 3, "column": 7}}}
```

The document is read as a grammar document (engine §8, §9), and its DOM matched against the pattern, or its error's position checked: a syntax error is reported at the first token that cannot continue the document, and an error of §9 at the first token of the offending construct.

## Corpus cases: `corpus/*.jsonl` and `core.txt`

Lojban texts, one case per line, with what gencmu is meant to make of them:

```
{"id": "cll.5.1.c5e1d1", "text": "do mamta mi", "dialect": "cll", "expect": "accept",
 "verdict": "unique", "words": ["do", "mamta", "mi"], "brackets": "(do [mamta mi])"}
```

- `dialect` is a bundled dialect's name; `features`, when present, the features the case turns on, and `withoutFeatures` those it turns off.
- `expect` is `accept` or `reject`. For an accepted text, `verdict` is the last stage's verdict and `brackets` its tree, elided terminators hidden. For a rejected one, `stage` names the stage that rejected it.
- `ties`, when present, names every stage whose verdict is `tie`, so that a tie in a stage before the last is pinned too.
- `words` is the word stage's output, each token's phonemes, a pause written `.`, or its text for a token with none, whenever the word stage accepted.

A case runs with auto features on, as the API's default is, and matches when every one of those fields that the case or the library's result has is equal.

The corpus was seeded from a fixture collection whose verdicts came from another parser. Where gencmu's expectation differs from that seed, the case says so: `"seeded": "accept"` or `"reject"` is the seed's verdict, and `reason` says why gencmu differs, in terms of its own grammars. `node tools/corpus-departures.js` lists every such case, grouped by reason. A change to a case's `words` or `brackets` needs no field of its own: it is a change to what gencmu produces, made in the same commit as the grammar change that causes it.

`core.txt` lists the ids of the sample every library runs on each pull request; the JavaScript and Rust libraries also run the whole corpus there, and the others run it nightly. In JavaScript, `GENCMU_CORPUS=full node --test test/corpus.test.js`, run in `lib/js/`, runs every case.
