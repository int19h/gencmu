# gencmu: design

## What gencmu is

gencmu is a standalone Lojban parser whose grammar is data. Every language layer is a literate grammar document in one runtime notation. A literate document mixes rules with explanatory prose. A phoneme is a unit of sound. The layers map characters to phoneme values, recognize words, and build a parse tree.

A dialect defines a parsing pipeline. A pipeline runs grammar stages in sequence. A pipeline document defines the dialect.

That document is literate Markdown too. A stage reads its input with one grammar, and hands its result to the next stage. The first stage reads stage-zero characters or caller-supplied tokens. The pipeline document lists the stages and the grammar documents stitched into each stage. It also explains what each stage receives and hands on.

The users of gencmu want to read a grammar, change it, and see at once what the change does to a text. So the notation, the diagnostics and the interactive tools matter as much as the parser.

gencmu ships these parts:

- There are four libraries, in JavaScript, Python, Go and Rust. A clean-room implementation uses the specification alone. Each library implements one engine specification without using another library's code. No library has dependencies beyond the standard library of its language.
- The grammars and dialect pipelines are shared by all four.
- There is one command-line tool (CLI) and one web playground, both in JavaScript. Both run from a clone with no install step.
- There is one test corpus, shared by all four libraries. Its expectations are what gencmu itself is meant to produce.

## Repository layout

```
index.html                 web playground, which GitHub Pages can serve from the root
playground/                playground scripts and styles, relative paths only
grammars/                  the grammar documents, the single source of truth
  phonemes/                characters to phonemes: latin-experimental, cyrillic-experimental, latin-strict, latin, cyrillic, cyrillic-cll, zbalermorna
  words/                   word forms, shapes, lexicons, stream, quotes, erasure, and dialect extensions
  indicators/              CLL indicator and ba'e rules, and the experimental layer
  syntax/                  the syntax grammars
  notation/                the grammar of the notation itself, and its bootstrap
  dialects/                pipeline documents: cll-ebnf, bpfk, experimental, zantufa, notation
docs/
  design.md                design choices and their reasons
  dialects.md              the dialect author guide
  experimental-cmavo-evidence.md  evidence for the experimental lexicon
  notation.md              the grammar notation, for grammar authors
  engine.md                the engine specification, for implementers
  api.md                   the library API, per language
  output.md                the output formats, defined exactly
  diagrams/                railroad diagrams of the grammars' rules as SVG, generated
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

`grammars/` is the single source of the grammars. The repository keeps all generated files checked in, and CI (automated tests for every change) makes sure that they are up to date. Each package needs its own copy, because the packaging of every ecosystem refuses files outside the package directory. Go's `embed` also refuses symbolic links. The copies are `lib/js/grammars/`, `lib/python/src/gencmu/grammars/`, `lib/go/grammars/`, `lib/rust/grammars/`, and `dist/grammars.js` for the browser.

The browser grammar bundle excludes `unicode-properties.txt`. The playground fetches that pinned file at startup before loading dialects. The core table, with printer abbreviations, comes from `dist/grammars.js`. Bundled names-dependent cache hits use the `bundledNames` registry from `compiled.json`, which `dist/grammars.js` includes. Such hits fetch no names files. Source names outside the core abbreviation map require a fetch of `grammars/unicode-names.txt`.

Declared extras use the same lazy path under `grammars/`, including `grammars/phonemes/zbalermorna-names.txt`. Neither standard nor extra names files enter the grammar bundle. A failed fetch prevents loading and reports the resource error.

`dist/gencmu.js`, the library as one classic script, is generated too. The playground works without a build step from an HTTP server, including GitHub Pages. One Node script, `node tools/sync.js`, writes all these files without extra dependencies. CI runs it and fails if anything changes. A contributor edits `grammars/` and runs one command.

## Standard library only

The rule against mandatory dependencies holds for every target. JavaScript needs nothing beyond the language and, for the CLI, Node's `fs`. Python's standard library has everything, `json` included. Go's has `embed` and `encoding/json`. Rust's has no JSON reader, so the Rust library carries a small one for the files it ships, and it writes JSON by hand. That is a few hundred lines, and the one real cost of the rule.

The rule covers what building and running need, not the tools that CI runs to make sure that the code is correct. The JavaScript sources carry JSDoc type annotations. In CI, TypeScript makes sure that the annotations are type-correct, with `strict` on. TypeScript is a development dependency of the package, with Node's type definitions for the Node entry point. Nothing runs it to build, test or use the library.

TypeScript writes declarations from the annotations into `lib/js/types/`. These declarations are checked in, like the other generated files, and the published package includes them. CI makes sure that they are up to date. So a client in TypeScript, or an editor, gets the library's types without a build step in gencmu. Playwright is also a development dependency of the package: it drives the playground's smoke test in a browser, and nothing else.

The Markdown parser, `micromark` and `mdast-util-*`, supports the sync and prose checks. Run `npm ci` in `lib/js` to install the development dependencies before these checks.

## The engine

The engine works with these objects:

- A token is one unit that a stage reads or emits. Tokens include characters, phonemes, and words.
- A tag is a named identifier mark on a token. Examples are `KOhA`, `Word`, and the stored engine tag `_General_Category_Uppercase_Letter`.
- A constituent is the input that one rule matches. Its span is the range of input tokens that it covers.
- A capture names a part of an alternative. For example, `$c` lets a condition or emission use that part.

The four libraries implement one specification, `docs/engine.md`. It defines the same behavior for all four implementations. It covers:

1. The loader, the part of a library that reads documents, uses the notation's own grammar. It reads the fenced `jbogenbau` blocks of a Markdown document into a grammar DOM (document object model: the document as a tree of objects).

   See "The notation" below. The loader splices pipeline documents as "Pipelines" says, and stitches each stage. Template expansion produces ordinary rules before validation and lowering. Its errors carry file, line and column.

2. Lowering turns the grammar into a context-free grammar. Lowering makes named helper rules for the notation's shorthand, such as `[ ]` and flat `{ }`, and diagnostics hide these rules.

3. The recognizer is an Earley parser (a standard algorithm for any context-free grammar). Its items, the partial matches that it keeps, record the span and the identity of the tag set of each captured part. The parser evaluates each condition as soon as it reads the last capture of that condition. With `.onward` and `.following-tokens`, a condition can look past its constituent to the end of the input. A PEG (parsing expression grammar, which tries alternatives in order) has a lookahead that does the same.

   Nested parses for `span.matches(rule)`, `span.begins(rule)`, `span.ends(rule)`, and `span.tags(rule)` share their memo (a cache of answers) with the parse that started them. The memo key is the kind of query, the rule, and either the content of a short span or the position of a long span. Ordinary answers of short spans can also outlive the parse, in the shared memo of engine §4.3. A nested parse asked about its own span, as the same rule, is a grammar error. A nested parse never leaves out an elidable optional that the same construct can read whole as written (see "Nested queries and elided terminators" below).

4. A rule flag declares a preference for one rule. A flagged occurrence is a flagged rule's constituent. A rule profile counts `leftmost-longest` occurrences over each nonempty input span, and it counts `fewest` occurrences.

   Rule flags compare rule profiles first. The stage directive then ranks parses with the greatest rule profile. Its `greedy` and `lazy` comparisons use bottom-up actions, while `late-elision` compares elided terminators (see "Ambiguity" below).

5. The stage emits the next stage's tokens. Each has text, value, image, tags, and source metadata. A value is the string that comparisons read. An image is the string that people see. Attachments are tokens owned by another token and unread by later stages.

6. The pipeline runs the stages in order, and stops at the first rejection or error.

`tests/engine/` tests the specification. Each case is a small grammar, an input, and a pattern that the canonical result JSON of `docs/output.md` must match. So a fifth implementation can run the cases to make sure that it follows the specification, without the Lojban grammars at all. The cases cover every specification rule, with one or more cases per rule. They settle the edge cases that decide which parse comes out, so that the Lojban corpus does not become the specification by accident:

- A tie is an error (`ok` is false) of kind `ambiguous`, with the reason `tie`. The stage has the verdict `tie` and a witness, and the error has two readings. The first reading is the least in a total order, *T*, that breaks the ranking's ties by canonical keys. The second is the tied derivation that diverges from the first earliest (engine §6). *T* orders the ambiguity diagnostics. The canonical tie-break keys never turn a tie into an accepted reading.
- The witness of a tie is the pair of actions at the first visible difference between the two readings. A close of a helper rule, or of an alternative with one logical symbol, is transparent (not visible). An earlier difference at such a close does not decide the witness. If the two readings have no visible difference, the witness is the pair of actions at their first difference.
- A stage with a tie emits nothing, and the pipeline stops there. Its tie stands even when every tied derivation emits the same tokens. The stage is ambiguous as written, and the error lets a grammar author fix it. The engine cases include a three-way tie and a tie whose derivations emit the same tokens.
- The cases cover empty spans and cycles: rules that can match no tokens, empty captures and a condition on an empty span. They also cover a unary cycle of `a` to `b` and `b` to `a`. Another case is a nested parse asked about its own span as the same rule. Each case has its defined outcome.

Every span and every source range in a result is half-open: the range holds its start but not its end. Source positions count Unicode code points, not bytes or UTF-16 units, so that the four languages agree on non-ASCII text. Each library converts at its edge (JavaScript from UTF-16, Go and Rust from UTF-8). The libraries derive line and column in diagnostics from code points. Lines split at `\n`, `\r\n` and `\r`.

A token's `span` is a range of the previous stage's tokens. Its `source` is the smallest range of the original text that holds the sources of those tokens. So the source is contiguous even when some of those tokens emitted nothing, as an erased word inside a compound does. A token inserted by an emission clause has an empty span, and an empty source range at the position where it was inserted. Its provenance is that emission: its `insertedBy` records the rule whose clause inserted it.

A verbatim image recipe can include adjacent text that no input token covers. It never changes source or text metadata. A constituent's image can extend beyond its source interval. An enclosing source-text recipe limits the token's image to its own source interval.

Following `span` from stage to stage explains any token of a stage's output. The chain ends at the characters, or at a token with an empty span. An inserted token ends it at the rule in its `insertedBy`. A token over a part that read nothing has an empty span and no `insertedBy`. An attached token has no `span`, so its chain ends at the stage that attached it. Its `source` still gives its place in the original text.

## Values and images

Stage zero decomposes every text. So a precomposed letter and its decomposed form read alike.

A value is the token string that comparisons read. An image is the token string that people see. Tags classify tokens independently of these strings. A constituent is one occurrence of a matched rule. It stores tags but neither string.

These separate channels let a grammar preserve spelling while comparing normalized values. For example, a stressed vowel can have value `a`, image `A`, and tag `Stressed`. A syllable comma can have an empty value, image `,`, and tag `Syllable-Break`.

The engine only concatenates strings. It assigns no meaning to pauses, stress, commas, phonemes, or quoted text. A grammar owns every mapping and spacing decision. This keeps a dialect's language policy visible in its documents.

Stage zero, named `input`, supplies one token per decomposed scalar. A scalar value is a Unicode code point outside surrogates. Both token strings start as that decomposed scalar. The configured Unicode tables supply complete stored scalar profiles. These include all supported properties, independently of grammar references. Later stages only forward or filter those engine tags.

The pinned inventory includes 56 binary properties, 25 enumerated or catalog properties, and multi-valued Script_Extensions. General categories accept compact and qualified forms. Other tags accept all-long or all-short spellings, such as `_Script_Latin` or `_sc_Latn`. Mixed forms are errors.

The reader normalizes every property to its long name, including atomic and major general categories. The generator rejects collisions between different tag identities, including case-folded collisions. Names, string mappings, numeric values, deprecated properties, and contributory exception lists stay outside the inventory.

The core file owns categories, combining classes, whitespace, and two emoji properties. A separate properties file owns additional classifications. The generator resolves UCD defaults, including unassigned regions and Script_Extensions fallback. A missing property is unavailable, rather than false. Grammar references to it fail during loading.

Libraries can share immutable scalar profiles. They do not copy a property set onto every token. Generic set operations and output still see every retained membership. A property reference in a later stage never changes initial profiles. Engine §1 defines the performance gate for dialects naming no additional property.

A class is a tag with capital letters at both ends. It never starts with `_`. This identifies `KOhA`, `BRIVLA`, and `FOREIGN` as classes while leaving `Word` and `Run-Final` as marks. Renderings use this same definition for attachments.

## The notation

Grammar authors write gencmu's grammars in jbogenbau, a notation of its own. `docs/notation.md` explains it for grammar authors. This section gives the summary and the reasons.

A jbogenbau grammar is an attribute grammar (its constituents carry computed values) with EBNF (Extended Backus-Naur Form) rule bodies. Each rule body is EBNF in the form that CLL (*The Complete Lojban Language*) prints. Each constituent carries tags computed from its parts. Tree patterns, which test a constituent's structure, also contribute finite observations during recognition.

Conditions over the parts, such as whether a part also parses as another rule, restrict which parses exist, as in a Boolean grammar. A rule can say what its constituents hand to the next stage. So each grammar is a transducer (it reads one token sequence and writes another), and a dialect is a pipeline of them.

The bodies keep the look of CLL's EBNF, because a reader of CLL recognizes that look. Keywords around the bodies name their functions explicitly.

A grammar document is Markdown. Its fenced `jbogenbau` blocks, in order, are the grammar, and the prose between them explains it. The loader finds only the fences by lines, as Markdown requires. Inside a block, line breaks and indentation mean nothing.

A rule is a keyword, its optional flags, its name and its body, followed by its clauses. Each clause is a keyword and what it says. A rule ends where the next item begins: a rule, a directive, a constant, a classifier or an implication. So a rule needs no terminator, and nothing is recognized by its position on a line:

```jbogenbau
%rule term-connective
  | joik 🆓
  | jek 🆓
  | ek 🆓
  | VUhU 🆓

%rule vowel-group-joined
  vowel-group<Syllabic> $v:joined-vowel<Syllabic>  :: $v.tags

%rule joined-vowel
  $v:vowel  :: $v.tags
%emits
  ε :: ∅ := "'"
, $v
```

Only `|` and `&` in bodies, `∪` and `∩` in terms, and `∧` and `∨` in conditions can also stand first. A list can therefore put one item on each line. The commas of a clause's list can stand first too.

A stage reads its input with one grammar. The loader assembles that grammar from one or more documents, read in order. `%rule` defines a rule, and is an error if a rule of that name exists. `%redefine-rule` replaces a rule defined before it in the stage, and is an error if none was. `%extend-rule` adds alternatives to a rule defined before it, and is an error if none was.

`%rule(leftmost-longest)` and `%rule(fewest)`, and the same forms of `%redefine-rule`, declare a flag. Extensions inherit it, while a redefinition without parentheses removes it.

So an accidental override never passes silently, and a replacement says so where it is made. A misspelled name in a replacement, an extension or a reference is an error. A misspelled `%rule` defines a rule that nothing reads, and the audit (see "Diagnostics and debugging") reports it. The loader also reports every replacement and extension: which document changed which rule. So a reader can see the effect of a dialect on its base in one place.

The notation has no way to remove a single alternative. A rule is small enough to restate, and a restated rule reads better than a list of deletions.

A parameterized rule is a template with load-time arguments. `%rule pair(@Left, @Right)` declares its parameters, and `pair("a", "b")` calls it. The opening parenthesis follows the name directly. A template and an ordinary rule never share a name.

The loader substitutes parsed nodes without changing grouping. `(BIhE 🆓)` and `ε` each pass one sequence argument. Only query-target choices and explicit requirement lists splice into their corresponding lists. Arguments cannot read captures.

`%rule named-pair = pair("a", "b")` names one instance without adding a wrapper node. Other instances use canonical call spellings everywhere that a rule name appears. Templates and instance edits apply in source order. A later template redefinition replaces earlier local edits. Flags apply to actual instance constituents, without an extra ranking tier.

A later binding can move a public name to another instance with `%redefine-rule NAME = CALL`. The old instance keeps its edits and takes its canonical name. Ordinary rules and named instances keep declaration slots, followed by unnamed instances in discovery order. Numbering, reference checks, rule traversal for diagnostics, and audit lists use that expanded order.

Patterns can name a whole template family, while queries must name an exact instance. A static parameter-flow analysis rejects cycles with argument growth. Diagrams show templates and calls, and the audit lists instances and their effective edits. Engine §2.3 defines these rules.

A stage can also name a value, such as a list of classes that several rules test. `%const $SU-STOPS NIhO ∪ LU ∪ TUhE ∪ TO` defines the constant, and `%redefine-const` redefines its value, which can use the preceding value. So a dialect extends a list in one place, and does not restate every rule that tests it. The loader gives each constant its value when it stitches a stage. So a document that several dialects include takes the values of each, and a cached DOM holds no value.

A stage can also give exact values their classes with a classifier, such as a lexicon. `%classifier lexicon` lists entries such as `"mi" "do" ∈ KOhA`, and `∉` removes a class. A gate can guard an entry, so a feature can change the class of a word. `$c.value.classify(lexicon)` gives the classes of the word `$c`. A classifier's value depends on the features, so a stage resolves it for the features of each parse.

`%implies UI ∪ CAI ⟹ Indicator` says that each token that the stage emits with `UI` or `CAI` also carries `Indicator`. So a lexicon says once which classes are indicators, and not on every word.

The dialects use these extensions and classifiers. A script document adds its letters to the rules of the phoneme grammar with `%extend-rule`. A word family is a set of word forms that dialects use, such as those of CLL. Its documents add those forms to the stage that divides the text into words. The experimental syntax is a layer over the CLL syntax. It restates the CLL rules that it changes, and adds rules of its own.

The Zantufa syntax is a grammar of its own. Zantufa 1.9999 restates almost every rule of camxes, a PEG grammar of Lojban. So the gencmu grammar translates the Zantufa rules one by one. It uses small rules for the conditions that state the lookaheads and ordered choices of the reference.

A capitalized tag name is a terminal that reads stored membership. Strings and string constants read exact token values, including at stage zero. Scalar ranges such as `"0".."9"` read one-scalar values. Engine tags such as `_General_Category_Letter` read stored Unicode properties.

User tags use capitalized names, such as `Cmavo`, `Stressed`, and `PAUSE`. Stage zero assigns reserved Unicode property tags. Later stages forward or filter them but never introduce them. Tags never assign a token's value or image.

A reference or terminal can carry one signed tag test followed by one exact value test. `LA="la"` compares its input value with that string. `cmavo<¬UI>` forbids UI on its own tags. Tests cannot replace token classes. A token that a caller supplies can have value `la` and tag `Word` without LA. `cmavo<¬UI>="la"` requires both tests.

The body adds repetition, elidable terminators, and ranked choices to the CLL operators. "Repetition, lists and chains" and "Elidable optionals and captures" below say why. The operators are these:

- Juxtaposition is sequence.
- `a ≻ b` ranks `a` first over the same span.
- `[x]` is optional.
- `{x}` is one or more, and `[{x}]` is zero or more. `{x / s}` is a separated list.
- `{... x / s}` is a left chain, and `{x ... / s}` a right chain. A chain, like a list, can leave out `/ s`, as in `{... x}`. A chain is the whole of its rule.
- `[+T x]` is an elidable optional, which begins with the terminator `T`.
- `A & B` reads `A`, `B`, or both, in order. An `&` expression has at most 16 items.
- `( )` is grouping.
- `ε` is empty.
- `f?` and `¬f?` are gates, and `f!` is a warning. These are the feature guards on an alternative (see "Gates and warnings").
- `$x:symbol` is a capture, and `$` is the whole constituent. A capture can stand anywhere but in braces and in an elidable optional.

Rule names include single emoji scalars with `Emoji_Presentation` and without `Emoji_Component`. The grammar's Unicode version fixes this set. Other identifiers keep their ASCII rules. `#` starts a pattern, `@` starts a parameter, and `/` separates brace items from separators.

`🆓` is not built in. It is a rule that the grammar defines as `[{free}]`, as CLL's EBNF defines it with `[free ...]`. So the free modifiers of one slot, such as vocatives, are one node of the tree.

An elidable terminator is a closing word that the speaker can leave out. This notation writes `[+KU]` for an elidable `ku`. `[+KU 🆓]` also puts its free-modifier slot inside the optional. The `+` marks omission at that position (see "Elidable optionals and captures" below). This grouping follows CLL's printed grammar.

So `xy. xi ky.` (CLL example 17.38) needs `xy. boi xi ky.` under the printed grammar. CLL's official parser needs it too. The grammars that allow free modifiers after an elided terminator, as the camxes family does, write `[+KU] 🆓`.

A `::` clause assigns tags on the definition header or after an alternative. The two terms union when both exist. A tag has no strength: a constituent carries it or not. Bare tag names can form one union atom, as in `UI CAI Indicator`. Other atoms require explicit set operators. Headers with clauses require a leading alternative bar.

`%conditions` lists conditions over the captured parts. Each condition applies to the alternatives that capture what it mentions. The recognizer evaluates it as early as it can. Within one condition, `∧`, `∨` and `⟹` are logic, in that order of precedence, grouped with parentheses.

`%emits` lists output items in order, with optional tag, value, and image clauses. `%erased` emits nothing and excludes counted input parts. An unlisted symbol remains a part of a covering token. An inserted item uses `ε` with an empty span. Emission and string reconstruction use separate walks, described below.

A captured item can also carry attachments, captures in parentheses before or after it, as in `($b) $w ($a)`. The tokens of an attachment belong to the item's token, and no later stage reads them. So the indicator stage keeps `ui` and `ba'e` visible on the word that they modify, without an indicator slot after every word of the syntax. A later stage forwards the attachments with the token, and the renderings show them.

The syntax reads leading indicators itself. They stand at the start of a text or after a quotation opener such as `lu`. In such a run, the indicator stage attaches only `ba'e`, to the indicator after it. A `nai` after an attitudinal stays a separate token there. The syntax reads `UI NAI`. In a run after a word, the `nai` attaches to its attitudinal instead.

A single-run payload is one raw run after a quote marker. Its constituent image recipe requests `$.verbatim-text` to preserve original spelling and adjacent uncovered characters. Its quote reads the payload's `.emitted.image`. Recognition still observes input values and tags. A covering compound also receives the quote's image recipe. The engine supplies no foreign placeholder value.

The grammar chooses its own foreign-run class. FOREIGN marks a run that the pipeline cannot divide into words. Phonemes gives a non-Lojban character run its exact character values and images. Forms gives an unsegmentable run its decomposed source text as value and concatenated phoneme images as image. Zoi delimiter conditions therefore compare ordinary exact values in both cases.

Each finished quote emits one token of its opening class. A delimited quote takes its image from the whole source interval. An undelimited quote joins the opener's source text, its original gap, and its verbatim payload. Images retain original case, spacing, and hesitation. Values join input parts through the word grammar's spacing recipes and omit ordinary hesitation. Syntax reads one terminal, and the tree of the words stage retains its internal structure.

An ordinary word can have a normalized image, such as `sIndarin` for `SINdarin`. Its quoted spelling remains `zo SINdarin`.

The [Magic Words proposal](https://mw.lojban.org/papri/Magic_Words) says that `y` is not a word and counts as whitespace. Ordinary hesitation contributes no word or normalized value. A quote image preserves that whitespace's written spelling, such as `.y.`.

An empty zoi body uses empty concatenation.

A clause can refer to a capture that some production lacks. A production is one expansion of an alternative, with one branch of each choice and each optional read or not. Lowering decides such a clause before the recognizer reads any text. A condition or an emitted item then does not apply to that production.

A tag term is an error unless it is guarded, as in `($c ⟹ $c.value.classify(lexicon))`. The reason is that a tag term has no value that can mean "nothing to say". A clause that applies to no production, or a capture that no alternative captures, is an error.

Directives are keywords too, and can stand in any block.

`%ambiguity-resolution` says how the stage chooses among the parses that share the greatest rule profile (see "Ambiguity"). Its first operand is the ranking rule: `greedy`, `lazy` or `late-elision`. `elision-only` can follow it. Every stage must have exactly one, in any of its documents. A stage with none or two is a load error that names the stage.

No directive lists the elidable terminators. An absent elidable optional, `[+KU]`, appears in the tree as its terminator, elided at that point. `elision-only` restores these terminators.

By convention, a directive stands in its own block. The preceding prose explains why the grammar needs it. gencmu does not enforce the convention.

The notation is self-hosting: it is itself a dialect of two stages. A lexical grammar reads characters into notation tokens, and a syntax grammar reads those tokens into a document tree. Both grammars are in `grammars/notation/`, and both are written in the notation. `docs/notation.md` explains the notation, and these documents define it.

The bootstrap supplies the grammar needed to read the notation. The DOM of the notation grammar is checked in as `grammars/notation/bootstrap.json`. Every library loads it to read every grammar document, `notation/` included. CI makes sure that the fixpoint holds: reading the notation documents with the bootstrap reproduces the bootstrap exactly.

A maintainer changes the notation in its documents, and `tools/sync.js` regenerates the bootstrap from them. In each library, three steps of the reading are written by hand:

- The search for the `jbogenbau` blocks of a Markdown document
- The walk from a document tree to its grammar objects
- The checks of the restrictions that the grammar of the notation does not state

`docs/engine.md` specifies the search (§8), the walk rule by rule (§9) and the restrictions (§9).

Grammar authors get the same diagnostics for a malformed grammar as for a malformed Lojban text. The playground can also show how a grammar document parses. The cost is load time. The bundled Markdown grammar documents total about 750 KiB, including prose and diagram links. A character-level stage reads these documents quickly in Rust and JavaScript but slowly in pure Python. So every package ships, beside its grammar copy, the DOM of each bundled document as JSON.

The key of a DOM always has five parts:

- A hash of the document's text
- A hash of the bootstrap that read it
- The version number of the DOM format
- A fingerprint of the core Unicode table
- A fingerprint of the properties file, or `null` for a custom core without a companion

A document that loads names data also requires the paths and fingerprints of its selected standard and extra files. Core abbreviation escapes need only the core-table fingerprint. Numeric-only documents have no names-file dependency. The `bundledNames` registry supplies fingerprints for unoverridden bundled resources without names-file reads. Overrides require loading and inspecting the complete selected set. A change to a required fingerprint misses the cache.

A library reads a document through the notation grammar only on a miss. In practice, that happens only for a grammar that someone wrote or edited. The playground caches the DOMs of edited documents in the same way. CI makes sure that the shipped DOMs match a fresh reading, and the tests of every library include forced cache misses.

The fixpoint alone proves only that the notation reads itself consistently. So `tests/notation/` also holds direct cases, run by every library: small documents with their expected DOMs and their expected errors.

## Phoneme values and stress

The [dialect guide](dialects.md#phoneme-values-and-stress) owns the bundled stage list and phoneme mappings. The engine concatenates stored values without a separate normalization policy. A script extension controls its own tags and image recipes. Phoneme fixtures must cover the grammar's declared tags and images.

## Two walks and recipe placement

A recipe supplies one string channel. `:=` supplies a value and an implied image. `:-` supplies an explicit image. Recipes can stand on an emission item, alternative, or definition. Their precedence belongs to [engine §11](engine.md#11-emission).

The emission walk determines which tokens reach the next stage. A constituent with `%emits` emits its items and stops that walk. `%erased` contributes nothing. Without either directive, the walk enters children.

The string walk determines a covering token's value and image. It enters child constituents but skips their emission lists. Their alternative and definition recipes still apply. Erased children contribute nothing. Attachment ownership counts surviving input parts independently of either string.

An item recipe serves its directly emitted token. The following grammar gives `x` for input `a`, but `ab` for input `ab`:

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

The following grammar gives `x` for input `a`, and `xb` for input `ab`:

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

The child definition recipe serves both walks. A recipe that must apply inside a parent belongs on the child alternative or definition. The [dialect author guide](dialects.md) uses this rule for quote bodies and gaps.

Recipes use a closed string language. They join literals, string constants, and seven captured string methods with `++`. They cannot branch, inspect tags, split strings, classify words, or start queries. This keeps emission independent of recognition and makes channel dependencies explicit.

Only requested selected recipes run. `.emitted` reads a constituent before the current item's override. Cross-channel reads can terminate through an explicit recipe. An effective constituent channel that depends on itself causes a document cycle error, even when an item overrides its runtime string. Engine §11 states occurrence identity and suppressed dependencies.

## Pauses and spacing

A Lojban phoneme grammar marks a pause with `PAUSE`. A quiet pause carries only a spacing boundary. A material pause preserves punctuation or ignored text.

A quiet pause has value and image `" "`. Material pauses keep decomposed source values and original source images in the phoneme stage. The forms stage gives every pause the value of one space. Raw quotes recover punctuation from source text.

The engine never trims edges or merges repeated spaces. Rules that form a covering token express each surviving gap's contribution.

A gap is a run between lexical parts. A quote gap excludes erasures because quoted `si`, `sa`, and `su` are words. A compound gap retains erasure-aware recognition. These two contexts share a spacing policy but require separate recognizers.

Quiet pauses preserve the period classification of the phoneme grammar through forms. `Period-Initial` marks a core that starts with a period. `Period-Only` marks a core of periods without whitespace or ignored characters. Quote boundaries read these tags instead of punctuation spellings.

The gap-tag invariant states how recipes receive decisions. A fact that a recipe cannot branch on travels upward as a tag. Grammar prose names where that internal tag starts, which rules forward it, and where it ends.

`Gap-Pause` means that a constituent contains a surviving pause. `hesitations` and `spacing` introduce it. `erasures` and `skipped` forward only surviving occurrences. Gap rules and `su-survivor` read it. Erased children never supply it.

`Trailing-Pause` means that a survivor's compound contribution ends with one space. `su-survivor` introduces it and `unit` forwards it. `lerfu-word` and `zei-compound` consume the state without forwarding it. The following BU or final ZEI word ends the state.

This classification preserves recognition alternatives instead of replacing them with an any-of pair that can overlap. Each fixed skipped derivation enters one gap alternative. Internal erasure ambiguity remains available to the ranking.

## Verbatim text

Verbatim text is original spelling with adjacent uncovered punctuation. `.verbatim-text` supplies it only in recipes. `.source-text` reads the covered source interval without that extension.

```jbogenbau
%rule zohoi-payload :- $.verbatim-text
  | payload-token
  | zohoi-payload payload-token
```

The payload's outer image recipe replaces recursive descendant image contributions. Value concatenation still reads input token values, including FOREIGN values from decomposed source text. A quote composes its image from the opener, original gap, and payload's `.emitted.image`. A covering compound receives that quote image. Forwarding stores the result and never reconstructs it from later neighbors.

An empty delimited body contributes empty concatenation to the quote value. The complete delimited quote uses its source text as its image. A foreign character run in the phoneme stage takes its source text through an image recipe. Its image keeps the original spelling.

The image extension does not enlarge `source` or `text`. This lets quote punctuation appear without changing source provenance. Different evaluated spans cannot claim the same uncovered text. The conflict rule avoids any hidden priority between touching quoted parts.

## Repetition, lists and chains

CLL writes repetition as `x ...`. Note 7 of CLL 1.1 section 21.1 says that `...` implies left grouping. gencmu uses braces to distinguish a flat list from a grouped chain.

Flat braces, `{x}` and `{x / s}`, read a list. The tree shows the items and separators as children of the rule that writes the braces. Most repetitions are lists, such as terms, digits, and sentences. Flat lists show those parts without nested wrappers.

Chain braces, `{... x / s}` and `{x ... / s}`, show left and right grouping respectively. A chain can omit `/ s`. Each level is a node of the chain's rule. A chain is the whole rule, so each level includes its first operand. A helper inside an alternative cannot group a first operand that stands outside it.

Braces state grouping explicitly, independently of how many alternatives feature gates leave enabled. As a result, a feature cannot silently change the grouping of an otherwise unchanged rule.

Every kind of braces requires one or more items. ISO 14977 reads braces as zero or more, but jbogenbau writes zero or more as `[{x}]`. An item must read at least one token, so `[{x}]` reads nothing in one way only. No bundled grammar repeats an item that can be empty.

A capture cannot stand inside braces or around them because a repeated part has no single captured occurrence. A grammar that needs a capture names its list or chain as a rule. A capture next to flat braces remains legal, as in `$a:A {B}`.

The engine defines these rules in §3:

- A flat list is a helper. The `greedy` and `lazy` rankings do not observe its prefix ends. A rule's conditions do not apply to each list prefix. A grammar that needs those prefixes uses a chain or explicit recursion. The notation's lexical `text` rule uses explicit recursion to expose token boundaries.
- Each chain level sees its rule's clauses and has its own `$`. A warning on the alternative gives one warning per level.
- A right chain differs from `x [s r]` at its single-item level. An elidable suffix adds an omission absent from the chain. Their elision counts can therefore select different readings. A single-symbol chain item can forward tags, while the suffix form has two logical symbols. Query priority also uses their different preceding logical symbols.
- The operator chain of `mex` and connected abstractors of `tanru-unit-2` have their own rules. Each level holds its first part. A single abstractor with `nai` or free modifiers forms its own group.
- A chain adds a level over a single item, such as `selbri-3` over one tanru unit. The bracket renderer collapses that level because it has one child.
- A sequence such as `x [{y}]` contains a helper as well as `x`. It does not inherit the tags of `x` under the single-symbol rule. A `number` therefore does not carry the word tags of its first `PA`. The same applies to `lerfu-string`. No condition reads these tags.

## Elidable optionals and captures

An elidable optional permits an omitted closing word. A grammar marks each elidable optional locally, as in `[+KU 🆓]`. A plain optional, `[KU 🆓]`, is never elidable. The marker states the meaning without a directive in another document.

A marked optional has one form, with a user tag or parameter directly after the marker. A parameter must become exactly one bare user tag after argument conversion. A group there, even `[+(KU) 🆓]`, is a document error. This gives one spelling for readers to inspect. A DOM does not preserve groups, so its reader tests only the normalized form. A wrong test on a terminator is also a document error.

An omission has an elided node and contributes to its boundary's elision count. It does not record which constituent it closes. `elision-only` reconstructs its defined routes and preserves the exact value saved by an equality test. Query blockers instead read the preceding logical symbol, with plain optionals retained as helpers.

A capture can stand anywhere except inside braces or inside an elidable optional. An alternative expands into productions, one per choice branch and subsequence of `&`. A plain optional with a capture expands into productions with and without the capture. A capture can therefore be present in some productions and absent in others.

Presence tests and `⟹` guards handle missing captures. Conditions and emission items that require a missing capture do not apply. Tag terms must guard a missing capture or cause an error.

Optional captures express combinations without separate alternatives. For example, `[$b:bahe-run] $w:unit [$a:indicator-run]` expresses `$w`, `$b $w`, `$w $a`, and `$b $w $a`.

Every plain optional retains one logical helper for interpretation. Physical expansion of captured optionals only binds their captures. Elidable helpers preserve omission records and restoration routes and cannot contain captures. Ranking, inheritance, ranked tag safety, and query priority use the same logical helper structure.

A capture wraps one symbol because it names one constituent with one span and one tag set. A group or optional is not a constituent. `$x:[a]` adds nothing to `[$x:a]`. `$x:(a | b)` needs a named rule, as a list does.

A name occurs at most once per production. Two choice branches form separate productions. Thus `A ($x:B | $x:C)` is valid. `[$x:A] $x:B` and `$x:A & $x:B` are errors.

The loader detects duplicates before gates apply, so features cannot hide an error. It also tests emission order and attachments per production. Each production reads its parts in one order.

The notation sets no fixed limit on captures. A captured span before the dot forms part of an item's identity. The recognizer keeps items distinct when their captured ends differ. Each unfixed capture endpoint can multiply a production's items by up to `N + 1`, where `N` is the input length. A span with two unfixed endpoints can therefore contribute quadratically many pairs. [Engine §4](engine.md#4-recognition) defines this cost.

## Backward queries

`.preceding-tokens` returns original tokens from the current context start to the receiver's start. `.last-token` then names the preceding token. Nested queries cannot see before their own context start.

`.ends(R)` recognizes suffixes over one fixed window. Every suffix candidate retains that window as its context. The method preserves ordinary query eligibility and errors. A restored `.ends` receiver causes a load error. Restored suffix queries can be added when a grammar needs them.

Shareable suffix queries cost one recognition starting the target at every position, plus constant work per request. Sharing uses the target and window start. Complex targets can cost more than linear time. Targets that read a window end require separate recognition for each distinct end. Use `.ends` sparingly. Engine §4.4 defines sharing and window-end dependencies.

## Structural pattern implementation

A tree pattern tests a constructed constituent without recognizing its words again. The grammar uses `#` literals and `≅` or `≇` conditions. A node test names one node, and an adjacent `« »` list constrains that node's children. A bare list constrains the children. It gives the parent no name. `_` retains its terminal identity.

A child list requires a rule test, template family, or call. A compatible parameter can supply that test. Terminals and tested atoms cannot carry child lists. Separate items require whitespace or comments before `«` or `·` after a node test, `»`, `]`, `}`, or group `)`. A call's adjacent first list remains attached.

Each node test searches through sole children by default. The prefix `·` makes only its own node exact. Child items retain their own searches unless they carry `·`. The name and attached child list must hold at the same visited node. Separate set operands can hold at different depths of the candidate's sole-child chain.

Child lists contain sequences, choices, optionals, repetitions with `/` separators, and sibling gaps. Parentheses only group and never create a subtree boundary. Paths and sets combine whole patterns. Branches, omitted terminator leaves, and ranked seals preserve structural boundaries.

The pattern DOM stores child sequences as arrays. Empty and singleton child lists retain their guillemets in canonical spelling. The schema accepts exactly the reader's shapes, apart from source positions. Unresolved parameters preserve the distinction between whole patterns and child items. They never relax the surrounding field or sibling-gap rules.

Pattern unions and intersections flatten operands of their own kind, including after substitution. Node decorations are exact prefixes, tests, or child lists. Keys preserve order, duplicates, node decorations, and child boundaries.

The ordinary reader decodes the printer's single-guillemet escapes and gives the same key for every valid printed pattern. A rule-test name that reads back as a terminal under the loaded Unicode table is invalid. The same requirement covers nominal rule arguments inside pattern calls. Pattern literals hold decoded strings through the DOM's `literal` form. User constants use `constant` instead.

All user constant references use final stage definitions. A redefinition's own lexical name instead uses its immediately preceding definition. A graph of immutable versions permits forward references and detects cycles, including cycles through replaced definitions. Composite patterns therefore observe dialect overrides without copied declarations.

A demanded pattern is one that a condition reads. A structural state records a candidate's pattern answers. The recognizer compiles demanded patterns into finite structural states. Items retain prefix states, and captures retain completed states alongside spans and tags.

A packed edge records one way to build a node. These edges keep correlated answers for one candidate. Equal observation states still retain distinct derivations.

A summary combines the derivations of one item. Its cycle context records ancestor rules over the same span. Ranking summaries retain that context. Ranked admission keeps eligibility and cycle contexts separate. A structural-state change does not bypass rule-and-span cycle exclusion.

Reconstruction observes each candidate's structure projected onto original tokens. Restored helpers contribute omitted markers, while ordinary synthetic reads contribute no observable leaf. Pattern value and image remain empty on omitted markers. Body tests instead read synthetic recognition values. Every omission must pass its test on its exact restoration value before recognition admits it. This rule preserves the witness for inequality and tag tests without inventing values or tags.

A seal is an opaque leaf that hides ranked content.

Grammar DOM format 40 stores method expressions, string terminals, recipes, unresolved constants, patterns, and ranked groups. Structural states remain internal. Result format 15 exposes value and image and reports the restored selected witness first in elision-only errors. No ranked seal is serialized in a tree or DOM.

A summary context is the cycle context of one summary. Measurements record structural states, chart items, packed edges and summary contexts alongside elapsed time and peak memory. Increasing list length, unary depth, nested omissions and independent ambiguous children expose product-state growth. Finite sharing can still require exponentially many states.

## Ranked choice design

An isolated reparse can disagree with the constituent that the parent actually builds. Queries about one span lose its surrounding prefix, eligibility channel, and ready gates. They cannot establish an actual replacement at that written position.

A preference relation over complete readings combines with elision ranking into comparison cycles. A local filter avoids that combined relation.

An inline ranked choice states its position and category order together. It requires one common prefix and suffix because the author writes them once.

Every option supplies its actual qualified constituent or sequence. A failed higher gate leaves lower options available. One seal hides each completed option's children from outside patterns. Ready private conditions still observe their real captured constituents.

The local tag closure prevents hidden option tags from changing the common continuation. Private captures cannot escape into later conditions, tags, or emissions. Common prefix captures retain one written binding.

An open literal records an unsettled boundary condition. An offer records a boundary target that a derivation can satisfy.

A higher option excludes a lower proof when its open literals are a subset at each edge and its offers are equal. Error annotations do not affect this comparison. Every proof that the filter excludes has an eligible replacement in its admission group. Sealing and the tag rule preserve that replacement's continuation. Induction preserves eligible recognition with sealing fixed. A seal hides option structure from outside observations.

The exact group key, tag closure, and algorithm belong to engine §2.1 and §6.1. [Ambiguity](notation.md#ambiguity) defines verdict changes and their effects on later stages. The ranker compares flagged profiles before the stage directive.

Reconstruction first locates the restored chosen derivation before filtering. Filtering compares spans that include restored terminators. It ranks admitted readings by projected profiles without a stage directive. Filtering can exclude the restored derivation and cause an `elision-only` ambiguity. The error reports that derivation first and the best admitted competitor second. Only its absence before filtering reports `elision-witness-lost` ([engine §7](engine.md#7-elision-only)).

Experimental ranks text-initial bodies, NUhI bodies, and NAhE before mekso-MOI and SE conversion. Its ME operands use ordinary alternatives with an aligned sumti query. Zantufa ranks whole MOI constructions, MAhO, and MOhE. Its fragments and ME operands use ordinary alternatives with aligned category conditions. In Zantufa, SE can begin a mekso through an operator, so the MOI group also includes it. FA and JAI cannot begin those mekso forms.

The ranked choices need no wrapper rules. `gek-termset-body`, `termset-with-nuhi`, and `terms-vau` keep their bracket groups, reuse, or capture.

Sealing remains an authoring limit. An outside pattern that needs hidden option structure requires an unranked position or an earlier local condition. Sequence captures remain unsupported. The fragment keeps `terms-vau` for its capture and `fragment-terms` for its aligned category query.

## Pipelines

A pipeline document is Markdown too, and literate. Each stage is a heading, followed by the list of documents stitched into it. Prose then says what the stage receives from the one before, what it does, and what it hands on. The machine-readable parts are pipeline directives in `jbogenbau` blocks. The notation reads them like any other directives, so no library reads Markdown structure beyond finding the blocks:

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

The basic declarations are these:

- `%stage NAME` starts a stage. `NAME` is what the API, the CLI's `--until` and diagnostics call the stage, whatever the heading says. Two stages with one name are an error.
- `%include "PATH"` stands for the rules and directives of another document, as if the text of its blocks stood there. `PATH` is its include path.
- `%features NAME…` before the first stage declares global defaults. After a stage selector, it enables features for that stage and later stages. A caller can turn further features on and can turn features off. If a conditional declaration holds for a feature that the caller turns off, the parse gives a `feature-conflict` result.

The link to each included document stays in the prose, so the pipeline reads as hyperlinked prose on GitHub. The bundled grammars keep a style for this. The block of each `%include` stands under a list item, indented to the item's text. The item's line has an inline link `[text](PATH)` to the same path. The style is not part of jbogenbau, which accepts an `%include` in any block. Only `tools/sync.js --check` enforces it, and only for the bundled grammars.

A link without an `%include` is ordinary prose, so a pipeline can link to CLL or to other dialects freely.

A library reads each document into its DOM on its own, as it reads any grammar. So every document must be complete rules and directives, and its DOM is cached as any other. The library then splices (engine §13). It reads the pipeline's items in order and recursively replaces each `%include` with the included items. It assigns the stream's stage items to the active stage selector. Every item keeps the document it came from, so errors and the audit still name the document and line that an author wrote.

The result is what textual inclusion gives. Stitching looks only at the order of a stage's rules, never at the documents that hold them (engine §2). A later rule can redefine or extend an earlier one wherever each was written. Stages run in the order they start, and every stage's start rule is `text`. Paths resolve against the including document, in the same way on disk, in memory and on GitHub.

A document can be included in several stages. An included document can hold stage selectors and `%features` too. So several pipelines can share a stage by including one document that holds it. A second `%stage` of one name is an error.

`%extend-stage` selects an earlier stage and appends subsequent items. `%redefine-stage` clears that stage's accumulated items and selects it for replacement. Both keep the stage's original execution position. Selection continues across includes, and replacement leaves global features and other stages intact. The loader evaluates only the final stage definitions, but it still reads every source document.

In dialects with punctuation pauses, a one-word foreign quote takes the next raw stretch between whitespace or period boundaries. A decimal point between digits stays inside its run. Punctuation and ignored characters belong to that body.

The Latin conventions expose punctuation as pause tokens tagged `Quote-Material`. Each token keeps the punctuation's source spelling as its image. Its phoneme-stage value keeps the decomposed punctuation. The [pause rules](#pauses-and-spacing) define its later normalized value.

Ordinary spacing still reads these tokens as pauses. One-word quote gaps and opening delimiter gaps cannot skip standalone material. Attached marks remain formatting. Other quote bodies keep their own spacing rules.

In BPFK, experimental and Zantufa, ZO also takes a standalone material stretch as its next word. Marks attached to a word stay with that word. The word `zei` rejects surviving punctuation on either side, whatever class its lexicon assigns. Other words of SI retain their punctuation spacing. Ignored comma-like characters remain spacing for ZEI.

Delimited foreign quotes also keep bodies that contain only punctuation. A pause separates the body from the closing delimiter. The first matching nonpause run closes the quote, including beside punctuation. The CLL family retains its strict punctuation rules.

## Gates and warnings

A dialect that extends another makes two kinds of change. Most are additions, which the base grammar rejects and the dialect accepts, such as `cu` before a bare selbri (a predicate) in the experimental dialect. Some change how the dialect reads a text that the base grammar accepts. An example is the cmevla-brivla merger, which lets a name word (cmevla) also act as a predicate word (brivla). Under the merger, `la .alis. klama` is one description. The notation has a kind of feature guard for each kind of change.

An addition is a warning, `name!`. Its alternative is there whether the feature is on or off, so turning the feature on changes no verdict and no tree. It only adds a warning to the result for each place where the chosen tree uses the alternative. The warning names the feature and the text.

The experimental dialect enables `experimental-cgv` by default for consonants before glides in names and borrowings. Forms marks those words with `Cgv-Warning`. The words stage warns when its chosen derivation reads a marked word.

Other bundled warnings require the caller to enable them.

A warning is on the chosen tree only. An addition that only a losing reading uses is not reported. A tie has no chosen tree, so it reports no warnings. The experimental syntax is a layer over the CLL grammar. Its syntax additions do not carry warnings. The bundled warnings are `y-cmavo` in cll-ebnf and `experimental-cgv` in experimental.

A change of reading is a gate, `name?`, with the base form under `¬name?`, so that exactly one of the two is live. A warning cannot express it, because a warning keeps its alternative even with the feature off. The base reading is then gone either way. A dialect that makes such a change can declare its gate as an unconditional default. A caller who wants the base reading can disable that default. Gates are also how a grammar keeps an expensive construct out of the parses that do not need it (see below).

A name is one kind or the other in a dialect. It is an error to load a dialect in which one guard uses a name as a gate and another uses it as a warning. Turning the feature on then means two things.

A caller selects features separately. The experimental dialect uses camxes-exp as its baseline. People adopt its extensions separately. Some people use the merger and some do not. A feature that composes with the rest by plain addition stays selectable on its own. A change that cannot be made selectable without a convoluted grammar is made unconditionally in the dialect's documents, and its documents say so.

## Expensive constructs behind features

The erasers `sa` and `su` reach back over any number of words. So the parser keeps a possible reach open from the most recent word of each selma'o (word class). It does not know whether a `sa` will come. A reach can run back to the start of the text, as an unmatched `sa` or a `su` does. Such a reach begins with a rule anchored there by `.starts-input`, so the parser reads it once.

The cost then grows in proportion to the text, but each word costs more. In JavaScript, a text of 13,700 characters takes about 22 seconds with the feature and 6.5 without it. These erasers are rare, so they are behind a feature, `sa-su`.

Any SA or SU input token activates the feature, including a token inside a quotation or an erased span.

The words stage declares `sa-su` with conditions on its input classes. It enables the feature when any input token carries SA or SU. Each stage parses once. A caller that disables a feature whose conditional declaration holds for the stage input gets a `feature-conflict` result.

## Ambiguity

Ranked choices filter parses allowed by recognition before ranking. The parses that survive are admitted. The engine ranks admitted parses by rule profile, first by `leftmost-longest` and then by `fewest`, and then by the stage directive. A parse is best if no other admitted parse beats it.

One admitted derivation gives `unique`. Several admitted derivations with exactly one best give `resolved`. Several best derivations give a tie with two readings and an action witness.

The verdict transitions and their effects on emission and the elision-only check are defined in [Ambiguity](notation.md#ambiguity).

[The notation guide](notation.md#ambiguity) defines `greedy`, `lazy`, and `late-elision`, including action comparison and elision vectors.

The reason for `late-elision` is that `greedy` decides more than CLL asks. CLL leaves one choice to the parser, the place of an elided terminator. `greedy` also decides every other choice of read against close, such as where a free modifier attaches. So it can hide an ambiguity of the grammar behind a preference that no rule states. `late-elision` decides only the place of elided terminators. Parses with equal rule profiles and equal counts at every position remain tied, and the grammar settles them with its rules.

The count composes by addition over the packed forest, the shared graph of all parses. So the engine never enumerates the parses (engine §6). It does not depend on the name of a terminator, its depth or the constituent that it ends. "Close an older construct as late as possible" describes some of its results, but the count has no record of which construct is older. It can trade an early elision of one terminator for an early elision of another.

The syntax grammars declare `late-elision` ("Syntax conventions" below).

The forms stage divides the text into words. The words stage applies the magic words, such as `si`, which act on other words. Both stages use `lazy`. Ordinary word forms divide a run in one way only, so `lazy` decides nothing in the forms stage outside the `ra'oi` exception below. In the words stage, a magic word acts on what exists when it is read.

A rafsi is a form used inside compounds. A gismu is a root word. Zantufa's `ra'oi` quote is the exception to unique word division. Its `leftmost-longest` flag selects the longest rafsi or gismu form within a complete reading.

### Rule flags

Rule flags state structural preferences independently of terminator policy. An atom is one independent grammatical unit. Intended uses include atoms such as `simple-tense-modal`. Flagging a broad rule such as `tag` also counts wrappers, nested groups, and chain levels. Those occurrences can favor a different grouping from the intended atoms.

The rule profile compares token spans, not reading and closing actions. For `r → r B | A`, action comparison can tie a longer outer `r` with a short one. Span comparison prefers the longer outer `r`. Presence and repeated occurrences count because each flagged occurrence expresses the declaration. Empty occurrences contribute nothing, so the flag does not reward empty wrappers.

The flag ranks first so an author can state grouping independently of terminator policy. Equal rule profiles leave the directive to decide. Extensions inherit the flag, while redefinitions replace it with their own declaration. This gives one authoritative declaration for the whole rule.

`elision-only` retains rule flags because they express structural preferences. If another reading has an equal or greater rule profile, the check reports ambiguity without replacing the chosen parse. Restored terminators add no width, so writing them back cannot lengthen a flagged occurrence.

With only `simple-tense-modal` flagged, `pu va ca gi` groups as `pu va` then `ca gi`, as the official parser does. The flag ranks complete parses. The official lexer instead groups tokens before syntax parsing. The notation's "Ambiguity" section explains the differences from POSIX subexpression semantics.

The notation writes `leftmost-longest` in parentheses after the keyword. The name states the priorities of earlier starts and later ends at one start. `fewest` favors absence. It counts occurrences and ignores their spans, because a disfavored construct has no natural position to prefer. So it composes by addition, as an elision count does, and it cannot form a comparison cycle.

### Ties are errors

A tie is an error of kind `ambiguous`, with the reason `tie`. The stage emits nothing, and no later stage runs. The error shows two of the best parses, and the stage shows the witness, the pair of actions at their first difference. A tied stage gives no warnings, since it has no chosen parse.

The canonical order, *T*, orders ambiguity diagnostics. Its canonical keys never turn a tie into an accepted reading. Production numbers follow the written order of alternatives. Using those numbers to accept a tied reading gives source order an unstated preference.

An error is better than a hidden choice. A reader of the error sees the two readings and where they part. The grammar author settles the choice with a rule, and the rule says why. Every stage follows this, also a stage whose tied parses emit the same tokens, since the grammar is ambiguous there as written.

### Elision-only

CLL's own rule is narrower. It says only that a terminator can be elided if no ambiguity results. It says nothing of the other ambiguities that its EBNF has. `elision-only` is one reading of that rule, for the stage whose grammar declares it. CLL does not say which parse to test, so the check tests the one that the ranking chose. It applies the rule only when the ranking of that stage was `resolved`:

1. Take the chosen tree's `elided` nodes in leaf order, from left to right. This order follows the chosen derivation, also where several nodes stand at one point. For each node, insert a synthetic token before the stage-input token at the node's position. The synthetic token carries the tag of that terminator and, for a terminator with an `=` test, the test's string as its recognition value. The engine marks it synthetic.
2. Parse the token sequence with the same grammar. Use a mode where each elidable optional is restored or written. Every condition, tag and test of a rule reads the original input through a projection that leaves the synthetic tokens out. A test on a terminal reads the written-back terminator's tag and recognition value. A query parses the original input with the grammar as it is.
3. Locate the chosen reconstruction before filtering. Its absence gives `elision-witness-lost`. Filter the reconstructed forest, then rank by projected rule profiles without stage lean. The check passes only when the witness remains admitted and is the sole best admitted derivation.

   If the check fails, the ambiguity is not about terminators. The result is an error of kind `ambiguous`, with the reason `elision-only`, and `ok` is false. The error carries the readings that engine §7.10 names, shown over the original input. An intentionally excluded witness gives ordinary ambiguity, not witness loss.

The stage ranks, then emits, and then runs the check. A tie ends the stage before emission and before the check. So a stage reports at most one `ambiguous` error, and a tie comes first. A stage that fails the check keeps its output, but no later stage runs.

The two errors share their kind, because both say that the text has two readings. They differ in what the readings are. The readings of a tie are parses of the text as written. Those of `elision-only` hold terminators that the check wrote back. The stage's verdict, `tie` or `resolved`, already tells them apart. The error still carries its reason, so that the error alone says which it is, and the shared tests compare it.

The engine cases pin the definition with these cases:

- Two readings that elide different terminators, for which the check passes
- Two readings that differ with every terminator written, for which the check fails
- A text with its terminators written back whose only reading is the chosen one, for which the check passes
- Several terminators elided at one point

The recognizer retains the strictness of its items only for reconstruction (engine §7.4). The Rust library stores it only in that mode.

### Independent elision controls

`elision-only` parses again with the terminators written back. That can let another alternative match, or a test on a terminal read a written-back terminator. A ranking of the original parses sees neither. For example, take `text → a | b | c`, `a → A [+T]`, `b → A [+T] [+T]` and `c → A T`. On `A`, `late-elision` prefers `a`, with one elided `T`, to `b`, with two. Written back, `A T` parses through both `a` and `c`, so `elision-only` reports the text.

### Nested queries and elided terminators

A condition can query a whole span, prefix, suffix, or tag union with `matches`, `begins`, `ends`, or `tags` (engine §4). That nested parse sees every way to read the span, and an elidable optional can be left out anywhere in it. So a nested reading can rely on leaving out a terminator that the same construct reads in the actual text. A nested reading must not do that.

So every nested query follows written-terminator priority (engine §4). A nested reading cannot leave out an elidable optional where the same construct can read that whole optional as written. The query answers from the proof trees that remain. Several such trees are an ordinary success, never a tie. No option turns this priority off.

In the experimental dialect, `mi klama na to broda toi` illustrates this boundary problem. The nested parse of a condition reads `na to broda` as a negated selbri, with `broda` taken from inside the parenthesis. With priority, the brackets output is `(mi [klama {na (to broda toi)}])`. camxes-exp also puts `broda` inside the parenthesis after `na`, and it closes `na` with an elided `ku`.

The priority is a local commitment, not a proof that the shorter reading is impossible. Take `r → A c [+T] T` and `c → B`, on `A B T`. Without priority, `r` leaves out `[+T]` and reads the token as its last `T`. With priority, the token belongs to `[+T]`, so the query fails.

The window of an ordinary query is its span. A `matches` over a captured span does not look at a terminator written after the span. A `begins` with `.onward` or `.following-tokens` already sees the rest of the input.

A boundary atom reads the parse itself, so it has no window and no written-terminator priority. It cannot replace a lookahead whose rival starts at the same token, or whose target is no node of the real tree. It replaces a lookahead that only asks what the actual reading puts next.

### Queries with fixed closes

`$x.without-elision` restores the terminators omitted inside `$x` for a query that preserves those closes. A close records an omitted terminal and its boundary.

An elision is an omitted terminator. An aligned witness is a reading with the same closes. An ordinary query parses captured words afresh and can choose another omission boundary. A category condition sometimes needs the captured candidate's actual boundaries while it asks about another grammatical category.

The span method keeps `.matches`, `.begins`, and `.tags(rule)` queries. `$x.without-elision.matches(R)` compares the whole capture. `$x.without-elision.onward.begins(R)` permits a rival category that continues beyond it. The query can still inspect following original words. This context retains following-operator conditions and written-terminator priority.

Restored tokens record the constraint without creating additional mandatory words. A rival cannot read an omitted BOI as a bare required BOI. An omitted optional requires none of its remaining content. A prefix compares every close at its endpoint. These rules express a relation between original readings, rather than ordinary replay of completed spelling.

A seal hides a ranked group's content. Outside restoration observations retain an opaque block, so private closes cannot change its common continuation. A private capture inside an option keeps its own closes for ready conditions. This preserves the replacement guarantee of engine §6.1.

The span method requires observations from each candidate during recognition. Candidates over the same words can omit different terminators, and their queries can give different answers. Shared observation states preserve those distinctions without enumerating complete trees. Named-rule cycles use original spans, while active-query errors use the original context. Separate memo keys retain close groups, blocks, context, and features.

Engine §7 supplies synthetic tokens, saved values, provenance, and source projection. Reconstruction permits bare synthetic tag reads and forbids omissions throughout its input. An aligned query instead qualifies original readings and permits ordinary omissions after its fixed capture. It emits nothing and selects no replacement tree. No parse configuration switch controls this method.

A strict alignment misses one kind of rival. The rival reads a new construct inside the shared words, and that construct omits its own terminator. The candidate has no such construct, so the closes differ. In `le ke my .e gy ke'e broda`, the quantifier's forethought mekso omits KUhE, and the sumti has no KUhE to match.

An implicit rule for new constructs fails in two ways. Closes inside the shared words can be early closes of existing constructs, as in `my .e cy to roi klama`. And a rule that matches constructs by their named owners is fragile. Inlining one rule of the grammar changes its answers.

So the grammar names the permission. `.without-elision-except(family)` lets a rival add closes whose optionals a family's members own. Ownership is static, and the family is an ordinary rule. The grammar states the exception at the query and names the constructs at their definitions. The permission does not test that a construct is new. A grammar that names a family accepts every early close of its members that priority allows.

Permission marks belong only to the witnesses of a family query. A witness item keeps sets of deletion-test states, never marked closes. The number of such sets depends on the size of the candidate's close groups, so a larger candidate group can cost more work.

### Early closure and candidate ownership

A constituent is the text read by one grammar rule. A candidate is one constructed reading of a constituent. A pattern tests that candidate's actual children and boundaries. A query parses an input range again.

TO, SEI, and XOI bodies compete as ordinary constituents. Late elision selects complete readings with fewer omissions at the first differing boundary. A longer body usually wins when it leaves a complete reading. Written terminators retain their ordinary grammatical force.

Zantufa uses patterns and aligned category queries to remove duplicate constructions without moving the candidate's closes. Its following-input conditions reserve words after the selected constituent. In `cy to roi toi klama`, the aligned tag query keeps ROI inside the letter's written parenthesis. It cannot invent an outside ROI by moving TOI. Its [syntax comparison](../grammars/syntax/zantufa.md#early-closure) records the three early-close departures and their written-terminator controls.

### Where an elided terminator can fall

`elision-only` settles which reading a text has. It does not settle whether a reading that needs an elided terminator counts at all. CLL's rule, "if no grammatical ambiguity results", has three readings, and the grammar that CLL prints does not choose among them:

- The printed grammar, read literally, counts every parse: a terminator can be elided wherever a parse of the whole text needs it. `le lojbo se farvi le loglo gi'enai mintu ja dunli le logla` parses, with the description ending before `se farvi`.
- YACC is the grammar of CLL 1.1's official parser. That parser reads one lexeme ahead and never goes back. A lexeme is one word or one run of words that the parser joins. The parser elides a terminator only through the error recovery of its grammar, where the next lexeme cannot continue what it is reading. CLL's own explanations of elision describe this. That is why CLL 14.14 says that `le nanmu ku joi le ninmu` needs its `ku`.
- camxes-std commits too, but in another way. camxes-std provides an alternative. It reads as far as its rules permit before it elides a terminator. So `le nanmu joi le ninmu` parses. The `le lojbo` text above does not.

The cll-ebnf and bpfk dialects take the printed grammar as normative and keep the whole-text reading. So do the experimental and Zantufa dialects, which accept the most. Zantufa also uses ordinary early closure for TOI and SEhU. Its grammar document lists the three accepted departures from PEG commitment.

The cll-ebnf and bpfk dialects each name their reading in their pipeline documents, after they include the CLL grammar. A stage states its `%ambiguity-resolution` exactly once, so the experimental layer over the CLL grammar states its own.

The official parser's reading is not in the notation. Its lookahead is a lexeme, not a word. Step 5 of its preamble prepares the words for its grammar and joins runs of them into one lexeme. Examples are the connective `na ja`, or a number followed by `moi`. A rule that reads one word ahead over a stage's tokens sees the `na` of `le nanla na vrude` as the start of `na ja`. A word-level rule therefore does not express the same policy.

A dialect that reads as the official parser does needs that preparser as a separate stage ([issue 28](https://github.com/int19h/gencmu/issues/28)). The same preparser settles ambiguities that the printed grammar leaves open, such as a gihek or joik directly before `ke`. The CLL grammar settles these overlaps with a ranked joik choice and a gihek condition ("Syntax conventions" below).

Two connected sumti can also parse as connected terms in the experimental grammar. A sumti is an argument of a predicate. A term is a wider kind of argument that includes sumti. The experimental rule for sumti connections selects the sumti reading of `mi .e do klama` and `mi .e bo do klama`.

A parse option overrides `elision-only` either way. A caller switches it on to find ambiguities that are not about terminators in the supplied text, or off to loosen the CLL dialect. The rule itself (`greedy`, `lazy` or `late-elision`) cannot be overridden, because each rule gives a different language, not a variation. A lazy syntax and a greedy word grammar are examples.

### Syntax conventions

The syntax stages of the bundled Lojban grammars use `late-elision`. The `cll-ebnf` and `bpfk` dialects also declare `elision-only`.

The CLL grammar expresses the official lexer's `JOIK_KE` preference with a ranked choice. Its preferred option groups with `joik [stag] KE … KEhE`. Its plain option joins two units with `joik-jek`. The preferred option removes the plain reading only over the same span.

The choices stand in `selbri-4` and `operator`, where the readings overlap. So `mi broda joi ke brode ke'e` keeps only its reading through `joik KE selbri-3 KEhE`. Likewise, `li ci su'i joi ke pi'i ke'e re du li xa` keeps the operator's own `ke` group. Where only the plain reading parses, the grammar keeps it, as in `mi broda joi ke brode ke'e bo brodi`. The official parser rejects that last text.

The `sumti` and `operand` rules have a joik-plus-`ke` alternative too, but no competing alternative, so they need no ranked preference.

The dedicated form takes only a joik. So `mi broda je ke brode ke'e` has one reading, a jek before a tanru unit grouped with `ke`.

The CLL grammar also applies the condition that the official parser's lexer applies with `GIhEK_KE`, in the rule `bridi-tail-1-final` of the CLL grammar. The `ke` form of `bridi-tail` groups the tails after a gihek, as in `mi broda gi'e ke brode ke'e`. A plain gihek can read the same words. "Sentences and bridi-tails" in [the CLL grammar](../grammars/syntax/cll.md) states the condition, which removes the plain reading in some of these texts. Where only the plain reading parses, as in `mi broda gi'e ke brode ke'e brodi`, the grammar keeps it, as the printed grammar does. The official parser rejects that text.

The experimental dialect redefines `selbri-4` and `operator`, with the same ranked KE preference. It also redefines `bridi-tail`, `bridi-tail-1`, and `bridi-tail-1-final`. At a final connection, its whole-tail condition prefers a connective-owned KE group when that group reads the same words. An earlier connection or a continuing tail keeps the plain reading. The same condition applies with or without a free modifier. The [syntax closing section](../grammars/syntax/experimental.md#bridi-tail-connections) explains that preference and its difference from camxes-exp.

The dialect also states three conventions as rules:

- A sumti connection takes priority over a term connection. After span ranking, `fewest` prefers fewer links built by `bridi-tail-connective` across the whole reading. Direct GI-stag links before BO or KE contribute nothing to this count. Equal counts leave late elision to decide, which can keep the first description open. This applies to A, JA, JOI, and VUhU, including terms marked with `fe` or `pu` and bare `na ku` terms.
- A `be` group attaches to the preceding unit when there is one.
- A subscript after a subscript nests, as CLL 18.13 says.

A preference for each connective or argument can misread natural texts. Form alone does not determine the intended meaning. The experimental dialect keeps the whole-reading count. Written `kei ku` after the first description selects parallel descriptions, while `gi'e` explicitly marks a bridi-tail link. The [syntax closing section](../grammars/syntax/experimental.md#terms-and-descriptions) gives both choices and their written forms in plain words.

The `leftmost-longest` flag on `free` settles a free modifier's span before the `fewest` ranking. An omitted terminator therefore closes as late as the text allows. In `mi viska to do klama le zarci`, `le zarci` stays inside the parenthesis. The [experimental syntax document](../grammars/syntax/experimental.md) gives examples with omitted and written `toi`.

The Zantufa grammar states its attachment conventions as rules, derived from its reference parser:

- A free modifier nests in the nearest open slot. The rule stands on `free`, not on each slot. So the dialect keeps its departure from CLL 19.7 in `mi klama pamai le zarci .e remai le zdani`.
- A sumti connection comes before a term connection.
- An operator run is read whole, and the operand after it is read wherever one follows.
- A gek before bridi-tails begins a bridi-tail, not a connection of sentences. In `mi ge klama gi cadzu`, it begins a forethought tanru unit inside the bridi-tail. The sentence condition tests the actual branches. It excludes a forethought sentence only when every branch has the bridi-tail form.

Other conditions exclude SE and NAhE conversions that duplicate an actual bare gek unit. FA cannot begin a gek and has no such exclusion. A `cei` run nests to the right. The tenses and modals before `ke` and a gek-bridi-tail are one tag.

Written KEhE selects one bare grouped sumti. Omitted KEhE selects the corresponding grouped terms. Patterns test the actual body and closer.

The vocative follows the reference. Zantufa merges cmevla and brivla, so a name is an ordinary tanru unit. The selbri of an address reads as far as it can, so `doi djan klama` is one vocative with the address `djan klama`. The dialect also keeps an odd reading of the reference. In `pe'usai doi xod ko jmina fi lo kamjikca lisri`, the vocative `pe'u` takes `ko` as its address, so `jmina` has no first place.

Zantufa marks neither `CU` nor `IAU` as elidable. CLL also leaves `CU` unmarked. Both are separators, and neither closes a constituent. So both are plain optionals, `[CU 🆓]` and `[IAU 🆓]`. An absent `cu` or `i'au` counts for nothing, leaves no `elided` node, and `elision-only` does not see it. The marker is the only control, and the ranker has no logic for `CU` or for any other terminal.

## Indivisible numbers and letter strings

The `cll-ebnf` and `bpfk` dialects use `late-elision elision-only`. Their numbers and letter strings cannot end before another continuation unit. A continuation unit is `PA` or a complete `lerfu-word`. It includes recursive LAU words and balanced TEI/FOI compounds. CLL 17.9 and 18.6 require `boi` between adjacent runs. CLL 17.14 lists what can follow a LAU cmavo.

The conditions on `number` and `lerfu-string` test the completed run once, where it ends. The rules use brace notation.

The `cll-ebnf` and `bpfk` dialects accept example 8.48 without `ku'o`, despite the requirement in CLL 8.6. This policy interprets CLL 1.1 section 21.1 note 10. Number and letter boundaries follow CLL 17.9 and 18.6.

## Lexicons

All lexicons are hand-curated. The maintainers edit words and their classes by hand. If a reference parser changes, the maintainers port the relevant changes by hand.

`tools/peg-lexicon.js` compares a lexicon with the word lists of a PEG grammar. It reports each missing cmavo and each different class set. It writes no file. The comparison returns status 0 for equal tables, 1 for differences and 2 for errors.

The experimental comparison uses a local `camxes-exp.peg` from ilmentufa commit `778ea138f7d150121ca722db7536ce3b123943ac`:

```sh
node tools/peg-lexicon.js camxes-exp.peg grammars/words/lexicon-experimental.md
```

The Zantufa comparison uses a local `zantufa-1.9999.peg` from Guskant's `gerna_cipra` commit `d5a5065c924304cf5e9067ee6d41b584fbe1c099`:

```sh
node tools/peg-lexicon.js zantufa-1.9999.peg grammars/words/lexicon-zantufa.md
```

The comparison accepts lexicons without feature gates. It reads literal or constant string keys and membership removals through the JavaScript library. It compares classifier classes, without implication tags. Bare `y+` denotes hesitation, not a cmavo. The `ybu` and `digit` PEG branches describe input constructs, so they supply no literal classifier keys. A mixed Y list retains its canonical `y` key.

For a new lexicon, bootstrap mode prints a fresh classifier to standard output. It prints no implication:

```sh
node tools/peg-lexicon.js camxes-exp.peg --print-classifier
```

After a hand edit, `node tools/sync.js` refreshes the generated files and package copies.

## The result, and why it has no types

The grammar decides the shape of the tree, and gencmu loads the grammar at runtime. So no language gets a typed tree. Every library returns the same generic structure:

```
ParseResult
  ok            whether every stage accepted without an error
  stages        per stage: name, input tokens, output tokens, verdict, tie witness, rejection
  tree          the last stage's chosen tree, or none
  error         the first rejection or error: a rejection has its source position and what was expected,
                an ambiguous error has its reason and two readings
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

The engine splices out only one kind of node, because no author wrote it. That is the helper rules that lowering invents for `[ ]` and flat `{ }`. So `%rule text {item}` gives one `text` node over all its items. A chain's levels are nodes of the rule that the author wrote, so they stay (see "Repetition, lists and chains").

An absent elidable optional leaves an `elided` node with an empty span, at the place of the missing terminator. Collapsing chains is a choice of the renderers, not of the tree. Ordinary nodes store no `text`, `value`, or `image`. The libraries compute them from tokens. An equality-tested elided node instead saves its restoration operand as `value`, including an explicit empty string. Omitted pattern leaves still observe empty strings.

Canonical JSON includes saved `value` for equality-tested elisions. This distinguishes their restoration data without changing what a pattern observes.

Each library exposes this structure in the idiom of its language. JavaScript uses plain objects and arrays, and Python uses dataclasses. Go uses structs with slices, and Rust uses structs with `Vec` and owned `String`. These types let a result outlive the text and the dialect that it came from.

A result privately retains its immutable originating core table for quoted tree images. JSON serialization omits that context, and tree rendering requires it. Each library can serialize a result to the canonical JSON of `docs/output.md`. Each library also renders the canonical bracket form, because the shared tests compare it.

## The API

The API has the same shape in every language, spelled idiomatically:

```
dialect = load_dialect("cll-ebnf")                 # a bundled dialect by name
dialect = load_dialect_file("my/pipeline.md") # or a pipeline document on disk
dialect = load_dialect_sources({path: text})  # or documents held in memory, for the browser
result  = dialect.parse(text, features={"y-cmavo"}, without_features={"cll-cyrillic"},
                        until="words", elision_only=None)
result.ok; result.tree; result.error.describe(); result.warnings
dialect.features                              # each feature: name, gate or warning, on by default or not
to_json(result); to_brackets(result)
```

The bundled grammars are embedded in each package, so a library works with no files beside it. A caller can also supply any grammar from disk or from memory. In-memory sources are a map from path to text. The paths are `/`-separated and relative to a virtual root. The loader resolves the document paths of a pipeline against the pipeline's own path, and normalizes `.` and `..`, exactly as on disk. The bundled dialects are that same map.

Parsing is synchronous everywhere, and the browser runs it in a worker (a background thread). If `elision_only` is left unset, the parse follows the grammar's directive. Stage-local features follow the declarations and conditions of the grammar. A caller can disable features with `without_features`. If a conditional declaration holds for a disabled feature, the parse gives a `feature-conflict` result.

The distributable artifacts are exactly these:

- The npm package `gencmu` (the `lib/js/` directory)
- The Python distribution `gencmu` (`lib/python/`, a pure-Python wheel)
- The Go module `github.com/int19h/gencmu/lib/go`, imported as `gencmu "github.com/int19h/gencmu/lib/go"`, whose versions are tagged `lib/go/vX.Y.Z` because it is in a subdirectory
- The crate `gencmu` (`lib/rust/`)

Each contains its grammar copy and nothing from outside its directory. CI makes sure of this: it builds each artifact from a clean checkout (`npm pack`, `python -m build`, `go build` from a module-mode checkout, `cargo package`).

## Diagnostics and debugging

The product provides these diagnostics and debugging tools:

- A rejection names the stage, and shows the source line with a caret under the failing character or word. It lists what can continue at that point as grammar terms, grouped by rule, not as a set of tag names.
- A grammar error carries file, line and column, and names the rule.
- A tie shows the two derivations side by side from the first difference.
- Stage inspection shows the tokens that every stage emitted, with their tags.
- The trace shows, for one position, which items the recognizer predicted, advanced, completed and dropped, and which condition dropped them. This is the tool for "why does my grammar not accept this".
- The audit reports unreachable rules, every rule that a later document replaced or extended, and `%erased` that changes nothing. Such an `%erased` is over text that can never emit a token or be covered by one. The audit names a replacement that adds or removes a rule flag, with the flags before and after. It also records stage extensions and replacements with their source locations. The audit data lists every membership change, with its key, class, gates and document. The audit also reports each close family that a stage names (engine §2.2).

  Its data lists the family's members in closure order. That order starts with the family rule and reads the members breadth first. It reads each member's alternatives in written order, and each alternative's member edges in written order. The data also lists the optionals that the family permits, each with its terminal and owning definition. They follow the members in closure order, and each member's optionals come in written order.

  Four kinds of note can follow. `empty` marks a family that permits nothing. `never-omitted` marks a permitted optional whose omission predicate can never hold. `inert-member` marks a member other than the family rule that owns no elidable optional and has no member edge. `unnamed-member` marks a member other than the family rule that no rule outside the family names in its body. A name in a condition, a tag clause or an emission does not count.

  The printed report shows the same facts. None of these notes is an error.

  Family data appears in each stage's `families` list. Each entry has `family`, `calls`, `members`, `permitted`, and `notes`. Families follow their first calls in the reference traversal order of engine §2.2. `calls` lists each calling definition as `rule`, `document`, `line`, and `column`. Each permitted optional has `terminal`, `owner`, `document`, `line`, and `column`. Its location is the definition that writes it.

  Each note has `kind`. `never-omitted` also carries the permitted optional's fields. `inert-member` and `unnamed-member` also carry `rule`. `empty` comes first. Each member then supplies its `never-omitted` notes in optional order, followed by its `inert-member` note. The `unnamed-member` notes come last, in closure order.

  The printed report shows the gated memberships and those that more than one entry changes. A condition that applies to no alternative is a grammar error, not an audit finding.

Each stage's audit also exposes `templates` and `instances` lists. Templates follow declaration order. The instance list follows expanded rule order (engine §2.3), after omitting ordinary rules. A template entry contains `template`, `parameters`, `document`, `line`, `column`, and `notes`. Its notes identify `unused-parameter` with `parameter`, or `uncalled-template`.

An instance entry contains `template`, `arguments`, `name`, `binding`, `firstCall`, `flags`, `events`, and `notes`. Arguments use the unresolved ARG schema without source positions. The template and ordered arguments encode its key within the stage. `binding` is null for an unnamed instance. Otherwise it names the binding's document, line, and column. `firstCall` records that call's document, line, and column.

An `argument-alias-twin` note names distinct instance keys with equivalent argument references. It does not claim that local edits give those instances identical bodies. The note has `kind` and an `instances` list of the other effective names, in expanded rule order.

Twin instances use the same template. Corresponding arguments must be identical after key normalization, apart from a named-instance reference standing for a call of that same instance key. The comparison follows the finite written argument trees and never expands a nominal reference's body. It accepts either direction of that replacement. It also applies inside nested argument forms.

Events follow source order and record `scope`, `op`, `document`, `line`, `column`, `flagsBefore`, and `flagsAfter`. Scope is `template` or `instance`. Replaced events remain in the list. `flags` gives the final effective flag list. The printed report shows the same facts and names public bindings without implying wrapper rules.

The audit also reports these boundary notes:

- Each rule with a boundary atom that a nested query can reach (engine §4.2). At the edges of a query's witness, such an atom gets its default answer, which an author can easily miss. The entry is a note, not an error.
- Each boundary-atom target that only a nested query can build. Outside queries, the atom always gets its default answer there. This entry is a note too.

## CLI and playground

The CLI is `node lib/js/cli.js`. A published package exposes it as `npx gencmu`. It has these commands:

- `parse`, to parse a text, with configuration arguments that include `--dialect`, `--feature` and `--no-feature`, `--until`, `--format brackets|tree|json|canonical|tokens` and `--trace`
- `dialects`, to list the bundled dialects
- `features`, to list a dialect's features
- `audit`, to report the unreachable, replaced and extended rules of a dialect, including replacements that add or remove rule flags. It also reports the close families that the dialect's stages name.
- `stitch`, to print a dialect's pipeline as one jbogenbau text, with each classifier's entries as written
- `test`, to compare a grammar author's own file of corpus-format cases with the expected results under a dialect. It compares each case as the library's corpus runner does, with the same code. It runs no engine self-tests, such as the witness hook of `elision-only`
- `help`, to list the commands and every option

`parse` prints any warning on standard error, as it prints an error, a tie included. The CLI needs Node and nothing else.

The playground is `index.html` with `dist/gencmu.js` and `dist/grammars.js` loaded as classic scripts. The grammar documents are a JavaScript object in the grammar bundle. At startup, the page fetches `grammars/unicode-properties.txt` relative to its own URL. It adds that text to the source map before loading a dialect. Local use requires an HTTP server because the resource fetch must succeed.

The page builds its worker from a `Blob` containing the library source and grammar object. It passes the fetched properties text to that worker. The worker needs no separate properties fetch. A failed startup fetch reports the resource error instead of loading a core-only dialect.

For source names outside the core abbreviation map, the page fetches `grammars/unicode-names.txt` before it resumes loading. Bundled names-dependent cache hits use fingerprints from `compiled.json` without fetching any names file. Declared extras use their normalized grammar-relative paths under `grammars/`. Thus the zbalermorna declaration requests `grammars/phonemes/zbalermorna-names.txt`. Names files stay outside `dist/grammars.js`.

Names-file inspection uses the bundled standard names text, also fetched from `grammars/unicode-names.txt`. The page supplies that pinned text as `unicode-names-reference.txt`, even if the lookup base uses a replacement. It reuses one fetched copy for both purposes. Libraries embed only pinned one-word names and aliases for core inspection.

The page supplies each resource under its matching source-map key, and fetch errors prevent loading. It supplies that text to the worker's source map. Before fetching names files, the worker can compare absent names-resource keys through the bundled registry. After a fetch, supplied text requires full comparison. Edited names files count as overrides. Names loading remains separate from canonical rendering, which uses core abbreviations.

A pipeline names preamble passes extra resources to included documents. A grammar preamble can add its own resource. Returning from that grammar restores the parent's resources. Names never alter scalar properties or the accepted character inventory.

`tools/smoke-playground.js` makes sure that the playground works in headless Chromium and Firefox. Playwright drives the browsers. CI runs the smoke test, and a contributor can run it locally. To run it locally, do these steps:

1. In `lib/js`, run `npm ci`.
2. In `lib/js`, run `npx playwright install chromium firefox`.
3. From the root of the repository, run `node tools/smoke-playground.js [--browser chromium|chrome|firefox] [URL]`.

The test uses Playwright's own browsers. Playwright is a development dependency of `lib/js` only, never of the libraries or the playground. Without a URL, the smoke test serves the checkout over loopback HTTP and opens `index.html`. With a URL, it tests that page instead. The test requires a successful properties fetch and exercises a failed fetch's loading error.

The playground has these parts:

- The text
- The dialect and a Grammar, On, or Off selection for each feature
- The warnings of the parse
- The output in the four formats, and the tokens of each stage
- The diagnostics above
- An editor for the grammar documents, which parses the text again at once after each edit and lets the user download the edited documents

The editor lists a dialect's documents stage by stage. A forgiving scan of stage selectors and `%include` directives finds them (`playground/pipeline.js`). So a pipeline with an error, a missing document or a cycle still shows every document it reaches. Parsing runs in a `Blob` worker, so a long text does not freeze the page.

## Output formats

`docs/output.md` defines the output formats exactly. JavaScript implements them for the CLI and the playground, and every library implements the bracket form for the tests:

- `brackets` is the tree as nested groups. The groups cycle through `( ) [ ] { }` by depth. The renderer collapses groups of one child, and leaves show their images, with stress. A configuration argument shows elided terminators in angle brackets, `⟨ku⟩`, or hides them.
- `tree` is an indented listing, one node per line, with the rule name and the text.
- `json` is the display JSON, a projection of the tree for reading. It is pretty-printed so that a node with one child stays on one line with its parent, as in `{"tanru-unit-2": {"BRIVLA": "mlatu"}}`. This keeps deep trees readable.
- `canonical` is the canonical JSON of the whole result, which the shared tests compare.

## Documents

Every paragraph, heading and table row of a Markdown document in the repository stands on one line. A list item can hold several paragraphs, each on its own line. Some renderers show a line break inside a paragraph as a break. A code span closes on the line where it opens. A paragraph can follow a heading directly. The content of a fenced block is not prose.

The tools list the repository's documents in one way (`tools/documents.js`). In a git checkout whose top level is the repository, the documents are those that git tracks. In an exported tree, the tools list every Markdown file under the repository. They exclude hidden directories and the `node_modules` and `target` directories. `tools/sync.js` fails when git does not track a grammar file selected for bundling.

`tools/sync.js --check` reads each document with a CommonMark and GFM parser (`tools/markdown.js`). So it sees each block where GitHub sees it. It reports these layouts (`tools/prose-lines.js`):

- a line that continues a paragraph or a heading, such as a lazy continuation line or the underline of a setext heading
- A table row that does not begin with `|`. A prose line directly after a table can become such a row.
- a code span that closes on a later line, and a backtick that opens no code span
- a fenced block with no closing fence, which takes in the rest of its container
- an indented code block, such as a paragraph indented too far in a list item, and an HTML block, since either can hide prose

A document can hold one kind of HTML block: the generated railroad diagrams after a top-level block of rules ("Railroad diagrams").

The check of quoted texts relies on this rule, since it gives each text the line of its code span (`tools/quoted-texts.js`).

## Railroad diagrams

A railroad diagram draws a grammar rule as a track. A reader follows the track from left to right, and each path along it is one way to read the rule. "Railroad diagrams" in [the notation document](notation.md#railroad-diagrams) explains how to read them, and what they leave out.

`node tools/sync.js` draws one diagram for each rule of each grammar document (`tools/railroad.js`). It reads the rules from the document's DOM, as the libraries read them. It writes each diagram as an SVG file under `docs/diagrams/`, in one directory for each document.

So the diagram of `sumti` in `grammars/syntax/cll.md` is `docs/diagrams/syntax/cll/sumti.svg`. The packages do not ship these files. An emoji filename uses `_u` followed by lowercase hexadecimal, without unnecessary leading zeros.

Thus `🆓` uses `_u1f193.svg`. Generated names cannot collide with ASCII rule names because those start lowercase.

A template diagram appears once, with its parameter list in the title. Parameter boxes show their `@` names. Call boxes show arguments and link to the template. A binding shows the named instance and its substitution without suggesting another parse-tree node.

An instance-specific edit receives a diagram of its written body. Diagrams never enumerate unnamed instances automatically. A template statement or closed-call edit uses the template name as its filename stem. A binding or edit written with a public name uses that public name as its stem.

An emoji stem uses `_u` plus lowercase hexadecimal, without unnecessary leading zeros. Statements with the same case-folded stem share one source-order counter. Their filenames are `stem.svg`, `stem.2.svg`, and so on.

A ranked choice numbers its options in preferred order inside a dashed frame. Its shared label is `≻ same span`. A qualified higher proof removes a lower proof over the same span only when its open facts dominate the lower proof. Ordinary alternatives within an option remain unnumbered. Nested ranked groups receive separate frames.

The grammar document shows its diagrams itself. HTML cannot stand inside a fenced block, so the diagrams follow the block that states their rules. After the block come a blank line and one collapsed `<details>` element, so a reader opens the diagrams only when they want them.

Its summary names the rules of the block. A long list gives only the first and the last rule, and the number of rules. The element holds an image of each rule's SVG file, one on each line, in the order of the rules. Each drawing gives its rule's name above its track.

`tools/sync.js` owns these generated elements. An element begins with a line outside fenced blocks that begins with `<details><summary>Railroad diagram`. It goes on through the lines of its images, which begin with `<p><img`, to its line `</details>`. Each run removes every element, with the blank line before it, and writes them again from the DOM. So the elements follow a rule that is renamed, added or removed.

Every other line of the document keeps its text and its line ending. `tools/sync.js --check` fails when an element is missing, out of date or left over, or stands in a document outside `grammars/`.

The libraries' reader reads only the fenced `jbogenbau` blocks, so the generated elements change no rule. They move the lines below them, and with them the line of each rule in the DOM. No test names a line of a grammar document by its number, so no test changes when the lines move ("Places in fixtures" in `tests/README.md`). Each package's copy of a grammar document is the same file, generated elements included. Their images do not show inside a package, which holds no diagrams.

The SVG has fixed sizes and no fonts to measure. Each text is drawn at the width that its characters are given. So a diagram depends only on the rule in the DOM and on the omission outcomes of its tested terminators. A test whose value holds a constant takes the constant from each dialect that reads the document. So another document, such as one with a `%redefine-const`, can change whether a bypass is drawn.

With the same rule and the same outcomes, the file is always the same. Each diagram has a white background, so it reads in a dark theme too.

GitHub also renders railroad diagrams written in Mermaid, a beta diagram type since Mermaid 11.16. That type has no separators, labels or rows. GitHub draws each diagram in a frame of its own, with a Mermaid version that it can change at any time. Other viewers of Markdown often do not draw Mermaid at all. An SVG file shows wherever an image does.

## Tests

There are three kinds of shared test. Every library runs each case that its API can express, as `tests/README.md` says:

- `tests/engine/` holds the engine specification's cases. Each case gives a pattern that the canonical result JSON must match. A pattern can pin stages, tokens, tags, verdicts, witnesses, errors and coordinates.
- `tests/notation/` holds small grammar documents with their expected DOMs and errors.
- `tests/corpus/*.jsonl` holds Lojban texts, one case per line:

  ```
  {"id": "cll.10.183.c10e24d5", "text": "puzu", "dialect": "cll-ebnf",
   "expect": "accept", "verdict": "resolved", "words": ["pu", "zu"],
   "brackets": "(pu zu)"}
  ```

  `expect` is whether gencmu is meant to accept the text, `words` the tokens of the words stage, and `brackets` the tree. A full result for each case needs hundreds of megabytes. The engine cases pin down the full result, and the corpus pins what a Lojban reader cares about.

A corpus case can include provenance fields, `seeded` and `reason`. The reason states the case's expectation in terms of gencmu's grammars. `tests/README.md` defines these fields.

Update a case's expectations in the same commit as the grammar change that affects them. Explain the expectation in the commit message. Changes to `words` or `brackets` need no additional field.

Every library runs the whole corpus. On a pull request, the core cases in `tests/core.txt` run in every language. They form a sample, together with the cases that pin the texts that the grammar documents quote. Rust and JavaScript also run the whole corpus there. All four languages run the whole corpus nightly and before a release, sharded if Python needs it. No language is permanently exempt.

## CI

CI has two workflows. `ci.yml` runs for each pull request and each push to `main`. Each toolchain in this list gets its own test job:

- JavaScript: Node 24. The job tests generated files, runs `node --test`, and examines the package with `npm pack --dry-run`.
- Python: 3.14. The job builds the wheel with `python -m build`, installs it, and runs `python -m pytest` once against it.
- Go: 1.22 and stable. The job runs `go vet`, `go test`, and `go test -race` for concurrent parses. It also builds the module alone.
- Rust: 1.75 and stable. The job runs `cargo fmt --check`, `cargo clippy`, optimized `cargo test`, and `cargo package`.

Both Rust jobs also build a consumer from the packaged archive beside unrelated engine and notation fixtures. The published crate excludes integration tests. Its build script discovers external fixtures only when the corresponding integration test exists inside the crate.

The workflow also tests the playground in Chromium and Firefox. It runs the whole corpus in JavaScript and in the stable Rust job. A separate job makes sure that the JavaScript types and generated declarations agree. `nightly.yml` runs the whole corpus in all four languages each night and on demand. Nightly Python uses an installed wheel on 3.14 with four pytest workers.

Rust and Go use their standard test harnesses to schedule independent tests and shared fixtures. JavaScript uses the Node runner to schedule files. Python uses pytest with pytest-xdist to schedule tests in separate processes. Its `worksteal` scheduler balances tests with different durations. The `test` dependency group pins these Python development tools. The Python package keeps no runtime dependencies.

Rust tests use optimization level 3 through `[profile.test]`. The runner controls are `--test-threads` or `RUST_TEST_THREADS`, Go's `-parallel`, pytest's `-n`, and Node's `--test-concurrency`. Rust, Go, and JavaScript keep the separate `GENCMU_CORPUS_WORKERS` control for their corpus pools. Python uses its pytest worker count for corpus cases too. The library READMEs and `tests/README.md` give local commands, including serial runs and Rust debug builds.

The Python build backend is a build dependency. Third-party actions are pinned by commit hash. GitHub Pages serves `main` from the root with no workflow.
