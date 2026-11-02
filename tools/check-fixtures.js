#!/usr/bin/env node
// Inspect shared fixture contracts without executing their library inputs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fixtureShapes } from "./fixture-shapes.js";
import { duplicateMembers, illFormedStrings, numberProblems } from "./fixture-json.js";
import { readAllowList } from "./quoted-texts.js";

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const own = (value, key) => Object.hasOwn(value, key);
const jsonWhitespaceOnly = (text) => /^[\t\n\r ]*$/.test(text);

// Recursion follows the finite shape description, never an opaque payload.
function inspect(shape, value, at, problems) {
  const fail = (description) => problems.push(`${at}: ${description}`);
  if (shape.check) {
    for (const message of shape.check(value)) fail(message);
  } else if (typeof shape === "string") {
    const matches = shape === "any" || (shape === "record" ? isRecord(value)
      : shape === "integer" ? Number.isSafeInteger(value)
      : shape === "natural" ? Number.isSafeInteger(value) && value >= 0
      : shape === "positive" ? Number.isSafeInteger(value) && value > 0
      : shape === "path-index" ? Number.isSafeInteger(value) && value >= -1
      : typeof value === shape);
    if (!matches) fail(`expected ${shape}`);
  } else if (shape.either) {
    if (!shape.either.some((alternative) => { const errors = []; inspect(alternative, value, at, errors); return !errors.length; })) fail("no permitted shape matches");
  } else if (shape.choice) {
    if (!shape.choice.includes(value)) fail(`expected one of ${JSON.stringify(shape.choice)}`);
  } else if (shape.pattern) {
    if (typeof value !== "string" || !shape.pattern.test(value)) fail(`expected a string matching ${shape.pattern}`);
  } else if (shape.list || shape.tuple) {
    if (!Array.isArray(value)) { fail("expected an array"); return; }
    if (shape.tuple && value.length !== shape.tuple.length) { fail(`expected ${shape.tuple.length} entries`); return; }
    if (value.length < (shape.min ?? 0)) fail(`expected at least ${shape.min} entries`);
    value.forEach((item, index) => inspect(shape.list ?? shape.tuple[index], item, `${at}[${index}]`, problems));
  } else {
    if (!isRecord(value)) { fail("expected an object"); return; }
    if (shape.map) {
      for (const [key, item] of Object.entries(value)) inspect(shape.map, item, `${at}[${JSON.stringify(key)}]`, problems);
      return;
    }
    const before = problems.length;
    for (const key of Object.keys(shape.required)) if (!own(value, key)) fail(`missing ${key}`);
    for (const [key, item] of Object.entries(value)) {
      const child = own(shape.required, key) ? shape.required[key] : own(shape.optional, key) ? shape.optional[key] : undefined;
      if (child === undefined) fail(`unknown member ${key}`);
      else inspect(child, item, `${at}.${key}`, problems);
    }
    if (problems.length === before) for (const rule of shape.rules) for (const message of rule(value)) fail(message);
  }
}

export function shapeProblems(shape, value) {
  const problems = [];
  inspect(shape, value, "$", problems);
  return problems;
}

export function fixtureKind(relative) {
  if (own(fixtureShapes, relative)) return relative;
  return Object.keys(fixtureShapes).find((pattern) => {
    const star = pattern.indexOf("*");
    if (star < 0) return false;
    const prefix = pattern.slice(0, star), suffix = pattern.slice(star + 1);
    return relative.startsWith(prefix) && relative.endsWith(suffix)
      && !relative.slice(prefix.length, relative.length - suffix.length).includes("/");
  });
}

// bytes can also be a string in focused tests. Fatal decoding keeps broken
// UTF-8 from silently turning into replacement characters in some readers.
export function fixtureProblems(relative, bytes, context) {
  const kind = fixtureKind(relative);
  if (!kind) return [`tests/${relative}: no fixture shape description`];
  const description = fixtureShapes[kind], problems = [];
  let text;
  try { text = typeof bytes === "string" ? bytes : new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { return [`tests/${relative}: not UTF-8`]; }
  const format = description.format ?? "json";
  if (format === "text") {
    if (!text.isWellFormed()) return [`tests/${relative}: not a sequence of Unicode scalar values`];
    for (const message of description.rows?.(text, { readAllowList }) ?? []) problems.push(`tests/${relative}: ${message}`);
    if (!problems.length && context && description.audit) {
      for (const message of description.audit(text, context)) problems.push(`tests/${relative}: ${message}`);
    }
    return problems;
  }
  if (text.startsWith("\ufeff")) return [`tests/${relative}: not JSON: initial byte order mark`];
  if (format === "jsonl" && jsonWhitespaceOnly(text)) return [`tests/${relative}: expected at least one corpus record`];
  const parts = format === "jsonl" ? text.split("\n") : [text];
  parts.forEach((part, index) => {
    if (format === "jsonl" && jsonWhitespaceOnly(part)) return;
    const at = `tests/${relative}${format === "jsonl" ? `:${index + 1}` : ""}`;
    let value;
    try { value = JSON.parse(part); }
    catch (error) { problems.push(`${at}: not JSON: ${error.message}`); return; }
    for (const key of duplicateMembers(part)) problems.push(`${at}: repeated member ${key}`);
    for (const message of numberProblems(part)) problems.push(`${at}: ${message}`);
    if (description.scalarStrings) for (const string of illFormedStrings(value)) problems.push(`${at}: not a Unicode scalar string: ${string}`);
    const errors = shapeProblems(description.shape, value);
    for (const message of errors) problems.push(`${at}: ${message}`);
    if (!errors.length && context && description.references) for (const reference of description.references(value)) {
      if (!context.files.has(reference)) problems.push(`${at}: missing fixture reference ${reference}`);
    }
    if (!errors.length && context && description.audit) {
      for (const message of description.audit(value, context)) problems.push(`${at}: ${message}`);
    }
  });
  return problems;
}

// No data file can bypass the registry because of its name or extension.
// README files describe fixtures and are the only non-fixture files here.
export function fixtureFiles(root) {
  const files = [];
  function walk(directory, prefix) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix + entry.name, full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full, relative + "/");
      else if (entry.name !== "README.md") files.push(relative);
    }
  }
  walk(path.join(root, "tests"), "");
  return files;
}

// A context resolves references within one fixture tree. Corpus records are
// indexed once, on demand, and malformed records remain the shape check's job.
export function fixtureContext(root, files = fixtureFiles(root)) {
  const read = (relative) => fs.readFileSync(path.join(root, "tests", relative));
  let corpus;
  return { files: new Set(files), read, corpus: () => {
    if (corpus) return corpus;
    corpus = new Map();
    for (const relative of files) if (fixtureKind(relative) === "corpus/*.jsonl") {
      let text;
      try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(read(relative)); }
      catch { continue; }
      for (const line of text.split("\n")) {
        let record;
        try { record = JSON.parse(line); }
        catch { continue; }
        if (numberProblems(line).length) continue;
        if (!isRecord(record) || typeof record.id !== "string" || typeof record.text !== "string") continue;
        if (!corpus.has(record.id)) corpus.set(record.id, new Set());
        corpus.get(record.id).add(record.text);
      }
    }
    return corpus;
  } };
}

export function fixtureShapeProblems(root) {
  const files = fixtureFiles(root), context = fixtureContext(root, files), problems = [], kinds = new Set();
  for (const relative of files) {
    const kind = fixtureKind(relative);
    if (kind) kinds.add(kind);
    for (const message of fixtureProblems(relative, fs.readFileSync(path.join(root, "tests", relative)), context)) problems.push(message);
  }
  for (const kind of Object.keys(fixtureShapes)) if (!kinds.has(kind)) problems.push(`tests/${kind}: required fixture is missing`);
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const problems = fixtureShapeProblems(root);
  if (problems.length) { console.error(problems.join("\n")); process.exitCode = 1; }
  else console.log("Shared fixture shapes agree.");
}
