# The experimental dialect <?features cbm soi-clause su-boundary?>

This dialect extends CLL with constructs that entered use after CLL appeared in print. Examples are `cu` before a bare selbri, connected sumti with `je`, and the experimental cmavo. The syntax is [`../syntax/experimental.md`](../syntax/experimental.md), which says what it adds to CLL's.

The phoneme stage is the approved word forms' ([`bpfk.md`](bpfk.md)). The word stage reads the approved word forms of the definition effort ([`../words/bpfk.md`](../words/bpfk.md)). camxes-exp, the experimental PEG grammar, reads the same word forms with a few changes, such as the consonant pair `mz`, which [`../words/experimental.md`](../words/experimental.md) makes. A lexicon gives the experimental cmavo their selma'o. The feature `su-boundary` is on, so that `su` erases back to the last `ni'o`, `no'i`, `lu`, `tu'e` or `to`, as camxes-exp's does. The indicator stage is the cll-ebnf dialect's ([`cll-ebnf.md`](cll-ebnf.md)) with a layer that reads indicators as camxes-exp does.

The dialect turns on two features of the syntax, as camxes-exp always has them. `cbm` is the cmevla-brivla merger. `soi-clause` makes `soi` a term that takes a subsentence, in place of CLL's free modifier of reciprocity. A caller can turn either off to read the CLL form.

## Stage 1: phonemes <?stage phonemes?>

- [The Latin orthography of CLL](../phonemes/latin-strict.md) <?grammar?>
- [Latin conventions](../phonemes/latin.md): punctuation, capital runs, accents and digits <?grammar?>
- [Cyrillic orthography](../phonemes/cyrillic.md): gencmu's Cyrillic, the default <?grammar?>
- [The Cyrillic orthography of CLL](../phonemes/cyrillic-cll.md): CLL 3.12's Cyrillic, which a caller chooses with the feature `cll-cyrillic` <?grammar?>
- [zbalermorna](../phonemes/zbalermorna.md) <?grammar?>

## Stage 2: forms <?stage forms?>

- [Word forms](../words/forms.md) <?grammar?>
- [Approved word forms](../words/bpfk.md) <?grammar?>
- [Experimental word forms](../words/experimental.md) <?grammar?>
- [The experimental lexicon](../words/lexicon-experimental.md) <?grammar?>

## Stage 3: words <?stage words?>

- [The word stream](../words/stream.md) <?grammar?>

## Stage 4: indicators <?stage indicators?>

- [Indicators and ba'e](../indicators/cll.md) <?grammar?>
- [The indicators of camxes-exp](../indicators/experimental.md): a bare `nai` is an indicator <?grammar?>

## Stage 5: syntax <?stage syntax?>

- [The CLL grammar](../syntax/cll.md) <?grammar?>
- [The experimental grammar](../syntax/experimental.md): what camxes-exp changes in it <?grammar?>

The experimental grammar is greedy like CLL's, but it does not declare `elision-only`. It has ambiguities that are not about terminators, such as a bare `na` term beside a negated selbri. The greedy rule settles them.

## Where it reads texts differently from camxes-exp

camxes-exp is the baseline of this dialect, not its limit. gencmu considers every parse that its grammars allow, and a PEG gives up the alternatives it does not backtrack into. So the dialect accepts texts that camxes-exp rejects only because its PEG committed to a first match. An example is `sei la alis cusku`, where camxes-exp reads `la alis cusku` as one description and has no selbri left. Where the grammar has two parses of a text, the layer settles the tie as camxes-exp's ordered choice does. Where camxes-exp states a lookahead, such as `!selbri` after a tag, the layer follows it.

The dialect also accepts one construct by choice, which camxes-exp rejects. In a sentence's own terms, camxes-exp requires a stag between a connective and `bo` (`abs_term_2`). This grammar does not, so `fa mi .e bo fe do klama` parses here, as it did before the grammar took camxes-exp's two levels of terms.

When the grammar took those two levels, the feature `term-hierarchy` was removed, and one reading changed with no feature to restore it. `fa mi .e bo fe do .a fi mi klama` was two terms, `fa mi .e bo fe` and `do .a fi mi`, and it is now one connected term under the new term levels.

The dialect also reads `sa` by a different rule. The word stage erases with `sa` left to right, as the Magic Words proposal says ([`../words/stream.md`](../words/stream.md)). A `sa` erases back to the last word of the selma'o of the word after it, or to the start of the text. camxes-exp tries to do the same inside its syntax grammar, with one `_sa` rule for each kind of construct, and it reads some texts differently:

- `mi broda le brode sa ti` is `ti`, since `mi` is the last word of KOhA before the `sa`. camxes-exp reads `mi broda ti`.
- `lo broda sa broda` is `lo broda`, and `mi broda sa brode` is `mi brode`. camxes-exp rejects both.
- `mi broda gi'e klama da de di sa na gi'e prami` is rejected. No word of NA comes before the `sa`, so it erases back to the start of the text. What is left, `na gi'e prami`, is not a text. camxes-exp accepts the text.
- `le le broda ku brode le broda sa sa le brodi` is rejected. The two `sa` words erase back to the second `le` before them, which leaves `le le brodi`. camxes-exp accepts the text.

Among the corpus texts, 166 with `sa` are accepted here and rejected by camxes-exp, and 3 are rejected here and accepted by camxes-exp.
