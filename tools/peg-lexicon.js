#!/usr/bin/env node
// Writes the classifier of a lexicon document from the selma'o lists of a
// PEG grammar of Lojban, such as camxes-exp.peg. Each list is a rule of the
// form `NAME <- &cmavo ( w o r d / ... ) &post_word`, whose letters spell the
// words, `h` being the apostrophe. The tool replaces the classifier and its
// indicator implication, keeping the surrounding prose and other blocks.
// Usage: node tools/peg-lexicon.js PEG LEXICON.md [CLASS,...] [--add CLASS=WORD]...
// The optional list names the classes that the lexicon's implication marks
// as indicators. An empty list writes no implication. The blocks are those
// that the Markdown parser of tools/markdown.js finds at the top level, so
// run npm ci in lib/js first.
import fs from "node:fs";
import { parseMarkdown } from "./markdown.js";

const [pegPath, documentPath, ...options] = process.argv.slice(2);
function fail(message) {
  console.error(message);
  process.exit(2);
}
if (!pegPath || !documentPath) {
  fail("usage: node tools/peg-lexicon.js PEG LEXICON.md [CLASS,...] [--add CLASS=WORD]...");
}
let indicatorList;
const additions = [];
for (let i = 0; i < options.length; ++i) {
  if (options[i] === "--add") {
    const match = /^([A-Z](?:[A-Za-z]*[A-Z])?)=([a-z']+)$/.exec(options[++i] ?? "");
    if (!match) fail("--add needs CLASS=WORD, with a class name and a lowercase word");
    additions.push([match[1], match[2]]);
  } else if (!options[i].startsWith("--") && indicatorList === undefined) {
    indicatorList = options[i];
  } else {
    fail(`unknown argument: ${options[i]}`);
  }
}

// These classes attach to the word before them, so the lexicon's
// implication marks them as indicators for the indicator stage. By default
// they are camxes-exp's word classes: its `indicator` rule takes UI, CAI,
// DAhO and FUhO, and its `indicators` rule takes FUhE before them.
// The forms stage reads a run of y as hesitation, so Y is omitted here.
// Its `indicator` rule also takes a bare NAI, which the
// experimental word forms (grammars/words/experimental.md) mark apart.
const INDICATORS = indicatorList !== undefined ? indicatorList.split(",").filter(Boolean) : ["UI", "CAI", "DAhO", "FUhE", "FUhO"];

// The longest line of keys, so that the Markdown stays readable; a class
// with more keys takes one entry on each line.
const WIDTH = 100;

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const classes = new Map();
const peg = fs.readFileSync(pegPath, "utf8");
const words = new Set();
for (const match of peg.matchAll(/^([A-Z][A-Za-z]*) <- &cmavo \(\s*(.*?)\s*\)\s*&post_word/gm)) {
  // A Y list containing only y+ cannot classify a word in these forms.
  // A mixed list retains its y key, as Zantufa requires.
  if (match[1] === "Y" && match[2].trim() === "y+") continue;
  for (const alternative of match[2].split("/")) {
    const letters = alternative.trim().split(/\s+/);
    // A retained `y+` alternative lists the canonical one-letter key.
    const spelled = letters.map((letter) => (letter === "y+" ? "y" : letter));
    if (!spelled.every((letter) => /^[a-z]$/.test(letter))) continue;
    // A key is the canonical sound, with `'` for `h`.
    const word = spelled.map((letter) => (letter === "h" ? "'" : letter)).join("");
    words.add(word);
    if (!classes.has(match[1])) classes.set(match[1], new Set());
    classes.get(match[1]).add(word);
  }
}

for (const [name, word] of additions) {
  for (const [other, keys] of classes) {
    if (other !== name && keys.has(word)) fail(`${word} already belongs to ${other}, not ${name}`);
  }
  if (!classes.has(name)) classes.set(name, new Set());
  classes.get(name).add(word);
  words.add(word);
}

// One entry for each line of a class's keys, the classes and their keys in
// code point order.
const entries = [];
for (const name of [...classes.keys()].sort(compare)) {
  const keys = [...classes.get(name)].sort(compare).map((word) => `"${word}"`);
  const suffix = ` ∈ ${name}`;
  let line = [];
  for (const key of keys) {
    if (line.length && `  ${[...line, key].join(" ")}${suffix}`.length > WIDTH) {
      entries.push(`  ${line.join(" ")}${suffix}`);
      line = [];
    }
    line.push(key);
  }
  entries.push(`  ${line.join(" ")}${suffix}`);
}

const classifier = "```jbogenbau\n%classifier lexicon\n" + entries.join("\n") + "\n```";
const indicators = INDICATORS.filter((name) => classes.has(name));
const implication = indicators.length ? "```jbogenbau\n%implies " + indicators.join(" ∪ ") + " ⟹ Indicator\n```" : "";

const document = fs.readFileSync(documentPath, "utf8");
const blocks = parseMarkdown(document).children.filter((node) => node.type === "code" && node.lang === "jbogenbau");
const classifiers = blocks.filter((node) => /^%classifier lexicon\b/.test(node.value.trim()));
const implications = blocks.filter((node) => /^%implies [^\n]+ ⟹ Indicator$/.test(node.value.trim()));
if (classifiers.length > 1 || implications.length > 1) fail("more than one generated classifier or indicator implication");
const edits = [];
const replace = (node, text) => edits.push({
  start: node.position.start.offset - (node.position.start.column - 1),
  end: node.position.end.offset,
  text,
});
if (classifiers.length) {
  replace(classifiers[0], classifier + (!implications.length && implication ? "\n\n" + implication : ""));
} else {
  edits.push({ start: document.length, end: document.length, text: "\n\n" + classifier + (!implications.length && implication ? "\n\n" + implication : "") + "\n" });
}
if (implications.length) replace(implications[0], implication);
let rewritten = document;
for (const edit of edits.sort((a, b) => b.start - a.start)) {
  rewritten = rewritten.slice(0, edit.start) + edit.text + rewritten.slice(edit.end);
}
fs.writeFileSync(documentPath, rewritten);
console.log(`${words.size} words in ${classes.size} classes`);
