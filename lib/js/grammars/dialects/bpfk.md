# The approved word forms <?features su-boundary?>

The CLL dialect with the word-form grammar that the definition effort approved, in place of chapter 4's. The 1.3 editions of *The Complete Lojban Language* print that grammar as appendix A2. [`../words/bpfk.md`](../words/bpfk.md) translates that grammar rule by rule. It differs from chapter 4 in several ways. For example, it has the extended rafsi, which shorten a borrowing with a hyphen. It also lets a `Cy` letter word stand before another word without a pause, so `fyno` is `fy no`. CLL 4.9 rule 6 asks for a pause there. Its syntax is the CLL grammar, read as the PEG grammars that the definition effort adopted read elided terminators ([`../syntax/bpfk.md`](../syntax/bpfk.md)). Its phoneme stage reads the conventions of [`../phonemes/latin.md`](../phonemes/latin.md) beyond CLL's orthography, which the approved grammar reads too in part, and gencmu's Cyrillic and zbalermorna. Its indicator stage is the [cll-ebnf](cll-ebnf.md) dialect's. It turns on the feature `su-boundary`, so that `su` erases back to the last `ni'o`, `no'i`, `lu`, `tu'e` or `to`. The Magic Words proposal and camxes-std have it so. Under CLL 19.13, `su` erases the whole text.

## Stage 1: phonemes <?stage phonemes?>

- [The Latin orthography of CLL](../phonemes/latin-strict.md) <?grammar?>
- [Latin conventions](../phonemes/latin.md): punctuation, capital runs, accents and digits <?grammar?>
- [Cyrillic orthography](../phonemes/cyrillic.md): gencmu's Cyrillic, the default <?grammar?>
- [The Cyrillic orthography of CLL](../phonemes/cyrillic-cll.md): CLL 3.12's Cyrillic, which a caller chooses with the feature `cll-cyrillic` <?grammar?>
- [zbalermorna](../phonemes/zbalermorna.md) <?grammar?>

## Stage 2: words <?stage words?>

- [The word stream](../words/stream.md) <?grammar?>
- [Approved word forms](../words/bpfk.md) <?grammar?>
- [The CLL lexicon](../words/lexicon-cll.md) <?grammar?>

## Stage 3: indicators <?stage indicators?>

- [Indicators and ba'e](../indicators/cll.md) <?grammar?>

## Stage 4: syntax <?stage syntax?>

- [The CLL grammar](../syntax/cll.md) <?grammar?>
- [The approved grammar's readings](../syntax/bpfk.md) <?grammar?>
