import type { ParseError, ParseResult, ResultNode, Span } from "./types.js";
import type { AttachedToken, Token } from "./tokens.js";
export type TokenJson = {
    text: string;
    phonemes: string;
    label: string;
    tags: string[];
    /**
     * absent for an attached token
     */
    span?: Span;
    source: Span;
    insertedBy?: string;
    /**
     * present only when not empty
     */
    before?: TokenJson[];
    /**
     * present only when not empty
     */
    after?: TokenJson[];
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
    tags: string[];
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
} | {
    elided: {
        at: number;
        terminal: string;
    };
};
export type ErrorJson = {
    kind: ParseError["kind"];
    stage?: string;
    code?: "elision-witness-lost";
    reason?: "tie" | "elision-only";
    token?: number;
    source?: Span;
    line?: number;
    column?: number;
    expected?: import("./types.js").Expectation[];
    readings?: NodeJson[];
    witness?: ActionJson[];
    cycle?: CycleEdgeJson[];
    conflict?: import("./prefer-rank.js").PreferenceConflict;
    chosenReading?: number;
    document?: string;
    message: string;
    chosen?: NodeJson;
    completion?: import("./types.js").Restoration[];
};
export type StageJson = {
    name: string;
    verdict: import("./types.js").Verdict | null;
    witness?: ActionJson[];
    output?: TokenJson[];
};
export type ResultJson = {
    format: number;
    ok: boolean;
    stages: StageJson[];
    tree: NodeJson | null;
    error: ErrorJson | null;
    /**
     * present only when there is one
     */
    warnings?: WarningJson[];
};
export type WarningJson = {
    stage: string;
    feature: string;
    rule: string;
    span: [number, number];
    source: [number, number];
};
export type DisplayValue = {
    [name: string]: DisplayValue | DisplayValue[] | string | string[] | null;
};
export type CycleEdgeJson = Omit<import("./types.js").PreferenceCycleEdge, "witness"> & {
    witness?: [ActionJson | null, ActionJson | null];
};
/** @import { WitnessAction, ParseError, ParseResult, ResultNode, Span } from "./types.js" */
/** @import { AttachedToken, Token } from "./tokens.js" */
/**
 * A token in the result JSON.
 * @typedef {object} TokenJson
 * @property {string} text
 * @property {string} phonemes
 * @property {string} label
 * @property {string[]} tags
 * @property {Span} [span] absent for an attached token
 * @property {Span} source
 * @property {string} [insertedBy]
 * @property {TokenJson[]} [before] present only when not empty
 * @property {TokenJson[]} [after] present only when not empty
 */
/**
 * A result tree node in the result JSON.
 * @typedef {{kind: "token", terminal: string, token: number, span: Span, source: Span}
 *   | {kind: "elided", terminal: string, span: Span, source: Span}
 *   | {kind: "rule", rule: string, span: Span, source: Span, tags: string[], children: NodeJson[]}} NodeJson
 */
/**
 * A witness action in the result JSON.
 * @typedef {{read: {token: number, terminal: string}}
 *   | {close: {rule: string, production: number, span: Span}}
 *   | {elided: {at: number, terminal: string}}} ActionJson
 */
/**
 * An error in the result JSON.
 * @typedef {object} ErrorJson
 * @property {ParseError["kind"]} kind
 * @property {string} [stage]
 * @property {"elision-witness-lost"} [code]
 * @property {"tie" | "elision-only"} [reason]
 * @property {number} [token]
 * @property {Span} [source]
 * @property {number} [line]
 * @property {number} [column]
 * @property {import("./types.js").Expectation[]} [expected]
 * @property {NodeJson[]} [readings]
 * @property {ActionJson[]} [witness]
 * @property {CycleEdgeJson[]} [cycle]
 * @property {import("./prefer-rank.js").PreferenceConflict} [conflict]
 * @property {number} [chosenReading]
 * @property {string} [document]
 * @property {string} message
 * @property {NodeJson} [chosen]
 * @property {import("./types.js").Restoration[]} [completion]
 */
/**
 * A stage in the result JSON.
 * @typedef {object} StageJson
 * @property {string} name
 * @property {import("./types.js").Verdict | null} verdict
 * @property {ActionJson[]} [witness]
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
 * @property {WarningJson[]} [warnings] present only when there is one
 */
/**
 * A warning (docs/output.md).
 * @typedef {object} WarningJson
 * @property {string} stage
 * @property {string} feature
 * @property {string} rule
 * @property {[number, number]} span
 * @property {[number, number]} source
 */
/**
 * The display JSON projection of a tree: each node an object with one
 * member, its rule or terminal.
 * @typedef {{[name: string]: DisplayValue | DisplayValue[] | string | string[] | null}} DisplayValue
 */
/** @typedef {Omit<import("./types.js").PreferenceCycleEdge, "witness"> & {witness?: [ActionJson | null, ActionJson | null]}} CycleEdgeJson */
export declare const RESULT_FORMAT = 10;
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
/**
 * A token's attachments on one line, for the token tables: `◂ ` before a
 * before-attachment and `▸ ` before an after-attachment, each with its
 * classes and its label, and its own attachments after it in parentheses.
 * The empty string for a token with none.
 * @param {AttachedToken} token
 * @returns {string}
 */
export declare function attachmentText(token: AttachedToken): string;
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
 * A tree without its hollow rule nodes, those with no token and no elided
 * terminator below them, such as an empty free-modifier slot: the renderings
 * for people leave them out (docs/output.md).
 * @param {ResultNode} root
 * @returns {ResultNode}
 */
export declare function withoutHollowNodes(root: ResultNode): ResultNode;
/**
 * The tree rendering of any tree over the tokens its nodes index. `text` is
 * the text that the tokens' sources index. Without it, only the labels
 * decide whether a rule's tokens fit on its line.
 * @param {ResultNode} root
 * @param {Token[]} tokens
 * @param {string} [text]
 * @returns {string}
 */
export declare function nodeTree(root: ResultNode, tokens: Token[], text?: string): string;
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
