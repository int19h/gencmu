# gencmu: design

Status: implemented. Where the implementation shows a decision to be wrong, this document is changed with it.

## What gencmu is

A standalone Lojban parser whose grammar is data. Every layer of the language, from characters to phonemes, phonemes to words, words to a parse tree, is a literate grammar document in one notation, loaded at runtime. A dialect is a pipeline document, itself literate Markdown, that lists the stages and the grammar documents stitched into each, and explains what each stage receives and hands on. The people this is for want to read a grammar, change it, and see at once what the change does to a text, so the notation, the diagnostics and the interactive tools matter as much as the parser.

gencmu ships:

- four libraries, JavaScript, Python, Go and Rust, each a clean-room implementation of one engine specification, with no dependencies beyond the language's standard library;
- the grammars and dialect pipelines, shared by all four;
- one command-line tool and one web playground, both in JavaScript, both runnable from a clone with no install step;
- one test corpus, shared by all four libraries, whose expectations are what gencmu itself is meant to produce.

What it does not ship: research notes, comparisons with other parsers, the scripts that produced the corpus. Those stay in the prototype repository.

## Repository layout

```
index.html                 web playground, which GitHub Pages can serve from the root
playground/                playground scripts and styles, relative paths only
grammars/                  the grammar documents, the single source of truth
  phonemes/                characters to phonemes: latin-strict, latin, cyrillic, cyrillic-cll, zbalermorna
  words/                   phonemes to words: stream, shapes, families, lexicons
  indicators/              the non-formal indicator and ba'e rule
  syntax/                  the syntax grammars
  notation/                the grammar of the notation itself, and its bootstrap
  dialects/                pipeline documents: cll, bpfk, experimental, zantufa, notation
docs/
  notation.md              the grammar notation, for grammar authors
  engine.md                the engine specification, for implementers
  api.md                   the library API, per language
  output.md                the output formats, defined exactly
tests/
  engine/                  small grammars with expected parses: the engine spec as tests
  notation/                small grammar documents with their expected DOMs and errors
  corpus/                  Lojban texts with expected verdicts and trees
  core.txt                 the ids of the corpus subset every language runs in CI
lib/                       the four libraries, each with its own copy of grammars/
  js/                      npm package `gencmu`: library, CLI (`lib/js/cli.js`) and type declarations
  python/                  Python package `gencmu`
  go/                      Go module `github.com/int19h/gencmu/lib/go`, package `gencmu`
  rust/                    crate `gencmu`
dist/                      the browser bundle and the grammar bundle
tools/sync.js              regenerates every generated file below
.github/workflows/         CI
```

**Generated files are checked in and verified.** `grammars/` is the single source. Each package needs its own copy, because every ecosystem's packaging refuses files outside the package directory and Go's `embed` also refuses symbolic links: `lib/js/grammars/`, `lib/python/src/gencmu/grammars/`, `lib/go/grammars/`, `lib/rust/grammars/`, and `dist/grammars.js` for the browser. `dist/gencmu.js`, the library as one classic script, is generated too, so that `index.html` works from a clone opened with a double click and from GitHub Pages without a build step. One Node script with no dependencies, `node tools/sync.js`, writes all of them; CI runs it and fails if anything changed. A contributor edits `grammars/` and runs one command.

## The engine

The four libraries implement one specification, `docs/engine.md`, written first and precisely enough that two implementations cannot legitimately differ. It covers:

1. **Reading documents.** The fenced `jbogenbau` blocks of a Markdown document, read by the notation's own grammar (see "The notation" below) into a grammar DOM; pipeline documents, read as described under "Pipelines"; stitching several documents into one grammar. Errors carry file, line and column.
2. **Lowering** to a context-free grammar with named helper rules for the sugar, which diagnostics hide.
3. **Recognition.** An Earley parser whose items record, for each captured part, its span and the identity of its tag set, and which evaluates conditions the moment their last capture is read. Nested parses for `matches(span, rule)` and `tags(span, rule)` share their memo with the parse that started them; a nested parse asked about its own span is a grammar error.
4. **Choosing a parse.** The first-difference order over bottom-up action sequences, with strong-over-weak tags and the grammar's declared `%ambiguity-resolution`; the verdicts unique, resolved, tie; the tie witness; the `elision-only` check (see "Ambiguity" below).
5. **Emission** of the next stage's tokens, each with its text, its phonemes and its source range.
6. **The pipeline**: stages in order, stopping at the first rejection.

The specification is tested by `tests/engine/`: each case is a small grammar, an input, and the complete expected result in the canonical JSON of `docs/output.md`, so a fifth implementation can be checked without the Lojban grammars at all. The cases are written together with the specification, one or more per rule of it, and they settle the edge cases that decide which parse comes out, before the Lojban corpus can become the specification by accident:

- **Ties.** A tie is a successful parse (`ok` is true) with the verdict `tie`, a witness and the tied tree. The chosen tree is the least in a total order that breaks the ranking's ties by canonical keys, and the tied tree is the derivation tied with it that diverges from it earliest (engine §6). The tie is never silent: every surface shows it.
- **Emission from a tie.** A non-final stage emits the chosen derivation, and its tie stands even when every tied derivation would emit the same tokens: the stage is ambiguous as written, and saying so is what lets a grammar author fix it. The engine cases include a three-way tie and a tie whose derivations emit the same tokens.
- **Empty spans and cycles.** Nullable rules, empty captures, a condition on an empty span, a unary cycle of `a` to `b` and `b` to `a`, and a nested parse asked about its own span, each with its defined outcome.

**Coordinates.** Every position in a result is a half-open range. Source positions count Unicode code points, not bytes or UTF-16 units, so that the four languages agree on non-ASCII text; each library converts at its edge (JavaScript from UTF-16, Go and Rust from UTF-8). Line and column in diagnostics are derived from code points, lines split at `\n`, `\r\n` and `\r`. A token's `span` is a range of the previous stage's tokens, and its `source` is the range from its first covered character to its last: always contiguous, because a token covers a contiguous run of the tokens below it, even when some of them emitted nothing, as an erased word inside a compound does. A token inserted by an emission clause has an empty span and an empty source range at the position where it was inserted, and its provenance is that emission: it records the rule whose clause inserted it. Following `span` from stage to stage, or `inserted-by` where a token has no span, explains any token down to the characters or to the rule that made it.

## The notation

gencmu's grammars are written in jbogenbau, a notation of its own. `docs/notation.md` explains it for grammar authors; this is the summary and the reasons.

**What it is.** A jbogenbau grammar is an attribute grammar with EBNF rule bodies: each rule's body is EBNF in the dialect CLL prints, each constituent carries one attribute, its set of tags, computed bottom-up from its parts; conditions over the parts, including whether a part also parses as another rule, restrict which parses exist, as in a Boolean grammar; and a rule may say what its constituents hand to the next stage, so that each grammar is a transducer and a dialect a pipeline of them. The bodies keep the look of CLL's EBNF, since that is what a reader of CLL recognizes; everything around them is spelled with keywords, since symbols there proved opaque.

**Documents.** A grammar document is Markdown. Its fenced `jbogenbau` blocks, in order, are the grammar; the prose between them explains it. Only the fences are found by lines, as Markdown requires; inside a block, line breaks and indentation mean nothing.

**Rules.** A rule is a keyword, its name and its body, followed by its clauses, each a keyword and what it says; a rule ends where the next keyword that begins a rule or a directive stands, so no terminator is needed and nothing is recognized by its position on a line:

```jbogenbau
%rule term-not-starting-with-bare-gek
  | term-3-not-starting-with-bare-gek [term-connective term-3] ...
  | tagged-term (joik # | ek #) BO # tagged-term
  | @term-hierarchy? term-3-not-starting-with-bare-gek (joik # | ek #) BO # term-3

%rule vowel-group-joined
  $g(vowel-group) $v(vowel) <tags($v)>
%conditions
  "syllabic" ∈ tags($g),
  "syllabic" ∈ tags($v)
%emits
  $g, /'/, $v
```

Every binary operator may also stand first, as a no-op, so that a list can put one item on each line: `|` and `&` in bodies, `∪` and `∩` in tag terms, `∧` and `∨` in conditions.

**Stitching.** A stage is several documents read in order. `%rule` defines a rule and is an error if one of that name exists; `%redefine-rule` replaces a rule an earlier document defined and is an error if none did; `%extend-rule` adds alternatives to a rule defined before it and is an error if none was. So neither a misspelt name nor an accidental override passes silently, and a replacement says so where it is made. The loader also reports every replacement and extension, which document changed which rule, so a dialect's effect on its base can be read off in one place. Removing a single alternative is not supported: a rule is small enough to restate, and restating it reads better than a list of deletions.

This is what the dialects need. A script document adds its letters to the phoneme grammar's rules with `%extend-rule`; a word family adds the syllables its morphology allows. The Zantufa syntax is the experimental syntax with 13 new rules, 9 extended and 17 redefined, where a Zantufa form generalizes an older one over the same text and the two must not both be live; the redefinition restates the rule with both forms under complementary feature guards. The Zantufa dialect is the experimental documents plus one Zantufa document of those changes, instead of a generated copy.

**Terminals.** A name in upper case is a terminal that matches a token carrying that tag. A string in straight quotes, `"а"`, `"word"`, is a terminal whose tag the name syntax cannot spell. A phoneme between slashes, `/a/`, `/'/`, `/./` for a pause, is a phoneme tag: it matches like any tag, and it also says what a token carrying it sounds like, which is what `phonemes()` reads. Slashes mean nothing else.

**Operators** are those of CLL: juxtaposition is sequence; `[x]` optional; `x ...` one or more, `[x] ...` zero or more, left-recursive; `A & B` and/or in order; `( )` grouping; `ε` empty; `@f?` and `@¬f?` gates and `@f!` warnings, the feature guards on an alternative (see "Gates and warnings"); `$x(symbol)` a capture, and `$` the whole constituent. `#` is not built in: it is a rule the grammar defines as `[free ...]`, as CLL's EBNF defines it, so the free modifiers of one slot are one node of the tree. CLL's `/KU/` for an elidable terminator is written `[KU]`, and `/KU#/` is `[KU #]`; which terminators are elidable is declared once (see below). `[KU #]` is exactly what CLL prints: an elided terminator takes its free-modifier slot with it, so `xy. xi ky.` (CLL 17.38) needs `xy. boi xi ky.` under the printed grammar, which is what CLL's official parser does and what the prototype's corpus scans confirm. The grammars that allow free modifiers after an elided terminator, as the camxes family does, write `[KU] #`.

**Clauses.** `%tags` gives the tags every alternative's constituent carries, which an alternative's own tags after it in angle brackets add to. `%conditions` lists conditions over the captured parts, each of which applies to the alternatives that capture what it mentions and is checked as early as it can be; within one, `∧`, `∨` and `⟹` are logic, in that order of precedence, grouped with parentheses. `%emits` lists exactly what the constituent hands to the next stage, in order, each capture with its own tags; `%emits ε` hands on nothing and makes the constituent not count, which is how erased text is left out of what the words around it sound like. A clause that refers to a capture some alternative lacks is decided when the grammar is read: a condition or an emitted item then does not apply to that alternative, and a tag term is an error unless guarded, `($c ⟹ tags($c, lexicon))`, since a tag term has no value that could mean "nothing to say". A clause that applies to no alternative, or a capture no alternative captures, is an error. A weak tag is `?"KOhA"`. There is one notation for a set of tags, the union: `"UI" ∪ "CAI"`.

**Directives** are keywords too, and may stand in any block:

- `%ambiguity-resolution greedy`, `lazy`, optionally followed by `elision-only`: how the stage chooses among parses (see "Ambiguity"). Every stage must have exactly one, in any of its documents; a stage with none or two is a load error that names the stage.
- `%elidable KU KEI VAU ...`: the terminators that may be elided. An absent optional whose first symbol is one of them appears in the tree as that terminator, elided at that point, and `elision-only` restores them.

By convention a directive stands in a block of its own, after prose that says why the grammar needs it; the reader does not enforce the convention.

**Self-hosting.** The notation is itself a dialect of two stages: a lexical grammar from characters to notation tokens, and a syntax grammar from those tokens to a document tree, both in `grammars/notation/`, both written in the notation. `docs/notation.md` explains the notation; these documents define it. The chicken-and-egg problem is solved once: the notation grammar's DOM is checked in as `grammars/notation/bootstrap.json`, every library loads it to read every grammar document, `notation/` included, and CI checks the fixpoint, that reading the notation documents with the bootstrap reproduces the bootstrap exactly. A change to the notation is made in its documents and the bootstrap is regenerated from them; the very first bootstrap is written by hand in JavaScript. Each library then writes by hand only the walk from a document tree to its grammar objects, specified in `docs/engine.md` rule by rule.

Grammar authors get the same diagnostics for a malformed grammar as for a malformed Lojban text, and the playground can show how a grammar document parses. The cost is load time: the bundled grammars are about 200 KB, which a character-level stage reads quickly in Rust and JavaScript but slowly in pure Python. So every package ships, beside its grammar copy, the DOM of each bundled document as JSON. A DOM is keyed by three things: a hash of the document's text, a hash of the bootstrap that read it, and the DOM format's version number; a change to any of them misses the cache. A library reads a document through the notation grammar only on a miss, which in practice happens only for a grammar someone has written or edited; the playground caches edited documents' DOMs the same way. CI checks that the shipped DOMs match a fresh reading, and every library's tests include forced cache misses. The fixpoint alone proves only that the notation reads itself consistently, so `tests/notation/` also holds direct cases, small documents with their expected DOMs and their expected errors, run by every library.

## Pipelines

A pipeline document is Markdown too, and literate: each stage is a heading, followed by the list of documents stitched into it and by prose saying what the stage receives from the one before, what it does, and what it hands on. The machine-readable parts are processing instructions at the end of a line, which GitHub's renderer drops, so the document reads as plain hyperlinked prose there:

```
# The CLL dialect

... what the dialect is ...

## Stage 1: phonemes <?stage phonemes?>

- [Latin orthography](../phonemes/latin.md) <?grammar?>
  ... what this document contributes ...
- [Cyrillic orthography](../phonemes/cyrillic.md) <?grammar?>

... what the stage receives, does and hands on ...
```

`<?stage NAME?>` at the end of a heading line starts a stage; `NAME` is what the API, the CLI's `--until` and diagnostics call it, independent of the heading's wording, and two stages with one name are an error. `<?grammar?>` at the end of a line makes the first link on that line a document of the current stage; the line may end in trailing whitespace. The pipeline reader is not a Markdown parser, and accepts one form of link only, so that four implementations agree: `[` text `](` target `)`, where the target has no spaces, parentheses or backslashes; a `<?grammar?>` line without such a link is an error. Stages run in document order, documents stitch in list order, and since a later document may redefine or extend a rule, that order matters. A link without a marker is ordinary prose: a pipeline may link to CLL or to other dialects freely. Every stage's start rule is `text`.

`<?features NAME ...?>` at the end of any line of a pipeline, a heading included, names features the dialect turns on for every parse, separated by spaces; there may be several, and their names are unioned. A caller can turn further features on and any of them off, so a feature on by default is a choice the caller can undo. A dialect that is its base with its own documents added is a pipeline of its own, as the Zantufa dialect is the experimental documents plus its own. Link targets are relative to the pipeline document, and resolve the same way on disk, in memory and on GitHub. A line holds at most one processing instruction: a second is an error, so that a stage and its features cannot share a heading and lose one of them. An instruction counts only at the end of its line; elsewhere it is prose. An instruction the reader does not know is ignored, and `<?stage?>` is conventionally, not necessarily, at the end of a heading.

## Ambiguity

A grammar admits every parse its rules allow. Where a text has more than one, each parse is read as the sequence of steps a bottom-up reader takes, reading the next token or closing a constituent, and at the first step where two differ:

- if both read the same token under two tags, a strong tag beats a weak one;
- if one reads and the other closes, `%ambiguity-resolution` decides: `greedy` takes the one that reads, so a constituent ends as late as the grammar allows; `lazy` takes the one that closes, so it ends as early as the grammar allows;
- if both close different constituents, the text is ambiguous for this grammar and the result is a tie, with its witness.

The preference is like greedy and lazy quantifiers in a backtracking regular expression engine, not like PEG's greed: it orders parses the grammar already admits and never commits, so it cannot reject a text; the earliest difference dominates; and it applies to every constituent of the stage, not to one quantifier. The syntax grammars are greedy, which is how an elided terminator is placed; the word grammar is lazy, which is CLL's tosmabru rule, a word ending as early as it can.

CLL's own rule is narrower. It says only that a terminator may be elided if no ambiguity results, and says nothing of the other ambiguities its EBNF has. `elision-only` applies that rule literally, to the stage whose grammar declares it, and only when that stage's ranking was not `unique`:

1. Take the chosen tree's `elided` nodes in text order, inner before outer where several stand at one point, and insert before the stage-input token at each one's position a synthetic token carrying only that terminator's tag, strong, marked synthetic.
2. Lower the same grammar again with every optional whose first symbol is an `%elidable` terminator made mandatory, and parse the new token sequence.
3. Build that forest's ranking using only the strong-over-weak rule, with no lean. If it has exactly one derivation, or the tag rule alone selects one, the check passes: every other reading of the original input needed a terminator elided somewhere the chosen reading did not, and CLL's rule forbids that elision because it made the text ambiguous. Otherwise the ambiguity is not about terminators, and the result is an error of kind `ambiguous`: `ok` is false, and the error carries the two readings that ranking reports, the chosen and the tied, shown over the original input.

A weak tag is exactly how a dialect marks a reading it admits second, which is why the tag rule still applies in step 3. The engine cases pin the definition: two readings that elide different terminators (which passes), two readings that differ with every terminator written (which fails), one settled by a weak tag (which passes), and several terminators elided at one point.

### Where an elided terminator may fall

`elision-only` settles which reading a text has; it does not settle whether a reading that needs an elided terminator counts at all. CLL's rule, "if no grammatical ambiguity results", is read in three ways, and the grammar that CLL prints does not choose among them:

- The printed grammar read literally counts every parse: a terminator may be elided wherever a parse of the whole text needs it. `le lojbo se farvi le loglo gi'enai mintu ja dunli le logla` parses, with the description ending before `se farvi`.
- CLL's official parser reads one lexeme ahead and never goes back. It elides a terminator only through its grammar's error recovery, where the next lexeme cannot continue what it is reading. CLL's own explanations of elision describe this, which is why CLL 14.14 says that `le nanmu ku joi le ninmu` needs its `ku`.
- The PEG grammars that replaced the YACC grammar commit too, but in another way: what a PEG has read before an elided terminator runs as far as it can be read, so `le nanmu joi le ninmu` parses and the `le lojbo` text does not.

The notation offers the third as `maximal` (engine §4), a condition on which parses count, stated over the recognizer's items. It does not order the alternatives of a rule, so a grammar stays a description of its language. The bpfk dialect reads elided terminators this way, since the definition effort that approved its word forms also adopted the PEG. The cll-ebnf dialect takes the printed grammar as normative and keeps the literal reading, and so do the experimental and Zantufa dialects, which accept the most. Each dialect of the CLL grammar names its reading in a document of one directive stitched after the grammar, since a stage states its `%ambiguity-resolution` exactly once.

Measured over the 24,552 CLL cases of the corpus, `maximal` rejects 68 texts that the literal reading accepts, and camxes-std, the reference PEG, rejects 66 of them. It changes the chosen reading of no text it accepts: in 2,892 texts it removes only parses that the greedy ranking had already beaten, so their verdict becomes `unique` instead of `resolved`. camxes-std reads one of the other two as a forethought termset without `nu'i`, which the CLL grammar does not have. In the other, `maximal` sees a longer constituent that splits the number `paso` in two, which a PEG never does, since its number is greedy as well.

The official parser's reading is not in the notation. Its lookahead is a lexeme, not a word: step 5 of its preamble joins runs of words, such as the connective `na ja` or a number followed by `moi`, into one lexeme before its grammar sees them. A rule that reads one word ahead over a stage's tokens sees the `na` of `le nanla na vrude` as the start of `na ja`; tried word by word, such a rule rejected 369 texts of the corpus that the official parser accepts. A dialect that reads as the official parser does needs that preparser as a stage of its own ([issue 28](https://github.com/int19h/gencmu/issues/28)). The same preparser settles ambiguities that the printed grammar leaves open, such as a gihek or joik directly before `ke`, which the dialects here leave as the printed grammar has them: `mi broda joi ke brode ke'e` has two readings that differ in more than a terminator, which `elision-only` reports.

Measured on the prototype's corpus, `elision-only` costs the CLL grammar nothing: every one of its 8,853 ambiguous texts becomes unambiguous with its terminators written out. The extended grammars are another matter: 63 experimental and 74 Zantufa texts stay ambiguous, through a bare `na` term (`la olivian na klama` is both "Olivian doesn't go" and "Olivian, not-term, goes"), a name that is also a selbri under `cbm`, `bo` connection under `term-hierarchy`, and Zantufa's mekso. So the dialects of the CLL syntax grammar declare `%ambiguity-resolution greedy elision-only`, with `maximal` in the bpfk dialect, and the extended ones `greedy`, each with prose citing these reasons. A parse option overrides `elision-only` either way, to check an extension for overlaps or to loosen the CLL dialect; the lean itself cannot be overridden, since a lazy syntax or a greedy word grammar is a different language, not a variation.

## The result, and why it has no types

The tree's shape is decided by the grammar, which is loaded at runtime, so no language gets a typed tree. Every library returns the same generic structure:

```
ParseResult
  ok            whether every stage accepted
  stages        per stage: name, input tokens, output tokens, verdict, tie witness, rejection
  tree          the last stage's chosen tree, or none
  error         the first rejection, with source position and what was expected

Node
  kind          "rule", "token", or "elided" (a terminator elided at this point)
  rule          for a rule node: the rule the author wrote
  terminal      for a token or elided node: the terminal it read or stands for
  children      for a rule node: nodes, in text order
  span          token range in the stage's input
  source        code-point range in the original text
  tags          for a rule node: its tag set, each tag strong or weak
  token         for a token node: the index of the stage-input token it read
```

The tree is lossless with respect to the grammar the author wrote: every rule the parse went through is a node, including chains of single-child rules, so a program can tell `sumti-6` from `sumti`. Only the helper rules that lowering invents for `[ ]`, `...` and `&` are spliced out, since no author wrote them; an absent optional that begins with an `%elidable` terminator leaves an `elided` node with an empty span where the terminator would have been. Collapsing chains is a choice of the renderers, not of the tree. `text` and `phonemes` are not stored on nodes; the libraries compute them from the tokens, so that the two cannot disagree.

Each library exposes this idiomatically: plain objects and arrays in JavaScript, dataclasses in Python, structs with slices in Go, structs with `Vec` and owned `String` in Rust, so that a result outlives the text and the dialect it came from. Each can serialize a result to the canonical JSON of `docs/output.md`, and each renders the canonical bracket form, since the shared tests compare it.

## The API

The same shape in every language, spelled idiomatically:

```
dialect = load_dialect("cll-ebnf")                 # a bundled dialect by name
dialect = load_dialect_file("my/pipeline.md") # or a pipeline document on disk
dialect = load_dialect_sources({path: text})  # or documents held in memory, for the browser
result  = dialect.parse(text, features={"jacu"}, without_features={"cbm"},
                        auto_features=True, until="words", elision_only=None)
result.ok; result.tree; result.error.describe(); result.warnings
dialect.features                              # each feature: name, gate or warning, on by default or not
to_json(result); to_brackets(result)
```

The bundled grammars are embedded in each package, so a library works with no files beside it, and any grammar can also be supplied from disk or from memory. In-memory sources are a map from path to text; paths are `/`-separated and relative to a virtual root, and a pipeline's document paths are resolved against the pipeline's own path with `.` and `..` normalized, exactly as on disk. The bundled dialects are that same map. Parsing is synchronous everywhere; the browser runs it in a worker. `elision_only` left unset follows the grammar's directive. `auto_features`, on by default, adds `sa-su` to the given features only where it is needed (see "Expensive constructs behind features"), unless the caller turned it off.

The distributable artifacts are exactly: the npm package `gencmu` (the `lib/js/` directory); the Python distribution `gencmu` (`lib/python/`, a pure-Python wheel); the Go module `github.com/int19h/gencmu/lib/go` (import it as `gencmu "github.com/int19h/gencmu/lib/go"`; a Go module in a subdirectory is tagged `lib/go/vX.Y.Z`); the crate `gencmu` (`lib/rust/`). Each contains its grammar copy and nothing from outside its directory, which CI proves by building each from a clean checkout (`npm pack`, `python -m build`, `go build` from a module-mode checkout, `cargo package`).

## Diagnostics and debugging

These are the product, not an afterthought:

- **Rejections** name the stage, show the source line with a caret under the failing character or word, and list what could have continued as grammar terms, grouped by rule, rather than as a set of tag names.
- **Grammar errors** carry file, line and column, and name the rule.
- **Ties** show the two derivations side by side from the first difference.
- **Stage inspection**: the tokens every stage emitted, with their tags.
- **Trace**: for one position, which items were predicted, completed and dropped, and which condition dropped them. This is the tool for "why does my grammar not accept this".
- **Audit**: undefined and unreachable rules, every rule a later document replaced or extended, stages without an `%ambiguity-resolution`, and `%emits ε` that changes nothing, over text that could never emit a token or be covered by one; a condition that applies to no alternative is not an audit finding but an error of the grammar.

## CLI and playground

The CLI is `node lib/js/cli.js` (and `npx gencmu` once published): `parse` with `--dialect`, `--feature` and `--no-feature`, `--until`, `--format brackets|tree|json|tokens`, `--trace`, printing any warning on standard error as it prints a tie; `features` to list a dialect's features; `audit`; `test` to run a test file against a dialect. It needs Node and nothing else.

The playground is `index.html` with `dist/gencmu.js` and `dist/grammars.js` loaded as classic scripts, so it works from `file://`, where browsers refuse ES modules, and from GitHub Pages alike. Nothing is fetched: the grammars are a JavaScript object in `dist/grammars.js`, and the worker is built from a `Blob` whose text is the library source plus the grammar object, passed from the page, so the worker fetches nothing either. This is the riskiest part of the design, so it is proved first, before the library exists, with a stub parser: a page that starts a blob worker from `file://` and gets an answer, checked in current Chrome and Firefox, and in CI with the headless Chrome that GitHub's runners already have (`--headless --dump-dom` on a `file://` URL), with no test framework. Given a URL, the same smoke test checks a deployment, such as GitHub Pages, for an absolute path. It has: the text; the dialect, and a switch for each of the dialect's features, set to its default; the warnings of the parse; the output in the three formats and the per-stage tokens; the diagnostics above; and an editor for the grammar documents, whose edits reparse the text at once and can be downloaded. Parsing runs in a worker (a `Blob` worker, which also works from `file://`), so a long text does not freeze the page.

## Output formats

Defined exactly in `docs/output.md`, implemented in JavaScript for the CLI and the playground, and the bracket form in every library for the tests:

- **brackets**: the tree as nested groups, cycling `( ) [ ] { }` by depth, groups of one child collapsed, leaves as their phonemes with stress shown, elided terminators shown in angle brackets, `⟨ku⟩`, or hidden, by option;
- **tree**: an indented listing, one node per line, rule name and text;
- **json**: the canonical JSON, pretty-printed so that a node with one field stays on one line with its parent, `{"sumti": {"text": "lo mlatu"}}`, which keeps deep trees readable.

## Tests

Two kinds of shared test, both run by every library:

- `tests/engine/`: the engine specification's cases, each checked against the complete canonical result JSON, stages, tokens, tags, verdicts, witnesses, errors and coordinates included.
- `tests/corpus/*.jsonl`: Lojban texts, one case per line:

  ```
  {"id": "cll-10-183", "text": "puzu", "dialect": "cll-ebnf", "features": [],
   "expect": "accept", "verdict": "resolved", "words": ["pu", "zu"],
   "brackets": "(pu zu)"}
  ```

  `expect` is whether gencmu is meant to accept the text, `words` the tokens of the word stage, and `brackets` the tree. A full result per case would make the corpus hundreds of megabytes; the engine cases are where the full result is pinned down, and the corpus pins what a Lojban reader cares about.

The corpus is seeded once from the prototype's fixtures and their verdicts. Where gencmu is meant to differ from the verdict a case was seeded with, the case says so in its own terms: `"seeded": "reject", "reason": "..."`, the reason stated in terms of gencmu's grammars, such as "`sa bu` backs up to the `bu` of the last letter word, as the unique cases of the Magic Words proposal say". Those two fields make every departure from the seed visible in review, and a script lists them. A change to a case's expected `words` or `brackets` needs no field of its own: it is a change to what gencmu produces, made in the same commit as the grammar change that causes it and explained in that commit's message. After seeding, the corpus is ours: a change that alters an expectation updates the file in the same commit.

Every library runs the whole corpus. On a pull request, a sampled core of a few hundred cases (`tests/core.txt`) runs in every language, plus the whole corpus in Rust and JavaScript; the whole corpus runs in all four languages nightly and before a release, sharded if Python needs it. No language is permanently exempt.

## CI

One workflow, one job per language, each on the oldest and newest supported toolchain:

- JavaScript: Node 20 and current, `node --test`, the bundle freshness check;
- Python: 3.10 and current, `python -m unittest`, `python -m build` for the wheel (the build backend is the only non-standard-library tool, and only at build time);
- Go: the oldest supported release and current, `go vet`, `go test`;
- Rust: MSRV and stable, `cargo fmt --check`, `cargo clippy`, `cargo test`, `cargo package` to prove the crate is self-contained.

Third-party actions are pinned by commit hash. GitHub Pages can serve `main` from the root with no workflow; it is not enabled while the repository is private, since the site would be public.

## Standard library only

This holds for every target. JavaScript needs nothing beyond the language and, for the CLI, Node's `fs`. Python's standard library has everything, `json` included. Go's has `embed` and `encoding/json`. Rust's has no JSON reader, so the Rust tests carry a small one, and the library writes JSON by hand; that is a few hundred lines, and the one real cost of the rule.

The rule is about what building and running needs, not what checking does. The JavaScript sources carry JSDoc type annotations, and TypeScript checks them in CI, with `strict` on; it is the package's one development dependency, with Node's type definitions for the Node entry point, and nothing runs it to build, test or use the library. The declarations it writes from the annotations, `lib/js/types/`, are checked in, verified fresh in CI like the other generated files, and published with the package, so a client in TypeScript or an editor gets the library's types without gencmu having a build step.

## Gates and warnings

A dialect that extends another makes two kinds of change. Most are additions: texts that the base grammar rejects and the dialect accepts, such as `cu` before a bare selbri in the experimental dialect. Some change how the dialect reads a text that the base grammar accepts, such as the cmevla-brivla merger, under which `la .alis. klama` is one description. The notation has a kind of feature guard for each.

An addition is a warning, `@name!`. Its alternative is there whether the feature is on or off, so turning the feature on changes no verdict and no tree. It only adds a warning to the result for each place the chosen tree uses the alternative, naming the feature and the text. The dialect turns none of its warnings on, so its texts parse without warnings by default, and a reader who wants to know which additions a text relies on turns them on. A warning is on the chosen tree only: an addition that a tied or losing reading would have used is not reported. The idea comes from jbotci, which warns where an experimental construct makes a text parse that the standard grammar rejects. The bundled grammars do not mark their additions yet: the experimental dialect's documents are to be restated as a layer over the CLL grammar, and that change gives each addition its warning.

A change of reading is a gate, `@name?`, with the old form under `@¬name?`, so that exactly one of the two is live. A warning cannot express it, because the base reading would be gone even with the feature off. A dialect that makes such a change turns its gate on by default, and a caller who wants the base reading turns it off. Gates are also how a grammar keeps an expensive construct out of the parses that do not need it (see below).

A name is one kind or the other in a dialect. Loading a dialect in which one guard uses a name as a gate and another uses it as a warning is an error, since turning the feature on would then mean two things.

Features are chosen one by one because an extension is not one decision. camxes-exp, the reference of the experimental dialect, is a bundle of changes that people adopt separately; some use the merger and some do not. A feature that composes with the rest by plain addition stays selectable on its own. A change that cannot be made selectable without a convoluted grammar is made unconditionally in the dialect's documents, and its documents say so.

## Expensive constructs behind features

The erasers `sa` and `su` reach back over any number of words, so the parser keeps a possible reach open from the most recent word of each selma'o, not knowing whether a `sa` will come. A reach that runs back to the start of the text, as an unmatched `sa` or a `su` does, begins with a rule anchored there by `initial`, so the parser reads it once. The cost then grows in proportion to the text, but each word costs more: in JavaScript, a text of 13,700 characters takes about 22 seconds with the feature and 6.5 without it. They are rare, so they are behind a feature, `sa-su`: without it they are ordinary words, which the syntax rejects. The libraries' `auto_features` parse a text's word stage once without the feature and enable it only if that stage rejects the text or reads a `sa` or `su` as a word anywhere in its tree, erased by a `si` or not; a text with no such word parses the same either way. The CLI and the playground use it by default. The engine may later make this unnecessary by not predicting a rule whose required words cannot occur in the rest of the input; that is an optimization to specify once it is understood, not part of the first version.

## What came from the prototype

The grammar documents, rewritten where they referred to the prototype, other parsers or research notes, and converted to the notation above; the notation document; and the fixture corpus, converted to the format above, about 26,000 cases and 8 MB with words and brackets, kept whole in the repository. Nothing else: no code, no scripts, no notes. The lexicon that was derived from another parser's word table is a document of its own, maintained by hand, and the Zantufa grammar is a document of replacements and additions, as above.
