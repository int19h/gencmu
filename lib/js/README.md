# gencmu for JavaScript

The JavaScript library of gencmu, a Lojban parser whose grammars are literate documents loaded at runtime. It needs nothing beyond the language, and Node's `fs` for loading grammars from disk.

```js
import { loadDialect } from "gencmu/node";
import { toBrackets } from "gencmu";

const dialect = loadDialect("cll-ebnf");
const result = dialect.parse("mi klama le zarci");
console.log(result.ok, toBrackets(result));
```

`gencmu` works anywhere JavaScript runs, with grammars from memory through `loadDialectSources`; `gencmu/node` adds `loadDialect`, for the grammars shipped with the package, and `loadDialectFile`, for a pipeline document on disk.

## The command line

`node cli.js` (or `npx gencmu` once published) parses texts, audits grammars and runs test files; `node cli.js help` lists the commands. A parse prints its result on standard output and explains any tie or error on standard error: a rejection shows the line with a caret under the word the stage could not read and what could have come there, by rule; a tie shows where the two readings first differ and both trees side by side; `--trace STAGE:POSITION` shows the items a stage predicted, completed and dropped at one position, with the condition that dropped each.

The same explanations are functions of the library, for tools of your own: `explainError`, `explainTies`, `tokenTable`, `audit` with `formatAudit`, and `trace` with `formatTrace`.

## Types

The sources are plain JavaScript with JSDoc type annotations. TypeScript checks them and writes the declarations in `types/`, which are checked in and published, so TypeScript clients and editors see the library's types. TypeScript is a development dependency only: nothing needs it to run, test or use the library.

```sh
npm test                # the tests; no install needed
npm ci                  # installs TypeScript
npm run check-types     # checks src/ and a client of the package, typecheck/client.ts
npm run types           # rewrites types/ after a change to the annotations
```

CI fails if `types/` is not what `npm run types` writes.
