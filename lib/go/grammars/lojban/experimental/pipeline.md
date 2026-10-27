# The experimental dialect

This dialect extends the Lojban of *The Complete Lojban Language* (CLL) with additional sentence forms and particles. A selbri is the predicate of a sentence. A sumti is an argument of a predicate. A cmavo is a particle, a short structure word. Examples of such constructs are `cu` before a bare selbri, connected sumti with `je`, and the experimental cmavo.

A token is one unit that a stage reads or emits. A token's value is the string that exact comparisons read. Its image is the string that people see.

A layer is a document that changes earlier rules. The syntax layer follows camxes-exp, the experimental grammar of the camxes parser. [`syntax.md`](syntax.md) explains its additions to CLL.

A dialect is a pipeline of stages, defined by one pipeline document. A stage is one step of a pipeline, with its own grammar. The phoneme stage is that of the bpfk dialect, with the conventions of `latin-experimental.md` and `cyrillic-experimental.md`. The forms stage reads the working word forms of the BPFK, the Lojban language planning committee ([`../bpfk/morphology.md`](../bpfk/morphology.md)). A selma'o is a word class of cmavo. A lexicon gives the experimental cmavo their selma'o.

A rafsi is a word form used inside compounds. An extended rafsi uses a whole or shortened word before a y-hyphen inside a compound. The forms stage also reads [`morphology.md`](morphology.md), which permits the consonant pair `mz` and changes extended rafsi. The indicator stage starts with the cll-ebnf dialect's stage ([`../cll/pipeline.md`](../cll/pipeline.md)). The experimental layer adds bare NAI indicators and keeps flat attachment.

A feature is a named switch that the grammars test. The dialect turns on `su-boundary`. That feature makes SU stop at the last surviving word of NIhO, LU, LUhEI, TUhE or TO.

The dialect turns on two syntax features. `cbm` is the cmevla-brivla merger, which lets a name word (cmevla) also act as a predicate word (brivla). `soi-clause` makes `soi` a term that takes a subsentence, in place of CLL's free modifier of reciprocity. A caller (the program or person that asks for a parse) can turn either off to read the CLL form.

```jbogenbau
%features cbm soi-clause su-boundary
```

## Stage 1: phonemes

```jbogenbau
%stage phonemes
```

- [The Latin orthography of CLL](../cll/latin.md)
  ```jbogenbau
  %include "../cll/latin.md"
  ```
- [Latin conventions](../common/latin.md): punctuation, capital runs, accents and digits
  ```jbogenbau
  %include "../common/latin.md"
  ```
- [Experimental Latin conventions](latin.md): genuine punctuation, quotation marks, marks, glide letters, krulermorna and the dieresis
  ```jbogenbau
  %include "latin.md"
  ```
- [Cyrillic orthography](../common/cyrillic.md): gencmu's Cyrillic, the default
  ```jbogenbau
  %include "../common/cyrillic.md"
  ```
- [The Cyrillic orthography of CLL](../cll/cyrillic.md): the Cyrillic of CLL[^cll-s3-12], which a caller chooses with the feature `cll-cyrillic`
  ```jbogenbau
  %include "../cll/cyrillic.md"
  ```
- [Experimental Cyrillic conventions](cyrillic.md): marks on the letters of both Cyrillic orthographies
  ```jbogenbau
  %include "cyrillic.md"
  ```
- [zbalermorna](../common/zbalermorna.md)
  ```jbogenbau
  %include "../common/zbalermorna.md"
  ```

## Stage 2: forms

```jbogenbau
%stage forms
```

- [Word forms](../common/forms.md)
  ```jbogenbau
  %include "../common/forms.md"
  ```
- [BPFK word forms](../bpfk/morphology.md)
  ```jbogenbau
  %include "../bpfk/morphology.md"
  ```
- [Experimental word forms](morphology.md)
  ```jbogenbau
  %include "morphology.md"
  ```
- [The experimental lexicon](lexicon.md)
  ```jbogenbau
  %include "lexicon.md"
  ```

## Stage 3: words

```jbogenbau
%stage words
```

- [The word stream](../common/stream.md)
  ```jbogenbau
  %include "../common/stream.md"
  ```
- [Experimental word operations and warnings](stream.md)
  ```jbogenbau
  %include "stream.md"
  ```
- [Replacement quotes](../common/lohai.md): `lo'ai ... le'ai` as one unit of raw words
  ```jbogenbau
  %include "../common/lohai.md"
  ```

## Stage 4: indicators

```jbogenbau
%stage indicators
```

- [Indicators and ba'e](../cll/indicators.md)
  ```jbogenbau
  %include "../cll/indicators.md"
  ```
- [The experimental indicators](indicators.md): a bare `nai` is an indicator
  ```jbogenbau
  %include "indicators.md"
  ```

## Stage 5: syntax

```jbogenbau
%stage syntax
```

- [The CLL grammar](../cll/syntax.md)
  ```jbogenbau
  %include "../cll/syntax.md"
  ```
- [The experimental grammar](syntax.md): what camxes-exp changes in it
  ```jbogenbau
  %include "syntax.md"
  ```

A bridi-tail is a predicate with its following terms.

A span is a range between input token boundaries.

A ranked choice orders alternatives at one written position. An earlier option can exclude a later option over the same span. The [notation document](../../../docs/notation.md#ranked-choices) defines when this occurs. `leftmost-longest` prefers the reading whose flagged rules start earliest and run longest. `fewest` next prefers fewer links built by `bridi-tail-connective` and `gi-stag-connective` across the whole reading. `late-elision` ranks the remaining readings.

The `free` rule prefers the earliest, longest modifier among complete readings. A longer modifier that cannot complete the text excludes nothing.

The dialect does not declare `elision-only`. That rule allows an elided terminator only where no ambiguity results.

The grammar has ambiguities that are not about terminators. For example, two sumti joined by an afterthought connective are also two terms joined in the same way, as in `mi .e do klama`. Rules of the grammar settle them, and the grammar lists them.

## Where it reads texts differently from camxes-exp

### Ordered choice

camxes-exp is the baseline of this dialect, not its limit. gencmu considers every parse that its grammars allow, and a PEG (parsing expression grammar) gives up the alternatives it does not backtrack into. So the dialect accepts texts that camxes-exp rejects only because its PEG committed to a first match. An example is `sei la alis cusku`, where camxes-exp reads `la alis cusku` as one description and has no selbri left.

A PEG has ordered choice. Ordered choice keeps the first matching alternative. The alternatives have a fixed order.

A final connection is last at its grammar level.

The syntax layer preserves these camxes-exp preferences among complete readings, except where the departures below apply:

- A free modifier or a tense takes the earliest and longest span before connection ranking (`leftmost-longest`, [parse preferences](syntax.md#choosing-among-parses)).
- An ek, a jek or a joik directly after `.i` belongs to `.i` ([text and paragraphs](syntax.md#the-text-and-its-paragraphs)).
- After span ranking, `fewest` prefers fewer bridi-tail links in the whole reading ([terms](syntax.md#terms), [bridi-tails](syntax.md#sentences-and-bridi-tails)). Equal counts leave late elision to decide, which can keep the first description open. This applies to A, JA, JOI, and VUhU. A sumti connection also takes priority over a term connection. Term connections include terms marked with `fe` or `pu`, and bare `na ku` terms.
- A `be` group attaches to the preceding tanru unit ([selbri and tanru](syntax.md#selbri-and-tanru)).
- A final bridi-tail connective owns a following `ke` group, with or without an intervening tag. A bare `gi` with a tag also owns its following `ke` group ([sentences and bridi-tails](syntax.md#sentences-and-bridi-tails)).
- Without written BOI, a number consumes every following number part or letter word. A letter string consumes every following letter word or PA ([numbers and mekso](syntax.md#numbers-lerfu-strings-and-mekso)).
- A subscript after another subscript nests ([free modifiers](syntax.md#free-modifiers-vocatives-and-indicators)).

The `leftmost-longest` flag on `free` settles a free modifier's span before the `fewest` ranking. An omitted terminator therefore closes as late as the text allows. In `mi viska to do klama le zarci`, `le zarci` stays inside the parenthesis.

In `mi nelci le nu broda to brodi .e le nu brode melbi`, this layer keeps `brodi .e le nu brode melbi` inside the parenthesis. The experimental syntax permits `.e` between bridi-tails, as its [connection departures](syntax.md#bridi-tail-connections) explain. The `free` rule's span preference selects the later close. camxes-exp instead closes after `brodi`, and `.e` joins the two outer descriptions. The CLL grammar also closes before `.e`, which cannot connect its bridi-tails.

camxes-exp's PEG greedily reads `le nu brode melbi` as a description inside the parenthesis. That leaves no selbri for the second bridi-tail. camxes-exp does not backtrack into that completed description, so the inner connection fails. This layer also considers a description that ends before `melbi` and keeps the parenthesis open.

Written TOI closes the parenthesis in `mi nelci le nu broda to brodi toi .e le nu brode melbi`. The `.e` then joins the two outer descriptions in both grammars.

Two related readings depart from camxes-exp. With a free modifier between `gi'e` and `ke`, camxes-exp takes the plain connection. This layer still gives the group to the connective, as in `mi broda gi'e to do toi ke ge brode gi brodi ke'e`.

camxes-exp also splits a run that mixes digits and letters, as in `li pa by`, while this layer reads it as one operand.

The syntax document's [closing section](syntax.md#differences-from-cll-and-camxes-exp) gives the complete list of departures and their reasons. Bare NA and tag terms use its explicit [KU omission limits](syntax.md#deliberate-ku-omission-limits). A query is a parse requested by a condition. The syntax document states each query's boundary conditions.

The `leftmost-longest` preference includes vocatives, but it compares only readings that pass the grammar's conditions.

### Explicit grammar differences

The PA class includes `ro'oi` beside `su'oi`. camxes-exp omits `ro'oi`, so it rejects `ro'oi broda`. This dialect reads it as a quantified description.

A nucleus is the vowel center of a syllable. A glide is an `i` or `u` before a nucleus. camxes-exp adds `!glide` to its `glide` rule. No nucleus after a glide begins with another glide, so this lookahead changes no parse. The forms stage keeps the BPFK rule without it.

The dialect also accepts four constructs by choice, which camxes-exp rejects. A stag is a tense or modal inside a connective. In a sentence's own terms, camxes-exp requires a stag between a connective and `bo` (`abs_term_2`). This grammar retains camxes-exp's two levels of terms but does not require that stag, so `fa mi .e bo fe do klama` parses here.

In `fa mi .e bo fe do .a fi mi klama`, one connected term precedes `klama`. Within that term, `bo` binds tighter than `.a`.

The grammar also allows the two branches of a bare forethought termset to hold different numbers of terms, as CLL's termset with `nu'i` does. camxes-exp's `gek_termset` pairs the terms of its branches one to one. So `ge mi do gi ti klama` parses here, and camxes-exp rejects it.

A bare forethought termset can close with `nu'u`, as in `ge mi gi do nu'u klama`. That closer also permits a nested first termset in `nu'i ge mi gi do nu'u ti nu'u`. camxes-exp gives a bare forethought termset no closer and rejects both texts.

A NOhOI clause can also close with `ku'o`, as in `mi klama no'oi bajra ku'o`. camxes-exp closes it only with `ku'oi` and rejects that text.

After `vu'o`, a connected sumti can follow without relative clauses here. So `mi viska ko'a vu'o .e ko'e` joins two sumti after `vu'o`. camxes-exp takes a connected sumti there only after relative clauses, so it joins two terms.

### Preferred readings

The examples below compare this layer's explicit preferences with camxes-exp. Some agree with its ordered choice, and others differ. The syntax document names each rule and its reason.

In `lo broda noi brode no'oi brodi ku'o do cu klama`, `do` belongs to the open NOI clause after `ku'o` closes NOhOI. camxes-exp closes NOI there and puts `do` in the main bridi. The pair `ku'oi ku'o` closes both clauses and gives `do` to the main bridi here too. The [NOhOI closers](syntax.md#nohoi-closers) section gives both readings and their reason.

`la djonz. cu na'e pamoi cusku` has `na'e` on the selbri `pa moi`. camxes-exp reads the number `na'e pa` before `moi`, since its `mex MOI` form comes first.

In `mi nelci le su'u delno .enai le su'u stero delno`, `.enai` joins the two descriptions, as in camxes-exp. This reading avoids a bridi-tail link inside the first abstraction. The `fewest` flag selects it before late elision.

In `lo ka smuni .e fe lo ka pemci cu melbi`, `.e` joins terms before the main selbri `melbi`. camxes-exp instead keeps the connection inside the first abstraction and reads the text as a bare sumti. The written `cu` marks the main bridi, so this layer prefers the reading with a main bridi. The inner reading puts `cu` inside an abstraction.

In `mi djica lo nu do klama .e lo nu do citka .e lo plise cu cpacu`, the competing readings each have one bridi-tail link. Late elision keeps the first description open. The first `.e` links going to getting, while the second joins the eating event and the apple. camxes-exp instead joins the two outer event descriptions.

Writing `kei ku` after `klama` chooses `mi djica lo nu do klama kei ku .e lo nu do citka .e lo plise cu cpacu`. The wanting then covers two event descriptions, for going and for eating. The getting predicate remains inside the second description.

In `mi djica lo nu do klama .e lo mlatu .e lo gerku cu citka`, the first description also stays open. The wanting covers going and eating inside one event description. The cat and dog supply connected terms for the eating predicate.

Writing `gi'e` for the first `.e` gives `mi djica lo nu do klama gi'e lo mlatu .e lo gerku cu citka`. That connective cannot join sumti or terms, so it explicitly marks a bridi-tail link. Late elision still keeps that link inside the first event description.

No preference based only on form selects the intended meaning in every text. This layer keeps the whole-reading count and leaves the other readings available through written words.

Where both readings already connect sumti, `fewest` cannot choose, and late elision keeps the inner connection. In `mi nelci lo nu mi djica gy .e lo nu do klama`, `.e` therefore joins `gy` with the second description inside the first abstraction. A writer who means the two `nu` descriptions closes the first one. For example, `mi nelci lo nu mi djica gy ku .e lo nu do klama` makes `.e` join those descriptions. The flag gives no preference between the two scopes, so late elision alone decides.

A free modifier after a subscript can belong to the subscript or to the word that the subscript marks. The dialect gives it to the word, as CLL's grammar does. So in `mi broda xi pa boi to do toi`, the parenthesis belongs to `broda`. camxes-exp gives it to the subscript.

In `ge nai abu gi no drata`, a forethought connective can connect two sumti or make a quantifier. The dialect connects the sumti `abu` and `no drata`, as CLL does. A CLL quantifier is a number or a `vei ... ve'o` group. camxes-exp reads the quantifier `ge nai abu gi no` with the selbri `drata`. Where no sumti reading remains, the dialect rejects the text, as CLL does. So it rejects `ge abu gi by broda cu klama`, which camxes-exp reads with the quantifier `ge abu gi by`.

ME takes a sumti or a mekso. A sumti excludes a mekso only when both read the same words with the same boundaries. In `me my moi`, this dialect takes a sumti, while camxes-exp takes a mekso. This dialect accepts `me my su'i pa` as a complete mekso. camxes-exp commits to a shorter sumti and rejects it.

### Quotes and indicators

A replacement quote is one unit of raw words in the words stage (`../lojban/common/lohai.md`), as in camxes-exp. A magic word is a word, such as `si`, that acts on other words. A magic word after the quote acts on all of it, as the left-to-right rule requires. Zantufa also accepts all four texts below, but its `zei` erases, so it reads the compound as `broda`. camxes-exp rejects them:

- `mi lo'ai do le'ai si klama` is `mi klama`, and camxes-exp rejects it.
- `lo'ai mi le'ai bu` is a letter word, and `lo'ai mi le'ai zei broda` a compound. camxes-exp rejects both.
- `mi lo'ai lu le'ai su klama` is `klama`, since the `lu` inside the quote is no boundary for `su`. camxes-exp rejects it.

`ba'e` is not a magic word, as the Magic Words proposal says. So the words stage removes `fa'o` and what follows it first, and `mi ba'e fa'o` leaves a `ba'e` with nothing to mark. The proposal calls that an error, and the dialect rejects it. camxes-exp accepts it.

The [indicator document](../cll/indicators.md#quotation-boundaries) defines quotation and parenthesis boundaries. Its [source comparison](../cll/indicators.md#quotation-and-parenthesis-boundaries) explains CLL and the official parser.

A quote or a parenthesis whose terminator is elided can hold a fragment of terms or a whole sentence. So `to mi klama` holds `mi` or `mi klama`. The reading with `mi` elides `vau` and `toi` after `mi`, so `late-elision` takes the sentence, as camxes-exp does.

### Erasure

The dialect also reads `sa` by a different rule. The words stage erases with `sa` left to right, as the Magic Words proposal says ([`../common/stream.md`](../common/stream.md)). A `sa` erases back to the last word of the selma'o of the word after it, or to the start of the text. camxes-exp tries to do the same inside its syntax grammar, with one `_sa` rule for each kind of construct, and it reads some texts differently:

- `mi broda le brode sa ti` is `ti`, since `mi` is the last word of KOhA before the `sa`. camxes-exp reads `mi broda ti`.
- `lo broda sa broda` is `lo broda`, and `mi broda sa brode` is `mi brode`. camxes-exp rejects both.
- The dialect rejects `mi broda gi'e klama da de di sa na gi'e prami`. No word of NA comes before the `sa`, so it erases back to the start of the text. What is left, `na gi'e prami`, is not a text. camxes-exp accepts the text.
- The dialect rejects `le le broda ku brode le broda sa sa le brodi`. The two `sa` words erase back to the second `le` before them, which leaves `le le brodi`. camxes-exp accepts the text.

### Feature choices

camxes-exp also stops SU at `ni'o`, `no'i`, `lu`, `tu'e`, `to` and `to'i`. This dialect stops SU by class: NIhO, LU, TUhE, TO, and LUhEI. Thus `la'au` and `tu'ai`, which belong to LU, also stop SU.

camxes-exp always uses the name-as-predicate merger and the SOI subsentence form. This dialect enables them by default but permits a caller to turn either off.

[^cll-s3-12]: [CLL 1.1, section 3.12](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-oddball-orthographies.html).
