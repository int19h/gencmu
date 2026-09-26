# Word shapes

This document is part of the word stage in the [CLL](../dialects/cll-ebnf.md) dialect. It holds the core of CLL's word forms: the shapes of gismu, lujvo and borrowings, the body of a name, the syllable structure, the vowels, and the consonant pairs and clusters of CLL chapter 3. It is stitched into the stage after [stream.md](stream.md) and before [cll.md](cll.md), which defines the three word shapes that the stream reads, `cmavo-shape`, `brivla-shape` and `cmevla-shape`, and adds what CLL allows beyond these shapes, such as a glide after a consonant and the longer clusters of a borrowing. The other dialects read the approved word forms of [bpfk.md](bpfk.md) instead, which translate their own grammar rule by rule and use nothing here. The notation is explained in [the notation document](../../docs/notation.md).

## Cmevla

A name is any run of syllables ending in a consonant (CLL 4.8). It may run several consonants together and may put an apostrophe between any two vowels, `y` included, as in `.dyny'abub.`.

```jbogenbau
%rule cmevla
  cmevla-with-onset | cmevla-without-onset

%rule cmevla-with-onset
  cmevla-run cmevla-body | glide cmevla-body | cmevla-run

%rule cmevla-without-onset
  cmevla-body

%rule cmevla-body
  | cmevla-nucleus cmevla-run
  | cmevla-nucleus cmevla-consonants cmevla-body
  | cmevla-nucleus /'/ cmevla-body

%rule cmevla-nucleus
  free-nucleus | any-y

%rule free-nucleus
  free-vowel | free-diphthong

%rule cmevla-consonants
  cmevla-run | glide
```

A run of consonants inside or at the end of a name, `cmevla-run`, is held to the table of permissible pairs. CLL 3.6 says that the pair rules "apply to all kinds of words, even Lojbanized names", and CLL 3.7 lets a name have triples and longer clusters anywhere, as long as each adjacent pair is permissible. So `.tlaiv.` and `.ekstcat.` are names, but `.djeimz.` and `.bobb.` are not.

```jbogenbau
%rule cmevla-run
  permissible-run
```

A permissible run is built from the pairs of CLL 3.6: a run ending in a consonant is that consonant alone, or a run ending in one of the consonants that may precede it, followed by it. The `after-x` tables under "Consonants" list the same pairs from the other side.

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

## Brivla

A brivla is a gismu, a lujvo built from rafsi, or a borrowing. CLL 4.7: a lone CVV word is a cmavo, so a CVV final rafsi is a brivla core only when some rafsi precedes it. CLL 4.6: a lujvo that begins with a CVV rafsi takes an r-hyphen, precisely so that the word cannot be read as a CVV cmavo followed by a brivla, as `zo'ecusku` would be. The one exception is a two-part lujvo whose second rafsi is CCV, such as `je'atru`: its rest is no word, so it cannot fall apart. The hyphen is therefore part of the rule for the first rafsi, and optional for any rafsi after it. The `basic` rafsi are the ones of CLL 4.5 and 4.6; `first-rafsi` and `initial-rafsi` are what a lujvo is built from. `rafsi-string`, the string that the slinku'i test and the borrowing rules look for, is built from the same rafsi, and takes any of them first, hyphen or no hyphen: the test asks whether the letters look like rafsi, not whether they make a well-formed lujvo, so that `camri'ojvebla` is a lujvo and not `ca` before a borrowing.

```jbogenbau
%rule brivla-with-onset
  word-initial-core | first-rafsi lujvo-tail

%rule lujvo-tail
  brivla-core | initial-rafsi lujvo-tail

%rule brivla-core
  bare-brivla-core | cvv-final-rafsi

%rule bare-brivla-core
  | gismu
  | stressed-initial-rafsi short-final-rafsi
  | $borrowing(fuhivla-with-onset)
%conditions
  ¬matches(tail($borrowing), rafsi-string)

%rule word-initial-core
  | gismu | word-initial-stressed-rafsi short-final-rafsi
  | consonant stressed-cvv-body ccv-final-rafsi | $borrowing(fuhivla-with-onset)
%conditions
  ¬matches(tail($borrowing), rafsi-string),
  ¬matches($borrowing, broken-word)

%rule rafsi-string
  | rafsi-core
  | basic-initial-rafsi rafsi-core
  | basic-initial-rafsi basic-initial-rafsi-sequence rafsi-core

%rule basic-initial-rafsi-sequence
  basic-initial-rafsi | basic-initial-rafsi basic-initial-rafsi-sequence

%rule rafsi-core
  gismu | stressed-initial-rafsi short-final-rafsi | cvv-final-rafsi

%rule first-rafsi
  basic-first-rafsi

%rule basic-first-rafsi
  y-rafsi | cvc-rafsi | ccv-rafsi | consonant cvv-body r-hyphen
```

The stressed vowel of a brivla is the one in its penultimate syllable, which is the first vowel of the core. Every rafsi before the core is unstressed, which is why those rules use the plain vowel letters only. A y-hyphen carries no stress of its own, so the syllable before it is the stressed one: `bajykla` is stressed on `ba`.

```jbogenbau
%rule gismu
  | initial-pair stressed-vowel consonant plain-vowel
  | consonant stressed-vowel consonant-pair plain-vowel

%rule cvv-final-rafsi
  consonant stressed-vowel /'/ plain-vowel

%rule short-final-rafsi
  consonant plain-diphthong | ccv-final-rafsi

%rule ccv-final-rafsi
  initial-pair plain-vowel

%rule word-initial-stressed-rafsi
  | consonant stressed-vowel consonant | initial-pair stressed-vowel
  | consonant stressed-cvv-body r-hyphen | stressed-y-rafsi

%rule stressed-initial-rafsi
  | consonant stressed-vowel consonant | initial-pair stressed-vowel
  | consonant stressed-cvv-body [r-hyphen] | stressed-y-rafsi

%rule stressed-y-rafsi
  stressed-long-rafsi hyphen-y | consonant stressed-vowel consonant hyphen-y

%rule stressed-long-rafsi
  initial-pair stressed-vowel consonant | consonant stressed-vowel consonant-pair

%rule stressed-cvv-body
  plain-vowel /'/ stressed-vowel | stressed-diphthong
```

The unstressed rafsi before the core are the CVC, CCV and CVV forms of CLL 4.5, with the y-hyphen and the r-hyphen of CLL 4.6, and the four-letter forms that a y-hyphen always follows. [cll.md](cll.md) defines the y-hyphen, `hyphen-y`. No apostrophe follows the y-hyphen before a consonant, so `bajy'kla` is not a word. A rafsi with an apostrophe before the `y`, such as `bai'y`, builds no lujvo: CLL 4.6 has no such hyphen.

```jbogenbau
%rule initial-rafsi
  basic-initial-rafsi

%rule basic-initial-rafsi
  y-rafsi | cvc-rafsi | ccv-rafsi | cvv-rafsi

%rule cvc-rafsi
  consonant plain-vowel consonant

%rule ccv-rafsi
  initial-pair plain-vowel

%rule cvv-rafsi
  consonant cvv-body [r-hyphen]

%rule cvv-body
  plain-vowel /'/ plain-vowel | plain-diphthong

%rule long-rafsi
  initial-pair plain-vowel consonant | consonant plain-vowel consonant-pair

%rule y-rafsi
  long-rafsi hyphen-y | cvc-rafsi hyphen-y


%rule r-hyphen
  /r/ | /n/
```

## Fu'ivla

A borrowing is any run of syllables with penultimate stress that is not built from rafsi; the head syllables are unstressed. CLL 4.7's slinku'i test says what "not built from rafsi" excludes: a borrowing that begins with a consonant may not be that consonant followed by a string of rafsi. Otherwise `pa slinku'i`, written together, would also read as the lujvo `pas-lin-ku'i`. That is stated where a borrowing enters a brivla: its tail, the borrowing without its first letter, must not parse as `rafsi-string`, the lujvo and gismu shapes given under "Brivla". So `snuncatra` is no word, and `xisnuncatra` is the lujvo `xis-nun-catra`. CLL 4.7 requires a consonant cluster: an initial pair supplies one, and otherwise some medial run must be a cluster, and the rules below say where the first one falls. Without this a clusterless run such as `.ijeba` would parse as one borrowing instead of as the cmavo it is made of. A borrowing that begins with a consonant has three syllables or more, or two that no gismu could have: a cluster longer than a pair, a diphthong before the cluster, as in `durnli` and `raunzu`, an initial pair followed by two syllables that are not a gismu's, as in `ctremna` and `clause`, which the condition tests, or an initial triple. A borrowing that begins with a glide or a vowel cannot be built from rafsi, so two syllables suffice; `audji` in CLL chapter 22 begins with a vowel. An apostrophe may separate two vowels of a borrowing, as in `ni'ongo`, each its own syllable.

```jbogenbau
%rule fuhivla-with-onset
  | initial-cluster fuhivla-long-body
  | $p(pair-borrowing) | initial-triple fuhivla-short-body
  | consonant fuhivla-long-clustered-body
  | consonant fuhivla-two-syllables
  | glide fuhivla-clustered-body
%conditions
  ¬matches($p, gismu)

%rule pair-borrowing
  initial-pair fuhivla-short-body

%rule fuhivla-without-onset
  fuhivla-clustered-body

%rule fuhivla-two-syllables
  | stressed-nucleus long-cluster plain-nucleus
  | stressed-diphthong $p(consonant-pair) plain-vowel
%conditions
  ¬matches($p, initial-pair)

%rule fuhivla-long-body
  fuhivla-head fuhivla-short-body

%rule fuhivla-long-clustered-body
  fuhivla-clustered-head fuhivla-short-body | fuhivla-clean-head fuhivla-clustered-short-body

%rule fuhivla-clustered-body
  | fuhivla-clustered-short-body
  | fuhivla-clustered-head fuhivla-short-body
  | fuhivla-clean-head fuhivla-clustered-short-body

%rule fuhivla-short-body
  stressed-nucleus medial-consonants plain-nucleus | stressed-nucleus /'/ plain-nucleus

%rule fuhivla-clustered-short-body
  stressed-nucleus clustered-onset plain-nucleus

%rule fuhivla-head
  fuhivla-head-part | fuhivla-head-part fuhivla-head

%rule fuhivla-head-part
  plain-nucleus medial-consonants | plain-nucleus /'/

%rule fuhivla-clean-head
  | plain-nucleus consonant | plain-nucleus consonant fuhivla-clean-head
  | plain-nucleus /'/ | plain-nucleus /'/ fuhivla-clean-head

%rule fuhivla-clustered-head
  | plain-nucleus clustered-onset | plain-nucleus clustered-onset fuhivla-head
  | plain-nucleus consonant fuhivla-clustered-head | plain-nucleus /'/ fuhivla-clustered-head

%rule clustered-onset
  consonant-cluster
```

A borrowing is also not a run of words. CLL 4.7 says that a borrowing "must not be gismu or lujvo, or any combination of cmavo, gismu, and lujvo". So a borrowing may not parse as `broken-word`, a cmavo joined without a pause to a following word, which is a cmavo followed by more, or a brivla: `buklama` is `bu klama` and `aklama` is `a klama`. The test is part of what a word is, and not left to the choice among parses, which would keep `buklama` whole wherever `bu` could not act, since it compares only parses that succeed.

```jbogenbau
%rule broken-word
  $c(cmavo-shape) $w(broken-rest)
%conditions
  "continued" ∈ tags($c),
  "onset" ∈ tags($w)

%rule broken-rest
  | $b(brivla-shape) <tags($b)>
  | $c(cmavo-shape) $w(broken-rest) <tags($c)>
%conditions
  "continued" ∈ tags($c),
  "onset" ∈ tags($w)
```

A two-syllable borrowing whose consonant pair may begin a word, `maikro`, is a CVV rafsi followed by a CCV rafsi, which is a lujvo; so the borrowing form requires a pair that may not begin a word.

## Checks on a whole word

Some rules are easier to state over a whole word than inside its structure, and [cll.md](cll.md) applies them to its brivla. `bad-joint` finds two consonants side by side that are not a permissible pair of CLL 3.6, at a joint between rafsi as well as inside a borrowing, and an `n` followed by `tc`, `ts`, `dj` or `dz`, which CLL 3.7 forbids in a triple. So `kabkla`, `patta'a` and `kallxa` are not words. A `y` between two consonants separates them, so `bisycla` has no such pair. `stress-marked` finds a capital vowel, which marks the stress. A capital `Y` does not mark stress, since `y` is never stressed (CLL 3.9). `final-stressed` finds a word whose last syllable is stressed: a capital vowel at its end, or before the last letter of a falling diphthong.

```jbogenbau
%rule bad-joint
  | [any-letters] $p(consonant-duo) [any-letters]
  | n-affricate-word
%conditions
  ¬matches($p, consonant-pair)

%rule consonant-duo
  consonant consonant

%rule n-affricate-word
  [any-letters] n-affricate [any-letters]

%rule n-affricate
  /n/ /t/ /c/ | /n/ /t/ /s/ | /n/ /d/ /j/ | /n/ /d/ /z/

%rule stress-marked
  [any-letters] (/A/ | /E/ | /I/ | /O/ | /U/) [any-letters]

%rule final-stressed
  [any-letters] (/A/ | /E/ | /I/ | /O/ | /U/) [/i/ | /u/ | /I/ | /U/]

%rule any-letters
  any-letter | any-letter any-letters

%rule any-letter
  consonant | free-vowel | /y/ | /Y/ | /'/
```

## Nuclei and syllable structure

A nucleus is a vowel or a diphthong; `y` is not a nucleus here, since inside a word it appears only as a lujvo hyphen or in a name, never as the vowel of an ordinary syllable. A glide begins a syllable just as a consonant does, as in the name `nuiork`. CLL 3.4 also admits the on-glide diphthongs after a consonant or a cluster in names and borrowings, as in `kuarka`, and [cll.md](cll.md) adds those alternatives. The consonants between two nuclei are one consonant, a glide, or a cluster. CLL 4.7 lets a cluster in a borrowing be longer than CLL 3.7 allows elsewhere, and [cll.md](cll.md) says what a cluster is: any run of two consonants or more, whose adjacent pairs the check of the whole word holds to the table. CLL 3.4 lets `l`, `m`, `n` and `r` be syllabic between consonants, as in `.rubnstain.` and `cidjrpitsa`; such a consonant is one more consonant of the run.

```jbogenbau
%rule stressed-nucleus
  stressed-vowel | stressed-diphthong

%rule plain-nucleus
  plain-vowel | plain-diphthong

%rule medial-consonants
  consonant | consonant-cluster | glide

%rule glide
  /i/ | /u/ | /I/ | /U/
```

## Vowels

The plain vowels are the unmarked letters, which a position that may not bear stress accepts. A position that may bear stress accepts the marked letters as well, and a position whose stress is free, in a cmavo or a cmevla, accepts either. The four falling diphthongs of CLL 3.4 follow the same three-way division; a free diphthong may also have a capital as its second letter, or be written in capitals throughout, as a name's may be.

```jbogenbau
%rule plain-vowel
  /a/ | /e/ | /i/ | /o/ | /u/

%rule stressed-vowel
  /a/ | /e/ | /i/ | /o/ | /u/ | /A/ | /E/ | /I/ | /O/ | /U/

%rule free-vowel
  plain-vowel | /A/ | /E/ | /I/ | /O/ | /U/

%rule plain-diphthong
  /a/ /i/ | /a/ /u/ | /e/ /i/ | /o/ /i/

%rule stressed-diphthong
  plain-diphthong | /A/ /i/ | /A/ /u/ | /E/ /i/ | /O/ /i/

%rule free-diphthong
  stressed-diphthong | /A/ /I/ | /A/ /U/ | /E/ /I/ | /O/ /I/ | /a/ /I/ | /a/ /U/ | /e/ /I/ | /o/ /I/
```

A cmavo's diphthong and a brivla's are one constituent: `free-diphthong` is built on `stressed-diphthong` and that on `plain-diphthong`, rather than spelling the same vowels again. So where a text could begin with a CVV cmavo or with a brivla that starts the same way, the two parses agree on the diphthong and first differ where the cmavo ends and the brivla reads on, and the stage's lazy lean ends the word there: `causelzdi` is `cau selzdi`, as CLL 4.6 requires of a brivla that would break into a cmavo and a valid brivla.

## Consonants

The 48 permissible initial pairs of CLL 3.7 may begin a word or a syllable, and so may a longer run in which each adjacent pair is an initial pair (CLL 4.7), as in `ctremna`, which [cll.md](cll.md) defines as `initial-triple`. The permissible adjacent pairs of CLL 3.6 may stand anywhere inside a brivla: never the same consonant twice, never a voiced and an unvoiced consonant together, and never one of the listed exceptions, which is what the `after-x` table for each consonant says.

```jbogenbau
%rule consonant
  | /b/
  | /c/
  | /d/
  | /f/
  | /g/
  | /j/
  | /k/
  | /l/
  | /m/
  | /n/
  | /p/
  | /r/
  | /s/
  | /t/
  | /v/
  | /x/
  | /z/

%rule initial-pair
  | /b/ /l/ | /b/ /r/
  | /c/ /f/ | /c/ /k/ | /c/ /l/ | /c/ /m/ | /c/ /n/ | /c/ /p/ | /c/ /r/ | /c/ /t/
  | /d/ /j/ | /d/ /r/ | /d/ /z/
  | /f/ /l/ | /f/ /r/
  | /g/ /l/ | /g/ /r/
  | /j/ /b/ | /j/ /d/ | /j/ /g/ | /j/ /m/ | /j/ /v/
  | /k/ /l/ | /k/ /r/
  | /m/ /l/ | /m/ /r/
  | /p/ /l/ | /p/ /r/
  | /s/ /f/ | /s/ /k/ | /s/ /l/ | /s/ /m/ | /s/ /n/ | /s/ /p/ | /s/ /r/ | /s/ /t/
  | /t/ /c/ | /t/ /r/ | /t/ /s/
  | /v/ /l/ | /v/ /r/
  | /x/ /l/ | /x/ /r/
  | /z/ /b/ | /z/ /d/ | /z/ /g/ | /z/ /m/ | /z/ /v/

%rule initial-cluster
  initial-pair | initial-triple

%rule consonant-pair
  | /b/ after-b | /c/ after-c | /d/ after-d | /f/ after-f | /g/ after-g | /j/ after-j
  | /k/ after-k | /l/ after-l | /m/ after-m | /n/ after-n | /p/ after-p | /r/ after-r
  | /s/ after-s | /t/ after-t | /v/ after-v | /x/ after-x | /z/ after-z

%rule after-b
  /d/ | /g/ | /j/ | /v/ | /z/ | /l/ | /m/ | /n/ | /r/

%rule after-d
  /b/ | /g/ | /j/ | /v/ | /z/ | /l/ | /m/ | /n/ | /r/

%rule after-g
  /b/ | /d/ | /j/ | /v/ | /z/ | /l/ | /m/ | /n/ | /r/

%rule after-v
  /b/ | /d/ | /g/ | /j/ | /z/ | /l/ | /m/ | /n/ | /r/

%rule after-j
  /b/ | /d/ | /g/ | /v/ | /l/ | /m/ | /n/ | /r/

%rule after-z
  /b/ | /d/ | /g/ | /v/ | /l/ | /m/ | /n/ | /r/

%rule after-c
  /f/ | /k/ | /p/ | /t/ | /l/ | /m/ | /n/ | /r/

%rule after-s
  /f/ | /k/ | /p/ | /t/ | /x/ | /l/ | /m/ | /n/ | /r/

%rule after-x
  /f/ | /p/ | /s/ | /t/ | /l/ | /m/ | /n/ | /r/

%rule after-k
  /c/ | /f/ | /p/ | /s/ | /t/ | /l/ | /m/ | /n/ | /r/

%rule after-f
  /c/ | /k/ | /p/ | /s/ | /t/ | /x/ | /l/ | /m/ | /n/ | /r/

%rule after-p
  /c/ | /f/ | /k/ | /s/ | /t/ | /x/ | /l/ | /m/ | /n/ | /r/

%rule after-t
  /c/ | /f/ | /k/ | /p/ | /s/ | /x/ | /l/ | /m/ | /n/ | /r/

%rule after-l
  /b/ | /c/ | /d/ | /f/ | /g/ | /j/ | /k/ | /m/ | /n/ | /p/ | /r/ | /s/ | /t/ | /v/ | /x/ | /z/

%rule after-r
  /b/ | /c/ | /d/ | /f/ | /g/ | /j/ | /k/ | /l/ | /m/ | /n/ | /p/ | /s/ | /t/ | /v/ | /x/ | /z/

%rule after-m
  /b/ | /c/ | /d/ | /f/ | /g/ | /j/ | /k/ | /l/ | /n/ | /p/ | /r/ | /s/ | /t/ | /v/ | /x/

%rule after-n
  /b/ | /c/ | /d/ | /f/ | /g/ | /j/ | /k/ | /l/ | /m/ | /p/ | /r/ | /s/ | /t/ | /v/ | /x/ | /z/
```
