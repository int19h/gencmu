# Approved word forms

This document is the family part of the word stage in the [approved word forms](../dialects/bpfk.md), [experimental](../dialects/experimental.md) and [Zantufa](../dialects/zantufa.md) dialects. It gives the word-form grammar that the definition effort of the Logical Language Group approved. The 1.3 editions of *The Complete Lojban Language* print that grammar, a PEG, as appendix A2. This document is stitched in after [stream.md](stream.md) and [shapes.md](shapes.md), in place of [cll.md](cll.md). The experimental and Zantufa dialects stitch [experimental.md](experimental.md) after it.

It defines the three shapes that the stream reads, with the pause properties of the approved grammar's `post_word` as tags. It adds what the approved grammar has beyond the printed chapter 4: the extended rafsi, which shorten a borrowing with a hyphen. It adds no alternative with a glide after a consonant, since the definition effort banned the consonant-glide-vowel syllable (change log A3, approved 2014-12-27). And it refuses a name that has `n` before an affricate, as the approved grammar's letter rule for `n` does. The notation is explained in [the notation document](../../docs/notation.md).

The approved grammar reads four things this stage cannot: a digit inside a name, since the phoneme stage has already read every digit as the number word it stands for; a cmavo whose final stressed vowel is followed by a consonant cluster, which the approved grammar refuses and this grammar admits; a comma, which the phoneme stage drops for both families; and the approved grammar's `!cmavo` guard at the head of a borrowing looks past the borrowing's end, where [shapes.md](shapes.md) states the same guard over the borrowing alone.

## Cmavo

A cmavo is an onset, a consonant or a glide, followed by nuclei joined by apostrophes, or the nuclei alone; here `y` is a nucleus like any other, so `y'y`, `a'y` and the `Cy` letter words are all ordinary cmavo, and only a bare run of `y` is hesitation. A `Cy` is tagged `y-letter` and an unstressed CV cmavo `cv`: the approved grammar's `CVCy_lujvo` guard reads `bajykla` as one lujvo and not as `ba jy kla`, and the stream's join rules apply that guard through these two tags. A cmavo whose last syllable is stressed is tagged `final-stress`, and a brivla that begins with two consonants `stress-guard`: the approved grammar's `cmavo_form` refuses a stressed last nucleus followed by a consonant cluster, so `MIklama` is not `mI klama`, and the stream's join rules refuse that pair without a pause.

```jbogenbau
%rule cmavo-shape
  | $w(plain-cmavo-body) <"onset" ∪ "continued" ∪ (matches($w, final-stressed) ⟹ "final-stress")>
  | $v(plain-cmavo-body) <"onset" ∪ "continued" ∪ "cv">
  | letter-cmavo <"onset" ∪ "continued" ∪ "y-letter">
  | $n(cmavo-nuclei) word-end <"continued" ∪ (matches($n, final-stressed) ⟹ "final-stress")>
%conditions
  ¬matches($w, cv-body),
  ¬matches($w, letter-cmavo),
  matches($v, cv-body),
  phonemes($n) ∉ "y" ∪ "Y"

%rule plain-cmavo-body
  cmavo-onset cmavo-nuclei

%rule cv-body
  consonant plain-vowel

%rule word-end
  ε

%rule cmavo-onset
  consonant | glide

%rule cmavo-nuclei
  cmavo-nucleus | cmavo-nucleus /'/ cmavo-nuclei

%rule cmavo-nucleus
  free-vowel | free-diphthong | y

%rule letter-cmavo
  consonant y
```

## Brivla

A brivla with an onset may follow a word without a pause; it may be followed by one only if its stress is marked, since an unmarked brivla is stressed on the penultimate syllable before a pause, which is what the approved grammar's `stress` rule says. A vowel-initial borrowing needs a pause before it. Every brivla passes the checks of [shapes.md](shapes.md) on a whole word. The y-hyphen may be written as a capital, since the approved grammar's letter rule for `y` accepts one, and a capital `Y` does not mark stress there either.

```jbogenbau
%rule brivla-shape
  | $m(brivla-with-onset) <"onset" ∪ "continued" ∪ (matches($m, cluster-first) ⟹ "stress-guard")>
  | $u(brivla-with-onset) <"onset" ∪ (matches($u, cluster-first) ⟹ "stress-guard")>
  | $n(fuhivla-without-onset) <"continued">
  | $o(fuhivla-without-onset) <∅>
%conditions
  matches($m, stress-marked),
  ¬matches($u, stress-marked),
  matches($n, stress-marked),
  ¬matches($o, stress-marked),
  ¬matches($m, bad-joint),
  ¬matches($u, bad-joint),
  ¬matches($n, bad-joint),
  ¬matches($o, bad-joint),
  ¬matches($n, broken-word),
  ¬matches($o, broken-word)

%rule hyphen-y
  /y/ | /Y/
```

## Extended rafsi

The approved grammar lets a borrowing serve as a rafsi in two ways (A2.6). A `brivla_rafsi` is a head of at least two syllables followed by `'y`, as `klama'y` in `klama'ybroda`; a `fuhivla_rafsi` is a head of borrowing syllables followed by a consonant onset and `y`, as in `aktyiismu`. Each has a stressed form, whose last syllable before the hyphen is the stressed one, for use directly before a short final rafsi. An apostrophe may follow a y-hyphen as the onset of a vowel-initial borrowing that serves as the core, so a core may begin with it: `fuly'ismu` is the rafsi `ful`, the hyphen, and the borrowing `ismu`. The slinku'i test of CLL 4.7 applies to the head of a borrowing rafsi as to a borrowing: its tail is not a string of rafsi. The approved grammar also asks that the head itself not begin a rafsi string; here that is left to the choice among parses, since a head that is a string of rafsi is also a lujvo reading of the same letters, and the earlier close wins. The alternatives below join the shared rules for the first and later rafsi of a lujvo. The rafsi of [shapes.md](shapes.md) followed by `'y`, `hy-rafsi`, join them too. The approved grammar has no such initial rafsi, only the extended rafsi of two syllables or more that its `brivla_rafsi` reads; until this family reads those as the approved grammar does, `hy-rafsi` stands in for them, and it also admits a CVV or CCV rafsi before `'y`, as in `bai'ybroda`, which the approved grammar refuses.

```jbogenbau
%extend-rule basic-first-rafsi
  hy-rafsi

%extend-rule basic-initial-rafsi
  hy-rafsi

%rule hy-rafsi
  long-rafsi plain-vowel /'/ hyphen-y | ccv-rafsi /'/ hyphen-y | cvv-rafsi /'/ hyphen-y

%extend-rule first-rafsi
  extended-rafsi

%extend-rule initial-rafsi
  extended-rafsi

%extend-rule stressed-initial-rafsi
  stressed-extended-rafsi

%extend-rule word-initial-stressed-rafsi
  stressed-extended-rafsi

%rule extended-rafsi
  brivla-rafsi | fuhivla-rafsi

%rule stressed-extended-rafsi
  stressed-brivla-rafsi | stressed-fuhivla-rafsi

%rule brivla-rafsi
  $b(rafsi-head-syllables) /'/ y [/'/]
%conditions
  ¬matches(tail($b), rafsi-string)

%rule stressed-brivla-rafsi
  $b(rafsi-head-syllables) stressed-nucleus /'/ y
%conditions
  ¬matches(tail($b), rafsi-string)

%rule fuhivla-rafsi
  | $h(rafsi-head) consonant y [/'/]
  | $h(rafsi-head) initial-cluster y [/'/]
%conditions
  ¬matches(tail($h), rafsi-string),
  ¬matches($h, plain-rafsi-head)

%rule plain-rafsi-head
  [basic-initial-rafsi-sequence] (consonant | initial-pair) plain-vowel

%rule stressed-fuhivla-rafsi
  | $h(rafsi-head) stressed-nucleus consonant y
  | $h(rafsi-head) stressed-nucleus initial-cluster y
%conditions
  ¬matches(tail($h), rafsi-string)

%rule rafsi-head-syllables
  rafsi-head plain-nucleus

%extend-rule bare-brivla-core
  /'/ fuhivla-without-onset

%rule rafsi-head
  rafsi-head-part | rafsi-head rafsi-head-part

%rule rafsi-head-part
  | consonant plain-nucleus
  | initial-cluster plain-nucleus
  | plain-nucleus medial-consonants
  | plain-nucleus /'/
  | glide plain-nucleus
```

An extended rafsi is a shortening the regular rafsi cannot spell: its head is not a string of regular rafsi followed by the CV or CCV that begins a CVC, CVCC or CCVC rafsi, since `srimaky` in `srimakyvelvei` is `sri` and `mak` with a y-hyphen.

## Cmevla

A name is surrounded by pauses, so its shape carries neither property. Its consonant runs are held to the pair table, as [shapes.md](shapes.md) says. The letter rule of the approved grammar for `n` also refuses an affricate after it, so a name may not contain `ndj`, `ndz`, `ntc` or `nts`: `.andj.` is not a name.

```jbogenbau
%rule cmevla-shape
  $n(cmevla) <∅>
%conditions
  ¬matches($n, n-affricate-word)
```
