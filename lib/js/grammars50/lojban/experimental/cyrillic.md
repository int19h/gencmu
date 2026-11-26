# Cyrillic conventions of the experimental pipeline

This document adds to [../common/cyrillic.md](../common/cyrillic.md) and [../cll/cyrillic.md](../cll/cyrillic.md) the Cyrillic conventions of the [experimental](pipeline.md) pipeline. Only that pipeline reads it. It stands right after [../cll/cyrillic.md](../cll/cyrillic.md), and it restates the letter rules of both documents. [The notation document](../../../docs/notation.md) explains the notation.

A Cyrillic letter takes any combining marks after it, as a Latin letter does in [latin.md](latin.md). `letter-marks` of that document reads them. An acute or grave accent on a full vowel marks stress, as in [../common/cyrillic.md](../common/cyrillic.md). A breve on `и` or `у` makes the glide, as `й` and `ў` do. The stage ignores every other mark.

So `ё` reads as `е` and `ї` as `і`, because a dieresis means nothing here. The Cyrillic orthography already puts an apostrophe between two full vowels, so the Latin meaning of the dieresis has no job. The stage ignores marks on consonants, so `ќ` is `к`. The stage ignores a breve on another vowel, so `ӑ` is `а`. The stage ignores accents on glides, as it does on Latin glide letters.

The Cyrillic glides carry no `Glide` tag, and the word forms find them by position, as they do in `lojban/bpfk`. These letters belong to the base Cyrillic orthographies. This layer adds marks without changing their positional readings.

Latin `ɩ`, `q` and `w` are dedicated glide letters. Outside zbalermorna shorthand, this pipeline reads inherited Latin `ĭ` and `ŭ` only as glides, while the base conventions read them by position ([word forms](morphology.md#glide-letters)).

`cyrillic-vowel` reads every Cyrillic vowel letter with its marks. Its tags work as those of `latin-vowel`. A capital full vowel without an accent has a stressed and a folded reading. An accented capital has one reading, stressed and `Accented`, which an all-capital run keeps, as "Capital runs" in [../common/latin.md](../common/latin.md) says. The three restated vowel rules take the readings that fit them.

The `Vowel` tag marks the letters of `a`, `e`, `i`, `o` and `u`, full vowels and glides, and not `y`. The full vowels and the `y` letters carry `Syllabic`, and the glides do not. So `cyrillic-full-vowel` holds the full vowels of `cyrillic-vowel`, and `cyrillic-glide` holds the glides and carries `Vowel` on its header. The `y` forms stay in `cyrillic-vowel`.

The restated vowel rules read `cyrillic-vowel` instead of the inherited vowel and glide readers. Nothing reads `cyrillic-plain-full-vowel`, `cyrillic-stressed-full-vowel`, `cyrillic-folded-full-vowel`, `cyrillic-plain-glide` or `cyrillic-folded-glide` in this pipeline.

Joined vowels use the same public tags as isolated vowels. Of the public tags of the stage, a Cyrillic vowel token has only `Stressed`, `Syllabic` and `Vowel`. The other tags stay inside the phoneme stage.

```jbogenbau
%redefine-rule cyrillic-consonant → {Consonant}
  | ("б" | "Б") [letter-marks] → {image: value: "b"}
  | ("ш" | "Ш" | "щ" | "Щ") [letter-marks] → {image: value: "c"}
  | ("д" | "Д") [letter-marks] → {image: value: "d"}
  | ("ф" | "Ф") [letter-marks] → {image: value: "f"}
  | ("г" | "Г" | "ґ" | "Ґ") [letter-marks] → {image: value: "g"}
  | ("ж" | "Ж") [letter-marks] → {image: value: "j"}
  | ("к" | "К") [letter-marks] → {image: value: "k"}
  | ("л" | "Л") [letter-marks] → {image: value: "l"}
  | ("м" | "М") [letter-marks] → {image: value: "m"}
  | ("н" | "Н") [letter-marks] → {image: value: "n"}
  | ("п" | "П") [letter-marks] → {image: value: "p"}
  | ("р" | "Р") [letter-marks] → {image: value: "r"}
  | ("с" | "С") [letter-marks] → {image: value: "s"}
  | ("т" | "Т") [letter-marks] → {image: value: "t"}
  | ("в" | "В") [letter-marks] → {image: value: "v"}
  | ("х" | "Х") [letter-marks] → {image: value: "x"}
  | ("з" | "З") [letter-marks] → {image: value: "z"}
%emit

%redefine-rule cyrillic-apostrophe
  ("һ" | "Һ") [letter-marks] → {image: value: "'"}
%emit

%rule cyrillic-full-vowel → {Syllabic, Vowel}
  | "а" [letter-marks<¬Accent>] → {image: value: "a"}
  | "а" letter-marks<Accent> → {Stressed, value: "a", image: "A"}
  | "А" letter-marks<Accent> → {Stressed, Accented, value: "a", image: "A"}
  | "А" [letter-marks<¬Accent>] → {Stressed, Capital, value: "a", image: "A"}
  | "А" [letter-marks<¬Accent>] → {Folded, Capital, image: value: "a"}
  | ("е" | "э" | "є") [letter-marks<¬Accent>] → {image: value: "e"}
  | ("е" | "э" | "є") letter-marks<Accent> → {Stressed, value: "e", image: "E"}
  | ("Е" | "Э" | "Є") letter-marks<Accent> → {Stressed, Accented, value: "e", image: "E"}
  | ("Е" | "Э" | "Є") [letter-marks<¬Accent>] → {Stressed, Capital, value: "e", image: "E"}
  | ("Е" | "Э" | "Є") [letter-marks<¬Accent>] → {Folded, Capital, image: value: "e"}
  | ("и" [letter-marks<¬Accent ¬Breve>] | "і" [letter-marks<¬Accent>]) → {image: value: "i"}
  | ("и" letter-marks<Accent ¬Breve> | "і" letter-marks<Accent>)
      → {Stressed, value: "i", image: "I"}
  | ("И" letter-marks<Accent ¬Breve> | "І" letter-marks<Accent>)
      → {Stressed, Accented, value: "i", image: "I"}
  | ("И" [letter-marks<¬Accent ¬Breve>] | "І" [letter-marks<¬Accent>])
      → {Stressed, Capital, value: "i", image: "I"}
  | ("И" [letter-marks<¬Accent ¬Breve>] | "І" [letter-marks<¬Accent>])
      → {Folded, Capital, image: value: "i"}
  | "о" [letter-marks<¬Accent>] → {image: value: "o"}
  | "о" letter-marks<Accent> → {Stressed, value: "o", image: "O"}
  | "О" letter-marks<Accent> → {Stressed, Accented, value: "o", image: "O"}
  | "О" [letter-marks<¬Accent>] → {Stressed, Capital, value: "o", image: "O"}
  | "О" [letter-marks<¬Accent>] → {Folded, Capital, image: value: "o"}
  | "у" [letter-marks<¬Accent ¬Breve>] → {image: value: "u"}
  | "у" letter-marks<Accent ¬Breve> → {Stressed, value: "u", image: "U"}
  | "У" letter-marks<Accent ¬Breve> → {Stressed, Accented, value: "u", image: "U"}
  | "У" [letter-marks<¬Accent ¬Breve>] → {Stressed, Capital, value: "u", image: "U"}
  | "У" [letter-marks<¬Accent ¬Breve>] → {Folded, Capital, image: value: "u"}

%rule cyrillic-glide → {Vowel}
  | "и" letter-marks<Breve> → {image: value: "i"}
  | "И" letter-marks<Breve> → {Capital, image: value: "i"}
  | "у" letter-marks<Breve> → {image: value: "u"}
  | "У" letter-marks<Breve> → {Capital, image: value: "u"}
  | "ј" [letter-marks] → {image: value: "i"}
  | "Ј" [letter-marks] → {Capital, image: value: "i"}

%rule cyrillic-vowel
  | cyrillic-full-vowel
  | ("ъ" | "ы" | "ә") [letter-marks<¬Accent>] → {Syllabic, image: value: "y"}
  | ("ъ" | "ы" | "ә") letter-marks<Accent> → {Stressed, Syllabic, value: "y", image: "Y"}
  | ("Ъ" | "Ы" | "Ә") letter-marks<Accent>
      → {Stressed, Syllabic, Accented, value: "y", image: "Y"}
  | ("Ъ" | "Ы" | "Ә") [letter-marks<¬Accent>]
      → {Stressed, Syllabic, Capital, value: "y", image: "Y"}
  | ("Ъ" | "Ы" | "Ә") [letter-marks<¬Accent>] → {Folded, Syllabic, Capital, image: value: "y"}
  | cyrillic-glide
%emit

%redefine-rule cyrillic-plain-vowel
  cyrillic-vowel<¬Stressed ¬Folded>

%redefine-rule cyrillic-stressed-vowel
  cyrillic-vowel<Stressed ¬Folded>

%redefine-rule cyrillic-folded-vowel
  cyrillic-vowel<Capital ¬Stressed>
  | cyrillic-vowel<Accented>
```

<details><summary>Railroad diagrams of the 8 rules from <code>cyrillic-consonant</code> to <code>cyrillic-folded-vowel</code></summary>
<p><img src="../../../docs/diagrams/50/lojban/experimental/cyrillic/cyrillic-consonant.svg" alt="Railroad diagram of the rule cyrillic-consonant"></p>
<p><img src="../../../docs/diagrams/50/lojban/experimental/cyrillic/cyrillic-apostrophe.svg" alt="Railroad diagram of the rule cyrillic-apostrophe"></p>
<p><img src="../../../docs/diagrams/50/lojban/experimental/cyrillic/cyrillic-full-vowel.svg" alt="Railroad diagram of the rule cyrillic-full-vowel"></p>
<p><img src="../../../docs/diagrams/50/lojban/experimental/cyrillic/cyrillic-glide.svg" alt="Railroad diagram of the rule cyrillic-glide"></p>
<p><img src="../../../docs/diagrams/50/lojban/experimental/cyrillic/cyrillic-vowel.svg" alt="Railroad diagram of the rule cyrillic-vowel"></p>
<p><img src="../../../docs/diagrams/50/lojban/experimental/cyrillic/cyrillic-plain-vowel.svg" alt="Railroad diagram of the rule cyrillic-plain-vowel"></p>
<p><img src="../../../docs/diagrams/50/lojban/experimental/cyrillic/cyrillic-stressed-vowel.svg" alt="Railroad diagram of the rule cyrillic-stressed-vowel"></p>
<p><img src="../../../docs/diagrams/50/lojban/experimental/cyrillic/cyrillic-folded-vowel.svg" alt="Railroad diagram of the rule cyrillic-folded-vowel"></p>
</details>

The Cyrillic of CLL, in [../cll/cyrillic.md](../cll/cyrillic.md), ignores unknown marks too. It writes a diphthong as two plain vowels, as the Latin orthography does, so it has no glide letters. An accent on a vowel marks stress, as on a Latin vowel. It ignores every other mark, the breve and the dieresis included. So `май` is `mai`, `мёи` is `mei` and `ма́и` is `mAi`. A capital vowel still marks stress, because this orthography has no all-capital runs.

The restated CLL rules leave two inherited template instances without callers: `stressed-full-vowel-with("А", "Е", "И", "О", "У")` and `stressed-vowel-with("А", "Е", "И", "О", "У", "Ъ")`. This layer supplies letter readers that also accept combining marks.

The `Vowel` tag marks the five full vowels and not `y`, so the restated `cll-cyrillic-plain-full-vowel` holds them and carries `Vowel` on its header. The hard sign stays in `cll-cyrillic-plain-vowel`.

```jbogenbau
%redefine-rule cll-cyrillic-consonant → {Consonant}
  | ("б" | "Б") [letter-marks] → {image: value: "b"}
  | ("в" | "В") [letter-marks] → {image: value: "v"}
  | ("г" | "Г") [letter-marks] → {image: value: "g"}
  | ("д" | "Д") [letter-marks] → {image: value: "d"}
  | ("ж" | "Ж") [letter-marks] → {image: value: "j"}
  | ("з" | "З") [letter-marks] → {image: value: "z"}
  | ("к" | "К") [letter-marks] → {image: value: "k"}
  | ("л" | "Л") [letter-marks] → {image: value: "l"}
  | ("м" | "М") [letter-marks] → {image: value: "m"}
  | ("н" | "Н") [letter-marks] → {image: value: "n"}
  | ("п" | "П") [letter-marks] → {image: value: "p"}
  | ("р" | "Р") [letter-marks] → {image: value: "r"}
  | ("с" | "С") [letter-marks] → {image: value: "s"}
  | ("т" | "Т") [letter-marks] → {image: value: "t"}
  | ("ф" | "Ф") [letter-marks] → {image: value: "f"}
  | ("х" | "Х") [letter-marks] → {image: value: "x"}
  | ("ш" | "Ш") [letter-marks] → {image: value: "c"}
%emit

%redefine-rule cll-cyrillic-plain-full-vowel → {Vowel}
  | "а" [letter-marks<¬Accent>] → {image: value: "a"}
  | "е" [letter-marks<¬Accent>] → {image: value: "e"}
  | "и" [letter-marks<¬Accent>] → {image: value: "i"}
  | "о" [letter-marks<¬Accent>] → {image: value: "o"}
  | "у" [letter-marks<¬Accent>] → {image: value: "u"}

%redefine-rule cll-cyrillic-plain-vowel
  | cll-cyrillic-plain-full-vowel
  | "ъ" [letter-marks<¬Accent>] → {image: value: "y"}
%emit

%redefine-rule cll-cyrillic-stressed-vowel = stressed-vowel-with(
  ("а" letter-marks<Accent> | "А" [letter-marks]),
  ("е" letter-marks<Accent> | "Е" [letter-marks]),
  ("и" letter-marks<Accent> | "И" [letter-marks]),
  ("о" letter-marks<Accent> | "О" [letter-marks]),
  ("у" letter-marks<Accent> | "У" [letter-marks]),
  ("ъ" letter-marks<Accent> | "Ъ" [letter-marks]))
```

<details><summary>Railroad diagrams of the 4 rules from <code>cll-cyrillic-consonant</code> to <code>cll-cyrillic-stressed-vowel</code></summary>
<p><img src="../../../docs/diagrams/50/lojban/experimental/cyrillic/cll-cyrillic-consonant.svg" alt="Railroad diagram of the rule cll-cyrillic-consonant"></p>
<p><img src="../../../docs/diagrams/50/lojban/experimental/cyrillic/cll-cyrillic-plain-full-vowel.svg" alt="Railroad diagram of the rule cll-cyrillic-plain-full-vowel"></p>
<p><img src="../../../docs/diagrams/50/lojban/experimental/cyrillic/cll-cyrillic-plain-vowel.svg" alt="Railroad diagram of the rule cll-cyrillic-plain-vowel"></p>
<p><img src="../../../docs/diagrams/50/lojban/experimental/cyrillic/cll-cyrillic-stressed-vowel.svg" alt="Railroad diagram of the rule cll-cyrillic-stressed-vowel"></p>
</details>

## Differences from camxes-exp

camxes-exp reads no Cyrillic orthography. These Cyrillic conventions belong to gencmu.

The experimental pipeline inherits the genuine-punctuation boundary from [latin.md](latin.md#genuine-punctuation). Non-ASCII numbers remain foreign because numeric characters do not mark word boundaries. Thus `ми½клама` forms one foreign run here, while `lojban/bpfk` reads two words.

The pipeline also inherits silent marks for length or visual separation without new phonemes or word boundaries. Thus `кла~ма` reads as `klama` here. BPFK treats `~` as punctuation and separates the two runs.

Joined vowels retain the apostrophe insertion of [../common/cyrillic.md](../common/cyrillic.md). Their tokens hand on only the public vowel tags, as isolated vowels do.

## Differences from the format 49 grammar

The format 49 copy of this document is `grammars/lojban/experimental/cyrillic.md`. Both copies hand on the same phoneme tokens, with the same values, images and tags.

The format 49 copy restates `joined-vowel-with` to keep only the public vowel tags on a joined vowel. Here the shared rule of [../cll/latin.md](../cll/latin.md) hands on the vowel's own token, and the stage's interface cuts its tags. So this document does not restate it.
