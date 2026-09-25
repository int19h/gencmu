# The CLL grammar

This document is the syntax stage, the last stage of the [CLL](../dialects/cll-ebnf.md) and [approved word forms](../dialects/bpfk.md) dialects: the grammar of Lojban as printed in chapter 21 of *The Complete Lojban Language*, in the notation the book uses, with the departures listed at the end under "Differences from the printed CLL grammar". Its terminals are selma'o. The word stream it reads is produced by the stages before it: the word stage, [the word stream](../words/stream.md) with a family of word forms, which reads phonemes into words, quotes and compounds and applies the erasers `si`, `sa` and `su`; and [the indicator stage](../indicators/cll.md), which attaches a run of indicators to the word before it, as CLL's non-formal rule `word = [BAhE] any-word [indicators]` says. Every cmavo reaches this grammar under each selma'o [the CLL lexicon](../words/lexicon-cll.md) gives it, and the material of a quote arrives tagged `word` or `foreign-text`, which is what `any-word` and `anything` read.

The notation is explained in [the notation document](../../docs/notation.md). One point bears repeating here: an elided terminator takes its `#` with it, so an elided `[X #]` leaves no free-modifier slot at that point; and when omitting terminators leaves a text with more than one parse, the parse is chosen as "Choosing among parses" after the grammar says.

The grammar is written literately: each block of rules follows the prose that explains it, and the blocks together are the grammar. The prose says what each construct is for and how the rules achieve it; the chapter numbers are those of CLL.

A directive and a rule set the grammar up. How the stage chooses among parses is not said here: CLL's rule that a terminator may be elided "if no grammatical ambiguity results" is read in more than one way (see "Choosing among parses"), and each dialect that uses this grammar names its own reading in a document of one directive, stitched after this one. `%elidable` lists the terminators CLL marks as elidable, which the printed grammar writes between slashes; here each is an optional, `[KU]`, or `[KU #]` when its free-modifier slot goes with it, and an absent one shows in the parse tree as that terminator, elided. `#` is the free-modifier slot that follows almost every word, any number of free modifiers, as CLL's EBNF defines it; `free`, a single free modifier, is defined under "Free modifiers, vocatives and indicators".

```jbogenbau
%elidable
  BEhO BOI DOhU FEhU GEhU KEI KEhE KU KUhE KUhO
  LIhU LOhO LUhU MEhU NUhU SEhU TEhU TOI TUhU VAU
  VEhO

%rule #
  [free ...]
```

## The text and its paragraphs

A text is what one speaker or writer produces, from the first word to the last (CLL 19.1). It may open with `nai`, whose meaning here is a text-level negation of what follows; with a run of names, a form of address without a vocative; with indicators or free modifiers that belong to the whole text; and with a connective, `joik-jek`, that joins this text to a previous one in afterthought, as an answer joins a question (CLL 19.5). After that come the paragraphs. `text-1` allows the text to begin with `.i` sentence separators, each of which may carry its own afterthought connective and a `bo`-grouped tense, then with `ni'o` topic markers, or with either alone; these are the forms a text takes when it continues another speaker's text or starts a fresh topic (CLL 19.3). Paragraphs are separated by one or more `ni'o` (each `ni'o` beyond the first marks a larger break), and a paragraph is a sequence of statements or fragments separated by `.i`. Every unbounded sequence in this grammar is written with a trailing `...`, which the parser reads left-recursively, so a paragraph of a thousand sentences costs a thousand steps rather than a thousand squared.

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

A statement is a sentence, or a sentence with a prenex before it, or several sentences joined by afterthought connectives (CLL 14.4). The four levels state the grouping of those connectives. `statement` takes any number of prenexes, each `terms zo'u`, which bind variables or set topics for the sentence that follows (CLL 16.2). `statement-1` is a sequence of `statement-2` joined by `.i` followed by a jek or joik, `.i je`, `.i ja nai`, `.i joi`; these group to the left, as the trailing `...` says, so `A .i je B .i ja C` is `(A and B) or C`. `statement-2` is the right-grouping form: `.i` with an optional connective and an optional tense, then `bo`, binds the sentence after it more tightly than a plain `.i je` would, and since the rule refers to `statement-2` on its right, a chain of `.i bo` groups to the right (CLL 14.8). `statement-3` is either a sentence or a `tu'e ... tu'u` block, which makes a whole text-1 behave as one sentence for the purposes of connection and of a preceding tense (CLL 14.8); the block's `tu'u` is elidable and carries its own free-modifier slot.

A fragment is what a speaker utters when the utterance is not a sentence: a bare connective as the answer to a `ji` or `gi'i` question, a bare quantifier as the answer to `xo`, `na` alone, a list of terms with an optional `vau`, a bare prenex, a relative clause, or a `be` or `bei` phrase that supplies arguments after the fact (CLL 19.5 and 14.13). Because `terms [VAU #]` is a fragment, the first word of an utterance never has to be read as the start of a sentence, which is what makes `le sutra tavla` a legitimate fragment as well as a sentence; the choice between the two is the subject of "Choosing among parses".

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

A sentence is a bridi: some terms, then optionally `cu`, then the bridi-tail, which holds the selbri and any terms that follow it (CLL 9.2). The terms before the selbri are the head; `cu` marks where the head ends and is what lets a description close without its `ku`, since a selbri cannot begin inside a sumti. The terms are optional so that a sentence may begin with its selbri, as `klama` alone does. A subsentence is a sentence or a prenex followed by a subsentence; it is what abstractions and relative clauses contain, and its prenex is local to it (CLL 16.7).

The bridi-tail levels state how sentences share a head under a gihek, the connective family `gi'e`, `gi'a` and so on (CLL 14.9). `bridi-tail-3` is one selbri with its tail terms, or a forethought `gek-sentence`. `bridi-tail-2` binds two tails with `gihek [stag] bo`, right-grouping. `bridi-tail-1` joins tails with a plain gihek, left-grouping. `bridi-tail` at the top lets a gihek be followed by `ke ... ke'e`, which groups the tails inside the brackets against the tail to the left. The tail terms after each selbri belong to that selbri; `vau` closes them and is almost always elided.

The printed grammar lets the tail after a plain gihek begin with `ke`, so `mi broda gi'e ke brode gi'a brodi` has two parses, which differ in meaning: `ke ... ke'e` groups the tails after `gi'e`, through `bridi-tail`, or it groups a tanru that begins the second tail. CLL 14.10 shows the first, and the official parser reads only the first, through a token of its lexer, `GIhEK_KE`. This grammar follows the printed one. The two parses differ only in where `ke'e` is elided, so the text is accepted with a tie, and the ranking takes the group of tails; with `ke'e` written after `brode`, only the tanru reading is left. A joik directly before `ke`, in a tanru or between operators, has two parses in the same way, but they still differ with every terminator written, so `mi broda joi ke brode ke'e` is an error that shows both; the official parser reads it as a group joined by `joi`, through its lexer token `JOIK_KE`.

A `gek-sentence` is the forethought form: `ga A gi B`, or with a tense in the gek, `pu gi A gi B`, joins two subsentences before either is spoken, and may be preceded by a tag, by `ke` for grouping, or by `na` (CLL 14.5, 14.10). Its tail terms follow the whole connection and apply to both sides.

```jbogenbau
%rule sentence
  [terms [CU #]] bridi-tail

%rule subsentence
  sentence | prenex subsentence

%rule bridi-tail
  bridi-tail-1 [gihek [stag] KE # bridi-tail [KEhE #] tail-terms]

%rule bridi-tail-1
  bridi-tail-2 [gihek # bridi-tail-2 tail-terms] ...

%rule bridi-tail-2
  bridi-tail-3 [gihek [stag] BO # bridi-tail-2 tail-terms]

%rule bridi-tail-3
  selbri tail-terms | gek-sentence


%rule gek-sentence
  gek subsentence gik subsentence tail-terms | [tag] KE # gek-sentence [KEhE #] | NA # gek-sentence

%rule tail-terms
  [terms] [VAU #]
```

## Terms

A term is one argument of a bridi or one tag standing on its own: a sumti; a sumti or an elided `ku` after a tag or a place marker `fa`, `fe`, ... (`ca lo nu broda`, `fi mi`, `pu ku`); a termset; or `na ku`, the sentence-level negation written as a term (CLL 9.3, 10.13, 15.2). A tag with nothing after it takes `ku` so that it does not swallow the next sumti; the `ku` may be elided when what follows cannot be a sumti anyway, and "Choosing among parses" says which reading wins when it could.

The three levels of `terms` state the termset connectives (CLL 14.11 and 16.7). `terms-2` joins terms with `ce'e` into a termset, `mi ce'e do`. `terms-1` joins termsets with `pe'e` followed by a jek or joik, the afterthought form of connecting two sets of arguments at once. `terms` is a sequence of those, and it is left-recursive so that the terms of a long sentence are built one at a time. A termset in forethought is `nu'i gek terms nu'u gik terms nu'u`, and `nu'i terms nu'u` alone brackets several terms into one so that a connective or a tense applies to all of them.

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

A sumti is an argument: a description, a name, a pronoun, a quotation, a number, or a connection of these (CLL 6). The levels from `sumti` down to `sumti-4` state the connectives and the grouping, in the same shape as for statements and bridi-tails. `sumti-1` is a sumti with a `ke ... ke'e` grouped connection after it. `sumti-2` is a sequence joined by ek or joik in afterthought, `mi .e do`, `mi joi do`, left-grouping. `sumti-3` is the right-grouping `bo` form. `sumti-4` is a simple sumti or a forethought connection, `ge mi gi do`. The top rule `sumti` adds `vu'o` followed by relative clauses, which attach the clauses to a whole connected sumti rather than to its last member (CLL 8.8).

`sumti-5` places the outer quantifier: a number before a sumti-6 counts its referents, `re lo gerku`, and a quantifier directly before a selbri makes a sumti with an implicit `lo`, `re gerku`, whose `ku` is elidable (CLL 6.7). Either may be followed by relative clauses.

`sumti-6` is the closed list of simple sumti. `la'e` and `na'e bo` (and the other members of LAhE) make a sumti from another sumti's referent, with relative clauses allowed inside, and `lu'u` closes them. `KOhA` is a pronoun. A lerfu string, `.abu` or `xy.`, is a sumti and is closed by `boi`, which separates it from a following number or lerfu string. `la` before names makes a name; `la` or `le` (that is, any member of LA or LE) before a `sumti-tail` makes a description closed by `ku`. `li` opens a mekso closed by `lo'o`. `zo` quotes the single next word, `lu ... li'u` quotes a Lojban text, `lo'u ... le'u` quotes a run of Lojban words that need not be grammatical, possibly none, and `zoi` quotes any text between two copies of a delimiter word (CLL 19.9 and 19.10). The quote rules are stated over `any-word` and `anything`. The word stage decides where a `zo`, `lo'u` or `zoi` quote ends and hands on its parts as tokens, the quoted words tagged `word` and foreign text tagged `foreign-text`; only `lu ... li'u` is delimited by this grammar, whose free-modifier slot follows the quote whether or not `li'u` is written.

`sumti-tail` is what follows a descriptor: an optional inner sumti that possesses or restricts, `le mi zdani`, then the inner quantifier and the selbri, `le ci gerku`, or a quantifier and a sumti, `lo re lo gerku`; relative clauses may come after the inner sumti or replace it (CLL 6.2 and 8.7).

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

A relative clause attaches to a sumti and restricts or comments on it (CLL 8). `goi` and the other members of GOI take a term, `mi goi ko'a`, `le zdani pe mi`, and are closed by `ge'u`; `poi`, `noi` and `voi` take a subsentence in which `ke'a` refers back to the sumti, closed by `ku'o`. Several relative clauses on one sumti are joined by `zi'e`.

```jbogenbau
%rule relative-clauses
  relative-clause [ZIhE # relative-clause] ...

%rule relative-clause
  GOI # term [GEhU #] | NOI # subsentence [KUhO #]
```

## Selbri and tanru

A selbri is the predicate of a bridi (CLL 5). It may be preceded by a tag, which is how a tense or modal is attached to the whole bridi when it is not written as a term (`mi pu klama`), and the levels below state the tanru grouping. `selbri-1` allows `na` before a selbri, the contradictory negation (CLL 15.2). `selbri-2` is the `co` inversion, `sutra co tavla`, which swaps the order of modifier and modified and groups to the right, so everything after `co` is the modifier's argument structure (CLL 5.8). `selbri-3` is a plain tanru: a sequence of `selbri-4` with no connective between them, grouping to the left, so `barda gerku zdani` is `(barda gerku) zdani`. `selbri-4` joins units by a jek or joik in afterthought, `barda je melbi`, or by a joik followed by `ke ... ke'e`. `selbri-5` is the `bo` form, which binds more tightly than plain juxtaposition, `melbi cmalu bo nixli`. `selbri-6` is a tanru unit, optionally followed by `bo` and a further `selbri-6`, or a forethought connection with a guhek, `gu'e barda gi melbi`, optionally negated by `na'e` (CLL 5.6, 14.12).


A tanru unit is one brick of the selbri. `tanru-unit` allows `cei` to assign the unit to a pro-bridi (`broda cei klama`), and `tanru-unit-1` attaches linked arguments, `be ... bei ... be'o`, which fill the places of that one unit rather than of the whole bridi (CLL 5.7). `tanru-unit-2` lists the simple units: a brivla; a pro-bridi `go'i` with optional `ra'o`; a `ke ... ke'e` grouped selbri; `me sumti me'u`, which turns a sumti into a selbri, optionally with a following `moi`; a number or lerfu string with `moi`, `mei` or the others of MOI; `nu'a` before an operator; a conversion `se`, `te`, ...; `jai` with an optional tag; a `zei` compound of any words; a scalar negation `na'e`; and an abstraction, `nu`, `ka`, `du'u` and the others of NU, possibly connected by jek or joik (`nu je ka`), around a subsentence and closed by `kei`. The `SE`, `JAI` and `NAhE` forms refer back to `tanru-unit-2`, so `se se broda` and `na'e se broda` are single units.

```jbogenbau
%rule selbri
  [tag] selbri-1

%rule selbri-1
  selbri-2 | NA # selbri

%rule selbri-2
  selbri-3 [CO # selbri-2]

%rule selbri-3
  selbri-4 ...

%rule selbri-4
  selbri-5 [joik-jek selbri-5 | joik [stag] KE # selbri-3 [KEhE #]] ...

%rule selbri-5
  selbri-6 [(jek | joik) [stag] BO # selbri-5]

%rule selbri-6
  tanru-unit [BO # selbri-6] | [NAhE #] guhek selbri gik selbri-6

%rule tanru-unit
  tanru-unit-1 [CEI # tanru-unit-1] ...

%rule tanru-unit-1
  tanru-unit-2 [linkargs]

%rule tanru-unit-2
  | BRIVLA #
  | GOhA [RAhO] #
  | KE # selbri-3 [KEhE #]
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

A number is a string of PA words, digits and the like, into which lerfu words may be mixed after the first word (`pa re ci`, `pa xy.`), and a lerfu string is the same thing beginning with a lerfu word (CLL 18.2, 17.9). A lerfu word is a member of BY, any word followed by `bu`, a `lau` shift before a lerfu word, or a `tei ... foi` compound. A quantifier is a number closed by `boi` or a mekso in `vei ... ve'o` brackets (CLL 18.6).

A mekso is a mathematical expression, and the rules follow CLL 18 closely. `mex` is a sequence of `mex-1` joined by operators in afterthought infix form, `li pa su'i re`, or a reverse Polish expression introduced by `fu'a`. `mex-1` is the `bi'e` form, which binds an operator more tightly than its neighbours (CLL 18.5). `mex-2` is an operand, or a forethought operator with `pe'o` before its operands, closed by `ku'e`. In reverse Polish notation an expression is two operands followed by an operator, and each operand may itself be such an expression. Operators have their own connectives and grouping, in the same shape as selbri: `operator` joins operators by jek or joik or a `ke` group, `operator-1` gives the guhek forethought and the `bo` forms, and `operator-2` is a simple operator or a `ke ... ke'e` group. A simple `mex-operator` is a VUhU word, possibly converted by `se` or negated by `na'e`, an operator made from a mekso through `ma'o`, or a selbri used as an operator through `na'u`, the last two closed by `te'u`. Operands likewise connect: `operand` takes a `ke` group, `operand-1` the afterthought connectives, `operand-2` the `bo` form, and `operand-3` lists the simple operands, a quantifier, a lerfu string, a selbri through `ni'e`, a sumti through `mo'e`, an array through `jo'i`, a forethought connection, and a `la'e` or `na'e bo` reference.

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
  operator-1 [joik-jek operator-1 | joik [stag] KE # operator [KEhE #]] ...

%rule operator-1
  operator-2 | guhek operator-1 gik operator-2 | operator-2 (jek | joik) [stag] BO # operator-1

%rule operator-2
  mex-operator | KE # operator [KEhE #]

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

Lojban has one set of logical connectives spelled differently for each level of the grammar (CLL 14.3): an ek joins sumti (`.e`, `.a`), a gihek joins bridi-tails (`gi'e`), a jek joins tanru units and, after `.i`, sentences (`je`), and a gek is the forethought form (`ga ... gi`). Each afterthought connective may be negated on either side, `na` before and `nai` after, and converted by `se`. A joik is a non-logical connective, `joi`, `ce`, `jo'u` and the rest of JOI, or an interval `bi'i` or `bi'o`, possibly bounded by `ga'o` or `ke'i` (CLL 14.14, 14.16). `joik-ek` and `joik-jek` are the pairs that stand in the same position and each carries a free-modifier slot. A gek is a forethought logical connective, a joik used in forethought with `gi`, or a tense with `gi` (`pu gi ... gi`), and the two halves are separated by a gik, `gi` optionally negated. A guhek is the forethought connective of tanru units.

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

%rule gek
  [SE] GA [NAI] # | joik GI # | stag gik

%rule guhek
  [SE] GUhA [NAI] #

%rule gik
  GI [NAI] #
```

## Tenses and modals

A tag is what turns a sumti into a modal or tense term and what marks a selbri or a whole sentence with a tense (CLL 9 and 10). `tag` is one or more tense-modals joined by jek or joik, `pu je ca`; `stag` is the restricted form allowed inside connectives before `bo` and `ke` and in a gek, where the free-modifier slot would be ambiguous. A `tense-modal` is a simple tense-modal with a free-modifier slot, or `fi'o selbri fe'u`, which makes a modal from any selbri (CLL 9.5). A `simple-tense-modal` is a BAI modal, a tense built from time and space, the tense shorthand `ki` that sets a reference point (CLL 10.13), or the question word `cu'e`. A BAI modal may be converted by `se`, and a BAI modal or a tense may be negated by `na'e` and followed by `ki`.

A time tense is any combination, in order, of a `zi` distance, offsets `pu`, `ca`, `ba` each with an optional distance, an interval `ze'a` with an optional direction, and interval properties (CLL 10.4 to 10.9). A space tense is likewise a `va` distance, `fa'a`-family offsets, a space interval, and a `mo'i` movement. A space interval is `ve'a` or `vi'a` or both, with a direction, and `fe'e` before an interval property applies that property to space rather than time. An interval property is `roi` with a number, `ta'e` and the others of TAhE, or a ZAhO event contour; each may take `nai`.

```jbogenbau
%rule tag
  tense-modal [joik-jek tense-modal] ...

%rule stag
  simple-tense-modal [(jek | joik) simple-tense-modal] ...

%rule tense-modal
  simple-tense-modal # | FIhO # selbri [FEhU #]

%rule simple-tense-modal
  [NAhE] [SE] BAI [NAI] [KI] | [NAhE] ((time [space] | space [time]) & CAhA) [KI] | KI | CUhE

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

A free modifier may stand wherever the grammar writes `#`, which is after almost every word (CLL 19.12). The forms are: a `sei ... se'u` discursive bridi, `sei mi cusku`; a `soi ... se'u` reciprocity marker; a vocative phrase, `coi` or `doi` and their kin, followed by a selbri, by names, or by a sumti, and closed by `do'u`; an utterance ordinal `pa mai`; a parenthetical text `to ... toi`; and a subscript `xi` with a number, lerfu string or bracketed mekso. The `se'u`, `do'u`, `toi`, `boi` and `ve'o` here are elidable, but they are written without `#`, since the slot that follows a free modifier is the one it sits in.

A vocative is a run of COI words, each with an optional `nai`, or `doi`, or both in that order. Indicators are the attitudinals and discursives, `UI` and `CAI` with an optional `nai`, the hesitation `y`, the cancel `da'o`, and `fu'o`, which closes a scope opened by `fu'e`. A run of indicators attaches to the word before it, as CLL's non-formal rule below says, which is why `indicators` appears only at the start of a text.

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
  [FUhE] indicator ...

%rule indicator
  (UI | CAI) [NAI] | Y | DAhO | FUhO
```

## The non-formal rules

CLL ends its grammar with four rules it calls non-formal, since a parser applies them before the grammar proper rather than through it (CLL 21). Two of them are the material of quotes. The word stage delimits every quote but `lu ... li'u`, and hands on a quoted word tagged `word` and quoted foreign text tagged `foreign-text`, so here they are ordinary rules:

```jbogenbau
%rule any-word
  "word"

%rule anything
  "foreign-text"
```

The other two are applied by the stages before this one: the indicator stage attaches `ba'e` and indicators to their words, and the word stage applies the erasers. They are shown as CLL prints them, for reference only; the `utterance` that `sa` erases is not defined anywhere in CLL.

```text
word = [BAhE] any-word [indicators]
null = any-word SI | utterance SA | text SU
```

## Choosing among parses

Because terminators may be omitted, some texts have more than one parse. The stage chooses among them by the rule that [the notation document](../../docs/notation.md) states under "Ambiguity" and "Elided terminators", with the resolution each dialect declares. Both dialects that use this grammar declare `greedy elision-only`: a constituent ends as late as the grammar allows, and a text whose parses differ in anything but where a terminator was elided is an error. They differ in where the part before an elided terminator may end. The cll-ebnf dialect takes the printed grammar as normative and lets it end wherever a parse of the whole text needs it (`cll-ebnf.md`). The bpfk dialect reads as the PEG grammars that the definition effort adopted, which never end it where it could have been longer (`bpfk.md`). CLL's official parser reads in a third way, one lexeme ahead, which no dialect here follows; the design document says why.

Example. `le sutra tavla` has two parses: a statement with the description `le sutra`, its `ku` elided before `tavla`, and the selbri `tavla`; or a fragment consisting of the single description `le sutra tavla`. The two agree up to the word `sutra`. There the statement closes the tanru of the description, the first step toward closing the description itself, while the fragment reads `tavla` into that tanru. The greedy rule takes the parse that reads, and `le sutra tavla` is a fragment. A speaker who means the statement says `le sutra cu tavla` or `le sutra ku tavla`.

## Differences from the printed CLL grammar

This grammar departs from the EBNF printed in CLL in four places. The first settles a precedence that the printed text states in a way that cannot be meant. The other three are repairs of the EBNF's copy of the YACC grammar, the machine grammar from which the EBNF was transcribed and whose rule numbers it cites: in each, the EBNF lost a path that the YACC grammar has, and the official parser built from the YACC grammar accepts the text. Apart from these, the printed grammar's `CMENE` is spelled `CMEVLA` here, the class the word stage gives a name.

1. In `simple-tense-modal`, the printed text reads `[NAhE] (time [space] | space [time]) & CAhA [KI]`, which by the stated precedence of `&` attaches `[NAhE]` only to the time/space branch and `[KI]` only to the `CAhA` branch. This grammar reads `[NAhE] ((time [space] | space [time]) & CAhA) [KI]`, so that `ba za ki` is one tag and `na'e ka'e` is a tag.
2. A text may begin with `.i` separators followed by `ni'o` markers, as in `.i ni'o mi klama`. The printed `text-1` makes the two alternatives; YACC rule 2 (`text_B_2`) lets any number of `.i` forms precede a `ni'o` run, and the camxes grammars call the printed form "a bug in the BNF".
3. A `lo'u ... le'u` quote may be empty, `lo'u le'u`. The printed `sumti-6` requires at least one word; YACC rule 436 reads the quote's body as one token that may be empty.
4. The free-modifier slot after a `lu ... li'u` quote follows the quote whether or not `li'u` is written, so `lu cy. to toi` is a quote followed by a parenthesis. The printed `sumti-6` writes `/LIhU#/`, which drops the slot with the elided `li'u`; YACC rule 432 (`quote_arg`) attaches free modifiers to the whole quote, and its `LIhU` gap carries none. Every other elidable terminator keeps its slot as printed.

The free-modifier slot after an elided terminator is kept as printed: an elided `[X #]` leaves no slot. So a free modifier cannot follow an elided `boi`, and where CLL example 17.38 writes `xy. xi ky.`, this grammar requires `xy. boi xi ky.`.
