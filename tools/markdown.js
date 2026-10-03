// The repository's Markdown documents, read as GitHub reads them: a
// CommonMark and GFM parser (micromark, through mdast-util-from-markdown)
// gives the tree of each document, with the source position of every node.
// The tools that check the prose (tools/prose-lines.js,
// tools/quoted-texts.js) read that tree, so they see every block where
// GitHub sees it. The parser is a development dependency of lib/js, and the
// libraries themselves do not use it: run `npm ci` in lib/js first.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "lib", "js", "package.json"));

/** @param {string} name */
async function load(name) {
  return import(pathToFileURL(require.resolve(name)).href);
}

/** Why the parser cannot be loaded, or null when it can. */
export let missing = null;
let parse = null;
try {
  const [{ fromMarkdown }, { gfmFromMarkdown }, { gfm }] = await Promise.all([
    load("mdast-util-from-markdown"),
    load("mdast-util-gfm"),
    load("micromark-extension-gfm"),
  ]);
  parse = (/** @type {string} */ markdown) => fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
} catch (error) {
  missing = `the Markdown parser is not installed (${error.code || error.message}); run npm ci in lib/js`;
}

/**
 * @typedef {object} Node an mdast node
 * @property {string} type
 * @property {{start: {line: number, column: number, offset: number}, end: {line: number, column: number, offset: number}}} position
 * @property {Node[]} [children]
 * @property {string} [value]
 */

/**
 * The tree of a Markdown document, as CommonMark and GFM read it.
 * @param {string} markdown
 * @returns {Node}
 */
export function parseMarkdown(markdown) {
  if (!parse) throw new Error(missing);
  return parse(markdown);
}

/**
 * Every node of a tree, in document order, each with its ancestors.
 * @param {Node} node
 * @param {Node[]} [ancestors]
 * @returns {Generator<{node: Node, ancestors: Node[]}>}
 */
export function* walk(node, ancestors = []) {
  yield { node, ancestors };
  for (const child of node.children || []) yield* walk(child, [...ancestors, node]);
}
