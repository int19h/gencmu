# The word stream

This document opens the words stage of the [Eberban pipeline](pipeline.md). A stage is one step of a pipeline, with its own grammar. A token is one unit that a stage reads or emits. A tag marks a token by an identifier.

The stage reads the words and spaces of the [forms stage](morphology.md). It keeps the words and drops the spaces, and it hands the syntax stage a stream of words. The forms stage reads each compound as one word token, and each spelling quote and foreign quote as one token. [The notation document](../../../docs/notation.md) explains jbogenbau, the notation of these grammars.

## The stream

The stream is a sequence of units with gaps between them. A gap is one or more space tokens, and it emits nothing. It is not erased, because foreign-letter warnings must survive the loss of spacing. Two units can also stand side by side, as `mi` and `bjan` do in `mibjan`. Each unit reads one token, so the text has one parse, and the `lazy` policy of the stage decides nothing.

A unit is a word, a stray prefix, or junk. Each retains its forms diagnostics. A stray prefix belongs to an unfinished compound. The closing `e` of an empty `er e` uses that class without another error. Junk is a run that no word reader accepts. Syntax erases junk or rejects it with its carried error.

```jbogenbau
%ambiguity-resolution lazy

%rule text
  [gap] [{unit [gap]}]

%rule gap
  {Space}

%rule unit
  Word | Stray-Prefix | Junk
%emits
  $
```

<details><summary>Railroad diagrams of <code>text</code>, <code>gap</code> and <code>unit</code></summary>
<p><img src="../../../docs/diagrams/eberban/refgram/stream/text.svg" alt="Railroad diagram of the rule text"></p>
<p><img src="../../../docs/diagrams/eberban/refgram/stream/gap.svg" alt="Railroad diagram of the rule gap"></p>
<p><img src="../../../docs/diagrams/eberban/refgram/stream/unit.svg" alt="Railroad diagram of the rule unit"></p>
</details>

## Differences from the reference grammar and the PEG

This stage preserves every diagnostic and adds none. The [word forms](morphology.md#diagnostic-codes-and-peg-sources) report local faults. The [syntax](syntax.md#diagnostic-codes-and-peg-sources) removes them only inside erased constituents.
