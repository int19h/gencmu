# Approved word forms

This document is the family part of the word stage in the [approved word forms](../dialects/bpfk.md) dialect, for the word-form grammar that the Logical Language Group's definition effort approved, the PEG grammar printed as appendix A2 of the 1.3 editions of *The Complete Lojban Language*; it is stitched in after [stream.md](stream.md) and [shapes.md](shapes.md) in place of [cll.md](cll.md). It defines the three shapes the stream reads, with the pause properties of that grammar's `post_word` as tags, and adds what the approved grammar has beyond the printed chapter 4: the extended rafsi that shorten a borrowing with a hyphen. What it withholds is as important: it adds no alternative with a glide after a consonant, since the definition effort banned the consonant-glide-vowel syllable (change log A3, approved 2014-12-27), and it holds a name's consonant runs to the pair table of CLL 3.6, as the letter rules of the approved grammar do. The notation is explained in [the notation document](../../docs/notation.md).

The approved grammar reads four things this stage cannot: a digit inside a name, since the phoneme stage has already read every digit as the number word it stands for; a cmavo whose final stressed vowel is followed by a consonant cluster, which the approved grammar refuses and this grammar admits; a comma, which the phoneme stage drops for both families; and the approved grammar's `!cmavo` guard at the head of a borrowing, which the stage's lazy choice among parses replaces, as "Choosing among parses" in [stream.md](stream.md) explains.

## Cmavo

A cmavo is an onset, a consonant or a glide, followed by nuclei joined by apostrophes, or the nuclei alone; here `y` is a nucleus like any other, so `y'y`, `a'y` and the `Cy` letter words are all ordinary cmavo, and only a bare run of `y` is hesitation. A `Cy` is tagged `y-letter` and an unstressed CV cmavo `cv`: the approved grammar's `CVCy_lujvo` guard reads `bajykla` as one lujvo and not as `ba jy kla`, and the stream's join rules apply that guard through these two tags.

```jbogenbau
%rule cmavo-shape
  | $w(plain-cmavo-body) <"onset" ∪ "continued">
  | $v(plain-cmavo-body) <"onset" ∪ "continued" ∪ "cv">
  | letter-cmavo <"onset" ∪ "continued" ∪ "y-letter">
  | $n(cmavo-nuclei) word-end <"continued">
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

A brivla with an onset may follow a word without a pause; it may be followed by one only if its stress is marked, since an unmarked brivla is stressed on the penultimate syllable before a pause, which is what the approved grammar's `stress` rule says. A vowel-initial borrowing needs a pause before it.

```jbogenbau
%rule brivla-shape
  | $m(brivla-with-onset) <"onset" ∪ "continued">
  | $u(brivla-with-onset) <"onset">
  | $n(fuhivla-without-onset) <"continued">
  | $o(fuhivla-without-onset) <∅>
%conditions
  phonemes($m) ≠ lowercase(phonemes($m)),
  phonemes($u) = lowercase(phonemes($u)),
  phonemes($n) ≠ lowercase(phonemes($n)),
  phonemes($o) = lowercase(phonemes($o))
```

## Extended rafsi

The approved grammar lets a borrowing serve as a rafsi in two ways (A2.6). A `brivla_rafsi` is a head of at least two syllables followed by `'y`, as in `fuly'ismu`; a `fuhivla_rafsi` is a head of borrowing syllables followed by a consonant onset and `y`, as in `aktyiismu`. Each has a stressed form, whose last syllable before the hyphen is the stressed one, for use directly before a short final rafsi. The apostrophe that may follow the hyphen is also the onset of a vowel-initial borrowing that serves as the core, `fuly'ismu`, so a core may begin with it. The slinku'i test of CLL 4.7 applies to the head of a borrowing rafsi as to a borrowing: its tail is not a string of rafsi. The approved grammar also asks that the head itself not begin a rafsi string; here that is left to the choice among parses, since a head that is a string of rafsi is also a lujvo reading of the same letters, and the earlier close wins. The alternatives below join the shared rules for the first and later rafsi of a lujvo.

```jbogenbau
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

A name is surrounded by pauses, so its shape carries neither property. Its consonant runs are held to the pair table: each adjacent pair is a permissible pair of CLL 3.6, which is what the letter rules of the approved grammar say for every position, and so `.tlaiv.` is a name and `.ekstcat.` is one, while a doubled consonant or a voiced consonant beside an unvoiced one is not.

```jbogenbau
%rule cmevla-shape
  cmevla <∅>

%rule cmevla-run
  permissible-run
```

A permissible run is built from the `before-x` tables of [shapes.md](shapes.md): a run ending in a consonant is that consonant alone, or a run ending in one of the consonants that may precede it, followed by it.

```jbogenbau
%rule permissible-run
  | run-b
  | run-c
  | run-d
  | run-f
  | run-g
  | run-j
  | run-k
  | run-l
  | run-m
  | run-n
  | run-p
  | run-r
  | run-s
  | run-t
  | run-v
  | run-x
  | run-z

%rule run-b
  /b/ | run-before-b /b/

%rule run-c
  /c/ | run-before-c /c/

%rule run-d
  /d/ | run-before-d /d/

%rule run-f
  /f/ | run-before-f /f/

%rule run-g
  /g/ | run-before-g /g/

%rule run-j
  /j/ | run-before-j /j/

%rule run-k
  /k/ | run-before-k /k/

%rule run-l
  /l/ | run-before-l /l/

%rule run-m
  /m/ | run-before-m /m/

%rule run-n
  /n/ | run-before-n /n/

%rule run-p
  /p/ | run-before-p /p/

%rule run-r
  /r/ | run-before-r /r/

%rule run-s
  /s/ | run-before-s /s/

%rule run-t
  /t/ | run-before-t /t/

%rule run-v
  /v/ | run-before-v /v/

%rule run-x
  /x/ | run-before-x /x/

%rule run-z
  /z/ | run-before-z /z/

%rule run-before-b
  run-d | run-g | run-j | run-l | run-m | run-n | run-r | run-v | run-z

%rule run-before-c
  run-f | run-k | run-l | run-m | run-n | run-p | run-r | run-t

%rule run-before-d
  run-b | run-g | run-j | run-l | run-m | run-n | run-r | run-v | run-z

%rule run-before-f
  run-c | run-k | run-l | run-m | run-n | run-p | run-r | run-s | run-t | run-x

%rule run-before-g
  run-b | run-d | run-j | run-l | run-m | run-n | run-r | run-v | run-z

%rule run-before-j
  run-b | run-d | run-g | run-l | run-m | run-n | run-r | run-v

%rule run-before-k
  run-c | run-f | run-l | run-m | run-n | run-p | run-r | run-s | run-t

%rule run-before-l
  | run-b
  | run-c
  | run-d
  | run-f
  | run-g
  | run-j
  | run-k
  | run-m
  | run-n
  | run-p
  | run-r
  | run-s
  | run-t
  | run-v
  | run-x
  | run-z

%rule run-before-m
  | run-b
  | run-c
  | run-d
  | run-f
  | run-g
  | run-j
  | run-k
  | run-l
  | run-n
  | run-p
  | run-r
  | run-s
  | run-t
  | run-v
  | run-x
  | run-z

%rule run-before-n
  | run-b
  | run-c
  | run-d
  | run-f
  | run-g
  | run-j
  | run-k
  | run-l
  | run-m
  | run-p
  | run-r
  | run-s
  | run-t
  | run-v
  | run-x
  | run-z

%rule run-before-p
  run-c | run-f | run-k | run-l | run-m | run-n | run-r | run-s | run-t | run-x

%rule run-before-r
  | run-b
  | run-c
  | run-d
  | run-f
  | run-g
  | run-j
  | run-k
  | run-l
  | run-m
  | run-n
  | run-p
  | run-s
  | run-t
  | run-v
  | run-x
  | run-z

%rule run-before-s
  run-f | run-k | run-l | run-m | run-n | run-p | run-r | run-t | run-x

%rule run-before-t
  run-c | run-f | run-k | run-l | run-m | run-n | run-p | run-r | run-s | run-x

%rule run-before-v
  run-b | run-d | run-g | run-j | run-l | run-m | run-n | run-r | run-z

%rule run-before-x
  run-f | run-l | run-m | run-n | run-p | run-r | run-s | run-t

%rule run-before-z
  run-b | run-d | run-g | run-l | run-n | run-r | run-v
```

The `n` before an affricate that the approved grammar's letter rule for `n` refuses, `ndj`, `ndz`, `ntc` and `nts`, is a triple, and a name's triples are read pair by pair here; that one refinement is a known gap of this family.
