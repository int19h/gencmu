# The experimental lexicon

This document is the lexicon of the forms stage in the [experimental](pipeline.md) pipeline. A lexicon is a list of words, each with its classes. The forms stage follows the phoneme stage. It divides the phonemes of the text into words. A cmavo is a particle, a short structure word. A selma'o is a word class of cmavo.

A token is one unit that a stage reads or emits. A token's value is the string that exact comparisons read. Its image is the string that people see.

The maintainers edit this lexicon by hand. Its baseline is the word lists of camxes-exp, the experimental grammar of the camxes parser. The source is `camxes-exp.peg` in ilmentufa, at commit [`778ea138f7d150121ca722db7536ce3b123943ac`](https://github.com/lojban/ilmentufa/blob/778ea138f7d150121ca722db7536ce3b123943ac/camxes-exp.peg). The lexicon contains CLL (*The Complete Lojban Language*) cmavo and experimental cmavo. The closing section lists its additions and class differences.

The dictionary additions follow the [policy for issue #211](https://github.com/int19h/gencmu/issues/211#issuecomment-6204819697). The dictionary is the Lensisku export of September 13, 2026, in [jbocirvei](https://github.com/int19h/jbocirvei/tree/8c1579254e73c72d20d202557e42d4d92346f6bc/dict). An experimental cmavo qualifies when its highest-voted English definition has a score of at least three. The highest-voted definition supplies its class. Numeric subcategories do not affect classification, so UI3a becomes UI and KOhA3 becomes KOhA. Every camxes-exp word remains, regardless of its score.

An experimental cmavo below that score also qualifies when real text uses it consistently with its highest-voted English definition. Both its meaning and its selma'o must match that definition. The closing section identifies the words that qualify through corpus evidence and the words excluded for inconsistent use.

The closing section also records class corrections based on a definition's meaning and attested use. It states each maintainer exception to this policy.

Each entry lists words by their normalized value and gives them one selma'o, as [../cll/lexicon.md](../cll/lexicon.md) explains. A selbri is a predicate. `la`, `lai` and `la'i` are LE because a name can be a selbri.

The implication after the entries marks some words `Indicator`, which the indicator stage reads. They are the words of UI, CAI, DAhO, FUhE and FUhO. camxes-exp also reads a bare NAI as an indicator, and [the experimental word forms](morphology.md) mark the NAI words so.

[The notation document](../../../docs/notation.md) explains the notation.

```jbogenbau
%classifier lexicon
  "a" "e" "ji" "o" "u" ∈ A
  "ba'i" "bai" "bau" "be'ei" "be'i" "ca'i" "cau" "ci'e" "ci'o" "ci'u" "cu'u" "de'i" "de'i'a" ∈ BAI
  "de'i'e" "de'i'i" "de'i'o" "de'i'u" "di'o" "do'e" "du'i" "du'o" "fa'e" "fau" "fi'e" "ga'a" ∈ BAI
  "gau" "ja'e" "ja'i" "ji'e" "ji'o" "ji'u" "ka'a" "ka'ai" "ka'i" "kai" "ki'i" "ki'oi" "ki'u" ∈ BAI
  "ko'au" "koi" "ku'u" "la'u" "le'a" "li'e" "ma'e" "ma'i" "mau" "me'a" "me'e" "mu'i" "mu'u" ∈ BAI
  "ni'i" "pa'a" "pa'u" "pi'o" "po'i" "pu'a" "pu'e" "ra'a" "ra'i" "rai" "ri'a" "ri'i" "sau" ∈ BAI
  "si'u" "ta'i" "tai" "ti'i" "ti'u" "tu'i" "va'o" "va'u" "zau" "zu'e" ∈ BAI
  "dei'i'u" "fi'ei" "ja'u" "kai'ai" "nai'i" "pau'u" "po'a" ∈ BAI
  "te'i" "xau" ∈ BAI
  (* #257 tracks the missing construction. pe'ei marks a connective without changing its syntactic scope. *)
  "ba'e" "ci'a" "pe'ei" "za'e" "zai'e" ∈ BAhE
  (* #257 tracks the missing construction. BAhEI has no experimental construction. *)
  "ba'ei" ∈ BAhEI
  "be" ∈ BE
  "bei" ∈ BEI
  (* #257 tracks the missing construction. BEIhE has no experimental construction. *)
  "bei'e" ∈ BEIhE
  "be'o" ∈ BEhO
  "bi'e" ∈ BIhE
  "bi'i" "bi'o" "mi'i" ∈ BIhI
  "bo" ∈ BO
  "boi" ∈ BOI
  "bu" ∈ BU
  "by" "cy" "dy" "fy" "ga'e" "ge'o" "gy" "iy" "je'o" "jo'o" "jy" "ky" "lo'a" "ly" "my" "na'a" ∈ BY
  "ny" "py" "ru'o" "ry" "se'e" "sy" "to'a" "ty" "uy" "vy" "xy" "y'y" "zy" ∈ BY
  "a'y" "e'y" "i'y" "o'y" "u'y" ∈ BY
  "au'y" "iy'y" ∈ BY
  "cai" "cau'i" "cu'i" "dai'i" "mau'i" "me'ai" "na'oi" "pei" "ru'e" "sai" ∈ CAI
  "ne'e" ∈ CAI
  "ca'a" "ka'e" "nu'o" "pu'i" ∈ CAhA
  "bi'ai" ∈ CAhA
  "ca'ei" ∈ CAhEI
  "cei" ∈ CEI
  "ce'e" ∈ CEhE
  "ci'au" ∈ CIhAU
  (* Score-two exception, explained under Dictionary additions. *)
  "ci'au'u" ∈ CIhAUhU
  "co" ∈ CO
  "be'e" "co'o" "co'oi" "coi" "di'ai" "fe'o" "fi'i" "je'e" "ju'i" "ke'o" "ki'ai" "ki'e" "mi'e" ∈ COI
  "mu'o" "nu'e" "pe'u" "re'i" "sa'ei" "ta'a" "vi'o" ∈ COI
  (* #257 tracks the missing construction. jo'au forms a vocative without changing the parser pipeline. *)
  "a'oi" "ci'oi" "fau'u" "jo'au" "o'ai" "tai'i" "xu'e" ∈ COI
  "bu'oi" "de'a'ai" "di'a'ai" "ke'o'a" "ku'au'i" "sau'ei" "sei'u" ∈ COI
  "ni'au" ∈ COI
  (* #257 tracks the missing construction. COhAI has no experimental construction. *)
  "co'ai" ∈ COhAI
  (* #257 tracks the missing construction. COhEhOhE has no experimental construction. *)
  "co'e'o'e" ∈ COhEhOhE
  "cu" ∈ CU
  (* #257 tracks the missing construction. CUhAU has no experimental construction. *)
  "cu'au" ∈ CUhAU
  "ba'au" "cu'e" "nau" "pu'au" ∈ CUhE
  (* #257 tracks the missing construction. xei'u attaches after a word without moving attitudes to the sentence. *)
  "da'o" "xei'u" ∈ DAhO
  "da'ei" "da'oi" "doi" ∈ DOI
  "do'oi" ∈ DOhOI
  "do'u" ∈ DOhU
  "fa" "fai" "fe" "fi" "fi'a" "fo" "fu" "zoi'u" ∈ FA
  "fai'i" ∈ FA
  "be'a" "bu'u" "ca'u" "du'a" "fa'a" "ga'u" "ne'a" "ne'i" "ne'u" "ni'a" "pa'o" "re'o" "ri'u" ∈ FAhA
  "ru'u" "te'e" "ti'a" "to'o" "vu'a" "ze'o" "zo'a" "zo'i" "zu'a" ∈ FAhA
  "bau'u" "xei'e" ∈ FAhA
  (* #257 tracks the missing construction. xo'a erases the suffix without switching to Loglan. *)
  "fa'o" "xo'a" ∈ FAhO
  "fa'u'u'u'u'u'u'u'u" ∈ FAhO
  (* #257 tracks the missing construction. FAhOhO has no experimental construction. *)
  "fa'o'o" ∈ FAhOhO
  "fe'e" ∈ FEhE
  "fe'u" ∈ FEhU
  "fi'o" ∈ FIhO
  "foi" ∈ FOI
  "fu'a" ∈ FUhA
  (* #257 tracks the missing construction. fu'ei requires an indicator instead of opening a quotation closed by fu'o. *)
  "fu'e" "fu'ei" ∈ FUhE
  "fu'o" ∈ FUhO
  "ga" "ge" "ge'i" "go" "gu" ∈ GA
  "ga'o" "ke'i" ∈ GAhO
  "ge'u" ∈ GEhU
  "gi" ∈ GI
  "gi'a" "gi'e" "gi'i" "gi'o" "gi'u" ∈ GIhA
  (* #257 tracks the missing construction. GIhEI has no experimental construction. *)
  "gi'ei" ∈ GIhEI
  "goi" "ne" "no'u" "pe" "po" "po'e" "po'u" ∈ GOI
  "bu'a" "bu'e" "bu'i" "co'e" "du" "go'a" "go'e" "go'i" "go'o" "go'u" "mo" "nei" "no'a" ∈ GOhA
  "xe'u" ∈ GOhA
  "gai'o" "ku'ai'i" ∈ GOhA
  "go'oi" "ta'ai" "ze'oi" ∈ GOhOI
  "gu'a" "gu'e" "gu'i" "gu'o" "gu'u" ∈ GUhA
  "fa'oi" "i" "oi'i" ∈ I
  "i'au" "iau" ∈ IhAU
  "ja" "je" "je'i" "ji'a'a" "jo" "ju" ∈ JA
  "ja'ei" "jai" ∈ JAI
  "jo'ai" ∈ JAI
  (* #257 tracks the missing construction. JAIhA has no experimental construction. *)
  "jai'a" ∈ JAIhA
  (* #257 tracks the missing construction. JAIhI has no experimental construction. *)
  "jai'i" ∈ JAIhI
  (* #257 tracks the missing construction. JIhOI has no experimental construction. *)
  "ji'oi" ∈ JIhOI
  "ce" "ce'o" "fa'u" "jo'e" "jo'u" "joi" "ju'e" "ku'a" "pi'u" ∈ JOI
  "ce'oi" "jo'oi" ∈ JOI
  "jo'i" ∈ JOhI
  (* #257 tracks the missing construction. KAUhU has no experimental construction. *)
  "kau'u" ∈ KAUhU
  "fei'u" "ke" "pi'ai" "va'au" ∈ KE
  "kei" ∈ KEI
  "ke'e" ∈ KEhE
  "ki" ∈ KI
  "ce'u" "da" "da'e" "da'u" "de" "de'e" "de'u" "dei" "di" "di'e" "di'u" "do" "do'i" "do'o" ∈ KOhA
  "fo'a" "fo'e" "fo'i" "fo'o" "fo'u" "ke'a" "ko" "ko'a" "ko'e" "ko'i" "ko'o" "ko'u" "ma" ∈ KOhA
  "ma'a" "mi" "mi'a" "mi'ai" "mi'o" "nau'o" "ra" "ri" "ru" "ta" "ti" "tu" "vo'a" "vo'e" ∈ KOhA
  "vo'i" "vo'o" "vo'u" "xai" "zi'o" "zo'e" "zu'ai" "zu'i" ∈ KOhA
  "do'au" "gi'au" "lau'u" "mi'oi" "nau'u" "ra'au" "sau'o" "voi'a" "xa'u" "xe'i" "xi'o" "zoi'i" ∈ KOhA
  "bo'a" "bo'e" "bo'i" "ca'au" "da'ai" "da'au" "dei'ei" "do'ei" ∈ KOhA
  "ku" ∈ KU
  "ku'au" ∈ KUhAU
  "ku'e" ∈ KUhE
  "ku'ei" ∈ KUhEI
  "ku'o" ∈ KUhO
  "ku'oi" ∈ KUhOI
  "ce'a" "lau" "tau" "zai" ∈ LAU
  (* #257 tracks the missing construction. Experimental syntax replaces the inherited LA constructions with LE. *)
  "la'ei" "lai'u" ∈ LA
  "la'e" "lu'a" "lu'e" "lu'i" "lu'o" "tu'a" "vu'i" "zo'ei" ∈ LAhE
  "lai'e" "moi'a" ∈ LAhE
  "du'au" "lu'au" ∈ LAhE
  "la" "la'i" "lai" "le" "le'e" "le'i" "lei" "lo" "lo'e" "lo'i" "loi" "me'ei" ∈ LE
  "ji'ai" "lo'au" "mo'oi" "ri'oi" ∈ LE
  "dau'u" "kai'i" "lo'o'o" "loi'e" "ti'oi" "xai'i" ∈ LE
  "le'ai" ∈ LEhAI
  "le'u" ∈ LEhU
  "li" "mai'o" "me'o" ∈ LI
  "bo'ai" ∈ LI
  "li'au" ∈ LIhAU
  (* #257 tracks the missing construction. LIhEI has no experimental construction. *)
  "li'ei" ∈ LIhEI
  "li'u" ∈ LIhU
  "lo'ai" "sa'ai" ∈ LOhAI
  "lo'o" ∈ LOhO
  "lo'oi" "mau'a" "xau'a" ∈ LOhOI
  "ko'ai" "koi'i" "xu'u" ∈ LOhOI
  "la'ai" "lo'u" ∈ LOhU
  "la'au" "lu" "tu'ai" ∈ LU
  "lu'ei" ∈ LUhEI
  "lu'u" ∈ LUhU
  (* #257 tracks the missing construction. sai'ei forms an ordinal modifier instead of an attitude intensity. *)
  "mai" "mo'o" "sai'ei" ∈ MAI
  "ma'o" ∈ MAhO
  "me" "me'au" ∈ ME
  "du'ai" ∈ ME
  "me'oi" ∈ MEhOI
  "me'u" ∈ MEhU
  "cei'a" "cu'o" "mei" "moi" "si'e" "va'e" ∈ MOI
  "coi'e" "doi'e" "jei'o" "mei'i" "moi'o" "soi'e" ∈ MOI
  "mo'e" ∈ MOhE
  "mo'i" ∈ MOhI
  "mu'oi" ∈ MUhOI
  "cau'a" "ja'a" "mai'e" "na" ∈ NA
  "ja'ai" "nai" ∈ NAI
  "je'a" "na'e" "na'ei" "no'e" "to'e" ∈ NAhE
  "cau'e" "gu'y" "noi'e" ∈ NAhE
  "cai'e" "rei'e" "sai'e" ∈ NAhE
  "na'u" ∈ NAhU
  "ni'e" ∈ NIhE
  "ni'o" "no'i" ∈ NIhO
  "noi" "poi" "voi" ∈ NOI
  "noi'a" "poi'a" "soi'a" ∈ NOIhA
  "poi'o'a" ∈ NOIhA
  "no'oi" "po'oi" ∈ NOhOI
  "du'u" "jei" "ka" "kai'u" "li'i" "mu'e" "ni" "nu" "poi'i" "pu'u" "si'o" "su'u" "xe'ei" "za'i" ∈ NU
  "zu'o" ∈ NU
  "bu'ai" "ka'ei" "ni'ai" ∈ NU
  "kai'ei" "te'oi" ∈ NU
  "nu'a" ∈ NUhA
  "nu'i" ∈ NUhI
  "nu'u" ∈ NUhU
  "bi" "ce'i" "ci" "ci'i" "da'a" "dau" "du'e" "fei" "fi'u" "gai" "jau" "ji'i" "ka'o" "ki'o" ∈ PA
  "ma'u" "me'i" "mo'a" "mu" "ni'u" "no" "no'o" "pa" "pai" "pi" "pi'e" "ra'e" "rau" "re" "rei" ∈ PA
  "ro" "ro'oi" "so" "so'a" "so'e" "so'i" "so'o" "so'u" "su'e" "su'o" "su'oi" "te'o" "tu'o" ∈ PA
  "vai" "vo" "xa" "xo" "xo'e" "za'u" "ze" ∈ PA
  "fai'u" "ja'au" "ka'ei'a" "no'ai" "se'i'i" "sei'a" "su'ai" "su'au" "tai'e" "tau'u" ∈ PA
  "va'ei'a" "xe'a" "xe'e" "xei" "ze'au" ∈ PA
  "ru'oi" "su'o'o" ∈ PA
  "pe'e" ∈ PEhE
  "pe'o" ∈ PEhO
  "ba" "ca" "pu" ∈ PU
  "ra'o" ∈ RAhO
  "de'ei" "mu'ei" "re'u" "roi" ∈ ROI
  "ba'oi" "va'ei" ∈ ROI
  "sa" ∈ SA
  "ko'ei" "lu'oi" "se" "so'o'o'oi" "su'ei" "te" "to'ai" "ve" "vo'ai" "xe" "xo'ai" ∈ SE
  "se'ai" "se'o'e" ∈ SE
  "sei" "ti'o" "xoi" ∈ SEI
  "sei'e" ∈ SEI
  "se'u" ∈ SEhU
  (* #257 tracks the missing construction. SEhEhI has no experimental construction. *)
  "se'e'i" "ve'e'i" ∈ SEhEhI
  "si" "si'au'i" "ze'ei" ∈ SI
  (* #257 tracks the missing construction. SIhIhEI has no experimental construction. *)
  "si'i'ei" ∈ SIhIhEI
  (* #257 tracks the missing construction. SIhOI has no experimental construction. *)
  "si'oi" ∈ SIhOI
  "fi'oi" "soi" ∈ SOI
  "so'oi" ∈ SOhOI
  "su" ∈ SU
  "su'u'u'u'u'u'u'u" ∈ SUhUhUhUhUhUhUhU
  "di'i" "na'o" "ru'i" "ta'e" ∈ TAhE
  "dei'a" "ze'ai" ∈ TAhE
  (* #257 tracks the missing construction. TAhOI has no experimental construction. *)
  "ta'oi" ∈ TAhOI
  "tei" ∈ TEI
  "te'u" ∈ TEhU
  "to" "to'i" ∈ TO
  "toi" ∈ TOI
  (* #257 tracks the missing construction. TOIhE has no experimental construction. *)
  "koi'e" "toi'e" ∈ TOIhE
  (* #257 tracks the missing construction. TOIhO has no experimental construction. *)
  "toi'o" ∈ TOIhO
  "tu'e" ∈ TUhE
  "tu'u" ∈ TUhU
  "a'a" "a'e" "a'i" "a'o" "a'u" "ai" "ai'i" "au" "ba'a" "ba'u" "be'u" "bi'u" "bu'o" "ca'e" ∈ UI
  "da'i" "dai" "do'a" "e'a" "e'e" "e'i" "e'o" "e'u" "ei" "fu'i" "ga'i" "ge'e" "i'a" "i'e" "i'i" ∈ UI
  "i'o" "i'u" "ia" "ie" "ii" "io" "iu" "ja'o" "je'u" "ji'a" "jo'a" "ju'a" "ju'o" "ju'oi" "ka'u" ∈ UI
  "kau" "ke'u" "ki'a" "ko'oi" "ku'i" "la'a" "le'o" "li'a" "li'o" "mi'u" "mu'a" "na'i" "o'a" ∈ UI
  "o'e" "o'i" "o'o" "o'u" "oi" "oi'a" "pa'e" "pau" "pe'a" "pe'i" "po'o" "ra'u" "re'e" ∈ UI
  "ri'e" "ro'a" "ro'e" "ro'i" "ro'o" "ro'u" "ru'a" "sa'a" "sa'e" "sa'u" "se'a" "se'i" "se'o" ∈ UI
  "si'a" "si'au" "su'a" "ta'o" "ta'u" "ti'e" "to'u" "u'a" "u'e" "u'i" "u'o" "u'u" "ua" "ue" ∈ UI
  "ue'i" "ui" "uo" "uu" "va'i" "vu'e" "xo'o" "xu" "za'a" "zo'o" "zu'u" ∈ UI
  "a'au" "a'u'u" "au'a" "au'e" "au'u" "bi'a" "bu'a'a" "ci'au'u'au'i" "cu'ei" "cu'ei'ai" ∈ UI
  "cu'i'a" "dai'a" "e'e'e" "ei'au" "ei'i" "ei'u" "fu'au" "ge'ei" "ia'u" "ie'e" "ie'i" "ii'au" ∈ UI
  "io'e" "io'u" "jai'ai" "jau'i" "je'au" "kai'a" "ki'a'au'u'au'i" "ky'u" "li'oi" "mi'au" "moi'i" ∈ UI
  "oi'u" "pei'o" "ra'i'au" "ri'ai" "roi'i" "sei'i" "si'ai" "so'ei" "te'y" "uai" "uei'e" "ui'i" ∈ UI
  "uo'o" "uu'i" "va'oi" "vei'i" "xa'a" "xa'i" "xe'o" "xu'a" "xu'o" "zai'a" "zi'a" ∈ UI
  "au'o" "bi'au" "bo'oi" "ca'e'ei" "ci'ai" "jei'u" "kai'e" "ki'au" "mau'u" "ne'au" "oi'o" ∈ UI
  "pau'ai" "pe'ai" "ra'ei" "ta'ei" "toi'u" "uau'o" "ue'e" "va'u'ai" "xa'oi" "xe'e'e" "xy'y" "za'oi" ∈ UI
  "cu'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u" ∈ UI
  "va" "vi" "vu" ∈ VA
  "vau" ∈ VAU
  "vei" ∈ VEI
  "ve'a" "ve'e" "ve'i" "ve'u" ∈ VEhA
  "ve'o" ∈ VEhO
  "vi'a" "vi'e" "vi'i" "vi'u" ∈ VIhA
  "vu'o" ∈ VUhO
  (* #257 tracks the missing construction. VUhOI has no experimental construction. *)
  "vu'oi" ∈ VUhOI
  "cu'a" "de'o" "fa'i" "fe'a" "fe'i" "fu'u" "ge'a" "gei" "joi'i" "ju'u" "ne'o" "pa'i" "pi'a" ∈ VUhU
  "pi'i" "re'a" "ri'o" "sa'i" "sa'o" "si'i" "su'i" "te'a" "va'a" "vu'u" ∈ VUhU
  (* #257 tracks the missing construction. xo'ei needs an operator construction instead of defaulting to zero arguments. *)
  "je'e'e" "nei'au" "xo'ei" ∈ VUhU
  "di'ei'o'au" ∈ VUhU
  "te'ai" "xi" "xi'e" ∈ XI
  (* #257 tracks the missing construction. XOhI has no experimental construction. *)
  "xo'i" ∈ XOhI
  "ie'o" ∈ Y
  "ba'o" "ca'o" "co'a" "co'a'a" "co'au'a" "co'i" "co'u" "co'u'a" "de'a" "di'a" "mo'u" "pu'o" ∈ ZAhO
  "sau'a" "xa'o" "xo'u" "za'o" ∈ ZAhO
  "ca'o'a" ∈ ZAhO
  "zei" ∈ ZEI
  "ze'a" "ze'e" "ze'i" "ze'u" ∈ ZEhA
  "za" "zi" "zu" ∈ ZI
  "za'ai" ∈ ZI
  "zi'e" ∈ ZIhE
  "doi'u" "ma'oi" "zo" ∈ ZO
  "la'o" "zoi" ∈ ZOI
  (* #257 tracks the missing construction. ZOhAU has no experimental construction. *)
  "zo'au" ∈ ZOhAU
  "ci'e'u" "la'oi" "ra'oi" "zo'oi" ∈ ZOhOI
  "ce'ai" "zo'u" ∈ ZOhU
  "fi'ai" ∈ ZOhU
```

```jbogenbau
%implies UI ∪ CAI ∪ DAhO ∪ FUhE ∪ FUhO ⟹ Indicator
```

## Differences from CLL and camxes-exp

### Dictionary additions

All 255 experimental cmavo whose highest English score is at least three appear here. The dictionary gives `io'e` no selma'o. Its English definition 71929 scores three and calls it an attitudinal. The maintainers therefore assign it UI from that definition.

The lexicon also includes `ci'au'u` as the companion closer of CIhAU. [Definition 71993](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/ci%27au%27u/en-71993.md) gives it class CIhAUhU and score two. The maintainer permits this exception because CIhAU needs this companion closer before further attitudes that stand outside the conversion.

The dictionary gives `la'ai` class LOhU. Every written example in [definition 56471](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/la%27ai/en-56471.md) closes with `le'u`. The words stage reads the quote through `le'u`, as that definition shows. The pipeline accepts `la'ai meri.celi le'u` and `la'ai li bai le'u jungo prenu`.

English definitions determine the classes, rather than the combined classes in `word.toml`. Among the 255 words that meet the score threshold, no highest-voted definition ties or lists several classes. The following table records their disagreements about base classes between English definitions. Definition numbers identify the English files in the dictionary snapshot.

| Word | Selected definition | Score | Base class | Other definitions and scores |
|---|---|---:|---|---|
| `i'au` | 66786 | 3 | IhAU | 66004: TOIhE, 0 |
| `ja'ei` | 20551 | 5 | JAI | 36695: NAhE, 0 |
| `ji'ai` | 70394 | 4 | LE | 66153: no class, -1 |
| `li'ei` | 66452 | 4 | LIhEI | 57227: LOhU, 1 / 70395: LI, 1 |
| `me'ei` | 20482 | 5 | LE | 20559: ME, -1 |
| `ra'oi` | 19089 | 4 | ZOhOI | 66619: RAhOI, 1 |
| `soi'a` | 68608 | 3 | NOIhA | 64242: PA, 0 |
| `su'ai` | 66822 | 3 | PA | 63923: SE, 2 |
| `xa'o` | 14481 | 10 | ZAhO | 14196: no class, -4 |
| `xai` | 2501 | 5 | KOhA | 38184: COI, 2 |
| `xe'e` | 66428 | 4 | PA | 15685: no class, -2 |
| `xei` | 16190 | 6 | PA | 71274: NU, 1 |
| `xei'e` | 72962 | 7 | FAhA | 72250: KOhA, 3 |
| `xi'o` | 73346 | 3 | KOhA | 66915: XOhI, -6 |
| `xo'e` | 18316 | 13 | PA | 15103: LE, 3 |
| `xoi` | 56726 | 5 | SEI | 73767: XOI, 1 / 15601: FIhO, 0 / 36692: UI1 / ROI / NA, 0 |
| `zai'e` | 66440 | 3 | BAhE | 66411: XOhEhOhE, -1 |
| `zo'au` | 67203 | 6 | ZOhAU | 36725: LA, 1 |

Seven words from that set have several English definitions with the same base class. The following table records their meanings, including the incompatible uses of `lo'au`, `noi'a` and `poi'a`. The highest-voted definition determines the selected meaning even when the class stays the same.

| Word | Base class | Selected definition and meaning | Other definition and meaning |
|---|---|---|---|
| `dei'i'u` | BAI | 73209, score 3: date and time | 75319, score 1: date and time, with different unit abbreviations |
| `ei'i` | UI | 67725, score 3: constraint, independence or resistance | 68582, score 1: the same attitude scale |
| `lau'u` | KOhA | 68663, score 4: referent of the preceding utterance | 66814, score 2: the same referent |
| `lo'au` | LE | 71814, score 3: presuppositional definite article | 71812, score 0: generic article for typical traits |
| `moi'o` | MOI | 63721, score 5: indexed date or time | 63719, score 0: a similar date or time, with different interval examples |
| `noi'a` | NOIhA | 68607, score 4: incidental adverbial | 57076, score 0: incidental relative clause on a number or digit |
| `poi'a` | NOIhA | 68606, score 4: restrictive adverbial | 57075, score 0: restrictive relative clause on a number or digit |

Six camxes-exp entries take dictionary classes here. They are `li'oi` in UI, `o'ai` in COI, `su'ai` and `xe'e` in PA, `xei'e` in FAhA, and `xoi` in SEI. Their highest-voted definitions override SU, UI, SE, UI, KOhA and SOI, respectively. All other camxes-exp entries retain their classes.

The threshold does not remove existing camxes-exp words. Thirteen of those words have a highest English score below three in this snapshot. They are `ai'i`, `cei'a`, `co'au'a`, `co'u'a`, `de'i'a`, `de'i'i`, `de'i'o`, `de'i'u`, `fi'oi`, `ku'au`, `ku'oi`, `sau'a` and `su'ei`.

`fi'oi` retains camxes-exp's SOI class. This follows Ilmen's own [merge of FIhOI into SOI](https://github.com/Ntsekees/ilmentufa/commit/a1105c3cebc75958b014e0ebc0b204f44af5e79d). The commit dates from 2014-06-26. Its title is "Merging FIhOI and new-SOI".

Ilmen wrote [definition 53170](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/fi%27oi/en-53170.md) on 2014-03-14, three months before that merge. It gives FIhOI with a score of two and names `fi'au` as the terminator. The definition received no update after the merge.

With `soi-clause` enabled, `fi'oi` closes with `se'u`. This deliberately departs from the definition's `fi'au` terminator. `fi'au` now has an unrelated [definition, 70585](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/fi%27au/en-70585.md), for a continued-fraction operator.

`ku'oi` closes NOhOI clauses here. The [NOhOI closers section](syntax.md#nohoi-closers) gives the usage evidence and the departure from definition 73011.

### Additions from real text

Corpus evidence qualifies the 95 words in the CONSISTENT set of the [evidence summary](../../../docs/experimental-cmavo-evidence.md#consistent-use). Their highest English scores are below three. The summary states the class correction and the arithmetic for new spellings. These additions use the same September 13, 2026 dictionary snapshot.

The [judgments' summary](../../../docs/experimental-cmavo-evidence.md) records each reviewed word, its definition, the evidence count and the verdict. These are the 95 corpus-evidence words, grouped by their classes here:

| Class | Words |
|---|---|
| BAI | `te'i`, `xau` |
| BY | `au'y`, `iy'y` |
| CAI | `ne'e` |
| CAhA | `bi'ai` |
| COI | `bu'oi`, `de'a'ai`, `di'a'ai`, `ke'o'a`, `ku'au'i`, `ni'au`, `sau'ei`, `sei'u` |
| DOhOI | `do'oi` |
| FA | `fai'i` |
| FAhO | `fa'u'u'u'u'u'u'u'u` |
| GOhA | `gai'o`, `ku'ai'i` |
| IhAU | `iau` |
| JAI | `jo'ai` |
| KOhA | `bo'a`, `bo'e`, `bo'i`, `ca'au`, `da'ai`, `da'au`, `dei'ei`, `do'ei` |
| KUhAU | `ku'au` |
| LA | `lai'u` |
| LAhE | `du'au`, `lu'au` |
| LE | `dau'u`, `kai'i`, `lo'o'o`, `loi'e`, `ti'oi`, `xai'i` |
| LI | `bo'ai` |
| LIhAU | `li'au` |
| LOhOI | `ko'ai`, `koi'i`, `xu'u` |
| LUhEI | `lu'ei` |
| ME | `du'ai` |
| NAhE | `cai'e`, `rei'e`, `sai'e` |
| NOIhA | `poi'o'a` |
| NU | `kai'ei`, `te'oi` |
| PA | `ru'oi`, `su'o'o` |
| ROI | `ba'oi`, `va'ei` |
| SE | `se'ai`, `se'o'e` |
| SEI | `sei'e` |
| SIhIhEI | `si'i'ei` |
| SIhOI | `si'oi` |
| SOhOI | `so'oi` |
| SUhUhUhUhUhUhUhU | `su'u'u'u'u'u'u'u` |
| TAhE | `dei'a`, `ze'ai` |
| TAhOI | `ta'oi` |
| TOIhO | `toi'o` |
| UI | `au'o`, `bi'au`, `bo'oi`, `ca'e'ei`, `ci'ai`, `cu'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u`, `jei'u`, `kai'e`, `ki'au`, `mau'u`, `ne'au`, `oi'o`, `pau'ai`, `pe'ai`, `ra'ei`, `ta'ei`, `toi'u`, `uau'o`, `ue'e`, `va'u'ai`, `xa'oi`, `xe'e'e`, `xy'y`, `za'oi` |
| VUhU | `di'ei'o'au` |
| Y | `ie'o` |
| ZI | `za'ai` |
| ZOhU | `fi'ai` |

Four of these words have competing English definitions with different base classes. Their highest-scored definitions determine their classes here.

| Word | Selected definition | Score | Base class | Other definitions and scores |
|---|---|---:|---|---|
| `bo'ai` | 67093 | 1 | LI | 44168: BAI, -1 |
| `bo'e` | 67081 | 2 | KOhA | 66408: BY, -1 |
| `ko'ai` | 68964 | 2 | LOhOI | 67092: LI, -1 / 68965: NU, 1 / 72014: LOhOI, 1 |
| `ze'ai` | 66154 | 2 | TAhE | 18407: ZEhA, 1 |

The LOhOI definitions of `ko'ai` also differ within that class. Definition 68964 permits an optional variable count. Definition 72014 requires that count when the abstraction binds several variables. The higher score selects the optional count.

The FA definitions of `fai'i` also differ. Definition 73176 scores two and introduces a dangling argument that binds `zoi'i`. Definition 71747 scores one and removes its argument from the place structure. Definition 66764 scores minus two and marks the word abandoned. The highest score selects the dangling-argument use.

The TAhE definition 66121 of `dei'a` scores two and means decreasingly. Definition 66308 scores zero and asks readers to ignore that definition.

The two English definitions of `so'oi`, 71817 and 72780, tie with a score of one and both give SOhOI. Both introduce an adverbial relative clause closed by `se'u`. They differ on whether the outer clause is claimed. Corpus evidence supports their shared construction, so the word keeps SOhOI without choosing between those meanings. Its subsentence construction supports both definitions.

Definition 60530 gives `bi'ai` class CAhA as a marker for a tagged sumti. The bridi must be true under the conditions that the tagged sumti names. Corpus evidence supports its bare modal use, as in `bi'ai klama`, so the lexicon admits it despite its score of two. CAhA is an atom of `tag` here, so the grammar accepts both uses. Thus `mi klama bi'ai lo nu do cadzu` gives `bi'ai` the sumti `lo nu do cadzu`.

The review excludes the following twelve words. Eleven have uses that conflict with their top English definitions. `pu'ei` has no English definition, and its use also differs from its Lojban definition. The table gives the reviewer's reason for each exclusion.

| Word | Reason for exclusion |
|---|---|
| `po'au` | Used as LOhOI, defined as restrictive GOI |
| `zei'a` | Used to join words, defined as a TAhE tense |
| `zei'i` | Used to open compound brackets, defined as a UI contour |
| `le'ei` | Used as a narrow-scope intensional article, defined as Loglan's article |
| `tei'u` | Used as a quotation opener, defined as a JAhOI terminator |
| `pu'ei` | Used as a before conjunction, with no English definition |
| `ja'oi` | Used as an age predicate, defined as a permutation opener |
| `iu'e` | Used for stronger love, defined for sexual consent |
| `zai'u` | Used to mean again, defined to mark a following quotation |
| `soi'i` | Used as an article for subkinds, defined as a relativizer |
| `li'ai` | Used for a character string, defined as LI for unevaluated mekso |
| `zi'u` | Used to attach a relative clause, defined as LAhE before a sumti |

The other reviewed words lack clear evidence or appear as different words, so this policy does not add them.

`ni'au` has one English definition, 57080 by gleki, with a score of one. It describes a Chinese-style greeting and points to `coi`, but files the word in CAI. The maintainers assign COI from that meaning and its attested vocative use.

The broader IRC search finds 59 matching lines, including mentions and substring matches. The [evidence table](../../../docs/experimental-cmavo-evidence.md#consistent-use) counts two inspected excerpts. Examples of greeting use include `ni'au .cntr.`, `ni'au ma`, `ni'au do` and `doi ksion ni'au`. This class correction follows meaning and use rather than the dictionary's CAI filing.

### Classes and words without their defined constructions

Classification does not add a construction to the grammar. [#257](https://github.com/int19h/gencmu/issues/257) tracks unsupported experimental uses. The comments identify them. Those words retain their dictionary class even where the syntax rejects them.

The unsupported classes tracked there are BAhEI, BEIhE, COhAI, COhEhOhE, CUhAU, FAhOhO, GIhEI, JAIhA, JAIhI, JIhOI and KAUhU. They also include LA, LIhEI, SEhEhI, TOIhE, VUhOI, XOhI and ZOhAU. Experimental syntax replaces CLL's LA constructions with LE, so `la'ei` and `lai'u` have no construction here.

The [mekso rules](syntax.md#numbers-lerfu-strings-and-mekso) also provide no `bi'e` grouping (`BIhE`) and no `jo'i` array (`JOhI`).

Corpus evidence also supplies words in SIhIhEI, SIhOI, TAhOI and TOIhO. #257 tracks their constructions.

Some words belong to supported classes but need different constructions. Their comments also name #257. The following notes distinguish their current readings from their defined uses.

The dictionary gives `fu'ei` class FUhE for a quotation closed by `fu'o`. The indicator stage instead requires an indicator immediately after it. Thus `mi fu'ei klama fu'o` rejects at `klama`. With an indicator, `fu'ei ui mi klama fu'o` parses as an indicator group and a sentence, without a quotation. #257 tracks its quotation use.

The dictionary gives `xo'a` class FAhO for a switch to TLI Loglan. The words stage instead erases it and the remaining text. It does not parse that suffix as Loglan or allow a switch back. #257 tracks its language switch.

The dictionary gives `jo'au` class COI for a parser version or dialect declaration. It forms an ordinary vocative here and does not change the selected pipeline. #257 tracks pipeline switching.

The dictionary gives `xei'u` class DAhO to attach following attitudes to the containing sentence. The indicator stage instead attaches both `xei'u` and the attitudes to the preceding word. #257 tracks its special attachment rule.

The dictionary gives `sai'ei` class MAI to express attitude intensity with a number. The syntax instead reads the number and MAI as an ordinal free modifier. It does not attach that number to the preceding attitude. #257 tracks its intensity construction.

The dictionary gives `pe'ei` class BAhE for a connective with maximal scope. The indicator stage marks the connective, but the syntax keeps its ordinary scope. #257 tracks its special scope rule.

The dictionary gives `xo'ei` class VUhU for a digit-string operator with an optional argument. Without that argument, its length is unspecified. The syntax instead requires an ordinary operator construction with operands. It does not accept `li xo'ei lo'o` as a number. #257 tracks its implicit-argument construction.

### Other baseline differences

The [replacement quote grammar](../common/lohai.md) reads up to two LOhAI runs before `le'ai`. A bare `le'ai` also forms a whole quote. Both runs can open with the same word, as in `mi lo'ai do lo'ai ko'a le'ai klama`. [Definition 16350](https://github.com/int19h/jbocirvei/blob/8c1579254e73c72d20d202557e42d4d92346f6bc/dict/le%27ai/en-16350.md) instead pairs a mistaken part after `lo'ai` with a replacement part after `sa'ai`. Either part can come first or be absent. The grammar retains camxes-exp's broader form.

The Y word `ie'o` retains its dictionary class and acts as hesitation in the words stage.

The ZOI delimiter rule skips a hesitation that no BU follows. Before `bu`, `ie'o` forms a letter word that can act as a delimiter.

The dictionary gives `ze'ei` class SI, but the words stage treats that spelling as a joiner. Its result takes the right word's grammar and normalized value. The complete expression remains in its image. A magic right word and a missing right word both reject.

`ro'oi` belongs to PA here, beside `su'oi`. camxes-exp includes only `su'oi`, while camxes-beta includes both. The pipeline accepts `ro'oi broda` as a quantified description.

The lexicon omits camxes-exp's entry for `y`. The forms stage reads a run of `y` as hesitation instead of a cmavo.

camxes-exp gives each word one selma'o. It reassigns the CLL words `la`, `lai` and `la'i` to LE because it reads names as selbri. This classifier retains those classes.
