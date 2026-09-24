import { ParseContext } from "./earley.js";
import { Token } from "./tokens.js";
import type { Derivation, ResultNode, StageReport } from "./types.js";
import type { Grammar } from "./grammar.js";
import type { UnicodeTable } from "./unicode.js";
export type StageOptions = {
    features: Set<string>;
    elisionOnly: boolean | null | undefined;
    /**
     * whether this is the pipeline's last stage
     */
    last: boolean;
};
/**
 * @import { Derivation, DerivationRule, ElidedNode, EmitItem, ResultNode, Scope, Span, StageReport, TagSet, TermValue } from "./types.js"
 * @import { Grammar } from "./grammar.js"
 * @import { UnicodeTable } from "./unicode.js"
 */
/**
 * The options of one stage's run.
 * @typedef {object} StageOptions
 * @property {Set<string>} features
 * @property {boolean | null | undefined} elisionOnly
 * @property {boolean} last whether this is the pipeline's last stage
 */
export declare class Stage {
    name: string;
    grammar: Grammar;
    /**
     * @param {string} name
     * @param {Grammar} grammar
     */
    constructor(name: string, grammar: Grammar);
    /**
     * Runs the stage over `tokens`.
     * @param {Token[]} tokens
     * @param {string[]} sourceText the original text as an array of code points
     * @param {UnicodeTable} unicode
     * @param {StageOptions} options
     * @returns {StageReport}
     */
    run(tokens: Token[], sourceText: string[], unicode: UnicodeTable, options: StageOptions): StageReport;
    /**
     * Engine §7: null when the check passes, else the two first readings of
     * the input with its elided terminators written out.
     * @param {ResultNode} tree
     * @param {Token[]} tokens
     * @param {string[]} sourceText
     * @param {UnicodeTable} unicode
     * @param {Set<string>} features
     * @returns {ResultNode[] | null}
     */
    elisionCheck(tree: ResultNode, tokens: Token[], sourceText: string[], unicode: UnicodeTable, features: Set<string>): ResultNode[] | null;
}
/**
 * @param {Derivation} node
 * @param {ParseContext} context
 * @returns {ResultNode[]}
 */
export declare function resultTree(node: Derivation, context: ParseContext): ResultNode[];
export type EmitTask = {
    walk: Derivation;
} | {
    token: () => Token;
};
/**
 * @typedef {{walk: Derivation} | {token: () => Token}} EmitTask
 */
/**
 * @param {Derivation} root
 * @param {ParseContext} context
 * @returns {Token[]}
 */
export declare function emit(root: Derivation, context: ParseContext): Token[];
