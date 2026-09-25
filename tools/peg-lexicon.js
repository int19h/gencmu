#!/usr/bin/env node
// Writes the rules of a lexicon document from the selma'o lists of a PEG
// grammar of Lojban, such as camxes-exp.peg. Each list is a rule of the form
// `NAME <- &cmavo ( w o r d / ... ) &post_word`, whose letters spell the
// words, `h` being the apostrophe. The tool keeps the prose of the document
// before its first `jbogenbau` block and replaces every block after it.
// Usage: node tools/peg-lexicon.js PEG LEXICON.md
import fs from "node:fs";

const [pegPath, documentPath] = process.argv.slice(2);
if (!pegPath || !documentPath) {
  console.error("usage: node tools/peg-lexicon.js PEG LEXICON.md");
  process.exit(2);
}

// These classes attach to the word before them, so the lexicon tags them as
// indicators for the indicator stage.
const INDICATORS = new Set(["UI", "CAI", "Y", "DAhO", "FUhE", "FUhO"]);

const words = new Map();
const peg = fs.readFileSync(pegPath, "utf8");
for (const match of peg.matchAll(/^([A-Z][A-Za-z]*) <- &cmavo \(\s*(.*?)\s*\)\s*&post_word/gm)) {
  for (const alternative of match[2].split("/")) {
    const letters = alternative.trim().split(/\s+/);
    // `y+` is a run of y, which the word stage reads as hesitation; the
    // lexicon lists the one letter.
    const spelled = letters.map((letter) => (letter === "y+" ? "y" : letter));
    if (!spelled.every((letter) => /^[a-z]$/.test(letter))) continue;
    const word = spelled.join("");
    if (!words.has(word)) words.set(word, new Set());
    words.get(word).add(match[1]);
  }
}

const phoneme = (letter) => {
  if (letter === "h") return "/'/";
  if ("aeiouy".includes(letter)) return `any-${letter}`;
  return `/${letter}/`;
};
const spelling = (word) => [...word].map(phoneme).join(" ");
const classes = (set) => {
  const all = [...set].sort();
  if (all.some((name) => INDICATORS.has(name))) all.push("indicator");
  return all.map((name) => `"${name}"`).join(" ∪ ");
};

const groups = new Map();
for (const word of [...words.keys()].sort()) {
  const letter = word[0];
  if (!groups.has(letter)) groups.set(letter, []);
  groups.get(letter).push(`  | ${spelling(word)} <${classes(words.get(word))}>`);
}
const letters = [...groups.keys()].sort();
let rules = "```jbogenbau\n%rule lexicon\n" + letters.map((letter) => `  | lexicon-${letter}`).join("\n") + "\n";
for (const letter of letters) rules += `\n%rule lexicon-${letter}\n${groups.get(letter).join("\n")}\n`;
rules += "```\n";

const document = fs.readFileSync(documentPath, "utf8");
const first = document.indexOf("```jbogenbau");
const prose = first < 0 ? document : document.slice(0, first);
fs.writeFileSync(documentPath, prose.replace(/\n*$/, "\n\n") + rules);
console.log(`${words.size} words in ${letters.length} rules`);
