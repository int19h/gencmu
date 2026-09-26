# The experimental dialect <?features cbm term-hierarchy su-boundary?>

The CLL dialect with the experimental constructs that have grown up in use since CLL was printed, such as `cu` before a bare selbri, connected sumti with `je`, and the experimental cmavo. The word stage reads the approved word forms of the definition effort ([`../words/bpfk.md`](../words/bpfk.md)), with the gaps that document lists. camxes-exp, the experimental PEG grammar, reads the same word forms, and it also allows the consonant pair `mz`, which [`../words/experimental.md`](../words/experimental.md) adds. A lexicon gives the experimental cmavo their selma'o. The feature `su-boundary` is on, so that `su` erases back to the last `ni'o`, `no'i`, `lu`, `tu'e` or `to`, as camxes-exp's does. The phoneme stage is the approved word forms' ([`bpfk.md`](bpfk.md)). The indicator stage is the cll-ebnf dialect's ([`cll-ebnf.md`](cll-ebnf.md)) with a layer that reads indicators as camxes-exp does. The syntax is [`../syntax/experimental.md`](../syntax/experimental.md), which says what it adds to CLL's.

The dialect turns on two features, as camxes-exp always has them: `cbm`, the cmevla-brivla merger, and `term-hierarchy`. A caller can turn either off to read the CLL form.

## Stage 1: phonemes <?stage phonemes?>

- [The Latin orthography of CLL](../phonemes/latin-strict.md) <?grammar?>
- [Latin conventions](../phonemes/latin.md): punctuation, capital runs, accents and digits <?grammar?>
- [Cyrillic orthography](../phonemes/cyrillic.md): gencmu's Cyrillic, the default <?grammar?>
- [The Cyrillic orthography of CLL](../phonemes/cyrillic-cll.md): CLL 3.12's Cyrillic, which a caller chooses with the feature `cll-cyrillic` <?grammar?>
- [zbalermorna](../phonemes/zbalermorna.md) <?grammar?>

## Stage 2: words <?stage words?>

- [The word stream](../words/stream.md) <?grammar?>
- [Word shapes](../words/shapes.md) <?grammar?>
- [Approved word forms](../words/bpfk.md) <?grammar?>
- [Experimental word forms](../words/experimental.md) <?grammar?>
- [The experimental lexicon](../words/lexicon-experimental.md) <?grammar?>

## Stage 3: indicators <?stage indicators?>

- [Indicators and ba'e](../indicators/cll.md) <?grammar?>
- [The indicators of camxes-exp](../indicators/experimental.md): a bare `nai` is an indicator <?grammar?>

## Stage 4: syntax <?stage syntax?>

- [The CLL grammar](../syntax/cll.md) <?grammar?>
- [The experimental grammar](../syntax/experimental.md): what camxes-exp changes in it <?grammar?>

The experimental grammar is greedy like CLL's but does not declare `elision-only`: it has ambiguities that are not about terminators, such as a bare `na` term beside a negated selbri, and those are settled by the greedy rule.
