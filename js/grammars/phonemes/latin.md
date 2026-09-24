# Latin orthography

This document opens the phoneme stage, the first stage of every Lojban dialect: [CLL](../dialects/cll.md), [approved word forms](../dialects/bpfk.md), [experimental](../dialects/experimental.md) and [Zantufa](../dialects/zantufa.md). The stage reads the characters of a text and hands the word stage the phonemes they stand for. Its terminals are characters, each written in straight quotes, and the character classes `alpha`, `digit`, `space`, `mark` and `other` that every character token also carries; it emits one token per phoneme, carrying that phoneme's tag, so that the word grammar never sees a character and reads every script alike. This document contributes the standard Latin orthography of CLL chapter 3 and the frame of the stage, runs of letters between pauses; [cyrillic.md](cyrillic.md) and [zbalermorna.md](zbalermorna.md) add their letters to the same rules. The notation is explained in [the notation document](../../docs/notation.md).

The phonemes are the letters of CLL chapter 3, each written as a phoneme tag: the consonants `/b/`, `/c/`, `/d/` and so on through `/z/`, the vowels `/a/ /e/ /i/ /o/ /u/ /y/`, the apostrophe `/'/`, and the stressed vowels `/A/ /E/ /I/ /O/ /U/ /Y/`, a stressed vowel being a separate phoneme so that stress is a position in the word grammar rather than a mark it tests. Two tags stand for what is not a letter: `PAUSE` for a pause of any length, which also carries the phoneme tag `/ /` so that it sounds as a space, and `FOREIGN` for a character that is not Lojban at all, which the word grammar admits only inside a foreign quote.

## The text and its runs

The text is pauses and runs. A pause is any run of pause characters: the period, question mark, exclamation mark and whitespace that CLL 3.1 names, and any other character that is neither a letter of some script nor a digit, since such a character is not Lojban and separates words as firmly. A run is what stands between two pauses, and is read as one of three things: a run in which every vowel is a capital, which CLL 3.9 says carries no stress mark at all and is folded to lower case; an ordinary run of letters, in which a capital vowel marks stress; or a run containing a letter or digit of no script here, every character of which is foreign. The stage is greedy: where two parses differ, it takes the one that reads the next character over the one that closes a constituent, so a run is never cut short where a rule would let it continue; in particular a period between two digits is read as the decimal point of one number rather than as a pause.

```ebnf
%ambiguity-resolution greedy ;
```

```ebnf
text
≔ ε | pause | items | pause items | items pause | pause items pause ;

items
≔ run | items pause run ;

pause
≔ pause-char | pause pause-char
⇒ this <"PAUSE" ∪ / /> ;
pause-char
≔ "space"
| $c("other")
: ¬matches($c, any-lojban-char) ;

run
≔ capital-run | ordinary-run | foreign-run ;
```

An all-capital run has at least two vowel groups, every vowel a capital; `capital-shape` is that shape, its consonants and digits and its capital vowels, written out so that two groups are required, and `capital-run` reads it with every vowel folded. An ordinary run is any other run of letters, which the condition states by exclusion; in it a capital vowel marks stress. Digits inside either kind are read as the number words they stand for, and a period between two digits as `pi`.

A run of adjacent vowel letters is one vowel group, and a group carries the tags of its last vowel. In the Latin orthography a group is simply its vowels, one phoneme each. A script that writes no apostrophe tags its full vowel letters `syllabic`, and two adjacent syllabic vowels are two syllables with the apostrophe between them, which `vowel-group-joined` emits as a `/'/` token with no text of its own; that is the one thing the frame knows about such scripts, and [cyrillic.md](cyrillic.md) is the one that uses it. The group rules are stated so that adjacent vowels are always in one group and every pair falls under exactly one of the three cases, which keeps a run's parse unique.

```ebnf
capital-run
≔ capital-shape ;

capital-shape
≔ capital-part folded-vowel-group capital-part folded-vowel-group capital-part ;

capital-part
≔ ε | capital-consonants | capital-part folded-vowel-group capital-consonants ;

capital-consonants
≔ capital-non-vowel | capital-consonants capital-non-vowel ;

capital-non-vowel
≔ consonant | digit | apostrophe | comma ;

ordinary-run
≔ $r(letters)
: ¬matches($r, capital-shape) ;

letters
≔ non-vowels | vowel-group | letters-after-vowel non-vowels | letters-after-consonant vowel-group ;

letters-after-vowel
≔ vowel-group | letters-after-consonant vowel-group ;

letters-after-consonant
≔ non-vowels | letters-after-vowel non-vowels ;

non-vowels
≔ non-vowel | non-vowels non-vowel | non-vowels decimal-point digit ;

non-vowel
≔ consonant | digit | apostrophe | comma ;

vowel
≔ plain-vowel | stressed-vowel ;

vowel-group
≔ vowel | vowel-group-plain | vowel-group-joined ;

vowel-group-plain
≔ $g(vowel-group) $v(vowel) <tags($v)>| $h(vowel-group) $w(vowel) <tags($w)>
: "syllabic" ∉ tags($g), "syllabic" ∈ tags($h), "syllabic" ∉ tags($w) ;

vowel-group-joined
≔ $g(vowel-group) $v(vowel) <tags($v)>
: "syllabic" ∈ tags($g), "syllabic" ∈ tags($v)
⇒ $g, /'/, $v ;

folded-vowel-group
≔ folded-vowel | folded-vowel-group-plain | folded-vowel-group-joined ;

folded-vowel-group-plain
≔ $g(folded-vowel-group) $v(folded-vowel) <tags($v)>| $h(folded-vowel-group) $w(folded-vowel) <tags($w)>
: "syllabic" ∉ tags($g), "syllabic" ∈ tags($h), "syllabic" ∉ tags($w) ;

folded-vowel-group-joined
≔ $g(folded-vowel-group) $v(folded-vowel) <tags($v)>
: "syllabic" ∈ tags($g), "syllabic" ∈ tags($v)
⇒ $g, /'/, $v ;

any-lojban-char
≔ consonant | plain-vowel | stressed-vowel | digit | apostrophe | comma | mark ;
```

A run with a letter or digit that no script here reads is foreign through and through: each of its characters is emitted as `FOREIGN` with its own text, so that the delimiters of a `zoi` quote and the words of its body can still be compared.

```ebnf
foreign-run
≔ lojban-part foreign-char foreign-part ;

lojban-part
≔ ε | lojban-part any-lojban-char ;

foreign-part
≔ ε | foreign-part foreign-char | foreign-part any-lojban-char ;

foreign-char
≔ $c("alpha") | $c("digit")
: ¬matches($c, any-lojban-char)
⇒ this <"FOREIGN"> ;
```

## Letters

A consonant is emitted as itself whatever its case; CLL 3.9 uses case on vowels only. A vowel with a stress mark, a capital or an acute or grave accent, whether precomposed or combining, is the stressed phoneme; inside an all-capital run the same capital is folded. A breve on `i` or `u` marks a glide, which the word grammar finds by position, so the letter is emitted plain. The apostrophe is the phoneme `/'/`; its typographic forms and the letter `h`, which some texts use for it, are the same phoneme. A comma marks a syllable break in CLL 3.3 and nothing in the definition effort's word grammar, which ignores it; it is dropped here too, as is a combining mark that no letter rule has taken.

```ebnf
consonant
≔ "b" </b/>| "B" </b/>| "c" </c/>| "C" </c/>| "d" </d/>| "D" </d/>| "f" </f/>| "F" </f/>| "g" </g/>| "G" </g/>| "j" </j/>| "J" </j/>| "k" </k/>| "K" </k/>| "l" </l/>| "L" </l/>| "m" </m/>| "M" </m/>| "n" </n/>| "N" </n/>| "p" </p/>| "P" </p/>| "r" </r/>| "R" </r/>| "s" </s/>| "S" </s/>| "t" </t/>| "T" </t/>| "v" </v/>| "V" </v/>| "x" </x/>| "X" </x/>| "z" </z/>| "Z" </z/>
⇒ this ;

plain-vowel
≔ "a" </a/>| "e" </e/>| "i" </i/>| "o" </o/>| "u" </u/>| "y" </y/>| "ĭ" </i/>| "Ĭ" </i/>| "ŭ" </u/>| "Ŭ" </u/>| "i" glide-mark </i/>| "u" glide-mark </u/>| "I" glide-mark </i/>| "U" glide-mark </u/>
⇒ this ;

stressed-vowel
≔ "A" </A/>| "E" </E/>| "I" </I/>| "O" </O/>| "U" </U/>| "Y" </Y/>| "á" </A/>| "é" </E/>| "í" </I/>| "ó" </O/>| "ú" </U/>| "ý" </Y/>| "à" </A/>| "è" </E/>| "ì" </I/>| "ò" </O/>| "ù" </U/>| "ỳ" </Y/>| "Á" </A/>| "É" </E/>| "Í" </I/>| "Ó" </O/>| "Ú" </U/>| "Ý" </Y/>| "À" </A/>| "È" </E/>| "Ì" </I/>| "Ò" </O/>| "Ù" </U/>| "Ỳ" </Y/>| "a" stress-mark </A/>| "e" stress-mark </E/>| "i" stress-mark </I/>| "o" stress-mark </O/>| "u" stress-mark </U/>| "y" stress-mark </Y/>| "A" stress-mark </A/>| "E" stress-mark </E/>| "I" stress-mark </I/>| "O" stress-mark </O/>| "U" stress-mark </U/>| "Y" stress-mark </Y/>
⇒ this ;

folded-vowel
≔ "A" </a/>| "E" </e/>| "I" </i/>| "O" </o/>| "U" </u/>| "Y" </y/>
⇒ this ;

apostrophe
≔ "'" | "’" | "‘" | "h" | "H" | "ʼ"
⇒ this </'/> ;
comma
≔ ","
⇒ nothing ;

mark
≔ "mark"
⇒ nothing ;

stress-mark
≔ "\u{0301}" | "\u{0300}" ;

glide-mark
≔ "\u{0306}" ;
```

## Digits

CLL 18.2 lets the digits `0` to `9` stand for the number words, and the definition effort's word grammar lets a digit stand inside a name. A digit is emitted as the letters of its word, and a period between two digits as `pi`.

```ebnf
digit
≔ digit-0 | digit-1 | digit-2 | digit-3 | digit-4 | digit-5 | digit-6 | digit-7 | digit-8 | digit-9 ;

digit-0
≔ "0"
⇒ this </n/>, this </o/> ;
digit-1
≔ "1"
⇒ this </p/>, this </a/> ;
digit-2
≔ "2"
⇒ this </r/>, this </e/> ;
digit-3
≔ "3"
⇒ this </c/>, this </i/> ;
digit-4
≔ "4"
⇒ this </v/>, this </o/> ;
digit-5
≔ "5"
⇒ this </m/>, this </u/> ;
digit-6
≔ "6"
⇒ this </x/>, this </a/> ;
digit-7
≔ "7"
⇒ this </z/>, this </e/> ;
digit-8
≔ "8"
⇒ this </b/>, this </i/> ;
digit-9
≔ "9"
⇒ this </s/>, this </o/> ;
decimal-point
≔ "."
⇒ this </p/>, this </i/> ;
```
