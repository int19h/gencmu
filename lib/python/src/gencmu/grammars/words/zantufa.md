# Zantufa word forms

This document is part of the word stage in the [Zantufa](../dialects/zantufa.md) dialect. It is stitched in after [bpfk.md](bpfk.md). Zantufa 1.9999 reads the word forms of the definition effort with one change, and this document makes it. The rule here has the name of the Zantufa rule that it translates, and its comment gives that rule, as in bpfk.md. The notation is explained in [the notation document](../../docs/notation.md).

CLL 3.6 forbids the consonant pair `mz`, and so does the approved grammar: its letter rule for `m` refuses a following `z`. The letter rule for `m` in Zantufa refuses only another `m` among the consonants, as camxes-exp's does. So Zantufa accepts `mz` wherever a permissible pair can stand. Examples are the gismu `kamzi`, the lujvo `bamzda` and the name `.djeimz.`. The other changes that camxes-exp makes to the word forms, in [experimental.md](experimental.md), are not Zantufa's.

```jbogenbau
%redefine-rule m              (* m <- [mM] !h !glide !m *)
  $c(/m/)
%conditions
  ¬begins(after($c), h),
  ¬begins(after($c), glide),
  ¬begins(after($c), m)
```
