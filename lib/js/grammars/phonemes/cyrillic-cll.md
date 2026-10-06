# The Cyrillic orthography of CLL

This document adds CLL 1.1 section 3.12's Cyrillic orthography to the phoneme stage, the first stage of the pipeline. CLL is *The Complete Lojban Language*. The [CLL](../dialects/cll-ebnf.md) dialect reads it as its Cyrillic. The dialects of the [BPFK](../dialects/bpfk.md), [experimental](../dialects/experimental.md) and [Zantufa](../dialects/zantufa.md) read gencmu's own Cyrillic, [cyrillic.md](cyrillic.md), unless a caller turns on the feature `cll-cyrillic`. A feature is a named switch that the grammars test.

The two read the same letters differently, so a dialect or a caller chooses one of them. The letters of this document apply only while `cll-cyrillic` is on. The document has no frame of its own, that is, no rules for the text, its pauses and its runs. It adds its letters to the rules of [latin-strict.md](latin-strict.md), so a text can mix scripts. [The notation document](../../docs/notation.md) explains the notation.

CLL 3.12 lists 22 letters. Five are the vowel letters `а`, `е`, `и`, `о` and `у`. The others are `б`, `в`, `г`, `д`, `ж`, `з`, `к`, `л`, `м`, `н`, `п`, `р`, `с`, `т`, `ф`, `х` and `ш`. CLL 3.12 says that the orthography uses these 22 letters "in the obvious ways", and `ъ`, the Bulgarian hard sign, for `y`. So `ж` is `j`, `х` is `x` and `ш` is `c`.

The apostrophe, the comma and the period are those of the Latin orthography. The orthography writes a diphthong as a vowel pair, as in the Latin orthography, so `маи` is `mai`. CLL 3.12 says nothing of capitals. This document reads them as the Latin orthography does: a capital vowel is stressed, and a capital consonant is the consonant. The all-capital runs of [latin.md](latin.md) do not apply to these letters, so in every dialect a capital vowel here marks stress.

```jbogenbau
%extend-rule consonant
  cll-cyrillic? cll-cyrillic-consonant

%extend-rule plain-vowel
  cll-cyrillic? cll-cyrillic-plain-vowel

%extend-rule stressed-vowel
  cll-cyrillic? cll-cyrillic-stressed-vowel

%rule cll-cyrillic-consonant
  | 'б' </b/> | 'Б' </b/>
  | 'в' </v/> | 'В' </v/>
  | 'г' </g/> | 'Г' </g/>
  | 'д' </d/> | 'Д' </d/>
  | 'ж' </j/> | 'Ж' </j/>
  | 'з' </z/> | 'З' </z/>
  | 'к' </k/> | 'К' </k/>
  | 'л' </l/> | 'Л' </l/>
  | 'м' </m/> | 'М' </m/>
  | 'н' </n/> | 'Н' </n/>
  | 'п' </p/> | 'П' </p/>
  | 'р' </r/> | 'Р' </r/>
  | 'с' </s/> | 'С' </s/>
  | 'т' </t/> | 'Т' </t/>
  | 'ф' </f/> | 'Ф' </f/>
  | 'х' </x/> | 'Х' </x/>
  | 'ш' </c/> | 'Ш' </c/>
%emits
  $

%rule cll-cyrillic-plain-vowel
  'а' </a/> | 'е' </e/> | 'и' </i/> | 'о' </o/> | 'у' </u/> | 'ъ' </y/>
%emits
  $

%rule cll-cyrillic-stressed-vowel
  'А' </A/> | 'Е' </E/> | 'И' </I/> | 'О' </O/> | 'У' </U/> | 'Ъ' </Y/>
%emits
  $
```
