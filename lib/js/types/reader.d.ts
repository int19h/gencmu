import type { GrammarDom, Position, ResultNode } from "./types.js";
import type { Token } from "./tokens.js";
/**
 * @import { Argument, Comparator, Condition, DomAlternative, DomDirective, DomRule, EmitItem, Emission, Expr, GrammarDom, Position, ResultNode, RuleNode, Term } from "./types.js"
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
 * @returns {GrammarDom}
 */
export declare function treeToDom(tree: ResultNode, tokens: Token[], positionOf: (token: Token) => Position, path: string): GrammarDom;
