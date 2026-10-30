# The Eberban reference grammar

Eberban is a logical constructed language by mia. This pipeline reads Eberban as [the reference grammar](https://eberban.github.io/eberban/) describes it. The reference grammar is a book with chapters on morphology, chaining, binding, sentences and the smaller constructs. The executable baseline is `eberban.peggy`, the parsing expression grammar (PEG) of the language at [commit `fd76a4e9`](https://github.com/eberban/eberban/blob/fd76a4e993f071747ef5484531c28a15773ffa74/web/src/grammar/eberban.peggy). The book decides. The PEG is supporting evidence, and the closing section of each document lists the departures from it.

A pipeline document defines an ordered sequence of stages. A stage is one step of a pipeline, with its own grammar. A token is one unit that a stage reads or emits. [The notation document](../../../docs/notation.md) explains jbogenbau, the notation of these grammars.

Eberban has no lexicon in its grammar. Every particle family is infinite, and the shape of a word gives its family. So the stages classify words by shape, and no document lists words.

The pipeline turns on the warnings below by default. Each marks a spelling that the grammar accepts but the book does not recommend. A caller can turn a warning off.

```jbogenbau
%features hyphen-misplaced prefix-i-after-sonorant minus-sign math-symbol compound-size
```

## Stage 1: letters

```jbogenbau
%stage letters
```

- [Letters](letters.md): the alphabet, repeated letters, case, hyphens, spaces, digits and brackets
  ```jbogenbau
  %include "letters.md"
  ```

The stage reads the characters of the text. It hands the forms stage one token per letter, with the sound classes of the letter as tags. It also hands on spaces, hyphens, digits and the two quotation brackets.

## Stage 2: forms

```jbogenbau
%stage forms
```

- [Word forms](morphology.md): the self-segregating morphology, particle families, roots, borrowings, freeform variables, compound prefixes and spelling quotes
  ```jbogenbau
  %include "morphology.md"
  ```

The stage divides the letters into words and tags each word with its family. It keeps spaces and brackets and drops hesitation.

## Stage 3: words

```jbogenbau
%stage words
```

- [The word stream](stream.md): compounds, foreign quotes and spacing
  ```jbogenbau
  %include "stream.md"
  ```

The stage assembles compounds and foreign quotes into single tokens and drops the spaces and brackets. It hands the syntax stage a stream of words.

## Stage 4: syntax

```jbogenbau
%stage syntax
```

- [The grammar](syntax.md): texts, paragraphs, sentences, chains, bindings, enumerations, quotes, numbers and annotations
  ```jbogenbau
  %include "syntax.md"
  ```

The stage builds the tree of the text. An elided terminator is a closing word left unwritten. The stage ranks the parses of a text with `late-elision`, so an elided terminator falls as late as the text allows. [The notation document](../../../docs/notation.md#elided-terminators) defines this ranking.

```jbogenbau
%ambiguity-resolution late-elision
```

## Differences from the reference grammar and the PEG

Each stage document closes with its own list. The pipeline as a whole departs from the PEG in two policies.

The PEG reports a custom message for each mistake it recognizes, and a parse that queued such a message fails even when another reading succeeds. This pipeline reports only that a text has no parse and where the parse stops. Its grammar states each rule that a message of the PEG describes. So a text that the PEG rejects with a message has no parse here.

The PEG erases ungrammatical text with `ra` by reading characters again without regard to quotes. So a `ra` inside a closed foreign quote erases an ungrammatical sentence there. Here a quote is a quote wherever it stands, and a `ra` inside one is quoted text. [The word stream](stream.md#differences-from-the-reference-grammar-and-the-peg) explains the choice.
