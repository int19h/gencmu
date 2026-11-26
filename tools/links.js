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
 * Local links must name an existing heading when they have a heading
 * fragment. With `exists`, every local link must also name an existing file
 * or directory, of any type, and a link may not end in an empty fragment.
 * The check reads inline links, reference links, autolinks and images, as
 * tools/markdown.js parses them. A reference counts at its own position,
 * with the destination of its definition. A definition that no reference
 * uses makes no link.
 * @param {string} markdown
 * @param {string} file
 * @param {(path: string) => Set<string> | null} read
 * @param {(path: string) => boolean} [exists] whether a repository file or directory exists
 * @returns {string[]}
 */
export function localAnchorProblems(markdown, file, read, exists) {
  const tree = parseMarkdown(markdown);
  const destinations = definitions(tree);
  const problems = [];
  for (const { node } of walk(tree)) {
    const url = destination(node, destinations);
    if (url === null) continue;
    const target = resolveUrl(url, file);
    if (!target) continue;
    const at = `${file}:${node.position.start.line}: the local link ${url}`;
    if (exists) {
      if (!exists(target.path)) {
        problems.push(`${at} names no file`);
        continue;
      }
      if (target.fragment === "") {
        problems.push(`${at} has an empty fragment`);
        continue;
      }
    }
    if (!target.fragment || !target.path.endsWith(".md")) continue;
    const anchors = read(target.path);
    if (!anchors || !anchors.has(target.fragment)) problems.push(`${at} names no heading`);
  }
  return problems;
}

/**
 * The definitions of a Markdown tree, by their normalized identifiers. The
 * first definition of an identifier wins, as in CommonMark.
 * @param {import("./markdown.js").Node} tree
 * @returns {Map<string, string>}
 */
function definitions(tree) {
  const found = new Map();
  for (const { node } of walk(tree)) {
    if (node.type === "definition" && !found.has(node.identifier)) found.set(node.identifier, node.url ?? "");
  }
  return found;
}

/**
 * The destination of a link, an image or a reference to a definition, or
 * null for any other node.
 * @param {import("./markdown.js").Node} node
 * @param {Map<string, string>} destinations
 * @returns {string | null}
 */
function destination(node, destinations) {
  if (node.type === "link" || node.type === "image") return node.url ?? "";
  if (node.type === "linkReference" || node.type === "imageReference") return destinations.get(node.identifier) ?? null;
  return null;
}

/**
 * Decodes each valid percent escape run and keeps any other percent sign
 * as it is. So `100%.txt` names the file `100%.txt`, and so does
 * `100%25.txt`.
 * @param {string} text
 */
function percentDecode(text) {
  return text.replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
}

/**
 * The repository file and the fragment that a local URL names, as a
 * Markdown reader on GitHub resolves it, or null for an external URL. The
 * fragment is null when the URL has none, and "" when it ends in `#`. The
 * query is dropped. Percent escapes are decoded after the URL is split, so
 * an encoded `#` or `?` stays in the file name. An empty path names the
 * document itself. A path that starts with `/` starts at the repository
 * root. Any other path is relative to the document's directory.
 * @param {string} url
 * @param {string} file the repository path of the document
 * @returns {{path: string, fragment: string | null} | null}
 */
function resolveUrl(url, file) {
  if (!isLocal(url)) return null;
  const hash = url.indexOf("#");
  const beforeHash = hash === -1 ? url : url.slice(0, hash);
  const fragment = hash === -1 ? null : percentDecode(url.slice(hash + 1));
  const question = beforeHash.indexOf("?");
  const written = percentDecode(question === -1 ? beforeHash : beforeHash.slice(0, question));
  return { path: resolvePath(written, file), fragment };
}

/**
 * @param {string} written a path as a document writes it
 * @param {string} file the repository path of the document
 */
function resolvePath(written, file) {
  if (!written) return file;
  if (written.startsWith("/")) return path.posix.normalize(written.slice(1));
  return path.posix.normalize(path.posix.join(path.posix.dirname(file), written));
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
 * A path `grammars/X` sends the reader to the old notation, where the file
 * `grammars50/X` now exists, so the document links that copy instead. A
 * directory is no such file, because a layer can still be in format 49.
 *
 * The check reads the Markdown tree of tools/markdown.js. It reads the
 * destination of each local link, reference and image, as
 * localAnchorProblems resolves it. It also reads each whole path operand in
 * prose and in code spans. An operand is a run of characters without
 * whitespace, without its surrounding quotes, brackets and sentence
 * punctuation. It counts when it starts with `grammars/`, `./`, `../` or
 * `/`. A query, a fragment and a line suffix such as `:12` do not belong to
 * the file name. A bare `grammars/X` names the repository path. The displayed URL of
 * an external link is a URL, not prose. Code blocks name no paths.
 *
 * A section whose heading starts with "Differences from the format 49" and
 * a word boundary names the format 49 copies on purpose. The check skips it
 * up to the next heading of the same or a higher level. It also skips each
 * footnote that only that section reaches, directly or through other
 * footnotes.
 * @param {string} markdown
 * @param {string} file the repository path of the document
 * @param {(path: string) => boolean} isFile whether a repository path is a file
 * @returns {string[]}
 */
export function formatPathProblems(markdown, file, isFile) {
  const tree = parseMarkdown(markdown);
  const destinations = definitions(tree);
  // The top-level blocks of the skipped sections, and the footnotes that each part cites.
  let skipDepth = null;
  const skipped = new Set();
  const citedOutside = new Set(), citedInside = new Set();
  /** @type {Map<string, Set<string>>} */
  const footnoteCites = new Map();
  /** @type {Map<string, import("./markdown.js").Node>} */
  const footnotes = new Map();
  const cites = (block) => new Set([...walk(block)].filter(({ node }) => node.type === "footnoteReference").map(({ node }) => node.identifier));
  for (const block of tree.children ?? []) {
    if (block.type === "heading") {
      if (skipDepth !== null && block.depth <= skipDepth) skipDepth = null;
      const text = [...walk(block)].map(({ node }) => ["text", "inlineCode"].includes(node.type) ? node.value ?? "" : "").join("");
      if (skipDepth === null && /^Differences from the format 49\b/.test(text)) skipDepth = block.depth;
    }
    if (block.type === "footnoteDefinition") {
      footnotes.set(block.identifier, block);
      footnoteCites.set(block.identifier, cites(block));
      continue;
    }
    const inside = skipDepth !== null;
    if (inside) skipped.add(block);
    for (const id of cites(block)) (inside ? citedInside : citedOutside).add(id);
  }
  // A footnote that a cited footnote cites is reached from the same part.
  // Each identifier enters each set once, so cycles end.
  const reach = (start) => {
    const reached = new Set(start);
    const queue = [...start];
    while (queue.length) {
      for (const next of footnoteCites.get(queue.pop()) ?? []) {
        if (!reached.has(next)) {
          reached.add(next);
          queue.push(next);
        }
      }
    }
    return reached;
  };
  const outside = reach(citedOutside), inside = reach(citedInside);
  for (const [id, block] of footnotes) if (inside.has(id) && !outside.has(id)) skipped.add(block);

  const problems = [];
  const report = (node, written, relative) => {
    if (!relative.startsWith("grammars/")) return;
    const copy = `grammars50/${relative.slice("grammars/".length)}`;
    if (isFile(copy)) problems.push(`${file}:${node.position.start.line}: ${written} names ${relative}, which has a format 50 copy; link ${copy} instead`);
  };
  for (const block of tree.children ?? []) {
    if (skipped.has(block)) continue;
    for (const { node, ancestors } of walk(block)) {
      if (node.type === "code" || ancestors.some((a) => a.type === "code")) continue;
      const url = destination(node, destinations);
      if (url !== null) {
        const target = resolveUrl(url, file);
        if (target) report(node, url, target.path);
        continue;
      }
      if (node.type !== "text" && node.type !== "inlineCode") continue;
      const link = ancestors.findLast((a) => a.type === "link");
      if (link && !isLocal(link.url ?? "")) continue;
      for (const operand of pathOperands(node.value ?? "")) {
        const written = operand.replace(/[?#].*$/s, "").replace(/:\d+(?:[-:]\d+)*$/, "");
        const relative = written.startsWith("grammars/") ? path.posix.normalize(written) : resolvePath(written, file);
        report(node, operand, relative);
      }
    }
  }
  return problems;
}

/**
 * The whole path operands of a piece of prose or code: each run without
 * whitespace, without surrounding quotes, brackets and sentence punctuation,
 * that starts with `grammars/`, `./`, `../` or `/`.
 * @param {string} text
 * @returns {string[]}
 */
function pathOperands(text) {
  const operands = [];
  for (const run of text.split(/\s+/u)) {
    const operand = run
      .replace(/^[\p{Ps}\p{Pi}"'`<]+/u, "")
      .replace(/[\p{Pe}\p{Pf}"'`>.,;:!?]+$/u, "");
    if (/^(?:grammars\/|\.{1,2}\/|\/(?!\/))/.test(operand)) operands.push(operand);
  }
  return operands;
}
