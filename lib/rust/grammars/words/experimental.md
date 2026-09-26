# Experimental word forms

This document is part of the word stage in the [experimental](../dialects/experimental.md) dialect. It is stitched in after [bpfk.md](bpfk.md). camxes-exp, the experimental PEG grammar, reads the word forms of the definition effort with a few changes. This document makes the same changes to the translation in [bpfk.md](bpfk.md). Each rule here has the name of the camxes-exp rule that it translates, and its comment gives that rule, as in bpfk.md. The [Zantufa](../dialects/zantufa.md) dialect makes only the first change, in [zantufa.md](zantufa.md). The notation is explained in [the notation document](../../docs/notation.md).

## The pair mz

CLL 3.6 forbids the consonant pair `mz`, and so does the approved grammar: its letter rule for `m` refuses a following `z`. The letter rule for `m` in camxes-exp refuses only another `m` among the consonants. So camxes-exp accepts `mz` wherever a permissible pair can stand. Examples are the gismu `kamzi`, the lujvo `bamzda` and the name `.djeimz.`.

```jbogenbau
%redefine-rule m              (* m <- comma* [mM] !h !glide !m *)
  $c(/m/)
%conditions
  ¬begins(after($c), h),
  ¬begins(after($c), glide),
  ¬begins(after($c), m)
```

## Extended rafsi

The approved grammar has two kinds of extended rafsi, which shorten a word before a y-hyphen. A `brivla_rafsi` is the head of a brivla of two syllables or more, followed by `'y`, as in `klama'ybroda`. A `fuhivla_rafsi` is the head of a borrowing, followed by an onset and `y`, as in `spageiybroda`. camxes-exp replaces the first kind with `hy_rafsi`, which the approved grammar uses only in lookaheads. A `hy_rafsi` is a long rafsi and an unstressed vowel, a CCV rafsi, or a CVV rafsi, followed by `'y`. So `klama'ybroda` is one word in both grammars, but only camxes-exp reads `kerlybai'ybroda` as one word.

```jbogenbau
%redefine-rule extended-rafsi (* extended_rafsi <- hy_rafsi / fuhivla_rafsi *)
  | hy-rafsi
  | $f(fuhivla-rafsi)
%conditions
  ¬begins(from($f), hy-rafsi)

%redefine-rule stressed-extended-rafsi (* stressed_extended_rafsi <- stressed_hy_rafsi / stressed_fuhivla_rafsi *)
  | stressed-hy-rafsi
  | $f(stressed-fuhivla-rafsi)
%conditions
  ¬begins(from($f), stressed-hy-rafsi)

%redefine-rule long-rafsi-vowel (* long_rafsi unstressed_vowel, in hy_rafsi *)
  long-rafsi unstressed-vowel
```

A `hy_rafsi` could also begin a brivla with a CCV rafsi, `'y` and the next rafsi. camxes-exp refuses that start, which it calls `slihykru`. So camxes-exp reads `kerlybla'ykla` as one word, but not `bla'ykla`, which the approved grammar rejects too. The rule is used only in that test. Its first choice needs no order, since a CCV rafsi has an unstressed vowel and a stressed CCV rafsi a stressed one.

```jbogenbau
%redefine-rule brivla         (* brivla <- !cmavo !slihykru initial_rafsi* brivla_core *)
  $r(initial-rafsis) brivla-core
%conditions
  ¬begins(from($r), cmavo),
  ¬begins(from($r), slihykru)

%rule slihykru                (* slihykru <- (CCV_rafsi / stressed_CCV_rafsi) h y onset; only a lookahead *)
  (ccv-rafsi | stressed-ccv-rafsi) h y onset
```

In camxes-exp, the onset after the head of a borrowing's rafsi may be an apostrophe. So `kerlyfa'u'yiismu` is one word: the rafsi `kerly` and `fa'u'y`, and the borrowing `iismu`. The approved grammar rejects it.

```jbogenbau
%redefine-rule fuhivla-rafsi  (* fuhivla_rafsi <- &unstressed_syllable fuhivla_head onset y h? *)
  $f(fuhivla-head) onset y h-opt
%conditions
  begins(from($f), unstressed-syllable)

%redefine-rule stressed-fuhivla-rafsi (* stressed_fuhivla_rafsi <- fuhivla_head stressed_syllable consonantal_syllable* onset y *)
  fuhivla-head stressed-syllable consonantal-syllables onset y
```

A short rafsi without a y-hyphen may not stand where an extended rafsi or a borrowing begins, nor just before one, in the approved grammar. In camxes-exp, it may not stand where a borrowing or the rafsi of a borrowing begins, nor just before one.

```jbogenbau
%redefine-rule initial-rafsi  (* initial_rafsi <- extended_rafsi / y_rafsi / !any_fuhivla_rafsi y_less_rafsi !any_fuhivla_rafsi *)
  | extended-rafsi
  | $y(y-rafsi)
  | $l(y-less-rafsi)
%conditions
  ¬begins(from($y), extended-rafsi),
  ¬begins(from($l), extended-rafsi),
  ¬begins(from($l), y-rafsi),
  ¬begins(from($l), any-fuhivla-rafsi),
  ¬begins(after($l), any-fuhivla-rafsi)

%rule any-fuhivla-rafsi       (* any_fuhivla_rafsi <- fuhivla / fuhivla_rafsi / stressed_fuhivla_rafsi; only a lookahead *)
  fuhivla | fuhivla-rafsi | stressed-fuhivla-rafsi
```

## Glides

camxes-exp also adds `!glide` to its rule `glide <- (i / u) &nucleus`. That changes no reading, so this document leaves the rule as [bpfk.md](bpfk.md) has it. An `i` or `u` is a glide only where a nucleus follows it. It is a vowel, and so a nucleus, only where no nucleus follows it. So the nucleus after a glide never begins with another glide. camxes-exp gives the same parse trees with the lookahead and without it. That holds on every string of up to six letters from `i`, `u`, `a`, `e`, `o`, `y`, `'`, `k`, `s` and a period.
