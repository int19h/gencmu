# The approved grammar's readings

This document completes the syntax stage of the [bpfk](../dialects/bpfk.md) dialect, after [the CLL grammar](cll.md). A dialect is a pipeline of stages, defined by one pipeline document. A stage is one step of a pipeline, with its own grammar. This document says how the stage chooses among parses, which the CLL grammar leaves to each dialect that uses it.

The definition effort replaced the YACC grammar of the official parser with a PEG (parsing expression grammar). The bpfk dialect reads elided terminators as the PEG grammars do, camxes-std among them. A PEG never gives back what it read. So the part of a rule before an elided terminator runs as far as the words after it can extend it.

The resolution `maximal` says that. A terminator cannot be elided where the part of its alternative just before it can be longer. So `le nanmu joi le ninmu cu klama` parses, since no `sumti-tail` longer than `nanmu` begins there. But `le lojbo se farvi le loglo gi'enai mintu ja dunli le logla` is an error, since `lojbo se farvi` is a longer `sumti-tail`.

A PEG is greedy everywhere, and `maximal` only where a terminator is elided. So `maximal` can find a longer part that a PEG never reads, one that divides the words before the terminator differently.

In `le nu da poi remna li paso nanca kei cu broda`, the tail terms of `remna` are `li paso`, and `vau` is elided before `nanca`. `maximal` forbids that, because the terms can also be `li pa` and `so nanca`. That reading splits the number `paso`, which a PEG reads whole. The design document records this, the one such text of the test corpus.

The stage is also greedy and `elision-only`, as in the cll-ebnf dialect. Unlike a PEG, it does not order the alternatives of a rule. So a text that the printed grammar leaves ambiguous in anything but a terminator is an error that shows both readings. `mi broda joi ke brode ke'e` is such a text.

```jbogenbau
%ambiguity-resolution greedy elision-only maximal
```
