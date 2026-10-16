# The experimental lexicon

This document is the lexicon of the forms stage in the [experimental](../dialects/experimental.md) dialect. A lexicon is a list of words, each with its classes. The forms stage follows normalization. It divides the phonemes of the text into words. A cmavo is a particle, a short structure word. A selma'o is a word class of cmavo.

A token is one unit that a stage reads or emits. A token's value is the string that exact comparisons read. Its image is the string that people see.

The maintainers edit this lexicon by hand. Its baseline is the word lists of camxes-exp, the experimental grammar of the camxes parser. The source is `camxes-exp.peg` in ilmentufa, at commit [`778ea138f7d150121ca722db7536ce3b123943ac`](https://github.com/lojban/ilmentufa/blob/778ea138f7d150121ca722db7536ce3b123943ac/camxes-exp.peg). The lexicon contains CLL (*The Complete Lojban Language*) cmavo and experimental cmavo. The closing section lists its additions and class differences.

The dictionary additions follow the [policy for issue #211](https://github.com/int19h/gencmu/issues/211#issuecomment-6204819697). The dictionary is the Lensisku export of September 13, 2026, in [jbocirvei](https://github.com/int19h/jbocirvei/tree/8c1579254e73c72d20d202557e42d4d92346f6bc/dict). An experimental cmavo qualifies when its highest-voted English definition scores at least three. The highest-voted definition supplies its class. Numeric subcategories do not affect classification, so UI7a becomes UI and KOhA3 becomes KOhA. Every camxes-exp word remains, regardless of its score.

Each entry lists words by their normalized value and gives them one selma'o, as [lexicon-cll.md](lexicon-cll.md) explains. A selbri is a predicate. `la`, `lai` and `la'i` are LE because a name can be a selbri.

The implication after the entries marks some words `Indicator`, which the indicator stage reads. They are the words of UI, CAI, DAhO, FUhE and FUhO. camxes-exp also reads a bare NAI as an indicator, and [the experimental word forms](experimental.md) mark the NAI words so.

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
  "dei'i'u" "fi'ei" "ja'u" "kai'ai" "nai'i" "pau'u" "po'a" ∈ BAI
  "ba'e" "ci'a" "pe'ei" "za'e" "zai'e" ∈ BAhE
  (* #212: BAhEI has no experimental construction. *)
  "ba'ei" ∈ BAhEI
  "be" ∈ BE
  "bei" ∈ BEI
  (* #212: BEIhE has no experimental construction. *)
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
  "cai" "cau'i" "cu'i" "dai'i" "mau'i" "me'ai" "na'oi" "pei" "ru'e" "sai" ∈ CAI
  "ca'a" "ka'e" "nu'o" "pu'i" ∈ CAhA
  (* #212: CAhEI has no experimental construction. *)
  "ca'ei" ∈ CAhEI
  "cei" ∈ CEI
  "ce'e" ∈ CEhE
  (* #212: CIhAU has no experimental construction. *)
  "ci'au" ∈ CIhAU
  "co" ∈ CO
  "be'e" "co'o" "co'oi" "coi" "di'ai" "fe'o" "fi'i" "je'e" "ju'i" "ke'o" "ki'ai" "ki'e" "mi'e" ∈ COI
  "mu'o" "nu'e" "pe'u" "re'i" "sa'ei" "ta'a" "vi'o" ∈ COI
  "a'oi" "ci'oi" "fau'u" "jo'au" "o'ai" "tai'i" "xu'e" ∈ COI
  (* #212: COhAI has no experimental construction. *)
  "co'ai" ∈ COhAI
  (* #212: COhEhOhE has no experimental construction. *)
  "co'e'o'e" ∈ COhEhOhE
  "cu" ∈ CU
  (* #212: CUhAU has no experimental construction. *)
  "cu'au" ∈ CUhAU
  "ba'au" "cu'e" "nau" "pu'au" ∈ CUhE
  "da'o" "xei'u" ∈ DAhO
  "da'ei" "da'oi" "doi" ∈ DOI
  "do'u" ∈ DOhU
  "fa" "fai" "fe" "fi" "fi'a" "fo" "fu" "zoi'u" ∈ FA
  "be'a" "bu'u" "ca'u" "du'a" "fa'a" "ga'u" "ne'a" "ne'i" "ne'u" "ni'a" "pa'o" "re'o" "ri'u" ∈ FAhA
  "ru'u" "te'e" "ti'a" "to'o" "vu'a" "ze'o" "zo'a" "zo'i" "zu'a" ∈ FAhA
  "bau'u" "xei'e" ∈ FAhA
  "fa'o" "xo'a" ∈ FAhO
  (* #212: FAhOhO has no experimental construction. *)
  "fa'o'o" ∈ FAhOhO
  "fe'e" ∈ FEhE
  "fe'u" ∈ FEhU
  "fi'o" ∈ FIhO
  "foi" ∈ FOI
  "fu'a" ∈ FUhA
  "fu'e" "fu'ei" ∈ FUhE
  "fu'o" ∈ FUhO
  "ga" "ge" "ge'i" "go" "gu" ∈ GA
  "ga'o" "ke'i" ∈ GAhO
  "ge'u" ∈ GEhU
  "gi" ∈ GI
  "gi'a" "gi'e" "gi'i" "gi'o" "gi'u" ∈ GIhA
  (* #212: GIhEI has no experimental construction. *)
  "gi'ei" ∈ GIhEI
  "goi" "ne" "no'u" "pe" "po" "po'e" "po'u" ∈ GOI
  "bu'a" "bu'e" "bu'i" "co'e" "du" "go'a" "go'e" "go'i" "go'o" "go'u" "mo" "nei" "no'a" ∈ GOhA
  "xe'u" ∈ GOhA
  (* #212: GOhOI has no experimental construction. *)
  "go'oi" "ta'ai" "ze'oi" ∈ GOhOI
  "gu'a" "gu'e" "gu'i" "gu'o" "gu'u" ∈ GUhA
  "fa'oi" "i" "oi'i" ∈ I
  (* #212: IhAU has no experimental construction. *)
  "i'au" ∈ IhAU
  "ja" "je" "je'i" "ji'a'a" "jo" "ju" ∈ JA
  "ja'ei" "jai" ∈ JAI
  (* #212: JAIhA has no experimental construction. *)
  "jai'a" ∈ JAIhA
  (* #212: JAIhI has no experimental construction. *)
  "jai'i" ∈ JAIhI
  (* #212: JIhOI has no experimental construction. *)
  "ji'oi" ∈ JIhOI
  "ce" "ce'o" "fa'u" "jo'e" "jo'u" "joi" "ju'e" "ku'a" "pi'u" ∈ JOI
  "ce'oi" "jo'oi" ∈ JOI
  "jo'i" ∈ JOhI
  (* #212: KAUhU has no experimental construction. *)
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
  "ku" ∈ KU
  "ku'au" ∈ KUhAU
  "ku'e" ∈ KUhE
  (* #212: KUhEI has no experimental construction. *)
  "ku'ei" ∈ KUhEI
  "ku'o" ∈ KUhO
  "ku'oi" ∈ KUhOI
  "ce'a" "lau" "tau" "zai" ∈ LAU
  (* #212: experimental syntax replaces the inherited LA constructions with LE. *)
  "la'ei" ∈ LA
  "la'e" "lu'a" "lu'e" "lu'i" "lu'o" "tu'a" "vu'i" "zo'ei" ∈ LAhE
  "lai'e" "moi'a" ∈ LAhE
  "la" "la'i" "lai" "le" "le'e" "le'i" "lei" "lo" "lo'e" "lo'i" "loi" "me'ei" ∈ LE
  "ji'ai" "lo'au" "mo'oi" "ri'oi" ∈ LE
  "le'ai" ∈ LEhAI
  "le'u" ∈ LEhU
  "li" "mai'o" "me'o" ∈ LI
  (* #212: LIhEI has no experimental construction. *)
  "li'ei" ∈ LIhEI
  "li'u" ∈ LIhU
  "lo'ai" "sa'ai" ∈ LOhAI
  "lo'o" ∈ LOhO
  "lo'oi" "mau'a" "xau'a" ∈ LOhOI
  "la'ai" "lo'u" ∈ LOhU
  "la'au" "lu" "tu'ai" ∈ LU
  "lu'u" ∈ LUhU
  "mai" "mo'o" "sai'ei" ∈ MAI
  "ma'o" ∈ MAhO
  "me" "me'au" ∈ ME
  "me'oi" ∈ MEhOI
  "me'u" ∈ MEhU
  "cei'a" "cu'o" "mei" "moi" "si'e" "va'e" ∈ MOI
  "coi'e" "doi'e" "jei'o" "mei'i" "moi'o" "soi'e" ∈ MOI
  "mo'e" ∈ MOhE
  "mo'i" ∈ MOhI
  (* #212: MUhOI has no experimental construction. *)
  "mu'oi" ∈ MUhOI
  "cau'a" "ja'a" "mai'e" "na" ∈ NA
  "ja'ai" "nai" ∈ NAI
  "je'a" "na'e" "na'ei" "no'e" "to'e" ∈ NAhE
  "cau'e" "gu'y" "noi'e" ∈ NAhE
  "na'u" ∈ NAhU
  "ni'e" ∈ NIhE
  "ni'o" "no'i" ∈ NIhO
  "noi" "poi" "voi" ∈ NOI
  (* #212: NOIhA has no experimental construction. *)
  "noi'a" "poi'a" "soi'a" ∈ NOIhA
  "no'oi" "po'oi" ∈ NOhOI
  "du'u" "jei" "ka" "kai'u" "li'i" "mu'e" "ni" "nu" "poi'i" "pu'u" "si'o" "su'u" "xe'ei" "za'i" ∈ NU
  "zu'o" ∈ NU
  "bu'ai" "ka'ei" "ni'ai" ∈ NU
  "nu'a" ∈ NUhA
  "nu'i" ∈ NUhI
  "nu'u" ∈ NUhU
  "bi" "ce'i" "ci" "ci'i" "da'a" "dau" "du'e" "fei" "fi'u" "gai" "jau" "ji'i" "ka'o" "ki'o" ∈ PA
  "ma'u" "me'i" "mo'a" "mu" "ni'u" "no" "no'o" "pa" "pai" "pi" "pi'e" "ra'e" "rau" "re" "rei" ∈ PA
  "ro" "ro'oi" "so" "so'a" "so'e" "so'i" "so'o" "so'u" "su'e" "su'o" "su'oi" "te'o" "tu'o" ∈ PA
  "vai" "vo" "xa" "xo" "xo'e" "za'u" "ze" ∈ PA
  "fai'u" "ja'au" "ka'ei'a" "no'ai" "se'i'i" "sei'a" "su'ai" "su'au" "tai'e" "tau'u" ∈ PA
  "va'ei'a" "xe'a" "xe'e" "xei" "ze'au" ∈ PA
  "pe'e" ∈ PEhE
  "pe'o" ∈ PEhO
  "ba" "ca" "pu" ∈ PU
  "ra'o" ∈ RAhO
  "de'ei" "mu'ei" "re'u" "roi" ∈ ROI
  "sa" ∈ SA
  "ko'ei" "lu'oi" "se" "so'o'o'oi" "su'ei" "te" "to'ai" "ve" "vo'ai" "xe" "xo'ai" ∈ SE
  "sei" "ti'o" "xoi" ∈ SEI
  "se'u" ∈ SEhU
  (* #212: SEhEhI has no experimental construction. *)
  "se'e'i" "ve'e'i" ∈ SEhEhI
  (* #212: ze'ei has class SI, but its word-joining semantics need separate support. *)
  "si" "si'au'i" "ze'ei" ∈ SI
  "fi'oi" "soi" ∈ SOI
  "su" ∈ SU
  "di'i" "na'o" "ru'i" "ta'e" ∈ TAhE
  "tei" ∈ TEI
  "te'u" ∈ TEhU
  "to" "to'i" ∈ TO
  "toi" ∈ TOI
  (* #212: TOIhE has no experimental construction. *)
  "koi'e" "toi'e" ∈ TOIhE
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
  "va" "vi" "vu" ∈ VA
  "vau" ∈ VAU
  "vei" ∈ VEI
  "ve'a" "ve'e" "ve'i" "ve'u" ∈ VEhA
  "ve'o" ∈ VEhO
  "vi'a" "vi'e" "vi'i" "vi'u" ∈ VIhA
  "vu'o" ∈ VUhO
  (* #212: VUhOI has no experimental construction. *)
  "vu'oi" ∈ VUhOI
  "cu'a" "de'o" "fa'i" "fe'a" "fe'i" "fu'u" "ge'a" "gei" "joi'i" "ju'u" "ne'o" "pa'i" "pi'a" ∈ VUhU
  "pi'i" "re'a" "ri'o" "sa'i" "sa'o" "si'i" "su'i" "te'a" "va'a" "vu'u" ∈ VUhU
  "je'e'e" "nei'au" "xo'ei" ∈ VUhU
  "te'ai" "xi" "xi'e" ∈ XI
  (* #212: XOhI has no experimental construction. *)
  "xo'i" ∈ XOhI
  "ba'o" "ca'o" "co'a" "co'a'a" "co'au'a" "co'i" "co'u" "co'u'a" "de'a" "di'a" "mo'u" "pu'o" ∈ ZAhO
  "sau'a" "xa'o" "xo'u" "za'o" ∈ ZAhO
  "ca'o'a" ∈ ZAhO
  "zei" ∈ ZEI
  "ze'a" "ze'e" "ze'i" "ze'u" ∈ ZEhA
  "za" "zi" "zu" ∈ ZI
  "zi'e" ∈ ZIhE
  "doi'u" "ma'oi" "zo" ∈ ZO
  "la'o" "zoi" ∈ ZOI
  (* #212: ZOhAU has no experimental construction. *)
  "zo'au" ∈ ZOhAU
  "ci'e'u" "la'oi" "ra'oi" "zo'oi" ∈ ZOhOI
  "ce'ai" "zo'u" ∈ ZOhU
```

```jbogenbau
%implies UI ∪ CAI ∪ DAhO ∪ FUhE ∪ FUhO ⟹ Indicator
```

## Differences from CLL and camxes-exp

### Dictionary additions

All 255 experimental cmavo with a qualifying English definition appear here. The dictionary gives `io'e` no selma'o. Its English definition 71929 scores three and calls it an attitudinal. The maintainers therefore assign it UI from that definition.

The September 13, 2026 dictionary export supplies the additional entries under the three-vote policy. Its English definitions determine the classes, rather than the combined classes in `word.toml`. None of the highest-voted definitions ties or lists several classes. The following table records every disagreement between English definitions. Definition numbers identify the English files in the dictionary snapshot.

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
| `xoi` | 56726 | 5 | SEI | 73767: XOI, 1 / 15601: FIhO, 0 / 36692: UI, ROI or NA, 0 |
| `zai'e` | 66440 | 3 | BAhE | 66411: XOhEhOhE, -1 |
| `zo'au` | 67203 | 6 | ZOhAU | 36725: LA, 1 |

Six camxes-exp entries take dictionary classes here. They are `li'oi` in UI, `o'ai` in COI, `su'ai` and `xe'e` in PA, `xei'e` in FAhA, and `xoi` in SEI. Their highest-voted definitions override SU, UI, SE, UI, KOhA and SOI, respectively. All other camxes-exp entries retain their classes.

The threshold does not remove existing camxes-exp words. Thirteen of those words have fewer than three votes in this snapshot. They are `ai'i`, `cei'a`, `co'au'a`, `co'u'a`, `de'i'a`, `de'i'i`, `de'i'o`, `de'i'u`, `fi'oi`, `ku'au`, `ku'oi`, `sau'a` and `su'ei`.

### Classes without constructions

Classification does not add a construction to the grammar. Comments beside each unsupported class name [issue #212](https://github.com/int19h/gencmu/issues/212). Those words retain their dictionary class even where the syntax rejects them.

The unsupported classes are BAhEI, BEIhE, CAhEI, CIhAU, COhAI, COhEhOhE, CUhAU, FAhOhO, GIhEI, GOhOI, IhAU, JAIhA and JAIhI. They also include JIhOI, KAUhU, KUhEI, LA, LIhEI, MUhOI, NOIhA, SEhEhI, TOIhE, VUhOI, XOhI and ZOhAU. Experimental syntax replaces CLL's LA constructions with LE, so the dictionary's `la'ei` has no construction here.

The dictionary gives `ze'ei` class SI. The word stage therefore applies SI erasure to it. Its proposed word-joining behavior waits for #212.

### Other baseline differences

`ro'oi` belongs to PA here, beside `su'oi`. camxes-exp includes only `su'oi`, while camxes-beta includes both. The dialect accepts `ro'oi broda` as a quantified description.

The lexicon omits camxes-exp's Y because the forms stage reads a run of `y` as hesitation instead of a cmavo.

camxes-exp gives each word one selma'o. It reassigns the CLL words `la`, `lai` and `la'i` to LE because it reads names as selbri. This classifier retains those classes.
