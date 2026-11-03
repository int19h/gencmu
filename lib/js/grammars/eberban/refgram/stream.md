# The word stream

This document opens the words stage of the [Eberban pipeline](pipeline.md). A stage is one step of a pipeline, with its own grammar. A token is one unit that a stage reads or emits. A token's value is the string that exact comparisons read. Its image is the string that people see.

The stage reads the words and spaces of the [forms stage](morphology.md). It assembles compounds into single tokens, keeps the other words, and drops the spaces. A foreign quote is one word token from the forms stage, and this stage keeps it as a word. It hands the syntax stage a stream of words. A tag marks a token by an identifier. [The notation document](../../../docs/notation.md) explains jbogenbau, the notation of these grammars.

## The stream

The stream is a sequence of units with gaps between them. A gap is one or more space tokens. Two units can also stand side by side, as `mi` and `bjan` do in `mibjan`. A gap emits nothing. The stage is lazy. Where two parses differ, it takes the one that closes a constituent over the one that reads on. A constituent is the text that one rule matches.

```jbogenbau
%ambiguity-resolution lazy

%rule text
  [gap] [{unit [gap]}]

%rule gap
  {Space}
%erased

%rule unit
  plain-word | compound | stray-prefix | junk
```

<details><summary>Railroad diagrams of <code>text</code>, <code>gap</code> and <code>unit</code></summary>
<p><img src="../../../docs/diagrams/eberban/refgram/stream/text.svg" alt="Railroad diagram of the rule text"></p>
<p><img src="../../../docs/diagrams/eberban/refgram/stream/gap.svg" alt="Railroad diagram of the rule gap"></p>
<p><img src="../../../docs/diagrams/eberban/refgram/stream/unit.svg" alt="Railroad diagram of the rule unit"></p>
</details>

A plain word is any word token except a compound prefix, which only a compound reads. Junk is a run that the forms stage read as no word. It passes through for the syntax stage, where only erased text admits it.

A prefix where no compound begins is junk too, so the syntax stage can erase it. The sentences chapter lets `ra` erase ungrammatical text, and an unfinished compound is such text. So `a e mi ra a mo` is a text. The condition on `stray-prefix` keeps it from standing where a compound reads.

```jbogenbau
%rule plain-word
  Word<¬Prefix>
%emits
  $

%rule junk
  Junk
%emits
  $

%rule stray-prefix
  $p:Prefix
%conditions
  ¬$p.onward.begins(compound)
%emits
  $ :: Junk
```

<details><summary>Railroad diagrams of <code>plain-word</code>, <code>junk</code> and <code>stray-prefix</code></summary>
<p><img src="../../../docs/diagrams/eberban/refgram/stream/plain-word.svg" alt="Railroad diagram of the rule plain-word"></p>
<p><img src="../../../docs/diagrams/eberban/refgram/stream/junk.svg" alt="Railroad diagram of the rule junk"></p>
<p><img src="../../../docs/diagrams/eberban/refgram/stream/stray-prefix.svg" alt="Railroad diagram of the rule stray-prefix"></p>
</details>

## Compounds

The [compounds chapter](https://eberban.github.io/eberban/books/refgram/book/grammar/compounds.html) makes one word from several. The prefix `e` takes two components, `en` three, and `er` any number up to a standalone `e`. A component is a particle, a root, a borrowing or a nested compound. A digit is a `TI` particle, so it can be a component. A foreign quote or a spelling quote is no component, because the quote is one word. Spaces can stand between the parts, so a component can follow its prefix in the same run or after a gap.

The forms stage tags a prefix written as a run of its own `Standalone`. An `er` compound ends at the first standalone `e`. So no component of an `er` compound can be a nested compound that starts with one. A nested compound with an attached prefix, as in `eberban`, can stand there.

The PEG warns about an `er` compound of one, two or three components. A single word needs no compound, and `e` and `en` spell two and three. The warning `compound-size` marks such a compound here. The rule `few-er-components` reads one to three components, and `er-components` reads four or more. Their bodies show the bounds.

A compound emits one token tagged `Word` and `Compound`. Its value is the compound in the shortest canonical form of the compounds chapter, which the dictionary uses. When a nested compound is the first component of another, their prefixes join into one unit. The joined prefix spells its vowel `i` after `e` and `e` after `n` or `r`. So `e e ber ban ban` and `ei ber ban ban` both have the value `ei ber ban ban`. Single spaces separate the other parts. A component keeps its word value, so a digit stands as its `TI` word. The image is the same as the value.

The rule `compound-tail` reads a compound and gives its value without the vowel of its own prefix. A compound puts `e` in front of its tail. A compound whose first component is a nested compound reads that component as a tail, and joins it with the vowel that the chapter gives. That vowel depends on the letter before it, so a tail comes in two kinds. `compound-tail` follows a vowel written `e`, and `joined-tail` follows one written `i`. The rule `fixed-tail` holds the alternatives that are the same in both kinds. The rule `simple-component` is a component that is not a compound, so each first component has one reading. Each `er-component` adds a space and its value to the value of the list.

```jbogenbau
%rule compound
  $t:compound-tail :: Word ∪ Compound ∪ $t.tags := "e" ++ $t.emitted.value
%emits
  $

%rule compound-tail
  | $t:fixed-tail :: $t.tags := $t.emitted.value
  | $p:E-PREFIX [gap] $n:joined-tail [gap] $b:component
      :: ($p.tags ∩ Standalone ≠ ∅ ⟹ Spaced-E) := "i" ++ $n.emitted.value ++ " " ++ $b.emitted.value

%rule joined-tail
  | $t:fixed-tail :: $t.tags := $t.emitted.value
  | $p:E-PREFIX [gap] $n:compound-tail [gap] $b:component
      :: ($p.tags ∩ Standalone ≠ ∅ ⟹ Spaced-E) := "e" ++ $n.emitted.value ++ " " ++ $b.emitted.value

%rule fixed-tail
  | $p:E-PREFIX [gap] $a:simple-component [gap] $b:component
      :: ($p.tags ∩ Standalone ≠ ∅ ⟹ Spaced-E) := " " ++ $a.emitted.value ++ " " ++ $b.emitted.value
  | EN-PREFIX [gap] $a:simple-component [gap] $b:component [gap] $c:component
      := "n " ++ $a.emitted.value ++ " " ++ $b.emitted.value ++ " " ++ $c.emitted.value
  | EN-PREFIX [gap] $n:compound-tail [gap] $b:component [gap] $c:component
      := "ne" ++ $n.emitted.value ++ " " ++ $b.emitted.value ++ " " ++ $c.emitted.value
  | ER-PREFIX [gap] $l:er-components gap E-PREFIX<Standalone>
      := "r" ++ $l.emitted.value ++ " e"
  | compound-size! ER-PREFIX [gap] $l:few-er-components gap E-PREFIX<Standalone>
      := "r" ++ $l.emitted.value ++ " e"

%rule simple-component
  Word<Particle ¬Quote> | Word<Root> | Word<Borrowing>

%rule component
  simple-component | compound

%rule er-first
  | $c:simple-component := " " ++ $c.emitted.value
  | $n:compound-tail<¬Spaced-E> := "e" ++ $n.emitted.value

%rule er-component
  $c:component<¬Spaced-E> := " " ++ $c.emitted.value

%rule few-er-components
  er-first [[gap] er-component [[gap] er-component]]

%rule er-components
  er-first [gap] er-component [gap] er-component [gap] er-component [{[gap] er-component}]
```

<details><summary>Railroad diagrams of the 10 rules from <code>compound</code> to <code>er-components</code></summary>
<p><img src="../../../docs/diagrams/eberban/refgram/stream/compound.svg" alt="Railroad diagram of the rule compound"></p>
<p><img src="../../../docs/diagrams/eberban/refgram/stream/compound-tail.svg" alt="Railroad diagram of the rule compound-tail"></p>
<p><img src="../../../docs/diagrams/eberban/refgram/stream/joined-tail.svg" alt="Railroad diagram of the rule joined-tail"></p>
<p><img src="../../../docs/diagrams/eberban/refgram/stream/fixed-tail.svg" alt="Railroad diagram of the rule fixed-tail"></p>
<p><img src="../../../docs/diagrams/eberban/refgram/stream/simple-component.svg" alt="Railroad diagram of the rule simple-component"></p>
<p><img src="../../../docs/diagrams/eberban/refgram/stream/component.svg" alt="Railroad diagram of the rule component"></p>
<p><img src="../../../docs/diagrams/eberban/refgram/stream/er-first.svg" alt="Railroad diagram of the rule er-first"></p>
<p><img src="../../../docs/diagrams/eberban/refgram/stream/er-component.svg" alt="Railroad diagram of the rule er-component"></p>
<p><img src="../../../docs/diagrams/eberban/refgram/stream/few-er-components.svg" alt="Railroad diagram of the rule few-er-components"></p>
<p><img src="../../../docs/diagrams/eberban/refgram/stream/er-components.svg" alt="Railroad diagram of the rule er-components"></p>
</details>

## Differences from the reference grammar and the PEG

The PEG ends an `er` compound only at an `e` with spaces before it and spaces or the end of the text after it. So `a er mi bjan sa ta e1` fails there. The compounds chapter asks only for a space before the `e`. This stage ends the compound at any `e` that the forms stage reads as a run of its own, so a digit can follow it.

The PEG reads no digit as a compound component, so `a e 1 mi` fails there. The book calls each digit a `TI` particle, and the compounds chapter lets a particle be a component. So this stage reads that compound.

The PEG records each prefix as the text writes it. So `ei ber ban ban` has the inner prefix `i`, and `e e ber ban ban` has `e`. Two spellings of one compound then differ, and a `pa` resumption that repeats the verb in the other spelling fails there. The compounds chapter calls the joined prefix a shorthand for the spaced one. This stage gives both spellings one value, in the shortest canonical form that the chapter says the dictionary uses.
