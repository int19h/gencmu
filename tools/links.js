// Whether an %include of a pipeline has its link in the prose, in the layout
// docs/design.md ("Pipelines") prescribes: the %include's block is the first
// thing under a list item, right after the item's own line and indented to
// the item's text, and that line has an inline link [text](PATH) to the same
// path. tools/sync.js uses it, so that the prose and the blocks name the
// same documents. The list items, blocks and links are those of the
// CommonMark and GFM parser of tools/markdown.js.
import { parseMarkdown, walk } from "./markdown.js";
import { countWork, hooks } from "../lib/js/src/testing.js";
import path from "node:path";

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
 * The GitHub anchors of a document's headings, including repeated headings.
 * @param {string} markdown
 * @returns {Set<string>}
 */
export function headingAnchors(markdown) {
  const anchors = new Set();
  for (const { node } of walk(parseMarkdown(markdown))) {
    if (node.type !== "heading") continue;
    const text = [...walk(node)].map(({ node: part }) => ["text", "inlineCode"].includes(part.type) ? part.value ?? "" : "").join("");
    const base = text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}_\-\s]/gu, "").replace(/\s/gu, "-");
    let anchor = base;
    for (let suffix = 1; anchors.has(anchor); suffix++) anchor = `${base}-${suffix}`;
    anchors.add(anchor);
  }
  return anchors;
}

/**
 * Local Markdown links with a heading fragment must name an existing heading.
 * With `exists`, every local link must also name an existing file, of any
 * type, and a link may not end in an empty fragment.
 * @param {string} markdown
 * @param {string} file
 * @param {(path: string) => Set<string> | null} read
 * @param {(path: string) => boolean} [exists] whether a repository file exists
 * @returns {string[]}
 */
export function localAnchorProblems(markdown, file, read, exists) {
  const problems = [];
  for (const { node } of walk(parseMarkdown(markdown))) {
    if (node.type !== "link" || !node.url || !isLocal(node.url)) continue;
    const hash = node.url.indexOf("#");
    if (exists) {
      // Every local link names a file that exists, of any type, and a
      // fragment that is not empty.
      const target = decodeURIComponent(hash === -1 ? node.url : node.url.slice(0, hash));
      const relative = target ? path.posix.normalize(path.posix.join(path.posix.dirname(file), target)) : file;
      if (!exists(relative)) {
        problems.push(`${file}:${node.position.start.line}: the local link ${node.url} names no file`);
        continue;
      }
      if (hash === node.url.length - 1) {
        problems.push(`${file}:${node.position.start.line}: the local link ${node.url} has an empty fragment`);
        continue;
      }
    }
    if (hash === -1 || hash === node.url.length - 1) continue;
    const target = decodeURIComponent(node.url.slice(0, hash));
    if (target && !target.endsWith(".md")) continue;
    const relative = target ? path.posix.normalize(path.posix.join(path.posix.dirname(file), target)) : file;
    const fragment = decodeURIComponent(node.url.slice(hash + 1));
    const anchors = read(relative);
    if (!anchors || !anchors.has(fragment)) {
      problems.push(`${file}:${node.position.start.line}: the local link ${node.url} names no heading`);
    }
  }
  return problems;
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
      if (hooks.work) countWork(hooks.work, "text");
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

/**
 * Whether a link target is local: it has no URI scheme and is no network path.
 * @param {string} url
 */
function isLocal(url) {
  return !/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith("//");
}

/**
 * A format 50 document names no format 49 file that has a format 50 copy.
 * A path `grammars/X` sends the reader to the old notation, where
 * `grammars50/X` now exists, so the document links that copy instead. The
 * check reads the Markdown tree of tools/markdown.js. It reads the target of
 * each local link, and each path in a text or code span, also a relative one
 * such as `../../../grammars/X`. A section whose heading starts with
 * "Differences from the format 49" names the format 49 copies on purpose, so
 * the check skips it up to the next heading of the same or a higher level,
 * with each footnote that only that section cites. It skips code blocks,
 * which name no paths. A path that ends in `/`, such as `grammars/lojban/`,
 * names the layers that have no format 50 copy yet.
 * @param {string} markdown
 * @param {string} file the repository path of the document
 * @param {(path: string) => boolean} exists whether a repository file or directory exists
 * @returns {string[]}
 */
export function formatPathProblems(markdown, file, exists) {
  const tree = parseMarkdown(markdown);
  const dir = path.posix.dirname(file);
  // The top-level blocks that the check skips, and the footnotes that each part cites.
  let skipDepth = null;
  const skipped = new Set();
  const citedOutside = new Set(), citedInside = new Set();
  for (const block of tree.children ?? []) {
    if (block.type === "heading") {
      if (skipDepth !== null && block.depth <= skipDepth) skipDepth = null;
      const text = [...walk(block)].map(({ node }) => ["text", "inlineCode"].includes(node.type) ? node.value ?? "" : "").join("");
      if (skipDepth === null && text.startsWith("Differences from the format 49")) skipDepth = block.depth;
    }
    if (block.type === "footnoteDefinition") continue;
    const inside = skipDepth !== null;
    if (inside) skipped.add(block);
    for (const { node } of walk(block)) {
      if (node.type === "footnoteReference") (inside ? citedInside : citedOutside).add(node.identifier);
    }
  }
  for (const block of tree.children ?? []) {
    if (block.type === "footnoteDefinition" && citedInside.has(block.identifier) && !citedOutside.has(block.identifier)) skipped.add(block);
  }
  const problems = [];
  const report = (node, written, relative) => {
    if (!relative.startsWith("grammars/") || relative.endsWith("/")) return;
    const copy = `grammars50/${relative.slice("grammars/".length)}`;
    if (exists(copy)) problems.push(`${file}:${node.position.start.line}: ${written} names ${relative}, which has a format 50 copy; link ${copy} instead`);
  };
  const resolve = (target) => path.posix.normalize(path.posix.join(dir, target));
  for (const block of tree.children ?? []) {
    if (skipped.has(block)) continue;
    for (const { node, ancestors } of walk(block)) {
      if (node.type === "code" || ancestors.some((a) => a.type === "code")) continue;
      if (node.type === "link" && node.url && isLocal(node.url)) {
        const target = decodeURIComponent(node.url.split("#")[0]);
        if (target) report(node, node.url, resolve(target));
      }
      if (node.type !== "text" && node.type !== "inlineCode") continue;
      for (const match of (node.value ?? "").matchAll(/(?<![\w/.-])((?:\.\.\/)*)grammars\/[\w./-]*/g)) {
        const written = match[0].replace(/\.+$/, "");
        report(node, written, match[1] ? resolve(written) : written);
      }
    }
  }
  return problems;
}
