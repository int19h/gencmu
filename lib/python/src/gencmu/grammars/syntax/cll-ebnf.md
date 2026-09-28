# The printed grammar's readings

This document completes the syntax stage of the [cll-ebnf](../dialects/cll-ebnf.md) dialect, after [the CLL grammar](cll.md). A dialect is a pipeline of stages, defined by one pipeline document. A stage is one step of a pipeline, with its own grammar. This document says how the stage chooses among parses, which the CLL grammar leaves to each dialect that uses it.

The cll-ebnf dialect takes the grammar that chapter 21 of *The Complete Lojban Language* (CLL) prints as the definition of Lojban's syntax. It takes that grammar with the repairs that the CLL grammar lists. Any parse that grammar admits counts. A terminator can be elided wherever a parse of the whole text needs it. The stage accepts a text when the text has one reading once the stage writes back its elided terminators.

So `le nanmu joi le ninmu cu klama` parses, although CLL 14.14 says that CLL's official parser needs its `ku`. `le lojbo se farvi le loglo gi'enai mintu ja dunli le logla` also parses, and its description ends before `se farvi`. Where the printed grammar is ambiguous in anything but a terminator, the text is an error that shows both readings. For example, `mi broda joi ke brode ke'e` is a `ke` group joined to `broda` by `joi`. It is also `joi` before a tanru unit that begins with `ke`.

The stage is greedy: of two parses, the one that reads the next word wins. It is also `elision-only`: a text that is still ambiguous with its terminators written back is an error. The notation document explains both under "Ambiguity".

```jbogenbau
%ambiguity-resolution greedy elision-only
```
