// Walks over result trees with an explicit stack. A left-recursive rule
// with several alternatives, such as the word stage's stream, leaves one
// node per word nested in the next, so a tree is as deep as a long text is
// long, deeper than any call stack.

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
export function foldTree(root, leaf, rule) {
  /** @type {{node: RuleNode, next: number, values: T[]}[]} */
  const stack = [];
  /** @type {T | undefined} */
  let value;
  /** @type {ResultNode | null} */
  let pending = root;
  for (;;) {
    if (pending !== null) {
      if (pending.kind === "rule") {
        stack.push({ node: pending, next: 0, values: [] });
        pending = null;
      } else {
        value = leaf(pending);
        pending = null;
        if (stack.length === 0) return value;
        stack[stack.length - 1].values.push(value);
      }
      continue;
    }
    const frame = stack[stack.length - 1];
    if (frame.next < frame.node.children.length) {
      pending = frame.node.children[frame.next++];
      continue;
    }
    stack.pop();
    value = rule(frame.node, frame.values);
    if (stack.length === 0) return value;
    stack[stack.length - 1].values.push(value);
  }
}
