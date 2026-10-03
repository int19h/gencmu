#!/usr/bin/env node
// Whether every Lojban text that a grammar document quotes is pinned by a
// corpus case, or listed in tests/quoted-allow.txt as a text that is not a
// claim (tests/README.md, "Quoted texts"). A grammar change that makes the
// prose about a text false then fails that text's case, which points the
// author at the sentence. tools/sync.js --check runs it, and so can a direct
// run: node tools/quoted-texts.js.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseMarkdown, walk } from "./markdown.js";
import { PROSE, proseLineProblems } from "./prose-lines.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The documents whose quoted texts are checked, relative to the repository,
 * each with the dialect that its claims are about.
 * @type {Record<string, string>}
 */
export const DOCUMENTS = {
  "grammars/syntax/cll.md": "cll-ebnf",
  "grammars/dialects/cll-ebnf.md": "cll-ebnf",
  "grammars/dialects/bpfk.md": "bpfk",
};

/** The dialects that a line of prose can name, as "the bpfk dialect". */
export const DIALECTS = ["cll-ebnf", "bpfk", "experimental", "zantufa"];

/** The least number of words that makes a code span a quoted text. */
export const MIN_WORDS = 3;

/**
 * The text of a code span as a quoted Lojban text: its words joined by
 * single spaces. A span is one when it has at least MIN_WORDS words,
 * separated by white space, and holds only lowercase ASCII letters,
 * apostrophes, full stops, commas and white space, with no `...`. So a rule
 * name (it has a hyphen or a digit), a selma'o or a token (uppercase), a
 * piece of jbogenbau (brackets, `#`, `$`, `|` and the like) and a text with
 * a gap (`...` or `…`) are not quoted texts.
 * @param {string} content
 * @returns {string | null}
 */
export function quotedText(content) {
  if (!/^[a-z'.,\s]+$/.test(content) || content.includes("...")) return null;
  const words = content.trim().split(/\s+/);
  return words.length >= MIN_WORDS ? words.join(" ") : null;
}

/**
 * The quoted texts of a Markdown document, each with its line (counted
 * from 1) and the dialects that its prose block names. They are the code
 * spans that a CommonMark and GFM parser finds (tools/markdown.js), so a
 * code block holds none. Every prose block is one line
 * (tools/prose-lines.js), so the line of a text is the paragraph, list item,
 * heading or table row that quotes it.
 * @param {string} markdown
 * @returns {{text: string, line: number, dialects: string[]}[]}
 */
export function quotedTexts(markdown) {
  const texts = [];
  /** @type {Map<object, string[]>} the dialects that each prose block names */
  const named = new Map();
  for (const { node, ancestors } of walk(parseMarkdown(markdown))) {
    if (node.type !== "inlineCode") continue;
    const text = quotedText(node.value);
    if (!text) continue;
    const block = [...ancestors].reverse().find((ancestor) => PROSE.has(ancestor.type));
    if (block && !named.has(block)) named.set(block, namedDialects(proseOf(block)));
    texts.push({ text, line: node.position.start.line, dialects: block ? named.get(block) : [] });
  }
  return texts;
}

/**
 * The prose of a block: its text, the text of its links included, with
 * each code span as a space. So neither a code span nor a link target
 * names a dialect.
 * @param {import("./markdown.js").Node} block
 * @returns {string}
 */
export function proseOf(block) {
  let prose = "";
  for (const { node } of walk(block)) {
    if (node.type === "text") prose += node.value;
    else if (node.type === "inlineCode") prose += " ";
  }
  return prose;
}

/**
 * The dialects that a text names as "the X dialect", or "the X and Y
 * dialects", in DIALECTS.
 * @param {string} prose
 * @returns {string[]}
 */
export function namedDialects(prose) {
  const name = DIALECTS.join("|");
  const list = new RegExp(`\\b((?:${name})(?:(?:, and |, | and )(?:${name}))*) dialects?\\b`, "g");
  const named = new Set();
  for (const match of prose.matchAll(list)) for (const dialect of match[1].split(/, and |, | and /)) named.add(dialect);
  return [...named];
}

/**
 * The allow-list: each line that is not empty and does not begin with `#`
 * is a quoted text, then ` # `, then why no case pins it.
 * @param {string} list
 * @returns {{entries: Map<string, number>, problems: string[]}}
 */
export function readAllowList(list) {
  const entries = new Map();
  const problems = [];
  list.split(/\r\n|\r|\n/).forEach((line, index) => {
    if (!line.trim() || line.startsWith("#")) return;
    const at = `tests/quoted-allow.txt:${index + 1}`;
    const match = /^(.*?)\s+#\s+(\S.*)$/.exec(line);
    const text = match && quotedText(match[1]);
    if (!text) problems.push(`${at}: not a quoted text followed by " # " and a reason`);
    else if (entries.has(text)) problems.push(`${at}: \`${text}\` is listed twice`);
    else entries.set(text, index + 1);
  });
  return { entries, problems };
}

/**
 * Every quoted text of DOCUMENTS that lacks a case of its document's
 * dialect, or of a dialect that its line names, and that the allow-list
 * does not list, and every entry of the allow-list that is not needed: a text
 * that no document quotes, or that a case pins wherever it is quoted.
 * @param {string} [base] the repository
 * @returns {string[]}
 */
export function quotedTextProblems(base = root) {
  /** @type {Map<string, Set<string>>} each case text, with its dialects */
  const cases = new Map();
  const corpus = path.join(base, "tests", "corpus");
  for (const file of fs.readdirSync(corpus).filter((name) => name.endsWith(".jsonl")).sort()) {
    for (const line of fs.readFileSync(path.join(corpus, file), "utf8").split("\n")) {
      if (!line.trim()) continue;
      const c = JSON.parse(line);
      const text = c.text.trim().split(/\s+/).join(" ");
      if (!cases.has(text)) cases.set(text, new Set());
      cases.get(text).add(c.dialect);
    }
  }
  const allowFile = path.join(base, "tests", "quoted-allow.txt");
  const { entries, problems } = readAllowList(fs.existsSync(allowFile) ? fs.readFileSync(allowFile, "utf8") : "");
  const used = new Set();
  for (const [document, dialect] of Object.entries(DOCUMENTS)) {
    const markdown = fs.readFileSync(path.join(base, document), "utf8");
    // The quoted texts are read line by line, which holds only for the
    // layout that the one-line check accepts.
    problems.push(...proseLineProblems(markdown, document));
    for (const { text, line, dialects } of quotedTexts(markdown)) {
      // The document's own dialect, and every dialect that the line names.
      const missing = [...new Set([dialect, ...dialects])].filter((name) => !(cases.get(text) || new Set()).has(name));
      if (!missing.length) continue;
      if (entries.has(text)) { used.add(text); continue; }
      problems.push(`${document}:${line}: \`${text}\` is pinned by no case of ${missing.join(" or of ")}; add one to tests/corpus/adhoc.jsonl, or list it in tests/quoted-allow.txt with the reason`);
    }
  }
  for (const [text, line] of entries) {
    if (!used.has(text)) problems.push(`tests/quoted-allow.txt:${line}: \`${text}\` is not needed: no document quotes it unpinned`);
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const problems = quotedTextProblems();
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log("every quoted text is pinned or allowed");
}
