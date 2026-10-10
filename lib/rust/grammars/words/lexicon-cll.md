# The CLL lexicon

This document is the lexicon of the forms stage in the [CLL](../dialects/cll-ebnf.md) dialect and the dialect of the [BPFK](../dialects/bpfk.md), the Lojban language planning committee. A lexicon is a list of words, each with its classes. The forms stage is the second stage of the pipeline. It divides the phonemes of the text into words. A cmavo is a particle, a short structure word. A selma'o is a word class of cmavo.

This lexicon holds the cmavo of *The Complete Lojban Language* (CLL) with their selma'o. Each entry uses the class from the CLL dictionary. This document collapses the numbered subclasses of the dictionary (`UI3a`, `KOhA7`) to the selma'o that the syntax grammar names. Its maintainers edit it by hand in this repository.

The lexicon below is a classifier. Each of its entries lists words and gives them one class, as `"mi" "do" ∈ KOhA` does. The forms stage looks a cmavo up with `classify(phonemes($c), lexicon)`, and tags the cmavo with its classes. A tag marks a token by name, phoneme or character. The lexicon writes each word as its canonical sound, in lower case, with `'` for the apostrophe. Cmavo stress is free, so a stressed vowel finds the same word as a plain one.

If a word has several classes, it carries them all, and the syntax stage reads it under each class. No word of CLL has more than one. The entries stand in the order of their classes. The syntax grammar's `indicator` and `indicators` rules read the words of UI, CAI, DAhO, FUhO and FUhE. The implication after the entries marks each of these words `indicator`. The indicator stage uses this mark to attach indicators to the preceding word, under CLL's non-formal `word` rule.

The forms stage reads a run of `y` as hesitation and never looks it up in this classifier.

[The notation document](../../docs/notation.md) explains the notation.

```jbogenbau
%classifier lexicon
  "a" "e" "ji" "o" "u" ∈ A
  "ba'i" "bai" "bau" "be'i" "ca'i" "cau" "ci'e" "ci'o" "ci'u" "cu'u" "de'i" "di'o" "do'e" ∈ BAI
  "du'i" "du'o" "fa'e" "fau" "fi'e" "ga'a" "gau" "ja'e" "ja'i" "ji'e" "ji'o" "ji'u" "ka'a" ∈ BAI
  "ka'i" "kai" "ki'i" "ki'u" "koi" "ku'u" "la'u" "le'a" "li'e" "ma'e" "ma'i" "mau" "me'a" ∈ BAI
  "me'e" "mu'i" "mu'u" "ni'i" "pa'a" "pa'u" "pi'o" "po'i" "pu'a" "pu'e" "ra'a" "ra'i" "rai" ∈ BAI
  "ri'a" "ri'i" "sau" "si'u" "ta'i" "tai" "ti'i" "ti'u" "tu'i" "va'o" "va'u" "zau" "zu'e" ∈ BAI
  "ba'e" "za'e" ∈ BAhE
  "be" ∈ BE
  "bei" ∈ BEI
  "be'o" ∈ BEhO
  "bi'e" ∈ BIhE
  "bi'i" "bi'o" "mi'i" ∈ BIhI
  "bo" ∈ BO
  "boi" ∈ BOI
  "bu" ∈ BU
  "by" "cy" "dy" "fy" "ga'e" "ge'o" "gy" "je'o" "jo'o" "jy" "ky" "lo'a" "ly" "my" "na'a" "ny" ∈ BY
  "py" "ru'o" "ry" "se'e" "sy" "to'a" "ty" "vy" "xy" "y'y" "zy" ∈ BY
  "cai" "cu'i" "pei" "ru'e" "sai" ∈ CAI
  "ca'a" "ka'e" "nu'o" "pu'i" ∈ CAhA
  "cei" ∈ CEI
  "ce'e" ∈ CEhE
  "co" ∈ CO
  "be'e" "co'o" "coi" "fe'o" "fi'i" "je'e" "ju'i" "ke'o" "ki'e" "mi'e" "mu'o" "nu'e" "pe'u" ∈ COI
  "re'i" "ta'a" "vi'o" ∈ COI
  "cu" ∈ CU
  "cu'e" "nau" ∈ CUhE
  "da'o" ∈ DAhO
  "doi" ∈ DOI
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
  "ma'a" "mi" "mi'a" "mi'o" "ra" "ri" "ru" "ta" "ti" "tu" "vo'a" "vo'e" "vo'i" "vo'o" "vo'u" ∈ KOhA
  "zi'o" "zo'e" "zu'i" ∈ KOhA
  "ku" ∈ KU
  "ku'e" ∈ KUhE
  "ku'o" ∈ KUhO
  "la" "la'i" "lai" ∈ LA
  "ce'a" "lau" "tau" "zai" ∈ LAU
  "la'e" "lu'a" "lu'e" "lu'i" "lu'o" "tu'a" "vu'i" ∈ LAhE
  "le" "le'e" "le'i" "lei" "lo" "lo'e" "lo'i" "loi" ∈ LE
  "le'u" ∈ LEhU
  "li" "me'o" ∈ LI
  "li'u" ∈ LIhU
  "lo'o" ∈ LOhO
  "lo'u" ∈ LOhU
  "lu" ∈ LU
  "lu'u" ∈ LUhU
  "mai" "mo'o" ∈ MAI
  "ma'o" ∈ MAhO
  "me" ∈ ME
  "me'u" ∈ MEhU
  "cu'o" "mei" "moi" "si'e" "va'e" ∈ MOI
  "mo'e" ∈ MOhE
  "mo'i" ∈ MOhI
  "ja'a" "na" ∈ NA
  "nai" ∈ NAI
  "je'a" "na'e" "no'e" "to'e" ∈ NAhE
  "na'u" ∈ NAhU
  "ni'e" ∈ NIhE
  "ni'o" "no'i" ∈ NIhO
  "noi" "poi" "voi" ∈ NOI
  "du'u" "jei" "ka" "li'i" "mu'e" "ni" "nu" "pu'u" "si'o" "su'u" "za'i" "zu'o" ∈ NU
  "nu'a" ∈ NUhA
  "nu'i" ∈ NUhI
  "nu'u" ∈ NUhU
  "bi" "ce'i" "ci" "ci'i" "da'a" "dau" "du'e" "fei" "fi'u" "gai" "jau" "ji'i" "ka'o" "ki'o" ∈ PA
  "ma'u" "me'i" "mo'a" "mu" "ni'u" "no" "no'o" "pa" "pai" "pi" "pi'e" "ra'e" "rau" "re" "rei" ∈ PA
  "ro" "so" "so'a" "so'e" "so'i" "so'o" "so'u" "su'e" "su'o" "te'o" "tu'o" "vai" "vo" "xa" "xo" ∈ PA
  "za'u" "ze" ∈ PA
  "pe'e" ∈ PEhE
  "pe'o" ∈ PEhO
  "ba" "ca" "pu" ∈ PU
  "ra'o" ∈ RAhO
  "re'u" "roi" ∈ ROI
  "sa" ∈ SA
  "se" "te" "ve" "xe" ∈ SE
  "sei" "ti'o" ∈ SEI
  "se'u" ∈ SEhU
  "si" ∈ SI
  "soi" ∈ SOI
  "su" ∈ SU
  "di'i" "na'o" "ru'i" "ta'e" ∈ TAhE
  "tei" ∈ TEI
  "te'u" ∈ TEhU
  "to" "to'i" ∈ TO
  "toi" ∈ TOI
  "tu'e" ∈ TUhE
  "tu'u" ∈ TUhU
  "a'a" "a'e" "a'i" "a'o" "a'u" "ai" "au" "ba'a" "ba'u" "be'u" "bi'u" "bu'o" "ca'e" "da'i" ∈ UI
  "dai" "do'a" "e'a" "e'e" "e'i" "e'o" "e'u" "ei" "fu'i" "ga'i" "ge'e" "i'a" "i'e" "i'i" "i'o" ∈ UI
  "i'u" "ia" "ie" "ii" "io" "iu" "ja'o" "je'u" "ji'a" "jo'a" "ju'a" "ju'o" "ka'u" "kau" "ke'u" ∈ UI
  "ki'a" "ku'i" "la'a" "le'o" "li'a" "li'o" "mi'u" "mu'a" "na'i" "o'a" "o'e" "o'i" "o'o" "o'u" ∈ UI
  "oi" "pa'e" "pau" "pe'a" "pe'i" "po'o" "ra'u" "re'e" "ri'e" "ro'a" "ro'e" "ro'i" "ro'o" ∈ UI
  "ro'u" "ru'a" "sa'a" "sa'e" "sa'u" "se'a" "se'i" "se'o" "si'a" "su'a" "ta'o" "ta'u" "ti'e" ∈ UI
  "to'u" "u'a" "u'e" "u'i" "u'o" "u'u" "ua" "ue" "ui" "uo" "uu" "va'i" "vu'e" "xu" "za'a" ∈ UI
  "zo'o" "zu'u" ∈ UI
  "va" "vi" "vu" ∈ VA
  "vau" ∈ VAU
  "vei" ∈ VEI
  "ve'a" "ve'e" "ve'i" "ve'u" ∈ VEhA
  "ve'o" ∈ VEhO
  "vi'a" "vi'e" "vi'i" "vi'u" ∈ VIhA
  "vu'o" ∈ VUhO
  "cu'a" "de'o" "fa'i" "fe'a" "fe'i" "fu'u" "ge'a" "gei" "ju'u" "ne'o" "pa'i" "pi'a" "pi'i" ∈ VUhU
  "re'a" "ri'o" "sa'i" "sa'o" "si'i" "su'i" "te'a" "va'a" "vu'u" ∈ VUhU
  "xi" ∈ XI
  "ba'o" "ca'o" "co'a" "co'i" "co'u" "de'a" "di'a" "mo'u" "pu'o" "za'o" ∈ ZAhO
  "zei" ∈ ZEI
  "ze'a" "ze'e" "ze'i" "ze'u" ∈ ZEhA
  "za" "zi" "zu" ∈ ZI
  "zi'e" ∈ ZIhE
  "zo" ∈ ZO
  "la'o" "zoi" ∈ ZOI
  "zo'u" ∈ ZOhU
```

```jbogenbau
%implies UI ∪ CAI ∪ DAhO ∪ FUhE ∪ FUhO ⟹ ~indicator
```

## Differences from the CLL dictionary

The classifier omits the CLL dictionary's `y` entry in Y. The forms stage recognizes hesitation directly, so this omission preserves its treatment without a dictionary lookup.
