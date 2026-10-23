import type { GrammarDom, Position, ResultNode } from "./types.js";
import type { Token } from "./tokens.js";
/**
 * @import { Step } from "./trampoline.js"
 * @import { Argument, Comparator, Condition, DomAlternative, DomClassifier, DomConstant, DomDirective, DomEntry, DomImplication, DomRule, EmitItem, Emission, Expr, GrammarDom, Position, ResultNode, RuleNode, Term } from "./types.js"
 * @import { Token } from "./tokens.js"
 */
/**
 * `tree` is the syntax stage's result tree; `tokens` the syntax stage's
 * input tokens, whose text is what the author wrote; `positionOf` maps a
 * token to its [line, column] in the document.
 * @param {ResultNode} tree
 * @param {Token[]} tokens
 * @param {(token: Token) => Position} positionOf
 * @param {string} path
 * @param {{isMark(code: number): boolean, changesInDocument?(code:number):boolean, isEmojiName?(name:string):boolean}} unicode
 *   the configured category table for diagnostic strings
 * @param {boolean} [deferEmission] slot checks precede absent-carrier pruning
 * @param {(token:Token, path:boolean)=>string} [decodeString]
 * @returns {GrammarDom}
 */
export declare function treeToDom(tree: ResultNode, tokens: Token[], positionOf: (token: Token) => Position, path: string, unicode: {
    isMark(code: number): boolean;
    changesInDocument?(code: number): boolean;
    isEmojiName?(name: string): boolean;
}, deferEmission?: boolean, decodeString?: (token: Token, path: boolean) => string): GrammarDom;
export type OperandKind = "name" | "class" | "string" | "tag" | "range" | "term";
/**
 * A directive's operand: a bare name, lower case or with a capital, a
 * string, or another recognized term atom.
 * @typedef {"name" | "class" | "string" | "tag" | "range" | "term"} OperandKind
 */
/**
 * What is wrong with a directive's operands, or null (engine §9).
 * @param {string} name
 * @param {OperandKind[]} kinds
 * @returns {string | null}
 */
export declare function operandProblem(name: string, kinds: OperandKind[]): string | null;
