# Indicators and `ba'e`

This document is the indicator stage, the fourth stage of every Lojban dialect: [CLL](../dialects/cll-ebnf.md), [approved word forms](../dialects/bpfk.md), [experimental](../dialects/experimental.md) and [Zantufa](../dialects/zantufa.md). A dialect is a pipeline of stages, defined by one pipeline document. A stage is one step of a pipeline, with its own grammar. This stage reads the words that the word stage emitted. It applies the one rule of CLL's grammar that the book calls non-formal, because a parser applies it before the grammar proper. The rule is `word ≔ [BAhE] any-word [indicators]`.

The indicators are the attitudinals and discursives of UI and CAI with an optional `nai` after each. They are also the cancel `da'o` and the scope marker `fu'o`. A `fu'e` opens a group of them. CLL counts the hesitation `y` among them too, but the word stage drops hesitation, so it never reaches this stage.

A run of indicators attaches to the word before it, and a `ba'e` attaches to the word after it. The stage hands on the word as one token, which carries them as its attachments ([the engine](../../docs/engine.md), §11). The syntax does not read an attachment, but the renderings show it with its word. So `mi ui klama` is `([mi ui] klama)` in brackets, and the syntax reads `mi klama`.

The lexicon of the forms stage decides what a word is, which words are indicators and which are `ba'e`. The `indicator` tag, a name that an implication of the lexicon gives a word, marks both indicators and `fu'e`. The word stage passes these tags on, but a word that it emitted as the material of a quote or a compound carries no class. So this stage never attaches an attitudinal inside `zo`, `lo'u ... le'u` or before `bu`.

A run of indicators at the start of the text, before any word, stays in the stream. This is because the `text` rule of the syntax grammar reads it there. A `ba'e` with no word after it stays in the stream too. In a run that stays in the stream, the stage attaches only `ba'e`, as the section "Leading runs" says. [The notation document](../../docs/notation.md) explains the notation.

The stage reads an indicator run as far as it goes, so the stage is greedy. Where two parses differ, it takes the one that reads the next word over the one that closes a constituent.

```jbogenbau
%ambiguity-resolution greedy
```

## Nested texts

A text opener is a word whose class introduces a nested text: `lu` of LU and `to` of TO. The syntax reads a nested text with `text`, which begins with its own indicators. So an indicator directly after a text opener belongs to the nested text, not to the opener. `lu ui mi klama li'u` quotes `ui mi klama`, `lu ui li'u` quotes the text `ui`, and `to ui mi klama toi` holds `ui` in the parenthesis.

So a run of indicators directly after a text opener stays in the stream. A run at the start of the text does the same (see "Leading runs"). A closing word, such as `li'u` or `toi`, is an ordinary word. An indicator after it attaches to it, and so applies to the quote or the parenthesis as a whole. `tu'e` of TUhE is not a text opener. It introduces `text-1`, which reads no leading indicators, so an indicator after `tu'e` attaches to `tu'e`.

```jbogenbau
%const $TEXT-OPENERS
  LU ∪ TO
```

## The stream

```jbogenbau
%rule text
  | ε | item-run | item-run bahe-run | leading | leading bahe-run | bahe-run
  | $l(leading) $r(item-run) | $l(leading) $r(item-run) bahe-run
%conditions
  NAI ⊈ tags(head($r)) ∨ classes(last($l)) ∩ (UI ∪ CAI) = ∅

%rule item-run
  | item
  | item-run item
  | $p(item-run) leading
%conditions
  classes(last($p)) ∩ $TEXT-OPENERS ≠ ∅
```

An item is a word with the `ba'e` run before it and the indicator run after it, where it has them. The item hands on the word, with the `ba'e` words attached before it and the indicators after it. A text opener takes no indicators, as above.

```jbogenbau
%rule item
  | $w(unit) | $b(bahe-run) $w(unit)
  | $w(unit) $a(indicator-run) | $b(bahe-run) $w(unit) $a(indicator-run)
%tags
  tags($w)
%conditions
  $a ⟹ classes($w) ∩ $TEXT-OPENERS = ∅
%emits
  ($b) $w ($a)

%rule unit
  | ~word∩(~indicator ∪ BAhE ∪ LEhU)=∅ | ~foreign-text | LEhU

%rule bahe-run
  bahe | bahe-run bahe

%rule bahe
  ~word⊇BAhE
%emits
  $
```

A `le'u` outside any quote is still a word. But the stage reads it as `LEhU` and not also as a plain word, so that it has one reading.

## Indicator runs

An indicator run after a word attaches each of its indicators, `fu'e` included, to the word, each as a token of its own. Each of them carries the `ba'e` run before it as its attachment. A `nai` after an attitudinal attaches to the attitudinal. So `mi ui nai ia klama` hands on `mi` with `ui` and `ia` after it, and `ui` carries `nai` after it. In brackets, that is `([mi {ui nai} ia] klama)`.

The rule `attitudinal-nai` reads the pair with three captures: the `ba'e` run before the attitudinal, the attitudinal word, and the `nai`. The `nai` carries its own `ba'e` run before it. So `mi ba'e ui nai klama` gives `ui` with `ba'e` before it and `nai` after it, and `mi ui ba'e nai klama` gives `nai` with `ba'e` before it. The label of `ui` is `ui` in both.

```jbogenbau
%rule indicator-run
  | [fuhe] indicator | [fuhe] attitudinal-nai
  | indicator-run [fuhe] indicator | indicator-run [fuhe] attitudinal-nai

%rule indicator
  | $i(~word) | $b(bahe-run) $i(~word)
%tags
  tags($i)
%conditions
  ~indicator ⊆ tags($i),
  FUhE ⊈ classes($i)
%emits
  ($b) $i

%rule fuhe
  | $i(~word) | $b(bahe-run) $i(~word)
%tags
  tags($i)
%conditions
  FUhE ⊆ classes($i)
%emits
  ($b) $i

%rule attitudinal-nai
  | $u(attitudinal) $n(nai) | $b(bahe-run) $u(attitudinal) $n(nai)
%tags
  tags($u)
%emits
  ($b) $u ($n)

%rule attitudinal
  $i(~word)
%tags
  tags($i)
%conditions
  ~indicator ⊆ tags($i),
  classes($i) ∩ (UI ∪ CAI) ≠ ∅

%rule nai
  | $m(~word⊇NAI) | $b(bahe-run) $m(~word⊇NAI)
%tags
  tags($m)
%emits
  ($b) $m
```

After a run of indicators at the start of the text, a `nai` belongs to the last of them when that is an attitudinal. So `iu nai` is one run, not `iu` followed by a text that begins with `nai`.

A `ba'e` before an indicator marks the indicator and goes with it. So does a `ba'e` before the `nai` of an attitudinal. `ba'e` "marks the following word but does not change its meaning", as the Magic Words proposal says. Also, "One NAI can follow any UI or CAI cmavo". So `mi .e .ui ba'e nai do` negates the `.ui` and leaves the `.e` as it is.

The stage reads an indicator run as far as it goes: `broda ui nai` attaches both words to `broda`. Because the stage is greedy, `nai` is part of the run and not the next word of the syntax. A `ba'e` is a word of BAhE, which the CLL lexicon gives only to `ba'e` and `za'e`.

CLL's sources do not agree on `fu'e`. The BNF (the grammar in Backus-Naur Form) of CLL 21.2 reads `indicators = [FUhE] indicator ...`, so an indicator must follow a `fu'e`. The magic-word list of CLL 19.16 says that `fu'e` is "the same as UI". The YACC preamble is the official parser's steps before its grammar. Step 4e of that preamble, printed in CLL 1.0, absorbs every `fu'e` after a word, and so does the official parser.

This stage follows CLL 19.8, which gives the meaning of `fu'e`: "Placing fu'e in front of an attitudinal disconnects it from what precedes it". So a `fu'e` stands directly in front of an indicator, and the stage rejects a `fu'e` that has no indicator after it.

CLL 19.8 also lets several `fu'e` scopes stand in force at once. It says that "Other attitudinals of more local scope can appear after attitudinals marked by FUhE." So `indicator-run` lets each indicator take its own `fu'e`, and one word can take several such groups. This is the camxes rule `indicators <- FUhE_clause? indicator+`, repeated after a word. The BNF's rule `word = [BAhE] any-word [indicators]` allows only one group after a word, so this stage departs from the BNF there. That limit appears to be an oversight, since the YACC parser absorbs the indicators before its grammar reads them.

The CLL lexicon marks `fu'e` `indicator`, so `unit` never reads it as a word. Under these rules, `mi fu'e ui klama`, `mi fu'e ui nai klama` and `mi ui fu'e ia klama` are texts. The text `mi viska le fu'e .ia blanu zdani fu'o ponse` is one too. A `ba'e` can stand before the word or before the `fu'e`, as in `ba'e mi fu'e ui klama` and `mi ba'e fu'e ui klama`. In the second, the `ba'e` goes with the `fu'e`. The stage rejects `mi fu'e klama`, `mi ui fu'e klama` and `mi fu'e fu'e ui klama`. In each of them, a `fu'e` has no indicator directly after it.

The stage also rejects `mi fu'e y klama`. The BNF counts `y` as an indicator, but the word stage drops hesitation, as the Magic Words proposal treats `.y.` as a pause. So no indicator follows that `fu'e` in this stage. A run at the start of the text follows the same rule. So `fu'e ui mi klama` and `ui fu'e ia mi klama` are texts, and the stage rejects `fu'e mi klama`.

## Leading runs

A leading run is a run of indicators that the syntax reads itself: at the start of the text, or directly after a text opener. Its indicators stay in the stream, each as a token of its own. A `ba'e` before one of them attaches to it, since the syntax does not read `ba'e`. But a `nai` after an attitudinal stays a token of its own, and the syntax reads `UI NAI` as it always has. So `ba'e ui nai mi klama` hands on `ui`, with `ba'e` attached before it, and then `nai`, `mi` and `klama`.

The reason is that the syntax reads this run. A `nai` nested under its attitudinal hides from the syntax, which then reads a second `nai` after the attitudinal as that attitudinal's own. So `pau nai nai mi klama` becomes a text. With the `nai` in the stream, the syntax rejects it, as it always has.

```jbogenbau
%rule leading
  | [fuhe] indicator | [fuhe] leading-attitudinal-nai
  | leading [fuhe] indicator | leading [fuhe] leading-attitudinal-nai

%rule leading-attitudinal-nai
  | $u(attitudinal) $m(~word⊇NAI) | $b(bahe-run) $u(attitudinal) $m(~word⊇NAI)
  | $u(attitudinal) $c(bahe-run) $m(~word⊇NAI) | $b(bahe-run) $u(attitudinal) $c(bahe-run) $m(~word⊇NAI)
%emits
  ($b) $u, ($c) $m
```
