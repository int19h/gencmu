# The word stream

This document defines the word stage of cll-ebnf, bpfk, experimental, and Zantufa. A stage reads the tokens from the previous stage and emits tokens for the next stage.

The [forms stage](forms.md) supplies source words. This stage applies quotes, compounds, erasers, hesitation, and FAhO. The [notation document](../../docs/notation.md) defines the rules below.

A unit is one item on which an operation acts. A token is one emitted item for the next stage. Every quote and compound is one opaque unit, even when its emission contains several tokens.

The grammar follows the maintainer's opaque-unit interpretation of the Magic Words proposal. The shared grammar processes every operation strictly from left to right. Zantufa keeps its reference parser's local quote-first and SU-letter-base exceptions. Only the shared word reader joins hesitation with BU before an operation takes the word.



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

%rule text
  | empty
  | $s(stream) spacing
  | empty faho-group
  | $s(stream) spacing faho-group
%conditions
  ~fault ⊈ tags($s)

%rule text-start
  ε
%conditions
  initial($)

%rule empty
  | text-start spacing
  | empty si-word spacing
  | empty erasure spacing
  | sa-su? empty su-word spacing
  | sa-su? ¬su-boundary? stream spacing su-word spacing
  | sa-su? su-boundary? $s(stream) spacing su-word spacing
  | sa-su? sa-wiped spacing
  | sa-su? empty sa-tail
  | sa-su? stream spacing sa-tail
%conditions
  classes($s) ∩ $SU-STOPS = ∅
%emits
  ε

%rule stream
  | empty $u(unit) <tags($u)>
  | $s(stream) spacing $u(unit) <tags($s) ∪ tags($u)>
  | $s(stream) spacing erasure <tags($s)>

%rule unit
  word | quote | lerfu-word | zei-compound | fault-unit | su-survivor

%rule spacing
  [PAUSE] [hesitations [PAUSE]]

%rule gap
  spacing

%rule skipped
  spacing [erasures spacing]

%rule erasures
  erasure | erasures spacing erasure

%rule erasure
  si-erasure | sa-su? sa-erasure

%rule fault-unit
  | empty bu-word <~word ∪ BY ∪ ~fault>
  | lehu-marker <~word ∪ LEhU ∪ ~fault>
%emits
  $

%rule hesitation
  $h(y-run) <∅>
%conditions
  ¬begins(from($h), y-bu-word)
%emits
  ε

%rule y-run
  ~hesitation

%rule y-base
  y-run

%rule bu-next
  [PAUSE] BU

%rule faho-group
  faho-word [zoi-body]
%emits
  ε

%rule faho-word
  read-word∩FAhO≠∅

%rule sa-tail
  sa-su? sa-run spacing
%conditions
  ¬begins(after($), read-word)
%emits
  ε
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
  ZO ∪ ZOI ∪ LOhU ∪ LEhU ∪ ZOhOI ∪ MEhOI ∪ FAhO ∪ BU ∪ ZEI ∪ SI ∪ SA ∪ SU

%rule read-word
  | $c(cmavo-token) <tags($c)>
  | $b(BRIVLA) <tags($b)>
  | $n(CMEVLA) <tags($n)>
  | $y(y-bu-word) <tags($y)>

%rule y-bu-word
  $b(y-key) [PAUSE] $u(bu-word)
%tags
  ~word ∪ BY ∪ ~y-letter ∪ tags($b) ∪ ~run-initial ∩ tags(head($b)) ∪ ~run-final ∩ tags(last($u))
%emits
  $

%rule word
  | sa-su? $c(read-word) <tags($c)>
  | ¬sa-su? $e(read-word) <tags($e)>
%conditions
  classes($c) ∩ $MAGIC-WORDS = ∅,
  classes($e) ∩ ($MAGIC-WORDS ∖ (SA ∪ SU)) = ∅,
  ¬begins(from($c), quote),
  ¬begins(from($e), quote)
%emits
  $

%rule cmavo-token
  $c(~cmavo) <tags($c)>

%rule magic-body
  read-word
```

## Quotes

Every complete quote is one opaque unit. Later operations see its opening marker class and no class from its contents or closing marker. The indicator and syntax stages receive the quote's emitted tokens.

A quote marker keeps its word kind and classes but drops the `indicator` mark. Otherwise the indicator stage can detach a marker from its quoted contents.

ZO quotes one word from the shared reader. Inside that quote, an eraser, compounder, or quote marker executes no operation. The reader still forms the letter word for y.

ZOhOI and MEhOI quote one raw run in the experimental dialect. After a pause, they skip ordinary hesitation. The quote must finish at the end of its run.

ZOI and LAhO skip hesitation and read the next real word as their opening delimiter. Hesitation never serves as a delimiter. They close at the first matching whole run by canonical sound. Canonical sound ignores case and commas.

The letter-y delimiter can close on one `ybu` run or adjacent `y` and `bu` runs. The reader accepts both opening spellings. The closing test preserves adjacency and never joins the body into words.

The body remains raw and opaque. In `zoi bu. foo .y. bu.`, the final `bu` closes the quote. The preceding y remains body text.

Ordinary compounds cannot become delimiters because the marker reads the delimiter before a later compounder acts. Empty quotes still emit an opaque body token. Pauses delimit the body and the closing run.

A LOhU quote ends at the first LEhU. Its body reads shielded Lojban words through the shared reader. No quote marker or eraser acts there, and an unread run rejects the quote.

The completed LOhU unit exposes LOhU alone to SA. LEhU closes the quote but supplies no later search target inside it. Replacement quotes and dialect quote kinds follow the same opacity rule.

```jbogenbau
%rule quote
  quoted-word | zoi-quote | empty-zoi-quote | lohu-quote | single-word-quote

%rule quoted-word
  $m(word-quote-marker) quote-gap $w(quotable-word) <tags($m)>
%emits
  $m, $w <~word>


%rule word-quote-marker
  $q(magic-body) <classes($q) ∪ ~word ∪ ~cmavo>
%conditions
  ZO ⊆ classes($q)


%rule single-word-quote
  | $m(single-marker) $r(zohoi-payload) <tags($m)>
  | $m(single-marker) PAUSE [zohoi-hesitations [PAUSE]] $s(zohoi-payload) <tags($m)>
%conditions
  ~run-final ⊆ tags(last($r)),
  ~run-final ⊆ tags(last($s)),
  ~hesitation ⊈ tags(head($s)) ∨ begins(from(head($s)), raw-y-letter)
%emits
  $m, $r <~quoted-text>, $s <~quoted-text>


%rule single-marker
  $q(magic-body) <classes($q) ∪ ~word ∪ ~cmavo>
%conditions
  classes($q) ∩ (ZOhOI ∪ MEhOI) ≠ ∅


%rule quotable-word
  read-word

%rule zoi-quote
  $m(zoi-marker) delimiter-gap $open(delimiter) PAUSE $content(zoi-body) PAUSE $close(raw-close)
%tags
  tags($m)
%conditions
  ~y-letter ⊆ tags($open) ⟹ tags($open) ∖ $Y-PROPERTIES = tags($close),
  ~y-letter ⊈ tags($open) ⟹ phonemes($open) = phonemes($close),
  ~y-letter ⊆ tags($open) ⟹ tags($open) ∖ $Y-PROPERTIES ⊈ tags($content, body-with-y-close),
  ~y-letter ⊈ tags($open) ⟹ phonemes($open) ∉ split(phonemes($content), ".")
%emits
  $m, $open <~word>, $content <~quoted-text>, $close <~word>

%rule empty-zoi-quote
  $m(zoi-marker) delimiter-gap $open(delimiter) PAUSE $content(empty-zoi-body) $close(raw-close)
%tags
  tags($m)
%conditions
  ~y-letter ⊆ tags($open) ⟹ tags($open) ∖ $Y-PROPERTIES = tags($close),
  ~y-letter ⊈ tags($open) ⟹ phonemes($open) = phonemes($close)
%emits
  $m, $open <~word>, $content <~quoted-text>, $close <~word>

%const $Y-PROPERTIES
  ~word ∪ BY ∪ ~y-letter ∪ ~run-initial ∪ ~run-final

%rule delimiter
  $w(read-word)
%conditions
  Y ⊈ classes($w)

%rule delimiter-gap
  [PAUSE] [delimiter-hesitations [PAUSE]]

%rule delimiter-hesitations
  delimiter-hesitation | delimiter-hesitations [PAUSE] delimiter-hesitation

%rule delimiter-hesitation
  $h(y-run)
%conditions
  ¬begins(from($h), y-bu-word)
%emits
  ε

%rule y-key
  $y(y-base)
%tags
  (phonemes($y) = "ie'o" ⟹ ~ieho) ∪ (phonemes($y) ≠ "ie'o" ⟹ tag(phonemes($y)))

%rule raw-close
  raw-run | raw-y-close

%rule raw-run
  $r(raw-run-parts)
%conditions
  ~run-final ⊆ tags(last($r))

%rule raw-run-parts
  matched-close-token | raw-run-parts matched-close-token

%rule matched-close-token
  cmavo-token | payload-token⊉~cmavo

%rule raw-y-close
  $y(raw-y-key) [PAUSE] $b(matched-close-token)
%tags
  tags($y)
%conditions
  phonemes($b) = "bu",
  ~run-initial ⊆ tags(head($y)),
  ~run-final ⊆ tags(last($b))

%rule raw-y-base
  | y-run
  | $b(raw-y-base) $h(y-run)
%conditions
  phonemes($b) ≠ "ie'o",
  phonemes($h) ≠ "ie'o"

%rule raw-y-key
  $y(raw-y-base)
%tags
  (phonemes($y) = "ie'o" ⟹ ~ieho) ∪ (phonemes($y) ≠ "ie'o" ⟹ tag(phonemes($y)))

%rule raw-y-letter
  raw-y-base [PAUSE] bu-word

%rule zohoi-hesitation
  $h(y-run)
%conditions
  ¬begins(from($h), raw-y-letter)
%emits
  ε

%rule zohoi-hesitations
  zohoi-hesitation | zohoi-hesitations [PAUSE] zohoi-hesitation

%rule body-with-y-close
  [zoi-body] $c(raw-y-close) [zoi-body] <tags($c)>

%rule empty-zoi-body
  ε
%opaque


%rule zoi-marker
  $q(magic-body) <classes($q) ∪ ~word ∪ ~cmavo>
%conditions
  ZOI ⊆ classes($q)

%rule lohu-quote
  | $m(lohu-marker) gap lohu-stream gap lehu-marker <tags($m)>
  | $m(lohu-marker) [PAUSE] lehu-marker <tags($m)>

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


%rule lohu-stream
  | lohu-element
  | lohu-stream PAUSE lohu-element
  | lohu-stream lohu-element


%rule lohu-element
  lohu-word | hesitation


%rule lohu-word
  $w(read-word)
%conditions
  LEhU ⊈ classes($w)
%emits
  $ <~word>

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

Zantufa keeps its reference parser's SU-before-BU letter-base exception. Its quote-first fallback also keeps priority over bare markers. The dialect document defines both exceptions.

The constructors can repeat and combine without exposing their operands. Each result keeps any fault of its base. SI erases the complete result as one unit.

Erased regions and ordinary hesitation can separate an operand from its operator. The constructors omit these regions from the emitted compound. Their warnings still belong to the selected derivation.

The CLL dialect requires pauses around a direct name base of BU. It tests the source run boundary. A name inside a compound does not make that compound a direct name.

```jbogenbau
%rule lerfu-word
  $u(unit) skipped bu-word <~word ∪ BY ∪ ~fault ∩ tags($u)>
%emits
  $

%rule bu-word
  $q(cmavo-token)
%conditions
  BU ⊆ classes($q)

%rule zei-compound
  $l(unit) skipped zei-word spacing $r(read-word)
%tags
  ~word ∪ BRIVLA ∪ ~fault ∩ tags($l)
%emits
  $

%rule zei-word
  $q(cmavo-token)
%conditions
  ZEI ⊆ classes($q)
```

## Erasure by `si`

SI erases the preceding live unit. Quotes and compounds each count as one unit. A run of SI removes that many units and then does nothing on an empty stream.

SI skips hesitation and erased regions. It never erases an already executed SA or SU as a word. A fault unit is an ordinary operand for erasure.

```jbogenbau
%rule si-erasure
  unit skipped si-word
%emits
  ε

%rule si-word
  $q(cmavo-token)
%conditions
  SI ⊆ classes($q)
%emits
  ε
```

## Erasure by `sa` and `su`

SA reads its key from the next word before that word executes. It erases through the nearest preceding unit whose class matches that key. The next word stays and then executes normally.

The key of `sa .ebu` is the class of `.e`. BU has not yet formed that letteral. A letteral has class BY, so `sa bu` finds no BU inside it.

With no matching unit, SA erases everything before it. Thus `mi bu sa bu` removes the letteral and leaves a dangling BU fault. A later eraser can remove that fault.

Counted SA selects the second-nearest match for two markers, the third-nearest for three, and so on. The grammar nests one reach per marker. Too few matches erase the whole prefix.

SA at normal end has no key and erases back to the start of the text. SA before active FAhO uses FAhO as its key, erases the prefix, and then ends the text.

A reach carries classes of whole live units. It excludes nearer matching units and skips erased regions. It never searches original source words inside a quote or compound.

In cll-ebnf, SU erases everything before it. In bpfk, experimental, and Zantufa, SU stops at the last NIhO, LU, TUhE, or TO unit. That boundary survives.

The feature `su-boundary` selects the surviving-boundary policy. A boundary inside an opaque unit cannot stop SU. With no boundary, SU erases the whole prefix.

```jbogenbau
%rule sa-erasure
  $s(sa-nest) spacing $k(sa-key)
%conditions
  classes($s) ∩ tags($k) ≠ ∅
%emits
  ε

%rule sa-nest
  | $u(sa-open) spacing sa-word <classes($u)>
  | $u(sa-open) spacing $n(sa-nest) spacing sa-word <classes($u) ∩ classes($n)>
%conditions
  classes($u) ≠ ∅,
  classes($u) ∩ classes($n) ≠ ∅

%rule sa-open
  | $u(unit) <classes($u)>
  | $s(sa-open) spacing $u(unit) <classes($s) ∖ classes($u)>
  | $s(sa-open) spacing erasure <classes($s)>
%conditions
  classes($) ≠ ∅

%rule sa-key
  ε
%tags
  tags(after($), next-word-class)
%conditions
  SA ⊈ tags($)

%rule next-word-class
  spacing $w(read-word) [zoi-body] <classes($w) ∪ ~has-word>

%rule sa-word
  $q(cmavo-token)
%conditions
  SA ⊆ classes($q)
%emits
  ε

%rule sa-run
  sa-word | sa-run spacing sa-word

%rule sa-run-twice
  sa-word spacing sa-run

%rule sa-wiped
  | empty sa-run spacing $k(sa-key)
  | $s(stream) spacing sa-run spacing $k(sa-key)
  | empty $n(sa-wipe-core) spacing $k(sa-key)
  | $s(stream) spacing $n(sa-wipe-core) spacing $k(sa-key)
%conditions
  ~has-word ⊆ tags($k),
  classes($s) ∩ tags($k) = ∅,
  classes($n) ∩ tags($k) ≠ ∅
%emits
  ε

%rule sa-wipe-core
  | $u(sa-open) spacing sa-run-twice <classes($u)>
  | $u(sa-open) spacing $n(sa-wipe-core) spacing sa-word <classes($u) ∩ classes($n)>
%conditions
  classes($u) ∩ classes($n) ≠ ∅

%const $SU-STOPS
  NIhO ∪ LU ∪ TUhE ∪ TO

%rule su-survivor
  sa-su? su-boundary? $b(unit) skipped su-suffix <tags($b)>
%conditions
  classes($b) ∩ $SU-STOPS ≠ ∅

%rule su-suffix
  | su-word
  | su-reach spacing su-word
%emits
  ε

%rule su-reach
  | unit∩$SU-STOPS=∅
  | su-reach spacing unit∩$SU-STOPS=∅
  | su-reach spacing erasure

%rule su-word
  $q(cmavo-token)
%conditions
  SU ⊆ classes($q)
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

camxes-std keys `sa .ebu` on BY and selects the earliest matching unit. These dialects use the next source word's class and select the nearest match. Counted SA selects successively earlier matches. A trailing SA instead clears the text, as the proposal's table specifies.

Only the letter word for y serves as a y delimiter. Its closing spelling uses one run or two adjacent runs. Ordinary hesitation never needs a delimiter-matching rule. The raw body retains its source spelling.

The cll-ebnf SU policy follows CLL 19.13. The other three dialects preserve a boundary unit, as the Magic Words proposal specifies. Zantufa adopts this shared boundary policy.

The dialects keep `mi ba'e fa'o` rejected. The stranded BAhE cannot mark a word after FAhO ends the text. This policy differs from the study review's proposed acceptance.

## Choosing among parses

The stage uses lazy ambiguity resolution. It compares the first structural difference and favors closing a constituent over another token. The rules exclude readings that violate left-to-right operations.

The forms stage fixes ordinary word boundaries before this stage. The privileged y-letter read does not add a normalization stage. It applies only when an operation requests a word.

## Known gaps

The phoneme stage reads Cyrillic and zbalermorna before this grammar. Quotes still require the documented source pauses. This redesign does not change those orthography or pause rules.
