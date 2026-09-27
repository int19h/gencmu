# The CLL dialect, by its printed grammar <?features cll-cyrillic?>

Lojban as *The Complete Lojban Language* describes it. The dialect reads the grammar printed in its chapter 21 and the word forms of its chapters 3 and 4. It gives each cmavo the selma'o of the book's dictionary. The printed grammar is normative here, with the repairs [the CLL grammar](../syntax/cll.md) lists: any parse it admits counts, and a text is accepted when it has one reading. Each stage is a grammar over the tokens the stage before it emitted; `docs/notation.md` explains the notation.

## Stage 1: phonemes <?stage phonemes?>

- [The Latin orthography of CLL](../phonemes/latin-strict.md): the letters, stress, apostrophe, comma and pauses of CLL chapter 3, and the frame of the stage <?grammar?>
- [The Cyrillic orthography of CLL](../phonemes/cyrillic-cll.md): the Cyrillic letters of CLL 3.12, which the feature `cll-cyrillic` turns on <?grammar?>

The stage receives the text's characters and hands on one token per phoneme, whatever the script, and a `PAUSE` wherever the text pauses. It reads the orthography of CLL chapter 3 and no more. A digit, an accent or a question mark is foreign to it, so a text with one outside a quote is rejected. The feature `cll-cyrillic`, which the dialect turns on, reads the Cyrillic of CLL 3.12. gencmu's own Cyrillic is not CLL's, so this dialect does not offer it: with the feature off, it reads no Cyrillic. A run of letters is one stretch until a pause says otherwise, so the stage is greedy.

## Stage 2: forms <?stage forms?>

- [Word forms](../words/forms.md): the runs of the text, and the words of each run <?grammar?>
- [Word shapes](../words/shapes.md): the sounds of CLL's words: consonant pairs, vowels, diphthongs and stress <?grammar?>
- [CLL word forms](../words/cll.md): the cmavo, gismu, lujvo, borrowings and names of CLL chapters 3 and 4 <?grammar?>
- [The CLL lexicon](../words/lexicon-cll.md): each cmavo's selma'o <?grammar?>

The stage receives phonemes and hands on the source words of each run, each tagged with its class and, for a cmavo, its selma'o. A run that divides into no words is handed on as one foreign token. The word forms divide a run into words in at most one way, so the choice among parses never decides where a word ends.

## Stage 3: words <?stage words?>

- [The word stream](../words/stream.md): the magic words, which act on the stream left to right. They are quotes, `bu` and `zei` compounds, the erasers `si`, `sa` and `su`, hesitation and `fa'o` <?grammar?>
- [The CLL word stream](../words/cll-stream.md): the warning for a cmavo that uses `y` as a vowel <?grammar?>

The stage receives the source words and hands on the words of the text. It rejects a foreign run outside a foreign quote. The stage is lazy for the magic words: each acts on what exists when it is read. The warning `y-cmavo` reports a cmavo that uses `y` as a vowel beyond the forms CLL gives, such as `ka'y`. `sa` and `su` are behind the feature `sa-su`, which the libraries turn on for a text only when it needs it.

## Stage 4: indicators <?stage indicators?>

- [Indicators and ba'e](../indicators/cll.md) <?grammar?>

The stage applies CLL's non-formal rule `word = [BAhE] any-word [indicators]`: a run of indicators attaches to the word before it, and `ba'e` to the word after it. It hands on the words the syntax reads.

## Stage 5: syntax <?stage syntax?>

- [The CLL grammar](../syntax/cll.md) <?grammar?>
- [The printed grammar's readings](../syntax/cll-ebnf.md) <?grammar?>

The grammar of chapter 21 over selma'o. An elided terminator is absent for as long as the grammar allows, so the stage is greedy; a terminator may be elided wherever a parse of the whole text needs it; and a text still ambiguous with its terminators written back is an error, with `elision-only`.
