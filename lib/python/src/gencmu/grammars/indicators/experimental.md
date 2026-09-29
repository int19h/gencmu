# The indicators of camxes-exp

This document is a layer (a document that changes earlier rules) over [the indicator stage of CLL](cll.md). A dialect is a pipeline of stages, defined by one pipeline document. A stage is one step of a pipeline, with its own grammar. The [experimental](../dialects/experimental.md) dialect stitches this layer after the CLL document, that is, it reads the two as one grammar. This layer changes two things, so that the stage reads indicators as camxes-exp does. [The notation document](../../docs/notation.md) explains the notation.

A bare `nai` is an indicator, since camxes-exp's `indicator` rule takes a NAI word alone. [The experimental word forms](../words/experimental.md) mark the NAI words `indicator` with an implication. So a `nai` after any word attaches to it: `mi nai klama` is `mi klama` with the indicator `nai`, and `je nai` is `je` with the indicator `nai`. The syntax sees a `nai` only where no word stands before it, at the start of a text or of a nested text.

A `nai` directly after an attitudinal attaches to the attitudinal, as in the CLL document. So `mi ui nai klama` gives `mi` the indicator `ui`, and `ui` carries `nai`. Any other `nai` is an indicator of its own. That includes a `nai` after a `fu'e`, as in `mi ui fu'e nai klama`, and a `nai` after a word that is not an attitudinal.

With both forms, two readings of `ui nai` tie. So this document restates `indicator-run` with a condition. If a run ends in an attitudinal, its next indicator of its own is not a `nai`. A `fu'e` before that `nai` lifts this. A `ba'e` between an attitudinal and its `nai` goes with the `nai`, as in the CLL document. The restated `text` drops the CLL condition on a `nai` after a leading attitudinal. A `nai` is an indicator here, so a run of items never begins with one.

A leading run needs no pair form. The syntax reads `ui` and `nai` as separate indicators there. So this document restates `leading` without the pair form of the CLL document.

The CLL document already reads `fu'e` as camxes-exp's `indicators` rule does. A `fu'e` must have an indicator after it, so `mi fu'e ui klama` is a text, and `mi fu'e klama` is not. The restated `indicator-run` lets each indicator take its own `fu'e`.

Indicators do not attach to `lu`, since camxes-exp's `LU_post` takes none. They stay in the stream, where they begin the quoted text: `lu ui li'u` quotes the text `ui`. The CLL document states this for every text opener, so this layer needs no rule of its own for it.

```jbogenbau
%redefine-rule text
  | ε | item-run | item-run bahe-run | leading | leading bahe-run | bahe-run
  | leading item-run | leading item-run bahe-run

%redefine-rule leading
  | [fuhe] indicator | leading [fuhe] indicator

%redefine-rule indicator-run
  | [fuhe] indicator | [fuhe] attitudinal-nai
  | indicator-run [fuhe] attitudinal-nai
  | $r(indicator-run) $i(indicator)
  | indicator-run fuhe indicator
%conditions
  NAI ⊈ tags($i) ∨ classes(last($r)) ∩ (UI ∪ CAI) = ∅
```
