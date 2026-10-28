# The CLL word stream

This document is part of the words stage in the [CLL](pipeline.md) pipeline. A stage is one step of a pipeline, with its own grammar. A token is one unit that a stage reads or emits. Each stage reads the tokens that the stage before it emitted, and emits new tokens. Each pipeline includes this document after [../common/stream.md](../common/stream.md). [The notation document](../../../docs/notation.md) explains the notation.

The rules follow *The Complete Lojban Language* (CLL). A cmavo is a particle, a short structure word. A letteral is a letter word of class BY, as [../common/stream.md](../common/stream.md) defines it. This document warns about cmavo with `y` as a vowel and requires pauses around a name that `bu` takes.

The word forms admit a cmavo with `y` as one more vowel unit. Examples are `ka'y` and `ky'a` ([morphology.md](morphology.md)). The forms stage gives each such word the tag `Cmavo-Warning`. A tag marks a token by an identifier.

This stage reads the word under the warning `y-cmavo`. The stage always reads the word. A feature is a named switch that the grammars test. A caller who turns on the feature `y-cmavo` gets a warning for each such word.

The stage gives the warning where it reads the word as a Lojban word. That is, the word can be a word of the text, a quoted word, or a word inside `lo'u ... le'u`. It can also be either `zoi` delimiter or an operand of `zei`, erased or not. Each delimiter warns when it is a `y`-cmavo. The warning is absent for the word inside a `zoi` body or after `fa'o`, because the stage does not read that word as Lojban.

```jbogenbau
%redefine-rule cmavo-token
  | Cmavo<¬Cmavo-Warning>
  | y-cmavo! Cmavo<Cmavo-Warning>
```

<details><summary>Railroad diagram of <code>cmavo-token</code></summary>
<p><img src="../../../docs/diagrams/lojban/cll/stream/cmavo-token.svg" alt="Railroad diagram of the rule cmavo-token"></p>
</details>

A name that `bu` takes needs a pause on both sides of it in the source (CLL[^cll-s17-4]). The forms stage requires a pause or the end of the text after every name, as CLL requires.[^cll-s4-9] It tags the first word of each run `Run-Initial`. A run is a stretch with no internal pause.

In CLL, a name that is not the first word of its run follows `la`, `lai`, `la'i` or `doi` directly, with no pause before it. So the name must be the first word of its run. Thus `ladjan.bu` and `ladjan.mi si bu` are no texts, and `la.djan.bu` is `la` and a letteral.

A replacement name keeps its source boundary. Thus `ladjan. sa .djim. bu` leaves `la` and the letteral of `djim`. The rule keeps the shared compound-gap recipes and trailing-pause tests while adding the CLL name condition. A name inside a compound is not the operand: `ladjan. zei mi bu` makes a letteral of the compound. Inside `lo'u ... le'u`, where `bu` does nothing, `lo'u ladjan.bu le'u` is valid.

```jbogenbau
%redefine-rule lerfu-word :: Word ∪ BY ∪ Fault ∩ $u.tags
  | $u:unit<¬Trailing-Pause> compound-gap cmavo-token<BU>
  | su-boundary? $u:unit<Trailing-Pause> suppressed-gap cmavo-token<BU>
%conditions
  CMEVLA ⊈ $u.tags ∨ Run-Initial ⊆ $u.tags
%emits
  $
```

<details><summary>Railroad diagram of <code>lerfu-word</code></summary>
<p><img src="../../../docs/diagrams/lojban/cll/stream/lerfu-word.svg" alt="Railroad diagram of the rule lerfu-word"></p>
</details>

## Differences from CLL and BPFK

The `y`-cmavo forms extend those that CLL gives, as [morphology.md](morphology.md) explains. The BPFK word forms omit those forms and the CLL-specific pause test for names before BU. BPFK is the Lojban language planning committee.

[^cll-s17-4]: [CLL 1.1, section 17.4](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-bu.html).

[^cll-s4-9]: [CLL 1.1, section 4.9, rule 2](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-pauses.html).
