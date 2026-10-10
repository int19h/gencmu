# Replacement quotes

This document is part of the word stage of the [experimental](../dialects/experimental.md) and [Zantufa](../dialects/zantufa.md) dialects, after [the word stream](stream.md). A stage is one step of a pipeline, with its own grammar. A token is one unit that a stage reads or emits. Each stage reads the tokens that the stage before it emitted, and emits new tokens. [The notation document](../../docs/notation.md) explains the notation.

A replacement quote is one unit of raw words. It is up to two runs of words, each opened by a word of LOhAI (`lo'ai` or `sa'ai`), and then `le'ai`. A `le'ai` alone is a whole quote too.

The words inside are plain words, whatever they are. No magic word executes there, including BU, ZEI, and FAhO. No indicator attaches there.

A letteral is a letter word of class BY, as [stream.md](stream.md) defines it. So `mi lo'ai su le'ai klama` keeps `mi`, and `mi lo'ai zo le'ai klama` is a text. A magic word after the quote acts on all of it. Thus `lo'ai mi le'ai si` is nothing, and `lo'ai mi le'ai bu` is a letteral. The syntax reads the quote as a free modifier.

The quote carries the tags of its first marker, as every quote carries its marker's. A tag marks a token by name, phoneme or character. So in the experimental dialect, `sa` finds it by its class, and `mi lo'ai do le'ai sa lo'ai ti le'ai klama` keeps `mi`. The words inside carry no class, so none of them is a boundary for `su`.

In the experimental dialect, a marker that opens no quote is an ordinary word. [The word stream](stream.md) reads no word where a quote begins, and only there. So `mi lo'ai si klama` is `mi klama`, and `mi lo'ai bu klama` has a letteral. The Zantufa word stream has its own rules for such a marker.

```jbogenbau
%extend-rule quote
  (* LOhAI_pre <- pre_clause (LOhAI spaces? (!LOhAI !LEhAI any_word)* )? (LOhAI spaces? (!LOhAI !LEhAI any_word)* )? LEhAI spaces? *)
  lohai-quote

%rule lohai-quote
  | $e(lehai-marker) <tags($e)>
  | $r(lohai-run) spacing lehai-marker <tags($r)>
  | $r(lohai-run) spacing lohai-run spacing lehai-marker <tags($r)>

%rule lohai-run
  | $m(lohai-marker) <tags($m)>
  | $m(lohai-marker) spacing lohai-stream <tags($m)>

%rule lohai-stream
  | lohai-element
  | lohai-stream PAUSE lohai-element
  | lohai-stream lohai-element

%rule lohai-element
  lohai-word | hesitation

%rule lohai-word
  $w(read-word)
%conditions
  classes($w) ∩ (LOhAI ∪ LEhAI) = ∅
%emits
  $ <~word>

%rule lohai-marker
  $q(read-word) <classes($q) ∪ ~word ∪ ~cmavo>
%conditions
  LOhAI ⊆ classes($q)
%emits
  $

%rule lehai-marker
  $q(read-word) <classes($q) ∪ ~word ∪ ~cmavo>
%conditions
  LEhAI ⊆ classes($q)
%emits
  $
```

<details><summary>Railroad diagrams of the 8 rules from <code>quote</code> to <code>lehai-marker</code></summary>
<p><img src="../../docs/diagrams/words/lohai/quote.svg" alt="Railroad diagram of the rule quote"></p>
<p><img src="../../docs/diagrams/words/lohai/lohai-quote.svg" alt="Railroad diagram of the rule lohai-quote"></p>
<p><img src="../../docs/diagrams/words/lohai/lohai-run.svg" alt="Railroad diagram of the rule lohai-run"></p>
<p><img src="../../docs/diagrams/words/lohai/lohai-stream.svg" alt="Railroad diagram of the rule lohai-stream"></p>
<p><img src="../../docs/diagrams/words/lohai/lohai-element.svg" alt="Railroad diagram of the rule lohai-element"></p>
<p><img src="../../docs/diagrams/words/lohai/lohai-word.svg" alt="Railroad diagram of the rule lohai-word"></p>
<p><img src="../../docs/diagrams/words/lohai/lohai-marker.svg" alt="Railroad diagram of the rule lohai-marker"></p>
<p><img src="../../docs/diagrams/words/lohai/lehai-marker.svg" alt="Railroad diagram of the rule lehai-marker"></p>
</details>

## Reference behavior

camxes-exp, the experimental grammar of the camxes parser, reads replacement quotes as raw words in `LOhAI_pre`. Zantufa 1.9999 does too. This stage retains that treatment and the single-unit boundary of Zantufa's `si_word`. Magic words after a quote act on the whole unit, as the [experimental dialect's differences section](../dialects/experimental.md#where-it-reads-texts-differently-from-camxes-exp) describes.
