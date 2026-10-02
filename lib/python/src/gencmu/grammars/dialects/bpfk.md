# The approved word forms

This dialect is the CLL dialect with the word-form grammar that the definition effort (the BPFK, a committee of the Lojban community) approved. That grammar replaces the grammar of chapter 4. The 1.3 editions of *The Complete Lojban Language* (CLL) print that grammar as appendix A2. [`../words/bpfk.md`](../words/bpfk.md) translates that grammar rule by rule.

The approved grammar differs from chapter 4 in several ways. A rafsi is a shortened word form used inside compounds. A brivla is a predicate word. For example, the approved grammar has the extended rafsi, which let a brivla or a borrowing stand inside a compound before a y-hyphen. It also lets a `Cy` letter word stand before another word without a pause, so `fyno` is `fy no`. CLL 4.9 rule 6 asks for a pause there.

The syntax of the dialect is the CLL grammar. The dialect reads elided terminators as the PEG grammars that the definition effort adopted read them. A PEG commits to the first matching alternative.

A dialect is a pipeline of stages, defined by one pipeline document. A stage is one step of a pipeline, with its own grammar. Beyond CLL's orthography, the phoneme stage reads the conventions of [`../phonemes/latin.md`](../phonemes/latin.md). The approved grammar reads part of these conventions too. The phoneme stage also reads gencmu's Cyrillic and zbalermorna. The indicator stage is the indicator stage of the [cll-ebnf](cll-ebnf.md) dialect.

A feature is a named switch that the grammars test. The dialect turns on the feature `su-boundary`, so that `su` erases back to the last `ni'o`, `no'i`, `lu`, `tu'e`, `to` or `to'i`. The Magic Words proposal and camxes-std (the reference PEG parser) read `su` in this way. Under CLL 19.13, `su` erases the whole text.

```jbogenbau
%features su-boundary
```

## Stage 1: phonemes

```jbogenbau
%stage phonemes
```

- [The Latin orthography of CLL](../phonemes/latin-strict.md)
  ```jbogenbau
  %include "../phonemes/latin-strict.md"
  ```
- [Latin conventions](../phonemes/latin.md): punctuation, capital runs, accents and digits
  ```jbogenbau
  %include "../phonemes/latin.md"
  ```
- [Cyrillic orthography](../phonemes/cyrillic.md): gencmu's Cyrillic, the default
  ```jbogenbau
  %include "../phonemes/cyrillic.md"
  ```
- [The Cyrillic orthography of CLL](../phonemes/cyrillic-cll.md): CLL 3.12's Cyrillic, which a caller chooses with the feature `cll-cyrillic`
  ```jbogenbau
  %include "../phonemes/cyrillic-cll.md"
  ```
- [zbalermorna](../phonemes/zbalermorna.md)
  ```jbogenbau
  %include "../phonemes/zbalermorna.md"
  ```

## Stage 2: forms

```jbogenbau
%stage forms
```

- [Word forms](../words/forms.md)
  ```jbogenbau
  %include "../words/forms.md"
  ```
- [Approved word forms](../words/bpfk.md)
  ```jbogenbau
  %include "../words/bpfk.md"
  ```
- [The CLL lexicon](../words/lexicon-cll.md)
  ```jbogenbau
  %include "../words/lexicon-cll.md"
  ```

## Stage 3: words

```jbogenbau
%stage words
```

- [The word stream](../words/stream.md)
  ```jbogenbau
  %include "../words/stream.md"
  ```

## Stage 4: indicators

```jbogenbau
%stage indicators
```

- [Indicators and ba'e](../indicators/cll.md)
  ```jbogenbau
  %include "../indicators/cll.md"
  ```

## Stage 5: syntax

```jbogenbau
%stage syntax
```

- [The CLL grammar](../syntax/cll.md)
  ```jbogenbau
  %include "../syntax/cll.md"
  ```

The CLL grammar leaves the choice among parses to each dialect that uses it. This dialect makes the choice here:

```jbogenbau
%ambiguity-resolution late-elision elision-only maximal
```

The definition effort replaced the YACC grammar of the official parser with a PEG (parsing expression grammar). The bpfk dialect reads elided terminators as the PEG grammars do, camxes-std among them. A PEG never gives back what it read. So the part of a rule before an elided terminator runs as far as the words after it can extend it.

The resolution `maximal` says that. A terminator cannot be elided where the part of its alternative just before it can be longer. So `le nanmu joi le ninmu cu klama` parses, since no `sumti-tail` longer than `nanmu` begins there. But `le lojbo se farvi le loglo gi'enai mintu ja dunli le logla` is an error, since `lojbo se farvi` is a longer `sumti-tail`.

A PEG is greedy everywhere, and `maximal` only where a terminator is elided. So `maximal` can find a longer part that a PEG never reads, one that divides the words before the terminator differently.

In `le nu da poi remna li paso nanca kei cu broda`, the tail terms of `remna` are `li paso`, and `vau` is elided before `nanca`. `maximal` forbids that, because the terms can also be `li pa` and `so nanca`. That reading splits the number `paso`, which a PEG reads whole. The design document records this, the one such text of the test corpus.

The stage also ranks with `late-elision` and applies `elision-only`, as in the cll-ebnf dialect. `late-elision` takes the parse that elides a terminator later. Unlike a PEG, the stage does not order the alternatives of a rule. So a text that the grammar leaves ambiguous in anything but a terminator is an error that shows both readings. The CLL grammar removes one such ambiguity with a condition: `mi broda joi ke brode ke'e` is a `ke` group joined by `joi`.

camxes-std departs from this. It tries the plain connective first, so it reads `joi` before a tanru unit that begins with `ke`. Where only the plain reading parses, as in `mi broda joi ke brode ke'e bo brodi`, the dialect agrees with camxes-std.
