# The experimental grammar

This document is a layer over [the CLL grammar](cll.md), the grammar printed in chapter 21 of *The Complete Lojban Language*. The [experimental](../dialects/experimental.md) dialect stitches it after that grammar. The [Zantufa](../dialects/zantufa.md) dialect stitches [zantufa.md](zantufa.md) after both. The layer adds the experimental constructs that have grown up in use since CLL was printed. The grammar always accepts some of them, and a feature that is not specific to Zantufa guards others. Their reference is camxes-exp, the experimental PEG grammar.

The layer restates each CLL rule that it changes with `%redefine-rule`. It adds alternatives to a CLL rule with `%extend-rule`, and states its own rules with `%rule`. Each section below says what the layer changes in that part of the grammar. A rule that this document does not name is the CLL grammar's, as that document explains it.

[The experimental lexicon](../words/lexicon-experimental.md) gives each cmavo the one selma'o that camxes-exp gives it. For example, `mi'ai` is KOhA, `la` is LE, `fi'oi` is SOI, `ma'oi` is ZO and `la'oi` is ZOhOI. `no'oi` and `po'oi` are NOhOI, with the terminator `ku'oi`. Some selma'o exist only here: `LOhOI`, `NOhOI` and `KUhOI`, and the single-word terminals `KUhAU`, `LOhAI`, `LEhAI`, `ZOhOI` and `MEhOI`. A class of the CLL grammar that camxes-exp does not have, such as LA, is never read here.

The notation is explained in [the notation document](../../docs/notation.md). The terminals are selma'o, and `any-word` and `anything` are the tags `word` and `foreign-text` that the word stage puts on the material of a quote. The layer uses two feature guards: `cbm`, the cmevla-brivla merger, and `term-hierarchy`. The experimental and Zantufa dialects turn both on, as camxes-exp always has them, and a caller can turn either off.

Unlike the CLL grammar, this layer writes the free-modifier slot after an elidable terminator outside its brackets: `[X] #` where CLL has `[X #]`. So free modifiers can follow an elided terminator. Many rules below are restated for that alone. A number or lerfu string is kept maximal by `free-after-elided-boi`, which excludes a following free modifier that itself starts with a number or lerfu string.

Two directives set the layer up. `%ambiguity-resolution greedy` says how the stage chooses among parses. At the first difference between two parses, it takes the one that reads the next word. So an elided terminator is absent for as long as the grammar allows, as in the CLL dialect. The layer does not declare `elision-only`, because it has real ambiguities that are not about terminators. The greedy rule settles them:

- a bare `na` is a term, beside the `na` that negates a selbri and the `na` that starts a connective
- under `cbm`, a name is also a selbri
- under `term-hierarchy`, two terms joined by a connective and `bo` are also two sumti joined that way

If the layer declared `elision-only`, each of those texts would be an error. `%elidable` adds the experimental terminators `ku'au` and `ku'oi` to CLL's.

```jbogenbau
%ambiguity-resolution greedy
%elidable KUhAU KUhOI
```

## The text and its paragraphs

The layer changes the text in four ways. A `nai` at the start of a text is an indicator, as the indicator stage of the experimental dialect reads it. So `indicators` takes it, like the indicators of camxes-exp, and a separate `nai` stands only before a run of names. The connective after a text-leading `.i` can be an ek, as in `.i .e do klama`, because camxes-exp's joik takes the words of A. The tense before `bo` in a text-leading `.i` can be a full `tag` and not only a `stag`. And `.i ni'o` can follow a `ni'o`, which is how usage writes a new topic inside a reply. At the start of a text, the CLL grammar's `text-1` already reads `.i ni'o`, as the repair of the printed grammar that it lists says. So `text-1` takes the form after a first run of `ni'o`, and `paragraphs` takes it after a later one.

```jbogenbau
%redefine-rule text
  | @¬cbm? [NAI ...] CMEVLA ... # [joik-jek] text-1
  | [indicators & free ...] [joik-jek] text-1

%redefine-rule indicators
  ([FUhE] indicator) ...

%redefine-rule indicator
  UI | CAI | NAI | Y | DAhO | FUhO

%redefine-rule text-1
  [(I [jek | joik | ek] [[tag] BO] #) ...] [NIhO ... # [I # NIhO ... #]] [paragraphs]

%redefine-rule paragraphs
  paragraph [NIhO ... # (paragraphs | I # NIhO ... # [paragraphs])]
```

## Statements and fragments

The connective after `.i` can be an ek or a VUhU as well as a joik or jek. A statement connective can also precede `.i`, as in `mi klama joi .i do klama`. Both are `statement-connective`. Before `bo` after `.i`, the connective can be an ek as well, and the tag is a `stag`, as in camxes-exp. A prenex can have no terms (`zo'u mi klama`).

CLL's `na` fragment is gone. A bare `na` is a term (see "Terms"), so `na` and `na na` are terms fragments. Only so do the two readings not compete.

```jbogenbau
%redefine-rule statement-1
  statement-2 [I statement-connective [statement-2] | statement-connective I # [statement-2]] ...

%redefine-rule statement-2
  statement-3 [I [joik | jek | ek] [stag] BO # [statement-2]]

%redefine-rule statement-3
  sentence | [tag] TUhE # text-1 [TUhU] #

%rule statement-connective
  joik # | jek # | ek # | VUhU #

%redefine-rule fragment
  ek # | gihek # | quantifier | terms [VAU] # | prenex | relative-clauses | links | linkargs

%redefine-rule prenex
  [terms] ZOhU #
```

## Sentences and bridi-tails

A bridi-tail can have terms before its selbri, as in camxes-exp (JACU). The terms and `cu` before a selbri are a `bridi-tail-head`, in which runs of terms and single `cu` words alternate: `mi cu do klama`, `cu mi klama`. A head can stand before the first bridi-tail of a sentence, and after each connective between bridi-tails: `mi klama je do tavla`, `mi klama gi'e cu do tavla`. A head does not end in a tag whose `ku` is elided, since camxes-exp does not read a tag as a term where a selbri follows it (its `!selbri`). So `mi pu klama` has the tense `pu` on its selbri. `bare-tag-end` lists the selma'o that can end such a tag.

The afterthought connective between bridi-tails can be a gihek, joik, jek, ek or VUhU (`bridi-tail-connective`). Each of them can also open a `bo` or `ke` grouping of bridi-tails, and so can a bare `gi` with a stag, as in `mi klama gi ba bo tavla`. After a plain connective, a bridi-tail without a head does not begin with `ke`, and a head is not a bare stag, such as a tense whose `ku` is elided. Without these limits, `gi'e ke` and `gi'e ba ke` would each open two constructs. camxes-exp states the same limits as a lookahead after its gihek.

```jbogenbau
%redefine-rule sentence
  headed-bridi-tail

%rule bridi-tail-head
  | terms [(CU # terms) ...] [CU #]
  | CU # [terms [(CU # terms) ...] [CU #]]

%rule headed-bridi-tail
  | $h(bridi-tail-head) bridi-tail
  | bridi-tail
%conditions
  ¬matches(last($h), bare-tag-end)

%rule headed-bridi-tail-2
  | $h(bridi-tail-head) bridi-tail-2
  | bridi-tail-2
%conditions
  ¬matches(last($h), bare-tag-end)

%rule bare-tag-end
  BAI | CAhA | CUhE | KI | ZI | PU | VA | FAhA | ZEhA | VEhA | VIhA | ROI | TAhE | ZAhO | FA | FEhU | NAI

%redefine-rule bridi-tail
  bridi-tail-1 [(bridi-tail-connective [stag] | GI stag) KE # headed-bridi-tail [KEhE] # tail-terms]

%redefine-rule bridi-tail-1
  bridi-tail-2 [bridi-tail-connective connected-bridi-tail tail-terms] ...

%rule connected-bridi-tail
  | $h(bridi-tail-head) bridi-tail-2
  | bridi-tail-2-not-starting-with-ke
%conditions
  ¬matches($h, stag),
  ¬matches(last($h), bare-tag-end)

%redefine-rule bridi-tail-2
  bridi-tail-3 [(bridi-tail-connective [stag] | GI stag) BO # headed-bridi-tail-2 tail-terms]

%rule bridi-tail-2-not-starting-with-ke
  bridi-tail-3-not-starting-with-ke [(bridi-tail-connective [stag] | GI stag) BO # headed-bridi-tail-2 tail-terms]

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

Terms can be connected directly by a joik, jek, ek or VUhU (`term-connective`), so `mi joi do klama` has one term before its selbri. camxes-exp's joik takes the words of JOI, JA and A, and so these four sets are its `joik_ek` and `joik_jek`. Tagged terms can be bound with `(joik | ek) bo`, and under `term-hierarchy` so can any terms. `pe'e` takes any statement connective. A forethought termset needs no `nu'i`. The new terms are a bare `na`, and `soi subsentence se'u` as camxes-exp reads it. `fi'oi` is a member of SOI.

The first term inside `nu'i ... nu'u` cannot itself be a bare forethought termset. If it could, it would repeat the `nu'i gek` form. The `-not-starting-with-bare-gek` chain states that restriction: it repeats the term rules with only the first term restricted.

```jbogenbau
%redefine-rule terms-1
  terms-2 [PEhE # statement-connective terms-2] ...

%redefine-rule term
  | term-3 [term-connective term-3] ...
  | @¬term-hierarchy? tagged-term (joik # | ek #) BO # tagged-term
  | @term-hierarchy? term-3 (joik # | ek #) BO # term-3

%rule term-connective
  joik # | jek # | ek # | VUhU #

%rule term-3
  | sumti
  | tagged-term
  | termset
  | NA KU #
  | NA #
  | soi-term

%rule soi-term
  SOI # subsentence [SEhU] #

%rule tagged-term
  tag (sumti | [KU] #) | FA # (sumti | [KU #])

%redefine-rule termset
  | [NUhI #] gek terms [NUhU] # gik terms [NUhU] #
  | NUhI # terms-not-starting-with-bare-gek [NUhU] #

%rule terms-not-starting-with-bare-gek
  terms-1-not-starting-with-bare-gek [terms-1] ...

%rule terms-1-not-starting-with-bare-gek
  terms-2-not-starting-with-bare-gek [PEhE # statement-connective terms-2] ...

%rule terms-2-not-starting-with-bare-gek
  term-not-starting-with-bare-gek [CEhE # term] ...

%rule term-not-starting-with-bare-gek
  | term-3-not-starting-with-bare-gek [term-connective term-3] ...
  | @¬term-hierarchy? tagged-term (joik # | ek #) BO # tagged-term
  | @term-hierarchy? term-3-not-starting-with-bare-gek (joik # | ek #) BO # term-3

%rule term-3-not-starting-with-bare-gek
  | sumti
  | tagged-term
  | termset-with-nuhi
  | NA KU #
  | NA #
  | soi-term

%rule termset-with-nuhi
  | NUhI # gek terms [NUhU] # gik terms [NUhU] #
  | NUhI # terms-not-starting-with-bare-gek [NUhU] #
```

A tagged term whose tag is a bare `fa` has its free modifiers after the `fa`. It also has them after the `ku`, when the `ku` is written: `FA # [KU #]`. If the `ku` is elided, the two slots stand side by side, and a free modifier can sit in either. So the elided `ku` takes its slot with it here, as the CLL grammar's terminators do.

## Sumti

Sumti connectives are ek, joik, jek or VUhU (`sumti-connective`). After `vu'o`, a connected sumti can follow the relative clauses or replace them. Under `cbm` a cmevla is a selbri word, so the `la CMEVLA` name form is removed and `la .alis.` is a description. The new sumti are these:

- `na'e sumti lu'u`, without `bo`
- `la'e`, `na'e bo` or `na'e` around a term that is not a sumti, such as a tagged sumti or `na ku` (`la'e na ku lu'u broda`)
- `lo'oi subsentence ku'au`, a description of a subsentence
- the single-word quotes `zo'oi`, `la'oi` and `ra'oi`, whose bodies the word stage delimits

A `na'e` alone does not take a tagged term, since `na'e pu` is then a tag. The inner sumti of a description can be any sumti, a connected one too (`lo mi .e do broda`). It does not begin with a quantifier, since camxes-exp reads a quantifier there as the CLL form `quantifier sumti` first: `lo re mi broda` is `lo re mi` and the selbri `broda`. `quantifier-head` lists the selma'o that can begin a quantifier. A description, and a quantifier without a descriptor, can take a forethought sentence in place of a selbri (`le ga mi klama gi do klama ku`, `re ga mi klama gi do klama ku`). These are camxes-exp's `sumti_tail` and `sumti_5`.

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
  ek # | joik # | jek # | VUhU #

%redefine-rule sumti-5
  [quantifier] sumti-6 [relative-clauses] | quantifier (selbri | gek-sentence) [KU] # [relative-clauses]

%redefine-rule sumti-6
  | (LAhE # | NAhE BO # | NAhE #) [relative-clauses] sumti [LUhU] #
  | (LAhE # | NAhE BO #) $t(term) [LUhU] #
  | NAhE # $u(term) [LUhU] #
  | KOhA #
  | lerfu-string free-after-elided-boi
  | @¬cbm? LA # [relative-clauses] CMEVLA ... #
  | (LA | LE) # sumti-tail [KU] #
  | LOhOI # subsentence [KUhAU] #
  | LI # mex [LOhO] #
  | ZO any-word #
  | LU text [LIhU] #
  | LOhU [any-word ...] LEhU #
  | ZOI any-word anything any-word #
  | ZOhOI anything #
%conditions
  ¬matches($t, sumti),
  ¬matches($u, sumti),
  ¬matches($u, tagged-term)

%redefine-rule sumti-tail
  | $s(sumti) sumti-tail-1
  | sumti-tail-1
  | relative-clauses sumti-tail-1
  | gek-sentence
%conditions
  ¬matches(head($s), quantifier-head)

%rule quantifier-head
  PA | VEI | NIhE | MOhE | PEhO | FUhA
```

## Relative clauses

Consecutive relative clauses can be joined by a joik, a jek or an ek, as well as by `zi'e`, and two groups of them can be connected in forethought (`ge poi broda gi poi brode`).

```jbogenbau
%redefine-rule relative-clauses
  | relative-clause [(ZIhE # | joik # | jek # | ek #) relative-clause] ...
  | gek relative-clauses gik relative-clauses

%redefine-rule relative-clause
  GOI # term [GEhU] # | NOI # subsentence [KUhO] #
```

## Selbri and tanru

Selbri and tanru-unit connectives are joik, jek, ek or VUhU (`selbri-connective`). A selbri can be tagged by a bare `fa`. The term after `be` or `bei` can be absent. The new tanru units are a cmevla, under `cbm`, preposed linked arguments (`lo be mi broda`), and `me'oi` with the word that it quotes (`le me'oi klama cu broda`).

A tanru unit can carry selbri relative clauses: `no'oi subsentence ku'oi`, in which `ke'a` refers to the selbri (`mi klama no'oi bajra`). They are joined as relative clauses are: by `zi'e`, a joik, a jek or an ek, or two groups of them in forethought.

```jbogenbau
%redefine-rule selbri
  [tag | FA #] selbri-1

%redefine-rule selbri-4
  selbri-5 [selbri-connective selbri-5 | joik [stag] KE # selbri-3 [KEhE] #] ...

%redefine-rule selbri-5
  selbri-6 [selbri-connective [stag] BO # selbri-5]

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
  tanru-unit-not-starting-with-ke [BO # selbri-6] | [NAhE #] guhek selbri gik selbri-6

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
  | MEhOI anything #

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
  | MEhOI anything #

%rule selbri-relative-clauses
  | selbri-relative-clause [(ZIhE # | joik # | jek # | ek #) selbri-relative-clause] ...
  | gek selbri-relative-clauses gik selbri-relative-clauses

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
```

## Logical and non-logical connectives

camxes-exp's joik takes `na` before a word of JOI, as its jek and ek do. So `mi na joi do klama` has one term, `mi na joi do`. The greedy rule settles this against the bare `na` term.

A forethought connective can be `ga` or `gu` followed by a joik, jek, ek or VUhU, as in `ga je lo mlatu gi lo gerku`. With `ga`, it is a gek. With `gu`, it is a guhek, as in `mi gu je melbi gi kargydu'e`. camxes-exp allows only these two words here, so `ge je` and `gu'e je` are not connectives. The connective before `gi` in a gek can be a jek or an ek as well as a joik (`je gi mi broda gi mi brode`). A gihek can be `gi` followed by a word of JOI, JA or A (`mi klama gi je tavla`).

```jbogenbau
%redefine-rule joik
  [NA] [SE] JOI [NAI] | interval | GAhO interval GAhO

%redefine-rule gek
  | [SE] GA [NAI] #
  | $g(GA) [NAI] # (joik # | jek # | ek # | VUhU #)
  | (joik | jek | ek) GI #
  | stag gik
%conditions
  lowercase(phonemes($g)) = "ga"

%redefine-rule guhek
  | [SE] GUhA [NAI] #
  | $g(GA) [NAI] # (joik # | jek # | ek # | VUhU #)
%conditions
  lowercase(phonemes($g)) = "gu"

%redefine-rule gihek
  [NA] [SE] (GIhA | GI (JOI | JA | A)) [NAI]
```

## Tenses and modals

A tag is a run of atoms, as in camxes-exp (`tense_modal`): `pu ba vi ca`, `ki ba`. Each atom can have `na'e` and `se` before it, and free modifiers after it: `na'e pu na'e ca`, `jai se ki broda`. An atom is one of these:

- a word of BAI, CAhA, CUhE, KI, ZI, PU, VA, ZEhA, VEhA or VIhA
- a word of FAhA, with an optional `mo'i` before it
- a word of ROI after a number or a `vei` group, or a word of TAhE or ZAhO, each with an optional `fe'e` before it
- `fi'o` with a selbri

Tags are connected by a joik, jek, ek or VUhU. A stag is a tag, as in camxes-exp, so a stag can be a run of atoms or a `fi'o` selbri: `ko'a .e pu ba bo ko'e broda`, `mi klama .i fi'o broda fe'u bo do klama`. `fa` is an atom only after `na'e` or `se`, so that a place tag can be converted like a modal. A bare `fa` is a stag, and it tags a term or a selbri by the rules of "Terms" and "Selbri and tanru".

```jbogenbau
%redefine-rule tag
  tense-modal [tag-connective tense-modal] ...

%redefine-rule stag
  tag | FA

%rule tag-connective
  joik # | jek # | ek # | VUhU #

%redefine-rule tense-modal
  tense-atom ...

%rule tense-atom
  | [NAhE] [SE] (BAI | CAhA | CUhE | KI | ZI | PU | VA | [MOhI] FAhA | ZEhA | VEhA | VIhA) #
  | [NAhE] [SE] [FEhE] ((number | VEI # mex [VEhO] #) ROI | TAhE | ZAhO) #
  | [NAhE] [SE] FIhO # selbri [FEhU] #
  | NAhE [SE] FA #
  | SE FA #
```

## Free modifiers, vocatives and indicators

The text replacement forms of camxes-exp are free modifiers: up to two runs of words, each opened by a word of LOhAI (`lo'ai` or `sa'ai`), and then `le'ai`. `soi` is not a free modifier here, as it is not in camxes-exp. Under `cbm` the `vocative CMEVLA ...` form is removed, since a cmevla is then a selbri word. If both forms stood, their two readings would tie. `free-after-elided-boi` is what follows a number or lerfu string whose `boi` is elided. It is either the spoken `boi` with its slot, or free modifiers that do not begin with a number or lerfu string. So `pa so mo'o` is the number `pa so`, and not `pa` followed by the ordinal `so mo'o`. `free-not-starting-with-number` is `free` without the MAI form.

```jbogenbau
%redefine-rule free
  | SEI # [terms [CU #]] selbri [SEhU]
  | vocative [relative-clauses] selbri [relative-clauses] [DOhU]
  | @¬cbm? vocative [relative-clauses] CMEVLA ... # [relative-clauses] [DOhU]
  | vocative [sumti] [DOhU]
  | mex-2 MAI
  | TO text [TOI]
  | XI # mex-2
  | LOhAI [lohai-word ...] [LOhAI [lohai-word ...]] LEhAI
  | LEhAI

%rule free-after-elided-boi
  BOI # | [free-not-starting-with-number ...]

%rule lohai-word
  $w("word")
%conditions
  "LOhAI" ∉ tags($w),
  "LEhAI" ∉ tags($w)

%rule free-not-starting-with-number
  | SEI # [terms [CU #]] selbri [SEhU]
  | vocative [relative-clauses] selbri [relative-clauses] [DOhU]
  | @¬cbm? vocative [relative-clauses] CMEVLA ... # [relative-clauses] [DOhU]
  | vocative [sumti] [DOhU]
  | TO text [TOI]
  | XI # mex-2
  | LOhAI [lohai-word ...] [LOhAI [lohai-word ...]] LEhAI
  | LEhAI
```

## Choosing among parses

Where a text has more than one parse, the stage chooses by the rule of [the notation document](../../docs/notation.md) under "Ambiguity". The layer declares the `greedy` resolution. At the first difference between two parses:

- a reading of a word under a weak tag loses to one under a strong tag. The experimental lexicon gives no weak tags, but the Zantufa lexicon does.
- a parse that reads the next word wins over one that closes a constituent, so a constituent ends as late as the grammar allows
- two parses that close different constituents at the same point tie, and the tie is reported

Example. `le sutra tavla` has two parses. One is a statement with the description `le sutra`, whose `ku` is elided before `tavla`, and the selbri `tavla`. The other is a fragment, the single description `le sutra tavla`. At the word `tavla`, the statement closes the description's tanru, while the fragment reads `tavla` into it. The greedy rule takes the fragment, as in the CLL grammar.
