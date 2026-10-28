# Implement a pipeline

You will build `grammars/lojban/examples/my-kihei/pipeline.md` with the `ki'ei` construct from [kihei](../grammars/lojban/examples/kihei/pipeline.md). A pipeline defines which grammar a parser uses.

A frame is a context for subsequent utterances. `ki'ei` sets that frame for the utterances after it. The parser groups those utterances under their frame.

This example adds a word class and changes syntax. It retains the inherited phoneme, word, and indicator policies.

## Before you start

Use a checkout of [int19h/gencmu](https://github.com/int19h/gencmu). Install Node 24 or later. The playground step also needs a static HTTP server, such as `python3 -m http.server`.

Run these commands from the repository root:

````sh
cd lib/js
npm ci
cd ../..
````

Unless a step names another directory, use the repository root as your working directory.

## Procedure

Use example filenames that do not clash with your own files. The commands below create or overwrite those files.

1. Create the pipeline file.

   CLL means *The Complete Lojban Language*. A literate grammar combines prose with fenced `jbogenbau` blocks.

   A directive is an instruction that starts with `%`. A rule describes which text a grammar can match. A parse applies grammar rules to a text.

   Create `grammars/lojban/examples/my-kihei/pipeline.md` with this command:

   ````sh
   mkdir -p grammars/lojban/examples/my-kihei
   cat > grammars/lojban/examples/my-kihei/pipeline.md <<'EOF'
   # My discourse frames

   This pipeline adds frames to CLL.

   - [The CLL pipeline](../../cll/pipeline.md)
     ```jbogenbau
     %include "../../cll/pipeline.md"
     ```
   EOF
   ````

   `%include` reads the base pipeline before your additions. Its include path starts from the directory of the file that contains it.

   Keep the Markdown link and its `%include` together. The document tests require this layout for grammar files.

   A stage is one step of a parse. A pipeline is an ordered sequence of stages. A phoneme is one speech sound.

   The pipeline maps phoneme values, recognizes forms, processes the word stream, attaches indicators, and reads syntax.

   The included pipeline creates all five stages. `%extend-stage` selects an existing stage and preserves its position.

2. Add the word class in the forms stage.

   A cmavo is a short structure word. A selma'o is a class of cmavo. A value is the string that exact comparisons read. The forms stage receives the phoneme values.

   A classifier maps exact values to classes. A lexicon is the classifier that assigns selma'o. Classes start and end with capitals and never start with `_`.

   Append these rules to `grammars/lojban/examples/my-kihei/pipeline.md`:

   ````sh
   cat >> grammars/lojban/examples/my-kihei/pipeline.md <<'EOF'

   ```jbogenbau
   %extend-stage forms
   %classifier lexicon
     "ki'ei" ∈ KIhEI
   ```
   EOF
   ````

   `%extend-stage forms` selects the grammar that assigns word classes. The words stage applies the magic words. `%classifier lexicon` adds KIhEI to the normalized value `ki'ei`.

   CLL already accepts this word form. The later stages carry its class to syntax.

   A token is one unit that a stage reads.

   Inspect the forms output with this command:

   ````sh
   node lib/js/cli.js parse --pipeline-file grammars/lojban/examples/my-kihei/pipeline.md --until forms --format tokens "ki'ei"
   ````

   Output:

   ````text
   phonemes: 5 tokens, unique
   #  text  value  image  span  source  tags
   0  "k"   "k"    "k"    0-1   0-1
   1  "i"   "i"    "i"    1-2   1-2
   2  "'"   "'"    "'"    2-3   2-3
   3  "e"   "e"    "e"    3-4   3-4
   4  "i"   "i"    "i"    4-5   4-5

   forms: 1 tokens, unique
   #  text     value    image    span  source  tags
   0  "ki'ei"  "ki'ei"  "ki'ei"  0-5   0-5     Cmavo Continued KIhEI Onset Run-Final Run-Initial Word
   ````

   A tag is a named mark on a token. Make sure that KIhEI appears in the forms output. Read `value` for comparisons and `image` for visible spelling.

   Keep lexicon keys lowercase. Use a straight apostrophe in those keys.

3. Add the syntax construct.

   A terminal matches a token with a specified tag.

   Append the kihei syntax rules to `grammars/lojban/examples/my-kihei/pipeline.md`:

   ````sh
   cat >> grammars/lojban/examples/my-kihei/pipeline.md <<'EOF'

   ```jbogenbau
   %extend-stage syntax
   %redefine-rule paragraph
     utterance-sequence [{frame-group}] | {frame-group}

   %rule utterance-sequence
     (statement | fragment) [{I 🆓 [statement | fragment]}]

   %rule frame-group
     frame [I 🆓 [utterance-sequence]]

   %rule frame
     KIhEI 🆓 [terms]
   ```
   EOF
   ````

   `%extend-stage syntax` selects syntax after the forms addition. `%redefine-rule paragraph` replaces the inherited paragraph rule.

   `%rule` defines each additional rule. `KIhEI` matches the additional word class, and `[terms]` accepts zero or more CLL terms.

   A free modifier adds information at permitted grammar positions. `🆓` reads optional free modifiers. `I` matches `.i`.

   The frame and its subsequent utterances share a `frame-group`. The construct requires `.i` before an utterance that follows a frame.

4. Parse a text with your pipeline.

   The CLI accepts commands from your terminal.

   Run the local file through `lib/js/cli.js`:

   ````sh
   node lib/js/cli.js parse --pipeline-file grammars/lojban/examples/my-kihei/pipeline.md "ki'ei ko'a .i broda"
   ````

   Output:

   ````text
   ([ki'ei ko'a] i broda)
   ````

   `--pipeline-file` reads your files from disk. `--pipeline` reads the package's bundled copy.

   Until you complete step 8, use `--pipeline-file` for changed grammar files.

   After you complete step 8, run `node tools/sync.js` after each edit to `grammars/` or `data/`.

   A feature is a named switch for a parse. List the features that the local pipeline exposes:

   ````sh
   node lib/js/cli.js features --pipeline-file grammars/lojban/examples/my-kihei/pipeline.md
   ````

   Output:

   ````text
   cll-cyrillic            gate     on
   sa-su                   gate     off
   su-boundary             gate     on
   y-cmavo                 warning  off
   ````

   The trial inherits these features from CLL. It adds no feature of its own.

   A tie gives two best readings the same rank.

   The CLI exits with `0` for acceptance, `1` for a failed result, and `2` for a grammar or command error.

5. Compare the trees.

   A parse tree records which rules matched the text.

   Parse the same CLL text in the base pipeline:

   ````sh
   node lib/js/cli.js parse --pipeline lojban/cll --format tree "broda .i brode"
   ````

   ````text
   text › text-1 › paragraphs › paragraph
     statement › statement-1 › statement-2 › statement-3 › sentence › bridi-tail › bridi-tail-1-final › bridi-tail-2 › bridi-tail-3
       selbri › selbri-1 › selbri-2 › selbri-3 › selbri-4 › selbri-5 › selbri-6 › tanru-unit › tanru-unit-1 › tanru-unit-2 · broda
       tail-terms
         ⟨VAU⟩
     I "i"
     statement › statement-1 › statement-2 › statement-3 › sentence › bridi-tail › bridi-tail-1-final › bridi-tail-2 › bridi-tail-3
       selbri › selbri-1 › selbri-2 › selbri-3 › selbri-4 › selbri-5 › selbri-6 › tanru-unit › tanru-unit-1 › tanru-unit-2 · brode
       tail-terms
         ⟨VAU⟩
   ````

   Parse that text with your local trial:

   ````sh
   node lib/js/cli.js parse --pipeline-file grammars/lojban/examples/my-kihei/pipeline.md --format tree "broda .i brode"
   ````

   ````text
   text › text-1 › paragraphs › paragraph › utterance-sequence
     statement › statement-1 › statement-2 › statement-3 › sentence › bridi-tail › bridi-tail-1-final › bridi-tail-2 › bridi-tail-3
       selbri › selbri-1 › selbri-2 › selbri-3 › selbri-4 › selbri-5 › selbri-6 › tanru-unit › tanru-unit-1 › tanru-unit-2 · broda
       tail-terms
         ⟨VAU⟩
     I "i"
     statement › statement-1 › statement-2 › statement-3 › sentence › bridi-tail › bridi-tail-1-final › bridi-tail-2 › bridi-tail-3
       selbri › selbri-1 › selbri-2 › selbri-3 › selbri-4 › selbri-5 › selbri-6 › tanru-unit › tanru-unit-1 › tanru-unit-2 · brode
       tail-terms
         ⟨VAU⟩
   ````

   The trial adds `utterance-sequence` below `paragraph`. Both pipelines still accept the text. Their default bracket output hides this structural difference.

   `›` joins successive tree nodes on one line. An elided terminator is an omitted closing word. `⟨VAU⟩` marks one.

   Parse a frame with your local trial:

   ````sh
   node lib/js/cli.js parse --pipeline-file grammars/lojban/examples/my-kihei/pipeline.md --format tree "ki'ei ko'a .i broda"
   ````

   ````text
   text › text-1 › paragraphs › paragraph › frame-group
     frame
       KIhEI "ki'ei"
       terms › terms-1 › terms-2 › term › sumti › sumti-1 › sumti-2 › sumti-3 › sumti-4 › sumti-5 › sumti-6 · ko'a
     I "i"
     utterance-sequence › statement › statement-1 › statement-2 › statement-3 › sentence › bridi-tail › bridi-tail-1-final › bridi-tail-2 › bridi-tail-3
       selbri › selbri-1 › selbri-2 › selbri-3 › selbri-4 › selbri-5 › selbri-6 › tanru-unit › tanru-unit-1 › tanru-unit-2 · broda
       tail-terms
         ⟨VAU⟩
   ````

   `frame-group` contains `frame`, `.i`, and `utterance-sequence`. The `frame` contains `ki'ei` and its terms.

   Try that frame in the base pipeline:

   ````sh
   node lib/js/cli.js parse --pipeline lojban/cll --format tree "ki'ei ko'a .i broda"
   ````

   The command exits with `1`. Its error starts with these lines:

   ````text
   The syntax stage cannot read the text at "ki'ei":
   1 | ki'ei ko'a .i broda
     | ^^^^^
   ````

   CLL recognizes the word form but assigns no `KIhEI` class. Its syntax has no frame construct.

6. Try the rules in the playground.

   From your checkout, start an HTTP server with `python3 -m http.server`.

   Open `http://localhost:8000/index.html` in a browser.

   The page fetches the Unicode properties file at startup. It fetches names data when a grammar needs it.

   Under `lojban/examples`, select `lojban/examples/kihei` in the Pipeline menu.

   Enter `ki'ei ko'a .i broda` in Text.

   Select the Tree tab.

   Under Grammar documents, open `lojban/examples/kihei/pipeline`.

   Edit its `%extend-stage` blocks to try your change.

   The page parses again after each edit. The Audit tab lists changes to the grammar and rules that nothing reaches.

   If you want to keep an edit, click Download. Save the downloaded content to its corresponding file in your checkout.

   The browser names that download `lojban--examples--kihei--pipeline.md`. Browser edits disappear when you reload the page.

   The playground has no file upload or command that loads an arbitrary local pipeline. You cannot load a local `pipeline.md` directly into the shipped page.

   If you want your additional pipeline in the local menu, complete step 8 first. After synchronization, reload `http://localhost:8000/index.html` from the server.

   `dist/grammars.js` bundles grammar documents and engine resources. `node tools/sync.js` rebuilds it from `grammars/` and `data/`. The hosted playground does not read your checkout.

7. Add corpus cases.

   A corpus case records a text and its result. JSONL stores one JSON object per line.

   Create `my-kihei.jsonl` at the repository root:

   ````sh
   cat > my-kihei.jsonl <<'EOF'
   {"id":"trial.kihei.frame","text":"ki'ei ko'a .i broda","expect":"accept","verdict":"unique","words":["ki'ei","ko'a","i","broda"],"brackets":"([ki'ei ko'a] i broda)"}
   {"id":"trial.kihei.missing-i","text":"ki'ei ko'a broda","expect":"reject","stage":"syntax","at":11,"words":["ki'ei","ko'a","broda"]}
   EOF
   ````

   The first case accepts the frame. The second rejects an utterance without `.i`.

   A code point is a Unicode character number. `at` counts code points from zero. `11` is the start of `broda` in the rejected text.

   Run both cases against your local file:

   ````sh
   node lib/js/cli.js test my-kihei.jsonl --pipeline-file grammars/lojban/examples/my-kihei/pipeline.md
   ````

   ````text
   2 of 2 cases pass
   ````

   These local cases omit `pipeline`, so the CLI uses `--pipeline-file`. The shared corpus requires a bundled pipeline name.

   For shared tests, add `"pipeline":"lojban/examples/my-kihei"` to each case. Save those cases to `tests/corpus/my-kihei.jsonl`.

   Add their IDs to `tests/core.txt`. The core corpus runs in all four libraries on pull requests.

   Include an accepted case, a rejected case, and a base comparison. Inspect the output. Record the intended brackets.

   The HOWTO also supplies five cases in `tests/corpus/pipelines-howto.jsonl`. They cover the tree examples and the missing `.i`.

   Run those bundled cases:

   ````sh
   node lib/js/cli.js test tests/corpus/pipelines-howto.jsonl
   ````

   ````text
   5 of 5 cases pass
   ````

   Brackets do not record every rule node. If your change groups text differently, add tests for tree nodes like those in `lib/js/test/kihei.test.js`.

8. Prepare the pipeline for shared use.

   The prose coverage tool requires a coverage decision for each additional grammar document. It automatically examines documents of `lojban/cll` and `lojban/bpfk`.

   For this trial, add this entry to `UNCHECKED` in `tools/quoted-texts.js`:

   ````js
   "grammars/lojban/examples/my-kihei/pipeline.md": "the trial has local corpus cases in my-kihei.jsonl",
   ````

   This entry records why the automatic CLL prose test excludes the trial. The tests must cover its claims.

   For your own pipeline, name its actual tests in that reason.

   In `lib/js/test/quoted-texts.test.js`, add `lojban/examples/my-kihei` after `lojban/examples/kihei` in the expected list for `pipelineNames()`.

   Add `lojban/examples/my-kihei` after `lojban/examples/kihei` in the expected list for `documentPipelines().get("grammars/lojban/cll/syntax.md")`.

   `quoted-texts.test.js` names every Lojban pipeline and every pipeline that includes CLL syntax. Keep each list in alphabetical order.

   You maintain these pipeline lists by hand.

   Add the additional grammar file to Git:

   ````sh
   git add grammars/lojban/examples/my-kihei/pipeline.md
   ````

   Add your corpus files and test changes to Git.

   Run the synchronization commands from the repository root:

   ````sh
   node tools/sync.js
   node tools/sync.js --check
   ````

   `sync.js` copies `grammars/` and `data/` into the libraries. It regenerates preparsed data, browser resources, and rule diagrams. `--check` fails when generated files or document conventions differ.

   Run the document tests in `lib/js`:

   ````sh
   node --test test/documents.test.js test/markdown.test.js test/links.test.js test/prose-lines.test.js test/quoted-texts.test.js
   ````

   Run the kihei tests and core corpus in `lib/js`:

   ````sh
   node --test test/kihei.test.js test/corpus.test.js
   ````

   If you add other tests, run them too.

   Before you commit, review the generated changes. Keep each prose paragraph on one line.

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

`:: ∅` stops inheritance of the child's tags, engine tags included. `:=` sets both strings unless a stronger explicit image recipe applies. The second digit phoneme is an inserted token with empty source text. Never emit two covering tokens over the digit's input span.

Engine tags belong to stage-zero tokens. Grammars forward or filter them but never introduce them. An engine tag can stand in a tag test, a pattern, a condition, and a body terminal. `_General_Category_Uppercase_Letter ⊆ $c.tags` tests membership. `:: $c.tags ∩ _General_Category_Uppercase_Letter` filters inherited membership.

A tag-set constant cannot hold an engine-tag literal, even inside a filter. Neither side of `%implies` can name one. Classifiers and elidable terminators cannot assign them. [Engine §1](engine.md#engine-tag-provenance) defines `lit` for nested filters.

Stage zero decomposes the text, so an accented letter arrives as its base and a combining mark.

An `%extend-rule` takes its own header clauses, never those of the base definition. This stressed mapping supplies its tag explicitly:

```jbogenbau
%extend-rule stressed-vowel
  | "A" "‹U+0301›" :: Stressed := "a" :- "A"
%emits
```

The value recipe supplies the plain vowel. The image recipe keeps visible stress. The `Stressed` tag alone carries stress information for later recognition.

The extension also supplies its own `%emits`. A two-symbol alternative inherits no tags. Without `:: Stressed`, later stages read the vowel as unstressed. Make sure that phoneme fixtures cover both the tag and the image.

A one-symbol mapping, such as `"B" := "b"`, inherits `_General_Category_Uppercase_Letter` and `_General_Category_Letter` from its input character. Such a consonant extension needs `:: ∅` to stop inherited engine tags.

## Phoneme values and stress

The bundled Lojban pipelines run `phonemes`, `forms`, `words`, `indicators`, and `syntax`, in that order.

A stressed vowel has its plain lowercase value and the `Stressed` tag. Its image retains visible stress. A syllable comma has empty value, image `,`, and tag `Syllable-Break`. Empty values retain their input coverage.

The `syllable-break` rule in [the strict Latin grammar](../grammars/lojban/cll/latin.md) reads `commas`. Its covering emission sets the comparison value:

```jbogenbau
%rule syllable-break
  commas
%emits
  $ :: Syllable-Break := "" :- ","
```

The token retains the comma run as its text and source. Its empty value does not erase it. The forms stage receives phoneme values directly.

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

## Quote images

[The word stream](../grammars/lojban/common/stream.md#quotes) defines quote values, images, and boundaries. Its [raw payload rules](../grammars/lojban/common/stream.md#raw-payloads) explain verbatim images and `.emitted.image`.

## Carry decisions through tags

The gap-tag invariant governs facts that recipes cannot inspect. If a recipe needs a branching decision, compute that fact during recognition and carry it upward as a tag. State the tag's origin, forwarding rules, readers, and end in grammar prose.

[The spacing rules](../grammars/lojban/common/stream.md#spacing-and-hesitation) define `Gap-Pause` and its surviving pauses. [The compound rules](../grammars/lojban/common/stream.md#compounds) define the origin, forwarding, readers, and end of `Trailing-Pause`.

Do not replace a disjunctive condition with overlapping alternatives. A token can carry both tested classes and then acquire two derivations. Use a condition such as `$b.classes ∩ $SU-STOPS ≠ ∅` for any-of membership.

## Rules of the words stage

[Shared word gaps](../grammars/lojban/common/stream.md#shared-word-gaps) distinguish hesitation, pauses, and empty gaps inside quotes. [Compounds](../grammars/lojban/common/stream.md#compounds) define gap classification for BU and ZEI.

[SA and SU erasure](../grammars/lojban/common/stream.md#erasure-by-sa-and-su) defines surviving boundary units. The compound rules describe their trailing-space state and its end.

[The Latin phoneme grammar](../grammars/lojban/common/latin.md#punctuation) defines non-Lojban character runs. [The forms grammar](../grammars/lojban/common/forms.md#runs) defines foreign tokens and unsegmentable runs. [Closing delimiter runs](../grammars/lojban/common/stream.md#closing-delimiter-runs) define the fixed Y keys.

## Other changes

If your change differs from the kihei example, use these approaches.

### Change word forms or classifications

If your word fails before forms, change the phoneme stage first. If forms rejects its shape, change the forms rules.

If you change an existing classification, remove its earlier class with `∉`.

Add its replacement class with `∈`.

### Add or replace alternatives

An alternative is one possible body of a rule. If you need only another alternative, use `%extend-rule` on the existing rule.

Put the extension in that rule's stage.

A clause specifies tags, conditions, or output. `%extend-rule` adds alternatives. It does not copy the original clauses onto them.

The notation cannot remove one alternative. If you need that change, replace the complete rule with `%redefine-rule`.

### Replace a stage

If you replace an entire stage, use `%redefine-stage NAME`. Define its complete grammar after that directive.

Stage replacement clears all its grammar items and parsing policy. It keeps the stage position, other stages, and global features.

Set `%ambiguity-resolution` in the replacement stage. That directive specifies how the stage ranks competing parses.

### Add a feature

If your change needs a switch, guard its alternative with `name?`. Add `%features name` before the first `%stage` to enable it by default in every stage.

Use `--feature name` to enable a feature. Use `--no-feature name` to disable it.

A warning guard, `name!`, reports an addition when enabled. It does not change which texts the grammar accepts.

## Common mistakes

These reproductions create temporary files at the repository root. The recorded errors use `/path/to/gencmu` as that root. Your errors will name your own path.

### A missing include

Create `missing-include.md` with a nonexistent include:

````sh
cat > missing-include.md <<'EOF'
```jbogenbau
%include "grammars/lojban/missing/pipeline.md"
```
EOF
````

Run the file:

````sh
node lib/js/cli.js parse --pipeline-file missing-include.md "broda"
````

The command exits with `2`:

````text
gencmu: /path/to/gencmu/missing-include.md:2:1: /path/to/gencmu/grammars/lojban/missing/pipeline.md was not found (/path/to/gencmu/missing-include.md → /path/to/gencmu/grammars/lojban/missing/pipeline.md)
````

If you see `was not found`, correct `%include` relative to its containing document. Before you select its stages, include the base pipeline.

### A rule extended in the wrong stage

Create `wrong-stage.md` with a syntax rule extension in forms:

````sh
cat > wrong-stage.md <<'EOF'
```jbogenbau
%include "grammars/lojban/cll/pipeline.md"
%extend-stage forms
%extend-rule paragraph
  KIhEI
```
EOF
````

Run the file:

````sh
node lib/js/cli.js parse --pipeline-file wrong-stage.md "broda"
````

The command exits with `2`:

````text
gencmu: /path/to/gencmu/wrong-stage.md:4: %extend-rule paragraph extends a rule that is not defined before it
````

If you see this error, replace `%extend-stage forms` with `%extend-stage syntax`. A stage can only extend its own existing rules.

### An ambiguity that makes a tie

An additional alternative can duplicate an existing reading.

Create `tied.md` with an extra route to `statement`:

````sh
cat > tied.md <<'EOF'
```jbogenbau
%include "grammars/lojban/cll/pipeline.md"
%extend-stage syntax
%extend-rule paragraph
  statement
```
EOF
````

Run the file:

````sh
node lib/js/cli.js parse --pipeline-file tied.md "broda"
````

The command exits with `1`. Its error starts with this line:

````text
The syntax stage is ambiguous: its grammar reads the text in two ways, and no rule ranks one above the other.
````

If you see a tie, inspect the two readings in the CLI output. In the playground, inspect them in the Tree tab.

A span is a range of input tokens. A ranked choice prefers alternatives for the same span.

Remove an accidental overlap. If both alternatives belong, express their intended preference with rules or [ranked choices](notation.md#ranked-choices).

The order of `|` alternatives does not settle a tie. Ordinary alternatives have no priority by position.

### An unreachable rule

An unreachable rule has no route from `text`. A stage starts at its entry rule, `text`.

Create `unreachable.md` with a rule that nothing uses:

````sh
cat > unreachable.md <<'EOF'
```jbogenbau
%include "grammars/lojban/cll/pipeline.md"
%extend-stage syntax
%rule unused-frame
  KOhA
```
EOF
````

Run the audit, a report on the assembled grammar:

````sh
node lib/js/cli.js audit --pipeline-file unreachable.md
````

The report includes this line:

````text
  unreachable from text: unused-frame
````

If your rule appears here, connect it to an existing rule. If its name is wrong, correct the definition.

The Audit tab reports the same problem for the pipeline selected in the playground. An audit can exit with `0` despite unreachable rules.

## Read further

Read [Pipelines](notation.md#pipelines) for pipelines, stage order, `%include`, `%extend-stage`, and `%redefine-stage`.

Read [Stitching documents](notation.md#stitching-documents) for `%rule`, `%extend-rule`, and `%redefine-rule`.

Read [Classifiers](notation.md#classifiers) for lexicons, exact keys, and class membership.

Read [Names and terminals](notation.md#names-and-terminals) for classes, terminals, and tags.

Read [Feature guards](notation.md#feature-guards) for gates, warnings, and feature switches.

Read [Ambiguity](notation.md#ambiguity) for ties and the rules that rank parses.

Read [Corpus cases](../tests/README.md#corpus-cases-corpusjsonl-and-coretxt) for expected results and shared tests.

## Zbalermorna names

The zbalermorna phoneme document declares `%names "zbalermorna-names.txt"` before its rules. Bundled loading supplies that resource for every pipeline that includes the document. It names both the older Humbert encoding and the 2024 UCSUR encoding. Each Explicit rule row contributes both scalars to exactly the same grammar alternatives. Channels that these alternatives set by recipe have equal results for both encodings.

Shared rules that copy source text retain the written scalar in values and images. Token text and source metadata also retain it. The seven No explicit rule pairs still follow the pipeline's shared rules. The `lojban/bpfk` and `lojban/zantufa` pipelines read them as pause material. The experimental pipeline reads them as foreign material. Loading and parsing produce no warning about the older encoding.

[The grammar's encoding section](../grammars/lojban/common/zbalermorna.md#two-encodings) pins both sources and defines the character mapping and phoneme behavior. Encoding-qualified names keep the two sets of scalar values distinct. The names file includes assigned characters beyond the current phoneme inventory. Names alone add no grammar alternatives. With bundled core data, private-use images print with numeric escapes.
