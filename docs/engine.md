# The gencmu engine

This is the specification every gencmu library implements. It says what a result is, not how to compute it, except where the only reasonable way to compute it is part of what it is. Where two implementations could differ, it says which is right. The cases in `tests/engine/` and `tests/notation/` are part of the specification: an implementation that disagrees with one of them is wrong, and a case that disagrees with this text is a bug in one or the other, fixed in the same change.

`docs/notation.md` explains the notation to grammar authors, and `grammars/notation/` defines it. `docs/output.md` defines the result's JSON and the renderings.

## 1. Tokens

Everything a stage reads and writes is a sequence of tokens. A token has:

- `tags`: a set of tags, each a string, each strong or weak;
- `span`: the half-open range of the previous stage's tokens it covers;
- `source`: the half-open range of the original text it covers, in Unicode code points;
- `text`: the original text over `source`;
- `phonemes`: what the token sounds like (§5);
- `insertedBy`: for a token an emission clause inserted from a quoted tag or a phoneme tag (§11), the rule whose clause it is; otherwise absent, even for a token of an emission `$` over an empty constituent.

The input of the first stage is the text's characters, one token per code point `c` at position `i`: `span` and `source` are `[i, i+1)`, `text` is `c`, and `tags` are `c` itself, strong, and one class tag, weak, the first that applies of:

- `space`: U+0009 to U+000D, U+0020, U+0085, U+00A0, U+1680, U+2000 to U+200A, U+2028, U+2029, U+202F, U+205F, U+3000;
- `digit`: U+0030 to U+0039;
- `mark`: a `mark` range of `grammars/unicode.txt` (General_Category Mn);
- `alpha`: an `alpha` range of it (General_Category Lu, Ll, Lt, Lm or Lo);
- `other`: anything else.

`grammars/unicode.txt` is generated from one version of the Unicode Character Database, which it names, by `tools/unicode-table.py`, and every library uses it rather than its platform's Unicode data, so that the four agree on every character. A character token has no phonemes.

A tag set is a map from tag to strength. The union of two sets holds every tag of either, strong if it is strong in either. The intersection holds the tags of the first that are in the second, with the first's strength.

## 2. Grammars

A grammar is the stitching of one or more documents (§8, §9) into a set of rules and directives. A rule has a name and alternatives; an alternative has guards, an expression, and optionally tags; a rule optionally has rule-level tags, conditions and an emission clause. The grammar DOM, in `docs/output.md`, is the exact data.

**Stitching.** Documents are read in order, and each document's rules in order. Each rule is stated one of three ways, and each is an error in the case given:

- `%rule` (`define`) defines a rule: an error if a rule of that name was defined before it, in an earlier document or earlier in the same one.
- `%redefine-rule` (`redefine`) replaces the rule of that name an earlier document defined, whose alternatives are then gone: an error if no earlier document defined one, or if a `%rule` or `%redefine-rule` of that name stands before it in the same document. An `%extend-rule` before it in the same document does not count: its alternatives are replaced with the rest.
- `%extend-rule` (`extend`) appends its alternatives to the rule of that name defined before it, in an earlier document or earlier in the same one: an error if none was.

When `%extend-rule` extends a rule, each appended alternative carries the extension's own clauses, its rule-level tags, conditions and emission, which apply to it alone, and the base rule's clauses do not apply to it; the earlier alternatives keep theirs. So a script document can add letters to a rule without restating its clauses, and its own clauses do not leak into the base rule. A **definition** is a `%rule`, `%redefine-rule` or `%extend-rule` statement: its alternatives and the clauses written with them. The loader records every replacement and extension.

**Directives** are collected from all the stage's documents:

- `%ambiguity-resolution L [elision-only]`, `L` being `greedy` or `lazy`: exactly one per stage, or it is an error naming the stage.
- `%elidable T...`: the elidable terminators; repeated directives add up.

**Names.** A name whose first character is `A` to `Z` is a terminal; the DOM writes both kinds as `ref`, and lowering tells them apart by that first letter. Any other name is a rule reference, and must be defined in the stage, or it is an error. `#`, the free-modifier slot, is a rule's name like any other. A quoted string or a phoneme tag is a terminal.

## 3. Lowering

Productions are written here `lhs → symbols`, which is not jbogenbau but the context-free grammar a jbogenbau grammar is lowered to.

A grammar is lowered to a context-free grammar of productions, given the set of enabled features. The lowered grammar is what the parser runs; lowering decides nothing a user can observe except through §4-§6.

1. An alternative whose guards do not all hold is dropped. `@f` holds when `f` is enabled, `@¬f` when it is not.
2. Each remaining alternative is expanded into sequences of symbols. `(a | b)` expands to both, in written order. `[x]` is a helper `h → ε | x`. `x ...` is a helper `h → x | h x`; `[x] ...` is `h → ε | h x`. `A₁ & … & Aₙ`, with at most 16 items (more is an error of the document, §9, since the expansions number 2ⁿ−1), expands to every non-empty subsequence that keeps their order, in the order of the binary numbers 1 to 2ⁿ−1, `A₁` being the lowest bit. `ε` is the empty sequence. A sequence's expansions are the products of its items' expansions, the first item varying slowest.
3. **Trailing repetition.** An alternative that is the only alternative of its rule left after step 1, and whose expression is `x ...` or `[x] ...` or a sequence ending in one, is lowered as left recursion on the rule itself: `r → p x ...` becomes `r → p x | r x`, and `r → p [x] ...` becomes `r → p | r x`. Its intermediate prefixes are then constituents of `r`, which the ranking sees (§6); this is how CLL's YACC grammar realizes `...`, and CLL says left grouping is implied. The recursive productions have none of the alternative's captures, whose parts lie inside the inner `r`, so an alternative lowered this way that captures anything is an error of the grammar, found when the grammar is lowered for features that leave the alternative alone in its rule.
4. Helpers are named by the engine; their names are never shown. A helper is a production whose left side is a helper name.
5. A capture `$x(s)` must wrap a single symbol `s` in a sequence at the top level of an alternative: not inside `[ ]`, `...`, `( )`, `&`. It labels the symbol's position in the production. At most four captures per alternative. `$`, the whole constituent, is a capture of every production that no alternative writes: its span runs from the item's origin to its end, and its tags are the constituent's (§4).
6. Conditions, tags and emission attach to the production an alternative lowers to, or each production if it expands to several, with the clauses of the alternative's definition (§2). A production **has** a capture if its alternative captures it; every production has `$`. Before a clause is attached, it is **simplified** for the production: each presence test `$x` (§10) becomes true or false as the production has `x` or not; `A ⟹ B` becomes `B` where `A` is then true, and true, as a condition, or the empty set, as a term, where `A` is false; a condition `A ⟹ B` whose `B` is then true becomes true, and one whose `B` is false becomes `¬A`; `¬`, `∧` and `∨` over a true or false part are reduced as logic says; and a term's empty set, written `∅` or left by a guard, is dropped from a union, a union of nothing but empty sets is the empty set, as is an intersection with one, and a guarded term whose term is the empty set is the empty set. Since a reduced part is never evaluated, the reduction is part of the order of evaluation (§10). A capture that is still mentioned after simplification is **used** by the clause.
   - A condition applies to a production if it has not simplified to true and the production has every capture it uses; otherwise it is dropped for that production. A condition that simplifies to false applies, and removes the production: `%conditions $x` keeps the alternatives that capture `x` and removes the others.
   - An emission item naming a capture the production lacks is dropped from that production's emission.
   - A tag term, the alternative's own or the definition's `%tags`, that uses a capture the production lacks is an error of the document.
7. A production's tags are the union of its alternative's own tag term and its definition's `%tags` term, where either is written. A production with neither has the tags of its symbol's constituent if it has one symbol, and none if it has several; lowering makes this explicit by treating the single symbol as captured.
8. An optional `[x]` is **elidable** when `x` is a symbol, or a sequence whose first item is, recursively, one, and that symbol is an `%elidable` terminal; an optional whose content is a choice or an `&` is never elidable, even if every branch begins with an elidable terminal. `elision-only` checking (§7) lowers the grammar a second time with every elidable optional made mandatory: its helper loses `ε`.

**Numbering.** Productions are numbered from 0, and the number is the tie-break of §6. A production that a condition false for it removes (§3.6) takes no number, though the helpers of its alternative still do. Rules are taken in the order they were first defined after stitching: a rule replaced with `%redefine-rule` keeps the place of the rule it replaces, and alternatives added with `%extend-rule` follow the rule's own. Within a rule its remaining alternatives are taken in order, and each alternative contributes, in this order:

- its own productions, in the order of its expansions (step 2); for a trailing repetition, the non-recursive productions first and then the recursive ones;
- then its helpers, one for each place in the alternative where `[ ]` or `...` is written, in the order those places are written, left to right; each helper's productions are followed at once by the helpers of the places written inside it, depth first, before the next helper of the alternative. The `...` of a trailing repetition (step 3) has no helper: it is lowered into the rule's own productions, though sugar inside its item has helpers as anywhere else.

A repetition whose item can match nothing is allowed: its derivations that repeat nothing are cyclic (§4) and are not counted.

A helper is shared by every expansion of the alternative that goes through its place, so an item of `&`, or the repeated item of a trailing repetition, has one helper however many expansions use it.

## 4. Recognition

The parser is an Earley recognizer over the lowered grammar. It is specified by the set of items it produces; any algorithm producing that set is correct.

**Items.** An item is a production, a dot position, an origin, and, for each capture before the dot, the captured part's span and tag set. Two items equal in all of these are one item; two that differ in a captured part's tag set are two items, even over the same span. Derivations that differ in nothing a condition or tag clause can see therefore share an item, and a left-recursive rule over captured parts stays linear in the input.

**Terminals.** A terminal `T` matches a token whose tags contain `T`, strong or weak.

**Tags of a constituent.** When an item completes, its constituent's tags are its production's tag terms evaluated over its captured parts (§10) and joined as §3.7 says. A completed item has exactly one tag set; derivations of the same production over the same span with different tag sets are different items (they differ in a captured part) or have equal tag sets.

**Conditions.** A condition, as simplified for its production (§3.6), is evaluated as soon as the item has read the last capture it uses, and one that uses `$` as soon as the item is complete, when `$` spans from the item's origin to the set it completes in and has the tags its production's tag term gives it. If it fails, the advanced item is not produced. A condition that uses no capture is evaluated when the item is predicted, as is one that uses only `$` in a production with no symbols, over the empty span there.

**Nested parses.** `matches(span, rule)` and `tags(span, rule)` parse the span's tokens alone with `rule` as the start rule, over the same lowered grammar. They read the recognizer's items: `matches` holds when a completed item of `rule` spans the tokens, and `tags` is the union of those items' tag sets, whether or not an item's every derivation is cyclic. An implementation should remember their answers for the whole parse, keyed by everything a nested parse can observe: the rule, the original text the span covers from its first token's source start to its last token's source end, and, for each token of the span, its tags with their strengths, its text and its phonemes. Tags alone are not enough, since a condition may read `text()`, which includes what lies between the tokens. If, while such a parse of span `S` as `R` is running, a condition asks for `S` as `R` again, the grammar defines `R` by its own negation over the same text: that is an error of the grammar, reported with the span and the rule, and the whole parse fails with it.

**Derivations** are finite trees, and a derivation in which a constituent has, anywhere below it, a constituent of the same rule over the same span is not counted, since such a derivation could repeat without end: with `a → b` and `b → a | A`, `A` has one derivation as `a`, not infinitely many, and so does the empty text as `t` with `t → u | ε` and `u → t`.

**Acceptance.** The input is accepted when an item of the start rule `text` spans the whole input and has at least one derivation that is counted. An input whose every such derivation is cyclic is rejected, as one with no such item is. A rejected input reports the furthest position any item reached, and the terminals the items there could have read next, together with the rules those items belong to (§11).

## 5. Phonemes and text

A token's `phonemes`:

- if its tag set holds a strong phoneme tag `/p/`, `p`: the pause, `/./`, is `.`. Two strong phoneme tags on one token are an error of the grammar that emitted it. A phoneme tag is a tag of exactly three code points, the first and last `/`;
- otherwise, the phonemes of the tokens it covers, the stage's input tokens in its span, joined in order, leaving out every token inside a constituent that does not count (§11), the token's own constituent included when its own rule does not count and a parent emits it as a capture; then each run of pauses, `.`, is made one, and a pause at either end is removed;
- a character token has none.

An emitted token always has phonemes, possibly the empty string; only the character tokens of the first stage have none.

`phonemes(span)` in a condition is the concatenation of the span's tokens' phonemes. `text(span)` is the original text of the span, from the start of its first token's source to the end of its last. `words(span)` is `phonemes(span)` split at pauses, `.`, empty strings dropped.

## 6. Choosing a parse

A derivation is read as its sequence of actions in bottom-up order: a **read** of a token as a terminal, and a **close** of a production over a span. Closes of helper productions and of productions with exactly one symbol are **transparent**: they are part of the sequence, but two sequences never differ at one. Two reads are the same action when they read the same token as the same terminal. Two closes are the same when they close the same production over the same span.

Two derivations of the same input are compared at their first differing visible action:

1. Both read the same token as different terminals: if one terminal is weak on the token and the other strong, the strong one wins; otherwise the two are **tied**.
2. One reads and the other closes: `greedy` prefers the read, `lazy` the close.
3. Both close, different productions or different spans: **tied**.

If the visible sequences are equal, or one is a proper prefix of the other, the two are tied. Their first difference, for the witness below, is the first pair of differing actions of the whole sequences, transparent ones included; a derivation whose visible sequence is a proper prefix of the other's differs from it where the shorter ends.

The **winner** is a derivation that no other derivation beats. The verdict is `unique` if the input has one derivation, `resolved` if it has several and one winner that is not tied with any other derivation at its first difference with it, and `tie` otherwise.

The derivations are put in a canonical order, *T*, and the first is **chosen**. *T* compares two derivations first by their visible sequences:

- at their first differing visible pair, by rules 1 to 3 where those decide, and otherwise by the **canonical keys**: a read before a close; two reads by terminal, in code point order; two closes by production number, then span start, then span end;
- if one visible sequence is a proper prefix of the other, the shorter comes first;
- if the visible sequences are equal, at the first differing pair of the whole sequences by the canonical keys, the shorter first if one whole sequence is a prefix of the other.

*T* is lexicographic on the visible sequences and then on the whole ones, so it is a total order. The chosen derivation, `m`, is its least element, whatever the verdict.

Nothing beats `m`, since whatever beats a derivation precedes it in *T*. So an undominated derivation other than `m` is **tied with `m`**: its first difference with `m` is a tie. The converse does not hold. In `text → A X | B X | B Y`, over a token tagged `A` and `B` and one tagged `Y` and weakly `X`, `m` is `A X`, and `B X` is tied with it but loses to `B Y`.

Of the derivations tied with `m`, the **tied** derivation reported beside `m` is the one that diverges from `m` earliest: the fewest visible actions before its first visible difference with `m`, where a derivation whose visible sequence is a proper prefix or an extension of `m`'s diverges where the shorter ends, and one whose visible sequence equals `m`'s diverges last; several that diverge at the same point are ordered by *T*. That derivation, `t`, is undominated. A derivation that beat `t` before `t` diverges from `m` would beat `m`, which nothing does. One that beat `t` later would share `t`'s divergence from `m`. One that beat `t` just where `t` diverges would beat `m` there too, or be tied with `m` there, since an action that beats one tied with `m`'s cannot lose to `m`'s. Either way it would be tied with `m`, diverge no later than `t`, and precede `t` in *T*. So the verdict is `tie` exactly when some derivation is tied with `m`. In the example, `t` is `B Y`. It shows the first point at which the text could be read another way. The **witness** is the pair of actions at the first difference between `m` and `t`, visible if there is one.

**Computing it.** Both `m` and the earliest-diverging tied derivation compose over the packed forest: an implementation keeps, for each item, its *T*-least derivation and the earliest-diverging derivations tied with it. It keeps several candidates side by side while their order is not yet settled: while one's visible sequence is a prefix of another's, or while their visible sequences are equal and one whole sequence is a prefix of the other, since what follows decides. When one candidate beats another under `greedy` or `lazy`, the loser's tied derivation stays tied with the winner exactly when it diverged from the loser before the point where the winner beat it; one that diverged there is beaten there too. Under rule 1 alone (§7) tying is not transitive, since a close is tied with a weak read and with the strong read that beats it: a tied derivation of the loser that diverged there with a close is still tied with the winner, so an implementation checks such a derivation against the winner itself. So nothing needs to be enumerated, and the number of derivations, which can be exponential, never matters.

## 7. Elision-only

When the stage's directive has `elision-only`, or the caller asks for it, and the verdict is not `unique`:

1. Take the chosen tree's elided terminators (§12) in text order, inner before outer where several are at one position. Before the input token at each one's position, insert a synthetic token whose tags are that terminal, strong, and whose span and source are empty at that position.
2. Parse the new token sequence with the grammar lowered as in §3.8.
3. Rank that forest using only rule 1 of §6: two derivations differing first anywhere else are tied. If one derivation is left, the check passes and the result is the original one. Otherwise the result is an error of kind `ambiguous`: `ok` is false, and the error carries two readings, the chosen derivation of that ranking and the tied one reported beside it, shown over the original input, the written-back terminators as elided nodes. The result's `tree` is null. The stage keeps its verdict, witness, tied tree and output, since it accepted its input; the error has no `token` or `source`, the readings showing where they differ.

The elided terminators are taken in the order of the chosen tree's leaves, left to right. If the parse of step 2 accepts nothing, the check passes.

A caller may also switch the check off for a stage that declares it.

## 8. Reading grammar documents

A grammar document is Markdown. Its grammar text is the content of every fenced code block whose info string is `jbogenbau`, in order: a fence is a line of three or more backticks or tildes, optionally indented up to three spaces, followed by the info string; a backtick fence whose info string holds a backtick is not a fence, as in CommonMark. The info string is `jbogenbau` when it is exactly that once leading and trailing whitespace is removed. A block ends at a line holding only a fence of the same character at least as long, indented up to three spaces and followed by nothing but whitespace. A `jbogenbau` block that is never closed is an error of the document, reported at its opening fence; any other unclosed block runs to the end of the document, as in CommonMark. Every character of the grammar text keeps its line and column in the document, and the blocks are joined with a newline between them.

The grammar text is parsed with the notation dialect, `grammars/dialects/notation.md`, whose DOM ships as `grammars/notation/bootstrap.json`. The tree it produces is turned into the document's DOM by the rules in §9. An implementation reads the bootstrap DOM, not the notation documents, to parse any grammar, the notation documents included; reading the notation documents with the bootstrap must reproduce the bootstrap exactly (the fixpoint). An implementation may keep DOMs it has already built, keyed by the document's text hash, the bootstrap's hash and the DOM format version (`docs/output.md`), and must treat a mismatch of any of the three as a miss. The hash is 64-bit FNV-1a over the text's UTF-8 bytes, written as 16 lower-case hexadecimal digits. Every package ships `compiled.json` beside its grammars, holding the DOM of each bundled grammar document in this way.

## 9. From notation tree to DOM

The notation's syntax grammar names its constituents so that the DOM can be read off the tree: every rule of `grammars/notation/syntax.md` whose name appears in this table maps as shown, and every other rule is transparent, its children taken in order.

| rule | DOM |
| --- | --- |
| `directive` | a directive: name from its `directive-name` without `%`, arguments from its `argument-word`s |
| `rule` | a rule: `define`, `redefine` or `extend` from its `definer`, `%rule`, `%redefine-rule` or `%extend-rule`; name from its `rule-name`, a name or `#`; alternatives from its `body`; tags from its `tags-clause`; conditions from its `conditions-clause`; emission from its `emits-clause` |
| `alternative` | guards from its `guard`s (`@f` or `@¬f`), expression from its `conjunction`, tags from `alternative-tags` |
| `choice` | `choice` of its `conjunction`s, or the one conjunction itself |
| `conjunction` | `and` of its `sequence`s, or the one sequence itself |
| `sequence` | `seq` of its `element`s, or the one element itself |
| `element` | its `primary`; followed by `...`, `repeat` with `min` 1, or with `min` 0 if the primary is an `optional`, which is then unwrapped |
| `reference` | `ref`, the name, or `#` |
| `string` | `terminal`, the decoded string |
| `phoneme` | `terminal`, the token's text `/p/` |
| `capture` | `capture`, the name without `$`, of its primary, which must be a `reference`, `string` or `phoneme` |
| `group` | its `choice` |
| `optional` | `optional` of its `choice` |
| `empty` | `empty` |
| `tags-clause` | its `term` |
| `conditions-clause` | its `implication`s, each one condition of the list, in order |
| `emits-clause` | `items` of its `emit-item`s, each a capture, `""` for `$`, with the term of its `emit-tags` if it has one, or an inserted tag from a string or phoneme; no items for `ε` |
| `implication` | `if` of its `any-of` and the `implication` after `⟹`, or the one `any-of` itself |
| `any-of` | `any` of its `all-of`s, or the one `all-of` itself; an `all-of` that is itself an `any` gives its conditions in its place |
| `all-of` | `all` of its `condition`s, or the one condition itself; a `condition` that is itself an `all` gives its conditions in its place |
| `condition` | its comparison, call, negation or presence, or the `implication` between its parentheses, which makes no node of its own |
| `comparison` | the comparator and its two terms |
| `negation` | `not` of its condition |
| `presence` | `captured`, the name without `$`, `""` for `$` |
| `call` in a condition | `matches`, which is the only function a condition calls directly |
| `term` | its `union` or its `guarded-term` |
| `guarded-term` | `if` of its `any-of` and its `term` |
| `union`, `intersection` | `union`, `intersection` of the parts, or the one part itself |
| `weak`, `empty-set`, `capture-reference` | `weak`, `emptySet`, a span `capture`, `""` for `$` |
| `call` in a term | `call` with its arguments; a bare name as the second argument of `tags` or `matches` is a rule name |

A rule with any other name is transparent: its children are read in its place. Every restriction the grammar does not state is an error of the document, reported at the first token of the offending construct:

- a capture wrapping anything but a reference, a string or a phoneme, `$x((B))` included; `$` wrapping anything; or a capture name used twice in one alternative;
- a function that does not exist, or called with the wrong arguments: `phonemes`, `text`, `words`, `classes`, `head`, `tail` and `last` take one span, `lowercase` one string, `tags` a span and optionally a rule name, and `matches` a span and a rule name. A span is a capture or `head`, `tail` or `last` of one; a string is a quoted string, a phoneme tag, or `phonemes`, `text` or `lowercase` of something;
- `head`, `tail` or `last` where a value is needed, and `matches` as a term;
- an `&` of more than 16 items;
- an expression, a term or a condition nested more than 256 deep: in the DOM (docs/output.md), no node of one may lie below more than 256 compound nodes of it, a compound node being one of `optional`, `repeat`, `and`, `choice`, `seq` and `capture` in an expression; `union`, `intersection`, `if` and `call` in a term; `any`, `all`, `not`, `if`, `matches` and a comparison in a condition. The condition of a guarded term counts on from the term's depth, as a comparison's terms count on from the condition's. `( )` makes no node, so it adds nothing; 256 nested `[ ]` around a symbol are allowed, and 257 are not;
- `$` with items other than `$`; tags on an inserted tag; `∅` as an item's tags, which is a token no terminal reads; a capture other than `$` listed twice in one emission;
- a rule's or an alternative's tag term that reads the tags it defines: `$`, `tags($)` or `classes($)` in it; `tags(head($))` and the like read the tokens' tags, not the constituent's, and are allowed, as is `tags($, R)`;
- an unknown directive, which the syntax grammar already refuses.

A definition (§2) is checked as a whole once it is read, and these are errors of the document too, reported at the definition:

- a capture, in any clause, `$x` presence tests included, that no alternative of the definition captures;
- a condition that applies (§3.6) to no alternative of the definition, whatever features are enabled;
- a tag term that uses (§3.6) a capture that an alternative it serves lacks: an alternative's own tags serve that alternative, `%tags` every alternative of the definition, and an emission item's tags every alternative in which the item is not dropped;
- in an emission, captures listed in an order other than the one in which some alternative that has them captures them; an inserted tag whose anchor, the capture listed next after it, is one that some alternative of the definition lacks; or an alternative for which every item is dropped, so that it would emit nothing although the rule lists what to emit; a rule that emits nothing says so with `ε`.

A string's decoding: the quotes are removed, `\\` is `\`, `\"` is `"`, and `\u{h...}` is the code point with that hexadecimal value; any other `\` is an error.

## 10. Terms and conditions

**Spans.** A capture `$x` is the span of the captured part, and `$` the span of the whole constituent (§3.5); `head(s)` its first token, `tail(s)` all but the first, `last(s)` its last token, each empty if the span is.

**Values.** A term is a string, a tag set, or a list:

| term | value |
| --- | --- |
| `"s"`, `/p/` | the string (`/p/` with its slashes), or as a tag set the one strong tag |
| `$x`, `$` | the captured part's tags, or the constituent's, as `tags($x)` |
| `?"s"` | the tag set of one weak tag |
| `∅` | the empty tag set |
| `a ∪ b`, `a ∩ b` | union, intersection; `∩` binds tighter |
| `A ⟹ t` | `t` where the condition `A` holds, else `∅` |
| `phonemes(s)`, `text(s)` | strings (§5) |
| `lowercase(t)` | `t` with each code point replaced by its simple lowercase mapping, the `lower` entries of `grammars/unicode.txt` |
| `tags(s)` | the captured part's constituent tags if `s` is a whole capture, else the union of the span's tokens' tags |
| `tags(s, R)` | the union of the tags of every derivation of the span as `R`, empty if none |
| `classes(s)` | the tags of `tags(s)` whose first character is `A` to `Z` |
| `words(s)` | a list (§5) |

A string used where a tag set is needed is the set of that one strong tag, and a list the set of its strings, each a strong tag, so that `=` between two lists compares the words they hold and not their order or number.

**Conditions.** `a = b` and `a ≠ b` compare two strings, or two tag sets by their tags alone, ignoring strength. `a ∈ b` and `a ∉ b` test a string in a list or a tag set. `a ⊆ b` tests that every tag of `a` is in `b`. `matches(s, R)` holds when the span parses as `R`. `$x`, as a condition, holds when the production has the capture `x` (§3.6), and `$` always. `¬c` negates. Conditions joined by `∨` hold when any does, and those joined by `∧` when all do. `A ⟹ B`, a condition, holds when `A` does not or `B` does; `⟹` binds looser than `∨`, which binds looser than `∧`, it groups to the right, and parentheses group.

**Order of evaluation.** Evaluating a condition may run a nested parse, which may fail with an error of the grammar (§4), so which parts are evaluated is observable. Conditions joined by `∧` or `∨` are evaluated from left to right, and evaluation stops at the first that decides the whole: a false one for `∧`, a true one for `∨`. `A ⟹ B` evaluates `A` first, and `B` only if `A` holds; a guarded term `A ⟹ t` likewise evaluates `t` only if `A` holds.

**Guarded terms.** `A ⟹ t`, where `A` is a condition, is the value of `t` as a tag set where `A` holds, and the empty tag set where it does not. A guarded term binds looser than `∪` and `∩`, so it stands in parentheses inside either.

## 11. Emission

Every stage that accepts its input emits tokens by walking its chosen tree from the left, the last stage included, whose tokens are its output (`docs/output.md`), though no stage reads them.

- A constituent whose production has no emission is walked: its children in order. A token read directly by it emits nothing.
- A constituent whose production has an emission emits exactly the items of the emission, as dropped for its production (§3.6), in the order they are listed, and nothing inside it is walked:
  - a `$` item emits one token covering the constituent, with the constituent's tags, or with the tags of the item's term if it has one; `$ <t>, $ <u>` emits one such token per item, in order, all with the same span and source, as a digit that stands for a two-phoneme word is two tokens over one character;
  - a capture item emits one token covering the captured part, with the part's own tags, or with the tags of the item's term;
  - an inserted tag, a string or phoneme tag, emits a token with that one strong tag and an empty span.
- A constituent whose production's emission is `ε`, no items, emits nothing and **does not count**: nothing inside it is part of the phonemes of a token that covers it (§5). It is how a grammar erases text, which is still there, and still covered by the tokens around it, but counts for nothing. A part that an emission merely does not list is not emitted, but counts.

An item's tag term that gives the empty set is an error of the grammar, found while parsing: no terminal could read the token.

An emitted token's span is the range of the stage's input tokens its constituent covers; its `source` runs from the source start of the first of them to the source end of the last; its phonemes are as in §5. An inserted token's span is empty at the start of the part of the capture listed next after it, or at the end of the constituent if no capture is listed after it; its source is empty at the source end of the input token before that position, or at the source start of the constituent if the position is the constituent's start.

**Ties.** A stage whose verdict is `tie` emits its chosen derivation, and the tie is reported, at whichever stage it is. A tie is a property of the grammar that the grammar should settle, and the engine does not hide one even where the tied derivations would emit the same tokens.

## 12. The tree

The result's tree is built from the chosen derivation:

- a closed production of a rule the author wrote is a `rule` node, its children in order;
- a read token is a `token` node holding the index of the input token and the terminal it was read as;
- helper productions are spliced out: their children take their place;
- the prefixes of a trailing repetition (§3.3) are spliced out, so the rule is one node whose children are its items in order;
- an elidable optional (§3.8) that is absent becomes an `elided` node for its terminal `T`, with an empty span at the position where it would have been.

A node with an empty span, an `elided` node or a rule that read nothing, has an empty source at the source end of the input token before its position, or, at position 0, at the source start of the first input token, or 0 if there is none.

## 13. The pipeline

A dialect is a pipeline document (`docs/design.md`, "Pipelines"). The first stage reads the character tokens of §1; each later stage reads the tokens the one before emitted. The features enabled for every stage are those the pipeline declares with `<?features?>` together with the caller's. A stage that rejects its input ends the run with that rejection; an `ambiguous` error (§7) ends it likewise. The result's `ok` is true when every stage run accepted without an error.

**Auto features.** When the caller asks for auto features, `sa-su` is not already enabled, and the run reaches a stage named `words` (it has one, and `until`, if given, names it or a later stage), the stages up to and including the one named `words` are run once without it. If that run does not end with the `words` stage accepting, for any reason, a rejection or an error in it or in a stage before it, or if its chosen tree has a constituent of the rule `word` whose phonemes are `sa` or `su`, its phonemes being those of the tokens it covers joined as `phonemes()` joins them (§10), with nothing left out, collapsed or trimmed, the parse is run with `sa-su` added; otherwise that first run's stages are the parse's, continued to the end.

**Mistakes of the caller**, such as an `until` that names no stage, are errors of kind `usage`, raised or returned as a load error is, not results. A grammar error found while parsing, such as a nested parse asked about its own span, is a result: its error has kind `grammar`, the `stage` it arose in and a message, and no position.
