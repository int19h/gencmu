# The Zantufa lexicon

This document is the lexicon of the forms stage in the [Zantufa](../dialects/zantufa.md) dialect. A lexicon is a list of words, each with its classes. The forms stage is the second stage of the pipeline. It divides the phonemes of the text into words.

The lexicon gives each cmavo the selma'o that Zantufa 1.9999 gives it. `tools/peg-lexicon.js` writes the rules below from the selma'o lists of `zantufa-1.9999.peg`. That file is in Guskant's `gerna_cipra` repository, as of commit d5a5065. The tool tags no class as an indicator here. A tag is a label on a word. A maintainer changes the lexicon by running the tool again.

Each alternative spells one word in the phonemes of the word grammar, as [lexicon-cll.md](lexicon-cll.md) explains. It also carries the selma'o of the word. Zantufa gives each word one selma'o, and its classes differ from those of CLL (*The Complete Lojban Language*) in many places. For example:

- Every tense word is BAI, `mo'i` and `fe'e` are NAhE, and the CAhA words, such as `ca'a` and `ka'e`, are NA.
- `je`, `ja`, `jo` and `ju` are JOI, because Zantufa has no JA.
- `la`, `lai` and `la'i` are LE, because Zantufa reads a name as a selbri.
- `ce'e` is BO, `nu'i` and `nu'u` are KE and KEhE, and `pe'e` is BAhE, because Zantufa has no termsets.
- `zei`, `ze'ei` and `si'u'i` are SI, so each erases a word, as `si` does.
- `sa`, `nai`, `cai`, `da'o`, `fu'e` and `fu'o` are UI, and `ie'o` is Y, as `y` is.
- `soi` is SEI, and `xoi` and `fi'oi` are XOI.

The lexicon tags no word `indicator`, because Zantufa reads an attitudinal as a free modifier, which can follow any word. So the indicator stage attaches no word to the word before it, and it only absorbs the words of BAhE. The syntax reads every word of UI.

[The notation document](../../docs/notation.md) explains the notation.

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

%rule lexicon-a
  | any-a <"A">
  | any-a /'/ any-a <"UI">
  | any-a /'/ any-e <"UI">
  | any-a /'/ any-i <"UI">
  | any-a /'/ any-o <"UI">
  | any-a /'/ any-o any-i <"COI">
  | any-a /'/ any-u <"UI">
  | any-a /'/ any-y <"BY">
  | any-a any-i <"UI">
  | any-a any-u <"UI">
  | any-a any-u /'/ any-u <"UI">

%rule lexicon-b
  | /b/ any-a <"BAI">
  | /b/ any-a /'/ any-a <"UI">
  | /b/ any-a /'/ any-a any-i <"MAI">
  | /b/ any-a /'/ any-a any-u <"BAI">
  | /b/ any-a /'/ any-e <"BAhE">
  | /b/ any-a /'/ any-e any-i <"BAhE">
  | /b/ any-a /'/ any-i <"BAI">
  | /b/ any-a /'/ any-o <"BAI">
  | /b/ any-a /'/ any-o any-i <"ROI">
  | /b/ any-a /'/ any-u <"UI">
  | /b/ any-a any-i <"BAI">
  | /b/ any-a any-i /'/ any-e any-i <"VUhU">
  | /b/ any-a any-i /'/ any-i <"VUhU">
  | /b/ any-a any-u <"BAI">
  | /b/ any-e <"BE">
  | /b/ any-e /'/ any-a <"BAI">
  | /b/ any-e /'/ any-a any-u <"BAI">
  | /b/ any-e /'/ any-e <"COI">
  | /b/ any-e /'/ any-e any-i <"BAI">
  | /b/ any-e /'/ any-e any-i /'/ any-o any-i <"VUhU">
  | /b/ any-e /'/ any-i <"BAI">
  | /b/ any-e /'/ any-o <"BEhO">
  | /b/ any-e /'/ any-u <"UI">
  | /b/ any-e any-i <"BEI">
  | /b/ any-i <"PA">
  | /b/ any-i /'/ any-a <"UI">
  | /b/ any-i /'/ any-a any-i <"NA">
  | /b/ any-i /'/ any-e <"BIhE">
  | /b/ any-i /'/ any-i <"JOI">
  | /b/ any-i /'/ any-o <"JOI">
  | /b/ any-i /'/ any-u <"UI">
  | /b/ any-i /'/ any-y <"BY">
  | /b/ any-o <"BO">
  | /b/ any-o /'/ any-a <"KOhA">
  | /b/ any-o /'/ any-a any-i <"LI">
  | /b/ any-o /'/ any-e <"KOhA">
  | /b/ any-o /'/ any-e any-i <"GOhOI">
  | /b/ any-o /'/ any-i <"KOhA">
  | /b/ any-o /'/ any-o <"KOhA">
  | /b/ any-o /'/ any-o any-i <"UI">
  | /b/ any-o /'/ any-u <"KOhA">
  | /b/ any-o any-i <"BOI">
  | /b/ any-o any-i /'/ any-a any-i <"VUhU">
  | /b/ any-o any-i /'/ any-a any-u <"MOhE">
  | /b/ any-u <"BU">
  | /b/ any-u /'/ any-a <"GOhA">
  | /b/ any-u /'/ any-a /'/ any-a <"UI">
  | /b/ any-u /'/ any-a any-i <"NU">
  | /b/ any-u /'/ any-e <"GOhA">
  | /b/ any-u /'/ any-i <"GOhA">
  | /b/ any-u /'/ any-o <"UI">
  | /b/ any-u /'/ any-o /'/ any-e <"BY">
  | /b/ any-u /'/ any-o any-i <"COI">
  | /b/ any-u /'/ any-u <"BAI">
  | /b/ any-y <"BY">

%rule lexicon-c
  | /c/ any-a <"BAI">
  | /c/ any-a /'/ any-a <"NA">
  | /c/ any-a /'/ any-a any-i <"UI">
  | /c/ any-a /'/ any-a any-u <"KOhA">
  | /c/ any-a /'/ any-e <"UI">
  | /c/ any-a /'/ any-i <"BAI">
  | /c/ any-a /'/ any-o <"BAI">
  | /c/ any-a /'/ any-u <"BAI">
  | /c/ any-a any-i <"UI">
  | /c/ any-a any-i /'/ any-e <"NAhE">
  | /c/ any-a any-u <"BAI">
  | /c/ any-a any-u /'/ any-a <"NA">
  | /c/ any-a any-u /'/ any-e <"NAhE">
  | /c/ any-a any-u /'/ any-i <"UI">
  | /c/ any-a any-u /'/ any-o /'/ any-e <"NAhE">
  | /c/ any-e <"JOI">
  | /c/ any-e /'/ any-a <"LAU">
  | /c/ any-e /'/ any-a any-i <"ZOhU">
  | /c/ any-e /'/ any-e <"BO">
  | /c/ any-e /'/ any-i <"VUhU">
  | /c/ any-e /'/ any-i /'/ any-y <"BY">
  | /c/ any-e /'/ any-o <"JOI">
  | /c/ any-e /'/ any-o any-i <"JOI">
  | /c/ any-e /'/ any-u <"KOhA">
  | /c/ any-e any-i <"CEI">
  | /c/ any-e any-i /'/ any-e <"SEI">
  | /c/ any-e any-i /'/ any-i <"GOhA">
  | /c/ any-i <"PA">
  | /c/ any-i /'/ any-a any-i <"UI">
  | /c/ any-i /'/ any-a any-i /'/ any-u <"VUhU">
  | /c/ any-i /'/ any-a any-u /'/ any-u /'/ any-a any-u /'/ any-i <"UI">
  | /c/ any-i /'/ any-e <"BAI">
  | /c/ any-i /'/ any-i <"PA">
  | /c/ any-i /'/ any-i /'/ any-y <"BY">
  | /c/ any-i /'/ any-o <"BAI">
  | /c/ any-i /'/ any-o any-i <"COI">
  | /c/ any-i /'/ any-u <"BAI">
  | /c/ any-i /'/ any-y <"BY">
  | /c/ any-o <"CO">
  | /c/ any-o /'/ any-a <"BAI">
  | /c/ any-o /'/ any-e <"GOhA">
  | /c/ any-o /'/ any-i <"BAI">
  | /c/ any-o /'/ any-o <"COI">
  | /c/ any-o /'/ any-o any-i <"COI">
  | /c/ any-o /'/ any-u <"BAI">
  | /c/ any-o any-i <"COI">
  | /c/ any-u <"CU">
  | /c/ any-u /'/ any-a <"VUhU">
  | /c/ any-u /'/ any-a any-i <"VUhU">
  | /c/ any-u /'/ any-a any-u /'/ any-e any-i <"VUhU">
  | /c/ any-u /'/ any-e <"BAI">
  | /c/ any-u /'/ any-e any-i <"UI">
  | /c/ any-u /'/ any-e any-i /'/ any-a <"UI">
  | /c/ any-u /'/ any-e any-i /'/ any-a any-i <"UI">
  | /c/ any-u /'/ any-e any-i /'/ any-e <"UI">
  | /c/ any-u /'/ any-e any-i /'/ any-e any-i <"UI">
  | /c/ any-u /'/ any-e any-i /'/ any-i <"UI">
  | /c/ any-u /'/ any-e any-i /'/ any-o <"UI">
  | /c/ any-u /'/ any-e any-i /'/ any-o any-i <"UI">
  | /c/ any-u /'/ any-e any-i /'/ any-u <"UI">
  | /c/ any-u /'/ any-i <"UI">
  | /c/ any-u /'/ any-o <"MOI">
  | /c/ any-u /'/ any-u <"BAI">
  | /c/ any-y <"BY">

%rule lexicon-d
  | /d/ any-a <"KOhA">
  | /d/ any-a /'/ any-a <"PA">
  | /d/ any-a /'/ any-a /'/ any-a any-u <"VUhU">
  | /d/ any-a /'/ any-a /'/ any-y <"BY">
  | /d/ any-a /'/ any-a any-i <"KOhA">
  | /d/ any-a /'/ any-a any-u <"KOhA">
  | /d/ any-a /'/ any-e <"KOhA">
  | /d/ any-a /'/ any-e any-i <"COI">
  | /d/ any-a /'/ any-i <"UI">
  | /d/ any-a /'/ any-o <"UI">
  | /d/ any-a /'/ any-o any-i <"COI">
  | /d/ any-a /'/ any-u <"KOhA">
  | /d/ any-a any-i <"UI">
  | /d/ any-a any-i /'/ any-i <"UI">
  | /d/ any-a any-i /'/ any-o <"UI">
  | /d/ any-a any-u <"PA">
  | /d/ any-a any-u /'/ any-a <"UI">
  | /d/ any-a any-u /'/ any-i <"UI">
  | /d/ any-a any-u /'/ any-y <"BY">
  | /d/ any-e <"KOhA">
  | /d/ any-e /'/ any-a <"BAI">
  | /d/ any-e /'/ any-a any-i <"UI">
  | /d/ any-e /'/ any-a any-u <"UI">
  | /d/ any-e /'/ any-a any-u /'/ any-u <"VUhU">
  | /d/ any-e /'/ any-e <"KOhA">
  | /d/ any-e /'/ any-e any-i <"ROI">
  | /d/ any-e /'/ any-i <"BAI">
  | /d/ any-e /'/ any-i /'/ any-a <"BAI">
  | /d/ any-e /'/ any-i /'/ any-e <"BAI">
  | /d/ any-e /'/ any-i /'/ any-i <"BAI">
  | /d/ any-e /'/ any-i /'/ any-o <"BAI">
  | /d/ any-e /'/ any-i /'/ any-u <"BAI">
  | /d/ any-e /'/ any-o <"VUhU">
  | /d/ any-e /'/ any-o any-i <"UI">
  | /d/ any-e /'/ any-u <"KOhA">
  | /d/ any-e any-i <"KOhA">
  | /d/ any-e any-i /'/ any-a <"BAI">
  | /d/ any-e any-i /'/ any-a any-u /'/ any-o <"VUhU">
  | /d/ any-e any-i /'/ any-e <"KOhA">
  | /d/ any-e any-i /'/ any-e any-i <"KOhA">
  | /d/ any-e any-i /'/ any-o <"KOhA">
  | /d/ any-e any-i /'/ any-u <"KOhA">
  | /d/ any-i <"KOhA">
  | /d/ any-i /'/ any-a <"BAI">
  | /d/ any-i /'/ any-a any-i <"COI">
  | /d/ any-i /'/ any-a any-u <"KOhA">
  | /d/ any-i /'/ any-e <"KOhA">
  | /d/ any-i /'/ any-e any-i <"KOhA">
  | /d/ any-i /'/ any-e any-i /'/ any-o /'/ any-a any-u <"VUhU">
  | /d/ any-i /'/ any-i <"BAI">
  | /d/ any-i /'/ any-o <"BAI">
  | /d/ any-i /'/ any-o any-i <"KOhA">
  | /d/ any-i /'/ any-u <"KOhA">
  | /d/ any-o <"KOhA">
  | /d/ any-o /'/ any-a <"UI">
  | /d/ any-o /'/ any-a any-i <"UI">
  | /d/ any-o /'/ any-e <"BAI">
  | /d/ any-o /'/ any-e any-i <"KOhA">
  | /d/ any-o /'/ any-i <"KOhA">
  | /d/ any-o /'/ any-o <"KOhA">
  | /d/ any-o /'/ any-u <"DOhU">
  | /d/ any-o any-i <"COI">
  | /d/ any-o any-i /'/ any-a <"UI">
  | /d/ any-o any-i /'/ any-o any-i <"COI">
  | /d/ any-u <"GOhA">
  | /d/ any-u /'/ any-a <"BAI">
  | /d/ any-u /'/ any-a any-u <"LAhE">
  | /d/ any-u /'/ any-e <"PA">
  | /d/ any-u /'/ any-e /'/ any-y <"BY">
  | /d/ any-u /'/ any-e any-i <"VUhU">
  | /d/ any-u /'/ any-i <"BAI">
  | /d/ any-u /'/ any-o <"BAI">
  | /d/ any-u /'/ any-o any-i <"BAI">
  | /d/ any-u /'/ any-u <"NU">
  | /d/ any-y <"BY">

%rule lexicon-e
  | any-e <"A">
  | any-e /'/ any-a <"UI">
  | any-e /'/ any-e <"UI">
  | any-e /'/ any-i <"UI">
  | any-e /'/ any-o <"UI">
  | any-e /'/ any-u <"UI">
  | any-e /'/ any-y <"BY">
  | any-e any-i <"UI">

%rule lexicon-f
  | /f/ any-a <"FA">
  | /f/ any-a /'/ any-a <"BAI">
  | /f/ any-a /'/ any-a any-i <"VUhU">
  | /f/ any-a /'/ any-a any-u <"VUhU">
  | /f/ any-a /'/ any-e <"BAI">
  | /f/ any-a /'/ any-i <"VUhU">
  | /f/ any-a /'/ any-o <"FAhO">
  | /f/ any-a /'/ any-u <"JOI">
  | /f/ any-a /'/ any-u /'/ any-a any-i <"JOI">
  | /f/ any-a any-i <"FA">
  | /f/ any-a any-i /'/ any-a <"UI">
  | /f/ any-a any-i /'/ any-e /'/ any-a any-i <"PA">
  | /f/ any-a any-i /'/ any-e /'/ any-a any-i /'/ any-y <"BY">
  | /f/ any-a any-i /'/ any-e /'/ any-a any-u <"PA">
  | /f/ any-a any-i /'/ any-e /'/ any-a any-u /'/ any-y <"BY">
  | /f/ any-a any-i /'/ any-u <"PA">
  | /f/ any-a any-i /'/ any-u /'/ any-a <"PA">
  | /f/ any-a any-i /'/ any-u /'/ any-a /'/ any-y <"BY">
  | /f/ any-a any-i /'/ any-u /'/ any-y <"BY">
  | /f/ any-a any-u <"BAI">
  | /f/ any-a any-u /'/ any-a any-u <"VUhU">
  | /f/ any-a any-u /'/ any-e <"XI">
  | /f/ any-a any-u /'/ any-u <"COI">
  | /f/ any-e <"FA">
  | /f/ any-e /'/ any-a <"VUhU">
  | /f/ any-e /'/ any-a any-u /'/ any-u <"VUhU">
  | /f/ any-e /'/ any-e <"NAhE">
  | /f/ any-e /'/ any-i <"VUhU">
  | /f/ any-e /'/ any-o <"COI">
  | /f/ any-e /'/ any-u <"FEhU">
  | /f/ any-e any-i <"PA">
  | /f/ any-e any-i /'/ any-u <"KE">
  | /f/ any-e any-i /'/ any-y <"BY">
  | /f/ any-i <"FA">
  | /f/ any-i /'/ any-a <"FA">
  | /f/ any-i /'/ any-e <"BAI">
  | /f/ any-i /'/ any-i <"COI">
  | /f/ any-i /'/ any-i /'/ any-e <"COI">
  | /f/ any-i /'/ any-o <"FIhO">
  | /f/ any-i /'/ any-o any-i <"XOI">
  | /f/ any-i /'/ any-u <"VUhU">
  | /f/ any-i /'/ any-u /'/ any-y <"BY">
  | /f/ any-o <"FA">
  | /f/ any-o /'/ any-a <"KOhA">
  | /f/ any-o /'/ any-e <"KOhA">
  | /f/ any-o /'/ any-i <"KOhA">
  | /f/ any-o /'/ any-o <"KOhA">
  | /f/ any-o /'/ any-u <"KOhA">
  | /f/ any-o any-i <"FOI">
  | /f/ any-u <"FA">
  | /f/ any-u /'/ any-a <"FUhA">
  | /f/ any-u /'/ any-a /'/ any-a any-i <"PA">
  | /f/ any-u /'/ any-a /'/ any-a any-i /'/ any-y <"BY">
  | /f/ any-u /'/ any-a /'/ any-a any-u <"PA">
  | /f/ any-u /'/ any-a /'/ any-a any-u /'/ any-y <"BY">
  | /f/ any-u /'/ any-a any-u <"UI">
  | /f/ any-u /'/ any-e <"UI">
  | /f/ any-u /'/ any-e any-i <"UI">
  | /f/ any-u /'/ any-e any-i /'/ any-a <"UI">
  | /f/ any-u /'/ any-e any-i /'/ any-e <"UI">
  | /f/ any-u /'/ any-e any-i /'/ any-i <"UI">
  | /f/ any-u /'/ any-e any-i /'/ any-o <"UI">
  | /f/ any-u /'/ any-e any-i /'/ any-u <"UI">
  | /f/ any-u /'/ any-i <"UI">
  | /f/ any-u /'/ any-o <"UI">
  | /f/ any-u /'/ any-u <"VUhU">
  | /f/ any-y <"BY">

%rule lexicon-g
  | /g/ any-a <"GA">
  | /g/ any-a /'/ any-a <"BAI">
  | /g/ any-a /'/ any-a any-u <"PA">
  | /g/ any-a /'/ any-a any-u /'/ any-y <"BY">
  | /g/ any-a /'/ any-e <"BY">
  | /g/ any-a /'/ any-i <"UI">
  | /g/ any-a /'/ any-o <"GAhO">
  | /g/ any-a /'/ any-u <"BAI">
  | /g/ any-a /'/ any-u /'/ any-a any-u <"VUhU">
  | /g/ any-a any-i <"PA">
  | /g/ any-a any-i /'/ any-i <"BAI">
  | /g/ any-a any-i /'/ any-o <"GOhA">
  | /g/ any-a any-i /'/ any-y <"BY">
  | /g/ any-a any-u <"BAI">
  | /g/ any-a any-u /'/ any-i /'/ any-o <"PA">
  | /g/ any-a any-u /'/ any-i /'/ any-o /'/ any-y <"BY">
  | /g/ any-e <"GA">
  | /g/ any-e /'/ any-a <"VUhU">
  | /g/ any-e /'/ any-a any-i <"ZOhU">
  | /g/ any-e /'/ any-e <"UI">
  | /g/ any-e /'/ any-e any-i <"UI">
  | /g/ any-e /'/ any-i <"GA">
  | /g/ any-e /'/ any-o <"BY">
  | /g/ any-e /'/ any-u <"GEhU">
  | /g/ any-e /'/ any-u /'/ any-i <"TOI">
  | /g/ any-e any-i <"VUhU">
  | /g/ any-i <"GI">
  | /g/ any-i /'/ any-a <"GIhA">
  | /g/ any-i /'/ any-e <"GIhA">
  | /g/ any-i /'/ any-i <"GIhI">
  | /g/ any-i /'/ any-o <"GIhA">
  | /g/ any-i /'/ any-u <"GIhA">
  | /g/ any-o <"GA">
  | /g/ any-o /'/ any-a <"GOhA">
  | /g/ any-o /'/ any-e <"GOhA">
  | /g/ any-o /'/ any-i <"GOhA">
  | /g/ any-o /'/ any-o <"GOhA">
  | /g/ any-o /'/ any-o /'/ any-i /'/ any-a <"PA">
  | /g/ any-o /'/ any-o /'/ any-i /'/ any-a /'/ any-y <"BY">
  | /g/ any-o /'/ any-o any-i <"GOhOI">
  | /g/ any-o /'/ any-u <"GOhA">
  | /g/ any-o any-i <"GOI">
  | /g/ any-o any-i /'/ any-e <"COI">
  | /g/ any-u <"GA">
  | /g/ any-u /'/ any-a <"GA">
  | /g/ any-u /'/ any-a any-i <"VUhU">
  | /g/ any-u /'/ any-a any-u <"BAI">
  | /g/ any-u /'/ any-a any-u /'/ any-i <"VUhU">
  | /g/ any-u /'/ any-e <"GA">
  | /g/ any-u /'/ any-i <"GA">
  | /g/ any-u /'/ any-o <"GA">
  | /g/ any-u /'/ any-u <"GA">
  | /g/ any-y <"BY">

%rule lexicon-i
  | any-i <"I">
  | any-i any-a <"UI">
  | any-i any-a /'/ any-u <"UI">
  | any-i any-a any-u <"IAU">
  | any-i any-e <"UI">
  | any-i any-e /'/ any-i <"UI">
  | any-i any-e /'/ any-o <"Y">
  | any-i /'/ any-a <"UI">
  | any-i /'/ any-a any-u <"IAU">
  | any-i /'/ any-e <"UI">
  | any-i /'/ any-i <"UI">
  | any-i /'/ any-o <"UI">
  | any-i /'/ any-u <"UI">
  | any-i /'/ any-y <"BY">
  | any-i any-i <"UI">
  | any-i any-o <"UI">
  | any-i any-u <"UI">
  | any-i any-y <"BY">
  | any-i any-y /'/ any-y <"BY">

%rule lexicon-j
  | /j/ any-a <"JOI">
  | /j/ any-a /'/ any-a <"NA">
  | /j/ any-a /'/ any-a any-i <"UI">
  | /j/ any-a /'/ any-e <"BAI">
  | /j/ any-a /'/ any-e any-i <"JAI">
  | /j/ any-a /'/ any-i <"BAI">
  | /j/ any-a /'/ any-o <"UI">
  | /j/ any-a /'/ any-o any-i <"VUhU">
  | /j/ any-a any-i <"JAI">
  | /j/ any-a any-u <"PA">
  | /j/ any-a any-u /'/ any-a any-u <"VUhU">
  | /j/ any-a any-u /'/ any-y <"BY">
  | /j/ any-e <"JOI">
  | /j/ any-e /'/ any-a <"NAhE">
  | /j/ any-e /'/ any-a any-i <"NAhE">
  | /j/ any-e /'/ any-a any-u <"UI">
  | /j/ any-e /'/ any-e <"COI">
  | /j/ any-e /'/ any-i <"JOI">
  | /j/ any-e /'/ any-o <"BY">
  | /j/ any-e /'/ any-u <"UI">
  | /j/ any-e any-i <"NU">
  | /j/ any-e any-i /'/ any-u <"UI">
  | /j/ any-i <"JOI">
  | /j/ any-i /'/ any-a <"UI">
  | /j/ any-i /'/ any-a any-u <"UI">
  | /j/ any-i /'/ any-e <"BAI">
  | /j/ any-i /'/ any-e any-i <"UI">
  | /j/ any-i /'/ any-i <"PA">
  | /j/ any-i /'/ any-i /'/ any-y <"BY">
  | /j/ any-i /'/ any-o <"BAI">
  | /j/ any-i /'/ any-o /'/ any-e <"JOI">
  | /j/ any-i /'/ any-u <"BAI">
  | /j/ any-o <"JOI">
  | /j/ any-o /'/ any-a <"UI">
  | /j/ any-o /'/ any-a any-i <"JAI">
  | /j/ any-o /'/ any-a any-u <"COI">
  | /j/ any-o /'/ any-a any-u /'/ any-o <"BY">
  | /j/ any-o /'/ any-e <"JOI">
  | /j/ any-o /'/ any-e any-i <"JOI">
  | /j/ any-o /'/ any-e any-i /'/ any-i <"JOI">
  | /j/ any-o /'/ any-i <"VUhU">
  | /j/ any-o /'/ any-o <"BY">
  | /j/ any-o /'/ any-u <"JOI">
  | /j/ any-o any-i <"JOI">
  | /j/ any-o any-i /'/ any-i <"VUhU">
  | /j/ any-u <"JOI">
  | /j/ any-u /'/ any-a <"UI">
  | /j/ any-u /'/ any-e <"JOI">
  | /j/ any-u /'/ any-i <"COI">
  | /j/ any-u /'/ any-o <"UI">
  | /j/ any-u /'/ any-o any-i <"UI">
  | /j/ any-u /'/ any-u <"VUhU">
  | /j/ any-y <"BY">

%rule lexicon-k
  | /k/ any-a <"NU">
  | /k/ any-a /'/ any-a <"BAI">
  | /k/ any-a /'/ any-a any-i <"BAI">
  | /k/ any-a /'/ any-a any-u <"VUhU">
  | /k/ any-a /'/ any-e <"NA">
  | /k/ any-a /'/ any-e any-i <"NU">
  | /k/ any-a /'/ any-e any-i /'/ any-a <"PA">
  | /k/ any-a /'/ any-e any-i /'/ any-a /'/ any-y <"BY">
  | /k/ any-a /'/ any-i <"BAI">
  | /k/ any-a /'/ any-o <"PA">
  | /k/ any-a /'/ any-o /'/ any-a any-i <"PA">
  | /k/ any-a /'/ any-o /'/ any-a any-i /'/ any-y <"BY">
  | /k/ any-a /'/ any-o /'/ any-e any-i <"VUhU">
  | /k/ any-a /'/ any-o /'/ any-y <"BY">
  | /k/ any-a /'/ any-u <"UI">
  | /k/ any-a any-i <"BAI">
  | /k/ any-a any-i /'/ any-a <"UI">
  | /k/ any-a any-i /'/ any-e <"UI">
  | /k/ any-a any-i /'/ any-e any-i <"NU">
  | /k/ any-a any-i /'/ any-o <"PA">
  | /k/ any-a any-i /'/ any-o /'/ any-y <"BY">
  | /k/ any-a any-i /'/ any-u <"NU">
  | /k/ any-a any-u <"UI">
  | /k/ any-a any-u /'/ any-a <"KOhA">
  | /k/ any-a any-u /'/ any-e <"KOhA">
  | /k/ any-a any-u /'/ any-i <"KOhA">
  | /k/ any-a any-u /'/ any-o <"PA">
  | /k/ any-a any-u /'/ any-o /'/ any-y <"BY">
  | /k/ any-e <"KE">
  | /k/ any-e /'/ any-a <"KOhA">
  | /k/ any-e /'/ any-a any-i <"KE">
  | /k/ any-e /'/ any-a any-u <"ZOhU">
  | /k/ any-e /'/ any-e <"KEhE">
  | /k/ any-e /'/ any-e /'/ any-u <"UI">
  | /k/ any-e /'/ any-e any-i <"KE">
  | /k/ any-e /'/ any-e any-i /'/ any-a <"KEhE">
  | /k/ any-e /'/ any-i <"GAhO">
  | /k/ any-e /'/ any-o <"COI">
  | /k/ any-e /'/ any-o any-i <"KE">
  | /k/ any-e /'/ any-u <"UI">
  | /k/ any-e any-i <"KEI">
  | /k/ any-e any-i /'/ any-a any-i <"PEhO">
  | /k/ any-e any-i /'/ any-a any-u <"VUhU">
  | /k/ any-e any-i /'/ any-i <"VUhU">
  | /k/ any-e any-i /'/ any-o <"PA">
  | /k/ any-e any-i /'/ any-o /'/ any-y <"BY">
  | /k/ any-i <"BAI">
  | /k/ any-i /'/ any-a <"UI">
  | /k/ any-i /'/ any-a /'/ any-a any-u /'/ any-u /'/ any-a any-u /'/ any-i <"UI">
  | /k/ any-i /'/ any-a any-i <"COI">
  | /k/ any-i /'/ any-e <"COI">
  | /k/ any-i /'/ any-i <"BAI">
  | /k/ any-i /'/ any-o <"PA">
  | /k/ any-i /'/ any-o /'/ any-y <"BY">
  | /k/ any-i /'/ any-o any-i <"BAI">
  | /k/ any-i /'/ any-u <"BAI">
  | /k/ any-o <"KOhA">
  | /k/ any-o /'/ any-a <"KOhA">
  | /k/ any-o /'/ any-a any-u <"BAI">
  | /k/ any-o /'/ any-e <"KOhA">
  | /k/ any-o /'/ any-i <"KOhA">
  | /k/ any-o /'/ any-o <"KOhA">
  | /k/ any-o /'/ any-o any-i <"UI">
  | /k/ any-o /'/ any-u <"KOhA">
  | /k/ any-o any-i <"BAI">
  | /k/ any-o any-i /'/ any-e <"UI">
  | /k/ any-o any-i /'/ any-o <"PA">
  | /k/ any-o any-i /'/ any-o /'/ any-y <"BY">
  | /k/ any-u <"KU">
  | /k/ any-u /'/ any-a <"JOI">
  | /k/ any-u /'/ any-a any-u <"KUhAU">
  | /k/ any-u /'/ any-a any-u /'/ any-a <"VUhU">
  | /k/ any-u /'/ any-e <"KUhE">
  | /k/ any-u /'/ any-i <"UI">
  | /k/ any-u /'/ any-o <"KUhO">
  | /k/ any-u /'/ any-o any-i /'/ any-u <"TEhU">
  | /k/ any-u /'/ any-u <"BAI">
  | /k/ any-y <"BY">

%rule lexicon-l
  | /l/ any-a <"LE">
  | /l/ any-a /'/ any-a <"UI">
  | /l/ any-a /'/ any-a any-i <"LOhU">
  | /l/ any-a /'/ any-a any-u <"LU">
  | /l/ any-a /'/ any-e <"LAhE">
  | /l/ any-a /'/ any-e /'/ any-a any-u <"LAhE">
  | /l/ any-a /'/ any-e any-i <"LE">
  | /l/ any-a /'/ any-i <"LE">
  | /l/ any-a /'/ any-o <"ZOI">
  | /l/ any-a /'/ any-u <"BAI">
  | /l/ any-a any-i <"LE">
  | /l/ any-a any-i /'/ any-e <"LAhE">
  | /l/ any-a any-i /'/ any-i <"UI">
  | /l/ any-a any-u <"LAU">
  | /l/ any-a any-u /'/ any-e <"KOhA">
  | /l/ any-a any-u /'/ any-i <"UI">
  | /l/ any-a any-u /'/ any-u <"KOhA">
  | /l/ any-e <"LE">
  | /l/ any-e /'/ any-a <"BAI">
  | /l/ any-e /'/ any-a any-i <"LEhAI">
  | /l/ any-e /'/ any-a any-u <"SEI">
  | /l/ any-e /'/ any-e <"LE">
  | /l/ any-e /'/ any-e any-i <"LE">
  | /l/ any-e /'/ any-i <"LE">
  | /l/ any-e /'/ any-o <"UI">
  | /l/ any-e /'/ any-u <"LEhU">
  | /l/ any-e any-i <"LE">
  | /l/ any-e any-i /'/ any-e <"LE">
  | /l/ any-e any-i /'/ any-i <"LE">
  | /l/ any-i <"LI">
  | /l/ any-i /'/ any-a <"UI">
  | /l/ any-i /'/ any-a any-i <"LI">
  | /l/ any-i /'/ any-a any-u <"LIhAU">
  | /l/ any-i /'/ any-e <"BAI">
  | /l/ any-i /'/ any-e any-i <"LI">
  | /l/ any-i /'/ any-i <"NU">
  | /l/ any-i /'/ any-i /'/ any-e <"BAI">
  | /l/ any-i /'/ any-o <"UI">
  | /l/ any-i /'/ any-o any-i <"UI">
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
  | /l/ any-o any-i /'/ any-e <"LE">
  | /l/ any-o any-i /'/ any-i <"LE">
  | /l/ any-u <"LU">
  | /l/ any-u /'/ any-a <"LAhE">
  | /l/ any-u /'/ any-a any-u <"LAhE">
  | /l/ any-u /'/ any-e <"LAhE">
  | /l/ any-u /'/ any-e any-i <"LUhEI">
  | /l/ any-u /'/ any-i <"LAhE">
  | /l/ any-u /'/ any-o <"LAhE">
  | /l/ any-u /'/ any-u <"LUhU">
  | /l/ any-y <"BY">

%rule lexicon-m
  | /m/ any-a <"KOhA">
  | /m/ any-a /'/ any-a <"KOhA">
  | /m/ any-a /'/ any-e <"BAI">
  | /m/ any-a /'/ any-i <"BAI">
  | /m/ any-a /'/ any-o <"MAhO">
  | /m/ any-a /'/ any-o /'/ any-e <"VUhU">
  | /m/ any-a /'/ any-o any-i <"ZO">
  | /m/ any-a /'/ any-u <"VUhU">
  | /m/ any-a /'/ any-u /'/ any-y <"BY">
  | /m/ any-a any-i <"MAI">
  | /m/ any-a any-i /'/ any-e /'/ any-e <"PA">
  | /m/ any-a any-i /'/ any-e /'/ any-e /'/ any-y <"BY">
  | /m/ any-a any-i /'/ any-i <"KOhA">
  | /m/ any-a any-i /'/ any-o <"LI">
  | /m/ any-a any-u <"BAI">
  | /m/ any-a any-u /'/ any-a <"LOhOI">
  | /m/ any-a any-u /'/ any-e <"TO">
  | /m/ any-a any-u /'/ any-i <"UI">
  | /m/ any-a any-u /'/ any-o <"TOI">
  | /m/ any-a any-u /'/ any-u <"UI">
  | /m/ any-e <"ME">
  | /m/ any-e /'/ any-a <"BAI">
  | /m/ any-e /'/ any-a any-i <"UI">
  | /m/ any-e /'/ any-a any-u <"ME">
  | /m/ any-e /'/ any-e <"BAI">
  | /m/ any-e /'/ any-e any-i <"LE">
  | /m/ any-e /'/ any-e any-i /'/ any-o <"VUhU">
  | /m/ any-e /'/ any-i <"VUhU">
  | /m/ any-e /'/ any-i /'/ any-y <"BY">
  | /m/ any-e /'/ any-o <"LI">
  | /m/ any-e /'/ any-u <"MEhU">
  | /m/ any-e any-i <"MOI">
  | /m/ any-i <"KOhA">
  | /m/ any-i /'/ any-a <"KOhA">
  | /m/ any-i /'/ any-a any-i <"KOhA">
  | /m/ any-i /'/ any-e <"COI">
  | /m/ any-i /'/ any-i <"JOI">
  | /m/ any-i /'/ any-o <"KOhA">
  | /m/ any-i /'/ any-o any-i <"KOhA">
  | /m/ any-i /'/ any-u <"UI">
  | /m/ any-o <"GOhA">
  | /m/ any-o /'/ any-a <"PA">
  | /m/ any-o /'/ any-a /'/ any-y <"BY">
  | /m/ any-o /'/ any-e <"MOhE">
  | /m/ any-o /'/ any-i <"NAhE">
  | /m/ any-o /'/ any-o <"MAI">
  | /m/ any-o /'/ any-o any-i <"LE">
  | /m/ any-o /'/ any-u <"BAI">
  | /m/ any-o any-i <"MOI">
  | /m/ any-o any-i /'/ any-a <"LAhE">
  | /m/ any-o any-i /'/ any-i <"UI">
  | /m/ any-o any-i /'/ any-o <"MOI">
  | /m/ any-o any-i /'/ any-o any-i <"LE">
  | /m/ any-u <"PA">
  | /m/ any-u /'/ any-a <"UI">
  | /m/ any-u /'/ any-a any-i <"BAI">
  | /m/ any-u /'/ any-e <"NU">
  | /m/ any-u /'/ any-e any-i <"ROI">
  | /m/ any-u /'/ any-i <"BAI">
  | /m/ any-u /'/ any-i /'/ any-a any-i <"PA">
  | /m/ any-u /'/ any-i /'/ any-a any-i /'/ any-y <"BY">
  | /m/ any-u /'/ any-o <"COI">
  | /m/ any-u /'/ any-o any-i <"MUhOI">
  | /m/ any-u /'/ any-u <"BAI">
  | /m/ any-u /'/ any-y <"BY">
  | /m/ any-y <"BY">

%rule lexicon-n
  | /n/ any-a <"NA">
  | /n/ any-a /'/ any-a <"BY">
  | /n/ any-a /'/ any-e <"NAhE">
  | /n/ any-a /'/ any-e any-i <"NAhE">
  | /n/ any-a /'/ any-i <"UI">
  | /n/ any-a /'/ any-o <"BAI">
  | /n/ any-a /'/ any-o any-i <"UI">
  | /n/ any-a /'/ any-u <"MAhO">
  | /n/ any-a any-i <"UI">
  | /n/ any-a any-u <"BAI">
  | /n/ any-a any-u /'/ any-u <"KOhA">
  | /n/ any-e <"GOI">
  | /n/ any-e /'/ any-a <"BAI">
  | /n/ any-e /'/ any-a any-u <"UI">
  | /n/ any-e /'/ any-e <"UI">
  | /n/ any-e /'/ any-i <"BAI">
  | /n/ any-e /'/ any-o <"VUhU">
  | /n/ any-e /'/ any-o any-i <"VUhU">
  | /n/ any-e /'/ any-u <"BAI">
  | /n/ any-e any-i <"GOhA">
  | /n/ any-e any-i /'/ any-o <"KOhA">
  | /n/ any-i <"NU">
  | /n/ any-i /'/ any-a <"BAI">
  | /n/ any-i /'/ any-a /'/ any-a any-u <"VUhU">
  | /n/ any-i /'/ any-a any-i <"NU">
  | /n/ any-i /'/ any-a any-u <"UI">
  | /n/ any-i /'/ any-e <"MOhE">
  | /n/ any-i /'/ any-e /'/ any-e any-i <"PA">
  | /n/ any-i /'/ any-e /'/ any-e any-i /'/ any-y <"BY">
  | /n/ any-i /'/ any-e /'/ any-o any-i <"PA">
  | /n/ any-i /'/ any-e /'/ any-o any-i /'/ any-y <"BY">
  | /n/ any-i /'/ any-i <"BAI">
  | /n/ any-i /'/ any-o <"NIhO">
  | /n/ any-i /'/ any-u <"VUhU">
  | /n/ any-i /'/ any-u /'/ any-y <"BY">
  | /n/ any-o <"PA">
  | /n/ any-o /'/ any-a <"GOhA">
  | /n/ any-o /'/ any-a any-i <"PA">
  | /n/ any-o /'/ any-a any-i /'/ any-y <"BY">
  | /n/ any-o /'/ any-e <"NAhE">
  | /n/ any-o /'/ any-e /'/ any-u <"PA">
  | /n/ any-o /'/ any-e /'/ any-u /'/ any-y <"BY">
  | /n/ any-o /'/ any-i <"NIhO">
  | /n/ any-o /'/ any-o <"PA">
  | /n/ any-o /'/ any-o /'/ any-y <"BY">
  | /n/ any-o /'/ any-o any-i <"NOI">
  | /n/ any-o /'/ any-u <"GOI">
  | /n/ any-o /'/ any-y <"BY">
  | /n/ any-o any-i <"NOI">
  | /n/ any-o any-i /'/ any-a <"POIhA">
  | /n/ any-o any-i /'/ any-e <"NAhE">
  | /n/ any-o any-i /'/ any-i <"TO">
  | /n/ any-o any-i /'/ any-o /'/ any-a <"POIhA">
  | /n/ any-u <"NU">
  | /n/ any-u /'/ any-a <"ME">
  | /n/ any-u /'/ any-e <"COI">
  | /n/ any-u /'/ any-i <"KE">
  | /n/ any-u /'/ any-o <"NA">
  | /n/ any-u /'/ any-o any-i <"UI">
  | /n/ any-u /'/ any-u <"KEhE">
  | /n/ any-y <"BY">

%rule lexicon-o
  | any-o <"A">
  | any-o /'/ any-a <"UI">
  | any-o /'/ any-a any-i <"COI">
  | any-o /'/ any-e <"UI">
  | any-o /'/ any-i <"UI">
  | any-o /'/ any-o <"UI">
  | any-o /'/ any-u <"UI">
  | any-o /'/ any-y <"BY">
  | any-o any-i <"UI">
  | any-o any-i /'/ any-a <"UI">
  | any-o any-i /'/ any-o <"UI">
  | any-o any-i /'/ any-u <"UI">

%rule lexicon-p
  | /p/ any-a <"PA">
  | /p/ any-a /'/ any-a <"BAI">
  | /p/ any-a /'/ any-a any-u /'/ any-o <"PA">
  | /p/ any-a /'/ any-a any-u /'/ any-o /'/ any-y <"BY">
  | /p/ any-a /'/ any-e <"UI">
  | /p/ any-a /'/ any-i <"VUhU">
  | /p/ any-a /'/ any-o <"BAI">
  | /p/ any-a /'/ any-u <"BAI">
  | /p/ any-a /'/ any-y <"BY">
  | /p/ any-a any-i <"PA">
  | /p/ any-a any-i /'/ any-e <"NAhE">
  | /p/ any-a any-i /'/ any-y <"BY">
  | /p/ any-a any-u <"UI">
  | /p/ any-a any-u /'/ any-a /'/ any-u <"VUhU">
  | /p/ any-a any-u /'/ any-e any-i <"VUhU">
  | /p/ any-a any-u /'/ any-o any-i <"VUhU">
  | /p/ any-e <"GOI">
  | /p/ any-e /'/ any-a <"UI">
  | /p/ any-e /'/ any-a any-i <"UI">
  | /p/ any-e /'/ any-e <"BAhE">
  | /p/ any-e /'/ any-i <"UI">
  | /p/ any-e /'/ any-o <"PEhO">
  | /p/ any-e /'/ any-u <"COI">
  | /p/ any-e any-i <"UI">
  | /p/ any-e any-i /'/ any-a <"UI">
  | /p/ any-e any-i /'/ any-e <"UI">
  | /p/ any-e any-i /'/ any-i /'/ any-a <"PA">
  | /p/ any-e any-i /'/ any-i /'/ any-a /'/ any-y <"BY">
  | /p/ any-e any-i /'/ any-o <"UI">
  | /p/ any-i <"PA">
  | /p/ any-i /'/ any-a <"VUhU">
  | /p/ any-i /'/ any-a any-i <"KE">
  | /p/ any-i /'/ any-e <"VUhU">
  | /p/ any-i /'/ any-e any-i /'/ any-a any-u <"VUhU">
  | /p/ any-i /'/ any-e any-i /'/ any-o any-i <"VUhU">
  | /p/ any-i /'/ any-i <"VUhU">
  | /p/ any-i /'/ any-o <"BAI">
  | /p/ any-i /'/ any-u <"JOI">
  | /p/ any-i /'/ any-y <"BY">
  | /p/ any-o <"GOI">
  | /p/ any-o /'/ any-a <"BAI">
  | /p/ any-o /'/ any-e <"GOI">
  | /p/ any-o /'/ any-i <"BAI">
  | /p/ any-o /'/ any-o <"UI">
  | /p/ any-o /'/ any-o any-i <"NOI">
  | /p/ any-o /'/ any-u <"GOI">
  | /p/ any-o any-i <"NOI">
  | /p/ any-o any-i /'/ any-a <"POIhA">
  | /p/ any-o any-i /'/ any-i <"NU">
  | /p/ any-o any-i /'/ any-o /'/ any-a <"POIhA">
  | /p/ any-u <"BAI">
  | /p/ any-u /'/ any-a <"BAI">
  | /p/ any-u /'/ any-a any-i <"BAI">
  | /p/ any-u /'/ any-a any-u <"BAI">
  | /p/ any-u /'/ any-e <"BAI">
  | /p/ any-u /'/ any-e /'/ any-u /'/ any-o <"PA">
  | /p/ any-u /'/ any-e /'/ any-u /'/ any-o /'/ any-y <"BY">
  | /p/ any-u /'/ any-e any-i <"UI">
  | /p/ any-u /'/ any-i <"NA">
  | /p/ any-u /'/ any-o <"BAI">
  | /p/ any-u /'/ any-u <"NU">
  | /p/ any-y <"BY">

%rule lexicon-r
  | /r/ any-a <"KOhA">
  | /r/ any-a /'/ any-a <"BAI">
  | /r/ any-a /'/ any-a any-i <"ZO">
  | /r/ any-a /'/ any-e <"PA">
  | /r/ any-a /'/ any-e /'/ any-y <"BY">
  | /r/ any-a /'/ any-i <"BAI">
  | /r/ any-a /'/ any-i /'/ any-a any-u <"UI">
  | /r/ any-a /'/ any-o <"UI">
  | /r/ any-a /'/ any-o any-i <"RAhOI">
  | /r/ any-a /'/ any-u <"UI">
  | /r/ any-a any-i <"BAI">
  | /r/ any-a any-u <"PA">
  | /r/ any-a any-u /'/ any-y <"BY">
  | /r/ any-e <"PA">
  | /r/ any-e /'/ any-a <"VUhU">
  | /r/ any-e /'/ any-a any-u /'/ any-e <"SE">
  | /r/ any-e /'/ any-e <"UI">
  | /r/ any-e /'/ any-i <"COI">
  | /r/ any-e /'/ any-o <"BAI">
  | /r/ any-e /'/ any-u <"ROI">
  | /r/ any-e /'/ any-y <"BY">
  | /r/ any-e any-i <"PA">
  | /r/ any-e any-i /'/ any-e <"NAhE">
  | /r/ any-e any-i /'/ any-y <"BY">
  | /r/ any-i <"KOhA">
  | /r/ any-i /'/ any-a <"BAI">
  | /r/ any-i /'/ any-a any-u <"KOhA">
  | /r/ any-i /'/ any-e <"UI">
  | /r/ any-i /'/ any-i <"BAI">
  | /r/ any-i /'/ any-o <"VUhU">
  | /r/ any-i /'/ any-o any-i <"LE">
  | /r/ any-i /'/ any-u <"BAI">
  | /r/ any-o <"PA">
  | /r/ any-o /'/ any-a <"UI">
  | /r/ any-o /'/ any-a any-u /'/ any-o <"BY">
  | /r/ any-o /'/ any-e <"UI">
  | /r/ any-o /'/ any-i <"UI">
  | /r/ any-o /'/ any-o <"UI">
  | /r/ any-o /'/ any-o any-i <"PA">
  | /r/ any-o /'/ any-o any-i /'/ any-y <"BY">
  | /r/ any-o /'/ any-u <"UI">
  | /r/ any-o /'/ any-y <"BY">
  | /r/ any-o any-i <"ROI">
  | /r/ any-u <"KOhA">
  | /r/ any-u /'/ any-a <"UI">
  | /r/ any-u /'/ any-e <"UI">
  | /r/ any-u /'/ any-i <"BAI">
  | /r/ any-u /'/ any-o <"BY">
  | /r/ any-u /'/ any-u <"BAI">
  | /r/ any-y <"BY">

%rule lexicon-s
  | /s/ any-a <"UI">
  | /s/ any-a /'/ any-a <"UI">
  | /s/ any-a /'/ any-a any-i <"LOhAI">
  | /s/ any-a /'/ any-e <"UI">
  | /s/ any-a /'/ any-e any-i <"COI">
  | /s/ any-a /'/ any-i <"VUhU">
  | /s/ any-a /'/ any-o <"VUhU">
  | /s/ any-a /'/ any-u <"UI">
  | /s/ any-a any-i <"UI">
  | /s/ any-a any-i /'/ any-e <"NAhE">
  | /s/ any-a any-u <"BAI">
  | /s/ any-a any-u /'/ any-e any-i <"COI">
  | /s/ any-e <"SE">
  | /s/ any-e /'/ any-a <"UI">
  | /s/ any-e /'/ any-e <"BY">
  | /s/ any-e /'/ any-i <"UI">
  | /s/ any-e /'/ any-i /'/ any-a /'/ any-o <"VUhU">
  | /s/ any-e /'/ any-i /'/ any-i <"PA">
  | /s/ any-e /'/ any-i /'/ any-i /'/ any-y <"BY">
  | /s/ any-e /'/ any-o <"UI">
  | /s/ any-e /'/ any-o /'/ any-e <"SE">
  | /s/ any-e /'/ any-u <"SEhU">
  | /s/ any-e /'/ any-u /'/ any-o <"SE">
  | /s/ any-e any-i <"SEI">
  | /s/ any-e any-i /'/ any-i <"UI">
  | /s/ any-e any-i /'/ any-u /'/ any-e <"PA">
  | /s/ any-e any-i /'/ any-u /'/ any-e /'/ any-y <"BY">
  | /s/ any-i <"SI">
  | /s/ any-i /'/ any-a <"UI">
  | /s/ any-i /'/ any-a any-u <"UI">
  | /s/ any-i /'/ any-e <"MOI">
  | /s/ any-i /'/ any-i <"VUhU">
  | /s/ any-i /'/ any-o <"NU">
  | /s/ any-i /'/ any-o any-i /'/ any-e <"VUhU">
  | /s/ any-i /'/ any-u <"BAI">
  | /s/ any-i /'/ any-u /'/ any-i <"SI">
  | /s/ any-o <"PA">
  | /s/ any-o /'/ any-a <"PA">
  | /s/ any-o /'/ any-a /'/ any-y <"BY">
  | /s/ any-o /'/ any-e <"PA">
  | /s/ any-o /'/ any-e /'/ any-y <"BY">
  | /s/ any-o /'/ any-i <"PA">
  | /s/ any-o /'/ any-i /'/ any-y <"BY">
  | /s/ any-o /'/ any-o <"PA">
  | /s/ any-o /'/ any-o /'/ any-y <"BY">
  | /s/ any-o /'/ any-u <"PA">
  | /s/ any-o /'/ any-u /'/ any-y <"BY">
  | /s/ any-o /'/ any-y <"BY">
  | /s/ any-o any-i <"SEI">
  | /s/ any-o any-i /'/ any-a <"POIhA">
  | /s/ any-o any-i /'/ any-u <"PA">
  | /s/ any-o any-i /'/ any-u /'/ any-y <"BY">
  | /s/ any-u <"SU">
  | /s/ any-u /'/ any-a <"UI">
  | /s/ any-u /'/ any-a any-i <"PA">
  | /s/ any-u /'/ any-a any-i /'/ any-y <"BY">
  | /s/ any-u /'/ any-a any-u <"PA">
  | /s/ any-u /'/ any-a any-u /'/ any-y <"BY">
  | /s/ any-u /'/ any-e <"PA">
  | /s/ any-u /'/ any-e /'/ any-y <"BY">
  | /s/ any-u /'/ any-e any-i <"SE">
  | /s/ any-u /'/ any-i <"VUhU">
  | /s/ any-u /'/ any-o <"PA">
  | /s/ any-u /'/ any-o /'/ any-y <"BY">
  | /s/ any-u /'/ any-o any-i <"PA">
  | /s/ any-u /'/ any-o any-i /'/ any-y <"BY">
  | /s/ any-u /'/ any-u <"NU">
  | /s/ any-y <"BY">

%rule lexicon-t
  | /t/ any-a <"KOhA">
  | /t/ any-a /'/ any-a <"COI">
  | /t/ any-a /'/ any-a any-i <"GOhOI">
  | /t/ any-a /'/ any-e <"BAI">
  | /t/ any-a /'/ any-e any-i <"UI">
  | /t/ any-a /'/ any-i <"BAI">
  | /t/ any-a /'/ any-o <"UI">
  | /t/ any-a /'/ any-o any-i <"UI">
  | /t/ any-a /'/ any-u <"UI">
  | /t/ any-a any-i <"BAI">
  | /t/ any-a any-i /'/ any-e /'/ any-i <"VUhU">
  | /t/ any-a any-i /'/ any-i <"COI">
  | /t/ any-a any-i /'/ any-i /'/ any-e <"VUhU">
  | /t/ any-a any-u <"LAU">
  | /t/ any-a any-u /'/ any-e <"LAhE">
  | /t/ any-a any-u /'/ any-o <"SE">
  | /t/ any-a any-u /'/ any-u <"PA">
  | /t/ any-a any-u /'/ any-u /'/ any-y <"BY">
  | /t/ any-e <"SE">
  | /t/ any-e /'/ any-a <"VUhU">
  | /t/ any-e /'/ any-a any-i <"XI">
  | /t/ any-e /'/ any-a any-u <"VUhU">
  | /t/ any-e /'/ any-a any-u /'/ any-u <"VUhU">
  | /t/ any-e /'/ any-e <"BAI">
  | /t/ any-e /'/ any-i <"BAI">
  | /t/ any-e /'/ any-i /'/ any-o <"UI">
  | /t/ any-e /'/ any-o <"PA">
  | /t/ any-e /'/ any-o /'/ any-y <"BY">
  | /t/ any-e /'/ any-o any-i /'/ any-o any-i <"KUhE">
  | /t/ any-e /'/ any-u <"TEhU">
  | /t/ any-e any-i <"TEI">
  | /t/ any-e any-i /'/ any-u <"KUhE">
  | /t/ any-i <"KOhA">
  | /t/ any-i /'/ any-a <"BAI">
  | /t/ any-i /'/ any-e <"UI">
  | /t/ any-i /'/ any-i <"BAI">
  | /t/ any-i /'/ any-o <"SEI">
  | /t/ any-i /'/ any-u <"BAI">
  | /t/ any-i /'/ any-u /'/ any-a <"BAI">
  | /t/ any-i /'/ any-u /'/ any-e <"BAI">
  | /t/ any-i /'/ any-u /'/ any-i <"BAI">
  | /t/ any-o <"TO">
  | /t/ any-o /'/ any-a <"BY">
  | /t/ any-o /'/ any-a any-i <"SE">
  | /t/ any-o /'/ any-e <"NAhE">
  | /t/ any-o /'/ any-e any-i /'/ any-a any-u <"VUhU">
  | /t/ any-o /'/ any-i <"TO">
  | /t/ any-o /'/ any-o <"BAI">
  | /t/ any-o /'/ any-u <"UI">
  | /t/ any-o any-i <"TOI">
  | /t/ any-o any-i /'/ any-e <"UI">
  | /t/ any-o any-i /'/ any-o <"UI">
  | /t/ any-u <"KOhA">
  | /t/ any-u /'/ any-a <"LAhE">
  | /t/ any-u /'/ any-a any-i <"LU">
  | /t/ any-u /'/ any-e <"TUhE">
  | /t/ any-u /'/ any-i <"BAI">
  | /t/ any-u /'/ any-o <"PA">
  | /t/ any-u /'/ any-o /'/ any-y <"BY">
  | /t/ any-u /'/ any-o any-i <"KOhA">
  | /t/ any-u /'/ any-u <"TUhU">
  | /t/ any-y <"BY">

%rule lexicon-u
  | any-u <"A">
  | any-u any-a <"UI">
  | any-u any-a any-i <"UI">
  | any-u any-a any-u <"UI">
  | any-u any-e <"UI">
  | any-u any-e /'/ any-i <"UI">
  | any-u any-e any-i /'/ any-e <"UI">
  | any-u /'/ any-a <"UI">
  | any-u /'/ any-a any-i <"UI">
  | any-u /'/ any-e <"UI">
  | any-u /'/ any-i <"UI">
  | any-u /'/ any-o <"UI">
  | any-u /'/ any-u <"UI">
  | any-u /'/ any-y <"BY">
  | any-u any-i <"UI">
  | any-u any-i /'/ any-y <"BY">
  | any-u any-o <"UI">
  | any-u any-u <"UI">
  | any-u any-y <"BY">

%rule lexicon-v
  | /v/ any-a <"BAI">
  | /v/ any-a /'/ any-a <"VUhU">
  | /v/ any-a /'/ any-e <"MOI">
  | /v/ any-a /'/ any-e any-i <"ROI">
  | /v/ any-a /'/ any-e any-i /'/ any-a <"PA">
  | /v/ any-a /'/ any-e any-i /'/ any-a /'/ any-y <"BY">
  | /v/ any-a /'/ any-i <"UI">
  | /v/ any-a /'/ any-o <"BAI">
  | /v/ any-a /'/ any-u <"BAI">
  | /v/ any-a any-i <"PA">
  | /v/ any-a any-i /'/ any-y <"BY">
  | /v/ any-a any-u <"VAU">
  | /v/ any-a any-u /'/ any-a any-u /'/ any-o <"PA">
  | /v/ any-a any-u /'/ any-a any-u /'/ any-o /'/ any-y <"BY">
  | /v/ any-e <"SE">
  | /v/ any-e /'/ any-a <"BAI">
  | /v/ any-e /'/ any-e <"BAI">
  | /v/ any-e /'/ any-i <"BAI">
  | /v/ any-e /'/ any-o <"VEhO">
  | /v/ any-e /'/ any-u <"BAI">
  | /v/ any-e any-i <"VEI">
  | /v/ any-e any-i /'/ any-i <"UI">
  | /v/ any-i <"BAI">
  | /v/ any-i /'/ any-a <"BAI">
  | /v/ any-i /'/ any-e <"BAI">
  | /v/ any-i /'/ any-e any-i /'/ any-e <"PA">
  | /v/ any-i /'/ any-e any-i /'/ any-e /'/ any-y <"BY">
  | /v/ any-i /'/ any-i <"BAI">
  | /v/ any-i /'/ any-o <"COI">
  | /v/ any-i /'/ any-o any-i /'/ any-a any-u <"VUhU">
  | /v/ any-i /'/ any-u <"BAI">
  | /v/ any-o <"PA">
  | /v/ any-o /'/ any-a <"KOhA">
  | /v/ any-o /'/ any-a any-i <"SE">
  | /v/ any-o /'/ any-a any-u /'/ any-u <"VUhU">
  | /v/ any-o /'/ any-e <"KOhA">
  | /v/ any-o /'/ any-e any-i /'/ any-a <"PA">
  | /v/ any-o /'/ any-e any-i /'/ any-a /'/ any-y <"BY">
  | /v/ any-o /'/ any-i <"KOhA">
  | /v/ any-o /'/ any-o <"KOhA">
  | /v/ any-o /'/ any-u <"KOhA">
  | /v/ any-o /'/ any-y <"BY">
  | /v/ any-o any-i <"NOI">
  | /v/ any-o any-i /'/ any-e <"GOI">
  | /v/ any-o any-i /'/ any-i <"NOI">
  | /v/ any-u <"BAI">
  | /v/ any-u /'/ any-a <"BAI">
  | /v/ any-u /'/ any-e <"UI">
  | /v/ any-u /'/ any-i <"LAhE">
  | /v/ any-u /'/ any-o <"VUhO">
  | /v/ any-u /'/ any-u <"VUhU">
  | /v/ any-y <"BY">

%rule lexicon-x
  | /x/ any-a <"PA">
  | /x/ any-a /'/ any-a <"UI">
  | /x/ any-a /'/ any-a /'/ any-a <"UI">
  | /x/ any-a /'/ any-i <"UI">
  | /x/ any-a /'/ any-o <"BAI">
  | /x/ any-a /'/ any-y <"BY">
  | /x/ any-a any-i <"KOhA">
  | /x/ any-a any-i /'/ any-a <"UI">
  | /x/ any-a any-u <"BAI">
  | /x/ any-a any-u /'/ any-a <"LOhOI">
  | /x/ any-a any-u /'/ any-e /'/ any-o <"UI">
  | /x/ any-a any-u /'/ any-o /'/ any-o <"UI">
  | /x/ any-e <"SE">
  | /x/ any-e /'/ any-a any-u <"SEhU">
  | /x/ any-e /'/ any-e <"PA">
  | /x/ any-e /'/ any-e /'/ any-y <"BY">
  | /x/ any-e /'/ any-u <"GOhA">
  | /x/ any-e any-i <"PA">
  | /x/ any-e any-i /'/ any-y <"BY">
  | /x/ any-i <"XI">
  | /x/ any-i /'/ any-e <"XI">
  | /x/ any-i /'/ any-i <"XI">
  | /x/ any-i /'/ any-i /'/ any-e any-i <"PA">
  | /x/ any-i /'/ any-i /'/ any-e any-i /'/ any-y <"BY">
  | /x/ any-o <"PA">
  | /x/ any-o /'/ any-a any-i <"SE">
  | /x/ any-o /'/ any-e <"PA">
  | /x/ any-o /'/ any-e /'/ any-y <"BY">
  | /x/ any-o /'/ any-e any-i <"VUhU">
  | /x/ any-o /'/ any-i <"ME">
  | /x/ any-o /'/ any-o <"UI">
  | /x/ any-o /'/ any-u <"BAI">
  | /x/ any-o /'/ any-y <"BY">
  | /x/ any-o any-i <"XOI">
  | /x/ any-o any-i /'/ any-u <"JOI">
  | /x/ any-u <"UI">
  | /x/ any-u /'/ any-a any-u <"ROI">
  | /x/ any-u /'/ any-o /'/ any-e <"NA">
  | /x/ any-u /'/ any-u <"LOhOI">
  | /x/ any-u /'/ any-u /'/ any-i <"UI">
  | /x/ any-y <"BY">
  | /x/ any-y /'/ any-y <"UI">

%rule lexicon-y
  | any-y <"Y">
  | any-y /'/ any-i <"JOI">
  | any-y /'/ any-y <"BY">

%rule lexicon-z
  | /z/ any-a <"BAI">
  | /z/ any-a /'/ any-a <"UI">
  | /z/ any-a /'/ any-a any-i <"BAI">
  | /z/ any-a /'/ any-e <"BAhE">
  | /z/ any-a /'/ any-e any-i <"VUhU">
  | /z/ any-a /'/ any-i <"NU">
  | /z/ any-a /'/ any-o <"BAI">
  | /z/ any-a /'/ any-u <"VUhU">
  | /z/ any-a /'/ any-u /'/ any-y <"BY">
  | /z/ any-a any-i <"LAU">
  | /z/ any-a any-i /'/ any-a <"UI">
  | /z/ any-a any-i /'/ any-e <"BAhE">
  | /z/ any-a any-i /'/ any-o <"KOhA">
  | /z/ any-a any-u <"BAI">
  | /z/ any-e <"PA">
  | /z/ any-e /'/ any-a <"BAI">
  | /z/ any-e /'/ any-a any-i <"BAI">
  | /z/ any-e /'/ any-e <"BAI">
  | /z/ any-e /'/ any-e any-i <"SI">
  | /z/ any-e /'/ any-i <"BAI">
  | /z/ any-e /'/ any-o <"BAI">
  | /z/ any-e /'/ any-o any-i <"GOhOI">
  | /z/ any-e /'/ any-u <"BAI">
  | /z/ any-e /'/ any-y <"BY">
  | /z/ any-e any-i <"SI">
  | /z/ any-e any-i /'/ any-a <"BAI">
  | /z/ any-i <"BAI">
  | /z/ any-i /'/ any-a <"UI">
  | /z/ any-i /'/ any-a /'/ any-o <"VUhU">
  | /z/ any-i /'/ any-a any-i <"UI">
  | /z/ any-i /'/ any-e <"JOI">
  | /z/ any-i /'/ any-o <"KOhA">
  | /z/ any-i /'/ any-o any-i <"KOhA">
  | /z/ any-o <"ZO">
  | /z/ any-o /'/ any-a <"BAI">
  | /z/ any-o /'/ any-a any-u <"LE">
  | /z/ any-o /'/ any-e <"KOhA">
  | /z/ any-o /'/ any-e any-i <"LAhE">
  | /z/ any-o /'/ any-i <"BAI">
  | /z/ any-o /'/ any-o <"UI">
  | /z/ any-o /'/ any-u <"ZOhU">
  | /z/ any-o any-i <"ZOI">
  | /z/ any-u <"BAI">
  | /z/ any-u /'/ any-a <"BAI">
  | /z/ any-u /'/ any-a any-i <"KOhA">
  | /z/ any-u /'/ any-a any-u <"BAI">
  | /z/ any-u /'/ any-e <"BAI">
  | /z/ any-u /'/ any-i <"KOhA">
  | /z/ any-u /'/ any-i /'/ any-a <"KOhA">
  | /z/ any-u /'/ any-o <"NU">
  | /z/ any-u /'/ any-u <"UI">
  | /z/ any-y <"BY">
```
