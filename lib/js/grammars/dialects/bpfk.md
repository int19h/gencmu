# CLL syntax with BPFK word forms

CLL is *The Complete Lojban Language*. The BPFK is a Lojban committee for language definitions. This dialect combines CLL syntax with the BPFK working morphology, the grammar of word forms. That morphology uses a parsing expression grammar (PEG).

[CLL 1.3.4](https://github.com/int19h/cll/blob/v1.3.4/chapters/a02.xml) prints that grammar in appendix A2. [`../words/bpfk.md`](../words/bpfk.md) translates that grammar rule by rule.

The [checkpoint record](https://mw.lojban.org/index.php?title=BPFK_Checkpoints&oldid=109606) defers morphology. The [Formal Grammar section](https://mw.lojban.org/index.php?title=BPFK_Section:_Formal_Grammar&oldid=111787) proposes replacing YACC with a PEG. [CLL 1.3.4, appendix A3.1](https://github.com/int19h/cll/blob/v1.3.4/chapters/a03.xml) keeps EBNF (Extended Backus-Naur Form) and YACC as the official syntax. It describes camxes PEG syntax as practice without ratification.

The executable baseline is `camxes.peg` at ilmentufa commit [`778ea138f7d150121ca722db7536ce3b123943ac`](https://github.com/lojban/ilmentufa/blob/778ea138f7d150121ca722db7536ce3b123943ac/camxes.peg).

A rafsi is a word form used inside compounds. A brivla is a predicate word. The working morphology has extended rafsi. One kind lets a non-borrowing brivla stand whole before `'y` inside a compound, as in `klama'ybroda`. Neither [CLL 1.1 chapter 4](https://github.com/int19h/cll/blob/v1.1-2016-08-26-html/chapters/04.xml) nor [CLL 1.3.4 chapter 4](https://github.com/int19h/cll/blob/v1.3.4/chapters/04.xml) teaches that form.

[CLL 1.3.4 section 4.16](https://github.com/int19h/cll/blob/v1.3.4/chapters/04.xml#L6131-L6186) already teaches the borrowing form, as in `spageti'ykukte`.

The working morphology also lets a `Cy` letter word stand before another word without a pause, so `fyno` is `fy no`. [CLL 1.1 section 4.9 rule 6](https://github.com/int19h/cll/blob/v1.1-2016-08-26-html/chapters/04.xml#L2115-L2117) requires a pause there.

Outside the working morphology and the project choices below, this dialect follows CLL 1.1. It uses the [Magic Words stream](../words/stream.md) and the shared CLL indicator stage. Both CLL dialects use `late-elision elision-only` for omitted terminators. Their numbers and letter strings are indivisible. The project choices below specify this dialect's erasure, elision, and connective policies.

The BPFK recorded one decision on syntax, and this dialect does not apply it. On 15 March 2016, the BPFK [ruled](https://mw.lojban.org/index.php?title=BPFK:_lo_nu_broda_ba_brode&oldid=119454) that a tag attaches to a following selbri, the predicate of a sentence, unless `ku` closes the tag. So `lo nu broda ba brode` means `lo nu broda cu ba brode`. This dialect keeps the reading of CLL 1.1, where `ba` is a term inside the `nu` clause, the abstraction: `(lo [{nu (broda ba)} brode])`. camxes-std, the reference parser of `camxes.peg`, follows the decision and puts `ba` on `brode`.

A dialect is a pipeline of stages, defined by one pipeline document. A stage is one step of a pipeline, with its own grammar. Beyond CLL's orthography, the phoneme stage reads the conventions of [`../phonemes/latin.md`](../phonemes/latin.md). The working morphology reads part of these conventions too. The phoneme stage also reads gencmu's Cyrillic and zbalermorna. The indicator stage is the indicator stage of the [cll-ebnf](cll-ebnf.md) dialect.

CLL 1.1 section 21.2 writes `LU text`, whose initial indicators modify what follows under the text-initial exception of CLL 13.9. Indicators after `lu` therefore begin quoted content. CLL 19.12 example 19.67 gives `sa'a` scope over the whole bracketed remark. The [BPFK section "Digressives", revision 111784](https://mw.lojban.org/index.php?title=BPFK_Section:_Digressives&oldid=111784) defines `to'i` as "Equivalent to {to sa'a}". These sources support attachment after `to` and `to'i` to the opener.

The [indicator document](../indicators/cll.md#quotation-boundaries) explains why quotes need this boundary and how the official parser differs. A quoted text takes the same start as a whole text. CLL 1.1 section 21.2 permits initial names or indicators, but not both.

## NAI attachment

The shared indicator stage keeps each run flat. Within a run, `nai` attaches only to the UI or CAI directly before it. BAhE can stand between them. CLL 1.1 section 19.16 separates UI and CAI from DAhO and FUhO, which do not absorb `nai`.

This dialect departs from [camxes-std](https://github.com/lojban/ilmentufa/blob/778ea138f7d150121ca722db7536ce3b123943ac/camxes.peg#L343-L1100) on NAI attachment. camxes-std lets UI and CAI clauses recursively take more indicators before their following optional NAI. Repeated NAI can therefore close successive indicator levels. The difference changes both acceptance and negation scope, in attached and leading runs.

In cll-ebnf and bpfk, `mi .e ui da'o nai do` negates `.e`. camxes-std instead negates `ui`.

In cll-ebnf and bpfk, `mi pu ui da'o nai klama` negates `pu`. camxes-std instead negates `ui`.

In cll-ebnf and bpfk, `mi ui ia nai nai klama` fails. camxes-std accepts it and gives each attitudinal its own NAI.

FUhE opens an indicator group. The [indicator document](../indicators/cll.md#indicator-runs) compares the FUhE grouping and NAI rules. The syntax reads any NAI that the indicator stage leaves outside a pair under its own rules.

A feature is a named switch that the grammars test. The dialect turns on `su-boundary`. That feature makes SU stop at the last `ni'o`, `no'i`, `lu`, `tu'e`, `to`, or `to'i`. The maintainer chooses to keep that boundary.

The Magic Words proposal names these boundaries but leaves their survival unspecified. camxes-std also stops at these boundaries. Under CLL 19.13, SU erases the whole text.

```jbogenbau
%features su-boundary
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
- [BPFK word forms](../words/bpfk.md)
  ```jbogenbau
  %include "../words/bpfk.md"
  ```
- [The CLL lexicon](../words/lexicon-cll.md)
  ```jbogenbau
  %include "../words/lexicon-cll.md"
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

## Stage 5: syntax

```jbogenbau
%stage syntax
```

- [The CLL grammar](../syntax/cll.md)
  ```jbogenbau
  %include "../syntax/cll.md"
  ```

The stage uses the [cll-ebnf ranking and check](cll-ebnf.md#stage-5-syntax). The grammar's [simple tense-modals](../syntax/cll.md#tenses-and-modals) are the forms of `simple-tense-modal`. Their `leftmost-longest` flag prefers the earliest group, then the longest one at that start. `late-elision` ranks the remaining choices, and `elision-only` runs only when ranking selects one of several parses. The check restores that parse's omitted terminators and parses the restored text again. Another reading of the restored text that the flag does not rank below that parse makes the original text an error.

```jbogenbau
%ambiguity-resolution late-elision elision-only
```

A constituent can end wherever a parse of the whole text needs it. Numbers and letter strings cannot split before a continuation unit. The CLL grammar states that rule separately, under "Numbers, lerfu strings and mekso".

CLL gives terminator advice and describes some limitations of its official parser. This policy follows the intended boundary where the whole text forces it. Where nothing forces that boundary, the policy keeps the reading that CLL warns about.

"Choosing among parses" in [the CLL grammar](../syntax/cll.md) explains the forced boundaries in examples 8.48 and 8.62. CLL describes the merged readings that a left-to-right reading of the words gives. The whole text forces the boundary where CLL writes the terminator. The elision policy disagrees with no specific text of CLL.

A PEG commits to choices before it knows whether the whole text parses. This dialect follows the whole text instead. So `le lojbo se farvi le loglo gi'enai mintu ja dunli le logla` parses with the description ending before `se farvi`.

The stage does not order the alternatives of a rule. A text that remains ambiguous after terminator restoration is an error. The CLL grammar settles two connective ambiguities with conditions. `mi broda joi ke brode ke'e` is a `ke` group joined to `broda` by `joi`. `mi broda gi'e ke brode ke'e` is a `ke` group of bridi-tails after `gi'e`.

camxes-std departs from this. It tries the plain connective first, so it reads `joi` before a tanru unit that begins with `ke`. Where only the plain reading parses, as in `mi broda joi ke brode ke'e bo brodi`, the dialect agrees with camxes-std.
