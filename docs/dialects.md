# Implement a dialect

A dialect defines a pipeline of grammars. A stage is one step of a parse. A pipeline is an ordered sequence of stages.

A phoneme is one speech sound. A token is one unit that a stage reads.

The Lojban stages read phonemes, recognize word forms, process the word stream, attach indicators, and read syntax. A parse tree records which rules matched the text.

This HOWTO uses the rules of [kihei](../grammars/dialects/kihei.md). A frame is a context for subsequent utterances. Kihei adds the frame marker `ki'ei` and changes the tree around utterances.

## Before you start

Use a checkout of [int19h/gencmu](https://github.com/int19h/gencmu). Install Node 20 or later.

Run these commands from the repository root:

````sh
cd lib/js
npm ci
cd ../..
````

Unless a step names another directory, use the repository root as your working directory. The commands below create example files, so use filenames that contain none of your work.

CLL means *The Complete Lojban Language*. A literate grammar combines prose with fenced `jbogenbau` blocks. A directive is an instruction that starts with `%`.

## Procedure

1. Create the dialect file.

   Create `grammars/dialects/my-kihei.md` with this command:

   ````sh
   cat > grammars/dialects/my-kihei.md <<'EOF'
   # My discourse frames

   This dialect adds frames to CLL.

   - [The CLL dialect](cll-ebnf.md)
     ```jbogenbau
     %include "cll-ebnf.md"
     ```
   EOF
   ````

   `%include` reads the base dialect before your additions. Its path starts from the directory of the file that contains it.

   Keep the Markdown link and its `%include` together. The document tests require this layout for grammar files.

   The included dialect creates all five stages. `%extend-stage` selects an existing stage without changing its position.

2. Add the word class in the forms stage.

   A cmavo is a short structure word. A selma'o is a class of cmavo. A canonical sound is a normalized spelling of phonemes.

   A classifier maps canonical sounds to classes. A lexicon is the classifier that assigns selma'o.

   Append these rules to `grammars/dialects/my-kihei.md`:

   ````sh
   cat >> grammars/dialects/my-kihei.md <<'EOF'

   ```jbogenbau
   %extend-stage forms
   %classifier lexicon
     "ki'ei" ∈ KIhEI
   ```
   EOF
   ````

   `%extend-stage forms` selects the grammar that recognizes words. `%classifier lexicon` adds the class `KIhEI` to the sound `ki'ei`.

   CLL already accepts this word form. The later word stages carry its class to syntax.

   Inspect the forms output with this command:

   ````sh
   node lib/js/cli.js parse --pipeline grammars/dialects/my-kihei.md --until forms --format tokens "ki'ei"
   ````

   Output:

   ````text
   phonemes: 5 tokens, unique
   #  text  phonemes  label  span  source  tags
   0  "k"   "k"       "k"    0-1   0-1     /k/
   1  "i"   "i"       "i"    1-2   1-2     /i/
   2  "'"   "'"       "'"    2-3   2-3     /'/
   3  "e"   "e"       "e"    3-4   3-4     /e/
   4  "i"   "i"       "i"    4-5   4-5     /i/

   forms: 1 tokens, unique
   #  text     phonemes  label    span  source  tags
   0  "ki'ei"  "ki'ei"   "ki'ei"  0-5   0-5     KIhEI cmavo continued onset run-final run-initial word
   ````

   A tag is a label that a token carries. `KIhEI` must appear among the tags in the forms output.

   If your word fails before forms, change the phoneme stage first. If forms rejects its shape, change the forms rules.

   If you change an existing classification, remove its old class with `∉`.

   Add its replacement class with `∈`.

   Keep lexicon keys lowercase. Use a straight apostrophe in those keys.

3. Add the syntax construct.

   A rule describes the parts that a grammar can match. A terminal matches a token with a specified tag.

   Append the kihei syntax rules to `grammars/dialects/my-kihei.md`:

   ````sh
   cat >> grammars/dialects/my-kihei.md <<'EOF'

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
   EOF
   ````

   `%extend-stage syntax` selects syntax after the forms addition. `%redefine-rule paragraph` replaces the inherited paragraph rule.

   `%rule` defines each new rule. `KIhEI` matches the new word class, and `[terms]` accepts zero or more CLL terms.

   `#` reads optional free modifiers. A free modifier is a phrase that can appear almost anywhere. `I` matches `.i`.

   The frame and its subsequent utterances share a `frame-group`. The construct requires `.i` before an utterance that follows a frame.

   An alternative is one possible body of a rule. If you need only another alternative, use `%extend-rule` on the existing rule.

   Put the extension in that rule's stage.

   A clause specifies tags, conditions, or output. `%extend-rule` adds alternatives. It does not copy the original clauses onto them.

   The notation cannot remove one alternative. If you need that change, replace the complete rule with `%redefine-rule`.

   If you replace an entire stage, use `%redefine-stage NAME`. Define its complete grammar after that directive.

   Stage replacement clears all its grammar items and parsing policy. It keeps the stage position, other stages, and global features.

   Set `%ambiguity-resolution` in the replacement stage. That directive specifies how the stage ranks competing parses.

4. Parse a text with your dialect.

   The CLI accepts commands from your terminal.

   Run the local file through `lib/js/cli.js`:

   ````sh
   node lib/js/cli.js parse --pipeline grammars/dialects/my-kihei.md "ki'ei ko'a .i broda"
   ````

   Output:

   ````text
   ([ki'ei ko'a] i broda)
   ````

   `--pipeline` reads your files from disk. `--dialect` reads the package's bundled copy. Run `node tools/sync.js` before testing changed grammar files through `--dialect`.

   A feature is a named switch for a parse. List the features that the local dialect exposes:

   ````sh
   node lib/js/cli.js features --pipeline grammars/dialects/my-kihei.md
   ````

   Output:

   ````text
   cll-cyrillic            gate     on
   sa-su                   gate     off
   su-boundary             gate     off
   y-cmavo                 warning  off
   ````

   Kihei inherits these features from CLL. It adds no feature of its own.

   If your change needs a switch, guard its alternative with `name?`. Add `%features name` to enable it by default.

   Use `--feature name` to enable a feature. Use `--no-feature name` to disable it.

   A warning guard, `name!`, reports an addition when enabled. It does not change which texts the grammar accepts.

   The CLI exits with `0` for acceptance, `1` for rejection or a tie, and `2` for a grammar or command error.

5. Compare the trees.

   Parse the same CLL text in the base dialect:

   ````sh
   node lib/js/cli.js parse --dialect cll-ebnf --format tree "broda .i brode"
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

   Parse that text in kihei:

   ````sh
   node lib/js/cli.js parse --dialect kihei --format tree "broda .i brode"
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

   Kihei adds `utterance-sequence` below `paragraph`. Both dialects still accept the text. Their default bracket output hides this structural difference.

   `›` joins successive tree nodes on one line. An elided terminator is an omitted closing word. `⟨VAU⟩` marks one.

   Parse a frame in kihei:

   ````sh
   node lib/js/cli.js parse --dialect kihei --format tree "ki'ei ko'a .i broda"
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

   Try that frame in the base dialect:

   ````sh
   node lib/js/cli.js parse --dialect cll-ebnf --format tree "ki'ei ko'a .i broda"
   ````

   The command exits with `1`. Its error starts with these lines:

   ````text
   The syntax stage cannot read the text at "ki'ei":
   1 | ki'ei ko'a .i broda
     | ^^^^^
   ````

   CLL recognizes the word form but assigns no `KIhEI` class. Its syntax has no frame construct.

6. Try the rules in the playground.

   Open `index.html` from your checkout in a browser.

   Select `kihei` in the Dialect menu.

   Enter `ki'ei ko'a .i broda` in Text.

   Select the Tree tab.

   Under Grammar documents, open `dialects/kihei.md`.

   Edit its `%extend-stage` blocks to try your change.

   The page parses again after each edit. The Audit tab lists changes to the grammar and rules that nothing reaches.

   If you want to keep an edit, click Download. Save the downloaded content to its corresponding file in your checkout.

   The browser names that download `dialects--kihei.md`. Browser edits disappear when you reload the page.

   The playground has no file upload or command that loads an arbitrary local dialect. You cannot load `my-kihei.md` directly into the shipped page.

   If you want your new dialect in the local menu, complete step 8 first. Reopen your checkout's `index.html` after synchronization.

   `dist/grammars.js` is a bundle, a generated collection of grammars. `node tools/sync.js` rebuilds that bundle. The hosted playground does not read your checkout.

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

   `at` counts code points from zero. `11` is the start of `broda` in the rejected text.

   Run both cases against your local file:

   ````sh
   node lib/js/cli.js test my-kihei.jsonl --pipeline grammars/dialects/my-kihei.md
   ````

   ````text
   2 of 2 cases pass
   ````

   These local cases omit `dialect`, so the CLI uses `--pipeline`. The shared corpus requires a bundled dialect name.

   For shared tests, add `"dialect":"my-kihei"` to each case. Save those cases to `tests/corpus/my-kihei.jsonl`.

   Add their IDs to `tests/core.txt`. The core corpus runs in all four libraries on pull requests.

   Include an accepted case, a rejected case, and a base comparison. Record the intended brackets rather than accepting output without inspection.

   The HOWTO also supplies five cases in `tests/corpus/dialects-howto.jsonl`. They cover the tree examples and the missing `.i`.

   Run those bundled cases:

   ````sh
   node lib/js/cli.js test tests/corpus/dialects-howto.jsonl
   ````

   ````text
   5 of 5 cases pass
   ````

   Brackets do not record every rule node. If your change groups text differently, add tests for tree nodes like those in `lib/js/test/kihei.test.js`.

8. Prepare the dialect for shared use.

   The prose coverage tool requires a coverage decision for each new grammar document. It automatically examines documents of `cll-ebnf` and `bpfk`.

   For this trial, add this entry to `UNCHECKED` in `tools/quoted-texts.js`:

   ````js
   "grammars/dialects/my-kihei.md": "the trial has local corpus cases in my-kihei.jsonl",
   ````

   This entry records why the automatic CLL prose test excludes the trial. The tests must cover its claims.

   For your own dialect, name its actual tests in that reason.

   In `lib/js/test/quoted-texts.test.js`, add `my-kihei` to the expected list for `dialectNames()`.

   Add `my-kihei` to the expected list for `documentDialects().get("grammars/syntax/cll.md")`.

   `quoted-texts.test.js` names every dialect and every dialect that includes CLL syntax. Keep each list in alphabetical order.

   Add the new grammar file to Git:

   ````sh
   git add grammars/dialects/my-kihei.md
   ````

   Add your corpus files and test changes to Git.

   Run the synchronization commands from the repository root:

   ````sh
   node tools/sync.js
   node tools/sync.js --check
   ````

   `sync.js` copies grammars into the libraries, rebuilds browser files, and draws rule diagrams. `--check` fails when generated files or document conventions differ.

   Run the document tests in `lib/js`:

   ````sh
   node --test test/documents.test.js test/markdown.test.js test/links.test.js test/prose-lines.test.js test/quoted-texts.test.js
   ````

   Run the kihei tests and core corpus in `lib/js`:

   ````sh
   node --test test/kihei.test.js test/corpus.test.js
   ````

   If you add other tests, run them too.

   Review the generated changes before committing them. Keep each prose paragraph on one line.

## Common mistakes

These reproductions create temporary files at the repository root. The recorded errors use `/build/gencmu/worktrees/howto` as that root. Your errors will name your own path.

### A missing include

Create `missing-include.md` with a nonexistent include:

````sh
cat > missing-include.md <<'EOF'
```jbogenbau
%include "grammars/dialects/missing.md"
```
EOF
````

Run the file:

````sh
node lib/js/cli.js parse --pipeline missing-include.md "broda"
````

The command exits with `2`:

````text
gencmu: /build/gencmu/worktrees/howto/missing-include.md:2:1: /build/gencmu/worktrees/howto/grammars/dialects/missing.md was not found (/build/gencmu/worktrees/howto/missing-include.md → /build/gencmu/worktrees/howto/grammars/dialects/missing.md)
````

If you see `was not found`, correct `%include` relative to its containing document. Include the base before selecting its stages.

### A rule extended in the wrong stage

Create `wrong-stage.md` with a syntax rule extension in forms:

````sh
cat > wrong-stage.md <<'EOF'
```jbogenbau
%include "grammars/dialects/cll-ebnf.md"
%extend-stage forms
%extend-rule paragraph
  KIhEI
```
EOF
````

Run the file:

````sh
node lib/js/cli.js parse --pipeline wrong-stage.md "broda"
````

The command exits with `2`:

````text
gencmu: /build/gencmu/worktrees/howto/wrong-stage.md:4: %extend-rule paragraph extends a rule that is not defined before it
````

If you see this error, select `%extend-stage syntax` before extending `paragraph`. A stage can only extend its own existing rules.

### An ambiguity that makes a tie

A tie means that two best readings have equal rank. Adding an alternative can duplicate an existing reading.

Create `tied.md` with an extra route to `statement`:

````sh
cat > tied.md <<'EOF'
```jbogenbau
%include "grammars/dialects/cll-ebnf.md"
%extend-stage syntax
%extend-rule paragraph
  statement
```
EOF
````

Run the file:

````sh
node lib/js/cli.js parse --pipeline tied.md "broda"
````

The command exits with `1`. Its error starts with this line:

````text
The syntax stage is ambiguous: its grammar reads the text in two ways, and no rule ranks one above the other.
````

If you see a tie, inspect the two readings in the CLI output. In the playground, inspect them in the Tree tab.

Remove an accidental overlap. If both alternatives belong, express their intended preference with rules or [ranked choices](notation.md#ranked-choices).

A ranked choice prefers alternatives for the same span. A span is a range of input tokens.

Reordering `|` alternatives does not settle a tie. Ordinary alternatives have no priority by position.

### An unreachable rule

An unreachable rule has no route from `text`. A stage starts at its entry rule, `text`.

Create `unreachable.md` with a rule that nothing uses:

````sh
cat > unreachable.md <<'EOF'
```jbogenbau
%include "grammars/dialects/cll-ebnf.md"
%extend-stage syntax
%rule unused-frame
  KOhA
```
EOF
````

Run the audit, a report on the assembled grammar:

````sh
node lib/js/cli.js audit --pipeline unreachable.md
````

The report includes this line:

````text
  unreachable from text: unused-frame
````

If your rule appears here, connect it to an existing rule. If its name is wrong, correct the definition.

The Audit tab reports the same problem for the dialect selected in the playground. An audit can exit with `0` despite unreachable rules.

## Read further

Read [Pipelines](notation.md#pipelines) for dialects, stage order, `%include`, `%extend-stage`, and `%redefine-stage`.

Read [Stitching documents](notation.md#stitching-documents) for `%rule`, `%extend-rule`, and `%redefine-rule`.

Read [Classifiers](notation.md#classifiers) for lexicons, class membership, and sound keys.

Read [Names and terminals](notation.md#names-and-terminals) for classes, terminals, and tags.

Read [Feature guards](notation.md#feature-guards) for gates, warnings, and feature switches.

Read [Ambiguity](notation.md#ambiguity) for ties and the rules that rank parses.

Read [Corpus cases](../tests/README.md#corpus-cases) for expected results and shared tests.
