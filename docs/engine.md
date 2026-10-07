# The gencmu engine

This document is the specification that every gencmu library implements. It says what a result is, not how to compute it. It says how only where the only reasonable way to compute a result is part of what the result is. Where two implementations can differ, this document says which one is right. The cases in `tests/engine/` and `tests/notation/` are part of the specification, and an implementation that disagrees with one of them is wrong. A case that disagrees with this text is a bug in one or the other, and the same change fixes it.

`docs/notation.md` explains the notation to grammar authors, and `grammars/notation/` defines it. `docs/output.md` defines the result's JSON and the renderings.

## 1. Tokens

A stage is one step of a pipeline (§13), with its own grammar. Everything a stage reads and writes is a sequence of tokens. A token has these fields:

- `tags` is a set of tags, each a string.
- `span` is the half-open range of the previous stage's tokens that the token covers. A half-open range includes its start and excludes its end.
- `source` is the half-open range of the original text that the token covers, in Unicode code points.
- `text` is the original text over `source`.
- `phonemes` is what the token sounds like (§5).
- `label` is what the token shows to people (§5).
- `insertedBy` names the rule whose emission clause inserted the token from a tag literal (§11). For any other token it is absent, even for a token that an emission `$` makes over an empty constituent.
- `before` and `after` are the token's attachments (§11). These are two lists of tokens that belong to the token and that no later stage reads. Both are empty unless an emission gives the token attachments. An attached token has no `span`.

The check of §7 adds synthetic tokens to a copy of a stage's input. They are not tokens of any stage, and no output shows them. A token that a stage reads is an original token for §7, whatever its span, source, text or `insertedBy` (§7.2).

The source of one token or more runs from the least source start among them to the greatest source end. An empty source counts as the point where it lies. Tokens usually lie in the order of their sources. Then this source runs from the source start of the first token to the source end of the last token.

Tokens need not follow the order of their sources. An emission lists its captures in the order in which they stand (§9, §11). But an inserted token can have its source before the token ahead of it, or after the token behind it. So can a token over a part that read nothing. An empty span of tokens has no such source: its source is given where it is used (§11, §12).

A tag is one of three kinds, and its kind shows in its first character:

- An identifier tag is a name (§9): an ASCII letter followed by ASCII letters, digits and hyphens.
- A phoneme tag is exactly three code points, whose first and last are `/`, such as `/a/`.
- A character tag is one Unicode scalar value between two quotes, `'`, such as `'a'`. The quotes are part of the tag.

A character tag's identity is its scalar value, so a tag has one canonical spelling. Its canonical spelling is the character itself between the quotes, with five exceptions. The engine writes a control character, U+0000 to U+001F or U+007F to U+009F, as `\u{h…}`. It does the same for a nonspacing mark, which has no base between the quotes. The engine also writes a private-use character so: U+E000 to U+F8FF, U+F0000 to U+FFFFD, or U+100000 to U+10FFFD. The quote and the backslash are the last two exceptions.

A nonspacing mark is a character whose General_Category in `grammars/unicode.txt` is `Mn`. In `\u{h…}`, the hexadecimal digits are upper case, with no leading zeros. So U+0301 is `'\u{301}'`, U+ED80 is `'\u{ED80}'`, and the quote is `'\u{27}'`. Everywhere in the engine and its output, a tag is a string in this canonical spelling. So two tags are equal exactly when their strings are.

The input of the first stage is the characters of the text, one token for each code point `c` at position `i`. For this token, `span` and `source` are `[i, i+1)`, and `text` is `c`. Its `tags` hold one tag, the character tag of `c`, and nothing else. A character token has no phonemes, and its label is its text. A grammar reads a class of characters, such as the letters, with a range or a property.

A text is a sequence of Unicode scalar values. A text that is not one is a usage error (§13), and the engine refuses it before it makes any character token. In JavaScript and Python, such a text is a string with a lone surrogate. In Go, it is a string that is not valid UTF-8. A Rust string is always valid. The same holds for a grammar document that the caller supplies as a string.

A library reads a grammar document from disk as strict UTF-8. Bytes that are not valid UTF-8 are a `grammar` error of loading, not a usage error, because the caller supplied no string. The error names the document and says that its bytes do not decode. It has no line and no column. The library finds this before it hashes the document or looks in `compiled.json` (§8). A byte order mark stays in the text as the character U+FEFF.

`tools/unicode-table.py` generates `grammars/unicode.txt` from one version of the Unicode Character Database. Every library uses this file, not the Unicode data of its platform, so that the four libraries agree on every character. The file holds one entry on each line, with code points in hexadecimal:

- `unicode 15.1.0` gives the version of the data.
- `category Lu 0041 005A` gives a range of code points whose General_Category is `Lu`. The category is in its short form.
- `white-space 0009 000D` gives a range of code points that have the White_Space property.
- `lower 0041 0061` gives a code point and its simple lowercase mapping.

In the bundled file, each `category` range is a longest run of one category. Together these ranges hold every Unicode scalar value once. `Cn`, the unassigned code points, has its ranges too. The records can stand in any order in a file. Each library sorts them when it loads the file, so their order never changes an answer.

A caller can supply its own `unicode.txt` (`docs/api.md`). That table replaces the bundled data entirely, `White_Space` included, and nothing falls back to the bundled data. So the table must list the white space that the caller's grammar documents use. A table need not hold every scalar value. A scalar value that no `category` range holds has the category `Cn`. One that no `white-space` range holds lacks White_Space, and one with no `lower` entry has no lowercase mapping.

`Cs` belongs only to the surrogates, U+D800 to U+DFFF, and a table lists none of them. A surrogate is not a scalar value, so it never becomes a character tag.

A tag set is a set of tags. A tag has no strength: a set holds it or not. The union holds every tag of either set. The intersection holds their shared tags. The difference holds the first set's tags that the second lacks.

A range, written `'a'..'z'`, is the set of the character tags from its start to its end, by scalar value. Its two ends are character tags. It skips the surrogates, which are not scalar values, so `'\u{D7FF}'..'\u{E000}'` holds two tags. A range whose start is above its end is an error of the document (§9).

A property, written `'\p{Name}'`, holds the scalar values that have a property in `grammars/unicode.txt`. The names are exactly these, and their case counts. Each General_Category value in its short form is a name. So is each group of these values, which holds the values whose short form begins with its letter:

- `L`: `Lu`, `Ll`, `Lt`, `Lm` and `Lo`
- `M`: `Mn`, `Mc` and `Me`
- `N`: `Nd`, `Nl` and `No`
- `P`: `Pc`, `Pd`, `Ps`, `Pe`, `Pi`, `Pf` and `Po`
- `S`: `Sm`, `Sc`, `Sk` and `So`
- `Z`: `Zs`, `Zl` and `Zp`
- `C`: `Cc`, `Cf`, `Cs`, `Co` and `Cn`

The two other names are `White_Space`, the code points of the `white-space` ranges, and `Any`, every scalar value.

No other name is a property. So `'\p{lu}'` and `'\p{Letter}'` are errors of the document (§9). `'\p{Cs}'` is a property, but no character tag has it, since a character tag is never a surrogate. A property is not a tag set. It stands only as a terminal (§4).

## 2. Grammars

A grammar is the stitching of the items of one stage of a pipeline (§13) into a set of rules, directives, constants, classifiers and implications. An item is a rule, a directive, a constant definition, a classifier or an implication, read from a document (§8, §9). A rule has a name and alternatives, and optionally rule-level tags, conditions and an emission clause. An alternative has guards, an expression, and optionally tags. The grammar DOM (document object model), in `docs/output.md`, is the exact data.

To stitch a stage's items, the loader reads them in order, whatever documents they come from. Each rule is stated one of three ways, and each is an error in the case given:

- `%rule` (`define`) defines a rule. It is an error if a rule of that name was defined before it in the stage.
- `%redefine-rule` (`redefine`) replaces the rule of that name defined before it in the stage. It is an error if none was. The earlier alternatives are then gone, those of any `%extend-rule` of the rule included.
- `%extend-rule` (`extend`) appends its alternatives to the rule of that name defined before it in the stage. It is an error if none was.

When `%extend-rule` extends a rule, each appended alternative carries the extension's own clauses: its rule-level tags, conditions and emission. These clauses apply to the appended alternatives alone, and the base rule's clauses do not apply to them. The earlier alternatives keep their own clauses. So a script document can add letters to a rule without restating its clauses, and its own clauses do not leak into the base rule. A definition is a `%rule`, `%redefine-rule` or `%extend-rule` statement: its alternatives and the clauses written with them. The loader records every replacement and extension.

A rule flag gives a rule a preference. Only `greedy` is supported. `%rule(greedy)` defines a flagged rule, and `%redefine-rule(greedy)` replaces its body and flag. A `%rule` or `%redefine-rule` without parentheses gives the rule no flags. `%extend-rule` accepts no flags and inherits the stitched rule's flag for all added alternatives. Flags belong to the rule, while clauses belong to each definition.

Parentheses follow the keyword and precede the name. Their only accepted content is `greedy`, with optional surrounding spaces. Empty parentheses, duplicates, unknown flags, arguments and parentheses on `%extend-rule` are errors of the document. Section 9 gives their priority and positions.

The loader collects directives from all the stage's items. `%stage`, `%include` and `%features` shape the pipeline (§13) and do not belong to a stage. The other directive, `%ambiguity-resolution`, belongs to the stage.

A stage also has constants. A constant is a named value that terms and conditions use (§10). Its name is `$` and a name (§9) that begins with `A` to `Z`, such as `$SU-STOPS`. By convention, the whole name is in capitals.

An item states a constant in one of two ways. `%const $NAME t` (`define`) defines the constant. It is an error if a constant of that name was defined before it in the stage. `%redefine-const $NAME t` (`redefine`) gives the constant a new value. It is an error if no constant of that name was defined before it in the stage.

`t` is a closed term (§10). The loader evaluates it when it reaches the item in the stitching order. A constant in `t` has the value that it has at that point. In a `%redefine-const`, the constant's own name stands for its value before the redefinition. So one redefinition can extend a set with `∪`, narrow it with `∩` or `∖`, or replace it.

A constant in `t` that is not defined at that point is an error. So no cycle can arise. For example, after `%const $A ~a`, `%const $B $A` and `%redefine-const $A ~b`, `$A` is `~b` and `$B` is `~a`. A redefinition keeps the constant's type. A value of another type is an error.

Rules see the final values. A constant in a rule's terms, conditions or tests has the value that the last definition of the stage gives it, wherever the rule stands.

After the loader stitches the stage, it makes sure that each rule definition that holds a constant meets the requirements of this section. A constant that the stage never defines is an error there. The types of the terms, conditions and tests that hold constants must agree (§9, §10).

A string constant in an `=` or `≠` test must be a canonical sound (§9). The requirements of §9 that depend on the value of a constant apply there too. The loader applies these requirements to every definition of the stage. That includes a definition that a later `%redefine-rule` replaces, although its alternatives are then gone.

A constant belongs to its stage, as a rule does. A document in several stages or dialects takes the values of each. The DOM of a document holds its definitions and its references to constants, never their values (§8).

Each error of a constant is an error of the document. The loader reports a second `%const`, a `%redefine-const` of nothing and a change of type at the constant's definition. The loader reports errors from the two deferred capture checks of §9 at the rule's definition. It reports every other error at the reference to the constant.

A stage also has classifiers. A classifier maps a string to a tag set, the string's classes (§10). An item `%classifier NAME` (`classifier`) names a classifier of the stage and lists entries for it. `NAME` is a name (§9) that begins with `a` to `z`. Several items can name one classifier, and together they make it. So a second item of one name is no error, unlike a second `%rule`.

An entry has gates, one or more keys, an operator and one class. A gate is a guard `f?` or `¬f?`, as in an alternative (§3.1). A key is a string that is a canonical sound (§5, §9). The operator is `∈` or `∉`. The class is an identifier tag whose first character is `A` to `Z`.

A classifier's value depends on the features, so the stage resolves it for one set of enabled features. It starts with no memberships, and takes the entries of every item of that name in the stitching order. It skips an entry whose gates do not all hold, as lowering drops an alternative (§3.1). For each key of any other entry, in order, `∈` adds the membership of the key in the class, and `∉` removes it. The value maps each key to the classes that it has after the last entry.

An `∈` whose membership already holds is an error of the grammar, and so is an `∉` whose membership does not hold. The stage resolves every classifier of its grammar when it lowers the grammar for the features of a parse (§3). It resolves them before it lowers the rules, and whether or not a term reads them. So such an error ends the stage as an error of lowering does (§3.3). Its message names the document, line and column of the entry. An entry that a gate skips has no such error.

A call `classify(a, C)` names the classifier `C` (§10). A `classify` whose classifier no `%classifier` item of the stage declares is an error of the document. A classifier belongs to its stage, so the loader finds this error when it stitches the stage. It reports the error at the definition that holds the call.

A stage also has implications. An item `%implies A ⟹ B` (`implication`) adds one. `A` and `B` are closed terms (§10) whose type is a tag set. A constant in them has the value that the last definition of the stage gives it, as in a rule. After the loader stitches the stage, it makes sure that their types agree, as it does for a rule (§9). §11 says how the stage applies its implications.

A stage has exactly one `%ambiguity-resolution L [elision-only]`, or it is an error naming the stage. `L` is `greedy`, `lazy` or `late-elision` (§6). A document that declares the retired operand `maximal` is an error at the directive. `[++T]` still marks an individual maximal terminator (§4).

No directive names elidable terminators. A rule marks each elidable optional in its body, as `[+T …]`, or as `[++T …]` where its terminator is also maximal (§3.8, §4). `%elidable` is not a directive. So whether an optional is elidable, and whether its terminator is maximal, is a property of the optional itself. It is the same in every stage that includes its document.

A name whose first character is `A` to `Z` is a terminal, the identifier tag of that name. The DOM writes both kinds of name as `ref`, and lowering (§3) tells them apart by that first letter. Any other name is a rule reference, and must be defined in the stage, or it is an error. `#`, the free-modifier slot, is a rule's name like any other.

A tag literal `~name`, a phoneme tag or a character tag is a terminal too. The DOM writes it as `terminal`, the tag. A range and a property (§1) are terminals as well, which the DOM writes as `range` and `property`.

A reference other than `#`, or a terminal, can carry one test on its own span, as in `LE="la"`. A tested symbol is a symbol with a test. The test is not part of the name. A tested terminal is the same terminal, and a tested reference refers to the same rule. A test has one of six forms, where `X` is the symbol:

- `X="s"` and `X≠"s"`: The canonical sound of the span (§5) is `s`, or it is not.
- `X⊇t` and `X⊉t`: The own tags of `X` include every tag of `t`, or they lack one at least.
- `X∩t=∅` and `X∩t≠∅`: The own tags of `X` include no tag of `t`, or they include one at least.

The first two are sound tests, and the other four are tag tests. `s` is a closed term (§10) whose type is a string, and `t` is a closed term whose type is a tag set. The own tags of a terminal are the tags of its token. The own tags of a reference are the tags of its completed constituent (§4).

## 3. Lowering

This section writes productions as `lhs → symbols`. This is not jbogenbau, the notation of gencmu grammars (`docs/notation.md`), but the context-free grammar that a jbogenbau grammar is lowered to.

Lowering turns a grammar, given the set of enabled features, into a context-free grammar of productions. The lowered grammar is what the parser runs. Lowering decides nothing that a user can observe, except through §4-§6 and its errors. For the same features, the stage also resolves its classifiers (§2).

Every production of a named rule records the stitched rule's flags. Productions from extensions, expanded alternatives and recursive chain levels all carry them. Helpers carry no flags. Flags change no recognition, nullability, symbol test or default tag. A close of a flagged production with one symbol does not affect the action comparison. Its occurrence still contributes to the rule profile (§6).

A stage lowers its grammar when a parse gives it the enabled features. So a dialect whose documents read and stitch loads, whatever errors lowering finds for some features. An error that lowering finds is an error of the grammar for the features of that parse. It ends the stage as the stage's result, as other errors found while parsing do. The stage has no verdict, no tree and no output, and no later stage runs.

The error has the kind `grammar` and the stage's name, and no position member, since its position is not one of the stage's input (`docs/output.md`). Its message begins with the document, the line and the column of the definition that wrote the alternative at fault, as `case/a.md:3:1:`. That definition is the `%rule`, `%redefine-rule` or `%extend-rule` that holds the alternative. It is not the place of the braces in it, and not another definition that makes an item of the braces empty. The errors of a classifier (§2) are reported in the same way, at their entry.

Where a grammar has several errors of lowering, the parse reports one, in this order. Errors of classifiers come first. Then lowering takes the rules in order (Numbering, below). For each rule, it reports a chain beside another alternative (step 3) before it lowers that rule's alternatives.

An item of braces that can match no tokens (step 3) comes last. Lowering decides nullability after it lowers all rules. It examines the surviving rules and their alternatives in order, and reports the first alternative that holds an empty item. The error names only the definition, so which empty item of that alternative it meets first is not observable.

So a chain beside another alternative is reported before an empty item, whichever rules hold them. This order is the model of the diagnostic, not of the work. An implementation can meet the braces in another order internally, as long as it reports the same error.

1. Lowering drops an alternative whose gates do not all hold. A gate `f?` holds when the feature `f` is on, and `¬f?` when it is off. A warning `f!` is not a gate and never drops its alternative (§12).
2. Lowering expands each remaining alternative into sequences of symbols. `(a | b)` expands to both, in written order. A plain optional `[x]` that holds a capture (step 5), at any depth, expands in place as `(ε | x)` does. It expands first to the empty sequence, then to each expansion of `x`, in order. It has no helper. Any other `[x]`, plain or elidable (step 8), is a helper `h → ε | x` (step 4).

   An elidable optional `[+T x]` or `[++T x]` is always a helper `h → ε | T x`, since it never holds a capture. Flat braces are a helper too. `{x}` is `h → x | h x`, and `{x \ s}` is `h → x | h s x`. So `[{x}]` is a helper `o → ε | h` around the helper `h` of `{x}`. Lowering expands `x` and `s` in place in these productions, as anywhere in an alternative. So a sequence or a choice there needs no helper of its own.

   `A₁ & … & Aₙ` has at most 16 items. More is an error of the document (§9), since the expansions number 2ⁿ−1. It expands to every non-empty subsequence that keeps their order. The subsequences come in the order of the binary numbers 1 to 2ⁿ−1, with `A₁` as the lowest bit. `ε` is the empty sequence. A sequence's expansions are the products of its items' expansions, the first item varying slowest.

   So `A [$b(B)] [$c(C)]` expands to `A`, `A C`, `A B` and `A B C`, in that order. `A [B] [$c(C)]` expands to `A h` and `A h C`, which share one helper `h → ε | B`. A plain optional that holds a capture, whose content has k expansions, contributes 1 + k expansions: the empty one, then those k. A sequence multiplies these counts, as for a choice. So `[$b(B)]` doubles the expansions of its alternative, and `[($a(A) | B | C)]` contributes four. The nested `[A [$b(B)]]` contributes three: `ε`, `A` and `A B`.

   An optional expanded in place is no symbol of its own. So the rules that read the symbols of a production read its expansion as it stands. They are the default tags of step 7, the transparent closes of §6, the constituent of an elided terminator (§4) and the cycle rule (§4). For example, the expansion `A` of `A [$b(B)]` has one symbol. So it inherits the tags of `A`, and its close is transparent. But `A [B]` always has two symbols, `A` and a helper.

   A tested symbol expands to that one symbol, which carries the test. It adds no helper. So the numbering, the transparent closes of §6 and the constituents of a production are those of the symbol without its test. Two productions that differ only in the test of a symbol are two productions.
3. A chain is an alternative whose whole expression is `{... x \ s}`, a left chain, or `{x ... \ s}`, a right chain. Either can leave out `\ s`. The reader makes sure that a chain is the whole expression of its alternative (§9). A chain must also be the only alternative of its rule left after step 1. Another alternative beside it is an error of the grammar.

   Lowering turns the chain into recursion on the rule itself, with no helper for the braces. `{... x \ s}` becomes `r → x | r s x`, and `{x ... \ s}` becomes `r → x | x s r`. Without a separator, `s` is left out of these productions. Lowering expands `x` and `s` in place, as in step 2.

   Every level of a chain is then a constituent of `r`. The ranking sees its closes (§6), and the clauses of the alternative attach to its base productions and to its recursive productions alike (step 6). The default tags of step 7 come from each production as it stands. So without written tags, `r → x` has the tags of `x` where `x` expands to one symbol, and a recursive production has none.

   An item of braces, flat or chain, that can derive the empty sequence is an error of the grammar. Lowering decides this over the structural grammar of the enabled features. That is every production that steps 1 to 5 make from the stitched stage, helpers included. Step 6 has not yet removed any production whose condition simplifies to false. Tests are ignored. So a production that a false condition removes still counts, and so does a production that a test can never pass.

   A rule that `text` cannot reach counts too, and lowering checks the braces of every remaining alternative, reachable or not. An alternative that a gate drops, and a definition that a later `%redefine-rule` replaces, do not count. An alternative that an `%extend-rule` adds counts like any other. Every implementation decides nullability in this phase, whatever order it builds its productions in.

   A separator can derive the empty sequence. So a list or a chain never has a derivation that repeats an empty item, and `[{x}]` derives the empty sequence in exactly one way.

   Lowering finds both errors of this step when it lowers the grammar for features that make them. It reports each one at the definition that wrote the alternative, as for any error of lowering. The order is the one that the start of this section gives. A gate or a `%extend-rule` can make either error depend on the features, and a warning guard never removes an alternative.

   A flat list is one helper, so its closes are transparent (§6), and the clauses of its rule apply only to the rule's whole constituent. Some grammars need each prefix of a list as a constituent, which the ranking and the rule's conditions see. Such a grammar writes a chain or explicit recursion.
4. The engine names the helpers, and it never shows their names. A helper is a production whose left side is a helper name.
5. A capture `$x(s)` must wrap a single symbol `s`, which can be tested. It can stand anywhere in the expression of an alternative, at any depth. That includes a group, a choice, an item of `&` and a plain optional. It must not stand inside braces, flat or chain, or inside an elidable optional (step 8), at any depth (§9).

   A capture labels the symbol's position in each production that reads the symbol. A production has the capture `x` exactly when its expansion reads the symbol that `$x` wraps. The other productions of the alternative lack it, and the missing-capture rules of step 6 apply to them.

   A name stands at most once in each production, but it can stand in several productions of one alternative. So `A ($x(B) | $x(C))` is valid: each of its two productions reads one `$x`. `[$x(A)] $x(B)` and `$x(A) & $x(B)` are errors, because the expansions `A B` hold `$x` twice (§9). Two alternatives of a rule can always capture one name, and two branches of a choice are two productions in the same way.

   A production's captures stand in the order in which it reads them. That is the order of their positions in the text, since an expansion keeps the left-to-right order of what it reads. Different productions of one alternative can read the same names in different orders, as in `($a(A) $b(B) | $b(B) $a(A))`. An alternative can have any number of captures. Each costs what §4 says.

   `$`, the whole constituent, is a capture of every production that no alternative writes. Its span runs from the item's origin to its end, and its tags are the constituent's (§4).
6. Conditions, tags, emission and `%opaque` attach to the production that an alternative lowers to, or to each production if it expands to several. They attach with the clauses of the alternative's definition (§2). A production has a capture where its expansion reads the captured symbol (step 5), and every production has `$`.

   Before lowering attaches a clause, it simplifies the clause for the production, by these rules:

   - Each presence test `$x` (§10) becomes true or false as the production has `x` or not.
   - `A ⟹ B` becomes `B` where `A` is then true. Where `A` is false, it becomes true, as a condition, or the empty set, as a term.
   - A condition `A ⟹ B` whose `B` is then true becomes true, and one whose `B` is false becomes `¬A`.
   - Lowering reduces `¬`, `∧` and `∨` over a true or false part as logic says.
   - A constant is its value here. So a constant whose value is the empty set is an empty set.
   - Lowering drops a term's empty set, written `∅` or left by a guard, from a union. A union of nothing but empty sets is the empty set, as is an intersection with one. A difference whose first part is empty is empty. If its second part is empty, the difference is its first part. A guarded term whose term is the empty set is the empty set.

   Since the engine never evaluates a reduced part, the reduction is part of the order of evaluation (§10). A capture that is still mentioned after simplification is used by the clause. Then the simplified clauses attach as follows:

   - A condition applies to a production if it did not simplify to true and the production has every capture that it uses. Otherwise lowering drops it for that production. A condition that simplifies to false applies, and removes the production. So `%conditions $x` keeps the alternatives that capture `x` and removes the others.
   - Lowering drops an emission item whose carrier (§11) the production lacks from that production's emission. It also drops each attachment capture that the production lacks from its item.
   - A tag term, the alternative's own or the definition's `%tags`, that uses a capture the production lacks is an error of the document.
7. A production's tags are the union of its alternative's own tag term and its definition's `%tags` term, where either is written. A production with neither has the tags of its symbol's constituent if it has one symbol, and none if it has none or several. Lowering makes this explicit: it treats the single symbol as captured. In the check of §7, a restoration has the tags of the empty production that it stands for, which are none. A terminal that reads a synthetic token gives no tags to the production that inherits from it (§7.5).
8. An optional is elidable exactly when it is written `[+T x]` or `[++T x]`. Its terminal is `T`, an identifier tag, which can carry an `=` test. `T` stands directly after the marker, with no group around it or around the content. `x` is a sequence of any primaries, possibly empty, and holds no capture at any depth. The reader makes sure of this form (§9). An optional written `[++T x]` is maximal: its terminator follows the rule of maximal terminators (§4).

   A plain optional `[x]` is never elidable, whatever its content, also where it begins with a terminal that another optional marks. So `[KU]`, `[KU | VAU]` and `[{KU}]` are ordinary optionals, and the `[+KU]` of `{[+KU] A}` is elidable.

   The `elision-only` check (§7) reads this same lowered grammar in a mode of its own. In that mode, an elidable optional is restored or written, and never empty (§7.4). A tested elidable terminal keeps its test there.

   The terminal of an elidable optional has no test or an `=` test, since §7 restores it with its sound. Any other test on it is an error of the document, which the reader reports at the test (§9). The marker is part of the optional's text, so no later item of the stage can change whether an optional is elidable. A test on a later symbol of the optional is no error, since §7 restores only the terminal.

   Lowering keeps, with each helper, whether it is the helper of an elidable optional, its terminal `T` with its test, and whether it is maximal. The rest of this document says "elidable optional" and "maximal terminator" of these helpers. Two elidable optionals of one terminal can differ: `[+T]` and `[++T]` in one stage are one plain and one maximal terminator.

Lowering numbers the productions from 0. The canonical order *T* of §6 uses this numbering. *T* orders the ambiguity diagnostics and selects the forbidden terminator that a maximality rejection reports (§4). The canonical tie-break keys never turn a tie into an accepted reading.

A production that a condition false for it removes (§3.6) takes no number, though the helpers of its alternative still do. Lowering takes the rules in the order in which they were first defined after stitching. A rule replaced with `%redefine-rule` keeps the place of the rule that it replaces, and alternatives added with `%extend-rule` follow the rule's own alternatives.

Within a rule, lowering takes its remaining alternatives in order. Each alternative contributes its own productions first, and then its helpers. Its own productions come in the order of its expansions (step 2). For a chain, the base productions come first, one for each expansion of `x`. The recursive ones follow, one for each expansion of the sequence that the recursion adds, in the order of step 2. That sequence is `s x` in a left chain and `x s` in a right chain.

An alternative's helpers come one for each place in the alternative where a helper's `[ ]` or flat `{ }` is written. They come in the order in which those places are written, left to right. A plain optional that holds a capture is expanded in place (step 2) and has no helper and no place of its own. The places written inside it keep their order among the others. So the expansions of such an optional are productions of the rule itself, numbered in the order of step 2. The canonical order *T* of §6 compares them by those numbers.

The helpers of the places written inside a helper follow that helper's productions at once, depth first, before the next helper of the alternative. A helper of flat braces has its base productions first and then its recursive ones, as a chain does. The places inside `x` come before those inside `s`, since `x` is written first.

The braces of a chain (step 3) have no helper: they are lowered into the rule's own productions. But the `[ ]` and flat `{ }` inside its item and its separator have helpers, as anywhere else.

Every expansion of the alternative that goes through a helper's place shares that helper. So an item of `&`, or a place inside the item or the separator of braces, has one helper however many expansions use it.

## 4. Recognition

The parser is an Earley recognizer, a parser for any context-free grammar, over the lowered grammar. The set of items that it produces specifies it, and any algorithm that produces that set is correct. The recognizer builds one set of items for each position in the input.

An item has a production, a dot position and an origin, the position where the item began. For each capture before the dot, it also has the captured part's span and tag set. Two items equal in all of these are one item. Two items that differ in a captured part's tag set are two items, even over the same span. So derivations that differ in nothing that a condition or tag clause can see share an item.

Take one production, dot position, origin and input position, and one tag set for each captured part. Then the captures add items only where the span of a captured part can vary. For example, with `t → $l(t) $r(t) | A`, a completed item over one span exists once for each position where `$l` can end. Without the captures, it exists once.

Captured spans increase the item count, and the notation sets no limit on the number of captures. A captured part's span before the dot is part of an item's identity. So items that differ only in where a captured part began or ended are not merged. Neither are the summaries of §6 and the states of eligibility above that are kept for each item.

Take one production, dot position, origin and input position. Each captured part before the dot can multiply the number of its items by the number of its possible spans. Let N be the length of the input. The factor is up to N + 1 for each end of the part that nothing else fixes. The origin, the input position or a neighbouring captured part can fix an end. Its tag sets can multiply the items again.

A capture of a terminal, or of a part whose length is fixed, costs little, since its start fixes its end. A capture of a rule that can end in many places, such as a list, costs the most. Where a clause only needs the whole constituent, `$` costs nothing, since the origin and the position fix it.

No memo depends on the number of captures. The memo of nested queries (below) is keyed by the query's kind, rule and span or content, never by captures. Only the identity of items, and what is keyed by items, grows with them.

A terminal `T` matches a token whose tags contain `T`. A range matches a token that carries at least one character tag of the range. A property matches a token that carries a character tag whose scalar value has the property. Either one matches such a token once, with one reading, however many of its tags qualify.

A range or a property has no tag of its own. As a terminal, its identity is its written form in canonical spelling, such as `'a'..'z'` or `'\p{L}'`. The ends of a range are in their canonical spelling (§1), so `'\u{61}'..'z'` is `'a'..'z'`. This form is the terminal for the ranking and its canonical keys (§6). It is also the terminal in the expected terminals, the tree's token nodes (§12) and the witness.

A tested symbol (§2) matches what its symbol matches, where its test holds. The test reads the symbol's own span and its own tags. For a terminal, the span covers that one token in the current input, and the tags are the token's tags. For a reference, they are the span and the tag set of the completed item that the item advances over.

`X="s"` holds when the canonical sound of the span, `phonemes(span)` (§5), is exactly `s`. So the match ignores stress, script and syllable breaks. `X⊇t` holds when the own tags include every tag of `t`. `X∩t=∅` holds when they include no tag of `t`. `X≠"s"`, `X⊉t` and `X∩t≠∅` hold exactly where those three do not.

A test is an ordinary predicate, and an empty span is no exception. So `X=""` and `X≠"la"` hold for a constituent that completed empty, and `X⊇∅` always holds. A character of the first stage has no phonemes, so its canonical sound is the empty string.

When an item reads a tested symbol, the recognizer produces the advanced item only if the test holds. This holds over a token, for a terminal, and over a completed item, for a reference. It includes an advance over a constituent that completed empty at the item's position. Two completed items over one span can have different tag sets. So a tag test can let an item advance over one of them and not over the other.

The recognizer applies the test before any condition that the advance makes ready. The paragraphs below say when a condition is ready, and they give the order of one step in full. If the test fails, the recognizer evaluates none of the conditions that the advance makes ready. The order is observable, because a condition can end the parse with an error of the grammar. The test does not stop the conditions that run earlier. These are the conditions inside the referenced rule, which run before that rule completes. They are also the conditions of the advancing item's own production that run when the recognizer predicts that item.

The test is not part of the terminal's identity. A tested terminal `T="s"` is the terminal `T` for the actions of §6. It is also `T` in the tree's token nodes (§12) and in the witness. The test only removes matches.

When an item completes, its constituent's tags are its production's tag terms evaluated over its captured parts (§10) and joined as §3.7 says. A completed item has exactly one tag set. So two derivations of one production over one span that are one item have equal tag sets. Two such derivations with different tag sets differ in a captured part, so they are two items.

The recognizer evaluates a condition, as simplified for its production (§3.6), as soon as the item reads the last capture that it uses. It evaluates a condition that uses `$` as soon as the item is complete. At that point, `$` spans from the item's origin to the set that the item completes in. It has the tags that its production's tag term gives it. If the condition fails, the recognizer does not produce the advanced item.

The recognizer evaluates a condition that uses no capture when it predicts the item. It does the same with a condition that uses only `$` in a production with no symbols, over the empty span there. So a rule whose only production has no symbols and the condition `initial($)` completes only at the start of the input. Anywhere else, the recognizer never advances an alternative that begins with that rule, and that alternative predicts nothing after the rule.

A step of the recognizer is an advance of one item, or the prediction of one production at one position. Each step evaluates its parts in this order, and it stops at the first part that drops the item:

1. In the check of §7, a step whose new item is strict and stands at the end of its production. §7.4 drops that item before the step evaluates any condition or tag term.
2. The test of the symbol that the step advances over, where that symbol has one.
3. The conditions that the step makes ready, in their written order. A condition on captures and a condition on `$` that become ready at one advance keep that order. Each one stops early as §10 says. The first that fails drops the item.
4. Where the step completes the item, its production's tag term. The recognizer evaluates it where a condition of step 3 first reads `tags($)` or `classes($)`. Otherwise it evaluates it once every ready condition holds. So a failing condition that does not read them stops the tag term. This holds also for a production with no symbols at its prediction. How many times the step evaluates the tag term is not observable.

A condition or a tag term can end the parse with an error of the grammar. Where an earlier part drops the item, that error never happens. So the order of steps 3 and 4 after steps 1 and 2 is observable, and so is the written order within step 3.

Two orders are free:

- The drop of step 1 and the test of step 2. A test is an ordinary predicate and raises no error, and either one only removes the item. So both orders give the same items and the same errors.
- The parts of one tag term. The alternative's own tag term and its definition's `%tags` join as a union (§3.7). Where both fail, the two orders differ only in which error's message the result has, and the message is free.

The order between steps, between items and between sets is not observable either. Every step that the rules of this section reach runs in the end, so the same errors happen. §7.4 removes steps, and their errors with them. Two such errors differ only in their message.

`matches(span, rule)`, `begins(span, rule)` and `tags(span, rule)` each run a nested parse. A nested parse is one recognition over the span's tokens alone, with `rule` as the start rule, over the same lowered grammar. It applies tests and conditions as the main parse does.

A query that the check of §7 starts reads the projected span in the stage's input. It uses this lowered grammar in its ordinary mode (§7.6). Its chart is every item, partial or completed, that this recognition holds after it ends. The three functions read the eligible proof trees of the chart (below), before any ranking:

- `matches` holds when a completed item of `rule` spans the tokens and has an eligible proof tree.
- `begins` holds when a completed item of `rule` has its origin at the span's start, in any set, and has an eligible proof tree. So it covers a prefix of the span, the empty prefix included.
- `tags` is the union of the tag sets of the completed items of `rule` that span the tokens and have an eligible proof tree.

A proof tree of an item shows how the rules of recognition justify the item from the chart. A predicted item, with its dot at the start, is a leaf. An advance of an item over a token or over a completed item is a node. Its children are a proof tree of the item before the advance and, for a completion, a proof tree of the completed item. Each advance follows the rules of this section, with its tests and conditions satisfied.

A proof tree is finite, and it does not depend on the order in which the recognizer finds items. A rule can occur again over the same span within it. This differs on purpose from the derivations that a stage counts and ranks (below, and §6), which exclude such a repetition. An item with no finite proof tree from predicted items has none, so a cycle alone gives none.

An implementation can rebuild the advances from completed spans, as it can for a stage's derivations (below). Such a rebuilding keeps the captures, and it applies the symbol tests again to the actual candidate. It never evaluates a condition again.

Several eligible proof trees are an ordinary success. A query never ranks its proof trees, and it never has a tie or an ambiguity error. The witness of a tie (§6) is a different thing, and a query has none.

A nested parse follows written-terminator priority. In plain words, a nested reading cannot leave out an elidable optional where the same construct can read that whole optional as written. A proof tree is eligible when none of its omissions is forbidden. An omission is an advance of an item over the empty helper of an elidable optional (§3.8), at its position `p`.

Whether an omission is forbidden depends on the production prefix that the proof tree holds fixed, as follows:

- Where the optional has a constituent `Y` (below), the fixed prefix is the item before `Y` in the same proof tree, with its captures. The omission is forbidden when the chart advances that item over a completed `Y` that ends at some position `p′ ≥ p`. The resulting item then advances over a completed nonempty alternative of the optional, from `p′`. That completed `Y` passes `Y`'s test, if it has one.
- Where the optional has no constituent, the fixed prefix is the item before the optional itself. The omission is forbidden when the chart advances that item over a completed nonempty alternative of the optional, from `p`.

An omission of a maximal terminator (below) is also forbidden when its constituent is not the longest possible. The test is that of the main parse. A longer candidate is a completed item of the same symbol, with the same origin and a later end. The constituent's symbol test, if any, holds of the candidate's own span and tags.

The candidate comes from the unfiltered chart of the query. It need not have an eligible proof tree, and it need not fit a proof tree of `rule`. This holds whether or not a terminator is written, also where the whole written optional cannot complete. The query's chart ends with its span. So a `matches` over a captured span sees no longer constituent past the span. A `begins` with `from` or `after` sees the rest of the input.

The nonempty alternative is the whole content of the optional, not only its terminator. So a written terminator forbids an omission only where the whole optional can complete after it. For example, take `r → c [+T A] D` and `c → B | B D`. On `B D T`, `begins` of `r` holds. The longer `c` reaches the `T`, but `[+T A]` cannot complete. On `B D T A`, `begins` is false, because the whole written optional completes.

The advances of a blocking path come from the chart. So their tests and conditions passed. They need not belong to a proof tree of `rule`, and they need not be eligible themselves. An attempt that never completes `rule` can still forbid an omission.

So eligibility belongs to a whole proof tree, not to an advance alone. Two proof trees of one item can hold different items fixed before `Y`. An omission is permitted only through a proof tree whose own fixed prefix permits it, and that same tree must be eligible. An eligible prefix of one tree never combines with the permitted omission of another.

For example, take `r → [A] y [+T] C T U` and `y → A B | A B C | B z [+U]`. Also take `z → ε | C T`. On `A B C T U`, `begins` of `r` is false.

Two proof trees reach the omission of `[+T]` after `y`. In the first, `[A]` is empty and `y → A B`. That prefix is eligible, but the omission is forbidden, since the same prefix reads `A B C` as `y` and then the written `T`.

In the second tree, `[A]` reads `A` and `y → B z [+U]`, so the omission of `[+T]` is permitted. But that tree is not eligible. Its omission of `[+U]` is forbidden, because `z` can read `C T`, and then the written `U` follows. Without the `[+U]` of `y → B z [+U]`, the second tree is eligible, and `begins` holds.

An implementation can keep two states for each item. The first, E, says that the item has an eligible proof tree. The second, P, says that it has an eligible proof tree whose fixed prefix permits the next optional to be empty. The two states follow these transitions:

- A predicted item has E.
- An advance that is not an omission gives the new item E when the item before it has E. For a completion, the completed item has E too.
- An omission gives the new item E only when the item before it has P.
- The item before an optional with a constituent `Y` has P through one advance over `Y` that gives it E. The item before that advance is the fixed prefix, and that prefix must permit the omission. Where the optional's terminal is maximal, the completed `Y` of that advance must also be the longest possible, by the test above.
- The item before an optional with no constituent has P when it has E and it permits the omission itself.

The implementation computes E and P together, to the least answer that the advances give. So an item that only a cycle through itself makes eligible has neither state.

Eligibility filtering reads only the chart, and it evaluates no conditions. A query's answer determines which expressions the enclosing condition evaluates. The recursive-query error rule (below) applies to those evaluations.

A query reads the tokens of its span alone. A `matches` over a span does not look past the span's end, even where a written terminator stands after it. So the keys of the memo (below) fit its answer.

`begins` is one recognition over the whole span, not a separate parse of each prefix. The reason is that the conditions inside `rule` see the end of the span as the end of their input. A recognizer can stop at a set that holds no item, since no later set can then hold one. Otherwise it reads as far as it can. An error of the grammar that it meets is an error, even after `rule` completed once.

An implementation can remember the answers for the whole parse of a stage, in a memo. A memo stores answers from earlier nested parses. This is recommended, but not required. Two queries can share an answer when the nested parse observes the same things in both. That is, the two queries are of the same kind and ask about the same rule. They also have the same span or the same content.

The same span is the same start and end in the stage's input. Within one parse, the span fixes the tokens and the lowered grammar. A query that the check of §7 starts has its projected span here, never its span in the reconstructed input. Its grammar is the main parse's. So one memo can serve the main parse and the check, and a query of each over one span shares an entry. The content is the original text over the source of the span's tokens (§1). It also holds, for each of the span's tokens, its tags, its text and its phonemes. Last, it holds where each token's source begins and ends, counted from the start of the source of the span's tokens.

Tags alone are not enough, since a condition can read `text()`, which includes what lies between the tokens. Also, the source of each token decides what `text()` of a part of the span is. A key of content must keep its fields apart, so that no two different contents give the same key, whatever characters the fields hold. A key of content lets equal spans at different positions share an answer, and repeated words make this worth having. But such a key costs time in proportion to the span, and the span of `from` or `after` runs to the end of the input. So a key of content suits short spans, and a key of position suits long ones. Both keys hold for the queries of §7, since those read the stage's own input. A position is a position of that input, never of the reconstructed input. The recognition of §7 is not a query and has no entry.

`matches` and `tags` of one span and rule can share an entry, since one recognition answers both. `begins` needs its own entry, since `begins` of a span can hold where `matches` of it does not. A memo that outlives the parse of one stage must also be keyed by what differs between the parses that it serves. These are the tokens, the original text, the lowered grammar and the features.

A nested parse sets the start and the end of the input that `initial`, `from` and `after` see to those of its span. It restores both when it ends, also when it fails with an error of the grammar.

A nested parse's own conditions and tag terms can start further queries, so queries nest. They nest to any depth, and no bound applies to it. The depth follows the input, as in a chain of `begins(after($), x)` across a long text. So an implementation keeps the active queries on a stack of its own, not on the call stack of its language.

A query is active from the start of its nested parse to its end. Take a query about a span as a rule. It is an error of the grammar where an active query is about the same span and rule. `matches`, `begins` and `tags` are one kind here, so the functions of the two queries do not matter. Whether a query is negated does not matter either. The error names the rule, and the whole parse fails with it. Such a query makes the grammar define the rule in terms of itself over the same text.

Only queries are active. The main parse of a stage is not a query, and neither is the recognition of the check of §7. In the main parse this changes no result. A query there about the whole input as `text` runs a nested parse of the same tokens with the same grammar. That nested parse reaches the same condition again, and then it is the active query. The check of §7 reads other tokens, so there the difference shows (§7.6).

A query names its span in positions of the stage's input. A query that the check of §7 starts names its projected span (§7.3). So two queries are about the same span exactly where they read the same tokens of the stage's input.

Derivations are finite trees. A derivation in which a constituent has, anywhere below it, a constituent of the same rule over the same span is cyclic. The engine does not count a cyclic derivation, since such a derivation can repeat without end. For example, with `a → b` and `b → a | A`, `A` has one derivation as `a`, not infinitely many. So does the empty text as `t`, with `t → u | ε` and `u → t`.

Derivations are made only of advances that the tests allowed. An implementation can build derivations again from completed spans, without the advances. Such an implementation applies the tests again, each to the candidate constituent itself, with its own span and its own tags. For example, take `text → [X] body="y"`, `body → X Y | Y` and the input `X Y`, where `X` sounds `x` and `Y` sounds `y`. Only the `body` over `Y` matches, so `[X]` reads `X`. No derivation reads `[X]` as empty.

A tag test works in the same way. Take `text → [X] body⊇~b` and `body → X Y | Y`, where the second production of `body` has the tag term `~b`. Only the `body` over `Y` carries `b`, so again `[X]` reads `X`.

In a derivation, the helper of an elidable optional (§3.8) that derives `ε` is an elided terminator, at the position where it is empty. Its constituent is the node of the symbol just before the helper in the production that has the helper among its symbols. In `LE sumti-tail [+KU #]`, it is the node of `sumti-tail`. In `[terms] [+VAU #]`, it is the node of the helper of `[terms]`, whether that optional is empty or not. In `(number | lerfu-string) [+BOI #]`, it is the node of `number` or `lerfu-string`, as the production has one or the other.

A plain optional that holds a capture has no helper (§3.2). So in `[$t(terms)] [+VAU #]`, the constituent is the node of `terms` in the production that reads `terms`.

In the production that does not, the elided terminator is the first symbol, and has no constituent (below).

An elided terminator has no constituent in three cases:

- It is the first symbol of its production.
- It follows a terminal.
- It is the second symbol of a production whose first symbol is that production's own left side. Such a production is a recursive production of flat braces or of a left chain (§3.2, §3.3), or a left-recursive production that the author wrote. In a recursive production of braces, the first symbol stands for what the braces read so far.

Braces add no case of their own. The rule for the constituent and these three cases apply to the productions of §3 as lowering makes them, whatever the source wrote. So a terminator elided at the start of the first item of braces has no constituent, as the first symbol of its production.

One elided at the start of each later item of `{x}` has none either, as the second symbol after the initial self-reference. The same holds at the start of each separator of `{x \ s}` or of a left chain. Take a right chain, `r → x s r`. A terminator elided at the start of `s` follows the last symbol of the expansion of `x`. That symbol's node is its constituent, unless the symbol is a terminal. It has none either where `x` is the one symbol `r`, since the production then starts with its own left side.

A PEG (parsing expression grammar) repetition such as `{[+T] A}` reads its next item after what it read. It does not make what it read longer first.

A maximal terminator is the terminator of an optional written `[++T …]` (§3.8). An optional of the same terminal written `[+T …]` is not maximal. The engine excludes a derivation when a maximal terminator is elided after a constituent that can be longer.

The constituent is a symbol `Y` over `[s, p)`. A longer candidate is a completed item of `Y`, with origin `s`, in a set after `p`. When `Y` is tested, that test must hold of the candidate's own span and tags. The longer constituent need not fit into a derivation of `text`. It can contain the shorter constituent, as left recursion builds a longer node on a shorter one.

Only the constituent matters, not what follows the terminator in its production. The restriction depends on the symbol, its test, its origin, and its end. The three cases with no constituent above permit the omission. Written-terminator priority still applies in a query.

Maximal terminators apply in the main parse and nested queries. The ranking (§6) sees only the remaining derivations. `elision-only` restores a maximal terminator as any other (§7). A restoration reads a token, so its derivation contains no elided terminator for maximality to forbid.

Lowering records which helpers belong to maximal terminators (§3.8). The lowered grammar and its cache identity include this information. For each parse that needs them, the engine records the furthest completion of each symbol from each origin. A tested symbol needs its completed items because the furthest completion need not pass its test. A nested parse builds this table from its own chart, once per query. The query's memo keys identify that chart.

A stage accepts when an item of the start rule `text` spans the whole input and has at least one derivation that is counted. It rejects an input whose every such derivation is cyclic, as it rejects one with no such item. A stage that accepts its input can still end with a tie, which is an error (§6). A rejected input reports the furthest position that any item reached. It also reports the terminals that the items there can read next, together with the rules that those items belong to (§11). The stage writes a tested terminal with its test, such as `LE="la"` (`docs/output.md`).

An input rejected only because maximality forbids an elided terminator in every derivation that is not cyclic reports that terminator instead. The terminator comes from the first reading, `m`, of the ranking that the stage makes with maximal terminators unrestricted (§6). It is the first elided terminator of that derivation, in the order of the tree's leaves, that maximality forbids. Its position is the position reported, and its terminal, with the rule in whose alternative its optional is written, is the one terminal expected there. If that terminator is tested, the stage writes it with its test there too.

That ranking reads the same chart of the main parse. It does not run recognition again, and the answers of nested queries in it are those of the parse.

This report covers only main derivations that maximality removes. If a nested query's answer makes a condition false, the recognizer does not make that advanced item. If no counted main derivation remains, the ordinary rejection rules apply. An ordinary rejection reports the furthest position and the terminals expected there, and those terminals can include a terminator.

For example, take `text → A B` with the condition `begins(from($), r)`. Also take `r → y [++T] B` and `y → A | A B`. On `A B`, the query fails, because `y → A B` is longer. No main root remains, so the rejection is an ordinary one, at the furthest position.

The reported terminator comes from `m` whatever the verdict of that ranking. So *T* (§6) selects the forbidden terminator that such a rejection reports. The canonical tie-break keys never turn a tie into an accepted reading.

## 5. Phonemes, labels and text

A token's `phonemes` say what it sounds like, and its `label` is what it shows to people. The stage fixes both when it emits the token. It takes the first of these cases that applies:

- The token's tag set holds a phoneme tag `/p/` (§1). Then its phonemes are `p`, and its label is `p`. The pause, `/./`, is the one exception: its phonemes are `.`, and its label is a space.
- Any other token that the stage emits joins the phonemes and the labels of its parts (§11). A read input token gives its own phonemes and its own label. An opaque part gives the phonemes `?`, and its text as its label. So a token whose constituent is an opaque part sounds `?`.
- A character token has no phonemes, and its label is its text. A token that a caller supplies in place of the characters has its text as its label (`docs/api.md`). It has no attachments.

The phonemes join the phonemes of the parts in order, and the label joins their labels in the same way. Each join leaves out a part whose own string is empty: its phonemes for the phonemes, and its label for the label. A pause part is a part whose phonemes are exactly the pause, `.`. Of each run of adjacent pause parts that remain, the join keeps only the first. It also leaves out a pause part at either end. A part with no phonemes, such as a character token, counts as one with empty phonemes.

The join counts pauses by part, not by character. So it keeps a period or a space inside the string of a part. For example, an opaque part with the text `a... b` keeps that label whole.

The two joins are independent. Each leaves out the parts whose own string is empty, and both find a pause part by its phonemes. So they can keep different parts. An empty opaque part between two pauses gives `?` to the phonemes, so the phonemes keep both pauses. It gives nothing to the label, so there the two pauses are adjacent, and the label keeps only the first.

An inserted token has no parts. If it has a phoneme tag, it sounds like that phoneme and has it as its label, or a space for the pause. Otherwise its phonemes and its label are empty. So the inserted apostrophe `/'/` of a script is part of the label of the word around it.

An emitted token always has phonemes, possibly the empty string. Only the character tokens of the first stage have none. Two phoneme tags on one emitted token are an error of the grammar that emitted it, whether or not its constituent is an opaque part. The tag set here is the token's tags after the stage's implications (§11).

`phonemes(span)` in a condition is the canonical sound of the span. It joins the phonemes of the span's tokens in order, with no separator. Then it replaces each code point with its simple lowercase mapping, the `lower` entries of `grammars/unicode.txt`. It also removes every comma, `,`, the syllable break of *The Complete Lojban Language* (CLL), section 3.3.

The canonical sound keeps every pause. It does not merge two pauses, and it does not remove a pause at either end. So a stressed `lA` sounds `la`, and `kore,a` sounds `korea`. A token's own `phonemes`, above and in the output, stay as the token has them.

The canonical sound and every comparison treat `?` as an ordinary character. In the word stage, `zoi gy. abc .gy. bu` is one letter word. It sounds `zoi.gy.?.gy.bu`, and its label is `zoi gy abc gy bu`.

`text(span)` is the original text over the source of the span's tokens (§1), and the empty string for an empty span.

In the check of §7, `phonemes(span)` and `text(span)` read the projected span, which holds only tokens of the stage's input (§7.3, §7.5). A synthetic token adds no sound and no text.

## 6. Choosing a parse

A stage ranks the counted derivations of its input (§4). A rule profile counts flagged constituents over nonempty spans. Rule flags compare rule profiles first. Of two derivations with different rule profiles, the one with the greater rule profile beats the other. Of two with equal rule profiles, the one that the directive prefers beats the other. A derivation is best if no other derivation beats it.

The directive (§2) is `greedy`, `lazy` or `late-elision`. The verdict is one of these:

- `unique` if the input has one derivation
- `resolved` if it has several, and exactly one of them is best
- `tie` if two or more derivations are best

Under `unique` and `resolved`, the chosen derivation is the one best derivation. Under `resolved`, it beats every other derivation (below). A tie is an error, and the stage then has no chosen derivation. The production numbers of §3 never decide which derivation a stage chooses.

For N input tokens, the boundaries are `0 ≤ p < q ≤ N`. `G_D(p,q)` counts D's constituents of flagged rules over `[p,q)`. Every occurrence of a flagged rule contributes once, however many symbols its production has. Empty occurrences contribute nothing, and helpers carry no flags. All flagged rules contribute together, without priority by name, production number, tags or source.

Compare components by increasing p and, within one p, decreasing q. At the first differing count, the greater count wins. Equal vectors give equal rule profiles. Every two rule profiles are equal or one of them wins. Distinct derivations can share one rule profile.

An occurrence beats absence, and equal spans count separately. With no flagged rule, every rule profile is zero, so the directive alone ranks.

The stage retains every derivation with the greatest rule profile before applying its directive. The total before filtering still determines `unique`. The remaining comparison of actions and elisions applies within that retained forest.

A derivation is read as its sequence of actions in bottom-up order. An action is a read of a token as a terminal, or a close of a production over a span. Closes of helper productions and of productions with exactly one symbol are transparent. They are part of the sequence, but two sequences never differ at one. The other actions are visible.

So the closes of flat braces are transparent. The close of a chain's level is visible where its production has more than one symbol (§3.3).

Two reads are the same action when they read the same token as the same terminal. Two closes are the same when they close the same production over the same span.

Transparency removes a close from the comparison, but it does not merge derivations. Two derivations that differ only at transparent closes are still two derivations. With equal rule profiles, `greedy` and `lazy` tie them. Under `late-elision`, their counts of elided terminators still decide (below).

For example, `text → [[X]]` derives the empty input in two ways. The outer helper derives ε itself, or through the inner helper. `text → [A] & [B]` derives it in three ways, through the expansions of its `&` (§3.2). These use `[A]` alone, `[B]` alone, or both. All have the same empty tree, and all three ranking rules report a tie. The error of such a tie can carry two equal trees, while its witness names two different productions.

`text → [[+KU]]` also derives the empty input in two ways. The outer helper is empty, which elides nothing, or the inner one is, which elides `KU`. Their vectors are (0) and (1). So the input ties under `greedy` and `lazy`, and it is `resolved` under `late-elision`.

The engine does not merge derivations whose trees are equal either. Such derivations can still differ in what the stage does with them. Two definitions of `text → A` give equal trees, but their emission clauses can emit different tokens. Their alternatives can also differ in their warning guards, or in `%opaque`.

Under `greedy` and `lazy`, the stage compares two derivations of the same input at their first differing visible action:

1. If both read the same token as different terminals, they are tied.
2. If one reads and the other closes, `greedy` prefers the read, and `lazy` the close.
3. If both close, with different productions or different spans, they are tied.

If the visible sequences are equal, or one is a proper prefix of the other, the two are tied. For the witness below, their first difference is the first pair of differing actions of the whole sequences, transparent ones included. A derivation whose visible sequence is a proper prefix of the other's differs from it where the shorter ends.

Among equal rule profiles, a ranking with no lean compares two derivations in the same way, but rule 2 ties them too. Any two remaining derivations that differ are tied. The check of §7 uses no lean after rule profiles. So do the readings of a tie under `late-elision` (below). A directive cannot name it. In the check, a restoration is a read of its synthetic token and then the close of its empty production (§7.4, §7.7).

Among equal rule profiles, `late-elision` compares only the elided terminators (§4). Let the input have N tokens. A boundary is a position from 0 to N. The elision vector of a derivation has one component for each boundary. The component at boundary `p` is the number of the derivation's elided terminators at position `p`.

The vector counts each elided terminator once, whatever its terminal, its constituent or its depth. So two terminators elided at one position count two, also when they are of different terminals. An ordinary empty optional, such as an empty `[{x}]`, and a close of any other production count nothing.

The markers of §3.8 alone decide what counts. They also decide which empty optionals become `elided` nodes (§12), what maximality forbids (§4) and what §7 restores. An optional that is not elidable (§3.8), such as an optional separator, can still be empty. Its absence counts nothing and leaves no node. The ranking knows no particular terminal, so a grammar that wants a separator not to count writes it as a plain optional, `[CU #]`.

Among equal rule profiles, `late-elision` prefers a derivation whose elision vector is less. The stage compares two vectors from boundary 0 to boundary N. At the first boundary where they differ, the vector with the smaller count is less. Derivations with equal rule profiles and equal elision vectors tie, even where their trees differ. Without flagged rules, several derivations that elide nothing always tie.

The same comparison can be read as actions. Project a derivation's sequence of actions in this way:

- A close of the helper of an elidable optional that derives ε becomes `elide(p)`, where `p` is its position.
- A read of token `p` becomes `read(p)`, whatever the terminal that reads it.
- The projection drops every other close, and it ends with `end(N)`.

At the first differing pair of projected actions, `read(p)` and `end(N)` beat `elide(p)`. Two `elide(p)` actions at one boundary are equal, as are two reads of one token. Each elided terminator adds its own `elide(p)`, and the projection never merges equal actions. So two elisions at `p` lose to one, because the second `elide(p)` meets `read(p)` or `end(N)`. In plain words, at the first place where two readings differ in leaving out a terminator, `late-elision` prefers the reading that reads on.

So under `late-elision`, a token read as two terminals does not stop the comparison, as rule 1 does. Two different closes do not stop it either, as rule 3 does. The preference does not depend on the age, the nesting or the name of a terminator.

The stage puts the derivations in a canonical order, *T*. *T* orders the ambiguity diagnostics and selects the forbidden terminator that a maximality rejection reports (§4). The canonical tie-break keys never turn a tie into an accepted reading. First, *T* puts greater rule profiles before lesser ones. Within an equal rule profile, `greedy`, `lazy` and no lean compare visible sequences:

- *T* compares them at their first differing visible pair, by rules 1 to 3 where those decide, and otherwise by the canonical keys. The canonical keys put a read before a close. They order two reads by terminal, in code point order. They order two closes by production number, then span start, then span end.
- If one visible sequence is a proper prefix of the other, the shorter comes first.
- If the visible sequences are equal, *T* compares them at the first differing pair of the whole sequences, by the canonical keys. If one whole sequence is a prefix of the other, the shorter comes first.

Within an equal rule profile, `late-elision` compares elision vectors in *T*, the lesser first. It orders two derivations with equal vectors as it does under no lean.

*T* compares rule profiles, then elision vectors under `late-elision`, then visible sequences and whole sequences. So it is a total order. The first reading, `m`, is its least element, whatever the verdict.

Every derivation that beats another precedes it in *T*. This holds for a greater rule profile and for the directive's preference within equal rule profiles. Nothing precedes `m`, so nothing beats it. So `m` is best.

A distinct derivation `d` is tied with `m` when `m` does not beat `d`. So `m` is never tied with itself. Under `greedy` and `lazy`, a best derivation other than `m` is tied with `m`, since its first difference with `m` is a tie. The converse does not hold. Under `late-elision`, the derivations tied with `m` are exactly the other best derivations.

For example, take `text → A C D | p D | B q`, `p → B C` and `q → C D`, over the tokens `A B`, `C` and `D`. Under `greedy`, `m` reads the first token as `A`. The derivation through `p` is tied with it, but loses to the one through `q`, which reads `D` where it closes `p`.

Of the distinct derivations tied with `m`, the second reading is the one that diverges from `m` earliest. It has the fewest visible actions before its first visible difference with `m`. A derivation whose visible sequence is a proper prefix or an extension of `m`'s diverges where the shorter ends. One whose visible sequence equals `m`'s diverges last. Several that diverge at the same point are ordered by *T*. That derivation, `t`, is best.

Since `m` does not beat `t`, both have the same rule profile. A derivation with a greater rule profile than `t` also precedes `m` in *T*. Nothing precedes `m`, so no such derivation exists.

Under `late-elision`, `t` is best because its rule profile and elision vector equal those of `m`. Under `greedy` and `lazy`, the proof is as follows. Suppose that another derivation beats `t`. It is not `m`, since `m` does not beat `t`.

If it beats `t` before `t` diverges from `m`, it beats `m`, which nothing does. If it beats `t` later, it shares `t`'s divergence from `m`. If it beats `t` just where `t` diverges, it beats `m` there too, or it is tied with `m` there. This is because an action that beats one tied with `m`'s cannot lose to `m`'s. Either way, it is a distinct derivation tied with `m`, diverges no later than `t`, and precedes `t` in *T*.

So the verdict is `tie` exactly when some distinct derivation is tied with `m`, and then `m` and `t` are two best derivations. Otherwise `m` beats every other derivation, and it is the chosen derivation. In the example, `t` is the derivation through `q`, and the verdict is `tie`. It shows the first point at which the text can be read another way. The witness is the pair of actions at the first difference between `m` and `t`, visible if there is one. It compares the actions themselves, under every rule, and not their projections.

Neither action of a witness is ever missing. Two distinct derivations of one span both end with the close of their root. So neither sequence of actions is a proper prefix of the other, unless a derivation is cyclic, and a cyclic derivation does not count. A library that finds a missing action has a defect, and it fails rather than report one.

A tie is not a success. The result is an error of kind `ambiguous`, with the reason `tie`, and `ok` is false. The error carries two readings, `m` and then `t`, each as a tree (§12). The result's `tree` is null. The stage keeps its verdict and its witness. It has no chosen tree, no output (§11) and no warnings (§12), and no later stage runs (§13).

A stage takes its steps in this order. It recognizes its input (§4), and it ranks the derivations. If the verdict is `unique` or `resolved`, it emits its tokens (§11), and then it runs the check of §7 if that applies. A tie ends the stage at the ranking, so neither emission nor that check runs. An error of the grammar found while emitting ends the stage before that check. The check can end the stage with an error of kind `ambiguous` (§7.10) or `grammar` (§7.7, §7.9).

Every ranking rule composes over the packed forest. The packed forest is the shared graph of all derivations of the input, and its nodes are the recognizer's items (§4). An implementation represents derivations through shared summaries and does not need to enumerate them.

An edge of an item is one step by which the recognizer makes it. A start edge predicts an item with its dot at the start, and it combines nothing. A read edge advances an item over a token that its next terminal reads. A completion edge advances an item over a completed item of its next symbol. A read or completion edge has two children: the item before the step, and the token or completed item that the step reads.

The context of a child is what its use in a derivation allows it. It has two parts, under every ranking rule:

- The eligibility of the child. Before an elided maximal terminator (§4), an edge combines only the prefixes whose last constituent permits the omission. Every other edge combines all derivations of its children.
- The cycle context of the child. A child cannot use a rule over the span of a constituent of that rule above it, or the derivation is cyclic (§4). The rules above a child over its own span are its cycle context.

  Only a rule that can complete again below the child over that span matters. Such a rule is reached from the child's rule through constituents over the same span, and it reaches that rule back in the same way. Such rules form the cyclic group of the child's rule. An implementation can leave every other rule out of the context. Two contexts that differ only in rules that it leaves out give the same summary.

A summary describes the derivations of one item in one context. So an implementation keeps one summary for each combination of item, eligibility and cycle context that some edge needs. The cycle context is reduced as above. This reduction removes context differences caused by ancestors outside the child's cyclic group. Different ancestor sets within that group can still need different summaries. Two summaries of one item can differ, and a summary keyed by the item alone can lose a reading.

For example, take `text → b | a`, `a → b` and `b → a | A`, over the token `A`. The input has two derivations that are not cyclic, through `text → b` and through `text → a`. With equal rule profiles, they tie under every stage rule. Beneath `b` over the same span, `a` has no derivation that counts, since `a → b` repeats `b`. Directly under `text`, `a` has one, so a summary of `a` that ignores its context loses a reading of the root.

The derivations of the input are those of every completed item of `text` that spans it (§4). The implementation combines the summaries of all these items as the edges of one root.

Under every ranking rule, the verdict needs the total, the number of eligible derivations that are not cyclic, capped at two. Within one edge, the totals of the children multiply. Over the edges of one summary, the totals add, for every edge that the context allows, losing ones included. The root combines its items in the same way. A total of one is `unique`.

The implementation can keep the total in each summary, or compute it apart with the same rules. Either way, it computes the total before it drops any losing edge. A ranking of the best derivations alone cannot give the total.

A rule profile composes by addition. An edge adds its children's rule profiles and its own completed flagged occurrence, if any. Adding a common rule profile preserves comparison and equality. Each summary retains its greatest rule profile and every edge that attains it, with the same eligibility and cycle contexts. Counts before filtering remain separate from counts of preferred derivations.

For `greedy` and `lazy`, the action summaries of this section run over the forest of greatest rule profiles. For `late-elision`, each summary compares one key, the pair of its rule profile and elision vector. Compare the pair by its rule profile first, with the greater rule profile preferred. Within an equal rule profile, prefer the lesser elision vector. The count of preferred derivations and the retained edges follow this pair. Diagnostic selection uses no lean over the retained forest.

Under `greedy`, `lazy` and no lean, both `m` and the earliest-diverging tied derivation compose over the retained forest. An implementation keeps, in each summary, its *T*-least derivation and the earliest-diverging derivations tied with it. It keeps several candidates side by side while their order is not yet settled, since what follows decides. Their order is not settled while one's visible sequence is a prefix of another's. It is also not settled while their visible sequences are equal and one whole sequence is a prefix of the other.

One candidate can beat another under `greedy` or `lazy`. Then the loser's tied derivation stays tied with the winner exactly when it diverged from the loser before the point where the winner beat it. One that diverged there is beaten there too. So the number of derivations, which can be exponential, never matters.

Under `late-elision`, elision vectors compose by addition. The vector of a derivation through an edge is the sum, component by component, of the vectors of the derivations of its children. A completed helper of an elidable optional that derives ε at `p` has the vector that is one at `p` and zero elsewhere. Adding one vector to two others keeps their order. Adding a common rule profile also keeps rule profile order. So in a best derivation, each child has the best rule profile and elision pair that its context allows.

The best count counts derivations attaining this pair. The count stops at two. A `late-elision` summary holds its best rule profile and elision pair and its best count. Within one edge, the children's rule profiles and elision vectors add, and their best counts multiply. The edge adds its own completed occurrence and elision, if any. Over one summary's edges, keep the preferred pair or add best counts where the pairs are equal.

The root compares its items by the same rule profile and elision pair. A total of two with a best count of one is `resolved`. A best count of two is a tie. This holds also when two items of `text` each have one derivation with the same best pair.

The best derivations form a smaller forest. For each summary, the implementation keeps the edges that attain its best rule profile and elision pair. Each kept edge leads to the summaries of its children, in their own contexts. The stage finds `m` and `t` by a ranking with no lean over that forest. That ranking keeps the same contexts, so it reaches a child only through the summary that its context allows.

For example, take `text → [A] y [++T] B` and `y → A A | A A B | A [+U]`. On `A A B`, the least prefix before `[++T]` over all edges uses `y → A A` and elides nothing. The maximal terminator forbids `T` after it, because `y → A A B` ends later. The only eligible prefix reads the first `A` alone and uses `y → A [+U]`. A forest of the least edges over all derivations loses the only derivation that counts.

A vector has N + 1 components. So a sparse vector, or a shared sequence of elisions, keeps the cost of each addition and comparison small.

## 7. Elision-only

### 7.1 When the check runs

The check runs where the stage's verdict is `resolved` and the check is on. It is on where the stage's directive has `elision-only` or the caller asks for it. It runs after the stage emits its tokens (§6, §11).

A tie never reaches it, because a tie ends the stage first. It does not run for `unique`. An error of the grammar found while emitting ends the stage before it. A caller can switch the check off for a stage that declares it.

The check asks whether D's restored witness is the sole reading of R with an equal or better rule profile. It chooses no replacement derivation and checks no other restoration.

The check uses the main parse's lowered grammar, features, classifiers, constants and Unicode table. It does not lower the grammar again, and it does not run earlier stages again.

### 7.2 The two inputs

Let O be the stage's input, N tokens long. Here the input is what this stage reads: the output of the stage before it, or, for the first stage, the character tokens. Let G be the grammar lowered for the main parse, and D the chosen derivation.

Take the elided terminators of D (§4, §12) in the order of the tree's leaves, left to right, also where several stand at one position. Each one gives a restoration record. The record holds the terminal, its position `p` in O and the empty source of its elided node (§12). For a terminator with an `=` test, it also holds that test's string, its saved sound.

The reconstructed input R is O with one synthetic token for each record. The synthetic token stands before the input token at `p`, or at the end for `p` = N. Records at one position keep their order. Every token of O stands in R once, in its order, with all its fields unchanged.

A synthetic token has two values that the recognizer reads. Its recognition tags are its terminal alone. Its recognition sound is its saved sound. The saved sound is already canonical, as §9 requires. Without a saved sound, it is the empty string.

A synthetic token has no attachments. It is not emitted, so no implication applies to it (§11). An original token's recognition tags and sound are its own tags and the canonical sound of its phonemes (§5).

Each token of R has a provenance, which the engine keeps to itself. It is an original token, with its index in O, or a synthetic token, with the index of its record. Nothing else tells them apart. An earlier stage can emit a token with an empty span, an empty source, empty text or `insertedBy` (§11). Such a token of O is still an original token.

### 7.3 Projection

For a position `k` of R, from 0 to the length of R, π(k) is the number of original tokens before `k`. So π(0) is 0 and π of the length of R is N. π stays the same across a synthetic token and goes up by one across an original one. A span [a, b) of R projects to the span [π(a), π(b)) of O.

The recognizer reads R, and its items, spans and cycles are in positions of R. Every observation (§7.5) reads the projected span, in positions of O. A span of R that holds only synthetic tokens projects to an empty span at its position.

A projected span is a span of O like any other. Its text and sound come from its own tokens, as §5 says.

### 7.4 The reconstruction mode

The check recognizes R with G in the reconstruction mode. The mode adds no productions and removes none. Every production keeps its number, its rule and its clauses. Only these steps differ from §4.

An elidable optional (§3.8) has a helper `h`. Its productions are the empty production `h → ε` and the productions of its content, each of which begins with the optional's terminal `T`. In the reconstruction mode, the helper reads in one of three ways, its routes:

1. The restoration. The empty production reads exactly one synthetic token, the one at its position. The token must be compatible with the optional. Its recognition tags hold `T`. Where `T` has a test, the test holds of the token's recognition sound. The restoration is a read of that token as `T` followed by a close of the empty production over its one-token span. It has the tags of the empty production, which are none (§3.7). It evaluates nothing of the optional's content. The empty production never derives the empty sequence in this mode.
2. The written route from an original token. A production of the content reads its `T` from an original token, and then the rest of the production as §4 says. The rest can be empty.
3. The written route from a synthetic token. A production of the content reads its `T` from a synthetic token, which must pass `T`'s test as in the restoration. Then the rest of the production must read at least one token of R, original or synthetic. The item after `T` is strict (below). This holds whatever the strictness of the item that read `T`, and also where an ordinary prediction shares the item that read `T`.

Every production of the helper belongs to that elidable helper for the purpose of the routes, its content productions as well as its empty one. So a synthetic token followed by nothing else of the optional is always the restoration, and never a second derivation of the same omission. A synthetic token followed by more of the optional is the written route, which can read original tokens, later synthetic tokens, or both. An optional that is not elidable keeps its empty production as in §4. §3.8 alone decides which optionals are elidable, and this section does not change that.

A strict item never completes. A step whose new item is strict and stands at the end of its production drops that item (§4). So route 3 never applies where the rest is empty. The recognizer decides once per grammar which productions and which symbols can read, with the routes of this mode:

- A terminal can read.
- A production can read where it holds a symbol that can read.
- The empty production of an elidable helper can read too, because in this mode it is the restoration, which reads a synthetic token.
- A rule or helper can read where one of its productions can read.

The sets of productions and symbols that can read are the least sets that these rules give. An implementation starts with nothing that can read and adds until nothing changes. So a rule that can read only through itself, such as `z → z`, cannot read. This ignores tests, conditions and the input. Every rule below that asks whether something can read uses this one definition.

A production's last reading symbol is the last of its symbols that can read, where it has one. "A later symbol can read" means that the production's last reading symbol stands after the item's next symbol. It is enough that some symbol after the next one can read. It need not be the one right after it. A strict item follows these rules:

- The new item is not strict where it reads a token other than the `T` of route 3. It is not strict either where it advances over a completed item whose span is not empty.
- It can advance over a completed item with an empty span only where a later symbol can read. The new item is strict.
- Where a later symbol can read, the strict item predicts its next symbol in the ordinary way. Otherwise it predicts that symbol strictly. A strict prediction predicts only the productions that can read, restorations included. Its predicted items are strict, other than restorations, which are complete.

So a strict item never reaches the end of its production.

Strictness is not part of an item's identity. An item is strict where every step that makes it is strict. An item that an ordinary step reaches is ordinary from then on. The recognizer then applies to it every step that its strictness held back: the ordinary prediction of its next symbol, and its advances over empty constituents. This holds also where the recognizer processed the item as strict before. So the order of the steps does not change the items.

The recognizer's items in this mode are the least set closed under these rules and those of §4. So a strict prediction and an ordinary prediction of one symbol at one position share their items. The derivations through a shared item count once each, however many predictions reach it.

A strict prediction never predicts a production that can read nothing. A strict item never advances over an empty constituent unless a later symbol can read. So a strict item evaluates nothing past its production's last reading symbol. It evaluates no tag term of its own production, and no condition that becomes ready at its end.

An earlier advance over an empty constituent can still make a condition or a test ready. The engine evaluates it where a later symbol can read by the grammar, whether or not that symbol reads this input. So such a condition can end the check with an error of the grammar. This holds also where the rest of the optional reads nothing in this text. Its conditions, tests and tags are evaluated as in §4.

Any terminal other than the `T` that begins an elidable optional's content reads a synthetic token whose recognition tags hold it. It reads that token as it reads any token. This includes a bare terminal `T` outside an elidable optional, and a terminal in the rest of an optional. Its test reads the recognition tags and the recognition sound. This is how a competing alternative reads a written-back terminator.

In every derivation of the mode, each elidable optional is either restored or written. Leave the observations of §7.5 aside, and compare the mode with a reading of R in which every elidable optional is mandatory. They differ in two ways only:

- A restoration needs no rest of the optional. So the restoration exists also where the rest cannot be empty, by its symbols or by its conditions.
- A synthetic terminator with an empty rest is one derivation, the restoration. The number of empty derivations of the rest does not matter.

The mode removes no other derivation. Strict items remove only paths on which the rest reads no token. Every production that can read, a restoration included, stays open to a strict prediction.

### 7.5 Observations

Every condition, every tag term and every test of a reference reads the projected spans of its own derivation. So does every argument of a function in them. Bindings, conditions and tags belong to the candidate derivation. The engine never copies them from D.

During the check, the observers mean the following. Here `s` is a span of R, and `s′` its projection.

- `head(s)` is the first token of `s′`. `tail(s)` is all of `s′` but its first token. `last(s)` is the last token of `s′`. Each is empty where `s′` is.
- `from(s)` runs from the start of `s′` to the end of the input of the parse that evaluates it. `after(s)` runs from the end of `s′` to that end. That input is O for the reconstruction's own conditions, tag terms and tests of references. Inside a nested query, it is the query's span of O (§7.6).
- `initial(s)` holds where `s′` starts at the start of that input.
- `text(s)` is the original text over the source of the tokens of `s′`, as §5 says. `phonemes(s)` is the canonical sound of those tokens (§5).
- For a whole capture or `$`, `tags(s)` is the constituent's tags. For any other span, it is the union of the tags of the tokens of `s′`. `classes(s)` keeps the tags of `tags(s)` whose first character is `A` to `Z`.
- `matches`, `begins` and `tags(s, R)` run a nested query over `s′` (§7.6).

The projection comes first, then the function. So `head(s)` is the first original token of `s`, not the first token of `s` with a synthetic one removed. A function of a span never carries a capture's constituent tags: `tags(head($x))` reads tokens even where `head($x)` is all of `$x`.

A capture whose span holds only synthetic tokens is present, and `$x` holds as a condition. Its text and sound are empty, and the union of its tokens' tags is empty. It still has its constituent's own tags. So `tags($x)` can hold `~mark` while `tags(head($x))` is empty.

A constituent's tags are its production's tag terms, evaluated over its own captures (§4). A synthetic token gives a constituent no tag. A capture of a terminal that read a synthetic token has no tags. A production that inherits from one symbol (§3.7) inherits none from such a terminal. A restoration has none, as its empty production has none. A tag term can still give a constituent tags of its own, such as `<~ke-group>`, also where its span projects to empty.

A test of a reference reads the reference's projected span and its constituent's tags. `t="s"` compares `s` with the canonical sound of the projected span, and the four tag tests read the constituent's tags. A test of a terminal reads the token that the terminal reads, with its recognition values. This is the one observation that reads a synthetic token's values. Recognition reads them too, to match a terminal and to restore (§7.4). It lets `T="ta"` read a written-back `T="ta"`.

So a terminal and a rule with one symbol differ under a test in the check. `T="ta"` reads a synthetic `T` whose saved sound is ta. `t="ta"`, with `t → T`, does not read it, because the projected sound of `t` is empty. `T⊇T` and `t⊇T` differ in the same way.

The difference is deliberate. A test of a reference must read the original input. Otherwise the chosen derivation loses its witness where its span holds a written-back terminator (§7.8).

Presence tests `$x`, feature guards, closed terms and constants mean what they mean in the main parse. `classify`, `split` and `tag` take arguments computed as above, and fail as §10 says.

### 7.6 Nested queries

A nested query that the check starts reads the tokens of `s′`, the projected span, in O. It runs with G in its ordinary mode, as in the main parse. In that mode every elidable optional is an optional. The query reads no synthetic token, and its own nested queries do the same. It follows the query policy of §4.

Written-terminator priority applies to the tokens that it reads, and a maximal terminator (§4) is maximal in it. It does not rank its proof trees, and it emits nothing.

Inside the query, `initial`, `from` and `after` read the query's span of O. Its start and end are positions of O.

A query is about a rule and a span of O. For the recursive-query rule of §4, `matches`, `begins` and `tags(s, R)` of one rule and span are one query. The rule is unchanged. A query is an error of the grammar where a query about the same rule and span is active. Only queries are active.

The reconstruction's recognition of R is not a query. This holds also where the span of `$` projects to all of O and the query asks about `text`. So a condition of the reconstruction can ask whether the original input parses as `text`. That query runs with G over O, and it is active while it runs. It is an error only where a query inside it asks about `text` over all of O.

`tags(s, R)` is the union of the tags of the query's eligible readings (§4). `tags($x)`, with no rule, is the capture's own constituent tags. The two do not stand in for each other.

### 7.7 Recognition, cycles, maximality and ranking

The check recognizes all of R, from the start rule `text`, in the reconstruction mode, with the observations of §7.5. A derivation of R counts where it is finite and every test and condition in it holds.

Cycles are found over spans of R, as §4 says. Two constituents of one rule whose spans of R differ are no cycle, even where both project to one span of O.

Maximality does not apply to the derivations of R. A restoration reads a token, so the reconstruction has no elided terminator, and nothing for maximality to forbid. The queries of §7.6 keep their own policy.

The check ranks R's derivations by rule profiles over projected spans `[π(a),π(b))` in O. Empty projected occurrences contribute nothing. Distinct occurrences with equal projected spans count separately. The stage's directive supplies no preference. Within an equal rule profile, diagnostics use no lean (§6). Elision vectors are all zero.

A restoration's read of its synthetic token is a read action, and its close is the close of a helper, which is transparent. Section 7.10 selects the error's readings. The canonical keys never turn a tie into a pass. Derivations whose trees are equal over O are still distinct derivations.

An error of the grammar met while the check recognizes R is the result's error, as one met while emitting is (§11). This includes an error in a competing derivation that only the check reaches. The stage keeps its verdict and warnings, but it has no output.

W(D), the restored witness (§7.8), has rule profile G_D because each occurrence projects to its original span. The check follows the decision order of §7.10. A greatest rule profile below G_D proves its loss, but a greater rule profile does not excuse its loss. With no flagged rule, the check passes only when R has exactly one counted reading.

### 7.8 The witness

The witness of D is the derivation W(D) of R that has D's productions in D's order and in which:

- Each read of an original token reads the same token in R.
- Each elided terminator of D is the restoration of its helper over its own synthetic token.
- Each written elidable optional of D takes the written route from an original token.
- Each occurrence in the derivation tree spans the positions of R that hold its original tokens and the synthetic tokens of the elided terminators below it. This holds even where the representation shares one object between occurrences.

W(D) is a derivation of R that counts. In outline:

1. Every token read of W(D) is allowed. An original token reads as in D. A synthetic token is compatible with its own optional, because its tags and saved sound come from that optional's terminal and test.
2. Every route of W(D) exists. A restoration needs no rest of its optional, so it exists even where the rest of the optional cannot be empty. A written optional of D starts with an original token, so it takes route 2 and reads what D read.
3. Every node of W(D) projects to the span of its node in D, because the synthetic tokens below it project to nothing. So every capture has the projected span that it has in D.
4. Every constituent of W(D) has the tags of its node in D. This holds by induction from the leaves. An original token has its own tags. A restoration has the tags of the empty production, which D's elided helper had. A production's tag terms then read captures with the same projected spans and the same tags. A nested query in a tag term gives the answer it gave in D (§7.6). So the tag terms give the same tags.
5. Every condition and test holds as in D. Each reads the same projected spans and the same tags (3, 4). A nested query reads the same tokens of O with the same grammar and policy (§7.6), so it gives the same answer. A test of a terminal reads an original token as in D, or a compatible synthetic token. No query of W(D) is recursive. The reconstruction's recognition is not a query, and each query of W(D) is a query of D.
6. W(D) is not cyclic. Suppose that two nested nodes of one rule have one span of R. Both project to one span of O. Then D has two nested nodes of that rule over one span. That is a cycle, but D is not cyclic.
7. Maximality does not apply (§7.7), so nothing removes W(D).

So, unless an error of the grammar ends the check, R has at least one derivation, and the check never ends with no reading. The argument depends on no corpus, no terminal and no shape of the optional's content. It depends on every observer, every test and every tag rule following §7.5 and §7.6. The strict items of §7.4 do not touch W(D), whose written optionals all start with an original token.

The theorem does not excuse errors. A competing derivation can meet an error of the grammar, such as a `split` with an empty delimiter, that D never met. That error is the result's (§7.7).

### 7.9 A lost witness

Suppose that the check ends without an error of the grammar. If W(D) is not among the counted derivations of R, the check loses the witness of §7.8. A chart with no counted derivation of R is one such case. The check can omit the membership test without flags (§7.10). A lost witness is a defect of the library, not a property of the text. The result is an error of kind `grammar` with the code `elision-witness-lost`:

```json
{"kind":"grammar","stage":"syntax","code":"elision-witness-lost",
 "message":"the syntax stage could not reconstruct its chosen derivation for elision-only",
 "chosen":NODE,"completion":[{"terminal":"KU","at":3,"source":[9,9]},{"terminal":"VAU","at":5,"source":[16,16],"sound":"vau"}]}
```

The stage's name stands for `syntax` in `stage` and in `message`. `chosen` is D's tree (§12), over O. `completion` lists the restoration records in the order of the tree's leaves (§7.2). Each record has these members, in this order:

- `terminal`, the terminal.
- `at`, its position in O.
- `source`, the empty source of its elided node.
- `sound`, the saved sound, only where the terminator has an `=` test.

The error has no `token`, `source`, `line`, `column`, `expected`, `reason` or `readings`.

`ok` is false and `tree` is null. The stage keeps its verdict, `resolved`, and its warnings, but it has no output, and no later stage runs. Both a chart with no completed item of `text` over R and one whose items of `text` have no derivation that counts give this error. An error of the grammar met during the check is never this error.

The message is the same in every library. The engine never passes a check after it detects a lost witness. It never shows D's tree as a reading of R in its place.

### 7.10 Readings

The check makes these decisions in order. With no flagged rule, a library can omit the membership test in step 1 because §7.8 proves that W(D) counts. It still reports a forest with no counted derivation as `elision-witness-lost`.

1. If W(D) is not a counted derivation, report `elision-witness-lost` (§7.9). A greatest rule profile below G_D proves this loss. A greater rule profile does not replace W(D).
2. Otherwise, if the greatest rule profile exceeds G_D, report `ambiguous` with reason `elision-only` and `ok` false. The first reading is W(D). The second is the no-lean canonical first derivation with the greatest rule profile.
3. Otherwise, if several derivations attain G_D, report the same ambiguity error. The readings are the no-lean canonical pair from that retained forest (§6).
4. Otherwise, the check passes and preserves the main result.

A reading with a greater rule profile never replaces D. In either ambiguity outcome, each reading is a tree over O, and the error carries their action witness.

In either ambiguity outcome, the result's `tree` is null. The stage keeps its verdict, output and warnings, since it accepted its input and chose its derivation. The error has no `token` or `source`. Section 7.9 gives the result fields for witness loss.

In either ambiguity outcome, the two readings are two derivations of R, but they can be equal as trees over O. For example, one reading can restore an optional. The other reading can read the same synthetic token as a bare terminal, in a production with the same tree. So the error also has a witness, as a tie has (§6). It is the pair of actions at the first difference between the two derivations of R, visible if there is one, mapped to O:

- A read of an original token is a read of that token's index in O.
- A read of a synthetic token is an `elided` action of its record's terminal at the record's position in O.
- A close has the projection of its span.

Neither action is ever missing, as §6 says of a tie.

Mapped to O, the two actions can still be equal. Two reads at one index read the same token of R, and a synthetic token reads only as its terminal. So equal mapped actions are two closes of one production whose spans of R differ only in synthetic tokens.

The message of the error is free. Only the message of §7.9 is the same in every library.

A reading is the tree of its derivation (§12), mapped to O:

- A read of an original token is a token node with that token's index in O.
- A read of a synthetic token is an `elided` node of its record's terminal. It has an empty span at the record's position, and the record's source. This holds for a restoration, for the written route from a synthetic token and for a bare terminal.
- A restoration gives exactly that one `elided` node, and nothing of the optional's content.
- A rule node has the projection of its span. Its source is that of its original tokens, or, where its projected span is empty, the empty source of §12 at that position. It has the tags of its own derivation.

The check gives no warning (§12), emits nothing and attaches nothing (§11). Only D does these things, in the main parse. A token node of a reading still shows its original token's attachments (`docs/output.md`).

### 7.11 Switching the check off

A caller can switch the check off, or on, for every stage that runs (`docs/api.md`). That choice changes nothing in recognition, ranking or emission. It only decides whether §7.1 to §7.10 run.

## 8. Reading grammar documents

A grammar document is Markdown. Its grammar text is the content of every fenced code block whose info string is `jbogenbau`, in order. A fence is a line of three or more backticks or tildes, indented by up to three spaces, followed by the info string. A backtick fence whose info string holds a backtick is not a fence, as in CommonMark. The reader knows no other Markdown container. So a block can stand under a list item indented by two spaces, as a pipeline's `%include` blocks do, but not deeper.

The info string is `jbogenbau` when it is exactly that once leading and trailing whitespace is removed. A block ends at a line that holds only a fence of the same character, at least as long. The fence is indented by up to three spaces, and only whitespace follows it. A `jbogenbau` block that is never closed is an error of the document, and the reader reports it at its opening fence. Any other unclosed block runs to the end of the document, as in CommonMark. The reader joins the blocks with a newline between them, and every character of the grammar text keeps its line and column in the document.

The reader parses the grammar text with the notation dialect, `grammars/dialects/notation.md`, whose DOM ships as `grammars/notation/bootstrap.json`. The rules in §9 turn the tree that this parse produces into the document's DOM. An implementation reads the bootstrap DOM, not the notation documents, to parse any grammar, the notation documents included. Splicing the notation's pipeline (§13) with the bootstrap must reproduce the bootstrap exactly (the fixpoint). The bootstrap holds each stage as its name and its runs of items. A run is a path and a DOM that holds consecutive items of that one document.

A tie in either stage of the notation dialect, `lexical` or `syntax`, is an error of kind `grammar` of loading (§6). The error names the document. It has no line and no column, since an ambiguity has no single position. Its message names the notation stage and says that the grammar text is ambiguous. A library never puts such an error at the start of the document in place of a position.

Every bootstrap failure names `notation/bootstrap.json` in its structured document field and its message. Reading and schema errors have no stage, line, or column. Stitching and lowering errors name the stage that failed. If the failure has a definition location, its structured line and column retain that location. The message also names the embedded document at that location. A failure without a definition location has no structured line or column.

A bootstrap supplies already-spliced document runs, so its stages must have distinct valid names. Each stage requires at least one document run. Its runs cannot contain `stage`, `include`, or `features` directives because pipeline splicing consumes them.

The loader validates every bootstrap DOM before it stitches any stage. Each stage must contain at least one rule. The loader then stitches every stage in order with the normal stage validator.

Next, it validates feature roles across all stitched stages with the normal dialect validator. Finally, it lowers the stages in order. A later stitching error therefore precedes an earlier lowering error.

A feature-role conflict names the stage and definition that introduce the conflicting role.

These locations concern embedded definitions, not lines of the bootstrap JSON. The CLI reports the same bootstrap attribution.

Each stage of the notation runs as any stage does (§4 to §7, §11, §12). So each notation stage runs the check of §7 where its own directive declares `elision-only`. The bundled notation declares it in no stage, but a caller's own bootstrap can (`docs/api.md`). An ambiguity that the check finds is an error of the document in the same way as a tie. The error names the document and the notation stage, with no line or column. The caller's option for the check (`docs/api.md`) does not reach a notation stage, so it neither switches the check on there nor off.

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
| `rule` | a rule: `define`, `redefine` or `extend` from its `definer`, a token tagged `keyword-rule`, `keyword-redefine-rule` or `keyword-extend-rule`. Name from its `rule-name`, a name or `#`. Flags from its optional `rule-flags`, or `[]` without it. Alternatives from its `body`. Tags from its `tags-clause`. Conditions from its `conditions-clause`. Emission from its `emits-clause`. `opaque` true if it has an `opaque-clause` |
| `alternative` | guards from its `guard`s: a gate from `f?` or `¬f?`, a warning from `f!`. Expression from its `conjunction`, tags from `alternative-tags` |
| `choice` | `choice` of its `conjunction`s, or the one conjunction itself |
| `conjunction` | `and` of its `sequence`s, or the one sequence itself |
| `sequence` | `seq` of its `primary`s, or the one primary itself |
| `repetition` | `repeat`, its first `choice`. `separator`, its second `choice`, if it has one. `chain`, `left` if its marker stands before its first `choice`, or `right` if it stands after it: `{"repeat":{"ref":"x"},"separator":{"ref":"s"},"chain":"left"}`. A marker is a token `...` among its parts. The reader ignores a third and any later `choice`, as it ignores any part that it does not read |
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
| `optional` | `optional` of its `choice`. With a marker, also `elidable`, `true`, and for the marker `++` also `maximal`, `true`: `{"optional":{"seq":[{"ref":"KU"},{"ref":"#"}]},"elidable":true}` for `[+KU #]`. A marker is a token `+` or `++` among its parts |
| `empty` | `empty` |
| `tags-clause` | its `term` |
| `conditions-clause` | its `implication`s, each one condition of the list, in order |
| `emits-clause` | `items` of its `emit-item`s. Each item is a capture, `""` for `$`, with the term of its `emit-tags` if it has one. `before` holds the captures of its `emit-before`s, and `after` those of its `emit-after`s, each the name without `$`, in order. Each list is present only if it is not empty. Or the item is `insert`, the tag of its `~name`, bare name, character tag or phoneme tag. No items for `ε` |
| `implication` | its `any-of`s in order, then its `implication` if it has one. They group to the right: `if` of each around the rest, or the one alone |
| `any-of` | `any` of its `all-of`s, or the one `all-of` itself. An `all-of` that is itself an `any` gives its conditions in its place |
| `all-of` | `all` of its `condition`s, or the one condition itself. A `condition` that is itself an `all` gives its conditions in its place |
| `condition` | its comparison, call, negation or presence, or the `implication` between its parentheses, which makes no node of its own |
| `comparison` | the comparator and its two terms |
| `negation` | `not` of its condition |
| `presence` | `captured`, the name without `$`, `""` for `$` |
| `call` in a condition | `matches`, `begins` or `initial`, the only functions a condition calls directly |
| `term` | its `union` or its `guarded-term` |
| `guarded-term` | `if` of each of its `any-of`s, in order, around the rest, the last around its `union`, or its `term` if it has no `union` |
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

The reader knows 69 rules of the syntax grammar, grouped here by what they read.

For items, they are `directive`, `argument-word`, `argument-string`, `argument-tag`, `classifier`, `classifier-name`, `classifier-entry`, `classifier-key`, `classifier-operator`, `classifier-class`, `implication-declaration`, `constant-definition`, `constant-definer` and `constant-reference`. For definitions, they are `rule`, `definer`, `rule-flags`, `rule-flag`, `rule-name`, `body`, `alternative`, `guard` and `alternative-tags`. For expressions, they are `choice`, `conjunction`, `sequence`, `primary`, `repetition`, `reference`, `tag`, `character`, `phoneme`, `range`, `property`, `tested`, `test`, `test-operand`, `capture`, `group`, `optional` and `empty`. For clauses, they are `tags-clause`, `conditions-clause`, `emits-clause`, `opaque-clause`, `emit-item`, `emit-target`, `emit-tags`, `emit-before` and `emit-after`. For conditions, they are `implication`, `any-of`, `all-of`, `condition`, `comparison`, `comparator`, `negation`, `presence`, `call` and `argument`. For terms, they are `term`, `guarded-term`, `union`, `intersection`, `term-atom`, `string`, `name`, `empty-set` and `capture-reference`.

Any other rule is a wrapper. A node's parts are its children, with each wrapper replaced by its own parts, at any depth, in order. The reader reads only the parts of a node. So a bootstrap can wrap a known rule in rules of its own, and the reader reads the same DOM.

A node must have the parts that the reader reads from it. A node without one is an error of the document, reported at the node. A bootstrap of another notation can give such a tree (`docs/api.md`). The reader ignores any other part. These are the parts that each known rule must have. Where a list says "one or more", at least one is needed. Where it says two, the reader reads the first two.

| rule | parts |
| --- | --- |
| the root | no part. Each known part is an item: a `directive`, a `rule`, a `constant-definition`, a `classifier` or an `implication-declaration`. Any other known part is an error |
| `directive` | a token, its keyword. Its operands are its `argument-word`, `argument-string` and `argument-tag` parts |
| `argument-word`, `argument-string`, `classifier-name`, `classifier-key`, `classifier-operator`, `classifier-class`, `constant-definer`, `constant-reference`, `definer`, `rule-flag`, `rule-name`, `guard`, `reference`, `tag`, `character`, `phoneme`, `property`, `string`, `name`, `presence`, `capture-reference`, `comparator`, `call` | a token. For a `call`, it is the function's name, and the `argument` parts are its arguments |
| `argument-tag`, `emit-target` | a first part that is a token, a `range` or a `property` |
| `classifier` | a `classifier-name` |
| `classifier-entry` | one or more `classifier-key`, a `classifier-operator` and a `classifier-class` |
| `implication-declaration`, `comparison` | two `union`. A `comparison` also needs a `comparator` |
| `constant-definition` | a `constant-definer`, a `constant-reference` and a `term` |
| `rule` | a `definer`, an optional `rule-flags`, a `rule-name` and a `body` |
| `rule-flags` | one or more `rule-flag` |
| `body` | one or more `alternative` |
| `alternative` | a `conjunction` |
| `choice`, `conjunction`, `sequence` | one or more `conjunction`, `sequence` and `primary` in turn |
| `primary` | one known part: a `reference`, `tag`, `character`, `phoneme`, `range`, `property`, `tested`, `capture`, `group`, `optional`, `repetition`, `empty` or `constant-reference` |
| `repetition` | one or more `choice`. The reader reads the first two. A `...` token among its parts is a marker |
| `range` | two `character` |
| `tested` | a `primary` and a `test` |
| `test` | a `test-operand`. Its tokens make its comparator |
| `capture` | a token, its capture, and a `primary` |
| `group`, `optional` | a `choice`. An `optional` can also have a marker, a token `+` or `++` |
| `tags-clause`, `alternative-tags`, `emit-tags` | a `term` |
| `guarded-term` | one or more `any-of`, and a `union` or a `term` |
| `conditions-clause` | one or more `implication` |
| `emits-clause` | a token `ε`, or one or more `emit-item` |
| `emit-item` | an `emit-target` |
| `implication` | one or more `any-of` |
| `any-of` | one or more `all-of` |
| `all-of` | one or more `condition` |
| `condition` | one known part: a `comparison`, `call`, `negation`, `presence` or `implication` |
| `negation` | a `condition` |
| `argument` | a `union` |
| `term` | one known part: a `union` or a `guarded-term` |
| `union` | one or more `intersection` |
| `intersection` | one or more `term-atom` |
| `term-atom`, `test-operand` | one known part: a `string`, `tag`, `character`, `phoneme`, `range`, `property`, `name`, `empty-set`, `term`, `call`, `capture-reference` or `constant-reference` |

The other known rules need no part.

The lexical stage reads the longest symbol. So `...` is always one token, the chain marker, and never `..` followed by a period. So `'a'...'z'` is not a range. It is an error at `...`, which only braces can hold. A range is two character tags joined by `..`, with any layout between them.

In the same way, `++` is always one token, the marker of an elidable optional whose terminator is maximal. `+` alone is the marker of any other elidable optional. `+` has no other use. `{`, `}` and a backslash outside a string or a character tag are one-character symbols. Inside a string, a character tag or a property, they are part of that token, as in `'\\'` and `'\p{L}'`.

A document can hold several errors. The reader reports one, and every reader chooses the same one, in this order:

1. A syntax error comes first, wherever it stands, since the reader reads only a tree that the syntax grammar gave. The hand-written bootstrap reader first parses the whole document to the same tree. It reports a syntax error at the furthest character or token that the lexical or syntax stage reaches. The reader then reads its tree.
2. Within an alternative's expression, the reader checks each construct when it reaches it, in the order of the text. It checks a construct's own form before what it holds. So it reports the first error of the first construct in the text that has one, with these steps for each construct:
   - A tested primary: a test that does not follow a reference other than `#` or a terminal. It stands at the test, before anything that the primary holds. So `{$c(B)}="b"` and `[+KU $x(A)]="a"` are errors at the test.
   - A capture: first a capture inside braces, then one inside an elidable optional, then `$` that wraps something. Then come a name that is not all lower case and a capture that wraps anything but one symbol. Each stands at the capture, before what it wraps.
   - An optional: first two markers, at the second. Then an elidable optional that is not of the form below, at its `[`. Then a test other than `=` on its terminator, at the test. Last, what it holds. So `[+KU | $x(A)]` is an error at the `[`, and `[+KU≠"ku" $x(A)]` at the `≠`.
   - An `&`: more than 16 items, at the `&` construct, that is, at its first item. This comes before any of its items, since the bound is its own form. So an `&` of 17 items is an error at its first item, whatever error a later item holds.
   - Braces: first two markers, at the second, or a marker after the separator, at that marker. Then a chain that is not the whole expression of its alternative, at its `{`. Last, the item and the separator. So `A {$c(B) ... \ S}` is an error at the `{`, although its marker follows the capture.
3. The names that a production reads twice come after the whole expression of the alternative, by the rule below, and before the alternative's own tags.
4. A definition's header comes before its alternatives. The reader looks up its `definer`, then its `rule-name`, then its optional `rule-flags`, and checks the flags. Its alternatives follow, each with its guards, its expression and then its own tags. Then come its clauses, in their fixed order: `%tags`, `%conditions`, `%emits` and `%opaque`.

   Each clause has its own errors. Examples are tags made of the constituent's own tags, a comparison whose sides do not fit, and `$` beside another item of an emission. Such an error stands at the clause, or at the part of it that is wrong. These errors come in the order of the text. The checks of the whole definition below come last, and they stand at the definition.
5. The bound on nesting is 256 compound nodes. The loader checks it on the DOM of the whole document, after the reader reads every item without an error. So every other error of reading comes before it, in any item. That includes an error inside the deep part, and one in a later item. Among the items too deep, the first decides, as the paragraph of that error says.

   A reader has no other bound on nesting. Parentheses can nest without limit, since they make no node. A reader reads a document of any depth to this check.
6. The items of a document are checked in the order written, so the first item with an error decides, whatever kind of item it is.
7. A stage's documents are read in the order in which its pipeline includes them (§13), and the first document with an error of reading decides. Every document is read before the loader stitches the stage. So an error of reading in any document comes before an error of stitching (§2). Errors of stitching come before the errors of lowering, which a parse finds (§3).

These steps make every reader report the same token for every combination of errors.

A tree from a bootstrap of another notation can also lack a part that a construct requires (the table of parts above). The reader then reports the missing part at the construct, as soon as it looks the part up. So the order of the lookups decides between a missing part and another error of the same construct. Each construct looks up its parts, and makes its checks, in this order:

- A `rule`: its `definer` and token, then its `rule-name` and token, then its optional `rule-flags`. If flags exist, first reject them on an extension. Then require one or more `rule-flag` parts. Read each flag's token and reject an unknown value, then a repetition, in text order. Only then look up the `body` and its `alternative` parts and read them, followed by the clauses.
- A `tested`: its `test`, then its `primary` and the one known part of that primary. Then come the checks of the test's place, the symbol, and the test's `test-operand`. So a `tested` with no `test` is an error at the `tested`, whatever its primary holds.
- A `capture`: the checks of its place (inside braces, inside an elidable optional), then its token and its `primary`. Then come the checks of `$` and of the name. Last come the one known part of the primary, the check that it is one symbol, and that symbol.
- An `optional`: its `choice`, then its markers, then the form of an elidable optional and the test on its terminator, and then its content. So an `optional` with two markers and no `choice` is an error at the `optional`.
- A `repetition`: its `choice`s, then its markers, then the placement of a chain, and then the item and the separator. So a `repetition` with two markers and no `choice` is an error at the `repetition`.
- A `group`: its `choice`, and then its content.

The grammar does not state the restrictions below. Each of these is an error of the document. The reader reports it at the first token of the offending construct, unless the item names another place.

- A rule flag other than `greedy` is an error at the flag. A repeated flag is an error at the repeated flag. Parentheses on `%extend-rule` are an error at their opening parenthesis. These examples start at column 1. So `%rule(lazy)`, `%rule(greedy,greedy)` and `%extend-rule(greedy)` report columns 7, 14 and 13, respectively.

  Empty parentheses and arguments fail before the reader reads a tree. Empty parentheses report the closing `)`, column 7 in `%rule()` and column 16 in `%redefine-rule()`. `%rule(greedy(1))` fails the lexical stage at `1`, column 14. An argument made of valid tokens fails the syntax stage at its opening `(`. A supplied notation tree with no `rule-flag` reports its missing part at `rule-flags`, after the extension check.
- A capture that wraps anything but one symbol is an error, `$x((B))`, `$x((A | B))` and `$x([B])` included. A symbol is a reference, a tag literal, a character tag, a phoneme tag, a range, a property or a tested one of these.
- A capture whose name has a capital is an error. Capture names are all lower case.
- A constant in a body is an error, reported at the constant. A body names a class of tokens with a rule, such as `%rule digit '0'..'9'`, and never with a constant.
- A `$` that wraps anything is an error.
- A capture name that one production of an alternative holds twice is an error. It is reported at the second capture in the text that such a production reads. Several productions can read a name twice, at different second captures. The error then stands at the one of those captures that comes first in the text. So `($x(A) | $y(B)) ($y(C) | $x(D))` is an error at `$y(C)`, the second capture of the production `B C`. `A D` reads `$x` twice too, but its second capture, `$x(D)`, comes later.

  The productions are the expansions of §3.2, taken before any gate applies. So the error does not depend on the features: `f? [$x(A)] $x(B)` is an error with `f` off too. A name in two branches of a choice is no error, since no expansion reads both, as in `A ($x(B) | $x(C))`. A name in two items of `&`, or in an optional and beside it, is an error, since some expansion reads both.
- A test after anything but a reference other than `#` or a terminal is an error, reported at the test. So a test after a group, an optional, braces, a capture, `ε`, `#` or another test is an error. The syntax grammar permits a test after any primary.
- A `repetition` with two or more markers is an error, reported at the second marker. A marker after its second `choice` is an error, reported at that marker, since the separator has no marker. The bundled syntax grammar never gives such a node, but a bootstrap of another notation can (`docs/api.md`). So every reader decides these cases the same way, and never by which marker it meets first.
- A capture inside braces is an error, reported at the capture. A capture that wraps braces is an error by the first item of this list.
- A capture inside an elidable optional, an `optional` with a marker, is an error at any depth, reported at the capture.
- An `optional` with two or more markers is an error, reported at the second marker. The bundled syntax grammar never gives such a node, but a bootstrap of another notation can.
- An elidable optional that is not of the form of §3.8 is an error, reported at its `[`. The reader checks this on the notation tree, before groups are dropped. The hand-written bootstrap reader builds the same tree, so it makes the same check. The `optional`'s `choice` must be one `conjunction` of one `sequence`, with no leading `|` before the conjunction and no leading `&` before the sequence. This is the one place where a leading separator is not allowed: `[+| KU]`, `[+& KU]` and `[++| TOI]` are errors. A choice in parentheses later in the optional can still begin with `|`, as in `[+KU (| A | B)]`.

  The first `primary` of that sequence must be the terminal itself. That is a `reference` whose name begins with `A` to `Z`, or a `tag`. It can also be a `tested` whose primary is one of these and whose comparator is `=`. So a `group` there is an error, even of one terminal or around the whole content.

  `[+(KU) #]`, `[+((KU)) #]`, `[+(KU #)]` and `[+(KU #) A]` are errors, as are `[++(TOI) #]` and the other `++` forms. So are a choice, an `and`, a rule, `#`, a phoneme tag and a character tag in first place. The same holds for a range, a property, `ε`, braces and an optional.

  A DOM cannot show a group, so its own requirement is on the normalized form. The `expr` of an elidable `optional` must be its terminal, or a `seq` whose first expression is its terminal. The terminal is a `ref` whose name begins with `A` to `Z`, or a `terminal` whose tag is a name. It can also be a `test` with the comparator `=` of one of these.

  Every DOM that a reader makes meets this requirement. A supplied DOM `{"optional":{"seq":[{"ref":"KU"},{"ref":"#"}]},"elidable":true}` is well formed, whatever text it came from. `[+(KU #) A]`, whose first expression is a `seq`, has no well-formed DOM.
- A test other than `=` on the terminal of an elidable optional is an error, reported at the test. Such a test fits the form above in every other way.
- A chain, a `repetition` with a marker, that is not the whole expression of its alternative is an error, reported at its `{`. The whole expression is the alternative's `conjunction` when that is one `sequence` of one `primary`, the `repetition` itself. So a chain inside a group, an optional, other braces, a capture or a test is an error. So is a chain in a sequence, a choice or `&`, although a group makes no node of the DOM. The lowering of §3.3 makes sure that the chain's alternative is the only one of its rule.
- A range whose start is above its end is an error, reported at the range.
- A property whose text is not `'\p{Name}'` with a name of §1 is an error, reported at the property. So a long name, such as `Letter`, and a name in other case, such as `lu`, are errors.
- A property in a term or a condition is an error, reported at the property. A property is not a tag set.
- A string in an `=` or `≠` test that no canonical sound (§5) can be is an error, reported at the string. That is a string with a comma, or with a code point that the simple lowercase mapping changes. So `LE="La"` and `LE="l,a"` are errors. The loader makes sure that a string constant there is a canonical sound too (§2).
- A test's operand that is not a closed term (§10) is an error, reported at the first part that is not closed. So a capture, `$`, a guarded term and a call of `phonemes`, `text`, `tags`, `classes` or `classify` are errors there.
- A test's operand of the wrong type is an error, reported at the operand. The operand of `=` and `≠` is a string, and that of the other four tests is a tag set. So `LE⊇"la"` and `LE=~la` are errors.
- A function that does not exist is an error, and so is one called with the wrong arguments. `phonemes`, `text`, `classes`, `head`, `tail`, `last`, `from` and `after` take one span. `split` takes two strings, and `tag` takes one string. `tags` takes a span and optionally a rule name. `matches` and `begins` take a span and a rule name, and `initial` takes one span. `classify` takes a string and a classifier's name.

  In these signatures, a span is a capture or `head`, `tail`, `last`, `from` or `after` of one. A string is a term whose type is string (§10). The reader reports a call with the wrong arguments at the call. So a bare name in an argument that takes no name, as in `classify(lex, "mi")`, is reported at `classify`, not at the name.
- A `split` whose delimiter is the string literal `""` is an error, reported at the call.
- A `tag` whose argument is a string literal that is not a name is an error, reported at the call.
- A constant's value that is not a closed term (§10) is an error, reported at the first part that is not closed. So a capture, `$`, a guarded term and a call of `phonemes`, `text`, `tags`, `classes` or `classify` are errors there.
- A side of an implication that is not a closed term is an error, reported in the same way. A side whose type is not a tag set is an error too, reported at the side.
- A classifier's name that does not begin with `a` to `z` is an error, reported at the name. `classify` cannot name it, since a bare name with a capital is a tag.
- A warning on a classifier's entry is an error, reported at the warning. An entry takes gates only.
- A key that no canonical sound can be is an error, reported at the key. That is a key with a comma, or with a code point that the simple lowercase mapping changes. So `"Mi"` and `"ko,a"` are errors, as they are in a test.
- A class that is not a name that begins with `A` to `Z` is an error, reported at the class. So `~indicator` is an error there.
- A term or a condition whose types do not agree, as §10 gives them, is an error. So `"a" ∈ tags($x)` and `phonemes($x) = ~a` are errors, and so is `∅ = ∅`, whose kind nothing gives. The reader reports the error at the smallest construct whose parts disagree. That construct is a union with its differences, an intersection, a guarded term, a call or a comparison. Otherwise, it is the whole tag term of a clause or an item, or the whole value of a constant.

  The reader does not know the type of a constant, so it lets a constant stand for a value of any type but a span. After the loader stitches the stage, it makes sure again that the types agree (§2). It reports an error there at the first constant of the smallest construct whose parts disagree.
- A span where a value is needed is an error: a capture, `$`, or `head`, `tail`, `last`, `from` or `after`. The reader reports it at the span.
- A bare name that does not begin with a capital is an error where a value is needed. Such a name is a rule or a classifier. A rule is only the second argument of `tags`, `matches` or `begins`, and a classifier only that of `classify`.
- `matches`, `begins` or `initial` as a term is an error.
- An `&` of more than 16 items is an error.
- An expression, a term or a condition nested more than 256 deep is an error. That is, in the DOM (docs/output.md), a node of one lies below more than 256 compound nodes of it. In an expression, the compound nodes are `optional`, `repeat`, `and`, `choice`, `seq`, `capture` and `test`. The `separator` of a `repeat` counts on from the depth of the `repeat`, as its `repeat` member does. In a term, they are `union`, `intersection`, `difference`, `if` and `call`. In a condition, they are `any`, `all`, `not`, `if`, `matches`, `begins`, `initial` and a comparison.

  The condition of a guarded term counts on from the term's depth, as a comparison's terms count on from the condition's. A test's value counts on from the test's depth in the same way. `( )` makes no node, so it adds nothing. So 256 nested `[ ]` or `{ }` around a symbol are allowed, and 257 are not. The reader reports this error at the first item, in the order of the document, that holds such a node. That item is a rule, a constant definition or an implication.
- `$` with items other than `$` is an error.
- Tags on an inserted tag are an error.
- An inserted bare name that does not begin with a capital is an error, because it names a rule and not a tag.
- An inserted range or property is an error, because it is not one tag.
- `∅` as an item's tags is an error, because no terminal reads such a token.
- An attachment (§11) that holds `$` is an error, reported at the attachment. An attachment holds a named capture.
- An attachment on a `$` item or on an inserted tag is an error, reported at the item. Only a named capture carries attachments. So a constituent never attaches to itself.
- A capture other than `$` named twice in one emission, as an item or as an attachment, is an error. So an attachment capture is never an item of its own.
- A rule's or an alternative's tag term that reads the tags that it defines is an error: `tags($)` or `classes($)` in it. `tags(head($))` and the like read the tokens' tags, not the constituent's, and are allowed, as is `tags($, R)`.
- An unknown directive or keyword is an error. The syntax grammar already refuses it.
- A directive with the wrong operands is an error, reported at the directive. `%stage` takes one name, `%include` one string, and `%features` one or more names. `%ambiguity-resolution` takes a ranking name and optionally `elision-only`. The retired operand `maximal` is an error. `%elidable` is no directive, and the syntax grammar refuses it as an unknown keyword.

Once the reader reads a definition (§2), it makes sure that the whole definition meets its requirements. These checks are about the productions of the definition's alternatives, the expansions of §3.2 with the captures of §3.5. Gates do not matter here, so every alternative counts. Two expansions of one alternative that read the same captures in the same order are one case for these checks. So the reader can decide them over the distinct sequences of captures that the expansions read, without listing the expansions.

Each of the following is an error of the document too, and the reader reports it at the definition:

- A capture that no alternative of the definition captures is an error, in any clause, `$x` presence tests included.
- A condition that applies (§3.6) to no production of the definition, whatever features are enabled, is an error.
- A tag term that uses (§3.6) a capture that a production it serves lacks is an error. An alternative's own tags serve the productions of that alternative, and `%tags` serves every production of the definition. An emission item's tags serve every production in which the item is not dropped.
- `%opaque` in a definition whose emission is `ε` is an error. A constituent that does not count gives no part, so it is never an opaque part (§11).
- In an emission, captures written in an order other than the one in which some production reads them are an error. The written order runs item after item. Within an item, it runs through the before-attachments, the carrier and the after-attachments. For each production, the reader makes sure that the captures that the production has stand in the written order of the emission. So `%emits ($a) $c, $b` is an error when a production reads `$a`, `$b` and `$c` in that order.

  The check is well defined per production, because a production holds each name at most once (§3.5). So each name of the emission stands for at most one part of the production. Those parts have one order, the order in which the production reads them. A name that stands in several branches is the part of whichever branch the production took. So `($a(A) $b(B) | $b(B) $a(A))` with `%emits $a, $b` is an error, because the second production reads `$b` first.

  The same holds for attachments. An attachment capture names at most one part of each production. So the item's before-attachments, carrier and after-attachments have one order in each production. The anchor of an inserted token (§11) is one part of that production.
- In an emission, an attachment capture in a production that lacks the carrier of its item is an error.
- In an emission, an inserted tag before a capture item whose carrier some production of the definition lacks is an error. The capture item is the first one listed after the inserted tag.
- A production for which every item of the emission is dropped is an error. It emits nothing although the rule lists what to emit. A rule that emits nothing says so with `ε`. So `A [$b(B)]` with `%emits $b` is an error, because the production `A` emits nothing.

Two of these checks depend on simplification (§3.6). They are the check that a condition applies to a production, and the check of the captures that a tag term uses. In simplification, a constant is its value, and the reader does not know that value. So the reader leaves these two checks to the loader for each clause that holds a constant. The loader makes them after it gives the constants their values (§2), and it reports an error at the definition. The check that some alternative captures each mentioned capture does not depend on a value, so the reader makes it for every clause.

A document's items are its rules, its directives, its constant definitions, its classifiers and its implications. The DOM keeps them in five lists, each in the order written. Every item has the position of its first token, so the order of all of a document's items is the order of their positions.

A DOM is malformed in each of these cases, whether it is read, cached or in the bootstrap:

- Two of its items share a position.
- A rule lacks `flags`, or its value is neither `[]` nor `["greedy"]`. An `extend` rule must have `[]`.
- It has an expression, a term or a condition with members of two forms, or with a member that its form lacks (`docs/output.md`).
- It has a `ref` that is not a name or `#`.
- It has a `repeat` with a `chain` other than `left` or `right`, or with a `chain` that is not the whole `expr` of an alternative. A `repeat` with a `min` member is malformed too, since the form has no such member.
- It has an `optional` with an `elidable` or a `maximal` member whose value is not `true`, or with `maximal` and no `elidable`. It has an elidable `optional` whose expression the reader refuses (above).
- It has a capture that the reader refuses. That is one that wraps anything but a symbol, or one inside a `repeat` or inside an elidable `optional`. It is also a name that some expansion of an alternative holds twice (above), or a name that is not all lower case.
- It has an emission with a member other than `items`.
- It has a guard of an alternative whose feature is not a name, or that has a member other than its feature, its kind and whether it is negated.
- It has a directive whose name is not `ambiguity-resolution`, `stage`, `include` or `features`. So a directive named `elidable` is malformed.
- It has an `ambiguity-resolution`, `stage`, `include` or `features` directive whose operands the reader refuses.
- It has a `maximal` member on a directive. No directive has that member.
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

To decode a string, the reader removes the quotes. In the decoded string, `\\` is `\`, `\"` is `"`, and `\u{h…}` is the character with that hexadecimal value. The value has one to six hexadecimal digits and is a Unicode scalar value: at most `10FFFF`, and not a surrogate, `D800` to `DFFF`. Any other `\`, and a `\u{…}` that breaks these limits, is an error of the document, and the reader reports it at the string.

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
| `tags(s, R)` | tag set | the union of the tag sets of the completed items of `R` over `s` with an eligible proof tree (§4), or empty |
| `classes(s)` | tag set | the tags of `tags(s)` whose first character is `A` to `Z` |
| `classify(a, C)` | tag set | the classes that the classifier `C` gives the string `a`, for the features of the parse (§2), empty if no entry names `a` |
| `$x`, `$`, `head(s)` and the other span functions | span | the argument of a function, never a value |

In the check of §7, each function of a span reads the projected span of its argument. The input of `initial`, `from` and `after` is the stage's input, or the query's span of it (§7.5).

`split(a, d)` finds the occurrences of `d` in `a` from the left. Each search starts where the last occurrence ends, so two occurrences never overlap. The pieces are the strings before the first occurrence, between two occurrences and after the last one. The value is the set of the pieces that are not empty. So `split("a..b.", ".")` is the set of `"a"` and `"b"`, and `split("aaa", "aa")` is the set of `"a"`.

An empty delimiter is an error. It is an error of the document when the delimiter is the literal `""` or a constant whose value is `""` (§2, §9). Otherwise it is an error of the grammar when a parse evaluates the `split`, and the whole parse fails with it (§13). So `split(phonemes($x), text($y))` is such an error where `$y` is empty.

`tag(a)` needs a name (§9) for `a`. Any other string is an error. When the reader sees it, as a string literal or a constant, it is an error of the document. Otherwise it is an error of the grammar when a parse evaluates the `tag`.

A closed term uses no capture and no span. It holds only strings, tag literals, ranges, `∅`, constants, the operators `∪`, `∩` and `∖`, and `split` and `tag` of closed terms. So it never holds `classify`, whose value depends on the features.

A constant's value is a closed term, whose type is a string, a set of strings or a tag set. So is the value of a test (§2), whose type is a string or a tag set. So is each side of an implication, whose type is a tag set. The loader evaluates a constant's value when it stitches the stage (§2), as a parse evaluates a term.

`..` binds tighter than every other operator, since its two sides are character tags. So `'a'..'c' ∪ 'x'` is `('a'..'c') ∪ 'x'`.

`∩` binds tighter than `∪` and `∖`. Those two bind equally and group from the left, so `a ∖ b ∪ c` is `(a ∖ b) ∪ c`.

`∅` takes its kind from the other side of its operator or comparison. A tag term, guarded term, emission item or tag test also gives it the required tag-set type. In a `%redefine-const`, the type that the constant keeps (§2) gives the value its kind in the same way. So after `%const $A ~a`, `%redefine-const $A ∅` makes `$A` the empty tag set. An expression whose kind nothing gives is an error of the document. So `%const $E ∅` is an error.

`a = b` and `a ≠ b` compare two strings, two sets of strings or two tag sets. Any other pair is an error of the document. `a ∈ b` and `a ∉ b` test a string in a set of strings. `a ⊆ b` tests that every member of `a` is in `b`, and `a ⊈ b` that one is not. Both sides are sets of one kind.

`matches(s, R)` holds when the span parses as `R`, and `begins(s, R)` when a prefix of it does, the empty prefix included. Both read only eligible proof trees (§4).

`initial(s)` holds when the span begins where the input of the parse that evaluates the condition begins. That is the start of the stage's input, or, in a nested parse (§4), the start of the span that the parse reads. `$x`, as a condition, holds when the production has the capture `x` (§3.6), and `$` always holds. `¬c` negates. Conditions joined by `∨` hold when any does, and those joined by `∧` when all do.

`A ⟹ B`, a condition, holds when `A` does not or `B` does. `⟹` binds looser than `∨`, which binds looser than `∧`. `⟹` groups to the right, and parentheses group.

Evaluating a condition can run a nested parse, which can fail with an error of the grammar (§4). `split` and `tag` can fail in the same way. So which parts the engine evaluates is observable, and this section fixes the order of evaluation within one condition or term. §4 fixes the order of the tests, conditions and tag terms of one step of the recognizer.

The engine evaluates conditions joined by `∧` or `∨` from left to right. Evaluation stops at the first that decides the whole: a false one for `∧`, a true one for `∨`. `A ⟹ B` evaluates `A` first, and `B` only if `A` holds. A guarded term `A ⟹ t` likewise evaluates `t` only if `A` holds.

Within a term, the engine evaluates the parts from left to right. So it evaluates the parts of `∪`, `∩` and `∖`, and the arguments of a call, in the order written. It evaluates the two sides of a comparison in the same order. So where two parts both fail, the error is that of the left part. The loader evaluates the value of a constant (§2) in the same order. For example, in `tag($A) ∖ tag($B)`, where neither value is a name, the error is that of `tag($A)`.

`A ⟹ t`, where `A` is a condition and `t` a tag set, is `t` where `A` holds. Where `A` does not hold, it is the empty tag set. A guarded term binds looser than `∪`, `∩` and `∖`, so it stands in parentheses inside any of them.

## 11. Emission

Every stage whose verdict is `unique` or `resolved` emits tokens by walking its chosen tree from the left. This includes the last stage, whose tokens are its output (`docs/output.md`), though no stage reads them.

- The stage walks the children of a constituent whose production has no emission, in order. A token that the constituent reads directly emits nothing.
- A constituent whose production has an emission emits exactly the items of the emission, as dropped for its production (§3.6). It emits them in the order in which the emission lists them. The stage walks nothing inside it but the attachment captures of its items (below):
  - A `$` item emits one token covering the constituent, with the constituent's tags, or with the tags of the item's term if it has one. `$ <t>, $ <u>` emits one such token per item, in order, all with the same span and source. This is how a digit that stands for a two-phoneme word is two tokens over one character.
  - A capture item emits one token covering the captured part, with the part's own tags, or with the tags of the item's term. The token takes the attachments that its item names (below).
  - An inserted tag, a tag literal, emits a token with that one tag and an empty span.
- A constituent whose production's emission is `ε`, no items, emits nothing and does not count. Nothing inside it is part of the phonemes or the label of a token that covers it (§5). It is how a grammar erases text. The text is still there, and still covered by the tokens around it, but counts for nothing. A part that an emission merely does not list is not emitted, but counts.

The tags that an item gives its token are the token's explicit tags. The stage then applies its implications (§2) to them. For each implication `A ⟹ B` whose `A` shares a tag with the token's tags, it adds the tags of `B`. It repeats this until no implication adds a tag, so the order of the implications does not matter. An implication only adds tags, so the repetition ends, also where implications form a cycle. Only then does the stage make sure that the token has at most one phoneme tag, and find its phonemes and its label (§5).

Implications apply to every token that the stage emits, an inserted one included, and to nothing else. They do not change a constituent's tags, the value of a term or classifier, or a token of the stage's input. A later stage applies only its own implications. The synthetic tokens of §7 are not emitted, so no implication applies to them. No derivation of the check of §7 emits or attaches anything.

An item's tag term that gives the empty set is an error of the grammar, found while parsing. No terminal can read such a token. The stage already accepted its input and chose its tree. So it keeps its verdict and warnings (§12), but it has no output, and the error is the result's. The check of §7 does not run.

The constituent of a token is the constituent that its `$` item covers, or the part that its capture item captures. An emitted token's span is the range of the stage's input tokens that its constituent covers. Its `source` is the source of those tokens (§1), or, if there are none, empty where a node with an empty span has it (§12). A token whose constituent is an opaque part is the one exception, as below. Its phonemes and its label are as in §5.

An inserted token's span is empty at the start of its anchor. The anchor is the first written part of the capture item listed next after it, among the parts that the production has. That part is the item's first before-attachment capture that the production has, or else its carrier. So in `%emits X, ($b) $w`, `X` stands before `$b` where the production has `$b`, and before `$w` where it does not.

If no capture is listed after an inserted token, the span is empty at the end of the constituent. Its source is empty at the source end of the input token before that position. If the position is the constituent's start, its source is empty at the start of the constituent's source.

During emission, `%opaque` treats a constituent as one part, with its text as its label and `?` as its phonemes. The body of a `zoi` quote is an example. Recognition and conditions do not change. They still read the phonemes of the stage's input tokens.

Before the stage emits anything, it finds the opaque parts of its chosen derivation. An opaque part is a constituent whose production has `%opaque`, with two exceptions. A constituent inside a constituent that emits `ε` is not an opaque part. A constituent inside an opaque part is not an opaque part either. Here, inside means below in the derivation, so the outer constituent of a recursive opaque rule is the one opaque part.

This selection is over the whole chosen derivation, and it does not change what a constituent emits. Whether a constituent is an opaque part depends on its place in the derivation. Two occurrences can use the same production over the same span but differ in whether they lie inside an opaque part.

A `%opaque` constituent that the selection leaves out is an ordinary constituent, even when its own emission clause emits a token over it. That token has the source of its input tokens and the join of its parts. This can happen inside an opaque part. An opaque rule with no emission clause walks its children. A capture item of an opaque rule emits a token over part of its constituent. It never happens inside a constituent that emits `ε`, because that constituent walks nothing, so nothing inside it emits.

Each opaque part has a source and a text, which the stage also fixes before it emits anything. An empty opaque part takes in no text. Its source is the empty-node source of §12.

An opaque part with a non-empty span starts from the source of its own input tokens (§1). It then takes in the text next to it that no input token covers, as the next two paragraphs say.

Two adjacent input tokens can have text between them. If an opaque part with a non-empty span ends between them, that text belongs to it. Otherwise an opaque part that starts there takes the text. An opaque part that starts at the first input token takes the text before it. An opaque part that ends at the last input token takes the text after it. So in `a,b`, where `a` and `b` are two adjacent opaque parts, `a` takes the comma.

Where the input token just before its span ends earlier than its own source starts, an opaque part's source starts at that token's source end. With no token before its span, the source starts at the start of the text. Neither applies when another opaque part with a non-empty span ends where this one starts. Where the input token just after its span starts later than its own source ends, the source ends at that token's source start. With no token after its span, the source ends at the end of the text. The text of an opaque part is the original text over its source.

These rules also hold for input tokens whose sources overlap or lie out of order. There they do not keep the sources of two opaque parts apart. Two opaque parts can then share text, so their texts and their labels can overlap too. The text between two adjacent input tokens still goes to at most one part. An ordinary token never takes in such text.

A token whose constituent is an opaque part has the source and the text of that part. So a capture item of a parent emits the same token as a `$` item of the opaque rule itself. Any other token has the source of its input tokens, as above, even where an opaque part among its parts reaches further. Its label still holds the whole text of that part. So its label can reach beyond its source, and it need not lie within its text.

A later stage that forwards a token keeps its source, because a token over one input token has that token's source (§1). So the text of a quote body stays the same to the end of the pipeline, although the tokens next to it can disappear.

The parts of an emitted token are what its phonemes and its label join (§5). The stage finds them by a walk of the token's constituent, in order. A read input token is a part. An opaque part is one part, and the walk does not enter it. A constituent that emits `ε` gives no part, and the walk does not enter it either. The walk enters every other constituent.

So three rules decide what an opaque part gives, over the chosen derivation. A part inside a constituent that emits `ε` gives nothing, opaque or not. An opaque part inside another gives nothing of its own, because the outer one counts once. A token with its own phoneme tag sounds like that phoneme and has it as its label, whatever opaque parts it covers (§5). The tag can come from the token's own stage, or from a later stage that emits a token over it.

A token can carry attachments. These are other tokens that belong to it, and no later stage reads them. A token has two lists of attachments, `before` and `after`. No grammar operation sees a token's attachments: not a terminal, a test, a condition or a function.

A capture item can name attachment captures in parentheses, any number before it and any number after it. An example is `($b) $w <tags($w)> ($a)`. The item's own capture, `$w` here, is its carrier. The carrier is always a named capture (§9). Each attachment capture is a capture of the rule, and it stands in no other item.

The carrier emits its token over its captured part, as any capture item does. It does not run the emission of that part. So the item keeps a structure inside the carrier's part only if it captures that structure separately. The captures of one production are disjoint. So the carrier's phonemes, label, text and source are its own, as for any capture item.

The attachment of a capture is the sequence of tokens that the captured constituent emits, in its own place in the derivation. The stage finds these tokens as it finds the tokens of a constituent that it walks. So the opaque parts, the empty sources and the `ε` of this section apply to them. A constituent that emits nothing gives no attachment. A bare terminal with no emission above it is an example.

The tokens of an attachment are not tokens of the stage's output. Each of them is an emitted token, so the stage applies its implications to it. The stage also makes sure that it has at most one phoneme tag (§5). A constituent above the item can emit one token over the span of the attachments. That token treats their parts as ordinary parts of its span.

Within one item, the stage first produces the before-attachments in written order. Then it produces the carrier's token with its tag term, and then the after-attachments in written order. The carrier's token takes the tokens of its before-attachment captures, in order, as its `before`. It takes those of its after-attachment captures as its `after`. The first error of the grammar ends the stage's emission, as an empty tag term does.

An attached token has no span, since its span counts the input of the stage that attached it. Its `source` stays in the coordinates of the original text.

The parts of a token (above) also decide its attachments. An input token inside a constituent that emits `ε` is not a part, and its attachments go with it. An opaque part is one part.

If a token has exactly one part, and that part is an input token with attachments, the token inherits those attachments. This holds whatever tags its item gives the token. The token's own attachments from its item are outer. So its new before-attachments come before the inherited ones, and its new after-attachments come after them.

A token can have an input token with attachments among its parts together with another part. That other part can be an input token, with attachments or without, or an opaque part. This is an error of the grammar. A token whose parts hold an opaque part that holds an input token with attachments is an error of the grammar too. An opaque part holds each input token that it reads, except one inside a constituent that emits `ε`.

An input token with attachments can also be the one part of two tokens that the stage emits, as under `$ <t>, $ <u>`. This is an error of the grammar as well, since its attachments cannot belong to both tokens. The stage finds the error at the second of those tokens.

The reason is that a token over several parts cannot say which part each attachment belongs to. The stage makes sure that a token's parts meet these requirements after it makes sure that the token has at most one phoneme tag. No bundled dialect has a stage that makes such a token.

The attachment lists follow the order of the derivation and of the emission. That is the order of the text when the sources lie in order. The engine does not promise that order for sources out of order.

A stage whose verdict is `tie` emits nothing (§6), at whichever stage it is. This holds even where the tied derivations emit the same tokens. A tie is a property of the grammar, and the grammar is the place to settle it. The engine never emits one tied derivation in place of the others.

## 12. The tree

The result's tree comes from the chosen derivation, and each reading of an `ambiguous` error comes from its own derivation (§6, §7). The engine builds a tree from a derivation as follows:

- A closed production of a rule that the author wrote is a `rule` node, its children in order.
- A read token is a `token` node holding the index of the input token and the terminal that the recognizer read it as.
- The engine splices out helper productions, those of `[ ]` and of flat `{ }`: their children take their place. So a list is never a node. Its items and separators are children of the node of the rule that writes it, in order. A plain optional that holds a capture has no helper (§3.2), so what it reads is already a child of the rule's node. So an optional is never a node, whether it is a helper or expanded in place.
- A level of a chain is a closed production of its rule (§3.3), so each level is a `rule` node, and the levels nest.
- An elidable optional (§3.8) that is absent becomes an `elided` node for its terminal `T`. In a reading of the check of §7, a read of a synthetic token also becomes an `elided` node, as §7.10 says. This holds also on route 3 and for a bare terminal. The node has an empty span at the position where the optional is empty. The node of a terminator with an `=` test records the test's string, for the synthetic token of §7. The output does not show it (`docs/output.md`). The readings of the check of §7 map the reconstructed input back to the stage's input, as §7.10 says.

The input token of a token node can carry attachments (§11). The node does not hold them, and the renderings take them from the token (`docs/output.md`). The two readings of an `ambiguous` error read the same input tokens, so they show the same attachments.

A node with a nonempty span has the source of its tokens (§1). A node with an empty span is an `elided` node or a rule that read no token of the stage's input. Such a node has an empty source at the source end of the input token before its position. At position 0, its empty source is at the source start of the first input token, or at 0 if there is no input token.

A `rule` node of a stage's chosen tree gives warnings from the alternative that its production came from. It gives one warning for each warning `f!` of that alternative where the feature `f` is on. The warning holds the stage's name, the feature, the rule, and the node's span and source. So a warning on a chain's alternative gives one warning for each level of the chain, each with its level's span.

A stage's warnings are those of its chosen tree. They are in the order in which a walk of the tree meets their nodes, parent before children and children left to right. The warnings of one node are in the order in which its guards are written. A stage whose verdict is `tie` has no chosen tree, so it gives no warnings. The engine never takes warnings from one tied derivation in place of the others.

Nothing else gives warnings. No warnings come from a reading of an `ambiguous` error or a losing derivation. None come from the check of `elision-only` (§7), a nested parse (§4), or a stage that rejected its input. A warning changes nothing that the stage accepts, chooses or emits.

## 13. The pipeline

A pipeline document (`docs/design.md`, "Pipelines") defines a dialect. The loader reads it into stages as follows.

To splice a pipeline, the loader reads the pipeline document's items (§9) in order. It replaces each `%include "PATH"` with the items of the document at `PATH`, read in the same way. It resolves `PATH` against the directory of the document that holds the `%include`. It splits the resulting stream of items at each `%stage NAME`. The items after it, up to the next `%stage`, are that stage's, whatever documents they come from. So a `%stage` inside an included document starts a stage like any other, and the items after the `%include` go on in it.

The names of every `%features` of the stream are the features the pipeline turns on. The loader stitches each stage's other items in order (§2). Each of these is an error of the dialect, and the loader reports it at the item named:

- An `%include` of a document that does not exist is an error at the `%include`. The error names the documents that included it.
- An `%include` of a document that is already being included, which is a cycle, is an error at the `%include`. The error names the documents that included it.
- A rule, an `%ambiguity-resolution`, a constant definition, a classifier or an implication before the first `%stage` is an error.
- A `%stage` with the name of an earlier one is an error.
- A stage with no rules is an error at its `%stage`.
- A pipeline with no `%stage` is an error.

A document can be included more than once, in one stage or in several. The loader reads its items again each time.

The first stage reads the character tokens of §1, and each later stage reads the tokens that the stage before it emitted. The features on for every stage are those that the pipeline or the caller turns on, less those that the caller turns off. A caller who names one feature both to turn on and to turn off makes a usage error. Naming a feature that no guard of the dialect uses is not an error: the feature is on or off. A stage that rejects its input ends the run with that rejection. An `ambiguous` error, of a tie (§6) or of the check of §7, ends it likewise.

The result's `ok` is true when every stage run accepted without an error. The result's warnings are those of every stage that ran (§12), in stage order, and they are kept whether or not the result is `ok`.

A dialect's features are the names its guards use in any stage and the names its `%features` declare. The guards counted are those of each stage's rules after stitching (§2), so an alternative that `%redefine-rule` replaced no longer counts. The gates of every classifier's entries count too. The loader counts them before any gate drops an alternative (§3.1), whatever features are on.

Each name is a gate, if a guard uses it as `f?` or `¬f?`, or a warning, if a guard uses it as `f!`. A name that one guard uses as a gate and another as a warning is an error of the dialect. The loader finds this error when it loads the dialect. A name that only `%features` declares is a gate. A dialect lists its features, each with its kind and whether `%features` turns it on.

When all of these hold, the engine runs the stages up to and including the one named `words` once without `sa-su`:

- The caller asks for auto features.
- The dialect has `sa-su` as a gate.
- `sa-su` is not already on.
- The caller did not turn `sa-su` off.
- The run reaches a stage named `words`: the dialect has one, and `until`, if given, names it or a later stage.

The engine then runs the parse again from the first stage with `sa-su` added, in two cases. In the first case, that first run does not end with the `words` stage accepting. Any reason counts: a rejection, a tie or another error in it or in a stage before it. In the second case, the chosen tree of the `words` stage has a constituent of the rule `word` whose tag set has `SA` or `SU`.

In either case, the engine discards the first run's stages and warnings. Otherwise that first run's stages are the parse's, with their warnings, continued to the end. The engine tests the class and not the sound, because the lexicon decides which words erase. For example, `li'oi` is SU in the experimental lexicon, and a stressed `sA` is `sa`.

Mistakes of the caller are errors of kind `usage`. Two examples are an `until` that names no stage and a text that is not a sequence of scalar values (§1). A token that the caller supplies with attachments is a third (`docs/api.md`). They are raised or returned as a load error is, and they are not results.

A grammar error found while parsing is a result. Examples are a nested parse asked about its own span as the same rule, and a `split` with an empty delimiter. Its error has kind `grammar`, the `stage` that it arose in and a message, and no position. The check of §7 can also end with an error of kind `grammar` and the code `elision-witness-lost` (§7.9). That error also has `chosen` and `completion`. It ends the run.
