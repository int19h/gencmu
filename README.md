# gencmu

gencmu is a Lojban parser whose grammar is data. Every layer of the language is a literate grammar document in jbogenbau, the grammar notation of gencmu. A literate grammar document mixes prose with the grammar rules, and gencmu loads it at runtime. If you change a grammar, you change the language that the parser reads. No build step is required.

A stage is one step of a parse, with its own grammar. A pipeline runs stages in sequence. Its pipeline document lists the stages and the grammar documents of each stage.

A phoneme is a unit of sound. A Lojban pipeline has five stages: phonemes, forms, words, indicators and syntax. The phoneme stage sets comparison values and keeps the spelling that images show. The forms stage divides the phonemes into words and classifies each word. Later stages apply magic words, attach indicators, and build a parse tree. A feature is a named switch that the grammars test.

Stress uses the `Stressed` tag, a named mark on a phoneme. A stressed vowel has a lowercase value and an uppercase image.

Rule names can use one valid emoji character. It has `Emoji_Presentation` and lacks `Emoji_Component` in the configured Unicode table.

A free modifier is a word or phrase that can stand almost anywhere. `🆓` names the rule for free modifiers. A tree pattern describes the shape of a parse tree. `#` starts a tree pattern, and `@` starts a template parameter.

## Try it

The command line needs only Node 24 or later. Run these commands in a clone:

```sh
node lib/js/cli.js parse mi klama le zarci
node lib/js/cli.js parse --format tree lo mlatu cu citka lo finpe
node lib/js/cli.js parse --pipeline lojban/experimental mi cu klama
node lib/js/cli.js parse --trace syntax:2 mi le le zarci
node lib/js/cli.js audit --pipeline lojban/zantufa
node lib/js/cli.js help
```

Open the playground on GitHub Pages. For local use, serve the repository root with `python3 -m http.server`. Then open `http://localhost:8000/index.html` in a browser. The playground runs the browser library. At startup it fetches the Unicode properties file, and it fetches names data when a grammar needs it. The playground does these things:

- It parses the text as you type, under any pipeline and set of features.
- It shows the brackets, the tree, the JSON and the tokens of every stage.
- It explains a rejection or a tie (two readings that rank the same).
- It traces a stage at a position.
- It audits the pipeline: it lists the unreachable, replaced and extended rules.
- It has an editor for the grammar documents. When you change a document, the playground parses the text again at once. You can download what you changed.

## The pipelines

| name | what it reads |
| --- | --- |
| `lojban/cll` | Lojban as *The Complete Lojban Language* (CLL) describes it, its printed grammar taken as normative |
| `lojban/bpfk` | CLL syntax with the working word forms of the BPFK (a Lojban committee), from a PEG (parsing expression grammar). It reads omitted closing words as the `lojban/cll` pipeline does. |
| `lojban/experimental` | CLL with extensions. Its baseline is camxes-exp, an experimental PEG parser of Lojban. |
| `lojban/zantufa` | Guskant's Zantufa 1.9999, a PEG grammar of Lojban, translated rule by rule |
| `gencmu/jbogenbau` | jbogenbau, gencmu's grammar notation, in which gencmu reads its own grammar documents |

A `NAME/pipeline.md` document under [`grammars/`](grammars/) defines each bundled pipeline. It includes the grammar documents of its stages and links to each. `node lib/js/cli.js stitch --pipeline NAME` prints a pipeline as one jbogenbau text.

## The libraries

Four libraries implement one specification. Each library has no dependency beyond the standard library of its language. An API is the operations that a library exposes. Each library passes every shared test that its API can express. The libraries are:

- JavaScript: [`lib/js/`](lib/js), the npm package `gencmu`, with the CLI
- Python: [`lib/python/`](lib/python), the package `gencmu`
- Go: [`lib/go/`](lib/go), the module `github.com/int19h/gencmu/lib/go`
- Rust: [`lib/rust/`](lib/rust), the crate `gencmu`

```js
import { loadPipeline, toBrackets } from "gencmu/node";
console.log(toBrackets(loadPipeline("lojban/cll").parse("mi klama")));
```

## Documents

- [`docs/pipelines.md`](docs/pipelines.md): implement a pipeline, with a worked example
- [`docs/notation.md`](docs/notation.md): jbogenbau, the grammar notation, for grammar authors
- [`docs/engine.md`](docs/engine.md): the engine specification, for implementers
- [`docs/api.md`](docs/api.md): the library API in each language
- [`docs/output.md`](docs/output.md): the output formats
- [`docs/design.md`](docs/design.md): why gencmu is the way it is
- [`tests/README.md`](tests/README.md): the shared tests, the Lojban corpus among them

## License

gencmu uses the MIT License. See [`LICENSE`](LICENSE). Each package carries a copy.
