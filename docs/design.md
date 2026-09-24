# gencmu: design

Status: proposal, for review before any code is written.

## What gencmu is

A standalone Lojban parser whose grammar is data. Every layer of the language,
from characters to phonemes, phonemes to words, words to a parse tree, is a
literate grammar document in one notation, loaded at runtime. A dialect is a
pipeline document that lists which grammar documents make up each stage. The
people this is for want to read a grammar, change it, and see at once what the
change does to a text, so the notation, the diagnostics and the interactive
tools matter as much as the parser.

gencmu ships:

- four libraries, JavaScript, Python, Go and Rust, each a clean-room
  implementation of one engine specification, with no dependencies beyond
  the language's standard library;
- the grammars and dialect pipelines, shared by all four;
- one command-line tool and one web playground, both in JavaScript, both
  runnable from a clone with no install step;
- one test corpus, shared by all four libraries, whose expectations are what
  gencmu itself is meant to produce.

What it does not ship: research notes, comparisons with other parsers, the
scripts that produced the corpus. Those stay in the prototype repository.

## Repository layout

```
index.html                 web playground; GitHub Pages serves the repo root
playground/                playground scripts and styles, relative paths only
grammars/                  the grammar documents, the single source of truth
  phonemes/                characters to phonemes: latin, cyrillic, zbalermorna
  words/                   phonemes to words: stream, shapes, families, lexicons
  indicators/              the non-formal indicator and ba'e rule
  syntax/                  the syntax grammars
  dialects/                pipeline documents: cll, bpfk, experimental, zantufa
docs/
  notation.md              the grammar notation, for grammar authors
  engine.md                the engine specification, for implementers
  api.md                   the library API, per language
  output.md                the output formats, defined exactly
tests/
  engine/                  small grammars with expected parses: the engine spec as tests
  corpus/                  Lojban texts with expected verdicts and trees
  core.txt                 the ids of the corpus subset every language runs in CI
js/                        npm package `gencmu`: library and CLI (`js/cli.js`)
python/                    Python package `gencmu`
go/                        Go module `github.com/int19h/gencmu/go`, package `gencmu`
rust/                      crate `gencmu`
dist/                      the browser bundle and the grammar bundle
tools/sync.js              regenerates every generated file below
.github/workflows/         CI
```

**Generated files are checked in and verified.** `grammars/` is the single
source. Each package needs its own copy, because every ecosystem's packaging
refuses files outside the package directory and Go's `embed` also refuses
symbolic links: `js/grammars/`, `python/src/gencmu/grammars/`,
`go/grammars/`, `rust/grammars/`, and `dist/grammars.js` for the browser.
`dist/gencmu.js`, the library as one classic script, is generated too, so
that `index.html` works from a clone opened with a double click and from
GitHub Pages without a build step. One Node script with no dependencies,
`node tools/sync.js`, writes all of them; CI runs it and fails if anything
changed. A contributor edits `grammars/` and runs one command.

## The engine

The four libraries implement one specification, `docs/engine.md`, written
first and precisely enough that two implementations cannot legitimately
differ. It covers:

1. **Reading documents.** Fenced `ebnf` blocks of a Markdown document; the
   notation of `notation.md` (sequence, `[ ]`, `...`, `&`, `/ /`, `#`, `ε`,
   `@feature` guards, captures `$x( )`, tags `< >`, phoneme tags `/a/`, `⇒`
   emission, `:` conditions with `,` and `∨`, the `prefer` declaration);
   stitching several documents into one grammar by unioning the alternatives
   of rules with the same name. Errors carry file, line and column.
2. **Lowering** to a context-free grammar with named helper rules for the
   sugar, which diagnostics hide.
3. **Recognition.** An Earley parser whose items record, for each captured
   part, its span and the identity of its tag set, and which evaluates
   conditions the moment their last capture is read. Nested parses for
   `matches(span, rule)` and `tags(span, rule)` share their memo with the
   parse that started them; a nested parse asked about its own span is a
   grammar error.
4. **Choosing a parse.** The first-difference order over bottom-up action
   sequences, with the grammar's `read-on` or `close-early` preference and
   strong-over-weak tags; the verdicts unique, resolved, tie; the tie
   witness.
5. **Emission** of the next stage's tokens, each with its text, its phonemes
   and its source range.
6. **The pipeline**: stages in order, stopping at the first rejection.

The specification is tested by `tests/engine/`: each case is a small grammar,
an input, and the complete expected result in the canonical JSON of
`docs/output.md`, so a fifth implementation can be checked without the
Lojban grammars at all. The cases are written together with the
specification, one or more per rule of it, and they settle the edge cases
that decide which parse comes out, before the Lojban corpus can become the
specification by accident:

- **Ties.** A tie is a successful parse (`ok` is true) with the verdict
  `tie` and a witness. The chosen tree is the first of the tied derivations
  in a canonical order: at the first difference, the lower production index,
  where productions are numbered in document order after stitching. The tie
  is never silent: every surface shows it.
- **Emission from a tie.** A non-final stage emits the chosen derivation.
  Every derivation tied with it at the first difference is also emitted; if
  each emits the same token sequence, equal in span, source, text and
  phonemes and differing at most in tags, the tie is resolved: the
  derivations were one analysis, their tag sets are unioned token by token
  (a tag strong on any side is strong), and the verdict is `resolved`. If
  any differs in anything but tags, the stage's tie stands and its witness
  names the first two that differ. The engine cases include a three-way tie
  of each kind.
- **Empty spans and cycles.** Nullable rules, empty captures, a condition on
  an empty span, a unary cycle `a ≔ b`, `b ≔ a`, and a nested parse asked
  about its own span, each with its defined outcome.

**Coordinates.** Every position in a result is a half-open range. Source
positions count Unicode code points, not bytes or UTF-16 units, so that the
four languages agree on non-ASCII text; each library converts at its edge
(JavaScript from UTF-16, Go and Rust from UTF-8). Line and column in
diagnostics are derived from code points, lines split at `\n`, `\r\n` and
`\r`. A token's `span` is a range of the previous stage's tokens, and its
`source` is the range from its first covered character to its last: always
contiguous, because a token covers a contiguous run of the tokens below it,
even when some of them emitted nothing, as an erased word inside a compound
does. A token inserted by an emission clause has an empty span and an empty
source range at the position where it was inserted, and its provenance is
that emission: it records the rule whose clause inserted it. Following
`span` from stage to stage, or `inserted-by` where a token has no span,
explains any token down to the characters or to the rule that made it.

## The result, and why it has no types

The tree's shape is decided by the grammar, which is loaded at runtime, so no
language gets a typed tree. Every library returns the same generic structure:

```
ParseResult
  ok            whether every stage accepted
  stages        per stage: name, input tokens, output tokens, verdict, tie witness, rejection
  tree          the last stage's chosen tree, or none
  error         the first rejection, with source position and what was expected

Node
  kind          "rule" or "token"
  rule          the rule the author wrote (for a token: the terminal it was read as)
  children      nodes, in text order
  span          token range in the stage's input
  source        code-point range in the original text
  tags          its tag set, each tag strong or weak
  token         for a token node: the stage-input token itself
```

The tree is lossless with respect to the grammar the author wrote: every
rule the parse went through is a node, including chains of single-child
rules, so a program can tell `sumti-6` from `sumti`. Only the helper rules
that lowering invents for `[ ]`, `...`, `/ /`, `&` and `#` are spliced out,
since no author wrote them. Collapsing chains is a choice of the renderers,
not of the tree. `text` and `phonemes` are not stored on nodes; the
libraries compute them from the tokens, so that the two cannot disagree.

Each library exposes this idiomatically: plain objects and arrays in
JavaScript, dataclasses in Python, structs with slices in Go, structs with
`Vec` and borrowed `&str` in Rust. Each can serialize a result to the
canonical JSON of `docs/output.md`, and each renders the canonical bracket
form, since the shared tests compare it.

## The API

The same shape in every language, spelled idiomatically:

```
dialect = load_dialect("cll")                 # a bundled dialect by name
dialect = load_dialect_file("my/pipeline.md") # or a pipeline document on disk
dialect = load_dialect_sources({path: text})  # or documents held in memory, for the browser
result  = dialect.parse(text, features={"cbm"}, until="words")
result.ok; result.tree; result.error.describe()
to_json(result); to_brackets(result)
```

The bundled grammars are embedded in each package, so a library works with
no files beside it, and any grammar can also be supplied from disk or from
memory. In-memory sources are a map from path to text; paths are
`/`-separated and relative to a virtual root, and a pipeline's document
paths are resolved against the pipeline's own path with `.` and `..`
normalized, exactly as on disk. The bundled dialects are that same map.
Parsing is synchronous everywhere; the browser runs it in a worker.

The distributable artifacts are exactly: the npm package `gencmu` (the `js/`
directory); the Python distribution `gencmu` (`python/`, a pure-Python wheel);
the Go module `github.com/int19h/gencmu/go` (import it as
`gencmu "github.com/int19h/gencmu/go"`; a Go module in a subdirectory is
tagged `go/vX.Y.Z`); the crate `gencmu` (`rust/`). Each contains its grammar
copy and nothing from outside its directory, which CI proves by building
each from a clean checkout (`npm pack`, `python -m build`, `go build` from a
module-mode checkout, `cargo package`).

## Diagnostics and debugging

These are the product, not an afterthought:

- **Rejections** name the stage, show the source line with a caret under the
  failing character or word, and list what could have continued as grammar
  terms, grouped by rule, rather than as a set of tag names.
- **Grammar errors** carry file, line and column, and name the rule.
- **Ties** show the two derivations side by side from the first difference.
- **Stage inspection**: the tokens every stage emitted, with their tags.
- **Trace**: for one position, which items were predicted, completed and
  dropped, and which condition dropped them. This is the tool for "why does
  my grammar not accept this".
- **Audit**: undefined and unreachable rules, rules no document declares a
  preference for, conditions that never apply to any alternative.

## CLI and playground

The CLI is `node js/cli.js` (and `npx gencmu` once published): `parse` with
`--dialect`, `--feature`, `--until`, `--format brackets|tree|json|tokens`,
`--trace`; `audit`; `test` to run a test file against a dialect. It needs
Node and nothing else.

The playground is `index.html` with `dist/gencmu.js` and `dist/grammars.js`
loaded as classic scripts, so it works from `file://`, where browsers refuse
ES modules, and from GitHub Pages alike. Nothing is fetched: the grammars are
a JavaScript object in `dist/grammars.js`, and the worker is built from a
`Blob` whose text is the library source plus the grammar object, passed from
the page, so the worker fetches nothing either. This is the riskiest part of
the design, so it is proved first, before the library exists, with a stub
parser: a page that starts a blob worker from `file://` and gets an answer,
checked in current Chrome and Firefox, and in CI with the headless Chrome
that GitHub's runners already have (`--headless --dump-dom` on a `file://`
URL), with no test framework. The same smoke test runs against the Pages
URL after each deploy, to catch an absolute path. It has: the text; the dialect and
feature switches; the output in the three formats and the per-stage tokens;
the diagnostics above; and an editor for the grammar documents, whose edits
reparse the text at once and can be downloaded. Parsing runs in a worker
(a `Blob` worker, which also works from `file://`), so a long text does not
freeze the page.

## Output formats

Defined exactly in `docs/output.md`, implemented in JavaScript for the CLI
and the playground, and the bracket form in every library for the tests:

- **brackets**: the tree as nested groups, cycling `( ) [ ] { }` by depth,
  groups of one child collapsed, leaves as their phonemes with stress shown;
- **tree**: an indented listing, one node per line, rule name and text;
- **json**: the canonical JSON, pretty-printed so that a node with one field
  stays on one line with its parent, `{"sumti": {"text": "lo mlatu"}}`,
  which keeps deep trees readable.

## Tests

Two kinds of shared test, both run by every library:

- `tests/engine/`: the engine specification's cases, each checked against the
  complete canonical result JSON, stages, tokens, tags, verdicts, witnesses,
  errors and coordinates included.
- `tests/corpus/*.jsonl`: Lojban texts, one case per line:

  ```
  {"id": "cll-10-183", "text": "puzu", "dialect": "cll", "features": [],
   "expect": "accept", "verdict": "resolved", "words": ["pu", "zu"],
   "brackets": "(pu zu)"}
  ```

  `expect` is whether gencmu is meant to accept the text, `words` the tokens
  of the word stage, and `brackets` the tree. A full result per case would
  make the corpus hundreds of megabytes; the engine cases are where the full
  result is pinned down, and the corpus pins what a Lojban reader cares
  about.

The corpus is seeded once from the prototype's fixtures and their verdicts.
Where gencmu is meant to differ from the verdict a case was seeded with, the
case says so in its own terms: `"seeded": "reject", "reason": "..."`, the
reason stated in terms of gencmu's grammars, such as "CLL 19.13: `sa` erases
back to the second nearest match". Those two fields make every departure
from the seed visible in review, and a script lists them. A change to a
case's expected `words` or `brackets` needs no field of its own: it is a
change to what gencmu produces, made in the same commit as the grammar
change that causes it and explained in that commit's message. After seeding, the
corpus is ours: a change that alters an expectation updates the file in the
same commit.

Every library runs the whole corpus. On a pull request, a sampled core of a
few hundred cases (`tests/core.txt`) runs in every language, plus the whole
corpus in Rust and JavaScript; the whole corpus runs in all four languages
nightly and before a release, sharded if Python needs it. No language is
permanently exempt.

## CI

One workflow, one job per language, each on the oldest and newest supported
toolchain:

- JavaScript: Node 20 and current, `node --test`, the bundle freshness check;
- Python: 3.10 and current, `python -m unittest`, `python -m build` for the
  wheel (the build backend is the only non-standard-library tool, and only
  at build time);
- Go: the oldest supported release and current, `go vet`, `go test`;
- Rust: MSRV and stable, `cargo fmt --check`, `cargo clippy`, `cargo test`,
  `cargo package` to prove the crate is self-contained.

Third-party actions are pinned by commit hash. GitHub Pages serves `main`
from the root, which needs no workflow.

## Standard library only

This holds for every target. JavaScript needs nothing beyond the language
and, for the CLI, Node's `fs`. Python's standard library has everything,
`json` included. Go's has `embed` and `encoding/json`. Rust's has no JSON
reader, so the Rust tests carry a small one, and the library writes JSON by
hand; that is a few hundred lines, and the one real cost of the rule.

## Dialects that replace rules

A dialect often has to change a rule, not only add to it: the Zantufa syntax
is the experimental one with some alternatives replaced. Stitching unions the
alternatives of rules with the same name, which can add but not remove. The
notation therefore gets one more form, whole-rule replacement:

```
selbri-3
≝ selbri-4 ... | zantufa-extension
```

`≝` defines the rule anew in a document stitched after the one that defined
it with `≔`; the earlier alternatives are gone. Two replacements of the same
rule, or a replacement with nothing to replace, are grammar errors, so a
dialect's effect on its base is always exactly what its document says.
Removing individual alternatives is not supported: a rule is small enough to
restate, and restating it is easier to read than a list of deletions. The
Zantufa dialect becomes the experimental documents plus a Zantufa document
of replacements and additions, instead of a generated copy.

## What moves from the prototype

The grammar documents, rewritten where they refer to the prototype, other
parsers or research notes; the notation document; the fixture corpus,
converted to the format above. Nothing else: no code, no scripts, no notes.
The lexicon that was derived from another parser's word table becomes a
document of its own, maintained by hand, and the Zantufa grammar becomes a
document of replacements, as above.

## Order of work

1. The engine specification and its engine cases, with the output formats.
2. The `file://` and Pages proof for the playground, with a stub parser.
3. The JavaScript library, against the engine cases, then the Lojban
   grammars and the corpus; the CLI and the playground on top of it.
4. Rust, Python and Go, each against the same cases, each its own pull
   request.
5. CI grows with each: one job per language as it lands.

## Open questions

1. The replacement symbol: `≝` is proposed; any single unambiguous symbol
   will do.
2. The corpus is 26,000 cases, about 8 MB with words and brackets. It stays
   whole in the repository.
