# Approved word forms

This document is the family part of the word stage in the [approved word forms](../dialects/bpfk.md), [experimental](../dialects/experimental.md) and [Zantufa](../dialects/zantufa.md) dialects. It gives the word-form grammar that the definition effort of the Logical Language Group approved. The 1.3 editions of *The Complete Lojban Language* print that grammar, a PEG, as appendix A2. This document is stitched in after [stream.md](stream.md) and [shapes.md](shapes.md), in place of [cll.md](cll.md). The experimental and Zantufa dialects stitch [experimental.md](experimental.md) after it.

It defines the three shapes that the stream reads, with the pause properties of the approved grammar's `post_word` as tags. It adds what the approved grammar has beyond the printed chapter 4: the extended rafsi, which shorten a borrowing with a hyphen. It adds no alternative with a glide after a consonant, since the definition effort banned the consonant-glide-vowel syllable (change log A3, approved 2014-12-27). And it refuses a name that has `n` before an affricate, as the approved grammar's letter rule for `n` does. The notation is explained in [the notation document](../../docs/notation.md).

The approved grammar reads three things that this stage does not read in the same way:

- A digit inside a name. The phoneme stage has already read every digit as the number word it stands for. So `.b1b.` is not a name, and `.dj2n.` becomes the name `djren`.
- A comma, which the phoneme stage drops for both families.
- The approved grammar's `!cmavo` guard at the head of a borrowing looks past the end of the borrowing. [shapes.md](shapes.md) states the same guard over the borrowing alone.

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

A brivla with an onset can follow a word without a pause. Another word can follow the brivla without a pause only if its stress is marked. An unmarked brivla is stressed on the penultimate syllable before a pause, as the approved grammar's `stress` rule says. A brivla that begins with a nucleus has no onset and needs a pause before it, as the approved grammar's `post_word` says. That is a vowel-initial borrowing, or a lujvo whose first rafsi is an extended rafsi that begins with a vowel, as `aiybla` does. The rule `brivla-with-onset` of [shapes.md](shapes.md) also holds such a lujvo, so `brivla-shape` tests the first letters with `onset-start`. The approved grammar's `!cmavo` guard applies to both kinds: neither can be a cmavo joined to a following word (`broken-word` in [shapes.md](shapes.md)). Every brivla passes the checks of [shapes.md](shapes.md) on a whole word.

A brivla also has no glide after a consonant anywhere, since every consonant letter of the approved grammar refuses a following glide. So `nuniispa` is not a word, although neither `nun` nor `iispa` has such a glide by itself. An `i` or `u` is a glide only before a nucleus, and an `i` or `u` before a glide is a nucleus. In `bluueta`, the second `u` is a glide before `e`. So the first `u` is a vowel, and the word is valid. `glide-start` applies this rule to a run of `i` and `u` letters. The same rule says whether a brivla begins with an onset. So `iaiybla` begins with a glide. But `uiybla` begins with the vowel `u`, since its `i` is a glide before `y`. The y-hyphen can be written as a capital, since the approved grammar's letter rule for `y` accepts one. A capital `Y` does not mark stress there either.

```jbogenbau
%rule brivla-shape
  | $m(brivla-with-onset) <"onset" ∪ "continued" ∪ (matches($m, cluster-first) ⟹ "stress-guard")>
  | $u(brivla-with-onset) <"onset" ∪ (matches($u, cluster-first) ⟹ "stress-guard")>
  | $n(brivla-without-onset) <"continued">
  | $o(brivla-without-onset) <∅>
%conditions
  matches($m, stress-marked),
  ¬matches($u, stress-marked),
  matches($n, stress-marked),
  ¬matches($o, stress-marked),
  ¬matches($m, bad-joint),
  ¬matches($u, bad-joint),
  ¬matches($n, bad-joint),
  ¬matches($o, bad-joint),
  ¬matches($m, consonant-glide),
  ¬matches($u, consonant-glide),
  ¬matches($n, consonant-glide),
  ¬matches($o, consonant-glide),
  matches($m, onset-start),
  matches($u, onset-start),
  ¬matches($n, broken-word),
  ¬matches($o, broken-word)

%rule brivla-without-onset
  | fuhivla-without-onset
  | $l(brivla-with-onset)
%conditions
  ¬matches($l, onset-start)

%rule onset-start
  consonant [any-letters] | glide-start

%rule consonant-glide
  [any-letters] consonant glide-start

%rule glide-start
  | glide-letter open-vowel [any-letters]
  | glide-letter glide-letter
  | glide-letter glide-letter (consonant | /'/) [any-letters]
  | glide-letter glide-letter glide-start

%rule glide-letter
  /i/ | /u/ | /I/ | /U/

%rule open-vowel
  /a/ | /e/ | /o/ | /A/ | /E/ | /O/ | /y/ | /Y/

%rule hyphen-y
  /y/ | /Y/
```

## Extended rafsi

The approved grammar lets a borrowing serve as a rafsi in two ways (A2.6):

- A `brivla_rafsi` is a head of at least two syllables followed by `'y`, as `klama'y` in `klama'ybroda`. A syllable is an onset, a nucleus and an optional final consonant. So `bai'ybroda`, with a head of one syllable, is not a lujvo, and neither is `paa'ybroda`, whose second syllable has no onset.
- A `fuhivla_rafsi` is a head of borrowing syllables followed by an onset and `y`. The onset is a consonant, as in `aktyiismu`, or a glide, as in `spageiybroda`.

Each has a stressed form, whose last syllable before the hyphen is the stressed one. It stands directly before a short final rafsi, as in `blanU'ybla`. The stressed borrowing rafsi can have no head at all, as `baiy` in `baiybla`, and no onset either, as `aiy` in `aiybla`. An apostrophe can follow a y-hyphen as the onset of a vowel-initial borrowing that serves as the core. So `fuly'ismu` is the rafsi `ful`, the hyphen, and the borrowing `ismu`. The slinku'i test of CLL 4.7 applies to the head of a borrowing rafsi as it applies to a borrowing. So the tail of the head is not a string of rafsi. And a borrowing rafsi does not begin a string of rafsi, as the approved grammar's `fuhivla_head` says. So `bisy` in `bisycla` is the rafsi `bis` and the hyphen, not a borrowing rafsi. The alternatives below join the shared rules for the first and later rafsi of a lujvo.

The approved grammar reads a rafsi without a y-hyphen only where no extended rafsi and no borrowing begins. It also reads one only before a part that is neither (`!any_extended_rafsi y_less_rafsi !any_extended_rafsi`). So `spageti'ybroda` begins with the extended rafsi `spageti'y`, not with `spa`, and `selspageti` is one borrowing, not `sel` and `spageti`. `brivla-with-onset` and `lujvo-tail` state that guard, with `extended-start`. A borrowing, or the head of a borrowing rafsi, must not begin a string of rafsi (`fuhivla_head`). So the guard does not count one that does: `pairkamnycmi` begins with `pai`, the r-hyphen and `kamny`. The rafsi followed by `'y`, `hy-rafsi`, build no lujvo. But they end a string of rafsi in the slinku'i test, as in the approved grammar's `rafsi_string`.

```jbogenbau
%extend-rule rafsi-core
  hy-rafsi

%redefine-rule brivla-with-onset
  | word-initial-core
  | $f(first-rafsi) $t(lujvo-tail)
%conditions
  ¬matches($f, y-less-rafsi) ∨ ¬matches($, extended-start) ∧ ¬matches($t, extended-start)

%redefine-rule lujvo-tail
  | brivla-core
  | $r(initial-rafsi) $u(lujvo-tail)
%conditions
  ¬matches($r, y-less-rafsi) ∨ ¬matches($, extended-start) ∧ ¬matches($u, extended-start)

%rule y-less-rafsi
  cvc-rafsi | ccv-rafsi | cvv-rafsi | consonant cvv-body r-hyphen

%rule extended-start
  | brivla-rafsi [any-letters]
  | stressed-brivla-rafsi [any-letters]
  | $f(borrowing-start)
%conditions
  ¬matches($f, rafsi-string-start)

%rule borrowing-start
  | fuhivla-rafsi [any-letters]
  | stressed-fuhivla-rafsi [any-letters]
  | fuhivla-with-onset
  | fuhivla-without-onset

%rule rafsi-string-start
  | [y-less-run] word-final-string-end
  | [y-less-run] hyphened-rafsi [any-letters]

%rule y-less-run
  y-less-rafsi | y-less-rafsi y-less-run

%rule word-final-string-end
  gismu | cvv-final-rafsi | stressed-y-less-rafsi short-final-rafsi

%rule stressed-y-less-rafsi
  consonant stressed-vowel consonant | initial-pair stressed-vowel | consonant stressed-cvv-body [r-hyphen]

%rule hyphened-rafsi
  y-rafsi | stressed-y-rafsi | [stressed-y-less-rafsi] initial-pair hyphen-y | hy-rafsi

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
  $b(syllable-head) head-gap plain-nucleus /'/ hyphen-y
%conditions
  ¬matches(tail($b), rafsi-string)

%rule stressed-brivla-rafsi
  $b(syllable-head) head-gap stressed-nucleus /'/ hyphen-y
%conditions
  ¬matches(tail($b), rafsi-string)

%rule syllable-head
  | [head-onset] plain-nucleus
  | syllable-head head-gap plain-nucleus

%rule head-onset
  consonant | initial-cluster | glide

%rule head-gap
  medial-consonants | /'/

%rule fuhivla-rafsi
  | $h(rafsi-head) consonant hyphen-y
  | $h(rafsi-head) initial-cluster hyphen-y
  | $g(rafsi-head) glide hyphen-y
%conditions
  ¬matches(tail($h), rafsi-string),
  ¬matches($h, plain-rafsi-head),
  ¬matches(tail($g), rafsi-string),
  ¬matches($, rafsi-string-start)

%rule plain-rafsi-head
  [basic-initial-rafsi-sequence] (consonant | initial-pair) plain-vowel

%rule stressed-fuhivla-rafsi
  | $h(rafsi-head) stressed-nucleus consonant hyphen-y
  | $h(rafsi-head) stressed-nucleus initial-cluster hyphen-y
  | $h(rafsi-head) stressed-nucleus glide hyphen-y
  | [head-onset] stressed-nucleus (consonant | initial-cluster | glide) hyphen-y
%conditions
  ¬matches(tail($h), rafsi-string),
  ¬matches($, rafsi-string-start)

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

An extended rafsi is a shortening that the regular rafsi cannot spell. So its head is not a string of regular rafsi followed by the CV or CCV that begins a CVC, CVCC or CCVC rafsi. That test is needed only before a consonant onset, since no regular rafsi ends in a glide. For example, `srimaky` in `srimakyvelvei` is `sri` and `mak` with a y-hyphen.

## Cmevla

A name is surrounded by pauses, so its shape carries neither property. Its consonant runs are held to the pair table, as [shapes.md](shapes.md) says. The letter rule of the approved grammar for `n` also refuses an affricate after it, so a name may not contain `ndj`, `ndz`, `ntc` or `nts`: `.andj.` is not a name.

```jbogenbau
%rule cmevla-shape
  $n(cmevla) <∅>
%conditions
  ¬matches($n, n-affricate-word)
```
