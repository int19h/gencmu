# Output formats

This document describes what a gencmu library returns, as data and as text. The shared tests compare the canonical JSON as parsed JSON values. So two libraries agree when their outputs parse to equal values. The renderings are for people to read.

Grammar names, tags, features, and texts below are examples that illustrate the output forms. Grammar documents define their pipeline behavior.

JSON member names are case-sensitive. Names that differ in case are distinct members. If an exact name repeats, the last value replaces the earlier value. Escapes that decode to the same name identify the same member. Each schema decides whether it accepts unknown members. An accepted unknown member cannot overwrite a member with a different name.

## Canonical JSON

Canonical JSON is UTF-8 JSON with integers only. An integer member has no fraction or exponent in its JSON spelling. A library leaves out an optional member that is absent. It never writes `null` for it, unless this document says otherwise. Every library writes canonical JSON with its own code, because the Rust standard library has no JSON writer.

Serialization applies the witness gates even to caller-built results. An error witness requires both kind `ambiguous` and reason `elision-only`.

Single-guillemet escapes belong to notation strings printed in names and diagnostics. JSON serialization still preserves the actual member values with ordinary JSON quoting. A notation string inside a JSON member therefore has both its notation spelling and the surrounding JSON string encoding.

Libraries write object keys in the order that this document gives. They write no whitespace outside strings, and they write non-ASCII characters as themselves. This makes outputs easy to compare by eye. But conformance is equality of the parsed values.

General-category tags use long names in token tags, node tags, terminals, expected lists, witnesses, and canonical call names. Compact and short inputs never survive as category spellings in these fields.

### A parse result

```
{"format":17,"ok":true,"stages":[STAGE...],"tree":NODE,"error":ERROR,"warnings":[WARNING...]}
```

`format` is the version of the result shape, 17. `tree` is the chosen tree of the last stage, or `null`. In every error result except `reported`, `tree` is null, including failures after choice during message evaluation, emission, or the elision-only check.

A `reported` result retains the chosen tree. With `ok:true`, `error` is `null`. With no parse warning, `warnings` is absent (engine §12, §13).

The recipe language has no message that can fail. Engine §12.1 defines the guard for a failure.

A stage has one of these forms:

```
{"name":"words","verdict":"resolved","output":[TOKEN...]}
{"name":"forms","verdict":"unique","output":[],"errors":[ERROR...],"warnings":[WARNING...]}
{"name":"syntax","verdict":"tie","witness":[ACTION,ACTION]}
```

`verdict` is `unique`, `resolved`, `tie`, or `null`. A rejection or error before ranking completes gives `null`, including an error during recognition ([engine §6](engine.md#6-choosing-a-parse), [§13](engine.md#13-the-pipeline)). `witness` is present only for a `tie`. It is the pair of actions at the first visible difference between the two readings of the tie (engine §6). The action of the first reading comes first.

If there is no visible difference, it is the pair at their first difference. That is the first pair of differing actions of the whole sequences, transparent ones included. A derivation whose visible sequence is a proper prefix of the other's differs from it where the shorter ends.

The readings themselves are in the result's error (below), and the stage holds no tree of them. The canonical order *T* of engine §6 orders the ambiguity diagnostics. The canonical tie-break keys never turn a tie into an accepted reading.

`output` is the emitted tokens of a stage whose verdict is `unique` or `resolved`, the last stage included. It is absent for a rejection or any failure before ranking completes, including recognition errors, feature conflicts, and feature-condition runtime errors. It is absent for a tie, since a tied stage emits nothing (engine §6, §11). A `reported` result keeps that output.

A runtime grammar error during check or message evaluation prevents output. Emission failure prevents output (engine §11). It is also absent where the check of `elision-only` meets an error of the grammar or loses its witness (engine §7.7, §7.9).

Stage members stand in the order `name`, `verdict`, `witness`, `output`, `errors`, `warnings`. Empty stage-level diagnostic lists are absent. They retain diagnostics that have no carrier because a completed emission yields an empty output array. Lists on emitted tokens instead carry diagnostics forward. An earlier stage with errors and nonempty output does not stop the pipeline. Engine §12.1 defines the reporting stage and every ending's collection.

A token has this form. This one is the token of `mi` that the forms stage of the `lojban/cll` pipeline emits:

```
{"text":"mi","value":"mi","image":"mi","tags":["Cmavo","Continued","KOhA","Onset","Run-Final","Run-Initial","Word"],"span":[0,2],"source":[0,2]}
```

`tags` lists each stored identifier tag once in code-point order. For stored engine tags, output uses their canonical names. Even without explicit grammar references, stage-zero profiles include every available property. Examples include `_Alphabetic`, `_Script_Latin`, `_Emoji_Presentation`, `_Emoji_Component`, and multiple Script_Extensions tags. ASCII digits, `#`, and `*` can carry `_Emoji_Component`. Later filtering removes memberships without regenerating them.

`value` is always present and can be empty. Tags never determine either string.

Output uses the long canonical names of engine §1, including every atomic and major general category. Caller tags accept aliases and normalize before set construction. Supplied DOMs require canonical names. Both inputs require support for each named property and value.

Binary No supplies no tag. An enumerated default supplies its value tag. Script_Extensions supplies one tag per member.

`image` always exists and can be empty or contain line breaks. It can include adjacent text outside the token's source interval. `text` remains the original source interval and never expands through an image recipe.

For a precomposed character, each stage-zero token keeps the original source and text. Its value is one decomposed scalar.

`insertedBy` follows `source` for an `ε` emission item. It names its inserting rule. The token has empty span, source, and text. Its strings come from its item recipes. A covering item over an empty constituent does not acquire `insertedBy`.

`before` and `after` follow `insertedBy` for a token with attachments (engine §11). Each is an array of tokens in this form, and each is present only when it is not empty. An attached token has no `span`, so its object leaves it out. This is the token of `mi ui` that the indicators stage of the `lojban/cll` pipeline emits:

```
{"text":"mi","value":"mi","image":"mi","tags":["Cmavo","Continued","KOhA","Onset","Run-Final","Run-Initial","Word"],
 "span":[0,1],"source":[0,2],
 "after":[{"text":"ui","value":"ui","image":"ui","tags":["Cmavo","Continued","Indicator","Run-Final","Run-Initial","UI","Word"],"source":[3,5]}]}
```

A token's nonempty `errors` and `warnings` arrays follow its attachment members, in that order. Their entries use the named diagnostic form below. Empty arrays are omitted. The full order is `text, value, image, tags, span, source, insertedBy, before, after, errors, warnings`.

An attached token can display diagnostics, but its ordinary carrier also holds them for counting and flow. The display copy contributes no additional diagnostic or charge. Carrier diagnostics precede attachment diagnostics, with each group in raising-stage and source-occurrence order (engine §11.5). Private identities and measure charges are not serialized. Caller tokens accept empty diagnostic lists and reject nonempty lists as usage errors.

A node has one of these forms:

```
{"kind":"rule","rule":"sumti","span":[0,3],"source":[0,9],"tags":[TAG...],"children":[NODE...]}
{"kind":"token","terminal":"KOhA","token":0,"span":[0,1],"source":[0,2]}
{"kind":"elided","terminal":"KU","span":[3,3],"source":[9,9]}
{"kind":"elided","terminal":"KU","span":[3,3],"source":[9,9],"value":""}
```

A rule name is an output string, rather than an ASCII identifier. It can contain an emoji or a canonical call with punctuation, quotes, and spaces. Named instances use their public name without an extra node. Nodes, `insertedBy`, warnings, expected rules, and witness actions all use that same effective name. Engine §2.3 defines instance identity and canonical names.

A list that flat braces read has no node of its own. Each level of a chain is a `rule` node of the chain's rule (engine §12). So braces add no kind of node. A spliced call also adds no node and keeps its children in order. A collapsed erased occurrence shows only its kept canonical derivation (engine §6).

The [JavaScript API](api.md#javascript) defines formatter ownership.

A token node's `token` indexes the stage-input token it reads. `terminal` records canonical terminal identity, such as `KOhA`, `"a"`, `"a".."z"`, or `_`. Tests do not change that identity. Constants expand to their string identity. Read witnesses and expected lists use the same spelling.

An elided node with a default value (engine §3.8) records it as `value`, after `source`. A default from `≝` or from an equality test counts, and an explicit empty operand gives `value:""`. All other nodes omit this member. A canonical comparison of two result trees includes `value`. A comparison of two constituents in a condition (engine §10) does not read it. This metadata does not change the empty value that an omitted pattern leaf observes.

```json
{"kind":"elided","terminal":"T","span":[1,1],"source":[1,1],"value":"saved"}
```

A named diagnostic has this form, for either an error or a warning:

```json
{"stage":"words","code":"y-cmavo","rule":"y-cmavo","span":[2,3],"source":[3,7],"message":"this word uses a y-final cmavo"}
```

The six shown members are required. An error can add `rejection` after `message`, as below. `code` is the diagnostic rule's effective name, and `rule` identifies that same rule. `message` is its evaluated recipe. A warning has no `feature` member.

`span` counts the stage's input tokens, and `source` counts original code points. A warning can have an empty span. An error reads at least one token, but its source can be empty. Spliced occurrences keep these fields even though their output node is absent. Coordinates belong to the raising stage and never change during flow. Report order follows engine §12.1, including carried diagnostics and erasure.

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

The result has `ok:false` and keeps the chosen tree. The reporting stage retains `unique` or `resolved` and its emitted output, including an empty output array. Its errors can originate in earlier stages. The result's `warnings` holds the surviving warnings under the same collection rules.

An action in a witness is `{"read":{"token":4,"terminal":"KOhA"}}` or `{"close":{"rule":"sumti","production":57,"span":[2,5]}}`. The witness of an error of `elision-only` can also hold `{"elided":{"at":3,"terminal":"KU"}}`, a read of a terminator written back at that position (engine §7.10). The production is numbered from 0, as in engine §3. For a production of a helper, `rule` is the rule whose alternative introduced the helper.

An error has one of these forms:

```
{"kind":"rejected","stage":"syntax","token":4,"source":[12,15],"line":1,"column":13,
 "expected":[{"terminal":"KU","rules":["sumti"]},...],"errors":[ERROR...],"warnings":[WARNING...],"message":"..."}
{"kind":"ambiguous","stage":"syntax","reason":"tie","readings":[NODE,NODE],"errors":[ERROR...],"message":"..."}
{"kind":"ambiguous","stage":"syntax","reason":"elision-only","readings":[NODE,NODE],"witness":[ACTION,ACTION],"message":"..."}
```

If a conditional declaration holds for a feature that the caller disables, the result contains this error:

```text
{"kind":"feature-conflict","stage":"words","feature":"sa-su","errors":[ERROR...],"warnings":[WARNING...],"message":"..."}
```

The stage has a null verdict and no output. Earlier stages retain their output. The result has `ok:false` and `tree:null`.

A rejection can also name a failed boundary condition:

```json
{"kind":"rejected","stage":"syntax","token":4,"source":[12,15],"line":1,"column":13,
 "expected":[...],"boundary":{"rule":"bare-na","condition":1,"at":3},"errors":[ERROR...],"warnings":[WARNING...],"message":"..."}
```

Diagnostic arrays in error envelopes are optional. Empty arrays are absent. A `rejected` envelope orders members as `kind, stage, token, source, line, column, expected, boundary, errors, warnings, message`. It collects pending stage-level diagnostics, then input diagnostics through its furthest token, including that token. It has no stage output.

A `feature-conflict` envelope orders `kind`, `stage`, `feature`, `errors`, `warnings`, `message`. A `grammar` envelope orders `kind`, `stage`, `code`, `errors`, `warnings`, `message`, `chosen`, `completion`. Optional members retain these positions. Both collect the whole failed-stage input, without a rejection cutoff. A grammar failure after choice inserts evaluated own-stage messages outside erased subtrees before that carried list and after pending earlier stage-level diagnostics.

For these three envelopes, `warnings` equals the result's complete warning collection. A `reported` envelope has `kind`, `stage`, `errors`, `message`, with warnings only at result level. A tie envelope has `kind`, `stage`, `reason`, `readings`, optional `errors`, then `message`. An elision-only envelope has `kind`, `stage`, `reason`, `readings`, `witness`, `message`, with no `errors` member. Its warnings also remain at result level.

`boundary` appears only when a failed boundary obligation dropped an item at the reported position or later (engine §4.2). `rule` is the rule of the condition. `condition` is the index of the condition item among the rule's condition items, from 0. The count runs through the rule's definitions in source order, so an extension's items follow those of the rule it extends.

Guard atoms in header and alternative tag terms follow their definition's written conditions and count toward indexes in later definitions. Each written guard atom takes its own index, in written order, with the header term first and then the term of each alternative. The atoms of an alternative that a gate drops still count.

`at` is the boundary where the obligation failed. Equal literals retain every source condition as an annotation, without changing record identity.

`kind` is one of these values:

- `rejected`: Recognition finds no complete derivation of the stage input.
- `reported`: The reporting stage has at least one counted error. The envelope contains `stage`, ordered `errors`, and a summary `message`, as above.
- `ambiguous` (engine §6, §7): The error has `stage`, `reason`, `readings` and `message`, and no position. A tie can also have the ordered `errors` above. Every ambiguous error has two readings. `message` is free, and the shared tests do not compare it. `reason` says which of two cases the error is:
  - `tie`: The ranking of the stage has two or more best derivations (engine §6). The stage's verdict is `tie`, and it has no output. The readings are the first and the second reading of the tie, over the stage's input as the stage read it. They are two derivations, but they can be equal as `NODE` values.

    The engine counts admitted derivations with the best blame measure. It collapses erased interiors with equal observable states (engine §6). Other transparent closes and equal trees do not merge derivations. The stage's witness then names the actions where they differ.

    Errors and result warnings come from the two shown readings only, after pending earlier stage-level diagnostics. Carried identities deduplicate across readings. Own-stage diagnostics use maximum multiplicity of each complete diagnostic object, including `rejection`, across the readings. The second reading adds only occurrences beyond the number already collected.
  - `elision-only`: If filtering excludes the restored chosen derivation, the check fails. Otherwise, its collapsed class must be the sole best admitted class of the written-back text. Engine §7.10 defines this decision. The stage's verdict is `unique` or `resolved`, and it keeps its output.

    The first reading represents W(D), the restored chosen derivation. An admitted reading shows its class's kept interior. An excluded W(D) remains the concrete raw restored reading. The second is its deterministic competitor (engine §7.10). This order also applies without ranked groups or key steps.

    The readings hold the written-back terminators as elided nodes (engine §7.10). One can be a restored optional's terminator. One can also be a terminator that a reading reads on the written route of an optional, or as a bare terminal. So the two readings can be equal as `NODE` values, as a tie's can.

    The error also has `"witness":[ACTION,ACTION]` after its readings. It holds the actions at the first difference between the two derivations, visible if there is one, mapped to the stage's input (engine §7.10). Over that input, the two actions can be equal too. The stage itself has no witness.
- `feature-conflict`: A conditional declaration holds for a feature that the caller disables. The error has `stage`, `feature`, and `message`, without a position.
- `grammar`: The parser found a defect while parsing. The error has `stage` and no position. An example of such a defect is a nested parse asked about its own span as the same rule. An error that lowering finds for the features of the parse is one too (engine §3). An item of braces that can match no tokens is such an error. Its message begins with the document, line and column of the definition at fault, since the error's position members are for the stage's input.

  A defect found by the check of `elision-only` can have the member `code` with the value `elision-witness-lost` (engine §7.9). Such an error also has `chosen`, the chosen tree. It has `completion`, the terminators written back.

  Each of them is `{"terminal":T,"at":N,"source":[S,S]}`. Only a terminator with a default value adds `"value":"..."` last, from `≝` or from an equality test, including an explicit empty string. The envelope follows the grammar member order above, including optional diagnostic arrays. Named diagnostics carry their rule codes inside a `reported` envelope. Other parse-result errors have no top-level `code`. Structured loading errors use the separate schema below.

For example, `text → [[X]]` on the empty input ties, and both readings are `{"kind":"rule","rule":"text","span":[0,0],"source":[0,0],"tags":[],"children":[]}`. The stage's witness names two different productions of the helpers. An `&` that can match no tokens, such as `[A] & [B]`, gives such a tie too, with three derivations.

A mistake of the caller is not a result. It is an error of kind `usage` (engine §13).

`line` and `column` count from 1, in code points. Lines end at `\n`, `\r\n` or `\r`. A position at the LF of a CRLF remains on the line that the pair ends. Its column counts the preceding CR.

At the end of a stage's input, a rejection has `token` equal to the number of input tokens. Its `source` is `[S,S]`. `S` is the source end of the last stage-input token, or 0 if there are no input tokens. Its `line` and `column` locate `S` in the original text. The original text can continue after `S` (engine §4, §12).

`expected` lists terminals in code point order. The library writes a tested terminal as the terminal followed by its test, as in `LE="la"`, and sorts it by that text. So `LE` comes before `LE="la"`, which comes before `LEhU`. Each terminal comes with the rules whose items can read it at that position, also in code point order. `message` is the description for people. Shared cases can pin an agreed reason with `expect.message` (`tests/README.md`).

Expected-terminal diagnostics use exact value tests and signed tag tests. Constants expand to resolved strings or requirements. Requirements sort by tag name in code point order. For one name, the positive requirement comes first. Duplicate requirements of one sign collapse.

The spelling writes the terminal, then `<`, then requirements separated by one ASCII space, then `>`. A value test follows when present. Other spaces appear only inside the resulting quoted string. Empty requirements spell `<>`. Canonical strings follow engine §9. A scalar of general category Cf requires an escape, as in `"‹ZWSP›"` (engine §1).

Examples are `KOhA<UI Word>`, `KOhA<¬UI>`, `LE≠"lo"`, `X<¬A B>`, and `X<A>="s"`.

A check uses the same named diagnostic shape as a rule. Its `code` and `rule` both name the check. Its `span` and `source` belong to the matched node. Empty omitted leaves keep the ordinary empty source convention. Several omissions at one position remain separate reports. Checks never receive competitor `rejection` evidence, because they are no ranked options.

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

`group` appears when the reader identifies a ranked group. Its members are `document`, `at`, `rule`, `alternative`, and `path`, in that order. Omit `document` and `at` when unknown. `at` identifies the first `≻` token where source exists.

`rule`, `alternative`, and `path` identify the final stitched source expression where available. `alternative` and `option` are zero-based indexes. Omit `option` for a failure common to the whole group.

`path` is a JSON Pointer relative to the alternative's `expr`. Ranked children use `/ranked/0`, `/ranked/1`, and subsequent indexes. Captures and tests continue through `expr`. Other components keep their names.

`expression` is the offending written expression as a DOM value where available. `inheritance` appears only for a tag error with a witness. It lists rule or helper sites from the group toward the tag source. Helper sites use written paths and the same source fields.

Choose the shortest inheritance witness. Source traversal order breaks equal-length choices. Keep loading diagnostics outside document DOMs, cache envelopes, and parse-result warnings. The API exposes these members, and CLI JSON serialization preserves their order.

### A grammar DOM

The authoritative constructor contract is [engine §9.3](engine.md#93-conversion-and-validation). It defines recognized syntax parts, required lookups, and conversion into these schemas.

A grammar DOM (document object model) is the parsed form of a grammar document (engine §8, §9). A library makes it when it reads the document. The per-family preparsed files hold this data, including the entries that bootstrap the notation reader.

Its envelope is `{"format":52,"rules":[RULE...],"directives":[DIRECTIVE...],"constants":[CONST...],"classifiers":[CLASSIFIER...],"implications":[IMPLICATION...],"checks":[CHECK...]}`. All six declaration arrays are present, including empty arrays. The envelope has no other members. Every declared item has `at:[line,column]`, counted from 1. Both coordinates must be integers from 1 to 9007199254740991 (2^53 − 1). This bound applies to every DOM source position.

`format` is the version of the DOM, 52. A library refuses a bootstrap of another version and treats an optional cached DOM of another version as a cache miss. A format match alone never excuses invalid schema data.

An optional member is absent only when its key is absent. A present `null` does not replace an omitted member. Every present member must satisfy its stated form, including exclusive targets and optional clauses.

A written literal joins its decomposed text runs with exact decoded escapes. DOM depth follows the compound ancestors and transparent wrappers defined in engine §9.

The cache identity follows engine §8.

A check has this form, in canonical member order:

```text
{"name":"early-elision","pattern":PATTERN,"conditions":[COND...],
 "warning":MESSAGE,"at":[line,column]}
```

`pattern` is a PATTERN literal or a constant reference `{"const":NAME,"at":[line,column]}` that resolves to a pattern. Exactly one of `error` and `warning` is present. `conditions` is always an array, including an empty array. No other members are legal. In particular, a check has no `op`, alternatives, parameters, arguments, tags, strings, emission, suppression or erasure.

Check names use the rule-name repertoire, with warning names further restricted to valid feature names. The stage rejects duplicate checks and rule/check name collisions. Each check's `at` is the position of its `%check` keyword. Declaration ordering merges all six arrays by source position, with equal positions ordered as rules, directives, constants, classifiers, implications, then checks.

A check pattern's candidate predicate is exact and has no path operator, as engine §2.4 defines. Nested child lists retain ordinary pattern rules. A check's named references must resolve to rules or template families, never checks.

A rule has this form, in canonical member order:

```text
{"name":"unit","op":"define","tags":TERM,"value":RECIPE,"image":RECIPE,
 "alternatives":[ALT...],"emit":EMIT,"conditions":[COND...],
 "error":MESSAGE,"warning":MESSAGE,"suppressWarnings":[CODE...],"erased":true,"at":[line,column]}
```

`op` is `define`, `redefine`, or `extend`. `tags`, `value`, `image`, `emit`, `error`, `warning`, `suppressWarnings`, and `erased` are optional. `conditions` is an array, including an empty array.

`erased` is present only as `true`. `erased` and `emit` cannot coexist. An erased definition cannot carry a value or image recipe. It can carry a diagnostic recipe or suppression.

`error` and `warning` cannot coexist. Each holds a MESSAGE recipe, which excludes `.emitted` (below).

`suppressWarnings` is a nonempty array of warning codes, or `["_"]` for all warnings. The wildcard cannot share its array with codes. A repeated code in a suppression list is legal and changes nothing.

These clauses attach only to this definition's productions. An extension inherits none of them.

Rules have no members beyond the forms shown here, including the template and instance forms below.

`alternatives` is nonempty on body definitions. A rule name is lowercase or one valid emoji scalar (engine §9.1).

A template body definition adds `"params":["Left","Right"]` immediately after `name`. The names exclude `@` and obey engine §2.3. A template has at least one distinct parameter. Its other fields follow the ordinary rule schema, except that `error` and `warning` are forbidden. A template can carry `suppressWarnings`, which its instances inherit.

An exact instance edit uses `"name":"pair","args":[ARG,ARG...]` instead of `params`. The `args` member also follows `name` immediately. Its `op` is `redefine` or `extend`. A public-name edit uses the ordinary rule shape and resolves to that instance during stitching. Parameters and concrete arguments cannot mix in a head.

A binding has exactly this shape:

```json
{"name":"named-pair","op":"define","instance":{"call":"pair","args":[{"string":"a"},{"string":"b"}],"at":[1,20]},"conditions":[],"at":[1,1]}
```

Its `op` can also be `redefine`, under engine §2.3. It has no `alternatives`, clauses, emission, diagnostic, suppression, or `erased`. Its conditions must be empty. The `instance` member follows `op` in canonical order. This object records a binding, without adding a runtime wrapper node.

A `redefine` binding can replace an ordinary rule or rebind a named instance to another call. After rebinding, the old instance keeps its edits and takes its canonical name.

A call is `{"call":"pair","args":[ARG,ARG...],"at":[line,column]}`. A parameter is `{"param":"Left","at":[line,column]}`. Both require positive source coordinates. Call names use the rule-name repertoire. A call requires at least one argument. A parameter requires a declaring template and a matching parameter name.

Both forms obey the shape of their position. Parameters can replace operands inside conditions. A parameter can also stand as the set term of the `nonempty` wrapper below. Neither form replaces an emission or pattern-child expression. Calls retain their rule identity in unresolved term positions. Ordinary type requirements apply when the stage resolves those calls.

ARG has one of these forms:

```text
TERM
{"rule":"unit"}
{"call":"pair","args":[ARG,ARG...],"at":[line,column]}
{"param":"Left","at":[line,column]}
{"range":[STRINGTERM,STRINGTERM]}
{"wildcard":true}
{"splice":SPLICETARGET}
TESTED-SYMBOL
{"body":EXPR}
{"targets":[TARGET,TARGET...]}
{"requirements":[REQUIREMENT...]}
```

Common atoms retain their term forms. A parenthesized single symbol becomes its common ARG atom, including a tested symbol or parameter. Other parenthesized bodies, optionals, and repetitions use `body`.

A tested-symbol argument retains its ordinary expression schema. Bare `ε` uses `body:{"empty":true}`. The body wrapper preserves the argument category and adds no runtime node.

A parenthesized single parameter has no `body` wrapper. Other nesting follows the reader's ordinary DOM construction.

Source, cached, and supplied arguments undergo the same conversion. A supplied `body` wrapper with one symbol reduces to that symbol before flow analysis, instance keys, and position validation.

A TARGET is `{"rule":"r"}`, `{"terminal":"T"}`, a call, or, before expansion, a declared `param` node. A parameter must belong to the containing template. A terminal target names a user tag, never an engine tag.

A target-choice argument has at least two TARGET values. Requirement lists retain signed requirement records and can be empty. Neither list is a tag set. Captures and capture methods are invalid anywhere inside ARG.

Calls and parameters can occupy expression, term, pattern, and method-argument positions that engine §2.3 permits. Parameters can also occupy STRINGTERM and a requirement's `value` before expansion. A bare rule argument converts to the constructor that its use requires.

Before the loader computes keys, it inspects every rule-valued argument and target inside a pattern call for read-back validity. It also visits nested calls and body arguments. Each nominal reference must read back as a rule in its actual syntactic position under the loaded Unicode table. A supplied rule argument cannot become a tag argument through canonical spelling. Unused arguments receive the same inspection.

A call remains an instance reference. A body argument supplies its EXPR. The single-symbol conversion runs before position validation.

A target choice supplies a body choice or splices into query targets.

A requirement-list argument splices only into an unnegated requirement placeholder. Its entries replace that placeholder in written order. A list under a negated placeholder is an error. No other argument category splices. Ordinary validation applies to the substituted result.

These forms remain unresolved in document caches. Supplied, cached, and source DOMs undergo the same binder, argument, expansion, and ordinary validation. Calls add one depth level before their arguments. Category wrappers add no depth, and parameters are leaves. Expanded definitions also obey the depth limit.

An alternative is `{"gates":[GATE...],"expr":EXPR,"tags":TERM,"value":RECIPE,"image":RECIPE}`. Its three clause members are optional. `gates` is always present, including an empty array.

A gate is `{"feature":"cbm","kind":"gate","negated":false}`. Its kind is always `gate`, and its feature follows engine §9.1. `negated:true` gives `¬cbm?`. No other members or gate kinds exist.

Alternatives have no members beyond `gates`, `expr`, `tags`, `value`, and `image`.

An expression has exactly one of these forms:

```text
{"seq":[EXPR,EXPR...]}       {"choice":[EXPR,EXPR...]}
{"ranked":[EXPR,EXPR...]}    {"and":[EXPR,EXPR...]}
{"optional":EXPR}           {"optional":EXPR,"elidable":true}
{"repeat":EXPR,"separator":EXPR,"chain":"left"}
{"ref":"sumti"}            {"ref":"KOhA"}            {"ref":"_General_Category_Uppercase_Letter"}
{"literal":STRINGTERM}      {"wildcard":true}
{"range":[STRINGTERM,STRINGTERM]}
{"splice":SPLICETARGET}
{"capture":"x","expr":CAPTURETARGET}
{"test":"=","value":STRINGTERM,"expr":TESTTARGET}
{"test":"tags","requirements":[REQUIREMENT...],"expr":BASETARGET}
{"empty":true}             {"remainder":true}
{"call":"pair","args":[ARG,ARG...],"at":[line,column]}
{"param":"Left","at":[line,column]}
```

An expression has no member but those of its one form, including template forms above.

`seq`, `choice`, `ranked`, and `and` require at least two children. `and` accepts at most 16.

`repeat` is braces (engine §3, §9). Its value is the item, and its `separator` is present only where the braces have `/`. Its `chain` is present only for a chain: `left` for `{... x / s}` and `right` for `{x ... / s}`. So `{x}` is `{"repeat":X}`, `{x / s}` is `{"repeat":X,"separator":S}`, and `[{x}]` is `{"optional":{"repeat":X}}`. A `repeat` with a `chain` is the whole `expr` of its alternative, and never part of another expression. A list counts one or more items, and an optional list is an `optional`.

SPLICETARGET is one rule `ref` or `call`, including an emoji rule. It cannot be a terminal, parameter, test, group, or nested splice. Outer tests can wrap a splice, and a capture can bind that tested occurrence.

A `ref` stores a rule or tag name, including `🆓` or an engine tag. `literal` stores an unresolved string term. A range stores two string terms that resolve to single scalar endpoints. `wildcard` is exactly `true`.

An `optional` with `"elidable":true` is an elidable optional (engine §3.8). `[+KU 🆓]` is `{"optional":{"seq":[{"ref":"KU"},{"ref":"🆓"}]},"elidable":true}`. A plain optional has no `elidable` member. An elidable optional whose head carries `≝` has a `default` member after `elidable`.

Its value has the form of a value test's operand. So `[+JI ≝ "jie"]` is `{"optional":{"ref":"JI"},"elidable":true,"default":{"string":"jie"}}`. A plain optional has no `default` member.

`BASETARGET` is a `ref`, `call`, `splice`, `literal`, `wildcard`, or `range`. Before expansion, it also accepts a declared `param` node. `TESTTARGET` is a BASETARGET, or its tag-tested form under a value test. `CAPTURETARGET` is a BASETARGET or its legal tested form.

Before expansion, `$x:@X` can have this capture expression:

```json
{"capture":"x","expr":{"param":"X","at":[1,16]}}
```

A query parameter uses the same unresolved node in its body:

```json
{"method":"parse","receiver":{"capture":"x"},"args":[{"body":{"param":"X","at":[2,23]}}]}
```

After substitution, the body is a constituent like any other (engine §4).

Capture names use lowercase letters, digits, `-`, and `_`. Captures cannot occur directly in a chain's item or separator. Flat braces inside a chain can hold item captures. Inside an elidable optional, only the capture of its sole terminator is legal (engine §3.8).

A capture inside the braces of a flat list is an item capture, which binds in the productions of the list's helper (engine §3.5). No ranked group can separate it from its innermost flat braces. Its name occurs nowhere else in its alternative. Each expanded production binds a name at most once.

A value test uses `=` or `≠`. A tag test uses `test:"tags"` and an ordered array of requirements. A requirement is `{"negated":false,"value":TERM}`. Its value is a tag literal, tag-set constant, or declared parameter before expansion. A negative requirement has `negated:true`.

The requirement array can be empty. An empty constant also resolves to no requirements. A tag test wraps only a BASETARGET. A value test wraps a BASETARGET or its tag test. Both tests must hold. Repeated test kinds and reversed nesting are malformed.

For example, `_<Stressed>≠"y"` converts to this nested expression:

```json
{"test":"≠","value":{"string":"y"},"expr":{"test":"tags","requirements":[{"negated":false,"value":{"tag":"Stressed"}}],"expr":{"wildcard":true}}}
```

The pattern value `#A<B>=""` converts as follows. Its leaf uses `terminal` and records its source position. Both tests observe that same leaf.

```json
{"pattern":{"test":"=","value":{"string":""},"expr":{"test":"tags","requirements":[{"negated":false,"value":{"tag":"B"}}],"expr":{"terminal":"A","at":[1,2]}}}}
```

A capture of `🆓` converts like any rule capture:

```json
{"capture":"f","expr":{"ref":"🆓"}}
```

The first symbol of an elidable optional is a user-tag `ref`, optionally tested. Its tests can combine a value test and signed tag requirements. Before expansion, it can instead be a declared `param`, with the written head tests. Its content is that symbol, a sequence starting with it, or a capture wrapping only that symbol.

`[$j:+JI="jie"]` has this DOM:

```json
{"optional":{"capture":"j","expr":{"test":"=","value":{"string":"jie"},"expr":{"ref":"JI"}}},"elidable":true}
```

A `default` belongs to the optional, after `elidable`, including for a captured terminator. No capture can wrap the optional itself.

The parameter must become exactly one bare user-tag atom after argument conversion. Rule names, sequences, tested arguments, constants, and tag-set expressions are invalid arguments for that head. Engine tags, strings, ranges, wildcard, and grouped heads are invalid. The sole-terminator capture is the only permitted capture there.

Source syntax also rejects parentheses around the head. The DOM does not record discarded grouping.

Terms have these forms:

```text
{"string":"s"}               {"concat":[TERM,TERM...]}
{"tag":"Word"}               {"emptySet":true}
{"const":"SU-STOPS","at":[line,column]}
{"union":[TERM,TERM...]}       {"intersection":[TERM,TERM...]}
{"difference":[TERM,TERM]}     {"if":COND,"then":TERM}
{"capture":"x"}              {"capture":""}
{"method":"value","receiver":RECEIVER,"args":[]}
{"pattern":PATTERN}
{"call":"pair","args":[ARG,ARG...],"at":[line,column]}
{"param":"Left","at":[line,column]}
```

In a term, a run of bare tag names or string literals produces one `union` of its terms in written order. Set operations treat scalar strings as singleton sets. A lone string keeps its scalar type.

Any `union` operand that is itself a `union` flattens into its enclosing union. This applies to runs and explicit `∪`, including either form inside grouping parentheses. Parentheses make no DOM node. Thus `:: $f.tags ∪ Run-Initial Run-Final` has three union operands.

Difference retains both operands. A term intersection retains its written nesting until type resolution. Pattern-valued intersections then flatten nested intersections before evaluation and instance keys. Other intersection types retain their nesting. Thus `(Word BY) ∩ $l.tags` keeps the run's union as its first operand.

For example, `A ∪ (B ∪ C)` gives this term:

```json
{"union":[{"tag":"A"},{"tag":"B"},{"tag":"C"}]}
```

`STRINGTERM` is `string`, string-valued `const`, or a declared `param` before expansion. A written string literal uses `string`, with escapes decoded and dollar signs unchanged.

`concat` joins string terms in written order. Outside a recipe root, its array contains at least two operands. The reader flattens nested concatenations, including grouped operands. It preserves empty operands and does not merge literals or resolve constants. Supplied DOMs can retain nested `concat` terms.

`const` is a reference to a constant, by its name without `$`. Its `at` is the line and column of the reference, where the loader reports an error of the constant (engine §2). A term has no member but those of its one form, including template forms above. `difference` has exactly two parts, and `a ∖ b ∖ c` nests the first difference in the second.

A method node always has `method`, `receiver`, and `args`, in that order. Its method name, receiver type, arity, and result type follow engine §10. A receiver can be a capture, span method, string term, query forest, or the recipe-only emitted pair. Before expansion, a permitted term receiver can also be a declared `param` node. Zero-argument methods have an empty argument array.

Rule arguments use `{"rule":"r"}`, including `{"rule":"🆓"}`, or an unresolved call. `.without-elision-except` takes one. Before expansion, it can take a declared `param` node in that rule position.

Classifier arguments use `{"classifier":"lexicon"}`. Rule arguments are also legal compile-time ARG values. Classifier arguments occur only in `.classify` and cannot be ARG values or parameter uses.

String arguments are terms. A classifier name starts with a lowercase letter, so `🆓` cannot name a classifier.

`.followed-by` and `.preceded-by` take one or more TARGET arguments, as defined after the ARG forms. They retain written order. Two or more arguments form a choice.

Source and supplied DOM accept repeated targets, which change nothing. Both methods share TARGET's user-terminal and parameter-scope restrictions. Boundary targets identify grammar-built token classes, while engine tags describe stored character properties.

Boundary receivers are `{"capture":"x"}`, or `{"capture":""}` for `$`. In check conditions, node walks are boundary receivers too. `.preceding-tokens` uses the ordinary zero-argument method shape and returns an ordinary projected span.

`.parse` takes exactly one `{"body":EXPR}` argument. Its receiver is a capture or span, including a restored span except in suffix or part mode. The body contains no capture at any depth, but referenced rules retain their own captures. It can add the leaf `{"remainder":true}` at the first edge, at the last edge, or at both edges of its outer `seq`.

That leaf has no other members and is legal nowhere else. It cannot be the complete body. Without it, the query uses whole mode.

For example, `$i.onward.parse(@Open …).error-free` in a template uses this unresolved term:

```json
{"method":"error-free","receiver":{"method":"parse","receiver":{"method":"onward","receiver":{"capture":"i"},"args":[]},"args":[{"body":{"seq":[{"param":"Open","at":[2,20]},{"remainder":true}]}}]},"args":[]}
```

A first remainder selects suffix mode, and a last remainder selects prefix mode. A remainder at both edges selects part mode. Each remainder is unread and excluded from the witness. `.error-free` takes no arguments, accepts a forest receiver, and returns a forest. A bare `parse` result or its filtered result can stand as a condition.

A forest also has `.tags`, which unions the tag sets of its witnesses. A forest also supports `.ending-after(S)`, as below. It supports no other method, operator, or implicit string conversion. Body wrappers add no DOM depth, and the remainder is a leaf.

Check conditions represent `$` as `{"capture":""}`. Node walks use ordinary zero-argument method objects with names `parent`, `preceding-node` or `following-node`. The method `preceding-element` takes a node and gives an element value. `local-readings` takes a node or element and gives a forest. These methods have no arguments and are legal only in check conditions. Named captures and restoration methods are illegal anywhere in checks.

For example, the first check uses this condition:

```json
{"method":"ending-after","receiver":{"method":"local-readings","receiver":{"method":"preceding-element","receiver":{"capture":""},"args":[]},"args":[]},"args":[{"capture":""}]}
```

`ending-after` takes a forest receiver and exactly one capture, node, element or span argument. Its result is a forest. It is legal in any forest position, including rule conditions. It compares projected ends and retains each witness's measure and eligibility (engine §10).

Node presence uses `{"present":NODETERM}` for a walk. Bare `$` keeps `{"captured":""}`. A node can also supply either constituent operand of `≅` or `≇`. Ordinary node observations use the same method forms as captures. Element observations allow input strings, span selectors, positional tests and local readings only. The DOM contains no runtime node, element, forest, seal or absence marker.

`.ngrams` takes exactly one `{"integer":"2"}` argument. Its digits match `[1-9][0-9]*`, without a size limit. This argument is not a value term and occurs only in `.ngrams`.

`.without-elision` requires a bare capture receiver, including `{"capture":""}` for `$`. `.onward` can wrap its restored result. The DOM contains no runtime restoration records or seals. Readers reject `$x.onward.without-elision` and direct the author to `$x.without-elision.onward`.

`.without-elision-except` takes the same receiver and exactly one rule argument. `.onward` can wrap its result too. Readers reject `$x.onward.without-elision-except(f)` in the same way.

For example, `$m.without-elision.parse(sumti)` uses this condition DOM:

```json
{"method":"parse","receiver":{"method":"without-elision","receiver":{"capture":"m"},"args":[]},"args":[{"body":{"ref":"sumti"}}]}
```

`$s.without-elision-except(math).onward.parse(quantifier …)` uses this condition DOM:

```json
{"method":"parse","receiver":{"method":"onward","receiver":{"method":"without-elision-except","receiver":{"capture":"s"},"args":[{"rule":"math"}]},"args":[]},"args":[{"body":{"seq":[{"ref":"quantifier"},{"remainder":true}]}}]}
```

The extended prefix uses `$m.without-elision.onward.parse(sumti …)`. Its receiver nests an `onward` method around the restored span. Query conditions use the same method schema as terms.

A recipe is `{"concat":[ATOM...]}` with a nonempty array. Atoms are `string`, string-valued `const`, declared `param` before expansion, or one of the seven recipe string methods on a bare capture. The methods `.emitted.value` and `.emitted.image` are the two channel forms of `emitted`. An emitted-channel atom nests the channel selector around `{"method":"emitted","receiver":CAPTURE,"args":[]}`. `emitted` alone cannot be a recipe atom.

```json
{"concat":[{"method":"value","receiver":{"capture":"a"},"args":[]},{"string":" "},{"method":"image","receiver":{"method":"emitted","receiver":{"capture":"b"},"args":[]},"args":[]}]}
```

MESSAGE uses the same nonempty `concat` shape as RECIPE, but excludes both emitted-channel methods. It accepts the other five captured string methods, string literals, string constants, and `++`. It accepts no query or absent, item, or private ranked capture. A check MESSAGE accepts only `$` as receiver and adds `.terminal` to those string methods. That zero-argument method is illegal in every other position.

Recipe syntax joins atoms with `++` and accepts no other method chains or expression types. A recipe root always uses `concat`, including for one atom. After substitution, its array contains only recipe atoms. A parameter or call cannot replace the recipe root. Calls cannot be recipe atoms.

Substitution flattens nested concatenations into that array, in operand order. It preserves empty operands and each operand's source attribution. General terms also use `concat` for `++` in conditions and constants.

Conditions have these forms:

```text
{"op":"=","left":TERM,"right":TERM}
{"method":"parse","receiver":SPAN,"args":[{"body":EXPR}]}
{"method":"error-free","receiver":FOREST,"args":[]}
{"method":"starts-input","receiver":SPAN,"args":[]}
{"method":"ends-input","receiver":SPAN,"args":[]}
{"method":"followed-by","receiver":CAPTURE,"args":[TARGET,TARGET...]}
{"method":"preceded-by","receiver":CAPTURE,"args":[TARGET,TARGET...]}
{"not":COND}             {"any":[COND,COND...]}       {"all":[COND,COND...]}
{"captured":"x"}        {"if":COND,"then":COND}
{"nonempty":TERM}
```

Comparators are `=`, `≠`, `∈`, `∉`, `⊆`, `⊈`, `≅`, and `≇`. Operand types follow engine §10. Tree comparison requires a bare capture, including `$`, on the left, or a node in a check condition. Its right member is any term, and the loader checks its type (engine §10). A presence predicate uses `captured`, with an empty name for `$`.

TARGET follows the definition after the ARG forms. A CAPTURE is `{"capture":"x"}`, with an empty name for `$`. A boundary atom is a condition, so `not`, `any`, `all` and `if` can hold it (engine §4.2).

A `parse`, `local-readings`, `error-free` or `ending-after` method of forest type is also a condition, with the forms above. A condition has no member but those of its one form.

A set term used as a condition stands as `{"nonempty":TERM}`. It tests that the set is not empty. TERM is a `union`, `intersection`, `difference`, `tag`, `emptySet`, `const`, or `param` term. TERM can also be a set-valued method: `tags`, `classes`, `split`, `ngrams`, or `classify`. A `.tags` method over a forest is such a term too. TERM can also be a guarded term, `{"if":COND,"then":TERM}`.

A forest is no TERM of the wrapper. A forest-valued method already writes that condition, so a forest under the wrapper is malformed. An `if` node in a condition position is always the condition form `{"if":COND,"then":COND}`.

An emission is `{"items":[ITEM...]}` with a nonempty array. An item is either `{"capture":"x"}` or `{"insert":true}`, followed by optional `tags`, `value`, `image`, `before`, and `after`. The empty capture name denotes `$`. Only named capture items accept nonempty attachment arrays. Each attachment array contains capture names without `$`, in written order. Empty attachment arrays are omitted.

`%emits` without items creates `{"items":[{"capture":""}]}`. A clauses-only emission adds those clauses to that item. `%emits ε` creates `{"items":[{"insert":true}]}`. Erasure uses the separate rule member `erased:true`.

A constant is `{"name":"SU-STOPS","op":"define","value":TERM,"at":[line,column]}`. Its operation is `define` or `redefine`, and its value is closed. `%const` defines, and `%redefine-const` redefines. The name has no `$`. The value can hold `const` terms but never a value that the loader gives them.

A classifier is `{"name":"lexicon","entries":[ENTRY...],"at":[line,column]}`. Its name begins with `a` to `z`. `entries` can be empty, for a `%classifier` with no entry.

An entry is `{"gates":[GATE...],"keys":[STRINGTERM...],"op":"∈","class":"KOhA","at":[line,column]}`. Entries take gates only. Keys are nonempty in count, but an individual string can be empty. Source classifier keys are string literals or string constants. The operator is `∈` or `∉`. The class starts and ends with uppercase ASCII letters and never starts with `_`.

An entry's `at` is the line and column of its first token, where the loader reports an error of the entry (engine §2).

An implication is `{"if":TERM,"then":TERM,"at":[line,column]}`, for `%implies A ⟹ B`. `if` is `A`, and `then` is `B`. Both terms are closed tag sets and cannot mention engine tags.

A classifier and an implication have no member but those shown.

A directive is `{"name":"features","args":["cbm"],"at":[line,column]}`. A names directive is `{"name":"names","args":["extra-names.txt"],"at":[12,1]}`.

Directive names are `stage`, `extend-stage`, `redefine-stage`, `include`, `names`, `features`, `ambiguity-resolution` and `elision-only`. Stage selectors take one lowercase name. Includes and names declarations take one decoded path each. Names declarations precede all other kinds of statement in their document (engine §1). Features take at least one feature name as engine §9.1 defines it. `elision-only` takes no argument, so its `args` is `[]`.

An ambiguity-resolution directive has `steps` in place of `args`: `{"name":"ambiguity-resolution","steps":[{"step":"fewest","pattern":{"name":"erased-word","exact":true,"at":[1,31]}},{"step":"greedy"}],"at":[line,column]}`. A step is `{"step":S,"pattern":P}` for `leftmost-longest`, `fewest`, `most`, `late` and `early`, and `{"step":S}` for `greedy` and `lazy`. P is a pattern as "Pattern values" below gives it, or a constant reference `{"const":NAME,"at":[line,column]}` that resolves to a pattern, as on the right of `≅`. Engine §9.3 restricts the resolved pattern to an exact local predicate. There is at least one step, and `greedy` or `lazy` can stand only last (engine §6, §9).

A `features` directive can add `"conditions":[COND,COND...]`, with at least one condition. In canonical output, this member follows `at`. Other directives cannot have this member.

An absent `conditions` member denotes an unconditional declaration. A present empty array is malformed.

A directive of any other name is malformed (engine §9). An argument is a name or, for `include` or `names`, the decoded path: `{"name":"include","args":["../common/stream.md"],"at":[4,3]}`.

A library ignores unknown members of a directive. Its known members, `name`, `args`, `steps`, `conditions`, and `at`, keep their rules. An unknown member does not excuse a malformed known member.

`rules`, `directives`, `constants`, `classifiers`, `implications` and `checks` each keep the order in which the document has them. `at` is the line and column of an item's first token. So the order of all of a document's items is the order of their positions. No two items of a DOM share a position (engine §9).

DOMs store unresolved references and source positions, never stage-resolved constant or classifier values. Source, cached, and supplied DOMs obey the same arity, type, capture, clause, and depth rules.

Check validation follows the complete fault order of engine §9.3. Structural inspection of the whole declaration precedes semantic inspection in written order.

### Pattern values

Pattern tag requirements must resolve to tag sets, as ordinary symbol requirements do.

PATTERN tests one structural tree. An item consumes part of an ordered list of siblings. A pattern term has exactly one member, `pattern`, whose value is a PATTERN. Pattern terms also support `const`, `union`, `intersection`, `difference`, and contextual `emptySet`. Mixed pattern and tag-set operations are malformed.

The empty pattern atom is `{"never":true,"at":[line,column]}`. Its optional `at` member records the written `∅` position. Constant resolution can give `{"never":true}` without a source position. Both forms match nothing, including inside other patterns. The atom accepts no node decorations. Its whole pattern spelling is `#∅`.

An invalid `never` value, position, or extra member reports `a malformed empty pattern`.

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
{"test":"tags","requirements":[REQUIREMENT...],"expr":TERMINALATOM}
{"test":"tags","requirements":[REQUIREMENT...],"expr":RULEATOM}
{"test":"=","value":STRINGTERM,"expr":TESTTARGET}
{"test":"≠","value":STRINGTERM,"expr":TESTTARGET}
```

TERMINALATOM is an undecorated `terminal`, `literal`, `range`, `wildcard`, or string-valued `constant`. Before substitution, it can also be a declared `param` that must become a terminal atom. RULEATOM is an undecorated `name`, `call`, or a `param` that must become one. TESTTARGET is TERMINALATOM or RULEATOM, or exactly one tag test on either. The source order is tag then value. These inner objects carry no `exact` or `children` fields.

A tag test on a rule atom reads the constituent's tags (engine §4.1). A value test on a rule atom, as in `{"test":"=","value":{"string":"mi"},"expr":{"name":"sumti"}}`, reads the input value of the constituent's span. A tested rule atom carries no `children`.

Every test takes an atom, so no test object stands alone. The mark `_Elided` is a REQUIREMENT only in a pattern tag test, and never without negation on a rule atom (engine §9.3).

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
{"union":[PATTERN,PATTERN...]}
{"intersection":[PATTERN,PATTERN...]}
{"difference":[PATTERN,PATTERN]}
{"path":"descendant","pattern":PATTERN}
{"path":"first","pattern":PATTERN}
{"path":"last","pattern":PATTERN}
```

An undecorated `constant` can instead denote a whole pattern. An undecorated `param` can substitute one whole pattern. A compound form cannot carry `exact`, `children`, tests, or `at`. A pattern-valued constant cannot carry node decorations or terminal tests. A parameter with `children` must become a rule test or call without existing children.

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

Union and intersection each require at least two operands. Neither permits a direct operand of its own kind. The reader flattens those operands in written order, including across parentheses. Supplied nested forms are malformed rather than additional pattern shapes. Difference retains exactly two operands. These rules preserve order and duplicates.

After substitution, the loader flattens any pattern intersection that substitution nests inside another intersection. This step precedes expanded-pattern validation, including in conditions and call arguments. Initial inspection still rejects nested PATTERN intersections in supplied and cached DOMs.

The DOM accepts exactly the reader's output, apart from source coordinates. Unknown members and overlapping constructors are malformed at every level. No `boundary`, `written`, or `omitted` pattern form exists. Ordinary reading of canonical pattern spelling follows engine §2.3 and preserves the key.

A tree comparison uses the `op`, `left` and `right` members:

```json
{"op":"≅","left":{"capture":"x"},"right":{"pattern":{"name":"sumti","at":[1,9]}}}
{"op":"≇","left":{"capture":""},"right":{"const":"KE-UNIT","at":[1,7]}}
{"op":"≅","left":{"capture":"v"},"right":{"capture":"e"}}
```

These operators require a bare capture, including `$`, on the left, or a node walk in a check condition. The right member is any term, and the loader checks its type after constants and template arguments resolve (engine §10). A right term of constituent type is a `capture` term, with an empty name for `$`, or a node walk in a check condition. A right term of another type than pattern or constituent is a type error.

Pattern equality and implicit string conversion are malformed. Text, cached DOMs and supplied DOMs use the same grouping, field, arity and type restrictions. Resolution covers patterns in replaced definitions too.

Structural states and omission predicates remain internal derived state. Omitted pattern tags are the terminator tag and the mark `_Elided`, which no output field shows. Internal omission records retain `value` only for a default value, from `≝` or from equality, including an explicit empty string.

Elided tree nodes with a default value expose it as `value`, including an explicit empty string. Omitted pattern leaves still observe empty value and image. Completion diagnostics expose `value` when present.

### Ranked expressions

A ranked expression is `{"ranked":[EXPR,EXPR...]}`. Its array has at least two ordinary expressions and preserves source order. A nested ranked expression retains its own boundary. Ordinary alternatives within one option use `choice`.

For example, `mex MOI 🆓 ≻ SE 🆓 tanru-unit-1` produces this expression:

```json
{"ranked":[{"seq":[{"ref":"mex"},{"ref":"MOI"},{"ref":"🆓"}]},{"seq":[{"ref":"SE"},{"ref":"🆓"},{"ref":"tanru-unit-1"}]}]}
```

Neighbor-guarded tag terms use the ordinary `if` term and boundary-method condition shapes. Their guard is one optionally negated atom on `$`, with a literal tag-set consequent. The DOM stores the written term, never the concrete variants of engine §3.7.

The DOM holds no lowered helper, admission key, [seal](notation.md#the-structural-tree), or selected option. References retain their written form before terminal resolution. Expression traversal includes `ranked` alongside other expression forms.

### Preparsed DOMs

The names dependency of a cached document is a resource map. If source conversion loads no names data, the entry omits `names`.

`data/preparsed/FAMILY.json` holds the DOMs of all grammar documents under `grammars/FAMILY/`. `tools/sync.js` generates each file and copies it into every package. Its shape is `{"format":52,"bootstrap":HASH,"unicode":HASH,"properties":HASH_OR_NULL,"bundledNames":{RESOURCE:HASH},"documents":{PATH:{"hash":HASH,"names":{RESOURCE:HASH},"dom":DOM}}}`. `PATH` is relative to the package root, including the `grammars/` prefix. Each `HASH` is the FNV-1a hash of engine §8. `unicode` hashes the text of `data/unicode/unicode.txt`.

The required `gencmu.json` omits the `bootstrap` header member. The hash of its complete text supplies that fingerprint for every other family. The notation reader uses its required entries without checking their source text hashes. Ordinary cache lookups still compare all other applicable identity members. Each document key selects its own family's preparsed file (engine §8), besides the required `gencmu.json`. Missing or malformed optional files give cache misses.

JSON integers have no leading zero except `0` and `-0`. A `\u` escape holds exactly four ASCII hexadecimal digits.

For an ordinary entry, a library compares format, bootstrap fingerprint, core-table hash, properties fingerprint, and document hash. The bootstrap file supplies its own fingerprint implicitly. `properties` hashes the complete properties-file text. If a custom core has no companion, the fingerprint is `null`. Even for documents naming no additional property, the member is mandatory. A custom properties file causes unavoidable cache misses against bundled entries with a different fingerprint.

`bundledNames` records the bundled standard names file and every bundled extra, with normalized paths in code-point order. Each value hashes the pinned resource text. Caller replacements never change this registry. Present resource keys require full comparison even if the supplied text matches a registered hash. Absent keys can use the registry even in a portable map.

This optional cache metadata leaves the DOM and bootstrap format unchanged. A missing or malformed registry disables the shortcut in engine §8.

If source conversion loads names data, the cache writer records `names` after `hash`. This nonempty map contains the standard file and every selected extra. Its keys are normalized resolved resource paths in code-point order. Each value hashes that file's text with FNV-1a. Core abbreviations require no names dependency. When `names` is present, the loader compares paths and hashes for `data/unicode/unicode-names.txt` plus the current inherited and local extras (engine §8).

On a hash-matched, valid entry, the loader trusts this member without scanning source tokens. If the member is present, all selected paths and fingerprints must match it. Unoverridden bundled resources use `bundledNames` without reading, parsing, or fetching names files. Any override or missing registry entry requires loading and inspecting the complete selected set. The reference file serves inspection only and never enters the dependency map.

If the member is absent, the loader skips names-path and names-hash comparisons and loads no names data for that entry. The otherwise valid entry remains a hit, even when declared or inherited extras change. Those declarations still apply to nested includes. Engine §8 defines loading errors and cache misses.

A preparsed DOM holds the document's constants, classifiers and implications as the document writes them. The loader gives the constants their values when it stitches a stage, and a stage resolves a classifier for the features of a parse. A preparsed DOM serves every stage, pipeline, and feature set with matching resource dependencies (engine §2, §8).

## Renderings

The renderings are for people. The CLI and the playground implement all three renderings. Every library implements brackets, and the corpus tests compare brackets. Every rendering shows a token by its image.

A token node reads an input token of the last stage, and that token can have attachments (engine §11). Every rendering shows them with the token node. All readings of an `ambiguous` error read the same tokens, so they show the same attachments.

Tree renderings use the kept derivation, including the canonical interior of each erased occurrence. Diagnostic arrays do not alter grouping or token images. Named-error and warning explanations use their raising-stage names, messages, and original source excerpts. They follow the collected order and retain any competitor rejection evidence. A tie shows its two readings and their collected diagnostics.

Tree, brackets, and display JSON retain the node forms below. Separate diagnostic explanations identify attachment display owners, while carrier copies remain for flow and create no second explanation.

A hollow rule node, such as an empty slot for a free modifier, has no token and no elided node below it. No rendering shows a hollow rule node. Brackets drop it as an empty node, and the tree and the display JSON leave it out. But the tree and the display JSON always show the root. So the tree renders a hollow tree, such as that of the empty text, as the rule name of the root alone. The display JSON renders it as `{"text": []}`, and brackets render it as nothing.

### Brackets

Brackets write the final stage's tree as nested groups. Tree patterns do not change that grouping. The renderer first decides whether to show elided terminators, then applies these rules:

1. The image of a token node is the image of its token (engine §5). Grammar image recipes supply pause spaces and verbatim quote spelling. An image can itself be empty, and the renderer keeps it.

   A token index outside the stage input renders an empty leaf. The image of an elided node is empty, unless elided terminators are shown. In that case, the image is the terminal in ASCII lower case between `⟨` and `⟩`.
2. A token node whose token has attachments renders as a group. Its members are the token's before-attachments, the token's image, and its after-attachments, in that order. Each attachment renders in the same way: as its image, or as a group if it has attachments of its own.
3. The renderer renders the children of a rule node and drops the empty ones. An empty child is an elided node that is not shown, or a rule node that renders nothing. A token node is never empty.

   If no child is left, the node is empty. If one child is left, the node is that child. Otherwise, the node is a group.
4. The depth *d* of a group counts groups only: a child group of a group at depth *d* is at *d*+1. A group is written between `(` `)` when *d* mod 3 is 0, `[` `]` when 1, and `{` `}` when 2. One space separates its members.

In the `lojban/cll` pipeline, `lo mlatu cu citka le finpe` is `([lo mlatu] cu [citka {le finpe}])`, `mi ui klama` is `([mi ui] klama)`, `ba'e mi klama` is `([ba'e mi] klama)`, and `mi ui nai klama` is `([mi {ui nai}] klama)`.

### Tree

The originating core table is the Unicode table used for that parse (engine §1). The renderer uses it for quoted images and abbreviations. The result retains that immutable context privately, beyond the pipeline's lifetime. Canonical JSON omits this context. Without an originating context, tree rendering reports a usage error instead of selecting bundled or ambient data. Printing never needs the lazy names file.

The tree has one node per line, and children are indented two spaces under their parent. Each kind of node is written as follows:

- A rule node is its name. If the node has only token descendants on one line of source, ` · ` and its text follow the name. They do not if any of those tokens has attachments. They also do not if the image of any of those tokens, or of their attachments, holds a line break.
- A token node is its terminal, then its image from above in quotes. The quoted image uses the canonical string escapes of engine §9.1. For example, a line feed is `‹LF›`.
- The attachments of a token node follow it, each on a line of its own, indented two spaces more than the node. The before-attachments come first, each after `◂ `, and then the after-attachments, each after `▸ `. These marks differ from the ` › ` that joins a chain of rule nodes.

  An attachment is its classes, then its image in quotes with the same escapes. A class tag starts and ends with an uppercase ASCII letter and never starts with `_`. Class tags appear in code point order, joined by ` ∪ `. An attachment with no class is its quoted image alone. Its own attachments follow it in the same way, indented two spaces more.
- An elided node is its terminal in angle brackets.

The tree renderer writes chains of rule nodes with one child on one line. It joins them with ` › `. So in the `lojban/cll` pipeline, the token node of `mi` in `mi ui nai klama` has these lines, at the indentation of the node:

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
- An empty array is `[]`. A non-empty array is `[`, a newline, each item, a newline, and `]` at the indentation of the array. Each item is indented two more spaces than the array. A comma follows each item except the last.
- An object with one member is `{"name": ` followed by the value, then `}`. The value is written at the same indentation as the object. So `{"a": {"b": {"c": "x"}}}` stays on one line, and a long chain adds no indentation.
- An object with several members is written like an array, as `"key": value` lines between `{` and `}`.
