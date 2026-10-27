# Word shapes

This document is part of the forms stage in the [CLL](pipeline.md) dialect. A stage is one step of a pipeline, with its own grammar ([engine §1](../../../docs/engine.md#1-tokens)).

A token is one unit that a stage reads or emits. A token's value is the string that exact comparisons read. Its image is the string that people see.

The document holds the sounds of the word forms in *The Complete Lojban Language* (CLL), edition 1.1. These are the consonants and their pairs, the vowels, diphthongs and stress. A diphthong combines two vowels in one syllable. The loader stitches it into the stage after [../common/forms.md](../common/forms.md) and before [morphology.md](morphology.md), which builds the words from these parts. The BPFK, experimental, and Zantufa dialects use [../bpfk/morphology.md](../bpfk/morphology.md), the word forms of the BPFK, the Lojban language planning committee, and use nothing here. [The notation document](../../../docs/notation.md) explains the notation.

The phoneme stage folds consonants to lowercase and writes each apostrophe with value `'`. It gives every vowel a lowercase value and marks stress with `Stressed`. It gives the syllable comma an empty value and the tag `Syllable-Break`.

Images spell phonemes in Latin letters. Only stressed vowels are capitals, and the syllable comma stays.

## Consonants

CLL[^cll-s3-6] forbids repeated consonants, two consonants from `c j s z`, and the pairs `cx`, `kx`, `xc`, `xk`, and `mz`. The voiced group contains b, d, g, j, v, and z. The unvoiced group contains c, f, k, p, s, t, and x. A pair cannot mix these two groups. The consonants l, m, n, and r are exempt from this voicing restriction. `$PERMISSIBLE` lists all 179 pairs that satisfy these restrictions.

Each consonant token has one lowercase Latin letter as its value, in both the Latin and Cyrillic scripts. Thus adjacent code points in a consonant run are exactly its adjacent token values.

CLL[^cll-s3-7] lists the 48 pairs in `$INITIAL` that can begin a word. A borrowing is a word taken from another language. A longer cluster can begin a borrowing if each adjacent pair in it is one of the 48 (CLL[^cll-s4-7]). So `spraile` is a borrowing, but not `ktraile` or `trkaile`. `long-initial-run` is every such cluster of three consonants or more. CLL[^cll-s3-7] forbids the triples `ndj ndz ntc nts`, except in a name.

```jbogenbau
%rule consonant
  | "b" | "c" | "d" | "f" | "g" | "j" | "k" | "l" | "m"
  | "n" | "p" | "r" | "s" | "t" | "v" | "x" | "z"

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

%rule initial-pair
  consonant consonant
%conditions
  $.value ∈ $INITIAL

%rule consonant-pair
  consonant consonant
%conditions
  $.value ∈ $PERMISSIBLE

%rule initial-cluster
  initial-pair | long-initial-run

%rule n-affricate
  "n" "t" "c" | "n" "t" "s" | "n" "d" "j" | "n" "d" "z"

%rule consonants
  consonant | consonants consonant

%rule has-n-affricate
  [consonants] n-affricate [consonants]
```

<details><summary>Railroad diagrams of the 7 rules from <code>consonant</code> to <code>has-n-affricate</code></summary>
<p><img src="../../../docs/diagrams/lojban/cll/shapes/consonant.svg" alt="Railroad diagram of the rule consonant"></p>
<p><img src="../../../docs/diagrams/lojban/cll/shapes/initial-pair.svg" alt="Railroad diagram of the rule initial-pair"></p>
<p><img src="../../../docs/diagrams/lojban/cll/shapes/consonant-pair.svg" alt="Railroad diagram of the rule consonant-pair"></p>
<p><img src="../../../docs/diagrams/lojban/cll/shapes/initial-cluster.svg" alt="Railroad diagram of the rule initial-cluster"></p>
<p><img src="../../../docs/diagrams/lojban/cll/shapes/n-affricate.svg" alt="Railroad diagram of the rule n-affricate"></p>
<p><img src="../../../docs/diagrams/lojban/cll/shapes/consonants.svg" alt="Railroad diagram of the rule consonants"></p>
<p><img src="../../../docs/diagrams/lojban/cll/shapes/has-n-affricate.svg" alt="Railroad diagram of the rule has-n-affricate"></p>
</details>



A permissible run is a run of consonants whose adjacent pairs are all permissible. A name can have such a run anywhere (CLL[^cll-s3-7]). A borrowing can have one in its middle, with no `n` triple in it (CLL[^cll-s4-7]). The borrowing rules in [morphology.md](morphology.md#borrowings) use `has-n-affricate` to exclude those triples.

`permissible-run` reads a nonempty consonant run. Every two adjacent values must form a pair in `$PERMISSIBLE`. A single consonant has no pair and satisfies the condition. So `.tlaiv.` and `.ekstcat.` are names, but `.djeimz.` and `.bobb.` are not.

```jbogenbau
%rule permissible-run
  consonants
%conditions
  $.value.ngrams(2) ⊆ $PERMISSIBLE
```

<details><summary>Railroad diagram of <code>permissible-run</code></summary>
<p><img src="../../../docs/diagrams/lojban/cll/shapes/permissible-run.svg" alt="Railroad diagram of the rule permissible-run"></p>
</details>



`long-initial-run` reads at least three consonants. Every two adjacent values must form a pair in `$INITIAL`.

```jbogenbau
%rule long-initial-run
  consonant consonant consonant [consonants]
%conditions
  $.value.ngrams(2) ⊆ $INITIAL
```

<details><summary>Railroad diagram of <code>long-initial-run</code></summary>
<p><img src="../../../docs/diagrams/lojban/cll/shapes/long-initial-run.svg" alt="Railroad diagram of the rule long-initial-run"></p>
</details>



## Vowels

A vowel of a word form has one of the lowercase values `a e i o u`, with or without `Stressed`. `y` is not one of them. It is a hyphen in a compound word (lujvo), a vowel of a name, a letter of a few particles (cmavo), and hesitation. A capital vowel marks stress, and nothing else about the word changes with the case of a letter.

The diphthongs of CLL[^cll-s3-4] are the falling `ai ei oi au` and the rising `ia ie ii io iu ua ue ui uo uu`. The rising ones can stand only in names and borrowings, and in a cmavo only as the whole word. A name can also have `iy` and `uy`. A diphthong can have a capital on either letter or on both, and it then marks one stressed syllable.

Cmavo stress is free.[^cll-s3-9] `capital-vowel` reads a stressed vowel, and `capital-letter` also reads stressed `y`.

The rule `any-letter` reads `Syllable-Break` to include commas in stress lookahead.

```jbogenbau
%rule vowel
  "a" | "e" | "i" | "o" | "u"

%rule capital-vowel
  vowel<Stressed>

%rule capital-letter
  name-vowel<Stressed>

%rule i-or-u
  "i" | "u"

%rule e-or-o
  "e" | "o"

%rule falling-diphthong
  "a" "i" | "e" "i" | "o" "i" | "a" "u"

%rule rising-diphthong
  i-or-u vowel

%rule y-diphthong
  i-or-u "y"

%rule r-letter
  "r"

%rule any-letters
  any-letter | any-letters any-letter

%rule any-letter
  consonant | vowel | "y" | "'" | Syllable-Break

%rule stress-mark
  [any-letters] capital-letter [any-letters]
```

<details><summary>Railroad diagrams of the 12 rules from <code>vowel</code> to <code>stress-mark</code></summary>
<p><img src="../../../docs/diagrams/lojban/cll/shapes/vowel.svg" alt="Railroad diagram of the rule vowel"></p>
<p><img src="../../../docs/diagrams/lojban/cll/shapes/capital-vowel.svg" alt="Railroad diagram of the rule capital-vowel"></p>
<p><img src="../../../docs/diagrams/lojban/cll/shapes/capital-letter.svg" alt="Railroad diagram of the rule capital-letter"></p>
<p><img src="../../../docs/diagrams/lojban/cll/shapes/i-or-u.svg" alt="Railroad diagram of the rule i-or-u"></p>
<p><img src="../../../docs/diagrams/lojban/cll/shapes/e-or-o.svg" alt="Railroad diagram of the rule e-or-o"></p>
<p><img src="../../../docs/diagrams/lojban/cll/shapes/falling-diphthong.svg" alt="Railroad diagram of the rule falling-diphthong"></p>
<p><img src="../../../docs/diagrams/lojban/cll/shapes/rising-diphthong.svg" alt="Railroad diagram of the rule rising-diphthong"></p>
<p><img src="../../../docs/diagrams/lojban/cll/shapes/y-diphthong.svg" alt="Railroad diagram of the rule y-diphthong"></p>
<p><img src="../../../docs/diagrams/lojban/cll/shapes/r-letter.svg" alt="Railroad diagram of the rule r-letter"></p>
<p><img src="../../../docs/diagrams/lojban/cll/shapes/any-letters.svg" alt="Railroad diagram of the rule any-letters"></p>
<p><img src="../../../docs/diagrams/lojban/cll/shapes/any-letter.svg" alt="Railroad diagram of the rule any-letter"></p>
<p><img src="../../../docs/diagrams/lojban/cll/shapes/stress-mark.svg" alt="Railroad diagram of the rule stress-mark"></p>
</details>



## Syllables and stress

The syllable scans read commas by their `Syllable-Break` tag, because a comma token has an empty value. `brivla-item` permits only unstressed `y`. `name-item` permits stressed `y` too.

A run of vowels with no apostrophe or comma in it divides into syllables from the left (CLL[^cll-s3-5]). At each point, the next two vowels are one syllable if they form a diphthong that the word allows. Otherwise the next vowel is a syllable alone. So `briau` is `bria-u`, and `.meiin.` is `mei-in`. A name or a borrowing can have two vowels that form no diphthong, each its own syllable, as in the `korea` of `bangrkorea`.

A syllabic consonant is a consonant pronounced as a syllable. The stress of a word depends on its syllables. CLL[^cll-s3-9] counts the syllables of `a e i o u` and their diphthongs. It does not count a syllable of `y`, `iy` or `uy`, or of a syllabic consonant. A syllabic consonant is still a consonant here, so it adds no syllable at all.

A brivla is a predicate word. It is stressed on its penultimate counted syllable. If a capital vowel marks the stress, every capital vowel of the brivla must be in that syllable, and exactly one counted syllable follows it. So `BAjykla` is right, because CLL[^cll-s3-9] does not count the `y`, and `bAIkla` is right, because `aI` is one syllable. A capital `Y` never stands in a brivla.

`brivla-scan` reads the letters of a brivla one syllable nucleus at a time, from the left. Its tags, the names that it puts on what it reads, say where the stress is. A nucleus is a vowel or a diphthong of a brivla. The lookahead requires a vowel that stands alone as a nucleus to form no diphthong with the vowel after it. So the reading is unique, and it is CLL's grouping. The tags are:

- `S0`, `S1` and `S2` track the marked nucleus. `S0` holds before the scan reads a capital vowel, and `S1` after the one marked nucleus. `S2` holds after the marked nucleus and one more counted nucleus. A second marked nucleus removes all three tags. A second counted nucleus after the marked one does too.
- `N0`, `N1`, `N2` and `N3`, for no counted nucleus, one, two, and three or more
- `First-Marked`, when the first counted nucleus is the marked one
- `Single-End`, when the last letter read is a vowel that is a nucleus by itself

So a brivla with marked stress has `S2`, and one without any capital vowel has `S0` and at least `N2`. [morphology.md](morphology.md) applies these tests.

```jbogenbau
%rule brivla-scan
  | $i:brivla-item
      :: (Counted ⊆ $i.tags ⟹ N1) ∪ (Counted ⊈ $i.tags ⟹ N0)
       ∪ (Marked ⊆ $i.tags ⟹ S1 ∪ First-Marked) ∪ (Marked ⊈ $i.tags ⟹ S0)
       ∪ Single-End ∩ $i.tags
  | $s:brivla-scan $j:brivla-item
      :: (S0 ⊆ $s.tags ∧ Marked ⊈ $j.tags ⟹ S0)
       ∪ (S0 ⊆ $s.tags ∧ Marked ⊆ $j.tags ⟹ S1)
       ∪ (S1 ⊆ $s.tags ∧ Counted ⊈ $j.tags ⟹ S1)
       ∪ (S1 ⊆ $s.tags ∧ Counted ⊆ $j.tags ∧ Marked ⊈ $j.tags ⟹ S2)
       ∪ (S2 ⊆ $s.tags ∧ Counted ⊈ $j.tags ⟹ S2)
       ∪ (Counted ⊈ $j.tags ⟹ (N0 ∪ N1 ∪ N2 ∪ N3) ∩ $s.tags)
       ∪ (Counted ⊆ $j.tags ∧ N0 ⊆ $s.tags ⟹ N1)
       ∪ (Counted ⊆ $j.tags ∧ N1 ⊆ $s.tags ⟹ N2)
       ∪ (Counted ⊆ $j.tags ∧ (N2 ∪ N3) ∩ $s.tags ≠ ∅ ⟹ N3)
       ∪ First-Marked ∩ $s.tags
       ∪ (N0 ⊆ $s.tags ∧ Marked ⊆ $j.tags ⟹ First-Marked)
       ∪ Single-End ∩ $j.tags
%conditions
  Single-End ⊈ $s.tags ∨ ¬$s.last-token.onward.begins(brivla-diphthong)

%rule brivla-item
  | consonant | "y"<¬Stressed> | "'" | Syllable-Break
  | $v:vowel :: Counted ∪ Single-End ∪ ($v.matches(capital-vowel) ⟹ Marked)
  | $d:brivla-diphthong :: Counted ∪ ($d.matches(stress-mark) ⟹ Marked)

%rule brivla-diphthong
  falling-diphthong | rising-diphthong
```

<details><summary>Railroad diagrams of <code>brivla-scan</code>, <code>brivla-item</code> and <code>brivla-diphthong</code></summary>
<p><img src="../../../docs/diagrams/lojban/cll/shapes/brivla-scan.svg" alt="Railroad diagram of the rule brivla-scan"></p>
<p><img src="../../../docs/diagrams/lojban/cll/shapes/brivla-item.svg" alt="Railroad diagram of the rule brivla-item"></p>
<p><img src="../../../docs/diagrams/lojban/cll/shapes/brivla-diphthong.svg" alt="Railroad diagram of the rule brivla-diphthong"></p>
</details>



A cmavo or a name can have capital vowels on any of its syllables, `Y` included (CLL[^cll-s3-9] lets their stress fall anywhere). A name with no capital vowel is stressed on its penultimate counted syllable if it has two or more. It is stressed on its only counted syllable if it has one, and nowhere if it has none.

`name-scan` reads a name as `brivla-scan` reads a brivla, with the diphthongs a name allows. A `y` is a nucleus of its own, and never the first letter of a diphthong. The choice `brivla-diphthong | y-diphthong` also admits `iy` and `uy`. The scan has these tags:

- `N0` to `N3` and `Single-End`, as above
- `V0` before the scan reads a nucleus, and `V1` after the first nucleus
- `First-Counted`, when the first nucleus is counted, and `First-Marked`, when it has a capital vowel
- `Any-Marked`, when some nucleus has a capital vowel

The forms stage uses the stress on the first syllable of a name, for the pause rule of CLL[^cll-s4-2] between two stressed syllables. That is where `la` or `doi` comes before a name with no pause.

```jbogenbau
%rule name-scan
  | $i:name-item
      :: (Nucleus ⊆ $i.tags ⟹ V1) ∪ (Nucleus ⊈ $i.tags ⟹ V0)
       ∪ (Counted ⊆ $i.tags ⟹ N1 ∪ First-Counted) ∪ (Counted ⊈ $i.tags ⟹ N0)
       ∪ (Marked ⊆ $i.tags ⟹ First-Marked ∪ Any-Marked)
       ∪ Single-End ∩ $i.tags
  | $s:name-scan $j:name-item
      :: (V1 ⊆ $s.tags ∨ Nucleus ⊆ $j.tags ⟹ V1)
       ∪ (V0 ⊆ $s.tags ∧ Nucleus ⊈ $j.tags ⟹ V0)
       ∪ First-Counted ∩ $s.tags
       ∪ (V0 ⊆ $s.tags ∧ Counted ⊆ $j.tags ⟹ First-Counted)
       ∪ First-Marked ∩ $s.tags
       ∪ (V0 ⊆ $s.tags ∧ Marked ⊆ $j.tags ⟹ First-Marked)
       ∪ Any-Marked ∩ $s.tags
       ∪ (Marked ⊆ $j.tags ⟹ Any-Marked)
       ∪ (Counted ⊈ $j.tags ⟹ (N0 ∪ N1 ∪ N2 ∪ N3) ∩ $s.tags)
       ∪ (Counted ⊆ $j.tags ∧ N0 ⊆ $s.tags ⟹ N1)
       ∪ (Counted ⊆ $j.tags ∧ N1 ⊆ $s.tags ⟹ N2)
       ∪ (Counted ⊆ $j.tags ∧ (N2 ∪ N3) ∩ $s.tags ≠ ∅ ⟹ N3)
       ∪ Single-End ∩ $j.tags
%conditions
  Single-End ⊈ $s.tags ∨ ¬$s.last-token.onward.begins(brivla-diphthong | y-diphthong)

%rule name-item
  | consonant | "'" | Syllable-Break
  | $v:vowel :: Nucleus ∪ Counted ∪ Single-End ∪ ($v.matches(capital-vowel) ⟹ Marked)
  | $y:"y" :: Nucleus ∪ ($y.matches(stress-mark) ⟹ Marked)
  | $d:brivla-diphthong :: Nucleus ∪ Counted ∪ ($d.matches(stress-mark) ⟹ Marked)
  | $e:y-diphthong :: Nucleus ∪ ($e.matches(stress-mark) ⟹ Marked)

%rule name-vowel
  vowel | "y"
```

<details><summary>Railroad diagrams of <code>name-scan</code>, <code>name-item</code> and <code>name-vowel</code></summary>
<p><img src="../../../docs/diagrams/lojban/cll/shapes/name-scan.svg" alt="Railroad diagram of the rule name-scan"></p>
<p><img src="../../../docs/diagrams/lojban/cll/shapes/name-item.svg" alt="Railroad diagram of the rule name-item"></p>
<p><img src="../../../docs/diagrams/lojban/cll/shapes/name-vowel.svg" alt="Railroad diagram of the rule name-vowel"></p>
</details>



[^cll-s3-6]: [CLL 1.1, section 3.6](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-clusters.html).

[^cll-s3-7]: [CLL 1.1, section 3.7](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-initial-pairs.html).

[^cll-s4-7]: [CLL 1.1, section 4.7](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-fuhivla.html).

[^cll-s3-4]: [CLL 1.1, section 3.4](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-diphthongs.html).

[^cll-s3-9]: [CLL 1.1, section 3.9](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-stress.html).

[^cll-s3-5]: [CLL 1.1, section 3.5](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-vowel-pairs.html).

[^cll-s4-2]: [CLL 1.1, section 4.2](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-cmavo.html).
