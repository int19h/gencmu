# Zantufa word forms

This document is part of the forms stage in the [Zantufa](../dialects/zantufa.md) dialect. The forms stage is the second stage of the pipeline. It divides the phonemes of the text into words. The loader stitches this document into the stage after [bpfk.md](bpfk.md).

The prose uses these Lojban terms for words:

- A cmavo is a particle, a short structure word.
- A gismu is a root word.
- A lujvo is a compound word.
- A rafsi is a shortened word form used inside compounds.

Zantufa 1.9999 reads the word forms that the definition effort of the Logical Language Group approved, with three changes. This document makes them:

- It permits the consonant pair `mz`.
- It reads `ie'o` as hesitation, as it reads `y`.
- It divides the letters after `ra'oi` into the rafsi or gismu form that `ra'oi` quotes.

The rule `m` has the name of the Zantufa rule that it translates, and its comment gives that rule, as in bpfk.md. Where another rule states a Zantufa rule, its comment gives that rule. The rest are rules of [forms.md](forms.md) that this document changes, or rules that support them. [The notation document](../../docs/notation.md) explains the notation.

CLL 3.6 forbids the consonant pair `mz`. The approved grammar, the word-form grammar that bpfk.md translates, forbids it too: its letter rule for `m` refuses a following `z`. The letter rule for `m` in Zantufa refuses only another `m` among the consonants, as the rule of camxes-exp (the experimental camxes parser) does. So Zantufa accepts `mz` wherever a permissible pair can stand. Examples are the gismu `kamzi`, the lujvo `bamzda` and the name `.djeimz.`. The other changes that camxes-exp makes to the word forms, in [experimental.md](experimental.md), are not Zantufa's.

```jbogenbau
%redefine-rule m              (* m <- [mM] !h !glide !m *)
  $c(/m/)
%conditions
  ¬begins(after($c), h),
  ¬begins(after($c), glide),
  ¬begins(after($c), m)
```

Zantufa's Y is `y` and `ie'o`, and its `spaces` read both as space. So `ie'o` is hesitation here, as `y` is. The word stage is the stage after the forms stage. It drops the hesitation where it is space, and reads it as the base of a letter word before `bu`. A Y word attached to a word before it is not space ([zantufa-stream.md](zantufa-stream.md)). It keeps the form of a cmavo, so the pause rules hold for it as for any cmavo.

```jbogenbau
%redefine-rule source-word
  (* spaces <- !Y initial_spaces;  initial_spaces <- (space_char / !ybu Y)+ EOF? / EOF;  Y <- &cmavo ( y+ / i e h o ) &post_word *)
  | $c(cmavo-shape) <~word ∪ ~cmavo ∪ tags($c) ∪ classify(phonemes($c), lexicon)>
  | $y(cmavo-shape) <~hesitation ∪ tags($y)>
  | $b(brivla-shape) <~word ∪ BRIVLA ∪ tags($b)>
  | $n(cmevla-shape) <~word ∪ CMEVLA ∪ tags($n)>
  | $h(hesitation-shape) <~hesitation ∪ ~y-letters ∪ tags($h)>
%conditions
  Y ⊈ classify(phonemes($c), lexicon),
  Y ⊆ classify(phonemes($y), lexicon)
```

`ra'oi` quotes a rafsi or gismu form from the letters after it, and the stage reads the rest of the run as words. The stage tries the forms in the order of Zantufa: `y_rafsi / long_rafsi / y_less_rafsi / gismu`. The forms decide with their stress. So `ra'oi broda` quotes the gismu `broda`, because its `o` is stressed before the pause, but `ra'oi brodami` quotes the rafsi `brod` and leaves `a` and `mi`. The form can follow `ra'oi` directly, as in `ra'oibroda`, or after a pause and any hesitation, as in `ra'oi .y. broda`. A run can hold several such quotes, as `ra'oi brodyra'oibroda` does.

The stage hands the form on as one token, tagged `rafsi-form`, and the word stage makes the quote. A token is one unit that a stage reads or emits. A tag marks a token by name, phoneme or character. Where no such form follows, `ra'oi` is an ordinary word, as in Zantufa's `si_word`, so `ra'oi bu` is a letter word. The word stage rejects `ra'oi do`.

A word of LU, TO or LUhEI opens a text of its own. The hesitation after such a word can be space, which the stage tags `opener-space` below. The constant `$TEXT-OPENERS` lists these classes. The word stage defines the same constant, because a constant belongs to its stage ([zantufa-stream.md](zantufa-stream.md)).

```jbogenbau
%const $TEXT-OPENERS
  LU ∪ TO ∪ LUhEI
```

This document extends the rule `read-run` of forms.md to read a run in which a form follows `ra'oi`, as in `mira'oibroda`. So the stage never reads such a run as foreign text too.

The redefined `run-words` keeps the conditions of [forms.md](forms.md) on a join. The first of them follows from the second, but it lets the parser drop a join early, as forms.md explains.

```jbogenbau
%redefine-rule runs
  | $r(run) <tags($r)>
  | $p(runs) pause-token $r(run) <tags($r) ∪ (RAhOI ⊆ tags($p) ∧ matches($r, only-hesitation) ⟹ RAhOI)>
  | $q(runs) pause-token $s(rahoi-rest) <tags($s)>
%conditions
  RAhOI ⊈ tags($p) ∨ ¬matches($r, rahoi-rest),
  RAhOI ⊆ tags($q)

%extend-rule read-run
  run-words⊇RAhOI $s(rahoi-rest)
%tags
  tags($s)

%redefine-rule run-words
  | $f(first-word) <tags($f) ∪ (~hesitation ⊆ tags($f) ⟹ ~spacing)>
  | $r(run-words) $v(later-word)
      <tags($v) ∪ (~uncounted ⊆ tags($v) ⟹ ~open-stress ∩ tags($r))>
  | $s(run-words) $y(joined-hesitation) <tags($y)>
  | $t(run-words) $u(space-hesitation) <tags($u) ∪ ~spacing>
  | $q(run-words) $x(space-piece) <tags($x) ∪ ~spacing ∪ ~after-hesitation>
  | $o(run-words) $n(opener-space) <tags($n) ∪ ~opener-space>
%conditions
  ~y-letters ⊆ tags($s),
  (~spacing ∪ ~opener-space) ∩ tags($s) = ∅,
  ~spacing ⊆ tags($q),
  ~y-letters ⊆ tags($q),
  ~spacing ⊆ tags($t),
  ~opener-space ⊆ tags($o) ∨ classes($o) ∩ $TEXT-OPENERS ≠ ∅,
  ~y-letters ⊈ tags($t) ∨ ~y-letters ⊈ tags($u),
  ~y-letters ⊈ tags($r) ∨ ~y-letters ⊈ tags($v),
  ~hesitation ⊈ tags($v) ∨ (~spacing ∪ ~opener-space) ∩ tags($r) = ∅ ∧ classes($r) ∩ $TEXT-OPENERS = ∅,
  RAhOI ⊈ tags($r) ∨ ¬begins(from($v), rahoi-form),
  (~continued ∪ ~cy ∪ ~name-intro ∪ ~open-stress) ∩ tags($r) ≠ ∅,
  ~cy ⊆ tags($r) ∧ ~cy ⊆ tags($v)
    ∨ ~continued ⊆ tags($r) ∧ ~onset ⊆ tags($v)
    ∨ ~name-intro ⊆ tags($r) ∧ ~name-onset ⊆ tags($v)
    ∨ ~open-stress ⊆ tags($r) ∧ ~cy ⊈ tags($r) ∧ ~onset ⊆ tags($v),
  ~final-stress ⊈ tags($r) ∨ (~stress-guard ∪ ~initial-stress) ∩ tags($v) = ∅,
  ~open-stress ⊈ tags($r) ∨ ~uncounted ⊆ tags($v)

%rule rahoi-rest
  | $p(rahoi-form) <∅>
  | rahoi-form $w(rahoi-tail) <tags($w)>
  | rahoi-form $v(rahoi-tail) $s(rahoi-rest) <tags($s)>
  | $h(run-words) $t(rahoi-rest) <tags($t)>
%conditions
  RAhOI ⊆ tags($v),
  matches($h, only-hesitation)

%rule rahoi-tail
  (* the words after a ra'oi form in its run: the first of them does not begin the run *)
  | $v(later-word) <tags($v)>
  | $r(rahoi-tail) $v(later-word) <tags($v)>
  | $s(rahoi-tail) $y(joined-hesitation) <tags($y)>
  | $o(rahoi-tail) $n(opener-space) <tags($n) ∪ ~opener-space>
%conditions
  RAhOI ⊈ tags($r) ∨ ¬begins(from($v), rahoi-form),
  ~y-letters ⊈ tags($r) ∨ ~y-letters ⊈ tags($v),
  ~hesitation ⊈ tags($v) ∨ ~opener-space ⊈ tags($r) ∧ classes($r) ∩ $TEXT-OPENERS = ∅,
  ~y-letters ⊆ tags($s),
  ~opener-space ⊈ tags($s),
  ~opener-space ⊆ tags($o) ∨ classes($o) ∩ $TEXT-OPENERS ≠ ∅

%rule space-hesitation
  (* initial_spaces <- (space_char / !ybu Y)+ EOF? / EOF: after space, every Y word is space *)
  $w(source-word⊇~hesitation)
%emits
  $ <tags($w) ∪ ~spacing ∪ (¬begins(after($w), nonpause-phoneme) ⟹ ~run-final)>

%rule opener-space
  (* a hesitation after lu, to or lu'ei, or after such a hesitation: space if that word opens a text *)
  $w(source-word⊇~hesitation)
%emits
  $ <tags($w) ∪ ~opener-space ∪ (¬begins(after($w), nonpause-phoneme) ⟹ ~run-final)>

%rule space-piece
  (* the next piece of one run of y letters inside space *)
  $w(source-word⊇~y-letters)
%emits
  $ <tags($w) ∪ ~spacing ∪ ~after-hesitation ∪ (¬begins(after($w), nonpause-phoneme) ⟹ ~run-final)>

%rule only-hesitation
  (* spaces? after RAhOI: a run that is only hesitation, which passes RAhOI on to the run after it *)
  first-word⊇~hesitation | only-hesitation later-word⊇~hesitation | only-hesitation joined-hesitation

%rule rahoi-form
  (* RAhOI_pre <- pre_clause RAhOI spaces? (y_rafsi / long_rafsi / y_less_rafsi / gismu) spaces? *)
  | y-rafsi
  | $l(long-rafsi)
  | $s(y-less-rafsi)
  | $g(gismu)
%conditions
  ¬begins(from($l), y-rafsi),
  ¬begins(from($s), long-rafsi),
  ¬begins(from($g), y-rafsi),
  ¬begins(from($g), long-rafsi),
  ¬begins(from($g), y-less-rafsi)
%emits
  $ <~rafsi-form ∪ (¬begins(after($), nonpause-phoneme) ⟹ ~run-final)>
```

The approved word forms read an odd run of three or more `y` as `y` and the rest. Zantufa's `Y` is `y+`, so its `spaces` read the whole run as one stretch of space. So the stage tags `after-hesitation` a run of `y` that directly follows another run of `y`. The word stage joins the two into one letter word before `bu`. Elsewhere, two such runs attached to a word are two Y words, as Zantufa's `cmavo_form` reads them. An `ie'o` is a Y word of its own, and it never joins one.

A hesitation that begins a run is space. Each hesitation that directly follows a space continues it, up to the next other word, as `initial_spaces` reads it. The stage tags these `spacing` ([zantufa-stream.md](zantufa-stream.md)).

The stage tags `opener-space` a hesitation directly after `lu`, `to` or `lu'ei`, and each one after it. It is space where that word opens a text of its own, whose `intro_null` reads space, but not where that word is itself quoted. Only the word stage knows which.

```jbogenbau
%rule joined-hesitation
  (* Y <- &cmavo ( y+ / ie'o ) &post_word *)
  $w(source-word⊇~y-letters)
%emits
  $ <tags($w) ∪ ~after-hesitation ∪ (¬begins(after($w), nonpause-phoneme) ⟹ ~run-final)>
```
