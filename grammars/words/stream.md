# The word stream

This document defines the word stage of cll-ebnf, bpfk, experimental, and Zantufa. A stage reads the tokens from the previous stage and emits tokens for the next stage.

The [forms stage](forms.md) supplies source words. This stage applies quotes, compounds, erasers, hesitation, and FAhO. The [notation document](../../docs/notation.md) defines the rules below.

A unit is one item on which an operation acts. A token is one emitted item for the next stage. Every quote and compound is one opaque unit, even when its emission contains several tokens.

The grammar follows the maintainer's opaque-unit interpretation of the Magic Words proposal. It processes every operation strictly from left to right. Only the shared word reader joins hesitation with BU before an operation takes the word.

## The stream of elements

The stream contains live units and erased regions. A live unit is one item that an eraser or compounder takes. A quote can emit several tokens but remains one unit.

The stage reads from left to right. Each operator acts on the units that survive when the stage reaches it. No operator reaches inside a unit.

A shared word reader supplies every requested word. It joins hesitation with a following `bu` before any operation takes that word. This exception applies inside word quotes and to delimiters and compound operands.

An erased region emits nothing. Later operators skip that region and use the surviving units beside it. Erasure never restores an earlier erased word.

The grammar uses lazy ambiguity resolution. It favors a completed constituent over another token at the first difference. The rules enforce the operation order before this choice applies.

A dangling `bu` creates a unit with a missing-base fault. A dangling `le'u` creates a unit with an unopened-quote fault. Constructors preserve these faults, and erasers remove the whole units.

A second `bu` wraps a fault unit like any other unit. Thus `bu bu si` leaves nothing. A fault that survives normal end or active `fa'o` rejects the word stage.

Hesitation emits nothing unless the word reader joins it with `bu`. The reader treats `yybu` as hesitation followed by the letter word for y.

An active `fa'o` ends the text. The stage reads no words after it. A quoted `fa'o` or a right operand of `zei` does not end the text.

BAhE marks the next word in the indicator stage. It remains a separate unit during word operations. The dialects keep `mi ba'e fa'o` rejected because the surviving BAhE has no target.

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

```jbogenbau
%rule faho-group
  faho-word | faho-word zoi-body

%rule faho-word
  $q(magic-body)
%conditions
  FAhO ⊆ classes($q)
```

## Words

The forms stage supplies source words, their lexical classes, and their run boundaries. A run is a stretch without a pause. This stage does not divide ordinary runs again.

The shared reader reads a cmavo, brivla, cmevla, or the letter word for y. A cmavo is a particle. A brivla is a predicate word. A cmevla is a name word.

Every cmavo read uses `cmavo-token`. The CLL dialect adds optional word-form warnings there. A committed read keeps its warning even if an eraser later removes the word.

A failed word stage publishes no warnings from that stage. A successful stage keeps warnings from its selected derivation. Raw quote bodies and the suffix after active `fa'o` supply no word reads.

The lexicon gives each cmavo its classes. Operators use these classes rather than spelling. The experimental syntax can treat names as predicates without changing their lexical class.

The feature `sa-su` enables the two long-range erasers. Without that feature, SA and SU are ordinary words. The wrapper named `word` preserves automatic feature detection.

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

```jbogenbau
%rule magic-body
  $q(~cmavo) <tags($q)>
```

## Quotes

Every complete quote is one opaque unit. Later operations see its opening marker class and no class from its contents or closing marker. The indicator and syntax stages receive the quote's emitted tokens.

A quote marker keeps its word kind and classes but drops the `indicator` mark. Otherwise the indicator stage can detach a marker from its quoted contents.

ZO quotes one word from the shared reader. Inside that quote, an eraser, compounder, or quote marker executes no operation. The reader still forms the letter word for y.

ZOhOI and MEhOI quote one raw run in the experimental dialect. After a pause, they skip ordinary hesitation. The quote must finish at the end of its run.

ZOI and LAhO read an opening delimiter through the shared reader. They close at the first matching whole run by canonical sound. Canonical sound ignores case and commas.

The letter-y delimiter can close on one `ybu` run or adjacent `y` and `bu` runs. The reader accepts both opening spellings. The closing test preserves adjacency and never joins the body into words.

The body remains raw and opaque. In `zoi bu. foo .y. bu.`, the final `bu` closes the quote. The preceding y remains body text.

Ordinary compounds cannot become delimiters because the marker reads the delimiter before a later compounder acts. Empty quotes still emit an opaque body token. Pauses delimit the body and the closing run.

A LOhU quote ends at the first LEhU. Its body reads shielded Lojban words through the shared reader. No quote marker or eraser acts there, and an unread run rejects the quote.

The completed LOhU unit exposes LOhU alone to SA. LEhU closes the quote but supplies no later search target inside it. Replacement quotes and dialect quote kinds follow the same opacity rule.

```jbogenbau
%rule quote
  quoted-word | zoi-quote | empty-zoi-quote | lohu-quote | single-word-quote
```

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

```jbogenbau
%rule single-word-quote
  | $m(single-marker) $r(zohoi-payload) <tags($m)>
  | $m(single-marker) PAUSE [hesitations [PAUSE]] $s(zohoi-payload) <tags($m)>
%conditions
  ~run-final ⊆ tags(last($r)),
  ~run-final ⊆ tags(last($s)),
  ~hesitation ⊈ tags(head($s)) ∨ begins(after(head($s)), bu-next)
%emits
  $m, $r <~quoted-text>, $s <~quoted-text>

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
  $m, $open <~word>, $content <~quoted-text>, $close <~word>

%rule empty-zoi-quote
  $m(zoi-marker) quote-gap $open(delimiter) PAUSE $content(empty-zoi-body) $close(delimiter)
%tags
  tags($m)
%conditions
  phonemes($open) = phonemes($close),
  ~run-final ⊆ tags($close)
%emits
  $m, $open <~word>, $content <~quoted-text>, $close <~word>

%rule empty-zoi-body
  ε
%opaque

%rule delimiter
  cmavo-token | BRIVLA | CMEVLA

%rule zoi-marker
  $q(magic-body) <classes($q) ∪ ~word ∪ ~cmavo>
%conditions
  ZOI ⊆ classes($q)
```

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

```jbogenbau
%rule quote-gap
  [PAUSE] | [PAUSE] hesitations PAUSE | [PAUSE] hesitations

%rule hesitations
  | hesitation
  | hesitations PAUSE hesitation
  | hesitations hesitation

%rule zoi-body
  any-token | zoi-body any-token
%opaque

%rule zohoi-payload
  payload-token | zohoi-payload payload-token
%opaque

%rule any-token
  payload-token | PAUSE

%rule payload-token
  ~word | ~hesitation | UNREAD
```

## Compounds

BU takes the preceding live unit and forms one BY unit. ZEI takes that unit and the next word as read, then forms one BRIVLA unit.

The right word of ZEI executes no operation. Thus `.abu zei bu` has a literal BU operand. In `da zei de bu`, the final BU takes the completed compound.

The constructors can repeat and combine without exposing their operands. Each result keeps any fault of its base. SI erases the complete result as one unit.

Erased regions and ordinary hesitation can separate an operand from its operator. The constructors omit these regions from the emitted compound. Their warnings still belong to the selected derivation.

The CLL dialect requires pauses around a direct name base of BU. It tests the source run boundary. A name inside a compound does not make that compound a direct name.

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

## Erasure by `si`

SI erases the preceding live unit. Quotes and compounds each count as one unit. A run of SI removes that many units and then does nothing on an empty stream.

SI skips hesitation and erased regions. It never erases an already executed SA or SU as a word. A fault unit is an ordinary operand for erasure.

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

SA reads its key from the next word before that word executes. It erases through the nearest preceding unit whose class matches that key. The next word stays and then executes normally.

The key of `sa .ebu` is the class of `.e`. BU has not yet formed that letteral. A letteral has class BY, so `sa bu` finds no BU inside it.

With no matching unit, SA erases everything before it. Thus `mi bu sa bu` removes the letteral and leaves a dangling BU fault. A later eraser can remove that fault.

Counted SA selects the second-nearest match for two markers, the third-nearest for three, and so on. The grammar nests one reach per marker. Too few matches erase the whole prefix.

SA at normal end has no key and erases nothing. SA before active FAhO uses FAhO as its key, erases the prefix, and then ends the text.

A reach carries classes of whole live units. It excludes nearer matching units and skips erased regions. It never searches original source words inside a quote or compound.

In cll-ebnf, SU erases everything before it. In bpfk, experimental, and Zantufa, SU stops at the last NIhO, LU, TUhE, or TO unit. That boundary survives.

The feature `su-boundary` selects the surviving-boundary policy. A boundary inside an opaque unit cannot stop SU. With no boundary, SU erases the whole prefix.

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

## Departures from CLL 19

The dialects use the left-to-right model of the [Magic Words proposal](https://mw.lojban.org/papri/Magic_Words), with the departures below. The maintainer chooses opaque units where that proposal exposes internal markers.

CLL 19.13 describes erasure, 19.14 describes hesitation, and 19.15 describes FAhO. CLL 19.16 describes interactions among these words. These sections do not specify one complete processing order.

The dialects keep six established departures from CLL 19. Zantufa instead makes ZEI an eraser and gives attached hesitation a lexical Y class.

1. SI erases a whole quote or compound. CLL Examples 19.77 and 19.79 count quotation markers and contents as separate words.
2. ZEI takes any next word as its right operand. CLL 19.16 excludes several magic words from that interaction.
3. BU forms a letteral over BAhE. CLL 17.4 and 19.16 exclude BAhE as a BU base.
4. Ordinary hesitation counts as space, not a word. CLL 19.14 gives y the class Y. Only the shared reader forms the letter-y word.
5. LOhU closes at the first LEhU. CLL 19.16 excludes a LEhU after ZO, and 19.10 permits a ZOI quote inside LOhU.
6. ZOI compares whole raw runs by sound. CLL Example 19.50 instead forbids the delimiter inside a longer written run.

The [proposal's BU page](https://mw.lojban.org/papri/bu) lets SA BU reach inside a letteral. Its main page marks this interpretation controversial. These dialects instead keep the letteral opaque.

The proposal also exposes a completed LOhU quote's LEhU ending to SA. These dialects expose only the opening class. A surviving bare LEhU remains a fault even after a constructor wraps it.

camxes-std keys `sa .ebu` on BY and selects the earliest matching unit. These dialects use the next source word's class and select the nearest match. Counted SA selects successively earlier matches.

The y-delimiter policy accepts both one-run and two-run closing spellings. It compares the existing canonical sounds without a separate duration normalization. The raw body retains its source spelling.

The cll-ebnf SU policy follows CLL 19.13. The other three dialects preserve a boundary unit, as the Magic Words proposal specifies. Zantufa adopts this shared boundary policy.

The dialects keep `mi ba'e fa'o` rejected. The stranded BAhE cannot mark a word after FAhO ends the text. This policy differs from the study review's proposed acceptance.

## Choosing among parses

The stage uses lazy ambiguity resolution. It compares the first structural difference and favors closing a constituent over another token. The rules exclude readings that violate left-to-right operations.

The forms stage fixes ordinary word boundaries before this stage. The privileged y-letter read does not add a normalization stage. It applies only when an operation requests a word.

## Known gaps

The phoneme stage reads Cyrillic and zbalermorna before this grammar. Quotes still require the documented source pauses. This redesign does not change those orthography or pause rules.
