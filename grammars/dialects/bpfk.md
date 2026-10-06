# The approved word forms

This dialect is the CLL dialect with the word-form grammar that the definition effort (the BPFK, a committee of the Lojban community) approved. That grammar replaces the grammar of chapter 4. The 1.3 editions of *The Complete Lojban Language* (CLL) print that grammar as appendix A2. [`../words/bpfk.md`](../words/bpfk.md) translates that grammar rule by rule.

The approved grammar differs from chapter 4 in several ways. A rafsi is a shortened word form used inside compounds. A brivla is a predicate word. For example, the approved grammar has the extended rafsi, which let a brivla or a borrowing stand inside a compound before a y-hyphen. It also lets a `Cy` letter word stand before another word without a pause, so `fyno` is `fy no`. CLL 4.9 rule 6 asks for a pause there.

The syntax of the dialect is the CLL grammar. Both CLL dialects use the same policy for elided terminators. Their numbers and letter strings are indivisible.

A dialect is a pipeline of stages, defined by one pipeline document. A stage is one step of a pipeline, with its own grammar. Beyond CLL's orthography, the phoneme stage reads the conventions of [`../phonemes/latin.md`](../phonemes/latin.md). The approved grammar reads part of these conventions too. The phoneme stage also reads gencmu's Cyrillic and zbalermorna. The indicator stage is the indicator stage of the [cll-ebnf](cll-ebnf.md) dialect.

CLL 21.2 writes `LU text`, whose initial indicators modify what follows under the text-initial exception of CLL 13.9. Indicators after `lu` therefore begin quoted content. CLL 19.12 example 19.67 gives `sa'a` scope over the whole bracketed remark. The BPFK section "Digressives" defines `to'i` as "Equivalent to {to sa'a}". These sources support attachment after `to` and `to'i` to the opener.

The [indicator document](../indicators/cll.md#quotation-boundaries) explains why quotes need this boundary and how the official parser differs. A quoted text takes the same start as a whole text. CLL 21.2 permits initial names or indicators, but not both.

A feature is a named switch that the grammars test. The dialect turns on `su-boundary`. That feature makes SU stop at the last `ni'o`, `no'i`, `lu`, `tu'e`, `to`, or `to'i`. The maintainer chooses to keep that boundary.

The Magic Words proposal names these boundaries but leaves their survival unspecified. camxes-std, the reference PEG (parsing expression grammar) parser, also stops at these boundaries. Under CLL 19.13, SU erases the whole text.

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
- [Approved word forms](../words/bpfk.md)
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

The CLL grammar leaves the choice among parses to each dialect that uses it. This dialect makes the choice here:

```jbogenbau
%ambiguity-resolution late-elision elision-only
```

The stage ranks with `late-elision` and applies `elision-only`, as in the cll-ebnf dialect. `late-elision` takes the parse that elides a terminator later. `elision-only` writes the elided terminators of the chosen parse back. If that text has more than one reading, the original text is an error.

A constituent can end wherever a parse of the whole text needs it. Numbers and letter strings cannot split before a continuation unit. The CLL grammar states that rule separately, under "Numbers, lerfu strings and mekso".

CLL gives terminator advice and describes some limitations of its official parser. This policy follows the intended boundary where the whole text forces it. Where nothing forces that boundary, the policy keeps the reading that CLL warns about. "Choosing among parses" in [the CLL grammar](../syntax/cll.md) explains the forced boundaries in examples 8.48 and 8.62. CLL describes the merged readings that a left-to-right reading of the words gives. The whole text forces the boundary where CLL writes the terminator. The elision policy disagrees with no specific text of CLL.

A PEG commits to choices before it knows whether the whole text parses. This dialect follows the whole text instead. So `le lojbo se farvi le loglo gi'enai mintu ja dunli le logla` parses with the description ending before `se farvi`.

The stage does not order the alternatives of a rule. A text that remains ambiguous after terminator restoration is an error. The CLL grammar settles two connective ambiguities with conditions. `mi broda joi ke brode ke'e` is a `ke` group joined to `broda` by `joi`. `mi broda gi'e ke brode ke'e` is a `ke` group of bridi-tails after `gi'e`.

camxes-std departs from this. It tries the plain connective first, so it reads `joi` before a tanru unit that begins with `ke`. Where only the plain reading parses, as in `mi broda joi ke brode ke'e bo brodi`, the dialect agrees with camxes-std.
