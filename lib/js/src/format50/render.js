// The bracket and tree renderings of a format 50 tree (docs/output.md,
// "Renderings"). A root of a native result reaches its stage input through
// the rendering context that the result retains, so these functions take
// the root alone.

import { GencmuError } from "../errors.js";
import { nodeBrackets as recognizerBrackets, nodeTree as recognizerTree } from "../output.js";
import { resultCores } from "../result-context.js";

/** The rendering context of each root of a native result. */
export const renderContexts = new WeakMap();

/**
 * Records the context of the roots of a parse.
 * @param {any} result a native format 50 result
 * @param {any} unicode the core table of the pipeline
 */
export function retainRenderContext(result, unicode) {
  for (const stage of result.stages) {
    const context = { tokens: stage.input, unicode, text: result.text };
    if (stage.root) renderContexts.set(stage.root, context);
    for (const reading of stage.readings ?? []) renderContexts.set(reading, context);
  }
}

/** @param {any} root */
function contextOf(root) {
  const context = renderContexts.get(root);
  if (!context) throw new GencmuError("usage", "the root does not belong to a format 50 result");
  return context;
}

// The tree and tokens in the shapes that the shared renderers read. A
// token shows through its face, which is its image while faces carry no
// satellites.
/**
 * @param {any} root
 * @param {any} context
 * @returns {{tree: any, tokens: any[]}}
 */
function adapted(root, context) {
  /** @type {(node: any) => any} */
  const build = node => {
    if (node.kind === "token") return { kind: "token", terminal: node.terminal, token: node.token, span: node.span, source: node.source };
    if (node.kind === "elided") return { kind: "elided", terminal: node.terminal, span: node.span, source: node.source };
    return { kind: "rule", rule: node.rule, span: node.span, source: node.source, children: node.children.map(build) };
  };
  const tokens = context.tokens.map((/** @type {any} */ token) => ({
    image: token.image, source: token.source, before: [], after: [],
    tags: new Set(token.props.keys().filter((/** @type {string} */ key) => /^[A-Z_]/.test(key))),
  }));
  resultCores.set(tokens, context.unicode);
  return { tree: build(root), tokens };
}

/**
 * The bracket rendering of a root of a native result.
 * @param {any} root
 * @param {{showElided?: boolean}} [options]
 */
export function nodeBrackets50(root, options = {}) {
  const { tree, tokens } = adapted(root, contextOf(root));
  return recognizerBrackets(tree, tokens, options);
}

/**
 * The tree rendering of a root of a native result.
 * @param {any} root
 */
export function nodeTree50(root) {
  const context = contextOf(root);
  const { tree, tokens } = adapted(root, context);
  return recognizerTree(tree, tokens, context.text);
}
