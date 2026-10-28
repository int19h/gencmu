# CLL syntax with BPFK word forms

This pipeline combines syntax from *The Complete Lojban Language* (CLL) with the working word forms of the BPFK, the Lojban language planning committee. Those word forms derive from a parsing expression grammar (PEG).

A token is one unit that a stage reads or emits. A token's value is the string that exact comparisons read. Its image is the string that people see.

A tag marks a token by an identifier.

[CLL 1.3.4](https://github.com/int19h/cll/blob/v1.3.4/chapters/a02.xml) prints that PEG in appendix A2. [`morphology.md`](morphology.md) derives from it and states the morphology's rules directly. Its [closing section](morphology.md#differences-from-cll-and-the-reference-peg) lists deliberate departures and their reasons.

The executable baseline is camxes-std, the standard grammar of the camxes parser: `camxes.peg` at ilmentufa commit [`778ea138f7d150121ca722db7536ce3b123943ac`](https://github.com/lojban/ilmentufa/blob/778ea138f7d150121ca722db7536ce3b123943ac/camxes.peg).

Outside the working morphology and the project choices below, this pipeline follows CLL 1.1. It uses the [Magic Words stream](../common/stream.md) and the shared CLL indicator stage. The `lojban/cll` and `lojban/bpfk` pipelines use `late-elision elision-only` for omitted terminators. Their numbers and letter strings are indivisible. The project choices below specify this pipeline's erasure, elision, and connective policies.

A pipeline document defines an ordered sequence of stages. A stage is one step of a pipeline, with its own grammar. Beyond CLL's orthography, the phoneme stage reads the conventions of [`../common/latin.md`](../common/latin.md). The working morphology reads part of these conventions too. The phoneme stage also reads gencmu's Cyrillic and zbalermorna. The indicator stage is the indicator stage of the [CLL](../cll/pipeline.md) pipeline.

Indicators after `lu` begin quoted content. Indicators after `to` and `to'i` attach to the opener. A quoted text starts like a whole text, with initial names or indicators, but not both.

## NAI attachment

The shared indicator stage keeps each run flat. Within a run, `nai` attaches only to the UI or CAI directly before it. BAhE can stand between them. The [Magic Words proposal](https://mw.lojban.org/papri/Magic_Words) separates UI and CAI from DAhO, FUhE and FUhO, which do not absorb `nai`. The camxes-std rule `indicator` attaches NAI only to UI and CAI. CLL[^cll-s19-16] agrees.

FUhE opens an indicator group. The [indicator document](../cll/indicators.md#differences-from-cll-and-camxes-std) compares the FUhE grouping and NAI rules. The syntax reads any NAI that the indicator stage leaves outside a pair under its own rules.

## Erasure boundary

A feature is a named switch that the grammars test. The pipeline turns on `su-boundary`. That feature makes SU stop at the last surviving `ni'o`, `no'i`, `lu`, `tu'e`, `to`, or `to'i`.

```jbogenbau
%features su-boundary
```

## Stage 1: phonemes

```jbogenbau
%stage phonemes
```

- [The Latin orthography of CLL](../cll/latin.md)
  ```jbogenbau
  %include "../cll/latin.md"
  ```
- [Latin conventions](../common/latin.md): punctuation, capital runs, accents and digits
  ```jbogenbau
  %include "../common/latin.md"
  ```
- [Cyrillic orthography](../common/cyrillic.md): gencmu's Cyrillic, the default
  ```jbogenbau
  %include "../common/cyrillic.md"
  ```
- [The Cyrillic orthography of CLL](../cll/cyrillic.md): the Cyrillic of CLL[^cll-s3-12], which a caller chooses with the feature `cll-cyrillic`
  ```jbogenbau
  %include "../cll/cyrillic.md"
  ```
- [zbalermorna](../common/zbalermorna.md)
  ```jbogenbau
  %include "../common/zbalermorna.md"
  ```

## Stage 2: forms

```jbogenbau
%stage forms
```

- [Word forms](../common/forms.md)
  ```jbogenbau
  %include "../common/forms.md"
  ```
- [BPFK word forms](morphology.md)
  ```jbogenbau
  %include "morphology.md"
  ```
- [The CLL lexicon](../cll/lexicon.md)
  ```jbogenbau
  %include "../cll/lexicon.md"
  ```

## Stage 3: words

```jbogenbau
%stage words
```

- [The word stream](../common/stream.md)
  ```jbogenbau
  %include "../common/stream.md"
  ```

## Stage 4: indicators

```jbogenbau
%stage indicators
```

- [Indicators and ba'e](../cll/indicators.md)
  ```jbogenbau
  %include "../cll/indicators.md"
  ```

## Stage 5: syntax

```jbogenbau
%stage syntax
```

- [The CLL grammar](../cll/syntax.md)
  ```jbogenbau
  %include "../cll/syntax.md"
  ```

The stage uses the [lojban/cll ranking and check](../cll/pipeline.md#stage-5-syntax). The grammar's [simple tense-modals](../cll/syntax.md#tenses-and-modals) are the forms of `simple-tense-modal`. Their `leftmost-longest` flag prefers the earliest group, then the longest one at that start. `late-elision` ranks the remaining choices, and `elision-only` runs only when ranking selects one of several parses. The check restores that parse's omitted terminators and parses the restored text again. Another reading of the restored text that the flag does not rank below that parse makes the original text an error.

```jbogenbau
%ambiguity-resolution late-elision elision-only
```

A constituent can end wherever a parse of the whole text needs it. Numbers and letter strings cannot split before a continuation unit. The CLL grammar states that rule separately, under "Numbers, lerfu strings and mekso".

A selbri is the predicate of a sentence. A bridi-tail is a selbri with any terms after it.

A text that remains ambiguous after terminator restoration is an error. The CLL grammar settles two connective ambiguities, one with a ranked choice and one with a condition. `mi broda joi ke brode ke'e` is a `ke` group joined to `broda` by `joi`. `mi broda gi'e ke brode ke'e` is a `ke` group of bridi-tails after `gi'e`.

## Differences from CLL, BPFK proposals and camxes-std

### Sources and word forms

The [checkpoint record](https://mw.lojban.org/index.php?title=BPFK_Checkpoints&oldid=109606) defers morphology. The [Formal Grammar section](https://mw.lojban.org/index.php?title=BPFK_Section:_Formal_Grammar&oldid=111787) proposes replacing YACC with a PEG. CLL 1.3.4[^cll-later-a3-1] keeps EBNF (Extended Backus-Naur Form) and YACC as the official syntax. It describes camxes PEG syntax as practice without ratification.

A rafsi is a word form used inside compounds. A brivla is a predicate word. The working morphology uses extended rafsi. One kind lets a non-borrowing brivla stand whole before `'y` inside a compound, as in `klama'ybroda`. Neither CLL 1.1[^cll-c4] nor CLL 1.3.4[^cll-later-c4] teaches that form in its chapter on word forms.

CLL 1.3.4[^cll-later-s4-16] already teaches the borrowing form, as in `spageti'ykukte`.

The working morphology also lets a `Cy` letter word stand before another word without a pause, so `fyno` is `fy no`. CLL[^cll-s4-9] requires a pause there.

This pipeline accepts `kyyykerlo`, which full camxes-std rejects through its lexer wrapper. The [word-form document](morphology.md#words) explains why its morphology-only parser accepts the same division.

### Syntax decisions

A tag is a tense or modal phrase. The BPFK recorded one decision on syntax, and this pipeline does not apply it. On 15 March 2016, the BPFK [ruled](https://mw.lojban.org/index.php?title=BPFK:_lo_nu_broda_ba_brode&oldid=119454) that a tag attaches to a following selbri unless `ku` closes the tag. So `lo nu broda ba brode` means `lo nu broda cu ba brode`. This pipeline keeps the reading of CLL 1.1, where `ba` is a term inside the `nu` clause, the abstraction: `(lo [{nu (broda ba)} brode])`. camxes-std follows the decision and puts `ba` on `brode`.

### Indicator boundaries and NAI

The [indicator document](../cll/indicators.md#quotation-boundaries) defines quotation and parenthesis boundaries. Its [source comparison](../cll/indicators.md#quotation-and-parenthesis-boundaries) explains CLL and the official parser.

This pipeline departs from [camxes-std](https://github.com/lojban/ilmentufa/blob/778ea138f7d150121ca722db7536ce3b123943ac/camxes.peg#L343-L1100) on NAI attachment. camxes-std lets UI and CAI clauses recursively take more indicators before their following optional NAI. Repeated NAI can therefore close successive indicator levels. The difference changes both acceptance and negation scope, in attached and leading runs.

In `lojban/cll` and `lojban/bpfk`, `mi .e ui da'o nai do` negates `.e`. camxes-std instead negates `ui`.

In `lojban/cll` and `lojban/bpfk`, `mi pu ui da'o nai klama` negates `pu`. camxes-std instead negates `ui`.

In `lojban/cll` and `lojban/bpfk`, `mi ui ia nai nai klama` fails. camxes-std accepts it and gives each attitudinal its own NAI.

### Erasure and elision

SU erases back to the last surviving word of NIhO, LU, TUhE, or TO, as in lojban/cll. That word survives, as in camxes-std. Later LIhU, TOI, and TUhU do not cancel an earlier boundary. The [Magic Words proposal](https://mw.lojban.org/papri/Magic_Words) and camxes-std supply these boundaries. The [word stream](../common/stream.md#cll-and-magic-words) says which stops agree with CLL and which depart from CLL[^cll-s19-13].

CLL gives terminator advice and describes some limitations of its official parser. The elision policy follows the intended boundary where the whole text forces it. Where nothing forces that boundary, the elision policy keeps the reading that CLL warns about.

"Elision policy and CLL advice" in [the CLL grammar](../cll/syntax.md#elision-policy-and-cll-advice) explains the forced boundaries in the examples[^cll-e8-48][^cll-e8-62]. CLL describes the merged readings that a left-to-right reading of the words gives. The whole text forces the boundary where CLL writes the terminator. The elision policy disagrees with no specific text of CLL.

A PEG commits to choices before it knows whether the whole text parses. This pipeline follows the whole text instead. So `le lojbo se farvi le loglo gi'enai mintu ja dunli le logla` parses with the description ending before `se farvi`.

A tanru unit is a component of a selbri. Before a `ke` group, camxes-std tries the plain connective first, and this pipeline prefers the `ke` group. This difference appears in three places:

- In a tanru, camxes-std reads `joi` before a tanru unit that begins with `ke`. Where only the plain reading parses, as in `mi broda joi ke brode ke'e bo brodi`, the pipeline agrees with camxes-std.
- In an operator, camxes-std reads `li ci su'i joi ke pi'i ke'e re` with a plain `joi` and the `ke` group inside the next operator. This pipeline reads `joi ke` as one connected operator.
- In a bridi tail, camxes-std never reads a plain gihek before `ke`. It agrees with this pipeline on the group reading. But where only the plain reading parses, as in `mi broda gi'e ke brode ke'e brodi`, camxes-std rejects the text and this pipeline accepts it.

[^cll-s19-16]: [CLL 1.1, section 19.16](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-cmavo-interactions.html).

[^cll-s3-12]: [CLL 1.1, section 3.12](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-oddball-orthographies.html).

[^cll-s19-13]: [CLL 1.1, section 19.13](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-erasure.html).

[^cll-e8-48]: [CLL 1.1, section 8.6, example 8.48](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-descriptors.html#c8e6d2).

[^cll-e8-62]: [CLL 1.1, section 8.7, example 8.62](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-possessive-sumti.html#c8e7d4).

[^cll-c4]: [CLL 1.1, chapter 4](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/chapter-morphology.html). The [versioned source](https://github.com/int19h/cll/blob/v1.1-2016-08-26-html/chapters/04.xml) supplies the edition comparison.

[^cll-s4-9]: [CLL 1.1, section 4.9, rule 6](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-pauses.html). The [versioned source](https://github.com/int19h/cll/blob/v1.1-2016-08-26-html/chapters/04.xml#L2115-L2117) states the pause requirement.

[^cll-later-c4]: [CLL 1.3.4, chapter 4](https://github.com/int19h/cll/blob/v1.3.4/chapters/04.xml).

[^cll-later-s4-16]: [CLL 1.3.4, section 4.16](https://github.com/int19h/cll/blob/v1.3.4/chapters/04.xml#L6131-L6186). CLL 1.1's section of the same name proposes a different mechanism and does not teach this form.

[^cll-later-a3-1]: [CLL 1.3.4, appendix A3.1](https://github.com/int19h/cll/blob/v1.3.4/chapters/a03.xml#L3-L41). This later appendix has no CLL 1.1 counterpart.
