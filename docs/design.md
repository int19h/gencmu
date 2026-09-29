# gencmu: design

Status: implemented. If the implementation shows that a decision is wrong, the same change corrects this document.

## What gencmu is

gencmu is a standalone Lojban parser whose grammar is data. Every layer of the language is a literate grammar document in one notation, which gencmu loads at runtime. A literate document mixes the grammar with prose that explains it. The layers go from characters to phonemes, from phonemes to words, and from words to a parse tree.

A dialect is a pipeline document, itself literate Markdown. The pipeline is a sequence of stages. A stage reads its input with one grammar, and hands its result to the next stage. The first stage reads the characters of the text. The pipeline document lists the stages and the grammar documents stitched into each stage. It also explains what each stage receives and hands on.

The users of gencmu want to read a grammar, change it, and see at once what the change does to a text. So the notation, the diagnostics and the interactive tools matter as much as the parser.

gencmu ships:

- Four libraries, in JavaScript, Python, Go and Rust. Each is a clean-room implementation of one engine specification: it is written from the specification, not from another library's code. No library has dependencies beyond the standard library of its language.
- The grammars and dialect pipelines, shared by all four
- One command-line tool (CLI) and one web playground, both in JavaScript. Both run from a clone with no install step.
- One test corpus, shared by all four libraries. Its expectations are what gencmu itself is meant to produce.

gencmu does not ship research notes, comparisons with other parsers, or the scripts that produced the corpus. Those stay in the repository of the prototype, the earlier research parser that gencmu came from.

## Repository layout

```
index.html                 web playground, which GitHub Pages can serve from the root
playground/                playground scripts and styles, relative paths only
grammars/                  the grammar documents, the single source of truth
  phonemes/                characters to phonemes: latin-strict, latin, cyrillic, cyrillic-cll, zbalermorna
  words/                   phonemes to words: forms, shapes, families, lexicons, stream
  indicators/              the non-formal indicator and ba'e rule
  syntax/                  the syntax grammars
  notation/                the grammar of the notation itself, and its bootstrap
  dialects/                pipeline documents: cll-ebnf, bpfk, experimental, zantufa, notation
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

`grammars/` is the single source of the grammars. The repository keeps all generated files checked in, and CI (the checks that run on every change) makes sure that they are up to date. Each package needs its own copy, because the packaging of every ecosystem refuses files outside the package directory. Go's `embed` also refuses symbolic links. The copies are `lib/js/grammars/`, `lib/python/src/gencmu/grammars/`, `lib/go/grammars/`, `lib/rust/grammars/`, and `dist/grammars.js` for the browser.

`dist/gencmu.js`, the library as one classic script (a script that is not an ES module), is generated too. So `index.html` works without a build step, from a clone opened with a double click and from GitHub Pages. One Node script with no dependencies, `node tools/sync.js`, writes all of these files. CI runs it and fails if anything changed. A contributor edits `grammars/` and runs one command.

## The engine

The four libraries implement one specification, `docs/engine.md`. It was written first, and it is precise enough that two implementations cannot legitimately differ. It covers:

1. The loader, the part of a library that reads documents, uses the notation's own grammar. It reads the fenced `jbogenbau` blocks of a Markdown document into a grammar DOM (document object model: the document as a tree of objects). See "The notation" below. The loader splices pipeline documents as "Pipelines" says, and stitches the rules of each stage into one grammar. Its errors carry file, line and column.
2. Lowering turns the grammar into a context-free grammar. Lowering makes named helper rules for the notation's shorthand, such as `[ ]` and `...`, and diagnostics hide these rules.
3. The recognizer is an Earley parser (a standard algorithm for any context-free grammar). Its items, the partial matches that it keeps, record the span and the identity of the tag set of each captured part. The parser evaluates each condition as soon as it reads the last capture of that condition. With `from` and `after`, a condition can look past its constituent to the end of the input. A PEG (parsing expression grammar, which tries alternatives in order) has a lookahead that does the same.

   Nested parses for `matches(span, rule)`, `begins(span, rule)` and `tags(span, rule)` share their memo (a cache of answers) with the parse that started them. The memo key is the kind of query, the rule, and either the content of a short span or the position of a long span. A nested parse asked about its own span is a grammar error.
4. The engine chooses a parse. It orders the parses by their first difference, as sequences of bottom-up actions. The order uses the grammar's declared `%ambiguity-resolution`. This part also covers the verdicts unique, resolved and tie, the tie witness, and the `elision-only` check (see "Ambiguity" below).
5. The stage emits the tokens of the next stage. Each token has its text, its phonemes and its source range.
6. The pipeline runs the stages in order, and stops at the first rejection.

`tests/engine/` tests the specification. Each case is a small grammar, an input, and a pattern that the canonical result JSON of `docs/output.md` must match. So a fifth implementation can run the cases to make sure that it follows the specification, without the Lojban grammars at all. The cases are written together with the specification, one or more for each of its rules. They settle the edge cases that decide which parse comes out, so that the Lojban corpus does not become the specification by accident:

- A tie is a successful parse (`ok` is true) with the verdict `tie`, a witness and the tied tree. The chosen tree is the least in a total order that breaks the ranking's ties by canonical keys. The tied tree is the derivation, tied with the chosen tree, that diverges from it earliest (engine §6). The tie is never silent: every surface shows it.
- The witness of a tie is the pair of actions at the first visible difference between the two trees. A close of a helper rule, or of a rule with one symbol, is transparent (not visible). An earlier difference at such a close does not decide the witness. If the two trees have no visible difference, the witness is the pair of actions at their first difference.
- A non-final stage with a tie emits the chosen derivation. Its tie stands even when every tied derivation emits the same tokens. The stage is ambiguous as written, and the report of the tie lets a grammar author fix it. The engine cases include a three-way tie and a tie whose derivations emit the same tokens.
- The cases cover empty spans and cycles: nullable rules, empty captures and a condition on an empty span. They also cover a unary cycle of `a` to `b` and `b` to `a`, and a nested parse asked about its own span. Each case has its defined outcome.

Every position in a result is a half-open range of coordinates: the range holds its start but not its end. Source positions count Unicode code points, not bytes or UTF-16 units, so that the four languages agree on non-ASCII text. Each library converts at its edge (JavaScript from UTF-16, Go and Rust from UTF-8). The libraries derive line and column in diagnostics from code points. Lines split at `\n`, `\r\n` and `\r`.

A token's `span` is a range of the previous stage's tokens. Its `source` is the smallest range of the original text that holds the sources of those tokens. So the source is contiguous even when some of those tokens emitted nothing, as an erased word inside a compound does. A token inserted by an emission clause has an empty span, and an empty source range at the position where it was inserted. Its provenance is that emission: it records the rule whose clause inserted it.

Following `span` from stage to stage, or `inserted-by` where a token has no span, explains any token. The chain ends at the characters or at the rule that made the token.

## The notation

gencmu's grammars are written in jbogenbau, a notation of its own. `docs/notation.md` explains it for grammar authors. This section gives the summary and the reasons.

A jbogenbau grammar is an attribute grammar (its constituents carry computed values) with EBNF rule bodies. Each rule body is EBNF in the form that CLL (*The Complete Lojban Language*) prints. Each constituent carries one attribute, its set of tags, computed bottom-up from its parts. Conditions over the parts, such as whether a part also parses as another rule, restrict which parses exist, as in a Boolean grammar. A rule can say what its constituents hand to the next stage. So each grammar is a transducer (it reads one token sequence and writes another), and a dialect is a pipeline of them.

The bodies keep the look of CLL's EBNF, because a reader of CLL recognizes that look. Everything around the bodies is spelled with keywords, because symbols there proved opaque.

A grammar document is Markdown. Its fenced `jbogenbau` blocks, in order, are the grammar, and the prose between them explains it. The loader finds only the fences by lines, as Markdown requires. Inside a block, line breaks and indentation mean nothing.

A rule is a keyword, its name and its body, followed by its clauses. Each clause is a keyword and what it says. A rule ends where the next keyword that begins a rule or a directive stands. So a rule needs no terminator, and nothing is recognized by its position on a line:

```jbogenbau
%rule term-connective
  | joik #
  | jek #
  | ek #
  | VUhU #

%rule vowel-group-joined
  $g(vowel-group) $v(vowel) <tags($v)>
%conditions
  ~syllabic ⊆ tags($g),
  ~syllabic ⊆ tags($v)
%emits
  $g, /'/, $v
```

Every binary operator can also stand first, as a no-op, so that a list can put one item on each line. The binary operators are `|` and `&` in bodies, `∪` and `∩` in terms, and `∧` and `∨` in conditions.

A stage is several documents, read in order and stitched into one grammar. `%rule` defines a rule, and is an error if a rule of that name exists. `%redefine-rule` replaces a rule that an earlier document defined, and is an error if none did. `%extend-rule` adds alternatives to a rule defined before it, and is an error if none was.

So an accidental override never passes silently, and a replacement says so where it is made. A misspelled name in a replacement, an extension or a reference is an error. A misspelled `%rule` defines a rule that nothing reads, and the audit (see "Diagnostics and debugging") reports it. The loader also reports every replacement and extension: which document changed which rule. So a reader can see the effect of a dialect on its base in one place.

The notation has no way to remove a single alternative. A rule is small enough to restate, and a restated rule reads better than a list of deletions.

This is what the dialects need. A script document adds its letters to the rules of the phoneme grammar with `%extend-rule`. A word family adds the syllables that its morphology allows. The experimental syntax is a layer over the CLL syntax. It restates the CLL rules that it changes, and adds rules of its own.

The Zantufa syntax is a grammar of its own. Zantufa 1.9999 restates almost every rule of camxes, a PEG grammar of Lojban. So the gencmu grammar translates the Zantufa rules one by one. It uses small rules for the conditions that state the lookaheads and ordered choices of the reference.

A name in upper case is a terminal that matches a token carrying that tag. A string in straight quotes, `"а"`, `"word"`, is a terminal whose tag the name syntax cannot spell. A phoneme between slashes, `/a/`, `/'/`, `/./` for a pause, is a phoneme tag. It matches like any tag, and it also says what a token that carries it sounds like, which `phonemes()` reads. Slashes mean nothing else.

A reference, a tag literal, a phoneme tag or a character tag can carry a spelling, the text between backticks after it, as in ``LE`la` ``. The symbol then matches only where its span sounds like the spelling, whatever the stress or the script. So a rule can name a word by its sound in its body, and not in a condition. A spelling does not replace a class, since a word that `zo` quotes has the sound but not the class.

The operators of a body are those of CLL:

- Juxtaposition is sequence.
- `[x]` is optional.
- `x ...` is one or more, and `[x] ...` is zero or more, left-recursive.
- `A & B` is and/or, in order.
- `( )` is grouping.
- `ε` is empty.
- `f?` and `¬f?` are gates, and `f!` is a warning. These are the feature guards on an alternative (see "Gates and warnings").
- `$x(symbol)` is a capture, and `$` is the whole constituent.

`#` is not built in. It is a rule that the grammar defines as `[free ...]`, as CLL's EBNF defines it. So the free modifiers of one slot, such as vocatives, are one node of the tree.

CLL writes `/KU/` for an elidable terminator, a closing word that the speaker can leave out. Here it is written `[KU]`, and `/KU#/` is `[KU #]`. The grammar declares once which terminators are elidable (see below). `[KU #]` is exactly what CLL prints: an elided terminator takes its free-modifier slot with it. So `xy. xi ky.` (CLL 17.38) needs `xy. boi xi ky.` under the printed grammar, as CLL's official parser does, and as the corpus scans of the prototype show. The grammars that allow free modifiers after an elided terminator, as the camxes family does, write `[KU] #`.

`%tags` gives the tags that the constituent of every alternative carries. An alternative's own tags, after it in angle brackets, add to them. A tag has no strength. There is one notation for a set of tags, the union: `UI ∪ CAI ∪ ~indicator`.

`%conditions` lists conditions over the captured parts. Each condition applies to the alternatives that capture what it mentions. The recognizer evaluates it as early as it can. Within one condition, `∧`, `∨` and `⟹` are logic, in that order of precedence, grouped with parentheses.

`%emits` lists exactly what the constituent hands to the next stage, in order, each capture with its own tags. `%emits ε` hands on nothing and makes the constituent not count. That is how a grammar leaves erased text out of what the words around it sound like.

A clause can refer to a capture that some alternative lacks. Lowering decides such a clause before the recognizer reads any text. A condition or an emitted item then does not apply to that alternative. A tag term is an error unless it is guarded, as in `($c ⟹ tags($c, lexicon))`. The reason is that a tag term has no value that can mean "nothing to say". A clause that applies to no alternative, or a capture that no alternative captures, is an error.

Directives are keywords too, and can stand in any block.

`%ambiguity-resolution greedy` or `lazy`, optionally followed by `elision-only` and then by `maximal`, says how the stage chooses among parses (see "Ambiguity"). Every stage must have exactly one, in any of its documents. A stage with none or two is a load error that names the stage.

`%elidable KU KEI VAU ...` lists the terminators that can be elided. An absent optional whose first symbol is one of them appears in the tree as that terminator, elided at that point. `elision-only` restores these terminators.

By convention, a directive stands in a block of its own, after prose that says why the grammar needs it. gencmu does not enforce the convention.

The notation is self-hosting: it is itself a dialect of two stages. A lexical grammar reads characters into notation tokens, and a syntax grammar reads those tokens into a document tree. Both grammars are in `grammars/notation/`, and both are written in the notation. `docs/notation.md` explains the notation, and these documents define it.

The chicken-and-egg problem is solved once. The DOM of the notation grammar is checked in as `grammars/notation/bootstrap.json`. Every library loads it to read every grammar document, `notation/` included. CI makes sure that the fixpoint holds: reading the notation documents with the bootstrap reproduces the bootstrap exactly.

A maintainer changes the notation in its documents, and `tools/sync.js` regenerates the bootstrap from them. A maintainer wrote the very first bootstrap by hand in JavaScript. In each library, three steps of the reading are written by hand:

- The search for the `jbogenbau` blocks of a Markdown document
- The walk from a document tree to its grammar objects
- The checks of the restrictions that the grammar of the notation does not state

`docs/engine.md` specifies the search (§8), the walk rule by rule (§9) and the restrictions (§9).

Grammar authors get the same diagnostics for a malformed grammar as for a malformed Lojban text. The playground can also show how a grammar document parses. The cost is load time. The bundled grammars are about 200 KB, and a character-level stage reads them quickly in Rust and JavaScript but slowly in pure Python. So every package ships, beside its grammar copy, the DOM of each bundled document as JSON.

The key of a DOM has three parts:

- A hash of the document's text
- A hash of the bootstrap that read it
- The version number of the DOM format

A change to any of them misses the cache. A library reads a document through the notation grammar only on a miss. In practice, that happens only for a grammar that someone wrote or edited. The playground caches the DOMs of edited documents in the same way. CI makes sure that the shipped DOMs match a fresh reading, and the tests of every library include forced cache misses.

The fixpoint alone proves only that the notation reads itself consistently. So `tests/notation/` also holds direct cases, run by every library: small documents with their expected DOMs and their expected errors.

## Pipelines

A pipeline document is Markdown too, and literate. Each stage is a heading, followed by the list of documents stitched into it. Prose then says what the stage receives from the one before, what it does, and what it hands on. The machine-readable parts are three directives in `jbogenbau` blocks. The notation reads them like any other directives, so no library reads Markdown structure beyond finding the blocks:

````markdown
# The CLL dialect

... what the dialect is ...

## Stage 1: phonemes

```jbogenbau
%stage phonemes
```

- [Latin orthography](../phonemes/latin.md): what this document contributes
  ```jbogenbau
  %include "../phonemes/latin.md"
  ```

... what the stage receives, does and hands on ...
````

The three directives are these:

- `%stage NAME` starts a stage. `NAME` is what the API, the CLI's `--until` and diagnostics call the stage, whatever the heading says. Two stages with one name are an error.
- `%include "PATH"` stands for the rules and directives of another document, as if the text of its blocks stood there.
- `%features NAME ...` names features that the dialect turns on for every parse, wherever it stands. The loader unions the names of every `%features`. A caller (the program or person that asks for a parse) can turn further features on, and can turn any of them off. So a feature that is on by default is a choice that the caller can undo.

The link to each included document stays in the prose, so the pipeline reads as hyperlinked prose on GitHub. The bundled grammars keep a style for this. The block of each `%include` stands under a list item, indented to the item's text. The item's line has an inline link `[text](PATH)` to the same path. The style is not part of jbogenbau, which accepts an `%include` in any block. Only `tools/sync.js --check` enforces it, and only for the bundled grammars.

A link without an `%include` is ordinary prose, so a pipeline can link to CLL or to other dialects freely.

A library reads each document into its DOM on its own, as it reads any grammar. So every document must be complete rules and directives, and its DOM is cached as any other. The library then splices (engine §13). It reads the pipeline's items in order and recursively replaces each `%include` with the included items. It splits the stream at each `%stage`. Every item keeps the document it came from, so errors and the audit still name the document and line that an author wrote.

The result is what textual inclusion gives. Stitching looks only at the order of a stage's rules, never at the documents that hold them (engine §2). A later rule can redefine or extend an earlier one wherever each was written. Stages run in the order they start, and every stage's start rule is `text`. Paths resolve against the including document, in the same way on disk, in memory and on GitHub.

A document can be included in several stages, and an included document can hold `%stage` and `%features` too. So several pipelines can share a stage by including one document that holds it. A stage cannot be reopened: a second `%stage` of one name is an error. That leaves `%extend-stage` and `%redefine-stage` free if a dialect ever needs them.

## Ambiguity

A grammar admits every parse that its rules allow. Where a text has more than one parse, the engine treats each parse as the sequence of steps that a bottom-up reader takes. A step reads the next token or closes a constituent. The engine compares the parses at the first step where two of them differ:

- If both read the same token under two tags, the text is ambiguous for this grammar.
- If one reads and the other closes, `%ambiguity-resolution` decides. `greedy` takes the one that reads, so a constituent ends as late as the grammar allows. `lazy` takes the one that closes, so a constituent ends as early as the grammar allows.
- If both close different constituents, the text is ambiguous for this grammar, and the result is a tie, with its witness.

The preference is like greedy and lazy quantifiers in a backtracking regular-expression engine, and not like the greed of a PEG. The preference orders the parses that the grammar already admits, and never commits, so it cannot reject a text. The earliest difference dominates. And the preference applies to every constituent of the stage, not to one quantifier.

The syntax grammars are greedy, and that is how an elided terminator is placed. The forms and words stages are lazy. The word forms divide a run in one way only, so the choice matters only in the words stage. A magic word, such as `si`, acts on other words. In the words stage, a magic word acts on what exists when it is read.

CLL's own rule is narrower. It says only that a terminator can be elided if no ambiguity results. It says nothing of the other ambiguities that its EBNF has. `elision-only` applies that rule literally, to the stage whose grammar declares it. It applies the rule only when the ranking of that stage was not `unique`:

1. Take the `elided` nodes of the chosen tree in text order. Where several stand at one point, take the inner before the outer. For each node, insert a synthetic token before the stage-input token at the node's position. The synthetic token carries only the tag of that terminator, and is marked synthetic.
2. Lower the same grammar again, and make mandatory every optional whose first symbol is an `%elidable` terminator. Parse the new token sequence.
3. Build the ranking of that forest (the set of all its parses) with no lean to greedy or lazy. If the forest has exactly one derivation, the check passes. It also passes if the forest has none, since then no two restored readings exist to report. In that case, every other reading of the original input needed a terminator elided where the chosen reading did not. CLL's rule forbids that elision, because it made the text ambiguous. Otherwise, the ambiguity is not about terminators, and the result is an error of kind `ambiguous`. `ok` is false, and the error carries the two readings that the ranking reports, the chosen and the tied, shown over the original input.

The engine cases pin the definition with these cases:

- Two readings that elide different terminators. The check passes.
- Two readings that differ with every terminator written. The check fails.
- A restored text with no derivation. The check passes.
- Several terminators elided at one point

### Where an elided terminator can fall

`elision-only` settles which reading a text has. It does not settle whether a reading that needs an elided terminator counts at all. CLL's rule, "if no grammatical ambiguity results", has three readings, and the grammar that CLL prints does not choose among them:

- The printed grammar, read literally, counts every parse: a terminator can be elided wherever a parse of the whole text needs it. `le lojbo se farvi le loglo gi'enai mintu ja dunli le logla` parses, with the description ending before `se farvi`.
- CLL's official parser reads one lexeme ahead and never goes back. A lexeme is one unit that the parser reads. It is a word, or a run of words that the parser joins. The parser elides a terminator only through the error recovery of its grammar, where the next lexeme cannot continue what it is reading. CLL's own explanations of elision describe this. That is why CLL 14.14 says that `le nanmu ku joi le ninmu` needs its `ku`.
- The PEG grammars that replaced the YACC grammar (the grammar of the official parser) commit too, but in another way. What a PEG read before an elided terminator runs as far as it can be read. So `le nanmu joi le ninmu` parses, and the `le lojbo` text does not.

The notation offers the third reading as `maximal` (engine §4). It is a condition on which parses count, stated over the recognizer's items. It does not order the alternatives of a rule, so a grammar stays a description of its language. The bpfk dialect reads elided terminators this way, because the definition effort that approved its word forms also adopted the PEG.

The cll-ebnf dialect takes the printed grammar as normative, and keeps the literal reading. So do the experimental and Zantufa dialects, which accept the most. The cll-ebnf and bpfk dialects each name their reading in a document of one directive, stitched after the CLL grammar. A stage states its `%ambiguity-resolution` exactly once, so the experimental layer over the CLL grammar states its own.

A measurement at the time `maximal` was specified used the 24,552 CLL cases that the corpus then held. There, `maximal` rejects 68 texts that the literal reading accepts, and camxes-std, the reference PEG, rejects 66 of them. `maximal` changes the chosen reading of no text that it accepts. In 2,892 texts, it removes only parses that the greedy ranking already beat, so their verdict becomes `unique` instead of `resolved`.

Of the other two texts, camxes-std reads one as a forethought termset without `nu'i`, which the CLL grammar does not have. In the other text, `maximal` sees a longer constituent that splits the number `paso` in two. A PEG never does that, because its number is greedy as well.

The official parser's reading is not in the notation. Its lookahead is a lexeme, not a word. Step 5 of its preamble, the steps that prepare the words for its grammar, joins runs of words into one lexeme. Examples are the connective `na ja`, or a number followed by `moi`. A rule that reads one word ahead over a stage's tokens sees the `na` of `le nanla na vrude` as the start of `na ja`. Tried word by word, such a rule rejected 369 texts of the corpus that the official parser accepts.

A dialect that reads as the official parser does needs that preparser as a stage of its own ([issue 28](https://github.com/int19h/gencmu/issues/28)). The same preparser settles ambiguities that the printed grammar leaves open, such as a gihek or joik directly before `ke`. The dialects here leave these ambiguities as the printed grammar has them. So `mi broda joi ke brode ke'e` has two readings that differ in more than a terminator, and `elision-only` reports it.

Measured on the prototype's corpus, `elision-only` cost the CLL grammar nothing. Every one of its 8,853 ambiguous texts became unambiguous with its terminators written out. The extended grammars were different: 63 experimental and 74 Zantufa texts stayed ambiguous. Some of the Zantufa texts stayed ambiguous through its mekso (its grammar for mathematics).

In the experimental grammar today, two sumti (arguments of a predicate) joined by a connective between them cause such an ambiguity. A term is a wider kind of argument that includes the sumti. The grammar also reads the two sumti as two terms joined in the same way, with or without `bo`. So `mi .e do klama` and `mi .e bo do klama` each have two readings.

So the dialects of the CLL syntax grammar declare `%ambiguity-resolution greedy elision-only`, with `maximal` in the bpfk dialect. The extended dialects declare `greedy`. Each dialect has prose that gives these reasons. A parse option overrides `elision-only` either way: on, to look for overlaps in the supplied text, or off, to loosen the CLL dialect. The lean itself (greedy or lazy) cannot be overridden, because a lazy syntax or a greedy word grammar is a different language, not a variation.

## The result, and why it has no types

The grammar decides the shape of the tree, and gencmu loads the grammar at runtime. So no language gets a typed tree. Every library returns the same generic structure:

```
ParseResult
  ok            whether every stage accepted
  stages        per stage: name, input tokens, output tokens, verdict, tie witness, rejection
  tree          the last stage's chosen tree, or none
  error         the first rejection, with source position and what was expected
  warnings      per warning: stage, feature, rule and range, for each place the chosen tree uses a warning's alternative

Node
  kind          "rule", "token", or "elided" (a terminator elided at this point)
  rule          for a rule node: the rule the author wrote
  terminal      for a token or elided node: the terminal it read or stands for
  children      for a rule node: nodes, in text order
  span          token range in the stage's input
  source        code-point range in the original text
  tags          for a rule node: its tag set, a sorted list of tags
  token         for a token node: the index of the stage-input token it read
```

The tree is lossless with respect to the grammar that the author wrote. Every rule that the parse went through is a node, including chains of single-child rules. So a program can tell `sumti-6` from `sumti`.

The engine splices out only two kinds of node, because no author wrote them. The first kind is the helper rules that lowering invents for `[ ]` and `...`. The second kind is the prefixes of a trailing repetition. A trailing repetition ends in `...`. It is also the only alternative that the gates leave in its rule (engine §3). So `%rule text item ...` gives one `text` node over all its items.

An absent optional that begins with an `%elidable` terminator leaves an `elided` node with an empty span, at the place of the missing terminator. Collapsing chains is a choice of the renderers, not of the tree. `text` and `phonemes` are not stored on nodes. The libraries compute them from the tokens, so that the two cannot disagree.

Each library exposes this structure in the idiom of its language. JavaScript uses plain objects and arrays, and Python uses dataclasses. Go uses structs with slices, and Rust uses structs with `Vec` and owned `String`. These types let a result outlive the text and the dialect that it came from. Each library can serialize a result to the canonical JSON of `docs/output.md`. Each library also renders the canonical bracket form, because the shared tests compare it.

## The API

The API has the same shape in every language, spelled idiomatically:

```
dialect = load_dialect("cll-ebnf")                 # a bundled dialect by name
dialect = load_dialect_file("my/pipeline.md") # or a pipeline document on disk
dialect = load_dialect_sources({path: text})  # or documents held in memory, for the browser
result  = dialect.parse(text, features={"y-cmavo"}, without_features={"cll-cyrillic"},
                        auto_features=True, until="words", elision_only=None)
result.ok; result.tree; result.error.describe(); result.warnings
dialect.features                              # each feature: name, gate or warning, on by default or not
to_json(result); to_brackets(result)
```

The bundled grammars are embedded in each package, so a library works with no files beside it. A caller can also supply any grammar from disk or from memory. In-memory sources are a map from path to text. The paths are `/`-separated and relative to a virtual root. The loader resolves the document paths of a pipeline against the pipeline's own path, and normalizes `.` and `..`, exactly as on disk. The bundled dialects are that same map.

Parsing is synchronous everywhere, and the browser runs it in a worker (a background thread). If `elision_only` is left unset, the parse follows the grammar's directive. `auto_features`, on by default, adds `sa-su` to the given features only where it is needed (see "Expensive constructs behind features"). It adds nothing if `auto_features` is off or `without_features` names `sa-su`.

The distributable artifacts are exactly these:

- The npm package `gencmu` (the `lib/js/` directory)
- The Python distribution `gencmu` (`lib/python/`, a pure-Python wheel)
- The Go module `github.com/int19h/gencmu/lib/go`. Import it as `gencmu "github.com/int19h/gencmu/lib/go"`. A Go module in a subdirectory is tagged `lib/go/vX.Y.Z`.
- The crate `gencmu` (`lib/rust/`)

Each contains its grammar copy and nothing from outside its directory. CI makes sure of this: it builds each artifact from a clean checkout (`npm pack`, `python -m build`, `go build` from a module-mode checkout, `cargo package`).

## Diagnostics and debugging

These are the product, not an afterthought:

- A rejection names the stage, and shows the source line with a caret under the failing character or word. It lists what can continue at that point as grammar terms, grouped by rule, not as a set of tag names.
- A grammar error carries file, line and column, and names the rule.
- A tie shows the two derivations side by side from the first difference.
- Stage inspection shows the tokens that every stage emitted, with their tags.
- The trace shows, for one position, which items the recognizer predicted, completed and dropped, and which condition dropped them. This is the tool for "why does my grammar not accept this".
- The audit reports undefined and unreachable rules, every rule that a later document replaced or extended, and `%emits ε` that changes nothing. Such an `%emits ε` is over text that can never emit a token or be covered by one. A condition that applies to no alternative is not an audit finding. It is an error of the grammar.

## CLI and playground

The CLI is `node lib/js/cli.js` (and `npx gencmu` once published). It has these commands:

- `parse`, with `--dialect`, `--feature` and `--no-feature`, `--until`, `--format brackets|tree|json|canonical|tokens` and `--trace`. It prints any warning on standard error, as it prints a tie.
- `features`, to list a dialect's features
- `audit`
- `stitch`, to print a dialect's pipeline as one jbogenbau text
- `test`, to run a test file against a dialect

The CLI needs Node and nothing else.

The playground is `index.html` with `dist/gencmu.js` and `dist/grammars.js` loaded as classic scripts. So it works from `file://`, where browsers refuse ES modules, and from GitHub Pages alike. Nothing is fetched: the grammars are a JavaScript object in `dist/grammars.js`. The page builds the worker from a `Blob` whose text is the library source and the grammar object. So the worker fetches nothing either.

This was the riskiest part of the design, so it was proved first, with a stub parser. A page started a blob worker from `file://` and got an answer, in current Chrome and Firefox.

`tools/smoke-playground.js` makes sure that the playground works in headless Chromium and Firefox. Playwright drives the browsers. CI runs the smoke test, and a contributor can run it locally. To run it locally, do these steps:

1. In `lib/js`, run `npm ci`.
2. In `lib/js`, run `npx playwright install chromium firefox`.
3. From the root of the repository, run `node tools/smoke-playground.js [--browser chrome|firefox] [URL]`.

The test uses Playwright's own browsers, because a browser installed as a snap cannot read a checkout outside the home directory. Playwright is a development dependency of `lib/js` only, never of the libraries or the playground. With no URL, the smoke test opens `index.html` from `file://`. Given a URL, it tests the page at that URL instead, such as a deployment on GitHub Pages.

The playground has these parts:

- The text
- The dialect, and a switch for each of the dialect's features, set to its default
- The warnings of the parse
- The output in the four formats, and the tokens of each stage
- The diagnostics above
- An editor for the grammar documents. An edit parses the text again at once, and the edited documents can be downloaded.

The editor lists a dialect's documents stage by stage. A forgiving scan of the `%stage` and `%include` directives finds them (`playground/pipeline.js`). So a pipeline with an error, a missing document or a cycle still shows every document it reaches. Parsing runs in a worker (a `Blob` worker, which also works from `file://`), so a long text does not freeze the page.

## Output formats

`docs/output.md` defines the output formats exactly. JavaScript implements them for the CLI and the playground, and every library implements the bracket form for the tests:

- `brackets` is the tree as nested groups, cycling `( ) [ ] { }` by depth. The renderer collapses groups of one child, and leaves show their phonemes, with stress. An option shows elided terminators in angle brackets, `⟨ku⟩`, or hides them.
- `tree` is an indented listing, one node per line, with the rule name and the text.
- `json` is the display JSON, a projection of the tree for reading. It is pretty-printed so that a node with one child stays on one line with its parent, as in `{"tanru-unit-2": {"BRIVLA": "mlatu"}}`. This keeps deep trees readable.
- `canonical` is the canonical JSON of the whole result, which the shared tests compare.

## Tests

There are three kinds of shared test, and every library runs all of them:

- `tests/engine/`: the engine specification's cases. Each case gives a pattern that the canonical result JSON must match. A pattern can pin stages, tokens, tags, verdicts, witnesses, errors and coordinates.
- `tests/notation/`: small grammar documents with their expected DOMs and errors
- `tests/corpus/*.jsonl`: Lojban texts, one case per line:

  ```
  {"id": "cll.10.183.c10e24d5", "text": "puzu", "dialect": "cll-ebnf",
   "expect": "accept", "verdict": "resolved", "words": ["pu", "zu"],
   "brackets": "(pu zu)"}
  ```

  `expect` is whether gencmu is meant to accept the text, `words` the tokens of the word stage, and `brackets` the tree. A full result for each case needs hundreds of megabytes. The engine cases pin down the full result, and the corpus pins what a Lojban reader cares about.

The corpus was seeded once from the prototype's fixtures and their verdicts. Some cases are meant to differ from the verdict that they were seeded with. Such a case says so in its own terms: `"seeded": "reject", "reason": "..."`. The case states its reason in terms of the grammars of gencmu. One reason is "`sa bu` backs up to the `bu` of the last letter word, as the unique cases of the Magic Words proposal say". Those two fields make every departure from the seed visible in review, and a script lists them.

A change to a case's expected `words` or `brackets` needs no field of its own. It is a change to what gencmu produces. The author of the change makes it in the same commit as the grammar change that causes it. The message of that commit explains it. After seeding, the corpus is ours: a change that alters an expectation updates the file in the same commit.

Every library runs the whole corpus. On a pull request, a sampled core of about 1,100 cases (`tests/core.txt`) runs in every language. Rust and JavaScript also run the whole corpus there. All four languages run the whole corpus nightly and before a release, sharded if Python needs it. No language is permanently exempt.

## CI

CI is one workflow with one job for each language. Each job runs on the oldest and the newest supported toolchain:

- JavaScript: Node 20 and current, `node --test`, the bundle freshness check
- Python: 3.10 and current, `python -m unittest`, `python -m build` for the wheel. The build backend is the only tool outside the standard library, and only at build time.
- Go: 1.22, the minimum of the module, and current, `go vet`, `go test`
- Rust: MSRV (the minimum supported Rust version) and stable, `cargo fmt --check`, `cargo clippy`, `cargo test`, and `cargo package` to make sure that the crate is self-contained

Third-party actions are pinned by commit hash. GitHub Pages can serve `main` from the root with no workflow. It is not enabled while the repository is private, because a Pages site is public.

## Standard library only

This holds for every target. JavaScript needs nothing beyond the language and, for the CLI, Node's `fs`. Python's standard library has everything, `json` included. Go's has `embed` and `encoding/json`. Rust's has no JSON reader, so the Rust library carries a small one for the files it ships, and it writes JSON by hand. That is a few hundred lines, and the one real cost of the rule.

The rule covers what building and running need, not the tools that CI runs to make sure that the code is correct. The JavaScript sources carry JSDoc type annotations. In CI, TypeScript makes sure that the annotations are type-correct, with `strict` on. TypeScript is a development dependency of the package, with Node's type definitions for the Node entry point. Nothing runs it to build, test or use the library.

TypeScript writes declarations from the annotations into `lib/js/types/`. These declarations are checked in, like the other generated files, and the published package includes them. CI makes sure that they are up to date. So a client in TypeScript, or an editor, gets the library's types without a build step in gencmu. Playwright is also a development dependency of the package: it drives the playground's smoke test in a browser, and nothing else.

## Gates and warnings

A dialect that extends another makes two kinds of change. Most are additions: texts that the base grammar rejects and the dialect accepts, such as `cu` before a bare selbri in the experimental dialect. Some change how the dialect reads a text that the base grammar accepts. An example is the cmevla-brivla merger, which lets a name word (cmevla) also act as a predicate word (brivla). Under the merger, `la .alis. klama` is one description. The notation has a kind of feature guard for each kind of change.

An addition is a warning, `name!`. Its alternative is there whether the feature is on or off, so turning the feature on changes no verdict and no tree. It only adds a warning to the result for each place where the chosen tree uses the alternative. The warning names the feature and the text. The dialect turns none of its warnings on, so its texts parse without warnings by default. A reader who wants to know which additions a text relies on turns them on.

A warning is on the chosen tree only. An addition that only a tied or losing reading uses is not reported. The idea comes from jbotci, another Lojban parser, which warns where an experimental construct makes a text parse that the standard grammar rejects. The experimental syntax is already a layer over the CLL grammar, but its additions are not warnings yet. The one bundled warning is `y-cmavo`, in the word stage of the cll-ebnf dialect.

A change of reading is a gate, `name?`, with the old form under `¬name?`, so that exactly one of the two is live. A warning cannot express it, because a warning keeps its alternative even with the feature off. The base reading is then gone either way. A dialect that makes such a change turns its gate on by default, and a caller who wants the base reading turns it off. Gates are also how a grammar keeps an expensive construct out of the parses that do not need it (see below).

A name is one kind or the other in a dialect. It is an error to load a dialect in which one guard uses a name as a gate and another uses it as a warning. Turning the feature on then means two things.

Features are chosen one by one because an extension is not one decision. camxes-exp, the reference of the experimental dialect, is a bundle of changes that people adopt separately. Some people use the merger and some do not. A feature that composes with the rest by plain addition stays selectable on its own. A change that cannot be made selectable without a convoluted grammar is made unconditionally in the dialect's documents, and its documents say so.

## Expensive constructs behind features

The erasers `sa` and `su` reach back over any number of words. So the parser keeps a possible reach open from the most recent word of each selma'o (word class). It does not know whether a `sa` will come. A reach can run back to the start of the text, as an unmatched `sa` or a `su` does. Such a reach begins with a rule anchored there by `initial`, so the parser reads it once.

The cost then grows in proportion to the text, but each word costs more. In JavaScript, a text of 13,700 characters takes about 22 seconds with the feature and 6.5 without it. These erasers are rare, so they are behind a feature, `sa-su`.

Without the feature, the words of SA and SU are ordinary words. The syntax rejects a token of SA or SU that is still there after the word stage. But another magic word can act on such a token first. So `mi su si do` reads as `mi do` without the feature, because `si` erases the `su`. With the feature, it reads as `do`.

The libraries' `auto_features` parse a text's word stage once without the feature. They enable the feature only if that stage rejects the text, or reads a word of SA or SU. That word can be anywhere in the tree, erased by a `si` or not. A text with no such word parses the same either way. The CLI and the playground use `auto_features` by default.

The engine can later make this unnecessary: it can stop predicting a rule whose required words cannot occur in the rest of the input. That is an optimization to specify once it is understood, and it is not part of the first version.

## What came from the prototype

Three things came from the prototype:

- The grammar documents. They were rewritten where they referred to the prototype, other parsers or research notes, and converted to the notation above.
- The notation document
- The fixture corpus, converted to the format above. It has about 26,000 cases and 8 MB with words and brackets, and the repository keeps it whole.

Nothing else came from the prototype: no code, no scripts, no notes. The maintainers edit the CLL lexicon by hand. The experimental and Zantufa lexicons come from the word tables of other parsers. `tools/peg-lexicon.js` generates each of them, and a maintainer changes one by running the tool again. The Zantufa grammar is a grammar of its own, as above.
