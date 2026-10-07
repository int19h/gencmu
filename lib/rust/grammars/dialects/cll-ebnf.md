# The CLL dialect, by its printed grammar

This dialect is Lojban as *The Complete Lojban Language* (CLL) describes it. The dialect reads the grammar printed in CLL 1.1 chapter 21, and the word forms of its chapters 3 and 4. A cmavo is a particle, a short structure word. A selma'o is a word class of cmavo. The dialect gives each cmavo the selma'o of the book's dictionary.

The printed grammar is normative here, with the repairs that [the CLL grammar](../syntax/cll.md) lists. The dialect accepts a text that the repaired grammar admits, subject to ["Stage 5: syntax"](#stage-5-syntax). When ranking selects one of several parses, `elision-only` restores that parse's omitted terminators and parses the restored text again. Another reading of the restored text that the grammar does not rank below that parse makes the original text an error.

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

The stage applies CLL's non-formal rule `word = [BAhE] any-word [indicators]`. Indicators attach to the preceding word, and `ba'e` attaches to the following word.

CLL 1.1 section 21.2 writes `LU text`, whose initial indicators modify what follows under the text-initial exception of CLL 13.9. Indicators after `lu` therefore begin quoted content. CLL 19.12 example 19.67 gives `sa'a` scope over the whole bracketed remark. The BPFK is a Lojban committee for language definitions. The [BPFK section "Digressives", revision 111784](https://mw.lojban.org/index.php?title=BPFK_Section:_Digressives&oldid=111784) defines `to'i` as "Equivalent to {to sa'a}". These sources support attachment after `to` and `to'i` to the opener.

The [indicator document](../indicators/cll.md#quotation-boundaries) explains why quotes need this boundary and how the official parser differs. A quoted text takes the same start as a whole text. CLL 1.1 section 21.2 permits initial names or indicators, but not both.

## Stage 5: syntax

```jbogenbau
%stage syntax
```

- [The CLL grammar](../syntax/cll.md)
  ```jbogenbau
  %include "../syntax/cll.md"
  ```

The stage uses the grammar of CLL 1.1 chapter 21, with selma'o as its terminals. The grammar's [simple tense-modals](../syntax/cll.md#tenses-and-modals) are the forms of `simple-tense-modal`. Their `leftmost-longest` flag prefers the earliest group, then the longest one at that start. This dialect chooses among the remaining parses here:

```jbogenbau
%ambiguity-resolution late-elision elision-only
```

Among parses with equal flagged groups, `late-elision` prefers the parse that omits a terminator later. A terminator can be elided wherever a complete parse needs it. Numbers and letter strings cannot split before a continuation unit. The CLL grammar states that rule separately, under "Numbers, lerfu strings and mekso". Equal flagged groups and equal elision counts at every position leave a tie, which is an error.

`elision-only` tests the parse that ranking selects after the verdict `resolved`. It does not run after `unique`, and a tie fails before it. The check restores that parse's omitted terminators and parses the restored text with the rule flag, without an elision preference. Another reading of the restored text that the flag does not rank below that parse makes the original text an error. Conditions and tags still read the original words. [The notation document](../../docs/notation.md#elided-terminators) and `docs/engine.md` (§7) give the check exactly.

`late-elision` and `elision-only` together interpret note 10 of CLL 1.1 section 21.2. That note permits an omitted terminator when no grammatical ambiguity results.

The dialect chooses `late-elision` and `elision-only` to fit CLL's conventions. Note 10 does not specify them. It does not say which parse a text has when the grammar allows more than one. Nor does it say how to find that no ambiguity results. `elision-only` tests one completion, as described above. "Choosing among parses" in [the CLL grammar](../syntax/cll.md) separates terminator advice, parser limitations, and boundaries that the whole text forces.

Under this policy, `le nanmu joi le ninmu cu klama` parses with KU elided at the boundary that CLL 14.14 intends. CLL describes the official parser's failed left-to-right reading. "Choosing among parses" in [the CLL grammar](../syntax/cll.md) explains the same kind of forced boundary in examples 8.48 and 8.62. CLL describes their merged readings without naming the official parser. The elision policy disagrees with no specific text of CLL.

`le lojbo se farvi le loglo gi'enai mintu ja dunli le logla` also parses, and its description ends before `se farvi`. If terminators, the grammar's flag, and grammar conditions leave an ambiguity unresolved, the text is an error that shows both readings.

The CLL grammar settles two ambiguities with conditions, as the official parser does. `mi broda joi ke brode ke'e` is a `ke` group joined to `broda` by `joi`. The printed grammar also reads `joi` before a tanru unit (a part of a compound predicate) that begins with `ke`. The rules `plain-joik-jek` and `joik-before-ke` of the CLL grammar remove that second reading. Where only the plain reading parses, as in `mi broda joi ke brode ke'e bo brodi`, the dialect keeps it, as the printed grammar does.

In the same way, `mi broda gi'e ke brode ke'e` is a `ke` group of bridi-tails after `gi'e`, as CLL 14.10 and 14.18 describe. The printed grammar also reads a plain `gi'e` before a bridi-tail that is one `ke` group. The ranking ties or takes that reading. The condition of the rule `bridi-tail-1-final` of the CLL grammar removes it. Where only the plain reading parses, as in `mi broda gi'e ke brode ke'e brodi`, the dialect keeps it.
