# The indicators of camxes-exp

This document is a layer over [the indicator stage of CLL](cll.md), and the [experimental](../dialects/experimental.md) dialect stitches it after that document. It changes three things, so that the stage reads indicators as camxes-exp does. The notation is explained in [the notation document](../../docs/notation.md).

A bare `nai` is an indicator, since camxes-exp's `indicator` rule takes a NAI word alone. [The experimental lexicon](../words/lexicon-experimental.md) tags the NAI words `indicator`, so a `nai` after any word attaches to it: `mi nai klama` is `mi klama`, and `je nai` is `je` with the indicator `nai`. The syntax sees a `nai` only where no word stands before it, at the start of a text or of a quote. An attitudinal takes its `nai` as any word does, so the CLL document's `attitudinal nai` form is not used here. Two readings of `ui nai` would otherwise tie.

A `fu'e` must have an indicator after it, as in camxes-exp's `indicators` rule: `mi fu'e ui klama` is a text, and `mi fu'e klama` is not.

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

%redefine-rule indicator
  | $i("word") | absorbed-bahe $i("word")
%tags
  tags($i)
%conditions
  "indicator" ∈ tags($i),
  "FUhE" ∉ classes($i)
%emits
  $

%rule fuhe
  | $i("word") | absorbed-bahe $i("word")
%tags
  tags($i)
%conditions
  "FUhE" ∈ classes($i)
%emits
  $
```
