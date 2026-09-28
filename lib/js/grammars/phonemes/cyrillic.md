# Cyrillic orthography

This document adds gencmu's Cyrillic orthography to the phoneme stage, the first grammar in the chain. It is the default Cyrillic of the dialects of the [approved word forms](../dialects/bpfk.md), [experimental](../dialects/experimental.md) and [Zantufa](../dialects/zantufa.md). It has no frame of its own. It uses the shared text, pause and run rules. It adds its letters to the rules of [latin-strict.md](latin-strict.md) and [latin.md](latin.md), so a text can mix scripts.

A dialect that does not list this document reads a Cyrillic letter as foreign. [The notation document](../../docs/notation.md) explains the notation.

The consonants are those of CLL 3.12: `ш` for `c`, `ж` for `j`, `х` for `x`, and the others in the obvious ways. `ъ`, the Bulgarian hard sign, is `y`. This document also reads letters that other Cyrillic alphabets use for the same or nearly the same sounds. CLL 3.12 does not name them, but a writer at home in one of those alphabets reaches for them:

- `э` and `є` for `e`
- `і` for `i`
- `ы` and `ә` for `y`
- `щ` for `c`
- `ґ` for `g`
- `ј` for the glide `i`, as `й`
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

The orthography has no apostrophe between vowels. Two adjacent vowel letters are two syllables, so `аи` is `a'i`. The orthography writes a diphthong with the short forms `й` and `ў`, so `ай` is `ai`. This is where the orthography differs from CLL 3.12, which writes a diphthong as a vowel pair, as the Latin orthography does.

So a full vowel letter carries the tag `syllabic`, which the vowel-group rules of [latin-strict.md](latin-strict.md) read. Two adjacent syllabic vowels get an apostrophe between them. `й` and `ў`, the glides, carry no such tag, and they join the vowel beside them into a diphthong. A capital vowel, or a combining accent after any vowel letter, marks stress, as in Latin. Inside an all-capital run, the stage folds a capital vowel or glide, that is, it reads the letter as plain.

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
  | "А" </A/ ∪ "syllabic"> | ("а" | "А") stress-mark </A/ ∪ "syllabic">
  | "Е" </E/ ∪ "syllabic"> | "Э" </E/ ∪ "syllabic"> | "Є" </E/ ∪ "syllabic">
  | ("е" | "э" | "є" | "Е" | "Э" | "Є") stress-mark </E/ ∪ "syllabic">
  | "И" </I/ ∪ "syllabic"> | "І" </I/ ∪ "syllabic"> | ("и" | "і" | "И" | "І") stress-mark </I/ ∪ "syllabic">
  | "О" </O/ ∪ "syllabic"> | ("о" | "О") stress-mark </O/ ∪ "syllabic">
  | "У" </U/ ∪ "syllabic"> | ("у" | "У") stress-mark </U/ ∪ "syllabic">
  | "Ъ" </Y/ ∪ "syllabic"> | "Ы" </Y/ ∪ "syllabic"> | "Ә" </Y/ ∪ "syllabic">
  | ("ъ" | "ы" | "ә" | "Ъ" | "Ы" | "Ә") stress-mark </Y/ ∪ "syllabic">
%emits
  $

%rule cyrillic-folded-vowel
  | "А" </a/ ∪ "syllabic">
  | "Е" </e/ ∪ "syllabic"> | "Э" </e/ ∪ "syllabic"> | "Є" </e/ ∪ "syllabic">
  | "И" </i/ ∪ "syllabic"> | "І" </i/ ∪ "syllabic">
  | "О" </o/ ∪ "syllabic">
  | "У" </u/ ∪ "syllabic">
  | "Ъ" </y/ ∪ "syllabic"> | "Ы" </y/ ∪ "syllabic"> | "Ә" </y/ ∪ "syllabic">
  | "Й" </i/> | "Ј" </i/>
  | "Ў" </u/>
%emits
  $
```

The script is gencmu's own reading of Cyrillic. [cyrillic-cll.md](cyrillic-cll.md) reads CLL's, which writes a diphthong as a vowel pair. The two read the same letters differently, so a dialect or a caller chooses one with the feature `cll-cyrillic`. A feature is a named switch that the grammars test. The letters of this document apply while `cll-cyrillic` is off.

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
