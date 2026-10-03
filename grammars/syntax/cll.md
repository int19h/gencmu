# The CLL grammar

This document opens the syntax stage, the last stage of the [CLL](../dialects/cll-ebnf.md) and [approved word forms](../dialects/bpfk.md) dialects. It is also the base of the syntax of the [experimental](../dialects/experimental.md) dialect. A dialect is a pipeline of stages, defined by one pipeline document. A stage is one step of a pipeline, with its own grammar.

This document is the grammar of Lojban as chapter 21 of *The Complete Lojban Language* (CLL) prints it, in the notation that the book uses. That notation is EBNF (Extended Backus-Naur Form). This grammar departs from the printed one where "Differences from the printed CLL grammar" at the end says.

A cmavo is a particle, a short structure word. A selma'o is a word class of cmavo. The terminals of this grammar are selma'o. A terminal matches an input token by tag. A tag marks a token by name, phoneme or character.

The prose uses these Lojban terms before the sections that explain them:

- A selbri is the predicate of a sentence.
- A sumti is an argument of a selbri.
- A tanru is a compound selbri.
- A jek is a logical connective between tanru units, such as `je`.
- A joik is a non-logical connective, such as `joi`.
- A stag is a tense or modal inside a connective.
- A mekso is a mathematical expression.
- A brivla is a predicate word.
- A lerfu word is a letter word, such as `.abu` or `xy.`.

The stages before it make the word stream that it reads. The forms stage ([forms.md](../words/forms.md), with a family of word forms and a lexicon) reads phonemes into words. The word stage, [the word stream](../words/stream.md), makes quotes and compounds and applies the erasers `si`, `sa` and `su`. [The indicator stage](../indicators/cll.md) attaches a run of indicators to the word before it, as CLL's non-formal rule `word = [BAhE] any-word [indicators]` says. Every cmavo reaches this grammar under each selma'o that [the CLL lexicon](../words/lexicon-cll.md) gives it. The material of a quote arrives tagged `word` or `quoted-text`, which is what `any-word` and `anything` read.

[The notation document](../../docs/notation.md) explains the notation. Two of its points matter here. First, an elided terminator takes its `#` with it, so an elided `[X #]` leaves no free-modifier slot (see `#` below) at that point. Second, when omitted terminators leave a text with more than one parse, the stage chooses the parse as "Choosing among parses" after the grammar says.

The notation reads `...` as CLL does. `x ...` means one `x`, optionally followed by more. `[x] ...` allows none. Point 7 of CLL 21.2's notation calls `...` "optional repetition of the construct to the left". This grammar reads it so: the first `x` is required, and its repetition is optional. Where CLL means none, it writes `[x] ...` or `[x ...]`. This clarifies point 7. It is not a departure from it. Juxtaposition binds tighter than `&`, which CLL does not say (item 1 of "Differences from the printed CLL grammar").

This document writes the grammar literately: each block of rules follows the prose that explains it, and the blocks together are the grammar. The prose says what each construct is for and how the rules do it. The chapter numbers are those of CLL.

A directive and a rule set the grammar up. This document does not say how the stage chooses among parses. CLL's rule that a terminator can be elided "if no grammatical ambiguity results" has more than one reading (see "Choosing among parses"). So each dialect that uses this grammar names its own reading after this document. The cll-ebnf and bpfk dialects do so in their pipeline documents. The experimental layer (a document that changes earlier rules) names its reading itself.

`%elidable` lists the terminators that CLL marks as elidable. The printed grammar writes them between slashes. Here each is an optional, `[KU]`, or `[KU #]` when its free-modifier slot goes with it. An absent one shows in the parse tree as that terminator, elided. `#` is the free-modifier slot that follows almost every word: any number of free modifiers, as CLL's EBNF defines it. This document defines `free`, a single free modifier, under "Free modifiers, vocatives and indicators".

```jbogenbau
%elidable
  BEhO BOI DOhU FEhU GEhU KEI KEhE KU KUhE KUhO
  LIhU LOhO LUhU MEhU NUhU SEhU TEhU TOI TUhU VAU
  VEhO

%rule #
  [free ...]
```

## The text and its paragraphs

A text is what one speaker or writer produces, from the first word to the last (CLL 19.1). A text can open with these forms:

- `nai`, a vague negation that CLL allows at the start of a text (CLL 19.5)
- A run of names, a form of address without a vocative
- Indicators or free modifiers that belong to the whole text
- A connective, `joik-jek`, that joins this text to a previous one in afterthought, as an answer joins a question (CLL 19.5)

After that come the paragraphs. `text-1` lets the text begin with `.i` sentence separators, then with `ni'o` topic markers, or with either alone. Each `.i` can carry its own afterthought connective and a `bo`-grouped tense. A text takes these forms when it continues the text of another speaker or starts a fresh topic (CLL 19.3). One or more `ni'o` separate the paragraphs, and each `ni'o` beyond the first marks a larger break. A paragraph is a sequence of statements or fragments, separated by `.i`.

This grammar writes most unbounded sequences with a trailing `...`, which the parser reads left-recursively. So a paragraph of a thousand sentences costs a thousand steps, not a thousand squared. A few rules, such as `paragraphs` and `links`, recurse on the right instead.

```jbogenbau
%rule text
  [NAI ...] [CMEVLA ... # | (indicators & free ...)] [joik-jek] text-1

%rule text-1
  [(I [jek | joik] [[stag] BO] #) ...] [NIhO ... #] [paragraphs]

%rule paragraphs
  paragraph [NIhO ... # paragraphs]

%rule paragraph
  (statement | fragment) [I # [statement | fragment]] ...
```

## Statements and fragments

A statement is a sentence, or a sentence with a prenex before it, or several sentences joined by afterthought connectives (CLL 14.4). The four levels state the grouping of those connectives. `statement` takes any number of prenexes, each `terms zo'u`, which bind variables or set topics for the sentence that follows (CLL 16.2). `statement-1` is a sequence of `statement-2` joined by `.i` followed by a jek or joik: `.i je`, `.i ja nai`, `.i joi`. These group to the left, as the trailing `...` says. So `A .i je B .i ja C` is `(A and B) or C`.

`statement-2` is the right-grouping form. `.i` with an optional connective and an optional tense, then `bo`, binds the sentence after it more tightly than a plain `.i je` does. The rule refers to `statement-2` on its right, so a chain of `.i bo` groups to the right (CLL 14.8). `statement-3` is either a sentence or a `tu'e ... tu'u` block. The block makes a whole text-1 act as one sentence, for connection and for a tense before it (CLL 14.8). The block's `tu'u` is elidable and carries its own free-modifier slot.

A prenex belongs to a whole statement. Between two statements, a sentence after `.i` with a connective cannot have its own prenex (rules 12 and 13). Examples are `.ije` and `.i bo`. A `tu'e ... tu'u` block can hold one. CLL 1.1 prints examples 16.77 and 16.78 with a second `zo'u` there. Example 16.77 is `roda zo'u mi prami da .ije naku zo'u do prami da`. Example 16.78 is `su'oda zo'u mi prami da .ije naku zo'u do prami da`. This grammar rejects the printed texts and reads them without that `zo'u`. Then `naku` is a term of the second sentence. The prenex covers the whole statement, so it binds `da` in both sentences. The official parser accepts the printed texts. Its lexer reads `.ije` there as a plain `.i` (rule 10), and a prenex can follow that. Every edition of CLL from 1.2.12 on corrects example 16.77 in this way. These editions keep the `zo'u` of 16.78.

A fragment is what a speaker utters when the utterance is not a sentence (CLL 19.5 and 14.13). It is one of these:

- A bare connective, as the answer to a `ji` or `gi'i` question
- A bare quantifier, as the answer to `xo`
- `na` alone
- A list of terms with an optional `vau`
- A bare prenex
- A relative clause
- A `be` or `bei` phrase that supplies arguments after the fact

`terms [VAU #]` is a fragment. So the parser never has to read the first word of an utterance as the start of a sentence. That is what makes `le sutra tavla` a legitimate fragment as well as a sentence. "Choosing among parses" says how the stage chooses between the two.

```jbogenbau
%rule statement
  statement-1 | prenex statement

%rule statement-1
  statement-2 [I joik-jek [statement-2]] ...

%rule statement-2
  statement-3 [I [jek | joik] [stag] BO # [statement-2]]

%rule statement-3
  sentence | [tag] TUhE # text-1 [TUhU #]

%rule fragment
  ek # | gihek # | quantifier | NA # | terms [VAU #] | prenex | relative-clauses | links | linkargs

%rule prenex
  terms ZOhU #
```

## Sentences and bridi-tails

A sentence is a bridi: some terms, then optionally `cu`, then the bridi-tail, which holds the selbri and any terms that follow it (CLL 9.2). The terms before the selbri are the head. `cu` marks where the head ends. It lets a description close without its `ku`, since `cu` cannot continue the selbri of the description. The terms are optional so that a sentence can begin with its selbri, as `klama` alone does.

A subsentence is a sentence, or a prenex followed by a subsentence. Abstractions and relative clauses contain subsentences, and the prenex of a subsentence is local to it (CLL 16.7).

The bridi-tail levels state how sentences share a head under a gihek, the connective family `gi'e`, `gi'a` and the rest of GIhA (CLL 14.9). `bridi-tail-3` is one selbri with its tail terms, or a forethought `gek-sentence`. `bridi-tail-2` binds two tails with `gihek [stag] bo`, right-grouping, and `bridi-tail-1` joins tails with a plain gihek, left-grouping. `bridi-tail` at the top lets a gihek be followed by `ke ... ke'e`, which groups the tails inside the brackets against the tail to the left. The tail terms after each selbri belong to that selbri. `vau` closes them and is almost always elided.

The printed grammar lets the tail after a plain gihek begin with `ke`, or with a tense and `ke`. So `mi broda gi'e ke brode ke'e` has two parses. In one, `ke ... ke'e` groups the tails after `gi'e`, through the `ke` form of `bridi-tail` (rule 50 of the printed grammar). In the other, `gi'e` is a plain gihek (rule 51), and `ke ... ke'e` groups a tanru that begins the second tail. With a tense, the two parses also differ in what the tense applies to. In `mi klama gi'e pu ke cadzu ke'e`, `pu` is part of the connective in the first parse, and a tense of the selbri `ke cadzu ke'e` in the second. CLL 14.10 groups tails with `ke` after a gihek, and CLL 14.18 puts a tense between a gihek and `ke` (example 14.164). The official parser reads only the group, through a token of its lexer (the part that divides the input into tokens), `GIhEK_KE`.

The ranking of elided terminators does not settle this. In `mi broda gi'e ke brode`, both parses elide the same terminators at the same places, so they tie. In `mi broda gi'e ke brode ke'e`, the group elides the `vau` of `brode` before `ke'e`, and the tanru parse elides nothing there. So `late-elision` takes the tanru parse.

This grammar states CLL's choice as a condition on the last tail after a plain gihek. The condition reads tags of the tail that the parse built. A tag marks a constituent (see "Tags" in the notation document), and a constituent of one part has the tags of that part. The `ke` alternative of `tanru-unit-2` and the `ke` forms of `gek-sentence` carry the tag `~ke-group`. A tense or modal before the `ke` keeps the tag only where a `stag` can read it, since the `ke` form of `bridi-tail` takes a `stag` there. So `bridi-tail-2` carries `~ke-group` exactly when the whole tail is one `ke` group. That is a selbri that is one `ke` tanru unit, with its tail terms, or one `ke` group of a `gek-sentence`. A `stag` can come before either. To pass the tag up, `selbri`, `selbri-2`, `selbri-5`, `selbri-6`, `tanru-unit-1`, `bridi-tail-2`, `tail-terms` and `gek-sentence` write an optional part as two alternatives, one with the part and one without. They read the same words in the same way as the printed rules.

The condition stands in `bridi-tail-1-final`, the form of `bridi-tail` without the `ke` group of tails. It is the printed `bridi-tail-1` with its last plain connection written apart. Only that connection can compete with the `ke` form of `bridi-tail`. Rule 50 reads one `ke` group as the last part of a bridi-tail, followed by one run of tail terms. So it can read the same words as a plain gihek only where the last tail is one `ke` group with one run of tail terms. The condition removes the plain parse in that case and in no other. The tails before the last one are in `bridi-tail-1`, which has no condition. So `mi broda gi'e ke brode` and `mi broda gi'e ke brode ke'e` each have one parse, the group. In `mi klama gi'e pu ke cadzu ke'e`, `pu` stays on the connective. In `mi broda gi'e ke brode ke'e le zarci`, `le zarci` is in the tail terms of rule 50, after `ke'e`. Tail terms after a connection of tails apply to both sides of it (CLL 14.9, example 14.54). So `le zarci` applies to `broda` and to the group. Writing the last connection apart also shows the left grouping of plain giheks in the tree (CLL 14.10). A chain of three tails reads as `{A gi'e B} gi'a C`.

The condition needs no lookahead. The structure of the rule says that no gihek of the same bridi-tail follows the last tail, so the condition does not test the words after it. It reads only the tags of the parsed tail and the text of the tail terms after it. These are the same in the reparse of `elision-only`, where the elided terminators are written back. So `mi klama lo nu broda gi'e ke brode ke'e gi'a brodi` keeps its reading in that reparse. The condition does not divide the words before the gihek in another way. So in `mi klama lo nu broda gi'e ke brode ke'e`, the group stays inside the `nu` clause, as in the official parser. In `mi broda gi'e pu ke me le le brodi brodo ku me'u ke'e`, the inner `ku` is elided, and the tail is still one `ke` group, so `pu` stays on the connective. The plain parse stays where the group cannot read the same words:

- The tail is not the last one, as in `mi broda gi'e ke brode ke'e gi'a brodi` and `mi broda gi'e ke ga brode gi brodi ke'e do gi'a brodi`. The `ke` form must end its bridi-tail.
- The tail goes on after `ke'e`, as in `mi broda gi'e ke brode ke'e brodi`.
- A free modifier stands between the gihek and `ke`, as in `mi broda gi'e to do toi ke brode ke'e`. The `ke` form has no slot there. `bridi-tail-1-final` reads this case in its own alternative, through the rule `free-modifiers`, a `#` slot that is not empty.
- The tail has two runs of tail terms. Its own tail terms end with a written `vau`, and more tail terms follow, as in `mi broda gi'e ke brode ke'e vau do` and `mi broda gi'e ke brode ke'e vau le le brodi brodo ku`. The group has one run of tail terms after `ke'e`, and cannot read two. `tail-terms` carries the tag `~vau-written` when its `vau` is written. The condition reads that tag on the tail and tests that the tail terms after the tail are not empty.

The lexer of the official parser makes `gi'e ke` one token in all of these but the free modifier, and so it rejects them. This grammar follows the printed grammar there, and accepts them.

A joik directly before `ke`, in a tanru or between operators, has two parses too. In `mi broda joi ke brode ke'e`, one parse joins a `ke` group to `broda` through `joik [stag] KE`. The other joins `broda` with `joi` to a tanru unit that begins with `ke`. Both parses elide the same terminators at the same places, so no ranking of elided terminators can choose. The official parser reads only the first, through its lexer token `JOIK_KE`.

This grammar states that choice as a condition, in the rules `plain-joik-jek` and `joik-before-ke` (see "Logical and non-logical connectives"). So `mi broda joi ke brode ke'e` has one parse, the group joined by `joi`. A jek has no such `ke` form, so `mi broda je ke brode ke'e` keeps its one parse, a jek before a `ke` unit.

The condition applies only where the two parses compete. In `mi broda joi ke brode ke'e bo brodi`, the `ke` group cannot take `bo brodi`, so only the plain reading parses. There `joi` joins `broda` to the unit `ke brode ke'e bo brodi`. The lexer of the official parser makes `joi ke` one token there too, and so it rejects the text. This grammar follows the printed grammar there, and accepts the text.

A `gek-sentence` is the forethought form. It joins two subsentences before either is spoken: `ga A gi B`, or `pu gi A gi B` with a tense in the gek. A tense or modal (the rule `tag`, see "Tenses and modals"), `ke` for grouping, or `na` can come before it (CLL 14.5, 14.10). Its tail terms follow the whole connection and apply to both sides. In the printed rule, the tag before `ke` is optional, so `ke ga mi klama gi do cadzu ke'e` is a `gek-sentence`. Rule 54 of the YACC grammar requires a tag there, and the official parser rejects that text. This grammar follows the EBNF.

```jbogenbau
%rule sentence
  [terms [CU #]] bridi-tail

%rule subsentence
  sentence | prenex subsentence

%rule bridi-tail
  | bridi-tail-1-final
  | bridi-tail-1 gihek [stag] KE # bridi-tail [KEhE #] tail-terms

%rule bridi-tail-1
  bridi-tail-2 [gihek # bridi-tail-2 tail-terms] ...

%rule bridi-tail-1-final
  | bridi-tail-2
  | bridi-tail-1 gihek free-modifiers bridi-tail-2 tail-terms
  | bridi-tail-1 gihek $t(bridi-tail-2) $v(tail-terms)
%conditions
  ~ke-group ⊈ tags($t) ∨ (~vau-written ⊆ tags($t) ∧ text($v) ≠ "")

%rule free-modifiers
  free ...

%rule bridi-tail-2
  | bridi-tail-3
  | bridi-tail-3 gihek [stag] BO # bridi-tail-2 tail-terms

%rule bridi-tail-3
  | $s(selbri) $v(tail-terms) <tags($s) ∩ ~ke-group ∪ tags($v) ∩ ~vau-written>
  | gek-sentence


%rule gek-sentence
  | gek subsentence gik subsentence tail-terms
  | KE # gek-sentence [KEhE #] <~ke-group>
  | $g(tag) KE # gek-sentence [KEhE #] <matches($g, stag) ⟹ ~ke-group>
  | NA # gek-sentence

%rule tail-terms
  | [VAU #] <text($) ≠ "" ⟹ ~vau-written>
  | $m(terms) [VAU #] <text($) ≠ text($m) ⟹ ~vau-written>
```

## Terms

A term is one argument of a bridi, or one tense or modal standing on its own (CLL 9.3, 10.13, 15.2). It is one of these:

- A sumti
- A sumti or an elided `ku` after a tense, a modal or a place marker `fa`, `fe`, ... (`ca lo nu broda`, `fi mi`, `pu ku`)
- A termset
- `na ku`, the sentence-level negation written as a term

A tense or modal with nothing after it takes `ku`, so that it does not swallow the next sumti. The `ku` can be elided when what follows cannot be a sumti. When what follows can be a sumti, "Choosing among parses" says which reading wins.

The three levels of `terms` state the termset connectives (CLL 14.11 and 16.7). `terms-2` joins terms with `ce'e` into a termset, `mi ce'e do`. `terms-1` joins termsets with `pe'e` followed by a jek or joik, the afterthought form that connects two sets of arguments at once. `terms` is a sequence of those, and it is left-recursive so that the parser builds the terms of a long sentence one at a time. A termset in forethought is `nu'i gek terms nu'u gik terms nu'u`. `nu'i terms nu'u` alone brackets several terms into one so that a connective or a tense applies to all of them.

```jbogenbau
%rule terms
  terms-1 ...

%rule terms-1
  terms-2 [PEhE # joik-jek terms-2] ...

%rule terms-2
  term [CEhE # term] ...

%rule term
  sumti | (tag | FA #) (sumti | [KU #]) | termset | NA KU #

%rule termset
  NUhI # gek terms [NUhU #] gik terms [NUhU #] | NUhI # terms [NUhU #]
```

## Sumti

A sumti is an argument: a description, a name, a pronoun, a quotation, a number, or a connection of these (CLL 6). The levels from `sumti` down to `sumti-4` state the connectives and the grouping, in the same shape as for statements and bridi-tails.

`sumti-1` is a sumti with a `ke ... ke'e` grouped connection after it. `sumti-2` is a sequence joined by ek or joik in afterthought, `mi .e do`, `mi joi do`, left-grouping. `sumti-3` is the right-grouping `bo` form. `sumti-4` is a simple sumti or a forethought connection, `ge mi gi do`. The top rule `sumti` adds `vu'o` followed by relative clauses. `vu'o` attaches the clauses to a whole connected sumti rather than to its last member (CLL 8.8).

`sumti-5` places the outer quantifier. A number before a sumti-6 counts its referents: `re lo gerku`. A quantifier directly before a selbri makes a sumti with an implicit `lo`, `re gerku`, whose `ku` is elidable (CLL 6.7). Relative clauses can follow either.

`sumti-6` is the closed list of simple sumti. A LAhE word such as `la'e`, or a NAhE word with `bo` such as `na'e bo`, makes a sumti from the referent of another sumti. Relative clauses can stand inside. `lu'u` closes the resulting sumti. `KOhA` is a pronoun. A lerfu string, `.abu` or `xy.`, is a sumti, and `boi` closes it and separates it from a following number or lerfu string.

`la` before names makes a name. `la` or `le` (that is, any member of LA or LE) before a `sumti-tail` makes a description closed by `ku`. `li` opens a mekso closed by `lo'o`. Four forms quote (CLL 19.9 and 19.10):

- `zo` quotes the single next word.
- `lu ... li'u` quotes a Lojban text.
- `lo'u ... le'u` quotes a run of Lojban words that need not be grammatical, possibly none.
- `zoi` quotes any text between two copies of a delimiter word.

This grammar states the quote rules over `any-word` and `anything`. The word stage decides where a `zo`, `lo'u` or `zoi` quote ends, and hands on its parts as tokens. It tags each quoted word `word`. It tags a quoted unit, such as a `zoi` body, `quoted-text`. This grammar delimits only `lu ... li'u`. The free-modifier slot of that quote follows it whether or not `li'u` is written.

`sumti-tail` is what follows a descriptor. It begins with an optional inner sumti that possesses or restricts, `le mi zdani`. Then come the inner quantifier and the selbri, `le ci gerku`, or a quantifier and a sumti, `lo re lo gerku`. Relative clauses can come after the inner sumti or replace it (CLL 6.2 and 8.7).

```jbogenbau
%rule sumti
  sumti-1 [VUhO # relative-clauses]

%rule sumti-1
  sumti-2 [(ek | joik) [stag] KE # sumti [KEhE #]]

%rule sumti-2
  sumti-3 [joik-ek sumti-3] ...

%rule sumti-3
  sumti-4 [(ek | joik) [stag] BO # sumti-3]

%rule sumti-4
  sumti-5 | gek sumti gik sumti-4

%rule sumti-5
  [quantifier] sumti-6 [relative-clauses] | quantifier selbri [KU #] [relative-clauses]

%rule sumti-6
  | (LAhE # | NAhE BO #) [relative-clauses] sumti [LUhU #]
  | KOhA #
  | lerfu-string [BOI #]
  | LA # [relative-clauses] CMEVLA ... #
  | (LA | LE) # sumti-tail [KU #]
  | LI # mex [LOhO #]
  | ZO any-word #
  | LU text [LIhU] #
  | LOhU [any-word ...] LEhU #
  | ZOI any-word anything any-word #

%rule sumti-tail
  [sumti-6 [relative-clauses]] sumti-tail-1 | relative-clauses sumti-tail-1

%rule sumti-tail-1
  [quantifier] selbri [relative-clauses] | quantifier sumti
```

## Relative clauses

A relative clause attaches to a sumti and restricts or comments on it (CLL 8). `goi` and the other members of GOI take a term, `mi goi ko'a`, `le zdani pe mi`, and `ge'u` closes the clause. `poi`, `noi` and `voi` take a subsentence in which `ke'a` refers back to the sumti, and `ku'o` closes the clause. `zi'e` joins several relative clauses on one sumti.

```jbogenbau
%rule relative-clauses
  relative-clause [ZIhE # relative-clause] ...

%rule relative-clause
  GOI # term [GEhU #] | NOI # subsentence [KUhO #]
```

## Selbri and tanru

A selbri is the predicate of a bridi (CLL 5). A tense or modal can come before it. That is how the tense or modal attaches to the whole bridi when it is not written as a term (`mi pu klama`). The levels below state the tanru grouping. `selbri-1` allows `na` before a selbri, the contradictory negation (CLL 15.2).

`selbri-2` is the `co` inversion, `sutra co tavla`. It swaps the order of modifier and modified, so the part after `co` is the modifier (CLL 5.8). The whole selbri keeps the place structure of the part before `co`. Sumti after the selbri fill the places of the modifier, from its x2 on. `co` groups to the right.

`selbri-3` is a plain tanru: a sequence of `selbri-4` with no connective between them. It groups to the left, so `barda gerku zdani` is `(barda gerku) zdani`.

`selbri-4` joins units by a jek or joik in afterthought, `barda je melbi`, or by a joik followed by `ke ... ke'e`. Where the unit after a plain joik is only a `ke` group, the second form reads the same words. The grammar then takes the second form. `selbri-5` joins units by a jek or joik with `bo`, which binds more tightly than plain juxtaposition, as in `melbi je bo cmalu nixli`. `selbri-6` is a tanru unit, optionally followed by `bo` and a further `selbri-6`, as in `melbi cmalu bo nixli`. It can also be a forethought connection with a guhek, `gu'e barda gi melbi`, optionally negated by `na'e` (CLL 5.6, 14.12).


A tanru unit is one brick of the selbri. `tanru-unit` allows `cei` to assign the unit to a pro-bridi (`klama cei broda`). `tanru-unit-1` attaches linked arguments, `be ... bei ... be'o`, which fill the places of that one unit rather than of the whole bridi (CLL 5.7). `tanru-unit-2` lists the simple units:

- A brivla
- A pro-bridi `go'i` with optional `ra'o`
- A `ke ... ke'e` grouped selbri
- `me sumti me'u`, which turns a sumti into a selbri, optionally with a following `moi`
- A number or lerfu string with `moi`, `mei` or the others of MOI
- `nu'a` before an operator
- A conversion: `se`, `te`, `ve` or `xe`
- `jai` with an optional tense or modal
- A `zei` compound of any words
- A scalar negation `na'e`
- An abstraction: `nu`, `ka`, `du'u` or another word of NU before a subsentence, closed by `kei`

The `SE`, `JAI` and `NAhE` forms refer back to `tanru-unit-2`, so `se se broda` and `na'e se broda` are single units. A jek or joik can connect several abstraction words (`nu je ka`). The word stage builds each `zei` compound and hands on one `BRIVLA`, so the `ZEI` alternative never matches. This grammar keeps that alternative as CLL prints it.

```jbogenbau
%rule selbri
  | selbri-1
  | $g(tag) $s(selbri-1) <matches($g, stag) ⟹ tags($s)>

%rule selbri-1
  selbri-2 | NA # selbri

%rule selbri-2
  selbri-3 | selbri-3 CO # selbri-2

%rule selbri-3
  selbri-4 ...

%rule selbri-4
  selbri-5 [plain-joik-jek selbri-5 | joik-before-ke selbri-5-not-ke-group | joik [stag] KE # selbri-3 [KEhE #]] ...

%rule selbri-5
  selbri-6 | selbri-6 (jek | joik) [stag] BO # selbri-5

%rule selbri-6
  tanru-unit | tanru-unit BO # selbri-6 | [NAhE #] guhek selbri gik selbri-6

%rule tanru-unit
  tanru-unit-1 [CEI # tanru-unit-1] ...

%rule tanru-unit-1
  tanru-unit-2 | tanru-unit-2 linkargs

%rule tanru-unit-2
  | BRIVLA #
  | GOhA [RAhO] #
  | KE # selbri-3 [KEhE #] <~ke-group>
  | ME # sumti [MEhU #] [MOI #]
  | (number | lerfu-string) MOI #
  | NUhA # mex-operator
  | SE # tanru-unit-2
  | JAI # [tag] tanru-unit-2
  | any-word (ZEI any-word) ...
  | NAhE # tanru-unit-2
  | NU [NAI] # [joik-jek NU [NAI] #] ... subsentence [KEI #]

%rule linkargs
  BE # term [links] [BEhO #]

%rule links
  BEI # term [links]
```

## Numbers, lerfu strings and mekso

A number is a string of PA words, such as the digits `pa` and `re` and the decimal point `pi`. Lerfu words can be mixed into it after the first word (`pa re ci`, `pa xy.`). A lerfu string is the same thing, but it begins with a lerfu word (CLL 18.2, 17.9). A lerfu word is a member of BY, any word followed by `bu`, a `lau` shift before a lerfu word, or a `tei ... foi` compound. The word stage builds each letter word with `bu` and hands on one `BY`, so the `BU` alternative never matches. This grammar keeps that alternative as CLL prints it.

A quantifier is a number closed by `boi` or a mekso in `vei ... ve'o` brackets (CLL 18.6). A mekso is a mathematical expression, and the rules follow CLL 18 closely. `mex` is a sequence of `mex-1` joined by operators in afterthought infix form, `li pa su'i re`, or a reverse Polish expression introduced by `fu'a`. `mex-1` is the `bi'e` form, which binds an operator more tightly than its neighbors (CLL 18.5). `mex-2` is an operand, or a forethought operator followed by its operands. An optional `pe'o` comes before the operator, and an optional `ku'e` closes the form.

In reverse Polish notation, an expression is two operands followed by an operator, and each operand can itself be such an expression.

Operators have their own connectives and grouping, in the same shape as selbri. `operator` joins operators by jek or joik or a `ke` group. As in `selbri-4`, its plain connective is `plain-joik-jek`. So `li ci su'i joi ke pi'i ke'e re du li xa` joins `su'i` to the group `ke pi'i ke'e` through `joik [stag] KE`. `operator-1` gives the guhek forethought and the `bo` forms. `operator-2` is a simple operator or a `ke ... ke'e` group.

The `bo` form joins two operators by a jek or joik with `bo`, as in `li pa su'i je bo pi'i re` (rule 371 of the printed grammar). CLL 14.17 says that jeks and joiks with `bo` are not allowed for operators. But chapter 21 prints the form, and CLL 14.18 says that operators can have a tense in their logical connectives, as tanru units can. A jek takes a tense only in the `bo` form, as in `li pa su'i je pu bo pi'i re`. This grammar follows chapter 21 and keeps the form. The official parser accepts it too.

A simple `mex-operator` is a VUhU word, possibly converted by `se` or negated by `na'e`. It can also be an operator made from a mekso through `ma'o`, or a selbri used as an operator through `na'u`. `te'u` closes these last two.

Operands connect in the same way. `operand` takes a `ke` group, `operand-1` the afterthought connectives, and `operand-2` the `bo` form. `operand-3` lists the simple operands:

- A quantifier
- A lerfu string
- A selbri through `ni'e`
- A sumti through `mo'e`
- An array through `jo'i`
- A forethought connection
- A `la'e` or `na'e bo` reference

```jbogenbau
%rule quantifier
  number [BOI #] | VEI # mex [VEhO #]

%rule mex
  mex-1 [operator mex-1] ... | FUhA # rp-expression

%rule mex-1
  mex-2 [BIhE # operator mex-1]

%rule mex-2
  operand | [PEhO #] operator mex-2 ... [KUhE #]

%rule rp-expression
  rp-operand rp-operand operator

%rule rp-operand
  operand | rp-expression

%rule operator
  operator-1 [plain-joik-jek operator-1 | joik-before-ke operator-1-not-ke-group | joik [stag] KE # operator [KEhE #]] ...

%rule operator-1
  operator-2 | guhek operator-1 gik operator-2 | operator-2 (jek | joik) [stag] BO # operator-1

%rule operator-2
  | mex-operator
  | KE # operator [KEhE #] <~ke-group>

%rule mex-operator
  SE # mex-operator | NAhE # mex-operator | MAhO # mex [TEhU #] | NAhU # selbri [TEhU #] | VUhU #

%rule operand
  operand-1 [(ek | joik) [stag] KE # operand [KEhE #]]

%rule operand-1
  operand-2 [joik-ek operand-2] ...

%rule operand-2
  operand-3 [(ek | joik) [stag] BO # operand-2]

%rule operand-3
  | quantifier
  | lerfu-string [BOI #]
  | NIhE # selbri [TEhU #]
  | MOhE # sumti [TEhU #]
  | JOhI # mex-2 ... [TEhU #]
  | gek operand gik operand-3
  | (LAhE # | NAhE BO #) operand [LUhU #]

%rule number
  PA [PA | lerfu-word] ...

%rule lerfu-string
  lerfu-word [PA | lerfu-word] ...

%rule lerfu-word
  BY | any-word BU | LAU lerfu-word | TEI lerfu-string FOI
```

## Logical and non-logical connectives

Lojban has one set of logical connectives, spelled differently for each level of the grammar (CLL 14.3):

- An ek joins sumti (`.e`, `.a`).
- A gihek joins bridi-tails (`gi'e`).
- A jek joins tanru units and, after `.i`, sentences (`je`).
- A gek is the forethought form (`ga ... gi`).

Each afterthought connective can be negated on either side, `na` before and `nai` after, and converted by `se`. A joik is a non-logical connective. It is `joi`, `ce`, `jo'u` and the rest of JOI, or an interval `bi'i` or `bi'o`, possibly bounded by `ga'o` or `ke'i` (CLL 14.14, 14.16). `joik-ek` and `joik-jek` are the pairs that stand in the same position. Each carries a free-modifier slot.

The ordinary alternative of `selbri-4` and `operator` joins two units with a plain connective. The other alternative, `joik [stag] KE`, groups with the connective itself. Where both alternatives read the same words, the official parser takes the `ke` group, through its lexer token `JOIK_KE`. Three rules state this choice. `plain-joik-jek` is a jek, or a joik that `ke` does not directly follow.

`joik-before-ke` is a joik that `ke` directly follows. The unit after it cannot be only a `ke` group: `selbri-5-not-ke-group` and `operator-1-not-ke-group` say this. They read the tag `~ke-group` of the unit that the parse built, as `bridi-tail-1-final` does (see "Sentences and bridi-tails"). The `ke` alternatives of `tanru-unit-2` and `operator-2` carry that tag, and a unit of one part passes it up. So the test sees the same elided terminators as the parse, and `mi broda joi ke me le le brodi brodo ku me'u ke'e`, whose inner `ku` is elided, is the `ke` group too. So the plain reading stays where the unit goes on after its `ke` group, as in `ke brode ke'e bo brodi`. The `ke` form cannot read that unit. A free modifier between the joik and `ke` also leaves only the plain reading, since the `ke` form has no slot there.

The `sumti` and `operand` rules have a joik-plus-`ke` form too. But no unit of their plain alternatives begins with `ke`, so they keep `joik-ek`. A jek has no `ke` form, so the condition does not apply to it.

A gek is a forethought logical connective, a joik used in forethought with `gi`, or a tense with `gi` (`pu gi ... gi`). A gik separates the two halves: `gi`, optionally negated. A guhek is the forethought connective of tanru units.

```jbogenbau
%rule ek
  [NA] [SE] A [NAI]

%rule gihek
  [NA] [SE] GIhA [NAI]

%rule jek
  [NA] [SE] JA [NAI]

%rule joik
  [SE] JOI [NAI] | interval | GAhO interval GAhO

%rule interval
  [SE] BIhI [NAI]

%rule joik-ek
  joik # | ek #

%rule joik-jek
  joik # | jek #

%rule plain-joik-jek
  | $j(joik) #
  | jek #
%conditions
  KE ⊈ tags(head(after($j)))

%rule joik-before-ke
  $j(joik) #
%conditions
  KE ⊆ tags(head(after($j)))

%rule selbri-5-not-ke-group
  $u(selbri-5)
%conditions
  ~ke-group ⊈ tags($u)

%rule operator-1-not-ke-group
  $u(operator-1)
%conditions
  ~ke-group ⊈ tags($u)

%rule gek
  [SE] GA [NAI] # | joik GI # | stag gik

%rule guhek
  [SE] GUhA [NAI] #

%rule gik
  GI [NAI] #
```

## Tenses and modals

A tense or modal (the rule `tag`) turns a sumti into a modal or tense term (CLL 9 and 10). It also marks a selbri or a whole sentence with a tense. `tag` is one or more tense-modals joined by jek or joik, `pu je ca`. `stag` is the restricted form that is allowed inside connectives before `bo` and `ke`, and in a gek. If `stag` includes a free-modifier slot there, the grammar becomes ambiguous.

A `tense-modal` is a simple tense-modal with a free-modifier slot, or `fi'o selbri fe'u`, which makes a modal from any selbri (CLL 9.5). A `simple-tense-modal` is one of these:

- A BAI modal
- A time tense, a space tense, or both with time first, then optionally a CAhA word such as `ka'e`. A CAhA word can also stand alone (`pu`, `va`, `pu va`, `ka'e`, `pu ka'e`).
- The sticky tense `ki`
- The question word `cu'e`

`ki` sets a reference point (CLL 10.13). `se` can convert a BAI modal. `na'e` can negate a BAI modal or a tense, and `ki` can follow either. CLL 10.4 puts time before space in one tense. The printed rule also lets space come first, and this grammar does not (item 8 of "Differences from the printed CLL grammar").

A time tense is any combination of these, in this order (CLL 10.4 to 10.9):

- A `zi` distance
- Offsets `pu`, `ca`, `ba`, each with an optional distance
- An interval `ze'a` with an optional direction
- Interval properties

A space tense is likewise a `va` distance, `fa'a`-family offsets, a space interval, and a `mo'i` movement. A space interval is `ve'a` or `vi'a` or both, with an optional direction, and then interval properties. Either of those two parts can stand alone, as in `mi ve'a klama` and `mi fe'e ta'e klama`. `fe'e` before an interval property applies that property to space rather than time. An interval property is `roi` with a number, `ta'e` and the others of TAhE, or a ZAhO event contour. Each can take `nai`.

These rules allow more than some of CLL's prose and more than the lexer of the official parser. This grammar keeps them as printed, for these reasons:

- A space interval can have several `fe'e` groups, as in `mi fe'e di'i fe'e co'a klama`. The rule `space-int-props` (rule 1049) repeats `fe'e` with each property, and CLL 10.11 says that each space interval property takes its own `fe'e`. The official lexer allows one `fe'e` group, and reads the second as a new tense.
- A tense can hold a string of interval properties, as `time` (rule 1030) repeats them. CLL 10.21 says that a single tense can hold "strings of interval properties and event contours", as in example 10.161, `mi reroi ca'o xaroi darxi le damri`. The official lexer reads `mi ta'e di'i klama` as two tenses.
- A ZAhO event contour can come before a TAhE or ROI interval property, as in `mi co'a ta'e klama`. CLL 10.10 says that the TAhE or ROI comes first when a tense has both. But example 10.161 puts the ZAhO `ca'o` before the ROI `xaroi`, and the printed rules allow either order. The official parser accepts both of these texts.

```jbogenbau
%rule tag
  tense-modal [joik-jek tense-modal] ...

%rule stag
  simple-tense-modal [(jek | joik) simple-tense-modal] ...

%rule tense-modal
  simple-tense-modal # | FIhO # selbri [FEhU #]

%rule simple-tense-modal
  [NAhE] [SE] BAI [NAI] [KI] | [NAhE] ((time [space] | space) & CAhA) [KI] | KI | CUhE

%rule time
  ZI & time-offset ... & (ZEhA [PU [NAI]]) & interval-property ...

%rule time-offset
  PU [NAI] [ZI]

%rule space
  VA & space-offset ... & space-interval & (MOhI space-offset)

%rule space-offset
  FAhA [NAI] [VA]

%rule space-interval
  ((VEhA & VIhA) [FAhA [NAI]]) & space-int-props

%rule space-int-props
  (FEhE interval-property) ...

%rule interval-property
  number ROI [NAI] | TAhE [NAI] | ZAhO [NAI]
```

## Free modifiers, vocatives and indicators

A free modifier can stand wherever the grammar writes `#`, which is after almost every word (CLL 19.12). The forms are these:

- A `sei ... se'u` discursive bridi, `sei mi cusku`
- A `soi ... se'u` reciprocity marker
- A vocative phrase: `coi` or `doi` and their kin, followed by a selbri, by names, or by a sumti, and closed by `do'u`
- An utterance ordinal, `pa mai`
- A parenthetical text, `to ... toi`
- A subscript `xi` with a number, lerfu string or bracketed mekso

The `se'u`, `do'u`, `toi`, `boi` and `ve'o` here are elidable, but the grammar writes them without `#`. The slot that follows a free modifier is the one that it sits in.

A vocative is a run of COI words, each with an optional `nai`, or `doi`, or both in that order. Indicators are these:

- The attitudinals and discursives, `UI` and `CAI`, with an optional `nai`
- The hesitation `y`
- The cancel `da'o`
- `fu'o`, which closes a scope opened by `fu'e`

The `Y` alternative never applies here. The word stage reads `.y.` as hesitation and drops it, as the Magic Words proposal treats it as whitespace. So no `Y` reaches this grammar.

A run of indicators attaches to the word before it, as CLL's non-formal rule below says. That is why `indicators` appears only at the start of a text. CLL prints `indicators` as `[FUhE] indicator ...`, which lets only the first indicator of a run take `fu'e`. This grammar lets each indicator take its own `fu'e`, as after a word, since CLL 19.8 allows several `fu'e` scopes at once. A `fu'e` can stand at the start of a text, before its indicators, as rule 411 (`indicators`) allows. So `fu'e ui mi klama` is a text. The official parser rejects it.

```jbogenbau
%rule free
  | SEI # [terms [CU #]] selbri [SEhU]
  | SOI # sumti [sumti] [SEhU]
  | vocative [relative-clauses] selbri [relative-clauses] [DOhU]
  | vocative [relative-clauses] CMEVLA ... # [relative-clauses] [DOhU]
  | vocative [sumti] [DOhU]
  | (number | lerfu-string) MAI
  | TO text [TOI]
  | XI # (number | lerfu-string) [BOI]
  | XI # VEI # mex [VEhO]

%rule vocative
  (COI [NAI]) ... & DOI

%rule indicators
  ([FUhE] indicator) ...

%rule indicator
  (UI | CAI) [NAI] | Y | DAhO | FUhO
```

## The non-formal rules

CLL ends its grammar with four rules that it calls non-formal. A parser applies them before the grammar proper rather than through it (CLL 21). Two of them are the material of quotes. The word stage delimits every quote but `lu ... li'u`, and hands on a quoted word tagged `word` and a quoted unit tagged `quoted-text`. So here these two are ordinary rules:

```jbogenbau
%rule any-word
  ~word

%rule anything
  ~quoted-text
```

The stages before this one apply the other two. The indicator stage attaches `ba'e` and indicators to their words, and the word stage applies the erasers. The indicator stage lets several `ba'e` stand before one word, as in `mi ba'e ba'e klama`, where rule 1100 allows one. CLL 19.16 says that "Multiple BAhE cmavo may be used in succession". This document shows them as CLL prints them, for reference only. CLL does not define anywhere the `utterance` that `sa` erases.

```text
word = [BAhE] any-word [indicators]
null = any-word SI | utterance SA | text SU
```

## Choosing among parses

Because terminators can be omitted, some texts have more than one parse. The stage chooses among them by the rule that [the notation document](../../docs/notation.md) states under "Ambiguity" and "Elided terminators", with the resolution that each dialect declares. The cll-ebnf and bpfk dialects declare `late-elision elision-only`, and bpfk adds `maximal`. The experimental layer declares only `late-elision`.

So in each of them, a terminator is elided as late as the grammar allows. Two parses that elide the same terminators at the same places are tied, and a tie is an error. In cll-ebnf and bpfk, `elision-only` then checks the parse that the ranking chose. It runs only when the ranking chose one parse among several (the verdict `resolved`), not when the text has one parse (the verdict `unique`). A tie is an error before it runs. It writes the elided terminators of the chosen parse back into the text, and parses that text again with no terminator elidable. If the restored text has two readings or more, the text is an error. If it has one reading, or none, the check passes. So the check asks that the chosen completion have at most one reading. It does not test any other way to write the terminators back.

These two differ in where the part before an elided terminator can end. The cll-ebnf dialect takes the printed grammar as normative and lets it end wherever a parse of the whole text needs it ([`../dialects/cll-ebnf.md`](../dialects/cll-ebnf.md)). The bpfk dialect reads as the PEG grammars that the definition effort adopted, which never end it where a longer part is possible ([`../dialects/bpfk.md`](../dialects/bpfk.md)). A PEG is a parsing expression grammar. CLL's official parser reads in a third way, one lexeme (one token of its lexer) ahead, which no dialect here follows. The design document says why.

For example, `le sutra tavla` has two parses. One is a statement with the description `le sutra`, its `ku` elided before `tavla`, and the selbri `tavla`. The other is a fragment that consists of the single description `le sutra tavla`. The fragment elides its `ku` only at the end of the text.

`late-elision` takes the parse that elides a terminator later, so `le sutra tavla` is a fragment. A speaker who means the statement says `le sutra cu tavla` or `le sutra ku tavla`.

Note 10 of CLL 21.2 says that an elidable terminator "may be omitted (without change of meaning) if no grammatical ambiguity results". It does not say which parse a text has when the grammar allows more than one, so the ranking is a choice of this grammar's dialects. Nor does the note say how to check that no ambiguity results, so `elision-only` is a choice too. Both are chosen to fit the conventions of CLL. CLL does not state them.

In cll-ebnf, this reading accepts some texts that CLL's prose says need a terminator. In each of these texts, a parse of the whole text needs the terminator elided where CLL requires it, and the restored text has one reading. The official parser, which reads one lexeme ahead, rejects them. These passages of CLL say that the terminator is required, and this dialect does not follow them:

- CLL 14.14, after example 14.112: `le nanmu ku joi le ninmu cu klama le zarci` needs its first `ku`. Here `le nanmu joi le ninmu cu klama le zarci` parses, since `le` cannot continue a tanru after `joi`.
- CLL 18.6, after example 18.32, and CLL 17.9, after example 17.25: `boi` is required between two numbers or lerfu strings in a row. Here `li fu'a pa re su'i du li ci` parses, with `boi` elided after `pa`, since only that split parses. In the same way, `pa xy. cu barda` reads `pa` as a quantifier and `xy.` as a lerfu string. The bpfk dialect rejects both of these texts. Where the words can be one string, they are one string, so `.abu dunda by. cy.` reads `by. cy.` as one string, as CLL 17.9 says.
- CLL 18.6, after example 18.34: `boi` is required in `li zy du li ma'o fy.boi xy.`, since otherwise `xy.` would look like part of the operator name. Here `li zy du li ma'o fy. xy.` parses, with `boi` elided after `fy.`, and `xy.` is the operand. The bpfk dialect rejects it. `fy. xy.` can be one longer letter string, so `maximal` forbids the elided `boi`.
- CLL 18.11, after example 18.93: `me'u` is required in `ta me li ny. su'i pa me'u moi le'i mi ratcu`, so that `pa` and `moi` stay apart. Here `ta me li ny. su'i pa moi le'i mi ratcu` parses.
- CLL 18.17, after example 18.116: `lo'o` is required in `li re su'i re du li vo lo'o .onai lo nalseldjuno namcu`. Here `li re su'i re du li vo .onai lo nalseldjuno namcu` parses.
- CLL 8.6, on example 8.48: `ku'o` must appear in `le poi blabi ku'o gerku cu klama`. Here `le poi blabi gerku cu klama` parses. The bpfk dialect rejects it, since `maximal` forbids the elided `ku'o` where the clause can be longer, as `poi blabi gerku`.

## Differences from the printed CLL grammar

This grammar departs from the EBNF printed in CLL in eight places. The first settles a precedence that the printed text leaves open. The next three repair the EBNF's copy of the YACC grammar, the grammar of the official parser for the YACC parser generator. The EBNF uses that grammar as its source and cites its rule numbers. In each case, the YACC grammar has a path that the EBNF omits. The official parser accepts the text.

The fifth follows the prose of CLL 19.8, which allows more than the EBNF. The sixth and the seventh choose between two parses of the printed grammar, as the lexer of the official parser does. The seventh also follows the prose of CLL 14.10 and 14.18. The eighth follows the prose of CLL 10.4, which the printed rule contradicts. Apart from these, this grammar spells the printed grammar's `CMENE` as `CMEVLA`, the class that the word stage gives a name.

The stages before this one depart from CLL too. [The word stream](../words/stream.md) lists six departures from CLL 19 under "Departures from CLL 19". They concern `si`, `zei`, `bu`, hesitation, `lo'u` and `zoi`, which it reads as the Magic Words proposal does. [The indicator stage](../indicators/cll.md) lets a word take several `fu'e` groups and several `ba'e`. Rule 1100 allows one `ba'e`, and rule 411, its `indicators`, allows one `fu'e` group. The [word forms](../words/cll.md) and the [CLL word stream](../words/cll-stream.md) describe their own choices and extensions, such as a cmavo like `ka'y` that uses `y` as a vowel. This section and those documents together describe where the dialect departs from CLL.

1. In `simple-tense-modal`, the printed text reads `[NAhE] (time [space] | space [time]) & CAhA [KI]`. CLL 21.2 says that `...` binds closer than `&`, and `&` closer than `|`. It never ranks juxtaposition against `&`. This grammar reads juxtaposition as binding tighter, as its notation does. Under that reading, the printed rule attaches `[NAhE]` only to the time and space branch, and `[KI]` only to the `CAhA` branch. So this grammar reads `[NAhE] ((time [space] | space [time]) & CAhA) [KI]`, with the time and space part narrowed as item 8 says. Then `ba za ki` is one `simple-tense-modal`, and so is `na'e ka'e`. The repair also admits `pu ki` and `na'e ca'a`. The other reading, with `&` binding tighter, keeps rule 972 as meant but breaks rule 1030, the rule `time`, since it splits `ZEhA [PU [NAI]]`. So under either reading, one of the two rules needs parentheses. This grammar also writes `time` with parentheses that the printed rule does not have, `(ZEhA [PU [NAI]])`. Under the reading that this grammar uses, they change nothing.
2. A text can begin with `.i` separators followed by `ni'o` markers, as in `.i ni'o mi klama`. The printed `text-1` makes the two alternatives. YACC rule 2 (`text_B_2`) lets any number of `.i` forms precede a `ni'o` run. The camxes grammars call the printed form "a bug in the BNF".
3. A `lo'u ... le'u` quote can be empty, `lo'u le'u`. The printed `sumti-6` requires at least one word. YACC rule 436 reads the body of the quote as one token that can be empty.
4. The free-modifier slot after a `lu ... li'u` quote follows the quote whether or not `li'u` is written, so `lu cy. to toi` is a quote followed by a parenthesis. The printed `sumti-6` writes `/LIhU#/`, which drops the slot with the elided `li'u`. YACC rule 432 (`quote_arg`) attaches free modifiers to the whole quote, and its `LIhU` gap carries none. Every other elidable terminator keeps its slot as printed.
5. A run of indicators can hold several groups, each with its own `fu'e`, as in `ui fu'e ia mi klama`. The printed `indicators` reads `[FUhE] indicator ...`, one group. CLL 19.8 lets a local attitudinal stand beside the ones that `fu'e` marks. The indicator stage reads the run after a word the same way.
6. In `selbri-4` and `operator`, a plain joik directly before `ke` cannot take a unit that is only a `ke` group (`joik-before-ke`). The condition reads the tag `~ke-group` of the parsed unit, as item 7 does. The printed grammar reads `mi broda joi ke brode ke'e` in two ways. The lexer of the official parser makes `joi ke` one token, `JOIK_KE`, so it reads only the `ke` group joined by `joi`. That lexer also rejects `mi broda joi ke brode ke'e bo brodi`, which has only the plain reading. This grammar keeps the plain reading there, as the printed grammar does.
7. In `bridi-tail-1-final`, the last tail after a plain gihek cannot be one `ke` group with one run of tail terms. Those are the words that the `ke` form of `bridi-tail` can read as a group of tails. `bridi-tail-1-final` is the printed `bridi-tail-1` with its last plain connection written apart, so the condition needs no lookahead. It reads the tags `~ke-group` and `~vau-written` of the parsed tail. It also tests whether tail terms follow the tail. To pass the tags up, eight rules write an optional part as two alternatives, which read the same words in the same way. Item 6 reads `~ke-group` too. The printed grammar reads `mi broda gi'e ke brode ke'e` in two ways: a `ke` group of tails after `gi'e` (rule 50), or a plain `gi'e` (rule 51) before a tail whose selbri is a `ke` tanru unit. The elided terminators cannot choose: the two parses tie when `ke'e` is elided at the end, and `late-elision` takes the tanru when `ke'e` is written. CLL 14.10 groups tails with `ke` after a gihek, and CLL 14.18 puts a tense between a gihek and `ke`, which the tanru parse moves onto the selbri. The lexer of the official parser makes `gi'e ke` one token, `GIhEK_KE`, so it reads only the group. That lexer also rejects `mi broda gi'e ke brode ke'e brodi`, which has only the plain reading. This grammar keeps the plain reading there, as the printed grammar does.
8. In `simple-tense-modal`, space cannot come before time. The printed rule reads `time [space] | space [time]`, and the YACC grammar also lets space come before time. CLL 10.4 says that when a tense has both, time comes first. It gives the reason: if space could come before or after time at will, some constructions would be ambiguous. This grammar reads `time [space] | space`. So `mi va pu klama` reads as the term `va` followed by the selbri `klama` with the tense `pu`, as the official parser reads it. Under the printed rule, the dialect's ranking read `va pu` there as one tense. `mi fe'e di'i co'a klama` also splits. Without its own `fe'e`, `co'a` is an event contour of time (CLL 10.10), not a space interval modifier (CLL 10.11). A time modifier cannot follow space in one tense. So `fe'e di'i` is a term, and `co'a` is the tense of `klama`. The official parser reads `fe'e di'i co'a` as one tense, with one `fe'e` over both properties. Where a term can stand before the tense, the space part becomes a term (`mi va pu klama`, `va pu gi mi klama gi do cadzu`). The official parser rejects the second text. Elsewhere the text is now an error. That covers a tense in a connective before `bo` or `ke`, as in `mi .e vi pu bo do klama`, `mi broda gi'e va pu ke brode ke'e` and `li pa su'i je va pu bo pi'i re`. It also covers a tense before `tu'e`, after `jai`, and on the selbri of a description (`lo va pu broda`). The printed grammar accepts these texts, and the official parser rejects them. `mi viska va pu gi do gi la djan` tied before. Now `late-elision` chooses one reading: `va` tags the sumti `pu gi do gi la djan`, as in the official parser. The other reading, `va` with `ku` elided and then that sumti, elides one more terminator. No example in CLL writes space before time.

This grammar keeps the free-modifier slot after an elided terminator as printed: an elided `[X #]` leaves no slot. So a free modifier cannot follow an elided `boi`, and where CLL example 17.38 writes `xy. xi ky.`, this grammar requires `xy. boi xi ky.`. CLL itself says so in two places. In CLL 14.17, after example 14.154, `xy. boi xi vei by. ce'o dy.`, it says that "the boi in [that example] is not elidable, because the xi subscript needs something to attach to". CLL 6.11 says that free modifiers can stand after any elidable terminator, "which, however, must not then be elided". The one exception is `li'u`, as item 4 above says.
