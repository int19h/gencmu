# The experimental dialect

This dialect extends the Lojban of *The Complete Lojban Language* (CLL) with constructs that entered use after CLL appeared in print. A selbri is the predicate of a sentence. A sumti is an argument of a predicate. A cmavo is a particle, a short structure word. Examples of such constructs are `cu` before a bare selbri, connected sumti with `je`, and the experimental cmavo. The syntax is [`../syntax/experimental.md`](../syntax/experimental.md), which says what it adds to CLL's.

A dialect is a pipeline of stages, defined by one pipeline document. A stage is one step of a pipeline, with its own grammar. The phoneme stage is the phoneme stage of the approved-word-forms dialect ([`bpfk.md`](bpfk.md)). The forms stage reads the approved word forms of the definition effort ([`../words/bpfk.md`](../words/bpfk.md)). A selma'o is a word class of cmavo. A lexicon gives the experimental cmavo their selma'o.

camxes-exp is the experimental PEG grammar. A PEG commits to the first matching alternative. camxes-exp reads the same word forms with a few changes, such as the consonant pair `mz`, which [`../words/experimental.md`](../words/experimental.md) makes. The indicator stage is the cll-ebnf dialect's ([`cll-ebnf.md`](cll-ebnf.md)) with a layer that reads indicators as camxes-exp does. A layer is a document that changes earlier rules.

A feature is a named switch that the grammars test. The dialect turns on the feature `su-boundary`, so that `su` erases back to the last `ni'o`, `no'i`, `lu`, `tu'e`, `to` or `to'i`, as camxes-exp's does.

The dialect also turns on two features of the syntax, because camxes-exp has no way to turn them off. `cbm` is the cmevla-brivla merger, which lets a name word (cmevla) also act as a predicate word (brivla). `soi-clause` makes `soi` a term that takes a subsentence, in place of CLL's free modifier of reciprocity. A caller (the program or person that asks for a parse) can turn either off to read the CLL form.

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
- [Replacement quotes](../words/lohai.md): `lo'ai ... le'ai` as one unit of raw words
  ```jbogenbau
  %include "../words/lohai.md"
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

The experimental grammar is greedy like CLL's: it ends each constituent as late as the grammar allows. But it does not declare `elision-only`, the rule that a terminator can be elided only if no ambiguity results. The grammar has ambiguities that are not about terminators. For example, two sumti joined by an afterthought connective are also two terms joined in the same way, as in `mi .e do klama`. The greedy rule settles them.

## Where it reads texts differently from camxes-exp

camxes-exp is the baseline of this dialect, not its limit. gencmu considers every parse that its grammars allow, and a PEG gives up the alternatives it does not backtrack into. So the dialect accepts texts that camxes-exp rejects only because its PEG committed to a first match. An example is `sei la alis cusku`, where camxes-exp reads `la alis cusku` as one description and has no selbri left.

PEG commitment also changes readings of accepted texts. In `le mlatu na mu'o pinxe le ri ladru`, camxes-exp's vocative includes `pinxe`. The dialect reads a negated sentence.

A PEG has ordered choice. Ordered choice keeps the first matching alternative. The alternatives have a fixed order.

The layer follows camxes-exp's ordered choice where that choice decides what a text means. Where camxes-exp states a lookahead (a test of the words that follow), such as `!selbri` after a tag, the layer follows it. The paragraphs below list the exceptions, and the ties that remain. A tie has more than one winning reading.

The dialect also accepts two constructs by choice, which camxes-exp rejects. A stag is a tense or modal inside a connective. In a sentence's own terms, camxes-exp requires a stag between a connective and `bo` (`abs_term_2`). This grammar does not, so `fa mi .e bo fe do klama` parses here, as it did before the grammar took camxes-exp's two levels of terms.

In `fa mi .e bo fe do .a fi mi klama`, one connected term precedes `klama`. Within that term, `bo` binds tighter than `.a`.

The grammar also allows the two branches of a bare forethought termset to hold different numbers of terms, as CLL's termset with `nu'i` does. camxes-exp's `gek_termset` pairs the terms of its branches one to one. So `ge mi do gi ti klama` parses here, and camxes-exp rejects it.

Some readings differ where camxes-exp's ordered choice picks a reading that the grammar does not prefer. This dialect follows camxes-exp where its choice decides what a text means. It keeps its own reading where camxes-exp's choice only follows from the order in which a PEG tries its rules. Two texts show this.

First, `la djonz. cu na'e pamoi cusku` has `na'e` on the selbri `pa moi`. camxes-exp reads the number `na'e pa` before `moi`, since its `mex MOI` form comes first.

Second, in `mi nelci le su'u delno .enai le su'u stero delno`, the elided terminators fall as late as the grammar allows. So `.enai` joins two bridi-tails (selbri with their terms) inside the first abstraction. camxes-exp joins the two descriptions.

Two other differences come from what the grammars allow. First, after `vu'o`, a connected sumti can follow without relative clauses here. So `mi viska ko'a vu'o .e ko'e` joins two sumti after `vu'o`. camxes-exp takes a connected sumti there only after relative clauses, so it joins two terms.

Second, camxes-exp's selbri has a form with an ek, a tag and `ke` (`.e ba ke`), which this grammar does not have yet. So camxes-exp accepts `le dakli .e ba ke bevri ke'e ku`, and the dialect rejects it. And in `mi bevri le dakli .ebake bevri le gerku`, camxes-exp reads one tanru (compound selbri) inside the description, where the dialect joins two bridi-tails.

A replacement quote is one unit of raw words in the word stage (`../words/lohai.md`), as in camxes-exp. A magic word is a word, such as `si`, that acts on other words. A magic word after the quote acts on all of it, as the left-to-right rule requires. Zantufa also accepts all four texts below, but its `zei` erases, so it reads the compound as `broda`. camxes-exp rejects them:

- `mi lo'ai do le'ai si klama` is `mi klama`, and camxes-exp rejects it.
- `lo'ai mi le'ai bu` is a letter word, and `lo'ai mi le'ai zei broda` a compound. camxes-exp rejects both.
- `mi lo'ai lu le'ai su klama` is `klama`, since the `lu` inside the quote is no boundary for `su`. camxes-exp rejects it.

`ba'e` is not a magic word, as the Magic Words proposal says. So the word stage removes `fa'o` and what follows it first, and `mi ba'e fa'o` leaves a `ba'e` with nothing to mark. The proposal calls that an error, and the dialect rejects it. camxes-exp accepts it.

After `to`, indicators begin the parenthesis, as they begin a quote after `lu`. So `to ui mi klama toi` holds `ui` inside the parenthesis. camxes-exp attaches `ui` to `to`, because its `TO_post` takes indicators.

The dialect cannot yet settle one kind of text, and it reports a tie for it. A quote or a parenthesis whose terminator is elided can hold a fragment of terms or a whole sentence. So `to mi klama` holds `mi` or `mi klama`. camxes-exp reads the sentence.

In `ge nai abu gi no drata`, a forethought connective can connect two sumti or make a quantifier. The dialect connects the sumti `abu` and `no drata`, as CLL does. A CLL quantifier is a number or a `vei` group. camxes-exp reads the quantifier `ge nai abu gi no` over `drata`. It does so only because its PEG tries a quantifier before a forethought connection of sumti.

After a text-leading `.i`, an ek needs a paragraph. So `i.e` and `.iji` are `.i` and a fragment, as in CLL. camxes-exp reads `.i` with a connective and no sentence after it. The dialect also rejects `.i e .i e mi klama`, as CLL does, and camxes-exp accepts it.

The dialect also reads `sa` by a different rule. The word stage erases with `sa` left to right, as the Magic Words proposal says ([`../words/stream.md`](../words/stream.md)). A `sa` erases back to the last word of the selma'o of the word after it, or to the start of the text. camxes-exp tries to do the same inside its syntax grammar, with one `_sa` rule for each kind of construct, and it reads some texts differently:

- `mi broda le brode sa ti` is `ti`, since `mi` is the last word of KOhA before the `sa`. camxes-exp reads `mi broda ti`.
- `lo broda sa broda` is `lo broda`, and `mi broda sa brode` is `mi brode`. camxes-exp rejects both.
- The dialect rejects `mi broda gi'e klama da de di sa na gi'e prami`. No word of NA comes before the `sa`, so it erases back to the start of the text. What is left, `na gi'e prami`, is not a text. camxes-exp accepts the text.
- The dialect rejects `le le broda ku brode le broda sa sa le brodi`. The two `sa` words erase back to the second `le` before them, which leaves `le le brodi`. camxes-exp accepts the text.

The corpus is the collection of Lojban test texts. A measurement in September 2026 read its 358 texts with the word `sa` under this dialect, whatever their own dialects. The dialect accepted 215 of them that camxes-exp rejects, and it rejected 6 that camxes-exp accepts.
