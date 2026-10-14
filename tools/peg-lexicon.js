#!/usr/bin/env node
// Compares a hand-curated lexicon with the cmavo lists of a PEG grammar.
// It reports missing words and different class sets without writing files.
// Usage: node tools/peg-lexicon.js PEG LEXICON.md
//        node tools/peg-lexicon.js PEG --print-classifier
// Comparison exits 0 for equal tables, 1 for differences, and 2 for errors.
// Bootstrap mode prints a fresh classifier to stdout, without implications.
// PEG lists use `NAME <- &cmavo ( w o r d / ... ) &post_word`, with h for '.
// A standalone y+ is hesitation, not a cmavo; a mixed Y list retains y.
// BY's ybu and PA's digit are input constructs, not spelled cmavo keys.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Loader } from "../lib/js/src/index.js";
import { Grammar } from "../lib/js/src/grammar.js";

const args = process.argv.slice(2);
const [pegPath, documentPath] = args;
function fail(message) {
  console.error(message);
  process.exit(2);
}
if (args.length !== 2 || !pegPath || !documentPath || pegPath.startsWith("--") ||
    (documentPath.startsWith("--") && documentPath !== "--print-classifier")) {
  fail("usage: node tools/peg-lexicon.js PEG LEXICON.md | PEG --print-classifier");
}

function main() {
  // The longest line of keys, so that the Markdown stays readable; a class
  // with more keys takes one entry on each line.
  const WIDTH = 100;

  const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

  const classes = new Map();
  const peg = fs.readFileSync(pegPath, "utf8");
  const lists = [...peg.matchAll(/^([A-Z][A-Za-z]*)[ \t]+<-[ \t]+&cmavo[ \t]+\(\s*([\s\S]*?)\s*\)\s*&post_word/gm)];
  const names = new Set(lists.map((match) => match[1]));
  for (const match of peg.matchAll(/^([A-Z][A-Za-z]*)[ \t]+<-[ \t]+&cmavo\b/gm)) {
    if (!names.has(match[1])) fail(`unsupported cmavo list for ${match[1]}`);
  }
  for (const match of lists) {
    // A Y list containing only y+ cannot classify a word in these forms.
    // A mixed list retains its y key, as Zantufa requires.
    if (match[1] === "Y" && match[2].trim() === "y+") continue;
    for (const alternative of match[2].split("/")) {
      if ((match[1] === "BY" && alternative.trim() === "ybu") ||
          (match[1] === "PA" && alternative.trim() === "digit")) continue;
      const letters = alternative.trim().split(/\s+/);
      // A retained `y+` alternative lists the canonical one-letter key.
      const spelled = letters.map((letter) => (letter === "y+" ? "y" : letter));
      if (!spelled.every((letter) => /^[a-z]$/.test(letter))) fail(`unsupported word list in ${match[1]}: ${alternative.trim()}`);
      // A key is the canonical sound, with `'` for `h`.
      const word = spelled.map((letter) => (letter === "h" ? "'" : letter)).join("");
      if (!classes.has(match[1])) classes.set(match[1], new Set());
      classes.get(match[1]).add(word);
    }
  }

  if (!classes.size) fail("the PEG has no supported cmavo lists");

  if (documentPath === "--print-classifier") {
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
    console.log(classifier);
  } else {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "grammars");
    const loader = new Loader((name) => {
      if (name !== "unicode.txt" && name !== "notation/bootstrap.json") return undefined;
      return fs.readFileSync(path.join(root, name), "utf8");
    });
    const dom = loader.readDocument(fs.readFileSync(documentPath, "utf8"), documentPath);
    if (dom.classifiers.some((classifier) => classifier.entries.some((entry) => entry.guards.length))) {
      fail("comparison requires a lexicon without feature gates");
    }
    const base = loader.readDocument("```jbogenbau\n%ambiguity-resolution greedy\n%rule text _\n```", "comparison");
    const grammar = new Grammar("comparison", [{ path: "comparison", dom: base }, { path: documentPath, dom }], loader.unicode);
    const lexicon = grammar.classifiers(new Set()).get("lexicon");
    if (!lexicon) fail("the document has no classifier named lexicon");
    const pegWords = new Map();
    for (const [name, keys] of classes) {
      for (const word of keys) {
        if (!pegWords.has(word)) pegWords.set(word, new Set());
        pegWords.get(word).add(name);
      }
    }
    // An entry can remove its last membership, leaving no classification.
    const lexiconWords = new Map([...lexicon].filter(([, names]) => names.size));
    let differences = 0;
    for (const word of [...new Set([...pegWords.keys(), ...lexiconWords.keys()])].sort(compare)) {
      const pegClasses = [...(pegWords.get(word) ?? [])].sort(compare);
      const lexiconClasses = [...(lexiconWords.get(word) ?? [])].sort(compare);
      if (JSON.stringify(pegClasses) === JSON.stringify(lexiconClasses)) continue;
      console.log(`${JSON.stringify(word)}: PEG ${pegClasses.join(", ") || "none"}; lexicon ${lexiconClasses.join(", ") || "none"}`);
      ++differences;
    }
    console.log(`${differences} difference${differences === 1 ? "" : "s"} (PEG ${pegWords.size} words; lexicon ${lexiconWords.size} words)`);
    if (differences) process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  fail(error.message);
}
