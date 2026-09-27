# Word forms

This document opens the forms stage, the second stage of every Lojban dialect: [CLL](../dialects/cll-ebnf.md), [approved word forms](../dialects/bpfk.md), [experimental](../dialects/experimental.md) and [Zantufa](../dialects/zantufa.md). The stage reads the phonemes that the phoneme stage emitted. It divides the text into its source words, each tagged with its class, and hands them to the word stage ([stream.md](stream.md)), where the magic words act on them. The notation is explained in [the notation document](../../docs/notation.md).

What a word looks like is not decided here. Other documents are stitched into the stage with this one:

- The word forms of one family, which define the three shapes this grammar reads, `cmavo-shape`, `brivla-shape` and `cmevla-shape`, and tag each with the pause properties below. The CLL dialect stitches [shapes.md](shapes.md) and [cll.md](cll.md). The other dialects stitch [bpfk.md](bpfk.md), with [experimental.md](experimental.md) or [zantufa.md](zantufa.md) after it.
- One lexicon, [lexicon-cll.md](lexicon-cll.md), [lexicon-experimental.md](lexicon-experimental.md) or [lexicon-zantufa.md](lexicon-zantufa.md), which gives each cmavo its selma'o.

## Runs

The text is runs and pauses. A run is a stretch of the text with no pause inside it, and the phoneme stage emits each pause as one `PAUSE` token. What counts as a pause is the phoneme stage's business: a space or a period in CLL's orthography, and other punctuation too in the conventions that the other dialects read. Every pause rule of CLL 4.9 and 4.2 holds within one run: a pause satisfies each of them, so two words with a pause between them never constrain each other. The approved word forms look past the end of a word only as far as the next pause. So this stage reads each run on its own.

A run is a sequence of words, or it is foreign text. That holds for a run that the phoneme stage already found foreign, because it has a character no script reads, and for a run of letters that divides into no words. Foreign text is not an error here. Whether it may stand where it does is the word stage's question: inside a `zoi` quote it is the quote's body, and elsewhere the word stage rejects it. So this stage never rejects a text. A run that divides into words divides in one way only, which the word forms of each family ensure. So the stage's choice among parses never decides anything here.

```jbogenbau
%ambiguity-resolution lazy
```

```jbogenbau
%rule text
  | ε | pause-token
  | [pause-token] runs [pause-token]

%rule runs
  run | runs pause-token run

%rule pause-token
  PAUSE
%emits
  $

%rule run
  run-words | foreign-run | unread-run

%rule foreign-run
  $f(FOREIGN)
%emits
  $ <tags($f) ∪ "run-initial" ∪ "run-final">

%rule unread-run
  $f(letters)
%conditions
  ¬begins(after($f), letter),
  ¬matches($f, run-words)
%emits
  $ <"FOREIGN" ∪ "run-initial" ∪ "run-final">

%rule letters
  letter | letters letter

%rule letter
  | /a/ | /e/ | /i/ | /o/ | /u/ | /A/ | /E/ | /I/ | /O/ | /U/ | /y/ | /Y/ | /'/ | /,/
  | /b/ | /c/ | /d/ | /f/ | /g/ | /j/ | /k/ | /l/ | /m/ | /n/ | /p/ | /r/ | /s/ | /t/ | /v/ | /x/ | /z/
```

Every token of the input is handed on. A pause, and a foreign run of the phoneme stage, are handed on as they are; such a run keeps its text as its phonemes. A run of letters that divides into no words becomes one `FOREIGN` token, which sounds like its letters, so that a `zoi` delimiter compares with it exactly as with the same letters read as words. Its text is what the author wrote. The stage tests whether the run divides only for the whole run: a part of a run is followed by a letter. It tests the run alone, which gives the answer it would give in place, since no rule of this stage reads past the end of a run.

## Words in a run

A run's words are read from the left. Each word after the first may follow the word before it only if the pause rules allow the two to stand together with no pause. The family tags each word with the properties that these rules test. The run carries the tags of its last word, so the condition sees the word before and the word after:

- `onset`: the word may follow another word directly. It begins with a consonant and is not a name (rules 3 and 4).
- `continued`: another word may follow this one directly. A name never has it (rule 4), nor a `Cy` letter, nor a brivla whose stress is not marked.
- `name-intro` and `name-onset`: `la`, `lai`, `la'i` and `doi`, and a name that begins with a consonant. The name may follow the cmavo directly (rule 4).
- `cy`: a `Cy` letter, which only another `Cy` letter may follow directly (rule 6).
- `final-stress`, `initial-stress` and `stress-guard`: the word's last or first syllable is stressed, or the word is a brivla. A word with `final-stress` may not be followed directly by a word with either of the other two (4.2, rule 5).
- `open-stress` and `uncounted`: a brivla whose stress is not marked, and a word with no counted syllable. CLL 3.9 counts a brivla's syllables to the next pause, so only words with no counted syllable may follow it in its run. The run carries `open-stress` on through them.

The approved word forms set only `onset` and `continued`. Their words look past their own ends, as the PEG's do, and decide the rest themselves.

```jbogenbau
%rule run-words
  | $f(first-word) <tags($f)>
  | $r(run-words) $v(later-word)
      <tags($v) ∪ ("uncounted" ∈ tags($v) ⟹ "open-stress" ∩ tags($r))>
%conditions
  ("continued" ∪ "cy" ∪ "name-intro" ∪ "open-stress") ∩ tags($r) ≠ ∅,
  "cy" ∈ tags($r) ∧ "cy" ∈ tags($v)
    ∨ "continued" ∈ tags($r) ∧ "onset" ∈ tags($v) ∧ ("cy" ∉ tags($r) ∨ "cy" ∉ tags($v))
    ∨ "name-intro" ∈ tags($r) ∧ "name-onset" ∈ tags($v)
    ∨ "open-stress" ∈ tags($r) ∧ "cy" ∉ tags($r) ∧ "onset" ∈ tags($v),
  "final-stress" ∉ tags($r) ∨ ("stress-guard" ∪ "initial-stress") ∩ tags($v) = ∅,
  "open-stress" ∉ tags($r) ∨ "uncounted" ∈ tags($v)
```

The joins are stated so that no two apply to the same pair: two `Cy` letter words side by side are joined by the `Cy` rule alone, which is why the general join, a continued word followed by an onset, leaves that case to it.

The word stage needs to know where a run begins and ends. A name that `bu` takes needs a pause before it (CLL 17.4), and a `zoi` quote and a `zo'oi` quote end at the end of a run. So the first word of each run is tagged `run-initial`, and the last `run-final`.

```jbogenbau
%rule first-word
  $w(source-word)
%emits
  $ <tags($w) ∪ "run-initial" ∪ (¬begins(after($w), letter) ⟹ "run-final")>

%rule later-word
  $w(source-word)
%emits
  $ <tags($w) ∪ (¬begins(after($w), letter) ⟹ "run-final")>
```

## Words

A source word is a cmavo, a brivla, a name, or hesitation. It is handed on with its kind: `word` and `cmavo`, `BRIVLA` or `CMEVLA` for a word, and `hesitation` for hesitation. A cmavo also carries the selma'o that the lexicon gives it: `tags($c, lexicon)` parses the cmavo's phonemes against the lexicon rules. A cmavo unknown to the lexicon is still a word, of no class.

```jbogenbau
%rule source-word
  | $c(cmavo-shape) <"word" ∪ "cmavo" ∪ tags($c) ∪ tags($c, lexicon)>
  | $b(brivla-shape) <"word" ∪ "BRIVLA" ∪ tags($b)>
  | $n(cmevla-shape) <"word" ∪ "CMEVLA" ∪ tags($n)>
  | $h(hesitation-shape) <"hesitation" ∪ tags($h)>
```

Hesitation, `y` however long, is a source word of its own here, since the pause rules hold for it as for any word: it begins with a vowel, so a pause comes before it, unless the family gives it `onset`. The approved word forms read `kyyykerlo` as `ky`, `yy` and `kerlo`, since the first `y` of `yy` is not a nucleus there. Hesitation needs no pause after it, as the Magic Words proposal has it. The word stage drops it, or reads it as the base of the letter word `.y bu`. Two letters `y` never form one syllable, so a comma between them changes nothing, and `y,y` is hesitation as `yy` is (CLL 3.3).

```jbogenbau
%rule hesitation-shape
  $h(y-run) <"continued" ∪ "uncounted" ∪ tags($h)>

%rule y-run
  any-y | any-y y-run | any-y /,/ y-run
```

A `y` here is either phoneme of the letter, plain or stressed. The same holds of every vowel letter in a cmavo, whose stress is free (CLL 3.9). The lexicon documents spell their words with these rules.

```jbogenbau
%rule any-a
  /a/ | /A/

%rule any-e
  /e/ | /E/

%rule any-i
  /i/ | /I/

%rule any-o
  /o/ | /O/

%rule any-u
  /u/ | /U/

%rule any-y
  /y/ | /Y/
```
