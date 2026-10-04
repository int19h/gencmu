# Output formats

This document describes what a gencmu library returns, as data and as text. The shared tests compare the canonical JSON as parsed JSON values. So two libraries agree when their outputs parse to equal values. The renderings are for people to read.

## Canonical JSON

Canonical JSON is UTF-8 JSON with integers only. A library leaves out an optional member that is absent. It never writes `null` for it, unless this document says otherwise. Every library writes canonical JSON with its own code, because the Rust standard library has no JSON writer.

Libraries write object keys in the order that this document gives. They write no whitespace outside strings, and they write non-ASCII characters as themselves. This makes outputs easy to compare by eye. But conformance is equality of the parsed values.

### A parse result

```
{"format":9,"ok":true,"stages":[STAGE...],"tree":NODE,"error":ERROR,"warnings":[WARNING...]}
```

`format` is the version of the shape of the result, 9. `tree` is the chosen tree of the last stage, or `null`. `error` is `null` when `ok` is true. `warnings` is present only when there is at least one warning (engine §12, §13).

A stage has one of these forms:

```
{"name":"words","verdict":"resolved","output":[TOKEN...]}
{"name":"syntax","verdict":"tie","witness":[ACTION,ACTION]}
```

`verdict` is `unique`, `resolved`, `tie`, or `null` for a stage that rejected. `witness` is present only for `tie`. It is the pair of actions at the first visible difference between the two readings of the tie (engine §6). The action of the first reading comes first.

If there is no visible difference, it is the pair at their first difference. That is the first pair of differing actions of the whole sequences, transparent ones included. A derivation whose visible sequence is a proper prefix of the other's differs from it where the shorter ends.

The readings themselves are in the result's error (below), and the stage holds no tree of them. The canonical order *T* of engine §6 orders the ambiguity diagnostics and selects the forbidden terminator that a maximality rejection reports (engine §4). The canonical tie-break keys never turn a tie into an accepted reading.

`output` is the emitted tokens of a stage whose verdict is `unique` or `resolved`, the last stage included. It is absent for a tie, since a tied stage emits nothing (engine §6, §11). It is absent when the emission of the stage fails (engine §11). It is also absent where the check of `elision-only` meets an error of the grammar or loses its witness (engine §7.7, §7.9).

A token has this form. This one is the token of `mi` that the forms stage of the `cll-ebnf` dialect emits:

```
{"text":"mi","phonemes":"mi","label":"mi","tags":["KOhA","cmavo","continued","onset","run-final","run-initial","word"],"span":[0,2],"source":[0,2]}
```

`tags` lists every tag once, in code point order. A tag is written in its canonical spelling (engine §1), so a character tag is `'a'`, and a combining acute accent is `'\u{301}'`. A character token of the first stage has one tag, its character tag. `phonemes` is always present, the empty string for a token with none (engine §5). An opaque part sounds `?` (engine §11).

`label` is always present too, and it can be empty (engine §5). A label can hold any character, a line break included.

`insertedBy` follows `source` for a token that was inserted from a tag literal (engine §1). Its value is the name of the rule that inserted the token.

`before` and `after` follow `insertedBy` for a token with attachments (engine §11). Each is an array of tokens in this form, and each is present only when it is not empty. An attached token has no `span`, so its object leaves it out. This is the token of `mi ui` that the indicator stage of the `cll-ebnf` dialect emits:

```
{"text":"mi","phonemes":"mi","label":"mi","tags":["KOhA","cmavo","continued","onset","run-final","run-initial","word"],
 "span":[0,1],"source":[0,2],
 "after":[{"text":"ui","phonemes":"ui","label":"ui","tags":["UI","cmavo","continued","indicator","run-final","run-initial","word"],"source":[3,5]}]}
```

A node has one of these forms:

```
{"kind":"rule","rule":"sumti","span":[0,3],"source":[0,9],"tags":[TAG...],"children":[NODE...]}
{"kind":"token","terminal":"KOhA","token":0,"span":[0,1],"source":[0,2]}
{"kind":"elided","terminal":"KU","span":[3,3],"source":[9,9]}
```

A token node's `token` is the index of the stage-input token it read. Its `terminal` is the terminal that read the token. For a range or a property, the terminal is its written form in canonical spelling, such as `'a'..'z'` or `'\p{L}'` (engine §4). A read in a witness and the list of expected terminals use the same form. The output writes an elided node of a tested terminator as any other elided node, without its test.

A warning has this form:

```
{"stage":"words","feature":"y-cmavo","rule":"cmavo-token","span":[2,3],"source":[3,7]}
```

As in a node, `span` counts the input tokens of the stage, and `source` counts the code points of the original text. The example is the warning for `ka'y` in `mi ka'y`, in the cll-ebnf dialect with the feature `y-cmavo` on.

An action in a witness is `{"read":{"token":4,"terminal":"KOhA"}}` or `{"close":{"rule":"sumti","production":57,"span":[2,5]}}`. The witness of an error of `elision-only` can also hold `{"elided":{"at":3,"terminal":"KU"}}`, a read of a terminator written back at that position (engine §7.10). The production is numbered from 0, as in engine §3. For a production of a helper, `rule` is the rule whose alternative introduced the helper.

An error has one of these forms:

```
{"kind":"rejected","stage":"syntax","token":4,"source":[12,15],"line":1,"column":13,
 "expected":[{"terminal":"KU","rules":["sumti"]},...],"message":"..."}
{"kind":"ambiguous","stage":"syntax","reason":"tie","readings":[NODE,NODE],"message":"..."}
{"kind":"ambiguous","stage":"syntax","reason":"elision-only","readings":[NODE,NODE],"witness":[ACTION,ACTION],"message":"..."}
```

`kind` is one of these values:

- `rejected`: The grammar of the stage does not accept its input.
- `ambiguous` (engine §6, §7): The error has `stage`, `reason`, `"readings":[NODE,NODE]` and `message`, and no position. `message` is free, and the shared tests do not compare it. `reason` says which of two cases the error is:
  - `tie`: The ranking of the stage has two or more best derivations (engine §6). The stage's verdict is `tie`, and it has no output. The readings are the first and the second reading of the tie, over the stage's input as the stage read it. They are two derivations, but they can be equal as `NODE` values. The engine counts derivations. It merges neither those that differ only at transparent closes nor those with equal trees (engine §6). The stage's witness then names the actions where they differ.
  - `elision-only`: The stage chose one derivation, but its text stays ambiguous with its elided terminators written back (engine §7). The stage's verdict is `resolved`, and it keeps its output. The readings hold the written-back terminators as elided nodes (engine §7.10). One can be a restored optional's terminator. One can also be a terminator that a reading reads on the written route of an optional, or as a bare terminal. So the two readings can be equal as `NODE` values, as a tie's can. The error also has `"witness":[ACTION,ACTION]` after its readings. It holds the actions at the first difference between the two derivations, visible if there is one, mapped to the stage's input (engine §7.10). Over that input, the two actions can be equal too. The stage itself has no witness.
- `grammar`: A grammar failed to load, or the parser found a defect while parsing. For a grammar that failed to load, the error has `document`, `line` and `column` where known. A tie in a stage of the notation dialect has the `document` and no `line` or `column` (engine §8). For a defect found while parsing, the error has `stage` and no position. An example of such a defect is a nested parse asked about its own span as the same rule. A defect found by the check of `elision-only` can have the member `code` with the value `elision-witness-lost` (engine §7.9). Such an error also has `chosen`, the chosen tree. It has `completion`, the terminators written back. Each of them is `{"terminal":T,"at":N,"source":[S,S]}`, with `"sound":"..."` last for a tested terminator. The members stand in the order `kind`, `stage`, `code`, `message`, `chosen`, `completion`. Any other error has no `code`.

For example, `text → [[X]]` on the empty input ties, and both readings are `{"kind":"rule","rule":"text","span":[0,0],"source":[0,0],"tags":[],"children":[]}`. The stage's witness names two different productions of the helpers. A nullable `&`, such as `[A] & [B]`, gives such a tie in the same way, with three derivations.

A mistake of the caller is not a result. It is an error of kind `usage` (engine §13).

`line` and `column` count from 1, in code points. Lines end at `\n`, `\r\n` or `\r`.

`expected` lists terminals in code point order. The library writes a tested terminal as the terminal followed by its test, as in `LE="la"`, and sorts it by that text. So `LE` comes before `LE="la"`, which comes before `LEhU`. Each terminal comes with the rules whose items can read it at that position, also in code point order. `message` is the description for people, and the shared tests do not compare its wording.

The test uses notation operators and canonical output tags, with spaces only around `∪`. A string stands between double quotes, with a backslash before each `\` and `"` in it. A tag set is `∅`, or its one tag, or its tags joined by ` ∪ ` in parentheses. Its tags are in code point order, each in its canonical spelling (engine §1). A constant is written as its value. So `KOhA⊇(UI ∪ word)`, `KOhA∩'a'=∅` and `LE≠"lo"` are written forms.

### A grammar DOM

A grammar DOM (document object model) is the parsed form of a grammar document (engine §8, §9). A library makes it when it reads the document. `bootstrap.json` and the precompiled DOMs hold the same data.

```
{"format":17,"rules":[RULE...],"directives":[DIRECTIVE...],"constants":[CONSTANT...],"classifiers":[CLASSIFIER...],"implications":[IMPLICATION...]}
```

`format` is the version of the DOM. It changes whenever the shape of the DOM changes. A library never uses a cached DOM of another version.

A rule is `{"name":"sumti","op":"define","tags":TERM,"alternatives":[ALT...],"emit":EMIT,"conditions":[COND...],"opaque":true,"at":[line,column]}`. `op` is `define`, `redefine` or `extend`. `tags`, `emit` and `opaque` are optional. `opaque` is present, and `true`, only for a rule that has `%opaque`. The name of a rule is a name, or `#`.

An alternative is `{"guards":[GUARD...],"expr":EXPR,"tags":TERM}`, with `tags` optional. A guard is `{"feature":"cbm","kind":"gate","negated":false}` for `cbm?`, with `"negated":true` for `¬cbm?`, or `{"feature":"y-cmavo","kind":"warning","negated":false}` for `y-cmavo!`. A guard's feature is a name, and a guard has no member but these three.

An expression is one of these forms:

```
{"seq":[EXPR...]}  {"choice":[EXPR...]}  {"and":[EXPR...]}
{"optional":EXPR}  {"repeat":EXPR,"min":1}
{"ref":"sumti"}    {"terminal":"KOhA"}    {"capture":"x","expr":EXPR}
{"range":["'a'","'z'"]}    {"property":"L"}
{"test":"=","value":TERM,"expr":EXPR}
{"empty":true}
```

An expression has no member but those of its one form. `terminal` holds a tag in its canonical spelling (engine §1): a name from `~name`, a phoneme tag `/p/`, or a character tag such as `'a'`. A bare name is a `ref`, whether it names a rule or, with a capital, a terminal. So a `ref` holds a name (engine §9), or `#`. A `range` holds its start and its end, each a character tag in its canonical spelling, and the start is not above the end. A `property` holds its name, one of those of engine §1.

A tested symbol has no member but `test`, `value` and `expr`. `test` is its comparator: `=`, `≠`, `⊇`, `⊉`, `∩=∅` or `∩≠∅`. Its `expr` is a `ref` other than `#`, a `terminal`, a `range` or a `property`, with no other member. Its `value` is a closed term (engine §10), a string for `=` and `≠` and a tag set for the other four. A string there holds no comma and no code point that the lowercase mapping changes (engine §9). A capture's `expr` is a `ref`, a `terminal`, a `range`, a `property` or a tested symbol.

A term is `{"string":"s"}`, `{"tag":"KOhA"}`, `{"range":["'a'","'z'"]}`, `{"emptySet":true}`, `{"const":"SU-STOPS","at":[line,column]}`, `{"union":[TERM...]}`, `{"intersection":[TERM...]}`, `{"difference":[TERM,TERM]}`, `{"if":COND,"then":TERM}` or `{"call":"phonemes","args":[ARG...]}`. `string` holds the decoded string. `tag` holds one tag in its canonical spelling, from a tag literal, a bare name with a capital, a phoneme tag or a character tag. `range` is as in an expression. `difference` has exactly two parts, and `a ∖ b ∖ c` nests the first difference in the second.

`const` is a reference to a constant, by its name without `$`. Its `at` is the line and column of the reference, where the loader reports an error of the constant (engine §2). A term has no member but those of its one form.

An argument is a span or a term. For `tags`, `matches` and `begins`, an argument can also be a rule name, `{"rule":"brivla-scan"}`. For `classify`, the second argument is a classifier's name, `{"classifier":"lexicon"}`, and the first is a term whose type is a string. A span is `{"capture":"x"}`, `{"capture":""}` for `$`, or `{"call":"head","args":[SPAN]}`. `tail`, `last`, `from` and `after` have the same form as `head`.

A condition is one of these forms:

- `{"op":"=","left":TERM,"right":TERM}`, with `op` one of `=`, `≠`, `∈`, `∉`, `⊆`, `⊈`, and with `left` and `right` of types that agree as engine §10 says
- `{"matches":SPAN,"rule":"r"}`
- `{"begins":SPAN,"rule":"r"}`
- `{"initial":SPAN}`
- `{"not":COND}`
- `{"any":[COND...]}`
- `{"all":[COND...]}`
- `{"captured":"x"}`, with `""` for `$`
- `{"if":COND,"then":COND}`

A condition has no member but those of its one form.

An emission is `{"items":[ITEM...]}`, with no other member. An item is `{"capture":"x","tags":TERM,"before":["b"],"after":["a"]}`, or `{"insert":"/h/"}`, whose value is one tag in its canonical spelling. For `ε`, there are no items. `"capture":""` is `$`.

An item's `tags` is optional. `before` and `after` list the item's attachment captures (engine §11), each by its name without `$`, in the order written. Each is present only when it is not empty, and only for a named capture.

A constant definition is `{"name":"SU-STOPS","op":"define","value":TERM,"at":[line,column]}`. `op` is `define` for `%const` and `redefine` for `%redefine-const`. The name has no `$`. The value is a closed term (engine §10), which can hold `const` terms but never a value that the loader gives them.

A classifier is `{"name":"lexicon","entries":[ENTRY...],"at":[line,column]}`. Its name begins with `a` to `z`. `entries` can be empty, for a `%classifier` with no entry.

An entry is `{"guards":[GUARD...],"keys":["mi","do"],"op":"∈","class":"KOhA","at":[line,column]}`. Its guards are gates, never warnings. `keys` holds one or more decoded strings, each a canonical sound (engine §9). `op` is `∈` or `∉`. `class` is a name that begins with `A` to `Z`. An entry's `at` is the line and column of its first token, where the loader reports an error of the entry (engine §2).

An implication is `{"if":TERM,"then":TERM,"at":[line,column]}`, for `%implies A ⟹ B`. `if` is `A`, and `then` is `B`. Each is a closed term (engine §10) whose type is a tag set.

A classifier and an implication have no member but those shown.

A directive is `{"name":"elidable","args":["KU","KEI"],"at":[line,column]}`. An operand `~KU` of `%elidable` is the name `KU`. The name is the keyword without `%`: `ambiguity-resolution`, `elidable`, `stage`, `include` or `features`. An argument is a name, or, for `include`, the decoded string: `{"name":"include","args":["../words/stream.md"],"at":[4,3]}`.

An `%elidable maximal` directive has the member `"maximal":true` after `args`: `{"name":"elidable","args":["TOI","SEhU"],"maximal":true,"at":[line,column]}`. The modifier `maximal` contributes no argument, but an operand `~maximal` written after it does: `%elidable maximal ~maximal` has `"args":["maximal"]`. A `%elidable maximal` with no operands has `"args":[]`. Any other directive has no `maximal` member, and the value of the member is always `true` (engine §9). A library ignores any other member of a directive. The members that it knows, `name`, `args`, `maximal` and `at`, keep their rules, so an unknown member does not make a malformed `maximal` member valid.

`rules`, `directives`, `constants`, `classifiers` and `implications` each keep the order in which the document has them. `at` is the line and column of an item's first token. So the order of all of a document's items is the order of their positions. No two items of a DOM share a position (engine §9).

### Precompiled DOMs

`grammars/compiled.json` holds the precompiled DOMs. `tools/sync.js` generates it and copies it into every package. Its shape is `{"format":17,"bootstrap":HASH,"documents":{PATH:{"hash":HASH,"dom":DOM}}}`. `PATH` is relative to the grammars directory. Each `HASH` is the FNV-1a hash of engine §8. A library uses an entry only when the format, the hash of the bootstrap and the hash of the document all match.

A precompiled DOM holds the document's constants, classifiers and implications as the document writes them. The loader gives the constants their values when it stitches a stage, and a stage resolves a classifier for the features of a parse. So one precompiled DOM serves every stage, dialect and set of features that uses the document (engine §2, §8).

## Renderings

The renderings are for people. The CLI and the playground implement all three renderings. Every library implements brackets, and the corpus tests compare brackets. Every rendering shows a token by its label.

A token node reads an input token of the last stage, and that token can have attachments (engine §11). Every rendering shows them with the token node. The readings of an `ambiguous` error read the same tokens as each other, so they show the same attachments.

A hollow rule node, such as an empty slot for a free modifier, has no token and no elided node below it. No rendering shows a hollow rule node. Brackets drop it as an empty node, and the tree and the display JSON leave it out. But the tree and the display JSON always show the root. So the tree renders a hollow tree, such as that of the empty text, as the rule name of the root alone. The display JSON renders it as `{"text": []}`, and brackets render it as nothing.

### Brackets

Brackets write the tree of the final stage as nested groups:

1. The label of a token node is the label of its token (engine §5). So a pause shows as a space, and an opaque part shows its text. A label can itself be empty, as for a `zoi` quote of nothing, and the renderer keeps it. The label of an elided node is empty, unless elided terminators are shown. In that case, the label is the terminal in lower case between `⟨` and `⟩`.
2. A token node whose token has attachments renders as a group. Its members are the token's before-attachments, the token's label, and its after-attachments, in that order. Each attachment renders in the same way: as its label, or as a group if it has attachments of its own.
3. The renderer renders the children of a rule node and drops the empty ones. An empty child is an elided node that is not shown, or a rule node that renders nothing. A token node is never empty. If no child is left, the node is empty. If one child is left, the node is that child. Otherwise, the node is a group.
4. The depth *d* of a group counts groups only: a child group of a group at depth *d* is at *d*+1. A group is written between `(` `)` when *d* mod 3 is 0, `[` `]` when 1, and `{` `}` when 2. One space separates its members.

So `lo mlatu cu citka le finpe` is `([lo mlatu] cu [citka {le finpe}])`. In the `cll-ebnf` dialect, `mi ui klama` is `([mi ui] klama)`, `ba'e mi klama` is `([ba'e mi] klama)`, and `mi ui nai klama` is `([mi {ui nai}] klama)`.

### Tree

The tree has one node per line, and children are indented two spaces under their parent. Each kind of node is written as follows:

- A rule node is its name. If the node has only token descendants on one line of source, ` · ` and its text follow the name. They do not if any of those tokens has attachments. They also do not if the label of any of those tokens, or of their attachments, holds a line break.
- A token node is its terminal, then its label from above in quotes. The quoted label is escaped as a JSON string, so a line break in it is written `\n`.
- The attachments of a token node follow it, each on a line of its own, indented two spaces more than the node. The before-attachments come first, each after `◂ `, and then the after-attachments, each after `▸ `. These marks differ from the ` › ` that joins a chain of rule nodes.

  An attachment is its classes, then its label in quotes. Its classes are its tags that begin with `A` to `Z`, in code point order, joined by ` ∪ `. An attachment with no class is its label alone. Its own attachments follow it in the same way, indented two spaces more.
- An elided node is its terminal in angle brackets.

Chains of rule nodes with one child are written on one line, joined by ` › `. So in the `cll-ebnf` dialect, the token node of `mi` in `mi ui nai klama` has these lines, at the indentation of the node:

```
KOhA "mi"
  ▸ UI "ui"
    ▸ NAI "nai"
```

### Display JSON

The display JSON is the tree projected for reading, and it is not the canonical form. A rule node is an object with one member, its rule name. If the node has one child, the value of this member is the projection of that child. Otherwise, the value is the array of the projections of its children. A token node is `{"TERMINAL":"label"}`, and an elided node is `{"TERMINAL":null}`.

A token node whose token has attachments is `{"terminal":"T","label":"L","before":[...],"after":[...]}` instead. An attachment in those arrays is `{"classes":["C",...],"label":"L","before":[...],"after":[...]}`, with its classes in code point order. Each of these objects leaves out an empty array. The terminal is a value there and not a key, so no terminal can collide with a member of the object.

The display JSON is pretty-printed so that nesting costs no indentation where nothing is gained:

- A scalar is written as JSON.
- An empty array is `[]`. A non-empty array is `[`, a newline, each item, a newline, and `]` at the indentation of the array. Each item is indented two more spaces than the array, and each item except the last is followed by `,`.
- An object with one member is `{"name": ` followed by the value, then `}`. The value is written at the same indentation as the object. So `{"a": {"b": {"c": "x"}}}` stays on one line, and a long chain adds no indentation.
- An object with several members is written like an array, as `"key": value` lines between `{` and `}`.
