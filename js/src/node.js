// Loading gencmu's grammars from disk in Node.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Loader } from "./dialect.js";

export * from "./index.js";

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
