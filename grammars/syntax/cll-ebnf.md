# The printed grammar's readings

This document completes the syntax stage of the [cll-ebnf](../dialects/cll-ebnf.md) dialect, after [the CLL grammar](cll.md). It says how the stage chooses among parses, which the CLL grammar leaves to each dialect that uses it.

The cll-ebnf dialect takes the grammar printed in chapter 21 of *The Complete Lojban Language*, with the repairs the CLL grammar lists, as the definition of Lojban's syntax. Any parse that grammar admits counts. A terminator may be elided wherever a parse of the whole text needs it, and a text is accepted when it has one reading once its elided terminators are written back. So `le nanmu joi le ninmu cu klama` parses, although CLL 14.14 says that CLL's official parser needs its `ku`, and so does `le lojbo se farvi le loglo gi'enai mintu ja dunli le logla`, whose description ends before `se farvi`. Where the printed grammar is ambiguous in anything but a terminator, the text is an error that shows both readings: `mi broda joi ke brode ke'e` is both a `ke` group joined to `broda` by `joi` and `joi` before a tanru unit that begins with `ke`.

The stage is greedy, so of two parses the one that reads the next word wins, and `elision-only`, so a text still ambiguous with its terminators written back is an error, as the notation document explains under "Ambiguity".

```jbogenbau
%ambiguity-resolution greedy elision-only
```
