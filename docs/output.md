# Output formats

This document describes what a gencmu library returns, as data and as text. The shared tests compare the canonical JSON as parsed JSON values. So two libraries agree when their outputs parse to equal values. The renderings are for people to read.

## Canonical JSON

Canonical JSON is UTF-8 JSON with integers only. A library leaves out an optional member that is absent. It never writes `null` for it, unless this document says otherwise. Every library writes canonical JSON with its own code, because the Rust standard library has no JSON writer.

Libraries write object keys in the order that this document gives. They write no whitespace outside strings, and they write non-ASCII characters as themselves. This makes outputs easy to compare by eye. But conformance is equality of the parsed values.

### A parse result

```
{"format":3,"ok":true,"stages":[STAGE...],"tree":NODE,"error":ERROR,"warnings":[WARNING...]}
```

`format` is the version of the shape of the result, 3. `tree` is the chosen tree of the last stage, or `null`. `error` is `null` when `ok` is true. `warnings` is present only when there is at least one warning (engine §12, §13).

A stage has this form:

```
{"name":"words","verdict":"tie","witness":[ACTION,ACTION],"tied":NODE,"output":[TOKEN...]}
```

`verdict` is `unique`, `resolved`, `tie`, or `null` for a stage that rejected. `witness` and `tied` are present only for `tie`. `witness` is the pair of actions at the first visible difference between the chosen derivation and the tied one. If there is no visible difference, it is the pair at their first difference. That is the first pair of differing actions of the whole sequences, transparent ones included. A derivation whose visible sequence is a proper prefix of the other's differs from it where the shorter ends (engine §6).

`tied` is the tree of the tied derivation that is reported beside the chosen one. This is the tied derivation that diverges earliest from the chosen one (engine §6).

`output` is the emitted tokens of an accepted stage, the last stage included. It is absent when the emission of the stage fails (engine §11). It is also absent when the reparse of `elision-only` meets an error of the grammar (engine §7).

A token has this form:

```
{"text":"mi","phonemes":"mi","tags":{"KOhA":true,"UI":false,"word":true},"span":[0,2],"source":[0,2]}
```

`tags` lists every tag in code point order, strong as `true`, weak as `false`. `phonemes` is always present, the empty string for a token with none (engine §5). `"verbatim":true` follows `source` for a verbatim token, and is absent for any other (engine §11). The phonemes of a verbatim token are its text, which can hold any character. `insertedBy` follows `source` for a token that was inserted from a quoted tag or a phoneme tag (engine §1). Its value is the name of the rule that inserted the token.

A node has one of these forms:

```
{"kind":"rule","rule":"sumti","span":[0,3],"source":[0,9],"tags":{...},"children":[NODE...]}
{"kind":"token","terminal":"KOhA","token":0,"span":[0,1],"source":[0,2]}
{"kind":"elided","terminal":"KU","span":[3,3],"source":[9,9]}
```

A token node's `token` is the index of the stage-input token it read. An elided node of a spelled terminator is written the same way. The output does not show its spelling.

A warning has this form:

```
{"stage":"words","feature":"y-cmavo","rule":"cmavo-token","span":[2,3],"source":[3,7]}
```

As in a node, `span` counts the input tokens of the stage, and `source` counts the code points of the original text. The example is the warning for `ka'y` in `mi ka'y` in the cll-ebnf dialect.

An action in a witness is `{"read":{"token":4,"terminal":"KOhA"}}` or `{"close":{"rule":"sumti","production":57,"span":[2,5]}}`. The production is numbered from 0, as in engine §3. For a production of a helper, `rule` is the rule whose alternative introduced the helper.

An error has this form:

```
{"kind":"rejected","stage":"syntax","token":4,"source":[12,15],"line":1,"column":13,
 "expected":[{"terminal":"KU","rules":["sumti"]},...],"message":"..."}
```

`kind` is one of these values:

- `rejected`: the grammar of the stage does not accept its input.
- `ambiguous` (engine §7): the error has `stage`, `"readings":[NODE,NODE]` and `message`, and no position.
- `grammar`: a grammar failed to load, or the parser found a defect while parsing. For a grammar that failed to load, the error has `document`, `line` and `column` where known. For a defect found while parsing, such as a condition that asked about its own span, the error has `stage` and no position.

A mistake of the caller is not a result. It is an error of kind `usage` (engine §13).

`line` and `column` count from 1, in code points. Lines end at `\n`, `\r\n` or `\r`.

`expected` lists terminals in code point order. The library writes a spelled terminal as the terminal followed by its spelling in backticks, as in ``LE`la` ``, and sorts it by that text. So `LE` comes before ``LE`la` ``, which comes before `LEhU`. Each terminal comes with the rules whose items can read it at that position, also in code point order. `message` is the description for people, and the shared tests do not compare its wording.

### A grammar DOM

A grammar DOM (document object model) is the data that a library makes when it reads a grammar document (engine §8, §9). `bootstrap.json` and the precompiled DOMs hold the same data.

```
{"format":8,"rules":[RULE...],"directives":[DIRECTIVE...]}
```

`format` is the version of the DOM. It changes whenever the shape of the DOM changes. A library never uses a cached DOM of another version.

A rule is `{"name":"sumti","op":"define","tags":TERM,"alternatives":[ALT...],"emit":EMIT,"conditions":[COND...],"verbatim":true,"at":[line,column]}`. `op` is `define`, `redefine` or `extend`. `tags`, `emit` and `verbatim` are optional. `verbatim` is present, and `true`, only for a rule that has `%verbatim`. The name of a rule is a name, or `#`.

An alternative is `{"guards":[GUARD...],"expr":EXPR,"tags":TERM}`, with `tags` optional. A guard is `{"feature":"cbm","kind":"gate","negated":false}` for `@cbm?`, with `"negated":true` for `@¬cbm?`, or `{"feature":"y-cmavo","kind":"warning","negated":false}` for `@y-cmavo!`.

An expression is one of these forms:

```
{"seq":[EXPR...]}  {"choice":[EXPR...]}  {"and":[EXPR...]}
{"optional":EXPR}  {"repeat":EXPR,"min":1}
{"ref":"sumti"}    {"terminal":"KOhA"}    {"capture":"x","expr":EXPR}
{"spelling":"la","expr":EXPR}
{"empty":true}
```

`terminal` holds a name, a decoded string, or a phoneme tag `/p/`. A spelled symbol has no member but `spelling` and `expr`. Its `expr` is a `ref` other than `#`, or a `terminal`, with no other member. Its `spelling` is the text between the backticks, so it holds no backtick. The spelling is never empty, and `lowercase` does not change it (engine §9). A capture's `expr` is a `ref`, a `terminal` or a spelled symbol.

A term is `{"literal":"s"}`, `{"weak":"s"}`, `{"emptySet":true}`, `{"union":[TERM...]}`, `{"intersection":[TERM...]}`, `{"if":COND,"then":TERM}` or `{"call":"phonemes","args":[ARG...]}`. An argument is a span or a term. For `tags`, `matches` and `begins`, an argument can also be a rule name, `{"rule":"lexicon"}`. A span is `{"capture":"x"}`, `{"capture":""}` for `$`, or `{"call":"head","args":[SPAN]}`. `tail`, `last`, `from` and `after` have the same form as `head`.

A condition is one of these forms:

- `{"op":"=","left":TERM,"right":TERM}`, with `op` one of `=`, `≠`, `∈`, `∉`, `⊆`. For `∈` and `∉`, `left` is a string: a `literal`, or a `call` of `phonemes`, `text` or `lowercase` (engine §9)
- `{"matches":SPAN,"rule":"r"}`
- `{"begins":SPAN,"rule":"r"}`
- `{"initial":SPAN}`
- `{"not":COND}`
- `{"any":[COND...]}`
- `{"all":[COND...]}`
- `{"captured":"x"}`, with `""` for `$`
- `{"if":COND,"then":COND}`

An emission is `{"items":[ITEM...]}`. An item is `{"capture":"x","tags":TERM}`, with `tags` optional, or `{"insert":"h"}`. For `ε`, there are no items. `"capture":""` is `$`.

A directive is `{"name":"elidable","args":["KU","KEI"],"at":[line,column]}`. The name is the keyword without `%`: `ambiguity-resolution`, `elidable`, `stage`, `include` or `features`. An argument is a name, or, for `include`, the decoded string: `{"name":"include","args":["../words/stream.md"],"at":[4,3]}`.

`rules` and `directives` each keep the order in which the document has them. `at` is the line and column of an item's first token. So the order of all of a document's items is the order of their positions. No two items of a DOM share a position (engine §9).

### Precompiled DOMs

`grammars/compiled.json` holds the precompiled DOMs. `tools/sync.js` generates it and copies it into every package. Its shape is `{"format":8,"bootstrap":HASH,"documents":{PATH:{"hash":HASH,"dom":DOM}}}`. `PATH` is relative to the grammars directory. Each `HASH` is the FNV-1a hash of engine §8. A library uses an entry only when the format, the hash of the bootstrap and the hash of the document all match.

## Renderings

The renderings are for people. The CLI and the playground implement all three renderings. Every library implements brackets, and the corpus tests compare brackets.

A hollow rule node, such as an empty slot for a free modifier, has no token and no elided node below it. No rendering shows a hollow rule node. Brackets drop it as an empty node, and the tree and the display JSON leave it out. But the root is always shown. So a text whose tree is hollow, such as the empty text, renders in the tree as the rule name of the root alone. In the display JSON, it renders as `{"text":[]}`.

### Brackets

Brackets write the tree of the final stage as nested groups:

1. If the token of a token node is verbatim, the label of the node is the text of the token. Otherwise, the label is the phonemes of the token, with each pause, `.`, written as a space. If the phonemes are empty, the label is the text. A label can itself be empty, as for a `zoi` quote of nothing, and the renderer keeps it. The label of an elided node is empty, unless elided terminators are shown. In that case, the label is the terminal in lower case between `⟨` and `⟩`.
2. The renderer renders the children of a rule node and drops the empty ones. An empty child is an elided node that is not shown, or a rule node that renders nothing. A token node is never empty. If no child is left, the node is empty. If one child is left, the node is that child. Otherwise, the node is a group.
3. The depth *d* of a group counts groups only: a child group of a group at depth *d* is at *d*+1. A group is written between `(` `)` when *d* mod 3 is 0, `[` `]` when 1, and `{` `}` when 2. One space separates its members.

So `lo mlatu cu citka le finpe` is `([lo mlatu] cu [citka {le finpe}])`.

### Tree

The tree has one node per line, and children are indented two spaces under their parent. Each kind of node is written as follows:

- A rule node is its name. If the node has only token descendants on one line of source, ` · ` and its text follow the name.
- A token node is its terminal, then its label from above in quotes.
- An elided node is its terminal in angle brackets.

Chains of rule nodes with one child are written on one line, joined by ` › `.

### Display JSON

The display JSON is the tree projected for reading, and it is not the canonical form. A rule node is an object with one member, its rule name. If the node has one child, the value of this member is the projection of that child. Otherwise, the value is the array of the projections of its children. A token node is `{"TERMINAL":"label"}`, and an elided node is `{"TERMINAL":null}`. The display JSON is pretty-printed so that nesting costs no indentation where nothing is gained:

- A scalar is written as JSON.
- An empty array is `[]`. A non-empty array is `[`, a newline, each item, a newline, and `]` at the indentation of the array. Each item is indented two more spaces than the array, and each item except the last is followed by `,`.
- An object with one member is `{"name": ` followed by the value, then `}`. The value is written at the same indentation as the object. So `{"a": {"b": {"c": "x"}}}` stays on one line, and a long chain adds no indentation.
- An object with several members is written like an array, as `"key": value` lines between `{` and `}`.
