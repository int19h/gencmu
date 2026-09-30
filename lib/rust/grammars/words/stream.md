# The word stream

This document is the word stage, the third stage of every Lojban dialect: [CLL](../dialects/cll-ebnf.md), [approved word forms](../dialects/bpfk.md), [experimental](../dialects/experimental.md) and [Zantufa](../dialects/zantufa.md). A stage is one step of a pipeline, with its own grammar. A token is one unit that a stage reads or emits. Each stage reads the tokens that the stage before it emitted, and emits new tokens.

The prose uses these Lojban terms for words:

- A cmavo is a particle, a short structure word.
- A selma'o is a word class of cmavo.
- A brivla is a predicate word.
- A cmevla is a name word.
- A lujvo is a compound word.

The stage reads the source words that the forms stage divided ([forms.md](forms.md)). It hands the indicator stage the words of the text, each tagged with its class. A tag marks a token by name, phoneme or character. The tags are `word` on every word, `cmavo`, `BRIVLA` or `CMEVLA` by its shape, and every selma'o the lexicon gave it.

This document contributes the magic words, the constructs that act on the word stream before the syntax sees it. They are the quotes `zo`, `ma'oi`, `zoi`, `la'o`, `lo'u ... le'u`, `zo'oi` and its relatives, and the compounders `bu` and `zei`. They are also the erasers `si`, `sa` and `su`, hesitation, and `fa'o`. The stage resolves them together, in one grammar, because they act strictly left to right on one stream.

For example, `merko zei zo` is a `zei` compound whose second word is `zo`, because `zei` takes the word before any quote forms. And `fa fe si bu zei fi` erases `fe`, makes `fa bu`, and compounds it with `fi`. The stage resolves `sa` and `su`, the erasers that reach back over many words, in the same pass, because they act in the same order. The rules for all of these words come from the Magic Words proposal of the definition effort of the Logical Language Group. In six places, the proposal reads a text differently from CLL 19, and "Departures from CLL 19" lists them.

The forms stage, before this stage, decides where the words are and where the pauses between them are needed. A run of the text is a stretch with no pause in it. The forms stage divides each run into words, under the pause rules of the dialect's word forms, or makes the run one `FOREIGN` token. Every pause rule of those word forms holds within one run. So the division does not depend on the magic words, with one exception ([zantufa.md](zantufa.md)). In the Zantufa dialect, `ra'oi` changes how the forms stage divides the letters after it, in its own run or in the next.

This stage reads the words by their tags. This stage makes sure that the magic words have the pauses they need. These are the pauses around a `zoi` body and the end of a `zo'oi` quote. In the `cll-ebnf` dialect, [cll-stream.md](cll-stream.md) also makes sure that a name that `bu` takes has pauses around it. The stage applies no other pause requirements.

[The notation document](../../docs/notation.md) explains the notation. The stage's choice among parses, at the end of this document, is the mirror of the syntax stage's.

## The stream of elements

The text is a stream of elements and the pauses between them. An element is a word, a quote package, a `bu` or `zei` compound, an erasure, or hesitation. The stream is left-recursive, so each rule below joins one more element to what precedes it. A pause can stand between any two elements, but it does not have to. The forms stage already decided where one is needed.

The stage is lazy: where two parses differ, it takes the one that closes a constituent over the one that reads the next token. A constituent is a part of the text that one rule matched. "Choosing among parses" at the end of this document says why.

```jbogenbau
%ambiguity-resolution lazy
```

```jbogenbau
%rule text
  | ε | PAUSE
  | [PAUSE] body | [PAUSE] body PAUSE
  | [PAUSE] body⊇~sa-end gap hesitations [PAUSE]
  | [PAUSE] faho-group | [PAUSE] body gap faho-group
  | [PAUSE] body⊇~sa-end gap hesitations gap faho-group

%rule body
  | $t(body-tail) <tags($t)>
  | stray-si <∅>
  | stray-si gap $z(body-tail) <(~stream-end ∪ ~sa-end) ∩ tags($z)>

%rule body-tail
  | stream <~stream-end>
  | sa-su? sa-run <~sa-end>
  | sa-su? wiped <∅>
  | sa-su? wiped gap stream <~stream-end>
  | sa-su? stream gap sa-run <~sa-end>
  | sa-su? wiped gap sa-run <~sa-end>
  | sa-su? wiped gap stream gap sa-run <~sa-end>

%rule gap
  ε | PAUSE

%rule wide-gap
  gap | [PAUSE] hesitations [PAUSE]

%rule stream
  | $o(opener) <tags($o)>
  | $s(stream) PAUSE $e(element⊉~wipes-all) <tags($e) ∪ classes($s) ∪ ~first-wipes ∩ tags($s)>
  | $t(stream) $f(element⊉~wipes-all) <tags($f) ∪ classes($t) ∪ ~first-wipes ∩ tags($t)>

%rule opener
  | $o(element⊉~wipes-all) <tags($o)>
  | sa-su? $w(element⊇~wipes-all) <tags($w) ∪ ~first-wipes>

%rule element
  unit | erasure | hesitation

%rule unit
  | word | quote | lerfu-word | zei-compound
  | sa-su? sa-erasure | sa-su? sa-wiped | sa-su? su-boundary? su-erasure
```

A stream can open with an element that erases the whole text before it, tagged `wipes-all`. The opener then tags the stream `first-wipes`, and each join passes that tag on. "Erasure by `sa` and `su`" explains such elements.

Hesitation at the end of the text, or before `fa'o`, belongs to the stream when the body ends in one. This is because an element can always follow another. A body that ends in a stray `si` or in what `su` wiped can take a stream after it, which holds the hesitation. Only a body that ends in `sa`, tagged `sa-end`, cannot. So the text rule itself takes hesitation after such a body, as in `mi klama sa .y.`, and in `sayy` as the approved word forms write it. So a trailing `.y.` has one reading.

Besides the tags of its last element, the stream carries the union of the selma'o of every element in it. That is what tells a `sa` that nothing in its reach matches.

A `si` with nothing before it erases nothing (CLL 19.13 says what `si` erases, not that there must be something to erase). So does a run of them. This holds at the start of the text, and after hesitation there. It also holds after an erasure that already took everything before it, or after an unmatched `sa` or `su` that did so.

A `sa` directly before a `si` is such an unmatched `sa`. It looks for a word of `si`'s selma'o, which no word before it has, because every `si` already acted. So it erases back to the start of the text, and the `si` then has nothing to erase. A `bu` with no word before it to bind to can stand in the same places, and the first `si` erases it. The proposal says that `bu` and `le'u` "are never grammatical by themselves, but are grammatical as part of an utterance erased by sa, si, or su". So `bu si` is nothing, as is `mi si bu si`.

```jbogenbau
%rule stray-si
  | stray-run | hesitations [PAUSE] stray-run | [hesitations [PAUSE]] erasure [si-gap] stray-run
  | sa-su? wiped [si-gap] stray-run
  | sa-su? sa-run [si-gap] si-run
  | sa-su? wiped-reach gap sa-run [si-gap] si-run

%rule stray-run
  si-run | bu-word [si-gap] si-run

%rule si-run
  si-word | si-run [si-gap] si-word
```

Hesitation, `y` however long, has no grammatical meaning (CLL 19.14). As the Magic Words proposal has it, hesitation is not a word at all, which is the fourth of the departures from CLL 19. The stage drops it, except before `bu`, with or without a pause between them, where it is the base of the letter word `.y bu`.

The approved word forms read an odd run of three or more `y` as two words, `y` and the rest. For example, `yyybu` is `y`, `yy` and `bu`. So the base is every hesitation that stands before the `bu` with no pause between them. The proposal forms that letter word "before any other processing of any kind". So the stage never drops a hesitation before `bu`, wherever it stands. It can stand in the stream, in the gap after a quote marker, `si`, `sa` or `zei`, or inside `lo'u ... le'u`.

```jbogenbau
%rule hesitation
  $h(y-run) <∅>
%conditions
  ¬begins(after($h), bu-next)
%emits
  ε

%rule y-run
  ~hesitation

%rule bu-next
  [PAUSE] BU | ~hesitation bu-next

%rule y-base
  y-run | y-base y-run
```

`fa'o` ends the text (CLL 19.15): the stage does not read or hand on whatever follows it, so the group emits nothing. As the Magic Words proposal says, "No words are read to the right of FAhO, unconditionally". The forms stage reads `fa'o` as a word only where its run divides into words with `fa'o` as one of them. So `fa'omi` and `fa'obu` are `fa'o` alone, but `fa'oxxx`, whose run is foreign, is no text. Before it, the stage reads the stream as anywhere else, so `mifa'o` is `mi fa'o`.

```jbogenbau
%rule faho-group
  faho-word | faho-word zoi-body

%rule faho-word
  $q(magic-body)
%conditions
  FAhO ⊆ classes($q)
```

## Words

A word is a cmavo, a brivla or a cmevla, as the forms stage read it. The stage emits it as one token. The token carries the tags that the forms stage gave it: `word`, its kind, and the classes the lexicon gives a cmavo. A name is always `CMEVLA`.

A feature is a named switch that the grammars test. A guard is a condition on a feature. The cmevla-brivla merger of the experimental grammars is a matter of syntax, stated there with the `cbm` guard. It is not a second class on the word.

The magic words are never plain words. The rules under "Quotes", "Compounds" and "Erasure" say what each does instead. The condition here keeps them out, so that the stage cannot read `zo` as a word that stands beside the word it quotes. The constant `$MAGIC-WORDS` lists the classes of the magic words in the CLL and experimental lexicons, except LOhAI and LEhAI ([lohai.md](lohai.md)). A dialect with other magic words adds their classes to it in one place. Without the feature `sa-su`, `sa` and `su` are plain words.

```jbogenbau
%const $MAGIC-WORDS
  ZO ∪ ZOI ∪ LOhU ∪ ZOhOI ∪ MEhOI ∪ FAhO ∪ BU ∪ ZEI ∪ SI ∪ SA ∪ SU

%rule word
  | sa-su? $c(cmavo-token) <tags($c)>
  | ¬sa-su? $e(cmavo-token) <tags($e)>
  | $b(BRIVLA) <tags($b)>
  | $n(CMEVLA) <tags($n)>
%conditions
  classes($c) ∩ $MAGIC-WORDS = ∅,
  classes($e) ∩ ($MAGIC-WORDS ∖ (SA ∪ SU)) = ∅,
  ¬begins(from($c), quote),
  ¬begins(from($e), quote)
%emits
  $

%rule cmavo-token
  $c(~cmavo) <tags($c)>
```

Every rule that reads a cmavo as a Lojban word reads it as `cmavo-token`, so that a dialect can add to what that means. The `cll-ebnf` dialect warns there for a cmavo that uses `y` as a vowel beyond the forms CLL gives ([cll-stream.md](cll-stream.md)).

The rules below know a magic word by the selma'o the lexicon gives it, not by its spelling. A cmavo's stress is free (CLL 3.9), and the lexicon reads a stressed vowel as the plain one. So `zO` quotes as `zo` does. Also, the dialect's lexicon decides which words are magic. So `ma'oi` and `zo'oi`, which CLL does not have, are quote words only where the dialect's lexicon gives them their classes. The experimental lexicon does so for both, and the Zantufa lexicon for `ma'oi`.

```jbogenbau
%rule magic-body
  $q(~cmavo) <tags($q)>
```

## Quotes

CLL 19.9 and 19.10 describe the quotes. This stage decides each quote, because the words inside a quote do not count as words. For example, `zo si` quotes `si`, and a `zoi` body is not Lojban at all.

Each quote hands the syntax stage its marker and its contents. The contents are bare words or one stretch of `foreign-text`, which is what the syntax grammar's `any-word` and `anything` read. The marker keeps its classes, and the tags `word` and `cmavo`: `classes($q) ∪ ~word ∪ ~cmavo`. It drops every other mark, so it never carries `indicator`. That holds even where the marker is also an attitudinal, which the forms stage's implication marks `indicator`. The word stage has no implication that adds the mark again.

The reason is the indicator stage, which takes single tokens. It reads a marker with `indicator` as an indicator, and leaves the quoted contents behind with nothing to hold them. For example, take a lexicon that puts `ui` in both ZO and UI. Then `mi ui broda klama` fails if the marker keeps `indicator`. The indicator stage attaches `ui` to `mi`, and the bare word `broda` is left in the text. This lasts until the indicator stage can take a quote as one unit.

```jbogenbau
%rule quote
  quoted-word | zoi-quote | empty-zoi-quote | lohu-quote | single-word-quote
```

`zo` and `ma'oi` quote the next word, whatever it is, except hesitation, which is not a word. So `zo y co` quotes `co`, and `zo .y'y.` quotes the letter word. The Magic Words proposal makes `.y. bu` a letter word "before any other processing of any kind", so `zo .y. bu` quotes that letter word.

```jbogenbau
%rule quoted-word
  $m(word-quote-marker) quote-gap $w(quotable-word) <tags($m)>
%emits
  $m, $w <~word>

%rule word-quote-marker
  $q(magic-body) <classes($q) ∪ ~word ∪ ~cmavo>
%conditions
  ZO ⊆ classes($q)

%rule quotable-word
  cmavo-token | BRIVLA | CMEVLA | y-bu-word

%rule y-bu-word
  y-base [PAUSE] bu-word
```

A word of ZOhOI or MEhOI, such as `zo'oi` or `me'oi`, quotes the next run of characters up to a pause. A quote attached to its marker, with no pause between them, takes the rest of the marker's run. The forms stage must divide that whole run into source words. Otherwise it makes the run one foreign token, with no marker in it. So `zo'oiklama` quotes `klama`, but the word stage rejects `zo'oixxx`. After a pause, the quote can take foreign text, as in `zo'oi xxx`.

After a pause, the quote skips hesitation, as camxes-exp skips it in its `spaces`. Then the quote takes the next token and the rest of that token's run. So `zo'oiyymibroda` quotes `yymibroda`, `zo'oi yy mibroda` and `zo'oi yymibroda` quote `mibroda`, and `zo'oi yy` has nothing to quote. The quote ends where its run ends, `run-final` on its last token. Otherwise the lazy choice of the stage quotes only `mi` of `zo'oi mibroda`.

`zoi` and `la'o` quote a body between two delimiter words, and so does `mu'oi` in the Zantufa dialect ([zantufa-stream.md](zantufa-stream.md)). The two delimiters must be the same word. That word must not be a whole run of the body, so the quote ends at the first run that is that word. The delimiter can occur inside a longer run of the body. This is the sixth of the departures from CLL 19.

The stage compares the words by their canonical sound, `phonemes()`, which is in lower case and has no commas. So stress and syllable breaks do not count, in the two delimiters and in the runs of the body. `zoi .kO. mi .ko.` is a quote, and so is `zoi .ko. mi .kO.`. That is the condition the captures state, and the parser makes sure that it holds as the parse advances.

So a run of the body that is not the delimiter never ends the quote. CLL 4.9 puts a pause before and after the body. This stage also requires the closing delimiter to be the last word of its run, because it finds the delimiter as a whole run. So `zoi mi. x mi. klama` is a quote, and the word stage rejects `zoi mi. x mibroda klama`.

A quote whose delimiters stand side by side quotes nothing. Its body is an empty foreign part, so it sounds `?` and has the shape of any other body. The one pause between the delimiters comes before that body, so a letter word over the quote sounds `zoi.gy.?gy.bu`.

Other parsers also compared the delimiters without case. CLL's official parser lowercases every word as it reads it, and keeps only its letters and apostrophes. ilmentufa's camxes lowercased both delimiters, dropped their commas and wrote `h` as an apostrophe. Its commit 2534c3b of 2020 replaced those actions with generic ones, which compare the words exactly. Pierre Abbat's design of 2003, on the Lojban mailing list, matches the closing delimiter "ignoring capitalization and commas".

The delimiter is the word after the marker. The stage takes it when it reads the marker, before a `bu` after it can act, as camxes-std reads it. So `zoi ba'e bu ba'e bu` quotes `bu` between two `ba'e`, and the last `bu` makes a letter word of the quote. And `zoi .ibu. x .ibu.` is no quote, because the delimiter `i` needs a pause after it.

No compound formed with `bu` is a delimiter, not even `.y. bu`. But a letter word such as `gy` or `y'y` is a delimiter. So `zoi .y. bu. x .y. bu.` is no quote, because hesitation is no word, and the stage never drops a hesitation before `bu`. So a delimiter is always one word, and a quote always ends at the first run of its body that is the delimiter.

The body of a `zoi` quote and the run that `zo'oi` quotes are `%foreign`. So the syntax receives a token that sounds `?`, whatever the body holds. Its label is the text as written, with its punctuation. The stage still compares the delimiters, and each run of the body, by their phonemes. A run that the phoneme stage made foreign sounds `?` there, so it never matches a delimiter.

```jbogenbau
%rule single-word-quote
  | $m(single-marker) $r(zohoi-payload) <tags($m)>
  | $m(single-marker) PAUSE [hesitations [PAUSE]] $s(zohoi-payload) <tags($m)>
%conditions
  ~run-final ⊆ tags(last($r)),
  ~run-final ⊆ tags(last($s)),
  ~hesitation ⊈ tags(head($s)) ∨ begins(after(head($s)), bu-next)
%emits
  $m, $r <~foreign-text>, $s <~foreign-text>

%rule single-marker
  $q(magic-body) <classes($q) ∪ ~word ∪ ~cmavo>
%conditions
  classes($q) ∩ (ZOhOI ∪ MEhOI) ≠ ∅

%rule zoi-quote
  $m(zoi-marker) quote-gap $open(delimiter) PAUSE $content(zoi-body) PAUSE $close(delimiter)
%tags
  tags($m)
%conditions
  phonemes($open) = phonemes($close),
  phonemes($open) ∉ split(phonemes($content), "."),
  ~run-final ⊆ tags($close)
%emits
  $m, $open <~word>, $content <~foreign-text>, $close <~word>

%rule empty-zoi-quote
  $m(zoi-marker) quote-gap $open(delimiter) PAUSE $content(empty-zoi-body) $close(delimiter)
%tags
  tags($m)
%conditions
  phonemes($open) = phonemes($close),
  ~run-final ⊆ tags($close)
%emits
  $m, $open <~word>, $content <~foreign-text>, $close <~word>

%rule empty-zoi-body
  ε
%foreign

%rule delimiter
  cmavo-token | BRIVLA | CMEVLA

%rule zoi-marker
  $q(magic-body) <classes($q) ∪ ~word ∪ ~cmavo>
%conditions
  ZOI ⊆ classes($q)
```

Inside `lo'u ... le'u` the words are ordinary words, but no quote marker opens anything and no eraser erases. So a `lo'u` stretch is a stream of bare words. The quote ends at the first `le'u`, even after a `zo`, which is the fifth of the departures from CLL 19. The quote can be empty, `lo'u le'u`, as a `zoi` quote can. The stage drops hesitation inside the quote, as it does everywhere (the fourth of the departures from CLL 19). So `lo'u .y. le'u` quotes nothing, as camxes-std reads it.

`.y. bu` inside the quote is the letter word, which the proposal forms before anything else. The stage hands on the words inside as bare words, and the markers as `LOhU` and `LEhU`. It hands on the closing marker as `LEhU` alone, not also as a word. So the syntax cannot read it as one more quoted word and look for a later `le'u`.

For `sa`, the quote has the selma'o of both its markers, as the Magic Words proposal says. `sa lo'u` erases back to the start of the last quote and opens a new one. `sa le'u` "destroys everything since the end of the last LOhU...LEhU quote". It does so "replacing the terminating LEhU with a new LEhU (i.e. not changing the quote at all)". `lehu-close` reads such a stretch as the quote's closing. So `lo'u co le'u broda sa le'u` is the quote `lo'u co le'u`.

The ordinary erasure by `sa` does not take a `le'u` after it. The grammar states the stretch, `lehu-reach`, as it states the reach of a `sa`. The stretch is left-recursive, and it evaluates its condition at each element. So it ends at the first element with the selma'o of either marker. A stretch stated as a stream runs on from every `le'u` to the end of the text.

```jbogenbau
%rule lohu-quote
  | $m(lohu-marker) gap lohu-stream gap lehu-close
  | $m(lohu-marker) [PAUSE] lehu-close
%tags
  tags($m) ∪ LEhU

%rule lohu-marker
  $q(magic-body) <classes($q) ∪ ~word ∪ ~cmavo>
%conditions
  LOhU ⊆ classes($q)
%emits
  $

%rule lehu-marker
  $q(magic-body) <classes($q) ∪ ~word ∪ ~cmavo>
%conditions
  LEhU ⊆ classes($q)
%emits
  $ <LEhU>

%rule lehu-close
  | lehu-marker
  | sa-su? lehu-erased [PAUSE] sa-word sa-gap lehu-marker
  | sa-su? lehu-erased gap lehu-reach gap sa-word sa-gap lehu-marker

%rule lehu-erased
  $q(magic-body)
%conditions
  LEhU ⊆ classes($q)
%emits
  ε

%rule lehu-reach
  | $first(opener)
  | $s(lehu-reach) PAUSE $e(element)
  | $t(lehu-reach) $f(element)
%conditions
  classes($first) ∩ (LOhU ∪ LEhU) = ∅,
  ~first-wipes ⊈ tags($first),
  classes($e) ∩ (LOhU ∪ LEhU) = ∅,
  classes($f) ∩ (LOhU ∪ LEhU) = ∅,
  ~wipes-all ⊈ tags($e),
  ~wipes-all ⊈ tags($f)
%emits
  ε

%rule lohu-stream
  | lohu-element
  | lohu-stream PAUSE lohu-element
  | lohu-stream lohu-element

%rule lohu-element
  lohu-word | hesitation

%rule lohu-word
  | $c(cmavo-token)
  | BRIVLA
  | CMEVLA
  | y-bu-word
%conditions
  LEhU ⊈ classes($c)
%emits
  $ <~word>
```

The gap between a marker and its word is an optional pause, with hesitation allowed inside it. The hesitation is runs of `y` with pauses between them. A quoted body is any run of tokens, pauses included, and a `zo'oi` quote any run of tokens up to a pause. A foreign run can appear there, and nowhere else but after `fa'o`.

```jbogenbau
%rule quote-gap
  [PAUSE] | [PAUSE] hesitations PAUSE | [PAUSE] hesitations

%rule hesitations
  | hesitation
  | hesitations PAUSE hesitation
  | hesitations hesitation

%rule zoi-body
  any-token | zoi-body any-token
%foreign

%rule zohoi-payload
  payload-token | zohoi-payload payload-token
%foreign

%rule any-token
  payload-token | PAUSE

%rule payload-token
  ~word | ~hesitation | FOREIGN
```

## Compounds

CLL 17.4 and 4.6: any word followed by `bu` is a letter word, which counts as a `BY` when `sa` looks for a match. Any two words joined by `zei` are one brivla. The operand of `bu` and the left operand of `zei` are whatever the stream already produced: a word, a quote or a compound. This is because the operators act on what exists when the stage reads them. A `si` erasure can sit between an operand and its operator, because the erased word is no longer there for the operator to see.

The right operand of `zei` is the next word whatever it is, a quote marker or an eraser included. That is why `merko zei zo` is a compound: `zei` takes the word before that word acts. This is the proposal's reading, the second of the departures from CLL 19. So is a letter word of `ba'e` or `za'e`, the third.

A compound is one word (CLL 4.6, 17.4). The stage hands it on as one token, a `BY` for `bu` and a `BRIVLA` for `zei`. The syntax grammar reads that token as it reads any letter word or brivla. The syntax grammar keeps its printed rules `any-word BU` and `any-word ZEI any-word` for fidelity, and they never match.

The forms stage tags the first word of each run `run-initial`, and a `sa` that leaves a word standing passes that tag on. The `cll-ebnf` dialect uses it: there a name that `bu` takes needs a pause on both sides of it ([cll-stream.md](cll-stream.md)).

```jbogenbau
%rule lerfu-word
  | $u(unit) bu-part <~word ∪ BY ∪ ~wipes-all ∩ tags($u)>
  | $u(unit) PAUSE bu-part <~word ∪ BY ∪ ~wipes-all ∩ tags($u)>
  | $u(unit) erasure-gap bu-part <~word ∪ BY ∪ ~wipes-all ∩ tags($u)>
  | y-base [PAUSE] bu-part <~word ∪ BY>
%emits
  $

%rule bu-word
  $q(magic-body)
%conditions
  BU ⊆ classes($q)

%rule bu-part
  bu-word | bu-replacement

%rule bu-replacement
  | sa-su? bu-erased [PAUSE] sa-word sa-gap bu-word
  | sa-su? bu-erased gap bu-reach gap sa-word sa-gap bu-word

%rule bu-erased
  $q(magic-body)
%conditions
  BU ⊆ classes($q)
%emits
  ε

%rule bu-reach
  | $first(opener)
  | $s(bu-reach) PAUSE $e(element)
  | $t(bu-reach) $f(element)
%conditions
  classes($first) ∩ (BY) = ∅,
  ~first-wipes ⊈ tags($first),
  classes($e) ∩ (BY) = ∅,
  classes($f) ∩ (BY) = ∅,
  ~wipes-all ⊈ tags($e),
  ~wipes-all ⊈ tags($f)
%emits
  ε

%rule zei-compound
  | $l(unit) zei-word zei-right
  | $l(unit) zei-before-gap zei-word zei-right
  | $l(unit) zei-word zei-after-gap zei-right
  | $l(unit) zei-before-gap zei-word zei-after-gap zei-right
%tags
  ~word ∪ BRIVLA ∪ ~wipes-all ∩ tags($l)
%emits
  $

%rule zei-before-gap
  | PAUSE
  | [PAUSE] skipped-hesitations [PAUSE]
  | [PAUSE] [skipped-hesitations [PAUSE]] gap-erasures [PAUSE] [skipped-hesitations [PAUSE]]

%rule zei-after-gap
  PAUSE | [PAUSE] skipped-hesitations [PAUSE]

%rule skipped-hesitations
  hesitations
%emits
  ε

%rule zei-word
  $q(magic-body)
%conditions
  ZEI ⊆ classes($q)

%rule zei-right
  cmavo-token | BRIVLA | CMEVLA | y-bu-word

%rule erasure-gap
  [PAUSE] [skipped-hesitations [PAUSE]] gap-erasures [PAUSE]

%rule gap-erasures
  | erasure⊉~wipes-all
  | gap-erasures wide-gap erasure⊉~wipes-all
```

`sa bu` "backs up to the last BU, pulling an already constructed pseudo-word apart", as the proposal puts it among its unique cases. It erases back to the `bu` of the last letter word, and the new `bu` binds to that letter word's base again. So `.abu sa bu` is `.abu`. `bu-part` reads such a stretch as the letter word's `bu`. Nothing between can be a letter word, because the `bu` of that letter word is then the last `bu`. So the grammar states `bu-reach` as it states the reach of a `sa`, and `bu-reach` ends at the first letter word.

A pause can stand between an operand and its operator, and so can erasures, with pauses around them. Hesitation can stand on either side of `zei`, because the proposal treats `.y.` as whitespace. So `mi .y. zei broda` is the lujvo `mi zei broda`, as camxes-std and camxes-exp read it. The hesitation emits nothing, so it is not part of what the compound sounds like. After `zei`, `.y. bu` is the letter word, so `da zei .y. bu` is a lujvo of `da` and that letter.

## Erasure by `si`

CLL 19.13: `si` erases the word before it. As in the Magic Words proposal, a compound or a quote counts as one word, which is the first of the departures from CLL 19. A run of `si` erases as many words. For example, `broda brode si si` erases both. The rule states this as an erasure whose unit is followed by one or more erasures, and then by the `si` that erases the unit. And `klama co si gunka si si` erases `co`, then `gunka`, then `klama`.

Hesitation is not a word, so it can stand between the word and its `si`: `co .y. si` erases `co`. An erased stretch emits nothing. What a `sa` or `su` leaves standing is a unit, so a following `si` erases it.

An eraser acts when the stage reads it, as the Magic Words proposal has it. So a `si` never erases a `sa` or `su` as though it were a word. For example, under the feature `su-boundary`, `mi ni'o do su si` erases back to the `ni'o` first, and the `si` then erases that.

```jbogenbau
%rule erasure
  | $u(unit) si-word <~wipes-all ∩ tags($u)>
  | $u(unit) si-gap si-word <~wipes-all ∩ tags($u)>
  | $u(unit) erasures⊉~wipes-all [si-gap] si-word <~wipes-all ∩ tags($u)>
  | $u(unit) si-gap erasures⊉~wipes-all [si-gap] si-word <~wipes-all ∩ tags($u)>
%emits
  ε

%rule erasures
  | $d(erasure) <tags($d)>
  | $r(erasures) si-gap erasure⊉~wipes-all <tags($r)>
  | $r(erasures) erasure⊉~wipes-all <tags($r)>

%rule si-gap
  PAUSE | [PAUSE] hesitations [PAUSE]

%rule si-word
  $q(magic-body)
%conditions
  SI ⊆ classes($q)
```

## Erasure by `sa` and `su`

These two erasers are behind the feature `sa-su`. They are the most expensive part of the word grammar. A `sa` can reach back to any earlier word. The parser does not know whether a `sa` will come, so it keeps a possible reach open from the most recent word of each selma'o. That multiplies the work for each word by the number of selma'o in use. They are also rare in written text.

Without the feature, `sa` and `su` are ordinary cmavo of SA and SU, which the syntax grammars do not accept. The syntax rejects a token of SA or SU that is still there after this stage, but another magic word can act on it first.

CLL 19.13: `sa` erases back to the most recent word of the same selma'o as the word after it, that word included. It leaves the word after it standing.

In CLL 19.13, `su` "erases the entire text". The Magic Words proposal and camxes-std stop `su` sooner, at the most recent `ni'o`, `no'i`, `lu`, `tu'e`, `to` or `to'i`, which survives. CLL 1.0 prints a YACC grammar (a grammar for the parser generator YACC) in its chapter 21. That grammar opens with the steps that a parser takes before the grammar. Its step 2g also stops `su` at a word of NIhO, LU, TUhE or TO, but it erases that word too.

The feature `su-boundary` gives the reading of the proposal. The approved word forms and experimental dialects turn it on. The CLL and Zantufa dialects leave it off, so there `su` erases the whole text before it. The stage resolves both erasers here, in the same left-to-right pass as the quotes, the compounds and `si`, because they act in that order. For example, in `mi le brodi sa le si la brodo` the `sa` takes `le brodi` before the `si` erases the `le` that follows it. And `mi brodi .i sa mi zei co mi` compounds `mi zei co` only after the `sa` took `mi brodi .i`.

The grammar states the reach of a `sa` from its far end. `sa-open` is an element, which has some selma'o, and the elements after it. None of those elements has a class of the first one's, so the `sa` that follows finds the nearest match. It is left-recursive and evaluates the class condition at every step, so that a reach dies at the first element that matches.

This left-recursive form keeps the chart (the parser's table of partial parses) linear in the length of the text. A reach stated as an element followed by a whole stream does not keep it linear. This is because a stream can start anywhere and cannot know which class it keeps clear of.

The match is by selma'o: the first element's classes and the classes of the word after `sa` must share one. Hesitation can stand between a `sa` and the word after it, as between a word and its `si`. What the `sa` leaves is the word after it: a word, a quote, or the letter word `.y. bu`, which the proposal forms before anything else. It is never another compound, because the `sa` acts before a `bu` or `zei` after that word does. The stage then builds the compound on what the `sa` left.

The erasure carries the classes of that word, so that a later `sa` can match it in turn. It also carries whether that word began its run, for a `bu` after it.

Several `sa` in a row reach back to successively further matches, "one for each SA", as the Magic Words proposal says. So two `sa` erase back to the second-nearest match, three to the third, and so on. The erased text is then as many reaches as there are `sa`, each beginning at a match. The reaches are followed by the `sa` themselves, which `sa-nest` pairs from the inside out. It pairs the innermost reach with the first `sa`, and the next reach back with the second.

```jbogenbau
%rule sa-erasure
  $first(sa-nest) sa-gap $next(sa-next)
%tags
  ~wipes-all ∩ tags($first) ∪ classes($next) ∪ ~run-initial ∩ tags($next)
%conditions
  classes($first) ∩ classes($next) ≠ ∅,
  LEhU ⊈ classes($next) ∨ LOhU ⊆ classes($next)

%rule sa-nest
  | $o(sa-open) gap sa-word <classes($o) ∪ ~wipes-all ∩ tags($o)>
  | $a(sa-open) gap $n(sa-nest) wide-gap sa-word <classes($a) ∩ classes($n) ∪ ~wipes-all ∩ tags($a)>
%conditions
  classes($a) ∩ classes($n) ≠ ∅
%emits
  ε

%rule sa-open
  | $first(element) <classes($first) ∪ ~wipes-all ∩ tags($first)>
  | $s(sa-open) PAUSE $e(element) <classes($s) ∪ ~wipes-all ∩ tags($s)>
  | $t(sa-open) $f(element) <classes($t) ∪ ~wipes-all ∩ tags($t)>
%conditions
  classes($first) ≠ ∅,
  ~wipes-all ⊈ tags($e),
  ~wipes-all ⊈ tags($f),
  classes($s) ∩ classes($e) = ∅,
  classes($t) ∩ classes($f) = ∅
%emits
  ε

%rule sa-wipe
  | $c(sa-wipe-core) <tags($c)>
  | $r(wiped-reach) gap $c(sa-wipe-core) <classes($c)>
%conditions
  classes($r) ∩ classes($c) = ∅

%rule sa-wipe-core
  | $o(sa-open) gap sa-run-twice <classes($o)>
  | $a(sa-open) gap $n(sa-wipe-core) wide-gap sa-word <classes($a) ∩ classes($n)>
%conditions
  classes($a) ∩ classes($n) ≠ ∅
%emits
  ε

%rule sa-next
  word | quote | y-bu-letter

%rule y-bu-letter
  y-base [PAUSE] bu-word <~word ∪ BY>
%emits
  $

%rule sa-gap
  wide-gap

%rule sa-word
  $q(magic-body)
%conditions
  SA ⊆ classes($q)
%emits
  ε

%rule sa-run
  sa-word | sa-run wide-gap sa-word

%rule sa-run-twice
  sa-word wide-gap sa-run
```

With `su-boundary`, `su` erases back to a boundary word, which survives, or to the start of the text. Without it, `su` always erases back to the start of the text. The boundary words are ordinary words to every other rule. Only `su` knows them, by their classes, which the constant `$SU-STOPS` lists. What a `su` erases is a reach none of whose elements has one of those classes.

Like the reach of a `sa`, the reach of a `su` is left-recursive, and it evaluates its condition at every element as it goes. So it dies at the next boundary, and does not run on to the end of the text. The boundary is an element, so that what an earlier `su` left standing bounds the next.

```jbogenbau
%rule su-erasure
  | $stop(boundary) gap su-word
  | $stop(boundary) gap su-reach gap su-word
%tags
  ~wipes-all ∩ tags($stop) ∪ classes($stop)

%const $SU-STOPS
  NIhO ∪ LU ∪ TUhE ∪ TO

%rule boundary
  $b(element) <tags($b)>
%conditions
  classes($b) ∩ $SU-STOPS ≠ ∅

%rule su-reach
  | $first(opener)
  | $s(su-reach) PAUSE $e(element)
  | $t(su-reach) $f(element)
%conditions
  classes($first) ∩ $SU-STOPS = ∅,
  ~first-wipes ⊈ tags($first),
  classes($e) ∩ $SU-STOPS = ∅,
  classes($f) ∩ $SU-STOPS = ∅,
  ~wipes-all ⊈ tags($e),
  ~wipes-all ⊈ tags($f)
%emits
  ε

%rule su-word
  $q(magic-body)
%conditions
  SU ⊆ classes($q)
%emits
  ε
```

A `su` with no boundary before it, or any `su` without `su-boundary`, erases everything back to the start of the text. So does a `sa` whose following word matches nothing before it, but the word after the `sa` stays. A run of `sa` that matches nothing is one unmatched `sa`. So is a run with fewer matches before it than it has `sa`.

In `sa-wipe-core`, the reaches that did match are followed by more `sa` than there are reaches. Nothing before the furthest match has the selma'o that the run looks for. So `mi klama sa sa do` is `do`.

A `sa` at the end of the text, with no word after it, has no selma'o to look for. It erases nothing, so `.i sa` is `.i`. The text rule accepts it after the stream.

What an unmatched `su` erases is a wiped stretch, which the text rule accepts before its stream. Every stretch that an unmatched `sa` or a `su` wipes runs back to the start of the text. So `wiped-reach` begins with `text-start`, which matches nothing and holds only where the input begins, as the notation's `initial` says. As a result, the parser reads such a stretch only from the start of the text. It does not read one from every position where a `su` or an unmatched `sa` can follow. The stretch can begin with earlier wiped stretches and stray `si`, `reach-prefix`, and then holds a stream or a bare `bu`, `reach-core`.

An unmatched `sa`, with what it erases and the word it leaves, is the unit `sa-wiped`. So a `bu`, a `zei` or a `si` after that word acts on it, as on any other unit: `mi sa a bu` is the letter word `.abu`. Such a unit erases the whole text before it. The grammar tags it `wipes-all`, and also every unit or erasure built on it.

Only `opener` accepts an element with that tag, and it tags the stream `first-wipes`. Every rule that joins an element to what stands before it refuses the tag. A stream that opens with such an element can stand first in the text or after a wiped stretch. The rules for a stream that stands after other text refuse `first-wipes`. These rules are the reach of `sa bu` or `sa le'u`, the reach of a `su` after its boundary, and the stream after a bare `bu`.

```jbogenbau
%rule wiped
  | $i(wiped-item)
  | wiped-prefix gap $i(wiped-item)
%tags
  tags($i)

%rule wiped-prefix
  $w(wiped) <tags($w)>

%rule wiped-item
  | su-word <∅>
  | su-boundary? $q(wiped-reach) gap su-word <∅>
  | ¬su-boundary? wiped-reach gap su-word <∅>
  | sa-run wide-gap su-word <∅>
  | wiped-reach gap sa-run wide-gap su-word <∅>
%conditions
  classes($q) ∩ $SU-STOPS = ∅

%rule sa-wiped
  | sa-run sa-gap $n(sa-next) <~wipes-all ∪ classes($n) ∪ ~run-initial ∩ tags($n)>
  | $r(wiped-reach) gap sa-run sa-gap $n(sa-next) <~wipes-all ∪ classes($n) ∪ ~run-initial ∩ tags($n)>
  | $w(sa-wipe) sa-gap $n(sa-next) <~wipes-all ∪ classes($n) ∪ ~run-initial ∩ tags($n)>
%conditions
  classes($r) ∩ classes($n) = ∅,
  classes($w) ∩ classes($n) ≠ ∅

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
  | reach-prefix gap $c(reach-core) <~first-wipes ∩ tags($c) ∪ classes($c)>

%rule reach-prefix
  | stray-si <∅>
  | $w(wiped) <tags($w)>
  | stray-si gap wiped <∅>

%rule reach-core
  | $s(stream) <tags($s)>
  | bu-word <∅>
  | bu-word gap $t(stream⊉~first-wipes) <classes($t)>
  | erasures gap bu-word <∅>
  | erasures gap bu-word gap $u(stream⊉~first-wipes) <classes($u)>
  | hesitations [PAUSE] erasures⊉~wipes-all gap bu-word <∅>
  | hesitations [PAUSE] erasures⊉~wipes-all gap bu-word gap $u(stream⊉~first-wipes) <classes($u)>
%emits
  ε
```

A stretch that an unmatched `sa` or a `su` wipes can contain a `bu` that has no word before it. This is because the proposal lets a bare `bu` stand in an erased stretch. So `bu sa broda`, `bu su broda` and `mi si bu sa broda` leave `broda`. Such a `bu` stands at the start of the text, after erasures that leave nothing before it, or after a wiped stretch. Anywhere else, a word or a unit stands before it, and the `bu` binds to that.

## Departures from CLL 19

This grammar reads the magic words as the Magic Words proposal of the definition effort defines them, not as CLL 19 describes them. The rules of CLL 19 for these words are incomplete, and some of them contradict each other. For example, 19.16 says that `si` erases the preceding word "unless it is a zo", but in Example 19.77 a `si` erases a `zo`. The proposal gives one order for all of these words: they act from left to right, each when a parser reads it. Where the proposal says nothing, CLL 19 applies.

camxes-std, the PEG grammar (parsing expression grammar) of the definition effort, implements most of the proposal. It rejects some of the rarer cases, such as `bu si`, `.abu sa bu` and `mi ni'o do su si`. Its `sa` follows the grammatical reading of CLL 19.13. In that reading, a `sa` erases back to the start of a sentence, a term or another construct that the words after the `sa` continue. So camxes-std rejects a `sa` with no such construct before it, as in `mi do sa brodi` or a `sa` at the start of the text. The proposal accepts both: a `sa` with no match erases back to the start of the text, and `mi do sa brodi` is `brodi`.

camxes-std also applies its rule unevenly. It accepts `broda sa broda`, but it rejects `lo broda sa broda`, where the description is the construct that the words after the `sa` continue. The proposal reads the two alike: `broda` and `lo broda`.

The proposal reads six kinds of text differently from CLL 19. The Zantufa dialect departs from two of them ([zantufa-stream.md](zantufa-stream.md)). Its `zei` erases a word and joins nothing (item 2). A hesitation attached to the word before it is a word of class Y there (item 4). Every other dialect follows the proposal in all six:

1. `si` erases a quote or a compound as one word. The proposal makes one word of each quote and each compound, and "SI erases the preceding word". CLL counts `zo` and its word as two words (Example 19.77) and a `zoi` quote as four (Example 19.79). A `lo'u` quote counts as its words and its two markers: 19.13 erases a stray `lo'u` with `fy. le'u si si si`. So every dialect rejects Examples 19.77 and 19.80, `zo .bab. se cmene zo si si si la bab.` and `mi se cmene zo .djan. si si zo .djordj.`.

   Example 19.79 is `mi cusku zoi fy. gy. .fy. si si si si zo .djan`. There, the first `si` erases the whole `zoi` quote, and the next two erase `cusku` and `mi`. The last `si` has nothing left to erase, and the text is `zo .djan`. `lo'u broda le'u si` leaves nothing.
2. `zei` joins the word before it to the next word, whatever the next word is. CLL 19.16 says that `zei` "does not affect zo, si, sa, su, lo'u, ZOI cmavo, fa'o, and zei". The proposal's table reads `da zei fa'o` and `da zei zei` as lujvo, and the proposal says that "zei can quote constructs on the right that it cannot quote on the left". So `merko zei zo` is one lujvo, and `merko zei zo si` leaves nothing.
3. `bu` makes a letter word of `ba'e` and `za'e`. CLL 17.4 says that these two words "may not have bu attached", and 19.16 says the same of every BAhE cmavo. The proposal's table reads `ba'e bu` as a letter word, and the proposal says that "BAhE cannot be used to mark BU; BU wins".
4. Hesitation is not a word. The proposal treats `.y.` as whitespace, which is its third meta-rule. CLL makes `.y.` a cmavo of selma'o Y (19.14), and 19.16 says that `zo` quotes the following word "no matter what it is". Here, `zo .y. co` quotes `co`, the grammar rejects `zo .y.`, and `co .y. si` erases `co`. The one exception is `.y. bu`, the letter word for `y`. The proposal forms it "before any other processing of any kind", which is its first meta-rule, so `zo .y. bu` quotes that letter word.
5. A `lo'u` quote ends at the first `le'u`. CLL 19.16 says that `lo'u` quotes all following words "up to a le'u (but not a zo le'u)", and 19.10 says that a `zoi` quote of non-Lojban text can appear inside `lo'u ... le'u`. The proposal's `lo'u` takes "all following Lojban words" through the next `le'u`, and its table rejects `lo'u co co zo le'u co le'u`. Here, `zo` and `zoi` are plain words inside the quote. So every dialect rejects `lo'u zo le'u le'u`, and also `lo'u zoi gy. with .gy. le'u`, because `with` is not a Lojban word. CLL 19.10 agrees that a `le'u` inside such a `zoi` quote ends the `lo'u` quote.
6. The grammar compares a `zoi` delimiter as a whole word. CLL 19.10 says that the delimiter "may not appear" in the written text, so Example 19.50, `mi djuno fi le valsi po'u zoi gy. gyrations .gy.`, is "ungrammatical as written". Here, the delimiter must not be a whole run of the body, and the run `gyrations` is not `gy`, so the grammar accepts the example. The proposal and camxes-std read it in the same way. The comparison is by the canonical sound, so a stressed vowel matches a plain one, and `zoi .kO. mi .ko.` is a quote.

What `su` erases is not in this list, because there the dialects differ. The feature `su-boundary` chooses between the reading of CLL 19.13 and the reading of the proposal, as "Erasure by `sa` and `su`" explains.

## Choosing among parses

The stage declares `%ambiguity-resolution lazy`. Where the grammar admits more than one parse of a text, the stage looks at the first difference. There it takes the parse that closes a constituent over the one that reads the next token. [The notation document](../../docs/notation.md) states the rule, under "Ambiguity".

The forms stage decides where the words are, so what the choice decides is how the magic words act. An operator acts on what exists when the stage reads it. So `mi si si` erases `mi` and then nothing. It does not wait to see whether the text erases more. This is the mirror of the syntax stage, which is greedy.

## Known gaps

The phoneme stage reads Cyrillic and zbalermorna, so this grammar never sees them. What it does not read is a `zoi` quote with no pauses around its delimiters. The grammar rejects `sa .y. bu sa bu`, although `sa a bu sa bu` is `a bu`. The second `sa` cannot replace the `bu` of the letter word `.y bu`, which the first `sa` leaves standing as one word.
