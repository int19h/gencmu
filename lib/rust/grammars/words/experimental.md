# Experimental word forms

This document is part of the word stage in the [experimental](../dialects/experimental.md) and [Zantufa](../dialects/zantufa.md) dialects. It is stitched in after [bpfk.md](bpfk.md). camxes-exp and Zantufa 1.9999 read the PEG word forms of the definition effort, with small changes, and this document adds those changes. The notation is explained in [the notation document](../../docs/notation.md).

CLL 3.6 forbids the consonant pair `mz`, and so does the approved grammar: its letter rule for `m` refuses a following `z`. Among the consonants that may follow `m`, the letter rule for `m` in camxes-exp refuses only another `m`, and so does the one in Zantufa's morphology. So both accept `mz` wherever a permissible pair can stand. Examples are the gismu `kamzi`, the lujvo `bamzda` and the name `.djeimz.`. The pair is never an initial pair. The alternatives below add `mz` to the tables of [shapes.md](shapes.md) and to the runs of a name in [bpfk.md](bpfk.md).

```jbogenbau
%extend-rule after-m
  /z/

%extend-rule before-z
  /m/

%extend-rule run-before-z
  run-m
```
