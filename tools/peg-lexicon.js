#!/usr/bin/env node
// Compares a hand-curated lexicon with the cmavo lists of a PEG grammar.
// It reports missing words and different class sets without writing files.
// Usage: node tools/peg-lexicon.js PEG LEXICON.md
//        node tools/peg-lexicon.js PEG --print-classifier
// Comparison exits 0 for equal tables, 1 for differences, and 2 for errors.
// Bootstrap mode prints a fresh classifier to stdout, without implications.
// PEG lists use `NAME <- &cmavo ( w o r d / ... ) &post_word`, with h for '.
// A relevant production's name starts with an uppercase letter.
// Its body starts with a cmavo predicate, whose & permits following whitespace.
// That whitespace can include newlines. The operand permits one parenthesis pair.
// CMAVO's category body does not start with that predicate.
// The lowercase cmavo rule and lowercase helpers do not qualify.
// Each relevant production must contain only that complete list form.
// Repeated post_word lookaheads test the same position and are supported.
// Whole-line PEG comments are ignored. Other unconsumed material is an error.
// A standalone y+ is hesitation, not a cmavo. A mixed Y list retains y.
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
  // Whole-line comments belong to neither the preceding nor the next rule.
  const peg = fs.readFileSync(pegPath, "utf8").replace(/^[ \t]*(?:#|;|\/\/)[^\r\n]*/gm, "");
  const heads = [...peg.matchAll(/^[ \t]*([A-Za-z_][A-Za-z0-9_]*)[ \t]*<-[ \t]*/gm)];
  for (let i = 0; i < heads.length; ++i) {
    const head = heads[i];
    const name = head[1];
    const body = peg.slice(head.index + head[0].length, heads[i + 1]?.index ?? peg.length).trim();
    if (!/^[A-Z]/.test(name) || !/^&\s*(?:cmavo\b|\(\s*cmavo\s*\))/.test(body)) continue;
    // Match the entire production, including any material on later lines.
    // An unsupported alternative or condition cannot hide after post_word.
    const list = /^&\s*(?:cmavo|\(\s*cmavo\s*\))\s*\(\s*([^()]*)\s*\)(?:\s*&\s*(?:post_word|\(\s*post_word\s*\)))+$/.exec(body);
    if (!list) fail(`unsupported cmavo list for ${name}`);
    // A Y list containing only y+ cannot classify a word in these forms.
    // A mixed list retains its y key, as Zantufa requires.
    if (name === "Y" && list[1].trim() === "y+") continue;
    for (const alternative of list[1].split("/")) {
      if ((name === "BY" && alternative.trim() === "ybu") ||
          (name === "PA" && alternative.trim() === "digit")) continue;
      const letters = alternative.trim().split(/\s+/);
      // A retained `y+` alternative lists the canonical one-letter key.
      const spelled = letters.map((letter) => (letter === "y+" ? "y" : letter));
      if (!spelled.every((letter) => /^[a-z]$/.test(letter))) fail(`unsupported word list in ${name}: ${alternative.trim()}`);
      // A key is the canonical sound, with `'` for `h`.
      const word = spelled.map((letter) => (letter === "h" ? "'" : letter)).join("");
      if (!classes.has(name)) classes.set(name, new Set());
      classes.get(name).add(word);
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
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
    const loader = new Loader((name) => {
      if (name !== "data/unicode/unicode.txt" && name !== "grammars/notation/bootstrap.json") return undefined;
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
