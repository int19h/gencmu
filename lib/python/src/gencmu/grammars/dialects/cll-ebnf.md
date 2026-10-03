# The CLL dialect, by its printed grammar

This dialect is Lojban as *The Complete Lojban Language* (CLL) describes it. The dialect reads the grammar printed in chapter 21 of the book, and the word forms of its chapters 3 and 4. A cmavo is a particle, a short structure word. A selma'o is a word class of cmavo. The dialect gives each cmavo the selma'o of the book's dictionary.

The printed grammar is normative here, with the repairs that [the CLL grammar](../syntax/cll.md) lists. Any parse that the printed grammar admits counts. The dialect accepts a text that the grammar admits. But the text must not have two readings or more once the syntax stage writes back its elided terminators. Conditions and tags in that parse read the original words, so a written-back terminator is not a written one. The option `elision-only` states this rule, and `docs/engine.md` (§7) gives it exactly.

A dialect is a pipeline of stages, defined by one pipeline document. A stage is one step of a pipeline, with its own grammar. A token is one unit that a stage reads or emits. Each stage reads the tokens that the stage before it emitted.

`docs/notation.md` explains the notation. A feature is a named switch that the grammars test. This dialect turns on the feature `cll-cyrillic`.

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

The stage receives the text's characters and hands on one token per phoneme, whatever the script, and a `PAUSE` wherever the text pauses. It reads the orthography of CLL chapter 3 and no more. A digit, an accent or a question mark is foreign to the stage. So the word stage rejects a text with one, except in a foreign quote, such as `zoi`, or after `fa'o`. A run of letters is one stretch until a pause says otherwise. So the stage is greedy: it ends each constituent as late as the grammar allows.

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

The stage receives phonemes. A run is a stretch with no internal pause. The stage hands on the source words of each run. It gives each word a tag for its class and, for a cmavo, a tag for its selma'o. A tag marks a token by name, phoneme or character.

If a run divides into no words, the stage hands the run on as one unread token. The word forms divide a run into words in at most one way, so the choice among parses never decides where a word ends.

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

The stage receives the source words and hands on the words of the text. It rejects an unread run, except in a foreign quote or after `fa'o`. For the magic words, the stage is lazy: it ends each constituent as early as the grammar allows. So each magic word acts on what exists when the stage reads it.

The warning `y-cmavo` reports a cmavo that uses `y` as a vowel beyond the forms that CLL gives, such as `ka'y`. The feature `sa-su` controls `sa` and `su`. The libraries turn this feature on for a text only when the text needs it.

## Stage 4: indicators

```jbogenbau
%stage indicators
```

- [Indicators and ba'e](../indicators/cll.md)
  ```jbogenbau
  %include "../indicators/cll.md"
  ```

The stage applies CLL's non-formal rule `word = [BAhE] any-word [indicators]`. A run of indicators attaches to the word before it, and `ba'e` attaches to the word after it. The syntax reads the indicators at the start of a text and after a text opener. A text opener is a word of LU or TO, such as `lu` or `to'i`. At those places, only `ba'e` attaches. The stage hands on the words that the syntax reads.

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
%ambiguity-resolution late-elision elision-only
```

The stage ranks with `late-elision`. It compares only where two parses elide terminators. At the first place where they differ, the parse that reads on wins. So an elided terminator is absent for as long as the grammar allows. A terminator can be elided wherever a parse of the whole text needs it. Two parses that elide the same terminators at the same places are tied, and a tie is an error.

With `elision-only`, the stage checks the parse that the ranking chose. The check runs only after the verdict `resolved`, where the ranking chose one parse among several. It does not run after the verdict `unique`, and a tie fails before it. The check writes the chosen parse's elided terminators back into the text and parses that text again, with each terminator written back or written. The text is an error if the restored text has two readings or more. The check passes where the restored text has one reading. The chosen parse is always one of its readings, so the check tests that the chosen completion has no other. It does not test every other way to write the terminators back. [The notation document](../../docs/notation.md) explains the ranking and the check, under "Ambiguity", and `docs/engine.md` (§7) gives the check exactly.

`late-elision` and `elision-only` together are an interpretation of note 10 of CLL 21.2, which says that a terminator "may be omitted (without change of meaning) if no grammatical ambiguity results". They are chosen to fit CLL's conventions. The note does not specify them. It does not say which parse a text has when the grammar allows more than one, which `late-elision` decides. It does not say how to find that no ambiguity results, which `elision-only` decides by checking one chosen completion.

Under this policy, `le nanmu joi le ninmu cu klama` parses, although CLL 14.14 says that the text needs its first `ku`. "Choosing among parses" in [the CLL grammar](../syntax/cll.md) lists the other passages of CLL that this policy overrides. `le lojbo se farvi le loglo gi'enai mintu ja dunli le logla` also parses, and its description ends before `se farvi`. Where the printed grammar is ambiguous in anything but a terminator, the text is an error that shows both readings.

The CLL grammar settles two such ambiguities with conditions, as the official parser does. `mi broda joi ke brode ke'e` is a `ke` group joined to `broda` by `joi`. The printed grammar also reads `joi` before a tanru unit (a part of a compound predicate) that begins with `ke`. The rules `plain-joik-jek` and `joik-before-ke` of the CLL grammar remove that second reading. Where only the plain reading parses, as in `mi broda joi ke brode ke'e bo brodi`, the dialect keeps it, as the printed grammar does.

In the same way, `mi broda gi'e ke brode ke'e` is a `ke` group of bridi-tails after `gi'e`, as CLL 14.10 and 14.18 describe. The printed grammar also reads a plain `gi'e` before a bridi-tail whose selbri begins with `ke`, and the ranking ties or takes that reading. The condition of the rule `bridi-tail-1-final` of the CLL grammar removes it. Where only the plain reading parses, as in `mi broda gi'e ke brode ke'e brodi`, the dialect keeps it.
