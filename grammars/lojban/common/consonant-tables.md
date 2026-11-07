# Consonant tables

This document holds the consonant pair tables of the forms stage. A stage is one step of a pipeline, with its own grammar ([engine §1](../../../docs/engine.md#1-tokens)). A token is one unit that a stage reads or emits. A token's value is the string that exact comparisons read.

The loader stitches this document into the forms stage of every Lojban pipeline. Each word family keeps its own consonant rule. Each family also keeps its own statement for `n` before an affricate. Each family keeps its own ban on a letter before a following sound. A layer can add a pair to the table of its own stitched pipeline. The experimental layer and the Zantufa layer add `mz` in that way.

`$PERMISSIBLE` lists the 179 consonant pairs that can stand side by side. The list states the law of CLL[^cll-s3-6] for pairs of consonants. `$INITIAL` lists the 48 consonant pairs that can begin a word. The list states the inventory of CLL[^cll-s3-7]. `$AFFRICATES` lists the four affricate pairs. An affricate joins a stopped sound with friction.

```jbogenbau
%const $INITIAL
  "bl" "br"
  "cf" "ck" "cl" "cm" "cn" "cp" "cr" "ct"
  "dj" "dr" "dz"
  "fl" "fr"
  "gl" "gr"
  "jb" "jd" "jg" "jm" "jv"
  "kl" "kr"
  "ml" "mr"
  "pl" "pr"
  "sf" "sk" "sl" "sm" "sn" "sp" "sr" "st"
  "tc" "tr" "ts"
  "vl" "vr"
  "xl" "xr"
  "zb" "zd" "zg" "zm" "zv"

%const $PERMISSIBLE
  "bd" "bg" "bj" "bv" "bz" "bl" "bm" "bn" "br"
  "cf" "ck" "cp" "ct" "cl" "cm" "cn" "cr"
  "db" "dg" "dj" "dv" "dz" "dl" "dm" "dn" "dr"
  "fc" "fk" "fp" "fs" "ft" "fx" "fl" "fm" "fn" "fr"
  "gb" "gd" "gj" "gv" "gz" "gl" "gm" "gn" "gr"
  "jb" "jd" "jg" "jv" "jl" "jm" "jn" "jr"
  "kc" "kf" "kp" "ks" "kt" "kl" "km" "kn" "kr"
  "lb" "lc" "ld" "lf" "lg" "lj" "lk" "lm" "ln" "lp" "lr" "ls" "lt" "lv" "lx" "lz"
  "mb" "mc" "md" "mf" "mg" "mj" "mk" "ml" "mn" "mp" "mr" "ms" "mt" "mv" "mx"
  "nb" "nc" "nd" "nf" "ng" "nj" "nk" "nl" "nm" "np" "nr" "ns" "nt" "nv" "nx" "nz"
  "pc" "pf" "pk" "ps" "pt" "px" "pl" "pm" "pn" "pr"
  "rb" "rc" "rd" "rf" "rg" "rj" "rk" "rl" "rm" "rn" "rp" "rs" "rt" "rv" "rx" "rz"
  "sf" "sk" "sp" "st" "sx" "sl" "sm" "sn" "sr"
  "tc" "tf" "tk" "tp" "ts" "tx" "tl" "tm" "tn" "tr"
  "vb" "vd" "vg" "vj" "vz" "vl" "vm" "vn" "vr"
  "xf" "xp" "xs" "xt" "xl" "xm" "xn" "xr"
  "zb" "zd" "zg" "zv" "zl" "zm" "zn" "zr"

%const $AFFRICATES
  "tc" "ts" "dj" "dz"
```

[^cll-s3-6]: [CLL 1.1, section 3.6](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-clusters.html).

[^cll-s3-7]: [CLL 1.1, section 3.7](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-initial-pairs.html).
