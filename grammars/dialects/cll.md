# The CLL dialect

Lojban as *The Complete Lojban Language* describes it: the grammar printed in its chapter 21, the word forms of its chapter 4, and the selma'o its dictionary gives each cmavo. Each stage is a grammar over the tokens the stage before it emitted; `docs/notation.md` explains the notation.

## Stage 1: phonemes <?stage phonemes?>

- [Latin orthography](../phonemes/latin.md): the letters, stress, the apostrophe, digits and pauses, and the frame every script's letters join <?grammar?>
- [Cyrillic orthography](../phonemes/cyrillic.md) <?grammar?>
- [zbalermorna](../phonemes/zbalermorna.md) <?grammar?>

The stage receives the text's characters and hands on one token per phoneme, whatever the script, and a `PAUSE` wherever the text pauses. A run of letters is one stretch until a pause says otherwise, so the stage is greedy.

## Stage 2: words <?stage words?>

- [The word stream](../words/stream.md): words, and the magic words that act on the stream left to right: quotes, `bu` and `zei` compounds, the erasers `si`, `sa` and `su`, hesitation and `fa'o` <?grammar?>
- [Word shapes](../words/shapes.md): the shapes every family of word forms shares <?grammar?>
- [CLL word forms](../words/cll.md): what chapter 4 allows beyond the shared shapes <?grammar?>
- [The CLL lexicon](../words/lexicon-cll.md): each cmavo's selma'o <?grammar?>

The stage receives phonemes and hands on words, each tagged with its class and, for a cmavo, its selma'o. A word ends as early as it can, which is CLL's tosmabru rule, so the stage is lazy. `sa` and `su` are behind the feature `sa-su`, which the libraries turn on for a text only when it needs it.

## Stage 3: indicators <?stage indicators?>

- [Indicators and ba'e](../indicators/cll.md) <?grammar?>

The stage applies CLL's non-formal rule `word = [BAhE] any-word [indicators]`: a run of indicators attaches to the word before it, and `ba'e` to the word after it. It hands on the words the syntax reads.

## Stage 4: syntax <?stage syntax?>

- [The CLL grammar](../syntax/cll.md) <?grammar?>

The grammar of chapter 21 over selma'o. An elided terminator is absent for as long as the grammar allows, so the stage is greedy; and CLL's own rule, that a terminator may be elided only where no ambiguity results, is applied literally with `elision-only`.
