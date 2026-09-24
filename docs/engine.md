# The gencmu engine

This is the specification every gencmu library implements. It says what a
result is, not how to compute it, except where the only reasonable way to
compute it is part of what it is. Where two implementations could differ, it
says which is right. The cases in `tests/engine/` and `tests/notation/` are
part of the specification: an implementation that disagrees with one of them
is wrong, and a case that disagrees with this text is a bug in one or the
other, fixed in the same change.

`docs/notation.md` explains the notation to grammar authors, and
`grammars/notation/` defines it. `docs/output.md` defines the result's JSON
and the renderings.

## 1. Tokens

Everything a stage reads and writes is a sequence of tokens. A token has:

- `tags`: a set of tags, each a string, each strong or weak;
- `span`: the half-open range of the previous stage's tokens it covers;
- `source`: the half-open range of the original text it covers, in Unicode
  code points;
- `text`: the original text over `source`;
- `phonemes`: what the token sounds like (§5);
- `insertedBy`: for a token an emission clause inserted from a quoted tag
  or a phoneme tag (§11), the rule whose clause it is; otherwise absent,
  even for a token of `⇒ this` over an empty constituent.

The input of the first stage is the text's characters, one token per code
point `c` at position `i`: `span` and `source` are `[i, i+1)`, `text` is `c`,
and `tags` are `c` itself, strong, and one class tag, weak, the first that
applies of:

- `space`: U+0009 to U+000D, U+0020, U+0085, U+00A0, U+1680, U+2000 to
  U+200A, U+2028, U+2029, U+202F, U+205F, U+3000;
- `digit`: U+0030 to U+0039;
- `mark`: a `mark` range of `grammars/unicode.txt` (General_Category Mn);
- `alpha`: an `alpha` range of it (General_Category Lu, Ll, Lt, Lm or Lo);
- `other`: anything else.

`grammars/unicode.txt` is generated from one version of the Unicode
Character Database, which it names, by `tools/unicode-table.py`, and every
library uses it rather than its platform's Unicode data, so that the four
agree on every character. A character token has no phonemes.

A tag set is a map from tag to strength. The union of two sets holds every
tag of either, strong if it is strong in either. The intersection holds the
tags of the first that are in the second, with the first's strength.

## 2. Grammars

A grammar is the stitching of one or more documents (§8, §9) into a set of
rules and directives. A rule has a name and alternatives; an alternative has
guards, an expression, and optionally tags; a rule optionally has rule-level
tags, an emission clause and conditions. The grammar DOM, in
`docs/output.md`, is the exact data.

**Stitching.** Documents are read in order, and each document's rules in
order. A rule defined with `≔` replaces any rule of that name from an
earlier document; defining a name with `≔` twice in one document is an
error. A rule written with `|≔` appends its alternatives to the rule of that
name defined before it, in an earlier document or earlier in the same one,
keeping its own clauses separately (below); if none was defined before it,
that is an error. The loader records every replacement and extension.

When `|≔` extends a rule, each appended alternative carries the extending
document's rule-level tags, emission and conditions, which apply to it
alone; the earlier alternatives keep theirs. So a script document can add
letters to a rule without restating its clauses, and its own clauses do not
leak into the base rule.

**Directives** are collected from all the stage's documents:

- `%ambiguity-resolution L [elision-only]`, `L` being `greedy` or `lazy`:
  exactly one per stage, or it is an error naming the stage.
- `%elidable T...`: the elidable terminators; repeated directives add up.
- `%free-modifiers R`: `#` means `[R ...]`, zero or more `R`; at most one
  per stage, and `#` without one is an error.

**Names.** A name whose first character is `A` to `Z` is a terminal; the DOM writes both kinds as `ref`, and lowering tells them apart
by that first letter. Any other name is a rule reference, and must be defined in the
stage, or it is an error. A quoted string or a phoneme tag is a terminal.

## 3. Lowering

A grammar is lowered to a context-free grammar of productions, given the set
of enabled features. The lowered grammar is what the parser runs; lowering
decides nothing a user can observe except through §4-§6.

1. An alternative whose guards do not all hold is dropped. `@f` holds when
   `f` is enabled, `@!f` when it is not.
2. Each remaining alternative is expanded into sequences of symbols. `(a |
   b)` expands to both, in written order. `[x]` is a helper `h ≔ ε | x`.
   `x ...` is a helper `h ≔ x | h x`; `[x] ...` is `h ≔ ε | h x`.
   `A₁ & … & Aₙ` expands to every non-empty subsequence that keeps their
   order, in the order of the binary numbers 1 to 2ⁿ−1, `A₁` being the
   lowest bit. `#` is `[R] ...` for the declared `R`. `ε` is the empty
   sequence. A sequence's expansions are the products of its items'
   expansions, the first item varying slowest.
3. **Trailing repetition.** An alternative that is the only alternative of
   its rule left after step 1, and whose expression is `x ...` or `[x] ...`
   or a sequence ending in one, is lowered as left recursion on
   the rule itself: `r ≔ p x ...` becomes `r ≔ p x | r x`, and `r ≔ p [x] ...`
   becomes `r ≔ p | r x`. Its intermediate prefixes are then constituents of
   `r`, which the ranking sees (§6); this is how CLL's YACC grammar realizes
   `...`, and CLL says left grouping is implied. A trailing `#` is not a
   trailing repetition, although it stands for one.
4. Helpers are named by the engine; their names are never shown. A helper
   is a production whose left side is a helper name.
5. A capture `$x(s)` must wrap a single symbol `s` in a sequence at the top
   level of an alternative: not inside `[ ]`, `...`, `( )`, `&`. It labels the
   symbol's position in the production. At most four captures per
   alternative.
6. Conditions, tags and emission attach to the production an alternative
   lowers to, or each production if it expands to several. A condition
   applies to a production only if the production has every capture the
   condition mentions; otherwise it is dropped for that production. Tags
   likewise: the alternative's own tags if it has them, else the rule-level
   tags, and if either mentions a capture the production lacks, the
   production has default tags (§4). An emission item naming a capture the
   production lacks is dropped from that production's emission.
7. A production with one symbol and no tags has the tags of that symbol's
   constituent; one with several symbols and no tags has none. This is
   stated in §4; lowering makes it explicit by treating the single symbol as
   captured.
8. An optional `[x]` is **elidable** when `x` is a symbol, or a sequence
   whose first item is, recursively, one, and that symbol is an `%elidable`
   terminal; an optional whose content is a choice or an `&` is never
   elidable, even if every branch begins with an elidable terminal.
   `elision-only` checking (§7) lowers the grammar a second time with every
   elidable optional made mandatory: its helper loses `ε`.

**Numbering.** Productions are numbered from 0, and the number is the
tie-break of §6. Rules are taken in the order they were first defined after
stitching: a rule replaced with `≔` keeps the place of the rule it
replaces, and alternatives added with `|≔` follow the rule's own. Within a
rule its remaining alternatives are taken in order, and each alternative
contributes, in this order:

- its own productions, in the order of its expansions (step 2); for a
  trailing repetition, the non-recursive productions first and then the
  recursive ones;
- then its helpers, one for each place in the alternative where `[ ]`,
  `...` or `#` is written, in the order those places are written, left to
  right; each helper's productions are followed at once by the helpers of
  the places written inside it, depth first, before the next helper of the
  alternative. The `...` of a trailing repetition (step 3) has no helper:
  it is lowered into the rule's own productions, though sugar inside its
  item has helpers as anywhere else.

A repetition whose item can match nothing is allowed: its derivations that
repeat nothing are cyclic (§4) and are not counted.

A helper is shared by every expansion of the alternative that goes through
its place, so an item of `&`, or the repeated item of a trailing
repetition, has one helper however many expansions use it.

## 4. Recognition

The parser is an Earley recognizer over the lowered grammar. It is specified
by the set of items it produces; any algorithm producing that set is
correct.

**Items.** An item is a production, a dot position, an origin, and, for each
capture before the dot, the captured part's span and tag set. Two items
equal in all of these are one item; two that differ in a captured part's
tag set are two items, even over the same span. Derivations that differ in
nothing a condition or tag clause can see therefore share an item, and a
left-recursive rule over captured parts stays linear in the input.

**Terminals.** A terminal `T` matches a token whose tags contain `T`,
strong or weak.

**Tags of a constituent.** When an item completes, its constituent's tags
are its production's tag term evaluated over its captured parts (§10), or,
for a production with no term, as in §3.7. A completed item has exactly one
tag set; derivations of the same production over the same span with
different tag sets are different items (they differ in a captured part) or
have equal tag sets.

**Conditions.** A condition is evaluated as soon as the item has read the
last capture it mentions. If it fails, the advanced item is not produced.
A condition that mentions no capture is evaluated when the item is
predicted.

**Nested parses.** `matches(span, rule)` and `tags(span, rule)` parse the
span's tokens alone with `rule` as the start rule, over the same lowered
grammar. They read the recognizer's items: `matches` holds when a completed
item of `rule` spans the tokens, and `tags` is the union of those items'
tag sets, whether or not an item's every derivation is cyclic. An implementation should remember their answers for the whole parse,
keyed by everything a nested parse can observe: the rule, the original text
the span covers from its first token's source start to its last token's
source end, and, for each token of the span, its tags with their strengths,
its text and its phonemes. Tags alone are not enough, since a condition may
read `text()`, which includes what lies between the tokens.
If, while such a parse of span `S` as `R` is running, a condition asks for
`S` as `R` again, the grammar defines `R` by its own negation over the same
text: that is an error of the grammar, reported with the span and the rule,
and the whole parse fails with it.

**Derivations** are finite trees, and a derivation in which a constituent
has, anywhere below it, a constituent of the same rule over the same span is
not counted, since such a derivation could repeat without end: `a ≔ b ; b
≔ a | A ;` has one derivation of `A` as `a`, not infinitely many, and so
does `t ≔ u | ε ; u ≔ t ;` of the empty text as `t`.

**Acceptance.** The input is accepted when an item of the start rule `text`
spans the whole input and has at least one derivation that is counted. An
input whose every such derivation is cyclic is rejected, as one with no
such item is. A rejected input reports the furthest position any
item reached, and the terminals the items there could have read next,
together with the rules those items belong to (§11).

## 5. Phonemes and text

A token's `phonemes`:

- if its tag set holds a strong phoneme tag `/p/`, `p` (a pause `/ /` is a
  space); two strong phoneme tags on one token are an error of the grammar
  that emitted it. A phoneme tag is a tag of exactly three code points, the
  first and last `/`;
- otherwise, the concatenation of the phonemes of the tokens it was emitted
  from, omitting every token of a constituent that emits nothing, with
  leading and trailing spaces removed;
- a character token has none.

An emitted token always has phonemes, possibly the empty string; only the
character tokens of the first stage have none.

`phonemes(span)` in a condition is the concatenation of the span's tokens'
phonemes. `text(span)` is the original text of the span, from the start of
its first token's source to the end of its last. `words(span)` is
`phonemes(span)` split at spaces, empty strings dropped.

## 6. Choosing a parse

A derivation is read as its sequence of actions in bottom-up order: a
**read** of a token as a terminal, and a **close** of a production over a
span. Closes of helper productions and of productions with exactly one
symbol are **transparent**: they are part of the sequence, but two sequences
never differ at one. Two reads are the same action when they read the same
token as the same terminal. Two closes are the same when they close the same
production over the same span.

Two derivations of the same input are compared at their first differing
visible action:

1. Both read the same token as different terminals: if one terminal is weak
   on the token and the other strong, the strong one wins; otherwise the two
   are **tied**.
2. One reads and the other closes: `greedy` prefers the read, `lazy` the
   close.
3. Both close, different productions or different spans: **tied**.

If the visible sequences are equal, or one is a proper prefix of the other,
the two are tied. Their first difference, for the witness below, is the
first pair of differing actions of the whole sequences, transparent ones
included; a derivation whose visible sequence is a proper prefix of the
other's differs from it where the shorter ends.

The **winner** is a derivation that no other derivation beats. The verdict
is `unique` if the input has one derivation, `resolved` if it has several
and one winner that is not tied with any other derivation at its first
difference with it, and `tie` otherwise.

The derivations are put in a canonical order, *T*, and the first is
**chosen**. *T* compares two derivations first by their visible sequences:

- at their first differing visible pair, by rules 1 to 3 where those
  decide, and otherwise by the **canonical keys**: a read before a close;
  two reads by terminal, in code point order; two closes by production
  number, then span start, then span end;
- if one visible sequence is a proper prefix of the other, the shorter
  comes first;
- if the visible sequences are equal, at the first differing pair of the
  whole sequences by the canonical keys, the shorter first if one whole
  sequence is a prefix of the other.

*T* is lexicographic on the visible sequences and then on the whole ones,
so it is a total order. The chosen derivation, `m`, is its least element,
whatever the verdict.

Nothing beats `m`, since whatever beats a derivation precedes it in *T*.
So an undominated derivation other than `m` is **tied with `m`**: its first
difference with `m` is a tie. The converse does not hold. In `text ≔ A X |
B X | B Y ;`, over a token tagged `A` and `B` and one tagged `Y` and weakly
`X`, `m` is `A X`, and `B X` is tied with it but loses to `B Y`.

Of the derivations tied with `m`, the **tied** derivation reported beside
`m` is the one that diverges from `m` earliest: the fewest visible actions
before its first visible difference with `m`, where a derivation whose
visible sequence is a proper prefix or an extension of `m`'s diverges where
the shorter ends, and one whose visible sequence equals `m`'s diverges
last; several that diverge at the same point are ordered by *T*. That derivation, `t`,
is undominated. A derivation that beat `t` before `t` diverges from `m`
would beat `m`, which nothing does. One that beat `t` later would share
`t`'s divergence from `m`. One that beat `t` just where `t` diverges would
beat `m` there too, or be tied with `m` there, since an action that beats
one tied with `m`'s cannot lose to `m`'s. Either way it would be tied with
`m`, diverge no later than `t`, and precede `t` in *T*. So the verdict is `tie` exactly when some derivation
is tied with `m`. In the example, `t` is `B Y`. It shows the first point
at which the text could be read another way. The **witness** is the pair
of actions at the first difference between `m` and `t`, visible if there is
one.

**Computing it.** Both `m` and the earliest-diverging tied derivation
compose over the packed forest: an implementation keeps, for each item, its
*T*-least derivation and the earliest-diverging derivations tied with it.
It keeps several candidates side by side while their order is not yet
settled: while one's visible sequence is a prefix of another's, or while
their visible sequences are equal and one whole sequence is a prefix of the
other, since what follows decides. When one candidate beats another under
`greedy` or `lazy`, the loser's tied derivation stays tied with the winner
exactly when it diverged from the loser before the point where the winner
beat it; one that diverged there is beaten there too. Under rule 1 alone
(§7) tying is not transitive, since a close is tied with a weak read and
with the strong read that beats it: a tied derivation of the loser that
diverged there with a close is still tied with the winner, so an
implementation checks such a derivation against the winner itself. So
nothing needs to be enumerated, and the number of derivations, which can be
exponential, never matters.

## 7. Elision-only

When the stage's directive has `elision-only`, or the caller asks for it,
and the verdict is not `unique`:

1. Take the chosen tree's elided terminators (§12) in text order, inner
   before outer where several are at one position. Before the input token at
   each one's position, insert a synthetic token whose tags are that
   terminal, strong, and whose span and source are empty at that position.
2. Parse the new token sequence with the grammar lowered as in §3.8.
3. Rank that forest using only rule 1 of §6: two derivations differing first
   anywhere else are tied. If one derivation is left, the check passes and
   the result is the original one. Otherwise the result is an error of kind
   `ambiguous`: `ok` is false, and the error carries two readings, the
   chosen derivation of that ranking and the tied one reported beside it,
   shown over the original input, the written-back terminators as elided
   nodes. The result's `tree` is null. The stage keeps its verdict,
   witness, tied tree and output, since it accepted its input; the error
   has no `token` or `source`, the readings showing where they differ.

The elided terminators are taken in the order of the chosen tree's leaves,
left to right. If the parse of step 2 accepts nothing, the check passes.

A caller may also switch the check off for a stage that declares it.

## 8. Reading grammar documents

A grammar document is Markdown. Its grammar text is the content of every
fenced code block whose info string is `ebnf`, in order: a fence is a line
of three or more backticks or tildes, optionally indented up to three
spaces, followed by the info string; a backtick fence whose info string
holds a backtick is not a fence, as in CommonMark. The info string is
`ebnf` when it is exactly that once leading and trailing whitespace is
removed. A block ends at a line holding only a fence of the same character
at least as long, indented up to three spaces and followed by nothing but
whitespace. An `ebnf` block that is never closed is an error of the
document, reported at its opening fence; any other unclosed block runs to
the end of the document, as in CommonMark. Every character of the grammar text
keeps its line and column in the document, and the blocks are joined with a
newline between them.

The grammar text is parsed with the notation dialect,
`grammars/dialects/notation.md`, whose DOM ships as
`grammars/notation/bootstrap.json`. The first bootstrap is produced by the
JavaScript library's pull request, which also adds the fixpoint check that
every library then runs. The tree it produces is turned into the
document's DOM by the rules in §9. An implementation reads the bootstrap
DOM, not the notation documents, to parse any grammar, the notation
documents included; reading the notation documents with the bootstrap must
reproduce the bootstrap exactly (the fixpoint). An implementation may keep
DOMs it has already built, keyed by the document's text hash, the
bootstrap's hash and the DOM format version (`docs/output.md`), and must
treat a mismatch of any of the three as a miss. The hash is 64-bit FNV-1a
over the text's UTF-8 bytes, written as 16 lower-case hexadecimal digits.
Every package ships `compiled.json` beside its grammars, holding the DOM of
each bundled grammar document in this way.

## 9. From notation tree to DOM

The notation's syntax grammar names its constituents so that the DOM can be
read off the tree: every rule of `grammars/notation/syntax.md` whose name
appears in this table maps as shown, and every other rule is transparent,
its children taken in order.

| rule | DOM |
| --- | --- |
| `directive-statement` | a directive: name from the `directive` token without `%`, arguments from its `argument-word`s |
| `rule` | a rule: name from its first token, `define` or `extend` from its `definer`, tags from `rule-tags`, alternatives from `body`, and its `clause`s |
| `alternative` | guards from its `guard`s (`@f` or `@!f`), expression from its `conjunction`, tags from `alternative-tags` |
| `choice` | `choice` of its `conjunction`s, or the one conjunction itself |
| `conjunction` | `and` of its `sequence`s, or the one sequence itself |
| `sequence` | `seq` of its `element`s, or the one element itself |
| `element` | its `primary`; followed by `...`, `repeat` with `min` 1, or with `min` 0 if the primary is an `optional`, which is then unwrapped |
| `reference` | `ref`, the name |
| `string` | `terminal`, the decoded string |
| `phoneme` | `terminal`, the token's text `/p/` |
| `capture` | `capture`, the name without `$`, of its primary, which must be a `reference`, `string` or `phoneme` |
| `group` | its `choice` |
| `optional` | `optional` of its `choice` |
| `hash`, `empty` | `hash`, `empty` |
| `emission` | `nothing` if its only item is the name `nothing`; otherwise `items`: the name `this`, a capture, or an inserted tag from a string or phoneme, each with the term of its `emit-tags` |
| `conditions` | its `condition-item`s appended to the rule's conditions |
| `condition-item` | `any` of its `condition`s, or the one condition itself |
| `comparison` | the comparator and its two terms |
| `negation` | `not` of its condition |
| `call` in a condition | `matches`, which is the only function a condition calls directly |
| `term`, `intersection` | `union`, `intersection` of the parts, or the one part itself |
| `weak`, `empty-set`, `set`, `capture-reference` | `weak`, `emptySet`, `set`, a span `capture` |
| `call` in a term | `call` with its arguments; a bare name as the second argument of `tags` or `matches` is a rule name |

A rule with any other name is transparent: its children are read in its
place. Every restriction the grammar does not state is an error of the
document, reported at the first token of the offending construct:

- a capture wrapping anything but a reference, a string or a phoneme,
  `$x((B))` included, or a capture name used twice in one alternative;
- a function that does not exist, or called with the wrong arguments:
  `phonemes`, `text`, `words`, `classes`, `head`, `tail` and `last` take
  one span, `lowercase` one string, `tags` a span and optionally a rule
  name, and `matches` a span and a rule name. A span is a capture or
  `head`, `tail` or `last` of one; a string is a quoted string, a phoneme
  tag, or `phonemes`, `text` or `lowercase` of something;
- `head`, `tail` or `last` where a value is needed, and `matches` as a
  term;
- `nothing` with other items or with tags; `this` with items other than
  `this`; tags on an inserted tag; a capture listed twice in one emission;
  a second `⇒` clause in one rule;
- an unknown directive; `%free-modifiers` naming a rule the stage does not
  define, or `#` in a stage without it.

A string's decoding: the quotes are removed, `\\` is `\`, `\"` is `"`, and
`\u{h...}` is the code point with that hexadecimal value; any other `\` is
an error.

## 10. Terms and conditions

**Spans.** A capture `$x` is the span of the captured part; `head(s)` its
first token, `tail(s)` all but the first, `last(s)` its last token, each
empty if the span is.

**Values.** A term is a string, a tag set, or a list:

| term | value |
| --- | --- |
| `"s"`, `/p/` | the string (`/p/` with its slashes), or as a tag set the one strong tag |
| `$x` | the captured part's tags, as `tags($x)` |
| `?"s"` | the tag set of one weak tag |
| `∅` | the empty tag set |
| `{a, b, ...}` | the union of the items as tag sets |
| `a ∪ b`, `a ∩ b` | union, intersection; `∩` binds tighter |
| `phonemes(s)`, `text(s)` | strings (§5) |
| `lowercase(t)` | `t` with each code point replaced by its simple lowercase mapping, the `lower` entries of `grammars/unicode.txt` |
| `tags(s)` | the captured part's constituent tags if `s` is a whole capture, else the union of the span's tokens' tags |
| `tags(s, R)` | the union of the tags of every derivation of the span as `R`, empty if none |
| `classes(s)` | the tags of `tags(s)` whose first character is `A` to `Z` |
| `words(s)` | a list (§5) |

A string used where a tag set is needed is the set of that one strong tag.

**Conditions.** `a = b` and `a ≠ b` compare two strings, or two tag sets by
their tags alone, ignoring strength. `a ∈ b` and `a ∉ b` test a string in a
list or a tag set. `a ⊆ b` tests that every tag of `a` is in `b`.
`matches(s, R)` holds when the span parses as `R`. `¬c` negates. Items
joined by `∨` hold when any does; the list items joined by `,` or `∧` must
all hold.

## 11. Emission

A stage that is not the last emits the tokens of the next stage by walking
the chosen tree from the left:

- A constituent whose production has `⇒ nothing` emits nothing, and nothing
  inside it is walked.
- A constituent whose production has `⇒ this` emits one token covering the
  constituent, with the constituent's tags, or with the tags of the item's
  term if it has one. `⇒ this <t>, this <u>` emits one such token per item,
  in the order listed, all with the same span and source: a digit that
  stands for a two-phoneme word is two tokens over one character.
- `⇒ $a <t>, "x", $b` emits, in text order, one token per named capture,
  with the given tags or the captured constituent's own, and one inserted
  token per quoted tag or phoneme tag, with that one strong tag and empty
  span; captured parts not named, and other children, are walked in turn.
  An inserted tag goes immediately before the token of the first capture
  listed after it, and one with no capture listed after it goes after the
  constituent's last child. Captures are emitted in text order whatever
  order the list names them in.
- A constituent with no emission clause is walked: its children in order.
- A token read directly by a production with no emission clause emits
  nothing.

An emitted token's span is the range of the stage's input tokens its
constituent covers; its `source` runs from the source start of the first of
them to the source end of the last; its phonemes are as in §5. An inserted
token's span is empty at the index of the next input token, and its source
is empty at the source end of the input token before it, or at the source
start of the constituent if nothing of the constituent precedes it.

**Ties.** A stage whose verdict is `tie` emits its chosen derivation, and
the tie is reported, at whichever stage it is. A tie is a property of the
grammar that the grammar should settle, and the engine does not hide one
even where the tied derivations would emit the same tokens.

## 12. The tree

The result's tree is built from the chosen derivation:

- a closed production of a rule the author wrote is a `rule` node, its
  children in order;
- a read token is a `token` node holding the index of the input token and
  the terminal it was read as;
- helper productions are spliced out: their children take their place;
- the prefixes of a trailing repetition (§3.3) are spliced out, so the rule
  is one node whose children are its items in order;
- an elidable optional (§3.8) that is absent becomes an `elided` node for
  its terminal `T`, with an empty span at the position where it would have
  been.

A node with an empty span, an `elided` node or a rule that read nothing,
has an empty source at the source end of the input token before its
position, or, at position 0, at the source start of the first input token,
or 0 if there is none.

## 13. The pipeline

A dialect is a pipeline document (`docs/design.md`, "Pipelines"). The first
stage reads the character tokens of §1; each later stage reads the tokens
the one before emitted. The features enabled for every stage are those the
pipeline declares with `<?features?>` together with the caller's. A stage that rejects its input ends the run with
that rejection; an `ambiguous` error (§7) ends it likewise. The result's
`ok` is true when every stage run accepted without an error.

**Auto features.** When the caller asks for auto features, `sa-su` is
not already enabled, and the run reaches a stage named `words` (it has one,
and `until`, if given, names it or a later stage), the stages up to and including the one named `words`
are run once without it. If that run does not end with the `words` stage
accepting, for any reason, a rejection or an error in it or in a stage
before it, or if its chosen tree has a constituent of the rule `word` whose
phonemes are `sa` or `su`, the parse is run with `sa-su` added; otherwise
that first run's stages are the parse's, continued to the end.

**Mistakes of the caller**, such as an `until` that names no stage, are
errors of kind `usage`, raised or returned as a load error is, not results.
A grammar error found while parsing, such as a nested parse asked about its
own span, is a result: its error has kind `grammar`, the `stage` it arose
in and a message, and no position.
