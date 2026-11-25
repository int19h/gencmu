#!/usr/bin/env node
import fs from "node:fs";
import { createHash } from "node:crypto";
import { UnicodeTable } from "../lib/js/src/unicode.js";
import { methods50, validProperty50 } from "../lib/js/src/format50/signatures.js";

const root = new URL("../", import.meta.url);
const read = file => fs.readFileSync(new URL(file, root), "utf8");
const manifest = JSON.parse(read("data/notation-bundles.json"));
const historical = process.argv[2];
const file = historical ?? manifest["50"].bootstrap;
const seed = read(file);
if (!historical && seed !== read("lib/js/" + file)) throw new Error("the package seed differs from the root seed");
const unicode = new UnicodeTable(read("data/unicode/unicode.txt"), read("data/unicode/unicode-properties.txt"));
const digest = createHash("sha256").update(seed).digest("hex");
console.log(JSON.stringify({ file, digest }));

function captureSlots(body, list = false) {
  if (body.capture !== undefined) return new Map([[body.capture, list]]);
  if (body.primary) return captureSlots(body.primary, list);
  if (body.optional) return captureSlots(body.optional, true);
  const routes = body.choice ?? body.ranked;
  const children = routes ?? body.seq ?? body.and ??
    (body.repeat ? [body.repeat, ...(body.separator ? [body.separator] : [])] : []);
  const slots = children.map((child, index) => captureSlots(child, list || !!body.repeat || !!body.and && index > 0));
  const result = new Map();
  for (const child of slots) for (const [name, childList] of child) {
    result.set(name, !!result.get(name) || childList || !!routes && slots.some(slot => !slot.has(name)));
  }
  return result;
}

const listMethods = new Set(["present", "all", "any", "join", "union"]);

function auditCaptureUses(document, value, pointer, slots, owner, key, truth = false, at) {
  if (!value || typeof value !== "object") return;
  const site = value.at ?? at;
  if (slots.get(value.capture) && !value.expr) {
    const ok = truth || key === "map" || key === "receiver" && listMethods.has(owner.method);
    if (!ok) process.exitCode = 1;
    console.log(JSON.stringify({ document, pointer, at: site, capture: value.capture,
      consumer: owner.method ?? owner.property ?? key, ok }));
  }
  if (value.lambda && slots.has(value.lambda)) {
    slots = new Map(slots);
    slots.delete(value.lambda);
  }
  for (const [childKey, child] of Object.entries(value)) {
    if (childKey === "at") continue;
    const childTruth = childKey === "conditions" || childKey === "guard" || childKey === "if" ||
      childKey === "not" || Array.isArray(value.all) && childKey === "all" ||
      Array.isArray(value.any) && childKey === "any" ||
      childKey === "then" && !value.else || truth && ["then", "else"].includes(childKey) ||
      Array.isArray(value) && truth;
    auditCaptureUses(document, child, `${pointer}/${childKey}`, slots, value, childKey, childTruth, site);
  }
}

for (const [document, { dom }] of Object.entries(JSON.parse(seed).documents)) {
  if (dom.format !== 50) throw new Error(`${document}: expected format 50`);
  for (const [index, rule] of dom.rules.entries()) {
    const slots = rule.alternatives.map(alt => captureSlots(alt.expr));
    const shared = new Map();
    for (const slot of slots) for (const [name, list] of slot) shared.set(name, !!shared.get(name) || list);
    const { alternatives, ...clauses } = rule;
    const pointer = `/rules/${index}`;
    auditCaptureUses(document, clauses, pointer, shared, {}, "rule");
    for (const [i, alt] of alternatives.entries()) {
      auditCaptureUses(document, alt.term, `${pointer}/alternatives/${i}/term`, slots[i], alt, "term", false, rule.at);
    }
  }
  const pending = [[dom, ""]];
  while (pending.length) {
    const [value, pointer] = pending.pop();
    if (!value || typeof value !== "object") continue;
    if (Object.hasOwn(value, "method")) {
      const signature = methods50.get(value.method);
      const count = Array.isArray(value.args) ? value.args.length : -1;
      const ok = !!signature && count >= signature.min && count <= signature.max;
      if (!ok) process.exitCode = 1;
      console.log(JSON.stringify({ document, pointer, at: value.at, method: value.method, count, ok }));
    }
    if (Object.hasOwn(value, "property")) {
      const ok = validProperty50(value.property, unicode);
      if (!ok) process.exitCode = 1;
      console.log(JSON.stringify({ document, pointer, at: value.at, property: value.property, ok }));
    }
    for (const [key, child] of Object.entries(value).reverse()) pending.push([child, `${pointer}/${key}`]);
  }
}
