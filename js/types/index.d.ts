export { Loader, Dialect, fnv1a64 } from "./dialect.js";
export { GencmuError } from "./errors.js";
export { Token } from "./tokens.js";
export { resultJson, toJson, compactJson, toBrackets, toTree, displayValue, prettyJson } from "./output.js";
import { Loader, Dialect } from "./dialect.js";
export type TagSet = import("./types.js").TagSet;
export type Span = import("./types.js").Span;
export type Resources = import("./types.js").Resources;
export type Verdict = import("./types.js").Verdict;
export type ResultNode = import("./types.js").ResultNode;
export type TokenNode = import("./types.js").TokenNode;
export type ElidedNode = import("./types.js").ElidedNode;
export type RuleNode = import("./types.js").RuleNode;
export type ParseError = import("./types.js").ParseError;
export type Expectation = import("./types.js").Expectation;
export type StageReport = import("./types.js").StageReport;
export type ParseResult = import("./types.js").ParseResult;
export type ParseOptions = import("./types.js").ParseOptions;
export type Action = import("./types.js").Action;
export type GrammarDom = import("./types.js").GrammarDom;
export type ErrorLocation = import("./types.js").ErrorLocation;
export type ResultJson = import("./output.js").ResultJson;
export type DisplayValue = import("./output.js").DisplayValue;
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
export declare function loadDialectSources(sources: Map<string, string> | Record<string, string>, pipelinePath: string): Dialect;
/**
 * @param {Map<string, string> | Record<string, string>} sources
 * @returns {Loader}
 */
export declare function loaderFromSources(sources: Map<string, string> | Record<string, string>): Loader;
