# zbalermorna

This document adds the zbalermorna script to the phoneme stage of the dialects of the [approved word forms](../dialects/bpfk.md), [experimental](../dialects/experimental.md) and [Zantufa](../dialects/zantufa.md). Lojbanists made the script after CLL. CLL 3.12 describes an orthography in Tolkien's Tengwar, which is a different script, so the [CLL](../dialects/cll-ebnf.md) dialect does not read this one. The script is read as the code points of the private-use block its fonts assign it. The document adds alternatives to the rules of [latin-strict.md](latin-strict.md) and [latin.md](latin.md) with `%extend-rule` and defines no frame of its own. The notation is explained in [the notation document](../../docs/notation.md).

Each zbalermorna symbol is a radical, a consonant, with a diacritic above it for the vowel that follows; a vowel with no consonant before it stands on the radical for the period, which the script uses as a null onset, and a word-initial vowel is written on it likewise. The script has a full-vowel form used in names and borrowings, four diphthong diacritics, a stress mark placed after the vowel, an "attitudinal shorthand" that stands for a vowel and the apostrophe after it, and glide radicals for `i` and `u` before a vowel. The code points are those of the font's private-use block; each is written here as an escape so that the rule can be read without the font.

```jbogenbau
%extend-rule consonant
  | "\u{ED80}" </p/>
  | "\u{ED81}" </t/>
  | "\u{ED82}" </k/>
  | "\u{ED83}" </f/>
  | "\u{ED90}" </b/>
  | "\u{ED91}" </d/>
  | "\u{ED92}" </g/>
  | "\u{ED93}" </v/>
  | "\u{ED84}" </l/>
  | "\u{ED85}" </s/>
  | "\u{ED86}" </c/>
  | "\u{ED87}" </m/>
  | "\u{ED94}" </r/>
  | "\u{ED95}" </z/>
  | "\u{ED96}" </j/>
  | "\u{ED97}" </n/>
  | "\u{ED88}" </x/>
%emits
  $

%extend-rule apostrophe
  "\u{ED8A}"
%emits
  $ </'/>

%extend-rule core-char
  "\u{ED89}"

%extend-rule comma
  "\u{ED9A}" | "\u{ED8C}" | "\u{ED99}" | "\u{ED9B}"
```

A vowel diacritic and its full-vowel form are the same phoneme; the stress mark U+ED98 after either, or after a diphthong diacritic, makes it stressed, and a repeated mark is one mark. The glide radicals U+EDAA and U+EDAB are `i` and `u` before a vowel. A diphthong diacritic is two phonemes and stands where a vowel stands; the shorthand U+ED8B followed by a vowel is that vowel and an apostrophe, which the rule emits as a token with no span of its own, and it stands where a non-vowel stands, since the apostrophe closes the vowel group.

```jbogenbau
%extend-rule plain-vowel
  | "\u{EDA0}" </a/> | "\u{EDB0}" </a/>
  | "\u{EDA1}" </e/> | "\u{EDB1}" </e/>
  | "\u{EDA2}" </i/> | "\u{EDB2}" </i/> | "\u{EDAA}" </i/>
  | "\u{EDA3}" </o/> | "\u{EDB3}" </o/>
  | "\u{EDA4}" </u/> | "\u{EDB4}" </u/> | "\u{EDAB}" </u/>
  | "\u{EDA5}" </y/> | "\u{EDB5}" </y/>
%emits
  $

%extend-rule stressed-vowel
  | "\u{EDA0}" zbalermorna-stress </A/> | "\u{EDB0}" zbalermorna-stress </A/>
  | "\u{EDA1}" zbalermorna-stress </E/> | "\u{EDB1}" zbalermorna-stress </E/>
  | "\u{EDA2}" zbalermorna-stress </I/> | "\u{EDB2}" zbalermorna-stress </I/>
  | "\u{EDA3}" zbalermorna-stress </O/> | "\u{EDB3}" zbalermorna-stress </O/>
  | "\u{EDA4}" zbalermorna-stress </U/> | "\u{EDB4}" zbalermorna-stress </U/>
  | "\u{EDA5}" zbalermorna-stress </Y/> | "\u{EDB5}" zbalermorna-stress </Y/>
%emits
  $

%rule zbalermorna-stress
  "\u{ED98}" | zbalermorna-stress "\u{ED98}"

%extend-rule vowel
  zbalermorna-diphthong | zbalermorna-stressed-diphthong

%extend-rule non-vowel
  zbalermorna-shorthand

%extend-rule any-lojban-char
  zbalermorna-diphthong | zbalermorna-shorthand-mark | zbalermorna-stress

%rule zbalermorna-diphthong
  zbalermorna-ai | zbalermorna-ei | zbalermorna-oi | zbalermorna-au

%rule zbalermorna-ai
  "\u{EDA6}"
%emits
  $ </a/>, $ </i/>

%rule zbalermorna-ei
  "\u{EDA7}"
%emits
  $ </e/>, $ </i/>

%rule zbalermorna-oi
  "\u{EDA8}"
%emits
  $ </o/>, $ </i/>

%rule zbalermorna-au
  "\u{EDA9}"
%emits
  $ </a/>, $ </u/>

%rule zbalermorna-stressed-diphthong
  | zbalermorna-stressed-ai
  | zbalermorna-stressed-ei
  | zbalermorna-stressed-oi
  | zbalermorna-stressed-au

%rule zbalermorna-stressed-ai
  "\u{EDA6}" zbalermorna-stress
%emits
  $ </A/>, $ </i/>

%rule zbalermorna-stressed-ei
  "\u{EDA7}" zbalermorna-stress
%emits
  $ </E/>, $ </i/>

%rule zbalermorna-stressed-oi
  "\u{EDA8}" zbalermorna-stress
%emits
  $ </O/>, $ </i/>

%rule zbalermorna-stressed-au
  "\u{EDA9}" zbalermorna-stress
%emits
  $ </A/>, $ </u/>

%rule zbalermorna-shorthand
  zbalermorna-shorthand-mark $v(plain-vowel)
%emits
  $v, /'/

%rule zbalermorna-shorthand-mark
  "\u{ED8B}"
```
