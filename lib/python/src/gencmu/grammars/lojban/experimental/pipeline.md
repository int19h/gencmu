# The experimental pipeline

This pipeline extends the Lojban of *The Complete Lojban Language* (CLL) with additional sentence forms and particles. A selbri is the predicate of a sentence. A sumti is an argument of a predicate. A cmavo is a particle, a short structure word. Examples of such constructs are `cu` before a bare selbri, connected sumti with `je`, and the experimental cmavo.

A token is one unit that a stage reads or emits. A token's value is the string that exact comparisons read. Its image is the string that people see.

A layer is a document that changes earlier rules. The syntax layer follows camxes-exp, the experimental grammar of the camxes parser. [`syntax.md`](syntax.md) explains its additions to CLL.

A pipeline document defines an ordered sequence of stages. A stage is one step of a pipeline, with its own grammar. The phoneme stage is that of the `lojban/bpfk` pipeline, with the conventions of [latin.md](latin.md) and [cyrillic.md](cyrillic.md). The forms stage reads the working word forms of the BPFK, the Lojban language planning committee ([`../bpfk/morphology.md`](../bpfk/morphology.md)). A selma'o is a word class of cmavo. A lexicon gives the experimental cmavo their selma'o.

A nucleus is the vowel, diphthong or `y` at the center of a syllable. A glide is `i` or `u` before a nucleus. CgV combines a consonant, a glide and a nucleus.

A rafsi is a word form used inside compounds. An extended rafsi uses a whole or shortened word before a y-hyphen inside a compound. The forms stage also reads [`morphology.md`](morphology.md). It permits `mz`, accepts CgV names and borrowings, changes extended rafsi, and adds the hesitation word `ie'o`.

The indicator stage starts with the lojban/cll pipeline's stage ([`../cll/pipeline.md`](../cll/pipeline.md)). The experimental layer adds bare NAI indicators and keeps flat attachment.

A feature is a named switch that the grammars test. The pipeline turns on `su-boundary`. That feature makes SU stop at the last surviving word of NIhO, LU, LUhEI, TUhE or TO.

The words stage turns on the warning code `experimental-cgv`. It reports a name or predicate word that needs the CgV extension, as in `atkuila`.

The pipeline turns on two syntax features. `cbm` is the cmevla-brivla merger, which lets a name word (cmevla) also act as a predicate word (brivla). `soi-clause` makes `soi` a term that takes a subsentence, in place of CLL's free modifier of reciprocity. A caller (the program or person that asks for a parse) can turn either off to read the CLL form.

```jbogenbau
%features cbm soi-clause su-boundary
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
- [Experimental Latin conventions](latin.md): genuine punctuation, quotation marks, marks, glide letters, krulermorna and the dieresis
  ```jbogenbau
  %include "latin.md"
  ```
- [Cyrillic orthography](../common/cyrillic.md): gencmu's Cyrillic, the default
  ```jbogenbau
  %include "../common/cyrillic.md"
  ```
- [The Cyrillic orthography of CLL](../cll/cyrillic.md): the Cyrillic of CLL[^cll-s3-12], which a caller chooses with the feature `cll-cyrillic`
  ```jbogenbau
  %include "../cll/cyrillic.md"
  ```
- [Experimental Cyrillic conventions](cyrillic.md): marks on the letters of both Cyrillic orthographies
  ```jbogenbau
  %include "cyrillic.md"
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
- [BPFK word forms](../bpfk/morphology.md)
  ```jbogenbau
  %include "../bpfk/morphology.md"
  ```
- [Experimental word forms](morphology.md)
  ```jbogenbau
  %include "morphology.md"
  ```
- [The experimental lexicon](lexicon.md)
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
- [Experimental word operations and warnings](stream.md)
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
- [The experimental indicators](indicators.md): a bare `nai` is an indicator
  ```jbogenbau
  %include "indicators.md"
  ```

## Stage 5: syntax

```jbogenbau
%stage syntax
```

- [The CLL grammar](../cll/syntax.md)
  ```jbogenbau
  %include "../cll/syntax.md"
  ```
- [The experimental grammar](syntax.md): what camxes-exp changes in it
  ```jbogenbau
  %include "syntax.md"
  ```

The syntax layer defines [parse preferences](syntax.md#parse-preferences) beside their declaration and explains [elision checks](syntax.md#differences-from-cll-and-camxes-exp).

## Where it reads texts differently from camxes-exp

### Ordered choice

camxes-exp is the baseline of this pipeline, not its limit. gencmu considers every parse that its grammars allow. A PEG (parsing expression grammar) uses ordered choice, which keeps the first matching alternative in a fixed order. The pipeline accepts texts that camxes-exp rejects because its PEG does not backtrack into a completed first match. In `sei la alis cusku`, camxes-exp reads `la alis cusku` as one description and has no selbri left.

The syntax document's [closing section](syntax.md#differences-from-cll-and-camxes-exp) gives the complete list of departures and their reasons.

The syntax layer defines [connection preferences](syntax.md#text-and-sentence-connections), [term connections](syntax.md#terms-and-descriptions) and [bridi-tail connections](syntax.md#bridi-tail-connections).

Its [tanru comparison](syntax.md#tanru-and-linked-arguments) explains linked arguments and grouping after connectives.

Its [mekso comparison](syntax.md#mekso-and-connectives) explains mixed number runs and operator grouping.

Its [free-modifier comparison](syntax.md#free-modifiers-and-subscripts) explains parenthesis boundaries and subscripts.

Bare NA and tag terms use the syntax layer's explicit [KU omission limits](syntax.md#deliberate-ku-omission-limits).

### Explicit grammar differences

The forms layer departs from camxes-exp in its word forms and hesitation. The [morphology comparison](morphology.md#differences-from-cll-bpfk-and-camxes-exp) describes the CgV extension, rafsi changes, `mz`, and `ie'o`.

The PA class includes `ro'oi` beside `su'oi`. camxes-exp omits `ro'oi`, so it rejects `ro'oi broda`. This pipeline reads it as a quantified description.

camxes-exp adds `!glide` to its `glide` rule. No nucleus after a glide begins with another glide, so this lookahead changes no parse. The forms stage keeps the BPFK rule without it.

The syntax layer's [term comparison](syntax.md#terms-and-descriptions) explains BO connections and bare forethought termsets.

Its [NOhOI comparison](syntax.md#nohoi-closers) explains the two relative-clause closers.

Its [sumti comparison](syntax.md#terms-and-descriptions) explains connections after VUhO.

### Quotes and indicators

A replacement quote is one unit of raw words in the words stage (`../common/lohai.md`), as in camxes-exp. A magic word is a word, such as `si`, that acts on other words. A magic word after the quote acts on all of it, as the left-to-right rule requires. Zantufa also accepts all four texts below, but its `zei` erases, so it reads the compound as `broda`. camxes-exp rejects them:

- `mi lo'ai do le'ai si klama` is `mi klama`, and camxes-exp rejects it.
- `lo'ai mi le'ai bu` is a letter word, and `lo'ai mi le'ai zei broda` a compound. camxes-exp rejects both.
- `mi lo'ai lu le'ai su klama` is `klama`, since the `lu` inside the quote is no boundary for `su`. camxes-exp rejects it.

`ba'e` is not a magic word, as the Magic Words proposal says. So the words stage removes `fa'o` and what follows it first, and `mi ba'e fa'o` leaves a `ba'e` with nothing to mark. The proposal calls that an error, and the pipeline rejects it. camxes-exp accepts it.

The [indicator document](../cll/indicators.md#quotation-boundaries) defines quotation and parenthesis boundaries. Its [source comparison](../cll/indicators.md#quotation-and-parenthesis-boundaries) explains CLL and the official parser.

The syntax layer defines [quote and parenthesis preferences](syntax.md#parse-preferences) for omitted terminators.

### Erasure

The pipeline also reads `sa` by a different rule. The words stage erases with `sa` left to right, as the Magic Words proposal says ([`../common/stream.md`](../common/stream.md)). A `sa` erases back to the last word of the selma'o of the word after it, or to the start of the text. camxes-exp tries to do the same inside its syntax grammar, with one `_sa` rule for each kind of construct, and it reads some texts differently:

- `mi broda le brode sa ti` is `ti`, since `mi` is the last word of KOhA before the `sa`. camxes-exp reads `mi broda ti`.
- `lo broda sa broda` is `lo broda`, and `mi broda sa brode` is `mi brode`. camxes-exp rejects both.
- The pipeline rejects `mi broda gi'e klama da de di sa na gi'e prami`. No word of NA comes before the `sa`, so it erases back to the start of the text. What is left, `na gi'e prami`, is not a text. camxes-exp accepts the text.
- The pipeline rejects `le le broda ku brode le broda sa sa le brodi`. The two `sa` words erase back to the second `le` before them, which leaves `le le brodi`. camxes-exp accepts the text.

### Feature choices

camxes-exp stops SU at its classes NIhO, LU, TUhE and TO. This pipeline adds LUhEI, and its lexicon adds `la'au` and `tu'ai` to LU. camxes-exp also erases with `li'oi`, which is UI here.

camxes-exp always uses the name-as-predicate merger and the SOI subsentence form. This pipeline enables them by default but permits a caller to turn either off.

[^cll-s3-12]: [CLL 1.1, section 3.12](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-oddball-orthographies.html).
