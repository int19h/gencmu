import type { ResultNode, RuleNode } from "./types.js";
/** @import { ResultNode, RuleNode } from "./types.js" */
/**
 * Folds a tree bottom-up: `leaf` maps a token or elided node, `rule` a rule
 * node given its children's values in order.
 * @template T
 * @param {ResultNode} root
 * @param {(node: Exclude<ResultNode, RuleNode>) => T} leaf
 * @param {(node: RuleNode, children: T[]) => T} rule
 * @returns {T}
 */
export declare function foldTree<T>(root: ResultNode, leaf: (node: Exclude<ResultNode, RuleNode>) => T, rule: (node: RuleNode, children: T[]) => T): T;
