# jbogenbau, the grammar notation

Every grammar in gencmu is a Markdown document. Its fenced `jbogenbau` blocks, read in order, are one grammar, and the prose between the blocks explains it. This document explains jbogenbau, the notation that those blocks use. The grammars only say what they are about, and refer here for the rest. Two grammars written in jbogenbau itself define it: `grammars/notation/lexical.md` and `grammars/notation/syntax.md`.

A jbogenbau grammar is an attribute grammar with EBNF rule bodies. An attribute grammar gives computed values to constituents. A constituent is the text that one rule matches. EBNF (Extended Backus-Naur Form) is a common notation for the bodies of grammar rules.

Each rule body follows the EBNF form of *The Complete Lojban Language* (CLL), edition 1.1, chapter 21. Repetition and elidable terminators differ. A token is one unit that a grammar reads or emits. A phoneme is a unit of sound. A tag is a mark on a token or constituent. Each constituent carries one attribute, its set of identifier tags, such as `KOhA` or `Word`, computed bottom-up from its parts.

Conditions over the parts restrict which parses exist. A condition can also ask whether a part parses as another rule. This takes the grammar beyond context-free grammars, whose rules only combine symbols. It goes beyond them in the way that Boolean grammars do. In a Boolean grammar, a rule can also require that the same text matches, or does not match, another rule.

Tokens include characters, phonemes and words. A transducer reads tokens and emits another sequence.

Each rule can also say what its constituents hand to the next grammar. So a grammar is a transducer. A dialect is a pipeline of these grammars, its stages, defined by one pipeline document.

An ordinary choice is unordered: its alternatives have no priority by position. A ranked choice filters alternatives at one written position before ranking. Rule flags and the stage directive then rank the remaining complete parses. The sections "Ranked choices" and "Ambiguity" describe filtering and ranking.

## Values and images

Every token has a value and an image. Its value is the string that exact comparisons read. Its image is the string that people see. Tags never supply either string. A constituent stores neither string.

Stage zero, named `input`, supplies character tokens. Both strings start as the character. A recipe is an expression that supplies a string. Later stages set strings through grammar recipes, or concatenate their non-erased parts. Forwarding keeps stored values and images. The engine never trims, merges, lowercases, or removes characters.

A string walk builds strings from constituent parts. The section "Two walks and recipes" defines how recipes replace those parts.

## Rules

A grammar is a sequence of rules, directives (see "Directives"), constants (see "Constants"), classifiers (see "Classifiers") and implications (see "Implications"). Each one begins with a keyword, which is a word after `%`, and ends where the next one begins. A rule is `%rule`, its optional flags, its name, and its body:

```jbogenbau
%rule sumti-tail
  [sumti-6 [relative-clauses]] sumti-tail-1 | relative-clauses sumti-tail-1
```

`%rule(leftmost-longest) NAME` gives the rule the only supported flag, `leftmost-longest`. A flagged occurrence is a flagged rule's constituent. The flag prefers earlier starts, then longer nonempty occurrences at one start. A parse with a nonempty flagged occurrence beats one without any. "Ambiguity" gives the full comparison.

For example:

```jbogenbau
%ambiguity-resolution greedy
%rule text r | r "b"
%rule(leftmost-longest) r "a" "b" | "a"
```

On `ab`, the stage chooses the parse where `r` spans both tokens. Without the flag, the directive `greedy` leaves the two parses tied.

For a tense example, flagging only `simple-tense-modal` groups `pu va ca gi` as `pu va` then `ca gi`. The official parser gives that grouping. This example does not define the official lexer's procedure.

Spaces around the parentheses and their content have no meaning. By convention, the opening parenthesis follows the keyword directly.

Empty parentheses, duplicate flags, unknown flags and arguments are errors.

Line breaks and indentation mean nothing. So a long list of alternatives can put each alternative on a line of its own, and every `|` can also stand first. By convention, authors indent the body by two spaces under the keyword:

```jbogenbau
%rule term-connective
  | joik #
  | jek #
  | ek #
  | VUhU #
```

These separators can also stand first: `&` in bodies, `∪` and `∩` in terms, `∧` and `∨` in conditions, and clause-list commas. `∖` in terms, `/` in braces, and `≻` in ranked choices cannot stand first.

A clause assigns tags or strings. Clauses come in the order `:: T`, `:= value`, then `:- image`, with each optional. `T` is a tag term, a term whose value is a set of tags. Clauses can stand after an alternative or on the definition header. A header with any clause requires a leading `|` before its first alternative.

A `:: T` clause gives constituent tags, with definition and alternative tags unioned. Trailing keywords impose conditions or define output:

- `%conditions` follows the body and states what must hold of the parts.
- `%emits` follows conditions and states what the constituent hands to the next stage.
- `%erased` follows conditions instead of `%emits` and removes the constituent from emission and counted parts.

The sections below explain these forms.

`(* ... *)` is a comment, anywhere in a block.

## Names and terminals

Names use ASCII letters, digits, hyphens, and underscores. A rule, classifier, or stage starts with a lowercase letter. Feature names retain main's form: an ASCII letter of either case, followed by ASCII letters, digits, or hyphens. A rule can also be named `#`. A tag starts with a capital or `_`. A tag terminal reads a token carrying that stored tag. For example, `KOhA` reads a word tagged by the lexicon.

A tag is an identifier string. A tag has no strength: a token either carries it or not. A class starts and ends with an uppercase ASCII letter and never starts with `_`. A selma'o is a class of Lojban particles.

- A class is a tag such as `KOhA`, `BRIVLA`, or `FOREIGN`.
- A mark is a tag such as `Word`, `Stressed`, or `Run-Initial`.
- An engine tag is a stored property such as `_Lu`, `_L`, or `_White_Space`.

A tag literal is a singleton tag set written as its capitalized name. `KOhA` denotes the same tag in a body, a tag term, and a set expression. Bare adjacent tag names form one union atom. The section "Juxtaposition" gives its grouping rules.

A bare lowercase name names a rule or classifier, never a tag. Capitalized user tags can contain underscores. A leading underscore belongs to the engine inventory of engine §1. `_` alone is a wildcard terminal, not a tag.

A tag literal is a terminal in a body. A string literal or string constant is also a terminal. It consumes one ordinary token whose value equals that string. `_` consumes any ordinary token. These terminals work at every stage. Tags never determine the token's value or image.

A scalar value is a Unicode code point outside surrogates. Engine constants such as `$_ED80` denote one scalar string. Their hexadecimal has four to six uppercase digits and cannot exceed `10FFFF`. Surrogates `D800` to `DFFF` are errors. `"a"` and `$_0061` have the same terminal identity. `$_0301` denotes a combining acute accent.

A range, `"a".."z"`, reads a token whose value is one scalar within its inclusive endpoints. Each endpoint is a string literal or constant resolving to one scalar. The range skips surrogates, so `$_D7FF..$_E000` has two possible values. A reversed range is an error. `...` is a chain marker, so `"a"..."z"` is an error.

The Unicode table `grammars/unicode.txt` supplies stored stage-zero property tags. General categories use names such as `_Lu` and `_Nd`, and major categories use names such as `_L`. `_White_Space` completes the inventory. Case counts, and long aliases such as `_Letter` are errors. Engine §1 lists every name and its assignment rule.

A range and an engine tag are terminals in a body. A range tests the value and an engine tag tests stored membership. Each reads one token with one reading. A capture names a matched part, as in `$c:"0".."9"` or `$c:_L`. A grammar can forward or filter engine tags but never introduce them.

An engine tag can stand in a tag test, a pattern, a condition, and a body terminal. A tag-set constant cannot hold an engine-tag literal, even inside a filter. Neither side of `%implies` can name one. Tag terms can filter forwarded membership, as in `:: $c.tags ∩ _Lu`. [Engine §1](engine.md#engine-tag-provenance) defines the exact `lit` test for nested filters.

Either terminal can take a test. Neither a range nor an engine tag can mark an elidable optional. Emission inserts tokens with `ε` and explicit clauses, never with a range or property literal. Expected terminals and tree leaves use canonical spellings, such as `"a".."z"`.

A string is text in straight double quotes, such as `"la"`. It can be a terminal, a condition value, or a recipe atom. Strings have no backslash escapes. `$(NAME)` interpolates a string constant and `$$` writes a dollar sign. `$(_0022)` writes a quote. The section "Constants" gives errors and resolution.

## Tests

A span is a range between input token boundaries.

A reference or terminal can carry one tag test and one value test. The tag test comes first, and both must hold. Here, `X` denotes its symbol:

- `X="s"` requires the exact input value `s`. `X≠"s"` requires another value.
- `X<A B>` requires both tags on the symbol. `X<¬A ¬B>` forbids both tags.
- `X<$C>` requires every tag of a tag-set constant. `X<¬$C>` forbids every tag of that constant.

A terminal's own tags are the tags of the token that it reads. A reference's own tags are the tags of its constituent (see "Tags"). A symbol with tests is a tested symbol. The symbol matches only where every test holds.

After normalization and word classification, stressed `lA`, Cyrillic `ла`, and zbalermorna `la` match `LA="la"`. A reference reads its complete input value.

A sumti over `lo mlatu` has value `lomlatu`, so `sumti="lomlatu"` succeeds. The word stage erases the pause between the two words. Concatenation supplies no separator, although the source text remains `lo mlatu`.

The emitted letter word `broda bu` has value `broda bu` when its gap recipe supplies one space. A test in the next stage reads this emitted value. In the word stage, `lerfu-word="broda bu"` instead tests its input span. For `broda .y. bu`, that span includes the hesitation and pauses.

`s` is a string literal or string constant. Case and commas have no special comparison rule, so `LE="La"` and `LE="l,a"` are legal exact tests. Tag requirements contain tag names or tag-set constants, with optional negation. They hold no capture or input method. Groups and general set expressions do not stand inside a tag test.

A test belongs to its one symbol, so every item of `{UI="ui"}` must have value `ui`. A capture can wrap a tested symbol, as in `$l:LA="la"`. A test written after a capture binder belongs to its target, as in `$l:LA="la"`. Only a supplied notation tree can test the capture itself. A test follows only a reference other than `#`, or a terminal. So a test after a group, an optional, braces, a capture, `ε`, `#` is an error, such as `(LE NU)="lonu"`. Spaces and comments can stand between a symbol and its test, and inside the test. The grammars write a test without them.

A test holds or fails as a condition does, including over an empty span. `X=""` and `X≠"la"` hold for a rule that reads nothing. An empty `<>` or empty constant requirement holds vacuously. An elidable terminator can carry either test kind or both. All its tests control both written and omitted routes.

A test does not replace a class. `zo la` quotes a word with value `la` but only the tag `Word`, so `LA="la"` cannot read it. A captured `cmavo` with condition `$c.tags ∩ UI = ∅` can instead use `cmavo<¬UI>`. A combined test spells `_<Stressed>≠"y"`. A second test of either kind, or a tag test after a value test, is an error.

## Operators

The body adds repetition, elidable terminators, and ranked choices to the CLL operators:

- Juxtaposition is sequence.
- `a ≻ b` is a ranked choice, with the preferred option first (see "Ranked choices").
- `[x]` is optional.
- `[+T x]` is an elidable optional, whose first item is the terminator `T`. "Elided terminators" below explains the marker.
- `{x}` is one or more of `x`, and `[{x}]` is zero or more. `{x / s}` is one or more of `x` with `s` between each two. "Repetition" below explains braces, and the chains `{... x / s}` and `{x ... / s}`. A chain can also leave out `/ s`, as `{... x}` and `{x ...}`.
- `A & B` reads one or both parts: `A`, `B` or `A B`, but not `B A`. `A & B & C` is any non-empty subsequence in that order.
- `( )` groups.
- `ε` is the empty sequence.

`&` binds tighter than either `|` or `≻`. Parentheses, brackets and braces each delimit what they hold, so they need no precedence.

`#` is shorthand for an optional list of free modifiers (CLL 1.1 section 21.2, point 9). This construct appears in many places. A free modifier is a word or phrase that stands almost anywhere. A vocative is an example.

`#` is not an operator but a rule, whose name is `#` and not a word. The grammar defines it like any other rule. The syntax grammars define it as `[{free}]`, zero or more free modifiers, as CLL's own EBNF does with `[free ...]`. Its constituent is a node of the tree like that of any rule, so the free modifiers in one slot are grouped under it.

A terminator is a word that closes a construct, such as `ku`. CLL writes a terminator that can be elided (left out) between slashes, `/KU/`. It writes `/KU#/` for such a terminator whose free-modifier slot goes with it. In this notation, both are elidable optionals: `[+KU]` and `[+KU #]`.

The `+` after the bracket marks the optional as elidable, in its place (see "Elided terminators"). A plain optional, `[KU]`, is never elidable. Here, `/` separates brace items from their separator.

## Repetition

Braces repeat what they hold. There are two kinds of braces. Flat braces read a list, and the tree shows the list as it stands. Chain braces read the same words, and the tree shows how they group.

- `{x}` is one or more of `x`.
- `{x / s}` is a separated list: `x`, then any number of `s x`. So `{term / CEhE #}` is one or more terms, with `CEhE #` between each two.
- `{... x / s}` is a left chain: `x`, or a left chain, then `s` and `x`.
- `{x ... / s}` is a right chain: `x`, or `x` and `s`, then a right chain.

A chain, like a list, can leave out `/ s`. So `{... selbri-4}` is a left chain of `selbri-4` with nothing between the items.

`[{x}]` is zero or more of `x`: an optional list. The notation has no other way to say "zero or more". ISO 14977, the standard EBNF, reads `{x}` as zero or more. This notation reads it as one or more. So every kind of braces counts its items in the same way, and brackets are the one way to say "or none".

### How braces are written

Braces are a primary, like parentheses and brackets. So an operator outside them treats them as one operand. `{A B} & C` repeats the sequence `A B`, and `[{x}]` makes the whole list optional.

Inside one pair of braces, the item `x` and the separator `s` are each a full choice, as inside parentheses. Each can hold sequences, `&`, `|`, optionals, groups and other flat braces. So `{a | b / c | d}` is items from `a | b`, separated by `c | d`. The separator of `{... simple-tense-modal / jek | joik}` is `jek | joik`. Like a choice in parentheses, each side can begin with `|`. The separator `/` cannot stand first.

A pair of braces has at most one separator `/`, and each side of it holds an expression. So `{}`, `{x /}`, `{/ s}` and `{x / s / t}` are errors of the document. A separator can be `ε`, but an item cannot (below).

The chain marker `...` stands right after `{` for a left chain. It stands after the whole item, before `/` or `}`, for a right chain. So `{a | b ... / s}` is a right chain whose item is `a | b`.

A pair of braces has at most one marker, and the separator has none. So `{... x ...}` and `{x / ... s}` are errors of the document. `...` has no other use. CLL's postfix `x ...` is an error of the document, and so is `"a"..."z"`.

`/` separates repeated items from their separator. Strings use engine-constant interpolation for special characters. Comments can contain backslashes, as in `(* see C:\temp *)`. Elsewhere, backslash is rejected. Include paths use `/` separators. `∖` denotes set difference.

A chain is the whole of its rule. That means two things. First, the chain is the whole expression of its alternative. A chain inside parentheses, brackets, other braces, a capture, a sequence, a choice or `&` is an error of the document.

Second, that alternative is the only alternative of its rule that the gates leave (see "Feature guards"). A warning does not remove an alternative. So a rule with another alternative beside its chain is an error of the grammar for the features that leave both. For those features, gencmu finds the error when it prepares the grammar, as it finds an error of a classifier. A `%extend-rule` of a chain's rule can cause this error.

The chain's alternative can still have guards and tags of its own, and its rule can have clauses. A chain can be optional, or part of a sequence, through a rule. Name the chain as a rule. Then write the rule's name there, as in `[tag]`.

An item of braces must read at least one token. An item that can match no tokens is an error of the grammar, found as the error above. So `{[x]}`, `{ε}` and `{#}` are errors, and so is `{r}` where `r` can match no tokens for the features of the parse.

gencmu decides this from the rules alone, as the gates and stitching leave them. It ignores every test and condition. So a rule `r` whose only alternative is `ε` with a condition that never holds still makes `{r}` an error. An alternative that a gate drops does not count, and one that an `%extend-rule` adds does.

A separator can match no tokens. So `{relative-clause / [joik]}` reads relative clauses with or without `joik` between them. Since an item is never empty, `[{x}]` reads nothing in exactly one way.

### Lists in the tree

A flat list is not a constituent. Its items and its separators are children of the constituent of the rule that writes the braces, in order. So the first rule below gives one `terms-2` node over all its terms and separators. The second gives one `text` node with every `B` between `A` and `C`:

```jbogenbau
%rule terms-2
  {term / CEhE #}

%rule text
  A {B} C
```

A list has no node, so nothing can name it, capture it or test it. The clauses of the rule apply to the whole constituent of the rule, and never to a part of the list. To make a list a constituent of its own, name it as a rule.

### Chains in the tree

Each level of a chain is a constituent of the chain's rule. The chain needs no rule names of its own, because every level is a node of that rule. Take `%rule tag {... tense-modal / joik-jek}`. It reads `ba je ca je pu` as three `tag` nodes. The outer node holds a `tag` node over `ba je ca`, then `je` and `pu`. That inner node holds a `tag` node over `ba` alone, then `je` and `ca`.

The clauses of the rule serve every level, as they serve every alternative:

- A condition on `$` holds of each level. So a condition of a left chain holds of every prefix, and one of a right chain of every suffix. A condition on the whole chain alone belongs to a rule that refers to the chain's rule.
- A level has the tags of the rule's tag terms, where the rule writes them (see "Tags"). Where it writes none, the level of one item has the item's tags if the item is one symbol, and every longer level has none.
- A warning on the chain's alternative gives one warning for each level in the chosen tree, each with the text of its level.
- `%emits`, `%erased`, and constituent recipes serve each level. `%emits $` emits the outermost level as one token. Its string walk uses level recipes without executing inner emission lists.

A chain cannot hold a capture, since a capture never stands inside braces (see "Captures"). So a clause can say nothing about a part of a chain, only about a level, `$`.

A right chain is not the same as an optional suffix. In a rule `r`, the body `x [s r]` and the chain `{x ... / s}` read the same words. But the level of one item is `x` alone in the chain, and `x` with an empty optional in the suffix. That makes three differences:

- The suffix can be an elidable optional, `[+T s′ r]`, where `s` is `T s′`. Where that suffix is absent, it leaves an elided node, and `late-elision` counts it. The chain has no optional there, so it elides nothing. So a text can tie, or resolve otherwise, under `late-elision`, and `elision-only` sees a different terminator. A plain suffix, `[s r]`, elides nothing, as the chain does.
- A single-symbol `x` gives that level its tags in the chain. The optional-suffix form inherits none unless the rule writes tags.
- Where `s` starts with `[+T]`, the suffix and chain apply different rules for written-terminator priority (see [Conditions](#conditions)). In the suffix, the marked optional starts the optional's content. In the chain, it follows the item's last symbol, which a query can extend. Engine §4 gives the exact rule. An omission names no separate constituent that it ends.

Where the suffix is plain and `s` does not begin with an elidable optional, the two group the words in the same way. The tags of a level of one item can still differ, as the second difference says.

## Ranked choices

A ranked choice writes its preferred option first: `(a ≻ b ≻ c)`. Each option can contain a sequence. Parentheses delimit a ranked choice inside a larger expression.

A prefix context is recognition state before the group. Only options of the same group in the same prefix context compete ([engine §6.1](engine.md#61-ranked-admission-before-ranking)).

A lower option disappears where an earlier option qualifies over the same span. Qualification requires its tests and ready conditions to pass. A condition is ready when every capture that it reads is bound. A failing higher option removes nothing.

The parses that survive ranked filtering are admitted.

Earlier options also outrank later options when intervening options are absent. An ordinary choice inside an option gives its branches equal rank. Different spans still compete through the ordinary stage ranking.

```jbogenbau
%rule me-unit
  ME # (sumti ≻ mex) [+MEhU] # [MOI #]
```

Binding, from strongest to weakest, is primary expressions, sequence, `&`, then choice. At a choice level, the separator is either `|` or `≻`. Mixing them at that level is a reader error. Parentheses start another level.

A seal is an opaque leaf supplied by a ranked choice. Outside patterns cannot inspect the selected option through this leaf.

| Text | Meaning |
| --- | --- |
| `a b ≻ c d` | Rank the sequence `a b` above `c d`. |
| `(a ≻ b) c` | Rank the child before the common suffix `c`. |
| `a & b ≻ c` | Rank the conjunction above `c`. |
| `a ≻ (b \| c)` | Rank `a` above either lower branch. The lower branches share one rank. |
| `(a \| b) ≻ c` | Either higher branch removes `c` over the same span. |
| `(a ≻ b) \| c` | Keep `c` outside the ranked group. |
| `a ≻ (b ≻ c)` | Give the inner expression its own group and seal. |
| `[a ≻ b]` | Keep the absent optional route outside the ranked group. |
| `{(a ≻ b)}` | Repeat ranked items that must read at least one token. |
| `(ε ≻ a)` | Compare empty options only against other empty options. |

Thus `a | b ≻ c` and `a ≻ b | c` require parentheses. A whole rule body can be `a ≻ b`. A leading `|` starts the ordinary alternative list, so `| a ≻ b` also requires parentheses.

A rule with header clauses writes a ranked body as `| (a ≻ b)`. Its DOM is the same ranked expression as `a ≻ b`.

Every ranked expression needs at least two nonempty written operands. `ε` supplies an explicit empty operand. Each operand is a complete conjunction expression. `≻` has no operator meaning inside strings, conditions, or tree patterns.

Optionals and repetitions accept ranked content in their existing expression positions. A repetition separator can contain a ranked group too. Repetition items must still read at least one token. An elidable optional still requires its leading terminal.

Ranked options have no local guard, tag clause, or emission clause. Ordinary alternative guards and trailing tags apply to the whole expression. A named rule can express a feature-dependent category.

Captures inside a ranked choice belong to that choice. They can serve only conditions ready before that choice closes. They cannot feed later conditions, tag terms, emission items, or parent recipes. No capture can wrap a sequence or ranked choice. Losing options run no recipes, and a winning recipe error never triggers fallback.

The whole-parent `$` becomes ready only when its named alternative completes. A final ranked group can reach that point. Any remaining element, including an empty optional, delays that readiness.

Outside patterns see one seal for the whole ranked choice, even when its completed option is empty. They cannot inspect its names, children, or option. Descendant, first-path, last-path, and sole-child walks stop there.

An action reads one token or closes a constituent. Internal named rules and ready conditions on their captures retain their own pattern views. The seal changes no output tree, omission, action, or captured constituent. An author who needs that hidden structure outside the choice cannot rank that position.

The choice must discard its returned tags locally or return a provably empty set. A common explicit tag term can replace inheritance. The loader applies the closure in engine §2.1. A private capture cannot supply that common term.

`begins`, `matches`, and `.tags` with a rule argument inspect readings allowed by recognition before ranked filtering ([engine §4](engine.md#4-recognition)). `span.tags(rule)` remains a union over those readings.

After admission, rule flags take precedence over the stage directive. With no flagged rule, the stage directive alone ranks the admitted parses.

## Feature guards

A feature is a name that is on or off for a parse. It has the same value in every stage of that parse. The pipeline of the dialect turns some features on (see "Pipelines"). The caller, the program or person that asks for the parse, can turn other features on, and can turn any of the dialect's features off. An alternative can begin with guards, which make it depend on features. There are two kinds of guard, gates and warnings.

A gate, `name?`, keeps the alternative only while the feature `name` is on, and `¬name?` keeps it only while the feature is off. A gate changes what the grammar accepts. A gate can also stand before an entry of a classifier (see "Classifiers"). `?` and `!` have no other use in the notation.

A warning, `name!`, keeps the alternative whether the feature is on or off. While the feature is on, a parse whose chosen tree uses the alternative carries a warning. The warning names the feature and the text that the alternative's constituent covers. A warning changes nothing that the grammar accepts or chooses. It reports where a text relies on an addition to a base grammar.

An alternative with several guards exists when all its gates hold. A name is a gate or a warning, not both. If one guard uses a name as a gate and another guard uses it as a warning, the dialect has an error. The two guards can be in any stages of the dialect. A warning has no negated form, because it keeps its alternative either way.

```jbogenbau
%rule tanru-unit-2
  | BRIVLA #
  | cbm? CMEVLA #

%redefine-rule cmavo-token
  | Cmavo<¬Cmavo-Warning>
  | y-cmavo! Cmavo<Cmavo-Warning>
```

A dialect that extends another dialect can use the two kinds for two kinds of change. An addition is a text that the base grammar rejects and the dialect accepts. A warning can mark an addition, so that a reader can learn which additions a text relies on. The bundled dialects turn none of their warnings on, so their texts parse without warnings unless the caller asks for them.

A change to how the dialect reads a text of the base cannot be a warning. The change removes the base reading, and a warning changes nothing that the grammar accepts or chooses. So a gate can guard such a change, with the base form under `¬name?` beside it. The dialect then turns the gate on, and a caller who wants the base reading turns it off.

The bundled dialects do not guard every change. The only bundled warning is `y-cmavo`, in the `cll-ebnf` dialect, so the additions of the experimental dialect carry no warning. A dialect also makes a change without a guard where a feature needs a convoluted grammar to keep the change separate. The documents of the dialect then say so.

## Stitching documents

A stage reads its input with one grammar. The loader assembles that grammar from the items of one or more documents, read in order. A later rule can change what an earlier one said. Only the order of the rules in the stage matters, not the document where each was written. There are three ways to state a rule, and each says what it expects to be there already:

- `%rule` defines a rule. It is an error if a rule of that name was defined before it in the stage.
- `%redefine-rule` replaces a rule defined before it in the stage. It is an error if none was. The earlier alternatives are gone.
- `%extend-rule` adds alternatives to a rule defined before it in the stage. It is an error if none was.

```jbogenbau
%extend-rule consonant
  "б"  :: ∅ := "b" | "в"  :: ∅ := "v"
%emits
  $

%redefine-rule text
  | ¬cbm? [{NAI}] {CMEVLA} # [joik-jek] text-1
  | [indicators & {free}] [joik-jek] text-1
```

So `%rule` never quietly replaces a rule. A misspelled name in `%redefine-rule` or `%extend-rule` is an error. So is a reference to a rule that no document defines. A misspelled `%rule` defines an additional rule that nothing reads, and the audit (gencmu's report on a grammar) reports it as unreachable.

The alternatives that an extension adds carry the extension's own clauses, not those of the base rule. The clauses of the base rule do not apply to them. So an extension says everything about what it adds. The loader, the part of gencmu that reads the documents, reports every replacement and extension: which document changed which rule. So a reader can see the effect of a dialect on its base in one place.

`%extend-rule` accepts no flags and inherits the stitched rule's flag for every added alternative. `%redefine-rule(leftmost-longest)` replaces both the alternatives and the flag. A redefinition without parentheses removes the flag. The printed audit report names a flag change alongside the replacement. Unlike clauses, the flag belongs to the whole stitched rule.

The notation has no way to remove a single alternative. A rule is small enough to restate, and a restated rule reads better than a list of deletions.

## Constants

A constant names a value that several rules use, such as a list of classes. Its name is `$` and a name that begins with a capital. By convention, the whole name is in capitals, as in `$SU-STOPS`. The loader stitches a constant as it stitches a rule, and the constant belongs to its stage.

`%const $NAME value` defines a constant. It is an error if a constant of that name was defined before it in the stage. `%redefine-const $NAME value` redefines the constant value. It is an error if no constant of that name was defined before it in the stage.

```jbogenbau
%const $SU-STOPS NIhO ∪ LU ∪ TUhE ∪ TO
%const $PAUSE " "
%redefine-const $MAGIC-WORDS $MAGIC-WORDS ∪ RAhOI ∪ GOhOI ∪ MUhOI ∪ LOhAI ∪ LEhAI
```

The first line defines a word-stage constant in `grammars/words/stream.md`. The last line extends Zantufa's magic words in `grammars/words/zantufa-stream.md`. Other dialects exclude LOhAI and LEhAI because experimental reads their bare markers as words. `$PAUSE` is the word-stage string constant `" "`, which names the phoneme pause value.

The value is a string, string set, tag set, or pattern, never a span. A closed term reads no capture or input. It contains strings, tags, patterns, `∅`, constants, and set operators. `.split` on closed strings is closed too. Input methods, `.classify`, and guarded terms are errors here. Classifiers depend on features, but constants do not.

A tag-set constant cannot hold an engine-tag literal, even inside a filter. A pattern constant can read engine tags as terminal atoms or tag requirements.

Inside a `%redefine-const`, the constant's own name is its value before the redefinition. So one redefinition can extend a set with `∪`, narrow it with `∩` or `∖`, or replace it. A redefinition keeps the type of the value, so a set cannot become a string. That type also gives `∅` its kind. So `%redefine-const $A ∅` makes a set empty, but `%const $E ∅` is an error.

Every user constant reference uses its name's final definition in the stitched stage. Other names can refer forward. After `%const $A A`, `%const $B $A` and `%redefine-const $A B`, both final values are `B`.

Inside `%redefine-const $X EXPR`, `$X` denotes X's immediately previous definition. This exception applies throughout EXPR, including nested patterns. It does not pass through another constant. A previous definition's other names still use their final definitions.

Each declaration creates a version, an immutable definition of one constant. The loader resolves lexical self-references to the preceding version and all other references to final versions. It rejects unknown names, dependency cycles and type changes across every definition, including replaced definitions. A cycle error names its dependency path and source positions.

A constant stands wherever its type is required. A string constant can be a terminal or range endpoint in a body. A tag-set constant belongs in terms and tag tests. A pattern constant belongs in patterns. A never-defined constant is an error, including in a replaced definition. `%rule digit "0".."9"` names a scalar interval.

The loader gives the constants their values when it stitches each stage. So a document that several dialects include takes the values of each dialect. The loader reports a constant error at its reference or incorrect definition. The reader reports an engine-tag literal outside a pattern at that literal.

### Strings and engine constants

A constant starts with `$` and a capitalized user name. A capture starts with `$` and a lowercase name. Engine constants start with `$_` and four to six uppercase hexadecimal digits. A grammar cannot define or redefine an engine constant.

Outside include paths, strings interpolate only string constants. A dollar sign starting neither `$$` nor `$(` is a document error, including a final lone dollar sign. In a redefinition, `$(X)` follows the same immediately preceding self-definition rule as `$X`.

An include path is the first and only operand that `%include` takes, in straight double quotes. In it, `$` is an ordinary character. Neither `$(NAME)` nor `$$` receives special treatment. Later quoted operands use ordinary string decoding. A backslash is still a lexical error. `%include "a$b.md"` names `a$b.md`, and `%include "a$$b.md"` names `a$$b.md`.

```jbogenbau
%const $ACCENTED "a$(_0301)"
%const $QUOTED "$(_0022)Hello!$(_0022)"
%const $DOLLAR "$$"
%const $PIECES "a b".split(" ")
```

## Tree patterns

A predicate is a test that holds or fails. A tree pattern is a predicate on one constructed constituent. A pattern literal is `@(BODY)`. `$x ≅ PATTERN` tests the captured constituent, and `$ ≅ PATTERN` tests the enclosing candidate. `≇` negates that answer after the ordinary missing-capture simplification. Patterns never recognize the captured text again or inspect another reading.

The left operand must be a bare capture. The right operand must have pattern type. For `$x ≅ NAME`, report at NAME: `tree comparison requires a pattern; write @(NAME), not NAME`. Substitute the actual name, including capital-initial terminals. The same diagnostic applies to `≇`, before a generic parse or type error.

### The structural tree

Patterns observe named rules, terminal reads, and omitted terminators before bracket output collapses unary nodes. Generated helpers flatten their children in order. Named chain levels retain their nodes. An absent plain optional contributes no child. Recipes do not change this structural observation.

A terminal leaf records the terminal that read it, rather than every tag on its token. A literal, engine constant, and equal string constant share one terminal identity. An omitted T contributes one leaf labeled T, with empty value and pattern tags `{T}`. Its empty span does not remove it. This leaf adds no tags to the empty helper or the enclosing constituent.

A structurally empty node contains no terminal read, omitted marker, or seal. Parent sequences remove structurally empty named children, including empty `#` nodes and empty wrappers. The [seal of a ranked choice](#ranked-choices) counts as a leaf here. A node that contains a seal remains in its parent sequence. A direct capture of an empty named rule retains its named root for a root-name test.

A primitive predicate first tests the current node, then can follow its sole structural child. This single-child transparency repeats only while exactly one child exists. A branching node stops it. A child-sequence predicate uses the same search, and tests each visited node's complete ordered children.

Thus `@(sumti)` accepts a sumti or its unary wrappers. It rejects a connection, a tag followed by a sumti, and a sumti beside an omitted terminator. Set operations combine each predicate's complete answer on the same candidate. `P ∖ Q` means P holds and the whole predicate Q fails on the same candidate.

### Pattern forms and binding

| Form | Meaning |
| --- | --- |
| `@(sumti)` | A rule named sumti through single-child wrappers |
| `@(KEhE)` | A KEhE leaf, written or omitted |
| `@(KEhE="")` | A KEhE leaf with empty value |
| `@(KEhE≠"")` | A KEhE leaf with nonempty value |
| `@([KEhE])` | Zero or one KEhE child |
| `@(KE ⋯ KEhE)` | A complete child sequence with required endpoints |
| `@(A B)` | Two children, each with its own unary search |
| `@(A ⋯ B ⋯ C)` | Ordered children with arbitrary sibling gaps |
| `@(⋮ P)` | P at an endpoint of any downward path |
| `@(P ⋰)` | P at an endpoint of the first-child path |
| `@(⋱ P)` | P at an endpoint of the last-child path |
| `@(P ∪ Q)` | Either predicate on the candidate |
| `@(P ∩ Q)` | Both predicates on the candidate |
| `@(P ∖ Q)` | P holds and Q fails |
| `@({P})` | A complete sequence of one or more P children |
| `@({P / S})` | One or more P children separated by S |
| `@([P Q])` | An optional sequence of those two children |

A capitalized or engine tag denotes its tag terminal. A string, string constant, range, or `_` denotes its terminal identity. Other names, including `#`, denote named rules. A pattern constant denotes its predicate.

A string constant atom can carry tag and value tests, as in `@$S="x"`. A tested constant that resolves to a pattern is a document error. A nested literal denotes one predicate on a subtree. `@sumti`, `@KEhE`, `@"a"`, and `@$P` abbreviate their single-atom literals.

Juxtaposition describes a complete child sequence. A single node predicate instead tests the current node. An optional or repetition always describes a child sequence. Brackets keep their ordinary optional meaning, including `[T]`, `[(T)]` and `[#]`. They never mean an omitted terminal.

`⋯` consumes zero or more siblings at one level. It never descends. Multiple sibling gaps are legal, including empty gaps. Each path permits zero or more edges and can stop before a leaf. First and last children follow helper flattening and empty-child removal.

An omitted terminator is a child like a written one. When it is the last child, a last-child path reaches it and never passes it to an earlier sibling.

Binding is primary, path, sequence, intersection, then union or difference, from strongest to weakest. Intersection associates left. Union and difference share precedence and associate left. First-path `⋰` follows one primary, while descendant `⋮` and last-path `⋱` precede one primary. Chained paths and optional operands require parentheses or a nested literal.

Flatten every union operand that is itself a union. Thus `@(A ∪ (B ∪ C))` has one union with three operands in written order. Intersection and difference retain their operands.

`@(A ⋰ B)` tests two children, the first through `A ⋰`. `@((A B) ⋰)` searches for a node with children A and B. `@(NAhE ⋰ ∪ SE)` puts only NAhE under the path. `@((NAhE ∪ SE) ⋰)` puts both alternatives under it. `@(A ⋰ ⋱ B)` applies first-path to A and last-path to B.

Plain parentheses preserve sibling grouping without a subtree boundary. `@(A (B C))` therefore has three children. `@(A @(B C))` has two children. At a path or set boundary, a sequence becomes one child-sequence predicate. A set expression within a sequence consumes one child.

One tag test followed by one value test can follow a terminal atom. Its value or tags must belong to the same matched leaf. Written leaves use their original token's value and tags. Omitted T leaves use empty value and `{T}`, including during reconstruction. A written token with empty value also satisfies `T=""`.

A terminal atom accepts one signed tag test and one exact value test, in that order. Rule predicates accept none. Pattern set operators combine complete predicates and cannot mix them with tag sets. `∅` obtains pattern type from context. An untyped `%const $EMPTY ∅` remains an error. `@A<B>` keeps the test inside and means `@(A<B>)`.

Likewise, `@A<B>=""` means `@(A<B>="")`.

Patterns reject `&`, `|`, captures, emissions, alternative tags, feature guards, elision markers, chain repetitions and direct chained path prefixes. Braces keep one-or-more sequence behavior and their separator syntax. A repeat body that only matches empty sequences is an error. A sibling ellipsis cannot be a repeat item or separator. Patterns cannot contain recursive constants.

## Classifiers

A classifier gives a value its classes. A cmavo is a particle, a short structure word. A lexicon is a classifier: it gives each cmavo its selma'o. `%classifier` and a name start a classifier, and its entries follow:

```jbogenbau
%classifier lexicon
  "mi" "do" "ko'a" "ko'e" ∈ KOhA
  "ui" "u'i" ∈ UI
  "de'i" "ti'u" ∈ BAI

%classifier lexicon
  date-li? "de'i" "na'a" "ti'u" ∈ LI
  date-li? "de'i" "ti'u" ∉ BAI
```

An entry is one or more keys, `∈` or `∉`, and one class. A `%classifier` can also have no entries. A key is a string. `∈` adds the class to each key, and `∉` removes it from each key. A word in several classes has several entries.

Line breaks mean nothing here, as everywhere in the notation. An entry ends after its class, and by convention each entry stands on a line of its own.

A key is an exact string, with no engine normalization. The forms-stage lexicon writes keys in the normalized values that it receives. `"Mi"` and `"ko,a"` are legal distinct keys. A class starts and ends with a capital and never starts with `_`. `KOhA` is a class, while `Indicator` is not.

An entry can begin with gates, as an alternative can (see "Feature guards"). An entry whose gates do not all hold does nothing. A warning on an entry is an error.

The name of a classifier begins with a lower-case letter. A classifier belongs to its stage, as a rule does. Every `%classifier` of one name in a stage adds entries to one classifier. gencmu applies the entries in the order of the stage, whatever documents they come from. A key has the classes that hold after the last entry.

An entry that adds a class that a key already has is an error. So is an entry that removes a class that a key does not have. These errors depend on the features, so they are errors of the grammar. gencmu reports one at its entry, for a parse that turns on the features that make it. A mistake in how an entry is written is an error of the document, even where the entry's gates do not hold.

`string.classify(classifier)` (see "Conditions") is the set of the classes that the classifier gives the string. It is empty for a string that no entry names. A `classify` that names a classifier that no `%classifier` of the stage declares is an error. `span.tags(rule)` is still the way to ask a rule for the tags of a span, as `brivla-shape` asks `brivla-scan` in the CLL word forms.

The audit data lists every membership change, with its key, class, gates and document. The printed report shows the gated memberships and those that more than one entry changes.

## Implications

An implication says that some tags bring other tags with them:

```jbogenbau
%implies UI ∪ CAI ∪ DAhO ∪ FUhE ∪ FUhO ⟹ Indicator
```

`%implies A ⟹ B` says that each token that the stage emits with a tag of `A` also carries every tag of `B`. `A` and `B` are tag sets. Each is a closed term, as a constant's value is (see "Constants"). A constant in them has its final value, as in a rule.

The stage applies its implications when it emits a token. First it gives the token the tags that the emission gives it (see "Emission"). Then it adds `B` for each implication whose `A` shares a tag with the token. It repeats this until no tag changes. So implications chain, and a cycle ends, because an implication only adds tags.

Implications change only emitted tags. They never supply or alter a value or image. Neither side of `%implies` can name an engine tag. Recipes and plain concatenation determine token strings independently.

Implications apply only to the tokens that the stage emits. They do not change a constituent's tags, the value of a term or the classes of a classifier. A later stage applies only its own implications. So the lexicon's implication in the forms stage marks each word of these classes `Indicator`. The word stage can drop that mark from a quote's marker, and nothing adds it again.

## Captures

Writing `$name:symbol` captures one symbol of a body. The symbol can carry a tag test followed by a value test. A capture gives the matched part a name for conditions, tags, and recipes. Its name starts lowercase and contains lowercase letters, digits, hyphens, or underscores.

A capture wraps one symbol. That symbol can stand anywhere in an alternative, except inside braces and inside an elidable optional, `[+ ]`. So a capture can stand in a group, in a choice, in an item of `&` and in a plain optional, at any depth.

A name can stand at most once in each production (below), so two branches of a choice can capture one name, as two alternatives can. `A ($x:B | $x:C)` is valid, but `[$x:A] $x:B` and `$x:A & $x:B` are errors, because one of their productions reads `$x` twice. Before gates apply, gencmu makes sure that each capture name occurs at most once per production. A guard does not excuse a repeated capture. An alternative can have any number of captures, but each one has a cost (below). `$` alone is the whole constituent, a capture that every alternative has without writing it.

A capture cannot wrap anything but one symbol. So `$x:(a | b)`, `$x:(a b)` and `$x:[a]` are errors. A capture names one constituent, with one span and one set of tags, and a group or an optional is no constituent. To capture a choice or sequence, define a rule for it. Then capture the reference.

To capture a part that can be absent, write the capture inside the optional, as in `[$x:a]`. A presence test then says whether the part is there.

A capture cannot wrap braces, and braces cannot hold a capture. A list is not a constituent, so no capture can name its span. A part of a list or of a chain repeats, so one name cannot stand for all its parts. To capture a list or chain, define a rule for it. Capture its reference, as in `$t:tag`.

An elidable optional cannot hold a capture, at any depth. gencmu restores an elided terminator as the terminator alone (see "Elided terminators"), and it keeps the optional as one unit for that. A part inside it is there in some readings of one omission and not in others.

gencmu expands each alternative into productions, as engine §3 says. A production is one way to read the alternative. It reads one branch of each choice and one subsequence of each `&`, and reads each optional or not. A plain optional that holds a capture is expanded in place, as if it were `(ε | x)`. The production without it comes first, then those with it. So `A [$b:B] [$c:C]` gives four productions, in this order: `A`, `A C`, `A B` and `A B C`.

A plain optional without a capture stays one optional. It is not expanded into two productions. A production has a capture where it reads the captured symbol, and lacks it elsewhere.

Either way, a rule node holds the parts that its production reads, and an optional adds no node. A helper is an unnamed rule for an expression.

A logical symbol is one symbol of a production as written, before captures expand optionals. Each optional, flat braces, and a ranked group count as one logical symbol. The engine interprets a plain optional through one helper, with or without captures. `A [$b:B]` therefore counts as two symbols even when B is absent, and inherits no default tags. Expansion still binds captures.

A query gives a written terminator priority over an omission. For a preceding plain optional, it checks both absence and presence when looking for the written terminator. `a [$b:b] [+KU]` therefore follows the same query rule as `a [b] [+KU]`. An omission names no separate constituent that it ends. Diagnostic production numbers and recorded parse actions can follow expansion. [Engine §4](engine.md#4-recognition) defines the complete query rule.

A plain optional that holds a capture, whose content has k expansions, contributes 1 + k: the empty one and those k. A sequence multiplies these counts. So `[$b:B]` doubles the productions of its alternative, `[($a:A | B | C)]` contributes four, and `[A [$b:B]]` three, not four. Each capture can also multiply the work of the parser. The parser keeps a captured part's span with each partial reading, so readings that differ only in where a captured part ends are not merged. So a capture whose span can end in many places costs much more than one that reads a single token.

The clauses of a rule serve all its productions, and the productions need not capture the same parts. gencmu knows whether a production captured a part when it reads the grammar. A clause can refer to a capture that a production lacks. What happens then depends on the kind of clause.

The engine first decides presence tests for each production. A condition with a missing capture then does not apply. An emission item with an absent carrier drops, and an absent attachment drops alone. A recipe on a retained item needs every capture it reads. Each selected constituent recipe also needs every capture that it reads. Optional recipe cases need separate alternatives.

A tag term that uses a capture that one of its productions lacks is an error, unless `⟹` (below) guards the use. The reason is that a tag term has no value that can mean "nothing to say". An alternative's own tags serve the productions of that alternative. Definition-header tag clauses serve every production of that definition. The tags of an emitted item serve every production that has the item.

A reference to a capture is an error when no alternative of the rule or extension captures that name. It is also an error to write a condition or an item of `%emits` that applies to no production. Each of these is a mistake, such as a misspelled name.

A constant counts in these rules as its value. So where `$E` is empty, `$E ∩ $x.tags` is empty and uses no capture. gencmu makes sure that such a clause meets these rules when it stitches the stage. Only then does the constant have a value.

`$x`, standing as a condition, is a presence test: it says whether the production captured `x`. gencmu also knows this when it reads the grammar. `$` alone is always true. gencmu decides a presence test for each production before anything else, so it is not a use of the capture. So `%conditions $x` applies to every production, and removes those that do not capture `x`.

`A ⟹ B`, where `A` is a condition, is `B` where `A` holds. As a condition, it is `B` where `A` holds, and true elsewhere. As a tag term, it is the tags of `B` where `A` holds, and no tags elsewhere. So a tag term that is only for the alternatives with a certain capture says so:

```jbogenbau
%rule word :: Word ∪ ($c ⟹ $c.value.classify(lexicon))
  | $c:cmavo-shape :: Cmavo
  | brivla-shape :: BRIVLA

```

### The capture rule

A capture changes nothing about how its rule is interpreted. Plain optionals retain one helper for ranking, inheritance, ranked tag safety, and written-terminator query priority. Expansion binds their captures but does not determine those four behaviors.

Diagnostic bookkeeping can follow expansion. Production numbers, witness action lists, reported tied pairs and their order, and elision-only competitors can differ. None of these diagnostic choices changes a verdict, accepted tree, tags, ranking, or query eligibility.

## Conditions

`%conditions` lists what must hold of a rule's captured parts, separated by commas. A parse in which a condition fails does not exist. The parser evaluates each condition as soon as it reads the last capture that the condition mentions. It evaluates a condition that mentions `$` when the constituent is complete.

Each condition of the list applies to the productions that capture everything it mentions, and to no other production. A production is one expanded sequence of an alternative (see "Captures"). So `A [$b:B]` has two productions, and a condition that mentions `$b` applies only to the one that reads `B`. One rule can also state a condition for the productions that have a quote body, and none for those that do not:

```jbogenbau
%rule zoi-quote
  | zoi-marker gap $open:word PAUSE $content:body PAUSE $close:word
  | empty-zoi-quote
%conditions
  $open = $close,
  $open.value ∉ $content.value.split($PAUSE)
```

Within one condition of the list, `∧` and `∨` join conditions, and `∧` binds tighter. `⟹` binds looser than both, and groups to the right. Parentheses group, and `¬` negates the condition after it.

A method chain applies successive methods to one receiver. `¬` applies to the whole chain. `¬$s.without-elision.onward.begins(tag)` says that no `tag` begins there. It does not test whether `$s` is absent.

The parser evaluates a condition joined with `∧` only when it can evaluate all its parts. So two conditions about different parts are better as two items of the list. The parser then evaluates each one as early as it can.

In `=` and `≠`, a capture or span converts to its input value on either or both sides. `$open = $close` therefore compares the two captured values. A capture compared with a tag set or string set remains a document error.

A condition term has five types: captures or spans, strings, string sets, tag sets, and patterns. Captures and ordinary or restored spans retain their distinct receiver types. Method selection precedes conversion of a capture or span to its input value where a string is required. Captures never convert to tags or patterns. A bare capture as a condition tests presence.

The first type includes spans, sequences of tokens. A capture `$x` retains its matched constituent and its input span. `$` spans the whole constituent. `$x.first-token` is its first token, `$x.tokens-after-first` the rest, and `$x.last-token` the last.

`$x.onward` runs from the capture's start to its context end. `$x.following-tokens` runs from its end to that boundary. Both can look past the constituent. Ordinary nested query bounds end at their input span. Spans can supply query receivers or convert to input strings. They never supply constituent tags after a span method.

The string type includes `$x.value`, the exact concatenation of input token values. `$x.image` concatenates their stored images. Both observations ignore the current stage's chosen emission and include erased input. No observation lowercases values, removes commas, or changes pause spacing. A grammar normalization stage supplies the comparison policy.

The next paragraph uses four more Lojban terms. A gismu is a root word. A lujvo is a compound word. A fu'ivla is a borrowed word. A cmevla is a proper name.

In the `cll-ebnf` dialect, a comma between two vowels marks a syllable break, as CLL 3.3 describes. In that dialect, a cmavo, a gismu or a lujvo has no comma between two vowels. A fu'ivla or a cmevla can have one, as in the cmevla `nu,iork`. Without its commas and with its capitals lowered, a fu'ivla must still be a fu'ivla, and a cmevla must still be a cmevla. For example, the fu'ivla `zba,A,u` passes this check as `zbaau`, which is a fu'ivla, although `zbaAu` is none. So `ba,irgau` and `ma,i` are no words, because `bairgau` is a lujvo and `mai` is a cmavo.

The `kihei` dialect follows the comma rules of `cll-ebnf`. In `bpfk`, `experimental` and `zantufa`, a comma between two vowels has no effect, so `ma,i` is `mai`.

In all five bundled Lojban dialects, zoi delimiters compare exact normalized values. Their normalization stage maps syllable comma values to empty while preserving the Syllable-Break tag. The forms stage retains dialect-specific comma restrictions. `nuiork` and `nu,iork` therefore compare equally when both delimiters are valid.

`span.source-text` is the original text that the span covers. A string in double quotes, such as `"la"`, is a string literal. Where a condition compares one word's value with a literal, as in `$l.value = "la"`, a test says it in the body: `LA="la"`.

The third type is the set of strings. `string.split(delimiter)` is the set of the pieces of the string between the occurrences of the delimiter. It reads the string from the left, and two occurrences never overlap. It drops the empty pieces.

So `$content.value.split($PAUSE)` is the set of the runs of `$content`, the stretches between its pauses. Then `$open.value ∉ $content.value.split($PAUSE)` says that the word `$open` is not one of those runs. A run can hold several words: a text writes `lemiklama` as one run.

An empty delimiter is an error. It is an error of the document when the reader sees it, as `""` or a constant. Otherwise it is an error of the grammar, when a parse meets it.

A tag literal denotes a singleton tag set. `UI ∪ CAI` contains both tags and `Indicator` denotes that mark. Ranges are terminals only and cannot form condition sets. `_L ⊆ $c.tags` tests the stored letter property. A scalar-range condition needs a grammar query over the corresponding range terminal.

A whole capture's `.tags` reads its constituent tags. Another span, such as `$x.first-token`, unions its input token tags. `.tags(rule)` unions eligible whole-query readings and is empty without a match. `.classes` filters the same tag set for names starting and ending with capitals and never starting with `_`.

`string.classify(classifier)` is the set of the classes that a classifier gives the string (see "Classifiers"). It is empty for a string that the classifier does not know. The method argument is a bare name, which names a classifier of the stage. So `$c.value.classify(lexicon)` is the set of the classes of the word `$c`.

Every tag name is written in grammar text. No method constructs tags from an input string. Y delimiter keys use fixed tags `Y-Key` and `Ieho`. A value can retain input text when a comparison needs it.

`∪`, `∩` and `∖` are union, intersection and difference. Each applies to two sets of one kind: two sets of strings, or two tag sets. `∩` binds tighter than `∪` and `∖`. Those two bind equally and group from the left, so `A ∖ B ∪ C` is `(A ∖ B) ∪ C`. `∅` is the empty set, and its context gives its kind. An expression whose kind nothing gives, such as `∅ = ∅`, is an error.

The predicates are:

- `=` and `≠` compare two strings, two sets of strings or two tag sets. Any other pair is an error.
- `∈` and `∉` test whether a string is in a set of strings.
- `⊆` and `⊈` test whether one set is in another of the same kind. So `Indicator ⊆ $i.tags` says that `$i` carries the mark `Indicator`, and `Indicator ⊈ $i.tags` says that it does not.
- `≅` holds when a bare capture, or `$`, matches a tree pattern (see "Tree patterns"). `≇` holds when it does not. Any other pair is an error.
- `$x` holds when the production has the capture `x`.
- `span.matches(rule)` holds when the span parses as the named rule.
- `span.begins(rule)` holds when some prefix of the span parses as the rule. The empty prefix counts.
- `span.starts-input` holds when the span begins where the parser's input begins.

For an ordinary span, `matches` and `span.tags(rule)` parse the captured span alone, as the named rule, with the same grammar. This is how gencmu states CLL's slinku'i test for fu'ivla. A CV cmavo is a particle of one consonant and one vowel. The test says that such a cmavo before a fu'ivla must not make a lujvo. That is `¬$f.matches(lujvo-after-cv)`, because the rule is the part of a lujvo after its first two letters.

Inside such a parse, a condition can ask about the very span that is being parsed, as the same rule. Such a condition defines the rule in terms of itself over the same text, negated or not. The parser reports it as an error of the grammar.

Every nested query, whether `matches`, `begins` or `tags`, follows written-terminator priority (engine §4). A nested reading cannot leave out an elidable optional where the same construct can read that whole optional as written. In the Zantufa dialect, `cy to roi toi klama` gives `([cy {to roi toi}] klama)`. A nested `tag` cannot read `cy to roi` as `cy roi` with an empty parenthesis, because the parenthesis can read on to its written `toi`.

In the same way, the experimental dialect gives `(mi [klama {na (to broda toi)}])` for `mi klama na to broda toi`. There `broda` stays inside the parenthesis. The priority has a cost: a positive query can fail where a parse without it succeeds. Take `r → A c [+T] T` and `c → B`. Then `matches` of `r` over `A B T` fails, because `[+T]` takes the written `T`. Several readings that the priority keeps do not cause an ambiguity error.

A lookahead tests a rule without reading the input. A PEG is a grammar that tries alternatives in order. PEG is short for parsing expression grammar. `begins` with `.onward` or `.following-tokens` is a lookahead, like the lookahead of a PEG.

`$f.following-tokens.begins(post-word)` says that what follows `$f` begins with a `post-word`. That `post-word` can lie in the words after the constituent. `¬$f.onward.begins(cmevla)` says that no `cmevla` begins where `$f` begins, as a PEG's `!cmevla` before `$f` does.

The word forms of the BPFK (a Lojban committee for language definitions), the `bpfk` word grammar, use these to translate their PEG rule by rule. The nested parse of `begins` reads only as far as the rule can read. So a lookahead costs what reading the rule costs, however long the rest of the input is.

`.starts-input` lets a rule begin only at the start of the input. The rule below matches nothing, and its condition holds only where the input begins. So an alternative that starts with `text-start` is read there and nowhere else. The parser evaluates the condition before it looks further, so such an alternative costs nothing at the other positions. In a nested parse, the input is the span being parsed, so `.starts-input` holds at the span's start.

```jbogenbau
%rule text-start
  ε
%conditions
  $.starts-input
```

`$x.without-elision` restores the terminators omitted inside `$x` for a query that preserves those closes.

An elision is an omitted terminator. A close is one omission at an input boundary. A candidate is one constructed reading. A witness is a reading that satisfies a query. Aligned readings keep the same ordered closes at shared boundaries.

The receiver must be one bare capture, including `$` for the completed enclosing constituent. `$x.onward.without-elision` is an error. The extended form is `$x.without-elision.onward`.

A synthetic token is a token inserted for restoration. Each such token records its omitted terminal and original boundary.

The span keeps the captured words and the candidate's closes. It restores each close as a synthetic token. Original tokens keep their fields and identity. Morphology does not run again. Caller-owned omissions contribute no close, even at the captured endpoint.

`$x.without-elision.matches(R)` asks for an aligned witness over the complete capture. `$x.without-elision.begins(R)` permits a witness that ends within the capture. `$x.without-elision.onward.begins(R)` also permits a witness that ends after the capture. Following words remain raw input and permit ordinary omissions after the captured endpoint.

Inside the shared stretch, the witness cannot add, drop, move, or reorder closes. At its end, a prefix must match the complete group of closes at that boundary. A restored terminator cannot supply a bare terminal read. The witness must qualify on the original input before ranked admission. Its conditions and written-terminator priority can inspect following words beyond the capture.

A seal hides the content of a ranked group. Common entry observations describe state before the ranked group. An outside restoration view keeps that group as an opaque block with its common entry observations. The witness must keep the same block and cannot end inside it. A private capture inside an option keeps its own closes for conditions ready within the group.

Projection maps restored positions back to original input positions.

`.onward` preserves the restoration view, including through repeated calls. Other span methods first project to original tokens and return ordinary spans. `$x.without-elision.following-tokens` therefore reads the raw suffix. `.first-token`, `.tokens-after-first`, and `.last-token` expose original tokens.

`.source-text`, `.value`, `.starts-input`, and `.tags` also observe original tokens. The restored span carries no constituent tags. `.tags(rule)` unions the tags of its aligned whole witnesses.

For example, these rules hold an omitted BOI fixed:

```jbogenbau
%rule text
  $x:candidate
%conditions
  $x.without-elision.matches(rival)

%rule candidate
  LETTER [+BOI]

%rule rival
  LETTER [+BOI]
```

On one LETTER token with text `my`, the candidate omits BOI at its end. The restored view contains the original `my` token followed by a synthetic BOI token. The rival omits the same BOI at the same boundary, so the query holds. Changing the rival to `LETTER BOI` makes the query fail. The restored token cannot create a required written BOI on the original input.

An ordinary nested query inside an aligned witness reads its original projected span with ordinary query rules. An explicit nested `$y.without-elision` fixes the witness's own captured closes. It restores no token twice. Recursive queries keep the existing grammar error across query forms and restoration views. Engine §4 gives the exact bounds, proof rules, and cache identity.

## Juxtaposition

Juxtaposition places expressions beside each other without an operator. Its meaning follows position and type.

| Position or kind | Meaning | Example |
| --- | --- | --- |
| A body | Sequence | `"b" c` |
| Inside `@(…)` | Child sequence | `@(A B ∪ C)` |
| A tag test | All requirements | `<Stressed ¬Syllable-Break>` |
| A tag-set term | One union atom of bare tag names | `:: Word BRIVLA` |
| A recipe | String concatenation | `:= $a.value " " $b.value` |
| A classifier entry | Separate keys | `"mi" "do" ∈ KOhA` |
| Directive operands | A list | `%features cbm su-boundary` |
| Other tag-set atoms | Error | `:: $m.tags Word` |
| Strings in conditions or constants | Error | `%const $X "a" "b"` |
| String sets | Error | `$S $T` |
| Patterns outside a literal | Error | `%const $P @(A) @(B)` |

A run of bare tag names can stand alone or beside `∪`. It requires parentheses when the operator token immediately before or after it is `∩` or `∖`. A leading `∩` counts. Spaces and comments do not affect this adjacency. `(Word BY) ∩ $l.tags` is legal. `Word BY ∩ $l.tags` and `:: ∩ Word BY` are errors at `Word`.

`A ∪ B C ∖ D` is an error at `B`. Any union operand that is itself a union flattens into its enclosing union in written order. This applies to runs and explicit `∪`, including either form inside grouping parentheses. Parentheses make no DOM node. Intersection and difference retain their operands. Other atoms require explicit operators.

`A ∪ (B ∪ C)`, `A ∪ (B C)`, `A ∪ B ∪ C`, and `A B C` give one union with three operands in written order. `(A ∪ B) ∩ C` keeps the union as one intersection operand. A leading `∪` inside a parenthesized run does not change its DOM.

Inside a pattern literal, sequence binds more tightly than set operators. `@(A B ∩ C)` is legal. Outside it, set operators combine two tag sets, two string sets, or two patterns. Mixed or unresolved types are errors. A string is not a string set, so `"a" ∪ "b"` is an error.

## Tags

Every token and every constituent carries a set of tags, and a terminal matches a token by tag. So the tags that a grammar gives its constituents are the terminals of the grammar of the next stage. A rule uses tag terms to say what tags its constituents carry. A `::` clause after an alternative supplies that alternative's tags. A `::` clause on the header serves every alternative of that definition. Where both are written, a constituent's tags are the union of the two:

```jbogenbau
%rule source-word :: Word
  | $b:brivla-shape  :: BRIVLA ∪ $b.tags
  | $n:cmevla-shape  :: CMEVLA ∪ $n.tags


%rule cmavo :: Cmavo ∪ $w.value.classify(lexicon)
  | $w:cmavo-shape

```

Sometimes no tags are written at all, neither on the alternative nor on its header. Then a constituent built from one symbol has that symbol's tags, and a constituent built from several symbols has none. So a rule `word` whose body is `cmavo | brivla | cmevla` needs no tags. A `mi` arrives at the next stage tagged by the chain of rules that built it.

Each optional, flat braces, and a ranked group count as one logical symbol here. If an optional or flat braces reads one logical symbol, it has that symbol's tags. Otherwise it has none. Ranked groups follow the restrictions in "Ranked choices". So `%rule terms {terms-1}` over one `terms-1` has its tags, and over two has none. An empty optional has none.

A chain's levels follow the same inheritance rule. Plain optionals keep their own helper, including when they hold captures. An absent optional has empty tags. A present optional counts its content's symbols as if no captures were written. Ranking, ranked tag safety, and query priority use that same structure.

A tag term that defines a constituent's tags cannot be made of those tags. So `$.tags` and `$.classes` are errors in a rule's or an alternative's tag term. `$.tags(rule)` and `$.value.classify(lexicon)` are not errors there. The first parses the constituent's tokens again, and the second reads their value. The tag term of an emitted item does not define the constituent's tags, so it can use `$.tags` and `$.classes`.

## Emission

The stage walks a rule with no `%emits`. What it hands to the next stage is what its parts hand on, in order. A token that it reads directly hands on nothing. A rule with `%emits` hands on exactly what the list says, in the order that the list says it. The stage walks nothing else of the constituent.

Bare `%emits` means `%emits $`, one covering token for the whole constituent. A clauses-only form, such as `%emits := "x"`, applies those clauses to the implicit `$` item. No `%emits` instead walks emitting descendants. `%emits ε` inserts an empty-span token rather than covering the constituent.

| Rule on input `a` | Output |
| --- | --- |
| `%rule unit "a"` | No token, because the directly read terminal emits nothing |
| `%rule unit "a" %emits` | One covering token with value and image `a` |
| `%rule unit "a" %emits := "x"` | One covering token with value and image `x` |
| `%rule unit "a" %emits ε` | One inserted token with empty value and image |

An item of the list can be a capture. The stage hands a capture on as one token. The token has the captured part's tags, or the tags of its explicit `::` clause.

An item can also be `ε`, which inserts an ordinary token with an empty span. Its default tags and strings are empty. Explicit clauses supply its tags, value, and image. `%emits "foo"`, a bare range, or a property as an item is an error. Capture and attachment order must agree with every production.

`$` is the whole constituent. Its item emits one covering token. `%emits $ :: ∅ := "n", ε :: ∅ := "o"` makes the digit 0 two phoneme tokens. Only the first covers input. Covering carriers must be disjoint in stage-input positions. Two whole items coexist only over a structurally always-empty constituent.

An inserted item stands in its written order and records `insertedBy`. `%emits ε :: ∅ := "'", $v` inserts an apostrophe before the vowel. An item can have empty tags because string terminals and `_` can read it. Engine §11 defines anchors near absent attachments and carriers.

`%erased` hands on nothing and removes the constituent from counted parts. `broda brode si bu` emits the letter word `broda bu` because `si` erases the preceding word. The token's source still spans the erased text. Its strings exclude that text. `%emits ε` instead inserts a token and never erases.

A capture item can carry attachments: other tokens that belong to its token, which no later stage reads. Each attachment is a capture in parentheses, before the item or after it, and an item can have any number on each side. The item's own capture is its carrier, and it must be a named capture. Neither a `$` item nor an inserted `ε` item can name attachment captures. `($)` is an error.

```jbogenbau
%rule item :: $w.tags
  | $w:unit | $b:bahe-run $w:unit | $w:unit $a:indicator-run | $b:bahe-run $w:unit $a:indicator-run

%emits
  ($b) $w ($a)
```

The carrier's token covers its own capture only. An attachment is the list of tokens that its captured part hands on, as if the stage walked that part. So `mi ui klama` hands on `mi` with `ui` attached after it, and the next stage reads `mi klama`. The carrier does not run the emission of its own part. So a structure inside the carrier's part stays only where the item captures it separately.

An attachment capture stands in exactly one item, and never as an item of its own. A production without the carrier emits nothing for the item, and it must also lack the item's attachment captures. The captures of an emission, attachments included, must be written in the order in which each production reads them.

A production reads each name at most once, so each name is one part of it and the order is clear. Two productions can read names in different orders, as in `($a:A $b:B | $b:B $a:A)`. Then no order of `$a` and `$b` fits both, and an emission of both is an error. Where a production lacks an attachment capture, the item has one attachment fewer.

The compact form `[$b:bahe-run] $w:unit [$a:indicator-run]` has the same capture bindings and emission order as the four alternatives. Its expansions supply `$w`, `$w $a`, `$b $w`, and `$b $w $a`, in that order (see "Captures"). This equivalence concerns captures and emission, rather than ranking.

Introducing these optionals changes logical symbol counts. The explicit `$w:unit` alternative has one logical symbol and a transparent close. The compact alternative retains three logical symbols even when both optionals are absent, so its close is visible. A lazy comparison can therefore resolve readings that the explicit alternatives leave tied. Adding a capture inside an existing optional remains neutral.

A forwarded token keeps attachments. A covering token over one counted input token inherits its attachments, whatever tags or strings recipes assign. Combining that input token with another counted part is a grammar error. Empty strings do not remove counted parts. Disjoint carriers and attachment captures prevent two emitted tokens from inheriting the same attachment.

No condition, test or method sees attachments, and neither does a terminal. The renderings show them with their token.

A part that an emission list does not name remains a counted part, although it emits nothing. A pause inside a quote can therefore contribute to a compound through its gap recipe. A rule without `%emits` can emit nothing but still count. Only `%erased` removes its contribution and ownership.

```jbogenbau
%rule plain-word
  cmavo | brivla | cmevla
%emits
  $

%rule quoted-word
  $m:zo-marker gap $w:quotable-word
%emits
  $m, $w :: Word

%rule erasure
  unit gap si-word
%erased
```

### Two walks and recipes

The stage fixes each emitted token's value and image through recipes or plain concatenation. It preserves `Stressed` and `Syllable-Break` as the grammar specifies. Tags never assign strings. An implication changes tags only, so it cannot introduce a stressed value or replace an image.

Default string construction concatenates non-erased input parts in order. It enters child constituents without executing their emission items. A child constituent recipe can replace its contribution separately by channel. Gap recipes supply spacing. A quote-body image recipe supplies verbatim text. No engine rule trims pauses or assigns a foreign placeholder.

A string walk builds each emitted token's two channels. It enters child constituents with `%emits` but ignores their emission lists. It skips `%erased` children. It uses a selected constituent recipe or concatenates its children. Attachment captures use their own emission walks.

Recipe priority follows this table, from strongest to weakest. A capture item's constituent supplies the alternative and rule recipes. An inserted item has no constituent.

| Rank | Value | Image |
| --- | --- | --- |
| 1 | Item `:=` | Item `:-` |
| 2 | Alternative `:=` | Image implied by item `:=` |
| 3 | Rule `:=` | Alternative `:-` |
| 4 | Child concatenation | Rule `:-` |
| 5 | | Image implied by alternative `:=` |
| 6 | | Image implied by rule `:=` |
| 7 | | Child concatenation |

At an inner constituent, only the alternative, rule, and concatenation rows apply. An item recipe affects only that item's token. An explicit constituent image recipe beats a constituent value recipe's implied image. Only an item's own `:-` beats that item's implied image.

Recipes form a closed language. They accept string literals, string constants, and these methods on a bare capture or `$`: `.value`, `.image`, `.source-text`, `.verbatim-text`, `.emitted.value`, and `.emitted.image`. Juxtaposition concatenates these terms without a separator. Every other term is a document error. A bare capture and `.emitted` without a channel are errors.

An input method reads the stage's original input tokens, including erased text. `.emitted.value` and `.emitted.image` read the string walk before the current item's override. They include constituent recipes and exclude erased parts.

Only selected recipes run. A weaker recipe runs only when another evaluated recipe reads its result. A constituent recipe cannot read its own result through `.emitted`, directly or through other recipes. Gencmu rejects this dependency even when an item recipe hides it at runtime. An item's `.emitted` read observes its constituent before that item's override. [Engine §11.3](engine.md#113-recipe-evaluation-and-cycles) defines dependency analysis.

```jbogenbau
%rule r := $.emitted.image :- "x"
  | "a"
%emits

%rule s := "x" :- $.emitted.value
  | "a"
%emits
```

A recipe supplies a string. Both examples produce `x` on both channels. `:= $.emitted.image` without an explicit image recipe cycles through its implied image. `:= $.emitted.value "x"` cycles directly. An item override leaves its constituent recipe unevaluated at runtime. Constituent cycle validation still applies before item overrides.

Engine §11 defines the selected constituent dependencies.

A recipe on an erased rule or erased alternative is a document error. A parent item over an erased capture emits a token with empty strings unless its item recipe supplies them. Its counted parts remain empty. An empty string recipe on a non-erased part never erases that part.

Emission carriers cover disjoint input-token spans. Source overlap does not decide this rule. Two `$` items over a constituent that can consume input are an error. A `$` item beside a carrier or attachment capture that can consume input is an error. Structurally always-empty carriers can coexist.

Engine §9.3 defines this conservative property across every feature configuration, ignoring conditions, tests, and erasure. `$` can stand beside inserted `ε` items.

An inserted item anchors before the next covering item, skipping inserted items. For a named item, it uses the first present before-attachment or carrier. For `$`, it uses the whole constituent. Thus `%emits ε, $` anchors the insertion at the constituent's start. With no following covering item, it anchors at the constituent's end.

An inserted item whose next covering item has an absent named carrier is a document error. Thus `%emits ε, $, $e` permits an absent, structurally empty `$e` because its insertion anchors at `$`. An absent attachment changes the anchor to the next present part. The inserted token's source is empty at its anchor part's source start. An empty anchor part uses the empty-node source of [engine §12](engine.md#12-the-tree). Engine §11 defines the source at constituent end.

Attachments belong to the carrier but no later stage reads them. Ownership counts non-erased input tokens, independently of recipes. Combining an input token with attachments and another counted part causes a grammar error. An empty value or image does not remove a counted part.

## Verbatim text

A verbatim recipe returns original spelling and adjacent uncovered punctuation. `:- $.verbatim-text` belongs on the constituent that reads the body. It applies when that body emits directly and when a parent covers it. Recognition and conditions still read input values. The value channel remains independent of this image recipe.

The recipe says nothing about whether text is grammatical Lojban. A zoi body can contain valid words but still needs its written image. A non-Lojban character run instead joins stage-zero characters directly. Its values and images already preserve exact text, including `klama?` in CLL.

```jbogenbau
%rule zoi-body :- $.verbatim-text
  | zoi-part | zoi-body zoi-part
```

`zoi gy. John is a man .gy.` emits a body whose image is `John is a man`. Experimental's phoneme mappings give normalized body parts such as `jo'n is a man`. Their concatenation supplies the body value. The renderings show the image, and an exact comparison reads the value.

`.verbatim-text` extends a nonempty source envelope through adjacent uncovered text, up to neighboring stage-input tokens or text ends. Each neighbor bound limits only the extension on its own side. The method does not change the token's source or text. Different evaluated spans cannot claim the same nonempty gap. An empty span returns empty and claims nothing. Engine §11 defines overlapping and out-of-order source bounds.

At a later stage, an extension can include erased or attached text that ordinary stage-input tokens no longer cover. Bundled grammars call `.verbatim-text` only in the word stage.

Only evaluated selected recipes claim verbatim gaps. Erased descendants contribute nothing. An outer recursive body image recipe stops descendant image evaluation, while the value walk can still concatenate children. An item override suppresses runtime evaluation of weaker recipes. A recipe on an erased definition is a document error.

A later stage that forwards a token preserves its stored value, image, text, and source. It never reapplies a verbatim recipe to later neighbors. A quote image can therefore retain punctuation outside its source interval through the entire pipeline.

## Images

Every token has an image that renderings show. The stage builds it through the selected item, alternative, or definition recipe, or concatenates child images. An explicit `:-` can preserve written spelling while `:=` supplies a normalized value. Stage-zero images equal their characters. Tags never determine images.

An inserted `ε` item has an empty default image. `:= "'"` supplies an apostrophe as both value and implied image, so a shorthand apostrophe remains visible in `u'i`. An explicit item `:-` overrides that implied image. The insertion still has empty source text.

The constructor contract in [engine §9.3](engine.md#93-conversion-and-validation) defines the reader's required parts and conversion order. It covers every clause, test, method, recipe, and attachment.

## Directives

A directive is a keyword and its operands. By convention each stands in a block of its own, after prose that says why the grammar needs it. Two directives can share a line.

- `%ambiguity-resolution` ranks the best parses under rule flags, as "Ambiguity" explains. Its first operand is the ranking rule: `greedy`, `lazy` or `late-elision`. `elision-only` can follow it. "Elided terminators" explains the elision test. The operand `maximal` is an error. Every stage must say it exactly once, in any of its documents.
- No directive names the elidable terminators. Each elidable optional is marked in its place, as `[+KU]` (see "Elided terminators"). `%elidable` is not a directive. A document that writes it is an error, which the reader reports at the keyword.
- `%stage NAME`, `%include "PATH"` and `%features NAME…` build a pipeline, as the next section says.

## Normalization as a stage

A dialect normalizes with an ordinary grammar stage. The bundled Lojban pipelines place it after phonemes and before forms. It tests a value and tag together and changes only values. Token count, order, tags, images, and sources remain unchanged.

```jbogenbau
%stage normalize
%ambiguity-resolution lazy
%rule text [{unit}]
%rule unit :- $.image
  | "A"<Stressed> := "a" | "E"<Stressed> := "e"
  | "I"<Stressed> := "i" | "O"<Stressed> := "o"
  | "U"<Stressed> := "u" | "Y"<Stressed> := "y"
  | ","<Syllable-Break> := ""
  | _<¬Stressed ¬Syllable-Break>
%emits
```

The explicit image recipe preserves written images while value recipes provide normalized comparisons. A mapped tag without a supported value fails recognition. The phoneme stage emits one comma for a comma run. Forms reads its surviving Syllable-Break tag. A foreign run passes through unchanged.

## Pipelines

For a procedure with commands and tree examples, read [Implement a dialect](dialects.md).

A pipeline document, which is Markdown too, defines a dialect. Each stage is a heading, followed by the list of its documents. Prose then says what the stage receives, does and hands on. Pipeline directives in `jbogenbau` blocks say what the pipeline is made of:

````markdown
# The experimental dialect

... what the dialect is ...

```jbogenbau
%features cbm soi-clause su-boundary
```

## Stage 1: phonemes

```jbogenbau
%stage phonemes
```

- [Latin orthography](../phonemes/latin.md): what this document contributes
  ```jbogenbau
  %include "../phonemes/latin.md"
  ```

... what the stage receives, does and hands on ...
````

- `%stage NAME` creates and selects a stage called `NAME`. Stages run in creation order, and every stage starts at `text`. A second declaration of the same name is an error.
- `%extend-stage NAME` selects an earlier stage. Subsequent stage items append to that stage until another stage selector appears. An unknown name is an error.
- `%redefine-stage NAME` selects an earlier stage and clears all its accumulated stage items. The stage keeps its execution position. Subsequent items define the replacement, and later extensions append to it. An unknown name is an error.
- `%include "PATH"` stands for the rules and directives of the document at `PATH`. The loader resolves the include path against the directory of the document that holds the `%include`. It works as if their text stood in its place, so an included document can include others and can hold stage selectors and `%features` too. Each document must still be complete rules and directives on its own. A document can be included in several stages. A document that includes itself, directly or through others, is an error.
- `%features NAME…` names one or more features the dialect turns on for every parse, wherever it stands. A caller can turn other features on, and can turn any of these off.

Rules can also stand in the pipeline document itself, between its `%include` blocks. The loader stitches them in their places. A rule, a constant, a classifier, an implication or a stage-level directive before the first `%stage` is an error. So are two stages of one name and a stage with no rules.

Stage selection continues across grammar blocks and include boundaries. Returning from an include does not restore the earlier selection. Replacement clears rules, constants, classifiers, implications, and the ambiguity policy. It does not clear global `%features` or other stages. The loader reads every included document, but it evaluates only the surviving stage definitions. A missing ambiguity policy or an invalid final grammar gives the usual grammar error.

By convention, each document keeps its link in the prose, and its `%include` follows in a block of its own, in the same list item. So the pipeline reads as hyperlinked prose. A block's fence can be indented by up to three spaces, so a block can stand under a list item, indented by two. The reader knows no other Markdown container.

The layout is a matter of style, and the notation does not require it. An `%include` can stand in any block, between any two rules or directives. `tools/sync.js --check` makes sure that the bundled pipelines keep the style.

Stage zero supplies one token for each character with that character as value and image. The configured Unicode table assigns its general category, major category, and applicable `_White_Space`. The first grammar can read strings, scalar ranges, or stored engine tags. Every later stage reads emitted tokens, with no engine normalization.

`node lib/js/cli.js stitch --dialect NAME` prints a dialect's pipeline as one jbogenbau text. The command replaces every `%include` with what it stands for, and puts the dialect's features in one `%features` at the top. Each run of rules from one document follows a comment naming it. A classifier stands as its author wrote it, entry by entry, and not as the table that its entries make.

## Ambiguity

Ranked choices filter parses before the ranking below.

Filtering only removes parses and never adds one. Compared with the same grammar without this filtering, a tie can become `resolved` or `unique`. A `resolved` result can become `unique` or a tie. Filtering never changes a unique result.

Ranked choices supply seals as well as filtering. A unique tree can differ between grammars with and without these seals.

A newly resolved result reaches emission and the enabled elision-only check. A newly tied result reaches neither, has no chosen tree, output or warnings, and stops later stages.

A grammar ranks every admitted parse. A flagged span is a flagged occurrence's span. A rule profile counts flagged occurrences over each nonempty span.

`leftmost-longest` compares complete parses by nonempty flagged-span counts, with earlier starts first, longer spans next, and larger counts preferred at the first difference.

All flagged rules contribute together, without priority by name or declaration order. Equal spans count separately, including nested occurrences. Each nonempty occurrence of a flagged rule counts, including each named chain level and each constituent with one symbol. Empty occurrences contribute nothing. The unnamed constituents of flat braces and of optionals contribute nothing, including elidable optionals. The flag ranks before the stage directive.

Compare two rule profiles as lists of spans:

1. List each flagged occurrence's nonempty span by increasing start, then decreasing end.
2. Keep duplicate spans, including those from nested occurrences.
3. Compare the lists from the front.
4. At the first different entry, prefer the earlier start, then the later end.
5. After an equal prefix, prefer the longer list.
6. If the lists are equal, apply the stage directive.

Two nested flagged occurrences over one span contribute twice, so two such occurrences beat one. This document defines the flag's comparison, rather than POSIX subexpression semantics. For example, the flag pools occurrences across all flagged rules, counts nested and repeated occurrences, and ignores empty occurrences.

A parse with a greater rule profile beats one with a lesser rule profile (engine §6). Among equal rule profiles, the stage directive applies. A parse is best if no other admitted parse beats it. The stage takes a sole best parse. Several best parses give a tie.

The comparison uses actual input tokens. A written terminator adds width, but an elided terminator adds none. A longer constituent that prevents a complete parse cannot win. With no flagged rule, every rule profile is zero, so the stage directive alone ranks the admitted parses. Flags do not rank `matches`, `begins` or `tags` queries.

A tie is an error of kind `ambiguous`. The stage hands nothing on, and no later stage runs. A witness pairs differing actions from two readings. The error shows two tied parses and their witness (engine §6).

The engine's canonical order (engine §6) orders the ambiguity diagnostics. Among its keys are the numbers of the productions, which follow the order of a rule's alternatives. The canonical tie-break keys never turn a tie into an accepted reading.

`greedy` and `lazy` treat each parse as the sequence of actions that a bottom-up reader takes. Some closes are transparent and do not participate in the comparison (below). All other actions are visible. The stage compares parses with the greatest rule profile at their first differing visible action:

- If both read the same token under two tags, they are tied.
- If one reads and the other closes, the directive decides. `greedy` takes the one that reads, so a constituent ends as late as the grammar allows. `lazy` takes the one that closes, so a constituent ends as early as the grammar allows.
- If both close different constituents, they are tied.

Some closes are transparent to action comparison. A named production with one logical symbol has a transparent close. The notation also creates a transparent helper for every optional, every flat `{ }` and every ranked group, including captured optionals. So two parses that differ only in such a relabeling do not differ yet. The levels of a chain are constituents of its rule, so a level with more than one symbol is not transparent. Where `greedy` or `lazy` must see where each step of a list ends, the grammar writes a chain or explicit recursion, not flat braces.

Transparency does not merge parses, though. Two parses that differ only there are still two parses. `greedy` and `lazy` tie them when their rule profiles are equal. `late-elision` also requires equal counts of elided terminators at every position. For example, `[[X]]` matches the empty text in two ways, and `[A] & [B]` in three.

Greedy and lazy quantifiers suggest an analogy, not the same matching procedure. A quantifier controls repetition in a regular expression. These directives compare complete parses at the first differing visible action, without source-order priority or early commitment. A tie that the directive leaves is an error. The directive applies throughout the stage.

Among parses with the greatest rule profile, `late-elision` compares the terminators that each parse elides ("Elided terminators"). In plain words, at the first place where two parses differ in leaving out a terminator, it takes the parse that reads on. It counts the elided terminators of each parse at each input boundary, from the start of the text. At the first boundary where the counts differ, the parse with fewer elided terminators there wins.

Two parses with equal rule profiles and equal counts at every position tie, whatever else differs. Without flagged rules, several parses that elide nothing always tie. A token read under two tags does not decide anything, and neither do two different closes. The name of an elided terminator, and the constituent that it ends, do not count either.

For example, the experimental grammar can read `to mi klama` in two ways. One ends the parenthesis `to` after `mi`, with `vau` and `toi` elided there, and `klama` is the main predicate. The other puts `mi klama` inside the parenthesis and elides terminators only at the end. `late-elision` takes the second, because the first leaves out a terminator earlier. `greedy` leaves the two readings tied, so the text is an error under `greedy`.

The syntax stages of all five bundled Lojban dialects use `late-elision`. Each grammar settles with rules of its own the choices that `late-elision` leaves tied, such as where a free modifier attaches.

The forms and words stages are lazy. The word forms divide a run in one way only, so in the forms stage the choice never decides where a word ends. A magic word, such as `si`, acts on other words. In the words stage, the choice makes a magic word act on what exists when it is read. So `mi si si` erases `mi` and then nothing.

## Elided terminators

CLL permits eliding a terminator "if no grammatical ambiguity results", and says no more about how a parser decides that. A stage decides it from the whole text.

A grammar marks each terminator that can be elided where it writes it. An elidable optional is a bracket, then `+`, then the terminator, then the rest of the optional:

```jbogenbau
%rule sumti-6
  | LE # sumti-tail [+KU #]
  | LI # mex [+LOhO #]
```

- The terminator `T` stands directly after the marker, as written, with no parentheses around it. So `[+(KU) #]`, `[+((KU)) #]`, `[+(KU #)]` and `[+(KU #) A]` are errors, although parentheses make no node elsewhere. One spelling for each marked optional keeps every reader's check the same, and the check reads the written text, before parentheses are dropped.
- `T` is a non-engine tag name written directly after `+`. `[+KU]` marks KU. A string, range, engine tag, wildcard, rule, or `#` cannot mark an omission.
- `T` can carry any existing symbol test. A test on a later item remains an ordinary test.
- The rest is a sequence of any primaries, or nothing. A choice or `&` in the rest stands in parentheses, as in `[+KU (A | B)]`. A `|` or `&` that joins `T` to something else is an error, because some reading of the optional then does not begin with `T`. So `[+KU | VAU]` is an error.
- No capture stands inside an elidable optional, at any depth (see "Captures").

An elidable optional is an optional in every other way. It can stand anywhere that an optional can, inside braces and other optionals too. Spaces can stand between its parts, but the grammars write `[+KU #]` without them. A second plus is an error, so `[++T]` and `[+ + T]` are invalid.

A plain optional is never elidable, whatever it holds. So `[KU]`, `[KU | VAU]` and `[{KU}]` are ordinary optionals. Where one is absent, it counts for nothing and leaves no node, as an absent optional separator does. A grammar can read a terminator both ways: `[+KU]` in one rule and `[KU]` in another. Only the first one is elided.

The marker decides everything that follows in this section, and in "Ambiguity". It decides which absent optionals show as elided terminators and what `late-elision` counts. It also decides what `elision-only` writes back. The terminator of an elided node is `T`.

An elision records an omitted terminal at its input boundary, without naming a separate constituent that it ends. A query uses the preceding symbol of that reading when looking for a written terminator. In `LE sumti-tail [+KU #]`, that symbol is sumti-tail. A prefix is input read before the marked optional. After a terminal, or at production start, the query tests the optional directly after that prefix.

Braces add no separate query rule. The query uses productions of the expanded grammar, with plain optionals interpreted through their helpers. A marked optional at the first item's start uses its prefix. One at the start of a later flat-list item or left-chain separator follows an initial self-reference and uses that same prefix rule.

A marked optional at the start of a right-chain separator follows the item's final symbol. The query can extend that symbol before testing the written optional. If that symbol is a terminal or initial self-reference, it uses the prefix directly. These cases decide which query readings count, without assigning omissions to separate constituents.

A marked optional immediately after its production's initial self-reference uses the prefix directly when looking for a written terminator. This covers author-written left recursion and generated list recursion. Helpers never add a named-rule cycle by themselves. [Engine §4](engine.md#4-recognition) defines these searches.

A captured plain optional expands to bind captures, but retains one helper for query priority and inheritance. In `a [$b:b] [+KU]`, the optional remains the preceding symbol even when absent. The query checks both its absent and present forms for a written terminator. Adding the capture changes no ranking or query answer.

The constituent of an elided terminator can end wherever a parse of the whole text needs it to end. The ranking above chooses among the parses. So `le lojbo se farvi le loglo gi'enai mintu ja dunli le logla` parses. The `sumti-tail` of `le lojbo` ends before `se farvi`, which becomes the selbri (the main predicate). A parse with the longer `sumti-tail` `lojbo se farvi` leaves the sentence without a selbri.

CLL's own rule is narrower: a terminator can be elided only if no ambiguity results. CLL says nothing of the other ambiguities of its EBNF. The `elision-only` check is one reading of that rule. It examines only the parse that the ranking chose, and CLL does not say how to choose that parse.

With `elision-only`, the stage restores the chosen parse's omitted terminators. An equality test saves its exact string as the restoration value. Other tests use empty value and singleton tags `{T}`. Synthetic images are empty. Omitted pattern leaves still observe empty strings, regardless of a saved equality value.

An omission exists only when its test passes on this restoration value. Synthetic tokens are readable only by their terminator tag. Strings, ranges, and `_` never read them. A failed omission creates no marker or restoration record. Written tokens still use their own value and tags. All well-typed tests are legal, even when either route cannot succeed.

An inert route, one that cannot succeed, causes no special error or warning.

| Test on T | Omission succeeds when | Restoration value |
| --- | --- | --- |
| No test | Always | Empty |
| `T=s` | Always | s |
| `T≠s` | s is nonempty | Empty |
| `T<$C>` | Every tag of C is T | Empty |
| `T<¬$C>` | C does not contain T | Empty |
| `T<>` | Always | Empty |
| `T<T>` | Always | Empty |

Here C is a resolved tag constant and s is an exact string. The same omission tests apply at each marked optional. `[+T≠""]` cannot omit T, but reads a written nonempty T. `[+T<U>]` cannot omit T when U differs from T, although a written token carrying both tags can pass.

Then the stage parses that input again. Each elidable optional is either restored or written. In the chosen parse's own reading, an optional that it left out is restored: it reads only its written-back terminator. Another reading can start an optional from a written-back terminator and read more after it, where the rest of the optional reads something.

The grammar reads the text with its terminators written back. Every rule condition, tag and test sees the original input. A written-back terminator has no text, no value and no tags there. So a condition answers as it did for the chosen parse, and the chosen parse remains a reading before ranked-choice filtering. A test on a terminal is the one exception: `KU="ku"` reads a written-back `KU` by its value. A test on a rule, such as `t="ku"`, sees the original input like a condition.

A reconstruction is a second parse with terminators restored. These are the omitted terminators of the chosen parse. A projected span contains a constituent's original input tokens. Each written-back terminator adds no token (engine §7.3).

Ranked choices compare spans in the reconstructed input, including restored terminators.

The check retains the rule flags, but applies no stage preference. It counts flagged occurrences over projected spans. The restored chosen parse must survive ranked-choice filtering and be the sole best reconstructed reading. Another such reading gives an ambiguity error, never a replacement chosen parse.

With no flagged rule, the check requires the restored chosen parse as the only admitted reading. Recognition before filtering always keeps that parse. Only its absence there reports `elision-witness-lost` (engine §7.9). Filtering can exclude that present parse and cause ordinary ambiguity. A tie ends the stage before this check.

The CLL grammar settles `mi broda joi ke brode ke'e` as the official parser does. A plain joik does not open its own `ke` group. It cannot take a unit that is only a `ke` group.

Grammars that extend CLL can contain ambiguities unrelated to terminators. A sumti is an argument of the selbri. A term includes sumti and other kinds of arguments. The experimental grammar gives sumti connections priority over term connections. It therefore reads `mi .e do` in `mi .e do klama` as two connected sumti.

`late-elision` does not make `elision-only` redundant. Written-back terminators can let another alternative match, or let a test on a terminal match. So the check can find a second reading that the rule flags do not rank below the chosen parse.

The `experimental` and `zantufa` dialects do not declare `elision-only`. A caller can switch `elision-only` on for a parse, to find ambiguities that are not about terminators in the text that it supplies. A condition can treat a written-back terminator differently from a written one. In those grammars, such a condition can produce a second reading in reconstruction. A caller can also switch it off, to loosen a grammar that declares it.

## Layout of the bundled grammars

The bundled grammars keep a layout convention for a rule with two or more alternatives that are each a single symbol. A single symbol is a reference, a terminal, a range, an engine tag, a tested symbol or `ε`. An alternative with a guard, or with tags of its own (see "Tags"), is not a single symbol. If such a rule has more than one line, it does not put exactly one symbol on each line. The exception is a rule in which no two adjacent symbols fit together on one line.

No line of such a rule's body holds more than 100 characters, counted as Unicode code points. A symbol can run over several lines, and each of these lines counts. Apart from this, the author chooses the groups, such as the vowels on one line and the consonants on the next. `tools/sync.js --check` makes sure that the bundled grammars keep this convention. For a rule with one symbol per line, it suggests a layout, and keeps the line breaks inside each symbol.

## Railroad diagrams

Each bundled grammar document shows a railroad diagram of each of its rules. A railroad diagram draws a rule as a track. A reader follows the track from left to right, and each path along it is one way to read the rule. Under each block of rules stands one collapsed element, which opens on a click and shows a diagram of each rule of the block. `tools/sync.js` draws them, as "Railroad diagrams" in [the design document](design.md#railroad-diagrams) says.

The diagrams draw the notation in this way:

- A square box is a rule, and a rounded box is a terminal. A test stands in the box of its symbol, as the notation writes it, such as `LE="la"`.
- A sequence runs from left to right. A sequence too wide for the page continues on the next row. The track runs back under the row before it.
- A choice puts its first branch on the track and its other branches below it. The alternatives of a rule are a choice.
- A ranked choice draws its options in a dashed frame, numbered from 1 in preferred order. The label `≻ same span` precedes the frame. Ordinary branches inside an option are unnumbered, and a nested ranked choice has its own frame. A note under the rule repeats the filter rule.
- An optional has a bypass over its content. The bypass of an elidable optional has the label "elided".
- A test on an elided terminator also tests the omitted terminator, as "Elided terminators" says. Where the test forbids the omission, the diagram has no bypass. Where the dialects that read the document disagree, the label adds "where its test allows".
- Braces loop back under their item, and a separator stands on the loop. So `[{x}]` is a bypass over a loop.
- The loop runs from right to left, so the separator is drawn from right to left too, with its text upright. In `{A / B C}`, the loop meets `B` first, at its right, and then `C`.
- A chain reads the same words as a list, so it has the same drawing. A label under the loop says "left chain" or "right chain".
- `A & B & C` is the choice of the item where the subsequence begins, with every later item optional. So `A & B` is `A [B]` or `B`.
- The guards of an alternative stand over the start of its track, such as `¬cbm?` or `y-cmavo!`. `ε` is a bare track.

A diagram shows only what a rule reads. It leaves out the captures, the tag terms, the clauses and the rule's flag. A capture only names a part and changes no rule interpretation. Tags, recipes, emission, and erasure describe the parts' contributions, not which tokens the rule reads.

A condition can reject a reading that the diagram shows. So a diagram shows what a rule reads before its conditions, and the diagram of a rule with conditions says "conditions apply" beside its name. The diagram of an `%extend-rule` shows only the alternatives that it adds. It says "conditions apply" when the extension adds conditions of its own.
