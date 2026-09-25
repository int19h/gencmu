# The word stream

This document opens the word stage, the second stage of every Lojban dialect: [CLL](../dialects/cll-ebnf.md), [approved word forms](../dialects/bpfk.md), [experimental](../dialects/experimental.md) and [Zantufa](../dialects/zantufa.md). The stage reads the phonemes the phoneme stage emitted and hands the indicator stage the words of the text, each tagged with its class: `word` on every word, `cmavo`, `BRIVLA` or `CMEVLA` by its shape, and every selma'o the lexicon document stitched into this stage gives it. This document contributes the stream of words and the magic words, the constructs that act on the word stream before the syntax sees it: the quotes `zo`, `ma'oi`, `zoi`, `la'o`, `mu'oi`, `lo'u ... le'u`, `zo'oi` and its relatives, the compounders `bu` and `zei`, the erasers `si`, `sa` and `su`, hesitation, and `fa'o`. They are resolved together, in one grammar, because they act strictly left to right on one stream: `merko zei zo` is a `zei` compound whose second word is `zo`, since `zei` took the word before any quote could form, and `fa fe si bu zei fi` erases `fe`, makes `fa bu`, and compounds it with `fi`. The two erasers that reach back over many words, `sa` and `su`, are resolved in the same pass, since they act in the same order. The rules for all of these words come from the Magic Words proposal of the definition effort. In six places, the proposal reads a text differently from CLL 19, and "Departures from CLL 19" lists them.

What a word looks like is not decided here. Other documents are stitched into the word stage with this one:

- [shapes.md](shapes.md), the word shapes that every family shares.
- One family document, which defines the three shapes this grammar reads, `cmavo-shape`, `brivla-shape` and `cmevla-shape`, and tags each with its pause properties. [cll.md](cll.md) gives the word forms of chapter 4 of *The Complete Lojban Language* as printed, and [bpfk.md](bpfk.md) gives the definition effort's approved word-form grammar.
- In the experimental and Zantufa dialects, [experimental.md](experimental.md) after `bpfk.md`. It adds the consonant pair `mz`.
- One lexicon, [lexicon-cll.md](lexicon-cll.md) or [lexicon-experimental.md](lexicon-experimental.md), which gives each cmavo its selma'o.

The notation is explained in [the notation document](../../docs/notation.md). The stage's choice among parses, at the end of this document, is the mirror of the syntax stage's.

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
  | [PAUSE] faho-group | [PAUSE] $f(body) $g(gap) faho-group
%conditions
  "stream-end" ∉ tags($b),
  "continued" ∈ tags($f) ∨ phonemes($g) = "."

%rule body
  | $t(body-tail) <tags($t)>
  | stray-si <"continued">
  | $y(stray-si) $g(gap) $z(body-tail) <("stream-end" ∪ "continued") ∩ tags($z)>
%conditions
  "first-onset" ∈ tags($z) ∨ phonemes($g) = ".",
  "first-cy" ∉ tags($z) ∨ phonemes($g) = "."

%rule body-tail
  | $a(stream) <("first-onset" ∪ "first-cy" ∪ "continued") ∩ tags($a) ∪ "stream-end">
  | @sa-su? sa-run <"first-onset" ∪ "continued">
  | @sa-su? $b(wiped) <("first-onset" ∪ "first-cy" ∪ "continued") ∩ tags($b)>
  | @sa-su? $w(wiped) $g(gap) $v(stream)
      <("first-onset" ∪ "first-cy") ∩ tags($w) ∪ "continued" ∩ tags($v) ∪ "stream-end">
  | @sa-su? $s(stream) $h(gap) sa-run <("first-onset" ∪ "first-cy") ∩ tags($s) ∪ "continued">
  | @sa-su? $x(wiped) $h(gap) sa-run <("first-onset" ∪ "first-cy") ∩ tags($x) ∪ "continued">
  | @sa-su? $w(wiped) $g(gap) $v(stream) $h(gap) sa-run <("first-onset" ∪ "first-cy") ∩ tags($w) ∪ "continued">
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
  | $o(opener) <tags($o) ∪ ("cy" ∈ tags($o) ⟹ "continued")>
  | $s(stream) PAUSE $e(element)
      <tags($e) ∪ classes($s) ∪ ("first-onset" ∪ "first-cy" ∪ "first-wipes") ∩ tags($s) ∪ ("cy" ∈ tags($e) ⟹ "continued")>
  | $t(stream) $f(element)
      <tags($f) ∪ classes($t) ∪ ("first-onset" ∪ "first-cy" ∪ "first-wipes") ∩ tags($t)
        ∪ ("cv" ∈ tags($t) ∧ "y-letter" ∈ tags($f) ⟹ "cvcy")>
%conditions
  "wipes-all" ∉ tags($e),
  "wipes-all" ∉ tags($f),
  ("continued" ∪ "cy" ∪ "cvcy" ∪ "name-intro") ∩ tags($t) ≠ ∅,
  "cy" ∈ tags($t) ∧ "cy" ∈ tags($f)
    ∨ "continued" ∈ tags($t) ∧ "onset" ∈ tags($f)
      ∧ ("cv" ∈ tags($t) ∨ "cvcy" ∉ tags($t) ∧ ("cy" ∉ tags($t) ∨ "cy" ∉ tags($f)))
      ∧ ("final-stress" ∉ tags($t) ∨ "stress-guard" ∉ tags($f))
    ∨ "cvcy" ∈ tags($t) ∧ "onset" ∈ tags($f) ∧ "BRIVLA" ∉ tags($f) ∧ ¬matches($f, lujvo-final-shape)
    ∨ "name-intro" ∈ tags($t) ∧ "name-onset" ∈ tags($f)

%rule opener
  | $o(element) <tags($o) ∪ "first-onset">
  | $k(element) <tags($k) ∪ "first-onset" ∪ "first-cy">
  | $p(element) <tags($p)>
  | @sa-su? $w(element) <tags($w) ∪ ("onset" ∈ tags($w) ⟹ "first-onset") ∪ "first-cy" ∩ tags($w) ∪ "first-wipes">
%conditions
  "onset" ∈ tags($o),
  ("cy" ∪ "y-letter") ∩ tags($o) = ∅,
  "onset" ∈ tags($k),
  ("cy" ∪ "y-letter") ∩ tags($k) ≠ ∅,
  "onset" ∉ tags($p),
  "wipes-all" ∉ tags($o),
  "wipes-all" ∉ tags($k),
  "wipes-all" ∉ tags($p),
  "wipes-all" ∈ tags($w)

%rule element
  unit | erasure | hesitation

%rule unit
  | word | quote | lerfu-word | zei-compound
  | @sa-su? sa-erasure | @sa-su? sa-wiped | @sa-su? @su-boundary? su-erasure
```

A stream can open with an element that erases the whole text before it, tagged `wipes-all`. The opener then tags the stream `first-wipes`, and each join passes that tag on. "Erasure by `sa` and `su`" explains such elements.

Hesitation after a final pause belongs to the stream when the body ends in one, since an element may always follow a pause; the text's own `PAUSE hesitation` is for a body that ends in an erasure, which is not a stream. `stream-end` is the tag that tells the two apart, so that a trailing `.y.` has one reading.

The joins are stated so that no two apply to the same pair: two `Cy` letter words side by side are joined by the `Cy` rule alone, which is why the general join, a continued element followed by an onset, leaves that case to it. Two joins that both applied would be two parses of one text that differ in nothing the next stage sees, and the stage would report them as a tie.

Besides the tags of its last element, the stream carries what a rule reaching back over it needs: `first-onset`, when its first element may follow another without a pause, which is what joins a reach to the element before it; `first-cy`, when that element is a `Cy` letter, which under CLL may follow another word directly only if another `Cy` follows it and under the definition effort's grammar would make a lujvo with a CV word before it, so that a join without a pause refuses it and `sutyterjvi` stays one lujvo in both; and the union of the selma'o of every element in it, which is what tells a `sa` that nothing in its reach matches. `gap` is an optional pause; where the rules below join two parts across one, the condition says that either the pause is there or the two parts may stand together without it.

A `si` with nothing before it erases nothing (CLL 19.13 says what `si` erases, not that there must be something to erase), and so does a run of them, whether at the start of the text, after hesitation there, after an erasure that has already taken everything before it, or after an unmatched `sa` or `su` that has. A `sa` directly before a `si` is one of those: it looks for a word of `si`'s selma'o, which no word before it has, since every `si` has acted, so it erases back to the start of the text, and the `si` then has nothing to erase. A `bu` with no word before it to bind to may stand there too, erased by the first `si`: the proposal says that `bu` and `le'u` "are never grammatical by themselves, but are grammatical as part of an utterance erased by sa, si, or su", so `bu si` is nothing, as is `mi si bu si`.

```jbogenbau
%rule stray-si
  | stray-run | hesitations si-gap stray-run | erasure [si-gap] stray-run | @sa-su? wiped [si-gap] stray-run
  | @sa-su? sa-run [si-gap] si-run
  | @sa-su? $r(wiped-reach) $g(gap) sa-run [si-gap] si-run
%conditions
  "continued" ∈ tags($r) ∨ phonemes($g) = "."
%emits
  ε

%rule stray-run
  si-run | bu-word [si-gap] si-run

%rule si-run
  si-word | si-run [si-gap] si-word
```

Hesitation, `y` however long, has no grammatical meaning (CLL 19.14). As the Magic Words proposal has it, hesitation is not a word at all, which is the fourth of the departures from CLL 19. It is dropped, except directly before `bu`, where it is the base of the letter word `.y bu`. It begins with a vowel, so a pause precedes it (CLL 4.9 rule 3), and it may be followed by a word directly.

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

`fa'o` ends the text (CLL 19.15): whatever follows it is not read and is not handed on, so the group emits nothing. Since nothing after it is read, nothing after it needs a pause, as the Magic Words proposal says, "No words are read to the right of FAhO, unconditionally": `fa'omi` and `fa'obu` are `fa'o` alone. Before it, the pause rules of the stream hold, so `mifa'o` is `mi fa'o`.

```jbogenbau
%rule faho-group
  faho-word | faho-word zoi-body

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
  | $n(cmevla-shape) <"word" ∪ "CMEVLA" ∪ tags($n)>
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

`zo` and `ma'oi` quote the next word, whatever it is, except hesitation, which is not a word: `zo y co` quotes `co`, and `zo .y'y.` quotes the letter word. The Magic Words proposal makes `.y. bu` a letter word "before any other processing of any kind", so `zo .y. bu` quotes that letter word, and a hesitation before the quoted word is never the base of a following `bu`. The quoted word ends where that word ends, so a quoted brivla runs on into the next word only when its stress is marked, exactly as an unquoted one, which the tags of the word constituent already say. A cmevla is surrounded by pauses (CLL 4.9 rule 4), quoted or not, so a quoted cmevla ends its stretch and needs a pause before it: `zo n` is no quote in `amazon`. CLL 4.9 rule 3 holds inside a quote too: a quoted word that begins with a vowel needs a pause before it, so `zoi` is never `zo` and `.i`.

```jbogenbau
%rule quoted-word
  | $m(word-quote-marker) $g(quote-gap) $w(quotable-word)
      <tags($m) ∪ "onset" ∪ ("continued" ∪ "cy" ∪ "y-letter" ∪ "cv" ∪ "final-stress") ∩ tags($w)>
  | $m(word-quote-marker) pause-gap $v(quotable-word)
      <tags($m) ∪ "onset" ∪ ("continued" ∪ "cy" ∪ "y-letter" ∪ "cv" ∪ "final-stress") ∩ tags($v)>
  | $m(word-quote-marker) pause-gap $n(cmevla-shape) <tags($m) ∪ "onset">
%conditions
  "onset" ∈ tags($w),
  "onset" ∉ tags($v),
  words($g) = ∅ ∨ "BU" ∉ tags($w, lexicon)
%emits
  $m, $w <"word">, $v <"word">, $n <"word">

%rule word-quote-marker
  $q(magic-body) <"word" ∪ "cmavo" ∪ classes($q)>
%conditions
  "ZO" ∈ classes($q)

%rule quotable-word
  $c(cmavo-shape) <tags($c)> | $b(brivla-shape) <tags($b)> | y-bu-word <"continued">

%rule y-bu-word
  y-run [PAUSE] bu-word
```

`zo'oi` and its relatives quote the next run of characters up to a pause. `zoi`, `la'o` and `mu'oi` quote a body between two delimiter words: the two delimiters must be the same word, and that word may not occur as a word of the body, so the quote ends at its first occurrence. The delimiter may occur inside a word of the body, and the two delimiters are compared exactly, stress included, which is the sixth of the departures from CLL 19. That is the condition the captures state, and it is checked as the parse advances, so a candidate close that is not the opener never opens a continuation of the text. A quote whose delimiters stand side by side quotes nothing, and hands the syntax an empty stretch of foreign text so that its shape is the same as any other's; a letter word such as `ibu` is one word and may serve as a delimiter. The body of a `zoi` quote and the run that `zo'oi` quotes are `%verbatim`. So the syntax receives a token that sounds like the text as written, with its punctuation. It does not sound like the phonemes that the phoneme stage read in the text. The delimiters are still compared by their phonemes, and so is each word of the body.

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

Inside `lo'u ... le'u` the words are ordinary words under the pause rules of CLL 4.9, but no quote marker opens anything and no eraser erases, so a `lo'u` stretch is a stream of bare word shapes joined by the same rules as the stream of the text, and it joins `lo'u` and `le'u` by them too, so that `lo'umi le'u` and `lo'u mile'u` need no pause; the quote ends at the first `le'u`, even after a `zo`, which is the fifth of the departures from CLL 19, and it may be empty, `lo'u le'u`, as a `zoi` quote may. The words inside are handed on as bare words, and the markers as `LOhU` and `LEhU`; the closing marker is handed on as `LEhU` alone, not also as a word, so that the syntax cannot read it as one more quoted word and look for a later `le'u`. For `sa`, the quote has the selma'o of both its markers, as the Magic Words proposal says. `sa lo'u` erases back to the start of the last quote and opens a new one. `sa le'u` "destroys everything since the end of the last LOhU...LEhU quote, replacing the terminating LEhU with a new LEhU (i.e. not changing the quote at all)": `lehu-close` reads such a stretch as the quote's closing, so that `lo'u co le'u broda sa le'u` is the quote `lo'u co le'u`, and the ordinary erasure by `sa` does not take a `le'u` after it. The stretch, `lehu-reach`, is stated as the reach of a `sa` is: it is left-recursive and checks each element, so that it ends at the first element with the selma'o of either marker. A stretch stated as a stream would run on from every `le'u` to the end of the text.

```jbogenbau
%rule lohu-quote
  | $m(lohu-marker) $g(gap) $content(lohu-stream) $h(gap) lehu-close
  | $m(lohu-marker) [PAUSE] lehu-close
%tags
  tags($m) ∪ "LEhU" ∪ "onset" ∪ "continued"
%conditions
  "first-onset" ∈ tags($content) ∨ phonemes($g) = ".",
  "first-cy" ∉ tags($content) ∨ phonemes($g) = ".",
  "continued" ∈ tags($content) ∨ phonemes($h) = "."

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

%rule lehu-close
  | lehu-marker
  | @sa-su? lehu-erased [PAUSE] sa-word sa-gap lehu-marker
  | @sa-su? lehu-erased $g(gap) $r(lehu-reach) $h(gap) sa-word sa-gap lehu-marker
%conditions
  "first-onset" ∈ tags($r) ∨ phonemes($g) = ".",
  "first-cy" ∉ tags($r) ∨ phonemes($g) = ".",
  "continued" ∈ tags($r) ∨ phonemes($h) = "."

%rule lehu-erased
  $q(magic-body)
%conditions
  "LEhU" ∈ classes($q)
%emits
  ε

%rule lehu-reach
  | $first(opener)
      <("first-onset" ∪ "first-cy" ∪ "continued" ∪ "cy" ∪ "cv" ∪ "y-letter" ∪ "final-stress" ∪ "name-intro") ∩ tags($first)
        ∪ ("cy" ∈ tags($first) ⟹ "continued")>
  | $s(lehu-reach) PAUSE $e(element)
      <("first-onset" ∪ "first-cy") ∩ tags($s) ∪ ("continued" ∪ "cy" ∪ "cv" ∪ "y-letter" ∪ "final-stress" ∪ "name-intro") ∩ tags($e)
        ∪ ("cy" ∈ tags($e) ⟹ "continued")>
  | $t(lehu-reach) $f(element)
      <("first-onset" ∪ "first-cy") ∩ tags($t) ∪ ("continued" ∪ "cy" ∪ "cv" ∪ "y-letter" ∪ "final-stress" ∪ "name-intro") ∩ tags($f)
        ∪ ("cv" ∈ tags($t) ∧ "y-letter" ∈ tags($f) ⟹ "cvcy")>
%conditions
  classes($first) ∩ ("LOhU" ∪ "LEhU") = ∅,
  "first-wipes" ∉ tags($first),
  classes($e) ∩ ("LOhU" ∪ "LEhU") = ∅,
  classes($f) ∩ ("LOhU" ∪ "LEhU") = ∅,
  "wipes-all" ∉ tags($e),
  "wipes-all" ∉ tags($f),
  ("continued" ∪ "cy" ∪ "cvcy" ∪ "name-intro") ∩ tags($t) ≠ ∅,
  "cy" ∈ tags($t) ∧ "cy" ∈ tags($f)
    ∨ "continued" ∈ tags($t) ∧ "onset" ∈ tags($f)
      ∧ ("cv" ∈ tags($t) ∨ "cvcy" ∉ tags($t) ∧ ("cy" ∉ tags($t) ∨ "cy" ∉ tags($f)))
      ∧ ("final-stress" ∉ tags($t) ∨ "stress-guard" ∉ tags($f))
    ∨ "cvcy" ∈ tags($t) ∧ "onset" ∈ tags($f) ∧ "BRIVLA" ∉ tags($f) ∧ ¬matches($f, lujvo-final-shape)
    ∨ "name-intro" ∈ tags($t) ∧ "name-onset" ∈ tags($f)
%emits
  ε

%rule lohu-stream
  | $o(lohu-word)
      <tags($o) ∪ ("cy" ∈ tags($o) ⟹ "continued") ∪ ("onset" ∈ tags($o) ⟹ "first-onset")
        ∪ ("onset" ∈ tags($o) ∧ ("cy" ∪ "y-letter") ∩ tags($o) ≠ ∅ ⟹ "first-cy")>
  | $s(lohu-stream) PAUSE $e(lohu-word)
      <tags($e) ∪ ("first-onset" ∪ "first-cy") ∩ tags($s) ∪ ("cy" ∈ tags($e) ⟹ "continued")>
  | $t(lohu-stream) $f(lohu-word)
      <tags($f) ∪ ("first-onset" ∪ "first-cy") ∩ tags($t) ∪ ("cv" ∈ tags($t) ∧ "y-letter" ∈ tags($f) ⟹ "cvcy")>
%conditions
  ("continued" ∪ "cy" ∪ "cvcy" ∪ "name-intro") ∩ tags($t) ≠ ∅,
  "cy" ∈ tags($t) ∧ "cy" ∈ tags($f)
    ∨ "continued" ∈ tags($t) ∧ "onset" ∈ tags($f)
      ∧ ("cv" ∈ tags($t) ∨ "cvcy" ∉ tags($t) ∧ ("cy" ∉ tags($t) ∨ "cy" ∉ tags($f)))
      ∧ ("final-stress" ∉ tags($t) ∨ "stress-guard" ∉ tags($f))
    ∨ "cvcy" ∈ tags($t) ∧ "onset" ∈ tags($f) ∧ "BRIVLA" ∉ tags($f) ∧ ¬matches($f, lujvo-final-shape)
    ∨ "name-intro" ∈ tags($t) ∧ "name-onset" ∈ tags($f)

%rule lohu-word
  | $c(cmavo-shape) <tags($c)>
  | $b(brivla-shape) <tags($b) ∪ "BRIVLA">
  | $n(cmevla-shape) <tags($n)>
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
%verbatim

%rule non-pause-run
  non-pause-char | non-pause-char non-pause-run
%verbatim

%rule any-char
  non-pause-char | PAUSE

%rule non-pause-char
  | /a/ | /e/ | /i/ | /o/ | /u/ | /A/ | /E/ | /I/ | /O/ | /U/ | y | /'/ | /,/ | FOREIGN
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

CLL 17.4 and 4.6: any word followed by `bu` is a letter word, which counts as a `BY` when `sa` looks for a match, and any two words joined by `zei` are one brivla. The operand of `bu` and the left operand of `zei` are whatever the stream has already produced, a word, a quote or a compound, since the operators act on what exists when they are read; a `si` erasure may sit between an operand and its operator, because the erased word is no longer there for the operator to see. The right operand of `zei` is the next word whatever it is, a quote marker or an eraser included, which is why `merko zei zo` is a compound: the word was taken before it could act. This is the proposal's reading, the second of the departures from CLL 19. So is a letter word of `ba'e` or `za'e`, the third. A compound is one word (CLL 4.6, 17.4) and is handed on as one token, a `BY` for `bu` and a `BRIVLA` for `zei`, which the syntax grammar reads as it reads any letter word or brivla; its printed rules `any-word BU` and `any-word ZEI any-word` are kept there for fidelity and never match.

```jbogenbau
%rule lerfu-word
  | $u(unit) bu-part <"word" ∪ "BY" ∪ "continued" ∪ ("onset" ∪ "wipes-all") ∩ tags($u)>
  | $c(unit) bu-part <"word" ∪ "BY" ∪ "continued" ∪ ("onset" ∪ "wipes-all") ∩ tags($c)>
  | $v(unit) PAUSE bu-part <"word" ∪ "BY" ∪ "continued" ∪ ("onset" ∪ "wipes-all") ∩ tags($v)>
  | $u(unit) $g(gap-erasures) bu-part <"word" ∪ "BY" ∪ "continued" ∪ ("onset" ∪ "wipes-all") ∩ tags($u)>
  | $v(unit) PAUSE $h(gap-erasures) bu-part <"word" ∪ "BY" ∪ "continued" ∪ ("onset" ∪ "wipes-all") ∩ tags($v)>
  | $y(y-base) [PAUSE] bu-part <"word" ∪ "BY" ∪ "continued">
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

%rule bu-part
  | bu-word
  | @sa-su? bu-erased [PAUSE] sa-word sa-gap bu-word
  | @sa-su? bu-erased $g(gap) $r(bu-reach) $h(gap) sa-word sa-gap bu-word
%conditions
  "first-onset" ∈ tags($r) ∨ phonemes($g) = ".",
  "first-cy" ∉ tags($r) ∨ phonemes($g) = ".",
  "continued" ∈ tags($r) ∨ phonemes($h) = "."

%rule bu-erased
  $q(magic-body)
%conditions
  "BU" ∈ classes($q)
%emits
  ε

%rule bu-reach
  | $first(opener)
      <("first-onset" ∪ "first-cy" ∪ "continued" ∪ "cy" ∪ "cv" ∪ "y-letter" ∪ "final-stress" ∪ "name-intro") ∩ tags($first)
        ∪ ("cy" ∈ tags($first) ⟹ "continued")>
  | $s(bu-reach) PAUSE $e(element)
      <("first-onset" ∪ "first-cy") ∩ tags($s) ∪ ("continued" ∪ "cy" ∪ "cv" ∪ "y-letter" ∪ "final-stress" ∪ "name-intro") ∩ tags($e)
        ∪ ("cy" ∈ tags($e) ⟹ "continued")>
  | $t(bu-reach) $f(element)
      <("first-onset" ∪ "first-cy") ∩ tags($t) ∪ ("continued" ∪ "cy" ∪ "cv" ∪ "y-letter" ∪ "final-stress" ∪ "name-intro") ∩ tags($f)
        ∪ ("cv" ∈ tags($t) ∧ "y-letter" ∈ tags($f) ⟹ "cvcy")>
%conditions
  classes($first) ∩ ("BY") = ∅,
  "first-wipes" ∉ tags($first),
  classes($e) ∩ ("BY") = ∅,
  classes($f) ∩ ("BY") = ∅,
  "wipes-all" ∉ tags($e),
  "wipes-all" ∉ tags($f),
  ("continued" ∪ "cy" ∪ "cvcy" ∪ "name-intro") ∩ tags($t) ≠ ∅,
  "cy" ∈ tags($t) ∧ "cy" ∈ tags($f)
    ∨ "continued" ∈ tags($t) ∧ "onset" ∈ tags($f)
      ∧ ("cv" ∈ tags($t) ∨ "cvcy" ∉ tags($t) ∧ ("cy" ∉ tags($t) ∨ "cy" ∉ tags($f)))
      ∧ ("final-stress" ∉ tags($t) ∨ "stress-guard" ∉ tags($f))
    ∨ "cvcy" ∈ tags($t) ∧ "onset" ∈ tags($f) ∧ "BRIVLA" ∉ tags($f) ∧ ¬matches($f, lujvo-final-shape)
    ∨ "name-intro" ∈ tags($t) ∧ "name-onset" ∈ tags($f)
%emits
  ε

%rule zei-compound
  | $l(unit) $z(zei-word) $r(zei-right)
      <"word" ∪ "BRIVLA" ∪ ("onset" ∪ "wipes-all") ∩ tags($l) ∪ ("continued" ∪ "cy" ∪ "y-letter" ∪ "final-stress") ∩ tags($r)>
  | $k(unit) PAUSE $z(zei-word) $r(zei-right)
      <"word" ∪ "BRIVLA" ∪ ("onset" ∪ "wipes-all") ∩ tags($k) ∪ ("continued" ∪ "cy" ∪ "y-letter" ∪ "final-stress") ∩ tags($r)>
  | $l(unit) zei-word $j(pause-gap) $p(zei-right)
      <"word" ∪ "BRIVLA" ∪ ("onset" ∪ "wipes-all") ∩ tags($l) ∪ ("continued" ∪ "cy" ∪ "y-letter" ∪ "final-stress") ∩ tags($p)>
  | $k(unit) PAUSE zei-word $j(pause-gap) $p(zei-right)
      <"word" ∪ "BRIVLA" ∪ ("onset" ∪ "wipes-all") ∩ tags($k) ∪ ("continued" ∪ "cy" ∪ "y-letter" ∪ "final-stress") ∩ tags($p)>
  | $l(unit) $g(gap-erasures) $z(zei-word) $r(zei-right)
      <"word" ∪ "BRIVLA" ∪ ("onset" ∪ "wipes-all") ∩ tags($l) ∪ ("continued" ∪ "cy" ∪ "y-letter" ∪ "final-stress") ∩ tags($r)>
  | $k(unit) PAUSE $h(gap-erasures) $z(zei-word) $r(zei-right)
      <"word" ∪ "BRIVLA" ∪ ("onset" ∪ "wipes-all") ∩ tags($k) ∪ ("continued" ∪ "cy" ∪ "y-letter" ∪ "final-stress") ∩ tags($r)>
%conditions
  "continued" ∈ tags($l),
  "onset" ∈ tags($r),
  "onset" ∈ tags($g),
  words($j) = ∅ ∨ "BU" ∉ tags($p, lexicon)
%emits
  $

%rule zei-word
  $q(magic-body)
%conditions
  "ZEI" ∈ classes($q)

%rule zei-right
  $c(cmavo-shape) <tags($c)> | $b(brivla-shape) <tags($b)> | cmevla-shape <∅> | y-bu-word <"continued">

%rule gap-erasures
  | $e(erasure) <tags($e)>
  | $g(gap-erasures) PAUSE $e(erasure) <tags($g)>
  | $h(gap-erasures) $f(erasure) <tags($h)>
  | $g(gap-erasures) PAUSE <tags($g)>
%conditions
  "onset" ∈ tags($f),
  "wipes-all" ∉ tags($e),
  "wipes-all" ∉ tags($f)
```

`sa bu` "backs up to the last BU, pulling an already constructed pseudo-word apart", as the proposal puts it among its unique cases: it erases back to the `bu` of the last letter word, and the new `bu` binds to that letter word's base again, so `.abu sa bu` is `.abu`. `bu-part` reads such a stretch as the letter word's `bu`. Nothing between may be a letter word, since its `bu` would be the last, so `bu-reach` is stated as the reach of a `sa` is and ends at the first letter word.

The pause between an operand and its operator is stated where it matters: a `bu` may follow its word directly only if the word is continued, or is a `Cy` letter cmavo, since `xybu` is the usual way to write that letter word; a `zei` may follow directly only a continued word; a pause is always allowed. The erasures that may stand between them obey the same pause rules, joined through the tags of the first erasure, and an erasure is always continued, so what follows a run of them needs no pause. The word after `zei` follows it directly or after a pause, and hesitation may stand between them, since the proposal treats `.y.` as whitespace; `.y. bu` there is the letter word, so `da zei .y. bu` is a lujvo of `da` and that letter. A compound may follow the word before it without a pause exactly when its first word may, which is what the `onset` in its tags records; `.abu` needs the pause before it that `a` needs.

## Erasure by `si`

CLL 19.13: `si` erases the word before it. As in the Magic Words proposal, a compound or a quote counts as one word, which is the first of the departures from CLL 19. A run of `si` erases as many words: `broda brode si si` erases both, which the rule states as an erasure whose unit is followed by one or more erasures and then the `si` that erases the unit; `klama co si gunka si si` erases `co`, then `gunka`, then `klama`. Hesitation may stand between the word and its `si`, since it is not a word, and `co .y. si` erases `co`. An erased stretch emits nothing. What a `sa` or `su` leaves standing is a unit, so a following `si` erases it. An eraser acts when it is read, as the Magic Words proposal has it, so a `si` never erases a `sa` or `su` as though it were a word: `mi ni'o do su si` erases back to the `ni'o` first, and the `si` then erases that.

```jbogenbau
%rule erasure
  | $u(unit) $s(si-word) <("onset" ∪ "wipes-all") ∩ tags($u) ∪ "continued">
  | $v(unit) si-gap $s(si-word) <("onset" ∪ "wipes-all") ∩ tags($v) ∪ "continued">
  | $u(unit) $e(erasures) [si-gap] $s(si-word) <("onset" ∪ "wipes-all") ∩ tags($u) ∪ "continued">
  | $v(unit) si-gap $f(erasures) [si-gap] $s(si-word) <("onset" ∪ "wipes-all") ∩ tags($v) ∪ "continued">
%conditions
  "continued" ∈ tags($u),
  "onset" ∈ tags($e),
  "wipes-all" ∉ tags($e),
  "wipes-all" ∉ tags($f)
%emits
  ε

%rule erasures
  | $d(erasure) <tags($d)>
  | $r(erasures) si-gap $e(erasure) <tags($r)>
  | $r(erasures) $f(erasure) <tags($r)>
%conditions
  "onset" ∈ tags($f),
  "wipes-all" ∉ tags($e),
  "wipes-all" ∉ tags($f)

%rule si-gap
  PAUSE | PAUSE hesitations PAUSE | PAUSE hesitations

%rule si-word
  $q(magic-body)
%conditions
  "SI" ∈ classes($q)
```

## Erasure by `sa` and `su`

These two erasers are behind the feature `sa-su`. They are the most expensive part of the word grammar. A `sa` may reach back to any earlier word, so the parser keeps a possible reach open from the most recent word of each selma'o, not knowing whether a `sa` will come. That multiplies the work for each word by the number of selma'o in use. They are also rare in written text. Without the feature, `sa` and `su` are ordinary cmavo of SA and SU, which the syntax grammars do not accept, so a text that uses them is rejected at the word where they stand rather than misread.

CLL 19.13: `sa` erases back to the most recent word of the same selma'o as the word after it, that word included, and leaves the word after it standing; `su` "erases the entire text". The Magic Words proposal and camxes-std stop `su` sooner, at the most recent `ni'o`, `no'i`, `lu`, `tu'e` or `to`, which survives, as step 2g of the YACC preamble also does. The feature `su-boundary` gives that reading: the approved word forms, experimental and Zantufa dialects turn it on, and the CLL dialect leaves it off, so that there `su` erases the whole text before it. Both are resolved here, in the same left-to-right pass as the quotes, the compounds and `si`, because they act in that order: in `mi le brodi sa le si la brodo` the `sa` takes `le brodi` before the `si` erases the `le` that follows it, and `mi brodi .i sa mi zei co mi` compounds `mi zei co` only after the `sa` has taken `mi brodi .i`.

The reach of a `sa` is stated from its far end: `sa-open` is an element, which has some selma'o, and the elements after it, none of which has a class of the first one's, so the `sa` that follows finds the nearest match. It is left-recursive and checks the class at every step, so that a reach dies at the first element that would match; that keeps the chart linear in the length of the text, which a reach stated as an element followed by a whole stream does not, since a stream may start anywhere and cannot know which class it is keeping clear of. Each step restates the stream's join in three lines: without a pause, the element before must be continued or both must be `Cy` letters; after a pause, anything may follow, and a `Cy` after a pause counts as continued. The definition effort's `CVCy` guard is not restated, since the reach is erased text and the guard only chooses between two readings of text that parses either way. The match is by selma'o: the first element's classes and the classes of the word after `sa` must share one. Hesitation may stand between a `sa` and the word after it, as between a word and its `si`. What the `sa` leaves is the word after it, a word or a quote and never a compound, since the `sa` acts before a `bu` or `zei` after that word does, and the compound is then built on what the `sa` left; the erasure carries the classes of that word, so that a later `sa` may match it in turn; the erasure may follow the element before it without a pause exactly when its first element may. Several `sa` in a row reach back to successively further matches, "one for each SA", as the Magic Words proposal says: two `sa` erase back to the second-nearest match, three to the third, and so on. The erased text is then as many reaches as there are `sa`, each beginning at a match, followed by the `sa` themselves, which `sa-nest` pairs from the inside out: the innermost reach with the first `sa`, the next reach back with the second. A reach also carries whether its first element may follow the element before it without a pause, `first-onset`, and joins its elements by the same condition as the stream.

```jbogenbau
%rule sa-erasure
  $first(sa-nest) $h(sa-gap) $next(sa-next)
%tags
  ("first-onset" ∈ tags($first) ⟹ "onset") ∪ "wipes-all" ∩ tags($first)
    ∪ ("continued" ∪ "cy" ∪ "cv" ∪ "y-letter" ∪ "final-stress" ∪ "name-intro") ∩ tags($next) ∪ classes($next)
%conditions
  classes($first) ∩ classes($next) ≠ ∅,
  "LEhU" ∉ classes($next) ∨ "LOhU" ∈ classes($next),
  "onset" ∈ tags($next) ∨ phonemes($h) ≠ ""

%rule sa-nest
  | $o(sa-open) $g(gap) sa-word <classes($o) ∪ ("first-onset" ∪ "first-cy" ∪ "wipes-all") ∩ tags($o)>
  | $a(sa-open) $k(gap) $n(sa-nest) gap sa-word
      <classes($a) ∩ classes($n) ∪ ("first-onset" ∪ "first-cy" ∪ "wipes-all") ∩ tags($a)>
%conditions
  "continued" ∈ tags($o) ∨ phonemes($g) = ".",
  classes($a) ∩ classes($n) ≠ ∅,
  "continued" ∈ tags($a) ∨ phonemes($k) = ".",
  "first-onset" ∈ tags($n) ∨ phonemes($k) = ".",
  "first-cy" ∉ tags($n) ∨ phonemes($k) = "."
%emits
  ε

%rule sa-open
  | $first(element)
      <classes($first) ∪ ("continued" ∪ "cy" ∪ "cv" ∪ "y-letter" ∪ "wipes-all") ∩ tags($first)
        ∪ ("onset" ∈ tags($first) ⟹ "first-onset")
        ∪ ("onset" ∈ tags($first) ∧ ("cy" ∪ "y-letter") ∩ tags($first) ≠ ∅ ⟹ "first-cy")>
  | $s(sa-open) PAUSE $e(element)
      <classes($s) ∪ ("first-onset" ∪ "first-cy" ∪ "wipes-all") ∩ tags($s) ∪ ("continued" ∪ "cy" ∪ "cv" ∪ "y-letter" ∪ "final-stress" ∪ "name-intro") ∩ tags($e)
        ∪ ("cy" ∈ tags($e) ⟹ "continued")>
  | $t(sa-open) $f(element)
      <classes($t) ∪ ("first-onset" ∪ "first-cy" ∪ "wipes-all") ∩ tags($t) ∪ ("continued" ∪ "cy" ∪ "cv" ∪ "y-letter" ∪ "final-stress" ∪ "name-intro") ∩ tags($f)
        ∪ ("cv" ∈ tags($t) ∧ "y-letter" ∈ tags($f) ⟹ "cvcy")>
%conditions
  classes($first) ≠ ∅,
  "wipes-all" ∉ tags($e),
  "wipes-all" ∉ tags($f),
  classes($s) ∩ classes($e) = ∅,
  classes($t) ∩ classes($f) = ∅,
  ("continued" ∪ "cy" ∪ "cvcy" ∪ "name-intro") ∩ tags($t) ≠ ∅,
  "cy" ∈ tags($t) ∧ "cy" ∈ tags($f)
    ∨ "continued" ∈ tags($t) ∧ "onset" ∈ tags($f)
      ∧ ("cv" ∈ tags($t) ∨ "cvcy" ∉ tags($t) ∧ ("cy" ∉ tags($t) ∨ "cy" ∉ tags($f)))
      ∧ ("final-stress" ∉ tags($t) ∨ "stress-guard" ∉ tags($f))
    ∨ "cvcy" ∈ tags($t) ∧ "onset" ∈ tags($f) ∧ "BRIVLA" ∉ tags($f) ∧ ¬matches($f, lujvo-final-shape)
    ∨ "name-intro" ∈ tags($t) ∧ "name-onset" ∈ tags($f)
%emits
  ε

%rule sa-wipe
  | $c(sa-wipe-core) <tags($c)>
  | $r(wiped-reach) $g(gap) $c(sa-wipe-core) <classes($c) ∪ ("first-onset" ∪ "first-cy") ∩ tags($r)>
%conditions
  classes($r) ∩ classes($c) = ∅,
  "continued" ∈ tags($r) ∨ phonemes($g) = ".",
  "first-onset" ∈ tags($c) ∨ phonemes($g) = ".",
  "first-cy" ∉ tags($c) ∨ phonemes($g) = "."

%rule sa-wipe-core
  | $o(sa-open) $g(gap) sa-run-twice <classes($o) ∪ ("first-onset" ∪ "first-cy") ∩ tags($o)>
  | $a(sa-open) $k(gap) $n(sa-wipe-core) gap sa-word
      <classes($a) ∩ classes($n) ∪ ("first-onset" ∪ "first-cy") ∩ tags($a)>
%conditions
  "continued" ∈ tags($o) ∨ phonemes($g) = ".",
  classes($a) ∩ classes($n) ≠ ∅,
  "continued" ∈ tags($a) ∨ phonemes($k) = ".",
  "first-onset" ∈ tags($n) ∨ phonemes($k) = ".",
  "first-cy" ∉ tags($n) ∨ phonemes($k) = "."
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

%rule sa-run
  sa-word | sa-run gap sa-word

%rule sa-run-twice
  sa-word gap sa-run
```

With `su-boundary`, `su` erases back to a boundary word, which survives, or to the start of the text; without it, always to the start of the text. The boundary words are ordinary words to every other rule; only `su` knows them, by their classes: what a `su` erases is a reach none of whose elements has one of those classes. Like the reach of a `sa`, it is left-recursive and checks every element as it goes, so that it dies at the next boundary rather than running to the end of the text. The boundary is an element, so that what an earlier `su` left standing bounds the next.

```jbogenbau
%rule su-erasure
  | $stop(boundary) $g(gap) su-word
  | $stop(boundary) $g(gap) $reach(su-reach) $h(gap) su-word
%tags
  ("onset" ∪ "wipes-all") ∩ tags($stop) ∪ classes($stop) ∪ "continued"
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
  | $first(opener)
      <("first-onset" ∪ "first-cy" ∪ "continued" ∪ "cy" ∪ "cv" ∪ "y-letter" ∪ "final-stress" ∪ "name-intro") ∩ tags($first)
        ∪ ("cy" ∈ tags($first) ⟹ "continued")>
  | $s(su-reach) PAUSE $e(element)
      <("first-onset" ∪ "first-cy") ∩ tags($s) ∪ ("continued" ∪ "cy" ∪ "cv" ∪ "y-letter" ∪ "final-stress" ∪ "name-intro") ∩ tags($e)
        ∪ ("cy" ∈ tags($e) ⟹ "continued")>
  | $t(su-reach) $f(element)
      <("first-onset" ∪ "first-cy") ∩ tags($t) ∪ ("continued" ∪ "cy" ∪ "cv" ∪ "y-letter" ∪ "final-stress" ∪ "name-intro") ∩ tags($f)
        ∪ ("cv" ∈ tags($t) ∧ "y-letter" ∈ tags($f) ⟹ "cvcy")>
%conditions
  classes($first) ∩ ("NIhO" ∪ "LU" ∪ "TUhE" ∪ "TO") = ∅,
  "first-wipes" ∉ tags($first),
  classes($e) ∩ ("NIhO" ∪ "LU" ∪ "TUhE" ∪ "TO") = ∅,
  classes($f) ∩ ("NIhO" ∪ "LU" ∪ "TUhE" ∪ "TO") = ∅,
  "wipes-all" ∉ tags($e),
  "wipes-all" ∉ tags($f),
  ("continued" ∪ "cy" ∪ "cvcy" ∪ "name-intro") ∩ tags($t) ≠ ∅,
  "cy" ∈ tags($t) ∧ "cy" ∈ tags($f)
    ∨ "continued" ∈ tags($t) ∧ "onset" ∈ tags($f)
      ∧ ("cv" ∈ tags($t) ∨ "cvcy" ∉ tags($t) ∧ ("cy" ∉ tags($t) ∨ "cy" ∉ tags($f)))
      ∧ ("final-stress" ∉ tags($t) ∨ "stress-guard" ∉ tags($f))
    ∨ "cvcy" ∈ tags($t) ∧ "onset" ∈ tags($f) ∧ "BRIVLA" ∉ tags($f) ∧ ¬matches($f, lujvo-final-shape)
    ∨ "name-intro" ∈ tags($t) ∧ "name-onset" ∈ tags($f)
%emits
  ε

%rule su-word
  $q(magic-body)
%conditions
  "SU" ∈ classes($q)
%emits
  ε
```

A `su` with no boundary before it, or any `su` without `su-boundary`, erases everything back to the start of the text. So does a `sa` whose following word matches nothing before it, but the word after the `sa` stays. A run of `sa` that matches nothing is one unmatched `sa`. So is a run with fewer matches before it than it has `sa`: the reaches that did match are followed by more `sa` than there are reaches, in `sa-wipe-core`, and nothing before the furthest match has the selma'o the run looks for, so `mi klama sa sa do` is `do`. A `sa` at the end of the text, with no word after it, has no selma'o to look for and erases nothing, so `.i sa` is `.i`. The text rule accepts it after the stream.

What an unmatched `su` erases is a wiped stretch, which the text rule accepts before its stream. Every stretch that an unmatched `sa` or a `su` wipes runs back to the start of the text. So `wiped-reach` begins with `text-start`, which matches nothing and holds only where the input begins, as the notation's `initial` says. The parser therefore reads such a stretch only from the start of the text, and not from every position where a `su` or an unmatched `sa` could follow. The stretch can begin with earlier wiped stretches and stray `si`, `reach-prefix`, and then holds a stream or a bare `bu`, `reach-core`. An unmatched `sa`, with what it erases and the word it leaves, is the unit `sa-wiped`. So a `bu`, a `zei` or a `si` after that word acts on it, as on any other unit: `mi sa a bu` is the letter word `.abu`. Such a unit erases the whole text before it. It is tagged `wipes-all`, and so is every unit or erasure built on it. Only `opener` accepts an element with that tag, and it tags the stream `first-wipes`. Every rule that joins an element to what stands before it refuses the tag. A stream that opens with such an element can stand first in the text or after a wiped stretch, and the rules for a stream that stands after other text refuse `first-wipes`: the reach of `sa bu` or `sa le'u`, the reach of a `su` after its boundary, and the stream after a bare `bu`.

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
  | @su-boundary? $q(wiped-reach) $g(gap) su-word <"continued" ∪ ("first-onset" ∪ "first-cy") ∩ tags($q)>
  | @¬su-boundary? $v(wiped-reach) $j(gap) su-word <"continued" ∪ ("first-onset" ∪ "first-cy") ∩ tags($v)>
  | sa-run gap su-word <"onset" ∪ "continued" ∪ "first-onset">
  | $t(wiped-reach) $k(gap) sa-run gap su-word <"continued" ∪ ("first-onset" ∪ "first-cy") ∩ tags($t)>
%conditions
  classes($q) ∩ ("NIhO" ∪ "LU" ∪ "TUhE" ∪ "TO") = ∅,
  "continued" ∈ tags($q) ∨ phonemes($g) = ".",
  "continued" ∈ tags($v) ∨ phonemes($j) = ".",
  "continued" ∈ tags($t) ∨ phonemes($k) = "."

%rule sa-wiped
  | sa-run $h(sa-gap) $n(sa-next)
      <"onset" ∪ "wipes-all" ∪ ("continued" ∪ "cy" ∪ "cv" ∪ "y-letter" ∪ "final-stress" ∪ "name-intro") ∩ tags($n) ∪ classes($n)>
  | $r(wiped-reach) $g(gap) sa-run $h(sa-gap) $n(sa-next)
      <("first-onset" ∈ tags($r) ⟹ "onset") ∪ "first-cy" ∩ tags($r) ∪ "wipes-all"
        ∪ ("continued" ∪ "cy" ∪ "cv" ∪ "y-letter" ∪ "final-stress" ∪ "name-intro") ∩ tags($n) ∪ classes($n)>
  | $w(sa-wipe) $h(sa-gap) $n(sa-next)
      <("first-onset" ∈ tags($w) ⟹ "onset") ∪ "first-cy" ∩ tags($w) ∪ "wipes-all"
        ∪ ("continued" ∪ "cy" ∪ "cv" ∪ "y-letter" ∪ "final-stress" ∪ "name-intro") ∩ tags($n) ∪ classes($n)>
%conditions
  classes($r) ∩ classes($n) = ∅,
  classes($w) ∩ classes($n) ≠ ∅,
  "continued" ∈ tags($r) ∨ phonemes($g) = ".",
  "onset" ∈ tags($n) ∨ phonemes($h) ≠ ""

%rule wiped-reach
  text-start [PAUSE] $r(reach-body) <tags($r)>
%emits
  ε

%rule text-start
  ε
%conditions
  initial($)

%rule reach-body
  | $c(reach-core) <tags($c)>
  | $p(reach-prefix) $g(gap) $c(reach-core) <"first-onset" ∩ tags($p) ∪ ("continued" ∪ "first-wipes") ∩ tags($c) ∪ classes($c)>
%conditions
  "first-onset" ∈ tags($c) ∨ phonemes($g) = ".",
  "first-cy" ∉ tags($c) ∨ phonemes($g) = "."

%rule reach-prefix
  | stray-si <"continued">
  | $w(wiped) <tags($w)>
  | stray-si $g(gap) $w(wiped) <"continued">
%conditions
  "first-onset" ∈ tags($w) ∨ phonemes($g) = ".",
  "first-cy" ∉ tags($w) ∨ phonemes($g) = "."

%rule reach-core
  | $s(stream) <tags($s)>
  | bu-word <"first-onset" ∪ "continued">
  | bu-word $g(gap) $t(stream) <"first-onset" ∪ "continued" ∩ tags($t) ∪ classes($t)>
  | $l(erasures) gap bu-word <("onset" ∈ tags($l) ⟹ "first-onset") ∪ "continued">
  | $m(erasures) gap bu-word $h(gap) $u(stream)
      <("onset" ∈ tags($m) ⟹ "first-onset") ∪ "continued" ∩ tags($u) ∪ classes($u)>
%conditions
  "first-onset" ∈ tags($t) ∨ phonemes($g) = ".",
  "first-cy" ∉ tags($t) ∨ phonemes($g) = ".",
  "first-wipes" ∉ tags($t),
  "first-onset" ∈ tags($u) ∨ phonemes($h) = ".",
  "first-cy" ∉ tags($u) ∨ phonemes($h) = ".",
  "first-wipes" ∉ tags($u)
%emits
  ε
```

A stretch that an unmatched `sa` or a `su` wipes can contain a `bu` that has no word before it, because the proposal lets a bare `bu` stand in an erased stretch. So `bu sa broda`, `bu su broda` and `mi si bu sa broda` leave `broda`. Such a `bu` stands at the start of the text, after erasures that leave nothing before it, or after a wiped stretch. Anywhere else, a word or a unit stands before it, and the `bu` binds to that.

## Departures from CLL 19

This grammar reads the magic words as the Magic Words proposal of the definition effort defines them, not as CLL 19 describes them. The rules of CLL 19 for these words are incomplete, and some of them contradict each other. For example, 19.16 says that `si` erases the preceding word "unless it is a zo", but in Example 19.77 a `si` erases a `zo`. The proposal gives one order for all of these words: they act from left to right, each when it is read. Where the proposal says nothing, CLL 19 applies.

camxes-std, the PEG grammar of the definition effort, implements most of the proposal. It rejects some of the rarer cases, such as `bu si`, `.abu sa bu` and `mi ni'o do su si`. Its `sa` follows the grammatical reading of CLL 19.13: a `sa` erases back to the start of a sentence, a term or another construct that the words after the `sa` continue. So camxes-std rejects a `sa` with no such construct before it, as in `mi do sa brodi` or a `sa` at the start of the text. The proposal accepts both: a `sa` with no match erases back to the start of the text, and `mi do sa brodi` is `brodi`.

The proposal reads six kinds of text differently from CLL 19, and every dialect follows the proposal in each of them:

1. `si` erases a quote or a compound as one word. The proposal makes one word of each quote and each compound, and "SI erases the preceding word". CLL counts `zo` and its word as two words (Example 19.77) and a `zoi` quote as four (Example 19.79). A `lo'u` quote counts as its words and its two markers: 19.13 erases a stray `lo'u` with `fy. le'u si si si`. So Examples 19.77 and 19.80, `zo .bab. se cmene zo si si si la bab.` and `mi se cmene zo .djan. si si zo .djordj.`, are rejected here. In Example 19.79, `mi cusku zoi fy. gy. .fy. si si si si zo .djan`, the first `si` erases the whole `zoi` quote, the next two erase `cusku` and `mi`, and the last has nothing left to erase. The text is `zo .djan`. `lo'u broda le'u si` leaves nothing.
2. `zei` joins the word before it to the next word, whatever the next word is. CLL 19.16 says that `zei` "does not affect zo, si, sa, su, lo'u, ZOI cmavo, fa'o, and zei". The proposal's table reads `da zei fa'o` and `da zei zei` as lujvo, and the proposal says that "zei can quote constructs on the right that it cannot quote on the left". So `merko zei zo` is one lujvo, and `merko zei zo si` leaves nothing.
3. `bu` makes a letter word of `ba'e` and `za'e`. CLL 17.4 says that these two words "may not have bu attached", and 19.16 says the same of every BAhE cmavo. The proposal's table reads `ba'e bu` as a letter word, and the proposal says that "BAhE cannot be used to mark BU; BU wins".
4. Hesitation is not a word. The proposal treats `.y.` as whitespace, which is its third meta-rule. CLL makes `.y.` a cmavo of selma'o Y (19.14), and 19.16 says that `zo` quotes the following word "no matter what it is". Here, `zo .y. co` quotes `co`, `zo .y.` is rejected, and `co .y. si` erases `co`. The one exception is `.y. bu`, the letter word for `y`. The proposal forms it "before any other processing of any kind", which is its first meta-rule, so `zo .y. bu` quotes that letter word.
5. A `lo'u` quote ends at the first `le'u`. CLL 19.16 says that `lo'u` quotes all following words "up to a le'u (but not a zo le'u)", and 19.10 says that a `zoi` quote of non-Lojban text can appear inside `lo'u ... le'u`. The proposal's `lo'u` takes "all following Lojban words" through the next `le'u`, and its table rejects `lo'u co co zo le'u co le'u`. Here, `zo` and `zoi` are plain words inside the quote. So `lo'u zo le'u le'u` is rejected, and so is `lo'u zoi gy. with .gy. le'u`, because `with` is not a Lojban word. CLL 19.10 agrees that a `le'u` inside such a `zoi` quote ends the `lo'u` quote.
6. A `zoi` delimiter is compared as a whole word. CLL 19.10 says that the delimiter "may not appear" in the written text, so Example 19.50, `mi djuno fi le valsi po'u zoi gy. gyrations .gy.`, is "ungrammatical as written". Here, the delimiter must not be a word of the body, and `gyrations` is not the word `gy`, so the example is accepted. The proposal and camxes-std read it in the same way. The comparison is exact: the closing delimiter must have the same phonemes as the opening one. A stressed vowel does not match a plain one, so `zoi .kO. mi .ko.` is not a quote.

What `su` erases is not in this list, because there the dialects differ. The feature `su-boundary` chooses between the reading of CLL 19.13 and the reading of the proposal, as "Erasure by `sa` and `su`" explains.

## Choosing among parses

The stage declares `%ambiguity-resolution lazy`: where the grammar admits more than one parse of a text, the stage takes, at the first difference, the parse that closes a constituent over the one that reads the next phoneme; [the notation document](../../docs/notation.md), under "Ambiguity", states the rule. This is the mirror of the syntax stage, which is greedy, and the reason is CLL 4.6's tosmabru test: a word ends as early as the grammar allows, so `tosmabru` is `to smabru` and `lemiklama` is `le mi klama`, while `spageti` and `toirbroda` are one word each because the grammar allows no earlier end. It also says that an operator acts on what exists when it is read: `mi si si` erases `mi` and then nothing, rather than waiting to see whether more will be erased.

## Known gaps

Cyrillic and zbalermorna are read by the phoneme stage, so this grammar never sees them; what it does not read is a `zoi` quote whose delimiters are not set off by pauses.
