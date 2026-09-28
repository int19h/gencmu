# The date-word proposal

This dialect is the [experimental](experimental.md) dialect with the date words of mati's proposal, ["how to fix Lojban's date words"](https://tcima.jbobau.org/3mwkeyyuf4c2d). It also shows how a proposal for a change to Lojban becomes a gencmu dialect. The dialect adds one document to the pipeline of the experimental dialect, and it changes no rule of the syntax.

The dialect reads a text in stages. A stage is one step of the reading, with its own grammar. Every stage is the stage of the experimental dialect. The forms stage has one more document, [`../words/lexicon-date-words.md`](../words/lexicon-date-words.md), which moves three cmavo into LI.

A feature is a named switch that the grammars test. The dialect turns on the features of the experimental dialect, and one more: the gate `date-li`, which makes the date words LI. A caller, the program or person that asks for a parse, can turn `date-li` off. The dialect then reads every text as the experimental dialect does.

```jbogenbau
%features cbm soi-clause su-boundary date-li
```

## The proposal

In *The Complete Lojban Language* (CLL), `de'i` and `ti'u` are BAI. A word of BAI is a modal: it tags a sumti and makes a term of it, as in `de'i li 1989`. So a date is always the argument of a modal, and never a sumti of its own. The proposal names three problems that follow from this:

- A date cannot fill a place of a selbri. For "February 13th was a bad day", a speaker must say `lo se detri be li re pi'e pa ci cu mabla djedi`.
- A date cannot follow a tense. `co'a de'i li pa pi'e re` is not "since January 2nd". In CLL, it is two tags, as in `co'a ku de'i li pa pi'e re`.
- The number after the modal needs `li`.

The proposal moves `de'i` and `ti'u` into LI, the selma'o of `li` and `me'o`. It takes `na'a`, a word of BY, for a third date word, from `nanca` (year). So a date word followed by a number is a sumti, as `li` followed by a number is. A tense tags the date as it tags any sumti: `ca na'a 1989` is "in 1989", and `co'a na'a 2011` is "since 2011".

The three words give the units of a date in different orders. `de'i` gives the day first, then the month and the year. `na'a` gives the year first, then the month and the day. `ti'u` gives a time of day, from the hour to the second. `pi'e`, the separator of a compound base (CLL 18.10), joins the units. The order is part of the meaning of each word, and no rule reads it.

The proposal first puts `de'i` in LA'E, before `me'o`, as in `de'i me'o re pi'e pa ci`. It then puts `de'i` in LI in place of LA'E, so `me'o` is no longer needed. This dialect follows the second choice. So `de'i me'o re pi'e pa ci` is an error.

## The examples of the proposal

These are the examples of the proposal, as this dialect reads them. Each is a case of the test corpus, whose ids begin with `adhoc.date-words.`.

- `ca na'a 1989 la .berlin. bitmu cu se daspo`: "The Berlin Wall fell in 1989."
- `mi jbena ca na'a 2006`: "I was born in 2006."
- `co'a na'a 2011 ba'o kulmulbi'o fa 40 tadni`: "Since 2011, forty students graduated."
- `mi ba klama le frasygu'e ca de'i 17`: "I am going to France on the 17th."
- `de'i 13 pi'e 2 cu mabla djedi`: "February 13th was a bad day."
- `de'i 20 pe lo pavma'i`: "the 20th of January", which is `de'i 20 pi'e 1`.
- `lo pavma'i be ca na'a 2030`: "January 2030"
- `mi nitcu lo ka zvati lo jajysfi ca ti'u 16`: "I need to be at the party at four o'clock."

The proposal writes the digits of a date with hyphens, as in `de'i 17-9-2027`. The hyphen stands for `pi'e`. But the phoneme stage reads a hyphen as a pause, so the digits join into one number. `de'i 17-9-2027` parses, but as the date 1792027, with no error. So the examples here write `pi'e` in full: `de'i 17 pi'e 9 pi'e 2027`. [Issue 80](https://github.com/int19h/gencmu/issues/80) proposes that every dialect read a hyphen or a colon between two digits as `pi'e`.

## What the date words take

The syntax of the experimental dialect already has a rule for LI. It is the alternative `LI # mex [LOhO] #` of `sumti-6`, in [`../syntax/experimental.md`](../syntax/experimental.md). So the date words need no rule of their own, and they take exactly what `li` takes:

- Any mekso (a mathematical expression) follows the word, such as `de'i 17 su'i 1`, `de'i ny` or `ti'u vei 12 su'i 4 ve'o`.
- `lo'o` can end the sumti.
- A relative clause can follow the sumti, as in `de'i 20 pe lo pavma'i`.
- A quantifier can come before it, as in `ro de'i 15`.

A note of the proposal says that the date words are always numbers, with no letters. The note argues that the date words belong in LI if LI and ME'O are ever split. The experimental dialect does not split them, since `li` and `me'o` are both LI. So the dialect gives the date words the whole grammar of `li`, letters included.

A date word reads its mekso as far as the grammar allows, as `li` does. So a number that follows a date can join it. In `mi klama ca na'a 2011 ci lo prenu`, the year is 20113, and `lo prenu` is a term of its own. `boi` ends the number, and `lo'o` ends the whole sumti: `mi klama ca na'a 2011 boi ci lo prenu` has the year 2011 and the term `ci lo prenu`. The grammar ends the date earlier only if the longer date leaves no reading of the whole text. So `ca na'a 2011 ci tadni cu kulmulbi'o` has the year 2011.

## Texts that this dialect reads differently

The change removes readings of the experimental dialect. These texts of the experimental dialect are errors here:

- `mi klama de'i li 1989` has a date word before `li`. A mekso cannot begin with `li`. The proposal writes `mi klama ca na'a 1989`.
- `do cliva de'i ma` and `mi xabju lo barda zdani de'i da` have a date word before a sumti that is not a mekso. The proposal uses `ca` before such a sumti: `do cliva ca ma`. `ca de'i xo` asks for the day of the month.
- `lo se de'i` converts the modal, and `de'i ku` is the modal with no sumti. A word of LI has neither form.
- `na'a` alone was a letter word. A word of LI is not a sumti by itself.

Other texts have a reading in both dialects, but not the same one. In the experimental dialect, `ca de'i 1989 la .berlin. bitmu cu se daspo` has the tag `ca de'i` and the quantified sumti "1989 of the Berlin Wall". Here, it has the tagged sumti `ca de'i 1989` and the sumti `la .berlin. bitmu`.

This is why the date words leave BAI and BY, and do not keep them as a second class. With both BAI and LI, `de'i` gives the text above both readings, and the syntax stage reports a tie. A tie is a text with more than one winning reading.

## The date modals of guskant

The experimental lexicon has five date modals, which guskant proposed. They are all BAI:

- `de'i'a`: in the century N
- `de'i'e`: in the year N
- `de'i'i`: in the month N
- `de'i'o`: on the day N of the month
- `de'i'u`: on the day N of the week

The dialect keeps them as they are. But they do not solve the problems of the proposal:

- Each one is a modal, so a date is still the argument of a tag. `de'i'o li 13 cu mabla djedi` is a tagged term and a selbri, and "the 13th" fills no place of `mabla djedi`.
- Each one needs `li` before its number.
- Each one gives one unit, so a full date is three terms: `de'i'o li 17 de'i'i li 9 de'i'e li 2027`. The date word `de'i` makes it one sumti: `de'i 17 pi'e 9 pi'e 2027`.
- After a tense, a date modal joins the tag. In `co'a de'i'e li 2011`, the experimental grammar reads one tag of two parts, `co'a de'i'e`, and not `co'a` before a date.

## What the grammar leaves to the proposal

Some questions are about meaning, and the grammar does not answer them. The dialect accepts each of these texts, and the proposal gives their meaning:

- The order of the units after each word, as the section "The proposal" says.
- A year with two digits, as in `na'a 17`. The proposal reads it as a short form of a year such as 2017. `na'a 0017` is the year 17.
- `ro de'i 15`, for "every 15th of the month". The proposal does not say what a date word refers to when a quantifier comes before it.

## Stage 1: phonemes

```jbogenbau
%stage phonemes
```

- [The Latin orthography of CLL](../phonemes/latin-strict.md)
  ```jbogenbau
  %include "../phonemes/latin-strict.md"
  ```
- [Latin conventions](../phonemes/latin.md): punctuation, capital runs, accents and digits
  ```jbogenbau
  %include "../phonemes/latin.md"
  ```
- [Cyrillic orthography](../phonemes/cyrillic.md): gencmu's Cyrillic, the default
  ```jbogenbau
  %include "../phonemes/cyrillic.md"
  ```
- [The Cyrillic orthography of CLL](../phonemes/cyrillic-cll.md): CLL 3.12's Cyrillic, which a caller chooses with the feature `cll-cyrillic`
  ```jbogenbau
  %include "../phonemes/cyrillic-cll.md"
  ```
- [zbalermorna](../phonemes/zbalermorna.md)
  ```jbogenbau
  %include "../phonemes/zbalermorna.md"
  ```

## Stage 2: forms

```jbogenbau
%stage forms
```

- [Word forms](../words/forms.md)
  ```jbogenbau
  %include "../words/forms.md"
  ```
- [Approved word forms](../words/bpfk.md)
  ```jbogenbau
  %include "../words/bpfk.md"
  ```
- [Experimental word forms](../words/experimental.md)
  ```jbogenbau
  %include "../words/experimental.md"
  ```
- [The experimental lexicon](../words/lexicon-experimental.md)
  ```jbogenbau
  %include "../words/lexicon-experimental.md"
  ```
- [The lexicon of the date words](../words/lexicon-date-words.md): `de'i`, `na'a` and `ti'u` in LI, under the gate `date-li`
  ```jbogenbau
  %include "../words/lexicon-date-words.md"
  ```

## Stage 3: words

```jbogenbau
%stage words
```

- [The word stream](../words/stream.md)
  ```jbogenbau
  %include "../words/stream.md"
  ```
- [Replacement quotes](../words/lohai.md): `lo'ai ... le'ai` as one unit of raw words
  ```jbogenbau
  %include "../words/lohai.md"
  ```

## Stage 4: indicators

```jbogenbau
%stage indicators
```

- [Indicators and ba'e](../indicators/cll.md)
  ```jbogenbau
  %include "../indicators/cll.md"
  ```
- [The indicators of camxes-exp](../indicators/experimental.md): a bare `nai` is an indicator
  ```jbogenbau
  %include "../indicators/experimental.md"
  ```

## Stage 5: syntax

```jbogenbau
%stage syntax
```

- [The CLL grammar](../syntax/cll.md)
  ```jbogenbau
  %include "../syntax/cll.md"
  ```
- [The experimental grammar](../syntax/experimental.md): what camxes-exp changes in it
  ```jbogenbau
  %include "../syntax/experimental.md"
  ```
