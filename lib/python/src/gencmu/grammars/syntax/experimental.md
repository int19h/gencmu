# The experimental grammar

This document is a layer over [the CLL grammar](cll.md), the grammar printed in chapter 21 of *The Complete Lojban Language*. A layer is a document that changes earlier rules. A dialect is a pipeline of stages, defined by one pipeline document. The [experimental](../dialects/experimental.md) dialect stitches this layer after that grammar, that is, combines their rules into one grammar.

The layer adds the experimental constructs that grew up in use after CLL was printed. The grammar always accepts some of them, and a feature (a named switch that the grammars test) guards others. Their reference is camxes-exp, the experimental PEG (parsing expression grammar).

The layer restates each CLL rule that it changes with `%redefine-rule`. It states its own rules with `%rule`. Each section below says what the layer changes in that part of the grammar. A rule that this document does not name is the CLL grammar's, as that document explains it.

The prose uses these Lojban terms, as [the CLL grammar](cll.md) does:

- A cmavo is a particle, a short structure word.
- A selma'o is a word class of cmavo.
- A brivla is a predicate word.
- A cmevla is a name word.
- A selbri is the predicate of a sentence.
- A sumti is an argument of a selbri.
- A tanru is a compound selbri.
- A bridi-tail is a selbri with any terms after it.
- A lerfu word is a letter word, such as `.abu` or `xy.`.
- A mekso is a mathematical expression.

[The experimental lexicon](../words/lexicon-experimental.md) gives each cmavo the one selma'o that camxes-exp gives it. For example, `mi'ai` is KOhA, `la` is LE, `fi'oi` is SOI, `ma'oi` is ZO and `la'oi` is ZOhOI. `no'oi` and `po'oi` are NOhOI, with the terminator `ku'oi`. Some selma'o are not in CLL: `LOhOI`, `NOhOI`, `KUhOI`, `KUhAU`, `LOhAI`, `LEhAI`, `ZOhOI` and `MEhOI`. This grammar never reads a CLL class that camxes-exp does not have, such as LA.

[The notation document](../../docs/notation.md) explains the notation. The terminals of this grammar (the symbols that each match one input token) are selma'o. A tag marks a token by name, phoneme or character. The rules `any-word` and `anything` match tokens tagged `word` and `quoted-text`, respectively.

A stage is one step of a pipeline, with its own grammar. The pipeline is the sequence of stages that reads a text. The word stage, an earlier stage, puts these two tags on the material of a quote.

The layer uses two feature guards, which make a part of a rule depend on a feature. `cbm` is the cmevla-brivla merger. `soi-clause` makes `soi` a term that takes a subsentence, where CLL has a free modifier of reciprocity. The experimental dialect turns both on, because camxes-exp has no way to turn them off. A caller can turn either off.

Unlike the CLL grammar, this layer writes the free-modifier slot after an elidable terminator outside its brackets: `[+X] #` where CLL has `[+X #]`. So free modifiers can follow an elided terminator. The layer restates many rules below for that reason alone. `free-after-number` and `free-after-lerfu-string` keep a number or lerfu string maximal. After an elided `boi`, they exclude a first free modifier that starts with a word that the number or string can read.

Two directives set up the layer. `%ambiguity-resolution late-elision` says how the stage chooses among parses. It compares only where two parses elide terminators. At the first place where they differ, it takes the parse that reads on, so a terminator is elided as late as the grammar allows. Two parses that elide the same terminators at the same places are tied, and a tie is an error.

So `to mi klama` holds `mi klama` in its parenthesis, because the other reading elides `vau` and `toi` after `mi`. In the same way, `lu mi klama` holds `mi klama` in its quote. camxes-exp reads both texts in this way.

The layer does not declare `elision-only`, the option that applies CLL's rule that a terminator can be elided only where no ambiguity results. The layer has real ambiguities that are not about terminators. A parser of camxes-exp settles them by the order of its alternatives. This layer settles them with rules of its own:

- In a tanru and between operators, a `ke` directly after a joik opens the connective's own `ke` group ("Selbri and tanru", "Numbers, lerfu strings and mekso").
- A connection that can be a sumti connection is one ("Terms").
- A `be` group attaches to the tanru unit before it ("Selbri and tanru").
- A subscript after a subscript nests. Any other free modifier after a subscript belongs to the word that the subscript marks ("Free modifiers, vocatives and indicators").

The experimental terminators `ku'au` and `ku'oi` are elidable, as CLL's are: the rules below write them `[+KUhAU]` and `[+KUhOI]`.

```jbogenbau
%ambiguity-resolution late-elision
```

## The text and its paragraphs

The layer changes the text in five ways. A `nai` at the start of a text is an indicator, as the indicator stage of the experimental dialect reads it. So `indicators` takes it, like the indicators of camxes-exp. A separate `nai` stands only before a run of names.

The second change is that the connective after a text-leading `.i` can be an ek, as in `.i .e do klama`. camxes-exp allows it because its joik takes the words of A. The rule writes the tense before `bo` in a text-leading `.i` as a `tag`. A `stag` is a `tag` in this dialect (see "Tenses and modals"), so the name changes nothing.

The third change is that an ek, a jek or a joik directly after `.i` is always a connective. So `i.e`, `.iji` and `mi klama .i e` read `.i e` or `.i ji` as a connective. Without this rule, these texts tie, because a bare ek is a fragment. The rule `lone-i` is an `.i` that no ek, jek or joik follows directly. It stands in the bare-`.i` positions of `text-1` and `paragraph`, before a statement, a fragment or nothing.

These three are the families that `lone-i` tests. A VUhU can also follow `.i` as a connective, as in `mi klama .i su'i do klama`. It needs no test, because no statement or fragment begins with it. A gihek answer after `.i` stays a fragment, as in `.i gi'e` and `mi klama .i gi'e`. No `.i` connective is a gihek, so these texts cause no tie. CLL and camxes-exp read them in the same way.

A bare connective answer stands without `.i`, as `e` or `je` alone. That is CLL's own rule for a jek. A bare jek answers `je'i`, and CLL reads it only in the connective slot before `text-1`. So in CLL, `.ije` is always the connective, and never `.i` before an answer. The layer treats `.i e` as CLL treats `.ije`, and so it matches camxes-exp.

Here the layer follows camxes-exp and departs from CLL. CLL's `.i` connective cannot be an ek, so CLL reads `.i e` as `.i` and the fragment `e`. CLL also accepts `mi .i e` and `mi .i e .i do klama`. The layer rejects both, because its `.i e` must follow a statement, and `mi` alone is a fragment. `.i e .i mi klama`, `.i e .i e mi klama` and `.i e .ije mi klama` are texts with connectives, as in camxes-exp.

A free modifier can stand between `.i` and an ek. Then the ek can still be a fragment, as in `mi klama .i sei broda se'u e`. CLL forbids a bare forethought answer (CLL 14.13, after Example 14.105). So `ge'i` and `gu'i` have no bare answer in either grammar. A forethought connective can start with an ek, a jek or a joik, as in `je gi mi gi do`. So the layer rejects `.i e gi mi gi do` and `mi klama .i je gi mi gi do`, as camxes-exp does.

The fourth change is about runs of `ni'o`. First, `.i ni'o` can follow a `ni'o`, as usage writes a new topic inside a reply. At the start of a text, the CLL grammar's `text-1` already reads `.i ni'o`, as the repair of the printed grammar that it lists says. So `text-1` takes the form after a first run of `ni'o`, and `paragraphs` takes it after a later one. Second, a run of `ni'o` can end the text (`mi klama ni'o`), as in camxes-exp.

The fifth change is that the layer keeps CLL's run of names at the start of a text only with `cbm` off. Under `cbm`, a cmevla is a selbri word, so the dialect rejects `.djan. mi klama`. camxes-exp has no such form.

The layer keeps the CLL grammar's connective before the first `.i` of a text (`je mi klama`). camxes-exp has it too. But its `paragraphs` can be empty, so its `(!text_1 joik_jek)?` never matches, and it rejects such a text. That is an accident of the PEG, and gencmu reads the text as CLL does.

```jbogenbau
%redefine-rule text
  | ¬cbm? [{NAI}] {CMEVLA} # [joik-jek] text-1
  | [indicators & {free}] [joik-jek] text-1

%redefine-rule indicators
  {[FUhE] indicator}

%redefine-rule indicator
  UI | CAI | NAI | Y | DAhO | FUhO

%redefine-rule text-1
  [{(I (jek | joik | ek) | lone-i) [[tag] BO] #}] [{NIhO} # [I # {NIhO} #]] [paragraphs]

%redefine-rule paragraphs
  paragraph [{NIhO} # [paragraphs | I # {NIhO} # [paragraphs]]]

%redefine-rule paragraph
  (statement | fragment) [{lone-i # [statement | fragment]}]

%rule lone-i
  (* I_clause !jek !joik !joik_jek in camxes-exp's paragraph, whose joik includes A *)
  $i(I)
%conditions
  ¬begins(after($i), ek),
  ¬begins(after($i), jek),
  ¬begins(after($i), joik)
```

## Statements and fragments

The connective after `.i` can be an ek or a VUhU as well as a joik or jek. A statement connective can also precede `.i`, as in `mi klama joi .i do klama`. Both are `statement-connective`. Before `bo` after `.i`, the connective can also be an ek, and the tense is a `stag`, which is a `tag` here, as in camxes-exp. A connective with an optional stag and `bo` can also precede `.i` inside a sentence, with a subsentence after it, as camxes-exp's sentence allows: `mi klama .e pu bo .i do klama`. A prenex can have no terms (`zo'u mi klama`). `statement-1` keeps the left recursion of the CLL rule, with both forms of connection, so its connections group from the left as in CLL (CLL 14.7).

The layer removes CLL's `na` fragment. A bare `na` is a term (see "Terms"), so `na` and `na na` are terms fragments. Only in this way do the two readings not compete.

```jbogenbau
%redefine-rule statement-1
  | statement-2
  | statement-1 I statement-connective [statement-2]
  | statement-1 statement-connective I # [statement-2]

%redefine-rule statement-2
  statement-3 [I [joik | jek | ek] [stag] BO # [statement-2]]

%redefine-rule statement-3
  sentence | [tag] TUhE # text-1 [+TUhU] #

%rule statement-connective
  joik # | jek # | ek # | VUhU #

%redefine-rule fragment
  ek # | gihek # | quantifier | terms [+VAU] # | prenex | relative-clauses | links | linkargs

%redefine-rule prenex
  [terms] ZOhU #
```

## Sentences and bridi-tails

A bridi-tail can have terms before its selbri, as in camxes-exp. camxes-exp names this part of its grammar JACU, after a proposal for a simpler system of connectives. The terms and `cu` before a selbri are a `bridi-tail-head`. In a head, runs of terms and single `cu` words alternate: `mi cu do klama`, `cu mi klama`. A head can stand before the first bridi-tail of a sentence, and after each connective between bridi-tails. Examples are `mi klama je do tavla` and `mi klama gi'e cu do tavla`.

A term in a head is a term of a list. There a tense or modal, or a bare `na`, is not a term where a selbri follows it ("Terms" below). So `mi pu klama` has the tense `pu` on its selbri, and so does `mi pu sei do klama se'u klama`. And `mi na klama` negates its selbri.

The afterthought connective between bridi-tails can be a gihek, joik, jek, ek or VUhU (`bridi-tail-connective`). Each of them can also open a `bo` or `ke` grouping of bridi-tails. So can a bare `gi` with a stag, as in `mi klama gi ba bo tavla`.

Connected bridi-tails group from the left, as in CLL (CLL 14.10), and `bridi-tail-1` keeps the CLL rule's left recursion. After a plain connective, a bridi-tail without a head does not begin with `ke`. And a head there is not a bare stag, such as a tense whose `ku` is elided. Without these limits, `gi'e ke` and `gi'e ba ke` can each open two constructs. camxes-exp states the same limits as a lookahead (a test of the words that follow) after its gihek.

```jbogenbau
%redefine-rule sentence
  (* sentence <- terms? bridi_tail_t1 ... (joik_jek (stag? BO_clause)? I_clause free* subsentence)* *)
  headed-bridi-tail [sentence-link]

%rule sentence-link
  statement-connective [stag] BO I # subsentence

%rule bridi-tail-head
  | {terms \ CU #} [CU #]
  | CU # [{terms \ CU #} [CU #]]

%rule headed-bridi-tail
  [bridi-tail-head] bridi-tail

%rule headed-bridi-tail-2
  [bridi-tail-head] bridi-tail-2

%redefine-rule bridi-tail
  bridi-tail-1 [(bridi-tail-connective [stag] | GI stag) KE # headed-bridi-tail [+KEhE] # tail-terms]

%redefine-rule bridi-tail-1
  bridi-tail-2 | bridi-tail-1 bridi-tail-connective connected-bridi-tail tail-terms

%rule connected-bridi-tail
  | $h(bridi-tail-head) bridi-tail-2
  | bridi-tail-2-not-starting-with-ke
%conditions
  ¬matches($h, stag)

%redefine-rule bridi-tail-2
  bridi-tail-3 [(bridi-tail-connective [stag] | GI stag) BO # headed-bridi-tail-2 tail-terms]

%rule bridi-tail-2-not-starting-with-ke
  bridi-tail-3-not-starting-with-ke [(bridi-tail-connective [stag] | GI stag) BO # headed-bridi-tail-2 tail-terms]

%rule bridi-tail-3-not-starting-with-ke
  selbri-not-starting-with-ke tail-terms | gek-sentence

%redefine-rule gek-sentence
  gek subsentence gik subsentence tail-terms | [tag] KE # gek-sentence [+KEhE] # | NA # gek-sentence

%rule bridi-tail-connective
  gihek # | selbri-connective

%rule selbri-connective
  joik # | jek # | ek # | VUhU #

%redefine-rule tail-terms
  [terms] [+VAU] #
```

## Terms

The layer joins terms at two levels, as camxes-exp's `term_1` and `term_2` join them. A connective, an optional stag and `bo` join terms of any kind into a group, `term-bo-group`, and a plain connective joins such groups (`term-link`). So `bo` binds tighter than a plain connective: `broda be na ku .e bo na ku .a na ku` is `(na ku .e bo na ku) .a na ku`. The connectives are a joik, jek, ek or VUhU (`term-connective`), so `mi joi do klama` has one term before its selbri. camxes-exp's joik takes the words of JOI, JA and A, and so these four sets are its `joik_ek` and `joik_jek`.

camxes-exp reads a term in one of two ways, and so does this layer. A term in a list of terms (`listed-term`) stands in a sentence's head or tail terms, a prenex, a fragment or a `nu'i` termset. A tense or modal there is not a term where a selbri or a gek-sentence follows it and its free modifiers (camxes-exp's `abs_tag_term`). A bare `na` there is not a term where a selbri, a gek-sentence or a connective begins at it. A term in a place that takes one term (`term`) follows `be`, `bei`, GOI, LAhE or NAhE.

A term in a branch of a bare forethought termset (`gek-terms`) is such a term too. Neither has a `!selbri` or `!gek_sentence` lookahead, as camxes-exp's `tag_term` has none. So `mi pe na klama` has a bare `na` after `pe`.

camxes-exp's two lookaheads apply after a plain connective. The next group does not begin with a stag and `bo` or `ke` before a selbri. Nor does it begin with a stag, `bo` and `.i`. So those forms stay connections of bridi-tails and of sentences.

camxes-exp requires the stag before `bo` in a sentence's own terms (`abs_term_2`), and this grammar does not. So `fa mi .e bo fe do klama` parses here, as it did before this layer took the two levels, and camxes-exp rejects it.

A connection that can be a sumti connection is one. Terms are connected only where the parts on the two sides of the connective cannot form one sumti. So `mi .e do klama` and `mi .e bo do klama` join two sumti. In `mi cadzu ca la pacac. bi'o la recac.`, the modal `ca` applies to one connected sumti. But `mi .e ca do klama` joins two terms, because `ca do` is a modal term and not a sumti.

Without this rule, each of the first three texts has two readings, which elide the same terminators. camxes-exp reads the sumti, because it tries a sumti first and reads it as far as it can. So the layer agrees with camxes-exp here.

The rules `term` and `term-bo-group`, and their forms in a list of terms, state the rule. Each is left-recursive, so that its condition sees the part before a connective and the link after it. The condition refuses a link where the part before ends with a sumti that the connective can extend, and the link begins with a sumti. So the tree of three or more connected terms nests to the left, as they group.

Tags carry what the condition needs, so that it never parses the part before again. A tag `~link-extensible-end` says that a part ends with a sumti that a plain connective can extend. `~bo-extensible-end` says the same for a connective with `bo`. `~sumti-start` says that a link begins with a sumti. A tense or modal before the sumti keeps these tags. Each of these rules passes them up from its first or its last part.

`sumti-2` has both end tags, since a connective can always extend it. A `ke` group with a written `ke'e` has none, so `mi .e ke do ke'e .e ko'a klama` joins two terms. After `vu'o`, a plain connective can extend the sumti, but a connective with `bo` cannot. `$EXTENSIBLE-END` holds the two end tags.

A termset closed by a written `nu'u` is never a sumti for this rule, and a link that begins with one has no `~sumti-start`. So `mi .e ge do gi ti nu'u klama` joins two terms, the second a termset. Without `nu'u`, `mi .e ge do gi ti klama` joins two sumti, since the termset reading elides `nu'u`.

`pe'e` takes any statement connective. `terms-1` and its forethought form `gek-terms-1` are left chains, as CLL's `terms-1` is. The new terms are a bare `na`, and, under `soi-clause`, `soi subsentence se'u` as camxes-exp reads it. `fi'oi` and `xoi` are members of SOI.

A forethought termset needs no `nu'i`, and its two branches can hold different numbers of terms, as in CLL. So the same words can often be read as a gek sumti or as a termset, and camxes-exp reads the sumti first.

The ranking does the same. The first branch of a termset, `termset-branch`, ends in `nu'u`, which the termset elides before `gi`. The sumti elides nothing there, so `late-elision` prefers it. So `ge mi gi do ce'e ti` is the sumti `ge mi gi do` followed by `ce'e ti`. But `broda be ge mi gi do ce'e ti be'o` has a termset, because the single argument of `be` cannot continue with `ce'e ti`.

The layer reads a termset with `nu'i` as `nu'i` with a forethought form wherever it can, as camxes-exp tries that form first. So `nu'i ge mi gi do nu'u` is a termset of two branches, and not `nu'i` around the sumti `ge mi gi do`. The first term inside `nu'i ... nu'u` cannot itself be a bare forethought termset. A bare forethought termset there repeats the `nu'i gek` form. The `-not-starting-with-bare-gek` rules state that restriction: they repeat the term rules with only the first term restricted. A chain repeats one item, so it cannot restrict only its first item. These rules write the restricted first item apart. `terms-1-not-starting-with-bare-gek` is left recursion, which groups as the chain `terms-1` does. The other two are a first item and an optional list, flat as `terms` and `terms-2` are.

```jbogenbau
%redefine-rule terms-1
  {... terms-2 \ PEhE # statement-connective}

%redefine-rule terms-2
  (* terms_2 <- abs_term (cehe_sa* CEhE_clause free* abs_term)* *)
  {listed-term \ CEhE #}

%redefine-rule term
  (* term_1 <- term_2 (joik_ek !tag_bo_ke_bridi_tail !tag_bo_subsentence term_2)* *)
  | term-bo-group
  | $t(term) $l(term-link) <tags($l) ∩ $EXTENSIBLE-END>
%conditions
  ~link-extensible-end ⊈ tags($t) ∨ ~sumti-start ⊈ tags($l)

%rule term-bo-group
  (* term_2 <- term_3 (joik_ek stag? BO_clause term_3)* *)
  | term-3
  | $g(term-bo-group) $l(term-bo-link) <(tags($g) ∩ ~sumti-start) ∪ (tags($l) ∩ $EXTENSIBLE-END)>
%conditions
  ~bo-extensible-end ⊈ tags($g) ∨ ~sumti-start ⊈ tags($l)

%rule term-bo-link
  term-connective [stag] BO # $u(term-3)
%tags
  tags($u) ∩ ($EXTENSIBLE-END ∪ ~sumti-start)

%rule term-link
  $c(term-connective) $g(term-bo-group)
%tags
  tags($g) ∩ ($EXTENSIBLE-END ∪ ~sumti-start)
%conditions
  ¬begins(after($c), tag-bo-ke-bridi-tail),
  ¬begins(after($c), tag-bo-subsentence)

%rule tag-bo-ke-bridi-tail
  (* tag_bo_ke_bridi_tail <- stag (BO_clause / KE_clause) CU_elidible free* (selbri / gek_sentence) *)
  stag (BO | KE) [CU] # (selbri | gek-sentence)

%rule tag-bo-subsentence
  (* tag_bo_subsentence <- stag BO_clause I_clause *)
  stag BO I

%rule term-connective
  joik # | jek # | ek # | VUhU #

%const $EXTENSIBLE-END ~link-extensible-end ∪ ~bo-extensible-end


%rule term-3
  (* term_3 <- sumti / tag_term / termset *)
  | $s(sumti) <tags($s) ∪ ~sumti-start>
  | tagged-term
  | termset
  | NA # KU #
  | bare-na
  | soi-clause? soi-term

%rule bare-na
  (* !gek !ek !joik_jek !gihek NA_clause free* KU_elidible free* *)
  $n(NA) #
%conditions
  ¬begins(from($n), na-connective)

%rule na-connective
  gek | ek | jek | joik | gihek

%rule soi-term
  SOI # subsentence [+SEhU] #

%rule tagged-term
  (* tag_term: !gek tag free* followed by a sumti or KU_elidible free* *)
  | $g(tag) $s(sumti) <tags($s) ∩ $EXTENSIBLE-END>
  | $g(tag) [+KU] #
%conditions
  ¬begins(from($g), gek)

%rule listed-term
  (* abs_term_1 <- abs_term_2 (joik_ek !tag_bo_ke_bridi_tail !tag_bo_subsentence abs_term_2)* *)
  | listed-term-bo-group
  | $t(listed-term) $l(listed-term-link) <tags($l) ∩ $EXTENSIBLE-END>
%conditions
  ~link-extensible-end ⊈ tags($t) ∨ ~sumti-start ⊈ tags($l)

%rule listed-term-bo-group
  (* abs_term_2 <- abs_term_3 (joik_ek stag BO_clause abs_term_3)*, with the stag optional *)
  | listed-term-3
  | $g(listed-term-bo-group) $l(listed-term-bo-link) <(tags($g) ∩ ~sumti-start) ∪ (tags($l) ∩ $EXTENSIBLE-END)>
%conditions
  ~bo-extensible-end ⊈ tags($g) ∨ ~sumti-start ⊈ tags($l)

%rule listed-term-bo-link
  term-connective [stag] BO # $u(listed-term-3)
%tags
  tags($u) ∩ ($EXTENSIBLE-END ∪ ~sumti-start)

%rule listed-term-link
  $c(term-connective) $g(listed-term-bo-group)
%tags
  tags($g) ∩ ($EXTENSIBLE-END ∪ ~sumti-start)
%conditions
  ¬begins(after($c), tag-bo-ke-bridi-tail),
  ¬begins(after($c), tag-bo-subsentence)

%rule listed-term-3
  (* abs_term_3 <- sumti / abs_tag_term / termset *)
  | $s(sumti) <tags($s) ∪ ~sumti-start>
  | listed-tagged-term
  | termset
  | NA # KU #
  | listed-bare-na
  | soi-clause? soi-term

%rule listed-tagged-term
  (* abs_tag_term: !gek tag free* !selbri !gek_sentence, then a sumti or an elided KU *)
  | $g(tag) $s(sumti) <tags($s) ∩ $EXTENSIBLE-END>
  | $g(tag) [+KU] #
%conditions
  ¬begins(from($g), gek),
  ¬begins(after($g), selbri-after-tag)

%rule selbri-after-tag
  # (selbri | gek-sentence)

%rule listed-bare-na
  (* !selbri !gek_sentence !ek !joik_jek !gihek NA_clause free* KU_elidible free* *)
  $n(NA) #
%conditions
  ¬begins(from($n), listed-na-follower)

%rule listed-na-follower
  selbri | gek-sentence | ek | jek | joik | gihek

%redefine-rule termset
  (* termset <- gek_termset / NUhI_clause free* gek terms NUhU_elidible free* gik terms NUhU_elidible free* / NUhI_clause free* terms NUhU_elidible free* *)
  | gek termset-branch gik gek-terms [+NUhU] #
  | NUhI # gek terms [+NUhU] # gik terms [+NUhU] #
  | NUhI # $t(terms-not-starting-with-bare-gek) [+NUhU] #
%conditions
  ¬matches($t, gek-termset-body)

%rule gek-termset-body
  (* NUhI_clause free* gek terms NUhU_elidible free* gik terms: tried before NUhI_clause free* terms *)
  gek terms [+NUhU] # gik terms

%rule termset-branch
  gek-terms [+NUhU] #

%rule gek-terms
  {gek-terms-1}

%rule gek-terms-1
  {... gek-terms-2 \ PEhE # statement-connective}

%rule gek-terms-2
  {term \ CEhE #}

%rule terms-not-starting-with-bare-gek
  terms-1-not-starting-with-bare-gek [{terms-1}]

%rule terms-1-not-starting-with-bare-gek
  | terms-2-not-starting-with-bare-gek
  | terms-1-not-starting-with-bare-gek PEhE # statement-connective terms-2

%rule terms-2-not-starting-with-bare-gek
  listed-term-not-starting-with-bare-gek [{CEhE # listed-term}]

%rule listed-term-not-starting-with-bare-gek
  | listed-term-bo-group-not-starting-with-bare-gek
  | $t(listed-term-not-starting-with-bare-gek) $l(listed-term-link) <tags($l) ∩ $EXTENSIBLE-END>
%conditions
  ~link-extensible-end ⊈ tags($t) ∨ ~sumti-start ⊈ tags($l)

%rule listed-term-bo-group-not-starting-with-bare-gek
  | listed-term-3-not-starting-with-bare-gek
  | $g(listed-term-bo-group-not-starting-with-bare-gek) $l(listed-term-bo-link) <(tags($g) ∩ ~sumti-start) ∪ (tags($l) ∩ $EXTENSIBLE-END)>
%conditions
  ~bo-extensible-end ⊈ tags($g) ∨ ~sumti-start ⊈ tags($l)

%rule listed-term-3-not-starting-with-bare-gek
  | $s(sumti) <tags($s) ∪ ~sumti-start>
  | listed-tagged-term
  | termset-with-nuhi
  | NA # KU #
  | listed-bare-na
  | soi-clause? soi-term

%rule termset-with-nuhi
  | NUhI # gek terms [+NUhU] # gik terms [+NUhU] #
  | NUhI # $t(terms-not-starting-with-bare-gek) [+NUhU] #
%conditions
  ¬matches($t, gek-termset-body)
```

## Sumti

Sumti connectives are ek, joik, jek or VUhU (`sumti-connective`). This change and the new mekso below leave the CLL rule `joik-ek` unused. After `vu'o`, a connected sumti can follow the relative clauses or replace them, and `vu'o` can also end the sumti (`mi vu'o`). Under `cbm` a cmevla is a selbri word, so the layer removes the `la CMEVLA` name form, and `la .alis.` is a description. That form begins with `la`, `lai` or `la'i`, which are words of LE here, and `name-marker` names them by their sound. The new sumti are these:

- `na'e sumti lu'u`, without `bo`
- `la'e` or `na'e bo` around a term that is not a sumti, such as `na ku` or a tense or modal with its sumti or `ku`
- `na'e` around a term that is neither a sumti nor a tense or modal with its sumti or `ku`, such as `na ku`
- `lo'oi subsentence ku'au`, a description of a subsentence
- The single-word quotes `zo'oi`, `la'oi` and `ra'oi`, whose bodies the word stage delimits

A `na'e` alone does not take a whole term that is a tense or modal with its sumti or its `ku`, written or elided. This is because `na'e pu` then matches the rule `tag`. A connected term can still begin with such a term, as in `na'e pu ku .e na ku lu'u`. The inner sumti of a description can be any sumti, a connected one too (`lo mi .e do broda`). It does not begin with a quantifier. camxes-exp reads a quantifier there as the CLL form `quantifier sumti` first, so `lo re mi broda` is `lo re mi` and the selbri `broda`.

`quantifier-head` lists the selma'o that can begin a quantifier. A quantifier can also begin with a forethought connective, as in `lo ge pa gi re mi broda`. `quantified-sumti` excludes such an inner sumti as a whole.

A description can take a forethought sentence in place of a selbri, and so can a quantifier without a descriptor. Examples are `le ga mi klama gi do klama ku` and `re ga mi klama gi do klama ku`. These are camxes-exp's `sumti_tail` and `sumti_5`.

```jbogenbau
%redefine-rule sumti
  | sumti-1
  | sumti-1 VUhO # [relative-clauses] <~link-extensible-end>
  | sumti-1 VUhO # [relative-clauses] sumti-connective $i(sumti) <tags($i) ∩ $EXTENSIBLE-END>

%redefine-rule sumti-1
  | sumti-2
  | sumti-2 sumti-connective [stag] KE # $i(sumti) [+KEhE] # <KEhE ⊈ tags(head(after($i))) ⟹ tags($i) ∩ $EXTENSIBLE-END>

%redefine-rule sumti-2
  {... sumti-3 \ sumti-connective}
%tags
  $EXTENSIBLE-END

%redefine-rule sumti-3
  {sumti-4 ... \ sumti-connective [stag] BO #}

%rule sumti-connective
  ek # | joik # | jek # | VUhU #

%redefine-rule sumti-5
  [quantifier] sumti-6 [relative-clauses] | quantifier (selbri | gek-sentence) [+KU] # [relative-clauses]

%redefine-rule sumti-6
  | (LAhE # | NAhE BO # | NAhE #) [relative-clauses] sumti [+LUhU] #
  | (LAhE # | NAhE BO #) $t(term) [+LUhU] #
  | NAhE # $u(term) [+LUhU] #
  | KOhA #
  | lerfu-string free-after-lerfu-string
  | ¬cbm? name-marker # [relative-clauses] {CMEVLA} #
  | LE # sumti-tail [+KU] #
  | LOhOI # subsentence [+KUhAU] #
  | LI # mex [+LOhO] #
  | ZO any-word #
  | LU text [+LIhU] #
  | LOhU [{any-word}] LEhU #
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
  ¬matches(head($s), quantifier-head),
  ¬matches($s, quantified-sumti)

%rule quantified-sumti
  quantifier sumti-6 [relative-clauses]

%rule quantifier-head
  PA | VEI | NIhE | MOhE | PEhO | FUhA
```

## Relative clauses

Consecutive relative clauses can be joined by a joik, a jek or an ek, as well as by `zi'e`. Two groups of them can be connected in forethought (`ge poi broda gi poi brode`).

```jbogenbau
%redefine-rule relative-clauses
  | {relative-clause \ ZIhE # | joik # | jek # | ek #}
  | gek relative-clauses gik relative-clauses

%redefine-rule relative-clause
  GOI # term [+GEhU] # | NOI # subsentence [+KUhO] #
```

## Selbri and tanru

Selbri and tanru-unit connectives are joik, jek, ek or VUhU (`selbri-connective`). A bare `fa`, which matches the rule `tag`, can come before a selbri. The term after `be` or `bei` can be absent. The new tanru units are a cmevla, under `cbm`, and preposed linked arguments (`lo be mi broda`). `me'oi` with the word that it quotes is a tanru unit too (`le me'oi klama cu broda`).

`selbri-4` keeps the left recursion of the CLL rule, and `selbri-5` is a right chain, as in CLL. In the plain form of `selbri-4`, the connective is `plain-selbri-connective`, the CLL rule `plain-joik-jek` with this layer's connectives. As in CLL, a joik directly before `ke` is `joik-before-ke`, and its unit cannot be only a `ke` group. So `mi broda joi ke brode ke'e` joins a `ke` group with `joi`, through `joik [stag] KE`, as the CLL grammar does. camxes-exp departs here. It tries the plain connective first, and reads `joi` before a tanru unit that begins with `ke`. In this text, both readings group the same words.

Where only the plain reading parses, the layer keeps it, as camxes-exp does. So `mi broda joi ke brode ke'e bo brodi` joins `broda` to the unit `ke brode ke'e bo brodi`. The official parser of CLL rejects that text. The test reads the tag `~ke-group` of the parsed unit, as in the CLL grammar. This layer's `ke` alternatives of `tanru-unit-2` and `operator-2` carry it. So that the tag reaches `selbri-5`, this layer's `tanru-unit` writes its optional parts as alternatives, which read the same words in the same way. `selbri-5` is a right chain, and its level of one item keeps the tags of its `selbri-6`.

A group of preposed linked arguments comes before a whole `tanru-unit-1`, as in camxes-exp. A `be` group attaches to the tanru unit before it, where there is one. So a unit without a group of its own cannot be directly followed by `be` (`tanru-unit-1`). A preposed group stands only where no such unit comes before it, as at the start of a selbri or after a connective.

So `zdani be mi vorme` gives `be mi` to `zdani`, and `le tutci be sigdanva le marna` gives an empty `be` group to `tutci`. Without the rule, each text has two readings, which elide the same terminators. camxes-exp gives the group to the unit before it too, and so does camxes-std.

In `be mi klama be do be ti`, `be do` belongs to `klama`, and `be ti` to the whole unit. In `be mi klama be do`, `be do` belongs to `klama`, as in camxes-exp. The whole unit cannot take it, because `klama` then stands directly before `be`.

A tanru unit can carry selbri relative clauses: `no'oi subsentence ku'oi`, in which `ke'a` refers to the selbri (`mi klama no'oi bajra`). They are joined as relative clauses are: by `zi'e`, a joik, a jek or an ek, or two groups of them in forethought.

```jbogenbau
%redefine-rule selbri-4
  | selbri-5
  | selbri-4 plain-selbri-connective selbri-5
  | selbri-4 joik-before-ke selbri-5-not-ke-group
  | selbri-4 joik [stag] KE # selbri-3 [+KEhE] #

%rule plain-selbri-connective
  | $j(joik) #
  | jek #
  | ek #
  | VUhU #
%conditions
  KE ⊈ tags(head(after($j)))

%redefine-rule selbri-5
  {selbri-6 ... \ selbri-connective [stag] BO #}

%rule selbri-not-starting-with-ke
  [tag] selbri-1-not-starting-with-ke

%rule selbri-1-not-starting-with-ke
  selbri-2-not-starting-with-ke | NA # selbri

%rule selbri-2-not-starting-with-ke
  selbri-3-not-starting-with-ke [CO # selbri-2]

%rule selbri-3-not-starting-with-ke
  selbri-4-not-starting-with-ke | selbri-3-not-starting-with-ke selbri-4

%rule selbri-4-not-starting-with-ke
  | selbri-5-not-starting-with-ke
  | selbri-4-not-starting-with-ke plain-selbri-connective selbri-5
  | selbri-4-not-starting-with-ke joik-before-ke selbri-5-not-ke-group
  | selbri-4-not-starting-with-ke joik [stag] KE # selbri-3 [+KEhE] #

%rule selbri-5-not-starting-with-ke
  selbri-6-not-starting-with-ke [selbri-connective [stag] BO # selbri-5]

%rule selbri-6-not-starting-with-ke
  tanru-unit-not-starting-with-ke [BO # selbri-6] | [NAhE #] guhek selbri gik selbri-6

%redefine-rule tanru-unit
  | tanru-unit-1
  | tanru-unit-1 {CEI # tanru-unit-1} [selbri-relative-clauses]
  | tanru-unit-1 selbri-relative-clauses

%redefine-rule tanru-unit-1
  | $u(tanru-unit-2)
  | tanru-unit-2 linkargs
%conditions
  BE ⊈ tags(head(after($u)))

%redefine-rule tanru-unit-2
  | KE # selbri-3 [+KEhE] # <~ke-group>
  | BRIVLA #
  | cbm? CMEVLA #
  | GOhA [RAhO] #
  | ME # sumti [+MEhU] # [MOI #]
  | ME # $x(mex) [+MEhU] # [MOI #]
  | mex MOI #
  | NUhA # operator
  | SE # tanru-unit-2
  | JAI # [tag] tanru-unit-2
  | any-word {ZEI any-word}
  | NAhE # tanru-unit-2
  | abstractor-chain subsentence [+KEI] #
  | linkargs tanru-unit-1
  | MEhOI anything #
%conditions
  ¬matches($x, sumti)

%rule tanru-unit-not-starting-with-ke
  tanru-unit-1-not-starting-with-ke [{CEI # tanru-unit-1}] [selbri-relative-clauses]

%rule tanru-unit-1-not-starting-with-ke
  | $u(tanru-unit-2-not-starting-with-ke)
  | tanru-unit-2-not-starting-with-ke linkargs
%conditions
  BE ⊈ tags(head(after($u)))

%rule tanru-unit-2-not-starting-with-ke
  | BRIVLA #
  | cbm? CMEVLA #
  | GOhA [RAhO] #
  | ME # sumti [+MEhU] # [MOI #]
  | ME # $x(mex) [+MEhU] # [MOI #]
  | mex MOI #
  | NUhA # operator
  | SE # tanru-unit-2
  | JAI # [tag] tanru-unit-2
  | any-word {ZEI any-word}
  | NAhE # tanru-unit-2
  | abstractor-chain subsentence [+KEI] #
  | linkargs tanru-unit-1
  | MEhOI anything #
%conditions
  ¬matches($x, sumti)

%rule selbri-relative-clauses
  | {selbri-relative-clause \ ZIhE # | joik # | jek # | ek #}
  | gek selbri-relative-clauses gik selbri-relative-clauses

%rule selbri-relative-clause
  NOhOI # subsentence [+KUhOI] #

%redefine-rule linkargs
  BE # [term] [links] [+BEhO] #

%redefine-rule links
  BEI # [term] [links]
```

## Numbers, lerfu strings and mekso

camxes-exp replaces CLL's mekso with its own, and the layer follows it (camxes-exp.peg, `quantifier` to `lerfu_string`). So nothing reads the CLL rules `operand`, `operand-1` to `operand-3` and `rp-operand`. These are the changes:

- A number is a run of PA words, `ni'e` selbri and `mo'e` sumti, with no lerfu word in it. A lerfu string is a run of lerfu words, with no PA word in it. So `li pa by` is two terms, and `mi viska cy no` is not a text.
- An operand of a mekso is `mex-2`: a number or a lerfu string, a `vei` group, a forethought connection, or a `la'e` or `na'e` reference. It can also be a `pe'o` forethought expression or a reverse Polish expression. The operands `ni'e` and `mo'e` are inside numbers. There is no `jo'i` array, although the lexicon has `jo'i`. camxes-exp reads `jo'i` only in its `operand` rules, which nothing reads, so it rejects `li jo'i pa re te'u`.
- `bo` after an operator, with an optional tense or modal, groups two operands tighter (`li pa su'i bo re`). There is no `bi'e`, and a forethought operator needs `pe'o`.
- An operator can be a connective, a joik, jek or ek. A joik or jek operator has one slot of free modifiers, the one at the end of `joik-jek`. The PEG of camxes-exp never reads its second `free*` there.
- `operator` joins operators with the CLL rules `plain-joik-jek` and `joik-before-ke`, as the CLL grammar does. So `li ci su'i joi ke pi'i ke'e re du li xa` joins `su'i` to the operator's own `ke` group. camxes-exp reads `joi` there as a plain connective before a `ke` operator. Where the operator goes on after its `ke` group, as in `ke pi'i ke'e je bo vu'u`, only the plain reading parses. The layer keeps it.
- A quantifier is a whole mekso, `pa su'i re broda`. It cannot begin with a lerfu word, `la'e` or `na'e`, because camxes-exp reads a sumti there (its `!sumti_6`). camxes-exp also refuses a quantifier where a selbri begins (`!selbri`), and so does the layer. So in `mi piso'umei jimpe`, `pi so'u mei jimpe` is the selbri, and not a quantifier of a description.
- A quantifier also cannot begin with a forethought connection whose first half begins with one of those words. The rule `gek-barrier` finds such a start, also inside a nested connection. So in `ge nai abu gi no drata`, `ge nai ... gi` joins the two sumti `abu` and `no drata`. The quantifier `ge nai abu gi no` over `drata` is not a reading. In the same way, `ge ge abu gi by gi no drata` joins two sumti, and the first one connects `abu` and `by`.
- CLL has only the sumti reading of these texts, because a CLL quantifier is a number or a `vei ... ve'o` group. camxes-exp reads the quantifier `ge nai abu gi no` with the selbri `drata`, as in `re prenu`. The layer follows CLL here. A forethought connection of numbers is still a quantifier, as in `lo ge pa gi re mi broda`.
- `gek-barrier` also changes texts that had only a quantifier reading. Where no sumti reading remains, the layer rejects the text, as CLL does. So `ge abu gi by broda cu klama` is not a text, although camxes-exp reads the quantifier `ge abu gi by` there. In `lo ge by gi re mi broda`, `ge by gi re mi` is now the possessor sumti of the description, with `broda` inside it. camxes-exp reads `ge by gi re` as the quantifier of `mi`.
- `me` takes a mekso as well as a sumti, a whole mekso takes `moi`, and `nu'a` takes a whole operator.
- After `me`, a lerfu string is a sumti and not a mekso, because camxes-exp tries the sumti first (`me my`). The layer settles that tie as camxes-exp does. Before `moi`, the layer differs: in `me my moi`, camxes-exp's `sumti_6` does not read `my` where a selbri begins (`!selbri`), so `my` is a mekso there. The layer reads a sumti. It does not copy the rejections of camxes-exp's PEG, which keeps a sumti once one matches. For example, `me my su'i pa` is the mekso `my su'i pa`, although camxes-exp rejects the text.

`mex` is the chain of operators itself, a left chain as in CLL (CLL 18.5). So the CLL rule `mex-chain` is not reached here. A reverse Polish expression is not an infix chain, and stays a flat list. `operator` keeps the left recursion of the CLL rule.

A number is followed by `free-after-number`, and a lerfu string by `free-after-lerfu-string`, defined under "Free modifiers", and not by a plain `#`.

```jbogenbau
%redefine-rule quantifier
  (* quantifier <- !selbri !sumti_6 mex *)
  $m(mex)
%conditions
  ¬matches(head($m), quantifier-barrier),
  ¬begins(from($m), gek-barrier),
  ¬begins(from($m), selbri)

%rule quantifier-barrier
  BY | LAU | TEI | LAhE | NAhE

%rule gek-barrier
  gek (quantifier-barrier | gek-barrier)

%redefine-rule mex
  {... mex-1 \ operator}

%redefine-rule mex-1
  mex-2 [operator [stag] BO # mex-1]

%redefine-rule mex-2
  | number free-after-number
  | lerfu-string free-after-lerfu-string
  | VEI # mex [+VEhO] #
  | gek mex gik mex-2
  | (LAhE # | NAhE # [BO #]) mex [+LUhU] #
  | PEhO # operator {mex} [+KUhE] #
  | FUhA # rp-expression

%redefine-rule rp-expression
  mex-1 [{rp-expression operator}]

%redefine-rule operator
  | operator-1
  | operator plain-joik-jek operator-1
  | operator joik-before-ke operator-1-not-ke-group
  | operator joik [stag] KE # operator [+KEhE] #

%redefine-rule operator-2
  | mex-operator
  | KE # operator [+KEhE] # <~ke-group>

%redefine-rule mex-operator
  | SE # mex-operator
  | NAhE # mex-operator
  | MAhO # mex [+TEhU] #
  | NAhU # selbri [+TEhU] #
  | VUhU #
  | joik-jek
  | ek #

%redefine-rule number
  {number-part}

%rule number-part
  PA | NIhE # selbri [+TEhU] # | MOhE # sumti [+TEhU] #

%redefine-rule lerfu-string
  {lerfu-word}
```

## Logical and non-logical connectives

camxes-exp's joik takes `na` before a word of JOI, as its jek and ek do. So `mi na joi do klama` has one term, `mi na joi do`. The condition of `listed-bare-na` excludes a bare `na` term here. The words can still join two sumti or two terms, and the rule of "Terms" keeps the sumti.

A forethought connective can be `ga` or `gu` followed by a joik, jek, ek or VUhU, as in `ga je lo mlatu gi lo gerku`. With `ga`, it is a gek. With `gu`, it is a guhek, as in `mi gu je melbi gi kargydu'e`. camxes-exp allows only these two words here, so `ge je` and `gu'e je` are not connectives. The connective before `gi` in a gek can also be a jek or an ek (`je gi mi broda gi mi brode`). A gihek can be `gi` followed by a word of JOI, JA or A (`mi klama gi je tavla`).

The rules name the two words by their sound, `GA="ga"` and `GA="gu"`, which ignores stress. They keep the class GA, because a word that `zo` quotes has the sound but not the class.

```jbogenbau
%redefine-rule joik
  [NA] [SE] JOI [NAI] | interval | GAhO interval GAhO

%redefine-rule gek
  | [SE] GA [NAI] #
  | GA="ga" [NAI] # (joik # | jek # | ek # | VUhU #)
  | (joik | jek | ek) GI #
  | stag gik

%redefine-rule guhek
  | [SE] GUhA [NAI] #
  | GA="gu" [NAI] # (joik # | jek # | ek # | VUhU #)

%redefine-rule gihek
  [NA] [SE] (GIhA | GI (JOI | JA | A)) [NAI]
```

## Tenses and modals

A tense or modal (the rule `tag`) is a run of atoms, as in camxes-exp (`tense_modal`): `pu ba vi ca`, `ki ba`. So nothing reads the CLL rules `simple-tense-modal`, `time`, `time-offset`, `space`, `space-offset`, `space-interval`, `space-int-props` and `interval-property`. Each atom can have `na'e` and `se` before it, and free modifiers after it: `na'e pu na'e ca`, `jai se ki broda`. An atom is one of these:

- A word of BAI, CAhA, CUhE, KI, ZI, PU, VA, ZEhA, VEhA or VIhA
- A word of FAhA, with an optional `mo'i` before it
- A word of ROI after a number or a `vei` group, with an optional `fe'e` before them
- A word of TAhE or ZAhO, with an optional `fe'e` before it
- `fi'o` with a selbri

A joik, jek, ek or VUhU connects tenses and modals, and `tag` is a left chain of them, as in CLL. A run of atoms is a flat list, since nothing connects them. A `stag` is a `tag`, as in camxes-exp. So a stag can be a run of atoms (`ko'a .e pu ba bo ko'e broda`). It can also be a `fi'o` selbri (`mi klama .i fi'o broda fe'u bo do klama`).

`fa` is an atom too, as in camxes-exp, and it is the only way a place marker enters the grammar. So `fa` alone matches `tag` wherever that rule can stand: before a sumti (`fa mi`), a selbri (`mi fa klama`) or `bo`, and after `jai` (`jai fa broda`). It can be converted like a modal (`se fa`) or joined to other atoms (`mi fa pu klama`).

```jbogenbau
%redefine-rule tag
  {... tense-modal \ tag-connective}

%redefine-rule stag
  tag

%rule tag-connective
  joik # | jek # | ek # | VUhU #

%redefine-rule tense-modal
  {tense-atom}

%rule tense-atom
  | [NAhE] [SE] (BAI | CAhA | CUhE | KI | ZI | PU | VA | [MOhI] FAhA | ZEhA | VEhA | VIhA) #
  | [NAhE] [SE] [FEhE] ((number | VEI # mex [+VEhO] #) ROI | TAhE | ZAhO) #
  | [NAhE] [SE] FIhO # selbri [+FEhU] #
  | [NAhE] [SE] FA #
```

## Free modifiers, vocatives and indicators

The text replacement forms of camxes-exp are free modifiers. Each has up to two runs of words, each opened by a word of LOhAI (`lo'ai` or `sa'ai`), and then `le'ai`. The word stage reads the words inside as raw words ([`../words/lohai.md`](../words/lohai.md)).

`soi` is a free modifier here only without `soi-clause`, as CLL has it. camxes-exp makes it a term. Under `cbm`, the layer removes the form of a vocative with a run of names, because a cmevla is then a selbri word. With both forms, their two readings tie.

`free-after-number` and `free-after-lerfu-string` follow a number or a lerfu string. Each is an optional `boi` and the free-modifier slot. Where the `boi` is elided, the first free modifier does not begin with a word that the number or the string can read. After a number, that is a number part. After a lerfu string, it is a letter. camxes-exp's `number` and `lerfu_string` read as far as they can.

So `pa so mo'o` is the number `pa so`, and not `pa` followed by the ordinal `so mo'o`. But `li pa by mai lo'o` has the free modifier `by mai`. The elided `boi` is an elided node of the tree, as in CLL.

A subscript after a subscript nests. CLL 18.13 says: "By convention, a subscript following another subscript is taken to be a sub-subscript". So in `xa xi xa xi xa`, the first `xa` has one subscript, and that subscript has its own. The condition on the `xi` form of `free` says that no `xi` directly follows the mekso of a subscript. Every mekso ends with a slot of free modifiers, so the nested reading is always there.

Without the rule, the two readings elide the same terminators. camxes-exp nests as well, and camxes-std reads two subscripts of the first `xa`.

Any other free modifier after the mekso of a subscript attaches to the word that the subscript marks. CLL's grammar has no slot of free modifiers after a subscript: `XI # (number | lerfu-string) /BOI/`. So in `mi broda xi pa boi to do toi`, the subscript and the parenthesis both belong to `broda`. The official parser of CLL reads the text in this way. The same holds where `boi` is elided, and after `vei ... ve'o`.

The second condition on the `xi` form of `free` states this rule. `mekso-ending-in-free` is a mekso that ends with free modifiers, at least one of them not a subscript. A subscript's mekso cannot be one. Without the rule, the two readings elide the same terminators.

camxes-exp departs here. It reads the mekso of a subscript as `mex_2`, which ends with its own free modifiers, so the parenthesis goes inside the subscript. That is a side effect of the reuse of `mex_2`, and not a choice that its grammar states.

```jbogenbau
%redefine-rule free
  | SEI # [terms [CU #]] selbri [+SEhU]
  | vocative [relative-clauses] selbri [relative-clauses] [+DOhU]
  | ¬cbm? vocative [relative-clauses] {CMEVLA} # [relative-clauses] [+DOhU]
  | vocative [sumti] [+DOhU]
  | mex-2 MAI
  | TO text [+TOI]
  | XI # $m(mex-2)
  | LOhAI [{lohai-word}] [LOhAI [{lohai-word}]] LEhAI
  | LEhAI
  | ¬soi-clause? SOI # sumti [sumti] [+SEhU]
%conditions
  XI ⊈ tags(head(after($m))),
  ¬matches($m, mekso-ending-in-free)

%rule mekso-ending-in-free
  mex-2 [{free}] $f(free) [{free}]
%conditions
  XI ⊈ tags(head($f))

%rule name-marker
  LE="la" | LE="lai" | LE="la'i"

%rule free-after-number
  (* number BOI_elidible free*: after an elided boi, the number has read every number part *)
  [+BOI] $f(#)
%conditions
  begins($, spoken-boi) ∨ ¬begins($f, number-part)

%rule free-after-lerfu-string
  (* lerfu_string BOI_elidible free*: after an elided boi, the string has read every letter *)
  [+BOI] $f(#)
%conditions
  begins($, spoken-boi) ∨ ¬begins($f, lerfu-word)

%rule spoken-boi
  BOI

%rule lohai-word
  ~word∩(LOhAI ∪ LEhAI)=∅
```

## Choosing among parses

Where a text has more than one parse, the stage chooses by the rule of [the notation document](../../docs/notation.md) under "Ambiguity" and "Elided terminators". The layer declares the `late-elision` resolution. It counts the elided terminators of each parse at each place between words. At the first place where the counts differ, the parse with fewer elided terminators wins. Two parses with the same counts at every place are tied, and the stage reports the tie.

For example, `le sutra tavla` has two parses. One is a statement with the description `le sutra`, whose `ku` is elided before `tavla`, and the selbri `tavla`. The other is a fragment, the single description `le sutra tavla`, whose `ku` is elided at the end. `late-elision` takes the fragment, as in the CLL grammar.
