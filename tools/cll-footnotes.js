// CLL footnote labels and targets, checked against the published headings
// and examples in tests/cll-footnotes.json. CI reads that index once and
// needs no network. tools/cll-footnotes-index.py regenerates the index.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { markdownFiles } from "./documents.js";
import { parseMarkdown, walk } from "./markdown.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const pinned = JSON.parse(fs.readFileSync(path.join(root, "tests", "cll-footnotes.json"), "utf8"));

const text = (node) => node.value ?? (node.children || []).map(text).join("");
const isCll = (url) => url.startsWith("https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/")
  || /^https:\/\/github\.com\/int19h\/cll\/blob\/v[\d.]+\/chapters\//.test(url);

/**
 * The CLL footnotes whose pages, anchors or numbers disagree with the
 * pinned source, as FILE:LINE diagnostics. A page record is read from the
 * shared index, never fetched separately for each repeated citation.
 * @param {string} markdown
 * @param {string} file
 * @param {typeof pinned} [index]
 * @returns {string[]}
 */
export function cllFootnoteProblems(markdown, file, index = pinned) {
  const problems = [];
  for (const { node, ancestors } of walk(parseMarkdown(markdown))) {
    if (node.type !== "link" || !ancestors.some((parent) => parent.type === "footnoteDefinition")) continue;
    if (!isCll(node.url) && !/^CLL\s/.test(text(node))) continue;
    const report = (message) => problems.push(`${file}:${node.position.start.line}: CLL footnote: ${message}`);
    const label = text(node);
    const edition = /^CLL (\d+\.\d+(?:\.\d+)?),/.exec(label)?.[1];
    if (!edition) {
      report("the link label must name its CLL edition and number");
      continue;
    }
    let url;
    let anchor;
    try {
      url = new URL(node.url);
      anchor = decodeURIComponent(url.hash.slice(1));
    } catch {
      report(`invalid target URL: ${node.url}`);
      continue;
    }
    url.hash = "";
    const page = index.pages[url.href];
    if (!page) {
      report(`page is absent from the pinned source: ${url.href}`);
      continue;
    }
    const expectedEdition = url.href.includes("/v1.3.4/") ? "1.3.4" : "1.1";
    if (edition !== expectedEdition) report(`edition ${edition} differs from source edition ${expectedEdition}`);
    let target = page.default;
    if (anchor) {
      if (page.anchors) target = page.anchors[anchor];
      else {
        const lines = /^L(\d+)(?:-L(\d+))?$/.exec(anchor);
        const start = Number(lines?.[1]);
        const end = Number(lines?.[2] || lines?.[1]);
        if (!lines || start < 1 || end < start || end > page.lines) target = undefined;
        else target = page.sections.find((section) => start <= section.line && section.line <= end);
      }
      if (!target) {
        report(`anchor has no heading or example in the pinned source: #${anchor}`);
        continue;
      }
    }
    const numbers = [...label.matchAll(/\b(chapter|section|example|appendix)\s+(A?\d+(?:\.\d+)?)/g)];
    if (!numbers.length) report("the link label must name a chapter, section, example or appendix");
    for (const [, kind, number] of numbers) {
      if (target[kind] !== number) report(`${kind} ${number} does not match the target (${target.title})`);
    }
  }
  return problems;
}

/** Every source document, including Markdown outside grammars/. */
export function repositoryCllFootnoteProblems(directory = root) {
  return markdownFiles(directory).filter((file) => !/^lib\/(?:js|go|rust|python\/src\/gencmu)\/grammars\//.test(file))
    .flatMap((file) => cllFootnoteProblems(fs.readFileSync(path.join(directory, file), "utf8"), file));
}
