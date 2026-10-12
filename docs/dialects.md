# Implement a dialect

A dialect is a pipeline of grammar stages. A stage reads tokens and emits tokens. A token is one input or output unit. This guide explains author choices for values, images, tags, and syntax. The [notation](notation.md) defines their exact spelling.

A value is the string that comparisons read. An image is the string that people see. A tag is a named mark used for recognition. A recipe supplies a value or image. A capture names one matched symbol. A constituent is one occurrence of a matched rule.

## Before you start

Use a checkout of `int19h/gencmu` with Node 20 or later. Run commands from the repository root unless a step names another directory. Use `--pipeline` to read edited source documents directly. Use `--dialect` to read the package's bundled copy.

Create a pipeline file under `grammars/dialects/`. Pair each include with a Markdown link. Include the base dialect before selecting its stages. Include paths resolve relative to the file that contains them.

```jbogenbau
%include "cll-ebnf.md"
%extend-stage forms
```

## Add a word class

A class is a tag with capital letters at both ends. It never starts with `_`. A classifier maps exact values to classes. A lexicon is the classifier for word classes.

The following extension assigns `ki'ei` to KIhEI in the forms stage. CLL already recognizes that word form. Later word stages carry the class to syntax.

```jbogenbau
%extend-stage forms
%classifier lexicon
  "ki'ei" ∈ KIhEI
```

Keep lexicon keys in the normalized spelling supplied to forms. The engine compares them exactly. If you replace an existing class, remove its membership with `∉` before adding the replacement with `∈`.

Inspect the local forms output with this command:

```sh
node lib/js/cli.js parse --pipeline grammars/dialects/my-kihei.md --until forms --format tokens "ki'ei"
```

Make sure that the output token carries `KIhEI`. Read its `value` for comparisons and its `image` for spelling. Do not infer either string from tags.

## Add syntax

A frame is a context for subsequent utterances. The example uses `ki'ei` to introduce a frame. `#` names the grammar's free-modifier slot. A free modifier is a phrase permitted at many positions. `I` reads `.i`.

Append the following rules after the word-class extension:

```jbogenbau
%extend-stage syntax
%redefine-rule paragraph
  utterance-sequence [{frame-group}] | {frame-group}

%rule utterance-sequence
  (statement | fragment) [{I # [statement | fragment]}]

%rule frame-group
  frame [I # [utterance-sequence]]

%rule frame
  KIhEI # [terms]
```

`%redefine-rule` replaces the inherited paragraph. `%rule` defines each added rule. The frame and following utterances share one `frame-group`. This construct requires `.i` before a following utterance.

Parse the local pipeline with this command:

```sh
node lib/js/cli.js parse --pipeline grammars/dialects/my-kihei.md "ki'ei ko'a .i broda"
```

The intended brackets are `([ki'ei ko'a] i broda)`. Inspect canonical or tree output to make sure that the frame owns its following utterances. Brackets alone do not record every named wrapper.

## Design stage contracts

State each stage's input values, tags, and output policy in its prose. Stage zero supplies character values and images with stored engine tags. It adds no pause, stress, or normalization policy.

Select a stage with `%extend-stage NAME` before changing its rules. Use `%redefine-stage NAME` for a complete replacement. That replacement clears stage items and ambiguity policy but keeps execution position. Other stages and global features remain intact.

A `%extend-rule` carries only its own clauses. It never copies base tags, recipes, conditions, or emission. An inherited rule flag still applies to its appended alternatives. A `%redefine-rule` states the complete replacement and its flag.

The bundled Lojban pipeline runs `phonemes`, `normalize`, `forms`, `words`, `indicators`, and `syntax`. Find outputs by stage name. A stage insertion changes later positions without changing their names.

## Map character values

Use string terminals for exact characters and ranges for scalar intervals. Use stored engine tags for Unicode properties. A scalar value is a Unicode code point outside surrogates. `_` reads any ordinary token.

```jbogenbau
%rule consonant :: ∅
  | "b"
  | "B" := "b"
  | "б" := "b"
%emits

%rule digit-0
  "0"
%emits
  $ :: ∅ := "n", ε :: ∅ := "o"
```

`:: ∅` stops character-tag inheritance. `:=` sets both strings unless a stronger explicit image recipe applies. The second digit phoneme is an inserted token with empty source text. Never emit two covering tokens over the digit's input span.

Engine tags belong to stage-zero tokens. Forward or filter them through captured tags. Do not introduce one in a tag clause, constant, classifier, implication, or elidable terminator. `_Lu ⊆ $c.tags` tests membership. `:: $c.tags ∩ _Lu` filters inherited membership.

## Normalize through grammar

Place normalization after the phoneme mappings and before forms. Write `Stressed` on the mapping that creates each stressed value. Keep inherited tags on forwarding-only extensions.

```jbogenbau
%stage normalize
%ambiguity-resolution lazy

%rule text
  [{unit}]

%rule unit :- $.image
  | "A"<Stressed> := "a"
  | "E"<Stressed> := "e"
  | "I"<Stressed> := "i"
  | "O"<Stressed> := "o"
  | "U"<Stressed> := "u"
  | "Y"<Stressed> := "y"
  | ","<Syllable-Break> := ""
  | _<¬Stressed ¬Syllable-Break>
%emits
```

The rule-level image recipe preserves written images. Every mapping retains its input tags through single-symbol inheritance. The stage preserves token count, order, images, and sources. It changes only values.

Make sure that every token with a mapped tag has a supported value. An unmapped stressed value fails normalization. Group a comma run into one comma token before this stage. Forms reads syllable boundaries through `Syllable-Break` even when the comma value is empty.

## Place recipes for parents

A covering parent runs a string walk through its children. That walk uses child constituent recipes but skips child emission lists. An item recipe serves only its directly emitted token.

The following child emits `x` alone. Its parent emits `ab` over input `ab`:

```jbogenbau
%rule text
  child | parent

%rule child
  "a"
%emits
  $ := "x"

%rule parent
  child "b"
%emits
```

Put the recipe on the child definition when the parent must also receive it:

```jbogenbau
%rule text
  child | parent

%rule child := "x"
  | "a"
%emits

%rule parent
  child "b"
%emits
```

This parent emits `xb`. An alternative recipe serves only that alternative. An item override remains strongest for its own token. Use `.emitted.value` or `.emitted.image` to read a reconstructed child. Name the channel explicitly in every recipe.

## Preserve verbatim quote images

Verbatim text preserves original spelling with adjacent uncovered punctuation. Put its image recipe on the rule that reads the quote body. Do not place it only on the parent's emission item.

```jbogenbau
%rule raw-tokens :- $.verbatim-text
  | any-token
  | raw-tokens any-token

%rule zohoi-payload :- $.verbatim-text
  | payload-token
  | zohoi-payload payload-token

%rule empty-zoi-body
  ε
```

The body recipe also serves a larger compound. Its outer image recipe stops recursive descendant image evaluation. Its value still concatenates normalized parts. An empty body takes no neighboring punctuation.

The method changes neither source nor text. An image can include text outside its token's source interval. Two evaluated different spans cannot claim the same uncovered text. Delimiter tokens keep ordinary quote bodies apart.

## Carry decisions through tags

The gap-tag invariant governs facts that recipes cannot inspect. If a recipe needs a branching decision, compute that fact during recognition and carry it upward as a tag. State the tag's origin, forwarding rules, readers, and end in grammar prose.

A gap is a run between lexical parts. `Gap-Pause` means that a run contains a surviving pause. Erased children never introduce it. `Trailing-Pause` means that a survivor's compound contribution already ends with one space. These tags are internal grammar marks, not engine tags.

Do not replace a disjunctive condition with overlapping alternatives. A token can carry both tested classes and then acquire two derivations. Use a condition such as `$b.classes ∩ $SU-STOPS ≠ ∅` for any-of membership.

## Group quote gaps

Inside lo'u and lo'ai, erasure words are quoted words. Use a quote recognizer without erasures. A hesitation still follows its grammar condition and erasure.

```jbogenbau
%rule quiet-gap
  | hesitation
  | quiet-gap hesitation

%rule pause-gap := " "
  | [quiet-gap] PAUSE [hesitations [PAUSE]]

%rule quote-spacing
  | ε
  | quiet-gap
  | pause-gap

%rule lohu-quote :: $m.tags
  | $m:lohu-marker quote-spacing lohu-stream quote-spacing lehu-marker
  | $m:lohu-marker quote-spacing lehu-marker

%rule lohu-stream
  | lohu-word
  | lohu-stream pause-gap lohu-word
  | lohu-stream quiet-gap lohu-word
  | lohu-stream lohu-word
```

`PAUSE` marks the first surviving pause of a nonempty pause run. `quiet-gap` contains no surviving pause and contributes empty concatenation. `pause-gap` contributes one space. Only `quote-spacing` permits an empty run. `lohu-stream` has a separate no-gap route.

Use the same partition for lohai streams and quote edges. Preserve their marker-only alternative without adding another empty-body route. Delimiter and single-word quote gaps keep their own hesitation conditions. An erasure-aware gap inside lo'u incorrectly removes quoted `si`.

## Classify compound gaps

Compound recognition retains spacing, skipped text, and erasures before BU and ZEI. The following tag clauses classify surviving pauses without changing those recognition routes:

```jbogenbau
%rule hesitations
  | hesitation :: ∅
  | $h:hesitations PAUSE hesitation :: Gap-Pause
  | $h:hesitations hesitation :: $h.tags ∩ Gap-Pause

%rule spacing
  [$p:PAUSE] [$h:hesitations [$q:PAUSE]]
    :: ($p ⟹ Gap-Pause) ∪ ($q ⟹ Gap-Pause) ∪ ($h ⟹ $h.tags ∩ Gap-Pause)

%rule erasures
  | erasure :: ∅
  | $e:erasures $s:spacing erasure :: ($e.tags ∪ $s.tags) ∩ Gap-Pause

%rule skipped
  $s:spacing [$e:erasures $t:spacing]
    :: ($s.tags ∪ ($e ⟹ $e.tags) ∪ ($t ⟹ $t.tags)) ∩ Gap-Pause

%rule compound-gap
  | skipped<¬Gap-Pause>
  | skipped<Gap-Pause> := " "

%rule spacing-gap
  | spacing<¬Gap-Pause>
  | spacing<Gap-Pause> := " "
```

`hesitations` and `spacing` introduce `Gap-Pause` only for surviving pauses. `erasures` and `skipped` forward it while ignoring erased children. `compound-gap`, `spacing-gap`, and `su-survivor` read it. Their complementary tests admit each skipped derivation once.

Put `compound-gap` before BU and before ZEI. Put `spacing-gap` after ZEI, where erasures change the recognized language. Do not insert a space unconditionally. The form `abu` has no pause and keeps no space.

## Preserve SU survivors

In BPFK and experimental, SU can stop at a boundary such as ni'o. A survivor groups that boundary with its erased tail. Its pause can lie before the erased SU while another pause follows it. Carry that spacing state through `Trailing-Pause`.

```jbogenbau
%rule su-survivor := $b.emitted.value :- $b.emitted.image
  | sa-su? su-boundary? $b:unit<Trailing-Pause> skipped su-suffix :: $b.tags
  | sa-su? su-boundary? $b:unit<¬Trailing-Pause> skipped<Gap-Pause> su-suffix
      :: $b.tags ∪ Trailing-Pause := $b.emitted.value " " :- $b.emitted.image " "
  | sa-su? su-boundary? $b:unit<¬Trailing-Pause> skipped<¬Gap-Pause> su-suffix :: $b.tags
%conditions
  $b.classes ∩ $SU-STOPS ≠ ∅

%rule suppressed-gap := ""
  | skipped

%rule lerfu-word :: Word BY ∪ Fault ∩ $u.tags
  | $u:unit<¬Trailing-Pause> compound-gap bu-word
  | su-boundary? $u:unit<Trailing-Pause> suppressed-gap bu-word
%emits
```

`su-survivor` introduces `Trailing-Pause` when it adds a surviving space. `unit` forwards that tag. BU and ZEI compounds read it and suppress their next gap's string. They retain the gap's tree parts for ownership. Their output does not forward the state.

Use the same two-way left-unit division in `zei-compound`. The final word after ZEI ends the trailing state. Preserve feature gates and the boundary-class condition. Zantufa's SU-letter rule has no survivor behavior.

The survivor has no `%emits`. When it stands alone, the emission walk forwards only its base's token. Its trailing recipe applies only inside a covering compound. `ni'o su bu` therefore has one space, while `ni'o subu` retains the earlier surviving space.

## Read foreign runs

`FOREIGN` marks input that the dialect cannot read as words. A non-Lojban character run retains its exact character values and images. A forms-stage unsegmentable run retains its normalized phoneme values. A quoted body keeps its own value policy and verbatim image.

Use names that state each recognizer's role:

| Stage | Rule | Recognizes |
| --- | --- | --- |
| Phonemes | `non-lojban-char-run` | A whole run with a character outside the orthography |
| Phonemes | `non-lojban-char` | One such character |
| Phonemes | `chars-with-non-lojban-char` | Characters containing at least one such character |
| Forms | `foreign-token` | One forwarded FOREIGN token |
| Forms | `unsegmentable-run` | A run with no valid word division |
| Forms | `word-run` | A whole run divided into valid words |
| Forms | `phoneme-sequence` | Phonemes without the whole-run boundary test |

A run extends between pauses. A helper that can match only part of one uses `sequence` or `chars`. A foreign run is legal only in the quote and post-fa'o positions specified by the word grammar.

Y delimiter keys use fixed tags `Y-Key` and `Ieho`. A grammar never constructs a tag name from input text. Longer raw y runs receive neither key tag. Values remain available for exact string comparisons.

## Test and share the dialect

Make sure that accepted and rejected examples record their intended stage, word images, brackets, and features. Add tree expectations where brackets hide a structural distinction. Include a base-dialect comparison.

After editing grammar sources, run these commands from the repository root:

```sh
node tools/sync.js
node tools/sync.js --check
```

Synchronization copies grammars, rebuilds bundles and DOMs, and draws diagrams. Review the generated files before committing them. Keep each prose paragraph on one line. Run the document tests and the relevant dialect tests.

The playground editor uses bundled sources. Rebuild the bundles before opening a disk edit there. Download preserves a browser edit. Reload discards changes that you do not save.

## Common mistakes

If an include fails, resolve its path against the document that contains it. If a rule extension fails, make sure that the selected stage defines that rule. If a rule is unreachable, connect it from `text` or correct its name.

If a stage ties, inspect both reported readings. Ordinary alternative order gives no priority. Remove unintended overlap or express an intended same-span preference with a ranked choice. Private ranked captures cannot feed parent recipes.

If an image loses verbatim spelling inside a compound, move its recipe to the body constituent. If a compound duplicates spaces, inspect surviving gap tags and their end. If a missing capture fails a recipe, separate the optional cases into alternatives.

An empty image never removes an input part or its ownership. `%erased` removes counted parts. Avoid covering an attached input token together with another surviving input token. Use named attachment carriers to keep ownership explicit.

## Read further

[Stage contracts and pipelines](notation.md#pipelines) explain inclusion and stage selectors. [Stitching](notation.md#stitching-documents) explains definitions and extensions. [Recipes](engine.md#11-emission) define channels, dependencies, and source gaps.

[Classifiers](notation.md#classifiers) define exact keys and memberships. [Terminals](notation.md#names-and-terminals) define values and stored tags. [Ambiguity](notation.md#ambiguity) defines ranking and ties. [Corpus cases](../tests/README.md#corpus-cases-corpusjsonl-and-coretxt) define shared expectations.
