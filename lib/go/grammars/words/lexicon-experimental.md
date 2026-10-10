# The experimental lexicon

This document is the lexicon of the forms stage in the [experimental](../dialects/experimental.md) dialect. A lexicon is a list of words, each with its classes. The forms stage is the second stage of the pipeline. It divides the phonemes of the text into words. A cmavo is a particle, a short structure word. A selma'o is a word class of cmavo.

The lexicon gives each cmavo the selma'o that camxes-exp, the experimental grammar of the camxes parser, gives it. It holds the cmavo of CLL (*The Complete Lojban Language*) and the experimental cmavo that camxes-exp reads. `tools/peg-lexicon.js` writes the classifier below from the selma'o lists of `camxes-exp.peg` in ilmentufa, as of commit [`778ea138f7d150121ca722db7536ce3b123943ac`](https://github.com/lojban/ilmentufa/blob/778ea138f7d150121ca722db7536ce3b123943ac/camxes-exp.peg). A maintainer changes the lexicon by running the tool again.

Each entry lists words by their canonical sound and gives them one selma'o, as [lexicon-cll.md](lexicon-cll.md) explains. A selbri is a predicate. `la`, `lai` and `la'i` are LE because a name can be a selbri.

The implication after the entries marks some words `indicator`, which the indicator stage reads. They are the words of UI, CAI, DAhO, FUhE and FUhO. camxes-exp also reads a bare NAI as an indicator, and [the experimental word forms](experimental.md) mark the NAI words so.

[The notation document](../../docs/notation.md) explains the notation.

```jbogenbau
%classifier lexicon
  "a" "e" "ji" "o" "u" ∈ A
  "ba'i" "bai" "bau" "be'ei" "be'i" "ca'i" "cau" "ci'e" "ci'o" "ci'u" "cu'u" "de'i" "de'i'a" ∈ BAI
  "de'i'e" "de'i'i" "de'i'o" "de'i'u" "di'o" "do'e" "du'i" "du'o" "fa'e" "fau" "fi'e" "ga'a" ∈ BAI
  "gau" "ja'e" "ja'i" "ji'e" "ji'o" "ji'u" "ka'a" "ka'ai" "ka'i" "kai" "ki'i" "ki'oi" "ki'u" ∈ BAI
  "ko'au" "koi" "ku'u" "la'u" "le'a" "li'e" "ma'e" "ma'i" "mau" "me'a" "me'e" "mu'i" "mu'u" ∈ BAI
  "ni'i" "pa'a" "pa'u" "pi'o" "po'i" "pu'a" "pu'e" "ra'a" "ra'i" "rai" "ri'a" "ri'i" "sau" ∈ BAI
  "si'u" "ta'i" "tai" "ti'i" "ti'u" "tu'i" "va'o" "va'u" "zau" "zu'e" ∈ BAI
  "ba'e" "za'e" ∈ BAhE
  "be" ∈ BE
  "bei" ∈ BEI
  "be'o" ∈ BEhO
  "bi'e" ∈ BIhE
  "bi'i" "bi'o" "mi'i" ∈ BIhI
  "bo" ∈ BO
  "boi" ∈ BOI
  "bu" ∈ BU
  "by" "cy" "dy" "fy" "ga'e" "ge'o" "gy" "iy" "je'o" "jo'o" "jy" "ky" "lo'a" "ly" "my" "na'a" ∈ BY
  "ny" "py" "ru'o" "ry" "se'e" "sy" "to'a" "ty" "uy" "vy" "xy" "y'y" "zy" ∈ BY
  "cai" "cu'i" "pei" "ru'e" "sai" ∈ CAI
  "ca'a" "ka'e" "nu'o" "pu'i" ∈ CAhA
  "cei" ∈ CEI
  "ce'e" ∈ CEhE
  "co" ∈ CO
  "be'e" "co'o" "co'oi" "coi" "di'ai" "fe'o" "fi'i" "je'e" "ju'i" "ke'o" "ki'ai" "ki'e" "mi'e" ∈ COI
  "mu'o" "nu'e" "pe'u" "re'i" "sa'ei" "ta'a" "vi'o" ∈ COI
  "cu" ∈ CU
  "cu'e" "nau" ∈ CUhE
  "da'o" ∈ DAhO
  "da'oi" "doi" ∈ DOI
  "do'u" ∈ DOhU
  "fa" "fai" "fe" "fi" "fi'a" "fo" "fu" ∈ FA
  "be'a" "bu'u" "ca'u" "du'a" "fa'a" "ga'u" "ne'a" "ne'i" "ne'u" "ni'a" "pa'o" "re'o" "ri'u" ∈ FAhA
  "ru'u" "te'e" "ti'a" "to'o" "vu'a" "ze'o" "zo'a" "zo'i" "zu'a" ∈ FAhA
  "fa'o" ∈ FAhO
  "fe'e" ∈ FEhE
  "fe'u" ∈ FEhU
  "fi'o" ∈ FIhO
  "foi" ∈ FOI
  "fu'a" ∈ FUhA
  "fu'e" ∈ FUhE
  "fu'o" ∈ FUhO
  "ga" "ge" "ge'i" "go" "gu" ∈ GA
  "ga'o" "ke'i" ∈ GAhO
  "ge'u" ∈ GEhU
  "gi" ∈ GI
  "gi'a" "gi'e" "gi'i" "gi'o" "gi'u" ∈ GIhA
  "goi" "ne" "no'u" "pe" "po" "po'e" "po'u" ∈ GOI
  "bu'a" "bu'e" "bu'i" "co'e" "du" "go'a" "go'e" "go'i" "go'o" "go'u" "mo" "nei" "no'a" ∈ GOhA
  "gu'a" "gu'e" "gu'i" "gu'o" "gu'u" ∈ GUhA
  "i" ∈ I
  "ja" "je" "je'i" "jo" "ju" ∈ JA
  "jai" ∈ JAI
  "ce" "ce'o" "fa'u" "jo'e" "jo'u" "joi" "ju'e" "ku'a" "pi'u" ∈ JOI
  "jo'i" ∈ JOhI
  "ke" ∈ KE
  "kei" ∈ KEI
  "ke'e" ∈ KEhE
  "ki" ∈ KI
  "ce'u" "da" "da'e" "da'u" "de" "de'e" "de'u" "dei" "di" "di'e" "di'u" "do" "do'i" "do'o" ∈ KOhA
  "fo'a" "fo'e" "fo'i" "fo'o" "fo'u" "ke'a" "ko" "ko'a" "ko'e" "ko'i" "ko'o" "ko'u" "ma" ∈ KOhA
  "ma'a" "mi" "mi'a" "mi'ai" "mi'o" "nau'o" "ra" "ri" "ru" "ta" "ti" "tu" "vo'a" "vo'e" ∈ KOhA
  "vo'i" "vo'o" "vo'u" "xai" "xei'e" "zi'o" "zo'e" "zu'ai" "zu'i" ∈ KOhA
  "ku" ∈ KU
  "ku'au" ∈ KUhAU
  "ku'e" ∈ KUhE
  "ku'o" ∈ KUhO
  "ku'oi" ∈ KUhOI
  "ce'a" "lau" "tau" "zai" ∈ LAU
  "la'e" "lu'a" "lu'e" "lu'i" "lu'o" "tu'a" "vu'i" "zo'ei" ∈ LAhE
  "la" "la'i" "lai" "le" "le'e" "le'i" "lei" "lo" "lo'e" "lo'i" "loi" "me'ei" ∈ LE
  "le'ai" ∈ LEhAI
  "le'u" ∈ LEhU
  "li" "me'o" ∈ LI
  "li'u" ∈ LIhU
  "lo'ai" "sa'ai" ∈ LOhAI
  "lo'o" ∈ LOhO
  "lo'oi" ∈ LOhOI
  "lo'u" ∈ LOhU
  "lu" ∈ LU
  "lu'u" ∈ LUhU
  "mai" "mo'o" ∈ MAI
  "ma'o" ∈ MAhO
  "me" "me'au" ∈ ME
  "me'oi" ∈ MEhOI
  "me'u" ∈ MEhU
  "cei'a" "cu'o" "mei" "moi" "si'e" "va'e" ∈ MOI
  "mo'e" ∈ MOhE
  "mo'i" ∈ MOhI
  "ja'a" "na" ∈ NA
  "ja'ai" "nai" ∈ NAI
  "je'a" "na'e" "na'ei" "no'e" "to'e" ∈ NAhE
  "na'u" ∈ NAhU
  "ni'e" ∈ NIhE
  "ni'o" "no'i" ∈ NIhO
  "noi" "poi" "voi" ∈ NOI
  "no'oi" "po'oi" ∈ NOhOI
  "du'u" "jei" "ka" "kai'u" "li'i" "mu'e" "ni" "nu" "poi'i" "pu'u" "si'o" "su'u" "xe'ei" "za'i" ∈ NU
  "zu'o" ∈ NU
  "nu'a" ∈ NUhA
  "nu'i" ∈ NUhI
  "nu'u" ∈ NUhU
  "bi" "ce'i" "ci" "ci'i" "da'a" "dau" "du'e" "fei" "fi'u" "gai" "jau" "ji'i" "ka'o" "ki'o" ∈ PA
  "ma'u" "me'i" "mo'a" "mu" "ni'u" "no" "no'o" "pa" "pai" "pi" "pi'e" "ra'e" "rau" "re" "rei" ∈ PA
  "ro" "so" "so'a" "so'e" "so'i" "so'o" "so'u" "su'e" "su'o" "su'oi" "te'o" "tu'o" "vai" "vo" ∈ PA
  "xa" "xo" "xo'e" "za'u" "ze" ∈ PA
  "pe'e" ∈ PEhE
  "pe'o" ∈ PEhO
  "ba" "ca" "pu" ∈ PU
  "ra'o" ∈ RAhO
  "mu'ei" "re'u" "roi" ∈ ROI
  "sa" ∈ SA
  "se" "su'ai" "su'ei" "te" "to'ai" "ve" "vo'ai" "xe" "xo'ai" ∈ SE
  "sei" "ti'o" ∈ SEI
  "se'u" ∈ SEhU
  "si" ∈ SI
  "fi'oi" "soi" "xoi" ∈ SOI
  "li'oi" "su" ∈ SU
  "di'i" "na'o" "ru'i" "ta'e" ∈ TAhE
  "tei" ∈ TEI
  "te'u" ∈ TEhU
  "to" "to'i" ∈ TO
  "toi" ∈ TOI
  "tu'e" ∈ TUhE
  "tu'u" ∈ TUhU
  "a'a" "a'e" "a'i" "a'o" "a'u" "ai" "ai'i" "au" "ba'a" "ba'u" "be'u" "bi'u" "bu'o" "ca'e" ∈ UI
  "da'i" "dai" "do'a" "e'a" "e'e" "e'i" "e'o" "e'u" "ei" "fu'i" "ga'i" "ge'e" "i'a" "i'e" "i'i" ∈ UI
  "i'o" "i'u" "ia" "ie" "ii" "io" "iu" "ja'o" "je'u" "ji'a" "jo'a" "ju'a" "ju'o" "ju'oi" "ka'u" ∈ UI
  "kau" "ke'u" "ki'a" "ko'oi" "ku'i" "la'a" "le'o" "li'a" "li'o" "mi'u" "mu'a" "na'i" "o'a" ∈ UI
  "o'ai" "o'e" "o'i" "o'o" "o'u" "oi" "oi'a" "pa'e" "pau" "pe'a" "pe'i" "po'o" "ra'u" "re'e" ∈ UI
  "ri'e" "ro'a" "ro'e" "ro'i" "ro'o" "ro'u" "ru'a" "sa'a" "sa'e" "sa'u" "se'a" "se'i" "se'o" ∈ UI
  "si'a" "si'au" "su'a" "ta'o" "ta'u" "ti'e" "to'u" "u'a" "u'e" "u'i" "u'o" "u'u" "ua" "ue" ∈ UI
  "ue'i" "ui" "uo" "uu" "va'i" "vu'e" "xe'e" "xo'o" "xu" "za'a" "zo'o" "zu'u" ∈ UI
  "va" "vi" "vu" ∈ VA
  "vau" ∈ VAU
  "vei" ∈ VEI
  "ve'a" "ve'e" "ve'i" "ve'u" ∈ VEhA
  "ve'o" ∈ VEhO
  "vi'a" "vi'e" "vi'i" "vi'u" ∈ VIhA
  "vu'o" ∈ VUhO
  "cu'a" "de'o" "fa'i" "fe'a" "fe'i" "fu'u" "ge'a" "gei" "joi'i" "ju'u" "ne'o" "pa'i" "pi'a" ∈ VUhU
  "pi'i" "re'a" "ri'o" "sa'i" "sa'o" "si'i" "su'i" "te'a" "va'a" "vu'u" ∈ VUhU
  "xi" ∈ XI
  "ba'o" "ca'o" "co'a" "co'a'a" "co'au'a" "co'i" "co'u" "co'u'a" "de'a" "di'a" "mo'u" "pu'o" ∈ ZAhO
  "sau'a" "xa'o" "xo'u" "za'o" ∈ ZAhO
  "zei" ∈ ZEI
  "ze'a" "ze'e" "ze'i" "ze'u" ∈ ZEhA
  "za" "zi" "zu" ∈ ZI
  "zi'e" ∈ ZIhE
  "ma'oi" "zo" ∈ ZO
  "la'o" "zoi" ∈ ZOI
  "la'oi" "ra'oi" "zo'oi" ∈ ZOhOI
  "ce'ai" "zo'u" ∈ ZOhU
```

```jbogenbau
%implies UI ∪ CAI ∪ DAhO ∪ FUhE ∪ FUhO ⟹ ~indicator
```

## Differences from CLL and camxes-exp

The tool omits camxes-exp's Y because the forms stage reads a run of `y` as hesitation instead of a cmavo.

camxes-exp gives each word one selma'o. It reassigns the CLL words `la`, `lai` and `la'i` to LE because it reads names as selbri. This classifier retains those classes.
