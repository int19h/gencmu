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

   A classifier maps exact values to classes. A lexicon is the classifier that assigns selma'o. Classes start and end with uppercase ASCII letters and never start with `_`.

   Append these rules to `grammars/lojban/examples/my-kihei/pipeline.md`:

   ````sh
   cat >> grammars/lojban/examples/my-kihei/pipeline.md <<'EOF'

   ```jbogenbau
   %extend-stage forms
   %redefine-const $LEXICON {*$LEXICON, KIhEI: "ki'ei"}

   ```
   EOF
   ````

   `%extend-stage forms` selects the grammar that assigns word classes. The redefinition adds KIhEI to the lexicon. The forms output mask includes `*$LEXICON.keys`, which permits the new class.

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
   0  "k"   "k"    "k"    0-1   0-1     Consonant
   1  "i"   "i"    "i"    1-2   1-2     Vowel
   2  "'"   "'"    "'"    2-3   2-3
   3  "e"   "e"    "e"    3-4   3-4     Vowel
   4  "i"   "i"    "i"    4-5   4-5     Vowel

   forms: 1 tokens, unique
   #  text     value    image    span  source  tags
   0  "ki'ei"  "ki'ei"  "ki'ei"  0-5   0-5     Cmavo Continued KIhEI Onset Run-Final Run-Initial Word
   ````

   A tag is a named mark on a token. Make sure that KIhEI appears in the forms output. Read `value` for comparisons and `image` for visible spelling.

   Use lowercase Lojban spellings as the values. Write a straight apostrophe in those spellings. Keep the class name `KIhEI` as shown.

3. Add the syntax construct.

   A terminal matches a token with a specified tag.

   Append the kihei syntax rules to `grammars/lojban/examples/my-kihei/pipeline.md`:

   ````sh
   cat >> grammars/lojban/examples/my-kihei/pipeline.md <<'EOF'

   ```jbogenbau
   %extend-stage syntax
   %redefine-rule paragraph
     utterance-sequence & {frame-group}

   %rule utterance-sequence
     (statement | fragment) [{I 🆓 [statement | fragment]}]

   %rule frame-group
     frame [{I 🆓} [utterance-sequence]]

   %rule frame
     KIhEI 🆓 [terms]
   ```
   EOF
   ````

   `%extend-stage syntax` selects syntax after the forms addition. `%redefine-rule paragraph` replaces the inherited paragraph rule.

   `%rule` defines each additional rule. `KIhEI` matches the additional word class, and `[terms]` accepts zero or more CLL terms.

   A free modifier adds information at permitted grammar positions. `🆓` reads optional free modifiers. `I` matches `.i`.

   The frame and its subsequent utterances share a `frame-group`. The construct requires `.i` before an utterance that follows a frame.

   An empty sentence position has no utterance. Repeated initial `I 🆓` slots allow these positions before the first utterance. Both `ki'ei ko'a .i .i broda` and `ki'ei ko'a .i .i` parse.

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

   The example pipeline inherits these features from CLL. It adds no feature of its own.

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
     statement › statement-1 › statement-2 › statement-3 › sentence › bridi-tail › bridi-tail-1 › bridi-tail-2 › bridi-tail-3
       selbri › selbri-1 › selbri-2 › selbri-3 › selbri-4 › selbri-5 › selbri-6 › tanru-unit › tanru-unit-1 › tanru-unit-2 · broda
       tail-terms
         ⟨VAU⟩
     I "i"
     statement › statement-1 › statement-2 › statement-3 › sentence › bridi-tail › bridi-tail-1 › bridi-tail-2 › bridi-tail-3
       selbri › selbri-1 › selbri-2 › selbri-3 › selbri-4 › selbri-5 › selbri-6 › tanru-unit › tanru-unit-1 › tanru-unit-2 · brode
       tail-terms
         ⟨VAU⟩
   ````

   Parse that text with your local example pipeline:

   ````sh
   node lib/js/cli.js parse --pipeline-file grammars/lojban/examples/my-kihei/pipeline.md --format tree "broda .i brode"
   ````

   ````text
   text › text-1 › paragraphs › paragraph › utterance-sequence
     statement › statement-1 › statement-2 › statement-3 › sentence › bridi-tail › bridi-tail-1 › bridi-tail-2 › bridi-tail-3
       selbri › selbri-1 › selbri-2 › selbri-3 › selbri-4 › selbri-5 › selbri-6 › tanru-unit › tanru-unit-1 › tanru-unit-2 · broda
       tail-terms
         ⟨VAU⟩
     I "i"
     statement › statement-1 › statement-2 › statement-3 › sentence › bridi-tail › bridi-tail-1 › bridi-tail-2 › bridi-tail-3
       selbri › selbri-1 › selbri-2 › selbri-3 › selbri-4 › selbri-5 › selbri-6 › tanru-unit › tanru-unit-1 › tanru-unit-2 · brode
       tail-terms
         ⟨VAU⟩
   ````

   The example pipeline adds `utterance-sequence` below `paragraph`. Both pipelines still accept the text. Their default bracket output hides this structural difference.

   `›` joins successive tree nodes on one line. An elided terminator is an omitted closing word. `⟨VAU⟩` marks one.

   Parse a frame with your local example pipeline:

   ````sh
   node lib/js/cli.js parse --pipeline-file grammars/lojban/examples/my-kihei/pipeline.md --format tree "ki'ei ko'a .i broda"
   ````

   ````text
   text › text-1 › paragraphs › paragraph › frame-group
     frame
       KIhEI "ki'ei"
       terms › terms-1 › terms-2 › term › sumti › sumti-1 › sumti-2 › sumti-3 › sumti-4 › sumti-5 › sumti-6 · ko'a
     I "i"
     utterance-sequence › statement › statement-1 › statement-2 › statement-3 › sentence › bridi-tail › bridi-tail-1 › bridi-tail-2 › bridi-tail-3
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

   The page fetches the Unicode properties file at startup. When a grammar needs names data, the page fetches it.

   Under `lojban/examples`, select `lojban/examples/kihei` in the Pipeline menu.

   Enter `ki'ei ko'a .i broda` in Text.

   Select the Tree tab.

   Under Grammar documents, open `lojban/examples/kihei/pipeline`.

   Edit its `%extend-stage` blocks to try your change.

   The page parses again after each edit. The Audit tab lists changes to the grammar and rules that nothing reaches.

   If you want to keep an edit, click Download. Save the downloaded content to its corresponding file in your checkout.

   The browser names that download `lojban--examples--kihei--pipeline.md`. When you reload the page, browser edits disappear.

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

   The tutorial also supplies five cases in `tests/corpus/pipelines-howto.jsonl`. They cover the tree examples and the missing `.i`.

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

   For this example pipeline, add this entry to `UNCHECKED` in `tools/quoted-texts.js`:

   ````js
   "grammars/lojban/examples/my-kihei/pipeline.md": "the example pipeline has local corpus cases in my-kihei.jsonl",
   ````

   This entry records why the automatic CLL prose test excludes the example pipeline. The tests must cover its claims.

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

   `sync.js` copies `grammars/` and `data/` into the libraries. It regenerates preparsed data, browser resources, and rule diagrams. When generated files or document conventions differ, `--check` fails.

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

```text
%rule consonant
  | "b" → {image: value: "b"}
  | "B" → {image: value: "b"}
  | "б" → {image: value: "b"}
%emit

%rule digit-0
  "0"
%emit
  ${image: value: "n"}, ε{image: value: "o"}
```

The consonant term gives both strings and stops the sole-symbol copy. The second digit phoneme is an insertion with empty source text. Place each nonempty cover once in the output.

An engine membership comes from an input token. Copy or select it from an existing source. For example, `*$c.select({_General_Category_Uppercase_Letter})` keeps the key where the captured character has it.

Stage zero decomposes accented letters into base letters and combining marks. An extension supplies its own term and emission directive.

```text
%extend-rule stressed-vowel
  | "A" "‹U+0301›" → {Stressed, value: "a", image: "A"}
%emit
```

The value supplies the plain vowel. The image keeps visible stress. If a later stage reads `Stressed`, include it in the output mask.

## Phoneme values and stress

The bundled Lojban pipelines run `phonemes`, `forms`, `words`, `indicators`, and `syntax`, in that order.

A stressed vowel has its plain lowercase value and the `Stressed` tag. Its image retains visible stress. A syllable comma has empty value, image `,`, and tag `Syllable-Break`. Empty values retain their input coverage.

The `syllable-break` rule in [the strict Latin grammar](../grammars/lojban/cll/latin.md) reads `commas`. Its covering emission sets the comparison value:

```text
%rule syllable-break
  commas → {Syllable-Break, value: "", image: ","}
%emit
```

The token retains the comma run as its text and source. Its empty value does not erase it. The forms stage receives phoneme values directly.

## Supply properties to parents

A parent reads a child's working bag. If a parent needs a property, put it in the child's rule term. A braced emission item changes only the new node that it selects.

When the child emits, its projection publishes `x`. The parent over `ab` reads the child's ordinary value and publishes `ab`.

```text
%const $DEFAULTS $n ↦ {value: $n.children!'value.join(), image: $n.children!'image.join()}
%const $OUTPUTS {}
%ambiguity-resolution greedy

%rule text
  child | parent

%rule child
  "a"
%emit
  ${image: value: "x"}

%rule parent
  child "b"
%emit
```

To give the parent the value `x`, place `→ {image: value: "x"}` on the child alternative. The parent then publishes `xb`.

## Quote images

[Raw payload rules](../grammars/lojban/common/stream.md#raw-payloads) use verbatim text for quote images. Read a child's computed image with `'image`.

## Carry decisions through tags

If a parent needs a recognition decision, give it a key. State where the key originates, which rules copy it and which rules read it.

[The spacing rules](../grammars/lojban/common/stream.md#spacing-and-hesitation) define `Gap-Pause` and its surviving pauses. [The compound rules](../grammars/lojban/common/stream.md#compounds) define the origin, forwarding, readers, and end of `Trailing-Pause`.

Use `$b.classes.overlaps($SU-STOPS)` for any-of membership. Two overlapping alternatives can produce two derivations for one token.

## Rules of the words stage

[Shared word gaps](../grammars/lojban/common/stream.md#shared-word-gaps) distinguish hesitation, pauses, and empty gaps inside quotes. [Compounds](../grammars/lojban/common/stream.md#compounds) define gap classification for BU and ZEI.

[SA and SU erasure](../grammars/lojban/common/stream.md#erasure-by-sa-and-su) defines surviving boundary units. The compound rules describe their trailing-space state and its end.

[The Latin phoneme grammar](../grammars/lojban/common/latin.md#punctuation) defines non-Lojban character runs. [The forms grammar](../grammars/lojban/common/forms.md#runs) defines foreign tokens and unsegmentable runs. [Closing delimiter runs](../grammars/lojban/common/stream.md#closing-delimiter-runs) define the fixed Y keys.

## Other changes

If your change differs from the kihei example, use these approaches.

### Change word forms or classifications

If your word fails before forms, change the phoneme stage first. If forms rejects its shape, change the forms rules.

If you move a spelling between classes, redefine `$LEXICON` with `%redefine-const`. Keep the existing entries by splatting the previous version. If both class entries are lists of strings, remove the spelling from the old list and append it to the new list.

```text
%redefine-const $LEXICON {*$LEXICON, OLD: $LEXICON'OLD ∖ "ji", NEW: [*$LEXICON'NEW, "ji"]}
```

### Add or replace alternatives

An alternative is one possible body of a rule. If you need only another alternative, use `%extend-rule` on the existing rule.

Put the extension in that rule's stage.

A term supplies bag entries. A clause can state conditions or select output. `%extend-rule` adds alternatives. It does not copy the original clauses onto them.

The notation cannot remove one alternative. If you need that change, replace the complete rule with `%redefine-rule`.

### Replace a stage

If you replace an entire stage, use `%redefine-stage NAME`. Define its complete grammar after that directive.

Stage replacement clears all its grammar items and parsing policy. It keeps the stage position, other stages, and global features.

Set `%ambiguity-resolution` in the replacement stage. That directive specifies how the stage ranks competing parses.

### Add a feature

If your change needs a switch, gate its alternative with `name?`. Add `%features name` before the first `%stage` to enable it by default in every stage.

Use `--feature name` to enable a feature. Use `--no-feature name` to disable it.

To report an addition, put its body in a `%warning` rule named by its code. Splice that rule where the body belongs, as `*name`. Put conditions that read its captures in that rule too.

Give `%warning` a string expression after `%conditions`. Put `%suppress-warnings` before `%emit` or `%erased`.

Switching a warning on changes no ranking. A reached warning message can fail after the engine chooses a reading. Callers enable or disable its code with the feature controls. `%suppress-warnings code` suppresses it within one subtree, and `_` suppresses all warning codes.

For invalid constructs, use `%error` only for messages that add information or state the default rejection more briefly. The engine prefers least source blame, then fewest sourceless errors, then most total errors, before grammar ranking. Earlier publishing stages can continue after chosen errors. A reported result keeps the chosen tree, verdict and any completed publication. For a tree-only last stage, the loader inspects `%emit` clauses and the audit notes them. The engine skips those clauses at runtime.

Use `--` for comments inside grammar blocks. A comment ends at LF, CRLF, CR, or the file end. A string retains literal `--`. The notation has no block comment form.

## Playground examples

Each grammar family can define playground examples in `grammars/FAMILY/examples.json`. A family without examples has no `examples.json` file.

The file holds a JSON array of example objects in menu order. The playground shows only the examples whose `pipelines` array names the active pipeline.

| Field | Required | Meaning | Overridable |
| --- | --- | --- | --- |
| `id` | yes | Lowercase ASCII letters, digits, and single internal hyphens. Unique across all example files. | no |
| `title` | yes | The menu label, in simple English, with no final period. | no |
| `text` | yes | The nonempty input text to parse. It can contain `\n`. | no |
| `pipelines` | yes | A nonempty array of family pipeline names without repeats. When the active pipeline is not in the list, the page switches to the first entry. | no |
| `expect` | yes | The expected outcome from the outcome table below. | no |
| `stage` | no | The stage that a non-accepted outcome names. When `expect` is `accepted`, `stage` is forbidden. | no |
| `features` | no | An object that maps feature names to `true` or `false`. | yes, merged |
| `elisionOnly` | no | `true` or `false`. Absent uses the grammar default. | yes |
| `view` | no | One of `brackets`, `tree`, `json`, `tokens`, `trace`, or `audit`. Absent defaults to `brackets`. | yes |
| `showElided` | no | `true` or `false` for the Brackets toggle. Absent defaults to `false`. | yes |
| `gloss` | no | An English rendering of `text`, in simple English. | no |
| `warnings` | no | A nonempty array of distinct warning codes. | yes |
| `hint` | no | The body text of the example note, in simple English. | yes |
| `open` | no | The document and target to open in the grammar pane. | yes |
| `byPipeline` | no | An object that maps a pipeline in `pipelines` to per-pipeline overrides. | not applicable |

### Expected outcomes

`expect` takes one of seven values:

| `expect` | Matching parse result | Menu pill |
| --- | --- | --- |
| `accepted` | `ok` is true | `accepted`, or `accepted` with the warning icon |
| `rejected` | error kind `rejected` | `rejected` |
| `reported` | error kind `reported` | `reported` |
| `tie` | error kind `ambiguous` with reason `tie` | `tie` |
| `elision-only` | error kind `ambiguous` with reason `elision-only` | `elision-only` |
| `feature-conflict` | error kind `feature-conflict` | `feature conflict` |
| `grammar` | error kind `grammar`, including a pipeline load error | `grammar error` |

When `stage` is present, the error stage must equal `stage`. For every outcome, the distinct warning codes must match `warnings`. When `warnings` is absent, the run must produce no warnings.

### Per-pipeline overrides and targets

Each key of `byPipeline` must appear in `pipelines`. An override object can contain `features`, `warnings`, `elisionOnly`, `view`, `showElided`, `hint`, and `open`.

`features` merges with the top-level `features` map, and the pipeline entry wins. Any other override field replaces the top-level field for that pipeline, and `null` clears it.

Every top-level feature must exist in every pipeline in `pipelines`. Every feature or warning code in an override must exist in that pipeline, and merged features must not disable an expected warning.

`open` is an object with `document` and either `rule` or `anchor`, never both. `document` is a repository path such as `grammars/lojban/cll/syntax.md` that belongs to the target pipeline.

`rule` names a rule defined in `document`. `anchor` is a literal string that occurs once in `document`.

`node tools/sync.js` bundles the example files into `dist/grammars.js` and copies them to the library packages. `node tools/sync.js --check` checks the format and runs every example on every listed pipeline.

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

Read [Feature gates](notation.md#feature-gates) for gates and feature switches.

Read [Errors and warnings](notation.md#errors-and-warnings) for diagnostics and suppression.

Read [Splices](notation.md#splices) for transparent calls.

Read [Ambiguity](notation.md#ambiguity) for ties and the rules that rank parses.

Read [Corpus cases](../tests/README.md#corpus-cases-corpusjsonl-and-coretxt) for expected results and shared tests.

The [zbalermorna names resource](../grammars/lojban/common/zbalermorna.md#two-encodings) is an example of extra names for a script.
