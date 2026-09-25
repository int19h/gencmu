# Indicators and `ba'e`

This document is the indicator stage, the third stage of every Lojban dialect: [CLL](../dialects/cll-ebnf.md), [approved word forms](../dialects/bpfk.md), [experimental](../dialects/experimental.md) and [Zantufa](../dialects/zantufa.md). It reads the words the word stage emitted and applies the one rule of CLL's grammar that the book calls non-formal because a parser applies it before the grammar proper: `word ≔ [BAhE] any-word [indicators]`. A run of indicators, the attitudinals and discursives of UI and CAI with an optional `nai` after each, the hesitation `y`, the cancel `da'o` and the scope markers `fu'e` and `fu'o`, attaches to the word before it and is not seen by the syntax, and `ba'e` before a word marks that word and is not seen either. What a word is, which words are indicators and which are `ba'e`, is decided by the lexicon of the word stage: an indicator is a word tagged `indicator` there, and every word the word stage emitted as the material of a quote or a compound carries no class, so an attitudinal inside `zo`, `lo'u ... le'u` or before `bu` is never absorbed. A run of indicators at the start of the text, before any word, stays in the stream, since the syntax grammar's `text` rule reads it there, and so does a `ba'e` with no word after it. The notation is explained in [the notation document](../../docs/notation.md).

An indicator run is read as far as it goes, so the stage is greedy: where two parses differ, it takes the one that reads the next word over the one that closes a constituent.

```jbogenbau
%ambiguity-resolution greedy
```

```jbogenbau
%rule text
  | ε | item-run | item-run bahe-run | leading | leading bahe-run | bahe-run
  | $l(leading) $r(item-run) | $l(leading) $r(item-run) bahe-run
%conditions
  "NAI" ∉ tags(head($r)) ∨ classes(last($l)) ∩ ("UI" ∪ "CAI") = ∅

%rule leading
  indicator-run

%rule item-run
  item | item-run item

%rule item
  [absorbed-bahe] $w(unit) [absorbed]
%tags
  tags($w)
%emits
  $w

%rule unit
  | $w("word") | "foreign-text" | "LEhU"
%conditions
  "indicator" ∉ tags($w),
  "BAhE" ∉ tags($w),
  "LEhU" ∉ tags($w)

%rule absorbed
  indicator-run
%emits
  ε

%rule absorbed-bahe
  bahe-run
%emits
  ε

%rule bahe-run
  bahe | bahe-run bahe

%rule bahe
  $b("word") <tags($b)>
%conditions
  "BAhE" ∈ tags($b)
%emits
  $

%rule indicator-run
  indicator | attitudinal nai | indicator-run indicator | indicator-run attitudinal nai

%rule indicator
  | $i("word") | absorbed-bahe $i("word")
%tags
  tags($i)
%conditions
  "indicator" ∈ tags($i)
%emits
  $

%rule attitudinal
  | $i("word") | absorbed-bahe $i("word")
%tags
  tags($i)
%conditions
  "indicator" ∈ tags($i),
  classes($i) ∩ ("UI" ∪ "CAI") ≠ ∅
%emits
  $

%rule nai
  $n("word") <tags($n)>
%conditions
  "NAI" ∈ tags($n)
%emits
  $
```

A `le'u` outside any quote is still a word, but it is read as `LEhU` and not also as a plain word, so that it has one reading.

After a run of indicators at the start of the text, a `nai` belongs to the last of them when that is an attitudinal: `iu nai` is one run, not `iu` followed by a text that begins with `nai`.

A `ba'e` before an indicator marks the indicator and goes with it. An indicator run is read as far as it goes: `broda ui nai` attaches both words to `broda`, and the stage being greedy is what makes `nai` part of the run rather than the next word of the syntax. A `ba'e` is a word of BAhE, which the CLL lexicon gives only to `ba'e` and `za'e`.
