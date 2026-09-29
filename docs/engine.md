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
- `label`: what the token shows to people (§5).
- `insertedBy`: for a token that an emission clause inserted from a tag literal (§11), the rule that the clause belongs to. For any other token it is absent, even for a token that an emission `$` makes over an empty constituent.

The source of one token or more runs from the least source start among them to the greatest source end. An empty source counts as the point where it lies. Tokens usually lie in the order of their sources. Then this source runs from the source start of the first token to the source end of the last token.

But they need not. An emission lists its captures in the order in which they stand (§9, §11). But an inserted token can have its source before the token ahead of it, or after the token behind it. So can a token over a part that read nothing. An empty span of tokens has no such source: its source is given where it is used (§11, §12).

A tag is one of three kinds, and its kind shows in its first character:

- An identifier tag is a name (§9): an ASCII letter followed by ASCII letters, digits and hyphens.
- A phoneme tag is exactly three code points, whose first and last are `/`, such as `/a/`.
- A character tag is one Unicode scalar value between two quotes, `'`, such as `'a'`. The quotes are part of the tag.

A character tag's identity is its scalar value, so a tag has one canonical spelling. Its canonical spelling is the character itself between the quotes, with five exceptions. The engine writes a control character, U+0000 to U+001F or U+007F to U+009F, as `\u{h...}`. It does the same for a nonspacing mark, which has no base between the quotes. The engine also writes a private-use character so: U+E000 to U+F8FF, U+F0000 to U+FFFFD, or U+100000 to U+10FFFD. The quote and the backslash are the last two exceptions.

A nonspacing mark is a character whose General_Category in `grammars/unicode.txt` is `Mn`. In `\u{h...}`, the hexadecimal digits are upper case, with no leading zeros. So U+0301 is `'\u{301}'`, U+ED80 is `'\u{ED80}'`, and the quote is `'\u{27}'`. Everywhere in the engine and its output, a tag is a string in this canonical spelling. So two tags are equal exactly when their strings are.

The input of the first stage is the characters of the text, one token for each code point `c` at position `i`. For this token, `span` and `source` are `[i, i+1)`, and `text` is `c`. Its `tags` hold one tag, the character tag of `c`, and nothing else. A character token has no phonemes, and its label is its text. A grammar reads a class of characters, such as the letters, with a range or a property.

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

A grammar is the stitching of the items of one stage of a pipeline (§13) into a set of rules, directives, constants, classifiers and implications. An item is a rule, a directive, a constant definition, a classifier or an implication, read from a document (§8, §9). A rule has a name and alternatives, and optionally rule-level tags, conditions and an emission clause. An alternative has guards, an expression, and optionally tags. The grammar DOM (document object model), in `docs/output.md`, is the exact data.

To stitch a stage's items, the loader reads them in order, whatever documents they come from. Each rule is stated one of three ways, and each is an error in the case given:

- `%rule` (`define`) defines a rule: an error if a rule of that name was defined before it in the stage.
- `%redefine-rule` (`redefine`) replaces the rule of that name defined before it in the stage: an error if none was. The earlier alternatives are then gone, those of any `%extend-rule` of the rule included.
- `%extend-rule` (`extend`) appends its alternatives to the rule of that name defined before it in the stage: an error if none was.

When `%extend-rule` extends a rule, each appended alternative carries the extension's own clauses: its rule-level tags, conditions and emission. These clauses apply to the appended alternatives alone, and the base rule's clauses do not apply to them. The earlier alternatives keep their own clauses. So a script document can add letters to a rule without restating its clauses, and its own clauses do not leak into the base rule. A definition is a `%rule`, `%redefine-rule` or `%extend-rule` statement: its alternatives and the clauses written with them. The loader records every replacement and extension.

The loader collects directives from all the stage's items. `%stage`, `%include` and `%features` shape the pipeline (§13) and do not belong to a stage. The other two directives belong to the stage.

A stage also has constants. A constant is a named value that terms and conditions use (§10). Its name is `$` and a name (§9) that begins with `A` to `Z`, such as `$SU-STOPS`. By convention, the whole name is in capitals. An item states a constant in one of two ways, and each is an error in the case given:

- `%const $NAME t` (`define`) defines the constant: an error if a constant of that name was defined before it in the stage.
- `%redefine-const $NAME t` (`redefine`) gives the constant a new value: an error if none was defined before it in the stage.

`t` is a closed term (§10). The loader evaluates it when it reaches the item in the stitching order. A constant in `t` has the value that it has at that point. In a `%redefine-const`, the constant's own name stands for its value before the redefinition. So one redefinition can extend a set with `∪`, narrow it with `∩` or `∖`, or replace it.

A constant in `t` that is not defined at that point is an error. So no cycle can arise. For example, after `%const $A ~a`, `%const $B $A` and `%redefine-const $A ~b`, `$A` is `~b` and `$B` is `~a`. A redefinition keeps the constant's type. A value of another type is an error.

Rules see the final values. A constant in a rule's terms, conditions or tests has the value that the last definition of the stage gives it, wherever the rule stands.

After the loader stitches the stage, it checks each rule definition that holds a constant. A constant that the stage never defines is an error there. The types of the terms, conditions and tests that hold constants must agree (§9, §10).

A string constant in an `=` or `≠` test must be a canonical sound (§9). The checks of §9 that depend on the value of a constant apply there too. The loader checks every definition of the stage in this way. That includes a definition that a later `%redefine-rule` replaces, although its alternatives are then gone.

A constant belongs to its stage, as a rule does. A document in several stages or dialects takes the values of each. The DOM of a document holds its definitions and its references to constants, never their values (§8).

Each error of a constant is an error of the document. The loader reports a second `%const`, a `%redefine-const` of nothing and a change of type at the constant's definition. The loader reports errors from the two deferred capture checks of §9 at the rule's definition. It reports every other error at the reference to the constant.

A stage also has classifiers. A classifier maps a string to a tag set, the string's classes (§10). An item `%classifier NAME` (`classifier`) names a classifier of the stage and lists entries for it. `NAME` is a name (§9) that begins with `a` to `z`. Several items can name one classifier, and together they make it. So a second item of one name is no error, unlike a second `%rule`.

An entry has gates, one or more keys, an operator and one class. A gate is a guard `f?` or `¬f?`, as in an alternative (§3.1). A key is a string that is a canonical sound (§5, §9). The operator is `∈` or `∉`. The class is an identifier tag whose first character is `A` to `Z`.

A classifier's value depends on the features, so the stage resolves it for one set of enabled features. It starts with no memberships, and takes the entries of every item of that name in the stitching order. It skips an entry whose gates do not all hold, as lowering drops an alternative (§3.1). For each key of any other entry, in order, `∈` adds the membership of the key in the class, and `∉` removes it. The value maps each key to the classes that it has after the last entry.

An `∈` whose membership already holds is an error of the grammar, and so is an `∉` whose membership does not hold. The stage resolves every classifier of its grammar when it lowers the grammar for the features of a parse (§3). It resolves them before it lowers the rules, and whether or not a term reads them. So such an error ends the stage as an error of lowering does (§3.3). Its message names the document, line and column of the entry. An entry that a gate skips has no such error.

A call `classify(a, C)` names the classifier `C` (§10). A name that no item of the stage uses is an error of the document. A classifier belongs to its stage, so the loader finds this error when it stitches the stage. It reports the error at the definition that holds the call.

A stage also has implications. An item `%implies A ⟹ B` (`implication`) adds one. `A` and `B` are closed terms (§10) whose type is a tag set. A constant in them has the value that the last definition of the stage gives it, as in a rule. The loader checks their types after it stitches the stage, as it checks a rule's (§9). §11 says how the stage applies its implications.

A stage has exactly one `%ambiguity-resolution L [elision-only] [maximal]`, or it is an error naming the stage. `L` is `greedy` or `lazy`. If both `elision-only` (§7) and `maximal` (§4) are written, they stand in that order. `%elidable T...` names the elidable terminators, and repeated directives add up.

A name whose first character is `A` to `Z` is a terminal, the identifier tag of that name. The DOM writes both kinds of name as `ref`, and lowering (§3) tells them apart by that first letter. Any other name is a rule reference, and must be defined in the stage, or it is an error. `#`, the free-modifier slot, is a rule's name like any other.

A tag literal `~name`, a phoneme tag or a character tag is a terminal too. The DOM writes it as `terminal`, the tag. A range and a property (§1) are terminals as well, which the DOM writes as `range` and `property`.

A reference other than `#`, or a terminal, can carry one test on its own span, as in `LE="la"`. A tested symbol is a symbol with a test. The test is not part of the name. A tested terminal is the same terminal, and a tested reference refers to the same rule. A test has one of six forms, where `X` is the symbol:

- `X="s"` and `X≠"s"`: the canonical sound of the span (§5) is `s`, or it is not.
- `X⊇t` and `X⊉t`: the own tags of `X` include every tag of `t`, or they lack one at least.
- `X∩t=∅` and `X∩t≠∅`: the own tags of `X` include no tag of `t`, or they include one at least.

The first two are sound tests, and the other four are tag tests. `s` is a closed term (§10) whose type is a string, and `t` is a closed term whose type is a tag set. The own tags of a terminal are the tags of its token. The own tags of a reference are the tags of its completed constituent (§4).

## 3. Lowering

This section writes productions as `lhs → symbols`. This is not jbogenbau, the notation of gencmu grammars (`docs/notation.md`), but the context-free grammar that a jbogenbau grammar is lowered to.

Lowering turns a grammar, given the set of enabled features, into a context-free grammar of productions. The lowered grammar is what the parser runs. Lowering decides nothing that a user can observe, except through §4-§6. For the same features, the stage also resolves its classifiers (§2).

1. Lowering drops an alternative whose gates do not all hold. A gate `f?` holds when the feature `f` is on, and `¬f?` when it is off. A warning `f!` is not a gate and never drops its alternative (§12).
2. Lowering expands each remaining alternative into sequences of symbols. `(a | b)` expands to both, in written order. `[x]` is a helper `h → ε | x` (step 4). `x ...` is a helper `h → x | h x`, and `[x] ...` is `h → ε | h x`.

   `A₁ & … & Aₙ` has at most 16 items. More is an error of the document (§9), since the expansions number 2ⁿ−1. It expands to every non-empty subsequence that keeps their order. The subsequences come in the order of the binary numbers 1 to 2ⁿ−1, with `A₁` as the lowest bit. `ε` is the empty sequence. A sequence's expansions are the products of its items' expansions, the first item varying slowest.

   A tested symbol expands to that one symbol, which carries the test. It adds no helper. So the numbering, the transparent closes of §6 and the constituents of a production are those of the symbol without its test. Two productions that differ only in the test of a symbol are two productions.
3. A trailing repetition is an alternative with two properties. It is the only alternative of its rule left after step 1. Its expression is `x ...` or `[x] ...`, or a sequence ending in one. Lowering turns such an alternative into left recursion on the rule itself: `r → p x ...` becomes `r → p x | r x`, and `r → p [x] ...` becomes `r → p | r x`.

   The intermediate prefixes of such an alternative are then constituents of `r`, and the ranking sees them (§6). This is how the YACC grammar of CLL (The Complete Lojban Language) realizes `...`, and CLL says that left grouping is implied. The recursive productions have none of the alternative's captures, because the captured parts lie inside the inner `r`. So an alternative lowered this way that captures anything is an error of the grammar. Lowering finds this error when it lowers the grammar for features that leave the alternative alone in its rule.
4. The engine names the helpers, and it never shows their names. A helper is a production whose left side is a helper name.
5. A capture `$x(s)` must wrap a single symbol `s`, which can be tested, in a sequence at the top level of an alternative. It must not stand inside `[ ]`, `...`, `( )` or `&`. It labels the symbol's position in the production. An alternative has at most four captures. `$`, the whole constituent, is a capture of every production that no alternative writes. Its span runs from the item's origin to its end, and its tags are the constituent's (§4).
6. Conditions, tags, emission and `%foreign` attach to the production that an alternative lowers to, or to each production if it expands to several. They attach with the clauses of the alternative's definition (§2). A production has a capture if its alternative captures it, and every production has `$`.

   Before lowering attaches a clause, it simplifies the clause for the production, by these rules:

   - Each presence test `$x` (§10) becomes true or false as the production has `x` or not.
   - `A ⟹ B` becomes `B` where `A` is then true. Where `A` is false, it becomes true, as a condition, or the empty set, as a term.
   - A condition `A ⟹ B` whose `B` is then true becomes true, and one whose `B` is false becomes `¬A`.
   - Lowering reduces `¬`, `∧` and `∨` over a true or false part as logic says.
   - A constant is its value here. So a constant whose value is the empty set is an empty set.
   - Lowering drops a term's empty set, written `∅` or left by a guard, from a union. A union of nothing but empty sets is the empty set, as is an intersection with one. A difference whose first part is empty is empty. If its second part is empty, the difference is its first part. A guarded term whose term is the empty set is the empty set.

   Since the engine never evaluates a reduced part, the reduction is part of the order of evaluation (§10). A capture that is still mentioned after simplification is used by the clause. Then the simplified clauses attach as follows:

   - A condition applies to a production if it did not simplify to true and the production has every capture that it uses. Otherwise lowering drops it for that production. A condition that simplifies to false applies, and removes the production. So `%conditions $x` keeps the alternatives that capture `x` and removes the others.
   - Lowering drops an emission item that names a capture the production lacks from that production's emission.
   - A tag term, the alternative's own or the definition's `%tags`, that uses a capture the production lacks is an error of the document.
7. A production's tags are the union of its alternative's own tag term and its definition's `%tags` term, where either is written. A production with neither has the tags of its symbol's constituent if it has one symbol, and none if it has several. Lowering makes this explicit: it treats the single symbol as captured.
8. An optional `[x]` is elidable when two things hold. `x` is a symbol, or a sequence whose first item is, recursively, one. That symbol is an `%elidable` terminal, tested or not. An optional whose content is a choice or an `&` is never elidable, even if every branch begins with an elidable terminal. The `elision-only` check (§7) lowers the grammar a second time with every elidable optional made mandatory: its helper loses `ε`. A tested elidable terminal keeps its test when its optional is made mandatory.

   The terminal of an elidable optional has no test or an `=` test, since §7 restores it with a sound. Any other test on it is an error of the grammar. The loader finds this error after it stitches the stage, since a later `%elidable` can make an optional elidable. It checks every alternative of the stitched stage, whatever the features, and reports the error at the definition that wrote the alternative. A test on a later symbol of the optional is no error, since §7 restores only the terminal.

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

A tested symbol (§2) matches what its symbol matches, where its test holds. The test reads the symbol's own span and its own tags. For a terminal, these are the token's span and tags. For a reference, they are the span and the tag set of the completed item that the item advances over.

`X="s"` holds when the canonical sound of the span, `phonemes(span)` (§5), is exactly `s`. So the match ignores stress, script and syllable breaks. `X⊇t` holds when the own tags include every tag of `t`. `X∩t=∅` holds when they include no tag of `t`. `X≠"s"`, `X⊉t` and `X∩t≠∅` hold exactly where those three do not.

A test is an ordinary predicate, and an empty span is no exception. So `X=""` and `X≠"la"` hold for a constituent that completed empty, and `X⊇∅` always holds. A character of the first stage has no phonemes, so its canonical sound is the empty string.

When an item reads a tested symbol, the recognizer produces the advanced item only if the test holds. This holds over a token, for a terminal, and over a completed item, for a reference. It includes an advance over a constituent that completed empty at the item's position. Two completed items over one span can have different tag sets. So a tag test can let an item advance over one of them and not over the other.

The recognizer applies the test before any condition that the advance makes ready. The paragraphs below say when a condition is ready. If the test fails, the recognizer evaluates none of those conditions. The order is observable, because a condition can end the parse with an error of the grammar. The test does not stop the conditions that run earlier. These are the conditions inside the referenced rule, which run before that rule completes, and those that run when the recognizer predicts the item.

The test is not part of the terminal's identity. A tested terminal `T="s"` is the terminal `T` for the actions of §6. It is also `T` in the tree's token nodes (§12) and in the witness. The test only removes matches.

When an item completes, its constituent's tags are its production's tag terms evaluated over its captured parts (§10) and joined as §3.7 says. A completed item has exactly one tag set. So two derivations of one production over one span that are one item have equal tag sets. Two such derivations with different tag sets differ in a captured part, so they are two items.

The recognizer evaluates a condition, as simplified for its production (§3.6), as soon as the item reads the last capture that it uses. It evaluates a condition that uses `$` as soon as the item is complete. At that point, `$` spans from the item's origin to the set that the item completes in. It has the tags that its production's tag term gives it. If the condition fails, the recognizer does not produce the advanced item.

The recognizer evaluates a condition that uses no capture when it predicts the item. It does the same with a condition that uses only `$` in a production with no symbols, over the empty span there. So a rule whose only production has no symbols and the condition `initial($)` completes only at the start of the input. Anywhere else, the recognizer never advances an alternative that begins with that rule, and that alternative predicts nothing after the rule.

`matches(span, rule)`, `begins(span, rule)` and `tags(span, rule)` each run a nested parse. A nested parse is one recognition over the span's tokens alone, with `rule` as the start rule, over the same lowered grammar. It applies tests as the main parse does. The three functions read the recognizer's items, before any ranking and before `maximal`, as follows:

- `matches` holds when a completed item of `rule` spans the tokens.
- `begins` holds when a completed item of `rule` has its origin at the span's start, in any set.
- `tags` is the union of the tag sets of the items that `matches` reads, whether or not an item's every derivation is cyclic.

`begins` is one recognition over the whole span, not a separate parse of each prefix. The reason is that the conditions inside `rule` see the end of the span as the end of their input. A recognizer can stop at a set that holds no item, since no later set can then hold one. Otherwise it reads as far as it can. An error of the grammar that it meets is an error, even after `rule` completed once.

An implementation can remember the answers for the whole parse of a stage, in a memo. A memo stores answers from earlier nested parses. This is recommended, but not required. Two queries can share an answer when the nested parse observes the same things in both. That is, the two queries are of the same kind and ask about the same rule. They also have the same span or the same content.

The same span is the same start and end in the stage's input. Within one parse, the span fixes the tokens and the lowered grammar. The content is the original text over the source of the span's tokens (§1). It also holds, for each of the span's tokens, its tags, its text and its phonemes. Last, it holds where each token's source begins and ends, counted from the start of the source of the span's tokens.

Tags alone are not enough, since a condition can read `text()`, which includes what lies between the tokens. Also, the source of each token decides what `text()` of a part of the span is. A key of content must keep its fields apart, so that no two different contents give the same key, whatever characters the fields hold. A key of content lets equal spans at different positions share an answer, and repeated words make this worth having. But such a key costs time in proportion to the span, and the span of `from` or `after` runs to the end of the input. So a key of content suits short spans, and a key of position suits long ones.

`matches` and `tags` of one span and rule can share an entry, since one recognition answers both. `begins` needs its own entry, since `begins` of a span can hold where `matches` of it does not. A memo that outlives the parse of one stage must also be keyed by what differs between the parses that it serves. These are the tokens, the original text, the lowered grammar and the features.

A nested parse sets the start and the end of the input that `initial`, `from` and `after` see to those of its span. It restores both when it ends, also when it fails with an error of the grammar.

A query about a span from inside a parse of the same span as the same rule is an error of the grammar. This holds for any of the three functions, whatever the kind of the parse in progress. The error names the rule, and the whole parse fails with it. Such a query makes the grammar define the rule in terms of itself over the same text. Whether the query is negated does not matter.

Derivations are finite trees. A derivation in which a constituent has, anywhere below it, a constituent of the same rule over the same span is cyclic. The engine does not count a cyclic derivation, since such a derivation can repeat without end. For example, with `a → b` and `b → a | A`, `A` has one derivation as `a`, not infinitely many. So does the empty text as `t`, with `t → u | ε` and `u → t`.

Derivations are made only of advances that the tests allowed. An implementation can build derivations again from completed spans, without the advances. Such an implementation applies the tests again, each to the candidate constituent itself, with its own span and its own tags. For example, take `text → [X] body="y"`, `body → X Y | Y` and the input `X Y`, where `X` sounds `x` and `Y` sounds `y`. Only the `body` over `Y` matches, so `[X]` reads `X`. No derivation reads `[X]` as empty.

A tag test works in the same way. Take `text → [X] body⊇~b` and `body → X Y | Y`, where the second production of `body` has the tag term `~b`. Only the `body` over `Y` carries `b`, so again `[X]` reads `X`.

In a derivation, the helper of an elidable optional (§3.8) that derives `ε` is an elided terminator, at the position where it is empty. Its constituent is the node of the symbol just before the helper in the production that has the helper among its symbols. In `LE sumti-tail [KU #]`, it is the node of `sumti-tail`. In `[terms] [VAU #]`, it is the node of the helper of `[terms]`, whether that optional is empty or not. In `(number | lerfu-string) [BOI #]`, it is the node of `number` or `lerfu-string`, as the production has one or the other.

An elided terminator has no constituent in three cases:

- It is the first symbol of its production.
- It follows a terminal.
- It is the second symbol of a production whose first symbol is that production's own left side. Such a production is a recursive production of a repetition (§3.2, §3.3), or a left-recursive production that the author wrote. In a recursive production of a repetition, the first symbol stands for what the repetition read so far.

A PEG (parsing expression grammar) repetition such as `([T] A) ...` reads its next item after what it read. It does not make what it read longer first.

When the stage's directive has `maximal`, the engine does not count some more derivations, as it does not count cyclic ones. It does not count a derivation if one of its elided terminators has a constituent that is not the longest possible. Such a constituent is a node of a symbol `Y` spanning `[s, p]`. The recognizer also has a completed item of a production of `Y`, with origin `s`, in a set after `p`.

When `Y` is tested, the longer constituent counts only if the test holds of it, with its own span and its own tags. The longer constituent need not fit into any derivation of `text`, which is what makes `maximal` commit as a PEG does. The longer constituent can contain the constituent itself, as a left-recursive rule builds a longer node on a shorter one.

Only the constituent matters, not what follows the elided terminator in its production. Whether a constituent is the longest possible depends only on its symbol, its test, its origin and its end. So an implementation can find, once per parse, the furthest set in which each symbol completes from each origin. For a tested symbol, it needs each completed item of the symbol from each origin, since the furthest one need not pass the test. `maximal` does not apply to the parse of §7, which has no elided terminator. It also does not apply to a nested parse, which reads the recognizer's items and not derivations.

A stage accepts when an item of the start rule `text` spans the whole input and has at least one derivation that is counted. It rejects an input whose every such derivation is cyclic, as it rejects one with no such item. A rejected input reports the furthest position that any item reached. It also reports the terminals that the items there can read next, together with the rules that those items belong to (§11). The stage writes a tested terminal with its test, such as `LE="la"` (`docs/output.md`).

An input rejected only because `maximal` forbids an elided terminator in every derivation that is not cyclic reports that terminator instead. The terminator comes from the derivation that the stage chooses (§6) when `maximal` forbids nothing. It is the first elided terminator of that derivation, in the order of the tree's leaves, that `maximal` forbids. Its position is the position reported, and its terminal, with the rule in whose alternative its optional is written, is the one terminal expected there. If that terminator is tested, the stage writes it with its test there too.

## 5. Phonemes, labels and text

A token's `phonemes` say what it sounds like, and its `label` is what it shows to people. The stage fixes both when it emits the token. It takes the first of these cases that applies:

- The token's tag set holds a phoneme tag `/p/` (§1). Then its phonemes are `p`, and its label is `p`. The pause, `/./`, is the one exception: its phonemes are `.`, and its label is a space.
- Any other token that the stage emits joins the phonemes and the labels of its parts (§11). A read input token gives its own phonemes and its own label. A foreign part gives the phonemes `?`, and its text as its label. So a token whose constituent is a foreign part sounds `?`.
- A character token has no phonemes, and its label is its text. A token that a caller supplies in place of the characters has its text as its label (`docs/api.md`).

The phonemes join the phonemes of the parts in order, and the label joins their labels in the same way. Each join leaves out a part whose own string is empty: its phonemes for the phonemes, and its label for the label. A pause part is a part whose phonemes are exactly the pause, `.`. Of each run of adjacent pause parts that remain, the join keeps only the first. It also leaves out a pause part at either end. A part with no phonemes, such as a character token, counts as one with empty phonemes.

The join counts pauses by part, not by character. So it keeps a period or a space inside the string of a part. For example, a foreign part with the text `a... b` keeps that label whole.

The two joins are independent. Each leaves out the parts whose own string is empty, and both find a pause part by its phonemes. So they can keep different parts. An empty foreign part between two pauses gives `?` to the phonemes, so the phonemes keep both pauses. It gives nothing to the label, so there the two pauses are adjacent, and the label keeps only the first.

An inserted token has no parts. If it has a phoneme tag, it sounds like that phoneme and has it as its label. Otherwise its phonemes and its label are empty. So the inserted apostrophe `/'/` of a script is part of the label of the word around it.

An emitted token always has phonemes, possibly the empty string. Only the character tokens of the first stage have none. Two phoneme tags on one emitted token are an error of the grammar that emitted it, whether or not its constituent is a foreign part. The tag set here is the token's tags after the stage's implications (§11).

`phonemes(span)` in a condition is the canonical sound of the span. It joins the phonemes of the span's tokens in order, with no separator. Then it replaces each code point with its simple lowercase mapping, the `lower` entries of `grammars/unicode.txt`. It also removes every comma, `,`, the syllable break of CLL 3.3.

The canonical sound keeps every pause. It does not merge two pauses, and it does not remove a pause at either end. So a stressed `lA` sounds `la`, and `kore,a` sounds `korea`. A token's own `phonemes`, above and in the output, stay as the token has them.

The canonical sound and every comparison treat `?` as an ordinary character. In the word stage, `zoi gy. abc .gy. bu` is one letter word. It sounds `zoi.gy.?.gy.bu`, and its label is `zoi gy abc gy bu`.

`text(span)` is the original text over the source of the span's tokens (§1), and the empty string for an empty span.

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

1. Take the chosen tree's elided terminators (§12) in text order, inner before outer where several are at one position. Before the input token at each one's position, insert a synthetic token. Its tags are that terminal alone, and its span and source are empty at that position. If the terminator has an `=` test, the token's phonemes are the test's string. Otherwise the token has no phonemes. So a restored `KU="ku"` matches its own terminator in the parse of step 2.
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

A DOM holds the definitions of constants and the references to them as the document writes them. It never holds a value that the loader gives a constant when it stitches a stage (§2). In the same way, it holds a classifier's entries and an implication's terms as written, and never the value of a classifier. So one cached DOM serves every stage and every dialect that includes its document. The values of the constants exist only in a stitched stage, and neither `compiled.json` nor the bootstrap holds them.

## 9. From notation tree to DOM

The notation's syntax grammar names its constituents so that the reader can read the DOM off the tree. Every rule of `grammars/notation/syntax.md` whose name appears in this table maps as shown. Every other rule makes no node of the DOM. The reader reads its children in its place, in order.

| rule | DOM |
| --- | --- |
| `directive` | a directive: name from its keyword without `%`, arguments in order. An `argument-word` gives its name, an `argument-string` the decoded string, and an `argument-tag` of `~name` the name |
| `classifier` | a classifier: name from its `classifier-name`, a name. Entries from its `classifier-entry`s, in order |
| `classifier-entry` | an entry: gates from its `guard`s, as an alternative reads them. Keys from its `classifier-key`s, each the decoded string, in order. Operator from its `classifier-operator`, `∈` or `∉`. Class from its `classifier-class`: the name, or the name after `~` |
| `implication-declaration` | an implication: `if` from the `union` before `⟹` and `then` from the `union` after it, each read as a `term` is |
| `constant-definition` | a constant: `define` or `redefine` from its `constant-definer`, a token tagged `keyword-const` or `keyword-redefine-const`. Name from its `constant-reference` without `$`. Value from its `term` |
| `rule` | a rule: `define`, `redefine` or `extend` from its `definer`, a token tagged `keyword-rule`, `keyword-redefine-rule` or `keyword-extend-rule`. Name from its `rule-name`, a name or `#`. Alternatives from its `body`. Tags from its `tags-clause`. Conditions from its `conditions-clause`. Emission from its `emits-clause`. `foreign` true if it has a `foreign-clause` |
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
| `tested` | `test`, the comparator of its `test`. `value`, the term of its `test-operand`. `expr`, its primary as the table reads that: `{"test":"=","value":{"string":"la"},"expr":{"ref":"LE"}}`. The comparator is `=`, `≠`, `⊇` or `⊉`, or `∩=∅` or `∩≠∅` for a test that begins with `∩` |
| `test-operand` | its term, as a `term-atom` reads it |
| `capture` | `capture`, the name without `$`, of its primary, which must be a `reference`, `tag`, `character`, `phoneme`, `range`, `property` or `tested` |
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
| `name` in a term | `tag`, the name, if it begins with a capital. As the second argument of `tags`, `matches` or `begins`, a name that does not is a rule, `{"rule":"r"}`. As the second argument of `classify`, it is a classifier, `{"classifier":"c"}` |
| `empty-set`, `capture-reference` | `emptySet`, a span `capture`, `""` for `$` |
| `constant-reference` in a term | `const`, the name without `$`, and `at`, the line and column of its token |
| `call` in a term | `call` with its arguments |

A rule with any other name makes no node of the DOM. The reader reads its children in its place.

The lexical stage reads the longest symbol. So `...` is always one token, repetition, and never `..` followed by a period. So `'a'...'z'` is not a range. It is `'a'` repeated, then `'z'`. A range is two character tags joined by `..`, with any layout between them.

The grammar does not state the restrictions below. Each of these is an error of the document, and the reader reports it at the first token of the offending construct:

- A capture wrapping anything but one symbol, `$x((B))` included. A symbol is a reference, a tag literal, a character tag, a phoneme tag, a range, a property or a tested one of these.
- A capture whose name has a capital. Capture names are all lower case.
- A constant in a body, reported at the constant. A body names a class of tokens with a rule, such as `%rule digit '0'..'9'`, and never with a constant.
- `$` wrapping anything.
- A capture name used twice in one alternative.
- A test after anything but a reference other than `#` or a terminal, reported at the test. So a test after a group, an optional, a capture, `ε`, `#` or another test is an error. The syntax grammar permits a test after any primary.
- A range whose start is above its end, reported at the range.
- A property whose text is not `'\p{Name}'` with a name of §1, reported at the property. So a long name, such as `Letter`, and a name in other case, such as `lu`, are errors.
- A property in a term or a condition, reported at the property. A property is not a tag set.
- A string in an `=` or `≠` test that no canonical sound (§5) can be, reported at the string. That is a string with a comma, or with a code point that the simple lowercase mapping changes. So `LE="La"` and `LE="l,a"` are errors. The loader checks a constant there in the same way (§2).
- A test's operand that is not a closed term (§10), reported at the first part that is not closed. So a capture, `$`, a guarded term and a call of `phonemes`, `text`, `tags`, `classes` or `classify` are errors there.
- A test's operand of the wrong type, reported at the operand. The operand of `=` and `≠` is a string, and that of the other four tests is a tag set. So `LE⊇"la"` and `LE=~la` are errors.
- A function that does not exist, or one called with the wrong arguments. `phonemes`, `text`, `classes`, `head`, `tail`, `last`, `from` and `after` take one span. `split` takes two strings, and `tag` takes one string. `tags` takes a span and optionally a rule name. `matches` and `begins` take a span and a rule name, and `initial` takes one span. `classify` takes a string and a classifier's name.

  In these signatures, a span is a capture or `head`, `tail`, `last`, `from` or `after` of one. A string is a term whose type is string (§10). The reader reports a call with the wrong arguments at the call. So a bare name in an argument that takes no name, as in `classify(lex, "mi")`, is reported at `classify`, not at the name.
- A `split` whose delimiter is the string literal `""`, reported at the call.
- A `tag` whose argument is a string literal that is not a name, reported at the call.
- A constant's value that is not a closed term (§10), reported at the first part that is not closed. So a capture, `$`, a guarded term and a call of `phonemes`, `text`, `tags`, `classes` or `classify` are errors there.
- A side of an implication that is not a closed term, reported in the same way. A side whose type is not a tag set, reported at the side.
- A classifier's name that does not begin with `a` to `z`, reported at the name. `classify` cannot name it, since a bare name with a capital is a tag.
- A warning on a classifier's entry, reported at the warning. An entry takes gates only.
- A key that no canonical sound can be, reported at the key. That is a key with a comma, or with a code point that the simple lowercase mapping changes. So `"Mi"` and `"ko,a"` are errors, as they are in a test.
- A class that is not a name that begins with `A` to `Z`, reported at the class. So `~indicator` is an error there.
- A term or a condition whose types do not agree, as §10 gives them. So `"a" ∈ tags($x)` and `phonemes($x) = ~a` are errors, and so is `∅ = ∅`, whose kind nothing gives. The reader reports the error at the smallest construct whose parts disagree. That construct is a union with its differences, an intersection, a guarded term, a call or a comparison. Otherwise, it is the whole tag term of a clause or an item, or the whole value of a constant.

  The reader does not know the type of a constant, so it lets a constant stand for a value of any type but a span. The loader checks the types again after it stitches the stage (§2). It reports an error there at the first constant of the smallest construct whose parts disagree.
- A span where a value is needed: a capture, `$`, or `head`, `tail`, `last`, `from` or `after`. The reader reports it at the span.
- A bare name that does not begin with a capital, where a value is needed. Such a name is a rule or a classifier. A rule is only the second argument of `tags`, `matches` or `begins`, and a classifier only that of `classify`.
- `matches`, `begins` or `initial` as a term.
- An `&` of more than 16 items.
- An expression, a term or a condition nested more than 256 deep. That is, in the DOM (docs/output.md), a node of one lies below more than 256 compound nodes of it. In an expression, the compound nodes are `optional`, `repeat`, `and`, `choice`, `seq`, `capture` and `test`. In a term, they are `union`, `intersection`, `difference`, `if` and `call`. In a condition, they are `any`, `all`, `not`, `if`, `matches`, `begins`, `initial` and a comparison.

  The condition of a guarded term counts on from the term's depth, as a comparison's terms count on from the condition's. A test's value counts on from the test's depth in the same way. `( )` makes no node, so it adds nothing. So 256 nested `[ ]` around a symbol are allowed, and 257 are not. The reader reports this error at the first item, in the order of the document, that holds such a node. That item is a rule, a constant definition or an implication.
- `$` with items other than `$`.
- Tags on an inserted tag.
- An inserted bare name that does not begin with a capital, which names a rule and not a tag.
- An inserted range or property, which is not one tag.
- `∅` as an item's tags, which is a token no terminal reads.
- A capture other than `$` listed twice in one emission.
- A rule's or an alternative's tag term that reads the tags that it defines: `tags($)` or `classes($)` in it. `tags(head($))` and the like read the tokens' tags, not the constituent's, and are allowed, as is `tags($, R)`.
- An unknown directive or keyword, which the syntax grammar already refuses.
- A directive with the wrong operands, reported at the directive. `%stage` takes one name, `%include` one string, and `%features` one or more names. `%elidable` takes identifier tags: names that begin with a capital, or `~name`. A range or a property there is an error, as a phoneme tag or a character tag is. `%ambiguity-resolution` takes names only.

Once the reader reads a definition (§2), it makes sure that the whole definition meets its requirements. Each of the following is an error of the document too, and the reader reports it at the definition:

- A capture, in any clause, `$x` presence tests included, that no alternative of the definition captures.
- A condition that applies (§3.6) to no alternative of the definition, whatever features are enabled.
- A tag term that uses (§3.6) a capture that an alternative it serves lacks. An alternative's own tags serve that alternative, and `%tags` serves every alternative of the definition. An emission item's tags serve every alternative in which the item is not dropped.
- `%foreign` in a definition whose emission is `ε`. A constituent that does not count gives no part, so it is never a foreign part (§11).
- In an emission, captures listed in an order other than the one in which some alternative that has them captures them.
- In an emission, an inserted tag whose anchor, the capture listed next after it, is one that some alternative of the definition lacks.
- In an emission, an alternative for which every item is dropped, so that it emits nothing although the rule lists what to emit. A rule that emits nothing says so with `ε`.

Two of these checks depend on simplification (§3.6). They are the check that a condition applies to an alternative, and the check of the captures that a tag term uses. In simplification, a constant is its value, and the reader does not know that value. So the reader leaves these two checks to the loader for each clause that holds a constant. The loader makes them after it gives the constants their values (§2), and it reports an error at the definition. The check that some alternative captures each mentioned capture does not depend on a value, so the reader makes it for every clause.

A document's items are its rules, its directives, its constant definitions, its classifiers and its implications. The DOM keeps them in five lists, each in the order written. Every item has the position of its first token, so the order of all of a document's items is the order of their positions.

A DOM is malformed in each of these cases, whether it is read, cached or in the bootstrap:

- Two of its items share a position.
- It has a guard of an alternative whose feature is not a name.
- It has a `stage`, `include`, `features` or `elidable` directive whose operands the reader refuses.
- It has a test that the reader refuses. That is a test after anything but a reference other than `#` or a terminal, or an unknown comparator. It is also a value that is not a closed term of the right type. It is also a string that holds a comma or that the lowercase mapping of the canonical sound changes.
- It has a `terminal`, a `tag` or an inserted tag that is not a tag in its canonical spelling (§1).
- It has a `range` whose ends are not two character tags in their canonical spelling, or whose start is above its end.
- It has a `property` whose name §1 does not list.
- It has a constant definition or a `const` term whose name is not a name that begins with `A` to `Z`.
- It has a constant whose value is not a closed term, or a `split` or a `tag` that the reader refuses.
- It has a term or a condition whose types do not agree (§10).
- It has a classifier whose name does not begin with `a` to `z`. It has an entry with a warning, or with a gate whose feature is not a name. It has an entry with no key, or with a key that the reader refuses. It has an entry whose operator is not `∈` or `∉`, or whose class is not a name that begins with `A` to `Z`.
- It has an implication whose sides are not closed terms of type tag set.
- It has a `classify` whose second argument is not the name of a classifier. It has the name of a classifier as any other argument.

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
| `split(a, d)` | set of strings | the pieces of the string `a` between the occurrences of the string `d` (below) |
| `tag(a)` | tag set | the set of the one identifier tag whose name is the string `a` |
| `$NAME` | the type of its value | the value of the constant (§2) |
| `tags(s)` | tag set | the captured part's constituent tags if `s` is a whole capture, else the union of the span's tokens' tags |
| `tags(s, R)` | tag set | the union of the tag sets of the completed items of `R` that span `s`, as `matches` reads them (§4), empty if there are none |
| `classes(s)` | tag set | the tags of `tags(s)` whose first character is `A` to `Z` |
| `classify(a, C)` | tag set | the classes that the classifier `C` gives the string `a`, for the features of the parse (§2), empty if no entry names `a` |
| `$x`, `$`, `head(s)` and the other span functions | span | the argument of a function, never a value |

`split(a, d)` finds the occurrences of `d` in `a` from the left. Each search starts where the last occurrence ends, so two occurrences never overlap. The pieces are the strings before the first occurrence, between two occurrences and after the last one. The value is the set of the pieces that are not empty. So `split("a..b.", ".")` is the set of `"a"` and `"b"`, and `split("aaa", "aa")` is the set of `"a"`.

An empty delimiter is an error. It is an error of the document when the delimiter is the literal `""` or a constant whose value is `""` (§2, §9). Otherwise it is an error of the grammar when a parse evaluates the `split`, and the whole parse fails with it (§13). So `split(phonemes($x), text($y))` is such an error where `$y` is empty.

`tag(a)` needs a name (§9) for `a`. Any other string is an error. When the reader sees it, as a string literal or a constant, it is an error of the document. Otherwise it is an error of the grammar when a parse evaluates the `tag`.

A closed term uses no capture and no span. It holds only strings, tag literals, ranges, `∅`, constants, the operators `∪`, `∩` and `∖`, and `split` and `tag` of closed terms. So it never holds `classify`, whose value depends on the features.

A constant's value is a closed term, whose type is a string, a set of strings or a tag set. So is the value of a test (§2), whose type is a string or a tag set. So is each side of an implication, whose type is a tag set. The loader evaluates a constant's value when it stitches the stage (§2), as a parse evaluates a term.

`..` binds tighter than every other operator, since its two sides are character tags. So `'a'..'c' ∪ 'x'` is `('a'..'c') ∪ 'x'`.

`∩` binds tighter than `∪` and `∖`. Those two bind equally and group from the left, so `a ∖ b ∪ c` is `(a ∖ b) ∪ c`.

`∅` takes its kind from the other side of its operator or comparison. A tag term, guarded term, emission item or tag test also gives it the required tag-set type. In a `%redefine-const`, the type that the constant keeps (§2) gives the value its kind in the same way. So after `%const $A ~a`, `%redefine-const $A ∅` makes `$A` the empty tag set. An expression whose kind nothing gives is an error of the document. So `%const $E ∅` is an error.

`a = b` and `a ≠ b` compare two strings, two sets of strings or two tag sets. Any other pair is an error of the document. `a ∈ b` and `a ∉ b` test a string in a set of strings. `a ⊆ b` tests that every member of `a` is in `b`, and `a ⊈ b` that one is not. Both sides are sets of one kind. `matches(s, R)` holds when the span parses as `R`, and `begins(s, R)` when a prefix of it does, the empty prefix included.

`initial(s)` holds when the span begins where the input of the parse that evaluates the condition begins. That is the start of the stage's input, or, in a nested parse (§4), the start of the span that the parse reads. `$x`, as a condition, holds when the production has the capture `x` (§3.6), and `$` always holds. `¬c` negates. Conditions joined by `∨` hold when any does, and those joined by `∧` when all do.

`A ⟹ B`, a condition, holds when `A` does not or `B` does. `⟹` binds looser than `∨`, which binds looser than `∧`. `⟹` groups to the right, and parentheses group.

Evaluating a condition can run a nested parse, which can fail with an error of the grammar (§4). `split` and `tag` can fail in the same way. So which parts the engine evaluates is observable, and this section fixes the order of evaluation.

The engine evaluates conditions joined by `∧` or `∨` from left to right. Evaluation stops at the first that decides the whole: a false one for `∧`, a true one for `∨`. `A ⟹ B` evaluates `A` first, and `B` only if `A` holds. A guarded term `A ⟹ t` likewise evaluates `t` only if `A` holds.

Within a term, the engine evaluates the parts from left to right. So it evaluates the parts of `∪`, `∩` and `∖`, and the arguments of a call, in the order written. It evaluates the two sides of a comparison in the same order. So where two parts both fail, the error is that of the left part. The loader evaluates the value of a constant (§2) in the same order. For example, in `tag($A) ∖ tag($B)`, where neither value is a name, the error is that of `tag($A)`.

`A ⟹ t`, where `A` is a condition and `t` a tag set, is `t` where `A` holds. Where `A` does not hold, it is the empty tag set. A guarded term binds looser than `∪`, `∩` and `∖`, so it stands in parentheses inside any of them.

## 11. Emission

Every stage that accepts its input emits tokens by walking its chosen tree from the left. This includes the last stage, whose tokens are its output (`docs/output.md`), though no stage reads them.

- The stage walks a constituent whose production has no emission: its children in order. A token that the constituent reads directly emits nothing.
- A constituent whose production has an emission emits exactly the items of the emission, as dropped for its production (§3.6). It emits them in the order in which the emission lists them, and the stage walks nothing inside it:
  - A `$` item emits one token covering the constituent, with the constituent's tags, or with the tags of the item's term if it has one. `$ <t>, $ <u>` emits one such token per item, in order, all with the same span and source. This is how a digit that stands for a two-phoneme word is two tokens over one character.
  - A capture item emits one token covering the captured part, with the part's own tags, or with the tags of the item's term.
  - An inserted tag, a tag literal, emits a token with that one tag and an empty span.
- A constituent whose production's emission is `ε`, no items, emits nothing and does not count. Nothing inside it is part of the phonemes or the label of a token that covers it (§5). It is how a grammar erases text. The text is still there, and still covered by the tokens around it, but counts for nothing. A part that an emission merely does not list is not emitted, but counts.

The tags that an item gives its token are the token's explicit tags. The stage then applies its implications (§2) to them. For each implication `A ⟹ B` whose `A` shares a tag with the token's tags, it adds the tags of `B`. It repeats this until no implication adds a tag, so the order of the implications does not matter. An implication only adds tags, so the repetition ends, also where implications form a cycle. Only then does the stage check the token's phoneme tags and find its phonemes and its label (§5).

Implications apply to every token that the stage emits, an inserted one included, and to nothing else. They do not change a constituent's tags, the value of a term or classifier, or a token of the stage's input. A later stage applies only its own implications. The synthetic tokens of §7 are not emitted, so no implication applies to them.

An item's tag term that gives the empty set is an error of the grammar, found while parsing. No terminal can read such a token. The stage already accepted its input and chose its tree. So it keeps its verdict, witness, tied tree and warnings (§12), but it has no output, and the error is the result's.

The constituent of a token is the constituent that its `$` item covers, or the part that its capture item captures. An emitted token's span is the range of the stage's input tokens that its constituent covers. Its `source` is the source of those tokens (§1), or, if there are none, empty where a node with an empty span has it (§12). A token whose constituent is a foreign part is the one exception, as below. Its phonemes and its label are as in §5.

An inserted token's span is empty at the start of the part of the capture listed next after it. If no capture is listed after it, the span is empty at the end of the constituent. Its source is empty at the source end of the input token before that position. If the position is the constituent's start, its source is empty at the start of the constituent's source.

A rule with `%foreign` says that its constituents are foreign text, such as the body of a `zoi` quote. Before the stage emits anything, it finds the foreign parts of its chosen derivation. A foreign part is a constituent whose production has `%foreign`, with two exceptions. A constituent inside a constituent that emits `ε` is not a foreign part. A constituent inside a foreign part is not a foreign part either. Here, inside means below in the derivation, so the outer constituent of a recursive foreign rule is the one foreign part.

This selection is over the whole chosen derivation, and it does not change what a constituent emits. Whether a constituent is a foreign part depends on its place in the derivation. Two occurrences can use the same production over the same span but differ in whether they lie inside a foreign part.

A `%foreign` constituent that the selection leaves out is an ordinary constituent, even when its own emission clause emits a token over it. That token has the source of its input tokens and the join of its parts. This can happen inside a foreign part. A foreign rule with no emission clause walks its children. A capture item of a foreign rule emits a token over part of its constituent. It never happens inside a constituent that emits `ε`, because that constituent walks nothing, so nothing inside it emits.

Each foreign part has a source and a text, which the stage also fixes before it emits anything. An empty foreign part takes in no text. Its source is the empty-node source of §12.

A foreign part with a non-empty span starts from the source of its own input tokens (§1). It then takes in the text next to it that no input token covers, as the next two paragraphs say.

Two adjacent input tokens can have text between them. If a foreign part with a non-empty span ends between them, that text belongs to it. Otherwise a foreign part that starts there takes the text. A foreign part that starts at the first input token takes the text before it. A foreign part that ends at the last input token takes the text after it. So in `a,b`, where `a` and `b` are two adjacent foreign parts, `a` takes the comma.

Where the input token just before its span ends earlier than its own source starts, a foreign part's source starts at that token's source end. With no token before its span, the source starts at the start of the text. Neither applies when another foreign part with a non-empty span ends where this one starts. Where the input token just after its span starts later than its own source ends, the source ends at that token's source start. With no token after its span, the source ends at the end of the text. The text of a foreign part is the original text over its source.

These rules also hold for input tokens whose sources overlap or lie out of order. There they do not keep the sources of two foreign parts apart. Two foreign parts can then share text, so their texts and their labels can overlap too. The text between two adjacent input tokens still goes to at most one part. An ordinary token never takes in such text.

A token whose constituent is a foreign part has the source and the text of that part. So a capture item of a parent emits the same token as a `$` item of the foreign rule itself. Any other token has the source of its input tokens, as above, even where a foreign part among its parts reaches further. Its label still holds the whole text of that part. So its label can reach beyond its source, and it need not lie within its text.

A later stage that forwards a token keeps its source, because a token over one input token has that token's source (§1). So the text of a quote body stays the same to the end of the pipeline, although the tokens next to it can disappear.

The parts of an emitted token are what its phonemes and its label join (§5). The stage finds them by a walk of the token's constituent, in order. A read input token is a part. A foreign part is one part, and the walk does not enter it. A constituent that emits `ε` gives no part, and the walk does not enter it either. The walk enters every other constituent.

So three rules decide what a foreign part gives, over the chosen derivation. A part inside a constituent that emits `ε` gives nothing, foreign or not. A foreign part inside another gives nothing of its own, because the outer one counts once. A token with its own phoneme tag sounds like that phoneme and has it as its label, whatever foreign parts it covers (§5). The tag can come from the token's own stage, or from a later stage that emits a token over it.

A stage whose verdict is `tie` emits its chosen derivation, and the tie is reported, at whichever stage it is. A tie is a property of the grammar, and the grammar is the place to settle it. The engine does not hide a tie, even where the tied derivations emit the same tokens.

## 12. The tree

The engine builds the result's tree from the chosen derivation, as follows:

- A closed production of a rule that the author wrote is a `rule` node, its children in order.
- A read token is a `token` node holding the index of the input token and the terminal that the recognizer read it as.
- The engine splices out helper productions: their children take their place.
- The engine splices out the prefixes of a trailing repetition (§3.3), so the rule is one node whose children are its items in order.
- An elidable optional (§3.8) that is absent becomes an `elided` node for its terminal `T`. The node has an empty span at the position where the optional is empty. The node of a terminator with an `=` test records the test's string, for the synthetic token of §7. The output does not show it (`docs/output.md`).

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
- A rule, an `%ambiguity-resolution`, an `%elidable` or a constant definition before the first `%stage`.
- A `%stage` with the name of an earlier one.
- A stage with no rules, at its `%stage`.
- A pipeline with no `%stage`.

A document can be included more than once, in one stage or in several. The loader reads its items again each time.

The first stage reads the character tokens of §1, and each later stage reads the tokens that the stage before it emitted. The features on for every stage are those that the pipeline or the caller turns on, less those that the caller turns off. A caller who names one feature both to turn on and to turn off makes a usage error. Naming a feature that no guard of the dialect uses is not an error: the feature is on or off. A stage that rejects its input ends the run with that rejection, and an `ambiguous` error (§7) ends it likewise.

The result's `ok` is true when every stage run accepted without an error. The result's warnings are those of every stage that ran (§12), in stage order, and they are kept whether or not the result is `ok`.

A dialect's features are the names its guards use in any stage and the names its `%features` declare. The guards counted are those of each stage's rules after stitching (§2), so an alternative that `%redefine-rule` replaced no longer counts. The gates of every classifier's entries count too. The loader counts them before any gate drops an alternative (§3.1), whatever features are on.

Each name is a gate, if a guard uses it as `f?` or `¬f?`, or a warning, if a guard uses it as `f!`. A name that one guard uses as a gate and another as a warning is an error of the dialect. The loader finds this error when it loads the dialect. A name that only `%features` declares is a gate. A dialect lists its features, each with its kind and whether `%features` turns it on.

When all of these hold, the engine runs the stages up to and including the one named `words` once without `sa-su`:

- The caller asks for auto features.
- The dialect has `sa-su` as a gate.
- `sa-su` is not already on.
- The caller did not turn `sa-su` off.
- The run reaches a stage named `words`: the dialect has one, and `until`, if given, names it or a later stage.

The engine then runs the parse again from the first stage with `sa-su` added, in two cases. In the first case, that first run does not end with the `words` stage accepting. Any reason counts: a rejection or an error in it or in a stage before it. In the second case, the chosen tree of the `words` stage has a constituent of the rule `word` whose tag set has `SA` or `SU`.

In either case, the engine discards the first run's stages and warnings. Otherwise that first run's stages are the parse's, with their warnings, continued to the end. The engine checks the class and not the sound, because the lexicon decides which words erase. For example, `li'oi` is SU in the experimental lexicon, and a stressed `sA` is `sa`.

Mistakes of the caller are errors of kind `usage`. Two examples are an `until` that names no stage and a text that is not a sequence of scalar values (§1). They are raised or returned as a load error is, and they are not results. A grammar error found while parsing is a result. Examples are a nested parse asked about its own span and a `split` with an empty delimiter. Its error has kind `grammar`, the `stage` that it arose in and a message, and no position.
