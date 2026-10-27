# The Zantufa pipeline

The pipeline follows Guskant's Zantufa 1.9999, a PEG (parsing expression grammar) of Lojban. A PEG commits to the first matching alternative. Zantufa restates almost every rule of camxes, a PEG grammar of Lojban. It has no termsets and no `tense` rule, and most tense words are modals. Free modifiers can follow almost any word, and a statement can take terms after it.

A token is one unit that a stage reads or emits. A token's value is the string that exact comparisons read. Its image is the string that people see.

A pipeline document defines an ordered sequence of stages. A stage is one step of a pipeline, with its own grammar. The word forms follow the working morphology of the BPFK, the Lojban language planning committee ([`../bpfk/morphology.md`](../bpfk/morphology.md)). Zantufa changes these forms ([`morphology.md`](morphology.md)): the pair `mz`, `ie'o` as hesitation, and the forms that `ra'oi` quotes.

A cmavo is a particle, a short structure word. A selma'o is a word class of cmavo. The lexicon gives each cmavo the selma'o that Zantufa gives it ([`lexicon.md`](lexicon.md)).

`zei` erases a word, as `si` does. An attitudinal expresses an attitude. `sa` is an attitudinal, and `su` erases the whole preceding text. Before BU binds, SU instead supplies a letter base and erases nothing. A complete quote takes priority over a bare marker. [`stream.md`](stream.md) makes the changes to the word stream that the classes alone do not.

The indicator stage is the lojban/cll pipeline's. No word of the Zantufa lexicon is an indicator, so the stage attaches no indicators. It attaches only `ba'e` and the other words of BAhE, to the word after them. The syntax reads the attitudinals as free modifiers.

Each finished quote from the words stage emits one token. BAhE before it marks the whole quote. Following attitudinals occupy the quote's free-modifier slot in syntax.

The reference is [guskant/gerna_cipra at d5a5065](https://github.com/guskant/gerna_cipra/blob/d5a5065c924304cf5e9067ee6d41b584fbe1c099/zantufa-1.9999.js.peg). Its `ZO_pre`, `LOhU_pre`, `ZOI_pre`, `GOhOI_pre`, `RAhOI_pre`, `MUhOI_pre`, and `LOhAI_pre` begin with `pre_clause`. Their `_post` rules read `post_clause`. Thus whole-quote emphasis and following attitudinals agree with the reference. The reference's greedy LOhU body reads BAhE before LEhU as quoted content. This pipeline does too.

Every leading free modifier after a word of TO occupies the opener's slot. TO includes `to`, `to'i`, `mau'e`, and `noi'i`. Every leading free modifier after a word of LU or LUhEI instead begins quoted content. LU includes `lu`, `la'au`, and `tu'ai`, and LUhEI contains `lu'ei`.

The syntax is [`syntax.md`](syntax.md), a grammar of its own that translates Zantufa's rules one by one. It says where the pipeline reads a text differently from Zantufa 1.9999.

## Stage 1: phonemes

```jbogenbau
%stage phonemes
```

- [The Latin orthography of CLL](../cll/latin.md), *The Complete Lojban Language*
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
- [BPFK word forms](../bpfk/morphology.md)
  ```jbogenbau
  %include "../bpfk/morphology.md"
  ```
- [Zantufa word forms](morphology.md)
  ```jbogenbau
  %include "morphology.md"
  ```
- [The Zantufa lexicon](lexicon.md)
  ```jbogenbau
  %include "lexicon.md"
  ```

## Stage 3: words

```jbogenbau
%stage words
```

- [The word stream](../common/stream.md)
  ```jbogenbau
  %include "../common/stream.md"
  ```
- [Replacement quotes](../common/lohai.md): `lo'ai ... le'ai` as one unit of raw words
  ```jbogenbau
  %include "../common/lohai.md"
  ```
- [The Zantufa word stream](stream.md)
  ```jbogenbau
  %include "stream.md"
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

- [The Zantufa grammar](syntax.md): Zantufa's rules
  ```jbogenbau
  %include "syntax.md"
  ```

## Differences from Zantufa and CLL

The pipeline's policy is the experimental pipeline's ([`../experimental/pipeline.md`](../experimental/pipeline.md)): Zantufa 1.9999 is the baseline of the pipeline, not its limit. The pipeline keeps the reference's choice of grammatical category wherever both readings omit the same terminators. Outside those reservations, the pipeline can accept texts that the PEG rejects through commitment.

A constituent is the text read by one rule. A pattern tests a constituent's tree. Patterns remove duplicate constructions while preserving their actual children and boundaries.

A following-input condition tests words after a constituent. These conditions reserve words after the selected constituent.

An aligned category query preserves the constituent's omitted terminators. It reserves grammatical categories at fragments, quantifiers, ME arguments, description prefixes, term-initial tags, and arguments after tense or modal runs. The competing reading that satisfies the query cannot shorten the constituent's modifiers. At description prefixes, term-initial tags and tag arguments, a competing mathematical reading can also omit KUhE inside the shared stretch. That includes a KUhE just before the constituent's own omitted KEhE.

A ranked choice filters alternatives at one written position. The MOI construction takes priority over SE and NAhE conversion. MAhO takes a mathematical expression before a predicate or argument. MOhE takes a predicate before an argument.

Late elision ranks complete readings by omitted terminators. Fewer omissions win at the first differing boundary.

The pipeline permits an unwritten TOI or SEhU to close early when a longer body prevents a complete reading. The [syntax comparison](syntax.md#early-closure) explains the three accepted departures and their written-terminator controls.

CLL[^cll-s21-1] writes `LU text`, and the text-initial exception of CLL[^cll-s13-9] gives initial indicators scope over what follows. The pipeline extends that quotation boundary to every leading free modifier and to LUhEI. The [syntax document](syntax.md#differences-from-zantufa-19999) records this departure. The [indicator document](../cll/indicators.md#quotation-boundaries) explains why quotes need this boundary. Its [closing comparison](../cll/indicators.md#differences-from-cll-and-camxes-std) describes the official parser, CLL's reference implementation.

[^cll-s3-12]: [CLL 1.1, section 3.12](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-oddball-orthographies.html).

[^cll-s21-1]: [CLL 1.1, section 21.1](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/chapter-grammars.html#section-EBNF).

[^cll-s13-9]: [CLL 1.1, section 13.9](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-scope.html).
