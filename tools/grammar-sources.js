// The grammars of a repository as its source documents give them, for the
// tools that judge what a grammar does. The packages' bundled copies under
// lib/ and grammars/compiled.json are generated from these sources by
// tools/sync.js, and can be older than them, so no check of the sources
// reads them.
import fs from "node:fs";
import path from "node:path";
import { Loader } from "../lib/js/src/node.js";
import { extractGrammarText } from "../lib/js/src/markdown.js";

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
    const file = path.join(grammars, relative.split("/").join(path.sep));
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
        const source = path.join(base, "grammars", file.split("/").join(path.sep));
        doms.set(file, fs.existsSync(source) ? loader.readDocument(fs.readFileSync(source, "utf8"), file) : undefined);
      }
      return doms.get(file);
    },
  };
}

/**
 * Read literal include edges for pipeline metadata and document checks.
 * This view supplies pipeline metadata, not grammar DOMs for execution.
 * Quoted forms and comments cannot introduce an include edge.
 * @param {string} base
 * @returns {{get: (file: string) => any}}
 */
export function sourceIncludeEdges(base) {
  const documents = new Map();
  return {
    get(file) {
      if (documents.has(file)) return documents.get(file);
      const source = path.join(base, "grammars", file);
      if (!fs.existsSync(source)) return undefined;
      const { text, positions } = extractGrammarText(fs.readFileSync(source, "utf8"), file);
      const chars = [...text];
      const directives = [];
      const layout = (at) => {
        for (;;) {
          while (at < chars.length && /\s/u.test(chars[at])) at++;
          if (chars[at] !== "(" || chars[at + 1] !== "*") return at;
          at += 2;
          while (at < chars.length && !(chars[at] === "*" && chars[at + 1] === ")")) at++;
          at += 2;
        }
      };
      for (let at = 0; at < chars.length;) {
        at = layout(at);
        if (chars[at] === "/" && chars[at + 2] === "/") { at += 3; continue; }
        if (chars[at] === "'" || chars[at] === '"') {
          const quote = chars[at++];
          while (at < chars.length && chars[at] !== quote) at += chars[at] === "\\" ? 2 : 1;
          at++;
          continue;
        }
        if (chars.slice(at, at + 8).join("") !== "%include" || /[A-Za-z0-9_-]/.test(chars[at + 8] ?? "")) { at++; continue; }
        const start = at;
        at = layout(at + 8);
        if (chars[at] !== '"') throw new Error(`${file}: an include requires a quoted path`);
        const from = ++at;
        while (at < chars.length && chars[at] !== '"') {
          if (chars[at] === "\\") throw new Error(`${file}: an include path contains a backslash`);
          at++;
        }
        if (at === chars.length) throw new Error(`${file}: an include path lacks its closing quote`);
        directives.push({ name: "include", args: [chars.slice(from, at).join("")], at: positions[start] });
        at++;
      }
      const result = { directives };
      documents.set(file, result);
      return result;
    },
  };
}
