# Experimental word forms

This document is part of the word stage in the [experimental](../dialects/experimental.md) and [Zantufa](../dialects/zantufa.md) dialects. It is stitched in after [bpfk.md](bpfk.md). camxes-exp and Zantufa 1.9999 read the PEG word forms of the definition effort, with small changes, and this document adds those changes. The notation is explained in [the notation document](../../docs/notation.md).

CLL 3.6 forbids the consonant pair `mz`, and so does the approved grammar: its letter rule for `m` refuses a following `z`. The letter rule for `m` in camxes-exp refuses only another `m` among the consonants, and so does the one in Zantufa's morphology. So both accept `mz` wherever a permissible pair can stand. Examples are the gismu `kamzi`, the lujvo `bamzda` and the name `.djeimz.`.

```jbogenbau
%redefine-rule m              (* m <- comma* [mM] !h !glide !m *)
  $c(/m/)
%conditions
  ¬begins(after($c), h),
  ¬begins(after($c), glide),
  ¬begins(after($c), m)
```
