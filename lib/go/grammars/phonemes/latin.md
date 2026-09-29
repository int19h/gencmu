# Latin conventions

This document adds to [latin-strict.md](latin-strict.md) the conventions that Lojban texts use beyond CLL chapter 3. CLL is *The Complete Lojban Language*. Both documents belong to the phoneme stage, the first stage of the pipeline. The dialects of the [approved word forms](../dialects/bpfk.md), [experimental](../dialects/experimental.md) and [Zantufa](../dialects/zantufa.md) read them, after the rules of latin-strict.md. The [CLL](../dialects/cll-ebnf.md) dialect does not. [The notation document](../../docs/notation.md) explains the notation.

Most conventions here read text that CLL does not. Two of them instead change how the stage reads a text that latin-strict.md also reads. These two are the comma between two vowels, which the approved grammar ignores, and a capital run. A capital run has multiple vowel groups with only capital vowels. The approved grammar is the word-form grammar that the Lojban definition effort approved. The conventions are these:

- Punctuation other than the period is a pause.
- A comma between two vowels is nothing, as it is elsewhere.
- `h` writes the apostrophe.
- A capital run carries no stress mark.
- An accent marks stress, and a breve marks a glide.
- A digit stands for its number word.

## Punctuation

The approved grammar reads the question mark and the exclamation mark as pauses, like the period and whitespace. Its PEG, or parsing expression grammar, calls them `space_char`. This grammar also reads as a pause any other character that is neither a letter of some script, a digit nor a mark. That is a rule of gencmu. Texts on the web put quotation marks, brackets and dashes around words. The approved grammar rejects `mi "klama"`, and this grammar reads it as `mi klama`.

A character token carries only its character tag. So the rule `other-char` names the characters that are no letter, mark, digit or whitespace. A letter is a character of the Unicode property `L`, and a mark is one of `Mn`. A digit is `0` to `9`, and whitespace is a character of the property White_Space. A punctuation character is such a character that no letter rule reads by itself.

A pause token covers its core, from its first to its last whitespace character or period, with any punctuation inside it. A token is one unit that a stage reads or emits. Other punctuation at either end of a pause belongs to no token. So a `zoi` body keeps the quotation marks in `zoi gy. "Hello!" .gy.`. The body takes in the text next to it that no token covers, as [the notation](../../docs/notation.md) says under "Verbatim text".

Punctuation between two letters, with no whitespace, is a pause token of its own, as in `klama!do`. So is a text of nothing but punctuation. Commas can stand inside such a pause and at its edges. The token runs from the first punctuation character of the pause to the last. A comma at an edge belongs to no token, as next to a pause of whitespace. So `jy?,sai` is `jy` and `sai`.

The approved grammar reads `jy?,sai` so too, because each of its letter rules skips the commas before the letter. Punctuation next to the first or the last word of the text belongs to no token.

The phoneme stage cannot know that a pause stands in a quote. So punctuation between two whitespace characters is part of a pause even there, and `zoi gy. !!! .gy.` quotes nothing. camxes-std (the reference PEG parser) reads it so too, because it reads `!` as a space.

```jbogenbau
%redefine-rule pause
  spaced-pause | punctuation-pause

%rule punctuation-pause
  | $c(punctuation)
  | commas $c(punctuation)
  | $c(punctuation) commas
  | commas $c(punctuation) commas
%emits
  $c <PAUSE ∪ /./>

%redefine-rule pause-edge
  edge-char | pause-edge edge-char

%rule edge-char
  comma | punctuation-char

%rule punctuation
  punctuation-char | punctuation punctuation-char | punctuation commas punctuation-char

%rule punctuation-char
  $c(other-char)
%conditions
  ¬matches($c, any-lojban-char),
  ¬matches($c, core-char)

%rule other-char
  $c('\p{Any}')
%conditions
  ¬matches($c, alpha-char),
  ¬matches($c, mark-char),
  ¬matches($c, digit-char),
  ¬matches($c, space-char)

%rule alpha-char
  '\p{L}'

%rule mark-char
  '\p{Mn}'

%rule digit-char
  '0'..'9'

%redefine-rule run-char
  $c('\p{Any}')
%conditions
  ¬matches($c, core-char),
  ¬matches($c, punctuation-char)
```

## The comma

The approved grammar ignores a comma before a letter (`comma*` in each letter rule of its PEG). So a comma between two vowels is no syllable break here: it is nothing, as a comma is between other letters. The vowels on either side are one vowel group, as if they stood side by side. `me,iin` is `meiin`, and the Cyrillic `ма,и` is `ma'i`, as `маи` is. This document redefines `letters-after-vowel` without the `syllable-break` of latin-strict.md. So nothing reads `syllable-break` in these dialects.

```jbogenbau
%redefine-rule letters-after-vowel
  | vowel-group
  | letters-after-consonant [commas] vowel-group

%extend-rule vowel-group-plain
  | vowel-group⊉~syllabic commas $v(vowel) <tags($v)> | vowel-group⊇~syllabic commas $w(vowel⊉~syllabic) <tags($w)>

%extend-rule vowel-group-joined
  vowel-group⊇~syllabic commas $v(joined-vowel⊇~syllabic) <tags($v)>
```

## The apostrophe

Texts write the apostrophe as the letter `h`, which CLL does not use. The names of selma'o, such as KOhA, write it so, and the approved grammar reads it so (`h <- comma* ['h] &nucleus` in its PEG).

```jbogenbau
%extend-rule apostrophe
  'h' | 'H'
%emits
  $ </'/>
```

## Capital runs

A run in which every vowel is a capital carries no stress mark, and the stage reads its vowels as plain vowels. That is a rule of gencmu, not of CLL. A title or a shout is often written all in capitals, and its capitals do not mark stress. The run must have at least two vowel groups. So a name with one stressed syllable in capitals keeps its stress mark: `.DJORdj.` keeps its stress on `o`. The cost is that the stage reads a word of one vowel group, written in capitals, as stressed: in the text `MI KLAMA`, `MI` is `mI`.

`capital-shape` is that shape: its consonants and digits and its capital vowels, written out so that two groups are required. Consonants stand between every two groups, so the rules never split adjacent vowels into separate groups. `capital-consonants` reads a decimal point between two digits, as `non-vowels` does in an ordinary run (see "Digits"). So `MI2.3KLAMA` is a capital run. `capital-consonants` does not reuse `non-vowels`, because other scripts extend `non-vowel` with forms that hold a vowel. Forms such as the zbalermorna shorthand keep a run from folding.

`capital-run` reads that shape with every vowel folded. An ordinary run is any other run of letters, which the condition states by exclusion. In an ordinary run, a capital vowel marks stress. A foreign run is now also a run that is not a capital run.

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
  $ <FOREIGN>
%verbatim

%rule capital-run
  capital-shape

%rule capital-shape
  [capital-consonants [commas]] capital-groups [[commas] capital-consonants]

%rule capital-groups
  | folded-vowel-group capital-gap folded-vowel-group
  | capital-groups capital-gap folded-vowel-group

%rule capital-gap
  [commas] capital-consonants [commas]

%rule capital-consonants
  | capital-non-vowel
  | capital-consonants capital-non-vowel
  | capital-consonants commas capital-non-vowel
  | $c(capital-consonants) decimal-point digit
%conditions
  matches(last($c), digit)

%rule capital-non-vowel
  consonant | digit | apostrophe

%rule folded-vowel-group
  folded-vowel | folded-vowel-group-plain | folded-vowel-group-joined

%rule folded-vowel-group-plain
  | folded-vowel-group⊉~syllabic [commas] $v(folded-vowel) <tags($v)>
  | folded-vowel-group⊇~syllabic [commas] $w(folded-vowel⊉~syllabic) <tags($w)>

%rule folded-vowel-group-joined
  folded-vowel-group⊇~syllabic [commas] $v(joined-folded-vowel⊇~syllabic) <tags($v)>

%rule joined-folded-vowel
  $v(folded-vowel) <tags($v)>
%emits
  /'/, $v

%rule folded-vowel
  'A' </a/> | 'E' </e/> | 'I' </i/> | 'O' </o/> | 'U' </u/> | 'Y' </y/>
%emits
  $
```

## Accents and breves

A vowel with an acute or a grave accent, precomposed or combining, is the stressed phoneme, as a capital vowel is. Many texts mark stress this way, and CLL does not. A breve on `i` or `u` marks a glide in some texts. The word grammar finds a glide by its position, so the stage emits the letter plain. A combining mark that no letter rule takes makes its run foreign, as the precomposed letter already is. So the stage reads `i` followed by U+0308 as it reads `ï`.

```jbogenbau
%extend-rule plain-vowel
  | 'ĭ' </i/> | 'Ĭ' </i/> | 'i' glide-mark </i/> | 'I' glide-mark </i/>
  | 'ŭ' </u/> | 'Ŭ' </u/> | 'u' glide-mark </u/> | 'U' glide-mark </u/>
%emits
  $

%extend-rule stressed-vowel
  | 'á' </A/> | 'à' </A/> | 'Á' </A/> | 'À' </A/> | 'a' stress-mark </A/> | 'A' stress-mark </A/>
  | 'é' </E/> | 'è' </E/> | 'É' </E/> | 'È' </E/> | 'e' stress-mark </E/> | 'E' stress-mark </E/>
  | 'í' </I/> | 'ì' </I/> | 'Í' </I/> | 'Ì' </I/> | 'i' stress-mark </I/> | 'I' stress-mark </I/>
  | 'ó' </O/> | 'ò' </O/> | 'Ó' </O/> | 'Ò' </O/> | 'o' stress-mark </O/> | 'O' stress-mark </O/>
  | 'ú' </U/> | 'ù' </U/> | 'Ú' </U/> | 'Ù' </U/> | 'u' stress-mark </U/> | 'U' stress-mark </U/>
  | 'ý' </Y/> | 'ỳ' </Y/> | 'Ý' </Y/> | 'Ỳ' </Y/> | 'y' stress-mark </Y/> | 'Y' stress-mark </Y/>
%emits
  $

%rule stress-mark
  '\u{301}' | '\u{300}'

%rule glide-mark
  '\u{306}'
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
  '0'
%emits
  $ </n/>, $ </o/>

%rule digit-1
  '1'
%emits
  $ </p/>, $ </a/>

%rule digit-2
  '2'
%emits
  $ </r/>, $ </e/>

%rule digit-3
  '3'
%emits
  $ </c/>, $ </i/>

%rule digit-4
  '4'
%emits
  $ </v/>, $ </o/>

%rule digit-5
  '5'
%emits
  $ </m/>, $ </u/>

%rule digit-6
  '6'
%emits
  $ </x/>, $ </a/>

%rule digit-7
  '7'
%emits
  $ </z/>, $ </e/>

%rule digit-8
  '8'
%emits
  $ </b/>, $ </i/>

%rule digit-9
  '9'
%emits
  $ </s/>, $ </o/>

%rule decimal-point
  '.'
%emits
  $ </p/>, $ </i/>
```
