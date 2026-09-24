// Checks that a grammar DOM that did not come from reading a document, the
// bootstrap's or a precompiled one from compiled.json, has the shape the
// reader would have given it (docs/output.md, "The DOM"), so that a corrupt
// or hand-made one is refused rather than failing somewhere inside a parse.

/** @import { GrammarDom } from "./types.js" */

const DOM_FUNCTIONS = new Set(["phonemes", "text", "lowercase", "tags", "classes", "words", "head", "tail", "last", "matches"]);
const DOM_COMPARATORS = new Set(["=", "≠", "∈", "∉", "⊆"]);
const DOM_NAME = /^[A-Za-z][A-Za-z0-9-]*$/;
// Deeper than any grammar a person writes, and shallow enough for the
// recursive walks over a DOM.
const DOM_MAX_DEPTH = 256;

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isDomObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isDomPosition(value) {
  return Array.isArray(value) && value.length === 2 && value.every((n) => Number.isInteger(n));
}

/**
 * Why a value is not a grammar DOM, or null when it is one.
 * @param {unknown} dom
 * @returns {string | null}
 */
export function domProblem(dom) {
  if (!isDomObject(dom) || !Array.isArray(dom.rules) || !Array.isArray(dom.directives)) return "not a DOM";
  for (const directive of dom.directives) {
    if (!isDomObject(directive) || typeof directive.name !== "string" || !Array.isArray(directive.args) ||
        !directive.args.every((arg) => typeof arg === "string") || !isDomPosition(directive.at)) return "a malformed directive";
  }
  /** @type {{kind: string, value: unknown, depth: number}[]} */
  const pending = [];
  for (const rule of dom.rules) {
    if (!isDomObject(rule) || typeof rule.name !== "string" || !DOM_NAME.test(rule.name) || (rule.op !== "define" && rule.op !== "extend") ||
        !Array.isArray(rule.alternatives) || rule.alternatives.length === 0 || !Array.isArray(rule.conditions) || !isDomPosition(rule.at)) {
      return "a malformed rule";
    }
    if (rule.tags !== undefined) pending.push({ kind: "term", value: rule.tags, depth: 0 });
    if (rule.emit !== undefined) pending.push({ kind: "emission", value: rule.emit, depth: 0 });
    for (const condition of rule.conditions) pending.push({ kind: "condition", value: condition, depth: 0 });
    for (const alternative of rule.alternatives) {
      if (!isDomObject(alternative) || !Array.isArray(alternative.guards) ||
          !alternative.guards.every((guard) => isDomObject(guard) && typeof guard.feature === "string" && typeof guard.negated === "boolean")) {
        return "a malformed alternative";
      }
      pending.push({ kind: "expr", value: alternative.expr, depth: 0 });
      if (alternative.tags !== undefined) pending.push({ kind: "term", value: alternative.tags, depth: 0 });
    }
  }
  for (let task = pending.pop(); task !== undefined; task = pending.pop()) {
    const { kind, value, depth } = task;
    if (depth > DOM_MAX_DEPTH) return "nested too deeply";
    if (!isDomObject(value)) return `a malformed ${kind}`;
    const next = depth + 1;
    /** @type {(kind: string, value: unknown) => void} */
    const push = (childKind, child) => pending.push({ kind: childKind, value: child, depth: next });
    /** @type {(list: unknown, least: number, most?: number) => boolean} */
    const list = (items, least, most = Infinity) => Array.isArray(items) && items.length >= least && items.length <= most;
    if (kind === "expr") {
      if ("choice" in value || "seq" in value) {
        const items = "choice" in value ? value.choice : value.seq;
        if (!list(items, 2)) return "a malformed expression";
        for (const item of /** @type {unknown[]} */ (items)) push("expr", item);
      } else if ("and" in value) {
        if (!list(value.and, 2, 16)) return "a malformed expression";
        for (const item of /** @type {unknown[]} */ (value.and)) push("expr", item);
      } else if ("repeat" in value) {
        if (value.min !== 0 && value.min !== 1) return "a malformed expression";
        push("expr", value.repeat);
      } else if ("optional" in value) {
        push("expr", value.optional);
      } else if ("capture" in value) {
        const inner = value.expr;
        if (typeof value.capture !== "string" || !isDomObject(inner) ||
            !(typeof inner.ref === "string" || typeof inner.terminal === "string")) return "a malformed capture";
      } else if (!(typeof value.ref === "string" || typeof value.terminal === "string" || value.hash === true || value.empty === true)) {
        return "a malformed expression";
      }
    } else if (kind === "emission") {
      if (value.nothing === true) continue;
      if (!list(value.items, 1)) return "a malformed emission";
      for (const item of /** @type {unknown[]} */ (value.items)) {
        if (!isDomObject(item) || !(item.this === true || typeof item.capture === "string" || typeof item.insert === "string")) return "a malformed emission";
        if (item.tags !== undefined) push("term", item.tags);
      }
    } else if (kind === "condition") {
      if ("any" in value) {
        if (!list(value.any, 2)) return "a malformed condition";
        for (const item of /** @type {unknown[]} */ (value.any)) push("condition", item);
      } else if ("not" in value) {
        push("condition", value.not);
      } else if ("matches" in value) {
        if (typeof value.rule !== "string") return "a malformed condition";
        push("term", value.matches);
      } else {
        if (typeof value.op !== "string" || !DOM_COMPARATORS.has(value.op)) return "a malformed condition";
        push("term", value.left);
        push("term", value.right);
      }
    } else {
      if ("set" in value || "union" in value || "intersection" in value) {
        const items = value.set ?? value.union ?? value.intersection;
        if (!list(items, "set" in value ? 0 : 2)) return "a malformed term";
        for (const item of /** @type {unknown[]} */ (items)) push("term", item);
      } else if ("call" in value) {
        if (typeof value.call !== "string" || !DOM_FUNCTIONS.has(value.call) || !list(value.args, 1, 2)) return "a malformed term";
        for (const arg of /** @type {unknown[]} */ (value.args)) {
          if (isDomObject(arg) && typeof arg.rule === "string" && Object.keys(arg).length === 1) continue;
          push("term", arg);
        }
      } else if (!(typeof value.literal === "string" || typeof value.weak === "string" || value.emptySet === true || typeof value.capture === "string")) {
        return "a malformed term";
      }
    }
  }
  return null;
}

/**
 * Whether a value is a grammar DOM.
 * @param {unknown} dom
 * @returns {dom is GrammarDom}
 */
export function isDom(dom) {
  return domProblem(dom) === null;
}
