#!/usr/bin/env node
// Writes the classifier of a lexicon document from the selma'o lists of a
// PEG grammar of Lojban, such as camxes-exp.peg. Each list is a rule of the
// form `NAME <- &cmavo ( w o r d / ... ) &post_word`, whose letters spell the
// words, `h` being the apostrophe. The tool keeps the prose of the document
// before its first `jbogenbau` block and replaces every block after it.
// Usage: node tools/peg-lexicon.js PEG LEXICON.md [CLASS,...]
// The optional list names the classes that the lexicon's implication marks
// as indicators. An empty list writes no implication. The blocks are those
// that the Markdown parser of tools/markdown.js finds at the top level.
import fs from "node:fs";
import { parseMarkdown } from "./markdown.js";

const [pegPath, documentPath, indicatorList] = process.argv.slice(2);
if (!pegPath || !documentPath) {
  console.error("usage: node tools/peg-lexicon.js PEG LEXICON.md [CLASS,...]");
  process.exit(2);
}

// These classes attach to the word before them, so the lexicon's
// implication marks them as indicators for the indicator stage. By default
// they are camxes-exp's word classes: its `indicator` rule takes UI, CAI,
// DAhO and FUhO, its `indicators` rule takes FUhE before them, and Y is part
// of its spaces. Its `indicator` rule also takes a bare NAI, which the
// experimental word forms (grammars/words/experimental.md) mark apart.
const INDICATORS = indicatorList !== undefined ? indicatorList.split(",").filter(Boolean) : ["UI", "CAI", "Y", "DAhO", "FUhE", "FUhO"];

// The longest line of keys, so that the Markdown stays readable; a class
// with more keys takes one entry on each line.
const WIDTH = 100;

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const classes = new Map();
const peg = fs.readFileSync(pegPath, "utf8");
const words = new Set();
for (const match of peg.matchAll(/^([A-Z][A-Za-z]*) <- &cmavo \(\s*(.*?)\s*\)\s*&post_word/gm)) {
  for (const alternative of match[2].split("/")) {
    const letters = alternative.trim().split(/\s+/);
    // `y+` is a run of y, which the word stage reads as hesitation; the
    // lexicon lists the one letter.
    const spelled = letters.map((letter) => (letter === "y+" ? "y" : letter));
    if (!spelled.every((letter) => /^[a-z]$/.test(letter))) continue;
    // A key is the canonical sound, with `'` for `h`.
    const word = spelled.map((letter) => (letter === "h" ? "'" : letter)).join("");
    words.add(word);
    if (!classes.has(match[1])) classes.set(match[1], new Set());
    classes.get(match[1]).add(word);
  }
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

let blocks = "```jbogenbau\n%classifier lexicon\n" + entries.join("\n") + "\n```\n";
const indicators = INDICATORS.filter((name) => classes.has(name));
if (indicators.length) blocks += "\n```jbogenbau\n%implies " + indicators.join(" ∪ ") + " ⟹ ~indicator\n```\n";

const document = fs.readFileSync(documentPath, "utf8");
const block = parseMarkdown(document).children.find((node) => node.type === "code" && node.lang === "jbogenbau");
const prose = block ? document.slice(0, block.position.start.offset - (block.position.start.column - 1)) : document;
fs.writeFileSync(documentPath, prose.replace(/\n*$/, "\n\n") + blocks);
console.log(`${words.size} words in ${classes.size} classes`);
