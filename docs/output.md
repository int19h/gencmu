# Output formats

What a gencmu library hands back, as data and as text. The canonical JSON is
what the shared tests compare, as parsed JSON values, so two libraries agree
when their outputs parse to equal values; the renderings are what people
read.

## Canonical JSON

Canonical JSON is UTF-8 JSON with integers only. Optional members that are
absent are omitted, never `null`, unless this document says otherwise.
Libraries write object keys in the order given here, with no whitespace
outside strings and non-ASCII characters as themselves, so that outputs are
easy to compare by eye; conformance is equality of the parsed values. Every
library writes it with its own code, since the Rust standard library has no
JSON writer.

### A parse result

```
{"format":1,"ok":true,"stages":[STAGE...],"tree":NODE,"error":ERROR}
```

`format` is the version of the result's shape, 1. `tree` is the last stage's chosen tree
or `null`; `error` is `null` when `ok` is true.

**Stage**:

```
{"name":"words","verdict":"tie","witness":[ACTION,ACTION],"tied":NODE,"output":[TOKEN...]}
```

`verdict` is `unique`, `resolved`, `tie`, or `null` for a stage that
rejected; `witness` and `tied` are present only for `tie`: the witness, and
the tree of the tied derivation reported beside the chosen one, the one
diverging from it earliest (engine §6); `output` is the emitted tokens, present for every
accepted stage, the last included.

**Token**:

```
{"text":"mi","phonemes":"mi","tags":{"KOhA":true,"UI":false,"word":true},"span":[0,2],"source":[0,2]}
```

`tags` lists every tag in code point order, strong as `true`, weak as
`false`. `phonemes` is always present, the empty string for a token with
none (engine §5). `insertedBy`, the rule name, follows `source` for a token
inserted from a quoted tag or a phoneme tag (engine §1).

**Node**:

```
{"kind":"rule","rule":"sumti","span":[0,3],"source":[0,9],"tags":{...},"children":[NODE...]}
{"kind":"token","terminal":"KOhA","token":0,"span":[0,1],"source":[0,2]}
{"kind":"elided","terminal":"KU","span":[3,3],"source":[9,9]}
```

A token node's `token` is the index of the stage-input token it read.

**Action**, in a witness: `{"read":{"token":4,"terminal":"KOhA"}}` or
`{"close":{"rule":"sumti","production":57,"span":[2,5]}}`, the production
numbered from 0 as in engine §3; for a helper's production, `rule` is the
rule whose alternative introduced the helper.

**Error**:

```
{"kind":"rejected","stage":"syntax","token":4,"source":[12,15],"line":1,"column":13,
 "expected":[{"terminal":"KU","rules":["sumti"]},...],"message":"..."}
```

`kind` is `rejected` (the stage's grammar does not accept its input),
`ambiguous` (engine §7; the error has `stage`, `"readings":[NODE,NODE]` and
`message`, and no position), or `grammar` (a grammar could not be loaded,
with `document`, `line` and `column` where known, or a defect found while
parsing, such as a condition that asked about its own span, with `stage`
and no position). A caller's mistake is not a result but an error of kind
`usage` (engine §13). `line` and `column` count
from 1, in code points, lines ending at `\n`, `\r\n` or `\r`. `expected`
lists terminals in code point order, each with the rules whose items could
have read it, in code point order. `message` is the human description; its
wording is not compared by the shared tests.

### A grammar DOM

What reading a grammar document produces (engine §8, §9), and what
`bootstrap.json` and the precompiled DOMs hold.

```
{"format":2,"rules":[RULE...],"directives":[DIRECTIVE...]}
```

`format` is the DOM's version, which changes whenever its shape does: a cached DOM of another version is never used.

**Rule**: `{"name":"sumti","op":"define","tags":TERM,"alternatives":[ALT...],"emit":EMIT,"conditions":[COND...],"at":[line,column]}`,
`op` being `define` or `extend`, and `tags`, `emit` optional. A rule's name is a name, or `#`.

**Alternative**: `{"guards":[{"feature":"cbm","negated":false}...],"expr":EXPR,"tags":TERM}`,
`tags` optional.

**Expression**: one of

```
{"seq":[EXPR...]}  {"choice":[EXPR...]}  {"and":[EXPR...]}
{"optional":EXPR}  {"repeat":EXPR,"min":1}
{"ref":"sumti"}    {"terminal":"KOhA"}    {"capture":"x","expr":EXPR}
{"empty":true}
```

`terminal` holds a name, a decoded string, or a phoneme tag `/p/`.

**Term**: `{"literal":"s"}`, `{"weak":"s"}`, `{"emptySet":true}`,
`{"union":[TERM...]}`, `{"intersection":[TERM...]}`,
`{"call":"phonemes","args":[ARG...]}` where an argument is a span or a term
or, for `tags` and `matches`, a rule name `{"rule":"lexicon"}`; a span is
`{"capture":"x"}`, `{"capture":""}` for `$`, or `{"call":"head","args":[SPAN]}` and likewise `tail`,
`last`.

**Condition**: `{"op":"=","left":TERM,"right":TERM}` with `op` one of `=`,
`≠`, `∈`, `∉`, `⊆`; `{"matches":SPAN,"rule":"r"}`; `{"not":COND}`;
`{"any":[COND...]}`; `{"all":[COND...]}`.

**Emission**: `{"items":[ITEM...]}`, an item being
`{"capture":"x","tags":TERM}`, `tags` optional, `{"capture":"x","erase":true}`, or
`{"insert":"h"}`; `"capture":""` is `$`.

**Directive**: `{"name":"elidable","args":["KU","KEI"],"at":[line,column]}`.

### Precompiled DOMs

`grammars/compiled.json`, generated by `tools/sync.js` and copied into every
package: `{"format":2,"bootstrap":HASH,"documents":{PATH:{"hash":HASH,"dom":DOM}}}`,
where `PATH` is relative to the grammars directory and each `HASH` is the
FNV-1a hash of engine §8. A library uses an entry only when the format, the
bootstrap's hash and the document's hash all match.

## Renderings

These are for people. The CLI and the playground implement all three; every
library implements brackets, which the corpus compares. None of them shows a
**hollow** rule node, one with no token and no elided node below it, such as
an empty free-modifier slot: brackets drop it as an empty node, and the tree
and the display JSON leave it out. The root is always shown, so a text whose
tree is hollow, such as the empty text, renders in the tree as the root's
rule name alone and in the display JSON as `{"text":[]}`.

### Brackets

The final stage's tree as nested groups:

1. A token node's label is its token's phonemes, or its text if its phonemes
   are empty; a label may itself be empty, as a `zoi` quote of nothing is,
   and is kept;
   an elided node's label is empty unless elided terminators are shown, when
   it is the terminal in lower case between `⟨` and `⟩`.
2. A rule node's children are rendered, and empty ones dropped, an empty one
   being an elided node that is not shown or a rule node that renders
   nothing; a token node is never empty. If none is
   left, the node is empty; if one, the node is that child; otherwise it is a
   group.
3. A group at depth *d* is written between `(` `)` when *d* mod 3 is 0,
   `[` `]` when 1, `{` `}` when 2, its members separated by one space. Depth
   counts groups only: a child group of a group at depth *d* is at *d*+1.

So `lo mlatu cu citka le finpe` is `([lo mlatu] cu [citka {le finpe}])`.

### Tree

One node per line, children indented two spaces under their parent: a rule
node as its name, followed by ` · ` and its text when it has only token
descendants on one line of source; a token node as its terminal, then its
label from above in quotes; an elided node as its terminal in angle
brackets. Chains of rule nodes with one child are written on one line,
joined by ` › `.

### Display JSON

The tree projected for reading, not the canonical form: a rule node is an
object with one member, its rule name, whose value is its only child's
projection if it has one child and the array of its children's projections
otherwise; a token node is `{"TERMINAL":"label"}`; an elided node is
`{"TERMINAL":null}`. It is pretty-printed so that nesting costs no
indentation where nothing is gained:

- a scalar is written as JSON;
- an empty array is `[]`; a non-empty one is `[`, a newline, each item
  indented two more spaces than the array and followed by `,` except the
  last, a newline, and `]` at the array's indentation;
- an object with one member is `{"name": ` followed by the value written at
  the same indentation as the object, then `}`, so `{"a": {"b": {"c": "x"}}}`
  stays on one line and a long chain adds no indentation;
- an object with several members is written like an array, as `"key": value`
  lines between `{` and `}`.
