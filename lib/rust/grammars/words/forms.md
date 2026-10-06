# Word forms

This document opens the forms stage. A stage is one step of a pipeline, with its own grammar ([engine §1](../../docs/engine.md#1-tokens)). The forms stage is the second stage of every Lojban dialect: [CLL](../dialects/cll-ebnf.md), [approved word forms](../dialects/bpfk.md), [experimental](../dialects/experimental.md) and [Zantufa](../dialects/zantufa.md). The stage reads the phonemes that the phoneme stage emitted.

The stage divides the text into its source words and tags each word with its class. A token is one unit that a stage reads or emits. A tag marks a token by name, phoneme or character. The stage hands the words to the word stage ([stream.md](stream.md)), where the magic words act on them. [The notation document](../../docs/notation.md) explains the notation.

This document does not decide what a word looks like. The loader stitches other documents into the stage with this one: the word forms of one family, and one lexicon. A family is a set of word forms that dialects use. The family defines the three shapes this grammar reads, `cmavo-shape`, `brivla-shape` and `cmevla-shape`. It tags each with the pause properties below.

The prose uses these Lojban terms for words:

- A cmavo is a particle, a short structure word.
- A selma'o is a word class of cmavo.
- A brivla is a predicate word.
- A cmevla is a name word.

The `cll-ebnf` dialect stitches [shapes.md](shapes.md) and [cll.md](cll.md) as its family. The other dialects stitch [bpfk.md](bpfk.md), with [experimental.md](experimental.md) or [zantufa.md](zantufa.md) after it. The lexicon is [lexicon-cll.md](lexicon-cll.md), [lexicon-experimental.md](lexicon-experimental.md) or [lexicon-zantufa.md](lexicon-zantufa.md), and it gives each cmavo its selma'o.

## Runs

The text is runs and pauses. A run is a stretch of text with no pause inside. The phoneme stage emits each pause as one `PAUSE` token. The phoneme stage decides what counts as a pause. In CLL's orthography, a pause is a space or a period. In the conventions that the other dialects read, other punctuation is a pause too.

Every pause rule of CLL 4.9 and 4.2 holds within one run. A pause satisfies each of them, so two words with a pause between them never constrain each other.

A lookahead tests following input without consuming it. The approved word forms look past the end of a word only as far as the next pause. This stage reads each run on its own, except for two lookaheads. A prolonged y run tests whether BU follows across one pause. In Zantufa, a second lookahead applies before a quoted form. There, a `ra'oi` before a pause changes how the stage divides the next run ([zantufa.md](zantufa.md)).

A run is a sequence of words, or it is unread. An unread run is one that the pipeline did not read as words, and it carries the tag `UNREAD`. A run is unread when the phoneme stage already left it unread, because it has a character that no script reads. A run of phonemes that divides into no words is also unread.

An unread run is not an error here. The word stage decides whether an unread run can stand where it is. The word stage takes it as the body of a quote, such as `zoi` or `zo'oi`, and after `fa'o`. Elsewhere it rejects an unread run ([stream.md](stream.md)). So this stage never rejects a text.

A run that divides into words divides in one way only. The word forms of each family make sure of that. So the choice of the stage among parses never decides anything here.

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
  read-run | foreign-run | unread-run

%rule read-run
  run-words

%rule foreign-run
  $f(UNREAD)
%emits
  $ <tags($f) ∪ ~run-initial ∪ ~run-final>

%rule unread-run
  $f(phoneme-run)
%conditions
  ¬begins(after($f), nonpause-phoneme),
  ¬matches($f, read-run)
%emits
  $ <UNREAD ∪ ~run-initial ∪ ~run-final>

%rule phoneme-run
  nonpause-phoneme | phoneme-run nonpause-phoneme

%rule nonpause-phoneme
  | /a/ | /e/ | /i/ | /o/ | /u/ | /A/ | /E/ | /I/ | /O/ | /U/ | /y/ | /Y/ | /'/ | /,/
  | /b/ | /c/ | /d/ | /f/ | /g/ | /j/ | /k/ | /l/ | /m/
  | /n/ | /p/ | /r/ | /s/ | /t/ | /v/ | /x/ | /z/
```

The stage covers every input token. It passes pauses and the unread runs of the phoneme stage through, and combines phonemes into words or unread runs. An unread run of the phoneme stage keeps its phonemes, `?`, and its label, which is its text.

A run of phonemes that divides into no words becomes one `UNREAD` token, which sounds like its phonemes. Its rule is not `%opaque`, so the token keeps those phonemes. So a `zoi` delimiter compares with it exactly as with the same phonemes read as words. The text of the token is what the author wrote.

The stage tests only a whole run for whether it divides. A part of a run has a phoneme after it, so the stage does not test it. The stage tests the run alone. This gives the same answer as a test in place, because no rule of this stage reads past the end of a run.

The rule `read-run` is a run that divides into words. A dialect that divides a run in another way extends `read-run`, as [zantufa.md](zantufa.md) does for `ra'oi`. So `unread-run` never takes a run that one of these ways reads.

## Words in a run

The stage reads the words of a run from the left. Each word after the first can follow the word before it only if the pause rules let the two stand together with no pause. The family tags each word with the properties that these rules test. The run carries the tags of its last word, so the condition sees the word before and the word after:

- `onset`: The word can follow another word directly. It begins with a consonant and is not a name (rules 3 and 4).
- `continued`: Another word can follow this one directly. A name never has it (rule 2), nor a `Cy` letter, nor a brivla whose stress is not marked.
- `name-intro` and `name-onset`: `name-intro` marks `la`, `lai`, `la'i` and `doi`, and `name-onset` marks a name that begins with a consonant. The name can follow the cmavo directly (rule 4).
- `cy`: A `Cy` letter, which only another `Cy` letter can follow directly (rule 6)
- `final-stress`, `initial-stress` and `stress-guard`: The word's last or first syllable is stressed, or the word is a brivla. A word with either of the other two cannot directly follow a word with `final-stress` (4.2, rule 5).
- `open-stress` and `uncounted`: `open-stress` marks a brivla whose stress is not marked, and `uncounted` marks a word with no counted syllable. CLL 3.9 counts a brivla's syllables to the next pause, so only words with no counted syllable can follow it in its run. The run carries `open-stress` on through them.

The approved word forms set only `onset` and `continued`, with the meaning that the PEG gives them. The PEG is the parsing expression grammar of the approved forms. [bpfk.md](bpfk.md) translates it. Every word is `continued`, and a word that does not begin with a nucleus is `onset`, a name included. Their words look past their own ends, as the words of the PEG do, and decide the rest themselves.

```jbogenbau
%rule run-words
  | $f(first-word) <tags($f)>
  | $r(run-words) $v(later-word)
      <tags($v) ∪ (~uncounted ⊆ tags($v) ⟹ ~open-stress ∩ tags($r))>
%conditions
  (~continued ∪ ~cy ∪ ~name-intro ∪ ~open-stress) ∩ tags($r) ≠ ∅,
  ~cy ⊆ tags($r) ∧ ~cy ⊆ tags($v)
    ∨ ~continued ⊆ tags($r) ∧ ~onset ⊆ tags($v)
    ∨ ~name-intro ⊆ tags($r) ∧ ~name-onset ⊆ tags($v)
    ∨ ~open-stress ⊆ tags($r) ∧ ~cy ⊈ tags($r) ∧ ~onset ⊆ tags($v),
  ~final-stress ⊈ tags($r) ∨ (~stress-guard ∪ ~initial-stress) ∩ tags($v) = ∅,
  ~open-stress ⊈ tags($r) ∨ ~uncounted ⊆ tags($v)
```

A join permits two words without a pause. This document states the joins so that no two joins apply to the same pair. For example, in the CLL family, a word tagged `cy` never carries `continued`. So only the `Cy` rule joins two `Cy` letters there, and the general join, a continued word followed by an onset, never follows one. The approved word forms tag no word `cy`. They join a `Cy`-shaped word such as `fy` by the general join, so `fyno` is `fy` and `no`.

The first condition of `run-words` follows from the second. Each join of the second needs one of four tags on the words before: `continued`, `cy`, `name-intro` or `open-stress`. The first condition stays because it uses only `$r`.

The parser tests it as soon as it reads `$r`. If the condition fails, the parser drops the join before reading another word. Engine §4 gives this order of evaluation. Without the condition, the parser tries every word shape after a word that no word can join. The full corpus then takes about 13% longer in the Rust library.

Before BU, this stage splits prolonged y hesitation into a prefix and a final y token, with or without a pause. The word reader drops the prefix and joins only the final y with BU. This split preserves source positions and leaves raw quote bodies unjoined.

The word stage needs to know where a run begins and ends. A name that `bu` takes needs a pause before it (CLL 17.4). A `zoi` quote and a `zo'oi` quote end at the end of a run. So this stage tags the first word of each run `run-initial`, and the last word `run-final`.

```jbogenbau
%rule first-word
  ordinary-first-word | split-first-y

%rule ordinary-first-word
  $w(source-word)
%conditions
  ¬begins(from($w), split-first-y)
%emits
  $ <tags($w) ∪ ~run-initial ∪ (¬begins(after($w), nonpause-phoneme) ⟹ ~run-final)>

%rule later-word
  ordinary-later-word | split-later-y

%rule ordinary-later-word
  $w(source-word)
%conditions
  ¬begins(from($w), split-later-y)
%emits
  $ <tags($w) ∪ (¬begins(after($w), nonpause-phoneme) ⟹ ~run-final)>

%rule split-first-y
  $p(y-prefix) $y(y-atom)
%tags
  tags($, source-word)
%conditions
  matches($, hesitation-shape),
  begins(after($), bu-form-ahead)
%emits
  $p <tags($, source-word) ∪ ~run-initial>,
  $y <tags($, source-word) ∪ ~spacing ∪ ~after-hesitation ∪ (¬begins(after($), nonpause-phoneme) ⟹ ~run-final)>

%rule split-later-y
  $p(y-prefix) $y(y-atom)
%tags
  tags($, source-word)
%conditions
  matches($, hesitation-shape),
  begins(after($), bu-form-ahead)
%emits
  $p <tags($, source-word)>,
  $y <tags($, source-word) ∪ ~after-hesitation ∪ (¬begins(after($), nonpause-phoneme) ⟹ ~run-final)>

%rule y-prefix
  y-atom | y-prefix y-atom

%rule y-atom
  [/,/] any-y

%rule bu-form-ahead
  [PAUSE] bu-form

%rule bu-form
  cmavo-shape="bu"

```

## Words

A source word is a cmavo, a brivla, a name, or hesitation. The stage hands it on with its kind: `word` and `cmavo`, `BRIVLA` or `CMEVLA` for a word, and `hesitation` for hesitation. A cmavo also carries the selma'o that the lexicon gives it: `classify(phonemes($c), lexicon)` looks the cmavo's sound up in the lexicon. A cmavo unknown to the lexicon is still a word, of no class.

```jbogenbau
%rule source-word
  | $c(cmavo-shape) <~word ∪ ~cmavo ∪ tags($c) ∪ classify(phonemes($c), lexicon)>
  | $b(brivla-shape) <~word ∪ BRIVLA ∪ tags($b)>
  | $n(cmevla-shape) <~word ∪ CMEVLA ∪ tags($n)>
  | $h(hesitation-shape) <~hesitation ∪ tags($h)>
```

Hesitation is `y` of any length. It is a source word of its own here, because the pause rules hold for it as for any word. It begins with a vowel, so a pause comes before it, unless the family gives it `onset`. The approved word forms read `kyyykerlo` as `ky`, `yy` and `kerlo`, because the first `y` of `yy` is not a nucleus there.

Hesitation needs no pause after it, as the Magic Words proposal says. The word stage drops it, or reads it as the base of the letter word `.y bu`. Two letters `y` never form one syllable, so a comma between them changes nothing, and `y,y` is hesitation as `yy` is (CLL 3.3).

```jbogenbau
%rule hesitation-shape
  $h(y-run) <~continued ∪ ~uncounted ∪ tags($h)>

%rule y-run
  any-y | any-y y-run | any-y /,/ y-run
```

A `y` here is either phoneme of the letter, plain or stressed.

```jbogenbau
%rule any-y
  /y/ | /Y/
```
