# The word stream

This document opens the word stage, the second stage of every Lojban dialect: [CLL](../dialects/cll-ebnf.md), [approved word forms](../dialects/bpfk.md), [experimental](../dialects/experimental.md) and [Zantufa](../dialects/zantufa.md). The stage reads the phonemes the phoneme stage emitted and hands the indicator stage the words of the text, each tagged with its class: `word` on every word, `cmavo`, `BRIVLA` or `CMEVLA` by its shape, and every selma'o the lexicon document stitched into this stage gives it. This document contributes the stream of words and the magic words of CLL 19, the constructs that act on the word stream before the syntax sees it: the quotes `zo`, `ma'oi`, `zoi`, `la'o`, `mu'oi`, `lo'u ... le'u`, `zo'oi` and its relatives, the compounders `bu` and `zei`, the erasers `si`, `sa` and `su`, hesitation, and `fa'o`. They are resolved together, in one grammar, because they act strictly left to right on one stream: `merko zei zo` is a `zei` compound whose second word is `zo`, since `zei` took the word before any quote could form, and `fa fe si bu zei fi` erases `fe`, makes `fa bu`, and compounds it with `fi`. The two erasers that reach back over many words, `sa` and `su`, are resolved in the same pass, since they act in the same order.

What a word looks like is not decided here. This document is stitched into the word stage with [shapes.md](shapes.md), the word shapes every family shares; with one family document, [cll.md](cll.md) for chapter 4 of *The Complete Lojban Language* as printed or [bpfk.md](bpfk.md) for the definition effort's approved word-form grammar, which defines the three shapes this grammar reads, `cmavo-shape`, `brivla-shape` and `cmevla-shape`, and tags each with its pause properties; and with one lexicon, [lexicon-cll.md](lexicon-cll.md) or [lexicon-experimental.md](lexicon-experimental.md), which gives each cmavo its selma'o. The notation is explained in [the notation document](../../docs/notation.md), and the stage's choice among parses, at the end of this document, is the mirror of the syntax stage's.

## The stream of elements

The text is a stream of elements, an element being a word, a quote package, a `bu` or `zei` compound, an erasure, or hesitation, and the pauses between them. CLL 4.9 gives the rules for pauses, which this section states as properties every element carries as tags, decided by the word shapes of the family document. An element has `onset` when it may follow another element without a pause: it begins with a consonant, and is not a cmevla, which rule 4 surrounds with pauses. An element is `continued` when another element may follow it without a pause: a cmavo, a compound, a brivla whose stress is marked, but not an unmarked brivla, which by 3.9 reaches the next pause, nor a cmevla, nor a quote that ends in a delimiter. The stream is left-recursive and carries the tags of its last element, so each rule below joins one more element to what precedes it.

Two families state one more rule each through tags of their own. Under CLL, a `Cy` letter cmavo is `cy` rather than `continued`: rule 6 lets only another `Cy` follow it directly, which is what keeps `desygau` one lujvo and not `de sy gau`; written usage has `fyno` for `fy no` often enough that a `Cy` beginning its stretch after a pause is treated as continued. Under the definition effort's grammar a `Cy` is an ordinary continued cmavo, and instead an unstressed CV cmavo, tagged `cv`, directly followed by a `Cy`, tagged `y-letter`, and then directly by a brivla is read as one lujvo with a y-hyphen, `bajykla`, never as `ba jy kla`: the stream after such a pair is tagged `cvcy`, and neither a brivla nor a short final rafsi such as the `bau` of `lobybau` may follow it without a pause. A family that uses neither rule tags nothing, and the alternatives that mention those tags never apply.

The stage is lazy: where two parses differ, it takes the one that closes a constituent over the one that reads the next phoneme, so a word ends as early as the grammar allows, which is CLL's tosmabru rule. "Choosing among parses" at the end of this document says why.

```jbogenbau
%ambiguity-resolution lazy
```

```jbogenbau
%rule text
  | ε | PAUSE
  | [PAUSE] body | [PAUSE] body PAUSE
  | [PAUSE] $b(body) PAUSE hesitation | [PAUSE] $b(body) PAUSE hesitation PAUSE
  | [PAUSE] faho-group | [PAUSE] body PAUSE faho-group
%conditions
  "stream-end" ∉ tags($b)

%rule body
  | $t(body-tail) <tags($t)>
  | stray-si
  | $y(stray-si) $g(gap) $z(body-tail) <"stream-end" ∩ tags($z)>
%conditions
  "first-onset" ∈ tags($z) ∨ phonemes($g) = ".",
  "first-cy" ∉ tags($z) ∨ phonemes($g) = "."

%rule body-tail
  | $a(stream) <("first-onset" ∪ "first-cy") ∩ tags($a) ∪ "stream-end">
  | @sa-su? sa-run <"first-onset">
  | @sa-su? $b(wiped) <("first-onset" ∪ "first-cy") ∩ tags($b)>
  | @sa-su? $w(wiped) $g(gap) $v(stream) <("first-onset" ∪ "first-cy") ∩ tags($w) ∪ "stream-end">
  | @sa-su? $s(stream) $h(gap) sa-run <("first-onset" ∪ "first-cy") ∩ tags($s)>
  | @sa-su? $x(wiped) $h(gap) sa-run <("first-onset" ∪ "first-cy") ∩ tags($x)>
  | @sa-su? $w(wiped) $g(gap) $v(stream) $h(gap) sa-run <("first-onset" ∪ "first-cy") ∩ tags($w)>
%conditions
  "continued" ∈ tags($w) ∨ phonemes($g) = ".",
  "first-onset" ∈ tags($v) ∨ phonemes($g) = ".",
  "first-cy" ∉ tags($v) ∨ phonemes($g) = ".",
  "continued" ∈ tags($s) ∨ phonemes($h) = ".",
  "continued" ∈ tags($x) ∨ phonemes($h) = ".",
  "continued" ∈ tags($v) ∨ phonemes($h) = "."

%rule gap
  ε | PAUSE

%rule stream
  | $e(opener) <tags($e)>
  | $c(opener) <tags($c) ∪ "continued">
  | $s(stream) PAUSE $e(element) <tags($e) ∪ classes($s) ∪ ("first-onset" ∪ "first-cy") ∩ tags($s)>
  | $s(stream) PAUSE $c(element)
      <tags($c) ∪ "continued" ∪ classes($s) ∪ ("first-onset" ∪ "first-cy") ∩ tags($s)>
  | $t(stream) $f(element) <tags($f) ∪ classes($t) ∪ ("first-onset" ∪ "first-cy") ∩ tags($t)>
  | $u(stream) $g(element) <tags($g) ∪ classes($u) ∪ ("first-onset" ∪ "first-cy") ∩ tags($u)>
  | $a(stream) $b(element)
      <tags($b) ∪ "cvcy" ∪ classes($a) ∪ ("first-onset" ∪ "first-cy") ∩ tags($a)>
  | $a(stream) $d(element) <tags($d) ∪ classes($a) ∪ ("first-onset" ∪ "first-cy") ∩ tags($a)>
  | $x(stream) $z(element) <tags($z) ∪ classes($x) ∪ ("first-onset" ∪ "first-cy") ∩ tags($x)>
%conditions
  "cy" ∉ tags($e),
  "cy" ∈ tags($c),
  "continued" ∈ tags($t),
  "onset" ∈ tags($f),
  "cv" ∉ tags($t),
  "cvcy" ∉ tags($t),
  "cy" ∉ tags($t) ∨ "cy" ∉ tags($f),
  "cy" ∈ tags($u),
  "cy" ∈ tags($g),
  "continued" ∈ tags($a),
  "cv" ∈ tags($a),
  "onset" ∈ tags($b),
  "y-letter" ∈ tags($b),
  "onset" ∈ tags($d),
  "y-letter" ∉ tags($d),
  "cvcy" ∈ tags($x),
  "onset" ∈ tags($z),
  "BRIVLA" ∉ tags($z),
  ¬matches($z, lujvo-final-shape)

%rule opener
  | $o(element) <tags($o) ∪ "first-onset">
  | $k(element) <tags($k) ∪ "first-onset" ∪ "first-cy">
  | $p(element) <tags($p)>
%conditions
  "onset" ∈ tags($o),
  ("cy" ∪ "y-letter") ∩ tags($o) = ∅,
  "onset" ∈ tags($k),
  ("cy" ∪ "y-letter") ∩ tags($k) ≠ ∅,
  "onset" ∉ tags($p)

%rule element
  unit | erasure | hesitation

%rule unit
  word | quote | lerfu-word | zei-compound | @sa-su? sa-erasure | @sa-su? su-erasure
```

Hesitation after a final pause belongs to the stream when the body ends in one, since an element may always follow a pause; the text's own `PAUSE hesitation` is for a body that ends in an erasure, which is not a stream. `stream-end` is the tag that tells the two apart, so that a trailing `.y.` has one reading.

The joins are stated so that no two apply to the same pair: two `Cy` letter words side by side are joined by the `Cy` rule alone, which is why the general join, a continued element followed by an onset, leaves that case to it. Two joins that both applied would be two parses of one text that differ in nothing the next stage sees, and the stage would report them as a tie.

Besides the tags of its last element, the stream carries what a rule reaching back over it needs: `first-onset`, when its first element may follow another without a pause, which is what joins a reach to the element before it; `first-cy`, when that element is a `Cy` letter, which under CLL may follow another word directly only if another `Cy` follows it and under the definition effort's grammar would make a lujvo with a CV word before it, so that a join without a pause refuses it and `sutyterjvi` stays one lujvo in both; and the union of the selma'o of every element in it, which is what tells a `sa` that nothing in its reach matches. `gap` is an optional pause; where the rules below join two parts across one, the condition says that either the pause is there or the two parts may stand together without it.

A `si` with nothing before it erases nothing (CLL 19.13 says what `si` erases, not that there must be something to erase), and so does a run of them, whether at the start of the text, after hesitation there, after an erasure that has already taken everything before it, or after an unmatched `sa` or `su` that has.

```jbogenbau
%rule stray-si
  si-run | hesitations si-gap si-run | erasure [si-gap] si-run | @sa-su? wiped [si-gap] si-run
%emits
  ε

%rule si-run
  si-word | si-run [si-gap] si-word
```

Hesitation, `y` however long, is not a word of the text (CLL 19.14) and is dropped, except directly before `bu`, where it is the base of the letter word `.y bu`. It begins with a vowel, so a pause precedes it (CLL 4.9 rule 3), and it may be followed by a word directly.

```jbogenbau
%rule hesitation
  y-run <"continued">
%emits
  ε

%rule y-run
  y | y y-run
```

A `y` here is either phoneme of the letter, plain or stressed, since hesitation and the letter word `y bu` may be written with either.

```jbogenbau
%rule y
  /y/ | /Y/
```

`fa'o` ends the text (CLL 19.15): whatever follows it is not read and is not handed on, so the group emits nothing.

```jbogenbau
%rule faho-group
  faho-word | faho-word PAUSE | faho-word PAUSE zoi-body

%rule faho-word
  $q(magic-body)
%conditions
  "FAhO" ∈ classes($q)
```

## Words

A word is a cmavo, a brivla or a cmevla; what shapes each has is the business of the family document, `cll.md` or `bpfk.md`, which defines `cmavo-shape`, `brivla-shape` and `cmevla-shape` and tags each with its pause properties. A word is emitted as one token carrying `word`, its kind, those properties, and the classes the lexicon gives it: `tags($c, lexicon)` parses the cmavo's phonemes against the lexicon rules, which is where its selma'o come from, so a cmavo unknown to the lexicon is still a word, as `zo` needs it to be, but a word of no class. A name is always `CMEVLA`; the cmevla-brivla merger of the experimental grammars is a matter of syntax, stated there with the `cbm` guard, not a second class on the word. The magic words are never plain words: the rules under "Quotes", "Compounds" and "Erasure" say what each does instead, and the condition here keeps them out, so that `zo` cannot be read as a word standing beside the word it quotes.

```jbogenbau
%rule word
  | @sa-su? $c(cmavo-shape) <"word" ∪ "cmavo" ∪ tags($c) ∪ tags($c, lexicon)>
  | @¬sa-su? $e(cmavo-shape) <"word" ∪ "cmavo" ∪ tags($e) ∪ tags($e, lexicon)>
  | $b(brivla-shape) <"word" ∪ "BRIVLA" ∪ tags($b)>
  | cmevla-shape <"word" ∪ "CMEVLA">
%conditions
  tags($c, lexicon) ∩ ("ZO" ∪ "ZOI" ∪ "LOhU" ∪ "ZOhOI" ∪ "LAhOI" ∪ "RAhOI" ∪ "MEhOI" ∪ "GOhOI" ∪ "ZEhOI" ∪ "TAhAI" ∪ "BOhEI" ∪
    "FAhO" ∪ "BU" ∪ "ZEI" ∪ "SI" ∪ "SA" ∪ "SU") = ∅,
  tags($e, lexicon) ∩ ("ZO" ∪ "ZOI" ∪ "LOhU" ∪ "ZOhOI" ∪ "LAhOI" ∪ "RAhOI" ∪ "MEhOI" ∪ "GOhOI" ∪ "ZEhOI" ∪ "TAhAI" ∪ "BOhEI" ∪
    "FAhO" ∪ "BU" ∪ "ZEI" ∪ "SI") = ∅
%emits
  $
```

The family document also defines `plain-cmavo-body`, the shape of a cmavo that begins with a consonant, which the magic words all have. The rules below know a magic word by the selma'o the lexicon gives it, not by its spelling: a cmavo's stress is free (CLL 3.9), and the lexicon reads a stressed vowel as the plain one, so `zO` quotes as `zo` does; and the dialect's lexicon decides which words are magic, so `ma'oi` and `zo'oi`, which CLL does not have, are quote words only where the experimental lexicon gives them their classes.

```jbogenbau
%rule magic-body
  $w(plain-cmavo-body) <tags($w, lexicon)>
```

## Quotes

CLL 19.10 to 19.13. A quote is decided at this stage because the words inside it are not read as words: `zo si` quotes `si`, and a `zoi` body is not Lojban at all. Each quote hands the syntax stage its marker, carrying the selma'o the lexicon gives it and nothing else, so that a marker which is also an attitudinal in a lexicon, as `zo'oi` is in the experimental one, is never taken for an indicator, and its contents as bare words or as one stretch of `foreign-text`, which is what the syntax grammar's `any-word` and `anything` read. The quotes that take a run of characters or a delimited body end their stretch, since the quoted run or the closing delimiter must be followed by a pause; a quoted single word is continued exactly as that word would be.

```jbogenbau
%rule quote
  quoted-word | zoi-quote | empty-zoi-quote | lohu-quote | single-word-quote
```

`zo` and `ma'oi` quote the next word, whatever it is, except hesitation, which is not a word: `zo y co` quotes `co`, and `zo .y'y.` quotes the letter word. The quoted word ends where that word ends, so a quoted brivla runs on into the next word only when its stress is marked, exactly as an unquoted one, which the tags of the word constituent already say. A cmevla is surrounded by pauses (CLL 4.9 rule 4), quoted or not, so a quoted cmevla ends its stretch and needs a pause before it: `zo n` is no quote in `amazon`. CLL 4.9 rule 3 holds inside a quote too: a quoted word that begins with a vowel needs a pause before it, so `zoi` is never `zo` and `.i`.

```jbogenbau
%rule quoted-word
  | $m(word-quote-marker) quote-gap $w(quotable-word)
      <tags($m) ∪ "onset" ∪ ("continued" ∪ "cy" ∪ "y-letter" ∪ "cv") ∩ tags($w)>
  | $m(word-quote-marker) pause-gap $v(quotable-word)
      <tags($m) ∪ "onset" ∪ ("continued" ∪ "cy" ∪ "y-letter" ∪ "cv") ∩ tags($v)>
  | $m(word-quote-marker) pause-gap $n(cmevla-shape) <tags($m) ∪ "onset">
%conditions
  "onset" ∈ tags($w),
  "onset" ∉ tags($v)
%emits
  $m, $w <"word">, $v <"word">, $n <"word">

%rule word-quote-marker
  $q(magic-body) <"word" ∪ "cmavo" ∪ classes($q)>
%conditions
  "ZO" ∈ classes($q)

%rule quotable-word
  $c(cmavo-shape) <tags($c)> | $b(brivla-shape) <tags($b)>
```

`zo'oi` and its relatives quote the next run of characters up to a pause. `zoi`, `la'o` and `mu'oi` quote a body between two delimiter words: the two delimiters must be the same word, and that word may not occur as a word of the body, so the quote ends at its first occurrence. That is the condition the captures state, and it is checked as the parse advances, so a candidate close that is not the opener never opens a continuation of the text. A quote whose delimiters stand side by side quotes nothing, and hands the syntax an empty stretch of foreign text so that its shape is the same as any other's; a letter word such as `ibu` is one word and may serve as a delimiter.

```jbogenbau
%rule single-word-quote
  $m(single-marker) quote-gap $r(non-pause-run) <tags($m) ∪ "onset">
%emits
  $m, $r <"foreign-text">

%rule single-marker
  $q(magic-body) <"word" ∪ "cmavo" ∪ classes($q)>
%conditions
  classes($q) ∩ ("ZOhOI" ∪ "LAhOI" ∪ "RAhOI" ∪ "MEhOI" ∪ "GOhOI" ∪ "ZEhOI" ∪ "TAhAI" ∪ "BOhEI") ≠ ∅

%rule zoi-quote
  | $m(zoi-marker) quote-gap $open(delimiter) PAUSE $content(zoi-body) PAUSE $close(delimiter)
  | $m(zoi-marker) pause-gap $o(delimiter) PAUSE $content(zoi-body) PAUSE $close(delimiter)
%tags
  tags($m) ∪ "onset"
%conditions
  phonemes($open) = phonemes($close),
  phonemes($open) ∉ words($content),
  "onset" ∈ tags($open),
  phonemes($o) = phonemes($close),
  phonemes($o) ∉ words($content),
  "onset" ∉ tags($o)
%emits
  $m, $open <"word">, $o <"word">, $content <"foreign-text">, $close <"word">

%rule empty-zoi-quote
  | $m(zoi-marker) quote-gap $open(delimiter) PAUSE $close(delimiter)
  | $m(zoi-marker) pause-gap $o(delimiter) PAUSE $close(delimiter)
%tags
  tags($m) ∪ "onset"
%conditions
  phonemes($open) = phonemes($close),
  "onset" ∈ tags($open),
  phonemes($o) = phonemes($close),
  "onset" ∉ tags($o)
%emits
  $m, $open <"word">, $o <"word">, "foreign-text", $close <"word">

%rule delimiter
  | $c(cmavo-shape) <tags($c)>
  | $b(brivla-shape) <tags($b)>
  | cmevla-shape <∅>
  | $l(lerfu-word) <tags($l)>

%rule zoi-marker
  $q(magic-body) <"word" ∪ "cmavo" ∪ classes($q)>
%conditions
  "ZOI" ∈ classes($q)
```

Inside `lo'u ... le'u` the words are ordinary words under the pause rules of CLL 4.9, but no quote marker opens anything and no eraser erases, so a `lo'u` stretch is a stream of bare word shapes joined by the same rules as the stream of the text; the quote ends at the first `le'u`, and it may be empty, `lo'u le'u`, as a `zoi` quote may. The words inside are handed on as bare words, and the markers as `LOhU` and `LEhU`; the closing marker is handed on as `LEhU` alone, not also as a word, so that the syntax cannot read it as one more quoted word and look for a later `le'u`.

```jbogenbau
%rule lohu-quote
  | $m(lohu-marker) PAUSE $content(lohu-stream) PAUSE $e(lehu-marker)
  | $m(lohu-marker) [PAUSE] $e(lehu-marker)
%tags
  tags($m) ∪ "onset" ∪ "continued"

%rule lohu-marker
  $q(magic-body) <"word" ∪ "cmavo" ∪ classes($q)>
%conditions
  "LOhU" ∈ classes($q)
%emits
  $

%rule lehu-marker
  $q(magic-body) <"word" ∪ "cmavo" ∪ classes($q)>
%conditions
  "LEhU" ∈ classes($q)
%emits
  $ <"LEhU">

%rule lohu-stream
  | $e(lohu-word) <tags($e)>
  | $c(lohu-word) <tags($c) ∪ "continued">
  | $s(lohu-stream) PAUSE $e(lohu-word) <tags($e)>
  | $s(lohu-stream) PAUSE $c(lohu-word) <tags($c) ∪ "continued">
  | $t(lohu-stream) $f(lohu-word) <tags($f)>
  | $u(lohu-stream) $g(lohu-word) <tags($g)>
%conditions
  "cy" ∉ tags($e),
  "cy" ∈ tags($c),
  "continued" ∈ tags($t),
  "onset" ∈ tags($f),
  "cy" ∈ tags($u),
  "cy" ∈ tags($g)

%rule lohu-word
  | $c(cmavo-shape) <tags($c)>
  | $b(brivla-shape) <tags($b)>
  | cmevla-shape <∅>
  | y-run <"continued">
%conditions
  "LEhU" ∉ tags($c, lexicon)
%emits
  $ <"word">
```

The gap between a marker and its word is an optional pause, with hesitation allowed inside it; a word that begins with a vowel needs the pause. A quoted body is any run of phonemes, pauses included, which is where a character that is not Lojban at all may appear; the phonemes are listed here, since the body is the one place a grammar reads them without regard to what they spell.

```jbogenbau
%rule quote-gap
  [PAUSE] | [PAUSE] hesitations PAUSE | [PAUSE] hesitations

%rule pause-gap
  PAUSE | [PAUSE] hesitations PAUSE

%rule hesitations
  y-run | hesitations PAUSE y-run

%rule zoi-body
  any-char | zoi-body any-char

%rule non-pause-run
  non-pause-char | non-pause-char non-pause-run

%rule any-char
  non-pause-char | PAUSE

%rule non-pause-char
  | /a/ | /e/ | /i/ | /o/ | /u/ | /A/ | /E/ | /I/ | /O/ | /U/ | y | /'/ | FOREIGN
  | /b/
  | /c/
  | /d/
  | /f/
  | /g/
  | /j/
  | /k/
  | /l/
  | /m/
  | /n/
  | /p/
  | /r/
  | /s/
  | /t/
  | /v/
  | /x/
  | /z/
```

## Compounds

CLL 17.4 and 4.6: any word followed by `bu` is a letter word, which counts as a `BY` when `sa` looks for a match, and any two words joined by `zei` are one brivla. The operand of `bu` and the left operand of `zei` are whatever the stream has already produced, a word, a quote or a compound, since the operators act on what exists when they are read; a `si` erasure may sit between an operand and its operator, because the erased word is no longer there for the operator to see. The right operand of `zei` is the next word whatever it is, a quote marker or an eraser included, which is why `merko zei zo` is a compound: the word was taken before it could act. A compound is one word (CLL 4.6, 17.4) and is handed on as one token, a `BY` for `bu` and a `BRIVLA` for `zei`, which the syntax grammar reads as it reads any letter word or brivla; its printed rules `any-word BU` and `any-word ZEI any-word` are kept there for fidelity and never match.

```jbogenbau
%rule lerfu-word
  | $u(unit) $b(bu-word) <"word" ∪ "BY" ∪ "continued" ∪ "onset" ∩ tags($u)>
  | $c(unit) $b(bu-word) <"word" ∪ "BY" ∪ "continued" ∪ "onset" ∩ tags($c)>
  | $v(unit) PAUSE $b(bu-word) <"word" ∪ "BY" ∪ "continued" ∪ "onset" ∩ tags($v)>
  | $u(unit) $g(gap-erasures) $b(bu-word) <"word" ∪ "BY" ∪ "continued" ∪ "onset" ∩ tags($u)>
  | $v(unit) PAUSE $h(gap-erasures) $b(bu-word) <"word" ∪ "BY" ∪ "continued" ∪ "onset" ∩ tags($v)>
  | $y(y-base) [PAUSE] $b(bu-word) <"word" ∪ "BY" ∪ "continued">
%conditions
  "continued" ∈ tags($u),
  "cy" ∈ tags($c),
  "onset" ∈ tags($g)
%emits
  $

%rule y-base
  y-run

%rule bu-word
  $q(magic-body)
%conditions
  "BU" ∈ classes($q)

%rule zei-compound
  | $l(unit) $z(zei-word) $r(zei-right)
      <"word" ∪ "BRIVLA" ∪ "onset" ∩ tags($l) ∪ ("continued" ∪ "cy" ∪ "y-letter") ∩ tags($r)>
  | $k(unit) PAUSE $z(zei-word) $r(zei-right)
      <"word" ∪ "BRIVLA" ∪ "onset" ∩ tags($k) ∪ ("continued" ∪ "cy" ∪ "y-letter") ∩ tags($r)>
  | $l(unit) $z(zei-word) PAUSE $p(zei-right)
      <"word" ∪ "BRIVLA" ∪ "onset" ∩ tags($l) ∪ ("continued" ∪ "cy" ∪ "y-letter") ∩ tags($p)>
  | $k(unit) PAUSE $z(zei-word) PAUSE $p(zei-right)
      <"word" ∪ "BRIVLA" ∪ "onset" ∩ tags($k) ∪ ("continued" ∪ "cy" ∪ "y-letter") ∩ tags($p)>
  | $l(unit) $g(gap-erasures) $z(zei-word) $r(zei-right)
      <"word" ∪ "BRIVLA" ∪ "onset" ∩ tags($l) ∪ ("continued" ∪ "cy" ∪ "y-letter") ∩ tags($r)>
  | $k(unit) PAUSE $h(gap-erasures) $z(zei-word) $r(zei-right)
      <"word" ∪ "BRIVLA" ∪ "onset" ∩ tags($k) ∪ ("continued" ∪ "cy" ∪ "y-letter") ∩ tags($r)>
%conditions
  "continued" ∈ tags($l),
  "onset" ∈ tags($r),
  "onset" ∈ tags($g)
%emits
  $

%rule zei-word
  $q(magic-body)
%conditions
  "ZEI" ∈ classes($q)

%rule zei-right
  $c(cmavo-shape) <tags($c)> | $b(brivla-shape) <tags($b)> | cmevla-shape <∅> | y-run <"continued">

%rule gap-erasures
  | $e(erasure) <tags($e)>
  | $g(gap-erasures) PAUSE $e(erasure) <tags($g)>
  | $h(gap-erasures) $f(erasure) <tags($h)>
  | $g(gap-erasures) PAUSE <tags($g)>
%conditions
  "onset" ∈ tags($f)
```

The pause between an operand and its operator is stated where it matters: a `bu` may follow its word directly only if the word is continued, or is a `Cy` letter cmavo, since `xybu` is the usual way to write that letter word; a `zei` may follow directly only a continued word; a pause is always allowed. The erasures that may stand between them obey the same pause rules, joined through the tags of the first erasure, and an erasure is always continued, so what follows a run of them needs no pause. The word after `zei` follows it directly or after a pause. A compound may follow the word before it without a pause exactly when its first word may, which is what the `onset` in its tags records; `.abu` needs the pause before it that `a` needs.

## Erasure by `si`

CLL 19.13: `si` erases the word before it, a compound or a quote counting as one word, and a run of `si` erases as many words: `broda brode si si` erases both, which the rule states as an erasure whose unit is followed by one or more erasures and then the `si` that erases the unit; `klama co si gunka si si` erases `co`, then `gunka`, then `klama`. Hesitation may stand between the word and its `si`, since it is not a word, and `co .y. si` erases `co`. An erased stretch emits nothing. What a `sa` or `su` leaves standing is a unit, so a following `si` erases it, and a `sa` or `su` with nothing to act on is itself a word that `si` erases: `le broda sa si` is `le broda`.

```jbogenbau
%rule erasure
  | $u(unit) $s(si-word) <"onset" ∩ tags($u) ∪ "continued">
  | $v(unit) si-gap $s(si-word) <"onset" ∩ tags($v) ∪ "continued">
  | $u(unit) $e(erasures) [si-gap] $s(si-word) <"onset" ∩ tags($u) ∪ "continued">
  | $v(unit) si-gap $f(erasures) [si-gap] $s(si-word) <"onset" ∩ tags($v) ∪ "continued">
  | @sa-su? eraser [si-gap] $s(si-word) <"onset" ∪ "continued">
%conditions
  "continued" ∈ tags($u),
  "onset" ∈ tags($e)
%emits
  ε

%rule erasures
  | $e(erasure) <tags($e)>
  | $r(erasures) si-gap $e(erasure) <tags($r)>
  | $r(erasures) $f(erasure) <tags($r)>
%conditions
  "onset" ∈ tags($f)

%rule si-gap
  PAUSE | PAUSE hesitations PAUSE | PAUSE hesitations

%rule si-word
  $q(magic-body)
%conditions
  "SI" ∈ classes($q)

%rule eraser
  sa-word | su-word
```

## Erasure by `sa` and `su`

These two erasers are behind the feature `sa-su`. They are the most expensive part of the word grammar: a `sa` may reach back to any earlier word, so the parser must keep a possible reach open from every word it reads, not knowing whether a `sa` will come, and the cost grows faster than the length of the text. They are also rare in written text. Without the feature, `sa` and `su` are ordinary cmavo of SA and SU, which the syntax grammars do not accept, so a text that uses them is rejected at the word where they stand rather than misread.

CLL 19.13: `sa` erases back to the most recent word of the same selma'o as the word after it, that word included, and leaves the word after it standing; `su` erases back to the start of the text or to the most recent `ni'o`, `no'i`, `lu`, `tu'e` or `to`, which survives. Both are resolved here, in the same left-to-right pass as the quotes, the compounds and `si`, because they act in that order: in `mi le brodi sa le si la brodo` the `sa` takes `le brodi` before the `si` erases the `le` that follows it, and `mi brodi .i sa mi zei co mi` compounds `mi zei co` only after the `sa` has taken `mi brodi .i`.

The reach of a `sa` is stated from its far end: `sa-open` is an element, which has some selma'o, and the elements after it, none of which has a class of the first one's, so the `sa` that follows finds the nearest match. It is left-recursive and checks the class at every step, so that a reach dies at the first element that would match; that keeps the chart linear in the length of the text, which a reach stated as an element followed by a whole stream does not, since a stream may start anywhere and cannot know which class it is keeping clear of. Each step restates the stream's join in three lines: without a pause, the element before must be continued or both must be `Cy` letters; after a pause, anything may follow, and a `Cy` after a pause counts as continued. The definition effort's `CVCy` guard is not restated, since the reach is erased text and the guard only chooses between two readings of text that parses either way. The match is by selma'o: the first element's classes and the classes of the word after `sa` must share one. Hesitation may stand between a `sa` and the word after it, as between a word and its `si`. What the `sa` leaves is the word after it, a word or a quote and never a compound, since the `sa` acts before a `bu` or `zei` after that word does, and the compound is then built on what the `sa` left; the erasure carries the classes of that word, so that a later `sa` may match it in turn; the erasure may follow the element before it without a pause exactly when its first element may. Two `sa` in a row reach back to the second-nearest match, each `sa` erasing back one match further than the last, and three to the third: the reach is then two or three open reaches, each beginning at a match of the next.

```jbogenbau
%rule sa-erasure
  | $first(sa-open) $g(gap) sa-word $h(sa-gap) $next(sa-next)
  | $first(sa-open-twice) $g(gap) sa-twice $h(sa-gap) $next(sa-next)
  | $first(sa-open-thrice) $g(gap) sa-thrice $h(sa-gap) $next(sa-next)
%tags
  "onset" ∩ tags($first) ∪ ("continued" ∪ "cy" ∪ "cv" ∪ "y-letter") ∩ tags($next) ∪ classes($next)
%conditions
  classes($first) ∩ classes($next) ≠ ∅,
  "continued" ∈ tags($first) ∨ phonemes($g) = ".",
  "onset" ∈ tags($next) ∨ phonemes($h) ≠ ""

%rule sa-open
  | $first(element) <classes($first) ∪ ("onset" ∪ "continued" ∪ "cy") ∩ tags($first)>
  | $o(sa-open) $f(element) <classes($o) ∪ ("continued" ∪ "cy") ∩ tags($f)>
  | $o(sa-open) PAUSE $p(element) <classes($o) ∪ ("continued" ∪ "cy") ∩ tags($p)>
  | $o(sa-open) PAUSE $c(element) <classes($o) ∪ "continued" ∪ "cy">
%conditions
  classes($first) ≠ ∅,
  "continued" ∈ tags($o) ∨ "cy" ∈ tags($o) ∨ "onset" ∉ tags($f),
  "continued" ∈ tags($o) ∨ "cy" ∈ tags($f),
  "onset" ∈ tags($f),
  "cy" ∉ tags($p),
  "cy" ∈ tags($c),
  classes($o) ∩ classes($f) = ∅,
  classes($o) ∩ classes($p) = ∅,
  classes($o) ∩ classes($c) = ∅
%emits
  ε

%rule sa-open-twice
$a(sa-open) $g(gap) $b(sa-open)
    <classes($a) ∪ "onset" ∩ tags($a) ∪ ("continued" ∪ "cy" ∪ "cv" ∪ "y-letter") ∩ tags($b)>
%conditions
  classes($a) ∩ classes($b) ≠ ∅,
  "continued" ∈ tags($a) ∨ phonemes($g) = ".",
  "onset" ∈ tags($b) ∨ phonemes($g) = "."
%emits
  ε

%rule sa-open-thrice
$a(sa-open) $g(gap) $t(sa-open-twice)
    <classes($a) ∪ "onset" ∩ tags($a) ∪ ("continued" ∪ "cy" ∪ "cv" ∪ "y-letter") ∩ tags($t)>
%conditions
  classes($a) ∩ classes($t) ≠ ∅,
  "continued" ∈ tags($a) ∨ phonemes($g) = ".",
  "onset" ∈ tags($t) ∨ phonemes($g) = "."
%emits
  ε

%rule sa-next
  word | quote

%rule sa-gap
  gap | PAUSE hesitations PAUSE

%rule sa-word
  $q(magic-body)
%conditions
  "SA" ∈ classes($q)
%emits
  ε

%rule sa-twice
  sa-word gap sa-word

%rule sa-thrice
  sa-twice gap sa-word

%rule sa-run
  sa-word | sa-run gap sa-word
```

`su` erases back to a boundary word, which survives, or to the start of the text. The boundary words are ordinary words to every other rule; only `su` knows them, by their classes: what a `su` erases is a reach none of whose elements has one of those classes. Like the reach of a `sa`, it is left-recursive and checks every element as it goes, so that it dies at the next boundary rather than running to the end of the text. The boundary is an element, so that what an earlier `su` left standing bounds the next.

```jbogenbau
%rule su-erasure
  | $stop(boundary) $g(gap) su-word
  | $stop(boundary) $g(gap) $reach(su-reach) $h(gap) su-word
%tags
  "onset" ∩ tags($stop) ∪ classes($stop) ∪ "continued"
%conditions
  "continued" ∈ tags($stop) ∨ phonemes($g) = ".",
  "first-onset" ∈ tags($reach) ∨ phonemes($g) = ".",
  "first-cy" ∉ tags($reach) ∨ phonemes($g) = ".",
  "continued" ∈ tags($reach) ∨ phonemes($h) = "."

%rule boundary
  $b(element) <tags($b)>
%conditions
  classes($b) ∩ ("NIhO" ∪ "LU" ∪ "TUhE" ∪ "TO") ≠ ∅

%rule su-reach
  | $first(opener) <("first-onset" ∪ "first-cy" ∪ "continued" ∪ "cy") ∩ tags($first)>
  | $o(su-reach) $f(element)
      <("first-onset" ∪ "first-cy") ∩ tags($o) ∪ ("continued" ∪ "cy") ∩ tags($f)>
  | $o(su-reach) PAUSE $p(element)
      <("first-onset" ∪ "first-cy") ∩ tags($o) ∪ ("continued" ∪ "cy") ∩ tags($p)>
  | $o(su-reach) PAUSE $c(element) <("first-onset" ∪ "first-cy") ∩ tags($o) ∪ "continued" ∪ "cy">
%conditions
  classes($first) ∩ ("NIhO" ∪ "LU" ∪ "TUhE" ∪ "TO") = ∅,
  "continued" ∈ tags($o) ∨ "cy" ∈ tags($o) ∨ "onset" ∉ tags($f),
  "continued" ∈ tags($o) ∨ "cy" ∈ tags($f),
  "onset" ∈ tags($f),
  "cy" ∉ tags($p),
  "cy" ∈ tags($c),
  classes($f) ∩ ("NIhO" ∪ "LU" ∪ "TUhE" ∪ "TO") = ∅,
  classes($p) ∩ ("NIhO" ∪ "LU" ∪ "TUhE" ∪ "TO") = ∅,
  classes($c) ∩ ("NIhO" ∪ "LU" ∪ "TUhE" ∪ "TO") = ∅
%emits
  ε

%rule su-word
  $q(magic-body)
%conditions
  "SU" ∈ classes($q)
%emits
  ε
```

A `su` with no boundary before it, or a `sa` whose following word matches nothing before it, erases everything back to the start of the text; the word after such a `sa` stays, and a later unmatched one takes it too; a run of `sa` that matches nothing is one unmatched `sa`. A `sa` at the end of the text, with no word after it, has no selma'o to look for and erases nothing, so `.i sa` is `.i`; the text rule accepts it after the stream. These are the wiped stretches the text rule accepts before its stream.

```jbogenbau
%rule wiped
  | $i(wiped-item)
  | $p(wiped-prefix) $g(gap) $i(wiped-item)
%tags
  tags($i)
%conditions
  "continued" ∈ tags($p) ∨ phonemes($g) = ".",
  "first-onset" ∈ tags($i) ∨ phonemes($g) = ".",
  "first-cy" ∉ tags($i) ∨ phonemes($g) = "."

%rule wiped-prefix
  $w(wiped) <tags($w)>
%emits
  ε

%rule wiped-item
  | su-word <"onset" ∪ "continued" ∪ "first-onset">
  | $q(wiped-reach) $g(gap) su-word <"continued" ∪ ("first-onset" ∪ "first-cy") ∩ tags($q)>
  | sa-run gap su-word <"onset" ∪ "continued" ∪ "first-onset">
  | sa-run $h(sa-gap) $n(sa-next)
      <"first-onset" ∪ ("continued" ∪ "cy" ∪ "cv" ∪ "y-letter") ∩ tags($n) ∪ classes($n)>
  | $r(wiped-reach) $g(gap) sa-run $h(sa-gap) $n(sa-next)
      <("first-onset" ∪ "first-cy") ∩ tags($r) ∪ ("continued" ∪ "cy" ∪ "cv" ∪ "y-letter") ∩ tags($n)
      ∪ classes($n)>
%conditions
  classes($q) ∩ ("NIhO" ∪ "LU" ∪ "TUhE" ∪ "TO") = ∅,
  classes($r) ∩ classes($n) = ∅,
  "continued" ∈ tags($q) ∨ phonemes($g) = ".",
  "continued" ∈ tags($r) ∨ phonemes($g) = ".",
  "onset" ∈ tags($n) ∨ phonemes($h) ≠ ""

%rule wiped-reach
  $s(stream) <tags($s)>
%emits
  ε
```

## Choosing among parses

The stage declares `%ambiguity-resolution lazy`: where the grammar admits more than one parse of a text, the stage takes, at the first difference, the parse that closes a constituent over the one that reads the next phoneme; [the notation document](../../docs/notation.md), under "Ambiguity", states the rule. This is the mirror of the syntax stage, which is greedy, and the reason is CLL 4.6's tosmabru test: a word ends as early as the grammar allows, so `tosmabru` is `to smabru` and `lemiklama` is `le mi klama`, while `spageti` and `toirbroda` are one word each because the grammar allows no earlier end. It also says that an operator acts on what exists when it is read: `mi si si` erases `mi` and then nothing, rather than waiting to see whether more will be erased.

## Known gaps

Cyrillic and zbalermorna are read by the phoneme stage, so this grammar never sees them; what it does not read is a `zoi` quote whose delimiters are not set off by pauses. A run of four or more `sa` in a row before one word would erase back to the fourth-nearest match or further; here runs of up to three are read. A run of two or three with fewer matches before it than its length would erase everything back to the start of the text, and is not read.
