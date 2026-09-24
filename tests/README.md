# The shared tests

Every gencmu library runs every case here. A case that fails in one library
and passes in another is a bug in the one that disagrees with
`docs/engine.md`, or in the specification itself.

## Engine cases: `engine/*.json`

Each file is one case:

```
{
  "description": "what the case pins down, and which section of docs/engine.md",
  "grammar": "text ≔ A B ;",
  "documents": {"path.md": "Markdown text"},
  "pipeline": "path.md",
  "tokens": [{"text": "a", "tags": ["A"]}, {"text": "b", "tags": ["B", "?C"]}],
  "input": "characters",
  "options": {"features": ["f"], "elisionOnly": true},
  "expect": {"result": PATTERN, "brackets": "(a b)", "error": "grammar"}
}
```

The grammar comes from either `grammar`, rule text for a single stage named
`main` whose document is those rules in one `ebnf` block with
`%ambiguity-resolution greedy ;` prepended unless the text has its own
`%ambiguity-resolution`, or from `documents` and `pipeline`, a pipeline
document among `documents`.

The input is either `input`, a string of characters read as engine §1 says,
or `tokens`, which replaces the first stage's input: each token's tags are
its listed tags, strong unless written with a leading `?`; its text as
given; its phonemes the `phonemes` member if present, else none; its span
`[i, i+1]`; and its source the position of its text in the texts joined
with single spaces.

Auto features (engine §13) are off for a case unless its options say
`"autoFeatures": true`.

`expect.result` is a pattern matched against the canonical result of
`docs/output.md`: an object matches when every member of the pattern matches
the member of the same name, an array when it has the same length and each
element matches, and anything else when it is equal. `expect.brackets` is
the bracket rendering, elided terminators hidden. `expect.error` is the
error kind, when the case is about an error; for a grammar that cannot be
loaded, the result is the error alone.

## Notation cases: `notation/*.json`

```
{"description": "...", "document": "Markdown text", "expect": {"dom": PATTERN} or {"error": {"line": 3, "column": 7}}}
```

The document is read as a grammar document (engine §8, §9), and its DOM
matched against the pattern, or its error's position checked: a syntax
error is reported at the first token that cannot continue the document, and
an error of §9 at the first token of the offending construct.
