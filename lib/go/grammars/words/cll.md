# CLL word forms

This document is the family part of the word stage in the [CLL](../dialects/cll-ebnf.md) dialect. It gives the word forms of chapters 3 and 4 of *The Complete Lojban Language*, version 1.1. It is stitched in after [stream.md](stream.md) and [shapes.md](shapes.md), whose sounds it builds words from. It defines the three shapes that the stream reads, `cmavo-shape`, `brivla-shape` and `cmevla-shape`, and it tags each with what the pause rules of CLL 4.9 need to know about the word. The family of the definition effort is [bpfk.md](bpfk.md). The notation is explained in [the notation document](../../docs/notation.md).

The rules state CLL 1.1's word forms precisely enough to implement them twice, and an independent implementation of the same rules agrees with this grammar. Under these rules a text divides into words in at most one way, so the stage's lazy choice among parses never decides where a word ends.

## Pause tags

The stream joins two words without a pause only if CLL 4.9 and 4.2 allow it. It reads these tags on the word before and the word after:

- `onset`: the word begins with a consonant and is not a name. Only such a word may follow another word without a pause (rules 3 and 4), apart from a name after `la`, below.
- `continued`: another word may follow this one without a pause. Every cmavo but a `Cy` letter has it, and so does a brivla whose stress is marked.
- `open-stress`: a brivla whose stress is not marked. CLL 3.9 puts its stress on its penultimate syllable, so no counted syllable may follow it before the next pause. Only a word tagged `uncounted`, one with no counted syllable, may follow it without a pause.
- `cy`: a `Cy` letter, which rule 6 lets only another `Cy` follow directly.
- `name-intro` and `name-onset`: `la`, `lai`, `la'i` and `doi`, and a name that begins with a consonant. Rule 4 lets the name follow the cmavo without a pause.
- `initial-stress` and `final-stress`: the word's first or last syllable is stressed. Such syllables are those of the first and the last vowel nucleus of the word as written, `y` included. A pause must stand between a word with `final-stress` and a following word with `initial-stress` (CLL 4.2), or a following brivla, which is tagged `stress-guard` (rule 5).

## Cmavo

A cmavo is an optional consonant followed by vowel units joined by apostrophes. A unit is a vowel or a falling diphthong (CLL 4.1, 4.2). So `sei'a` is a cmavo, but `seia`, `baiu` and `miui` are not: their vowels do not form units. One or two vowels make the forms V, VV, CV and CVV. Three or more are the experimental cmavo of CLL 4.2, such as `ku'a'e` and `bai'ai`. The ten rising diphthongs, such as `ia` and `ui`, are cmavo as whole words, but a consonant never comes before one, so `kie` and `mui` are no cmavo. A comma never stands in a cmavo: `ma,i` is neither one cmavo nor `ma .i`, since a comma is no pause.

A consonant followed by `y` is a letter cmavo (CLL 4.2, 17). So is `y'y`, the letter for the apostrophe. The ten pairs `a'y e'y i'y o'y u'y y'a y'e y'i y'o y'u` are cmavo too. Beyond these, a cmavo may use `y` as one more unit, as `ka'y`, `ky'a`, `cy'y` and `y'y'y` do. These are read under the warning `y-cmavo`: they are always words, and a caller who turns the feature on gets a warning for each one. Such a word has at least two units. A `y` alone, or a run of `y`, is hesitation, which the stream reads.

A cmavo's stress is free (CLL 3.9), so any of its vowels may be a capital. Its first or last syllable is stressed if its first or last unit has a capital vowel.

```jbogenbau
%rule cmavo-shape
  | $c(plain-cmavo-body)
      <"onset" ∪ "continued"
       ∪ (matches($c, first-marked-cmavo) ⟹ "initial-stress") ∪ (matches($c, last-marked-cmavo) ⟹ "final-stress")
       ∪ (matches($c, name-intro-cmavo) ⟹ "name-intro")>
  | $v(vowel-cmavo)
      <"continued"
       ∪ (matches($v, first-marked-cmavo) ⟹ "initial-stress") ∪ (matches($v, last-marked-cmavo) ⟹ "final-stress")>
  | $l(letter-cmavo)
      <"onset" ∪ "cy" ∪ "uncounted" ∪ (matches($l, stress-mark) ⟹ "initial-stress" ∪ "final-stress")>
  | $p(y-pair-cmavo)
      <"continued" ∪ (matches($p, y-letters) ⟹ "uncounted")
       ∪ (matches($p, first-marked-cmavo) ⟹ "initial-stress") ∪ (matches($p, last-marked-cmavo) ⟹ "final-stress")>
  | @y-cmavo! $w(warned-cmavo)
      <"continued" ∪ "cmavo-warning" ∪ (matches(head($w), consonant) ⟹ "onset") ∪ (matches($w, y-letters) ⟹ "uncounted")
       ∪ (matches($w, first-marked-cmavo) ⟹ "initial-stress") ∪ (matches($w, last-marked-cmavo) ⟹ "final-stress")>

%rule plain-cmavo-body
  consonant cmavo-units

%rule vowel-cmavo
  cmavo-units | rising-diphthong

%rule cmavo-units
  cmavo-unit | cmavo-units /'/ cmavo-unit

%rule cmavo-unit
  vowel | falling-diphthong

%rule letter-cmavo
  consonant any-y

%rule y-pair-cmavo
  any-y /'/ any-y | vowel /'/ any-y | any-y /'/ vowel

%rule warned-cmavo
  | $w(warned-units)
  | consonant warned-units
%conditions
  ¬matches($w, y-pair-cmavo)

%rule warned-units
  | any-y /'/ any-units
  | cmavo-unit /'/ warned-tail

%rule warned-tail
  | any-y | any-y /'/ any-units
  | cmavo-unit /'/ warned-tail

%rule any-units
  any-unit | any-units /'/ any-unit

%rule any-unit
  cmavo-unit | any-y

%rule y-letters
  [consonant] y-units

%rule y-units
  any-y | y-units /'/ any-y

%rule cmavo-nucleus
  cmavo-unit | any-y | rising-diphthong

%rule first-marked-cmavo
  [consonant] $u(cmavo-nucleus) [/'/ any-letters]
%conditions
  matches($u, stress-mark)

%rule last-marked-cmavo
  [consonant] [any-letters /'/] $u(cmavo-nucleus)
%conditions
  matches($u, stress-mark)

%rule name-intro-cmavo
  /l/ any-a | /l/ any-a any-i | /l/ any-a /'/ any-i | /d/ any-o any-i
```

A lexicon spells each cmavo in phoneme tags, the apostrophe as `/'/`. It spells each vowel with an `any-` rule of [stream.md](stream.md), which matches either the plain or the stressed phoneme.

## Brivla

A brivla is a gismu, a lujvo or a borrowing (CLL 4.3). It ends in a vowel other than `y`, and it has a consonant pair among its first five letters, not counting `y` and the apostrophe. Gismu and lujvo always have one. `brivla-scan` of [shapes.md](shapes.md) checks its stress. A brivla whose stress is marked has every capital vowel in its penultimate counted syllable, and it may be followed by a word with no pause. A brivla with no capital vowel is `open-stress`. A capital `Y` never stands in a brivla, since no rule below reads one.

```jbogenbau
%rule brivla-shape
  | $m(brivla-word)
      <tags($m) ∪ "stress-guard" ∪ "continued" ∪ ("first-marked" ∈ tags($m, brivla-scan) ⟹ "initial-stress")>
  | $u(brivla-word)
      <tags($u) ∪ "stress-guard" ∪ "open-stress" ∪ ("n2" ∈ tags($u, brivla-scan) ⟹ "initial-stress")>
%conditions
  "s2" ∈ tags($m, brivla-scan),
  "s0" ∈ tags($u, brivla-scan),
  ("n2" ∪ "n3") ∩ tags($u, brivla-scan) ≠ ∅

%rule brivla-word
  | gismu-form <"gismu" ∪ "onset">
  | lujvo-form <"lujvo" ∪ "onset">
  | $f(fuhivla-word) <"fuhivla" ∪ (matches(head($f), consonant) ⟹ "onset")>
```

A gismu is CVCCV with a permissible pair, or CCVCV with an initial pair (CLL 4.4). Here and below, C is a consonant, and V is one of `a e i o u`, never `y`.

```jbogenbau
%rule gismu-form
  | consonant vowel consonant-pair vowel
  | initial-pair vowel consonant vowel
```

## Lujvo

A lujvo is exactly what the algorithm of CLL 4.11 makes from two rafsi or more. Every rafsi but the last is CVC, CCV, CVV, CVCC or CCVC, and the last is CVV, CCV or a gismu form. CVV is a falling diphthong, or two vowels with an apostrophe between them. The algorithm puts a hyphen at a joint only where one is required:

- A `y` after a four-letter rafsi, CVCC or CCVC.
- A `y` between two consonants that form no permissible pair, and between `n` and a following `tc`, `ts`, `dj` or `dz`, which would make a triple that CLL 3.7 forbids. CLL 4.11 has no rule for that triple, and this is the completion that `junydji` needs.
- An `r` after a first CVV rafsi, unless the lujvo has two rafsi and the second is CCV, as in `saicli`. The hyphen is `n` before an `r`, as in `ro'inre'o`.
- One more `y`, from the tosmabru test below.

"It is illegal to add a hyphen at a place that is not required by this algorithm", so `rokyre'o` and `basykla` are not lujvo. Without its needless hyphen, `saircli` is no lujvo either, and it reads as a borrowing. The rules below build the letters of a lujvo from the left, and they place each hyphen by its cause. `lujvo-rest` is the rafsi after a vowel or after an `r` or `n` hyphen, to the end of the word. `cvc-rest` is the part of a CVC or CVCC rafsi from its third letter, with the joint after it. A joint without a hyphen must be a permissible pair and must not make one of the four triples. A `y` at a joint must be required.

```jbogenbau
%rule lujvo-form
  | ccv-rafsi lujvo-rest
  | initial-pair vowel consonant /y/ lujvo-rest
  | consonant vowel lujvo-after-cv
  | consonant $a(vowel) $t(lujvo-after-cvv)
  | consonant vowel /'/ vowel cvv-first-rest
%conditions
  ¬matches($a, i-or-u),
  ¬matches($a, e-or-o) ∨ matches(head($t), any-i)

%rule lujvo-after-cvv
  i-or-u cvv-first-rest

%rule cvv-first-rest
  | ccv-rafsi
  | /r/ $r(lujvo-rest)
  | /n/ $n(lujvo-rest)
%conditions
  ¬matches($r, ccv-rafsi),
  ¬begins($r, r-letter),
  begins($n, r-letter)

%rule lujvo-rest
  | final-rafsi
  | ccv-rafsi lujvo-rest
  | cvv-rafsi lujvo-rest
  | consonant vowel cvc-rest
  | initial-pair vowel consonant /y/ lujvo-rest

%rule cvc-rest
  | $k(consonant) lujvo-rest
  | $l(consonant) /y/ lujvo-rest
  | consonant-pair /y/ lujvo-rest
%conditions
  begins(from($k), consonant-pair),
  ¬begins(from($k), n-affricate),
  begins(from($l), mandatory-y)

%rule final-rafsi
  cvv-rafsi | ccv-rafsi | gismu-form

%rule ccv-rafsi
  initial-pair vowel

%rule cvv-rafsi
  consonant falling-diphthong | consonant vowel /'/ vowel

%rule mandatory-y
  | $j(y-joint)
  | /n/ /y/ affricate
%conditions
  ¬matches($j, pair-across-y)

%rule y-joint
  consonant /y/ consonant

%rule affricate
  /t/ /c/ | /t/ /s/ | /d/ /j/ | /d/ /z/

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
```

The tosmabru test of CLL 4.11 decides whether a lujvo whose first rafsi is CVC needs one more `y` after it. Without that `y`, the word could fall apart into a cmavo and a shorter lujvo: `tosmabru` is `to smabru`, and the lujvo is `tosymabru`. The test starts from the lujvo with its required hyphens. It follows the CVC rafsi from the first one, across joints with no hyphen, and stops at the first required `y` or at the first rafsi that is not CVC:

- If it stops at a required `y`, it examines the joints before that `y`. So `tospatyta'a` needs `tosypatyta'a`, but `patyta'a` examines no joint and gets no second `y`.
- Otherwise it applies only if the next rafsi is the last one, a CVCCV gismu form whose middle pair is an initial pair. It then examines the joints of the chain, the joint before the gismu, and the gismu's middle pair. So `tosmabru` needs its `y`, but `tosmabryklama` does not, since its `y` follows the four-letter `mabr`.

The `y` is added at the first joint if at least one pair is examined and every examined pair is an initial pair. `lujvo-after-cv` is the part of a lujvo from the third letter of a first CVC or CVCC rafsi. Its first joint has no hyphen only if the test asks for none, and a `y` there is either required or the one the test adds. `tosmabru-positive` is the test on the letters from the first joint, and `tosmabru-y` is the same test on a word that carries the added `y`. So `tospatytosmabru` is `to spatytosmabru`, and the lujvo is `tosypatytosmabru`.

```jbogenbau
%rule lujvo-after-cv
  | $k(consonant) lujvo-rest
  | $l(consonant) /y/ lujvo-rest
  | consonant-pair /y/ lujvo-rest
%conditions
  begins(from($k), consonant-pair),
  ¬begins(from($k), n-affricate),
  $k ⟹ ¬matches($, tosmabru-positive),
  begins(from($l), mandatory-y) ∨ matches($, tosmabru-y)

%rule tosmabru-positive
  | initial-pair vowel tosmabru-chain
  | initial-pair vowel initial-pair vowel

%rule tosmabru-chain
  | consonant /y/ any-letters
  | tosmabru-positive

%rule tosmabru-y
  | initial-pair-across-y vowel tosmabru-chain
  | initial-pair-across-y vowel initial-pair vowel

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
```

No lujvo made this way breaks up, which is why the algorithm is as it is. A word's stress falls on its penultimate syllable, so a brivla inside it must reach its end, and the words before that brivla must be cmavo. An initial CC leaves no cmavo to take. An initial CVCC or CVV rafsi leaves, after its hyphen, a rest that no word begins with. The CVV-CCV exception leaves a rest of one syllable. The tosmabru test catches an initial CVC whose rest would be a lujvo. A rest that would be a borrowing fails the slinku'i test below, since the CV cmavo put back in front of it makes the lujvo.

## Borrowings

A borrowing, or fu'ivla, is a brivla that is neither a gismu nor a lujvo (CLL 4.7). It has no `y`, and it ends in a vowel. It has a consonant cluster among its first five letters, not counting apostrophes and commas. A cluster at its start is an initial pair or a longer run of initial pairs. A cluster in its middle may be of any length, as long as each adjacent pair is permissible and it holds none of the four `n` triples (CLL 4.7's `lerldjamo`). Its vowels may stand in any run, with apostrophes or commas between two of them. A run is read into syllables as [shapes.md](shapes.md) says, so `bantua` has two syllables, `ban-tua`, and `korea` three.

A borrowing is also not "any combination of cmavo, gismu, and lujvo", which 17.4's `denpabu` shows to mean the same spoken word, with the same syllables and stress, read as those words under the pause rules. Only one such reading is possible. It is one or more cmavo followed by one brivla, since a second brivla would need a second stress. The last word must begin with a consonant, and it may be a borrowing too, as in `abaspageti`, which is `a ba spageti`. The candidate's stress then falls on the penultimate syllable of that brivla, which is where the brivla has it. So `buklama` is `bu klama` and `aklama` is `a klama`, but `denpabu` is a borrowing, since `denpa bu` would stress `DENpa`. `klamale` and `bantua` are borrowings for the same reason. `combination` states the reading as the letters alone, since the stress then needs no test.

The slinku'i test of CLL 4.7 says that no CV cmavo may be joined to the front of a borrowing to make a lujvo. Otherwise `pa slinku'i`, written together, would read as the lujvo `pas-lin-ku'i`. The test holds for every borrowing. A CV cmavo before a borrowing that begins with a consonant makes a first CVC rafsi, so the test asks whether the borrowing is `lujvo-after-cv`. Before a borrowing that begins with `i` or `u`, the CV makes a CVV rafsi, and the test asks whether it is `lujvo-after-cvv`. So `ikla` and `irklama` are no borrowings, since `paikla` and `pairklama` are lujvo.

```jbogenbau
%rule fuhivla-word
  $f(fuhivla-form)
%conditions
  matches($f, clustered-start),
  ¬matches($f, gismu-form),
  ¬matches($f, lujvo-form),
  ¬matches($f, lujvo-after-cv),
  ¬matches($f, lujvo-after-cvv),
  ("n2" ∪ "n3") ∩ tags($f, brivla-scan) ≠ ∅,
  ¬matches($f, combination)

%rule fuhivla-form
  | fuhivla-body
  | consonant fuhivla-body
  | initial-cluster fuhivla-body

%rule fuhivla-body
  | vowel-group
  | vowel-group $m(permissible-run) fuhivla-body
%conditions
  ¬matches($m, has-n-affricate)

%rule vowel-group
  vowel | vowel-group vowel | vowel-group /'/ vowel | vowel-group /,/ vowel

%rule clustered-start
  [counted-lead] consonant consonant [any-letters]

%rule counted-lead
  counted-letter | counted-letter counted-letter | counted-letter counted-letter counted-letter

%rule counted-letter
  consonant | vowel | vowel /'/ | vowel /,/

%rule combination
  (plain-cmavo-body | vowel-cmavo) combination-rest

%rule combination-rest
  | gismu-form | lujvo-form | $f(fuhivla-word)
  | plain-cmavo-body combination-rest
%conditions
  matches(head($f), consonant)
```

## Cmevla

A name is a nonempty run of letters that ends in a consonant (CLL 4.8), so `.rl.` is one. Every adjacent pair of its consonants is permissible, at its start too, and it may hold the four `n` triples (CLL 3.7). It may have `y` as a vowel, the diphthongs `iy` and `uy`, and an apostrophe or a comma between any two of its vowels. CLL 4.8: "Names are not permitted to have the sequences la, lai, or doi embedded in them, unless the sequence is immediately preceded by a consonant", since a name after one of those words may follow it without a pause. So `.laplas.` and `.ilanas.` are not names, but `.nederlants.` is one. A name is surrounded by pauses (rule 4), so its shape carries neither `onset` nor `continued`. One that begins with a consonant is tagged `name-onset`. Its first syllable is stressed if its first nucleus has a capital vowel. If no vowel is a capital, the stress falls where [shapes.md](shapes.md) says, which can be the first syllable: `.djan.` has one syllable, and it is stressed.

```jbogenbau
%rule cmevla-shape
  $n(cmevla)
    <(matches(head($n), consonant) ⟹ "name-onset")
     ∪ ("first-marked" ∈ tags($n, name-scan)
        ∨ "any-marked" ∉ tags($n, name-scan) ∧ "first-counted" ∈ tags($n, name-scan)
          ∧ ("n1" ∪ "n2") ∩ tags($n, name-scan) ≠ ∅
        ⟹ "initial-stress")>
%conditions
  ¬matches($n, la-doi-inside)

%rule cmevla
  | permissible-run
  | [permissible-run] name-body

%rule name-body
  | name-vowels permissible-run
  | name-vowels permissible-run name-body

%rule name-vowels
  name-vowel | name-vowels name-vowel | name-vowels /'/ name-vowel | name-vowels /,/ name-vowel

%rule la-doi-inside
  | la-or-doi [any-letters]
  | [any-letters] name-vowel la-or-doi [any-letters]

%rule la-or-doi
  /l/ any-a | /d/ any-o any-i
```

## Where the book leaves a choice

In a few places CLL 1.1 is silent, or two passages disagree. This grammar reads each place as follows:

- Hyphens. CLL 4.11 says that "it is illegal to add a hyphen at a place that is not required by this algorithm". So a lujvo has a `y` only where the algorithm puts one, and `rokyre'o`, `basykla` and `lojybangri` are no lujvo. The algorithm has no rule for an `n` before `tc`, `ts`, `dj` or `dz`, and the `y` goes there, as in `junydji`.
- The slinku'i test holds for every borrowing, as CLL 4.7 states it, so `ikla` and `irklama` are no borrowings. A borrowing is also not a cmavo followed by a borrowing, which is one more way the book's promise of a single division could fail.
- A "combination of cmavo, gismu, and lujvo" (CLL 4.7) is the same spoken word, with its syllables and stress, as 17.4's `denpabu` shows. So `klamale` and `bantua` are borrowings.
- Stress and pauses. CLL 4.9 rule 5 asks for a pause after a stressed last syllable before a brivla. CLL 4.2 asks for one between two stressed syllables, whatever the words: "If the final syllable of one word is stressed, and the first syllable of the next word is stressed, you must insert a pause". Both hold, so `mIdO` needs a pause. A syllabic consonant adds no syllable, so the first and last syllables of a word are those of its first and last written vowels, `y` included.
- An unmarked brivla is stressed on the penultimate syllable, counted to the next pause (CLL 3.9), so `klamacy.` is `klama cy.`, and `klamabu` is one borrowing, like `denpabu`.
- Capital letters. A capital on either letter of a diphthong, or on both, marks one stressed syllable, so `bAIkla` is a lujvo. A capital `Y` may mark stress in a name or a cmavo, whose stress may fall on any syllable, but never in a brivla, whose `y` is not counted.
- Vowels. CLL never says whether two vowels that form no diphthong may stand side by side. In a name or a borrowing they may, each its own syllable, as in `.aab.` and `paarku`, and as usage before the PEG grammars had them. A cmavo's vowels are single vowels and falling diphthongs joined by apostrophes (CLL 4.1, 4.2), and a rising diphthong is a cmavo only as a whole word. So `seia`, `miui` and `kie` are no cmavo, and `sei'a` is one. An apostrophe or a comma may stand before a rising diphthong in a name, as in `.a'uas.`.
- Commas. A comma between two vowels is a syllable break, as CLL 3.5's `.me,iin.` and 4.7's `bang,r,kore,a` use it. Anywhere else it is not a letter, so a comma that changes no syllable leaves the same word.
- Written boundaries. CLL 3.3 lets a missing period be inferred, but not a missing word boundary. So a space or a period ends a word and counts as a pause, and no boundary is inferred where none is written: `miui` is no text, and `mi .ui` and `mi ui` are two words.
- `y` in a cmavo. The ten pairs `a'y`, `e'y`, `i'y`, `o'y`, `u'y`, `y'a`, `y'e`, `y'i`, `y'o` and `y'u` are cmavo. A longer cmavo with a `y` unit, such as `ka'y`, is read under the warning `y-cmavo`.
