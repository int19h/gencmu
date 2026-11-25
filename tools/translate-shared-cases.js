#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { GencmuError } from "../lib/js/src/errors.js";
import { extractGrammarText, resolvePath } from "../lib/js/src/markdown.js";
import { loaderWith } from "../lib/js/test/shared.js";
import { MigrationRequired, translateDom49 } from "./translate-dom49.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const fence = (text) => "```jbogenbau\n" + text + "\n```\n";
const defaults = "%const $DEFAULTS $node ↦ {value: $node.children!'value.join(), image: $node.children!'image.join()}";
const stageNames = new Set(["stage", "extend-stage", "redefine-stage"]);
const handMigrations = JSON.parse(fs.readFileSync(new URL("./shared-case-migrations.json", import.meta.url), "utf8"));
const portableTag = /^[A-Z][A-Za-z0-9_-]*$/;

function coordinate(line, column) {
  return `${line}:${column}`;
}

function before([leftLine, leftColumn], [rightLine, rightColumn]) {
  return leftLine < rightLine || leftLine === rightLine && leftColumn < rightColumn;
}

function declarationsInSource(declarations, markdown, document, unicode) {
  const { text, positions } = extractGrammarText(markdown, document, unicode);
  const chars = [...text];
  const offsets = new Map(positions.map(([line, column], index) => [coordinate(line, column), index]));
  const sourceStarts = declarations.map(item => offsets.get(coordinate(item.from[0], item.from[1])));
  let line = 2;
  let code = "";
  const map = [];
  for (const [index, entry] of declarations.entries()) {
    const oldStart = sourceStarts[index];
    const end = sourceStarts[index + 1] ?? chars.length;
    const oldText = chars.slice(oldStart, end).join("").trimEnd();
    // A declaration keeps its original layout when only the printer's
    // whitespace differs. Strings retain their spaces and escape spellings.
    const same = tokenValues(oldText).join("\0") === tokenValues(entry.source).join("\0");
    const source = same ? oldText : entry.source;
    const startLine = Math.max(line, entry.from[0]);
    const startColumn = entry.from[1];
    code += "\n".repeat(startLine - line) + " ".repeat(startColumn - 1) + source + "\n";
    line = startLine + source.split(/\r\n|\r|\n/).length;
    map.push({ ...entry, to: [startLine, startColumn], oldText, newText: source,
      oldEnd: positions[end] ?? positions.at(-1), same });
  }
  return { markdown: fence(code.trimEnd()), map };
}

function tokens(text, [line, column] = [1, 1]) {
  const values = [];
  const spans = /--[^\r\n]*|"[^"]*"|\r\n|\r|\n|[\t \p{White_Space}]+|[%@$]?[A-Za-z_][A-Za-z0-9_-]*|\.\.\.|\.\.|::|:=|:-|\+\+|[^]/gu;
  for (const match of text.matchAll(spans)) {
    const token = match[0];
    if (/\r|\n/.test(token)) {
      const lines = token.split(/\r\n|\r|\n/);
      if (token.startsWith('"')) values.push({ token, at: [line, column] });
      line += lines.length - 1;
      column = [...lines.at(-1)].length + 1;
      continue;
    }
    if (!/^\s|^--/.test(token)) values.push({ token, at: [line, column] });
    column += [...token].length;
  }
  return values;
}

const tokenValues = text => tokens(text).map(item => item.token);

function migrateLocation(where, maps) {
  if (!where.line || !where.column || !maps.has(where.document)) return { from: where, to: where };
  const at = [where.line, where.column];
  const owner = maps.get(where.document).find(item => !before(at, item.from) && before(at, item.oldEnd));
  if (!owner) return { from: where, review: "The expected position is outside a translated declaration." };
  if (owner.same) return { from: where, to: { ...where, line: where.line + owner.to[0] - owner.from[0] } };
  if (at[0] === owner.from[0] && at[1] === owner.from[1]) {
    return { from: where, to: { ...where, line: owner.to[0], column: owner.to[1] } };
  }
  const input = tokens(owner.oldText, owner.from);
  const output = tokens(owner.newText, owner.to);
  const source = input.findIndex(item => item.at[0] === at[0] && item.at[1] === at[1]);
  if (source === -1) return { from: where, review: "The expected position is inside or between tokens." };
  const value = input[source].token;
  const matches = output.flatMap((item, index) => item.token === value ? [index] : []);
  if (matches.length === 1 && input.filter(item => item.token === value).length === 1) {
    const [line, column] = output[matches[0]].at;
    return { from: where, to: { ...where, line, column }, operand: value };
  }
  return { from: where, review: "No unique surviving operand anchors this location.", operand: value };
}

function usedKeys(doms, testCase) {
  const keys = new Set();
  const root = [...doms, ...testCase.tokens ?? []];
  while (root.length) {
    const value = root.pop();
    if (typeof value === "string") {
      if (portableTag.test(value)) keys.add(value);
    } else if (value && typeof value === "object") {
      for (const child of Object.values(value)) root.push(child);
    }
  }
  return [...keys].sort();
}

function overridesFor(caseId) {
  return Object.hasOwn(handMigrations, caseId) ? handMigrations[caseId] : undefined;
}

export function translateSharedCase(family, file, testCase) {
  const id = `${family}/${file}`;
  const versioned = overridesFor(id);
  if (versioned) return { id, status: "hand-migrated", ...versioned, reference: testCase.expect ?? testCase.parses };
  if (testCase.pipeline !== undefined) {
    return { id, status: "old", reason: "The original case selects a bundled format 49 pipeline." };
  }
  if (family === "notation" && testCase.expect.error) {
    return { id, status: "old", reason: "The original case exercises a format 49 document error." };
  }
  const isNotation = family === "notation";
  const entry = isNotation ? "notation.md" : testCase.pipelineDocument ?? "pipeline.md";
  const implicit = isNotation ? { [entry]: testCase.document } : {
    "main.md": fence(testCase.grammar?.includes("%ambiguity-resolution") ?
      testCase.grammar : `%ambiguity-resolution greedy\n${testCase.grammar}`),
    [entry]: fence('%stage main\n%include "main.md"'),
  };
  const sources = testCase.documents ?? implicit;
  const translated = { ...sources };
  let loader;
  const maps = new Map();
  const doms = new Map();
  const stages = new Set();
  const active = new Set();
  const visit = (file, inherited = []) => {
    if (active.has(file) || !Object.hasOwn(sources, file)) return;
    const document = `case/${file}`;
    const dom = loader.documentDom(document, inherited, sources[file]);
    const previous = doms.get(file);
    if (previous && JSON.stringify(previous) !== JSON.stringify(dom)) {
      throw new MigrationRequired("An include has two distinct names scopes.");
    }
    if (previous) return;
    doms.set(file, dom);
    active.add(file);
    const declarations = translateDom49(dom, loader.unicode);
    const rendered = declarationsInSource(declarations, sources[file], file, loader.unicode);
    translated[file] = rendered.markdown;
    maps.set(file, rendered.map);
    const names = [...inherited, ...dom.directives.filter(item => item.name === "names")
      .map(item => resolvePath(document, item.args[0]))];
    for (const directive of dom.directives) {
      if (stageNames.has(directive.name)) stages.add(directive.args[0]);
      if (directive.name !== "include") continue;
      const target = resolvePath(file, directive.args[0]);
      visit(target, names);
    }
    active.delete(file);
  };
  try {
    loader = loaderWith(sources);
    visit(entry);
  } catch (error) {
    if (error instanceof GencmuError) return { id, status: "old", reason: error.description, location: error.where };
    if (error instanceof MigrationRequired) return { id, status: "needs-hand", reason: error.message, at: error.at };
    throw error;
  }
  const diagnostics = [testCase, ...testCase.parses ?? []].flatMap(run =>
    run.expect?.where ? [migrateLocation(run.expect.where, maps)] : []);
  const changes = [...maps].flatMap(([document, declarations]) => declarations.flatMap(item =>
    item.changes.map(reason => ({ document, at: item.from, reason }))));
  if (isNotation) {
    return { id, status: "translated", document: translated[entry], reference: testCase.expect, diagnostics, changes };
  }
  const keys = usedKeys(doms.values(), testCase);
  const outputs = `%const $OUTPUTS {*$INPUTS${keys.length ? ", " + keys.join(", ") : ""}}`;
  if (stages.size) translated[entry] += "\n" + fence([...stages].map(name =>
    `%extend-stage ${name}\n${defaults}\n${outputs}`).join("\n"));
  const { grammar, documents, expect, parses, tokens: supplied, ...input } = testCase;
  const tokens50 = supplied?.map(token => {
    if (!token || !Array.isArray(token.tags) || token.tags.some(tag => typeof tag !== "string")) return token;
    const { tags, ...fields } = token;
    return { ...fields, props: Object.fromEntries(tags.map(tag => [tag, true])) };
  });
  const fixture = { ...input, documents: translated, pipelineDocument: entry, ...(supplied && { tokens: tokens50 }),
    ...(parses && { parses: parses.map(({ expect, ...run }) => run) }) };
  return { id, status: "translated", fixture, diagnostics, changes, reference: expect ?? parses };
}

function main() {
  const [family, startText, countText] = process.argv.slice(2);
  if (!["engine", "notation"].includes(family)) throw new Error("usage: node tools/translate-shared-cases.js (engine|notation) [START [COUNT]]");
  const start = Number(startText ?? 0);
  const count = Number(countText ?? Infinity);
  const dir = path.join(root, "tests", family);
  const files = fs.readdirSync(dir).filter(file => file.endsWith(".json")).sort();
  for (const file of files.slice(start, start + count)) {
    const testCase = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    const outcome = translateSharedCase(family, file, testCase);
    process.stdout.write(JSON.stringify(outcome) + "\n");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
