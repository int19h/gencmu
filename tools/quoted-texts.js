#!/usr/bin/env node
// Whether every Lojban text that a grammar document quotes is pinned by a
// corpus case, or listed in tests/quoted-allow.txt (tests/README.md,
// "Quoted texts"). A grammar change that makes the prose about a text false
// then fails that text's case, and the JavaScript corpus runner names the
// sentences that quote it (quotingPlaces). tools/sync.js --check runs the
// check, and so can a direct run: node tools/quoted-texts.js.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseMarkdown, walk } from "./markdown.js";
import { PROSE, proseLineProblems } from "./prose-lines.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The documents whose quoted texts are checked, relative to the repository,
 * each with the dialects that its claims are about. These are the dialects
 * that include it (documentDialects), less those of LAYERED.
 * @type {Record<string, string[]>}
 */
export const DOCUMENTS = {
  "grammars/syntax/cll.md": ["cll-ebnf", "bpfk"],
  "grammars/dialects/cll-ebnf.md": ["cll-ebnf"],
  "grammars/dialects/bpfk.md": ["bpfk"],
};

/**
 * The dialects that include a document of DOCUMENTS, with a later document
 * of the same stage that changes its rules, so that its claims are not
 * about them. Each has the reason.
 * @type {Record<string, Record<string, string>>}
 */
export const LAYERED = {
  "grammars/syntax/cll.md": { experimental: "grammars/syntax/experimental.md, a later layer of its stage, redefines its rules" },
};

/**
 * The dialect documents that the check leaves out for now, each with the
 * reason. A dialect document in neither list is an error, so that a new
 * dialect is not left out in silence.
 * @type {Record<string, string>}
 */
export const UNCHECKED = {
  "grammars/dialects/experimental.md": "its texts are not pinned yet",
  "grammars/dialects/zantufa.md": "its texts are not pinned yet",
  "grammars/dialects/notation.md": "it reads jbogenbau, not Lojban",
};

/** The dialects that the prose of a block can name. */
export const DIALECTS = ["cll-ebnf", "bpfk", "experimental", "zantufa"];

/** The least number of words that makes a code span a quoted text. */
export const MIN_WORDS = 2;

/**
 * The text of a code span as a quoted Lojban text: its words joined by
 * single spaces. A span is one when it has at least MIN_WORDS words,
 * separated by white space, each with a letter, and holds only lowercase
 * ASCII letters, apostrophes, full stops, commas and white space, with no
 * `...`. So a rule name (it has a hyphen or a digit), a selma'o or a token
 * (uppercase), a piece of jbogenbau (brackets, `#`, `$`, `|` and the like)
 * and a text with a gap (`...`, `…` or `. . .`) are not quoted texts.
 * @param {string} content
 * @returns {string | null}
 */
export function quotedText(content) {
  if (!/^[a-z'.,\s]+$/.test(content) || content.includes("...")) return null;
  const words = content.trim().split(/\s+/);
  if (words.some((word) => !/[a-z]/.test(word))) return null;
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
 * The dialects of DIALECTS that a piece of prose names, each as a word of
 * its own: "the bpfk dialect", "In cll-ebnf and bpfk", "the experimental
 * layer". A name joined to other letters or a hyphen, as in `bpfk-like`, is
 * not one.
 * @param {string} prose
 * @returns {string[]}
 */
export function namedDialects(prose) {
  const name = new RegExp(`(?<![\\p{L}\\p{N}_-])(${DIALECTS.join("|")})(?![\\p{L}\\p{N}_-])`, "gu");
  return [...new Set([...prose.matchAll(name)].map((match) => match[1]))];
}

/**
 * The dialects that each document of the repository belongs to: a dialect
 * document `grammars/dialects/X.md` belongs to X, and a document that it
 * includes belongs to X too. So the CLL syntax grammar belongs to cll-ebnf
 * and bpfk, which both include it.
 * @param {string} [base] the repository
 * @returns {Map<string, string[]>}
 */
export function documentDialects(base = root) {
  /** @type {Map<string, string[]>} */
  const dialects = new Map();
  const add = (/** @type {string} */ document, /** @type {string} */ dialect) => {
    if (!dialects.has(document)) dialects.set(document, []);
    if (!dialects.get(document).includes(dialect)) dialects.get(document).push(dialect);
  };
  for (const document of dialectDocuments(base)) {
    const dialect = path.posix.basename(document, ".md");
    add(document, dialect);
    // The includes stand in the document's jbogenbau blocks, as the parser
    // finds them.
    for (const { node } of walk(parseMarkdown(fs.readFileSync(path.join(base, document), "utf8")))) {
      if (node.type !== "code" || node.lang !== "jbogenbau") continue;
      for (const match of node.value.matchAll(/^\s*%include\s+"([^"]+)"/gm)) {
        add(path.posix.normalize(path.posix.join(path.posix.dirname(document), match[1])), dialect);
      }
    }
  }
  return dialects;
}

/**
 * The dialect documents of the repository, relative to it, sorted.
 * @param {string} base
 * @returns {string[]}
 */
function dialectDocuments(base) {
  const directory = path.join(base, "grammars", "dialects");
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).filter((name) => name.endsWith(".md")).sort().map((name) => `grammars/dialects/${name}`);
}

/**
 * @typedef {object} AllowEntry
 * @property {string} text
 * @property {string} document the document whose quotes the entry covers
 * @property {number} line the entry's line in the allow-list
 * @property {string} [reason] why the text needs no case of its own
 * @property {string[]} [cases] the cases whose texts hold the text
 */

/**
 * The allow-list. Each line that is not empty and does not begin with `#`
 * is an entry for one document: a quoted text, ` # `, the document, and
 * then either ` # ` and the reason why no case pins the text, or ` = ` and
 * the ids of the cases, separated by spaces, whose texts hold it.
 * @param {string} list
 * @returns {{entries: AllowEntry[], problems: string[]}}
 */
export function readAllowList(list) {
  /** @type {AllowEntry[]} */
  const entries = [];
  const problems = [];
  const keys = new Set();
  list.split(/\r\n|\r|\n/).forEach((line, index) => {
    if (!line.trim() || line.startsWith("#")) return;
    const at = `tests/quoted-allow.txt:${index + 1}`;
    const match = /^(.*?)\s+#\s+(\S+)\s+(?:#\s+(\S.*)|=\s+(\S.*))$/.exec(line);
    const text = match && quotedText(match[1]);
    if (!text) {
      problems.push(`${at}: not a quoted text, " # ", a document, and " # " and a reason or " = " and case ids`);
      return;
    }
    const key = `${match[2]}\0${text}`;
    if (keys.has(key)) problems.push(`${at}: \`${text}\` is listed twice for ${match[2]}`);
    keys.add(key);
    /** @type {AllowEntry} */
    const entry = { text, document: match[2], line: index + 1 };
    if (match[3]) entry.reason = match[3];
    else entry.cases = match[4].trim().split(/\s+/);
    entries.push(entry);
  });
  return { entries, problems };
}

/**
 * Every corpus case of the repository.
 * @param {string} base
 * @returns {{id: string, text: string, dialect: string}[]}
 */
function corpusCases(base) {
  const cases = [];
  const corpus = path.join(base, "tests", "corpus");
  for (const file of fs.readdirSync(corpus).filter((name) => name.endsWith(".jsonl")).sort()) {
    for (const line of fs.readFileSync(path.join(corpus, file), "utf8").split("\n")) {
      if (line.trim()) cases.push(JSON.parse(line));
    }
  }
  return cases;
}

/** @param {string} text */
const normal = (text) => text.trim().split(/\s+/).join(" ");

/**
 * Whether a case holds a quoted text as consecutive words: in its text, or
 * in the labels of its words, which have no full stop or comma around a
 * word. So the case of `fyno`, whose words are `fy` and `no`, holds `fy no`.
 * @param {{text: string, words: string}} c
 * @param {string} text
 * @returns {boolean}
 */
function holds(c, text) {
  const bare = text.split(" ").map((word) => word.replace(/^[.,]+|[.,]+$/g, "")).join(" ");
  return ` ${c.text} `.includes(` ${text} `) || ` ${c.words} `.includes(` ${bare} `);
}

/**
 * Every quoted text of DOCUMENTS that lacks a case of a dialect of its
 * document, or of a dialect that its block names, and that the allow-list
 * does not cover for that document. Also every problem of the allow-list:
 * an entry that is not needed, since the document does not quote the text
 * or cases pin it, and an entry whose cases are missing, do not hold the
 * text as consecutive words, or leave out a dialect that the text needs.
 * Also a dialect document that neither DOCUMENTS nor UNCHECKED lists, and
 * a case that pins a quoted text and is not in tests/core.txt.
 * @param {string} [base] the repository
 * @param {{documents?: Record<string, string[]>, unchecked?: Record<string, string>, layered?: Record<string, Record<string, string>>}} [scope]
 *   the lists that the check reads, DOCUMENTS, UNCHECKED and LAYERED unless given
 * @returns {string[]}
 */
export function quotedTextProblems(base = root, { documents = DOCUMENTS, unchecked = UNCHECKED, layered = LAYERED } = {}) {
  const all = corpusCases(base);
  /** @type {Map<string, Set<string>>} each case text, with its dialects */
  const cases = new Map();
  /** @type {Map<string, {id: string, dialect: string}[]>} the cases of each text */
  const idsOf = new Map();
  /** @type {Map<string, {text: string, words: string, dialect: string}>} */
  const byId = new Map();
  for (const c of all) {
    const text = normal(c.text);
    if (!cases.has(text)) cases.set(text, new Set());
    cases.get(text).add(c.dialect);
    if (!idsOf.has(text)) idsOf.set(text, []);
    idsOf.get(text).push({ id: c.id, dialect: c.dialect });
    byId.set(c.id, { text, words: (c.words || []).join(" "), dialect: c.dialect });
  }
  const allowFile = path.join(base, "tests", "quoted-allow.txt");
  const { entries, problems } = readAllowList(fs.existsSync(allowFile) ? fs.readFileSync(allowFile, "utf8") : "");
  const allowed = new Map(entries.map((entry) => [`${entry.document}\0${entry.text}`, entry]));
  const used = new Set();
  // Every case that pins a quoted text is in the core sample, which every
  // library runs on a pull request.
  const coreFile = path.join(base, "tests", "core.txt");
  const core = fs.existsSync(coreFile) ? new Set(fs.readFileSync(coreFile, "utf8").split(/\r\n|\r|\n/).filter(Boolean)) : null;
  const outsideCore = new Set();
  const inCore = (/** @type {string} */ id, /** @type {string} */ at) => {
    if (!core || core.has(id) || outsideCore.has(id)) return;
    outsideCore.add(id);
    problems.push(`${at}: ${id} pins a quoted text and is not in tests/core.txt`);
  };
  const dialectsOf = documentDialects(base);
  for (const document of dialectDocuments(base)) {
    if (!(document in documents) && !(document in unchecked)) {
      problems.push(`${document}: a dialect document that tools/quoted-texts.js neither checks (DOCUMENTS) nor leaves out with a reason (UNCHECKED)`);
    }
  }
  for (const [document, listed] of Object.entries(documents)) {
    // The dialects of a document are those that include it, less the
    // layered ones, so that DOCUMENTS cannot drift from the pipelines.
    const including = (dialectsOf.get(document) || []).filter((name) => !(name in (layered[document] || {})));
    if ([...including].sort().join() !== [...listed].sort().join()) {
      problems.push(`${document}: DOCUMENTS in tools/quoted-texts.js gives the dialects ${listed.join(", ")}, and the pipelines include it in ${including.join(", ") || "none"}`);
    }
  }
  for (const [document, claimed] of Object.entries(documents)) {
    const markdown = fs.readFileSync(path.join(base, document), "utf8");
    // The quoted texts are read by the line of their block, which holds
    // only for the layout that the one-line check accepts.
    problems.push(...proseLineProblems(markdown, document));
    for (const { text, line, dialects } of quotedTexts(markdown)) {
      const needed = [...new Set([...claimed, ...dialects])];
      for (const { id, dialect } of idsOf.get(text) || []) if (needed.includes(dialect)) inCore(id, `${document}:${line}`);
      const missing = needed.filter((name) => !(cases.get(text) || new Set()).has(name));
      if (!missing.length) continue;
      const entry = allowed.get(`${document}\0${text}`);
      if (!entry) {
        problems.push(`${document}:${line}: \`${text}\` is pinned by no case of ${missing.join(" or of ")}; add one to tests/corpus/adhoc.jsonl, or list it in tests/quoted-allow.txt`);
        continue;
      }
      used.add(entry);
      if (!entry.cases) continue;
      // The entry's cases hold the text, in every dialect that it needs.
      const holding = new Set();
      for (const id of entry.cases) {
        const c = byId.get(id);
        if (!c) problems.push(`tests/quoted-allow.txt:${entry.line}: no case has the id ${id}`);
        else if (!holds(c, text)) problems.push(`tests/quoted-allow.txt:${entry.line}: neither the text nor the words of ${id} hold \`${text}\``);
        else {
          holding.add(c.dialect);
          inCore(id, `tests/quoted-allow.txt:${entry.line}`);
        }
      }
      const uncovered = missing.filter((name) => !holding.has(name));
      if (uncovered.length) problems.push(`${document}:${line}: \`${text}\` is held by no listed case of ${uncovered.join(" or of ")} (tests/quoted-allow.txt:${entry.line})`);
    }
  }
  for (const entry of entries) {
    if (!used.has(entry)) problems.push(`tests/quoted-allow.txt:${entry.line}: \`${entry.text}\` is not needed: ${entry.document} does not quote it unpinned`);
  }
  return problems;
}

/**
 * The places in DOCUMENTS that quote each text, as "DOCUMENT:LINE", keyed by
 * the text with its words joined by single spaces. The corpus runner names
 * them when a case of the text fails, since the prose there may be false.
 * @param {string} [base] the repository
 * @param {Record<string, string[]>} [documents]
 * @returns {Map<string, string[]>}
 */
export function quotingPlaces(base = root, documents = DOCUMENTS) {
  /** @type {Map<string, string[]>} */
  const places = new Map();
  for (const document of Object.keys(documents)) {
    for (const { text, line } of quotedTexts(fs.readFileSync(path.join(base, document), "utf8"))) {
      if (!places.has(text)) places.set(text, []);
      places.get(text).push(`${document}:${line}`);
    }
  }
  return places;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const problems = quotedTextProblems();
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log("every quoted text is pinned or allowed");
}
