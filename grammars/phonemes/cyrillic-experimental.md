# Cyrillic conventions of the experimental dialect

This document adds to [cyrillic.md](cyrillic.md) and [cyrillic-cll.md](cyrillic-cll.md) the Cyrillic conventions of the [experimental](../dialects/experimental.md) dialect. Only that dialect reads it. It stands right after cyrillic-cll.md, and it restates the letter rules of both documents. [The notation document](../../docs/notation.md) explains the notation.

A Cyrillic letter takes any combining marks after it, as a Latin letter does in [latin-experimental.md](latin-experimental.md). `letter-marks` of that document reads them. An acute or grave accent on a full vowel marks stress, as in cyrillic.md. A breve on `и` or `у` makes the glide, as `й` and `ў` do. Every other mark is ignored.

So `ё` reads as `е` and `ї` as `і`, because a dieresis means nothing here. The Cyrillic orthography already puts an apostrophe between two full vowels, so the Latin meaning of the dieresis has no job. A mark on a consonant is ignored, so `ќ` is `к`. A breve on another vowel is ignored, so `ӑ` is `а`. An accent on a glide is ignored, as on a Latin glide letter.

The Cyrillic glides carry no `Glide` tag, and the word forms find them by position, as they do in bpfk.

`cyrillic-vowel` reads every Cyrillic vowel letter with its marks. Its tags work as those of `latin-vowel`. A capital full vowel without an accent has a stressed and a folded reading. An accented capital has one reading, stressed and `Accented`, which an all-capital run keeps, as "Capital runs" in [latin.md](latin.md) says. The three restated vowel rules take the readings that fit them.

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
  | "а" letter-marks<Accent> :: Stressed Syllabic := "A"
  | "А" letter-marks<Accent> :: Stressed Syllabic Accented := "A"
  | "А" [letter-marks<¬Accent>] :: Stressed Syllabic Capital := "A"
  | "А" [letter-marks<¬Accent>] :: Folded Syllabic Capital := "a"
  | ("е" | "э" | "є") [letter-marks<¬Accent>] :: Syllabic := "e"
  | ("е" | "э" | "є") letter-marks<Accent> :: Stressed Syllabic := "E"
  | ("Е" | "Э" | "Є") letter-marks<Accent> :: Stressed Syllabic Accented := "E"
  | ("Е" | "Э" | "Є") [letter-marks<¬Accent>] :: Stressed Syllabic Capital := "E"
  | ("Е" | "Э" | "Є") [letter-marks<¬Accent>] :: Folded Syllabic Capital := "e"
  | "и" [letter-marks<¬Accent ¬Breve>] :: Syllabic := "i"
  | "і" [letter-marks<¬Accent>] :: Syllabic := "i"
  | "и" letter-marks<Accent ¬Breve> :: Stressed Syllabic := "I"
  | "і" letter-marks<Accent> :: Stressed Syllabic := "I"
  | "И" letter-marks<Accent ¬Breve> :: Stressed Syllabic Accented := "I"
  | "І" letter-marks<Accent> :: Stressed Syllabic Accented := "I"
  | "И" [letter-marks<¬Accent ¬Breve>] :: Stressed Syllabic Capital := "I"
  | "І" [letter-marks<¬Accent>] :: Stressed Syllabic Capital := "I"
  | "И" [letter-marks<¬Accent ¬Breve>] :: Folded Syllabic Capital := "i"
  | "І" [letter-marks<¬Accent>] :: Folded Syllabic Capital := "i"
  | "о" [letter-marks<¬Accent>] :: Syllabic := "o"
  | "о" letter-marks<Accent> :: Stressed Syllabic := "O"
  | "О" letter-marks<Accent> :: Stressed Syllabic Accented := "O"
  | "О" [letter-marks<¬Accent>] :: Stressed Syllabic Capital := "O"
  | "О" [letter-marks<¬Accent>] :: Folded Syllabic Capital := "o"
  | "у" [letter-marks<¬Accent ¬Breve>] :: Syllabic := "u"
  | "у" letter-marks<Accent ¬Breve> :: Stressed Syllabic := "U"
  | "У" letter-marks<Accent ¬Breve> :: Stressed Syllabic Accented := "U"
  | "У" [letter-marks<¬Accent ¬Breve>] :: Stressed Syllabic Capital := "U"
  | "У" [letter-marks<¬Accent ¬Breve>] :: Folded Syllabic Capital := "u"
  | ("ъ" | "ы" | "ә") [letter-marks<¬Accent>] :: Syllabic := "y"
  | ("ъ" | "ы" | "ә") letter-marks<Accent> :: Stressed Syllabic := "Y"
  | ("Ъ" | "Ы" | "Ә") letter-marks<Accent> :: Stressed Syllabic Accented := "Y"
  | ("Ъ" | "Ы" | "Ә") [letter-marks<¬Accent>] :: Stressed Syllabic Capital := "Y"
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
```

<details><summary>Railroad diagrams of the 6 rules from <code>cyrillic-consonant</code> to <code>cyrillic-folded-vowel</code></summary>
<p><img src="../../docs/diagrams/phonemes/cyrillic-experimental/cyrillic-consonant.svg" alt="Railroad diagram of the rule cyrillic-consonant"></p>
<p><img src="../../docs/diagrams/phonemes/cyrillic-experimental/cyrillic-apostrophe.svg" alt="Railroad diagram of the rule cyrillic-apostrophe"></p>
<p><img src="../../docs/diagrams/phonemes/cyrillic-experimental/cyrillic-vowel.svg" alt="Railroad diagram of the rule cyrillic-vowel"></p>
<p><img src="../../docs/diagrams/phonemes/cyrillic-experimental/cyrillic-plain-vowel.svg" alt="Railroad diagram of the rule cyrillic-plain-vowel"></p>
<p><img src="../../docs/diagrams/phonemes/cyrillic-experimental/cyrillic-stressed-vowel.svg" alt="Railroad diagram of the rule cyrillic-stressed-vowel"></p>
<p><img src="../../docs/diagrams/phonemes/cyrillic-experimental/cyrillic-folded-vowel.svg" alt="Railroad diagram of the rule cyrillic-folded-vowel"></p>
</details>

The Cyrillic of CLL, in [cyrillic-cll.md](cyrillic-cll.md), ignores unknown marks too. It writes a diphthong as two plain vowels, as the Latin orthography does, so it has no glide letters. An accent on a vowel marks stress, as on a Latin vowel. Every other mark is ignored, the breve and the dieresis included. So `май` is `mai`, `мёи` is `mei` and `ма́и` is `mAi`. A capital vowel still marks stress, because this orthography has no all-capital runs.

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

%redefine-rule cll-cyrillic-stressed-vowel :: Stressed
  | ("а" letter-marks<Accent> | "А" [letter-marks]) := "A"
  | ("е" letter-marks<Accent> | "Е" [letter-marks]) := "E"
  | ("и" letter-marks<Accent> | "И" [letter-marks]) := "I"
  | ("о" letter-marks<Accent> | "О" [letter-marks]) := "O"
  | ("у" letter-marks<Accent> | "У" [letter-marks]) := "U"
  | ("ъ" letter-marks<Accent> | "Ъ" [letter-marks]) := "Y"
%emits
  $
```

<details><summary>Railroad diagrams of the 3 rules from <code>cll-cyrillic-consonant</code> to <code>cll-cyrillic-stressed-vowel</code></summary>
<p><img src="../../docs/diagrams/phonemes/cyrillic-experimental/cll-cyrillic-consonant.svg" alt="Railroad diagram of the rule cll-cyrillic-consonant"></p>
<p><img src="../../docs/diagrams/phonemes/cyrillic-experimental/cll-cyrillic-plain-vowel.svg" alt="Railroad diagram of the rule cll-cyrillic-plain-vowel"></p>
<p><img src="../../docs/diagrams/phonemes/cyrillic-experimental/cll-cyrillic-stressed-vowel.svg" alt="Railroad diagram of the rule cll-cyrillic-stressed-vowel"></p>
</details>
