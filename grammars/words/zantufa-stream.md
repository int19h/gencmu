# The Zantufa word stream

This document is part of the word stage in the [Zantufa](../dialects/zantufa.md) dialect. A stage is one step of a pipeline, with its own grammar. A token is a unit such as a phoneme or a word. Each stage reads the tokens that the stage before it emitted, and emits new tokens.

The dialect includes this document after [the word stream](stream.md). The document changes what the Zantufa lexicon's classes alone do not. The reference is Zantufa 1.9999, whose rules the comments give. [The notation document](../../docs/notation.md) explains the notation.

The prose uses these Lojban terms for words:

- A cmavo is a particle, a short structure word.
- A gismu is a root word.
- A lujvo is a compound word.
- A rafsi is a short form of a word inside a compound.

Magic words act on other words. Examples are quotes and erasers. Most of Zantufa's magic words follow from its lexicon. SI is `si`, `zei`, `ze'ei` and `si'u'i`, so each erases the word before it, and no word joins two words into a lujvo. `sa` is an attitudinal. ZO is `zo`, `ma'oi` and `ra'ai`, LOhU is `lo'u` and `la'ai`, and ZOI is `zoi` and `la'o`.

A word of GOhOI (`go'oi`, `ze'oi`, `ta'ai` and `bo'ei`) quotes the next Lojban word, as `zo` does. It does not quote the rest of a run (a stretch with no internal pause), so `go'oi mido` quotes `mi` and leaves `do`. The Zantufa lexicon has no word of ZOhOI or MEhOI. So no Zantufa word quotes the rest of a run.

```jbogenbau
%redefine-rule word-quote-marker
  (* ZO_pre <- pre_clause ZO spaces? any_word spaces?;  GOhOI_pre <- pre_clause GOhOI spaces? any_word spaces? *)
  $q(magic-body) <classes($q) ∪ ~word ∪ ~cmavo>
%conditions
  classes($q) ∩ (ZO ∪ GOhOI) ≠ ∅
```

`ra'oi` quotes the rafsi or gismu form that the forms stage read after it ([zantufa.md](zantufa.md)), with or without a pause between them.

```jbogenbau
%extend-rule quote
  rahoi-quote

%rule rahoi-quote
  $m(rahoi-marker) quote-gap $f(~rafsi-form) <tags($m)>
%emits
  $m, $f <~foreign-text>

%rule rahoi-marker
  $q(magic-body) <classes($q) ∪ ~word ∪ ~cmavo>
%conditions
  RAhOI ⊆ classes($q)
```

`mu'oi` quotes a body between two delimiters, as `zoi` does. Zantufa compares the two delimiters in lower case, so `zoi .ko. x .kO.` is a quote. So does every dialect, which compares them by their canonical sound ([the word stream](stream.md)). So the dialect needs only the marker.

```jbogenbau
%redefine-rule zoi-marker
  (* ZOI_pre <- pre_clause ZOI spaces? zoi_open spaces? zoi_word* zoi_close spaces?;  MUhOI_pre likewise *)
  $q(magic-body) <classes($q) ∪ ~word ∪ ~cmavo>
%conditions
  classes($q) ∩ (ZOI ∪ MUhOI) ≠ ∅
```

Zantufa reads `y` and `ie'o` as space only after a pause or at the start of the text, because its `spaces` begins with `!Y`. A hesitation attached to the word before it, with no pause between them, is a word of class Y there. So `zoie'o mi` quotes `ie'o` and leaves `mi`, while `zo ie'o mi` quotes `mi`. Such a word has no place in the syntax except in a quote, so the dialect rejects `mi cuyy klama`, as Zantufa does. Before `bu`, hesitation stays the base of a letter word.

In a `lo'u` or `lo'ai` quote, such a word is tagged `word` only, as the other words of the quote are. An extension does not take the clauses of its base rule, so the two extensions state that emission again.

```jbogenbau
%redefine-rule hesitation
  (* spaces <- !Y initial_spaces *)
  $h(y-run) <∅>
%conditions
  ¬begins(after($h), bu-next),
  (~run-initial ∪ ~spacing) ∩ tags($h) ≠ ∅
%emits
  ε

%rule attached-y
  $h(~hesitation) <~word ∪ ~cmavo ∪ Y>
%conditions
  (~run-initial ∪ ~spacing) ∩ tags($h) = ∅,
  ¬begins(after($h), bu-next)
%emits
  $

%extend-rule unit
  attached-y

%extend-rule quotable-word
  attached-y

%extend-rule lohu-word
  attached-y
%emits
  $ <~word>

%extend-rule lohai-word
  attached-y
%emits
  $ <~word>

%redefine-rule bu-next
  (* ybu <- Y space_char* BU: one Y word, which may be several pieces of one run of y *)
  | [PAUSE] BU
  | ~hesitation⊇~after-hesitation bu-next

%redefine-rule y-base
  | y-run
  | $b(y-base) $h(y-run⊇~after-hesitation) <tags($h)>
```

A magic word is never a plain word. The stream's list of them, `$MAGIC-WORDS`, lacks RAhOI, GOhOI and MUhOI, which only Zantufa has. It also lacks LOhAI and LEhAI. The experimental dialect reads a bare marker of these as a plain word, and Zantufa does not. This document adds all five classes to the list.

A word of LU, TO or LUhEI, the classes of `$TEXT-OPENERS`, that this stage reads as an unquoted word opens a text of its own. The forms stage gives the tag (a name on a token) `opener-space` to the hesitation after such a word. So that hesitation is space, and the word takes it with it. Inside a quote, such a hesitation is an attached Y word, as in `zo luyy si`, which erases the `yy` and keeps `zo lu`.

```jbogenbau
%redefine-const $MAGIC-WORDS
  $MAGIC-WORDS ∪ RAhOI ∪ GOhOI ∪ MUhOI ∪ LOhAI ∪ LEhAI

%const $TEXT-OPENERS
  LU ∪ TO ∪ LUhEI

%redefine-rule word
  | sa-su? $c(cmavo-token) <tags($c)>
  | ¬sa-su? $e(cmavo-token) <tags($e)>
  | $b(BRIVLA) <tags($b)>
  | $n(CMEVLA) <tags($n)>
  | $o(text-opener) $p(opener-spaces) <tags($o)>
%conditions
  ¬begins(after($p), opener-space-token),
  classes($c) ∩ $TEXT-OPENERS = ∅ ∨ ¬begins(after($c), opener-space-token),
  classes($e) ∩ $TEXT-OPENERS = ∅ ∨ ¬begins(after($e), opener-space-token),
  classes($c) ∩ $MAGIC-WORDS = ∅,
  classes($e) ∩ ($MAGIC-WORDS ∖ (SA ∪ SU)) = ∅
%emits
  $

%rule text-opener
  $q(cmavo-token) <tags($q)>
%conditions
  classes($q) ∩ $TEXT-OPENERS ≠ ∅
%emits
  $

%rule opener-spaces
  $h(opener-space-token) [opener-spaces]
%emits
  ε

%rule opener-space-token
  (* initial_spaces <- (space_char / !ybu Y)+: a hesitation before bu is no space *)
  $h(~hesitation)
%conditions
  ~opener-space ⊆ tags($h),
  ¬begins(after($h), bu-next)
```

The forms stage hands on the form after `ra'oi` as a `rafsi-form` token, even where that `ra'oi` opens no quote. So a `zoi` body, a `zoi` delimiter and the text after `fa'o` take that token as they take any other word. `fa'o ra'oi broda` is `fa'o` and what it ignores, and `zoi broda ra'oi broda` quotes `ra'oi`, as in Zantufa.

```jbogenbau
%extend-rule payload-token
  ~rafsi-form

%extend-rule delimiter
  ~rafsi-form
```

A quote word that opens no quote is an ordinary word in Zantufa, which `si` erases. Zantufa's `si_word` tries the quotes first, and then reads any cmavo but `bu`, a word of SI or SU, and `fa'o`. So `zoi si broda` is `broda`, and `lo'u si` is nothing. Such a marker is a unit only before its `si`, and only where no quote begins at it, because Zantufa tries the quote first. `zo` and the words of GOhOI always quote the next word, so they are never bare. So a bare marker is a word of ZOI, MUhOI, LOhU, LOhAI or RAhOI, the other quotes of `si_word`.

```jbogenbau
%extend-rule erasure
  (* si_word <- ... / !BU !SI !SU !FAhO CMAVO *)
  | $b(bare-marker) si-word
  | $b(bare-marker) si-gap si-word
  | $b(bare-marker) $f(erasures) [si-gap] si-word
  | $b(bare-marker) si-gap $f(erasures) [si-gap] si-word
%conditions
  ¬begins(from($b), quote),
  ~wipes-all ⊈ tags($f)
%emits
  ε

%rule bare-marker
  $q(magic-body)
%conditions
  classes($q) ∩ (ZOI ∪ MUhOI ∪ LOhU ∪ LOhAI ∪ RAhOI) ≠ ∅
```

A `bu` makes a letter word of such a marker too, and of `su`, as Zantufa's `bu_clause` does. So `zoi bu`, `lo'u bu` and `su bu` are letter words, and `mi su bu si` is `mi`. A `su` before `bu` erases nothing, because Zantufa's `SU_clause` does not stand before `bu`.

```jbogenbau
%extend-rule lerfu-word
  (* bu_clause_no_pre <- (si_word / SU spaces?) bu_tail+ lerfu_post_clause *)
  | $b(bare-marker) [PAUSE] bu-part <~word ∪ BY>
  | $b(bare-marker) erasure-gap bu-part <~word ∪ BY>
  | $s(su-letter-base) [PAUSE] bu-part <~word ∪ BY>
  | $s(su-letter-base) erasure-gap bu-part <~word ∪ BY>
%conditions
  ¬begins(from($b), quote)
%emits
  $

%rule su-letter-base
  $q(magic-body)
%conditions
  SU ⊆ classes($q)

%redefine-rule su-word
  $q(magic-body)
%conditions
  SU ⊆ classes($q),
  ¬begins(after($q), bu-next)
%emits
  ε
```
