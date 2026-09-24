# Latin orthography

This document opens the phoneme stage, the first stage of every Lojban dialect: [CLL](../dialects/cll.md), [approved word forms](../dialects/bpfk.md), [experimental](../dialects/experimental.md) and [Zantufa](../dialects/zantufa.md). The stage reads the characters of a text and hands the word stage the phonemes they stand for. Its terminals are characters, each written in straight quotes, and the character classes `alpha`, `digit`, `space`, `mark` and `other` that every character token also carries; it emits one token per phoneme, carrying that phoneme's tag, so that the word grammar never sees a character and reads every script alike. This document contributes the standard Latin orthography of CLL chapter 3 and the frame of the stage, runs of letters between pauses; [cyrillic.md](cyrillic.md) and [zbalermorna.md](zbalermorna.md) add their letters to the same rules. The notation is explained in [the notation document](../../docs/notation.md).

The phonemes are the letters of CLL chapter 3, each written as a phoneme tag: the consonants `/b/`, `/c/`, `/d/` and so on through `/z/`, the vowels `/a/ /e/ /i/ /o/ /u/ /y/`, the apostrophe `/'/`, and the stressed vowels `/A/ /E/ /I/ /O/ /U/ /Y/`, a stressed vowel being a separate phoneme so that stress is a position in the word grammar rather than a mark it tests. Two tags stand for what is not a letter: `PAUSE` for a pause of any length, which also carries the phoneme tag `/./`, the pause, which sounds as a space, and `FOREIGN` for a character that is not Lojban at all, which the word grammar admits only inside a foreign quote.

## The text and its runs

The text is pauses and runs. A pause is any run of pause characters: the period, question mark, exclamation mark and whitespace that CLL 3.1 names, and any other character that is neither a letter of some script nor a digit, since such a character is not Lojban and separates words as firmly. A run is what stands between two pauses, and is read as one of three things: a run in which every vowel is a capital, which CLL 3.9 says carries no stress mark at all and is folded to lower case; an ordinary run of letters, in which a capital vowel marks stress; or a run containing a letter or digit of no script here, every character of which is foreign. The stage is greedy: where two parses differ, it takes the one that reads the next character over the one that closes a constituent, so a run is never cut short where a rule would let it continue; in particular a period between two digits is read as the decimal point of one number rather than as a pause.

```jbogenbau
%ambiguity-resolution greedy
```

```jbogenbau
%rule text
  ε | pause | items | pause items | items pause | pause items pause

%rule items
  run | items pause run

%rule pause
  pause-char | pause pause-char
%emits
  $ <"PAUSE" ∪ /./>

%rule pause-char
  | "space"
  | $c("other")
%conditions
  ¬matches($c, any-lojban-char)

%rule run
  capital-run | ordinary-run | foreign-run
```

An all-capital run has at least two vowel groups, every vowel a capital; `capital-shape` is that shape, its consonants and digits and its capital vowels, written out so that two groups are required, and `capital-run` reads it with every vowel folded. An ordinary run is any other run of letters, which the condition states by exclusion; in it a capital vowel marks stress. Digits inside either kind are read as the number words they stand for, and a period between two digits as `pi`.

A run of adjacent vowel letters is one vowel group, and a group carries the tags of its last vowel. In the Latin orthography a group is simply its vowels, one phoneme each. A script that writes no apostrophe tags its full vowel letters `syllabic`, and two adjacent syllabic vowels are two syllables with the apostrophe between them, which `vowel-group-joined` emits as a `/'/` token with no text of its own; that is the one thing the frame knows about such scripts, and [cyrillic.md](cyrillic.md) is the one that uses it. The group rules are stated so that adjacent vowels are always in one group and every pair falls under exactly one of the three cases, which keeps a run's parse unique.

```jbogenbau
%rule capital-run
  capital-shape

%rule capital-shape
  capital-part folded-vowel-group capital-part folded-vowel-group capital-part

%rule capital-part
  ε | capital-consonants | capital-part folded-vowel-group capital-consonants

%rule capital-consonants
  capital-non-vowel | capital-consonants capital-non-vowel

%rule capital-non-vowel
  consonant | digit | apostrophe | comma

%rule ordinary-run
  $r(letters)
%conditions
  ¬matches($r, capital-shape)

%rule letters
  non-vowels | vowel-group | letters-after-vowel non-vowels | letters-after-consonant vowel-group

%rule letters-after-vowel
  vowel-group | letters-after-consonant vowel-group

%rule letters-after-consonant
  non-vowels | letters-after-vowel non-vowels

%rule non-vowels
  non-vowel | non-vowels non-vowel | non-vowels decimal-point digit

%rule non-vowel
  consonant | digit | apostrophe | comma

%rule vowel
  plain-vowel | stressed-vowel

%rule vowel-group
  vowel | vowel-group-plain | vowel-group-joined

%rule vowel-group-plain
  | $g(vowel-group) $v(vowel) <tags($v)> | $h(vowel-group) $w(vowel) <tags($w)>
%conditions
  "syllabic" ∉ tags($g),
  "syllabic" ∈ tags($h),
  "syllabic" ∉ tags($w)

%rule vowel-group-joined
  $g(vowel-group) $v(vowel) <tags($v)>
%conditions
  "syllabic" ∈ tags($g),
  "syllabic" ∈ tags($v)
%emits
  $g, /'/, $v

%rule folded-vowel-group
  folded-vowel | folded-vowel-group-plain | folded-vowel-group-joined

%rule folded-vowel-group-plain
  | $g(folded-vowel-group) $v(folded-vowel) <tags($v)>
  | $h(folded-vowel-group) $w(folded-vowel) <tags($w)>
%conditions
  "syllabic" ∉ tags($g),
  "syllabic" ∈ tags($h),
  "syllabic" ∉ tags($w)

%rule folded-vowel-group-joined
  $g(folded-vowel-group) $v(folded-vowel) <tags($v)>
%conditions
  "syllabic" ∈ tags($g),
  "syllabic" ∈ tags($v)
%emits
  $g, /'/, $v

%rule any-lojban-char
  consonant | plain-vowel | stressed-vowel | digit | apostrophe | comma | mark
```

A run with a letter or digit that no script here reads is foreign through and through: each of its characters is emitted as `FOREIGN` with its own text, so that the delimiters of a `zoi` quote and the words of its body can still be compared.

```jbogenbau
%rule foreign-run
  lojban-part foreign-char foreign-part

%rule lojban-part
  ε | lojban-part any-lojban-char

%rule foreign-part
  ε | foreign-part foreign-char | foreign-part any-lojban-char

%rule foreign-char
  | $c("alpha") | $c("digit")
%conditions
  ¬matches($c, any-lojban-char)
%emits
  $ <"FOREIGN">
```

A foreign run is read from its first foreign character: only Lojban
characters come before it, so a run with several foreign characters has
one parse. Inside a foreign run a capital vowel is a stressed vowel; the
folded reading of an all-capital run applies only to runs that are all
Lojban.

## Letters

A consonant is emitted as itself whatever its case; CLL 3.9 uses case on vowels only. A vowel with a stress mark, a capital or an acute or grave accent, whether precomposed or combining, is the stressed phoneme; inside an all-capital run the same capital is folded. A breve on `i` or `u` marks a glide, which the word grammar finds by position, so the letter is emitted plain. The apostrophe is the phoneme `/'/`; its typographic forms and the letter `h`, which some texts use for it, are the same phoneme. A comma marks a syllable break in CLL 3.3 and nothing in the definition effort's word grammar, which ignores it; it is dropped here too, as is a combining mark that no letter rule has taken.

```jbogenbau
%rule consonant
  | "b" </b/> | "B" </b/>
  | "c" </c/> | "C" </c/>
  | "d" </d/> | "D" </d/>
  | "f" </f/> | "F" </f/>
  | "g" </g/> | "G" </g/>
  | "j" </j/> | "J" </j/>
  | "k" </k/> | "K" </k/>
  | "l" </l/> | "L" </l/>
  | "m" </m/> | "M" </m/>
  | "n" </n/> | "N" </n/>
  | "p" </p/> | "P" </p/>
  | "r" </r/> | "R" </r/>
  | "s" </s/> | "S" </s/>
  | "t" </t/> | "T" </t/>
  | "v" </v/> | "V" </v/>
  | "x" </x/> | "X" </x/>
  | "z" </z/> | "Z" </z/>
%emits
  $

%rule plain-vowel
  | "a" </a/>
  | "e" </e/>
  | "i" </i/> | "ĭ" </i/> | "Ĭ" </i/> | "i" glide-mark </i/> | "I" glide-mark </i/>
  | "o" </o/>
  | "u" </u/> | "ŭ" </u/> | "Ŭ" </u/> | "u" glide-mark </u/> | "U" glide-mark </u/>
  | "y" </y/>
%emits
  $

%rule stressed-vowel
  | "A" </A/> | "á" </A/> | "à" </A/> | "Á" </A/> | "À" </A/> | "a" stress-mark </A/>
| "A" stress-mark </A/>
  | "E" </E/> | "é" </E/> | "è" </E/> | "É" </E/> | "È" </E/> | "e" stress-mark </E/>
| "E" stress-mark </E/>
  | "I" </I/> | "í" </I/> | "ì" </I/> | "Í" </I/> | "Ì" </I/> | "i" stress-mark </I/>
| "I" stress-mark </I/>
  | "O" </O/> | "ó" </O/> | "ò" </O/> | "Ó" </O/> | "Ò" </O/> | "o" stress-mark </O/>
| "O" stress-mark </O/>
  | "U" </U/> | "ú" </U/> | "ù" </U/> | "Ú" </U/> | "Ù" </U/> | "u" stress-mark </U/>
| "U" stress-mark </U/>
  | "Y" </Y/> | "ý" </Y/> | "ỳ" </Y/> | "Ý" </Y/> | "Ỳ" </Y/> | "y" stress-mark </Y/>
| "Y" stress-mark </Y/>
%emits
  $

%rule folded-vowel
  "A" </a/> | "E" </e/> | "I" </i/> | "O" </o/> | "U" </u/> | "Y" </y/>
%emits
  $

%rule apostrophe
  "'" | "’" | "‘" | "h" | "H" | "ʼ"
%emits
  $ </'/>

%rule comma
  ","
%emits
  $ <>

%rule mark
  "mark"
%emits
  $ <>

%rule stress-mark
  "\u{0301}" | "\u{0300}"

%rule glide-mark
  "\u{0306}"
```

## Digits

CLL 18.2 lets the digits `0` to `9` stand for the number words, and the definition effort's word grammar lets a digit stand inside a name. A digit is emitted as the letters of its word, and a period between two digits as `pi`.

```jbogenbau
%rule digit
  digit-0 | digit-1 | digit-2 | digit-3 | digit-4 | digit-5 | digit-6 | digit-7 | digit-8 | digit-9

%rule digit-0
  "0"
%emits
  $ </n/>, $ </o/>

%rule digit-1
  "1"
%emits
  $ </p/>, $ </a/>

%rule digit-2
  "2"
%emits
  $ </r/>, $ </e/>

%rule digit-3
  "3"
%emits
  $ </c/>, $ </i/>

%rule digit-4
  "4"
%emits
  $ </v/>, $ </o/>

%rule digit-5
  "5"
%emits
  $ </m/>, $ </u/>

%rule digit-6
  "6"
%emits
  $ </x/>, $ </a/>

%rule digit-7
  "7"
%emits
  $ </z/>, $ </e/>

%rule digit-8
  "8"
%emits
  $ </b/>, $ </i/>

%rule digit-9
  "9"
%emits
  $ </s/>, $ </o/>

%rule decimal-point
  "."
%emits
  $ </p/>, $ </i/>
```
