# Latin conventions

This document adds to [latin-strict.md](latin-strict.md) the conventions that Lojban texts use beyond CLL 1.1 chapter 3. CLL is *The Complete Lojban Language*. Both documents belong to the phoneme stage, the first stage of the pipeline. The dialects of the [BPFK](../dialects/bpfk.md), [experimental](../dialects/experimental.md) and [Zantufa](../dialects/zantufa.md) read them, after the rules of latin-strict.md. The [CLL](../dialects/cll-ebnf.md) dialect does not. [The notation document](../../docs/notation.md) explains the notation.

Most conventions here read text that CLL does not. Two of them instead change how the stage reads a text that latin-strict.md also reads. These two are the comma between two vowels, which the working morphology ignores, and a capital run. A capital run has multiple vowel groups with only capital vowels. The working morphology is the word-form grammar that [bpfk.md](../words/bpfk.md) translates. The conventions are these:

- Punctuation other than the period and the comma is a pause.
- A comma between two vowels is nothing, as it is elsewhere.
- `h` writes the apostrophe.
- A capital run carries no stress mark.
- An accent marks stress, and a breve marks a glide.
- A digit stands for its number word.

## Punctuation

The working morphology reads the question mark and the exclamation mark as pauses, like the period and whitespace. Its PEG, or parsing expression grammar, calls them `space_char`. This grammar also reads as a pause any other character that is neither a letter of some script, a digit, a mark nor a comma. That is a rule of gencmu. Texts on the web put quotation marks, brackets and dashes around words. The working morphology rejects `mi "klama"`, and this grammar reads it as `mi klama`.

A character token carries only its character tag. So the rule `other-char` names the characters that are no letter, mark, digit or whitespace. A letter is a character of the Unicode property `L`. A mark is one of `Mn`, or the stress mark or the shorthand of [zbalermorna.md](zbalermorna.md). A digit is `0` to `9`, and whitespace is a character of the property White_Space. A punctuation character is such a character that no rule of `any-lojban-char` or `core-char` reads by itself.

A pause token covers its core, from its first to its last whitespace character or period, with any punctuation inside it. A token is one unit that a stage reads or emits. Other punctuation at either end of a pause belongs to no token. So a `zoi` body keeps the quotation marks in `zoi gy. "Hello!" .gy.`. The body takes in the text next to it that no token covers, as [the notation](../../docs/notation.md) says under "Opaque text".

Punctuation between two letters, with no whitespace, is a pause token of its own, as in `klama!do`. So is a text of nothing but punctuation. Commas can stand inside such a pause and at its edges. The token runs from the first punctuation character of the pause to the last. A comma at an edge belongs to no token, as next to a pause of whitespace. So `jy?,sai` is `jy` and `sai`.

The working morphology reads `jy?,sai` so too, because each of its letter rules skips the commas before the letter. Punctuation next to the first or the last word of the text belongs to no token.

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

<details><summary>Railroad diagram of <code>pause</code></summary><img src="../../docs/diagrams/phonemes/latin/pause.svg" alt="Railroad diagram of the rule pause"></details>
<details><summary>Railroad diagram of <code>punctuation-pause</code></summary><img src="../../docs/diagrams/phonemes/latin/punctuation-pause.svg" alt="Railroad diagram of the rule punctuation-pause"></details>
<details><summary>Railroad diagram of <code>pause-edge</code></summary><img src="../../docs/diagrams/phonemes/latin/pause-edge.svg" alt="Railroad diagram of the rule pause-edge"></details>
<details><summary>Railroad diagram of <code>edge-char</code></summary><img src="../../docs/diagrams/phonemes/latin/edge-char.svg" alt="Railroad diagram of the rule edge-char"></details>
<details><summary>Railroad diagram of <code>punctuation</code></summary><img src="../../docs/diagrams/phonemes/latin/punctuation.svg" alt="Railroad diagram of the rule punctuation"></details>
<details><summary>Railroad diagram of <code>punctuation-char</code></summary><img src="../../docs/diagrams/phonemes/latin/punctuation-char.svg" alt="Railroad diagram of the rule punctuation-char"></details>
<details><summary>Railroad diagram of <code>other-char</code></summary><img src="../../docs/diagrams/phonemes/latin/other-char.svg" alt="Railroad diagram of the rule other-char"></details>
<details><summary>Railroad diagram of <code>alpha-char</code></summary><img src="../../docs/diagrams/phonemes/latin/alpha-char.svg" alt="Railroad diagram of the rule alpha-char"></details>
<details><summary>Railroad diagram of <code>mark-char</code></summary><img src="../../docs/diagrams/phonemes/latin/mark-char.svg" alt="Railroad diagram of the rule mark-char"></details>
<details><summary>Railroad diagram of <code>digit-char</code></summary><img src="../../docs/diagrams/phonemes/latin/digit-char.svg" alt="Railroad diagram of the rule digit-char"></details>
<details><summary>Railroad diagram of <code>run-char</code></summary><img src="../../docs/diagrams/phonemes/latin/run-char.svg" alt="Railroad diagram of the rule run-char"></details>

## The comma

The working morphology ignores a comma before a letter (`comma*` in each letter rule of its PEG). So a comma between two vowels is no syllable break here: it is nothing, as a comma is between other letters. The vowels on either side are one vowel group, as if they stood side by side. `me,iin` is `meiin`, and the Cyrillic `ма,и` is `ma'i`, as `маи` is. This document redefines `letters-after-vowel` without the `syllable-break` of latin-strict.md. So nothing reads `syllable-break` in these dialects.

```jbogenbau
%redefine-rule letters-after-vowel
  | vowel-group
  | letters-after-consonant [commas] vowel-group

%extend-rule vowel-group-plain
  | vowel-group⊉~syllabic commas $v(vowel) <tags($v)> | vowel-group⊇~syllabic commas $w(vowel⊉~syllabic) <tags($w)>

%extend-rule vowel-group-joined
  vowel-group⊇~syllabic commas $v(joined-vowel⊇~syllabic) <tags($v)>
```

<details><summary>Railroad diagram of <code>letters-after-vowel</code></summary><img src="../../docs/diagrams/phonemes/latin/letters-after-vowel.svg" alt="Railroad diagram of the rule letters-after-vowel"></details>
<details><summary>Railroad diagram of <code>vowel-group-plain</code></summary><img src="../../docs/diagrams/phonemes/latin/vowel-group-plain.svg" alt="Railroad diagram of the rule vowel-group-plain"></details>
<details><summary>Railroad diagram of <code>vowel-group-joined</code></summary><img src="../../docs/diagrams/phonemes/latin/vowel-group-joined.svg" alt="Railroad diagram of the rule vowel-group-joined"></details>

## The apostrophe

Texts write the apostrophe as the letter `h`, which CLL does not use. The names of selma'o (classes of Lojban particles), such as KOhA, write the apostrophe this way. The working morphology also reads `h` as an apostrophe (`h <- comma* ['h] &nucleus` in its PEG).

```jbogenbau
%extend-rule apostrophe
  'h' | 'H'
%emits
  $ </'/>
```

<details><summary>Railroad diagram of <code>apostrophe</code></summary><img src="../../docs/diagrams/phonemes/latin/apostrophe.svg" alt="Railroad diagram of the rule apostrophe"></details>

## Capital runs

A run in which every vowel is a capital carries no stress mark, and the stage reads its vowels as plain vowels. That is a rule of gencmu, not of CLL. A title or a shout is often written all in capitals, and its capitals do not mark stress. The run must have at least two vowel groups. So a name with one stressed syllable in capitals keeps its stress mark: `.DJORdj.` keeps its stress on `o`. The cost is that the stage reads a word of one vowel group, written in capitals, as stressed: in the text `MI KLAMA`, `MI` is `mI`.

`capital-shape` is that shape: its consonants and digits and its capital vowels, written out so that two groups are required. Consonants stand between every two groups, so the rules never split adjacent vowels into separate groups. `capital-consonants` reads a decimal point between two digits, as `non-vowels` does in an ordinary run (see "Digits"). So `MI2.3KLAMA` is a capital run. `capital-consonants` does not reuse `non-vowels`, because other scripts extend `non-vowel` with forms that hold a vowel. Forms such as the zbalermorna shorthand keep a run from folding.

`capital-run` reads that shape with every vowel folded. An ordinary run is any other run of letters, which the condition states by exclusion. In an ordinary run, a capital vowel marks stress. No capital run matches `foreign-chars` in the bundled grammars, so `foreign-run` needs no separate test for it.

```jbogenbau
%extend-rule run
  capital-run

%redefine-rule ordinary-run
  $r(letters)
%conditions
  ¬matches($r, capital-shape)

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

<details><summary>Railroad diagram of <code>run</code></summary><img src="../../docs/diagrams/phonemes/latin/run.svg" alt="Railroad diagram of the rule run"></details>
<details><summary>Railroad diagram of <code>ordinary-run</code></summary><img src="../../docs/diagrams/phonemes/latin/ordinary-run.svg" alt="Railroad diagram of the rule ordinary-run"></details>
<details><summary>Railroad diagram of <code>capital-run</code></summary><img src="../../docs/diagrams/phonemes/latin/capital-run.svg" alt="Railroad diagram of the rule capital-run"></details>
<details><summary>Railroad diagram of <code>capital-shape</code></summary><img src="../../docs/diagrams/phonemes/latin/capital-shape.svg" alt="Railroad diagram of the rule capital-shape"></details>
<details><summary>Railroad diagram of <code>capital-groups</code></summary><img src="../../docs/diagrams/phonemes/latin/capital-groups.svg" alt="Railroad diagram of the rule capital-groups"></details>
<details><summary>Railroad diagram of <code>capital-gap</code></summary><img src="../../docs/diagrams/phonemes/latin/capital-gap.svg" alt="Railroad diagram of the rule capital-gap"></details>
<details><summary>Railroad diagram of <code>capital-consonants</code></summary><img src="../../docs/diagrams/phonemes/latin/capital-consonants.svg" alt="Railroad diagram of the rule capital-consonants"></details>
<details><summary>Railroad diagram of <code>capital-non-vowel</code></summary><img src="../../docs/diagrams/phonemes/latin/capital-non-vowel.svg" alt="Railroad diagram of the rule capital-non-vowel"></details>
<details><summary>Railroad diagram of <code>folded-vowel-group</code></summary><img src="../../docs/diagrams/phonemes/latin/folded-vowel-group.svg" alt="Railroad diagram of the rule folded-vowel-group"></details>
<details><summary>Railroad diagram of <code>folded-vowel-group-plain</code></summary><img src="../../docs/diagrams/phonemes/latin/folded-vowel-group-plain.svg" alt="Railroad diagram of the rule folded-vowel-group-plain"></details>
<details><summary>Railroad diagram of <code>folded-vowel-group-joined</code></summary><img src="../../docs/diagrams/phonemes/latin/folded-vowel-group-joined.svg" alt="Railroad diagram of the rule folded-vowel-group-joined"></details>
<details><summary>Railroad diagram of <code>joined-folded-vowel</code></summary><img src="../../docs/diagrams/phonemes/latin/joined-folded-vowel.svg" alt="Railroad diagram of the rule joined-folded-vowel"></details>
<details><summary>Railroad diagram of <code>folded-vowel</code></summary><img src="../../docs/diagrams/phonemes/latin/folded-vowel.svg" alt="Railroad diagram of the rule folded-vowel"></details>

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

<details><summary>Railroad diagram of <code>plain-vowel</code></summary><img src="../../docs/diagrams/phonemes/latin/plain-vowel.svg" alt="Railroad diagram of the rule plain-vowel"></details>
<details><summary>Railroad diagram of <code>stressed-vowel</code></summary><img src="../../docs/diagrams/phonemes/latin/stressed-vowel.svg" alt="Railroad diagram of the rule stressed-vowel"></details>
<details><summary>Railroad diagram of <code>stress-mark</code></summary><img src="../../docs/diagrams/phonemes/latin/stress-mark.svg" alt="Railroad diagram of the rule stress-mark"></details>
<details><summary>Railroad diagram of <code>glide-mark</code></summary><img src="../../docs/diagrams/phonemes/latin/glide-mark.svg" alt="Railroad diagram of the rule glide-mark"></details>

## Digits

The working morphology reads a digit as a member of PA, the number word it stands for, and lets a digit stand inside a name. This grammar emits a digit as the letters of its word, so `2` is `re`. CLL does not write digits. A period between two digits is the decimal point, `pi`. `items` says that no pause stands there, and the decimal point needs a digit before it, so `la .djan.2mei` has a pause after `djan`.

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

<details><summary>Railroad diagram of <code>items</code></summary><img src="../../docs/diagrams/phonemes/latin/items.svg" alt="Railroad diagram of the rule items"></details>
<details><summary>Railroad diagram of <code>non-vowel</code></summary><img src="../../docs/diagrams/phonemes/latin/non-vowel.svg" alt="Railroad diagram of the rule non-vowel"></details>
<details><summary>Railroad diagram of <code>non-vowels</code></summary><img src="../../docs/diagrams/phonemes/latin/non-vowels.svg" alt="Railroad diagram of the rule non-vowels"></details>
<details><summary>Railroad diagram of <code>any-lojban-char</code></summary><img src="../../docs/diagrams/phonemes/latin/any-lojban-char.svg" alt="Railroad diagram of the rule any-lojban-char"></details>
<details><summary>Railroad diagram of <code>digit</code></summary><img src="../../docs/diagrams/phonemes/latin/digit.svg" alt="Railroad diagram of the rule digit"></details>
<details><summary>Railroad diagram of <code>digit-0</code></summary><img src="../../docs/diagrams/phonemes/latin/digit-0.svg" alt="Railroad diagram of the rule digit-0"></details>
<details><summary>Railroad diagram of <code>digit-1</code></summary><img src="../../docs/diagrams/phonemes/latin/digit-1.svg" alt="Railroad diagram of the rule digit-1"></details>
<details><summary>Railroad diagram of <code>digit-2</code></summary><img src="../../docs/diagrams/phonemes/latin/digit-2.svg" alt="Railroad diagram of the rule digit-2"></details>
<details><summary>Railroad diagram of <code>digit-3</code></summary><img src="../../docs/diagrams/phonemes/latin/digit-3.svg" alt="Railroad diagram of the rule digit-3"></details>
<details><summary>Railroad diagram of <code>digit-4</code></summary><img src="../../docs/diagrams/phonemes/latin/digit-4.svg" alt="Railroad diagram of the rule digit-4"></details>
<details><summary>Railroad diagram of <code>digit-5</code></summary><img src="../../docs/diagrams/phonemes/latin/digit-5.svg" alt="Railroad diagram of the rule digit-5"></details>
<details><summary>Railroad diagram of <code>digit-6</code></summary><img src="../../docs/diagrams/phonemes/latin/digit-6.svg" alt="Railroad diagram of the rule digit-6"></details>
<details><summary>Railroad diagram of <code>digit-7</code></summary><img src="../../docs/diagrams/phonemes/latin/digit-7.svg" alt="Railroad diagram of the rule digit-7"></details>
<details><summary>Railroad diagram of <code>digit-8</code></summary><img src="../../docs/diagrams/phonemes/latin/digit-8.svg" alt="Railroad diagram of the rule digit-8"></details>
<details><summary>Railroad diagram of <code>digit-9</code></summary><img src="../../docs/diagrams/phonemes/latin/digit-9.svg" alt="Railroad diagram of the rule digit-9"></details>
<details><summary>Railroad diagram of <code>decimal-point</code></summary><img src="../../docs/diagrams/phonemes/latin/decimal-point.svg" alt="Railroad diagram of the rule decimal-point"></details>
