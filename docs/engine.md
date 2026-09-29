# The gencmu engine

This document is the specification that every gencmu library implements. It says what a result is, not how to compute it. It says how only where the only reasonable way to compute a result is part of what the result is. Where two implementations can differ, this document says which one is right. The cases in `tests/engine/` and `tests/notation/` are part of the specification, and an implementation that disagrees with one of them is wrong. A case that disagrees with this text is a bug in one or the other, and the same change fixes it.

`docs/notation.md` explains the notation to grammar authors, and `grammars/notation/` defines it. `docs/output.md` defines the result's JSON and the renderings.

## 1. Tokens

A stage is one step of a pipeline (§13), with its own grammar. Everything a stage reads and writes is a sequence of tokens. A token has:

- `tags`: a set of tags, each a string.
- `span`: the half-open range of the previous stage's tokens that it covers. A half-open range includes its start and excludes its end.
- `source`: the half-open range of the original text that it covers, in Unicode code points.
- `text`: the original text over `source`.
- `phonemes`: what the token sounds like (§5).
- `verbatim`: true for a verbatim token (§11), whose phonemes are its text, and false for any other token.
- `insertedBy`: for a token that an emission clause inserted from a tag literal (§11), the rule that the clause belongs to. For any other token it is absent, even for a token that an emission `$` makes over an empty constituent.

The source of one token or more runs from the least source start among them to the greatest source end. An empty source counts as the point where it lies. Tokens usually lie in the order of their sources. Then this source runs from the source start of the first token to the source end of the last token.

But they need not. An emission lists its captures in the order in which they stand (§9, §11). But an inserted token can have its source before the token ahead of it, or after the token behind it. So can a token over a part that read nothing. An empty span of tokens has no such source: its source is given where it is used (§11, §12).

A tag is one of three kinds, and its kind shows in its first character:

- An identifier tag is a name (§9): an ASCII letter followed by ASCII letters, digits and hyphens.
- A phoneme tag is exactly three code points, whose first and last are `/`, such as `/a/`.
- A character tag is one Unicode scalar value between two quotes, `'`, such as `'a'`. The quotes are part of the tag.

A character tag's identity is its scalar value, so a tag has one canonical spelling. Its canonical spelling is the character itself between the quotes, with five exceptions. The engine writes a control character, U+0000 to U+001F or U+007F to U+009F, as `\u{h...}`. It does the same for a nonspacing mark, which has no base between the quotes. The engine also writes a private-use character so: U+E000 to U+F8FF, U+F0000 to U+FFFFD, or U+100000 to U+10FFFD. The quote and the backslash are the last two exceptions.

A nonspacing mark is a character whose General_Category in `grammars/unicode.txt` is `Mn`. In `\u{h...}`, the hexadecimal digits are upper case, with no leading zeros. So U+0301 is `'\u{301}'`, U+ED80 is `'\u{ED80}'`, and the quote is `'\u{27}'`. Everywhere in the engine and its output, a tag is a string in this canonical spelling. So two tags are equal exactly when their strings are.

The input of the first stage is the characters of the text, one token for each code point `c` at position `i`. For this token, `span` and `source` are `[i, i+1)`, and `text` is `c`. Its `tags` hold one tag, the character tag of `c`, and nothing else. A character token has no phonemes. A grammar reads a class of characters, such as the letters, with a range or a property.

A text is a sequence of Unicode scalar values. A text that is not one is a usage error (§13), and the engine refuses it before it makes any character token. In JavaScript and Python, such a text is a string with a lone surrogate. In Go, it is a string that is not valid UTF-8. A Rust string is always valid. The same holds for a grammar document that the caller supplies as a string.

A library reads a grammar document from disk as strict UTF-8. Bytes that are not valid UTF-8 are a `grammar` error of loading, not a usage error, because the caller supplied no string. The error names the document and says that its bytes do not decode. It has no line and no column. The library finds this before it hashes the document or looks in `compiled.json` (§8). A byte order mark stays in the text as the character U+FEFF.

`tools/unicode-table.py` generates `grammars/unicode.txt` from one version of the Unicode Character Database. Every library uses this file, not the Unicode data of its platform, so that the four libraries agree on every character. The file holds one entry on each line, with code points in hexadecimal:

- `unicode 15.1.0`: the version of the data.
- `category Lu 0041 005A`: a range of code points whose General_Category is `Lu`. The category is in its short form.
- `white-space 0009 000D`: a range of code points that have the White_Space property.
- `lower 0041 0061`: a code point and its simple lowercase mapping.

In the bundled file, each `category` range is a longest run of one category. Together these ranges hold every Unicode scalar value once. `Cn`, the unassigned code points, has its ranges too. The records can stand in any order in a file. Each library sorts them when it loads the file, so their order never changes an answer.

A caller can supply its own `unicode.txt` (`docs/api.md`). That table replaces the bundled data entirely, `White_Space` included, and nothing falls back to the bundled data. So the table must list the white space that the caller's grammar documents use. A table need not hold every scalar value. A scalar value that no `category` range holds has the category `Cn`. One that no `white-space` range holds lacks White_Space, and one with no `lower` entry has no lowercase mapping.

`Cs` belongs only to the surrogates, U+D800 to U+DFFF, and a table lists none of them. A surrogate is not a scalar value, so it never becomes a character tag.

A tag set is a set of tags. A tag has no strength: a set holds it or not. The union holds every tag of either set. The intersection holds their shared tags. The difference holds the first set's tags that the second lacks.

A range, written `'a'..'z'`, is the set of the character tags from its start to its end, by scalar value. Its two ends are character tags. It skips the surrogates, which are not scalar values, so `'\u{D7FF}'..'\u{E000}'` holds two tags. A range whose start is above its end is an error of the document (§9).

A property, written `'\p{Name}'`, holds the scalar values that have a property in `grammars/unicode.txt`. The names are exactly these, and their case counts. Each General_Category value in its short form is a name. So is each group of these values, which holds the values whose short form begins with its letter:

- `L`: `Lu`, `Ll`, `Lt`, `Lm` and `Lo`.
- `M`: `Mn`, `Mc` and `Me`.
- `N`: `Nd`, `Nl` and `No`.
- `P`: `Pc`, `Pd`, `Ps`, `Pe`, `Pi`, `Pf` and `Po`.
- `S`: `Sm`, `Sc`, `Sk` and `So`.
- `Z`: `Zs`, `Zl` and `Zp`.
- `C`: `Cc`, `Cf`, `Cs`, `Co` and `Cn`.

The two other names are `White_Space`, the code points of the `white-space` ranges, and `Any`, every scalar value.

No other name is a property. So `'\p{lu}'` and `'\p{Letter}'` are errors of the document (§9). `'\p{Cs}'` is a property, but no character tag has it, since a character tag is never a surrogate. A property is not a tag set. It stands only as a terminal (§4).

## 2. Grammars

A grammar is the stitching of the items of one stage of a pipeline (§13) into a set of rules and directives. An item is a rule or a directive, read from a document (§8, §9). A rule has a name and alternatives, and optionally rule-level tags, conditions and an emission clause. An alternative has guards, an expression, and optionally tags. The grammar DOM (document object model), in `docs/output.md`, is the exact data.

To stitch a stage's items, the loader reads them in order, whatever documents they come from. Each rule is stated one of three ways, and each is an error in the case given:

- `%rule` (`define`) defines a rule: an error if a rule of that name was defined before it in the stage.
- `%redefine-rule` (`redefine`) replaces the rule of that name defined before it in the stage: an error if none was. The earlier alternatives are then gone, those of any `%extend-rule` of the rule included.
- `%extend-rule` (`extend`) appends its alternatives to the rule of that name defined before it in the stage: an error if none was.

When `%extend-rule` extends a rule, each appended alternative carries the extension's own clauses: its rule-level tags, conditions and emission. These clauses apply to the appended alternatives alone, and the base rule's clauses do not apply to them. The earlier alternatives keep their own clauses. So a script document can add letters to a rule without restating its clauses, and its own clauses do not leak into the base rule. A definition is a `%rule`, `%redefine-rule` or `%extend-rule` statement: its alternatives and the clauses written with them. The loader records every replacement and extension.

The loader collects directives from all the stage's items. `%stage`, `%include` and `%features` shape the pipeline (§13) and do not belong to a stage. The other two directives belong to the stage.

A stage has exactly one `%ambiguity-resolution L [elision-only] [maximal]`, or it is an error naming the stage. `L` is `greedy` or `lazy`. If both `elision-only` (§7) and `maximal` (§4) are written, they stand in that order. `%elidable T...` names the elidable terminators, and repeated directives add up.

A name whose first character is `A` to `Z` is a terminal, the identifier tag of that name. The DOM writes both kinds of name as `ref`, and lowering (§3) tells them apart by that first letter. Any other name is a rule reference, and must be defined in the stage, or it is an error. `#`, the free-modifier slot, is a rule's name like any other.

A tag literal `~name`, a phoneme tag or a character tag is a terminal too. The DOM writes it as `terminal`, the tag. A range and a property (§1) are terminals as well, which the DOM writes as `range` and `property`.

A reference, a tag literal, a phoneme tag or a character tag can carry a spelling: ``LE`la` ``, ``~la`la` ``, ``/a/`a` ``. A spelling is text between backticks after a symbol. It says what the symbol must sound like (§4). A spelled symbol is a symbol with a spelling. The spelling is not part of the name. A terminal with a spelling is the same terminal, and a reference with a spelling refers to the same rule.

## 3. Lowering

This section writes productions as `lhs → symbols`. This is not jbogenbau, the notation of gencmu grammars (`docs/notation.md`), but the context-free grammar that a jbogenbau grammar is lowered to.

Lowering turns a grammar, given the set of enabled features, into a context-free grammar of productions. The lowered grammar is what the parser runs. Lowering decides nothing that a user can observe, except through §4-§6.

1. Lowering drops an alternative whose gates do not all hold. A gate `f?` holds when the feature `f` is on, and `¬f?` when it is off. A warning `f!` is not a gate and never drops its alternative (§12).
2. Lowering expands each remaining alternative into sequences of symbols. `(a | b)` expands to both, in written order. `[x]` is a helper `h → ε | x` (step 4). `x ...` is a helper `h → x | h x`, and `[x] ...` is `h → ε | h x`.

   `A₁ & … & Aₙ` has at most 16 items. More is an error of the document (§9), since the expansions number 2ⁿ−1. It expands to every non-empty subsequence that keeps their order. The subsequences come in the order of the binary numbers 1 to 2ⁿ−1, with `A₁` as the lowest bit. `ε` is the empty sequence. A sequence's expansions are the products of its items' expansions, the first item varying slowest.

   A spelled symbol expands to that one symbol, which carries the spelling. It adds no helper. So the numbering, the transparent closes of §6 and the constituents of a production are those of the symbol without its spelling. Two productions that differ only in the spelling of a symbol are two productions.
3. A trailing repetition is an alternative with two properties. It is the only alternative of its rule left after step 1. Its expression is `x ...` or `[x] ...`, or a sequence ending in one. Lowering turns such an alternative into left recursion on the rule itself: `r → p x ...` becomes `r → p x | r x`, and `r → p [x] ...` becomes `r → p | r x`.

   The intermediate prefixes of such an alternative are then constituents of `r`, and the ranking sees them (§6). This is how the YACC grammar of CLL (The Complete Lojban Language) realizes `...`, and CLL says that left grouping is implied. The recursive productions have none of the alternative's captures, because the captured parts lie inside the inner `r`. So an alternative lowered this way that captures anything is an error of the grammar. Lowering finds this error when it lowers the grammar for features that leave the alternative alone in its rule.
4. The engine names the helpers, and it never shows their names. A helper is a production whose left side is a helper name.
5. A capture `$x(s)` must wrap a single symbol `s`, which can be spelled, in a sequence at the top level of an alternative. It must not stand inside `[ ]`, `...`, `( )` or `&`. It labels the symbol's position in the production. An alternative has at most four captures. `$`, the whole constituent, is a capture of every production that no alternative writes. Its span runs from the item's origin to its end, and its tags are the constituent's (§4).
6. Conditions, tags, emission and `%verbatim` attach to the production that an alternative lowers to, or to each production if it expands to several. They attach with the clauses of the alternative's definition (§2). A production has a capture if its alternative captures it, and every production has `$`.

   Before lowering attaches a clause, it simplifies the clause for the production, by these rules:

   - Each presence test `$x` (§10) becomes true or false as the production has `x` or not.
   - `A ⟹ B` becomes `B` where `A` is then true. Where `A` is false, it becomes true, as a condition, or the empty set, as a term.
   - A condition `A ⟹ B` whose `B` is then true becomes true, and one whose `B` is false becomes `¬A`.
   - Lowering reduces `¬`, `∧` and `∨` over a true or false part as logic says.
   - Lowering drops a term's empty set, written `∅` or left by a guard, from a union. A union of nothing but empty sets is the empty set, as is an intersection with one. A difference whose first part is empty is empty. If its second part is empty, the difference is its first part. A guarded term whose term is the empty set is the empty set.

   Since the engine never evaluates a reduced part, the reduction is part of the order of evaluation (§10). A capture that is still mentioned after simplification is used by the clause. Then the simplified clauses attach as follows:

   - A condition applies to a production if it did not simplify to true and the production has every capture that it uses. Otherwise lowering drops it for that production. A condition that simplifies to false applies, and removes the production. So `%conditions $x` keeps the alternatives that capture `x` and removes the others.
   - Lowering drops an emission item that names a capture the production lacks from that production's emission.
   - A tag term, the alternative's own or the definition's `%tags`, that uses a capture the production lacks is an error of the document.
7. A production's tags are the union of its alternative's own tag term and its definition's `%tags` term, where either is written. A production with neither has the tags of its symbol's constituent if it has one symbol, and none if it has several. Lowering makes this explicit: it treats the single symbol as captured.
8. An optional `[x]` is elidable when two things hold. `x` is a symbol, or a sequence whose first item is, recursively, one. That symbol is an `%elidable` terminal, spelled or not. An optional whose content is a choice or an `&` is never elidable, even if every branch begins with an elidable terminal. The `elision-only` check (§7) lowers the grammar a second time with every elidable optional made mandatory: its helper loses `ε`. A spelled elidable terminal stays spelled when its optional is made mandatory.

Lowering numbers the productions from 0. This numbering is the tie-break of §6. A production that a condition false for it removes (§3.6) takes no number, though the helpers of its alternative still do. Lowering takes the rules in the order in which they were first defined after stitching. A rule replaced with `%redefine-rule` keeps the place of the rule that it replaces, and alternatives added with `%extend-rule` follow the rule's own alternatives.

Within a rule, lowering takes its remaining alternatives in order. Each alternative contributes its own productions first, and then its helpers. Its own productions come in the order of its expansions (step 2). For a trailing repetition, the non-recursive productions come first and then the recursive ones.

Its helpers come one for each place in the alternative where `[ ]` or `...` is written. They come in the order in which those places are written, left to right. The helpers of the places written inside a helper follow that helper's productions at once, depth first, before the next helper of the alternative.

The `...` of a trailing repetition (step 3) has no helper: it is lowered into the rule's own productions. But the `[ ]` and `...` inside its item have helpers, as anywhere else.

A repetition whose item can match nothing is allowed: its derivations that repeat nothing are cyclic (§4) and are not counted.

Every expansion of the alternative that goes through a helper's place shares that helper. So an item of `&`, or the repeated item of a trailing repetition, has one helper however many expansions use it.

## 4. Recognition

The parser is an Earley recognizer, a parser for any context-free grammar, over the lowered grammar. The set of items that it produces specifies it, and any algorithm that produces that set is correct. The recognizer builds one set of items for each position in the input.

An item has a production, a dot position and an origin, the position where the item began. For each capture before the dot, it also has the captured part's span and tag set. Two items equal in all of these are one item. Two items that differ in a captured part's tag set are two items, even over the same span. So derivations that differ in nothing that a condition or tag clause can see share an item.

Take one production, dot position, origin and input position, and one tag set for each captured part. Then the captures add items only where the span of a captured part can vary. For example, with `t → $l(t) $r(t) | A`, a completed item over one span exists once for each position where `$l` can end. Without the captures, it exists once.

A terminal `T` matches a token whose tags contain `T`. A range matches a token that carries at least one character tag of the range. A property matches a token that carries a character tag whose scalar value has the property. Either one matches such a token once, with one reading, however many of its tags qualify.

A range or a property has no tag of its own. As a terminal, its identity is its written form in canonical spelling, such as `'a'..'z'` or `'\p{L}'`. The ends of a range are in their canonical spelling (§1), so `'\u{61}'..'z'` is `'a'..'z'`. This form is the terminal for the ranking and its canonical keys (§6). It is also the terminal in the expected terminals, the tree's token nodes (§12) and the witness.

A spelled symbol ``X`s` `` matches what `X` matches, over a span whose phonemes match the spelling. That is, `phonemes(span)` (§5), lowercased as `lowercase` does (§10), is exactly `s`. So the match ignores stress and script. A token with no phonemes, a character of the first stage, never matches a spelled terminal.

When an item reads a spelled symbol, the recognizer produces the advanced item only if the span of that symbol matches the spelling. This holds over a token, for a terminal, and over a completed item, for anything else. It includes an advance over a constituent that completed empty at the item's position. A spelling is never empty, so it always rejects such a constituent.

The recognizer applies the spelling before any condition that the advance makes ready. The paragraphs below say when a condition is ready. If the spelling fails, the recognizer evaluates none of those conditions. The order is observable, because a condition can end the parse with an error of the grammar. The spelling does not stop the conditions that run earlier. These are the conditions inside the referenced rule, which run before that rule completes, and those that run when the recognizer predicts the item.

The spelling is not part of the terminal's identity. A spelled terminal ``T`s` `` is the terminal `T` for the actions of §6. It is also `T` in the tree's token nodes (§12) and in the witness. The spelling only removes matches.

When an item completes, its constituent's tags are its production's tag terms evaluated over its captured parts (§10) and joined as §3.7 says. A completed item has exactly one tag set. So two derivations of one production over one span that are one item have equal tag sets. Two such derivations with different tag sets differ in a captured part, so they are two items.

The recognizer evaluates a condition, as simplified for its production (§3.6), as soon as the item reads the last capture that it uses. It evaluates a condition that uses `$` as soon as the item is complete. At that point, `$` spans from the item's origin to the set that the item completes in. It has the tags that its production's tag term gives it. If the condition fails, the recognizer does not produce the advanced item.

The recognizer evaluates a condition that uses no capture when it predicts the item. It does the same with a condition that uses only `$` in a production with no symbols, over the empty span there. So a rule whose only production has no symbols and the condition `initial($)` completes only at the start of the input. Anywhere else, the recognizer never advances an alternative that begins with that rule, and that alternative predicts nothing after the rule.

`matches(span, rule)`, `begins(span, rule)` and `tags(span, rule)` each run a nested parse. A nested parse is one recognition over the span's tokens alone, with `rule` as the start rule, over the same lowered grammar. It applies spellings as the main parse does. The three functions read the recognizer's items, before any ranking and before `maximal`, as follows:

- `matches` holds when a completed item of `rule` spans the tokens.
- `begins` holds when a completed item of `rule` has its origin at the span's start, in any set.
- `tags` is the union of the tag sets of the items that `matches` reads, whether or not an item's every derivation is cyclic.

`begins` is one recognition over the whole span, not a separate parse of each prefix. The reason is that the conditions inside `rule` see the end of the span as the end of their input. A recognizer can stop at a set that holds no item, since no later set can then hold one. Otherwise it reads as far as it can. An error of the grammar that it meets is an error, even after `rule` completed once.

An implementation can remember the answers for the whole parse of a stage, in a memo. A memo stores answers from earlier nested parses. This is recommended, but not required. Two queries can share an answer when the nested parse observes the same things in both. That is, the two queries are of the same kind and ask about the same rule. They also have the same span or the same content.

The same span is the same start and end in the stage's input. Within one parse, the span fixes the tokens and the lowered grammar. The content is the original text over the source of the span's tokens (§1). It also holds, for each of the span's tokens, its tags, its text and its phonemes. Last, it holds where each token's source begins and ends, counted from the start of the source of the span's tokens.

Tags alone are not enough, since a condition can read `text()`, which includes what lies between the tokens. Also, the source of each token decides what `text()` of a part of the span is. A key of content must keep its fields apart, so that no two different contents give the same key, whatever characters the fields hold. A key of content lets equal spans at different positions share an answer, and repeated words make this worth having. But such a key costs time in proportion to the span, and the span of `from` or `after` runs to the end of the input. So a key of content suits short spans, and a key of position suits long ones.

`matches` and `tags` of one span and rule can share an entry, since one recognition answers both. `begins` needs its own entry, since `begins` of a span can hold where `matches` of it does not. A memo that outlives the parse of one stage must also be keyed by what differs between the parses that it serves. These are the tokens, the original text, the lowered grammar and the features.

A nested parse sets the start and the end of the input that `initial`, `from` and `after` see to those of its span. It restores both when it ends, also when it fails with an error of the grammar.

A query about a span from inside a parse of the same span as the same rule is an error of the grammar. This holds for any of the three functions, whatever the kind of the parse in progress. The error is reported with the span and the rule, and the whole parse fails with it. Such a query makes the grammar define the rule in terms of itself over the same text. Whether the query is negated does not matter.

Derivations are finite trees. A derivation in which a constituent has, anywhere below it, a constituent of the same rule over the same span is cyclic. The engine does not count a cyclic derivation, since such a derivation can repeat without end. For example, with `a → b` and `b → a | A`, `A` has one derivation as `a`, not infinitely many. So does the empty text as `t`, with `t → u | ε` and `u → t`.

Derivations are made only of advances that the spellings allowed. An implementation can build derivations again from completed spans, without the advances. Such an implementation applies the spellings again. For example, take ``text → [X] body`y` ``, `body → X Y | Y` and the input `X Y`, where `X` sounds `x` and `Y` sounds `y`. Only the `body` over `Y` matches, so `[X]` reads `X`. No derivation reads `[X]` as empty.

In a derivation, the helper of an elidable optional (§3.8) that derives `ε` is an elided terminator, at the position where it is empty. Its constituent is the node of the symbol just before the helper in the production that has the helper among its symbols. In `LE sumti-tail [KU #]`, it is the node of `sumti-tail`. In `[terms] [VAU #]`, it is the node of the helper of `[terms]`, whether that optional is empty or not. In `(number | lerfu-string) [BOI #]`, it is the node of `number` or `lerfu-string`, as the production has one or the other.

An elided terminator has no constituent in three cases:

- It is the first symbol of its production.
- It follows a terminal.
- It is the second symbol of a production whose first symbol is that production's own left side. Such a production is a recursive production of a repetition (§3.2, §3.3), or a left-recursive production that the author wrote. In a recursive production of a repetition, the first symbol stands for what the repetition read so far.

A PEG (parsing expression grammar) repetition such as `([T] A) ...` reads its next item after what it read. It does not make what it read longer first.

When the stage's directive has `maximal`, the engine does not count some more derivations, as it does not count cyclic ones. It does not count a derivation if one of its elided terminators has a constituent that is not the longest possible. Such a constituent is a node of a symbol `Y` spanning `[s, p]`. The recognizer also has a completed item of a production of `Y`, with origin `s`, in a set after `p`.

When `Y` is spelled, the longer constituent counts only if its span also matches the spelling. The longer constituent need not fit into any derivation of `text`, which is what makes `maximal` commit as a PEG does. The longer constituent can contain the constituent itself, as a left-recursive rule builds a longer node on a shorter one.

Only the constituent matters, not what follows the elided terminator in its production. Whether a constituent is the longest possible depends only on its symbol, its spelling, its origin and its end. So an implementation can find, once per parse, the furthest set in which each symbol completes from each origin. For a spelled symbol, it needs each such set, since the furthest one need not match the spelling. `maximal` does not apply to the parse of §7, which has no elided terminator. It also does not apply to a nested parse, which reads the recognizer's items and not derivations.

A stage accepts when an item of the start rule `text` spans the whole input and has at least one derivation that is counted. It rejects an input whose every such derivation is cyclic, as it rejects one with no such item. A rejected input reports the furthest position that any item reached. It also reports the terminals that the items there can read next, together with the rules that those items belong to (§11). The stage writes a spelled terminal as the terminal followed by its spelling in backticks, such as ``LE`la` `` (`docs/output.md`).

An input rejected only because `maximal` forbids an elided terminator in every derivation that is not cyclic reports that terminator instead. The terminator comes from the derivation that the stage chooses (§6) when `maximal` forbids nothing. It is the first elided terminator of that derivation, in the order of the tree's leaves, that `maximal` forbids. Its position is the position reported, and its terminal, with the rule in whose alternative its optional is written, is the one terminal expected there. If that terminator is spelled, the stage writes it with its spelling there too.

## 5. Phonemes and text

A token's `phonemes` are these:

- If it is a verbatim token (§11): its text, whatever tags it carries.
- Otherwise, if its tag set holds a phoneme tag `/p/` (§1): `p`. So the pause, `/./`, is `.`.
- Otherwise: the phonemes of the tokens that it covers, the stage's input tokens in its span, joined in order. The join leaves out every token inside a constituent that does not count (§11). That includes the token's own constituent when its own rule does not count and a parent emits it as a capture. The join also leaves out every token whose phonemes are empty.

  Of each run of adjacent tokens whose phonemes are exactly the pause, `.`, the join keeps only the first. It leaves out such a token at either end. It counts pauses by token, not by character, so it keeps the text of a verbatim token as it is, periods included.
- A character token has none.

An emitted token always has phonemes, possibly the empty string. Only the character tokens of the first stage have none. Two phoneme tags on one emitted token are an error of the grammar that emitted it, whether or not the token is verbatim.

`phonemes(span)` in a condition is the concatenation of the span's tokens' phonemes. `text(span)` is the original text over the source of the span's tokens (§1), and the empty string for an empty span. `runs(span)` is the set of strings of the runs of `phonemes(span)`. The runs are the strings between its pauses, `.`. The empty string is never among them.

## 6. Choosing a parse

A derivation is read as its sequence of actions in bottom-up order. An action is a read of a token as a terminal, or a close of a production over a span. Closes of helper productions and of productions with exactly one symbol are transparent. They are part of the sequence, but two sequences never differ at one. The other actions are visible.

Two reads are the same action when they read the same token as the same terminal. Two closes are the same when they close the same production over the same span.

The stage compares two derivations of the same input at their first differing visible action:

1. Both read the same token as different terminals: tied.
2. One reads and the other closes: `greedy` prefers the read, `lazy` the close.
3. Both close, different productions or different spans: tied.

If the visible sequences are equal, or one is a proper prefix of the other, the two are tied. For the witness below, their first difference is the first pair of differing actions of the whole sequences, transparent ones included. A derivation whose visible sequence is a proper prefix of the other's differs from it where the shorter ends.

The winner is a derivation that no other derivation beats. The verdict is one of these:

- `unique` if the input has one derivation.
- `resolved` if it has several and one winner that is not tied with any other derivation at its first difference with it.
- `tie` otherwise.

The stage puts the derivations in a canonical order, *T*, and it chooses the first. *T* compares two derivations first by their visible sequences:

- At their first differing visible pair, by rules 1 to 3 where those decide, and otherwise by the canonical keys. The canonical keys put a read before a close. They order two reads by terminal, in code point order. They order two closes by production number, then span start, then span end.
- If one visible sequence is a proper prefix of the other, the shorter comes first.
- If the visible sequences are equal, at the first differing pair of the whole sequences, by the canonical keys. If one whole sequence is a prefix of the other, the shorter comes first.

*T* is lexicographic on the visible sequences and then on the whole ones, so it is a total order. The chosen derivation, `m`, is its least element, whatever the verdict.

Nothing beats `m`, since whatever beats a derivation precedes it in *T*. A derivation is undominated when no derivation beats it. So an undominated derivation other than `m` is tied with `m`: its first difference with `m` is a tie. The converse does not hold.

For example, take `text → A C D | p D | B q`, `p → B C` and `q → C D`, over the tokens `A B`, `C` and `D`. Under `greedy`, `m` reads the first token as `A`. The derivation through `p` is tied with it, but loses to the one through `q`, which reads `D` where it closes `p`.

Of the derivations tied with `m`, the tied derivation reported beside `m` is the one that diverges from `m` earliest. It has the fewest visible actions before its first visible difference with `m`. A derivation whose visible sequence is a proper prefix or an extension of `m`'s diverges where the shorter ends. One whose visible sequence equals `m`'s diverges last. Several that diverge at the same point are ordered by *T*. That derivation, `t`, is undominated.

To see why, suppose that another derivation beats `t`. If it beats `t` before `t` diverges from `m`, it beats `m`, which nothing does. If it beats `t` later, it shares `t`'s divergence from `m`. If it beats `t` just where `t` diverges, it beats `m` there too, or it is tied with `m` there. This is because an action that beats one tied with `m`'s cannot lose to `m`'s. Either way, it is tied with `m`, diverges no later than `t`, and precedes `t` in *T*.

So the verdict is `tie` exactly when some derivation is tied with `m`. In the example, `t` is the derivation through `q`. It shows the first point at which the text can be read another way. The witness is the pair of actions at the first difference between `m` and `t`, visible if there is one.

Both `m` and the earliest-diverging tied derivation compose over the packed forest, the shared graph of all derivations. So an implementation can compute both from the forest. It keeps, for each item, its *T*-least derivation and the earliest-diverging derivations tied with it. It keeps several candidates side by side while their order is not yet settled, since what follows decides. Their order is not settled while one's visible sequence is a prefix of another's. It is also not settled while their visible sequences are equal and one whole sequence is a prefix of the other.

One candidate can beat another under `greedy` or `lazy`. Then the loser's tied derivation stays tied with the winner exactly when it diverged from the loser before the point where the winner beat it. One that diverged there is beaten there too.

So nothing needs to be enumerated, and the number of derivations, which can be exponential, never matters. Under `maximal` (§4), an item whose next symbol is an elidable optional keeps a second set of candidates. This set comes from only those of its edges whose last symbol's node `maximal` does not forbid. An edge that advances the item over an elided terminator combines that set. Every other edge combines all of the item's derivations. The number of derivations that decides `unique` is counted the same way.

## 7. Elision-only

When the stage's directive has `elision-only`, or the caller asks for it, and the verdict is not `unique`:

1. Take the chosen tree's elided terminators (§12) in text order, inner before outer where several are at one position. Before the input token at each one's position, insert a synthetic token. Its tags are that terminal alone, and its span and source are empty at that position. If the terminator is spelled, the token's phonemes are its spelling. Otherwise the token has no phonemes. So a restored ``KU`ku` `` matches its own terminator in the parse of step 2.
2. Parse the new token sequence with the grammar lowered as in §3.8.
3. Rank that forest with no lean: any two derivations that differ are tied. If the forest has exactly one derivation, the check passes and the result is the original one.

   Otherwise the result is an error of kind `ambiguous`, and `ok` is false. The error carries two readings: the chosen derivation of that ranking and the tied one reported beside it. Both are shown over the original input, with the written-back terminators as elided nodes. Each node of a reading has the span and the source that it has over the original input (§12). An elided node has the position where its synthetic token was inserted, and that token's source.

   The result's `tree` is null. The stage keeps its verdict, witness, tied tree and output, since it accepted its input. The error has no `token` or `source`. The readings show where they differ.

The elided terminators are taken in the order of the chosen tree's leaves, left to right. If the parse of step 2 accepts nothing, the check passes as well. Restoring the terminators can reject every reading, and then no two restored readings exist to report. An error of the grammar found in the parse of step 2 ends the stage as one found while emitting does (§11). The stage keeps its verdict, witness, tied tree and warnings, but it has no output, and the error is the result's.

A caller can also switch the check off for a stage that declares it.

## 8. Reading grammar documents

A grammar document is Markdown. Its grammar text is the content of every fenced code block whose info string is `jbogenbau`, in order. A fence is a line of three or more backticks or tildes, indented by up to three spaces, followed by the info string. A backtick fence whose info string holds a backtick is not a fence, as in CommonMark. The reader knows no other Markdown container. So a block can stand under a list item indented by two spaces, as a pipeline's `%include` blocks do, but not deeper.

The info string is `jbogenbau` when it is exactly that once leading and trailing whitespace is removed. A block ends at a line that holds only a fence of the same character, at least as long. The fence is indented by up to three spaces, and only whitespace follows it. A `jbogenbau` block that is never closed is an error of the document, and the reader reports it at its opening fence. Any other unclosed block runs to the end of the document, as in CommonMark. The reader joins the blocks with a newline between them, and every character of the grammar text keeps its line and column in the document.

The reader parses the grammar text with the notation dialect, `grammars/dialects/notation.md`, whose DOM ships as `grammars/notation/bootstrap.json`. The rules in §9 turn the tree that this parse produces into the document's DOM. An implementation reads the bootstrap DOM, not the notation documents, to parse any grammar, the notation documents included. Splicing the notation's pipeline (§13) with the bootstrap must reproduce the bootstrap exactly (the fixpoint). The bootstrap holds each stage as its name and its runs of items. A run is a path and a DOM that holds consecutive items of that one document.

An implementation can keep the DOMs that it built before. It keys each DOM by the document's text hash, the bootstrap's hash and the DOM format version (`docs/output.md`). It treats a mismatch in any of the three as a miss. The hash is 64-bit FNV-1a over the text's UTF-8 bytes, written as 16 lower-case hexadecimal digits. Every package ships `compiled.json` beside its grammars. The file holds the DOM of each bundled grammar document in this way.

## 9. From notation tree to DOM

The notation's syntax grammar names its constituents so that the reader can read the DOM off the tree. Every rule of `grammars/notation/syntax.md` whose name appears in this table maps as shown. Every other rule makes no node of the DOM. The reader reads its children in its place, in order.

| rule | DOM |
| --- | --- |
| `directive` | a directive: name from its keyword without `%`, arguments in order. An `argument-word` gives its name, an `argument-string` the decoded string, and an `argument-tag` of `~name` the name |
| `rule` | a rule: `define`, `redefine` or `extend` from its `definer`, a token tagged `keyword-rule`, `keyword-redefine-rule` or `keyword-extend-rule`. Name from its `rule-name`, a name or `#`. Alternatives from its `body`. Tags from its `tags-clause`. Conditions from its `conditions-clause`. Emission from its `emits-clause`. `verbatim` true if it has a `verbatim-clause` |
| `alternative` | guards from its `guard`s: a gate from `f?` or `¬f?`, a warning from `f!`. Expression from its `conjunction`, tags from `alternative-tags` |
| `choice` | `choice` of its `conjunction`s, or the one conjunction itself |
| `conjunction` | `and` of its `sequence`s, or the one sequence itself |
| `sequence` | `seq` of its `element`s, or the one element itself |
| `element` | its `primary`. Followed by `...`: `repeat` with `min` 1, or with `min` 0 if the primary is an `optional`, which is then unwrapped |
| `reference` | `ref`, the name, or `#` |
| `tag` in a body | `terminal`, the name after `~` |
| `character` in a body | `terminal`, the decoded character tag in its canonical spelling (§1) |
| `phoneme` in a body | `terminal`, the token's text `/p/` |
| `range` in a body | `range`, its two ends, each decoded as a `character` is: `{"range":["'a'","'z'"]}` |
| `property` in a body | `property`, the name between the braces: `{"property":"L"}` |
| `spelled` | `spelling` of its `reference`, `tag`, `character` or `phoneme`, as the table reads that. `spelling` is the text between the backticks: `{"spelling":"la","expr":{"ref":"LE"}}` |
| `capture` | `capture`, the name without `$`, of its primary, which must be a `reference`, `tag`, `character`, `phoneme`, `range`, `property` or `spelled` |
| `group` | its `choice` |
| `optional` | `optional` of its `choice` |
| `empty` | `empty` |
| `tags-clause` | its `term` |
| `conditions-clause` | its `implication`s, each one condition of the list, in order |
| `emits-clause` | `items` of its `emit-item`s. Each item is a capture, `""` for `$`, with the term of its `emit-tags` if it has one. Or it is `insert`, the tag of its `~name`, bare name, character tag or phoneme tag. No items for `ε` |
| `implication` | `if` of its `any-of` and the `implication` after `⟹`, or the one `any-of` itself |
| `any-of` | `any` of its `all-of`s, or the one `all-of` itself. An `all-of` that is itself an `any` gives its conditions in its place |
| `all-of` | `all` of its `condition`s, or the one condition itself. A `condition` that is itself an `all` gives its conditions in its place |
| `condition` | its comparison, call, negation or presence, or the `implication` between its parentheses, which makes no node of its own |
| `comparison` | the comparator and its two terms |
| `negation` | `not` of its condition |
| `presence` | `captured`, the name without `$`, `""` for `$` |
| `call` in a condition | `matches`, `begins` or `initial`, the only functions a condition calls directly |
| `term` | its `union` or its `guarded-term` |
| `guarded-term` | `if` of its `any-of` and its `term` |
| `union` | its `intersection`s joined from the left: a run joined by `∪` is one `union`, and each `∖` makes a `difference` of what stands before it and the next part. The one part itself, if there is one |
| `intersection` | `intersection` of the parts, or the one part itself |
| `string` in a term | `string`, the decoded string |
| `tag`, `character`, `phoneme` in a term | `tag`, the tag as in a body |
| `range` in a term | `range`, as in a body |
| `name` in a term | `tag`, the name, if it begins with a capital. As the second argument of `tags`, `matches` or `begins`, a name that does not is a rule, `{"rule":"r"}` |
| `empty-set`, `capture-reference` | `emptySet`, a span `capture`, `""` for `$` |
| `call` in a term | `call` with its arguments |

A rule with any other name makes no node of the DOM. The reader reads its children in its place.

The lexical stage reads the longest symbol. So `...` is always one token, repetition, and never `..` followed by a period. So `'a'...'z'` is not a range. It is `'a'` repeated, then `'z'`. A range is two character tags joined by `..`, with any layout between them.

The grammar does not state the restrictions below. Each of these is an error of the document, and the reader reports it at the first token of the offending construct:

- A capture wrapping anything but one symbol, `$x((B))` included. A symbol is a reference, a tag literal, a character tag, a phoneme tag, a range, a property or a spelled one of these.
- A capture whose name has a capital. Capture names are all lower case.
- `$` wrapping anything.
- A capture name used twice in one alternative.
- A spelling after `#`, a range or a property, reported at the spelling. The syntax grammar permits a spelling on any of these, and on a reference, a tag literal, a character tag or a phoneme tag. There, `#` is a reference.
- A range whose start is above its end, reported at the range.
- A property whose text is not `'\p{Name}'` with a name of §1, reported at the property. So a long name, such as `Letter`, and a name in other case, such as `lu`, are errors.
- A property in a term or a condition, reported at the property. A property is not a tag set.
- A spelling with a code point that `lowercase` (§10) changes, reported at the spelling. The match ignores stress, so ``LE`La` `` is an error.
- A spelling that is empty, reported at the spelling.
- A function that does not exist, or one called with the wrong arguments. `phonemes`, `text`, `runs`, `classes`, `head`, `tail`, `last`, `from` and `after` take one span. `lowercase` takes one string. `tags` takes a span and optionally a rule name. `matches` and `begins` take a span and a rule name, and `initial` takes one span.

  In these signatures, a span is a capture or `head`, `tail`, `last`, `from` or `after` of one. A string is a term whose type is string (§10).
- A term or a condition whose types do not agree, as §10 gives them. So `"a" ∈ tags($x)` and `phonemes($x) = ~a` are errors, and so is `∅ = ∅`, whose kind nothing gives. The reader reports the error at the smallest construct whose parts disagree. That construct is a union with its differences, an intersection, a guarded term, a call or a comparison. Otherwise, it is the whole tag term of a clause or an item.
- A span where a value is needed: a capture, `$`, or `head`, `tail`, `last`, `from` or `after`. The reader reports it at the span.
- A bare name that does not begin with a capital, where a value is needed. Such a name is a rule, and a rule is only the second argument of `tags`, `matches` or `begins`.
- `matches`, `begins` or `initial` as a term.
- An `&` of more than 16 items.
- An expression, a term or a condition nested more than 256 deep. That is, in the DOM (docs/output.md), a node of one lies below more than 256 compound nodes of it. In an expression, the compound nodes are `optional`, `repeat`, `and`, `choice`, `seq`, `capture` and `spelling`. In a term, they are `union`, `intersection`, `difference`, `if` and `call`. In a condition, they are `any`, `all`, `not`, `if`, `matches`, `begins`, `initial` and a comparison.

  The condition of a guarded term counts on from the term's depth, as a comparison's terms count on from the condition's. `( )` makes no node, so it adds nothing. So 256 nested `[ ]` around a symbol are allowed, and 257 are not.
- `$` with items other than `$`.
- Tags on an inserted tag.
- An inserted bare name that does not begin with a capital, which names a rule and not a tag.
- An inserted range or property, which is not one tag.
- `∅` as an item's tags, which is a token no terminal reads.
- A capture other than `$` listed twice in one emission.
- A rule's or an alternative's tag term that reads the tags that it defines: `tags($)` or `classes($)` in it. `tags(head($))` and the like read the tokens' tags, not the constituent's, and are allowed, as is `tags($, R)`.
- An unknown directive, which the syntax grammar already refuses.
- A directive with the wrong operands, reported at the directive. `%stage` takes one name, `%include` one string, and `%features` one or more names. `%elidable` takes identifier tags: names that begin with a capital, or `~name`. A range or a property there is an error, as a phoneme tag or a character tag is. `%ambiguity-resolution` takes names only.

Once the reader reads a definition (§2), it makes sure that the whole definition meets its requirements. Each of the following is an error of the document too, and the reader reports it at the definition:

- A capture, in any clause, `$x` presence tests included, that no alternative of the definition captures.
- A condition that applies (§3.6) to no alternative of the definition, whatever features are enabled.
- A tag term that uses (§3.6) a capture that an alternative it serves lacks. An alternative's own tags serve that alternative, and `%tags` serves every alternative of the definition. An emission item's tags serve every alternative in which the item is not dropped.
- `%verbatim` in a definition whose emission is `ε`, since a constituent that does not count cannot sound like its text.
- In an emission, captures listed in an order other than the one in which some alternative that has them captures them.
- In an emission, an inserted tag whose anchor, the capture listed next after it, is one that some alternative of the definition lacks.
- In an emission, an alternative for which every item is dropped, so that it emits nothing although the rule lists what to emit. A rule that emits nothing says so with `ε`.

A document's items are its rules and directives. The DOM keeps them in two lists, each in the order written. Every item has the position of its first token, so the order of all of a document's items is the order of their positions.

A DOM is malformed in each of these cases, whether it is read, cached or in the bootstrap:

- Two of its items share a position.
- It has a `stage`, `include`, `features` or `elidable` directive whose operands the reader refuses.
- It has a spelling that the reader refuses, by the same `lowercase` mapping that the match uses.
- It has a `terminal`, a `tag` or an inserted tag that is not a tag in its canonical spelling (§1).
- It has a `range` whose ends are not two character tags in their canonical spelling, or whose start is above its end.
- It has a `property` whose name §1 does not list.
- It has a term or a condition whose types do not agree (§10).

To decode a string, the reader removes the quotes. In the decoded string, `\\` is `\`, `\"` is `"`, and `\u{h...}` is the character with that hexadecimal value. The value has one to six hexadecimal digits and is a Unicode scalar value: at most `10FFFF`, and not a surrogate, `D800` to `DFFF`. Any other `\`, and a `\u{...}` that breaks these limits, is an error of the document, and the reader reports it at the string.

A character tag is decoded in the same way, with `\'` for a quote in place of `\"`. The decoded text must be exactly one code point, or the reader reports an error of the document at the tag. The DOM holds the tag in its canonical spelling (§1), so `'a'` and `'\u{61}'` give the same DOM. The reader decodes each end of a range in the same way, as one character tag.

## 10. Terms and conditions

A capture `$x` is the span of the captured part, and `$` the span of the whole constituent (§3.5). `head(s)` is the first token of `s`, `tail(s)` all but the first, and `last(s)` its last token, each empty if the span is. `from(s)` is the span from the start of `s` to the end of the input of the parse that evaluates the condition. `after(s)` is the span from the end of `s` to that end, and it is empty if `s` ends there.

That input is the stage's input or, in a nested parse (§4), the span that the nested parse reads. The same holds in a tag term. The recognizer computes a constituent's tags while its parse runs. The stage computes an emission's tags after its parse, over its input.

A term has one of four types: a string, a set of strings, a tag set or a span. No value turns into another. The reader gives every term its type, and a term whose parts do not agree is an error of the document (§9).

| term | type | value |
| --- | --- | --- |
| `"s"` | string | the string |
| `~name`, `KOhA`, `/p/`, `'c'` | tag set | the set of that one tag |
| `'a'..'z'` | tag set | the character tags of the range (§1) |
| `∅` | a set of the kind its context gives | the empty set |
| `a ∪ b`, `a ∩ b`, `a ∖ b` | the type of `a` and `b`, two sets of one kind | union, intersection, difference |
| `A ⟹ t` | tag set | `t` where the condition `A` holds, else `∅` |
| `phonemes(s)`, `text(s)` | string | §5 |
| `lowercase(t)` | string | `t` with each code point replaced by its simple lowercase mapping, the `lower` entries of `grammars/unicode.txt` |
| `tags(s)` | tag set | the captured part's constituent tags if `s` is a whole capture, else the union of the span's tokens' tags |
| `tags(s, R)` | tag set | the union of the tag sets of the completed items of `R` that span `s`, as `matches` reads them (§4), empty if there are none |
| `classes(s)` | tag set | the tags of `tags(s)` whose first character is `A` to `Z` |
| `runs(s)` | set of strings | §5 |
| `$x`, `$`, `head(s)` and the other span functions | span | the argument of a function, never a value |

`..` binds tighter than every other operator, since its two sides are character tags. So `'a'..'c' ∪ 'x'` is `('a'..'c') ∪ 'x'`.

`∩` binds tighter than `∪` and `∖`. Those two bind equally and group from the left, so `a ∖ b ∪ c` is `(a ∖ b) ∪ c`. `∅` takes its kind from the other side of its operator or comparison. A tag term, guarded term or emission item also gives it the required tag-set type. An expression whose kind nothing gives is an error of the document.

`a = b` and `a ≠ b` compare two strings, two sets of strings or two tag sets. Any other pair is an error of the document. `a ∈ b` and `a ∉ b` test a string in a set of strings. `a ⊆ b` tests that every member of `a` is in `b`, and `a ⊈ b` that one is not. Both sides are sets of one kind. `matches(s, R)` holds when the span parses as `R`, and `begins(s, R)` when a prefix of it does, the empty prefix included.

`initial(s)` holds when the span begins where the input of the parse that evaluates the condition begins. That is the start of the stage's input, or, in a nested parse (§4), the start of the span that the parse reads. `$x`, as a condition, holds when the production has the capture `x` (§3.6), and `$` always holds. `¬c` negates. Conditions joined by `∨` hold when any does, and those joined by `∧` when all do.

`A ⟹ B`, a condition, holds when `A` does not or `B` does. `⟹` binds looser than `∨`, which binds looser than `∧`. `⟹` groups to the right, and parentheses group.

Evaluating a condition can run a nested parse, which can fail with an error of the grammar (§4). So which parts the engine evaluates is observable, and this section fixes the order of evaluation. The engine evaluates conditions joined by `∧` or `∨` from left to right. Evaluation stops at the first that decides the whole: a false one for `∧`, a true one for `∨`. `A ⟹ B` evaluates `A` first, and `B` only if `A` holds. A guarded term `A ⟹ t` likewise evaluates `t` only if `A` holds.

`A ⟹ t`, where `A` is a condition and `t` a tag set, is `t` where `A` holds. Where `A` does not hold, it is the empty tag set. A guarded term binds looser than `∪`, `∩` and `∖`, so it stands in parentheses inside any of them.

## 11. Emission

Every stage that accepts its input emits tokens by walking its chosen tree from the left. This includes the last stage, whose tokens are its output (`docs/output.md`), though no stage reads them.

- The stage walks a constituent whose production has no emission: its children in order. A token that the constituent reads directly emits nothing.
- A constituent whose production has an emission emits exactly the items of the emission, as dropped for its production (§3.6). It emits them in the order in which the emission lists them, and the stage walks nothing inside it:
  - A `$` item emits one token covering the constituent, with the constituent's tags, or with the tags of the item's term if it has one. `$ <t>, $ <u>` emits one such token per item, in order, all with the same span and source. This is how a digit that stands for a two-phoneme word is two tokens over one character.
  - A capture item emits one token covering the captured part, with the part's own tags, or with the tags of the item's term.
  - An inserted tag, a tag literal, emits a token with that one tag and an empty span.
- A constituent whose production's emission is `ε`, no items, emits nothing and does not count. Nothing inside it is part of the phonemes of a token that covers it (§5). It is how a grammar erases text. The text is still there, and still covered by the tokens around it, but counts for nothing. A part that an emission merely does not list is not emitted, but counts.

An item's tag term that gives the empty set is an error of the grammar, found while parsing. No terminal can read such a token. The stage already accepted its input and chose its tree. So it keeps its verdict, witness, tied tree and warnings (§12), but it has no output, and the error is the result's.

An emitted token's span is the range of the stage's input tokens that its constituent covers. Its `source` is the source of those tokens (§1), or, if there are none, empty where a node with an empty span has it (§12). This does not hold for a verbatim token. Its phonemes are as in §5.

An inserted token's span is empty at the start of the part of the capture listed next after it. If no capture is listed after it, the span is empty at the end of the constituent. Its source is empty at the source end of the input token before that position. If the position is the constituent's start, its source is empty at the start of the constituent's source.

A token is verbatim in two cases. In the first case, a `$` item or a capture item emits the token over a constituent whose production has `%verbatim`. Such a token is widened: it takes in the text next to it that no input token covers, as the next paragraph says.

In the second case, the first case does not apply. A `$` item or a capture item emits the token over exactly one input token, which is verbatim. Such a token has that input token's source. So a quote body stays verbatim through the stages after the one that read it.

The text between two adjacent input tokens belongs to the widened token with a non-empty span that ends there, if one does. Otherwise it belongs to the one that starts there. The text before the first input token belongs to a widened token that starts there. The text after the last input token belongs to one that ends there. So a widened token's source always holds the source of its own input tokens (§1), and more.

A widened token's source starts at the source end of the input token just before its span, if that is earlier. If there is no such token, it starts at the start of the text. It does not start earlier if another widened token with a non-empty span ends where this one starts. The source ends at the source start of the input token just after its span, if that is later. If there is no such token, it ends at the end of the text.

A widened token over an empty span takes in no text. Its source is empty, at the source end of the input token before the span. If there is no such token, its source is empty at the start of the text.

A verbatim token's text is the text of its source, and its phonemes are its text (§5). An inserted token is never verbatim. No other token is verbatim, whatever lies inside its constituent.

A stage whose verdict is `tie` emits its chosen derivation, and the tie is reported, at whichever stage it is. A tie is a property of the grammar, and the grammar is the place to settle it. The engine does not hide a tie, even where the tied derivations emit the same tokens.

## 12. The tree

The engine builds the result's tree from the chosen derivation, as follows:

- A closed production of a rule that the author wrote is a `rule` node, its children in order.
- A read token is a `token` node holding the index of the input token and the terminal that the recognizer read it as.
- The engine splices out helper productions: their children take their place.
- The engine splices out the prefixes of a trailing repetition (§3.3), so the rule is one node whose children are its items in order.
- An elidable optional (§3.8) that is absent becomes an `elided` node for its terminal `T`. The node has an empty span at the position where the optional is empty. The node of a spelled terminator records the spelling, for the synthetic token of §7. The output does not show it (`docs/output.md`).

A node with a nonempty span has the source of its tokens (§1). A node with an empty span is an `elided` node or a rule that read nothing. Such a node has an empty source at the source end of the input token before its position. At position 0, its empty source is at the source start of the first input token, or at 0 if there is no input token.

A `rule` node of a stage's chosen tree gives warnings from the alternative that its production came from. It gives one warning for each warning `f!` of that alternative where the feature `f` is on. The warning holds the stage's name, the feature, the rule, and the node's span and source.

A stage's warnings are those of its chosen tree. They are in the order in which a walk of the tree meets their nodes, parent before children and children left to right. The warnings of one node are in the order in which its guards are written. The warnings of a stage whose verdict is `tie` come from the chosen tree too.

Nothing else gives warnings. No warnings come from a tied or losing derivation, the reparse of `elision-only` (§7), a nested parse (§4), or a stage that rejected its input. A warning changes nothing that the stage accepts, chooses or emits.

## 13. The pipeline

A dialect is a pipeline document (`docs/design.md`, "Pipelines"), which the loader reads into stages as follows.

To splice a pipeline, the loader reads the pipeline document's items (§9) in order. It replaces each `%include "PATH"` with the items of the document at `PATH`, read in the same way. It resolves `PATH` against the directory of the document that holds the `%include`. It splits the resulting stream of items at each `%stage NAME`. The items after it, up to the next `%stage`, are that stage's, whatever documents they come from. So a `%stage` inside an included document starts a stage like any other, and the items after the `%include` go on in it.

The names of every `%features` of the stream are the features the pipeline turns on. The loader stitches each stage's other items in order (§2). Each of these is an error of the dialect, and the loader reports it at the item named:

- An `%include` of a document that does not exist, at the `%include`. The error names the documents that included it.
- An `%include` of a document that is already being included, which is a cycle, at the `%include`. The error names the documents that included it.
- A rule, or an `%ambiguity-resolution` or `%elidable`, before the first `%stage`.
- A `%stage` with the name of an earlier one.
- A stage with no rules, at its `%stage`.
- A pipeline with no `%stage`.

A document can be included more than once, in one stage or in several. The loader reads its items again each time.

The first stage reads the character tokens of §1, and each later stage reads the tokens that the stage before it emitted. The features on for every stage are those that the pipeline or the caller turns on, less those that the caller turns off. A caller who names one feature both to turn on and to turn off makes a usage error. Naming a feature that no guard of the dialect uses is not an error: the feature is on or off. A stage that rejects its input ends the run with that rejection, and an `ambiguous` error (§7) ends it likewise.

The result's `ok` is true when every stage run accepted without an error. The result's warnings are those of every stage that ran (§12), in stage order, and they are kept whether or not the result is `ok`.

A dialect's features are the names its guards use in any stage and the names its `%features` declare. The guards counted are those of each stage's rules after stitching (§2), so an alternative that `%redefine-rule` replaced no longer counts. The loader counts them before any gate drops an alternative (§3.1), whatever features are on.

Each name is a gate, if a guard uses it as `f?` or `¬f?`, or a warning, if a guard uses it as `f!`. A name that one guard uses as a gate and another as a warning is an error of the dialect. The loader finds this error when it loads the dialect. A name that only `%features` declares is a gate. A dialect lists its features, each with its kind and whether `%features` turns it on.

When all of these hold, the engine runs the stages up to and including the one named `words` once without `sa-su`:

- The caller asks for auto features.
- The dialect has `sa-su` as a gate.
- `sa-su` is not already on.
- The caller did not turn `sa-su` off.
- The run reaches a stage named `words`: the dialect has one, and `until`, if given, names it or a later stage.

The engine then runs the parse again from the first stage with `sa-su` added, in two cases. In the first case, that first run does not end with the `words` stage accepting. Any reason counts: a rejection or an error in it or in a stage before it. In the second case, the chosen tree of the `words` stage has a constituent of the rule `word` whose tag set has `SA` or `SU`.

In either case, the engine discards the first run's stages and warnings. Otherwise that first run's stages are the parse's, with their warnings, continued to the end. The test is on the class and not on the spelling, because the lexicon decides which words erase. For example, `li'oi` is SU in the experimental lexicon, and a stressed `sA` is `sa`.

Mistakes of the caller are errors of kind `usage`. Two examples are an `until` that names no stage and a text that is not a sequence of scalar values (§1). They are raised or returned as a load error is, and they are not results. A grammar error found while parsing, such as a nested parse asked about its own span, is a result. Its error has kind `grammar`, the `stage` that it arose in and a message, and no position.
