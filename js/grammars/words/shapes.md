## The word shapes shared by every family

This document holds the parts of the word grammar that every family of Lojban morphology states the same way: the shapes of gismu, lujvo and borrowings, the body of a name, the syllable structure, the vowels, and the consonant pairs and clusters of CLL chapter 3. It is stitched into the word stage after `stream.md` and before the family document, `cll.md` or `bpfk.md`, which defines the three word shapes the stream reads, `cmavo-shape`, `brivla-shape` and `cmevla-shape`, and adds or withholds alternatives here where the families differ: the family document is where a consonant may or may not be followed by a glide, where the consonant runs a name may carry are set, and where the definition effort's extended rafsi enter. The notation is explained in `notation.md`.

### Cmevla

A name is any run of syllables ending in a consonant (CLL 4.8). It may run several consonants together and may put an apostrophe between any two vowels, `y` included, as in `.dyny'abub.`.

```ebnf
cmevla
≔ cmevla-with-onset | cmevla-without-onset ;

cmevla-with-onset
≔ cmevla-run cmevla-body
| glide cmevla-body
| cmevla-run ;

cmevla-without-onset
≔ cmevla-body ;

cmevla-body
≔ cmevla-nucleus cmevla-run
| cmevla-nucleus cmevla-consonants cmevla-body
| cmevla-nucleus /'/ cmevla-body ;

cmevla-nucleus
≔ free-nucleus | y ;

free-nucleus
≔ free-vowel | free-diphthong ;

cmevla-consonants
≔ cmevla-run | glide ;
```

What a run of consonants inside or at the end of a name may be, `cmevla-run`, is the family's decision: CLL's names carry whatever runs their source has, and the definition effort's grammar holds a name's pairs to the same table as a brivla's. The family document defines it.

### Brivla

A brivla is a gismu, a lujvo built from rafsi, or a borrowing. CLL 4.7: a lone CVV word is a cmavo, so a CVV final rafsi is a brivla core only when some rafsi precedes it. CLL 4.6: a lujvo that begins with a CVV rafsi takes an r-hyphen, precisely so that the word cannot be read as a CVV cmavo followed by a brivla, as `zo'ecusku` would be. The one exception is a two-part lujvo whose second rafsi is CCV, such as `je'atru`: its rest is no word, so it cannot fall apart. The hyphen is therefore part of the rule for the first rafsi, and optional for any rafsi after it. The `basic` rafsi are the ones of CLL 4.5 and 4.6; `first-rafsi` and `initial-rafsi` are what a lujvo is built from, and a family may add to them, as `bpfk.md` adds the extended rafsi, while `rafsi-string`, the string that the slinku'i test and the borrowing rules look for, stays over the basic rafsi, as the approved grammar's `rafsi_string` does, and takes any of them first, hyphen or no hyphen: the test asks whether the letters look like rafsi, not whether they make a well-formed lujvo, so that `camri'ojvebla` is a lujvo and not `ca` before a borrowing, as jbotci reads it.

```ebnf
brivla-with-onset
≔ word-initial-core
| first-rafsi brivla-core
| first-rafsi initial-rafsi-sequence brivla-core ;

initial-rafsi-sequence
≔ initial-rafsi | initial-rafsi initial-rafsi-sequence ;

brivla-core
≔ bare-brivla-core | cvv-final-rafsi ;

bare-brivla-core
≔ gismu
| stressed-initial-rafsi short-final-rafsi
| $borrowing(fuhivla-with-onset)
: ¬matches(tail($borrowing), rafsi-string) ;

word-initial-core
≔ gismu | word-initial-stressed-rafsi short-final-rafsi
| consonant stressed-cvv-body ccv-final-rafsi | $borrowing(fuhivla-with-onset)
: ¬matches(tail($borrowing), rafsi-string) ;

rafsi-string
≔ rafsi-core
| basic-initial-rafsi rafsi-core
| basic-initial-rafsi basic-initial-rafsi-sequence rafsi-core ;

basic-initial-rafsi-sequence
≔ basic-initial-rafsi | basic-initial-rafsi basic-initial-rafsi-sequence ;

rafsi-core
≔ gismu
| stressed-initial-rafsi short-final-rafsi
| cvv-final-rafsi ;

first-rafsi
≔ basic-first-rafsi ;

basic-first-rafsi
≔ y-rafsi
| hy-rafsi
| cvc-rafsi
| ccv-rafsi
| consonant cvv-body r-hyphen ;
```

The stressed vowel of a brivla is the one in its penultimate syllable, which is the first vowel of the core. Every rafsi before the core is unstressed, which is why those rules use the plain vowel letters only. A y-hyphen carries no stress of its own, so the syllable before it is the stressed one: `bajykla` is stressed on `ba`.

```ebnf
gismu
≔ initial-pair stressed-vowel consonant plain-vowel
| consonant stressed-vowel consonant-pair plain-vowel ;

cvv-final-rafsi
≔ consonant stressed-vowel /'/ plain-vowel ;

short-final-rafsi
≔ consonant plain-diphthong | ccv-final-rafsi ;

ccv-final-rafsi
≔ initial-pair plain-vowel ;

word-initial-stressed-rafsi
≔ consonant stressed-vowel consonant | initial-pair stressed-vowel
| consonant stressed-cvv-body r-hyphen | stressed-y-rafsi ;

stressed-initial-rafsi
≔ consonant stressed-vowel consonant | initial-pair stressed-vowel
| consonant stressed-cvv-body [r-hyphen] | stressed-y-rafsi ;

stressed-y-rafsi
≔ stressed-long-rafsi y [/'/]
| consonant stressed-vowel consonant y [/'/] ;

stressed-long-rafsi
≔ initial-pair stressed-vowel consonant
| consonant stressed-vowel consonant-pair ;

stressed-cvv-body
≔ plain-vowel /'/ stressed-vowel | stressed-diphthong ;
```

The unstressed rafsi before the core are the CVC, CCV and CVV forms of CLL 4.5, with the y-hyphen and the r-hyphen of CLL 4.6, and the four-letter and five-letter forms that a y-hyphen always follows.

```ebnf
initial-rafsi
≔ basic-initial-rafsi ;

basic-initial-rafsi
≔ y-rafsi | hy-rafsi | cvc-rafsi | ccv-rafsi | cvv-rafsi ;

cvc-rafsi
≔ consonant plain-vowel consonant ;

ccv-rafsi
≔ initial-pair plain-vowel ;

cvv-rafsi
≔ consonant cvv-body [r-hyphen] ;

cvv-body
≔ plain-vowel /'/ plain-vowel | plain-diphthong ;

long-rafsi
≔ initial-pair plain-vowel consonant
| consonant plain-vowel consonant-pair ;

y-rafsi
≔ long-rafsi y [/'/] | cvc-rafsi y [/'/] ;

hy-rafsi
≔ long-rafsi plain-vowel /'/ y [/'/]
| ccv-rafsi /'/ y [/'/]
| cvv-rafsi /'/ y [/'/] ;

r-hyphen
≔ /r/ | /n/ ;
```

### Fu'ivla

A borrowing is any run of syllables with penultimate stress that is not built from rafsi; the head syllables are unstressed. CLL 4.7's slinku'i test says what "not built from rafsi" excludes: a borrowing that begins with a consonant may not be that consonant followed by a string of rafsi, since `slinku'i` would otherwise be inseparable from `pa slinku'i` read as `pa` and the lujvo `slinku'i`. That is stated where a borrowing enters a brivla: its tail, the borrowing without its first letter, must not parse as `rafsi-string`, the lujvo and gismu shapes given under "Brivla". So `snuncatra` is no word, and `xisnuncatra` is the lujvo `xis-nun-catra`. CLL 4.7 requires a consonant cluster: an initial pair supplies one, and otherwise some medial run must be a cluster, and the rules below say where the first one falls. Without this a clusterless run such as `.ijeba` would parse as one borrowing instead of as the cmavo it is made of. A borrowing that begins with a consonant has three syllables or more, or two that no gismu could have: a cluster longer than a pair, a diphthong before the cluster, as in `durnli` and `raunzu`, an initial pair followed by two syllables that are not a gismu's, as in `ctremna` and `clause`, which the condition tests, or an initial triple. A borrowing that begins with a glide or a vowel cannot be built from rafsi, so two syllables suffice; `audji` in CLL chapter 22 begins with a vowel. An apostrophe may separate two vowels of a borrowing, as in `ni'ongo`, each its own syllable.

```ebnf
fuhivla-with-onset
≔ initial-cluster fuhivla-long-body
| $p(pair-borrowing) | initial-triple fuhivla-short-body
| consonant fuhivla-long-clustered-body
| consonant fuhivla-two-syllables
| glide fuhivla-clustered-body
: ¬matches($p, gismu) ;

pair-borrowing
≔ initial-pair fuhivla-short-body ;

fuhivla-without-onset
≔ fuhivla-clustered-body ;

fuhivla-two-syllables
≔ stressed-nucleus long-cluster plain-nucleus
| stressed-diphthong consonant-pair plain-vowel ;

long-cluster
≔ medial-triple | medial-quad | syllabic-cluster ;

fuhivla-long-body
≔ fuhivla-head fuhivla-short-body ;

fuhivla-long-clustered-body
≔ fuhivla-clustered-head fuhivla-short-body
| fuhivla-clean-head fuhivla-clustered-short-body ;

fuhivla-clustered-body
≔ fuhivla-clustered-short-body
| fuhivla-clustered-head fuhivla-short-body
| fuhivla-clean-head fuhivla-clustered-short-body ;

fuhivla-short-body
≔ stressed-nucleus medial-consonants plain-nucleus
| stressed-nucleus /'/ plain-nucleus ;

fuhivla-clustered-short-body
≔ stressed-nucleus clustered-onset plain-nucleus ;

fuhivla-head
≔ fuhivla-head-part | fuhivla-head-part fuhivla-head ;

fuhivla-head-part
≔ plain-nucleus medial-consonants | plain-nucleus /'/ ;

fuhivla-clean-head
≔ plain-nucleus consonant | plain-nucleus consonant fuhivla-clean-head
| plain-nucleus /'/ | plain-nucleus /'/ fuhivla-clean-head ;

fuhivla-clustered-head
≔ plain-nucleus clustered-onset | plain-nucleus clustered-onset fuhivla-head
| plain-nucleus consonant fuhivla-clustered-head | plain-nucleus /'/ fuhivla-clustered-head ;

clustered-onset
≔ consonant-cluster ;
```

### Nuclei and syllable structure

A nucleus is a vowel or a diphthong; `y` is not a nucleus here, since inside a word it appears only as a lujvo hyphen or in a name, never as the vowel of an ordinary syllable. A glide begins a syllable just as a consonant does, as in the name `nuiork`. Whether it may also follow a consonant or a cluster, as in `.atkuila`, is where the families part: CLL 3.5 admits the on-glide diphthongs in names and borrowings, and `cll.md` adds those alternatives; the definition effort's grammar bans a glide after a consonant, and `bpfk.md` adds nothing. The consonants between two nuclei are one consonant, a permissible pair, a triple or quadruple, or a cluster around a syllabic consonant. CLL 3.7 gives the rule for a medial triple: its first two consonants are a permissible pair, its last two a permissible initial pair, and `ndj`, `ndz`, `ntc` and `nts` are excluded; a quadruple is a consonant before a permissible initial triple under the same pair condition. The tables `before-x` list, for each consonant, the consonants that may precede it in a permissible pair, and the triples and quadruples are spelled out from them so that every one is checked. CLL 3.4 lets `l`, `m`, `n` and `r` be syllabic between consonants, as in `.rubnstain.` and `cidjrpitsa`; what follows the syllabic consonant is the next syllable's onset.

```ebnf
stressed-nucleus
≔ stressed-vowel | stressed-diphthong ;

plain-nucleus
≔ plain-vowel | plain-diphthong ;

medial-consonants
≔ consonant
| consonant-cluster
| glide ;

consonant-cluster
≔ consonant-pair
| medial-triple
| medial-quad
| syllabic-cluster ;

syllabic-cluster
≔ before-syllabic syllabic after-syllabic ;

syllabic
≔ /l/ | /m/ | /n/ | /r/ ;

before-syllabic
≔ consonant | consonant-pair ;

after-syllabic
≔ consonant | initial-cluster ;

glide
≔ /i/ | /u/ | /I/ | /U/ ;
```

### Vowels

The plain vowels are the unmarked letters, which a position that may not bear stress accepts. A position that may bear stress accepts the marked letters as well, and a position whose stress is free, in a cmavo or a cmevla, accepts either. The four falling diphthongs of CLL 3.5 follow the same three-way division; a free diphthong may also be written in capitals throughout, as a name's may be. The `any-` rules are what the lexicon documents spell their words with, since a cmavo's stress is free.

```ebnf
plain-vowel
≔ /a/ | /e/ | /i/ | /o/ | /u/ ;

stressed-vowel
≔ /a/ | /e/ | /i/ | /o/ | /u/ | /A/ | /E/ | /I/ | /O/ | /U/ ;

free-vowel
≔ plain-vowel | /A/ | /E/ | /I/ | /O/ | /U/ ;

plain-diphthong
≔ /a/ /i/ | /a/ /u/ | /e/ /i/ | /o/ /i/ ;

stressed-diphthong
≔ plain-diphthong | /A/ /i/ | /A/ /u/ | /E/ /i/ | /O/ /i/ ;

free-diphthong
≔ /a/ /i/ | /a/ /u/ | /e/ /i/ | /o/ /i/ | /A/ /i/ | /A/ /u/ | /E/ /i/ | /O/ /i/ | /A/ /I/ | /A/ /U/ | /E/ /I/ | /O/ /I/ ;

any-a
≔ /a/ | /A/ ;

any-e
≔ /e/ | /E/ ;

any-i
≔ /i/ | /I/ ;

any-o
≔ /o/ | /O/ ;

any-u
≔ /u/ | /U/ ;

any-y
≔ /y/ | /Y/ ;
```

### Consonants

The 48 permissible initial pairs of CLL 3.7 may begin a word or a syllable, and so may an initial triple: a sibilant, then a stop or nasal, then a liquid, where both adjacent pairs are permissible initial pairs, as in `ctremna` and `strema`; that is the pattern the camxes grammar states for an initial cluster. The permissible adjacent pairs of CLL 3.6 may stand anywhere inside a brivla: never the same consonant twice, never a voiced and an unvoiced consonant together, and never one of the listed exceptions, which is what the `after-x` table for each consonant says; the `before-x` tables are the same pairs read from the other side.

```ebnf
consonant
≔ /b/ | /c/ | /d/ | /f/ | /g/ | /j/ | /k/ | /l/ | /m/ | /n/ | /p/ | /r/ | /s/ | /t/ | /v/ | /x/ | /z/ ;

initial-pair
≔ /b/ /l/ | /b/ /r/
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
| /z/ /b/ | /z/ /d/ | /z/ /g/ | /z/ /m/ | /z/ /v/ ;

initial-cluster
≔ initial-pair | initial-triple ;

initial-triple
≔ /c/ /f/ /l/ | /c/ /f/ /r/ | /c/ /k/ /l/ | /c/ /k/ /r/ | /c/ /m/ /l/ | /c/ /m/ /r/ | /c/ /p/ /l/ | /c/ /p/ /r/ | /c/ /t/ /r/
| /s/ /f/ /l/ | /s/ /f/ /r/ | /s/ /k/ /l/ | /s/ /k/ /r/ | /s/ /m/ /l/ | /s/ /m/ /r/ | /s/ /p/ /l/ | /s/ /p/ /r/ | /s/ /t/ /r/
| /j/ /b/ /l/ | /j/ /b/ /r/ | /j/ /d/ /r/ | /j/ /g/ /l/ | /j/ /g/ /r/ | /j/ /m/ /l/ | /j/ /m/ /r/ | /j/ /v/ /l/ | /j/ /v/ /r/
| /z/ /b/ /l/ | /z/ /b/ /r/ | /z/ /d/ /r/ | /z/ /g/ /l/ | /z/ /g/ /r/ | /z/ /m/ /l/ | /z/ /m/ /r/ | /z/ /v/ /l/ | /z/ /v/ /r/ ;

medial-triple
≔ before-b /b/ /l/ | before-b /b/ /r/ | before-c /c/ /f/ | before-c /c/ /k/ | before-c /c/ /l/
| before-c /c/ /m/ | before-c /c/ /n/ | before-c /c/ /p/ | before-c /c/ /r/ | before-c /c/ /t/
| before-d-not-n /d/ /j/ | before-d /d/ /r/ | before-d-not-n /d/ /z/ | before-f /f/ /l/
| before-f /f/ /r/ | before-g /g/ /l/ | before-g /g/ /r/ | before-j /j/ /b/ | before-j /j/ /d/
| before-j /j/ /g/ | before-j /j/ /m/ | before-j /j/ /v/ | before-k /k/ /l/ | before-k /k/ /r/
| before-m /m/ /l/ | before-m /m/ /r/ | before-p /p/ /l/ | before-p /p/ /r/ | before-s /s/ /f/
| before-s /s/ /k/ | before-s /s/ /l/ | before-s /s/ /m/ | before-s /s/ /n/ | before-s /s/ /p/
| before-s /s/ /r/ | before-s /s/ /t/ | before-t-not-n /t/ /c/ | before-t /t/ /r/
| before-t-not-n /t/ /s/ | before-v /v/ /l/ | before-v /v/ /r/ | before-x /x/ /l/
| before-x /x/ /r/ | before-z /z/ /b/ | before-z /z/ /d/ | before-z /z/ /g/ | before-z /z/ /m/
| before-z /z/ /v/ ;

medial-quad
≔ before-c /c/ /f/ /l/ | before-c /c/ /f/ /r/ | before-c /c/ /k/ /l/ | before-c /c/ /k/ /r/
| before-c /c/ /m/ /l/ | before-c /c/ /m/ /r/ | before-c /c/ /p/ /l/ | before-c /c/ /p/ /r/
| before-c /c/ /t/ /r/ | before-s /s/ /f/ /l/ | before-s /s/ /f/ /r/ | before-s /s/ /k/ /l/
| before-s /s/ /k/ /r/ | before-s /s/ /m/ /l/ | before-s /s/ /m/ /r/ | before-s /s/ /p/ /l/
| before-s /s/ /p/ /r/ | before-s /s/ /t/ /r/ | before-j /j/ /b/ /l/ | before-j /j/ /b/ /r/
| before-j /j/ /d/ /r/ | before-j /j/ /g/ /l/ | before-j /j/ /g/ /r/ | before-j /j/ /m/ /l/
| before-j /j/ /m/ /r/ | before-j /j/ /v/ /l/ | before-j /j/ /v/ /r/ | before-z /z/ /b/ /l/
| before-z /z/ /b/ /r/ | before-z /z/ /d/ /r/ | before-z /z/ /g/ /l/ | before-z /z/ /g/ /r/
| before-z /z/ /m/ /l/ | before-z /z/ /m/ /r/ | before-z /z/ /v/ /l/ | before-z /z/ /v/ /r/ ;

before-b
≔ /d/ | /g/ | /j/ | /l/ | /m/ | /n/ | /r/ | /v/ | /z/ ;

before-c
≔ /f/ | /k/ | /l/ | /m/ | /n/ | /p/ | /r/ | /t/ ;

before-d
≔ /b/ | /g/ | /j/ | /l/ | /m/ | /n/ | /r/ | /v/ | /z/ ;

before-f
≔ /c/ | /k/ | /l/ | /m/ | /n/ | /p/ | /r/ | /s/ | /t/ | /x/ ;

before-g
≔ /b/ | /d/ | /j/ | /l/ | /m/ | /n/ | /r/ | /v/ | /z/ ;

before-j
≔ /b/ | /d/ | /g/ | /l/ | /m/ | /n/ | /r/ | /v/ ;

before-k
≔ /c/ | /f/ | /l/ | /m/ | /n/ | /p/ | /r/ | /s/ | /t/ ;

before-m
≔ /b/ | /c/ | /d/ | /f/ | /g/ | /j/ | /k/ | /l/ | /n/ | /p/ | /r/ | /s/ | /t/ | /v/ | /x/ | /z/ ;

before-p
≔ /c/ | /f/ | /k/ | /l/ | /m/ | /n/ | /r/ | /s/ | /t/ | /x/ ;

before-s
≔ /f/ | /k/ | /l/ | /m/ | /n/ | /p/ | /r/ | /t/ | /x/ ;

before-t
≔ /c/ | /f/ | /k/ | /l/ | /m/ | /n/ | /p/ | /r/ | /s/ | /x/ ;

before-v
≔ /b/ | /d/ | /g/ | /j/ | /l/ | /m/ | /n/ | /r/ | /z/ ;

before-x
≔ /f/ | /l/ | /m/ | /n/ | /p/ | /r/ | /s/ | /t/ ;

before-z
≔ /b/ | /d/ | /g/ | /l/ | /n/ | /r/ | /v/ ;

before-d-not-n
≔ /b/ | /g/ | /j/ | /l/ | /m/ | /r/ | /v/ | /z/ ;

before-t-not-n
≔ /c/ | /f/ | /k/ | /l/ | /m/ | /p/ | /r/ | /s/ | /x/ ;

consonant-pair
≔ /b/ after-b | /c/ after-c | /d/ after-d | /f/ after-f | /g/ after-g | /j/ after-j
| /k/ after-k | /l/ after-l | /m/ after-m | /n/ after-n | /p/ after-p | /r/ after-r
| /s/ after-s | /t/ after-t | /v/ after-v | /x/ after-x | /z/ after-z ;

after-b
≔ /d/ | /g/ | /j/ | /v/ | /z/ | /l/ | /m/ | /n/ | /r/ ;

after-d
≔ /b/ | /g/ | /j/ | /v/ | /z/ | /l/ | /m/ | /n/ | /r/ ;

after-g
≔ /b/ | /d/ | /j/ | /v/ | /z/ | /l/ | /m/ | /n/ | /r/ ;

after-v
≔ /b/ | /d/ | /g/ | /j/ | /z/ | /l/ | /m/ | /n/ | /r/ ;

after-j
≔ /b/ | /d/ | /g/ | /v/ | /l/ | /m/ | /n/ | /r/ ;

after-z
≔ /b/ | /d/ | /g/ | /v/ | /l/ | /m/ | /n/ | /r/ ;

after-c
≔ /f/ | /k/ | /p/ | /t/ | /l/ | /m/ | /n/ | /r/ ;

after-s
≔ /f/ | /k/ | /p/ | /t/ | /x/ | /l/ | /m/ | /n/ | /r/ ;

after-x
≔ /f/ | /p/ | /s/ | /t/ | /l/ | /m/ | /n/ | /r/ ;

after-k
≔ /c/ | /f/ | /p/ | /s/ | /t/ | /l/ | /m/ | /n/ | /r/ ;

after-f
≔ /c/ | /k/ | /p/ | /s/ | /t/ | /x/ | /l/ | /m/ | /n/ | /r/ ;

after-p
≔ /c/ | /f/ | /k/ | /s/ | /t/ | /x/ | /l/ | /m/ | /n/ | /r/ ;

after-t
≔ /c/ | /f/ | /k/ | /p/ | /s/ | /x/ | /l/ | /m/ | /n/ | /r/ ;

after-l
≔ /b/ | /c/ | /d/ | /f/ | /g/ | /j/ | /k/ | /m/ | /n/ | /p/ | /r/ | /s/ | /t/ | /v/ | /x/ | /z/ ;

after-r
≔ /b/ | /c/ | /d/ | /f/ | /g/ | /j/ | /k/ | /l/ | /m/ | /n/ | /p/ | /s/ | /t/ | /v/ | /x/ | /z/ ;

after-m
≔ /b/ | /c/ | /d/ | /f/ | /g/ | /j/ | /k/ | /l/ | /n/ | /p/ | /r/ | /s/ | /t/ | /v/ | /x/ ;

after-n
≔ /b/ | /c/ | /d/ | /f/ | /g/ | /j/ | /k/ | /l/ | /m/ | /p/ | /r/ | /s/ | /t/ | /v/ | /x/ | /z/ ;
```
