## Lojban phonemes from Cyrillic text

This document adds the Cyrillic orthography of CLL 3.12 to the phoneme stage. It defines no frame of its own: it adds alternatives to the rules of `latin.md`, so that a text may mix scripts and a pipeline that does not list this document reads a Cyrillic letter as foreign. The notation is explained in `notation.md`.

CLL 3.12 gives the mapping: the consonants as in the table there, `ш` for `c`, `ж` for `j`, `х` for `x`, and `ъ`, the Bulgarian hard sign, for `y`. jbotci's aliases are accepted as well: `э` and `є` for `e`, `і` for `i`, `ы` and `ә` for `y`, `щ` for `c`, `ґ` for `g`, `ј` for `й`, `һ` as an explicit apostrophe and the palochka `ӏ` as a period.

```ebnf
consonant
|≔ "б" </b/>| "Б" </b/>| "ш" </c/>| "Ш" </c/>| "щ" </c/>| "Щ" </c/>| "д" </d/>| "Д" </d/>| "ф" </f/>| "Ф" </f/>| "г" </g/>| "Г" </g/>| "ґ" </g/>| "Ґ" </g/>| "ж" </j/>| "Ж" </j/>| "к" </k/>| "К" </k/>| "л" </l/>| "Л" </l/>| "м" </m/>| "М" </m/>| "н" </n/>| "Н" </n/>| "п" </p/>| "П" </p/>| "р" </r/>| "Р" </r/>| "с" </s/>| "С" </s/>| "т" </t/>| "Т" </t/>| "в" </v/>| "В" </v/>| "х" </x/>| "Х" </x/>| "з" </z/>| "З" </z/>
⇒ this ;

apostrophe
|≔ "һ" | "Һ"
⇒ this </'/> ;
pause-char
|≔ "ӏ" | "Ӏ" ;
```

The orthography has no apostrophe between vowels: two adjacent vowel letters are two syllables, `аи` is `a'i`, and a diphthong is written with the short forms `й` and `ў`, so `ай` is `ai`. A full vowel letter therefore carries the tag `syllabic`, which the frame's vowel-group rules read: two adjacent syllabic vowels get an `h` between them, while `й` and `ў`, the glides, carry no such tag and join the vowel beside them into a diphthong. A capital vowel or a combining acute after a vowel marks stress, as in Latin, and inside an all-capital run a capital vowel is folded.

```ebnf
plain-vowel
|≔ "а" </a/ ∪ "syllabic">| "е" </e/ ∪ "syllabic">| "э" </e/ ∪ "syllabic">| "є" </e/ ∪ "syllabic">| "и" </i/ ∪ "syllabic">| "і" </i/ ∪ "syllabic">| "о" </o/ ∪ "syllabic">| "у" </u/ ∪ "syllabic">| "ъ" </y/ ∪ "syllabic">| "ы" </y/ ∪ "syllabic">| "ә" </y/ ∪ "syllabic">| "й" </i/>| "Й" </i/>| "ј" </i/>| "Ј" </i/>| "ў" </u/>| "Ў" </u/>
⇒ this ;

stressed-vowel
|≔ "А" </A/ ∪ "syllabic">| "Е" </E/ ∪ "syllabic">| "Э" </E/ ∪ "syllabic">| "Є" </E/ ∪ "syllabic">| "И" </I/ ∪ "syllabic">| "І" </I/ ∪ "syllabic">| "О" </O/ ∪ "syllabic">| "У" </U/ ∪ "syllabic">| "Ъ" </Y/ ∪ "syllabic">| "Ы" </Y/ ∪ "syllabic">| "Ә" </Y/ ∪ "syllabic">| "а" stress-mark </A/ ∪ "syllabic">| "е" stress-mark </E/ ∪ "syllabic">| "и" stress-mark </I/ ∪ "syllabic">| "о" stress-mark </O/ ∪ "syllabic">| "у" stress-mark </U/ ∪ "syllabic">| "ъ" stress-mark </Y/ ∪ "syllabic">
⇒ this ;

folded-vowel
|≔ "А" </a/ ∪ "syllabic">| "Е" </e/ ∪ "syllabic">| "Э" </e/ ∪ "syllabic">| "Є" </e/ ∪ "syllabic">| "И" </i/ ∪ "syllabic">| "І" </i/ ∪ "syllabic">| "О" </o/ ∪ "syllabic">| "У" </u/ ∪ "syllabic">| "Ъ" </y/ ∪ "syllabic">| "Ы" </y/ ∪ "syllabic">| "Ә" </y/ ∪ "syllabic">
⇒ this ;
```
