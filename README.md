![gencmu logo: red and blue gears interlocking](https://github.com/user-attachments/assets/59524030-fa37-4fb6-b712-a819ab8fc55b)

# gencmu

gencmu is a multistage Earley parser for Lojban and other loglangs. Its grammars are written in [jbogenbau](docs/notation.md), a grammar notation of its own, and a generic engine reads them at run time. An edited grammar takes effect at the next parse, with no build step.

Each grammar is a literate Markdown document. Fenced `jbogenbau` blocks hold the rules, and the prose between them explains what the rules do and why. On GitHub a grammar reads like any other document.

The notation can express constructs that a context-free grammar cannot. A rule can put conditions on its parts, such as whether two parts have the same value or whether a part also parses as another rule. A `zoi` quote, for example, opens with a delimiter word that the speaker chooses and ends at the next copy of that word. The grammar states this directly: the closing word has the same value as the opening one, and no copy of it occurs in the body.

Parsing is split into stages. A stage is one step of a parse, with its own grammar. It reads the tokens that the stage before it emitted and emits tokens for the next stage. A pipeline runs its stages in order, and its pipeline document, also literate Markdown, lists the stages and their grammar documents. The Lojban pipelines go from characters to phonemes, then to words, and only then to the parse tree. Each stage's grammar deals with one level of the language, so it stays simpler than a single grammar, or a lexer and parser pair, that would do the same work.

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
