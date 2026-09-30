# gencmu for JavaScript

This is the JavaScript library of gencmu, a Lojban parser whose grammars are literate documents loaded at runtime. It needs nothing beyond the language, and Node's `fs` for loading grammars from disk.

```js
import { loadDialect } from "gencmu/node";
import { toBrackets } from "gencmu";

const dialect = loadDialect("cll-ebnf");
const result = dialect.parse("mi klama le zarci");
console.log(result.ok, toBrackets(result));
```

`gencmu` works anywhere JavaScript runs, and it loads grammars from memory through `loadDialectSources`. `gencmu/node` adds `loadDialect`, for the grammars shipped with the package, and `loadDialectFile`, for a pipeline document on disk.

## The command line

`node cli.js` parses texts, audits grammars and runs test files. Once the package is published, `npx gencmu` does the same. `node cli.js help` lists the commands.

A parse prints its result on standard output. It explains any tie or error on standard error. A rejection shows the line, with a caret under the word that the stage failed to read. It also shows, by rule, what can come there. A tie shows where the two readings first differ, and both trees side by side.

`--trace STAGE:POSITION` prints a trace on standard output. The trace shows the items that a stage predicted, advanced, completed and dropped at one position. It also shows the condition that dropped each item.

The same explanations are functions of the library, for tools of your own: `explainError`, `explainTies`, `tokenTable`, `audit` with `formatAudit`, and `trace` with `formatTrace`.

## Types

The sources are plain JavaScript with JSDoc type annotations. TypeScript makes sure that their types agree, and it writes the declarations in `types/`. The repository holds the declarations, and the package publishes them. So TypeScript clients and editors see the types of the library. TypeScript is a development dependency only. Nothing needs it to run, test or use the library.

```sh
npm test                # the tests; no install needed
npm ci                  # installs TypeScript and Playwright
npm run check-types     # checks src/ and a client of the package, typecheck/client.ts
npm run types           # rewrites types/ after a change to the annotations
```

CI fails if `types/` is not what `npm run types` writes.

## The playground's smoke test

`tools/smoke-playground.js` opens the playground in headless Chromium or Firefox. It makes sure that the playground parses, explains a rejection and never shows an out-of-date answer. It drives the browser with Playwright. Playwright is also a development dependency only. Nothing needs it to run, test or use the library or the playground.

```sh
npm ci                                      # installs Playwright
npx playwright install chromium firefox     # its browsers, once
node ../../tools/smoke-playground.js                     # index.html from file:// in Chromium
node ../../tools/smoke-playground.js --browser firefox   # in Firefox
node ../../tools/smoke-playground.js URL                 # a deployment, such as GitHub Pages
```
