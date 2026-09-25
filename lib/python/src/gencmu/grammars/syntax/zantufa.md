# The Zantufa constructs

This document is the Zantufa dialect's addition to the experimental syntax grammar, [`experimental.md`](experimental.md): the constructs of Guskant's Zantufa grammar, version 1.9999, that go beyond it. It is stitched after that grammar in the syntax stage of the Zantufa dialect, [`../dialects/zantufa.md`](../dialects/zantufa.md), so every rule here either is new, adds alternatives to a rule of the experimental grammar with `%extend-rule`, or restates one with `%redefine-rule`, replacing it. The notation is explained in [the notation document](../../docs/notation.md).

Most of the constructs are behind features, which the Zantufa dialect enables: `zantufa-connectives`, `zantufa-terms`, `zantufa-tags` and `zantufa-mex`, each named in its section. A few are unguarded: they extend the experimental grammar over text it rejects, so they cannot change a reading it already has. Where a Zantufa form generalizes an older form over the same text, the rule is restated with the two under complementary guards, `@¬feature?` on the old one and `@feature?` on the new, so that the two never compete; that is why most changes here replace a rule rather than extend it.

The Zantufa cmavo, `mu'ei` in ROI, `xe'u`, `no'oi` in NOhOI and the others, come from the experimental lexicon and need no grammar change.

Two more terminators are elidable here:

```jbogenbau
%elidable FIhAU GIhI LIhAU
```

## Statements

A statement may be a forethought connection of statements, `ga broda gi brode gi brodi gi'i`, with any number of `gi` branches and an optional closing `gi'i` (`zantufa-connectives`); under that feature the statement-level `bo` and `ke` continuations are disabled, since the forethought form takes their place. A statement may be followed by terms, optionally introduced by `i'au`, which supply arguments after the bridi is complete (`zantufa-terms`).

```jbogenbau
%redefine-rule paragraph
  | @¬zantufa-terms? (statement | fragment) [I # [statement | fragment]] ...
  | @zantufa-terms? (statement | fragment | statement (IhAU # [terms] | terms))
      [I # [statement | fragment | statement (IhAU # [terms] | terms)]] ...

%redefine-rule statement-3
  | @¬zantufa-connectives? sentence
      [ bridi-tail-connective [stag] BO # subsentence
      | selbri-connective [stag] KE # subsentence [KEhE] #
      ] ...
  | @zantufa-connectives? sentence
  | [tag] TUhE # text-1 [TUhU] #
  | @zantufa-connectives? gek statement gik statement [(gik statement) ...] [GIhI] #
```

## Bridi-tails

A forethought `gek-sentence` may take further `gi` branches and end in `gi'i` (`zantufa-connectives`), and `ke bridi-tail ke'e` followed by tail terms is a bridi-tail (`zantufa-terms`), so that a group of connected tails can share arguments.

```jbogenbau
%redefine-rule gek-sentence
  | @¬zantufa-connectives? gek subsentence gik subsentence tail-terms
  | @zantufa-connectives? gek subsentence gik subsentence [(gik subsentence) ...] [GIhI] # tail-terms
  | [tag] KE # gek-sentence [KEhE] #
  | NA # gek-sentence

%extend-rule bridi-tail-3
  @zantufa-terms? KE # bridi-tail [KEhE] # tail-terms
```

## Terms

A forethought termset may take further `gi` branches and end in `gi'i` (`zantufa-connectives`); `jai [tag] sumti` is a term (`zantufa-tags`), the argument-raising `jai` applied to a sumti rather than to a selbri; and `noi'a selbri ku` is the briga'i form of the selbri relative term, unguarded.

```jbogenbau
%redefine-rule termset
  | @¬zantufa-connectives? [NUhI #] gek terms [NUhU] # gik terms [NUhU] #
  | @zantufa-connectives? [NUhI #] gek terms [NUhU] # gik terms [NUhU] # [(gik terms [NUhU] #) ...]
      [GIhI] #
  | NUhI # terms-not-starting-with-bare-gek [NUhU] #
  | KE # terms [KEhE] #

%redefine-rule termset-with-nuhi
  | @¬zantufa-connectives? NUhI # gek terms [NUhU] # gik terms [NUhU] #
  | @zantufa-connectives? NUhI # gek terms [NUhU] # gik terms [NUhU] # [(gik terms [NUhU] #) ...]
      [GIhI] #
  | NUhI # terms-not-starting-with-bare-gek [NUhU] #
  | KE # terms [KEhE] #

%redefine-rule term-3
  | sumti
  | tagged-term
  | termset
  | NA KU #
  | NA #
  | NOIhA # selbri [FEhU] #
  | FIhOI # statement [FIhAU] #
  | SOI # statement [SEhU] #
  | NOIhA # selbri KU #
  | @zantufa-tags? JAI # [tag] sumti

%redefine-rule term-3-not-starting-with-bare-gek
  | sumti
  | tagged-term
  | termset-with-nuhi
  | NA KU #
  | NA #
  | NOIhA # selbri [FEhU] #
  | FIhOI # statement [FIhAU] #
  | SOI # statement [SEhU] #
  | NOIhA # selbri KU #
  | @zantufa-tags? JAI # [tag] sumti
```

## Sumti

A forethought sumti connection may take further `gi` branches and end in `gi'i` (`zantufa-connectives`), and `ra'oi` quotes a single word as a sumti, delimited by the word stage; the quote is unguarded.

```jbogenbau
%redefine-rule sumti-4
  | sumti-5
  | @¬zantufa-connectives? gek sumti gik sumti-4
  | @zantufa-connectives? gek sumti gik sumti-4 [(gik sumti-4) ...] [GIhI] #

%redefine-rule sumti-6
  | (LAhE # | NAhE BO #) [relative-clauses] sumti [LUhU] #
  | NAhE # sumti [LUhU] #
  | (LAhE # | NAhE BO #) (tag | FA #) sumti [LUhU] #
  | KOhA #
  | lerfu-string free-after-elided-boi
  | @¬cbm? LA # [relative-clauses] CMEVLA ... #
  | (LA | LE) # sumti-tail [KU] #
  | (LA | LE) # jek (LA | LE) # sumti-tail [KU] #
  | LOhOI # [(joik # | jek #) LOhOI #] ... statement [KUhAU] #
  | LI # mex [LOhO] #
  | ZO any-word #
  | MAhOI any-word #
  | LU text [LIhU] #
  | LOhU [any-word ...] LEhU #
  | ZOI any-word anything any-word #
  | ZOhOI anything #
  | LAhOI anything #
  | MEhOI anything #
  | RAhOI anything #

%redefine-rule sumti-connective
  ek # | jehi # | joik # | VUhU #

%rule jehi
  [NA] [SE] JEhI [NAI]
```

## Relative clauses

A `noi` relative clause contains a statement rather than a subsentence, so it may hold connected sentences, `poi broda .i je brode` (`zantufa-terms`).

```jbogenbau
%redefine-rule relative-clause
  | GOI # term [GEhU] #
  | @¬zantufa-terms? NOI # subsentence [KUhO] #
  | @zantufa-terms? NOI # statement [KUhO] #
```

## Selbri

A forethought guhek connection may take further `gi` branches and end in `gi'i` (`zantufa-connectives`), and an abstraction contains a statement rather than a subsentence (`zantufa-terms`). Four tanru units are unguarded: `mu'oi` delimited quotes and `lu'ei text li'au` as selbri, `me` around a raw mekso, a run of operators or a tag, and a raw mekso before MOI.

```jbogenbau
%redefine-rule selbri-6
  | tanru-unit [[stag] BO # selbri-6]
  | @¬zantufa-connectives? [NAhE #] guhek selbri gik selbri-6
  | @zantufa-connectives? [NAhE #] guhek selbri gik selbri-6 [(gik selbri-6) ...] [GIhI] #

%redefine-rule selbri-6-not-starting-with-ke
  | tanru-unit-not-starting-with-ke [[stag] BO # selbri-6]
  | @¬zantufa-connectives? [NAhE #] guhek selbri gik selbri-6
  | @zantufa-connectives? [NAhE #] guhek selbri gik selbri-6 [(gik selbri-6) ...] [GIhI] #

%redefine-rule tanru-unit-2
  | KE # selbri-3 [KEhE] #
  | BRIVLA #
  | @cbm? CMEVLA #
  | GOhA [RAhO] #
  | ME # sumti [MEhU] # [MOI #]
  | (number | lerfu-string) MOI #
  | NUhA # mex-operator
  | SE # tanru-unit-2
  | JAI # [tag] tanru-unit-2
  | any-word (ZEI any-word) ...
  | NAhE # tanru-unit-2
  | @¬zantufa-terms? NU [NAI] # [joik-jek NU [NAI] #] ... subsentence [KEI] #
  | @zantufa-terms? NU [NAI] # [joik-jek NU [NAI] #] ... statement [KEI] #
  | linkargs tanru-unit-2
  | XOhI # tag
  | GOhOI anything #
  | ZEhOI anything #
  | TAhAI anything #
  | BOhEI anything #
  | MUhOI any-word anything any-word #
  | LUhEI # text [LIhAU] #
  | ME # (zantufa-raw-mex | mex-operator ... | tag) [MEhU] # [MOI #]
  | zantufa-raw-mex MOI #

%redefine-rule tanru-unit-2-not-starting-with-ke
  | BRIVLA #
  | @cbm? CMEVLA #
  | GOhA [RAhO] #
  | ME # sumti [MEhU] # [MOI #]
  | (number | lerfu-string) MOI #
  | NUhA # mex-operator
  | SE # tanru-unit-2
  | JAI # [tag] tanru-unit-2
  | any-word (ZEI any-word) ...
  | NAhE # tanru-unit-2
  | @¬zantufa-terms? NU [NAI] # [joik-jek NU [NAI] #] ... subsentence [KEI] #
  | @zantufa-terms? NU [NAI] # [joik-jek NU [NAI] #] ... statement [KEI] #
  | linkargs tanru-unit-2
  | XOhI # tag
  | GOhOI anything #
  | ZEhOI anything #
  | TAhAI anything #
  | BOhEI anything #
  | MUhOI any-word anything any-word #
  | LUhEI # text [LIhAU] #
  | ME # (zantufa-raw-mex | mex-operator ... | tag) [MEhU] # [MOI #]
  | zantufa-raw-mex MOI #
```

## Free modifiers

A `sei` discursive contains a statement rather than a bare selbri (`zantufa-terms`), and a raw mekso before `mai` is an utterance ordinal (`zantufa-mex`).

```jbogenbau
%redefine-rule free
  | @¬zantufa-terms? SEI # [terms [CU #]] selbri [SEhU]
  | @zantufa-terms? SEI # statement [SEhU]
  | SOI # sumti [sumti] [SEhU]
  | vocative [relative-clauses] selbri [relative-clauses] [DOhU]
  | @¬cbm? vocative [relative-clauses] CMEVLA ... # [relative-clauses] [DOhU]
  | vocative [sumti] [DOhU]
  | (number | lerfu-string) MAI
  | TO text [TOI]
  | XI # (number | lerfu-string) [BOI]
  | XI # VEI # mex [VEhO]
  | LOhAI [any-word ...] [SAhAI [any-word ...]] LEhAI
  | SAhAI [any-word ...] LEhAI
  | LEhAI
  | @zantufa-mex? zantufa-raw-mex MAI

%redefine-rule free-not-starting-with-number
  | @¬zantufa-terms? SEI # [terms [CU #]] selbri [SEhU]
  | @zantufa-terms? SEI # statement [SEhU]
  | SOI # sumti [sumti] [SEhU]
  | vocative [relative-clauses] selbri [relative-clauses] [DOhU]
  | @¬cbm? vocative [relative-clauses] CMEVLA ... # [relative-clauses] [DOhU]
  | vocative [sumti] [DOhU]
  | TO text [TOI]
  | XI # (number | lerfu-string) [BOI]
  | XI # VEI # mex [VEhO]
  | LOhAI [any-word ...] [SAhAI [any-word ...]] LEhAI
  | SAhAI [any-word ...] LEhAI
  | LEhAI
```

## Connectives and tags

A jek before `gi` is a gek, and `bo` may follow any `gi` gek, both unguarded; under `zantufa-connectives` the connective may come after `gi`, `gi je broda gi brode`.

A tag may carry any sequence of two or more `na'e` and `se` prefixes before a simple tense atom, `se se pu`, `na'e na'e ca` (`zantufa-tags`). `zantufa-tag-prefixes` is defined so as not to overlap the flat `[NAhE] [SE]` forms of the experimental grammar, which keeps the two readings from competing.

```jbogenbau
%redefine-rule gek
  | [SE] GA [NAI] #
  | joik GI # [BO #]
  | jek GI # [BO #]
  | stag gik [BO #]
  | @zantufa-connectives? GI (joik | jek) # [BO #]

%extend-rule simple-tense-modal
  @zantufa-tags? zantufa-tag-prefixes zantufa-tag-atom

%rule zantufa-tag-prefixes
  | SE SE [NAhE | SE] ...
  | SE NAhE [NAhE | SE] ...
  | NAhE NAhE [NAhE | SE] ...
  | NAhE SE (NAhE | SE) [NAhE | SE] ...

%rule zantufa-tag-atom
  FA | PU | ZI | ZEhA | VA | FAhA | VEhA | VIhA | CAhA | ZAhO | CUhE | KI
```

## Mekso

A raw mekso, one written without `li` or `vei`, is a quantifier (`zantufa-mex`), and a bare mekso is a fragment. Infix mekso may chain several operators and omit a trailing operand (`pa su'i`); reverse Polish mekso takes trailing operator groups; `bo` and `ke ... ke'e` group operands; `ma'o selbri`, `ma'o sumti` and a joik or ek are operators; `na'e operand` and `mo'e selbri` are operands. Where a Zantufa form generalizes a CLL form over the same text, the feature replaces the older alternative.

```jbogenbau
%extend-rule quantifier
  @zantufa-mex? zantufa-raw-mex

%extend-rule fragment
  @¬zantufa-mex? zantufa-raw-mex

%redefine-rule mex
  | @¬zantufa-mex? mex-1 [operator mex-1] ...
  | @zantufa-mex? mex-1 [operator ... [mex-1]] ...
  | @¬zantufa-mex? FUhA # rp-expression
  | @zantufa-mex? FUhA # mex-2 ... operator [(mex-2 ... operator) | (operator)] ... [KUhE] #

%extend-rule mex-2
  @zantufa-mex? operand (BO # operand) ... | @zantufa-mex? KE # operand ... [KEhE] #

%extend-rule mex-operator
  @zantufa-mex? MAhO # selbri [TEhU] # | @zantufa-mex? MAhO # sumti [TEhU] # | @zantufa-mex? joik-ek

%redefine-rule operand-1
  @¬zantufa-mex? operand-2 [joik-ek operand-2 | jek # operand-2] ... | @zantufa-mex? operand-2

%redefine-rule operand-3
  | number free-after-elided-boi
  | VEI # mex [VEhO] #
  | lerfu-string free-after-elided-boi
  | NIhE # selbri [TEhU] #
  | MOhE # sumti [TEhU] #
  | JOhI # mex-2 ... [TEhU] #
  | gek operand gik operand-3
  | (LAhE # | NAhE BO #) operand [LUhU] #
  | @zantufa-mex? NAhE # operand-3
  | @zantufa-mex? MOhE # selbri [TEhU] #
```

A raw mekso quantifier may not be a plain number, and may not begin with a lerfu string, `la'e`, `na'e`, `se` or `ke`. Without that restriction `my jo'u gy` would tie between a connected sumti and the mekso `my jo'u` quantifying `gy`. The `zantufa-raw-*` rules state it: they repeat the left spine of the mekso rules and constrain only the leftmost symbol. The restriction also applies to the first operand after a `gek`, so that `ge nai abu gi no drata` is a forethought sumti connection rather than the quantifier `ge nai abu gi no` before the selbri `drata`. Inside a mekso operand, `quantifier` is spelled out as `number` or `vei mex ve'o`, so that the raw-mekso quantifier does not re-enter itself.

```jbogenbau
%rule zantufa-raw-mex
  | zantufa-raw-mex-1 (operator ... [mex-1]) ...
  | zantufa-raw-mex-2 BIhE # operator mex-1
  | zantufa-raw-operand
  | PEhO # operator mex-2 ... [KUhE] #
  | zantufa-raw-operator mex-2 ... [KUhE] #
  | FUhA # rp-expression

%rule zantufa-raw-mex-1
  zantufa-raw-mex-2 [BIhE # operator mex-1]

%rule zantufa-raw-mex-2
  | zantufa-raw-operand-0
  | PEhO # operator mex-2 ... [KUhE] #
  | zantufa-raw-operator mex-2 ... [KUhE] #
  | @zantufa-mex? zantufa-raw-operand-0 (BO # operand) ...

%rule zantufa-raw-operand
  | NIhE # selbri [TEhU] #
  | MOhE # sumti [TEhU] #
  | MOhE # selbri [TEhU] #
  | JOhI # mex-2 ... [TEhU] #
  | gek zantufa-raw-operand-0 gik operand-3

%rule zantufa-raw-operator
  zantufa-raw-operator-1 [joik-jek operator-1 | joik [stag] KE # operator [KEhE] #] ...

%rule zantufa-raw-operator-1
  | zantufa-raw-mex-operator
  | guhek operator-1 gik operator-2
  | zantufa-raw-mex-operator (jek | joik) [stag] BO # operator-1

%rule zantufa-raw-mex-operator
  | MAhO # mex [TEhU] #
  | NAhU # selbri [TEhU] #
  | VUhU #
  | @zantufa-mex? MAhO # selbri [TEhU] #
  | @zantufa-mex? MAhO # sumti [TEhU] #
  | @zantufa-mex? joik-ek

%rule zantufa-raw-operand-0
  zantufa-raw-operand-1 [(ek | joik) [stag] KE # operand [KEhE] #]

%rule zantufa-raw-operand-1
  | @¬zantufa-mex? zantufa-raw-operand-2 [joik-ek operand-2 | jek # operand-2] ...
  | @zantufa-mex? zantufa-raw-operand-2

%rule zantufa-raw-operand-2
  zantufa-raw-operand-3 [(ek | joik) [stag] BO # operand-2]

%rule zantufa-raw-operand-3
  | number free-after-elided-boi
  | VEI # mex [VEhO] #
  | NIhE # selbri [TEhU] #
  | MOhE # sumti [TEhU] #
  | JOhI # mex-2 ... [TEhU] #
  | gek zantufa-raw-operand-0 gik operand-3
  | @zantufa-mex? MOhE # selbri [TEhU] #
```
