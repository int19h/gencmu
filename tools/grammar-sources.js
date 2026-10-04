// The grammars of a repository as its source documents give them, for the
// tools that judge what a grammar does. The packages' bundled copies under
// lib/ and grammars/compiled.json are generated from these sources by
// tools/sync.js, and can be older than them, so no check of the sources
// reads them.
import fs from "node:fs";
import path from "node:path";
import { Loader } from "../lib/js/src/node.js";

/**
 * A loader of the grammar documents under `base`/grammars, with no
 * precompiled DOMs. `bootstrap`, when given, takes the place of
 * notation/bootstrap.json, as tools/sync.js does while it settles the
 * bootstrap.
 * @param {string} base the repository
 * @param {string} [bootstrap]
 * @returns {Loader}
 */
export function sourceLoader(base, bootstrap) {
  const grammars = path.join(base, "grammars");
  return new Loader((relative) => {
    if (relative === "notation/bootstrap.json" && bootstrap !== undefined) return bootstrap;
    if (relative === "compiled.json") return undefined;
    const file = path.join(grammars, ...relative.split("/"));
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
  });
}

/**
 * The DOM of each grammar document under `base`/grammars, read from its
 * source with `loader` when first asked for, keyed by its path under
 * grammars/. A document that is not there has none.
 * @param {string} base the repository
 * @param {Loader} loader
 * @returns {{get: (file: string) => any}}
 */
export function sourceDoms(base, loader) {
  const doms = new Map();
  return {
    get(file) {
      if (!doms.has(file)) {
        const source = path.join(base, "grammars", ...file.split("/"));
        doms.set(file, fs.existsSync(source) ? loader.readDocument(fs.readFileSync(source, "utf8"), file) : undefined);
      }
      return doms.get(file);
    },
  };
}
