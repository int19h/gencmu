# The Zantufa word stream

This document is part of the word stage in the [Zantufa](../dialects/zantufa.md) dialect. It is stitched in after [the word stream](stream.md), and it changes what the Zantufa lexicon's classes alone do not. The reference is Zantufa 1.9999, whose rules the comments give. The notation is explained in [the notation document](../../docs/notation.md).

Most of Zantufa's magic words follow from its lexicon. SI is `si`, `zei`, `ze'ei` and `si'u'i`, so each erases the word before it, and no word joins two words into a lujvo. `sa` is an attitudinal. ZO is `zo`, `ma'oi` and `ra'ai`, LOhU is `lo'u` and `la'ai`, and ZOI is `zoi` and `la'o`.

A word of GOhOI (`go'oi`, `ze'oi`, `ta'ai` and `bo'ei`) quotes the next Lojban word, as `zo` does. It does not quote the rest of a run, so `go'oi mido` quotes `mi` and leaves `do`.

```jbogenbau
%redefine-rule word-quote-marker
  (* ZO_pre <- pre_clause ZO spaces? any_word spaces?;  GOhOI_pre <- pre_clause GOhOI spaces? any_word spaces? *)
  $q(magic-body) <"word" ∪ "cmavo" ∪ classes($q)>
%conditions
  classes($q) ∩ ("ZO" ∪ "GOhOI") ≠ ∅

%redefine-rule single-marker
  $q(magic-body) <"word" ∪ "cmavo" ∪ classes($q)>
%conditions
  classes($q) ∩ ("ZOhOI" ∪ "LAhOI" ∪ "MEhOI" ∪ "ZEhOI" ∪ "TAhAI" ∪ "BOhEI") ≠ ∅
```

`ra'oi` quotes the rafsi or gismu form that the forms stage read after it ([zantufa.md](zantufa.md)), with or without a pause between them.

```jbogenbau
%extend-rule quote
  rahoi-quote

%rule rahoi-quote
  $m(rahoi-marker) quote-gap $f("rafsi-form") <tags($m)>
%emits
  $m, $f <"foreign-text">

%rule rahoi-marker
  $q(magic-body) <"word" ∪ "cmavo" ∪ classes($q)>
%conditions
  "RAhOI" ∈ classes($q)
```

`mu'oi` quotes a body between two delimiters, as `zoi` does. Zantufa compares the two delimiters without their stress, so `zoi .ko. x .kO.` is a quote. The condition compares the phonemes without capitals, which is how the phonemes mark stress.

```jbogenbau
%redefine-rule zoi-marker
  (* ZOI_pre <- pre_clause ZOI spaces? zoi_open spaces? zoi_word* zoi_close spaces?;  MUhOI_pre likewise *)
  $q(magic-body) <"word" ∪ "cmavo" ∪ classes($q)>
%conditions
  classes($q) ∩ ("ZOI" ∪ "MUhOI") ≠ ∅

%redefine-rule zoi-quote
  $m(zoi-marker) quote-gap $open(delimiter) PAUSE $content(zoi-body) PAUSE $close(delimiter)
%tags
  tags($m)
%conditions
  lowercase(phonemes($open)) = lowercase(phonemes($close)),
  phonemes($open) ∉ runs($content),
  lowercase(phonemes($open)) ∉ runs($content),
  "run-final" ∈ tags($close)
%emits
  $m, $open <"word">, $content <"foreign-text">, $close <"word">

%redefine-rule empty-zoi-quote
  $m(zoi-marker) quote-gap $open(delimiter) PAUSE $close(delimiter)
%tags
  tags($m)
%conditions
  lowercase(phonemes($open)) = lowercase(phonemes($close)),
  "run-final" ∈ tags($close)
%emits
  $m, $open <"word">, "foreign-text", $close <"word">
```

A replacement quote is one unit, as in Zantufa's `si_word`. It is up to two runs of words, each opened by a word of LOhAI (`lo'ai` or `sa'ai`), and then `le'ai`. The words inside are plain words, so no `si` erases inside it, and a `si` after it erases all of it: `lo'ai mi le'ai si` is nothing. The syntax reads it as a free modifier.

```jbogenbau
%extend-rule quote
  (* LOhAI_pre <- pre_clause (LOhAI spaces? (!LOhAI !LEhAI any_word)* )? (LOhAI spaces? (!LOhAI !LEhAI any_word)* )? LEhAI spaces? *)
  lohai-quote

%rule lohai-quote
  | lehai-marker
  | lohai-run gap lehai-marker
  | lohai-run gap lohai-run gap lehai-marker

%rule lohai-run
  lohai-marker | lohai-marker gap lohai-stream

%rule lohai-stream
  | lohai-element
  | lohai-stream PAUSE lohai-element
  | lohai-stream lohai-element

%rule lohai-element
  lohai-word | hesitation

%rule lohai-word
  | $c(cmavo-token)
  | BRIVLA
  | CMEVLA
  | y-bu-word
%conditions
  classes($c) ∩ ("LOhAI" ∪ "LEhAI") = ∅
%emits
  $ <"word">

%rule lohai-marker
  $q(magic-body) <"word" ∪ "cmavo" ∪ classes($q)>
%conditions
  "LOhAI" ∈ classes($q)
%emits
  $

%rule lehai-marker
  $q(magic-body) <"word" ∪ "cmavo" ∪ classes($q)>
%conditions
  "LEhAI" ∈ classes($q)
%emits
  $
```

Zantufa reads `y` and `ie'o` as space only after a pause or at the start of the text, since its `spaces` begins with `!Y`. A hesitation attached to the word before it, with no pause between them, is a word of class Y there. So `zoie'o mi` quotes `ie'o` and leaves `mi`, while `zo ie'o mi` quotes `mi`. Such a word has no place in the syntax except in a quote, so `coyysi` is rejected, as Zantufa rejects it. Before `bu`, hesitation stays the base of a letter word.

```jbogenbau
%redefine-rule hesitation
  (* spaces <- !Y initial_spaces *)
  $h(y-run) <∅>
%conditions
  ¬begins(after($h), bu-next),
  ("run-initial" ∪ "spacing") ∩ tags($h) ≠ ∅
%emits
  ε

%rule attached-y
  $h("hesitation") <"word" ∪ "cmavo" ∪ "Y">
%conditions
  ("run-initial" ∪ "spacing") ∩ tags($h) = ∅,
  ¬begins(after($h), bu-next)
%emits
  $

%extend-rule unit
  attached-y

%extend-rule quotable-word
  attached-y

%extend-rule lohu-word
  attached-y

%extend-rule lohai-word
  attached-y

%redefine-rule bu-next
  (* ybu <- Y space_char* BU: one Y word, which may be several pieces of one run of y *)
  | [PAUSE] BU
  | $h("hesitation") bu-next
%conditions
  "after-hesitation" ∈ tags($h)

%redefine-rule y-base
  | y-run
  | $b(y-base) $h(y-run) <tags($h)>
%conditions
  "after-hesitation" ∈ tags($h)
```

A magic word is never a plain word. The stream's list of them lacks MUhOI, LOhAI and LEhAI, which only Zantufa reads so. A word of LU, TO or LUhEI that is read as a word, and not quoted, opens a text of its own. So the hesitation that the forms stage tagged `opener-space` after it is space, and the word takes it with it. Inside a quote, such a hesitation is an attached Y word, as in `zo luyy si`, which erases the `yy` and keeps `zo lu`.

```jbogenbau
%redefine-rule word
  | @sa-su? $c(cmavo-token) <tags($c)>
  | @¬sa-su? $e(cmavo-token) <tags($e)>
  | $b(BRIVLA) <tags($b)>
  | $n(CMEVLA) <tags($n)>
  | $o(text-opener) $p(opener-spaces) <tags($o)>
%conditions
  ¬begins(after($p), opener-space-token),
  classes($c) ∩ ("LU" ∪ "TO" ∪ "LUhEI") = ∅ ∨ ¬begins(after($c), opener-space-token),
  classes($e) ∩ ("LU" ∪ "TO" ∪ "LUhEI") = ∅ ∨ ¬begins(after($e), opener-space-token),
  classes($c) ∩ ("ZO" ∪ "ZOI" ∪ "MUhOI" ∪ "LOhAI" ∪ "LEhAI" ∪ "LOhU" ∪ "ZOhOI" ∪ "LAhOI" ∪ "RAhOI" ∪ "MEhOI" ∪ "GOhOI" ∪ "ZEhOI" ∪ "TAhAI" ∪
    "BOhEI" ∪ "FAhO" ∪ "BU" ∪ "ZEI" ∪ "SI" ∪ "SA" ∪ "SU") = ∅,
  classes($e) ∩ ("ZO" ∪ "ZOI" ∪ "MUhOI" ∪ "LOhAI" ∪ "LEhAI" ∪ "LOhU" ∪ "ZOhOI" ∪ "LAhOI" ∪ "RAhOI" ∪ "MEhOI" ∪ "GOhOI" ∪ "ZEhOI" ∪ "TAhAI" ∪
    "BOhEI" ∪ "FAhO" ∪ "BU" ∪ "ZEI" ∪ "SI") = ∅
%emits
  $

%rule text-opener
  $q(cmavo-token) <tags($q)>
%conditions
  classes($q) ∩ ("LU" ∪ "TO" ∪ "LUhEI") ≠ ∅
%emits
  $

%rule opener-spaces
  $h(opener-space-token) [opener-spaces]
%emits
  ε

%rule opener-space-token
  (* initial_spaces <- (space_char / !ybu Y)+: a hesitation before bu is no space *)
  $h("hesitation")
%conditions
  "opener-space" ∈ tags($h),
  ¬begins(after($h), bu-next)
```

A quote word that opens no quote is an ordinary word in Zantufa, which `si` erases. Zantufa's `si_word` tries the quotes first, and then reads any cmavo but `bu`, a word of SI or SU, and `fa'o`. So `zoi si broda` is `broda`, and `lo'u si` is nothing. Such a marker is a unit only before its `si`, and only where no quote begins at it, since Zantufa tries the quote first. `zo` and the words of GOhOI always quote the next word, so they are never bare.

```jbogenbau
%extend-rule erasure
  (* si_word <- ... / !BU !SI !SU !FAhO CMAVO *)
  | $b(bare-marker) si-word
  | $b(bare-marker) si-gap si-word
  | $b(bare-marker) $f(erasures) [si-gap] si-word
  | $b(bare-marker) si-gap $f(erasures) [si-gap] si-word
%conditions
  ¬begins(from($b), quote),
  "wipes-all" ∉ tags($f)
%emits
  ε

%rule bare-marker
  $q(magic-body)
%conditions
  classes($q) ∩ ("ZOI" ∪ "MUhOI" ∪ "LOhU" ∪ "LOhAI" ∪ "ZOhOI" ∪ "LAhOI" ∪ "RAhOI" ∪ "MEhOI" ∪ "ZEhOI" ∪ "TAhAI" ∪ "BOhEI") ≠ ∅
```

A `bu` makes a letter word of such a marker too, and of `su`, as Zantufa's `bu_clause` does. So `zoi bu`, `lo'u bu` and `su bu` are letter words, and `mi su bu si` is `mi`. A `su` before `bu` erases nothing, since Zantufa's `SU_clause` does not stand before `bu`.

```jbogenbau
%extend-rule lerfu-word
  (* bu_clause_no_pre <- (si_word / SU spaces?) bu_tail+ lerfu_post_clause *)
  | $b(bare-marker) [PAUSE] bu-part <"word" ∪ "BY">
  | $b(bare-marker) erasure-gap bu-part <"word" ∪ "BY">
  | $s(su-letter-base) [PAUSE] bu-part <"word" ∪ "BY">
  | $s(su-letter-base) erasure-gap bu-part <"word" ∪ "BY">
%conditions
  ¬begins(from($b), quote)
%emits
  $

%rule su-letter-base
  $q(magic-body)
%conditions
  "SU" ∈ classes($q)

%redefine-rule su-word
  $q(magic-body)
%conditions
  "SU" ∈ classes($q),
  ¬begins(after($q), bu-next)
%emits
  ε
```
