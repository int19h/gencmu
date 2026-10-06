# zbalermorna

This document adds the zbalermorna script to the phoneme stage of the dialects of the [BPFK](../dialects/bpfk.md), [experimental](../dialects/experimental.md) and [Zantufa](../dialects/zantufa.md). Lojbanists made the script after CLL (*The Complete Lojban Language*). CLL 1.1 section 3.12 describes an orthography in Tolkien's Tengwar, which is a different script, so the [CLL](../dialects/cll-ebnf.md) dialect does not read this one. The stage reads the script as the code points of the private-use block that its fonts assign it.

The phoneme stage is the first stage of the pipeline. The document adds alternatives to the rules of [latin-strict.md](latin-strict.md) and [latin.md](latin.md) with `%extend-rule`. It defines no frame of its own. It uses the shared text, pause and run rules. [The notation document](../../docs/notation.md) explains the notation.

A diacritic is a mark on another symbol. Each zbalermorna symbol is a radical, a consonant, with a diacritic above it for the vowel that follows. A vowel with no consonant before it stands on the radical for the period, which the script uses as a null onset. A null onset marks a syllable with no consonant before its vowel. The script writes a word-initial vowel on that radical too. The script also has these forms:

- A full-vowel form, used in names and borrowings
- Four diphthong diacritics
- A stress mark, placed after the vowel
- An "attitudinal shorthand" that stands for a vowel and the apostrophe after it
- Glide radicals for `i` and `u` before a vowel

The code points are those of the private-use block of the font. This document writes each code point as an escape, so that a reader can read the rule without the font.

The first rules below read the consonant radicals. U+ED89 is the radical for the period, and U+ED8A is the apostrophe. U+ED9A is the comma. U+ED8C, U+ED99 and U+ED9B are marks that jbotci, another Lojban parser, reads as nothing. This document reads them as a comma.

```jbogenbau
%extend-rule consonant
  | '\u{ED80}' </p/>
  | '\u{ED81}' </t/>
  | '\u{ED82}' </k/>
  | '\u{ED83}' </f/>
  | '\u{ED90}' </b/>
  | '\u{ED91}' </d/>
  | '\u{ED92}' </g/>
  | '\u{ED93}' </v/>
  | '\u{ED84}' </l/>
  | '\u{ED85}' </s/>
  | '\u{ED86}' </c/>
  | '\u{ED87}' </m/>
  | '\u{ED94}' </r/>
  | '\u{ED95}' </z/>
  | '\u{ED96}' </j/>
  | '\u{ED97}' </n/>
  | '\u{ED88}' </x/>
%emits
  $

%extend-rule apostrophe
  '\u{ED8A}'
%emits
  $ </'/>

%extend-rule core-char
  '\u{ED89}'

%extend-rule comma
  '\u{ED9A}' | '\u{ED8C}' | '\u{ED99}' | '\u{ED9B}'
```

A vowel diacritic and its full-vowel form are the same phoneme. The stress mark U+ED98 after either, or after a diphthong diacritic, makes it stressed, and a repeated mark is one mark. The glide radicals U+EDAA and U+EDAB are `i` and `u` before a vowel. A diphthong diacritic is two phonemes and stands where a vowel stands.

The shorthand U+ED8B followed by a vowel, plain or stressed, is that vowel and an apostrophe. A token is one unit that a stage reads or emits. The vowel's token covers the shorthand too, as a stressed vowel's token covers its stress mark. The rule emits the apostrophe as a token with an empty span. The shorthand stands where a non-vowel stands, because the apostrophe closes the vowel group. It does not stand before a diphthong.

A stress mark or a shorthand is a mark of the script, like an accent. So this document adds both to `mark-char` of [latin.md](latin.md), and no punctuation rule reads them as a pause. Neither is a Lojban character by itself. So `foreign-char` takes a stray mark, one that no letter takes, and the mark makes its run foreign.

```jbogenbau
%extend-rule plain-vowel
  | '\u{EDA0}' </a/> | '\u{EDB0}' </a/>
  | '\u{EDA1}' </e/> | '\u{EDB1}' </e/>
  | '\u{EDA2}' </i/> | '\u{EDB2}' </i/> | '\u{EDAA}' </i/>
  | '\u{EDA3}' </o/> | '\u{EDB3}' </o/>
  | '\u{EDA4}' </u/> | '\u{EDB4}' </u/> | '\u{EDAB}' </u/>
  | '\u{EDA5}' </y/> | '\u{EDB5}' </y/>
%emits
  $

%extend-rule stressed-vowel
  | '\u{EDA0}' zbalermorna-stress </A/> | '\u{EDB0}' zbalermorna-stress </A/>
  | '\u{EDA1}' zbalermorna-stress </E/> | '\u{EDB1}' zbalermorna-stress </E/>
  | '\u{EDA2}' zbalermorna-stress </I/> | '\u{EDB2}' zbalermorna-stress </I/>
  | '\u{EDA3}' zbalermorna-stress </O/> | '\u{EDB3}' zbalermorna-stress </O/>
  | '\u{EDA4}' zbalermorna-stress </U/> | '\u{EDB4}' zbalermorna-stress </U/>
  | '\u{EDA5}' zbalermorna-stress </Y/> | '\u{EDB5}' zbalermorna-stress </Y/>
%emits
  $

%rule zbalermorna-stress
  '\u{ED98}' | zbalermorna-stress '\u{ED98}'

%extend-rule vowel
  zbalermorna-diphthong | zbalermorna-stressed-diphthong

%extend-rule non-vowel
  zbalermorna-shorthand

%extend-rule any-lojban-char
  zbalermorna-diphthong

%extend-rule mark-char
  zbalermorna-shorthand-mark | zbalermorna-stress-mark

%rule zbalermorna-stress-mark
  '\u{ED98}'

%rule zbalermorna-diphthong
  zbalermorna-ai | zbalermorna-ei | zbalermorna-oi | zbalermorna-au

%rule zbalermorna-ai
  '\u{EDA6}'
%emits
  $ </a/>, $ </i/>

%rule zbalermorna-ei
  '\u{EDA7}'
%emits
  $ </e/>, $ </i/>

%rule zbalermorna-oi
  '\u{EDA8}'
%emits
  $ </o/>, $ </i/>

%rule zbalermorna-au
  '\u{EDA9}'
%emits
  $ </a/>, $ </u/>

%rule zbalermorna-stressed-diphthong
  | zbalermorna-stressed-ai | zbalermorna-stressed-ei
  | zbalermorna-stressed-oi | zbalermorna-stressed-au

%rule zbalermorna-stressed-ai
  '\u{EDA6}' zbalermorna-stress
%emits
  $ </A/>, $ </i/>

%rule zbalermorna-stressed-ei
  '\u{EDA7}' zbalermorna-stress
%emits
  $ </E/>, $ </i/>

%rule zbalermorna-stressed-oi
  '\u{EDA8}' zbalermorna-stress
%emits
  $ </O/>, $ </i/>

%rule zbalermorna-stressed-au
  '\u{EDA9}' zbalermorna-stress
%emits
  $ </A/>, $ </u/>

%rule zbalermorna-shorthand
  $v(zbalermorna-marked-vowel)
%emits
  $v, /'/

%rule zbalermorna-marked-vowel
  zbalermorna-shorthand-mark $v(zbalermorna-shorthand-vowel)
%tags
  tags($v)

%rule zbalermorna-shorthand-vowel
  plain-vowel | stressed-vowel

%rule zbalermorna-shorthand-mark
  '\u{ED8B}'
```
