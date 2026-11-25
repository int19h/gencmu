#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { GencmuError } from "../lib/js/src/errors.js";
import { extractGrammarText, resolvePath } from "../lib/js/src/markdown.js";
import { loaderWith } from "../lib/js/test/shared.js";
import { createTransitionCompiler } from "./transition-compiler.js";
import { MigrationRequired, translateDom49 } from "./translate-dom49.js";
import { retireNegative49, translateNegative49 } from "./translate-negative49.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const fence = (text) => "```jbogenbau\n" + text + "\n```\n";
const defaults = "%const $DEFAULTS $node ↦ {value: $node.children!'value.join(), image: $node.children!'image.join()}";
const stageNames = new Set(["stage", "extend-stage", "redefine-stage"]);
const handMigrations = JSON.parse(fs.readFileSync(new URL("./shared-case-migrations.json", import.meta.url), "utf8"));
const negativeMigrations = JSON.parse(fs.readFileSync(new URL("./shared-negative-migrations.json", import.meta.url), "utf8"));
const portableTag = /^[A-Z][A-Za-z0-9_-]*$/;
let transition;

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
      oldPositions: positions.slice(oldStart, end), oldEnd: positions[end] ?? positions.at(-1), same });
  }
  return { markdown: fence(code.trimEnd()), map };
}

function tokens(text, [line, column] = [1, 1], positions) {
  const values = [];
  let offset = 0;
  const spans = /--[^\r\n]*|"[^"]*"|\r\n|\r|\n|[\t \p{White_Space}]+|[%@$]?[A-Za-z_][A-Za-z0-9_-]*|\.\.\.|\.\.|::|:=|:-|\+\+|[^]/gu;
  for (const match of text.matchAll(spans)) {
    const token = match[0];
    const at = positions?.[offset] ?? [line, column];
    offset += [...token].length;
    if (/\r|\n/.test(token)) {
      const lines = token.split(/\r\n|\r|\n/);
      if (token.startsWith('"')) values.push({ token, at });
      line += lines.length - 1;
      column = [...lines.at(-1)].length + 1;
      continue;
    }
    if (!/^\s|^--/.test(token)) values.push({ token, at });
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
  if (at[0] === owner.from[0] && at[1] === owner.from[1]) {
    return { from: where, to: { ...where, line: owner.to[0], column: owner.to[1] } };
  }
  const input = tokens(owner.oldText, owner.from, owner.oldPositions);
  const output = tokens(owner.newText, owner.to);
  const source = input.findIndex(item => item.at[0] === at[0] && item.at[1] === at[1]);
  if (source === -1) return { from: where, review: "The expected position is inside or between tokens." };
  if (owner.same) {
    const [line, column] = output[source].at;
    return { from: where, to: { ...where, line, column }, anchor: "unchanged token" };
  }
  const value = input[source].token;
  const matches = stream => stream.flatMap((item, index) => item.token === value ? [index] : []);
  const originalMatches = matches(input);
  const translatedMatches = matches(output);
  const oldChannel = index => input[index + 1]?.token === "." && input[index + 2]?.token === "emitted" &&
    input[index + 3]?.token === "." ? input[index + 4]?.token : null;
  const channel = oldChannel(source);
  if (channel === "value" || channel === "image") {
    const reads = originalMatches.filter(index => oldChannel(index) === channel);
    const selectors = translatedMatches.filter(index => output[index + 1]?.token === "'" &&
      output[index + 2]?.token === channel);
    if (reads.length === selectors.length) {
      const [line, column] = output[selectors[reads.indexOf(source)] + 1].at;
      return { from: where, to: { ...where, line, column }, operand: value, anchor: "property selector" };
    }
  }
  if (originalMatches.length === translatedMatches.length) {
    const index = translatedMatches[originalMatches.indexOf(source)];
    const [line, column] = output[index].at;
    return { from: where, to: { ...where, line, column }, operand: value,
      anchor: "operand order within its declaration" };
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

function possibleOmittedValues(doms) {
  const terminals = new Set();
  const visit = node => {
    if (!node || typeof node !== "object") return;
    if (node.elidable) {
      let head = node.optional.seq?.[0] ?? (node.optional.capture !== undefined ? node.optional.expr : node.optional);
      let fallback;
      while (head.test) {
        if (head.test === "=") fallback = head.value;
        head = head.expr;
      }
      const value = node.default ?? fallback;
      if (value && value.string !== "") terminals.add(head.ref ?? "*");
    }
    for (const child of Object.values(node)) visit(child);
  };
  for (const dom of doms) visit(dom.rules);
  return terminals;
}

function tokenInput(tokens, preserve = false) {
  if (!Array.isArray(tokens) || preserve) return tokens;
  return tokens.map(token => {
    if (!token || typeof token !== "object") return token;
    const { tags, props, value, image, ...fields } = token;
    if (tags !== undefined && (!Array.isArray(tags) || tags.some(tag => typeof tag !== "string") ||
        new Set(tags).size !== tags.length)) return token;
    if (props !== undefined && (!props || typeof props !== "object" || Array.isArray(props))) return token;
    if (value !== undefined && typeof value !== "string" || image !== undefined && typeof image !== "string") return token;
    if (props === undefined && tags === undefined) return token;
    return { ...fields, props: { ...Object.fromEntries((tags ?? []).map(tag => [tag, true])), ...props,
      ...(value !== undefined && { value }), ...(image !== undefined && { image }) } };
  });
}

function caseInput(testCase) {
  const { grammar, documents, expect, parses, tokens: supplied, ...input } = testCase;
  const tokens = tokenInput(supplied, expect?.error === "usage" || parses?.some(run => run.expect?.error === "usage"));
  return { ...input, ...(supplied && { tokens }),
    ...(parses && { parses: parses.map(({ expect, ...run }) =>
      run.tokens === undefined ? run : { ...run, tokens: tokenInput(run.tokens, expect?.error === "usage") }) }) };
}

function recordedNegative(id, testCase, documents, entry) {
  const counterpart = negativeMigrations[id];
  if (!counterpart) return;
  const { retired, native, load, expected, reason, section, document, documents: replacement, entry: replacementEntry } = counterpart;
  if (retired) return { id, status: "retired", oldPath: true, reason: retired, section };
  const fixture = replacement || documents ? { ...caseInput(testCase),
    pipelineDocument: replacementEntry ?? entry, documents: { ...documents, ...replacement } } : undefined;
  return { id, status: native ? "native-pending" : "retained-negative", oldPath: true,
    expected, ...(load && { load }), reason, ...(section && { section }),
    ...(fixture ? { fixture } : { document: document ?? testCase.document }),
    reference: testCase.expect ?? testCase.parses };
}

function convertedNegative(id, testCase, { source, ...record }) {
  const document = record.expected.document;
  const markdown = fence(source.join("\n"));
  const fixture = { ...caseInput(testCase), pipelineDocument: document, documents: { [document]: markdown } };
  const result = { id, oldPath: true, ...record, fixture, reference: testCase.expect ?? testCase.parses };
  transition ??= createTransitionCompiler();
  try {
    transition.compileDocument(markdown, document);
    return { ...result, status: "native-pending" };
  } catch (error) {
    if (!(error instanceof GencmuError)) throw error;
    const expected = record.expected;
    const { line, column } = error.where;
    if (line === expected.line && column === expected.column &&
        (/^a method has the wrong receiver or arguments$/.test(error.description) ||
          /^[=≠⊆⊈∈∉∪∩∖] requires /.test(error.description))) {
      return { ...result, status: "retained-negative", expected: { ...expected, description: error.description } };
    }
    return { ...result, status: "needs-negative", reason: `A different source fault precedes this operand. ${error.description}`,
      location: error.where };
  }
}

export function translateSharedCase(family, file, testCase) {
  const id = `${family}/${file}`;
  const versioned = overridesFor(id);
  if (versioned) {
    const { fixture, ...record } = versioned;
    const merged = fixture && { ...caseInput(testCase), ...fixture };
    if (fixture?.tokens) merged.tokens = tokenInput(fixture.tokens, testCase.expect?.error === "usage");
    return { id, status: record.expected ? "native-pending" : record.retired ? "retired" : "hand-migrated", ...record,
      ...(record.expected || record.retired ? { oldPath: true } : {}),
      ...(merged && { fixture: merged }),
      reference: testCase.expect ?? testCase.parses };
  }
  if (testCase.pipeline !== undefined) {
    const valid = typeof testCase.pipeline === "string" && /^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)+$/.test(testCase.pipeline);
    const current = valid && fs.existsSync(path.join(root, "grammars50", testCase.pipeline, "pipeline.md"));
    const exists = current || valid && fs.existsSync(path.join(root, "grammars", testCase.pipeline, "pipeline.md"));
    if (!valid || !exists && testCase.expect?.error === "usage") {
      return { id, status: "portable-negative", fixture: caseInput(testCase), reference: testCase.expect };
    }
    if (current && testCase.expect?.bundledPipelines) {
      const missing = testCase.expect.bundledPipelines.filter(name =>
        !fs.existsSync(path.join(root, "grammars50", name, "pipeline.md")));
      if (missing.length) return { id, status: "deferred", reason: `The format 50 catalog still needs ${missing.join(", ")}.` };
    }
    if (current) return { id, status: "native-pending", section: "Engine §1, Bundles and bootstraps",
      fixture: caseInput(testCase), reason: "Run the pipeline with the format 50 bundle.", reference: testCase.expect };
    return { id, status: "deferred", reason: `The case waits for the format 50 migration of ${testCase.pipeline}.` };
  }
  const authored = negativeMigrations[id];
  if (authored?.load && authored.entry && authored.documents) {
    return recordedNegative(id, testCase, testCase.documents, authored.entry);
  }
  if (family === "notation" && testCase.expect.error) {
    return recordedNegative(id, testCase) ?? { id, status: "needs-negative", oldPath: true,
      reason: "Identify the retained fault or a removed construct.",
      reference: testCase.expect };
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
  let missingArgument;
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
    const counts = new Map();
    for (const dom of doms.values()) for (const item of dom.constants) {
      counts.set(item.name, (counts.get(item.name) ?? 0) + 1);
    }
    const uniqueConstants = new Set([...counts].filter(([, count]) => count === 1).map(([name]) => name));
    const missing = testCase.expect?.error === "grammar" &&
      /^\$([A-Z][A-Za-z0-9_-]*) is not defined in stage /.exec(testCase.expect.message ?? "")?.[1];
    const deferredArguments = new Set();
    const isUndefined = name => {
      if (!missing || counts.has(name) || ["INPUTS", "OUTPUTS", "DEFAULTS"].includes(name)) return false;
      deferredArguments.add(name);
      return true;
    };
    const omittedValues = possibleOmittedValues(doms.values());
    for (const [file, dom] of doms) {
      const declarations = translateDom49(dom, loader.unicode, uniqueConstants, omittedValues, isUndefined);
      const rendered = declarationsInSource(declarations, sources[file], file, loader.unicode);
      translated[file] = rendered.markdown;
      maps.set(file, rendered.map);
    }
    if (deferredArguments.has(missing)) missingArgument = missing;
  } catch (error) {
    if (error instanceof GencmuError) {
      const location = error.where;
      if (location.document === "data/unicode/unicode.txt" || location.document === "data/unicode/unicode-properties.txt") {
        // A resource can fail while the table loads or when a document first
        // asks for a name. Keep the latter's demand for the resource.
        const documents = loader ? sources : {
          [location.document]: sources[location.document],
          ...(Object.hasOwn(sources, "data/unicode/unicode.txt") && { "data/unicode/unicode.txt": sources["data/unicode/unicode.txt"] }),
          "p.md": fence("%stage main\n%rule text ε"),
        };
        return { id, status: "portable-negative", oldPath: true,
          fixture: { ...caseInput(testCase), pipelineDocument: loader ? entry : "p.md", documents },
          expected: { description: error.description, ...location }, reference: testCase.expect ?? testCase.parses };
      }
      const recorded = recordedNegative(id, testCase, sources, entry);
      if (recorded) return recorded;
      const native = translateNegative49(id, testCase, error.description);
      if (native) {
        if (!native.retired) return convertedNegative(id, testCase, native);
        const { retired, ...record } = native;
        return { id, status: "retired", oldPath: true, ...record, reference: testCase.expect ?? testCase.parses };
      }
      const retired = retireNegative49(error.description);
      if (retired) return { id, status: "retired", oldPath: true, ...retired, reference: testCase.expect ?? testCase.parses };
      return { id, status: "needs-negative", oldPath: true, reason: error.description, location, reference: testCase.expect ?? testCase.parses };
    }
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
  const fixture = { ...caseInput(testCase), documents: translated, pipelineDocument: entry };
  if (missingArgument && testCase.expect?.where) {
    const document = testCase.expect.where.document;
    const anchor = tokens(translated[document] ?? "").filter(token => token.token === `$${missingArgument}`);
    if (anchor.length === 1) {
      const [line, column] = anchor[0].at;
      return { id, status: "native-pending", oldPath: true, fixture, diagnostics, changes,
        expected: { kind: "grammar", document, line, column },
        section: "Engine §§2.3, 9.3",
        reason: "The argument names an undeclared constant. Inspect the retained operand before substitution.",
        reference: testCase.expect };
    }
  }
  const unreadDocuments = Object.keys(sources).filter(file => file.endsWith(".md") && !doms.has(file));
  return { id, status: "translated", fixture, diagnostics, changes, unreadDocuments, reference: testCase.expect ?? testCase.parses };
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
