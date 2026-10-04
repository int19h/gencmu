# gencmu: design

Status: implemented. If the implementation shows that a decision is wrong, the same change corrects this document.

## What gencmu is

gencmu is a standalone Lojban parser whose grammar is data. Every layer of the language is a literate grammar document in one notation, which gencmu loads at runtime. A literate document mixes the grammar with prose that explains it. The layers go from characters to phonemes, from phonemes to words, and from words to a parse tree.

A dialect is a pipeline of stages, defined by one pipeline document. That document is literate Markdown too. A stage reads its input with one grammar, and hands its result to the next stage. The first stage reads the characters of the text. The pipeline document lists the stages and the grammar documents stitched into each stage. It also explains what each stage receives and hands on.

The users of gencmu want to read a grammar, change it, and see at once what the change does to a text. So the notation, the diagnostics and the interactive tools matter as much as the parser.

gencmu ships these parts:

- There are four libraries, in JavaScript, Python, Go and Rust. Each is a clean-room implementation of one engine specification: it is written from the specification, not from another library's code. No library has dependencies beyond the standard library of its language.
- The grammars and dialect pipelines are shared by all four.
- There is one command-line tool (CLI) and one web playground, both in JavaScript. Both run from a clone with no install step.
- There is one test corpus, shared by all four libraries. Its expectations are what gencmu itself is meant to produce.

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

`dist/gencmu.js`, the library as one classic script (a script that is not an ES module), is generated too. So `index.html` works without a build step, from a clone opened with a double click and from GitHub Pages. One Node script, `node tools/sync.js`, writes all of these files, and it needs no dependencies to write them. CI runs it and fails if anything changed. A contributor edits `grammars/` and runs one command.

## The engine

The engine works with these objects:

- A token is one unit that a stage reads or emits, such as a character, a phoneme or a word.
- A tag marks a token by name, phoneme or character. Examples are `KOhA`, `/a/` and `'a'`.
- A constituent is a part of the input that one rule matched. Its span is the range of input tokens that it covers.
- A capture, such as `$c`, names a part of an alternative, so that a condition or an emission can use it.

The four libraries implement one specification, `docs/engine.md`. It was written first, and it is precise enough that two implementations cannot legitimately differ. It covers:

1. The loader, the part of a library that reads documents, uses the notation's own grammar. It reads the fenced `jbogenbau` blocks of a Markdown document into a grammar DOM (document object model: the document as a tree of objects). See "The notation" below. The loader splices pipeline documents as "Pipelines" says, and stitches the rules of each stage into one grammar. Its errors carry file, line and column.
2. Lowering turns the grammar into a context-free grammar. Lowering makes named helper rules for the notation's shorthand, such as `[ ]` and flat `{ }`, and diagnostics hide these rules.
3. The recognizer is an Earley parser (a standard algorithm for any context-free grammar). Its items, the partial matches that it keeps, record the span and the identity of the tag set of each captured part. The parser evaluates each condition as soon as it reads the last capture of that condition. With `from` and `after`, a condition can look past its constituent to the end of the input. A PEG (parsing expression grammar, which tries alternatives in order) has a lookahead that does the same.

   Nested parses for `matches(span, rule)`, `begins(span, rule)` and `tags(span, rule)` share their memo (a cache of answers) with the parse that started them. The memo key is the kind of query, the rule, and either the content of a short span or the position of a long span. A nested parse asked about its own span, as the same rule, is a grammar error. A nested parse never leaves out an elidable optional that the same construct can read whole as written (see "Nested queries and elided terminators" below).
4. The engine chooses a parse by the rule that the grammar's `%ambiguity-resolution` declares. `greedy` and `lazy` compare parses at their first difference, as sequences of bottom-up actions. `late-elision` compares only where the parses elide terminators. This part also covers the verdicts unique, resolved and tie, the error of a tie and its witness, and the `elision-only` check (see "Ambiguity" below).
5. The stage emits the tokens of the next stage. Each token has its text, its phonemes, its label and its source range. The label is what the renderings for people show. A token can also carry attachments, tokens that belong to it and that no later stage reads.
6. The pipeline runs the stages in order, and stops at the first rejection or error.

`tests/engine/` tests the specification. Each case is a small grammar, an input, and a pattern that the canonical result JSON of `docs/output.md` must match. So a fifth implementation can run the cases to make sure that it follows the specification, without the Lojban grammars at all. The cases are written together with the specification, one or more for each of its rules. They settle the edge cases that decide which parse comes out, so that the Lojban corpus does not become the specification by accident:

- A tie is an error (`ok` is false) of kind `ambiguous`, with the reason `tie`. The stage has the verdict `tie` and a witness, and the error has two readings. The first reading is the least in a total order, *T*, that breaks the ranking's ties by canonical keys. The second is the tied derivation that diverges from the first earliest (engine §6). *T* orders the ambiguity diagnostics and selects the forbidden terminator that a `maximal` rejection reports. The canonical tie-break keys never turn a tie into an accepted reading.
- The witness of a tie is the pair of actions at the first visible difference between the two readings. A close of a helper rule, or of an alternative with one symbol, is transparent (not visible). An earlier difference at such a close does not decide the witness. If the two readings have no visible difference, the witness is the pair of actions at their first difference.
- A stage with a tie emits nothing, and the pipeline stops there. Its tie stands even when every tied derivation emits the same tokens. The stage is ambiguous as written, and the error lets a grammar author fix it. The engine cases include a three-way tie and a tie whose derivations emit the same tokens.
- The cases cover empty spans and cycles: nullable rules, empty captures and a condition on an empty span. They also cover a unary cycle of `a` to `b` and `b` to `a`. Another case is a nested parse asked about its own span as the same rule. Each case has its defined outcome.

Every span and every source range in a result is half-open: the range holds its start but not its end. Source positions count Unicode code points, not bytes or UTF-16 units, so that the four languages agree on non-ASCII text. Each library converts at its edge (JavaScript from UTF-16, Go and Rust from UTF-8). The libraries derive line and column in diagnostics from code points. Lines split at `\n`, `\r\n` and `\r`.

A token's `span` is a range of the previous stage's tokens. Its `source` is the smallest range of the original text that holds the sources of those tokens. So the source is contiguous even when some of those tokens emitted nothing, as an erased word inside a compound does. A token inserted by an emission clause has an empty span, and an empty source range at the position where it was inserted. Its provenance is that emission: its `insertedBy` records the rule whose clause inserted it.

A token whose constituent is a nonempty opaque part also takes in adjacent text that no input token covers. A larger token that holds an opaque part keeps the source of its input tokens.

Following `span` from stage to stage explains any token of a stage's output. The chain ends at the characters, or at a token with an empty span. An inserted token ends it at the rule in its `insertedBy`. A token over a part that read nothing has an empty span and no `insertedBy`. An attached token has no `span`, so its chain ends at the stage that attached it. Its `source` still gives its place in the original text.

## The notation

gencmu's grammars are written in jbogenbau, a notation of its own. `docs/notation.md` explains it for grammar authors. This section gives the summary and the reasons.

A jbogenbau grammar is an attribute grammar (its constituents carry computed values) with EBNF rule bodies. Each rule body is EBNF in the form that CLL (*The Complete Lojban Language*) prints. Each constituent carries one attribute, its set of tags, computed bottom-up from its parts. Conditions over the parts, such as whether a part also parses as another rule, restrict which parses exist, as in a Boolean grammar. A rule can say what its constituents hand to the next stage. So each grammar is a transducer (it reads one token sequence and writes another), and a dialect is a pipeline of them.

The bodies keep the look of CLL's EBNF, because a reader of CLL recognizes that look. Everything around the bodies is spelled with keywords, because symbols there proved opaque.

A grammar document is Markdown. Its fenced `jbogenbau` blocks, in order, are the grammar, and the prose between them explains it. The loader finds only the fences by lines, as Markdown requires. Inside a block, line breaks and indentation mean nothing.

A rule is a keyword, its name and its body, followed by its clauses. Each clause is a keyword and what it says. A rule ends where the next item begins: a rule, a directive, a constant, a classifier or an implication. So a rule needs no terminator, and nothing is recognized by its position on a line:

```jbogenbau
%rule term-connective
  | joik #
  | jek #
  | ek #
  | VUhU #

%rule vowel-group-joined
  vowel-group⊇~syllabic $v(joined-vowel⊇~syllabic) <tags($v)>

%rule joined-vowel
  $v(vowel) <tags($v)>
%emits
  /'/, $v
```

Every binary operator except the difference, `∖`, can also stand first, as a no-op, so that a list can put one item on each line. These operators are `|` and `&` in bodies, `∪` and `∩` in terms, and `∧` and `∨` in conditions. The commas of a clause's list can stand first too.

A stage reads its input with one grammar. The loader assembles that grammar from one or more documents, read in order. `%rule` defines a rule, and is an error if a rule of that name exists. `%redefine-rule` replaces a rule defined before it in the stage, and is an error if none was. `%extend-rule` adds alternatives to a rule defined before it, and is an error if none was.

So an accidental override never passes silently, and a replacement says so where it is made. A misspelled name in a replacement, an extension or a reference is an error. A misspelled `%rule` defines a rule that nothing reads, and the audit (see "Diagnostics and debugging") reports it. The loader also reports every replacement and extension: which document changed which rule. So a reader can see the effect of a dialect on its base in one place.

The notation has no way to remove a single alternative. A rule is small enough to restate, and a restated rule reads better than a list of deletions.

A stage can also name a value, such as a list of classes that several rules test. `%const $SU-STOPS NIhO ∪ LU ∪ TUhE ∪ TO` defines the constant, and `%redefine-const` gives it a new value, which can use the old one. So a dialect extends a list in one place, and does not restate every rule that tests it. The loader gives each constant its value when it stitches a stage. So a document that several dialects include takes the values of each, and a cached DOM holds no value.

A stage can also give sounds their classes with a classifier, such as a lexicon. `%classifier lexicon` lists entries such as `"mi" "do" ∈ KOhA`, and `∉` removes a class. A gate can guard an entry, so a feature can change the class of a word. `classify(phonemes($c), lexicon)` gives the classes of the word `$c`. A classifier's value depends on the features, so a stage resolves it for the features of each parse.

`%implies UI ∪ CAI ⟹ ~indicator` says that each token that the stage emits with `UI` or `CAI` also carries `indicator`. So a lexicon says once which classes are indicators, and not on every word.

This is what the dialects need. A script document adds its letters to the rules of the phoneme grammar with `%extend-rule`. A word family is a set of word forms that dialects use, such as those of CLL. Its documents add those forms to the stage that divides the text into words. The experimental syntax is a layer over the CLL syntax. It restates the CLL rules that it changes, and adds rules of its own.

The Zantufa syntax is a grammar of its own. Zantufa 1.9999 restates almost every rule of camxes, a PEG grammar of Lojban. So the gencmu grammar translates the Zantufa rules one by one. It uses small rules for the conditions that state the lookaheads and ordered choices of the reference.

A name in upper case is a terminal that matches a token carrying that tag. A character between single quotes, `'a'`, is a character tag, which matches that character of the text. A character token carries only its character tag. So a class of characters is a range, such as `'0'..'9'`, or a Unicode property, such as `'\p{L}'`.

`~name` is the identifier tag `name`, for a tag that does not begin with a capital, such as `~cmavo`. A phoneme between slashes, `/a/`, `/'/`, `/./` for a pause, is a phoneme tag. It matches like any tag, and it also says what a token that carries it sounds like, which `phonemes()` reads. Slashes mean nothing else.

A reference or a terminal can carry a test on its own span, as in `LE="la"`. The symbol then matches only where the test holds. The `=` and `≠` tests compare the sound of the span, whatever the stress or the script. The four tag tests compare the symbol's own tags with a set, as in `cmavo∩UI=∅`. So a rule can name a word by its sound or its tags in its body, and not in a condition. A test does not replace a class, since a word that `zo` quotes has the sound but not the class.

The operators of a body are those of CLL, except for repetition and elidable terminators. "Repetition, lists and chains" and "Elidable optionals and captures" below say why. The operators are these:

- Juxtaposition is sequence.
- `[x]` is optional.
- `{x}` is one or more, and `[{x}]` is zero or more. `{x \ s}` is a separated list.
- `{... x \ s}` is a left chain, and `{x ... \ s}` a right chain. A chain, like a list, can leave out `\ s`, as in `{... x}`. A chain is the whole of its rule.
- `[+T x]` is an elidable optional, which begins with the terminator `T`. `[++T x]` also makes `T` maximal there, for Zantufa alone, until its redesign.
- `A & B` is and/or, in order.
- `( )` is grouping.
- `ε` is empty.
- `f?` and `¬f?` are gates, and `f!` is a warning. These are the feature guards on an alternative (see "Gates and warnings").
- `$x(symbol)` is a capture, and `$` is the whole constituent. A capture can stand anywhere but in braces and in an elidable optional.

`#` is not built in. It is a rule that the grammar defines as `[{free}]`, as CLL's EBNF defines it with `[free ...]`. So the free modifiers of one slot, such as vocatives, are one node of the tree.

CLL writes `/KU/` for an elidable terminator, a closing word that the speaker can leave out. Here it is written `[+KU]`, and `/KU#/` is `[+KU #]`. The `+` marks the optional as elidable in its place (see "Elidable optionals and captures" below). `[+KU #]` is exactly what CLL prints: an elided terminator takes its free-modifier slot with it.

So `xy. xi ky.` (CLL example 17.38) needs `xy. boi xi ky.` under the printed grammar. CLL's official parser needs it too, as the corpus scans of the prototype show. The grammars that allow free modifiers after an elided terminator, as the camxes family does, write `[+KU] #`.

`%tags` gives the tags that the constituent of every alternative carries. An alternative's own tags, after it in angle brackets, add to them. A tag has no strength: a constituent carries it or not. There is one notation for a set of tags, the union: `UI ∪ CAI ∪ ~indicator`.

`%conditions` lists conditions over the captured parts. Each condition applies to the alternatives that capture what it mentions. The recognizer evaluates it as early as it can. Within one condition, `∧`, `∨` and `⟹` are logic, in that order of precedence, grouped with parentheses.

`%emits` lists exactly what the constituent hands to the next stage, in order, each capture with its own tags. `%emits ε` hands on nothing and makes the constituent not count. That is how a grammar leaves erased text out of what the words around it sound like.

A captured item can also carry attachments, captures in parentheses before or after it, as in `($b) $w ($a)`. The tokens of an attachment belong to the item's token, and no later stage reads them. So the indicator stage keeps `ui` and `ba'e` visible on the word that they modify, without an indicator slot after every word of the syntax. A later stage forwards the attachments with the token, and the renderings show them.

The syntax reads leading indicators itself. They stand at the start of a text or after a text opener such as `lu`. In such a run, the indicator stage attaches only `ba'e`, to the indicator after it. A `nai` after an attitudinal stays a separate token there. The syntax reads `UI NAI`. In a run after a word, the `nai` attaches to its attitudinal instead.

During emission, `%opaque` treats a constituent as one part, with its text as its label and `?` as its phonemes. The body of a `zoi` quote is an example. Its emitted token sounds `?`, so later sound comparisons distinguish it from Lojban words. Its label preserves the text for the renderings. The stage's own recognition and conditions still read the phonemes of its input tokens. The text of an opaque part also takes in punctuation next to it that no token covers.

The engine does not tie `%opaque` to any tag, because a grammar chooses its own tags. In the bundled grammars, `UNREAD` marks a run that the pipeline did not read as words. The phoneme stage makes such a run opaque. The forms stage keeps the phonemes of its own unread runs, so a `zoi` delimiter still compares with them.

The word stage makes `zoi` and `zo'oi` bodies opaque, and the bodies of the quotes that work like `zoi`, such as `la'o`. Their payloads and Zantufa's quoted rafsi forms carry `quoted-text`, the mark for what a quote hands the syntax as one unit. A quoted rafsi form keeps its phonemes.

A clause can refer to a capture that some production lacks. A production is one expansion of an alternative, with one branch of each choice and each optional read or not. Lowering decides such a clause before the recognizer reads any text. A condition or an emitted item then does not apply to that production.

A tag term is an error unless it is guarded, as in `($c ⟹ classify(phonemes($c), lexicon))`. The reason is that a tag term has no value that can mean "nothing to say". A clause that applies to no production, or a capture that no alternative captures, is an error.

Directives are keywords too, and can stand in any block.

`%ambiguity-resolution` says how the stage chooses among parses (see "Ambiguity"). Its first operand is the rule of the ranking: `greedy`, `lazy` or `late-elision`. `elision-only` and then `maximal` can follow it. Every stage must have exactly one, in any of its documents. A stage with none or two is a load error that names the stage.

No directive lists the elidable terminators. An absent elidable optional, `[+KU]`, appears in the tree as its terminator, elided at that point. `elision-only` restores these terminators. `[++TOI]` also makes its terminator maximal (see "Maximal terminators").

By convention, a directive stands in a block of its own, after prose that says why the grammar needs it. gencmu does not enforce the convention.

The notation is self-hosting: it is itself a dialect of two stages. A lexical grammar reads characters into notation tokens, and a syntax grammar reads those tokens into a document tree. Both grammars are in `grammars/notation/`, and both are written in the notation. `docs/notation.md` explains the notation, and these documents define it.

The chicken-and-egg problem is solved once. The DOM of the notation grammar is checked in as `grammars/notation/bootstrap.json`. Every library loads it to read every grammar document, `notation/` included. CI makes sure that the fixpoint holds: reading the notation documents with the bootstrap reproduces the bootstrap exactly.

A maintainer changes the notation in its documents, and `tools/sync.js` regenerates the bootstrap from them. A maintainer wrote the very first bootstrap by hand in JavaScript. In each library, three steps of the reading are written by hand:

- The search for the `jbogenbau` blocks of a Markdown document
- The walk from a document tree to its grammar objects
- The checks of the restrictions that the grammar of the notation does not state

`docs/engine.md` specifies the search (§8), the walk rule by rule (§9) and the restrictions (§9).

Grammar authors get the same diagnostics for a malformed grammar as for a malformed Lojban text. The playground can also show how a grammar document parses. The cost is load time. The grammar text of the bundled documents is about 160 KB. A character-level stage reads it quickly in Rust and JavaScript but slowly in pure Python. So every package ships, beside its grammar copy, the DOM of each bundled document as JSON.

The key of a DOM has three parts:

- A hash of the document's text
- A hash of the bootstrap that read it
- The version number of the DOM format

A change to any of them misses the cache. A library reads a document through the notation grammar only on a miss. In practice, that happens only for a grammar that someone wrote or edited. The playground caches the DOMs of edited documents in the same way. CI makes sure that the shipped DOMs match a fresh reading, and the tests of every library include forced cache misses.

The fixpoint alone proves only that the notation reads itself consistently. So `tests/notation/` also holds direct cases, run by every library: small documents with their expected DOMs and their expected errors.

## Repetition, lists and chains

CLL writes repetition as `x ...`, and its note 7 to chapter 21.2 says that `...` implies left grouping. gencmu departs from that note. Its notation writes repetition with braces, and says in each place whether the tree shows a list or the grouping.

- Flat braces, `{x}` and `{x \ s}`, read a list. The tree shows the items and the separators as children of the rule that writes the braces.
- Chain braces, `{... x \ s}` and `{x ... \ s}`, with or without `\ s`, show the grouping. Each level is a node of the chain's rule. A chain is the whole of its rule, so its levels need no other name.
- `...` alone is gone. So is the trailing repetition. That old rule lowered `x ...` into left recursion on its rule, where the gates left it alone in that rule.

The reasons are these:

- Most repetitions are lists. A measurement showed every left-recursive repetition of the CLL grammar as nested nodes. It changed 1,819 trees of the cll-ebnf corpus. Most of them were plain lists, such as the terms of a bridi, the digits of a number or the sentences of a paragraph. So nesting everywhere hides the structure that matters in more trees than it shows.
- A helper cannot show grouping well. A repetition inside an alternative becomes a helper, which holds only the repeated part. In `mex-1 [operator mex-1] ...`, the first operand is outside the helper, so a nested helper groups the operators without their first operand. A chain makes each level a node of the rule, with the first operand inside.
- The old rule mixed reading and display. Whether `x ...` gave left-recursive constituents depended on whether the gates left its alternative alone in its rule. So a feature changed the constituents of rules that it did not touch. Now the braces say it, in the grammar text.

The notation reads `{x}` as one or more, although ISO 14977, the standard EBNF, reads it as zero or more. So every kind of braces counts its items in the same way, and `[{x}]` is the one way to write zero or more. An item of braces must read at least one token, so `[{x}]` reads nothing in one way only. No bundled grammar repeats an item that can be empty. A capture never stands inside braces or around them, because a repeated part has no single span. A grammar that needs one names the list or the chain as a rule.

The change has these consequences, which `docs/engine.md` (§3) states as rules:

- A flat list is always a helper. So the ranking of `greedy` and `lazy` no longer sees where each prefix of a trailing list ends. The conditions of a rule no longer apply to each prefix either. The ranking of `late-elision` sees only elided terminators, so it does not change. A grammar that needs the prefixes writes a chain or explicit recursion. The notation's own lexical grammar is such a grammar: its `text` stays explicit recursion. With a flat list, `++` could be one token or two `+`, and `greedy` would leave the two readings tied.
- The old error of a capture in a trailing repetition is gone. A capture next to flat braces is allowed, as in `$a(A) {B}`.
- A chain's levels see the clauses of their rule, each level its own `$`. A warning on the chain's alternative gives one warning per level.
- A right chain differs from an optional suffix, `x [s r]`, at its level of one item. Where the suffix is an elidable optional, `[+T s′ r]`, the chain has none, so the elision vectors differ, and `late-elision` can choose otherwise. The level has the tags of `x` where `x` is one symbol. A terminator elided at the start of `s` has a constituent by the ordinary rules, where the suffix gave it none.

  More generally, a rewrite that adds or removes an elidable optional changes which terminators can be elided. So a migration checks each optional that it removes. With the markers, the check reads the text: it looks for `[+` and `[++`.
- Two CLL constructs become rules of their own, so that each level holds its first part. They are the operator chain of `mex` and the connected abstractors of `tanru-unit-2`. So a single abstractor with `nai` or free modifiers is now a group of its own.
- A chain adds a level over a single item, such as a `selbri-3` over one tanru unit. This changes the tree, but not the bracket form, which collapses a node of one child.
- A trailing `x [y] ...` that became `x [{y}]` no longer gives its level of one item the tags of `x`. The old rule lowered it to a production of the one symbol `x`, which inherited its tags. Now the production also holds the helper of `[{y}]`. So a `number` no longer carries the word tags of its first `PA`, such as `cmavo`, which were never true of a number. The same holds for `lerfu-string`, and for three `terms-…-not-starting-with-bare-gek` rules of the experimental dialect. No condition reads these tags, so no verdict changes.
- Over the 29,723 cases of the corpus, the migration to braces and markers kept every verdict, every error and every token sequence. The bracket form of 822 existing cases changed. About 9,120 trees changed, most of them only by a level of one item that the bracket form collapses. The tags alone changed in 1,951 trees, by the consequence above. For comparison, the measurement above, which nested every repetition, changed the bracket form of 1,819 cll-ebnf trees.

## Elidable optionals and captures

Elidability was a property of a terminal. `%elidable KU` made every optional whose first symbol is `KU` elidable, anywhere in the stage. Now a grammar marks each elidable optional where it writes it, `[+KU #]`, and a plain optional, `[KU #]`, is never elidable. The reasons are these:

- The old rule acted at a distance. An optional changed its meaning when a directive in another document of the stage named its first terminal. A document that several stages include was elidable in some of them and not in others. Now the text of the optional says it.
- The old rule hid the cases that it excluded. `[KU | VAU]`, `[{KU}]` and `[(KU A) B]` began with an elidable terminal, but only some of them were elidable. The rules of engine §3.8 decided which, and a reader of the grammar had to know them. Now an optional that is not marked is plain, and one that is marked has one form, which the reader checks.
- The marker is local, so a wrong test on a terminator is an error of the document. Before, the loader found it only after it stitched the stage.
- The terminator stands directly after the marker. A group there, even `[+(KU) #]`, is an error of the document, although parentheses mean nothing elsewhere. The reason is one spelling and one check. The readers check the written text, while a DOM cannot show a group and checks only the normalized form.

Everything else about an elided terminator stays. That is the elided node, its constituent and the elision vector. It is also the restoration of `elision-only` and its routes, and the saved sound of an `=` test.

Only what selects the optionals changes. The migration marks exactly the optionals that were elidable, so the markers change no elided node and no verdict. The trees that the migration changes are those of the chains and the lists (see "Repetition, lists and chains").

A probe checked every optional of every stage of every bundled dialect. It found none whose elidability or maximality changes. It also found no plain optional that begins with a terminal that the same stage marks.

`[++T]` keeps today's maximal terminators, which only Zantufa uses, for `TOI` and `SEhU`. It is transitional, until the Zantufa redesign (GitHub issues #138 and #139). At that migration, BPFK kept stage-wide `maximal`. The atomic-number change below removes it from the dialect. Maximality now belongs to an optional, not to a terminal. Where every optional of a terminal is written `[++T]`, as in Zantufa, that is the same thing.

Captures used to stand only at the top level of an alternative, at most four of them. Now a capture can stand anywhere except inside braces and inside an elidable optional. An alternative already expands into productions, one for each branch of a choice and each subsequence of `&`. A plain optional that holds a capture now expands in the same way, into the production without it and the productions with it. So a capture is present in some productions and missing in others, as it was missing in some alternatives before.

The rules for a missing capture apply unchanged. They are the presence tests and `⟹` guards, and the conditions and emission items that do not apply. Tag terms are errors unless guarded. The reasons for the change are these:

- Alternatives that differ only in an optional captured part had to be written out. The indicator stage writes `$w`, `$b $w`, `$w $a` and `$b $w $a` as four alternatives. `[$b(bahe-run)] $w(unit) [$a(indicator-run)]` says the same.
- An optional without a capture stays a helper. So no bundled grammar changes, since none holds a capture in an optional.
- An elidable optional stays a helper, because the elided node, the elision vector and the routes of `elision-only` are defined on its helper. So it cannot hold a capture.

A capture still wraps one symbol only. A capture names one constituent, with one span and one tag set, and a group or an optional is no constituent. `$x([a])` says no more than `[$x(a)]`, and `$x((a | b))` needs a rule, as a list does. A name stands at most once in each production, as it did in each alternative. Two branches of a choice are two productions, as two alternatives are. So `A ($x(B) | $x(C))` is valid, and `[$x(A)] $x(B)` and `$x(A) & $x(B)` are errors.

The check runs on the expansions before the gates, so a duplicate is an error of the document whatever the features. The checks of an emission's order and its attachments run per production. They hold there because each name is at most one part of a production, and a production reads its parts in one order.

The limit of four captures is gone. It was never a limit of the engine's design, only of one representation of items. The real cost is that a captured span before the dot is part of an item's identity. Items that differ only in where a captured part ended are not merged. So each capture can multiply the items of a production by up to the length of the input. engine §4 states the cost.

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
- `%features NAME…` names features that the dialect turns on for every parse, wherever it stands. The loader unions the names of every `%features`. A caller (the program or person that asks for a parse) can turn further features on, and can turn any of them off. So a feature that is on by default is a choice that the caller can undo.

The link to each included document stays in the prose, so the pipeline reads as hyperlinked prose on GitHub. The bundled grammars keep a style for this. The block of each `%include` stands under a list item, indented to the item's text. The item's line has an inline link `[text](PATH)` to the same path. The style is not part of jbogenbau, which accepts an `%include` in any block. Only `tools/sync.js --check` enforces it, and only for the bundled grammars.

A link without an `%include` is ordinary prose, so a pipeline can link to CLL or to other dialects freely.

A library reads each document into its DOM on its own, as it reads any grammar. So every document must be complete rules and directives, and its DOM is cached as any other. The library then splices (engine §13). It reads the pipeline's items in order and recursively replaces each `%include` with the included items. It splits the stream at each `%stage`. Every item keeps the document it came from, so errors and the audit still name the document and line that an author wrote.

The result is what textual inclusion gives. Stitching looks only at the order of a stage's rules, never at the documents that hold them (engine §2). A later rule can redefine or extend an earlier one wherever each was written. Stages run in the order they start, and every stage's start rule is `text`. Paths resolve against the including document, in the same way on disk, in memory and on GitHub.

A document can be included in several stages, and an included document can hold `%stage` and `%features` too. So several pipelines can share a stage by including one document that holds it. A stage cannot be reopened: a second `%stage` of one name is an error. That leaves `%extend-stage` and `%redefine-stage` free if a dialect ever needs them.

## Ambiguity

A grammar admits every parse that its rules allow. Where a text has more than one parse, the stage's `%ambiguity-resolution` names the rule that ranks the parses: `greedy`, `lazy` or `late-elision`. A parse is best when no other parse beats it under that rule. A text with one parse has the verdict `unique`. If a text has several parses and exactly one is best, the stage chooses it, and the verdict is `resolved`. If two or more are best, the verdict is `tie`.

`greedy` and `lazy` treat each parse as the sequence of steps that a bottom-up reader takes. A step reads the next token or closes a constituent. The engine compares the parses at the first step where two of them differ:

- If both read the same token under two tags, they are tied.
- If one reads and the other closes, the rule decides. `greedy` takes the one that reads, so a constituent ends as late as the grammar allows. `lazy` takes the one that closes, so a constituent ends as early as the grammar allows.
- If both close different constituents, they are tied.

The preference is like greedy and lazy quantifiers in a backtracking regular-expression engine, and not like the greed of a PEG. The preference orders the parses that the grammar already admits, and never commits. It rejects a text only by leaving a tie. The earliest difference dominates. And the preference applies to every constituent of the stage, not to one quantifier.

`late-elision` compares only the terminators that each parse elides. It counts them at each position between tokens, and compares the counts from the start of the text. These counts are the parse's elision vector. At the first position where the counts differ, the parse with fewer elided terminators wins. In plain words, at the first place where two readings differ in leaving out a terminator, it prefers the reading that reads on. Two parses with the same counts are tied, whatever else differs.

The reason for `late-elision` is that `greedy` decides more than CLL asks. CLL leaves one choice to the parser, the place of an elided terminator. `greedy` also decides every other choice of read against close, such as where a free modifier attaches. So it can hide an ambiguity of the grammar behind a preference that no rule states. `late-elision` decides only the place of elided terminators. Parses with equal counts at every position remain tied, and the grammar settles them with its rules.

The count composes by addition over the packed forest, the shared graph of all parses. So the engine never enumerates the parses (engine §6). It does not depend on the name of a terminator, its depth or the constituent that it ends. "Close an older construct as late as possible" describes some of its results, but the count has no record of which construct is older. It can trade an early elision of one terminator for an early elision of another.

Before this decision, the syntax grammars were greedy, and that was how an elided terminator was placed. That is the historical baseline. The syntax grammars now declare `late-elision` ("Migration to late-elision" below).

The forms stage divides the text into words. The words stage applies the magic words, such as `si`, which act on other words. Both stages are lazy. The word forms divide a run in one way only, so the choice matters only in the words stage. In that stage, a magic word acts on what exists when it is read.

### Ties are errors

A tie is an error of kind `ambiguous`, with the reason `tie`. The stage emits nothing, and no later stage runs. The error shows two of the best parses, and the stage shows the witness, the pair of steps at their first difference. A tied stage gives no warnings, since it has no chosen parse.

Before this decision, a tie was a successful parse. The canonical order of engine §6 then chose one of the tied parses. Among its keys are the numbers of the productions, which follow the order in which an author writes alternatives. So a text got an accepted reading that no rule of the grammar stated.

Now that order, *T*, has a narrower role. *T* orders the ambiguity diagnostics and selects the forbidden terminator that a `maximal` rejection reports. The canonical tie-break keys never turn a tie into an accepted reading.

An error is better than a hidden choice. A reader of the error sees the two readings and where they part. The grammar author settles the choice with a rule, and the rule says why. Every stage follows this, also a stage whose tied parses emit the same tokens, since the grammar is ambiguous there as written.

At the time of this decision (commit 1ea14a1), 5 of the 29,308 corpus records tied at the syntax stage under their dialects' greedy rules. Under `late-elision`, four of them were resolved. The fifth is the case that a separate fix of the experimental grammar covers.

### Elision-only

CLL's own rule is narrower. It says only that a terminator can be elided if no ambiguity results. It says nothing of the other ambiguities that its EBNF has. `elision-only` is one reading of that rule, for the stage whose grammar declares it. CLL does not say which parse to test, so the check tests the one that the ranking chose. It applies the rule only when the ranking of that stage was `resolved`:

1. Take the `elided` nodes of the chosen tree in the order of its leaves, left to right. This order follows the chosen derivation, also where several nodes stand at one point. For each node, insert a synthetic token before the stage-input token at the node's position. The synthetic token carries the tag of that terminator and, for a terminator with an `=` test, the test's string as its sound. The engine marks it synthetic.
2. Parse the new token sequence with the same grammar, in a mode where each elidable optional is restored or written. Every condition, tag and test of a rule reads the original input through a projection that leaves the synthetic tokens out. A test on a terminal reads the written-back terminator's tag and sound. A query parses the original input with the grammar as it is.
3. Rank that forest with no lean. If it has exactly one derivation, the check passes. The chosen parse always has its own derivation there, so the forest is never empty. An empty forest is a defect of the library, the error `elision-witness-lost`.

   With two or more derivations, the ambiguity is not about terminators. The result is an error of kind `ambiguous`, with the reason `elision-only`, and `ok` is false. The error carries the first and the second reading of that ranking, shown over the original input.

The stage ranks, then emits, and then runs the check. A tie ends the stage before emission and before the check. So a stage reports at most one `ambiguous` error, and a tie comes first. A stage that fails the check keeps its output, but no later stage runs.

The two errors share their kind, because both say that the text has two readings. They differ in what the readings are. The readings of a tie are parses of the text as written. Those of `elision-only` hold terminators that the check wrote back. The stage's verdict, `tie` or `resolved`, already tells them apart. The error still carries its reason, so that the error alone says which it is, and the shared tests compare it.

The engine cases pin the definition with these cases:

- Two readings that elide different terminators, for which the check passes
- Two readings that differ with every terminator written, for which the check fails
- A text with its terminators written back whose only reading is the chosen one, for which the check passes
- Several terminators elided at one point

The check's recognizer keeps the strictness of its items (engine §7.4), which a parse without the check never reads. The Rust library keeps it only in the mode of the check. A measurement after that change still found the Rust main parse, with the check off, about 5% slower than the merge base of the branch that added the check: 3.79 ms against 3.59 ms, on a quiet core. The new engine with the old grammars was as slow, so the difference is the engine's. It is near the noise of the machine. The difference is accepted for now. It is to be measured again on a quiet machine, and then chased or closed.

### Independent options

`late-elision` makes neither `maximal` nor `elision-only` redundant, so both keep their order and their meaning. `maximal` (below) removes a parse because of a longer constituent. That constituent need not fit any parse of the whole text. A ranking sees only parses of the whole text, so it cannot reproduce this rejection.

For example, take `text → A body [+T] B` and `body → X | X B`. On `A X B`, the one complete parse uses `body → X` and elides `T`. `maximal` forbids that elision, because `body → X B` is longer, so the text is an error. Without `maximal`, every ranking rule accepts the one parse.

`elision-only` parses again with the terminators written back. That can let another alternative match, or a test on a terminal read a written-back terminator. A ranking of the original parses sees neither. For example, take `text → a | b | c`, `a → A [+T]`, `b → A [+T] [+T]` and `c → A T`. On `A`, `late-elision` prefers `a`, with one elided `T`, to `b`, with two. Written back, `A T` parses through both `a` and `c`, so `elision-only` reports the text.

### Nested queries and elided terminators

A condition can ask whether a span parses as a rule, with `matches`, `begins` or `tags` (engine §4). That nested parse sees every way to read the span, and an elidable optional can be left out anywhere in it. So a nested reading can rely on leaving out a terminator that the same construct reads in the actual text. A nested reading must not do that.

So every nested query follows written-terminator priority (engine §4). A nested reading cannot leave out an elidable optional where the same construct can read that whole optional as written. The query answers from the proof trees that remain. Several such trees are an ordinary success, never a tie. No option turns this priority off.

In Zantufa, `cy to roi toi klama` holds the parenthesis `to roi toi` after the letter `cy`. A condition of `term-2` requires that no tag begins where the term begins. Without priority, the nested parse reads `cy to roi` as the tag `cy roi`. It closes the parenthesis at once, with its `toi` left out, although `toi` is written right after `roi`. So the condition failed, and the dialect rejected the text. With priority, the brackets output is `([cy {to roi toi}] klama)`, as the Zantufa reference parser reads it.

In the experimental dialect, `mi klama na to broda toi` has the same problem. The nested parse of a condition reads `na to broda` as a negated selbri, with `broda` taken from inside the parenthesis. With priority, the brackets output is `(mi [klama {na (to broda toi)}])`. camxes-exp also puts `broda` inside the parenthesis after `na`, and it closes `na` with an elided `ku`.

The priority is a local commitment, not a proof that the shorter reading is impossible. Take `r → A c [+T] T` and `c → B`, on `A B T`. Without priority, `r` leaves out `[+T]` and reads the token as its last `T`. With priority, the token belongs to `[+T]`, so the query fails.

The window of a query is its span. A `matches` over a captured span does not look at a terminator written after the span. A `begins` with `from` or `after` already sees the rest of the input.

The alternative was to apply `maximal` inside nested parses. It was measured in two variants over the parse jobs of the corpus. V1 sought the longer constituent in the whole input of the stage. It changed 39 jobs, and 31 of them became false ties. V2 sought it only in the chart of the query. It changed 24 jobs, and 17 of them became false ties.

Both variants change queries where no terminator is written, so the policy was rejected. Written-terminator priority changed no corpus job. It settles every constructed text of this kind that was tried, in seven Zantufa and four experimental families of conditions.

### Maximal terminators

Some Zantufa conditions accept a nested reading that closes a parenthesis early, with no terminator written. The condition `¬matches($m, terms-vau)` of `fragment` is an example. So `so to mi klama` reads `([so {to mi}] klama)`, while the reference parser reads one mekso fragment, `so` with the parenthesis `to mi klama`. `so to recap` closes an empty `to`. In `ro sei ny rere'u basna mutce cusku`, the `sei` closes before `cusku`.

Written-terminator priority does not settle these texts, because no `toi` or `se'u` is written. A condition cannot say that the content of a construct cannot be longer. An attempt to copy the greed of the reference with conditions rejected 27 texts that the reference accepts.

Stage-wide `maximal` inside nested parses was measured in two variants ("Nested queries and elided terminators" above). V1 searched the whole stage input and changed 39 jobs, with 31 false ties. V2 searched the query's chart and changed 24 jobs, with 17 false ties. That policy applied to every elidable terminator. This feature lets a grammar select single terminators instead. For those selected constructs, a change to a query with no written terminator is the intent.

So a grammar can make single terminators maximal (engine §4). Maximality is the restriction to the longest constituent. `[++T]` selects an optional's terminator for it in the main parse and in nested queries. `%ambiguity-resolution … maximal` also restricts every elidable optional, but in the main parse only, and it selects nothing for nested queries.

The notation first said this with a word on a directive, `%elidable maximal TOI SEhU`, in DOM format 17. Since format 18, it is a second `+` on the optional, `[++TOI #]`. The DOM writes it as `"maximal":true` on the `optional` (see "Elidable optionals and captures"). A maximal terminator is always elidable, so one marker says both.

Inside a query, the longer constituent comes from the query's own chart. A `begins` with `from` or `after` already sees the rest of the input. A bounded `matches` sees only its span, and a constituent that goes on past the span does not count there.

A maximal terminator applies whether or not `%ambiguity-resolution` includes `maximal`. Both forms remove derivations before any ranking rule ranks them. In a query, written-terminator priority and a maximal terminator can each forbid an omission. `elision-only` writes back a maximal terminator as any other.

A rejection names a forbidden terminator only when maximality removes every main derivation. The stage then reads the same chart, with both forms off, to find that terminator. A nested query that maximality changes only changes the value of its condition. If no main derivation remains, the rejection is ordinary, and it lists the terminals expected at the furthest position.

The four libraries already find the furthest completion of each symbol from each origin for `maximal`. Lowering keeps the set of maximal terminals with the lowered grammar, so a cache of lowered grammars tells them apart. The main parse builds the table whenever either form needs it. A nested query builds the same table from its own chart, which costs one pass over that chart.

The engine feature and the choice of terminators are separate decisions. The engine defines what a maximal terminator does. The Zantufa grammar chooses which of its terminators are maximal, and that choice has a cost.

A scope experiment ran 74 cases with `TOI` and `SEhU` maximal, before the fix of `tag-term` below. Maximality in queries alone settles the four motivating readings, and it accepts all 27 texts of the greed experiment. Maximality in both scopes settles the same readings, but it rejects one of the 27, `corpus.camxes.2115`. On the 39 jobs that changed under V1, both choices give the same results: six bracket changes, no rejection and no tie.

Both scopes also rejected the reduced text `sei abu pensi ba ju'o rinka`, which lies outside the 27. The reference and the earlier grammar read it as `[sei abu pensi] [ba ju'o rinka]`. The chart then held the longer statement `abu pensi ba`, with `ba` as a tag on its own. The longer constituent need not fit the enclosing construct, so maximality forbade the elided `se'u` after `pensi` in the main parse.

The Zantufa `tag-term` now has the condition `¬begins(after($t), free)`. It removes that spurious candidate. In the reference, the tag is `ba ju'o`, so the `sei` ends after `pensi`. With this condition, both `corpus.camxes.2115` and the reduced text keep their readings.

The main-parse scope enforces the declared restriction on main derivations, whatever the conditions say. The measurements do not show that the four motivating readings need it. They also do not show that it is useless in general. The approved semantics keeps both scopes.

Whether Zantufa also makes `LIhU` maximal is undecided.

A bounded query stays within its span. A `matches` over a captured span asks whether that span alone parses as the rule. A longer constituent past the span is outside that question. Looking past the span changes the windows and the memo keys of every query.

### Where an elided terminator can fall

`elision-only` settles which reading a text has. It does not settle whether a reading that needs an elided terminator counts at all. CLL's rule, "if no grammatical ambiguity results", has three readings, and the grammar that CLL prints does not choose among them:

- The printed grammar, read literally, counts every parse: a terminator can be elided wherever a parse of the whole text needs it. `le lojbo se farvi le loglo gi'enai mintu ja dunli le logla` parses, with the description ending before `se farvi`.
- CLL's official parser reads one lexeme ahead and never goes back. A lexeme is one unit that the parser reads. It is a word, or a run of words that the parser joins. The parser elides a terminator only through the error recovery of its grammar, where the next lexeme cannot continue what it is reading. CLL's own explanations of elision describe this. That is why CLL 14.14 says that `le nanmu ku joi le ninmu` needs its `ku`.
- The PEG grammars that replaced the YACC grammar (the grammar of the official parser) commit too, but in another way. What a PEG read before an elided terminator runs as far as it can be read. So `le nanmu joi le ninmu` parses, and the `le lojbo` text does not.

The notation offers the third reading as `maximal` (engine §4). It is a condition on which parses count, stated over the recognizer's items. It does not order the alternatives of a rule, so a grammar stays a description of its language. BPFK formerly read elided terminators this way because the definition effort also adopted the PEG. The atomic-number change below replaces that policy.

The cll-ebnf and bpfk dialects take the printed grammar as normative and keep the whole-text reading. So do the experimental and Zantufa dialects, which accept the most. Zantufa has explicit exceptions for `TOI` and `SEhU`, which are maximal terminators and commit as the PEG does. Its grammar document lists the three texts that it rejects for this reason. The cll-ebnf and bpfk dialects each name their reading in their pipeline documents, after they include the CLL grammar. A stage states its `%ambiguity-resolution` exactly once, so the experimental layer over the CLL grammar states its own.

A measurement at the time `maximal` was specified used the 24,552 CLL cases that the corpus then held. There, `maximal` rejects 68 texts that the literal reading accepts, and camxes-std, the reference PEG, rejects 66 of them. `maximal` changes the chosen reading of no text that it accepts. In 2,892 texts, it removes only parses that the greedy ranking already beat, so their verdict becomes `unique` instead of `resolved`.

Of the other two texts, camxes-std reads one as a forethought termset without `nu'i`, which the CLL grammar does not have. In the other text, `maximal` sees a longer constituent that splits the number `paso` in two. A PEG never does that, because its number is greedy as well.

The official parser's reading is not in the notation. Its lookahead is a lexeme, not a word. Step 5 of its preamble, the steps that prepare the words for its grammar, joins runs of words into one lexeme. Examples are the connective `na ja`, or a number followed by `moi`. A rule that reads one word ahead over a stage's tokens sees the `na` of `le nanla na vrude` as the start of `na ja`. Tried word by word, such a rule rejected 369 texts of the corpus that the official parser accepts.

A dialect that reads as the official parser does needs that preparser as a stage of its own ([issue 28](https://github.com/int19h/gencmu/issues/28)). The same preparser settles ambiguities that the printed grammar leaves open, such as a gihek or joik directly before `ke`. In the historical baseline, the dialects here left these ambiguities as the printed grammar has them. So `mi broda joi ke brode ke'e` had two readings that differ in more than a terminator, and `elision-only` reported it. The CLL conditions on a plain joik and on a plain gihek now settle both cases ("Migration to late-elision" below).

In a historical measurement on the prototype's corpus, `elision-only` cost the CLL grammar nothing. Every one of its 8,853 ambiguous texts became unambiguous with its terminators written out. The extended grammars were different: 63 experimental and 74 Zantufa texts stayed ambiguous. Some of the Zantufa texts stayed ambiguous through its mekso (its grammar for mathematics).

In the historical baseline, two sumti (arguments of a predicate) joined by a connective between them caused such an ambiguity in the experimental grammar. A term is a wider kind of argument that includes the sumti. The grammar also read the two sumti as two terms joined in the same way, with or without `bo`. So `mi .e do klama` and `mi .e bo do klama` each had two readings. The experimental rule for sumti connections now settles both.

In the historical baseline, the CLL syntax dialects declared `%ambiguity-resolution greedy elision-only`, with `maximal` in bpfk. The extended dialects declared `greedy`. Each dialect has prose that gives its reasons.

A parse option overrides `elision-only` either way. A caller switches it on to find ambiguities that are not about terminators in the supplied text, or off to loosen the CLL dialect. The rule itself (`greedy`, `lazy` or `late-elision`) cannot be overridden, because each rule gives a different language, not a variation. A lazy syntax and a greedy word grammar are examples.

At the time of this decision (commit 1ea14a1), a measurement on the same 29,308 records compared `late-elision` with `greedy` at the syntax stage. It kept each dialect's `maximal` and `elision-only`. In cll-ebnf and bpfk, `late-elision` chose the same tree for every text that parses, and left no tie. In the experimental dialect, it changed 1 tree and left 26 ties. These were 25 actionable ties, and one that a separate fix of the grammar covers. In Zantufa, it changed 4 trees and left 30 ties.

Those Zantufa results come from the earlier Zantufa grammar. That grammar listed `CU` in `%elidable` and had no attachment rules. So the count moved an elided `cu`, and some trees regressed, such as a JAI moved into the terms and numeric subscripts split apart. The migration below removes both causes.

Most of those ties are choices of the grammar, not of terminators. Examples are a connective inside a sumti or between terms, a BE group, nested subscripts, and where a free modifier attaches in Zantufa. `greedy` settled them by its preference for a read, which no rule of the grammar states.

### Migration to late-elision

The syntax stage of all four Lojban dialects declares `late-elision`. The grammar changes that this needs come with the engine change, on the same branch. At this migration, cll-ebnf kept `elision-only`, and bpfk kept both `elision-only` and `maximal`. The atomic-number change below removes the BPFK stage option.

The CLL grammar gains the condition that the official parser's lexer applies with `JOIK_KE`. A plain joik is a joik in the ordinary connective alternative of a rule, which joins two units. It is not the joik of the dedicated alternative `joik [stag] KE … KEhE`, which groups with the connective itself. Where both alternatives can read the same words, a unit that starts with `ke` cannot directly follow a plain joik.

The condition stands in `selbri-4` and in `operator`, the two rules where a joik overlap exists. It removes the plain reading only where the unit after the joik is only a `ke` group, so that the two readings compete. So `mi broda joi ke brode ke'e bo brodi` keeps its one plain reading, as in the printed grammar and camxes. The official parser rejects it. So `mi broda joi ke brode ke'e` keeps only its reading through `joik KE selbri-3 KEhE`. In the same way, `li ci su'i joi ke pi'i ke'e re du li xa` keeps only the operator's own `ke` group. The `sumti` and `operand` rules have a joik-plus-`ke` alternative too, but no competing alternative, so they need no condition.

The condition covers no jek, because the dedicated form takes only a joik. So `mi broda je ke brode ke'e` has one reading, a jek before a tanru unit grouped with `ke`.

The CLL grammar also gains the condition that the official parser's lexer applies with `GIhEK_KE`, in the rule `bridi-tail-1-final` of the CLL grammar. The `ke` form of `bridi-tail` groups the tails after a gihek, as in `mi broda gi'e ke brode ke'e`. A plain gihek can read the same words. "Sentences and bridi-tails" in [the CLL grammar](../grammars/syntax/cll.md) states the condition, which removes the plain reading in some of these texts. Where only the plain reading parses, as in `mi broda gi'e ke brode ke'e brodi`, the grammar keeps it, as the printed grammar does. The official parser rejects that text.

The experimental dialect redefines `selbri-4` and `operator`, so a condition on the CLL definitions does not reach it (engine §2). Its own definitions of both rules state the same condition. It also redefines `bridi-tail` and `bridi-tail-1`, so the CLL gihek condition does not reach it either. The CLL rules `bridi-tail-1-final` and `free-modifiers` are unused there. They join the other CLL rules that `audit` reports as unreachable in that dialect. It also states three conventions as rules:

- A connection that can be a sumti connection is a sumti connection, and not a connection of terms.
- A `be` group attaches to the preceding unit when there is one.
- A subscript after a subscript nests, as CLL 18.13 says.

The gek quantifier conflict and `.i` plus ek are separate fixes of the experimental grammar (pull request 114). They are not among these conventions.

The Zantufa grammar states its attachment conventions as rules, derived from its reference parser:

- A free modifier nests in the nearest open slot. The rule stands on `free`, not on each slot. So the dialect keeps its departure from CLL 19.6 in `mi klama pamai le zarci .e remai le zdani`.
- A sumti connection comes before a term connection.
- An operator run is read whole, and the operand after it is read wherever one follows.
- A gek before bridi-tails begins a bridi-tail, not a connection of sentences. In `mi ge klama gi cadzu`, it begins a forethought tanru unit inside the bridi-tail. A bridi-tail that a further `gi` follows does not count, because the reference's runs of `gik` read as far as they can.

Other conditions state the reference's ordered choices where the ranking would leave a tie. A gek tanru unit comes before the forms with `se`, `fa` and `na'e`. A `cei` run nests to the right. The tenses and modals before `ke` and a gek-bridi-tail are one tag. A `ke` group of terms comes before a `ke` sumti.

The vocative follows the reference. Zantufa merges cmevla and brivla, so a name is an ordinary tanru unit. The selbri of an address reads as far as it can, so `doi djan klama` is one vocative with the address `djan klama`. The dialect also keeps an odd reading of the reference. In `pe'usai doi xod ko jmina fi lo kamjikca lisri`, the vocative `pe'u` takes `ko` as its address, so `jmina` has no first place.

Zantufa marks neither `CU` nor `IAU` as elidable, as CLL's grammar does not mark `CU`. Both are separators, and neither closes a constituent. So both are plain optionals, `[CU #]` and `[IAU #]`. An absent `cu` or `i'au` counts for nothing, leaves no `elided` node, and `maximal` and `elision-only` do not see it. The marker is the only control, and the ranker has no logic for `CU` or for any other terminal.

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

An absent elidable optional leaves an `elided` node with an empty span, at the place of the missing terminator. Collapsing chains is a choice of the renderers, not of the tree. `text` and `phonemes` are not stored on nodes. The libraries compute them from the tokens, so that the two cannot disagree.

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
- The Go module `github.com/int19h/gencmu/lib/go`, imported as `gencmu "github.com/int19h/gencmu/lib/go"`, whose versions are tagged `lib/go/vX.Y.Z` because it is in a subdirectory
- The crate `gencmu` (`lib/rust/`)

Each contains its grammar copy and nothing from outside its directory. CI makes sure of this: it builds each artifact from a clean checkout (`npm pack`, `python -m build`, `go build` from a module-mode checkout, `cargo package`).

## Diagnostics and debugging

These are the product, not an afterthought:

- A rejection names the stage, and shows the source line with a caret under the failing character or word. It lists what can continue at that point as grammar terms, grouped by rule, not as a set of tag names.
- A grammar error carries file, line and column, and names the rule.
- A tie shows the two derivations side by side from the first difference.
- Stage inspection shows the tokens that every stage emitted, with their tags.
- The trace shows, for one position, which items the recognizer predicted, advanced, completed and dropped, and which condition dropped them. This is the tool for "why does my grammar not accept this".
- The audit reports undefined and unreachable rules, every rule that a later document replaced or extended, and `%emits ε` that changes nothing. Such an `%emits ε` is over text that can never emit a token or be covered by one. The audit data lists every membership change, with its key, class, gates and document. The printed report shows the gated memberships and those that more than one entry changes. A condition that applies to no alternative is not an audit finding. It is an error of the grammar.

## CLI and playground

The CLI is `node lib/js/cli.js` (and `npx gencmu` once published). It has these commands:

- `parse`, to parse a text, with options that include `--dialect`, `--feature` and `--no-feature`, `--until`, `--format brackets|tree|json|canonical|tokens` and `--trace`
- `dialects`, to list the bundled dialects
- `features`, to list a dialect's features
- `audit`, to report the undefined, unreachable, replaced and extended rules of a dialect
- `stitch`, to print a dialect's pipeline as one jbogenbau text, with each classifier's entries as written
- `test`, to check a grammar author's own file of corpus-format cases against a dialect. It compares each case as the library's corpus runner does, with the same code. It checks the cases, not the engine, so it runs none of the engine's self-checks, such as the witness hook of `elision-only`
- `help`, to list the commands and every option

`parse` prints any warning on standard error, as it prints an error, a tie included. The CLI needs Node and nothing else.

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
- An editor for the grammar documents, which parses the text again at once after each edit and lets the user download the edited documents

The editor lists a dialect's documents stage by stage. A forgiving scan of the `%stage` and `%include` directives finds them (`playground/pipeline.js`). So a pipeline with an error, a missing document or a cycle still shows every document it reaches. Parsing runs in a worker (a `Blob` worker, which also works from `file://`), so a long text does not freeze the page.

## Output formats

`docs/output.md` defines the output formats exactly. JavaScript implements them for the CLI and the playground, and every library implements the bracket form for the tests:

- `brackets` is the tree as nested groups, cycling `( ) [ ] { }` by depth. The renderer collapses groups of one child, and leaves show their labels, with stress. An option shows elided terminators in angle brackets, `⟨ku⟩`, or hides them.
- `tree` is an indented listing, one node per line, with the rule name and the text.
- `json` is the display JSON, a projection of the tree for reading. It is pretty-printed so that a node with one child stays on one line with its parent, as in `{"tanru-unit-2": {"BRIVLA": "mlatu"}}`. This keeps deep trees readable.
- `canonical` is the canonical JSON of the whole result, which the shared tests compare.

## Documents

Every paragraph, heading and table row of a Markdown document in the repository stands on one line. A list item can hold several paragraphs, each on its own line. Some renderers show a line break inside a paragraph as a break. A code span closes on the line where it opens. A paragraph can follow a heading directly. The content of a fenced block is not prose.

The tools list the repository's documents in one way (`tools/documents.js`). In a git checkout whose top level is the repository, the documents are those that git tracks. Anywhere else, such as in an exported tree, they are every Markdown file under the repository, less those in hidden directories and in the `node_modules` and `target` directories of tools and builds. `tools/sync.js` fails when git does not track a grammar file that it would bundle.

`tools/sync.js --check` reads each document with a CommonMark and GFM parser (`tools/markdown.js`). So it sees each block where GitHub sees it. It reports these layouts (`tools/prose-lines.js`):

- a line that continues a paragraph or a heading, such as a lazy continuation line or the underline of a setext heading
- a table row that does not begin with `|`, such as a line of prose right after a table, which the table takes in as a row
- a code span that closes on a later line, and a backtick that opens no code span
- a fenced block with no closing fence, which takes in the rest of its container
- an indented code block, such as a paragraph indented too far in a list item, and an HTML block, since either can hide prose

The check of quoted texts relies on this rule, since it gives each text the line of its code span (`tools/quoted-texts.js`).

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

  `expect` is whether gencmu is meant to accept the text, `words` the tokens of the word stage, and `brackets` the tree. A full result for each case needs hundreds of megabytes. The engine cases pin down the full result, and the corpus pins what a Lojban reader cares about.

The corpus was seeded once from the prototype's fixtures and their verdicts. Some cases are meant to differ from the verdict that they were seeded with. Such a case says so in its own terms: `"seeded": "reject", "reason": "..."`. The case states its reason in terms of the grammars of gencmu. One reason is "`sa bu` backs up to the `bu` of the last letter word, as the unique cases of the Magic Words proposal say". Those two fields make every departure from the seed visible in review, and a script lists them.

A change to a case's expected `words` or `brackets` needs no field of its own. It is a change to what gencmu produces. The author of the change makes it in the same commit as the grammar change that causes it. The message of that commit explains it. After seeding, the corpus is ours: a change that alters an expectation updates the file in the same commit.

Every library runs the whole corpus. On a pull request, a core of about 1,650 cases (`tests/core.txt`) runs in every language. It is a sample, together with the cases that pin the texts that the grammar documents quote. Rust and JavaScript also run the whole corpus there. All four languages run the whole corpus nightly and before a release, sharded if Python needs it. No language is permanently exempt.

## CI

CI has two workflows. `nightly.yml` runs the whole corpus in all four languages each night and on demand. `ci.yml` runs on each pull request and each push to `main`. It has three additional jobs: the playground in two browsers, the whole corpus in JavaScript, and the JavaScript types. It also has one job for each language, which runs on the oldest and the newest supported toolchain:

- JavaScript: Node 20 and current, the bundle freshness check, `node --test`, and `npm pack --dry-run` to make sure that the package holds its files
- Python: 3.10 and current, `python -m unittest`, `python -m build` for the wheel, and the tests again from the installed wheel
- Go: 1.22, the minimum of the module, and current, `go vet`, `go test`, `go test -race` for concurrent parses, and a build of the module alone
- Rust: its minimum version and stable, `cargo fmt --check`, `cargo clippy`, `cargo test`, `cargo package` to make sure that the crate is self-contained, and the whole corpus on stable

The Python build backend is the only tool outside the standard library, and only at build time. Third-party actions are pinned by commit hash. GitHub Pages serves `main` from the root with no workflow.

## Standard library only

This holds for every target. JavaScript needs nothing beyond the language and, for the CLI, Node's `fs`. Python's standard library has everything, `json` included. Go's has `embed` and `encoding/json`. Rust's has no JSON reader, so the Rust library carries a small one for the files it ships, and it writes JSON by hand. That is a few hundred lines, and the one real cost of the rule.

The rule covers what building and running need, not the tools that CI runs to make sure that the code is correct. The JavaScript sources carry JSDoc type annotations. In CI, TypeScript makes sure that the annotations are type-correct, with `strict` on. TypeScript is a development dependency of the package, with Node's type definitions for the Node entry point. Nothing runs it to build, test or use the library.

TypeScript writes declarations from the annotations into `lib/js/types/`. These declarations are checked in, like the other generated files, and the published package includes them. CI makes sure that they are up to date. So a client in TypeScript, or an editor, gets the library's types without a build step in gencmu. Playwright is also a development dependency of the package: it drives the playground's smoke test in a browser, and nothing else.

## Gates and warnings

A dialect that extends another makes two kinds of change. Most are additions, which the base grammar rejects and the dialect accepts, such as `cu` before a bare selbri (a predicate) in the experimental dialect. Some change how the dialect reads a text that the base grammar accepts. An example is the cmevla-brivla merger, which lets a name word (cmevla) also act as a predicate word (brivla). Under the merger, `la .alis. klama` is one description. The notation has a kind of feature guard for each kind of change.

An addition is a warning, `name!`. Its alternative is there whether the feature is on or off, so turning the feature on changes no verdict and no tree. It only adds a warning to the result for each place where the chosen tree uses the alternative. The warning names the feature and the text. The dialect turns none of its warnings on, so its texts parse without warnings by default. A reader who wants to know which additions a text relies on turns them on.

A warning is on the chosen tree only. An addition that only a losing reading uses is not reported. A tie has no chosen tree, so it reports no warnings. The idea comes from jbotci, another Lojban parser, which warns where an experimental construct makes a text parse that the standard grammar rejects. The experimental syntax is already a layer over the CLL grammar, but its additions are not warnings yet. The one bundled warning is `y-cmavo`, in the word stage of the cll-ebnf dialect.

A change of reading is a gate, `name?`, with the old form under `¬name?`, so that exactly one of the two is live. A warning cannot express it, because a warning keeps its alternative even with the feature off. The base reading is then gone either way. A dialect that makes such a change turns its gate on by default, and a caller who wants the base reading turns it off. Gates are also how a grammar keeps an expensive construct out of the parses that do not need it (see below).

A name is one kind or the other in a dialect. It is an error to load a dialect in which one guard uses a name as a gate and another uses it as a warning. Turning the feature on then means two things.

Features are chosen one by one because an extension is not one decision. camxes-exp, the reference of the experimental dialect, is a bundle of changes that people adopt separately. Some people use the merger and some do not. A feature that composes with the rest by plain addition stays selectable on its own. A change that cannot be made selectable without a convoluted grammar is made unconditionally in the dialect's documents, and its documents say so.

## Expensive constructs behind features

The erasers `sa` and `su` reach back over any number of words. So the parser keeps a possible reach open from the most recent word of each selma'o (word class). It does not know whether a `sa` will come. A reach can run back to the start of the text, as an unmatched `sa` or a `su` does. Such a reach begins with a rule anchored there by `initial`, so the parser reads it once.

The cost then grows in proportion to the text, but each word costs more. In JavaScript, a text of 13,700 characters takes about 22 seconds with the feature and 6.5 without it. These erasers are rare, so they are behind a feature, `sa-su`.

Without the feature, the words of SA and SU are ordinary words. The syntax rejects a token of SA or SU that is still there after the word stage. But another magic word can act on such a token first. So `mi su si do` reads as `mi do` without the feature, because `si` erases the `su`. With the feature, it reads as `do`.

The libraries' `auto_features` parse a text's word stage once without the feature. They enable the feature if the run does not reach an accepting word stage. They also enable it if the chosen tree of that stage has a `word` constituent tagged SA or SU. That word can be anywhere in the tree, erased by a `si` or not. A text with no such word parses the same either way. The CLI and the playground use `auto_features` by default.

The engine can later make this unnecessary: it can stop predicting a rule whose required words cannot occur in the rest of the input. That is an optimization to specify once it is understood, and it is not part of the first version.

## What came from the prototype

Three things came from the prototype:

- The grammar documents, rewritten where they referred to the prototype, other parsers or research notes, and converted to the notation above
- The notation document
- The fixture corpus, converted to the format above

The repository keeps the corpus whole. With the cases added since, it now has about 29,000 cases and 7 MB with words and brackets.

Nothing else came from the prototype: no code, no scripts, no notes. The maintainers edit the CLL lexicon by hand. The experimental and Zantufa lexicons come from the word tables of other parsers. `tools/peg-lexicon.js` generates each of them, and a maintainer changes one by running the tool again. The Zantufa grammar is a grammar of its own, as above.

## Atomic numbers and letter strings

Both CLL dialects now use `late-elision elision-only`. Their numbers and letter strings cannot end before another continuation unit. The continuation is `PA | lerfu-word`, with complete recursive LAU atoms and balanced TEI/FOI compounds. CLL 17.9 and 18.6 require a separator between adjacent runs. CLL 17.14 states which forms count as letter atoms.

The wrappers test each completed boundary. The bodies keep brace notation and all prefixes that their repetition needs. The experimental and Zantufa number rules stay the same. Stage-wide `maximal` remains available in the specification and libraries until their separate retirement.

The Rust corpus comparison recovers BPFK readings that cll-ebnf already accepts under the shared elision policy. This includes CLL 8.48 without `ku'o`, despite the requirement in CLL 8.6. The maintainer approves that policy as an interpretation of CLL 21.2 note 10. The number and letter boundaries separately follow CLL 17.9 and 18.6.
