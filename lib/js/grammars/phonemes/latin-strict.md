# The Latin orthography of CLL

This document opens the phoneme stage, the first stage of every Lojban dialect: [CLL](../dialects/cll-ebnf.md), [approved word forms](../dialects/bpfk.md), [experimental](../dialects/experimental.md) and [Zantufa](../dialects/zantufa.md). The stage reads the characters of a text and hands the word stage the phonemes they stand for. This document reads the Latin orthography of CLL chapter 3 and no more. The CLL dialect uses it as it is. The other dialects add the conventions of [latin.md](latin.md), such as digits and accents, and the scripts of [cyrillic.md](cyrillic.md) and [zbalermorna.md](zbalermorna.md). The notation is explained in [the notation document](../../docs/notation.md).

The terminals of the stage are characters, each written in straight quotes. Every character token also carries its class, `alpha`, `digit`, `space`, `mark` or `other`. The stage emits one token per phoneme, and each token carries that phoneme's tag. So the word grammar never sees a character, and it reads every script alike.

The phonemes are the letters of CLL chapter 3, each written as a phoneme tag:

- the consonants `/b/`, `/c/`, `/d/` and so on through `/z/`
- the vowels `/a/ /e/ /i/ /o/ /u/ /y/`, and the stressed vowels `/A/ /E/ /I/ /O/ /U/ /Y/`
- the apostrophe `/'/`
- the syllable break `/,/`, which a comma between two vowels writes.

A stressed vowel is a phoneme of its own, so stress is a position in the word grammar and not a mark it tests. Two tags stand for what is not a letter. `PAUSE` is a pause of any length, and it also carries the phoneme tag `/./`, whose phoneme is `.`. `FOREIGN` is a run of text that is not Lojban at all, which the word grammar admits only inside a foreign quote.

## The text and its runs

The text is pauses and runs. CLL 3.1 writes a pause as a period. This grammar also reads whitespace as a pause, since a text writes a space between two words. That is a rule of gencmu, not of CLL, which never says what a space is. Its cost is small: a space always ends a word, and no word of CLL has a space inside it. A run is what stands between two pauses. It is an ordinary run of letters, or a foreign run. The stage is greedy: where two parses differ, it takes the one that reads the next character over the one that closes a constituent. So a run is never cut short where a rule would let it continue.

```jbogenbau
%ambiguity-resolution greedy
```

```jbogenbau
%rule text
  ε | pause | items | edge-pause items | items edge-pause | edge-pause items edge-pause

%rule edge-pause
  spaced-pause | pause-edge

%rule items
  run | items pause run

%rule run
  ordinary-run | foreign-run
```

A pause is one token. Its core is a run of whitespace characters and periods, with any commas inside it. A comma next to the core is part of the pause, but it belongs to no token. So `mi , klama` has one pause between its two words, and a quote body next to such a comma takes it in. CLL 3.3 says that a comma "cannot be pronounced as a pause", so a comma alone between two words is no pause. A comma at the start or the end of the text belongs to no token.

```jbogenbau
%rule pause
  spaced-pause

%rule spaced-pause
  | $c(pause-core)
  | pause-edge $c(pause-core)
  | $c(pause-core) pause-edge
  | pause-edge $c(pause-core) pause-edge
%emits
  $c <"PAUSE" ∪ /./>

%rule pause-core
  core-char | pause-core core-char | pause-core pause-edge core-char

%rule pause-edge
  commas

%rule core-char
  "space" | "."

%rule commas
  comma | commas comma
```

An ordinary run is letters. A run of adjacent vowel letters is one vowel group, and a group carries the tags of its last vowel. In the Latin orthography a group is simply its vowels, one phoneme each. A script that writes no apostrophe tags its full vowel letters `syllabic`. Two adjacent syllabic vowels are two syllables with the apostrophe between them, which `joined-vowel` emits as a `/'/` token with no text of its own. That is the one thing the frame knows about such scripts, and [cyrillic.md](cyrillic.md) is the one that uses it. Each vowel of a group is its own token, so a group of three vowels keeps all three. The group rules keep adjacent vowels in one group, and every pair falls under exactly one of the three cases. So a run has one parse.

A comma stands only between two letters of a run. Between two vowels it is the syllable break of CLL 3.3, the phoneme `/,/`. So `kore,a` is `e` and `a` in two syllables. CLL 4.8 writes it so "because ea is not a valid diphthong". Anywhere else it is nothing, so `ban,gu` is `bangu`.

```jbogenbau
%rule ordinary-run
  letters

%rule letters
  letters-after-consonant | letters-after-vowel

%rule letters-after-vowel
  | vowel-group
  | letters-after-consonant [commas] vowel-group
  | letters-after-vowel syllable-break vowel-group

%rule letters-after-consonant
  | non-vowels
  | letters-after-vowel [commas] non-vowels

%rule non-vowels
  non-vowel | non-vowels non-vowel | non-vowels commas non-vowel

%rule non-vowel
  consonant | apostrophe

%rule syllable-break
  commas
%emits
  $ </,/>

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
  $g(vowel-group) $v(joined-vowel) <tags($v)>
%conditions
  "syllabic" ∈ tags($g),
  "syllabic" ∈ tags($v)

%rule joined-vowel
  $v(vowel) <tags($v)>
%emits
  /'/, $v

%rule any-lojban-char
  consonant | plain-vowel | stressed-vowel | apostrophe | comma
```

A run that is not an ordinary run is foreign. It has a letter, a digit, a mark or any other character that this orthography does not read, as `mi klama?` has. A foreign run is emitted as one `FOREIGN` token. Its phonemes are its text, since the rule is `%verbatim`. So a `zoi` delimiter matches the word `gqy` in a body only if it is `gqy` itself. A foreign run has at least one character that no letter rule of any script reads by itself. A run without one is always read by `letters`. So only a run with one is tested, and a long run of letters costs nothing more. A run neither begins nor ends with a comma, which is part of the pause next to it.

```jbogenbau
%rule foreign-run
  $r(foreign-chars)
%conditions
  ¬matches($r, letters),
  ¬matches(head($r), comma),
  ¬matches(last($r), comma)
%emits
  $ <"FOREIGN">
%verbatim

%rule foreign-chars
  | foreign-char
  | lojban-chars foreign-char
  | foreign-chars run-char

%rule lojban-chars
  lojban-char | lojban-chars lojban-char

%rule lojban-char
  $c(run-char)
%conditions
  matches($c, any-lojban-char)

%rule foreign-char
  $c(run-char)
%conditions
  ¬matches($c, any-lojban-char)

%rule run-char
  $c(run-class)
%conditions
  ¬matches($c, core-char)

%rule run-class
  "alpha" | "digit" | "mark" | "other"
```

## Letters

A consonant is emitted as itself whatever its case. CLL 3.9 writes a stressed syllable of a name in capitals, but only the capital vowel marks the stress. A capital vowel is the stressed phoneme. The apostrophe is the phoneme `/'/`. The letter `h` is the same phoneme: it is the capital apostrophe in every dialect here. The typographic forms of the apostrophe are the same phoneme too, since they are the same character in another font.

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
  "a" </a/> | "e" </e/> | "i" </i/> | "o" </o/> | "u" </u/> | "y" </y/>
%emits
  $

%rule stressed-vowel
  "A" </A/> | "E" </E/> | "I" </I/> | "O" </O/> | "U" </U/> | "Y" </Y/>
%emits
  $

%rule apostrophe
  "'" | "’" | "‘" | "h" | "H" | "ʼ"
%emits
  $ </'/>

%rule comma
  ","
```
