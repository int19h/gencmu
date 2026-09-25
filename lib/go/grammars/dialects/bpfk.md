# The approved word forms <?features su-boundary?>

The CLL dialect with the word-form grammar the definition effort approved, appendix A2 of the 1.3 editions of *The Complete Lojban Language*, in place of chapter 4's. [`../words/bpfk.md`](../words/bpfk.md) lists how the two differ. Its syntax is the CLL grammar, read as the PEG grammars that the definition effort adopted read elided terminators ([`../syntax/bpfk.md`](../syntax/bpfk.md)); every other stage is the [cll-ebnf](cll-ebnf.md) dialect's. It turns on the feature `su-boundary`, so that `su` erases back to the last `ni'o`, `no'i`, `lu`, `tu'e` or `to`, as the Magic Words proposal and camxes-std have it, rather than the whole text, as CLL 19.13 does.

## Stage 1: phonemes <?stage phonemes?>

- [Latin orthography](../phonemes/latin.md) <?grammar?>
- [Cyrillic orthography](../phonemes/cyrillic.md) <?grammar?>
- [zbalermorna](../phonemes/zbalermorna.md) <?grammar?>

## Stage 2: words <?stage words?>

- [The word stream](../words/stream.md) <?grammar?>
- [Word shapes](../words/shapes.md) <?grammar?>
- [Approved word forms](../words/bpfk.md) <?grammar?>
- [The CLL lexicon](../words/lexicon-cll.md) <?grammar?>

## Stage 3: indicators <?stage indicators?>

- [Indicators and ba'e](../indicators/cll.md) <?grammar?>

## Stage 4: syntax <?stage syntax?>

- [The CLL grammar](../syntax/cll.md) <?grammar?>
- [The approved grammar's readings](../syntax/bpfk.md) <?grammar?>
