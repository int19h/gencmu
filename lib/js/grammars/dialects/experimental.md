# The experimental dialect

This dialect extends CLL with constructs that entered use after CLL appeared in print. Examples are `cu` before a bare selbri, connected sumti with `je`, and the experimental cmavo. The syntax is [`../syntax/experimental.md`](../syntax/experimental.md), which says what it adds to CLL's.

The phoneme stage is the phoneme stage of the approved-word-forms dialect ([`bpfk.md`](bpfk.md)). The forms stage reads the approved word forms of the definition effort ([`../words/bpfk.md`](../words/bpfk.md)). camxes-exp, the experimental PEG grammar, reads the same word forms with a few changes, such as the consonant pair `mz`, which [`../words/experimental.md`](../words/experimental.md) makes. A lexicon gives the experimental cmavo their selma'o. The feature `su-boundary` is on, so that `su` erases back to the last `ni'o`, `no'i`, `lu`, `tu'e` or `to`, as camxes-exp's does. The indicator stage is the cll-ebnf dialect's ([`cll-ebnf.md`](cll-ebnf.md)) with a layer that reads indicators as camxes-exp does.

The dialect turns on two features of the syntax, as camxes-exp always has them. `cbm` is the cmevla-brivla merger. `soi-clause` makes `soi` a term that takes a subsentence, in place of CLL's free modifier of reciprocity. A caller can turn either off to read the CLL form.

```jbogenbau
%features cbm soi-clause su-boundary
```

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
- [Experimental word forms](../words/experimental.md)
  ```jbogenbau
  %include "../words/experimental.md"
  ```
- [The experimental lexicon](../words/lexicon-experimental.md)
  ```jbogenbau
  %include "../words/lexicon-experimental.md"
  ```

## Stage 3: words

```jbogenbau
%stage words
```

- [The word stream](../words/stream.md)
  ```jbogenbau
  %include "../words/stream.md"
  ```

## Stage 4: indicators

```jbogenbau
%stage indicators
```

- [Indicators and ba'e](../indicators/cll.md)
  ```jbogenbau
  %include "../indicators/cll.md"
  ```
- [The indicators of camxes-exp](../indicators/experimental.md): a bare `nai` is an indicator
  ```jbogenbau
  %include "../indicators/experimental.md"
  ```

## Stage 5: syntax

```jbogenbau
%stage syntax
```

- [The CLL grammar](../syntax/cll.md)
  ```jbogenbau
  %include "../syntax/cll.md"
  ```
- [The experimental grammar](../syntax/experimental.md): what camxes-exp changes in it
  ```jbogenbau
  %include "../syntax/experimental.md"
  ```

The experimental grammar is greedy like CLL's, but it does not declare `elision-only`. It has ambiguities that are not about terminators, such as a bare `na` term beside a negated selbri. The greedy rule settles them.

## Where it reads texts differently from camxes-exp

camxes-exp is the baseline of this dialect, not its limit. gencmu considers every parse that its grammars allow, and a PEG gives up the alternatives it does not backtrack into. So the dialect accepts texts that camxes-exp rejects only because its PEG committed to a first match. An example is `sei la alis cusku`, where camxes-exp reads `la alis cusku` as one description and has no selbri left.

PEG commitment also changes readings of accepted texts. In `le mlatu na mu'o pinxe le ri ladru`, camxes-exp's vocative includes `pinxe`. The dialect reads a negated sentence.

The layer follows camxes-exp's ordered choice where that choice decides what a text means. Where camxes-exp states a lookahead, such as `!selbri` after a tag, the layer follows it. The exceptions, and the ties that remain, are listed below.

The dialect also accepts two constructs by choice, which camxes-exp rejects. In a sentence's own terms, camxes-exp requires a stag between a connective and `bo` (`abs_term_2`). This grammar does not, so `fa mi .e bo fe do klama` parses here, as it did before the grammar took camxes-exp's two levels of terms.

In `fa mi .e bo fe do .a fi mi klama`, one connected term precedes `klama`. Within that term, `bo` binds tighter than `.a`.

The grammar also allows the two branches of a bare forethought termset to hold different numbers of terms, as CLL's termset with `nu'i` does. camxes-exp's `gek_termset` pairs the terms of its branches one to one. So `ge mi do gi ti klama` parses here, and camxes-exp rejects it.

Some readings differ where camxes-exp's ordered choice picks a reading that the grammar does not prefer. This dialect follows camxes-exp where its choice decides what a text means. It keeps its own reading where camxes-exp's choice only follows from the order in which a PEG tries its rules:

- `la djonz. cu na'e pamoi cusku` has `na'e` on the selbri `pa moi`. camxes-exp reads the number `na'e pa` before `moi`, since its `mex MOI` form comes first.
- In `mi nelci le su'u delno .enai le su'u stero delno`, the elided terminators fall as late as the grammar allows. So `.enai` joins two bridi-tails inside the first abstraction. camxes-exp joins the two descriptions.

Two other differences come from what the grammars allow:

- After `vu'o`, a connected sumti can follow without relative clauses here. So `mi viska ko'a vu'o .e ko'e` joins two sumti after `vu'o`. camxes-exp takes a connected sumti there only after relative clauses, so it joins two terms.
- camxes-exp's selbri has a form with an ek, a tag and `ke` (`.e ba ke`), which this grammar does not have yet. So camxes-exp accepts `le dakli .e ba ke bevri ke'e ku`, and the dialect rejects it. And in `mi bevri le dakli .ebake bevri le gerku`, camxes-exp reads one tanru inside the description, where the dialect joins two bridi-tails.

The dialect cannot yet settle two kinds of text, and it reports a tie for each. A quote or a parenthesis whose terminator is elided can hold a fragment of terms or a whole sentence: `to mi klama` holds `mi` or `mi klama`. camxes-exp reads the sentence. A forethought connective before a number can connect two sumti or make a quantifier: `ge nai abu gi no drata`. camxes-exp reads the quantifier.

The dialect also reads `sa` by a different rule. The word stage erases with `sa` left to right, as the Magic Words proposal says ([`../words/stream.md`](../words/stream.md)). A `sa` erases back to the last word of the selma'o of the word after it, or to the start of the text. camxes-exp tries to do the same inside its syntax grammar, with one `_sa` rule for each kind of construct, and it reads some texts differently:

- `mi broda le brode sa ti` is `ti`, since `mi` is the last word of KOhA before the `sa`. camxes-exp reads `mi broda ti`.
- `lo broda sa broda` is `lo broda`, and `mi broda sa brode` is `mi brode`. camxes-exp rejects both.
- `mi broda gi'e klama da de di sa na gi'e prami` is rejected. No word of NA comes before the `sa`, so it erases back to the start of the text. What is left, `na gi'e prami`, is not a text. camxes-exp accepts the text.
- `le le broda ku brode le broda sa sa le brodi` is rejected. The two `sa` words erase back to the second `le` before them, which leaves `le le brodi`. camxes-exp accepts the text.

Among the corpus texts, 166 with `sa` are accepted here and rejected by camxes-exp, and 3 are rejected here and accepted by camxes-exp.
