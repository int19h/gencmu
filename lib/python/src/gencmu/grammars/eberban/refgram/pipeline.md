# The Eberban reference grammar

Eberban is a logical constructed language by mia. This pipeline reads Eberban as [the reference grammar](https://eberban.github.io/eberban/) describes it. The reference grammar is a book with chapters on morphology, chaining, binding, sentences and the smaller constructs. The executable baseline is `eberban.peggy`, the parsing expression grammar (PEG) of the language at [commit `f10f86a0`](https://github.com/eberban/eberban/blob/f10f86a05f0d95d60e9cb7ffc7b7d7505c13ba99/web/src/grammar/eberban.peggy), version 0.67.5. The book decides. The PEG is supporting evidence, and the closing section of each document lists the departures from it.

A pipeline document defines an ordered sequence of stages. A stage is one step of a pipeline, with its own grammar. A token is one unit that a stage reads or emits. [The notation document](../../../docs/notation.md) explains jbogenbau, the notation of these grammars.

Eberban has no lexicon in its grammar. The shape of a word gives its family, and most particle families have no fixed list of members. So the stages classify words by shape, and no document lists words.

The pipeline turns on the warnings below by default. Each marks a text that the grammar accepts but that the book or the PEG does not recommend. A caller can turn a warning off.

```jbogenbau
%features hyphen-misplaced prefix-i-after-sonorant math-symbol compound-size non-eberban-letter multi-sentence-cai-elided
```

## Stage 1: letters

```jbogenbau
%stage letters
```

- [Letters](letters.md): the alphabet, repeated letters, case, hyphens, spaces, digits and brackets
  ```jbogenbau
  %include "letters.md"
  ```

The stage reads the characters of the text. It hands the forms stage one token per letter, with the sound classes of the letter as tags. It also hands on spaces, foreign letters, hyphens, digits and the two quotation brackets.

## Stage 2: forms

```jbogenbau
%stage forms
```

- [Word forms](morphology.md): the self-segregating morphology, particle families, roots, borrowings, freeform variables, compounds, spelling quotes and foreign quotes
  ```jbogenbau
  %include "morphology.md"
  ```

The stage divides the letters into words and quotes and tags each token with its family. A compound is one word unit, and a spelling quote and a foreign quote are each one quote unit. The stage hands on one space token for each gap and drops hesitation.

## Stage 3: words

```jbogenbau
%stage words
```

- [The word stream](stream.md): spacing
  ```jbogenbau
  %include "stream.md"
  ```

The stage drops the spaces and hands the syntax stage a stream of words.

## Stage 4: syntax

```jbogenbau
%stage syntax
```

- [The grammar](syntax.md): texts, paragraphs, sentences, chains, bindings, enumerations, quotes, numbers and annotations
  ```jbogenbau
  %include "syntax.md"
  ```

The stage builds the tree of the text. At equal engine measures, it prefers a specific failure to an unmatched closer or resumption. That preference never separates zero-error readings.

An elided terminator is a closing word left unwritten. The stage first prefers fewer words-erasure routes, then the latest erasure start. It then prefers fewer steps passed before a resumption, as [the grammar](syntax.md) explains. It then ranks the parses with `late #·_<_Elided>`, so an elided terminator falls as late as the text allows. [The notation document](../../../docs/notation.md#elided-terminators) defines these steps.

```jbogenbau
%ambiguity-resolution
  fewest $UNMATCHED-ERRORS, fewest #·words-erasure, late #(·erased-sentence ∪ ·erased-words),
    fewest #·passed-step, late #·_<_Elided>
```

## Differences from the reference grammar and the PEG

Each stage document closes with its own list. The pipeline as a whole departs from the PEG in two policies.

The PEG reports a custom message for each mistake it recognizes. A reading can queue a message and then fail. The first message still stays queued, and it then rejects the text. Around a few speculative attempts, it saves the queued message. If it discards the attempt, it restores the message. A later `ra` that erases ungrammatical text discards the queued message.

This pipeline reports named errors from its chosen derivation, alongside its warnings. An erased stretch contributes no error measure or diagnostic. A reading without counted errors takes precedence over an erroneous reading. A failed reading leaves no queued message. The stage documents map each code to its PEG source and list every deliberate departure.

The sentences chapter says that a `ra` inside a foreign quote erases an ungrammatical sentence. That passage describes the PEG. The PEG reads the characters of such a sentence again, without regard to quotes.

mia, who designed Eberban, considers that reading a limitation of the PEG. Her intent is that words and quotes are read first and parsed after. This pipeline does that, so a `ra` inside a quote is always quoted text. A compound is a word unit made of actual words, and a quote is a quote unit, not a word. So no quote starts in a component slot of a compound that is not complete. [The word forms](morphology.md#differences-from-the-reference-grammar-and-the-peg) give the details.
