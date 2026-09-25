# The Zantufa lexicon

This document is the lexicon of the word stage in the [Zantufa](../dialects/zantufa.md) dialect: the cmavo in use beyond CLL, with their selma'o, together with the cmavo of CLL. It is the lexicon that the experimental dialect used before that dialect took its lexicon from camxes-exp, and the Zantufa dialect keeps it until it takes its own from the selma'o lists of Zantufa 1.9999. It is maintained by hand in this repository.

Each alternative spells one word in the phonemes of the word grammar, as [lexicon-cll.md](lexicon-cll.md) explains, and carries the word's classes. A class that CLL's dictionary also gives the word is a strong tag. A class that CLL's dictionary does not give it is weak, as `mo'o` is `?"KOhA"` beside its CLL MAI: the syntax stage may read the word that way, but a weak reading loses to a strong one at the first difference between two parses, so the word is read under its CLL class wherever that reading exists. A word CLL does not have carries all its classes as strong tags. A word is tagged `indicator` when its principal class is an attitudinal class, UI, CAI, Y, DAhO, FUhO or FUhE; `cu'ei`, whose principal class is BAI, is not, and stays a word of the syntax. As in the CLL lexicon, the dictionary's numbered subclasses are collapsed to the selma'o the syntax grammars name.

Five words are given only the classes that their meaning and their dictionary entry support:

- `mu'ei` is ROI: it turns a number into a tense, "in so many possible worlds", as `roi` turns one into "so many times", and ROI is the class its dictionary entry and the Zantufa grammar give it.
- `zu'ai` is KOhA: it is a pro-sumti, "each other", which the dictionary places in KOhA; it is not a modal.
- `no'oi` is NOhOI: it opens a relative clause that attaches to a selbri, with `ke'a` standing for that selbri, which is the class the dictionary gives it and the construct the experimental and Zantufa grammars read; it is not a sumti relative of NOI, nor an attitudinal.
- `ku'oi` is KUhOI: the elidable terminator of a `no'oi` clause.
- `su'ai` is PA: a number word, "approximately, to within the stated precision", as its dictionary entry defines it; it does not form an abstraction.

A word that is the only member of its selma'o carries that selma'o. Those that CLL has take their CLL class (`bi'e`, `bo`, `boi`, `cei`, `do'u`, `doi`, `fe'e`, `fe'u`, `fi'o`, `foi`, `ge'u`, `jai`, `ke`, `ke'e`, `kei`, `ki`, `ku'e`, `ku'o`, `lu'u`, `ma'o`, `me`, `me'u`, `mo'e`, `na'u`, `ni'e`, `nu'a`, `nu'i`, `nu'u`, `pe'o`, `ra'o`, `se'u`, `te'u`, `tei`, `tu'u`, `vu'o`, `zi'e`); the rest are the single-word terminals of the experimental syntax grammar, each named after its word, which each carries beside any broader class it also has: `bo'ei` BOhEI, `fi'au` FIhAU, `fi'oi` FIhOI, `xo'i` XOhI, `ma'oi` MAhOI, `zo'oi` ZOhOI, `la'oi` LAhOI, `go'oi` GOhOI, `ia'u` IhAU, `ku'au` KUhAU, `le'ai` LEhAI, `lo'ai` LOhAI, `me'oi` MEhOI, `ra'oi` RAhOI, `sa'ai` SAhAI, `ta'ai` TAhAI, `ze'oi` ZEhOI.

The notation is explained in [the notation document](../../docs/notation.md).

```jbogenbau
%rule lexicon
  | lexicon-a
  | lexicon-b
  | lexicon-c
  | lexicon-d
  | lexicon-e
  | lexicon-f
  | lexicon-g
  | lexicon-i
  | lexicon-j
  | lexicon-k
  | lexicon-l
  | lexicon-m
  | lexicon-n
  | lexicon-o
  | lexicon-p
  | lexicon-r
  | lexicon-s
  | lexicon-t
  | lexicon-u
  | lexicon-v
  | lexicon-x
  | lexicon-y
  | lexicon-z
```

```jbogenbau
%rule lexicon-a
  | any-a <"A">
  | any-a /'/ any-a <"UI" ∪ "indicator">
  | any-a /'/ any-a any-i <"UI" ∪ "indicator">
  | any-a /'/ any-e <"UI" ∪ "indicator">
  | any-a /'/ any-i <"UI" ∪ "indicator">
  | any-a /'/ any-o <"UI" ∪ "indicator">
  | any-a /'/ any-o any-i <"COI">
  | any-a /'/ any-u <"UI" ∪ "indicator">
  | any-a /'/ any-y <"BY">
  | any-a any-i <"UI" ∪ "indicator">
  | any-a any-i /'/ any-i <"UI" ∪ "indicator">
  | any-a any-u <"UI" ∪ "indicator">
  | any-a any-u /'/ any-a any-u <"UI" ∪ "indicator">
```

```jbogenbau
%rule lexicon-b
  | /b/ any-a <"PU">
  | /b/ any-a /'/ any-a <"UI" ∪ "indicator">
  | /b/ any-a /'/ any-a any-u <"CUhE">
  | /b/ any-a /'/ any-e <"BAhE">
  | /b/ any-a /'/ any-e any-i <"UI" ∪ "indicator">
  | /b/ any-a /'/ any-i <"BAI">
  | /b/ any-a /'/ any-o <"ZAhO">
  | /b/ any-a /'/ any-o any-i <"ROI">
  | /b/ any-a /'/ any-u <"UI" ∪ "indicator">
  | /b/ any-a any-i <"BAI">
  | /b/ any-a any-i /'/ any-a any-u <"BAI">
  | /b/ any-a any-u <"BAI">
  | /b/ any-e <"BE">
  | /b/ any-e /'/ any-a <"FAhA">
  | /b/ any-e /'/ any-a any-u <"BAI">
  | /b/ any-e /'/ any-e <"COI">
  | /b/ any-e /'/ any-e any-i <"BAI">
  | /b/ any-e /'/ any-i <"BAI">
  | /b/ any-e /'/ any-o <"BEhO">
  | /b/ any-e /'/ any-u <"UI" ∪ "indicator">
  | /b/ any-e any-i <"BEI">
  | /b/ any-i <"PA">
  | /b/ any-i /'/ any-a any-i <"CAhA">
  | /b/ any-i /'/ any-e <"BIhE">
  | /b/ any-i /'/ any-i <"BIhI">
  | /b/ any-i /'/ any-o <"BIhI">
  | /b/ any-i /'/ any-u <"UI" ∪ "indicator">
  | /b/ any-o <"BO">
  | /b/ any-o /'/ any-a any-i <"LI">
  | /b/ any-o /'/ any-e any-i <"BOhEI">
  | /b/ any-o any-i <"BOI">
  | /b/ any-o any-i /'/ any-a any-u <"MOhE">
  | /b/ any-u <"BU">
  | /b/ any-u /'/ any-a <"GOhA">
  | /b/ any-u /'/ any-e <"GOhA">
  | /b/ any-u /'/ any-e any-i <"UI" ∪ "indicator">
  | /b/ any-u /'/ any-i <"GOhA">
  | /b/ any-u /'/ any-o <"UI" ∪ "indicator">
  | /b/ any-u /'/ any-u <"FAhA">
  | /b/ any-u /'/ any-u /'/ any-e <"BAI">
  | /b/ any-y <"BY">
```

```jbogenbau
%rule lexicon-c
  | /c/ any-a <"PU">
  | /c/ any-a /'/ any-a <"CAhA">
  | /c/ any-a /'/ any-e <"UI" ∪ "indicator">
  | /c/ any-a /'/ any-i <"BAI">
  | /c/ any-a /'/ any-o <"ZAhO">
  | /c/ any-a /'/ any-u <"FAhA">
  | /c/ any-a any-i <"CAI" ∪ "indicator">
  | /c/ any-a any-u <"BAI">
  | /c/ any-a any-u /'/ any-e <"BY">
  | /c/ any-a any-u /'/ any-i <"BY">
  | /c/ any-e <"JOI">
  | /c/ any-e /'/ any-a <"LAU">
  | /c/ any-e /'/ any-a any-i <"ZOhU">
  | /c/ any-e /'/ any-e <"CEhE">
  | /c/ any-e /'/ any-i <"PA">
  | /c/ any-e /'/ any-o <"JOI">
  | /c/ any-e /'/ any-u <"KOhA">
  | /c/ any-e any-i <"CEI">
  | /c/ any-e any-i /'/ any-a <"MOI">
  | /c/ any-e any-i /'/ any-i <"GOhA">
  | /c/ any-i <"PA">
  | /c/ any-i /'/ any-e <"BAI">
  | /c/ any-i /'/ any-i <"PA">
  | /c/ any-i /'/ any-o <"BAI">
  | /c/ any-i /'/ any-u <"BAI">
  | /c/ any-o <"CO">
  | /c/ any-o /'/ any-a <"ZAhO">
  | /c/ any-o /'/ any-a /'/ any-a <"ZAhO">
  | /c/ any-o /'/ any-a any-u /'/ any-a <"ZAhO">
  | /c/ any-o /'/ any-e <"GOhA">
  | /c/ any-o /'/ any-i <"ZAhO">
  | /c/ any-o /'/ any-o <"COI">
  | /c/ any-o /'/ any-o any-i <"COI">
  | /c/ any-o /'/ any-u <"ZAhO">
  | /c/ any-o /'/ any-u /'/ any-a <"ZAhO">
  | /c/ any-o any-i <"COI">
  | /c/ any-u <"CU">
  | /c/ any-u /'/ any-a <"VUhU">
  | /c/ any-u /'/ any-e <"CUhE">
  | /c/ any-u /'/ any-e any-i <"BAI" ∪ "UI">
  | /c/ any-u /'/ any-i <"CAI" ∪ "indicator">
  | /c/ any-u /'/ any-o <"MOI">
  | /c/ any-u /'/ any-u <"BAI">
  | /c/ any-y <"BY">
```

```jbogenbau
%rule lexicon-d
  | /d/ any-a <"KOhA">
  | /d/ any-a /'/ any-a <"PA">
  | /d/ any-a /'/ any-e <"KOhA">
  | /d/ any-a /'/ any-e any-i <"DOI" ∪ "KOhA">
  | /d/ any-a /'/ any-i <"UI" ∪ "indicator">
  | /d/ any-a /'/ any-o <"DAhO" ∪ "indicator" ∪ ?"UI">
  | /d/ any-a /'/ any-o any-i <"DOI">
  | /d/ any-a /'/ any-u <"KOhA">
  | /d/ any-a any-i <"UI" ∪ "indicator">
  | /d/ any-a any-i /'/ any-a <"BY">
  | /d/ any-a any-i /'/ any-e <"BY">
  | /d/ any-a any-i /'/ any-i <"BY">
  | /d/ any-a any-i /'/ any-o <"DAhO" ∪ "BY">
  | /d/ any-a any-i /'/ any-u <"BY">
  | /d/ any-a any-i /'/ any-y <"BY">
  | /d/ any-a any-u <"PA">
  | /d/ any-a any-u /'/ any-a <"BAI">
  | /d/ any-a any-u /'/ any-e <"BY">
  | /d/ any-a any-u /'/ any-i <"BY">
  | /d/ any-a any-u /'/ any-o <"BAI">
  | /d/ any-a any-u /'/ any-u <"BAI">
  | /d/ any-e <"KOhA">
  | /d/ any-e /'/ any-a <"ZAhO">
  | /d/ any-e /'/ any-a /'/ any-u <"BAI">
  | /d/ any-e /'/ any-a any-i <"NAhE" ∪ "SE">
  | /d/ any-e /'/ any-e <"KOhA">
  | /d/ any-e /'/ any-e any-i <"ROI">
  | /d/ any-e /'/ any-i <"BAI">
  | /d/ any-e /'/ any-i /'/ any-a <"BAI">
  | /d/ any-e /'/ any-i /'/ any-e <"BAI">
  | /d/ any-e /'/ any-i /'/ any-i <"BAI">
  | /d/ any-e /'/ any-i /'/ any-o <"BAI">
  | /d/ any-e /'/ any-i /'/ any-u <"BAI">
  | /d/ any-e /'/ any-o <"VUhU">
  | /d/ any-e /'/ any-o /'/ any-a <"VUhU">
  | /d/ any-e /'/ any-u <"KOhA">
  | /d/ any-e any-i <"KOhA">
  | /d/ any-e any-i /'/ any-a <"KOhA">
  | /d/ any-i <"KOhA">
  | /d/ any-i /'/ any-a <"ZAhO">
  | /d/ any-i /'/ any-a any-i <"COI">
  | /d/ any-i /'/ any-e <"KOhA">
  | /d/ any-i /'/ any-e any-i <"KOhA">
  | /d/ any-i /'/ any-i <"TAhE">
  | /d/ any-i /'/ any-o <"BAI">
  | /d/ any-i /'/ any-u <"KOhA">
  | /d/ any-o <"KOhA">
  | /d/ any-o /'/ any-a <"UI" ∪ "indicator">
  | /d/ any-o /'/ any-a any-i <"DAhO" ∪ "indicator">
  | /d/ any-o /'/ any-e <"BAI">
  | /d/ any-o /'/ any-i <"KOhA">
  | /d/ any-o /'/ any-o <"KOhA">
  | /d/ any-o /'/ any-u <"DOhU">
  | /d/ any-o any-i <"DOI">
  | /d/ any-u <"GOhA">
  | /d/ any-u /'/ any-a <"FAhA">
  | /d/ any-u /'/ any-e <"PA">
  | /d/ any-u /'/ any-e any-i <"PA">
  | /d/ any-u /'/ any-i <"BAI">
  | /d/ any-u /'/ any-o <"BAI">
  | /d/ any-u /'/ any-o any-i <"FAhA">
  | /d/ any-u /'/ any-u <"NU">
  | /d/ any-y <"BY">
```

```jbogenbau
%rule lexicon-e
  | any-e <"A">
  | any-e /'/ any-a <"UI" ∪ "indicator">
  | any-e /'/ any-e <"UI" ∪ "indicator">
  | any-e /'/ any-e any-i <"UI" ∪ "indicator">
  | any-e /'/ any-i <"UI" ∪ "indicator">
  | any-e /'/ any-o <"UI" ∪ "indicator">
  | any-e /'/ any-u <"UI" ∪ "indicator">
  | any-e /'/ any-u /'/ any-i <"BAI">
  | any-e /'/ any-y <"BY">
  | any-e any-i <"UI" ∪ "indicator">
  | any-e any-i /'/ any-a any-i <"UI" ∪ "indicator">
  | any-e any-i /'/ any-e any-i <"BAI">
```

```jbogenbau
%rule lexicon-f
  | /f/ any-a <"FA">
  | /f/ any-a /'/ any-a <"FAhA">
  | /f/ any-a /'/ any-a any-i <"UI" ∪ "indicator">
  | /f/ any-a /'/ any-e <"BAI">
  | /f/ any-a /'/ any-i <"VUhU">
  | /f/ any-a /'/ any-o <"FAhO">
  | /f/ any-a /'/ any-u <"JOI">
  | /f/ any-a any-i <"FA">
  | /f/ any-a any-i /'/ any-u <"PA">
  | /f/ any-a any-u <"BAI">
  | /f/ any-a any-u /'/ any-a <"BY">
  | /f/ any-a any-u /'/ any-e <"XI" ∪ "BY">
  | /f/ any-a any-u /'/ any-i <"BY">
  | /f/ any-a any-u /'/ any-o <"BY">
  | /f/ any-a any-u /'/ any-u <"BAI" ∪ "BY">
  | /f/ any-e <"FA">
  | /f/ any-e /'/ any-a <"VUhU">
  | /f/ any-e /'/ any-a /'/ any-a <"VUhU">
  | /f/ any-e /'/ any-a /'/ any-e <"VUhU">
  | /f/ any-e /'/ any-a /'/ any-i <"VUhU">
  | /f/ any-e /'/ any-a /'/ any-o <"VUhU">
  | /f/ any-e /'/ any-e <"FEhE">
  | /f/ any-e /'/ any-i <"VUhU">
  | /f/ any-e /'/ any-o <"COI">
  | /f/ any-e /'/ any-u <"FEhU">
  | /f/ any-e any-i <"PA">
  | /f/ any-e any-i /'/ any-e <"COI">
  | /f/ any-i <"FA">
  | /f/ any-i /'/ any-a <"FA">
  | /f/ any-i /'/ any-a any-u <"FIhAU">
  | /f/ any-i /'/ any-e <"BAI">
  | /f/ any-i /'/ any-i <"COI">
  | /f/ any-i /'/ any-o <"FIhO">
  | /f/ any-i /'/ any-o any-i <"FIhOI">
  | /f/ any-i /'/ any-u <"PA">
  | /f/ any-o <"FA">
  | /f/ any-o /'/ any-a <"KOhA">
  | /f/ any-o /'/ any-a any-i <"KOhA">
  | /f/ any-o /'/ any-e <"KOhA">
  | /f/ any-o /'/ any-i <"KOhA">
  | /f/ any-o /'/ any-o <"KOhA">
  | /f/ any-o /'/ any-u <"KOhA">
  | /f/ any-o any-i <"FOI">
  | /f/ any-u <"FA">
  | /f/ any-u /'/ any-a <"FUhA">
  | /f/ any-u /'/ any-a any-u <"UI" ∪ "indicator">
  | /f/ any-u /'/ any-e <"FUhE" ∪ "indicator" ∪ ?"UI">
  | /f/ any-u /'/ any-i <"UI" ∪ "indicator">
  | /f/ any-u /'/ any-o <"FUhO" ∪ "indicator" ∪ ?"UI">
  | /f/ any-u /'/ any-u <"VUhU">
  | /f/ any-y <"BY">
```

```jbogenbau
%rule lexicon-g
  | /g/ any-a <"GA">
  | /g/ any-a /'/ any-a <"BAI">
  | /g/ any-a /'/ any-e <"BY">
  | /g/ any-a /'/ any-e any-i <"BAI">
  | /g/ any-a /'/ any-i <"UI" ∪ "indicator">
  | /g/ any-a /'/ any-i /'/ any-i <"UI" ∪ "indicator">
  | /g/ any-a /'/ any-o <"GAhO">
  | /g/ any-a /'/ any-u <"FAhA">
  | /g/ any-a /'/ any-u /'/ any-i <"UI" ∪ "indicator">
  | /g/ any-a any-i <"PA">
  | /g/ any-a any-i /'/ any-a <"BY">
  | /g/ any-a any-i /'/ any-e <"BY">
  | /g/ any-a any-i /'/ any-i <"BY">
  | /g/ any-a any-i /'/ any-o <"GOhA" ∪ "BY">
  | /g/ any-a any-i /'/ any-u <"BY">
  | /g/ any-a any-u <"BAI">
  | /g/ any-a any-u /'/ any-i <"COI">
  | /g/ any-e <"GA">
  | /g/ any-e /'/ any-a <"VUhU">
  | /g/ any-e /'/ any-a any-i <"UI" ∪ "ZOhU" ∪ "indicator">
  | /g/ any-e /'/ any-e <"UI" ∪ "indicator">
  | /g/ any-e /'/ any-i <"GA">
  | /g/ any-e /'/ any-o <"BY">
  | /g/ any-e /'/ any-u <"GEhU">
  | /g/ any-e /'/ any-u /'/ any-i <"TOI">
  | /g/ any-e any-i <"VUhU">
  | /g/ any-e any-i /'/ any-a <"VUhU">
  | /g/ any-i <"GI">
  | /g/ any-i /'/ any-a <"GIhA">
  | /g/ any-i /'/ any-e <"GIhA">
  | /g/ any-i /'/ any-i <"GIhA" ∪ ?"GIhI">
  | /g/ any-i /'/ any-o <"GIhA">
  | /g/ any-i /'/ any-u <"GIhA">
  | /g/ any-o <"GA">
  | /g/ any-o /'/ any-a <"GOhA">
  | /g/ any-o /'/ any-e <"GOhA">
  | /g/ any-o /'/ any-i <"GOhA">
  | /g/ any-o /'/ any-o <"GOhA">
  | /g/ any-o /'/ any-o any-i <"GOhOI">
  | /g/ any-o /'/ any-u <"GOhA">
  | /g/ any-o any-i <"GOI">
  | /g/ any-u <"GA">
  | /g/ any-u /'/ any-a <"GUhA">
  | /g/ any-u /'/ any-e <"GUhA">
  | /g/ any-u /'/ any-i <"GUhA">
  | /g/ any-u /'/ any-o <"GUhA">
  | /g/ any-u /'/ any-u <"GUhA">
  | /g/ any-y <"BY">
```

```jbogenbau
%rule lexicon-i
  | any-i <"I">
  | any-i /'/ any-a <"UI" ∪ "indicator">
  | any-i /'/ any-a any-u <"UI" ∪ "indicator">
  | any-i /'/ any-e <"UI" ∪ "indicator">
  | any-i /'/ any-e any-i <"UI" ∪ "indicator">
  | any-i /'/ any-i <"UI" ∪ "indicator">
  | any-i /'/ any-i /'/ any-i <"UI" ∪ "indicator">
  | any-i /'/ any-o <"UI" ∪ "indicator">
  | any-i /'/ any-u <"UI" ∪ "indicator">
  | any-i /'/ any-y <"BY">
  | any-i any-a <"UI" ∪ "indicator">
  | any-i any-a /'/ any-a any-u <"UI" ∪ "indicator">
  | any-i any-a /'/ any-u <"IhAU">
  | any-i any-e <"UI" ∪ "indicator">
  | any-i any-e /'/ any-o <"Y" ∪ "indicator">
  | any-i any-i <"UI" ∪ "indicator">
  | any-i any-o <"UI" ∪ "indicator">
  | any-i any-u <"UI" ∪ "indicator">
  | any-i any-y <"BY">
```

```jbogenbau
%rule lexicon-j
  | /j/ any-a <"JA" ∪ ?"JEhI">
  | /j/ any-a /'/ any-a <"NA">
  | /j/ any-a /'/ any-a any-i <"NAI">
  | /j/ any-a /'/ any-a any-u <"BAI">
  | /j/ any-a /'/ any-e <"BAI">
  | /j/ any-a /'/ any-e any-i <"JAI">
  | /j/ any-a /'/ any-i <"BAI">
  | /j/ any-a /'/ any-o <"UI" ∪ "indicator">
  | /j/ any-a /'/ any-o /'/ any-e <"UI" ∪ "indicator">
  | /j/ any-a /'/ any-o /'/ any-o <"UI" ∪ "indicator">
  | /j/ any-a /'/ any-o any-i <"BAI" ∪ "NU">
  | /j/ any-a /'/ any-u any-i <"BAI">
  | /j/ any-a any-i <"JAI">
  | /j/ any-a any-u <"PA">
  | /j/ any-a any-u /'/ any-a <"BY">
  | /j/ any-a any-u /'/ any-e <"BY">
  | /j/ any-a any-u /'/ any-i <"BY">
  | /j/ any-a any-u /'/ any-o <"BY">
  | /j/ any-a any-u /'/ any-u <"JOI" ∪ "BY">
  | /j/ any-e <"JA" ∪ ?"JEhI">
  | /j/ any-e /'/ any-a <"NAhE">
  | /j/ any-e /'/ any-a any-u <"JOI">
  | /j/ any-e /'/ any-e <"COI">
  | /j/ any-e /'/ any-i <"JA" ∪ ?"JEhI">
  | /j/ any-e /'/ any-o <"BY">
  | /j/ any-e /'/ any-u <"UI" ∪ "indicator">
  | /j/ any-e any-i <"NU">
  | /j/ any-e any-i /'/ any-e <"COI">
  | /j/ any-e any-i /'/ any-i <"JOI">
  | /j/ any-e any-i /'/ any-o <"JOI">
  | /j/ any-i <"A">
  | /j/ any-i /'/ any-a <"UI" ∪ "indicator">
  | /j/ any-i /'/ any-a any-i <"UI" ∪ "indicator">
  | /j/ any-i /'/ any-e <"BAI">
  | /j/ any-i /'/ any-e /'/ any-e <"BAI">
  | /j/ any-i /'/ any-e any-i <"UI" ∪ "indicator">
  | /j/ any-i /'/ any-i <"PA">
  | /j/ any-i /'/ any-i /'/ any-a <"BAI">
  | /j/ any-i /'/ any-o <"BAI">
  | /j/ any-i /'/ any-o /'/ any-e <"UI" ∪ "indicator">
  | /j/ any-i /'/ any-o /'/ any-o <"UI" ∪ "indicator">
  | /j/ any-i /'/ any-u <"BAI">
  | /j/ any-o <"JA" ∪ ?"JEhI">
  | /j/ any-o /'/ any-a <"UI" ∪ "indicator">
  | /j/ any-o /'/ any-a any-i <"JAI">
  | /j/ any-o /'/ any-a any-u <"JOI">
  | /j/ any-o /'/ any-e <"JOI">
  | /j/ any-o /'/ any-i <"JOhI">
  | /j/ any-o /'/ any-i /'/ any-a <"JOI">
  | /j/ any-o /'/ any-o <"BY">
  | /j/ any-o /'/ any-u <"JOI">
  | /j/ any-o /'/ any-u /'/ any-u <"JOI">
  | /j/ any-o any-i <"JOI">
  | /j/ any-o any-i /'/ any-e <"JOI">
  | /j/ any-o any-i /'/ any-i <"VUhU">
  | /j/ any-o any-i /'/ any-o <"BY">
  | /j/ any-o any-i /'/ any-u <"BY">
  | /j/ any-u <"JA" ∪ ?"JEhI">
  | /j/ any-u /'/ any-a <"UI" ∪ "indicator">
  | /j/ any-u /'/ any-e <"JOI">
  | /j/ any-u /'/ any-i <"COI">
  | /j/ any-u /'/ any-o <"UI" ∪ "indicator">
  | /j/ any-u /'/ any-o any-i <"UI" ∪ "indicator">
  | /j/ any-u /'/ any-u <"VUhU">
  | /j/ any-y <"BY">
```

```jbogenbau
%rule lexicon-k
  | /k/ any-a <"NU">
  | /k/ any-a /'/ any-a <"BAI">
  | /k/ any-a /'/ any-a any-i <"BAI" ∪ "NU">
  | /k/ any-a /'/ any-e <"CAhA">
  | /k/ any-a /'/ any-i <"BAI">
  | /k/ any-a /'/ any-o <"PA">
  | /k/ any-a /'/ any-u <"UI" ∪ "indicator">
  | /k/ any-a any-i <"BAI">
  | /k/ any-a any-i /'/ any-a any-i <"NU">
  | /k/ any-a any-i /'/ any-u <"NU">
  | /k/ any-a any-u <"UI" ∪ "indicator">
  | /k/ any-a any-u /'/ any-a <"BY">
  | /k/ any-a any-u /'/ any-e <"BY">
  | /k/ any-a any-u /'/ any-i <"BY">
  | /k/ any-a any-u /'/ any-o <"BY">
  | /k/ any-a any-u /'/ any-u <"BY">
  | /k/ any-e <"KE">
  | /k/ any-e /'/ any-a <"KOhA">
  | /k/ any-e /'/ any-a any-u <"ZOhU">
  | /k/ any-e /'/ any-e <"KEhE">
  | /k/ any-e /'/ any-i <"GAhO">
  | /k/ any-e /'/ any-i /'/ any-a any-i <"UI" ∪ "indicator">
  | /k/ any-e /'/ any-o <"COI">
  | /k/ any-e /'/ any-u <"UI" ∪ "indicator">
  | /k/ any-e any-i <"KEI">
  | /k/ any-i <"KI">
  | /k/ any-i /'/ any-a <"UI" ∪ "indicator">
  | /k/ any-i /'/ any-a /'/ any-a <"KOhA">
  | /k/ any-i /'/ any-a any-i <"BAI" ∪ "COI" ∪ "UI">
  | /k/ any-i /'/ any-e <"COI">
  | /k/ any-i /'/ any-e /'/ any-a <"KOhA">
  | /k/ any-i /'/ any-i <"BAI" ∪ ?"NU">
  | /k/ any-i /'/ any-i /'/ any-a <"KOhA">
  | /k/ any-i /'/ any-o <"PA">
  | /k/ any-i /'/ any-o /'/ any-a <"KOhA">
  | /k/ any-i /'/ any-o /'/ any-e <"BAI">
  | /k/ any-i /'/ any-o any-i <"BAI">
  | /k/ any-i /'/ any-u <"BAI">
  | /k/ any-i /'/ any-u /'/ any-a <"KOhA">
  | /k/ any-i /'/ any-u /'/ any-e <"BAI">
  | /k/ any-i /'/ any-u /'/ any-i <"BAI">
  | /k/ any-o <"KOhA">
  | /k/ any-o /'/ any-a <"KOhA">
  | /k/ any-o /'/ any-a any-u <"BAI">
  | /k/ any-o /'/ any-e <"KOhA">
  | /k/ any-o /'/ any-i <"KOhA">
  | /k/ any-o /'/ any-o <"KOhA">
  | /k/ any-o /'/ any-o any-i <"UI" ∪ "indicator">
  | /k/ any-o /'/ any-u <"KOhA">
  | /k/ any-o any-i <"BAI">
  | /k/ any-u <"KU">
  | /k/ any-u /'/ any-a <"JOI">
  | /k/ any-u /'/ any-a any-u <"KUhAU">
  | /k/ any-u /'/ any-e <"KUhE">
  | /k/ any-u /'/ any-i <"UI" ∪ "indicator">
  | /k/ any-u /'/ any-o <"KUhO">
  | /k/ any-u /'/ any-o any-i <"KUhOI">
  | /k/ any-u /'/ any-u <"BAI">
  | /k/ any-y <"BY">
```

```jbogenbau
%rule lexicon-l
  | /l/ any-a <"LA">
  | /l/ any-a /'/ any-a <"UI" ∪ "indicator">
  | /l/ any-a /'/ any-a any-i <"BAI">
  | /l/ any-a /'/ any-a any-u <"LU">
  | /l/ any-a /'/ any-e <"LAhE">
  | /l/ any-a /'/ any-e any-i <"BAI" ∪ "LE" ∪ "UI">
  | /l/ any-a /'/ any-i <"LA">
  | /l/ any-a /'/ any-o <"ZOI">
  | /l/ any-a /'/ any-o /'/ any-o <"BAI">
  | /l/ any-a /'/ any-o any-i <"LAhOI" ∪ "UI">
  | /l/ any-a /'/ any-u <"BAI">
  | /l/ any-a any-i <"LA">
  | /l/ any-a any-u <"LAU">
  | /l/ any-e <"LE">
  | /l/ any-e /'/ any-a <"BAI">
  | /l/ any-e /'/ any-a any-i <"LEhAI">
  | /l/ any-e /'/ any-e <"LE">
  | /l/ any-e /'/ any-e any-i <"LE">
  | /l/ any-e /'/ any-i <"LE">
  | /l/ any-e /'/ any-o <"UI" ∪ "indicator">
  | /l/ any-e /'/ any-o /'/ any-e <"UI" ∪ "indicator">
  | /l/ any-e /'/ any-u <"LEhU">
  | /l/ any-e any-i <"LE">
  | /l/ any-e any-i /'/ any-e <"LE">
  | /l/ any-e any-i /'/ any-i <"LE">
  | /l/ any-i <"LI">
  | /l/ any-i /'/ any-a <"UI" ∪ "indicator">
  | /l/ any-i /'/ any-a any-i <"LI">
  | /l/ any-i /'/ any-a any-u <"LIhAU">
  | /l/ any-i /'/ any-e <"BAI">
  | /l/ any-i /'/ any-e /'/ any-e <"BAI">
  | /l/ any-i /'/ any-e any-i <"BAI" ∪ "LI">
  | /l/ any-i /'/ any-i <"NU">
  | /l/ any-i /'/ any-o <"UI" ∪ "indicator">
  | /l/ any-i /'/ any-o any-i <"UI" ∪ "indicator">
  | /l/ any-i /'/ any-u <"LIhU">
  | /l/ any-o <"LE">
  | /l/ any-o /'/ any-a <"BY">
  | /l/ any-o /'/ any-a any-i <"LOhAI">
  | /l/ any-o /'/ any-e <"LE">
  | /l/ any-o /'/ any-e any-i <"LE">
  | /l/ any-o /'/ any-i <"LE">
  | /l/ any-o /'/ any-o <"LOhO">
  | /l/ any-o /'/ any-o any-i <"LOhOI">
  | /l/ any-o /'/ any-u <"LOhU">
  | /l/ any-o any-i <"LE">
  | /l/ any-o any-i /'/ any-e <"LAhE" ∪ "LE">
  | /l/ any-o any-i /'/ any-i <"LAhE" ∪ "LE">
  | /l/ any-u <"LU">
  | /l/ any-u /'/ any-a <"LAhE">
  | /l/ any-u /'/ any-e <"LAhE">
  | /l/ any-u /'/ any-e any-i <"LUhEI">
  | /l/ any-u /'/ any-i <"LAhE">
  | /l/ any-u /'/ any-o <"LAhE">
  | /l/ any-u /'/ any-u <"LUhU">
  | /l/ any-y <"BY">
```

```jbogenbau
%rule lexicon-m
  | /m/ any-a <"KOhA">
  | /m/ any-a /'/ any-a <"KOhA">
  | /m/ any-a /'/ any-a any-i <"UI" ∪ "indicator">
  | /m/ any-a /'/ any-a any-u <"KOhA">
  | /m/ any-a /'/ any-e <"BAI">
  | /m/ any-a /'/ any-e any-i <"BAI" ∪ "KOhA">
  | /m/ any-a /'/ any-i <"BAI">
  | /m/ any-a /'/ any-o <"MAhO">
  | /m/ any-a /'/ any-o any-i <"MAhOI" ∪ "KOhA" ∪ "ZO">
  | /m/ any-a /'/ any-u <"PA">
  | /m/ any-a any-i <"MAI">
  | /m/ any-a any-i /'/ any-o <"LI">
  | /m/ any-a any-u <"BAI">
  | /m/ any-a any-u /'/ any-a <"LOhOI">
  | /m/ any-a any-u /'/ any-e <"TO">
  | /m/ any-a any-u /'/ any-i <"BAI">
  | /m/ any-a any-u /'/ any-o <"TOI">
  | /m/ any-a any-u /'/ any-u <"BAI">
  | /m/ any-e <"ME">
  | /m/ any-e /'/ any-a <"BAI">
  | /m/ any-e /'/ any-a any-u <"ME">
  | /m/ any-e /'/ any-e <"BAI">
  | /m/ any-e /'/ any-e any-i <"LE" ∪ "PA">
  | /m/ any-e /'/ any-i <"PA">
  | /m/ any-e /'/ any-o <"LI">
  | /m/ any-e /'/ any-o /'/ any-e <"LAhE">
  | /m/ any-e /'/ any-o any-i <"MEhOI">
  | /m/ any-e /'/ any-u <"MEhU">
  | /m/ any-e any-i <"MOI">
  | /m/ any-i <"KOhA">
  | /m/ any-i /'/ any-a <"KOhA">
  | /m/ any-i /'/ any-a any-i <"KOhA">
  | /m/ any-i /'/ any-a any-u <"KOhA">
  | /m/ any-i /'/ any-e <"COI">
  | /m/ any-i /'/ any-e any-i <"COI">
  | /m/ any-i /'/ any-i <"BIhI">
  | /m/ any-i /'/ any-o <"KOhA">
  | /m/ any-i /'/ any-u <"UI" ∪ "indicator">
  | /m/ any-o <"GOhA">
  | /m/ any-o /'/ any-a <"PA">
  | /m/ any-o /'/ any-e <"MOhE">
  | /m/ any-o /'/ any-i <"MOhI">
  | /m/ any-o /'/ any-o <"MAI" ∪ ?"KOhA">
  | /m/ any-o /'/ any-o any-i <"LE">
  | /m/ any-o /'/ any-u <"ZAhO" ∪ ?"KOhA">
  | /m/ any-o any-i <"MOI">
  | /m/ any-o any-i /'/ any-o <"MOI">
  | /m/ any-o any-i /'/ any-o any-i <"LE">
  | /m/ any-u <"PA">
  | /m/ any-u /'/ any-a <"UI" ∪ "indicator">
  | /m/ any-u /'/ any-a any-i <"BAI">
  | /m/ any-u /'/ any-e <"NU">
  | /m/ any-u /'/ any-e any-i <"ROI">
  | /m/ any-u /'/ any-i <"BAI">
  | /m/ any-u /'/ any-o <"COI">
  | /m/ any-u /'/ any-o any-i <"BAI" ∪ "ZOI">
  | /m/ any-u /'/ any-u <"BAI">
  | /m/ any-y <"BY">
```

```jbogenbau
%rule lexicon-n
  | /n/ any-a <"NA">
  | /n/ any-a /'/ any-a <"BY">
  | /n/ any-a /'/ any-e <"NAhE">
  | /n/ any-a /'/ any-e any-i <"NAhE">
  | /n/ any-a /'/ any-i <"UI" ∪ "indicator">
  | /n/ any-a /'/ any-o <"TAhE">
  | /n/ any-a /'/ any-o any-i <"SE">
  | /n/ any-a /'/ any-u <"NAhU">
  | /n/ any-a any-i <"NAI">
  | /n/ any-a any-u <"CUhE">
  | /n/ any-a any-u /'/ any-o <"KOhA">
  | /n/ any-a any-u /'/ any-u <"KOhA">
  | /n/ any-e <"GOI">
  | /n/ any-e /'/ any-a <"FAhA">
  | /n/ any-e /'/ any-a /'/ any-i <"BAI">
  | /n/ any-e /'/ any-i <"FAhA">
  | /n/ any-e /'/ any-o <"VUhU">
  | /n/ any-e /'/ any-u <"FAhA">
  | /n/ any-e any-i <"GOhA">
  | /n/ any-i <"NU">
  | /n/ any-i /'/ any-a <"FAhA">
  | /n/ any-i /'/ any-e <"NIhE">
  | /n/ any-i /'/ any-e any-i <"UI" ∪ "indicator">
  | /n/ any-i /'/ any-i <"BAI">
  | /n/ any-i /'/ any-i /'/ any-i <"BAI">
  | /n/ any-i /'/ any-o <"NIhO">
  | /n/ any-i /'/ any-u <"PA">
  | /n/ any-o <"PA">
  | /n/ any-o /'/ any-a <"GOhA">
  | /n/ any-o /'/ any-e <"NAhE">
  | /n/ any-o /'/ any-e any-i <"NAhE">
  | /n/ any-o /'/ any-i <"NIhO">
  | /n/ any-o /'/ any-o <"PA">
  | /n/ any-o /'/ any-o any-i <"NOhOI">
  | /n/ any-o /'/ any-u <"GOI">
  | /n/ any-o any-i <"NOI">
  | /n/ any-o any-i /'/ any-a <"NOIhA">
  | /n/ any-o any-i /'/ any-i <"TO">
  | /n/ any-o any-i /'/ any-o /'/ any-a <"NOIhA">
  | /n/ any-u <"NU">
  | /n/ any-u /'/ any-a <"NUhA">
  | /n/ any-u /'/ any-e <"COI">
  | /n/ any-u /'/ any-i <"NUhI">
  | /n/ any-u /'/ any-o <"CAhA">
  | /n/ any-u /'/ any-u <"NUhU">
  | /n/ any-y <"BY">
```

```jbogenbau
%rule lexicon-o
  | any-o <"A">
  | any-o /'/ any-a <"UI" ∪ "indicator">
  | any-o /'/ any-a any-i <"COI">
  | any-o /'/ any-e <"UI" ∪ "indicator">
  | any-o /'/ any-i <"UI" ∪ "indicator">
  | any-o /'/ any-o <"UI" ∪ "indicator">
  | any-o /'/ any-u <"UI" ∪ "indicator">
  | any-o /'/ any-y <"BY">
  | any-o any-i <"UI" ∪ "indicator">
  | any-o any-i /'/ any-a <"UI" ∪ "indicator">
  | any-o any-i /'/ any-o any-i <"UI" ∪ "indicator">
```

```jbogenbau
%rule lexicon-p
  | /p/ any-a <"PA">
  | /p/ any-a /'/ any-a <"BAI">
  | /p/ any-a /'/ any-a /'/ any-i <"BAI">
  | /p/ any-a /'/ any-e <"UI" ∪ "indicator">
  | /p/ any-a /'/ any-i <"VUhU">
  | /p/ any-a /'/ any-o <"FAhA">
  | /p/ any-a /'/ any-u <"BAI">
  | /p/ any-a any-i <"PA">
  | /p/ any-a any-i /'/ any-e <"NU">
  | /p/ any-a any-u <"UI" ∪ "indicator">
  | /p/ any-e <"GOI">
  | /p/ any-e /'/ any-a <"UI" ∪ "indicator">
  | /p/ any-e /'/ any-a /'/ any-i <"BAI">
  | /p/ any-e /'/ any-e <"PEhE">
  | /p/ any-e /'/ any-e any-i <"COI">
  | /p/ any-e /'/ any-i <"UI" ∪ "indicator">
  | /p/ any-e /'/ any-o <"PEhO">
  | /p/ any-e /'/ any-u <"COI">
  | /p/ any-e any-i <"CAI" ∪ "indicator">
  | /p/ any-e any-i /'/ any-e <"COI">
  | /p/ any-i <"PA">
  | /p/ any-i /'/ any-a <"VUhU">
  | /p/ any-i /'/ any-a any-i <"VUhU">
  | /p/ any-i /'/ any-e <"PA">
  | /p/ any-i /'/ any-e any-i <"LAhE">
  | /p/ any-i /'/ any-i <"VUhU">
  | /p/ any-i /'/ any-o <"BAI">
  | /p/ any-i /'/ any-u <"JOI">
  | /p/ any-o <"GOI">
  | /p/ any-o /'/ any-a any-i <"UI" ∪ "indicator">
  | /p/ any-o /'/ any-e <"GOI">
  | /p/ any-o /'/ any-i <"BAI">
  | /p/ any-o /'/ any-o <"UI" ∪ "indicator">
  | /p/ any-o /'/ any-o any-i <"LAhE" ∪ "NOI">
  | /p/ any-o /'/ any-u <"GOI">
  | /p/ any-o any-i <"NOI">
  | /p/ any-o any-i /'/ any-a <"NOIhA">
  | /p/ any-o any-i /'/ any-e any-i <"LAhE">
  | /p/ any-o any-i /'/ any-i <"NU">
  | /p/ any-o any-i /'/ any-o /'/ any-a <"NOIhA">
  | /p/ any-u <"PU">
  | /p/ any-u /'/ any-a <"BAI">
  | /p/ any-u /'/ any-a any-u <"CUhE">
  | /p/ any-u /'/ any-e <"BAI">
  | /p/ any-u /'/ any-e /'/ any-i <"BAI">
  | /p/ any-u /'/ any-i <"CAhA">
  | /p/ any-u /'/ any-i /'/ any-a <"BAI">
  | /p/ any-u /'/ any-i /'/ any-i <"BAI">
  | /p/ any-u /'/ any-o <"ZAhO">
  | /p/ any-u /'/ any-o /'/ any-i <"BAI">
  | /p/ any-u /'/ any-u <"NU">
  | /p/ any-y <"BY">
```

```jbogenbau
%rule lexicon-r
  | /r/ any-a <"KOhA">
  | /r/ any-a /'/ any-a <"BAI">
  | /r/ any-a /'/ any-a any-i <"KOhA">
  | /r/ any-a /'/ any-e <"PA">
  | /r/ any-a /'/ any-i <"BAI">
  | /r/ any-a /'/ any-o <"RAhO">
  | /r/ any-a /'/ any-o any-i <"RAhOI">
  | /r/ any-a /'/ any-u <"UI" ∪ "indicator">
  | /r/ any-a any-i <"BAI">
  | /r/ any-a any-i /'/ any-e <"BAI">
  | /r/ any-a any-u <"PA">
  | /r/ any-a any-u /'/ any-i <"KOhA">
  | /r/ any-e <"PA">
  | /r/ any-e /'/ any-a <"VUhU">
  | /r/ any-e /'/ any-e <"UI" ∪ "indicator">
  | /r/ any-e /'/ any-e any-i <"COI">
  | /r/ any-e /'/ any-i <"COI">
  | /r/ any-e /'/ any-o <"FAhA">
  | /r/ any-e /'/ any-u <"ROI">
  | /r/ any-e any-i <"PA">
  | /r/ any-i <"KOhA">
  | /r/ any-i /'/ any-a <"BAI">
  | /r/ any-i /'/ any-e <"UI" ∪ "indicator">
  | /r/ any-i /'/ any-i <"BAI">
  | /r/ any-i /'/ any-i /'/ any-a <"BAI">
  | /r/ any-i /'/ any-i /'/ any-e <"BAI">
  | /r/ any-i /'/ any-i /'/ any-i <"BAI">
  | /r/ any-i /'/ any-i /'/ any-o <"BAI">
  | /r/ any-i /'/ any-i /'/ any-u <"BAI">
  | /r/ any-i /'/ any-o <"VUhU">
  | /r/ any-i /'/ any-o any-i <"LE">
  | /r/ any-i /'/ any-u <"FAhA">
  | /r/ any-o <"PA">
  | /r/ any-o /'/ any-a <"UI" ∪ "indicator">
  | /r/ any-o /'/ any-e <"UI" ∪ "indicator">
  | /r/ any-o /'/ any-e any-i <"KOhA">
  | /r/ any-o /'/ any-i <"UI" ∪ "indicator">
  | /r/ any-o /'/ any-o <"UI" ∪ "indicator">
  | /r/ any-o /'/ any-o any-i <"PA">
  | /r/ any-o /'/ any-u <"UI" ∪ "indicator">
  | /r/ any-o any-i <"ROI">
  | /r/ any-u <"KOhA">
  | /r/ any-u /'/ any-a <"UI" ∪ "indicator">
  | /r/ any-u /'/ any-e <"CAI" ∪ "indicator">
  | /r/ any-u /'/ any-i <"TAhE">
  | /r/ any-u /'/ any-o <"BY">
  | /r/ any-u /'/ any-u <"FAhA">
  | /r/ any-y <"BY">
```

```jbogenbau
%rule lexicon-s
  | /s/ any-a <"SA">
  | /s/ any-a /'/ any-a <"UI" ∪ "indicator">
  | /s/ any-a /'/ any-a any-i <"SAhAI">
  | /s/ any-a /'/ any-e <"UI" ∪ "indicator">
  | /s/ any-a /'/ any-e any-i <"COI">
  | /s/ any-a /'/ any-i <"VUhU">
  | /s/ any-a /'/ any-i /'/ any-a <"VUhU">
  | /s/ any-a /'/ any-o <"VUhU">
  | /s/ any-a /'/ any-u <"UI" ∪ "indicator">
  | /s/ any-a any-i <"CAI" ∪ "indicator">
  | /s/ any-a any-i /'/ any-e <"SEI">
  | /s/ any-a any-i /'/ any-i <"UI" ∪ "indicator">
  | /s/ any-a any-u <"BAI">
  | /s/ any-a any-u /'/ any-a <"ZAhO">
  | /s/ any-e <"SE">
  | /s/ any-e /'/ any-a <"UI" ∪ "indicator">
  | /s/ any-e /'/ any-e <"BY" ∪ ?"KOhA">
  | /s/ any-e /'/ any-i <"UI" ∪ "indicator">
  | /s/ any-e /'/ any-o <"UI" ∪ "indicator">
  | /s/ any-e /'/ any-u <"SEhU">
  | /s/ any-e any-i <"SEI">
  | /s/ any-e any-i /'/ any-a <"UI" ∪ "indicator">
  | /s/ any-e any-i /'/ any-e <"SEI">
  | /s/ any-e any-i /'/ any-i <"UI" ∪ "indicator">
  | /s/ any-i <"SI">
  | /s/ any-i /'/ any-a <"UI" ∪ "indicator">
  | /s/ any-i /'/ any-a any-u <"UI" ∪ "indicator">
  | /s/ any-i /'/ any-e <"MOI">
  | /s/ any-i /'/ any-i <"VUhU">
  | /s/ any-i /'/ any-o <"NU">
  | /s/ any-i /'/ any-u <"BAI">
  | /s/ any-o <"PA">
  | /s/ any-o /'/ any-a <"PA">
  | /s/ any-o /'/ any-a /'/ any-u <"UI" ∪ "indicator">
  | /s/ any-o /'/ any-a any-i <"KOhA" ∪ "PA">
  | /s/ any-o /'/ any-e <"PA">
  | /s/ any-o /'/ any-e any-i <"PA" ∪ "UI">
  | /s/ any-o /'/ any-i <"PA">
  | /s/ any-o /'/ any-o <"PA">
  | /s/ any-o /'/ any-o any-i <"PA">
  | /s/ any-o /'/ any-u <"PA">
  | /s/ any-o any-i <"SOI">
  | /s/ any-o any-i /'/ any-a <"NOIhA">
  | /s/ any-o any-i /'/ any-e <"SEI">
  | /s/ any-u <"SU">
  | /s/ any-u /'/ any-a <"UI" ∪ "indicator">
  | /s/ any-u /'/ any-a any-i <"PA">
  | /s/ any-u /'/ any-e <"PA">
  | /s/ any-u /'/ any-e any-i <"SE" ∪ "UI">
  | /s/ any-u /'/ any-i <"VUhU">
  | /s/ any-u /'/ any-o <"PA">
  | /s/ any-u /'/ any-o any-i <"PA" ∪ "SEI">
  | /s/ any-u /'/ any-u <"NU">
  | /s/ any-y <"BY">
```

```jbogenbau
%rule lexicon-t
  | /t/ any-a <"KOhA">
  | /t/ any-a /'/ any-a <"COI">
  | /t/ any-a /'/ any-a any-i <"TAhAI">
  | /t/ any-a /'/ any-e <"TAhE">
  | /t/ any-a /'/ any-i <"BAI">
  | /t/ any-a /'/ any-i /'/ any-a <"BAI">
  | /t/ any-a /'/ any-i /'/ any-e <"BAI">
  | /t/ any-a /'/ any-i /'/ any-i <"BAI">
  | /t/ any-a /'/ any-i /'/ any-o <"BAI">
  | /t/ any-a /'/ any-i /'/ any-u <"BAI">
  | /t/ any-a /'/ any-o <"UI" ∪ "indicator">
  | /t/ any-a /'/ any-u <"UI" ∪ "indicator">
  | /t/ any-a /'/ any-u /'/ any-i <"BAI">
  | /t/ any-a any-i <"BAI">
  | /t/ any-a any-u <"LAU">
  | /t/ any-e <"SE">
  | /t/ any-e /'/ any-a <"VUhU">
  | /t/ any-e /'/ any-a any-i <"BAI" ∪ "XI">
  | /t/ any-e /'/ any-e <"FAhA">
  | /t/ any-e /'/ any-o <"PA">
  | /t/ any-e /'/ any-o any-i <"LAhE">
  | /t/ any-e /'/ any-u <"TEhU">
  | /t/ any-e any-i <"TEI">
  | /t/ any-i <"KOhA">
  | /t/ any-i /'/ any-a <"FAhA">
  | /t/ any-i /'/ any-a any-u <"KOhA">
  | /t/ any-i /'/ any-e <"UI" ∪ "indicator">
  | /t/ any-i /'/ any-i <"BAI">
  | /t/ any-i /'/ any-i /'/ any-a <"BAI">
  | /t/ any-i /'/ any-o <"SEI">
  | /t/ any-i /'/ any-u <"BAI">
  | /t/ any-i /'/ any-u /'/ any-a <"BAI">
  | /t/ any-i /'/ any-u /'/ any-i <"BAI">
  | /t/ any-i /'/ any-u /'/ any-u <"BAI">
  | /t/ any-o <"TO">
  | /t/ any-o /'/ any-a <"BY">
  | /t/ any-o /'/ any-a any-i <"SE">
  | /t/ any-o /'/ any-e <"NAhE">
  | /t/ any-o /'/ any-i <"TO">
  | /t/ any-o /'/ any-o <"FAhA">
  | /t/ any-o /'/ any-o /'/ any-e <"KOhA">
  | /t/ any-o /'/ any-u <"UI" ∪ "indicator">
  | /t/ any-o any-i <"TOI">
  | /t/ any-u <"KOhA">
  | /t/ any-u /'/ any-a <"LAhE">
  | /t/ any-u /'/ any-a any-i <"LU">
  | /t/ any-u /'/ any-a any-u <"KOhA">
  | /t/ any-u /'/ any-e <"TUhE">
  | /t/ any-u /'/ any-i <"BAI">
  | /t/ any-u /'/ any-i /'/ any-a <"BAI">
  | /t/ any-u /'/ any-i /'/ any-e <"BAI">
  | /t/ any-u /'/ any-i /'/ any-i <"BAI">
  | /t/ any-u /'/ any-i /'/ any-o <"BAI">
  | /t/ any-u /'/ any-i /'/ any-u <"BAI">
  | /t/ any-u /'/ any-o <"PA">
  | /t/ any-u /'/ any-u <"TUhU">
  | /t/ any-y <"BY">
```

```jbogenbau
%rule lexicon-u
  | any-u <"A">
  | any-u /'/ any-a <"UI" ∪ "indicator">
  | any-u /'/ any-e <"UI" ∪ "indicator">
  | any-u /'/ any-i <"UI" ∪ "indicator">
  | any-u /'/ any-o <"UI" ∪ "indicator">
  | any-u /'/ any-o /'/ any-e <"UI" ∪ "indicator">
  | any-u /'/ any-o /'/ any-i <"UI" ∪ "indicator">
  | any-u /'/ any-o /'/ any-o <"UI" ∪ "indicator">
  | any-u /'/ any-o /'/ any-u <"UI" ∪ "indicator">
  | any-u /'/ any-o any-i <"UI" ∪ "indicator">
  | any-u /'/ any-u <"UI" ∪ "indicator">
  | any-u /'/ any-y <"BY">
  | any-u any-a <"UI" ∪ "indicator">
  | any-u any-e <"UI" ∪ "indicator">
  | any-u any-e /'/ any-i <"UI" ∪ "indicator">
  | any-u any-i <"UI" ∪ "indicator">
  | any-u any-i /'/ any-a any-i <"UI" ∪ "indicator">
  | any-u any-o <"UI" ∪ "indicator">
  | any-u any-u <"UI" ∪ "indicator">
  | any-u any-y <"BY">
```

```jbogenbau
%rule lexicon-v
  | /v/ any-a <"VA">
  | /v/ any-a /'/ any-a <"VUhU">
  | /v/ any-a /'/ any-e <"MOI">
  | /v/ any-a /'/ any-e any-i <"ROI">
  | /v/ any-a /'/ any-i <"UI" ∪ "indicator">
  | /v/ any-a /'/ any-o <"BAI">
  | /v/ any-a /'/ any-o /'/ any-i <"BAI">
  | /v/ any-a /'/ any-u <"BAI">
  | /v/ any-a any-i <"PA">
  | /v/ any-a any-i /'/ any-e <"UI" ∪ "indicator">
  | /v/ any-a any-u <"VAU">
  | /v/ any-e <"SE">
  | /v/ any-e /'/ any-a <"VEhA">
  | /v/ any-e /'/ any-e <"VEhA">
  | /v/ any-e /'/ any-i <"VEhA">
  | /v/ any-e /'/ any-o <"VEhO">
  | /v/ any-e /'/ any-u <"VEhA">
  | /v/ any-e any-i <"VEI">
  | /v/ any-i <"VA">
  | /v/ any-i /'/ any-a <"VIhA">
  | /v/ any-i /'/ any-e <"VIhA">
  | /v/ any-i /'/ any-i <"VIhA">
  | /v/ any-i /'/ any-o <"COI">
  | /v/ any-i /'/ any-u <"VIhA">
  | /v/ any-o <"PA">
  | /v/ any-o /'/ any-a <"KOhA">
  | /v/ any-o /'/ any-a any-i <"SE">
  | /v/ any-o /'/ any-e <"KOhA">
  | /v/ any-o /'/ any-i <"KOhA">
  | /v/ any-o /'/ any-o <"KOhA">
  | /v/ any-o /'/ any-u <"KOhA">
  | /v/ any-o any-i <"NOI">
  | /v/ any-o any-i /'/ any-e <"GOI" ∪ "LAhE">
  | /v/ any-o any-i /'/ any-i <"NOI">
  | /v/ any-u <"VA">
  | /v/ any-u /'/ any-a <"FAhA">
  | /v/ any-u /'/ any-e <"UI" ∪ "indicator">
  | /v/ any-u /'/ any-i <"LAhE">
  | /v/ any-u /'/ any-o <"VUhO">
  | /v/ any-u /'/ any-u <"VUhU">
  | /v/ any-y <"BY">
```

```jbogenbau
%rule lexicon-x
  | /x/ any-a <"PA">
  | /x/ any-a /'/ any-o <"ZAhO">
  | /x/ any-a any-i <"KOhA">
  | /x/ any-a any-i /'/ any-e <"PA">
  | /x/ any-a any-u /'/ any-a <"LOhOI" ∪ "UI">
  | /x/ any-a any-u /'/ any-e <"PA" ∪ "UI">
  | /x/ any-a any-u /'/ any-i <"UI" ∪ "indicator">
  | /x/ any-a any-u /'/ any-o <"UI" ∪ "indicator">
  | /x/ any-a any-u /'/ any-u <"UI" ∪ "indicator">
  | /x/ any-e <"SE">
  | /x/ any-e /'/ any-a any-u <"SEhU">
  | /x/ any-e /'/ any-e <"PA">
  | /x/ any-e /'/ any-e any-i <"NU">
  | /x/ any-e /'/ any-i /'/ any-a <"UI" ∪ "indicator">
  | /x/ any-e /'/ any-i /'/ any-e <"UI" ∪ "indicator">
  | /x/ any-e /'/ any-i /'/ any-i <"UI" ∪ "indicator">
  | /x/ any-e /'/ any-i /'/ any-o <"UI" ∪ "indicator">
  | /x/ any-e /'/ any-i /'/ any-u <"UI" ∪ "indicator">
  | /x/ any-e /'/ any-u <"GOhA">
  | /x/ any-e any-i /'/ any-e <"FAhA">
  | /x/ any-i <"XI">
  | /x/ any-i /'/ any-e <"XI">
  | /x/ any-i /'/ any-i <"XI">
  | /x/ any-o <"PA">
  | /x/ any-o /'/ any-a any-i <"PA" ∪ "SE">
  | /x/ any-o /'/ any-e <"PA">
  | /x/ any-o /'/ any-i <"XOhI" ∪ "ME">
  | /x/ any-o /'/ any-o <"UI" ∪ "indicator">
  | /x/ any-o /'/ any-u <"PA" ∪ "ZAhO">
  | /x/ any-o any-i <"SOI">
  | /x/ any-o any-i /'/ any-i <"PA">
  | /x/ any-u <"UI" ∪ "indicator">
  | /x/ any-u /'/ any-a any-i <"BAI">
  | /x/ any-u /'/ any-a any-u <"ROI">
  | /x/ any-u /'/ any-e any-i <"COI">
  | /x/ any-u /'/ any-u <"LOhOI">
  | /x/ any-y <"BY">
```

```jbogenbau
%rule lexicon-y
  any-y <"Y" ∪ "indicator" ∪ ?"BY"> | any-y /'/ any-y <"BY">
```

```jbogenbau
%rule lexicon-z
  | /z/ any-a <"ZI">
  | /z/ any-a /'/ any-a <"UI" ∪ "indicator">
  | /z/ any-a /'/ any-a any-i <"NU" ∪ "PA">
  | /z/ any-a /'/ any-e <"BAhE">
  | /z/ any-a /'/ any-e any-i <"UI" ∪ "indicator">
  | /z/ any-a /'/ any-i <"NU">
  | /z/ any-a /'/ any-o <"ZAhO">
  | /z/ any-a /'/ any-o /'/ any-a <"UI" ∪ "indicator">
  | /z/ any-a /'/ any-u <"PA">
  | /z/ any-a any-i <"LAU">
  | /z/ any-a any-u <"BAI">
  | /z/ any-a any-u /'/ any-a <"BAI">
  | /z/ any-a any-u /'/ any-e <"BAI">
  | /z/ any-a any-u /'/ any-i <"BAI">
  | /z/ any-a any-u /'/ any-o <"BAI">
  | /z/ any-a any-u /'/ any-u <"BAI">
  | /z/ any-e <"PA">
  | /z/ any-e /'/ any-a <"ZEhA">
  | /z/ any-e /'/ any-e <"ZEhA">
  | /z/ any-e /'/ any-i <"ZEhA">
  | /z/ any-e /'/ any-o <"FAhA">
  | /z/ any-e /'/ any-o any-i <"ZEhOI">
  | /z/ any-e /'/ any-u <"ZEhA">
  | /z/ any-e any-i <"ZEI">
  | /z/ any-i <"ZI">
  | /z/ any-i /'/ any-e <"ZIhE">
  | /z/ any-i /'/ any-o <"KOhA">
  | /z/ any-o <"ZO">
  | /z/ any-o /'/ any-a <"FAhA">
  | /z/ any-o /'/ any-a any-u <"LE">
  | /z/ any-o /'/ any-e <"KOhA">
  | /z/ any-o /'/ any-e any-i <"KOhA" ∪ "LAhE">
  | /z/ any-o /'/ any-i <"FAhA">
  | /z/ any-o /'/ any-o <"UI" ∪ "indicator">
  | /z/ any-o /'/ any-o any-i <"ZOhOI" ∪ "UI">
  | /z/ any-o /'/ any-u <"ZOhU">
  | /z/ any-o any-i <"ZOI">
  | /z/ any-u <"ZI">
  | /z/ any-u /'/ any-a <"FAhA">
  | /z/ any-u /'/ any-a any-i <"KOhA">
  | /z/ any-u /'/ any-a any-u <"FAhA">
  | /z/ any-u /'/ any-e <"BAI">
  | /z/ any-u /'/ any-i <"KOhA">
  | /z/ any-u /'/ any-o <"NU">
  | /z/ any-u /'/ any-u <"UI" ∪ "indicator">
  | /z/ any-y <"BY">
```
