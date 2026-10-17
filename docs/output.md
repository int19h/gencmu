# Output formats

This document describes what a gencmu library returns, as data and as text. The shared tests compare the canonical JSON as parsed JSON values. So two libraries agree when their outputs parse to equal values. The renderings are for people to read.

JSON member names are case-sensitive. Names that differ in case are distinct members. If an exact name repeats, the last value replaces the earlier value. Escapes that decode to the same name identify the same member. Each schema decides whether it accepts unknown members. An accepted unknown member cannot overwrite a member with a different name.

## Canonical JSON

Canonical JSON is UTF-8 JSON with integers only. A library leaves out an optional member that is absent. It never writes `null` for it, unless this document says otherwise. Every library writes canonical JSON with its own code, because the Rust standard library has no JSON writer.

Libraries write object keys in the order that this document gives. They write no whitespace outside strings, and they write non-ASCII characters as themselves. This makes outputs easy to compare by eye. But conformance is equality of the parsed values.

### A parse result

```
{"format":13,"ok":true,"stages":[STAGE...],"tree":NODE,"error":ERROR,"warnings":[WARNING...]}
```

`format` is the version of the result shape, 13. `tree` is the chosen tree of the last stage, or `null`. `error` is `null` when `ok` is true. `warnings` is present only when there is at least one parse warning (engine §12, §13).

A stage has one of these forms:

```
{"name":"words","verdict":"resolved","output":[TOKEN...]}
{"name":"syntax","verdict":"tie","witness":[ACTION,ACTION]}
```

`verdict` is `unique`, `resolved`, `tie`, or `null` for a stage that rejected ([engine §6](engine.md#6-choosing-a-parse) and [§13](engine.md#13-the-pipeline)). `witness` is present only for a `tie`. It is the pair of actions at the first visible difference between the two readings of the tie (engine §6). The action of the first reading comes first.

If there is no visible difference, it is the pair at their first difference. That is the first pair of differing actions of the whole sequences, transparent ones included. A derivation whose visible sequence is a proper prefix of the other's differs from it where the shorter ends.

The readings themselves are in the result's error (below), and the stage holds no tree of them. The canonical order *T* of engine §6 orders the ambiguity diagnostics. The canonical tie-break keys never turn a tie into an accepted reading.

`output` is the emitted tokens of a stage whose verdict is `unique` or `resolved`, the last stage included. It is absent for a tie, since a tied stage emits nothing (engine §6, §11). It is absent when the emission of the stage fails (engine §11). It is also absent where the check of `elision-only` meets an error of the grammar or loses its witness (engine §7.7, §7.9).

A token has this form. This one is the token of `mi` that the forms stage of the `cll-ebnf` dialect emits:

```
{"text":"mi","value":"mi","image":"mi","tags":["Cmavo","Continued","KOhA","Onset","Run-Final","Run-Initial","Word"],"span":[0,2],"source":[0,2]}
```

`tags` lists each stored identifier tag once in code-point order. Engine tags such as `_Lu` appear exactly when stored on the token. Stage-zero tags follow engine §1. `value` is always present and can be empty. Tags never determine either string.

`image` always exists and can be empty or contain line breaks. It can include adjacent text outside the token's source interval. `text` remains the original source interval and never expands through an image recipe.

For a precomposed character, each stage-zero token keeps the original source and text. Its value is one decomposed scalar.

`insertedBy` follows `source` for an `ε` emission item. It names its inserting rule. The token has empty span, source, and text. Its strings come from its item recipes. A covering item over an empty constituent does not acquire `insertedBy`.

`before` and `after` follow `insertedBy` for a token with attachments (engine §11). Each is an array of tokens in this form, and each is present only when it is not empty. An attached token has no `span`, so its object leaves it out. This is the token of `mi ui` that the indicator stage of the `cll-ebnf` dialect emits:

```
{"text":"mi","value":"mi","image":"mi","tags":["Cmavo","Continued","KOhA","Onset","Run-Final","Run-Initial","Word"],
 "span":[0,1],"source":[0,2],
 "after":[{"text":"ui","value":"ui","image":"ui","tags":["Cmavo","Continued","Indicator","Run-Final","Run-Initial","UI","Word"],"source":[3,5]}]}
```

A node has one of these forms:

```
{"kind":"rule","rule":"sumti","span":[0,3],"source":[0,9],"tags":[TAG...],"children":[NODE...]}
{"kind":"token","terminal":"KOhA","token":0,"span":[0,1],"source":[0,2]}
{"kind":"elided","terminal":"KU","span":[3,3],"source":[9,9]}
```

A list that flat braces read has no node of its own. Each level of a chain is a `rule` node of the chain's rule (engine §12). So braces add no kind of node.

A token node's `token` indexes the stage-input token it reads. `terminal` records canonical terminal identity, such as `KOhA`, `"a"`, `"a".."z"`, or `_`. Tests do not change that identity. Constants expand to their string identity. Read witnesses and expected lists use the same spelling.

An equality-tested elided node records the saved operand as `value`, after `source`. It preserves an explicit empty operand as `value:""`. Other elided nodes omit this member. Canonical tree comparisons include saved `value`. This metadata does not change the empty value observed by an omitted pattern leaf.

```json
{"kind":"elided","terminal":"T","span":[1,1],"source":[1,1],"value":"saved"}
```

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

A rejection can also name a failed boundary condition:

```json
{"kind":"rejected","stage":"syntax","token":4,"source":[12,15],"line":1,"column":13,
 "expected":[...],"boundary":{"rule":"bare-na","condition":1,"at":3},"message":"..."}
```

`boundary` appears only when a failed boundary obligation dropped an item at the reported position or later (engine §4.2). `rule` is the rule of the condition. `condition` is the index of the condition item among the rule's condition items, from 0. The count runs through the rule's definitions in source order, so an extension's items follow those of the rule it extends. `at` is the boundary where the obligation failed. Equal literals retain every source condition as an annotation, without changing record identity.

`kind` is one of these values:

- `rejected`: The grammar of the stage does not accept its input.
- `ambiguous` (engine §6, §7): The error has `stage`, `reason`, `readings` and `message`, and no position. Every ambiguous error has two readings. `message` is free, and the shared tests do not compare it. `reason` says which of two cases the error is:
  - `tie`: The ranking of the stage has two or more best derivations (engine §6). The stage's verdict is `tie`, and it has no output. The readings are the first and the second reading of the tie, over the stage's input as the stage read it. They are two derivations, but they can be equal as `NODE` values.

    The engine counts derivations. It merges neither those that differ only at transparent closes nor those with equal trees (engine §6). The stage's witness then names the actions where they differ.
  - `elision-only`: The stage chose one derivation, but its text stays ambiguous with its elided terminators written back (engine §7). The stage's verdict is `resolved`, and it keeps its output. The first reading is W(D), the restored chosen derivation. The second is its deterministic competitor (engine §7.10). This order also applies without ranked groups or flagged rules.

    The readings hold the written-back terminators as elided nodes (engine §7.10). One can be a restored optional's terminator. One can also be a terminator that a reading reads on the written route of an optional, or as a bare terminal. So the two readings can be equal as `NODE` values, as a tie's can.

    The error also has `"witness":[ACTION,ACTION]` after its readings. It holds the actions at the first difference between the two derivations, visible if there is one, mapped to the stage's input (engine §7.10). Over that input, the two actions can be equal too. The stage itself has no witness.
- `grammar`: A grammar failed to load, or the parser found a defect while parsing. For a grammar that failed to load, the error has `document`, `line` and `column` where known. A tie in a stage of the notation dialect has the `document` and no `line` or `column` (engine §8).

  For a defect found while parsing, the error has `stage` and no position. An example of such a defect is a nested parse asked about its own span as the same rule. An error that lowering finds for the features of the parse is one too (engine §3). An item of braces that can match no tokens is such an error. Its message begins with the document, line and column of the definition at fault, since the error's position members are for the stage's input.

  A defect found by the check of `elision-only` can have the member `code` with the value `elision-witness-lost` (engine §7.9). Such an error also has `chosen`, the chosen tree. It has `completion`, the terminators written back.

  Each of them is `{"terminal":T,"at":N,"source":[S,S]}`. Only a terminator with an equality test adds `"value":"..."` last, including an empty equality operand. The members stand in the order `kind`, `stage`, `code`, `message`, `chosen`, `completion`. Other parse-result errors have no `code`. Structured loading errors use the separate schema below.

For example, `text → [[X]]` on the empty input ties, and both readings are `{"kind":"rule","rule":"text","span":[0,0],"source":[0,0],"tags":[],"children":[]}`. The stage's witness names two different productions of the helpers. An `&` that can match no tokens, such as `[A] & [B]`, gives such a tie too, with three derivations.

A mistake of the caller is not a result. It is an error of kind `usage` (engine §13).

`line` and `column` count from 1, in code points. Lines end at `\n`, `\r\n` or `\r`.

At the end of a stage's input, a rejection has `token` equal to the number of input tokens. Its `source` is `[S,S]`. `S` is the source end of the last stage-input token, or 0 if there are no input tokens. Its `line` and `column` locate `S` in the original text. The original text can continue after `S` (engine §4, §12).

`expected` lists terminals in code point order. The library writes a tested terminal as the terminal followed by its test, as in `LE="la"`, and sorts it by that text. So `LE` comes before `LE="la"`, which comes before `LEhU`. Each terminal comes with the rules whose items can read it at that position, also in code point order. `message` is the description for people, and the shared tests do not compare its wording.

Expected-terminal diagnostics use exact value tests and signed tag tests. Constants expand to resolved strings or requirements. Requirements sort by tag name in code point order. For one name, the positive requirement comes first. Duplicate requirements of one sign collapse.

The spelling writes the terminal, then `<`, then requirements separated by one ASCII space, then `>`. A value test follows when present. No other space appears outside string literals. Empty requirements spell `<>`. Canonical strings follow engine §9.

Examples are `KOhA<UI Word>`, `KOhA<¬UI>`, `LE≠"lo"`, `X<¬A B>`, and `X<A>="s"`.

### Loading errors

Ranked loading errors have these members, in this order:

```text
kind, code, message, group, option, expression, inheritance
```

`kind` is `grammar`. `code` and `message` are required for the five ranked loading errors. Their codes are `ranked-choice-syntax`, `ranked-choice-continuation`, `ranked-choice-boundary`, `ranked-choice-export`, and `ranked-choice-tags` (engine §2.1). Message wording is not part of conformance.

`group` appears when the reader identifies a ranked group. Its members are `document`, `at`, `rule`, `alternative`, and `path`, in that order. Omit `document` and `at` when unknown. `at` identifies the first `≻` token where source exists.

`rule`, `alternative`, and `path` identify the final stitched source expression where available. `alternative` and `option` are zero-based indexes. Omit `option` for a failure common to the whole group.

`path` is a JSON Pointer relative to the alternative's `expr`. Ranked children use `/ranked/0`, `/ranked/1`, and subsequent indexes. Captures and tests continue through `expr`. Other components keep their names.

`expression` is the offending written expression as a DOM value where available. `inheritance` appears only for a tag error with a witness. It lists rule or helper sites from the group toward the tag source. Helper sites use written paths and the same source fields.

Choose the shortest inheritance witness. Source traversal order breaks equal-length choices. Keep loading diagnostics outside document DOMs, cache envelopes, and parse-result warnings. The API exposes these members, and CLI JSON serialization preserves their order.

### A grammar DOM

The authoritative constructor contract is [engine §9.3](engine.md#93-conversion-and-validation). It defines recognized syntax parts, required lookups, and conversion into these schemas.

A grammar DOM (document object model) is the parsed form of a grammar document (engine §8, §9). A library makes it when it reads the document. `bootstrap.json` and the precompiled DOMs hold the same data.

Its envelope is `{"format":31,"rules":[RULE...],"directives":[DIRECTIVE...],"constants":[CONST...],"classifiers":[CLASSIFIER...],"implications":[IMPLICATION...]}`. All five declaration arrays are present, including when empty. Every declared item has `at:[line,column]`, counted from 1. Both coordinates must be positive integers.

`format` is the version of the DOM. It changes whenever the shape or accepted values of the DOM change. A library never uses a cached DOM of another version.

DOM format 31 supports restored spans, close families, ordered ranked expressions, stage selectors, patterns, tree comparisons, rule flags, braces, and elidable optional markers. It also supports token strings, recipes, stored engine tags, and method expressions. Elidable terminators accept value tests and signed tag requirements. A string holds the characters that stage zero gives for its written segments, and the exact scalars of its constants. DOM format 31 also supports boundary atoms, the `ends-input` method and the `fewest` flag. DOM depth follows the compound ancestors and transparent wrappers defined in engine §9.

Format 31 also applies to bootstrap and cache envelopes. A bootstrap is `{"format":31,"stages":[{"name":"lexical","documents":[{"path":PATH,"dom":DOM}]}...]}`. Each document run stores its path and DOM. Stage names are distinct, and each stage has at least one document run. A library rejects other bootstrap formats and skips other cache formats.

The cache identity also includes the bootstrap hash (engine §8).

A rule has this form, in canonical member order:

```text
{"name":"unit","op":"define","flags":[],"tags":TERM,"value":RECIPE,"image":RECIPE,
 "alternatives":[ALT...],"emit":EMIT,"conditions":[COND...],"erased":true,"at":[line,column]}
```

`op` is `define`, `redefine`, or `extend`. `tags`, `value`, `image`, `emit`, and `erased` are optional. `conditions` is an array, including when empty. `erased` is present only as `true`. `erased` and `emit` cannot coexist. An erased definition cannot carry a recipe.

`flags` is `[]`, `["leftmost-longest"]` or `["fewest"]`. An extension always has `[]` in the document DOM, but inherits the stitched rule's flag (engine §2). Unknown values, duplicate flags and flags on extensions are errors. An item with `op: "define"` or `op: "redefine"` and `flags: []` gives the stitched rule no flags.

`alternatives` is nonempty. A rule name is lowercase or `#`.

An alternative is `{"guards":[GUARD...],"expr":EXPR,"tags":TERM,"value":RECIPE,"image":RECIPE}`. Its three clause members are optional. `guards` is present even when empty. A guard is `{"feature":"cbm","kind":"gate","negated":false}` or `{"feature":"y-cmavo","kind":"warning","negated":false}`. A gate can have `negated:true`. A warning cannot.

A guard's feature is a feature name as engine §9.1 defines it, and a guard has no member but these three. The first guard spells `cbm?`, and its negated form spells `¬cbm?`. The second spells `y-cmavo!`.

An expression has exactly one of these forms:

```text
{"seq":[EXPR,EXPR...]}       {"choice":[EXPR,EXPR...]}
{"ranked":[EXPR,EXPR...]}    {"and":[EXPR,EXPR...]}
{"optional":EXPR}           {"optional":EXPR,"elidable":true}
{"repeat":EXPR,"separator":EXPR,"chain":"left"}
{"ref":"sumti"}            {"ref":"KOhA"}            {"ref":"_Lu"}
{"literal":STRINGTERM}      {"wildcard":true}
{"range":[STRINGTERM,STRINGTERM]}
{"capture":"x","expr":CAPTURETARGET}
{"test":"=","value":STRINGTERM,"expr":TESTTARGET}
{"test":"tags","requirements":[REQUIREMENT...],"expr":BASETARGET}
{"empty":true}
```

An expression has no member but those of its one form.

`seq`, `choice`, `ranked`, and `and` require at least two children. `and` accepts at most 16.

`repeat` is braces (engine §3, §9). Its value is the item, and its `separator` is present only where the braces have `/`. Its `chain` is present only for a chain: `left` for `{... x / s}` and `right` for `{x ... / s}`. So `{x}` is `{"repeat":X}`, `{x / s}` is `{"repeat":X,"separator":S}`, and `[{x}]` is `{"optional":{"repeat":X}}`. A `repeat` with a `chain` is the whole `expr` of its alternative, and never part of another expression. A list counts one or more items, and an optional list is an `optional`.

A `ref` stores a rule or tag name, including `#` or an engine tag. `literal` stores an unresolved string term. A range stores two string terms that resolve to single scalar endpoints. `wildcard` is exactly `true`.

An `optional` with `"elidable":true` is an elidable optional (engine §3.8). `[+KU #]` is `{"optional":{"seq":[{"ref":"KU"},{"ref":"#"}]},"elidable":true}`. A plain optional has no `elidable` member.

`BASETARGET` is a `ref` other than `#`, `literal`, `wildcard`, or `range`. `TESTTARGET` is a BASETARGET, or its tag-tested form under a value test. `CAPTURETARGET` is a BASETARGET, its legal tested form, or an untested `ref:"#"`.

Capture names use lowercase letters, digits, hyphens, and underscores. Captures cannot occur inside repeats or elidable optionals. Each expanded production binds a name at most once.

A value test uses `=` or `≠`. A tag test uses `test:"tags"` and an ordered array of requirements. A requirement is `{"negated":false,"value":TERM}`, where TERM is a tag literal or tag-set constant. A negative requirement has `negated:true`.

The requirement array can be empty. An empty constant also resolves to no requirements. A tag test wraps only a BASETARGET. A value test wraps a BASETARGET or its tag test. Both tests must hold. Repeated test kinds and reversed nesting are malformed.

For example, `_<Stressed>≠"y"` converts to this nested expression:

```json
{"test":"≠","value":{"string":"y"},"expr":{"test":"tags","requirements":[{"negated":false,"value":{"tag":"Stressed"}}],"expr":{"wildcard":true}}}
```

The pattern value `@A<B>=""` converts as follows. Its leaf uses `terminal` and records its source position. Both tests observe that same leaf.

```json
{"pattern":{"test":"=","value":{"string":""},"expr":{"test":"tags","requirements":[{"negated":false,"value":{"tag":"B"}}],"expr":{"terminal":"A","at":[1,2]}}}}
```

A capture of `#` instead converts as follows:

```json
{"capture":"f","expr":{"ref":"#"}}
```

The first symbol of an elidable optional is an ordinary tag `ref`, optionally tested. Its expression is that symbol or a sequence starting with it. Engine tags, strings, ranges, wildcard, captures, and grouped heads are invalid. Source syntax also rejects parentheses around the head. The DOM does not record discarded grouping.

Terms have these forms:

```text
{"string":"s"}               {"interpolate":[STRINGTERM...]}
{"tag":"Word"}               {"emptySet":true}
{"const":"SU-STOPS","at":[line,column]}
{"union":[TERM,TERM...]}       {"intersection":[TERM,TERM...]}
{"difference":[TERM,TERM]}     {"if":COND,"then":TERM}
{"capture":"x"}              {"capture":""}
{"method":"value","receiver":RECEIVER,"args":[]}
{"pattern":PATTERN}
```

A run of bare tag names produces one `union` of singleton `tag` terms in written order. Any `union` operand that is itself a `union` flattens into its enclosing union. This applies to runs and explicit `∪`, including either form inside grouping parentheses. Parentheses make no DOM node. Thus `:: $f.tags ∪ Run-Initial Run-Final` has three union operands. Intersection and difference retain their operands, so `(Word BY) ∩ $l.tags` keeps the run's union as the intersection's first operand.

For example, `A ∪ (B ∪ C)` gives this term:

```json
{"union":[{"tag":"A"},{"tag":"B"},{"tag":"C"}]}
```

`STRINGTERM` is `string`, string-valued `const`, or `interpolate`. Interpolation parts are literal strings and constant references. The array is nonempty and preserves written order. The reader merges adjacent literal segments and omits empty segments unless every segment is empty. A literal without interpolation uses `string` directly. Engine constants retain their `_` names and reference positions like user constants.

Engine constants resolve directly as scalar strings outside the user constant version graph (engine §2).

`const` is a reference to a constant, by its name without `$`. Its `at` is the line and column of the reference, where the loader reports an error of the constant (engine §2). A term has no member but those of its one form. `difference` has exactly two parts, and `a ∖ b ∖ c` nests the first difference in the second.

A method node always has `method`, `receiver`, and `args`, in that order. Its method name, receiver type, arity, and result type follow engine §10. A receiver can be a capture, span method, string term, or the recipe-only emitted pair. Zero-argument methods have an empty argument array.

Rule arguments use `{"rule":"r"}`, including `{"rule":"#"}`. `.tags`, `.matches`, `.begins` and `.without-elision-except` take one. Classifier arguments use `{"classifier":"lexicon"}`. These are legal only in their method's argument position. String arguments are terms. A classifier name starts with a lowercase letter, so `#` cannot name a classifier.

`.followed-by` and `.preceded-by` take one or more arguments, each `{"rule":"r"}` or `{"terminal":"T"}`, in written order. Two or more arguments form a choice. Their receiver is `{"capture":"x"}`, or `{"capture":""}` for `$`.

`.without-elision` requires a bare capture receiver, including `{"capture":""}` for `$`. `.onward` can wrap its restored result. The DOM contains no runtime restoration records or ranked seals. Readers reject `$x.onward.without-elision` and direct the author to `$x.without-elision.onward`.

`.without-elision-except` takes the same receiver and exactly one rule argument. `.onward` can wrap its result too. Readers reject `$x.onward.without-elision-except(f)` in the same way.

For example, `$m.without-elision.matches(sumti)` uses this condition DOM:

```json
{"method":"matches","receiver":{"method":"without-elision","receiver":{"capture":"m"},"args":[]},"args":[{"rule":"sumti"}]}
```

`$s.without-elision-except(math).onward.begins(quantifier)` uses this condition DOM:

```json
{"method":"begins","receiver":{"method":"onward","receiver":{"method":"without-elision-except","receiver":{"capture":"s"},"args":[{"rule":"math"}]},"args":[]},"args":[{"rule":"quantifier"}]}
```

The extended prefix uses `$m.without-elision.onward.begins(sumti)`. Its receiver nests an `onward` method around the restored span. Query conditions use the same method schema as terms.

A recipe is `{"concat":[ATOM...]}` with a nonempty array. Atoms are STRINGTERM or one of the seven recipe string methods on a bare capture. The methods `.emitted.value` and `.emitted.image` are the two channel forms of `emitted`. An emitted-channel atom nests the channel selector around `{"method":"emitted","receiver":CAPTURE,"args":[]}`. `emitted` alone cannot be a recipe atom.

```json
{"concat":[{"method":"value","receiver":{"capture":"a"},"args":[]},{"string":" "},{"method":"image","receiver":{"method":"emitted","receiver":{"capture":"b"},"args":[]},"args":[]}]}
```

Recipe syntax accepts no other method chains or expression types. `concat` belongs only to recipes. Conditions and constant definitions cannot concatenate strings through this node.

Conditions have these forms:

```text
{"op":"=","left":TERM,"right":TERM}
{"method":"matches","receiver":SPAN,"args":[{"rule":"r"}]}
{"method":"begins","receiver":SPAN,"args":[{"rule":"r"}]}
{"method":"starts-input","receiver":SPAN,"args":[]}
{"method":"ends-input","receiver":SPAN,"args":[]}
{"method":"followed-by","receiver":CAPTURE,"args":[TARGET,TARGET...]}
{"method":"preceded-by","receiver":CAPTURE,"args":[TARGET,TARGET...]}
{"not":COND}             {"any":[COND,COND...]}       {"all":[COND,COND...]}
{"captured":"x"}        {"if":COND,"then":COND}
```

Comparators are `=`, `≠`, `∈`, `∉`, `⊆`, `⊈`, `≅`, and `≇`. Operand types follow engine §10. Tree comparison requires a bare capture on the left. A presence predicate uses `captured`, with an empty name for `$`.

A TARGET is `{"rule":"r"}` or `{"terminal":"T"}`. A CAPTURE is `{"capture":"x"}`, with an empty name for `$`. A boundary atom is a condition, so `not`, `any`, `all` and `if` can hold it (engine §4.2).

A condition has no member but those of its one form.

An emission is `{"items":[ITEM...]}` with a nonempty array. An item is either `{"capture":"x"}` or `{"insert":true}`, followed by optional `tags`, `value`, `image`, `before`, and `after`. The empty capture name denotes `$`. Only named capture items accept nonempty attachment arrays. Each attachment array contains capture names without `$`, in written order. Empty attachment arrays are omitted.

`%emits` without items creates `{"items":[{"capture":""}]}`. A clauses-only emission adds those clauses to that item. `%emits ε` creates `{"items":[{"insert":true}]}`. Erasure uses the separate rule member `erased:true`.

A constant is `{"name":"SU-STOPS","op":"define","value":TERM,"at":[line,column]}`. Its operation is `define` or `redefine`, and its value is closed. `%const` defines, and `%redefine-const` redefines. The name has no `$`. The value can hold `const` terms but never a value that the loader gives them.

Engine constants cannot be declared.

A classifier is `{"name":"lexicon","entries":[ENTRY...],"at":[line,column]}`. Its name begins with `a` to `z`. `entries` can be empty, for a `%classifier` with no entry.

An entry is `{"guards":[GUARD...],"keys":[STRINGTERM...],"op":"∈","class":"KOhA","at":[line,column]}`. Guards are gates only. Keys are nonempty in count, but an individual string can be empty. Source classifier keys are string literals, with interpolation permitted. The operator is `∈` or `∉`. The class starts and ends with capitals and never starts with `_`.

An entry's `at` is the line and column of its first token, where the loader reports an error of the entry (engine §2).

An implication is `{"if":TERM,"then":TERM,"at":[line,column]}`, for `%implies A ⟹ B`. `if` is `A`, and `then` is `B`. Both terms are closed tag sets and cannot mention engine tags.

A classifier and an implication have no member but those shown.

A directive is `{"name":"features","args":["cbm"],"at":[line,column]}`.

Directive names are `stage`, `extend-stage`, `redefine-stage`, `include`, `features`, and `ambiguity-resolution`. Stage selectors take one lowercase name. Includes take one include path. Features take at least one feature name as engine §9.1 defines it. Ambiguity resolution takes `greedy`, `lazy`, or `late-elision`, optionally followed by `elision-only`.

A directive of any other name is malformed (engine §9). An argument is a name or, for `include`, the include path: `{"name":"include","args":["../words/stream.md"],"at":[4,3]}`.

A library ignores unknown members of a directive. Its known members, `name`, `args`, and `at`, keep their rules. An unknown member does not excuse a malformed known member.

`rules`, `directives`, `constants`, `classifiers` and `implications` each keep the order in which the document has them. `at` is the line and column of an item's first token. So the order of all of a document's items is the order of their positions. No two items of a DOM share a position (engine §9).

DOMs store unresolved references and source positions, never stage-resolved constant or classifier values. Source, cached, and supplied DOMs obey the same arity, type, capture, clause, and depth rules.

### Pattern values

PATTERN tests one structural tree. CHILDREN consumes an ordered sequence of sibling trees. A pattern term has exactly one member, `pattern`, whose value is a PATTERN. Pattern types can also use `const`, `union`, `intersection`, `difference` and contextual `emptySet` terms. Mixed pattern and tag-set operations are malformed.

`TERMINALATOM` is a `terminal`, `literal`, `range`, `wildcard`, or unresolved user `constant` pattern atom. A user constant under a test must resolve to a string.

PATTERN has exactly one of these forms:

```text
{"name":"sumti","at":[line,column]}
{"terminal":"KEhE","at":[line,column]}
{"literal":STRINGTERM,"at":[line,column]}
{"range":[STRINGTERM,STRINGTERM],"at":[line,column]}
{"wildcard":true,"at":[line,column]}
{"test":"tags","requirements":[REQUIREMENT...],"expr":TERMINALATOM}
{"test":"≠","value":{"string":""},"expr":{"terminal":"KEhE","at":[line,column]}}
{"constant":"KE-UNIT","at":[line,column]}
{"children":CHILDREN}
{"union":[PATTERN...]}
{"intersection":[PATTERN...]}
{"difference":[PATTERN,PATTERN]}
{"path":"descendant","pattern":PATTERN}
{"path":"first","pattern":PATTERN}
{"path":"last","pattern":PATTERN}
```

CHILDREN has exactly one of these forms:

```text
{"node":PATTERN}
{"sequence":[CHILDREN...]}
{"optional":CHILDREN}
{"repeat":CHILDREN}
{"repeat":CHILDREN,"separator":CHILDREN}
{"siblings":true}
```

A capitalized or engine tag becomes `terminal`, including KEhE, GIhI, NUhI, and `_Lu`. Strings use `literal`, ranges use `range`, and `_` uses `wildcard`. Other names, including `#`, use `name`. A tag test can wrap a terminal atom, and a value test can wrap that tag test. The source order is tag then value.

User constant atoms use `constant` until binding through the version graph of engine §2. A string constant denotes a string terminal, while a pattern constant denotes its predicate. Binding does not change the cached DOM.

Engine scalar atoms use `literal` with an unresolved `const` STRINGTERM. Both positions name the constant token. `@$_0061` has this complete DOM:

```json
{"pattern":{"literal":{"const":"_0061","at":[1,2]},"at":[1,2]}}
```

Tag and value tests can wrap either constant atom form. A tested user constant must resolve to a string. A test on a pattern-valued constant is a document error at the `at` of its `constant` reference.

At the literal root, a sequence becomes `children`. A nested literal inside a sequence instead becomes one `node` item. Plain parentheses preserve sibling grouping. Thus `@(A (B C))` has three children, while `@(A @(B C))` has two. A single node predicate remains that predicate. An optional or repeat always becomes a `children` predicate.

Set operators combine PATTERN values. A sequence operand becomes `children` before a set operation or path. A set expression within a sequence consumes one child through `node`. Every bracket becomes `optional`, including `[T]` and `[(T)]`. No `boundary`, `written` or `omitted` pattern form exists.

Any union operand that is itself a union flattens into its enclosing union. For example, `@(A ∪ (B ∪ C))` gives this complete DOM:

```json
{"pattern":{"union":[{"terminal":"A","at":[1,3]},{"terminal":"B","at":[1,8]},{"terminal":"C","at":[1,12]}]}}
```

Intersection and difference retain their operands. Union and intersection require at least two operands. Difference requires exactly two. A sequence requires at least two parts. `siblings` must be true.

Optional and repeat require nonempty written bodies. A repeat body that only matches empty sequences is malformed. A sibling ellipsis cannot serve as a repeat item or separator.

A tree comparison uses the `op`, `left` and `right` members:

```json
{"op":"≅","left":{"capture":"x"},"right":{"pattern":{"name":"sumti","at":[1,9]}}}
{"op":"≇","left":{"capture":""},"right":{"const":"KE-UNIT","at":[1,7]}}
```

These operators require a bare capture on the left and a pattern term on the right. Pattern equality and implicit string conversion are malformed. Text, cached DOMs and supplied DOMs use the same grouping, field, arity and type restrictions. Resolution covers patterns in replaced definitions too.

Structural states and omission predicates remain internal derived state. Omitted pattern tags are the singleton terminator tag set. Internal omission records retain `value` only for equality, including explicit empty equality.

Equality-tested elided tree nodes expose that saved `value`, including an explicit empty string. Omitted pattern leaves still observe empty value and image. Completion diagnostics expose `value` when present.

### Ranked expressions

A ranked expression is `{"ranked":[EXPR,EXPR...]}`. Its array has at least two ordinary expressions and preserves source order. A nested ranked expression retains its own boundary. Ordinary alternatives within one option use `choice`.

For example, `mex MOI # ≻ SE # tanru-unit-1` produces this expression:

```json
{"ranked":[{"seq":[{"ref":"mex"},{"ref":"MOI"},{"ref":"#"}]},{"seq":[{"ref":"SE"},{"ref":"#"},{"ref":"tanru-unit-1"}]}]}
```

The DOM holds no lowered helper, admission key, [seal](notation.md#ranked-choices), or selected option. References retain their written form before terminal resolution. Expression traversal includes `ranked` alongside other expression forms.

### Precompiled DOMs

`grammars/compiled.json` holds the precompiled DOMs. `tools/sync.js` generates it and copies it into every package. Its shape is `{"format":31,"bootstrap":HASH,"unicode":HASH,"documents":{PATH:{"hash":HASH,"dom":DOM}}}`. `PATH` is relative to the grammars directory. Each `HASH` is the FNV-1a hash of engine §8. `unicode` is the hash of the text of the `unicode.txt` that read the documents.

A library uses an entry only where four values match. They are the format, the hash of the bootstrap, the hash of its Unicode table and the hash of the document.

A precompiled DOM holds the document's constants, classifiers and implications as the document writes them. The loader gives the constants their values when it stitches a stage, and a stage resolves a classifier for the features of a parse. So one precompiled DOM serves every stage, dialect and set of features that uses the document (engine §2, §8).

## Renderings

The renderings are for people. The CLI and the playground implement all three renderings. Every library implements brackets, and the corpus tests compare brackets. Every rendering shows a token by its image.

A token node reads an input token of the last stage, and that token can have attachments (engine §11). Every rendering shows them with the token node. All readings of an `ambiguous` error read the same tokens, so they show the same attachments.

A hollow rule node, such as an empty slot for a free modifier, has no token and no elided node below it. No rendering shows a hollow rule node. Brackets drop it as an empty node, and the tree and the display JSON leave it out. But the tree and the display JSON always show the root. So the tree renders a hollow tree, such as that of the empty text, as the rule name of the root alone. The display JSON renders it as `{"text": []}`, and brackets render it as nothing.

### Brackets

Tree patterns do not change bracket grouping. The renderer applies the rules below after it decides whether to show elided terminators. Brackets write the tree of the final stage as nested groups:

1. The image of a token node is the image of its token (engine §5). Grammar image recipes supply pause spaces and verbatim quote spelling. An image can itself be empty, and the renderer keeps it. The image of an elided node is empty, unless elided terminators are shown. In that case, the image is the terminal in lower case between `⟨` and `⟩`.
2. A token node whose token has attachments renders as a group. Its members are the token's before-attachments, the token's image, and its after-attachments, in that order. Each attachment renders in the same way: as its image, or as a group if it has attachments of its own.
3. The renderer renders the children of a rule node and drops the empty ones. An empty child is an elided node that is not shown, or a rule node that renders nothing. A token node is never empty.

   If no child is left, the node is empty. If one child is left, the node is that child. Otherwise, the node is a group.
4. The depth *d* of a group counts groups only: a child group of a group at depth *d* is at *d*+1. A group is written between `(` `)` when *d* mod 3 is 0, `[` `]` when 1, and `{` `}` when 2. One space separates its members.

So `lo mlatu cu citka le finpe` is `([lo mlatu] cu [citka {le finpe}])`. In the `cll-ebnf` dialect, `mi ui klama` is `([mi ui] klama)`, `ba'e mi klama` is `([ba'e mi] klama)`, and `mi ui nai klama` is `([mi {ui nai}] klama)`.

### Tree

The tree has one node per line, and children are indented two spaces under their parent. Each kind of node is written as follows:

- A rule node is its name. If the node has only token descendants on one line of source, ` · ` and its text follow the name. They do not if any of those tokens has attachments. They also do not if the image of any of those tokens, or of their attachments, holds a line break.
- A token node is its terminal, then its image from above in quotes. The quoted image is escaped as a JSON string, so a line break in it is written `\n`.
- The attachments of a token node follow it, each on a line of its own, indented two spaces more than the node. The before-attachments come first, each after `◂ `, and then the after-attachments, each after `▸ `. These marks differ from the ` › ` that joins a chain of rule nodes.

  An attachment is its classes, then its image in quotes. Its classes are its tags that start and end with a capital and never start with `_`, in code point order, joined by ` ∪ `. An attachment with no class is its image alone. Its own attachments follow it in the same way, indented two spaces more.
- An elided node is its terminal in angle brackets.

The tree renderer writes chains of rule nodes with one child on one line. It joins them with ` › `. So in the `cll-ebnf` dialect, the token node of `mi` in `mi ui nai klama` has these lines, at the indentation of the node:

```
KOhA "mi"
  ▸ UI "ui"
    ▸ NAI "nai"
```

### Display JSON

The display JSON is the tree projected for reading, and it is not the canonical form. A rule node is an object with one member, its rule name. If the node has one child, the value of this member is the projection of that child. Otherwise, the value is the array of the projections of its children. A token node is `{"TERMINAL":"image"}`, and an elided node is `{"TERMINAL":null}`.

A token node whose token has attachments is `{"terminal":"T","image":"L","before":[...],"after":[...]}` instead. An attachment in those arrays is `{"classes":["C",...],"image":"L","before":[...],"after":[...]}`, with its classes in code point order. Each of these objects leaves out an empty array. The terminal is a value there and not a key, so no terminal can collide with a member of the object.

The display JSON is pretty-printed so that nesting costs no indentation where nothing is gained:

- A scalar is written as JSON.
- An empty array is `[]`. A non-empty array is `[`, a newline, each item, a newline, and `]` at the indentation of the array. Each item is indented two more spaces than the array, and each item except the last is followed by `,`.
- An object with one member is `{"name": ` followed by the value, then `}`. The value is written at the same indentation as the object. So `{"a": {"b": {"c": "x"}}}` stays on one line, and a long chain adds no indentation.
- An object with several members is written like an array, as `"key": value` lines between `{` and `}`.
