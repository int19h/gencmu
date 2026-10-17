# Zantufa word forms

This document is part of the forms stage in the [Zantufa](../dialects/zantufa.md) dialect. The forms stage follows normalization. It divides the phonemes of the text into words. The loader stitches this document into the stage after [bpfk.md](bpfk.md).

The prose uses these Lojban terms for words:

- A cmavo is a particle, a short structure word.
- A gismu is a root word.
- A lujvo is a compound word.
- A rafsi is a shortened word form used inside compounds.

Zantufa 1.9999 reads the working word forms of the BPFK, the Lojban language planning committee, with three changes. This document makes them:

- It permits the consonant pair `mz`.
- It reads `ie'o` as hesitation, as it reads `y`.
- It divides the letters after `ra'oi` into the rafsi or gismu form that `ra'oi` quotes.

The rule names follow Zantufa, while their comments state its morphology constraints, as in bpfk.md. The rest are rules of [forms.md](forms.md) that this document changes, or rules that support them. [The notation document](../../docs/notation.md) explains the notation.

## The pair mz

A diphthong combines two vowels in one syllable. A nucleus is a syllable's vowel or diphthong. A glide is an `i` or `u` before a nucleus. The rule for `m` rejects a following apostrophe, glide or `m`, but permits `z`. Thus `kamzi`, `bamzda` and `.djeimz.` have permissible consonant pairs.

```jbogenbau
%redefine-rule m              (* The consonant m forbids an apostrophe, glide, and another m. It permits z. *)
  $c:"m"
%conditions
  ¬$c.following-tokens.begins(h),
  ¬$c.following-tokens.begins(glide),
  ¬$c.following-tokens.begins(m)
```

<details><summary>Railroad diagram of <code>m</code></summary>
<p><img src="../../docs/diagrams/words/zantufa/m.svg" alt="Railroad diagram of the rule m"></p>
</details>

## Hesitation and space

Zantufa's Y is `y` and `ie'o`, and its `spaces` read both as space. So `ie'o` is hesitation here, as `y` is. The words stage is the stage after the forms stage. It drops the hesitation where it is space, and reads it as the base of a letter word before `bu`. A Y word attached to a word before it is not space ([zantufa-stream.md](zantufa-stream.md)). It keeps the form of a cmavo, so the pause rules hold for it as for any cmavo.

```jbogenbau
%redefine-rule source-word
  (* The lexicon classifies Y forms as hesitation, including ie'o. Other particles remain words.
     *)
  | $c:cmavo-shape :: Word ∪ Cmavo ∪ $c.tags ∪ $c.value.classify(lexicon)
  | $y:cmavo-shape :: Hesitation ∪ $y.tags
  | $b:brivla-shape :: Word ∪ BRIVLA ∪ $b.tags
  | $n:cmevla-shape :: Word ∪ CMEVLA ∪ $n.tags
  | $h:hesitation-shape :: Hesitation ∪ Y-Letters ∪ $h.tags
%conditions
  Y ⊈ $c.value.classify(lexicon),
  Y ⊆ $y.value.classify(lexicon)
```

<details><summary>Railroad diagram of <code>source-word</code></summary>
<p><img src="../../docs/diagrams/words/zantufa/source-word.svg" alt="Railroad diagram of the rule source-word"></p>
</details>

## The ra'oi quote

`ra'oi` quotes a rafsi or gismu form from the letters after it, and the stage reads the rest of the run as words. The quote takes the longest rafsi or gismu form that permits a complete reading. The `leftmost-longest` flag states this preference. Stress separates a complete gismu from a rafsi of the same letters.

The text `ra'oi broda` quotes the gismu `broda` because its `o` is stressed before the pause. The text `ra'oi brodami` quotes the rafsi `brod` and leaves `a` and `mi`. The form can follow `ra'oi` directly, as in `ra'oibroda`, or after a pause and any hesitation, as in `ra'oi .y. broda`. A run can hold several such quotes, as `ra'oi brodyra'oibroda` does.

The stage hands the form on as one token, tagged `Rafsi-Form`, and the words stage makes the quote. A token is one unit that a stage reads or emits. A tag marks a token by an identifier. Where no such form follows, `ra'oi` is an ordinary word, as in Zantufa's `si_word`, so `ra'oi bu` is a letter word. The words stage rejects `ra'oi do`.

A word of LU, TO or LUhEI opens a text of its own. The hesitation after such a word can be space, which the stage tags `Opener-Space` below. The constant `$TEXT-OPENERS` lists these classes. The words stage defines the same constant, because a constant belongs to its stage ([zantufa-stream.md](zantufa-stream.md)).

```jbogenbau
%const $TEXT-OPENERS
  LU ∪ TO ∪ LUhEI
```

This document extends the rule `word-run` of forms.md to read a run in which a form follows `ra'oi`, as in `mira'oibroda`. So `unsegmentable-run` of forms.md never takes such a run.

The redefined `run-words` keeps the conditions of [forms.md](forms.md) on a join. The first of them follows from the second, but it lets the parser drop a join early, as forms.md explains.

```jbogenbau
%redefine-rule runs
  (* Preserve quote state across pauses and hesitation. A quoted form belongs to rahoi-rest, not
     an ordinary run. *)
  | $r:run :: $r.tags
  | $p:runs pause-token $r:run :: $r.tags ∪ (RAhOI ⊆ $p.tags ∧ $r.matches(only-hesitation) ⟹ RAhOI)
  | $q:runs pause-token $s:rahoi-rest :: $s.tags
%conditions
  RAhOI ⊈ $p.tags ∨ ¬$r.matches(rahoi-rest),
  RAhOI ⊆ $q.tags

%extend-rule word-run
  run-words<RAhOI> $s:rahoi-rest :: $s.tags

%redefine-rule run-words
  (* Keep the inherited word joins, stress boundaries, and hesitation spacing. A pending ra'oi
     reserves its quoted form. *)
  | $f:first-word :: $f.tags ∪ (Hesitation ⊆ $f.tags ⟹ Spacing)
  | $r:run-words $v:later-word
      :: $v.tags ∪ (Uncounted ⊆ $v.tags ⟹ Open-Stress ∩ $r.tags)
  | $s:run-words $y:joined-hesitation :: $y.tags
  | $t:run-words $u:space-hesitation :: $u.tags ∪ Spacing
  | $q:run-words $x:space-piece :: $x.tags ∪ Spacing
  | $o:run-words $n:opener-space :: $n.tags ∪ Opener-Space
%conditions
  Y-Letters ⊆ $s.tags,
  (Spacing ∪ Opener-Space) ∩ $s.tags = ∅,
  Spacing ⊆ $q.tags,
  Y-Letters ⊆ $q.tags,
  Spacing ⊆ $t.tags,
  Opener-Space ⊆ $o.tags ∨ $o.classes ∩ $TEXT-OPENERS ≠ ∅,
  Y-Letters ⊈ $t.tags ∨ Y-Letters ⊈ $u.tags,
  Y-Letters ⊈ $r.tags ∨ Y-Letters ⊈ $v.tags,
  Hesitation ⊈ $v.tags ∨ (Spacing ∪ Opener-Space) ∩ $r.tags = ∅ ∧ $r.classes ∩ $TEXT-OPENERS = ∅,
  RAhOI ⊈ $r.tags ∨ ¬$v.onward.begins(rahoi-form),
  (Continued ∪ Cy ∪ Name-Intro ∪ Open-Stress) ∩ $r.tags ≠ ∅,
  Cy ⊆ $r.tags ∧ Cy ⊆ $v.tags
    ∨ Continued ⊆ $r.tags ∧ Open-Stress ⊈ $r.tags ∧ Onset ⊆ $v.tags
    ∨ Name-Intro ⊆ $r.tags ∧ Name-Onset ⊆ $v.tags
    ∨ Open-Stress ⊆ $r.tags ∧ Cy ⊈ $r.tags ∧ Onset ⊆ $v.tags,
  Final-Stress ⊈ $r.tags ∨ (Stress-Guard ∪ Initial-Stress) ∩ $v.tags = ∅,
  Open-Stress ⊈ $r.tags ∨ Uncounted ⊆ $v.tags

%rule rahoi-rest
  (* Read a quoted form and its continuation. Pass quote state through pure hesitation and
     repeated quotes. *)
  | $p:rahoi-form :: ∅
  | rahoi-form $w:rahoi-tail :: $w.tags
  | rahoi-form $v:rahoi-tail $s:rahoi-rest :: $s.tags
  | $h:run-words $t:rahoi-rest :: $t.tags
%conditions
  RAhOI ⊆ $v.tags,
  $h.matches(only-hesitation)

%rule rahoi-tail
  (* The first word after a quoted form is not run-initial. Keep quote state, opener spacing,
     and the existing word joins. *)
  | $v:later-word :: $v.tags
  | $r:rahoi-tail $v:later-word :: $v.tags
  | $s:rahoi-tail $y:joined-hesitation :: $y.tags
  | $o:rahoi-tail $n:opener-space :: $n.tags ∪ Opener-Space
%conditions
  RAhOI ⊈ $r.tags ∨ ¬$v.onward.begins(rahoi-form),
  Y-Letters ⊈ $r.tags ∨ Y-Letters ⊈ $v.tags,
  Hesitation ⊈ $v.tags ∨ Opener-Space ⊈ $r.tags ∧ $r.classes ∩ $TEXT-OPENERS = ∅,
  Y-Letters ⊆ $s.tags,
  Opener-Space ⊈ $s.tags,
  Opener-Space ⊆ $o.tags ∨ $o.classes ∩ $TEXT-OPENERS ≠ ∅

%rule space-hesitation
  (* initial_spaces <- (space_char / !ybu Y)+ EOF? / EOF: after space, every Y word is space *)
  $w:source-word<Hesitation>
%emits
  $ :: $w.tags ∪ Spacing ∪ (¬$w.following-tokens.begins(nonpause-phoneme) ⟹ Run-Final)

%rule opener-space
  (* a hesitation after a text opener, or after such a hesitation: space if that word opens a
     text *)
  $w:source-word<Hesitation>
%emits
  $ :: $w.tags ∪ Opener-Space ∪ (¬$w.following-tokens.begins(nonpause-phoneme) ⟹ Run-Final)

%rule space-piece
  ordinary-space-piece | split-later-y

%rule ordinary-space-piece
  (* Reserve the final y before BU for the letter word, rather than emitting the whole run as
     space. *)
  $w:source-word<Y-Letters>
%conditions
  ¬$w.onward.begins(split-later-y)
%emits
  $ :: $w.tags ∪ Spacing ∪ (¬$w.following-tokens.begins(nonpause-phoneme) ⟹ Run-Final)

%rule only-hesitation
  (* spaces? after RAhOI: a run that is only hesitation, which passes RAhOI on to the run after
     it *)
  first-word<Hesitation> | only-hesitation later-word<Hesitation> | only-hesitation joined-hesitation | silent-token

%rule(leftmost-longest) rahoi-form
  (* The quote takes the longest rafsi or gismu form in a complete reading. Stress separates
     equal-letter forms. *)
  y-rafsi | long-rafsi | y-less-rafsi | gismu
%emits
  $ :: Rafsi-Form ∪ (¬$.following-tokens.begins(nonpause-phoneme) ⟹ Run-Final)
```

<details><summary>Railroad diagrams of the 11 rules from <code>runs</code> to <code>rahoi-form</code></summary>
<p><img src="../../docs/diagrams/words/zantufa/runs.svg" alt="Railroad diagram of the rule runs"></p>
<p><img src="../../docs/diagrams/words/zantufa/word-run.svg" alt="Railroad diagram of the rule word-run"></p>
<p><img src="../../docs/diagrams/words/zantufa/run-words.svg" alt="Railroad diagram of the rule run-words"></p>
<p><img src="../../docs/diagrams/words/zantufa/rahoi-rest.svg" alt="Railroad diagram of the rule rahoi-rest"></p>
<p><img src="../../docs/diagrams/words/zantufa/rahoi-tail.svg" alt="Railroad diagram of the rule rahoi-tail"></p>
<p><img src="../../docs/diagrams/words/zantufa/space-hesitation.svg" alt="Railroad diagram of the rule space-hesitation"></p>
<p><img src="../../docs/diagrams/words/zantufa/opener-space.svg" alt="Railroad diagram of the rule opener-space"></p>
<p><img src="../../docs/diagrams/words/zantufa/space-piece.svg" alt="Railroad diagram of the rule space-piece"></p>
<p><img src="../../docs/diagrams/words/zantufa/ordinary-space-piece.svg" alt="Railroad diagram of the rule ordinary-space-piece"></p>
<p><img src="../../docs/diagrams/words/zantufa/only-hesitation.svg" alt="Railroad diagram of the rule only-hesitation"></p>
<p><img src="../../docs/diagrams/words/zantufa/rahoi-form.svg" alt="Railroad diagram of the rule rahoi-form"></p>
</details>

## Hesitation in the word stream

A whole run of `y` is one hesitation token, whatever its length. It follows the BPFK treatment of hesitation as noise.

The words stage derives space behavior from `Spacing` and its `Y-Letters` test.

Before BU, the forms stage separates the final y from the hesitation prefix. The shared word reader joins that final y with BU. Elsewhere, one attached run stays one hesitation token. An `ie'o` is a Y word of its own, and it never joins one.

A hesitation that begins a run is space. Each hesitation that directly follows a space continues it, up to the next other word, as `initial_spaces` reads it. The stage tags these `Spacing` ([zantufa-stream.md](zantufa-stream.md)).

The stage gives `Opener-Space` to a hesitation directly after a text opener, and each one after it. A text opener is a word of LU, TO or LUhEI, such as `lu`. Such a hesitation is space where the opener opens a text of its own, whose `intro_null` reads space. It is not space where the opener is itself quoted. Only the words stage knows which.

```jbogenbau
%rule joined-hesitation
  ordinary-joined-hesitation | split-later-y

%rule ordinary-joined-hesitation
  (* Reserve the final y before BU for the letter word, rather than emitting the whole attached
     run. *)
  $w:source-word<Y-Letters>
%conditions
  ¬$w.onward.begins(split-later-y)
%emits
  $ :: $w.tags ∪ (¬$w.following-tokens.begins(nonpause-phoneme) ⟹ Run-Final)
```

<details><summary>Railroad diagrams of <code>joined-hesitation</code> and <code>ordinary-joined-hesitation</code></summary>
<p><img src="../../docs/diagrams/words/zantufa/joined-hesitation.svg" alt="Railroad diagram of the rule joined-hesitation"></p>
<p><img src="../../docs/diagrams/words/zantufa/ordinary-joined-hesitation.svg" alt="Railroad diagram of the rule ordinary-joined-hesitation"></p>
</details>

## Differences from CLL and BPFK

*The Complete Lojban Language* (CLL) forbids the consonant pair `mz`.[^cll-s3-6] The BPFK working morphology also forbids it. Its letter rule for `m` refuses a following `z`.

Zantufa's letter rule for `m` refuses only another `m` among the consonants. camxes-exp, the experimental grammar of the camxes parser, does the same. So Zantufa accepts `mz` wherever a permissible pair can stand. Examples are the gismu `kamzi`, the lujvo `bamzda` and the name `.djeimz.`.

The other changes that camxes-exp makes to the word forms, in [experimental.md](experimental.md), are not Zantufa's.

Zantufa's `Y` reads a whole run of `y` as one token, so its `spaces` treats the whole run as space. This grammar also reads each run whole, including attached hesitation that the words stage retains. The reference particle rule instead divides an odd attached run into one y and the even remainder. The whole-run rule follows the BPFK treatment of hesitation as noise.

Erasure can observe this division. In `ra'oi brodyyyy si si`, the quoted `brody` leaves one hesitation token. The first `si` erases the hesitation, and the second erases the quote. The reference division leaves two hesitation tokens, so two erasures retain the quote.

The split before BU still separates the final y from its prefix. The words stage forms the letter word from that y and BU. The `Spacing` and `Y-Letters` tags preserve the existing space behavior.

The quote after `ra'oi` takes the longest form within a complete reading. This replaces the reference's local commitment to its first matching form. If a longer form leaves no valid continuation, a shorter form can complete the text. This policy uses the existing `leftmost-longest` flag and introduces no ordered choice.

[^cll-s3-6]: [CLL 1.1, section 3.6](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-clusters.html).
