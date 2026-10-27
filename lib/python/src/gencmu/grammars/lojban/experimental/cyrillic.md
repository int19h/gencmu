# Cyrillic conventions of the experimental pipeline

This document adds to [../common/cyrillic.md](../common/cyrillic.md) and [../cll/cyrillic.md](../cll/cyrillic.md) the Cyrillic conventions of the [experimental](pipeline.md) pipeline. Only that pipeline reads it. It stands right after [../cll/cyrillic.md](../cll/cyrillic.md), and it restates the letter rules of both documents. [The notation document](../../../docs/notation.md) explains the notation.

A Cyrillic letter takes any combining marks after it, as a Latin letter does in [latin.md](latin.md). `letter-marks` of that document reads them. An acute or grave accent on a full vowel marks stress, as in cyrillic.md. A breve on `и` or `у` makes the glide, as `й` and `ў` do. Every other mark is ignored.

So `ё` reads as `е` and `ї` as `і`, because a dieresis means nothing here. The Cyrillic orthography already puts an apostrophe between two full vowels, so the Latin meaning of the dieresis has no job. A mark on a consonant is ignored, so `ќ` is `к`. A breve on another vowel is ignored, so `ӑ` is `а`. An accent on a glide is ignored, as on a Latin glide letter.

The Cyrillic glides carry no `Glide` tag, and the word forms find them by position, as they do in bpfk.

`cyrillic-vowel` reads every Cyrillic vowel letter with its marks. Its tags work as those of `latin-vowel`. A capital full vowel without an accent has a stressed and a folded reading. An accented capital has one reading, stressed and `Accented`, which an all-capital run keeps, as "Capital runs" in [../common/latin.md](../common/latin.md) says. The three restated vowel rules take the readings that fit them.

Joined vowels use the same public tags as isolated vowels. The emission filter keeps only `Stressed` and `Syllabic`. Bookkeeping tags stay inside the phoneme stage.

```jbogenbau
%redefine-rule cyrillic-consonant :: ∅
  | ("б" | "Б") [letter-marks] := "b"
  | ("ш" | "Ш" | "щ" | "Щ") [letter-marks] := "c"
  | ("д" | "Д") [letter-marks] := "d"
  | ("ф" | "Ф") [letter-marks] := "f"
  | ("г" | "Г" | "ґ" | "Ґ") [letter-marks] := "g"
  | ("ж" | "Ж") [letter-marks] := "j"
  | ("к" | "К") [letter-marks] := "k"
  | ("л" | "Л") [letter-marks] := "l"
  | ("м" | "М") [letter-marks] := "m"
  | ("н" | "Н") [letter-marks] := "n"
  | ("п" | "П") [letter-marks] := "p"
  | ("р" | "Р") [letter-marks] := "r"
  | ("с" | "С") [letter-marks] := "s"
  | ("т" | "Т") [letter-marks] := "t"
  | ("в" | "В") [letter-marks] := "v"
  | ("х" | "Х") [letter-marks] := "x"
  | ("з" | "З") [letter-marks] := "z"
%emits
  $

%redefine-rule cyrillic-apostrophe
  ("һ" | "Һ") [letter-marks]
%emits
  $ :: ∅ := "'"

%rule cyrillic-vowel
  | "а" [letter-marks<¬Accent>] :: Syllabic := "a"
  | "а" letter-marks<Accent> :: Stressed Syllabic := "a" :- "A"
  | "А" letter-marks<Accent> :: Stressed Syllabic Accented := "a" :- "A"
  | "А" [letter-marks<¬Accent>] :: Stressed Syllabic Capital := "a" :- "A"
  | "А" [letter-marks<¬Accent>] :: Folded Syllabic Capital := "a"
  | ("е" | "э" | "є") [letter-marks<¬Accent>] :: Syllabic := "e"
  | ("е" | "э" | "є") letter-marks<Accent> :: Stressed Syllabic := "e" :- "E"
  | ("Е" | "Э" | "Є") letter-marks<Accent> :: Stressed Syllabic Accented := "e" :- "E"
  | ("Е" | "Э" | "Є") [letter-marks<¬Accent>] :: Stressed Syllabic Capital := "e" :- "E"
  | ("Е" | "Э" | "Є") [letter-marks<¬Accent>] :: Folded Syllabic Capital := "e"
  | "и" [letter-marks<¬Accent ¬Breve>] :: Syllabic := "i"
  | "і" [letter-marks<¬Accent>] :: Syllabic := "i"
  | "и" letter-marks<Accent ¬Breve> :: Stressed Syllabic := "i" :- "I"
  | "і" letter-marks<Accent> :: Stressed Syllabic := "i" :- "I"
  | "И" letter-marks<Accent ¬Breve> :: Stressed Syllabic Accented := "i" :- "I"
  | "І" letter-marks<Accent> :: Stressed Syllabic Accented := "i" :- "I"
  | "И" [letter-marks<¬Accent ¬Breve>] :: Stressed Syllabic Capital := "i" :- "I"
  | "І" [letter-marks<¬Accent>] :: Stressed Syllabic Capital := "i" :- "I"
  | "И" [letter-marks<¬Accent ¬Breve>] :: Folded Syllabic Capital := "i"
  | "І" [letter-marks<¬Accent>] :: Folded Syllabic Capital := "i"
  | "о" [letter-marks<¬Accent>] :: Syllabic := "o"
  | "о" letter-marks<Accent> :: Stressed Syllabic := "o" :- "O"
  | "О" letter-marks<Accent> :: Stressed Syllabic Accented := "o" :- "O"
  | "О" [letter-marks<¬Accent>] :: Stressed Syllabic Capital := "o" :- "O"
  | "О" [letter-marks<¬Accent>] :: Folded Syllabic Capital := "o"
  | "у" [letter-marks<¬Accent ¬Breve>] :: Syllabic := "u"
  | "у" letter-marks<Accent ¬Breve> :: Stressed Syllabic := "u" :- "U"
  | "У" letter-marks<Accent ¬Breve> :: Stressed Syllabic Accented := "u" :- "U"
  | "У" [letter-marks<¬Accent ¬Breve>] :: Stressed Syllabic Capital := "u" :- "U"
  | "У" [letter-marks<¬Accent ¬Breve>] :: Folded Syllabic Capital := "u"
  | ("ъ" | "ы" | "ә") [letter-marks<¬Accent>] :: Syllabic := "y"
  | ("ъ" | "ы" | "ә") letter-marks<Accent> :: Stressed Syllabic := "y" :- "Y"
  | ("Ъ" | "Ы" | "Ә") letter-marks<Accent> :: Stressed Syllabic Accented := "y" :- "Y"
  | ("Ъ" | "Ы" | "Ә") [letter-marks<¬Accent>] :: Stressed Syllabic Capital := "y" :- "Y"
  | ("Ъ" | "Ы" | "Ә") [letter-marks<¬Accent>] :: Folded Syllabic Capital := "y"
  | "и" letter-marks<Breve> := "i"
  | "И" letter-marks<Breve> :: Capital := "i"
  | "у" letter-marks<Breve> := "u"
  | "У" letter-marks<Breve> :: Capital := "u"
  | "ј" [letter-marks] := "i"
  | "Ј" [letter-marks] :: Capital := "i"
%emits
  $ :: $.tags ∩ (Stressed ∪ Syllabic)

%redefine-rule cyrillic-plain-vowel
  cyrillic-vowel<¬Stressed ¬Folded>

%redefine-rule cyrillic-stressed-vowel
  cyrillic-vowel<Stressed ¬Folded>

%redefine-rule cyrillic-folded-vowel
  cyrillic-vowel<Capital ¬Stressed> | cyrillic-vowel<Accented>

%redefine-rule joined-vowel-with(@V)
  $v:@V :: $v.tags
%emits
  ε :: ∅ := "'", $v :: $v.tags ∩ (Stressed ∪ Syllabic)

```

<details><summary>Railroad diagrams of the 7 rules from <code>cyrillic-consonant</code> to <code>joined-vowel-with</code></summary>
<p><img src="../../../docs/diagrams/lojban/experimental/cyrillic/cyrillic-consonant.svg" alt="Railroad diagram of the rule cyrillic-consonant"></p>
<p><img src="../../../docs/diagrams/lojban/experimental/cyrillic/cyrillic-apostrophe.svg" alt="Railroad diagram of the rule cyrillic-apostrophe"></p>
<p><img src="../../../docs/diagrams/lojban/experimental/cyrillic/cyrillic-vowel.svg" alt="Railroad diagram of the rule cyrillic-vowel"></p>
<p><img src="../../../docs/diagrams/lojban/experimental/cyrillic/cyrillic-plain-vowel.svg" alt="Railroad diagram of the rule cyrillic-plain-vowel"></p>
<p><img src="../../../docs/diagrams/lojban/experimental/cyrillic/cyrillic-stressed-vowel.svg" alt="Railroad diagram of the rule cyrillic-stressed-vowel"></p>
<p><img src="../../../docs/diagrams/lojban/experimental/cyrillic/cyrillic-folded-vowel.svg" alt="Railroad diagram of the rule cyrillic-folded-vowel"></p>
<p><img src="../../../docs/diagrams/lojban/experimental/cyrillic/joined-vowel-with.svg" alt="Railroad diagram of the rule joined-vowel-with"></p>
</details>

The Cyrillic of CLL, in [../cll/cyrillic.md](../cll/cyrillic.md), ignores unknown marks too. It writes a diphthong as two plain vowels, as the Latin orthography does, so it has no glide letters. An accent on a vowel marks stress, as on a Latin vowel. Every other mark is ignored, the breve and the dieresis included. So `май` is `mai`, `мёи` is `mei` and `ма́и` is `mAi`. A capital vowel still marks stress, because this orthography has no all-capital runs.

```jbogenbau
%redefine-rule cll-cyrillic-consonant :: ∅
  | ("б" | "Б") [letter-marks] := "b"
  | ("в" | "В") [letter-marks] := "v"
  | ("г" | "Г") [letter-marks] := "g"
  | ("д" | "Д") [letter-marks] := "d"
  | ("ж" | "Ж") [letter-marks] := "j"
  | ("з" | "З") [letter-marks] := "z"
  | ("к" | "К") [letter-marks] := "k"
  | ("л" | "Л") [letter-marks] := "l"
  | ("м" | "М") [letter-marks] := "m"
  | ("н" | "Н") [letter-marks] := "n"
  | ("п" | "П") [letter-marks] := "p"
  | ("р" | "Р") [letter-marks] := "r"
  | ("с" | "С") [letter-marks] := "s"
  | ("т" | "Т") [letter-marks] := "t"
  | ("ф" | "Ф") [letter-marks] := "f"
  | ("х" | "Х") [letter-marks] := "x"
  | ("ш" | "Ш") [letter-marks] := "c"
%emits
  $

%redefine-rule cll-cyrillic-plain-vowel :: ∅
  | "а" [letter-marks<¬Accent>] := "a"
  | "е" [letter-marks<¬Accent>] := "e"
  | "и" [letter-marks<¬Accent>] := "i"
  | "о" [letter-marks<¬Accent>] := "o"
  | "у" [letter-marks<¬Accent>] := "u"
  | "ъ" [letter-marks<¬Accent>] := "y"
%emits
  $

%redefine-rule cll-cyrillic-stressed-vowel = stressed-vowel-with(
  ("а" letter-marks<Accent> | "А" [letter-marks]),
  ("е" letter-marks<Accent> | "Е" [letter-marks]),
  ("и" letter-marks<Accent> | "И" [letter-marks]),
  ("о" letter-marks<Accent> | "О" [letter-marks]),
  ("у" letter-marks<Accent> | "У" [letter-marks]),
  ("ъ" letter-marks<Accent> | "Ъ" [letter-marks]))
```

<details><summary>Railroad diagrams of the 3 rules from <code>cll-cyrillic-consonant</code> to <code>cll-cyrillic-stressed-vowel</code></summary>
<p><img src="../../../docs/diagrams/lojban/experimental/cyrillic/cll-cyrillic-consonant.svg" alt="Railroad diagram of the rule cll-cyrillic-consonant"></p>
<p><img src="../../../docs/diagrams/lojban/experimental/cyrillic/cll-cyrillic-plain-vowel.svg" alt="Railroad diagram of the rule cll-cyrillic-plain-vowel"></p>
<p><img src="../../../docs/diagrams/lojban/experimental/cyrillic/cll-cyrillic-stressed-vowel.svg" alt="Railroad diagram of the rule cll-cyrillic-stressed-vowel"></p>
</details>

## Differences from camxes-exp

camxes-exp reads no Cyrillic orthography. These Cyrillic conventions belong to gencmu.

The experimental pipeline inherits the genuine-punctuation boundary from [latin.md](latin.md#genuine-punctuation). Non-ASCII numbers remain foreign because numeric characters do not mark word boundaries. Thus `ми½клама` forms one foreign run here, while BPFK reads two words.

The pipeline also inherits silent marks for length or visual separation without new phonemes or word boundaries. Thus `кла~ма` reads as `klama` here. BPFK treats `~` as punctuation and separates the two runs.

Joined vowels retain the apostrophe insertion of cyrillic.md. Their emitted tokens expose only the public vowel tags, as isolated vowels do.
