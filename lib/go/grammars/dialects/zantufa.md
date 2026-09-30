# The Zantufa dialect

This is the dialect of Guskant's Zantufa 1.9999, a PEG grammar of Lojban. A PEG commits to the first matching alternative. Zantufa restates almost every rule of camxes, the PEG grammar of the definition effort. It has no termsets and no `tense` rule, and most tense words are modals. Free modifiers can follow any word, and a statement can take terms after it.

The dialect's policy is the experimental dialect's ([`experimental.md`](experimental.md)): Zantufa 1.9999 is the baseline of the dialect, not its limit. The dialect does not copy a rejection that comes only from a PEG committing to its first match. A tie has more than one winning reading. The dialect settles ties as Zantufa's ordered choice (the fixed order in which a PEG tries alternatives) does. It follows Zantufa's explicit lookaheads (tests of the words that follow).

A dialect is a pipeline of stages, defined by one pipeline document. A stage is one step of a pipeline, with its own grammar. The word forms are the approved ones ([`../words/bpfk.md`](../words/bpfk.md)) with Zantufa's changes ([`../words/zantufa.md`](../words/zantufa.md)): the pair `mz`, `ie'o` as hesitation, and the forms that `ra'oi` quotes. A cmavo is a particle, a short structure word. A selma'o is a word class of cmavo. The lexicon gives each cmavo the selma'o that Zantufa gives it ([`../words/lexicon-zantufa.md`](../words/lexicon-zantufa.md)).

So `zei` erases a word, as `si` does. `sa` is an attitudinal, and `su` erases the whole text before it. [`../words/zantufa-stream.md`](../words/zantufa-stream.md) makes the changes to the word stream that the classes alone do not.

The indicator stage is the cll-ebnf dialect's. No word of the Zantufa lexicon is an indicator, so the stage attaches no indicators. It attaches only `ba'e` and the other words of BAhE, to the word after them. The syntax reads the attitudinals as free modifiers.

The syntax is [`../syntax/zantufa.md`](../syntax/zantufa.md), a grammar of its own that translates Zantufa's rules one by one. It says where the dialect reads a text differently from Zantufa 1.9999.

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
- [Zantufa word forms](../words/zantufa.md)
  ```jbogenbau
  %include "../words/zantufa.md"
  ```
- [The Zantufa lexicon](../words/lexicon-zantufa.md)
  ```jbogenbau
  %include "../words/lexicon-zantufa.md"
  ```

## Stage 3: words

```jbogenbau
%stage words
```

- [The word stream](../words/stream.md)
  ```jbogenbau
  %include "../words/stream.md"
  ```
- [Replacement quotes](../words/lohai.md): `lo'ai ... le'ai` as one unit of raw words
  ```jbogenbau
  %include "../words/lohai.md"
  ```
- [The Zantufa word stream](../words/zantufa-stream.md)
  ```jbogenbau
  %include "../words/zantufa-stream.md"
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

- [The Zantufa grammar](../syntax/zantufa.md): Zantufa's rules
  ```jbogenbau
  %include "../syntax/zantufa.md"
  ```
