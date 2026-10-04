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
import { markdownFiles } from "./documents.js";
import { sourceDoms, sourceLoader } from "./grammar-sources.js";
import { parseMarkdown, walk } from "./markdown.js";
import { PROSE, proseLineProblems } from "./prose-lines.js";
import { resolvePath } from "../lib/js/src/markdown.js";
import { countWork, hooks } from "../lib/js/src/testing.js";

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
 * The reasons that the check leaves out the dialect documents of the
 * dialects that it does not check, and any grammar document that no
 * dialect includes. A document that only unchecked dialects include needs
 * no entry: its reason is derived (uncheckedReasons). A grammar document
 * that is neither checked nor left out with a reason is an error, so that a
 * new document is not left out in silence.
 * @type {Record<string, string>}
 */
export const UNCHECKED = {
  "grammars/dialects/experimental.md": "the experimental dialect: its texts are not pinned yet",
  "grammars/dialects/zantufa.md": "the Zantufa dialect: its texts are not pinned yet",
  "grammars/dialects/notation.md": "the notation dialect reads jbogenbau, not Lojban",
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
 * it. The scope of a text is the list item that holds it, without the
 * lists nested in it, together with each item that encloses that item,
 * again without its nested lists. Outside a list item it is its block. So
 * a blank line inside a list item changes nothing, a name in a nested item
 * does not scope its parent, and a name in a parent scopes its nested
 * items.
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
    const items = ancestors.filter((ancestor) => ancestor.type === "listItem");
    const scope = items[items.length - 1] || [...ancestors].reverse().find((ancestor) => PROSE.has(ancestor.type));
    if (scope && !named.has(scope)) {
      // An item's own prose leaves out the lists nested in it, at any
      // depth: inside a block quote too. An enclosing item's own prose
      // scopes the item.
      named.set(scope, namedDialects(items.length ? items.map((item) => proseOf(item, { lists: false })).join(" ") : proseOf(scope), dialects));
    }
    texts.push({ text, line: node.position.start.line, dialects: scope ? named.get(scope) : [] });
  }
  return texts;
}

/**
 * The prose of a block: its text, the text of its links included, with
 * each code span as a space and a space between paragraphs. So neither a
 * code span nor a link target names a dialect. With `lists: false`, the
 * prose leaves out every list inside the block, whatever containers lie
 * between, so that it is a list item's own prose.
 * @param {import("./markdown.js").Node} block
 * @param {{lists?: boolean}} [options]
 * @returns {string}
 */
export function proseOf(block, { lists = true } = {}) {
  let prose = "";
  /** @param {any} node */
  const visit = (node) => {
    if (node.type === "text") prose += node.value;
    else if (node.type === "inlineCode" || PROSE.has(node.type)) prose += " ";
    for (const child of node.children || []) if (lists || child.type !== "list") visit(child);
  };
  visit(block);
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
 * The DOMs of the grammar documents of a repository, read from its source
 * documents (tools/grammar-sources.js), never from the generated
 * grammars/compiled.json or a bundled copy.
 * @param {string} base
 * @returns {{get: (file: string) => any}}
 */
function repositoryDoms(base) {
  return sourceDoms(base, sourceLoader(base));
}

/**
 * The dialects that include each grammar document, at any depth, as their
 * pipelines' %include directives say, read from the DOMs of the source
 * documents. A dialect document belongs to its own dialect.
 * @param {string} [base] the repository
 * @param {{get: (file: string) => any}} [doms]
 *   the DOMs by path under grammars/; those of the source documents unless
 *   given
 * @returns {Map<string, string[]>} keyed by the path in the repository
 */
export function documentDialects(base = root, doms = repositoryDoms(base)) {
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
        // The path as the pipeline resolves it (lib/js/src/pipeline.js), so
        // a `..` above the grammars drops out there as here.
        if (directive.name === "include") visit(resolvePath(file, directive.args[0]));
      }
    };
    visit(document.slice("grammars/".length));
  }
  return dialects;
}

/**
 * The checked documents, each with the checked dialects that include it.
 * @param {string} [base] the repository
 * @param {{get: (file: string) => any}} [doms]
 * @param {string[]} [checked] the checked dialects
 * @returns {Map<string, string[]>}
 */
export function checkedDocuments(base = root, doms = repositoryDoms(base), checked = CHECKED_DIALECTS) {
  const documents = new Map();
  for (const [document, dialects] of documentDialects(base, doms)) {
    const claimed = dialects.filter((dialect) => checked.includes(dialect));
    if (claimed.length) documents.set(document, claimed);
  }
  return new Map([...documents].sort(([a], [b]) => (a < b ? -1 : 1)));
}

/**
 * Why the check leaves out each grammar document of a repository that no
 * checked dialect includes. A dialect document, or a document that no
 * dialect includes, has the reason that `unchecked` gives it, if any. Any
 * other has the dialects that include it, read from the pipelines, so the
 * reason cannot go stale.
 * @param {string} [base] the repository
 * @param {{get: (file: string) => any}} [doms]
 * @param {string[]} [checked] the checked dialects
 * @param {Record<string, string>} [unchecked] the reasons given by hand
 * @returns {Map<string, string>} keyed by the path in the repository
 */
export function uncheckedReasons(base = root, doms = repositoryDoms(base), checked = CHECKED_DIALECTS, unchecked = UNCHECKED) {
  const including = documentDialects(base, doms);
  const dialectFiles = new Set(dialectDocuments(base));
  const reasons = new Map();
  for (const file of markdownFiles(base)) {
    if (!file.startsWith("grammars/")) continue;
    const dialects = including.get(file) || [];
    if (dialects.some((dialect) => checked.includes(dialect))) continue;
    if (dialectFiles.has(file) || !dialects.length) {
      if (file in unchecked) reasons.set(file, unchecked[file]);
    } else {
      const names = [...dialects].sort();
      reasons.set(file, `included only by the ${names.join(" and ")} dialect${names.length > 1 ? "s" : ""}`);
    }
  }
  return reasons;
}

/**
 * @typedef {object} AllowEntry
 * @property {string} text
 * @property {string} document the document whose quotes the entry covers
 * @property {number[]} [lines] the lines of the document that the entry
 *   covers, when it names them; else every line that quotes the text
 * @property {number} line the entry's line in the allow-list
 * @property {string} [reason] why the text needs no case of its own
 * @property {{role: string, id: string}[]} [cases] the cases that show the
 *   text, each with its role: the rule of the node that spans the text in
 *   the case's tree, `words` for words that some stage gives as the
 *   labels of tokens in a row (roleProblem), or `reject` for a case that the
 *   dialect rejects
 */

/**
 * The allow-list. Each line that is not empty and does not begin with `#`
 * is an entry for one document: a quoted text, ` # `, the document, with
 * `:` and its lines, separated by commas, where the entry names them, and
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
    const match = /^(.*?)\s+#\s+([^\s:]+)(?::(\d+(?:,\d+)*))?\s+(?:#\s+(\S.*)|=\s+(\S.*))$/.exec(line);
    const text = match && quotedText(match[1]);
    if (!text) {
      problems.push(`${at}: not a quoted text, " # ", a document with its lines or none, and " # " and a reason or " = " and roles and case ids`);
      return;
    }
    const document = match[2];
    const lines = match[3] ? match[3].split(",").map(Number) : null;
    // An entry with no lines stands for all of them, and is counted once.
    for (const place of lines ? lines.map((number) => `${document}:${number}`) : [document]) {
      const key = `${place}\0${text}`;
      if (keys.has(key)) problems.push(`${at}: \`${text}\` is listed twice for ${place}`);
      keys.add(key);
    }
    /** @type {AllowEntry} */
    const entry = { text, document, line: index + 1 };
    if (lines) entry.lines = lines;
    if (match[4]) entry.reason = match[4];
    else {
      entry.cases = [];
      let role = null;
      let ids = 0;
      // An id has a full stop; a role, a rule name or `reject`, has none.
      // A role with no id after it covers nothing: often it is an id
      // mistyped without its full stop.
      const idless = () => role !== null && !ids && problems.push(`${at}: the role ${role} has no case id after it`);
      for (const word of match[5].trim().split(/\s+/)) {
        if (!word.includes(".")) {
          idless();
          role = word;
          ids = 0;
        } else if (!role) problems.push(`${at}: ${word} has no role before it`);
        else {
          entry.cases.push({ role, id: word });
          ids++;
        }
      }
      idless();
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
 * The words of a quoted text as the labels of the tokens that show it, one
 * label for each word: the word without the full stops and commas at its
 * edges, with each full stop inside it as a space. So `la djim.bu` is the
 * two labels `la` and `djim bu`, since a pause inside a word is a space in
 * its label (tests/README.md).
 * @param {string} text
 * @returns {string[]}
 */
export function wordLabels(text) {
  return text.split(" ").map((word) => {
    // The stops and commas at either end trimmed by a loop: /[.,]+$/ tries
    // each of a long inner run of them in turn.
    const stop = (/** @type {string} */ c) => c === "." || c === ",";
    let start = 0;
    let end = word.length;
    while (start < end && stop(word[start])) start++;
    while (end > start && stop(word[end - 1])) end--;
    if (hooks.work) countWork(hooks.work, "text", 1 + start + word.length - end);
    return word.slice(start, end).replace(/\./g, " ");
  });
}

/**
 * Where a list of strings holds another as a run, each start in order, by
 * Knuth, Morris and Pratt: a comparison of the run at every start would
 * cost the two lengths multiplied.
 * @param {string[]} haystack
 * @param {string[]} needle
 * @returns {number[]}
 */
export function runStarts(haystack, needle) {
  /** @type {number[]} */
  const starts = [];
  if (needle.length === 0) {
    for (let start = 0; start <= haystack.length; start++) starts.push(start);
    return starts;
  }
  // For each prefix of the needle, the length of its longest proper prefix
  // that is also its suffix.
  const border = [0];
  for (let index = 1, length = 0; index < needle.length; index++) {
    if (hooks.work) countWork(hooks.work, "text");
    while (length > 0 && needle[index] !== needle[length]) length = border[length - 1];
    if (needle[index] === needle[length]) length++;
    border.push(length);
  }
  for (let index = 0, matched = 0; index < haystack.length; index++) {
    if (hooks.work) countWork(hooks.work, "text");
    while (matched > 0 && haystack[index] !== needle[matched]) {
      if (hooks.work) countWork(hooks.work, "text");
      matched = border[matched - 1];
    }
    if (haystack[index] === needle[matched]) matched++;
    if (matched === needle.length) {
      starts.push(index + 1 - needle.length);
      matched = border[matched - 1];
    }
  }
  return starts;
}

/**
 * Where a quoted text may stop a rejection of a case: each place where the
 * case's text holds its words, from the start of the first word to the end
 * of the word after the last, or to the end of the text. Positions are in
 * code points, as `at` is.
 * @param {string} caseText
 * @param {string} text
 * @returns {[number, number][]}
 */
export function rejectionWindows(caseText, text) {
  const points = Array.from(caseText);
  if (hooks.work) countWork(hooks.work, "text", points.length);
  /** @type {{start: number, end: number}[]} the words of the case's text */
  const words = [];
  points.forEach((point, index) => {
    if (/\s/u.test(point)) return;
    if (index && !/\s/u.test(points[index - 1])) words[words.length - 1].end = index + 1;
    else words.push({ start: index, end: index + 1 });
  });
  const wanted = text.split(" ");
  /** @type {[number, number][]} */
  const windows = [];
  const spelled = words.map((word) => points.slice(word.start, word.end).join(""));
  for (const first of runStarts(spelled, wanted)) {
    const after = words[first + wanted.length];
    windows.push([words[first].start, after ? after.end : points.length]);
  }
  return windows;
}

/**
 * Why a case does not show a quoted text in its role, or null when it does.
 *
 * - `reject`: the dialect rejects the case, and both the stored `at` and the
 *   start of the parsed error's source fall where the case's text holds the
 *   quoted text, or within the word after it (rejectionWindows).
 * - `words`: some stage gives the text's words as the labels of tokens in a
 *   row, one label for each word (wordLabels), and those tokens, with their
 *   attachments, stand together in the case's text: nothing between them
 *   holds a letter. So the case holds the text, read as those tokens.
 * - a rule: the tree of some stage has a node of the rule whose words are
 *   exactly the text's.
 * @param {{text: string, dialect: string, at?: number, features?: string[], withoutFeatures?: string[]}} c
 * @param {string} role
 * @param {string} text
 * @param {Map<string, any>} dialects the loaded dialects, by name
 * @param {any} loader the loader of the repository's source grammars
 *   (tools/grammar-sources.js), never the bundled copies
 * @returns {string | null}
 */
export function roleProblem(c, role, text, dialects, loader) {
  if (!dialects.has(c.dialect)) dialects.set(c.dialect, loader.dialect(`dialects/${c.dialect}.md`));
  const result = dialects.get(c.dialect).parse(c.text, { features: c.features || [], withoutFeatures: c.withoutFeatures || [] });
  if (role === "reject") {
    if (result.ok) return `its dialect accepts it`;
    const windows = rejectionWindows(c.text, text);
    const within = (/** @type {number | undefined} */ at) => typeof at === "number" && windows.some(([start, end]) => start <= at && at <= end);
    const source = result.error && result.error.source ? result.error.source[0] : undefined;
    if (!within(c.at)) return `its \`at\` ${c.at === undefined ? "is missing" : `is ${c.at}`}, outside the text and the word after it`;
    if (!within(source)) return `its rejection stops at ${source === undefined ? "no position" : source}, outside the text and the word after it`;
    return null;
  }
  if (role === "words") {
    const wanted = wordLabels(text);
    const points = Array.from(c.text);
    let apart = false;
    for (const stage of result.stages) {
      if (!stage.output) continue;
      // A pause token has a label of white space, and stands for no word.
      const tokens = stage.output.filter((/** @type {any} */ token) => token.label.trim());
      for (const first of runStarts(tokens.map((/** @type {any} */ token) => token.label), wanted)) {
        if (together(points, tokens.slice(first, first + wanted.length))) return null;
        apart = true;
      }
    }
    return apart ? "its stages give those words in a row only with other words of its text between them" : "no stage gives those words as tokens in a row, one label for each word";
  }
  if (!result.ok) return "its dialect rejects it";
  const wanted = bare(text);
  for (const stage of result.stages) {
    if (stage.tree && hasNodeWithWords(stage.tree, stage.input, role, wanted)) return null;
  }
  return `no tree has a node of ${role} whose words are exactly the text's`;
}

/**
 * Whether a tree has a node of a rule whose words, the labels of the
 * tokens under it that are not white space, joined by spaces, are a text.
 * One walk gives each node its range of words. A node's words are compared
 * only where their joined length is the text's, once for each range, since
 * gathering them for each node would cost a chain of nodes the square of
 * its length.
 * @param {any} tree
 * @param {{label: string}[]} input the stage's input tokens
 * @param {string} role
 * @param {string} wanted
 * @returns {boolean}
 */
export function hasNodeWithWords(tree, input, role, wanted) {
  /** @type {string[]} */
  const labels = [];
  // The joined length of the words before each word, spaces included.
  const before = [0];
  /** @type {any[]} the nodes of the rule, each with its range of words */
  const found = [];
  /** @type {{node: any, exit: boolean, start: number}[]} */
  const stack = [{ node: tree, exit: false, start: 0 }];
  for (let top = stack.pop(); top !== undefined; top = stack.pop()) {
    if (hooks.work) countWork(hooks.work, "walkSteps");
    const { node } = top;
    if (top.exit) {
      if (node.kind === "rule" && node.rule === role) found.push([top.start, labels.length]);
      continue;
    }
    if (node.kind === "token") {
      const label = input[node.token].label;
      if (label.trim()) {
        labels.push(label);
        before.push(before[before.length - 1] + [...label].length + 1);
      }
      continue;
    }
    stack.push({ node, exit: true, start: labels.length });
    const children = node.children || [];
    for (let index = children.length - 1; index >= 0; index--) stack.push({ node: children[index], exit: false, start: 0 });
  }
  const length = [...wanted].length;
  /** @type {Set<string>} */
  const compared = new Set();
  for (const [start, end] of found) {
    const joined = end > start ? before[end] - before[start] - 1 : 0;
    if (joined !== length) continue;
    const key = `${start} ${end}`;
    if (compared.has(key)) continue;
    compared.add(key);
    if (hooks.work) countWork(hooks.work, "text", end - start);
    if (labels.slice(start, end).join(" ") === wanted) return true;
  }
  return false;
}

/**
 * Whether tokens, with their attachments, stand together in a text: no
 * letter lies between them that none of them covers.
 * @param {string[]} points the case's text, as code points, split once for
 *   every run tested
 * @param {any[]} tokens
 * @returns {boolean}
 */
function together(points, tokens) {
  const covered = new Set();
  const cover = (/** @type {any} */ token) => {
    if (token.source) for (let index = token.source[0]; index < token.source[1]; index++) covered.add(index);
    for (const attached of [...(token.before || []), ...(token.after || [])]) cover(attached);
  };
  tokens.forEach(cover);
  let start = Infinity;
  let end = -Infinity;
  for (const index of covered) {
    start = Math.min(start, index);
    end = Math.max(end, index);
  }
  for (let index = start; index <= end; index++) if (!covered.has(index) && /\p{L}/u.test(points[index])) return false;
  return true;
}

/**
 * Whether a case shows a quoted text in its role (roleProblem).
 * @param {{text: string, dialect: string, at?: number, features?: string[], withoutFeatures?: string[]}} c
 * @param {string} role
 * @param {string} text
 * @param {Map<string, any>} dialects
 * @param {any} loader
 * @returns {boolean}
 */
export function showsRole(c, role, text, dialects, loader) {
  return roleProblem(c, role, text, dialects, loader) === null;
}

/** How a case reads its text, to compare dialects: its verdict and tree. */
const reading = (c) => JSON.stringify([c.expect, c.brackets]);

/**
 * Every problem of the quoted texts of the checked documents:
 *
 * - a quoted text that lacks a case of a dialect of its document, or of a
 *   dialect that its scope names, and that the allow-list does not cover;
 * - a quoted text whose cases read it differently in two needed dialects
 *   that its scope does not name, comparing the cases of the whole text
 *   and the cases of its entry apart;
 * - an allow-list entry that is not needed, since the document does not
 *   quote the text, or cases pin it and the entry gives a reason; an entry
 *   that names no lines and covers several, or names a line that does not
 *   need it; and an entry whose cases are missing, do not hold the text, do
 *   not show it in their role, or leave out a dialect that the text needs;
 * - a grammar document that is neither checked nor left out with a reason
 *   (uncheckedReasons), and one in UNCHECKED that is checked or whose
 *   reason is derived;
 * - a case that pins a quoted text and is not in tests/core.txt.
 * @param {string} [base] the repository
 * @param {{loader?: any, doms?: {get: (file: string) => any}, checked?: string[], unchecked?: Record<string, string>}} [scope]
 *   the loader of the repository's source grammars, which parses the cases
 *   of `=` entries, the DOMs of its grammar documents, the checked dialects
 *   and UNCHECKED
 * @returns {string[]}
 */
export function quotedTextProblems(base = root, { loader, doms, checked = CHECKED_DIALECTS, unchecked = UNCHECKED } = {}) {
  // The loader of the sources, made when first needed.
  const sources = { readDocument: (/** @type {string} */ markdown, /** @type {string} */ file) => sourcesLoader().readDocument(markdown, file) };
  const sourcesLoader = () => (loader ??= sourceLoader(base));
  doms ??= sourceDoms(base, /** @type {any} */ (sources));
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
  // The entries by document and text, so that finding one does not scan
  // the whole list for each quoted text.
  /** @type {Map<string, AllowEntry[]>} */
  const entriesOf = new Map();
  for (const entry of entries) {
    const key = `${entry.document}\0${entry.text}`;
    const list = entriesOf.get(key);
    if (list) list.push(entry);
    else entriesOf.set(key, [entry]);
  }
  /** The entry that covers a text on a line: one that names the line, or else one that names no line. */
  const entryAt = (/** @type {string} */ document, /** @type {string} */ text, /** @type {number} */ line) => {
    const candidates = entriesOf.get(`${document}\0${text}`) || [];
    return candidates.find((entry) => entry.lines && entry.lines.includes(line)) || candidates.find((entry) => !entry.lines);
  };
  /** @type {Map<AllowEntry, Set<number>>} the lines on which each entry is needed */
  const used = new Map();
  const documents = checkedDocuments(base, doms, checked);
  const names = dialectNames(base);
  const files = new Set(markdownFiles(base));
  const reasons = uncheckedReasons(base, doms, checked, unchecked);
  // Every grammar document is checked, or left out with a reason.
  for (const file of files) {
    if (!file.startsWith("grammars/")) continue;
    if (!documents.has(file) && !reasons.has(file)) problems.push(`${file}: no checked dialect includes this grammar document, and UNCHECKED in tools/quoted-texts.js gives no reason to leave it out`);
    if (documents.has(file) && file in unchecked) problems.push(`${file}: a checked dialect includes this document, so UNCHECKED in tools/quoted-texts.js does not need it`);
    else if (file in unchecked && reasons.get(file) !== unchecked[file]) problems.push(`${file}: ${reasons.get(file)}, which is its reason, so UNCHECKED in tools/quoted-texts.js does not need it`);
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
  /** @type {Map<string, string | null>} the problem of each case of an entry in its role, once judged */
  const judged = new Map();
  for (const [document, claimed] of documents) {
    if (!files.has(document)) continue;
    const markdown = fs.readFileSync(path.join(base, document), "utf8");
    // The quoted texts are read by the line of their block, which holds
    // only for the layout that the one-line check accepts.
    for (const problem of proseLineProblems(markdown, document)) problems.push(problem);
    for (const { text, line, dialects } of quotedTexts(markdown, names)) {
      const at = `${document}:${line}`;
      const needed = [...new Set([...claimed, ...dialects])];
      const pins = (casesOf.get(text) || []).filter((c) => needed.includes(c.dialect));
      for (const c of pins) inCore(c.id, at);
      // One reading for each needed dialect, from its pins and from the
      // cases of an entry apart, since the two read a text in different
      // terms. The dialects that the scope does not name read the text
      // alike: the sentence speaks for them all.
      const disagree = (/** @type {Map<string, string>} */ readings) => {
        const unnamed = [...readings].filter(([name]) => !dialects.includes(name));
        if (new Set(unnamed.map(([, value]) => value)).size > 1) {
          const names = unnamed.map(([name]) => name).join(" and ");
          problems.push(`${at}: \`${text}\` reads differently in ${names}, and its line names ${dialects.length ? `only ${dialects.join(" and ")}` : "no dialect"}; say which dialect the sentence is about`);
        }
      };
      /** @type {Map<string, string>} */
      const pinned = new Map();
      for (const c of pins) if (!pinned.has(c.dialect)) pinned.set(c.dialect, reading(c));
      disagree(pinned);
      const missing = needed.filter((name) => !pinned.has(name));
      const entry = entryAt(document, text, line);
      // A reason stands in for missing pins. The cases of a `=` entry show
      // the claim about the fragment, which a pin of the same words as a
      // whole text does not, so they are checked in every needed dialect.
      if (!entry || (entry.reason && !missing.length)) {
        if (missing.length) problems.push(`${at}: \`${text}\` is pinned by no case of ${missing.join(" or of ")}; add one to tests/corpus/adhoc.jsonl, or list it in tests/quoted-allow.txt`);
        continue;
      }
      if (!used.has(entry)) used.set(entry, new Set());
      if (used.get(entry).has(line)) continue;
      used.get(entry).add(line);
      if (!entry.cases) continue;
      // The entry's cases hold the text and show it in their roles, in
      // every dialect that it needs.
      /** @type {Map<string, string>} */
      const roles = new Map();
      for (const { role, id } of entry.cases) {
        const c = byId.get(id);
        const place = `tests/quoted-allow.txt:${entry.line}`;
        // An entry that covers several lines reports a case once.
        const key = `${entry.line}\0${role}\0${id}`;
        if (!judged.has(key)) {
          let problem = null;
          if (!c) problem = `${place}: no case has the id ${id}`;
          else if (role !== "words" && !holds(c, text)) problem = `${place}: neither the text nor the words of ${id} hold \`${text}\``;
          else {
            const why = roleProblem(c, role, text, loaded, sourcesLoader());
            if (why) problem = `${place}: ${id} does not show \`${text}\` as ${role === "reject" ? "a rejected text" : role === "words" ? "words" : `one ${role}`}: ${why}`;
          }
          judged.set(key, problem);
          if (problem) problems.push(problem);
          else inCore(id, place);
        }
        if (!judged.get(key) && !roles.has(c.dialect)) roles.set(c.dialect, JSON.stringify([c.expect, role]));
      }
      const uncovered = needed.filter((name) => !roles.has(name));
      if (uncovered.length) problems.push(`${at}: \`${text}\` is held by no listed case of ${uncovered.join(" or of ")} (tests/quoted-allow.txt:${entry.line})`);
      disagree(new Map([...roles].filter(([name]) => needed.includes(name))));
    }
  }
  for (const entry of entries) {
    const lines = [...(used.get(entry) || [])].sort((a, b) => a - b);
    const place = `tests/quoted-allow.txt:${entry.line}`;
    if (!lines.length) problems.push(`${place}: \`${entry.text}\` is not needed: ${entry.document} does not quote it unpinned${entry.lines ? ` on ${entry.lines.join(", ")}` : ""}`);
    else if (entry.lines) {
      const needless = entry.lines.filter((line) => !lines.includes(line));
      if (needless.length) problems.push(`${place}: \`${entry.text}\` is not needed on ${entry.document}:${needless.join(",")}, which does not quote it unpinned`);
    } else if (lines.length > 1) {
      // A sentence on each line makes its own claim, so the entry says
      // which lines it covers.
      problems.push(`${place}: \`${entry.text}\` is quoted unpinned on lines ${lines.join(", ")} of ${entry.document}; name the lines that the entry covers, as ${entry.document}:${lines.join(",")}`);
    }
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
 * @param {{get: (file: string) => any}} [doms] the DOMs of the grammar documents
 * @returns {Map<string, string[]>}
 */
export function quotingPlaces(base = root, doms = repositoryDoms(base)) {
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
  // The places of each case as a set too, for a check that costs one
  // lookup rather than a scan of the list.
  /** @type {Map<string, Set<string>>} */
  const placeSets = new Map();
  const add = (/** @type {string} */ id, /** @type {string[]} */ lines) => {
    if (!lines.length) return;
    if (!places.has(id)) {
      places.set(id, []);
      placeSets.set(id, new Set());
    }
    const list = /** @type {string[]} */ (places.get(id));
    const set = /** @type {Set<string>} */ (placeSets.get(id));
    for (const place of lines) {
      if (set.has(place)) continue;
      set.add(place);
      list.push(place);
    }
  };
  /** @type {Map<string, string[]>} the lines that quote each text, in any document */
  const byText = new Map();
  for (const [key, lines] of quoted) {
    const text = key.slice(key.indexOf("\0") + 1);
    const list = byText.get(text);
    if (list) for (const place of lines) list.push(place);
    else byText.set(text, [...lines]);
  }
  for (const c of corpusCases(base)) add(c.id, byText.get(normal(c.text)) || []);
  const allowFile = path.join(base, "tests", "quoted-allow.txt");
  for (const entry of readAllowList(fs.existsSync(allowFile) ? fs.readFileSync(allowFile, "utf8") : "").entries) {
    const lines = (quoted.get(`${entry.document}\0${entry.text}`) || []).filter((place) => !entry.lines || entry.lines.includes(Number(place.slice(place.lastIndexOf(":") + 1))));
    for (const { id } of entry.cases || []) add(id, lines);
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
