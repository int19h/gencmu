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
import { codeSpans } from "./links.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The documents whose quoted texts are checked, relative to the repository. */
export const DOCUMENTS = [
  "grammars/syntax/cll.md",
  "grammars/dialects/cll-ebnf.md",
  "grammars/dialects/bpfk.md",
];

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
 * from 1). Fenced blocks hold grammar and examples of output, not prose, so
 * their lines are skipped.
 * @param {string} markdown
 * @returns {{text: string, line: number}[]}
 */
export function quotedTexts(markdown) {
  const texts = [];
  let fence = null;
  markdown.split(/\r\n|\r|\n/).forEach((line, index) => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && /^\s*[`~]+\s*$/.test(line)) fence = null;
      return;
    }
    if (marker) { fence = marker[1]; return; }
    for (const span of codeSpans(line)) {
      const text = quotedText(span.content);
      if (text) texts.push({ text, line: index + 1 });
    }
  });
  return texts;
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
 * The dialect whose cases pin the texts of a document: X for
 * grammars/dialects/X.md, and any dialect (null) for the others.
 * @param {string} document
 * @returns {string | null}
 */
export function pinningDialect(document) {
  const match = /^grammars\/dialects\/([^/]+)\.md$/.exec(document);
  return match ? match[1] : null;
}

/**
 * Every quoted text of DOCUMENTS that no case pins and the allow-list does
 * not list, and every entry of the allow-list that is not needed: a text
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
  for (const document of DOCUMENTS) {
    const dialect = pinningDialect(document);
    for (const { text, line } of quotedTexts(fs.readFileSync(path.join(base, document), "utf8"))) {
      const dialects = cases.get(text);
      if (dialects && (!dialect || dialects.has(dialect))) continue;
      if (entries.has(text)) { used.add(text); continue; }
      problems.push(`${document}:${line}: \`${text}\` is pinned by no case${dialect ? ` of ${dialect}` : ""}; add one to tests/corpus/adhoc.jsonl, or list it in tests/quoted-allow.txt with the reason`);
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
