# Cyrillic orthography

This document adds gencmu's Cyrillic orthography to the phoneme stage. It is the default Cyrillic of the dialects of the [approved word forms](../dialects/bpfk.md), [experimental](../dialects/experimental.md) and [Zantufa](../dialects/zantufa.md). It defines no frame of its own. It adds its letters to the rules of [latin-strict.md](latin-strict.md) and [latin.md](latin.md), so a text may mix scripts. A dialect that does not list this document reads a Cyrillic letter as foreign. The notation is explained in [the notation document](../../docs/notation.md).

The consonants are those of CLL 3.12: `ш` for `c`, `ж` for `j`, `х` for `x`, and the others in the obvious ways. `ъ`, the Bulgarian hard sign, is `y`. This document also reads letters that other Cyrillic alphabets use for the same or nearly the same sounds. CLL 3.12 does not name them, but a writer at home in one of those alphabets reaches for them:

- `э` and `є` for `e`
- `і` for `i`
- `ы` and `ә` for `y`
- `щ` for `c`
- `ґ` for `g`
- `ј` for `й`
- `һ` as an explicit apostrophe
- the palochka `ӏ` as a period

```jbogenbau
%rule cyrillic-consonant
  | "б" </b/> | "Б" </b/>
  | "ш" </c/> | "Ш" </c/> | "щ" </c/> | "Щ" </c/>
  | "д" </d/> | "Д" </d/>
  | "ф" </f/> | "Ф" </f/>
  | "г" </g/> | "Г" </g/> | "ґ" </g/> | "Ґ" </g/>
  | "ж" </j/> | "Ж" </j/>
  | "к" </k/> | "К" </k/>
  | "л" </l/> | "Л" </l/>
  | "м" </m/> | "М" </m/>
  | "н" </n/> | "Н" </n/>
  | "п" </p/> | "П" </p/>
  | "р" </r/> | "Р" </r/>
  | "с" </s/> | "С" </s/>
  | "т" </t/> | "Т" </t/>
  | "в" </v/> | "В" </v/>
  | "х" </x/> | "Х" </x/>
  | "з" </z/> | "З" </z/>
%emits
  $

%rule cyrillic-apostrophe
  "һ" | "Һ"
%emits
  $ </'/>

%rule cyrillic-period
  "ӏ" | "Ӏ"
```

The orthography has no apostrophe between vowels. Two adjacent vowel letters are two syllables, so `аи` is `a'i`. A diphthong is written with the short forms `й` and `ў`, so `ай` is `ai`. This is where the orthography differs from CLL 3.12, which writes a diphthong as a vowel pair, as the Latin orthography does.

So a full vowel letter carries the tag `syllabic`, which the frame's vowel-group rules read. Two adjacent syllabic vowels get an apostrophe between them. `й` and `ў`, the glides, carry no such tag, and they join the vowel beside them into a diphthong. A capital vowel or a combining acute after a vowel marks stress, as in Latin. Inside an all-capital run a capital vowel is folded.

```jbogenbau
%rule cyrillic-plain-vowel
  | "а" </a/ ∪ "syllabic">
  | "е" </e/ ∪ "syllabic"> | "э" </e/ ∪ "syllabic"> | "є" </e/ ∪ "syllabic">
  | "и" </i/ ∪ "syllabic"> | "і" </i/ ∪ "syllabic">
  | "о" </o/ ∪ "syllabic">
  | "у" </u/ ∪ "syllabic">
  | "ъ" </y/ ∪ "syllabic"> | "ы" </y/ ∪ "syllabic"> | "ә" </y/ ∪ "syllabic">
  | "й" </i/> | "Й" </i/> | "ј" </i/> | "Ј" </i/>
  | "ў" </u/> | "Ў" </u/>
%emits
  $

%rule cyrillic-stressed-vowel
  | "А" </A/ ∪ "syllabic"> | "а" stress-mark </A/ ∪ "syllabic">
  | "Е" </E/ ∪ "syllabic"> | "Э" </E/ ∪ "syllabic"> | "Є" </E/ ∪ "syllabic">
| "е" stress-mark </E/ ∪ "syllabic">
  | "И" </I/ ∪ "syllabic"> | "І" </I/ ∪ "syllabic"> | "и" stress-mark </I/ ∪ "syllabic">
  | "О" </O/ ∪ "syllabic"> | "о" stress-mark </O/ ∪ "syllabic">
  | "У" </U/ ∪ "syllabic"> | "у" stress-mark </U/ ∪ "syllabic">
  | "Ъ" </Y/ ∪ "syllabic"> | "Ы" </Y/ ∪ "syllabic"> | "Ә" </Y/ ∪ "syllabic">
| "ъ" stress-mark </Y/ ∪ "syllabic">
%emits
  $

%rule cyrillic-folded-vowel
  | "А" </a/ ∪ "syllabic">
  | "Е" </e/ ∪ "syllabic"> | "Э" </e/ ∪ "syllabic"> | "Є" </e/ ∪ "syllabic">
  | "И" </i/ ∪ "syllabic"> | "І" </i/ ∪ "syllabic">
  | "О" </o/ ∪ "syllabic">
  | "У" </u/ ∪ "syllabic">
  | "Ъ" </y/ ∪ "syllabic"> | "Ы" </y/ ∪ "syllabic"> | "Ә" </y/ ∪ "syllabic">
%emits
  $
```

The script is gencmu's own reading of Cyrillic. [cyrillic-cll.md](cyrillic-cll.md) reads CLL's, which writes a diphthong as a vowel pair. The two read the same letters differently, so a dialect or a caller chooses one with the feature `cll-cyrillic`. This document's letters stand while it is off.

```jbogenbau
%extend-rule consonant
  @¬cll-cyrillic? cyrillic-consonant

%extend-rule apostrophe
  @¬cll-cyrillic? cyrillic-apostrophe

%extend-rule core-char
  @¬cll-cyrillic? cyrillic-period

%extend-rule plain-vowel
  @¬cll-cyrillic? cyrillic-plain-vowel

%extend-rule stressed-vowel
  @¬cll-cyrillic? cyrillic-stressed-vowel

%extend-rule folded-vowel
  @¬cll-cyrillic? cyrillic-folded-vowel
```
