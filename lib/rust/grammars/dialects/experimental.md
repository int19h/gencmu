# The experimental dialect

This dialect extends the Lojban of *The Complete Lojban Language* (CLL) with additional sentence forms and particles. A selbri is the predicate of a sentence. A sumti is an argument of a predicate. A cmavo is a particle, a short structure word. Examples of such constructs are `cu` before a bare selbri, connected sumti with `je`, and the experimental cmavo. camxes-exp is the experimental camxes grammar.

The syntax is [`../syntax/experimental.md`](../syntax/experimental.md), which says what it adds to CLL's.

A dialect is a pipeline of stages, defined by one pipeline document. A stage is one step of a pipeline, with its own grammar. The phoneme stage is the phoneme stage of the bpfk dialect ([`bpfk.md`](bpfk.md)). The forms stage reads the working word forms of the BPFK, a Lojban committee for language definitions ([`../words/bpfk.md`](../words/bpfk.md)). A selma'o is a word class of cmavo. A lexicon gives the experimental cmavo their selma'o.

A rafsi is a word form used inside compounds. An extended rafsi uses a whole or shortened word before a y-hyphen inside a compound. The forms stage also reads [`../words/experimental.md`](../words/experimental.md), which permits the consonant pair `mz` and changes extended rafsi. The indicator stage starts with the cll-ebnf dialect's stage ([`cll-ebnf.md`](cll-ebnf.md)). The experimental layer adds bare NAI indicators and keeps flat attachment. A layer is a document that changes earlier rules.

A feature is a named switch that the grammars test. The dialect turns on `su-boundary`. That feature makes SU stop at the last `ni'o`, `no'i`, `lu`, `tu'e`, `to`, or `to'i`.

The dialect turns on two syntax features. `cbm` is the cmevla-brivla merger, which lets a name word (cmevla) also act as a predicate word (brivla). `soi-clause` makes `soi` a term that takes a subsentence, in place of CLL's free modifier of reciprocity. A caller (the program or person that asks for a parse) can turn either off to read the CLL form.

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
- [The Cyrillic orthography of CLL](../phonemes/cyrillic-cll.md): the Cyrillic of CLL[^cll-s3-12], which a caller chooses with the feature `cll-cyrillic`
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
- [BPFK word forms](../words/bpfk.md)
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
- [The experimental indicators](../indicators/experimental.md): a bare `nai` is an indicator
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

A ranked choice orders alternatives at one written position. An earlier option completes that position when its own tests and conditions pass, and excludes later options over the same span. `leftmost-longest` prefers the reading whose flagged rules start earliest and run longest. `late-elision` then elides each terminator as late as the grammar allows.

The dialect does not declare `elision-only`. That rule allows an elided terminator only where no ambiguity results.

The grammar has ambiguities that are not about terminators. For example, two sumti joined by an afterthought connective are also two terms joined in the same way, as in `mi .e do klama`. Rules of the grammar settle them, and the grammar lists them.

## Where it reads texts differently from camxes-exp

### Ordered choice

camxes-exp is the baseline of this dialect, not its limit. gencmu considers every parse that its grammars allow, and a PEG (parsing expression grammar) gives up the alternatives it does not backtrack into. So the dialect accepts texts that camxes-exp rejects only because its PEG committed to a first match. An example is `sei la alis cusku`, where camxes-exp reads `la alis cusku` as one description and has no selbri left.

PEG commitment also changes readings of accepted texts. In `le mlatu na mu'o pinxe le ri ladru`, camxes-exp's vocative includes `pinxe`. The dialect reads a negated sentence.

A PEG has ordered choice. Ordered choice keeps the first matching alternative. The alternatives have a fixed order.

The layer follows camxes-exp's ordered choice where that choice decides what a text means. Where camxes-exp states a lookahead (a test of the words that follow), such as `!selbri` after a tag, the layer follows it. The paragraphs below list the exceptions.

### Explicit grammar differences

A nucleus is the vowel center of a syllable. A glide is an `i` or `u` before a nucleus. camxes-exp adds `!glide` to its `glide` rule. No nucleus after a glide begins with another glide, so this lookahead changes no parse. The forms stage keeps the BPFK rule without it.

The dialect also accepts two constructs by choice, which camxes-exp rejects. A stag is a tense or modal inside a connective. In a sentence's own terms, camxes-exp requires a stag between a connective and `bo` (`abs_term_2`). This grammar retains camxes-exp's two levels of terms but does not require that stag, so `fa mi .e bo fe do klama` parses here.

In `fa mi .e bo fe do .a fi mi klama`, one connected term precedes `klama`. Within that term, `bo` binds tighter than `.a`.

The grammar also allows the two branches of a bare forethought termset to hold different numbers of terms, as CLL's termset with `nu'i` does. camxes-exp's `gek_termset` pairs the terms of its branches one to one. So `ge mi do gi ti klama` parses here, and camxes-exp rejects it.

### Preferred readings

Some readings differ where camxes-exp's ordered choice picks a reading that the grammar does not prefer. This dialect follows camxes-exp where its choice decides what a text means. It keeps its own reading where camxes-exp's choice only follows from the order in which a PEG tries its rules. Two texts show this.

First, `la djonz. cu na'e pamoi cusku` has `na'e` on the selbri `pa moi`. camxes-exp reads the number `na'e pa` before `moi`, since its `mex MOI` form comes first.

Second, in `mi nelci le su'u delno .enai le su'u stero delno`, the elided terminators fall as late as the grammar allows. So `.enai` joins two bridi-tails (selbri with their terms) inside the first abstraction. camxes-exp joins the two descriptions.

Two other differences come from what the grammars allow. First, after `vu'o`, a connected sumti can follow without relative clauses here. So `mi viska ko'a vu'o .e ko'e` joins two sumti after `vu'o`. camxes-exp takes a connected sumti there only after relative clauses, so it joins two terms.

Second, camxes-exp's selbri has a form with an ek, a tag and `ke` (`.e ba ke`), which this grammar does not have yet. So camxes-exp accepts `le dakli .e ba ke bevri ke'e ku`, and the dialect rejects it. And in `mi bevri le dakli .ebake bevri le gerku`, camxes-exp reads one tanru (compound selbri) inside the description, where the dialect joins two bridi-tails.

### Quotes and indicators

A replacement quote is one unit of raw words in the word stage (`../words/lohai.md`), as in camxes-exp. A magic word is a word, such as `si`, that acts on other words. A magic word after the quote acts on all of it, as the left-to-right rule requires. Zantufa also accepts all four texts below, but its `zei` erases, so it reads the compound as `broda`. camxes-exp rejects them:

- `mi lo'ai do le'ai si klama` is `mi klama`, and camxes-exp rejects it.
- `lo'ai mi le'ai bu` is a letter word, and `lo'ai mi le'ai zei broda` a compound. camxes-exp rejects both.
- `mi lo'ai lu le'ai su klama` is `klama`, since the `lu` inside the quote is no boundary for `su`. camxes-exp rejects it.

`ba'e` is not a magic word, as the Magic Words proposal says. So the word stage removes `fa'o` and what follows it first, and `mi ba'e fa'o` leaves a `ba'e` with nothing to mark. The proposal calls that an error, and the dialect rejects it. camxes-exp accepts it.

Indicators after `to` and `to'i` attach to the opener, as camxes-exp's `TO_post` specifies. The example[^cll-e19-67] in CLL[^cll-s19-12] gives `sa'a` after `to'i` scope over the whole bracketed remark.

Indicators after `lu` begin the quoted content. CLL[^cll-s21-1] writes `LU text`, and the text-initial exception of CLL[^cll-s13-9] gives initial indicators scope over what follows. The [indicator document](../indicators/cll.md#quotation-boundaries) explains why quotes need this boundary. Its [closing comparison](../indicators/cll.md#differences-from-cll-and-camxes-std) describes the official parser.

A quote or a parenthesis whose terminator is elided can hold a fragment of terms or a whole sentence. So `to mi klama` holds `mi` or `mi klama`. The reading with `mi` elides `vau` and `toi` after `mi`, so `late-elision` takes the sentence, as camxes-exp does.

A free modifier after a subscript can belong to the subscript or to the word that the subscript marks. The dialect gives it to the word, as CLL's grammar does. So in `mi broda xi pa boi to do toi`, the parenthesis belongs to `broda`. camxes-exp gives it to the subscript.

In `ge nai abu gi no drata`, a forethought connective can connect two sumti or make a quantifier. The dialect connects the sumti `abu` and `no drata`, as CLL does. A CLL quantifier is a number or a `vei ... ve'o` group. camxes-exp reads the quantifier `ge nai abu gi no` with the selbri `drata`. Where no sumti reading remains, the dialect rejects the text, as CLL does. So it rejects `ge abu gi by broda cu klama`, which camxes-exp reads with the quantifier `ge abu gi by`.

### Erasure

The dialect also reads `sa` by a different rule. The word stage erases with `sa` left to right, as the Magic Words proposal says ([`../words/stream.md`](../words/stream.md)). A `sa` erases back to the last word of the selma'o of the word after it, or to the start of the text. camxes-exp tries to do the same inside its syntax grammar, with one `_sa` rule for each kind of construct, and it reads some texts differently:

- `mi broda le brode sa ti` is `ti`, since `mi` is the last word of KOhA before the `sa`. camxes-exp reads `mi broda ti`.
- `lo broda sa broda` is `lo broda`, and `mi broda sa brode` is `mi brode`. camxes-exp rejects both.
- The dialect rejects `mi broda gi'e klama da de di sa na gi'e prami`. No word of NA comes before the `sa`, so it erases back to the start of the text. What is left, `na gi'e prami`, is not a text. camxes-exp accepts the text.
- The dialect rejects `le le broda ku brode le broda sa sa le brodi`. The two `sa` words erase back to the second `le` before them, which leaves `le le brodi`. camxes-exp accepts the text.

The corpus is the collection of Lojban test texts. A measurement in September 2026 read its 358 texts with the word `sa` under this dialect, whatever their own dialects. The dialect accepted 215 of them that camxes-exp rejects, and it rejected 6 that camxes-exp accepts.

### Feature choices

The word forms follow camxes-exp. The indicator layer adds its bare NAI indicators. camxes-exp also stops SU at `ni'o`, `no'i`, `lu`, `tu'e`, `to` and `to'i`. This dialect keeps those boundaries by choice.

camxes-exp always uses the name-as-predicate merger and the SOI subsentence form. This dialect enables them by default but permits a caller to turn either off.

[^cll-s3-12]: [CLL 1.1, section 3.12](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-oddball-orthographies.html).

[^cll-s19-12]: [CLL 1.1, section 19.12](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-parentheses.html).

[^cll-s21-1]: [CLL 1.1, section 21.1](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/chapter-grammars.html#section-EBNF).

[^cll-s13-9]: [CLL 1.1, section 13.9](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-scope.html).

[^cll-e19-67]: [CLL 1.1, section 19.12, example 19.67](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-parentheses.html#c19e12d2).
