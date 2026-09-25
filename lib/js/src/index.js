// gencmu: a Lojban parser whose grammars are literate documents loaded at
// runtime. This module works anywhere JavaScript runs; `gencmu/node` adds
// loading grammars from disk.

export { Loader, Dialect, fnv1a64 } from "./dialect.js";
export { GencmuError } from "./errors.js";
export { Token } from "./tokens.js";
export { resultJson, toJson, compactJson, toBrackets, toTree, displayValue, prettyJson, nodeBrackets, nodeTree } from "./output.js";
export { explainError, explainTies, explainWarnings, tokenTable, audit, formatAudit, trace, formatTrace, sourceExcerpt, formatCondition, formatTerm, formatItem } from "./diagnostics.js";

import { Loader, Dialect } from "./dialect.js";

/**
 * @typedef {import("./types.js").TagSet} TagSet
 * @typedef {import("./types.js").Span} Span
 * @typedef {import("./types.js").Resources} Resources
 * @typedef {import("./types.js").Verdict} Verdict
 * @typedef {import("./types.js").ResultNode} ResultNode
 * @typedef {import("./types.js").TokenNode} TokenNode
 * @typedef {import("./types.js").ElidedNode} ElidedNode
 * @typedef {import("./types.js").RuleNode} RuleNode
 * @typedef {import("./types.js").ParseError} ParseError
 * @typedef {import("./types.js").Expectation} Expectation
 * @typedef {import("./types.js").StageReport} StageReport
 * @typedef {import("./types.js").ParseResult} ParseResult
 * @typedef {import("./types.js").ParseOptions} ParseOptions
 * @typedef {import("./types.js").Action} Action
 * @typedef {import("./types.js").GrammarDom} GrammarDom
 * @typedef {import("./types.js").ErrorLocation} ErrorLocation
 * @typedef {import("./output.js").ResultJson} ResultJson
 * @typedef {import("./output.js").DisplayValue} DisplayValue
 */

/**
 * A dialect from documents held in memory: a map, or a plain object, from
 * path to text, which must include `unicode.txt` and
 * `notation/bootstrap.json` (`gencmu/node` fills them in from the bundled
 * grammars), and the path of the pipeline document among them.
 * @param {Map<string, string> | Record<string, string>} sources
 * @param {string} pipelinePath
 * @returns {Dialect}
 */
export function loadDialectSources(sources, pipelinePath) {
  return loaderFromSources(sources).dialect(pipelinePath);
}

// A loader over grammar documents held in memory: a map, or a plain object,
// from path to text.
/**
 * @param {Map<string, string> | Record<string, string>} sources
 * @returns {Loader}
 */
export function loaderFromSources(sources) {
  const map = sources instanceof Map ? sources : new Map(Object.entries(sources));
  return new Loader((path) => map.get(path));
}
