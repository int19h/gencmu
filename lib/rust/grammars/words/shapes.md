# Word shapes

This document is part of the forms stage in the [CLL](../dialects/cll-ebnf.md) dialect. A stage is one step of a pipeline, with its own grammar ([engine §1](../../docs/engine.md#1-tokens)).

A token is one unit that a stage reads or emits. A token's value is the string that exact comparisons read. Its image is the string that people see.

The document holds the sounds of the word forms in *The Complete Lojban Language* (CLL), edition 1.1. These are the consonants and their pairs, the vowels, diphthongs and stress. A diphthong combines two vowels in one syllable. The loader stitches it into the stage after [forms.md](forms.md) and before [cll.md](cll.md), which builds the words from these parts. The BPFK, experimental, and Zantufa dialects use [bpfk.md](bpfk.md), the word forms of the BPFK, the Lojban language planning committee, and use nothing here. [The notation document](../../docs/notation.md) explains the notation.

The phoneme stage folds consonants to lowercase and writes each apostrophe with value `'`. Normalization gives every vowel a lowercase value and keeps stress through `Stressed`. It gives the syllable comma an empty value and keeps its tag `Syllable-Break`.

Images spell phonemes in Latin letters. Only stressed vowels are capitals, and the syllable comma stays.

## Consonants

CLL[^cll-s3-6] lists the permissible consonant pairs. A pair is never the same consonant twice, never a voiced and an unvoiced consonant together, and never two of `c j s z`. CLL[^cll-s3-6] also forbids the pairs `cx`, `kx`, `xc`, `xk` and `mz`. The voiced consonants are `b d g v j z`, and the unvoiced ones are `p t k f c s x`. `l m n r` are neither. For each consonant C, the rule `after-C` lists the consonants that can follow C, 179 pairs in all.

CLL[^cll-s3-7] lists the 48 pairs that can begin a word. A borrowing is a word taken from another language. A longer cluster can begin a borrowing if each adjacent pair in it is one of the 48 (CLL[^cll-s4-7]). So `spraile` is a borrowing, but not `ktraile` or `trkaile`. `long-initial-run` is every such cluster of three consonants or more. CLL[^cll-s3-7] forbids the triples `ndj ndz ntc nts`, except in a name.

```jbogenbau
%rule consonant
  | "b" | "c" | "d" | "f" | "g" | "j" | "k" | "l" | "m"
  | "n" | "p" | "r" | "s" | "t" | "v" | "x" | "z"

%rule initial-pair
  | "b" "l" | "b" "r"
  | "c" "f" | "c" "k" | "c" "l" | "c" "m" | "c" "n" | "c" "p" | "c" "r" | "c" "t"
  | "d" "j" | "d" "r" | "d" "z"
  | "f" "l" | "f" "r"
  | "g" "l" | "g" "r"
  | "j" "b" | "j" "d" | "j" "g" | "j" "m" | "j" "v"
  | "k" "l" | "k" "r"
  | "m" "l" | "m" "r"
  | "p" "l" | "p" "r"
  | "s" "f" | "s" "k" | "s" "l" | "s" "m" | "s" "n" | "s" "p" | "s" "r" | "s" "t"
  | "t" "c" | "t" "r" | "t" "s"
  | "v" "l" | "v" "r"
  | "x" "l" | "x" "r"
  | "z" "b" | "z" "d" | "z" "g" | "z" "m" | "z" "v"

%rule consonant-pair
  | "b" after-b | "c" after-c | "d" after-d | "f" after-f | "g" after-g | "j" after-j
  | "k" after-k | "l" after-l | "m" after-m | "n" after-n | "p" after-p | "r" after-r
  | "s" after-s | "t" after-t | "v" after-v | "x" after-x | "z" after-z

%rule after-b
  "d" | "g" | "j" | "v" | "z" | "l" | "m" | "n" | "r"

%rule after-d
  "b" | "g" | "j" | "v" | "z" | "l" | "m" | "n" | "r"

%rule after-g
  "b" | "d" | "j" | "v" | "z" | "l" | "m" | "n" | "r"

%rule after-v
  "b" | "d" | "g" | "j" | "z" | "l" | "m" | "n" | "r"

%rule after-j
  "b" | "d" | "g" | "v" | "l" | "m" | "n" | "r"

%rule after-z
  "b" | "d" | "g" | "v" | "l" | "m" | "n" | "r"

%rule after-c
  "f" | "k" | "p" | "t" | "l" | "m" | "n" | "r"

%rule after-s
  "f" | "k" | "p" | "t" | "x" | "l" | "m" | "n" | "r"

%rule after-x
  "f" | "p" | "s" | "t" | "l" | "m" | "n" | "r"

%rule after-k
  "c" | "f" | "p" | "s" | "t" | "l" | "m" | "n" | "r"

%rule after-f
  "c" | "k" | "p" | "s" | "t" | "x" | "l" | "m" | "n" | "r"

%rule after-p
  "c" | "f" | "k" | "s" | "t" | "x" | "l" | "m" | "n" | "r"

%rule after-t
  "c" | "f" | "k" | "p" | "s" | "x" | "l" | "m" | "n" | "r"

%rule after-l
  "b" | "c" | "d" | "f" | "g" | "j" | "k" | "m" | "n" | "p" | "r" | "s" | "t" | "v" | "x" | "z"

%rule after-r
  "b" | "c" | "d" | "f" | "g" | "j" | "k" | "l" | "m" | "n" | "p" | "s" | "t" | "v" | "x" | "z"

%rule after-m
  "b" | "c" | "d" | "f" | "g" | "j" | "k" | "l" | "n" | "p" | "r" | "s" | "t" | "v" | "x"

%rule after-n
  "b" | "c" | "d" | "f" | "g" | "j" | "k" | "l" | "m" | "p" | "r" | "s" | "t" | "v" | "x" | "z"

%rule initial-cluster
  initial-pair | long-initial-run

%rule n-affricate
  "n" "t" "c" | "n" "t" "s" | "n" "d" "j" | "n" "d" "z"

%rule consonants
  consonant | consonants consonant

%rule has-n-affricate
  [consonants] n-affricate [consonants]
```

<details><summary>Railroad diagrams of the 24 rules from <code>consonant</code> to <code>has-n-affricate</code></summary>
<p><img src="../../docs/diagrams/words/shapes/consonant.svg" alt="Railroad diagram of the rule consonant"></p>
<p><img src="../../docs/diagrams/words/shapes/initial-pair.svg" alt="Railroad diagram of the rule initial-pair"></p>
<p><img src="../../docs/diagrams/words/shapes/consonant-pair.svg" alt="Railroad diagram of the rule consonant-pair"></p>
<p><img src="../../docs/diagrams/words/shapes/after-b.svg" alt="Railroad diagram of the rule after-b"></p>
<p><img src="../../docs/diagrams/words/shapes/after-d.svg" alt="Railroad diagram of the rule after-d"></p>
<p><img src="../../docs/diagrams/words/shapes/after-g.svg" alt="Railroad diagram of the rule after-g"></p>
<p><img src="../../docs/diagrams/words/shapes/after-v.svg" alt="Railroad diagram of the rule after-v"></p>
<p><img src="../../docs/diagrams/words/shapes/after-j.svg" alt="Railroad diagram of the rule after-j"></p>
<p><img src="../../docs/diagrams/words/shapes/after-z.svg" alt="Railroad diagram of the rule after-z"></p>
<p><img src="../../docs/diagrams/words/shapes/after-c.svg" alt="Railroad diagram of the rule after-c"></p>
<p><img src="../../docs/diagrams/words/shapes/after-s.svg" alt="Railroad diagram of the rule after-s"></p>
<p><img src="../../docs/diagrams/words/shapes/after-x.svg" alt="Railroad diagram of the rule after-x"></p>
<p><img src="../../docs/diagrams/words/shapes/after-k.svg" alt="Railroad diagram of the rule after-k"></p>
<p><img src="../../docs/diagrams/words/shapes/after-f.svg" alt="Railroad diagram of the rule after-f"></p>
<p><img src="../../docs/diagrams/words/shapes/after-p.svg" alt="Railroad diagram of the rule after-p"></p>
<p><img src="../../docs/diagrams/words/shapes/after-t.svg" alt="Railroad diagram of the rule after-t"></p>
<p><img src="../../docs/diagrams/words/shapes/after-l.svg" alt="Railroad diagram of the rule after-l"></p>
<p><img src="../../docs/diagrams/words/shapes/after-r.svg" alt="Railroad diagram of the rule after-r"></p>
<p><img src="../../docs/diagrams/words/shapes/after-m.svg" alt="Railroad diagram of the rule after-m"></p>
<p><img src="../../docs/diagrams/words/shapes/after-n.svg" alt="Railroad diagram of the rule after-n"></p>
<p><img src="../../docs/diagrams/words/shapes/initial-cluster.svg" alt="Railroad diagram of the rule initial-cluster"></p>
<p><img src="../../docs/diagrams/words/shapes/n-affricate.svg" alt="Railroad diagram of the rule n-affricate"></p>
<p><img src="../../docs/diagrams/words/shapes/consonants.svg" alt="Railroad diagram of the rule consonants"></p>
<p><img src="../../docs/diagrams/words/shapes/has-n-affricate.svg" alt="Railroad diagram of the rule has-n-affricate"></p>
</details>



A permissible run is a run of consonants whose adjacent pairs are all permissible. A name can have such a run anywhere (CLL[^cll-s3-7]). A borrowing can have one in its middle, with no `n` triple in it (CLL[^cll-s4-7]). The borrowing rules in [cll.md](cll.md#borrowings) use `has-n-affricate` to exclude those triples.

`permissible-run` reads one consonant, or extends a permissible run by one consonant. The condition starts a `consonant-pair` lookahead at the preceding run's last token, so each extension tests its new adjacent pair. So `.tlaiv.` and `.ekstcat.` are names, but `.djeimz.` and `.bobb.` are not.

```jbogenbau
%rule permissible-run
  consonant | $r:permissible-run consonant
%conditions
  $r.last-token.onward.begins(consonant-pair)
```

<details><summary>Railroad diagram of <code>permissible-run</code></summary>
<p><img src="../../docs/diagrams/words/shapes/permissible-run.svg" alt="Railroad diagram of the rule permissible-run"></p>
</details>



`long-initial-run` extends an `initial-cluster` by one consonant. `initial-cluster` starts with an `initial-pair`, so the result has at least three consonants. The condition starts an `initial-pair` lookahead at the cluster's last token. Because `initial-cluster` also reads `long-initial-run`, repeated extensions form longer clusters.

```jbogenbau
%rule long-initial-run
  $r:initial-cluster consonant
%conditions
  $r.last-token.onward.begins(initial-pair)
```

<details><summary>Railroad diagram of <code>long-initial-run</code></summary>
<p><img src="../../docs/diagrams/words/shapes/long-initial-run.svg" alt="Railroad diagram of the rule long-initial-run"></p>
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
<p><img src="../../docs/diagrams/words/shapes/vowel.svg" alt="Railroad diagram of the rule vowel"></p>
<p><img src="../../docs/diagrams/words/shapes/capital-vowel.svg" alt="Railroad diagram of the rule capital-vowel"></p>
<p><img src="../../docs/diagrams/words/shapes/capital-letter.svg" alt="Railroad diagram of the rule capital-letter"></p>
<p><img src="../../docs/diagrams/words/shapes/i-or-u.svg" alt="Railroad diagram of the rule i-or-u"></p>
<p><img src="../../docs/diagrams/words/shapes/e-or-o.svg" alt="Railroad diagram of the rule e-or-o"></p>
<p><img src="../../docs/diagrams/words/shapes/falling-diphthong.svg" alt="Railroad diagram of the rule falling-diphthong"></p>
<p><img src="../../docs/diagrams/words/shapes/rising-diphthong.svg" alt="Railroad diagram of the rule rising-diphthong"></p>
<p><img src="../../docs/diagrams/words/shapes/y-diphthong.svg" alt="Railroad diagram of the rule y-diphthong"></p>
<p><img src="../../docs/diagrams/words/shapes/r-letter.svg" alt="Railroad diagram of the rule r-letter"></p>
<p><img src="../../docs/diagrams/words/shapes/any-letters.svg" alt="Railroad diagram of the rule any-letters"></p>
<p><img src="../../docs/diagrams/words/shapes/any-letter.svg" alt="Railroad diagram of the rule any-letter"></p>
<p><img src="../../docs/diagrams/words/shapes/stress-mark.svg" alt="Railroad diagram of the rule stress-mark"></p>
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

So a brivla with marked stress has `S2`, and one without any capital vowel has `S0` and at least `N2`. [cll.md](cll.md) applies these tests.

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
<p><img src="../../docs/diagrams/words/shapes/brivla-scan.svg" alt="Railroad diagram of the rule brivla-scan"></p>
<p><img src="../../docs/diagrams/words/shapes/brivla-item.svg" alt="Railroad diagram of the rule brivla-item"></p>
<p><img src="../../docs/diagrams/words/shapes/brivla-diphthong.svg" alt="Railroad diagram of the rule brivla-diphthong"></p>
</details>



A cmavo or a name can have capital vowels on any of its syllables, `Y` included (CLL[^cll-s3-9] lets their stress fall anywhere). A name with no capital vowel is stressed on its penultimate counted syllable if it has two or more. It is stressed on its only counted syllable if it has one, and nowhere if it has none.

`name-scan` reads a name as `brivla-scan` reads a brivla, with the diphthongs a name allows. A `y` is a nucleus of its own, and never the first letter of a diphthong. `name-diphthong` also admits `iy` and `uy`. Its tags are:

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
  Single-End ⊈ $s.tags ∨ ¬$s.last-token.onward.begins(name-diphthong)

%rule name-item
  | consonant | "'" | Syllable-Break
  | $v:vowel :: Nucleus ∪ Counted ∪ Single-End ∪ ($v.matches(capital-vowel) ⟹ Marked)
  | $y:"y" :: Nucleus ∪ ($y.matches(stress-mark) ⟹ Marked)
  | $d:brivla-diphthong :: Nucleus ∪ Counted ∪ ($d.matches(stress-mark) ⟹ Marked)
  | $e:y-diphthong :: Nucleus ∪ ($e.matches(stress-mark) ⟹ Marked)

%rule name-vowel
  vowel | "y"

%rule name-diphthong
  brivla-diphthong | y-diphthong
```

<details><summary>Railroad diagrams of <code>name-scan</code>, <code>name-item</code>, <code>name-vowel</code> and <code>name-diphthong</code></summary>
<p><img src="../../docs/diagrams/words/shapes/name-scan.svg" alt="Railroad diagram of the rule name-scan"></p>
<p><img src="../../docs/diagrams/words/shapes/name-item.svg" alt="Railroad diagram of the rule name-item"></p>
<p><img src="../../docs/diagrams/words/shapes/name-vowel.svg" alt="Railroad diagram of the rule name-vowel"></p>
<p><img src="../../docs/diagrams/words/shapes/name-diphthong.svg" alt="Railroad diagram of the rule name-diphthong"></p>
</details>



[^cll-s3-6]: [CLL 1.1, section 3.6](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-clusters.html).

[^cll-s3-7]: [CLL 1.1, section 3.7](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-initial-pairs.html).

[^cll-s4-7]: [CLL 1.1, section 4.7](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-fuhivla.html).

[^cll-s3-4]: [CLL 1.1, section 3.4](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-diphthongs.html).

[^cll-s3-9]: [CLL 1.1, section 3.9](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-stress.html).

[^cll-s3-5]: [CLL 1.1, section 3.5](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-vowel-pairs.html).

[^cll-s4-2]: [CLL 1.1, section 4.2](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-cmavo.html).
