# The CLL pipeline, by its printed grammar

This pipeline reads Lojban as *The Complete Lojban Language* (CLL) describes it. The pipeline reads the printed CLL grammar[^cll-c21] and its word forms.[^cll-c3][^cll-c4] A cmavo is a particle, a short structure word. A selma'o is a word class of cmavo. The pipeline gives each cmavo the selma'o of the book's dictionary.

A token is one unit that a stage reads or emits. A token's value is the string that exact comparisons read. Its image is the string that people see. A tag marks a token by an identifier.

A pipeline document defines an ordered sequence of stages. A stage is one step of a pipeline, with its own grammar. Each stage reads the tokens that the stage before it emitted.

The printed grammar is normative here, with the repairs that [the CLL grammar](syntax.md) lists. The pipeline accepts a text that the repaired grammar admits, subject to the ranking and the `elision-only` check of [Stage 5](#stage-5-syntax).

`docs/notation.md` explains the notation. A feature is a named switch that the grammars test. This pipeline turns on `cll-cyrillic` and `su-boundary`.

```jbogenbau
%features cll-cyrillic su-boundary
```

## Stage 1: phonemes

```jbogenbau
%stage phonemes
```

- [The Latin orthography of CLL](latin.md): the letters, stress, apostrophe, comma and pauses of CLL[^cll-c3], and the frame of the stage
  ```jbogenbau
  %include "latin.md"
  ```
- [The Cyrillic orthography of CLL](cyrillic.md): the Cyrillic letters of CLL[^cll-s3-12], which the feature `cll-cyrillic` turns on
  ```jbogenbau
  %include "cyrillic.md"
  ```

The stage receives the text's characters and hands on one token per phoneme, whatever the script, and a `PAUSE` wherever the text pauses. It reads the orthography of CLL[^cll-c3], with the [phoneme choices](latin.md#choices-beyond-cll). A digit, an accent or a question mark is foreign to the stage. So the words stage rejects a text with one, except in a foreign quote, such as `zoi`, or after `fa'o`. A run of letters is one stretch until a pause says otherwise. So the stage is greedy: it ends each constituent as late as the grammar allows.

The feature `cll-cyrillic`, which the pipeline turns on, reads the Cyrillic of CLL[^cll-s3-12]. With the feature off, the stage reads no Cyrillic.

## Stage 2: forms

```jbogenbau
%stage forms
```

- [Word forms](../common/forms.md): the runs of the text, and the words of each run
  ```jbogenbau
  %include "../common/forms.md"
  ```
- [Word shapes](shapes.md): the sounds of CLL's words: consonant pairs, vowels, diphthongs and stress
  ```jbogenbau
  %include "shapes.md"
  ```
- [CLL word forms](morphology.md): the particles (cmavo), root words (gismu), compounds (lujvo), borrowings and names of CLL[^cll-c3][^cll-c4]
  ```jbogenbau
  %include "morphology.md"
  ```
- [The CLL lexicon](lexicon.md): each cmavo's selma'o
  ```jbogenbau
  %include "lexicon.md"
  ```

The stage receives the phoneme values, images and tags. A run is a stretch with no internal pause. The stage hands on the source words of each run. It gives each word a tag for its class and, for a cmavo, a tag for its selma'o.

If a run divides into no words, the stage hands the run on as one foreign token. The word forms divide a run into words in at most one way, so the choice among parses never decides where a word ends.

## Stage 3: words

```jbogenbau
%stage words
```

- [The word stream](../common/stream.md): the magic words, which act on the stream left to right. They are quotes, `bu` and `zei` compounds, the erasers `si`, `sa` and `su`, hesitation and `fa'o`
  ```jbogenbau
  %include "../common/stream.md"
  ```
- [The CLL word stream](stream.md): the warning for a cmavo that uses `y` as a vowel
  ```jbogenbau
  %include "stream.md"
  ```

The stage receives the source words and hands on the words of the text. It rejects a foreign run, except in a foreign quote or after `fa'o`. For the magic words, the stage is lazy: it ends each constituent as early as the grammar allows. So each magic word acts on what exists when the stage reads it.

A cmavo such as `ka'y` uses `y` as a vowel beyond the forms that CLL gives. The warning feature `y-cmavo` is off by default. With that feature on, the stage reports one warning for each such word that it reads as Lojban.

The feature `sa-su` controls `sa` and `su`. The words stage enables it when any input token has class SA or SU.

## Stage 4: indicators

```jbogenbau
%stage indicators
```

- [Indicators and ba'e](indicators.md)
  ```jbogenbau
  %include "indicators.md"
  ```

The stage applies CLL's non-formal rule `word = [BAhE] any-word [indicators]`. It extends that rule with runs of BAhE and several FUhE groups ([Earlier stages](syntax.md#earlier-stages)). Indicators attach to the preceding word, and `ba'e` attaches to the following word.

Indicators after `lu` begin quoted content. Those after `to`, `to'i` and `tu'e` attach to the opener. A quoted text starts like a whole text, with initial names or indicators, but not both.

## Stage 5: syntax

```jbogenbau
%stage syntax
```

- [The CLL grammar](syntax.md)
  ```jbogenbau
  %include "syntax.md"
  ```

The stage uses the printed CLL 1.1 grammar[^cll-c21], with selma'o as its terminals. The grammar's [simple tense-modals](syntax.md#tenses-and-modals) are the forms of `simple-tense-modal`. Their `leftmost-longest` flag prefers the earliest group, then the longest one at that start. This pipeline chooses among the remaining parses here:

```jbogenbau
%ambiguity-resolution late-elision elision-only
```

A terminator is a closing word. Elision leaves it unwritten. A derivation is one complete grammatical reading. An admitted reading survives ranked filtering.

A best reading has no better admitted competitor. `unique` means there is one admitted reading. `resolved` means several admitted readings have one best reading.

Among parses with equal flagged groups, `late-elision` prefers the parse that omits a terminator later. An elided terminator can end its constituent at any point that a complete parse of the whole text allows. [The notation document](../../../docs/notation.md#elided-terminators) defines this search. Numbers and letter strings cannot split before a continuation unit. The CLL grammar states that rule separately, under "Numbers, lerfu strings and mekso". Equal flagged groups and equal elision counts at every position leave a tie, which is an error.

`elision-only` tests the chosen parse after `resolved`, or after `unique` when its tree holds an elided node. A tie fails before the check.

The check restores that parse's omitted terminators and parses the restored text with the rule flag, without an elision preference. The check fails when filtering excludes the restored chosen derivation, or when that derivation is not the only best admitted reading of the written-back text. Conditions and tags still read the original words. [The notation document](../../../docs/notation.md#elided-terminators) and `docs/engine.md` (§7) give the check exactly.

`le lojbo se farvi le loglo gi'enai mintu ja dunli le logla` parses, and its description ends before `se farvi`. If terminators, the grammar's flag, and grammar conditions leave an ambiguity unresolved, the text is an error that shows both readings.

A tanru is a compound predicate. A tanru unit is one part of a tanru. A bridi-tail is a predicate with its following terms. The CLL grammar settles two connective ambiguities with a ranked choice and a condition. `mi broda joi ke brode ke'e` is a `ke` group joined to `broda` by `joi`.

The printed grammar also reads `joi` before a tanru unit that begins with `ke`. The ranked choice in `selbri-4` of the CLL grammar removes that second reading. Where only the plain reading parses, as in `mi broda joi ke brode ke'e bo brodi`, the pipeline keeps it, as the printed grammar does.

In the same way, `mi broda gi'e ke brode ke'e` is a `ke` group of bridi-tails after `gi'e`, as CLL[^cll-s14-10][^cll-s14-18] describes. The printed grammar also reads a plain `gi'e` before a bridi-tail that is one `ke` group. `late-elision` ties the two readings or prefers the plain one. The condition of the rule `bridi-tail-1-final` of the CLL grammar removes it. Where only the plain reading parses, as in `mi broda gi'e ke brode ke'e brodi`, the pipeline keeps it.

## Differences from CLL and the official parser

The stage documents compare [Latin](latin.md#choices-beyond-cll), [Cyrillic](cyrillic.md#choices-beyond-cll), [forms](../common/forms.md#differences-from-camxes), [word forms](morphology.md#where-the-book-leaves-a-choice), [lexicon](lexicon.md#differences-from-the-cll-dictionary), [shared word processing](../common/stream.md#departures-from-cll-magic-words-and-the-reference-parsers), [CLL word processing](stream.md#differences-from-cll-and-bpfk), [indicators](indicators.md#differences-from-cll-and-camxes-std), and [syntax](syntax.md#differences-from-the-printed-cll-grammar) with their sources.

The enabled `su-boundary` feature makes SU stop at the last surviving NIhO, LU, TUhE, or TO word. That word survives, as in camxes-std. Later LIhU, TOI, and TUhU do not cancel an earlier boundary. With the feature off, SU erases the whole text before it. Magic Words and camxes-std supply the boundaries.

A stop at an open LU or TO agrees with CLL's subordinate texts, as the [word stream](../common/stream.md#cll-and-magic-words) explains. A closed LU or TO is one that a later LIhU or TOI closed. A stop at a closed LU or TO departs from CLL[^cll-s19-13] under any reading. So does every NIhO and TUhE stop.

[gencmu's Cyrillic](../common/cyrillic.md) assigns different values to some letters from CLL. This pipeline therefore selects only CLL's Cyrillic. A caller can turn it off with the `cll-cyrillic` feature.

This pipeline reads neither the Loglan-compatible orthography nor Tengwar from CLL[^cll-s3-12]. CLL calls the former nonstandard and unused.

The [indicator document](indicators.md#quotation-boundaries) defines quotation and parenthesis boundaries. Its [source comparison](indicators.md#quotation-and-parenthesis-boundaries) explains CLL and the official parser.

`late-elision` and `elision-only` together interpret note 10 of CLL[^cll-s21-1]. That note permits an omitted terminator when no grammatical ambiguity results.

The pipeline chooses `late-elision` and `elision-only` to fit CLL's conventions. Note 10 does not specify them. It does not say which parse a text has when the grammar allows more than one. Nor does it say how to find that no ambiguity results. `elision-only` tests one completion, as described above. "Elision policy and CLL advice" in [the CLL grammar](syntax.md#elision-policy-and-cll-advice) separates terminator advice, parser limitations, and boundaries that the whole text forces.

Under this policy, `le nanmu joi le ninmu cu klama` parses with KU elided at the boundary that CLL[^cll-s14-14] intends. CLL describes the official parser's failed left-to-right reading. "Elision policy and CLL advice" in [the CLL grammar](syntax.md#elision-policy-and-cll-advice) explains the same kind of forced boundary in the examples[^cll-e8-48][^cll-e8-62]. CLL describes their merged readings without naming the official parser. CLL 1.1 section 8.6[^cll-e8-48] calls the omitted `ku'o` in `le poi blabi gerku cu klama` ungrammatical. This pipeline accepts the text because the merged reading cannot complete the outer description under the printed rules.

[^cll-s19-13]: [CLL 1.1, section 19.13](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-erasure.html).

[^cll-s3-12]: [CLL 1.1, section 3.12](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-oddball-orthographies.html).

[^cll-s21-1]: [CLL 1.1, section 21.1](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/chapter-grammars.html#section-EBNF).

[^cll-s14-14]: [CLL 1.1, section 14.14](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-non-logical-connectives.html).

[^cll-s14-10]: [CLL 1.1, section 14.10](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-multiple-compound-bridi.html).

[^cll-s14-18]: [CLL 1.1, section 14.18](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-sumtcita.html).

[^cll-e8-48]: [CLL 1.1, section 8.6, example 8.48](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-descriptors.html#c8e6d2).

[^cll-e8-62]: [CLL 1.1, section 8.7, example 8.62](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-possessive-sumti.html#c8e7d4).

[^cll-c21]: [CLL 1.1, chapter 21](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/chapter-grammars.html).

[^cll-c3]: [CLL 1.1, chapter 3](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/chapter-phonology.html).

[^cll-c4]: [CLL 1.1, chapter 4](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/chapter-morphology.html).
