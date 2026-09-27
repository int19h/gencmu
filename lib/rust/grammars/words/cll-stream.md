# The CLL word stream

This document is part of the word stage in the [CLL](../dialects/cll-ebnf.md) dialect. It is stitched in after [stream.md](stream.md). It adds the two rules of CLL that the approved word forms do not have. One is a warning for a cmavo that uses `y` as a vowel. The other is the pauses around a name that `bu` takes. The notation is explained in [the notation document](../../docs/notation.md).

CLL's word forms admit a cmavo that uses `y` as one more vowel unit, beyond the forms that CLL gives. Examples are `ka'y` and `ky'a` ([cll.md](cll.md)). The forms stage tags each such word `cmavo-warning`. This stage reads it under the warning `y-cmavo`. The word is always read, and a caller who turns the feature on gets a warning for each one. The warning is given where the stage reads the word as a Lojban word. That is, the word may be a word of the text, a quoted word, or a word inside `lo'u ... le'u`. It may also be a `zoi` delimiter or an operand of `zei`, erased or not. It is not given for the word inside a `zoi` body or after `fa'o`, which is not read as Lojban.

```jbogenbau
%redefine-rule cmavo-token
  | $c("cmavo") <tags($c)>
  | @y-cmavo! $w("cmavo") <tags($w)>
%conditions
  "cmavo-warning" ∉ tags($c),
  "cmavo-warning" ∈ tags($w)
```

A name that `bu` takes needs a pause on both sides of it in the source (CLL 17.4). The forms stage puts one after every name, since CLL 4.9 rule 4 needs one there. It tags the first word of each run `run-initial`. In CLL, a name that is not the first word of its run follows `la`, `lai`, `la'i` or `doi` directly, with no pause before it. So the name must be the first word of its run: `ladjan.bu` and `ladjan.mi si bu` are no texts, and `la.djan.bu` is `la` and a letter word. A `sa` that leaves a name standing passes the tag on, so `ladjan. sa .djim. bu` is `la djim.bu`. A name inside a compound is not the operand: `ladjan. zei mi bu` makes a letter word of the compound. Inside `lo'u ... le'u`, where `bu` does nothing, `lo'u ladjan.bu le'u` is valid.

```jbogenbau
%redefine-rule lerfu-word
  | $u(unit) bu-part <"word" ∪ "BY" ∪ "wipes-all" ∩ tags($u)>
  | $u(unit) PAUSE bu-part <"word" ∪ "BY" ∪ "wipes-all" ∩ tags($u)>
  | $u(unit) erasure-gap bu-part <"word" ∪ "BY" ∪ "wipes-all" ∩ tags($u)>
  | y-base [PAUSE] bu-part <"word" ∪ "BY">
%conditions
  "CMEVLA" ∉ tags($u) ∨ "run-initial" ∈ tags($u)
%emits
  $
```
