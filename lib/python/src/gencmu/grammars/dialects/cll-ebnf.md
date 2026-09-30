# The CLL dialect, by its printed grammar

This dialect is Lojban as *The Complete Lojban Language* (CLL) describes it. The dialect reads the grammar printed in chapter 21 of the book, and the word forms of its chapters 3 and 4. A cmavo is a particle, a short structure word. A selma'o is a word class of cmavo. The dialect gives each cmavo the selma'o of the book's dictionary.

The printed grammar is normative here, with the repairs that [the CLL grammar](../syntax/cll.md) lists. Any parse that the printed grammar admits counts. The dialect accepts a text that the grammar admits. But the text must not have two readings or more once the syntax stage writes back its elided terminators. The option `elision-only` states this rule, and `docs/engine.md` (§7) gives it exactly.

A dialect is a pipeline of stages, defined by one pipeline document. A stage is one step of a pipeline, with its own grammar. Each stage reads the tokens (units such as phonemes or words) that the stage before it emitted. `docs/notation.md` explains the notation. A feature is a named switch that the grammars test. This dialect turns on the feature `cll-cyrillic`.

```jbogenbau
%features cll-cyrillic
```

## Stage 1: phonemes

```jbogenbau
%stage phonemes
```

- [The Latin orthography of CLL](../phonemes/latin-strict.md): the letters, stress, apostrophe, comma and pauses of CLL chapter 3, and the frame of the stage
  ```jbogenbau
  %include "../phonemes/latin-strict.md"
  ```
- [The Cyrillic orthography of CLL](../phonemes/cyrillic-cll.md): the Cyrillic letters of CLL 3.12, which the feature `cll-cyrillic` turns on
  ```jbogenbau
  %include "../phonemes/cyrillic-cll.md"
  ```

The stage receives the text's characters and hands on one token per phoneme, whatever the script, and a `PAUSE` wherever the text pauses. It reads the orthography of CLL chapter 3 and no more. A digit, an accent or a question mark is foreign to the stage. So the word stage rejects a text with one, except in a quote or after `fa'o`. A run of letters is one stretch until a pause says otherwise. So the stage is greedy: it ends each constituent as late as the grammar allows.

The feature `cll-cyrillic`, which the dialect turns on, reads the Cyrillic of CLL 3.12. gencmu's own Cyrillic is not CLL's, so this dialect does not offer it. With the feature off, the stage reads no Cyrillic.

## Stage 2: forms

```jbogenbau
%stage forms
```

- [Word forms](../words/forms.md): the runs of the text, and the words of each run
  ```jbogenbau
  %include "../words/forms.md"
  ```
- [Word shapes](../words/shapes.md): the sounds of CLL's words: consonant pairs, vowels, diphthongs and stress
  ```jbogenbau
  %include "../words/shapes.md"
  ```
- [CLL word forms](../words/cll.md): the particles (cmavo), root words (gismu), compounds (lujvo), borrowings and names of CLL chapters 3 and 4
  ```jbogenbau
  %include "../words/cll.md"
  ```
- [The CLL lexicon](../words/lexicon-cll.md): each cmavo's selma'o
  ```jbogenbau
  %include "../words/lexicon-cll.md"
  ```

The stage receives phonemes. A run is a stretch with no internal pause. The stage hands on the source words of each run. It gives each word a tag (a name that the next grammar reads) for its class and, for a cmavo, a tag for its selma'o. If a run divides into no words, the stage hands the run on as one foreign token. The word forms divide a run into words in at most one way, so the choice among parses never decides where a word ends.

## Stage 3: words

```jbogenbau
%stage words
```

- [The word stream](../words/stream.md): the magic words, which act on the stream left to right. They are quotes, `bu` and `zei` compounds, the erasers `si`, `sa` and `su`, hesitation and `fa'o`
  ```jbogenbau
  %include "../words/stream.md"
  ```
- [The CLL word stream](../words/cll-stream.md): the warning for a cmavo that uses `y` as a vowel
  ```jbogenbau
  %include "../words/cll-stream.md"
  ```

The stage receives the source words and hands on the words of the text. It rejects a foreign run, except in a foreign quote or after `fa'o`. For the magic words, the stage is lazy: it ends each constituent as early as the grammar allows. So each magic word acts on what exists when the stage reads it.

The warning `y-cmavo` reports a cmavo that uses `y` as a vowel beyond the forms that CLL gives, such as `ka'y`. The feature `sa-su` controls `sa` and `su`. The libraries turn this feature on for a text only when the text needs it.

## Stage 4: indicators

```jbogenbau
%stage indicators
```

- [Indicators and ba'e](../indicators/cll.md)
  ```jbogenbau
  %include "../indicators/cll.md"
  ```

The stage applies CLL's non-formal rule `word = [BAhE] any-word [indicators]`. A run of indicators attaches to the word before it, and `ba'e` attaches to the word after it. At the start of a text and after `lu` or `to`, the syntax reads the indicators. There, only `ba'e` attaches. The stage hands on the words that the syntax reads.

## Stage 5: syntax

```jbogenbau
%stage syntax
```

- [The CLL grammar](../syntax/cll.md)
  ```jbogenbau
  %include "../syntax/cll.md"
  ```

The stage is the grammar of chapter 21, with selma'o as its terminals. The CLL grammar leaves the choice among parses to each dialect that uses it. This dialect makes the choice here:

```jbogenbau
%ambiguity-resolution greedy elision-only
```

The stage is greedy: of two parses, the one that reads the next word wins. So an elided terminator is absent for as long as the grammar allows. A terminator can be elided wherever a parse of the whole text needs it. With `elision-only`, the stage applies CLL's rule that a terminator can be elided only if no ambiguity results. So a text that is still ambiguous with its terminators written back is an error. [The notation document](../../docs/notation.md) explains both, under "Ambiguity".

So `le nanmu joi le ninmu cu klama` parses, although CLL 14.14 says that the text needs its first `ku`. `le lojbo se farvi le loglo gi'enai mintu ja dunli le logla` also parses, and its description ends before `se farvi`. Where the printed grammar is ambiguous in anything but a terminator, the text is an error that shows both readings. For example, `mi broda joi ke brode ke'e` is a `ke` group joined to `broda` by `joi`. It is also `joi` before a tanru unit (a part of a compound predicate) that begins with `ke`.
