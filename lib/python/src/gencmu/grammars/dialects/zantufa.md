# The Zantufa dialect

The dialect of Guskant's Zantufa 1.9999, a PEG grammar of Lojban. Zantufa restates almost every rule of camxes, the PEG grammar of the definition effort. It has no termsets and no `tense` rule, and every tense word is a modal. Free modifiers can follow any word, and a statement can take terms after it.

The dialect's policy is the experimental dialect's ([`experimental.md`](experimental.md)): Zantufa 1.9999 is the baseline of the dialect, not its limit. The dialect does not copy a rejection that comes only from a PEG committing to its first match. It settles ties as Zantufa's ordered choice does, and it follows Zantufa's explicit lookaheads.

The word forms are the approved ones ([`../words/bpfk.md`](../words/bpfk.md)) with Zantufa's changes ([`../words/zantufa.md`](../words/zantufa.md)): the pair `mz`, `ie'o` as hesitation, and the forms that `ra'oi` quotes. The lexicon gives each cmavo the selma'o that Zantufa gives it ([`../words/lexicon-zantufa.md`](../words/lexicon-zantufa.md)). So `zei` erases a word, as `si` does, `sa` is an attitudinal, and `su` erases the whole text before it. [`../words/zantufa-stream.md`](../words/zantufa-stream.md) makes the changes to the word stream that the classes alone do not.

The indicator stage is the cll-ebnf dialect's. No word of the Zantufa lexicon is an indicator, so the stage only absorbs `ba'e` and the other words of BAhE. The syntax reads the attitudinals as free modifiers.

The syntax is [`../syntax/zantufa.md`](../syntax/zantufa.md), a grammar of its own that translates Zantufa's rules one by one. It says where the dialect reads a text differently from Zantufa 1.9999.

## Stage 1: phonemes <?stage phonemes?>

- [The Latin orthography of CLL](../phonemes/latin-strict.md) <?grammar?>
- [Latin conventions](../phonemes/latin.md): punctuation, capital runs, accents and digits <?grammar?>
- [Cyrillic orthography](../phonemes/cyrillic.md): gencmu's Cyrillic, the default <?grammar?>
- [The Cyrillic orthography of CLL](../phonemes/cyrillic-cll.md): CLL 3.12's Cyrillic, which a caller chooses with the feature `cll-cyrillic` <?grammar?>
- [zbalermorna](../phonemes/zbalermorna.md) <?grammar?>

## Stage 2: forms <?stage forms?>

- [Word forms](../words/forms.md) <?grammar?>
- [Approved word forms](../words/bpfk.md) <?grammar?>
- [Zantufa word forms](../words/zantufa.md) <?grammar?>
- [The Zantufa lexicon](../words/lexicon-zantufa.md) <?grammar?>

## Stage 3: words <?stage words?>

- [The word stream](../words/stream.md) <?grammar?>
- [The Zantufa word stream](../words/zantufa-stream.md) <?grammar?>

## Stage 4: indicators <?stage indicators?>

- [Indicators and ba'e](../indicators/cll.md) <?grammar?>

## Stage 5: syntax <?stage syntax?>

- [The Zantufa grammar](../syntax/zantufa.md): Zantufa's rules <?grammar?>
