# gencmu

gencmu is a Lojban parser whose grammar is data. Every layer of the language is a literate grammar document in jbogenbau, the grammar notation of gencmu. A literate grammar document mixes prose with the grammar rules, and gencmu loads it at runtime. If you change a grammar, you change the language that the parser reads, and nothing is compiled.

A stage is one step of a parse, with its own grammar. A dialect is a pipeline of stages, defined by one pipeline document. That document lists the stages and the grammar documents of each. A Lojban dialect has five stages: phonemes, forms, words, indicators and syntax. Together they go from characters to phonemes, from phonemes to words, and from words to a parse tree. A feature is a named switch that the grammars test.

## Try it

You need Node 20 or later, and nothing else installed. Run these commands in a clone:

```sh
node lib/js/cli.js parse mi klama le zarci
node lib/js/cli.js parse --format tree lo mlatu cu citka lo finpe
node lib/js/cli.js parse --dialect experimental mi cu klama
node lib/js/cli.js parse --trace syntax:2 mi le le zarci
node lib/js/cli.js audit --dialect zantufa
node lib/js/cli.js help
```

Or open `index.html` in a browser, from the clone or from GitHub Pages. This page is the playground. It runs the same library in the page and fetches nothing. The playground does these things:

- It parses the text as you type, under any dialect and set of features.
- It shows the brackets, the tree, the JSON and the tokens of every stage.
- It explains a rejection or a tie (two readings that rank the same).
- It traces a stage at a position.
- It audits the dialect: it lists the undefined, unreachable, replaced and extended rules.
- It has an editor for the grammar documents. When you change a document, the playground parses the text again at once. You can download what you changed.

## The dialects

| name | what it reads |
| --- | --- |
| `cll-ebnf` | Lojban as *The Complete Lojban Language* (CLL) describes it, its printed grammar taken as normative |
| `bpfk` | CLL syntax with the BPFK working PEG word forms, the Magic Words stream, and the shared CLL elision policy |
| `experimental` | CLL with the constructs that came into use after CLL, with camxes-exp, an experimental PEG (parsing expression grammar) parser of Lojban, as its baseline |
| `zantufa` | Guskant's Zantufa 1.9999, a PEG grammar of Lojban, translated rule by rule |
| `notation` | jbogenbau, gencmu's grammar notation, in which gencmu reads its own grammar documents |

A document under [`grammars/dialects/`](grammars/dialects) defines each bundled dialect. It includes the grammar documents of its stages and links to each. `node lib/js/cli.js stitch --dialect NAME` prints a dialect as one jbogenbau text.

## The libraries

Four libraries implement one specification. Each library has no dependency beyond the standard library of its language. Each library passes every shared test that its API can express. The libraries are:

- JavaScript: [`lib/js/`](lib/js), the npm package `gencmu`, with the CLI
- Python: [`lib/python/`](lib/python), the package `gencmu`
- Go: [`lib/go/`](lib/go), the module `github.com/int19h/gencmu/lib/go`
- Rust: [`lib/rust/`](lib/rust), the crate `gencmu`

```js
import { loadDialect, toBrackets } from "gencmu/node";
console.log(toBrackets(loadDialect("cll-ebnf").parse("mi klama")));
```

## Documents

- [`docs/notation.md`](docs/notation.md): jbogenbau, the grammar notation, for grammar authors
- [`docs/engine.md`](docs/engine.md): the engine specification, for implementers
- [`docs/api.md`](docs/api.md): the library API in each language
- [`docs/output.md`](docs/output.md): the output formats
- [`docs/design.md`](docs/design.md): why gencmu is the way it is
- [`tests/README.md`](tests/README.md): the shared tests, the Lojban corpus among them

## License

gencmu uses the MIT License. See [`LICENSE`](LICENSE). Each package carries a copy.
