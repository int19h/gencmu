# The shared tests

Every gencmu library runs every shared case that its API can express. The Rust library skips two engine cases, as "Engine cases" says. If a case fails in one library and passes in another, there is a bug. The bug is in the library that disagrees with `docs/engine.md`, or in the specification itself.

## Engine cases: `engine/*.json`

Each file is one case:

```
{
  "description": "what the case pins down, and which section of docs/engine.md",
  "grammar": "%rule text A B",
  "documents": {"path.md": "Markdown text"},
  "pipeline": "path.md",
  "tokens": [{"text": "a", "tags": ["A"]}, {"text": "b", "tags": ["B", "C"]}],
  "input": "characters",
  "options": {"features": ["f"], "withoutFeatures": ["g"], "elisionOnly": true, "until": "words"},
  "expect": {"result": PATTERN, "brackets": "(a b)", "warnings": [WARNING...], "features": [FEATURE...], "error": "grammar",
             "where": {"document": "main.md", "line": 4, "column": 12}}
}
```

The grammar comes from `grammar`, or from `documents` and `pipeline`. `grammar` is rule text for a single stage named `main`. The document of this stage is those rules in one `jbogenbau` block. On a line of its own before the rules, the block has `%ambiguity-resolution greedy`, unless the text has its own `%ambiguity-resolution`. `pipeline` names a pipeline document among `documents`.

The input is `input` or `tokens`. `input` is a string of characters, read as engine §1 says. `tokens` replaces the input of the first stage. Each token gets these values:

- Its tags are its listed tags, each written as the output writes a tag (`docs/output.md`). So a character tag is `'a'`.
- Its text is as given.
- Its phonemes are the `phonemes` member if present, or else none.
- Its label is its text.
- Its span is `[i, i+1)`.
- Its source is the position of its text in the texts joined with single spaces.
- Its attachments are its `before` and `after` members, when present, each a list of tokens in this same form. A caller cannot supply attachments. So a list that is not empty is a `usage` error, and the library drops an empty one (`docs/api.md`). The Rust library, whose input tokens have no attachments, skips a case whose tokens have either member.

Auto features (engine §13) are off for a case unless its options say `"autoFeatures": true`.

`options.features` and `options.withoutFeatures` are the features the caller turns on and off (engine §13).

`options.until`, when present, names the last stage to run (engine §13). A name that is not a stage of the dialect is a `usage` error. No case gives an empty name, because Go cannot tell an empty name from no name (`docs/api.md`). Each library tests an empty name in its own tests.

`expect.result` is a pattern matched against the canonical result of `docs/output.md`. A pattern matches in these ways:

- An object matches when every member of the pattern matches the member of the same name.
- An array matches when it has the same length and each element matches.
- Anything else matches when it is equal.

Every runner also checks these invariants on each canonical result that a case gives, whatever the case expects. A case cannot turn them off, and its pattern need not repeat them:

- An error of kind `ambiguous` has no member `token` and no member `source`.
- No stage has a member `tied`.
- A stage whose verdict is `tie` has no member `output`, and it is the last stage of the result.
- Such a result has `ok` false, `tree` null, and an error of kind `ambiguous` with the reason `tie`, that stage's name and two readings.
- No result has an error with the code `elision-witness-lost`. Engine §7.8 proves that a check that meets no error of the grammar finds W(D), and §7.9 gives this error only where a check finds no derivation of R at all. So no grammar can give it, and it is a defect of the library, whatever the case expects.

A library's own tests lose the witness on purpose, through a private switch, and call the engine directly, not through the runner. They check the form of the error: it has the kind `grammar`, a `stage`, `chosen` and `completion`, and no `token`, `source`, `line`, `column`, `expected`, `reason` or `readings`. Its stage has the verdict `resolved` and no `output`, and it is the last stage of the result. A library's own tests also show that an ordinary error of the grammar in the check has no `code`.

Take each stage where the check of engine §7 ran and ended without an error of the grammar. Every runner also asks its library whether that check kept its witness. The library answers through a test-only export that the documented API does not name (as `gencmu::tools` does in Rust), or through a module of its own tests. The answer is yes only where the check holds W(D), the derivation of R that engine §7.8 builds from the chosen derivation, and its own ranking counts it. The library answers in two steps:

- A walk looks for W(D) in the chart of the check. It takes each occurrence in the derivation tree on its own, even where the representation shares one object between occurrences.
- The library ranks the part of the forest that the walk found, with the ranker of its own check: no lean, no maximality, and the cycle contexts of the whole forest. That part holds only the items found, each with only the edges or links that the walk matched. The ranking must count at least one derivation of it.

A chart that holds W(D) is not enough, because a faulty ranker can still lose it. A positive count of derivations is not enough, because another reading can survive without W(D). Equal trees are not enough either, because transparent productions can give equal trees. The walk pins the shape of W(D) and its count, not its tags. The tags follow from the derivation, and the cases pin them. A runner fails a case, or a corpus case, whose answer is no.

A pattern matches a result that has members beyond its own. So the invariants, and not the patterns, say that a tied stage has no output.

`expect.brackets` is the bracket rendering, with elided terminators hidden. `expect.warnings` is the list of warnings of the result, compared whole. So `[]` says that there are no warnings. `expect.features` is the list of features of the dialect (`docs/api.md`), compared whole. Each feature is written as `{"name":..., "kind":..., "default":...}`.

A case can also parse its input several times with the one loaded dialect. Then it has `parses`, a list of objects, each with its own `options` and `expect`, in place of the case's `options` and `expect`:

```
"parses": [{"options": {}, "expect": {"brackets": "a"}}, {"options": {"features": ["f"]}, "expect": {"error": "grammar"}}]
```

The library loads the dialect once, and then parses the input with each item's options in order. Each result matches its item's `expect`, as below. So a case can show that one loaded dialect gives each set of features its own result, whatever it parsed before.

`expect.error` is the error kind, when the case is about an error. For a grammar that cannot be loaded, the result is the error alone. For a mistake of the caller, `usage`, there is no result.

A load that fails gives only its error. Its kind is `grammar` for a grammar that cannot be loaded. It is `usage` for a mistake of the caller at load, such as a document held in memory that is not a sequence of Unicode scalar values (engine §1). A case expects such an error with `expect.error` of that kind. For a `grammar` error, it can also give `expect.where`. It gives no `result`, `brackets`, `warnings` or `features`, because only a loaded dialect gives them. A runner fails a case when the load fails with another kind, or when the case expects one of these members. It also fails a case that gives `expect.where` with a kind other than `grammar`.

`expect.where`, when present, is where the error of a grammar that cannot be loaded stands. It is only for an error of kind `grammar`. It names a document of the case and a line and a column in it. For a case with `grammar`, the document is `main.md`. Its fence is line 1, so the rules start on line 3, or on line 2 when they hold their own `%ambiguity-resolution`.

### Faults

A shared case shows that a library is wrong where it fails. It cannot show that a library is right. So each library also breaks itself on purpose, one fault at a time, and checks that the shared cases see the break. A fault is a private switch of the library's own tests, which the documented API does not name. Each one changes one path of the engine, mostly a path of the check of engine §7, in a way that the specification forbids.

- The JavaScript library holds the full table. Its faults cover each observer of engine §7.5, the tags of synthetic tokens, the routes and strictness of §7.4, the projection, the queries of §7.6, cycles and maximality in the check, the order of one step of §4, and the ways to lose W(D). `lib/js/test/faults.json` names the cases that must catch each fault. It also records every catch, and whether the case caught it through the public result, through the witness hook alone, or through both. The witness hook alone catches a fault where another reading takes the place of W(D) and the result keeps its form.
- Each other library has a few faults of its own paths, the ones that the JavaScript library does not have. Examples are a ranker that rebuilds the check's links from completed spans and applies the tests there, an item that an ordinary step reaches after it was processed as strict, and the strictness of route 3. Its own tests name, for each fault, the shared cases that catch it.

A test runs every named case with the fault on, and fails where a named case passes. So a change that weakens a case, or the hook, shows at once.

## Notation cases: `notation/*.json`

```
{"description": "...", "document": "Markdown text", "expect": {"dom": PATTERN} or {"error": {"line": 3, "column": 7}}}
```

Each library reads the document as a grammar document (engine §8, §9). The reading makes a DOM (document object model), as `docs/output.md` describes. The library matches the DOM against the pattern, or it compares the position of the error with the expected position. The reader reports a syntax error at the first token that cannot continue the document. It reports an error of §9 at the first token of the offending construct.

## Notation shapes: `notation-shapes.json`

```
{"description": "...", "document": "Markdown text", "inputs": ["b", "qs"], "control": [OUTCOME...], "loads": {"guard": [OUTCOME...]}}
```

A caller can supply its own `notation/bootstrap.json` (`docs/api.md`). Its notation can give the reader a tree of another shape, and engine §9 says how the reader reads it. Each library loads `document` as the one document of a stage `main`, with a bootstrap made from the bundled one. It then parses each of `inputs`, with the options of the API's default. The outcome of an input is its bracket rendering if it parses, or else the kind of its error. A load that fails gives only the kind of its error.

- With the bundled bootstrap, the outcomes are `control`.
- Then each rule of the bundled bootstrap's syntax document, except `text`, gets a wrapper: a new rule whose one alternative is a reference to it. Every reference to the rule in that document becomes a reference to its wrapper. The outcomes are `control` again.
- Then each rule of that document, except `text`, gets a new name in turn: its name with `x` after it, in its definition and in every reference to it. A rule named in `loads` gives a dialect, and the outcomes are those of `loads`. Any other rule gives the load error `grammar`. No other error escapes the library.

Each item of `extraParts` gives a rule a part that the reader does not read. In the bundled bootstrap's syntax document, the text `find` stands once, and the bootstrap of the item has `replace` in its place. Each library loads the item's `document` with that bootstrap and parses its `inputs`, as above. The outcomes are those of `expect`. The extra part holds text that the reader refuses if it reads it, so an outcome other than `expect` shows that the library read it.

## Malformed directives: `dom-malformed.json`

```
[{"description": "...", "directive": DIRECTIVE, "malformed": true}, ...]
```

Each item is one directive of a DOM (`docs/output.md`). A library puts it alone in an otherwise empty DOM of the current format, and checks the DOM as it checks a precompiled one (engine §9). The DOM is malformed exactly when `malformed` is true. A library that refuses a malformed precompiled DOM reads the document instead, so the check is not visible through a parse. That is why these cases test the check directly.

## Growth cases: `growth.json`

```
[{"description": "...", "dialect": DIALECT, "text": "mi {links} klama", "link": ".e do",
  "small": 10, "large": 40, "most": 5}, ...]
```

Each item says that a bundled dialect's work on a long text grows in proportion to its length. A condition that parses a whole prefix again at each step makes a long text cost more than its length says, and no other case shows that. The library builds two texts from `text`. It replaces `{links}` with `small` copies of `link`, joined by spaces, and then with `large` copies. Both texts must parse. The library counts the items that its recognizer makes for each text, in the main parse and in every nested parse, but not while it loads the dialect. The count for `large` copies must be at most `most` times the count for `small` copies.

A library compares only its own two counts. Counts from different libraries are not compared, since each library makes its items in its own way.

## Result mutants: `result-mutants.json`

```
{"mutants": [{"name": "...", "case": "attach-tie.json", "path": ["error", "token"], "set": 0}, ...]}
```

Each mutant is a change to a canonical result that breaks an invariant (above). Every library runs the engine case `case` under `engine/`, and checks that its result keeps the invariants. Then it applies the change, and requires two refusals. The engine runner refuses the changed result, and so does the corpus runner. So the four runners hold the same invariants, and no library keeps a list of its own. Each runner requires at least one mutant, so an emptied file does not pass in silence. `node tools/sync.js --check` checks the shape of the file, as it does that of the corpus (`tools/corpus-shape.js`).

`path` leads from the result to the member or element that changes. A step is a member name or an index into a list, and the index -1 is the last element. No other negative index is defined. The change is one of these:

- `set`: the value there becomes the given value, `null` included.
- `copy`: the value there becomes a copy of the value at another path of the same result.
- `keep`: the list there keeps only its first `keep` elements.
- `remove`, with the value `true`: the member there is removed. The last step of its path is a member name, since the runners would remove an element of a list in different ways.
- `append`: the given value is added at the end of the list there.

## Corpus cases: `corpus/*.jsonl` and `core.txt`

Each line is one case: a Lojban text, with the result that gencmu must give for it:

```
{"id": "cll.5.1.c5e1d1", "text": "do mamta mi", "dialect": "cll-ebnf", "expect": "accept",
 "verdict": "unique", "words": ["do", "mamta", "mi"], "brackets": "(do [mamta mi])"}
```

- `dialect` is the name of a bundled dialect. `features`, when present, lists the features that the case turns on. `withoutFeatures` lists those that it turns off.
- `expect` is `accept` or `reject`. For an accepted text, `verdict` is the verdict of the last stage, and `brackets` is its tree, with elided terminators hidden. For a rejected one, `stage` names the stage that rejected it.
- `at`, in a rejected case, is where that stage stopped, as a position in the text: the start of the `source` of the error, in code points, counted from 0. At the end of the stage's input, `at` is the end of the source of its last token. That is the length of the text only when no pause, attached indicator or erased word follows that token. For example, `mi le ui` stops at 5, the end of `le`, which carries `ui`, and not at 8 (case `adhoc.syntax.at-end-after-attached-indicator`). A change to an earlier stage, such as one that splits words in another way, can move the start or the end of the token where the stage stops, and then `at` moves too. A change of that position fails the case. Two different failures can stop at the same place, so `at` does not show the reason for the rejection. It and the accepted twins of a rejection make the cases stronger, and neither proves the reason. An error with no position, such as an ambiguity, gives no `at`.
- `error` is present exactly when the result's error is of kind `ambiguous`. It is `{"kind": "ambiguous", "reason": "tie"}`, or the same with the reason `elision-only` (engine §6, §7). A case with any other result has no `error`, a rejection or an error of the grammar included. A case expects an ambiguity with `expect` set to `reject`, its `stage`, and this `error`. A third value of `expect` is not needed.
- The `reason` inside `error` is the reason of the ambiguous error. It is a field of `error`, and it is not the case's own `reason`, which explains a departure from the seed (below). A case can have both.
- `ties`, when present, names the stage whose verdict is `tie`. A tie ends the run, so at most one stage has it, and that stage can come before the last.
- `words` records the word stage's output when that output is present. The case writes each token as its label (engine §5). So a pause inside a word is a space, and an opaque part is its text.

A runner also checks the invariants of a tie (above) on the result of each corpus case, and fails a corpus case whose result has an error with the code `elision-witness-lost`. No corpus text ties in its dialect, so each library also tests that its runner refuses the result mutants below. A case runs with auto features on, which is the default of the API. The case matches when every one of those fields that the case or the result of the library has is equal. Every runner compares all of these fields, `at` included.

The runners differ on input that this format does not allow, such as a field whose value is null. So `node tools/sync.js --check` checks the shape of every case first (`tools/corpus-shape.js`). Each file is UTF-8, and each line is one JSON object. No object has a member name twice, at any depth, and every string is a sequence of Unicode scalar values, with no lone surrogate. A case has only the fields above, and none of them is null. An accepted case has `verdict` and `brackets`. A rejected case has `stage`, and it has `at` exactly when it has no `error`.

The corpus started from a seed: a fixture collection whose verdicts came from another parser. Where the expectation of gencmu differs from that seed, the case says so. `"seeded": "accept"` or `"reject"` is the verdict of the seed, and `reason` says why gencmu differs, in terms of its own grammars. `node tools/corpus-departures.js` lists every such case, grouped by reason. A change to the `words` or `brackets` of a case needs no field of its own. It is a change to what gencmu produces, made in the same commit as the grammar change that causes it.

`core.txt` lists the ids of the sample that every library runs on each pull request. It holds every case that pins a text that a checked document quotes ("Quoted texts" below). So a change that makes such prose false fails in every library. On a pull request, the JavaScript and Rust libraries also run the whole corpus, and the others run it nightly. To run every case in JavaScript, run `GENCMU_CORPUS=full node --test test/corpus.test.js` in `lib/js/`.

## Quoted texts: `quoted-allow.txt`

A grammar document often says what gencmu does with a Lojban text that it quotes. A corpus case pins that text. Then a grammar change that makes the sentence false fails the case. `node tools/quoted-texts.js` checks that each quoted text has a case or an entry in the allow-list `quoted-allow.txt`. `node tools/sync.js --check` runs the same check.

A quoted text is a code span in the prose of a document, outside code blocks, with these properties:

- It has two words or more, separated by white space. A single word is often a name or a part of a rule.
- It holds only lowercase ASCII letters, apostrophes, full stops, commas and white space, and each word has a letter. So a rule name is not a quoted text, since it has a hyphen or a digit. Nor is a selma'o or a token, which is uppercase, or jbogenbau, which has brackets and other symbols.
- It holds no `...` or `…`, which mark a gap in the words.

The check finds the code spans with the CommonMark and GFM parser of `tools/markdown.js`, so a code block holds none. Every prose block is one line, with its code spans ("Documents" in `docs/design.md`). So the line of a text's code span is the paragraph, heading or table row that quotes it.

The check covers every document that the pipelines of the cll-ebnf and bpfk dialects include, at any depth, and the two dialect documents themselves. `CHECKED_DIALECTS` in `tools/quoted-texts.js` names these dialects. The includes come from the DOMs of the source documents, and each path resolves as the pipeline resolves it. A checked document has the dialects that its claims are about: those of the two that include it. The experimental and Zantufa dialects include some of these documents and layer their own over them. So a claim about one of them is checked only where the prose names it. Every other grammar document is left out with a reason. A document that only other dialects include has the reason that names them, read from their pipelines. The dialect documents of those dialects, and any document that no dialect includes, have a reason in `UNCHECKED`. A grammar document with no reason is an error, so a new document is not left out in silence.

The words of a quoted text, joined by single spaces, are compared with the text of each corpus case, written the same way. A quoted text needs a case of each dialect of its document. Its scope can name more dialects, as in "the bpfk dialect rejects it" or "In cll-ebnf and bpfk". The text then needs a case of each of those too. The scope is the list item that holds the text, without the lists nested in it at any depth (inside a block quote too), together with each item that encloses it, again without their nested lists. Outside a list item, the scope is the paragraph, heading or table row. So a blank line inside a list item changes nothing, a name in a nested item does not scope the item above it, and a name in an item scopes the items nested in it. A name counts in any case, when it stands as a word in the prose or in the text of a link. A name in a code span or a link target does not count. The names are those of the dialect documents, less `notation`. In this prose, "experimental" always names the dialect.

Each dialect that a text needs has one reading of it. A case of the whole text gives its verdict and brackets. A case of an entry (below) gives its verdict and role. The two kinds are compared apart. The dialects that the scope does not name must read the text alike, since the sentence then speaks for all of them. So a text that reads differently in two dialects is an error unless its scope names one of them, and a name of a third dialect does not change that. The sentence then says which dialect it is about, and what the other does. This compares only the cases, never the sentence.

A sentence that says how a text reads quotes that exact text. For example, it says "Here `le poi blabi gerku cu klama` parses", not "the text without `ku'o` parses". Then the check sees the text that the claim is about.

The case pins what the sentence says about the text: its verdict, and its brackets or words where the sentence says how the text reads. Before a case is added, the claim is checked by running the text. A false claim is corrected in the prose, not pinned. No tool compares the verdict that a sentence states with the case.

When a case fails, the JavaScript corpus runner names the lines that the case pins, as `quoted at grammars/syntax/cll.md:669`. These are the lines that quote the case's text, and those that quote a fragment that an entry of `quoted-allow.txt` pins with the case. The prose there may now be false.

Every case that pins a quoted text, by its own text or through an entry of `quoted-allow.txt`, is in `core.txt`. So every library runs it on a pull request. The check reports a case that is not there.

Each entry of `quoted-allow.txt` covers one quoted text in one document: every line that quotes it there, or the lines that the entry names. Its line is the text, then ` # `, then the document, with `:` and its lines where it names them (as `grammars/syntax/cll.md:74,76`), and then one of these:

- ` = ` and cases, each as its id after its role. A role applies to the ids after it, and a role with no id after it is an error. A role is the name of a rule, `words` or `reject`. The check parses each case. With a rule, the tree of some stage has a node of that rule whose words are exactly the quoted text. With `words`, some stage gives the text's words as the labels of tokens in a row, one label for each word. The label of a word is the word without the full stops and commas at its edges, with a space for each full stop inside it. So `la djim.bu` is the labels `la` and `djim bu`. These tokens, with their attachments, also stand together in the case's text: no letter between them is outside them. So `mi ui klama` shows `mi klama`, and `mi do si klama` does not. With `reject`, the dialect rejects the case, and both its `at` and the start of the source of the parsed error fall within the quoted text in the case's text, or within the word after it. Among the cases, there is one of each dialect that the text needs, even a dialect where a case of the whole text has the fragment's words: that case does not show the claim about the fragment. This form is for a part of a text that the sentence makes a claim about: a special grouping, a rejection or a repair. An example is `na'e ka'e` as one `simple-tense-modal`. The author checks that the role is the one that the sentence gives the fragment.
- ` # ` and the reason. This form is for notation, such as `nu'i terms nu'u`, and for a shape that a rule produces as written, such as `mi .e do`. It is also for a part of a reading that the grammar does not choose, where the whole text has its own case. A reason that begins with "deferred:" names the branch that owes the text a pin.

The sentence on each line makes its own claim. So when a document quotes a text unpinned on more than one line, its entry names those lines, and a line can have an entry of its own. The check reports an entry that names no lines and covers several, and a named line that does not need the entry.

Lines that begin with `#` are comments. An entry that the check does not need is an error, so the list does not keep stale entries.
