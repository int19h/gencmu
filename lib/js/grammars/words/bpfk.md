# BPFK working word forms

This document is the family part of the forms stage in the [BPFK](../dialects/bpfk.md), [experimental](../dialects/experimental.md) and [Zantufa](../dialects/zantufa.md) dialects. A stage is one step of a pipeline, with its own grammar ([engine §1](../../docs/engine.md#1-tokens)). A family is a set of word forms that dialects use.

A token is one unit that a stage reads or emits. A token's value is the string that exact comparisons read. Its image is the string that people see.

The loader stitches this document in after [forms.md](forms.md). The experimental dialect stitches [experimental.md](experimental.md) after it, and the Zantufa dialect stitches [zantufa.md](zantufa.md). [The notation document](../../docs/notation.md) explains jbogenbau, the notation of these grammars.

This document gives the working word-form grammar of the BPFK, the Lojban language planning committee. It derives from the morphology part of `camxes.peg`, a parsing expression grammar (PEG). The executable baseline is ilmentufa commit [`778ea138f7d150121ca722db7536ce3b123943ac`](https://github.com/lojban/ilmentufa/blob/778ea138f7d150121ca722db7536ce3b123943ac/camxes.peg). [CLL 1.3.4](https://github.com/int19h/cll/blob/v1.3.4/chapters/a02.xml) (*The Complete Lojban Language*) prints that grammar in appendix A2.

The prose uses these Lojban terms for words:

- A cmavo is a particle, a short structure word.
- A selma'o is a word class of cmavo.
- A brivla is a predicate word.
- A cmevla is a name word.
- A gismu is a root word.
- A lujvo is a compound word.
- A rafsi is a shortened word form used inside compounds.

Where a rule corresponds to a PEG rule, its name uses lowercase letters and hyphens for underscores. Other named parts support conditions or expose a word-form restriction. C denotes a consonant. V denotes `a`, `e`, `i`, `o`, or `u`.

## How this grammar states the morphology

A diphthong combines two vowels in one syllable. A nucleus is the vowel or diphthong of a syllable. A glide is an `i` or `u` before a nucleus. An onset is the part of a syllable before its nucleus. A coda is the consonant part after a nucleus.

This grammar states the morphology's rules directly. Its alternatives have no order. It retains PEG lookaheads where they state word shapes, stress, hyphens, or word boundaries. A lookahead tests the text without consuming it. The conditions use `begins` to test starts, including text beyond the word and before the next pause. They use `matches` to test a complete captured span.

Different letters or incompatible conditions separate most alternatives. Other alternatives overlap as prefixes, but only one can complete the surrounding word. Their comments and the prose name the letters, stress, hyphens, or boundaries that force completion. At the end of a lookahead, alternative endpoints need no preference because the test asks only whether a form begins. Inside a lookahead, optionals and repetitions need the same exclusion or completion argument as consumed ones.

Plain optionals and repetitions express parts whose presence or count follows from their context. A shorter name body leaves a letter that the required final consonant cannot absorb before the pause. A shorter nucleus-apostrophe run leaves an apostrophe where the last nucleus must begin. A shorter unstressed rafsi or syllable run cannot reach the stressed core or its required hyphen. Consonantal syllables cannot consume the start of a following vowel-bearing syllable. A following rafsi cannot start with an apostrophe or the consonant pair that an r-hyphen supplies.

Where two stress tests apply to the same constituent, one alternative joins their conditions with `∨`. The grammar gives names one general shape and gives a final coda one form per nonempty length. These forms remove duplicate proofs of the same word. The closing section explains deliberate differences from camxes-std.

## Words

The phoneme stage supplies phoneme and pause tokens. A stressed vowel has a lowercase value and the `Stressed` tag. The forms stage reads names, particles, predicate words, and hesitation. Names end in consonants before a pause. Particles exclude names, and predicate words cannot complete at a particle start, as the Brivla section explains. A predicate word's final syllable excludes a following name, so it cannot take the front of one.

The document [forms.md](forms.md) says how words join.

The word-boundary conditions decide which words can stand together without a pause. Every word carries `Continued`, so its own rules permit a following word without a pause. A word carries `Onset` when no nucleus begins it. Only such a word can follow another directly.

The PEG's `CMAVO` is a list of the selma'o, each a set of spellings, followed by `cmavo` for every other cmavo. Each selma'o rule begins with `&cmavo` and ends with `&post_word`. Every spelling except `ybu` reads exactly what `cmavo` reads, and the lexicon gives each cmavo its selma'o.

A whole run of `y` letters is one hesitation token, whatever its length. The [Magic Words proposal](https://mw.lojban.org/papri/Magic_Words) says that `y` is not a word and counts as whitespace. Thus `.yyy.` is one token here. The separate split before `bu` preserves letter words, as [the ybu exception](#the-ybu-exception) explains.

`cmavo-shape` reads `cmavo`. A cmavo made only of `y` letters is hesitation, which [forms.md](forms.md) reads as `y-run`, so this document redefines `y-run` as that cmavo.

A `y` is a nucleus exactly where no nucleus follows it. So the first `y` of a run is a nucleus exactly when the run has an odd number of letters. A run with an even number can follow a word directly: `kyyykerlo` is `ky yy kerlo`, but `bayyy` is no text. So a run of `y` has `Onset` where no nucleus begins it.

Ilmentufa's morphology-only parser accepts this division of `kyyykerlo`, but full camxes-std rejects the text. Its lexer wrapper calls `spaces` after `ky`, and that rule refuses a leading Y token. The [shared forms document](forms.md#differences-from-camxes) compares the word streams.

### Whole hesitation runs

The camxes-std [morphology-only parser](https://github.com/lojban/ilmentufa/blob/778ea138f7d150121ca722db7536ce3b123943ac/camxes-morpho.js) splits a bare odd y run through its `cmavo_form` onset alternative. Its `initial_spaces` reader instead reads a whole run. The [full camxes-std parser](https://github.com/lojban/ilmentufa/blob/778ea138f7d150121ca722db7536ce3b123943ac/camxes.js) uses that whole-run spacing reading. Both reference parsers keep every y inside the `ybu` letter word before BU.

This grammar excludes pure y from the onset alternative and reads the whole run as hesitation. Thus `.yyy.` is one hesitation token, in agreement with camxes-std's spacing rule. The [Magic Words proposal](https://mw.lojban.org/papri/Magic_Words) says that `y` is not a word and counts as whitespace. The words stage drops this hesitation in BPFK and experimental. Zantufa can retain attached hesitation, so its erasure can observe the whole-run division.

```jbogenbau
%rule cmevla-shape  (* A name carries its join property and an onset mark when it does not begin with a nucleus. *)
  $n:cmevla :: Continued ∪ (¬$n.onward.begins(nucleus) ⟹ Onset)

%rule cmavo-shape  (* Ordinary particles exclude pure y hesitation. Onset marks a word that can follow another without a pause. *)
  $c:cmavo :: Continued ∪ (¬$c.onward.begins(nucleus) ⟹ Onset)
%conditions
  ¬$c.matches(y-letters)

%rule brivla-shape  (* A predicate word carries its join and onset properties. *)
  $b:brivla-word :: Continued ∪ (¬$b.onward.begins(nucleus) ⟹ Onset)

%redefine-rule y-run  (* Pure hesitation keeps the complete particle boundary and its onset requirement. *)
  $h:cmavo :: (¬$h.onward.begins(nucleus) ⟹ Onset)
%conditions
  $h.matches(y-letters)

%rule y-letters               (* a run of y letters, which a condition tests *)
  "y" | "y" y-letters
```

<details><summary>Railroad diagrams of the 5 rules from <code>cmevla-shape</code> to <code>y-letters</code></summary>
<p><img src="../../docs/diagrams/words/bpfk/cmevla-shape.svg" alt="Railroad diagram of the rule cmevla-shape"></p>
<p><img src="../../docs/diagrams/words/bpfk/cmavo-shape.svg" alt="Railroad diagram of the rule cmavo-shape"></p>
<p><img src="../../docs/diagrams/words/bpfk/brivla-shape.svg" alt="Railroad diagram of the rule brivla-shape"></p>
<p><img src="../../docs/diagrams/words/bpfk/y-run.svg" alt="Railroad diagram of the rule y-run"></p>
<p><img src="../../docs/diagrams/words/bpfk/y-letters.svg" alt="Railroad diagram of the rule y-letters"></p>
</details>



The PEG's `lojban_word` is what `post_word` looks for after a word.

```jbogenbau
%rule lojban-word  (* A legal word is a name, a particle, or a predicate word. Their own conditions separate the classes. *)
  cmevla | cmavo | brivla-word

%rule brivla-word  (* Predicate words are roots, compounds, or borrowings. Root stress and consonant clusters prevent a particle reading. Lujvo exclude roots and borrowings. Borrowing heads exclude root-shaped rafsi strings. *)
  gismu | lujvo | fuhivla

%rule lujvo  (* A compound is a predicate word that is neither a root nor a borrowing. *)
  $b:brivla
%conditions
  ¬$b.onward.begins(gismu | fuhivla)

%rule post-word  (* A word ends before a pause or a legal next word. Without a pause, the next word cannot start with a nucleus. *)
  | pause
  | $w:lojban-word
%conditions
  ¬$w.onward.begins(nucleus)

%rule pause                   (* `pause <- comma* space_char+ / EOF`. A pause test accepts a pause token or the end of input. *)
  PAUSE | end-of-text

%rule end-of-text  (* Require the end of input. *)
  ε
%conditions
  $.following-tokens.matches(nothing)

%rule nothing  (* The empty text serves the end-of-input test. *)
  ε
```

<details><summary>Railroad diagrams of the 7 rules from <code>lojban-word</code> to <code>nothing</code></summary>
<p><img src="../../docs/diagrams/words/bpfk/lojban-word.svg" alt="Railroad diagram of the rule lojban-word"></p>
<p><img src="../../docs/diagrams/words/bpfk/brivla-word.svg" alt="Railroad diagram of the rule brivla-word"></p>
<p><img src="../../docs/diagrams/words/bpfk/lujvo.svg" alt="Railroad diagram of the rule lujvo"></p>
<p><img src="../../docs/diagrams/words/bpfk/post-word.svg" alt="Railroad diagram of the rule post-word"></p>
<p><img src="../../docs/diagrams/words/bpfk/pause.svg" alt="Railroad diagram of the rule pause"></p>
<p><img src="../../docs/diagrams/words/bpfk/end-of-text.svg" alt="Railroad diagram of the rule end-of-text"></p>
<p><img src="../../docs/diagrams/words/bpfk/nothing.svg" alt="Railroad diagram of the rule nothing"></p>
</details>



## Cmevla

A name is a run of letters that ends in a consonant before a pause. The repeated sounds exclude that final consonant, so only one repetition count reaches it. The PEG also offers a syllabified name shape, which requires the same general shape and ends at the same pause. The single `zifcme` form covers both name readings without duplicate proofs.

```jbogenbau
%rule cmevla  (* A name needs the general name shape. The syllabified name shape requires that same shape and ends at the same pause. *)
  zifcme

%rule zifcme  (* A name forbids an initial apostrophe and ends in a consonant before a pause. *)
  [{zifcme-sound}] $c:consonant
%conditions
  ¬$.onward.begins(h),
  $c.following-tokens.begins(pause)

%rule zifcme-sound  (* An apostrophe and a consonant use distinct letters. A glide requires a following nucleus, which a vowel forbids. Reserve the pause-final consonant for zifcme. *)
  | nucleus
  | glide
  | h
  | $c:consonant
%conditions
  ¬$c.following-tokens.begins(pause)

```

<details><summary>Railroad diagrams of <code>cmevla</code>, <code>zifcme</code> and <code>zifcme-sound</code></summary>
<p><img src="../../docs/diagrams/words/bpfk/cmevla.svg" alt="Railroad diagram of the rule cmevla"></p>
<p><img src="../../docs/diagrams/words/bpfk/zifcme.svg" alt="Railroad diagram of the rule zifcme"></p>
<p><img src="../../docs/diagrams/words/bpfk/zifcme-sound.svg" alt="Railroad diagram of the rule zifcme-sound"></p>
</details>



## Cmavo

A cmavo is not the start of a name, and not the start of a lujvo that begins with a CVC rafsi and a y-hyphen. Its form is an onset and nuclei joined by apostrophes, or a run of `y`. A pause or another word follows it. `CVCy_lujvo` is what keeps `bajykla` one lujvo, and not `ba jy kla`.

```jbogenbau
%rule cmavo  (* A particle excludes a name start and a CVCy compound start. It ends at a complete word boundary. *)
  $f:cmavo-form
%conditions
  ¬$f.onward.begins(cmevla | cvcy-lujvo),
  $f.following-tokens.begins(post-word)

%rule cvcy-lujvo  (* Detect a CVC rafsi with a y-hyphen before the compound core. Stress separates the two forms. Unhyphenated initial rafsi cannot start where the core starts, because of stress and their own exclusions. Only a lookahead. *)
  | cvc-rafsi y [h] [{initial-rafsi}] brivla-core
  | stressed-cvc-rafsi y short-final-rafsi

%rule cmavo-form  (* A particle has an onset form or is a whole hesitation run. Pure y letters belong only to hesitation. *)
  | $f:cmavo-form-with-onset
  | ys
%conditions
  ¬$f.matches(y-letters)

%rule cmavo-form-with-onset  (* A particle forbids an apostrophe or cluster at its start. Each inner nucleus needs its apostrophe. The final nucleus cannot consume that apostrophe. *)
  $o:onset [{nucleus h}] cmavo-last-nucleus
%conditions
  ¬$o.onward.begins(h | cluster)

```

<details><summary>Railroad diagrams of the 4 rules from <code>cmavo</code> to <code>cmavo-form-with-onset</code></summary>
<p><img src="../../docs/diagrams/words/bpfk/cmavo.svg" alt="Railroad diagram of the rule cmavo"></p>
<p><img src="../../docs/diagrams/words/bpfk/cvcy-lujvo.svg" alt="Railroad diagram of the rule cvcy-lujvo"></p>
<p><img src="../../docs/diagrams/words/bpfk/cmavo-form.svg" alt="Railroad diagram of the rule cmavo-form"></p>
<p><img src="../../docs/diagrams/words/bpfk/cmavo-form-with-onset.svg" alt="Railroad diagram of the rule cmavo-form-with-onset"></p>
</details>



The last nucleus of a cmavo is unstressed, or it is not followed by a consonant cluster. So `MIklama` is not `mI klama`. One condition covers both reasons for the same nucleus.

```jbogenbau
%rule cmavo-last-nucleus  (* A particle ends in an unstressed nucleus, or in a nucleus with no following consonant cluster. One nucleus covers both cases. *)
  $n:nucleus
%conditions
  ¬$n.onward.begins(stressed) ∨ ¬$n.following-tokens.begins(cluster)

%rule ys  (* Hesitation occupies a whole run of y letters. A shorter prefix cannot end before another y. *)
  {y}
%conditions
  ¬$.following-tokens.begins(y)

```

<details><summary>Railroad diagrams of <code>cmavo-last-nucleus</code> and <code>ys</code></summary>
<p><img src="../../docs/diagrams/words/bpfk/cmavo-last-nucleus.svg" alt="Railroad diagram of the rule cmavo-last-nucleus"></p>
<p><img src="../../docs/diagrams/words/bpfk/ys.svg" alt="Railroad diagram of the rule ys"></p>
</details>



## Brivla

A gismu has CCVCV or CVCCV shape. A CCVCV gismu begins with a consonant cluster, which a cmavo forbids. In a CVCCV gismu, the first vowel is stressed before a cluster, which the last cmavo nucleus forbids. Thus a gismu cannot complete at a cmavo start, even though its branch bypasses the `brivla` rule.

The `brivla` rule excludes cmavo starts directly. Unstressed initial rafsi precede its core, which contains the stressed syllable. The borrowing head excludes rafsi strings, including gismu starts, so a borrowing and a gismu cannot complete together. The `lujvo` conditions exclude both gismu and borrowings from compounds. The other cores differ in consonant positions, apostrophes, hyphens, or stress.

No syllable of a borrowing has `y` as its nucleus. A borrowing cannot cross a y-hyphen. Its head excludes the rafsi strings that describe the classical cores. A CVV final has an apostrophe where neither gismu shape permits one.

A stressed initial rafsi with a short final either contains a hyphen or differs from those shapes in letters or stress. A short final's diphthong cannot split into a gismu's final vowel and another word, because that vowel forbids a following nucleus. The first vowel of a stressed CVV rafsi's apostrophe form is unstressed, while a CVV final's first vowel is stressed.

A stressed extended brivla rafsi needs an unstressed first syllable and apostrophe-y after its head. A stressed CCV rafsi lacks that unstressed first syllable. After a long y-rafsi's stressed CCV prefix, consonant-y cannot start the required short final. An apostrophe after a stressed CVV rafsi also cannot start that final.

```jbogenbau
%rule brivla  (* A predicate word cannot start where a particle begins. Unstressed initial rafsi precede its stressed core. *)
  [{initial-rafsi}] brivla-core
%conditions
  ¬$.onward.begins(cmavo)

%rule brivla-core  (* Borrowing heads exclude rafsi strings. The other cores differ in consonant positions, apostrophes, hyphens, or stress. *)
  | fuhivla
  | gismu
  | cvv-final-rafsi
  | stressed-initial-rafsi short-final-rafsi

%rule stressed-initial-rafsi  (* Extended brivla forms need an unstressed first syllable and apostrophe-y. Borrowing heads exclude rafsi strings. After a long y-rafsi's CCV prefix, consonant-y cannot start the required short final. An apostrophe after CVV cannot start it either. A CVC rafsi forbids following y. *)
  stressed-extended-rafsi | stressed-y-rafsi | stressed-y-less-rafsi

```

<details><summary>Railroad diagrams of <code>brivla</code>, <code>brivla-core</code> and <code>stressed-initial-rafsi</code></summary>
<p><img src="../../docs/diagrams/words/bpfk/brivla.svg" alt="Railroad diagram of the rule brivla"></p>
<p><img src="../../docs/diagrams/words/bpfk/brivla-core.svg" alt="Railroad diagram of the rule brivla-core"></p>
<p><img src="../../docs/diagrams/words/bpfk/stressed-initial-rafsi.svg" alt="Railroad diagram of the rule stressed-initial-rafsi"></p>
</details>



A short rafsi without a y-hyphen cannot start an extended rafsi or borrowing, or stand directly before one. Thus `spageti'ybroda` begins with `spageti'y`, and `selspageti` is one borrowing. The short form excludes y-rafsi and apostrophe-y forms through `y-less-rafsi`, and extended forms through `any-extended-rafsi`.

An initial borrowing rafsi needs an unstressed first syllable and excludes ordinary rafsi strings. A brivla rafsi needs two syllables before apostrophe-y, while a borrowing rafsi forbids that apostrophe onset. An ordinary y-rafsi cannot supply those two syllables before apostrophe-y. The stressed forms also need the short final described above, so a matching CCV prefix cannot complete both alternatives.

```jbogenbau
%rule initial-rafsi  (* A short unhyphenated rafsi cannot start or directly precede an extended rafsi or borrowing. It excludes y-rafsi and hy-rafsi through y-less-rafsi, and extended forms through any-extended-rafsi. Initial borrowing rafsi need an unstressed first syllable. Extended brivla forms need two syllables before apostrophe-y. The stressed counterparts also need a short final that cannot start with consonant-y or apostrophe. *)
  | extended-rafsi
  | y-rafsi
  | $l:y-less-rafsi
%conditions
  ¬$l.onward.begins(any-extended-rafsi),
  ¬$l.following-tokens.begins(any-extended-rafsi)

%rule any-extended-rafsi      (* `any_extended_rafsi <- fuhivla / extended_rafsi / stressed_extended_rafsi`. The test detects a borrowing or either extended rafsi form. *)
  fuhivla | extended-rafsi | stressed-extended-rafsi
```

<details><summary>Railroad diagrams of <code>initial-rafsi</code> and <code>any-extended-rafsi</code></summary>
<p><img src="../../docs/diagrams/words/bpfk/initial-rafsi.svg" alt="Railroad diagram of the rule initial-rafsi"></p>
<p><img src="../../docs/diagrams/words/bpfk/any-extended-rafsi.svg" alt="Railroad diagram of the rule any-extended-rafsi"></p>
</details>



## Borrowings and extended rafsi

A consonantal syllable has a consonant as its center. A borrowing is a head of unstressed syllables, a stressed syllable, any number of consonantal syllables and a final syllable. Its head does not begin with a string of rafsi, and it is not a cmavo or a consonant followed by a string of rafsi. That last test is the slinku'i test of CLL[^cll-s4-7].

An extended rafsi lets a brivla or a borrowing, whole or cut short, stand before a y-hyphen inside a compound. A `brivla_rafsi` is a head of two syllables or more, followed by `'y`, as `klama'y` in `klama'ybroda`. A `fuhivla_rafsi` is the head of a borrowing followed by an onset and `y`. The onset is a consonant, as in `aktyiismu`, or a glide, as in `spageiybroda`. Each has a stressed form, which stands before a short final rafsi.

```jbogenbau
%rule fuhivla  (* A borrowing ends with its stressed syllable and final syllable. A vowel-bearing final syllable cannot start with a consonantal syllable. *)
  fuhivla-head stressed-syllable [{consonantal-syllable}] final-syllable

%rule stressed-extended-rafsi  (* The stressed brivla form requires an apostrophe after its head. The stressed borrowing form forbids that onset at its fixed boundary. *)
  stressed-brivla-rafsi | stressed-fuhivla-rafsi

%rule extended-rafsi  (* A brivla rafsi requires an apostrophe after its head. A borrowing rafsi forbids that onset. The complete heads fix that boundary. *)
  brivla-rafsi | fuhivla-rafsi

%rule stressed-brivla-rafsi  (* A stressed extended brivla rafsi needs an unstressed first syllable before its stressed end and apostrophe-y. *)
  $b:brivla-head stressed-syllable h y
%conditions
  $b.onward.begins(unstressed-syllable)

%rule brivla-rafsi  (* A whole brivla head before apostrophe-y needs at least two syllables. A following rafsi cannot start with the optional apostrophe. *)
  brivla-head h y [h]
%conditions
  $.onward.begins(two-syllables)

%rule two-syllables  (* Require two vowel-bearing syllables. A consonantal syllable cannot consume the start of the second one. *)
  syllable [{consonantal-syllable}] syllable

%rule stressed-fuhivla-rafsi  (* A stressed borrowing rafsi ends before y. Its onset cannot be an apostrophe. *)
  fuhivla-head stressed-syllable [{consonantal-syllable}] $o:onset y
%conditions
  ¬$o.onward.begins(h)

%rule fuhivla-rafsi  (* A borrowing rafsi starts with an unstressed syllable and forbids an apostrophe onset after its head. A following rafsi cannot start with apostrophe. *)
  $f:fuhivla-head onset y [h]
%conditions
  $f.onward.begins(unstressed-syllable),
  ¬$f.following-tokens.begins(h)

%rule fuhivla-head  (* A borrowing head cannot begin with a rafsi string. *)
  $b:brivla-head
%conditions
  ¬$b.onward.begins(rafsi-string)

%rule brivla-head  (* An unstressed head requires an onset and excludes particles, slinku'i forms, and apostrophe starts. The following stress or hyphen fixes its length. *)
  [{unstressed-syllable}]
%conditions
  ¬$.onward.begins(cmavo | slinkuhi | h),
  $.onward.begins(syllable-onset)

%rule slinkuhi  (* A slinku'i form starts with a consonant plus a rafsi string, but the whole start is not itself a rafsi string. Only a lookahead. *)
  $c:consonant rafsi-string
%conditions
  ¬$c.onward.begins(rafsi-string)
```

<details><summary>Railroad diagrams of the 11 rules from <code>fuhivla</code> to <code>slinkuhi</code></summary>
<p><img src="../../docs/diagrams/words/bpfk/fuhivla.svg" alt="Railroad diagram of the rule fuhivla"></p>
<p><img src="../../docs/diagrams/words/bpfk/stressed-extended-rafsi.svg" alt="Railroad diagram of the rule stressed-extended-rafsi"></p>
<p><img src="../../docs/diagrams/words/bpfk/extended-rafsi.svg" alt="Railroad diagram of the rule extended-rafsi"></p>
<p><img src="../../docs/diagrams/words/bpfk/stressed-brivla-rafsi.svg" alt="Railroad diagram of the rule stressed-brivla-rafsi"></p>
<p><img src="../../docs/diagrams/words/bpfk/brivla-rafsi.svg" alt="Railroad diagram of the rule brivla-rafsi"></p>
<p><img src="../../docs/diagrams/words/bpfk/two-syllables.svg" alt="Railroad diagram of the rule two-syllables"></p>
<p><img src="../../docs/diagrams/words/bpfk/stressed-fuhivla-rafsi.svg" alt="Railroad diagram of the rule stressed-fuhivla-rafsi"></p>
<p><img src="../../docs/diagrams/words/bpfk/fuhivla-rafsi.svg" alt="Railroad diagram of the rule fuhivla-rafsi"></p>
<p><img src="../../docs/diagrams/words/bpfk/fuhivla-head.svg" alt="Railroad diagram of the rule fuhivla-head"></p>
<p><img src="../../docs/diagrams/words/bpfk/brivla-head.svg" alt="Railroad diagram of the rule brivla-head"></p>
<p><img src="../../docs/diagrams/words/bpfk/slinkuhi.svg" alt="Railroad diagram of the rule slinkuhi"></p>
</details>



The slinku'i test and a borrowing's head look for a string of rafsi. That is any number of rafsi without a y-hyphen, and then a part that can end a lujvo or that has a y-hyphen. The PEG uses it only in lookaheads.

```jbogenbau
%rule rafsi-string  (* Detect a string of rafsi. The stressed ending or y boundary fixes the unstressed prefix. Only a lookahead. *)
  [{y-less-rafsi}] rafsi-string-end

%rule rafsi-string-end        (* `gismu / CVV_final_rafsi / stressed_y_less_rafsi short_final_rafsi / y_rafsi / stressed_y_rafsi / stressed_y_less_rafsi? initial_pair y / hy_rafsi / stressed_hy_rafsi`. The test detects a compound ending or a y-hyphen boundary. *)
  | gismu
  | cvv-final-rafsi
  | stressed-y-less-rafsi short-final-rafsi
  | y-rafsi
  | stressed-y-rafsi
  | [stressed-y-less-rafsi] initial-pair y  (* A stressed CVC or CVV rafsi differs from initial-pair in its second letter. A stressed CCV rafsi has a vowel where the following y is required. So the optional cannot consume the required pair. *)
  | hy-rafsi
  | stressed-hy-rafsi

```

<details><summary>Railroad diagrams of <code>rafsi-string</code> and <code>rafsi-string-end</code></summary>
<p><img src="../../docs/diagrams/words/bpfk/rafsi-string.svg" alt="Railroad diagram of the rule rafsi-string"></p>
<p><img src="../../docs/diagrams/words/bpfk/rafsi-string-end.svg" alt="Railroad diagram of the rule rafsi-string-end"></p>
</details>



## Rafsi

The core of a brivla ends it, and a pause or another word follows it. Its final syllable has a nucleus with no stress mark and is not followed by a name.

```jbogenbau
%rule gismu  (* A root ends with a valid final syllable at a complete word boundary. *)
  gismu-start $c:consonant $v:vowel
%conditions
  $c.onward.begins(final-syllable),
  $v.following-tokens.begins(post-word)

%rule gismu-start             (* `initial_pair stressed_vowel / consonant stressed_vowel consonant`. The second letter is a consonant in one form and a vowel in the other. *)
  initial-pair stressed-vowel | consonant stressed-vowel consonant

%rule cvv-final-rafsi  (* A CVV final rafsi ends with a valid final syllable at a complete word boundary. *)
  consonant stressed-vowel h $v:vowel
%conditions
  $v.onward.begins(final-syllable),
  $v.following-tokens.begins(post-word)

%rule short-final-rafsi  (* A short final rafsi forms a valid final syllable at a complete word boundary. *)
  $r:short-final-body
%conditions
  $r.onward.begins(final-syllable),
  $r.following-tokens.begins(post-word)

%rule short-final-body        (* `consonant diphthong / initial_pair vowel`. The second letter is a vowel in one form and a consonant in the other. *)
  consonant diphthong | initial-pair vowel

%rule stressed-y-rafsi  (* A stressed long rafsi or CVC rafsi ends before y. The forms differ in their second letter, or a consonant follows the CVC prefix before the long form reaches y. *)
  stressed-long-rafsi y | stressed-cvc-rafsi y

%rule stressed-y-less-rafsi  (* CVC, CCV, and CVV differ in their second or third letter. The CVC form cannot end directly before y. *)
  | $c:stressed-cvc-rafsi
  | stressed-ccv-rafsi
  | stressed-cvv-rafsi
%conditions
  ¬$c.following-tokens.begins(y)

%rule stressed-long-rafsi     (* `stressed_long_rafsi <- initial_pair stressed_vowel consonant / consonant stressed_vowel consonant consonant`. The forms differ in their second letter. *)
  initial-pair stressed-vowel consonant | consonant stressed-vowel consonant consonant

%rule stressed-cvc-rafsi      (* A stressed CVC rafsi has a stressed vowel between two consonants. *)
  consonant stressed-vowel consonant

%rule stressed-ccv-rafsi      (* A stressed CCV rafsi ends in a stressed vowel after an initial consonant pair. *)
  initial-pair stressed-vowel

%rule stressed-cvv-rafsi      (* A stressed CVV rafsi begins with a consonant. Its apostrophe form stresses the second vowel. Its diphthong form stresses the diphthong. An r-hyphen can follow either form. *)
  consonant stressed-cvv-body [r-hyphen]

%rule stressed-cvv-body       (* `unstressed_vowel h stressed_vowel / stressed_diphthong`. The second letter is an apostrophe in one form and a vowel in the other. *)
  unstressed-vowel h stressed-vowel | stressed-diphthong

%rule y-rafsi  (* A long rafsi or CVC rafsi ends before y. The forms differ in their second letter, or a consonant follows the CVC prefix before the long form reaches y. The following rafsi cannot start with apostrophe. *)
  (long-rafsi | cvc-rafsi) y [h]

%rule y-less-rafsi  (* An unhyphenated rafsi excludes y-rafsi, hy-rafsi, and their stressed forms at its start. It cannot end directly before an apostrophe. *)
  $r:y-less-rafsi-body
%conditions
  ¬$r.onward.begins(y-rafsi | stressed-y-rafsi | hy-rafsi | stressed-hy-rafsi),
  ¬$r.following-tokens.begins(h)

%rule y-less-rafsi-body       (* `CVC_rafsi / CCV_rafsi / CVV_rafsi`. CVC and CCV differ in their second letter. CVC and CVV differ in their third letter. CCV and CVV differ in their second letter. *)
  cvc-rafsi | ccv-rafsi | cvv-rafsi
```

<details><summary>Railroad diagrams of the 15 rules from <code>gismu</code> to <code>y-less-rafsi-body</code></summary>
<p><img src="../../docs/diagrams/words/bpfk/gismu.svg" alt="Railroad diagram of the rule gismu"></p>
<p><img src="../../docs/diagrams/words/bpfk/gismu-start.svg" alt="Railroad diagram of the rule gismu-start"></p>
<p><img src="../../docs/diagrams/words/bpfk/cvv-final-rafsi.svg" alt="Railroad diagram of the rule cvv-final-rafsi"></p>
<p><img src="../../docs/diagrams/words/bpfk/short-final-rafsi.svg" alt="Railroad diagram of the rule short-final-rafsi"></p>
<p><img src="../../docs/diagrams/words/bpfk/short-final-body.svg" alt="Railroad diagram of the rule short-final-body"></p>
<p><img src="../../docs/diagrams/words/bpfk/stressed-y-rafsi.svg" alt="Railroad diagram of the rule stressed-y-rafsi"></p>
<p><img src="../../docs/diagrams/words/bpfk/stressed-y-less-rafsi.svg" alt="Railroad diagram of the rule stressed-y-less-rafsi"></p>
<p><img src="../../docs/diagrams/words/bpfk/stressed-long-rafsi.svg" alt="Railroad diagram of the rule stressed-long-rafsi"></p>
<p><img src="../../docs/diagrams/words/bpfk/stressed-cvc-rafsi.svg" alt="Railroad diagram of the rule stressed-cvc-rafsi"></p>
<p><img src="../../docs/diagrams/words/bpfk/stressed-ccv-rafsi.svg" alt="Railroad diagram of the rule stressed-ccv-rafsi"></p>
<p><img src="../../docs/diagrams/words/bpfk/stressed-cvv-rafsi.svg" alt="Railroad diagram of the rule stressed-cvv-rafsi"></p>
<p><img src="../../docs/diagrams/words/bpfk/stressed-cvv-body.svg" alt="Railroad diagram of the rule stressed-cvv-body"></p>
<p><img src="../../docs/diagrams/words/bpfk/y-rafsi.svg" alt="Railroad diagram of the rule y-rafsi"></p>
<p><img src="../../docs/diagrams/words/bpfk/y-less-rafsi.svg" alt="Railroad diagram of the rule y-less-rafsi"></p>
<p><img src="../../docs/diagrams/words/bpfk/y-less-rafsi-body.svg" alt="Railroad diagram of the rule y-less-rafsi-body"></p>
</details>



A rafsi followed by `'y` is a `hy_rafsi`. The BPFK grammar uses it only to end a rafsi string in a lookahead. The experimental layer also uses it inside compounds. A long CCVCV form leaves a consonant after its CCV prefix, where the shorter branch requires an apostrophe. The CVV form differs in its second or third letter. Thus only one branch reaches apostrophe-y.

```jbogenbau
%rule hy-rafsi                (* An apostrophe-y rafsi ends its classical body with apostrophe-y. Another apostrophe can follow the hyphen. *)
  hy-rafsi-body h y [h]

%rule hy-rafsi-body  (* A long CCVCV form leaves a consonant after CCV, so only one reaches apostrophe-y. CVV differs in its second or third letter. *)
  long-rafsi-vowel | ccv-rafsi | cvv-rafsi

%rule long-rafsi-vowel        (* The long classical form appends a vowel to a long rafsi. *)
  long-rafsi vowel

%rule stressed-hy-rafsi       (* A stressed apostrophe-y rafsi ends its stressed classical body with apostrophe-y. *)
  stressed-hy-rafsi-body h y

%rule stressed-hy-rafsi-body  (* CVV differs in its second or third letter. The long form differs from stressed CCV in its second letter or third-letter stress. *)
  long-rafsi-stressed-vowel | stressed-ccv-rafsi | stressed-cvv-rafsi

%rule long-rafsi-stressed-vowel  (* The stressed long classical form appends a stressed vowel to an unstressed long rafsi. *)
  long-rafsi stressed-vowel

%rule long-rafsi              (* `long_rafsi <- initial_pair unstressed_vowel consonant / consonant unstressed_vowel consonant consonant`. The forms differ in their second letter. *)
  initial-pair unstressed-vowel consonant | consonant unstressed-vowel consonant consonant

%rule cvc-rafsi               (* A CVC rafsi has an unstressed vowel between two consonants. *)
  consonant unstressed-vowel consonant

%rule ccv-rafsi               (* A CCV rafsi ends in an unstressed vowel after an initial consonant pair. *)
  initial-pair unstressed-vowel

%rule cvv-rafsi               (* A CVV rafsi begins with a consonant. It has two unstressed vowels with an apostrophe between them, or an unstressed diphthong. An r-hyphen can follow either form. *)
  consonant cvv-body [r-hyphen]

%rule cvv-body                (* `unstressed_vowel h unstressed_vowel / unstressed_diphthong`. The second letter is an apostrophe in one form and a vowel in the other. *)
  unstressed-vowel h unstressed-vowel | unstressed-diphthong

%rule r-hyphen  (* The hyphen is r before a consonant, or n before r. A following rafsi cannot begin with either resulting pair. *)
  | $r:r
  | $n:n
%conditions
  $r.following-tokens.begins(consonant),
  $n.following-tokens.begins(r)

```

<details><summary>Railroad diagrams of the 12 rules from <code>hy-rafsi</code> to <code>r-hyphen</code></summary>
<p><img src="../../docs/diagrams/words/bpfk/hy-rafsi.svg" alt="Railroad diagram of the rule hy-rafsi"></p>
<p><img src="../../docs/diagrams/words/bpfk/hy-rafsi-body.svg" alt="Railroad diagram of the rule hy-rafsi-body"></p>
<p><img src="../../docs/diagrams/words/bpfk/long-rafsi-vowel.svg" alt="Railroad diagram of the rule long-rafsi-vowel"></p>
<p><img src="../../docs/diagrams/words/bpfk/stressed-hy-rafsi.svg" alt="Railroad diagram of the rule stressed-hy-rafsi"></p>
<p><img src="../../docs/diagrams/words/bpfk/stressed-hy-rafsi-body.svg" alt="Railroad diagram of the rule stressed-hy-rafsi-body"></p>
<p><img src="../../docs/diagrams/words/bpfk/long-rafsi-stressed-vowel.svg" alt="Railroad diagram of the rule long-rafsi-stressed-vowel"></p>
<p><img src="../../docs/diagrams/words/bpfk/long-rafsi.svg" alt="Railroad diagram of the rule long-rafsi"></p>
<p><img src="../../docs/diagrams/words/bpfk/cvc-rafsi.svg" alt="Railroad diagram of the rule cvc-rafsi"></p>
<p><img src="../../docs/diagrams/words/bpfk/ccv-rafsi.svg" alt="Railroad diagram of the rule ccv-rafsi"></p>
<p><img src="../../docs/diagrams/words/bpfk/cvv-rafsi.svg" alt="Railroad diagram of the rule cvv-rafsi"></p>
<p><img src="../../docs/diagrams/words/bpfk/cvv-body.svg" alt="Railroad diagram of the rule cvv-body"></p>
<p><img src="../../docs/diagrams/words/bpfk/r-hyphen.svg" alt="Railroad diagram of the rule r-hyphen"></p>
</details>



## Syllables and stress

A vowel, diphthong or syllable is stressed in two cases. In one, the letter after its onset is a capital vowel (`stressed`). In the other, one more syllable follows it before a pause (`stress`). It is unstressed when it is neither. A capital glide, or a capital second letter of a diphthong, marks nothing.

So an unmarked brivla is stressed on its penultimate syllable, and a pause must follow it. Another word can directly follow a brivla whose stress is marked.

```jbogenbau
%rule final-syllable  (* The final counted syllable forbids y and marked stress. It excludes a following name and ends at a complete word boundary. *)
  $o:syllable-onset $n:nucleus
%conditions
  ¬$o.following-tokens.begins(y | stressed),
  ¬$n.following-tokens.begins(cmevla),
  $n.following-tokens.begins(post-word)

%rule stressed-unit(@U)
  $s:@U
%conditions
  $s.onward.begins(stressed) ∨ $s.following-tokens.begins(stress)

%rule unstressed-unit(@U)
  $s:@U
%conditions
  ¬$s.onward.begins(stressed),
  ¬$s.following-tokens.begins(stress)

%rule stressed-syllable = stressed-unit(syllable)  (* A syllable is stressed by a written mark or its position before the final syllable. One constituent covers both cases. *)

%rule stressed-diphthong = stressed-unit(diphthong)  (* A diphthong is stressed by a written mark or its position before the final syllable. One constituent covers both cases. *)

%rule stressed-vowel = stressed-unit(vowel)  (* A vowel is stressed by a written mark or its position before the final syllable. One constituent covers both cases. *)

%rule unstressed-syllable  (* An unstressed vowel-bearing syllable has a nucleus. A consonantal syllable has none. Only one kind can complete at a syllable boundary. *)
  unstressed-plain-syllable | consonantal-syllable

%rule unstressed-plain-syllable = unstressed-unit(syllable)  (* An unstressed syllable has neither a written stress mark nor positional stress. *)

%rule unstressed-diphthong = unstressed-unit(diphthong)  (* An unstressed diphthong has neither a written stress mark nor positional stress. *)

%rule unstressed-vowel = unstressed-unit(vowel)  (* An unstressed vowel has neither a written stress mark nor positional stress. *)

%rule stress  (* Positional stress precedes the last counted syllable before a pause. The counted syllable cannot start with y. It permits an empty onset, so the PEG's greedy split succeeds whenever any split does. *)
  [{consonant | glide}] [h] [y] $s:syllable
%conditions
  $s.following-tokens.begins(pause)

%rule stressed                (* stressed <- onset comma* [AEIOU] *)
  syllable-onset stress-mark

%rule stress-mark             (* [AEIOU], a letter and not a vowel rule *)
  "a"<Stressed> | "e"<Stressed> | "i"<Stressed> | "o"<Stressed> | "u"<Stressed>
```

<details><summary>Railroad diagrams of the 13 rules from <code>final-syllable</code> to <code>stress-mark</code></summary>
<p><img src="../../docs/diagrams/words/bpfk/final-syllable.svg" alt="Railroad diagram of the rule final-syllable"></p>
<p><img src="../../docs/diagrams/words/bpfk/stressed-unit.svg" alt="Railroad diagram of the rule stressed-unit"></p>
<p><img src="../../docs/diagrams/words/bpfk/unstressed-unit.svg" alt="Railroad diagram of the rule unstressed-unit"></p>
<p><img src="../../docs/diagrams/words/bpfk/stressed-syllable.svg" alt="Railroad diagram of the rule stressed-syllable"></p>
<p><img src="../../docs/diagrams/words/bpfk/stressed-diphthong.svg" alt="Railroad diagram of the rule stressed-diphthong"></p>
<p><img src="../../docs/diagrams/words/bpfk/stressed-vowel.svg" alt="Railroad diagram of the rule stressed-vowel"></p>
<p><img src="../../docs/diagrams/words/bpfk/unstressed-syllable.svg" alt="Railroad diagram of the rule unstressed-syllable"></p>
<p><img src="../../docs/diagrams/words/bpfk/unstressed-plain-syllable.svg" alt="Railroad diagram of the rule unstressed-plain-syllable"></p>
<p><img src="../../docs/diagrams/words/bpfk/unstressed-diphthong.svg" alt="Railroad diagram of the rule unstressed-diphthong"></p>
<p><img src="../../docs/diagrams/words/bpfk/unstressed-vowel.svg" alt="Railroad diagram of the rule unstressed-vowel"></p>
<p><img src="../../docs/diagrams/words/bpfk/stress.svg" alt="Railroad diagram of the rule stress"></p>
<p><img src="../../docs/diagrams/words/bpfk/stressed.svg" alt="Railroad diagram of the rule stressed"></p>
<p><img src="../../docs/diagrams/words/bpfk/stress-mark.svg" alt="Railroad diagram of the rule stress-mark"></p>
</details>



The `syllable-onset` hook reads an ordinary onset. Syllables, written stress, and the brivla head use it. A layer can extend their shared onset without changing the other restrictions.

A syllable has an onset, a nucleus, and an optional nonempty coda. A consonantal syllable has a consonant before a syllabic consonant and a coda. A consonantal syllable cannot consume the same complete letters as a syllable with a vowel nucleus. A coda ends before another syllable or a pause, which are incompatible boundaries. Before a pause, one consonant and two consonants have different lengths. The absent optional covers the empty coda once.

If a coda stands before another syllable, omitting it leaves consonants that cannot begin that syllable. If it stands before a pause, omitting it leaves consonants before that required pause. Thus both presence choices cannot complete the same word.

```jbogenbau
%rule any-syllable  (* A vowel-bearing syllable has a nucleus. A consonantal syllable has none, so they cannot consume the same complete syllable. *)
  onset-nucleus-coda | consonantal-syllable

%rule syllable-onset  (* This hook supplies the shared onset for syllables, stress tests, the brivla head and coda lookahead. *)
  onset

%rule onset-nucleus-coda  (* A vowel-bearing syllable has an optional nonempty coda. Omitting a required coda leaves consonants that cannot start the following syllable. *)
  syllable-onset nucleus [coda]

%rule syllable  (* A counted syllable forbids a y nucleus. Its optional nonempty coda leaves no duplicate empty reading at a pause. *)
  $o:syllable-onset nucleus [coda]
%conditions
  ¬$o.following-tokens.begins(y)

%rule consonantal-syllable  (* The second consonant must be syllabic. The nonempty coda contains it. *)
  $c:consonant coda
%conditions
  $c.following-tokens.begins(syllabic)

%rule coda  (* A nonempty coda ends before a syllable or a pause. Those following boundaries cannot coincide. *)
  coda-before-syllable | coda-before-pause

%rule coda-before-syllable  (* A medial coda ends before a syllable, but cannot begin a syllable itself. *)
  $c:consonant
%conditions
  ¬$c.onward.begins(any-syllable),
  $c.following-tokens.begins(any-syllable)

%rule coda-before-pause  (* A final coda has one consonant or a syllabic consonant and another consonant. Their lengths before the pause cannot coincide. *)
  | $c:consonant
  | syllabic $d:consonant
%conditions
  $c.following-tokens.begins(pause),
  $d.following-tokens.begins(pause)

%rule onset  (* An apostrophe, glide, or consonant initial precedes a nucleus. An empty initial before apostrophe cannot reach that nucleus. Initial forbids a following glide. *)
  h | glide | initial

%rule nucleus  (* A nucleus is a vowel, diphthong, or y. A vowel forbids the following nucleus that a diphthong requires. A y nucleus forbids another nucleus. *)
  | vowel
  | diphthong
  | $y:y
%conditions
  ¬$y.following-tokens.begins(nucleus)

%rule glide  (* A glide is i or u directly before a nucleus. *)
  $g:i-or-u
%conditions
  $g.following-tokens.begins(nucleus)

%rule i-or-u                  (* i / u *)
  i | u

%rule diphthong  (* A diphthong cannot end directly before another nucleus. *)
  $d:diphthong-letters
%conditions
  ¬$d.following-tokens.begins(nucleus)

%rule diphthong-letters  (* The four diphthongs differ in their first or second letter. A repeated i or u cannot follow the matching diphthong. *)
  | a $i:i
  | a $u:u
  | e $j:i
  | o $k:i
%conditions
  ¬$i.following-tokens.begins(i),
  ¬$u.following-tokens.begins(u),
  ¬$j.following-tokens.begins(i),
  ¬$k.following-tokens.begins(i)

%rule vowel  (* A vowel cannot end directly before another nucleus. *)
  $v:vowel-letter
%conditions
  ¬$v.following-tokens.begins(nucleus)

%rule vowel-letter            (* a / e / i / o / u *)
  a | e | i | o | u
```

<details><summary>Railroad diagrams of the 16 rules from <code>any-syllable</code> to <code>vowel-letter</code></summary>
<p><img src="../../docs/diagrams/words/bpfk/any-syllable.svg" alt="Railroad diagram of the rule any-syllable"></p>
<p><img src="../../docs/diagrams/words/bpfk/syllable-onset.svg" alt="Railroad diagram of the rule syllable-onset"></p>
<p><img src="../../docs/diagrams/words/bpfk/onset-nucleus-coda.svg" alt="Railroad diagram of the rule onset-nucleus-coda"></p>
<p><img src="../../docs/diagrams/words/bpfk/syllable.svg" alt="Railroad diagram of the rule syllable"></p>
<p><img src="../../docs/diagrams/words/bpfk/consonantal-syllable.svg" alt="Railroad diagram of the rule consonantal-syllable"></p>
<p><img src="../../docs/diagrams/words/bpfk/coda.svg" alt="Railroad diagram of the rule coda"></p>
<p><img src="../../docs/diagrams/words/bpfk/coda-before-syllable.svg" alt="Railroad diagram of the rule coda-before-syllable"></p>
<p><img src="../../docs/diagrams/words/bpfk/coda-before-pause.svg" alt="Railroad diagram of the rule coda-before-pause"></p>
<p><img src="../../docs/diagrams/words/bpfk/onset.svg" alt="Railroad diagram of the rule onset"></p>
<p><img src="../../docs/diagrams/words/bpfk/nucleus.svg" alt="Railroad diagram of the rule nucleus"></p>
<p><img src="../../docs/diagrams/words/bpfk/glide.svg" alt="Railroad diagram of the rule glide"></p>
<p><img src="../../docs/diagrams/words/bpfk/i-or-u.svg" alt="Railroad diagram of the rule i-or-u"></p>
<p><img src="../../docs/diagrams/words/bpfk/diphthong.svg" alt="Railroad diagram of the rule diphthong"></p>
<p><img src="../../docs/diagrams/words/bpfk/diphthong-letters.svg" alt="Railroad diagram of the rule diphthong-letters"></p>
<p><img src="../../docs/diagrams/words/bpfk/vowel.svg" alt="Railroad diagram of the rule vowel"></p>
<p><img src="../../docs/diagrams/words/bpfk/vowel-letter.svg" alt="Railroad diagram of the rule vowel-letter"></p>
</details>



## Letters

A vowel letter has a lowercase value with or without `Stressed`. The `a`, `e`, `i`, `o` and `u` rules each read one value. `stress-mark` tests `Stressed` on those five values, so it finds the written stress. A `y` is not followed by a nucleus, unless that nucleus is another `y`. An apostrophe is followed by a nucleus.

```jbogenbau
%rule a                       (* a <- comma* [aA] *)
  "a"

%rule e                       (* e <- comma* [eE] *)
  "e"

%rule i                       (* i <- comma* [iI] *)
  "i"

%rule o                       (* o <- comma* [oO] *)
  "o"

%rule u                       (* u <- comma* [uU] *)
  "u"

%rule y  (* A y letter cannot precede a non-y nucleus. *)
  $y:"y"
%conditions
  ¬$y.following-tokens.begins(non-y-nucleus)

%rule non-y-nucleus  (* This nucleus test excludes y at its start. *)
  $n:nucleus
%conditions
  ¬$n.onward.begins(y)

%rule h  (* An apostrophe must precede a nucleus. *)
  $h:"'"<¬PAUSE>
%conditions
  $h.following-tokens.begins(nucleus)
```

<details><summary>Railroad diagrams of <code>a</code>, <code>e</code>, <code>i</code>, <code>o</code>, <code>u</code>, <code>y</code>, <code>non-y-nucleus</code> and <code>h</code></summary>
<p><img src="../../docs/diagrams/words/bpfk/a.svg" alt="Railroad diagram of the rule a"></p>
<p><img src="../../docs/diagrams/words/bpfk/e.svg" alt="Railroad diagram of the rule e"></p>
<p><img src="../../docs/diagrams/words/bpfk/i.svg" alt="Railroad diagram of the rule i"></p>
<p><img src="../../docs/diagrams/words/bpfk/o.svg" alt="Railroad diagram of the rule o"></p>
<p><img src="../../docs/diagrams/words/bpfk/u.svg" alt="Railroad diagram of the rule u"></p>
<p><img src="../../docs/diagrams/words/bpfk/y.svg" alt="Railroad diagram of the rule y"></p>
<p><img src="../../docs/diagrams/words/bpfk/non-y-nucleus.svg" alt="Railroad diagram of the rule non-y-nucleus"></p>
<p><img src="../../docs/diagrams/words/bpfk/h.svg" alt="Railroad diagram of the rule h"></p>
</details>



## Consonants

An initial pair is two consonants that can begin a word. `initial` says which: an affricate, or a sibilant, another consonant and a liquid, each optional, where no consonant or glide follows. An affricate joins a stopped sound with friction. A sibilant is a hissing consonant. The liquids here are `l` and `r`.

```jbogenbau
%rule cluster                 (* `cluster <- consonant consonant+`. The first two consonants decide this lookahead. *)
  consonant consonant

%rule initial-pair  (* An initial pair starts a legal initial and contains exactly two consonants. *)
  $a:consonant $b:consonant
%conditions
  $a.onward.begins(initial),
  ¬$b.following-tokens.begins(consonant)

%rule initial  (* An initial ends before any next consonant or glide. The parts branch leaves an affricate's second consonant, so only the affricate branch completes. *)
  | $a:affricate
  | $p:initial-parts
%conditions
  ¬$a.following-tokens.begins(consonant | glide),
  ¬$p.following-tokens.begins(consonant | glide)

%rule initial-parts  (* Each initial part is optional. Leaving any available consonant unread fails the final consonant exclusion of initial. *)
  [sibilant] [other] [liquid]

%rule affricate               (* `affricate <- t c / t s / d j / d z`. The forms differ in their first or second letter. *)
  t c | t s | d j | d z

%rule liquid                  (* liquid <- l / r *)
  l | r

%rule other  (* The other initial consonants forbid tl, dl, and n before a liquid. *)
  | p | $t:t | k | f | x | b | $d:d | g | v | m | $n:n
%conditions
  ¬$t.following-tokens.begins(l),
  ¬$d.following-tokens.begins(l),
  ¬$n.following-tokens.begins(liquid)

%rule sibilant  (* A sibilant forbids sx, and j or z before n or a liquid. *)
  | c
  | $s:s
  | $j:j-or-z
%conditions
  ¬$s.following-tokens.begins(x),
  ¬$j.following-tokens.begins(n | liquid)

%rule j-or-z                  (* j / z *)
  j | z

%rule consonant               (* consonant <- voiced / unvoiced / syllabic *)
  voiced | unvoiced | syllabic

%rule syllabic                (* syllabic <- l / m / n / r *)
  l | m | n | r

%rule voiced                  (* voiced <- b / d / g / j / v / z *)
  b | d | g | j | v | z

%rule unvoiced                (* unvoiced <- c / f / k / p / s / t / x *)
  c | f | k | p | s | t | x
```

<details><summary>Railroad diagrams of the 13 rules from <code>cluster</code> to <code>unvoiced</code></summary>
<p><img src="../../docs/diagrams/words/bpfk/cluster.svg" alt="Railroad diagram of the rule cluster"></p>
<p><img src="../../docs/diagrams/words/bpfk/initial-pair.svg" alt="Railroad diagram of the rule initial-pair"></p>
<p><img src="../../docs/diagrams/words/bpfk/initial.svg" alt="Railroad diagram of the rule initial"></p>
<p><img src="../../docs/diagrams/words/bpfk/initial-parts.svg" alt="Railroad diagram of the rule initial-parts"></p>
<p><img src="../../docs/diagrams/words/bpfk/affricate.svg" alt="Railroad diagram of the rule affricate"></p>
<p><img src="../../docs/diagrams/words/bpfk/liquid.svg" alt="Railroad diagram of the rule liquid"></p>
<p><img src="../../docs/diagrams/words/bpfk/other.svg" alt="Railroad diagram of the rule other"></p>
<p><img src="../../docs/diagrams/words/bpfk/sibilant.svg" alt="Railroad diagram of the rule sibilant"></p>
<p><img src="../../docs/diagrams/words/bpfk/j-or-z.svg" alt="Railroad diagram of the rule j-or-z"></p>
<p><img src="../../docs/diagrams/words/bpfk/consonant.svg" alt="Railroad diagram of the rule consonant"></p>
<p><img src="../../docs/diagrams/words/bpfk/syllabic.svg" alt="Railroad diagram of the rule syllabic"></p>
<p><img src="../../docs/diagrams/words/bpfk/voiced.svg" alt="Railroad diagram of the rule voiced"></p>
<p><img src="../../docs/diagrams/words/bpfk/unvoiced.svg" alt="Railroad diagram of the rule unvoiced"></p>
</details>



The `letter-ban` hook reads a following syllable-initial apostrophe or glide. Each consonant letter refuses what it reads and the same consonant. Each voiced or unvoiced letter also refuses consonants of the other voicing, and some letters refuse other letters, as CLL[^cll-s3-6] says.

The `consonant-letter` template takes the character and its forbidden targets. Each letter keeps its reference name through a named instance.

```jbogenbau
%rule letter-ban  (* Consonant letters cannot precede a syllable-initial apostrophe or glide. *)
  h | glide

%rule consonant-letter(@S, @B)
  $c:@S
%conditions
  ¬$c.following-tokens.begins(letter-ban | @B)

%rule l = consonant-letter("l", l)  (* This consonant applies the shared letter ban and forbids a repeated letter. *)

%rule m = consonant-letter("m", m | z)  (* This consonant applies the shared letter ban and forbids a repeated letter. It forbids z. *)

%rule n = consonant-letter("n", n | affricate)  (* This consonant applies the shared letter ban and forbids a repeated letter. It forbids an affricate. *)

%rule r = consonant-letter("r", r)  (* This consonant applies the shared letter ban and forbids a repeated letter. *)

%rule b = consonant-letter("b", b | unvoiced)  (* This consonant applies the shared letter ban and forbids a repeated letter. It also forbids an unvoiced consonant. *)

%rule d = consonant-letter("d", d | unvoiced)  (* This consonant applies the shared letter ban and forbids a repeated letter. It also forbids an unvoiced consonant. *)

%rule g = consonant-letter("g", g | unvoiced)  (* This consonant applies the shared letter ban and forbids a repeated letter. It also forbids an unvoiced consonant. *)

%rule v = consonant-letter("v", v | unvoiced)  (* This consonant applies the shared letter ban and forbids a repeated letter. It also forbids an unvoiced consonant. *)

%rule j = consonant-letter("j", j | z | unvoiced)  (* This consonant applies the shared letter ban and forbids a repeated letter. It also forbids an unvoiced consonant. It forbids z. *)

%rule z = consonant-letter("z", z | j | unvoiced)  (* This consonant applies the shared letter ban and forbids a repeated letter. It also forbids an unvoiced consonant. It forbids j. *)

%rule s = consonant-letter("s", s | c | voiced)  (* This consonant applies the shared letter ban and forbids a repeated letter. It also forbids a voiced consonant. It forbids c. *)

%rule c = consonant-letter("c", c | s | x | voiced)  (* This consonant applies the shared letter ban and forbids a repeated letter. It also forbids a voiced consonant. It forbids s and x. *)

%rule x = consonant-letter("x", x | c | k | voiced)  (* This consonant applies the shared letter ban and forbids a repeated letter. It also forbids a voiced consonant. It forbids c and k. *)

%rule k = consonant-letter("k", k | x | voiced)  (* This consonant applies the shared letter ban and forbids a repeated letter. It also forbids a voiced consonant. It forbids x. *)

%rule f = consonant-letter("f", f | voiced)  (* This consonant applies the shared letter ban and forbids a repeated letter. It also forbids a voiced consonant. *)

%rule p = consonant-letter("p", p | voiced)  (* This consonant applies the shared letter ban and forbids a repeated letter. It also forbids a voiced consonant. *)

%rule t = consonant-letter("t", t | voiced)  (* This consonant applies the shared letter ban and forbids a repeated letter. It also forbids a voiced consonant. *)
```

<details><summary>Railroad diagrams of the 19 rules from <code>letter-ban</code> to <code>t</code></summary>
<p><img src="../../docs/diagrams/words/bpfk/letter-ban.svg" alt="Railroad diagram of the rule letter-ban"></p>
<p><img src="../../docs/diagrams/words/bpfk/consonant-letter.svg" alt="Railroad diagram of the rule consonant-letter"></p>
<p><img src="../../docs/diagrams/words/bpfk/l.svg" alt="Railroad diagram of the rule l"></p>
<p><img src="../../docs/diagrams/words/bpfk/m.svg" alt="Railroad diagram of the rule m"></p>
<p><img src="../../docs/diagrams/words/bpfk/n.svg" alt="Railroad diagram of the rule n"></p>
<p><img src="../../docs/diagrams/words/bpfk/r.svg" alt="Railroad diagram of the rule r"></p>
<p><img src="../../docs/diagrams/words/bpfk/b.svg" alt="Railroad diagram of the rule b"></p>
<p><img src="../../docs/diagrams/words/bpfk/d.svg" alt="Railroad diagram of the rule d"></p>
<p><img src="../../docs/diagrams/words/bpfk/g.svg" alt="Railroad diagram of the rule g"></p>
<p><img src="../../docs/diagrams/words/bpfk/v.svg" alt="Railroad diagram of the rule v"></p>
<p><img src="../../docs/diagrams/words/bpfk/j.svg" alt="Railroad diagram of the rule j"></p>
<p><img src="../../docs/diagrams/words/bpfk/z.svg" alt="Railroad diagram of the rule z"></p>
<p><img src="../../docs/diagrams/words/bpfk/s.svg" alt="Railroad diagram of the rule s"></p>
<p><img src="../../docs/diagrams/words/bpfk/c.svg" alt="Railroad diagram of the rule c"></p>
<p><img src="../../docs/diagrams/words/bpfk/x.svg" alt="Railroad diagram of the rule x"></p>
<p><img src="../../docs/diagrams/words/bpfk/k.svg" alt="Railroad diagram of the rule k"></p>
<p><img src="../../docs/diagrams/words/bpfk/f.svg" alt="Railroad diagram of the rule f"></p>
<p><img src="../../docs/diagrams/words/bpfk/p.svg" alt="Railroad diagram of the rule p"></p>
<p><img src="../../docs/diagrams/words/bpfk/t.svg" alt="Railroad diagram of the rule t"></p>
</details>



## Differences from CLL and the reference PEG

The [checkpoint record](https://mw.lojban.org/index.php?title=BPFK_Checkpoints&oldid=109606) defers morphology. CLL 1.3.4[^cll-later-a3-3] records two committee votes on word forms. One bans a consonant directly before a glide. The other lifts the ban on `la`, `lai`, `la'i` and `doi` inside names. The PEG implements both. CLL 1.3.4 describes the rest of this working grammar, its extended rafsi included, as practice without a vote.

The phoneme stage reads the text before this stage does. In four ways, the text that this stage reads differs from the text that the PEG reads:

- The PEG reads a digit as a cmavo, and lets a digit stand in a name (its rule `digit`). The phoneme stage reads each digit as the letters of its number word, so `2` is `re`. So this grammar has no rule `digit`. `.b1b.` is not a name, and `.dj2n.` is the name `djren`.
- The PEG ignores a comma before any letter (`comma*` in each letter rule). The phoneme stage drops commas inside words. This grammar omits `comma*` in letter rules, with the same result except in the letter word `ybu`. Separate comma material remains a pause token.

  The PEG's `ybu` reads pause characters between the `y` and the `bu`, but no comma, unless the comma stands directly before the `bu`. Where `ybu` fails, the PEG reads the `y` as hesitation, which is space. So the PEG rejects `y, bu` and `y , bu`, and reads `doi y, bu` as the letter word `doi bu`. The words stage reads the one letter word `y bu` in these texts (below). Both read `y ,bu` as that letter word.
- The PEG reads a lowercase `h` as an apostrophe, and a consonant in either case. The phoneme stage reads a capital `H` as an apostrophe too, so `koHa` is `ko'a`, which the PEG rejects. It emits each apostrophe phoneme as `'` and every consonant in lower case, so the grammar reads only those. A capital vowel is a stressed vowel for both. The phoneme stage also reads accents as stress and folds runs of two vowel groups or more in which every vowel is a capital. The PEG reads neither convention.
- The PEG's pauses are the space, tab, line feed and carriage return, and the characters `.`, `?` and `!` (its rule `space_char`). The phoneme stage reads every Unicode `White_Space` character and other punctuation as a pause too. So it reads a no-break space between two words as a pause, which the PEG rejects. A quiet pause emits one `PAUSE` with value `" "`. Punctuation in the same pause emits its own material token.

  A pause token can retain a punctuation apostrophe as its value. The apostrophe rule excludes that token so that raw punctuation never becomes a word phoneme.

### The ybu exception

The PEG's first spelling of `BY`, the rule `ybu <- Y space_char* BU`, reads more than `cmavo`. It reads a run of `y`, any pause, and `bu` as one letter word: `ybu`, `y bu` and `yyybu` are each one word. That is the letter word `.y bu`, which the Magic Words proposal forms "before any other processing of any kind". This stage reads each run on its own, so it reads the `y` and the `bu` as two words. Before BU, the forms stage separates the final y from any prolonged hesitation. The shared word reader then forms the letter word ([stream.md](stream.md)).

A run stays one hesitation token except for the split that prepares a letter word before BU. That split separates its final y from the hesitation prefix. The words stage drops the prefix and forms `y bu` from the final y and BU. Thus `ybu`, `y bu`, `yyybu`, `.y.bu`, and `yy bu` each produce the same letter word.

### Duplicate proofs

Names use the general name shape once instead of choosing between general and syllabified proofs of the same letters. Marked and positional stress share one constituent when both tests hold. Final codas have one form per nonempty length, and the absent optional supplies the empty form. These changes affect internal proofs without changing ordinary word division or word classes.

The forms stage accepts `kyyykerlo` with the division described above because its word boundaries permit it. Full camxes-std rejects it through the separate `spaces` wrapper after `ky`. The shared [forms document](forms.md#differences-from-camxes) explains that departure.

### Consonant restriction

The consonant rules retain the ban on a consonant followed by a glide and a vowel. The committee voted for this ban, and CLL 1.3.4 records the vote.[^cll-later-a3-3]

[^cll-s4-7]: [CLL 1.1, section 4.7](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-fuhivla.html).

[^cll-s3-6]: [CLL 1.1, section 3.6](https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/section-clusters.html).

[^cll-later-a3-3]: [CLL 1.3.4, appendix A3.3](https://github.com/int19h/cll/blob/v1.3.4/chapters/a03.xml#L155-L243). This later approval record has no CLL 1.1 counterpart.
