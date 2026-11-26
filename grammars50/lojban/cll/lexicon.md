# The CLL lexicon

This document supplies the forms-stage lexicon for the [CLL](pipeline.md) pipeline. The [BPFK pipeline](../bpfk/pipeline.md) reads the same words from this document. BPFK is the Lojban language planning committee.

A lexicon is a list of words, each with its classes. The forms stage follows the phoneme stage. It divides the phonemes of the text into words. A cmavo is a particle, a short structure word. A selma'o is a word class of cmavo.

A token is one unit that a stage reads or emits. A token's value is the string that exact comparisons read. Its image is the string that people see.

This lexicon holds the cmavo of *The Complete Lojban Language* (CLL) with their selma'o. Each entry uses the class from the CLL dictionary. This document collapses the numbered subclasses of the dictionary (`UI3a`, `KOhA7`) to the selma'o that the syntax grammar names. Its maintainers edit it by hand in this repository.

The lexicon below is a classifier, a constant bag whose keys are classes. Each class lists its words, as `KOhA: ["ce'u", "da", …]` does. The forms stage looks a cmavo up with `$LEXICON.classify($c'value)`, and tags the cmavo with its classes. A tag is a capitalized key of a token's bag. The lexicon writes each word's phoneme value, in lowercase, with `'` for the apostrophe. A stressed vowel has the plain vowel as its value, so it finds the same entry.

If a word has several classes, it carries them all, and the syntax stage reads it under each class. No word of the CLL dictionary has more than one. The entries stand in the order of their classes. The syntax grammar's `indicator` and `indicators` rules read the words of UI, CAI, DAhO, FUhO and FUhE. The last entry, `Indicator`, names these five classes. So a lookup that finds one of them also gives `Indicator`. A class that names other classes has no word of its own. The [indicator grammar](indicators.md) defines CLL's non-formal `word` rule and uses this mark to attach indicators to the preceding word.

The forms stage reads a run of `y` as hesitation and never looks it up in this classifier.

The forms stage publishes every class of the lexicon, and so `Indicator` too. A token gets a class only from the lookup. A caller that gives a token `UI` directly also gives it `Indicator`, where the indicator stage must attach it.

[The notation document](../../../docs/notation.md) explains the notation.

```jbogenbau
%const $LEXICON {
  A: ["a", "e", "ji", "o", "u"],
  BAI: [
    "ba'i", "bai", "bau", "be'i", "ca'i", "cau", "ci'e", "ci'o", "ci'u", "cu'u", "de'i", "di'o",
    "do'e", "du'i", "du'o", "fa'e", "fau", "fi'e", "ga'a", "gau", "ja'e", "ja'i", "ji'e", "ji'o",
    "ji'u", "ka'a", "ka'i", "kai", "ki'i", "ki'u", "koi", "ku'u", "la'u", "le'a", "li'e", "ma'e",
    "ma'i", "mau", "me'a", "me'e", "mu'i", "mu'u", "ni'i", "pa'a", "pa'u", "pi'o", "po'i", "pu'a",
    "pu'e", "ra'a", "ra'i", "rai", "ri'a", "ri'i", "sau", "si'u", "ta'i", "tai", "ti'i", "ti'u",
    "tu'i", "va'o", "va'u", "zau", "zu'e"
  ],
  BAhE: ["ba'e", "za'e"],
  BE: "be",
  BEI: "bei",
  BEhO: "be'o",
  BIhE: "bi'e",
  BIhI: ["bi'i", "bi'o", "mi'i"],
  BO: "bo",
  BOI: "boi",
  BU: "bu",
  BY: [
    "by", "cy", "dy", "fy", "ga'e", "ge'o", "gy", "je'o", "jo'o", "jy", "ky", "lo'a", "ly", "my",
    "na'a", "ny", "py", "ru'o", "ry", "se'e", "sy", "to'a", "ty", "vy", "xy", "y'y", "zy"
  ],
  CAI: ["cai", "cu'i", "pei", "ru'e", "sai"],
  CAhA: ["ca'a", "ka'e", "nu'o", "pu'i"],
  CEI: "cei",
  CEhE: "ce'e",
  CO: "co",
  COI: [
    "be'e", "co'o", "coi", "fe'o", "fi'i", "je'e", "ju'i", "ke'o", "ki'e", "mi'e", "mu'o", "nu'e",
    "pe'u", "re'i", "ta'a", "vi'o"
  ],
  CU: "cu",
  CUhE: ["cu'e", "nau"],
  DAhO: "da'o",
  DOI: "doi",
  DOhU: "do'u",
  FA: ["fa", "fai", "fe", "fi", "fi'a", "fo", "fu"],
  FAhA: [
    "be'a", "bu'u", "ca'u", "du'a", "fa'a", "ga'u", "ne'a", "ne'i", "ne'u", "ni'a", "pa'o", "re'o",
    "ri'u", "ru'u", "te'e", "ti'a", "to'o", "vu'a", "ze'o", "zo'a", "zo'i", "zu'a"
  ],
  FAhO: "fa'o",
  FEhE: "fe'e",
  FEhU: "fe'u",
  FIhO: "fi'o",
  FOI: "foi",
  FUhA: "fu'a",
  FUhE: "fu'e",
  FUhO: "fu'o",
  GA: ["ga", "ge", "ge'i", "go", "gu"],
  GAhO: ["ga'o", "ke'i"],
  GEhU: "ge'u",
  GI: "gi",
  GIhA: ["gi'a", "gi'e", "gi'i", "gi'o", "gi'u"],
  GOI: ["goi", "ne", "no'u", "pe", "po", "po'e", "po'u"],
  GOhA: [
    "bu'a", "bu'e", "bu'i", "co'e", "du", "go'a", "go'e", "go'i", "go'o", "go'u", "mo", "nei",
    "no'a"
  ],
  GUhA: ["gu'a", "gu'e", "gu'i", "gu'o", "gu'u"],
  I: "i",
  JA: ["ja", "je", "je'i", "jo", "ju"],
  JAI: "jai",
  JOI: ["ce", "ce'o", "fa'u", "jo'e", "jo'u", "joi", "ju'e", "ku'a", "pi'u"],
  JOhI: "jo'i",
  KE: "ke",
  KEI: "kei",
  KEhE: "ke'e",
  KI: "ki",
  KOhA: [
    "ce'u", "da", "da'e", "da'u", "de", "de'e", "de'u", "dei", "di", "di'e", "di'u", "do", "do'i",
    "do'o", "fo'a", "fo'e", "fo'i", "fo'o", "fo'u", "ke'a", "ko", "ko'a", "ko'e", "ko'i", "ko'o",
    "ko'u", "ma", "ma'a", "mi", "mi'a", "mi'o", "ra", "ri", "ru", "ta", "ti", "tu", "vo'a", "vo'e",
    "vo'i", "vo'o", "vo'u", "zi'o", "zo'e", "zu'i"
  ],
  KU: "ku",
  KUhE: "ku'e",
  KUhO: "ku'o",
  LA: ["la", "la'i", "lai"],
  LAU: ["ce'a", "lau", "tau", "zai"],
  LAhE: ["la'e", "lu'a", "lu'e", "lu'i", "lu'o", "tu'a", "vu'i"],
  LE: ["le", "le'e", "le'i", "lei", "lo", "lo'e", "lo'i", "loi"],
  LEhU: "le'u",
  LI: ["li", "me'o"],
  LIhU: "li'u",
  LOhO: "lo'o",
  LOhU: "lo'u",
  LU: "lu",
  LUhU: "lu'u",
  MAI: ["mai", "mo'o"],
  MAhO: "ma'o",
  ME: "me",
  MEhU: "me'u",
  MOI: ["cu'o", "mei", "moi", "si'e", "va'e"],
  MOhE: "mo'e",
  MOhI: "mo'i",
  NA: ["ja'a", "na"],
  NAI: "nai",
  NAhE: ["je'a", "na'e", "no'e", "to'e"],
  NAhU: "na'u",
  NIhE: "ni'e",
  NIhO: ["ni'o", "no'i"],
  NOI: ["noi", "poi", "voi"],
  NU: ["du'u", "jei", "ka", "li'i", "mu'e", "ni", "nu", "pu'u", "si'o", "su'u", "za'i", "zu'o"],
  NUhA: "nu'a",
  NUhI: "nu'i",
  NUhU: "nu'u",
  PA: [
    "bi", "ce'i", "ci", "ci'i", "da'a", "dau", "du'e", "fei", "fi'u", "gai", "jau", "ji'i", "ka'o",
    "ki'o", "ma'u", "me'i", "mo'a", "mu", "ni'u", "no", "no'o", "pa", "pai", "pi", "pi'e", "ra'e",
    "rau", "re", "rei", "ro", "so", "so'a", "so'e", "so'i", "so'o", "so'u", "su'e", "su'o", "te'o",
    "tu'o", "vai", "vo", "xa", "xo", "za'u", "ze"
  ],
  PEhE: "pe'e",
  PEhO: "pe'o",
  PU: ["ba", "ca", "pu"],
  RAhO: "ra'o",
  ROI: ["re'u", "roi"],
  SA: "sa",
  SE: ["se", "te", "ve", "xe"],
  SEI: ["sei", "ti'o"],
  SEhU: "se'u",
  SI: "si",
  SOI: "soi",
  SU: "su",
  TAhE: ["di'i", "na'o", "ru'i", "ta'e"],
  TEI: "tei",
  TEhU: "te'u",
  TO: ["to", "to'i"],
  TOI: "toi",
  TUhE: "tu'e",
  TUhU: "tu'u",
  UI: [
    "a'a", "a'e", "a'i", "a'o", "a'u", "ai", "au", "ba'a", "ba'u", "be'u", "bi'u", "bu'o", "ca'e",
    "da'i", "dai", "do'a", "e'a", "e'e", "e'i", "e'o", "e'u", "ei", "fu'i", "ga'i", "ge'e", "i'a",
    "i'e", "i'i", "i'o", "i'u", "ia", "ie", "ii", "io", "iu", "ja'o", "je'u", "ji'a", "jo'a",
    "ju'a", "ju'o", "ka'u", "kau", "ke'u", "ki'a", "ku'i", "la'a", "le'o", "li'a", "li'o", "mi'u",
    "mu'a", "na'i", "o'a", "o'e", "o'i", "o'o", "o'u", "oi", "pa'e", "pau", "pe'a", "pe'i", "po'o",
    "ra'u", "re'e", "ri'e", "ro'a", "ro'e", "ro'i", "ro'o", "ro'u", "ru'a", "sa'a", "sa'e", "sa'u",
    "se'a", "se'i", "se'o", "si'a", "su'a", "ta'o", "ta'u", "ti'e", "to'u", "u'a", "u'e", "u'i",
    "u'o", "u'u", "ua", "ue", "ui", "uo", "uu", "va'i", "vu'e", "xu", "za'a", "zo'o", "zu'u"
  ],
  VA: ["va", "vi", "vu"],
  VAU: "vau",
  VEI: "vei",
  VEhA: ["ve'a", "ve'e", "ve'i", "ve'u"],
  VEhO: "ve'o",
  VIhA: ["vi'a", "vi'e", "vi'i", "vi'u"],
  VUhO: "vu'o",
  VUhU: [
    "cu'a", "de'o", "fa'i", "fe'a", "fe'i", "fu'u", "ge'a", "gei", "ju'u", "ne'o", "pa'i", "pi'a",
    "pi'i", "re'a", "ri'o", "sa'i", "sa'o", "si'i", "su'i", "te'a", "va'a", "vu'u"
  ],
  XI: "xi",
  ZAhO: ["ba'o", "ca'o", "co'a", "co'i", "co'u", "de'a", "di'a", "mo'u", "pu'o", "za'o"],
  ZEI: "zei",
  ZEhA: ["ze'a", "ze'e", "ze'i", "ze'u"],
  ZI: ["za", "zi", "zu"],
  ZIhE: "zi'e",
  ZO: "zo",
  ZOI: ["la'o", "zoi"],
  ZOhU: "zo'u",
  Indicator: {UI, CAI, DAhO, FUhE, FUhO}
}
```

## Differences from the CLL dictionary

The classifier omits the CLL dictionary's `y` entry in Y. The forms stage recognizes hesitation directly, so a run of `y` stays hesitation without a dictionary lookup.

## Differences from the format 49 grammar

The format 49 copy of this document is `grammars/lojban/cll/lexicon.md`. It lists the same 597 words in the same 121 classes.

The format 49 copy adds `Indicator` to each token that the stage emits with an indicator class. Here the lookup adds it. On the text input of `lojban/cll`, every such token comes from the lookup, so the tokens are the same. A token that the phoneme stage or a caller gives an indicator class directly gets no `Indicator` here.
