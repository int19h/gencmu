# CLL word forms

This document is the family part of the word stage for chapter 4 of *The Complete Lojban Language* as printed, in the [CLL](../dialects/cll.md), [experimental](../dialects/experimental.md) and [Zantufa](../dialects/zantufa.md) dialects. It is stitched in after [stream.md](stream.md) and [shapes.md](shapes.md), defines the three shapes the stream reads, `cmavo-shape`, `brivla-shape` and `cmevla-shape`, with the pause properties of CLL 4.9 as tags, and adds the alternatives that CLL admits and the definition effort's grammar does not. Where this document deliberately admits what usage attests beyond the letter of the chapter, syllabic consonants and unusual consonant runs in names and borrowings, it says so. The definition effort's family is [bpfk.md](bpfk.md). The notation is explained in [the notation document](../../docs/notation.md).

## Cmavo

A cmavo is an onset, a consonant or a glide, followed by nuclei joined by apostrophes, or the nuclei alone. A cmavo with an onset may follow a word without a pause, and any cmavo may be followed by one. A vowel-initial cmavo is its nuclei alone, so no letter marks its end; `word-end` names that end, so that the choice among parses sees the cmavo close before the next letter is read: `inixli` is `i nixli`, while `audji` stays one borrowing because `dji` is no word. `y` is not among the cmavo nuclei: a consonant followed by `y` is a letter cmavo, and a run of `y` alone is hesitation; `y'y` is the letter word for the apostrophe. A `Cy` letter cmavo is tagged `cy` rather than `continued`: CLL 4.9 rule 6 lets only another `Cy` follow it directly, which is what the stream's join rules test.

```ebnf
cmavo-shape
≔ plain-cmavo-body <"onset" ∪ "continued">
| cmavo-nuclei word-end <"continued">
| y /'/ y <"continued">
| letter-cmavo <"onset" ∪ "cy"> ;

plain-cmavo-body
≔ cmavo-onset cmavo-nuclei ;

word-end
≔ ε ;

cmavo-onset
≔ consonant | glide ;

cmavo-nuclei
≔ free-nucleus | free-nucleus /'/ cmavo-nuclei ;

letter-cmavo
≔ consonant y ;
```

A lexicon spells each cmavo in phoneme tags, the apostrophe as `/'/`, and each vowel with an `any-` rule of [shapes.md](shapes.md), which matches either the plain or the stressed phoneme, since a cmavo's stress is free.

## Brivla

A brivla with an onset may follow a word without a pause; it may be followed by one only if its stress is marked, which the condition tests, since by CLL 3.9 an unmarked brivla reaches the next pause. A vowel-initial borrowing needs a pause before it.

```ebnf
brivla-shape
≔ $m(brivla-with-onset) <"onset" ∪ "continued">
| $u(brivla-with-onset) <"onset">
| $n(fuhivla-without-onset) <"continued">
| $o(fuhivla-without-onset) <∅>
: phonemes($m) ≠ lowercase(phonemes($m)), phonemes($u) = lowercase(phonemes($u)), phonemes($n) ≠ lowercase(phonemes($n)), phonemes($o) = lowercase(phonemes($o)) ;
```

## Cmevla

A name is surrounded by pauses (CLL 4.9 rule 4), so its shape carries neither property. Names carry whatever consonant runs their source has, `.tlaiv.` and `.ekstcat.` among them, so a name's runs are not held to the pair tables that brivla obey; and CLL 3.5 admits the on-glide diphthongs in names, `.atkuila.`, so a glide may follow a run.

```ebnf
cmevla-shape
≔ cmevla <∅> ;

cmevla-run
≔ consonant-run ;

cmevla-with-onset
|≔ cmevla-run glide cmevla-body ;

cmevla-consonants
|≔ cmevla-run glide ;

consonant-run
≔ consonant | consonant consonant-run ;
```

## Glides after consonants

CLL 3.5 admits a glide after a consonant or a cluster in a borrowing as well, `.atkuila`; these alternatives join the shared rules for the consonants between two nuclei.

```ebnf
medial-consonants
|≔ consonant glide
| consonant-cluster glide ;

clustered-onset
|≔ consonant-cluster glide ;

fuhivla-with-onset
|≔ initial-cluster glide fuhivla-long-body
| initial-cluster glide fuhivla-short-body ;
```

A borrowing may also open with a cluster and a glide, as in `zgiaca'a`, which usage attests.
