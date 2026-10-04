#!/usr/bin/env node
// Whether every Lojban text that a grammar document of the CLL dialects
// quotes is pinned by a corpus case, or listed in tests/quoted-allow.txt
// (tests/README.md, "Quoted texts"). A grammar change that makes the prose
// about a text false then fails a case, and the JavaScript corpus runner
// names the lines that quote the case's text, or the fragment that an
// allow-list entry pins with it (quotingPlaces). tools/sync.js --check runs
// the check, and so can a direct run: node tools/quoted-texts.js.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadDialect } from "../lib/js/src/node.js";
import { markdownFiles } from "./documents.js";
import { parseMarkdown, walk } from "./markdown.js";
import { PROSE, proseLineProblems } from "./prose-lines.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The dialects whose documents the check reads. Every document that the
 * pipeline of one of them includes, at any depth, is checked, and its
 * claims are about each of these dialects that includes it. The other
 * dialects layer their own documents over these, so the check holds a
 * claim about one of them only where the prose names it.
 */
export const CHECKED_DIALECTS = ["cll-ebnf", "bpfk"];

/**
 * The grammar documents that no checked dialect includes, each with the
 * reason that the check leaves it out. A grammar document that is neither
 * checked nor listed here is an error, so that a new document is not left
 * out in silence.
 * @type {Record<string, string>}
 */
export const UNCHECKED = {
  "grammars/dialects/experimental.md": "the experimental dialect: its texts are not pinned yet",
  "grammars/dialects/zantufa.md": "the Zantufa dialect: its texts are not pinned yet",
  "grammars/dialects/notation.md": "the notation dialect reads jbogenbau, not Lojban",
  "grammars/indicators/experimental.md": "only the experimental dialect includes it",
  "grammars/notation/lexical.md": "the notation dialect reads jbogenbau, not Lojban",
  "grammars/notation/syntax.md": "the notation dialect reads jbogenbau, not Lojban",
  "grammars/syntax/experimental.md": "only the experimental dialect includes it",
  "grammars/syntax/zantufa.md": "only the Zantufa dialect includes it",
  "grammars/words/experimental.md": "only the experimental dialect includes it",
  "grammars/words/lexicon-experimental.md": "only the experimental dialect includes it",
  "grammars/words/lexicon-zantufa.md": "only the Zantufa dialect includes it",
  "grammars/words/lohai.md": "only the experimental and Zantufa dialects include it",
  "grammars/words/zantufa-stream.md": "only the Zantufa dialect includes it",
  "grammars/words/zantufa.md": "only the Zantufa dialect includes it",
};

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
 * The names of the dialects of a repository that prose can name: those of
 * its dialect documents, less the notation dialect, which reads jbogenbau.
 * @param {string} [base] the repository
 * @returns {string[]}
 */
export function dialectNames(base = root) {
  return dialectDocuments(base).map((document) => path.posix.basename(document, ".md")).filter((name) => name !== "notation");
}

/**
 * The quoted texts of a Markdown document, each with its line (counted
 * from 1) and the dialects that its scope names. They are the code spans
 * that a CommonMark and GFM parser finds (tools/markdown.js), so a code
 * block holds none. Every paragraph, heading and table row is one line
 * (tools/prose-lines.js), so the line of a text is the block that quotes
 * it. The scope of a text is the innermost list item that holds it, or else
 * its block, so a blank line inside a list item changes nothing.
 * @param {string} markdown
 * @param {string[]} [dialects] the names that prose can name
 * @returns {{text: string, line: number, dialects: string[]}[]}
 */
export function quotedTexts(markdown, dialects = dialectNames()) {
  const texts = [];
  /** @type {Map<object, string[]>} the dialects that each scope names */
  const named = new Map();
  for (const { node, ancestors } of walk(parseMarkdown(markdown))) {
    if (node.type !== "inlineCode") continue;
    const text = quotedText(node.value);
    if (!text) continue;
    const scope = [...ancestors].reverse().find((ancestor) => ancestor.type === "listItem")
      || [...ancestors].reverse().find((ancestor) => PROSE.has(ancestor.type));
    if (scope && !named.has(scope)) named.set(scope, namedDialects(proseOf(scope), dialects));
    texts.push({ text, line: node.position.start.line, dialects: scope ? named.get(scope) : [] });
  }
  return texts;
}

/**
 * The prose of a block: its text, the text of its links included, with
 * each code span as a space and a space between paragraphs. So neither a
 * code span nor a link target names a dialect.
 * @param {import("./markdown.js").Node} block
 * @returns {string}
 */
export function proseOf(block) {
  let prose = "";
  for (const { node } of walk(block)) {
    if (node.type === "text") prose += node.value;
    else if (node.type === "inlineCode" || PROSE.has(node.type)) prose += " ";
  }
  return prose;
}

/**
 * The dialects that a piece of prose names, each as a word of its own and in
 * any case: "the bpfk dialect", "In cll-ebnf and bpfk", "the experimental
 * layer", "the Zantufa dialect". A name joined to other letters or a
 * hyphen, as in `bpfk-like`, is not one. "experimental" is an English word
 * too, and in this prose it always names the dialect.
 * @param {string} prose
 * @param {string[]} [dialects] the names that prose can name
 * @returns {string[]}
 */
export function namedDialects(prose, dialects = dialectNames()) {
  if (!dialects.length) return [];
  const name = new RegExp(`(?<![\\p{L}\\p{N}_-])(${dialects.join("|")})(?![\\p{L}\\p{N}_-])`, "giu");
  return [...new Set([...prose.matchAll(name)].map((match) => match[1].toLowerCase()))];
}

/**
 * The dialect documents of a repository, relative to it, sorted.
 * @param {string} base
 * @returns {string[]}
 */
function dialectDocuments(base) {
  return markdownFiles(base).filter((file) => /^grammars\/dialects\/[^/]+\.md$/.test(file));
}

/**
 * The DOM of each grammar document, keyed by its path under grammars/:
 * those of grammars/compiled.json, which tools/sync.js writes.
 * @param {string} base
 * @returns {Map<string, {directives: {name: string, args: string[]}[]}>}
 */
function compiledDoms(base) {
  const compiled = JSON.parse(fs.readFileSync(path.join(base, "grammars", "compiled.json"), "utf8"));
  return new Map(Object.entries(compiled.documents).map(([file, { dom }]) => [file, dom]));
}

/**
 * The dialects that include each grammar document, at any depth, as their
 * pipelines' %include directives say, read from the documents' DOMs. A
 * dialect document belongs to its own dialect.
 * @param {string} [base] the repository
 * @param {Map<string, {directives: {name: string, args: string[]}[]}>} [doms]
 *   the DOMs by path under grammars/; grammars/compiled.json unless given
 * @returns {Map<string, string[]>} keyed by the path in the repository
 */
export function documentDialects(base = root, doms = compiledDoms(base)) {
  /** @type {Map<string, string[]>} */
  const dialects = new Map();
  for (const document of dialectDocuments(base)) {
    const dialect = path.posix.basename(document, ".md");
    /** @param {string} file the path under grammars/ */
    const visit = (file) => {
      const key = `grammars/${file}`;
      if (!dialects.has(key)) dialects.set(key, []);
      if (dialects.get(key).includes(dialect)) return;
      dialects.get(key).push(dialect);
      for (const directive of (doms.get(file) || { directives: [] }).directives) {
        if (directive.name === "include") visit(path.posix.normalize(path.posix.join(path.posix.dirname(file), directive.args[0])));
      }
    };
    visit(document.slice("grammars/".length));
  }
  return dialects;
}

/**
 * The checked documents, each with the checked dialects that include it.
 * @param {string} [base] the repository
 * @param {Map<string, {directives: {name: string, args: string[]}[]}>} [doms]
 * @param {string[]} [checked] the checked dialects
 * @returns {Map<string, string[]>}
 */
export function checkedDocuments(base = root, doms = compiledDoms(base), checked = CHECKED_DIALECTS) {
  const documents = new Map();
  for (const [document, dialects] of documentDialects(base, doms)) {
    const claimed = dialects.filter((dialect) => checked.includes(dialect));
    if (claimed.length) documents.set(document, claimed);
  }
  return new Map([...documents].sort(([a], [b]) => (a < b ? -1 : 1)));
}

/**
 * @typedef {object} AllowEntry
 * @property {string} text
 * @property {string} document the document whose quotes the entry covers
 * @property {number} line the entry's line in the allow-list
 * @property {string} [reason] why the text needs no case of its own
 * @property {{role: string, id: string}[]} [cases] the cases that show the
 *   text, each with its role: the rule of the node that spans the text in
 *   the case's tree, `words` for words that some stage gives in a row,
 *   or `reject` for a case that the dialect rejects
 */

/**
 * The allow-list. Each line that is not empty and does not begin with `#`
 * is an entry for one document: a quoted text, ` # `, the document, and
 * then either ` # ` and the reason why no case pins the text, or ` = ` and
 * the cases that show it. The cases are their ids, each after its role: a
 * rule name, `words` or `reject`. A role applies to the ids after it, up to the
 * next role.
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
      problems.push(`${at}: not a quoted text, " # ", a document, and " # " and a reason or " = " and roles and case ids`);
      return;
    }
    const key = `${match[2]}\0${text}`;
    if (keys.has(key)) problems.push(`${at}: \`${text}\` is listed twice for ${match[2]}`);
    keys.add(key);
    /** @type {AllowEntry} */
    const entry = { text, document: match[2], line: index + 1 };
    if (match[3]) entry.reason = match[3];
    else {
      entry.cases = [];
      let role = null;
      // An id has a full stop; a role, a rule name or `reject`, has none.
      for (const word of match[4].trim().split(/\s+/)) {
        if (!word.includes(".")) role = word;
        else if (!role) problems.push(`${at}: ${word} has no role before it`);
        else entry.cases.push({ role, id: word });
      }
      if (!entry.cases.length) problems.push(`${at}: no case after " = "`);
    }
    entries.push(entry);
  });
  return { entries, problems };
}

/**
 * Every corpus case of the repository.
 * @param {string} base
 * @returns {{id: string, text: string, dialect: string, expect: string, brackets?: string, words?: string[], features?: string[], withoutFeatures?: string[]}[]}
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

/** The words of a quoted text as the word stage labels them, with no full stop or comma around a word. @param {string} text */
const bare = (text) => text.split(" ").map((word) => word.replace(/^[.,]+|[.,]+$/g, "")).join(" ");

/**
 * Whether a case holds a quoted text as consecutive words: in its text, or
 * in the labels of its words. So the case of `fyno`, whose words are `fy`
 * and `no`, holds `fy no`.
 * @param {{text: string, words?: string[]}} c
 * @param {string} text
 * @returns {boolean}
 */
function holds(c, text) {
  return ` ${normal(c.text)} `.includes(` ${text} `) || ` ${(c.words || []).join(" ")} `.includes(` ${bare(text)} `);
}

/**
 * What a case shows of a quoted text in its role: whether its dialect
 * rejects it (`reject`), whether some stage gives the text's words in a row
 * (`words`), or whether the tree of some stage has a node of the rule whose
 * words are exactly the text's.
 * @param {{text: string, dialect: string, features?: string[], withoutFeatures?: string[]}} c
 * @param {string} role
 * @param {string} text
 * @param {Map<string, any>} dialects the loaded dialects, by name
 * @returns {boolean}
 */
function showsRole(c, role, text, dialects) {
  if (!dialects.has(c.dialect)) dialects.set(c.dialect, loadDialect(c.dialect));
  const result = dialects.get(c.dialect).parse(c.text, { features: c.features || [], withoutFeatures: c.withoutFeatures || [] });
  if (role === "reject") return !result.ok;
  if (role === "words") {
    // The words of the text, split at full stops and white space, in a row
    // in the output of some stage, whatever a later stage does with them.
    const split = (/** @type {string} */ words) => words.split(/[\s.,]+/).filter(Boolean).join(" ");
    const wanted = split(text);
    return result.stages.some((stage) => stage.output && ` ${split(stage.output.map((token) => token.label).join(" "))} `.includes(` ${wanted} `));
  }
  if (!result.ok) return false;
  const wanted = bare(text);
  for (const stage of result.stages) {
    if (!stage.tree) continue;
    /** @returns {string[]} the labels of the tokens under a node */
    const words = (node) => (node.kind === "token" ? [stage.input[node.token].label].filter((label) => label.trim()) : (node.children || []).flatMap(words));
    const stack = [stage.tree];
    while (stack.length) {
      const node = stack.pop();
      if (node.kind === "rule" && node.rule === role && words(node).join(" ") === wanted) return true;
      stack.push(...(node.children || []));
    }
  }
  return false;
}

/** How a case reads its text, to compare dialects: its verdict and tree. */
const reading = (c) => JSON.stringify([c.expect, c.brackets]);

/**
 * Every problem of the quoted texts of the checked documents:
 *
 * - a quoted text that lacks a case of a dialect of its document, or of a
 *   dialect that its scope names, and that the allow-list does not cover;
 * - a quoted text whose cases read it differently in the dialects that it
 *   needs, where its scope names none of those dialects;
 * - an allow-list entry that is not needed, since the document does not
 *   quote the text or cases pin it, and an entry whose cases are missing,
 *   do not hold the text, do not show it in their role, or leave out a
 *   dialect that the text needs;
 * - a grammar document that is neither checked nor in UNCHECKED, and one
 *   in UNCHECKED that is checked;
 * - a case that pins a quoted text and is not in tests/core.txt.
 * @param {string} [base] the repository
 * @param {{doms?: Map<string, any>, checked?: string[], unchecked?: Record<string, string>}} [scope]
 *   the DOMs of the grammar documents, the checked dialects and UNCHECKED
 * @returns {string[]}
 */
export function quotedTextProblems(base = root, { doms = compiledDoms(base), checked = CHECKED_DIALECTS, unchecked = UNCHECKED } = {}) {
  const all = corpusCases(base);
  /** @type {Map<string, typeof all>} the cases of each text */
  const casesOf = new Map();
  /** @type {Map<string, (typeof all)[number]>} */
  const byId = new Map();
  for (const c of all) {
    const text = normal(c.text);
    if (!casesOf.has(text)) casesOf.set(text, []);
    casesOf.get(text).push(c);
    byId.set(c.id, c);
  }
  const allowFile = path.join(base, "tests", "quoted-allow.txt");
  const { entries, problems } = readAllowList(fs.existsSync(allowFile) ? fs.readFileSync(allowFile, "utf8") : "");
  const allowed = new Map(entries.map((entry) => [`${entry.document}\0${entry.text}`, entry]));
  const used = new Set();
  const documents = checkedDocuments(base, doms, checked);
  const names = dialectNames(base);
  const files = new Set(markdownFiles(base));
  // Every grammar document is checked, or left out with a reason.
  for (const file of files) {
    if (!file.startsWith("grammars/")) continue;
    if (!documents.has(file) && !(file in unchecked)) problems.push(`${file}: no checked dialect includes this grammar document, and UNCHECKED in tools/quoted-texts.js gives no reason to leave it out`);
    if (documents.has(file) && file in unchecked) problems.push(`${file}: a checked dialect includes this document, so UNCHECKED in tools/quoted-texts.js does not need it`);
  }
  for (const file of Object.keys(unchecked)) if (!files.has(file)) problems.push(`${file}: UNCHECKED in tools/quoted-texts.js lists a document that the repository does not have`);
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
  /** @type {Map<string, any>} */
  const loaded = new Map();
  for (const [document, claimed] of documents) {
    if (!files.has(document)) continue;
    const markdown = fs.readFileSync(path.join(base, document), "utf8");
    // The quoted texts are read by the line of their block, which holds
    // only for the layout that the one-line check accepts.
    problems.push(...proseLineProblems(markdown, document));
    for (const { text, line, dialects } of quotedTexts(markdown, names)) {
      const at = `${document}:${line}`;
      const needed = [...new Set([...claimed, ...dialects])];
      const pins = (casesOf.get(text) || []).filter((c) => needed.includes(c.dialect));
      for (const c of pins) inCore(c.id, at);
      const disagree = (/** @type {Map<string, string>} */ readings) => {
        const differ = new Set(readings.values()).size > 1;
        if (differ && !needed.some((name) => readings.has(name) && dialects.includes(name))) {
          problems.push(`${at}: \`${text}\` reads differently in ${[...readings.keys()].join(" and ")}, and its line names none of them; say which dialect the sentence is about`);
        }
      };
      disagree(new Map(pins.map((c) => [c.dialect, reading(c)])));
      const missing = needed.filter((name) => !pins.some((c) => c.dialect === name));
      if (!missing.length) continue;
      const entry = allowed.get(`${document}\0${text}`);
      if (!entry) {
        problems.push(`${at}: \`${text}\` is pinned by no case of ${missing.join(" or of ")}; add one to tests/corpus/adhoc.jsonl, or list it in tests/quoted-allow.txt`);
        continue;
      }
      used.add(entry);
      if (!entry.cases) continue;
      // The entry's cases hold the text and show it in their roles, in
      // every dialect that it needs.
      /** @type {Map<string, string>} */
      const roles = new Map();
      for (const { role, id } of entry.cases) {
        const c = byId.get(id);
        const place = `tests/quoted-allow.txt:${entry.line}`;
        if (!c) problems.push(`${place}: no case has the id ${id}`);
        else if (role !== "words" && !holds(c, text)) problems.push(`${place}: neither the text nor the words of ${id} hold \`${text}\``);
        else if (!showsRole(c, role, text, loaded)) problems.push(`${place}: ${id} does not show \`${text}\` as ${role === "reject" ? "a rejected text" : `one ${role}`}`);
        else {
          roles.set(c.dialect, role);
          inCore(id, place);
        }
      }
      const uncovered = missing.filter((name) => !roles.has(name));
      if (uncovered.length) problems.push(`${at}: \`${text}\` is held by no listed case of ${uncovered.join(" or of ")} (tests/quoted-allow.txt:${entry.line})`);
      disagree(new Map([...roles].filter(([name]) => needed.includes(name))));
    }
  }
  for (const entry of entries) {
    if (!used.has(entry)) problems.push(`tests/quoted-allow.txt:${entry.line}: \`${entry.text}\` is not needed: ${entry.document} does not quote it unpinned`);
  }
  return problems;
}

/**
 * The places in the checked documents that each case pins, as
 * "DOCUMENT:LINE", keyed by the case's id: the lines that quote the case's
 * text, and those that quote the fragment of an allow-list entry that
 * names the case. The corpus runner names them when the case fails, since
 * the prose there may be false.
 * @param {string} [base] the repository
 * @param {Map<string, any>} [doms] the DOMs of the grammar documents
 * @returns {Map<string, string[]>}
 */
export function quotingPlaces(base = root, doms = compiledDoms(base)) {
  /** @type {Map<string, string[]>} the lines that quote each text, by document */
  const quoted = new Map();
  const names = dialectNames(base);
  for (const document of checkedDocuments(base, doms).keys()) {
    if (!fs.existsSync(path.join(base, document))) continue;
    for (const { text, line } of quotedTexts(fs.readFileSync(path.join(base, document), "utf8"), names)) {
      const key = `${document}\0${text}`;
      if (!quoted.has(key)) quoted.set(key, []);
      quoted.get(key).push(`${document}:${line}`);
    }
  }
  /** @type {Map<string, string[]>} */
  const places = new Map();
  const add = (/** @type {string} */ id, /** @type {string[]} */ lines) => {
    if (!lines.length) return;
    if (!places.has(id)) places.set(id, []);
    for (const place of lines) if (!places.get(id).includes(place)) places.get(id).push(place);
  };
  /** @type {Map<string, string[]>} the lines that quote each text, in any document */
  const byText = new Map();
  for (const [key, lines] of quoted) {
    const text = key.slice(key.indexOf("\0") + 1);
    byText.set(text, [...(byText.get(text) || []), ...lines]);
  }
  for (const c of corpusCases(base)) add(c.id, byText.get(normal(c.text)) || []);
  const allowFile = path.join(base, "tests", "quoted-allow.txt");
  for (const entry of readAllowList(fs.existsSync(allowFile) ? fs.readFileSync(allowFile, "utf8") : "").entries) {
    for (const { id } of entry.cases || []) add(id, quoted.get(`${entry.document}\0${entry.text}`) || []);
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
