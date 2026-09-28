# The indicators of camxes-exp

This document is a layer (a document that changes earlier rules) over [the indicator stage of CLL](cll.md). A dialect is a pipeline of stages, defined by one pipeline document. A stage is one step of a pipeline, with its own grammar. The [experimental](../dialects/experimental.md) dialect stitches this layer after the CLL document, that is, it reads the two as one grammar. This layer changes two things, so that the stage reads indicators as camxes-exp does. [The notation document](../../docs/notation.md) explains the notation.

A bare `nai` is an indicator, since camxes-exp's `indicator` rule takes a NAI word alone. [The experimental lexicon](../words/lexicon-experimental.md) tags the NAI words `indicator`. So a `nai` after any word attaches to it: `mi nai klama` is `mi klama`, and `je nai` is `je` with the indicator `nai`. The syntax sees a `nai` only where no word stands before it, at the start of a text or of a quote. An attitudinal takes its `nai` as any word does, so this layer does not use the `attitudinal nai` form of the CLL document.

With that form, two readings of `ui nai` tie. So this document restates `indicator-run` without that form. Nothing reads that document's rules `attitudinal` and `nai`. The restated `text` drops the CLL condition on a `nai` after a leading attitudinal. A `nai` is an indicator here, so a run of items never begins with one.

The CLL document already reads `fu'e` as camxes-exp's `indicators` rule does. A `fu'e` must have an indicator after it, so `mi fu'e ui klama` is a text, and `mi fu'e klama` is not. The restated `indicator-run` lets each indicator take its own `fu'e`.

Indicators do not attach to `lu`, since camxes-exp's `LU_post` takes none. They stay in the stream, where they begin the quoted text: `lu ui li'u` quotes the text `ui`.

```jbogenbau
%redefine-rule text
  | ε | item-run | item-run bahe-run | leading | leading bahe-run | bahe-run
  | leading item-run | leading item-run bahe-run

%redefine-rule item-run
  | item
  | item-run item
  | $p(item-run) indicator-run
%conditions
  "LU" ∈ classes(last($p))

%redefine-rule item
  | [absorbed-bahe] $w(unit)
  | [absorbed-bahe] $w(unit) $a(absorbed)
%tags
  tags($w)
%conditions
  $a ⟹ "LU" ∉ classes($w)
%emits
  $w

%redefine-rule indicator-run
  [fuhe] indicator | indicator-run [fuhe] indicator
```
