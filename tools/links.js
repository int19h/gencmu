// Whether an %include of a pipeline has its link in the prose, in the layout
// docs/design.md ("Pipelines") prescribes: the %include's block is the first
// thing under a list item, right after the item's own line and indented to
// the item's text, and that line has an inline link [text](PATH) to the same
// path. tools/sync.js uses it, so that the prose and the blocks name the
// same documents. The list items, blocks and links are those of the
// CommonMark and GFM parser of tools/markdown.js.
import { parseMarkdown, walk } from "./markdown.js";

/**
 * The targets of the inline links in a piece of Markdown, as the parser
 * reads them. A reference link, an image and a link with an empty target
 * give none.
 * @param {string} markdown
 * @returns {string[]}
 */
export function inlineLinkTargets(markdown) {
  return linkTargets(parseMarkdown(markdown));
}

/**
 * @param {import("./markdown.js").Node} node
 * @param {number} [line] only the links that begin on this line
 * @returns {string[]}
 */
function linkTargets(node, line) {
  const targets = [];
  for (const { node: link } of walk(node)) {
    if (link.type !== "link" || !link.url) continue;
    if (line === undefined || link.position.start.line === line) targets.push(link.url);
  }
  return targets;
}

/**
 * Whether the %include of `path` on line `line` (counted from 1) of
 * `markdown` has its link as the layout requires.
 * @param {string} markdown
 * @param {number} line
 * @param {string} path
 * @returns {boolean}
 */
export function includeIsLinked(markdown, line, path) {
  return includeLinks(markdown)(line, path);
}

/**
 * The test of includeIsLinked for one document, which parses it once and
 * finds a line's block by binary search. A parse and a walk of the whole
 * document for each %include would cost the square of its size.
 * @param {string} markdown
 * @returns {(line: number, path: string) => boolean}
 */
export function includeLinks(markdown) {
  /** @type {{node: import("./markdown.js").Node, item: import("./markdown.js").Node | undefined}[]} */
  const blocks = [];
  for (const { node, ancestors } of walk(parseMarkdown(markdown))) {
    if (node.type === "code" && node.lang === "jbogenbau") blocks.push({ node, item: ancestors[ancestors.length - 1] });
  }
  return (line, path) => {
    // The last block that starts before the line; blocks do not overlap,
    // and the walk finds them in document order.
    let low = 0;
    let high = blocks.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (blocks[middle].node.position.start.line < line) low = middle + 1;
      else high = middle;
    }
    const found = blocks[low - 1];
    if (!found || !(line < found.node.position.end.line)) return false;
    const { node, item } = found;
    if (!item || item.type !== "listItem") return false;
    const [text, block] = /** @type {import("./markdown.js").Node[]} */ (item.children);
    return block === node
      && text.type === "paragraph"
      && text.position.start.line === item.position.start.line
      && node.position.start.line === text.position.end.line + 1
      && node.position.start.column === text.position.start.column
      && linkTargets(text, item.position.start.line).includes(path);
  };
}
