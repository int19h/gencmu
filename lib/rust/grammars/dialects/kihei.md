# The kihei dialect

This dialect adds `ki'ei` phrases to CLL. A frame is a context for subsequent utterances. The proposed meaning sets the world in which those utterances hold as true.

The dialect includes CLL and then adds its rules to the syntax stage. The include leaves that stage active. The CLL documents explain the inherited rules and parsing policy.

- [The CLL dialect](cll-ebnf.md)
  ```jbogenbau
  %include "cll-ebnf.md"
  ```

A payload is the material after a marker. The payload after `ki'ei` accepts any number of CLL terms, including zero. For example, `ki'ei ko'a .i broda` supplies an argument, and `ki'ei pu zu ku .i broda` supplies a tense. The empty form `ki'ei .i broda` supplies no terms.

The CLL word stages already accept the word form of `ki'ei`. The new lexicon contains only this particle. The syntax stage uses it directly, so the dialect needs no change to an earlier stage.

```jbogenbau
%classifier lexicon
  "ki'ei" ∈ KIhEI
```

The marker rule reads one particle and asks the lexicon for its class. `phonemes($word)` gives its canonical sound, without stress marks. The condition admits only the new class, `KIhEI`.

The replacement paragraph rule accepts an initial sequence of utterances and subsequent groups with frames. It also accepts groups with frames at the start of a paragraph. Each group contains its frame and the subsequent `.i` sequence.

```jbogenbau
%redefine-rule paragraph
  utterance-sequence [{frame-group}] | {frame-group}

%rule utterance-sequence
  (statement | fragment) [{I # [statement | fragment]}]

%rule frame-group
  frame [I # [utterance-sequence]]

%rule frame
  frame-marker # [terms]

%rule frame-marker
  $word(~cmavo) <KIhEI>
%conditions
  KIhEI ⊆ classify(phonemes($word), lexicon)
```

<details><summary>Railroad diagrams of the 5 rules from <code>paragraph</code> to <code>frame-marker</code></summary>
<p><img src="../../docs/diagrams/dialects/kihei/paragraph.svg" alt="Railroad diagram of the rule paragraph"></p>
<p><img src="../../docs/diagrams/dialects/kihei/utterance-sequence.svg" alt="Railroad diagram of the rule utterance-sequence"></p>
<p><img src="../../docs/diagrams/dialects/kihei/frame-group.svg" alt="Railroad diagram of the rule frame-group"></p>
<p><img src="../../docs/diagrams/dialects/kihei/frame.svg" alt="Railroad diagram of the rule frame"></p>
<p><img src="../../docs/diagrams/dialects/kihei/frame-marker.svg" alt="Railroad diagram of the rule frame-marker"></p>
</details>

In `ki'ei ko'a .i broda .i brode ki'ei ko'e .i brodi`, the first group contains two utterances. The second group contains one. An earlier utterance can precede the first group, as in `broda ki'ei ko'a .i brode`.

The terms end at `.i`, another `ki'ei`, `ni'o`, or the enclosing text boundary. The grammar requires `.i` before an utterance after a frame. It accepts a frame without subsequent utterances, as in `ki'ei ko'a`. It also accepts consecutive frames, as in `ki'ei ko'a ki'ei ko'e .i broda`.

The CLL rules place `ni'o` outside each paragraph. This dialect places each frame above the `.i` sequence inside that paragraph. The grammar records these boundaries without deciding how an interpreter carries context across them.

This example accepts terms as payloads. It rejects a full predicate payload, such as `ki'ei ce'u purci ce'u .i broda`. It adds no pronoun for the selected world.
