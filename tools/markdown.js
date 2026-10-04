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
  const [{ fromMarkdown }, { gfmFromMarkdown }, { gfm }, micromark] = await Promise.all([
    load("mdast-util-from-markdown"),
    load("mdast-util-gfm"),
    load("micromark-extension-gfm"),
    load("micromark"),
  ]);
  parse = (/** @type {string} */ markdown) => {
    const tree = fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
    const events = micromark.postprocess(micromark.parse({ extensions: [gfm()] }).document().write(micromark.preprocess()(markdown, undefined, true)));
    annotate(tree, events, markdown);
    return tree;
  };
} catch (error) {
  missing = `the Markdown parser is not installed (${error.code || error.message}); run npm ci in lib/js`;
}

/**
 * Adds to the tree what the parser's tokens know and the mdast nodes leave
 * out, so that no tool reads it again from the source text:
 *
 * - a fenced code block's `data.fenced` is true, and its `data.closed` says
 *   whether a closing fence ends it (the block has two fence tokens);
 * - a table row's `data.leadingPipe` says whether its first cell begins
 *   with a cell divider;
 * - the root's `data.strayBackticks` lists the line of each run of text
 *   that holds a backtick the parser read as plain text: one that opens no
 *   code span and has no backslash, outside a link's destination and
 *   title.
 * @param {Node} tree
 * @param {[string, {type: string, start: {line: number, column: number, offset: number}, end: {offset: number}}][]} events
 * @param {string} markdown
 */
function annotate(tree, events, markdown) {
  /** @type {Map<number, {fences: number}>} the fenced blocks, by start offset */
  const fenced = new Map();
  /** @type {Map<number, boolean>} the table rows, by start offset */
  const rows = new Map();
  const stray = [];
  let block = null;
  let row = null;
  // The depth of link definitions and link destinations and titles, whose
  // text is not prose.
  let outside = 0;
  for (const [kind, token] of events) {
    // The first token in the first cell of a row.
    if (kind === "enter" && row !== null && token.type !== "tableHeader" && token.type !== "tableData") {
      rows.set(row, token.type === "tableCellDivider");
      row = null;
    }
    if (kind === "enter" && token.type === "codeFenced") fenced.set(token.start.offset, (block = { fences: 0 }));
    else if (kind === "enter" && token.type === "codeFencedFence" && block) block.fences++;
    else if (kind === "exit" && token.type === "codeFenced") block = null;
    else if (kind === "enter" && token.type === "tableRow") row = token.start.offset;
    else if (token.type === "definition" || token.type === "resource") outside += kind === "enter" ? 1 : -1;
    else if (kind === "exit" && token.type === "data" && !outside) {
      const text = markdown.slice(token.start.offset, token.end.offset);
      // A data token stands on one line.
      if (text.includes("`")) stray.push({ line: token.start.line });
    }
  }
  for (const { node } of walk(tree)) {
    const at = node.position && node.position.start.offset;
    if (node.type === "code" && fenced.has(at)) node.data = { ...node.data, fenced: true, closed: fenced.get(at).fences >= 2 };
    else if (node.type === "tableRow" && rows.has(at)) node.data = { ...node.data, leadingPipe: rows.get(at) };
  }
  tree.data = { ...tree.data, strayBackticks: stray };
}

/**
 * @typedef {object} Node an mdast node
 * @property {string} type
 * @property {{start: {line: number, column: number, offset: number}, end: {line: number, column: number, offset: number}}} position
 * @property {Node[]} [children]
 * @property {string} [value]
 * @property {string} [lang]
 * @property {Record<string, any>} [data]
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
