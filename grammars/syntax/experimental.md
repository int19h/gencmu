# The experimental grammar

This document is a layer over [the CLL grammar](cll.md), the grammar of *The Complete Lojban Language* (CLL), edition 1.1. A layer is a document that changes earlier rules. A dialect is a pipeline of stages, defined by one pipeline document. The [experimental](../dialects/experimental.md) dialect stitches this layer after that grammar, that is, combines their rules into one grammar.

A token is one unit that a stage reads or emits. A token's value is the string that exact comparisons read. Its image is the string that people see.

The layer adds experimental constructs. It always accepts some constructs, and a feature, a named switch that the grammars test, guards others. Its baseline is camxes-exp, the experimental grammar of the camxes parser, written as a parsing expression grammar (PEG). A PEG tries alternatives in order.

The layer restates each CLL rule that it changes with `%redefine-rule`. It states its own rules with `%rule`. Each section below says what the layer changes in that part of the grammar. A rule that this document does not name is the CLL grammar's, as that document explains it.

The prose uses these Lojban terms, as [the CLL grammar](cll.md) does:

- A cmavo is a particle, a short structure word.
- A selma'o is a word class of cmavo.
- A brivla is a predicate word.
- A cmevla is a name word.
- A selbri is the predicate of a sentence.
- A sumti is an argument of a selbri.
- A tanru is a compound selbri.
- A tanru unit is one component of a tanru.
- An ek is a logical sumti connective, such as `.e`.
- A jek is a logical connective, such as `je`.
- A joik is a non-logical connective, such as `joi`.
- A gihek connects bridi-tails, as `gi'e` does.
- A gek introduces two branches connected in forethought.
- A stag is a tense or modal inside a connective.
- A bridi-tail is a selbri with any terms after it.
- A lerfu word is a letter word, such as `.abu` or `xy.`.
- A mekso is a mathematical expression.
- VUhU is the class of mathematical operator words.

[The experimental lexicon](../words/lexicon-experimental.md) gives each cmavo one selma'o. For example, `mi'ai` is KOhA, `la` is LE, `fi'oi` is SOI, `ma'oi` is ZO and `la'oi` is ZOhOI. `no'oi` and `po'oi` are NOhOI, with the terminator `ku'oi`. The added classes include `LOhOI`, `NOhOI`, `KUhOI`, `KUhAU`, `LOhAI`, `LEhAI`, `ZOhOI` and `MEhOI`.

[The notation document](../../docs/notation.md) explains the notation. The terminals of this grammar (the symbols that each match one input token) are selma'o. A token is one unit of input. A tag marks a token by an identifier.

A stage is one step of a pipeline, with its own grammar. The pipeline is the sequence of stages that reads a text. The words stage emits each finished quote as one token of its opening class. The syntax reads one terminal for that token. Its internal structure remains in the tree of the words stage.

The layer uses two feature guards, which make a part of a rule depend on a feature. `cbm` is the cmevla-brivla merger, which permits name words as predicates. `soi-clause` makes `soi` a term that takes a subsentence. The experimental dialect turns both on. A caller, the program that requests parsing, can turn either off.

A free modifier is a phrase that stands in many positions. An elidable terminator is a closing word that can be omitted. The free-modifier slot follows it outside its brackets: `[+X] #`. So free modifiers can follow an elided terminator.

The number and letter-string rules prevent a run from ending before a part that can continue it. Each rule tests its actual following node. Numbers continue with number parts or letter words. Letter strings continue with letter words or PA. A written BOI separates the run from the next part. The free-slot wrappers hold BOI and the following free modifiers.

A span is a range between input token boundaries. A ranked choice filters alternatives at one written position. An option qualifies when its complete reading passes the grammar's conditions. An earlier option can exclude a later option over the same span. The [notation document](../../docs/notation.md#ranked-choices) defines when this occurs.

A derivation is one complete grammatical reading. An admitted derivation survives ranked filtering. The stage ranks admitted derivations by `leftmost-longest`, then `fewest`, then `late-elision`. After the flags tie, fewer omitted terminators win at the first differing boundary. Two best derivations with equal counts at every boundary tie, and a tie is an error.

`free` and `tense-modal` carry `leftmost-longest`. A rule profile counts flagged spans. Both rules contribute to one span profile, without priority by rule name. The earliest differing start decides, with longer spans first. A flagged span that prevents the full text from completing contributes nothing.

The `bridi-tail-connective` rule carries `fewest`, which prefers fewer nonempty occurrences. A sumti connection avoids a bridi-tail link, so it wins before late elision when both readings complete. A bridi-tail link remains available where no sumti connection completes.

So `to mi klama` holds `mi klama` in its parenthesis. In the same way, `lu mi klama` holds `mi klama` in its quote.

The layer permits ambiguity beyond omitted terminators. It uses these rules to select a reading:

- In a tanru and between operators, `ke` directly after a joik, jek or ek opens the connective's own group. The selbri and mekso sections explain that choice.
- A connection that can be a sumti connection is one ("Terms"). A complete sumti connection also takes priority over a bridi-tail connection.
- A `be` group attaches to the tanru unit before it ("Selbri and tanru").
- A subscript after a subscript nests. Any other free modifier after a subscript belongs to the word that the subscript marks ("Free modifiers, vocatives and indicators").

The experimental terminators `ku'au` and `ku'oi` are elidable: the rules below write them `[+KUhAU]` and `[+KUhOI]`.

```jbogenbau
%ambiguity-resolution late-elision
```

## The text and its paragraphs

The layer changes the text in five ways. The first change makes a text-initial `nai` an indicator, as the indicator stage of the experimental dialect reads it. The `indicators` rule takes that bare NAI. A separate `nai` stands only before a run of names.

The second change permits an ek after a text-leading `.i`, as in `.i .e do klama`. After that connective, an optional tense can precede `bo`. The rule writes that tense as a `tag`. A `stag` is a `tag` in this dialect, so either name reads the same words.

The third change is that an ek, a jek or a joik directly after `.i` is always a connective. So `i.e`, `.iji` and `mi klama .i e` read `.i e` or `.i ji` as a connective. Without this rule, these texts tie, because a bare ek is a fragment. The rule `lone-i` is an `.i` that no ek, jek or joik follows directly. It stands in the bare-`.i` positions of `text-1` and `paragraph`, before a statement, a fragment or nothing.

The `lone-i` rule tests these three connective families. A VUhU can also follow `.i` as a connective, as in `mi klama .i su'i do klama`. It can instead start a mathematical fragment, as in `mi klama .i su'i pa`. Therefore `lone-i` permits VUhU after it.

In `mi klama .i su'i pa moi`, both the connective and operator readings complete. Late elision selects the connective reading. A gihek answer after `.i` stays a fragment, as in `.i gi'e` and `mi klama .i gi'e`. No `.i` connective is a gihek, so these texts cause no tie.

A bare connective answer needs no `.i`. `e` alone is an ek fragment, and `je` alone is the connective before an empty `text-1`. So reading `.i e` as a connective loses no answer.

A free modifier can stand between `.i` and an ek. Then the ek can still be a fragment, as in `mi klama .i sei broda se'u e`. Neither `ge'i` nor `gu'i` can stand as a bare answer.[^cll-e14-105] A forethought connective can start with an ek, a jek or a joik, as in `je gi mi gi do`. The connective after `.i` consumes that initial ek, jek or joik. Therefore `.i e gi mi gi do` and `mi klama .i je gi mi gi do` fail.

The fourth change permits `.i` after a run of `ni'o` and its free modifiers. Thus `ni'o coi do .i mi klama` keeps `do` inside the vocative. Empty paragraphs can separate runs, as in `ni'o coi ni'o coi`. One `.i ni'o` transition can also stand between paragraphs, so a reply can introduce another topic. A second transition needs an intervening paragraph, so `ni'o .i ni'o .i ni'o` fails. A run can end the text, as in `mi klama ni'o`.

`paragraph-break` collects the topic runs at one paragraph boundary. It can precede the first paragraph, separate two paragraphs, or follow the last paragraph. Nonempty free modifiers separate adjacent NIhO runs, so one run cannot split at an empty free slot. A free slot follows each run group, including the group before the I transition. `leading-separators` collects the ordinary text-leading `.i` forms, both before an initial break and after any break.

The fifth change permits a text-initial run of names only with `cbm` off. Under `cbm`, a cmevla is a selbri word, so the dialect rejects `.djan. mi klama`.

All four connective families can stand before the first `.i` of a text, as in `e mi klama` and `su'i mi klama`. An ek or a VUhU needs a nonempty `text-1` after it. So a bare `e` stays an ek fragment, and a bare `su'i` fails.

A first-child path follows each node's first child. The `$NEEDS-TEXT` pattern finds an initial ek or VUhU along this path, even with conversion or free modifiers. The `text-token` wildcard tests that the following `text-1` starts with a token.

The ranked choice compares complete candidates and prefers the form without an initial connective when both forms complete. So `e .i mi klama` reads an ek fragment and a following sentence. The initial-connective candidate remains available when the fragment reading cannot complete.

An initial connective cannot immediately follow a leading free modifier in the same reading. Thus `doi zed jinvi jena morji` reads the vocative `doi zed` before one sentence with connected bridi-tails. So `coi je mi klama` and `doi djan do'u je do klama` fail, as in camxes-exp.

```jbogenbau
%const $NEEDS-TEXT @(ek ⋰) ∪ @(VUhU ⋰)

%redefine-rule text
  | ¬cbm? [{NAI}] {CMEVLA} # (text-1 ≻ $c:connective $t:text-1)
  | [indicators & {free}] (text-1 ≻ $c:connective $t:text-1)
%conditions
  $c ≇ $NEEDS-TEXT ∨ $t.first-token.matches(text-token),
  ¬$c.preceded-by(free)

%rule text-token
  _

%redefine-rule indicators
  {[FUhE] indicator}

%redefine-rule indicator
  UI | CAI | NAI | DAhO | FUhO

%redefine-rule text-1
  [leading-separators] [paragraph-break] [paragraphs]

%redefine-rule paragraphs
  paragraph [paragraph-break [paragraphs]]

%rule paragraph-break
  {{NIhO} / {free}} # [I # {{NIhO} / {free}} #] [leading-separators]

%rule leading-separators
  {(I joik-jek-ek | lone-i) [[tag] BO] #}

%redefine-rule paragraph
  (statement | fragment) [{lone-i # [statement | fragment]}]

%rule lone-i
  (* I_clause !jek !joik !joik_jek in camxes-exp's paragraph, whose joik includes A *)
  $i:I
%conditions
  ¬$i.following-tokens.begins(joik-jek-ek)
```

<details><summary>Railroad diagrams of the 10 rules from <code>text</code> to <code>lone-i</code></summary>
<p><img src="../../docs/diagrams/syntax/experimental/text.svg" alt="Railroad diagram of the rule text"></p>
<p><img src="../../docs/diagrams/syntax/experimental/text-token.svg" alt="Railroad diagram of the rule text-token"></p>
<p><img src="../../docs/diagrams/syntax/experimental/indicators.svg" alt="Railroad diagram of the rule indicators"></p>
<p><img src="../../docs/diagrams/syntax/experimental/indicator.svg" alt="Railroad diagram of the rule indicator"></p>
<p><img src="../../docs/diagrams/syntax/experimental/text-1.svg" alt="Railroad diagram of the rule text-1"></p>
<p><img src="../../docs/diagrams/syntax/experimental/paragraphs.svg" alt="Railroad diagram of the rule paragraphs"></p>
<p><img src="../../docs/diagrams/syntax/experimental/paragraph-break.svg" alt="Railroad diagram of the rule paragraph-break"></p>
<p><img src="../../docs/diagrams/syntax/experimental/leading-separators.svg" alt="Railroad diagram of the rule leading-separators"></p>
<p><img src="../../docs/diagrams/syntax/experimental/paragraph.svg" alt="Railroad diagram of the rule paragraph"></p>
<p><img src="../../docs/diagrams/syntax/experimental/lone-i.svg" alt="Railroad diagram of the rule lone-i"></p>
</details>

## Statements and fragments

The connective after `.i` can be an ek or a VUhU as well as a joik or jek. A statement connective can also precede `.i`, as in `mi klama joi .i do klama`. Both are `connective`. Before `bo` after `.i`, the connective can also be an ek, and the tense is a `stag`, which is a `tag` here.

`sentence-link` joins a sentence to a following subsentence through a connective before `.i`. A stag can stand before `bo`, but only with `bo`. The subsentence can begin with a prenex, even an empty one, as in `mi klama su'i .i zo'u do klama`. It can hold another link, so these links group from the right.

A TUhE group is not a sentence, so `tu'e mi klama tu'u je .i do klama` fails, as in camxes-exp. Plain connections after `.i` stay in `statement-1` and group from the left. Connections with `bo` use `statement-2` and group from the right.

A bare `na` forms a term. So `na` and `na na` are terms fragments. The layer omits the separate `NA #` alternative from `fragment`, because it duplicates that reading.

```jbogenbau
%redefine-rule statement-1
  | statement-2
  | statement-1 I connective [statement-2]

%redefine-rule statement-2
  statement-3 [I [joik-jek-ek] [stag] BO # [statement-2]]

%redefine-rule statement-3
  sentence | [tag] TUhE # text-1 [+TUhU] #

%redefine-rule fragment
  ek # | gihek # | mekso-fragment | terms [+VAU] # | prenex | relative-clauses | links | linkargs

%redefine-rule prenex
  [terms] ZOhU #
```

<details><summary>Railroad diagrams of the 5 rules from <code>statement-1</code> to <code>prenex</code></summary>
<p><img src="../../docs/diagrams/syntax/experimental/statement-1.svg" alt="Railroad diagram of the rule statement-1"></p>
<p><img src="../../docs/diagrams/syntax/experimental/statement-2.svg" alt="Railroad diagram of the rule statement-2"></p>
<p><img src="../../docs/diagrams/syntax/experimental/statement-3.svg" alt="Railroad diagram of the rule statement-3"></p>
<p><img src="../../docs/diagrams/syntax/experimental/fragment.svg" alt="Railroad diagram of the rule fragment"></p>
<p><img src="../../docs/diagrams/syntax/experimental/prenex.svg" alt="Railroad diagram of the rule prenex"></p>
</details>

## Sentences and bridi-tails

A bridi-tail can have terms before its selbri. The terms and `cu` before a selbri form a `bridi-tail-head`. In a head, runs of terms and single `cu` words alternate: `mi cu do klama`, `cu mi klama`. A head can stand before the first bridi-tail of a sentence, and after each connective between bridi-tails. Examples are `mi klama je do tavla` and `mi klama gi'e cu do tavla`.

A bare tense, modal, or `na` is not a term before a selbri ("Terms" below). So `mi pu klama` has the tense `pu` on its selbri, and so does `mi pu sei do klama se'u klama`. And `mi na klama` negates its selbri.

The afterthought connective between bridi-tails can be a gihek, joik, jek, ek or VUhU (`bridi-tail-connective`). Each of them can also open a `bo` or `ke` grouping of bridi-tails. So can a bare `gi` with a stag, as in `mi klama gi ba bo tavla`.

A structural pattern tests a node and its children. Connected bridi-tails group from the left, and `bridi-tail-1` uses left recursion.[^cll-s14-10] After a plain connective, the headless selbri alternative excludes an initial KE tanru unit. The first-child pattern follows the selected tail to its selbri, including an initial tag. The `gek-sentence` alternative still permits its KE wrapper.

The layer reuses `bridi-tail-1-final` for the final plain connection. Its pattern excludes a whole KE-wrapped forethought sentence, so the connective owns that KE group. An earlier plain connection remains available before a following connection. A head or BO continuation stops the whole-wrapper pattern.

The KU conditions apply in heads, tails, prenexes, fragments, and NUhI termsets. A bare NA or tag can omit KU before a written closing word, a gihek, or the text's end. A bare NA can also omit KU before any actual term. The "Terms" section gives the complete KU rule. A written CU separates runs of terms within a head.

```jbogenbau
%redefine-rule sentence
  (* sentence <- terms? bridi_tail_t1 ... (joik_jek (stag? BO_clause)? I_clause free* subsentence)* *)
  headed-bridi-tail [sentence-link]

%rule sentence-link
  connective [[stag] BO] I # subsentence

%rule bridi-tail-head
  | {terms / CU #} [CU #]
  | CU # [{terms / CU #} [CU #]]

%rule headed-bridi-tail
  [bridi-tail-head] bridi-tail

%rule headed-bridi-tail-2
  [bridi-tail-head] bridi-tail-2

%redefine-rule bridi-tail
  bridi-tail-1-final [(bridi-tail-connective [stag] | GI stag) KE # headed-bridi-tail [+KEhE] # tail-terms]

%redefine-rule bridi-tail-1
  bridi-tail-2 | bridi-tail-1 bridi-tail-connective connected-bridi-tail tail-terms

%const $KE-FORETHOUGHT @([tag] KE [#] gek-sentence KEhE [#])

%redefine-rule bridi-tail-1-final
  | bridi-tail-2
  | bridi-tail-1 bridi-tail-connective $b:connected-bridi-tail tail-terms
%conditions
  $b ≇ $KE-FORETHOUGHT

%const $KE-START @(KE ⋰) ∪ @(tag @(KE ⋰))

%rule connected-bridi-tail
  | bridi-tail-head bridi-tail-2
  | $b:bridi-tail-2
%conditions
  $b ≇ @((selbri ∩ $KE-START) ⋰)

%redefine-rule bridi-tail-2
  bridi-tail-3 [(bridi-tail-connective [stag] | GI stag) BO # headed-bridi-tail-2 tail-terms]

%redefine-rule gek-sentence
  gek subsentence gik subsentence tail-terms | [tag] KE # gek-sentence [+KEhE] # | NA # gek-sentence

%rule(fewest) bridi-tail-connective
  gihek # | connective

%redefine-rule tail-terms
  [terms] [+VAU] #
```

<details><summary>Railroad diagrams of the 13 rules from <code>sentence</code> to <code>tail-terms</code></summary>
<p><img src="../../docs/diagrams/syntax/experimental/sentence.svg" alt="Railroad diagram of the rule sentence"></p>
<p><img src="../../docs/diagrams/syntax/experimental/sentence-link.svg" alt="Railroad diagram of the rule sentence-link"></p>
<p><img src="../../docs/diagrams/syntax/experimental/bridi-tail-head.svg" alt="Railroad diagram of the rule bridi-tail-head"></p>
<p><img src="../../docs/diagrams/syntax/experimental/headed-bridi-tail.svg" alt="Railroad diagram of the rule headed-bridi-tail"></p>
<p><img src="../../docs/diagrams/syntax/experimental/headed-bridi-tail-2.svg" alt="Railroad diagram of the rule headed-bridi-tail-2"></p>
<p><img src="../../docs/diagrams/syntax/experimental/bridi-tail.svg" alt="Railroad diagram of the rule bridi-tail"></p>
<p><img src="../../docs/diagrams/syntax/experimental/bridi-tail-1.svg" alt="Railroad diagram of the rule bridi-tail-1"></p>
<p><img src="../../docs/diagrams/syntax/experimental/bridi-tail-1-final.svg" alt="Railroad diagram of the rule bridi-tail-1-final"></p>
<p><img src="../../docs/diagrams/syntax/experimental/connected-bridi-tail.svg" alt="Railroad diagram of the rule connected-bridi-tail"></p>
<p><img src="../../docs/diagrams/syntax/experimental/bridi-tail-2.svg" alt="Railroad diagram of the rule bridi-tail-2"></p>
<p><img src="../../docs/diagrams/syntax/experimental/gek-sentence.svg" alt="Railroad diagram of the rule gek-sentence"></p>
<p><img src="../../docs/diagrams/syntax/experimental/bridi-tail-connective.svg" alt="Railroad diagram of the rule bridi-tail-connective"></p>
<p><img src="../../docs/diagrams/syntax/experimental/tail-terms.svg" alt="Railroad diagram of the rule tail-terms"></p>
</details>

## Terms

The layer joins terms at two levels. A connective, an optional stag, and `bo` join terms into a `term-bo-group`. A plain connective joins those groups through `term-link`. Thus `broda be na ku .e bo na ku .a na ku` groups its terms as `(na ku .e bo na ku) .a na ku`. Joik, jek, ek, and VUhU supply these connectives.

Plain connections group from the left. A run of BO connections groups from the right, as CLL requires.[^cll-s14-8]

A term stands in heads, tails, prenexes, fragments, and NUhI termsets. BE, BEI, GOI, LAhE, and NAhE each take one term. Branches of a bare forethought termset also take terms.

A bare tag term can omit KU only before a written closing word, a gihek, or the text's end. A bare NA term can omit KU in these positions too. Closing words include `.i`, `ni'o`, `cu`, `gi`, `bei`, `zo'u`, `ce'e`, `pe'e`, and a written terminator of a surrounding construction. `fa'oi` and `oi'i` also separate sentences, and `fi'ai` also closes a prenex. An omitted terminator never counts as a closing word.

A gihek can start with NA or SE. Thus `mi klama pu se gi'e tavla` and `mi klama pu na gi'e tavla` keep the bare tag before that gihek. As a closing word, `.i` can stand before its own connective. NA or SE before an ordinary connective permits no KU omission.

JA, A, JOI, and VUhU alone do not close a term's place. These words can also connect tenses or terms.

A bare NA term can also omit KU before any term in the same reading. These terms include sumti, tagged terms, termsets, SOI terms, and other bare NA terms. Thus `ro da na ka'e` and `na fa mi klama` parse. A tag term keeps the closing-word rule. A tag with its own sumti uses the separate tagged-term alternative and needs no KU.

The KU test starts after the term's own free modifiers. The test of the next written word uses its selma'o. The gihek and term tests read the complete tree. They parse nothing again.

Both written and omitted KU use `bare-na`, so the tree records every omitted KU. The closing-position condition applies only when KU is omitted. `KU=""` matches only an omitted KU because an omitted terminator has an empty value.

The same KU rule applies in lists and single-term positions. A written KU permits either term before any following constituent. A bare `na` cannot begin a term where its NA token starts a connective.

A connection that can form one sumti takes that reading. Each term connection tests its preceding part and the link after the connective. The condition refuses the link when both parts can form one sumti. Thus `mi .e do klama` and `mi .e bo do klama` join sumti. In `mi .e ca do klama`, `ca do` is a modal term, so the connective joins terms.

Three tags carry these facts through the tree. `Link-Extensible-End` marks a sumti that a plain connective can extend. `Bo-Extensible-End` marks one that a BO connective can extend. `Sumti-Start` marks a link that begins with a sumti. `$EXTENSIBLE-END` holds the two end tags.

`sumti-2` carries both end tags. A KE group with written KEhE lacks them. Thus `mi .e ke do ke'e .e ko'a klama` joins terms. After VUhO, a plain connective can extend the sumti, but a BO connective cannot.

A termset closed by written NUhU is not a sumti, and a link that starts with it has no `Sumti-Start` tag. Thus `mi .e ge do gi ti nu'u klama` joins terms. Without NUhU, `mi .e ge do gi ti klama` joins sumti.

Each term level has its own link rules and sumti conditions. A BO group takes its start tag from its first term and its end tags from the group after BO. Neither `term-link` nor `term-bo-link` carries a rule flag. `term-bo-link` permits BO with or without a stag, as in `fa mi .e bo fe do klama`.

PEhE takes any statement connective. `terms-1` and its forethought form `gek-terms-1` are left chains. A SOI term contains a subsentence and ends with SEhU. The `soi-clause` feature enables it, and `fi'oi` belongs to SOI.

A bare forethought termset needs no NUhI, and its branches can hold different numbers of terms. Its first branch ends in `termset-branch`, which elides NUhU before GI. A competing forethought sumti elides nothing there, so `late-elision` prefers it.

The dictionary gives `xoi` class SEI. It opens a free modifier, independent of `soi-clause`.

Thus `ge mi gi do ce'e ti` contains a connected sumti followed by CEhE and another term. In `broda be ge mi gi do ce'e ti be'o`, BE instead takes a termset. Its single argument cannot continue with CEhE after a sumti.

Inside NUhI, a ranked choice prefers `gek-termset-body` over `terms` when both complete over the same span. Thus `nu'i ge mi gi do nu'u` contains two termset branches. A bare forethought termset can also start the plain body. A written inner NUhU keeps its boundary distinct from the outer body.

NIhE keeps an ordinary elidable TEhU, so it can close before the next predicate. In `nu'i ge ni'e broda brode gi re mi nu'u klama`, the first branch contains one quantified sumti. NIhE supplies its quantifier, and `brode` supplies its predicate. The second branch contains `re mi`.

```jbogenbau
%redefine-rule terms-1
  {... terms-2 / PEhE # connective}

%redefine-rule term
  | term-bo-group
  | $t:term $l:term-link :: $l.tags ∩ $EXTENSIBLE-END
%conditions
  Link-Extensible-End ⊈ $t.tags ∨ Sumti-Start ⊈ $l.tags

%rule term-bo-group
  (* term_2 <- term_3 (joik_ek stag? BO_clause term_3)* *)
  | term-3
  | $g:term-3 $l:term-bo-link :: ($g.tags ∩ Sumti-Start) ∪ ($l.tags ∩ $EXTENSIBLE-END)
%conditions
  Bo-Extensible-End ⊈ $g.tags ∨ Sumti-Start ⊈ $l.tags

%rule term-bo-link
  connective [stag] BO # $g:term-bo-group :: $g.tags ∩ ($EXTENSIBLE-END ∪ Sumti-Start)

%rule term-link
  connective $g:term-bo-group :: $g.tags ∩ ($EXTENSIBLE-END ∪ Sumti-Start)

%const $EXTENSIBLE-END Link-Extensible-End ∪ Bo-Extensible-End

%const $PLACE-CLOSE I ∪ NIhO ∪ CU ∪ GI ∪ BEI ∪ ZOhU ∪ CEhE ∪ PEhE ∪ KU ∪ VAU ∪ KEI ∪ KUhO ∪ BEhO ∪ LIhU ∪ TOI ∪ NUhU ∪ GEhU ∪ SEhU ∪ LUhU ∪ TEhU ∪ MEhU ∪ BOI ∪ VEhO ∪ KEhE ∪ LOhO ∪ DOhU ∪ FEhU ∪ TUhU ∪ KUhE ∪ KUhAU ∪ KUhOI

%const $BARE-TAG @(tag KU="" [#])
%const $BARE-NA @(NA [#] KU="" [#])

%rule term-3
  (* term_3 <- sumti / tag_term / termset *)
  | $s:sumti :: $s.tags ∪ Sumti-Start
  | tagged-term
  | termset
  | bare-na
  | soi-clause? soi-term

%rule bare-na
  (* !gek !ek !joik_jek !gihek NA_clause free* KU_elidible free* *)
  $n:NA # [+KU] #
%conditions
  ¬$n.onward.begins(na-connective),
  $ ≇ $BARE-NA ∨ $.ends-input ∨ ($PLACE-CLOSE ∩ $.following-tokens.first-token.tags) ⊈ ∅ ∨ $.followed-by(gihek | term)

%rule na-connective
  gek | joik-jek-ek | gihek

%rule soi-term
  SOI # subsentence [+SEhU] #

%rule tagged-term
  (* tag_term: !gek tag free* followed by a sumti or KU_elidible free* *)
  | tag $s:sumti :: $s.tags ∩ $EXTENSIBLE-END
  | tag [+KU] #
%conditions
  $ ≇ $BARE-TAG ∨ $.ends-input ∨ ($PLACE-CLOSE ∩ $.following-tokens.first-token.tags) ⊈ ∅ ∨ $.followed-by(gihek)

%redefine-rule termset
  (* termset <- gek_termset / NUhI_clause free* gek terms NUhU_elidible free* gik terms NUhU_elidible free* / NUhI_clause free* terms NUhU_elidible free* *)
  | gek termset-branch gik gek-terms [+NUhU] #
  | termset-with-nuhi

%rule gek-termset-body
  (* NUhI_clause free* gek terms NUhU_elidible free* gik terms: tried before NUhI_clause free* terms *)
  gek terms [+NUhU] # gik terms

%rule termset-branch
  gek-terms [+NUhU] #

%rule gek-terms
  {gek-terms-1}

%rule gek-terms-1
  {... gek-terms-2 / PEhE # connective}

%rule gek-terms-2
  {term / CEhE #}

%rule termset-with-nuhi
  NUhI # (gek-termset-body ≻ terms) [+NUhU] #
```

<details><summary>Railroad diagrams of the 17 rules from <code>terms-1</code> to <code>termset-with-nuhi</code></summary>
<p><img src="../../docs/diagrams/syntax/experimental/terms-1.svg" alt="Railroad diagram of the rule terms-1"></p>
<p><img src="../../docs/diagrams/syntax/experimental/term.svg" alt="Railroad diagram of the rule term"></p>
<p><img src="../../docs/diagrams/syntax/experimental/term-bo-group.svg" alt="Railroad diagram of the rule term-bo-group"></p>
<p><img src="../../docs/diagrams/syntax/experimental/term-bo-link.svg" alt="Railroad diagram of the rule term-bo-link"></p>
<p><img src="../../docs/diagrams/syntax/experimental/term-link.svg" alt="Railroad diagram of the rule term-link"></p>
<p><img src="../../docs/diagrams/syntax/experimental/term-3.svg" alt="Railroad diagram of the rule term-3"></p>
<p><img src="../../docs/diagrams/syntax/experimental/bare-na.svg" alt="Railroad diagram of the rule bare-na"></p>
<p><img src="../../docs/diagrams/syntax/experimental/na-connective.svg" alt="Railroad diagram of the rule na-connective"></p>
<p><img src="../../docs/diagrams/syntax/experimental/soi-term.svg" alt="Railroad diagram of the rule soi-term"></p>
<p><img src="../../docs/diagrams/syntax/experimental/tagged-term.svg" alt="Railroad diagram of the rule tagged-term"></p>
<p><img src="../../docs/diagrams/syntax/experimental/termset.svg" alt="Railroad diagram of the rule termset"></p>
<p><img src="../../docs/diagrams/syntax/experimental/gek-termset-body.svg" alt="Railroad diagram of the rule gek-termset-body"></p>
<p><img src="../../docs/diagrams/syntax/experimental/termset-branch.svg" alt="Railroad diagram of the rule termset-branch"></p>
<p><img src="../../docs/diagrams/syntax/experimental/gek-terms.svg" alt="Railroad diagram of the rule gek-terms"></p>
<p><img src="../../docs/diagrams/syntax/experimental/gek-terms-1.svg" alt="Railroad diagram of the rule gek-terms-1"></p>
<p><img src="../../docs/diagrams/syntax/experimental/gek-terms-2.svg" alt="Railroad diagram of the rule gek-terms-2"></p>
<p><img src="../../docs/diagrams/syntax/experimental/termset-with-nuhi.svg" alt="Railroad diagram of the rule termset-with-nuhi"></p>
</details>

## Sumti

Sumti connectives are ek, joik, jek or VUhU (`connective`). This change and the new mekso below leave the CLL rule `joik-ek` unused. After `vu'o`, a connected sumti can follow the relative clauses or replace them, and `vu'o` can also end the sumti (`mi vu'o`). Under `cbm` a cmevla is a selbri word, so the layer removes the `la CMEVLA` name form, and `la .alis.` is a description. That form begins with `la`, `lai` or `la'i`, which are words of LE here, and `name-marker` names them by their values. The new sumti are these:

- `na'e` and `lu'u` surround a sumti, without `bo`.
- `la'e` or `na'e bo` around a term that is not a sumti, such as `na ku` or a tense or modal with its sumti or `ku`
- `na'e` around a term that is neither a sumti nor a tense or modal with its sumti or `ku`, such as `na ku`
- `lo'oi` and `ku'au` surround a subsentence as a description.
- The single-word quotes `zo'oi`, `la'oi` and `ra'oi`, whose bodies the words stage delimits

A bare NAhE cannot wrap one tagged term, even when that term omits KU. The pattern tests the actual `tagged-term` constructor. A connected term can begin with such a term, as in `na'e pu ku .e na ku lu'u`. This grammar accepts `mi na'e pu ku .e ca lu'u klama`. The first tag requires KU before `.e`. The second can omit KU before `lu'u`.

The inner sumti of a description can be any sumti, including a connected one, as in `lo mi .e do broda`. It cannot start with a quantifier. Thus `lo re mi broda` contains `lo re mi` and the selbri `broda`.

The `sumti-tail` condition follows the possessor's first-child path and refuses an initial quantifier. This path crosses plain, BO, KE, and VUhO connections. A forethought connection starts with its gek, so its first branch can begin with a quantifier. The rules `sumti-2` and `sumti-3` are left and right chains, respectively.

A description can take a forethought sentence in place of a selbri, and so can a quantifier without a descriptor. Examples are `le ga mi klama gi do klama ku` and `re ga mi klama gi do klama ku`.

```jbogenbau
%redefine-rule sumti
  | sumti-1
  | sumti-1 VUhO # [relative-clauses] :: Link-Extensible-End
  | sumti-1 VUhO # [relative-clauses] connective $i:sumti :: $i.tags ∩ $EXTENSIBLE-END

%redefine-rule sumti-1
  | sumti-2
  | sumti-2 connective [stag] KE # $i:sumti [+KEhE] # :: KEhE ⊈ $i.following-tokens.first-token.tags ⟹ $i.tags ∩ $EXTENSIBLE-END

%redefine-rule sumti-2 :: $EXTENSIBLE-END
  | {... sumti-3 / connective}

%redefine-rule sumti-3
  {sumti-4 ... / connective [stag] BO #}

%redefine-rule sumti-5
  | [quantifier] sumti-6 [relative-clauses]
  | quantifier (selbri | gek-sentence) [+KU] # [relative-clauses]

%redefine-rule sumti-6
  | (LAhE # | NAhE BO # | NAhE #) [relative-clauses] sumti [+LUhU] #
  | (LAhE # | NAhE BO #) $t:term [+LUhU] #
  | NAhE # $u:term [+LUhU] #
  | KOhA #
  | lerfu-string free-after-lerfu-string
  | ¬cbm? name-marker # [relative-clauses] {CMEVLA} #
  | LE # sumti-tail [+KU] #
  | LOhOI # subsentence [+KUhAU] #
  | LI # mex [+LOhO] #
  | ZO #
  | LU text [+LIhU] #
  | LOhU #
  | ZOI #
  | ZOhOI #
%conditions
  $t ≇ @(sumti),
  $u ≇ @(sumti),
  $u ≇ @(tagged-term)

%redefine-rule sumti-tail
  | $s:sumti sumti-tail-1
  | sumti-tail-1
  | relative-clauses sumti-tail-1
  | gek-sentence
%conditions
  $s ≇ @(quantifier ⋰)
```

<details><summary>Railroad diagrams of the 7 rules from <code>sumti</code> to <code>sumti-tail</code></summary>
<p><img src="../../docs/diagrams/syntax/experimental/sumti.svg" alt="Railroad diagram of the rule sumti"></p>
<p><img src="../../docs/diagrams/syntax/experimental/sumti-1.svg" alt="Railroad diagram of the rule sumti-1"></p>
<p><img src="../../docs/diagrams/syntax/experimental/sumti-2.svg" alt="Railroad diagram of the rule sumti-2"></p>
<p><img src="../../docs/diagrams/syntax/experimental/sumti-3.svg" alt="Railroad diagram of the rule sumti-3"></p>
<p><img src="../../docs/diagrams/syntax/experimental/sumti-5.svg" alt="Railroad diagram of the rule sumti-5"></p>
<p><img src="../../docs/diagrams/syntax/experimental/sumti-6.svg" alt="Railroad diagram of the rule sumti-6"></p>
<p><img src="../../docs/diagrams/syntax/experimental/sumti-tail.svg" alt="Railroad diagram of the rule sumti-tail"></p>
</details>

## Relative clauses

Consecutive relative clauses can be joined by a joik, a jek or an ek, as well as by `zi'e`. Two groups of them can be connected in forethought (`ge poi broda gi poi brode`).

```jbogenbau
%redefine-rule relative-clauses
  | {relative-clause / ZIhE # | joik-jek-ek #}
  | gek relative-clauses gik relative-clauses

%redefine-rule relative-clause
  GOI # term [+GEhU] # | NOI # subsentence [+KUhO] #
```

<details><summary>Railroad diagrams of <code>relative-clauses</code> and <code>relative-clause</code></summary>
<p><img src="../../docs/diagrams/syntax/experimental/relative-clauses.svg" alt="Railroad diagram of the rule relative-clauses"></p>
<p><img src="../../docs/diagrams/syntax/experimental/relative-clause.svg" alt="Railroad diagram of the rule relative-clause"></p>
</details>

## Selbri and tanru

`joik-jek-ek` groups joik, jek and ek. `connective` adds VUhU. All four families connect selbri and tanru units. Abstraction markers use those four families, as in `mi nu e ka broda` and `mi nu su'i ka broda`. A KE connection uses only `joik-jek-ek`.

A bare `fa`, which matches the rule `tag`, can come before a selbri. The term after `be` or `bei` can be absent. The new tanru units are a cmevla, under `cbm`, and preposed linked arguments (`lo be mi broda`). `me'oi` with the word that it quotes is a tanru unit too (`le me'oi klama cu broda`).

`me-unit` takes a sumti or a mekso. A sumti reading excludes a mekso only when both read the same words with the same boundaries. The mekso query restores its omitted terminators, so a competing sumti cannot move an inner close or shorten a free modifier.

The whole `mex MOI #` construction outranks an SE conversion over the same span. A mekso can begin with SE through a forethought `gek`, as in `mi se ga pa gi re moi`.

An outer NAhE modifier outranks the whole `mex MOI #` construction over the same span. Thus `mi na'e su'i pa moi` puts `na'e` on the predicate. Writing PEhO before NAhE selects the operator modifier instead, as in `mi pe'o na'e su'i pa moi`.

In `mi me la'e ge my gi ny su'i zy moi`, ME takes the complete sumti operand. Its LAhE holds the forethought sumti and the following connection.

`selbri-4` keeps the left recursion of the CLL rule, and `selbri-5` is a right chain. Its recursive alternative ranks the KE group above a plain connection across the same span. The plain connective is `connective`, which accepts all four families. The preferred option uses `joik-jek-ek [stag] KE`. So `mi broda joi ke brode ke'e` joins a `ke` group with `joi` through that option.

Where only the plain reading parses, the layer keeps it. So `mi broda joi ke brode ke'e bo brodi` joins `broda` to the unit `ke brode ke'e bo brodi`.

A group of preposed linked arguments comes before a whole `tanru-unit-1`. A `be` group attaches to the tanru unit before it, where there is one. So a unit without a group of its own cannot be directly followed by `be` (`tanru-unit-1`). A preposed group stands only where no such unit comes before it, as at the start of a selbri or after a connective.

So `zdani be mi vorme` gives `be mi` to `zdani`, and `le tutci be sigdanva le marna` gives an empty `be` group to `tutci`. Without the rule, each text has two readings that elide the same terminators.

In `be mi klama be do be ti`, `be do` belongs to `klama`, and `be ti` to the whole unit. In `be mi klama be do`, `be do` belongs to `klama`. The whole unit cannot take it, because `klama` then stands directly before `be`.

A tanru unit can take a selbri relative clause. The clause opens with `no'oi`, contains a subsentence, and ends with `ku'oi`. In that clause, `ke'a` refers to the selbri, as in `mi klama no'oi bajra`. They are joined as relative clauses are: by `zi'e`, a joik, a jek or an ek, or two groups of them in forethought.

```jbogenbau
%redefine-rule selbri-4
  | selbri-5
  | selbri-4 (joik-jek-ek [stag] KE # selbri-3 [+KEhE] # ≻ connective selbri-5)

%redefine-rule selbri-5
  {selbri-6 ... / connective [stag] BO #}

%redefine-rule tanru-unit
  {tanru-unit-1 / CEI #} [selbri-relative-clauses]

%redefine-rule tanru-unit-1
  | $u:tanru-unit-2
  | tanru-unit-2 linkargs
%conditions
  BE ⊈ $u.following-tokens.first-token.tags

%redefine-rule tanru-unit-2
  | KE # selbri-3 [+KEhE] #
  | BRIVLA #
  | cbm? CMEVLA #
  | GOhA [RAhO] #
  | me-unit
  | (NAhE # tanru-unit-2 ≻ mex MOI # ≻ SE # tanru-unit-2)
  | NUhA # operator
  | JAI # [tag] tanru-unit-2
  | abstractor-chain subsentence [+KEI] #
  | linkargs tanru-unit-1
  | MEhOI #

%rule me-unit
  ME # (sumti | $m:mex) [+MEhU] # [MOI #]
%conditions
  ¬$m.without-elision.matches(sumti)

%redefine-rule abstractor-chain
  {... NU # / connective}

%rule selbri-relative-clauses
  | {selbri-relative-clause / ZIhE # | joik-jek-ek #}
  | gek selbri-relative-clauses gik selbri-relative-clauses

%rule selbri-relative-clause
  NOhOI # subsentence [+KUhOI] #

%redefine-rule linkargs
  BE # [term] [links] [+BEhO] #

%redefine-rule links
  BEI # [term] [links]
```

<details><summary>Railroad diagrams of the 11 rules from <code>selbri-4</code> to <code>links</code></summary>
<p><img src="../../docs/diagrams/syntax/experimental/selbri-4.svg" alt="Railroad diagram of the rule selbri-4"></p>
<p><img src="../../docs/diagrams/syntax/experimental/selbri-5.svg" alt="Railroad diagram of the rule selbri-5"></p>
<p><img src="../../docs/diagrams/syntax/experimental/tanru-unit.svg" alt="Railroad diagram of the rule tanru-unit"></p>
<p><img src="../../docs/diagrams/syntax/experimental/tanru-unit-1.svg" alt="Railroad diagram of the rule tanru-unit-1"></p>
<p><img src="../../docs/diagrams/syntax/experimental/tanru-unit-2.svg" alt="Railroad diagram of the rule tanru-unit-2"></p>
<p><img src="../../docs/diagrams/syntax/experimental/me-unit.svg" alt="Railroad diagram of the rule me-unit"></p>
<p><img src="../../docs/diagrams/syntax/experimental/abstractor-chain.svg" alt="Railroad diagram of the rule abstractor-chain"></p>
<p><img src="../../docs/diagrams/syntax/experimental/selbri-relative-clauses.svg" alt="Railroad diagram of the rule selbri-relative-clauses"></p>
<p><img src="../../docs/diagrams/syntax/experimental/selbri-relative-clause.svg" alt="Railroad diagram of the rule selbri-relative-clause"></p>
<p><img src="../../docs/diagrams/syntax/experimental/linkargs.svg" alt="Railroad diagram of the rule linkargs"></p>
<p><img src="../../docs/diagrams/syntax/experimental/links.svg" alt="Railroad diagram of the rule links"></p>
</details>

## Numbers, lerfu strings and mekso

The layer reads mekso with the rules below. Its number and lerfu rules leave the CLL helper `number-continuation` unreachable because their conditions read the actual following node. No reachable rule calls `operand`, `operand-1` to `operand-3` or `rp-operand`. The forms are these:

- A number starts with PA, `ni'e` selbri or `mo'e` sumti. It continues with those parts or lerfu words. A lerfu string starts with a letter word and continues with letter words or PA. Thus `li cy mu my ci no` is one lerfu string, and `li pa by` is one number.
- `mex-2` reads a number, a lerfu string, a `vei` group, a forethought connection, or a `la'e` or `na'e` qualifier. It can also be a forethought expression or a reverse Polish expression. An operator that begins with an unconverted, ungrouped joik, jek or ek unit needs PEhO, including connected operators. Other initial forms permit omitted PEhO. The operands `ni'e` and `mo'e` are inside numbers. There is no `jo'i` array, although the lexicon has `jo'i`.
- `bo` after an operator, with an optional tense or modal, groups two operands tighter (`li pa su'i bo re`). There is no `bi'e`. A forethought operator takes one or more mekso operands, as in `li gei so'i`.
- An operator can be any of the four connective families. Each has one final slot of free modifiers.
- Plain operator connections use `connective`, with all four families. BO and KE connections use `joik-jek-ek`, without VUhU. The KE preference covers JOI, JA and A. So `li ci su'i joi ke pi'i ke'e re du li xa` joins `su'i` to the operator's own `ke` group. Where the operator goes on after its `ke` group, as in `li ci su'i joi ke pi'i ke'e je bo vu'u re du li xa`, only the plain reading parses. The layer keeps it.
- A quantifier is a whole mekso, as in `pa su'i re broda`. A competing `sumti-6` or selbri at its start excludes it. The queries preserve the selected mekso's omitted terminators and free-modifier boundaries. The `sumti-6` constructor holds a sumti without its own outer quantifier. Numeric LAhE and NAhE operands remain possible where no such sumti exists. So in `mi piso'umei jimpe`, `pi so'u mei jimpe` is the selbri, and not a quantifier of a description.
- The first branch of a forethought quantifier cannot begin a `sumti-6` either. The rule `gek-barrier` tests that branch, including nested connections. So in `ge nai abu gi no drata`, `ge nai ... gi` joins the two sumti `abu` and `no drata`. The quantifier `ge nai abu gi no` over `drata` is not a reading. In the same way, `ge ge abu gi by gi no drata` joins two sumti, and the first one connects `abu` and `by`.
- A forethought connection of numbers can form a quantifier, as in `lo ge pa gi re mi broda`. Numeric references also remain possible, as in `ge la'e pa gi re broda`.
- Where no sumti reading remains, `gek-barrier` rejects the text, as in `ge abu gi by broda cu klama`. In `lo ge by gi re mi broda`, `ge by gi re mi` is the possessor sumti, with `broda` inside the description.
- `me` takes a mekso as well as a sumti, a whole mekso takes `moi`, and `nu'a` takes a whole operator.

`mekso-fragment` admits a standalone mathematical expression after the sumti and predicate tests. `quantifier` uses that expression to quantify a sumti. In that position, an initial forethought operator needs PEhO, or the expression needs VEI brackets. Thus `su'i re prenu cu klama` starts with a connective, while `lo su'i re prenu` fails. Both `pe'o su'i re prenu cu klama` and `vei su'i re ve'o prenu` retain their quantified readings. The fragment in `mi klama .i su'i pa` needs neither marker because it quantifies no sumti.

The quantifier condition tests the selected tree's first-child path. A qualifier prefix stops that path before its operand. Thus LAhE and NAhE qualifiers can quantify a sumti, even without written LUhU.

`mex` is the chain of operators itself, a left chain. So the CLL rule `mex-chain` is not reached here. A reverse Polish expression is not an infix chain, and stays a flat list. `operator` keeps the left recursion of the CLL rule.

An initial SE in an operator is its mathematical conversion. The connective alternative excludes that initial SE to avoid a duplicate inner conversion.

A number is followed by `free-after-number`, and a lerfu string by `free-after-lerfu-string`, defined under "Free modifiers", and not by a plain `#`.

```jbogenbau
%redefine-rule quantifier
  $m:mekso-fragment
%conditions
  $m ≇ @(forethought-operator ⋰)

%rule mekso-fragment
  (* quantifier <- !selbri !sumti_6 mex *)
  $m:mex
%conditions
  ¬$m.without-elision.onward.begins(sumti-6 | gek-barrier | selbri)

%rule gek-barrier
  gek (sumti-6 | gek-barrier)

%redefine-rule mex
  {... mex-1 / operator}

%redefine-rule mex-1
  mex-2 [operator [stag] BO # mex-1]

%redefine-rule mex-2
  | number free-after-number
  | lerfu-string free-after-lerfu-string
  | VEI # mex [+VEhO] #
  | gek mex gik mex-2
  | (LAhE # | NAhE # [BO #]) mex [+LUhU] #
  | (PEhO # operator | forethought-operator) {mex} [+KUhE] #
  | FUhA # rp-expression

%rule forethought-operator
  $o:operator
%conditions
  $o ≇ @(joik-jek-ek ⋰)

%redefine-rule rp-expression
  mex-1 [{rp-expression operator}]

%redefine-rule operator
  | operator-1
  | operator (joik-jek-ek [stag] KE # operator [+KEhE] # ≻ connective operator-1)

%redefine-rule operator-1
  | operator-2
  | guhek operator-1 gik operator-2
  | operator-2 joik-jek-ek [stag] BO # operator-1

%redefine-rule operator-2
  | mex-operator
  | KE # operator [+KEhE] #

%redefine-rule mex-operator
  | SE # mex-operator
  | NAhE # mex-operator
  | MAhO # mex [+TEhU] #
  | NAhU # selbri [+TEhU] #
  | $c:connective
%conditions
  SE ⊈ $c.first-token.tags

%redefine-rule number
  number-part [{number-part | lerfu-word}]
%conditions
  ¬$.followed-by(number-part | lerfu-word)

%rule number-part
  PA | NIhE # selbri [+TEhU] # | MOhE # sumti [+TEhU] #

%redefine-rule lerfu-string
  lerfu-word [{PA | lerfu-word}]
%conditions
  ¬$.followed-by(PA | lerfu-word)
```

<details><summary>Railroad diagrams of the 15 rules from <code>quantifier</code> to <code>lerfu-string</code></summary>
<p><img src="../../docs/diagrams/syntax/experimental/quantifier.svg" alt="Railroad diagram of the rule quantifier"></p>
<p><img src="../../docs/diagrams/syntax/experimental/mekso-fragment.svg" alt="Railroad diagram of the rule mekso-fragment"></p>
<p><img src="../../docs/diagrams/syntax/experimental/gek-barrier.svg" alt="Railroad diagram of the rule gek-barrier"></p>
<p><img src="../../docs/diagrams/syntax/experimental/mex.svg" alt="Railroad diagram of the rule mex"></p>
<p><img src="../../docs/diagrams/syntax/experimental/mex-1.svg" alt="Railroad diagram of the rule mex-1"></p>
<p><img src="../../docs/diagrams/syntax/experimental/mex-2.svg" alt="Railroad diagram of the rule mex-2"></p>
<p><img src="../../docs/diagrams/syntax/experimental/forethought-operator.svg" alt="Railroad diagram of the rule forethought-operator"></p>
<p><img src="../../docs/diagrams/syntax/experimental/rp-expression.svg" alt="Railroad diagram of the rule rp-expression"></p>
<p><img src="../../docs/diagrams/syntax/experimental/operator.svg" alt="Railroad diagram of the rule operator"></p>
<p><img src="../../docs/diagrams/syntax/experimental/operator-1.svg" alt="Railroad diagram of the rule operator-1"></p>
<p><img src="../../docs/diagrams/syntax/experimental/operator-2.svg" alt="Railroad diagram of the rule operator-2"></p>
<p><img src="../../docs/diagrams/syntax/experimental/mex-operator.svg" alt="Railroad diagram of the rule mex-operator"></p>
<p><img src="../../docs/diagrams/syntax/experimental/number.svg" alt="Railroad diagram of the rule number"></p>
<p><img src="../../docs/diagrams/syntax/experimental/number-part.svg" alt="Railroad diagram of the rule number-part"></p>
<p><img src="../../docs/diagrams/syntax/experimental/lerfu-string.svg" alt="Railroad diagram of the rule lerfu-string"></p>
</details>

## Logical and non-logical connectives

The connective rules below have no NAI slot. The indicator stage attaches every NAI after a connective, so no separate `nai` reaches the syntax at those positions.

An ek connects sumti with A, and a jek connects predicates with JA. Both permit negation with NA and conversion with SE. An interval connective uses BIhI, with optional conversion. A gik separates forethought branches with GI and permits free modifiers after it.

A joik permits `na` before a word of JOI. So `mi na joi do klama` has one term, `mi na joi do`. The `bare-na` conditions exclude a bare NA term where NA begins a connective. The words can connect sumti or terms, and the term conditions keep the sumti reading.

A forethought connective can be `ga` or `gu` followed by a joik, jek, ek or VUhU, as in `ga je lo mlatu gi lo gerku`. With `ga`, it is a gek. With `gu`, it is a guhek, as in `mi gu je melbi gi kargydu'e`. The connective before `gi` in a gek can also be a jek or an ek (`je gi mi broda gi mi brode`). A gihek can be `gi` followed by a word of JOI, JA or A (`mi klama gi je tavla`).

After `ga` or `gu`, an SE word can convert the whole connective, as in `ga se su'i mi gi do`. This is the outer conversion. The alternative without outer conversion cannot begin with SE, so `ga se je mi gi do` has one reading. A second SE belongs to the inner connective, as in `ga se se je mi gi do`. After NA, an SE word stays inside the connective, as in `ga na se je mi gi do`. The rule `prefixed-connective` states this for both prefixes.

The rules name the two words by their values, `GA="ga"` and `GA="gu"`, which ignores stress. The GA class test excludes caller-supplied tokens with value `ga` or `gu` but no GA tag.

```jbogenbau
%redefine-rule ek
  [NA] [SE] A

%redefine-rule jek
  [NA] [SE] JA

%redefine-rule joik
  [NA] [SE] JOI | interval | GAhO interval GAhO

%redefine-rule interval
  [SE] BIhI

%rule joik-jek-ek
  joik | jek | ek

%rule connective
  joik-jek-ek # | VUhU #

%redefine-rule gek
  | [SE] GA #
  | GA="ga" # prefixed-connective
  | joik-jek-ek GI #
  | stag gik

%redefine-rule guhek
  | [SE] GUhA #
  | GA="gu" # prefixed-connective

%redefine-rule gik
  GI #

%rule prefixed-connective
  | SE connective
  | $c:connective
%conditions
  SE ⊈ $c.first-token.tags

%redefine-rule gihek
  [NA] [SE] (GIhA | GI (JOI | JA | A))
```

<details><summary>Railroad diagrams of the 11 rules from <code>ek</code> to <code>gihek</code></summary>
<p><img src="../../docs/diagrams/syntax/experimental/ek.svg" alt="Railroad diagram of the rule ek"></p>
<p><img src="../../docs/diagrams/syntax/experimental/jek.svg" alt="Railroad diagram of the rule jek"></p>
<p><img src="../../docs/diagrams/syntax/experimental/joik.svg" alt="Railroad diagram of the rule joik"></p>
<p><img src="../../docs/diagrams/syntax/experimental/interval.svg" alt="Railroad diagram of the rule interval"></p>
<p><img src="../../docs/diagrams/syntax/experimental/joik-jek-ek.svg" alt="Railroad diagram of the rule joik-jek-ek"></p>
<p><img src="../../docs/diagrams/syntax/experimental/connective.svg" alt="Railroad diagram of the rule connective"></p>
<p><img src="../../docs/diagrams/syntax/experimental/gek.svg" alt="Railroad diagram of the rule gek"></p>
<p><img src="../../docs/diagrams/syntax/experimental/guhek.svg" alt="Railroad diagram of the rule guhek"></p>
<p><img src="../../docs/diagrams/syntax/experimental/gik.svg" alt="Railroad diagram of the rule gik"></p>
<p><img src="../../docs/diagrams/syntax/experimental/prefixed-connective.svg" alt="Railroad diagram of the rule prefixed-connective"></p>
<p><img src="../../docs/diagrams/syntax/experimental/gihek.svg" alt="Railroad diagram of the rule gihek"></p>
</details>

## Tenses and modals

A tense or modal (the rule `tag`) is a run of atoms: `pu ba vi ca`, `ki ba`. So nothing reads the CLL rules `simple-tense-modal`, `time`, `time-offset`, `space`, `space-offset`, `space-interval`, `space-int-props` and `interval-property`. Each atom can have `na'e` and `se` before it, and free modifiers after it: `na'e pu na'e ca`, `jai se ki broda`. An atom is one of these:

- A word of BAI, CAhA, CUhE, KI, ZI, PU, VA, ZEhA, VEhA or VIhA
- A word of FAhA, with an optional `mo'i` before it
- A word of ROI after a number or a `vei` group, with an optional `fe'e` before them
- A word of TAhE or ZAhO, with an optional `fe'e` before it
- `fi'o` with a selbri

A joik, jek, ek or VUhU connects tenses and modals, and `tag` is a left chain of them. A run of atoms is a flat list, since nothing connects them. A `stag` is a `tag`. So a stag can be a run of atoms (`ko'a .e pu ba bo ko'e broda`). It can also be a `fi'o` selbri (`mi klama .i fi'o broda fe'u bo do klama`).

`fa` is an atom too, and it is the only way a place marker enters the grammar. So `fa` alone matches `tag` wherever that rule can stand: before a sumti (`fa mi`), a selbri (`mi fa klama`) or `bo`, and after `jai` (`jai fa broda`). It can be converted like a modal (`se fa`) or joined to other atoms (`mi fa pu klama`).

The `tense-modal` flag prefers the earliest, longest atom run among complete readings. Thus `pu ca gi` begins one gek instead of a separate PU term before `ca gi`.

```jbogenbau
%redefine-rule tag
  {... tense-modal / connective}

%redefine-rule stag
  tag

%redefine-rule(leftmost-longest) tense-modal
  {tense-atom}

%rule tense-atom
  | [NAhE] [SE] (BAI | CAhA | CUhE | KI | ZI | PU | VA | [MOhI] FAhA | ZEhA | VEhA | VIhA) #
  | [NAhE] [SE] [FEhE] ((number | VEI # mex [+VEhO] #) ROI | TAhE | ZAhO) #
  | [NAhE] [SE] FIhO # selbri [+FEhU] #
  | [NAhE] [SE] FA #
```

<details><summary>Railroad diagrams of <code>tag</code>, <code>stag</code>, <code>tense-modal</code> and <code>tense-atom</code></summary>
<p><img src="../../docs/diagrams/syntax/experimental/tag.svg" alt="Railroad diagram of the rule tag"></p>
<p><img src="../../docs/diagrams/syntax/experimental/stag.svg" alt="Railroad diagram of the rule stag"></p>
<p><img src="../../docs/diagrams/syntax/experimental/tense-modal.svg" alt="Railroad diagram of the rule tense-modal"></p>
<p><img src="../../docs/diagrams/syntax/experimental/tense-atom.svg" alt="Railroad diagram of the rule tense-atom"></p>
</details>

## Free modifiers, vocatives and indicators

A replacement quote is a free modifier. It has up to two runs of words, each opened by a word of LOhAI (`lo'ai` or `sa'ai`), and then `le'ai`. The words stage reads its contents as raw words and emits one quote token ([`../words/lohai.md`](../words/lohai.md)). Syntax requires the `Quote` tag on LOhAI to exclude incomplete quotes.

`soi` is a free modifier here only without `soi-clause`. Under `cbm`, the layer removes the form of a vocative with a run of names, because a cmevla is then a selbri word. With both forms, their two readings tie.

A vocative starts with a run of COI words, DOI, or both. A COI run returns no tags, and DOI alone keeps its tags. The indicator stage attaches any following NAI to the preceding word, so the syntax reads no separate NAI after COI.

`free-after-number` and `free-after-lerfu-string` follow a number or a lerfu string. Each is an optional `boi` and the free-modifier slot. A written BOI permits a separate number or lerfu string after it.

The number and letter-string rules refuse an actual following run part. With written BOI, that terminal follows the run, so the condition holds. With BOI omitted, a number part or letter word continues the number. PA or a letter word continues a letter string. Both free-slot wrappers are named nodes in the tree.

So `pa so mo'o` is the number `pa so`, and not `pa` followed by the ordinal `so mo'o`. With written BOI, `li pa boi by mai lo'o` has the free modifier `by mai`. The elided `boi` is an elided node of the tree.

A subscript after a subscript nests. The second subscript belongs to the first.[^cll-s18-13] So in `xa xi xa xi xa`, the first `xa` has one subscript, and that subscript has its own.

The `free` preference selects this nesting because the nested subscript is the longer modifier at the first `xi`.

A non-XI modifier in the subscript operand's final free slot attaches to the marked word. In `mi broda xi pa boi to do toi`, the subscript and parenthesis both belong to `broda`.

The condition on XI tests `$FREE-ENDING` along the actual last-child path. That pattern finds a final free slot with a `$NON-XI-FREE` modifier. A modifier inside a terminated operand stays there, even when its terminator is omitted. An omitted closer stops the path only when no later child remains. A nonempty free slot after the closer remains the exposed final slot, as in `[+VEhO] #` or `[+BOI] #`. A written closer before the modifier leaves it in the exposed final slot.

The condition excludes an exposed modifier attachment when the modifier belongs to the marked word. It keeps a modifier inside VEI, LAhE, or PEhO when the actual constructor boundary follows that modifier.

```jbogenbau
%const $NON-XI-FREE @(free) ∖ @(XI ⋯)
%const $FREE-ENDING @(⋱ (# ∩ @(⋯ $NON-XI-FREE ⋯)))

%redefine-rule(leftmost-longest) free
  | SEI # [terms [CU #]] selbri [+SEhU]
  | vocative [relative-clauses] selbri [relative-clauses] [+DOhU]
  | ¬cbm? vocative [relative-clauses] {CMEVLA} # [relative-clauses] [+DOhU]
  | vocative [sumti] [+DOhU]
  | mex-2 MAI
  | TO text [+TOI]
  | XI # $m:mex-2
  | LOhAI<Quote>
  | LEhAI
  | ¬soi-clause? SOI # sumti [sumti] [+SEhU]
%conditions
  $m ≇ $FREE-ENDING

%redefine-rule vocative
  | {COI} :: ∅
  | DOI
  | {COI} DOI

%rule name-marker
  LE="la" | LE="lai" | LE="la'i"

%rule free-after-number
  [+BOI] #

%rule free-after-lerfu-string
  [+BOI] #

```

<details><summary>Railroad diagrams of the 5 rules from <code>free</code> to <code>free-after-lerfu-string</code></summary>
<p><img src="../../docs/diagrams/syntax/experimental/free.svg" alt="Railroad diagram of the rule free"></p>
<p><img src="../../docs/diagrams/syntax/experimental/vocative.svg" alt="Railroad diagram of the rule vocative"></p>
<p><img src="../../docs/diagrams/syntax/experimental/name-marker.svg" alt="Railroad diagram of the rule name-marker"></p>
<p><img src="../../docs/diagrams/syntax/experimental/free-after-number.svg" alt="Railroad diagram of the rule free-after-number"></p>
<p><img src="../../docs/diagrams/syntax/experimental/free-after-lerfu-string.svg" alt="Railroad diagram of the rule free-after-lerfu-string"></p>
</details>

## Choosing among parses

Where a text has more than one parse, the stage follows [the notation document](../../docs/notation.md), under "Ranked choices", "Ambiguity", and "Elided terminators". A ranked choice filters alternatives at one written position. The stage ranks admitted derivations by `leftmost-longest`, then `fewest`, then `late-elision`. `late-elision` counts the omitted terminators of each admitted derivation at each boundary. After the flags tie, fewer omitted terminators win at the first differing boundary. Two best derivations with equal counts at every boundary tie, and a tie is an error.

For example, `le sutra tavla` has two parses. One is a statement with the description `le sutra`, whose `ku` is elided before `tavla`, and the selbri `tavla`. The other is a fragment, the single description `le sutra tavla`, whose `ku` is elided at the end. `late-elision` takes the fragment.

## Differences from CLL and camxes-exp

camxes-exp tries alternatives in order. This layer considers complete readings and uses conditions or ranked choices to select among them. Both this layer and CLL read `le sutra tavla` as a fragment.

The [experimental lexicon](../words/lexicon-experimental.md) keeps camxes-exp's words and adds dictionary entries. Its closing section lists class differences and unsupported classes. This layer never reads a CLL class that camxes-exp lacks, such as LA. The experimental dialect enables `cbm` and `soi-clause` because camxes-exp cannot disable them. A caller can disable either here. With `soi-clause` off, `soi` retains CLL's reciprocity form.

The layer writes `[+X] #` where CLL writes `[+X #]`. This permits free modifiers after omitted terminators and explains many restated rules. The number and lerfu conditions keep each run together despite that extra slot. camxes-exp also reads those runs as far as possible. This layer and camxes-exp give the sentence reading to `to mi klama` and `lu mi klama`.

The layer omits `elision-only`, the option that applies CLL's rule that a terminator can be omitted only where no ambiguity results.[^cll-s21-1] Some ambiguities here concern constructs rather than terminators. camxes-exp settles those by alternative order. Here, the connective, term, linked-argument and subscript conditions settle them explicitly. The experimental terminators `ku'au` and `ku'oi` remain elidable, like CLL's terminators.

### Text and sentence connections

camxes-exp's joik includes A, so an ek can follow a text-leading `.i`. CLL instead reads `.i e` as `.i` before an ek fragment. CLL accepts `mi .i e` and `mi .i e .i do klama`. This layer rejects them because `.i e` requires a preceding statement, and `mi` is a fragment. It accepts `.i e .i mi klama`, `.i e .i e mi klama` and `.i e .ije mi klama`, as camxes-exp does.

CLL reads a bare jek answer to `je'i` only in its text-initial connective slot. Therefore CLL always reads `.ije` as a connective, never as `.i` before an answer. This layer applies the same choice to `.i e`, which agrees with camxes-exp. CLL and camxes-exp keep `.i gi'e` and `mi klama .i gi'e` as fragment answers.

A free modifier can still separate `.i` from an ek fragment. Neither CLL nor this layer permits bare `ge'i` or `gu'i` answers.[^cll-s14-13][^cll-e14-105] This layer rejects `.i e gi mi gi do` and `mi klama .i je gi mi gi do`, as camxes-exp does. The `.i` takes the initial connective.

The CLL grammar's `text-1` reads initial `.i ni'o`, as [its repair list](cll.md#printed-rules-and-translations) explains. Real texts write `.i` after `ni'o` and its free modifiers. The break accepts every text-leading form, such as `ni'o .ije`.

Thus `ni'o coi do .i mi klama` keeps `do` in the vocative. Neither printed CLL nor camxes-exp provides that separator position. Printed CLL instead shortens the vocative and reads `do` as a fragment before `.i`. camxes-exp rejects that text at `klama`.

Empty paragraphs between topic runs also follow camxes-exp's optional `paragraph`. CLL requires a nonempty paragraph there. So this layer accepts `ni'o coi ni'o coi` to preserve free modifiers between topic markers.

Within a paragraph break, `.i ni'o` can stand once, after a topic run and its free modifiers. It precedes the text-leading `.i` forms. This form permits a topic change inside a reply. CLL and camxes-exp reject `mi klama ni'o .i ni'o`. Another such transition needs an intervening nonempty paragraph. A final `ni'o` also follows camxes-exp.

camxes-exp has no text-leading run of names. This layer excludes that form with `cbm` on and retains CLL's form with it off.

This layer permits all four initial connective families, as in `je mi klama`, `e mi klama` and `su'i mi klama`. An ek or a VUhU needs a nonempty `text-1`, so a bare `e` remains a fragment. camxes-exp contains the wider form, but `text_1` can match nothing. Thus its `(!text_1 joik_jek)?` never consumes a connective. This layer makes that connective reachable. No reachable rule calls the CLL rule `joik-jek`.

Where both complete, the ek fragment takes priority over the initial connective. Thus `e ni'o` and `e .i mi klama` keep their fragment readings. This preference also applies after the initial name run with `cbm` off.

An initial connective cannot immediately follow a leading free modifier in this layer. Thus `doi djan klama je do cadzu` gives the vocative only `djan`, then reads one connected sentence. In `doi zed jinvi jena morji`, it likewise reads `doi zed` before the connected sentence. camxes-exp rejects both texts. `ui je mi klama` keeps its initial connective because UI is an indicator. `doi djan .i mi klama` keeps its separate statement marker.

The statement connectives follow camxes-exp, including `mi klama joi .i do klama` and `mi klama .e pu bo .i do klama`. Plain connections after `.i` and plain bridi-tail connections retain CLL's left grouping.[^cll-s14-7][^cll-s14-10] Connections after `.i` with `bo` group from the right. Bare `na` instead forms a term, which removes CLL's duplicate fragment alternative.

camxes-exp calls its four-family bridi-tail connection JACU. JOI, JA, A and VUhU join bridi-tails, as GIhA does, as in `mi klama do je tavla ti`. A separate [terms-before-selbri proposal](https://mw.lojban.org/papri/nu_curmi_lo_nu_lo_sumti_cu_jbini_zo_cu_joi_lo_selbri) permits terms before a later selbri, as in `mi klama je do tavla`. This layer has both changes. Like camxes-exp, it keeps `gi'e ke` and `gi'e ba ke` as the start of a KE group of bridi-tails.

camxes-exp uses lookahead after its gihek. This layer uses the KU omission conditions and a first-child pattern on the selected selbri. The final plain connection also excludes a whole KE-wrapped forethought sentence to keep that KE on the connective. A free modifier after the connective does not change this preference, because its slot belongs to `bridi-tail-connective` in either reading. camxes-exp's immediate lookahead instead permits a plain connection when a free modifier separates the connective from KE.

Only the final connection has the connective's KE-group alternative. This layer therefore accepts `mi broda gi'e ke ge brode gi brodi ke'e gi'e brodo` as a non-final plain connection, while camxes-exp rejects it.

The headless-selbri exclusion also applies after a free modifier. Thus this layer rejects `mi broda gi'e to do toi ke brode ke'e gi'e brodo`, which camxes-exp accepts. This keeps the same KE boundary with or without a free modifier.

### Terms and descriptions

The two levels of term connection correspond to camxes-exp's `term_1` and `term_2`. Its `joik_ek` and `joik_jek` include JOI, JA, A and VUhU. This layer uses those classes for term, sumti and selbri connectives too. This layer's tagged and bare-`na` terms in a list correspond to `abs_tag_term`. Tagged and bare-`na` single terms, including those in bare forethought branches, correspond to `tag_term`. `tag_term` has no `!selbri` or `!gek_sentence` lookahead.

The KU rule keeps NA on the outer predicate in `le nu do klama na brode`. It also keeps PU there in `le nu do klama pu brode`. The abstraction and description close before those words.

The same rule rejects `nu'i na broda` and `nu'i pu broda`, as camxes-exp does. A written NUhU permits both termsets to end before `broda`.

The [#130 examples](https://github.com/int19h/gencmu/issues/130) distinguish a term's own free modifiers from a later constituent. In `mi klama na to broda`, the NA term owns the complete parenthesis. In `mi klama na sei mi broda brode`, it owns the complete SEI clause. `na to broda` permits the same fragment reading. In `na na to broda toi`, the first NA term precedes a second NA term with its own parenthesis.

camxes-exp writes successive BO term links as a flat list. This layer groups them from the right, as CLL 14.8 requires, to match its sumti and selbri connections.

camxes-exp requires a stag before `bo` in `abs_term_2`. This layer permits its omission, so `fa mi .e bo fe do klama` parses here and fails there. camxes-exp prefers sumti over term connections by trying sumti first. This layer uses conditions for both levels. Both therefore prefer the sumti when both readings complete.

Bare forethought termsets can have unequal branch lengths here, as CLL's bracketed termsets can. camxes-exp pairs the branches term by term. Where a forethought sumti also completes, its earlier choice agrees with this layer's elision ranking. The termset omits NUhU before GI, while the sumti omits nothing there.

A bare forethought termset can close with NUhU here. camxes-exp gives that form no terminator. A written closer permits the nested termset at the start of a NUhI body.

Inside NUhI, this layer ranks the complete forethought body first. In `nu'i ge ni'e broda brode gi re mi nu'u klama`, NIhE can close before `brode`, which becomes the quantified sumti's predicate. camxes-exp greedily keeps `broda brode` inside NIhE and takes the plain body. This layer revisits inner choices when a whole construction needs them.

camxes-exp excludes every bare NAhE operand that starts with a tense or modal because `na'e pu` matches `tag`. This layer excludes only one actual tagged term, whose tag reading duplicates it. A connection of terms remains possible, even with omitted KUs.

The `fewest` flag compares complete readings and prefers fewer bridi-tail links before elision ranking. Thus `mi nelci lo ka smuni .e lo ka pemci melbi` joins the two descriptions, as camxes-exp does. The flag does not choose between two sumti connections with different scopes. Late elision still selects their closing boundaries.

The description's possessor can be any unquantified sumti. camxes-exp also reads an initial quantifier as `quantifier` followed by `sumti`. Thus `lo re mi broda` contains `lo re mi` followed by the selbri `broda`. Forethought sentences in descriptions follow camxes-exp's `sumti_tail` and `sumti_5`.

### Deliberate KU omission limits

Bare NA records an omitted KU, as camxes-exp's `KU_elidible` requires. That marker participates in elision ranking and restoration queries.

This layer deliberately limits KU omission more than camxes-exp. A bare tag term can omit `ku` only at the input's end, before a written closing word, or before a gihek. A bare `na` term can omit `ku` in these positions too. The test skips the term's own free modifiers. A bare `na` term can also omit `ku` before any term in the same reading.

Thus a reader never has to guess which construct an omitted `ku` ends. CLL requires a written `ku` after a `na` term in every position.[^cll-s21-1]

A gihek can start with NA or SE. These prefixes close the term's place only when they belong to the actual gihek. An ordinary connective without `.i` does not close that place.

Writing `ku` makes each rejected text below parse. For example, `mi pe na klama` becomes `mi pe na ku klama`. `ze'u na do tavla` becomes `ze'u ku na ku do tavla`.

Outside the positions above, a bare tag or NA term requires a written KU. CLL also permits a tag to omit KU where no ambiguity results.[^cll-s21-1] This layer rejects some such texts, including `broda be pu brode`.

JA, A, JOI, and VUhU do not count as closing words because they also connect tenses or terms. Thus `mi klama pu je tavla` fails, while `mi klama pu ku je tavla` parses. Counting these connectives as closing words gives `mi klama pu je ca klama` two readings.

The corpus records these examples that camxes-exp accepts and this layer rejects:

- `mi pe na klama` places a bare NA before a selbri.
- `broda be pu brode` places a bare tag before a selbri.
- `not canada` divides into `not ca na da` and places the bare tag `ca` before NA.
- `ze'u na do tavla` places a bare tag before NA.
- `na to mi toi .e do` places a bare NA before a connective.
- `.i lei za'u da ba na ku curmi le nu mi'ai klama lo nenri be le purdi` places a bare tag before NA.
- `mi klama pu je tavla` places a bare tag before an ordinary connective. Write `mi klama pu ku je tavla`.

The rule also changes accepted readings. In `ge mi ti gi do na klama`, this layer puts NA on the following selbri. camxes-exp puts it in the termset's second branch. The same difference applies to `ge mi ti gi do pu klama`. An omitted NUhU permits no KU omission before `klama`.

In `na pa to joi re moi mi`, this layer puts `joi re moi` inside the parenthesis. camxes-exp puts only `joi` there. The final `mi` follows the parenthesis in both readings.

### Tanru and linked arguments

A sumti reading excludes a mekso only when both read the same words with the same boundaries. Thus `me ni'e broda brode` takes a mekso whose NIhE holds both predicates, as camxes-exp does. The same rule applies in `me ni'e broda to mi toi brode`. The sumti alternative instead closes NIhE before `brode`, which supplies its predicate.

The parenthesis in `me re to le rance` contains `le rance`. The SEI clause in `me re sei mi klama broda` contains `klama broda`. A separate sumti query cannot shorten these selected free modifiers.

This layer keeps the complete sumti in `mi me la'e ge my gi ny su'i zy moi`. camxes-exp's restrictive sumti lookahead instead takes a mekso. In `me my moi`, this layer takes a sumti and camxes-exp takes a mekso. This layer accepts `me my su'i pa` as mekso, while camxes-exp commits to a shorter sumti and rejects it.

After a joik, jek or ek directly before KE, this layer prefers the connective's KE group. camxes-exp first takes a plain connective before a KE tanru unit. Both forms group the same words in `mi broda joi ke brode ke'e`.

CLL has a dedicated KE form only for joik.[^cll-s21-1] This layer also gives jek and ek that form. CLL and camxes-exp read `mi broda je ke brode ke'e` as a plain connection. This layer gives the KE group to the connective instead.

Where only the plain reading completes, this layer and camxes-exp keep it. The [official parser](cll.md#printed-rules-and-translations) rejects `mi broda joi ke brode ke'e bo brodi`. A lexer divides text into tokens. That parser's lexer treats `joi ke` as one token.

Preposed linked arguments follow camxes-exp. This layer and camxes-exp give a `be` group to the preceding unit when one exists. camxes-std, the standard grammar of the camxes parser, agrees. Thus `zdani be mi vorme` gives `be mi` to `zdani`, and `le tutci be sigdanva le marna` gives an empty group to `tutci`. The alternative attachments elide the same terminators. In `be mi klama be do`, both this layer and camxes-exp give `be do` to `klama`.

### Mekso and connectives

The mekso rules follow camxes-exp.peg except for mixed numbers and letter strings, and forethought operators without PEhO. They leave CLL's operand rules and `rp-operand` unreachable. The new `mex` replaces `mex-chain` and retains CLL's left grouping.[^cll-s18-5] Reverse Polish expressions remain flat lists. NIhE and MOhE appear inside numbers. camxes-exp lists `jo'i` only in unreachable operand rules, so this layer and camxes-exp reject `li jo'i pa re te'u`.

CLL permits PA words inside a letter string and lerfu words inside a number.[^cll-s21-1] This layer keeps both forms because real dates mix letters and digits, as in `dy pa my pa`. camxes-exp excludes these mixtures and rejects `li cy mu my ci no`. It reads `li re no pa ze ny pa ly mu dy` as separate sumti, while this layer reads one number.

A written BOI permits a number or letter string to end before another continuing word. Without it, the sequence consumes every continuation. CLL example 17.27 writes `xy. boi ro prenu cu prami` to separate the letter argument from the quantifier.[^cll-e17-27]

CLL makes PEhO optional before a forethought operator.[^cll-s21-1] This layer keeps that form, so `li gei so'i` and `li pe'o gei so'i` both parse. camxes-exp requires PEhO and rejects the first text.

CLL has no bare joik, jek or ek operator unit. Here an operator that begins with such an unconverted, ungrouped unit needs PEhO, including a connection with that leftmost unit. Converted or grouped initial units permit omitted PEhO. The first-child pattern states that boundary.

An initial forethought operator in a sumti quantifier needs written PEhO or VEI brackets, so `lo su'i re prenu` fails. Neither CLL nor camxes-exp admits that unmarked quantifier. This restriction keeps `su'i re prenu cu klama` as an initial connective followed by a quantified description and its predicate. A standalone fragment quantifies no sumti, so this layer accepts `mi klama .i su'i pa`. camxes-exp requires PEhO there, while CLL permits only a number or VEI group as a mathematical fragment.

A qualifier around that expression does not start with a forethought operator. Thus `lo na'e su'i re lu'u prenu` forms a qualified quantifier, like its `la'e` twin.

An outer NAhE predicate modifier takes priority over an omitted-PEhO operator modifier when both readings complete over the same span. Both forms otherwise elide the same terminators, so elision ranking cannot choose between them. Explicit PEhO preserves the distinction: `mi na'e pe'o su'i pa moi` modifies the predicate, while `mi pe'o na'e su'i pa moi` modifies the operator.

A connective operator has one effective final free slot in this layer and camxes-exp. camxes-exp never reads the second `free*`.

The ranked choice in `operator` gives JOI, JA and A the same KE preference. camxes-exp first reads the plain connective. It joins `su'i` to a KE operator unit in `li pa su'i je ke pi'i ke'e re`. This layer gives the KE group to the connective instead. Both parsers keep the plain reading when the operator continues after its group, as in `li ci su'i joi ke pi'i ke'e je bo vu'u re du li xa`.

The quantifier restrictions test the selected mekso's restored view against `sumti-6`, `gek-barrier` and `selbri`. Each query keeps its free modifiers and omitted terminators at their selected boundaries. These tests correspond to camxes-exp's `!sumti_6` and `!selbri`.

LAhE and NAhE exclude a quantifier only when their operand forms a sumti. Numeric operands remain possible in `la'e pa lu'u broda` and `ge la'e pa gi re broda`. The layer extends the sumti check into nested forethought connections.

CLL gives `ge nai abu gi no drata` only a sumti reading because its quantifiers are numbers or VEI groups. camxes-exp instead takes the quantifier `ge nai abu gi no` before `drata`, as in `re prenu`.

This layer accepts `la'e to mi pa broda` and `na'e to mi pa broda`, while camxes-exp rejects both. The parenthesis stays on the LAhE or NAhE prefix. The operand is `pa broda`.

Where no sumti reading remains, this layer and CLL reject `ge abu gi by broda cu klama`. camxes-exp takes the quantifier `ge abu gi by`. In `lo ge by gi re mi broda`, this layer takes `ge by gi re mi` as the possessor. camxes-exp takes `ge by gi re` as the quantifier of `mi`. Numeric forethought quantifiers remain possible, as in `lo ge pa gi re mi broda`.

The connective rules omit optional NAI because the indicator stage attaches those words first. This applies to ek, jek, joik, interval, gek, guhek and gik, as well as gihek. CLL instead gives these rules NAI slots.

The joik's initial NA and extended forethought forms follow camxes-exp. Its bare JA and JOI gihek alternatives instead use `connective` here, because `bridi-tail-connective` already admits that family. A bare JA or JOI answer therefore uses the text-initial connective slot, rather than a gihek fragment.

The atomic tenses and FA atom follow camxes-exp's `tense_modal`. Its `stag` reads the same words as its `tag`, as in this layer.

Only `ga` and `gu` introduce the extended forethought forms, so `ge je` and `gu'e je` remain invalid.

A tag remains a term when the following GI belongs to an enclosing connection. This layer accepts `mi klama pu gi ba bo tavla`, while camxes-exp rejects it. The same applies to `mi klama pu gi pu bo brode` and `broda be pu gi pu bo brode`. No complete forethought reading starts at the tag.

This layer also accepts `ge mi klama pu gi do klama` and `ge mi pu gi do nu'u klama`. camxes-exp rejects both texts without written KU. Their GI joins the outer branches, so PU remains a term within the first branch.

### Free modifiers and subscripts

The free-modifier preference compares complete readings. Thus `le to mi pilno li reci namcu` remains possible. An incomplete longer parenthesis does not block its shorter complete reading.

A number cannot end before another number part without written BOI. So `li pa joi xi re re` fails because both `re` words belong to the subscript. No operand remains after `joi`. `li pa joi xi re boi re` keeps the subscript boundary and the following operand.

This layer accepts `li pa ni'e to mi broda re mai lo'o`, while camxes-exp rejects it. The ordinal `re mai` modifies the selbri inside NIhE. The outer number contains PA and that NIhE part.

The replacement quotes follow camxes-exp. Under `cbm`, a name is a predicate, so a separate name-run vocative form duplicates the selbri form. This layer removes it. With `soi-clause` on, `soi` is a term, as in camxes-exp. Without it, `soi` remains CLL's free modifier.

The vocative omits CLL's optional NAI after COI because the indicator stage attaches it to COI. Text-initial NAI and indicators after LU remain separate syntax tokens.

CLL states the nesting convention:[^cll-s18-13]

> By convention, a subscript following another subscript is taken to be a sub-subscript

camxes-exp also nests the second subscript of `xa xi xa xi xa`. camxes-std instead gives both subscripts to the first `xa`. This layer's free-modifier preference selects the nested reading.

CLL has no free slot after a subscript: `XI # (number | lerfu-string) /BOI/`. This layer and the official parser attach the parenthesis in `mi broda xi pa boi to do toi` to `broda`. camxes-exp reads the subscript operand as `mex_2`, whose final free slot takes the parenthesis. This layer excludes that exposed attachment but retains modifiers inside VEI, LAhE or PEhO when the actual constructor boundary follows them.

[^cll-s18-13]: [CLL 1.1, section 18.13](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-subscripts-math.html).

[^cll-s14-13]: [CLL 1.1, section 14.13](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-truth-and-connective-questions.html).

[^cll-s14-10]: [CLL 1.1, section 14.10](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-multiple-compound-bridi.html).

[^cll-s14-7]: [CLL 1.1, section 14.7](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-more-propositions.html).

[^cll-s18-5]: [CLL 1.1, section 18.5](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-simple-infix.html).

[^cll-e14-105]: [CLL 1.1, section 14.13, example 14.105](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-truth-and-connective-questions.html#c14e13d14).

[^cll-s21-1]: [CLL 1.1, section 21.1](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/chapter-grammars.html#section-EBNF).

[^cll-e17-27]: [CLL 1.1, section 17.9, example 17.27](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-lerfu-pro-sumti.html#c17e9d7).

[^cll-s14-8]: [CLL 1.1, section 14.8](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-afterthought-connectives-grouping.html).
