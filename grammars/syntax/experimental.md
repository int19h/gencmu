# The experimental grammar

This document is the syntax stage of the [experimental](../dialects/experimental.md) dialect, and the base of the syntax stage of the [Zantufa](../dialects/zantufa.md) dialect, which stitches [zantufa.md](zantufa.md) after it. It is [the CLL grammar](cll.md), the grammar printed in chapter 21 of *The Complete Lojban Language*, plus the experimental constructs that have grown up in use since CLL was printed: those the grammar always accepts, and those behind a feature that is not specific to Zantufa. Zantufa's own constructs are in [zantufa.md](zantufa.md). The section "Differences from the CLL grammar" at the end lists every addition in one place. Its terminals are selma'o, and the word stream it reads is produced by the same word and indicator stages as the CLL dialect's, with [the experimental lexicon](../words/lexicon-experimental.md) in place of CLL's.

The experimental lexicon gives the experimental cmavo their selma'o (`mi'ai` as KOhA, `lei'e` as LE, `poi'i` as NU, `mu'ei` as ROI, `po'oi` as NOI, `xoi` as SOI, and so on; `no'oi` is NOhOI, with the terminator `ku'oi`). The selma'o `JEhI`, `NOIhA`, `LOhOI`, `NOhOI`, `KUhOI` and the single-word terminals `FIhOI`, `FIhAU`, `XOhI`, `KUhAU`, `LOhAI`, `SAhAI`, `LEhAI`, `MAhOI`, `ZOhOI`, `LAhOI`, `MEhOI`, `GOhOI`, `ZEhOI`, `TAhAI`, `BOhEI` exist only here. A class that CLL's dictionary does not give a CLL word is a weak tag in that lexicon, as `mo'o` is `?"KOhA"` beside its CLL MAI, so a parse that reads the word under its CLL selma'o wins at the first difference.

The notation is explained in [the notation document](../../docs/notation.md); the terminals here are selma'o, and `any-word` and `anything` are the tags `word` and `foreign-text` that the word stage puts on the material of a quote. Feature guards used here: `cbm`, the cmevla-brivla merger, and `term-hierarchy`; the Zantufa dialect enables both, and a caller may enable either.

Unlike [the CLL grammar](cll.md), this grammar writes the free-modifier slot after an elidable terminator outside its brackets, `[X] #` where CLL has `[X #]`, so free modifiers may follow an elided terminator. A number or lerfu string is kept maximal by `free-after-elided-boi`, which excludes a following free modifier that itself starts with a number or lerfu string. When a text has more than one parse, the parse is chosen as "Choosing among parses" after the grammar says.

The grammar is written literately: each block of rules follows the prose that explains it, and the blocks together are the grammar. Each section first says what CLL provides, then what this grammar adds beyond it.

Three directives set the grammar up. `%ambiguity-resolution greedy` says how the stage chooses among parses: at the first difference between two parses it takes the one that reads the next word, so an elided terminator is absent for as long as the grammar allows, as in the CLL grammar. Unlike the CLL grammar, this one does not declare `elision-only`, because it has real ambiguities that are not about terminators, and the greedy rule is what settles them: a bare `na` is a term, beside the `na` that negates a selbri; under `cbm` a name is also a selbri; and under `term-hierarchy` terms may be joined by a connective and `bo` where a tagged term could take the same connection. With `elision-only`, each of those texts would be an error. `%elidable` lists the terminators that may be elided, CLL's and the experimental `fi'au`, `ku'au` and `ku'oi`. `%free-modifiers free` makes `#` stand for any number of free modifiers, `[free] ...`, defined under "Free modifiers, vocatives and indicators".

```ebnf
%ambiguity-resolution greedy ;
%elidable BEhO BOI DOhU FEhU FIhAU GEhU KEI KEhE KU KUhAU KUhE KUhO KUhOI LIhU LOhO LUhU MEhU NUhU SEhU TEhU TOI TUhU VAU VEhO ;
%free-modifiers free ;
```

## The text and its paragraphs

A text is what one speaker or writer produces (CLL 19.1). It may open with `nai`, with a run of names, with indicators or free modifiers that belong to the whole text, and with a connective that joins this text to a previous one in afterthought, as an answer joins a question (CLL 19.14). After that come the paragraphs, separated by one or more `ni'o`, each a sequence of statements or fragments separated by `.i`. Every unbounded sequence in this grammar is written with a trailing `...`, which the parser reads left-recursively.

Beyond CLL: `ce'e` may be the text-leading connective, so that a text may continue a termset of the text before it; the tense before `bo` in a text-leading `.i` may be a full `tag` rather than a `stag`; and a paragraph may begin with `.i ni'o`, which is how usage writes a new topic inside a reply.

```ebnf
text
≔ [NAI ...] [CMEVLA ... # | (indicators & free ...)] [joik-jek | CEhE #] text-1 ;

text-1
≔ [(I [jek | joik] [[tag] BO] #) ... | NIhO ... #] [paragraphs] ;

paragraphs
≔ paragraph [NIhO ... # paragraphs] ;

paragraph
≔ (statement | fragment) [I # [statement | fragment]] ...
| I # NIhO ... # [(statement | fragment) [I # [statement | fragment]] ...] ;
```

## Statements and fragments

A statement is a sentence, a sentence with prenexes before it, or several sentences joined by afterthought connectives after `.i` (CLL 14.4). `statement-1` is the left-grouping plain form, `A .i je B`; `statement-2` is the right-grouping `.i bo` form with an optional connective and tense; `statement-3` is a sentence or a `tu'e ... tu'u` block with an optional tag (CLL 14.8, 14.9).

Beyond CLL: the connective after `.i` may be an ek or a VUhU as well as a joik or jek, and a statement connective may precede `.i` (`mi klama joi .i do klama`); both are `statement-connective`. The tag before `bo` after `.i` is a full `tag`, so `.i fi'o broda bo mi klama` parses. A sentence may be continued at statement level by `connective [stag] bo subsentence` or by `connective [stag] ke subsentence ke'e`, which is where `mi klama .e bo do tavla` and `mi klama .e ke do tavla ke'e` attach when the bridi-tail level cannot take them. A prenex may have no terms (`zo'u mi klama`).

A fragment is what a speaker utters when the utterance is not a sentence: a bare connective, a bare quantifier, a list of terms with an optional `vau`, a prenex, a relative clause, or a `be` or `bei` phrase (CLL 14.11, 19.9). CLL's `na` fragment is gone here: a bare `na` is a term (see "Terms"), so `na` and `na na` are terms fragments, which is the only way the two readings do not compete.

```ebnf
statement
≔ statement-1 | prenex statement ;

statement-1
≔ statement-2 [I statement-connective [statement-2] | statement-connective I # [statement-2]] ... ;

statement-2
≔ statement-3 [I [statement-connective] [tag] BO # [statement-2]] ;

statement-3
≔ sentence [bridi-tail-connective [stag] BO # subsentence | selbri-connective [stag] KE # subsentence [KEhE] #] ...
| [tag] TUhE # text-1 [TUhU] # ;

statement-connective
≔ joik # | jek # | ek # | VUhU # ;

fragment
≔ ek # | gihek # | quantifier | terms [VAU] # | prenex | relative-clauses | links | linkargs ;

prenex
≔ [terms] ZOhU # ;
```

## Sentences and bridi-tails

A sentence is some terms, optionally `cu`, and a bridi-tail holding the selbri and the terms after it (CLL 9.2). A subsentence is a sentence with optional local prenexes, which abstractions and relative clauses contain. The bridi-tail levels state how sentences share a head under a gihek: `bridi-tail-3` is one selbri with its tail terms or a forethought `gek-sentence`; `bridi-tail-2` is the right-grouping `bo` form; `bridi-tail-1` joins tails with a plain connective; `bridi-tail` at the top lets a gihek be followed by `ke ... ke'e` (CLL 14.9). The tail after a plain connective in `bridi-tail-1` may not itself begin with `[tag] ke`, which CLL 14.10 reserves for bracketing the connection; the `-not-starting-with-ke` chain repeats the selbri rules without the `ke selbri-3 ke'e` unit at the front. A `gek-sentence` is the forethought form, `ga A gi B`, optionally tagged, grouped with `ke` or negated (CLL 14.5, 14.12).

Beyond CLL: `cu` may start a sentence with no leading terms, and terms may follow `cu` before the bridi-tail (`mi cu do klama`). The afterthought connective between bridi-tails may be any of gihek, joik, jek, ek or VUhU (`bridi-tail-connective`), and an explicit `cu` may follow it; only a gihek opens the `ke` bridi-tail grouping.

```ebnf
sentence
≔ [terms] [CU # [terms]] bridi-tail ;

subsentence
≔ sentence | prenex subsentence ;

bridi-tail
≔ bridi-tail-1 [gihek [stag] KE # bridi-tail [KEhE] # tail-terms] ;

bridi-tail-1
≔ bridi-tail-2 [bridi-tail-connective [CU #] bridi-tail-2-not-starting-with-ke tail-terms] ... ;

bridi-tail-2
≔ bridi-tail-3 [bridi-tail-connective [stag] BO # [CU #] bridi-tail-2 tail-terms] ;

bridi-tail-3
≔ selbri tail-terms | gek-sentence ;

bridi-tail-2-not-starting-with-ke
≔ bridi-tail-3-not-starting-with-ke [bridi-tail-connective [stag] BO # [CU #] bridi-tail-2 tail-terms] ;

bridi-tail-3-not-starting-with-ke
≔ selbri-not-starting-with-ke tail-terms | gek-sentence ;

gek-sentence
≔ gek subsentence gik subsentence tail-terms | [tag] KE # gek-sentence [KEhE] # | NA # gek-sentence ;

bridi-tail-connective
≔ gihek # | selbri-connective ;

selbri-connective
≔ joik # | jek # | ek # | VUhU # ;

tail-terms
≔ [terms] [VAU] # ;
```

## Terms

A term is one argument or one free-standing tag: a sumti, a tagged sumti or a tag with elided `ku`, a termset, or `na ku` (CLL 9.3, 10.13, 15.2). `terms-2` joins terms with `ce'e` into a termset, `terms-1` joins termsets with `pe'e` and a connective, and `terms` is a left-recursive sequence of those (CLL 14.11, 16.7). A termset in forethought is `nu'i gek terms nu'u gik terms nu'u`, and `nu'i terms nu'u` brackets several terms into one.

Beyond CLL: terms may be connected directly by a joik, jek, ek or VUhU (`term-connective`, `mi joi do klama` read as one term); tagged terms may be bound with `(joik | ek) bo`, and under `term-hierarchy` so may any terms. `pe'e` takes any statement connective. New terms: a bare `na`; `noi'a selbri fe'u`, a selbri attached as a relative to the bridi; `fi'oi statement fi'au`, a statement as a term; and `soi statement se'u` as a term. A forethought termset needs no `nu'i`, and `ke terms ke'e` is a termset. The first term inside `nu'i ... nu'u` may not itself be a bare forethought termset, which would otherwise duplicate the `nu'i gek` form; that restriction is the `-not-starting-with-bare-gek` chain, which repeats the term rules with only the first term restricted.

```ebnf
terms
≔ terms-1 ... ;

terms-1
≔ terms-2 [PEhE # statement-connective terms-2] ... ;

terms-2
≔ term [CEhE # term] ... ;

term
≔ term-3 [term-connective term-3] ...
| tagged-term (joik # | ek #) BO # tagged-term
| @term-hierarchy term-3 (joik # | ek #) BO # term-3 ;

term-connective
≔ joik # | jek # | ek # | VUhU # ;

term-3
≔ sumti | tagged-term | termset | NA KU # | NA # | NOIhA # selbri [FEhU] # | FIhOI # statement [FIhAU] # | SOI # statement [SEhU] # ;

tagged-term
≔ (tag | FA #) (sumti | [KU] #) ;

termset
≔ [NUhI #] gek terms [NUhU] # gik terms [NUhU] # | NUhI # terms-not-starting-with-bare-gek [NUhU] # | KE # terms [KEhE] # ;

terms-not-starting-with-bare-gek
≔ terms-1-not-starting-with-bare-gek [terms-1] ... ;

terms-1-not-starting-with-bare-gek
≔ terms-2-not-starting-with-bare-gek [PEhE # statement-connective terms-2] ... ;

terms-2-not-starting-with-bare-gek
≔ term-not-starting-with-bare-gek [CEhE # term] ... ;

term-not-starting-with-bare-gek
≔ term-3-not-starting-with-bare-gek [term-connective term-3] ...
| tagged-term (joik # | ek #) BO # tagged-term
| @term-hierarchy term-3-not-starting-with-bare-gek (joik # | ek #) BO # term-3 ;

term-3-not-starting-with-bare-gek
≔ sumti | tagged-term | termset-with-nuhi | NA KU # | NA # | NOIhA # selbri [FEhU] # | FIhOI # statement [FIhAU] # | SOI # statement [SEhU] # ;

termset-with-nuhi
≔ NUhI # gek terms [NUhU] # gik terms [NUhU] # | NUhI # terms-not-starting-with-bare-gek [NUhU] # | KE # terms [KEhE] # ;
```

## Sumti

A sumti is an argument (CLL 6), and the levels `sumti` to `sumti-4` state its connectives and grouping in the same shape as for statements: a `ke` group, the left-grouping afterthought sequence, the `bo` form, and a forethought connection. `sumti-5` places the outer quantifier, before a `sumti-6` or before a bare selbri with elidable `ku` (CLL 6.7). `sumti-6` lists the simple sumti: a `la'e` or `na'e bo` reference closed by `lu'u`, a pronoun, a lerfu string, a name, a description, a `li` mekso, and the quotes `zo`, `lu ... li'u`, `lo'u ... le'u` and `zoi`. `sumti-tail` is what follows a descriptor: an optional inner sumti, relative clauses, the inner quantifier and the selbri, or a quantifier and a sumti (CLL 6.2, 8.7).

Beyond CLL: sumti connectives are ek, JEhI, joik or VUhU (`sumti-connective`). After `vu'o` a connected sumti may follow the relative clauses or replace them. New sumti: `na'e sumti lu'u` without `bo`; `la'e` or `na'e bo` around a tagged sumti; a description whose two descriptors are joined by a jek (`lo je le broda`); `lo'oi statement ku'au`, a description of a statement, with connected heads; the single-word quotes `zo'oi`, `la'oi`, `me'oi`, whose bodies the word stage delimits, and the selma'o quote `ma'oi`. A `lo'u ... le'u` quote may be empty. Under `cbm` a cmevla is a selbri word, so the `la CMEVLA` name form is removed and `la .alis.` is a description.

```ebnf
sumti
≔ sumti-1 [VUhO # (relative-clauses [sumti-connective sumti] | sumti-connective sumti)] ;

sumti-1
≔ sumti-2 [sumti-connective [stag] KE # sumti [KEhE] #] ;

sumti-2
≔ sumti-3 [sumti-connective sumti-3] ... ;

sumti-3
≔ sumti-4 [sumti-connective [stag] BO # sumti-3] ;

sumti-connective
≔ ek # | jehi # | joik # | VUhU # ;

sumti-4
≔ sumti-5 | gek sumti gik sumti-4 ;

sumti-5
≔ [quantifier] sumti-6 [relative-clauses] | quantifier selbri [KU] # [relative-clauses] ;

sumti-6
≔ (LAhE # | NAhE BO #) [relative-clauses] sumti [LUhU] #
| NAhE # sumti [LUhU] #
| (LAhE # | NAhE BO #) (tag | FA #) sumti [LUhU] #
| KOhA #
| lerfu-string free-after-elided-boi
| @!cbm LA # [relative-clauses] CMEVLA ... #
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
| MEhOI anything # ;

sumti-tail
≔ [sumti-6 [relative-clauses]] sumti-tail-1 | relative-clauses sumti-tail-1 ;

sumti-tail-1
≔ [quantifier] selbri [relative-clauses] | quantifier sumti ;
```

## Relative clauses

A relative clause attaches to a sumti: `goi` and its kin take a term and are closed by `ge'u`; `poi`, `noi` and `voi` take a subsentence closed by `ku'o` (CLL 8). Several clauses are joined by `zi'e`. Beyond CLL, consecutive relative clauses may also be joined by a joik or a jek.

```ebnf
relative-clauses
≔ relative-clause [(ZIhE # | joik # | jek #) relative-clause] ... ;

relative-clause
≔ GOI # term [GEhU] # | NOI # subsentence [KUhO] # ;
```

## Selbri and tanru

A selbri is the predicate of a bridi (CLL 5), optionally preceded by a tag. `selbri-1` allows `na`; `selbri-2` is the `co` inversion; `selbri-3` is a plain left-grouping tanru; `selbri-4` joins units by a connective or a joik with `ke ... ke'e`; `selbri-5` is the `bo` form; `selbri-6` is a tanru unit with `bo` or a forethought guhek connection (CLL 5.6 to 5.8, 14.13). The `-not-starting-with-ke` chain repeats these rules for the restricted position after a plain bridi-tail connective; only the first tanru unit differs.

A tanru unit takes `cei` to assign a pro-bridi and linked arguments `be ... bei ... be'o` (CLL 5.7). `tanru-unit-2` lists the simple units: a brivla, a pro-bridi, a `ke` group, `me sumti me'u`, a number or lerfu string with MOI, `nu'a` before an operator, a conversion, `jai`, a `zei` compound, a scalar negation, and an abstraction closed by `kei`.

Beyond CLL: selbri and tanru-unit connectives are joik, jek, ek or VUhU (`selbri-connective`); a `bo` grouping may carry a stag without a connective. A selbri may be tagged by a bare `fa`. A guhek may be prefixed by `na'e`. New tanru units: a cmevla under `cbm`; preposed linked arguments (`lo be mi broda`); `xo'i tag`, a tag turned into a selbri; the word quotes `go'oi`, `ze'oi`, `ta'ai`, `bo'ei` as selbri units. The term after `be` or `bei` may be absent. A tanru unit may carry selbri relative clauses: `no'oi subsentence ku'oi`, in which `ke'a` refers to the selbri (`mi klama no'oi bajra`), joined by `zi'e` or a joik.

```ebnf
selbri
≔ [tag | FA #] selbri-1 ;

selbri-1
≔ selbri-2 | NA # selbri ;

selbri-2
≔ selbri-3 [CO # selbri-2] ;

selbri-3
≔ selbri-4 ... ;

selbri-4
≔ selbri-5 [selbri-connective selbri-5 | joik [stag] KE # selbri-3 [KEhE] #] ... ;

selbri-5
≔ selbri-6 [selbri-connective [stag] BO # selbri-5] ;

selbri-6
≔ tanru-unit [[stag] BO # selbri-6] | [NAhE #] guhek selbri gik selbri-6 ;

selbri-not-starting-with-ke
≔ [tag] selbri-1-not-starting-with-ke ;

selbri-1-not-starting-with-ke
≔ selbri-2-not-starting-with-ke | NA # selbri ;

selbri-2-not-starting-with-ke
≔ selbri-3-not-starting-with-ke [CO # selbri-2] ;

selbri-3-not-starting-with-ke
≔ selbri-4-not-starting-with-ke [selbri-4] ... ;

selbri-4-not-starting-with-ke
≔ selbri-5-not-starting-with-ke [selbri-connective selbri-5 | joik [stag] KE # selbri-3 [KEhE] #] ... ;

selbri-5-not-starting-with-ke
≔ selbri-6-not-starting-with-ke [selbri-connective [stag] BO # selbri-5] ;

selbri-6-not-starting-with-ke
≔ tanru-unit-not-starting-with-ke [[stag] BO # selbri-6] | [NAhE #] guhek selbri gik selbri-6 ;

tanru-unit
≔ tanru-unit-1 [CEI # tanru-unit-1] ... [selbri-relative-clauses] ;

tanru-unit-1
≔ tanru-unit-2 [linkargs] ;

tanru-unit-2
≔ KE # selbri-3 [KEhE] #
| BRIVLA #
| @cbm CMEVLA #
| GOhA [RAhO] #
| ME # sumti [MEhU] # [MOI #]
| (number | lerfu-string) MOI #
| NUhA # mex-operator
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
| BOhEI anything # ;

tanru-unit-not-starting-with-ke
≔ tanru-unit-1-not-starting-with-ke [CEI # tanru-unit-1] ... [selbri-relative-clauses] ;

tanru-unit-1-not-starting-with-ke
≔ tanru-unit-2-not-starting-with-ke [linkargs] ;

tanru-unit-2-not-starting-with-ke
≔ BRIVLA #
| @cbm CMEVLA #
| GOhA [RAhO] #
| ME # sumti [MEhU] # [MOI #]
| (number | lerfu-string) MOI #
| NUhA # mex-operator
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
| BOhEI anything # ;

selbri-relative-clauses
≔ selbri-relative-clause [(ZIhE # | joik #) selbri-relative-clause] ... ;

selbri-relative-clause
≔ NOhOI # subsentence [KUhOI] # ;

linkargs
≔ BE # [term] [links] [BEhO] # ;

links
≔ BEI # [term] [links] ;
```

## Numbers, lerfu strings and mekso

A number is a string of PA words into which lerfu words may be mixed, and a lerfu string is the same thing beginning with a lerfu word (CLL 18.2, 17.9); a quantifier is a number closed by `boi` or a mekso in `vei ... ve'o` (CLL 18.6). A mekso is an infix expression of `mex-1` joined by operators or a reverse Polish expression after `fu'a`; `mex-1` is the `bi'e` form; `mex-2` is an operand or a forethought operator with `pe'o`. Operators and operands each have the same connective levels as selbri and sumti, and `mex-operator` and `operand-3` list the simple forms (CLL 18).

Beyond CLL: operands may be connected by a jek, and after an elided `boi` a number or lerfu string is followed by `free-after-elided-boi`, defined under "Free modifiers", rather than by a plain `#`.

```ebnf
quantifier
≔ number free-after-elided-boi | VEI # mex [VEhO] # ;

mex
≔ mex-1 [operator mex-1] ... | FUhA # rp-expression ;

mex-1
≔ mex-2 [BIhE # operator mex-1] ;

mex-2
≔ operand | [PEhO #] operator mex-2 ... [KUhE] # ;

rp-expression
≔ rp-operand rp-operand operator ;

rp-operand
≔ operand | rp-expression ;

operator
≔ operator-1 [joik-jek operator-1 | joik [stag] KE # operator [KEhE] #] ... ;

operator-1
≔ operator-2 | guhek operator-1 gik operator-2 | operator-2 (jek | joik) [stag] BO # operator-1 ;

operator-2
≔ mex-operator | KE # operator [KEhE] # ;

mex-operator
≔ SE # mex-operator | NAhE # mex-operator | MAhO # mex [TEhU] # | NAhU # selbri [TEhU] # | VUhU # ;

operand
≔ operand-1 [(ek | joik) [stag] KE # operand [KEhE] #] ;

operand-1
≔ operand-2 [joik-ek operand-2 | jek # operand-2] ... ;

operand-2
≔ operand-3 [(ek | joik) [stag] BO # operand-2] ;

operand-3
≔ quantifier | lerfu-string free-after-elided-boi | NIhE # selbri [TEhU] # | MOhE # sumti [TEhU] # | JOhI # mex-2 ... [TEhU] # | gek operand gik operand-3 | (LAhE # | NAhE BO #) operand [LUhU] # ;

number
≔ PA [PA | lerfu-word] ... ;

lerfu-string
≔ lerfu-word [PA | lerfu-word] ... ;

lerfu-word
≔ BY | any-word BU | LAU lerfu-word | TEI lerfu-string FOI ;
```

## Logical and non-logical connectives

An ek joins sumti, a gihek joins bridi-tails, a jek joins tanru units and sentences, and a gek is the forethought form; each afterthought connective may take `na` before, `nai` after, and `se` (CLL 14.2). A joik is a non-logical connective or an interval (CLL 14.14, 14.16). A gek is a forethought logical connective, a joik with `gi`, or a tense with `gi`, and the two halves are separated by a gik; a guhek is the forethought connective of tanru units. Beyond CLL: `jehi` is the JEhI family of sumti connectives, and a guhek may be prefixed by `na'e`.

```ebnf
ek
≔ [NA] [SE] A [NAI] ;

jehi
≔ [NA] [SE] JEhI [NAI] ;

gihek
≔ [NA] [SE] GIhA [NAI] ;

jek
≔ [NA] [SE] JA [NAI] ;

joik
≔ [SE] JOI [NAI] | interval | GAhO interval GAhO ;

interval
≔ [SE] BIhI [NAI] ;

joik-ek
≔ joik # | ek # ;

joik-jek
≔ joik # | jek # ;

gek
≔ [SE] GA [NAI] # | joik GI # | stag gik ;

guhek
≔ [NAhE] [SE] GUhA [NAI] # ;

gik
≔ GI [NAI] # ;
```

## Tenses and modals

A tag turns a sumti into a modal or tense term and marks a selbri or a sentence with a tense (CLL 9, 10). `tag` is one or more tense-modals joined by jek or joik; `stag` is the restricted form used before `bo` and `ke` and in a gek. A tense-modal is a simple tense-modal or `fi'o selbri fe'u`. A simple tense-modal is a BAI modal, a tense built from time and space, `ki`, or `cu'e`, each convertible by `se`, negatable by `na'e`, and followed by `ki`. The time and space rules are CLL 10.4 to 10.12.

Beyond CLL: `na'e [se] fa` and `se fa` are tags, and `fa` alone is a stag, so a place tag may be converted like a modal; and `se` may prefix a time, space or CAhA tense.

```ebnf
tag
≔ tense-modal [joik-jek tense-modal] ... ;

stag
≔ simple-tense-modal [(jek | joik) simple-tense-modal] ... | FA ;

tense-modal
≔ simple-tense-modal # | FIhO # selbri [FEhU] # ;

simple-tense-modal
≔ [NAhE] [SE] BAI [NAI] [KI] | [NAhE] [SE] ((time [space] | space [time]) & CAhA) [KI] | NAhE [SE] FA | SE FA | KI | CUhE ;

time
≔ ZI & time-offset ... & (ZEhA [PU [NAI]]) & interval-property ... ;

time-offset
≔ PU [NAI] [ZI] ;

space
≔ VA & space-offset ... & space-interval & (MOhI space-offset) ;

space-offset
≔ FAhA [NAI] [VA] ;

space-interval
≔ ((VEhA & VIhA) [FAhA [NAI]]) & space-int-props ;

space-int-props
≔ (FEhE interval-property) ... ;

interval-property
≔ number ROI [NAI] | TAhE [NAI] | ZAhO [NAI] ;
```

## Free modifiers, vocatives and indicators

A free modifier may stand wherever the grammar writes `#` (CLL 19.12): a `sei` discursive bridi, a `soi` reciprocity marker, a vocative phrase closed by `do'u`, an utterance ordinal, a parenthetical `to ... toi`, and a subscript `xi`. A vocative is a run of COI words or `doi` or both. Indicators are the attitudinals and discursives, `y`, `da'o`, and `fu'e ... fu'o`; a run of indicators attaches to the word before it.

Beyond CLL: the text replacement forms `lo'ai ... sa'ai ... le'ai`, `sa'ai ... le'ai` and `le'ai` are free modifiers. Under `cbm` the `vocative CMEVLA ...` form is removed, since a cmevla is then a selbri word and the two readings would tie. `free-after-elided-boi` is what follows a number or lerfu string whose `boi` is elided: either the spoken `boi` with its slot, or free modifiers that do not begin with a number or lerfu string, so that `pa so mo'o` is the number `pa so` and not `pa` followed by the ordinal `so mo'o`; `free-not-starting-with-number` is `free` without the MAI form.

```ebnf
free
≔ SEI # [terms [CU #]] selbri [SEhU]
| SOI # sumti [sumti] [SEhU]
| vocative [relative-clauses] selbri [relative-clauses] [DOhU]
| @!cbm vocative [relative-clauses] CMEVLA ... # [relative-clauses] [DOhU]
| vocative [sumti] [DOhU]
| (number | lerfu-string) MAI
| TO text [TOI]
| XI # (number | lerfu-string) [BOI]
| XI # VEI # mex [VEhO]
| LOhAI [any-word ...] [SAhAI [any-word ...]] LEhAI
| SAhAI [any-word ...] LEhAI
| LEhAI ;

free-after-elided-boi
≔ BOI # | [free-not-starting-with-number ...] ;

free-not-starting-with-number
≔ SEI # [terms [CU #]] selbri [SEhU]
| SOI # sumti [sumti] [SEhU]
| vocative [relative-clauses] selbri [relative-clauses] [DOhU]
| @!cbm vocative [relative-clauses] CMEVLA ... # [relative-clauses] [DOhU]
| vocative [sumti] [DOhU]
| TO text [TOI]
| XI # (number | lerfu-string) [BOI]
| XI # VEI # mex [VEhO]
| LOhAI [any-word ...] [SAhAI [any-word ...]] LEhAI
| SAhAI [any-word ...] LEhAI
| LEhAI ;

vocative
≔ (COI [NAI]) ... & DOI ;

indicators
≔ [FUhE] indicator ... ;

indicator
≔ (UI | CAI) [NAI] | Y | DAhO | FUhO ;
```

## The non-formal rules

CLL ends its grammar with four rules it calls non-formal, since a parser
applies them before the grammar proper rather than through it (CLL 19.13).
Two of them are the material of quotes. The word stage delimits every quote,
and hands on a quoted word tagged `word` and quoted foreign text tagged
`foreign-text`, so here they are ordinary rules:

```ebnf
any-word ≔ "word" ;

anything ≔ "foreign-text" ;
```

The other two are applied by the stages before this one: the indicator
stage attaches `ba'e` and indicators to their words, and the word stage
applies the erasers. They are shown as CLL prints them, for reference only;
the `utterance` that `sa` erases is not defined anywhere in CLL.

```text
word = [BAhE] any-word [indicators]
null = any-word SI | utterance SA | text SU
```

## Choosing among parses

Where a text has more than one parse, the stage chooses by the rule that [the notation document](../../docs/notation.md) states under "Ambiguity", with the `greedy` resolution this grammar declares at the top. At the first difference between two parses, a reading of a word under a weak tag of [the experimental lexicon](../words/lexicon-experimental.md) loses to a reading under a strong one, so a word that CLL's dictionary places in one selma'o and later usage also in another is read under its CLL selma'o wherever that reading exists; a parse that reads the next word wins over one that closes a constituent, so a constituent ends as late as the grammar allows; and two parses that close different constituents at the same point tie, and the tie is reported.

Example. `le sutra tavla` has two parses: a statement with the description `le sutra`, its `ku` elided before `tavla`, and the selbri `tavla`; or a fragment consisting of the single description `le sutra tavla`. At the word `tavla` the statement closes the description's tanru while the fragment reads `tavla` into it, and the greedy rule takes the fragment, as in the CLL grammar.

## Differences from the CLL grammar

This grammar is [the CLL grammar](cll.md) plus the experimental constructs, those it always accepts and those behind a feature that is not specific to Zantufa. Zantufa's constructs and the features specific to them are in [zantufa.md](zantufa.md).

- **Free modifiers after elided terminators.** Every `[X #]` is written `[X] #`, so a free modifier may follow an elided terminator. Numbers and lerfu strings stay maximal through `free-after-elided-boi`.
- **Text.** `CEhE` may be the text-leading connective. A paragraph may begin with `I NIhO`.
- **Statements.** The connective after `I` may be an ek or a VUhU as well as a joik or jek (`statement-connective`), and a statement connective may precede `I` (`mi klama joi i do klama`). The tag before `BO` after `I` is a full `tag`, so `.i fi'o broda bo mi klama` parses. A sentence may be continued at statement level by `connective [stag] BO subsentence` or `connective [stag] KE subsentence [KEhE]`, which is where `mi klama .e bo do tavla` and `mi klama .e ke do tavla ke'e` attach when the bridi-tail level cannot take them. A prenex may have no terms.
- **Fragments.** The `NA #` fragment is gone: a bare `NA` is a term (below), so `na` and `na na` are terms fragments.
- **Sentences.** `CU` may start a sentence with no leading terms, and terms may follow `CU` before the bridi-tail (`terms CU terms bridi-tail`).
- **Bridi-tails.** The afterthought connective between bridi-tails may be any of gihek, joik, jek, ek or VUhU (`bridi-tail-connective`), and an explicit `CU` may follow it. Only a gihek opens the `KE` bridi-tail grouping.
- **Selbri relative clauses.** A tanru unit may carry `NOhOI subsentence [KUhOI]` clauses, joined by `ZIhE` or a joik (`mi klama no'oi bajra`).
- **Terms.** Terms may be connected directly by joik, jek, ek or VUhU (`term-connective`); tagged terms may be bound with `(joik | ek) BO`, and under `term-hierarchy` so may any terms. `PEhE` takes any statement connective. New terms: a bare `NA`, `NOIhA selbri [FEhU]`, `FIhOI statement [FIhAU]`, `SOI statement [SEhU]`. A forethought termset needs no `NUhI`, and `KE terms [KEhE]` is a termset. The first term inside `NUhI ... [NUhU]` may not itself be a bare forethought termset, which would otherwise duplicate the `NUhI gek` form.
- **Sumti.** Sumti connectives are ek, JEhI, joik or VUhU (`sumti-connective`). After `VUhO` a connected sumti may follow the relative clauses or replace them. New sumti: `NAhE sumti [LUhU]` without `BO`; `LAhE` or `NAhE BO` around a tagged sumti; a description whose two heads are joined by a jek (`lo je le broda`); `LOhOI statement [KUhAU]` with connected heads; the single-word quotes `ZOhOI`, `LAhOI`, `MEhOI` and the selma'o quote `MAhOI`. Under `cbm` the `LA` name form is removed and `la .alis.` is a description.
- **Relative clauses.** Consecutive relative clauses may be joined by a joik or jek as well as `ZIhE`.
- **Selbri.** Selbri and tanru-unit connectives are joik, jek, ek or VUhU (`selbri-connective`); a `BO` grouping may carry a stag without a connective. A selbri may be tagged by a bare `FA`. A guhek may be prefixed by `NAhE`. New tanru units: `CMEVLA` under `cbm`; preposed linkargs (`lo be mi broda`); `XOhI tag`; the word quotes `GOhOI`, `ZEhOI`, `TAhAI`, `BOhEI` as selbri units.
- **Linkargs.** The term after `BE` or `BEI` may be absent.
- **Tags.** `NAhE [SE] FA` and `SE FA` are tags, and `FA` alone is a stag. `SE` may prefix a time/space/CAhA tense.
- **Mekso.** Operands may be connected by a jek.
- **Quotes.** A `lo'u ... le'u` quote may be empty, `lo'u le'u`.
- **Free modifiers.** The text replacement forms `LOhAI ... [SAhAI ...] LEhAI`, `SAhAI ... LEhAI` and `LEhAI`.
- **Vocatives.** Under `cbm` the `vocative CMEVLA ...` form is removed, since a cmevla is then a selbri word.
