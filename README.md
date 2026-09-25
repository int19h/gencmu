# gencmu

A Lojban parser whose grammar is data. Every layer of the language, from
characters to phonemes, phonemes to words, words to a parse tree, is a
literate grammar document in jbogenbau, gencmu's grammar notation, loaded at
runtime. A dialect is a pipeline
document that lists the stages and the grammars of each. Change a grammar
and you change the language the parser reads; nothing is compiled.

## Try it

From a clone, with Node 20 or later and nothing installed:

```sh
node lib/js/cli.js parse mi klama le zarci
node lib/js/cli.js parse --format tree lo mlatu cu citka lo finpe
node lib/js/cli.js parse --dialect experimental mi cu klama
node lib/js/cli.js parse --trace syntax:2 mi le le zarci
node lib/js/cli.js audit --dialect zantufa
node lib/js/cli.js help
```

Or open `index.html` in a browser, from the clone or from GitHub Pages: the
playground runs the same library in the page, with nothing fetched. It parses
as you type under any dialect and set of features, shows the brackets, the
tree, the JSON and every stage's tokens, explains a rejection or a tie, traces
a stage at a position, audits the dialect, and has an editor for the grammar
documents: change one and the text is parsed again at once, and download what
you changed.

## The dialects

| name | what it reads |
| --- | --- |
| `cll` | Lojban as *The Complete Lojban Language* describes it |
| `bpfk` | the same, with the word forms the definition effort approved |
| `experimental` | CLL with the experimental constructs in use since |
| `zantufa` | the experimental dialect with Guskant's Zantufa constructs |

Each is a document under [`grammars/dialects/`](grammars/dialects), which
links the grammar documents of its stages.

## The libraries

Four libraries implement one specification, each with no dependency beyond
its language's standard library, and each passes the same shared tests:

- JavaScript: [`lib/js/`](lib/js), the npm package `gencmu`, with the CLI;
- Python: [`lib/python/`](lib/python), the package `gencmu`;
- Go: [`lib/go/`](lib/go), the module `github.com/int19h/gencmu/lib/go`;
- Rust: [`lib/rust/`](lib/rust), the crate `gencmu`.

```js
import { loadDialect, toBrackets } from "gencmu/node";
console.log(toBrackets(loadDialect("cll").parse("mi klama")));
```

## Documents

- [`docs/notation.md`](docs/notation.md): jbogenbau, the grammar notation,
  for grammar authors.
- [`docs/engine.md`](docs/engine.md): the engine specification, for
  implementers.
- [`docs/api.md`](docs/api.md): the library API in each language.
- [`docs/output.md`](docs/output.md): the output formats.
- [`docs/design.md`](docs/design.md): why gencmu is the way it is.
- [`tests/README.md`](tests/README.md): the shared tests, the Lojban corpus
  among them.
