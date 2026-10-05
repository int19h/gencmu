# The CLL word stream

This document is part of the word stage in the [CLL](../dialects/cll-ebnf.md) dialect. A stage is one step of a pipeline, with its own grammar. A token is one unit that a stage reads or emits. Each stage reads the tokens that the stage before it emitted, and emits new tokens. The dialect includes this document after [stream.md](stream.md). [The notation document](../../docs/notation.md) explains the notation.

A cmavo is a particle, a short structure word. This document adds the two rules of CLL that the approved word forms do not have. One is a warning for a cmavo that uses `y` as a vowel. The other is the pauses around a name that `bu` takes.

CLL's word forms admit a cmavo that uses `y` as one more vowel unit, beyond the forms that CLL gives. Examples are `ka'y` and `ky'a` ([cll.md](cll.md)). The forms stage gives each such word the tag `cmavo-warning`. A tag marks a token by name, phoneme or character.

This stage reads the word under the warning `y-cmavo`. The stage always reads the word. A feature is a named switch that the grammars test. A caller who turns on the feature `y-cmavo` gets a warning for each such word.

The stage gives the warning where it reads the word as a Lojban word. That is, the word can be a word of the text, a quoted word, or a word inside `lo'u ... le'u`. It can also be a `zoi` delimiter or an operand of `zei`, erased or not. The warning is absent for the word inside a `zoi` body or after `fa'o`, because the stage does not read that word as Lojban.

```jbogenbau
%redefine-rule cmavo-token
  | ~cmavo⊉~cmavo-warning
  | y-cmavo! ~cmavo⊇~cmavo-warning
```

A name that `bu` takes needs a pause on both sides of it in the source (CLL 17.4). The forms stage requires a pause or the end of the text after every name, because CLL 4.9 rule 2 needs one there. It tags the first word of each run `run-initial`. A run is a stretch with no internal pause. In CLL, a name that is not the first word of its run follows `la`, `lai`, `la'i` or `doi` directly, with no pause before it. So the name must be the first word of its run: `ladjan.bu` and `ladjan.mi si bu` are no texts, and `la.djan.bu` is `la` and a letter word.

A replacement name keeps its source boundary. Thus `ladjan. sa .djim. bu` leaves `la` and the letteral of `djim`. A name inside a compound is not the operand: `ladjan. zei mi bu` makes a letter word of the compound. Inside `lo'u ... le'u`, where `bu` does nothing, `lo'u ladjan.bu le'u` is valid.

```jbogenbau
%redefine-rule lerfu-word
  $u(unit) skipped bu-word <~word ∪ BY ∪ ~fault ∩ tags($u)>
%conditions
  CMEVLA ⊈ tags($u) ∨ ~run-initial ⊆ tags($u)
%emits
  $
```
