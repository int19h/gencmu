// Checks that a grammar DOM that did not come from reading a document, the
// bootstrap's or a precompiled one from compiled.json, has the shape the
// reader would have given it (docs/output.md, "The DOM"), so that a corrupt
// or hand-made one is refused rather than failing somewhere inside a parse.

/** @import { GrammarDom } from "./types.js" */

const DOM_FUNCTIONS = new Set(["phonemes", "text", "lowercase", "tags", "classes", "words", "head", "tail", "last", "matches"]);
const DOM_COMPARATORS = new Set(["=", "≠", "∈", "∉", "⊆"]);
const DOM_NAME = /^[A-Za-z][A-Za-z0-9-]*$/;
// The nesting the notation allows (engine §9): deeper than any grammar a
// person writes, and shallow enough for the recursive walks over a DOM.
export const DOM_MAX_DEPTH = 256;

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

const DOM_SPANS = new Set(["head", "tail", "last"]);

/**
 * Whether a term is a span: a capture, or head, tail or last of one.
 * @param {unknown} value
 * @returns {boolean}
 */
function isDomSpan(value) {
  return isDomObject(value) && (typeof value.capture === "string" || (typeof value.call === "string" && DOM_SPANS.has(value.call)));
}

/**
 * Why a value is not a grammar DOM, or null when it is one.
 * @param {unknown} dom
 * @returns {string | null}
 */
export function domProblem(dom) {
  if (!isDomObject(dom) || dom.format !== 1 || !Array.isArray(dom.rules) || !Array.isArray(dom.directives)) return "not a DOM of format 1";
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
    // A function's argument is a term where a span may stand.
    const argument = kind === "argument";
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
      // The reader's rules (engine §9): nothing alone, this only with this,
      // a capture listed once, no tags on an inserted tag.
      if (value.nothing === true) {
        if (Object.keys(value).length !== 1) return "a malformed emission";
        continue;
      }
      if (!list(value.items, 1)) return "a malformed emission";
      const items = /** @type {unknown[]} */ (value.items);
      const kinds = items.map((item) => (!isDomObject(item) ? null : item.this === true ? "this" : typeof item.capture === "string" ? "capture" : typeof item.insert === "string" ? "insert" : null));
      if (kinds.includes(null) || (kinds.includes("this") && !kinds.every((k) => k === "this"))) return "a malformed emission";
      const captures = items.flatMap((item) => (isDomObject(item) && typeof item.capture === "string" ? [item.capture] : []));
      if (new Set(captures).size !== captures.length) return "a malformed emission";
      for (const item of /** @type {Record<string, unknown>[]} */ (items)) {
        if (item.tags === undefined) continue;
        if (typeof item.insert === "string") return "a malformed emission";
        push("term", item.tags);
      }
    } else if (kind === "condition") {
      if ("any" in value) {
        if (!list(value.any, 2)) return "a malformed condition";
        for (const item of /** @type {unknown[]} */ (value.any)) push("condition", item);
      } else if ("not" in value) {
        push("condition", value.not);
      } else if ("matches" in value) {
        if (typeof value.rule !== "string" || !isDomSpan(value.matches)) return "a malformed condition";
        pending.push({ kind: "argument", value: value.matches, depth: next });
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
        // The reader's signatures (engine §9), with a span where one is due.
        const args = /** @type {unknown[]} */ (Array.isArray(value.args) ? value.args : []);
        const isRule = (/** @type {unknown} */ arg) => isDomObject(arg) && typeof arg.rule === "string" && Object.keys(arg).length === 1;
        const call = value.call;
        let ok;
        if (typeof call !== "string" || !DOM_FUNCTIONS.has(call) || call === "matches") ok = false;
        else if (call === "tags") ok = (args.length === 1 && isDomSpan(args[0])) || (args.length === 2 && isDomSpan(args[0]) && isRule(args[1]));
        else if (call === "lowercase") ok = args.length === 1 && !isRule(args[0]) && !isDomSpan(args[0]);
        else ok = args.length === 1 && isDomSpan(args[0]);
        if (!ok || (!argument && DOM_SPANS.has(/** @type {string} */ (call)))) return "a malformed term";
        for (const arg of args) if (!isRule(arg)) pending.push({ kind: "argument", value: arg, depth: next });
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
