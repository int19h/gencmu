#!/usr/bin/env node
// Regenerates every generated file from grammars/ and lib/js/src/, or, with
// --check, fails if any of them is out of date:
//
//   grammars/compiled.json   the DOM of every grammar document, keyed by hash
//   lib/js/grammars/         the npm package's copy of grammars/
//   dist/grammars.js         grammars/ as one object, for the browser
//   dist/gencmu.js           the library as one factory function, for the browser
//   docs/diagrams/           a railroad diagram of each rule, as an SVG file
//
// and the other packages' copies of grammars/ and of LICENSE under lib/,
// removing a copy of a document that grammars/ no longer has. It also
// writes the generated lines of the grammar documents themselves: under
// each block of rules, one collapsed <details> element for each rule, which
// shows its diagram (tools/railroad.js). It removes each generated line of a
// rule that is gone, and leaves every other line of the document as it is.
// tests/quoted-allow.txt names lines of the documents, so it renumbers them
// where it moves them.
//
// Run it after editing a grammar. It checks the Markdown of the documents
// with a parser, a development dependency of lib/js (tools/markdown.js):
// without `npm ci` in lib/js, it skips those checks, and --check fails. The
// libraries' own reader of grammar blocks (lib/js/src/markdown.js), which
// docs/engine.md specifies, reads the grammar, as every library does.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Loader, fnv1a64 } from "../lib/js/src/node.js";
import { DOM_FORMAT } from "../lib/js/src/dom.js";
import { extractGrammarText } from "../lib/js/src/markdown.js";
import { includeLinks } from "./links.js";
import { layoutProblems } from "./alternatives.js";
import { quotedTextProblems } from "./quoted-texts.js";
import { proseLineProblems } from "./prose-lines.js";
import { markdownFiles, repositoryFiles } from "./documents.js";
import { corpusShapeProblems, mutantShapeProblems } from "./corpus-shape.js";
import { missing as parserMissing } from "./markdown.js";
import { DIAGRAMS, DIAGRAM_LINE_START, fencedBlocks, withDiagrams } from "./railroad.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
// The packages' copies of grammars/.
const copies = ["lib/js/grammars", "lib/python/src/gencmu/grammars", "lib/go/grammars", "lib/rust/grammars"];
const grammars = path.join(root, "grammars");
const check = process.argv.includes("--check");
const stale = [];

function write(relative, content) {
  const file = path.join(root, relative);
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  if (current === content) return;
  stale.push(relative);
  if (!check) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
}

function grammarFiles(directory = grammars, prefix = "") {
  const files = [];
  // Hidden files, such as a desktop's .DS_Store, are not grammars.
  const entries = fs.readdirSync(directory, { withFileTypes: true }).filter((entry) => !entry.name.startsWith("."));
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) for (const file of grammarFiles(path.join(directory, entry.name), relative + "/")) files.push(file);
    else if (relative !== "compiled.json") files.push(relative);
  }
  return files;
}

// Every grammar file that this script bundles is one of the repository's
// files, as every tool lists them (tools/documents.js). So the checks below
// see each document that the packages ship.
const listed = new Set(repositoryFiles(root));
const unlisted = grammarFiles().map((file) => `grammars/${file}`).filter((file) => !listed.has(file));
if (unlisted.length) {
  console.error(unlisted.map((file) => `${file}: git does not track this file, and sync.js would bundle it; add it to git, or remove it`).join("\n"));
  process.exit(1);
}

// Every corpus case and result mutant has the shape of tests/README.md
// ("Corpus cases", "Result mutants"), so the runners of the four libraries
// never see a field that they would read in different ways
// (tools/corpus-shape.js).
const misshapen = [...corpusShapeProblems(root), ...mutantShapeProblems(root)];
if (misshapen.length) {
  console.error(misshapen.join("\n"));
  process.exit(1);
}

// The bootstrap: the notation's own pipeline read with the bootstrap, until
// reading it again changes nothing (docs/design.md, "Self-hosting"). A
// change to the notation that the current bootstrap cannot read needs
// tools/write-bootstrap.js first.
const bootstrapPath = path.join(grammars, "notation", "bootstrap.json");
// A loader of grammars/ with the given bootstrap and no precompiled DOMs.
/** @param {string} bootstrap */
const loaderWith = (bootstrap) => new Loader((relative) => {
  if (relative === "notation/bootstrap.json") return bootstrap;
  if (relative === "compiled.json") return undefined;
  const file = path.join(grammars, relative.split("/").join(path.sep));
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
});
/**
 * The bootstrap that reading the notation with `bootstrap` reaches.
 * @param {string} bootstrap
 */
function settle(bootstrap) {
  for (let round = 0; ; round++) {
    // The notation's own pipeline, spliced with the current bootstrap.
    const { stages } = loaderWith(bootstrap).pipeline("dialects/notation.md");
    const next = { format: DOM_FORMAT, stages: stages.map((stage) => ({ name: stage.name, documents: stage.documents })) };
    const nextText = JSON.stringify(next) + "\n";
    if (nextText === bootstrap) return bootstrap;
    if (round === 3) throw new Error("the notation does not reach a fixpoint");
    bootstrap = nextText;
  }
}
let bootstrapText = settle(fs.readFileSync(bootstrapPath, "utf8"));

// The railroad diagrams (tools/railroad.js): the generated lines of each
// grammar document, and the SVG file of each rule. A document with no
// grammar block keeps no generated line either. The generated lines move
// the lines after them, so the lines that tests/quoted-allow.txt names
// move with them, and the DOMs and the bootstrap, which give the line of
// each rule, are read again.
const diagrams = new Map();
const allowPath = path.join(root, "tests", "quoted-allow.txt");
let allow = fs.readFileSync(allowPath, "utf8");
let moved = false;
const reader = loaderWith(bootstrapText);
for (const file of grammarFiles()) {
  if (!file.endsWith(".md")) continue;
  const text = fs.readFileSync(path.join(grammars, file), "utf8");
  const dom = extractGrammarText(text, file).blocks === 0 ? { rules: [] } : reader.readDocument(text, file);
  const { text: next, lines, files } = withDiagrams(file, text, dom);
  for (const [relative, svg] of files) diagrams.set(relative, svg);
  if (next === text) continue;
  write(`grammars/${file}`, next);
  if (check) continue;
  moved = true;
  allow = allow.split("\n").map((line) => {
    const entry = /^(.*?\s+#\s+)([^\s:]+):(\d+(?:,\d+)*)(\s+[#=]\s.*)$/.exec(line);
    if (!entry || entry[2] !== `grammars/${file}`) return line;
    return `${entry[1]}${entry[2]}:${entry[3].split(",").map((number) => lines[Number(number)] ?? number).join(",")}${entry[4]}`;
  }).join("\n");
}
write("tests/quoted-allow.txt", allow);
if (moved) bootstrapText = settle(bootstrapText);
write("grammars/notation/bootstrap.json", bootstrapText);

// No other document holds a generated line: one there would be a diagram
// that nothing updates. The packages' copies of grammars/ hold the same
// lines as grammars/.
const strays = [];
for (const file of markdownFiles(root)) {
  if (file.startsWith("grammars/") || copies.some((copy) => file.startsWith(`${copy}/`))) continue;
  const lines = fs.readFileSync(path.join(root, file), "utf8").split("\n");
  const inside = new Set(fencedBlocks(lines).flatMap(({ start, end }) => Array.from({ length: end - start + 1 }, (_, index) => start + index)));
  lines.forEach((line, index) => {
    if (!inside.has(index) && line.startsWith(DIAGRAM_LINE_START)) strays.push(`${file}:${index + 1}: a railroad diagram's generated line outside grammars/; remove it`);
  });
}
if (strays.length) {
  console.error(strays.join("\n"));
  process.exit(1);
}

// The precompiled DOMs, read with the engine and the bootstrap.
const loader = loaderWith(bootstrapText);
const documents = {};
for (const file of grammarFiles()) {
  if (!file.endsWith(".md")) continue;
  const text = fs.readFileSync(path.join(grammars, file), "utf8");
  // A document holds grammar when the reader finds a block in it.
  if (extractGrammarText(text, file).blocks === 0) continue;
  documents[file] = { hash: fnv1a64(text), dom: loader.readDocument(text, file) };
}
const compiled = { format: DOM_FORMAT, bootstrap: loader.bootstrapHash, documents };

// A rule whose alternatives are single symbols does not put one on each of
// its lines, and no line of its body holds more than 100 characters
// (docs/notation.md, "Rules"; tools/alternatives.js).
const sprawling = [];
for (const [file, { dom }] of Object.entries(documents)) {
  for (const problem of layoutProblems(fs.readFileSync(path.join(grammars, file), "utf8"), dom, file)) sprawling.push(problem);
}
if (sprawling.length) {
  console.error(sprawling.join("\n"));
  process.exit(1);
}
// The checks of the documents' Markdown read it through the parser of
// tools/markdown.js:
//
// - Every %include of a document follows, in the same list item, a link to
//   the same path, so that the prose and the blocks name the same documents
//   (docs/design.md, "Pipelines"; tools/links.js).
// - Every paragraph, heading and table row of every Markdown document
//   stands on one line, with its code spans, and no document has an
//   indented code block or an HTML block (docs/design.md, "Documents";
//   tools/prose-lines.js).
// - Every Lojban text that a grammar document quotes has a corpus case, or
//   an entry in tests/quoted-allow.txt (tests/README.md, "Quoted texts").
if (parserMissing && check) {
  console.error(`cannot check the Markdown of the documents: ${parserMissing}`);
  process.exit(1);
} else if (parserMissing) {
  console.warn(`the Markdown of the documents is not checked: ${parserMissing}`);
} else {
  const unlinked = [];
  for (const [file, { dom }] of Object.entries(documents)) {
    const isLinked = includeLinks(fs.readFileSync(path.join(grammars, file), "utf8"));
    for (const directive of dom.directives) {
      if (directive.name === "include" && !isLinked(directive.at[0], directive.args[0])) unlinked.push(`${file}:${directive.at[0]}: %include "${directive.args[0]}" does not follow a list item with a link [text](${directive.args[0]})`);
    }
  }
  if (unlinked.length) {
    console.error(unlinked.join("\n"));
    process.exit(1);
  }
  const broken = markdownFiles(root).flatMap((file) => proseLineProblems(fs.readFileSync(path.join(root, file), "utf8"), file));
  if (broken.length) {
    console.error(broken.join("\n"));
    process.exit(1);
  }
  // The DOMs and the dialects of the sources, as this run reads them.
  const unpinned = quotedTextProblems(root, { loader: loaderWith(bootstrapText), doms: new Map(Object.entries(documents).map(([file, { dom }]) => [file, dom])) });
  if (unpinned.length) {
    console.error(unpinned.join("\n"));
    process.exit(1);
  }
}
write("grammars/compiled.json", JSON.stringify(compiled) + "\n");

// The SVG files of the railroad diagrams. They are documentation, so no
// package ships them. A file under docs/diagrams/ that this run does not
// write, such as the diagram of a rule that is gone, goes.
for (const [relative, text] of diagrams) write(relative, text);
/** @param {string} relative */
const existing = (relative) => {
  const directory = path.join(root, relative);
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).filter((entry) => !entry.name.startsWith(".")).flatMap((entry) => (entry.isDirectory() ? existing(`${relative}/${entry.name}`) : [`${relative}/${entry.name}`]));
};
for (const relative of existing(DIAGRAMS)) {
  if (diagrams.has(relative)) continue;
  stale.push(relative);
  if (check) continue;
  fs.unlinkSync(path.join(root, relative));
  // A directory that this leaves empty goes too.
  for (let directory = path.dirname(relative); directory !== DIAGRAMS && directory.startsWith(DIAGRAMS) && fs.readdirSync(path.join(root, directory)).length === 0; directory = path.dirname(directory)) fs.rmdirSync(path.join(root, directory));
}

// The licence, which every package ships beside its code.
const license = fs.readFileSync(path.join(root, "LICENSE"), "utf8");
for (const library of ["lib/js", "lib/python", "lib/go", "lib/rust"]) write(`${library}/LICENSE`, license);

// The grammar copies.
const sources = {};
for (const file of grammarFiles()) sources[file] = fs.readFileSync(path.join(grammars, file), "utf8");
sources["compiled.json"] = JSON.stringify(compiled) + "\n";
for (const copy of copies) {
  for (const [file, text] of Object.entries(sources)) write(`${copy}/${file}`, text);
  // A copy of a document that grammars/ no longer has, such as one renamed
  // there, goes too.
  for (const file of grammarFiles(path.join(root, copy))) {
    if (Object.hasOwn(sources, file)) continue;
    stale.push(`${copy}/${file}`);
    if (!check) fs.unlinkSync(path.join(root, copy, file));
  }
}
write("dist/grammars.js", `// Generated by tools/sync.js from grammars/: every grammar document, by path.
(function (root) {
  "use strict";
  root.gencmuGrammars = ${JSON.stringify(sources)};
})(typeof self !== "undefined" ? self : this);
`);

// The browser bundle: the modules of lib/js/src, except the Node entry point,
// in dependency order, inside one factory function with nothing outside it.
const sourceDirectory = path.join(root, "lib", "js", "src");
const modules = new Map();
for (const file of fs.readdirSync(sourceDirectory).filter((name) => name.endsWith(".js") && name !== "node.js")) {
  const text = fs.readFileSync(path.join(sourceDirectory, file), "utf8");
  const imports = [...text.matchAll(/^import\s[^;]*?from\s+"\.\/([^"]+)";$/gms)].map((match) => match[1]);
  modules.set(file, { text, imports });
}
const order = [];
const visit = (file, trail = []) => {
  if (order.includes(file)) return;
  if (trail.includes(file)) throw new Error(`an import cycle: ${[...trail, file].join(" → ")}`);
  for (const dependency of modules.get(file).imports) visit(dependency, [...trail, file]);
  order.push(file);
};
for (const file of [...modules.keys()].sort()) visit(file);
const declared = new Map();
const bodies = order.map((file) => {
  const body = modules.get(file).text
    .replace(/^import\s[^;]*?from\s+"[^"]+";$/gms, "")
    .replace(/^export\s+\{[^}]*\}\s+from\s+"[^"]+";$/gms, "")
    .replace(/^export\s+\*\s+from\s+"[^"]+";$/gm, "")
    .replace(/^export\s*\{\s*\};$/gm, "")
    .replace(/^export\s+(?=(async\s+)?(function|class|const|let)\b)/gm, "");
  for (const match of body.matchAll(/^(?:async\s+)?(?:function\*?|class|const|let)\s+([A-Za-z_$][\w$]*)/gm)) {
    if (declared.has(match[1])) throw new Error(`${match[1]} is declared in both ${declared.get(match[1])} and ${file}; the bundle needs unique top-level names`);
    declared.set(match[1], file);
  }
  return `  // ---- ${file}\n` + body.split("\n").map((line) => (line ? "  " + line : line)).join("\n");
});
const exported = [...fs.readFileSync(path.join(sourceDirectory, "index.js"), "utf8").matchAll(/export\s+(?:\{([^}]*)\}|function\s+(\w+)|const\s+(\w+))/g)]
  .flatMap((match) => (match[1] ? match[1].split(",").map((name) => name.trim()).filter(Boolean) : [match[2] || match[3]]));
const version = JSON.parse(fs.readFileSync(path.join(root, "lib", "js", "package.json"), "utf8")).version;
write("dist/gencmu.js", `// Generated by tools/sync.js from lib/js/src/: the gencmu library as one factory
// function with nothing outside it, so that a page can hand its source to a
// worker built from a Blob, which fetches nothing.
(function (root) {
  "use strict";
  function gencmuFactory() {
${bodies.join("\n")}
    return { version: ${JSON.stringify(version)}, ${exported.join(", ")} };
  }
  root.gencmuFactory = gencmuFactory;
  root.gencmu = gencmuFactory();
})(typeof self !== "undefined" ? self : this);
`);

if (check && stale.length) {
  console.error(`out of date; run node tools/sync.js:\n  ${stale.join("\n  ")}`);
  process.exit(1);
}
console.log(check ? "generated files are up to date" : `updated ${stale.length} file(s)`);
