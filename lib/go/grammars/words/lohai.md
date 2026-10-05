# Replacement quotes

A letteral is a letter word of class BY, as [stream.md](stream.md) defines it.

This document is part of the word stage of the [experimental](../dialects/experimental.md) and [Zantufa](../dialects/zantufa.md) dialects, after [the word stream](stream.md). A stage is one step of a pipeline, with its own grammar. A token is one unit that a stage reads or emits. Each stage reads the tokens that the stage before it emitted, and emits new tokens. [The notation document](../../docs/notation.md) explains the notation.

camxes-exp and Zantufa 1.9999 both read a replacement quote as raw words (`LOhAI_pre`). So does this stage: a replacement quote is one unit, as in Zantufa's `si_word`. It is up to two runs of words, each opened by a word of LOhAI (`lo'ai` or `sa'ai`), and then `le'ai`. A `le'ai` alone is a whole quote too.

The words inside are plain words, whatever they are. No magic word executes there, including BU, ZEI, and FAhO. No indicator attaches there.

So `mi lo'ai su le'ai klama` keeps `mi`, and `mi lo'ai zo le'ai klama` is a text. A magic word after the quote acts on all of it. Thus `lo'ai mi le'ai si` is nothing, and `lo'ai mi le'ai bu` is a letteral. The syntax reads the quote as a free modifier.

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
