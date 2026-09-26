# Latin conventions

This document adds to [latin-strict.md](latin-strict.md) the conventions that Lojban texts use beyond CLL chapter 3. The dialects of the [approved word forms](../dialects/bpfk.md), [experimental](../dialects/experimental.md) and [Zantufa](../dialects/zantufa.md) read them, after the frame of latin-strict.md. The [CLL](../dialects/cll-ebnf.md) dialect does not. The notation is explained in [the notation document](../../docs/notation.md).

Most conventions here read text that CLL does not. Two of them instead change how a text that latin-strict.md reads is read: the comma between two vowels, which the approved grammar ignores, and a run written all in capitals. The conventions are these:

- punctuation other than the period is a pause
- a comma between two vowels is nothing, as it is elsewhere
- a run written all in capitals carries no stress mark
- an accent marks stress, and a breve marks a glide
- a digit stands for its number word

## Punctuation

The approved grammar reads the question mark and the exclamation mark as pauses, like the period and whitespace (`space_char` in its PEG). This grammar also reads as a pause any other character that is neither a letter of some script, a digit nor a mark. That is a rule of gencmu. Texts on the web put quotation marks, brackets and dashes around words. The approved grammar rejects `mi "klama"`, and this grammar reads it as `mi klama`.

A pause token covers its core, from its first to its last whitespace character or period, with any punctuation inside it. Other punctuation at either end of a pause belongs to no token. So a `zoi` body keeps the quotation marks in `zoi gy. "Hello!" .gy.`. The body takes in the text next to it that no token covers, as [the notation](../../docs/notation.md) says under "Verbatim text". Punctuation between two letters, with no whitespace, is a pause token of its own, as in `klama!do`. So is a text of nothing but punctuation. Commas can stand inside such a pause and at its edges. The token runs from the first punctuation character of the pause to the last. A comma at an edge belongs to no token, as next to a pause of whitespace. So `jy?,sai` is `jy` and `sai`. The approved grammar reads it so too, since each of its letter rules skips the commas before the letter. Punctuation next to the first or the last word of the text belongs to no token.

The phoneme stage cannot know that a pause stands in a quote. So punctuation between two whitespace characters is part of a pause even there, and `zoi gy. !!! .gy.` quotes nothing. camxes-std reads it so too, since it reads `!` as a space.

```jbogenbau
%redefine-rule pause
  spaced-pause | punctuation-pause

%rule punctuation-pause
  | $c(punctuation)
  | commas $c(punctuation)
  | $c(punctuation) commas
  | commas $c(punctuation) commas
%emits
  $c <"PAUSE" ∪ /./>

%redefine-rule pause-edge
  edge-char | pause-edge edge-char

%rule edge-char
  comma | punctuation-char

%rule punctuation
  punctuation-char | punctuation punctuation-char | punctuation commas punctuation-char

%rule punctuation-char
  $c("other")
%conditions
  ¬matches($c, any-lojban-char),
  ¬matches($c, core-char)

%redefine-rule run-char
  $c(run-class)
%conditions
  ¬matches($c, core-char),
  ¬matches($c, punctuation-char)
```

## The comma

The approved grammar ignores a comma before a letter (`comma*` in each letter rule of its PEG). So a comma between two vowels is no syllable break here: it is nothing, as a comma is between other letters. `me,iin` is `meiin`.

```jbogenbau
%redefine-rule syllable-break
  commas
```

## Capital runs

A run in which every vowel is a capital carries no stress mark, and its vowels are read as plain vowels. That is a rule of gencmu, not of CLL. A title or a shout is often written all in capitals, and its capitals do not mark stress. The run must have at least two vowel groups. So a name with one stressed syllable in capitals keeps its stress mark: `.DJORdj.` keeps its stress on `o`. The cost is that a word of one vowel group, written in capitals, is read as stressed: in the text `MI KLAMA`, `MI` is `mI`.

`capital-shape` is that shape: its consonants and digits and its capital vowels, written out so that two groups are required. Consonants stand between every two groups, so a group of adjacent vowels is never split in two. `capital-run` reads it with every vowel folded. An ordinary run is any other run of letters, which the condition states by exclusion. In it a capital vowel marks stress. A foreign run is now also a run that is not a capital run.

```jbogenbau
%extend-rule run
  capital-run

%redefine-rule ordinary-run
  $r(letters)
%conditions
  ¬matches($r, capital-shape)

%redefine-rule foreign-run
  $r(foreign-chars)
%conditions
  ¬matches($r, letters),
  ¬matches($r, capital-shape),
  ¬matches(head($r), comma),
  ¬matches(last($r), comma)
%emits
  $ <"FOREIGN">
%verbatim

%rule capital-run
  capital-shape

%rule capital-shape
  [capital-consonants] capital-groups [capital-consonants]

%rule capital-groups
  | folded-vowel-group capital-consonants folded-vowel-group
  | capital-groups capital-consonants folded-vowel-group

%rule capital-consonants
  capital-non-vowel | capital-consonants capital-non-vowel | capital-consonants commas capital-non-vowel

%rule capital-non-vowel
  consonant | digit | apostrophe

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
  $g(folded-vowel-group) $v(joined-folded-vowel) <tags($v)>
%conditions
  "syllabic" ∈ tags($g),
  "syllabic" ∈ tags($v)

%rule joined-folded-vowel
  $v(folded-vowel) <tags($v)>
%emits
  /'/, $v

%rule folded-vowel
  "A" </a/> | "E" </e/> | "I" </i/> | "O" </o/> | "U" </u/> | "Y" </y/>
%emits
  $
```

## Accents and breves

A vowel with an acute or a grave accent, precomposed or combining, is the stressed phoneme, as a capital vowel is. Many texts mark stress this way, and CLL does not. A breve on `i` or `u` marks a glide in some texts. The word grammar finds a glide by its position, so the letter is emitted plain. A combining mark that no letter rule takes makes its run foreign, as the precomposed letter already is. So `i` followed by U+0308 is read as `ï` is.

```jbogenbau
%extend-rule plain-vowel
  | "ĭ" </i/> | "Ĭ" </i/> | "i" glide-mark </i/> | "I" glide-mark </i/>
  | "ŭ" </u/> | "Ŭ" </u/> | "u" glide-mark </u/> | "U" glide-mark </u/>
%emits
  $

%extend-rule stressed-vowel
  | "á" </A/> | "à" </A/> | "Á" </A/> | "À" </A/> | "a" stress-mark </A/> | "A" stress-mark </A/>
  | "é" </E/> | "è" </E/> | "É" </E/> | "È" </E/> | "e" stress-mark </E/> | "E" stress-mark </E/>
  | "í" </I/> | "ì" </I/> | "Í" </I/> | "Ì" </I/> | "i" stress-mark </I/> | "I" stress-mark </I/>
  | "ó" </O/> | "ò" </O/> | "Ó" </O/> | "Ò" </O/> | "o" stress-mark </O/> | "O" stress-mark </O/>
  | "ú" </U/> | "ù" </U/> | "Ú" </U/> | "Ù" </U/> | "u" stress-mark </U/> | "U" stress-mark </U/>
  | "ý" </Y/> | "ỳ" </Y/> | "Ý" </Y/> | "Ỳ" </Y/> | "y" stress-mark </Y/> | "Y" stress-mark </Y/>
%emits
  $

%rule stress-mark
  "\u{0301}" | "\u{0300}"

%rule glide-mark
  "\u{0306}"
```

## Digits

The approved grammar reads a digit as a member of PA, the number word it stands for, and lets a digit stand inside a name. This grammar emits a digit as the letters of its word, so `2` is `re`. CLL does not write digits. A period between two digits is the decimal point, `pi`. `items` says that no pause stands there, and the decimal point needs a digit before it, so `la .djan.2mei` has a pause after `djan`.

```jbogenbau
%redefine-rule items
  | run
  | $i(items) $p(pause) $r(run)
%conditions
  ¬matches(last($i), digit) ∨ text($p) ≠ "." ∨ ¬matches(head($r), digit)

%extend-rule non-vowel
  digit

%extend-rule non-vowels
  $n(non-vowels) decimal-point digit
%conditions
  matches(last($n), digit)

%extend-rule any-lojban-char
  digit

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
