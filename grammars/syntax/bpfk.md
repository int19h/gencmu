# The approved grammar's readings

This document completes the syntax stage of the [bpfk](../dialects/bpfk.md) dialect, after [the CLL grammar](cll.md). It says how the stage chooses among parses, which the CLL grammar leaves to each dialect that uses it.

The definition effort replaced the YACC grammar with a PEG, and the bpfk dialect reads elided terminators as the PEG grammars do, camxes-std among them. A PEG never gives back what it has read: the part of a rule before an elided terminator runs as far as the words after it can extend it. The resolution `maximal` says that: a terminator may not be elided where the part of its alternative just before it could have been longer. So `le nanmu joi le ninmu cu klama` parses, since no `sumti-tail` longer than `nanmu` begins there, and `le lojbo se farvi le loglo gi'enai mintu ja dunli le logla` is an error, since `lojbo se farvi` is a longer `sumti-tail`.

A PEG is greedy everywhere, and `maximal` only where a terminator is elided. So `maximal` may find a longer part that a PEG would never read, one that divides the words before the terminator differently. In `da poi remna li paso nanca kei`, the tail terms of `remna` are `li paso`, and `vau` is elided before `nanca`. `maximal` forbids that, since the terms could also have been `li pa` and `so nanca`, which splits the number `paso` that a PEG reads whole. The design document records this, the one such text of the corpus.

The stage is also greedy and `elision-only`, as in the cll-ebnf dialect. Unlike a PEG it does not order the alternatives of a rule, so a text the printed grammar leaves ambiguous in anything but a terminator, such as `mi broda joi ke brode ke'e`, is an error that shows both readings.

```jbogenbau
%ambiguity-resolution greedy elision-only maximal
```
