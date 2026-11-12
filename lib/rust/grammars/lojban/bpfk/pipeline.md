# CLL syntax with BPFK word forms

This pipeline combines syntax from *The Complete Lojban Language* (CLL) with the working word forms of the BPFK, the Lojban language planning committee. Those word forms derive from a parsing expression grammar (PEG).

[CLL 1.3.4](https://github.com/int19h/cll/blob/v1.3.4/chapters/a02.xml) prints that PEG in appendix A2. [`morphology.md`](morphology.md) derives from it and states the morphology's rules directly. Its [closing section](morphology.md#differences-from-cll-and-the-reference-peg) lists deliberate departures and their reasons.

The executable baseline is camxes-std, the standard grammar of the camxes parser: `camxes.peg` at ilmentufa commit [`778ea138f7d150121ca722db7536ce3b123943ac`](https://github.com/lojban/ilmentufa/blob/778ea138f7d150121ca722db7536ce3b123943ac/camxes.peg).

Outside the working morphology and the project choices below, this pipeline follows CLL 1.1. It uses the [Magic Words stream](../common/stream.md).

A pipeline document defines an ordered sequence of stages. A stage is one step of a pipeline, with its own grammar. Beyond CLL's orthography, the phoneme stage reads the conventions of [`../common/latin.md`](../common/latin.md). camxes-std's PEG reads some of them itself, such as digits and `h`. The [word-form document](morphology.md#differences-from-cll-and-the-reference-peg) compares them. The phoneme stage also reads gencmu's Cyrillic and zbalermorna.

## Erasure boundary

A feature is a named switch that the grammars test. The pipeline turns on `su-boundary`. That feature makes SU stop at the last surviving `ni'o`, `no'i`, `lu`, `tu'e`, `to`, or `to'i`. With the feature off, SU erases the whole text before it.

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

The word forms divide each run in one way only, so the stage's `lazy` step decides nothing. [The word forms](../common/forms.md) explain the one exception, which only the `lojban/zantufa` pipeline reads.

```jbogenbau
%ambiguity-resolution lazy
```
- [Consonant tables](../common/consonant-tables.md): the shared consonant pair tables
  ```jbogenbau
  %include "../common/consonant-tables.md"
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

This stage is the [indicator stage of `lojban/cll`](../cll/pipeline.md#stage-4-indicators).

```jbogenbau
%stage indicators
```

- [Indicators and ba'e](../cll/indicators.md)
  ```jbogenbau
  %include "../cll/indicators.md"
  ```

## Stage 5: syntax

This stage is the [syntax stage of `lojban/cll`](../cll/pipeline.md#stage-5-syntax), with the same ranking and elision check.

```jbogenbau
%stage syntax
```

- [The CLL grammar](../cll/syntax.md)
  ```jbogenbau
  %include "../cll/syntax.md"
  ```

```jbogenbau
%ambiguity-resolution
  leftmost-longest #·simple-tense-modal, late #·_<_Elided>
%elision-only
```

## Differences from CLL, BPFK proposals and camxes-std

The stage documents compare [CLL Latin](../cll/latin.md#choices-beyond-cll), [Latin](../common/latin.md#differences-from-cll-and-the-reference-peg), [CLL Cyrillic](../cll/cyrillic.md#choices-beyond-cll), [Cyrillic](../common/cyrillic.md#differences-from-cll), [zbalermorna](../common/zbalermorna.md#differences-from-cll-and-jbotci), [forms](../common/forms.md#differences-from-camxes), [word forms](morphology.md#differences-from-cll-and-the-reference-peg), [lexicon](../cll/lexicon.md#differences-from-the-cll-dictionary), [word processing](../common/stream.md#departures-from-cll-magic-words-and-the-reference-parsers), [indicators](../cll/indicators.md#differences-from-cll-and-camxes-std), and [syntax](../cll/syntax.md#differences-from-cll-and-the-official-parser) with their sources.

### Sources and word forms

The [Formal Grammar section](https://mw.lojban.org/index.php?title=BPFK_Section:_Formal_Grammar&oldid=111787) proposes replacing YACC with a PEG. CLL 1.3.4[^cll-later-a3-1] keeps EBNF (Extended Backus-Naur Form) and YACC as the official syntax. It describes camxes PEG syntax as practice without ratification.

The [word-form comparison](morphology.md#differences-from-cll-and-the-reference-peg) explains the committee votes and the differences from CLL and camxes-std. The shared forms document explains [letter words before another word](../common/forms.md#words-in-a-run).

### Syntax decisions

The BPFK recorded one decision on syntax, and this pipeline does not apply it. On 15 March 2016, the BPFK [ruled](https://mw.lojban.org/index.php?title=BPFK:_lo_nu_broda_ba_brode&oldid=119454) that a tense or modal attaches to a following selbri unless `ku` closes it. So `lo nu broda ba brode` means `lo nu broda cu ba brode`. This pipeline keeps the reading of CLL 1.1, where `ba` is a term inside the `nu` clause, the abstraction: `(lo [{nu (broda ba)} brode])`. camxes-std follows the decision and puts `ba` on `brode`.

### Shared indicators and syntax

The [indicator document](../cll/indicators.md#quotation-boundaries) defines quotation and parenthesis boundaries. Its [source comparison](../cll/indicators.md#quotation-and-parenthesis-boundaries) explains CLL and the official parser.

A tanru unit is a component of a selbri. In a tanru and in an operator, camxes-std tries the plain connective first before a `ke` group. In a bridi tail, it never reads the plain connective there. This pipeline prefers the `ke` group in all three places:

- In a tanru, camxes-std reads `joi` before a tanru unit that begins with `ke`. Where only the plain reading parses, as in `mi broda joi ke brode ke'e bo brodi`, the pipeline agrees with camxes-std.
- In an operator, camxes-std reads `li ci su'i joi ke pi'i ke'e re` with a plain `joi` and the `ke` group inside the next operator. This pipeline reads `joi ke` as one connected operator.
- In a bridi tail, camxes-std never reads a plain gihek before `ke`. It agrees with this pipeline on the group reading. But where only the plain reading parses, as in `mi broda gi'e ke brode ke'e brodi`, camxes-std rejects the text and this pipeline accepts it.

[^cll-s3-12]: [CLL 1.1, section 3.12](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-oddball-orthographies.html).

[^cll-later-a3-1]: [CLL 1.3.4, appendix A3.1](https://github.com/int19h/cll/blob/v1.3.4/chapters/a03.xml#L3-L41). This later appendix has no CLL 1.1 counterpart.
