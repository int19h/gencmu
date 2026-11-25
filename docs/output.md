# Output formats

This document describes what a gencmu library returns, as data and as text. The shared tests compare the canonical JSON as parsed JSON values. So two libraries agree when their outputs parse to equal values. The renderings are for people to read.

Grammar names, tags, features, and texts below are examples that illustrate the output forms. Grammar documents define their pipeline behavior.

JSON member names are case-sensitive. Names that differ in case are distinct members. If an exact name repeats, the last value replaces the earlier value. Escapes that decode to the same name identify the same member. Each schema decides whether it accepts unknown members. An accepted unknown member cannot overwrite a member with a different name.

## Canonical JSON

Canonical JSON is UTF-8 JSON with integers only. An integer member has no fraction or exponent in its JSON spelling. A library leaves out an optional member that is absent. It never writes `null` for it, unless this document says otherwise. Every library writes canonical JSON with its own code, because the Rust standard library has no JSON writer.

Serialization applies the witness gates even to caller-built results. An error witness requires both kind `ambiguous` and reason `elision-only`.

Single-guillemet escapes belong to notation strings printed in names and diagnostics. JSON serialization still preserves the actual member values with ordinary JSON quoting. A notation string inside a JSON member therefore has both its notation spelling and the surrounding JSON string encoding.

Libraries write object keys in the order that this document gives. They write no whitespace outside strings, and they write non-ASCII characters as themselves. This makes outputs easy to compare by eye. But conformance is equality of the parsed values.

Stored Unicode memberships and printed terminals use canonical long names. This also applies to expected lists, witnesses and instance names.

### A parse result

The result has `format:18`. On success `error` is null. The result's `input` holds the original text and the complete origin token table. Grammar stages follow in execution order.

| Record | Fields in canonical order |
|---|---|
| Result | `format,ok,input,stages,tree,error,warnings` |
| Input | `text,tokens` |
| Stage | `name,verdict,input,root,nodes,readings,witness,output,errors,warnings` |
| Reading | `root,nodes` |
| Node | `id,kind,rule,terminal,token,span,source,default,children,primary,producer,part,face` |
| Face | `image,classes,core,parts,primaryIndex` |
| Token | `node,text,props,span,source,insertedBy,errors,warnings` |

Stage indices and occurrence IDs start at zero. Indices count grammar stages. A stage’s input index names its predecessor or uses minus one for the origin table. A qualified node reference is `[stage,reading,id]`. Reading zero names the chosen table.

One and two name the displayed witnesses in their canonical order. The error envelope uses those references for its displayed readings. A reference into the origin table has the form `[-1,0,inputIndex]`. Local child references are integers. The chosen top-level tree is a qualified reference on success and on `reported`.

Other errors give a null top-level tree.

The node kinds are `rule,splice,token,elided,projection,insertion`. The wire kind of a braced item is `projection`. Each record gives its span and source. A rule or splice names its effective rule. A token leaf gives terminal and stage-input index.

An omitted leaf gives its terminal and any explicit or equality-derived default. Its kind records omitted origin. An absent default field decodes to the empty string.

Children are ordered local occurrence IDs. Flatten splice children only for structural display and matching. A primary is its marked child’s ID. Only `projection` and `insertion` carry `producer`. It is the local integer ID of the rule or splice that executes the item.

Zero is valid. A bare splice emission records the called splice. Forwarding preserves the producer. Resolve `producer` and `part.node` in the same stage and reading table as their node. A braced item names its part as `{"node":id}`.

A whole-occurrence projection can use the same ID for both links. For example, occurrence 6 can select a part at occurrence 9. The projection records `"producer":6,"part":{"node":9}`. An insertion by occurrence 6 records `"producer":6` and omits `part`.

Synthetic records stay beside the original tree. In particular, a braced item over the whole node points to its origin without becoming its origin’s child.

Within a stage output, the token member `node` is a local integer ID. The containing stage and reading zero identify its producing table. Origin records omit that field. A bag uses a JSON object with keys in Unicode scalar order. An absent key has no member.

Bare entries of either case encode as `true`. A token's `props` object always includes both strings. A valued entry encodes its string, bounded number, list or nested bag. Reject `false` and `null` as entries. The bare sentinel occurs only as an object member.

A list element needs a legal payload type. Decode a bare `true` separately from integer one. Zero and the empty string remain values. Enforce these rules at every nesting level. Do not expose working bags or engine-only source evidence.

Each face requires `image:string`, `classes:[string]` in scalar order and `core:[stage,reading,id]`. On a decorated face, `parts` is a nonempty ordered array of qualified references to display units. Its `primaryIndex` is an integer from zero through the number of parts minus one. Resolve stage minus one against the origin token table. Resolve every other part against the referenced stage and reading.

Apply the containing face’s replacement image once along the primary part’s core path. Render the sibling faces on their respective sides. An opaque face omits both `parts` and `primaryIndex` and renders its image as one unit. A face can name itself as its core. Never expand a core reference as another parts edge.

Brackets group the parts. The tree formatter labels and indents satellites. Display JSON uses ordered parts and their primary index. The playground shows the token’s place and links its core. Keep empty lexical images and the controls for showing elisions.

Number body occurrences in left-to-right preorder before splice flattening. Append synthetic occurrences by producer preorder, written item index and binding iteration order. The implicit braced item for a bare spliced emission uses item index zero. Reuse the same synthetic occurrence across publication and display. Sort records by ID.

Sparse IDs are legal. Allocation order never enters the wire.

Retain the reporting stage’s complete chosen table and both tables of a displayed ambiguity. Keep the complete structural table of a failed stage with a chosen reading. Earlier chosen stages default to compact records. Keep their roots, token origins and targets of primary, part, producer and face links. If a target has no child array, still follow its links.

Visit each occurrence once. Omit their child arrays.

With `stageTrees:"all"`, keep all occurrences and child arrays. Retention cannot add an evaluation demand. Use iterative traversals for deep results.

Keep a stage root after a post-choice failure. Without a chosen table, omit nodes. A tie has a witness and no chosen root or output. A successful empty publication contains `output:[]`. A tree-only stage omits output.

Omit empty diagnostic lists. Apply the [publication failure rules](engine.md#failure-order). Every surviving reference resolves after the pipeline and caller buffers disappear.

A verdict is `unique`, `resolved`, `tie` or null. If a stage fails before ranking completes, its verdict is null. For a tie, the stage's witness names the first visible difference between the displayed readings. If there is no visible difference, it uses the first difference in the complete sequence, including transparent actions. The first reading's action comes first.

For example, two publishing stages can each emit a token with `"node":0`. In their respective output lists those links resolve to `[0,0,0]` and `[1,0,0]`. The caller token in the origin table omits `node`.

The `span` counts stage-input tokens and `source` counts original Unicode scalars. A token's `text` is the original source slice. Its image can include text outside that range. Stage zero keeps the original source and one decomposed scalar as each string.

An insertion records its rule as `insertedBy`. Its span, source and text are empty. A projection over an empty part has no `insertedBy`.

A written token with an empty value still uses the written leaf kind. Effective names for rules, instances, terminals and tests follow the engine's canonical spelling.

A named diagnostic has this form, for either an error or a warning:

```json
{"stage":"words","code":"y-cmavo","rule":"y-cmavo","span":[2,3],"source":[3,7],"message":"this word uses a y-final cmavo"}
```

The six shown members are required. An error can add `rejection` after `message`, as below. `code` is the diagnostic rule's effective name, and `rule` identifies that same rule. `message` is its evaluated message. A warning has no `feature` member.

`span` counts the stage's input tokens, and `source` counts original code points. A warning can have an empty span. An error reads at least one token, but its source can be empty. Spliced occurrences keep these fields at the call occurrence. Coordinates belong to the raising stage and never change during flow. Report order follows engine §12.1, including carried diagnostics and erasure.

The example warns for `ka'y` in `mi ka'y` in `lojban/cll`, with warning code `y-cmavo` enabled.

An error that is itself a ranked option can also carry default-rejection evidence for its competitors (engine §12.1). Plain alternatives, descendant errors, and spliced recoveries have no such member. A warning never has it. This example uses the run `bj` in corpus text `bjé`:

```json
{"stage":"forms","code":"junk-run","rule":"junk-run","span":[0,2],"source":[0,2],"message":"the run bj has no word reading","rejection":{"token":2,"source":[2,3],"line":1,"column":3,"expected":[{"terminal":"Hyphen","rules":["hyphen-misplaced"]},{"terminal":"Letter<Vowel>","rules":["vowel"]}]}}
```

The corpus identifier is `eberban.adhoc.precomposed-letter-is-space`. The letters stage represents `é` as one `Space` token, so `bj` remains junk. Neither letter breaks a fault-class restriction, and the missing vowel supplies no such class. The strict root reader reaches boundary 2, before `é`. Its live items expect `Hyphen` or `Letter<Vowel>` there. Fresh item entries at boundary 2 are outside this competitor slice.

The member order is `token`, `source`, `line`, `column`, `expected`. Positions and expected-terminal spelling follow the ordinary rejection rules below. The furthest boundary is capped at the error occurrence's end. Descendant items count at their own origins. No reachable competitor item means no member. Carried errors retain this evidence from their raising stage.

A reporting stage with counted errors gives this envelope:

```json
{"kind":"reported","stage":"syntax","errors":[{"stage":"syntax","code":"unmatched-fi","rule":"unmatched-fi","span":[0,1],"source":[0,2],"message":"fi has no open vi binding group"}],"message":"the chosen derivation reports errors"}
```

`errors` is nonempty and uses the collection order of engine §12.1. The envelope's `message` is a summary whose wording is free. It has no `token`, `source`, `line`, `column`, `expected`, or `readings`. Those coordinates can occur inside a diagnostic's `rejection` member.

The result has `ok:false` and keeps the chosen tree. The reporting stage retains `unique` or `resolved` and any completed publication, including an empty output array. Its errors can originate in earlier stages. The result's `warnings` holds the surviving warnings under the same collection rules.

An action in a witness is `{"read":{"token":4,"terminal":"KOhA"}}` or `{"close":{"rule":"sumti","production":57,"span":[2,5]}}`. The witness of an error of `elision-only` can also hold `{"elided":{"at":3,"terminal":"KU"}}`, a read of a terminator written back at that position (engine §7.10). The production is numbered from 0, as in engine §3. For a production of a helper, `rule` is the rule whose alternative introduced the helper.

An error has one of these forms:

```
{"kind":"rejected","stage":"syntax","token":4,"source":[12,15],"line":1,"column":13,
 "expected":[{"terminal":"KU","rules":["sumti"]},...],"errors":[ERROR...],"warnings":[WARNING...],"message":"..."}
{"kind":"ambiguous","stage":"syntax","reason":"tie","readings":[REF,REF],"errors":[ERROR...],"message":"..."}
{"kind":"ambiguous","stage":"syntax","reason":"elision-only","readings":[REF,REF],"witness":[ACTION,ACTION],"message":"..."}
```

If a conditional declaration holds for a feature that the caller disables, the result contains this error:

```text
{"kind":"feature-conflict","stage":"words","feature":"sa-su","errors":[ERROR...],"warnings":[WARNING...],"message":"..."}
```

The stage has a null verdict and no output. Earlier stages retain their output. The result has `ok:false` and `tree:null`.

A rejection can also name a failed boundary condition:

```text
{"kind":"rejected","stage":"syntax","token":4,"source":[12,15],"line":1,"column":13,
 "expected":[...],"boundary":{"rule":"bare-na","condition":1,"at":3},"errors":[ERROR...],"warnings":[WARNING...],"message":"..."}
```

Diagnostic arrays in error envelopes are optional. Empty arrays are absent. A `rejected` envelope orders members as `kind, stage, token, source, line, column, expected, boundary, errors, warnings, message`. It collects pending stage-level diagnostics, then input diagnostics through its furthest token, including that token. It has no stage output.

A `feature-conflict` envelope orders `kind`, `stage`, `feature`, `errors`, `warnings`, `message`. A `grammar` envelope orders `kind`, `stage`, `code`, `errors`, `warnings`, `message`, `chosen`, `completion`. Optional members retain these positions. Both collect the whole failed-stage input, without a rejection cutoff. A grammar failure after choice inserts evaluated own-stage messages outside erased subtrees before that carried list and after pending earlier stage-level diagnostics.

For these three envelopes, `warnings` equals the result's complete warning collection. A `reported` envelope has `kind`, `stage`, `errors`, `message`, with warnings only at result level. A tie envelope has `kind`, `stage`, `reason`, `readings`, optional `errors`, then `message`. An elision-only envelope has `kind`, `stage`, `reason`, `readings`, `witness`, `message`, with no `errors` member. Its warnings also remain at result level.

`boundary` appears only when a failed boundary obligation dropped an item at the reported position or later (engine §4.2). `rule` is the rule of the condition. `condition` is the index of the condition item among the rule's condition items, from 0. The count runs through the rule's definitions in source order, so an extension's items follow those of the rule it extends.

Guard atoms in statement and alternative bag terms follow their definition's written conditions and count toward indexes in later definitions. Each written guard atom takes its own index, in written order, with the header term first and then the term of each alternative. The atoms of an alternative that a gate drops still count.

`at` is the boundary where the obligation failed. Equal literals retain every source condition as an annotation, without changing record identity.

`kind` is one of these values:

- `rejected`: Recognition finds no complete derivation of the stage input.
- `reported`: The reporting stage has at least one counted error. The envelope contains `stage`, ordered `errors`, and a summary `message`, as above.
- `ambiguous` (engine §6, §7): The error has `stage`, `reason`, `readings` and `message`, and no position. A tie can also have the ordered `errors` above. Every ambiguous error has two qualified node references. `message` is free, and the shared tests do not compare it. `reason` says which of two cases the error is:
  - `tie`: The ranking of the stage has two or more best derivations (engine §6). The stage's verdict is `tie`, and it has no output. The readings are the first and the second reading of the tie, over the stage's input as the stage read it. They are two derivations, but they can be equal after following their references.

    The engine counts admitted derivations with the best blame measure. It collapses erased interiors with equal observable states (engine §6). Other transparent closes and equal trees do not merge derivations. The stage's witness then names the actions where they differ.

    Errors and result warnings come from the two shown readings only, after pending earlier stage-level diagnostics. Carried identities deduplicate across readings. Own-stage diagnostics use maximum multiplicity of each complete diagnostic object, including `rejection`, across the readings. The second reading adds only occurrences beyond the number already collected.
  - `elision-only`: If filtering excludes the restored chosen derivation, the check fails. Otherwise, its collapsed class must be the sole best admitted class of the written-back text. Engine §7.10 defines this decision. The stage's verdict is `unique` or `resolved`, and it keeps its output.

    The first reading represents W(D), the restored chosen derivation. An admitted reading shows its class's kept interior. An excluded W(D) remains the concrete raw restored reading. The second is its deterministic competitor (engine §7.10). This order also applies without ranked groups or key steps.

    The readings hold the written-back terminators as elided nodes (engine §7.10). One can be a restored optional's terminator. One can also be a terminator that a reading reads on the written route of an optional, or as a bare terminal. So the two readings can be equal after following their references, as a tie's can.

    The error also has `"witness":[ACTION,ACTION]` after its readings. It holds the actions at the first difference between the two derivations, visible if there is one, mapped to the stage's input (engine §7.10). Over that input, the two actions can be equal too. The stage itself has no witness.
- `feature-conflict`: A conditional declaration holds for a feature that the caller disables. The error has `stage`, `feature`, and `message`, without a position.
- `grammar`: The parser found a defect while parsing. The error has `stage` and no position. An example of such a defect is a nested parse asked about its own span as the same rule. An error that lowering finds for the features of the parse is one too (engine §3). A repetition with an item that can read no tokens is such an error. Its message begins with the document, line and column of the definition at fault, since the error's position members are for the stage's input.

  A defect found by the check of `elision-only` can have the member `code` with the value `elision-witness-lost` (engine §7.9). Such an error also has `chosen`, a qualified reference to the chosen tree. It has `completion`, the terminators written back.

  Each of them is `{"terminal":T,"at":N,"source":[S,S]}`. Only a terminator with a default value adds `"value":"..."` last, from `≝` or from an equality test, including an explicit empty string. The envelope follows the grammar member order above, including optional diagnostic arrays. Named diagnostics carry their rule codes inside a `reported` envelope. Other parse-result errors have no top-level `code`. Structured loading errors use the separate schema below.

For example, `%rule text [[X]]` on the empty input ties, and both reading roots have the same empty structure. The stage's witness names two different productions of the helpers. An `&` that can match no tokens, such as `[A] & [B]`, gives such a tie too, with three derivations.

A mistake of the caller is not a result. It is an error of kind `usage` (engine §13).

`line` and `column` count from 1, in code points. Lines end at `\n`, `\r\n` or `\r`. A position at the LF of a CRLF remains on the line that the pair ends. Its column counts the preceding CR.

At the end of a stage's input, a rejection has `token` equal to the number of input tokens. Its `source` is `[S,S]`. `S` is the source end of the last stage-input token, or 0 if there are no input tokens. Its `line` and `column` locate `S` in the original text. The original text can continue after `S` (engine §4, §12).

`expected` lists terminals in code point order. The library writes a tested terminal as the terminal followed by its test, as in `LE="la"`, and sorts it by that text. So `LE` comes before `LE="la"`, which comes before `LEhU`. Each terminal comes with the rules whose items can read it at that position, also in code point order. `message` is the description for people. Shared cases can pin an agreed reason with `expect.message` (`tests/README.md`).

Expected-terminal diagnostics use exact value tests and signed tag tests. Constants expand to resolved strings or requirements. Requirements sort by tag name in code point order. For one name, the positive requirement comes first. Duplicate requirements of one sign collapse.

The spelling writes the terminal, then `<`, then requirements separated by one ASCII space, then `>`. A value test follows when present. Other spaces appear only inside the resulting quoted string. Empty requirements spell `<>`. Canonical strings follow engine §9. A scalar of general category Cf requires an escape, as in `"‹ZWSP›"` (engine §1).

Examples are `KOhA<UI Word>`, `KOhA<¬UI>`, `LE≠"lo"`, `X<¬A B>`, and `X<A>="s"`.

### Loading errors

A grammar that fails to load produces an error alone, outside any parse result. Its kind is `grammar`. The error has `document`, `line`, and `column` where known. A tie in a notation stage has `document`, with no `line` or `column` (engine §8).

Every error raised while splicing a selected stage carries that stage, including include and stage-selector errors. Every stitching error carries `stage`. Missing resolution and start rule errors have no document or position.

An unreadable include with no source line reports the include directive's position. A positioned error keeps its location. Relocation preserves the other diagnostic fields.

Engine §2 specifies common stitching and classifier messages. Other wording stays library-specific unless this specification states otherwise.

Ranked loading errors have these members, in this order:

```text
kind, code, message, group, option, expression, inheritance
```

`kind` is `grammar`. `code` and `message` are required for the five ranked loading errors. Their codes are `ranked-choice-syntax`, `ranked-choice-continuation`, `ranked-choice-boundary`, `ranked-choice-export`, and `ranked-choice-tags` (engine §2.1). Message wording is not part of conformance.

`group` appears when the reader identifies a ranked group. Its members are `document`, `at`, `rule`, `alternative`, and `path`, in that order. If the document or position is unknown, omit its member. `at` identifies the first `≻` token where source exists.

`rule`, `alternative`, and `path` identify the final stitched source expression where available. `alternative` and `option` are zero-based indexes. Omit `option` for a failure common to the whole group.

`path` is a JSON Pointer relative to the alternative's `expr`. Ranked children use `/ranked/0`, `/ranked/1`, and subsequent indexes. Captures and tests continue through `expr`. Other components keep their names.

`expression` is the offending written expression as a DOM value where available. `inheritance` appears only for a tag error with a witness. It lists rule or helper sites from the group toward the tag source. Helper sites use written paths and the same source fields.

Choose the shortest inheritance witness. Source traversal order breaks equal-length choices. Keep loading diagnostics outside document DOMs, cache envelopes, and parse-result warnings. The API exposes these members, and CLI JSON serialization preserves their order.

### A grammar DOM

A document stores written declarations and unresolved references. It contains no chart state, constant index, computed interface, gate result or lowered helper. Text conversion, cache reading and supplied-DOM reading use the same constructors and errors. Use the member order below. Brackets in the field notation indicate arrays.

A question mark after a field marks an optional field. It is not part of the member name.

`P` means `[line,column]` in the source document. Each coordinate is an integer from 1 through 9007199254740991. A declaration’s location identifies its first token. Preserve argument and expression locations during substitution. Absent optional members have no JSON key.

A present null never stands for absence. The expression records below govern every expression operand, including those of structural comparisons.

### Source positions and nesting

Append a required one-based `at:P` to each body or pattern test, property read and method call. This includes a short map selector’s own property or method record. For value tests use the comparator token. For key filters use the opening angle bracket. For properties use the apostrophe. For methods use the dot, including a leading dot in a short selector.

Each error-owning expression operator record also ends with `at:P`. This includes Boolean operations, comparisons, bag and pattern operations, arithmetic, concatenation, conditionals, map and flatten. For expression records this rule covers `if,any,all,not,op,union,intersection,difference,concat,map,flatten`. Use the written operator token. Use the question mark for a conditional and the exclamation mark for a map.

A normalized n-ary record owns one operation: use its first combining operator in source order. Report errors in its operands at their own recorded sites. Keep existing positions on functions, constant references, applications, template parameters, entries and positioned atoms. Add no second position to a record that already carries the required one. [Expression records](#expression-records) gives the expression shapes.

For `$x!'value` at column one of line one, the portable record is:

```json
{"map":{"capture":"x"},"by":{"property":"value","at":[1,4]},"at":[1,3]}
```

For `r="a"` at the same starting column, the body record is:

```json
{"test":"=","value":{"string":"a"},"expr":{"ref":"r"},"at":[1,2]}
```

Preserve positions and their source documents through substitution. Report a failure caused by a substituted operand at the operand’s written site. Keep the requesting test or read as diagnostic context. Exclude all positions from normalized instance identity. Require identical diagnostics from text, optional caches and supplied DOMs.

In a template argument slot, every argument record ends with `at:P`. Keep an existing position on that record. Otherwise use the first token of the argument. For a marked argument, use the first token of the expression after `=`. This rule also applies to arguments of an instance edit or binding.

During substitution, retain the argument’s document and position. Report an error on the whole argument at that position. An error inside a positioned subexpression uses its own site. Keep the requesting operation as context. Positions add no logical depth and do not affect instance identity.

Depth counts compound ancestors, starting at zero for each root. Reject a node at depth greater than 256. Use the body, pattern and root rules in [Engine §9](engine.md#depth). A primary mark is transparent to depth. For each bag or list constructor, add one level before each guard, source or value expression.

Entry records, gates, key arrays, positions and category wrappers add none. An emission guard or term starts at zero.

A unary or binary operation adds one before each expression operand. So do a conditional, an n-ary operator, a property read, a method call, a function, an application, a map and flatten. A short map selector is transparent. Its argument expressions lie one level below the map. A full lambda under a map adds its own level.

Leaves add none. Count the normalized written DOM and substituted definitions at their existing validation steps. Measure logical nesting independently of the JSON container depth.

`E` in **every** record below denotes an expression from the expression records below. This includes bag terms, function bodies through their expression constructor, predicates, message strings, operands and constructors for braced items. [Expression records](#expression-records) specifies ordered entries with locations, gates, guards and deletion. A bag expression in a source document never serializes as a computed object from result 18.

| Record | Canonical fields |
|---|---|
| Document | `format:50,rules:[RULE],directives:[DIRECTIVE],constants:[CONST]` |
| Ordinary rule | `name,op,term?:E,alternatives:[ALT],emit?:EMIT,conditions:[E],error?:E,warning?:E,suppressWarnings?:[name],erased?:true,at:P` |
| Template | Ordinary rule fields with `params:[name]` immediately after `name`. |
| Exact instance edit | Ordinary rule fields with `args:[ARG]` immediately after `name`. |
| Instance binding | `name,op,instance:CALL,conditions:[],at:P` |
| Alternative | `gates:[GATE],expr:BODY,term?:E` |
| Constant definition or edit | `name,op,value:E,at:P` |
| Gate | `feature,kind:"gate",negated:boolean` |
| Stage selection | `name,args:[stageName],at:P` |
| Include or names resource | `name,args:[decodedPath],at:P` |
| Features | `name:"features",args:[featureName,…],at:P,conditions?:[E,…]` |
| Elision policy | `name:"elision-only",args:[],at:P` |
| Resolution policy | `name:"ambiguity-resolution",steps:[STEP,…],at:P` |
| Resolution step | `step,pattern?:PATTERN_OR_CONST` |
| Emission | `items:[ITEM]` |
| Forwarding item | `capture:name,gates:[GATE],guard?:E,at:P` |
| Braced item | `capture:name,term:E,gates:[GATE],guard?:E,at:P` |
| Insertion item | `insert:true,term:E,gates:[GATE],guard?:E,at:P` |

All three declaration arrays must exist. Each follows written order. Merge their declarations by source location for stitching. Rule operations are `define,redefine,extend`. Constants and bindings accept only `define,redefine`.

Instance edits accept only `extend,redefine`. The ordinary rule form also covers edits of a public instance name. Stage directive names are `stage,extend-stage,redefine-stage`. The path directives are `include,names`. A nonempty features condition array belongs only to a stage-local features declaration.

Preserve the preamble restriction on names resources.

A rule body requires at least one alternative. Its conditions array is required and can be empty. Statement and alternative terms must be bag constructors under the expression records below. To take all entries from a computed bag, write `→ {*$F($x)}`. Never attach the terms of a preceding definition to an extension.

Error and warning are mutually exclusive. A template cannot declare either. An erased rule cannot declare emission. A suppression list is nonempty. The wildcard code occupies a list by itself.

A template can carry suppression, which its instances inherit. A binding has no term, emission or diagnostic clauses.

A missing `emit` means no selection directive. Bare emission is `{"items":[]}`. A listed emission has a nonempty items array. A guarded list selecting no output at runtime remains a written nonempty array. Within an emission list, only a braced item can have an empty capture name.

It denotes the whole occurrence. Its term must be a bag constructor under the expression records below. Forwarding uses a nonempty capture name and no term. An insertion requires a constructor. No item can carry both origin selectors.

A braced item inherits its part’s strings without an extra DOM field.

The following stage grammar document has an empty public key mask and uses bare emission. Its input supplies the user key `Word`. The locations assume one declaration per line.

```json
{"format":50,"rules":[{"name":"text","op":"define","alternatives":[{"gates":[],"expr":{"primary":{"ref":"Word"}}}],"emit":{"items":[]},"conditions":[],"at":[3,1]}],"directives":[{"name":"ambiguity-resolution","steps":[{"step":"greedy"}],"at":[1,1]}],"constants":[{"name":"OUTPUTS","op":"define","value":{"bag":[]},"at":[2,1]}]}
```

A constant name omits its dollar sign. A template parameter omits its at sign. A call records `{call:name,args:[ARG,…],at:P}`. A parameter records `{param:name,at:P}`. Template parameter and argument arrays are nonempty.

Parameters must be distinct. Each argument takes exactly one form from the following table. Marked expression actuals use the expression records below and must be closed after substitution. The final position belongs to the argument record itself. Store the parsed category and ignore grouping that changes no category.

Reduce an unmarked grouped single symbol, including a parameter, to its symbol argument. Normalize a supplied single-symbol `body` wrapper before flow analysis, instance naming and position inspection.

| Argument | Record or payload |
|---|---|
| Marked expression actual | `{"expression":E,"at":P}` under the expression records below. The category wrapper adds no expression depth. |
| Named rule, call or parameter | `{rule:name,at:P}`, `CALL` or `PARAM` |
| Untested user terminal | `{tag:name,at:P}` |
| Untested string literal | `{literal:S,at:P}` |
| Range, wildcard, splice or tested symbol | The corresponding body record below with a final `at:P`. A tested symbol keeps its test position. |
| Body, targets or requirements | `{body:BODY,at:P}`, `{targets:[TARGET,TARGET,…],at:P}` or `{requirements:[REQ],at:P}` |
| Target inside a target choice | `{rule:name}`, `{terminal:name}`, `CALL` or `PARAM` |

For example, unmarked `@P` uses the parameter record. Marked `= @P` wraps it in `{"expression":E,"at":P}`. Both positions point to the at sign. In `split-y(= 0)` at column one, the wrapper points to column 11. Three more spaces before the zero move its position to column 14.

A body record has exactly one of these forms. `S` is a string literal expression, string constant reference or declared parameter, encoded under the expression records below. It must resolve to a string. The body reader calls its single-symbol nonterminal `factor`.

```text
{seq:[BODY,BODY,…]}       {choice:[BODY,BODY,…]}
{ranked:[BODY,BODY,…]}    {and:[BODY,BODY,…]}
{optional:BODY}           {optional:BODY,elidable:true,default?:S}
{repeat:BODY,separator?:BODY,chain?:"left"|"right"}
{ref:name}                {literal:S}              {range:[S,S]}
{wildcard:true}           {empty:true}             {remainder:true}
{splice:TARGET_RULE}      {capture:name,expr:SYMBOL}
{primary:SYMBOL_OR_CAPTURE}                         CALL | PARAM
{test:"tags",requirements:[REQ],expr:SYMBOL_BASE,at:P}
{test:"="|"≠",value:S,expr:SYMBOL_OR_TAG_TEST,at:P}
```

Body records hold no resolved token classes or generated helpers. A `seq` keeps its order and nesting. An ordered subset keeps its written positions and permits at most sixteen operands. The optional's `elidable` member occurs only as `true`. A `splice` holds a rule reference or exact call.

The source mark before a captured symbol wraps the whole capture. `primary` never changes the terminal identity or action count. A base symbol (`SYMBOL_BASE`) is a reference, call, splice, literal, wildcard, range or declared symbol parameter. A filter accepts a base symbol. A value test accepts a base symbol or one with a key filter (`SYMBOL_OR_TAG_TEST`).

A capture accepts any of these symbol forms (`SYMBOL`). A group, optional, repetition or empty expression cannot take a label.

A primary accepts a legal symbol or its capture (`SYMBOL_OR_CAPTURE`). It follows the route and placement rules in [Rule bags](notation.md#rule-bags). The parser wraps tests around the whole splice record. Inside `splice`, `TARGET_RULE` is exactly one rule reference or call. For a terminator binder, put the capture inside the elidable optional.

A sole-symbol copy requires no serialized mark. An elidable head must resolve to a user terminal. Its default belongs to the optional. A chain occupies the entire alternative. A remainder occurs only in a query target.

A sequence, choice, ranked group and ordered subset each require at least two operands. A filter precedes a value test.

A requirement is `{negated:boolean,value:operand}`. The operand is a terminal name atom, key-set constant or parameter. Use the name atom `{"tag":"T"}` in this slot. Encode other operands as expression records. In this slot alone, `{"tag":"_Elided"}` denotes an origin test.

It is never a bag expression. The same requirement record applies to a pattern atom. The requirement tests name presence or the specified origin.

### Expression records

| Production or case in the [expression grammar](engine.md#expression-grammar) | Canonical record |
|---|---|
| `expr`, implication | `{"if":E,"then":R,"at":P}`. A single operand uses its own record. |
| `function` | `{"lambda":N,"body":E,"at":P}`. The name omits its dollar sign. The position points to the binder. |
| `disj`, `conj` | `{"any":[E,R],"at":P}` or `{"all":[E,R],"at":P}`. A run can have more than two operands. A single operand needs no wrapper. |
| `neg` | `{"not":E,"at":P}` |
| `comparison` | `{"op":S,"left":E,"right":R,"at":P}` with the comparator spelling of the expression grammar. For `≅` and `≇`, `left` must be `{"capture":N}` or `{"item":true}`. |
| `union` | `{"union":[E,R],"at":P}` or `{"difference":[E,R],"at":P}`. Difference always takes two operands. |
| `inter` | `{"intersection":[E,R],"at":P}`. Preserve the nesting of binary operations before type resolution. |
| `sum` | `{"concat":[E,R],"at":P}` for strings, `{"op":"+","left":E,"right":R,"at":P}` for numbers. |
| `post` | Apply successive records from the left. Flatten uses `{"flatten":E,"at":P}`. |
| `prop` | `{"property":N,"receiver":E,"at":P}`. Store only the final key in this record. |
| `method`, `selector` | `{"method":N,"receiver":E,"args":[…],"at":P}`. Always include the array. The signature determines the printed parentheses. |
| `arguments` | An ordered array of the records in the argument table below. |
| `map` | `{"map":E,"by":F,"at":P}`. F is a short selector, a function record or a reference to a unary function. |
| Short `prop` or `method` after `!` | In `by` use `{"property":N,"at":P}` or `{"method":N,"args":[…],"at":P}`. The mapped element supplies the receiver. |
| `predicate` | Use the function record or the ordinary reference record. A reference introduces no lambda. |
| `implicit` | `{"lambda":"","body":E,"at":P}`. P points to the first argument token, including a leading negation. |
| `atom`, capture or binder reference | `{"capture":N}`. An empty name denotes bare `$`. Resolve a nonempty name in its lexical scope. |
| Constant or call | `{"const":N,"at":P}` or `{"apply":N,"arg":E,"at":P}`. P points to the dollar sign. |
| Template parameter | `{"param":N,"at":P}`. P points to the at sign. |
| String or natural | `{"string":S}` or `{"integer":S}`. Store canonical ASCII digits as a string. A literal inside a marked wrapper keeps this leaf form. |
| Pattern or empty pattern | `{"pattern":PATTERN}` or `{"emptySet":true}`. Use the structural pattern records below. |
| Implicit receiver | `{"item":true}`. It denotes the bound item itself and supplies the receiver of a leading property or method. |
| Group or conditional | Grouping uses E directly. The conditional is `{"if":E,"then":R,"else":E2,"at":P}`. |
| `bag` | `{"bag":[ENTRY,…]}`. The array can be empty. |
| `list` | `{"list":[ITEM,…]}`. The array can be empty. |

Print a property of the implicit item as `'key`, with one apostrophe. A named copy from that item has the same spelling in its entry.

In `$r.all(' ≇ #·CAI)`, each item of `$r` must bind one node. The comparison reads `{"item":true}` on the left. The splice and self-comparison restrictions of [the structural comparison rules](notation.md#comparing-two-constituents) still apply.

A normalized operator array represents one operation. Its final `at` locates the first combining operator in source order. A failure inside a positioned operand uses that operand’s own location.

Flatten nested unions and concatenations in order, without removing duplicate or empty operands. The reader groups one uninterrupted conjunction or disjunction in one array. Preserve nested Boolean groups. Each operator array has at least two operands.

A leading Boolean operator used for layout adds no operand or position to a run. A typed pattern intersection uses the pattern normalization for instance keys. Retain other binary nesting, including the left operand of a second difference.

### Entries and host records

Every bag entry and list item has a kind, a gates array, an optional guard and a position. The kind selects its payload fields. The fields of each record appear in the order shown below. T denotes the common suffix `"gates":[G,…],"guard":E,"at":P`. If the entry has no guard, omit that member. The position points to the first token of the whole entry, including its prefix.

| Production or case in the [expression grammar](engine.md#expression-grammar) | Canonical record |
|---|---|
| `entry`, bare key | `{"kind":"bare","key":N,T}` |
| `entry`, one or several valued names | `{"kind":"write","keys":[N,…],"value":E,T}`. Require at least one name. |
| `copy`, also as an entry | `{"kind":"copy","source":R,"key":N,T}`. R stops before the final selector. Each intermediate read has its own apostrophe position. The final key belongs to the copy entry. Use the entry position for errors of the copy itself. |
| `entry`, splat or deletion | `{"kind":"splat","value":E,T}` or `{"kind":"delete","key":N,T}`. |
| `prefix` | The gates and guard of the containing record. No standalone expression wraps the entry. |
| `gate` | `{"feature":N,"kind":"gate","negated":B}`. B is a JSON Boolean. |
| `item` | `{"kind":"item","value":E,T}` or `{"kind":"splat","value":E,T}`. |
| `actual`, marked expression | `{"expression":E,"at":P}`. The wrapper adds no depth. |
| `actual`, other categories | Use the requirements, targets, body or symbol argument record of the document records above with its final `at:P`. |
| `emit` | `{"items":[O,…]}`. Bare `%emit` has an empty array. An absent directive has no record. |
| `output`, forwarding | `{"capture":N,T}` with a nonempty name. |
| `output`, braced item | `{"capture":N,"term":E,T}`. An empty capture name denotes the rule. E must be a bag constructor. |
| `output`, insertion | `{"insert":true,"term":E,T}`. E must be a bag constructor. |

| Method argument kind | Element in `args` |
|---|---|
| Ordinary operand, predicate, numeric cap | E. Predicates also accept ordinary function references. A cap uses the integer record. |
| Literal key in `.has` or `.has-value` | `{"key":N}` |
| Width in `.ngrams` | `{"integer":S}` with the positive digits of the notation. |
| Query | One `{"body":BODY}` with its outer remainder nodes. |
| Close family | One `{"rule":N}`, template call or unresolved rule parameter. |
| Neighbor targets | The target records directly in the array, in source order. A target choice can contribute several elements. |

In `split-y(= 0)` at the start of line one, the argument is `{"expression":{"integer":"0"},"at":[1,11]}`. Three more spaces before the zero move the wrapper position to `[1,14]`.

The marked argument retains its category even for one parameter. In a template, `= @P` wraps the parameter record in `expression`. An unmarked `@P` passes its category through. Substitution keeps the written wrapper and its scope. The canonical printer adds `= ` only for the expression category. Locations do not enter the instance key.

In this constructor, `cbm` is a feature. The key `note` of node `$w` can be absent, bare or valued. If the key has a payload, copy it. Each character counts as one source column.

```text
{
  cbm? $w.has-value(note)? $w'note,
  ¬image
}
```

```json
{"bag":[
  {"kind":"copy","source":{"capture":"w"},"key":"note","gates":[{"feature":"cbm","kind":"gate","negated":false}],"guard":{"method":"has-value","receiver":{"capture":"w"},"args":[{"key":"note"}],"at":[2,10]},"at":[2,3]},
  {"kind":"delete","key":"image","gates":[],"at":[3,3]}
]}
```

Apply the same grammar, scope, type and phase rules to each DOM. An implicit-function record is legal only in a predicate slot and must express a body with the permitted initial receiver. For an implicit function, apply the first-token restriction before discarding source parentheses. For a supplied DOM, require an equivalent legal ungrouped source spelling.

For `$xs.any($MARKED)`, store the constant reference directly in the method's argument array. For `$xs!($MARKED)`, store that reference directly in `by`. The reference points at its dollar sign. For `$xs!'note` at column one of line one, the map has `at:[1,4]`. Its short property selector has `at:[1,5]`.

A short selector is legal only in `by`. Reject a value field on a deletion, missing entry positions and repeated direct keys under [Constructors](notation.md#constructors). The reader preserves gates, guards and skipped entries until evaluation.

### Expression depth

Start each expression root at depth zero, including an emission guard or term. Reject any node with more than 256 compound ancestors. Count the normalized written DOM and check substituted definitions again. Text, cache and supplied DOM use the same count. Apply the [engine's depth rules](engine.md#depth) to pattern operands and query bodies.

A bag or list adds one level before each guard, source and value. Entries, gates, key arrays, positions, argument wrappers and grouping add no level. Siblings share one depth. Each conditional or operator adds one level before each operand. A property read, method, function, application, map or flatten adds one before each expression operand. Leaves add none.

A short map selector adds no level of its own. Its argument expressions start one level below the map. A full lambda after a map adds another level before its body. A reference in `by` is a leaf. Thus 256 nested singleton lists around a string fit at a root.

The 257th list puts the string beyond the limit. A guard under the innermost list uses the same depth as that list's item value.

### Pattern values

A pattern tests one structural tree. An item consumes part of an ordered sibling list. The expression wrapper is `{"pattern":PATTERN}`.

Node decorations are exact prefixes, tests, or child lists. Observable nodes are rule nodes and terminal leaves. Terminal leaves can be written or omitted. Seals are not observable nodes.

An undecorated node test has one of these forms:

```text
{"name":"sumti","at":[line,column]}
{"call":"pair","args":[ARG,ARG...],"at":[line,column]}
{"param":"Left","at":[line,column]}
{"terminal":"KEhE","at":[line,column]}
{"literal":PATTERNSTRING,"at":[line,column]}
{"range":[STRINGTERM,STRINGTERM],"at":[line,column]}
{"wildcard":true,"at":[line,column]}
{"constant":"LETTER","at":[line,column]}
{"test":"tags","requirements":[REQUIREMENT...],"expr":TERMINALATOM,"at":P}
{"test":"tags","requirements":[REQUIREMENT...],"expr":RULEATOM,"at":P}
{"test":"=","value":STRINGTERM,"expr":TESTTARGET,"at":P}
{"test":"≠","value":STRINGTERM,"expr":TESTTARGET,"at":P}
```

TERMINALATOM is an undecorated `terminal`, `literal`, `range`, `wildcard`, or string-valued `constant`. Before substitution, it can also be a declared `param` that must become a terminal atom. RULEATOM is an undecorated `name`, `call`, or a `param` that must become one. TESTTARGET is TERMINALATOM or RULEATOM, or exactly one tag test on either. The source order is tag then value. These inner objects carry no `exact` or `children` fields.

A rule test reads the rule's working keys. A rule value test reads its certified value. A tested rule atom cannot carry `children`.

Every test takes an atom, so no test object stands alone. In a pattern, the `_Elided` requirement tests leaf origin. A rule atom can carry only the negated origin requirement. A wildcard tests leaf origin. Reject a positive origin requirement on a rule atom at the mark.

A node test can add `"exact":true`, then `"children":[ITEM...]` where permitted below. If the object has an `at` member, that member follows both additions. This order also applies to calls and parameters before expansion. Both additions are optional.

`exact` occurs only as true and suppresses the search for that node alone. `children` always records the written brackets, including an empty or one-item array. Its absence imposes no child constraint.

Only `name`, `call`, and compatible `param` node tests accept `children`. A terminal, `wildcard`, tested atom, or string-valued `constant` cannot carry that member. Every node-test form can carry `exact:true`. On a tested atom, the exact prefix belongs to the outermost test object, never its inner `expr`.

A bare child list has exactly this form, with optional `exact` before `children`:

```text
{"any":true,"children":[ITEM...]}
{"any":true,"exact":true,"children":[ITEM...]}
```

`any` requires `children`. It denotes an observable node, without a name or terminal test. It never matches a seal. `_` instead uses `wildcard`, which matches any written or omitted leaf, whatever terminal read it.

PATTERN is a node test, a bare child list, or one of these compound forms:

```text
{"union":[PATTERN,PATTERN...],"at":P}
{"intersection":[PATTERN,PATTERN...],"at":P}
{"difference":[PATTERN,PATTERN],"at":P}
{"path":"descendant","pattern":PATTERN}
{"path":"first","pattern":PATTERN}
{"path":"last","pattern":PATTERN}
```

An undecorated `constant` can instead denote a whole pattern. An undecorated `param` can substitute one whole pattern. A compound form cannot carry `exact`, `children` or tests. Set operations require `at`. A pattern-valued constant cannot carry node decorations or terminal tests. A parameter with `children` must become a rule test or call without existing children.

ITEM has exactly one of these shapes:

```text
{"child":PATTERN}
{"siblings":true}
{"optional":[ITEM,ITEM...]}
{"repeat":[ITEM,ITEM...]}
{"repeat":[ITEM,ITEM...],"separator":[ITEM,ITEM...]}
{"choice":[[ITEM,ITEM...],[ITEM,ITEM...]...]}
```

Here `[ITEM,ITEM...]` means one or more items. A choice requires at least two nonempty alternative arrays. No alternative consists only of another `choice` item. The reader flattens such alternatives in written order. Other choices retain their sequence position and nesting. Plain groups concatenate item arrays and make no wrapper.

Only a `children` array, on a node test or bare list, can be empty among the child arrays. Item objects cannot be arrays. There is no `sequence` or `node` wrapper.

An `optional` object has only `optional`. Only `repeat` accepts `separator`, and it must also contain `repeat`. Sibling items contain exactly `siblings:true`. No item has `at` or pattern fields beside its designated member.

A repeat body must have a way to consume a child. Its separator can accept an empty sequence but must contain written items. Neither array permits a sibling gap at its own level, including inside optional, choice, or nested repeat items. A gap inside a `child` pattern's own child list remains valid. That list describes another sibling level.

These restrictions apply before substitution. An unresolved parameter does not excuse a malformed wrapper, forbidden field, invalid arity, or gap. After substitution, the same restrictions apply to the expanded pattern. Stage resolution also enforces terminal types, consuming repeats, and name binding.

Each `child` pattern can mix resolved fragments with unresolved parameters. Readers keep the item context throughout the traversal. `#⁅ A @X ⁆`, `#⁅ @X A ⁆`, and `#⁅ ⋯ @X ⁆` are valid unresolved forms. `#⁅ [A] @X ⁆` is valid too. Their closed fragments never become independent root patterns during shape inspection.

These item shapes are malformed even inside an unresolved pattern:

```text
{"optional":[{"child":{"param":"X","at":[1,1]}}],"separator":[{"child":{"terminal":"A","at":[1,1]}}]}
{"repeat":[{"optional":[{"siblings":true}]},{"child":{"param":"X","at":[1,1]}}]}
{"repeat":[{"child":{"param":"X","at":[1,1]}}],"separator":[{"siblings":true}]}
```

The first object gives an optional a forbidden separator. The second hides a gap in a repeat's optional item. The third puts a gap in the separator. A parameter cannot make any of these shapes valid.

By contrast, `#⁅ {⁅ ⋯ ⁆ @X} ⁆` has a valid shape. Each repeated pair has a child matching the bare list, then one child matching X. The inner gap belongs to the bare list. It never consumes siblings at the repeat's level.

A capitalized or engine tag becomes `terminal`, including KEhE, GIhI, NUhI, and `_General_Category_Uppercase_Letter`. Strings use `literal`, ranges use `range`, and `_` uses `wildcard`. Other names, including emoji names, use `name`. A name must read back as a rule name under the loaded Unicode table. A name that instead reads as a terminal is malformed.

A bare template name tests its family. A call tests one instance. String-valued user constants use `constant` until binding through engine §2. Pattern-valued constants denote their whole predicate. Binding does not change the cached DOM.

PATTERNSTRING is exactly a decoded `string` term. A user constant never occupies this position. It uses `constant` instead. A parameter node uses `param`, without a `literal` wrapper. Range endpoints and test operands retain their ordinary STRINGTERM rules, including user constants and declared parameters.

A string atom records the source position of its opening quote. `#"‹U+0061›"` has this complete DOM:

```json
{"pattern":{"literal":{"string":"a"},"at":[1,2]}}
```

The node test `#·a⁅ b ⁆` has this complete DOM:

```json
{"pattern":{"name":"a","exact":true,"children":[{"child":{"name":"b","at":[1,6]}}],"at":[1,3]}}
```

The following examples omit source positions to show the boundaries:

```text
#a              {"pattern":{"name":"a"}}
#⁅ a ⁆          {"pattern":{"any":true,"children":[{"child":{"name":"a"}}]}}
#·⁅⁆            {"pattern":{"any":true,"exact":true,"children":[]}}
#⁅ A ⁅ B C ⁆ ⁆  {"pattern":{"any":true,"children":[{"child":{"terminal":"A"}},{"child":{"any":true,"children":[{"child":{"terminal":"B"}},{"child":{"terminal":"C"}}]}}]}}
```

Union and intersection require at least two operands. They flatten direct operands of their own kind in written order. Difference keeps two operands. Each of these operations ends with `at` at its first combining operator.

After substitution the loader flattens a pattern intersection that substitution nests inside another intersection. This step precedes expanded-pattern validation. Supplied or cached records cannot contain a nested pattern intersection.

Unknown fields and overlapping constructors are malformed. Structural comparison uses the expression records above. The left operand can be a capture or the current function item. The right operand must resolve to a pattern or one bound node.

### Ranked expressions

A ranked expression is `{"ranked":[EXPR,EXPR...]}`. Its array has at least two ordinary expressions and preserves source order. A nested ranked expression retains its own boundary. Ordinary alternatives within one option use `choice`.

For example, `mex MOI 🆓 ≻ SE 🆓 tanru-unit-1` produces this expression:

```json
{"ranked":[{"seq":[{"ref":"mex"},{"ref":"MOI"},{"ref":"🆓"}]},{"seq":[{"ref":"SE"},{"ref":"🆓"},{"ref":"tanru-unit-1"}]}]}
```

Neighbor guards use the `guard` field of a bag entry. The DOM keeps the written guard and never stores lowered variants.

The DOM holds no lowered helper, admission key, [seal](notation.md#the-structural-tree), or selected option. References retain their written form before terminal resolution. Expression traversal includes `ranked` alongside other expression forms.

### Preparsed DOMs

The names dependency of a cached document is a resource map. If source conversion loads no names data, the entry omits `names`.

`data/preparsed/FAMILY.json` holds the DOMs of all grammar documents under `grammars/FAMILY/`. `tools/sync.js` generates each file and copies it into every package. Its shape is `{"format":50,"bootstrap":HASH,"unicode":HASH,"properties":HASH_OR_NULL,"bundledNames":{RESOURCE:HASH},"documents":{PATH:{"hash":HASH,"names":{RESOURCE:HASH},"dom":DOM}}}`. `PATH` is relative to the package root, including the `grammars/` prefix. Each `HASH` is the FNV-1a hash of engine §8. `unicode` hashes the text of `data/unicode/unicode.txt`.

The required `gencmu.json` omits the `bootstrap` header member. The hash of its complete text supplies that fingerprint for every other family. The notation reader uses its required entries without checking their source text hashes. Ordinary cache lookups still compare all other applicable identity members. Each document key selects its own family's preparsed file (engine §8), besides the required `gencmu.json`.

Missing, malformed or obsolete optional files give cache misses. An invalid record in a selected current document gives the same error as a supplied DOM.

JSON integers have no leading zero except `0` and `-0`. A `\u` escape holds exactly four ASCII hexadecimal digits.

For an ordinary entry, a library compares format, bootstrap fingerprint, core-table hash, properties fingerprint, and document hash. The bootstrap file supplies its own fingerprint implicitly. `properties` hashes the complete properties-file text. If a custom core has no companion, the fingerprint is `null`. Even for documents naming no additional property, the member is mandatory. A custom properties file causes unavoidable cache misses against bundled entries with a different fingerprint.

`bundledNames` records the bundled standard names file and every bundled extra, with normalized paths in code-point order. Each value hashes the pinned resource text. Caller replacements never change this registry. Present resource keys require full comparison even if the supplied text matches a registered hash. Absent keys can use the registry even in a portable map.

A missing or malformed registry disables the shortcut in engine §8.

If source conversion loads names data, the cache writer records `names` after `hash`. This nonempty map contains the standard file and every selected extra. Its keys are normalized resolved resource paths in code-point order. Each value hashes that file's text with FNV-1a. Core abbreviations require no names dependency. When `names` is present, the loader compares paths and hashes for `data/unicode/unicode-names.txt` plus the current inherited and local extras (engine §8).

On a hash-matched, valid entry, the loader trusts this member without scanning source tokens. If the member is present, all selected paths and fingerprints must match it. Unoverridden bundled resources use `bundledNames` without reading, parsing, or fetching names files. Any override or missing registry entry requires loading and inspecting the complete selected set. The reference file serves inspection only and never enters the dependency map.

If the member is absent, the loader skips names-path and names-hash comparisons and loads no names data for that entry. The otherwise valid entry remains a hit, even when declared or inherited extras change. Those declarations still apply to nested includes. Engine §8 defines loading errors and cache misses.

A preparsed DOM stores written declarations. Stitching and invocation-specific specialization compute constants, masks, types and classifier indexes.

## Renderings

The renderings are for people. The CLI and the playground implement all three renderings. Every library implements brackets, and the corpus tests compare brackets. Every rendering shows a token by its image.

A token node displays the stored face of the stage-input token. An opaque face shows one image. A decorated face shows its ordered parts and primary index. The containing face replaces the core image along its primary path once.

Renderers use the kept derivation, including the chosen interior of each erased occurrence. Named diagnostics use their raising-stage names, messages, and source excerpts. They retain their collection order and competitor evidence.

A hollow rule node, such as an empty slot for a free modifier, has no token and no elided node below it. No rendering shows a hollow rule node. Brackets drop it as an empty node, and the tree and the display JSON leave it out. But the tree and the display JSON always show the root. So the tree renders a hollow tree, such as that of the empty text, as the rule name of the root alone. The display JSON renders it as `{"text": []}`, and brackets render it as nothing.

### Brackets

Brackets write the final stage's tree as nested groups. Tree patterns do not change that grouping. The renderer first decides whether to show elided terminators, then applies these rules:
1. Render each token through its face. An opaque face renders as one image, even when the image is empty. A decorated face groups the rendered parts in order.
2. Render an elided node as its lowercased terminal between `⟨` and `⟩` when elisions are visible. Otherwise drop that node.
3. Render the children of each rule. Drop children that produce no group or leaf. Render a single remaining child directly. Render several children as a group.

   If no child is left, the node is empty.
4. The depth *d* of a group counts groups only: a child group of a group at depth *d* is at *d*+1. A group is written between `(` `)` when *d* mod 3 is 0, `[` `]` when 1, and `{` `}` when 2. One space separates its members.

In the `lojban/cll` pipeline, `lo mlatu cu citka le finpe` is `([lo mlatu] cu [citka {le finpe}])`, `mi ui klama` is `([mi ui] klama)`, `ba'e mi klama` is `([ba'e mi] klama)`, and `mi ui nai klama` is `([mi {ui nai}] klama)`.

### Tree

The originating core table is the Unicode table used for that parse (engine §1). The renderer uses it for quoted images and abbreviations. The result retains that immutable context privately, beyond the pipeline's lifetime. Canonical JSON omits this context. Without an originating context, tree rendering reports a usage error instead of selecting bundled or ambient data. Printing never needs the lazy names file.

The tree has one node per line, and children are indented two spaces under their parent. Each kind of node is written as follows:

- A rule node gives its name. If its only descendants are token nodes on one source line, append ` · ` and the source text. If a face has satellites or a displayed image contains a line break, omit the excerpt.
- A token node gives its terminal and quoted image. The renderer uses the canonical string escapes of engine §9.1. For example, a line feed is `‹LF›`.
- Print satellite lines after the primary line, with the before group first. Indent each satellite two spaces below its primary. Prefix satellites before the primary with `◂ `. Prefix satellites after it with `▸ `. A class key starts and ends with an uppercase ASCII letter. Join the classes in Unicode scalar order with ` ∪ `, then add a space and the quoted image. If a satellite has no classes, print its quoted image alone. Apply the same rules to nested satellites.
- An elided node gives its terminal in angle brackets.

The tree renderer joins a chain of rule nodes with one child on one line, using ` › `.

### Display JSON

A hollow rule has no token or elided descendant. Brackets omit it. Tree listings and display JSON omit it except at the root. A hollow root named `text` renders as `text` in a tree listing and `{"text":[]}` in display JSON.

The display JSON is the tree projected for reading, and it is not the canonical form. A rule node is an object with one member, its rule name. If the node has one child, the value of this member is the projection of that child. Otherwise, the value is the array of the projections of its children. A token node is `{"TERMINAL":"image"}`, and an elided node is `{"TERMINAL":null}`.

A decorated token uses an ordered `parts` array and its `primaryIndex`. The parts display their stored classes and images. The display projection follows faces, while canonical JSON preserves their qualified references.

The display JSON is pretty-printed so that nesting costs no indentation where nothing is gained:

- A scalar is written as JSON.
- An empty array is `[]`. A non-empty array is `[`, a newline, each item, a newline, and `]` at the indentation of the array. Each item is indented two more spaces than the array. A comma follows each item except the last.
- An object with one member is `{"name": ` followed by the value, then `}`. The value is written at the same indentation as the object. So `{"a": {"b": {"c": "x"}}}` stays on one line, and a long chain adds no indentation.
- An object with several members is written like an array, as `"key": value` lines between `{` and `}`.
