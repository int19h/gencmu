# Indicators and `ba'e`

This document is the indicator stage, the fourth stage of every Lojban dialect: [CLL](../dialects/cll-ebnf.md), [BPFK](../dialects/bpfk.md), [experimental](../dialects/experimental.md) and [Zantufa](../dialects/zantufa.md). A dialect is a pipeline of stages, defined by one pipeline document. A stage is one step of a pipeline, with its own grammar. This stage reads the words that the word stage emitted, and applies `word`, one of the four rules that CLL's grammar calls non-formal. A parser applies this rule before the grammar proper. The rule is `word ≔ [BAhE] any-word [indicators]`.

The indicators are the attitudinals and discursives of UI and CAI with an optional `nai` after each. They are also the cancel `da'o` and the scope marker `fu'o`. A `fu'e` opens a group of them. CLL counts the hesitation `y` among them too, but the word stage drops hesitation, so it never reaches this stage.

A run of indicators attaches to the word before it, and a `ba'e` attaches to the word after it. The stage hands on the word as one token, which carries them as its attachments ([the engine](../../docs/engine.md), §11). The syntax does not read an attachment, but the renderings show it with its word. So `mi ui klama` is `([mi ui] klama)` in brackets, and the syntax reads `mi klama`.

The lexicon of the forms stage decides what a word is, which words are indicators and which are `ba'e`. The `indicator` tag, a name that an implication of the lexicon gives a word, marks both indicators and `fu'e`. The word stage passes these tags on, but a word that it emitted as the material of a quote or a compound carries no class. So this stage never attaches an attitudinal inside `zo`, `lo'u ... le'u` or before `bu`.

A run of indicators at the start of the text, before any word, stays in the stream. This is because the `text` rule of the syntax grammar reads it there. A `ba'e` with no word after it stays in the stream too. In a run that stays in the stream, the stage attaches only `ba'e`, as the section "Leading runs" says. [The notation document](../../docs/notation.md) explains the notation.

The stage reads an indicator run as far as it goes, so the stage is greedy. Where two parses differ, it takes the one that reads the next word over the one that closes a constituent.

```jbogenbau
%ambiguity-resolution greedy
```

## Quotation boundaries

CLL 13.9 states the exception before the general attachment rule. Its first rule says: "At the beginning of a text, indicators modify everything following them indefinitely". Its second covers "every other place in an utterance", where the indicator "attaches to the word immediately to its left".

CLL 21.2 writes `LU text`, and its `text` rule permits initial indicators. This stage reads "text" in CLL 13.9 as that grammar rule. So indicators after `lu` begin the quoted text and stay in the stream.

CLL 19.8 says that an attitudinal "Normally" applies to the preceding word. CLL 19.16 gives the general rule that UI and CAI mark the previous word. That general statement does not override the text-initial exception of CLL 13.9.

A quotation must hold any text, including one that begins with an indicator. Attaching that indicator to `lu` prevents the speaker from quoting such a text. An attachment to `lu` also duplicates an indicator on `li'u`.

CLL 13.9 states: "If the word that an indicator (or group) attaches to is itself a cmavo which governs a grammatical structure". It then says: "then the indicator construct pertains to the referent of the entire structure". That sentence describes meaning, and a quotation refers to its quoted text. It does not require attachment to `lu`.

A quoted text starts as a whole text does. CLL 21.2 lets `text` start with names or indicators, but not both. Both CLL dialects reject `ui .djan. mi klama` and `lu ui .djan. mi klama li'u` for that reason.

Experimental with `cbm` and Zantufa reject those texts under their own name-as-predicate rules. The [TO name probes](../../tests/corpus/adhoc.jsonl) record those policies as `adhoc.indicators.opener.to-ui-name.experimental` and `adhoc.indicators.opener.to-ui-name.zantufa`.

CLL 21.2 also writes `TO text`, so that rule alone does not separate TO from LU. CLL 19.12 example 19.67 uses `to'isa'a` and says that `sa'a` marks the whole bracketed remark. The BPFK section "Digressives" defines `to'i` as "Equivalent to {to sa'a}". These sources support the maintainer's decision that indicators after `to` and `to'i` attach to the opener. Indicators after `tu'e` also attach to that opener under CLL 19.8 and 13.9.

The official parser differs after `lu` because its preprocessor absorbs following indicators into the preceding token. On lojban-list, Cyril Slobin reported this for `lu .ue la djan. klama li'u` on October 1, 1995. John Cowan replied on October 2, 1995, under the subject "Parser bug - or my?". He wrote: "Yes; the parser is in error here, and you are correct."

This stage instead preserves the initial indicators of the quoted text. So `lu ui mi klama li'u` quotes `ui mi klama`, and `lu ui li'u` quotes `ui`.

The word stage already protects the material inside `zo`, `lo'u ... le'u`, and delimiter quotes such as `zoi`. That material carries no indicator class here. Zantufa's `lu'ei` also introduces quoted content, but its syntax handles that boundary. No word of the Zantufa lexicon carries the indicator tag, so this stage attaches only BAhE there.

A leading indicator run also stays in the stream at the start of the whole text. Closing words, such as `li'u` and `toi`, take ordinary indicator attachments.

```jbogenbau
%const $QUOTE-OPENERS
  LU
```

## The stream

```jbogenbau
%rule text
  | ε | item-run | item-run bahe-run | leading | leading bahe-run | bahe-run
  | leading item-run | leading item-run bahe-run

%rule item-run
  | item
  | item-run item
  | $p(item-run) leading
%conditions
  classes(last($p)) ∩ $QUOTE-OPENERS ≠ ∅
```

An item hands on a word with its preceding `ba'e` run and following indicator run attached. A quotation opener takes no following indicators, as above.

```jbogenbau
%rule item
  | $w(unit) | $b(bahe-run) $w(unit)
  | $w(unit) $a(indicator-run) | $b(bahe-run) $w(unit) $a(indicator-run)
%tags
  tags($w)
%conditions
  $a ⟹ classes($w) ∩ $QUOTE-OPENERS = ∅
%emits
  ($b) $w ($a)

%rule unit
  | ~word∩(~indicator ∪ BAhE ∪ LEhU)=∅ | ~quoted-text | LEhU

%rule bahe-run
  bahe | bahe-run bahe

%rule bahe
  ~word⊇BAhE
%emits
  $
```

A `le'u` outside any quote is still a word. But the stage reads it as `LEhU` and not also as a plain word, so that it has one reading.

A `bahe-run` is one or more `ba'e`, so `mi ba'e ba'e klama` is a text. Rule 1100 of CLL 21.2, `word = [BAhE] any-word [indicators]`, allows only one. This stage departs from it there and follows CLL 19.16, which says that "Multiple BAhE cmavo may be used in succession".

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

After a leading run (see "Leading runs"), a `nai` belongs to the last indicator of the run when that is an attitudinal. The stage is greedy, so it reads the `nai` into the run before it starts the next item. So `iu nai` is one run, not `iu` followed by a text that begins with `nai`. The same holds when a `ba'e` stands before the `nai`, as in `iu ba'e nai`.

A `ba'e` before an indicator marks the indicator and goes with it. So does a `ba'e` before the `nai` of an attitudinal. `ba'e` "marks the following word but does not change its meaning", as the Magic Words proposal says. A cmavo is a particle, a short structure word. Also, "One NAI can follow any UI or CAI cmavo". So `mi .e .ui ba'e nai do` negates the `.ui` and leaves the `.e` as it is.

The stage reads an indicator run as far as it goes: `broda ui nai` attaches both words to `broda`. Because the stage is greedy, `nai` is part of the run and not the next word of the syntax. A `ba'e` is a word of BAhE, which the CLL lexicon gives only to `ba'e` and `za'e`.

CLL's sources do not agree on `fu'e`. The EBNF of CLL 21.2 (its grammar in Extended Backus-Naur Form) reads `indicators = [FUhE] indicator ...`, so an indicator must follow a `fu'e`. The magic-word list of CLL 19.16 says that `fu'e` is "the same as UI". The YACC preamble is the official parser's steps before its grammar. Step 4e of that preamble, printed in CLL 1.0, absorbs every `fu'e` after a word, and so does the official parser.

This stage follows CLL 19.8, which gives the meaning of `fu'e`: "Placing fu'e in front of an attitudinal disconnects it from what precedes it". So a `fu'e` stands directly in front of an indicator, and the stage rejects a `fu'e` that has no indicator after it.

CLL 19.8 says that FUhO "cancels all in-force attitudinals". This stage infers that several FUhE groups can remain active together. Its `indicator-run` therefore permits each indicator to carry its own `fu'e`. The passage about local attitudinals describes unmarked attitudes, rather than several marked groups.

This choice departs from the printed EBNF, which permits one indicator group after a word. The official preprocessor absorbs indicators before its grammar reads them.

In [camxes-std](https://github.com/lojban/ilmentufa/blob/778ea138f7d150121ca722db7536ce3b123943ac/camxes.peg#L343-L1100), `post_clause` repeats `indicators <- FUhE_clause? indicator+`. This stage and camxes-std require an indicator after FUhE. Both permit further FUhE groups.

camxes-std nests further FUhE groups inside every clause whose post is [`post_clause`](https://github.com/lojban/ilmentufa/blob/778ea138f7d150121ca722db7536ce3b123943ac/camxes.peg#L376). [`UI_post`](https://github.com/lojban/ilmentufa/blob/778ea138f7d150121ca722db7536ce3b123943ac/camxes.peg#L1100), [`CAI_post`](https://github.com/lojban/ilmentufa/blob/778ea138f7d150121ca722db7536ce3b123943ac/camxes.peg#L536), [`DAhO_post`](https://github.com/lojban/ilmentufa/blob/778ea138f7d150121ca722db7536ce3b123943ac/camxes.peg#L588), and [`FUhO_post`](https://github.com/lojban/ilmentufa/blob/778ea138f7d150121ca722db7536ce3b123943ac/camxes.peg#L661) use that rule. [`FUhE_post`](https://github.com/lojban/ilmentufa/blob/778ea138f7d150121ca722db7536ce3b123943ac/camxes.peg#L655) does not use it. This stage keeps those groups flat.

camxes-std also lets UI and CAI clauses take further indicators before their following optional NAI. This stage instead keeps the run flat. Within a run, it attaches `nai` only to the UI or CAI directly before it. BAhE can intervene. Leading runs use the same boundary, but keep NAI as a syntax token.

A NAI after DAhO or FUhO stays available to the syntax. CLL 1.1 section 19.16 says that those classes do not absorb `nai`. The syntax reads it under its own rules.

In cll-ebnf and bpfk, `mi .e ui da'o nai do` negates `.e`. camxes-std instead negates `ui`.

In cll-ebnf and bpfk, `mi pu ui da'o nai klama` negates `pu`. camxes-std instead negates `ui`.

In cll-ebnf and bpfk, `mi ui ia nai nai klama` and `mi cai sai nai nai klama` fail. camxes-std accepts both and pairs each NAI with a different attitudinal.

In cll-ebnf and bpfk, `ui ia nai nai mi klama` and `cai sai nai nai mi klama` fail. camxes-std accepts both leading runs too.

The CLL lexicon marks `fu'e` `indicator`, so `unit` never reads it as a word. Under these rules, `mi fu'e ui klama`, `mi fu'e ui nai klama` and `mi ui fu'e ia klama` are texts. The text `mi viska le fu'e .ia blanu zdani fu'o ponse` is one too. The stage rejects `mi fu'e klama`, `mi ui fu'e klama` and `mi fu'e fu'e ui klama`. In each of them, a `fu'e` has no indicator directly after it.

A `ba'e` can stand before the word or before the `fu'e`, as in `ba'e mi fu'e ui klama` and `mi ba'e fu'e ui klama`. In the second, the `ba'e` goes with the `fu'e`.

The stage also rejects `mi fu'e y klama`. The EBNF counts `y` as an indicator, but the word stage drops hesitation, as the Magic Words proposal treats `.y.` as a pause. So no indicator follows that `fu'e` in this stage. A run at the start of the text follows the same rule. So `fu'e ui mi klama` and `ui fu'e ia mi klama` are texts, and the stage rejects `fu'e mi klama`.

## Leading runs

A leading run is a run of indicators that the syntax reads itself: at the start of the text, or directly after a quotation opener. Its indicators stay in the stream, each as a token of its own. A `ba'e` before one of them attaches to it, since the syntax does not read `ba'e`. But a `nai` after an attitudinal stays a token of its own, and the syntax reads `UI NAI`. So `ba'e ui nai mi klama` hands on `ui`, with `ba'e` attached before it, and then `nai`, `mi` and `klama`.

The reason is that the syntax reads this run. A `nai` nested under its attitudinal hides from the syntax, which then reads a second `nai` after the attitudinal as that attitudinal's own. So `pau nai nai mi klama` becomes a text. With the `nai` in the stream, the syntax rejects it.

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
