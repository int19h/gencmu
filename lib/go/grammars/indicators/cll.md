# Indicators and `ba'e`

This document is the indicator stage, the fourth stage of every Lojban dialect: [CLL](../dialects/cll-ebnf.md), [approved word forms](../dialects/bpfk.md), [experimental](../dialects/experimental.md) and [Zantufa](../dialects/zantufa.md). A dialect is a pipeline of stages, defined by one pipeline document. A stage is one step of a pipeline, with its own grammar. This stage reads the words that the word stage emitted. It applies the one rule of CLL's grammar that the book calls non-formal, because a parser applies it before the grammar proper. The rule is `word ≔ [BAhE] any-word [indicators]`.

The indicators are the attitudinals and discursives of UI and CAI with an optional `nai` after each. They are also the cancel `da'o` and the scope marker `fu'o`. A `fu'e` opens a group of them. CLL counts the hesitation `y` among them too, but the word stage drops hesitation, so it never reaches this stage.

A run of indicators attaches to the word before it, and the syntax does not see it. A `ba'e` before a word marks that word, and the syntax does not see it either. The lexicon of the forms stage decides what a word is, which words are indicators and which are `ba'e`. The `indicator` tag, a label that the lexicon gives a word, marks both indicators and `fu'e`. The word stage passes these tags on, but a word that it emitted as the material of a quote or a compound carries no class. So this stage never absorbs an attitudinal inside `zo`, `lo'u ... le'u` or before `bu`.

A run of indicators at the start of the text, before any word, stays in the stream. This is because the `text` rule of the syntax grammar reads it there. A `ba'e` with no word after it stays in the stream too. [The notation document](../../docs/notation.md) explains the notation.

The stage reads an indicator run as far as it goes, so the stage is greedy. Where two parses differ, it takes the one that reads the next word over the one that closes a constituent.

```jbogenbau
%ambiguity-resolution greedy
```

```jbogenbau
%rule text
  | ε | item-run | item-run bahe-run | leading | leading bahe-run | bahe-run
  | $l(leading) $r(item-run) | $l(leading) $r(item-run) bahe-run
%conditions
  NAI ⊈ tags(head($r)) ∨ classes(last($l)) ∩ (UI ∪ CAI) = ∅

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
  | $w(~word) | ~foreign-text | LEhU
%conditions
  ~indicator ⊈ tags($w),
  BAhE ⊈ tags($w),
  LEhU ⊈ tags($w)

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
  $b(~word) <tags($b)>
%conditions
  BAhE ⊆ tags($b)
%emits
  $

%rule indicator-run
  | [fuhe] indicator | [fuhe] attitudinal nai
  | indicator-run [fuhe] indicator | indicator-run [fuhe] attitudinal nai

%rule indicator
  | $i(~word) | absorbed-bahe $i(~word)
%tags
  tags($i)
%conditions
  ~indicator ⊆ tags($i),
  FUhE ⊈ classes($i)
%emits
  $

%rule fuhe
  | $i(~word) | absorbed-bahe $i(~word)
%tags
  tags($i)
%conditions
  FUhE ⊆ classes($i)
%emits
  $

%rule attitudinal
  | $i(~word) | absorbed-bahe $i(~word)
%tags
  tags($i)
%conditions
  ~indicator ⊆ tags($i),
  classes($i) ∩ (UI ∪ CAI) ≠ ∅
%emits
  $

%rule nai
  | $n(~word) <tags($n)>
  | absorbed-bahe $m(~word) <tags($m)>
%conditions
  NAI ⊆ tags($n),
  NAI ⊆ tags($m)
%emits
  $
```

A `le'u` outside any quote is still a word. But the stage reads it as `LEhU` and not also as a plain word, so that it has one reading.

After a run of indicators at the start of the text, a `nai` belongs to the last of them when that is an attitudinal. So `iu nai` is one run, not `iu` followed by a text that begins with `nai`.

A `ba'e` before an indicator marks the indicator and goes with it. So does a `ba'e` before the `nai` of an attitudinal. `ba'e` "marks the following word but does not change its meaning", as the Magic Words proposal says. Also, "One NAI can follow any UI or CAI cmavo". So `mi .e .ui ba'e nai do` negates the `.ui` and leaves the `.e` as it is.

The stage reads an indicator run as far as it goes: `broda ui nai` attaches both words to `broda`. Because the stage is greedy, `nai` is part of the run and not the next word of the syntax. A `ba'e` is a word of BAhE, which the CLL lexicon gives only to `ba'e` and `za'e`.

CLL's sources do not agree on `fu'e`. The BNF (the grammar in Backus-Naur Form) of CLL 21.2 reads `indicators = [FUhE] indicator ...`, so an indicator must follow a `fu'e`. The magic-word list of CLL 19.16 says that `fu'e` is "the same as UI". The YACC preamble is the official parser's steps before its grammar. Step 4e of that preamble, printed in CLL 1.0, absorbs every `fu'e` after a word, and so does the official parser.

This stage follows CLL 19.8, which gives the meaning of `fu'e`: "Placing fu'e in front of an attitudinal disconnects it from what precedes it". So a `fu'e` stands directly in front of an indicator, and the stage rejects a `fu'e` that has no indicator after it.

CLL 19.8 also lets several `fu'e` scopes stand in force at once. It says that "Other attitudinals of more local scope can appear after attitudinals marked by FUhE." So `indicator-run` lets each indicator take its own `fu'e`, and one word can take several such groups. This is the camxes rule `indicators <- FUhE_clause? indicator+`, repeated after a word. The BNF's rule `word = [BAhE] any-word [indicators]` allows only one group after a word, so this stage departs from the BNF there. That limit appears to be an oversight, since the YACC parser absorbs the indicators before its grammar reads them.

The CLL lexicon tags `fu'e` `indicator`, so `unit` never reads it as a word. Under these rules, `mi fu'e ui klama`, `mi fu'e ui nai klama` and `mi ui fu'e ia klama` are texts. The text `mi viska le fu'e .ia blanu zdani fu'o ponse` is one too. A `ba'e` can stand before the word or before the `fu'e`, as in `ba'e mi fu'e ui klama` and `mi ba'e fu'e ui klama`. The stage rejects `mi fu'e klama`, `mi ui fu'e klama` and `mi fu'e fu'e ui klama`. In each of them, a `fu'e` has no indicator directly after it.

The stage also rejects `mi fu'e y klama`. The BNF counts `y` as an indicator, but the word stage drops hesitation, as the Magic Words proposal treats `.y.` as a pause. So no indicator follows that `fu'e` in this stage. A run at the start of the text follows the same rule. So `fu'e ui mi klama` and `ui fu'e ia mi klama` are texts, and the stage rejects `fu'e mi klama`.
