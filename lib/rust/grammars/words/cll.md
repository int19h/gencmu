# CLL word forms

This document is the family part of the forms stage in the [CLL](../dialects/cll-ebnf.md) dialect. A stage is one step of a pipeline, with its own grammar ([engine §1](../../docs/engine.md#1-tokens)). A family is a set of word forms that dialects use. This family gives the word forms of chapters 3 and 4 of *The Complete Lojban Language*, version 1.1. The loader stitches it into the forms stage after [forms.md](forms.md) and [shapes.md](shapes.md), whose sounds it builds words from. [Railroad diagrams](../../docs/diagrams/words/cll.md) draw each rule of this document.

This document defines the three shapes that the forms stage reads, `cmavo-shape`, `brivla-shape` and `cmevla-shape`. It tags each such word with what the pause rules of CLL 4.9 need to know about the word. A token is one unit that a stage reads or emits. A tag marks a token by name, phoneme or character. The family of the definition effort is [bpfk.md](bpfk.md). [The notation document](../../docs/notation.md) explains the notation.

The prose uses these Lojban terms for words:

- A cmavo is a particle, a short structure word.
- A brivla is a predicate word.
- A gismu is a root word.
- A lujvo is a compound word.
- A rafsi is a shortened word form used inside compounds.

The rules state CLL 1.1's word forms precisely enough to implement them twice. Under these rules a text divides into words in at most one way. So the lazy choice of the stage among parses ([engine §6](../../docs/engine.md#6-choosing-a-parse)) never decides where a word ends.

## Pause tags

The forms stage joins two words without a pause only if CLL 4.9 and 4.2 allow it. It reads these tags on the word before and the word after:

- `onset`: The word begins with a consonant and is not a name. Only such a word can follow another word without a pause (rules 3 and 4), apart from a name after `la`, below.
- `continued`: Another word can follow this one without a pause. Every cmavo but a `Cy` letter has it, and so does a brivla whose stress is marked.
- `open-stress`: The word is a brivla whose stress is not marked. CLL 3.9 puts its stress on its penultimate syllable, so no counted syllable can follow it before the next pause. Only a word tagged `uncounted`, one with no counted syllable, can follow it without a pause.
- `cy`: A `Cy` letter, which rule 6 lets only another `Cy` follow directly
- `name-intro` and `name-onset`: `name-intro` marks `la`, `lai`, `la'i` and `doi`, and `name-onset` marks a name that begins with a consonant. Rule 4 lets the name follow the cmavo without a pause.
- `initial-stress` and `final-stress`: The word's first or last syllable is stressed. Such syllables are those of the first and the last vowel nucleus of the word as written, `y` included. A pause must stand between a word with `final-stress` and a following word with `initial-stress` (CLL 4.2). It must also stand before a following brivla, which carries the tag `stress-guard` (rule 5).

## Cmavo

A cmavo is an optional consonant followed by vowel units joined by apostrophes. A unit is a vowel or a falling diphthong (CLL 4.1, 4.2). So `sei'a` is a cmavo, but `seia`, `baiu` and `miui` are not: their vowels do not form units. One or two vowels make the forms V, VV, CV and CVV. Three or more are the experimental cmavo of CLL 4.2, such as `ku'a'e` and `bai'ai`.

The ten rising diphthongs, such as `ia` and `ui`, are cmavo as whole words. A consonant never comes before one, so `kie` and `mui` are no cmavo. A syllable-break comma cannot stand between the vowels of a cmavo. So `ma,i` is neither one cmavo nor `ma .i`, because a comma is no pause. The rules below still read `ma,i` as `mai` when they test for a cmavo, and `cmavo-shape` then refuses the comma (see "Commas").

A consonant followed by `y` is a letter cmavo (CLL 4.2, 17). So is `y'y`, the letter for the apostrophe. The ten pairs `a'y e'y i'y o'y u'y y'a y'e y'i y'o y'u` are cmavo too.

Beyond these, a cmavo can use `y` as one more unit, as `ka'y`, `ky'a`, `cy'y` and `y'y'y` do. They are always words. The grammar tags each one `cmavo-warning`, and the word stage reads it under the warning `y-cmavo` ([cll-stream.md](cll-stream.md)). A caller who turns the feature on gets a warning for each one that the word stage reads as a Lojban word. Such a word has at least two units. A `y` alone, or a run of `y`, is hesitation, which [forms.md](forms.md) reads.

A cmavo's stress is free (CLL 3.9), so any of its vowels can be a capital. Its first or last syllable is stressed if its first or last unit has a capital vowel.

```jbogenbau
%rule cmavo-shape
  | $c(plain-cmavo-body)
      <~onset ∪ ~continued
       ∪ (matches($c, first-marked-cmavo) ⟹ ~initial-stress) ∪ (matches($c, last-marked-cmavo) ⟹ ~final-stress)
       ∪ (matches($c, name-intro-cmavo) ⟹ ~name-intro)>
  | $v(vowel-cmavo)
      <~continued
       ∪ (matches($v, first-marked-cmavo) ⟹ ~initial-stress) ∪ (matches($v, last-marked-cmavo) ⟹ ~final-stress)>
  | $l(letter-cmavo)
      <~onset ∪ ~cy ∪ ~uncounted ∪ (matches($l, stress-mark) ⟹ ~initial-stress ∪ ~final-stress)>
  | $p(y-pair-cmavo)
      <~continued ∪ (matches($p, y-letters) ⟹ ~uncounted)
       ∪ (matches($p, first-marked-cmavo) ⟹ ~initial-stress) ∪ (matches($p, last-marked-cmavo) ⟹ ~final-stress)>
  | $w(warned-cmavo)
      <~continued ∪ ~cmavo-warning ∪ (matches(head($w), consonant) ⟹ ~onset) ∪ (matches($w, y-letters) ⟹ ~uncounted)
       ∪ (matches($w, first-marked-cmavo) ⟹ ~initial-stress) ∪ (matches($w, last-marked-cmavo) ⟹ ~final-stress)>
%conditions
  ¬matches($c, has-comma),
  ¬matches($v, has-comma),
  ¬matches($w, has-comma)

%rule plain-cmavo-body
  consonant cmavo-units

%rule vowel-cmavo
  cmavo-units | rising-vowels

%rule cmavo-units
  cmavo-unit | cmavo-units /'/ cmavo-unit

%rule cmavo-unit
  vowel | falling-vowels

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

These rules spell each vowel with an `any-` rule, which matches either the plain or the stressed phoneme. The lexicon needs no such rule, since it looks a cmavo up by its canonical sound, in which a stressed vowel is plain.

## Brivla

A brivla is a gismu, a lujvo or a borrowing (CLL 4.3). It ends in a vowel other than `y`, and it has a consonant pair among its first five letters, not counting `y` and the apostrophe. Gismu and lujvo always have one.

`brivla-scan` of [shapes.md](shapes.md) finds where the stress of a brivla is. A brivla whose stress is marked has every capital vowel in its penultimate counted syllable. A word can follow it with no pause. A brivla with no capital vowel is `open-stress`. A capital `Y` never stands in a brivla, because no rule below reads one.

```jbogenbau
%rule brivla-shape
  | $m(brivla-word)
      <tags($m) ∪ ~stress-guard ∪ ~continued ∪ (~first-marked ⊆ tags($m, brivla-scan) ⟹ ~initial-stress)>
  | $u(brivla-word)
      <tags($u) ∪ ~stress-guard ∪ ~open-stress ∪ (~n2 ⊆ tags($u, brivla-scan) ⟹ ~initial-stress)>
%conditions
  ~s2 ⊆ tags($m, brivla-scan),
  ~s0 ⊆ tags($u, brivla-scan),
  (~n2 ∪ ~n3) ∩ tags($u, brivla-scan) ≠ ∅

%rule brivla-word
  | gismu-form <~gismu ∪ ~onset>
  | $l(lujvo-form) <~lujvo ∪ ~onset>
  | $f(fuhivla-word) <~fuhivla ∪ (matches(head($f), consonant) ⟹ ~onset)>
%conditions
  ¬matches($l, has-comma)
```

A gismu is CVCCV with a permissible pair, or CCVCV with an initial pair (CLL 4.4). Here and below, C is a consonant, and V is one of `a e i o u`, never `y`.

```jbogenbau
%rule gismu-form
  | consonant vowel consonant-pair vowel
  | initial-pair vowel consonant vowel
```

## Lujvo

A lujvo is exactly what the algorithm of CLL 4.11 makes from two rafsi or more. Every rafsi but the last is CVC, CCV, CVV, CVCC or CCVC, and the last is CVV, CCV or a gismu form. CVV is a falling diphthong, or two vowels with an apostrophe between them. The algorithm puts a hyphen at a joint only where one is required:

- A `y` goes after a four-letter rafsi, CVCC or CCVC.
- A `y` goes between two consonants that form no permissible pair. A `y` also goes between `n` and a following `tc`, `ts`, `dj` or `dz`. Without the `y`, they make a triple that CLL 3.7 forbids. CLL 4.11 has no rule for that triple, and this is the completion that `junydji` needs.
- An `r` goes after a first CVV rafsi, unless the lujvo has two rafsi and the second is CCV, as in `saicli`. The hyphen is `n` before an `r`, as in `ro'inre'o`.
- The tosmabru test below can add one more `y`.

"It is illegal to add a hyphen at a place that is not required by this algorithm", so `rokyre'o` and `basykla` are not lujvo. With its needless `r` hyphen, `saircli` is no lujvo either, and it reads as a borrowing. Without the hyphen, `saicli` is a lujvo.

The rules below build the letters of a lujvo from the left, and they place each hyphen by its cause. `lujvo-rest` is the rafsi after a vowel or after an `r` or `n` hyphen, to the end of the word. `cvc-rest` is the part of a CVC or CVCC rafsi from its third letter, with the joint after it. A joint without a hyphen must be a permissible pair and must not make one of the four triples. A `y` at a joint must be required.

```jbogenbau
%rule lujvo-form
  | ccv-rafsi lujvo-rest
  | initial-pair vowel consonant /y/ lujvo-rest
  | consonant vowel lujvo-after-cv
  | consonant $a(vowel) $t(lujvo-after-cvv)
  | consonant vowel /'/ vowel cvv-first-rest
%conditions
  ¬matches($a, i-or-u),
  ¬matches($a, e-or-o) ∨ begins($t, falling-i)

%rule lujvo-after-cvv
  [/,/] i-or-u cvv-first-rest

%rule cvv-first-rest
  | ccv-rafsi
  | /r/ $r(lujvo-rest)
  | /n/ $n(lujvo-rest)
%conditions
  $r ≇ @(ccv-rafsi),
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
  consonant falling-vowels | consonant vowel /'/ vowel

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

The tosmabru test of CLL 4.11 decides whether a lujvo whose first rafsi is CVC needs one more `y` after it. Without that `y`, the word can fall apart into a cmavo and a shorter lujvo: `tosmabru` is `to smabru`, and the lujvo is `tosymabru`. The test starts from the lujvo with its required hyphens. It follows the CVC rafsi from the first one, across joints with no hyphen. It stops at the first required `y` or at the first rafsi that is not CVC.

If the test stops at a required `y`, it examines the joints before that `y`. So `tospatyta'a` needs `tosypatyta'a`, but `patyta'a` examines no joint and gets no second `y`.

Otherwise, the test applies only if the next rafsi is the last one, a CVCCV gismu form whose middle pair is an initial pair. It then examines the joints of the chain, the joint before the gismu, and the gismu's middle pair. So `tosmabru` needs its `y`, but `tosmabryklama` does not, because its `y` follows the four-letter `mabr`.

If the test examines at least one pair and every examined pair is an initial pair, it adds the `y` at the first joint. `lujvo-after-cv` is the part of a lujvo from the third letter of a first CVC or CVCC rafsi. Its first joint has no hyphen only if the test asks for none. A `y` there is either required or the one the test adds. `tosmabru-positive` is the test on the letters from the first joint, and `tosmabru-y` is the same test on a word that carries the added `y`. So `tospatytosmabru` is `to spatytosmabru`, and the lujvo is `tosypatytosmabru`.

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

No lujvo made this way breaks up, which is why the algorithm is as it is. A word's stress falls on its penultimate syllable, so a brivla inside it must reach its end. The words before that brivla must then be cmavo.

An initial CC leaves no cmavo to take. An initial CVCC or CVV rafsi leaves, after its hyphen, a rest that no word begins with. The CVV-CCV exception leaves a rest of one syllable. The tosmabru test catches an initial CVC whose rest reads as a lujvo. A rest that otherwise fits a borrowing fails the slinku'i test below, because the CV cmavo, put back in front of it, makes the lujvo.

## Borrowings

A borrowing, or fu'ivla, is a brivla that is neither a gismu nor a lujvo (CLL 4.7). It has no `y`, and it ends in a vowel. It has a consonant cluster among its first five letters, not counting apostrophes and commas.

A cluster at its start is an initial pair or a longer run of initial pairs. A cluster in its middle can be of any length. Each adjacent pair must be permissible, and a cluster must not hold any of the four `n` triples (CLL 4.7's `lerldjamo`). Its vowels can stand in any run, with apostrophes or commas between two of them. A comma is allowed only where the letters without it, with capitals lowered, also form a borrowing (see "Commas"). A run of vowels divides into syllables as [shapes.md](shapes.md) says, so `bantua` has two syllables, `ban-tua`, and the `korea` of `bangrkorea` has three.

A borrowing is also not "any combination of cmavo, gismu, and lujvo". CLL 17.4's `denpabu` shows what that means: the same spoken word, with the same syllables and stress, read as those words under the pause rules. Only one such reading is possible. It is one or more cmavo followed by one brivla, because a second brivla needs a second stress. The last word must begin with a consonant, and it can be a borrowing too, as in `abaspageti`, which is `a ba spageti`.

The stress of the candidate then falls on the penultimate syllable of that brivla, which is where the brivla has it. So `buklama` is `bu klama` and `aklama` is `a klama`. But `denpabu` is a borrowing, because the reading `denpa bu` stresses `DENpa`. `klamale` and `bantua` are borrowings for the same reason. `combination` states the reading as the letters alone, because the stress then needs no test.

The slinku'i test of CLL 4.7 says that a CV cmavo joined to the front of a borrowing must not make a lujvo. Otherwise, `pa slinku'i`, written together, reads as the lujvo `pas-lin-ku'i`. The test holds for every borrowing. A CV cmavo before a borrowing that begins with a consonant makes a first CVC rafsi, so the test asks whether the borrowing is `lujvo-after-cv`. Before a borrowing that begins with `i` or `u`, the CV makes a CVV rafsi, and the test asks whether it is `lujvo-after-cvv`. So `ikla` and `irklama` are no borrowings, because `paikla` and `pairklama` are lujvo.

```jbogenbau
%rule fuhivla-word
  $f(fuhivla-form)
%conditions
  matches($f, clustered-start),
  ¬matches($f, gismu-form),
  ¬matches($f, lujvo-form),
  ¬matches($f, lujvo-after-cv),
  ¬matches($f, lujvo-after-cvv),
  (~n2 ∪ ~n3) ∩ tags($f, brivla-scan) ≠ ∅,
  ¬matches($f, one-syllable),
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

A name is a nonempty run of letters that ends in a consonant (CLL 4.8), so `.rl.` is one. Every adjacent pair of its consonants is permissible, at its start too, and it can hold the four `n` triples (CLL 3.7). It can have `y` as a vowel, the diphthongs `iy` and `uy`, and an apostrophe or a comma between any two of its vowels.

CLL 4.8: "Names are not permitted to have the sequences la, lai, or doi embedded in them, unless the sequence is immediately preceded by a consonant". The reason is that a name after one of those words can follow it without a pause. So `.laplas.` and `.ilanas.` are not names, but `.nederlants.` is one. A comma removes no letter, so `.do,is.` is no name either.

Pauses surround a name (rules 2 and 4), so its shape carries neither `onset` nor `continued`. The grammar tags a name that begins with a consonant `name-onset`. Its first syllable is stressed if its first nucleus has a capital vowel. If no vowel is a capital, the stress falls where [shapes.md](shapes.md) says, which can be the first syllable. `.djan.` has one syllable, and it is stressed.

```jbogenbau
%rule cmevla-shape
  $n(cmevla)
    <(matches(head($n), consonant) ⟹ ~name-onset)
     ∪ (~first-marked ⊆ tags($n, name-scan)
        ∨ ~any-marked ⊈ tags($n, name-scan) ∧ ~first-counted ⊆ tags($n, name-scan)
          ∧ (~n1 ∪ ~n2) ∩ tags($n, name-scan) ≠ ∅
        ⟹ ~initial-stress)>
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
  /l/ any-a | /d/ any-o [/,/] any-i
```

## Commas

A comma between two vowels marks a syllable break (CLL 3.3, 3.5). It is the phoneme `/,/` of the phoneme stage, and a comma anywhere else is no phoneme. CLL 3.3 says that "no two Lojban words differ solely because of the presence or placement of a comma". So a comma never makes a word, and it never changes the class of a word.

Only a borrowing, a name or hesitation can hold a comma between two vowels. A cmavo, a gismu or a lujvo cannot. A word with such a comma must also be a word of the same class when its commas are removed and its capitals lowered. So `ma,i` and `ba,irgau` are no words, because `mai` is a cmavo and `bairgau` is a lujvo. `zda,i` is no word either, because `zdai` is none.

A run with such a word divides into no words, and the forms stage hands it on as one unread token ([forms.md](forms.md)). The word stage rejects that run unless it is inside a foreign quote or after `fa'o`.

The rules that test whether letters form a cmavo or a lujvo read a comma inside a diphthong as if it were absent. `cmavo-unit` and `cvv-rafsi` read `falling-vowels`. `vowel-cmavo` reads `rising-vowels`, and it reads `falling-vowels` through `cmavo-units`. `lujvo-form` and `lujvo-after-cvv` read a comma before the `i` or `u` that ends a first CVV rafsi. `cmavo-shape` and `brivla-word` then refuse a cmavo or a lujvo that has a comma.

The tests of "Borrowings" for a lujvo or a `combination` use these rules and treat such a comma as absent too. So `ba,iklama` is no borrowing, because `bai klama` is two words. `akru,a` is one borrowing, as `akrua` is, and not `a kru,a`. A borrowing needs two syllables without its commas, which `one-syllable` tests.

The stress marks and the pause rules read the syllables as written, with the breaks that the commas mark. `brivla-scan` and `name-scan` of [shapes.md](shapes.md) do not read a comma through. So `tcE,ila` is no word, because its capital is on the first of the three syllables `tce-i-la`. The check without commas also lowers the capitals, so the borrowing `zba,A,u` passes it as `zbaau`, although `zbaAu` is none. A comma can change the division of a text with capitals, while each word keeps its class. `zba,A,uklama` is `zba,A,u klama`, and `zbaAuklama` is `zbaAukla ma`.

A name needs one more test. CLL 4.8 forbids the letters `doi` at the start of a name or after a vowel in it, and a comma removes no letter. So `la-or-doi` finds `doi` across a comma, and `.do,is.` is no name. `.ndo,is.` is still a name, because a consonant comes before its `do,i`. Hesitation keeps its commas, as [forms.md](forms.md) says, so `y,y` is hesitation, as `yy` is.

```jbogenbau
%rule falling-vowels
  falling-diphthong | any-a /,/ any-i | any-e /,/ any-i | any-o /,/ any-i | any-a /,/ any-u

%rule rising-vowels
  rising-diphthong | i-or-u /,/ vowel

%rule falling-i
  [/,/] any-i

%rule one-syllable
  [consonants] syllable-vowels

%rule syllable-vowels
  vowel | falling-vowels | rising-vowels

%rule has-comma
  [any-letters] /,/ [any-letters]
```

## Where the book leaves a choice

In a few places CLL 1.1 is silent, or two passages disagree. This grammar reads each place as follows:

- Hyphens: CLL 4.11 says that "it is illegal to add a hyphen at a place that is not required by this algorithm". So a lujvo has a `y` only where the algorithm puts one, and `rokyre'o`, `basykla` and `lojybangri` are no lujvo. The algorithm has no rule for an `n` before `tc`, `ts`, `dj` or `dz`, and the `y` goes there, as in `junydji`.
- The slinku'i test holds for every borrowing, as CLL 4.7 states it, so `ikla` and `irklama` are no borrowings. A borrowing is also not a cmavo followed by a borrowing, which is one more way the book's promise of a single division can fail.
- A "combination of cmavo, gismu, and lujvo" (CLL 4.7) is the same spoken word, with its syllables and stress, as 17.4's `denpabu` shows. So `klamale` and `bantua` are borrowings.
- Stress and pauses: CLL 4.9 rule 5 asks for a pause after a stressed last syllable before a brivla. CLL 4.2 asks for one between two stressed syllables, whatever the words. "If the final syllable of one word is stressed, and the first syllable of the next word is stressed, you must insert a pause". Both hold, so `mIdO` needs a pause.
- Syllables: A syllabic consonant adds no syllable. So the first and last syllables of a word are those of its first and last written vowels, `y` included.
- An unmarked brivla is stressed on the penultimate syllable, counted to the next pause (CLL 3.9). So `klamacy.` is `klama cy.`, and `klamabu` is one borrowing, like `denpabu`.
- Capital letters: A capital on either letter of a diphthong, or on both, marks one stressed syllable, so `bAIkla` is a lujvo. A capital `Y` can mark stress in a name or a cmavo, whose stress can fall on any syllable. It never stands in a brivla, whose `y` is not counted.
- Vowels: CLL never says whether two vowels that form no diphthong can stand side by side. In a name or a borrowing they can, each its own syllable, as in `.aab.` and `paarku`. Usage before the PEG (parsing expression grammar) grammars had them.
- Vowels in a cmavo: A cmavo's vowels are single vowels and falling diphthongs joined by apostrophes (CLL 4.1, 4.2). A rising diphthong is a cmavo only as a whole word. So `seia`, `miui` and `kie` are no cmavo, and `sei'a` is one. An apostrophe or a comma can stand before a rising diphthong in a name, as in `.a'uas.`.
- Commas: A comma between two vowels only marks a syllable break, as CLL 3.5's `.me,iin.` and 4.7's `bang,r,kore,a` use it. It can stand only in a borrowing, a name or hesitation, and a word keeps its class with its commas removed and its capitals lowered. CLL 3.3 says that "no two Lojban words differ solely because of the presence or placement of a comma", and 7.15 has `kulnrsu,omi`. The stress marks read the syllables as written, so stress-marked text can divide differently, as in `zba,A,uklama`. Anywhere else a comma is not a letter.
- Written boundaries: CLL 3.3 lets a missing period be inferred, but not a missing word boundary. So a space or a period ends a word and counts as a pause, and no boundary is inferred where none is written. `miui` is no text, and `mi .ui` and `mi ui` are two words.
- `y` in a cmavo: The ten pairs `a'y`, `e'y`, `i'y`, `o'y`, `u'y`, `y'a`, `y'e`, `y'i`, `y'o` and `y'u` are cmavo. The word stage reads a longer cmavo with a `y` unit, such as `ka'y`, under the warning `y-cmavo`.
