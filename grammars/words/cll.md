# CLL word forms

This document is the family part of the word stage in the [CLL](../dialects/cll-ebnf.md) dialect. It gives the word forms of chapter 4 of *The Complete Lojban Language* as printed. It is stitched in after [stream.md](stream.md) and [shapes.md](shapes.md). It defines the three shapes that the stream reads, `cmavo-shape`, `brivla-shape` and `cmevla-shape`, with the pause properties of CLL 4.9 as tags. It also adds the alternatives that CLL admits and the approved grammar of the definition effort does not. Where this document admits what usage attests beyond the letter of the chapter, it says so. The family of the definition effort is [bpfk.md](bpfk.md). The notation is explained in [the notation document](../../docs/notation.md).

## Cmavo

A cmavo is a consonant followed by vowels, or the vowels alone. Its vowels are runs of vowels joined by apostrophes. CLL 4.2 gives the forms V, CV, VV and CVV. Two vowels without an apostrophe between them are one of the diphthongs of CLL 3.4. That is a falling diphthong such as `ai`, or an on-glide diphthong such as `ui`. So `aa` and `ae` are not cmavo. CLL 4.2 also covers three or more vowels in a row, alone or after one consonant. It says that they are "also of cmavo form, but are reserved for experimental use". Examples are `sau'e` and `bai'ai`.

A cmavo that begins with a consonant can follow a word without a pause. A pause can follow any cmavo. A cmavo that begins with a vowel needs a pause before it (CLL 4.9 rule 3), even one that begins with a glide, such as `ui`. So `miui` is one experimental cmavo and not `mi ui`, and `seia broda` begins with the cmavo `seia`. No letter marks the end of a vowel-initial cmavo, so the rule `word-end` names that end. The choice among parses then sees the cmavo close before the next letter is read. So `inixli` is `i nixli`, while `audji` stays one borrowing, because `dji` is no word.

`y` is not a vowel of these runs. A consonant followed by `y` is a letter cmavo, and a run of `y` alone is hesitation. `y'y` is the letter word for the apostrophe. A `Cy` letter cmavo is tagged `cy` rather than `continued`, because CLL 4.9 rule 6 lets only another `Cy` follow it directly. The join rules of the stream test that tag.

```jbogenbau
%rule cmavo-shape
  | $c(plain-cmavo-body)
      <"onset" ∪ "continued" ∪ (matches($c, final-stressed) ⟹ "final-stress") ∪ (matches($c, name-intro-cmavo) ⟹ "name-intro")>
  | $v(cmavo-nuclei) word-end <"continued" ∪ (matches($v, final-stressed) ⟹ "final-stress")>
  | y /'/ y <"continued">
  | letter-cmavo <"onset" ∪ "cy">

%rule plain-cmavo-body
  consonant cmavo-nuclei

%rule word-end
  ε

%rule cmavo-nuclei
  vowel-run | vowel-run /'/ cmavo-nuclei

%rule vowel-run
  free-vowel | free-diphthong | on-glide-diphthong | free-vowel free-vowel vowel-tail

%rule vowel-tail
  free-vowel | free-vowel vowel-tail

%rule on-glide-diphthong
  (any-i | any-u) (any-a | any-e | any-i | any-o | any-u)

%rule letter-cmavo
  consonant y

%rule name-intro-cmavo
  /l/ any-a | /l/ any-a any-i | /l/ any-a /'/ any-i | /d/ any-o any-i
```

Two rules of CLL about pauses need tags of their own. CLL 4.9 rule 5 says: "If the last syllable of a word bears the stress, and a brivla follows, the two must be separated by a pause". So a cmavo whose last syllable is stressed is tagged `final-stress`, and every brivla is tagged `stress-guard`. The join rules of the stream refuse that pair without a pause. So `MIklama` is not `mI klama`, and `le re NObliPREnu` (Example 3.31) is `le re nObli prEnu`.

CLL 4.9 rule 4 says that a name needs a pause before it "unless the immediately preceding word is one of the cmavo la, lai, la'i, or doi". So those four words are tagged `name-intro`, and a name that begins with a consonant is tagged `name-onset`. The join rules let that pair stand together without a pause, so `ladjan.` is `la djan.`.

A lexicon spells each cmavo in phoneme tags, the apostrophe as `/'/`, and each vowel with an `any-` rule of [shapes.md](shapes.md), which matches either the plain or the stressed phoneme, since a cmavo's stress is free.

## Brivla

A brivla with an onset may follow a word without a pause; it may be followed by one only if its stress is marked, which the condition tests, since by CLL 3.9 an unmarked brivla reaches the next pause. A vowel-initial borrowing needs a pause before it. Every brivla passes the checks of [shapes.md](shapes.md) on a whole word, and one more: CLL 4.3 rule 2 requires a consonant pair in the first five letters of a brivla, not counting `y` and the apostrophe, so `.a'e'a'arku` is not one borrowing. The y-hyphen is a plain `y`, since `y` is never stressed (CLL 3.9), so a capital `Y` never stands in a brivla. CLL 4.11 says that "it is illegal to add a hyphen at a place that is not required". A y-hyphen after a CVC rafsi is required only between the consonants of an impermissible pair, or, by the tosmabru test, at a joint that is a permissible initial pair. So `needless-y` refuses a y-hyphen after a CVC rafsi between two consonants that form a permissible pair but not an initial one, as in `geryzda`. A y-hyphen between `n` and an affricate is required, since without it the word would hold `ntc`, `nts`, `ndj` or `ndz`, which CLL 3.7 forbids: `renytcana` and `junydji` keep theirs. The CVC rafsi is recognized by its letters: it begins the word or follows a vowel or a `y`. A needless y-hyphen at a joint that is an initial pair, where the tosmabru test does not ask for one, is not refused.

```jbogenbau
%rule brivla-shape
  | $m(brivla-with-onset) <"onset" ∪ "continued" ∪ "stress-guard">
  | $u(brivla-with-onset) <"onset" ∪ "stress-guard">
  | $n(fuhivla-without-onset) <"continued" ∪ "stress-guard">
  | $o(fuhivla-without-onset) <"stress-guard">
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
  ¬matches($o, broken-word),
  matches($m, clustered-start),
  matches($u, clustered-start),
  ¬matches($m, needless-y),
  ¬matches($u, needless-y),
  matches($n, clustered-start),
  matches($o, clustered-start)

%rule hyphen-y
  /y/

%rule needless-y
  | consonant plain-vowel $l(y-joint) $a(any-letters)
  | [any-letters] (free-vowel | /y/) consonant plain-vowel $m(y-joint) $b(any-letters)
%conditions
  matches($l, pair-across-y),
  ¬matches($l, initial-pair-across-y),
  ¬matches($l, affricate-across-y) ∨ phonemes(head($a)) ∉ ("c" ∪ "s" ∪ "j" ∪ "z"),
  matches($m, pair-across-y),
  ¬matches($m, initial-pair-across-y),
  ¬matches($m, affricate-across-y) ∨ phonemes(head($b)) ∉ ("c" ∪ "s" ∪ "j" ∪ "z")

%rule affricate-across-y
  /n/ /y/ /t/ | /n/ /y/ /d/

%rule y-joint
  consonant /y/ consonant

%rule pair-across-y
  | /b/ /y/ after-b
  | /c/ /y/ after-c
  | /d/ /y/ after-d
  | /f/ /y/ after-f
  | /g/ /y/ after-g
  | /j/ /y/ after-j
  | /k/ /y/ after-k
  | /l/ /y/ after-l
  | /m/ /y/ after-m
  | /n/ /y/ after-n
  | /p/ /y/ after-p
  | /r/ /y/ after-r
  | /s/ /y/ after-s
  | /t/ /y/ after-t
  | /v/ /y/ after-v
  | /x/ /y/ after-x
  | /z/ /y/ after-z

%rule initial-pair-across-y
  | /b/ /y/ /l/
  | /b/ /y/ /r/
  | /c/ /y/ /f/
  | /c/ /y/ /k/
  | /c/ /y/ /l/
  | /c/ /y/ /m/
  | /c/ /y/ /n/
  | /c/ /y/ /p/
  | /c/ /y/ /r/
  | /c/ /y/ /t/
  | /d/ /y/ /j/
  | /d/ /y/ /r/
  | /d/ /y/ /z/
  | /f/ /y/ /l/
  | /f/ /y/ /r/
  | /g/ /y/ /l/
  | /g/ /y/ /r/
  | /j/ /y/ /b/
  | /j/ /y/ /d/
  | /j/ /y/ /g/
  | /j/ /y/ /m/
  | /j/ /y/ /v/
  | /k/ /y/ /l/
  | /k/ /y/ /r/
  | /m/ /y/ /l/
  | /m/ /y/ /r/
  | /p/ /y/ /l/
  | /p/ /y/ /r/
  | /s/ /y/ /f/
  | /s/ /y/ /k/
  | /s/ /y/ /l/
  | /s/ /y/ /m/
  | /s/ /y/ /n/
  | /s/ /y/ /p/
  | /s/ /y/ /r/
  | /s/ /y/ /t/
  | /t/ /y/ /c/
  | /t/ /y/ /r/
  | /t/ /y/ /s/
  | /v/ /y/ /l/
  | /v/ /y/ /r/
  | /x/ /y/ /l/
  | /x/ /y/ /r/
  | /z/ /y/ /b/
  | /z/ /y/ /d/
  | /z/ /y/ /g/
  | /z/ /y/ /m/
  | /z/ /y/ /v/

%rule clustered-start
  [counted-lead] consonant [/y/] consonant [any-letters]

%rule counted-lead
  counted-letter | counted-letter counted-letter | counted-letter counted-letter counted-letter

%rule counted-letter
  [uncounted] (consonant | free-vowel) [uncounted]

%rule uncounted
  /'/ | /y/ | /'/ uncounted | /y/ uncounted
```

## Cmevla

A name is surrounded by pauses (CLL 4.9 rule 4), so its shape carries neither property, but one that begins with a consonant is tagged `name-onset`, for the rule about `la` and `doi` under "Cmavo". CLL 4.8: "Names are not permitted to have the sequences la, lai, or doi embedded in them, unless the sequence is immediately preceded by a consonant", since a name after one of those words may follow it without a pause. So `.laplas.` and `.ilanas.` are not names, but `.nederlants.` is one. Its consonant runs are held to the pair table, as [shapes.md](shapes.md) says. CLL 3.4 admits the on-glide diphthongs in names, as in `.uiliam.`, so a glide may follow a run.

```jbogenbau
%rule cmevla-shape
  $n(cmevla) <(matches(head($n), consonant) ⟹ "name-onset")>
%conditions
  ¬matches($n, la-doi-inside)

%rule la-doi-inside
  | la-or-doi [any-letters]
  | [any-letters] (free-vowel | /y/ | /Y/ | /'/) la-or-doi [any-letters]

%rule la-or-doi
  /l/ any-a | /d/ any-o any-i

%extend-rule cmevla-with-onset
  cmevla-run glide cmevla-body

%extend-rule cmevla-consonants
  cmevla-run glide
```

## Clusters in borrowings

CLL 4.7 rule 1 lets a borrowing begin with "a longer cluster such that each pair of adjacent consonants in the cluster is a permissible initial consonant pair": `spraile` is a borrowing, but not `ktraile` or `trkaile`. The approved grammar's initial triples are a sibilant, a stop or nasal, and a liquid; CLL admits more, such as `tskale`. `long-initial-run` is every such cluster of three or more consonants, built from the table of initial pairs in [shapes.md](shapes.md).

Inside a borrowing, CLL 4.7 says that clusters "can be quite flexible, as long as all consonant pairs are permissible", and gives `bang,r,blgaria` and `kuln,r,kore,a`. That is the exception it makes to CLL 3.6 and 3.7, which limit clusters to three consonants and a medial triple to one that ends in an initial pair. So in this family a cluster between two vowels of a borrowing is any run of consonants, and the check of a whole word, `bad-joint`, holds each pair to the table and refuses an `n` before an affricate, as CLL 4.7's `lerldjamo` shows. A syllabic consonant is one more consonant of such a run.

```jbogenbau
%redefine-rule initial-triple
  long-initial-run

%redefine-rule consonant-cluster
  consonant consonant-run

%redefine-rule long-cluster
  consonant consonant consonant-run

%rule consonant-run
  consonant | consonant consonant-run

%rule long-initial-run
  | initial-run-b /l/
  | initial-run-b /r/
  | initial-run-c /f/
  | initial-run-c /k/
  | initial-run-c /l/
  | initial-run-c /m/
  | initial-run-c /n/
  | initial-run-c /p/
  | initial-run-c /r/
  | initial-run-c /t/
  | initial-run-d /j/
  | initial-run-d /r/
  | initial-run-d /z/
  | initial-run-f /l/
  | initial-run-f /r/
  | initial-run-g /l/
  | initial-run-g /r/
  | initial-run-j /b/
  | initial-run-j /d/
  | initial-run-j /g/
  | initial-run-j /m/
  | initial-run-j /v/
  | initial-run-k /l/
  | initial-run-k /r/
  | initial-run-m /l/
  | initial-run-m /r/
  | initial-run-p /l/
  | initial-run-p /r/
  | initial-run-s /f/
  | initial-run-s /k/
  | initial-run-s /l/
  | initial-run-s /m/
  | initial-run-s /n/
  | initial-run-s /p/
  | initial-run-s /r/
  | initial-run-s /t/
  | initial-run-t /c/
  | initial-run-t /r/
  | initial-run-t /s/
  | initial-run-v /l/
  | initial-run-v /r/
  | initial-run-z /b/
  | initial-run-z /d/
  | initial-run-z /g/
  | initial-run-z /m/
  | initial-run-z /v/

%rule initial-run-b
  | /j/ /b/
  | /z/ /b/
  | initial-run-j /b/
  | initial-run-z /b/

%rule initial-run-c
  | /t/ /c/
  | initial-run-t /c/

%rule initial-run-d
  | /j/ /d/
  | /z/ /d/
  | initial-run-j /d/
  | initial-run-z /d/

%rule initial-run-f
  | /c/ /f/
  | /s/ /f/
  | initial-run-c /f/
  | initial-run-s /f/

%rule initial-run-g
  | /j/ /g/
  | /z/ /g/
  | initial-run-j /g/
  | initial-run-z /g/

%rule initial-run-j
  | /d/ /j/
  | initial-run-d /j/

%rule initial-run-k
  | /c/ /k/
  | /s/ /k/
  | initial-run-c /k/
  | initial-run-s /k/

%rule initial-run-l
  | /b/ /l/
  | /c/ /l/
  | /f/ /l/
  | /g/ /l/
  | /k/ /l/
  | /m/ /l/
  | /p/ /l/
  | /s/ /l/
  | /v/ /l/
  | /x/ /l/
  | initial-run-b /l/
  | initial-run-c /l/
  | initial-run-f /l/
  | initial-run-g /l/
  | initial-run-k /l/
  | initial-run-m /l/
  | initial-run-p /l/
  | initial-run-s /l/
  | initial-run-v /l/

%rule initial-run-m
  | /c/ /m/
  | /j/ /m/
  | /s/ /m/
  | /z/ /m/
  | initial-run-c /m/
  | initial-run-j /m/
  | initial-run-s /m/
  | initial-run-z /m/

%rule initial-run-n
  | /c/ /n/
  | /s/ /n/
  | initial-run-c /n/
  | initial-run-s /n/

%rule initial-run-p
  | /c/ /p/
  | /s/ /p/
  | initial-run-c /p/
  | initial-run-s /p/

%rule initial-run-r
  | /b/ /r/
  | /c/ /r/
  | /d/ /r/
  | /f/ /r/
  | /g/ /r/
  | /k/ /r/
  | /m/ /r/
  | /p/ /r/
  | /s/ /r/
  | /t/ /r/
  | /v/ /r/
  | /x/ /r/
  | initial-run-b /r/
  | initial-run-c /r/
  | initial-run-d /r/
  | initial-run-f /r/
  | initial-run-g /r/
  | initial-run-k /r/
  | initial-run-m /r/
  | initial-run-p /r/
  | initial-run-s /r/
  | initial-run-t /r/
  | initial-run-v /r/

%rule initial-run-s
  | /t/ /s/
  | initial-run-t /s/

%rule initial-run-t
  | /c/ /t/
  | /s/ /t/
  | initial-run-c /t/
  | initial-run-s /t/

%rule initial-run-v
  | /j/ /v/
  | /z/ /v/
  | initial-run-j /v/
  | initial-run-z /v/

%rule initial-run-z
  | /d/ /z/
  | initial-run-d /z/
```

## Glides after consonants

CLL 3.4 admits a glide after a consonant or a cluster in a borrowing as well, as in `kuarka` (CLL 4.7); these alternatives join the shared rules for the consonants between two nuclei, and let a borrowing begin with a consonant or a cluster and a glide.

```jbogenbau
%extend-rule medial-consonants
  consonant glide | consonant-cluster glide

%extend-rule clustered-onset
  consonant-cluster glide

%extend-rule fuhivla-with-onset
  | initial-cluster glide fuhivla-long-body | initial-cluster glide fuhivla-short-body
  | consonant glide fuhivla-clustered-body
```

A borrowing may also open with a cluster and a glide, as in `zgiaca'a`, which usage attests.
