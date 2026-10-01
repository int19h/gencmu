# The Zantufa grammar

This document is the syntax of the [Zantufa](../dialects/zantufa.md) dialect. A dialect is a pipeline of stages, defined by one pipeline document. Its reference is Guskant's Zantufa 1.9999, `zantufa-1.9999.peg` in the `gerna_cipra` repository, a PEG (parsing expression grammar). It is a grammar of its own, and it translates the reference rule by rule.

A rule that translates a rule of the reference has that rule's name, written with hyphens, and its comment gives the reference's rule. Each other rule is a part of a reference rule that needs a name of its own, or a rule that a condition tests. The conditions state the reference's lookaheads and ordered choices. A lookahead is a test of the words that follow. An ordered choice is a list of alternatives tried in order.

A cmavo is a particle, a short structure word. A selma'o is a word class of cmavo. [The Zantufa lexicon](../words/lexicon-zantufa.md) gives each cmavo the selma'o that Zantufa gives it. For example, most tense words are BAI, `ca'a` and `ka'e` are NA, and `je` is JOI. Also, `la` is LE, `ce'e` is BO, and `nai` and `sa` are UI.

The prose also uses these Lojban terms:

- A gismu is a root word.
- A rafsi is a shortened word form used inside compounds.
- A selbri is the predicate of a sentence.
- A sumti is an argument of a selbri.
- A tanru is a compound selbri.
- A bridi-tail is a selbri with any terms after it.
- A lerfu word is a letter word, such as `.abu` or `xy.`.
- A mekso is a mathematical expression.

A stage is one step of a pipeline, with its own grammar. The pipeline is the sequence of stages that reads a text. The indicator stage attaches `ba'e` and the other words of BAhE to the word after them, so this grammar does not read them. It reads every other word, the attitudinals included.

Zantufa lets free modifiers follow every word (`post_clause`), with a few exceptions. These are `bu`, `fa'o`, a word of SI or BAhE, and the words inside a quote. So the translation writes `#`, the slot for free modifiers, after each terminal and after each quote. An elidable terminator keeps its slot inside its brackets, `[KU #]`, as the reference's `KU_elidible <- KU_clause?` does. After a PA word, the free modifiers do not begin with a number (`number_post_clause`). After a BY word they do not begin with a lerfu string, and after a COI word they do not begin with a vocative.

The word stage reads the magic words, the words such as `si` that act on other words. `zei` is SI there and erases a word, `sa` is an attitudinal, and `su` erases the whole text before it. "Differences from Zantufa 1.9999" says where the last differs from Zantufa.

[The notation document](../../docs/notation.md) explains the notation. A lookahead of the reference, such as `!terms`, is a condition with `begins`. The terminals of this grammar (the symbols that each match one input token) are selma'o. A tag marks a token by name, phoneme or character. The rules `any-word` and `anything` match tokens tagged `word` and `quoted-text`, respectively. The word stage puts these tags on the words of a quote and on a unit that a quote hands on whole.

The directive `%ambiguity-resolution late-elision` says how the stage chooses among parses. It compares two parses only where they elide terminators. At the first place where they differ, it takes the parse that reads on. So a terminator is elided as late as the grammar allows. Two parses that elide the same terminators at the same places are tied, and a tie is an error. The stage does not declare `maximal` or `elision-only`.

A PEG's repetition reads as far as it can, and the ranking usually gives the same reading. Where two alternatives of an ordered choice can read the same words, the later one has a condition that removes that reading. So the grammar, not the ranking, settles a choice that elides no terminator. The terminators that the reference writes with `_elidible` are elidable here, but `cu` and `i'au` are not.

The reference writes `CU_elidible`, but `cu` is a separator. It stands between the terms and the bridi-tail, and it closes neither of them. CLL's grammar does not make `cu` elidable either. So `[CU #]` is an ordinary optional here. A written `cu` parses as before, and a sentence can still omit it. `maximal` and `elision-only` do not treat `cu` as a terminator.

An absent `cu` makes no elided node in the tree, and the ranking does not count it. This matters. If `cu` is elidable, an absent `cu` is an elision before the bridi-tail, and so an early one. The ranking then prefers a reading that closes a parenthesis, a quote or a `jai` early, and begins the bridi-tail later. With an elidable `cu`, `to na cafne` closes the parenthesis after `na`. Zantufa holds `na cafne` in the parenthesis, and so does this grammar.

The same holds for `i'au`. The reference writes `IAU_elidible` between a statement and the terms after it (`statement-terms`). There `i'au` separates the terms from the statement, and it closes nothing. So `[IAU #]` is an ordinary optional too, and an absent `i'au` makes no elided node.

The grammar also states the attachment conventions of the reference. These are the points where a greedy repetition or an ordered choice of the reference decides how words attach. A condition states each of them, so that the grammar gives the reading, and the ranking does not. These are the conventions:

- Free modifiers nest (see "Free modifiers").
- A connective joins sumti before it joins terms (see "Sumti").
- A run of operators is one unit (see "Mekso").
- A gek before bridi-tails begins a forethought bridi-tail (see "Sentences and bridi-tails").

Each of these conditions is a restriction of the grammar, not a preference among whole parses. It removes a reading where the words from a given point begin a given rule. It does not test whether the remaining reading gives a parse of the whole text.

```jbogenbau
%ambiguity-resolution late-elision

%elidable
  BEhO BOI DOhU FEhU GEhU GIhI KEI KEhE KU KUhAU KUhE
  KUhO LIhAU LIhU LOhO LUhU MEhU SEhU TEhU TOI TUhU VAU VEhO

%rule #
  [free ...]

%rule any-word
  ~word

%rule anything
  ~quoted-text
```

## The text and its paragraphs

A text is free modifiers and then paragraphs, which `ni'o` and `no'i` separate. A run of `ni'o` can stand alone, or join two paragraphs with a connective, or with a connective or a tense or modal and `bo`. A paragraph is statements and fragments, separated by `.i`.

A text after a word of LU, TO or LUhEI, such as `lu`, is a `text` too. It begins with its own free modifiers, and the opener takes none. So in `lu ui mi klama li'u`, the `ui` belongs to the quote, and in `lu doi djan. mi klama li'u` so does the vocative. The dialect departs from Zantufa here (see "Differences from Zantufa 1.9999").

```jbogenbau
%rule text
  (* text <- intro_null free* paragraphs? si_clause? SI_clause* faho_clause EOF? *)
  # [paragraphs]

%rule paragraphs
  (* paragraphs <- (NIhO_clause+ paragraphs_1?)+ / paragraphs_1 (NIhO_clause+ paragraphs_1?)* *)
  (NIhO #) ... [paragraphs-tail] | paragraphs-tail

%rule paragraphs-tail
  paragraphs-1 [(NIhO #) ... [paragraphs-tail]]

%rule paragraphs-1
  (* paragraphs_1 <- paragraphs_2 (NIhO_clause+ joik paragraphs_2)* *)
  paragraphs-2 [(NIhO #) ... joik paragraphs-2] ...

%rule paragraphs-2
  (* paragraphs_2 <- paragraph (NIhO_clause+ joik? tag? BO_clause paragraph)* *)
  paragraph [(NIhO #) ... [joik] [tag] BO # paragraph] ...

%rule paragraph
  (* paragraph <- (I_clause (statement_terms / fragment)?)+
                / (statement_terms / fragment) (I_clause (statement_terms / fragment)?)* *)
  | (I # [statement-terms | fragment]) ...
  | (statement-terms | fragment) [I # [statement-terms | fragment]] ...
```

## Statements and fragments

A statement can take terms after it, which `i'au` can introduce (`statement-terms`). A forethought connection of statements has any number of `gi` branches and an optional `gi'i`. `.i` with a connective, or with a connective or a tense or modal and `bo`, joins a statement to the one before it. So a text cannot begin that way.

The lookaheads of the reference's fragments are conditions here. A `gek` or `joik` fragment does not begin terms. A `na` fragment has no terms or `ku` after it. And a terms fragment has no mekso after it. A mekso fragment is not also a terms fragment, because the reference tries terms first. It has no sumti or selbri after it, because Zantufa reads such a mekso as the quantifier of a term first.

```jbogenbau
%rule statement-terms
  (* statement_terms <- statement IAU_elidible terms? *)
  statement [IAU #] [terms]

%rule statement
  (* statement <- statement_1 / prenex statement *)
  statement-1 | prenex statement

%rule statement-1
  (* statement_1 <- statement_2 (I_clause joik statement_2)* *)
  statement-2 [I # joik statement-2] ...

%rule statement-2
  (* statement_2 <- statement_3 (I_clause joik? tag? BO_clause statement_3)* *)
  statement-3 [I # [joik] [tag] BO # statement-3] ...

%rule statement-3
  (* statement_3 <- sentence / tag? TUhE_clause paragraphs TUhU_elidible / gek_statement *)
  sentence | [tag] TUhE # paragraphs [TUhU #] | gek-statement

%rule gek-statement
  (* gek_statement <- gek statement (gik statement)+ GIhI_elidible *)
  gek $a(gek-branches) gik $l(statement) [GIhI #]
%conditions
  ¬matches($a, sentence-branches) ∨ ¬matches($l, sentence-continued)

%rule gek-branches
  (* statement (gik statement)*: every branch but the last. Zantufa's sentence comes first in statement_3, and it
     succeeds where each of these is a sentence and the last branch is a sentence, perhaps with the .i links of
     statement_1 and statement_2 after it, which then continue the statement outside the forethought *)
  statement [gik statement] ...

%rule sentence-branches
  sentence [gik sentence] ...

%rule sentence-continued
  sentence [statement-link] ...

%rule statement-link
  I # joik statement-2 | I # [joik] [tag] BO # statement-3

%rule fragment
  (* fragment <- prenex / !terms gek / !terms joik / ek / gihek / NA_clause !terms !KU
               / terms VAU_elidible !mex / mex / relative_clauses / links / linkargs *)
  | prenex
  | $g(gek)
  | $j(joik)
  | ek
  | gihek
  | $n(na-clause)
  | $t(terms-vau)
  | $m(mex)
  | relative-clauses
  | links
  | linkargs
%conditions
  ¬begins(from($g), terms),
  ¬begins(from($j), terms),
  ¬begins(after($n), terms),
  ¬begins(after($n), ku-word),
  ¬begins(after($t), mex),
  ¬matches($t, na-clause),
  ¬matches($m, terms-vau),
  ¬begins(after($m), sumti-5),
  ¬begins(after($m), selbri)

%rule prenex
  (* prenex <- terms ZOhU_clause *)
  terms ZOhU #

%rule na-clause
  NA #

%rule terms-vau
  terms [VAU #]

%rule ku-word
  KU
```

## Sentences and bridi-tails

A sentence is terms, an optional `cu` and a bridi-tail, or a forethought connection of sentences. Terms stand only before the first bridi-tail, because Zantufa has no JACU (a proposal for a simpler system of connectives). Bridi-tails connect at three levels, as in camxes.

A gek before bridi-tails begins a forethought bridi-tail, not a forethought connection of sentences. So in `mi ge klama gi cadzu`, the gek is part of the bridi-tail after `mi`. The condition on the second alternative of `sentence` states this. It is the ordered choice of the reference, which tries the bridi-tail first. This is deliberate. Dated comments of the reference record that its author ordered these alternatives so, and give the intended trees.

The outer level takes a connective only where the inner one cannot. That is where `ke` follows it, with or without a tense or modal first, or where a tense or modal and `cu` follow it. The reference's lookaheads leave these forms to the outer level. After `ke`, the words are a group of bridi-tails, unless a selbri ends with `ke'e` there, and then they are a tanru.

```jbogenbau
%rule sentence
  (* sentence <- terms? CU_elidible bridi_tail / terms? gek sentence (gik sentence)+ GIhI_elidible tail_terms *)
  | [terms] [CU #] bridi-tail
  | [terms] $g(gek) sentence (gik sentence) ... [GIhI #] tail-terms
%conditions
  ¬begins(from($g), bridi-tail)

%rule bridi-tail
  (* bridi_tail <- bridi_tail_1 (joik_gihek tag? CU_elidible bridi_tail_1)* *)
  bridi-tail-1 [bridi-tail-link] ...

%rule bridi-tail-link
  | $j(joik-gihek) tag [CU #] bridi-tail-1
  | $j(joik-gihek) $b(bridi-tail-1)
%conditions
  begins(after($j), tag-ke) ∨ begins(after($j), tag-cu),
  ¬begins(from($b), tag)

%rule tag-cu
  tag CU

%rule bridi-tail-1
  (* bridi_tail_1 <- bridi_tail_2 (joik_gihek !(tag? BO_clause) !(tag? KE_clause) CU_elidible bridi_tail_2 tail_terms)* *)
  bridi-tail-2 [bridi-tail-1-link] ...

%rule bridi-tail-1-link
  $j(joik-gihek) [CU #] bridi-tail-2 tail-terms
%conditions
  ¬begins(after($j), tag-bo),
  ¬begins(after($j), tag-ke)

%rule tag-bo
  [tag] BO

%rule tag-ke
  [tag] KE

%rule bridi-tail-2
  (* bridi_tail_2 <- bridi_tail_3 ((tag / joik_gihek tag?) BO_clause CU_elidible bridi_tail_3 tail_terms)* *)
  bridi-tail-3 [(tag | joik-gihek [tag]) BO # [CU #] bridi-tail-3 tail-terms] ...

%rule bridi-tail-3
  (* bridi_tail_3 <- KE_clause !(selbri_2 KEhE) bridi_tail KEhE_elidible tail_terms / selbri tail_terms / gek_bridi_tail *)
  | $k(ke-clause) bridi-tail [KEhE #] tail-terms
  | $s(selbri) tail-terms
  | gek-bridi-tail
%conditions
  ¬begins(after($k), selbri-2-kehe),
  ¬begins(from($s), ke-word) ∨ begins(from($s), ke-selbri-2-kehe)

%rule ke-selbri-2-kehe
  KE # selbri-2 KEhE

%rule ke-clause
  KE #

%rule selbri-2-kehe
  selbri-2 KEhE

%rule gek-bridi-tail
  (* gek_bridi_tail <- gek bridi_tail (gik bridi_tail)+ !(gik (term / CU)) GIhI_elidible tail_terms
                     / tag* KE_clause gek_bridi_tail KEhE_elidible / NA_clause gek_bridi_tail *)
  | gek bridi-tail $g(gik-bridi-tails) [GIhI #] tail-terms
  | [tag ...] KE # gek-bridi-tail [KEhE #]
  | NA # gek-bridi-tail
%conditions
  ¬begins(after($g), gik-term)

%rule gik-bridi-tails
  (gik bridi-tail) ...

%rule gik-term
  gik (term | CU)

%rule tail-terms
  (* tail_terms <- term* VAU_elidible *)
  [term ...] [VAU #]
```

## Terms

Zantufa has no termsets. A term is a `xoi` clause, a `ke` group of terms, a tense or modal with its sumti, or a sumti. It can also be a briga'i form (`noi'a` with a selbri, or a bare `na`), or a forethought connection of terms. A sumti comes before a forethought term over the same words, as in the reference's ordered choice.

In a term, no forethought bridi-tail, `bo` or selbri directly follows a tense or modal, as the reference's lookaheads say. No further part of a tense or modal follows it either, because the reference reads a tense or modal as far as it can. The reference's lookahead lets a selbri follow where the selbri begins with a tense or modal. But no such selbri is left after a tense or modal that reads as far as it can. So `mi pe pu ba broda` has no parse, as in Zantufa, and `mi pe pu ku ba broda` has one.

```jbogenbau
%rule terms
  (* terms <- term+ *)
  term ...

%rule term
  (* term <- term_1 (!(joik tag BO_clause? CU) joik_ek term_1)* *)
  term-1 [term-link] ...

%rule term-link
  $j(joik-ek) term-1
%conditions
  ¬begins(from($j), joik-tag-cu)

%rule joik-tag-cu
  joik tag [BO #] CU

%rule term-1
  (* term_1 <- term_2 (joik_ek? BO_clause term_2)* *)
  term-2 [[joik-ek] BO # term-2] ...

%rule term-2
  (* term_2 <- XOI_clause statement SEhU_elidible / KE_clause !(sumti KEhE) term+ KEhE_elidible
              / tag_term / !tag sumti / brigahi / gek_term *)
  | XOI # statement [SEhU #]
  | $k(ke-clause) term ... [KEhE #]
  | tag-term
  | $s(sumti)
  | brigahi
  | $g(gek-term)
%conditions
  ¬begins(from($g), sumti) ∨ begins(from($g), tag),
  ¬begins(after($k), sumti-kehe),
  ¬begins(from($s), tag)

%rule sumti-kehe
  sumti KEhE

%rule brigahi
  (* brigahi <- (POIhA_clause free* selbri / NA_clause !bridi_tail !joik_gihek) KU_elidible *)
  | POIhA # selbri [KU #]
  | $n(na-clause) [KU #]
%conditions
  ¬begins(after($n), bridi-tail),
  ¬begins(after($n), joik-gihek)

%rule tag-term
  (* tag_term <- !gek (tag !(!tag selbri) !gek_bridi_tail !BO
                      / (FA_clause (joik FA_clause)* / JAI_clause tag?) !tanru_unit_1) (sumti / KU_elidible) *)
  | $t(tag) tag-term-argument
  | $f(fa-jai) tag-term-argument
%conditions
  ¬begins(from($t), gek),
  ¬begins(after($t), tcita-selci),
  ¬begins(after($t), selbri),
  ¬begins(after($t), gek-bridi-tail),
  ¬begins(after($t), bo-word),
  ¬begins(after($f), tanru-unit-1)

%rule tag-term-argument
  sumti | [KU #]

%rule fa-jai
  FA # [joik FA #] ... | JAI # [tag]

%rule bo-word
  BO

%rule gek-term
  (* gek_term <- gek term+ (gik term+)+ GIhI_elidible *)
  gek term ... (gik term ...) ... [GIhI #]
```

## Sumti

A sumti can be a `ra'oi`, `zo`, `zoi` or `lo'u` quote, a lerfu string, a `lu` quote, a `la'e` form, or a pro-sumti. It can also be a `lo'oi` abstraction over a statement, a description, a `li` mekso, or `na'e` with a sumti. A lerfu string is a sumti only where no mekso operator follows it, as the reference's two lookaheads say. The inner sumti of a description does not begin with a quantifier.

A connective after a sumti joins that sumti to the next one, not the term to the next term. So `ba mi .e do klama` has one term, the tense `ba` with the sumti `mi .e do`. The term rule sees a connective only where the sumti cannot take it. The reference reads so because a term reads its sumti first, and the repetitions of `sumti_1` and `sumti_2` read as far as they can. No comment of the reference discusses this choice. But it is also the reading of CLL, which has no connection of terms, and of camxes.

The conditions on `sumti-1` and `sumti-2` state this. Each says that no further link follows the whole run of sumti. The run is a rule of its own, because a condition on a rule with a repetition applies at each step of the repetition. On `sumti-1` itself, the condition applies to `mi` alone in `mi ce do`, and so it rejects the text. The rules `sumti-1-link` and `sumti-2-link` are only for the conditions, and the trees do not contain them.

```jbogenbau
%rule sumti
  (* sumti <- sumti_1 (VUhO_clause relative_clauses)? *)
  sumti-1 [VUhO # relative-clauses]

%rule sumti-1
  (* sumti_1 <- sumti_2 (joik_ek sumti_2)* *)
  $r(sumti-1-run)
%conditions
  ¬begins(after($r), sumti-1-link)

%rule sumti-1-run
  sumti-2 [joik-ek sumti-2] ...

%rule sumti-1-link
  joik-ek sumti-2

%rule sumti-2
  (* sumti_2 <- sumti_3 (joik_ek? tag? BO_clause sumti_3)* *)
  $r(sumti-2-run)
%conditions
  ¬begins(after($r), sumti-2-link)

%rule sumti-2-run
  sumti-3 [[joik-ek] [tag] BO # sumti-3] ...

%rule sumti-2-link
  [joik-ek] [tag] BO # sumti-3

%rule sumti-3
  (* sumti_3 <- (KE_clause sumti KEhE_elidible / sumti_4 / gek sumti (gik sumti)+ GIhI_elidible) relative_clauses? *)
  (KE # sumti [KEhE #] | sumti-4 | gek sumti (gik sumti) ... [GIhI #]) [relative-clauses]

%rule sumti-4
  (* sumti_4 <- quantifier? sumti_5 / quantifier selbri KU_elidible *)
  [quantifier] sumti-5 | quantifier selbri [KU #]

%rule sumti-5
  (* sumti_5 <- RAhOI_clause / ZO_clause / ZOI_clause / LOhU_clause
              / lerfu_string BOI_elidible !(BO_clause* operand* !(joik_ek (sumti / relative_clause)) operator) !(operand KEhE)
              / LU_clause text LIhU_elidible / (LAhE_clause / NAhE_clause BO_clause) relative_clauses? sumti LUhU_elidible
              / KOhA_clause / LOhOI_clause (joik LOhOI_clause)* statement KUhAU_elidible / LE_clause sumti_tail KU_elidible
              / li_clause / NAhE_clause sumti_3 *)
  | RAhOI anything #
  | ZO any-word #
  | ZOI any-word anything any-word #
  | LOhU [any-word ...] LEhU #
  | $l(lerfu-boi)
  | LU text [LIhU #]
  | (LAhE # | NAhE # BO #) [relative-clauses] sumti [LUhU #]
  | KOhA #
  | LOhOI # [joik LOhOI #] ... statement [KUhAU #]
  | LE # sumti-tail [KU #]
  | LI # mex [LOhO #]
  | NAhE # sumti-3
%conditions
  ¬begins(after($l), lerfu-operator),
  ¬begins(after($l), operand-kehe)

%rule lerfu-boi
  lerfu-string [BOI #]

%rule lerfu-operator
  [(BO #) ...] [operand ...] $o(operator)
%conditions
  ¬begins(from($o), joik-ek-sumti)

%rule joik-ek-sumti
  joik-ek (sumti | relative-clause)

%rule operand-kehe
  operand KEhE

%rule sumti-tail
  (* sumti_tail <- relative_clauses? (!quantifier sumti)? sumti_tail_1 *)
  | [relative-clauses] sumti-tail-1
  | [relative-clauses] $s(sumti) sumti-tail-1
%conditions
  ¬begins(from($s), quantifier)

%rule sumti-tail-1
  (* sumti_tail_1 <- tag? quantifier? selbri / quantifier sumti *)
  | tag quantifier selbri
  | $t(tag) $u(selbri)
  | quantifier selbri
  | $s(selbri)
  | quantifier sumti
%conditions
  ¬begins(from($u), tcita-selci),
  ¬begins(from($s), tag)
```

## Relative clauses

Relative clauses can stand side by side, joined by a joik or by nothing. They follow a sumti, and they can follow a selbri too (see "Selbri and tanru").

```jbogenbau
%rule relative-clauses
  (* relative_clauses <- relative_clause (joik? relative_clause)* *)
  relative-clause [[joik] relative-clause] ...

%rule relative-clause
  (* relative_clause <- GOI_clause term GEhU_elidible / NOI_clause statement KUhO_elidible *)
  GOI # term [GEhU #] | NOI # statement [KUhO #]
```

## Selbri and tanru

A selbri can take a tense, a modal or `na` before it, and relative clauses and `cei` after it. A tanru unit can be a name, because Zantufa reads a name as a selbri. It can also be a quote of GOhOI, MUhOI or LUhEI, such as a `go'oi` quote, or a mekso with `moi`. `me` makes a tanru unit of a sumti, operators, a mekso, or a tense or modal.

The conditions give these alternatives the reference's order of preference. So `me su'i pa moi` is two tanru units, `me su'i` and `pa moi`. A mekso after `me` is not followed by words that can make it a quantifier. And a tanru unit after the first does not begin with a joik and a `selbri_5`. Those words belong to the tanru unit before it, which reads them as its connection.

The reference tries a gek tanru unit before the forms with `se`, `fa` or `na'e` and a tanru unit. A gek can itself begin with `se`, and it can begin with a tag such as `na'e bai`. So `mi se ge klama gi cadzu` has two readings with the same elisions. In one, `se ge` is the gek. In the other, `se` converts the gek tanru unit `ge klama gi cadzu`. The reference takes the first, and a tie here is an error.

So the conditions state the reference's order. `se`, `fa` and `na'e` do not take a tanru unit where the words from them begin a gek tanru unit (`gek-tanru-unit`). And the gek alternative does not begin with `na'e`, because the reference's optional `NAhE_clause` takes it first. So in `na'e bai gi broda gi brode`, `na'e` comes before the gek `bai gi`.

A run of `cei` nests to the right. The reference repeats `(CEI_clause selbri)*`, but the selbri after the first `cei` reads every later `cei` first. So in `broda cei brode cei brodi`, the second `cei` is inside the selbri `brode cei brodi`. Here `selbri-1` takes at most one `cei` and the selbri after it. A repetition here gives two readings with the same elisions, and so a tie.

```jbogenbau
%rule selbri
  (* selbri <- selbri_1 / tag selbri / NA_clause selbri *)
  selbri-1 | tag $s(selbri) | NA # selbri
%conditions
  ¬begins(from($s), tcita-selci)

%rule selbri-1
  (* selbri_1 <- (!KE selbri_2 KEhE_clause linkargs / selbri_2) relative_clauses? (CEI_clause selbri)* *)
  | $s(selbri-2) KEhE # linkargs [relative-clauses] [CEI # selbri]
  | selbri-2 [relative-clauses] [CEI # selbri]
%conditions
  ¬begins(from($s), ke-word)

%rule ke-word
  KE

%rule selbri-2
  (* selbri_2 <- selbri_3 (CO_clause selbri_3)* *)
  selbri-3 [CO # selbri-3] ...

%rule selbri-3
  (* selbri_3 <- selbri_4+ *)
  selbri-4 [later-selbri-4] ...

%rule later-selbri-4
  (* selbri_4's (joik selbri_5)* reads a joik and a selbri_5 before the next selbri_4 can begin with them *)
  $x(selbri-4)
%conditions
  ¬begins(from($x), joik-selbri-5)

%rule joik-selbri-5
  joik selbri-5

%rule selbri-4
  (* selbri_4 <- selbri_5 (joik selbri_5)* *)
  selbri-5 [joik selbri-5] ...

%rule selbri-5
  (* selbri_5 <- selbri_6 (joik tag? BO_clause selbri_6)* *)
  selbri-6 [joik [tag] BO # selbri-6] ...

%rule selbri-6
  (* selbri_6 <- tanru_unit (BO_clause tanru_unit)* *)
  tanru-unit [BO # tanru-unit] ...

%rule tanru-unit
  (* tanru_unit <- tanru_unit_1 linkargs? *)
  tanru-unit-1 [linkargs]

%rule tanru-unit-1
  (* tanru_unit_1 <- CMEVLA_clause / BRIVLA_clause / GOhA_clause / KE_clause selbri_2 KEhE_elidible
                   / NAhE_clause? gek selbri_2 (gik selbri_2)+ !(gik? (term / CU)) GIhI_elidible
                   / MUhOI_clause / GOhOI_clause / LUhEI_clause text LIhAU_elidible
                   / ME_clause (sumti / operator+ / mex / tag) MEhU_elidible MOI_clause? / mex MOI_clause
                   / (FA_clause (joik FA_clause)* / SE_clause) tanru_unit_1 / JAI_clause tag? tanru_unit_1
                   / NAhE_clause tanru_unit_1 / NU_clause (joik NU_clause)* statement KEI_elidible *)
  | CMEVLA #
  | BRIVLA #
  | GOhA #
  | KE # selbri-2 [KEhE #]
  | NAhE # gek selbri-2 $g(gik-selbris) [GIhI #]
  | $k(gek) selbri-2 $g(gik-selbris) [GIhI #]
  | MUhOI any-word anything any-word #
  | GOhOI any-word #
  | LUhEI text [LIhAU #]
  | ME # sumti [MEhU #] [MOI #]
  | ME # operator ... [MEhU #] [MOI #]
  | ME # $m(mex) [MEhU #] [MOI #]
  | ME # $t(tag) [MEhU #] [MOI #]
  | mex MOI #
  | (FA # [joik FA #] ... | SE #) $w(tanru-unit-1)
  | JAI # [tag] tanru-unit-1
  | NAhE # $n(tanru-unit-1)
  | NU # [joik NU #] ... statement [KEI #]
%conditions
  ¬begins(after($g), gik-term-or-cu),
  ¬matches($m, sumti),
  ¬begins(after($m), sumti-5),
  ¬begins(after($m), selbri),
  ¬begins(from($m), operator),
  ¬matches($t, sumti),
  ¬begins(from($t), operator),
  ¬matches($t, mex),
  $n ⟹ ¬matches($, mex-moi),
  ¬begins(from($k), nahe-word),
  $n ⟹ ¬begins(from($), gek-tanru-unit),
  $w ⟹ ¬begins(from($), gek-tanru-unit)

%rule gek-tanru-unit
  [NAhE #] gek selbri-2 $g(gik-selbris)
%conditions
  ¬begins(after($g), gik-term-or-cu)

%rule nahe-word
  NAhE

%rule mex-moi
  mex MOI #

%rule gik-selbris
  (gik selbri-2) ...

%rule gik-term-or-cu
  [gik] (term | CU)

%rule linkargs
  (* linkargs <- BE_clause term links? BEhO_elidible *)
  BE # term [links] [BEhO #]

%rule links
  (* links <- BEI_clause term links? *)
  BEI # term [links]
```

## Mekso

Zantufa's mekso is flat: operands and runs of operators alternate, `bo` and `ke` group them, and `bi'e` raises the precedence of the operators after it. Reverse Polish takes `fu'a`, and forethought takes `pe'o` or a bare operator. A quantifier is a mekso that begins no sumti and no selbri, as the reference's lookaheads say. These are prefix tests, as a PEG's are.

The grammar reads a run of operators whole. So in `li re su'i ni'u pa`, `su'i ni'u` is one run. It is not an operator without an operand and then a link of its own. The rule `operators` states this, with a condition that no operator follows the run. The reference's `operator+` reads as far as it can. This is deliberate, and a comment of the reference shows a run of two operators as one unit, `[pi'i pi'i]`.

```jbogenbau
%rule quantifier
  (* quantifier <- !sumti_5 !selbri mex relative_clauses? *)
  $m(mex) [relative-clauses]
%conditions
  ¬begins(from($m), sumti-5),
  ¬begins(from($m), selbri)

%rule mex
  (* mex <- mex_1 (operator+ mex_1?)* *)
  mex-1 [mex-link] ...

%rule mex-link
  operators | operators $x(mex-1)
%conditions
  ¬begins(from($x), operator)

%rule mex-1
  (* mex_1 <- (KE_clause mex_2+ KEhE_elidible / mex_2 (BO_clause mex_2)* )
              (BIhE_clause operator+ (KE_clause mex_2+ KEhE_elidible / mex_2 (BO_clause mex_2)* )?)* *)
  mex-group [bihe-link] ...

%rule bihe-link
  BIhE # operators | BIhE # operators $x(mex-group)
%conditions
  ¬begins(from($x), operator)

%rule mex-group
  KE # mex-2 ... [KEhE #] | mex-2 [BO # mex-2] ...

%rule mex-2
  (* mex_2 <- operand / mex_rp / mex_forethought *)
  operand | mex-rp | mex-forethought

%rule mex-rp
  (* mex_rp <- FUhA_clause mex_2+ operator (mex_2* operator)* KUhE_elidible *)
  FUhA # mex-2 ... operator [[mex-2 ...] operator] ... [KUhE #]

%rule mex-forethought
  (* mex_forethought <- !(lerfu_string BOI_elidible) operator mex_2+ mex_forethought? KUhE_elidible
                      / PEhO_clause operator mex_2+ mex_forethought? KUhE_elidible *)
  [PEhO #] operator mex-2 ... [KUhE #]

%rule operator
  (* operator <- SE_clause operator / NAhE_clause operator / MAhO_clause (mex / selbri / sumti) TEhU_elidible
               / VUhU_clause / joik_ek !CU *)
  | SE # operator
  | NAhE # operator
  | MAhO # $m(mex) [TEhU #]
  | MAhO # $s(selbri) [TEhU #]
  | MAhO # $u(sumti) [TEhU #]
  | VUhU #
  | $j(joik-ek)
%conditions
  ¬begins(after($j), cu-word),
  ¬matches($j, se-operator),
  ¬matches($s, mex),
  ¬matches($u, mex),
  ¬matches($u, selbri)

%rule operators
  (* operator+, which reads every operator that follows *)
  $r(operator-run)
%conditions
  ¬begins(after($r), operator)

%rule operator-run
  operator ...

%rule cu-word
  CU

%rule se-operator
  SE # operator

%rule operand
  (* operand <- number BOI_elidible / lerfu_string BOI_elidible / VEI_clause mex VEhO_elidible
              / MOhE_clause (selbri / sumti) TEhU_elidible / (LAhE_clause / NAhE_clause BO_clause) mex LUhU_elidible
              / NAhE_clause operand *)
  | number [BOI #]
  | lerfu-string [BOI #]
  | VEI # mex [VEhO #]
  | MOhE # selbri [TEhU #]
  | MOhE # $u(sumti) [TEhU #]
  | (LAhE # | NAhE # BO #) mex [LUhU #]
  | NAhE # operand
%conditions
  ¬matches($u, selbri)

%rule number
  (* number <- PA_clause+;  PA_post <- number_post_clause *)
  (PA number-post) ...

%rule lerfu-string
  (* lerfu_string <- lerfu_word+ *)
  lerfu-word ...

%rule lerfu-word
  (* lerfu_word <- BY_clause / LAU_clause lerfu_word / TEI_clause lerfu_string FOI_clause;  BY_post <- lerfu_post_clause *)
  BY lerfu-post | LAU # lerfu-word | TEI # lerfu-string FOI #
```

## Connectives

`je`, `ja`, `jo` and `ju` are JOI, so a joik covers what CLL's jek does. `ga'o` or `ke'i` can stand on either side of a joik. A gek is a word of GA, or `gi` with a joik or a tense or modal on either side of it. It can take `bo`.

```jbogenbau
%rule ek
  (* ek <- NA_clause? SE_clause? A_clause *)
  [NA #] [SE #] A #

%rule gihek
  (* gihek <- NA_clause? SE_clause? GIhA_clause *)
  [NA #] [SE #] GIhA #

%rule joik
  (* joik <- GAhO_clause? NA_clause? SE_clause? JOI_clause GAhO_clause? *)
  [GAhO #] [NA #] [SE #] JOI # [GAhO #]

%rule joik-ek
  (* joik_ek <- joik / ek *)
  joik | ek

%rule joik-gihek
  (* joik_gihek <- joik / gihek *)
  joik | gihek

%rule gek
  (* gek <- (SE_clause? GA_clause / GI_clause (joik / tag) / (joik / tag) GI_clause) BO_clause? *)
  ([SE #] GA # | GI # (joik | tag) | (joik | tag) GI #) [BO #]

%rule gik
  (* gik <- GI_clause *)
  GI #
```

## Tenses and modals

A tense or modal (the rule `tag`) is a run of `tcita-selci` joined by joiks. Each is a modal, a ROI word with an optional mekso before it, `fi'o` with a selbri, or one of these after `na'e` or `se`. The grammar reads a tense or modal whole. Where the words after a `tcita-selci` can begin another one, the grammar reads that one, not a joik. And a tense or modal in a term or before a selbri never leaves a `tcita-selci` after it.

```jbogenbau
%rule tag
  (* tag <- tcita_selci+ (joik tcita_selci+)* *)
  tcita-selci ... [tag-link] ...

%rule tag-link
  $j(joik) tcita-selcis
%conditions
  ¬begins(from($j), tcita-selci)

%rule tcita-selcis
  tcita-selci ...

%rule tcita-selci
  (* tcita_selci <- (NAhE_clause / SE_clause) tcita_selci / BAI_clause / mex? ROI_clause / FIhO_clause selbri FEhU_elidible *)
  | (NAhE # | SE #) tcita-selci
  | BAI #
  | ROI #
  | $m(mex) ROI #
  | FIhO # selbri [FEhU #]
%conditions
  $m ⟹ ¬matches($, nahe-se-tcita-selci)

%rule nahe-se-tcita-selci
  (NAhE # | SE #) tcita-selci
```

## Free modifiers

A free modifier is a `sei` clause over a statement, a vocative, a mekso with `mai`, or a `to` parenthesis. It can also be a subscript, a replacement quote, or an attitudinal with its own free modifiers after it. A vocative takes a selbri or a sumti.

A free modifier nests in the nearest slot that can take it. So no free modifier follows another one in the same slot. The condition on `free` states this. In `ui nai`, the `nai` is in the slot of `ui`. In `coi ui coi do`, `coi do` is in the slot of `ui`, which is in the slot of the first `coi`. In `xy boi xi by boi xi vo`, the second subscript is inside the first one.

The reference reads so because `post_clause <- free*` reads as far as it can, and an attitudinal or a vocative word has its own `post_clause`. This is deliberate. A comment of the reference, from camxes, says that UI words are eaten after a word. And in CLL, an indicator applies to the word before it, as in `ui nai`. The standard camxes keeps a run of vocatives or subscripts flat, but the dialect follows Zantufa.

The condition is on `free`, not on each slot. So it removes a free modifier that another free modifier follows at the same level. But it does not make each slot read as far as it can. This keeps a departure from Zantufa, in `mi klama pamai le zarci .e remai le zdani` (see "Differences from Zantufa 1.9999"). There the slot of `.e` stays empty, and `.e re` with `mai` is one free modifier after `zarci`.

A vocative takes a selbri or a sumti as its address, as in Zantufa. Zantufa merges cmevla and brivla, so a name is an ordinary tanru unit. The selbri of the address reads as far as it can, as Zantufa's does. So in `doi djan klama`, the address is the selbri `djan klama`, and the text has no bridi. To address someone by name before a bridi, a speaker ends the vocative with `do'u`, as in `doi djan do'u klama`.

The dialect keeps one odd reading of Zantufa. In `pe'usai doi xod ko jmina`, the vocative `doi xod` is in the slot of `sai`, and `sai` is in the slot of `pe'u`. The address of `doi` is the selbri `xod`, which ends before `ko`. Then `pe'u` takes `ko` as its own address, a sumti. So the bridi `jmina` has no first place, and `ko` is not the one who adds. Zantufa reads the text in the same way, and the dialect follows it.

```jbogenbau
%rule free
  (* free <- SEI_clause statement SEhU_elidible / vocative relative_clauses? selbri DOhU_elidible
           / vocative sumti? DOhU_elidible / mex_2 MAI_clause / TO_clause text TOI_elidible / xi_clause
           / LOhAI_clause / (UI_clause !BU_clause)+ *)
  | SEI # statement [SEhU #]
  | vocative [relative-clauses] selbri [DOhU #]
  | vocative [sumti] [DOhU #]
  | mex-2 MAI #
  | TO text [TOI #]
  | XI # mex-2
  | [LOhAI [lohai-word ...] [LOhAI [lohai-word ...]]] LEhAI #
  | UI #
%conditions
  ¬begins(after($), free)

%rule vocative
  (* vocative <- COI_clause+;  COI_post <- vocative_post_clause *)
  (COI vocative-post) ...

%rule number-post
  (* number_post_clause <- spaces? !BU_clause (!number free)* *)
  [free-not-number ...]

%rule lohai-word
  ~word∩(LOhAI ∪ LEhAI)=∅

%rule free-not-number
  $f(free)
%conditions
  ¬begins(from($f), number)

%rule lerfu-post
  (* lerfu_post_clause <- spaces? !BU_clause (!lerfu_string free)* *)
  [free-not-lerfu ...]

%rule free-not-lerfu
  $f(free)
%conditions
  ¬begins(from($f), lerfu-string)

%rule vocative-post
  (* vocative_post_clause <- spaces? !BU_clause (!vocative free)* *)
  [free-not-vocative ...]

%rule free-not-vocative
  $f(free)
%conditions
  ¬begins(from($f), vocative)
```

## Differences from Zantufa 1.9999

The dialect reads some texts differently from Zantufa 1.9999. The policy of the dialect page accounts for most of them:

- A PEG commits to the first alternative that matches, and a repetition reads as far as it can. So Zantufa rejects some texts that its rules allow, and the dialect accepts them. In `are`, Zantufa reads `a` as a whole fragment, and `re` is left over. In `le vi'ofagri`, the vocative after `le` takes `fagri`, and the description has no selbri. In `la poi ke'a barda .djan.`, the relative clause takes the name. Each of these parses here.
- Where a PEG's greed gives a reading that the ranking of this stage does not choose, the dialect keeps its own reading. The ranking is the order of preference of the stage among parses. In `mi klama pamai le zarci .e remai le zdani`, Zantufa's `.e` takes `re mai` as its own free modifier. Here the free modifier is the mekso `.e re` with `mai`, after `zarci`. In `mi me my su'i ny me'u`, Zantufa reads one mekso, `my su'i ny`, after `me`. Here `me` takes a sumti, `ny` with the quantifier `my su'i`.
- A lookahead here sees the words that the syntax reads, after erasure and without `ba'e`. Zantufa erases and reads `ba'e` inside its grammar, so its lookaheads see those words. So Zantufa accepts `li pa je ba'e cu broda`, `li pa je brode si cu broda` and `ba'e ke broda ke'e ke'e be mi`, and the dialect rejects them. And Zantufa reads `ke mi ba'e ke'e` as a group of terms, and the dialect as a grouped sumti.
- A nested text takes its own leading free modifiers: those after a word of LU, LUhEI or TO. Zantufa's `LU_clause`, `LUhEI_clause` and `TO_clause` take them as the free modifiers of the opener, before the text begins. The dialect follows the principle of every dialect's indicator stage, that a text begins with its own indicators. It applies that principle to every free modifier, so that one boundary separates the opener from its text. So `lu ui li'u` quotes the text `ui`, and a vocative at the start of a quote belongs to the quote.
- The word stage reads a stray `si` or `bu` at the start of a text as the Magic Words proposal does. So `si mi` is `mi`, and `bu si` is nothing. Zantufa rejects both, because its `si` and `bu` need a word before them there.
- `su` erases the whole text before it. Zantufa scans for `su` from the start of each text. The scan passes a letter word, or a `su`, together with the free modifiers after it. A parenthesis among those free modifiers, or a quote inside one, holds a text with its own start. A `su` inside that text erases only back to that start.

  So Zantufa reads `mi bu to mi su do toi broda` and `su to mi su do toi broda` with the inner `su` erasing only `mi`. Here it erases back to the start of the whole text, and the `toi` is left without its `to`.
- The forms stage reads the rafsi or gismu form after `ra'oi` before the word stage knows whether that `ra'oi` opens a quote. So where `ra'oi` is itself quoted or is a `zoi` delimiter, the forms stage still divides the letters after it. It divides them as the form of a `ra'oi` quote. There Zantufa reads them as ordinary words, and the dialect rejects the text: `zo ra'oi broda`, `go'oi ra'oi broda`, `lo'u ra'oi broda le'u`, `lo'ai ra'oi broda le'ai` and `zoi ra'oi x ra'oi broda`. A `zoi` body, a closing `zoi` delimiter and the text after `fa'o` take the form as it is. So `zoi gy ra'oi broda gy`, `zoi broda ra'oi broda` and `fa'o ra'oi broda` read as in Zantufa.
- Here, `su` cannot erase a quote word that opens no quote. So the dialect rejects `zoi su mi` and `mi lo'ai su klama`. Zantufa's `su` passes such a word with its `any_word` fallback, and accepts both.
- `ba'e` is not a magic word, as the Magic Words proposal says. The word stage first removes `fa'o` and what follows it. So `mi ba'e fa'o` leaves a `ba'e` with nothing to mark. The proposal calls this an error. Zantufa reads `ba'e` inside its grammar, and accepts the text.
- The phoneme stage accepts commas and the other conventions of `phonemes/latin.md`. Zantufa reads only two of them: `h` as the apostrophe, and `?` and `!` as pauses. It rejects commas, digits, accents and other punctuation. The stage ignores a comma, so a comma is not the syllable break of CLL 3.3 here.
