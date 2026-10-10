# The Zantufa lexicon

This document is the lexicon of the forms stage in the [Zantufa](../dialects/zantufa.md) dialect. A lexicon is a list of words, each with its classes. The forms stage is the second stage of the pipeline. It divides the phonemes of the text into words. A cmavo is a particle, a short structure word. A selma'o is a word class of cmavo.

The lexicon gives each cmavo the selma'o that Zantufa 1.9999 gives it. `tools/peg-lexicon.js` writes the classifier below from the selma'o lists of `zantufa-1.9999.peg`. That file is in Guskant's `gerna_cipra` repository, as of commit d5a5065. The tool marks no class as an indicator here, so it writes no implication. A tag marks a token by name, phoneme or character. A maintainer changes the lexicon by running the tool again.

Each entry lists words by their canonical sound and gives them one selma'o, as [lexicon-cll.md](lexicon-cll.md) explains.

The lexicon marks no word `indicator`, because Zantufa reads an attitudinal as a free modifier, which can follow any word. So the indicator stage attaches no word to the word before it. It attaches only the words of BAhE, to the word after them. The syntax reads every word of UI.

[The notation document](../../docs/notation.md) explains the notation.

```jbogenbau
%classifier lexicon
  "a" "e" "o" "u" ∈ A
  "ba" "ba'au" "ba'i" "ba'o" "bai" "bau" "be'a" "be'au" "be'ei" "be'i" "bu'u" "ca" "ca'i" ∈ BAI
  "ca'o" "ca'u" "cau" "ci'e" "ci'o" "ci'u" "co'a" "co'i" "co'u" "cu'e" "cu'u" "de'a" "de'i" ∈ BAI
  "de'i'a" "de'i'e" "de'i'i" "de'i'o" "de'i'u" "dei'a" "di'a" "di'i" "di'o" "do'e" "du'a" ∈ BAI
  "du'i" "du'o" "du'oi" "fa'a" "fa'e" "fau" "fi'e" "ga'a" "ga'u" "gai'i" "gau" "gu'au" "ja'e" ∈ BAI
  "ja'i" "ji'e" "ji'o" "ji'u" "ka'a" "ka'ai" "ka'i" "kai" "ki" "ki'i" "ki'oi" "ki'u" "ko'au" ∈ BAI
  "koi" "ku'u" "la'u" "le'a" "li'e" "li'i'e" "ma'e" "ma'i" "mau" "me'a" "me'e" "mo'u" "mu'ai" ∈ BAI
  "mu'i" "mu'u" "na'o" "nau" "ne'a" "ne'i" "ne'u" "ni'a" "ni'i" "pa'a" "pa'o" "pa'u" "pi'o" ∈ BAI
  "po'a" "po'i" "pu" "pu'a" "pu'ai" "pu'au" "pu'e" "pu'o" "ra'a" "ra'i" "rai" "re'o" "ri'a" ∈ BAI
  "ri'i" "ri'u" "ru'i" "ru'u" "sau" "si'u" "ta'e" "ta'i" "tai" "te'e" "te'i" "ti'a" "ti'i" ∈ BAI
  "ti'u" "ti'u'a" "ti'u'e" "ti'u'i" "to'o" "tu'i" "va" "va'o" "va'u" "ve'a" "ve'e" "ve'i" ∈ BAI
  "ve'u" "vi" "vi'a" "vi'e" "vi'i" "vi'u" "vu" "vu'a" "xa'o" "xau" "xo'u" "za" "za'ai" "za'o" ∈ BAI
  "zau" "ze'a" "ze'ai" "ze'e" "ze'i" "ze'o" "ze'u" "zei'a" "zi" "zo'a" "zo'i" "zu" "zu'a" ∈ BAI
  "zu'au" "zu'e" ∈ BAI
  "ba'e" "ba'ei" "pe'e" "za'e" "zai'e" ∈ BAhE
  "be" ∈ BE
  "bei" ∈ BEI
  "be'o" ∈ BEhO
  "bi'e" ∈ BIhE
  "bo" "ce'e" ∈ BO
  "boi" ∈ BOI
  "bu" ∈ BU
  "a'y" "bi'y" "bu'o'e" "by" "ce'i'y" "ci'i'y" "ci'y" "cy" "da'a'y" "dau'y" "du'e'y" "dy" "e'y" ∈ BY
  "fai'e'ai'y" "fai'e'au'y" "fai'u'a'y" "fai'u'y" "fei'y" "fi'u'y" "fu'a'ai'y" "fu'a'au'y" "fy" ∈ BY
  "ga'au'y" "ga'e" "gai'y" "gau'i'o'y" "ge'o" "go'o'i'a'y" "gy" "i'y" "iy" "iy'y" "jau'y" ∈ BY
  "je'o" "ji'i'y" "jo'au'o" "jo'o" "jy" "ka'ei'a'y" "ka'o'ai'y" "ka'o'y" "kai'o'y" "kau'o'y" ∈ BY
  "kei'o'y" "ki'o'y" "koi'o'y" "ky" "lo'a" "ly" "ma'u'y" "mai'e'e'y" "me'i'y" "mo'a'y" ∈ BY
  "mu'i'ai'y" "mu'y" "my" "na'a" "ni'e'ei'y" "ni'e'oi'y" "ni'u'y" "no'ai'y" "no'e'u'y" "no'o'y" ∈ BY
  "no'y" "ny" "o'y" "pa'au'o'y" "pa'y" "pai'y" "pei'i'a'y" "pi'y" "pu'e'u'o'y" "py" "ra'e'y" ∈ BY
  "rau'y" "re'y" "rei'y" "ro'au'o" "ro'oi'y" "ro'y" "ru'o" "ry" "se'e" "se'i'i'y" "sei'u'e'y" ∈ BY
  "so'a'y" "so'e'y" "so'i'y" "so'o'y" "so'u'y" "so'y" "soi'u'y" "su'ai'y" "su'au'y" "su'e'y" ∈ BY
  "su'o'y" "su'oi'y" "sy" "tau'u'y" "te'o'y" "to'a" "tu'o'y" "ty" "u'y" "ui'y" "uy" "va'ei'a'y" ∈ BY
  "vai'y" "vau'au'o'y" "vi'ei'e'y" "vo'ei'a'y" "vo'y" "vy" "xa'y" "xe'e'y" "xei'y" "xi'i'ei'y" ∈ BY
  "xo'e'y" "xo'y" "xy" "y'y" "za'u'y" "ze'y" "zy" ∈ BY
  "cei" ∈ CEI
  "co" ∈ CO
  "a'oi" "be'e" "bu'oi" "ci'oi" "co'o" "co'oi" "coi" "da'ei" "da'oi" "di'ai" "doi" "doi'oi" ∈ COI
  "fau'u" "fe'o" "fi'i" "fi'i'e" "goi'e" "je'e" "jo'au" "ju'i" "ke'o" "ki'ai" "ki'e" "mi'e" ∈ COI
  "mu'o" "nu'e" "o'ai" "pe'u" "re'i" "sa'ei" "sau'ei" "ta'a" "tai'i" "vi'o" ∈ COI
  "cu" ∈ CU
  "do'u" ∈ DOhU
  "fa" "fai" "fe" "fi" "fi'a" "fo" "fu" ∈ FA
  "fa'o" ∈ FAhO
  "fe'u" ∈ FEhU
  "fi'o" ∈ FIhO
  "foi" ∈ FOI
  "fu'a" ∈ FUhA
  "ga" "ge" "ge'i" "go" "gu" "gu'a" "gu'e" "gu'i" "gu'o" "gu'u" ∈ GA
  "ga'o" "ke'i" ∈ GAhO
  "ge'u" ∈ GEhU
  "gi" ∈ GI
  "gi'a" "gi'e" "gi'o" "gi'u" ∈ GIhA
  "gi'i" ∈ GIhI
  "goi" "ne" "no'u" "pe" "po" "po'e" "po'u" "voi'e" ∈ GOI
  "bu'a" "bu'e" "bu'i" "cei'i" "co'e" "du" "gai'o" "go'a" "go'e" "go'i" "go'o" "go'u" "mo" ∈ GOhA
  "nei" "no'a" "xe'u" ∈ GOhA
  "bo'ei" "go'oi" "ta'ai" "ze'oi" ∈ GOhOI
  "i" ∈ I
  "i'au" "iau" ∈ IAU
  "ja'ei" "jai" "jo'ai" ∈ JAI
  "bi'i" "bi'o" "ce" "ce'o" "ce'oi" "fa'u" "fa'u'ai" "ja" "je" "je'i" "ji" "ji'o'e" "jo" ∈ JOI
  "jo'e" "jo'ei" "jo'ei'i" "jo'u" "joi" "ju" "ju'e" "ku'a" "mi'i" "pi'u" "xoi'u" "y'i" "zi'e" ∈ JOI
  "fei'u" "ke" "ke'ai" "ke'ei" "ke'oi" "nu'i" "pi'ai" ∈ KE
  "kei" ∈ KEI
  "ke'e" "ke'ei'a" "nu'u" ∈ KEhE
  "bo'a" "bo'e" "bo'i" "bo'o" "bo'u" "ca'au" "ce'u" "da" "da'ai" "da'au" "da'e" "da'u" "de" ∈ KOhA
  "de'e" "de'u" "dei" "dei'e" "dei'ei" "dei'o" "dei'u" "di" "di'au" "di'e" "di'ei" "di'oi" ∈ KOhA
  "di'u" "do" "do'ei" "do'i" "do'o" "fo'a" "fo'e" "fo'i" "fo'o" "fo'u" "kau'a" "kau'e" ∈ KOhA
  "kau'i" "ke'a" "ko" "ko'a" "ko'e" "ko'i" "ko'o" "ko'u" "lau'e" "lau'u" "ma" "ma'a" "mai'i" ∈ KOhA
  "mi" "mi'a" "mi'ai" "mi'o" "mi'oi" "nau'u" "nei'o" "ra" "ri" "ri'au" "ru" "ta" "ti" "tu" ∈ KOhA
  "tu'oi" "vo'a" "vo'e" "vo'i" "vo'o" "vo'u" "xai" "zai'o" "zi'o" "zi'oi" "zo'e" "zu'ai" ∈ KOhA
  "zu'i" "zu'i'a" ∈ KOhA
  "ku" ∈ KU
  "ku'au" ∈ KUhAU
  "ku'e" "te'oi'oi" "tei'u" ∈ KUhE
  "ku'o" ∈ KUhO
  "ce'a" "lau" "tau" "zai" ∈ LAU
  "du'au" "la'e" "la'e'au" "lai'e" "lu'a" "lu'au" "lu'e" "lu'i" "lu'o" "moi'a" "tau'e" "tu'a" ∈ LAhE
  "vu'i" "zo'ei" ∈ LAhE
  "la" "la'ei" "la'i" "lai" "le" "le'e" "le'ei" "le'i" "lei" "lei'e" "lei'i" "lo" "lo'e" ∈ LE
  "lo'ei" "lo'i" "loi" "loi'e" "loi'i" "me'ei" "mo'oi" "moi'oi" "ri'oi" "zo'au" ∈ LE
  "le'ai" ∈ LEhAI
  "le'u" ∈ LEhU
  "bo'ai" "li" "li'ai" "li'ei" "mai'o" "me'o" ∈ LI
  "li'au" ∈ LIhAU
  "li'u" ∈ LIhU
  "lo'ai" "sa'ai" ∈ LOhAI
  "lo'o" ∈ LOhO
  "lo'oi" "mau'a" "xau'a" "xu'u" ∈ LOhOI
  "la'ai" "lo'u" ∈ LOhU
  "la'au" "lu" "tu'ai" ∈ LU
  "lu'ei" ∈ LUhEI
  "lu'u" ∈ LUhU
  "ba'ai" "mai" "mo'o" ∈ MAI
  "ma'o" "na'u" ∈ MAhO
  "me" "me'au" "nu'a" "xo'i" ∈ ME
  "me'u" ∈ MEhU
  "cu'o" "mei" "moi" "moi'o" "si'e" "va'e" ∈ MOI
  "boi'au" "mo'e" "ni'e" ∈ MOhE
  "mu'oi" ∈ MUhOI
  "bi'ai" "ca'a" "cau'a" "ja'a" "ka'e" "na" "nu'o" "pu'i" "xu'o'e" ∈ NA
  "cai'e" "cau'e" "cau'o'e" "fe'e" "je'a" "je'ai" "mo'i" "na'e" "na'ei" "no'e" "noi'e" ∈ NAhE
  "pai'e" "rei'e" "sai'e" "to'e" ∈ NAhE
  "ni'o" "no'i" ∈ NIhO
  "no'oi" "noi" "po'oi" "poi" "voi" "voi'i" ∈ NOI
  "bu'ai" "du'u" "jei" "ka" "ka'ei" "kai'ei" "kai'u" "li'i" "mu'e" "ni" "ni'ai" "nu" "poi'i" ∈ NU
  "pu'u" "si'o" "su'u" "za'i" "zu'o" ∈ NU
  "bi" "ci" "ci'i" "da'a" "dau" "du'e" "fai'e'ai" "fai'e'au" "fai'u" "fai'u'a" "fei" "fu'a'ai" ∈ PA
  "fu'a'au" "ga'au" "gai" "gau'i'o" "go'o'i'a" "jau" "ji'i" "ka'ei'a" "ka'o" "ka'o'ai" "kai'o" ∈ PA
  "kau'o" "kei'o" "ki'o" "koi'o" "mai'e'e" "mo'a" "mu" "mu'i'ai" "ni'e'ei" "ni'e'oi" "no" ∈ PA
  "no'ai" "no'e'u" "no'o" "pa" "pa'au'o" "pai" "pei'i'a" "pi" "pu'e'u'o" "ra'e" "rau" "re" ∈ PA
  "rei" "ro" "ro'oi" "se'i'i" "sei'u'e" "so" "so'a" "so'e" "so'i" "so'o" "so'u" "soi'u" "su'ai" ∈ PA
  "su'au" "su'e" "su'o" "su'oi" "tau'u" "te'o" "tu'o" "va'ei'a" "vai" "vau'au'o" "vi'ei'e" "vo" ∈ PA
  "vo'ei'a" "xa" "xe'e" "xei" "xi'i'ei" "xo" "xo'e" "ze" ∈ PA
  "kei'ai" "pe'o" ∈ PEhO
  "noi'a" "noi'o'a" "poi'a" "poi'o'a" "soi'a" ∈ POIhA
  "ra'oi" ∈ RAhOI
  "ba'oi" "de'ei" "mu'ei" "re'u" "roi" "va'ei" "xu'au" ∈ ROI
  "re'au'e" "se" "se'o'e" "se'u'o" "su'ei" "tau'o" "te" "to'ai" "ve" "vo'ai" "xe" "xo'ai" ∈ SE
  "cei'e" "le'au" "sei" "soi" "ti'o" ∈ SEI
  "se'u" "xe'au" ∈ SEhU
  "si" "si'u'i" "ze'ei" "zei" ∈ SI
  "su" ∈ SU
  "tei" ∈ TEI
  "ku'oi'u" "te'u" ∈ TEhU
  "mau'e" "noi'i" "to" "to'i" ∈ TO
  "ge'u'i" "mau'o" "toi" ∈ TOI
  "tu'e" ∈ TUhE
  "tu'u" ∈ TUhU
  "a'a" "a'e" "a'i" "a'o" "a'u" "ai" "au" "au'u" "ba'a" "ba'u" "be'u" "bi'a" "bi'u" "bo'oi" ∈ UI
  "bu'a'a" "bu'o" "ca'ai" "ca'e" "cai" "cau'i" "ci'ai" "ci'au'u'au'i" "cu'ei" "cu'ei'a" ∈ UI
  "cu'ei'ai" "cu'ei'e" "cu'ei'ei" "cu'ei'i" "cu'ei'o" "cu'ei'oi" "cu'ei'u" "cu'i" "da'i" "da'o" ∈ UI
  "dai" "dai'i" "dai'o" "dau'a" "dau'i" "de'ai" "de'au" "de'oi" "do'a" "do'ai" "doi'a" "e'a" ∈ UI
  "e'e" "e'i" "e'o" "e'u" "ei" "fai'a" "fu'au" "fu'e" "fu'ei" "fu'ei'a" "fu'ei'e" "fu'ei'i" ∈ UI
  "fu'ei'o" "fu'ei'u" "fu'i" "fu'o" "ga'i" "ge'e" "ge'ei" "i'a" "i'e" "i'i" "i'o" "i'u" "ia" ∈ UI
  "ia'u" "ie" "ie'i" "ii" "io" "iu" "ja'ai" "ja'o" "je'au" "je'u" "jei'u" "ji'a" "ji'au" ∈ UI
  "ji'ei" "jo'a" "ju'a" "ju'o" "ju'oi" "ka'u" "kai'a" "kai'e" "kau" "ke'e'u" "ke'u" "ki'a" ∈ UI
  "ki'a'au'u'au'i" "ko'oi" "koi'e" "ku'i" "la'a" "lai'i" "lau'i" "le'o" "li'a" "li'o" "li'oi" ∈ UI
  "mau'i" "mau'u" "me'ai" "mi'u" "moi'i" "mu'a" "na'i" "na'oi" "nai" "ne'au" "ne'e" "ni'au" ∈ UI
  "nu'oi" "o'a" "o'e" "o'i" "o'o" "o'u" "oi" "oi'a" "oi'o" "oi'u" "pa'e" "pau" "pe'a" "pe'ai" ∈ UI
  "pe'i" "pei" "pei'a" "pei'e" "pei'o" "po'o" "pu'ei" "ra'i'au" "ra'o" "ra'u" "re'e" "ri'e" ∈ UI
  "ro'a" "ro'e" "ro'i" "ro'o" "ro'u" "ru'a" "ru'e" "sa" "sa'a" "sa'e" "sa'u" "sai" "se'a" ∈ UI
  "se'i" "se'o" "sei'i" "si'a" "si'au" "su'a" "ta'ei" "ta'o" "ta'oi" "ta'u" "te'i'o" "ti'e" ∈ UI
  "to'u" "toi'e" "toi'o" "u'a" "u'ai" "u'e" "u'i" "u'o" "u'u" "ua" "uai" "uau" "ue" "ue'i" ∈ UI
  "uei'e" "ui" "uo" "uu" "va'i" "vei'i" "vu'e" "xa'a" "xa'a'a" "xa'i" "xai'a" "xau'e'o" ∈ UI
  "xau'o'o" "xo'o" "xu" "xu'u'i" "xy'y" "za'a" "zai'a" "zi'a" "zi'ai" "zo'o" "zu'u" ∈ UI
  "vau" ∈ VAU
  "vei" ∈ VEI
  "ve'o" ∈ VEhO
  "vu'o" ∈ VUhO
  "bai'ei" "bai'i" "be'ei'oi" "boi'ai" "ce'i" "ci'ai'u" "cu'a" "cu'ai" "cu'au'ei" "da'a'au" ∈ VUhU
  "de'au'u" "de'o" "dei'au'o" "di'ei'o'au" "du'ei" "fa'ai" "fa'au" "fa'i" "fau'au" "fe'a" ∈ VUhU
  "fe'au'u" "fe'i" "fi'u" "fu'u" "ga'u'au" "ge'a" "gei" "gu'ai" "gu'au'i" "ja'oi" "jau'au" ∈ VUhU
  "jo'i" "joi'i" "ju'u" "ka'au" "ka'o'ei" "kei'au" "kei'i" "ku'au'a" "ma'o'e" "ma'u" ∈ VUhU
  "me'ei'o" "me'i" "ne'o" "ne'oi" "ni'a'au" "ni'u" "pa'i" "pau'a'u" "pau'ei" "pau'oi" "pi'a" ∈ VUhU
  "pi'e" "pi'ei'au" "pi'ei'oi" "pi'i" "re'a" "ri'o" "sa'i" "sa'o" "se'i'a'o" "si'i" "si'oi'e" ∈ VUhU
  "su'i" "tai'e'i" "tai'i'e" "te'a" "te'au" "te'au'u" "to'ei'au" "va'a" "vi'oi'au" "vo'au'u" ∈ VUhU
  "vu'u" "xo'ei" "za'ei" "za'u" "zi'a'o" ∈ VUhU
  "fau'e" "te'ai" "xi" "xi'e" "xi'i" ∈ XI
  "fi'oi" "xoi" ∈ XOI
  "ie'o" "y" ∈ Y
  "ma'oi" "ra'ai" "zo" ∈ ZO
  "la'o" "zoi" ∈ ZOI
  "ce'ai" "ge'ai" "ke'au" "zo'u" ∈ ZOhU
```

## Differences from CLL

Zantufa gives each word one selma'o. Its classes differ from *The Complete Lojban Language* (CLL) in these ways:

- The tense words of PU, ZI, VA, FAhA, ZAhO, ZEhA, VEhA, VIhA, TAhE, KI and CUhE are BAI. The words of ROI stay ROI, `mo'i` and `fe'e` are NAhE, and the CAhA words, such as `ca'a` and `ka'e`, are NA.
- `je`, `ja`, `jo` and `ju` are JOI, because Zantufa has no JA.
- `la`, `lai` and `la'i` are LE, because Zantufa reads a name as a selbri, a predicate.
- `ce'e` is BO, `nu'i` and `nu'u` are KE and KEhE, and `pe'e` is BAhE, because Zantufa has no termsets.
- `zei`, `ze'ei` and `si'u'i` are SI, so each erases a word, as `si` does.
- `sa`, `nai`, `cai`, `da'o`, `fu'e` and `fu'o` are UI, and `ie'o` is Y, as `y` is.
- `soi` is SEI, and `xoi` and `fi'oi` are XOI.
