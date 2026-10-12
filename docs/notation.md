# jbogenbau, the grammar notation

A grammar document is Markdown with fenced `jbogenbau` blocks. The reader joins these blocks in order. Prose between the blocks explains the grammar.

A token is one unit that a stage reads. A constituent is the input that one rule matches. A tag is a named mark on either object. A span is a range between input token boundaries. A capture names one matched part. A stage reads tokens and emits tokens. A dialect defines an ordered pipeline of stages.

Every token has two strings. Its value is the string that comparisons read. Its image is the string that people see. A constituent has tags but stores neither string. Methods read its input span or reconstruct strings from its chosen reading.

The [engine specification](engine.md) defines recognition, ranking, and emission. The [output specification](output.md) defines grammar DOM format 26 and result format 12. A DOM is a document object model.

## Rules

A rule starts with `%rule`, optional flags, its name, and its body. Line breaks and indentation have no meaning inside a block. A rule ends at the next declaration or pipeline directive. `(* ... *)` is a comment.

```jbogenbau
%rule sumti-tail
  [sumti-6 [relative-clauses]] sumti-tail-1 | relative-clauses sumti-tail-1

%rule source-word :: Word
  | $b:brivla-shape :: BRIVLA ∪ $b.tags
  | $n:cmevla-shape :: CMEVLA ∪ $n.tags
```

A clause assigns tags or a string. Clauses come in the order `::`, `:=`, `:-`. Each position accepts at most one clause of each kind. `:: T` supplies tags. `:= E` supplies a value and an implied image. `:- E` supplies an explicit image. A recipe is an expression that supplies a string.

Clauses can stand on the rule header or after an alternative. A header with any clause requires a leading `|` before the first alternative. This delimiter separates header expressions from the body.

```jbogenbau
%rule unit :- $.image
  | "A"<Stressed> := "a"
  | _<¬Stressed>
%emits
```

Rule-level and alternative tag terms union. Recipe precedence applies separately to each string channel. The emission section gives the full table.

After the body, `%conditions` lists conditions. Then either `%emits` lists output items or `%erased` erases the constituent. These two directives cannot occur together. `%tags`, `%opaque`, character tags, and phoneme tags are not notation forms.

`%rule(leftmost-longest) NAME` flags a rule for span ranking. `%redefine-rule(leftmost-longest)` replaces its body and flag. An unflagged redefinition removes the flag. `%extend-rule` accepts no flag and inherits the stitched rule's flag. Empty flag parentheses, repeated flags, arguments, and unknown flags are document errors.

## Names and terminals

Names use ASCII letters, digits, hyphens, and underscores. A rule, classifier, stage, or feature name starts with a lowercase ASCII letter. A rule can also be named `#`. A tag starts with an uppercase ASCII letter or `_`. A capture starts with a lowercase ASCII letter and contains no uppercase letter. A user constant starts with an uppercase ASCII letter. Digits, hyphens, and underscores can follow each initial letter.

A class is a tag with capital letters at both ends. It never starts with `_`. `BRIVLA`, `KOhA`, and `FOREIGN` are classes. `Word`, `Run-Final`, `Stressed`, and `Quoted-Text` are tags but not classes.

An engine tag is a reserved tag that starts with `_`. Stage zero, named `input`, assigns these tags to character tokens. Later stages can forward or filter them. A grammar never introduces them. [Engine §1](engine.md#1-tokens) lists the tags and their sources.

A terminal reads one token. Terminals have these forms:

| Form | Token that it reads |
| --- | --- |
| `KOhA`, `Run-Final`, `_Lu` | A token with that stored tag |
| `"a"`, `"la"` | A token with exactly that value |
| `$U-ACUTE`, `$_ED80` | A token with the value of the string constant |
| `"a".."z"`, `$_0041..$_005A` | A token whose value is one scalar value within the inclusive range |
| `_` | Any ordinary token |

A scalar value is a Unicode code point outside the surrogates. Range endpoints must each resolve to one scalar value. The start cannot exceed the end. A range skips surrogates. A range is only a terminal. It is never a tag set or a condition operand.

The empty string `""` is a terminal. It consumes an ordinary token with an empty value. A range, string terminal, or `_` never reads a synthetic terminator. A synthetic terminator is a token that restores an omission. Only its terminator tag can read it.

Terminal identity ignores its written constant name and its tests. `"a"`, `$_0061`, and an equal string constant identify one terminal. Patterns match this identity, rather than any leaf with the same value. Diagnostics spell string terminals as expanded string literals. Engine §9 defines their escaping.

## Tests

A tag test lists required and forbidden tags in angle brackets. `X<A ¬B>` requires `A` and forbids `B`. Every requirement must hold. A tag-set constant expands into requirements with the same sign. `<$C>` requires all its tags. `<¬$C>` forbids all its tags. Both tests hold for an empty constant.

A value test compares a symbol's input value exactly. `X="s"` requires equality. `X≠"s"` requires inequality. Its operand is a string literal or string constant. There is no lowercase conversion or comma removal.

One symbol can carry one test. Combining a tag test with a value test is a document error, including `_<Stressed>≠"y"`. Use a captured symbol and a condition for both requirements. This rule also applies to pattern terminal atoms.

Tests follow a rule reference other than `#`, a tag terminal, a string terminal, a range, or `_`. A capture binds the tested symbol, as in `$v:vowel<¬Syllabic>`. Groups, optionals, braces, `ε`, and completed captures accept no test.

A reference test reads the constituent's tags and the values of its input tokens. A terminal test reads its token's tags and value. An empty constituent has the empty input value. A test can therefore hold over an empty span without consuming a token.

Tag tests have no any-of form. Use `$x.tags ∩ $C ≠ ∅` to require at least one tag of a constant. Two alternatives can duplicate a reading when both tags hold.

## Operators

The body operators, from strongest to weakest, are primary forms, sequence, `&`, then choice. Primary forms include symbols, groups, brackets, braces, and `ε`.

| Form | Meaning |
| --- | --- |
| `a b` | Read `a`, then `b` |
| `a & b` | Read `a`, `b`, or both in that order |
| `a \| b` | An unordered choice |
| `a ≻ b` | Prefer qualified `a` over the same span |
| `[x]` | Read `x` or nothing |
| `[+T x]` | Read the marked terminator and remainder, or omit them |
| `{x}` | Read one or more items |
| `[{x}]` | Read zero or more items |
| `{x / s}` | Read items with a separator between them |
| `{... x / s}` | A left chain |
| `{x ... / s}` | A right chain |
| `(x)` | Group without a tree node |
| `ε` | Read nothing |

`A & B & C` reads any nonempty subsequence in the written order. It accepts at most 16 operands. Mixing `|` and `≻` at one choice level is a document error. Parentheses start a separate level.

Leading `|`, `&`, `∪`, `∩`, `∧`, `∨`, and clause-list commas are legal. A leading `/`, `∖`, or `≻` is an error. The leading separators add no operand.

`#` is an ordinary rule for a free-modifier slot. A free modifier is a phrase permitted at many positions. A grammar defines `#`, often as `[{free}]`. The engine gives it no built-in meaning.

## Repetition

Flat braces make a list without a node. The list's items and separators become ordered children of the rule that writes it. A chain gives each level a named node of its rule.

```jbogenbau
%rule terms-2
  {term / CEhE #}

%rule tag
  {... tense-modal / joik-jek}
```

The item and separator are full body expressions. Each brace pair accepts at most one separator and one chain marker. Both sides of `/` must exist. `{}`, `{x /}`, `{/ s}`, and `{x / s / t}` are document errors.

A chain marker stands immediately after `{` or after the complete item. A separator cannot contain a chain marker. A chain must be the whole expression of its alternative. Feature gates must leave that alternative alone in its rule. Otherwise grammar preparation fails.

An item must read at least one input token. Grammar preparation decides this structurally after gates and stitching, without tests or conditions. An empty item is a grammar error. An empty separator is legal. `[{x}]` therefore reads nothing in exactly one way.

Captures cannot stand inside braces or wrap them. Name the list as a rule to capture it. A chain's conditions, warnings, recipes, and emission serve every level. `$` then denotes that level.

## Ranked choices

A ranked choice filters actual candidate readings before stage ranking. Its options compete only at one written position, with the same common prefix state and the same span. Earlier qualified options remove later options. Tests and ready conditions must pass before an option qualifies.

```jbogenbau
%rule me-unit
  ME # (sumti ≻ mex) [+MEhU] # [MOI #]
```

An ordinary choice inside an option gives its branches equal rank. Different spans still compete through stage ranking. A nested ranked choice has its own boundary.

A seal is an opaque leaf for outside pattern tests. Every completed ranked option supplies one seal, even an empty option. Outside patterns cannot inspect its names, children, terminal identity, or private omissions. Real output trees still contain the selected option's structure.

Captures inside an option are private to the innermost ranked group. Only conditions ready before that group closes can read them. Later conditions, tag terms, emission items, and recipes cannot export them. A parent recipe cannot read a private capture.

An option has no local clause or feature guard. Use named rules for option-specific behavior. The group's returned tags must be discarded locally or provably empty. A common explicit tag term can stop inheritance. Engine §2.1 defines this proof over logical helpers.

Ordinary queries inspect eligible readings before ranked admission. They neither rank nor run recipes. A losing option's recipes never run. A selected option's recipe error ends the parse. It does not cause fallback to a lower option.

## Feature guards

A feature is a named switch for a parse. `f?` keeps an alternative while `f` is on. `¬f?` keeps it while `f` is off. These guards are gates. `f!` reports a warning when enabled but always keeps the alternative.

A warning reports the rule and source of its chosen occurrence. It changes no acceptance or ranking. A name cannot be both a gate and a warning within one dialect. Classifier entries accept gates but no warnings.

```jbogenbau
%rule tanru-unit-2
  | BRIVLA #
  | cbm? CMEVLA #

%redefine-rule cmavo-token
  | Cmavo<¬Cmavo-Warning>
  | y-cmavo! Cmavo<Cmavo-Warning>
```

## Stitching documents

Stitching combines declarations in their stage order. `%rule` defines a rule and fails if that rule exists. `%redefine-rule` replaces an existing rule and fails if none exists. `%extend-rule` appends alternatives and fails if no earlier rule exists.

An extension's clauses serve only its appended alternatives. Base clauses never apply to them. The stitched rule's flag serves every alternative. The audit records extensions, replacements, and flag changes.

```jbogenbau
%extend-rule consonant :: ∅
  | "б" := "b"
  | "в" := "v"
%emits
```

## Constants and strings

A constant names a closed value. A closed value reads no capture or current input. Its type is string, string set, tag set, or pattern. There is no string-set literal. `.split` constructs one from a closed string.

```jbogenbau
%const $SU-STOPS NIhO LU TUhE TO
%const $PAUSE " "
%const $SUFFIX "bu"
%const $WORD "a$(SUFFIX)"
%const $PIECES "a b".split(" ")
%redefine-const $SU-STOPS $SU-STOPS ∪ NIhO
```

`%const` requires an undefined name. `%redefine-const` requires an earlier definition and preserves its type. Other references use their name's final stage definition. A self-reference within a redefinition uses that name's immediately preceding definition. This rule includes nested patterns and interpolation.

The loader resolves an immutable graph of constant definitions. It rejects unknown names, cycles, and type changes, including in replaced definitions. An untyped `%const $E ∅` is an error. A redefinition's established set type can give `∅` its type.

Engine constants use `$_` followed by four to six uppercase hexadecimal digits. They denote one scalar value, such as `$_0301` or `$_10FFFF`. Surrogates and values above `10FFFF` are errors. Equivalent spellings denote the same string. Grammars cannot define or redefine engine constants.

Strings have no backslash escape. `$(NAME)` inserts a string constant. `$$` writes one dollar sign. `$(_0022)` writes a quotation mark. A `$` that starts neither `$$` nor `$(` is a document error, including a final lone `$`.

```jbogenbau
%const $ACCENTED "a$(_0301)"
%const $QUOTED "$(_0022)Hello!$(_0022)"
%const $DOLLAR "$$"
```

Only string constants interpolate. A capture never interpolates. `%include` paths are literal quoted paths without interpolation. Backslash is rejected everywhere in grammar text, including strings and comments. Use `∖` for set difference.

## Captures

A capture is `$x:symbol`, where the symbol can carry its one test. `$` denotes the whole constituent without a written binding. A capture binds exactly once per expanded production. Separate alternatives or choice branches can reuse its name.

```jbogenbau
%rule word :: Word ∪ ($c ⟹ $c.classify(lexicon))
  | $c:cmavo-shape :: Cmavo
  | brivla-shape :: BRIVLA
```

Groups, optionals, and braces are not capturable symbols. Write `[$x:a]` for an optional capture. Captures cannot stand inside elidable optionals or braces. Captures add no tree node and change no interpretation of their rule.

A production is one expanded sequence of an alternative. A captured plain optional expands in place to bind its captures. Its logical structure remains its own helper, present or absent. A helper is a generated rule for a notation construct.

Ranking, inheritance, ranked tag safety, and written-terminator query priority read that logical structure. `A [$b:B]` and `A [B]` therefore have the same two logical symbols. An absent optional has empty tags. A present optional inherits only from content with one logical symbol.

Diagnostic production numbers, witness actions, reported tied readings, and their order can follow the physical expansion. They do not decide accepted results. Engine §§2–4 and §6 define these separate uses.

Missing captures follow these rules:

- A condition with an unavailable capture does not apply after presence simplification.
- An emission item with an absent carrier drops.
- An absent attachment capture drops alone.
- A tag term must guard each remaining missing capture with `⟹`.
- A selected recipe must have every capture that it reads.

An item tag term with a missing capture never drops its item. An unknown capture name is an error even where pruning drops a clause. Recipe scope includes every nested receiver. Optional recipe cases need separate alternatives.

## Conditions and methods

`%conditions` lists predicates separated by commas. A predicate is a test that holds or fails. Each condition runs when its last required capture becomes ready. A condition on `$` runs when the candidate completes.

Outside recipes, a capture or span converts to its value where a string is required. Method selection occurs before that conversion. A bare capture as a condition tests presence. A span is not a presence predicate and cannot stand left of `≅`.

```jbogenbau
%rule zoi-quote :: $m.tags
  | $m:zoi-marker delimiter-gap $open:delimiter<¬Y-Letter> PAUSE $content:raw-tokens PAUSE $close:raw-close
  | $m:zoi-marker delimiter-gap $open:delimiter<¬Y-Letter> PAUSE $content:empty-zoi-body $close:raw-close
%conditions
  $open = $close,
  $open ∉ $content.split($PAUSE)
%emits
  $m, $open :: Word, $content :: Quoted-Text, $close :: Word
```

Each method chain reads from left to right. `¬` negates the complete predicate chain. Parentheses group expressions without changing their type. A tag clause and each side of `%implies` require tag sets.

| Method | Receiver and result |
| --- | --- |
| `.onward` | A span from the receiver's start to the context end |
| `.following-tokens` | An ordinary span after its original end |
| `.first-token` | Its first original token as an ordinary span |
| `.last-token` | Its last original token as an ordinary span |
| `.tokens-after-first` | Its remaining original tokens as an ordinary span |
| `.starts-input` | Whether its original start equals the context start |
| `.matches(rule)` | Whether an eligible reading covers its span |
| `.begins(rule)` | Whether an eligible reading covers a prefix, including an empty prefix |
| `.tags` | A capture's own tags, or an ordinary span's token-tag union |
| `.tags(rule)` | The union of tags from eligible whole readings |
| `.classes` | The classes in the receiver's `.tags` |
| `.classify(classifier)` | The classifier's tags for an exact string value |
| `.split(delimiter)` | A set of nonempty pieces of an exact string value |
| `.without-elision` | A restored span from a bare capture, including `$` |
| `.value` | The concatenated values of original input tokens |
| `.image` | The concatenated images of original input tokens |
| `.source-text` | The original source interval, including erased text |
| `.verbatim-text` | The source interval plus adjacent uncovered text, in recipes only |
| `.emitted` | A reconstructed pair, usable only as `.emitted.value` or `.emitted.image` in recipes |

The token methods return an empty span when the projected input is empty. `.onward` preserves a restored span's constraints. Other span methods project to original tokens and remove those constraints. A method result never retains constituent tags merely because it covers a capture's entire span.

`.without-elision` requires a bare capture. `$x.onward.without-elision` is an error. Write `$x.without-elision.onward`. Its observations read original values, images, source text, and token tags. Its queries preserve the candidate's ordered omission groups and ranked blocks. Engine §4 defines bounds and alignment.

`a = b` and `a ≠ b` compare strings or sets of the same type. `a ∈ b` and `a ∉ b` require a string and a string set. `a ⊆ b` and `a ⊈ b` require sets of one type. `$x ≅ P` and `$x ≇ P` require a bare capture and a pattern. Captures never convert to tags. `_L ⊆ $c.tags` tests a stored Unicode tag.

`∩` binds more tightly than `∪` and `∖`. Union and difference group from the left. `∧` binds more tightly than `∨`, and `⟹` binds least and groups right. `A ⟹ T` gives a tag set where `A` holds and the empty set elsewhere.

Conditions evaluate from left to right and stop when logic decides the answer. Terms and comparison operands evaluate from left to right. Presence simplification occurs before missing-capture analysis. Neither conditions nor tag terms can read `.emitted` or `.verbatim-text`.

`.split(d)` searches from the left, with each search starting after the preceding match. It returns distinct nonempty pieces. An empty delimiter is an error. A literal or constant empty delimiter is a document error. A delimiter that becomes empty during parsing causes a grammar error.

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

A run of bare tag names can stand alone or beside `∪`. Beside `∩` or `∖`, it requires parentheses. `(Word BY) ∩ $l.tags` is legal. `Word BY ∩ $l.tags` is an error. Other atoms require explicit operators.

Inside a pattern literal, sequence binds more tightly than set operators. `@(A B ∩ C)` is legal. Outside it, set operators combine two tag sets, two string sets, or two patterns. Mixed or unresolved types are errors. A string is not a string set, so `"a" ∪ "b"` is an error.

## Tree patterns

A pattern tests a constructed tree without parsing its text again. `@(sumti)` and `@sumti` are equal patterns. The shorthand accepts one atom and its optional test. `@A<B>` means `@(A<B>)`. `@KEhE=""` means `@(KEhE="")`.

A rule atom tests a rule name through sole-child wrappers. A terminal atom tests the identity of the terminal that read a leaf. A string constant atom denotes a string terminal. A pattern constant atom denotes its predicate. `@_` tests a leaf read by the wildcard terminal.

| Form | Meaning |
| --- | --- |
| `@sumti` | A named rule through sole-child wrappers |
| `@KEhE` | A written or omitted KEhE leaf |
| `@KEhE=""` | A KEhE leaf with an empty observed value |
| `@(A B)` | Two complete ordered children |
| `@(A ⋯ B ⋯ C)` | Ordered endpoints with arbitrary sibling gaps |
| `@(⋮ P)` | P on a downward path, including its start |
| `@(P ⋰)` | P on a first-child path |
| `@(⋱ P)` | P on a last-child path |
| `@(P ∪ Q)` | Either predicate on the candidate |
| `@(P ∩ Q)` | Both predicates on the candidate |
| `@(P ∖ Q)` | P holds and Q fails |
| `@([P Q])` | An optional child sequence |
| `@({P / S})` | One or more children with separators |

Helpers flatten their children. Empty named children disappear from a parent's sequence. A direct capture of an empty named rule retains its root. A primitive predicate tests a node and then its sole child repeatedly. Branching stops this search. A child-sequence predicate tests each visited node's complete children.

An omitted terminator contributes one leaf with empty value, empty image, and tags `{T}`. Its restoration value never changes that pattern observation. An absent ordinary optional contributes no leaf. A seal counts as a leaf but has no name, tags, value, image, or children. Paths stop at a seal.

Pattern binding is primary, path, sequence, intersection, then union or difference. First-path `⋰` follows one primary. Descendant `⋮` and last-path `⋱` precede one primary. Chained paths need parentheses or a nested literal.

Plain grouping preserves sibling sequences. `@(A (B C))` has three children. `@(A @(B C))` has two children. At a set or path boundary, a sequence becomes one child-sequence predicate. Set operations compare complete answers on the same candidate.

Only terminal atoms accept tests. A tested leaf uses its original token's tags and value, or the omitted leaf's observation. Patterns reject captures, guards, recipes, emissions, `&`, `|`, elision markers, and chain markers. A repeated pattern body cannot match only empty sequences. A sibling gap cannot serve as a repeat item or separator.

## Classifiers

A classifier maps exact string keys to classes. Its name starts with a lowercase letter. Each entry has gates, one or more literal string keys, `∈` or `∉`, and one class. Entries of several declarations with one name concatenate in stage order.

```jbogenbau
%classifier lexicon
  "mi" "do" "ko'a" ∈ KOhA
  "ui" "u'i" ∈ UI
  date-li? "de'i" ∈ LI
  date-li? "de'i" ∉ BAI
```

`∈` adds membership. `∉` removes it. Adding an existing membership or removing an absent membership causes a grammar error for the selected features. Disabled entries do nothing. Keys compare exactly, without engine normalization. A string with no entry receives the empty class set.

## Implications

An implication adds tags to emitted tokens. Each side is a closed tag-set term. `%implies UI CAI ⟹ Indicator` adds `Indicator` whenever either source tag holds.

The engine repeats implications until no tag changes. Implications apply to ordinary output tokens and attached tokens. They do not change constituent tags, strings, classifiers, or synthetic terminators. A grammar cannot introduce engine tags through implications.

## Emission

The emission walk chooses output tokens from the selected tree. It enters a constituent without `%emits` or `%erased`. A directly read token emits nothing by itself. `%emits` stops that walk and emits its listed items. `%erased` stops it and contributes no output or counted input parts.

An item is `$`, `$x`, or `ε`. Commas separate items. Each item can have `::`, `:=`, and `:-` clauses in that order. Only a named capture carrier accepts attachment captures. Attachments stand around the carrier before any clauses.

```jbogenbau
%rule digit-0
  "0"
%emits
  $ :: ∅ := "n", ε :: ∅ := "o"

%rule attached-word
  [$b:bahe-run] $w:unit [$a:indicator-run]
%emits
  ($b) $w ($a) :: $w.tags
```

A bare `%emits` means `%emits $`. `%emits :: T := "s"` is shorthand for `%emits $ :: T := "s"`. `%erased` accepts no operands. `%emits ε` inserts one ordinary empty token. It never erases a constituent.

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

Only selected recipes run. A weaker recipe runs only if an evaluated dependency asks for it. Evaluation identifies the constituent occurrence, channel, and item override. A dependency cycle among selected constituent recipes is a document error. Item recipes cannot refer to their own override.

```jbogenbau
%rule r := $.emitted.image :- "x"
  | "a"
%emits

%rule s := "x" :- $.emitted.value
  | "a"
%emits
```

Both examples produce `x` on both channels. `:= $.emitted.image` without an explicit image recipe cycles through its implied image. `:= $.emitted.value "x"` cycles directly. A stronger item recipe can leave such a constituent recipe unused. Engine §11 defines validation for each reachable selected dependency.

A recipe on an erased rule or erased alternative is a document error. A parent item over an erased capture emits a token with empty strings unless its item recipe supplies them. Its counted parts remain empty. An empty string recipe on a non-erased part never erases that part.

Emission carriers cover disjoint input-token spans. Source overlap does not decide this rule. Two `$` items over a constituent that can consume input are an error. A `$` item beside a capture that can consume input is an error. Structurally always-empty carriers can coexist. `$` can stand beside inserted `ε` items.

An inserted item anchors before the next named capture item's first present before-attachment or carrier. With no following named carrier, it anchors at the constituent's end. An absent next named carrier remains a document error. An absent attachment simply changes the anchor to the next present part. Engine §11 defines its empty source.

Attachments belong to the carrier but no later stage reads them. Ownership counts non-erased input tokens, independently of recipes. Combining an input token with attachments and another counted part causes a grammar error. An empty value or image does not remove a counted part.

## Verbatim text

`.source-text` returns the original interval covered by a span. `.verbatim-text` also returns adjacent uncovered text up to neighboring stage-input tokens or input ends. It is legal only in recipes on a bare capture or `$`. An empty span returns `""`.

```jbogenbau
%rule raw-tokens :- $.verbatim-text
  | any-token
  | raw-tokens any-token

%rule zohoi-payload :- $.verbatim-text
  | payload-token
  | zohoi-payload payload-token

%rule empty-zoi-body
  ε
```

A body recipe supplies the same image inside a parent compound. The outermost image recipe stops descent into recursive body nodes. The value walk still concatenates their values. An empty body takes no neighboring punctuation.

The method returns a string only. It changes neither `source` nor `text`. An image can therefore include text outside its token's source. Forwarding preserves that image without applying the method again.

Two evaluated calls on different spans cannot claim the same nonempty uncovered interval. Such a conflict ends the parse with a grammar error. Equal-span calls can reuse the same result. Calls in unselected recipes do not participate. Engine §11 defines overlap, source order, and memoization.

## Ambiguity

The stage ranks admitted complete readings. A sole reading is `unique`. Several readings with one best are `resolved`. Several best readings give a `tie` and an ambiguity error. A tie emits no tokens and starts no later stage.

`leftmost-longest` ranks all flagged nonempty occurrences together. Earlier starts win first, then longer spans, then greater counts over equal spans. Nested equal spans count separately. Empty occurrences count nothing. Equal profiles leave the stage directive to decide.

`greedy` and `lazy` compare bottom-up visible actions at their first difference. A read beats a close under `greedy`. A close beats a read under `lazy`. Different terminals on one token tie. Different visible closes tie. Helper closes and one-logical-symbol closes are transparent.

`late-elision` counts omissions at every input boundary. At the first difference, fewer omissions win. Equal rule profiles and equal omission counts tie. The terminator's name and nesting do not affect this count.

Canonical production and action ordering selects diagnostic readings. It never accepts a tied reading. Engine §6 defines that order and the shared ranking algorithm.

## Elided terminators

An elision is an omitted terminator. `[+T x]` marks an elidable optional. `T` must be an ordinary tag written directly after `+`. Engine tags, strings, ranges, `_`, groups, and rule references cannot mark an omission. No capture can stand anywhere inside it.

```jbogenbau
%rule sumti-6
  | LE # sumti-tail [+KU #]
  | LI # mex [+LOhO #]
```

The remainder is a sequence of primaries. An internal choice requires parentheses. `[+T | U]`, `[+(T)]`, and `[++T]` are document errors. A plain `[T]` is never an elision and leaves no omitted leaf.

Omission tests use the terminator's singleton tag set. An equality test saves its operand as the restoration value. Otherwise the restoration value is empty. The omission exists only if its test holds on these values. Written routes keep their token's own values and tags.

With `elision-only`, a resolved stage restores its selected omissions and recognizes the reconstructed input. Terminal tests read synthetic recognition values. Rule tests, conditions, and patterns observe original projected input. Omitted pattern leaves always have empty value and image and tags `{T}`.

The restored selected reading must exist before ranked filtering. Its raw absence reports `elision-witness-lost`. It must then survive admission and be the sole best reading under projected rule profiles. Otherwise the result reports an `elision-only` ambiguity with that reading first. The operation never replaces the selected tree.

`.without-elision` queries preserve ordered closes over the captured interval. A prefix must preserve the entire close group at its endpoint. An aligned witness cannot use a synthetic token as a required written terminal. Ordinary nested queries start without inherited alignment. Explicit nested restoration uses the witness's own closes.

## Directives and pipelines

A pipeline uses `%stage NAME`, `%include "PATH"`, and `%features NAME...`. Each stage needs one `%ambiguity-resolution` with `greedy`, `lazy`, or `late-elision`, optionally followed by `elision-only`. Stage names identify API output and diagnostics.

`%extend-stage NAME` selects an existing stage and appends items. `%redefine-stage NAME` clears its stage items and selects it. Both keep its execution position. Selection continues through includes. Stage replacement leaves global features and other stages intact.

An include path resolves relative to its containing document. Cycles and missing documents are loading errors. Every stage starts at `text`. Stage zero supplies character tokens. The engine provides no pause or normalization policy. A dialect expresses both through ordinary grammar stages and recipes.

## Layout of the bundled grammars

Each prose paragraph, heading, and table row occupies one line. Bodies use two-space indentation. A multiline rule of single-symbol alternatives groups adjacent symbols that fit within 100 code points. Guards and clauses exclude an alternative from that single-symbol convention.

Pipeline includes pair a Markdown link with an indented `jbogenbau` block. `node tools/sync.js --check` makes sure that bundled document conventions and generated artifacts agree. The notation reader accepts any supported fence layout regardless of that author convention.

## Railroad diagrams

A railroad diagram draws the paths through one rule. A square box names a rule. A rounded box names a terminal. A bypass denotes an optional, and a loop denotes repetition. Tests stand inside their symbol's box.

A ranked group numbers its options inside a dashed frame. A chain labels its loop as left or right. An elidable bypass is labeled `elided` where its test permits omission. A diagram omits captures, recipes, tag clauses, emission, and flags. A rule with conditions says that conditions apply.

Diagrams show recognition paths before conditions filter them. `tools/sync.js` generates SVG diagrams from grammar DOMs. A document's generated collapsed element follows the block that states its rules.
