// Loading gencmu's grammars from disk in Node.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Loader, Dialect } from "./dialect.js";

export * from "./index.js";
import { GencmuError } from "./errors.js";

// The grammars shipped with the package, or, in a clone of the repository,
// the repository's own.
/** @returns {string} */
export function bundledGrammarsDirectory() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const candidate of [path.join(here, "..", "grammars"), path.join(here, "..", "..", "grammars")]) {
    if (fs.existsSync(path.join(candidate, "unicode.txt"))) return candidate;
  }
  throw new Error("gencmu: no grammars directory next to the package");
}

// A loader over a directory of grammars, the bundled one by default.
/**
 * @param {string} [directory]
 * @returns {Loader}
 */
export function loaderFromDirectory(directory = bundledGrammarsDirectory()) {
  return new Loader((relative) => {
    const file = path.join(directory, ...relative.split("/"));
    try {
      return fs.readFileSync(file, "utf8");
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return undefined;
      throw error;
    }
  });
}

// The files a dialect from disk or memory takes from the bundled grammars
// when it does not supply them.
const SHARED = ["unicode.txt", "notation/bootstrap.json", "compiled.json"];

/** @type {Map<string, string | undefined>} */
const bundled = new Map();
/**
 * @param {string} relative
 * @returns {string | undefined}
 */
function readBundled(relative) {
  if (!bundled.has(relative)) {
    const file = path.join(bundledGrammarsDirectory(), ...relative.split("/"));
    bundled.set(relative, fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined);
  }
  return bundled.get(relative);
}

/**
 * A bundled dialect by name: `grammars/dialects/NAME.md`.
 * @param {string} name
 * @returns {Dialect}
 */
export function loadDialect(name) {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(name)) throw new GencmuError("grammar", `no bundled dialect is named ${JSON.stringify(name)}`);
  return loaderFromDirectory().dialect(`dialects/${name}.md`);
}

/**
 * A dialect from a pipeline document on disk; its grammar documents are
 * found relative to it, and the Unicode table and the bootstrap come from
 * the bundled grammars.
 * @param {string} file
 * @returns {Dialect}
 */
export function loadDialectFile(file) {
  const absolute = path.resolve(file);
  const root = path.parse(absolute).root;
  const loader = new Loader((relative) => {
    if (SHARED.includes(relative)) return relative === "compiled.json" ? undefined : readBundled(relative);
    try {
      return fs.readFileSync(path.join(root, ...relative.split("/")), "utf8");
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return undefined;
      throw error;
    }
  });
  return loader.dialect(path.relative(root, absolute).split(path.sep).join("/"));
}

/**
 * A dialect from documents held in memory, a map or a plain object from path
 * to text, and the path of the pipeline document among them. The Unicode
 * table, the bootstrap and the precompiled DOMs come from the bundled
 * grammars unless the map has its own.
 * @param {Map<string, string> | Record<string, string>} sources
 * @param {string} pipelinePath
 * @returns {Dialect}
 */
export function loadDialectSources(sources, pipelinePath) {
  const map = sources instanceof Map ? sources : new Map(Object.entries(sources));
  return new Loader((relative) => (map.has(relative) ? map.get(relative) : SHARED.includes(relative) ? readBundled(relative) : undefined))
    .dialect(pipelinePath);
}
