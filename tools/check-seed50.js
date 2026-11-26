#!/usr/bin/env node
import fs from "node:fs";
import { createHash } from "node:crypto";
import { fnv1a64 } from "../lib/js/src/hash.js";
import { compareCodePoints } from "../lib/js/src/tags.js";
import { resolvePath } from "../lib/js/src/markdown.js";
import { UnicodeTable } from "../lib/js/src/unicode.js";
import { nameFields50, operandFields50, recordKind50 } from "../lib/js/src/format50/records.js";
import { methods50, validProperty50 } from "../lib/js/src/format50/signatures.js";
import { captureSlots50, validateDocument50 } from "../lib/js/src/format50/validate.js";

const root = new URL("../", import.meta.url);
const read = file => fs.readFileSync(file.startsWith("/") ? file : new URL(file, root), "utf8");
const manifest = JSON.parse(read("data/notation-bundles.json"));
const historical = process.argv[2];
const file = historical ?? manifest["50"].bootstrap;
const seed = read(file);
if (!historical && seed !== read("lib/js/" + file)) throw new Error("the package seed differs from the root seed");
const core = read("data/unicode/unicode.txt");
const properties = read("data/unicode/unicode-properties.txt");
const unicode = new UnicodeTable(core, properties);
const digest = createHash("sha256").update(seed).digest("hex");
console.log(JSON.stringify({ file, digest }));

const listMethods = new Set(["present", "all", "any"]);

const bootstrap = JSON.parse(seed);
if (bootstrap.format !== manifest["50"].format || bootstrap.unicode !== fnv1a64(core) ||
    bootstrap.properties !== fnv1a64(properties)) throw new Error("invalid bootstrap format or Unicode fingerprints");
const { bundledNames, documents } = bootstrap;
if (!documents || Array.isArray(documents) || typeof documents !== "object") {
  throw new Error("invalid bootstrap documents");
}
if (!bundledNames || Array.isArray(bundledNames) ||
    !Object.hasOwn(bundledNames, "data/unicode/unicode-names.txt")) throw new Error("invalid bundled names");
for (const path of Object.keys(bundledNames).sort(compareCodePoints)) {
  if (fnv1a64(read(path)) !== bundledNames[path]) throw new Error(`invalid bundled names fingerprint for ${path}`);
}
const required = new Set();
const active = [];
const faults = new Map();
function visit(path, from) {
  if (active.includes(path)) {
    const [line, column] = from.at;
    throw new Error(`${active.at(-1)}:${line}:${column}: ${path} includes itself (${[...active, path].join(" → ")})`);
  }
  if (required.has(path)) return;
  if (!path.startsWith(manifest["50"].sourceRoot + "/") || !Object.hasOwn(documents, path)) {
    throw new Error(`missing required bootstrap document ${path}`);
  }
  active.push(path);
  const { hash, dom } = documents[path];
  if (!/^[0-9a-f]{16}$/.test(hash) || !historical && hash !== fnv1a64(read(path))) {
    throw new Error(`invalid source fingerprint for ${path}`);
  }
  if (dom?.format !== 50) throw new Error(`${path}: expected format 50`);
  try {
    validateDocument50(dom, { document: path, unicode });
  } catch (error) {
    process.exitCode = 1;
    faults.set(path, error);
  }
  if (!faults.has(path)) {
    for (const directive of dom.directives) {
      if (directive.name === "names") {
        const names = resolvePath(path, directive.args[0]);
        if (!Object.hasOwn(bundledNames, names)) throw new Error(`missing bundled names ${names}`);
      }
      if (directive.name === "include") visit(resolvePath(path, directive.args[0]), directive);
    }
  }
  active.pop();
  required.add(path);
}
visit(manifest["50"].notation);
const paths = Object.keys(documents).sort(compareCodePoints);
for (const path of paths) {
  if (!faults.size && !required.has(path)) throw new Error(`unexpected bootstrap document ${path}`);
}

function auditCaptureUses(document, value, pointer, slots, owner, key, truth = false, at, slot) {
  if (!value || typeof value !== "object" || slot === "argument[]") return;
  const site = value.at ?? at;
  const kind = recordKind50(value, slot);
  if (["capture", "forward", "braced"].includes(kind) && slots.get(value.capture)) {
    const ok = truth || key === "map" || kind === "forward" || key === "receiver" &&
      listMethods.has(owner.method) && (owner.method !== "any" || owner.args.length === 1);
    if (!ok) process.exitCode = 1;
    console.log(JSON.stringify({ document, pointer, at: site, capture: value.capture,
      consumer: owner.method ?? owner.property ?? key, ok }));
  }
  if (kind === "lambda" && value.lambda && slots.has(value.lambda)) {
    slots = new Map(slots);
    slots.delete(value.lambda);
  }
  for (const [childKey, child, childSlot] of operandFields50(value, slot)) {
    const childTruth = childKey === "conditions" || childKey === "guard" || childKey === "if" ||
      childKey === "not" || kind === "conjunction" || kind === "disjunction" ||
      childKey === "then" && !value.else || truth && ["then", "else"].includes(childKey) ||
      Array.isArray(value) && truth;
    auditCaptureUses(document, child, `${pointer}/${childKey}`, slots, value, childKey, childTruth, site, childSlot);
  }
}

for (const document of paths) {
  if (!required.has(document)) continue;
  const { dom } = documents[document];
  const error = faults.get(document);
  if (error) {
    console.log(JSON.stringify({ document, validation: "document", at: error.where, message: error.description ?? error.message, ok: false }));
    continue;
  }
  console.log(JSON.stringify({ document, validation: "document", ok: true }));
  for (const [index, rule] of dom.rules.entries()) {
    const slots = (rule.alternatives ?? []).map(alt => captureSlots50(alt.expr));
    const shared = new Map();
    for (const slot of slots) for (const [name, list] of slot) shared.set(name, !!shared.get(name) || list);
    const pointer = `/rules/${index}`;
    for (const [key, clause, slot] of operandFields50(rule, "rules")) {
      if (key !== "alternatives") {
        auditCaptureUses(document, clause, `${pointer}/${key}`, shared, rule, key, key === "conditions", rule.at, slot);
      }
    }
    for (const [i, alt] of (rule.alternatives ?? []).entries()) {
      auditCaptureUses(document, alt.term, `${pointer}/alternatives/${i}/term`, slots[i], alt, "term", false, rule.at, "expression");
    }
  }
  const pending = [[dom, "", "document"]];
  while (pending.length) {
    const [value, pointer, category] = pending.pop();
    if (!value || typeof value !== "object") continue;
    const names = Array.isArray(value) ? [] : nameFields50(value, category);
    if (names.includes("method")) {
      const signature = methods50.get(value.method);
      const count = Array.isArray(value.args) ? value.args.length : -1;
      const ok = !!signature && count >= signature.min && count <= signature.max;
      if (!ok) process.exitCode = 1;
      console.log(JSON.stringify({ document, pointer, at: value.at, method: value.method, count, ok }));
    }
    if (names.includes("property")) {
      const ok = validProperty50(value.property, unicode);
      if (!ok) process.exitCode = 1;
      console.log(JSON.stringify({ document, pointer, at: value.at, property: value.property, ok }));
    }
    for (const [key, child, childKind] of operandFields50(value, category).reverse()) {
      pending.push([child, `${pointer}/${key}`, childKind]);
    }
  }
}
