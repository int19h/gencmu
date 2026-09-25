# The experimental grammar

This document is a layer over [the CLL grammar](cll.md), the grammar printed in chapter 21 of *The Complete Lojban Language*. The [experimental](../dialects/experimental.md) dialect stitches it after that grammar. The [Zantufa](../dialects/zantufa.md) dialect stitches [zantufa.md](zantufa.md) after both. The layer adds the experimental constructs that have grown up in use since CLL was printed. The grammar always accepts some of them, and a feature that is not specific to Zantufa guards others. Their reference is camxes-exp, the experimental PEG grammar.

The layer restates each CLL rule that it changes with `%redefine-rule`. It adds alternatives to a CLL rule with `%extend-rule`, and states its own rules with `%rule`. Each section below says what the layer changes in that part of the grammar. A rule that this document does not name is the CLL grammar's, as that document explains it.

The experimental lexicon gives the experimental cmavo their selma'o. For example, `mi'ai` is KOhA, `lei'e` is LE, `poi'i` is NU, `mu'ei` is ROI, `po'oi` is NOI and `xoi` is SOI. `no'oi` is NOhOI, with the terminator `ku'oi`. Some selma'o exist only here: `JEhI`, `NOIhA`, `LOhOI`, `NOhOI` and `KUhOI`. So do the single-word terminals `FIhOI`, `FIhAU`, `XOhI`, `KUhAU`, `LOhAI`, `SAhAI`, `LEhAI`, `MAhOI`, `ZOhOI`, `LAhOI`, `MEhOI`, `GOhOI`, `ZEhOI`, `TAhAI` and `BOhEI`. A class that CLL's dictionary does not give a CLL word is a weak tag in that lexicon. For example, `mo'o` is `?"KOhA"` beside its CLL MAI. So a parse that reads the word under its CLL selma'o wins at the first difference.

The notation is explained in [the notation document](../../docs/notation.md). The terminals are selma'o, and `any-word` and `anything` are the tags `word` and `foreign-text` that the word stage puts on the material of a quote. The layer uses two feature guards: `cbm`, the cmevla-brivla merger, and `term-hierarchy`. The Zantufa dialect enables both, and a caller can enable either.

Unlike the CLL grammar, this layer writes the free-modifier slot after an elidable terminator outside its brackets: `[X] #` where CLL has `[X #]`. So free modifiers can follow an elided terminator. Many rules below are restated for that alone. A number or lerfu string is kept maximal by `free-after-elided-boi`, which excludes a following free modifier that itself starts with a number or lerfu string.

Two directives set the layer up. `%ambiguity-resolution greedy` says how the stage chooses among parses. At the first difference between two parses, it takes the one that reads the next word. So an elided terminator is absent for as long as the grammar allows, as in the CLL dialect. The layer does not declare `elision-only`, because it has real ambiguities that are not about terminators. The greedy rule settles them:

- a bare `na` is a term, beside the `na` that negates a selbri
- under `cbm`, a name is also a selbri
- under `term-hierarchy`, terms can be joined by a connective and `bo`, and a tagged term can take the same connection

If the layer declared `elision-only`, each of those texts would be an error. `%elidable` adds the experimental terminators `fi'au`, `ku'au` and `ku'oi` to CLL's.

```jbogenbau
%ambiguity-resolution greedy
%elidable FIhAU KUhAU KUhOI
```

## The text and its paragraphs

The layer changes the text in three ways. `ce'e` can be the text-leading connective, so that a text can continue a termset of the text before it. The tense before `bo` in a text-leading `.i` can be a full `tag` and not only a `stag`. And `.i ni'o` can follow a `ni'o`, which is how usage writes a new topic inside a reply. At the start of a text, the CLL grammar's `text-1` already reads `.i ni'o`, as the repair of the printed grammar that it lists says. So `text-1` takes the form after a first run of `ni'o`, and `paragraphs` takes it after a later one.

```jbogenbau
%redefine-rule text
  | @¬cbm? [NAI ...] [CMEVLA ... # | (indicators & free ...)] [joik-jek | CEhE #] text-1
  | @cbm? [NAI ...] [indicators & free ...] [joik-jek | CEhE #] text-1

%redefine-rule text-1
  [(I [jek | joik] [[tag] BO] #) ...] [NIhO ... # [I # NIhO ... #]] [paragraphs]

%redefine-rule paragraphs
  paragraph [NIhO ... # (paragraphs | I # NIhO ... # [paragraphs])]
```

## Statements and fragments

The connective after `.i` can be an ek or a VUhU as well as a joik or jek. A statement connective can also precede `.i`, as in `mi klama joi .i do klama`. Both are `statement-connective`. The tag before `bo` after `.i` is a full `tag`, so `.i fi'o broda bo mi klama` parses. A sentence can go on at statement level with `connective [stag] bo subsentence` or with `connective [stag] ke subsentence ke'e`. That is where `mi klama .e bo do tavla` and `mi klama .e ke do tavla ke'e` attach, when the bridi-tail level cannot take them. A prenex can have no terms (`zo'u mi klama`).

CLL's `na` fragment is gone. A bare `na` is a term (see "Terms"), so `na` and `na na` are terms fragments. Only so do the two readings not compete.

```jbogenbau
%redefine-rule statement-1
  statement-2 [I statement-connective [statement-2] | statement-connective I # [statement-2]] ...

%redefine-rule statement-2
  statement-3 [I [statement-connective] [tag] BO # [statement-2]]

%redefine-rule statement-3
  | sentence
      [ bridi-tail-connective [stag] BO # subsentence
      | selbri-connective [stag] KE # subsentence [KEhE] #
      ] ...
  | [tag] TUhE # text-1 [TUhU] #

%rule statement-connective
  joik # | jek # | ek # | VUhU #

%redefine-rule fragment
  ek # | gihek # | quantifier | terms [VAU] # | prenex | relative-clauses | links | linkargs

%redefine-rule prenex
  [terms] ZOhU #
```

## Sentences and bridi-tails

`cu` can start a sentence with no leading terms, and terms can follow `cu` before the bridi-tail (`mi cu do klama`). The afterthought connective between bridi-tails can be a gihek, joik, jek, ek or VUhU (`bridi-tail-connective`), and an explicit `cu` can follow it. Only a gihek opens the `ke` bridi-tail grouping.

```jbogenbau
%redefine-rule sentence
  [terms] [CU # [terms]] bridi-tail

%redefine-rule bridi-tail
  bridi-tail-1 [gihek [stag] KE # bridi-tail [KEhE] # tail-terms]

%redefine-rule bridi-tail-1
  bridi-tail-2 [bridi-tail-connective [CU #] bridi-tail-2-not-starting-with-ke tail-terms] ...

%redefine-rule bridi-tail-2
  bridi-tail-3 [bridi-tail-connective [stag] BO # [CU #] bridi-tail-2 tail-terms]

%rule bridi-tail-2-not-starting-with-ke
bridi-tail-3-not-starting-with-ke [bridi-tail-connective [stag] BO # [CU #] bridi-tail-2 tail-terms]

%rule bridi-tail-3-not-starting-with-ke
  selbri-not-starting-with-ke tail-terms | gek-sentence

%redefine-rule gek-sentence
  gek subsentence gik subsentence tail-terms | [tag] KE # gek-sentence [KEhE] # | NA # gek-sentence

%rule bridi-tail-connective
  gihek # | selbri-connective

%rule selbri-connective
  joik # | jek # | ek # | VUhU #

%redefine-rule tail-terms
  [terms] [VAU] #
```

## Terms

Terms can be connected directly by a joik, jek, ek or VUhU (`term-connective`), so `mi joi do klama` has one term before its selbri. Tagged terms can be bound with `(joik | ek) bo`, and under `term-hierarchy` so can any terms. `pe'e` takes any statement connective. A forethought termset needs no `nu'i`, and `ke terms ke'e` is a termset. The new terms are these:

- a bare `na`
- `noi'a selbri fe'u`, a selbri attached as a relative to the bridi
- `fi'oi statement fi'au`, a statement as a term
- `soi statement se'u` as a term

The first term inside `nu'i ... nu'u` cannot itself be a bare forethought termset. If it could, it would repeat the `nu'i gek` form. The `-not-starting-with-bare-gek` chain states that restriction: it repeats the term rules with only the first term restricted.

```jbogenbau
%redefine-rule terms-1
  terms-2 [PEhE # statement-connective terms-2] ...

%redefine-rule term
  | term-3 [term-connective term-3] ...
  | tagged-term (joik # | ek #) BO # tagged-term
  | @term-hierarchy? term-3 (joik # | ek #) BO # term-3

%rule term-connective
  joik # | jek # | ek # | VUhU #

%rule term-3
  | sumti
  | tagged-term
  | termset
  | NA KU #
  | NA #
  | NOIhA # selbri [FEhU] #
  | FIhOI # statement [FIhAU] #
  | SOI # statement [SEhU] #

%rule tagged-term
  tag (sumti | [KU] #) | FA # (sumti | [KU #])

%redefine-rule termset
  | [NUhI #] gek terms [NUhU] # gik terms [NUhU] #
  | NUhI # terms-not-starting-with-bare-gek [NUhU] #
  | KE # terms [KEhE] #

%rule terms-not-starting-with-bare-gek
  terms-1-not-starting-with-bare-gek [terms-1] ...

%rule terms-1-not-starting-with-bare-gek
  terms-2-not-starting-with-bare-gek [PEhE # statement-connective terms-2] ...

%rule terms-2-not-starting-with-bare-gek
  term-not-starting-with-bare-gek [CEhE # term] ...

%rule term-not-starting-with-bare-gek
  | term-3-not-starting-with-bare-gek [term-connective term-3] ...
  | tagged-term (joik # | ek #) BO # tagged-term
  | @term-hierarchy? term-3-not-starting-with-bare-gek (joik # | ek #) BO # term-3

%rule term-3-not-starting-with-bare-gek
  | sumti
  | tagged-term
  | termset-with-nuhi
  | NA KU #
  | NA #
  | NOIhA # selbri [FEhU] #
  | FIhOI # statement [FIhAU] #
  | SOI # statement [SEhU] #

%rule termset-with-nuhi
  | NUhI # gek terms [NUhU] # gik terms [NUhU] #
  | NUhI # terms-not-starting-with-bare-gek [NUhU] #
  | KE # terms [KEhE] #
```

A tagged term whose tag is a bare `fa` has its free modifiers after the `fa`. It also has them after the `ku`, when the `ku` is written: `FA # [KU #]`. If the `ku` is elided, the two slots stand side by side, and a free modifier can sit in either. So the elided `ku` takes its slot with it here, as the CLL grammar's terminators do.

## Sumti

Sumti connectives are ek, JEhI, joik or VUhU (`sumti-connective`). After `vu'o`, a connected sumti can follow the relative clauses or replace them. Under `cbm` a cmevla is a selbri word, so the `la CMEVLA` name form is removed and `la .alis.` is a description. The new sumti are these:

- `na'e sumti lu'u`, without `bo`
- `la'e` or `na'e bo` around a tagged sumti
- a description whose two descriptors are joined by a jek (`lo je le broda`)
- `lo'oi statement ku'au`, a description of a statement, with connected heads
- the single-word quotes `zo'oi`, `la'oi` and `me'oi`, whose bodies the word stage delimits, and the selma'o quote `ma'oi`

```jbogenbau
%redefine-rule sumti
  sumti-1 [VUhO # (relative-clauses [sumti-connective sumti] | sumti-connective sumti)]

%redefine-rule sumti-1
  sumti-2 [sumti-connective [stag] KE # sumti [KEhE] #]

%redefine-rule sumti-2
  sumti-3 [sumti-connective sumti-3] ...

%redefine-rule sumti-3
  sumti-4 [sumti-connective [stag] BO # sumti-3]

%rule sumti-connective
  ek # | jehi # | joik # | VUhU #

%redefine-rule sumti-5
  [quantifier] sumti-6 [relative-clauses] | quantifier selbri [KU] # [relative-clauses]

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
```

## Relative clauses

Consecutive relative clauses can be joined by a joik or a jek, as well as by `zi'e`.

```jbogenbau
%redefine-rule relative-clauses
  relative-clause [(ZIhE # | joik # | jek #) relative-clause] ...

%redefine-rule relative-clause
  GOI # term [GEhU] # | NOI # subsentence [KUhO] #
```

## Selbri and tanru

Selbri and tanru-unit connectives are joik, jek, ek or VUhU (`selbri-connective`). A `bo` grouping can carry a stag without a connective. A selbri can be tagged by a bare `fa`. A guhek can be prefixed by `na'e`. The term after `be` or `bei` can be absent. The new tanru units are these:

- a cmevla, under `cbm`
- preposed linked arguments (`lo be mi broda`)
- `xo'i tag`, a tag turned into a selbri
- the word quotes `go'oi`, `ze'oi`, `ta'ai` and `bo'ei`

A tanru unit can carry selbri relative clauses: `no'oi subsentence ku'oi`, in which `ke'a` refers to the selbri (`mi klama no'oi bajra`). They are joined by `zi'e` or a joik.

```jbogenbau
%redefine-rule selbri
  [tag | FA #] selbri-1

%redefine-rule selbri-4
  selbri-5 [selbri-connective selbri-5 | joik [stag] KE # selbri-3 [KEhE] #] ...

%redefine-rule selbri-5
  selbri-6 [selbri-connective [stag] BO # selbri-5]

%redefine-rule selbri-6
  tanru-unit [[stag] BO # selbri-6] | [NAhE #] guhek selbri gik selbri-6

%rule selbri-not-starting-with-ke
  [tag] selbri-1-not-starting-with-ke

%rule selbri-1-not-starting-with-ke
  selbri-2-not-starting-with-ke | NA # selbri

%rule selbri-2-not-starting-with-ke
  selbri-3-not-starting-with-ke [CO # selbri-2]

%rule selbri-3-not-starting-with-ke
  selbri-4-not-starting-with-ke [selbri-4] ...

%rule selbri-4-not-starting-with-ke
selbri-5-not-starting-with-ke [selbri-connective selbri-5 | joik [stag] KE # selbri-3 [KEhE] #] ...

%rule selbri-5-not-starting-with-ke
  selbri-6-not-starting-with-ke [selbri-connective [stag] BO # selbri-5]

%rule selbri-6-not-starting-with-ke
  tanru-unit-not-starting-with-ke [[stag] BO # selbri-6] | [NAhE #] guhek selbri gik selbri-6

%redefine-rule tanru-unit
  tanru-unit-1 [CEI # tanru-unit-1] ... [selbri-relative-clauses]

%redefine-rule tanru-unit-2
  | KE # selbri-3 [KEhE] #
  | BRIVLA #
  | @cbm? CMEVLA #
  | GOhA [RAhO] #
  | ME # (sumti | mex) [MEhU] # [MOI #]
  | mex MOI #
  | NUhA # operator
  | SE # tanru-unit-2
  | JAI # [tag] tanru-unit-2
  | any-word (ZEI any-word) ...
  | NAhE # tanru-unit-2
  | NU [NAI] # [joik-jek NU [NAI] #] ... subsentence [KEI] #
  | linkargs tanru-unit-2
  | XOhI # tag
  | GOhOI anything #
  | ZEhOI anything #
  | TAhAI anything #
  | BOhEI anything #

%rule tanru-unit-not-starting-with-ke
  tanru-unit-1-not-starting-with-ke [CEI # tanru-unit-1] ... [selbri-relative-clauses]

%rule tanru-unit-1-not-starting-with-ke
  tanru-unit-2-not-starting-with-ke [linkargs]

%rule tanru-unit-2-not-starting-with-ke
  | BRIVLA #
  | @cbm? CMEVLA #
  | GOhA [RAhO] #
  | ME # (sumti | mex) [MEhU] # [MOI #]
  | mex MOI #
  | NUhA # operator
  | SE # tanru-unit-2
  | JAI # [tag] tanru-unit-2
  | any-word (ZEI any-word) ...
  | NAhE # tanru-unit-2
  | NU [NAI] # [joik-jek NU [NAI] #] ... subsentence [KEI] #
  | linkargs tanru-unit-2
  | XOhI # tag
  | GOhOI anything #
  | ZEhOI anything #
  | TAhAI anything #
  | BOhEI anything #

%rule selbri-relative-clauses
  selbri-relative-clause [(ZIhE # | joik #) selbri-relative-clause] ...

%rule selbri-relative-clause
  NOhOI # subsentence [KUhOI] #

%redefine-rule linkargs
  BE # [term] [links] [BEhO] #

%redefine-rule links
  BEI # [term] [links]
```

## Numbers, lerfu strings and mekso

camxes-exp replaces CLL's mekso with its own, and the layer follows it (camxes-exp.peg, `quantifier` to `lerfu_string`):

- A number is a run of PA words, `ni'e` selbri and `mo'e` sumti, with no lerfu word in it. A lerfu string is a run of lerfu words, with no PA word in it. So `li pa by` is two terms, and `mi viska cy no` is not a text.
- An operand of a mekso is `mex-2`: a number, a lerfu string, a `vei` group, a forethought connection, a `la'e` or `na'e` reference, a `pe'o` forethought expression or a reverse Polish expression. The operands `ni'e` and `mo'e` are inside numbers.
- `bo` after an operator, with an optional tag, groups two operands tighter (`li pa su'i bo re`). There is no `bi'e`, and a forethought operator needs `pe'o`.
- An operator can be a connective, a joik, jek or ek.
- A quantifier is a whole mekso, `pa su'i re broda`. It cannot begin with a lerfu word, `la'e` or `na'e`, since there camxes-exp reads a sumti (its `!sumti_6`). camxes-exp also refuses a quantifier where a selbri begins (`!selbri`). The greedy choice among parses already reads `pa re moi broda` as the selbri `pa re moi broda`, so the layer needs no rule for that.
- `me` takes a mekso as well as a sumti, a whole mekso takes `moi`, and `nu'a` takes a whole operator.

After an elided `boi`, a number or lerfu string is followed by `free-after-elided-boi`, defined under "Free modifiers", and not by a plain `#`.

```jbogenbau
%redefine-rule quantifier
  $m(mex)
%conditions
  ¬matches(head($m), quantifier-barrier)

%rule quantifier-barrier
  BY | LAU | TEI | LAhE | NAhE

%redefine-rule mex
  mex-1 [operator mex-1] ...

%redefine-rule mex-1
  mex-2 [operator [stag] BO # mex-1]

%redefine-rule mex-2
  | number free-after-elided-boi
  | lerfu-string free-after-elided-boi
  | VEI # mex [VEhO] #
  | gek mex gik mex-2
  | (LAhE # | NAhE # [BO #]) mex [LUhU] #
  | PEhO # operator mex ... [KUhE] #
  | FUhA # rp-expression

%redefine-rule rp-expression
  mex-1 [rp-expression operator] ...

%redefine-rule operator
  operator-1 [joik-jek operator-1 | joik [stag] KE # operator [KEhE] #] ...

%redefine-rule operator-2
  mex-operator | KE # operator [KEhE] #

%redefine-rule mex-operator
  | SE # mex-operator
  | NAhE # mex-operator
  | MAhO # mex [TEhU] #
  | NAhU # selbri [TEhU] #
  | VUhU #
  | joik-jek #
  | ek #

%redefine-rule number
  number-part ...

%rule number-part
  PA | NIhE # selbri [TEhU] # | MOhE # sumti [TEhU] #

%redefine-rule lerfu-string
  lerfu-word ...

%redefine-rule interval-property
  (number | VEI # mex [VEhO] #) ROI [NAI] | TAhE [NAI] | ZAhO [NAI]
```

## Logical and non-logical connectives

`jehi` is the JEhI family of sumti connectives, and a guhek can be prefixed by `na'e`.

```jbogenbau
%rule jehi
  [NA] [SE] JEhI [NAI]

%redefine-rule guhek
  [NAhE] [SE] GUhA [NAI] #
```

## Tenses and modals

`na'e [se] fa` and `se fa` are tags, and `fa` alone is a stag, so a place tag can be converted like a modal. `se` can prefix a time, space or CAhA tense.

```jbogenbau
%extend-rule stag
  FA

%redefine-rule tense-modal
  simple-tense-modal # | FIhO # selbri [FEhU] #

%redefine-rule simple-tense-modal
  | [NAhE] [SE] BAI [NAI] [KI]
  | [NAhE] [SE] ((time [space] | space [time]) & CAhA) [KI]
  | NAhE [SE] FA
  | SE FA
  | KI
  | CUhE
```

## Free modifiers, vocatives and indicators

The text replacement forms `lo'ai ... sa'ai ... le'ai`, `sa'ai ... le'ai` and `le'ai` are free modifiers. Under `cbm` the `vocative CMEVLA ...` form is removed, since a cmevla is then a selbri word. If both forms stood, their two readings would tie. `free-after-elided-boi` is what follows a number or lerfu string whose `boi` is elided. It is either the spoken `boi` with its slot, or free modifiers that do not begin with a number or lerfu string. So `pa so mo'o` is the number `pa so`, and not `pa` followed by the ordinal `so mo'o`. `free-not-starting-with-number` is `free` without the MAI form.

```jbogenbau
%redefine-rule free
  | SEI # [terms [CU #]] selbri [SEhU]
  | SOI # sumti [sumti] [SEhU]
  | vocative [relative-clauses] selbri [relative-clauses] [DOhU]
  | @¬cbm? vocative [relative-clauses] CMEVLA ... # [relative-clauses] [DOhU]
  | vocative [sumti] [DOhU]
  | mex-2 MAI
  | TO text [TOI]
  | XI # mex-2
  | XI # VEI # mex [VEhO]
  | LOhAI [any-word ...] [SAhAI [any-word ...]] LEhAI
  | SAhAI [any-word ...] LEhAI
  | LEhAI

%rule free-after-elided-boi
  BOI # | [free-not-starting-with-number ...]

%rule free-not-starting-with-number
  | SEI # [terms [CU #]] selbri [SEhU]
  | SOI # sumti [sumti] [SEhU]
  | vocative [relative-clauses] selbri [relative-clauses] [DOhU]
  | @¬cbm? vocative [relative-clauses] CMEVLA ... # [relative-clauses] [DOhU]
  | vocative [sumti] [DOhU]
  | TO text [TOI]
  | XI # mex-2
  | XI # VEI # mex [VEhO]
  | LOhAI [any-word ...] [SAhAI [any-word ...]] LEhAI
  | SAhAI [any-word ...] LEhAI
  | LEhAI
```

## Choosing among parses

Where a text has more than one parse, the stage chooses by the rule of [the notation document](../../docs/notation.md) under "Ambiguity". The layer declares the `greedy` resolution. At the first difference between two parses:

- a reading under a weak tag of [the experimental lexicon](../words/lexicon-experimental.md) loses to one under a strong tag, so a word is read under its CLL selma'o where it can be
- a parse that reads the next word wins over one that closes a constituent, so a constituent ends as late as the grammar allows
- two parses that close different constituents at the same point tie, and the tie is reported

Example. `le sutra tavla` has two parses. One is a statement with the description `le sutra`, whose `ku` is elided before `tavla`, and the selbri `tavla`. The other is a fragment, the single description `le sutra tavla`. At the word `tavla`, the statement closes the description's tanru, while the fragment reads `tavla` into it. The greedy rule takes the fragment, as in the CLL grammar.
