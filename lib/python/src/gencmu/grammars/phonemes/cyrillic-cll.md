# The Cyrillic orthography of CLL

This document adds the Cyrillic orthography of CLL 3.12 to the phoneme stage. The [CLL](../dialects/cll-ebnf.md) dialect reads it as its Cyrillic. The dialects of the [approved word forms](../dialects/bpfk.md), [experimental](../dialects/experimental.md) and [Zantufa](../dialects/zantufa.md) read gencmu's own Cyrillic, [cyrillic.md](cyrillic.md), unless a caller turns on the feature `cll-cyrillic`. The two read the same letters differently, so a dialect or a caller chooses one of them. This document's letters stand only while `cll-cyrillic` is on. The document defines no frame of its own. It adds its letters to the rules of [latin-strict.md](latin-strict.md), so a text may mix scripts. The notation is explained in [the notation document](../../docs/notation.md).

CLL 3.12 lists the letters `а`, `б`, `в`, `г`, `д`, `е`, `ж`, `з`, `и`, `к`, `л`, `м`, `н`, `о`, `п`, `р`, `с`, `т`, `у`, `ф`, `х` and `ш`. It says that the orthography uses them "in the obvious ways", and `ъ`, the Bulgarian hard sign, for `y`. So `ж` is `j`, `х` is `x` and `ш` is `c`. The apostrophe, the comma and the period are those of the Latin orthography. A diphthong is written as a vowel pair, as in the Latin orthography, so `маи` is `mai`. CLL 3.12 says nothing of capitals. This document reads them as the Latin orthography does: a capital vowel is stressed, and a capital consonant is the consonant. The all-capital runs of [latin.md](latin.md) do not apply to these letters, so in every dialect a capital vowel here marks stress.

```jbogenbau
%extend-rule consonant
  @cll-cyrillic? cll-cyrillic-consonant

%extend-rule plain-vowel
  @cll-cyrillic? cll-cyrillic-plain-vowel

%extend-rule stressed-vowel
  @cll-cyrillic? cll-cyrillic-stressed-vowel

%rule cll-cyrillic-consonant
  | "б" </b/> | "Б" </b/>
  | "в" </v/> | "В" </v/>
  | "г" </g/> | "Г" </g/>
  | "д" </d/> | "Д" </d/>
  | "ж" </j/> | "Ж" </j/>
  | "з" </z/> | "З" </z/>
  | "к" </k/> | "К" </k/>
  | "л" </l/> | "Л" </l/>
  | "м" </m/> | "М" </m/>
  | "н" </n/> | "Н" </n/>
  | "п" </p/> | "П" </p/>
  | "р" </r/> | "Р" </r/>
  | "с" </s/> | "С" </s/>
  | "т" </t/> | "Т" </t/>
  | "ф" </f/> | "Ф" </f/>
  | "х" </x/> | "Х" </x/>
  | "ш" </c/> | "Ш" </c/>
%emits
  $

%rule cll-cyrillic-plain-vowel
  "а" </a/> | "е" </e/> | "и" </i/> | "о" </o/> | "у" </u/> | "ъ" </y/>
%emits
  $

%rule cll-cyrillic-stressed-vowel
  "А" </A/> | "Е" </E/> | "И" </I/> | "О" </O/> | "У" </U/> | "Ъ" </Y/>
%emits
  $
```
