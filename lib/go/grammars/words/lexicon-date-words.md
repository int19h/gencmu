# The lexicon of the date words

This document is part of the forms stage in the [date-words](../dialects/date-words.md) dialect. The forms stage is the second grammar in the chain. It divides the phonemes of the text into words, and it gives each cmavo its selma'o. A lexicon is a list of words, each with its classes. The loader stitches this document into the stage after [the experimental lexicon](lexicon-experimental.md).

The document moves three cmavo into LI, the selma'o of `li` and `me'o`. The move comes from mati's proposal, ["how to fix Lojban's date words"](https://tcima.jbobau.org/3mwkeyyuf4c2d). [The dialect document](../dialects/date-words.md) explains the proposal and what the move does to the syntax. The three words are these:

| word | class in the experimental lexicon | class here | what the number after it gives |
| --- | --- | --- | --- |
| `de'i` | BAI | LI | the day, then the month and the year |
| `na'a` | BY | LI | the year, then the month and the day |
| `ti'u` | BAI | LI | the hour, then the minutes and the seconds |

The order of the units is part of the meaning of each word. No rule reads it. `pi'e`, the separator of a compound base (CLL 18.10), joins the units: `de'i pa ze pi'e so` is the 17th of September. CLL is *The Complete Lojban Language*.

## How the document changes the lexicon

The notation has no way to remove one alternative from a rule. So this document restates the three rules of the experimental lexicon that spell the three words: `lexicon-d`, `lexicon-n` and `lexicon-t`. Each restated rule is the rule of the experimental lexicon, with one line changed. That line spells one of the three words. It becomes two alternatives, and each alternative has a guard. A guard makes an alternative depend on a feature, a named switch that the grammars test.

The feature is `date-li`, and its guards are gates. A gate keeps its alternative only while the feature is on (`@date-li?`) or only while it is off (`@¬date-li?`). While `date-li` is on, the word is LI. While it is off, the word keeps the class that the experimental lexicon gives it.

The dialect turns `date-li` on. A caller, the program or person that asks for a parse, can turn it off. The dialect then reads every text as the experimental dialect does.

The change is a gate and not a warning, because it removes readings of the experimental dialect. `mi klama de'i li 1989` is a text of that dialect, and this dialect rejects it. [The notation document](../../docs/notation.md) says under "Feature guards" that such a change is a gate.

A word cannot be both BAI and LI. With both classes, the syntax stage reads `ca de'i 1989 la .berlin. bitmu cu se daspo` in two ways and reports a tie. A tie is a text with more than one winning reading. The dialect document shows the two readings.

## de'i

In CLL, `de'i` is BAI, the modal of `detri` (date). A modal tags a sumti and makes a term of it: `de'i li 1989`. Here, `de'i` is LI. So it takes a mekso (a mathematical expression) directly, as `li` does: `de'i pa ze` is "the 17th".

The line with the comment `(* de'i *)` is the change. The experimental lexicon also has five longer words that begin with `de'i`: `de'i'a`, `de'i'e`, `de'i'i`, `de'i'o` and `de'i'u`. They are the date modals of guskant. Each is one cmavo with a line of its own, and they stay BAI. The dialect document explains why they do not solve the problems of the proposal.

```jbogenbau
%redefine-rule lexicon-d
  | /d/ any-a <"KOhA">
  | /d/ any-a /'/ any-a <"PA">
  | /d/ any-a /'/ any-e <"KOhA">
  | /d/ any-a /'/ any-i <"UI" ∪ "indicator">
  | /d/ any-a /'/ any-o <"DAhO" ∪ "indicator">
  | /d/ any-a /'/ any-o any-i <"DOI">
  | /d/ any-a /'/ any-u <"KOhA">
  | /d/ any-a any-i <"UI" ∪ "indicator">
  | /d/ any-a any-u <"PA">
  | /d/ any-e <"KOhA">
  | /d/ any-e /'/ any-a <"ZAhO">
  | /d/ any-e /'/ any-e <"KOhA">
  | @date-li? /d/ any-e /'/ any-i <"LI">  (* de'i *)
  | @¬date-li? /d/ any-e /'/ any-i <"BAI">
  | /d/ any-e /'/ any-i /'/ any-a <"BAI">
  | /d/ any-e /'/ any-i /'/ any-e <"BAI">
  | /d/ any-e /'/ any-i /'/ any-i <"BAI">
  | /d/ any-e /'/ any-i /'/ any-o <"BAI">
  | /d/ any-e /'/ any-i /'/ any-u <"BAI">
  | /d/ any-e /'/ any-o <"VUhU">
  | /d/ any-e /'/ any-u <"KOhA">
  | /d/ any-e any-i <"KOhA">
  | /d/ any-i <"KOhA">
  | /d/ any-i /'/ any-a <"ZAhO">
  | /d/ any-i /'/ any-a any-i <"COI">
  | /d/ any-i /'/ any-e <"KOhA">
  | /d/ any-i /'/ any-i <"TAhE">
  | /d/ any-i /'/ any-o <"BAI">
  | /d/ any-i /'/ any-u <"KOhA">
  | /d/ any-o <"KOhA">
  | /d/ any-o /'/ any-a <"UI" ∪ "indicator">
  | /d/ any-o /'/ any-e <"BAI">
  | /d/ any-o /'/ any-i <"KOhA">
  | /d/ any-o /'/ any-o <"KOhA">
  | /d/ any-o /'/ any-u <"DOhU">
  | /d/ any-o any-i <"DOI">
  | /d/ any-u <"GOhA">
  | /d/ any-u /'/ any-a <"FAhA">
  | /d/ any-u /'/ any-e <"PA">
  | /d/ any-u /'/ any-i <"BAI">
  | /d/ any-u /'/ any-o <"BAI">
  | /d/ any-u /'/ any-u <"NU">
  | /d/ any-y <"BY">
```

## na'a

In CLL, `na'a` is BY. It cancels all letteral shifts, a use that texts almost never have. The proposal takes the word for the year, from `nanca` (year). Here, `na'a` is LI, and it is no longer a letter word. So `na'a` alone is not a sumti in this dialect.

The line with the comment `(* na'a *)` is the change.

```jbogenbau
%redefine-rule lexicon-n
  | /n/ any-a <"NA">
  | @date-li? /n/ any-a /'/ any-a <"LI">  (* na'a *)
  | @¬date-li? /n/ any-a /'/ any-a <"BY">
  | /n/ any-a /'/ any-e <"NAhE">
  | /n/ any-a /'/ any-e any-i <"NAhE">
  | /n/ any-a /'/ any-i <"UI" ∪ "indicator">
  | /n/ any-a /'/ any-o <"TAhE">
  | /n/ any-a /'/ any-u <"NAhU">
  | /n/ any-a any-i <"NAI" ∪ "indicator">
  | /n/ any-a any-u <"CUhE">
  | /n/ any-a any-u /'/ any-o <"KOhA">
  | /n/ any-e <"GOI">
  | /n/ any-e /'/ any-a <"FAhA">
  | /n/ any-e /'/ any-i <"FAhA">
  | /n/ any-e /'/ any-o <"VUhU">
  | /n/ any-e /'/ any-u <"FAhA">
  | /n/ any-e any-i <"GOhA">
  | /n/ any-i <"NU">
  | /n/ any-i /'/ any-a <"FAhA">
  | /n/ any-i /'/ any-e <"NIhE">
  | /n/ any-i /'/ any-i <"BAI">
  | /n/ any-i /'/ any-o <"NIhO">
  | /n/ any-i /'/ any-u <"PA">
  | /n/ any-o <"PA">
  | /n/ any-o /'/ any-a <"GOhA">
  | /n/ any-o /'/ any-e <"NAhE">
  | /n/ any-o /'/ any-i <"NIhO">
  | /n/ any-o /'/ any-o <"PA">
  | /n/ any-o /'/ any-o any-i <"NOhOI">
  | /n/ any-o /'/ any-u <"GOI">
  | /n/ any-o any-i <"NOI">
  | /n/ any-u <"NU">
  | /n/ any-u /'/ any-a <"NUhA">
  | /n/ any-u /'/ any-e <"COI">
  | /n/ any-u /'/ any-i <"NUhI">
  | /n/ any-u /'/ any-o <"CAhA">
  | /n/ any-u /'/ any-u <"NUhU">
  | /n/ any-y <"BY">
```

## ti'u

In CLL, `ti'u` is BAI, the modal of `tcika` (time of day). Here, `ti'u` is LI, as `de'i` is: `ti'u pa xa` is "at 16 o'clock".

The line with the comment `(* ti'u *)` is the change.

```jbogenbau
%redefine-rule lexicon-t
  | /t/ any-a <"KOhA">
  | /t/ any-a /'/ any-a <"COI">
  | /t/ any-a /'/ any-e <"TAhE">
  | /t/ any-a /'/ any-i <"BAI">
  | /t/ any-a /'/ any-o <"UI" ∪ "indicator">
  | /t/ any-a /'/ any-u <"UI" ∪ "indicator">
  | /t/ any-a any-i <"BAI">
  | /t/ any-a any-u <"LAU">
  | /t/ any-e <"SE">
  | /t/ any-e /'/ any-a <"VUhU">
  | /t/ any-e /'/ any-e <"FAhA">
  | /t/ any-e /'/ any-o <"PA">
  | /t/ any-e /'/ any-u <"TEhU">
  | /t/ any-e any-i <"TEI">
  | /t/ any-i <"KOhA">
  | /t/ any-i /'/ any-a <"FAhA">
  | /t/ any-i /'/ any-e <"UI" ∪ "indicator">
  | /t/ any-i /'/ any-i <"BAI">
  | /t/ any-i /'/ any-o <"SEI">
  | @date-li? /t/ any-i /'/ any-u <"LI">  (* ti'u *)
  | @¬date-li? /t/ any-i /'/ any-u <"BAI">
  | /t/ any-o <"TO">
  | /t/ any-o /'/ any-a <"BY">
  | /t/ any-o /'/ any-a any-i <"SE">
  | /t/ any-o /'/ any-e <"NAhE">
  | /t/ any-o /'/ any-i <"TO">
  | /t/ any-o /'/ any-o <"FAhA">
  | /t/ any-o /'/ any-u <"UI" ∪ "indicator">
  | /t/ any-o any-i <"TOI">
  | /t/ any-u <"KOhA">
  | /t/ any-u /'/ any-a <"LAhE">
  | /t/ any-u /'/ any-e <"TUhE">
  | /t/ any-u /'/ any-i <"BAI">
  | /t/ any-u /'/ any-o <"PA">
  | /t/ any-u /'/ any-u <"TUhU">
  | /t/ any-y <"BY">
```
