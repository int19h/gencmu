import type { GrammarDom, Position, ResultNode } from "./types.js";
import type { Token } from "./tokens.js";
/**
 * @import { Argument, Comparator, Condition, DomAlternative, DomConstant, DomDirective, DomRule, EmitItem, Emission, Expr, GrammarDom, Position, ResultNode, RuleNode, Term } from "./types.js"
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
 * @param {{lowercase(text: string): string, isMark(code: number): boolean}} unicode
 *   the lowercase mapping that the strings of sound tests are checked
 *   against (engine §9, §10), and the marks that a character tag escapes
 *   (engine §1)
 * @returns {GrammarDom}
 */
export declare function treeToDom(tree: ResultNode, tokens: Token[], positionOf: (token: Token) => Position, path: string, unicode: {
    lowercase(text: string): string;
    isMark(code: number): boolean;
}): GrammarDom;
export type OperandKind = "name" | "class" | "string" | "tag" | "phoneme" | "character" | "range" | "property";
/**
 * What is wrong with a directive's operands, or null (engine §9).
 * @param {string} name
 * @param {OperandKind[]} kinds
 * @returns {string | null}
 */
export declare function operandProblem(name: string, kinds: OperandKind[]): string | null;
