// gencmu: a Lojban parser whose grammars are literate documents loaded at
// runtime. This module works anywhere JavaScript runs; `gencmu/node` adds
// loading grammars from disk.

export { Loader, Dialect, fnv1a64 } from "./dialect.js";
export { GencmuError } from "./errors.js";
export { Token } from "./tokens.js";
export { resultJson, toBrackets, toTree, displayValue, prettyJson } from "./output.js";

import { Loader } from "./dialect.js";

// A loader over grammar documents held in memory: a map, or a plain object,
// from path to text.
export function loaderFromSources(sources) {
  const map = sources instanceof Map ? sources : new Map(Object.entries(sources));
  return new Loader((path) => map.get(path));
}
