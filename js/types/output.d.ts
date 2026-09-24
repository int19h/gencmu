import type { ParseError, ParseResult, ResultNode, Span } from "./types.js";
import type { Token } from "./tokens.js";
export type TokenJson = {
    text: string;
    phonemes: string;
    tags: Record<string, boolean>;
    span: Span;
    source: Span;
    insertedBy?: string;
};
export type NodeJson = {
    kind: "token";
    terminal: string;
    token: number;
    span: Span;
    source: Span;
} | {
    kind: "elided";
    terminal: string;
    span: Span;
    source: Span;
} | {
    kind: "rule";
    rule: string;
    span: Span;
    source: Span;
    tags: Record<string, boolean>;
    children: NodeJson[];
};
export type ActionJson = {
    read: {
        token: number;
        terminal: string;
    };
} | {
    close: {
        rule: string;
        production: number;
        span: Span;
    };
};
export type ErrorJson = {
    kind: ParseError["kind"];
    stage?: string;
    token?: number;
    source?: Span;
    line?: number;
    column?: number;
    expected?: import("./types.js").Expectation[];
    readings?: NodeJson[];
    document?: string;
    message: string;
};
export type StageJson = {
    name: string;
    verdict: import("./types.js").Verdict | null;
    witness?: (ActionJson | null)[];
    tied?: NodeJson;
    output?: TokenJson[];
};
export type ResultJson = {
    format: number;
    ok: boolean;
    stages: StageJson[];
    tree: NodeJson | null;
    error: ErrorJson | null;
};
export type DisplayValue = {
    [name: string]: DisplayValue | DisplayValue[] | string | null;
};
/** @import { Action, ParseError, ParseResult, ResultNode, Span } from "./types.js" */
/** @import { Token } from "./tokens.js" */
/**
 * A token in the result JSON.
 * @typedef {object} TokenJson
 * @property {string} text
 * @property {string} phonemes
 * @property {Record<string, boolean>} tags
 * @property {Span} span
 * @property {Span} source
 * @property {string} [insertedBy]
 */
/**
 * A result tree node in the result JSON.
 * @typedef {{kind: "token", terminal: string, token: number, span: Span, source: Span}
 *   | {kind: "elided", terminal: string, span: Span, source: Span}
 *   | {kind: "rule", rule: string, span: Span, source: Span, tags: Record<string, boolean>, children: NodeJson[]}} NodeJson
 */
/**
 * A witness action in the result JSON.
 * @typedef {{read: {token: number, terminal: string}}
 *   | {close: {rule: string, production: number, span: Span}}} ActionJson
 */
/**
 * An error in the result JSON.
 * @typedef {object} ErrorJson
 * @property {ParseError["kind"]} kind
 * @property {string} [stage]
 * @property {number} [token]
 * @property {Span} [source]
 * @property {number} [line]
 * @property {number} [column]
 * @property {import("./types.js").Expectation[]} [expected]
 * @property {NodeJson[]} [readings]
 * @property {string} [document]
 * @property {string} message
 */
/**
 * A stage in the result JSON.
 * @typedef {object} StageJson
 * @property {string} name
 * @property {import("./types.js").Verdict | null} verdict
 * @property {(ActionJson | null)[]} [witness]
 * @property {NodeJson} [tied]
 * @property {TokenJson[]} [output]
 */
/**
 * The canonical result JSON (docs/output.md).
 * @typedef {object} ResultJson
 * @property {number} format
 * @property {boolean} ok
 * @property {StageJson[]} stages
 * @property {NodeJson | null} tree
 * @property {ErrorJson | null} error
 */
/**
 * The display JSON projection of a tree: each node an object with one
 * member, its rule or terminal.
 * @typedef {{[name: string]: DisplayValue | DisplayValue[] | string | null}} DisplayValue
 */
export declare const RESULT_FORMAT = 1;
/**
 * @param {ResultNode} node
 * @returns {NodeJson}
 */
export declare function nodeJson(node: ResultNode): NodeJson;
/**
 * The canonical JSON value of a parse result.
 * @param {ParseResult} result
 * @returns {ResultJson}
 */
export declare function resultJson(result: ParseResult): ResultJson;
export type Flat = {
    leaf: string;
} | {
    group: Flat[];
};
/**
 * @typedef {{leaf: string} | {group: Flat[]}} Flat
 */
/**
 * @param {ParseResult} result
 * @param {{showElided?: boolean}} [options]
 * @returns {string}
 */
export declare function toBrackets(result: ParseResult, options?: {
    showElided?: boolean;
}): string;
/**
 * The bracket rendering of any tree over the tokens its nodes index: a
 * tied reading, or one of an ambiguous error's readings, as well as a
 * result's tree.
 * @param {ResultNode} root
 * @param {Token[]} tokens
 * @param {{showElided?: boolean}} [options]
 * @returns {string}
 */
export declare function nodeBrackets(root: ResultNode, tokens: Token[], options?: {
    showElided?: boolean;
}): string;
/**
 * @param {ParseResult} result
 * @returns {string}
 */
export declare function toTree(result: ParseResult): string;
/**
 * The tree rendering of any tree over the tokens its nodes index.
 * @param {ResultNode} root
 * @param {Token[]} tokens
 * @returns {string}
 */
export declare function nodeTree(root: ResultNode, tokens: Token[]): string;
/**
 * @param {ParseResult} result
 * @returns {DisplayValue | null}
 */
export declare function displayValue(result: ParseResult): DisplayValue | null;
/**
 * @param {unknown} value
 * @param {number} [indent]
 * @returns {string}
 */
export declare function prettyJson(value: unknown, indent?: number): string;
/**
 * A JSON value as compact text, like `JSON.stringify` with no spacing, but
 * with an explicit stack, since a parse tree can nest deeper than the call
 * stack allows.
 * @param {unknown} value
 * @returns {string}
 */
export declare function compactJson(value: unknown): string;
/**
 * The canonical JSON of a parse result as text (docs/output.md).
 * @param {ParseResult} result
 * @returns {string}
 */
export declare function toJson(result: ParseResult): string;
